import type { Metadata } from 'next';
import Link from 'next/link';
import prisma from '@/lib/prisma/prisma';

export const metadata: Metadata = {
  title: 'PAC Classification | Scorecard Methodology',
  description:
    'The 8-class taxonomy we use to classify every federal PAC. Same classes applied to every PAC regardless of party. Every class is auditable.',
};

interface ClassDef {
  key: string;
  name: string;
  countsAgainst: boolean;
  description: string;
  examples: string[];
  rationale: string;
  edgeCase?: string;
}

const CLASSES: ClassDef[] = [
  {
    key: 'CORPORATE',
    name: 'Corporate',
    countsAgainst: true,
    description: 'Industry-aligned PACs — direct corporate PACs, trade-association PACs, law/lobbying firm PACs.',
    examples: ['Boeing PAC', 'AT&T PAC', 'Realtors PAC', 'AMA PAC', 'Pfizer PAC'],
    rationale:
      'Corporations contributing to legislators in expectation of policy outcomes. The classic influence-buying class.',
  },
  {
    key: 'DARK_MONEY',
    name: 'Dark Money',
    countsAgainst: true,
    description:
      'Partisan super PACs and 501(c)(4)-aligned PACs heavily funded by billionaire networks or undisclosed donors. Vague-name swing operations whose purpose is electing/defeating candidates rather than advancing a specific cause.',
    examples: [
      'Senate Conservatives Fund',
      'Future Forward (FF PAC)',
      'House Majority PAC',
      'MAGA Inc',
      'Senate Leadership Fund',
      'Congressional Leadership Fund',
      'American Crossroads',
    ],
    rationale:
      'Money concentrated in the hands of a few wealthy donors, deployed to swing elections. The post-Citizens-United version of influence-buying.',
    edgeCase:
      'We treat NRA Political Victory Fund as DARK_MONEY (industry+extremist) even though parallel gun-debate PACs like Everytown are ACTIVIST. This is an explicit asymmetry — NRA gets a high share of its funds from firearms manufacturers, not just dues-paying members.',
  },
  {
    key: 'FOREIGN_POLICY',
    name: 'Foreign Policy',
    countsAgainst: true,
    description:
      'US-domiciled PACs whose primary purpose is shaping US foreign policy toward a specific country or region. They reward and punish legislators based on foreign-policy votes.',
    examples: ['AIPAC', 'J Street', 'Republican Jewish Coalition', 'NORPAC', 'United Democracy Project'],
    rationale:
      'Influence buying tied to foreign-policy alignment. AIPAC alone spent $54M directly to candidates in 2024 + $38M via United Democracy Project IE to defeat dissenters in primaries (Cori Bush, Jamaal Bowman).',
    edgeCase:
      'Both pro-Israel-hawk (AIPAC) and pro-Israel-peace (J Street) PACs are in this class — same function (foreign policy lobby via campaign donations), opposite stances.',
  },
  {
    key: 'ACTIVIST',
    name: 'Activist',
    countsAgainst: false,
    description:
      "Single-issue cause advocacy PACs. The org exists to advance a specific policy commitment (gun safety, climate, women's representation, abortion rights or restrictions, voting rights, civil rights, veterans, immigrant rights) rather than just elect candidates.",
    examples: [
      'Everytown Victory Fund',
      'Giffords PAC',
      'Sierra Club',
      'LCV Victory Fund',
      'Planned Parenthood',
      'Susan B. Anthony List',
      "EMILY's List",
      'BlackPAC',
      'Somos PAC',
      'Veterans of Foreign Wars PAC',
    ],
    rationale:
      "Legitimate citizen engagement on issues. Citizens have a right to fund advocacy for causes they believe in. We track these in per-issue scoreboards for transparency but don't penalize legislators for accepting their support.",
  },
  {
    key: 'LABOR',
    name: 'Labor',
    countsAgainst: false,
    description: 'Labor union PACs and labor-affiliated political committees.',
    examples: ['SEIU COPE', 'LIUNA PAC', 'AFT', 'IBEW', 'UAW V-CAP', 'AFSCME', 'NEA Advocacy Fund', 'UFCW'],
    rationale:
      'Worker organizations represent workers. Common Ground framing is anti-corporate, pro-worker; labor money is not corrupting under this methodology.',
  },
  {
    key: 'LEADERSHIP',
    name: 'Leadership PAC',
    countsAgainst: false,
    description:
      "Politician-controlled PACs that distribute money to other candidates. The PAC bears a politician's name or is sponsored by their candidate committee.",
    examples: [
      'AMERIPAC (Steny Hoyer)',
      'PAC to the Future (Nancy Pelosi)',
      'Eye of the Tiger PAC (Steve Scalise)',
      'E-PAC (Elise Stefanik)',
      'Stand for America (Nikki Haley)',
      'Save America (Donald Trump)',
    ],
    rationale:
      "Intra-political transfer. A legislator getting money from another legislator's leadership PAC is receiving it from a politician, not from a corrupting outside source.",
    edgeCase:
      'Leadership PACs are themselves funded by corporate PACs + big donors, so this is a debatable methodology call. Currently we do NOT count leadership PAC transfers against the recipient. This may change in a future version.',
  },
  {
    key: 'IDEOLOGICAL',
    name: 'Ideological',
    countsAgainst: false,
    description:
      "Broad partisan/values grassroots PACs that are not single-issue (don't qualify as Activist) and not billionaire-funded (don't qualify as Dark Money). Small-dollar funded, transparent.",
    examples: [
      'Justice Democrats',
      'Stop MAGA PAC',
      'Progressive Turnout Project',
      'Swing Left',
      'Vote Save America',
      'DemocracyFirst',
      'Indivisible Action',
    ],
    rationale: 'Citizens funding broad partisan organizing. Not corruption — voluntary small-dollar engagement.',
  },
  {
    key: 'CONDUIT',
    name: 'Conduit (excluded)',
    countsAgainst: false,
    description:
      "Pass-through committees like ActBlue and WinRed. These aren't donors themselves — they route individual donations to candidates.",
    examples: ['ActBlue', 'WinRed'],
    rationale:
      "Excluded entirely. Routing individual donations through a conduit doesn't change who the donor is — counting it would double-count individual contributions.",
  },
  {
    key: 'UNKNOWN',
    name: 'Unknown',
    countsAgainst: false,
    description:
      "PACs we couldn't classify with confidence — usually pure-acronym committees with no connected organization. Defaults to doesn't-count (conservative choice).",
    examples: [],
    rationale:
      "When in doubt, don't penalize. The UNKNOWN bucket represents <2% of total PAC dollar volume across 4 cycles, so misclassification has minimal score impact.",
  },
];

export default async function PacClassesMethodologyPage() {
  // Pull live counts + dollar volume per class from PacClassification + PacContribution
  const classCounts = await prisma.pacClassification.groupBy({
    by: ['class'],
    _count: { _all: true },
  });
  const countByClass = Object.fromEntries(classCounts.map((r) => [r.class, r._count._all]));

  const dollarsByClass = await prisma.$queryRaw<Array<{ class: string; dollars: string }>>`
    SELECT pc.class::text AS class, SUM(pcontrib.amount::numeric)::text AS dollars
    FROM "PacClassification" pc
    LEFT JOIN "PacContribution" pcontrib ON pcontrib."donorCommitteeId" = pc."committeeId"
      AND pcontrib.kind != 'IE_OPPOSE'
    GROUP BY pc.class
  `;
  const dollarByClass = Object.fromEntries(dollarsByClass.map((r) => [r.class, Number(r.dollars ?? 0)]));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/scorecard/methodology" className="text-sm text-gray-600 hover:text-gray-900">
        ← Back to methodology
      </Link>

      <header className="mt-4 border-b-2 border-gray-900 pb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-gray-500">Methodology · v1.7.1</p>
        <h1 className="mt-1 font-serif text-4xl font-bold text-gray-900">How we classify PACs</h1>
        <p className="mt-3 max-w-2xl text-base text-gray-700">
          Every federal PAC sits in one of eight classes. Three count <strong>against</strong> the legislator&apos;s PAC
          Score (influence-buying signals). Five do not count — they&apos;re labor money, single-issue advocacy,
          politician-to-politician transfers, broad partisan grassroots, or pass-through conduits. The same
          classification rules apply to every PAC regardless of party.
        </p>
      </header>

      <section className="mt-8 space-y-8">
        {CLASSES.map((c) => {
          const count = countByClass[c.key] ?? 0;
          const dollars = dollarByClass[c.key] ?? 0;
          return (
            <article
              key={c.key}
              className={`rounded border-l-4 p-5 ${
                c.countsAgainst ? 'border-red-700 bg-red-50' : 'border-gray-400 bg-white'
              }`}>
              <header className="flex flex-wrap items-baseline gap-3">
                <h2 className="font-serif text-2xl font-bold text-gray-900">{c.name}</h2>
                <span
                  className={`rounded px-2 py-0.5 font-mono text-xs uppercase tracking-wide ${
                    c.countsAgainst ? 'bg-red-700 text-white' : 'bg-gray-200 text-gray-700'
                  }`}>
                  {c.countsAgainst ? '⚠ Counts against' : "Doesn't count"}
                </span>
                <span className="font-mono text-xs text-gray-500">
                  {count.toLocaleString()} PACs · ${(dollars / 1_000_000).toFixed(1)}M tracked
                </span>
              </header>

              <p className="mt-3 text-gray-700">{c.description}</p>

              {c.examples.length > 0 && (
                <div className="mt-3">
                  <p className="font-mono text-xs uppercase tracking-widest text-gray-500">Examples</p>
                  <p className="mt-1 text-sm text-gray-700">{c.examples.join(' · ')}</p>
                </div>
              )}

              <div className="mt-3">
                <p className="font-mono text-xs uppercase tracking-widest text-gray-500">Rationale</p>
                <p className="mt-1 text-sm text-gray-700">{c.rationale}</p>
              </div>

              {c.edgeCase && (
                <div className="mt-3 rounded bg-amber-50 p-3">
                  <p className="font-mono text-xs uppercase tracking-widest text-amber-800">Edge case</p>
                  <p className="mt-1 text-sm text-amber-900">{c.edgeCase}</p>
                </div>
              )}
            </article>
          );
        })}
      </section>

      <section className="mt-12 rounded border-2 border-[#8B3A3A] bg-[#2C4A5E]/60 p-5">
        <h2 className="font-mono text-xs uppercase tracking-widest text-[#F5DEB3]">Audit & accountability</h2>
        <p className="mt-2 text-sm text-[#F5DEB3]">
          The full classification list is in our public repository at{' '}
          <code className="rounded bg-black/30 px-1 font-mono text-xs">data/pac-candidates.csv</code> — every committee
          ID, name, class assignment, and reason. If you disagree with a classification, open an issue or send us a note
          and we&apos;ll review.
        </p>
      </section>

      <footer className="mt-12 border-t-2 border-gray-900 pt-4 text-xs text-gray-500">
        <p>
          Source: FEC bulk filings 2018 + 2020 + 2022 + 2024 cycles. Classifications by Common Ground methodology team,
          reviewable in repo.
        </p>
      </footer>
    </div>
  );
}
