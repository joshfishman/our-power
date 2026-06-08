import { describe, expect, it } from 'vitest';
import { METHODOLOGY_VERSION, pacScoreFromRatio } from '@/lib/scorecard/scoring';
import {
  billChamberMatchesLeg,
  isLegAlignedOnBill,
  computePlankTallies,
  type AlignmentUniverse,
  type BillState,
  type LegForTally,
} from '@/lib/scorecard/voting-alignment';

// v0.9 — the RATIO voting model. Per (legislator, plank):
//   voting% = aligned ÷ total × 100
// total (eligible) = chamber-gated scorable roll-call bills ∪ marker slots
//                    (bill-level dedup)
// aligned = voted-aligned ∪ cosponsored ∪ marker-sponsored
// An absence / NO vote stays in the denominator (a drag), NEVER −1.
// Insufficient-data planks (0 eligible) get NO row → excluded from the mean.
// PAC is its own separate score and never enters a plank voting tally.

describe('METHODOLOGY_VERSION', () => {
  it('is v0.9 (intentionally sub-1.0: correct model, not yet finished)', () => {
    expect(METHODOLOGY_VERSION).toBe('v0.9');
  });
});

describe('billChamberMatchesLeg — chamber gating', () => {
  it('House bill scores House members only', () => {
    expect(billChamberMatchesLeg('HOUSE', 'FEDERAL', 'REP')).toBe(true);
    expect(billChamberMatchesLeg('HOUSE', 'FEDERAL', 'SEN')).toBe(false);
  });
  it('Senate bill scores Senators only', () => {
    expect(billChamberMatchesLeg('SENATE', 'FEDERAL', 'SEN')).toBe(true);
    expect(billChamberMatchesLeg('SENATE', 'FEDERAL', 'REP')).toBe(false);
  });
  it('never matches across jurisdiction', () => {
    expect(billChamberMatchesLeg('HOUSE', 'CA', 'REP')).toBe(false);
    expect(billChamberMatchesLeg('CA_ASSEMBLY', 'FEDERAL', 'REP')).toBe(false);
  });
  it('CA chambers map Assembly→REP, Senate→SEN', () => {
    expect(billChamberMatchesLeg('CA_ASSEMBLY', 'CA', 'REP')).toBe(true);
    expect(billChamberMatchesLeg('CA_SENATE', 'CA', 'SEN')).toBe(true);
    expect(billChamberMatchesLeg('CA_ASSEMBLY', 'CA', 'SEN')).toBe(false);
  });
});

describe('isLegAlignedOnBill — aligned iff voted-aligned OR cosponsored', () => {
  it('voted aligned → aligned', () => {
    expect(isLegAlignedOnBill(true, false)).toBe(true);
  });
  it('cosponsored → aligned', () => {
    expect(isLegAlignedOnBill(false, true)).toBe(true);
  });
  it('neither (absence / NO / no cosponsor) → NOT aligned (but never a penalty)', () => {
    expect(isLegAlignedOnBill(false, false)).toBe(false);
  });
});

// ─── computePlankTallies — the ratio model end-to-end (pure, hand-built) ────

function bill(
  chamber: BillState['chamber'],
  billType: string,
  billNumber: string,
  planks: number[],
  alignedLegIds: string[],
): [string, BillState] {
  return [
    `${chamber}|${billType}|${billNumber}`,
    {
      chamber,
      billType,
      billNumber,
      plankSet: new Set(planks),
      legsAligned: new Set(alignedLegIds),
    },
  ];
}

const houseLeg: LegForTally = { id: 'leg-house', jurisdiction: 'FEDERAL', chamber: 'REP' };

describe('computePlankTallies — ratio model', () => {
  it('aligned ÷ total × 100 per plank, with absence as a denominator drag (not −1)', () => {
    // Plank 1: bill A (voted aligned) + bill B (no vote, no cosponsor) →
    //   aligned=1, total=2 → 50%. Bill B drags the denominator, doesn't go −1.
    const universe: AlignmentUniverse = {
      bills: new Map([
        bill('HOUSE', 'HR', '1', [1], ['leg-house']), // aligned
        bill('HOUSE', 'HR', '2', [1], []), // absent → drag
      ]),
      cosponsorsByBill: new Map(),
      markerSlots: [],
    };
    const { perPlank, overall } = computePlankTallies(houseLeg, universe);
    expect(perPlank.get(1)).toEqual({ aligned: 1, total: 2 });
    expect(overall).toEqual({ aligned: 1, total: 2 });
  });

  it('cosponsorship counts as aligned even with no vote', () => {
    const universe: AlignmentUniverse = {
      bills: new Map([bill('HOUSE', 'HR', '10', [2], [])]),
      cosponsorsByBill: new Map([['FEDERAL|HR|10', new Set(['leg-house'])]]),
      markerSlots: [],
    };
    const { perPlank } = computePlankTallies(houseLeg, universe);
    expect(perPlank.get(2)).toEqual({ aligned: 1, total: 1 });
  });

  it('chamber gating: a Senate bill does not enter a House member tally', () => {
    const universe: AlignmentUniverse = {
      bills: new Map([
        bill('HOUSE', 'HR', '1', [1], ['leg-house']),
        bill('SENATE', 'S', '1', [1], []), // wrong chamber — skipped
      ]),
      cosponsorsByBill: new Map(),
      markerSlots: [],
    };
    const { perPlank } = computePlankTallies(houseLeg, universe);
    expect(perPlank.get(1)).toEqual({ aligned: 1, total: 1 });
  });

  it('insufficient-data plank: a plank with 0 eligible bills gets NO entry', () => {
    const universe: AlignmentUniverse = {
      bills: new Map([bill('HOUSE', 'HR', '1', [1], ['leg-house'])]),
      cosponsorsByBill: new Map(),
      markerSlots: [],
    };
    const { perPlank } = computePlankTallies(houseLeg, universe);
    expect(perPlank.has(1)).toBe(true);
    expect(perPlank.has(2)).toBe(false); // no row → excluded from the average
  });

  it('genuinely-engaged-but-unaligned plank scores a real 0% (row exists)', () => {
    const universe: AlignmentUniverse = {
      bills: new Map([bill('HOUSE', 'HR', '5', [3], [])]), // eligible, not aligned
      cosponsorsByBill: new Map(),
      markerSlots: [],
    };
    const { perPlank } = computePlankTallies(houseLeg, universe);
    expect(perPlank.get(3)).toEqual({ aligned: 0, total: 1 }); // 0% — a real row
  });

  it('marker slots are cross-chamber and add to total/aligned', () => {
    const universe: AlignmentUniverse = {
      bills: new Map(),
      cosponsorsByBill: new Map(),
      markerSlots: [
        { markerId: 'm1', plankNumber: 4, jurisdiction: 'FEDERAL', alignedLegIds: new Set(['leg-house']) },
        { markerId: 'm2', plankNumber: 4, jurisdiction: 'FEDERAL', alignedLegIds: new Set() },
        { markerId: 'm3', plankNumber: 4, jurisdiction: 'CA', alignedLegIds: new Set(['leg-house']) }, // wrong juris
      ],
    };
    const { perPlank } = computePlankTallies(houseLeg, universe);
    expect(perPlank.get(4)).toEqual({ aligned: 1, total: 2 });
  });

  it('PAC marker is excluded by construction: bill-less markers never appear as slots', () => {
    // loadMarkerSlots skips bill-less markers, so the universe a real run
    // builds has NO slot for the corporate-PAC-refusal marker. Modelled here
    // by the absence of any PAC slot — the tally is unaffected by PAC.
    const universe: AlignmentUniverse = {
      bills: new Map([bill('HOUSE', 'HR', '1', [1], ['leg-house'])]),
      cosponsorsByBill: new Map(),
      markerSlots: [], // PAC marker would have been dropped at load time
    };
    const { perPlank } = computePlankTallies(houseLeg, universe);
    expect(perPlank.get(1)).toEqual({ aligned: 1, total: 1 }); // pure voting, no PAC
  });
});

describe('pacScoreFromRatio — v1.4 continuous gradient (still LIVE for the separate PAC score)', () => {
  it('returns +2 at zero corporate', () => {
    expect(pacScoreFromRatio(0)).toBeCloseTo(2);
  });
  it('returns +1 at exactly 5%', () => {
    expect(pacScoreFromRatio(0.05)).toBeCloseTo(1);
  });
  it('returns 0 at 15%', () => {
    expect(pacScoreFromRatio(0.15)).toBeCloseTo(0);
  });
  it('returns -3 at 85% and clamps below', () => {
    expect(pacScoreFromRatio(0.85)).toBeCloseTo(-3);
    expect(pacScoreFromRatio(1.0)).toBeCloseTo(-3);
  });
  it('interpolates linearly between anchors', () => {
    expect(pacScoreFromRatio(0.025)).toBeCloseTo(1.5);
    expect(pacScoreFromRatio(0.5)).toBeCloseTo(-1.5);
  });
});
