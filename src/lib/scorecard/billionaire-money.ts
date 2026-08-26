// Billionaire government-money profiles — the data loader behind /scorecard/power.
//
// Reads the hand-curated, fully source-linked datasets in
// src/lib/scorecard/*-government-money.json, plus the machine-generated
// federal-revenue series in usaspending-federal-revenue.json (regenerate with
// `npm run scorecard:ingest-usaspending`). Every figure traces to a public
// source; the page renders the source link on each line.
// See docs/ideas/billionaire-subsidy-tracker.md and
// docs/ideas/billionaire-revenue-research.md.
//
// Cross-partisan civic framing: this scrutinizes the flow of PUBLIC money to a
// private fortune. The central discipline of this page is that the kinds of
// money are never blurred into one headline number:
//
//   REVENUE   — the government bought something and paid for it. Most of it is
//               spent delivering the work. Earned, not given.
//   TRANSFERS — subsidies, tax abatements, credits, and loans. Given, not earned.
//   OUT       — money the fortune spends on politics. The opposite direction.
//
// We report the first two as separate totals and never add them together.

import muskData from './musk-government-money.json';
import bezosData from './bezos-government-money.json';
import thielData from './thiel-government-money.json';
import waltonData from './walton-government-money.json';
import usaspendingData from './usaspending-federal-revenue.json';

export type MoneyType =
  | 'FEDERAL_CONTRACT'
  | 'FEDERAL_REVENUE_OBLIGATED'
  | 'COMPANY_REPORTED_GOV_REVENUE'
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
  /**
   * True for rows that would double-count if summed with their siblings —
   * announced ceilings (a spending limit, not money paid), roll-up aggregates
   * whose components are listed separately, and cancelled awards.
   */
  exclude_from_total?: boolean;
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

/** Money the government paid for goods and services — earned, not given. */
const REVENUE_TYPES: MoneyType[] = ['FEDERAL_CONTRACT', 'FEDERAL_REVENUE_OBLIGATED', 'COMPANY_REPORTED_GOV_REVENUE'];

/** Public money transferred without a service bought in return — plus loans, which get repaid. */
const TRANSFER_TYPES: MoneyType[] = [
  'FEDERAL_GRANT',
  'FEDERAL_LOAN',
  'TAX_CREDIT_SUBSIDY',
  'STATE_LOCAL_SUBSIDY',
  'REGULATORY_CREDIT',
];

export const TYPE_LABEL: Record<MoneyType, string> = {
  FEDERAL_CONTRACT: 'Contract awards & announced ceilings',
  FEDERAL_REVENUE_OBLIGATED: 'Federal revenue — dollars actually obligated',
  COMPANY_REPORTED_GOV_REVENUE: 'Government revenue the company itself reports',
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
    'What was announced when a contract was signed. A ceiling is a spending limit the government may never reach — it is not money paid.',
  FEDERAL_REVENUE_OBLIGATED:
    'Dollars the government has legally committed on prime contracts, from its own award database. The closest public measure of revenue actually earned from taxpayers.',
  COMPANY_REPORTED_GOV_REVENUE:
    'Revenue the company reports to shareholders as coming from government customers — its own audited figure, on its own accounting.',
  FEDERAL_GRANT: 'Public money awarded for a purpose, not repaid.',
  FEDERAL_LOAN: 'Money that must be repaid. Tesla repaid its DOE loan in full, early — at a profit to taxpayers.',
  TAX_CREDIT_SUBSIDY:
    'A tax break or credit. Some flow to buyers (demand-side), some to the company (supply-side) — labeled per line.',
  STATE_LOCAL_SUBSIDY:
    'State/local cash, tax abatements, or incentives — closer to a gift; the public gets no direct service in return.',
  REGULATORY_CREDIT:
    'NOT a government payment — revenue from other automakers buying compliance credits in a government-created market.',
  POLITICAL_SPENDING: 'Money GIVEN to influence elections — the opposite direction. Never add this to money received.',
};

// ---------------------------------------------------------------------------
// Federal revenue series (machine-generated from USAspending)
// ---------------------------------------------------------------------------

export interface FederalRevenueEntity {
  key: string;
  profileSlug: string;
  label: string;
  recipientUrl?: string;
  byFiscalYear: Record<string, number>;
  cumulative: number;
}

interface UsaspendingFile {
  source: string;
  retrieved: string;
  fiscal_years: { start: number; end: number };
  entities: FederalRevenueEntity[];
}

const USASPENDING = usaspendingData as unknown as UsaspendingFile;

/** The USAspending API query behind the revenue table, for citation. */
export const USASPENDING_SOURCE_URL = 'https://www.usaspending.gov/';
export const USASPENDING_RETRIEVED = USASPENDING.retrieved;
export const USASPENDING_FY_RANGE = USASPENDING.fiscal_years;

/**
 * Federal prime-contract obligations for the companies behind one profile.
 * Entities with no meaningful federal contracting (Tesla, Walmart) are kept —
 * a near-zero row is a finding, not noise: their public money is subsidies and
 * demand-side programs, not contracts.
 */
export function getFederalRevenue(slug: string): FederalRevenueEntity[] {
  return USASPENDING.entities.filter((e) => e.profileSlug === slug);
}

/** Total federal prime-contract obligations across a profile's companies. */
export function federalRevenueTotal(slug: string): number {
  return getFederalRevenue(slug).reduce((sum, e) => sum + e.cumulative, 0);
}

/** Fiscal-year column headers present in the series, in ascending order. */
export function revenueFiscalYears(entities: FederalRevenueEntity[]): string[] {
  const keys = new Set<string>();
  for (const e of entities) for (const k of Object.keys(e.byFiscalYear)) keys.add(k);
  return [...keys].sort();
}

// ---------------------------------------------------------------------------
// Profile registry
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Partitioning and totals
// ---------------------------------------------------------------------------

/**
 * Split a profile's line items three ways. Revenue and transfers are reported
 * separately and never summed together; political spending flows the other
 * direction entirely.
 */
export function partitionMoney(items: MoneyLineItem[]): {
  revenue: MoneyLineItem[];
  transfers: MoneyLineItem[];
  political: MoneyLineItem[];
} {
  return {
    revenue: items.filter((i) => REVENUE_TYPES.includes(i.type)),
    transfers: items.filter((i) => TRANSFER_TYPES.includes(i.type)),
    political: items.filter((i) => i.type === 'POLITICAL_SPENDING'),
  };
}

/** Format a dollar amount as a punchy $XXB / $XXM headline figure. */
export function fmtBigDollars(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1)} billion`;
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)} million`;
  if (n <= 0) return '—';
  return `$${Math.round(n).toLocaleString()}`;
}

/** A row is summable unless it is a ceiling, a roll-up aggregate, or cancelled. */
function countsTowardTotal(item: MoneyLineItem): boolean {
  if (item.exclude_from_total) return false;
  if (typeof item.amount !== 'number') return false;
  if (/aggregate|cumulative/i.test(item.category)) return false;
  if (/cancelled|ceiling/i.test(item.category)) return false;
  return true;
}

/**
 * The types that actually count toward the "given" headline: money the public
 * handed over and did not get back.
 *
 * Two neighbours are deliberately left out even though they display in the same
 * section. A FEDERAL_LOAN is repaid — Tesla's was repaid early, at a profit to
 * taxpayers — so counting it as a gift would be false. A REGULATORY_CREDIT is
 * not a government payment at all: it is revenue from other automakers buying
 * compliance credits in a market the government created. Folding either into a
 * headline is exactly the blurring this page exists to avoid.
 */
const GIVEN_TYPES: MoneyType[] = ['STATE_LOCAL_SUBSIDY', 'TAX_CREDIT_SUBSIDY', 'FEDERAL_GRANT'];

/**
 * Public money GIVEN rather than earned: state and local subsidies, tax
 * credits, and grants. Deliberately excludes every contract dollar — buying a
 * launch is not a subsidy — so this total can never be inflated by revenue.
 */
export function transferTotal(profile: BillionaireMoneyProfile): { amount: number; label: string } {
  const amount = profile.line_items
    .filter((i) => GIVEN_TYPES.includes(i.type) && countsTowardTotal(i))
    .reduce((sum, i) => sum + (i.amount ?? 0), 0);
  return { amount, label: fmtBigDollars(amount) };
}

/** Group line items by money type, preserving a sensible display order. */
export function groupByType(items: MoneyLineItem[]): Array<{ type: MoneyType; items: MoneyLineItem[] }> {
  const order: MoneyType[] = [
    'COMPANY_REPORTED_GOV_REVENUE',
    'FEDERAL_REVENUE_OBLIGATED',
    'FEDERAL_CONTRACT',
    'STATE_LOCAL_SUBSIDY',
    'TAX_CREDIT_SUBSIDY',
    'REGULATORY_CREDIT',
    'FEDERAL_LOAN',
    'FEDERAL_GRANT',
    'POLITICAL_SPENDING',
  ];
  return order.map((type) => ({ type, items: items.filter((i) => i.type === type) })).filter((g) => g.items.length > 0);
}

/**
 * Sum of a display group, skipping rows that would double-count. Returns null
 * when nothing in the group is summable (e.g. a group of announced ceilings),
 * so the page can say so instead of printing a misleading total.
 */
export function groupTotal(items: MoneyLineItem[]): number | null {
  const summable = items.filter(countsTowardTotal);
  if (!summable.length) return null;
  return summable.reduce((sum, i) => sum + (i.amount ?? 0), 0);
}

/** Lightweight list for the index page (no need to ship every line item). */
export function listProfiles(): Array<{
  slug: string;
  subject: string;
  blurb: string;
  lean: 'left' | 'right' | 'mixed';
  revenueLabel: string;
  transferLabel: string;
}> {
  return PROFILES.map((p) => ({
    slug: p.slug,
    subject: p.profile.subject,
    blurb: p.blurb,
    lean: p.lean,
    revenueLabel: fmtBigDollars(federalRevenueTotal(p.slug)),
    transferLabel: transferTotal(p.profile).label,
  }));
}
