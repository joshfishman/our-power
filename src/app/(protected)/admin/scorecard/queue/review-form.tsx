'use client';

import { useState, useTransition } from 'react';
import { saveReview } from './actions';

export function ReviewForm({
  voteId,
  currentPlanks,
  currentAligned,
}: {
  voteId: string;
  currentPlanks: number[];
  currentAligned: 'YES' | 'NO' | null;
}) {
  const [planks, setPlanks] = useState<Set<number>>(new Set(currentPlanks));
  const [aligned, setAligned] = useState<'YES' | 'NO' | 'NONE'>(currentAligned ?? 'NONE');
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  const togglePlank = (p: number) => {
    setPlanks((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData();
        formData.set('voteId', voteId);
        formData.set('plankNumbers', [...planks].sort().join(','));
        formData.set('alignedPosition', aligned);
        startTransition(() => {
          saveReview(formData).then((r) => setStatus(r.ok ? 'saved' : 'error'));
        });
      }}
      className="flex w-72 flex-col gap-2 rounded border border-accent bg-secondary p-3 text-xs text-foreground">
      <div>
        <p className="font-mono uppercase tracking-wide">Planks</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {[1, 2, 3, 4, 5].map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => togglePlank(p)}
              className={`rounded border px-2 py-0.5 ${
                planks.has(p)
                  ? 'border-accent bg-accent font-bold text-accent-foreground'
                  : 'border-border bg-transparent'
              }`}>
              P{p}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="font-mono uppercase tracking-wide">Aligned position</p>
        <div className="mt-1 flex gap-1">
          {(['YES', 'NO', 'NONE'] as const).map((v) => (
            <button
              type="button"
              key={v}
              onClick={() => setAligned(v)}
              className={`rounded border px-2 py-0.5 ${
                aligned === v
                  ? 'border-accent bg-accent font-bold text-accent-foreground'
                  : 'border-border bg-transparent'
              }`}>
              {v}
            </button>
          ))}
        </div>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded bg-accent px-3 py-1 font-mono uppercase tracking-wide text-accent-foreground disabled:opacity-50">
        {pending ? 'Saving…' : status === 'saved' ? '✓ Saved' : 'Approve / save'}
      </button>
      {status === 'error' && <p className="text-destructive">Failed to save</p>}
    </form>
  );
}
