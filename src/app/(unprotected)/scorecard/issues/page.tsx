/* eslint-disable @typescript-eslint/no-use-before-define */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getPublicPlanks } from '@/lib/scorecard/queries';
import { getArticlesForPlank } from '@/lib/scorecard/articles';
import { METHODOLOGY_VERSION } from '@/lib/scorecard/scoring';

export const metadata: Metadata = {
  title: 'Issue Scorecards | We the People Scorecard',
  description:
    'How every member of Congress and the California State Legislature scores on each of the five common-ground commitments — one issue at a time.',
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function IssuesIndexPage() {
  // Federal planks are the canonical issue set (1-5). CA shares planks 1-4
  // (plank 5 does not apply). We list the federal planks as the issue index;
  // each issue page handles the per-jurisdiction split.
  const federalPlanks = (await getPublicPlanks('FEDERAL')).sort((a, b) => a.number - b.number);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="border-b-2 border-border pb-4">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">Issue Scorecards</p>
        <h1 className="mt-1 font-serif text-4xl font-bold text-foreground">The Five Commitments</h1>
        <p className="mt-2 max-w-2xl text-base text-muted-foreground">
          One scorecard per issue. Each page shows how every legislator scores on that single plank — the same rubric
          applied to everyone, every score backed by a public source. California is rated on planks 1&ndash;4; plank 5
          applies to Congress only.
        </p>
      </header>

      <ul className="mt-8 divide-y divide-border border border-border">
        {federalPlanks.map((plank) => {
          const articleCount = getArticlesForPlank(plank.slug).length;
          const href = `/scorecard/issues/${encodeURIComponent(plank.slug)}`;
          // Markers ARE the definition of what a plank includes — they arrive
          // ordered by displayOrder from getPublicPlanks, so this list needs no
          // second, hand-maintained copy that could drift from the rubric.
          const { markers } = plank;
          return (
            <li key={plank.id} className="px-4 py-4 transition-colors hover:bg-surface-elevated">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] uppercase tracking-widest text-subtle-foreground">
                    Plank {plank.number}
                  </p>
                  <Link
                    href={href}
                    className="mt-0.5 block font-serif text-xl font-semibold text-foreground hover:text-accent">
                    {plank.name}
                  </Link>
                  <p className="mt-1 text-sm text-muted-foreground">{plank.shortDescription}</p>
                </div>
                {articleCount > 0 && (
                  <span className="mt-1 shrink-0 rounded border border-border bg-secondary px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-foreground">
                    {articleCount} article{articleCount === 1 ? '' : 's'}
                  </span>
                )}
              </div>

              {markers.length > 0 && (
                <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground marker:text-subtle-foreground">
                  {markers.map((marker) => (
                    // Option-C alternates need no extra tag: every marker with
                    // isRepublicanAlternative already opens with "Republican-led".
                    <li key={marker.id}>{marker.name}</li>
                  ))}
                </ol>
              )}

              <Link
                href={href}
                className="mt-3 inline-block text-sm font-semibold text-accent underline-offset-2 hover:underline">
                See how every legislator scores &rarr;
              </Link>
            </li>
          );
        })}
      </ul>

      <footer className="mt-12 border-t-2 border-border pt-4 text-xs text-subtle-foreground">
        <p>
          <Link href="/scorecard/methodology" className="underline hover:text-accent">
            Methodology {METHODOLOGY_VERSION} →
          </Link>{' '}
          Same rubric applies to every legislator regardless of party. Every score traces to a public source.
        </p>
      </footer>
    </div>
  );
}
