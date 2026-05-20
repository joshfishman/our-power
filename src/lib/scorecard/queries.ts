// Server-side data fetching for the scorecard pages and API routes.
// All functions are read-only and safe to call from public surface area.

import prisma from '@/lib/prisma/prisma';
import { METHODOLOGY_VERSION } from '@/lib/scorecard/scoring';

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
