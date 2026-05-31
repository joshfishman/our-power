// v1.7.1 — ingest classified PAC contributions for all federal legislators
// across 4 cycles (2018, 2020, 2022, 2024).
//
// Sources:
//   data/fec-bulk-{18,20,22,24}/itpas2.txt — transactions
//   data/fec-bulk-{18,20,22,24}/cm.txt     — committee master (needed to
//                                             map recipient_committee → candidate_id
//                                             for 24K direct contributions)
//
// Inclusion table:
//   24K — direct PAC contribution to candidate principal committee
//   24E — Super PAC IE supporting THIS candidate
//   24A — Super PAC IE OPPOSING this candidate (info only — not in PAC score)
//
// Skipped for v1.7.1 (deferred to v1.7.2):
//   22Y — PAC-to-PAC transfer (JFC feed). Multi-candidate JFCs need
//         apportionment logic we don't have yet. Single-cand JFCs (Scalise's
//         leadership fund) would help but the principal-committee path
//         already captures 70%+ of differentiation.
//
// Output: PacContribution rows keyed by (legislator, donor, cycle, kind).
//
// Run:
//   npm run scorecard:ingest-fec-classified
//   npm run scorecard:ingest-fec-classified -- --dry-run
//   npm run scorecard:ingest-fec-classified -- --cycle=2024  (single cycle)

import './load-env';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// v1.8.12 — cycles parameterized. Defaults cover 2018→2026; missing
// directories (e.g., a partial 2026 download) are silently skipped by the
// existsSync guard inside the read loop. To process a single cycle, pass
// `--cycle=2026`. To add a new cycle going forward, append to this list.
const CYCLE_DIRS = [
  { cycle: 2018, dir: path.join(process.cwd(), 'data', 'fec-bulk-2018') },
  { cycle: 2020, dir: path.join(process.cwd(), 'data', 'fec-bulk-2020') },
  { cycle: 2022, dir: path.join(process.cwd(), 'data', 'fec-bulk-2022') },
  { cycle: 2024, dir: path.join(process.cwd(), 'data', 'fec-bulk-2024') },
  { cycle: 2026, dir: path.join(process.cwd(), 'data', 'fec-bulk-2026') },
];

interface CliFlags {
  dryRun: boolean;
  cycle: number | null;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false, cycle: null };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--cycle=')) flags.cycle = Number(arg.split('=')[1]);
  }
  return flags;
}

// Build {fec_candidate_id → legislator_id} from Legislator.fecIds array.
async function loadCandToLegMap(): Promise<Map<string, string>> {
  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL' },
    select: { id: true, fecIds: true },
  });
  const map = new Map<string, string>();
  for (const l of legs) {
    for (const fecId of l.fecIds) {
      if (fecId) map.set(fecId, l.id);
    }
  }
  return map;
}

// Build {recipient_committee_id → cand_id} for principal-candidate committees
// from a cycle's cm.txt. Index 14 of cm.txt is CAND_ID; only set for P-design
// principal committees. We collect across all 4 cycles' cm files because a
// principal committee's CAND_ID doesn't change, and one cycle may have it
// populated where another doesn't.
function loadPrincipalCmteToCandMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const { dir } of CYCLE_DIRS) {
    const cmPath = path.join(dir, 'cm.txt');
    if (!fs.existsSync(cmPath)) continue;
    const text = fs.readFileSync(cmPath, 'utf-8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const cols = line.split('|');
      if (cols.length < 15) continue;
      // cm.txt schema (pipe-delimited):
      //   0 CMTE_ID  1 CMTE_NM  2 TRES_NM  3 CMTE_ST1  4 CMTE_ST2
      //   5 CMTE_CITY  6 CMTE_ST  7 CMTE_ZIP  8 CMTE_DSGN  9 CMTE_TP
      //   10 CMTE_PTY_AFFILIATION  11 CMTE_FILING_FREQ  12 ORG_TP
      //   13 CONNECTED_ORG_NM  14 CAND_ID
      const cmteId = cols[0];
      const designation = cols[8];
      const candId = cols[14];
      if (!cmteId || !candId) continue;
      // We only need principal-committee → candidate mappings for the 24K
      // path (direct PAC contributions to a candidate's principal). JFCs
      // (D=Joint Fundraising) are skipped per the v1.7.1 scope note above.
      if (designation === 'P') {
        map.set(cmteId, candId);
      }
    }
  }
  return map;
}

type Kind = 'DIRECT' | 'IE_SUPPORT' | 'IE_OPPOSE';

interface AggKey {
  legislatorId: string;
  donorCommitteeId: string;
  cycleYear: number;
  kind: Kind;
}

interface Aggregate extends AggKey {
  amount: number;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-fec-classified] flags: ${JSON.stringify(flags)}`);

  // 1. Legislator candidate-id lookup
  const candToLeg = await loadCandToLegMap();
  console.log(`[ingest-fec-classified] ${candToLeg.size} FEC candidate IDs → legislator mapping`);

  // 2. Principal-committee → candidate lookup
  const cmteToCand = loadPrincipalCmteToCandMap();
  console.log(`[ingest-fec-classified] ${cmteToCand.size} principal-committee → candidate mappings`);

  // 3. Known donor committee IDs (from PacClassification — for sanity stats)
  const knownDonors = await prisma.pacClassification.findMany({ select: { committeeId: true } });
  const knownDonorSet = new Set(knownDonors.map((d) => d.committeeId));
  console.log(`[ingest-fec-classified] ${knownDonorSet.size} known donor PACs`);

  // 4. Process each cycle's itpas2.txt and aggregate
  const aggregates = new Map<string, Aggregate>();
  let totalRows = 0;
  let attributed = 0;
  let unknownDonor = 0;

  function bump(key: AggKey, amount: number) {
    const k = `${key.legislatorId}|${key.donorCommitteeId}|${key.cycleYear}|${key.kind}`;
    const existing = aggregates.get(k);
    if (existing) existing.amount += amount;
    else aggregates.set(k, { ...key, amount });
  }

  for (const { cycle, dir } of CYCLE_DIRS) {
    if (flags.cycle !== null && cycle !== flags.cycle) continue;
    const itpasPath = path.join(dir, 'itpas2.txt');
    if (!fs.existsSync(itpasPath)) {
      console.warn(`  skipping cycle ${cycle} — file missing: ${itpasPath}`);
      continue;
    }
    const text = fs.readFileSync(itpasPath, 'utf-8');
    let cycleRows = 0;
    let cycleAttributed = 0;
    for (const line of text.split('\n')) {
      if (!line) continue;
      const cols = line.split('|');
      if (cols.length < 17) continue;
      const tx = cols[5];
      let kind: Kind | null = null;
      let recipientCandId: string | null = null;
      if (tx === '24K') {
        // 24K — direct to candidate's principal. Map committee → candidate.
        const recipCmte = cols[15];
        const candId = cmteToCand.get(recipCmte);
        if (!candId) continue;
        kind = 'DIRECT';
        recipientCandId = candId;
      } else if (tx === '24E') {
        // 24E — Super PAC IE supporting candidate. CAND_ID is in col 16.
        kind = 'IE_SUPPORT';
        recipientCandId = cols[16];
      } else if (tx === '24A') {
        kind = 'IE_OPPOSE';
        recipientCandId = cols[16];
      } else continue;
      cycleRows += 1;
      totalRows += 1;
      if (!recipientCandId) continue;
      const legId = candToLeg.get(recipientCandId);
      if (!legId) continue;
      const amount = Number(cols[14]) || 0;
      if (amount === 0) continue;
      const donor = cols[0];
      if (!donor) continue;
      if (!knownDonorSet.has(donor)) unknownDonor += 1;
      bump({ legislatorId: legId, donorCommitteeId: donor, cycleYear: cycle, kind }, amount);
      attributed += 1;
      cycleAttributed += 1;
    }
    console.log(
      `  cycle ${cycle}: ${cycleRows.toLocaleString()} rows · ${cycleAttributed.toLocaleString()} attributed`,
    );
  }

  console.log(
    `[ingest-fec-classified] total: ${totalRows.toLocaleString()} rows · ${attributed.toLocaleString()} attributed to federal legs`,
  );
  console.log(
    `[ingest-fec-classified] aggregated to ${aggregates.size.toLocaleString()} (leg, donor, cycle, kind) rows`,
  );
  console.log(
    `[ingest-fec-classified] ${unknownDonor.toLocaleString()} attributed transactions had donor not in PacClassification (will become UNKNOWN class)`,
  );

  if (flags.dryRun) {
    console.log('[ingest-fec-classified] DRY RUN — first 5 aggregates:');
    let i = 0;
    for (const a of aggregates.values()) {
      console.log(
        `  leg=${a.legislatorId} donor=${a.donorCommitteeId} cycle=${a.cycleYear} ${
          a.kind
        } $${a.amount.toLocaleString()}`,
      );
      if (++i >= 5) break;
    }
    await prisma.$disconnect();
    return;
  }

  // 5. Bulk upsert via raw SQL — 500 rows per statement
  const rows = [...aggregates.values()];

  // 5a. Make sure every donor referenced in our aggregates has a row in
  // PacClassification (otherwise the FK on PacContribution.donorCommitteeId
  // explodes). Donors not in our top-20K classification get a stub UNKNOWN
  // row. This honors the "no orphan contributions" invariant.
  const donorsInAggregates = new Set(rows.map((r) => r.donorCommitteeId));
  const missing: string[] = [];
  for (const id of donorsInAggregates) {
    if (!knownDonorSet.has(id)) missing.push(id);
  }
  if (missing.length > 0) {
    console.log(`[ingest-fec-classified] backfilling ${missing.length} stub UNKNOWN PacClassification rows…`);
    const BATCH_BACK = 500;
    for (let i = 0; i < missing.length; i += BATCH_BACK) {
      const slice = missing.slice(i, i + BATCH_BACK);
      const params: unknown[] = [];
      const values = slice
        .map((id, idx) => {
          params.push(id, '(unknown)', 'UNKNOWN', 'auto-stub');
          return `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}::"PacClass", $${idx * 4 + 4}, NOW(), NOW())`;
        })
        .join(',');
      const sql =
        `INSERT INTO "PacClassification" ` +
        `("committeeId", "name", "class", "source", "createdAt", "updatedAt") ` +
        `VALUES ${values} ` +
        `ON CONFLICT ("committeeId") DO NOTHING`;
      await prisma.$executeRawUnsafe(sql, ...params);
    }
  }

  // Clear existing rows for the cycles being ingested. Pre-v1.8.12 this was
  // an unconditional `DELETE FROM "PacContribution"` which wiped EVERY cycle
  // even when `--cycle=NNNN` was set — caused prior cycles to vanish on any
  // single-cycle re-ingest run. Now we scope to cycles being processed.
  // Also skip the IE_OPPOSE_BENEFICIARY rows (those are derived rows written
  // by attribute-ie-beneficiary.ts, not ingested here).
  const cyclesToProcess = flags.cycle !== null ? [flags.cycle] : CYCLE_DIRS.map((c) => c.cycle);
  console.log(`[ingest-fec-classified] clearing PacContribution rows for cycles: ${cyclesToProcess.join(', ')} (excluding IE_OPPOSE_BENEFICIARY)`);
  await prisma.$executeRawUnsafe(
    `DELETE FROM "PacContribution" WHERE "cycleYear" = ANY($1::int[]) AND kind <> 'IE_OPPOSE_BENEFICIARY'`,
    cyclesToProcess,
  );

  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const params: unknown[] = [];
    const values = slice
      .map((r, idx) => {
        const base = idx * 5;
        params.push(r.legislatorId, r.donorCommitteeId, r.cycleYear, r.kind, r.amount.toFixed(2));
        return `(gen_random_uuid()::text, $${base + 1}, $${base + 2}, $${base + 3}, $${
          base + 4
        }::"ContributionKind", $${base + 5}::numeric, NOW())`;
      })
      .join(',');
    const sql =
      `INSERT INTO "PacContribution" ` +
      `("id", "legislatorId", "donorCommitteeId", "cycleYear", "kind", "amount", "createdAt") ` +
      `VALUES ${values}`;
    await prisma.$executeRawUnsafe(sql, ...params);
    written += slice.length;
    if (written % 10000 === 0 || i + BATCH >= rows.length) {
      console.log(`  inserted ${written.toLocaleString()}/${rows.length.toLocaleString()}`);
    }
  }
  console.log(`[ingest-fec-classified] ✓ inserted ${written.toLocaleString()} PacContribution rows`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
