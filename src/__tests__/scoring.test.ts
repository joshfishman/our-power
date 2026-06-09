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
import {
  computePlankTallies,
  loadMarkerSlots,
  isNonVotingDelegate,
  billChamberMatchesLeg,
  isLegAlignedOnBill,
} from '@/lib/scorecard/voting-alignment';
import type { AlignmentUniverse, BillState, MarkerSlot, LegForTally } from '@/lib/scorecard/voting-alignment';
import { passesPublicSupportGate } from '@/lib/scorecard/public-support';

// Methodology v1.3: weighted scoring via weightForAchievement.
// Plank score = sum of weighted achievements. Total = sum of plank scores.
// Methodology v0.9 (current): ratio voting model — see the
// "v0.9 ratio model" describes at the bottom of this file.

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
  it('is v0.9', () => {
    expect(METHODOLOGY_VERSION).toBe('v0.9');
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

// ─── v0.9 ratio model (voting-alignment.ts) ─────────────────────────────────
//
// voting% per plank = aligned ÷ total × 100 where
//   total   = chamber-gated scorable roll-call bills (bill-level dedup)
//             ∪ marker slots the legislator actually cosponsored
//   aligned = voted the aligned position on ANY roll call for the bill
//             ∪ cosponsored it ∪ sponsored a marker bill
// Rules under test: delegate rule (no roll-call eligibility), public-support
// gate (federal markers only), cosponsor-only-helps (un-cosponsored markers
// are EXCLUDED from the denominator — they never drag).

function mkBill(partial: Partial<BillState> & Pick<BillState, 'chamber' | 'billType' | 'billNumber'>): BillState {
  return {
    plankSet: new Set([1]),
    legsAligned: new Set<string>(),
    ...partial,
  };
}

function mkUniverse(
  bills: BillState[],
  markerSlots: MarkerSlot[] = [],
  cosponsors?: Map<string, Set<string>>,
): AlignmentUniverse {
  const billMap = new Map<string, BillState>();
  for (const b of bills) billMap.set(`${b.chamber}|${b.billType}|${b.billNumber}`, b);
  return { bills: billMap, cosponsorsByBill: cosponsors ?? new Map(), markerSlots };
}

const houseLeg: LegForTally = { id: 'leg-house', jurisdiction: 'FEDERAL', chamber: 'REP', state: 'OH' };

describe('computePlankTallies — v0.9 ratio model', () => {
  it('counts a voted-aligned bill as aligned and a missed/NO vote as an in-denominator drag', () => {
    const universe = mkUniverse([
      mkBill({ chamber: 'HOUSE', billType: 'HR', billNumber: '100', legsAligned: new Set(['leg-house']) }),
      mkBill({ chamber: 'HOUSE', billType: 'HR', billNumber: '200' }), // no aligned vote, no cosponsor → drag
    ]);
    const r = computePlankTallies(houseLeg, universe);
    expect(r.overall).toEqual({ aligned: 1, total: 2 });
    expect(r.perPlank.get(1)).toEqual({ aligned: 1, total: 2 });
  });

  it('chamber-gates roll-call bills (Senate bills never score a House member)', () => {
    const universe = mkUniverse([
      mkBill({ chamber: 'SENATE', billType: 'S', billNumber: '1', legsAligned: new Set(['leg-house']) }),
    ]);
    const r = computePlankTallies(houseLeg, universe);
    expect(r.overall).toEqual({ aligned: 0, total: 0 });
    expect(r.perPlank.size).toBe(0);
  });

  it('counts a cosponsored bill as aligned even without an aligned vote', () => {
    const cosponsors = new Map([['FEDERAL|HR|100', new Set(['leg-house'])]]);
    const universe = mkUniverse([mkBill({ chamber: 'HOUSE', billType: 'HR', billNumber: '100' })], [], cosponsors);
    const r = computePlankTallies(houseLeg, universe);
    expect(r.overall).toEqual({ aligned: 1, total: 1 });
  });

  it('delegate rule — a PR Resident Commissioner (chamber REP) gets ZERO roll-call eligibility', () => {
    const delegate: LegForTally = { id: 'leg-pr', jurisdiction: 'FEDERAL', chamber: 'REP', state: 'PR' };
    const universe = mkUniverse(
      [
        // Even a bill where the delegate somehow has an "aligned vote" row must
        // not count — delegates are legally barred from floor votes.
        mkBill({ chamber: 'HOUSE', billType: 'HR', billNumber: '100', legsAligned: new Set(['leg-pr']) }),
        mkBill({ chamber: 'HOUSE', billType: 'HR', billNumber: '200' }),
      ],
      [{ markerId: 'm1', plankNumber: 1, jurisdiction: 'FEDERAL', alignedLegIds: new Set(['leg-pr']) }],
    );
    const r = computePlankTallies(delegate, universe);
    // Roll-call universe fully skipped; scored on the cosponsored marker only.
    expect(r.overall).toEqual({ aligned: 1, total: 1 });
    expect(r.perPlank.get(1)).toEqual({ aligned: 1, total: 1 });
  });

  it('cosponsor-only-helps — an un-cosponsored marker slot is EXCLUDED from the denominator', () => {
    const universe = mkUniverse(
      [mkBill({ chamber: 'HOUSE', billType: 'HR', billNumber: '100', legsAligned: new Set(['leg-house']) })],
      [
        { markerId: 'm-yes', plankNumber: 1, jurisdiction: 'FEDERAL', alignedLegIds: new Set(['leg-house']) },
        { markerId: 'm-no', plankNumber: 1, jurisdiction: 'FEDERAL', alignedLegIds: new Set(['someone-else']) },
      ],
    );
    const r = computePlankTallies(houseLeg, universe);
    // m-no contributes NOTHING — not a drag, simply absent from the total.
    expect(r.overall).toEqual({ aligned: 2, total: 2 });
    expect(r.perPlank.get(1)).toEqual({ aligned: 2, total: 2 });
  });

  it('marker slots are jurisdiction-scoped (CA slot never scores a federal legislator)', () => {
    const universe = mkUniverse(
      [],
      [{ markerId: 'm-ca', plankNumber: 1, jurisdiction: 'CA', alignedLegIds: new Set(['leg-house']) }],
    );
    const r = computePlankTallies(houseLeg, universe);
    expect(r.overall).toEqual({ aligned: 0, total: 0 });
  });
});

describe('isNonVotingDelegate', () => {
  it('flags the six non-voting House seats', () => {
    for (const state of ['AS', 'GU', 'VI', 'MP', 'PR', 'DC']) {
      expect(isNonVotingDelegate({ chamber: 'REP', state })).toBe(true);
    }
  });
  it('never flags senators or voting-state representatives', () => {
    expect(isNonVotingDelegate({ chamber: 'SEN', state: 'PR' })).toBe(false);
    expect(isNonVotingDelegate({ chamber: 'REP', state: 'CA' })).toBe(false);
  });
});

describe('pure predicates', () => {
  it('billChamberMatchesLeg gates by jurisdiction AND chamber', () => {
    expect(billChamberMatchesLeg('HOUSE', 'FEDERAL', 'REP')).toBe(true);
    expect(billChamberMatchesLeg('HOUSE', 'FEDERAL', 'SEN')).toBe(false);
    expect(billChamberMatchesLeg('SENATE', 'FEDERAL', 'SEN')).toBe(true);
    expect(billChamberMatchesLeg('CA_ASSEMBLY', 'CA', 'REP')).toBe(true);
    expect(billChamberMatchesLeg('CA_ASSEMBLY', 'FEDERAL', 'REP')).toBe(false);
  });
  it('isLegAlignedOnBill is an OR of voted-aligned and cosponsored', () => {
    expect(isLegAlignedOnBill(true, false)).toBe(true);
    expect(isLegAlignedOnBill(false, true)).toBe(true);
    expect(isLegAlignedOnBill(false, false)).toBe(false);
  });
});

describe('public-support gate (v0.9)', () => {
  it('passes polled markers at/above 55% and proxy-pass markers', () => {
    expect(passesPublicSupportGate('stock-trading-ban')).toBe(true); // 86%
    expect(passesPublicSupportGate('corporate-pac-refusal')).toBe(true); // proxyPass
    expect(passesPublicSupportGate('pact-act')).toBe(true); // proxyPass
  });
  it('excludes unknown slugs (e.g. the deleted State-Department marker)', () => {
    expect(passesPublicSupportGate('state-department-funding')).toBe(false);
    expect(passesPublicSupportGate('definitely-not-a-marker')).toBe(false);
  });

  it('loadMarkerSlots drops gated-out FEDERAL markers but never gates CA markers', async () => {
    const markers = [
      {
        id: 'm-pass',
        slug: 'pentagon-audit', // 83% — passes
        plank: { number: 5, jurisdiction: 'FEDERAL' },
        bills: [{ billType: 'HOUSE_BILL', billNumber: 'H.R. 100', sponsorships: [{ legislatorId: 'leg-a' }] }],
      },
      {
        id: 'm-gated',
        slug: 'state-department-funding', // no entry — gated out
        plank: { number: 5, jurisdiction: 'FEDERAL' },
        bills: [{ billType: 'HOUSE_BILL', billNumber: 'H.R. 200', sponsorships: [{ legislatorId: 'leg-a' }] }],
      },
      {
        id: 'm-ca',
        slug: 'some-ca-only-marker', // CA markers are NOT gated (no CA polling yet)
        plank: { number: 2, jurisdiction: 'CA' },
        bills: [{ billType: 'CA_ASSEMBLY_BILL', billNumber: 'AB-1900', sponsorships: [] }],
      },
      {
        id: 'm-billless',
        slug: 'corporate-pac-refusal', // bill-less — PAC Score handles it
        plank: { number: 1, jurisdiction: 'FEDERAL' },
        bills: [],
      },
    ];
    const mockPrisma = {
      marker: { findMany: async () => markers },
    } as unknown as Parameters<typeof loadMarkerSlots>[0];
    const cosponsors = new Map([['CA|CA_BILL|AB-1900', new Set(['leg-ca'])]]);
    const slots = await loadMarkerSlots(mockPrisma, cosponsors);
    const ids = slots.map((s) => s.markerId).sort();
    expect(ids).toEqual(['m-ca', 'm-pass']); // gated + bill-less markers dropped
    const caSlot = slots.find((s) => s.markerId === 'm-ca')!;
    expect(caSlot.alignedLegIds.has('leg-ca')).toBe(true); // cosponsor union works
    const passSlot = slots.find((s) => s.markerId === 'm-pass')!;
    expect(passSlot.alignedLegIds.has('leg-a')).toBe(true);
  });
});
