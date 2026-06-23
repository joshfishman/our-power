// Server-side data fetching for the scorecard pages and API routes.
// All functions are read-only and safe to call from public surface area.

import { unstable_cache } from 'next/cache';
import prisma from '@/lib/prisma/prisma';
import { METHODOLOGY_VERSION } from '@/lib/scorecard/scoring';
import { classifyEmployer, SECTOR_LABEL } from '@/lib/scorecard/employer-industry';
import { CURATED_VOTE_BILLS, curatedDirection } from '@/lib/scorecard/curated-votes';

export type ScorecardJurisdiction = 'FEDERAL' | 'CA';

const ALL_JURISDICTIONS: ScorecardJurisdiction[] = ['FEDERAL', 'CA'];

function isJurisdiction(value: string | null | undefined): value is ScorecardJurisdiction {
  return !!value && (ALL_JURISDICTIONS as string[]).includes(value);
}

export function parseJurisdictionParam(raw: string | null | undefined): ScorecardJurisdiction | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  return isJurisdiction(upper) ? upper : null;
}

/**
 * Returns all planks plus their markers (and bills), grouped by jurisdiction.
 * Used by the public methodology / index pages and /api/scorecard/planks.
 */
export async function getPublicPlanks(jurisdiction?: ScorecardJurisdiction) {
  return prisma.plank.findMany({
    where: jurisdiction ? { jurisdiction } : undefined,
    orderBy: [{ jurisdiction: 'asc' }, { number: 'asc' }],
    include: {
      markers: {
        orderBy: { displayOrder: 'asc' },
        include: {
          bills: { orderBy: { billNumber: 'asc' } },
        },
      },
    },
  });
}

export interface LegislatorListFilter {
  jurisdiction?: ScorecardJurisdiction;
  state?: string;
  chamber?: 'SEN' | 'REP';
  party?: 'D' | 'R' | 'I';
}

/**
 * Returns the legislator list for the index page. Includes published
 * scores (if any) so totals can be rendered. Unpublished scores are
 * excluded — page UI shows a "scoring pending" badge for legislators
 * without published scores yet.
 *
 * Also returns a count of ACTED_FOR / ACTED_AGAINST achievements per
 * legislator so the page can render an "X positions on record" chip
 * next to each score — surfacing activity even where the total score
 * is low.
 */
// Source of truth for scoring methodology version on display. Old v1.0/v1.1/...
// score rows linger in the DB but are filtered out here so a legislator's
// total reflects only the current methodology pass. We re-export the value
// from `scoring.ts` to keep a single source of truth: the methodology version
// the engine writes is the same version the public reads.
export const CURRENT_METHODOLOGY = METHODOLOGY_VERSION;

// Source of truth for the methodology version that drives the PUBLIC VOTING
// RECORD (the 0-100 per-plank alignment % and its mean).
//
// This is DELIBERATELY decoupled from `CURRENT_METHODOLOGY` (the PAC engine's
// METHODOLOGY_VERSION, currently v1.9.1). The PAC engine writes signed-integer
// RepresentativeScore rows (range roughly −3..7) under its own version; those
// are NOT the bill-level alignment percentages the Voting Record displays.
// Reading them through `computePublishedTotal` collapsed every legislator to
// ~4%. The correct Voting Record numbers are the pre-existing v1.7 bill-level
// alignment-% rows (every score in [0, 100], all 658 legislators covered).
//
// Keeping this constant separate means the PAC/scoring engine can keep bumping
// METHODOLOGY_VERSION without silently swapping the public Voting Record back
// to the signed-integer rows. The PAC Score is computed separately (read-time
// from PacContribution/PacMoneyData) and is unaffected by this value.
export const VOTING_DISPLAY_METHODOLOGY = 'v2.0';

// ─── v1.9.3 Minimum-bills floor on the Voting Record ────────────────────────
//
// A per-plank alignment % should only be DISPLAYED (and folded into the
// legislator's Voting Record mean) when it rests on at least this many
// eligible bills. A plank scored off a tiny denominator (e.g. a CA plank or a
// senator's plank-2 measured on only 2 marker bills) shouldn't be presented as
// equally trustworthy as a plank measured on dozens of roll calls.
//
// For the v1.7 rows that drive the public Voting Record, the eligible-bill
// count (denominator) is recoverable WITHOUT recomputing: compute-scores-v1.7
// writes `forCount = aligned` and `againstCount = total - aligned`, so
//     eligible bills = forCount + againstCount.
// We therefore apply the floor purely at the display layer — no DB write, no
// recompute, trivially reversible by changing this constant. Sub-floor planks
// are EXCLUDED from the mean (not zeroed), so a legislator's remaining planks
// still produce a fair average.
//
// FLOOR = 3 chosen from the actual v1.7 denominator distribution:
//   denom=2 (100 rows, all federal Plank 2 — senators measured on 2 marker
//            bills) is excluded; denom>=3 (every other plank/jurisdiction) is
//            kept. FLOOR=4 was rejected because it collapses every senator to a
//            single plank, and FLOOR=5 leaves 100 senators with zero planks
//            (total -> null). FLOOR=3 drops 100 plank-rows, zeroes no
//            legislator, and moves the validated marquee only marginally
//            (Sanders/Warren 92->89, Cruz 52->53, McConnell 44->42; House
//            members AOC/Pelosi/Jordan unchanged — their planks are all deep).
//
// NOTE: this floor is intentionally a single named constant so it is easy to
// retune once the v1.7 voting universe is rebuilt with deeper senate coverage.
//
// Held INERT at 2 for now (no plank has <2 eligible bills, so this is a no-op):
// per project decision the floor is only raised to its real value (3–4) AFTER
// Senate + House roll-call coverage is deepened, so legislators are no longer
// scored on thin 2–3 bill planks. Bump to 3 or 4 once that re-ingest lands.
export const MIN_ELIGIBLE_BILLS_FLOOR = 2;

// ─── Voting Record publication kill-switch ──────────────────────────────────
//
// SINGLE source of truth for whether the public scorecard PUBLISHES the Voting
// Record (the per-plank alignment %, the legislator's Voting Record mean) and
// the PAC+Voting headline Average.
//
// WHY held: the Voting Record rests on auto-classified bills whose
// aligned-direction is not yet human-verified, so we are temporarily NOT
// publishing voting scores. The PAC Score (computed read-time from
// PacMoneyData / PacContribution against public FEC / Cal-Access filings) IS
// trustworthy and stays live. Once classification-review coverage is
// sufficient, flip this back to `true` to restore the full two-score display.
//
// While `false`:
//   - public index, legislator detail, and issue pages show the PAC Score as
//     the headline and render the Voting Record + Average as an "Under
//     revision" state (no held numbers shown);
//   - the public API still returns the voting data but flags it
//     `votingPublished: false` / `votingStatus: 'under-revision'`.
// Flipping this to `true` is the ONLY change needed to re-enable everything —
// every public surface branches on this constant.
export const VOTING_RECORD_PUBLISHED = true;

// ─── 2026 candidate viability filter (the "no-chance" filter) ────────────────
//
// The FEC candidate file (cn26.txt) contains thousands of statutory filers per
// cycle — most of whom have no campaign, raise no money, and stand no chance of
// appearing on a competitive ballot. Listing every one of them buries the
// candidates a voter actually has to choose between. This filter keeps the
// public race pages honest and useful: same rubric for everyone who is actually
// running, no padding the field with paper candidates.
//
// A 2026 candidate is VIABLE iff EITHER:
//   (a) they are a sitting incumbent (`isActive === true`) — always shown,
//       regardless of receipts, because the public is owed an accounting of the
//       person currently holding the seat; OR
//   (b) they belong to a major party (Democratic / Republican / Independent —
//       i.e. Party enum D | R | I) AND have raised at least
//       VIABILITY_MIN_RECEIPTS dollars this cycle.
//
// Everyone else — no receipts, negligible receipts, or a fringe/minor party —
// is filtered out. The dollar floor is a single tunable constant so the
// threshold can be retuned without touching call sites.
//
// NOTE on graceful degradation: 2026 challenger receipts are still being
// backfilled (a background FEC job is populating `PacMoneyData.totalReceipts`
// for cycleYear=2026, dataSource='FEC_DIRECT'). Until a challenger's row lands,
// their receipts read as null/0 and they will (correctly) fail the dollar floor
// and be hidden — they surface automatically once their receipts are ingested.
// Incumbents are never gated on receipts, so they are unaffected by the backfill.
export const VIABILITY_MIN_RECEIPTS = 50_000;

// Major parties for the viability test. The Party enum is exactly D | R | I, so
// every stored party qualifies today; this set is kept explicit so that if the
// schema ever widens to carry minor-party codes, fringe filers are excluded by
// default rather than silently let through.
const MAJOR_PARTIES = new Set(['D', 'R', 'I']);

/**
 * Shape needed to decide viability. Any object carrying these fields works
 * (a Prisma `Legislator` row, a partial `select`, etc.).
 */
export interface ViabilityCandidate {
  isActive: boolean;
  party: string;
  /** This candidate's 2026 receipts (PacMoneyData.totalReceipts). null/0 = unknown/none. */
  cycleReceipts: number | null;
}

/**
 * Pure predicate — true when a 2026 candidate clears the "no-chance" filter.
 * See `VIABILITY_MIN_RECEIPTS` for the full rationale. Sitting incumbents are
 * always viable; everyone else must be a major-party candidate with receipts at
 * or above the floor. Degrades gracefully when receipts are still null/0.
 */
export function isViableCandidate(cand: ViabilityCandidate): boolean {
  if (cand.isActive) return true;
  if (!MAJOR_PARTIES.has(cand.party)) return false;
  return (cand.cycleReceipts ?? 0) >= VIABILITY_MIN_RECEIPTS;
}

/**
 * Bulk read of current-cycle (2026) FEC receipts for a set of legislators,
 * keyed by legislatorId. Reads `Legislator.currentCycleReceipts` — populated by
 * scripts/ingest-2026-receipts.ts from FEC /candidates/totals/. We store it on
 * Legislator (not PacMoneyData) because challengers have a receipts total but
 * NOT the itemized corporate-PAC breakdown a real PAC Score needs — so a
 * PacMoneyData row would falsely imply a 0%-corporate (100%) PAC Score.
 * Legislators with no figure yet are absent from the map; callers treat a
 * missing key as null, which the viability filter handles gracefully.
 */
export async function getCycleReceiptsByLegislator(legislatorIds: string[]): Promise<Map<string, number>> {
  if (legislatorIds.length === 0) return new Map();
  const rows = await prisma.legislator.findMany({
    where: { id: { in: legislatorIds }, currentCycleReceipts: { not: null } },
    select: { id: true, currentCycleReceipts: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    const v = Number(r.currentCycleReceipts);
    if (Number.isFinite(v)) out.set(r.id, v);
  }
  return out;
}

/**
 * v1.9.3 — true when a v1.7 plank score rests on enough eligible bills to be
 * displayed. Eligible-bill count = forCount + againstCount (see the constant
 * doc above). Rows missing the counts (forCount+againstCount === 0) are also
 * dropped — a 0-denominator plank carries no signal.
 */
export function meetsMinBillsFloor(score: { forCount?: number | null; againstCount?: number | null }): boolean {
  const denom = (score.forCount ?? 0) + (score.againstCount ?? 0);
  return denom >= MIN_ELIGIBLE_BILLS_FLOOR;
}

export async function getLegislatorList(filter: LegislatorListFilter = {}) {
  return prisma.legislator.findMany({
    where: {
      isActive: true,
      ...(filter.jurisdiction ? { jurisdiction: filter.jurisdiction } : {}),
      ...(filter.state ? { state: filter.state } : {}),
      ...(filter.chamber ? { chamber: filter.chamber } : {}),
      ...(filter.party ? { party: filter.party } : {}),
    },
    orderBy: [{ state: 'asc' }, { lastName: 'asc' }],
    include: {
      scores: {
        where: { publishedAt: { not: null }, methodologyVersion: VOTING_DISPLAY_METHODOLOGY },
        include: { plank: { select: { number: true, name: true } } },
      },
    },
  });
}

/**
 * Resolves a legislator by either bioguideId, openStatesId, or cuid.
 * Public pages accept any of these in the URL slot.
 */
export async function findLegislatorByAnyId(id: string) {
  if (!id) return null;
  return prisma.legislator.findFirst({
    where: {
      OR: [{ id }, { bioguideId: id }, { openStatesId: id }],
    },
    include: {
      scores: {
        where: { publishedAt: { not: null }, methodologyVersion: VOTING_DISPLAY_METHODOLOGY },
        include: { plank: true },
        orderBy: { plank: { number: 'asc' } },
      },
      achievements: {
        where: { verifiedAt: { not: null } },
        include: {
          marker: {
            include: { plank: { select: { number: true, name: true, slug: true } } },
          },
        },
      },
      pacData: { orderBy: [{ cycleYear: 'desc' }] },
    },
  });
}

/**
 * Computes the Voting Record total across published plank scores — the MEAN
 * of the per-plank alignment percentages.
 *
 * Every caller now passes rows filtered to `VOTING_DISPLAY_METHODOLOGY`
 * (the v1.7 bill-level alignment-% pass), so each `score` is already a 0-100
 * alignment percentage and the total is simply their mean. The Average of
 * (PAC, Voting) is computed by `computeTwoScoreAverage` below, NOT here.
 *
 * Historically this helper carried an [0,100]-range heuristic plus a signed-sum
 * fallback to cope with mixed methodology rows. That fallback is gone: the v1.9.1
 * signed-integer engine rows are never passed here anymore (reading them through
 * the old heuristic is exactly what collapsed every legislator to ~4%).
 *
 * Returns null if no scores are published yet (used to render "pending").
 *
 * v1.9.3 — applies the MIN_ELIGIBLE_BILLS_FLOOR: per-plank rows whose
 * eligible-bill count (forCount + againstCount) is below the floor are
 * EXCLUDED from the mean rather than zeroed, so a thin-denominator plank
 * doesn't drag (or prop up) the displayed Voting Record. If a caller passes
 * rows without forCount/againstCount, those rows have a 0 denominator and are
 * dropped — pass the full score rows to get the floor applied. When the floor
 * removes every plank we fall back to "pending" (null) rather than inventing a
 * number.
 */
export function computePublishedTotal(
  scores: Array<{ score: number; forCount?: number | null; againstCount?: number | null }>,
): number | null {
  if (scores.length === 0) return null;
  const eligible = scores.filter(meetsMinBillsFloor);
  if (eligible.length === 0) return null;
  const sum = eligible.reduce((acc, s) => acc + s.score, 0);
  return Math.round(sum / eligible.length);
}

/**
 * v2.0.1 — minimum principal receipts for a cycle's corporate-PAC RATIO to be
 * trusted. A cycle that raised only a few thousand dollars (a mid-cycle row
 * early in a current cycle, e.g. $8.5k of 2026 receipts so far) yields a wildly
 * unstable ratio. We drop such cycles from the per-cycle mean — UNLESS every
 * cycle is thin, in which case we keep them all rather than null out a
 * sparse-but-real record.
 */
export const MIN_CYCLE_RECEIPTS_FOR_RATIO = 50000;

function meanRatioSkippingThinCycles(ratioByCycle: Map<number, number>, receiptsByCycle: Map<number, number>): number {
  const cycles = [...ratioByCycle.keys()];
  const substantial = cycles.filter((cy) => (receiptsByCycle.get(cy) ?? 0) >= MIN_CYCLE_RECEIPTS_FOR_RATIO);
  const use = substantial.length > 0 ? substantial : cycles;
  return use.reduce((a, cy) => a + (ratioByCycle.get(cy) ?? 0), 0) / use.length;
}

/**
 * v1.9.3 — corporate-PAC score for one legislator (CA / legacy PacMoneyData path).
 *
 * Score = (1 − mean_corporate_ratio) × 100, clamped to [0, 100].
 *
 * `mean_corporate_ratio` is the SIMPLE MEAN of each available cycle's
 * corporate-PAC ratio — every cycle weighted equally, regardless of how many
 * dollars flowed in that cycle. (Prior to v1.9.3 this read only the
 * most-recent cycle, which let a single light or heavy cycle dominate the
 * displayed score.) When more than one PacMoneyData source exists for the
 * same cycle we keep the highest-priority source per cycle (dataSource ASC —
 * e.g. CAL_ACCESS_CCDC before OPENSECRETS_BULK) before averaging, so a cycle
 * is never double-counted. If no PAC data exists we return null and the page
 * renders a "no PAC data" badge instead of a misleading 100%.
 */
export async function getLegislatorPacScore(legislatorId: string): Promise<number | null> {
  const rows = await prisma.pacMoneyData.findMany({
    where: { legislatorId },
    // dataSource ASC = higher-fidelity source first; cycleYear DESC for stable
    // ordering. We dedupe to one row per cycle below (first wins).
    orderBy: [{ cycleYear: 'desc' }, { dataSource: 'asc' }],
    select: { cycleYear: true, combinedCorporateRatio: true, corporatePacPercentage: true, totalReceipts: true },
  });
  if (rows.length === 0) return null;
  // One ratio per cycle (first row per cycle wins — highest-fidelity source).
  // Track receipts per cycle so we can drop "thin" cycles whose tiny denominator
  // makes the corporate ratio unstable (e.g. a mid-cycle row with only $8.5k
  // raised so far would otherwise read as a near-perfect 0%-corporate cycle).
  const ratioByCycle = new Map<number, number>();
  const receiptsByCycle = new Map<number, number>();
  for (const row of rows) {
    if (ratioByCycle.has(row.cycleYear)) continue;
    const ratioRaw = row.combinedCorporateRatio ?? row.corporatePacPercentage;
    if (ratioRaw === null) continue;
    const ratio = Number(ratioRaw);
    if (!Number.isFinite(ratio)) continue;
    ratioByCycle.set(row.cycleYear, ratio);
    receiptsByCycle.set(row.cycleYear, Number(row.totalReceipts ?? 0));
  }
  if (ratioByCycle.size === 0) return null;
  const meanRatio = meanRatioSkippingThinCycles(ratioByCycle, receiptsByCycle);
  return Math.max(0, Math.min(100, Math.round((1 - meanRatio) * 100)));
}

/**
 * v1.7 — combine PAC + Voting into a single average. Either input can be
 * null (e.g. no PAC data, or no voting record yet); when one is missing we
 * return the other unrounded.
 */
export function computeTwoScoreAverage(pacScore: number | null, votingScore: number | null): number | null {
  if (pacScore === null && votingScore === null) return null;
  if (pacScore === null) return votingScore;
  if (votingScore === null) return pacScore;
  return Math.round((pacScore + votingScore) / 2);
}

/**
 * v1.9.3 — bulk PAC scores for a list of legislators (CA / legacy path). Used
 * by the index page so we don't fire N+1 queries. Returns Map<legislatorId,
 * score|null>.
 *
 * Mirrors `getLegislatorPacScore`: the score is the SIMPLE MEAN of each
 * cycle's corporate-PAC ratio (every cycle weighted equally), not the
 * most-recent cycle alone. We first collapse to one ratio per (legislator,
 * cycle) — keeping the highest-fidelity source via DISTINCT ON ... dataSource
 * ASC so a cycle is never double-counted — then average the per-cycle ratios
 * in JS.
 */
export async function getPacScoresByLegislator(legislatorIds: string[]): Promise<Map<string, number | null>> {
  if (legislatorIds.length === 0) return new Map();
  // One ratio row per (legislator, cycle): DISTINCT ON the (legislator, cycle)
  // pair, preferring the higher-fidelity dataSource. Then we average the
  // per-cycle ratios per legislator in JS for the simple mean.
  const rows = await prisma.$queryRaw<
    Array<{
      legislatorId: string;
      cycleYear: number;
      combinedCorporateRatio: number | null;
      corporatePacPercentage: number | null;
      totalReceipts: number | null;
    }>
  >`
    SELECT DISTINCT ON ("legislatorId", "cycleYear")
      "legislatorId",
      "cycleYear",
      "combinedCorporateRatio"::float AS "combinedCorporateRatio",
      "corporatePacPercentage"::float AS "corporatePacPercentage",
      "totalReceipts"::float AS "totalReceipts"
    FROM "PacMoneyData"
    WHERE "legislatorId" = ANY(${legislatorIds})
    ORDER BY "legislatorId" ASC, "cycleYear" DESC, "dataSource" ASC
  `;
  // Accumulate per-cycle ratio + receipts per legislator, then take the simple
  // mean — dropping thin cycles (see meanRatioSkippingThinCycles) so a sparse
  // mid-cycle row can't fabricate a near-perfect score.
  const byLeg = new Map<string, { ratios: Map<number, number>; receipts: Map<number, number> }>();
  for (const r of rows) {
    const ratio = r.combinedCorporateRatio ?? r.corporatePacPercentage;
    if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) continue;
    const acc = byLeg.get(r.legislatorId) ?? { ratios: new Map(), receipts: new Map() };
    acc.ratios.set(r.cycleYear, ratio);
    acc.receipts.set(r.cycleYear, Number(r.totalReceipts ?? 0));
    byLeg.set(r.legislatorId, acc);
  }
  const out = new Map<string, number | null>();
  for (const id of legislatorIds) out.set(id, null);
  for (const [id, acc] of byLeg) {
    if (acc.ratios.size === 0) continue;
    const meanRatio = meanRatioSkippingThinCycles(acc.ratios, acc.receipts);
    out.set(id, Math.max(0, Math.min(100, Math.round((1 - meanRatio) * 100))));
  }
  return out;
}

/**
 * CA money trail — per-class breakdown + top committee donors for a California
 * legislator, from the itemized CA PacContribution rows (synthetic `CA:<name>`
 * committees written by ingest-cal-access.ts). Gives CA pages the money-trail
 * depth federal has. Returns null when no itemized CA data exists yet.
 */
export interface CaMoneyTrail {
  total: number;
  byClass: Array<{ class: string; amount: number }>;
  topDonors: Array<{ name: string; class: string; amount: number }>;
  cycles: number[];
}
export async function getCaMoneyTrail(legislatorId: string): Promise<CaMoneyTrail | null> {
  const rows = await prisma.$queryRaw<Array<{ name: string; class: string; amount: string; cycleYear: number }>>`
    SELECT pcl.name AS name, pcl.class::text AS class, pc.amount::text AS amount, pc."cycleYear" AS "cycleYear"
    FROM "PacContribution" pc
    JOIN "PacClassification" pcl ON pcl."committeeId" = pc."donorCommitteeId"
    WHERE pc."legislatorId" = ${legislatorId} AND pc."donorCommitteeId" LIKE 'CA:%'
  `;
  if (rows.length === 0) return null;
  const byClassMap = new Map<string, number>();
  const donorMap = new Map<string, { class: string; amount: number }>();
  const cycles = new Set<number>();
  let total = 0;
  for (const r of rows) {
    const amt = Number(r.amount);
    if (!Number.isFinite(amt)) continue;
    total += amt;
    cycles.add(r.cycleYear);
    byClassMap.set(r.class, (byClassMap.get(r.class) ?? 0) + amt);
    const d = donorMap.get(r.name) ?? { class: r.class, amount: 0 };
    d.amount += amt;
    donorMap.set(r.name, d);
  }
  const byClass = [...byClassMap.entries()]
    .map(([c, a]) => ({ class: c, amount: a }))
    .sort((a, b) => b.amount - a.amount);
  const topDonors = [...donorMap.entries()]
    .map(([name, d]) => ({ name, class: d.class, amount: d.amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 12);
  return { total, byClass, topDonors, cycles: [...cycles].sort((a, b) => b - a) };
}

// ─── v1.7.1 PAC scoring (from PacContribution table) ────────────────────────
//
// The v1.7.1 PAC Score is computed from per-(leg, donor, cycle, kind) rows
// in PacContribution joined to the donor's class in PacClassification.
//
//   counts_against  = Σ amount where class ∈ {CORPORATE, DARK_MONEY,
//                       FOREIGN_POLICY} AND kind ∈ {DIRECT,
//                       JFC_PASS_THROUGH, LEADERSHIP_PASS_THROUGH,
//                       IE_SUPPORT}
//   denominator     = principal-committee multi-cycle receipts
//                     (PacMoneyData.totalReceipts summed)
//                     + Σ IE_SUPPORT (any class)
//                     This matches the v1.7.1 spike: the denominator is the
//                     legislator's total fundraising universe, not just PAC
//                     dollars. Using a PAC-only denominator produced
//                     misleadingly-low scores (Booker 75% vs spike 97%)
//                     because incumbents raise most of their money from
//                     individuals.
//   PAC Score       = (1 − counts_against / denominator) × 100
//
// v1.9.1 — Two-tier outside-money weighting (2026-05-31, corrected). The
// dividing question per dollar: was this dollar spent ON THIS LEGISLATOR'S
// BEHALF? If yes — full weight in both numerator (when the source class is
// counts-against) and denominator. That covers DIRECT (their committee took
// it), JFC_PASS_THROUGH (a JFC apportioned it to them), LEADERSHIP_PASS_THROUGH
// (a colleague's leadership PAC apportioned it to them), and IE_SUPPORT
// (outside group spent it FOR them). Supported is supported — the legislator
// benefits regardless of whether the money flowed through their committee or
// a Super PAC. Zero weight only on IE_OPPOSE_BENEFICIARY — money spent AGAINST
// the opponent in their race, not on the legislator's behalf, and they had no
// path to refuse spending directed at someone else. Surfaced as transparency.
//
// denominator = 0 → score is null (no PAC data, render "no data" badge).
//
// v1.7.7 (2026-05-29): Missing-receipts guard. The 4-cycle PacMoneyData
// ingest only writes a row when FEC returns receipts > 0, so senators with
// gaps in their fundraising windows (e.g. McCormick had no FEC totals for
// 2018/2020/2022; Markey/Booker/Sanders only file in their re-election
// cycle) can wind up with totalReceipts = 0. In that case denom = IE_SUPPORT
// alone, which collapses to a near-zero score driven entirely by Super PAC
// activity — not a defensible "PAC Score." When totalReceipts = 0 AND
// countsAgainst > 0, we now return pacScore = null ("no data") rather than
// computing a misleading score from IE alone. ingest-fec-receipts-multicycle
// was also widened to backfill from /candidate/{id}/totals/ for any
// legislator the bulk endpoint skipped, so this guard is a belt-and-braces
// safety net, not the primary fix.
//
// IE_OPPOSE is tracked separately (info-only): a Super PAC spending against
// the legislator doesn't change their score either way.

const COUNTS_AGAINST_CLASSES = ['CORPORATE', 'DARK_MONEY', 'FOREIGN_POLICY', 'LEADERSHIP'] as const;

// v1.9.4 outside-money weights. Single source of truth — every surface that
// computes PAC Score reads from here.
//
// Single-tier framework. Every money kind that touches the legislator's
// race counts at full weight. The legislator's committee accepted it
// (DIRECT), a JFC routed it to them (JFC_PASS_THROUGH), a colleague's
// leadership PAC routed it to them (LEADERSHIP_PASS_THROUGH), an outside
// group spent it directly FOR them (IE_SUPPORT), or an outside group spent
// it AGAINST their opponent (IE_OPPOSE_BENEFICIARY). As of v1.9.4,
// beneficiary money — corporate IE spent against the opponent — counts in
// the main score at full weight: money that cleared this legislator's path
// is money spent on their behalf.
//
// IE_OPPOSE (Super PAC spending against THIS legislator) doesn't appear
// here at all — it's never been in the counts-against numerator.
export const OUTSIDE_MONEY_WEIGHTS = {
  /** Full weight — accepted by the legislator's principal committee. */
  DIRECT: 1.0,
  /** Full weight — corp PAC → JFC → candidate apportionment. */
  JFC_PASS_THROUGH: 1.0,
  /** Full weight — corp PAC → LEADERSHIP PAC → candidate apportionment. */
  LEADERSHIP_PASS_THROUGH: 1.0,
  /** Full weight — outside group IE spent FOR the legislator. */
  IE_SUPPORT: 1.0,
  /** Full weight (v1.9.4) — corporate IE spent AGAINST the opponent, which
   * cleared this legislator's path. Now counts in the main PAC Score. */
  IE_OPPOSE_BENEFICIARY: 1.0,
} as const;

export interface PacMoneyTrail {
  countsAgainst: number; // $ from CORPORATE+DARK_MONEY+FOREIGN_POLICY+LEADERSHIP (counted; includes beneficiary as of v1.9.4)
  totalInfluence: number; // $ from all classes via DIRECT or IE_SUPPORT or JFC_PASS_THROUGH or LEADERSHIP_PASS_THROUGH or IE_OPPOSE_BENEFICIARY
  totalReceipts: number; // principal-committee 4-cycle receipts (the denominator base)
  denominator: number; // totalReceipts + IE_SUPPORT + IE_OPPOSE_BENEFICIARY — the score denominator
  pacScore: number | null; // (1 − counts_against / denominator) × 100 — simple mean of per-cycle ratios
  byClass: Record<string, number>; // direct + IE-support + JFC-passthrough + beneficiary per class
  ieOpposeTotal: number; // info only — Super PAC IE against this leg
  ieSupportTotal: number; // IE_SUPPORT subtotal (helpful for the page UI)
  jfcPassThroughTotal: number; // $ apportioned via JFCs (any class) — for the "via JFC" subline
  leadershipPassThroughTotal: number; // v1.9.0: $ apportioned via leadership PACs (any class) — for the "via leadership PAC" subline
  // v1.9.4 — beneficiary money (IE against a defeated opponent, counted
  // classes) now enters the MAIN PAC Score numerator + denominator. This
  // subtotal is retained purely as a display aggregate so the page can break
  // out how much of counts-against came via beneficiary spending.
  beneficiaryCountsAgainst: number; // $ from IE_OPPOSE_BENEFICIARY (counted classes only) — display aggregate
  // v1.9.4 — beneficiary is now in the headline PAC Score, so this equals
  // pacScore. Retained for callers that render an "alt view" panel; they
  // continue to compile and now show the same number as the headline.
  beneficiaryPacScore: number | null; // === pacScore as of v1.9.4
}

/**
 * v1.7.1 — bulk PAC scores for many legislators in one query. Used by the
 * index page so we don't fire N+1 sums. Returns Map<legislatorId, score|null>.
 */
export async function getPacScoresByLegislatorV171(legislatorIds: string[]): Promise<Map<string, number | null>> {
  if (legislatorIds.length === 0) return new Map();
  // v1.9.3 — SIMPLE MEAN of per-cycle ratios (every cycle weighted equally),
  // replacing the pooled (Σnumerator / Σdenominator) dollar-weighted ratio.
  // We aggregate counts-against, IE_SUPPORT, beneficiary, and receipts BY
  // (legislator, cycleYear), compute one ratio per cycle, then average the
  // per-cycle ratios in JS. This stops a single heavy-fundraising cycle from
  // dominating the displayed PAC Score.
  //
  // v1.9.4 single-tier counts-against numerator. Full weight on EVERY money
  // kind that touched the legislator's race: DIRECT, JFC_PASS_THROUGH,
  // LEADERSHIP_PASS_THROUGH, IE_SUPPORT (outside group IE FOR the legislator),
  // and IE_OPPOSE_BENEFICIARY (corporate IE spent AGAINST the opponent, which
  // cleared the legislator's path). Counted classes are CORPORATE, DARK_MONEY,
  // FOREIGN_POLICY, and LEADERSHIP. The per-cycle denominator is that cycle's
  // receipts + that cycle's IE_SUPPORT + that cycle's IE_OPPOSE_BENEFICIARY
  // (the same money kinds that can appear in the numerator).
  const contribAgg = await prisma.$queryRaw<
    Array<{ legislatorId: string; cycleYear: number; countsAgainst: string; ieSupport: string; beneficiary: string }>
  >`
    SELECT
      pcontrib."legislatorId" AS "legislatorId",
      pcontrib."cycleYear" AS "cycleYear",
      COALESCE(SUM(CASE
        WHEN pc.class IN ('CORPORATE', 'DARK_MONEY', 'FOREIGN_POLICY', 'LEADERSHIP')
         AND pcontrib.kind IN ('DIRECT', 'JFC_PASS_THROUGH', 'LEADERSHIP_PASS_THROUGH', 'IE_SUPPORT', 'IE_OPPOSE_BENEFICIARY')
        THEN pcontrib.amount::numeric
        ELSE 0
      END), 0)::text AS "countsAgainst",
      COALESCE(SUM(CASE
        WHEN pcontrib.kind = 'IE_SUPPORT'
        THEN pcontrib.amount::numeric
        ELSE 0
      END), 0)::text AS "ieSupport",
      COALESCE(SUM(CASE
        WHEN pcontrib.kind = 'IE_OPPOSE_BENEFICIARY'
        THEN pcontrib.amount::numeric
        ELSE 0
      END), 0)::text AS "beneficiary"
    FROM "PacContribution" pcontrib
    JOIN "PacClassification" pc ON pc."committeeId" = pcontrib."donorCommitteeId"
    WHERE pcontrib."legislatorId" = ANY(${legislatorIds})
    GROUP BY pcontrib."legislatorId", pcontrib."cycleYear"
  `;
  const receiptsAgg = await prisma.$queryRaw<
    Array<{ legislatorId: string; cycleYear: number; receipts: string; corpPct: string | null }>
  >`
    SELECT
      "legislatorId",
      "cycleYear",
      COALESCE(SUM("totalReceipts"::numeric), 0)::text AS receipts,
      MAX("corporatePacPercentage"::numeric)::text AS "corpPct"
    FROM "PacMoneyData"
    WHERE "legislatorId" = ANY(${legislatorIds})
    GROUP BY "legislatorId", "cycleYear"
  `;
  // receipts + FEC-summary corporate ratio keyed by (legislatorId, cycleYear).
  const receiptsByCycle = new Map<string, number>();
  const fecCorpRatioByCycle = new Map<string, number>();
  const cycleKey = (legId: string, cycle: number) => `${legId}|${cycle}`;
  for (const r of receiptsAgg) {
    const v = Number(r.receipts);
    if (Number.isFinite(v)) receiptsByCycle.set(cycleKey(r.legislatorId, r.cycleYear), v);
    const cp = r.corpPct == null ? NaN : Number(r.corpPct);
    if (Number.isFinite(cp)) fecCorpRatioByCycle.set(cycleKey(r.legislatorId, r.cycleYear), cp);
  }
  // Itemized counts-against / IE / beneficiary keyed by (legislatorId, cycleYear).
  const itemizedByCycle = new Map<string, { ca: number; ie: number; ben: number }>();
  for (const r of contribAgg) {
    itemizedByCycle.set(cycleKey(r.legislatorId, r.cycleYear), {
      ca: Number(r.countsAgainst) || 0,
      ie: Number(r.ieSupport) || 0,
      ben: Number(r.beneficiary) || 0,
    });
  }
  // Accumulate per-cycle ratios per legislator over EVERY cycle that has
  // receipts or itemized contributions, then take the simple mean.
  const sums = new Map<string, { sum: number; n: number }>();
  for (const key of new Set<string>([...receiptsByCycle.keys(), ...itemizedByCycle.keys()])) {
    const legId = key.slice(0, key.lastIndexOf('|'));
    const { ca, ie, ben } = itemizedByCycle.get(key) ?? { ca: 0, ie: 0, ben: 0 };
    const receipts = receiptsByCycle.get(key) ?? 0;
    // v1.9.7: skip any cycle without principal-committee receipts — IE-only /
    // dust cycles have a tiny-or-zero denominator that, combined with refund
    // (negative) counts-against, yields extreme ratios that poison the mean.
    if (receipts <= 0) continue;
    // v1.9.4 denominator = receipts + IE_SUPPORT + IE_OPPOSE_BENEFICIARY.
    const denom = receipts + (Number.isFinite(ie) ? ie : 0) + (Number.isFinite(ben) ? ben : 0);
    if (!Number.isFinite(denom) || denom <= 0) continue;
    const itemizedRatio = ca / denom;
    // FEC-summary fallback (v1.9.7): when itemized PAC contributions are
    // effectively un-ingested for this cycle (counts-against < 1% of denom)
    // but FEC's aggregate filing reports real corporate-PAC money, use the FEC
    // corporate ratio — otherwise a member whose itemized donors weren't
    // ingested renders a false 100% ("refuses all corporate money").
    const fecRatio = fecCorpRatioByCycle.get(key);
    // Clamp to [0,1]: refunds make ca negative and dust cycles make denom tiny,
    // either of which would otherwise yield a wild ratio that skews the mean.
    const ratio = Math.max(
      0,
      Math.min(1, ca < 0.01 * denom && fecRatio != null && fecRatio > itemizedRatio ? fecRatio : itemizedRatio),
    );
    const acc = sums.get(legId) ?? { sum: 0, n: 0 };
    acc.sum += ratio;
    acc.n += 1;
    sums.set(legId, acc);
  }
  const out = new Map<string, number | null>();
  for (const id of legislatorIds) out.set(id, null);
  for (const [id, acc] of sums) {
    if (acc.n === 0) continue;
    const meanRatio = acc.sum / acc.n;
    out.set(id, Math.max(0, Math.min(100, Math.round((1 - meanRatio) * 100))));
  }
  return out;
}

/**
 * v1.7.1 — full money trail for ONE legislator. Used by the detail page to
 * render counts-against, per-class breakdown, top donors, and IE-opposed.
 */
export async function getLegislatorMoneyTrail(legislatorId: string): Promise<PacMoneyTrail> {
  const rows = await prisma.$queryRaw<Array<{ class: string; kind: string; amount: string }>>`
    SELECT pc.class::text AS class, pcontrib.kind::text AS kind, SUM(pcontrib.amount::numeric)::text AS amount
    FROM "PacContribution" pcontrib
    JOIN "PacClassification" pc ON pc."committeeId" = pcontrib."donorCommitteeId"
    WHERE pcontrib."legislatorId" = ${legislatorId}
    GROUP BY pc.class, pcontrib.kind
  `;
  // Receipts (denominator base) — sum across all PacMoneyData cycles for this leg.
  const receiptsRows = await prisma.$queryRaw<Array<{ receipts: string }>>`
    SELECT COALESCE(SUM("totalReceipts"::numeric), 0)::text AS receipts
    FROM "PacMoneyData"
    WHERE "legislatorId" = ${legislatorId}
  `;
  const totalReceipts = receiptsRows.length > 0 ? Number(receiptsRows[0].receipts) || 0 : 0;

  // v1.9.4 — per-cycle aggregation, used to compute the displayed PAC Score as
  // the SIMPLE MEAN of each cycle's ratio (every cycle weighted equally),
  // EXACTLY matching getPacScoresByLegislatorV171 so the index and detail
  // pages agree for the same legislator. The dollar-sum breakdown further
  // below (byClass, totals, denominator) is intentionally left pooled across
  // cycles — it's a transparency view of total money, not the score.
  //
  // Single-tier (v1.9.4): the per-cycle counts-against numerator includes
  // IE_OPPOSE_BENEFICIARY at full weight in counted classes (CORPORATE,
  // DARK_MONEY, FOREIGN_POLICY, LEADERSHIP). The per-cycle denominator is
  // receipts + IE_SUPPORT (any class) + IE_OPPOSE_BENEFICIARY (any class).
  const perCycleContrib = await prisma.$queryRaw<
    Array<{ cycleYear: number; countsAgainst: string; ieSupport: string; beneficiary: string }>
  >`
    SELECT
      pcontrib."cycleYear" AS "cycleYear",
      COALESCE(SUM(CASE
        WHEN pc.class IN ('CORPORATE', 'DARK_MONEY', 'FOREIGN_POLICY', 'LEADERSHIP')
         AND pcontrib.kind IN ('DIRECT', 'JFC_PASS_THROUGH', 'LEADERSHIP_PASS_THROUGH', 'IE_SUPPORT', 'IE_OPPOSE_BENEFICIARY')
        THEN pcontrib.amount::numeric ELSE 0 END), 0)::text AS "countsAgainst",
      COALESCE(SUM(CASE
        WHEN pcontrib.kind = 'IE_SUPPORT' THEN pcontrib.amount::numeric ELSE 0 END), 0)::text AS "ieSupport",
      COALESCE(SUM(CASE
        WHEN pcontrib.kind = 'IE_OPPOSE_BENEFICIARY' THEN pcontrib.amount::numeric ELSE 0 END), 0)::text AS "beneficiary"
    FROM "PacContribution" pcontrib
    JOIN "PacClassification" pc ON pc."committeeId" = pcontrib."donorCommitteeId"
    WHERE pcontrib."legislatorId" = ${legislatorId}
    GROUP BY pcontrib."cycleYear"
  `;
  const perCycleReceipts = await prisma.$queryRaw<
    Array<{ cycleYear: number; receipts: string; corpPct: string | null }>
  >`
    SELECT "cycleYear", COALESCE(SUM("totalReceipts"::numeric), 0)::text AS receipts,
      MAX("corporatePacPercentage"::numeric)::text AS "corpPct"
    FROM "PacMoneyData"
    WHERE "legislatorId" = ${legislatorId}
    GROUP BY "cycleYear"
  `;
  const receiptsByCycle = new Map<number, number>();
  const fecCorpRatioByCycle = new Map<number, number>();
  for (const r of perCycleReceipts) {
    const v = Number(r.receipts);
    if (Number.isFinite(v)) receiptsByCycle.set(r.cycleYear, v);
    const cp = r.corpPct == null ? NaN : Number(r.corpPct);
    if (Number.isFinite(cp)) fecCorpRatioByCycle.set(r.cycleYear, cp);
  }
  const itemizedByCycle = new Map<number, { ca: number; ie: number; ben: number }>();
  for (const r of perCycleContrib) {
    itemizedByCycle.set(r.cycleYear, {
      ca: Number(r.countsAgainst) || 0,
      ie: Number(r.ieSupport) || 0,
      ben: Number(r.beneficiary) || 0,
    });
  }
  // v1.9.7 — simple mean of per-cycle ratios over every cycle with receipts or
  // itemized contributions, identical to getPacScoresByLegislatorV171, WITH the
  // FEC-summary fallback: when itemized PAC contributions are effectively
  // un-ingested (counts-against < 1% of denom) but FEC's aggregate filing shows
  // real corporate-PAC money, use the FEC corporate ratio so the member doesn't
  // render a false 100%. Numerator folds in IE_OPPOSE_BENEFICIARY; denominator
  // adds beneficiary alongside IE_SUPPORT. beneficiaryPacScore equals pacScore.
  let scoreRatioSum = 0;
  let scoreRatioN = 0;
  for (const cycle of new Set<number>([...receiptsByCycle.keys(), ...itemizedByCycle.keys()])) {
    const { ca, ie, ben } = itemizedByCycle.get(cycle) ?? { ca: 0, ie: 0, ben: 0 };
    const receipts = receiptsByCycle.get(cycle) ?? 0;
    // v1.9.7: skip any cycle without principal-committee receipts — IE-only /
    // dust cycles have a tiny-or-zero denominator that, combined with refund
    // (negative) counts-against, yields extreme ratios that poison the mean.
    if (receipts <= 0) continue;
    const denomCycle = receipts + ie + ben;
    if (denomCycle <= 0) continue;
    const itemizedRatio = ca / denomCycle;
    const fecRatio = fecCorpRatioByCycle.get(cycle);
    // Clamp to [0,1]: refunds make ca negative and dust cycles make denom tiny,
    // either of which would otherwise yield a wild ratio that skews the mean.
    const ratio = Math.max(
      0,
      Math.min(1, ca < 0.01 * denomCycle && fecRatio != null && fecRatio > itemizedRatio ? fecRatio : itemizedRatio),
    );
    scoreRatioSum += ratio;
    scoreRatioN += 1;
  }

  const byClass: Record<string, number> = {};
  let countsAgainst = 0; // DIRECT + JFC_PASS_THROUGH + LEADERSHIP_PASS_THROUGH + IE_SUPPORT + IE_OPPOSE_BENEFICIARY in counts-against classes
  let totalInfluence = 0;
  let ieOpposeTotal = 0;
  let ieSupportTotal = 0;
  let ieOpposeBeneficiaryTotal = 0; // any-class beneficiary, for the denominator
  let jfcPassThroughTotal = 0;
  let leadershipPassThroughTotal = 0;
  let beneficiaryCountsAgainst = 0;
  for (const r of rows) {
    const amt = Number(r.amount);
    if (!Number.isFinite(amt)) continue;
    if (r.kind === 'IE_OPPOSE') {
      ieOpposeTotal += amt;
      continue;
    }
    if (r.kind === 'IE_OPPOSE_BENEFICIARY') {
      // v1.9.4 — Full weight. Corporate IE spent AGAINST the opponent cleared
      // this legislator's path and now counts in the main PAC Score. Tracked
      // (any class) for the denominator; the counted-class slice is also kept
      // as a display subtotal (beneficiaryCountsAgainst).
      ieOpposeBeneficiaryTotal += amt;
      byClass[r.class] = (byClass[r.class] ?? 0) + amt;
      totalInfluence += amt;
      if ((COUNTS_AGAINST_CLASSES as readonly string[]).includes(r.class)) {
        beneficiaryCountsAgainst += amt;
        countsAgainst += amt;
      }
      continue;
    }
    if (r.kind === 'IE_SUPPORT') ieSupportTotal += amt;
    if (r.kind === 'JFC_PASS_THROUGH') jfcPassThroughTotal += amt;
    if (r.kind === 'LEADERSHIP_PASS_THROUGH') leadershipPassThroughTotal += amt;
    // Bucket DIRECT + IE_SUPPORT + JFC_PASS_THROUGH + LEADERSHIP_PASS_THROUGH by class for the breakdown display.
    byClass[r.class] = (byClass[r.class] ?? 0) + amt;
    totalInfluence += amt;
    if ((COUNTS_AGAINST_CLASSES as readonly string[]).includes(r.class)) {
      // v1.9.4 single-tier: every dollar that touched the legislator's race —
      // DIRECT, JFC_PASS_THROUGH, LEADERSHIP_PASS_THROUGH, IE_SUPPORT — counts
      // at full weight. (Beneficiary is folded in above.)
      countsAgainst += amt;
    }
  }
  // v1.9.4 single-tier — full weight on every dollar that touched the
  // legislator's race (DIRECT + JFC_PASS_THROUGH + LEADERSHIP_PASS_THROUGH +
  // IE_SUPPORT + IE_OPPOSE_BENEFICIARY). JFC + leadership pass-through dollars
  // are already in the principal-committee receipts on the denominator side; we
  // add their counts-against share to the numerator (when the original donor
  // was corp/dark/foreign/leadership). Denominator base = receipts +
  // IE_SUPPORT + IE_OPPOSE_BENEFICIARY (same money kinds the numerator can use).
  const denominator = totalReceipts + ieSupportTotal + ieOpposeBeneficiaryTotal;
  // v1.7.7 safety guard (mirrors getPacScoresByLegislatorV171): when there
  // are zero principal-committee receipts on record but real counts-against
  // activity exists, the resulting score is driven entirely by IE_SUPPORT
  // and reads as misleadingly low. Return null ("no data") in that case so
  // the UI renders a "no data" badge rather than a near-zero number.
  const noReceiptsData = totalReceipts <= 0 && countsAgainst > 0;
  // v1.9.3 — PAC Score is the SIMPLE MEAN of per-cycle ratios (scoreRatioN
  // cycles contributed a valid ratio). The no-receipts guard still gates the
  // whole legislator: if their only receipts gap coincides with counts-against
  // activity (noReceiptsData) we render "no data" rather than an IE-only score.
  // `denominator` (pooled) is retained for the money-trail breakdown display.
  const pacScore =
    !noReceiptsData && scoreRatioN > 0
      ? Math.max(0, Math.min(100, Math.round((1 - scoreRatioSum / scoreRatioN) * 100)))
      : null;
  // v1.9.4 — beneficiary money now lives in the main PAC Score, so the
  // "alt view" beneficiaryPacScore is just the headline score. Retained so
  // the detail page's alt-view panel keeps compiling and shows the same value.
  const beneficiaryPacScore = pacScore;
  return {
    countsAgainst,
    totalInfluence,
    totalReceipts,
    denominator,
    pacScore,
    byClass,
    ieOpposeTotal,
    ieSupportTotal,
    jfcPassThroughTotal,
    leadershipPassThroughTotal,
    beneficiaryCountsAgainst,
    beneficiaryPacScore,
  };
}

/**
 * v1.8.2 — PAC influence summed for the 2022 + 2024 cycles only, so the
 * "Individual vs PAC" tile on the legislator detail page can compare apples to
 * apples against `LegislatorIndividualMoney.totalItemized` (which is itself a
 * 2-cycle window — we never ingested 2018/2020 individual files). Without this
 * scoping the numerator is 2-cycle while the denominator includes 2018–2024
 * PAC dollars, biasing every legislator toward "PAC-heavy."
 *
 * Counts DIRECT + IE_SUPPORT only (same posture used by `totalInfluence` for
 * the tile, minus JFC pass-through, IE_OPPOSE, and IE_OPPOSE_BENEFICIARY).
 * Returns 0 if there is no matching contribution data — callers should treat
 * 0 as "no overlap," not "no money."
 */
export async function getLegislatorPacInfluence20222024(legislatorId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: string }>>`
    SELECT COALESCE(SUM(amount::numeric), 0)::text AS total
    FROM "PacContribution"
    WHERE "legislatorId" = ${legislatorId}
      AND "cycleYear" IN (2022, 2024)
      AND kind IN ('DIRECT', 'IE_SUPPORT')
  `;
  if (rows.length === 0) return 0;
  const n = Number(rows[0].total);
  return Number.isFinite(n) ? n : 0;
}

/**
 * v1.7.1 — top donor PACs for one legislator. Returns at most `limit` rows
 * sorted by total $ (DIRECT + IE_SUPPORT) descending. Includes the class
 * so the UI can badge them appropriately.
 */
export interface TopDonor {
  committeeId: string;
  name: string;
  class: string;
  total: number; // DIRECT + IE_SUPPORT + JFC_PASS_THROUGH + LEADERSHIP_PASS_THROUGH, summed across cycles
  ieOppose: number; // IE_OPPOSE same donor (often 0)
}

export async function getTopDonorsForLegislator(legislatorId: string, limit = 15): Promise<TopDonor[]> {
  const rows = await prisma.$queryRaw<
    Array<{ committeeId: string; name: string; class: string; total: string; ieOppose: string }>
  >`
    SELECT
      pc."committeeId" AS "committeeId",
      pc.name AS name,
      pc.class::text AS class,
      COALESCE(SUM(CASE WHEN pcontrib.kind IN ('DIRECT', 'IE_SUPPORT', 'JFC_PASS_THROUGH', 'LEADERSHIP_PASS_THROUGH')
                        THEN pcontrib.amount::numeric ELSE 0 END), 0)::text AS total,
      COALESCE(SUM(CASE WHEN pcontrib.kind = 'IE_OPPOSE'
                        THEN pcontrib.amount::numeric ELSE 0 END), 0)::text AS "ieOppose"
    FROM "PacContribution" pcontrib
    JOIN "PacClassification" pc ON pc."committeeId" = pcontrib."donorCommitteeId"
    WHERE pcontrib."legislatorId" = ${legislatorId}
    GROUP BY pc."committeeId", pc.name, pc.class
    HAVING COALESCE(SUM(CASE WHEN pcontrib.kind IN ('DIRECT', 'IE_SUPPORT', 'JFC_PASS_THROUGH', 'LEADERSHIP_PASS_THROUGH')
                             THEN pcontrib.amount::numeric ELSE 0 END), 0) > 0
    ORDER BY total DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    committeeId: r.committeeId,
    name: r.name,
    class: r.class,
    total: Number(r.total),
    ieOppose: Number(r.ieOppose),
  }));
}

/**
 * v1.7.1 — Super PACs that spent IE OPPOSING this legislator's campaign.
 * Tracked separately because it's info-only (doesn't affect their score)
 * but useful transparency ("AIPAC tried to defeat you").
 */
export async function getOpposedByPacs(legislatorId: string, limit = 10): Promise<TopDonor[]> {
  const rows = await prisma.$queryRaw<Array<{ committeeId: string; name: string; class: string; ieOppose: string }>>`
    SELECT
      pc."committeeId" AS "committeeId",
      pc.name AS name,
      pc.class::text AS class,
      SUM(pcontrib.amount::numeric)::text AS "ieOppose"
    FROM "PacContribution" pcontrib
    JOIN "PacClassification" pc ON pc."committeeId" = pcontrib."donorCommitteeId"
    WHERE pcontrib."legislatorId" = ${legislatorId}
      AND pcontrib.kind = 'IE_OPPOSE'
    GROUP BY pc."committeeId", pc.name, pc.class
    ORDER BY "ieOppose" DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    committeeId: r.committeeId,
    name: r.name,
    class: r.class,
    total: 0,
    ieOppose: Number(r.ieOppose),
  }));
}

// ─── v1.9.1 Outside-money surface (IE_SUPPORT + IE_OPPOSE_BENEFICIARY) ──────
//
// Independent expenditures from outside groups in a legislator's races. Two
// halves: money spent FOR the legislator (IE_SUPPORT) and money spent AGAINST
// their opponents (IE_OPPOSE_BENEFICIARY, credited to the seat winner via
// `attribute-ie-beneficiary.ts`). Under v1.9.1 weighting, IE_SUPPORT counts at
// full weight in the PAC Score (supported is supported); IE_OPPOSE_BENEFICIARY
// is transparency-only. The Money Trail tile shows IE_SUPPORT already; this
// surface adds an explicit "outside money in your races" section with class
// breakdown and top spenders, because dark-money flows like Warnock's $277M
// and Fetterman's $88M are material context for any honest reading of the race.

export interface OutsideMoneyClassRow {
  class: string;
  ieSupport: number;
  ieOpposeBeneficiary: number;
  total: number;
}

export interface OutsideMoneySpender {
  committeeId: string;
  name: string;
  class: string;
  ieSupport: number;
  ieOpposeBeneficiary: number;
  total: number;
}

export interface OutsideMoneySummary {
  ieSupportTotal: number;
  ieOpposeBeneficiaryTotal: number;
  byClass: OutsideMoneyClassRow[];
  topSpenders: OutsideMoneySpender[];
}

export async function getOutsideMoneyForLegislator(legislatorId: string, topLimit = 15): Promise<OutsideMoneySummary> {
  // Per-class roll-up for the headline tiles.
  const classRows = await prisma.$queryRaw<Array<{ class: string; ieSupport: string; ieOpposeBeneficiary: string }>>`
    SELECT
      pc.class::text AS class,
      COALESCE(SUM(CASE WHEN pcontrib.kind = 'IE_SUPPORT'
                        THEN pcontrib.amount::numeric ELSE 0 END), 0)::text AS "ieSupport",
      COALESCE(SUM(CASE WHEN pcontrib.kind = 'IE_OPPOSE_BENEFICIARY'
                        THEN pcontrib.amount::numeric ELSE 0 END), 0)::text AS "ieOpposeBeneficiary"
    FROM "PacContribution" pcontrib
    JOIN "PacClassification" pc ON pc."committeeId" = pcontrib."donorCommitteeId"
    WHERE pcontrib."legislatorId" = ${legislatorId}
      AND pcontrib.kind IN ('IE_SUPPORT', 'IE_OPPOSE_BENEFICIARY')
    GROUP BY pc.class
  `;

  // Top spenders ranked by combined outside spend in this leg's races.
  const spenderRows = await prisma.$queryRaw<
    Array<{ committeeId: string; name: string; class: string; ieSupport: string; ieOpposeBeneficiary: string }>
  >`
    SELECT
      pc."committeeId" AS "committeeId",
      pc.name AS name,
      pc.class::text AS class,
      COALESCE(SUM(CASE WHEN pcontrib.kind = 'IE_SUPPORT'
                        THEN pcontrib.amount::numeric ELSE 0 END), 0)::text AS "ieSupport",
      COALESCE(SUM(CASE WHEN pcontrib.kind = 'IE_OPPOSE_BENEFICIARY'
                        THEN pcontrib.amount::numeric ELSE 0 END), 0)::text AS "ieOpposeBeneficiary"
    FROM "PacContribution" pcontrib
    JOIN "PacClassification" pc ON pc."committeeId" = pcontrib."donorCommitteeId"
    WHERE pcontrib."legislatorId" = ${legislatorId}
      AND pcontrib.kind IN ('IE_SUPPORT', 'IE_OPPOSE_BENEFICIARY')
    GROUP BY pc."committeeId", pc.name, pc.class
    HAVING COALESCE(SUM(pcontrib.amount::numeric), 0) > 0
    ORDER BY COALESCE(SUM(pcontrib.amount::numeric), 0) DESC
    LIMIT ${topLimit}
  `;

  let ieSupportTotal = 0;
  let ieOpposeBeneficiaryTotal = 0;
  const byClass: OutsideMoneyClassRow[] = classRows.map((r) => {
    const ies = Number(r.ieSupport);
    const ieob = Number(r.ieOpposeBeneficiary);
    ieSupportTotal += ies;
    ieOpposeBeneficiaryTotal += ieob;
    return { class: r.class, ieSupport: ies, ieOpposeBeneficiary: ieob, total: ies + ieob };
  });
  byClass.sort((a, b) => b.total - a.total);

  const topSpenders: OutsideMoneySpender[] = spenderRows.map((r) => {
    const ies = Number(r.ieSupport);
    const ieob = Number(r.ieOpposeBeneficiary);
    return {
      committeeId: r.committeeId,
      name: r.name,
      class: r.class,
      ieSupport: ies,
      ieOpposeBeneficiary: ieob,
      total: ies + ieob,
    };
  });

  return { ieSupportTotal, ieOpposeBeneficiaryTotal, byClass, topSpenders };
}

// ─── v1.7.2 Leadership PAC inflows ──────────────────────────────────────────
//
// Many federal legislators sponsor a "leadership PAC" (cm.txt CMTE_DSGN='D'):
// a legally separate committee that collects PAC + individual money and then
// redistributes to other candidates. Corporate PACs prefer leadership PACs
// because contribution limits are looser. These dollars don't count toward
// the sponsor's PAC Score (it's not their campaign money), but they ARE an
// influence signal worth surfacing on the detail page: "your leadership PAC
// took $X from concentrated-wealth donors."
//
// Mapping: PacClassification.affiliatedLegislatorId is set by
// scripts/map-leadership-pacs.ts. Inflows live in LeadershipPacInflow.

export interface LeadershipPacInflowDonor {
  committeeId: string;
  name: string;
  class: string;
  total: number; // $ from this donor across this leg's leadership PACs (all cycles)
}

export interface LeadershipPacInflows {
  pacCount: number;
  totalAll: number; // sum across all donor classes
  totalCounted: number; // CORPORATE + DARK_MONEY + FOREIGN_POLICY only
  pacs: Array<{ committeeId: string; name: string; counted: number; all: number }>;
  topDonors: LeadershipPacInflowDonor[];
}

export async function getLegislatorLeadershipPacInflows(legislatorId: string): Promise<LeadershipPacInflows | null> {
  // Discover this legislator's leadership PACs.
  const lpacs = await prisma.pacClassification.findMany({
    where: { affiliatedLegislatorId: legislatorId },
    select: { committeeId: true, name: true },
  });
  if (lpacs.length === 0) return null;
  const lpacIds = lpacs.map((p) => p.committeeId);

  // Per-PAC totals (counted = corp/dark/foreign donors only)
  const perPac = await prisma.$queryRaw<Array<{ leadershipPacId: string; counted: string; all: string }>>`
    SELECT
      lpi."leadershipPacId" AS "leadershipPacId",
      COALESCE(SUM(CASE WHEN pc.class IN ('CORPORATE','DARK_MONEY','FOREIGN_POLICY')
                        THEN lpi.amount::numeric ELSE 0 END), 0)::text AS counted,
      COALESCE(SUM(lpi.amount::numeric), 0)::text AS all
    FROM "LeadershipPacInflow" lpi
    JOIN "PacClassification" pc ON pc."committeeId" = lpi."donorCommitteeId"
    WHERE lpi."leadershipPacId" = ANY(${lpacIds})
    GROUP BY lpi."leadershipPacId"
  `;
  const perPacMap = new Map(perPac.map((r) => [r.leadershipPacId, { counted: Number(r.counted), all: Number(r.all) }]));

  // Top donors across all of this leg's leadership PACs (counted classes preferred at the top).
  const donors = await prisma.$queryRaw<Array<{ committeeId: string; name: string; class: string; total: string }>>`
    SELECT pc."committeeId" AS "committeeId",
           pc.name AS name,
           pc.class::text AS class,
           SUM(lpi.amount::numeric)::text AS total
    FROM "LeadershipPacInflow" lpi
    JOIN "PacClassification" pc ON pc."committeeId" = lpi."donorCommitteeId"
    WHERE lpi."leadershipPacId" = ANY(${lpacIds})
    GROUP BY pc."committeeId", pc.name, pc.class
    ORDER BY total DESC
    LIMIT 15
  `;

  let totalAll = 0;
  let totalCounted = 0;
  const pacs = lpacs.map((p) => {
    const stats = perPacMap.get(p.committeeId) ?? { counted: 0, all: 0 };
    totalAll += stats.all;
    totalCounted += stats.counted;
    return { committeeId: p.committeeId, name: p.name, counted: stats.counted, all: stats.all };
  });

  return {
    pacCount: lpacs.length,
    totalAll,
    totalCounted,
    pacs,
    topDonors: donors.map((d) => ({
      committeeId: d.committeeId,
      name: d.name,
      class: d.class,
      total: Number(d.total),
    })),
  };
}

// ─── v1.7.5 Individual contributions ────────────────────────────────────────
//
// The ~53%-of-all-money layer the PAC Score is blind to. Itemized individual
// contributions (≥$200) to the legislator's principal committee, aggregated
// per cycle with the top employers by dollar. Sourced from FEC indiv{YY}.txt.

export interface IndividualMoneyEmployer {
  employer: string;
  total: number;
  count: number;
}

export interface IndustryMixRow {
  sector: string; // IndustrySector key
  label: string; // human label
  total: number;
  pctOfClassified: number; // share of the CLASSIFIED total (excludes unclassified)
}

export interface IndividualMoney {
  totalItemized: number; // summed across all ingested cycles
  contributionCount: number;
  cyclesAvailable: number[]; // which cycles we have data for
  topEmployers: IndividualMoneyEmployer[]; // merged + re-ranked across cycles
  // v1.7.6 industry rollup — sectors of the top reported employers. Computed
  // from the stored top-employers (catch-alls already filtered at ingest), so
  // this is "industry mix of your largest employer-affiliated donor blocs."
  industryMix: IndustryMixRow[]; // ranked, classified sectors only
  industryClassifiedTotal: number; // $ we could assign to a sector
  industryUnclassifiedTotal: number; // $ from employers with no industry signal
}

export async function getLegislatorIndividualMoney(legislatorId: string): Promise<IndividualMoney | null> {
  const rows = await prisma.legislatorIndividualMoney.findMany({
    where: { legislatorId },
    select: { cycleYear: true, totalItemized: true, contributionCount: true, topEmployers: true },
    orderBy: { cycleYear: 'desc' },
  });
  if (rows.length === 0) return null;

  let totalItemized = 0;
  let contributionCount = 0;
  const cyclesAvailable: number[] = [];
  // Merge per-cycle top-employer lists by summing the same employer across cycles.
  const merged = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    totalItemized += Number(r.totalItemized);
    contributionCount += r.contributionCount;
    cyclesAvailable.push(r.cycleYear);
    const emps = (r.topEmployers as Array<{ employer: string; total: number; count: number }>) ?? [];
    for (const e of emps) {
      const cur = merged.get(e.employer) ?? { total: 0, count: 0 };
      cur.total += e.total;
      cur.count += e.count;
      merged.set(e.employer, cur);
    }
  }
  const topEmployers = [...merged.entries()]
    .map(([employer, v]) => ({ employer, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  // Industry rollup: classify every merged employer, sum by sector.
  const bySector = new Map<string, number>();
  let industryClassifiedTotal = 0;
  let industryUnclassifiedTotal = 0;
  for (const [employer, v] of merged) {
    const sector = classifyEmployer(employer);
    if (sector === 'UNCLASSIFIED') {
      industryUnclassifiedTotal += v.total;
      continue;
    }
    bySector.set(sector, (bySector.get(sector) ?? 0) + v.total);
    industryClassifiedTotal += v.total;
  }
  const industryMix: IndustryMixRow[] = [...bySector.entries()]
    .map(([sector, total]) => ({
      sector,
      label: SECTOR_LABEL[sector as keyof typeof SECTOR_LABEL] ?? sector,
      total,
      pctOfClassified: industryClassifiedTotal > 0 ? (total / industryClassifiedTotal) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    totalItemized,
    contributionCount,
    cyclesAvailable,
    topEmployers,
    industryMix,
    industryClassifiedTotal,
    industryUnclassifiedTotal,
  };
}

// ─── v1.7.6 DIME donor-ideology + small-dollar profile ──────────────────────
//
// Whole-base funding-character metrics from Adam Bonica's DIME, sidestepping
// the "single employer = 2.5% of base" noise. Uses the most-recent cycle for
// ideology (a point-in-time estimate) and sums money across cycles for the
// small-dollar ratio.

export interface DimeProfile {
  cycleYear: number; // most recent cycle we have a profile for
  contributorCfscore: number | null; // donor-base ideology (−left/+right)
  recipientCfscore: number | null; // candidate's own ideology
  smallDollarPct: number | null; // unitemized / (unitemized + itemized individual) × 100
  totalIndivContribs: number; // itemized individual (summed across cycles)
  totalUnitemized: number; // small-dollar <$200 (summed)
  totalPacContribs: number; // (summed)
  totalReceipts: number; // (summed)
  cyclesAvailable: number[];
}

export async function getLegislatorDimeProfile(legislatorId: string): Promise<DimeProfile | null> {
  const rows = await prisma.legislatorDimeProfile.findMany({
    where: { legislatorId },
    orderBy: { cycleYear: 'desc' },
  });
  if (rows.length === 0) return null;

  // Ideology: take the most-recent cycle that actually has a contributor score.
  const mostRecent = rows[0];
  const ideologyRow = rows.find((r) => r.contributorCfscore !== null) ?? mostRecent;

  let indiv = 0;
  let unitemized = 0;
  let pac = 0;
  let receipts = 0;
  const cyclesAvailable: number[] = [];
  for (const r of rows) {
    indiv += Number(r.totalIndivContribs);
    unitemized += Number(r.totalUnitemized);
    pac += Number(r.totalPacContribs);
    receipts += Number(r.totalReceipts);
    cyclesAvailable.push(r.cycleYear);
  }
  // small-dollar % = unitemized / (unitemized + itemized individual). DIME's
  // total.indiv.contribs is itemized-only, so the denominator is the sum
  // (avoids the >100% artifact from dividing by itemized alone).
  const indivTotal = unitemized + indiv;
  const smallDollarPct = indivTotal > 0 ? (unitemized / indivTotal) * 100 : null;

  return {
    cycleYear: mostRecent.cycleYear,
    contributorCfscore: ideologyRow.contributorCfscore,
    recipientCfscore: ideologyRow.recipientCfscore,
    smallDollarPct,
    totalIndivContribs: indiv,
    totalUnitemized: unitemized,
    totalPacContribs: pac,
    totalReceipts: receipts,
    cyclesAvailable,
  };
}

/**
 * v1.7.1 — Bill-level breakdown of one legislator's scoring universe.
 *
 * Returns, for every plank, the bills that contribute to the legislator's
 * Voting Score and how they were counted: voted aligned, voted misaligned,
 * no vote on record, cosponsored, or sponsored as a marker bill.
 *
 * Used by the legislator detail page to make every percent traceable to
 * the specific bills behind it. A 38% on Plank 2 means "of the X
 * plank-2-tagged bills in your chamber, you supported Y" — and here are
 * the X bills with your position on each.
 *
 * Returns: Map<plankNumber, { bills: BillBreakdownRow[] }>
 */
export interface BillBreakdownRow {
  billType: string;
  billNumber: string;
  billTitle: string | null;
  source: 'rollcall' | 'marker'; // which side of the universe this bill came from
  alignedPosition: 'YES' | 'NO' | null; // what was the platform-aligned position
  legPosition: 'YES' | 'NO' | 'NOT_VOTING' | 'EXCUSED' | 'PRESENT' | null; // null = no vote on record
  cosponsored: boolean;
  isAligned: boolean; // final v1.7.1 decision: did this leg support this bill?
  markerName: string | null; // populated only when source = 'marker'
}

export interface PlankBreakdown {
  plankNumber: number;
  bills: BillBreakdownRow[];
}

export async function getLegislatorBillBreakdown(
  legislatorId: string,
  jurisdiction: ScorecardJurisdiction,
  legChamber: 'SEN' | 'REP',
): Promise<Map<number, PlankBreakdown>> {
  // 1. Roll-call universe (chamber-gated). Same filter the compute uses.
  const rcChambers =
    jurisdiction === 'FEDERAL'
      ? legChamber === 'SEN'
        ? ['SENATE']
        : ['HOUSE']
      : legChamber === 'SEN'
      ? ['CA_SENATE']
      : ['CA_ASSEMBLY'];
  // v2.0: the roll-call layer is restricted to the human-CURATED vote-bills so
  // the displayed breakdown matches the scored basis (no auto-classified net).
  // CA has no curated votes yet → this is empty for CA (markers-only breakdown).
  const rcVotes = await prisma.rollCallVote.findMany({
    where: {
      chamber: { in: rcChambers as ('SENATE' | 'HOUSE' | 'CA_SENATE' | 'CA_ASSEMBLY')[] },
      OR: CURATED_VOTE_BILLS.map((b) => ({
        congressNumber: b.congress,
        billType: b.billType,
        billNumber: b.billNumber,
      })),
    },
    select: {
      id: true,
      congressNumber: true,
      billType: true,
      billNumber: true,
      billTitle: true,
      plankNumbers: true,
      alignedPosition: true,
      positions: { where: { legislatorId }, select: { position: true } },
    },
  });

  // 2. Legislator's cosponsor set (jurisdiction-scoped).
  const cosponsors = await prisma.billCosponsor.findMany({
    where: { legislatorId, jurisdiction },
    select: { billType: true, billNumber: true },
  });
  const cosponsorKeys = new Set(cosponsors.map((c) => `${c.billType}|${c.billNumber}`));

  // 3. Marker bills for this jurisdiction. Match compute logic.
  const markers = await prisma.marker.findMany({
    where: { plank: { jurisdiction } },
    include: {
      plank: { select: { number: true } },
      bills: {
        select: {
          billType: true,
          billNumber: true,
          billTitle: true,
        },
      },
    },
  });

  const STORAGE_TYPE_MAP: Record<string, string> = {
    HOUSE_BILL: 'HR',
    SENATE_BILL: 'S',
    HOUSE_JOINT_RES: 'HJRES',
    SENATE_JOINT_RES: 'SJRES',
    HOUSE_CONCURRENT_RES: 'HCONRES',
    SENATE_CONCURRENT_RES: 'SCONRES',
    HOUSE_RES: 'HRES',
    SENATE_RES: 'SRES',
    CA_ASSEMBLY_BILL: 'CA_BILL',
    CA_SENATE_BILL: 'CA_BILL',
    CA_HOUSE_BILL: 'CA_BILL',
  };
  const stripBillNum = (raw: string) => raw.match(/\d+/)?.[0] ?? null;

  const byPlank = new Map<number, PlankBreakdown>();
  // Use bill-level dedup keyed by (storage-form billType|billNumber). A bill
  // may surface from BOTH roll-call and marker sources — we keep the marker
  // metadata if so but use whichever path has more information.
  const seen = new Map<number, Set<string>>(); // plank → bill key set

  // 1a. Reduce roll-call votes into bill-level aggregates (the compute does
  // the same — pick the leg's most-aligned position across multiple roll
  // calls on the same bill).
  interface BillAgg {
    chamber: string;
    billType: string;
    billNumber: string;
    billTitle: string | null;
    plankNumbers: number[];
    alignedPosition: 'YES' | 'NO';
    legPosition: 'YES' | 'NO' | 'NOT_VOTING' | 'EXCUSED' | 'PRESENT' | null;
    votedAligned: boolean;
  }
  const billAggs = new Map<string, BillAgg>();
  for (const v of rcVotes) {
    if (!v.billType || !v.billNumber) continue;
    // v2.0: use the HUMAN-curated direction + plank(s), not the DB auto-classified
    // ones. A bill can be curated under multiple planks (e.g. IRA → P2 climate
    // + P4 drug-pricing); show it under each. Keyed by (congress, type, number).
    const cong = v.congressNumber;
    const dir = curatedDirection(cong, v.billType, v.billNumber);
    if (!dir) continue;
    const planksFor = CURATED_VOTE_BILLS.filter(
      (b) => b.congress === cong && b.billType === v.billType && b.billNumber === v.billNumber,
    ).map((b) => b.plank);
    const key = `${cong}|${v.billType}|${v.billNumber}`;
    const legPos = v.positions[0]?.position ?? null;
    const isAligned = legPos === dir; // only a cast YES/NO can match
    const existing = billAggs.get(key);
    if (!existing) {
      billAggs.set(key, {
        chamber: rcChambers[0],
        billType: v.billType,
        billNumber: v.billNumber,
        billTitle: v.billTitle ?? null,
        plankNumbers: planksFor,
        alignedPosition: dir,
        legPosition: legPos as BillAgg['legPosition'],
        votedAligned: isAligned,
      });
    } else {
      if (isAligned) existing.votedAligned = true;
      // Prefer a real cast YES/NO over a procedural/absent position from another roll call.
      const haveCast = existing.legPosition === 'YES' || existing.legPosition === 'NO';
      if (!haveCast && legPos) existing.legPosition = legPos as BillAgg['legPosition'];
    }
  }

  function pushRow(plankNum: number, row: BillBreakdownRow) {
    let pb = byPlank.get(plankNum);
    if (!pb) {
      pb = { plankNumber: plankNum, bills: [] };
      byPlank.set(plankNum, pb);
    }
    pb.bills.push(row);
    let s = seen.get(plankNum);
    if (!s) {
      s = new Set();
      seen.set(plankNum, s);
    }
    s.add(`${row.billType}|${row.billNumber}`);
  }

  // 4. Emit roll-call rows.
  for (const a of billAggs.values()) {
    const cosponsored = cosponsorKeys.has(`${a.billType}|${a.billNumber}`);
    const isAligned = a.votedAligned || cosponsored;
    for (const plankNum of a.plankNumbers) {
      pushRow(plankNum, {
        billType: a.billType,
        billNumber: a.billNumber,
        billTitle: a.billTitle,
        source: 'rollcall',
        alignedPosition: a.alignedPosition,
        legPosition: a.legPosition,
        cosponsored,
        isAligned,
        markerName: null,
      });
    }
  }

  // 5. Emit marker rows (cross-chamber; dedup against roll-call rows).
  for (const m of markers) {
    if (m.bills.length === 0) continue;
    const plankNum = m.plank.number;
    const alreadyHave = seen.get(plankNum);
    // Compute alignment ACROSS all of the marker's bills — sponsoring any of
    // them counts as aligned on the marker. Pick the bill with the most-aligned
    // signal (sponsored > anything) as the representative row.
    let representative: BillBreakdownRow | null = null;
    let anyAligned = false;
    for (const b of m.bills) {
      const storageType = STORAGE_TYPE_MAP[b.billType];
      if (!storageType) continue;
      const num = stripBillNum(b.billNumber);
      if (!num) continue;
      const billNumStored = jurisdiction === 'CA' ? b.billNumber : num;
      const key = `${storageType}|${billNumStored}`;
      // Skip if this exact bill is already counted via roll-call universe —
      // it's already in the breakdown for this plank.
      if (alreadyHave?.has(key)) {
        // But the existing row may not credit cosponsorship of THIS marker's
        // bill if it wasn't in the leg's cosponsor set. The compute counts
        // marker-bill-sponsored as aligned regardless, so flag it.
        // For UI simplicity we'll leave the roll-call row as-is — it already
        // has the cosponsored flag if it applies.
        const cosp = cosponsorKeys.has(key);
        if (cosp) anyAligned = true;
        if (!representative && cosp)
          representative = {
            billType: storageType,
            billNumber: billNumStored,
            billTitle: b.billTitle ?? null,
            source: 'marker',
            alignedPosition: 'YES',
            legPosition: null,
            cosponsored: cosp,
            isAligned: cosp,
            markerName: m.name,
          };
        continue;
      }
      const cosp = cosponsorKeys.has(key);
      if (cosp) anyAligned = true;
      if (!representative || (cosp && !representative.cosponsored)) {
        representative = {
          billType: storageType,
          billNumber: billNumStored,
          billTitle: b.billTitle ?? null,
          source: 'marker',
          alignedPosition: 'YES',
          legPosition: null,
          cosponsored: cosp,
          isAligned: cosp,
          markerName: m.name,
        };
      }
    }
    if (representative) {
      representative.isAligned = anyAligned;
      pushRow(plankNum, representative);
    }
  }

  // 6. Sort each plank's bills: aligned first, then by bill number.
  for (const pb of byPlank.values()) {
    pb.bills.sort((a, b) => {
      if (a.isAligned !== b.isAligned) return a.isAligned ? -1 : 1;
      // Marker bills (cosponsorship-driven) above pure roll-call when aligned same
      if (a.source !== b.source) return a.source === 'marker' ? -1 : 1;
      return a.billNumber.localeCompare(b.billNumber, undefined, { numeric: true });
    });
  }

  return byPlank;
}

/**
 * Per-plank coverage stat: how many of the plank's markers have a
 * three-state position record (ACTED_FOR or ACTED_AGAINST) for this
 * legislator. NO_RECORD markers are not counted as coverage. Used by
 * the legislator detail page to render an "X of Y measured" indicator
 * — so a 0/5 score under thin coverage doesn't get treated as if the
 * legislator opposed everything.
 */
export interface PlankCoverage {
  plankId: string;
  totalMarkers: number; // markers we COULD measure (have bills or non-bill source)
  rawMarkerCount: number; // total markers including ones we can't measure
  measuredMarkers: number; // markers with an actionTaken row (either side)
  forCount: number;
  againstCount: number;
}

/**
 * Per-plank coverage stat. `totalMarkers` excludes markers that have no
 * seeded bills AND no non-bill source (PAC data, etc.) — counting them
 * would unfairly drag down coverage for every legislator since the
 * denominator includes markers we never built data for. `rawMarkerCount`
 * preserves the original total for any caller that wants the
 * methodology denominator.
 *
 * The "PAC marker" exception: the corporate-pac-refusal marker has no
 * bills but DOES have non-bill data (PacMoneyData). We detect this by
 * checking the marker slug — slugs containing "pac-refusal" are
 * treated as measurable even without bills.
 */
export function computePlankCoverage(
  planks: Array<{
    id: string;
    markers: Array<{ id: string; slug?: string; bills?: Array<unknown> }>;
  }>,
  achievements: Array<{ markerId: string; actionTaken?: 'ACTED_FOR' | 'ACTED_AGAINST' | 'NO_RECORD' | null }>,
): Map<string, PlankCoverage> {
  const result = new Map<string, PlankCoverage>();
  const byMarker = new Map(achievements.map((a) => [a.markerId, a.actionTaken ?? null]));
  for (const p of planks) {
    let measurable = 0;
    let measured = 0;
    let forCount = 0;
    let againstCount = 0;
    for (const m of p.markers) {
      const hasBills = Array.isArray(m.bills) && m.bills.length > 0;
      const isPacMarker = !!m.slug && m.slug.includes('pac-refusal');
      const isMeasurable = hasBills || isPacMarker;
      if (!isMeasurable) continue;
      measurable += 1;
      const t = byMarker.get(m.id);
      if (t === 'ACTED_FOR') {
        measured += 1;
        forCount += 1;
      } else if (t === 'ACTED_AGAINST') {
        measured += 1;
        againstCount += 1;
      }
    }
    result.set(p.id, {
      plankId: p.id,
      totalMarkers: measurable,
      rawMarkerCount: p.markers.length,
      measuredMarkers: measured,
      forCount,
      againstCount,
    });
  }
  return result;
}

/**
 * Resolves a MarkerBill by publicSlug, cuid, or human bill_number ("AB-2200").
 * Bill-number lookup matters because most marker bills have no publicSlug
 * and we still want shareable URLs like /scorecard/bills/AB-2200.
 *
 * Returns the bill PLUS sibling bills under the same marker (for cases
 * like CalCare where AB-1900 is the current vehicle and AB-2200 is the
 * historical predecessor — both are relevant on a single page).
 */
export async function findBillByAnyId(idOrSlug: string) {
  if (!idOrSlug) return null;
  return prisma.markerBill.findFirst({
    where: {
      OR: [{ id: idOrSlug }, { publicSlug: idOrSlug }, { billNumber: idOrSlug }],
    },
    include: {
      marker: {
        include: { plank: { select: { id: true, number: true, name: true, slug: true, jurisdiction: true } } },
      },
      votes: {
        include: {
          legislator: {
            select: {
              id: true,
              bioguideId: true,
              openStatesId: true,
              fullName: true,
              chamber: true,
              state: true,
              district: true,
              party: true,
              photoUrl: true,
            },
          },
        },
        orderBy: [{ position: 'asc' }, { legislator: { lastName: 'asc' } }],
      },
      sponsorships: {
        include: {
          legislator: {
            select: {
              id: true,
              bioguideId: true,
              openStatesId: true,
              fullName: true,
              chamber: true,
              state: true,
              district: true,
              party: true,
              photoUrl: true,
            },
          },
        },
        orderBy: [{ sponsorTier: 'asc' }, { sponsorOrder: 'asc' }, { legislator: { lastName: 'asc' } }],
      },
    },
  });
}

/**
 * Returns sibling MarkerBills under the same marker as the given bill,
 * EXCLUDING the bill itself. Used by the bill page to render data from
 * related bills (e.g. AB-2200's historical committee vote on the
 * AB-1900 "calcare" page so both vehicles appear together).
 */
export async function findSiblingBills(markerId: string, excludeBillId: string) {
  return prisma.markerBill.findMany({
    where: { markerId, id: { not: excludeBillId } },
    include: {
      votes: {
        include: {
          legislator: {
            select: {
              id: true,
              bioguideId: true,
              openStatesId: true,
              fullName: true,
              chamber: true,
              state: true,
              district: true,
              party: true,
              photoUrl: true,
            },
          },
        },
        orderBy: [{ position: 'asc' }, { legislator: { lastName: 'asc' } }],
      },
      sponsorships: {
        include: {
          legislator: {
            select: {
              id: true,
              bioguideId: true,
              openStatesId: true,
              fullName: true,
              chamber: true,
              state: true,
              district: true,
              party: true,
              photoUrl: true,
            },
          },
        },
        orderBy: [{ sponsorTier: 'asc' }, { sponsorOrder: 'asc' }, { legislator: { lastName: 'asc' } }],
      },
    },
    // Most-recent congress first so the historical predecessor renders below the current vehicle.
    orderBy: [{ congressNumber: 'desc' }],
  });
}

/**
 * Returns featured bills for the scorecard index "Featured Issues" rail.
 * A bill is featured when MarkerBill.isFeatured is true.
 */
export async function getFeaturedBills(jurisdiction?: ScorecardJurisdiction) {
  return prisma.markerBill.findMany({
    where: {
      isFeatured: true,
      ...(jurisdiction ? { marker: { plank: { jurisdiction } } } : {}),
    },
    include: {
      marker: {
        include: { plank: { select: { number: true, name: true, jurisdiction: true } } },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Returns the v1.4+ raw→percent calibration anchors for the given methodology
 * version, or null if no calibration row has been computed yet. `compute-scores`
 * writes one row per methodology version, holding the 95th/5th percentiles of
 * raw scores observed during that pass. Callers should fall back to a sensible
 * default ({ positiveAnchor: 25, negativeAnchor: -10 } today) when null so the
 * page still renders before the first compute pass on a new version.
 */
export interface ScoreCalibration {
  positiveAnchor: number;
  negativeAnchor: number;
}

export async function getScoreCalibration(version: string): Promise<ScoreCalibration | null> {
  const row = await prisma.scoreCalibration.findUnique({
    where: { methodologyVersion: version },
    select: { positiveAnchor: true, negativeAnchor: true },
  });
  if (!row) return null;
  return {
    positiveAnchor: Number(row.positiveAnchor),
    negativeAnchor: Number(row.negativeAnchor),
  };
}

// v1.8.14 — Ghost beneficiary surface. Reads from GhostBeneficiary, the
// aggregate of IE_OPPOSE dollars in seat-cycles whose winner is no longer
// in our active legislator set (defeated next cycle, retired, ran for a
// different office). These dollars are spent but not yet attributable —
// the surface keeps them visible rather than letting them silently
// disappear from the per-legislator Beneficiary PAC view.
export interface GhostBeneficiaryRow {
  state: string;
  district: string | null;
  chamber: 'HOUSE' | 'SENATE';
  cycleYear: number;
  totalAgainst: number;
  rowCount: number;
}

export async function getAllGhostBeneficiaries(): Promise<GhostBeneficiaryRow[]> {
  const rows = await prisma.ghostBeneficiary.findMany({
    orderBy: { totalAgainst: 'desc' },
  });
  return rows.map((r) => ({
    state: r.state,
    district: r.district,
    chamber: r.chamber as 'HOUSE' | 'SENATE',
    cycleYear: r.cycleYear,
    totalAgainst: Number(r.totalAgainst),
    rowCount: r.rowCount,
  }));
}

// For a single seat (state + chamber + district), return every prior-cycle
// ghost-beneficiary row. The race page uses this to render the per-seat
// transparency note. District is the numeric district as a string for
// House seats; null for Senate.
export async function getGhostBeneficiariesForSeat(
  state: string,
  chamber: 'HOUSE' | 'SENATE',
  district: string | null,
): Promise<GhostBeneficiaryRow[]> {
  const rows = await prisma.ghostBeneficiary.findMany({
    where: { state, chamber, district },
    orderBy: { cycleYear: 'desc' },
  });
  return rows.map((r) => ({
    state: r.state,
    district: r.district,
    chamber: r.chamber as 'HOUSE' | 'SENATE',
    cycleYear: r.cycleYear,
    totalAgainst: Number(r.totalAgainst),
    rowCount: r.rowCount,
  }));
}

export async function getGhostBeneficiaryTotals(): Promise<{
  totalDollars: number;
  totalRows: number;
  houseDollars: number;
  senateDollars: number;
}> {
  const all = await getAllGhostBeneficiaries();
  let house = 0;
  let senate = 0;
  for (const r of all) {
    if (r.chamber === 'HOUSE') house += r.totalAgainst;
    else senate += r.totalAgainst;
  }
  return {
    totalDollars: house + senate,
    totalRows: all.length,
    houseDollars: house,
    senateDollars: senate,
  };
}

/**
 * Plank summary (slug, number, name, descriptions) for one jurisdiction.
 * Used by the issue-scorecard pages to render the issue index and detail
 * headers without re-querying markers/bills. Returns null when the slug
 * does not exist for that jurisdiction (e.g. plank 5 under CA).
 */
export async function getPlankBySlug(jurisdiction: ScorecardJurisdiction, slug: string) {
  return prisma.plank.findFirst({
    where: { jurisdiction, slug },
    select: {
      id: true,
      jurisdiction: true,
      slug: true,
      number: true,
      name: true,
      shortDescription: true,
      tagline: true,
      body: true,
      color: true,
    },
  });
}

export interface PlankLegislatorScoreRow {
  id: string;
  bioguideId: string | null;
  openStatesId: string | null;
  fullName: string;
  party: string;
  chamber: string;
  state: string;
  district: number | null;
  jurisdiction: string;
  photoUrl: string | null;
  /** Published per-plank alignment percentage (0-100), or null if pending. */
  score: number | null;
  forCount: number;
  againstCount: number;
}

/**
 * Returns every active legislator in a jurisdiction together with their
 * published score on a single plank. Reuses the same publish/methodology
 * filters as the index + detail pages so the issue page can never show a
 * different number than the rest of the scorecard.
 *
 * Legislators with no published score for the plank are still returned with
 * `score: null` so the issue page can show "scoring pending" rather than
 * silently dropping them.
 */
export async function getPlankScoresByLegislator(
  jurisdiction: ScorecardJurisdiction,
  plankId: string,
  filter: Pick<LegislatorListFilter, 'chamber' | 'party' | 'state'> = {},
): Promise<PlankLegislatorScoreRow[]> {
  const legislators = await prisma.legislator.findMany({
    where: {
      isActive: true,
      jurisdiction,
      ...(filter.chamber ? { chamber: filter.chamber } : {}),
      ...(filter.party ? { party: filter.party } : {}),
      ...(filter.state ? { state: filter.state } : {}),
    },
    orderBy: [{ state: 'asc' }, { lastName: 'asc' }],
    select: {
      id: true,
      bioguideId: true,
      openStatesId: true,
      fullName: true,
      party: true,
      chamber: true,
      state: true,
      district: true,
      jurisdiction: true,
      photoUrl: true,
      scores: {
        where: { plankId, publishedAt: { not: null }, methodologyVersion: VOTING_DISPLAY_METHODOLOGY },
        select: { score: true, forCount: true, againstCount: true },
        take: 1,
      },
    },
  });

  return legislators.map((leg) => {
    const s = leg.scores[0];
    // v1.9.3 — apply the MIN_ELIGIBLE_BILLS_FLOOR on this single plank. A plank
    // measured on fewer than the floor's worth of eligible bills renders as
    // "pending" (score null) rather than a thin, low-confidence percentage —
    // matching how the same plank is excluded from the legislator's overall
    // Voting Record mean in computePublishedTotal.
    const meetsFloor = s ? meetsMinBillsFloor(s) : false;
    return {
      id: leg.id,
      bioguideId: leg.bioguideId,
      openStatesId: leg.openStatesId,
      fullName: leg.fullName,
      party: leg.party,
      chamber: leg.chamber,
      state: leg.state,
      district: leg.district,
      jurisdiction: leg.jurisdiction,
      photoUrl: leg.photoUrl,
      // Clamp displayed score to >= 0, matching the index page's ScoreCell.
      score: s && meetsFloor ? Math.max(0, s.score) : null,
      forCount: s?.forCount ?? 0,
      againstCount: s?.againstCount ?? 0,
    };
  });
}

/**
 * v2.0.2 — cached per-jurisdiction scorecard base. The index page was re-running
 * the heavy PAC-scoring queries (V171 over PacContribution + classifications)
 * for every filter change, because chamber/party/state filters are URL params
 * that trigger a fresh server render. This fetches the FULL jurisdiction once
 * (all chambers/parties) + every PAC score, cached for an hour, so filter
 * changes are served from cache and filtered in memory by the page. Scores only
 * change on ingest/recompute, so an hourly TTL is safe.
 */
export const getScorecardBase = unstable_cache(
  async (jurisdiction: ScorecardJurisdiction) => {
    const [legislators, featuredBills, calibration] = await Promise.all([
      getLegislatorList({ jurisdiction }),
      getFeaturedBills(jurisdiction),
      getScoreCalibration(METHODOLOGY_VERSION),
    ]);
    const ids = legislators.map((l) => l.id);
    const pacMap =
      jurisdiction === 'FEDERAL' ? await getPacScoresByLegislatorV171(ids) : await getPacScoresByLegislator(ids);
    // Maps don't serialize through the cache — return entries, rebuild in page.
    return { legislators, featuredBills, calibration, pacScores: [...pacMap.entries()] };
  },
  ['scorecard-base'],
  { revalidate: 3600, tags: ['scorecard'] },
);
