// Phase 4 scoring engine — methodology v1.9.1 (see PLANK_ENGINE_VERSION
// below for the runtime source of truth, and docs/scorecard-methodology.md
// for the full version history). This file documents the +1/−1 point
// model introduced in v1.2; later weight tables (v1.3 sponsor tier, v1.4
// continuous PAC gradient) layer on top.
//
// ─── Single source of truth for ALL methodology-version constants ──────────
// Three genuinely distinct things get versioned independently in this
// codebase, and every one of them is defined HERE and imported everywhere
// else — no other file may redeclare a `METHODOLOGY_VERSION`-shaped literal.
// See docs/scorecard-methodology.md's version table for the full changelog
// (a single sequence spanning all three).
//
//   1. METHODOLOGY_VERSION      — the CURRENT OVERALL public methodology
//      version. This is what's shown as the "Methodology vX.Y.Z →" footer
//      link on every /scorecard page and returned as the top-level
//      `methodologyVersion` field from the public API. It tracks the latest
//      row in the docs version table, even when that row's change lives in
//      the Voting Record engine, the PAC engine, or a display-only fix.
//
//   2. PLANK_ENGINE_VERSION     — versions THIS FILE's marker/achievement
//      weighting engine (the signed +1/−1 point model, PAC continuous
//      gradient, sponsor-tier weights) and `scripts/compute-scores.ts`,
//      which writes RepresentativeScore + ScoreCalibration rows tagged with
//      it. Frozen at v1.9.1 since that engine was superseded by the Voting
//      Record's curated-vote model for public display — bump it only when
//      this file's weighting logic itself changes.
//
//   3. VOTING_DISPLAY_METHODOLOGY — versions the public Voting Record (the
//      0-100 per-plank alignment %) computed by
//      `scripts/compute-scores-v2.ts` from the curated landmark-vote model.
//      Sub-patches to the curation (dropping/restoring a bill, tweaking the
//      abstention rule — v2.0.1, v2.0.2, ...) are re-runs of the SAME v2.0
//      model, so the literal value written to
//      `RepresentativeScore.methodologyVersion` intentionally stays 'v2.0'
//      across those patches; only a genuine model change (a new numerator/
//      denominator definition) should bump this constant.
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

export const PLANK_ENGINE_VERSION = 'v1.9.1';

// Public Voting Record display version — see the module header above. Its
// natural "owner" script is scripts/compute-scores-v2.ts, but it is defined
// here (not there) so it has exactly one source of truth that every consumer
// imports rather than redeclares.
export const VOTING_DISPLAY_METHODOLOGY = 'v2.0';

// Current overall public methodology version — see the module header above.
export const METHODOLOGY_VERSION = 'v2.0.2';

/**
 * Popular-support floor (methodology v1.9.2).
 *
 * A marker is only used to score legislators if the policy it captures has
 * broad national support. We exclude any marker whose assessed national
 * public-opinion support is below this percentage — Common Ground holds
 * legislators accountable to commitments the public broadly shares, not to
 * narrowly-supported positions.
 *
 * 55 = simple majority plus a margin, sourced from curated public-opinion
 * polling stored per-marker (Marker.popularSupport + Marker.popularSupportPoll,
 * populated by scripts/seed-marker-support.ts).
 */
export const POPULAR_SUPPORT_FLOOR = 55;

/**
 * Pure predicate: does this marker meet the popular-support floor and therefore
 * count toward scoring?
 *
 * Rules:
 *   - popularSupport == null  → PASS. The marker has not been assessed yet, so
 *     we must not drop it (otherwise every marker disappears before the curated
 *     poll data lands).
 *   - popularSupport <  FLOOR → FAIL. Assessed and below the floor → excluded.
 *   - popularSupport >= FLOOR → PASS.
 *
 * Kept Prisma-free (takes a plain shape) so it is trivially unit-testable and
 * usable from both the scoring engine and the compute scripts.
 */
export function markerMeetsPopularSupportFloor(marker: { popularSupport: number | null }): boolean {
  if (marker.popularSupport == null) return true;
  return marker.popularSupport >= POPULAR_SUPPORT_FLOOR;
}

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
  // v1.4: PAC marker uses continuous achievementScore when present
  if ((a.evidenceType === 'FEC_FILING' || a.evidenceType === 'CAL_ACCESS_FILING') && a.achievementScore != null) {
    return a.achievementScore;
  }
  // Existing v1.3 weight table follows (unchanged)
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
 * Methodology v1.4 continuous PAC gradient. Maps a combined corporate-money
 * ratio (direct + IE in numerator, total receipts + same IE in denominator)
 * to a marker score in [-3, +2].
 *
 *   ratio 0.00 → +2  (real zero — reward maximally)
 *   ratio 0.05 → +1  (the v1.3 threshold — partial credit)
 *   ratio 0.15 → 0   (neutral)
 *   ratio 0.35 → -1
 *   ratio 0.65 → -2
 *   ratio 0.85 → -3  (floor — corporate dominance)
 *
 * Linear interpolation between anchors. Clamped at endpoints. The reward for
 * being at "real zero" (0%) is bigger than the cliff at the v1.3 threshold,
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
    notes: `methodology=${PLANK_ENGINE_VERSION}, score=${
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
