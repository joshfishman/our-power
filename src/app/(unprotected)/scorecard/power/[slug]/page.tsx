import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getProfile,
  PROFILE_SLUGS,
  partitionMoney,
  groupByType,
  groupTotal,
  transferTotal,
  fmtBigDollars,
  getFederalRevenue,
  federalRevenueTotal,
  revenueFiscalYears,
  USASPENDING_RETRIEVED,
  TYPE_LABEL,
  TYPE_NOTE,
  type MoneyLineItem,
  type FederalRevenueEntity,
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
    description: `What ${profile.subject}'s companies earn from the government in contract revenue, what they are given in subsidies and tax breaks, and what the fortune spends on politics — kept strictly separate. Every figure traces to a public source.`,
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

function MoneyGroup({ group }: { group: { type: MoneyLineItem['type']; items: MoneyLineItem[] } }) {
  const total = groupTotal(group.items);
  return (
    <details className="group rounded-lg border border-border p-4">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="font-serif text-lg font-bold text-foreground">{TYPE_LABEL[group.type]}</span>
          <span className="mt-0.5 block text-xs text-subtle-foreground">{TYPE_NOTE[group.type]}</span>
        </span>
        <span className="flex shrink-0 items-baseline gap-2">
          <span className="font-serif text-xl font-bold text-foreground">
            {total === null ? 'see below' : fmtBigDollars(total)}
          </span>
          <span className="font-mono text-xs text-subtle-foreground transition-transform group-open:rotate-180">▾</span>
        </span>
      </summary>
      <ul className="mt-3 border-t border-border pt-1">
        {group.items.map((item) => (
          <LineItem key={item.id} item={item} />
        ))}
      </ul>
    </details>
  );
}

/** The machine-generated USAspending obligation table — revenue, by fiscal year. */
function FederalRevenueTable({ entities }: { entities: FederalRevenueEntity[] }) {
  const years = revenueFiscalYears(entities);
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-elevated text-left">
            <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-subtle-foreground">Company</th>
            {years.map((y) => (
              <th
                key={y}
                className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wide text-subtle-foreground">
                {y}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wide text-subtle-foreground">
              Since FY2008
            </th>
          </tr>
        </thead>
        <tbody>
          {entities.map((e) => (
            <tr key={e.key} className="border-b border-border last:border-b-0">
              <td className="px-3 py-2 align-top">
                {e.recipientUrl ? (
                  <a
                    href={e.recipientUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground">
                    {e.label}
                  </a>
                ) : (
                  e.label
                )}
              </td>
              {years.map((y) => (
                <td key={y} className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {fmtBigDollars(e.byFiscalYear[y] ?? 0)}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-serif font-bold tabular-nums text-foreground">
                {fmtBigDollars(e.cumulative)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function BillionaireProfilePage(props: Props) {
  const { slug } = await props.params;
  const profile = getProfile(slug);
  if (!profile) notFound();

  const transfers = transferTotal(profile);
  const revenueEntities = getFederalRevenue(slug);
  const revenueSum = federalRevenueTotal(slug);
  // A family / multi-person fortune (e.g. the Waltons) reads "these billionaires".
  const pluralSubject = /family|families|brothers|sisters|&|\band\b|,/i.test(profile.subject);
  const { revenue, transfers: transferItems, political } = partitionMoney(profile.line_items);
  const revenueGroups = groupByType(revenue);
  const transferGroups = groupByType(transferItems);
  const politicalTotal =
    political.find((m) => /total|aggregate/i.test(m.category)) ??
    political.slice().sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0];

  return (
    <div className="mx-auto max-w-site-prose px-4 py-8">
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
          money that flows to a private fortune. We report it in two separate columns and never add them together —
          money <strong>earned</strong> by selling to the government, and money <strong>given</strong> in subsidies, tax
          breaks, and credits — beside the political money spent <strong>out</strong>. Every figure links to a public
          source.
        </p>
      </header>

      {/* Headline — two numbers, deliberately not one. */}
      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface-elevated p-6">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Earned — federal contract revenue</p>
          <div className="mt-1 font-serif text-5xl font-bold tabular-nums leading-none text-foreground">
            {fmtBigDollars(revenueSum)}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Dollars the federal government has obligated on prime contracts since FY2008 — work bought and paid for.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface-elevated p-6">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Given — subsidies, tax breaks &amp; credits
          </p>
          <div className="mt-1 font-serif text-5xl font-bold tabular-nums leading-none text-foreground">
            {transfers.label}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            State and local subsidies, tax credits, grants, loans, and regulatory credits — the public gets no direct
            service in return.
          </p>
        </div>
      </section>

      <p className="mt-3 text-xs italic text-subtle-foreground">
        These two numbers measure different things and must not be added. Buying a rocket launch is not a subsidy; a tax
        abatement is not a purchase; a loan gets repaid. Everything below is broken out so you can judge each on its own
        terms.
      </p>

      {/* What the curated headline figure is */}
      <section className="mt-4 rounded-lg border border-border bg-secondary p-5">
        <h2 className="font-serif text-lg font-bold text-foreground">The single best-sourced figure</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          <strong>{profile.headline.label}</strong> — {profile.headline.description}
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
      </section>

      {/* Revenue */}
      <h2 className="mt-8 font-serif text-2xl font-bold text-foreground">
        Revenue — what the government bought and paid for
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        This is earned money, not a handout: the government wanted a launch, a cloud, a data platform, and paid a
        negotiated price for it. Most of it is spent delivering the work. It belongs on this page because the customer
        is the taxpayer — and because a company this dependent on federal purchasing has an obvious stake in who writes
        the budget.
      </p>

      {revenueEntities.length ? (
        <div className="mt-4">
          <h3 className="font-serif text-lg font-bold text-foreground">Federal prime-contract obligations</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            From the government&apos;s own award database, by federal fiscal year. Retrieved {USASPENDING_RETRIEVED}.
          </p>
          <div className="mt-3">
            <FederalRevenueTable entities={revenueEntities} />
          </div>
          <p className="mt-2 text-xs italic text-subtle-foreground">
            Obligations are dollars legally committed — not a contract&apos;s announced ceiling, and not the revenue a
            company reports to shareholders. This measure undercounts: classified and intelligence work is largely
            absent, subawards are excluded, and anything bought through a reseller is credited to the reseller rather
            than to the vendor.
          </p>
          <a
            href="https://www.usaspending.gov/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-xs text-muted-foreground underline hover:text-foreground">
            USAspending.gov ↗
          </a>
        </div>
      ) : null}

      {revenueGroups.length ? (
        <div className="mt-6 space-y-4">
          {revenueGroups.map((g) => (
            <MoneyGroup key={g.type} group={g} />
          ))}
        </div>
      ) : null}

      {/* Transfers */}
      <h2 className="mt-10 font-serif text-2xl font-bold text-foreground">
        Given — subsidies, tax breaks, credits, and loans
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Public money that bought the public nothing directly. A subsidy is closer to a gift; a tax abatement is revenue
        a state chose not to collect. Broken out by kind, because they are not the same thing.
      </p>
      <p className="mt-2 text-xs italic text-subtle-foreground">
        The headline &ldquo;given&rdquo; figure counts subsidies, tax credits, and grants only. Loans are listed below
        but excluded from it, because a loan is repaid — Tesla repaid its Energy Department loan early, at a profit to
        taxpayers. Regulatory credits are listed and excluded too: that money comes from rival automakers buying
        compliance credits, not from the Treasury.
      </p>
      <div className="mt-4 space-y-4">
        {transferGroups.map((g) => (
          <MoneyGroup key={g.type} group={g} />
        ))}
      </div>

      {/* Money OUT */}
      {political.length > 0 ? (
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
              {political
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
          {pluralSubject ? 'These fortunes are' : 'This fortune is'} profiled because of the scale of public money
          involved, not because of the politics it funds. Hand-curated and fully source-linked; the federal revenue
          table is regenerated from USAspending. Compiled {profile.compiled} (method {profile.methodology_version}).
          Figures are gross dollars directed to the companies, not personal income; contract dollars fund work
          delivered. We publish this to scrutinize the flow of public money to concentrated private wealth — applicable
          to billionaires of every political stripe, not one party.
        </p>
      </footer>
    </div>
  );
}
