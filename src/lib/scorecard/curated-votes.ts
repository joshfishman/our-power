// v2.0 — the human-curated set of substantive, directly-plank-serving FLOOR
// votes the Voting Record is scored on. Single source of truth, imported by
// both the compute script (scripts/compute-scores-v2.ts) and the read-time
// bill-breakdown (queries.ts getLegislatorBillBreakdown) so the displayed bills
// always match the scored basis.
//
// Multi-Congress by design (not 119th-only): landmark people-serving votes are
// scored across members' actual tenure (117th–119th), so a legislator who voted
// for IIJA/CHIPS/IRA/PACT gets credit even if they never cosponsored. Each
// entry is keyed by (congress, billType, billNumber).
//
// Each entry's plank + people-serving `aligned` direction is HUMAN-set and
// web-verified (party-split + bill-text check) — the DB's auto-classified
// alignedPosition is intentionally ignored for these.
//
// Curation log (rejected and why):
//  • HR5184 "Affordable HOMES", HR6703 "Lower Health Care Premiums" (119) —
//    deceptively-named GOP bills Democrats voted against (party-split flipped them).
//  • HR498 "Do No Harm in Medicaid" (119) — culture-war (bars Medicaid for
//    minors' gender care); a cross-partisan civic scorecard must not take a side.
//  • HJRES72 (119) — terminates the Feb-2025 *tariff* emergency on Canada, not a
//    war-powers vote; off-theme for Plank 5.
//  • PRO Act, vouchers/charters — excluded by locked project decisions.
//
// Planks 1 (Honest Government) and 5 (Peace) still have no clean landmark FLOOR
// votes even across Congresses — they remain markers-led (cosponsorship), which
// is honest: those agendas rarely reach a recorded floor vote.

export interface CuratedVoteBill {
  congress: number;
  plank: number;
  billType: string;
  billNumber: string;
  aligned: 'YES' | 'NO';
  label: string;
}

export const CURATED_VOTE_BILLS: CuratedVoteBill[] = [
  // ── 117th Congress landmarks (the bills people know) ──
  {
    congress: 117,
    plank: 2,
    billType: 'HR',
    billNumber: '3684',
    aligned: 'YES',
    label: 'Infrastructure Investment and Jobs Act (IIJA)',
  },
  { congress: 117, plank: 2, billType: 'HR', billNumber: '4346', aligned: 'YES', label: 'CHIPS and Science Act' },
  {
    congress: 117,
    plank: 2,
    billType: 'HR',
    billNumber: '5376',
    aligned: 'YES',
    label: 'Inflation Reduction Act (climate / clean-energy investment)',
  },
  {
    congress: 117,
    plank: 4,
    billType: 'HR',
    billNumber: '5376',
    aligned: 'YES',
    label: 'Inflation Reduction Act (Medicare drug-price negotiation)',
  },
  {
    congress: 117,
    plank: 4,
    billType: 'S',
    billNumber: '3373',
    aligned: 'YES',
    label: 'Honoring our PACT Act (veterans toxic-exposure care)',
  },

  // ── 119th Congress ──
  {
    congress: 119,
    plank: 2,
    billType: 'HR',
    billNumber: '4758',
    aligned: 'NO',
    label: 'Homeowner Energy Freedom Act (repeal IRA clean-energy rebates)',
  },
  {
    congress: 119,
    plank: 3,
    billType: 'HR',
    billNumber: '2550',
    aligned: 'YES',
    label: "Protect America's Workforce Act (restore federal collective bargaining)",
  },
  {
    congress: 119,
    plank: 3,
    billType: 'HR',
    billNumber: '6644',
    aligned: 'YES',
    label: '21st Century ROAD to Housing Act',
  },
  {
    congress: 119,
    plank: 4,
    billType: 'HR',
    billNumber: '1',
    aligned: 'NO',
    label: 'Reconciliation (deep Medicaid cuts; omnibus)',
  },
  {
    congress: 119,
    plank: 4,
    billType: 'HR',
    billNumber: '2483',
    aligned: 'YES',
    label: 'SUPPORT for Patients & Communities Reauth (opioids)',
  },
  {
    congress: 119,
    plank: 4,
    billType: 'HR',
    billNumber: '2493',
    aligned: 'YES',
    label: 'Improving Care in Rural America Reauth',
  },
];

/** True if (congress, billType, billNumber) is one of the curated vote-bills. */
export function isCuratedVoteBill(congress: number, billType: string, billNumber: string): boolean {
  return CURATED_VOTE_BILLS.some(
    (b) => b.congress === congress && b.billType === billType && b.billNumber === billNumber,
  );
}

/** Curated people-serving direction for a (congress, billType, billNumber), or null. */
export function curatedDirection(congress: number, billType: string, billNumber: string): 'YES' | 'NO' | null {
  return (
    CURATED_VOTE_BILLS.find((b) => b.congress === congress && b.billType === billType && b.billNumber === billNumber)
      ?.aligned ?? null
  );
}
