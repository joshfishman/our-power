'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState, useTransition } from 'react';
import type { SerializedQueueItem } from '@/lib/scorecard/verification-queue';
import { MAX_BULK_REVIEW, TRUST_TIER_LABEL, type TrustTier } from '@/lib/scorecard/verification';

const TIER_CLASS: Record<TrustTier, string> = {
  GREEN: 'border-success text-success',
  YELLOW: 'border-warning text-warning',
  RED: 'border-border text-muted-foreground',
  REJECTED: 'border-destructive text-destructive',
};

type ActionKind = 'VERIFY' | 'REJECT' | 'REVOKE';

interface ApiResult {
  appliedCount: number;
  skipped: Array<{ id: string; reason: string }>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-subtle-foreground">{label}:</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

function RowCheckbox({
  id,
  checked,
  onToggle,
  label,
}: {
  id: string;
  checked: boolean;
  onToggle: (id: string) => void;
  label: string;
}) {
  const handleChange = useCallback(() => onToggle(id), [id, onToggle]);
  return <input type="checkbox" checked={checked} onChange={handleChange} aria-label={label} className="mt-1" />;
}

function EvidenceCard({ item }: { item: SerializedQueueItem }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-2 py-0.5 font-mono text-xs uppercase ${TIER_CLASS[item.tier]}`}>
          {TRUST_TIER_LABEL[item.tier]}
        </span>
        <span className="font-mono text-xs uppercase tracking-wide text-subtle-foreground">
          {item.legislator.jurisdiction} · {item.legislator.chamber} · {item.legislator.party}-{item.legislator.state}
          {item.legislator.district !== null ? `-${item.legislator.district}` : ''}
        </span>
      </div>

      <h3 className="mt-1 font-serif text-lg font-bold text-foreground">
        {item.legislator.fullName}{' '}
        <Link
          href={{ pathname: '/admin/scorecard/verify', query: { legislatorId: item.legislator.id, tier: 'ALL' } }}
          className="font-sans text-xs font-normal text-muted-foreground underline">
          only this legislator
        </Link>
      </h3>

      <p className="mt-1 text-sm text-foreground">
        <span className="font-mono text-xs uppercase text-subtle-foreground">
          Plank {item.marker.plank.number} · {item.marker.markerType}
          {item.marker.isRepublicanAlternative ? ' · Option C alternative' : ''}
        </span>
        <br />
        <strong>{item.marker.name}</strong> — {item.marker.description}
      </p>

      {item.marker.methodologyNotes && (
        <p className="mt-1 text-xs italic text-muted-foreground">{item.marker.methodologyNotes}</p>
      )}

      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 font-mono text-xs text-foreground sm:grid-cols-2">
        <Field label="Recorded position" value={item.actionTaken ?? '—'} />
        <Field label="Evidence type" value={item.evidenceType} />
        <Field label="Sponsor tier" value={item.sponsorTier ?? '—'} />
        <Field label="Marker score" value={item.achievementScore ?? '—'} />
        <Field
          label="Popular support"
          value={item.marker.popularSupport !== null ? `${item.marker.popularSupport}%` : 'unassessed'}
        />
        <Field label="Ingest provenance" value={item.verifiedBy ?? 'none'} />
      </dl>

      {item.evidenceNotes && <p className="mt-2 text-sm italic text-foreground">“{item.evidenceNotes}”</p>}

      {item.evidenceSourceUrl && (
        <p className="mt-1 text-xs">
          <a
            href={item.evidenceSourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline">
            Open the source the ingest recorded →
          </a>
        </p>
      )}

      {item.bills.length > 0 && (
        <div className="mt-3 rounded border border-border p-2">
          <p className="font-mono text-xs uppercase tracking-wide text-subtle-foreground">
            Bills behind this marker — and what the scoring engine read for this legislator
          </p>
          <ul className="mt-1 space-y-1 text-xs text-foreground">
            {item.bills.map((bill) => (
              <li key={bill.id}>
                <span className="font-mono">
                  {bill.billType} {bill.billNumber} ({bill.congressNumber}) · needs {bill.actionType}
                </span>{' '}
                — {bill.billTitle}
                <br />
                <span className="text-muted-foreground">
                  {bill.vote
                    ? `Roll call: voted ${bill.vote.position}${
                        bill.vote.voteDate ? ` on ${bill.vote.voteDate.slice(0, 10)}` : ''
                      }${bill.vote.voteContext ? ` — ${bill.vote.voteContext}` : ''}`
                    : 'Roll call: no recorded vote'}
                  {' · '}
                  {bill.sponsorship
                    ? `Sponsorship: ${bill.sponsorship.sponsorTier}${
                        bill.sponsorship.sponsorOrder !== null ? ` (#${bill.sponsorship.sponsorOrder})` : ''
                      }`
                    : 'Sponsorship: none'}
                </span>
                {bill.vote?.sourceUrl && (
                  <>
                    {' '}
                    <a
                      href={bill.vote.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground underline">
                      roll-call source →
                    </a>
                  </>
                )}
                {bill.publicSlug && (
                  <>
                    {' '}
                    <Link href={`/scorecard/bills/${bill.publicSlug}`} className="text-foreground underline">
                      public issue page →
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(item.verifiedFromUrl || item.reviewNote) && (
        <p className="mt-2 text-xs text-muted-foreground">
          {item.verifierEmail && (
            <>
              Last verified by <span className="font-mono text-foreground">{item.verifierEmail}</span>
              {item.verifiedAt ? ` on ${item.verifiedAt.slice(0, 10)}` : ''}.{' '}
            </>
          )}
          {item.verifiedFromUrl && (
            <>
              Citation:{' '}
              <a
                href={item.verifiedFromUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline">
                {item.verifiedFromUrl}
              </a>
              .{' '}
            </>
          )}
          {item.reviewNote && <>Note: “{item.reviewNote}”</>}
        </p>
      )}
    </div>
  );
}

function RowActions({
  item,
  canRevoke,
  disabled,
  reviewerEmail,
  onSubmit,
}: {
  item: SerializedQueueItem;
  canRevoke: boolean;
  disabled: boolean;
  reviewerEmail: string;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [citationUrl, setCitationUrl] = useState(item.evidenceSourceUrl ?? '');
  const [note, setNote] = useState('');

  const alreadyMine = item.tier === 'GREEN' && item.verifierEmail === reviewerEmail;

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
      <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-subtle-foreground">
        Citation URL you opened
        <input
          type="url"
          value={citationUrl}
          onChange={(event) => setCitationUrl(event.target.value)}
          placeholder="https://…"
          className="rounded border border-border bg-card px-2 py-1 text-sm text-foreground"
        />
      </label>
      <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-subtle-foreground">
        Note (required to reject or revoke)
        <input
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="rounded border border-border bg-card px-2 py-1 text-sm text-foreground"
        />
      </label>
      <button
        type="button"
        disabled={disabled || alreadyMine}
        onClick={() => onSubmit({ achievementIds: [item.id], action: 'VERIFY', citationUrl, note: note || undefined })}
        className="rounded border border-success px-3 py-1 font-mono text-xs uppercase text-success disabled:opacity-40">
        Verify
      </button>
      <button
        type="button"
        disabled={disabled || item.tier === 'REJECTED'}
        onClick={() => onSubmit({ achievementIds: [item.id], action: 'REJECT', note })}
        className="rounded border border-destructive px-3 py-1 font-mono text-xs uppercase text-destructive disabled:opacity-40">
        Reject
      </button>
      {canRevoke && item.tier === 'GREEN' && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSubmit({ achievementIds: [item.id], action: 'REVOKE', note })}
          className="rounded border border-warning px-3 py-1 font-mono text-xs uppercase text-warning disabled:opacity-40">
          Revoke
        </button>
      )}
    </div>
  );
}

/**
 * Bulk action bar.
 *
 * Bulk exists for genuinely mechanical batches, and is deliberately awkward:
 * the reviewer must type the exact selected count to arm the action, and a
 * note is mandatory. The server enforces both independently.
 */
function BulkBar({
  selectedIds,
  canRevoke,
  disabled,
  onSelectAll,
  onClear,
  onSubmit,
}: {
  selectedIds: string[];
  canRevoke: boolean;
  disabled: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState('');
  const [note, setNote] = useState('');
  const [citationUrl, setCitationUrl] = useState('');

  const count = selectedIds.length;
  const armed = count > 1 && confirmation.trim() === String(count) && note.trim().length > 0;
  const overCap = count > MAX_BULK_REVIEW;

  const run = async (action: ActionKind) => {
    await onSubmit({
      achievementIds: selectedIds,
      action,
      note,
      citationUrl: action === 'VERIFY' ? citationUrl : undefined,
      bulkConfirmation: count,
    });
    setConfirmation('');
    setNote('');
  };

  return (
    <div className="rounded border border-border bg-secondary p-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">Bulk:</span>
        <span className="text-foreground">
          <strong>{count}</strong> selected
        </span>
        <button type="button" onClick={onSelectAll} className="text-xs text-foreground underline">
          select all on page
        </button>
        <button type="button" onClick={onClear} className="text-xs text-foreground underline">
          clear
        </button>
      </div>

      {count > 1 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Bulk actions are for mechanically identical rows only. Type <strong>{count}</strong> to arm, and say why the
            batch is mechanical.
          </p>
          {overCap && (
            <p className="text-xs text-destructive">
              A single action may cover at most {MAX_BULK_REVIEW} rows. Narrow the selection.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-subtle-foreground">
              Type “{count}” to confirm
              <input
                type="text"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="w-32 rounded border border-border bg-card px-2 py-1 text-sm text-foreground"
              />
            </label>
            <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-subtle-foreground">
              Why is this batch mechanical? (required)
              <input
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="rounded border border-border bg-card px-2 py-1 text-sm text-foreground"
              />
            </label>
            <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-subtle-foreground">
              Citation URL (required to verify)
              <input
                type="url"
                value={citationUrl}
                onChange={(event) => setCitationUrl(event.target.value)}
                placeholder="https://…"
                className="rounded border border-border bg-card px-2 py-1 text-sm text-foreground"
              />
            </label>
            <button
              type="button"
              disabled={disabled || !armed || overCap || !citationUrl}
              onClick={() => run('VERIFY')}
              className="rounded border border-success px-3 py-1 font-mono text-xs uppercase text-success disabled:opacity-40">
              Verify {count}
            </button>
            <button
              type="button"
              disabled={disabled || !armed || overCap}
              onClick={() => run('REJECT')}
              className="rounded border border-destructive px-3 py-1 font-mono text-xs uppercase text-destructive disabled:opacity-40">
              Reject {count}
            </button>
            {canRevoke && (
              <button
                type="button"
                disabled={disabled || !armed || overCap}
                onClick={() => run('REVOKE')}
                className="rounded border border-warning px-3 py-1 font-mono text-xs uppercase text-warning disabled:opacity-40">
                Revoke {count}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function VerificationQueue({
  items,
  canRevoke,
  reviewerEmail,
}: {
  items: SerializedQueueItem[];
  canRevoke: boolean;
  reviewerEmail: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedIds = useMemo(() => [...selected].filter((id) => items.some((i) => i.id === id)), [selected, items]);

  const submit = useCallback(
    async (body: Record<string, unknown>): Promise<void> => {
      setBusy(true);
      setMessage(null);
      try {
        const response = await fetch('/api/admin/scorecard/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as ApiResult & { error?: string };
        if (!response.ok) {
          setMessage({ tone: 'error', text: payload.error ?? 'Request failed' });
          return;
        }
        const skippedNote = payload.skipped.length > 0 ? ` · ${payload.skipped.length} skipped` : '';
        setMessage({ tone: 'ok', text: `${payload.appliedCount} recorded${skippedNote}` });
        setSelected(new Set());
        startTransition(() => router.refresh());
      } catch {
        setMessage({ tone: 'error', text: 'Network error — nothing was recorded' });
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  // Stable identities: these are passed as props to child components, where
  // a fresh arrow function each render would be both a lint error and a
  // needless re-render.
  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllOnPage = useCallback(() => setSelected(new Set(items.map((i) => i.id))), [items]);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  return (
    <div className="mt-6">
      {message && (
        <p
          role="status"
          className={`mb-3 rounded border p-2 text-sm ${
            message.tone === 'ok'
              ? 'border-success bg-card text-success'
              : 'border-destructive bg-card text-destructive'
          }`}>
          {message.text}
        </p>
      )}

      <BulkBar
        selectedIds={selectedIds}
        canRevoke={canRevoke}
        disabled={busy || pending}
        onSelectAll={selectAllOnPage}
        onClear={clearSelection}
        onSubmit={submit}
      />

      <ul className="mt-4 space-y-4">
        {items.map((item) => (
          <li key={item.id} className="rounded border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <RowCheckbox
                id={item.id}
                checked={selected.has(item.id)}
                onToggle={toggle}
                label={`Select ${item.legislator.fullName} — ${item.marker.name}`}
              />
              <div className="min-w-0 flex-1">
                <EvidenceCard item={item} />
                <RowActions
                  item={item}
                  canRevoke={canRevoke}
                  disabled={busy || pending}
                  reviewerEmail={reviewerEmail}
                  onSubmit={submit}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>

      {items.length === 0 && (
        <p className="rounded border border-border bg-card p-6 text-center text-sm text-subtle-foreground">
          Nothing left in this filter. Try another tier or jurisdiction.
        </p>
      )}
    </div>
  );
}
