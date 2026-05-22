// v1.7.2 — Ingest federal House/Senate candidates who received IE money
// from a classified PAC but never made it onto our sitting-legislator
// roster (lost their primary, lost the general, or are former members
// from earlier cycles).
//
// Why this exists:
//   Per-PAC scoreboards (e.g. /scorecard/pac/aipac) currently undercount
//   IE spending by 30-60% because IE for/against primary challengers who
//   lost (Bowman 2024, Cori Bush 2024, Andy Levin 2022, Donna Edwards 2022)
//   drops out of our aggregates — they don't exist as Legislator rows.
//
//   This script adds them as Legislator rows with isActive=false. The main
//   /scorecard index page filters to isActive=true so they don't pollute
//   the live ranking, but the per-PAC scoreboards (no isActive filter) will
//   pick them up immediately, closing the AIPAC/UDP-style undercount.
//
// Scope:
//   - Federal House (H prefix) + Senate (S prefix) candidates only.
//   - Skips Presidential candidates (P prefix) — out of scope for a
//     congressional scorecard, and the Chamber enum has no PRES value.
//   - Only candidates with NON-ZERO 24E or 24A IE spend across 2018-2024.
//     (Filtering to "received PAC IE" focuses on candidates worth tracking
//     and skips the 6K+ minor-party candidates with no IE money.)
//   - Skips candidates whose CAND_ID is already in any Legislator.fecIds
//     (sitting members are already there).
//
// Output: new Legislator rows with isActive=false.
// After this runs, re-run `scorecard:ingest-fec-classified` to populate
// PacContribution for the new legislators.
//
// Usage:
//   npm run scorecard:ingest-defeated-challengers
//   npm run scorecard:ingest-defeated-challengers -- --dry-run

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

interface CliFlags {
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
  }
  return flags;
}

// cn{YY}.txt columns (pipe-delimited):
//   0  CAND_ID
//   1  CAND_NAME            ("LAST, FIRST" format)
//   2  CAND_PTY_AFFILIATION (DEM, REP, IND, LIB, GRE, etc.)
//   3  CAND_ELECTION_YR
//   4  CAND_OFFICE_STATE
//   5  CAND_OFFICE          (H/S/P)
//   6  CAND_OFFICE_DISTRICT
//   7  CAND_ICI             (I=Incumbent, C=Challenger, O=Open seat)
//   8  CAND_STATUS          (C=statutory cand, F=future, N=not yet, P=prior)
interface CnEntry {
  candId: string;
  name: string;
  party: string;
  electionYear: number;
  state: string;
  office: string;
  district: string;
  status: string;
}

// Build an index of every candidate across all 4 cycles. Most-recent cycle
// wins on collision (a candidate who ran in 2018 and again in 2024 gets
// their 2024 metadata — most accurate, since party / district can change).
function loadCnIndex(): Map<string, CnEntry> {
  const idx = new Map<string, CnEntry>();
  // Iterate oldest → newest so newest overwrites
  for (const cycle of CYCLES) {
    const yy = String(cycle).slice(2);
    const filePath = path.join(FEC_BULK_BASE, `fec-bulk-${cycle}`, `cn${yy}.txt`);
    if (!fs.existsSync(filePath)) {
      console.warn(`  [warn] cn${yy}.txt missing for cycle ${cycle}`);
      continue;
    }
    const text = fs.readFileSync(filePath, 'utf-8');
    let n = 0;
    for (const line of text.split('\n')) {
      if (!line) continue;
      const cols = line.split('|');
      if (cols.length < 9) continue;
      idx.set(cols[0], {
        candId: cols[0],
        name: cols[1] ?? '',
        party: cols[2] ?? '',
        electionYear: Number(cols[3]) || cycle,
        state: cols[4] ?? '',
        office: cols[5] ?? '',
        district: cols[6] ?? '',
        status: cols[8] ?? '',
      });
      n += 1;
    }
    console.log(`  cycle ${cycle}: indexed ${n.toLocaleString()} candidates`);
  }
  return idx;
}

// Collect unique candidate IDs that received 24E (IE for) or 24A (IE against)
// across all 4 cycles' itpas2.txt files. These are the "needs ingesting" set.
function collectIeTargetCandidateIds(): Map<string, { support: number; oppose: number; cycles: Set<number> }> {
  const out = new Map<string, { support: number; oppose: number; cycles: Set<number> }>();
  for (const cycle of CYCLES) {
    const filePath = path.join(FEC_BULK_BASE, `fec-bulk-${cycle}`, 'itpas2.txt');
    if (!fs.existsSync(filePath)) {
      console.warn(`  [warn] itpas2.txt missing for cycle ${cycle}`);
      continue;
    }
    const text = fs.readFileSync(filePath, 'utf-8');
    let n = 0;
    for (const line of text.split('\n')) {
      if (!line) continue;
      const cols = line.split('|');
      if (cols.length < 17) continue;
      const tx = cols[5];
      if (tx !== '24E' && tx !== '24A') continue;
      const candId = cols[16];
      if (!candId) continue;
      const amt = Number(cols[14]) || 0;
      const cur = out.get(candId) ?? { support: 0, oppose: 0, cycles: new Set<number>() };
      if (tx === '24E') cur.support += amt;
      else cur.oppose += amt;
      cur.cycles.add(cycle);
      out.set(candId, cur);
      n += 1;
    }
    console.log(`  cycle ${cycle}: ${n.toLocaleString()} IE transactions scanned`);
  }
  return out;
}

// Parse a CAND_NAME like "BOWMAN, JAMAAL" into firstName + lastName + fullName.
// Edge cases: middle initials ("CRUZ, TED HENRY"), suffixes ("HARRIS, KAMALA D"),
// missing comma ("JOHN SMITH" — rare; fall back to single-word last name).
function parseName(raw: string): { firstName: string; lastName: string; fullName: string } {
  const cleaned = raw.trim();
  const commaIdx = cleaned.indexOf(',');
  if (commaIdx === -1) {
    // No comma — treat the whole thing as last name
    return { firstName: '', lastName: cleaned, fullName: cleaned };
  }
  const lastName = cleaned.slice(0, commaIdx).trim();
  const rest = cleaned.slice(commaIdx + 1).trim();
  // First word of rest = firstName; anything after = middle / suffix
  const firstWord = rest.split(/\s+/)[0] ?? '';
  // Display "FIRST LAST" in Title Case
  function title(s: string): string {
    return s
      .toLowerCase()
      .split(/(\s|-|'|\.)/)
      .map((part) => (part.length > 1 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
      .join('');
  }
  const fullName = `${title(rest)} ${title(lastName)}`.replace(/\s+/g, ' ').trim();
  return {
    firstName: title(firstWord),
    lastName: title(lastName),
    fullName,
  };
}

// FEC party codes → our Party enum (D / R / I).
function mapParty(raw: string): 'D' | 'R' | 'I' {
  const p = raw.toUpperCase();
  if (p === 'DEM' || p === 'D') return 'D';
  if (p === 'REP' || p === 'R') return 'R';
  // Everything else (IND, LIB, GRE, CON, NPA, etc.) → Independent.
  // The scorecard's three-bucket Party enum doesn't support minor parties.
  return 'I';
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-defeated-challengers] flags: ${JSON.stringify(flags)}`);

  // 1. Build known-FEC-id set from existing sitting legislators
  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL' },
    select: { fecIds: true },
  });
  const knownFecIds = new Set<string>();
  for (const l of legs) for (const f of l.fecIds) knownFecIds.add(f);
  console.log(`[ingest-defeated-challengers] ${knownFecIds.size} FEC ids already in Legislator`);

  // 2. Find IE-target candidate IDs across 4 cycles
  console.log('\n[ingest-defeated-challengers] scanning IE targets across 4 cycles…');
  const targets = collectIeTargetCandidateIds();
  const unmatched = new Map<string, { support: number; oppose: number; cycles: Set<number> }>();
  for (const [id, v] of targets) {
    if (!knownFecIds.has(id)) unmatched.set(id, v);
  }
  console.log(`[ingest-defeated-challengers] ${targets.size} unique IE targets total, ${unmatched.size} unmatched`);

  // 3. Build cn index
  console.log('\n[ingest-defeated-challengers] loading cn*.txt index…');
  const cn = loadCnIndex();
  console.log(`[ingest-defeated-challengers] ${cn.size} unique candidate records`);

  // 4. For each unmatched IE target, look up metadata and filter
  interface InsertRow {
    candId: string;
    firstName: string;
    lastName: string;
    fullName: string;
    party: 'D' | 'R' | 'I';
    state: string;
    chamber: 'SEN' | 'REP';
    district: number | null;
    iesup: number;
    ieopp: number;
  }
  const toInsert: InsertRow[] = [];
  let skippedPres = 0;
  let skippedNoMeta = 0;
  let skippedNoOffice = 0;
  for (const [candId, ie] of unmatched) {
    // Quick prefix check — H / S / P are first letter of CAND_ID per FEC convention.
    if (candId.startsWith('P')) {
      skippedPres += 1;
      continue;
    }
    const meta = cn.get(candId);
    if (!meta) {
      skippedNoMeta += 1;
      continue;
    }
    if (meta.office !== 'H' && meta.office !== 'S') {
      skippedNoOffice += 1;
      continue;
    }
    const { firstName, lastName, fullName } = parseName(meta.name);
    const district = meta.office === 'S' ? null : parseInt(meta.district || '0', 10) || null;
    toInsert.push({
      candId,
      firstName,
      lastName,
      fullName,
      party: mapParty(meta.party),
      state: meta.state,
      chamber: meta.office === 'S' ? 'SEN' : 'REP',
      district,
      iesup: ie.support,
      ieopp: ie.oppose,
    });
  }
  console.log(
    `[ingest-defeated-challengers] queued: ${toInsert.length}, skipped presidential: ${skippedPres}, no cn metadata: ${skippedNoMeta}, non-H/S office: ${skippedNoOffice}`,
  );

  // Total $ for the new universe
  const totalSupAll = toInsert.reduce((s, r) => s + r.iesup, 0);
  const totalOppAll = toInsert.reduce((s, r) => s + r.ieopp, 0);
  console.log(
    `[ingest-defeated-challengers] IE attached to these candidates: support=$${Math.round(
      totalSupAll,
    ).toLocaleString()}  oppose=$${Math.round(totalOppAll).toLocaleString()}`,
  );

  if (flags.dryRun) {
    console.log('\n[DRY RUN] top 20 by total IE (would insert):');
    const sorted = [...toInsert].sort((a, b) => b.iesup + b.ieopp - (a.iesup + a.ieopp));
    for (const r of sorted.slice(0, 20)) {
      console.log(
        `  ${r.candId}  ${r.party}-${r.state}${r.district ? `-${r.district}` : ''}  ${r.chamber}  ${r.fullName.padEnd(
          30,
        )}  IE: sup=$${Math.round(r.iesup).toLocaleString()} opp=$${Math.round(r.ieopp).toLocaleString()}`,
      );
    }
    await prisma.$disconnect();
    return;
  }

  // 5. Bulk-insert Legislator rows.
  // Use raw SQL since cuid() default doesn't fire via $executeRawUnsafe.
  // Insert in 200-row chunks, ON CONFLICT (fecIds @> ARRAY[candId]) DO NOTHING.
  // Postgres can't ON CONFLICT on array membership, so we use a single-id
  // lookup pattern instead: each insert just uses an explicit cuid + the
  // candId in the fecIds array. The uniqueness invariant (one row per
  // candidate) is enforced by the pre-filter — knownFecIds + unmatched set.
  console.log('\n[ingest-defeated-challengers] inserting Legislator rows…');
  const BATCH = 200;
  let written = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const slice = toInsert.slice(i, i + BATCH);
    const params: unknown[] = [];
    const values = slice
      .map((row, idx) => {
        const base = idx * 9;
        params.push(
          createId(),
          row.firstName.slice(0, 100),
          row.lastName.slice(0, 100),
          row.fullName.slice(0, 200),
          row.chamber,
          row.state.slice(0, 2),
          row.district,
          row.party,
          row.candId,
        );
        return `($${base + 1}, 'FEDERAL'::"Jurisdiction", $${base + 2}, $${base + 3}, $${base + 4}, $${
          base + 5
        }::"Chamber", $${base + 6}, $${base + 7}, $${base + 8}::"Party", ARRAY[$${
          base + 9
        }]::text[], FALSE, NOW(), NOW())`;
      })
      .join(',');
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Legislator" ` +
        `("id", "jurisdiction", "firstName", "lastName", "fullName", "chamber", "state", "district", "party", "fecIds", "isActive", "createdAt", "updatedAt") ` +
        `VALUES ${values} ` +
        // We could check (fecIds && ARRAY[...]) but the pre-filter handles
        // uniqueness; ON CONFLICT DO NOTHING gives a safety net if a leg
        // sharing a bioguide somehow lands twice.
        `ON CONFLICT DO NOTHING`,
      ...params,
    );
    written += slice.length;
    if (written % 1000 === 0 || i + BATCH >= toInsert.length) {
      console.log(`  inserted ${written}/${toInsert.length}`);
    }
  }
  console.log(`[ingest-defeated-challengers] ✓ inserted ${written} Legislator rows (isActive=false)`);

  // 6. Sanity check
  const final = await prisma.legislator.count({ where: { jurisdiction: 'FEDERAL' } });
  const active = await prisma.legislator.count({ where: { jurisdiction: 'FEDERAL', isActive: true } });
  console.log(
    `\n[ingest-defeated-challengers] Total federal Legislator rows: ${final} (active=${active}, inactive=${
      final - active
    })`,
  );
  console.log(
    '\nNext step: re-run `scorecard:ingest-fec-classified` to populate PacContribution for the new legislators.',
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
