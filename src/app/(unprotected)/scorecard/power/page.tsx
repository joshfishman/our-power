import type { Metadata } from 'next';
import Link from 'next/link';
import { listProfiles } from '@/lib/scorecard/billionaire-money';

export const metadata: Metadata = {
  title: 'Power — public money & private fortunes | Common Ground',
  description:
    'The scorecard tracks money flowing to politicians. This is the other direction: what a handful of private fortunes earn selling to the government, and separately what they are given in subsidies and tax breaks, shown beside the politics they fund. Every figure traces to a public source.',
};

const LEAN_LABEL: Record<string, string> = { left: 'leans left', right: 'leans right', mixed: 'mixed' };

export default function PowerIndexPage() {
  const profiles = listProfiles();
  return (
    <div className="mx-auto max-w-site-prose px-4 py-8">
      <Link href="/scorecard" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to scorecard
      </Link>

      <header className="mt-4 border-b-2 border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">Power</p>
        <h1 className="mt-1 font-serif text-3xl font-bold text-foreground">Public money, private fortunes</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The scorecard follows the money that flows <em>to</em> politicians. This follows the other direction: the
          public money that flows to a handful of the largest private fortunes — the revenue their companies earn
          selling to the government, and separately the subsidies, tax breaks, credits, and loans they are given — shown
          beside the politics those fortunes fund. Every figure links to a public source, and the kinds of money are
          kept strictly separate. We profile whoever takes the most public money, of <strong>any</strong> party — not
          one side.
        </p>
      </header>

      <ul className="mt-6 divide-y divide-border rounded border border-border">
        {profiles.map((p) => (
          <li key={p.slug}>
            <Link href={`/scorecard/power/${p.slug}`} className="block px-4 py-4 hover:bg-surface-elevated">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-serif text-lg font-bold text-foreground">{p.subject}</span>
                <span className="font-mono text-xs text-subtle-foreground">{p.blurb}</span>
                <span className="ml-auto font-mono text-xs text-subtle-foreground">{LEAN_LABEL[p.lean]}</span>
              </span>
              <span className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                <span className="text-xs text-muted-foreground">
                  <span className="font-mono uppercase tracking-wide text-subtle-foreground">Earned </span>
                  <span className="font-serif font-bold tabular-nums text-foreground">{p.revenueLabel}</span>
                  <span className="text-subtle-foreground"> federal contract revenue</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  <span className="font-mono uppercase tracking-wide text-subtle-foreground">Given </span>
                  <span className="font-serif font-bold tabular-nums text-foreground">{p.transferLabel}</span>
                  <span className="text-subtle-foreground"> subsidies &amp; tax breaks</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-muted-foreground">
        The two figures measure different things and are never added together. <strong>Earned</strong> is federal
        prime-contract obligations since FY2008 — the government bought something and paid for it.{' '}
        <strong>Given</strong> is subsidies, tax abatements, credits, grants, and loans, where the public gets no direct
        service in return. Both understate the true totals; each profile explains how.
      </p>

      <p className="mt-6 text-xs text-muted-foreground">
        Phase 0 — a small, hand-curated set of proof-of-concept profiles, each fully source-linked. The method works for
        founder- and family-controlled empires that live on government contracts and subsidies; it deliberately does not
        force in pure financiers whose fortunes aren&apos;t built on public money.
      </p>
    </div>
  );
}
