/* eslint-disable @typescript-eslint/no-use-before-define */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getPlankBySlug,
  getPlankScoresByLegislator,
  parseJurisdictionParam,
  VOTING_RECORD_PUBLISHED,
  type PlankLegislatorScoreRow,
} from '@/lib/scorecard/queries';
import { getArticlesForPlank } from '@/lib/scorecard/articles';
import { METHODOLOGY_VERSION } from '@/lib/scorecard/scoring';
import { LegislatorAvatar } from '@/components/scorecard/LegislatorAvatar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
};

type SearchParams = {
  jurisdiction?: string;
  chamber?: string;
  party?: string;
  state?: string;
  sort?: string;
};

const PARTY_LABEL: Record<string, string> = {
  D: 'Democrat',
  R: 'Republican',
  I: 'Independent',
};

const CHAMBER_LABEL_FEDERAL: Record<string, string> = { SEN: 'U.S. Senate', REP: 'U.S. House' };
const CHAMBER_LABEL_STATE: Record<string, string> = { SEN: 'State Senate', REP: 'State Assembly' };

function chamberLabel(jurisdiction: 'FEDERAL' | 'CA', chamber: string): string {
  const map = jurisdiction === 'FEDERAL' ? CHAMBER_LABEL_FEDERAL : CHAMBER_LABEL_STATE;
  return map[chamber] ?? chamber;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const plank = await getPlankBySlug('FEDERAL', decodeURIComponent(params.slug));
  if (!plank) return { title: 'Issue not found | Scorecard' };
  return {
    title: `${plank.name} | Issue Scorecard`,
    description: `How every legislator scores on ${plank.name}. ${plank.shortDescription}`,
  };
}

export default async function IssueScorecardPage(props: Props) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const slug = decodeURIComponent(params.slug);

  const jurisdiction = parseJurisdictionParam(searchParams.jurisdiction) ?? 'FEDERAL';
  const chamber = searchParams.chamber === 'SEN' || searchParams.chamber === 'REP' ? searchParams.chamber : undefined;
  const party =
    searchParams.party === 'D' || searchParams.party === 'R' || searchParams.party === 'I'
      ? searchParams.party
      : undefined;
  const state = searchParams.state ? searchParams.state.toUpperCase() : undefined;
  const sortOrder: 'best' | 'worst' = searchParams.sort === 'worst' ? 'worst' : 'best';

  // The plank for the selected jurisdiction. Plank slugs are shared across
  // jurisdictions (CA reuses planks 1-4). If the slug exists federally but not
  // for the requested jurisdiction (e.g. plank 5 under CA), we fall back to the
  // federal plank record for headers and show an empty list for CA.
  const plank = (await getPlankBySlug(jurisdiction, slug)) ?? (await getPlankBySlug('FEDERAL', slug));
  if (!plank) notFound();

  // Only query scores when this plank actually exists for the active
  // jurisdiction (avoids querying a federal-only plank under CA).
  const plankForJurisdiction = plank.jurisdiction === jurisdiction ? plank : null;
  const rows = plankForJurisdiction
    ? await getPlankScoresByLegislator(jurisdiction, plankForJurisdiction.id, { chamber, party, state })
    : [];

  const articles = getArticlesForPlank(plank.slug);

  const ranked = [...rows].sort((a, b) => {
    const aHas = a.score !== null;
    const bHas = b.score !== null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (a.score === null || b.score === null) return 0;
    const cmp = sortOrder === 'best' ? b.score - a.score : a.score - b.score;
    if (cmp !== 0) return cmp;
    return a.fullName.localeCompare(b.fullName);
  });
  const scoredCount = rows.filter((r) => r.score !== null).length;

  const buildHref = (overrides: Partial<SearchParams>): string => {
    const params = new URLSearchParams();
    const merged: SearchParams = { jurisdiction, chamber, party, state, sort: sortOrder, ...overrides };
    // Drop defaults so URLs stay clean.
    if (merged.jurisdiction === 'FEDERAL') delete merged.jurisdiction;
    if (merged.sort === 'best') delete merged.sort;
    Object.entries(merged).forEach(([k, v]) => {
      if (v) params.set(k, String(v));
    });
    const qs = params.toString();
    return qs ? `/scorecard/issues/${encodeURIComponent(slug)}?${qs}` : `/scorecard/issues/${encodeURIComponent(slug)}`;
  };

  return (
    <div className="mx-auto max-w-site px-4 py-8">
      <Link href="/scorecard/issues" className="text-sm text-muted-foreground hover:text-foreground">
        ← All issues
      </Link>

      <header className="mt-4 border-b-2 border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">
          Plank {plank.number} — Issue Scorecard
        </p>
        <h1 className="mt-1 font-serif text-4xl font-bold text-foreground">{plank.name}</h1>
        <p className="mt-2 max-w-2xl italic text-muted-foreground">{plank.tagline}</p>
        {/* The plank's commitments, matching the People's Platform index.
            This used to render shortDescription (byte-identical to the tagline
            on planks 1 and 5 — the same line twice), then `body`, whose prose
            packs six or seven separate promises into one run-on paragraph.
            Same content, but a numbered list is what makes it readable. */}
        {plank.commitments.length > 0 && (
          <ol className="mt-4 max-w-2xl list-decimal space-y-1.5 pl-5 text-base text-muted-foreground marker:text-subtle-foreground">
            {plank.commitments.map((commitment) => (
              <li key={commitment}>{commitment}</li>
            ))}
          </ol>
        )}
      </header>

      <nav className="mt-6 flex flex-wrap items-center gap-2 text-sm">
        <FilterLink
          label="U.S. Congress"
          active={jurisdiction === 'FEDERAL'}
          href={buildHref({ jurisdiction: 'FEDERAL', state: undefined })}
        />
        <FilterLink
          label="California"
          active={jurisdiction === 'CA'}
          href={buildHref({ jurisdiction: 'CA', state: 'CA' })}
        />
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

      {articles.length > 0 && (
        <section className="mt-8 rounded border border-2 border-accent bg-surface p-5 shadow-sm">
          <h2 className="font-mono text-xs uppercase tracking-widest text-foreground">Reading on this issue</h2>
          <ul className="mt-3 space-y-3">
            {articles.map((article) => (
              <li key={article.slug}>
                <Link
                  href={`/scorecard/articles/${encodeURIComponent(article.slug)}`}
                  className="block hover:underline">
                  <p className="font-serif text-lg font-semibold text-foreground">{article.title}</p>
                  <p className="text-sm text-muted-foreground">{article.dek}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {VOTING_RECORD_PUBLISHED ? (
            <>
              {scoredCount} of {rows.length} {jurisdiction === 'FEDERAL' ? 'federal' : 'California'} legislators scored
              on this plank.
            </>
          ) : (
            <>
              {rows.length} {jurisdiction === 'FEDERAL' ? 'federal' : 'California'} legislators tracked on this plank.
              Per-legislator voting alignment is under revision and temporarily unpublished.
            </>
          )}
        </p>
        {/* Best/worst sort is keyed on the voting alignment %, which is hidden
            while the Voting Record is held — so the controls only appear once
            VOTING_RECORD_PUBLISHED is flipped back on. */}
        {VOTING_RECORD_PUBLISHED && (
          <div className="inline-flex rounded-md border border-border bg-surface p-1">
            <Link
              href={buildHref({ sort: undefined })}
              className={
                sortOrder === 'best'
                  ? 'rounded bg-accent px-3 py-1 font-mono text-xs uppercase tracking-wide text-accent-foreground'
                  : 'rounded border border-border px-3 py-1 font-mono text-xs uppercase tracking-wide text-foreground shadow-sm hover:bg-surface-elevated'
              }>
              Best first
            </Link>
            <Link
              href={buildHref({ sort: 'worst' })}
              className={
                sortOrder === 'worst'
                  ? 'rounded bg-accent px-3 py-1 font-mono text-xs uppercase tracking-wide text-accent-foreground'
                  : 'rounded border border-border px-3 py-1 font-mono text-xs uppercase tracking-wide text-foreground shadow-sm hover:bg-surface-elevated'
              }>
              Worst first
            </Link>
          </div>
        )}
      </div>

      {ranked.length === 0 ? (
        <div className="mt-6 rounded border border-2 border-dashed border-border bg-surface px-6 py-12 text-center shadow-sm">
          <p className="font-serif text-xl font-bold text-foreground">No scores to show yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {jurisdiction === 'CA' && plank.number === 5
              ? 'Plank 5 — Peace and Strength — applies to Congress only. Switch to U.S. Congress above.'
              : 'No legislators match these filters, or scoring is still pending for this plank.'}
          </p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border border border-border">
          {ranked.map((row) => (
            <LegislatorRow key={row.id} row={row} jurisdiction={jurisdiction} />
          ))}
        </ul>
      )}

      <footer className="mt-12 border-t-2 border-border pt-4 text-xs text-subtle-foreground">
        <p>
          <Link href="/scorecard/methodology" className="underline hover:text-accent">
            Methodology {METHODOLOGY_VERSION} →
          </Link>{' '}
          Per-plank score is the legislator&rsquo;s alignment across every bill relevant to this plank.{' '}
          <Link href="/scorecard" className="underline">
            Full scorecard →
          </Link>
        </p>
      </footer>
    </div>
  );
}

function LegislatorRow({ row, jurisdiction }: { row: PlankLegislatorScoreRow; jurisdiction: 'FEDERAL' | 'CA' }) {
  const idForUrl = row.bioguideId ?? row.openStatesId ?? row.id;
  return (
    <li className="group flex items-center justify-between gap-3 border border-border px-4 py-3 shadow-sm transition-colors hover:bg-surface-elevated">
      <Link href={`/scorecard/${encodeURIComponent(idForUrl)}`} className="flex min-w-0 flex-1 items-center gap-3">
        <LegislatorAvatar fullName={row.fullName} photoUrl={row.photoUrl} size={44} />
        <div className="min-w-0 flex-1">
          <p className="font-serif text-lg font-semibold text-foreground">{row.fullName}</p>
          <p className="text-sm text-muted-foreground">
            {PARTY_LABEL[row.party] ?? row.party} · {chamberLabel(jurisdiction, row.chamber)}
            {row.district != null && row.chamber === 'REP' ? `, District ${row.district}` : ''}
            {' · '}
            {row.state}
          </p>
        </div>
      </Link>
      <div className="ml-4 flex shrink-0 items-center gap-3 text-right">
        <ScoreCell label="This plank" value={row.score} large underRevision={!VOTING_RECORD_PUBLISHED} />
      </div>
    </li>
  );
}

function colorClassFor(percent: number): string {
  if (percent >= 80) return 'text-score-7';
  if (percent >= 70) return 'text-score-6';
  if (percent >= 60) return 'text-score-5';
  if (percent >= 50) return 'text-score-4';
  if (percent >= 40) return 'text-score-3';
  if (percent >= 30) return 'text-score-2';
  return 'text-score-1';
}

function ScoreCell({
  label,
  value,
  large = false,
  underRevision = false,
}: {
  label: string;
  value: number | null;
  large?: boolean;
  // When true, render a muted "Under revision" label instead of the plank
  // alignment % — used while VOTING_RECORD_PUBLISHED is held.
  underRevision?: boolean;
}) {
  const sizeClass = large ? 'text-3xl' : 'text-xl';
  return (
    <div className="w-24">
      <p className="font-mono text-[9px] uppercase tracking-wide text-subtle-foreground">{label}</p>
      {underRevision ? (
        <p className="font-mono text-[10px] italic leading-tight text-subtle-foreground">Under revision</p>
      ) : value === null ? (
        <p className={`font-serif font-bold tabular-nums text-subtle-foreground ${sizeClass}`}>—</p>
      ) : (
        <p className={`font-serif font-bold tabular-nums ${colorClassFor(value)} ${sizeClass}`}>{value}%</p>
      )}
    </div>
  );
}

function FilterLink({ label, active, href }: { label: string; active: boolean; href: string }) {
  return (
    <Link
      href={href}
      className={`rounded border px-3 py-1 text-foreground transition-colors ${
        active
          ? 'border-accent bg-secondary font-semibold'
          : 'border border-border bg-surface shadow-sm hover:bg-secondary-accent'
      }`}>
      {label}
    </Link>
  );
}

function FilterChip({ label, active, href }: { label: string; active: boolean; href: string }) {
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
