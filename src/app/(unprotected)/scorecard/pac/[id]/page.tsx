/* eslint-disable @typescript-eslint/no-use-before-define */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma/prisma';

// Slug aliases — let people use /scorecard/pac/aipac instead of the FEC id.
const SLUG_TO_COMMITTEE: Record<string, string> = {
  aipac: 'C00797670',
  'j-street': 'C00441949',
  jstreet: 'C00441949',
  nra: 'C00053553',
  'gun-owners': 'C00817122',
  everytown: 'C00688655',
  giffords: 'C00540443',
  lcv: 'C00486845',
  'climate-power': 'C00817536',
  sierra: 'C00135064',
  realtors: 'C00030718',
  scf: 'C00448696',
  'club-for-growth': 'C00487470',
  'maga-inc': 'C00825851',
  'house-majority-pac': 'C00495028',
  'senate-leadership-fund': 'C00571703',
  'congressional-leadership-fund': 'C00504530',
  'ff-pac': 'C00669259',
  'save-america': 'C00762591',
};

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const id = params.id.toUpperCase();
  const committeeId = SLUG_TO_COMMITTEE[params.id.toLowerCase()] ?? id;
  const pac = await prisma.pacClassification.findUnique({ where: { committeeId } });
  if (!pac) return { title: 'PAC not found | Scorecard' };
  return {
    title: `${pac.name} | PAC Scoreboard | We the People`,
    description: `Per-cycle giving and top recipients from ${pac.name} (${pac.class}).`,
  };
}

const PARTY_LABEL: Record<string, string> = { D: 'Democrat', R: 'Republican', I: 'Independent' };
const CLASS_TONE: Record<string, { bg: string; label: string }> = {
  CORPORATE: { bg: 'bg-red-700', label: 'Corporate' },
  DARK_MONEY: { bg: 'bg-red-800', label: 'Dark Money' },
  FOREIGN_POLICY: { bg: 'bg-red-600', label: 'Foreign Policy' },
  ACTIVIST: { bg: 'bg-lime-700', label: 'Activist' },
  LABOR: { bg: 'bg-blue-700', label: 'Labor' },
  LEADERSHIP: { bg: 'bg-yellow-700', label: 'Leadership PAC' },
  IDEOLOGICAL: { bg: 'bg-purple-700', label: 'Ideological' },
  CONDUIT: { bg: 'bg-gray-600', label: 'Conduit' },
  UNKNOWN: { bg: 'bg-gray-500', label: 'Unknown' },
};

const COUNTS_AGAINST_CLASSES = new Set(['CORPORATE', 'DARK_MONEY', 'FOREIGN_POLICY']);

export default async function PacScoreboardPage(props: Props) {
  const params = await props.params;
  const committeeId = SLUG_TO_COMMITTEE[params.id.toLowerCase()] ?? params.id.toUpperCase();
  const pac = await prisma.pacClassification.findUnique({ where: { committeeId } });
  if (!pac) notFound();

  // Top recipients across all cycles
  const recipients = await prisma.pacContribution.findMany({
    where: { donorCommitteeId: committeeId },
    include: {
      legislator: {
        select: {
          id: true,
          fullName: true,
          party: true,
          chamber: true,
          state: true,
          district: true,
          bioguideId: true,
        },
      },
    },
  });

  // Aggregate per-legislator: total $, by cycle, by kind
  interface AggLeg {
    legislatorId: string;
    fullName: string;
    party: string;
    chamber: string;
    state: string;
    district: number | null;
    bioguideId: string | null;
    direct: number;
    ieSupport: number;
    ieOppose: number;
    byCycle: Record<number, number>;
    total: number; // direct + ieSupport (NOT ieOppose — opposing PAC doesn't help the leg)
  }
  const byLeg = new Map<string, AggLeg>();
  for (const c of recipients) {
    const cur =
      byLeg.get(c.legislatorId) ??
      ({
        legislatorId: c.legislatorId,
        fullName: c.legislator.fullName,
        party: c.legislator.party,
        chamber: c.legislator.chamber,
        state: c.legislator.state,
        district: c.legislator.district,
        bioguideId: c.legislator.bioguideId,
        direct: 0,
        ieSupport: 0,
        ieOppose: 0,
        byCycle: {},
        total: 0,
      } as AggLeg);
    const amt = Number(c.amount);
    if (c.kind === 'DIRECT') cur.direct += amt;
    else if (c.kind === 'IE_SUPPORT') cur.ieSupport += amt;
    else if (c.kind === 'IE_OPPOSE') cur.ieOppose += amt;
    cur.byCycle[c.cycleYear] = (cur.byCycle[c.cycleYear] ?? 0) + (c.kind === 'IE_OPPOSE' ? 0 : amt);
    if (c.kind !== 'IE_OPPOSE') cur.total += amt;
    byLeg.set(c.legislatorId, cur);
  }

  const sortedSupport = [...byLeg.values()].filter((l) => l.total > 0).sort((a, b) => b.total - a.total);
  const sortedOpposed = [...byLeg.values()].filter((l) => l.ieOppose > 0).sort((a, b) => b.ieOppose - a.ieOppose);

  // Cycle totals
  const cycleTotals: Record<number, number> = {};
  for (const c of recipients) {
    if (c.kind === 'IE_OPPOSE') continue;
    cycleTotals[c.cycleYear] = (cycleTotals[c.cycleYear] ?? 0) + Number(c.amount);
  }
  const totalSupport = Object.values(cycleTotals).reduce((s, v) => s + v, 0);

  // Party breakdown (support only)
  const partyBreakdown: Record<string, number> = {};
  for (const l of sortedSupport) {
    partyBreakdown[l.party] = (partyBreakdown[l.party] ?? 0) + l.total;
  }

  const tone = CLASS_TONE[pac.class] ?? CLASS_TONE.UNKNOWN;
  const countsAgainst = COUNTS_AGAINST_CLASSES.has(pac.class);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link href="/scorecard" className="text-sm text-gray-600 hover:text-gray-900">
        ← Back to scorecard
      </Link>

      <header className="mt-4 border-b-2 border-gray-900 pb-6">
        <div className="flex items-center gap-3">
          <span
            className={`rounded ${tone.bg} px-2 py-1 font-mono text-xs uppercase tracking-wide text-white`}
            title={
              countsAgainst
                ? 'Counts against the legislator PAC Score'
                : 'Does not count against the legislator PAC Score'
            }>
            {tone.label}
            {countsAgainst ? ' · counts against' : ''}
          </span>
          <span className="font-mono text-xs text-gray-500">FEC {pac.committeeId}</span>
        </div>
        <h1 className="mt-2 font-serif text-3xl font-bold text-gray-900">{pac.name}</h1>
        {pac.connectedOrg && pac.connectedOrg !== 'NONE' && (
          <p className="mt-1 text-sm text-gray-700">Connected organization: {pac.connectedOrg}</p>
        )}
        {pac.reason && <p className="mt-2 text-sm italic text-gray-600">Classification reason: {pac.reason}</p>}
      </header>

      <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded border border-gray-200 bg-white p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-gray-500">Lifetime (2018–2024)</p>
          <p className="mt-1 font-serif text-2xl font-bold tabular-nums text-gray-900">
            ${totalSupport.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-gray-500">to federal candidates we track</p>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-gray-500">Recipients</p>
          <p className="mt-1 font-serif text-2xl font-bold tabular-nums text-gray-900">{sortedSupport.length}</p>
          <p className="mt-1 text-xs text-gray-500">legislators / candidates who received support</p>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-gray-500">Party split</p>
          <p className="mt-1 font-mono text-sm">
            {Object.entries(partyBreakdown)
              .sort((a, b) => b[1] - a[1])
              .map(([p, v]) => `${p}: $${Math.round(v / 1000)}K`)
              .join(' · ') || '—'}
          </p>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-gray-500">By cycle</p>
          <p className="mt-1 font-mono text-sm">
            {[2018, 2020, 2022, 2024]
              .filter((c) => cycleTotals[c])
              .map((c) => `${c}: $${Math.round(cycleTotals[c] / 1000)}K`)
              .join(' · ') || '—'}
          </p>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-bold text-gray-900">Top recipients</h2>
        <p className="mt-1 text-sm text-gray-600">
          {countsAgainst
            ? 'These legislators received support from this PAC. Money from this class counts against their PAC Score.'
            : 'These legislators received support from this PAC. Money from this class does not count against their PAC Score.'}
        </p>
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-gray-900 text-left font-mono text-xs uppercase tracking-wide text-gray-600">
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Legislator</th>
              <th className="py-2 pr-3">Party</th>
              <th className="py-2 pr-3">Chamber · State</th>
              <th className="py-2 pr-3 text-right">Direct $</th>
              <th className="py-2 pr-3 text-right">IE support $</th>
              <th className="py-2 pr-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {sortedSupport.slice(0, 50).map((l, idx) => {
              const slug = l.bioguideId ?? l.legislatorId;
              return (
                <tr key={l.legislatorId} className="border-b border-gray-100 hover:bg-[#2C4A5E]/10">
                  <td className="py-1.5 pr-3 font-mono text-xs text-gray-500">{idx + 1}</td>
                  <td className="py-1.5 pr-3">
                    <Link href={`/scorecard/${encodeURIComponent(slug)}`} className="text-gray-900 hover:underline">
                      {l.fullName}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 text-xs text-gray-600">{PARTY_LABEL[l.party] ?? l.party}</td>
                  <td className="py-1.5 pr-3 text-xs text-gray-600">
                    {l.chamber} · {l.state}
                    {l.district != null && l.chamber === 'REP' ? `-${l.district}` : ''}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">${l.direct.toLocaleString()}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-gray-600">
                    {l.ieSupport > 0 ? `$${l.ieSupport.toLocaleString()}` : '—'}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">${l.total.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sortedSupport.length > 50 && (
          <p className="mt-2 text-xs text-gray-500">+{sortedSupport.length - 50} more recipients hidden</p>
        )}
      </section>

      {sortedOpposed.length > 0 && (
        <section className="mt-10">
          <h2 className="font-serif text-2xl font-bold text-gray-900">Legislators opposed (IE against)</h2>
          <p className="mt-1 text-sm text-gray-600">
            This PAC spent independent expenditures AGAINST these legislators&apos; campaigns. This money is shown for
            transparency but does NOT count against the legislator&apos;s own PAC Score (it&apos;s against them).
          </p>
          <table className="mt-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-gray-900 text-left font-mono text-xs uppercase tracking-wide text-gray-600">
                <th className="py-2 pr-3">Legislator</th>
                <th className="py-2 pr-3">Party · Chamber · State</th>
                <th className="py-2 pr-3 text-right">IE against $</th>
              </tr>
            </thead>
            <tbody>
              {sortedOpposed.slice(0, 20).map((l) => {
                const slug = l.bioguideId ?? l.legislatorId;
                return (
                  <tr key={l.legislatorId} className="border-b border-gray-100">
                    <td className="py-1.5 pr-3">
                      <Link href={`/scorecard/${encodeURIComponent(slug)}`} className="text-gray-900 hover:underline">
                        {l.fullName}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-gray-600">
                      {l.party} · {l.chamber} · {l.state}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-red-700">${l.ieOppose.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <footer className="mt-12 border-t-2 border-gray-900 pt-4 text-xs text-gray-500">
        <p>
          <Link href="/scorecard/methodology/pac-classes" className="underline hover:text-[#8B3A3A]">
            What does &quot;{tone.label}&quot; mean? →
          </Link>{' '}
          Same classification applied to every federal PAC, regardless of party.
        </p>
        <p className="mt-1">
          Source: FEC bulk files for 2018, 2020, 2022, 2024 cycles. Auto-classified + human-reviewed.
        </p>
      </footer>
    </div>
  );
}
