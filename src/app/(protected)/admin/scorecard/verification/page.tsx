import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isScorecardAdmin } from '@/lib/scorecard/admin-auth';
import { getVerificationQueue, getVerificationSummary, type VerificationFilters } from '@/lib/scorecard/verification';
import { VerifyForm, BulkVerifyForm } from './verify-form';

export const dynamic = 'force-dynamic';

// Phase 6 — human verification queue (PR #50 spec, scoped to no-schema-change
// v1). Lists every MarkerAchievement that still needs a human sign-off:
// verifiedAt null (RED) or verifiedBy='auto-verify-temp' (YELLOW stand-in
// written by `compute-scores --auto-verify`). pac-engine rows are excluded —
// they're computed deterministically from public FEC/Cal-Access filings and
// self-verify at write time. The methodology promise this page services:
// every published score traces to human-verified evidence.

interface SearchParams {
  jurisdiction?: 'FEDERAL' | 'CA';
  plank?: string; // '1'-'5'
  page?: string;
}

const ALLOWED_JURIS = new Set(['FEDERAL', 'CA']);

export default async function VerificationQueuePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { allowed } = await isScorecardAdmin();
  if (!allowed) {
    redirect('/login?from=/admin/scorecard/verification');
  }

  const jurisdiction = ALLOWED_JURIS.has(params.jurisdiction ?? '')
    ? (params.jurisdiction as 'FEDERAL' | 'CA')
    : undefined;
  const plankNumber = /^[1-5]$/.test(params.plank ?? '') ? parseInt(params.plank!, 10) : undefined;
  const page = /^\d+$/.test(params.page ?? '') ? parseInt(params.page!, 10) : 1;

  const filters: VerificationFilters = { jurisdiction, plankNumber };
  const [summary, queue] = await Promise.all([getVerificationSummary(), getVerificationQueue(filters, page)]);

  const buildHref = (overrides: { jurisdiction?: string; plank?: string; page?: string }) => {
    const next: Record<string, string | undefined> = {
      jurisdiction,
      plank: plankNumber ? String(plankNumber) : undefined,
      ...overrides,
    };
    const qs = new URLSearchParams();
    Object.entries(next).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });
    const s = qs.toString();
    return s ? `/admin/scorecard/verification?${s}` : '/admin/scorecard/verification';
  };

  const chip = (active: boolean) =>
    `rounded border px-2 py-1 ${
      active
        ? 'border-primary bg-secondary font-semibold text-secondary-foreground'
        : 'border-border bg-muted text-muted-foreground'
    }`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="border-b-2 border-border pb-4">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Scorecard Admin</p>
        <h1 className="mt-1 font-serif text-3xl font-bold text-foreground">Verification queue</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Every achievement that still needs a human sign-off — never verified, or bulk-flipped by the temporary{' '}
          <code className="font-mono text-xs">--auto-verify</code> stand-in. Open the evidence link, confirm the row,
          then Verify (sign off) or Reject (no valid public record). PAC-engine rows self-verify from public filings and
          are excluded.
        </p>
        <nav className="mt-3 flex flex-wrap gap-3 text-xs">
          <Link href="/admin/scorecard/queue" className="text-muted-foreground underline hover:text-foreground">
            Classification queue →
          </Link>
          <Link href="/admin/scorecard/audit" className="text-muted-foreground underline hover:text-foreground">
            Score audit →
          </Link>
        </nav>
      </header>

      {/* Progress toward fully-human-verified */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded border border-border bg-card p-3">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Unverified</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-destructive">{summary.unverified}</p>
        </div>
        <div className="rounded border border-border bg-card p-3">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Auto-verified (temp)</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-warning">{summary.autoVerifiedTemp}</p>
        </div>
        <div className="rounded border border-border bg-card p-3">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Human-verified</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-success">{summary.humanVerified}</p>
        </div>
        <div className="rounded border border-border bg-card p-3">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">PAC engine (excluded)</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-muted-foreground">{summary.pacEngine}</p>
        </div>
      </section>
      <p className="mt-2 text-xs text-muted-foreground">
        {summary.total} achievements total · {summary.queueTotal} in the review queue
      </p>

      {/* Filters */}
      <nav className="mt-6 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Jurisdiction:</span>
        {(['FEDERAL', 'CA'] as const).map((j) => (
          <Link
            key={j}
            href={buildHref({ jurisdiction: jurisdiction === j ? undefined : j, page: undefined })}
            className={chip(jurisdiction === j)}>
            {j}
          </Link>
        ))}
        <span className="ml-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">Plank:</span>
        {[1, 2, 3, 4, 5].map((p) => (
          <Link
            key={p}
            href={buildHref({ plank: plankNumber === p ? undefined : String(p), page: undefined })}
            className={chip(plankNumber === p)}>
            P{p}
          </Link>
        ))}
      </nav>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {queue.matching} row{queue.matching === 1 ? '' : 's'} match this filter · page {queue.page} of{' '}
          {queue.pageCount}
        </p>
        <BulkVerifyForm jurisdiction={jurisdiction} plankNumber={plankNumber} matching={queue.matching} />
      </div>

      <ul className="mt-4 space-y-3">
        {queue.items.map((it) => {
          const slug = it.legislator.bioguideId ?? it.legislator.openStatesId ?? it.legislator.id;
          return (
            <li key={it.id} className="rounded border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                    <span className={it.trustTier === 'RED' ? 'font-bold text-destructive' : 'font-bold text-warning'}>
                      {it.trustTier === 'RED' ? '● unverified' : '● auto-verified'}
                    </span>{' '}
                    · {it.legislator.jurisdiction} · P{it.marker.plankNumber} {it.marker.plankName} ·{' '}
                    {it.marker.markerType}
                  </p>
                  <p className="mt-1 font-serif text-lg font-bold text-foreground">
                    <Link
                      href={`/scorecard/${encodeURIComponent(slug)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline">
                      {it.legislator.fullName}
                    </Link>{' '}
                    <span className="font-sans text-sm font-normal text-muted-foreground">
                      ({it.legislator.party} · {it.legislator.chamber} · {it.legislator.state})
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-foreground">{it.marker.name}</p>
                  <p className="mt-2 font-mono text-xs text-muted-foreground">
                    action={it.actionTaken ?? '—'} · evidence={it.evidenceType}
                    {it.sponsorTier ? ` · sponsor=${it.sponsorTier}` : ''} · verifiedBy={it.verifiedBy ?? '—'}
                  </p>
                  {it.evidenceNotes && (
                    <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{it.evidenceNotes}</p>
                  )}
                  {it.evidenceSourceUrl ? (
                    <p className="mt-1 text-xs">
                      <a
                        href={it.evidenceSourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-foreground underline">
                        Open evidence source →
                      </a>
                    </p>
                  ) : (
                    <p className="mt-1 text-xs italic text-muted-foreground">No evidence source URL on record.</p>
                  )}
                </div>
                <VerifyForm achievementId={it.id} />
              </div>
            </li>
          );
        })}
      </ul>

      {queue.items.length === 0 && (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Nothing in the queue for this filter — every matching achievement is human-verified.
        </p>
      )}

      {/* Pagination */}
      {queue.pageCount > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-3 text-sm">
          {queue.page > 1 ? (
            <Link href={buildHref({ page: String(queue.page - 1) })} className={chip(false)}>
              ← Prev
            </Link>
          ) : (
            <span className="rounded border border-border px-2 py-1 text-muted-foreground opacity-40">← Prev</span>
          )}
          <span className="font-mono text-xs text-muted-foreground">
            {queue.page} / {queue.pageCount}
          </span>
          {queue.page < queue.pageCount ? (
            <Link href={buildHref({ page: String(queue.page + 1) })} className={chip(false)}>
              Next →
            </Link>
          ) : (
            <span className="rounded border border-border px-2 py-1 text-muted-foreground opacity-40">Next →</span>
          )}
        </nav>
      )}
    </div>
  );
}
