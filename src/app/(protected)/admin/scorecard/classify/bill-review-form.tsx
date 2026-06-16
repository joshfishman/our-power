'use client';

import { useState, useTransition } from 'react';
import { confirmBill, overrideBill, excludeBill } from './actions';

interface BillKey {
  chamber: string;
  billType: string;
  billNumber: string;
}

export function BillReviewForm({
  billKey,
  currentPlanks,
  currentAligned,
}: {
  billKey: BillKey;
  currentPlanks: number[];
  currentAligned: 'YES' | 'NO' | null;
}) {
  const [planks, setPlanks] = useState<Set<number>>(new Set(currentPlanks));
  const [aligned, setAligned] = useState<'YES' | 'NO' | 'NONE'>(currentAligned ?? 'NONE');
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: 'idle' | 'ok' | 'error'; msg?: string }>({ kind: 'idle' });

  const togglePlank = (p: number) => {
    setPlanks((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const baseFormData = () => {
    const fd = new FormData();
    fd.set('chamber', billKey.chamber);
    fd.set('billType', billKey.billType);
    fd.set('billNumber', billKey.billNumber);
    return fd;
  };

  const run = (action: (fd: FormData) => Promise<{ ok: boolean; error?: string; updated?: number }>, fd: FormData) => {
    startTransition(() => {
      action(fd).then((r) =>
        setStatus(
          r.ok ? { kind: 'ok', msg: `✓ ${r.updated ?? 0} row(s)` } : { kind: 'error', msg: r.error ?? 'Failed' },
        ),
      );
    });
  };

  const onConfirm = () => run(confirmBill, baseFormData());

  const onOverride = () => {
    const fd = baseFormData();
    fd.set('plankNumbers', [...planks].sort((a, b) => a - b).join(','));
    fd.set('alignedPosition', aligned);
    run(overrideBill, fd);
  };

  const onExclude = () => run(excludeBill, baseFormData());

  return (
    <div className="flex w-72 flex-col gap-2 rounded border border-accent bg-secondary p-3 text-xs text-foreground">
      <div>
        <p className="font-mono uppercase tracking-wide">Planks</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {[1, 2, 3, 4, 5].map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => togglePlank(p)}
              className={`rounded border px-2 py-0.5 ${
                planks.has(p) ? 'border-accent bg-accent font-bold text-white' : 'border-border bg-transparent'
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
                aligned === v ? 'border-accent bg-accent font-bold text-white' : 'border-border bg-transparent'
              }`}>
              {v}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="rounded bg-accent px-3 py-1 font-mono uppercase tracking-wide text-white disabled:opacity-50">
          {pending ? 'Working…' : 'Confirm as-is'}
        </button>
        <button
          type="button"
          onClick={onOverride}
          disabled={pending}
          className="rounded border border-accent px-3 py-1 font-mono uppercase tracking-wide text-foreground disabled:opacity-50">
          Override
        </button>
        <button
          type="button"
          onClick={onExclude}
          disabled={pending}
          className="rounded border border-destructive px-3 py-1 font-mono uppercase tracking-wide text-destructive disabled:opacity-50">
          Exclude from scoring
        </button>
      </div>
      {status.kind === 'ok' && <p className="text-foreground">{status.msg}</p>}
      {status.kind === 'error' && <p className="text-destructive">{status.msg}</p>}
    </div>
  );
}
