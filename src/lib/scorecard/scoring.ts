// Phase 4 scoring engine — methodology v1.9.1.
//
// Per-marker weights (set by weightForAchievement below): a signed point
// model that scales VOTE evidence by ±1, COSPONSOR evidence by ±1/±2/±3
// (sponsor tier), and PAC evidence by the continuous v1.4 gradient in
// pacScoreFromRatio. v1.9.1 adds three-tier outside-money weighting in the
// PAC Score path (see src/lib/scorecard/queries.ts) — IE_SUPPORT counts at
// half weight; IE_OPPOSE_BENEFICIARY is transparency-only at zero weight.
// The per-plank score is the sum of marker weights on that plank (signed);
// per-plank Voting Score is the bill-level alignment percent computed
// upstream in compute-scores.ts and persisted as RepresentativeScore.
//
// Coverage indicator (X measured of Y trackable) still ships on the
// page so readers can distinguish "+0 with low coverage" from "+0 with
// full coverage" — the same evidence-transparency goal as the
// three-state rendering.

export const METHODOLOGY_VERSION = 'v1.9.1';

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
  score: number; // signed integer — sum of weighted achievements on this plank
  forCount: number; // count of ACTED_FOR achievements (any weight)
  againstCount: number; // count of ACTED_AGAINST achievements (any weight)
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
  achievementScore: number | null;
}

/**
 * v1.9.1 weight table (unchanged from v1.3/v1.4 except for the PAC path,
 * which now reads continuous achievementScore values populated by the
 * three-tier outside-money weighting downstream in compute-scores). See
 * docs/scorecard-methodology.md for the public-facing rationale.
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
 *   PAC FILING (FEC_FILING / CAL_ACCESS_FILING) → continuous
 *                                            achievementScore from
 *                                            pacScoreFromRatio (v1.4
 *                                            gradient, v1.9.1 weights
 *                                            applied to its input ratio)
 *   NO_RECORD or absent row           →  0
 */
export function weightForAchievement(a: AchievementForScoring): number {
  // PAC marker uses continuous achievementScore when present (v1.4 gradient
  // input today carries v1.9.1 three-tier outside-money weighting).
  if ((a.evidenceType === 'FEC_FILING' || a.evidenceType === 'CAL_ACCESS_FILING') && a.achievementScore != null) {
    return a.achievementScore;
  }
  // Existing weight table follows (unchanged since v1.3).
  if (a.actionTaken !== 'ACTED_FOR' && a.actionTaken !== 'ACTED_AGAINST') return 0;
  const sign = a.actionTaken === 'ACTED_FOR' ? 1 : -1;
  if (a.evidenceType === 'COSPONSOR') {
    if (a.sponsorTier === 'AUTHOR' || a.sponsorTier === 'SPONSOR') return sign * 3;
    if (a.sponsorTier === 'PRINCIPAL_COAUTHOR' || a.sponsorTier === 'COAUTHOR') return sign * 2;
    return sign * 1;
  }
  return sign;
}

/**
 * Continuous PAC gradient (introduced v1.4, current under v1.9.1). Maps the
 * combined corporate-money ratio (numerator: counts-against under the v1.9.1
 * three-tier weighting — Tier 1 full, Tier 2 IE_SUPPORT half, Tier 3 zero;
 * denominator: principal-committee receipts + half-weighted IE_SUPPORT) to
 * a marker score in [-3, +2].
 *
 *   ratio 0.00 → +2  (real zero — reward maximally)
 *   ratio 0.05 → +1  (the legacy v1.3 threshold — partial credit)
 *   ratio 0.15 → 0   (neutral)
 *   ratio 0.35 → -1
 *   ratio 0.65 → -2
 *   ratio 0.85 → -3  (floor — corporate dominance)
 *
 * Linear interpolation between anchors. Clamped at endpoints. The reward for
 * being at "real zero" (0%) is bigger than the cliff at the legacy threshold,
 * so legislators who genuinely refuse corporate money get more credit than
 * those who just barely qualify.
 */
const PAC_ANCHORS: ReadonlyArray<[ratio: number, score: number]> = [
  [0.0, 2.0],
  [0.05, 1.0],
  [0.15, 0.0],
  [0.35, -1.0],
  [0.65, -2.0],
  [0.85, -3.0],
];

export function pacScoreFromRatio(ratio: number): number {
  if (ratio <= PAC_ANCHORS[0][0]) return PAC_ANCHORS[0][1];
  if (ratio >= PAC_ANCHORS[PAC_ANCHORS.length - 1][0]) return PAC_ANCHORS[PAC_ANCHORS.length - 1][1];
  for (let i = 1; i < PAC_ANCHORS.length; i += 1) {
    const [r1, s1] = PAC_ANCHORS[i - 1];
    const [r2, s2] = PAC_ANCHORS[i];
    if (ratio <= r2) {
      const t = (ratio - r1) / (r2 - r1);
      return s1 + t * (s2 - s1);
    }
  }
  return PAC_ANCHORS[PAC_ANCHORS.length - 1][1]; // unreachable
}

/**
 * Maps a raw signed score to an anchored percentage in [-100, +100]. Anchors
 * are picked empirically from the methodology-version's first compute (95th
 * percentile of positives → +100%; 5th percentile of negatives → -100%) and
 * frozen for the lifetime of that version. Asymmetric by design — the positive
 * range typically extends further than the negative because most achievements
 * carry positive weights.
 *
 * @param raw          The signed integer-or-decimal score.
 * @param posAnchor    Raw score that maps to +100%.
 * @param negAnchor    Raw score that maps to -100% (negative number).
 */
export function rawToPercent(raw: number, posAnchor: number, negAnchor: number): number {
  if (raw === 0 || (posAnchor === 0 && negAnchor === 0)) return 0;
  if (raw > 0) {
    if (posAnchor <= 0) return 0;
    return Math.min(100, (raw / posAnchor) * 100);
  }
  if (negAnchor >= 0) return 0;
  return Math.max(-100, (raw / Math.abs(negAnchor)) * 100);
}

export function scorePlank(plank: ScoringPlank, achievements: readonly AchievementForScoring[]): PlankScoreResult {
  const markerIds = new Set(plank.markers.map((m) => m.id));
  let score = 0;
  let forCount = 0;
  let againstCount = 0;
  for (const a of achievements) {
    if (!markerIds.has(a.markerId)) continue;
    if (a.actionTaken === 'ACTED_FOR') forCount += 1;
    else if (a.actionTaken === 'ACTED_AGAINST') againstCount += 1;
    score += weightForAchievement(a);
  }
  return {
    plankId: plank.id,
    score,
    forCount,
    againstCount,
    measuredMarkers: forCount + againstCount,
    totalMarkers: plank.markers.length,
    notes: `methodology=${METHODOLOGY_VERSION}, score=${
      score >= 0 ? '+' : ''
    }${score} from ${forCount} for / ${againstCount} against`,
  };
}

export interface LegislatorScoreInput {
  legislatorId: string;
  achievements: readonly AchievementForScoring[];
}

export interface LegislatorScoreResult {
  legislatorId: string;
  perPlank: PlankScoreResult[];
  total: number;
  totalFor: number;
  totalAgainst: number;
}

export function scoreLegislator(planks: readonly ScoringPlank[], input: LegislatorScoreInput): LegislatorScoreResult {
  const perPlank = planks.map((p) => scorePlank(p, input.achievements));
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
