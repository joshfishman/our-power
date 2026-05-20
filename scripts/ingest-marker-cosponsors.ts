// v1.7.1 — fetch complete cosponsor + sponsor lists for every federal
// MarkerBill via Congress.gov, write into BillCosponsor.
//
// Why this exists: BillSponsorship was populated by an older curated ingest
// covering ~264 of 538 federal legislators. v1.7.1 needs complete coverage so
// every leg's marker-slot tally reflects reality. Pre-119th historical markers
// (CHIPS H.R.4346, IIJA H.R.3684, PACT S.3373) are honored — we use the
// MarkerBill.congressNumber to hit the right Congress.gov endpoint.
//
// Output: BillCosponsor rows keyed by (FEDERAL, congressNumber, billType,
// billNumber, legislatorId). billType is normalized to Congress.gov form
// (HR, S, HJRES, SJRES, HRES, SRES, HCONRES, SCONRES). The bill number is the
// bare integer. This matches what `compute-scores-v1.7.ts` reads.
//
// We include the PRIMARY sponsor as a cosponsor row too — for v1.7.1's
// "aligned iff supports this marker" semantics, the bill's lead sponsor is
// the most-aligned signal of all.
//
// Run:
//   npm run scorecard:ingest-marker-cosponsors
//   npm run scorecard:ingest-marker-cosponsors -- --dry-run

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const API_KEY = process.env.FEC_API_KEY || process.env.FEC_DATA_API!;
const PAUSE_MS = 80;

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

interface CliFlags {
  dryRun: boolean;
  force: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false, force: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--force') flags.force = true;
  }
  return flags;
}

// MarkerBill billType → Congress.gov path segment.
const BILL_TYPE_MAP: Record<string, string> = {
  HOUSE_BILL: 'hr',
  SENATE_BILL: 's',
  HOUSE_JOINT_RES: 'hjres',
  SENATE_JOINT_RES: 'sjres',
  HOUSE_CONCURRENT_RES: 'hconres',
  SENATE_CONCURRENT_RES: 'sconres',
  HOUSE_RES: 'hres',
  SENATE_RES: 'sres',
};

// Normalize storage form (what `BillCosponsor` reads in v1.7 compute).
const STORAGE_TYPE_MAP: Record<string, string> = {
  HOUSE_BILL: 'HR',
  SENATE_BILL: 'S',
  HOUSE_JOINT_RES: 'HJRES',
  SENATE_JOINT_RES: 'SJRES',
  HOUSE_CONCURRENT_RES: 'HCONRES',
  SENATE_CONCURRENT_RES: 'SCONRES',
  HOUSE_RES: 'HRES',
  SENATE_RES: 'SRES',
};

function stripBillNumber(raw: string): string | null {
  const m = raw.match(/\d+/);
  return m ? m[0] : null;
}

let lastCallAt = 0;
async function pace(): Promise<void> {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS - elapsed));
  lastCallAt = Date.now();
}

interface PersonRef {
  bioguideId: string;
  sponsorshipDate: Date | null;
}

async function fetchCosponsorsAndSponsor(
  congress: number,
  apiType: string,
  num: string,
): Promise<{ sponsor: PersonRef | null; cosponsors: PersonRef[] } | null> {
  // Sponsor lives on the bill endpoint; cosponsors on the /cosponsors endpoint.
  await pace();
  const billRes = await fetch(
    `https://api.congress.gov/v3/bill/${congress}/${apiType}/${num}?api_key=${API_KEY}&format=json`,
  );
  if (!billRes.ok) {
    if (billRes.status === 404) return { sponsor: null, cosponsors: [] };
    console.warn(`  bill HTTP ${billRes.status} for ${apiType}/${num}`);
    return null;
  }
  const billJson = (await billRes.json()) as {
    bill?: { sponsors?: Array<{ bioguideId?: string; introducedDate?: string }>; introducedDate?: string };
  };
  const s = billJson.bill?.sponsors?.[0];
  const sponsor: PersonRef | null = s?.bioguideId
    ? {
        bioguideId: s.bioguideId,
        sponsorshipDate: billJson.bill?.introducedDate ? new Date(billJson.bill.introducedDate) : null,
      }
    : null;

  // Paginate cosponsors (250-page max).
  const cosponsors: PersonRef[] = [];
  let offset = 0;
  for (let pages = 0; pages < 4; pages += 1) {
    await pace();
    const url = `https://api.congress.gov/v3/bill/${congress}/${apiType}/${num}/cosponsors?api_key=${API_KEY}&format=json&limit=250&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 429) {
        console.warn(`  rate limit on ${apiType}/${num} — sleeping 60s`);
        await new Promise((r) => setTimeout(r, 60_000));
        continue;
      }
      console.warn(`  cosponsors HTTP ${res.status} for ${apiType}/${num}`);
      break;
    }
    const json = (await res.json()) as {
      cosponsors?: Array<{ bioguideId?: string; sponsorshipDate?: string }>;
    };
    const batch = json.cosponsors ?? [];
    for (const c of batch) {
      if (!c.bioguideId) continue;
      cosponsors.push({
        bioguideId: c.bioguideId,
        sponsorshipDate: c.sponsorshipDate ? new Date(c.sponsorshipDate) : null,
      });
    }
    if (batch.length < 250) break;
    offset += 250;
  }
  return { sponsor, cosponsors };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-marker-cosponsors] flags: ${JSON.stringify(flags)}`);

  const markerBills = await prisma.markerBill.findMany({
    where: { marker: { plank: { jurisdiction: 'FEDERAL' } } },
    select: { billType: true, billNumber: true, congressNumber: true, billTitle: true },
  });
  console.log(`[ingest-marker-cosponsors] ${markerBills.length} federal marker bills`);

  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL', bioguideId: { not: null } },
    select: { id: true, bioguideId: true },
  });
  const idByBioguide = new Map<string, string>();
  for (const l of legs) if (l.bioguideId) idByBioguide.set(l.bioguideId, l.id);
  console.log(`[ingest-marker-cosponsors] ${idByBioguide.size} federal legislators in lookup`);

  interface Row {
    congress: number;
    billType: string;
    billNumber: string;
    legislatorId: string;
    cosponsoredAt: Date | null;
  }
  const allRows: Row[] = [];
  let fetched = 0;
  let unmapped = 0;
  let failed = 0;
  for (const mb of markerBills) {
    const apiType = BILL_TYPE_MAP[mb.billType];
    const storageType = STORAGE_TYPE_MAP[mb.billType];
    const num = stripBillNumber(mb.billNumber);
    if (!apiType || !storageType || !num) {
      console.warn(`  skip unrecognized: ${mb.billType}/${mb.billNumber}`);
      failed += 1;
      continue;
    }
    const result = await fetchCosponsorsAndSponsor(mb.congressNumber, apiType, num);
    if (!result) {
      failed += 1;
      continue;
    }
    const people: PersonRef[] = [];
    if (result.sponsor) people.push(result.sponsor);
    for (const c of result.cosponsors) people.push(c);
    for (const p of people) {
      const legId = idByBioguide.get(p.bioguideId);
      if (!legId) {
        unmapped += 1;
        continue;
      }
      allRows.push({
        congress: mb.congressNumber,
        billType: storageType,
        billNumber: num,
        legislatorId: legId,
        cosponsoredAt: p.sponsorshipDate,
      });
    }
    fetched += 1;
    console.log(
      `  ${mb.billType}/${mb.billNumber} (${mb.congressNumber}): ${people.length} sponsors+cosponsors  · ${(
        mb.billTitle ?? ''
      ).slice(0, 50)}`,
    );
  }
  // Dedupe — sponsor may also appear in cosponsors list (rare).
  const seen = new Set<string>();
  const deduped: Row[] = [];
  for (const r of allRows) {
    const k = `${r.congress}/${r.billType}/${r.billNumber}/${r.legislatorId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
  }
  console.log(
    `[ingest-marker-cosponsors] ${fetched} bills · ${deduped.length} unique rows (${
      allRows.length - deduped.length
    } dupes) · ${unmapped} unmapped · ${failed} failed`,
  );

  if (flags.dryRun) {
    console.log('[ingest-marker-cosponsors] DRY RUN — first 8:');
    for (const r of deduped.slice(0, 8)) {
      console.log(`  ${r.congress}/${r.billType}/${r.billNumber}  leg=${r.legislatorId}`);
    }
    await prisma.$disconnect();
    return;
  }

  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < deduped.length; i += BATCH) {
    const slice = deduped.slice(i, i + BATCH);
    const params: unknown[] = [];
    const values = slice
      .map((r, idx) => {
        const base = idx * 5;
        params.push('FEDERAL', r.congress, r.billType, r.billNumber, r.legislatorId);
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
  console.log(`[ingest-marker-cosponsors] ✓ ${written} BillCosponsor rows upserted`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
