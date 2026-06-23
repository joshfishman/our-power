// Phase 0 — billionaire government-money profile data loader (Musk only).
// Reads the hand-curated, fully source-linked dataset in
// data/musk-government-money.json. Every figure traces to a public source; the
// page renders the source link on each line. See docs/ideas/billionaire-subsidy-tracker.md.
//
// Cross-partisan civic framing: this scrutinizes the flow of PUBLIC money to a
// private fortune — government money IN (contracts, loans, subsidies, credits)
// shown beside political money OUT — with the critical distinctions (contract vs
// subsidy vs loan vs profit) stated plainly so no number is misread.

import muskData from './musk-government-money.json';
import bezosData from './bezos-government-money.json';
import thielData from './thiel-government-money.json';
import waltonData from './walton-government-money.json';

export type MoneyType =
  | 'FEDERAL_CONTRACT'
  | 'FEDERAL_GRANT'
  | 'FEDERAL_LOAN'
  | 'TAX_CREDIT_SUBSIDY'
  | 'STATE_LOCAL_SUBSIDY'
  | 'REGULATORY_CREDIT'
  | 'POLITICAL_SPENDING';

export interface MoneyLineItem {
  id: string;
  category: string;
  company: string;
  amount: number | null;
  amount_label: string;
  time_period: string;
  description: string;
  type: MoneyType;
  agency?: string;
  source_url: string;
  corroborating_url?: string;
  value_basis?: string;
  confidence: 'high' | 'medium' | 'low';
  is_estimate?: boolean;
  notes?: string;
}

export interface BillionaireMoneyProfile {
  subject: string;
  compiled: string;
  methodology_version: string;
  currency: string;
  headline: {
    figure: number;
    label: string;
    is_floor: boolean;
    description: string;
    composition: string;
    time_period: string;
    source_url: string;
    corroborating_url?: string;
    caveats: string[];
  };
  line_items: MoneyLineItem[];
  caveats: string;
}

const MONEY_IN_TYPES: MoneyType[] = [
  'FEDERAL_CONTRACT',
  'FEDERAL_GRANT',
  'FEDERAL_LOAN',
  'TAX_CREDIT_SUBSIDY',
  'STATE_LOCAL_SUBSIDY',
  'REGULATORY_CREDIT',
];

export const TYPE_LABEL: Record<MoneyType, string> = {
  FEDERAL_CONTRACT: 'Federal contracts',
  FEDERAL_GRANT: 'Federal grants',
  FEDERAL_LOAN: 'Federal loans',
  TAX_CREDIT_SUBSIDY: 'Tax credits',
  STATE_LOCAL_SUBSIDY: 'State & local subsidies',
  REGULATORY_CREDIT: 'Regulatory credits',
  POLITICAL_SPENDING: 'Political spending (money out)',
};

/** One-line explainer per money type so readers don't conflate them. */
export const TYPE_NOTE: Record<MoneyType, string> = {
  FEDERAL_CONTRACT:
    'The government buying a service (launches, cargo, a lunar lander) at a negotiated price — most is spent delivering the work.',
  FEDERAL_GRANT: 'Public money awarded for a purpose, not repaid.',
  FEDERAL_LOAN: 'Money that must be repaid. Tesla repaid its DOE loan in full, early — at a profit to taxpayers.',
  TAX_CREDIT_SUBSIDY:
    'A tax break or credit. Some flow to buyers (demand-side), some to the company (supply-side) — labeled per line.',
  STATE_LOCAL_SUBSIDY:
    'State/local cash, tax abatements, or incentives — closer to a gift; the public gets no direct service in return.',
  REGULATORY_CREDIT:
    'NOT a government payment — revenue from other automakers buying compliance credits in a government-created market.',
  POLITICAL_SPENDING:
    'Money Musk GAVE to influence elections — the opposite direction. Never add this to money received.',
};

// Registry of Phase-0 profiles. Each is a hand-curated, source-linked dataset.
// Order = display order on the index. Blurb names the vehicles; `lean` is shown
// to make the cross-partisan selection rule visible (we profile whoever takes
// the most public money, of any party — not one side).
interface ProfileEntry {
  slug: string;
  profile: BillionaireMoneyProfile;
  blurb: string;
  lean: 'left' | 'right' | 'mixed';
}
const PROFILES: ProfileEntry[] = [
  { slug: 'musk', profile: muskData as unknown as BillionaireMoneyProfile, blurb: 'Tesla · SpaceX · X', lean: 'right' },
  {
    slug: 'bezos',
    profile: bezosData as unknown as BillionaireMoneyProfile,
    blurb: 'Amazon · Blue Origin',
    lean: 'mixed',
  },
  {
    slug: 'thiel',
    profile: thielData as unknown as BillionaireMoneyProfile,
    blurb: 'Palantir · Founders Fund',
    lean: 'right',
  },
  {
    slug: 'walton',
    profile: waltonData as unknown as BillionaireMoneyProfile,
    blurb: 'Walmart · Sam’s Club',
    lean: 'right',
  },
];

export const PROFILE_SLUGS = PROFILES.map((p) => p.slug);

export function getProfile(slug: string): BillionaireMoneyProfile | null {
  return PROFILES.find((p) => p.slug === slug)?.profile ?? null;
}

/** Lightweight list for the index page (no need to ship every line item). */
export function listProfiles(): Array<{
  slug: string;
  subject: string;
  blurb: string;
  lean: 'left' | 'right' | 'mixed';
  headlineLabel: string;
}> {
  return PROFILES.map((p) => ({
    slug: p.slug,
    subject: p.profile.subject,
    blurb: p.blurb,
    lean: p.lean,
    headlineLabel: p.profile.headline.label,
  }));
}

/** Split a profile's line items into money-in (received) and money-out (political). */
export function splitMoney(items: MoneyLineItem[]): { moneyIn: MoneyLineItem[]; moneyOut: MoneyLineItem[] } {
  return {
    moneyIn: items.filter((i) => MONEY_IN_TYPES.includes(i.type)),
    moneyOut: items.filter((i) => i.type === 'POLITICAL_SPENDING'),
  };
}

/** Group line items by money type, preserving a sensible display order. */
export function groupByType(items: MoneyLineItem[]): Array<{ type: MoneyType; items: MoneyLineItem[] }> {
  const order: MoneyType[] = [
    'FEDERAL_CONTRACT',
    'FEDERAL_LOAN',
    'STATE_LOCAL_SUBSIDY',
    'TAX_CREDIT_SUBSIDY',
    'REGULATORY_CREDIT',
    'FEDERAL_GRANT',
    'POLITICAL_SPENDING',
  ];
  return order.map((type) => ({ type, items: items.filter((i) => i.type === type) })).filter((g) => g.items.length > 0);
}
