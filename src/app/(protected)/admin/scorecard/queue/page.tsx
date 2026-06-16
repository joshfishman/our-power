import { redirect } from 'next/navigation';
import Link from 'next/link';
import prisma from '@/lib/prisma/prisma';
import { isScorecardAdmin } from '@/lib/scorecard/admin-auth';
import { ReviewForm } from './review-form';

export const dynamic = 'force-dynamic';

interface SearchParams {
  filter?: 'pending' | 'lowConf' | 'all';
  chamber?: 'HOUSE' | 'SENATE' | 'CA_ASSEMBLY' | 'CA_SENATE';
  limit?: string;
}

const ALLOWED_FILTERS = new Set(['pending', 'lowConf', 'all']);
const ALLOWED_CHAMBERS = new Set(['HOUSE', 'SENATE', 'CA_ASSEMBLY', 'CA_SENATE']);

export default async function ScorecardAdminQueuePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { allowed } = await isScorecardAdmin();
  if (!allowed) {
    redirect('/login?from=/admin/scorecard/queue');
  }

  const filter = ALLOWED_FILTERS.has(params.filter ?? '') ? params.filter! : 'pending';
  const chamber = ALLOWED_CHAMBERS.has(params.chamber ?? '') ? (params.chamber as SearchParams['chamber']) : undefined;
  const limit = Math.max(10, Math.min(200, parseInt(params.limit ?? '50', 10)));

  const where = {
    ...(chamber ? { chamber } : {}),
    ...(filter === 'pending'
      ? { reviewedAt: null, OR: [{ classificationConfidence: { lt: 0.8 } }, { isScorable: false }] }
      : filter === 'lowConf'
      ? { classificationConfidence: { lt: 0.8 } }
      : {}),
  };

  const [items, counts] = await Promise.all([
    prisma.rollCallVote.findMany({
      where,
      orderBy: [{ classificationConfidence: 'asc' }, { rollCallNumber: 'asc' }],
      take: limit,
      select: {
        id: true,
        chamber: true,
        congressNumber: true,
        sessionNumber: true,
        rollCallNumber: true,
        voteQuestion: true,
        voteResult: true,
        billType: true,
        billNumber: true,
        billTitle: true,
        billPolicyArea: true,
        billSponsorParty: true,
        plankNumbers: true,
        alignedPosition: true,
        classificationConfidence: true,
        classificationReasoning: true,
        classificationSource: true,
        classifiedBy: true,
        isScorable: true,
        reviewedAt: true,
        sourceUrl: true,
      },
    }),
    prisma.rollCallVote.groupBy({
      by: ['chamber'],
      _count: { _all: true },
      where: { reviewedAt: null, OR: [{ classificationConfidence: { lt: 0.8 } }, { isScorable: false }] },
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="border-b-2 border-border pb-4">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">Scorecard Admin</p>
        <h1 className="mt-1 font-serif text-3xl font-bold text-foreground">Classification review queue</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Roll-call votes whose plank classification is below 0.8 confidence (or not scorable yet). Approve or edit each
          to lock in the right classification. Reviewed rows feed into the next compute pass. For a bill-level view that
          batches every roll-call row of a bill at once, use{' '}
          <Link href="/admin/scorecard/classify" className="text-foreground underline">
            bill classification review
          </Link>
          .
        </p>
      </header>

      <nav className="mt-6 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">Filter:</span>
        {(['pending', 'lowConf', 'all'] as const).map((f) => (
          <Link
            key={f}
            href={{ pathname: '/admin/scorecard/queue', query: { ...params, filter: f } }}
            className={`rounded border px-2 py-1 ${
              filter === f
                ? 'border-accent bg-secondary font-semibold text-foreground'
                : 'border-border bg-secondary text-foreground'
            }`}>
            {f === 'pending' ? 'Pending review' : f === 'lowConf' ? 'Low confidence' : 'All'}
          </Link>
        ))}
        <span className="ml-3 font-mono text-xs uppercase tracking-widest text-subtle-foreground">Chamber:</span>
        {(['HOUSE', 'SENATE', 'CA_ASSEMBLY', 'CA_SENATE'] as const).map((c) => (
          <Link
            key={c}
            href={{ pathname: '/admin/scorecard/queue', query: { ...params, chamber: chamber === c ? undefined : c } }}
            className={`rounded border px-2 py-1 ${
              chamber === c
                ? 'border-accent bg-secondary font-semibold text-foreground'
                : 'border-border bg-secondary text-foreground'
            }`}>
            {c.replace('_', ' ')}
          </Link>
        ))}
      </nav>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>Pending across all chambers:</span>
        {counts.map((c) => (
          <span key={c.chamber} className="font-mono">
            {c.chamber}: <strong>{c._count._all}</strong>
          </span>
        ))}
        <span>· showing {items.length}</span>
      </div>

      <ul className="mt-6 space-y-3">
        {items.map((it) => (
          <li key={it.id} className="rounded border border-border bg-secondary p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="font-mono text-xs uppercase tracking-wide text-foreground">
                  {it.chamber} · roll {it.rollCallNumber} · {it.billType}/{it.billNumber} ·{' '}
                  {it.billPolicyArea ?? 'no area'} · {it.billSponsorParty ?? '?'}-sponsor
                </p>
                <p className="mt-1 font-serif text-lg font-bold text-foreground">{it.billTitle ?? '(no title)'}</p>
                <p className="mt-1 text-sm italic text-foreground">{it.voteQuestion}</p>
                <p className="mt-2 font-mono text-xs text-foreground">
                  Current: planks=[{it.plankNumbers.join(',') || '—'}] aligned={it.alignedPosition ?? '—'} conf=
                  {it.classificationConfidence?.toFixed(2) ?? '—'} src={it.classifiedBy ?? '—'} scorable=
                  {String(it.isScorable)}
                </p>
                {it.classificationReasoning && (
                  <p className="mt-1 text-xs text-foreground">{it.classificationReasoning}</p>
                )}
                {it.sourceUrl && (
                  <p className="mt-1 text-xs">
                    <a
                      href={it.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground underline">
                      View roll-call →
                    </a>
                  </p>
                )}
              </div>
              <ReviewForm
                voteId={it.id}
                currentPlanks={it.plankNumbers}
                currentAligned={it.alignedPosition === 'YES' || it.alignedPosition === 'NO' ? it.alignedPosition : null}
              />
            </div>
          </li>
        ))}
      </ul>

      {items.length === 0 && (
        <p className="mt-8 text-center text-sm text-subtle-foreground">No items in the queue for this filter.</p>
      )}
    </div>
  );
}
