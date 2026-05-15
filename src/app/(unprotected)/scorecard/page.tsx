/* eslint-disable @typescript-eslint/no-use-before-define */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  getLegislatorList,
  getFeaturedBills,
  parseJurisdictionParam,
  computePublishedTotal,
  getScoreCalibration,
} from '@/lib/scorecard/queries';
import { rawToPercent, METHODOLOGY_VERSION } from '@/lib/scorecard/scoring';
import { LegislatorAvatar } from '@/components/scorecard/LegislatorAvatar';

export const metadata: Metadata = {
  title: 'Scorecard | Our Power',
  description:
    'Cross-partisan scorecard rating every member of Congress and the California State Legislature against five common-ground commitments.',
};

type SearchParams = {
  jurisdiction?: string;
  state?: string;
  chamber?: string;
  party?: string;
  sort?: string; // 'best' (default) | 'worst'
};

const PARTY_LABEL: Record<string, string> = {
  D: 'Democrat',
  R: 'Republican',
  I: 'Independent',
};

const CHAMBER_LABEL_FEDERAL: Record<string, string> = {
  SEN: 'U.S. Senate',
  REP: 'U.S. House',
};

const CHAMBER_LABEL_STATE: Record<string, string> = {
  SEN: 'State Senate',
  REP: 'State Assembly',
};

function chamberLabel(jurisdiction: 'FEDERAL' | 'CA', chamber: 'SEN' | 'REP'): string {
  return jurisdiction === 'FEDERAL' ? CHAMBER_LABEL_FEDERAL[chamber] : CHAMBER_LABEL_STATE[chamber];
}

export default async function ScorecardIndexPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const jurisdiction = parseJurisdictionParam(searchParams.jurisdiction) ?? 'FEDERAL';
  const chamber = searchParams.chamber === 'SEN' || searchParams.chamber === 'REP' ? searchParams.chamber : undefined;
  const party =
    searchParams.party === 'D' || searchParams.party === 'R' || searchParams.party === 'I'
      ? searchParams.party
      : undefined;
  const state = searchParams.state ? searchParams.state.toUpperCase() : undefined;
  const sortOrder: 'best' | 'worst' = searchParams.sort === 'worst' ? 'worst' : 'best';

  const [legislators, featuredBills, calibrationRow] = await Promise.all([
    getLegislatorList({ jurisdiction, chamber, party, state }),
    getFeaturedBills(jurisdiction),
    getScoreCalibration(METHODOLOGY_VERSION),
  ]);
  // Fallback anchors keep the page rendering on a fresh methodology version
  // before the first compute-scores pass populates ScoreCalibration.
  const calibration = calibrationRow ?? { positiveAnchor: 25, negativeAnchor: -10 };

  const buildHref = (overrides: Partial<SearchParams>): string => {
    const params = new URLSearchParams();
    const merged = { jurisdiction, chamber, party, state, ...overrides };
    Object.entries(merged).forEach(([k, v]) => {
      if (v) params.set(k, String(v));
    });
    const qs = params.toString();
    return qs ? `/scorecard?${qs}` : '/scorecard';
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="border-b-2 border-gray-900 pb-4">
        <p className="font-mono text-xs uppercase tracking-widest text-gray-500">The Scorecard</p>
        <h1 className="mt-1 font-serif text-4xl font-bold text-gray-900">We the People</h1>
        <p className="mt-2 max-w-2xl text-base text-gray-700">
          Every legislator scored against the same {jurisdiction === 'FEDERAL' ? 'five' : 'four'} commitments. Same
          rubric for everyone, every score backed by a public source. Each vote or cosponsorship is +1; each recorded
          vote-against or no-show on a recorded vote is &minus;1.{' '}
          <Link href="/scorecard/methodology" className="underline hover:text-[#8B3A3A]">
            Read the full methodology →
          </Link>
        </p>
      </header>

      <nav className="mt-6 flex flex-wrap items-center gap-2 text-sm">
        <Link
          href={buildHref({ jurisdiction: 'FEDERAL', state: undefined })}
          className={`rounded border px-3 py-1 text-[#F5DEB3] transition-colors ${
            jurisdiction === 'FEDERAL'
              ? 'border-[#8B3A3A] bg-[#2C4A5E]/80 font-semibold'
              : 'border-[#2C4A5E] bg-[#2C4A5E]/60 hover:bg-[#2C4A5E]/80'
          }`}>
          U.S. Congress
        </Link>
        <Link
          href={buildHref({ jurisdiction: 'CA', state: 'CA' })}
          className={`rounded border px-3 py-1 text-[#F5DEB3] transition-colors ${
            jurisdiction === 'CA'
              ? 'border-[#8B3A3A] bg-[#2C4A5E]/80 font-semibold'
              : 'border-[#2C4A5E] bg-[#2C4A5E]/60 hover:bg-[#2C4A5E]/80'
          }`}>
          California
        </Link>
        <Link
          href="/scorecard/methodology"
          className="ml-auto rounded border border-[#2C4A5E] bg-transparent px-3 py-1 text-[#F5DEB3]/80 transition-colors hover:bg-[#2C4A5E]/60 hover:text-[#F5DEB3]">
          Methodology →
        </Link>
      </nav>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <FilterChip label="All chambers" active={!chamber} href={buildHref({ chamber: undefined })} />
        <FilterChip
          label={jurisdiction === 'FEDERAL' ? 'Senate' : 'State Senate'}
          active={chamber === 'SEN'}
          href={buildHref({ chamber: 'SEN' })}
        />
        <FilterChip
          label={jurisdiction === 'FEDERAL' ? 'House' : 'Assembly'}
          active={chamber === 'REP'}
          href={buildHref({ chamber: 'REP' })}
        />
        <span className="ml-2 border-l border-gray-300 pl-2" />
        <FilterChip label="All parties" active={!party} href={buildHref({ party: undefined })} />
        <FilterChip label="D" active={party === 'D'} href={buildHref({ party: 'D' })} />
        <FilterChip label="R" active={party === 'R'} href={buildHref({ party: 'R' })} />
        <FilterChip label="I" active={party === 'I'} href={buildHref({ party: 'I' })} />
      </div>

      <section className="mt-8 rounded border border-[#2C4A5E] bg-[#2C4A5E]/60 p-5">
        <h2 className="font-mono text-xs uppercase tracking-widest text-[#F5DEB3]">Plank 1 — Honest Government</h2>
        <p className="mt-2 text-sm text-[#F5DEB3]">
          Every legislator, ranked by corporate PAC share of campaign receipts.{' '}
          <Link
            href="/scorecard/pac"
            className="font-medium text-[#FFE9B8] underline underline-offset-2 hover:no-underline">
            Open the corporate PAC scorecard →
          </Link>
        </p>
      </section>

      {featuredBills.length > 0 && (
        <section className="mt-8 rounded border-2 border-[#8B3A3A] bg-[#2C4A5E]/60 p-5">
          <h2 className="font-mono text-xs uppercase tracking-widest text-[#F5DEB3]">Featured Issues</h2>
          <ul className="mt-3 space-y-3">
            {featuredBills.map((bill) => {
              const idForUrl = bill.publicSlug ?? bill.id;
              return (
                <li key={bill.id}>
                  <Link href={`/scorecard/bills/${encodeURIComponent(idForUrl)}`} className="block hover:underline">
                    <p className="font-serif text-lg font-semibold text-[#F5DEB3]">{bill.billTitle}</p>
                    <p className="text-xs text-[#F5DEB3]/80">
                      Plank {bill.marker.plank.number}. {bill.marker.plank.name} · {bill.billNumber}
                      {bill.statusNote ? ` · ${bill.statusNote.split('.')[0]}` : ''}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          Showing {legislators.length} {jurisdiction === 'FEDERAL' ? 'federal' : 'California'} legislators.
        </p>
        <div className="inline-flex rounded-md border border-[#2C4A5E] bg-white p-1">
          <Link
            href={buildHref({ sort: undefined })}
            className={
              sortOrder === 'best'
                ? 'rounded bg-[#8B3A3A] px-3 py-1 font-mono text-xs uppercase tracking-wide text-[#F5DEB3]'
                : 'rounded px-3 py-1 font-mono text-xs uppercase tracking-wide text-[#2C4A5E] hover:bg-[#2C4A5E]/60 hover:text-[#F5DEB3]'
            }>
            Best first
          </Link>
          <Link
            href={buildHref({ sort: 'worst' })}
            className={
              sortOrder === 'worst'
                ? 'rounded bg-[#8B3A3A] px-3 py-1 font-mono text-xs uppercase tracking-wide text-[#F5DEB3]'
                : 'rounded px-3 py-1 font-mono text-xs uppercase tracking-wide text-[#2C4A5E] hover:bg-[#2C4A5E]/60 hover:text-[#F5DEB3]'
            }>
            Worst first
          </Link>
        </div>
      </div>

      <ul className="mt-4 divide-y divide-gray-200 border border-gray-200">
        {legislators
          .map((leg) => ({ leg, total: computePublishedTotal(leg.scores) }))
          .sort((a, b) => {
            // Pending (null) totals always fall to the bottom regardless of
            // toggle direction — we want "scored" content first either way.
            const aHas = a.total !== null;
            const bHas = b.total !== null;
            if (aHas !== bHas) return aHas ? -1 : 1;
            if (a.total === null || b.total === null) return 0;
            const cmp = sortOrder === 'best' ? b.total - a.total : a.total - b.total;
            if (cmp !== 0) return cmp;
            return a.leg.lastName.localeCompare(b.leg.lastName);
          })
          .map(({ leg, total }) => {
            const idForUrl = leg.bioguideId ?? leg.openStatesId ?? leg.id;
            return (
              <li
                key={leg.id}
                className="group flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[#2C4A5E]/60">
                <Link
                  href={`/scorecard/${encodeURIComponent(idForUrl)}`}
                  className="flex min-w-0 flex-1 items-center gap-3">
                  <LegislatorAvatar fullName={leg.fullName} photoUrl={leg.photoUrl} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="font-serif text-lg font-semibold text-gray-900">{leg.fullName}</p>
                    <p className="text-sm text-gray-600">
                      {PARTY_LABEL[leg.party] ?? leg.party} ·{' '}
                      {chamberLabel(leg.jurisdiction as 'FEDERAL' | 'CA', leg.chamber as 'SEN' | 'REP')}
                      {leg.district != null && leg.chamber === 'REP' ? `, District ${leg.district}` : ''}
                      {' · '}
                      {leg.state}
                    </p>
                  </div>
                </Link>
                <div className="ml-4 shrink-0 text-right">
                  {total === null ? (
                    <span className="font-mono text-xs uppercase tracking-wide text-gray-500">Pending</span>
                  ) : (
                    <>
                      {(() => {
                        // v1.4 display: anchored percent (primary) + raw (secondary).
                        // Calibration anchors are frozen per methodology version
                        // and fall back to {25, -10} before the first compute pass.
                        const percent = Math.round(
                          rawToPercent(total, calibration.positiveAnchor, calibration.negativeAnchor),
                        );
                        const colorClass =
                          percent > 50
                            ? 'text-green-700'
                            : percent > 0
                            ? 'text-green-600'
                            : percent === 0
                            ? 'text-gray-500'
                            : percent > -50
                            ? 'text-red-500'
                            : 'text-red-700';
                        const sign = percent > 0 ? '+' : '';
                        const rawSign = total > 0 ? '+' : '';
                        return (
                          <>
                            <p className={`font-serif text-2xl font-bold tabular-nums ${colorClass}`}>
                              {sign}
                              {percent}%
                            </p>
                            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-gray-500">
                              raw {rawSign}
                              {total}
                            </p>
                          </>
                        );
                      })()}
                      {(() => {
                        // Pull from RepresentativeScore rows (single source of
                        // truth — written atomically with score). Guarantees
                        // total = forCount − againstCount always holds.
                        const scores = (leg.scores ?? []) as Array<{
                          forCount?: number;
                          againstCount?: number;
                        }>;
                        const forCount = scores.reduce((s, x) => s + (x.forCount ?? 0), 0);
                        const againstCount = scores.reduce((s, x) => s + (x.againstCount ?? 0), 0);
                        if (forCount + againstCount === 0) return null;
                        return (
                          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-gray-500">
                            {forCount} for · {againstCount} against
                          </p>
                        );
                      })()}
                    </>
                  )}
                </div>
              </li>
            );
          })}
      </ul>

      {legislators.length === 0 && (
        <p className="mt-8 text-center text-gray-500">No legislators match these filters.</p>
      )}

      <footer className="mt-12 border-t-2 border-gray-900 pt-4 text-xs text-gray-500">
        <p>
          <Link href="/scorecard/methodology" className="underline hover:text-[#8B3A3A]">
            Methodology {METHODOLOGY_VERSION} →
          </Link>{' '}
          Same rubric applies to every legislator regardless of party. Every score traces to a public source.
        </p>
        <p className="mt-1">
          Republican-authored alternatives count as secondary markers under the two-tier methodology adopted 2026-04-29.
        </p>
      </footer>
    </div>
  );
}

function FilterChip({ label, active, href }: { label: string; active: boolean; href: string }) {
  // All chips sit on the navy/60 background with wheat text. Active state
  // is signaled by the brick-red brand border + a slightly darker navy bg.
  return (
    <Link
      href={href}
      className={`rounded border px-2 py-1 text-[#F5DEB3] transition-colors ${
        active
          ? 'border-[#8B3A3A] bg-[#2C4A5E]/80 font-semibold'
          : 'border-[#2C4A5E] bg-[#2C4A5E]/60 hover:bg-[#2C4A5E]/80'
      }`}>
      {label}
    </Link>
  );
}
