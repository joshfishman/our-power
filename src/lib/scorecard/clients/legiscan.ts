// LegiScan API client.
//
// Wraps https://api.legiscan.com/ for the scorecard sync pipeline.
// Free tier: 30,000 queries/month. Our expected usage is well under
// that (~50 marker bills × ~5 calls per sync = ~250/run, run weekly).
//
// Auth: API key in LEGISCAN_API_KEY env var. Add to .env.local; never
// log the key. Without it, the client throws so the sync fails loudly
// rather than producing fabricated data.
//
// Caching: per-call in-memory cache for the duration of a single sync
// run. We don't cache across runs because LegiScan's `change_hash`
// per bill makes incremental sync the right pattern eventually
// (Phase 7), and we want each sync to see fresh status.
//
// Logging: every call writes an ApiCallLog row (success or failure).
// Errors are logged but do not throw — caller decides whether to abort.

import prisma from '@/lib/prisma/prisma';
import { logError, logInfo } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import type {
  BillLookupParams,
  LegislativeDataSource,
  NormalizedBill,
  NormalizedRollCall,
  NormalizedRollCallVote,
  NormalizedSponsor,
  SponsorTier,
  VotePosition,
} from './types';

const LEGISCAN_BASE = 'https://api.legiscan.com/';
const REQUEST_TIMEOUT_MS = 12_000;
const RATE_LIMIT_PAUSE_MS = 250; // ~4 req/sec ceiling, well below LegiScan's threshold

// LegiScan sponsor_type_id encoding (per LegiScan API User Manual).
// 1 = Primary sponsor (author / principal author)
// 2 = Co-sponsor (general)
// 3 = Joint sponsor (CA: principal coauthor)
// We treat sponsor_order = 1 with sponsor_type_id = 1 as AUTHOR for CA bills.
//
// Exported so the bulk-dataset adapter (legiscan-bulk.ts) can reuse the
// same mapping without copy-paste drift.
export const SPONSOR_TIER_FROM_LEGISCAN: Record<number, SponsorTier> = {
  1: 'SPONSOR',
  2: 'COSPONSOR',
  3: 'PRINCIPAL_COAUTHOR',
};

// LegiScan vote_id encoding (per LegiScan API User Manual).
export const VOTE_POSITION_FROM_LEGISCAN: Record<number, VotePosition> = {
  1: 'YES',
  2: 'NO',
  3: 'NOT_VOTING', // "Not Voting"
  4: 'ABSTAINED', // "Absent"
};

interface LegiscanEnvelope<T> {
  status: 'OK' | 'ERROR';
  alert?: { message: string };
  [key: string]: unknown;
}

export interface LegiscanSponsor {
  people_id: number;
  party_id?: number;
  party?: string;
  name: string;
  sponsor_type_id: number;
  sponsor_order: number;
}

export interface LegiscanRollCallSummary {
  roll_call_id: number;
  date: string;
  desc: string;
  yea: number;
  nay: number;
  nv: number;
  absent: number;
  total: number;
  passed: number; // 0 or 1
  chamber: string;
  url?: string;
  state_link?: string;
}

export interface LegiscanRollCallDetailVote {
  people_id: number;
  vote_id: number;
  vote_text: string;
}

export interface LegiscanRollCallDetail extends LegiscanRollCallSummary {
  votes: LegiscanRollCallDetailVote[];
}

export interface LegiscanHistoryEntry {
  date: string;
  chamber: string; // 'A' (assembly/house), 'S' (senate), 'E' (executive)
  action: string;
  /** Bill status code at the time of the action (1 = introduced, etc.). */
  importance?: number;
}

export interface LegiscanBill {
  bill_id: number;
  state: string;
  session: { session_id: number; session_name?: string; year_start?: number; year_end?: number };
  bill_number: string;
  bill_type: string;
  title: string;
  description?: string;
  status: number;
  status_date?: string;
  url?: string;
  state_link?: string;
  sponsors: LegiscanSponsor[];
  votes: LegiscanRollCallSummary[];
  /** LegiScan returns the full procedural history per bill. Optional because
   * older bulk-dataset variants sometimes omit it. */
  history?: LegiscanHistoryEntry[];
}

interface SearchHit {
  bill_id: number;
  number: string;
  title: string;
  state: string;
}

export const STATUS_NAMES: Record<number, string> = {
  1: 'Introduced',
  2: 'Engrossed',
  3: 'Enrolled',
  4: 'Passed',
  5: 'Vetoed',
  6: 'Failed',
};

/**
 * Pure normalizer: LegiScan raw bill + map of roll-call detail by id ->
 * NormalizedBill. Shared between the live API client and the bulk
 * dataset adapter so both implementations agree on the contract.
 */
export function normalizeLegiscanBill(
  raw: LegiscanBill,
  rollCallDetails: Map<number, LegiscanRollCallDetail>,
): NormalizedBill {
  const sponsors: NormalizedSponsor[] = raw.sponsors.map((s) => ({
    externalPersonId: String(s.people_id),
    name: s.name,
    party: s.party ?? null,
    tier: SPONSOR_TIER_FROM_LEGISCAN[s.sponsor_type_id] ?? 'COSPONSOR',
    rawTier: s.sponsor_type_id,
    sponsorOrder: s.sponsor_order,
  }));

  const rollCalls: NormalizedRollCall[] = [];
  for (const summary of raw.votes ?? []) {
    const detail = rollCallDetails.get(summary.roll_call_id);
    if (!detail) continue;
    const votes: NormalizedRollCallVote[] = detail.votes.map((v) => ({
      externalPersonId: String(v.people_id),
      position: VOTE_POSITION_FROM_LEGISCAN[v.vote_id] ?? 'NOT_VOTING',
    }));
    rollCalls.push({
      externalRollCallId: String(detail.roll_call_id),
      description: detail.desc,
      date: detail.date,
      yes: detail.yea,
      no: detail.nay,
      notVoting: detail.nv,
      absent: detail.absent,
      passed: detail.passed === 1,
      votes,
      sourceUrl: detail.state_link ?? detail.url ?? null,
    });
  }

  const sessionLabel =
    raw.session.session_name ??
    [raw.session.year_start, raw.session.year_end].filter(Boolean).join('-') ??
    String(raw.session.session_id);

  // Procedural timeline. Earliest first; LegiScan returns it that way already
  // but we normalize defensively in case of source variation.
  const procedureHistory = (raw.history ?? [])
    .filter((h): h is LegiscanHistoryEntry => !!h?.date && !!h?.action)
    .map((h) => ({ date: h.date, chamber: h.chamber ?? '', action: h.action }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    externalBillId: String(raw.bill_id),
    state: raw.state,
    session: sessionLabel,
    billNumber: raw.bill_number,
    title: raw.title,
    description: raw.description ?? '',
    status: STATUS_NAMES[raw.status] ?? `Status ${raw.status}`,
    sponsors,
    rollCalls,
    sourceUrl: raw.state_link ?? raw.url ?? null,
    procedureHistory,
  };
}

/**
 * Per-process in-memory cache that resets between sync runs (and on
 * server restart). Keyed by full URL.
 */
class CallCache {
  private map = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.map.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.map.set(key, value);
  }

  clear(): void {
    this.map.clear();
  }
}

async function logApiCall(args: {
  endpoint: string;
  params: Record<string, string | number | undefined>;
  status: number | null;
  cacheHit: boolean;
  durationMs: number | null;
  errorMessage?: string;
}): Promise<void> {
  try {
    // Strip the API key from logged params if it ever leaks in.
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args.params)) {
      if (k === 'key') continue;
      if (v !== undefined) sanitized[k] = v;
    }
    await prisma.apiCallLog.create({
      data: {
        source: 'LEGISCAN',
        endpoint: args.endpoint,
        params: sanitized as Record<string, string | number | boolean | null>,
        status: args.status ?? undefined,
        cacheHit: args.cacheHit,
        durationMs: args.durationMs ?? undefined,
        errorMessage: args.errorMessage ?? null,
      },
    });
  } catch (err) {
    // Never let logging failure break the sync.
    logError('Failed to write ApiCallLog', err);
  }
}

export class LegiscanClient implements LegislativeDataSource {
  readonly name = 'LegiScan';

  private cache = new CallCache();

  private apiKey: string;

  private lastCallAt = 0;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.LEGISCAN_API_KEY;
    if (!key) {
      throw new Error('LEGISCAN_API_KEY is not set. Add it to .env.local before running scorecard sync.');
    }
    this.apiKey = key;
  }

  resetCache(): void {
    this.cache.clear();
  }

  private async pace(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCallAt;
    if (elapsed < RATE_LIMIT_PAUSE_MS) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS - elapsed));
    }
    this.lastCallAt = Date.now();
  }

  private async call<T>(op: string, params: Record<string, string | number | undefined>): Promise<T | null> {
    const merged: Record<string, string | number | undefined> = { key: this.apiKey, op, ...params };
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined) usp.set(k, String(v));
    }
    const url = `${LEGISCAN_BASE}?${usp.toString()}`;

    const cacheKey = url;
    const cached = this.cache.get<T>(cacheKey);
    if (cached !== undefined) {
      void logApiCall({ endpoint: op, params, status: 200, cacheHit: true, durationMs: 0 });
      return cached;
    }

    await this.pace();
    const start = Date.now();
    try {
      const response = await fetchWithTimeout(url, {}, REQUEST_TIMEOUT_MS);
      const durationMs = Date.now() - start;
      if (!response.ok) {
        await logApiCall({
          endpoint: op,
          params,
          status: response.status,
          cacheHit: false,
          durationMs,
          errorMessage: `HTTP ${response.status}`,
        });
        logError('LegiScan HTTP error', undefined, { op, status: response.status });
        return null;
      }
      const json = (await response.json()) as LegiscanEnvelope<T>;
      if (json.status !== 'OK') {
        await logApiCall({
          endpoint: op,
          params,
          status: response.status,
          cacheHit: false,
          durationMs,
          errorMessage: json.alert?.message ?? 'LegiScan returned non-OK status',
        });
        logError('LegiScan API non-OK', undefined, { op, alert: json.alert });
        return null;
      }
      await logApiCall({
        endpoint: op,
        params,
        status: response.status,
        cacheHit: false,
        durationMs,
      });
      this.cache.set(cacheKey, json as T);
      return json as T;
    } catch (err) {
      const durationMs = Date.now() - start;
      await logApiCall({
        endpoint: op,
        params,
        status: null,
        cacheHit: false,
        durationMs,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      logError('LegiScan fetch failed', err, { op });
      return null;
    }
  }

  /** Raw passthrough — useful for debug scripts. */
  async getBillRaw(billId: number): Promise<LegiscanBill | null> {
    const env = await this.call<{ bill: LegiscanBill }>('getBill', { id: billId });
    return env?.bill ?? null;
  }

  async getRollCallRaw(rollCallId: number): Promise<LegiscanRollCallDetail | null> {
    const env = await this.call<{ roll_call: LegiscanRollCallDetail }>('getRollCall', {
      id: rollCallId,
    });
    return env?.roll_call ?? null;
  }

  async searchBillRaw(state: string, query: string): Promise<SearchHit[]> {
    const env = await this.call<{ searchresult: Record<string, SearchHit | { count: number }> }>('getSearch', {
      state,
      query,
    });
    if (!env?.searchresult) return [];
    return Object.entries(env.searchresult)
      .filter(([k]) => k !== 'summary')
      .map(([, v]) => v as SearchHit);
  }

  async findBillByNumber(params: BillLookupParams): Promise<NormalizedBill | null> {
    const state = params.jurisdiction === 'FEDERAL' ? 'US' : 'CA';
    // LegiScan's getSearch op accepts a query string; bill number works as the query.
    const hits = await this.searchBillRaw(state, params.billNumber);
    if (hits.length === 0) return null;
    // Prefer exact bill_number match.
    const normalize = (s: string) => s.replace(/\s|-/g, '').toUpperCase();
    const target = normalize(params.billNumber);
    const exact = hits.find((h) => normalize(h.number) === target);
    const chosen = exact ?? hits[0];
    return this.getBillById(String(chosen.bill_id));
  }

  async getBillById(externalBillId: string): Promise<NormalizedBill | null> {
    const billIdNum = Number(externalBillId);
    if (!Number.isFinite(billIdNum)) return null;
    const raw = await this.getBillRaw(billIdNum);
    if (!raw) return null;

    // Fetch every roll-call detail referenced by the bill summary, then
    // hand the raw bill + detail map to the shared normalizer.
    const rollCallDetails = new Map<number, LegiscanRollCallDetail>();
    for (const summary of raw.votes ?? []) {
      const detail = await this.getRollCallRaw(summary.roll_call_id);
      if (detail) rollCallDetails.set(summary.roll_call_id, detail);
    }

    const normalized = normalizeLegiscanBill(raw, rollCallDetails);

    logInfo('LegiScan bill normalized', {
      billId: raw.bill_id,
      state: raw.state,
      billNumber: raw.bill_number,
      sponsorCount: normalized.sponsors.length,
      rollCallCount: normalized.rollCalls.length,
    });

    return normalized;
  }
}

let _client: LegiscanClient | null = null;
/** Lazy singleton — avoids constructing a client (which checks env) at import time. */
export function getLegiscanClient(): LegiscanClient {
  if (!_client) _client = new LegiscanClient();
  return _client;
}
