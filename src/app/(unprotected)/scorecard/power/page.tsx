import type { Metadata } from 'next';
import Link from 'next/link';
import { listProfiles } from '@/lib/scorecard/billionaire-money';

export const metadata: Metadata = {
  title: 'Power — public money & private fortunes | Common Ground',
  description:
    'The scorecard tracks money flowing to politicians. This is the other direction: how much public money — contracts, loans, subsidies, tax breaks — flows to a handful of private fortunes, shown beside the politics they fund. Every figure traces to a public source.',
};

const LEAN_LABEL: Record<string, string> = { left: 'leans left', right: 'leans right', mixed: 'mixed' };

export default function PowerIndexPage() {
  const profiles = listProfiles();
  return (
    <div className="mx-auto max-w-site px-4 py-8">
      <Link href="/scorecard" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to scorecard
      </Link>

      <header className="mt-4 border-b-2 border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">Power</p>
        <h1 className="mt-1 font-serif text-3xl font-bold text-foreground">Public money, private fortunes</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The scorecard follows the money that flows <em>to</em> politicians. This follows the other direction: the
          public money — federal contracts, loans, subsidies, tax breaks — that flows to a handful of the largest
          private fortunes, shown beside the politics those fortunes fund. Every figure links to a public source, and
          the kinds of money are kept strictly separate. We profile whoever takes the most public money, of{' '}
          <strong>any</strong> party — not one side.
        </p>
      </header>

      <ul className="mt-6 divide-y divide-border rounded border border-border">
        {profiles.map((p) => (
          <li key={p.slug}>
            <Link
              href={`/scorecard/power/${p.slug}`}
              className="flex flex-col gap-1 px-4 py-4 hover:bg-surface-elevated sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
              <span>
                <span className="font-serif text-lg font-bold text-foreground">{p.subject}</span>
                <span className="ml-2 font-mono text-xs text-subtle-foreground">{p.blurb}</span>
              </span>
              <span className="font-mono text-xs text-subtle-foreground">
                {p.headlineLabel} · {LEAN_LABEL[p.lean]}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-xs text-muted-foreground">
        Phase 0 — a small, hand-curated set of proof-of-concept profiles, each fully source-linked. The method works for
        founder- and family-controlled empires that live on government contracts and subsidies; it deliberately does not
        force in pure financiers whose fortunes aren&apos;t built on public money.
      </p>
    </div>
  );
}
