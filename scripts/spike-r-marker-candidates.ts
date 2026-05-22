// v1.7.2 Track B spike — Republican-led / bipartisan marker bill candidates.
//
// For each Common Ground plank, search Congress.gov v3 bill list endpoint for
// 119th Congress bills:
//   - sponsored by a Republican
//   - in a policy area relevant to the plank
//   - with 3+ cosponsors (real movement, not lone-wolf bills)
//
// Output: data/r-marker-candidates.md — markdown table per plank with
// candidate bill numbers + title + sponsor + cosponsor count + URL. Human
// reviews and picks which become markers.
//
// Run:
//   npx tsx scripts/spike-r-marker-candidates.ts
//   npx tsx scripts/spike-r-marker-candidates.ts -- --limit=30

import './load-env';
import fs from 'fs';
import path from 'path';

const KEY = process.env.FEC_API_KEY || process.env.FEC_DATA_API!;
const PAUSE_MS = 80;

interface CliFlags {
  limit: number;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { limit: 30 };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--limit=')) flags.limit = Number(arg.split('=')[1]);
  }
  return flags;
}

let lastCallAt = 0;
async function pace(): Promise<void> {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS - elapsed));
  lastCallAt = Date.now();
}

// Plank → search seeds. We use a few targeted bill-title keywords AND any
// policy-area filters Congress.gov exposes. We deliberately skip plank-5
// trade-protection per user direction.
interface PlankSeed {
  plank: number;
  name: string;
  // Keywords to search bill titles for (loosely — Congress.gov matches partial)
  titleKeywords: string[];
  // Optional descriptive note for the output
  note: string;
}

const PLANK_SEEDS: PlankSeed[] = [
  {
    plank: 1,
    name: 'Honest Government',
    titleKeywords: ['stock trading', 'ethics', 'lobbying', 'dark money', 'disclosure', 'PAC', 'corporate contribution'],
    note: 'Stock-trading ban, ethics reform, anti-PAC',
  },
  {
    plank: 2,
    name: 'Our Children Our Future',
    titleKeywords: ['infrastructure', 'broadband', 'clean energy', 'nuclear', 'research', 'STEM', 'rural broadband'],
    note: 'Bipartisan infrastructure, R-led energy/research',
  },
  {
    plank: 3,
    name: 'Making a Living',
    titleKeywords: ['minimum wage', 'paid leave', 'non-compete', 'wage theft', 'apprenticeship', 'workforce'],
    note: 'R wage alternatives, R-led non-compete, paid leave',
  },
  {
    plank: 4,
    name: 'The Care We Owe',
    titleKeywords: [
      'drug pricing',
      'prescription drug',
      'medicare',
      'medicaid',
      'veterans',
      'PACT Act',
      'social security',
    ],
    note: 'R drug pricing (Grassley/Cornyn), veterans, R-defectors on Medicaid',
  },
  {
    plank: 5,
    name: 'Peace and Strength',
    titleKeywords: [
      'war powers',
      'AUMF',
      'pentagon audit',
      'antitrust',
      'big tech',
      'monopoly',
      'Department of Defense audit',
    ],
    note: 'War powers, Pentagon audit (Rand Paul), Vance/Hawley antitrust',
  },
];

interface BillSearchResult {
  congress: number;
  number: string;
  type: string;
  title: string | null;
  url: string | null;
  sponsorParty?: string;
  sponsorName?: string;
  cosponsorCount?: number;
}

interface BillDetail {
  bill: {
    sponsors?: Array<{ party?: string; firstName?: string; lastName?: string; bioguideId?: string }>;
    cosponsors?: { count?: number };
    title?: string;
    policyArea?: { name?: string };
  };
}

async function searchBills(keyword: string, congress: number): Promise<BillSearchResult[]> {
  // Congress.gov v3 doesn't have a true full-text search, but we can use the
  // /bill/{congress} endpoint filtered by `query` parameter. Actually no —
  // the API doesn't take a query param. Best we can do is paginate the full
  // 119th and filter title client-side. That's 30k+ bills though.
  //
  // Compromise: use the /search/ endpoint that DOES support `q=...`.
  // Endpoint: GET /v3/search?q=keyword&format=json
  await pace();
  const url = `https://api.congress.gov/v3/bill/${congress}?api_key=${KEY}&format=json&sort=updateDate+desc&limit=100&fromDateTime=2025-01-01T00:00:00Z`;
  void url;
  // Actually the public api.congress.gov doesn't expose full-text search.
  // We'll take a different tack: pull the most recent N bills (sorted by
  // update date) and filter title client-side for any matches.
  //
  // Cheaper alternative: known-R-sponsors approach — query each well-known
  // R senator's sponsored-legislation feed (Hawley, Vance, Paul, Rubio,
  // Cornyn, Grassley, Massie, etc.) and filter the resulting titles.
  return [];
}
void searchBills;

// Better strategy: for a known list of R legislators we care about, pull
// their sponsored-legislation feed and filter for keywords matching each
// plank.
const KNOWN_RS_TO_SCAN: Array<{ bioguideId: string; name: string }> = [
  // Senate Rs likely to author cross-partisan / common-ground bills
  { bioguideId: 'H001089', name: 'Hawley' },
  { bioguideId: 'V000137', name: 'Vance' },
  { bioguideId: 'P000603', name: 'Rand Paul' },
  { bioguideId: 'R000595', name: 'Rubio' },
  { bioguideId: 'G000386', name: 'Grassley' },
  { bioguideId: 'C001056', name: 'Cornyn' },
  { bioguideId: 'L000575', name: 'Mike Lee' },
  { bioguideId: 'B001310', name: 'Mike Braun' },
  { bioguideId: 'C001113', name: 'Tom Cotton' },
  { bioguideId: 'C001098', name: 'Bill Cassidy' },
  { bioguideId: 'M001183', name: 'Mullin' },
  { bioguideId: 'R000307', name: 'Mike Rounds' },
  { bioguideId: 'M001153', name: 'Murkowski' },
  { bioguideId: 'C001095', name: 'Susan Collins' },
  { bioguideId: 'R000615', name: 'Romney (retired)' },
  // House Rs
  { bioguideId: 'M001184', name: 'Massie' },
  { bioguideId: 'B001302', name: 'Buck (retired)' },
  { bioguideId: 'B001311', name: 'Bice' },
  { bioguideId: 'G000591', name: 'Garbarino' },
  { bioguideId: 'F000470', name: 'Fitzpatrick' },
  { bioguideId: 'L000598', name: 'Lawler' },
  { bioguideId: 'Z000017', name: 'Zinke' },
  { bioguideId: 'N000189', name: 'Norman' },
  { bioguideId: 'B001270', name: 'Buchanan' },
];

interface SponsoredBillRef {
  congress: number;
  number: string;
  type: string;
  title: string | null;
  updateDate?: string;
  policyArea?: string | null;
}

// Resilient fetch — retries on socket close / 5xx with backoff.
async function fetchWithRetry(url: string, label: string, maxRetries = 4): Promise<Response | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
      if (r.status >= 500 || r.status === 429) {
        const delay = 500 * Math.pow(2, attempt);
        console.warn(`  HTTP ${r.status} for ${label} attempt ${attempt + 1} — retrying in ${delay}ms`);
        await new Promise((res) => setTimeout(res, delay));
        continue;
      }
      console.warn(`  HTTP ${r.status} for ${label} — giving up`);
      return null;
    } catch (err) {
      const delay = 500 * Math.pow(2, attempt);
      console.warn(
        `  fetch error for ${label} attempt ${attempt + 1}: ${(err as Error).message.slice(
          0,
          80,
        )} — retrying in ${delay}ms`,
      );
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  return null;
}

async function fetchSponsoredBills(bioguideId: string): Promise<SponsoredBillRef[]> {
  const all: SponsoredBillRef[] = [];
  let offset = 0;
  const limit = 100;
  for (let pages = 0; pages < 3; pages += 1) {
    await pace();
    const url = `https://api.congress.gov/v3/member/${bioguideId}/sponsored-legislation?api_key=${KEY}&format=json&limit=${limit}&offset=${offset}`;
    const r = await fetchWithRetry(url, `member/${bioguideId} p=${pages}`);
    if (!r) break;
    const j = (await r.json()) as {
      sponsoredLegislation?: Array<{
        congress: number;
        number: string;
        type: string;
        title: string | null;
        latestAction?: { actionDate?: string };
        policyArea?: { name?: string };
      }>;
    };
    const batch = j.sponsoredLegislation ?? [];
    for (const b of batch) {
      if (b.congress !== 119) continue; // only 119th
      all.push({
        congress: b.congress,
        number: b.number,
        type: b.type,
        title: b.title ?? null,
        updateDate: b.latestAction?.actionDate,
        policyArea: b.policyArea?.name ?? null,
      });
    }
    if (batch.length < limit) break;
    offset += limit;
  }
  return all;
}

async function enrichBill(
  congress: number,
  type: string,
  num: string,
): Promise<{ cosponsorCount: number; policyArea: string | null }> {
  await pace();
  const url = `https://api.congress.gov/v3/bill/${congress}/${type.toLowerCase()}/${num}?api_key=${KEY}&format=json`;
  const r = await fetchWithRetry(url, `bill/${type}/${num}`);
  if (!r) return { cosponsorCount: 0, policyArea: null };
  const j = (await r.json()) as BillDetail;
  return {
    cosponsorCount: j.bill?.cosponsors?.count ?? 0,
    policyArea: j.bill?.policyArea?.name ?? null,
  };
}

function bestPlankForBill(title: string, policyArea: string | null): number | null {
  // Strict-ish title matching against each plank's seed keywords. Returns the
  // highest-scoring plank or null if none match.
  const t = (title + ' ' + (policyArea ?? '')).toLowerCase();
  for (const seed of PLANK_SEEDS) {
    for (const kw of seed.titleKeywords) {
      if (t.includes(kw.toLowerCase())) return seed.plank;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(
    `[spike-r-marker-candidates] scanning ${KNOWN_RS_TO_SCAN.length} R legislators (limit per plank = ${flags.limit})\n`,
  );

  // Plank → array of candidates
  const byPlank = new Map<
    number,
    Array<{ bill: SponsoredBillRef; sponsor: string; cosponsors: number; policyArea: string | null }>
  >();
  for (const seed of PLANK_SEEDS) byPlank.set(seed.plank, []);

  for (const r of KNOWN_RS_TO_SCAN) {
    const bills = await fetchSponsoredBills(r.bioguideId);
    if (bills.length === 0) {
      console.log(`  ${r.name} (${r.bioguideId}): no 119th bills`);
      continue;
    }
    let plankHits = 0;
    for (const b of bills) {
      if (!b.title) continue;
      const plank = bestPlankForBill(b.title, b.policyArea ?? null);
      if (plank === null) continue;
      const detail = await enrichBill(b.congress, b.type, b.number);
      if (detail.cosponsorCount < 3) continue;
      byPlank
        .get(plank)!
        .push({ bill: b, sponsor: r.name, cosponsors: detail.cosponsorCount, policyArea: detail.policyArea });
      plankHits += 1;
    }
    console.log(`  ${r.name}: ${bills.length} sponsored, ${plankHits} matched a plank with 3+ cosponsors`);
  }

  // Sort each plank's candidates by cosponsor count desc
  const lines: string[] = [];
  lines.push('# v1.7.2 — Republican marker bill candidates\n');
  lines.push(
    `Generated ${new Date().toISOString()}.  Scanned ${
      KNOWN_RS_TO_SCAN.length
    } R legislators' 119th-Congress sponsored bills.\n`,
  );
  lines.push(`Filter: ≥3 cosponsors, title matches plank keywords.  Skipped: trade-protection (per user direction).\n`);
  for (const seed of PLANK_SEEDS) {
    lines.push(`\n## Plank ${seed.plank} — ${seed.name}`);
    lines.push(`_${seed.note}_\n`);
    const candidates = byPlank.get(seed.plank) ?? [];
    candidates.sort((a, b) => b.cosponsors - a.cosponsors);
    const top = candidates.slice(0, flags.limit);
    if (top.length === 0) {
      lines.push('_no candidates found_');
      continue;
    }
    lines.push('| Bill | Title | Sponsor | Cosponsors | Policy Area | URL |');
    lines.push('|---|---|---|---:|---|---|');
    for (const c of top) {
      const billRef = `${c.bill.type}/${c.bill.number}`;
      const title = (c.bill.title ?? '').replace(/\|/g, '\\|').slice(0, 100);
      const url = `https://www.congress.gov/bill/${c.bill.congress}th-congress/${
        c.bill.type === 'HR' ? 'house-bill' : c.bill.type === 'S' ? 'senate-bill' : c.bill.type.toLowerCase()
      }/${c.bill.number}`;
      lines.push(
        `| ${billRef} | ${title} | ${c.sponsor} | ${c.cosponsors} | ${c.policyArea ?? '—'} | [link](${url}) |`,
      );
    }
  }
  const outPath = path.join(process.cwd(), 'data', 'r-marker-candidates.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'));
  console.log(`\n[spike-r-marker-candidates] wrote candidates to ${outPath}`);
  for (const seed of PLANK_SEEDS) {
    console.log(`  Plank ${seed.plank}: ${(byPlank.get(seed.plank) ?? []).length} candidates`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
