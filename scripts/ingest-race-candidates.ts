// Populate RaceCandidate from FEC + Cal-Access candidate-master data.
// One-time-ish for past cycles + ongoing for the upcoming cycle.
//
// Usage:
//   npm run scorecard:ingest-race-candidates -- --cycles=2022,2024,2026,2028
//   npm run scorecard:ingest-race-candidates -- --cycles=2026 --jurisdiction=FEDERAL
//   npm run scorecard:ingest-race-candidates -- --dry-run

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { normalizeName, lastNameTokensOverlap } from '../src/lib/scorecard/calaccess-parser';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const FEC_API_BASE = 'https://api.open.fec.gov/v1';

interface CliFlags {
  cycles: number[];
  jurisdiction: 'FEDERAL' | 'CA' | 'BOTH';
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { cycles: [2024, 2026, 2028], jurisdiction: 'BOTH', dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--cycles=')) {
      flags.cycles = arg
        .split('=')[1]
        .split(',')
        .map((s) => parseInt(s, 10))
        .filter(Number.isFinite);
    } else if (arg.startsWith('--jurisdiction=')) {
      const v = arg.split('=')[1].toUpperCase();
      if (v === 'FEDERAL' || v === 'CA' || v === 'BOTH') flags.jurisdiction = v as CliFlags['jurisdiction'];
    }
  }
  return flags;
}

interface FecCandidate {
  candidate_id: string;
  name: string;
  party: string | null;
  office: 'H' | 'S' | 'P';
  state: string;
  district: string | null;
  cycles: number[];
  // Future / current cycle? FEC returns one row per candidate; their `cycles` array
  // tells us which cycles they've been active in.
}

async function fetchFecCandidatesForCycle(cycle: number): Promise<FecCandidate[]> {
  const apiKey = process.env.FEC_API_KEY || process.env.FEC_DATA_API;
  if (!apiKey) throw new Error('FEC_API_KEY / FEC_DATA_API not set in env');
  const out: FecCandidate[] = [];
  // FEC paginates at 100/page
  let page = 1;
  while (true) {
    const url = `${FEC_API_BASE}/candidates/?api_key=${apiKey}&cycle=${cycle}&office=H&office=S&per_page=100&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`FEC API failed: ${res.status} ${res.statusText} (page ${page})`);
    const data = (await res.json()) as { results?: FecCandidate[]; pagination?: { pages?: number } };
    out.push(...(data.results ?? []));
    const pages = data.pagination?.pages ?? 1;
    if (page >= pages) break;
    page += 1;
    await new Promise((r) => setTimeout(r, 100)); // gentle pacing
  }
  return out;
}

async function resolveLegislatorForFecCandidate(c: FecCandidate): Promise<string | null> {
  // FEC candidate_id is not bioguideId. Match by name + state + chamber + district.
  const chamber = c.office === 'S' ? 'SEN' : c.office === 'H' ? 'REP' : null;
  if (!chamber) return null;
  const candidates = await prisma.legislator.findMany({
    where: {
      jurisdiction: 'FEDERAL',
      state: c.state,
      chamber,
      ...(c.district ? { district: parseInt(c.district, 10) } : {}),
    },
    select: { id: true, fullName: true },
  });
  if (candidates.length === 0) return null;
  // Match using token-overlap
  const matched = candidates.find((leg) => lastNameTokensOverlap(leg.fullName, c.name));
  return matched?.id ?? null;
}

function outcomeFromFec(c: FecCandidate, cycle: number): 'WON' | 'LOST_GENERAL' | 'LOST_PRIMARY' | 'DECLARED_PENDING' {
  // FEC's `cycles` includes the cycle where they were a candidate. If the cycle
  // is in the future relative to the latest election cycle in our DB, mark as
  // DECLARED_PENDING. Otherwise we don't have enough signal from /candidates
  // alone to know win/loss — leave LOST_GENERAL as conservative default; a
  // follow-up pass against /candidates/?has_raised_funds=true + election results
  // can refine. For v1.4 the WON/LOST distinction matters less than the
  // DECLARED_PENDING flag (which gates "C: active opponents").
  const currentYear = new Date().getFullYear();
  if (cycle >= currentYear) return 'DECLARED_PENDING';
  return 'LOST_GENERAL';
}

async function ingestFederalForCycle(cycle: number, dryRun: boolean): Promise<number> {
  console.log(`[ingest-race-candidates] FEDERAL cycle=${cycle}: fetching candidates…`);
  const candidates = await fetchFecCandidatesForCycle(cycle);
  console.log(`  fetched ${candidates.length} candidates`);
  let upserted = 0;
  for (const c of candidates) {
    const chamber: 'SEN' | 'REP' = c.office === 'S' ? 'SEN' : 'REP';
    const legislatorId = await resolveLegislatorForFecCandidate(c);
    const outcome = outcomeFromFec(c, cycle);
    if (dryRun) {
      upserted += 1;
      continue;
    }
    await prisma.raceCandidate.upsert({
      where: { cycleYear_externalCandidateId: { cycleYear: cycle, externalCandidateId: c.candidate_id } },
      create: {
        cycleYear: cycle,
        externalCandidateId: c.candidate_id,
        candidateName: c.name,
        outcome,
        jurisdiction: 'FEDERAL',
        state: c.state,
        chamber,
        district: c.district ? parseInt(c.district, 10) : null,
        legislatorId,
      },
      update: {
        candidateName: c.name,
        outcome,
        legislatorId,
      },
    });
    upserted += 1;
  }
  return upserted;
}

// CA ingest: parses Cal-Access candidacy data from existing CCDC bulk on disk.
// Form 501 (Candidate Intention Statement) is the canonical "who's running" form.
// Per implementation discovery: the candidacy table in CCDC bulk is likely
// `f501_502_cd.csv` or `candidate_term_cd.csv`. Implementer verifies which.
async function ingestCaForCycle(_cycle: number, _dryRun: boolean): Promise<number> {
  console.log(`[ingest-race-candidates] CA cycle=${_cycle}: implementation deferred to Task 6 follow-up`);
  // Stub for now — will be filled in once the CCDC table name is verified.
  // For v1.4 launch, federal-only RaceCandidate data is sufficient to
  // demonstrate the methodology; CA can be backfilled via a follow-up script
  // call without changing any code below this script.
  return 0;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-race-candidates] flags: ${JSON.stringify(flags)}`);
  let total = 0;
  for (const cycle of flags.cycles) {
    if (flags.jurisdiction !== 'CA') total += await ingestFederalForCycle(cycle, flags.dryRun);
    if (flags.jurisdiction !== 'FEDERAL') total += await ingestCaForCycle(cycle, flags.dryRun);
  }
  console.log(`[ingest-race-candidates] total upserted: ${total}${flags.dryRun ? ' (dry-run)' : ''}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
