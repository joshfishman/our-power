// scripts/ingest-fec.ts
//
// Phase 3 federal PAC ingestion via the FEC.gov API (api.open.fec.gov).
//
// Why this exists:
//   We already have every federal legislator's FEC IDs in
//   Legislator.fecIds (populated from the seed). The FEC publishes
//   per-candidate cycle totals via a free API — instant data.gov key,
//   no application. We don't need OpenSecrets bulk to put real numbers
//   on /scorecard/pac.
//
// Honest tradeoff vs. OpenSecrets:
//   FEC publishes raw filings without pre-classifying PACs as
//   corporate / labor / ideological. The closest field to "corporate
//   PAC" is `other_political_committee_contributions` (all non-party
//   PAC contributions to the candidate). We use that as the corporate
//   PAC proxy and write it with dataSource = FEC_DIRECT, which is
//   distinguishable from OPENSECRETS_BULK in the data layer. The
//   scoring engine prefers OpenSecrets (higher fidelity) when both
//   are present per the methodology, and falls back to FEC_DIRECT
//   when not.
//
//   To do strict corporate-only classification under FEC_DIRECT, we
//   would need to populate the CommitteeClassification table (schema
//   exists, ingestion does not) by walking each candidate's PAC
//   contributors and tagging each PAC's organization_type. That's a
//   future job; this ingester delivers a real, public-data-backed
//   ratio in the meantime.
//
// Usage:
//   # Get a free key at https://api.data.gov/signup/
//   echo "FEC_API_KEY=your_key_here" >> .env.local
//   npm run scorecard:ingest-fec                  # default cycle 2026
//   npm run scorecard:ingest-fec -- --cycle=2024  # historical
//   npm run scorecard:ingest-fec -- --dry-run

import './load-env';

import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { fetchWithTimeout } from '../src/lib/fetchWithTimeout';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const FEC_BASE = 'https://api.open.fec.gov/v1';
const REQUEST_TIMEOUT_MS = 12_000;
const RATE_LIMIT_PAUSE_MS = 100; // FEC default ceiling is 1000/hr; ~10/sec is safe.

interface CliFlags {
  cycleYear: number;
  dryRun: boolean;
  /** When true, re-fetch even legislators we already have FEC_DIRECT data for. */
  force: boolean;
  /** Max number of API calls per run; 0 = unlimited. Useful for testing. */
  limit: number;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { cycleYear: 2026, dryRun: false, force: false, limit: 0 };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--force') flags.force = true;
    else if (arg.startsWith('--cycle=')) flags.cycleYear = Number(arg.split('=')[1]);
    else if (arg.startsWith('--limit=')) flags.limit = Number(arg.split('=')[1]);
  }
  return flags;
}

interface FecCandidateTotals {
  candidate_id: string;
  cycle: number;
  receipts: number;
  /** All non-party PAC contributions for the cycle. */
  other_political_committee_contributions: number;
  /** Sometimes appears as `political_party_committee_contributions` separately. */
  political_party_committee_contributions?: number;
  individual_contributions: number;
  last_report_year?: number;
  last_report_type_full?: string;
}

interface FecResponse<T> {
  api_version?: string;
  pagination?: { count: number; pages: number; per_page: number; page: number };
  results: T[];
}

let lastCallAt = 0;
const rateLimitState = { consecutive: 0 };
async function pace(): Promise<void> {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < RATE_LIMIT_PAUSE_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_PAUSE_MS - elapsed));
  }
  lastCallAt = Date.now();
}

// Minimum receipts (USD) for a cycle to count as "substantive" rather than
// the few-dollar early-filing nominal cycle. Senators raise an order of
// magnitude more than House members, so the floors differ. If neither of
// the candidate's two most recent cycles clears the floor, we fall through
// to the latest one anyway (avoids dropping legitimately small campaigns).
const SUBSTANTIVE_RECEIPTS_FLOOR: Record<'SEN' | 'REP', number> = {
  SEN: 250_000,
  REP: 50_000,
};

async function fecCandidateTotals(
  candidateId: string,
  preferredCycle: number,
  apiKey: string,
  chamber: 'SEN' | 'REP' = 'REP',
): Promise<FecCandidateTotals | null> {
  await pace();
  // FEC candidate totals: /candidate/{candidate_id}/totals/.
  // We ask for the TOP 2 cycles, sorted descending, and pick the latest one
  // with substantive receipts. This avoids the "Kennedy registered for 2028
  // and raised $10k so far" problem — that cycle's PAC ratio would dominate
  // his real 2022 re-election cycle's numbers. Floor is chamber-specific
  // (senators raise far more than House members). If neither cycle clears
  // the floor we fall back to the latest one — legitimately small campaigns
  // shouldn't be silently dropped.
  const url = `${FEC_BASE}/candidate/${encodeURIComponent(
    candidateId,
  )}/totals/?api_key=${apiKey}&per_page=2&sort=-cycle`;
  void preferredCycle;
  let response;
  try {
    response = await fetchWithTimeout(url, {}, REQUEST_TIMEOUT_MS);
  } catch (err) {
    console.warn(`  [warn] fetch failed for ${candidateId}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
  if (!response.ok) {
    if (response.status === 404) return null;
    // data.gov returns 403 for both invalid keys AND rate-limit-exceeded
    // on some account types. Read the body so we know which.
    const body = await response.text().catch(() => '');
    const isRateLimit = response.status === 429 || /OVER_RATE_LIMIT|over_rate_limit|rate limit/i.test(body);
    if (isRateLimit) {
      // Rolling-hour window: 60s isn't enough if we just blew through 1000+
      // requests. Back off in escalating chunks so a partial run can grind
      // through the rest of the cohort instead of giving up.
      const wait = rateLimitState.consecutive < 3 ? 60_000 : 300_000; // 1 min → 5 min
      rateLimitState.consecutive += 1;
      console.warn(
        `  [warn] FEC rate limit hit (#${rateLimitState.consecutive}); sleeping ${wait / 1000}s before retry`,
      );
      await new Promise((r) => setTimeout(r, wait));
      return fecCandidateTotals(candidateId, preferredCycle, apiKey, chamber);
    }
    rateLimitState.consecutive = 0;
    console.warn(`  [warn] FEC HTTP ${response.status} for ${candidateId} — ${body.slice(0, 200)}`);
    return null;
  }
  rateLimitState.consecutive = 0;
  const json = (await response.json()) as FecResponse<FecCandidateTotals>;
  if (!json.results?.length) return null;
  const floor = SUBSTANTIVE_RECEIPTS_FLOOR[chamber];
  // Cycles arrive in descending order. Pick the latest with substantive
  // receipts; if none clear the floor, fall back to the latest (results[0]).
  const substantive = json.results.find((r) => Number(r.receipts ?? 0) >= floor);
  return substantive ?? json.results[0];
}

async function logApiCall(args: {
  endpoint: string;
  candidateId: string;
  status: number | null;
  durationMs: number;
  errorMessage?: string;
}): Promise<void> {
  try {
    await prisma.apiCallLog.create({
      data: {
        source: 'CONGRESSGOV', // FEC_DIRECT not in ApiCallSource enum; use CONGRESSGOV bucket — endpoint prefix disambiguates
        endpoint: `fec:${args.endpoint}`,
        params: { candidateId: args.candidateId } as Record<string, string>,
        status: args.status ?? undefined,
        cacheHit: false,
        durationMs: args.durationMs,
        errorMessage: args.errorMessage ?? null,
      },
    });
  } catch {
    // Logging best-effort; don't fail the ingest on log writes.
  }
}

interface ScheduleEFiling {
  candidate_id: string;
  committee_id: string;
  support_oppose_indicator: 'S' | 'O' | null;
  expenditure_amount: number;
  expenditure_date: string | null;
}

async function fetchScheduleEForCandidate(
  candidateId: string,
  cycle: number,
  apiKey: string,
): Promise<ScheduleEFiling[]> {
  const out: ScheduleEFiling[] = [];
  let page = 1;
  while (true) {
    const url =
      `https://api.open.fec.gov/v1/schedules/schedule_e/` +
      `?api_key=${apiKey}&candidate_id=${candidateId}&cycle=${cycle}` +
      `&per_page=100&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) {
      // 404 means "no filings" — common, don't fail the run.
      if (res.status === 404) return out;
      // 429 / 403 with OVER_RATE_LIMIT — back off and retry the same page.
      // Mirror the totals-endpoint retry behavior: escalating wait, cap
      // at 5 min, no infinite loop (consecutive guard via rateLimitState).
      const body = await res.text().catch(() => '');
      const isRateLimit = res.status === 429 || /OVER_RATE_LIMIT|over_rate_limit|rate limit/i.test(body);
      if (isRateLimit) {
        const wait = rateLimitState.consecutive < 3 ? 60_000 : 300_000;
        rateLimitState.consecutive += 1;
        console.warn(
          `  [warn] Schedule E rate limit (#${rateLimitState.consecutive}) for ${candidateId}; sleeping ${
            wait / 1000
          }s before retry`,
        );
        await new Promise((r) => setTimeout(r, wait));
        continue; // retry same page
      }
      throw new Error(
        `Schedule E fetch failed for ${candidateId} cycle ${cycle}: ${res.status} — ${body.slice(0, 200)}`,
      );
    }
    rateLimitState.consecutive = 0;
    const data = (await res.json()) as { results?: ScheduleEFiling[]; pagination?: { pages?: number } };
    out.push(...(data.results ?? []));
    const pages = data.pagination?.pages ?? 1;
    if (page >= pages) break;
    page += 1;
    await new Promise((r) => setTimeout(r, 100));
  }
  return out;
}

interface IeBuckets {
  corporateIeSupportAmount: number;
  corporateIeAgainstOpponentAmount: number;
  corporateIeAgainstSelfAmount: number;
}

async function classifyIeBuckets(
  legislatorFecId: string,
  opponentFecIds: ReadonlyArray<string>,
  cycle: number,
  apiKey: string,
  prismaClient: PrismaClient,
): Promise<IeBuckets> {
  // v1.5: filter by motivationClass=MONEY (concentrated-wealth-funded) rather
  // than category=CORPORATE/TRADE_ASSOCIATION. Conservative-attribution
  // default: any committee not in CommitteeClassification is treated as
  // MONEY (so we don't silently miss the dominant donor-class super PACs
  // that haven't been manually classified yet). PEOPLE-funded committees
  // (labor unions, grassroots advocacy) are excluded from the buckets.
  const selfFilings = await fetchScheduleEForCandidate(legislatorFecId, cycle, apiKey);
  let support = 0;
  let againstSelf = 0;
  const moneyCache = new Map<string, boolean>();
  async function isMoneyCommittee(committeeId: string): Promise<boolean> {
    if (moneyCache.has(committeeId)) return moneyCache.get(committeeId)!;
    const row = await prismaClient.committeeClassification.findUnique({
      where: { jurisdiction_committeeId: { jurisdiction: 'FEDERAL', committeeId } },
      select: { motivationClass: true },
    });
    // Treat unclassified as MONEY (conservative-attribution). PEOPLE only
    // applies when explicitly classified that way.
    const isMoney = !row || row.motivationClass !== 'PEOPLE';
    moneyCache.set(committeeId, isMoney);
    return isMoney;
  }
  for (const f of selfFilings) {
    if (!(await isMoneyCommittee(f.committee_id))) continue;
    if (f.support_oppose_indicator === 'S') support += f.expenditure_amount;
    else if (f.support_oppose_indicator === 'O') againstSelf += f.expenditure_amount;
  }
  // Pull IE AGAINST any of this legislator's same-cycle opponents
  let againstOpp = 0;
  for (const oppId of opponentFecIds) {
    const oppFilings = await fetchScheduleEForCandidate(oppId, cycle, apiKey);
    for (const f of oppFilings) {
      if (f.support_oppose_indicator !== 'O') continue;
      if (!(await isMoneyCommittee(f.committee_id))) continue;
      againstOpp += f.expenditure_amount;
    }
  }
  return {
    corporateIeSupportAmount: support,
    corporateIeAgainstOpponentAmount: againstOpp,
    corporateIeAgainstSelfAmount: againstSelf,
  };
}

async function main(): Promise<void> {
  // Accept either FEC_API_KEY (canonical) or FEC_DATA_API (used in some
  // setups). data.gov calls the field "API key" so both reading shapes
  // are common.
  const apiKey = process.env.FEC_API_KEY ?? process.env.FEC_DATA_API ?? '';
  if (!apiKey) {
    console.error(
      'No FEC API key found. Add FEC_API_KEY (or FEC_DATA_API) to .env.local. Get a free key at https://api.data.gov/signup/ — instant, no application.',
    );
    process.exit(1);
  }
  const flags = parseFlags(process.argv);
  console.log(
    `[ingest-fec] cycle=${flags.cycleYear}, dryRun=${flags.dryRun}, force=${flags.force}, limit=${
      flags.limit || 'unlimited'
    }`,
  );

  // Resume support: skip legislators we already have FEC_DIRECT data for
  // (unless --force). Lets a partial run that hit the rate cap pick up
  // where it left off on the next invocation.
  const alreadyDone = flags.force
    ? new Set<string>()
    : new Set(
        (
          await prisma.pacMoneyData.findMany({
            where: { dataSource: 'FEC_DIRECT', cycleYear: flags.cycleYear },
            select: { legislatorId: true },
          })
        ).map((p) => p.legislatorId),
      );
  if (!flags.force && alreadyDone.size > 0) {
    console.log(`[ingest-fec] resuming: skipping ${alreadyDone.size} legislator(s) already ingested`);
  }

  const legislators = await prisma.legislator.findMany({
    where: { isActive: true, jurisdiction: 'FEDERAL' },
    select: { id: true, bioguideId: true, fullName: true, fecIds: true, state: true, chamber: true, district: true },
  });
  console.log(`[ingest-fec] ${legislators.length} federal legislator(s) total`);

  let written = 0;
  let noFecId = 0;
  let notFound = 0;
  let zeroReceipts = 0;
  let refusers = 0;
  let skippedResume = 0;
  let processed = 0;

  for (const leg of legislators) {
    if (alreadyDone.has(leg.id)) {
      skippedResume += 1;
      continue;
    }
    if (flags.limit > 0 && processed >= flags.limit) {
      console.log(`[ingest-fec] limit (${flags.limit}) reached, stopping`);
      break;
    }
    processed += 1;
    if (processed % 50 === 0) {
      console.log(
        `[ingest-fec] progress: ${processed} processed, ${written} written, ${
          alreadyDone.size + skippedResume
        } already done`,
      );
    }
    if (!leg.fecIds || leg.fecIds.length === 0) {
      noFecId += 1;
      continue;
    }
    // Each legislator may have multiple FEC candidate IDs across cycles.
    // The data source typically lists them chronologically; the LAST one
    // is the most recent. One call per legislator (sorted -cycle on FEC's
    // side) keeps us safely under api.data.gov's 1000-req/hr ceiling
    // even with retries.
    const usedFecId = leg.fecIds[leg.fecIds.length - 1];
    const start = Date.now();
    const totals = await fecCandidateTotals(usedFecId, flags.cycleYear, apiKey, leg.chamber === 'SEN' ? 'SEN' : 'REP');
    void logApiCall({
      endpoint: 'candidate_totals',
      candidateId: usedFecId,
      status: totals ? 200 : 404,
      durationMs: Date.now() - start,
    });
    if (!totals) {
      notFound += 1;
      continue;
    }
    const totalReceipts = Number(totals.receipts ?? 0);
    const pacContribs = Number(totals.other_political_committee_contributions ?? 0);
    // FEC returns whatever cycle the candidate most recently filed for;
    // we store that, not the requested cycle. Senators not on the 2026
    // ballot will land here with their last cycle (2024 / 2022 / 2020).
    const actualCycle = Number(totals.cycle ?? flags.cycleYear);
    if (totalReceipts <= 0) {
      zeroReceipts += 1;
      continue;
    }
    const pct = pacContribs / totalReceipts;
    if (pct < 0.05) refusers += 1;

    // Inside the existing per-legislator loop, AFTER you have direct
    // pacContribs + totalReceipts:

    const legislatorFecId = leg.fecIds[0]; // first FEC id; null-safe below

    // Look up same-cycle opponents
    const opponents = await prisma.raceCandidate.findMany({
      where: {
        cycleYear: actualCycle,
        jurisdiction: 'FEDERAL',
        state: leg.state,
        chamber: leg.chamber,
        district: leg.district,
        // exclude self by candidate_id (FEC id, NOT legislator id)
        NOT: legislatorFecId ? { externalCandidateId: legislatorFecId } : undefined,
      },
      select: { externalCandidateId: true },
    });
    const opponentFecIds = opponents.map((o) => o.externalCandidateId);

    let ieBuckets: IeBuckets = {
      corporateIeSupportAmount: 0,
      corporateIeAgainstOpponentAmount: 0,
      corporateIeAgainstSelfAmount: 0,
    };
    if (legislatorFecId) {
      ieBuckets = await classifyIeBuckets(legislatorFecId, opponentFecIds, actualCycle, apiKey, prisma);
    }

    const combinedNumerator =
      pacContribs + ieBuckets.corporateIeSupportAmount + ieBuckets.corporateIeAgainstOpponentAmount;
    const combinedDenominator =
      totalReceipts + ieBuckets.corporateIeSupportAmount + ieBuckets.corporateIeAgainstOpponentAmount;
    const combinedCorporateRatio = combinedDenominator > 0 ? combinedNumerator / combinedDenominator : 0;

    if (flags.dryRun) {
      console.log(
        `  [dry] ${leg.fullName.padEnd(
          28,
        )} cycle=${actualCycle} fec=${usedFecId} pac=$${pacContribs.toLocaleString()} total=$${totalReceipts.toLocaleString()} pct=${(
          pct * 100
        ).toFixed(2)}%`,
      );
      written += 1;
      continue;
    }

    await prisma.pacMoneyData.upsert({
      where: {
        legislatorId_cycleYear_dataSource: {
          legislatorId: leg.id,
          cycleYear: actualCycle,
          dataSource: 'FEC_DIRECT',
        },
      },
      create: {
        legislatorId: leg.id,
        cycleYear: actualCycle,
        corporatePacAmount: pacContribs,
        totalReceipts,
        corporatePacPercentage: pct,
        corporateIeSupportAmount: ieBuckets.corporateIeSupportAmount,
        corporateIeAgainstOpponentAmount: ieBuckets.corporateIeAgainstOpponentAmount,
        corporateIeAgainstSelfAmount: ieBuckets.corporateIeAgainstSelfAmount,
        combinedCorporateRatio,
        dataSource: 'FEC_DIRECT',
        // FEC's web UI rejects the cycle param when it doesn't match the
        dataSourceUrl:
          // candidate's 6-year Senate cycle (e.g. cycle=2026 404s for a senator
          // up in 2028). Drop the param — the default view shows current data
          // for any candidate.
          `https://www.fec.gov/data/candidate/${encodeURIComponent(usedFecId)}/`,
      },
      update: {
        corporatePacAmount: pacContribs,
        totalReceipts,
        corporatePacPercentage: pct,
        corporateIeSupportAmount: ieBuckets.corporateIeSupportAmount,
        corporateIeAgainstOpponentAmount: ieBuckets.corporateIeAgainstOpponentAmount,
        corporateIeAgainstSelfAmount: ieBuckets.corporateIeAgainstSelfAmount,
        combinedCorporateRatio,
        // FEC's web UI rejects the cycle param when it doesn't match the
        dataSourceUrl:
          // candidate's 6-year Senate cycle (e.g. cycle=2026 404s for a senator
          // up in 2028). Drop the param — the default view shows current data
          // for any candidate.
          `https://www.fec.gov/data/candidate/${encodeURIComponent(usedFecId)}/`,
        fetchedAt: new Date(),
      },
    });
    written += 1;
  }

  console.log(`[ingest-fec] summary:`);
  console.log(`  wrote PacMoneyData rows: ${written}`);
  console.log(`  resumed (already had data): ${skippedResume}`);
  console.log(`  legislators with no FEC ID: ${noFecId}`);
  console.log(`  legislators not in FEC for cycle ${flags.cycleYear}: ${notFound}`);
  console.log(`  legislators with $0 receipts: ${zeroReceipts}`);
  console.log(`  under 5% PAC threshold: ${refusers}`);
  const remaining = legislators.length - alreadyDone.size - skippedResume - processed;
  if (remaining > 0) {
    console.log(`  remaining (limit/cap stopped early): ${remaining} — re-run to resume`);
  }
  console.log(`\n  Note: FEC_DIRECT counts ALL non-party PAC contributions, not just`);
  console.log(`  corporate-classified PACs. To refine, populate CommitteeClassification`);
  console.log(`  and walk schedule_a contributors. The /scorecard/pac page footer`);
  console.log(`  surfaces this caveat to readers.`);
  if (flags.dryRun) console.log(`\n[ingest-fec] DRY RUN — no DB writes.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
