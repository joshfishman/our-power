import { describe, expect, it } from 'vitest';
import { scoreLegislator, scorePlank, METHODOLOGY_VERSION } from '@/lib/scorecard/scoring';
import type { ScoringPlank } from '@/lib/scorecard/scoring';

// Methodology v1.2: each ACTED_FOR = +1, each ACTED_AGAINST = -1.
// Plank score = sum (can be negative). Total = sum of plank scores.

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

const set = (...ids: string[]) => new Set(ids);

describe('scorePlank — +1 / -1 model', () => {
  it('returns 0 when nothing is acted on', () => {
    expect(scorePlank(plank, set(), set()).score).toBe(0);
  });

  it('returns +1 for one ACTED_FOR', () => {
    expect(scorePlank(plank, set('m1'), set()).score).toBe(1);
  });

  it('returns -1 for one ACTED_AGAINST', () => {
    expect(scorePlank(plank, set(), set('m1')).score).toBe(-1);
  });

  it('returns net (for − against)', () => {
    expect(scorePlank(plank, set('m1', 'm2', 'm3'), set('m4')).score).toBe(2); // 3 − 1
    expect(scorePlank(plank, set('m1'), set('m2', 'm3', 'm4')).score).toBe(-2); // 1 − 3
  });

  it('hits the floor when every marker is against', () => {
    expect(scorePlank(plank, set(), set('m1', 'm2', 'm3', 'm4')).score).toBe(-4);
  });

  it('hits the ceiling when every marker is for', () => {
    expect(scorePlank(plank, set('m1', 'm2', 'm3', 'm4'), set()).score).toBe(4);
  });

  it('exposes the for/against counts in the result', () => {
    const r = scorePlank(plank, set('m1', 'm2'), set('m3'));
    expect(r.forCount).toBe(2);
    expect(r.againstCount).toBe(1);
    expect(r.measuredMarkers).toBe(3);
    expect(r.totalMarkers).toBe(4);
    expect(r.notes).toContain(`methodology=${METHODOLOGY_VERSION}`);
    expect(r.notes).toContain('+2 −1');
  });

  it("ignores marker IDs that don't belong to the plank", () => {
    expect(scorePlank(plank, set('other-plank-marker'), set()).score).toBe(0);
  });
});

describe('scoreLegislator — federal (5 planks)', () => {
  const federalPlanks: ScoringPlank[] = [1, 2, 3, 4, 5].map((n) => ({
    id: `p-${n}`,
    number: n,
    markers: [
      { id: `p${n}-primary`, markerType: 'PRIMARY' },
      { id: `p${n}-s1`, markerType: 'SECONDARY' },
      { id: `p${n}-s2`, markerType: 'SECONDARY' },
    ],
  }));

  it('totals to +15 when every marker hits ACTED_FOR', () => {
    const allFor = new Set<string>();
    for (let n = 1; n <= 5; n += 1) {
      allFor.add(`p${n}-primary`);
      allFor.add(`p${n}-s1`);
      allFor.add(`p${n}-s2`);
    }
    const result = scoreLegislator(federalPlanks, {
      legislatorId: 'L1',
      forIds: allFor,
      againstIds: new Set(),
    });
    expect(result.total).toBe(15);
    expect(result.totalFor).toBe(15);
    expect(result.totalAgainst).toBe(0);
  });

  it('totals to -15 when every marker hits ACTED_AGAINST', () => {
    const allAgainst = new Set<string>();
    for (let n = 1; n <= 5; n += 1) {
      allAgainst.add(`p${n}-primary`);
      allAgainst.add(`p${n}-s1`);
      allAgainst.add(`p${n}-s2`);
    }
    const result = scoreLegislator(federalPlanks, {
      legislatorId: 'L1',
      forIds: new Set(),
      againstIds: allAgainst,
    });
    expect(result.total).toBe(-15);
  });

  it('mixes: +5 on Plank 1, -2 on Plank 2 → net +3', () => {
    const result = scoreLegislator(federalPlanks, {
      legislatorId: 'L1',
      forIds: new Set(['p1-primary', 'p1-s1', 'p1-s2', 'p2-s1']),
      againstIds: new Set(['p2-primary', 'p2-s2', 'p3-primary']),
    });
    expect(result.perPlank[0].score).toBe(3); // 3 for, 0 against
    expect(result.perPlank[1].score).toBe(-1); // 1 for, 2 against
    expect(result.perPlank[2].score).toBe(-1); // 0 for, 1 against
    expect(result.total).toBe(1); // 3 − 1 − 1 + 0 + 0
  });
});
