/* eslint-disable @typescript-eslint/no-use-before-define */
import type { Metadata } from 'next';
import Link from 'next/link';
import prisma from '@/lib/prisma/prisma';
import {
  getCycleReceiptsByLegislator,
  getPacScoresByLegislatorV171,
  isViableCandidate,
  VIABILITY_MIN_RECEIPTS,
} from '@/lib/scorecard/queries';

export const metadata: Metadata = {
  title: '2026 Races | Scorecard',
  description:
    "Who's running in 2026 — the same five-plank rubric applied to every viable candidate for U.S. House and Senate. Browse the field by seat: the incumbent, their PAC Score, and how many challengers are in the race.",
};

// Seat slug the /scorecard/race/[seat] page understands:
//   Senate → "TX-SEN", House → "CA-12" (district unpadded).
function seatSlug(chamber: 'SEN' | 'REP', state: string, district: number | null): string {
  return chamber === 'SEN' ? `${state}-SEN` : `${state}-${district ?? '?'}`;
}

function seatLabel(chamber: 'SEN' | 'REP', state: string, district: number | null): string {
  return chamber === 'SEN' ? `${state} — U.S. Senate` : `${state}-${district} (House)`;
}

export default async function RacesIndexPage() {
  // Every 2026 federal candidate. We compute viability per-candidate, then keep
  // only the seats with at least one viable candidate.
  const candidates = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL', currentCandidateCycle: 2026 },
    select: {
      id: true,
      fullName: true,
      party: true,
      state: true,
      chamber: true,
      district: true,
      isActive: true,
    },
    orderBy: [{ state: 'asc' }, { chamber: 'asc' }, { district: 'asc' }, { isActive: 'desc' }, { lastName: 'asc' }],
  });

  const ids = candidates.map((c) => c.id);
  // 2026 cycle receipts (challenger-receipts backfill is in flight; missing =
  // unknown → treated as null by the viability filter) and PAC Scores for the
  // incumbent column. Both bulk reads to avoid N+1 queries.
  const [receipts, pacScores] = await Promise.all([
    getCycleReceiptsByLegislator(ids),
    getPacScoresByLegislatorV171(ids),
  ]);

  // Keep only viable candidates (the "no-chance" filter).
  const viable = candidates.filter((c) =>
    isViableCandidate({ isActive: c.isActive, party: c.party, cycleReceipts: receipts.get(c.id) ?? null }),
  );

  // Group viable candidates into seats.
  interface SeatRow {
    slug: string;
    state: string;
    chamber: 'SEN' | 'REP';
    district: number | null;
    incumbent: { fullName: string; party: string; pacScore: number | null } | null;
    challengerCount: number;
    raisedTotal: number; // sum of 2026 receipts across all viable candidates in the seat
  }
  const seats = new Map<string, SeatRow>();
  for (const c of viable) {
    const chamber = c.chamber as 'SEN' | 'REP';
    const slug = seatSlug(chamber, c.state, c.district);
    let seat = seats.get(slug);
    if (!seat) {
      seat = {
        slug,
        state: c.state,
        chamber,
        district: c.district,
        incumbent: null,
        challengerCount: 0,
        raisedTotal: 0,
      };
      seats.set(slug, seat);
    }
    seat.raisedTotal += receipts.get(c.id) ?? 0;
    if (c.isActive) {
      seat.incumbent = { fullName: c.fullName, party: c.party, pacScore: pacScores.get(c.id) ?? null };
    } else {
      seat.challengerCount += 1;
    }
  }
  const fmtMoney = (n: number): string =>
    n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${Math.round(n / 1_000)}K` : `$${n}`;

  // Group seats by state for the page.
  const byState = new Map<string, SeatRow[]>();
  for (const seat of seats.values()) {
    (byState.get(seat.state) ?? byState.set(seat.state, []).get(seat.state)!).push(seat);
  }
  const states = [...byState.keys()].sort();
  for (const list of byState.values()) {
    list.sort((a, b) => {
      if (a.chamber !== b.chamber) return a.chamber === 'SEN' ? -1 : 1;
      return (a.district ?? 0) - (b.district ?? 0);
    });
  }

  const totalSeats = seats.size;
  const totalViable = viable.length;
  const seatsWithIncumbent = [...seats.values()].filter((s) => s.incumbent).length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/scorecard" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to scorecard
      </Link>

      <header className="mt-4 border-b-2 border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">2026 election</p>
        <h1 className="mt-1 font-serif text-3xl font-bold text-foreground">Who&apos;s running in 2026</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The same rubric, every candidate. We rate the person holding the seat and the people running to take it on one
          measure — corporate-PAC money first, the full voting record as it comes online — so a voter can judge the
          field on the merits, not the megaphone. Choose a race to see the candidates side by side.
        </p>
        <p className="mt-2 font-mono text-xs text-subtle-foreground">
          {totalSeats.toLocaleString()} contested seats · {totalViable.toLocaleString()} viable candidates ·{' '}
          {seatsWithIncumbent.toLocaleString()} with a sitting incumbent on the ballot.
        </p>
      </header>

      {states.length === 0 ? (
        <p className="mt-8 rounded border border-border bg-secondary p-4 text-sm text-foreground">
          No viable 2026 races on record yet. As candidates file and the FEC publishes their receipts, contested seats
          will appear here.
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          {states.map((state) => {
            const list = byState.get(state)!;
            return (
              <section key={state}>
                <h2 className="font-serif text-xl font-bold text-foreground">
                  {state}
                  <span className="ml-2 font-mono text-xs uppercase tracking-widest text-subtle-foreground">
                    {list.length} seat{list.length === 1 ? '' : 's'}
                  </span>
                </h2>
                <ul className="mt-3 divide-y divide-border rounded border border-border">
                  {list.map((seat) => (
                    <li key={seat.slug} className="px-4 py-3">
                      <Link
                        href={`/scorecard/race/${seat.slug}`}
                        className="flex flex-col gap-1 hover:text-accent sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                        <span className="font-mono text-sm font-semibold text-foreground">
                          {seatLabel(seat.chamber, seat.state, seat.district)}
                          {seat.incumbent ? null : (
                            <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-amber-900">
                              Open seat
                            </span>
                          )}
                        </span>
                        <span className="font-mono text-xs text-subtle-foreground">
                          {seat.incumbent ? (
                            <>
                              Incumbent: {seat.incumbent.fullName} (
                              {PARTY_LABEL[seat.incumbent.party] ?? seat.incumbent.party}){' · PAC '}
                              {seat.incumbent.pacScore !== null ? `${seat.incumbent.pacScore}%` : 'no data'}
                            </>
                          ) : (
                            'No incumbent running'
                          )}
                          {' · '}
                          {seat.challengerCount} viable challenger{seat.challengerCount === 1 ? '' : 's'}
                          {seat.raisedTotal > 0 ? (
                            <span className="font-semibold text-foreground">
                              {' · '}
                              {fmtMoney(seat.raisedTotal)} raised in race
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <footer className="mt-12 border-t-2 border-border pt-4 text-xs text-muted-foreground">
        <p>
          A candidate is shown when they are the sitting member of the seat, or a major-party candidate who has raised
          at least ${VIABILITY_FLOOR_LABEL} this cycle. Paper candidates with no campaign are filtered out so the field
          reflects the real choice voters face. Challenger receipts are still being ingested from FEC filings;
          candidates appear as their totals land.
        </p>
        <p className="mt-2">
          <Link href="/scorecard/candidates" className="underline hover:text-accent">
            Every filed candidate
          </Link>{' '}
          ·{' '}
          <Link href="/scorecard/methodology" className="underline hover:text-accent">
            Methodology
          </Link>
        </p>
      </footer>
    </div>
  );
}

const PARTY_LABEL: Record<string, string> = { D: 'Democrat', R: 'Republican', I: 'Independent' };
const VIABILITY_FLOOR_LABEL = VIABILITY_MIN_RECEIPTS.toLocaleString();
