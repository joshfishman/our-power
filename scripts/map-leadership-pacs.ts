// v1.7.2 — map leadership PACs to their sponsor legislators AND ingest
// inbound contributions to those leadership PACs.
//
// Why this exists:
//   Many federal legislators sponsor a "leadership PAC" — a legally separate
//   committee that collects PAC + individual money and then redistributes
//   to other candidates. Corporate PACs prefer these because contribution
//   limits are looser. The dollars don't show up in the sponsor's PAC Score
//   (it's not their campaign money), but they ARE an influence-flow signal
//   worth surfacing on the legislator detail page.
//
// What this does:
//   1. Read ccl.txt (FEC's Candidate-Committee Linkage file) for 4 cycles.
//      Filter to CMTE_DSGN='D' (Leadership PAC) rows. Map CAND_ID to a
//      Legislator via Legislator.fecIds. Yields ~30 mappings.
//   2. Read data/leadership-pacs-manual.csv (human-curated mapping for the
//      well-known leadership PACs whose linkage isn't in ccl). Maps by
//      bioguide_id to a Legislator. Yields another ~20-30 mappings as it
//      grows.
//   3. UPDATE PacClassification.affiliatedLegislatorId for each matched
//      leadership PAC. Backfill stub PacClassification rows if missing
//      (so the FK on LeadershipPacInflow holds).
//   4. Parse itpas2.txt for each cycle, summing inbound CONTRIBUTIONS to
//      each leadership PAC keyed by (leadership PAC, donor, cycle).
//      Upsert LeadershipPacInflow rows.
//
// Data sources documented:
//   - ccl.txt: https://www.fec.gov/files/bulk-downloads/{cycle}/ccl{YY}.zip
//   - cm.txt:  https://www.fec.gov/files/bulk-downloads/{cycle}/cm{YY}.zip
//   - itpas2:  https://www.fec.gov/files/bulk-downloads/{cycle}/pas2{YY}.zip
//
// Usage:
//   npm run scorecard:map-leadership-pacs                  # full run
//   npm run scorecard:map-leadership-pacs -- --dry-run     # parse, don't write
//   npm run scorecard:map-leadership-pacs -- --skip-inflows # mapping only

import './load-env';
import fs from 'fs';
import path from 'path';
import { createId } from '@paralleldrive/cuid2';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const CYCLES = [2018, 2020, 2022, 2024];
const FEC_BULK_BASE = path.join(process.cwd(), 'data');
const CCL_BASE = path.join(FEC_BULK_BASE, 'fec-bulk-ccl');
const MANUAL_CSV = path.join(FEC_BULK_BASE, 'leadership-pacs-manual.csv');

interface CliFlags {
  dryRun: boolean;
  skipInflows: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false, skipInflows: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--skip-inflows') flags.skipInflows = true;
  }
  return flags;
}

// ccl.txt columns:
//   0 CAND_ID, 1 CAND_ELECTION_YR, 2 FEC_ELECTION_YR, 3 CMTE_ID,
//   4 CMTE_TP, 5 CMTE_DSGN, 6 LINKAGE_ID
interface CclRow {
  candId: string;
  cmteId: string;
  designation: string;
}

function loadCclLeadershipLinkages(): CclRow[] {
  const rows: CclRow[] = [];
  for (const cycle of CYCLES) {
    const filePath = path.join(CCL_BASE, `ccl${cycle}.txt`);
    if (!fs.existsSync(filePath)) {
      console.warn(`  [warn] no ccl file for cycle ${cycle} at ${filePath}`);
      continue;
    }
    const text = fs.readFileSync(filePath, 'utf-8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const cols = line.split('|');
      if (cols.length < 7) continue;
      if (cols[5] !== 'D') continue;
      rows.push({ candId: cols[0], cmteId: cols[3], designation: cols[5] });
    }
  }
  return rows;
}

interface ManualRow {
  cmteId: string;
  bioguideId: string;
  name: string;
}

function loadManualMappings(): ManualRow[] {
  if (!fs.existsSync(MANUAL_CSV)) return [];
  const text = fs.readFileSync(MANUAL_CSV, 'utf-8');
  const lines = text.split('\n');
  const out: ManualRow[] = [];
  let pastHeader = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!pastHeader) {
      // The first non-comment, non-empty line is the header.
      pastHeader = true;
      continue;
    }
    const cols = trimmed.split(',');
    if (cols.length < 3) continue;
    out.push({ cmteId: cols[0].trim(), bioguideId: cols[1].trim(), name: cols[2].trim() });
  }
  return out;
}

// itpas2.txt columns (pipe-delimited):
//   0 CMTE_ID (recipient committee for 24K/22Y)
//   5 TRANSACTION_TP
//   14 TRANSACTION_AMT (string)
//   15 OTHER_ID (donor for 22Y/24K)
//
// We count 24K (direct PAC contribution to recipient) and 22Y (PAC-to-PAC
// transfer to recipient). Both are real inflows to the leadership PAC.
function parseInflowsToLeadershipPacs(leadershipPacIds: Set<string>, cycle: number): Map<string, number> {
  const out = new Map<string, number>();
  const filePath = path.join(FEC_BULK_BASE, `fec-bulk-${cycle}`, 'itpas2.txt');
  if (!fs.existsSync(filePath)) {
    console.warn(`  [warn] no itpas2.txt for cycle ${cycle} at ${filePath}`);
    return out;
  }
  const text = fs.readFileSync(filePath, 'utf-8');
  let scanned = 0;
  let matched = 0;
  for (const line of text.split('\n')) {
    if (!line) continue;
    scanned += 1;
    const cols = line.split('|');
    if (cols.length < 17) continue;
    const recipient = cols[0];
    const tx = cols[5];
    if (tx !== '24K' && tx !== '22Y') continue;
    if (!leadershipPacIds.has(recipient)) continue;
    const donor = cols[15];
    if (!donor) continue;
    const amt = Number(cols[14]) || 0;
    if (amt === 0) continue;
    const key = `${recipient}|${donor}`;
    out.set(key, (out.get(key) ?? 0) + amt);
    matched += 1;
  }
  console.log(`  cycle ${cycle}: scanned ${scanned.toLocaleString()} rows, ${matched.toLocaleString()} hits`);
  return out;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[map-leadership-pacs] flags: ${JSON.stringify(flags)}`);

  // 1. Build candidate-FEC-ID → legislator and bioguide → legislator maps.
  const legs = await prisma.legislator.findMany({
    where: { isActive: true, jurisdiction: 'FEDERAL' },
    select: { id: true, fullName: true, fecIds: true, bioguideId: true },
  });
  const byFecId = new Map<string, { legId: string; fullName: string }>();
  const byBioguide = new Map<string, { legId: string; fullName: string }>();
  for (const l of legs) {
    for (const f of l.fecIds ?? []) byFecId.set(f, { legId: l.id, fullName: l.fullName });
    if (l.bioguideId) byBioguide.set(l.bioguideId, { legId: l.id, fullName: l.fullName });
  }
  console.log(`[map-leadership-pacs] ${legs.length} federal legislators, ${byFecId.size} FEC IDs`);

  // 2. Apply ccl + manual mappings
  const cclRows = loadCclLeadershipLinkages();
  console.log(`[map-leadership-pacs] ccl: ${cclRows.length} D-designation linkages (4 cycles, deduped below)`);
  interface Mapping {
    cmteId: string;
    legId: string;
    fullName: string;
    source: 'ccl' | 'manual';
  }
  const mappingsByCmte = new Map<string, Mapping>();
  for (const r of cclRows) {
    const m = byFecId.get(r.candId);
    if (!m) continue;
    if (!mappingsByCmte.has(r.cmteId)) {
      mappingsByCmte.set(r.cmteId, { cmteId: r.cmteId, legId: m.legId, fullName: m.fullName, source: 'ccl' });
    }
  }
  console.log(`[map-leadership-pacs] from ccl: ${mappingsByCmte.size} unique leadership PACs mapped`);

  const manualRows = loadManualMappings();
  console.log(`[map-leadership-pacs] manual CSV: ${manualRows.length} rows`);
  let manualMatched = 0;
  let manualMissedBioguide = 0;
  for (const r of manualRows) {
    const m = byBioguide.get(r.bioguideId);
    if (!m) {
      manualMissedBioguide += 1;
      console.warn(`  [warn] manual row bioguide=${r.bioguideId} (${r.name}) — no Legislator with that bioguide`);
      continue;
    }
    if (mappingsByCmte.has(r.cmteId)) continue; // ccl wins
    mappingsByCmte.set(r.cmteId, { cmteId: r.cmteId, legId: m.legId, fullName: m.fullName, source: 'manual' });
    manualMatched += 1;
  }
  console.log(`[map-leadership-pacs] from manual: ${manualMatched} added, ${manualMissedBioguide} unmatched bioguide`);
  console.log(`[map-leadership-pacs] total unique mappings: ${mappingsByCmte.size}`);

  // 3. Ensure each mapped PAC has a PacClassification row (FK invariant
  // for LeadershipPacInflow); backfill LEADERSHIP-class stubs for any missing.
  const allCmteIds = new Set(mappingsByCmte.keys());
  const existing = await prisma.pacClassification.findMany({
    where: { committeeId: { in: [...allCmteIds] } },
    select: { committeeId: true, name: true, class: true },
  });
  const existingIds = new Set(existing.map((r) => r.committeeId));
  const missing = [...allCmteIds].filter((id) => !existingIds.has(id));
  console.log(`[map-leadership-pacs] ${existingIds.size}/${allCmteIds.size} mapped PACs already in PacClassification`);
  if (missing.length > 0) {
    // Use manual CSV name where available; fall back to committee_id.
    const manualNames = new Map(manualRows.map((r) => [r.cmteId, r.name]));
    if (flags.dryRun) {
      console.log(`  [DRY RUN] would backfill ${missing.length} LEADERSHIP stubs`);
    } else {
      for (const id of missing) {
        await prisma.pacClassification.create({
          data: {
            committeeId: id,
            name: (manualNames.get(id) ?? id).slice(0, 200),
            class: 'LEADERSHIP',
            reason: 'auto:leadership-pac-mapping',
            source: 'auto',
          },
        });
      }
      console.log(`  backfilled ${missing.length} LEADERSHIP stubs`);
    }
  }

  // 4. Write affiliatedLegislatorId
  if (flags.dryRun) {
    console.log('[DRY RUN] mappings (first 30):');
    for (const m of [...mappingsByCmte.values()].slice(0, 30)) {
      console.log(`  [${m.source}] ${m.cmteId}  →  ${m.fullName.padEnd(28)}  (legId=${m.legId})`);
    }
  } else {
    let written = 0;
    for (const m of mappingsByCmte.values()) {
      await prisma.pacClassification.update({
        where: { committeeId: m.cmteId },
        data: { affiliatedLegislatorId: m.legId },
      });
      written += 1;
    }
    console.log(`[map-leadership-pacs] ✓ set affiliatedLegislatorId on ${written} PACs`);
  }

  if (flags.skipInflows) {
    console.log('[map-leadership-pacs] --skip-inflows; done.');
    await prisma.$disconnect();
    return;
  }

  // 5. Parse itpas2.txt for each cycle, accumulate inbound to the mapped
  // leadership PACs. We do this per-cycle to preserve cycle attribution.
  console.log('\n[map-leadership-pacs] parsing itpas2.txt for leadership-PAC inflows…');
  interface InflowAgg {
    leadershipPacId: string;
    donorCommitteeId: string;
    cycleYear: number;
    amount: number;
  }
  const inflows: InflowAgg[] = [];
  for (const cycle of CYCLES) {
    const cycleMap = parseInflowsToLeadershipPacs(allCmteIds, cycle);
    for (const [key, amt] of cycleMap) {
      const [lpacId, donor] = key.split('|');
      inflows.push({ leadershipPacId: lpacId, donorCommitteeId: donor, cycleYear: cycle, amount: amt });
    }
  }
  console.log(`[map-leadership-pacs] ${inflows.length} (lpac, donor, cycle) aggregates`);

  // FK: ensure all donor committees exist in PacClassification. Backfill UNKNOWN stubs.
  const donors = new Set(inflows.map((i) => i.donorCommitteeId));
  const knownDonors = await prisma.pacClassification.findMany({
    where: { committeeId: { in: [...donors] } },
    select: { committeeId: true },
  });
  const knownDonorIds = new Set(knownDonors.map((r) => r.committeeId));
  const missingDonors = [...donors].filter((d) => !knownDonorIds.has(d));
  if (missingDonors.length > 0) {
    console.log(`  backfilling ${missingDonors.length} UNKNOWN donor stubs`);
    if (!flags.dryRun) {
      const BATCH = 500;
      for (let i = 0; i < missingDonors.length; i += BATCH) {
        const slice = missingDonors.slice(i, i + BATCH);
        const params: unknown[] = [];
        const values = slice
          .map((d, idx) => {
            const base = idx * 2;
            params.push(d, d);
            return `($${base + 1}, $${
              base + 2
            }, 'UNKNOWN'::"PacClass", 'auto:leadership-inflow-backfill', 'auto', NOW(), NOW())`;
          })
          .join(',');
        await prisma.$executeRawUnsafe(
          `INSERT INTO "PacClassification" ("committeeId", "name", "class", "reason", "source", "createdAt", "updatedAt") ` +
            `VALUES ${values} ON CONFLICT ("committeeId") DO NOTHING`,
          ...params,
        );
      }
    }
  }

  if (flags.dryRun) {
    const byLpac = new Map<string, number>();
    for (const i of inflows) byLpac.set(i.leadershipPacId, (byLpac.get(i.leadershipPacId) ?? 0) + i.amount);
    const top = [...byLpac.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log('  [DRY RUN] top 10 leadership PACs by inbound $:');
    for (const [id, amt] of top) {
      const mapping = mappingsByCmte.get(id);
      console.log(`    ${id}  ${mapping?.fullName ?? '?'}  $${amt.toLocaleString()}`);
    }
    await prisma.$disconnect();
    return;
  }

  // 6. Bulk upsert LeadershipPacInflow.
  console.log('[map-leadership-pacs] writing LeadershipPacInflow rows…');
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < inflows.length; i += BATCH) {
    const slice = inflows.slice(i, i + BATCH);
    const params: unknown[] = [];
    const values = slice
      .map((row, idx) => {
        const base = idx * 5;
        // cuid() default is a Prisma-layer generator and is bypassed by raw
        // SQL — generate IDs explicitly in JS.
        params.push(createId(), row.leadershipPacId, row.donorCommitteeId, row.cycleYear, row.amount);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::numeric, NOW())`;
      })
      .join(',');
    await prisma.$executeRawUnsafe(
      `INSERT INTO "LeadershipPacInflow" ("id", "leadershipPacId", "donorCommitteeId", "cycleYear", "amount", "createdAt") ` +
        `VALUES ${values} ` +
        `ON CONFLICT ("leadershipPacId", "donorCommitteeId", "cycleYear") DO UPDATE SET "amount" = EXCLUDED."amount"`,
      ...params,
    );
    written += slice.length;
    if (written % 5000 === 0 || i + BATCH >= inflows.length) {
      console.log(`  upserted ${written}/${inflows.length}`);
    }
  }
  console.log(`[map-leadership-pacs] ✓ wrote ${written} LeadershipPacInflow rows`);

  // Summary
  const summary = await prisma.$queryRaw<Array<{ fullName: string; total: string; counted: string }>>`
    SELECT l."fullName" AS "fullName",
           SUM(lpi.amount::numeric)::text AS total,
           SUM(CASE WHEN pc.class IN ('CORPORATE','DARK_MONEY','FOREIGN_POLICY')
                    THEN lpi.amount::numeric ELSE 0 END)::text AS counted
    FROM "LeadershipPacInflow" lpi
    JOIN "PacClassification" lpac ON lpac."committeeId" = lpi."leadershipPacId"
    JOIN "Legislator" l ON l.id = lpac."affiliatedLegislatorId"
    JOIN "PacClassification" pc ON pc."committeeId" = lpi."donorCommitteeId"
    GROUP BY l."fullName"
    ORDER BY counted DESC NULLS LAST
    LIMIT 15
  `;
  console.log('\n[map-leadership-pacs] Top 15 legislators by classified leadership-PAC inflows:');
  for (const r of summary) {
    console.log(
      `  ${r.fullName.padEnd(30)} all=$${Number(r.total).toLocaleString().padStart(12)}  counted=$${Number(r.counted)
        .toLocaleString()
        .padStart(12)}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
