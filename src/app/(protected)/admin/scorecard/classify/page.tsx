import { redirect } from 'next/navigation';
import Link from 'next/link';
import prisma from '@/lib/prisma/prisma';
import { isScorecardAdmin } from '@/lib/scorecard/admin-auth';
import { BillReviewForm } from './bill-review-form';

export const dynamic = 'force-dynamic';

// v1.7.x — bill-level roll-call classification review.
//
// Companion to /admin/scorecard/queue (which reviews one RollCallVote row at a
// time). This page rolls scorable roll-call rows up to the BILL level
// (chamber + billType + billNumber), because the same bill can carry several
// roll-call rows and a plank/alignment decision must apply to all of them.
// Admin actions in ./actions.ts write every matching row in one updateMany.

interface SearchParams {
  filter?: 'unreviewed' | 'reviewed' | 'all';
  chamber?: 'HOUSE' | 'SENATE' | 'CA_ASSEMBLY' | 'CA_SENATE';
  plank?: string;
  limit?: string;
}

const ALLOWED_FILTERS = new Set(['unreviewed', 'reviewed', 'all']);
const ALLOWED_CHAMBERS = new Set(['HOUSE', 'SENATE', 'CA_ASSEMBLY', 'CA_SENATE']);
const PLANKS = [1, 2, 3, 4, 5] as const;

type Chamber = 'HOUSE' | 'SENATE' | 'CA_ASSEMBLY' | 'CA_SENATE';

interface BillRow {
  chamber: Chamber;
  billType: string;
  billNumber: string;
  billTitle: string | null;
  billPolicyArea: string | null;
  billSponsorParty: string | null;
  voteQuestion: string;
  plankNumbers: number[];
  alignedPosition: string | null;
  classificationConfidence: number | null;
  classifiedBy: string | null;
  classificationReasoning: string | null;
  isScorable: boolean;
  reviewedAt: Date | null;
  sourceUrl: string | null;
  // Aggregates across the bill's roll-call rows.
  rollCallCount: number;
  positionCount: number;
  minConfidence: number;
}

export default async function ScorecardClassifyPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { allowed } = await isScorecardAdmin();
  if (!allowed) {
    redirect('/login?from=/admin/scorecard/classify');
  }

  const filter = ALLOWED_FILTERS.has(params.filter ?? '') ? params.filter! : 'unreviewed';
  const chamber = ALLOWED_CHAMBERS.has(params.chamber ?? '') ? (params.chamber as Chamber) : undefined;
  const plankParsed = parseInt(params.plank ?? '', 10);
  const plank = Number.isInteger(plankParsed) && plankParsed >= 1 && plankParsed <= 5 ? plankParsed : undefined;
  const limit = Math.max(10, Math.min(300, parseInt(params.limit ?? '60', 10)));

  // Pull all scorable rows tied to a bill, with position counts. We aggregate
  // in JS because the grouping key (chamber+billType+billNumber) plus the
  // "lowest confidence / earliest unreviewed" priority is awkward in a single
  // Prisma groupBy. Scorable universe is ~770 rows, so this is cheap.
  const rows = await prisma.rollCallVote.findMany({
    where: {
      isScorable: true,
      billType: { not: null },
      billNumber: { not: null },
      ...(chamber ? { chamber } : {}),
      ...(plank ? { plankNumbers: { has: plank } } : {}),
    },
    orderBy: [{ classificationConfidence: 'asc' }, { rollCallNumber: 'asc' }],
    select: {
      chamber: true,
      billType: true,
      billNumber: true,
      billTitle: true,
      billPolicyArea: true,
      billSponsorParty: true,
      voteQuestion: true,
      plankNumbers: true,
      alignedPosition: true,
      classificationConfidence: true,
      classifiedBy: true,
      classificationReasoning: true,
      isScorable: true,
      reviewedAt: true,
      sourceUrl: true,
      _count: { select: { positions: true } },
    },
  });

  // Roll up to the bill level. The representative metadata comes from the
  // lowest-confidence row (the one most in need of a look). We keep the union
  // of plank numbers and treat the bill as "reviewed" only when every row is.
  const billMap = new Map<string, BillRow>();
  for (const r of rows) {
    const key = `${r.chamber}|${r.billType}|${r.billNumber}`;
    const conf = r.classificationConfidence ?? 0;
    const existing = billMap.get(key);
    if (!existing) {
      billMap.set(key, {
        chamber: r.chamber as Chamber,
        billType: r.billType!,
        billNumber: r.billNumber!,
        billTitle: r.billTitle,
        billPolicyArea: r.billPolicyArea,
        billSponsorParty: r.billSponsorParty,
        voteQuestion: r.voteQuestion,
        plankNumbers: [...r.plankNumbers],
        alignedPosition: r.alignedPosition,
        classificationConfidence: r.classificationConfidence,
        classifiedBy: r.classifiedBy,
        classificationReasoning: r.classificationReasoning,
        isScorable: r.isScorable,
        reviewedAt: r.reviewedAt,
        sourceUrl: r.sourceUrl,
        rollCallCount: 1,
        positionCount: r._count.positions,
        minConfidence: conf,
      });
    } else {
      existing.rollCallCount += 1;
      existing.positionCount += r._count.positions;
      existing.plankNumbers = [...new Set([...existing.plankNumbers, ...r.plankNumbers])].sort((a, b) => a - b);
      // Bill counts as reviewed only if ALL its rows are reviewed.
      if (existing.reviewedAt && !r.reviewedAt) existing.reviewedAt = null;
      // Surface the lowest confidence across the group.
      if (conf < existing.minConfidence) {
        existing.minConfidence = conf;
        existing.classificationConfidence = r.classificationConfidence;
        existing.classifiedBy = r.classifiedBy;
        existing.classificationReasoning = r.classificationReasoning;
      }
    }
  }

  const allBills = [...billMap.values()];

  // Progress: reviewed vs unreviewed scorable bills, overall and per plank.
  // Computed over the full scorable universe (ignores active chamber/plank
  // filters so the coverage numbers stay stable as the admin filters).
  const progressOverall = { reviewed: 0, total: 0 };
  const progressByPlank = new Map<number, { reviewed: number; total: number }>();
  for (const p of PLANKS) progressByPlank.set(p, { reviewed: 0, total: 0 });
  {
    // Recompute over the unfiltered scorable universe for coverage stats.
    const universe =
      chamber || plank
        ? await prisma.rollCallVote.findMany({
            where: { isScorable: true, billType: { not: null }, billNumber: { not: null } },
            select: { chamber: true, billType: true, billNumber: true, plankNumbers: true, reviewedAt: true },
          })
        : rows.map((r) => ({
            chamber: r.chamber,
            billType: r.billType,
            billNumber: r.billNumber,
            plankNumbers: r.plankNumbers,
            reviewedAt: r.reviewedAt,
          }));
    const uniMap = new Map<string, { planks: Set<number>; reviewed: boolean }>();
    for (const r of universe) {
      const key = `${r.chamber}|${r.billType}|${r.billNumber}`;
      const e = uniMap.get(key) ?? { planks: new Set<number>(), reviewed: true };
      for (const p of r.plankNumbers) e.planks.add(p);
      if (!r.reviewedAt) e.reviewed = false;
      uniMap.set(key, e);
    }
    for (const e of uniMap.values()) {
      progressOverall.total += 1;
      if (e.reviewed) progressOverall.reviewed += 1;
      for (const p of e.planks) {
        const slot = progressByPlank.get(p);
        if (slot) {
          slot.total += 1;
          if (e.reviewed) slot.reviewed += 1;
        }
      }
    }
  }

  // Apply the review filter, then sort: unreviewed first, lowest confidence
  // first (most in need of a human look).
  const filtered = allBills.filter((b) => {
    if (filter === 'unreviewed') return b.reviewedAt === null;
    if (filter === 'reviewed') return b.reviewedAt !== null;
    return true;
  });
  filtered.sort((a, b) => {
    const ar = a.reviewedAt === null ? 0 : 1;
    const br = b.reviewedAt === null ? 0 : 1;
    if (ar !== br) return ar - br;
    return a.minConfidence - b.minConfidence;
  });
  const items = filtered.slice(0, limit);

  const buildHref = (overrides: Partial<SearchParams>) => {
    const next: SearchParams = { filter, chamber, plank: params.plank, ...overrides };
    const qs = new URLSearchParams();
    if (next.filter) qs.set('filter', next.filter);
    if (next.chamber) qs.set('chamber', next.chamber);
    if (next.plank) qs.set('plank', String(next.plank));
    const s = qs.toString();
    return s ? `/admin/scorecard/classify?${s}` : '/admin/scorecard/classify';
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="border-b-2 border-border pb-4">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">Scorecard Admin</p>
        <h1 className="mt-1 font-serif text-3xl font-bold text-foreground">Bill classification review</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Scorable roll-call bills grouped by bill (a bill can carry several roll-call rows). Confirm the
          auto-classification, override the plank(s) and aligned direction, or exclude a bill from scoring. Each action
          writes every roll-call row for that bill. For single-row review use the{' '}
          <Link href="/admin/scorecard/queue" className="text-foreground underline">
            row queue
          </Link>
          .
        </p>
      </header>

      {/* Progress / coverage */}
      <section className="mt-6 rounded border border-border bg-secondary p-4">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">Coverage (scorable bills)</p>
        <p className="mt-1 text-sm text-foreground">
          Overall: <strong className="tabular-nums">{progressOverall.reviewed}</strong> /{' '}
          <strong className="tabular-nums">{progressOverall.total}</strong> reviewed
          {progressOverall.total > 0
            ? ` (${Math.round((progressOverall.reviewed / progressOverall.total) * 100)}%)`
            : ''}
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {PLANKS.map((p) => {
            const s = progressByPlank.get(p)!;
            return (
              <span key={p} className="font-mono">
                P{p}: <strong className="tabular-nums">{s.reviewed}</strong>/
                <span className="tabular-nums">{s.total}</span>
              </span>
            );
          })}
        </div>
      </section>

      {/* Filters */}
      <nav className="mt-6 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">Show:</span>
        {(['unreviewed', 'reviewed', 'all'] as const).map((f) => (
          <Link
            key={f}
            href={buildHref({ filter: f })}
            className={`rounded border px-2 py-1 ${
              filter === f
                ? 'border-accent bg-secondary font-semibold text-foreground'
                : 'border-border bg-secondary text-foreground'
            }`}>
            {f === 'unreviewed' ? 'Unreviewed' : f === 'reviewed' ? 'Reviewed' : 'All'}
          </Link>
        ))}
        <span className="ml-3 font-mono text-xs uppercase tracking-widest text-subtle-foreground">Chamber:</span>
        {(['HOUSE', 'SENATE', 'CA_ASSEMBLY', 'CA_SENATE'] as const).map((c) => (
          <Link
            key={c}
            href={buildHref({ chamber: chamber === c ? undefined : c })}
            className={`rounded border px-2 py-1 ${
              chamber === c
                ? 'border-accent bg-secondary font-semibold text-foreground'
                : 'border-border bg-secondary text-foreground'
            }`}>
            {c.replace('_', ' ')}
          </Link>
        ))}
        <span className="ml-3 font-mono text-xs uppercase tracking-widest text-subtle-foreground">Plank:</span>
        {PLANKS.map((p) => (
          <Link
            key={p}
            href={buildHref({ plank: plank === p ? undefined : String(p) })}
            className={`rounded border px-2 py-1 ${
              plank === p
                ? 'border-accent bg-secondary font-semibold text-foreground'
                : 'border-border bg-secondary text-foreground'
            }`}>
            P{p}
          </Link>
        ))}
      </nav>

      <div className="mt-3 text-xs text-muted-foreground">
        {filtered.length} bill(s) match · showing {items.length}
      </div>

      <ul className="mt-6 space-y-3">
        {items.map((b) => (
          <li
            key={`${b.chamber}|${b.billType}|${b.billNumber}`}
            className="rounded border border-border bg-secondary p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="font-mono text-xs uppercase tracking-wide text-foreground">
                  {b.chamber} · {b.billType}/{b.billNumber} · {b.billPolicyArea ?? 'no area'} ·{' '}
                  {b.billSponsorParty ?? '?'}-sponsor · {b.reviewedAt ? 'reviewed' : 'unreviewed'}
                </p>
                <p className="mt-1 font-serif text-lg font-bold text-foreground">{b.billTitle ?? '(no title)'}</p>
                <p className="mt-1 text-sm italic text-foreground">{b.voteQuestion}</p>
                <p className="mt-2 font-mono text-xs text-foreground">
                  Current: planks=[{b.plankNumbers.join(',') || '—'}] aligned={b.alignedPosition ?? '—'} minConf=
                  {b.minConfidence.toFixed(2)} src={b.classifiedBy ?? '—'}
                </p>
                <p className="mt-1 font-mono text-xs text-subtle-foreground">
                  {b.rollCallCount} roll-call row(s) · {b.positionCount} recorded position(s)
                </p>
                {b.classificationReasoning && (
                  <p className="mt-1 text-xs text-foreground">{b.classificationReasoning}</p>
                )}
                {b.sourceUrl && (
                  <p className="mt-1 text-xs">
                    <a
                      href={b.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground underline">
                      View roll-call →
                    </a>
                  </p>
                )}
              </div>
              <BillReviewForm
                billKey={{ chamber: b.chamber, billType: b.billType, billNumber: b.billNumber }}
                currentPlanks={b.plankNumbers}
                currentAligned={b.alignedPosition === 'YES' || b.alignedPosition === 'NO' ? b.alignedPosition : null}
              />
            </div>
          </li>
        ))}
      </ul>

      {items.length === 0 && (
        <p className="mt-8 text-center text-sm text-subtle-foreground">No bills match this filter.</p>
      )}
    </div>
  );
}
