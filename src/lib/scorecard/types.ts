// Domain types for the scorecard system.
//
// These types describe the *seed data shape* — the structured data we ship
// in code that gets loaded into the database via prisma/seed-scorecard.ts.
// Runtime types come from `@/generated/prisma`.

export type Jurisdiction = 'FEDERAL' | 'CA';

export type MarkerType = 'PRIMARY' | 'SECONDARY';

export type BillType =
  | 'SENATE_BILL'
  | 'HOUSE_BILL'
  | 'SENATE_JOINT_RES'
  | 'HOUSE_JOINT_RES'
  | 'SENATE_RES'
  | 'HOUSE_RES'
  | 'SENATE_CONCURRENT_RES'
  | 'HOUSE_CONCURRENT_RES'
  | 'CA_ASSEMBLY_BILL'
  | 'CA_SENATE_BILL'
  | 'CA_ASSEMBLY_RESOLUTION'
  | 'CA_SENATE_RESOLUTION';

export type BillActionType =
  | 'COSPONSOR'
  | 'VOTE_YES'
  | 'VOTE_NO'
  | 'SPONSOR'
  | 'AUTHOR'
  | 'PRINCIPAL_COAUTHOR'
  | 'COAUTHOR';

export interface SeedBill {
  congressNumber: number; // 119 for federal current; CA session encoded as 20252026
  billType: BillType;
  billNumber: string;
  billTitle: string;
  actionType: BillActionType;
  notes?: string;
  isProvisional?: boolean; // Defaults to true; flip to false only after verification
  // Optional pin to the LegiScan bill_id, used when the bill_number alone is
  // ambiguous across sessions (CA bill numbers reset every two-year cycle, so
  // e.g. AB-2200 in 2023-2024 and 2025-2026 are completely different bills).
  // When set, the sync skips findBillByNumber and goes straight to getBillById.
  legiscanBillId?: number;
  // Public-facing fields surfaced on the per-bill issue page (/scorecard/bills/[id])
  publicSlug?: string;
  publicDescription?: string;
  statusNote?: string;
  callToAction?: string;
  isFeatured?: boolean;
}

export interface SeedMarker {
  slug: string;
  name: string;
  markerType: MarkerType;
  description: string;
  methodologyNotes?: string;
  displayOrder?: number;
  isRepublicanAlternative?: boolean;
  // Slug of the marker this Republican alternative parallels.
  // Required when isRepublicanAlternative is true.
  parallelMarkerSlug?: string;
  bills: SeedBill[];
}

export interface SeedPlank {
  jurisdiction: Jurisdiction;
  slug: string;
  number: number;
  name: string;
  shortDescription: string;
  tagline: string;
  body: string;
  color: string;
  markers: SeedMarker[];
}
