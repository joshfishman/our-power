import { redirect } from 'next/navigation';
import Link from 'next/link';
import prisma from '@/lib/prisma/prisma';
import { isScorecardAdmin } from '@/lib/scorecard/admin-auth';

export const dynamic = 'force-dynamic';

interface SearchParams {
  sort?: 'delta' | 'avg' | 'pac' | 'voting';
  jurisdiction?: 'FEDERAL' | 'CA';
  chamber?: 'SEN' | 'REP';
  party?: 'D' | 'R' | 'I';
}

const ALLOWED_SORT = new Set(['delta', 'avg', 'pac', 'voting']);
const ALLOWED_JURIS = new Set(['FEDERAL', 'CA']);
const ALLOWED_CHAMBER = new Set(['SEN', 'REP']);
const ALLOWED_PARTY = new Set(['D', 'R', 'I']);

// v1.7.1 — score audit. Reviewer-facing page listing every legislator with
// their current v1.7.1 numbers plus the delta from the previous methodology
// version. Sorted by largest absolute delta so anomalous shifts surface
// first; admins can click through to the public detail page to inspect the
// bill-level breakdown.
//
// Phase 6 in the v1.5 methodology was "human-verify every MarkerAchievement
// before publish." That premise is obsolete under v1.7.1 — the scoring
// inputs are authoritative public-record data (Congress.gov roll calls,
// FEC PAC filings, LegiScan), and the human-judgment layer is concentrated
// in bill classification (covered by /admin/scorecard/queue from v1.6.1).
// What was still missing was a way to spot-check the published roll-up,
// which is what this page provides.
export default async function ScorecardAuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { allowed } = await isScorecardAdmin();
  if (!allowed) {
    redirect('/login?from=/admin/scorecard/audit');
  }

  const sort = ALLOWED_SORT.has(params.sort ?? '') ? params.sort! : 'delta';
  const jurisdiction = ALLOWED_JURIS.has(params.jurisdiction ?? '') ? params.jurisdiction! : undefined;
  const chamber = ALLOWED_CHAMBER.has(params.chamber ?? '') ? params.chamber! : undefined;
  const party = ALLOWED_PARTY.has(params.party ?? '') ? params.party! : undefined;

  const legislators = await prisma.legislator.findMany({
    where: {
      isActive: true,
      ...(jurisdiction ? { jurisdiction } : {}),
      ...(chamber ? { chamber } : {}),
      ...(party ? { party } : {}),
    },
    select: {
      id: true,
      bioguideId: true,
      openStatesId: true,
      fullName: true,
      jurisdiction: true,
      chamber: true,
      state: true,
      party: true,
      scores: {
        where: { publishedAt: { not: null } },
        select: { score: true, methodologyVersion: true, forCount: true, againstCount: true },
      },
      pacData: {
        orderBy: [{ dataSource: 'asc' }, { cycleYear: 'desc' }],
        take: 1,
        select: { combinedCorporateRatio: true, corporatePacPercentage: true },
      },
    },
  });

  function avgPercent(scores: { score: number }[]): number | null {
    if (scores.length === 0) return null;
    return Math.round(scores.reduce((s, x) => s + x.score, 0) / scores.length);
  }

  // Find the most-recent methodology version present and the one before it.
  // We don't hardcode 'v1.7.1' and 'v1.7' so this page keeps working as
  // versions advance.
  const allVersions = new Set<string>();
  for (const l of legislators) for (const s of l.scores) allVersions.add(s.methodologyVersion);
  const versionList = [...allVersions].sort();
  const currentVersion = versionList[versionList.length - 1] ?? '—';
  const prevVersion = versionList[versionList.length - 2] ?? '—';

  interface AuditRow {
    legId: string;
    fullName: string;
    party: string;
    chamber: string;
    state: string;
    jurisdiction: string;
    bioguideId: string | null;
    openStatesId: string | null;
    pacScore: number | null;
    voting: number | null;
    avg: number | null;
    prevAvg: number | null;
    delta: number | null;
    voteCount: { aligned: number; total: number };
  }
  const rows: AuditRow[] = legislators.map((l) => {
    const current = l.scores.filter((s) => s.methodologyVersion === currentVersion);
    const prev = l.scores.filter((s) => s.methodologyVersion === prevVersion);
    const voting = avgPercent(current);
    const prevVoting = avgPercent(prev);
    const pac = l.pacData[0];
    const ratio = pac ? Number(pac.combinedCorporateRatio ?? pac.corporatePacPercentage ?? 0) : null;
    const pacScore =
      ratio === null || !Number.isFinite(ratio) ? null : Math.max(0, Math.min(100, Math.round((1 - ratio) * 100)));
    const avg = pacScore !== null && voting !== null ? Math.round((pacScore + voting) / 2) : pacScore ?? voting;
    const prevAvg = pacScore !== null && prevVoting !== null ? Math.round((pacScore + prevVoting) / 2) : prevVoting;
    const delta = avg !== null && prevAvg !== null ? avg - prevAvg : null;
    const aligned = current.reduce((s, x) => s + x.forCount, 0);
    const against = current.reduce((s, x) => s + x.againstCount, 0);
    return {
      legId: l.id,
      fullName: l.fullName,
      party: l.party,
      chamber: l.chamber,
      state: l.state,
      jurisdiction: l.jurisdiction,
      bioguideId: l.bioguideId,
      openStatesId: l.openStatesId,
      pacScore,
      voting,
      avg,
      prevAvg,
      delta,
      voteCount: { aligned, total: aligned + against },
    };
  });

  rows.sort((a, b) => {
    // Pending always last
    if ((a.avg === null) !== (b.avg === null)) return a.avg === null ? 1 : -1;
    if (sort === 'avg') return (b.avg ?? -1) - (a.avg ?? -1);
    if (sort === 'pac') return (b.pacScore ?? -1) - (a.pacScore ?? -1);
    if (sort === 'voting') return (b.voting ?? -1) - (a.voting ?? -1);
    // delta — absolute value, biggest movers first
    return Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0);
  });

  const buildHref = (overrides: Partial<SearchParams>) => {
    const next = { sort, jurisdiction, chamber, party, ...overrides };
    const qs = new URLSearchParams();
    Object.entries(next).forEach(([k, v]) => {
      if (v) qs.set(k, String(v));
    });
    const s = qs.toString();
    return s ? `/admin/scorecard/audit?${s}` : '/admin/scorecard/audit';
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="border-b-2 border-border pb-4">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">Scorecard Admin</p>
        <h1 className="mt-1 font-serif text-3xl font-bold text-foreground">Score audit · {currentVersion}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Every published score under the current methodology, with the delta from the previous version (
          <strong>{prevVersion}</strong>). Sort by delta to spot anomalous shifts; click any row to see the bill-level
          breakdown on the public detail page.
        </p>
      </header>

      <nav className="mt-6 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">Sort:</span>
        {(['delta', 'avg', 'pac', 'voting'] as const).map((s) => (
          <Link
            key={s}
            href={buildHref({ sort: s })}
            className={`rounded border px-2 py-1 ${
              sort === s
                ? 'border-accent bg-secondary font-semibold text-foreground'
                : 'border-border bg-secondary text-foreground'
            }`}>
            {s === 'delta' ? '|Δ| biggest movers' : s === 'avg' ? 'Avg' : s === 'pac' ? 'PAC' : 'Voting'}
          </Link>
        ))}
        <span className="ml-3 font-mono text-xs uppercase tracking-widest text-subtle-foreground">Jurisdiction:</span>
        {(['FEDERAL', 'CA'] as const).map((j) => (
          <Link
            key={j}
            href={buildHref({ jurisdiction: jurisdiction === j ? undefined : j })}
            className={`rounded border px-2 py-1 ${
              jurisdiction === j
                ? 'border-accent bg-secondary font-semibold text-foreground'
                : 'border-border bg-secondary text-foreground'
            }`}>
            {j}
          </Link>
        ))}
        <span className="ml-3 font-mono text-xs uppercase tracking-widest text-subtle-foreground">Chamber:</span>
        {(['SEN', 'REP'] as const).map((c) => (
          <Link
            key={c}
            href={buildHref({ chamber: chamber === c ? undefined : c })}
            className={`rounded border px-2 py-1 ${
              chamber === c
                ? 'border-accent bg-secondary font-semibold text-foreground'
                : 'border-border bg-secondary text-foreground'
            }`}>
            {c}
          </Link>
        ))}
        <span className="ml-3 font-mono text-xs uppercase tracking-widest text-subtle-foreground">Party:</span>
        {(['D', 'R', 'I'] as const).map((p) => (
          <Link
            key={p}
            href={buildHref({ party: party === p ? undefined : p })}
            className={`rounded border px-2 py-1 ${
              party === p
                ? 'border-accent bg-secondary font-semibold text-foreground'
                : 'border-border bg-secondary text-foreground'
            }`}>
            {p}
          </Link>
        ))}
      </nav>

      <p className="mt-4 text-xs text-subtle-foreground">{rows.length} legislators</p>

      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-border text-left font-mono text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3">Legislator</th>
            <th className="py-2 pr-3">Party · Chamber</th>
            <th className="py-2 pr-3 text-right">PAC</th>
            <th className="py-2 pr-3 text-right">Voting</th>
            <th className="py-2 pr-3 text-right">Avg</th>
            <th className="py-2 pr-3 text-right">Prev</th>
            <th className="py-2 pr-3 text-right">Δ</th>
            <th className="py-2 pr-3 text-right">Aligned/Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const slug = r.bioguideId ?? r.openStatesId ?? r.legId;
            const deltaColor =
              r.delta === null
                ? 'text-subtle-foreground'
                : Math.abs(r.delta) >= 15
                ? 'text-red-700 font-bold'
                : Math.abs(r.delta) >= 8
                ? 'text-orange-600'
                : 'text-muted-foreground';
            return (
              <tr key={r.legId} className="border-b border-border hover:bg-secondary-accent">
                <td className="py-1.5 pr-3">
                  <Link
                    href={`/scorecard/${encodeURIComponent(slug)}`}
                    className="text-foreground hover:underline"
                    target="_blank"
                    rel="noopener noreferrer">
                    {r.fullName}
                  </Link>
                </td>
                <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">
                  {r.party} · {r.chamber} · {r.state}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{r.pacScore ?? '—'}%</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{r.voting ?? '—'}%</td>
                <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">{r.avg ?? '—'}%</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-subtle-foreground">{r.prevAvg ?? '—'}%</td>
                <td className={`py-1.5 pr-3 text-right tabular-nums ${deltaColor}`}>
                  {r.delta === null ? '—' : r.delta > 0 ? `+${r.delta}` : r.delta}
                </td>
                <td className="py-1.5 pr-3 text-right font-mono text-xs tabular-nums text-subtle-foreground">
                  {r.voteCount.total > 0 ? `${r.voteCount.aligned}/${r.voteCount.total}` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
