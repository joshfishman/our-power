// scripts/ingest-usaspending-revenue.ts
//
// Federal REVENUE ingestion for the "Public money, private fortunes" pages
// (/scorecard/power). This is the revenue half of the story — how much the
// federal government actually pays these companies to deliver work — kept
// deliberately separate from subsidies, tax abatements, and loans.
//
// Why USAspending:
//   api.usaspending.gov is the government's own award database, free, and
//   needs no API key. It reports OBLIGATIONS — dollars the government has
//   legally committed on prime contracts — which is the closest public
//   proxy to "revenue this company earns from taxpayers." It is NOT the
//   same as a contract's announced ceiling (which is a spending limit that
//   is often never reached) and NOT the same as the revenue a company
//   recognizes in its 10-K (which follows accounting rules and includes
//   subcontract and non-federal government work).
//
// What this script does NOT do:
//   It writes no database rows. The power pages read hand-curated JSON
//   under src/lib/scorecard/, so this writes a JSON file and nothing else.
//   Even so it honors --dry-run (print, don't write) per repo convention.
//
// Known coverage limits (documented in docs/ideas/billionaire-revenue-research.md):
//   - Classified and intelligence-community awards are largely absent.
//   - Business bought through resellers (Carahsoft, Four Points, ECS) is
//     credited to the reseller, not the vendor — this materially understates
//     AWS's federal business in particular.
//   - Subawards are excluded; these are PRIME obligations only.
//
// Usage:
//   npm run scorecard:ingest-usaspending -- --dry-run
//   npm run scorecard:ingest-usaspending
//   npm run scorecard:ingest-usaspending -- --entity=spacex --start-fy=2020

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fetchWithTimeout } from '../src/lib/fetchWithTimeout';

const USASPENDING_CATEGORY_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_category/recipient/';
const REQUEST_TIMEOUT_MS = 60_000;
const RATE_LIMIT_PAUSE_MS = 400;
const MAX_RETRIES = 4;

/** Prime contract award types (A/B/C/D). Grants and loans are tracked separately. */
const CONTRACT_AWARD_TYPES = ['A', 'B', 'C', 'D'];

const OUTPUT_PATH = 'src/lib/scorecard/usaspending-federal-revenue.json';

/**
 * The companies we follow, and which billionaire profile they belong to.
 *
 * `nameMatches` guards against USAspending's fuzzy recipient search: a search
 * for "AMAZON" happily returns Brazilian forestry NGOs, and a search for
 * "TESLA" returns half a dozen unrelated firms trading on Nikola Tesla's name.
 * We keep only recipients whose name starts with one of these prefixes.
 */
interface EntitySpec {
  key: string;
  /** Billionaire profile slug this company rolls up to. */
  profileSlug: string;
  label: string;
  searchText: string;
  nameMatches: string[];
  /** USAspending recipient-profile page for the dominant entity, used as the citation. */
  recipientUrl?: string;
}

const ENTITIES: EntitySpec[] = [
  {
    key: 'spacex',
    profileSlug: 'musk',
    label: 'SpaceX (Space Exploration Technologies Corp.)',
    searchText: 'SPACE EXPLORATION TECHNOLOGIES',
    nameMatches: ['SPACE EXPLORATION TECHNOLOGIES'],
    recipientUrl: 'https://www.usaspending.gov/recipient/8a3a5525-3218-a488-db0e-4823241ceb90-C/latest',
  },
  {
    key: 'tesla',
    profileSlug: 'musk',
    label: 'Tesla, Inc.',
    searchText: 'TESLA MOTORS',
    nameMatches: ['TESLA MOTORS', 'TESLA, INC', 'TESLA INC'],
  },
  {
    key: 'aws',
    profileSlug: 'bezos',
    label: 'Amazon (AWS and Amazon.com selling entities)',
    searchText: 'AMAZON WEB SERVICES',
    nameMatches: ['AMAZON WEB SERVICES', 'AMAZON.COM', 'AMAZON SERVICES', 'AMAZON DIGITAL'],
    recipientUrl: 'https://www.usaspending.gov/recipient/645df5f2-66e3-8d2b-a612-3bff6ed3da30-C/latest',
  },
  {
    key: 'blueorigin',
    profileSlug: 'bezos',
    label: 'Blue Origin',
    searchText: 'BLUE ORIGIN',
    nameMatches: ['BLUE ORIGIN'],
    recipientUrl: 'https://www.usaspending.gov/recipient/0347a12c-6b74-43ee-1e94-4986e09d6a5e-C/latest',
  },
  {
    key: 'palantir',
    profileSlug: 'thiel',
    label: 'Palantir Technologies',
    searchText: 'PALANTIR',
    nameMatches: ['PALANTIR'],
    recipientUrl: 'https://www.usaspending.gov/recipient/1ea8a9a4-3726-3491-9040-66950bb67606-C/latest',
  },
  {
    key: 'anduril',
    profileSlug: 'thiel',
    label: 'Anduril Industries (Founders Fund is an investor, not the operator)',
    searchText: 'ANDURIL',
    nameMatches: ['ANDURIL'],
    recipientUrl: 'https://www.usaspending.gov/recipient/1869c03a-77bb-b66c-469b-988719bbec4c-C/latest',
  },
  {
    key: 'walmart',
    profileSlug: 'walton',
    label: 'Walmart / Wal-Mart Stores',
    searchText: 'WAL-MART',
    nameMatches: ['WAL-MART', 'WALMART'],
  },
];

interface CliFlags {
  dryRun: boolean;
  startFy: number;
  endFy: number;
  entities: string[];
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false, startFy: 2019, endFy: 2025, entities: [] };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--start-fy=')) flags.startFy = Number(arg.split('=')[1]);
    else if (arg.startsWith('--end-fy=')) flags.endFy = Number(arg.split('=')[1]);
    else if (arg.startsWith('--entity=')) flags.entities = arg.split('=')[1].split(',').filter(Boolean);
  }
  return flags;
}

/** A US federal fiscal year runs Oct 1 of the prior calendar year to Sept 30. */
function fiscalYearRange(fy: number): { start: string; end: string } {
  return { start: `${fy - 1}-10-01`, end: `${fy}-09-30` };
}

interface RecipientRow {
  name: string | null;
  amount: number;
  uei: string | null;
  recipient_id: string | null;
}

async function fetchRecipientTotals(searchText: string, start: string, end: string): Promise<RecipientRow[]> {
  const body = JSON.stringify({
    filters: {
      recipient_search_text: [searchText],
      time_period: [{ start_date: start, end_date: end }],
      award_type_codes: CONTRACT_AWARD_TYPES,
    },
    category: 'recipient',
    limit: 50,
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(
        USASPENDING_CATEGORY_URL,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
        REQUEST_TIMEOUT_MS,
      );
      if (res.status === 429) {
        console.warn('  rate limited by USAspending; sleeping 30s');
        await sleep(30_000);
        continue;
      }
      if (!res.ok) throw new Error(`USAspending returned ${res.status} ${res.statusText}`);
      const json = (await res.json()) as { results?: RecipientRow[] };
      return json.results ?? [];
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES - 1) await sleep(3_000 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function matches(spec: EntitySpec, name: string | null): boolean {
  const upper = (name ?? '').toUpperCase();
  return spec.nameMatches.some((prefix) => upper.startsWith(prefix));
}

interface EntityResult {
  key: string;
  profileSlug: string;
  label: string;
  recipientUrl?: string;
  /** Obligations by federal fiscal year. */
  byFiscalYear: Record<string, number>;
  /** Obligations across the full window USAspending covers (FY2008 onward). */
  cumulative: number;
  /** Recipient entities rolled into the totals, so the match is auditable. */
  matchedRecipients: Array<{ name: string; uei: string | null; amount: number }>;
}

async function run(): Promise<void> {
  const flags = parseFlags(process.argv);
  const selected = flags.entities.length ? ENTITIES.filter((e) => flags.entities.includes(e.key)) : /* all */ ENTITIES;

  if (!selected.length) {
    console.error(`No entities matched --entity=${flags.entities.join(',')}`);
    process.exit(1);
  }

  console.log('USAspending federal revenue ingest');
  console.log(`  fiscal years : FY${flags.startFy}-FY${flags.endFy}`);
  console.log(`  entities     : ${selected.map((e) => e.key).join(', ')}`);
  console.log(`  mode         : ${flags.dryRun ? 'DRY RUN (no file written)' : 'write'}`);
  console.log('');

  const results: EntityResult[] = [];

  for (const spec of selected) {
    console.log(`${spec.key} — ${spec.label}`);
    const byFiscalYear: Record<string, number> = {};

    for (let fy = flags.startFy; fy <= flags.endFy; fy++) {
      const { start, end } = fiscalYearRange(fy);
      const rows = await fetchRecipientTotals(spec.searchText, start, end);
      const kept = rows.filter((r) => matches(spec, r.name));
      const total = kept.reduce((sum, r) => sum + r.amount, 0);
      byFiscalYear[`FY${fy}`] = Math.round(total);
      console.log(`  FY${fy}  ${formatDollars(total).padStart(16)}  (${kept.length} matched recipients)`);
      await sleep(RATE_LIMIT_PAUSE_MS);
    }

    // USAspending's search index starts at FY2008 (2007-10-01).
    const cumulativeRows = await fetchRecipientTotals(spec.searchText, '2007-10-01', `${flags.endFy}-09-30`);
    const cumulativeKept = cumulativeRows.filter((r) => matches(spec, r.name));
    const cumulative = cumulativeKept.reduce((sum, r) => sum + r.amount, 0);
    console.log(`  CUMULATIVE FY2008-FY${flags.endFy}  ${formatDollars(cumulative)}`);
    console.log('');

    results.push({
      key: spec.key,
      profileSlug: spec.profileSlug,
      label: spec.label,
      recipientUrl: spec.recipientUrl,
      byFiscalYear,
      cumulative: Math.round(cumulative),
      matchedRecipients: cumulativeKept.map((r) => ({
        name: r.name ?? '(unnamed)',
        uei: r.uei,
        amount: Math.round(r.amount),
      })),
    });

    await sleep(RATE_LIMIT_PAUSE_MS);
  }

  const payload = {
    _comment:
      'Generated by scripts/ingest-usaspending-revenue.ts. PRIME federal contract obligations from api.usaspending.gov. ' +
      'Obligations are dollars the government has legally committed — not announced contract ceilings, and not a ' +
      "company's recognized 10-K revenue. Excludes subawards, classified programs, and purchases made through resellers.",
    source: 'https://api.usaspending.gov/api/v2/search/spending_by_category/recipient/',
    award_type_codes: CONTRACT_AWARD_TYPES,
    retrieved: new Date().toISOString().slice(0, 10),
    fiscal_years: { start: flags.startFy, end: flags.endFy },
    entities: results,
  };

  if (flags.dryRun) {
    console.log('DRY RUN — would write the following to', OUTPUT_PATH);
    console.log(JSON.stringify(payload, null, 1));
    return;
  }

  const outPath = resolve(process.cwd(), OUTPUT_PATH);
  writeFileSync(outPath, `${JSON.stringify(payload, null, 1)}\n`, 'utf8');
  console.log('Wrote', outPath);
}

function formatDollars(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

run().catch((err) => {
  console.error('ingest-usaspending-revenue failed:', err);
  process.exit(1);
});
