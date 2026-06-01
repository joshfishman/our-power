// v1.5 — bulk federal Schedule E loader. Replaces the rate-limited
// per-candidate FEC API calls in classifyIeBuckets() with a single
// bulk-CSV download per cycle. ~100x faster (5 min vs 8 hours of
// rate-limited API calls) and avoids the 1000/hr api.data.gov ceiling.
//
// FEC publishes Schedule E (Independent Expenditures Made) as a single
// per-cycle CSV: https://www.fec.gov/files/bulk-downloads/{cycle}/independent_expenditure_{cycle}.csv
//
// CSV columns we use:
//   cand_id  — candidate FEC ID (joins to Legislator.fecIds and RaceCandidate.externalCandidateId)
//   spe_id   — spender committee FEC ID (joins to CommitteeClassification.committeeId)
//   sup_opp  — 'S' (support candidate) or 'O' (oppose candidate)
//   exp_amo  — expenditure amount in USD
//   fec_election_yr — cycle year ("2024", "2026", etc.)
//
// What it does:
//   1. Download IE CSV(s) for the requested cycle(s)
//   2. Build an in-memory Set of MONEY-classified federal committee IDs
//   3. Stream each CSV, drop rows from non-MONEY spenders, aggregate
//      remaining rows by (cand_id, sup_opp, cycle).
//   4. For each federal legislator:
//        - For each of their fecIds: sum self-support + self-oppose
//        - For each of their opponent candidate IDs in that cycle
//          (from RaceCandidate): sum opposing spend → against-opponent
//   5. Update PacMoneyData IE columns + recompute combinedCorporateRatio.
//
// Cycle selection: --cycles=2024,2026 (default). Pass the most recent
// completed + active cycles so each legislator's last-completed-cycle
// data overrides any nominal-cycle gaps.
//
// Usage:
//   npm run scorecard:ingest-fec-bulk-ie
//   npm run scorecard:ingest-fec-bulk-ie -- --cycles=2024,2026
//   npm run scorecard:ingest-fec-bulk-ie -- --dry-run
//   npm run scorecard:ingest-fec-bulk-ie -- --csv-dir=/tmp  (use pre-downloaded files)

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'csv-parse';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const FEC_BULK_IE_URL = (cycle: number) =>
  `https://www.fec.gov/files/bulk-downloads/${cycle}/independent_expenditure_${cycle}.csv`;

interface CliFlags {
  cycles: number[];
  csvDir: string | null;
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { cycles: [2024, 2026], csvDir: null, dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--cycles=')) flags.cycles = arg.split('=')[1].split(',').map(Number);
    else if (arg.startsWith('--csv-dir=')) flags.csvDir = arg.split('=')[1];
  }
  return flags;
}

async function downloadCsv(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    function get(currentUrl: string, redirectsLeft: number): void {
      https
        .get(currentUrl, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            const loc = res.headers.location;
            if (!loc || redirectsLeft <= 0) {
              reject(new Error(`Too many redirects fetching ${url}`));
              return;
            }
            res.resume();
            get(loc, redirectsLeft - 1);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Failed to fetch ${currentUrl}: HTTP ${res.statusCode}`));
            return;
          }
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
          file.on('error', reject);
        })
        .on('error', reject);
    }
    get(url, 5);
  });
}

interface IeAggKey {
  candidateId: string;
  cycle: number;
  supOpp: 'S' | 'O';
}
function aggKey(k: IeAggKey): string {
  return `${k.candidateId}|${k.cycle}|${k.supOpp}`;
}

async function streamIeCsv(
  csvPath: string,
  moneySpenders: ReadonlySet<string>,
  agg: Map<string, number>,
): Promise<{ scanned: number; kept: number }> {
  let scanned = 0;
  let kept = 0;
  return new Promise((resolve, reject) => {
    createReadStream(csvPath)
      .pipe(parse({ columns: true, relax_quotes: true, relax_column_count: true, skip_empty_lines: true, trim: true }))
      .on('data', (row: Record<string, string>) => {
        scanned += 1;
        const speId = row.spe_id?.trim();
        const candId = row.cand_id?.trim();
        const supOpp = row.sup_opp?.trim().toUpperCase();
        const amtStr = row.exp_amo?.trim();
        const cycleStr = row.fec_election_yr?.trim();
        if (!speId || !candId || (supOpp !== 'S' && supOpp !== 'O') || !amtStr || !cycleStr) return;
        if (!moneySpenders.has(speId)) return; // PEOPLE-classified or unclassified → skip
        const amt = parseFloat(amtStr);
        if (!Number.isFinite(amt) || amt <= 0) return;
        const cycle = parseInt(cycleStr, 10);
        if (!Number.isFinite(cycle)) return;
        const key = aggKey({ candidateId: candId, cycle, supOpp: supOpp as 'S' | 'O' });
        agg.set(key, (agg.get(key) ?? 0) + amt);
        kept += 1;
      })
      .on('end', () => resolve({ scanned, kept }))
      .on('error', reject);
  });
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-fec-bulk-ie] flags: ${JSON.stringify(flags)}`);

  // 1. Load MONEY-classified federal spender IDs into memory.
  const moneyRows = await prisma.committeeClassification.findMany({
    where: { jurisdiction: 'FEDERAL', motivationClass: 'MONEY' },
    select: { committeeId: true },
  });
  const moneySpenders = new Set(moneyRows.map((r) => r.committeeId));
  console.log(`[ingest-fec-bulk-ie] ${moneySpenders.size} MONEY-classified federal spender IDs loaded`);

  // 2. Download or locate CSV(s) per cycle.
  const csvPaths = new Map<number, string>();
  for (const cycle of flags.cycles) {
    if (flags.csvDir) {
      const p = path.join(flags.csvDir, `independent_expenditure_${cycle}.csv`);
      await fs.access(p);
      csvPaths.set(cycle, p);
      console.log(`[ingest-fec-bulk-ie] using local ${p}`);
    } else {
      const tmpPath = path.join(os.tmpdir(), `independent_expenditure_${cycle}.csv`);
      const url = FEC_BULK_IE_URL(cycle);
      console.log(`[ingest-fec-bulk-ie] downloading ${url} → ${tmpPath}`);
      await downloadCsv(url, tmpPath);
      csvPaths.set(cycle, tmpPath);
    }
  }

  // 3. Stream each CSV, aggregating by (cand_id, cycle, sup_opp).
  const agg = new Map<string, number>();
  for (const [cycle, p] of csvPaths.entries()) {
    const { scanned, kept } = await streamIeCsv(p, moneySpenders, agg);
    console.log(`[ingest-fec-bulk-ie] cycle ${cycle}: scanned ${scanned} rows, kept ${kept} from MONEY spenders`);
  }

  // 4. Get all federal legislators with their FEC IDs.
  const legislators = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL', isActive: true, fecIds: { isEmpty: false } },
    select: { id: true, fecIds: true, state: true, chamber: true, district: true },
  });
  console.log(`[ingest-fec-bulk-ie] computing per-legislator IE buckets for ${legislators.length} legislators`);

  // 5. For each legislator + cycle, compute their three IE buckets.
  // Bucket math:
  //   selfSupport: sum of (cand=oneOfFecIds, cycle, 'S')
  //   selfOppose:  sum of (cand=oneOfFecIds, cycle, 'O')
  //   oppOppose:   sum of (cand=opponentCandIds, cycle, 'O') for opponents in RaceCandidate
  interface BucketRow {
    legislatorId: string;
    cycle: number;
    selfSupport: number;
    selfOppose: number;
    oppOppose: number;
  }
  const buckets: BucketRow[] = [];

  // Preload opponents per cycle.
  const oppByCycle = new Map<number, Map<string, string[]>>(); // cycle → legislatorId → opponentCandIds
  for (const cycle of flags.cycles) {
    const opps = await prisma.raceCandidate.findMany({
      where: { jurisdiction: 'FEDERAL', cycleYear: cycle },
      select: { state: true, chamber: true, district: true, externalCandidateId: true, legislatorId: true },
    });
    const byLeg = new Map<string, string[]>();
    // For each opponent row, find legislators in same race who are NOT this candidate.
    for (const opp of opps) {
      // Find all legislators in same race (state/chamber/district) that aren't this opp's legislatorId.
      const sameRace = legislators.filter(
        (l) =>
          l.state === opp.state &&
          l.chamber === opp.chamber &&
          (l.district ?? null) === (opp.district ?? null) &&
          l.id !== opp.legislatorId,
      );
      for (const l of sameRace) {
        const arr = byLeg.get(l.id) ?? [];
        arr.push(opp.externalCandidateId);
        byLeg.set(l.id, arr);
      }
    }
    oppByCycle.set(cycle, byLeg);
  }

  for (const leg of legislators) {
    for (const cycle of flags.cycles) {
      let selfSupport = 0;
      let selfOppose = 0;
      let oppOppose = 0;
      for (const fecId of leg.fecIds) {
        selfSupport += agg.get(aggKey({ candidateId: fecId, cycle, supOpp: 'S' })) ?? 0;
        selfOppose += agg.get(aggKey({ candidateId: fecId, cycle, supOpp: 'O' })) ?? 0;
      }
      const opps = oppByCycle.get(cycle)?.get(leg.id) ?? [];
      for (const oppId of opps) {
        oppOppose += agg.get(aggKey({ candidateId: oppId, cycle, supOpp: 'O' })) ?? 0;
      }
      if (selfSupport > 0 || selfOppose > 0 || oppOppose > 0) {
        buckets.push({ legislatorId: leg.id, cycle, selfSupport, selfOppose, oppOppose });
      }
    }
  }

  console.log(`[ingest-fec-bulk-ie] ${buckets.length} (legislator, cycle) pairs with non-zero IE`);
  const totalSelfSupport = buckets.reduce((s, b) => s + b.selfSupport, 0);
  const totalSelfOppose = buckets.reduce((s, b) => s + b.selfOppose, 0);
  const totalOppOppose = buckets.reduce((s, b) => s + b.oppOppose, 0);
  console.log(
    `  total MONEY IE supporting:  $${totalSelfSupport.toLocaleString()}\n  total MONEY IE attacking:   $${totalSelfOppose.toLocaleString()}\n  total MONEY IE vs opponents: $${totalOppOppose.toLocaleString()}`,
  );

  if (flags.dryRun) {
    console.log('[ingest-fec-bulk-ie] DRY RUN — no DB writes');
    await prisma.$disconnect();
    return;
  }

  // 6. Update PacMoneyData IE columns. We update only the IE fields; the
  // existing direct-PAC fields stay as the regular FEC ingest set them.
  // v1.9.1 two-tier weighting:
  //   combinedCorporateRatio = (corporatePacAmount + selfSupport)
  //                            / (totalReceipts + selfSupport)
  // selfSupport (IE_SUPPORT) counts at FULL weight in both numerator and
  // denominator — supported is supported. oppOppose (IE_OPPOSE_BENEFICIARY)
  // is zero-weight (money spent against the opponent, not on the legislator's
  // behalf); stored on the row for transparency but absent from the ratio.
  // Single SQL UPDATE per row keeps each transaction small.
  let written = 0;
  for (const b of buckets) {
    await prisma.$executeRaw`
      UPDATE "PacMoneyData"
      SET
        "corporateIeSupportAmount" = ${b.selfSupport},
        "corporateIeAgainstOpponentAmount" = ${b.oppOppose},
        "corporateIeAgainstSelfAmount" = ${b.selfOppose},
        "combinedCorporateRatio" = CASE
          WHEN ("totalReceipts" + ${b.selfSupport}) > 0
          THEN LEAST(1.0, ("corporatePacAmount" + ${b.selfSupport})
                       / NULLIF("totalReceipts" + ${b.selfSupport}, 0))
          ELSE NULL
        END,
        "updatedAt" = NOW()
      WHERE "legislatorId" = ${b.legislatorId}
        AND "cycleYear" = ${b.cycle}
        AND "dataSource" = 'FEC_DIRECT'
    `;
    written += 1;
    if (written % 100 === 0) console.log(`[ingest-fec-bulk-ie] updated ${written}/${buckets.length}`);
  }
  console.log(`[ingest-fec-bulk-ie] ✓ updated IE buckets on ${written} PacMoneyData rows`);

  // Also clear IE columns on PacMoneyData rows where the legislator has no
  // IE in any cycle (so v1.4 vintage data doesn't linger).
  const allLegIds = new Set(legislators.map((l) => l.id));
  const legsWithIe = new Set(buckets.map((b) => b.legislatorId));
  const legsToZero = [...allLegIds].filter((id) => !legsWithIe.has(id));
  if (legsToZero.length > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE "PacMoneyData"
       SET "corporateIeSupportAmount" = 0,
           "corporateIeAgainstOpponentAmount" = 0,
           "corporateIeAgainstSelfAmount" = 0,
           "combinedCorporateRatio" = CASE WHEN "totalReceipts" > 0 THEN LEAST(1.0, "corporatePacAmount" / "totalReceipts") ELSE NULL END,
           "updatedAt" = NOW()
       WHERE "dataSource" = 'FEC_DIRECT'
         AND "legislatorId" = ANY($1::text[])`,
      legsToZero,
    );
    console.log(`[ingest-fec-bulk-ie] zeroed IE on ${legsToZero.length} legislators with no IE this cycle`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
