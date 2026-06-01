import type { Metadata } from 'next';
import Link from 'next/link';
import { getAllGhostBeneficiaries, getGhostBeneficiaryTotals, type GhostBeneficiaryRow } from '@/lib/scorecard/queries';

// Voice register: civic / Lincoln-Eisenhower-MLK. Keep OG copy plain
// and accountability-focused; no "stakeholders / progressive / MAGA"
// vocabulary. Social-share image is the standard scorecard mark.
const OG_TITLE = 'Ghost beneficiary $ — We the People Scorecard';
const OG_DESCRIPTION =
  'Over $900M in Super PAC dollars were spent against candidates whose race winners are no longer in our active set. We surface every one of those dollars rather than let them disappear from the record.';

export const metadata: Metadata = {
  title: 'Ghost beneficiary $ | We the People Scorecard',
  description: OG_DESCRIPTION,
  openGraph: {
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    url: 'https://op-pink.vercel.app/scorecard/ghost-beneficiary',
    siteName: 'We the People Scorecard',
    type: 'article',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: OG_TITLE,
    description: OG_DESCRIPTION,
  },
  alternates: {
    canonical: 'https://op-pink.vercel.app/scorecard/ghost-beneficiary',
  },
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function fmtDollars(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function seatLabel(row: GhostBeneficiaryRow): string {
  if (row.chamber === 'SENATE') return `${row.state} U.S. Senate`;
  return `${row.state}-${row.district ?? '?'} (U.S. House)`;
}

function raceSlug(row: GhostBeneficiaryRow): string {
  if (row.chamber === 'SENATE') return `${row.state}-SEN`;
  return `${row.state}-${row.district ?? ''}`;
}

export default async function GhostBeneficiaryIndexPage() {
  const [rows, totals] = await Promise.all([getAllGhostBeneficiaries(), getGhostBeneficiaryTotals()]);

  const houseRows = rows.filter((r) => r.chamber === 'HOUSE');
  const senateRows = rows.filter((r) => r.chamber === 'SENATE');

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/scorecard" className="text-sm text-[#2C4A5E]/90 hover:text-[#2C4A5E]">
        ← Back to scorecard
      </Link>

      <header className="mt-4 border-b-2 border-gray-900 pb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-gray-500">Methodology surface — v1.8.14</p>
        <h1 className="mt-1 font-serif text-3xl font-bold text-[#2C4A5E]">Ghost beneficiary $</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-gray-700">
          Every dollar in the scorecard methodology must surface somewhere. These dollars are spent but not yet
          attributable to any active legislator — the cycle&rsquo;s winner is no longer in our active set (defeated next
          cycle, retired, died, or ran for a different office). When that legislator&rsquo;s records become available we
          will attribute these forward. Until then, we surface them here so the books balance.
        </p>
      </header>

      <section className="mt-6 rounded-lg bg-[#2C4A5E]/60 p-5 text-[#F5DEB3]">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#F5DEB3]/80">Total ghost $</p>
            <p className="mt-1 font-serif text-3xl font-bold tabular-nums">{fmtDollars(totals.totalDollars)}</p>
            <p className="mt-1 font-mono text-[11px] text-[#F5DEB3]/70">{totals.totalRows} seat-cycles</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#F5DEB3]/80">U.S. House</p>
            <p className="mt-1 font-serif text-3xl font-bold tabular-nums">{fmtDollars(totals.houseDollars)}</p>
            <p className="mt-1 font-mono text-[11px] text-[#F5DEB3]/70">{houseRows.length} seat-cycles</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#F5DEB3]/80">U.S. Senate</p>
            <p className="mt-1 font-serif text-3xl font-bold tabular-nums">{fmtDollars(totals.senateDollars)}</p>
            <p className="mt-1 font-mono text-[11px] text-[#F5DEB3]/70">{senateRows.length} seat-cycles</p>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-2xl font-bold text-[#2C4A5E]">Why these dollars exist</h2>
        <div className="mt-3 max-w-3xl space-y-3 text-sm leading-relaxed text-gray-800">
          <p>
            The per-target PAC Score is honest about a single fact: when a Super PAC files an Independent Expenditure
            opposing a candidate, the FEC filing names the target of the opposition, not the eventual beneficiary. So
            $86M against Mehmet Oz in 2022 shows up on Oz&rsquo;s record, not Fetterman&rsquo;s.
          </p>
          <p>
            The <em>Beneficiary PAC Score</em> closes that gap by attributing each IE_OPPOSE row to the active sitting
            legislator who won the seat in that cycle. But when no such legislator exists — the winner was defeated in
            the next cycle, retired, died, or ran for a different office — there is no honest attribution available
            today. The script leaves the row unattributed rather than misattribute it to whoever currently holds the
            seat.
          </p>
          <p>
            This page surfaces those unattributable dollars. They are real, they were spent, and the methodology promise
            is that every dollar shows up somewhere in the record. When a future legislator&rsquo;s file includes the
            seat-cycle in question, we will attribute these forward and the row will move out of this table.
          </p>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-2xl font-bold text-[#2C4A5E]">All seat-cycles</h2>
        <p className="mt-2 text-sm text-gray-700">
          Ordered by total IE_OPPOSE $ descending. Click a seat to see the candidates in that race.
        </p>
        <div className="mt-4 overflow-x-auto rounded border border-gray-300">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[#2C4A5E] text-[#F5DEB3]">
                <th className="px-3 py-2 text-left font-mono text-xs uppercase tracking-wide">Seat</th>
                <th className="px-3 py-2 text-left font-mono text-xs uppercase tracking-wide">Cycle</th>
                <th className="px-3 py-2 text-right font-mono text-xs uppercase tracking-wide">IE_OPPOSE $</th>
                <th className="px-3 py-2 text-right font-mono text-xs uppercase tracking-wide">Rows</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.state}|${r.district ?? ''}|${r.chamber}|${r.cycleYear}`}
                  className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2 text-[#2C4A5E]">
                    <Link
                      href={`/scorecard/race/${encodeURIComponent(raceSlug(r))}`}
                      className="font-semibold underline hover:text-[#8B3A3A]">
                      {seatLabel(r)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-700">{r.cycleYear}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[#2C4A5E]">
                    {fmtDollars(r.totalAgainst)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-gray-700">{r.rowCount}</td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-500">
                    No ghost-beneficiary rows. Every IE_OPPOSE $ in our index credits an active legislator.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mt-12 border-t-2 border-gray-900 pt-4 text-xs text-gray-600">
        <p>
          Source: <code className="rounded bg-gray-100 px-1 font-mono">scripts/attribute-ie-beneficiary.ts</code>{' '}
          (v1.8.14). Refreshed on each run of{' '}
          <code className="rounded bg-gray-100 px-1 font-mono">npm run scorecard:attribute-ie-beneficiary</code>. CSV
          snapshot at <code className="rounded bg-gray-100 px-1 font-mono">data/ghost-beneficiary-202605.csv</code>.
        </p>
        <p className="mt-2">
          <Link href="/scorecard/methodology" className="underline hover:text-[#8B3A3A]">
            Full methodology
          </Link>{' '}
          ·{' '}
          <Link href="/scorecard" className="underline hover:text-[#8B3A3A]">
            Scorecard index
          </Link>
        </p>
      </footer>
    </div>
  );
}
