// v1.7 — fetch federal cosponsor lists for every (billType, billNumber)
// referenced in our RollCallVote universe AND mark-classified as plank-relevant
// (isScorable + alignedPosition + plankNumbers).
//
// Why limit to plank-relevant bills:
//   - We only need cosponsors for bills that actually count in scoring.
//   - Keeps the api.data.gov 1000/hr budget bounded (currently ~350 scorable bills).
//
// Writes to BillCosponsor (id, jurisdiction, congress, billType, billNumber,
// legislatorId, cosponsoredAt). Bulk-upsert via raw SQL.
//
// Run:
//   npm run scorecard:ingest-cosponsors-federal
//   npm run scorecard:ingest-cosponsors-federal -- --dry-run --limit=10
//   npm run scorecard:ingest-cosponsors-federal -- --all-bills   (ignore the
//     plank-relevant filter and fetch cosponsors for every bill in RollCallVote)

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const API_KEY = process.env.FEC_API_KEY || process.env.FEC_DATA_API!;
const PAUSE_MS = 80;
const CONGRESS = 119;

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

interface CliFlags {
  dryRun: boolean;
  limit: number;
  force: boolean;
  allBills: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false, limit: 0, force: false, allBills: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--force') flags.force = true;
    else if (arg === '--all-bills') flags.allBills = true;
    else if (arg.startsWith('--limit=')) flags.limit = Number(arg.split('=')[1]);
  }
  return flags;
}

let lastCallAt = 0;
async function pace(): Promise<void> {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS - elapsed));
  lastCallAt = Date.now();
}

interface CosponsorRow {
  bioguideId: string;
  cosponsoredAt: Date | null;
}

async function fetchCosponsors(type: string, num: string): Promise<CosponsorRow[] | null> {
  const typeL = type.toLowerCase();
  const rows: CosponsorRow[] = [];
  // Congress.gov paginates; pageSize 250 max.
  let offset = 0;
  const pageSize = 250;
  // Cap pagination to avoid runaway — biggest bills have ~250 cosponsors max.
  for (let pages = 0; pages < 4; pages += 1) {
    await pace();
    const url = `https://api.congress.gov/v3/bill/${CONGRESS}/${typeL}/${num}/cosponsors?api_key=${API_KEY}&format=json&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) return [];
      if (res.status === 429) {
        console.warn(`  rate limit on ${type}/${num} — sleeping 60s`);
        await new Promise((r) => setTimeout(r, 60_000));
        continue;
      }
      console.warn(`  ${type}/${num}: HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as {
      cosponsors?: Array<{ bioguideId?: string; sponsorshipDate?: string }>;
      pagination?: { count?: number; next?: string };
    };
    const batch = json.cosponsors ?? [];
    for (const c of batch) {
      if (!c.bioguideId) continue;
      rows.push({
        bioguideId: c.bioguideId,
        cosponsoredAt: c.sponsorshipDate ? new Date(c.sponsorshipDate) : null,
      });
    }
    if (batch.length < pageSize) break;
    offset += pageSize;
    if (!json.pagination?.next) break;
  }
  return rows;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-cosponsors-federal] flags: ${JSON.stringify(flags)}`);

  // Federal bills referenced in RollCallVote — restricted to plank-relevant
  // (isScorable + plankNumbers populated) unless --all-bills.
  const whereBill: Record<string, unknown> = {
    chamber: { in: ['HOUSE', 'SENATE'] },
    billNumber: { not: null },
    billType: { not: null },
  };
  if (!flags.allBills) {
    whereBill.isScorable = true;
    whereBill.plankNumbers = { isEmpty: false };
  }

  const unique = await prisma.rollCallVote.groupBy({
    by: ['billType', 'billNumber'],
    where: whereBill,
    _count: { _all: true },
  });
  console.log(`[ingest-cosponsors-federal] ${unique.length} unique federal bills`);

  // Skip bills we already ingested (any BillCosponsor row for that bill),
  // unless --force.
  let toFetch = unique.filter((u) => u.billType && u.billNumber);
  if (!flags.force) {
    const existing = await prisma.billCosponsor.findMany({
      where: { jurisdiction: 'FEDERAL', congressNumber: CONGRESS },
      select: { billType: true, billNumber: true },
      distinct: ['billType', 'billNumber'],
    });
    const have = new Set(existing.map((e) => `${e.billType}/${e.billNumber}`));
    toFetch = toFetch.filter((u) => !have.has(`${u.billType}/${u.billNumber}`));
    console.log(
      `[ingest-cosponsors-federal] ${toFetch.length} need ingest (${unique.length - toFetch.length} already cached)`,
    );
  }
  if (flags.limit > 0) toFetch = toFetch.slice(0, flags.limit);

  // bioguideId → legislatorId map
  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL', bioguideId: { not: null } },
    select: { id: true, bioguideId: true },
  });
  const idByBioguide = new Map<string, string>();
  for (const l of legs) if (l.bioguideId) idByBioguide.set(l.bioguideId, l.id);
  console.log(`[ingest-cosponsors-federal] ${idByBioguide.size} federal legislators in lookup`);

  interface Row {
    billType: string;
    billNumber: string;
    legislatorId: string;
    cosponsoredAt: Date | null;
  }
  const allRows: Row[] = [];
  let fetched = 0;
  let unmapped = 0;
  let failed = 0;
  for (const b of toFetch) {
    const cosp = await fetchCosponsors(b.billType!, b.billNumber!);
    if (cosp === null) {
      failed += 1;
      continue;
    }
    for (const c of cosp) {
      const legId = idByBioguide.get(c.bioguideId);
      if (!legId) {
        unmapped += 1;
        continue;
      }
      allRows.push({
        billType: b.billType!,
        billNumber: b.billNumber!,
        legislatorId: legId,
        cosponsoredAt: c.cosponsoredAt,
      });
    }
    fetched += 1;
    if (fetched % 25 === 0) {
      console.log(`  fetched ${fetched}/${toFetch.length} bills · ${allRows.length} rows so far`);
    }
  }
  // Dedupe within batch — Congress.gov pagination occasionally returns
  // overlapping pages, and a single bill should produce one row per legislator.
  const seen = new Set<string>();
  const dedupedRows: Row[] = [];
  for (const r of allRows) {
    const k = `${r.billType}/${r.billNumber}/${r.legislatorId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedupedRows.push(r);
  }
  console.log(
    `[ingest-cosponsors-federal] fetched ${fetched} bills · ${dedupedRows.length} unique cosponsor rows (${
      allRows.length - dedupedRows.length
    } dupes) · ${unmapped} unmapped · ${failed} errors`,
  );
  allRows.length = 0;
  allRows.push(...dedupedRows);

  if (flags.dryRun) {
    console.log('[ingest-cosponsors-federal] DRY RUN — first 5 rows:');
    for (const r of allRows.slice(0, 5)) {
      console.log(
        `  ${r.billType}/${r.billNumber}  leg=${r.legislatorId}  date=${r.cosponsoredAt?.toISOString() ?? '—'}`,
      );
    }
    await prisma.$disconnect();
    return;
  }

  // Bulk upsert via raw SQL — 500 rows per statement.
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < allRows.length; i += BATCH) {
    const slice = allRows.slice(i, i + BATCH);
    const params: unknown[] = [];
    const values = slice
      .map((r, idx) => {
        const base = idx * 5;
        params.push('FEDERAL', CONGRESS, r.billType, r.billNumber, r.legislatorId);
        // cosponsoredAt is the 6th param per row
        return `(gen_random_uuid()::text, $${base + 1}::"Jurisdiction", $${base + 2}, $${base + 3}, $${base + 4}, $${
          base + 5
        }, ${r.cosponsoredAt ? `'${r.cosponsoredAt.toISOString()}'::timestamp` : 'NULL'}, NOW())`;
      })
      .join(',');
    const sql =
      `INSERT INTO "BillCosponsor" ` +
      `("id", "jurisdiction", "congressNumber", "billType", "billNumber", "legislatorId", "cosponsoredAt", "createdAt") ` +
      `VALUES ${values} ` +
      `ON CONFLICT ("jurisdiction", "congressNumber", "billType", "billNumber", "legislatorId") DO UPDATE SET ` +
      `"cosponsoredAt" = COALESCE(EXCLUDED."cosponsoredAt", "BillCosponsor"."cosponsoredAt")`;
    await prisma.$executeRawUnsafe(sql, ...params);
    written += slice.length;
  }
  console.log(`[ingest-cosponsors-federal] ✓ ${written} BillCosponsor rows upserted`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
