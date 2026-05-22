/* eslint-disable @typescript-eslint/no-use-before-define */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma/prisma';
import { PacOpposedTable, PacRecipientsTable } from '@/components/scorecard/PacScoreboardTables';

// Slug aliases — let people use /scorecard/pac/aipac instead of the FEC id.
// Value can be a single committee_id (one FEC committee) or an array of
// committee_ids (aggregate multiple related committees onto one scoreboard).
// AIPAC for example operates TWO federal vehicles: the traditional AIPAC PAC
// (C00797670, direct contributions only) and United Democracy Project
// (C00799031, the Super PAC arm doing IE spending against AIPAC's targets).
// Showing them separately understates the real AIPAC footprint by ~80%.
const SLUG_TO_COMMITTEE: Record<string, string | string[]> = {
  aipac: ['C00797670', 'C00799031'], // AIPAC PAC + United Democracy Project (Super PAC arm)
  udp: 'C00799031', // direct link to UDP alone if anyone wants it
  'j-street': 'C00441949',
  jstreet: 'C00441949',
  'pro-israel-america': ['C00699470', 'C00740936', 'C90019431'],
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

function resolveSlug(input: string): string[] {
  const slug = input.toLowerCase();
  const hit = SLUG_TO_COMMITTEE[slug];
  if (Array.isArray(hit)) return hit;
  if (typeof hit === 'string') return [hit];
  // Not a slug — fall through to raw FEC id.
  return [input.toUpperCase()];
}

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const ids = resolveSlug(params.id);
  const pacs = await prisma.pacClassification.findMany({ where: { committeeId: { in: ids } } });
  if (pacs.length === 0) return { title: 'PAC not found | Scorecard' };
  const displayName =
    pacs.length === 1
      ? pacs[0].name
      : params.id.toLowerCase() === 'aipac'
      ? 'AIPAC + United Democracy Project'
      : `${pacs.length} committees`;
  return {
    title: `${displayName} | PAC Scoreboard | We the People`,
    description: `Per-cycle giving and top recipients from ${displayName}.`,
  };
}

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
  const committeeIds = resolveSlug(params.id);
  // Pull all classifications matching the resolved committee ids (1 or more).
  // First row is the "primary" used for the header label / class badge; for
  // group slugs (aipac → AIPAC PAC + UDP) the primary is just the first
  // listed committee — we still show the secondary committee names in the
  // header so readers can see the aggregation.
  const pacs = await prisma.pacClassification.findMany({
    where: { committeeId: { in: committeeIds } },
    orderBy: { committeeId: 'asc' },
  });
  if (pacs.length === 0) notFound();
  // Use the ORDER from the slug map (not alphabetical), so the user's
  // intended primary committee shows first.
  const orderedPacs = committeeIds
    .map((id) => pacs.find((p) => p.committeeId === id))
    .filter((p): p is (typeof pacs)[number] => !!p);
  const pac = orderedPacs[0];
  const isGroup = orderedPacs.length > 1;
  const groupName = params.id.toLowerCase() === 'aipac' ? 'AIPAC + United Democracy Project' : pac.name;

  // Top recipients across all cycles (across all committees in the group)
  const recipients = await prisma.pacContribution.findMany({
    where: { donorCommitteeId: { in: committeeIds } },
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
          isActive: true,
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
    isActive: boolean;
    direct: number; // 24K direct PAC contribution to candidate's committee
    ieSupport: number; // 24E IE supporting this candidate
    ieOppose: number; // 24A IE opposing this candidate (info only — they lost or survived)
    ieBenefit: number; // v1.7.4 IE_OPPOSE_BENEFICIARY — derived: IE this PAC spent
    //                   against a defeated opponent in this leg's race, credited
    //                   to this leg. Separate from FEC-target-attributed money.
    byCycle: Record<number, number>;
    total: number; // direct + ieSupport (FEC-target-attributed only, EXCLUDES beneficiary)
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
        isActive: c.legislator.isActive,
        direct: 0,
        ieSupport: 0,
        ieOppose: 0,
        ieBenefit: 0,
        byCycle: {},
        total: 0,
      } as AggLeg);
    const amt = Number(c.amount);
    if (c.kind === 'DIRECT') cur.direct += amt;
    else if (c.kind === 'IE_SUPPORT') cur.ieSupport += amt;
    else if (c.kind === 'IE_OPPOSE') cur.ieOppose += amt;
    else if (c.kind === 'IE_OPPOSE_BENEFICIARY') cur.ieBenefit += amt;
    // total = FEC-target-attributed money TO this leg (direct + IE supporting them).
    // Excludes IE_OPPOSE (against them), IE_OPPOSE_BENEFICIARY (against their
    // defeated opponent), and JFC_PASS_THROUGH (handled separately as it's
    // already in the principal-committee receipts denominator). Per-cycle
    // bucket follows the same rule.
    if (c.kind === 'DIRECT' || c.kind === 'IE_SUPPORT') {
      cur.total += amt;
      cur.byCycle[c.cycleYear] = (cur.byCycle[c.cycleYear] ?? 0) + amt;
    }
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

  // Sitting-legislator denominators for the Recipients tile.
  // "Sitting" = isActive=true in our Legislator table. This is the population
  // we can meaningfully say "X out of Y current members accepted money."
  // Defeated challengers (isActive=false) are tracked separately so readers
  // can see them but don't get counted in the "of 538" denominator.
  const totalActiveFederal = await prisma.legislator.count({
    where: { isActive: true, jurisdiction: 'FEDERAL' },
  });
  const activeRecipients = sortedSupport.filter((l) => l.isActive);
  const sittingPct = totalActiveFederal > 0 ? Math.round((activeRecipients.length / totalActiveFederal) * 100) : 0;

  const tone = CLASS_TONE[pac.class] ?? CLASS_TONE.UNKNOWN;
  const countsAgainst = COUNTS_AGAINST_CLASSES.has(pac.class);

  // Compute party pie slices for the Party split tile (D/R/I).
  // Use the lifetime total per party so the chart matches the dollar text.
  const partyTotal = Object.values(partyBreakdown).reduce((s, v) => s + v, 0);
  const partyPct = (p: string) => (partyTotal > 0 ? ((partyBreakdown[p] ?? 0) / partyTotal) * 100 : 0);
  const dPct = partyPct('D');
  const rPct = partyPct('R');
  const iPct = partyPct('I');

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link href="/scorecard" className="text-sm text-gray-600 hover:text-gray-900">
        ← Back to scorecard
      </Link>

      <header className="mt-4 border-b-2 border-gray-900 pb-6">
        <div className="flex flex-wrap items-center gap-3">
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
          {isGroup ? (
            <span className="font-mono text-xs text-gray-500">{orderedPacs.length} FEC committees aggregated</span>
          ) : (
            <span className="font-mono text-xs text-gray-500">FEC {pac.committeeId}</span>
          )}
        </div>
        <h1 className="mt-2 font-serif text-3xl font-bold text-gray-900">{isGroup ? groupName : pac.name}</h1>
        {isGroup && (
          <ul className="mt-3 space-y-0.5 font-mono text-xs text-gray-600">
            {orderedPacs.map((p) => (
              <li key={p.committeeId}>
                <span className="text-gray-400">{p.committeeId}</span> · {p.name}
              </li>
            ))}
          </ul>
        )}
        {!isGroup && pac.connectedOrg && pac.connectedOrg !== 'NONE' && (
          <p className="mt-1 text-sm text-gray-700">Connected organization: {pac.connectedOrg}</p>
        )}
        {!isGroup && pac.reason && (
          <p className="mt-2 text-sm italic text-gray-600">Classification reason: {pac.reason}</p>
        )}
      </header>

      <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Lifetime — full dollar amount, dark text */}
        <div className="rounded border border-sky-200 bg-sky-100 p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-slate-600">Lifetime (2018–2024)</p>
          <p className="mt-1 font-serif text-2xl font-bold tabular-nums text-slate-900">
            ${totalSupport.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            To recipients in our database. Includes IE for sitting members AND IE for/against now-defeated challengers
            (Bowman, Bush, Levin, etc.).
          </p>
        </div>

        {/* Recipients — X / 538 + % of sitting Congress */}
        <div className="rounded border border-sky-200 bg-sky-100 p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-slate-600">Recipients</p>
          <p className="mt-1 font-serif text-2xl font-bold tabular-nums text-slate-900">
            {activeRecipients.length.toLocaleString()}{' '}
            <span className="text-base font-normal text-slate-600">/ {totalActiveFederal}</span>
          </p>
          <p className="mt-1 text-xs text-slate-700">
            <span className="font-semibold tabular-nums">{sittingPct}%</span> of sitting federal legislators have
            accepted this PAC&apos;s money.
            {sortedSupport.length > activeRecipients.length && (
              <>
                {' '}
                <span className="text-slate-500">
                  +{sortedSupport.length - activeRecipients.length} now-defeated candidates also received.
                </span>
              </>
            )}
          </p>
        </div>

        {/* Party split — pie chart + per-party full numbers */}
        <div className="rounded border border-sky-200 bg-sky-100 p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-slate-600">Party split</p>
          <div className="mt-2 flex items-center gap-3">
            {partyTotal > 0 ? (
              <div
                className="h-16 w-16 shrink-0 rounded-full border border-slate-200 shadow-sm"
                style={{
                  backgroundImage: `conic-gradient(
                    #1d4ed8 0% ${dPct}%,
                    #b91c1c ${dPct}% ${dPct + rPct}%,
                    #6b7280 ${dPct + rPct}% ${dPct + rPct + iPct}%
                  )`,
                }}
                title={`D ${dPct.toFixed(0)}% · R ${rPct.toFixed(0)}% · I ${iPct.toFixed(0)}%`}
              />
            ) : null}
            <ul className="flex-1 space-y-0.5 font-mono text-xs">
              {(['D', 'R', 'I'] as const).map((p) => {
                const v = partyBreakdown[p] ?? 0;
                if (v <= 0) return null;
                const swatch = p === 'D' ? 'bg-[#1d4ed8]' : p === 'R' ? 'bg-[#b91c1c]' : 'bg-[#6b7280]';
                return (
                  <li key={p} className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-sm ${swatch}`} />
                    <span className="w-3 font-semibold text-slate-700">{p}</span>
                    <span className="flex-1 text-right tabular-nums text-slate-900">${v.toLocaleString()}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {/* By cycle — stacked rows, full numbers, dark text */}
        <div className="rounded border border-sky-200 bg-sky-100 p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-slate-600">By cycle</p>
          <ul className="mt-2 space-y-0.5 font-mono text-xs">
            {[2018, 2020, 2022, 2024].map((c) => {
              const v = cycleTotals[c] ?? 0;
              if (v <= 0) return null;
              const widthPct = totalSupport > 0 ? (v / totalSupport) * 100 : 0;
              return (
                <li key={c} className="flex items-center gap-2">
                  <span className="w-10 shrink-0 font-semibold text-slate-700">{c}</span>
                  <span className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-white/70">
                    <span className="block h-full bg-slate-700" style={{ width: `${widthPct}%` }} />
                  </span>
                  <span className="flex-1 text-right tabular-nums text-slate-900">${v.toLocaleString()}</span>
                </li>
              );
            })}
            {Object.keys(cycleTotals).length === 0 && <li className="text-slate-500">—</li>}
          </ul>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-bold text-gray-900">Top recipients</h2>
        <p className="mt-1 text-sm text-gray-600">
          {countsAgainst
            ? 'These legislators received support from this PAC. Money from this class counts against their PAC Score.'
            : 'These legislators received support from this PAC. Money from this class does not count against their PAC Score.'}
        </p>
        <PacRecipientsTable rows={sortedSupport} />
      </section>

      {sortedOpposed.length > 0 && (
        <section className="mt-10">
          <h2 className="font-serif text-2xl font-bold text-gray-900">Legislators opposed (IE against)</h2>
          <p className="mt-1 text-sm text-gray-600">
            This PAC spent independent expenditures AGAINST these legislators&apos; campaigns. This money is shown for
            transparency but does NOT count against the legislator&apos;s own PAC Score (it&apos;s against them).
          </p>
          <PacOpposedTable rows={sortedOpposed} />
        </section>
      )}

      <footer className="mt-12 border-t-2 border-gray-900 pt-4 text-xs text-gray-500">
        <p>
          <Link href="/scorecard/methodology/pac-classes" className="underline hover:text-[#8B3A3A]">
            What does &quot;{tone.label}&quot; mean? →
          </Link>{' '}
          Same classification applied to every federal PAC, regardless of party.
        </p>
        <p className="mt-2">
          <strong className="text-gray-700">Known coverage gap:</strong> totals reflect contributions and IE filings
          where the recipient (or target) is a <em>sitting</em> federal legislator in our Legislator table. Super PACs
          that spend heavily AGAINST primary challengers who then lose (e.g. AIPAC&apos;s United Democracy Project
          spending against Bowman in 2024 or Levin / Donna Edwards in 2022) drop their losing-target dollars from our
          totals, because the loser never enters our active-legislator roster. The real spending for high-IE PACs is
          typically 30-60% larger than what&apos;s shown here. Closing the gap requires ingesting defeated challengers
          as a separate roster.
        </p>
        <p className="mt-1">
          Source: FEC bulk files for 2018, 2020, 2022, 2024 cycles. Auto-classified + human-reviewed.
        </p>
      </footer>
    </div>
  );
}
