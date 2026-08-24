'use client';

// PAC scoreboard tables (Top Recipients + Legislators Opposed).
//
// Client component so column headers can be clicked to re-sort. The data
// arrives pre-sorted by total $ desc (default), but each th becomes a button
// that toggles sort direction on the chosen column. Active column shows
// an arrow indicator.

import Link from 'next/link';
import { useState } from 'react';

const PARTY_LABEL: Record<string, string> = { D: 'Democrat', R: 'Republican', I: 'Independent' };

export interface RecipientRow {
  legislatorId: string;
  fullName: string;
  party: string;
  chamber: string;
  state: string;
  district: number | null;
  bioguideId: string | null;
  direct: number;
  ieSupport: number;
  ieOppose: number;
  // v1.7.4: IE this PAC spent against this leg's defeated opponent, credited
  // to this leg. NOT included in `total` (which is FEC-target-attributed only).
  // Surfaced as its own column so the difference between Total and the row sum
  // is obvious to the reader.
  ieBenefit: number;
  total: number;
}

type SortKey = 'name' | 'party' | 'chamber' | 'direct' | 'ieSupport' | 'ieBenefit' | 'total' | 'ieOppose';
type Direction = 'asc' | 'desc';

function compareRecipients(a: RecipientRow, b: RecipientRow, key: SortKey, dir: Direction): number {
  const sign = dir === 'asc' ? 1 : -1;
  switch (key) {
    case 'name':
      return sign * a.fullName.localeCompare(b.fullName);
    case 'party':
      return sign * a.party.localeCompare(b.party);
    case 'chamber': {
      const aKey = `${a.chamber} ${a.state} ${String(a.district ?? 0).padStart(3, '0')}`;
      const bKey = `${b.chamber} ${b.state} ${String(b.district ?? 0).padStart(3, '0')}`;
      return sign * aKey.localeCompare(bKey);
    }
    case 'direct':
      return sign * (a.direct - b.direct);
    case 'ieSupport':
      return sign * (a.ieSupport - b.ieSupport);
    case 'ieBenefit':
      return sign * (a.ieBenefit - b.ieBenefit);
    case 'total':
      return sign * (a.total - b.total);
    case 'ieOppose':
      return sign * (a.ieOppose - b.ieOppose);
    default:
      return 0;
  }
}

interface HeaderProps {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: Direction;
  onClick: (k: SortKey) => void;
  align?: 'left' | 'right';
  className?: string;
}

function SortableTh({ label, sortKey, current, dir, onClick, align = 'left', className = '' }: HeaderProps) {
  const isActive = current === sortKey;
  const arrow = isActive ? (dir === 'asc' ? ' ↑' : ' ↓') : '';
  const alignClass = align === 'right' ? 'text-right' : 'text-left';
  return (
    <th className={`py-2 pr-3 ${alignClass} ${className}`}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`font-mono text-xs uppercase tracking-wide ${
          isActive ? 'text-accent' : 'text-muted-foreground'
        } hover:text-accent`}>
        {label}
        {arrow}
      </button>
    </th>
  );
}

type ChamberFilter = 'ALL' | 'REP' | 'SEN';
type PartyFilter = 'ALL' | 'D' | 'R' | 'I';

interface FilterPillProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function FilterPill({ label, active, onClick }: FilterPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2.5 py-1 font-mono text-xs uppercase tracking-wide transition ${
        active
          ? 'border-accent bg-accent text-accent-foreground'
          : 'border-border bg-surface text-muted-foreground hover:border-accent hover:text-accent'
      }`}>
      {label}
    </button>
  );
}

export function PacRecipientsTable({ rows }: { rows: RecipientRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [dir, setDir] = useState<Direction>('desc');
  const [chamber, setChamber] = useState<ChamberFilter>('ALL');
  const [party, setParty] = useState<PartyFilter>('ALL');

  const handle = (k: SortKey) => {
    if (k === sortKey) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      // For dollar columns default desc (biggest first); for text columns default asc.
      const isDollarCol = k === 'direct' || k === 'ieSupport' || k === 'ieBenefit' || k === 'total' || k === 'ieOppose';
      setDir(isDollarCol ? 'desc' : 'asc');
    }
  };

  const filtered = rows.filter(
    (l) => (chamber === 'ALL' || l.chamber === chamber) && (party === 'ALL' || l.party === party),
  );
  const sorted = [...filtered].sort((a, b) => compareRecipients(a, b, sortKey, dir));

  // Per-filter counts (computed on unfiltered rows so chip labels stay stable).
  const houseCount = rows.filter((l) => l.chamber === 'REP').length;
  const senateCount = rows.filter((l) => l.chamber === 'SEN').length;

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-wide text-subtle-foreground">Chamber:</span>
        <FilterPill label={`All (${rows.length})`} active={chamber === 'ALL'} onClick={() => setChamber('ALL')} />
        <FilterPill label={`House (${houseCount})`} active={chamber === 'REP'} onClick={() => setChamber('REP')} />
        <FilterPill label={`Senate (${senateCount})`} active={chamber === 'SEN'} onClick={() => setChamber('SEN')} />
        <span className="ml-3 font-mono text-xs uppercase tracking-wide text-subtle-foreground">Party:</span>
        <FilterPill label="All" active={party === 'ALL'} onClick={() => setParty('ALL')} />
        <FilterPill label="D" active={party === 'D'} onClick={() => setParty('D')} />
        <FilterPill label="R" active={party === 'R'} onClick={() => setParty('R')} />
        <FilterPill label="I" active={party === 'I'} onClick={() => setParty('I')} />
      </div>
      <p className="mt-2 font-mono text-xs text-subtle-foreground">
        Showing {sorted.length.toLocaleString()} of {rows.length.toLocaleString()} recipients
      </p>
      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-border">
            <th className="py-2 pr-3 text-left font-mono text-xs uppercase tracking-wide text-muted-foreground">#</th>
            <SortableTh label="Legislator" sortKey="name" current={sortKey} dir={dir} onClick={handle} />
            <SortableTh label="Party" sortKey="party" current={sortKey} dir={dir} onClick={handle} />
            <SortableTh label="Chamber · State" sortKey="chamber" current={sortKey} dir={dir} onClick={handle} />
            <SortableTh label="Direct $" sortKey="direct" current={sortKey} dir={dir} onClick={handle} align="right" />
            <SortableTh
              label="IE support $"
              sortKey="ieSupport"
              current={sortKey}
              dir={dir}
              onClick={handle}
              align="right"
            />
            <SortableTh
              label="Indirect $"
              sortKey="ieBenefit"
              current={sortKey}
              dir={dir}
              onClick={handle}
              align="right"
            />
            <SortableTh label="Total" sortKey="total" current={sortKey} dir={dir} onClick={handle} align="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((l, idx) => {
            const slug = l.bioguideId ?? l.legislatorId;
            return (
              <tr key={l.legislatorId} className="border-b border-border hover:bg-surface-elevated">
                <td className="py-1.5 pr-3 font-mono text-xs text-subtle-foreground">{idx + 1}</td>
                <td className="py-1.5 pr-3">
                  <Link href={`/scorecard/${encodeURIComponent(slug)}`} className="text-foreground hover:underline">
                    {l.fullName}
                  </Link>
                </td>
                <td className="py-1.5 pr-3 text-xs text-muted-foreground">{PARTY_LABEL[l.party] ?? l.party}</td>
                <td className="py-1.5 pr-3 text-xs text-muted-foreground">
                  {l.chamber} · {l.state}
                  {l.district != null && l.chamber === 'REP' ? `-${l.district}` : ''}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">${l.direct.toLocaleString()}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                  {l.ieSupport > 0 ? `$${l.ieSupport.toLocaleString()}` : '—'}
                </td>
                <td
                  className="py-1.5 pr-3 text-right tabular-nums text-amber-700"
                  title="Indirect: IE this PAC spent against this legislator's defeated primary/general opponent — they materially benefited, but the FEC filing targeted the opponent, not them.">
                  {l.ieBenefit > 0 ? `$${l.ieBenefit.toLocaleString()}` : '—'}
                </td>
                <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">${l.total.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sorted.length === 0 && (
        <p className="mt-3 text-sm text-subtle-foreground">No recipients match the current filters.</p>
      )}
    </>
  );
}

export function PacOpposedTable({ rows }: { rows: RecipientRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('ieOppose');
  const [dir, setDir] = useState<Direction>('desc');
  const [chamber, setChamber] = useState<ChamberFilter>('ALL');
  const [party, setParty] = useState<PartyFilter>('ALL');

  const handle = (k: SortKey) => {
    if (k === sortKey) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      const isDollarCol = k === 'ieOppose';
      setDir(isDollarCol ? 'desc' : 'asc');
    }
  };

  const filtered = rows.filter(
    (l) => (chamber === 'ALL' || l.chamber === chamber) && (party === 'ALL' || l.party === party),
  );
  const sorted = [...filtered].sort((a, b) => compareRecipients(a, b, sortKey, dir));

  const houseCount = rows.filter((l) => l.chamber === 'REP').length;
  const senateCount = rows.filter((l) => l.chamber === 'SEN').length;

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-wide text-subtle-foreground">Chamber:</span>
        <FilterPill label={`All (${rows.length})`} active={chamber === 'ALL'} onClick={() => setChamber('ALL')} />
        <FilterPill label={`House (${houseCount})`} active={chamber === 'REP'} onClick={() => setChamber('REP')} />
        <FilterPill label={`Senate (${senateCount})`} active={chamber === 'SEN'} onClick={() => setChamber('SEN')} />
        <span className="ml-3 font-mono text-xs uppercase tracking-wide text-subtle-foreground">Party:</span>
        <FilterPill label="All" active={party === 'ALL'} onClick={() => setParty('ALL')} />
        <FilterPill label="D" active={party === 'D'} onClick={() => setParty('D')} />
        <FilterPill label="R" active={party === 'R'} onClick={() => setParty('R')} />
        <FilterPill label="I" active={party === 'I'} onClick={() => setParty('I')} />
      </div>
      <p className="mt-2 font-mono text-xs text-subtle-foreground">
        Showing {sorted.length.toLocaleString()} of {rows.length.toLocaleString()} opposed
      </p>
      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-border">
            <SortableTh label="Legislator" sortKey="name" current={sortKey} dir={dir} onClick={handle} />
            <SortableTh
              label="Party · Chamber · State"
              sortKey="chamber"
              current={sortKey}
              dir={dir}
              onClick={handle}
            />
            <SortableTh
              label="IE against $"
              sortKey="ieOppose"
              current={sortKey}
              dir={dir}
              onClick={handle}
              align="right"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((l) => {
            const slug = l.bioguideId ?? l.legislatorId;
            return (
              <tr key={l.legislatorId} className="border-b border-border">
                <td className="py-1.5 pr-3">
                  <Link href={`/scorecard/${encodeURIComponent(slug)}`} className="text-foreground hover:underline">
                    {l.fullName}
                  </Link>
                </td>
                <td className="py-1.5 pr-3 text-xs text-muted-foreground">
                  {l.party} · {l.chamber} · {l.state}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-red-700">${l.ieOppose.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sorted.length === 0 && (
        <p className="mt-3 text-sm text-subtle-foreground">No matches for the current filters.</p>
      )}
    </>
  );
}
