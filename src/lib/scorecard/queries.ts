// Server-side data fetching for the scorecard pages and API routes.
// All functions are read-only and safe to call from public surface area.

import prisma from '@/lib/prisma/prisma';
import { METHODOLOGY_VERSION } from '@/lib/scorecard/scoring';
import { classifyEmployer, SECTOR_LABEL } from '@/lib/scorecard/employer-industry';

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
        where: { publishedAt: { not: null }, methodologyVersion: CURRENT_METHODOLOGY },
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
        where: { publishedAt: { not: null }, methodologyVersion: CURRENT_METHODOLOGY },
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
 * Computes a total score across published plank scores.
 *
 * v1.5 and earlier: per-plank score is a signed integer; total = sum.
 * v1.6: per-plank score is a 0-100 alignment percentage; total is the
 *       MEAN across planks (not the sum, which would exceed 100).
 * v1.7 (current): per-plank score is the same shape as v1.6 (bill-level
 *       alignment percent, with cosponsorship folded in). The "total"
 *       under v1.7 is just the per-plank mean — i.e. the legislator's
 *       Voting Record. The Average of (PAC, Voting) is computed by
 *       `computeTwoScoreAverage` below, NOT by this helper.
 *
 * Behavior: when every score sits in [0, 100] we treat it as v1.6/v1.7-shaped
 * (alignment percent) and average. Otherwise we fall back to v1.5 signed sum.
 *
 * Returns null if no scores are published yet (used to render "pending").
 */
export function computePublishedTotal(scores: Array<{ score: number }>): number | null {
  if (scores.length === 0) return null;
  // v1.6/v1.7 heuristic: all scores in [0, 100] → treat as alignment percent and average.
  const allInPercentRange = scores.every((s) => s.score >= 0 && s.score <= 100);
  if (allInPercentRange) {
    const sum = scores.reduce((acc, s) => acc + s.score, 0);
    return Math.round(sum / scores.length);
  }
  // v1.5 fallback: signed integer sum.
  return scores.reduce((acc, s) => acc + s.score, 0);
}

/**
 * v1.7 — corporate-PAC score for one legislator.
 *
 * Score = (1 − combined_corporate_ratio) × 100, clamped to [0, 100].
 *
 * `combined_corporate_ratio` reads the legislator's most-recent PacMoneyData
 * row (any cycle, any source). If no PAC data exists we return null and the
 * page renders a "no PAC data" badge instead of a misleading 100%.
 */
export async function getLegislatorPacScore(legislatorId: string): Promise<number | null> {
  const row = await prisma.pacMoneyData.findFirst({
    where: { legislatorId },
    orderBy: [{ dataSource: 'asc' }, { cycleYear: 'desc' }],
    select: { combinedCorporateRatio: true, corporatePacPercentage: true },
  });
  if (!row) return null;
  const ratioRaw = row.combinedCorporateRatio ?? row.corporatePacPercentage;
  if (ratioRaw === null) return null;
  const ratio = Number(ratioRaw);
  if (!Number.isFinite(ratio)) return null;
  return Math.max(0, Math.min(100, Math.round((1 - ratio) * 100)));
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
 * v1.7 — bulk PAC scores for a list of legislators. Used by the index page
 * so we don't fire N+1 queries. Returns a Map<legislatorId, score|null>.
 */
export async function getPacScoresByLegislator(legislatorIds: string[]): Promise<Map<string, number | null>> {
  if (legislatorIds.length === 0) return new Map();
  // Most-recent PAC row per legislator. We use DISTINCT ON in raw SQL since
  // Prisma doesn't expose it directly — the per-row dataSource priority is
  // already deterministic via ORDER BY.
  const rows = await prisma.$queryRaw<
    Array<{ legislatorId: string; combinedCorporateRatio: number | null; corporatePacPercentage: number | null }>
  >`
    SELECT DISTINCT ON ("legislatorId")
      "legislatorId",
      "combinedCorporateRatio"::float AS "combinedCorporateRatio",
      "corporatePacPercentage"::float AS "corporatePacPercentage"
    FROM "PacMoneyData"
    WHERE "legislatorId" = ANY(${legislatorIds})
    ORDER BY "legislatorId" ASC, "dataSource" ASC, "cycleYear" DESC
  `;
  const out = new Map<string, number | null>();
  for (const id of legislatorIds) out.set(id, null);
  for (const r of rows) {
    const ratio = r.combinedCorporateRatio ?? r.corporatePacPercentage;
    if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) continue;
    out.set(r.legislatorId, Math.max(0, Math.min(100, Math.round((1 - ratio) * 100))));
  }
  return out;
}

// ─── v1.7.1 PAC scoring (from PacContribution table) ────────────────────────
//
// The v1.7.1 PAC Score is computed from per-(leg, donor, cycle, kind) rows
// in PacContribution joined to the donor's class in PacClassification.
//
//   counts_against  = Σ amount where class ∈ {CORPORATE, DARK_MONEY,
//                       FOREIGN_POLICY} AND kind ∈ {DIRECT, JFC_PASS_THROUGH}
//                     + 0.5 × Σ amount where class ∈ counts-against classes
//                       AND kind = IE_SUPPORT      (v1.9.1 half-weight)
//   denominator     = principal-committee multi-cycle receipts
//                     (PacMoneyData.totalReceipts summed)
//                     + 0.5 × Σ IE_SUPPORT          (v1.9.1 half-weight)
//                     This matches the v1.7.1 spike: the denominator is the
//                     legislator's total fundraising universe, not just PAC
//                     dollars. Using a PAC-only denominator produced
//                     misleadingly-low scores (Booker 75% vs spike 97%)
//                     because incumbents raise most of their money from
//                     individuals.
//   PAC Score       = (1 − counts_against / denominator) × 100
//
// v1.9.1 — Three-tier outside-money weighting (2026-05-31). Outside spending
// is no longer all-or-nothing in the PAC Score. Tier 1 — money the legislator
// could refuse (DIRECT, JFC_PASS_THROUGH; LEADERSHIP_PASS_THROUGH if/when
// modelled) — counts at 100%. Tier 2 — IE_SUPPORT (outside groups spending
// FOR them; the legislator could publicly disclaim it) — counts at 50%, in
// both numerator and denominator. Tier 3 — IE_OPPOSE_BENEFICIARY (outside
// groups spending AGAINST their opponent; the legislator cannot refuse it) —
// counts at 0%, transparency-only. Senators in competitive seats had hundreds
// of millions of IE_OPPOSE_BENEFICIARY washing through their races at full
// weight (Warnock $277M, Fetterman $88M); the prior weighting wrongly read
// that as legislator corruption. Tiers 2 and 3 remain fully surfaced on the
// legislator page so readers see what shaped the race.
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

const COUNTS_AGAINST_CLASSES = ['CORPORATE', 'DARK_MONEY', 'FOREIGN_POLICY'] as const;

// v1.9.1 outside-money weights. Single source of truth — every surface that
// computes PAC Score reads from here.
export const OUTSIDE_MONEY_WEIGHTS = {
  /** Tier 1 — money the legislator could refuse. */
  DIRECT: 1.0,
  /** Tier 1 — corp PAC → JFC → candidate apportionment, refusable. */
  JFC_PASS_THROUGH: 1.0,
  /** Tier 2 — outside group IE FOR the legislator. Could be disclaimed. */
  IE_SUPPORT: 0.5,
  /** Tier 3 — outside group IE AGAINST their opponent. Cannot be refused. */
  IE_OPPOSE_BENEFICIARY: 0.0,
} as const;

export interface PacMoneyTrail {
  countsAgainst: number; // $ from CORPORATE+DARK_MONEY+FOREIGN_POLICY (counted)
  totalInfluence: number; // $ from all classes via DIRECT or IE_SUPPORT or JFC_PASS_THROUGH
  totalReceipts: number; // principal-committee 4-cycle receipts (the denominator base)
  denominator: number; // totalReceipts + IE_SUPPORT — the score denominator
  pacScore: number | null; // (1 − counts_against / denominator) × 100
  byClass: Record<string, number>; // direct + IE-support + JFC-passthrough per class
  ieOpposeTotal: number; // info only — Super PAC IE against this leg
  ieSupportTotal: number; // IE_SUPPORT subtotal (helpful for the page UI)
  jfcPassThroughTotal: number; // $ apportioned via JFCs (any class) — for the "via JFC" subline
  // v1.7.4 beneficiary attribution: IE against a defeated opponent counts
  // here. counts_against_beneficiary = counts_against + benefiaryCountsAgainst
  // (only counted classes). beneficiaryPacScore is the alternative scoring
  // view computed with that augmented numerator.
  beneficiaryCountsAgainst: number; // $ from IE_OPPOSE_BENEFICIARY (counted classes only)
  beneficiaryPacScore: number | null; // (1 − (counts_against + benefiary)) / denominator) × 100
}

/**
 * v1.7.1 — bulk PAC scores for many legislators in one query. Used by the
 * index page so we don't fire N+1 sums. Returns Map<legislatorId, score|null>.
 */
export async function getPacScoresByLegislatorV171(legislatorIds: string[]): Promise<Map<string, number | null>> {
  if (legislatorIds.length === 0) return new Map();
  // Two halves, joined in JS:
  //   contribAgg  — counts-against and IE_SUPPORT from PacContribution
  //   receiptsAgg — multi-cycle principal-committee receipts from PacMoneyData
  // The denominator is receipts + IE_SUPPORT — matching the v1.7.1 spike.
  // v1.9.1 split the counts-against numerator into Tier 1 (DIRECT +
  // JFC_PASS_THROUGH, full weight) and Tier 2 (IE_SUPPORT, half weight). The
  // ieSupport-all column (every class) feeds the denominator at half weight.
  // IE_OPPOSE_BENEFICIARY is intentionally absent — Tier 3, zero weight.
  const contribAgg = await prisma.$queryRaw<
    Array<{ legislatorId: string; countsAgainstTier1: string; countsAgainstIeSupport: string; ieSupport: string }>
  >`
    SELECT
      pcontrib."legislatorId" AS "legislatorId",
      COALESCE(SUM(CASE
        WHEN pc.class IN ('CORPORATE', 'DARK_MONEY', 'FOREIGN_POLICY')
         AND pcontrib.kind IN ('DIRECT', 'JFC_PASS_THROUGH')
        THEN pcontrib.amount::numeric
        ELSE 0
      END), 0)::text AS "countsAgainstTier1",
      COALESCE(SUM(CASE
        WHEN pc.class IN ('CORPORATE', 'DARK_MONEY', 'FOREIGN_POLICY')
         AND pcontrib.kind = 'IE_SUPPORT'
        THEN pcontrib.amount::numeric
        ELSE 0
      END), 0)::text AS "countsAgainstIeSupport",
      COALESCE(SUM(CASE
        WHEN pcontrib.kind = 'IE_SUPPORT'
        THEN pcontrib.amount::numeric
        ELSE 0
      END), 0)::text AS "ieSupport"
    FROM "PacContribution" pcontrib
    JOIN "PacClassification" pc ON pc."committeeId" = pcontrib."donorCommitteeId"
    WHERE pcontrib."legislatorId" = ANY(${legislatorIds})
    GROUP BY pcontrib."legislatorId"
  `;
  const receiptsAgg = await prisma.$queryRaw<Array<{ legislatorId: string; receipts: string }>>`
    SELECT
      "legislatorId",
      COALESCE(SUM("totalReceipts"::numeric), 0)::text AS receipts
    FROM "PacMoneyData"
    WHERE "legislatorId" = ANY(${legislatorIds})
    GROUP BY "legislatorId"
  `;
  const receiptsByLeg = new Map<string, number>();
  for (const r of receiptsAgg) {
    const v = Number(r.receipts);
    if (Number.isFinite(v)) receiptsByLeg.set(r.legislatorId, v);
  }
  const out = new Map<string, number | null>();
  for (const id of legislatorIds) out.set(id, null);
  for (const r of contribAgg) {
    const caTier1 = Number(r.countsAgainstTier1);
    const caIe = Number(r.countsAgainstIeSupport);
    const ie = Number(r.ieSupport);
    const receipts = receiptsByLeg.get(r.legislatorId) ?? 0;
    // v1.9.1 — apply IE_SUPPORT weight (0.5) to both numerator and denominator.
    // Tier 1 stays at 100%. IE_OPPOSE_BENEFICIARY is excluded (Tier 3, 0%).
    const ca = caTier1 + caIe * OUTSIDE_MONEY_WEIGHTS.IE_SUPPORT;
    const weightedIe = (Number.isFinite(ie) ? ie : 0) * OUTSIDE_MONEY_WEIGHTS.IE_SUPPORT;
    // v1.7.7 safety guard: if there are no principal-committee receipts on
    // record AND there is meaningful counts-against activity, the IE-only
    // denominator produces a misleading score (e.g. McCormick's $14.86M IE
    // alone collapsed to "6"). Treat as no data instead. Leaves the score
    // valid for cases where the leg legitimately has both receipts and IE.
    if (receipts <= 0 && ca > 0) continue;
    const denom = receipts + weightedIe;
    if (!Number.isFinite(denom) || denom <= 0) continue;
    const ratio = ca / denom;
    out.set(r.legislatorId, Math.max(0, Math.min(100, Math.round((1 - ratio) * 100))));
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

  const byClass: Record<string, number> = {};
  let countsAgainstTier1 = 0; // DIRECT + JFC_PASS_THROUGH in counts-against classes
  let countsAgainstIeSupport = 0; // IE_SUPPORT in counts-against classes (Tier 2)
  let totalInfluence = 0;
  let ieOpposeTotal = 0;
  let ieSupportTotal = 0;
  let jfcPassThroughTotal = 0;
  let beneficiaryCountsAgainst = 0;
  for (const r of rows) {
    const amt = Number(r.amount);
    if (!Number.isFinite(amt)) continue;
    if (r.kind === 'IE_OPPOSE') {
      ieOpposeTotal += amt;
      continue;
    }
    if (r.kind === 'IE_OPPOSE_BENEFICIARY') {
      // v1.9.1 — Tier 3. Surfaced for transparency on the page but zero weight
      // in the PAC Score (legislator could not refuse it).
      if ((COUNTS_AGAINST_CLASSES as readonly string[]).includes(r.class)) {
        beneficiaryCountsAgainst += amt;
      }
      continue;
    }
    if (r.kind === 'IE_SUPPORT') ieSupportTotal += amt;
    if (r.kind === 'JFC_PASS_THROUGH') jfcPassThroughTotal += amt;
    // Bucket DIRECT + IE_SUPPORT + JFC_PASS_THROUGH by class for the breakdown display.
    byClass[r.class] = (byClass[r.class] ?? 0) + amt;
    totalInfluence += amt;
    if ((COUNTS_AGAINST_CLASSES as readonly string[]).includes(r.class)) {
      if (r.kind === 'IE_SUPPORT') countsAgainstIeSupport += amt;
      else countsAgainstTier1 += amt;
    }
  }
  // v1.9.1 — Tier 1 at full weight, Tier 2 (IE_SUPPORT) at 50% in both
  // numerator and denominator. JFC pass-through dollars are already in the
  // principal-committee receipts on the denominator side; we add their
  // counts-against share to the numerator (when the original donor was
  // corp/dark/foreign). Tier 3 (IE_OPPOSE_BENEFICIARY) does not enter either
  // total.
  const countsAgainst = countsAgainstTier1 + countsAgainstIeSupport * OUTSIDE_MONEY_WEIGHTS.IE_SUPPORT;
  const denominator = totalReceipts + ieSupportTotal * OUTSIDE_MONEY_WEIGHTS.IE_SUPPORT;
  // v1.7.7 safety guard (mirrors getPacScoresByLegislatorV171): when there
  // are zero principal-committee receipts on record but real counts-against
  // activity exists, the resulting score is driven entirely by IE_SUPPORT
  // and reads as misleadingly low. Return null ("no data") in that case so
  // the UI renders a "no data" badge rather than a near-zero number.
  const noReceiptsData = totalReceipts <= 0 && countsAgainst > 0;
  const pacScore =
    !noReceiptsData && denominator > 0
      ? Math.max(0, Math.min(100, Math.round((1 - countsAgainst / denominator) * 100)))
      : null;
  // Beneficiary view: also count IE_OPPOSE-against-defeated-opponent as
  // counts-against. Denominator includes IE_OPPOSE_BENEFICIARY too so it
  // doesn't artificially inflate the ratio. Same no-receipts guard applies.
  const beneficiaryDenominator = denominator + beneficiaryCountsAgainst;
  const beneficiaryPacScore =
    !noReceiptsData && beneficiaryDenominator > 0
      ? Math.max(
          0,
          Math.min(100, Math.round((1 - (countsAgainst + beneficiaryCountsAgainst) / beneficiaryDenominator) * 100)),
        )
      : null;
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
  total: number; // DIRECT + IE_SUPPORT + JFC_PASS_THROUGH, summed across cycles
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
      COALESCE(SUM(CASE WHEN pcontrib.kind IN ('DIRECT', 'IE_SUPPORT', 'JFC_PASS_THROUGH')
                        THEN pcontrib.amount::numeric ELSE 0 END), 0)::text AS total,
      COALESCE(SUM(CASE WHEN pcontrib.kind = 'IE_OPPOSE'
                        THEN pcontrib.amount::numeric ELSE 0 END), 0)::text AS "ieOppose"
    FROM "PacContribution" pcontrib
    JOIN "PacClassification" pc ON pc."committeeId" = pcontrib."donorCommitteeId"
    WHERE pcontrib."legislatorId" = ${legislatorId}
    GROUP BY pc."committeeId", pc.name, pc.class
    HAVING COALESCE(SUM(CASE WHEN pcontrib.kind IN ('DIRECT', 'IE_SUPPORT', 'JFC_PASS_THROUGH')
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
// half-weight in the PAC Score; IE_OPPOSE_BENEFICIARY is transparency-only.
// The Money Trail tile shows IE_SUPPORT already; this surface adds an explicit
// "outside money in your races" section with class breakdown and top spenders,
// because dark-money flows like Warnock's $277M and Fetterman's $88M are
// material context for any honest reading of the race even at zero/half weight.

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
  const rcVotes = await prisma.rollCallVote.findMany({
    where: {
      isScorable: true,
      alignedPosition: { not: null },
      plankNumbers: { isEmpty: false },
      chamber: { in: rcChambers as ('SENATE' | 'HOUSE' | 'CA_SENATE' | 'CA_ASSEMBLY')[] },
    },
    select: {
      id: true,
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
    if (!v.billType || !v.billNumber || !v.alignedPosition) continue;
    const key = `${v.billType}|${v.billNumber}`;
    const legPos = v.positions[0]?.position ?? null;
    const isAligned = legPos === v.alignedPosition;
    const existing = billAggs.get(key);
    if (!existing) {
      billAggs.set(key, {
        chamber: rcChambers[0],
        billType: v.billType,
        billNumber: v.billNumber,
        billTitle: v.billTitle ?? null,
        plankNumbers: [...v.plankNumbers],
        alignedPosition: v.alignedPosition as 'YES' | 'NO',
        legPosition: legPos as BillAgg['legPosition'],
        votedAligned: isAligned,
      });
    } else {
      for (const p of v.plankNumbers) if (!existing.plankNumbers.includes(p)) existing.plankNumbers.push(p);
      if (isAligned) existing.votedAligned = true;
      if (existing.legPosition === null && legPos) existing.legPosition = legPos as BillAgg['legPosition'];
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
