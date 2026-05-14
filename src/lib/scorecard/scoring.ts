// Phase 4 scoring engine — methodology v1.2.
//
// Simple +1 / -1 point model:
//   ACTED_FOR     → +1
//   ACTED_AGAINST → -1
//   NO_RECORD     →  0 (no row exists, no contribution)
//
// Score per plank = sum of marker points on that plank (can be negative).
// Total score = sum across all planks (can be negative).
//
// This replaces the v1.0/v1.1 0-5 rubric. Reasons:
//   1. Each action has a clean, transparent weight — no rubric ambiguity.
//   2. Scores aren't bounded by an artificial denominator. A legislator
//      who voted yes on 12 things and against 2 reads as +10, not 4/25
//      (which collapsed the activity).
//   3. Compute is O(n) per legislator — fits in a single DB pass with
//      no risk of timeout from 3,000+ rubric upserts.
//
// Coverage indicator (X measured of Y trackable) still ships on the
// page, so readers can distinguish "+0 with low coverage" from
// "+0 with full coverage" — the same evidence transparency goal as the
// three-state rendering.

export const METHODOLOGY_VERSION = 'v1.2';

export type MarkerTypeForScoring = 'PRIMARY' | 'SECONDARY';
export type AchievementStatus = 'ACTED_FOR' | 'ACTED_AGAINST' | 'NO_RECORD';

export interface ScoringMarker {
  id: string;
  markerType: MarkerTypeForScoring;
}

export interface ScoringPlank {
  id: string;
  number: number;
  markers: ScoringMarker[];
}

export interface PlankScoreResult {
  plankId: string;
  score: number; // signed integer; +N for net positive, -N for net negative
  forCount: number;
  againstCount: number;
  measuredMarkers: number; // forCount + againstCount
  totalMarkers: number; // markers on this plank we COULD measure
  notes: string;
}

/**
 * The minimal achievement shape the scoring engine needs to weigh an
 * action. Kept narrow (vs the full Prisma MarkerAchievement) so unit
 * tests stay fast and the scoring engine has no Prisma dependency.
 */
export interface AchievementForScoring {
  markerId: string;
  achieved: boolean;
  actionTaken: AchievementStatus | null;
  evidenceType: 'COSPONSOR' | 'VOTE' | 'FEC_FILING' | 'CAL_ACCESS_FILING' | 'PUBLIC_STATEMENT';
  sponsorTier: 'AUTHOR' | 'PRINCIPAL_COAUTHOR' | 'COAUTHOR' | 'COSPONSOR' | 'SPONSOR' | null;
}

/**
 * Methodology v1.3 weight table — see docs/scorecard-methodology.md
 * for the public-facing rationale.
 *
 *   COSPONSOR Author / Sponsor        → +3
 *   COSPONSOR Principal / Coauthor    → +2
 *   COSPONSOR Cosponsor               → +1
 *   VOTE      ACTED_FOR  (yes)        → +1
 *   VOTE      ACTED_AGAINST           → -1  (NO, NOT_VOTING, EXCUSED,
 *                                            ABSTAINED, PRESENT — every
 *                                            recorded non-yes counts the
 *                                            same: the bill needed your
 *                                            yes to pass)
 *   PAC FILING ACTED_FOR  (under 5%)  → +1
 *   PAC FILING ACTED_AGAINST          → -1
 *   NO_RECORD or absent row           →  0
 */
export function weightForAchievement(a: AchievementForScoring): number {
  if (a.actionTaken !== 'ACTED_FOR' && a.actionTaken !== 'ACTED_AGAINST') return 0;
  const sign = a.actionTaken === 'ACTED_FOR' ? 1 : -1;
  if (a.evidenceType === 'COSPONSOR') {
    if (a.sponsorTier === 'AUTHOR' || a.sponsorTier === 'SPONSOR') return sign * 3;
    if (a.sponsorTier === 'PRINCIPAL_COAUTHOR' || a.sponsorTier === 'COAUTHOR') return sign * 2;
    return sign * 1; // COSPONSOR or unknown tier
  }
  // VOTE / FEC_FILING / CAL_ACCESS_FILING / PUBLIC_STATEMENT all carry magnitude 1.
  return sign;
}

/**
 * Score a single plank for a single legislator given which marker IDs they
 * have ACTED_FOR vs ACTED_AGAINST records for. Markers without rows are
 * NO_RECORD and contribute 0.
 */
export function scorePlank(
  plank: ScoringPlank,
  forIds: ReadonlySet<string>,
  againstIds: ReadonlySet<string>,
): PlankScoreResult {
  let forCount = 0;
  let againstCount = 0;
  for (const m of plank.markers) {
    if (forIds.has(m.id)) forCount += 1;
    else if (againstIds.has(m.id)) againstCount += 1;
  }
  const score = forCount - againstCount;
  return {
    plankId: plank.id,
    score,
    forCount,
    againstCount,
    measuredMarkers: forCount + againstCount,
    totalMarkers: plank.markers.length,
    notes: `methodology=${METHODOLOGY_VERSION}, +${forCount} −${againstCount} (net ${score >= 0 ? '+' : ''}${score})`,
  };
}

export interface LegislatorScoreInput {
  legislatorId: string;
  forIds: ReadonlySet<string>;
  againstIds: ReadonlySet<string>;
}

export interface LegislatorScoreResult {
  legislatorId: string;
  perPlank: PlankScoreResult[];
  total: number; // signed integer
  totalFor: number;
  totalAgainst: number;
}

/**
 * Score all planks for one legislator. Returns per-plank breakdown plus
 * total. All values are signed integers.
 */
export function scoreLegislator(planks: readonly ScoringPlank[], input: LegislatorScoreInput): LegislatorScoreResult {
  const perPlank = planks.map((p) => scorePlank(p, input.forIds, input.againstIds));
  const total = perPlank.reduce((sum, p) => sum + p.score, 0);
  const totalFor = perPlank.reduce((sum, p) => sum + p.forCount, 0);
  const totalAgainst = perPlank.reduce((sum, p) => sum + p.againstCount, 0);
  return {
    legislatorId: input.legislatorId,
    perPlank,
    total,
    totalFor,
    totalAgainst,
  };
}
