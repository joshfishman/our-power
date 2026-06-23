import type { Metadata } from 'next';
import Link from 'next/link';
import {
  getMuskProfile,
  splitMoney,
  groupByType,
  TYPE_LABEL,
  TYPE_NOTE,
  type MoneyLineItem,
} from '@/lib/scorecard/billionaire-money';

export const metadata: Metadata = {
  title: 'Elon Musk — public money in, political money out | Common Ground',
  description:
    "How much public money has flowed to Elon Musk's companies (contracts, loans, subsidies, credits) — at least $38 billion — shown beside the money he spends on politics. Every figure traces to a public source.",
};

const CONF_TONE: Record<string, string> = {
  high: 'bg-[#2C4A5E]/80 text-[#F5DEB3]',
  medium: 'bg-[#8B3A3A]/40 text-[#F5DEB3]',
  low: 'bg-[#8B3A3A]/70 text-[#F5DEB3]',
};

function LineItem({ item }: { item: MoneyLineItem }) {
  return (
    <li className="border-t border-[#C8B98A]/20 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-serif text-lg font-bold text-foreground">{item.amount_label}</span>
        <span className="font-mono text-[10px] uppercase tracking-wide text-subtle-foreground">
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
        className="mt-1 inline-block font-mono text-xs text-[#F5DEB3] underline decoration-[#C8B98A]/40 hover:decoration-[#F5DEB3]">
        source ↗
      </a>
    </li>
  );
}

export default function MuskPowerPage() {
  const profile = getMuskProfile();
  const { moneyIn, moneyOut } = splitMoney(profile.line_items);
  const inGroups = groupByType(moneyIn);
  const politicalTotal = moneyOut.find((m) => m.id === 'musk-total-2024');

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/scorecard" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to scorecard
      </Link>

      <header className="mt-4 border-b-2 border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">
          Power · public money &amp; private fortune
        </p>
        <h1 className="mt-1 font-serif text-3xl font-bold text-foreground">Elon Musk</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The scorecard tracks the money that flows <em>to</em> politicians. This is the other direction: the public
          money that flows to a private fortune. We show government money <strong>in</strong> — contracts, loans,
          subsidies, credits — beside the political money Musk spends <strong>out</strong>. Every figure links to a
          public source, and we keep the kinds of money strictly separate, because a contract the government chose to
          buy is not a subsidy.
        </p>
      </header>

      {/* Headline */}
      <section className="mt-6 rounded-lg border border-[#C8B98A]/30 bg-[#2C4A5E]/60 p-6">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#F5DEB3]/70">
          Lifetime U.S. government money to Musk&apos;s companies
        </p>
        <div className="mt-1 font-serif text-5xl font-bold leading-none text-[#F5DEB3]">{profile.headline.label}</div>
        <p className="mt-3 text-sm text-[#F5DEB3]/90">{profile.headline.description}</p>
        <p className="mt-2 font-mono text-xs text-[#F5DEB3]/70">{profile.headline.composition}</p>
        <a
          href={profile.headline.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block font-mono text-xs text-[#F5DEB3] underline hover:decoration-[#F5DEB3]">
          Washington Post analysis ↗
        </a>
        <ul className="mt-3 space-y-1 border-t border-[#C8B98A]/20 pt-3">
          {profile.headline.caveats.map((c) => (
            <li key={c.slice(0, 32)} className="text-xs text-[#F5DEB3]/80">
              • {c}
            </li>
          ))}
        </ul>
      </section>

      {/* Money IN, by type */}
      <h2 className="mt-8 font-serif text-2xl font-bold text-foreground">Money in — what the public paid</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Broken out by kind, because they are not the same thing. A contract buys a service; a subsidy is closer to a
        gift; a loan gets repaid.
      </p>
      <div className="mt-4 space-y-6">
        {inGroups.map((g) => (
          <section key={g.type} className="rounded-lg border border-border p-4">
            <h3 className="font-serif text-lg font-bold text-foreground">{TYPE_LABEL[g.type]}</h3>
            <p className="mt-0.5 text-xs text-subtle-foreground">{TYPE_NOTE[g.type]}</p>
            <ul className="mt-2">
              {g.items.map((item) => (
                <LineItem key={item.id} item={item} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* Money OUT */}
      <h2 className="mt-10 font-serif text-2xl font-bold text-foreground">Money out — what he spends on politics</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The opposite direction. This is money Musk <em>gave</em> to shape elections — never to be added to the money
        received above.
      </p>
      {politicalTotal ? (
        <div className="mt-4 rounded-lg border border-[#8B3A3A]/40 bg-[#8B3A3A]/15 p-5">
          <div className="font-serif text-4xl font-bold leading-none text-foreground">
            {politicalTotal.amount_label}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{politicalTotal.description}</p>
          <ul className="mt-3">
            {moneyOut
              .filter((m) => m.id !== 'musk-total-2024')
              .map((item) => (
                <LineItem key={item.id} item={item} />
              ))}
          </ul>
        </div>
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
          Phase 0 proof-of-concept — one hand-curated, fully source-linked profile. Compiled {profile.compiled} (method{' '}
          {profile.methodology_version}). Figures are gross government dollars directed to Musk&apos;s companies, not
          his personal income; contracts fund work delivered. We publish this to scrutinize the flow of public money to
          concentrated private wealth — a question that applies to billionaires of every political stripe, not one
          party. See{' '}
          <Link href="/scorecard" className="underline hover:text-accent">
            the scorecard
          </Link>
          .
        </p>
      </footer>
    </div>
  );
}
