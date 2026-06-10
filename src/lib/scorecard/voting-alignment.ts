// Single source of alignment truth for the civic scorecard's Voting Record.
//
// This module ports the proven v1.7.1 ratio model out of the old
// scripts/compute-scores-v1.7.ts so the compute job AND the display layer
// (queries.ts bill breakdown) share exactly the same eligibility + alignment
// rules. The score and the "X aligned of Y bills" line can never disagree
// again because they come from one place.
//
// Methodology (per (legislator, plank)):
//   voting% = aligned ÷ total × 100
//
//   total (eligible) = scorable roll-call bills gated to the legislator's
//                      chamber ∪ marker scoring-slots for that plank/jurisdiction
//                      (bill-level dedup — a bill in 4 procedural roll calls
//                      counts once)
//   aligned          = voted-aligned on ANY roll call for the bill
//                      ∪ cosponsored the bill
//                      ∪ sponsored any of a marker's bills
//
//   An eligible-but-absent or NO vote stays in the denominator (a drag) and is
//   NEVER −1. Bill-less markers (e.g. corporate-PAC refusal) are SKIPPED here —
//   the PAC Score is its own separate headline number and must not enter any
//   plank's voting tally.
//
// The pure predicates (`billChamberMatchesLeg`, `isLegAlignedOnBill`) are
// exported and side-effect-free so they're unit-testable and reusable. The
// loaders are Prisma-backed because the universe lives in the DB at runtime.

import type { PrismaClient } from '@/generated/prisma/client';
import { passesPublicSupportGate } from './public-support';

export type RcChamber = 'HOUSE' | 'SENATE' | 'CA_ASSEMBLY' | 'CA_SENATE';
export type Jurisdiction = 'FEDERAL' | 'CA';
export type LegChamber = 'SEN' | 'REP';

/** Minimal Prisma surface this module needs — keeps callers (scripts that use
 *  the pg adapter, and the app that uses the shared singleton) interchangeable. */
type PrismaLike = Pick<PrismaClient, 'rollCallVote' | 'billCosponsor' | 'marker'>;

// ─── Pure predicates (no DB, unit-testable) ─────────────────────────────────

export function jurisdictionForChamber(c: RcChamber): Jurisdiction {
  return c === 'HOUSE' || c === 'SENATE' ? 'FEDERAL' : 'CA';
}

/**
 * Chamber gating: does a roll-call bill belong to the chamber a legislator
 * sits in? House bills only score House members; Senate bills only Senators;
 * same split for CA Assembly / CA Senate. Cross-jurisdiction never matches.
 */
export function billChamberMatchesLeg(billChamber: RcChamber, legJur: Jurisdiction, legChamber: LegChamber): boolean {
  const billJur = jurisdictionForChamber(billChamber);
  if (billJur !== legJur) return false;
  const legChamberFromBill: LegChamber = billChamber === 'HOUSE' || billChamber === 'CA_ASSEMBLY' ? 'REP' : 'SEN';
  return legChamberFromBill === legChamber;
}

/**
 * Is a legislator aligned on a single (already chamber-gated) roll-call bill?
 * Aligned iff they voted the platform-aligned position on ANY roll call for
 * the bill, OR they cosponsored it. A NO / absence is NOT aligned but is NOT
 * a penalty — it just isn't in the aligned numerator (it stays in `total`).
 */
export function isLegAlignedOnBill(votedAligned: boolean, cosponsored: boolean): boolean {
  return votedAligned || cosponsored;
}

// Non-voting House members — the 5 territorial delegates (American Samoa,
// Guam, U.S. Virgin Islands, Northern Mariana Islands) plus the D.C. delegate
// and the Puerto Rico Resident Commissioner — cannot cast floor votes. Scoring
// them on ~150 roll-call votes they're legally barred from taking tanks them to
// ~0%. They have no roll-call eligibility, so they're scored on cosponsorship
// (markers) only — consistent with "a missed vote drags only where eligible."
export const NON_VOTING_DELEGATE_STATES = new Set(['AS', 'GU', 'VI', 'MP', 'PR', 'DC']);
export function isNonVotingDelegate(leg: { chamber: LegChamber; state: string }): boolean {
  return leg.chamber === 'REP' && NON_VOTING_DELEGATE_STATES.has(leg.state);
}

// Normalize MarkerBill billType + billNumber → BillCosponsor's storage form,
// so marker bills can be unioned with ingested cosponsor rows.
export const MARKER_STORAGE_TYPE_MAP: Record<string, string> = {
  HOUSE_BILL: 'HR',
  SENATE_BILL: 'S',
  HOUSE_JOINT_RES: 'HJRES',
  SENATE_JOINT_RES: 'SJRES',
  HOUSE_CONCURRENT_RES: 'HCONRES',
  SENATE_CONCURRENT_RES: 'SCONRES',
  HOUSE_RES: 'HRES',
  SENATE_RES: 'SRES',
  CA_ASSEMBLY_BILL: 'CA_BILL',
  CA_SENATE_BILL: 'CA_BILL',
  CA_HOUSE_BILL: 'CA_BILL',
};

export function stripBillNum(raw: string): string | null {
  return raw.match(/\d+/)?.[0] ?? null;
}

// ─── DB-backed universe (loaded once, reused per legislator) ─────────────────

export interface BillState {
  chamber: RcChamber;
  billType: string;
  billNumber: string;
  plankSet: Set<number>;
  /** legislator ids that voted the aligned position on at least one roll call */
  legsAligned: Set<string>;
}

export interface MarkerSlot {
  markerId: string;
  plankNumber: number;
  jurisdiction: Jurisdiction;
  /** legislator ids that sponsored/cosponsored any of the marker's bills */
  alignedLegIds: Set<string>;
}

export interface AlignmentUniverse {
  /** key: `${chamber}|${billType}|${billNumber}` → bill-level aggregate */
  bills: Map<string, BillState>;
  /** key: `${jurisdiction}|${billType}|${billNumber}` → cosponsor leg ids */
  cosponsorsByBill: Map<string, Set<string>>;
  /** cross-chamber marker scoring slots (bill-less markers already excluded) */
  markerSlots: MarkerSlot[];
}

/** Load + reduce the scorable roll-call universe into bill-level aggregates. */
export async function loadBills(prisma: PrismaLike): Promise<Map<string, BillState>> {
  const scorableVotes = await prisma.rollCallVote.findMany({
    where: { isScorable: true, alignedPosition: { not: null }, plankNumbers: { isEmpty: false } },
    select: {
      chamber: true,
      billType: true,
      billNumber: true,
      plankNumbers: true,
      alignedPosition: true,
      positions: { select: { legislatorId: true, position: true } },
    },
  });
  const bills = new Map<string, BillState>();
  for (const v of scorableVotes) {
    if (!v.billType || !v.billNumber || !v.alignedPosition) continue;
    const key = `${v.chamber}|${v.billType}|${v.billNumber}`;
    let bill = bills.get(key);
    if (!bill) {
      bill = {
        chamber: v.chamber as RcChamber,
        billType: v.billType,
        billNumber: v.billNumber,
        plankSet: new Set(),
        legsAligned: new Set(),
      };
      bills.set(key, bill);
    }
    for (const p of v.plankNumbers) bill.plankSet.add(p);
    for (const pos of v.positions) {
      if (pos.position === v.alignedPosition) bill.legsAligned.add(pos.legislatorId);
    }
  }
  return bills;
}

/** Load cosponsor rows keyed by `${jurisdiction}|${billType}|${billNumber}`. */
export async function loadCosponsors(prisma: PrismaLike): Promise<Map<string, Set<string>>> {
  const rows = await prisma.billCosponsor.findMany({
    select: { jurisdiction: true, billType: true, billNumber: true, legislatorId: true },
  });
  const byBill = new Map<string, Set<string>>();
  for (const c of rows) {
    const key = `${c.jurisdiction}|${c.billType}|${c.billNumber}`;
    let s = byBill.get(key);
    if (!s) {
      s = new Set();
      byBill.set(key, s);
    }
    s.add(c.legislatorId);
  }
  return byBill;
}

/**
 * Load marker scoring slots. Each marker with at least one bill becomes a
 * cross-chamber slot for its plank/jurisdiction; aligned legislators are the
 * union of curated BillSponsorship rows and ingested BillCosponsor rows for
 * any of the marker's bills. Bill-less markers (PAC refusal) are SKIPPED —
 * the PAC Score handles that signal separately, so it never lands in a plank
 * voting tally.
 */
export async function loadMarkerSlots(
  prisma: PrismaLike,
  cosponsorsByBill: Map<string, Set<string>>,
): Promise<MarkerSlot[]> {
  const markers = await prisma.marker.findMany({
    include: {
      plank: { select: { number: true, jurisdiction: true } },
      bills: {
        select: {
          billType: true,
          billNumber: true,
          sponsorships: { select: { legislatorId: true } },
        },
      },
    },
  });
  const slots: MarkerSlot[] = [];
  for (const m of markers) {
    if (m.bills.length === 0) continue; // bill-less markers (PAC) handled elsewhere
    // v0.9 public-support gate: only score a marker whose position clears the
    // 55% majority bar (proxyPass for no-poll-but-popular items). Applied to
    // BOTH jurisdictions — CA markers mirror the same federal platform
    // positions and now carry their own PUBLIC_SUPPORT entries that ride the
    // parallel federal poll number ("rides federal <slug>" in public-support.ts),
    // so CA markers are gated by the same evidence as their federal twins
    // rather than left ungated. Every CA marker slug has an entry that clears
    // the gate (the one contested position, single-payer, is proxyPass'd, not
    // dropped). See docs/scorecard/ca-federal-parity.md.
    if (!passesPublicSupportGate(m.slug)) continue;
    const jur = m.plank.jurisdiction as Jurisdiction;
    const aligned = new Set<string>();
    // Source A: legacy curated BillSponsorship.
    for (const b of m.bills) for (const s of b.sponsorships) aligned.add(s.legislatorId);
    // Source B: ingested BillCosponsor rows (uniform Congress.gov coverage).
    for (const b of m.bills) {
      const storageType = MARKER_STORAGE_TYPE_MAP[b.billType];
      if (!storageType) continue;
      const num = stripBillNum(b.billNumber);
      if (!num) continue;
      const billNumStored = jur === 'CA' ? b.billNumber : num;
      const ids = cosponsorsByBill.get(`${jur}|${storageType}|${billNumStored}`);
      if (ids) for (const id of ids) aligned.add(id);
    }
    slots.push({ markerId: m.id, plankNumber: m.plank.number, jurisdiction: jur, alignedLegIds: aligned });
  }
  return slots;
}

/** Load the full alignment universe in one shot. */
export async function loadAlignmentUniverse(prisma: PrismaLike): Promise<AlignmentUniverse> {
  const bills = await loadBills(prisma);
  const cosponsorsByBill = await loadCosponsors(prisma);
  const markerSlots = await loadMarkerSlots(prisma, cosponsorsByBill);
  return { bills, cosponsorsByBill, markerSlots };
}

// ─── Per-legislator tally ────────────────────────────────────────────────────

export interface LegForTally {
  id: string;
  jurisdiction: Jurisdiction;
  chamber: LegChamber;
  state: string;
}

export interface PlankTally {
  aligned: number;
  total: number;
}

export interface PlankTalliesResult {
  /** plankNumber → { aligned, total }; only planks with total ≥ 1 are present */
  perPlank: Map<number, PlankTally>;
  /** overall voting tally across all eligible bills/markers (for spot-checks) */
  overall: PlankTally;
}

/**
 * Compute per-plank aligned/total tallies for one legislator against the
 * shared universe. Bill-level dedup is inherent (the universe is already
 * reduced to one entry per (chamber, bill)). Marker slots are cross-chamber.
 * Planks with zero eligible bills are omitted from `perPlank` — the caller
 * decides what "insufficient data" means (we write no RepresentativeScore row).
 */
export function computePlankTallies(leg: LegForTally, universe: AlignmentUniverse): PlankTalliesResult {
  const { bills, cosponsorsByBill, markerSlots } = universe;
  const perPlank = new Map<number, PlankTally>();
  let overallAligned = 0;
  let overallTotal = 0;

  const bump = (plankNum: number, aligned: boolean): void => {
    const cur = perPlank.get(plankNum) ?? { aligned: 0, total: 0 };
    cur.total += 1;
    if (aligned) cur.aligned += 1;
    perPlank.set(plankNum, cur);
  };

  // Non-voting delegates can't cast floor votes — skip the entire roll-call
  // universe for them (they're scored on cosponsorship/markers only below).
  const delegateNoFloorVotes = isNonVotingDelegate(leg);
  for (const bill of bills.values()) {
    if (delegateNoFloorVotes) break;
    if (!billChamberMatchesLeg(bill.chamber, leg.jurisdiction, leg.chamber)) continue;
    const cosponsored =
      cosponsorsByBill.get(`${leg.jurisdiction}|${bill.billType}|${bill.billNumber}`)?.has(leg.id) ?? false;
    const aligned = isLegAlignedOnBill(bill.legsAligned.has(leg.id), cosponsored);
    overallTotal += 1;
    if (aligned) overallAligned += 1;
    for (const plankNum of bill.plankSet) bump(plankNum, aligned);
  }

  for (const slot of markerSlots) {
    if (slot.jurisdiction !== leg.jurisdiction) continue;
    // Refined rule (v0.9): a cosponsorship signal only ever HELPS — NOT
    // cosponsoring a bill is not a failure, so an un-cosponsored marker is
    // excluded from the denominator entirely (it does not drag). A marker is
    // counted only when the legislator actually sponsored/cosponsored one of
    // its bills, in which case it is aligned. (Roll-call bills are handled in
    // the loop above, where a missed/NO vote DOES drag — showing up to vote is
    // mandatory; opting into a cosponsorship is not.)
    if (!slot.alignedLegIds.has(leg.id)) continue;
    overallTotal += 1;
    overallAligned += 1;
    bump(slot.plankNumber, true);
  }

  return { perPlank, overall: { aligned: overallAligned, total: overallTotal } };
}
