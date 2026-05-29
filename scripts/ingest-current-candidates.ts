// v1.8 — Ingest currently-filed federal candidates from the 2026 cycle.
//
// Why this exists:
//   The scorecard until now is retrospective — sitting members. To be useful
//   as a VOTING TOOL the platform also has to show who's actually running.
//   This pulls every 2026 H/S candidate from FEC cn26.txt (CAND_STATUS='C',
//   CAND_ELECTION_YR=2026), matches them to existing Legislator rows by FEC
//   id, and either updates currentCandidateCycle=2026 on existing rows
//   (sitting incumbents seeking re-election + defeated challengers running
//   again) or inserts new Legislator rows for fresh-this-cycle candidates
//   (isActive=false, currentCandidateCycle=2026).
//
//   The downstream /scorecard/candidates index and /scorecard/race/[seat]
//   pages read from this data.
//
// Source: data/fec-bulk-2026/cn26.txt (download via:
//   curl -sL -o data/fec-bulk-2026/cn26.zip https://www.fec.gov/files/bulk-downloads/2026/cn26.zip
//   then unzip and rename cn.txt → cn26.txt).
//
// Usage:
//   npm run scorecard:ingest-current-candidates
//   npm run scorecard:ingest-current-candidates -- --dry-run

import './load-env';
import fs from 'fs';
import path from 'path';
import { createId } from '@paralleldrive/cuid2';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const CYCLE = 2026;
const CN_PATH = path.join(process.cwd(), 'data', 'fec-bulk-2026', 'cn26.txt');

interface CliFlags {
  dryRun: boolean;
}
function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false };
  for (const a of argv.slice(2)) if (a === '--dry-run') flags.dryRun = true;
  return flags;
}

// Name parsing — same shape as ingest-defeated-challengers.ts. CAND_NAME is
// "LAST, FIRST [MIDDLE] [SUFFIX]".
function parseName(raw: string): { firstName: string; lastName: string; fullName: string } {
  const cleaned = raw.trim();
  const ci = cleaned.indexOf(',');
  if (ci === -1) return { firstName: '', lastName: cleaned, fullName: cleaned };
  const lastName = cleaned.slice(0, ci).trim();
  const rest = cleaned.slice(ci + 1).trim();
  const firstWord = rest.split(/\s+/)[0] ?? '';
  function title(s: string): string {
    return s
      .toLowerCase()
      .split(/(\s|-|'|\.)/)
      .map((part) => (part.length > 1 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
      .join('');
  }
  const fullName = `${title(rest)} ${title(lastName)}`.replace(/\s+/g, ' ').trim();
  return { firstName: title(firstWord), lastName: title(lastName), fullName };
}

function mapParty(raw: string): 'D' | 'R' | 'I' {
  const p = raw.toUpperCase();
  if (p === 'DEM' || p === 'D' || p === 'DFL') return 'D'; // DFL = Minnesota Democratic-Farmer-Labor
  if (p === 'REP' || p === 'R') return 'R';
  return 'I';
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-current-candidates] cycle=${CYCLE} flags=${JSON.stringify(flags)}`);

  if (!fs.existsSync(CN_PATH)) {
    console.error(`Missing ${CN_PATH}. Download cn26.zip from FEC bulk and extract cn.txt → cn26.txt.`);
    process.exit(1);
  }

  // 1. Existing legislators by FEC id (sitting + defeated challengers from
  // previous cycles). One FEC id may belong to one leg; one leg can have
  // multiple FEC ids (different cycles).
  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL' },
    select: { id: true, fecIds: true },
  });
  const byFec = new Map<string, string>(); // fecId → legId
  for (const l of legs) for (const f of l.fecIds ?? []) byFec.set(f, l.id);
  console.log(`[ingest-current-candidates] ${legs.length} existing federal legs, ${byFec.size} FEC ids indexed`);

  // 2. Read cn26.txt, filter to active H/S statutory candidates for 2026.
  const text = fs.readFileSync(CN_PATH, 'utf-8');
  interface CnRow {
    candId: string;
    name: string;
    party: 'D' | 'R' | 'I';
    state: string;
    office: 'H' | 'S';
    district: number | null;
  }
  const rows: CnRow[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const cols = line.split('|');
    if (cols.length < 9) continue;
    const office = cols[5];
    if (office !== 'H' && office !== 'S') continue;
    if (cols[3] !== '2026') continue; // CAND_ELECTION_YR
    if (cols[8] !== 'C') continue; // CAND_STATUS = statutory candidate
    rows.push({
      candId: cols[0],
      name: cols[1],
      party: mapParty(cols[2]),
      state: cols[4],
      office: office,
      district: office === 'S' ? null : parseInt(cols[6] || '0', 10) || null,
    });
  }
  console.log(`[ingest-current-candidates] ${rows.length} active 2026 H/S candidates in cn26.txt`);

  // 3. Partition: existing (update) vs new (insert).
  interface InsertRow extends CnRow {
    firstName: string;
    lastName: string;
    fullName: string;
  }
  const toUpdate: Array<{ legId: string; candId: string }> = [];
  const toInsert: InsertRow[] = [];
  for (const r of rows) {
    const existing = byFec.get(r.candId);
    if (existing) {
      toUpdate.push({ legId: existing, candId: r.candId });
    } else {
      const n = parseName(r.name);
      toInsert.push({ ...r, ...n });
    }
  }
  console.log(`[ingest-current-candidates] update existing: ${toUpdate.length}, insert new: ${toInsert.length}`);

  if (flags.dryRun) {
    console.log('\n[DRY RUN] sample of new candidates (first 15):');
    for (const r of toInsert.slice(0, 15)) {
      console.log(
        `  ${r.candId}  ${r.party}-${r.state}${r.district ? '-' + r.district : ''}  ${r.office}  ${r.fullName}`,
      );
    }
    await prisma.$disconnect();
    return;
  }

  // 4. Mark existing legs as running in 2026 (batched).
  const existingIds = [...new Set(toUpdate.map((u) => u.legId))];
  if (existingIds.length > 0) {
    await prisma.legislator.updateMany({
      where: { id: { in: existingIds } },
      data: { currentCandidateCycle: CYCLE },
    });
    console.log(`[ingest-current-candidates] ✓ marked ${existingIds.length} existing legs as running in ${CYCLE}`);
  }

  // 5. Insert new candidates.
  const BATCH = 200;
  let written = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const slice = toInsert.slice(i, i + BATCH);
    const params: unknown[] = [];
    const values = slice
      .map((row, idx) => {
        const base = idx * 10;
        params.push(
          createId(),
          row.firstName.slice(0, 100),
          row.lastName.slice(0, 100),
          row.fullName.slice(0, 200),
          row.office === 'S' ? 'SEN' : 'REP',
          row.state.slice(0, 2),
          row.district,
          row.party,
          row.candId,
          CYCLE,
        );
        return `($${base + 1}, 'FEDERAL'::"Jurisdiction", $${base + 2}, $${base + 3}, $${base + 4}, $${
          base + 5
        }::"Chamber", $${base + 6}, $${base + 7}, $${base + 8}::"Party", ARRAY[$${base + 9}]::text[], FALSE, $${
          base + 10
        }, NOW(), NOW())`;
      })
      .join(',');
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Legislator" ` +
        `("id", "jurisdiction", "firstName", "lastName", "fullName", "chamber", "state", "district", "party", "fecIds", "isActive", "currentCandidateCycle", "createdAt", "updatedAt") ` +
        `VALUES ${values} ` +
        `ON CONFLICT DO NOTHING`,
      ...params,
    );
    written += slice.length;
    if (written % 500 === 0 || i + BATCH >= toInsert.length) {
      console.log(`  inserted ${written}/${toInsert.length}`);
    }
  }
  console.log(`[ingest-current-candidates] ✓ inserted ${written} new candidates`);

  // 6. Summary
  const counts = await prisma.$queryRaw<Array<{ chamber: string; party: string; n: string }>>`
    SELECT chamber::text, party::text, COUNT(*)::text AS n
    FROM "Legislator"
    WHERE "currentCandidateCycle" = ${CYCLE} AND jurisdiction = 'FEDERAL'
    GROUP BY chamber, party
    ORDER BY chamber, party
  `;
  console.log(`\n[ingest-current-candidates] ${CYCLE} candidate roster by chamber × party:`);
  for (const r of counts) console.log(`  ${r.chamber} ${r.party}  ${r.n}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
