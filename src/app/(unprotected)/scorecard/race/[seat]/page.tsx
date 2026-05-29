/* eslint-disable @typescript-eslint/no-use-before-define */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma/prisma';
import {
  getLegislatorMoneyTrail,
  getLegislatorIndividualMoney,
  getLegislatorDimeProfile,
  computePublishedTotal,
} from '@/lib/scorecard/queries';

type Props = { params: Promise<{ seat: string }> };

// Parse a seat slug into (state, chamber, district?).
// Formats:
//   NY-16   →  state=NY, chamber=REP, district=16
//   PA-SEN  →  state=PA, chamber=SEN, district=null
function parseSeat(slug: string): { state: string; chamber: 'SEN' | 'REP'; district: number | null } | null {
  const s = slug.toUpperCase();
  const m = s.match(/^([A-Z]{2})-(\d+|SEN)$/);
  if (!m) return null;
  const state = m[1];
  if (m[2] === 'SEN') return { state, chamber: 'SEN', district: null };
  return { state, chamber: 'REP', district: parseInt(m[2], 10) };
}

function seatLabel(seat: { state: string; chamber: 'SEN' | 'REP'; district: number | null }): string {
  if (seat.chamber === 'SEN') return `${seat.state} U.S. Senate`;
  return `${seat.state}-${seat.district} (U.S. House)`;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const seat = parseSeat(params.seat);
  if (!seat) return { title: 'Race not found | Scorecard' };
  return {
    title: `${seatLabel(seat)} 2026 | Race scorecard`,
    description: `Side-by-side comparison of every 2026 candidate for ${seatLabel(
      seat,
    )} — PAC Score, industry rollup, donor-base ideology. Same five-plank rubric applied to each.`,
  };
}

const PARTY_LABEL: Record<string, string> = { D: 'Democrat', R: 'Republican', I: 'Independent' };
const PARTY_TONE: Record<string, { bg: string; ring: string; text: string }> = {
  D: { bg: 'bg-[#1d4ed8]/10', ring: 'ring-[#1d4ed8]/40', text: 'text-[#1d4ed8]' },
  R: { bg: 'bg-[#b91c1c]/10', ring: 'ring-[#b91c1c]/40', text: 'text-[#b91c1c]' },
  I: { bg: 'bg-gray-500/10', ring: 'ring-gray-500/40', text: 'text-gray-700' },
};

export default async function RaceScorecardPage(props: Props) {
  const params = await props.params;
  const seat = parseSeat(params.seat);
  if (!seat) notFound();

  // All candidates filed for this seat in 2026.
  const candidates = await prisma.legislator.findMany({
    where: {
      jurisdiction: 'FEDERAL',
      currentCandidateCycle: 2026,
      state: seat.state,
      chamber: seat.chamber,
      district: seat.district,
    },
    select: {
      id: true,
      bioguideId: true,
      fullName: true,
      party: true,
      state: true,
      chamber: true,
      district: true,
      isActive: true,
      fecIds: true,
      photoUrl: true,
      scores: {
        where: { publishedAt: { not: null } },
        select: { score: true, plank: { select: { number: true, name: true } } },
      },
    },
    orderBy: [{ party: 'asc' }, { isActive: 'desc' }, { lastName: 'asc' }],
  });

  if (candidates.length === 0) notFound();

  // Fetch money data per candidate in parallel.
  type Profile = {
    pacScore: number | null;
    totalReceipts: number | null;
    topIndustry: { label: string; pct: number } | null;
    dimeScore: number | null; // donor-base ideology (-2 left .. +2 right)
    smallDollarPct: number | null;
    votingScore: number | null;
  };
  const profiles = await Promise.all(
    candidates.map(async (c): Promise<Profile> => {
      const [trail, indiv, dime] = await Promise.all([
        getLegislatorMoneyTrail(c.id),
        getLegislatorIndividualMoney(c.id),
        getLegislatorDimeProfile(c.id),
      ]);
      const top = indiv?.industryMix[0];
      return {
        pacScore: trail?.pacScore ?? null,
        totalReceipts: trail?.totalReceipts ?? null,
        topIndustry: top ? { label: top.label, pct: top.pctOfClassified } : null,
        dimeScore: dime?.contributorCfscore ?? null,
        smallDollarPct: dime?.smallDollarPct ?? null,
        votingScore: c.isActive ? computePublishedTotal(c.scores) : null,
      };
    }),
  );

  // Partition by party for primary view.
  const byParty: Record<string, Array<{ c: (typeof candidates)[number]; p: Profile }>> = {};
  candidates.forEach((c, i) => {
    (byParty[c.party] ??= []).push({ c, p: profiles[i] });
  });
  const partyOrder = ['D', 'R', 'I'] as const;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/scorecard" className="text-sm text-gray-600 hover:text-gray-900">
        ← Back to scorecard
      </Link>

      <header className="mt-4 border-b-2 border-gray-900 pb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-gray-500">2026 race</p>
        <h1 className="mt-1 font-serif text-3xl font-bold text-gray-900">{seatLabel(seat)}</h1>
        <p className="mt-2 text-sm text-gray-700">
          {candidates.length} filed candidate{candidates.length === 1 ? '' : 's'} —{' '}
          {partyOrder
            .map((p) => {
              const n = byParty[p]?.length ?? 0;
              return n > 0 ? `${n} ${PARTY_LABEL[p]}${n > 1 ? 's' : ''}` : null;
            })
            .filter(Boolean)
            .join(' · ')}
          . Same money lenses we apply to sitting members — applied to every candidate.
        </p>
      </header>

      {partyOrder.map((party) => {
        const list = byParty[party];
        if (!list || list.length === 0) return null;
        return (
          <section key={party} className="mt-8">
            <h2 className={`font-serif text-2xl font-bold ${PARTY_TONE[party].text}`}>
              {list.length === 1 ? 'Independent / single' : `${PARTY_LABEL[party]} primary`}
              <span className="ml-2 font-mono text-xs uppercase tracking-widest text-gray-500">
                {list.length} candidate{list.length === 1 ? '' : 's'}
              </span>
            </h2>
            <ul className="mt-3 space-y-3">
              {list.map(({ c, p }) => {
                const slug = c.bioguideId ?? c.id;
                return (
                  <li
                    key={c.id}
                    className={`rounded-lg border p-4 ring-1 ${PARTY_TONE[party].bg} ${PARTY_TONE[party].ring}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <div>
                        <Link
                          href={`/scorecard/${encodeURIComponent(slug)}`}
                          className="font-serif text-lg font-bold text-gray-900 hover:underline">
                          {c.fullName}
                        </Link>
                        {c.isActive ? (
                          <span className="ml-2 rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white">
                            Incumbent
                          </span>
                        ) : null}
                      </div>
                      <span className="font-mono text-xs text-gray-500">
                        {PARTY_LABEL[c.party]} · {c.state}
                        {c.district != null && c.chamber === 'REP' ? `-${c.district}` : ''}
                      </span>
                    </div>

                    <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Stat label="PAC Score" value={p.pacScore !== null ? `${p.pacScore}%` : '—'} />
                      <Stat
                        label="Voting"
                        value={p.votingScore !== null ? `${p.votingScore}%` : c.isActive ? '—' : 'no record'}
                        hint={c.isActive ? undefined : 'not sitting'}
                      />
                      <Stat
                        label="Top donor industry"
                        value={p.topIndustry ? `${p.topIndustry.label}` : '—'}
                        hint={p.topIndustry ? `${p.topIndustry.pct.toFixed(0)}% of classified` : 'no individual data'}
                      />
                      <Stat
                        label="Donor ideology"
                        value={
                          p.dimeScore !== null
                            ? `${p.dimeScore.toFixed(2)} (${
                                p.dimeScore < -0.3 ? 'left' : p.dimeScore > 0.3 ? 'right' : 'mid'
                              })`
                            : '—'
                        }
                        hint={p.dimeScore !== null ? 'DIME donor CFscore' : 'no prior cycle in DIME'}
                      />
                    </dl>

                    {(p.totalReceipts ?? 0) > 0 ? (
                      <p className="mt-3 font-mono text-xs text-gray-600">
                        Receipts to date: ${Math.round(p.totalReceipts!).toLocaleString()}
                      </p>
                    ) : (
                      <p className="mt-3 font-mono text-xs text-gray-500">No FEC receipts yet for this cycle.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <footer className="mt-12 border-t-2 border-gray-900 pt-4 text-xs text-gray-600">
        <p>
          Same five-plank rubric applied to every candidate. Voting Score only computable for sitting members (no record
          for challengers). PAC Score, industry rollup, and donor-base ideology come from FEC filings + DIME and work
          for any candidate with prior cycle activity. Fresh-this-cycle challengers will show as &ldquo;no data&rdquo;
          until they file enough receipts.
        </p>
        <p className="mt-2">
          <Link href="/scorecard/methodology" className="underline hover:text-[#8B3A3A]">
            Methodology
          </Link>{' '}
          ·{' '}
          <Link href="/scorecard/candidates" className="underline hover:text-[#8B3A3A]">
            All 2026 candidates
          </Link>
        </p>
      </footer>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded bg-white/70 p-2">
      <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-0.5 font-serif text-base font-bold tabular-nums text-gray-900">{value}</p>
      {hint ? <p className="mt-0.5 font-mono text-[10px] text-gray-500">{hint}</p> : null}
    </div>
  );
}
