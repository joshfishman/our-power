// v0.9 — per-cycle PAC ratio unit tests for computePerCyclePacScore, the pure
// helper shared by getLegislatorMoneyTrail (detail page) and
// getPacScoresByLegislatorV171 (index bulk).

import { describe, expect, it, vi } from 'vitest';

import { computePerCyclePacScore } from '@/lib/scorecard/queries';

// queries.ts imports the prisma client at module top; mock it so the pure
// helper can be imported without a DATABASE_URL.
vi.mock('@/lib/prisma/prisma', () => ({ default: {} }));

const cycle = (
  cycleYear: number,
  { ca = 0, benef = 0, ie = 0, receipts = 0 }: { ca?: number; benef?: number; ie?: number; receipts?: number },
) => ({ cycle: cycleYear, countsAgainst: ca, beneficiary: benef, ieSupport: ie, receipts });

describe('computePerCyclePacScore', () => {
  it('returns null with no cycles at all', () => {
    expect(computePerCyclePacScore([]).pacScore).toBeNull();
  });

  it('scores a single clean cycle as 100', () => {
    const { pacScore, perCycle } = computePerCyclePacScore([cycle(2024, { receipts: 1_000_000 })]);
    expect(pacScore).toBe(100);
    expect(perCycle).toEqual([{ cycle: 2024, ratio: 0, countsAgainst: 0, denominator: 1_000_000, included: true }]);
  });

  it('averages per-cycle ratios with equal weight — a mega-cycle cannot dilute the rest', () => {
    // Old blended math: (10k + 200k) / (1M + 400k) = 15% → score 85.
    // Per-cycle: mean(1%, 50%) = 25.5% → score 75 — the corporate-heavy small
    // cycle keeps its full weight.
    const { pacScore, perCycle } = computePerCyclePacScore([
      cycle(2020, { ca: 10_000, receipts: 1_000_000 }),
      cycle(2026, { ca: 200_000, receipts: 400_000 }),
    ]);
    expect(perCycle.map((c) => c.ratio)).toEqual([0.01, 0.5]);
    expect(pacScore).toBe(75); // round((1 − 0.255) × 100)
  });

  it('puts beneficiary IE in both numerator and denominator of its cycle', () => {
    const { perCycle } = computePerCyclePacScore([cycle(2024, { ca: 0, benef: 50_000, receipts: 50_000 })]);
    // ratio = (0 + 50k) / (50k + 0 + 50k) = 0.5
    expect(perCycle).toEqual([
      { cycle: 2024, ratio: 0.5, countsAgainst: 50_000, denominator: 100_000, included: true },
    ]);
  });

  it('adds IE_SUPPORT to the cycle denominator', () => {
    const { perCycle } = computePerCyclePacScore([cycle(2024, { ca: 30_000, ie: 50_000, receipts: 50_000 })]);
    expect(perCycle[0].denominator).toBe(100_000);
    expect(perCycle[0].ratio).toBeCloseTo(0.3);
  });

  it('drops a $0-receipts cycle with counts-against activity (per-cycle v1.7.7 guard)', () => {
    const { pacScore, perCycle } = computePerCyclePacScore([
      cycle(2022, { ca: 100_000, ie: 500_000, receipts: 0 }), // IE-only — dropped
      cycle(2024, { ca: 0, receipts: 1_000_000 }),
    ]);
    expect(perCycle.map((c) => c.cycle)).toEqual([2024]);
    expect(pacScore).toBe(100);
  });

  it('returns null when ALL cycles drop', () => {
    const { pacScore, perCycle } = computePerCyclePacScore([
      cycle(2022, { ca: 100_000, ie: 500_000, receipts: 0 }),
      cycle(2024, { ca: 1, receipts: 0 }),
    ]);
    expect(perCycle).toEqual([]);
    expect(pacScore).toBeNull();
  });

  it('skips zero-denominator cycles without nulling the rest', () => {
    const { pacScore, perCycle } = computePerCyclePacScore([
      cycle(2022, {}), // all zeros — skipped
      cycle(2024, { ca: 100_000, receipts: 1_000_000 }),
    ]);
    expect(perCycle.map((c) => c.cycle)).toEqual([2024]);
    expect(pacScore).toBe(90);
  });

  it('DROPS an incomplete >100% cycle from the mean rather than clamping it (v0.9)', () => {
    // Observed in the wild: Graham 2026 counted $1.66M vs $930K reported
    // receipts → raw ratio ~178%. A share of money cannot exceed 100%, so this
    // is the tell of an incomplete in-progress receipts snapshot. v0.9 drops it
    // from the mean entirely (the old behavior clamped it to 1.0 and averaged,
    // dragging the score from 75 → 38).
    const { pacScore, perCycle } = computePerCyclePacScore([
      cycle(2020, { ca: 250_000, receipts: 1_000_000 }),
      cycle(2026, { ca: 1_660_000, receipts: 930_000 }),
    ]);
    // Both cycles are still reported (raw, unclamped) but only 2020 is included.
    expect(perCycle.map((c) => c.cycle)).toEqual([2020, 2026]);
    expect(perCycle[1].ratio).toBeGreaterThan(1); // raw, not clamped
    expect(perCycle[1].included).toBe(false);
    expect(perCycle[0].included).toBe(true);
    expect(pacScore).toBe(75); // round((1 − 0.25) × 100) — 2020 cycle only
  });

  it('falls back to the most-recent cycle ratio (clamped) when ALL cycles are incomplete', () => {
    // Every surviving cycle has a raw ratio > 1 (all snapshots incomplete).
    // Rather than null, fall back to the single most-recent cycle's clamped ratio.
    const { pacScore, perCycle } = computePerCyclePacScore([
      cycle(2024, { ca: 1_500_000, receipts: 1_000_000 }), // raw 1.5
      cycle(2026, { ca: 2_000_000, receipts: 1_000_000 }), // raw 2.0, most recent
    ]);
    expect(perCycle.every((c) => c.included === false)).toBe(true);
    // most-recent (2026) raw ratio 2.0 clamped to 1.0 → score 0.
    expect(pacScore).toBe(0);
  });

  it('sorts the per-cycle rows ascending by cycle', () => {
    const { perCycle } = computePerCyclePacScore([
      cycle(2026, { receipts: 1 }),
      cycle(2018, { receipts: 1 }),
      cycle(2022, { receipts: 1 }),
    ]);
    expect(perCycle.map((c) => c.cycle)).toEqual([2018, 2022, 2026]);
  });
});
