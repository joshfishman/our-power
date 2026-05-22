// v1.7.1 — backfill multi-cycle principal-committee receipts into PacMoneyData.
//
// Why this exists:
//   The original ingest-fec.ts wrote ONE PacMoneyData row per legislator —
//   the latest cycle with substantive receipts. That worked for the v1.7
//   ratio scoring (which needs a single denominator), but v1.7.1's PAC Score
//   denominator sums receipts across cycles (4-cycle aggregate to match the
//   spike methodology). When a legislator's latest cycle is partial (e.g.
//   Markey filed only ~$524K in his 2026 cycle so far), the denominator
//   collapses and the score swings wildly.
//
//   This script writes ONE row per (legislator, cycle) so SUM(totalReceipts)
//   queries naturally aggregate to the multi-cycle total.
//
// Bulk endpoint:
//   /candidates/totals/?candidate_id=A&candidate_id=B&… returns totals for
//   multiple candidates across all their filed cycles. We batch 40 IDs per
//   request (under URL length limits) and paginate per_page=100. For ~540
//   federal legislators × ~5 cycles ≈ 2700 rows, this is roughly 35–40 API
//   calls total (vs. 2160+ if we asked per-candidate-per-cycle).
//
// Usage:
//   npm run scorecard:ingest-fec-receipts-multicycle
//   npm run scorecard:ingest-fec-receipts-multicycle -- --dry-run
//   npm run scorecard:ingest-fec-receipts-multicycle -- --cycles=2018,2020,2022,2024
//
// Default cycles: 2018, 2020, 2022, 2024 (the 4-cycle aggregate the spike used).
// 2026 rows are left to the canonical ingest-fec.ts (which also computes the
// IE buckets and combinedCorporateRatio — this script only writes receipts).

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const FEC_BASE = 'https://api.open.fec.gov/v1';
const BATCH_SIZE = 40; // 40 FEC IDs per URL — keeps the GET under typical 8KB limits
const RATE_LIMIT_PAUSE_MS = 100;

interface CliFlags {
  dryRun: boolean;
  cycles: number[];
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false, cycles: [2018, 2020, 2022, 2024] };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--cycles=')) {
      flags.cycles = arg
        .split('=')[1]
        .split(',')
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isFinite(n));
    }
  }
  return flags;
}

interface FecTotalsRow {
  candidate_id: string;
  cycle: number;
  receipts: number;
  other_political_committee_contributions?: number;
  individual_contributions?: number;
}

let lastCallAt = 0;
async function pace(): Promise<void> {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < RATE_LIMIT_PAUSE_MS) await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS - elapsed));
  lastCallAt = Date.now();
}

// Bulk-fetch totals for up to BATCH_SIZE candidate IDs across the requested
// cycles. Paginates internally. Returns ALL returned rows; caller filters.
async function bulkCandidateTotals(candidateIds: string[], cycles: number[], apiKey: string): Promise<FecTotalsRow[]> {
  const out: FecTotalsRow[] = [];
  let page = 1;
  while (true) {
    await pace();
    // /candidates/totals/ supports repeated candidate_id and cycle params.
    const params = new URLSearchParams();
    params.set('api_key', apiKey);
    params.set('per_page', '100');
    params.set('page', String(page));
    // /candidates/totals/ only allows sort on the fields it returns
    // (election_year, name, party, etc.) — not on cycle. We don't actually
    // need a sort order; we'll aggregate client-side. Omitting `sort` is
    // fine.
    for (const id of candidateIds) params.append('candidate_id', id);
    for (const c of cycles) params.append('cycle', String(c));
    const url = `${FEC_BASE}/candidates/totals/?${params.toString()}`;
    // Network blip retries — ECONNRESET is common on long-running ingests.
    // We retry up to 3 times with exponential backoff before giving up.
    let r: Response | null = null;
    let netAttempt = 0;
    while (netAttempt < 3) {
      try {
        r = await fetch(url);
        break;
      } catch (err) {
        netAttempt += 1;
        const wait = 2000 * netAttempt;
        console.warn(
          `  [warn] network error on page ${page} (attempt ${netAttempt}/3): ${
            err instanceof Error ? err.message : err
          }; retry in ${wait}ms`,
        );
        await new Promise((s) => setTimeout(s, wait));
      }
    }
    if (!r) throw new Error(`network failure after 3 attempts on page ${page}`);
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      const isRateLimit = r.status === 429 || /OVER_RATE_LIMIT|rate limit/i.test(body);
      if (isRateLimit) {
        console.warn(`  [warn] rate limit hit on page ${page}; sleeping 60s and retrying`);
        await new Promise((s) => setTimeout(s, 60_000));
        continue;
      }
      throw new Error(`FEC bulk fetch failed: ${r.status} — ${body.slice(0, 200)}`);
    }
    const j = (await r.json()) as {
      results?: FecTotalsRow[];
      pagination?: { pages?: number };
    };
    out.push(...(j.results ?? []));
    const pages = j.pagination?.pages ?? 1;
    if (page >= pages) break;
    page += 1;
  }
  return out;
}

async function main(): Promise<void> {
  const apiKey = process.env.FEC_API_KEY ?? process.env.FEC_DATA_API ?? '';
  if (!apiKey) {
    console.error('No FEC API key. Set FEC_API_KEY in .env.local.');
    process.exit(1);
  }
  const flags = parseFlags(process.argv);
  console.log(`[ingest-fec-receipts-multicycle] flags: ${JSON.stringify(flags)}`);

  const legs = await prisma.legislator.findMany({
    where: { isActive: true, jurisdiction: 'FEDERAL' },
    select: { id: true, fullName: true, fecIds: true },
  });
  // Build FEC-ID → legislator map. Some legs have multiple FEC IDs (House
  // → Senate transitions); we want totals from ALL of them.
  const idToLeg = new Map<string, { legId: string; fullName: string }>();
  const allIds: string[] = [];
  for (const l of legs) {
    for (const id of l.fecIds ?? []) {
      idToLeg.set(id, { legId: l.id, fullName: l.fullName });
      allIds.push(id);
    }
  }
  console.log(`[ingest-fec-receipts-multicycle] ${legs.length} legislators, ${allIds.length} FEC IDs total`);

  // Batch the FEC IDs to stay under URL-length limits.
  const allRows: FecTotalsRow[] = [];
  for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
    const batch = allIds.slice(i, i + BATCH_SIZE);
    const rows = await bulkCandidateTotals(batch, flags.cycles, apiKey);
    allRows.push(...rows);
    console.log(`  batch ${i / BATCH_SIZE + 1}/${Math.ceil(allIds.length / BATCH_SIZE)}: ${rows.length} rows`);
  }
  console.log(`[ingest-fec-receipts-multicycle] ${allRows.length} total totals-rows fetched`);

  // Group by legId+cycle, summing receipts across FEC IDs (handles
  // House→Senate transitions where one legislator has two FEC IDs in one
  // cycle, though uncommon).
  interface Agg {
    legId: string;
    fullName: string;
    cycle: number;
    receipts: number;
    pacContribs: number;
    fecIdsUsed: Set<string>;
  }
  const byKey = new Map<string, Agg>();
  for (const r of allRows) {
    const meta = idToLeg.get(r.candidate_id);
    if (!meta) continue;
    const key = `${meta.legId}|${r.cycle}`;
    const existing = byKey.get(key);
    const receipts = Number(r.receipts ?? 0);
    const pac = Number(r.other_political_committee_contributions ?? 0);
    if (existing) {
      existing.receipts += receipts;
      existing.pacContribs += pac;
      existing.fecIdsUsed.add(r.candidate_id);
    } else {
      byKey.set(key, {
        legId: meta.legId,
        fullName: meta.fullName,
        cycle: r.cycle,
        receipts,
        pacContribs: pac,
        fecIdsUsed: new Set([r.candidate_id]),
      });
    }
  }
  console.log(`[ingest-fec-receipts-multicycle] ${byKey.size} (legislator, cycle) aggregates`);

  // Filter: drop cycle rows with $0 receipts (no real filing for that cycle).
  const aggs = Array.from(byKey.values()).filter((a) => a.receipts > 0);
  console.log(`[ingest-fec-receipts-multicycle] ${aggs.length} with substantive receipts (>$0)`);

  if (flags.dryRun) {
    console.log('[ingest-fec-receipts-multicycle] DRY RUN — first 10 aggregates:');
    for (const a of aggs.slice(0, 10)) {
      console.log(
        `  ${a.fullName.padEnd(28)} cycle=${a.cycle} receipts=$${a.receipts.toLocaleString()}  fecIds=${[
          ...a.fecIdsUsed,
        ].join(',')}`,
      );
    }
    // Also show a marquee summary if applicable.
    const marquee = ['Markey', 'Booker', 'Sanders', 'Scalise', 'Massie', 'Issa'];
    for (const name of marquee) {
      const sum = aggs.filter((a) => a.fullName.includes(name)).reduce((acc, a) => acc + a.receipts, 0);
      const cycles = aggs
        .filter((a) => a.fullName.includes(name))
        .map((a) => `${a.cycle}:$${(a.receipts / 1000).toFixed(0)}K`)
        .join(', ');
      if (sum > 0) console.log(`  [marquee] ${name}: $${sum.toLocaleString()} across [${cycles}]`);
    }
    await prisma.$disconnect();
    return;
  }

  // Upsert per (legislator, cycle, source=FEC_DIRECT). We only touch
  // receipts + corporatePacAmount + corporatePacPercentage. We don't
  // overwrite the IE buckets or combinedCorporateRatio if they exist on
  // a row (those come from the canonical ingest-fec.ts which also pulls
  // schedule_e). For new rows we leave IE/ratio at 0.
  let written = 0;
  for (const a of aggs) {
    const pct = a.receipts > 0 ? a.pacContribs / a.receipts : 0;
    await prisma.pacMoneyData.upsert({
      where: {
        legislatorId_cycleYear_dataSource: {
          legislatorId: a.legId,
          cycleYear: a.cycle,
          dataSource: 'FEC_DIRECT',
        },
      },
      create: {
        legislatorId: a.legId,
        cycleYear: a.cycle,
        corporatePacAmount: a.pacContribs,
        totalReceipts: a.receipts,
        corporatePacPercentage: pct,
        corporateIeSupportAmount: 0,
        corporateIeAgainstOpponentAmount: 0,
        corporateIeAgainstSelfAmount: 0,
        combinedCorporateRatio: pct,
        dataSource: 'FEC_DIRECT',
        dataSourceUrl: `https://www.fec.gov/data/candidate/${encodeURIComponent([...a.fecIdsUsed][0])}/`,
      },
      update: {
        // Only update the receipts-derived fields; leave IE buckets alone.
        corporatePacAmount: a.pacContribs,
        totalReceipts: a.receipts,
        corporatePacPercentage: pct,
        fetchedAt: new Date(),
      },
    });
    written += 1;
    if (written % 200 === 0) console.log(`  upserted ${written}/${aggs.length}`);
  }
  console.log(`[ingest-fec-receipts-multicycle] ✓ wrote ${written} (legislator, cycle) rows`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
