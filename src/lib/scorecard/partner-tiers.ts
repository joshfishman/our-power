// Common Ground partnership tiers.
//
// Source of truth: the partner-pitch brief, slide 08 ("The Offer") and
// slides 09-10 ("Partner Benefits" / "What we're not asking for").
//
// Framing: "Coordination, not control." Every asset — the pledge, the
// methodology, the kitchen-table kit, the scorecard API — is published
// under open license. Any aligned organization can use any tool without
// permission. The movement is SHARED INFRASTRUCTURE, not a competing
// organization. The five "what we don't ask for" boundaries below are
// the trust mechanism — explicit refusal to claim partner lists, donors,
// brand, mission, or exclusivity is what makes cross-partisan "coordination
// not capture" credible to orgs that have been burned by coalition work.
//
// Schema-side: Organization.cgPartnerTier (enum CgPartnerTier in
// prisma/schema.prisma). The descriptors here drive UI copy on
// /scorecard/partners and any partner-onboarding flows. Treat as authored
// content, not configuration — if the brief changes, update both this
// file and the methodology doc.
//
// IMPORTANT: as of 2026-04-30, no Organization rows are seeded with a
// non-null cgPartnerTier. The brief's anchor-partner roster (slide 12)
// is the OUTREACH TARGET LIST, not a record of confirmed partnerships.
// Don't render partners as "confirmed" anywhere until the user has
// affirmed the conversation actually happened.

export type CgTierKey = 'USER' | 'AFFILIATE' | 'ANCHOR';

export interface CgTierDescriptor {
  key: CgTierKey;
  label: string;
  shortLabel: string;
  /** What the partner gives. */
  give: string;
  /** What the partner gets. */
  get: string;
  /** Public-page positioning. */
  positioning: string;
  /** Specific benefits per the brief's slide 09. */
  benefits: string[];
  /** Order in which tiers display, low-commitment to high. */
  displayOrder: number;
}

/**
 * Boundaries that apply to ALL tiers. Per slide 10 of the brief,
 * "Coordination, not control."
 */
export const CG_PARTNER_BOUNDARIES: ReadonlyArray<{ headline: string; body: string }> = [
  {
    headline: 'Not your list',
    body: 'Your supporters stay yours. We grow our own funnel.',
  },
  {
    headline: 'Not your donors',
    body: "We're not competing for your fundraising base.",
  },
  {
    headline: 'Not your brand',
    body: 'Your identity, your voice, your call.',
  },
  {
    headline: 'Not your mission',
    body: 'Engage with the planks that fit your work. Ignore the rest.',
  },
  {
    headline: 'Not exclusive partnership',
    body: 'Work with everyone you already work with.',
  },
];

export const CG_PARTNER_TIERS: Readonly<Record<CgTierKey, CgTierDescriptor>> = {
  USER: {
    key: 'USER',
    label: 'Users',
    shortLabel: 'User',
    give: 'Nothing. Use any tool, any time.',
    get: 'Open-license access to the scorecard API, kitchen-table kits, action templates, and the methodology.',
    positioning:
      'The default tier. Anyone can pick up our open-license tools without joining the coalition. No commitments expected; no public listing required.',
    benefits: [
      'Open-license access to scorecard API',
      'Kitchen-table conversation kit',
      'Action templates',
      'Public methodology docs',
    ],
    displayOrder: 1,
  },
  AFFILIATE: {
    key: 'AFFILIATE',
    label: 'Affiliates',
    shortLabel: 'Affiliate',
    give: 'Public endorsement. One Promise Day per quarter.',
    get: 'Co-branded materials, advance notice on news cycles, partner directory listing, coordination channel.',
    positioning:
      'Lightweight formal partnership. Org publicly endorses the five planks and shows up for one coordinated Promise Day each quarter. In return, we give them lead time on launches and a seat in the working coordination channel.',
    benefits: [
      'Customizable scorecard slices embeddable on partner sites',
      'Co-branded kitchen-table kit',
      'Refusal-registry inclusion for advocacy work',
      'Coordinated news cycles (quarterly score releases, Promise Days)',
      'Cross-partisan cover — reach audiences your brand cannot alone',
      'Partner directory listing',
    ],
    displayOrder: 2,
  },
  ANCHOR: {
    key: 'ANCHOR',
    label: 'Anchor Partners',
    shortLabel: 'Anchor',
    give: 'Real staff time. Seat on coordinating council.',
    get: 'Strategic input. Custom integrations. Joint campaigns. Deep coordination.',
    positioning:
      'Movement-shaping role. Anchor partners commit named staff and join the coordinating council that sets cycle priorities, methodology revisions, and joint campaign cadence. The coalition is built on these orgs.',
    benefits: [
      'All Affiliate benefits',
      'Strategic input into roadmap and methodology',
      'Custom integrations with the platform',
      'Joint campaigns with shared infrastructure',
      'Deep coordination on news cycles and ballot work',
      'Coordinating-council seat',
    ],
    displayOrder: 3,
  },
};

export function getTierDescriptor(key: CgTierKey | null | undefined): CgTierDescriptor | null {
  if (!key) return null;
  return CG_PARTNER_TIERS[key] ?? null;
}

/**
 * Display-ordered list of tiers (USER → AFFILIATE → ANCHOR), useful when
 * rendering the public partners page or onboarding flow.
 */
export const CG_TIERS_ORDERED: ReadonlyArray<CgTierDescriptor> = (Object.values(CG_PARTNER_TIERS) as CgTierDescriptor[])
  .slice()
  .sort((a, b) => a.displayOrder - b.displayOrder);
