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
  pct: number; // 0.0 - 1.0
  corpAmount: number;
  totalReceipts: number;
}

type SortKey = 'rank' | 'name' | 'party' | 'pct' | 'receipts';
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
    }
  }

  const arrow = (key: SortKey) => {
    if (sortKey !== key) return <span className="text-gray-400"> ⇅</span>;
    return <span> {sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <table className="mt-6 w-full border-collapse text-sm">
      <thead>
        <tr className="border-b-2 border-gray-900 text-left">
          <Th onClick={() => handleClick('rank')}>#{arrow('rank')}</Th>
          <Th onClick={() => handleClick('name')}>Legislator{arrow('name')}</Th>
          <Th onClick={() => handleClick('party')}>
            Party{hideStateColumn ? '' : ' · State'}
            {arrow('party')}
          </Th>
          <Th onClick={() => handleClick('pct')} align="right">
            Corporate PAC %{arrow('pct')}
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
            <tr key={l.id} className="border-b border-gray-200">
              <td className="py-2 pr-4 font-mono text-xs text-gray-500">{i + 1}</td>
              <td className="py-2 pr-4">
                <Link
                  href={`/scorecard/${encodeURIComponent(idForLink)}`}
                  className="flex items-center gap-2 font-medium text-gray-900 hover:text-[#8B3A3A] hover:underline">
                  <LegislatorAvatar fullName={l.fullName} photoUrl={l.photoUrl} size={32} />
                  <span className="min-w-0">
                    {l.fullName}
                    {l.chamber === 'REP' && l.district != null && (
                      <span className="ml-1 text-xs text-gray-500">CD-{l.district}</span>
                    )}
                  </span>
                </Link>
              </td>
              <td className="py-2 pr-4 text-gray-700">
                {PARTY_LABEL[l.party] ?? l.party}
                {!hideStateColumn && <> · {l.state}</>}
              </td>
              <td className="py-2 pr-4 text-right">
                <span
                  className={
                    passes
                      ? 'font-serif text-base font-bold text-green-600 dark:text-green-400'
                      : 'font-serif text-base font-bold text-red-600 dark:text-red-400'
                  }>
                  {(l.pct * 100).toFixed(1)}%
                </span>
                {passes && (
                  <span className="ml-2 rounded bg-green-600 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white">
                    ✓
                  </span>
                )}
              </td>
              <td className="py-2 pr-4 text-right font-mono text-xs text-gray-600">
                ${l.totalReceipts.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                <span className="ml-1 text-gray-400">
                  (${l.corpAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} corp)
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Th({
  children,
  onClick,
  align = 'left',
}: {
  children: React.ReactNode;
  onClick: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={`cursor-pointer select-none py-2 pr-4 font-mono text-xs uppercase tracking-wide text-gray-500 transition-colors hover:text-[#8B3A3A] ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
      onClick={onClick}>
      {children}
    </th>
  );
}
