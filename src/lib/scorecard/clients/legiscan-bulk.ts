// LegiScan bulk-dataset adapter.
//
// Reads bills, sponsors, and roll-call detail from an unzipped LegiScan
// dataset directory on disk instead of calling the live API. Same
// `LegislativeDataSource` contract as `legiscan.ts`, so the sync engine
// is source-agnostic.
//
// Why this exists: the live API requires a one-page application that
// goes through manual review. The free bulk archives at
// https://legiscan.com/datasets only require login and ship the same
// JSON payload shape as the API responses (per the LegiScan API user
// manual). For a curated marker-bill workload that re-runs at most
// weekly, the bulk dataset is the lower-friction Plan B.
//
// Expected layout: any directory tree containing per-bill and
// per-roll-call JSON files. The adapter walks the tree and indexes by
// the JSON contents (bill_id / roll_call_id / state + bill_number),
// not by filename, so the LegiScan ZIP folder structure can change
// without breaking us. Both wrapped (`{bill: {...}}`) and bare
// (`{bill_id: ...}`) JSON variants are accepted.
//
// Usage:
//   const src = new LegiscanBulkClient({ datasetDir: '/path/to/data' });
//   const bill = await src.findBillByNumber({ jurisdiction: 'CA', billNumber: 'AB-2200' });

import fs from 'node:fs/promises';
import path from 'node:path';
import prisma from '@/lib/prisma/prisma';
import { logError, logInfo } from '@/lib/logger';
import { type LegiscanBill, type LegiscanRollCallDetail, normalizeLegiscanBill } from './legiscan';
import type { BillLookupParams, LegislativeDataSource, NormalizedBill } from './types';

const STATE_FOR_JURISDICTION = { FEDERAL: 'US', CA: 'CA' } as const;

interface BillIndexEntry {
  filePath: string;
  billId: number;
  state: string;
  billNumber: string;
  sessionId: number;
}

interface BulkClientOptions {
  /** Root directory containing LegiScan bulk dataset JSON files. */
  datasetDir?: string;
  /** Disable disk index logging — used by tests. */
  silent?: boolean;
}

/** Normalize a LegiScan bill number for lookup: strip whitespace + dashes, uppercase. */
function normalizeBillNumber(s: string): string {
  return s.replace(/\s|-/g, '').toUpperCase();
}

/**
 * Detects a LegiScan bill JSON. Accepts either a wrapped envelope
 * (`{ status: 'OK', bill: {...} }`) or a bare bill object
 * (`{ bill_id, bill_number, sponsors, ... }`).
 */
function extractBill(parsed: unknown): LegiscanBill | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const inner = (obj.bill as Record<string, unknown> | undefined) ?? obj;
  if (
    typeof inner.bill_id === 'number' &&
    typeof inner.bill_number === 'string' &&
    typeof inner.state === 'string' &&
    Array.isArray(inner.sponsors)
  ) {
    return inner as unknown as LegiscanBill;
  }
  return null;
}

/**
 * Detects a LegiScan person JSON. Accepts either
 * `{ status, person: {...} }` or a bare `{ people_id, name, ... }`.
 *
 * Returns the inner `{ people_id, bioguide_id }` slice we use to bridge
 * cross-session people_id values back to a stable bioguide identifier.
 * CA people files don't carry bioguide_id — that field will be missing
 * and we surface `undefined` so the caller can skip cleanly.
 */
function extractPerson(parsed: unknown): { peopleId: number; bioguideId: string | undefined } | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const inner = (obj.person as Record<string, unknown> | undefined) ?? obj;
  if (typeof inner.people_id !== 'number') return null;
  const bg = inner.bioguide_id;
  return {
    peopleId: inner.people_id,
    bioguideId: typeof bg === 'string' && bg.length > 0 ? bg : undefined,
  };
}

/**
 * Detects a LegiScan roll-call detail JSON. Accepts either
 * `{ status, roll_call: {...} }` or a bare `{ roll_call_id, votes, ... }`.
 */
function extractRollCall(parsed: unknown): LegiscanRollCallDetail | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const inner = (obj.roll_call as Record<string, unknown> | undefined) ?? obj;
  if (typeof inner.roll_call_id === 'number' && Array.isArray(inner.votes) && typeof inner.desc === 'string') {
    return inner as unknown as LegiscanRollCallDetail;
  }
  return null;
}

async function logBulkCall(args: {
  endpoint: string;
  params: Record<string, string | number | undefined>;
  durationMs: number;
  errorMessage?: string;
}): Promise<void> {
  try {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args.params)) {
      if (v !== undefined) sanitized[k] = v;
    }
    await prisma.apiCallLog.create({
      data: {
        // Reuse the LEGISCAN source enum — the data IS LegiScan; the
        // distinction is recorded in `endpoint` (`bulk:*`) so the API
        // call ledger can still be filtered by source.
        source: 'LEGISCAN',
        endpoint: `bulk:${args.endpoint}`,
        params: sanitized as Record<string, string | number | boolean | null>,
        status: args.errorMessage ? 500 : 200,
        cacheHit: false,
        durationMs: args.durationMs,
        errorMessage: args.errorMessage ?? null,
      },
    });
  } catch (err) {
    logError('Failed to write ApiCallLog (bulk)', err);
  }
}

export class LegiscanBulkClient implements LegislativeDataSource {
  readonly name = 'LegiScanBulk';

  private datasetDir: string;

  private silent: boolean;

  // Built lazily on first lookup.
  private indexed = false;

  private billsById = new Map<number, BillIndexEntry>();

  /** Key: `${state}:${normalizedBillNumber}` -> array of entries (multiple sessions possible). */
  private billsByNumber = new Map<string, BillIndexEntry[]>();

  private rollCallPathsById = new Map<number, string>();

  /**
   * Bridge from LegiScan people_id → bioguide_id, populated from
   * `people/*.json` files in the dataset. LegiScan assigns DIFFERENT
   * people_id values per session (a 117th-Congress people_id is not
   * the same as a 119th-Congress people_id for the same human), so
   * the sync engine uses this map as a cross-session fallback when
   * the direct `Legislator.legiscanPeopleId` lookup misses.
   *
   * Federal-only: CA `people/*.json` files don't carry bioguide_id.
   */
  private bioguideByPeopleId = new Map<number, string>();

  // Per-process cache of parsed-and-normalized bills.
  private parsedBillCache = new Map<number, NormalizedBill>();

  constructor(opts: BulkClientOptions = {}) {
    const dir = opts.datasetDir ?? process.env.LEGISCAN_DATASET_DIR;
    if (!dir) {
      throw new Error(
        'LEGISCAN_DATASET_DIR is not set. Point it at the directory where you unpacked the LegiScan bulk dataset ZIPs (e.g. /Users/me/legiscan-data).',
      );
    }
    this.datasetDir = dir;
    this.silent = opts.silent ?? false;
  }

  /** Re-scan the dataset directory on next call. */
  resetCache(): void {
    this.indexed = false;
    this.billsById.clear();
    this.billsByNumber.clear();
    this.rollCallPathsById.clear();
    this.bioguideByPeopleId.clear();
    this.parsedBillCache.clear();
  }

  /**
   * Cross-session people_id → bioguide_id lookup. Returns undefined if
   * the dataset has no person entry for this people_id, or if the
   * person file is CA (no bioguide_id field).
   *
   * Triggers a one-time directory walk if the index isn't built yet.
   */
  async getBioguideByPeopleId(peopleId: number): Promise<string | undefined> {
    await this.ensureIndexed();
    return this.bioguideByPeopleId.get(peopleId);
  }

  private async ensureIndexed(): Promise<void> {
    if (this.indexed) return;
    const start = Date.now();
    let stat;
    try {
      stat = await fs.stat(this.datasetDir);
    } catch (err) {
      throw new Error(
        `LEGISCAN_DATASET_DIR ${this.datasetDir} does not exist or is unreadable: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (!stat.isDirectory()) {
      throw new Error(`LEGISCAN_DATASET_DIR ${this.datasetDir} is not a directory.`);
    }

    let bills = 0;
    let rollCalls = 0;
    let people = 0;
    let scanned = 0;

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip common non-data folders.
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
          await walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith('.json')) continue;
        scanned += 1;
        let parsed: unknown;
        try {
          const text = await fs.readFile(full, 'utf-8');
          parsed = JSON.parse(text);
        } catch {
          // Skip unparseable JSON silently — dataset ZIPs sometimes
          // include schema or metadata files we don't care about.
          continue;
        }
        const billRaw = extractBill(parsed);
        if (billRaw) {
          const sessionId = billRaw.session?.session_id ?? 0;
          const entry: BillIndexEntry = {
            filePath: full,
            billId: billRaw.bill_id,
            state: billRaw.state,
            billNumber: billRaw.bill_number,
            sessionId,
          };
          this.billsById.set(billRaw.bill_id, entry);
          const key = `${billRaw.state}:${normalizeBillNumber(billRaw.bill_number)}`;
          const list = this.billsByNumber.get(key) ?? [];
          list.push(entry);
          this.billsByNumber.set(key, list);
          bills += 1;
          continue;
        }
        const rcRaw = extractRollCall(parsed);
        if (rcRaw) {
          this.rollCallPathsById.set(rcRaw.roll_call_id, full);
          rollCalls += 1;
          continue;
        }
        const personRaw = extractPerson(parsed);
        if (personRaw) {
          // CA people files don't carry bioguide_id — skip the map
          // entry but still count the file so the indexing log is
          // accurate. (We only need the federal entries for the
          // cross-session fallback.)
          if (personRaw.bioguideId) {
            this.bioguideByPeopleId.set(personRaw.peopleId, personRaw.bioguideId);
          }
          people += 1;
        }
      }
    };

    await walk(this.datasetDir);
    this.indexed = true;
    if (!this.silent) {
      logInfo('LegiScan bulk dataset indexed', {
        datasetDir: this.datasetDir,
        bills,
        rollCalls,
        people,
        bioguideMapped: this.bioguideByPeopleId.size,
        filesScanned: scanned,
        durationMs: Date.now() - start,
      });
    }
  }

  private async loadRollCall(rollCallId: number): Promise<LegiscanRollCallDetail | null> {
    const filePath = this.rollCallPathsById.get(rollCallId);
    if (!filePath) return null;
    try {
      const text = await fs.readFile(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(text);
      return extractRollCall(parsed);
    } catch (err) {
      logError('Failed to read roll call from dataset', err, { rollCallId, filePath });
      return null;
    }
  }

  async findBillByNumber(params: BillLookupParams): Promise<NormalizedBill | null> {
    await this.ensureIndexed();
    const state = STATE_FOR_JURISDICTION[params.jurisdiction];
    const key = `${state}:${normalizeBillNumber(params.billNumber)}`;
    const matches = this.billsByNumber.get(key);
    if (!matches || matches.length === 0) {
      void logBulkCall({
        endpoint: 'findBillByNumber',
        params: { state, billNumber: params.billNumber, sessionId: params.sessionId },
        durationMs: 0,
        errorMessage: 'not found in dataset',
      });
      return null;
    }
    // Pick the most recent session unless the caller pinned one.
    let chosen: BillIndexEntry | undefined;
    if (params.sessionId) {
      const targetSession = Number(params.sessionId);
      chosen = matches.find((m) => m.sessionId === targetSession);
    }
    if (!chosen) {
      chosen = matches.reduce((acc, cur) => (cur.sessionId > acc.sessionId ? cur : acc), matches[0]);
    }
    return this.getBillById(String(chosen.billId));
  }

  async getBillById(externalBillId: string): Promise<NormalizedBill | null> {
    await this.ensureIndexed();
    const billIdNum = Number(externalBillId);
    if (!Number.isFinite(billIdNum)) return null;

    const cached = this.parsedBillCache.get(billIdNum);
    if (cached) {
      void logBulkCall({
        endpoint: 'getBill',
        params: { id: billIdNum, cache: 'hit' },
        durationMs: 0,
      });
      return cached;
    }

    const entry = this.billsById.get(billIdNum);
    if (!entry) {
      void logBulkCall({
        endpoint: 'getBill',
        params: { id: billIdNum },
        durationMs: 0,
        errorMessage: 'bill not found in dataset',
      });
      return null;
    }

    const start = Date.now();
    let raw: LegiscanBill | null;
    try {
      const text = await fs.readFile(entry.filePath, 'utf-8');
      raw = extractBill(JSON.parse(text));
    } catch (err) {
      void logBulkCall({
        endpoint: 'getBill',
        params: { id: billIdNum },
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    if (!raw) {
      void logBulkCall({
        endpoint: 'getBill',
        params: { id: billIdNum },
        durationMs: Date.now() - start,
        errorMessage: 'bill JSON failed shape check',
      });
      return null;
    }

    const rollCallDetails = new Map<number, LegiscanRollCallDetail>();
    for (const summary of raw.votes ?? []) {
      const detail = await this.loadRollCall(summary.roll_call_id);
      if (detail) rollCallDetails.set(summary.roll_call_id, detail);
    }

    const normalized = normalizeLegiscanBill(raw, rollCallDetails);
    this.parsedBillCache.set(billIdNum, normalized);

    void logBulkCall({
      endpoint: 'getBill',
      params: { id: billIdNum, rollCalls: rollCallDetails.size },
      durationMs: Date.now() - start,
    });

    if (!this.silent) {
      logInfo('LegiScan bulk bill normalized', {
        billId: raw.bill_id,
        state: raw.state,
        billNumber: raw.bill_number,
        sponsorCount: normalized.sponsors.length,
        rollCallCount: normalized.rollCalls.length,
      });
    }

    return normalized;
  }
}

let _bulkClient: LegiscanBulkClient | null = null;
/** Lazy singleton — avoids checking env at import time. */
export function getLegiscanBulkClient(): LegiscanBulkClient {
  if (!_bulkClient) _bulkClient = new LegiscanBulkClient();
  return _bulkClient;
}
