// scripts/backfill-legiscan-people.ts
//
// One-time (idempotent) backfill of Legislator.legiscanPeopleId from
// LegiScan's people/ JSON files. Without this, the sync can only
// resolve sponsors by name match — voters on roll calls have only a
// people_id (no name), so any voter who isn't also a sponsor falls
// through to name-match-against-empty-string and gets dropped as
// unmapped.
//
// Run once after seeding legislators (and again whenever new
// legislators are added). Reads from LEGISCAN_DATASET_DIR by default;
// pass --opensecrets-style or --dir=<path> to override.
//
// Usage:
//   npm run scorecard:backfill-people                # both jurisdictions
//   npm run scorecard:backfill-people -- --jurisdiction=CA
//   npm run scorecard:backfill-people -- --dry-run

import './load-env';

import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

interface CliFlags {
  datasetDir: string;
  jurisdiction: 'FEDERAL' | 'CA' | 'BOTH';
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    datasetDir: process.env.LEGISCAN_DATASET_DIR ?? '',
    jurisdiction: 'BOTH',
    dryRun: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--dir=')) flags.datasetDir = arg.split('=')[1];
    else if (arg.startsWith('--jurisdiction=')) {
      const v = arg.split('=')[1].toUpperCase();
      if (v === 'FEDERAL' || v === 'CA' || v === 'BOTH') flags.jurisdiction = v as CliFlags['jurisdiction'];
    }
  }
  return flags;
}

interface LegiscanPerson {
  people_id: number;
  name: string;
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  suffix?: string;
  nickname?: string;
  party?: string;
  role?: string;
  state?: string;
  district?: string;
}

interface PersonRecord {
  peopleId: number;
  fullName: string;
  firstName: string;
  lastName: string;
  state: string;
  jurisdiction: 'FEDERAL' | 'CA';
}

function jurisdictionForState(state: string): 'FEDERAL' | 'CA' | null {
  if (state === 'US') return 'FEDERAL';
  if (state === 'CA') return 'CA';
  return null;
}

async function readAllPeople(datasetDir: string): Promise<PersonRecord[]> {
  const records: PersonRecord[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.')) continue;
        await walk(full);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      // Only descend into people/ folders to keep this fast.
      // (bill/ and vote/ folders also have JSON; we skip them.)
      if (!full.includes(`${path.sep}people${path.sep}`)) continue;
      let parsed;
      try {
        parsed = JSON.parse(await fs.readFile(full, 'utf-8'));
      } catch {
        continue;
      }
      const inner = (parsed?.person ?? parsed) as LegiscanPerson;
      if (typeof inner?.people_id !== 'number') continue;
      // LegiScan stores state as numeric state_id, not the 2-letter alpha
      // code. Derive jurisdiction from the file path (federal data lives
      // under data/US/..., CA under data/<session>/...). For federal
      // records, parse the actual state abbrev out of `district` like
      // "HD-AR-1" (House district AR-1) so per-state bucketing works.
      const j: 'FEDERAL' | 'CA' = full.includes(`${path.sep}US${path.sep}`) ? 'FEDERAL' : 'CA';
      let stateAbbrev: string;
      if (j === 'CA') {
        stateAbbrev = 'CA';
      } else {
        const districtMatch = /^(HD|SD)-([A-Z]{2})-/.exec(inner.district ?? '');
        if (!districtMatch) continue;
        stateAbbrev = districtMatch[2];
      }
      records.push({
        peopleId: inner.people_id,
        fullName: inner.name ?? '',
        firstName: inner.first_name ?? '',
        lastName: inner.last_name ?? '',
        state: stateAbbrev,
        jurisdiction: j,
      });
    }
  }
  await walk(datasetDir);
  return records;
}

/** Tokens that appear inside compound names but carry no identifying weight. */
const NAME_FILLERS = new Set(['y', 'de', 'la', 'el', 'del', 'van', 'von', 'di', 'da']);

/**
 * Normalize a name for fuzzy comparison: strip diacritics (Pérez → perez),
 * lowercase, strip punctuation (including hyphens → space), drop common
 * suffixes (Jr/Sr/II/III/IV). Without diacritic stripping, ~7 CA legislators
 * with accented surnames never match; without hyphen handling, compound
 * Spanish/married names like "Quirk-Silva" and "Ortega-Toro" don't match.
 */
function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,'`"-]/g, ' ')
    .replace(/\bjr\b|\bsr\b|\bii\b|\biii\b|\biv\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Drop the middle name/initial: "Robert F Bonta" → "robert bonta". */
function firstAndLast(first: string, last: string): string {
  return normalizeName(`${first} ${last}`);
}

/**
 * Token-overlap last-name match. Returns true if any identifying token of
 * one normalized last name appears in the other. Handles compound surnames
 * ("Martinez Valladares" ↔ "Valladares") and splitName artifacts ("Maria
 * Elena Durazo" → DB lastName "Elena Durazo" ↔ LegiScan "Durazo").
 */
function lastNameTokensOverlap(a: string, b: string): boolean {
  const tokensA = normalizeName(a)
    .split(' ')
    .filter((t) => t.length >= 3 && !NAME_FILLERS.has(t));
  const tokensB = new Set(
    normalizeName(b)
      .split(' ')
      .filter((t) => t.length >= 3 && !NAME_FILLERS.has(t)),
  );
  if (tokensA.length === 0 || tokensB.size === 0) return false;
  return tokensA.some((t) => tokensB.has(t));
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  if (!flags.datasetDir) {
    console.error('No dataset dir. Set LEGISCAN_DATASET_DIR in .env.local or pass --dir=/path/to/legiscan-data');
    process.exit(1);
  }
  console.log(`[backfill-people] dataset: ${flags.datasetDir}`);

  const people = await readAllPeople(flags.datasetDir);
  console.log(`[backfill-people] indexed ${people.length} person record(s) from dataset`);

  const where = flags.jurisdiction !== 'BOTH' ? { jurisdiction: flags.jurisdiction } : {};
  const legislators = await prisma.legislator.findMany({
    where,
    select: {
      id: true,
      jurisdiction: true,
      fullName: true,
      firstName: true,
      lastName: true,
      state: true,
      legiscanPeopleId: true,
    },
  });
  console.log(`[backfill-people] ${legislators.length} legislator(s) in DB to match against`);

  // Index people by jurisdiction + state, with a bucket per last-name token.
  // Compound names ("Martinez Valladares") and hyphenated names ("Ortega-Toro")
  // are indexed under every meaningful token so a DB lookup by any single
  // token still finds them.
  type Bucket = Map<string, PersonRecord[]>;
  const byJurState: Map<string, Bucket> = new Map();
  for (const p of people) {
    const j = `${p.jurisdiction}|${p.state}`;
    let bucket = byJurState.get(j);
    if (!bucket) {
      bucket = new Map();
      byJurState.set(j, bucket);
    }
    const tokens = normalizeName(p.lastName)
      .split(' ')
      .filter((t) => t.length >= 3 && !NAME_FILLERS.has(t));
    for (const token of new Set(tokens)) {
      const list = bucket.get(token) ?? [];
      list.push(p);
      bucket.set(token, list);
    }
  }

  let matched = 0;
  let alreadySet = 0;
  let skipped = 0;
  let ambiguous = 0;
  const ambiguousExamples: string[] = [];

  for (const leg of legislators) {
    if (leg.legiscanPeopleId !== null) {
      alreadySet += 1;
      continue;
    }
    const bucket = byJurState.get(`${leg.jurisdiction}|${leg.state}`);
    if (!bucket) {
      skipped += 1;
      continue;
    }
    // Collect candidates from EVERY token of this legislator's last name.
    // Dedup by peopleId since one person can match multiple tokens.
    const legTokens = normalizeName(leg.lastName)
      .split(' ')
      .filter((t) => t.length >= 3 && !NAME_FILLERS.has(t));
    const seen = new Set<number>();
    const candidates: PersonRecord[] = [];
    for (const token of legTokens) {
      for (const p of bucket.get(token) ?? []) {
        if (seen.has(p.peopleId)) continue;
        seen.add(p.peopleId);
        candidates.push(p);
      }
    }
    if (candidates.length === 0) {
      skipped += 1;
      continue;
    }
    // Try exact "first last" match first; then loosen.
    const target = firstAndLast(leg.firstName, leg.lastName);
    let pick: PersonRecord | undefined = candidates.find((c) => firstAndLast(c.firstName, c.lastName) === target);
    if (!pick && candidates.length === 1) {
      // Only one person with this last name (or any token of it) in this
      // state — safe match.
      pick = candidates[0];
    }
    if (!pick) {
      // Try matching against full LegiScan name field (handles nicknames).
      pick = candidates.find((c) => normalizeName(c.fullName) === normalizeName(leg.fullName));
    }
    if (!pick) {
      // Final fallback: token overlap on full name. If both names share at
      // least one identifying token, accept it. Covers "Maria Elena Durazo"
      // (DB) vs "Maria Elena Durazo" (LegiScan first="Maria" last="Durazo").
      pick = candidates.find(
        (c) => lastNameTokensOverlap(leg.lastName, c.lastName) && lastNameTokensOverlap(leg.firstName, c.firstName),
      );
    }
    if (!pick) {
      ambiguous += 1;
      if (ambiguousExamples.length < 5) {
        ambiguousExamples.push(
          `${leg.fullName} (${leg.state} ${leg.jurisdiction}) — candidates: ${candidates
            .map((c) => c.fullName)
            .join(', ')}`,
        );
      }
      continue;
    }
    if (flags.dryRun) {
      matched += 1;
      continue;
    }
    try {
      await prisma.legislator.update({
        where: { id: leg.id },
        data: { legiscanPeopleId: pick.peopleId },
      });
      matched += 1;
    } catch (err) {
      // Unique constraint collision — another legislator already claims this peopleId.
      // That should be rare; log and continue.
      console.warn(
        `  [collision] ${leg.fullName}: legiscanPeopleId=${pick.peopleId} already claimed (${
          err instanceof Error ? err.message : err
        })`,
      );
      skipped += 1;
    }
  }

  console.log(`[backfill-people] summary:`);
  console.log(`  matched + updated: ${matched}`);
  console.log(`  already set (untouched): ${alreadySet}`);
  console.log(`  skipped (no candidate): ${skipped}`);
  console.log(`  ambiguous (multi-candidate, no exact match): ${ambiguous}`);
  if (ambiguousExamples.length > 0) {
    console.log(`  ambiguous examples:`);
    for (const ex of ambiguousExamples) console.log(`    - ${ex}`);
  }
  if (flags.dryRun) console.log('[backfill-people] DRY RUN — no DB writes.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
