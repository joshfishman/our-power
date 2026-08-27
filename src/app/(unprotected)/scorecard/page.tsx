/* eslint-disable @typescript-eslint/no-use-before-define */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  parseJurisdictionParam,
  computePublishedTotal,
  computeTwoScoreAverage,
  getScorecardBase,
  VOTING_RECORD_PUBLISHED,
} from '@/lib/scorecard/queries';
import { METHODOLOGY_VERSION } from '@/lib/scorecard/scoring';
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

  // v2.0.2 — ONE cached per-jurisdiction fetch (all chambers/parties) + every
  // PAC score, then filter in memory. Previously every chamber/party/state
  // filter change re-ran the heavy PAC-scoring queries (V171 over
  // PacContribution) for the whole chamber — making filtering slow. The PAC
  // split (FEDERAL→V171, CA→legacy) now lives inside getScorecardBase; the
  // result is cached for an hour. See getScorecardBase in queries.ts.
  const {
    legislators: allLegislators,
    featuredBills,
    calibration: calibrationRow,
    pacScores,
  } = await getScorecardBase(jurisdiction);
  void calibrationRow;
  const legislators = allLegislators.filter(
    (l) => (!chamber || l.chamber === chamber) && (!party || l.party === party) && (!state || l.state === state),
  );
  const pacScoresById = new Map<string, number | null>(pacScores);

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
    <div className="mx-auto max-w-site px-4 py-8">
      <header className="border-b-2 border-border pb-4">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">The Scorecard</p>
        <h1 className="mt-1 font-serif text-4xl font-bold text-foreground">Are they for the people?</h1>
        {VOTING_RECORD_PUBLISHED ? (
          <p className="mt-2 max-w-2xl text-base text-muted-foreground">
            Two scores per legislator, each 0&ndash;100%: <strong>PAC</strong> measures freedom from corporate-PAC
            money, <strong>Voting</strong> measures alignment across every plank-relevant bill in this Congress (vote +
            cosponsorship). The <strong>Average</strong> of the two is the headline number. Same rubric for everyone,
            every score backed by a public source.{' '}
            <Link href="/scorecard/methodology" className="underline hover:text-accent">
              Read the full methodology →
            </Link>
          </p>
        ) : (
          <p className="mt-2 max-w-2xl text-base text-muted-foreground">
            The headline is the <strong>PAC Score</strong> (0&ndash;100%): freedom from corporate-PAC money, drawn
            directly from public FEC and Cal-Access filings. The <strong>Voting Record</strong> is being re-verified
            against source roll-call and cosponsorship records and is temporarily unpublished. Same rubric for everyone,
            every published score backed by a public source.{' '}
            <Link href="/scorecard/methodology" className="underline hover:text-accent">
              Read the full methodology →
            </Link>
          </p>
        )}
      </header>

      <nav className="mt-6 flex flex-wrap items-center gap-2 text-sm">
        <Link
          href={buildHref({ jurisdiction: 'FEDERAL', state: undefined })}
          className={`rounded border px-3 py-1 text-foreground transition-colors ${
            jurisdiction === 'FEDERAL'
              ? 'border-accent bg-secondary font-semibold'
              : 'border border-border bg-surface shadow-sm hover:bg-secondary-accent'
          }`}>
          U.S. Congress
        </Link>
        <Link
          href={buildHref({ jurisdiction: 'CA', state: 'CA' })}
          className={`rounded border px-3 py-1 text-foreground transition-colors ${
            jurisdiction === 'CA'
              ? 'border-accent bg-secondary font-semibold'
              : 'border border-border bg-surface shadow-sm hover:bg-secondary-accent'
          }`}>
          California
        </Link>
        <Link
          href="/scorecard/methodology"
          className="ml-auto rounded border border-border bg-transparent px-3 py-1 text-muted-foreground shadow-sm transition-colors hover:bg-surface-elevated hover:text-foreground">
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
        <span className="ml-2 border-l border-border pl-2" />
        <FilterChip label="All parties" active={!party} href={buildHref({ party: undefined })} />
        <FilterChip label="D" active={party === 'D'} href={buildHref({ party: 'D' })} />
        <FilterChip label="R" active={party === 'R'} href={buildHref({ party: 'R' })} />
        <FilterChip label="I" active={party === 'I'} href={buildHref({ party: 'I' })} />
      </div>

      <section className="mt-8 rounded border border-border bg-surface p-5 shadow-sm">
        <h2 className="font-mono text-xs uppercase tracking-widest text-foreground">PAC Score — full ranking</h2>
        <p className="mt-2 text-sm text-foreground">
          Every legislator, ranked by corporate-PAC share of campaign receipts.{' '}
          <Link
            href="/scorecard/pac"
            className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
            Open the corporate PAC scorecard →
          </Link>
        </p>
      </section>

      {featuredBills.length > 0 && (
        <section className="mt-8 rounded border border-2 border-accent bg-surface p-5 shadow-sm">
          <h2 className="font-mono text-xs uppercase tracking-widest text-foreground">Featured Issues</h2>
          <ul className="mt-3 space-y-3">
            {featuredBills.map((bill) => {
              const idForUrl = bill.publicSlug ?? bill.id;
              return (
                <li key={bill.id}>
                  <Link href={`/scorecard/bills/${encodeURIComponent(idForUrl)}`} className="block hover:underline">
                    <p className="font-serif text-lg font-semibold text-foreground">{bill.billTitle}</p>
                    <p className="text-xs text-muted-foreground">
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
        <p className="text-sm text-muted-foreground">
          Showing {legislators.length} {jurisdiction === 'FEDERAL' ? 'federal' : 'California'} legislators.
        </p>
        <div className="inline-flex rounded-md border border-border bg-surface p-1">
          <Link
            href={buildHref({ sort: undefined })}
            className={
              sortOrder === 'best'
                ? 'rounded bg-accent px-3 py-1 font-mono text-xs uppercase tracking-wide text-accent-foreground'
                : 'rounded border border-border px-3 py-1 font-mono text-xs uppercase tracking-wide text-foreground shadow-sm hover:bg-surface-elevated hover:text-foreground'
            }>
            Best first
          </Link>
          <Link
            href={buildHref({ sort: 'worst' })}
            className={
              sortOrder === 'worst'
                ? 'rounded bg-accent px-3 py-1 font-mono text-xs uppercase tracking-wide text-accent-foreground'
                : 'rounded border border-border px-3 py-1 font-mono text-xs uppercase tracking-wide text-foreground shadow-sm hover:bg-surface-elevated hover:text-foreground'
            }>
            Worst first
          </Link>
        </div>
      </div>

      <ul className="mt-4 divide-y divide-border border border-border">
        {legislators
          .map((leg) => {
            // v1.7 — two-score model. Voting Record is the mean of per-plank
            // v1.7 alignment percentages (already 0-100). PAC Score is the
            // (1 − combined_corp_ratio) × 100 from the legislator's
            // most-recent PacMoneyData row. Average is the simple mean.
            //
            // When the Voting Record is held (VOTING_RECORD_PUBLISHED === false),
            // we do not surface a voting number or a PAC+Voting average — the
            // headline is the PAC Score alone and the ranking sorts on it.
            const pacScore = pacScoresById.get(leg.id) ?? null;
            const votingScore = VOTING_RECORD_PUBLISHED ? computePublishedTotal(leg.scores) : null;
            // The Average — and the rank — require the PAC Score, the headline
            // metric of this list. A legislator with no PAC data yet is
            // "pending": we do NOT fabricate a voting-only average (which would
            // float a no-PAC member to the top), so avg/rank stay null and they
            // sort to the bottom with the other pending rows.
            const avg =
              pacScore === null ? null : VOTING_RECORD_PUBLISHED ? computeTwoScoreAverage(pacScore, votingScore) : null;
            // Value the ranking sorts on: the Average when voting is published,
            // the PAC Score alone while it is held.
            const rankValue = VOTING_RECORD_PUBLISHED ? avg : pacScore;
            return { leg, votingScore, pacScore, avg, rankValue };
          })
          .sort((a, b) => {
            // Pending (null) values always fall to the bottom regardless of
            // toggle direction — we want "scored" content first either way.
            const aHas = a.rankValue !== null;
            const bHas = b.rankValue !== null;
            if (aHas !== bHas) return aHas ? -1 : 1;
            if (a.rankValue === null || b.rankValue === null) return 0;
            const cmp = sortOrder === 'best' ? b.rankValue - a.rankValue : a.rankValue - b.rankValue;
            if (cmp !== 0) return cmp;
            return a.leg.lastName.localeCompare(b.leg.lastName);
          })
          .map(({ leg, votingScore, pacScore, avg }) => {
            const idForUrl = leg.bioguideId ?? leg.openStatesId ?? leg.id;
            return (
              <li
                key={leg.id}
                className="group flex items-center justify-between gap-3 border border-border px-4 py-3 shadow-sm transition-colors hover:bg-surface-elevated">
                <Link
                  href={`/scorecard/${encodeURIComponent(idForUrl)}`}
                  className="flex min-w-0 flex-1 items-center gap-3">
                  <LegislatorAvatar fullName={leg.fullName} photoUrl={leg.photoUrl} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="font-serif text-lg font-semibold text-foreground">{leg.fullName}</p>
                    <p className="text-sm text-muted-foreground">
                      {PARTY_LABEL[leg.party] ?? leg.party} ·{' '}
                      {chamberLabel(leg.jurisdiction as 'FEDERAL' | 'CA', leg.chamber as 'SEN' | 'REP')}
                      {leg.district != null && leg.chamber === 'REP' ? `, District ${leg.district}` : ''}
                      {' · '}
                      {leg.state}
                    </p>
                  </div>
                </Link>
                <div className="ml-4 flex shrink-0 items-center gap-3 text-right">
                  <ScoreCell label="PAC" value={pacScore} large={!VOTING_RECORD_PUBLISHED} />
                  {/* When the Voting Record is held, the Voting + Average columns
                      render a muted "Under revision" label instead of a held
                      number. Flip VOTING_RECORD_PUBLISHED to restore the values. */}
                  <ScoreCell label="Voting" value={votingScore} underRevision={!VOTING_RECORD_PUBLISHED} />
                  {VOTING_RECORD_PUBLISHED && <ScoreCell label="Avg" value={avg} large />}
                </div>
              </li>
            );
          })}
      </ul>

      {legislators.length === 0 && (
        <p className="mt-8 text-center text-subtle-foreground">No legislators match these filters.</p>
      )}

      <footer className="mt-12 border-t-2 border-border pt-4 text-xs text-subtle-foreground">
        <p>
          <Link href="/scorecard/methodology" className="underline hover:text-accent">
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

// v1.7 — color band for a 0-100 score. Steep grading inside the natural
// 30-70% band where most legislators sit; deep colors for the extremes.
function colorClassFor(percent: number): string {
  if (percent >= 80) return 'text-score-7';
  if (percent >= 70) return 'text-score-6';
  if (percent >= 60) return 'text-score-5';
  if (percent >= 50) return 'text-score-4';
  if (percent >= 40) return 'text-score-3';
  if (percent >= 30) return 'text-score-2';
  if (percent >= 20) return 'text-score-1';
  return 'text-score-1';
}

function ScoreCell({
  label,
  value: rawValue,
  large = false,
  underRevision = false,
}: {
  label: string;
  value: number | null;
  large?: boolean;
  // When true, the cell shows a muted "Under revision" label instead of a
  // number — used for the Voting column while VOTING_RECORD_PUBLISHED is held.
  underRevision?: boolean;
}) {
  // v1.8.6 — clamp the displayed score to ≥0 so the index never reads as
  // "Voting −2%" or "Plank 1 −1%". The raw stored RepresentativeScore is
  // unchanged; this only adjusts what the user sees.
  const value = rawValue === null ? null : Math.max(0, rawValue);
  // Each cell is a labeled column: tiny uppercase label on top, big % below.
  // `large` flag makes the Average cell a step bigger so the eye lands on it.
  const sizeClass = large ? 'text-3xl' : 'text-xl';
  if (underRevision) {
    return (
      <div className="w-20">
        <p className="font-mono text-[9px] uppercase tracking-wide text-subtle-foreground">{label}</p>
        <p className="font-mono text-[10px] italic leading-tight text-subtle-foreground">Under revision</p>
      </div>
    );
  }
  if (value === null) {
    return (
      <div className="w-14">
        <p className="font-mono text-[9px] uppercase tracking-wide text-subtle-foreground">{label}</p>
        <p className={`font-serif font-bold tabular-nums text-subtle-foreground ${sizeClass}`}>—</p>
      </div>
    );
  }
  return (
    <div className="w-14">
      <p className="font-mono text-[9px] uppercase tracking-wide text-subtle-foreground">{label}</p>
      <p className={`font-serif font-bold tabular-nums ${colorClassFor(value)} ${sizeClass}`}>{value}%</p>
    </div>
  );
}

function FilterChip({ label, active, href }: { label: string; active: boolean; href: string }) {
  // Chips use semantic tokens so text + surface adapt to the active theme.
  // Active state is signaled by the accent (brick) border + a secondary bg.
  return (
    <Link
      href={href}
      className={`rounded border px-2 py-1 text-foreground transition-colors ${
        active
          ? 'border-accent bg-secondary font-semibold'
          : 'border border-border bg-surface shadow-sm hover:bg-secondary-accent'
      }`}>
      {label}
    </Link>
  );
}
