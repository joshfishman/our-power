// Breakdown ↔ scorer parity (methodology v0.9).
//
// The Voting Score (scripts/compute-scores.ts → computePlankTallies) and the
// detail page's "X aligned of Y bills" line (queries.ts →
// getLegislatorBillBreakdown) must be two views of the SAME tally. Both are
// built from the pure predicates exported by voting-alignment.ts. This test
// runs one synthetic legislature through BOTH code paths:
//
//   Path A (scorer):    loadBills/loadCosponsors/loadMarkerSlots (mock Prisma)
//                       → computePlankTallies
//   Path B (breakdown): the getLegislatorBillBreakdown algorithm — chamber
//                       filter → bill-level aggregation → per-plank rows —
//                       expressed with the same pure predicates
//
// and asserts identical per-plank aligned/total counts, including the three
// v0.9 rules that historically diverged:
//   1. a non-voting delegate (state PR, chamber REP) has ZERO roll-call
//      eligibility (scored on cosponsorship/markers only);
//   2. a marker that fails the public-support gate contributes nothing;
//   3. an un-cosponsored marker is ABSENT from the denominator (never drags).

import { describe, expect, it } from 'vitest';
import {
  loadAlignmentUniverse,
  computePlankTallies,
  isLegAlignedOnBill,
  isNonVotingDelegate,
  billChamberMatchesLeg,
  MARKER_STORAGE_TYPE_MAP,
  stripBillNum,
} from '@/lib/scorecard/voting-alignment';
import type { LegForTally, RcChamber } from '@/lib/scorecard/voting-alignment';
import { passesPublicSupportGate } from '@/lib/scorecard/public-support';

// ─── Synthetic legislature ───────────────────────────────────────────────────

const LEG_A: LegForTally = { id: 'leg-a', jurisdiction: 'FEDERAL', chamber: 'REP', state: 'OH' };
const LEG_PR: LegForTally = { id: 'leg-pr', jurisdiction: 'FEDERAL', chamber: 'REP', state: 'PR' }; // delegate

// Roll-call rows in DB shape (storage-form billType + bare billNumber).
// HR 10 has TWO roll calls (cloture + passage) — bill-level dedup must count
// it once, aligned if EITHER roll call was aligned.
const RC_VOTES = [
  {
    chamber: 'HOUSE',
    billType: 'HR',
    billNumber: '10',
    plankNumbers: [1],
    alignedPosition: 'YES',
    positions: [
      { legislatorId: 'leg-a', position: 'NOT_VOTING' },
      { legislatorId: 'leg-pr', position: 'YES' }, // delegates can't really vote; tests the rule wins anyway
    ],
  },
  {
    chamber: 'HOUSE',
    billType: 'HR',
    billNumber: '10',
    plankNumbers: [1],
    alignedPosition: 'YES',
    positions: [{ legislatorId: 'leg-a', position: 'YES' }],
  },
  // HR 20 — leg-a voted NO but cosponsored: aligned via cosponsorship.
  {
    chamber: 'HOUSE',
    billType: 'HR',
    billNumber: '20',
    plankNumbers: [2],
    alignedPosition: 'YES',
    positions: [{ legislatorId: 'leg-a', position: 'NO' }],
  },
  // HR 30 — leg-a voted NO, no cosponsorship: stays in the denominator (drag).
  {
    chamber: 'HOUSE',
    billType: 'HR',
    billNumber: '30',
    plankNumbers: [1],
    alignedPosition: 'YES',
    positions: [{ legislatorId: 'leg-a', position: 'NO' }],
  },
  // S 5 — Senate bill; must never enter a House member's universe.
  {
    chamber: 'SENATE',
    billType: 'S',
    billNumber: '5',
    plankNumbers: [1],
    alignedPosition: 'YES',
    positions: [{ legislatorId: 'leg-a', position: 'YES' }],
  },
];

const COSPONSORS = [
  { jurisdiction: 'FEDERAL', billType: 'HR', billNumber: '20', legislatorId: 'leg-a' },
  { jurisdiction: 'FEDERAL', billType: 'HR', billNumber: '300', legislatorId: 'leg-a' },
  { jurisdiction: 'FEDERAL', billType: 'HR', billNumber: '300', legislatorId: 'leg-pr' },
];

// Marker rows in DB shape (marker-bill form billType + formatted billNumber).
const MARKERS = [
  {
    id: 'm-audit',
    slug: 'pentagon-audit', // 83% — passes the gate
    plank: { number: 5, jurisdiction: 'FEDERAL' },
    bills: [{ billType: 'HOUSE_BILL', billNumber: 'H.R. 300', sponsorships: [] }],
  },
  {
    id: 'm-gated',
    slug: 'state-department-funding', // not in PUBLIC_SUPPORT — gated OUT
    plank: { number: 5, jurisdiction: 'FEDERAL' },
    bills: [{ billType: 'HOUSE_BILL', billNumber: 'H.R. 400', sponsorships: [{ legislatorId: 'leg-a' }] }],
  },
  {
    id: 'm-uncosponsored',
    slug: 'minimum-wage-increase', // 65% — passes, but neither test leg cosponsored
    plank: { number: 3, jurisdiction: 'FEDERAL' },
    bills: [{ billType: 'SENATE_BILL', billNumber: 'S. 500', sponsorships: [{ legislatorId: 'someone-else' }] }],
  },
  {
    id: 'm-billless',
    slug: 'corporate-pac-refusal', // bill-less — PAC Score territory, never here
    plank: { number: 1, jurisdiction: 'FEDERAL' },
    bills: [],
  },
];

const mockPrisma = {
  rollCallVote: { findMany: async () => RC_VOTES },
  billCosponsor: { findMany: async () => COSPONSORS },
  marker: { findMany: async () => MARKERS },
} as unknown as Parameters<typeof loadAlignmentUniverse>[0];

// ─── Path B — the breakdown algorithm, expressed with the pure predicates ────
//
// Mirrors getLegislatorBillBreakdown (queries.ts): chamber filter + delegate
// rule, bill-level aggregation keyed `${billType}|${billNumber}`, alignment
// via isLegAlignedOnBill, marker rows gated + aligned-only.

function breakdownTally(leg: LegForTally): Map<number, { aligned: number; total: number }> {
  const tally = new Map<number, { aligned: number; total: number }>();
  const bump = (plank: number, aligned: boolean) => {
    const cur = tally.get(plank) ?? { aligned: 0, total: 0 };
    cur.total += 1;
    if (aligned) cur.aligned += 1;
    tally.set(plank, cur);
  };

  const cosponsorKeys = new Set(
    COSPONSORS.filter((c) => c.legislatorId === leg.id && c.jurisdiction === leg.jurisdiction).map(
      (c) => `${c.billType}|${c.billNumber}`,
    ),
  );

  // Roll-call side — skipped entirely for non-voting delegates.
  if (!isNonVotingDelegate(leg)) {
    interface Agg {
      plankNumbers: Set<number>;
      votedAligned: boolean;
    }
    const billAggs = new Map<string, Agg>();
    for (const v of RC_VOTES) {
      if (!billChamberMatchesLeg(v.chamber as RcChamber, leg.jurisdiction, leg.chamber)) continue;
      const key = `${v.billType}|${v.billNumber}`;
      let agg = billAggs.get(key);
      if (!agg) {
        agg = { plankNumbers: new Set(), votedAligned: false };
        billAggs.set(key, agg);
      }
      for (const p of v.plankNumbers) agg.plankNumbers.add(p);
      const pos = v.positions.find((x) => x.legislatorId === leg.id)?.position ?? null;
      if (pos === v.alignedPosition) agg.votedAligned = true;
    }
    for (const [key, agg] of billAggs) {
      const aligned = isLegAlignedOnBill(agg.votedAligned, cosponsorKeys.has(key));
      for (const p of agg.plankNumbers) bump(p, aligned);
    }
  }

  // Marker side — gate + cosponsor-only-helps (aligned-only rows).
  for (const m of MARKERS) {
    if (m.bills.length === 0) continue;
    if (m.plank.jurisdiction === 'FEDERAL' && !passesPublicSupportGate(m.slug)) continue;
    if (m.plank.jurisdiction !== leg.jurisdiction) continue;
    let anyAligned = false;
    for (const b of m.bills) {
      const storageType = MARKER_STORAGE_TYPE_MAP[b.billType];
      if (!storageType) continue;
      const num = stripBillNum(b.billNumber);
      if (!num) continue;
      const sponsored = b.sponsorships.some((s) => s.legislatorId === leg.id);
      if (cosponsorKeys.has(`${storageType}|${num}`) || sponsored) anyAligned = true;
    }
    // v0.9: un-cosponsored markers are EXCLUDED from the denominator.
    if (anyAligned) bump(m.plank.number, true);
  }

  return tally;
}

// ─── The parity assertion ────────────────────────────────────────────────────

describe('breakdown ↔ scorer parity (v0.9)', () => {
  it('produces identical per-plank aligned/total via both code paths for a regular House member', async () => {
    const universe = await loadAlignmentUniverse(mockPrisma);
    const scorer = computePlankTallies(LEG_A, universe);
    const breakdown = breakdownTally(LEG_A);

    // Expected by hand:
    //   Plank 1: HR 10 aligned (dedup'd, aligned on 2nd roll call) + HR 30 drag → 1/2
    //   Plank 2: HR 20 aligned via cosponsorship → 1/1
    //   Plank 5: pentagon-audit marker aligned via HR 300 cosponsorship → 1/1
    //   Plank 3: minimum-wage marker NOT cosponsored → absent (no entry)
    //   gated marker (plank 5) and Senate bill S 5 contribute nothing
    expect(scorer.perPlank.get(1)).toEqual({ aligned: 1, total: 2 });
    expect(scorer.perPlank.get(2)).toEqual({ aligned: 1, total: 1 });
    expect(scorer.perPlank.get(5)).toEqual({ aligned: 1, total: 1 });
    expect(scorer.perPlank.has(3)).toBe(false);

    expect(Object.fromEntries(breakdown)).toEqual(Object.fromEntries(scorer.perPlank));
  });

  it('a delegate (state=PR, chamber=REP) gets zero roll-call eligibility on both paths', async () => {
    const universe = await loadAlignmentUniverse(mockPrisma);
    const scorer = computePlankTallies(LEG_PR, universe);
    const breakdown = breakdownTally(LEG_PR);

    // No roll-call bills at all (even HR 10 where a stray YES position row
    // exists); only the cosponsored pentagon-audit marker counts.
    expect(scorer.perPlank.get(5)).toEqual({ aligned: 1, total: 1 });
    expect(scorer.perPlank.has(1)).toBe(false);
    expect(scorer.perPlank.has(2)).toBe(false);
    expect(scorer.overall).toEqual({ aligned: 1, total: 1 });

    expect(Object.fromEntries(breakdown)).toEqual(Object.fromEntries(scorer.perPlank));
  });

  it('a gated-out marker contributes nothing on either path', async () => {
    const universe = await loadAlignmentUniverse(mockPrisma);
    // leg-a SPONSORED the gated marker's bill — it still must not appear.
    expect(universe.markerSlots.find((s) => s.markerId === 'm-gated')).toBeUndefined();
    const scorer = computePlankTallies(LEG_A, universe);
    const breakdown = breakdownTally(LEG_A);
    // Plank 5 has exactly the one (gate-passing) marker on both paths.
    expect(scorer.perPlank.get(5)).toEqual({ aligned: 1, total: 1 });
    expect(breakdown.get(5)).toEqual({ aligned: 1, total: 1 });
  });

  it('an un-cosponsored marker is absent from the denominator on both paths', async () => {
    const universe = await loadAlignmentUniverse(mockPrisma);
    // The slot exists in the universe (someone-else cosponsored it) …
    const slot = universe.markerSlots.find((s) => s.markerId === 'm-uncosponsored');
    expect(slot).toBeDefined();
    expect(slot!.alignedLegIds.has('leg-a')).toBe(false);
    // … but contributes neither aligned nor total for leg-a on either path.
    const scorer = computePlankTallies(LEG_A, universe);
    const breakdown = breakdownTally(LEG_A);
    expect(scorer.perPlank.has(3)).toBe(false);
    expect(breakdown.has(3)).toBe(false);
  });
});
