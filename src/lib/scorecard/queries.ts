// Server-side data fetching for the scorecard pages and API routes.
// All functions are read-only and safe to call from public surface area.

import prisma from '@/lib/prisma/prisma';

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
// Source of truth for scoring methodology version on display. Old v1.0/v1.1
// score rows linger in the DB but are filtered out here so a legislator's
// total reflects only the current methodology pass.
export const CURRENT_METHODOLOGY = 'v1.2';

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
 * Computes a total score across published plank scores. Returns null
 * if no scores are published yet (used to render "pending" state).
 */
export function computePublishedTotal(scores: Array<{ score: number }>): number | null {
  if (scores.length === 0) return null;
  return scores.reduce((acc, s) => acc + s.score, 0);
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
