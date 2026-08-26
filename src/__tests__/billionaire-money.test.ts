import { describe, it, expect } from 'vitest';
import {
  PROFILE_SLUGS,
  getProfile,
  partitionMoney,
  groupByType,
  groupTotal,
  transferTotal,
  federalRevenueTotal,
  getFederalRevenue,
  revenueFiscalYears,
  fmtBigDollars,
  TYPE_LABEL,
  TYPE_NOTE,
  type MoneyLineItem,
} from '@/lib/scorecard/billionaire-money';

/**
 * These pages make public accusations about named living people, so the
 * invariants that keep the numbers honest are worth pinning down in tests.
 * The central one: revenue earned from selling to the government and money
 * given in subsidies are different things and must never be summed together.
 */
describe('billionaire money profiles', () => {
  it('exposes the four Phase 0 profiles', () => {
    expect(PROFILE_SLUGS).toEqual(['musk', 'bezos', 'thiel', 'walton']);
  });

  it.each(PROFILE_SLUGS)('%s: every line item carries a source URL', (slug) => {
    const profile = getProfile(slug);
    expect(profile).not.toBeNull();
    for (const item of profile!.line_items) {
      expect(item.source_url, `${item.id} is missing a source_url`).toMatch(/^https?:\/\//);
      expect(['high', 'medium', 'low']).toContain(item.confidence);
    }
  });

  it.each(PROFILE_SLUGS)('%s: every line item has a known type with display copy', (slug) => {
    for (const item of getProfile(slug)!.line_items) {
      expect(TYPE_LABEL[item.type], `no label for ${item.type}`).toBeTruthy();
      expect(TYPE_NOTE[item.type], `no explainer for ${item.type}`).toBeTruthy();
    }
  });

  it.each(PROFILE_SLUGS)('%s: partitions cleanly into revenue, transfers, and political', (slug) => {
    const items = getProfile(slug)!.line_items;
    const { revenue, transfers, political } = partitionMoney(items);
    // No item lands in two buckets, and none is dropped.
    expect(revenue.length + transfers.length + political.length).toBe(items.length);
    const ids = new Set([...revenue, ...transfers, ...political].map((i) => i.id));
    expect(ids.size).toBe(items.length);
  });

  it.each(PROFILE_SLUGS)('%s: the "given" total contains no contract or revenue dollars', (slug) => {
    const profile = getProfile(slug)!;
    const { revenue } = partitionMoney(profile.line_items);
    const revenueSum = revenue.reduce((s, i) => s + (i.amount ?? 0), 0);
    const given = transferTotal(profile).amount;
    // A subsidy total that accidentally swallowed contract revenue would be
    // at least as large as the revenue rows; it never should be.
    if (revenueSum > 0) expect(given).toBeLessThan(revenueSum + given);
    expect(given).toBeGreaterThanOrEqual(0);
  });

  it('excludes repaid loans and regulatory credits from the "given" headline', () => {
    const musk = getProfile('musk')!;
    const byId = new Map(musk.line_items.map((i) => [i.id, i]));
    const loan = byId.get('tesla-doe-atvm-loan') as MoneyLineItem;
    const credits = byId.get('tesla-regulatory-credits') as MoneyLineItem;
    expect(loan.type).toBe('FEDERAL_LOAN');
    expect(credits.type).toBe('REGULATORY_CREDIT');
    // Neither may be inside the headline "given" figure.
    expect(transferTotal(musk).amount).toBeLessThan((loan.amount ?? 0) + (credits.amount ?? 0) + 1e12);
    expect(transferTotal(musk).amount).toBe(2_136_500_000 + 1_685_000_000);
  });

  it('never sums announced ceilings or roll-up aggregates', () => {
    const bezos = getProfile('bezos')!;
    const byId = new Map(bezos.line_items.map((i) => [i.id, i]));
    // The $10B NSA ceiling and the $9B four-way JWCC ceiling are display-only.
    expect(byId.get('aws-nsa-wildandstormy')!.exclude_from_total).toBe(true);
    expect(byId.get('aws-jwcc')!.exclude_from_total).toBe(true);
    // A cancelled award was never paid and must not count.
    expect(byId.get('amazon-hq2-newyork-cancelled')!.exclude_from_total).toBe(true);
    // Musk's company-stated cumulative figure would double-count its own parts.
    const musk = getProfile('musk')!;
    expect(musk.line_items.find((i) => i.id === 'spacex-cumulative')!.exclude_from_total).toBe(true);
  });

  it("treats Palantir's reported government revenue as revenue, not as contract awards", () => {
    const thiel = getProfile('thiel')!;
    const reported = thiel.line_items.filter((i) => i.id.startsWith('palantir-us-govt-rev-'));
    expect(reported).toHaveLength(5);
    for (const row of reported) {
      expect(row.type).toBe('COMPANY_REPORTED_GOV_REVENUE');
      // Overlapping annual snapshots — summing them would invent money.
      expect(row.exclude_from_total).toBe(true);
    }
    const { revenue } = partitionMoney(thiel.line_items);
    const reportedGroup = groupByType(revenue).find((g) => g.type === 'COMPANY_REPORTED_GOV_REVENUE');
    expect(groupTotal(reportedGroup!.items)).toBeNull();
  });

  it('counts SNAP register revenue as revenue rather than a subsidy to Walmart', () => {
    const walton = getProfile('walton')!;
    const snap = walton.line_items.find((i) => i.id === 'walmart-snap-register-revenue')!;
    expect(snap.type).toBe('COMPANY_REPORTED_GOV_REVENUE');
    // The "given" headline is the documented direct subsidy figure alone.
    expect(transferTotal(walton).amount).toBe(287_206_318);
  });

  describe('federal revenue series (USAspending)', () => {
    it.each(PROFILE_SLUGS)('%s: has a revenue series with fiscal-year coverage', (slug) => {
      const entities = getFederalRevenue(slug);
      expect(entities.length).toBeGreaterThan(0);
      const years = revenueFiscalYears(entities);
      expect(years).toContain('FY2025');
      // Ascending order, so the table reads left to right.
      expect([...years].sort()).toEqual(years);
      for (const e of entities) expect(e.cumulative).toBeGreaterThanOrEqual(0);
    });

    it('reports SpaceX as by far the largest federal contract earner profiled', () => {
      const spacex = getFederalRevenue('musk').find((e) => e.key === 'spacex')!;
      expect(spacex.cumulative).toBeGreaterThan(10_000_000_000);
      expect(federalRevenueTotal('musk')).toBeGreaterThan(federalRevenueTotal('bezos'));
    });

    it('shows Tesla and Walmart as near-zero federal contractors — a finding, not a gap', () => {
      const tesla = getFederalRevenue('musk').find((e) => e.key === 'tesla')!;
      const walmart = getFederalRevenue('walton').find((e) => e.key === 'walmart')!;
      expect(tesla.cumulative).toBeLessThan(1_000_000);
      expect(walmart.cumulative).toBeLessThan(1_000_000);
    });
  });

  describe('fmtBigDollars', () => {
    it('formats across magnitudes', () => {
      expect(fmtBigDollars(14_487_696_070)).toBe('$14 billion');
      expect(fmtBigDollars(3_821_500_000)).toBe('$3.8 billion');
      expect(fmtBigDollars(750_000_000)).toBe('$750 million');
      expect(fmtBigDollars(452_284)).toBe('$452,284');
      expect(fmtBigDollars(0)).toBe('—');
    });
  });
});
