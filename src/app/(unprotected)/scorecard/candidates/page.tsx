/* eslint-disable @typescript-eslint/no-use-before-define */
import type { Metadata } from 'next';
import Link from 'next/link';
import prisma from '@/lib/prisma/prisma';

export const metadata: Metadata = {
  title: '2026 Candidates | Scorecard',
  description:
    'Every federal House and Senate candidate who has filed with the FEC for the 2026 election. Same money lenses applied to each: PAC Score, industry rollup, donor-base ideology.',
};

interface SearchParams {
  state?: string;
  chamber?: string; // SEN | REP
  party?: string;
}

export default async function CandidatesIndexPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;

  const chamberFilter: 'SEN' | 'REP' | undefined =
    searchParams.chamber === 'SEN' || searchParams.chamber === 'REP' ? searchParams.chamber : undefined;
  const partyFilter: 'D' | 'R' | 'I' | undefined =
    searchParams.party === 'D' || searchParams.party === 'R' || searchParams.party === 'I'
      ? searchParams.party
      : undefined;
  const where = {
    jurisdiction: 'FEDERAL' as const,
    currentCandidateCycle: 2026,
    ...(searchParams.state ? { state: searchParams.state.toUpperCase() } : {}),
    ...(chamberFilter ? { chamber: chamberFilter } : {}),
    ...(partyFilter ? { party: partyFilter } : {}),
  };

  const candidates = await prisma.legislator.findMany({
    where,
    select: {
      id: true,
      bioguideId: true,
      fullName: true,
      party: true,
      state: true,
      chamber: true,
      district: true,
      isActive: true,
    },
    orderBy: [{ state: 'asc' }, { chamber: 'asc' }, { district: 'asc' }, { party: 'asc' }, { lastName: 'asc' }],
  });

  // Group into races (seat). Each seat = (state, chamber, district|null).
  // Build seat slugs that the /race/[seat] page understands.
  interface SeatGroup {
    slug: string;
    state: string;
    chamber: 'SEN' | 'REP';
    district: number | null;
    cands: typeof candidates;
  }
  const seats = new Map<string, SeatGroup>();
  for (const c of candidates) {
    const slug =
      c.chamber === 'SEN'
        ? `${c.state}-SEN`
        : `${c.state}-${String(c.district ?? '?')
            .padStart(2, '0')
            .replace(/^0/, '')}`;
    if (!seats.has(slug)) {
      seats.set(slug, { slug, state: c.state, chamber: c.chamber as 'SEN' | 'REP', district: c.district, cands: [] });
    }
    seats.get(slug)!.cands.push(c);
  }
  const seatList = [...seats.values()].sort((a, b) => {
    if (a.state !== b.state) return a.state.localeCompare(b.state);
    if (a.chamber !== b.chamber) return a.chamber === 'SEN' ? -1 : 1;
    return (a.district ?? 0) - (b.district ?? 0);
  });

  // Summary counters
  const totalCands = candidates.length;
  const totalSeats = seatList.length;
  const byParty = candidates.reduce<Record<string, number>>((acc, c) => {
    acc[c.party] = (acc[c.party] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link href="/scorecard" className="text-sm text-gray-600 hover:text-gray-900">
        ← Back to scorecard
      </Link>

      <header className="mt-4 border-b-2 border-gray-900 pb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-gray-500">2026 election</p>
        <h1 className="mt-1 font-serif text-3xl font-bold text-gray-900">All federal candidates</h1>
        <p className="mt-2 text-sm text-gray-700">
          {totalCands.toLocaleString()} candidates filed across {totalSeats} seats — {byParty.D ?? 0} D ·{' '}
          {byParty.R ?? 0} R ·{' '}
          {(byParty.I ?? 0) + (totalCands - (byParty.D ?? 0) - (byParty.R ?? 0) - (byParty.I ?? 0))} other. Click a seat
          to see the primary races side-by-side with PAC Score, industry rollup, and donor-base ideology.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <FilterLink href="/scorecard/candidates" current={!searchParams.chamber}>
            All chambers
          </FilterLink>
          <FilterLink href="/scorecard/candidates?chamber=SEN" current={searchParams.chamber === 'SEN'}>
            Senate
          </FilterLink>
          <FilterLink href="/scorecard/candidates?chamber=REP" current={searchParams.chamber === 'REP'}>
            House
          </FilterLink>
          <span className="px-1 text-gray-400">|</span>
          <FilterLink href={paramsWith(searchParams, { party: undefined })} current={!searchParams.party}>
            All parties
          </FilterLink>
          <FilterLink href={paramsWith(searchParams, { party: 'D' })} current={searchParams.party === 'D'}>
            D
          </FilterLink>
          <FilterLink href={paramsWith(searchParams, { party: 'R' })} current={searchParams.party === 'R'}>
            R
          </FilterLink>
          <FilterLink href={paramsWith(searchParams, { party: 'I' })} current={searchParams.party === 'I'}>
            Independent / other
          </FilterLink>
        </div>
      </header>

      <ul className="mt-6 divide-y divide-gray-200 rounded border border-gray-200">
        {seatList.map((s) => (
          <li key={s.slug} className="px-4 py-2.5">
            <Link
              href={`/scorecard/race/${s.slug}`}
              className="flex items-baseline justify-between gap-3 hover:text-[#8B3A3A]">
              <span className="font-mono text-sm font-semibold text-gray-900">
                {s.chamber === 'SEN' ? `${s.state} — U.S. Senate` : `${s.state}-${s.district} (House)`}
                {s.cands.some((c) => c.isActive) ? (
                  <span className="ml-2 rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white">
                    Incumbent running
                  </span>
                ) : (
                  <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-amber-900">
                    Open seat
                  </span>
                )}
              </span>
              <span className="font-mono text-xs text-gray-500">
                {s.cands.length} candidate{s.cands.length === 1 ? '' : 's'} · D{' '}
                {s.cands.filter((c) => c.party === 'D').length} · R {s.cands.filter((c) => c.party === 'R').length} · I{' '}
                {s.cands.filter((c) => c.party === 'I').length}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <footer className="mt-8 text-xs text-gray-600">
        <p>
          Sourced from FEC <code>cn26.txt</code> (statutory candidates filed for 2026, status=&apos;C&apos;). Same
          five-plank rubric applied to every candidate; full money breakdown on the per-race page. Updated when FEC
          publishes new filings.
        </p>
      </footer>
    </div>
  );
}

function FilterLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: import('react').ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded border px-2 py-0.5 font-mono text-xs uppercase tracking-wide ${
        current
          ? 'border-[#8B3A3A] bg-[#8B3A3A] text-white'
          : 'border-gray-300 bg-white text-gray-700 hover:border-[#8B3A3A] hover:text-[#8B3A3A]'
      }`}>
      {children}
    </Link>
  );
}

function paramsWith(current: SearchParams, override: Partial<SearchParams>): string {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(current)) if (v != null) merged[k] = v;
  for (const [k, v] of Object.entries(override)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  const qs = new URLSearchParams(merged).toString();
  return `/scorecard/candidates${qs ? `?${qs}` : ''}`;
}
