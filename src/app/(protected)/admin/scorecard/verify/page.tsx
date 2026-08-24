import Link from 'next/link';
import { redirect } from 'next/navigation';
import { canRevoke, requireReviewer } from '@/lib/scorecard/verification-auth';
import { fetchRecentReviews, fetchVerificationQueue, serializeQueueItem } from '@/lib/scorecard/verification-queue';
import { verificationQueueQuerySchema } from '@/lib/validations/scorecard-verification';
import { VerificationQueue } from './verification-queue';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const TIERS = ['RED', 'YELLOW', 'GREEN', 'REJECTED', 'ALL'] as const;
const TIER_LABEL: Record<(typeof TIERS)[number], string> = {
  RED: 'Unverified',
  YELLOW: 'Machine-verified',
  GREEN: 'Human-verified',
  REJECTED: 'Rejected',
  ALL: 'All',
};

const SORTS = ['oldest', 'newest', 'legislator', 'plank'] as const;
const SORT_LABEL: Record<(typeof SORTS)[number], string> = {
  oldest: 'Oldest first',
  newest: 'Newest first',
  legislator: 'By legislator',
  plank: 'By plank',
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ScorecardVerificationPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const reviewer = await requireReviewer();
  if (!reviewer) {
    redirect('/login?from=/admin/scorecard/verify');
  }

  const raw = await searchParams;
  // Unknown or malformed params fall back to defaults rather than 500ing —
  // this page is reached by hand-edited URLs constantly.
  const parsed = verificationQueueQuerySchema.safeParse(
    Object.fromEntries(
      Object.entries(raw)
        .map(([key, value]) => [key, firstValue(value)])
        .filter(([, value]) => value !== undefined && value !== ''),
    ),
  );
  const query = parsed.success ? parsed.data : verificationQueueQuerySchema.parse({});

  const [{ items, total, counts }, recentReviews] = await Promise.all([
    fetchVerificationQueue(query),
    fetchRecentReviews(10),
  ]);

  const chipQuery = (overrides: Record<string, string | number | undefined>) => {
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...query, offset: 0, ...overrides })) {
      if (value === undefined || value === '' || value === null) continue;
      next[key] = String(value);
    }
    return { pathname: '/admin/scorecard/verify', query: next };
  };

  const chipClass = (active: boolean) =>
    `rounded border px-2 py-1 text-sm ${
      active
        ? 'border-accent bg-secondary font-semibold text-foreground'
        : 'border-border bg-card text-muted-foreground'
    }`;

  const pageStart = query.offset + 1;
  const pageEnd = Math.min(query.offset + items.length, total);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="border-b-2 border-border pb-4">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">Scorecard Admin</p>
        <h1 className="mt-1 font-serif text-3xl font-bold text-foreground">Evidence verification queue</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Every published score has to trace to evidence a named person actually looked at. Open the source, confirm it
          says what the ingest script recorded, then verify or reject. Verifying stamps your account; rejecting takes
          the row out of scoring and out of this queue.
        </p>
        <p className="mt-2 text-xs text-subtle-foreground">
          Signed in as <span className="font-mono text-foreground">{reviewer.email}</span> · role{' '}
          <span className="font-mono text-foreground">{reviewer.role}</span> ·{' '}
          <Link href="/admin/scorecard/queue" className="underline">
            bill classification queue
          </Link>{' '}
          ·{' '}
          <Link href="/admin/scorecard/audit" className="underline">
            score audit
          </Link>
        </p>
      </header>

      <section className="mt-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">Tier:</span>
          {TIERS.map((tier) => (
            <Link key={tier} href={chipQuery({ tier })} className={chipClass(query.tier === tier)}>
              {TIER_LABEL[tier]}
              {tier !== 'ALL' && <span className="ml-1 font-mono text-xs text-subtle-foreground">{counts[tier]}</span>}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">Jurisdiction:</span>
          {(['FEDERAL', 'CA'] as const).map((j) => (
            <Link
              key={j}
              href={chipQuery({ jurisdiction: query.jurisdiction === j ? undefined : j })}
              className={chipClass(query.jurisdiction === j)}>
              {j}
            </Link>
          ))}
          <span className="ml-3 font-mono text-xs uppercase tracking-widest text-subtle-foreground">Plank:</span>
          {[1, 2, 3, 4, 5].map((p) => (
            <Link
              key={p}
              href={chipQuery({ plank: query.plank === p ? undefined : p })}
              className={chipClass(query.plank === p)}>
              P{p}
            </Link>
          ))}
          <span className="ml-3 font-mono text-xs uppercase tracking-widest text-subtle-foreground">Marker:</span>
          {(['PRIMARY', 'SECONDARY'] as const).map((t) => (
            <Link
              key={t}
              href={chipQuery({ markerType: query.markerType === t ? undefined : t })}
              className={chipClass(query.markerType === t)}>
              {t}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">Sort:</span>
          {SORTS.map((s) => (
            <Link key={s} href={chipQuery({ sort: s })} className={chipClass(query.sort === s)}>
              {SORT_LABEL[s]}
            </Link>
          ))}
          {query.legislatorId && (
            <Link href={chipQuery({ legislatorId: undefined })} className={chipClass(true)}>
              Clear legislator filter ✕
            </Link>
          )}
        </div>
      </section>

      <p className="mt-4 text-sm text-muted-foreground">
        <strong className="text-foreground">{total.toLocaleString()}</strong> remaining in this filter
        {total > 0 && (
          <>
            {' '}
            · showing {pageStart.toLocaleString()}–{pageEnd.toLocaleString()}
          </>
        )}
        {' · '}
        <span className="font-mono text-xs text-subtle-foreground">
          {counts.RED.toLocaleString()} unverified · {counts.YELLOW.toLocaleString()} machine ·{' '}
          {counts.GREEN.toLocaleString()} human · {counts.REJECTED.toLocaleString()} rejected
        </span>
      </p>

      <VerificationQueue
        items={items.map(serializeQueueItem)}
        canRevoke={canRevoke(reviewer.role)}
        reviewerEmail={reviewer.email}
      />

      {items.length > 0 && (
        <nav className="mt-6 flex items-center gap-3 text-sm">
          {query.offset > 0 && (
            <Link
              href={chipQuery({ offset: Math.max(0, query.offset - query.limit) })}
              className="rounded border border-border bg-card px-3 py-1 text-foreground">
              ← Previous
            </Link>
          )}
          {query.offset + items.length < total && (
            <Link
              href={chipQuery({ offset: query.offset + query.limit })}
              className="rounded border border-border bg-card px-3 py-1 text-foreground">
              Next →
            </Link>
          )}
        </nav>
      )}

      <section className="mt-10 border-t border-border pt-6">
        <h2 className="font-serif text-xl font-bold text-foreground">Recent review activity</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Append-only. Every verification, rejection, and revocation is recorded against the reviewer who made it.
          AUTO_INVALIDATE entries are the sync returning a row to the queue because its evidence changed underneath an
          approval — no person took that action.
        </p>
        <ul className="mt-3 space-y-2">
          {recentReviews.map((review) => (
            <li key={review.id} className="rounded border border-border bg-card p-3 text-sm">
              <span className="font-mono text-xs text-subtle-foreground">
                {review.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
              </span>{' '}
              <span className="font-mono text-xs text-foreground">{review.reviewerEmail}</span>{' '}
              <span
                className={`font-mono text-xs font-bold ${
                  review.action === 'VERIFY'
                    ? 'text-success'
                    : review.action === 'REJECT'
                    ? 'text-destructive'
                    : 'text-warning'
                }`}>
                {review.action}
              </span>{' '}
              <span className="text-foreground">
                {review.achievement.legislator.fullName} ({review.achievement.legislator.state}) · P
                {review.achievement.marker.plank.number} {review.achievement.marker.name}
              </span>
              {review.note && <p className="mt-1 text-xs italic text-muted-foreground">{review.note}</p>}
            </li>
          ))}
          {recentReviews.length === 0 && (
            <li className="rounded border border-border bg-card p-3 text-sm text-subtle-foreground">
              No reviews recorded yet.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
