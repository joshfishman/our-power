import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getProfile,
  PROFILE_SLUGS,
  splitMoney,
  groupByType,
  mostGenerousTotal,
  fmtBigDollars,
  TYPE_LABEL,
  TYPE_NOTE,
  type MoneyLineItem,
} from '@/lib/scorecard/billionaire-money';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return PROFILE_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug } = await props.params;
  const profile = getProfile(slug);
  if (!profile) return { title: 'Profile not found | Common Ground' };
  return {
    title: `${profile.subject} — public money in, political money out | Common Ground`,
    description: `How much public money has flowed to ${profile.subject}'s companies (contracts, loans, subsidies, credits), shown beside the money spent on politics. Every figure traces to a public source.`,
  };
}

/** Source-confidence badge. A three-step scale, so it reads on the status tokens. */
const CONF_TONE: Record<string, string> = {
  high: 'bg-success text-success-foreground',
  medium: 'bg-warning text-warning-foreground',
  low: 'bg-destructive text-destructive-foreground',
};

function LineItem({ item }: { item: MoneyLineItem }) {
  return (
    <li className="border-t border-border py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-serif text-lg font-bold tabular-nums text-foreground">{item.amount_label}</span>
        <span className="text-[10px] uppercase tracking-wide text-subtle-foreground">
          {item.agency ? `${item.agency} · ` : ''}
          {item.time_period}
          <span className={`ml-2 rounded px-1.5 py-0.5 ${CONF_TONE[item.confidence] ?? ''}`}>{item.confidence}</span>
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
      {item.notes ? <p className="mt-1 text-xs italic text-subtle-foreground">{item.notes}</p> : null}
      <a
        href={item.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-block text-xs text-muted-foreground underline hover:text-foreground">
        source ↗
      </a>
    </li>
  );
}

export default async function BillionaireProfilePage(props: Props) {
  const { slug } = await props.params;
  const profile = getProfile(slug);
  if (!profile) notFound();

  const generous = mostGenerousTotal(profile);
  // A family / multi-person fortune (e.g. the Waltons) reads "these billionaires".
  const pluralSubject = /family|families|brothers|sisters|&|\band\b|,/i.test(profile.subject);
  const { moneyIn, moneyOut } = splitMoney(profile.line_items);
  const inGroups = groupByType(moneyIn);
  const politicalTotal =
    moneyOut.find((m) => /total|aggregate/i.test(m.category)) ??
    moneyOut.slice().sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/scorecard/power" className="text-sm text-muted-foreground hover:text-foreground">
        ← Public money &amp; private fortunes
      </Link>

      <header className="mt-4 border-b-2 border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">
          Power · public money &amp; private fortune
        </p>
        <h1 className="mt-1 font-serif text-3xl font-bold text-foreground">{profile.subject}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The scorecard tracks the money that flows <em>to</em> politicians. This is the other direction: the public
          money that flows to a private fortune. Government money <strong>in</strong> — contracts, loans, subsidies,
          credits — beside the political money spent <strong>out</strong>. Every figure links to a public source, and
          the kinds of money are kept strictly separate, because a contract the government chose to buy is not a
          subsidy.
        </p>
      </header>

      {/* Headline — the number leads; the explanation follows below. */}
      <section className="mt-6 rounded-lg border border-border bg-surface-elevated p-6">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {pluralSubject ? 'Our money to these billionaires' : 'Our money to this billionaire'}
        </p>
        <div className="mt-1 font-serif text-6xl font-bold tabular-nums leading-none text-foreground">
          {generous.label}
        </div>
        <p className="mt-3 text-[11px] uppercase tracking-wide text-subtle-foreground">
          What that number is &amp; how to read it ↓
        </p>
      </section>

      {/* What the number is */}
      <section className="mt-4 rounded-lg border border-border bg-secondary p-5">
        <h2 className="font-serif text-lg font-bold text-foreground">What this number counts</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {generous.amount > (profile.headline.figure ?? 0) ? (
            <>
              <strong>{generous.label}</strong> is the most generous reading: the sum of every money-in line below —
              contracts, loans, subsidies, and credits of all kinds. The most rigorous <em>single sourced</em> figure is{' '}
              <strong>{profile.headline.label}</strong> — {profile.headline.description}
            </>
          ) : (
            <>
              <strong>{generous.label}</strong> — {profile.headline.description}
            </>
          )}
        </p>
        <p className="mt-2 font-mono text-xs text-subtle-foreground">{profile.headline.composition}</p>
        <a
          href={profile.headline.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block font-mono text-xs text-accent underline hover:text-foreground">
          source ↗
        </a>
        <ul className="mt-3 space-y-1 border-t border-border pt-3">
          {profile.headline.caveats.map((c) => (
            <li key={c.slice(0, 32)} className="text-xs text-muted-foreground">
              • {c}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs italic text-subtle-foreground">
          The kinds of money differ — a contract the government chose to buy is not a subsidy, a loan gets repaid, and
          demand-side flows (e.g. SNAP dollars spent at a store) aren&apos;t a check written to the company. Each is
          broken out below so you can judge it yourself.
        </p>
      </section>

      {/* Money IN */}
      <h2 className="mt-8 font-serif text-2xl font-bold text-foreground">Money in — what the public paid</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Broken out by kind, because they are not the same thing. A contract buys a service; a subsidy is closer to a
        gift; a loan gets repaid.
      </p>
      <div className="mt-4 space-y-4">
        {inGroups.map((g) => {
          const groupTotal = g.items.reduce((s, i) => s + (typeof i.amount === 'number' ? i.amount : 0), 0);
          return (
            <details key={g.type} className="group rounded-lg border border-border p-4">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="font-serif text-lg font-bold text-foreground">{TYPE_LABEL[g.type]}</span>
                  <span className="mt-0.5 block text-xs text-subtle-foreground">{TYPE_NOTE[g.type]}</span>
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="font-serif text-xl font-bold text-foreground">
                    {groupTotal > 0 ? fmtBigDollars(groupTotal) : '—'}
                  </span>
                  <span className="font-mono text-xs text-subtle-foreground transition-transform group-open:rotate-180">
                    ▾
                  </span>
                </span>
              </summary>
              <ul className="mt-3 border-t border-border pt-1">
                {g.items.map((item) => (
                  <LineItem key={item.id} item={item} />
                ))}
              </ul>
            </details>
          );
        })}
      </div>

      {/* Money OUT */}
      {moneyOut.length > 0 ? (
        <>
          <h2 className="mt-10 font-serif text-2xl font-bold text-foreground">
            Money out — what they spend on politics
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The opposite direction — money <em>given</em> to shape elections, never to be added to the money received
            above.
          </p>
          <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-5">
            {politicalTotal ? (
              <div className="font-serif text-4xl font-bold leading-none text-foreground">
                {politicalTotal.amount_label}
              </div>
            ) : null}
            <ul className="mt-3">
              {moneyOut
                .filter((m) => m.id !== politicalTotal?.id)
                .map((item) => (
                  <LineItem key={item.id} item={item} />
                ))}
            </ul>
          </div>
        </>
      ) : null}

      {/* Caveats */}
      <section className="mt-10 rounded-lg border border-border bg-secondary p-5">
        <h2 className="font-serif text-xl font-bold text-foreground">How to read these numbers</h2>
        <pre className="mt-3 whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted-foreground">
          {profile.caveats}
        </pre>
      </section>

      <footer className="mt-10 border-t-2 border-border pt-4 text-xs text-muted-foreground">
        <p>
          Phase 0 proof-of-concept — hand-curated, fully source-linked. Compiled {profile.compiled} (method{' '}
          {profile.methodology_version}). Figures are gross government dollars directed to the companies, not personal
          income; contracts fund work delivered. We publish this to scrutinize the flow of public money to concentrated
          private wealth — applicable to billionaires of every political stripe, not one party.
        </p>
      </footer>
    </div>
  );
}
