import { describe, expect, it } from 'vitest';
import {
  scoreLegislator,
  scorePlank,
  METHODOLOGY_VERSION,
  weightForAchievement,
  pacScoreFromRatio,
  rawToPercent,
} from '@/lib/scorecard/scoring';
import type { ScoringPlank, AchievementForScoring } from '@/lib/scorecard/scoring';

// Methodology v1.3: weighted scoring via weightForAchievement.
// Plank score = sum of weighted achievements. Total = sum of plank scores.

const plank: ScoringPlank = {
  id: 'plank-1',
  number: 1,
  markers: [
    { id: 'm1', markerType: 'PRIMARY' },
    { id: 'm2', markerType: 'SECONDARY' },
    { id: 'm3', markerType: 'SECONDARY' },
    { id: 'm4', markerType: 'SECONDARY' },
  ],
};

// Helpers for building test achievements.
function ach(markerId: string, kind: 'for' | 'against' | 'norecord' = 'for'): AchievementForScoring {
  return {
    markerId,
    achieved: kind === 'for',
    actionTaken: kind === 'for' ? 'ACTED_FOR' : kind === 'against' ? 'ACTED_AGAINST' : 'NO_RECORD',
    evidenceType: 'VOTE',
    sponsorTier: null,
    achievementScore: null,
  };
}

function authoredCosponsor(markerId: string, tier: AchievementForScoring['sponsorTier']): AchievementForScoring {
  return {
    markerId,
    achieved: true,
    actionTaken: 'ACTED_FOR',
    evidenceType: 'COSPONSOR',
    sponsorTier: tier,
    achievementScore: null,
  };
}

describe('scorePlank — v1.3 weighted-sum model', () => {
  it('returns 0 when no achievements touch this plank', () => {
    const r = scorePlank(plank, []);
    expect(r.score).toBe(0);
    expect(r.measuredMarkers).toBe(0);
  });

  it('sums weights across markers', () => {
    // +3 (Author) + +1 (vote yes) + -1 (vote no) = +3
    const r = scorePlank(plank, [authoredCosponsor('m1', 'AUTHOR'), ach('m2', 'for'), ach('m3', 'against')]);
    expect(r.score).toBe(3);
    expect(r.forCount).toBe(2);
    expect(r.againstCount).toBe(1);
    expect(r.measuredMarkers).toBe(3);
  });

  it('ignores achievements for markers outside this plank', () => {
    const r = scorePlank(plank, [ach('m1', 'for'), ach('not-on-this-plank', 'for')]);
    expect(r.score).toBe(1);
    expect(r.measuredMarkers).toBe(1);
  });

  it('ignores NO_RECORD achievements', () => {
    const r = scorePlank(plank, [ach('m1', 'for'), ach('m2', 'norecord')]);
    expect(r.score).toBe(1);
    expect(r.measuredMarkers).toBe(1);
  });
});

describe('scoreLegislator — v1.3', () => {
  const planks: ScoringPlank[] = [
    plank,
    {
      id: 'plank-2',
      number: 2,
      markers: [{ id: 'm10', markerType: 'PRIMARY' }],
    },
  ];

  it('aggregates per-plank scores into a total', () => {
    const result = scoreLegislator(planks, {
      legislatorId: 'leg-1',
      achievements: [authoredCosponsor('m1', 'AUTHOR'), ach('m10', 'against')],
    });
    expect(result.total).toBe(2); // +3 + -1
    expect(result.perPlank).toHaveLength(2);
  });

  it('returns 0 for a legislator with no achievements', () => {
    const result = scoreLegislator(planks, {
      legislatorId: 'leg-1',
      achievements: [],
    });
    expect(result.total).toBe(0);
  });
});

describe('METHODOLOGY_VERSION', () => {
  it('is v1.5', () => {
    expect(METHODOLOGY_VERSION).toBe('v1.5');
  });
});

describe('weightForAchievement — v1.3 weight table', () => {
  const base = {
    markerId: 'm',
    achieved: true,
    sponsorTier: null,
    achievementScore: null,
  } as const;

  it('Author cosponsorship is +3', () => {
    const a: AchievementForScoring = {
      ...base,
      evidenceType: 'COSPONSOR',
      actionTaken: 'ACTED_FOR',
      sponsorTier: 'AUTHOR',
    };
    expect(weightForAchievement(a)).toBe(3);
  });

  it('Sponsor cosponsorship is +3', () => {
    const a: AchievementForScoring = {
      ...base,
      evidenceType: 'COSPONSOR',
      actionTaken: 'ACTED_FOR',
      sponsorTier: 'SPONSOR',
    };
    expect(weightForAchievement(a)).toBe(3);
  });

  it('Principal Coauthor cosponsorship is +2', () => {
    const a: AchievementForScoring = {
      ...base,
      evidenceType: 'COSPONSOR',
      actionTaken: 'ACTED_FOR',
      sponsorTier: 'PRINCIPAL_COAUTHOR',
    };
    expect(weightForAchievement(a)).toBe(2);
  });

  it('Coauthor cosponsorship is +2', () => {
    const a: AchievementForScoring = {
      ...base,
      evidenceType: 'COSPONSOR',
      actionTaken: 'ACTED_FOR',
      sponsorTier: 'COAUTHOR',
    };
    expect(weightForAchievement(a)).toBe(2);
  });

  it('Cosponsor cosponsorship is +1', () => {
    const a: AchievementForScoring = {
      ...base,
      evidenceType: 'COSPONSOR',
      actionTaken: 'ACTED_FOR',
      sponsorTier: 'COSPONSOR',
    };
    expect(weightForAchievement(a)).toBe(1);
  });

  it('VOTE ACTED_FOR (yes) is +1', () => {
    const a: AchievementForScoring = { ...base, evidenceType: 'VOTE', actionTaken: 'ACTED_FOR' };
    expect(weightForAchievement(a)).toBe(1);
  });

  it('VOTE ACTED_AGAINST (no/absent/abstain/excused/present) is -1', () => {
    const a: AchievementForScoring = { ...base, evidenceType: 'VOTE', actionTaken: 'ACTED_AGAINST' };
    expect(weightForAchievement(a)).toBe(-1);
  });

  it('PAC FILING under threshold (ACTED_FOR) is +1', () => {
    const a: AchievementForScoring = { ...base, evidenceType: 'FEC_FILING', actionTaken: 'ACTED_FOR' };
    expect(weightForAchievement(a)).toBe(1);
    const b: AchievementForScoring = { ...base, evidenceType: 'CAL_ACCESS_FILING', actionTaken: 'ACTED_FOR' };
    expect(weightForAchievement(b)).toBe(1);
  });

  it('PAC FILING over threshold (ACTED_AGAINST) is -1', () => {
    const a: AchievementForScoring = { ...base, evidenceType: 'FEC_FILING', actionTaken: 'ACTED_AGAINST' };
    expect(weightForAchievement(a)).toBe(-1);
    const b: AchievementForScoring = { ...base, evidenceType: 'CAL_ACCESS_FILING', actionTaken: 'ACTED_AGAINST' };
    expect(weightForAchievement(b)).toBe(-1);
  });

  it('NO_RECORD contributes 0', () => {
    const a: AchievementForScoring = { ...base, evidenceType: 'VOTE', actionTaken: 'NO_RECORD' };
    expect(weightForAchievement(a)).toBe(0);
  });
});

describe('pacScoreFromRatio — v1.4 continuous gradient', () => {
  it('returns +2 at zero corporate', () => {
    expect(pacScoreFromRatio(0)).toBeCloseTo(2);
  });
  it('returns +1 at exactly 5%', () => {
    expect(pacScoreFromRatio(0.05)).toBeCloseTo(1);
  });
  it('returns 0 at 15%', () => {
    expect(pacScoreFromRatio(0.15)).toBeCloseTo(0);
  });
  it('returns -1 at 35%', () => {
    expect(pacScoreFromRatio(0.35)).toBeCloseTo(-1);
  });
  it('returns -2 at 65%', () => {
    expect(pacScoreFromRatio(0.65)).toBeCloseTo(-2);
  });
  it('returns -3 at 85%', () => {
    expect(pacScoreFromRatio(0.85)).toBeCloseTo(-3);
  });
  it('clamps to -3 above 85%', () => {
    expect(pacScoreFromRatio(0.95)).toBeCloseTo(-3);
    expect(pacScoreFromRatio(1.0)).toBeCloseTo(-3);
  });
  it('clamps to +2 below 0', () => {
    // Shouldn't happen in practice but worth covering
    expect(pacScoreFromRatio(-0.1)).toBeCloseTo(2);
  });
  it('interpolates linearly between anchors — 2.5% → +1.5', () => {
    expect(pacScoreFromRatio(0.025)).toBeCloseTo(1.5);
  });
  it('interpolates linearly between anchors — 10% → +0.5', () => {
    expect(pacScoreFromRatio(0.1)).toBeCloseTo(0.5);
  });
  it('interpolates linearly between anchors — 50% → -1.5', () => {
    expect(pacScoreFromRatio(0.5)).toBeCloseTo(-1.5);
  });
});

describe('rawToPercent — v1.4 anchored display', () => {
  it('returns 0% at raw 0', () => {
    expect(rawToPercent(0, 25, -10)).toBe(0);
  });
  it('returns 100% at positive anchor', () => {
    expect(rawToPercent(25, 25, -10)).toBe(100);
  });
  it('returns -100% at negative anchor', () => {
    expect(rawToPercent(-10, 25, -10)).toBe(-100);
  });
  it('returns 50% halfway up positive side', () => {
    expect(rawToPercent(12.5, 25, -10)).toBe(50);
  });
  it('returns -50% halfway down negative side', () => {
    expect(rawToPercent(-5, 25, -10)).toBe(-50);
  });
  it('clamps above positive anchor to +100', () => {
    expect(rawToPercent(100, 25, -10)).toBe(100);
  });
  it('clamps below negative anchor to -100', () => {
    expect(rawToPercent(-50, 25, -10)).toBe(-100);
  });
  it('handles asymmetric anchors correctly', () => {
    // positive scale is +25, negative scale is -8
    expect(rawToPercent(12.5, 25, -8)).toBe(50); // halfway up
    expect(rawToPercent(-4, 25, -8)).toBe(-50); // halfway down
  });
  it('returns 0% when both anchors are 0 (defensive)', () => {
    expect(rawToPercent(5, 0, 0)).toBe(0);
  });
});
