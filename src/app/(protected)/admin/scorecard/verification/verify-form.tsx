'use client';

import { useState, useTransition } from 'react';
import { verifyAchievement, rejectAchievement, bulkVerifyFiltered } from './actions';

/** Per-row Verify / Reject controls. */
export function VerifyForm({ achievementId }: { achievementId: string }) {
  const [mode, setMode] = useState<'idle' | 'rejecting'>('idle');
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<'idle' | 'verified' | 'rejected' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const done = status === 'verified' || status === 'rejected';

  if (done) {
    return (
      <p className="w-56 text-right font-mono text-xs uppercase tracking-wide text-muted-foreground">
        {status === 'verified' ? '✓ Verified' : '✗ Rejected → no record'}
      </p>
    );
  }

  return (
    <div className="flex w-56 flex-col gap-2 text-xs">
      {mode === 'idle' && (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const formData = new FormData();
              formData.set('achievementId', achievementId);
              startTransition(() => {
                verifyAchievement(formData).then((r) => {
                  if (r.ok) setStatus('verified');
                  else {
                    setStatus('error');
                    setError(r.error ?? 'Failed');
                  }
                });
              });
            }}
            className="rounded bg-success px-3 py-1 font-mono uppercase tracking-wide text-success-foreground disabled:opacity-50">
            {pending ? 'Saving…' : 'Verify'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setMode('rejecting')}
            className="rounded border border-destructive px-3 py-1 font-mono uppercase tracking-wide text-destructive disabled:opacity-50">
            Reject
          </button>
        </div>
      )}

      {mode === 'rejecting' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) return;
            const formData = new FormData();
            formData.set('achievementId', achievementId);
            formData.set('reason', reason.trim());
            startTransition(() => {
              rejectAchievement(formData).then((r) => {
                if (r.ok) setStatus('rejected');
                else {
                  setStatus('error');
                  setError(r.error ?? 'Failed');
                }
              });
            });
          }}
          className="flex flex-col gap-1.5">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why the evidence doesn't support this row (required)"
            rows={3}
            className="w-full rounded border border-border bg-background p-1.5 text-xs text-foreground placeholder:text-muted-foreground"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setMode('idle')}
              className="rounded border border-border px-2 py-1 font-mono uppercase tracking-wide text-muted-foreground">
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || !reason.trim()}
              className="rounded bg-destructive px-3 py-1 font-mono uppercase tracking-wide text-destructive-foreground disabled:opacity-50">
              {pending ? 'Saving…' : 'Confirm reject'}
            </button>
          </div>
        </form>
      )}

      {status === 'error' && <p className="text-right text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Bulk-verify everything matching the current filter. Two-step confirm so a
 * stray click can't flip thousands of rows.
 */
export function BulkVerifyForm({
  jurisdiction,
  plankNumber,
  matching,
}: {
  jurisdiction?: 'FEDERAL' | 'CA';
  plankNumber?: number;
  matching: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const scope = [jurisdiction ?? 'all jurisdictions', plankNumber ? `plank ${plankNumber}` : 'all planks'].join(' · ');

  if (result) {
    return <p className="font-mono text-xs text-muted-foreground">{result}</p>;
  }

  return (
    <div className="flex items-center gap-2">
      {!confirming ? (
        <button
          type="button"
          disabled={pending || matching === 0}
          onClick={() => setConfirming(true)}
          className="rounded border border-border px-3 py-1 font-mono text-xs uppercase tracking-wide text-muted-foreground disabled:opacity-50">
          Bulk verify {matching} row{matching === 1 ? '' : 's'}…
        </button>
      ) : (
        <>
          <span className="text-xs text-muted-foreground">
            Verify all {matching} queued rows ({scope}) under your name?
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const formData = new FormData();
              if (jurisdiction) formData.set('jurisdiction', jurisdiction);
              if (plankNumber) formData.set('plankNumber', String(plankNumber));
              startTransition(() => {
                bulkVerifyFiltered(formData).then((r) => {
                  setResult(r.ok ? `✓ Bulk-verified ${r.count ?? 0} row(s)` : `Failed: ${r.error}`);
                });
              });
            }}
            className="rounded bg-destructive px-3 py-1 font-mono text-xs uppercase tracking-wide text-destructive-foreground disabled:opacity-50">
            {pending ? 'Verifying…' : 'Yes, verify all'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(false)}
            className="rounded border border-border px-3 py-1 font-mono text-xs uppercase tracking-wide text-muted-foreground">
            Cancel
          </button>
        </>
      )}
    </div>
  );
}
