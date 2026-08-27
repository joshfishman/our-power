import type { PacMoneyTrail, CaMoneyTrail, TopDonor, OutsideMoneySummary } from '@/lib/scorecard/queries';

/**
 * The frozen per-legislator money aggregates stored on `Legislator.moneyCache`.
 *
 * Publish-then-freeze: PacContribution (~1.8M rows, ~646MB) is an ingest-time
 * input, not a runtime dependency. Everything the public pages derive from it
 * is precomputed here by `scripts/freeze-money-cache.ts`, which lets the
 * itemized rows be dropped and re-ingested only when the data is refreshed.
 *
 * `version` guards against a stale shape: bump it whenever a field's MEANING
 * changes, so a cache written by an older methodology is ignored rather than
 * silently served. Read paths treat a mismatched version as a cache miss and
 * fall back to the live query.
 */
export const MONEY_CACHE_VERSION = 1;

export interface FrozenMoneyCache {
  version: number;
  /** ISO timestamp of the freeze, so a page can say how current the money is. */
  frozenAt: string;
  moneyTrail: PacMoneyTrail | null;
  caMoneyTrail: CaMoneyTrail | null;
  topDonors: TopDonor[];
  opposedBy: TopDonor[];
  outsideMoney: OutsideMoneySummary | null;
  pacInfluence20222024: number;
}

/**
 * Reads a frozen cache off a legislator row, or null if absent or written by a
 * different cache version. Anything unparseable is treated as a miss — a wrong
 * number on a public accountability page is worse than a slow one.
 */
export function readMoneyCache(raw: unknown): FrozenMoneyCache | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<FrozenMoneyCache>;
  if (candidate.version !== MONEY_CACHE_VERSION) return null;
  if (typeof candidate.frozenAt !== 'string') return null;
  return candidate as FrozenMoneyCache;
}
