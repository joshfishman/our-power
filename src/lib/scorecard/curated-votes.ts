// v2.0 — the human-curated set of substantive, directly-plank-serving FLOOR
// votes the Voting Record is scored on. Single source of truth, imported by
// both the compute script (scripts/compute-scores-v2.ts) and the read-time
// bill-breakdown (queries.ts getLegislatorBillBreakdown) so the displayed bills
// always match the scored basis.
//
// Each entry's plank + people-serving `aligned` direction is HUMAN-set and
// web-verified (party-split + bill-text check) — the DB's auto-classified
// alignedPosition is intentionally ignored for these (it was wrong for several).
//
// Curation log (what was rejected and why):
//  • HR5184 "Affordable HOMES Act", HR6703 "Lower Health Care Premiums" — dropped:
//    deceptively-named GOP bills Democrats voted against (party-split flipped them).
//  • HR498 "Do No Harm in Medicaid" — dropped: culture-war (bars Medicaid for
//    minors' gender care); a cross-partisan civic scorecard must not take a side.
//  • HJRES72 — dropped: terminates the Feb-2025 *tariff* emergency on Canada,
//    not a war-powers vote; off-theme for Plank 5 and a party-line trade proxy.

export interface CuratedVoteBill {
  plank: number;
  billType: string;
  billNumber: string;
  aligned: 'YES' | 'NO';
  label: string;
}

export const CURATED_VOTE_BILLS: CuratedVoteBill[] = [
  {
    plank: 2,
    billType: 'HR',
    billNumber: '4758',
    aligned: 'NO',
    label: 'Homeowner Energy Freedom Act (repeal IRA clean-energy rebates)',
  },
  {
    plank: 3,
    billType: 'HR',
    billNumber: '2550',
    aligned: 'YES',
    label: "Protect America's Workforce Act (restore federal collective bargaining)",
  },
  { plank: 3, billType: 'HR', billNumber: '6644', aligned: 'YES', label: '21st Century ROAD to Housing Act' },
  { plank: 4, billType: 'HR', billNumber: '1', aligned: 'NO', label: 'Reconciliation (deep Medicaid cuts; omnibus)' },
  {
    plank: 4,
    billType: 'HR',
    billNumber: '2483',
    aligned: 'YES',
    label: 'SUPPORT for Patients & Communities Reauth (opioids)',
  },
  { plank: 4, billType: 'HR', billNumber: '2493', aligned: 'YES', label: 'Improving Care in Rural America Reauth' },
];

/** Lookup: curated direction for a (billType, billNumber), or null if not curated. */
export function curatedDirection(billType: string, billNumber: string): 'YES' | 'NO' | null {
  return CURATED_VOTE_BILLS.find((b) => b.billType === billType && b.billNumber === billNumber)?.aligned ?? null;
}
