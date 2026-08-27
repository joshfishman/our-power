'use client';

import Link from 'next/link';
import { useState, useMemo } from 'react';
import { LegislatorAvatar } from '@/components/scorecard/LegislatorAvatar';

const PARTY_LABEL: Record<string, string> = {
  D: 'Democrat',
  R: 'Republican',
  I: 'Independent',
};

const CORPORATE_PAC_THRESHOLD = 0.05;

export interface PacRow {
  id: string;
  bioguideId: string | null;
  openStatesId: string | null;
  fullName: string;
  chamber: string;
  state: string;
  district: number | null;
  party: string;
  photoUrl: string | null;
  /** v1.4 combined ratio (direct + IE for + IE vs opponents) / adjusted total. 0.0–1.0. Null when not yet computed. */
  pct: number; // combinedCorporateRatio if available, else corporatePacPercentage
  corpAmount: number;
  totalReceipts: number;
  // v1.4 IE breakdown (all in dollars; 0 when not yet ingested)
  ieSupport: number;
  ieAgainstOpponent: number;
  ieAttacking: number;
}

type SortKey =
  | 'rank'
  | 'name'
  | 'party'
  | 'pct'
  | 'receipts'
  | 'corpAmount'
  | 'ieSupport'
  | 'ieAgainstOpponent'
  | 'ieAttacking';
type SortDir = 'asc' | 'desc';

interface Props {
  rows: PacRow[];
  hideStateColumn?: boolean; // CA view doesn't need a state column — they're all CA
}

/** Client-side sortable PAC table. Click any column header to toggle the
 *  sort. Default order is corporate-PAC % ascending (lowest = refusers
 *  at top). Pct column is colored green when under the 5% threshold and
 *  red when over — direct visual signal for "refusing corporate money" vs
 *  "relying on it." */
export function PacSortableTable({ rows, hideStateColumn = false }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('pct');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.fullName.localeCompare(b.fullName);
          break;
        case 'party':
          // Sort by party then state for readable grouping.
          cmp = a.party.localeCompare(b.party) || a.state.localeCompare(b.state);
          break;
        case 'pct':
          cmp = a.pct - b.pct;
          break;
        case 'receipts':
          cmp = a.totalReceipts - b.totalReceipts;
          break;
        case 'corpAmount':
          cmp = a.corpAmount - b.corpAmount;
          break;
        case 'ieSupport':
          cmp = a.ieSupport - b.ieSupport;
          break;
        case 'ieAgainstOpponent':
          cmp = a.ieAgainstOpponent - b.ieAgainstOpponent;
          break;
        case 'ieAttacking':
          cmp = a.ieAttacking - b.ieAttacking;
          break;
        case 'rank':
        default:
          // Rank is derived from pct ascending — treat same as pct.
          cmp = a.pct - b.pct;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function handleClick(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Most useful defaults per column.
      setSortDir(key === 'name' || key === 'party' ? 'asc' : key === 'pct' ? 'asc' : 'desc');
      // IE columns: descending by default (largest spender at top).
    }
  }

  const arrow = (key: SortKey) => {
    if (sortKey !== key) return <span className="text-subtle-foreground"> ⇅</span>;
    return <span> {sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const fmt$ = (n: number) => (n > 0 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—');

  return (
    <div className="overflow-x-auto">
      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-border text-left">
            <Th onClick={() => handleClick('rank')}>#{arrow('rank')}</Th>
            <Th onClick={() => handleClick('name')}>Legislator{arrow('name')}</Th>
            <Th onClick={() => handleClick('party')}>
              Party{hideStateColumn ? '' : ' · State'}
              {arrow('party')}
            </Th>
            {/* Contextual: v1.3 direct-only number */}
            <Th onClick={() => handleClick('corpAmount')} align="right">
              Direct corporate{arrow('corpAmount')}
            </Th>
            {/* v1.4 IE columns */}
            <Th onClick={() => handleClick('ieSupport')} align="right" accent>
              Corp IE Supporting{arrow('ieSupport')}
            </Th>
            <Th onClick={() => handleClick('ieAgainstOpponent')} align="right">
              Corp IE vs opponents{arrow('ieAgainstOpponent')}
            </Th>
            <Th onClick={() => handleClick('ieAttacking')} align="right" italic muted>
              Corp IE attacking{arrow('ieAttacking')}
            </Th>
            {/* Primary sort column */}
            <Th onClick={() => handleClick('pct')} align="right" bold>
              % Corporate Donations{arrow('pct')}
            </Th>
            <Th onClick={() => handleClick('receipts')} align="right">
              Total Receipts{arrow('receipts')}
            </Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((l, i) => {
            const passes = l.pct < CORPORATE_PAC_THRESHOLD;
            const idForLink = l.bioguideId ?? l.openStatesId ?? l.id;
            return (
              <tr key={l.id} className="border-b border-border">
                <td className="py-2 pr-4 font-mono text-xs text-subtle-foreground">{i + 1}</td>
                <td className="py-2 pr-4">
                  <Link
                    href={`/scorecard/${encodeURIComponent(idForLink)}`}
                    className="flex items-center gap-2 font-medium text-foreground hover:text-accent hover:underline">
                    <LegislatorAvatar fullName={l.fullName} photoUrl={l.photoUrl} size={32} />
                    <span className="min-w-0">
                      {l.fullName}
                      {l.chamber === 'REP' && l.district != null && (
                        <span className="ml-1 text-xs text-subtle-foreground">CD-{l.district}</span>
                      )}
                    </span>
                  </Link>
                </td>
                <td className="py-2 pr-4 text-muted-foreground">
                  {PARTY_LABEL[l.party] ?? l.party}
                  {!hideStateColumn && <> · {l.state}</>}
                </td>
                {/* Direct corporate (v1.3 contextual) */}
                <td className="py-2 pr-4 text-right font-mono text-xs text-muted-foreground">{fmt$(l.corpAmount)}</td>
                {/* Corp IE Supporting — prominent */}
                <td className="py-2 pr-4 text-right font-mono text-sm font-bold text-accent">{fmt$(l.ieSupport)}</td>
                {/* Corp IE vs opponents */}
                <td className="py-2 pr-4 text-right font-mono text-xs text-muted-foreground">
                  {fmt$(l.ieAgainstOpponent)}
                </td>
                {/* Corp IE attacking — disclosure only, muted italic */}
                <td className="py-2 pr-4 text-right font-mono text-xs italic text-subtle-foreground">
                  {fmt$(l.ieAttacking)}
                </td>
                {/* % Corporate Donations — primary */}
                <td className="py-2 pr-4 text-right">
                  <span
                    className={
                      passes
                        ? 'font-serif text-base font-bold text-accent'
                        : 'font-serif text-base font-bold text-foreground'
                    }>
                    {(l.pct * 100).toFixed(1)}%
                  </span>
                  {passes && (
                    <span className="ml-2 rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent-foreground">
                      ✓
                    </span>
                  )}
                </td>
                <td className="py-2 text-right font-mono text-xs text-muted-foreground">
                  ${l.totalReceipts.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  onClick,
  align = 'left',
  bold = false,
  accent = false,
  italic = false,
  muted = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  align?: 'left' | 'right';
  /** Primary column — render label in bold dark text */
  bold?: boolean;
  /** Accent column — render label in brand red */
  accent?: boolean;
  /** Italic label */
  italic?: boolean;
  /** Muted label — lighter gray */
  muted?: boolean;
}) {
  const colorCls = accent
    ? 'text-accent'
    : muted
    ? 'text-subtle-foreground'
    : bold
    ? 'text-foreground'
    : 'text-subtle-foreground';
  return (
    <th
      className={`cursor-pointer select-none py-2 pr-4 font-mono text-xs uppercase tracking-wide transition-colors hover:text-accent ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${bold ? 'font-bold' : ''} ${italic ? 'italic' : ''} ${colorCls}`}
      onClick={onClick}>
      {children}
    </th>
  );
}
