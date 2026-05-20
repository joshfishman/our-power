// v1.7.2 — fetch sponsor + cosponsor lists for every CA MarkerBill from
// the LegiScan bulk dataset, write into BillCosponsor.
//
// Parallel to ingest-marker-cosponsors.ts (federal). Why a separate script:
//
//   - CA data source is the on-disk LegiScan bulk JSONs, not Congress.gov
//   - CA legislators map via legiscanPeopleId, not bioguideId
//   - CA bill numbers in our schema use a hyphen ("AB-1900"), filenames
//     don't ("AB1900.json")
//   - Some CA marker bills are from prior sessions (AB-2200 CalCare is
//     2023-24) — those won't be in the 2025-26 dataset; we skip them
//     after verifying via legiscanBillId
//
// Output: BillCosponsor rows keyed by (CA, congressNumber, "CA_BILL",
// billNumberWithHyphen, legislatorId). This matches what
// compute-scores-v1.7.ts reads.
//
// Run:
//   npm run scorecard:ingest-marker-cosponsors-ca
//   npm run scorecard:ingest-marker-cosponsors-ca -- --dry-run

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs';
import path from 'path';

const RAW_DIR = process.env.LEGISCAN_DATASET_DIR || './data';
const SESSION_DIR_NAME = '2025-2026_Regular_Session';
const DATASET_DIR = RAW_DIR.endsWith(SESSION_DIR_NAME) ? RAW_DIR : path.join(RAW_DIR, SESSION_DIR_NAME);
const CA_CONGRESS = 2025; // session year stored as congressNumber for CA

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

interface CliFlags {
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
  }
  return flags;
}

interface BulkBill {
  bill: {
    bill_id?: number;
    bill_number?: string;
    sponsors?: Array<{ people_id?: number; sponsor_type_id?: number }>;
  };
}

function fileNameForBillNumber(billNumber: string): string {
  // "AB-1900" → "AB1900.json"
  return billNumber.replace(/-/g, '') + '.json';
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-marker-cosponsors-ca] flags: ${JSON.stringify(flags)}`);

  const billsDir = path.join(DATASET_DIR, 'bill');
  if (!fs.existsSync(billsDir)) {
    console.error(`[ingest-marker-cosponsors-ca] dataset dir missing: ${billsDir}`);
    process.exit(1);
  }

  const markerBills = await prisma.markerBill.findMany({
    where: { marker: { plank: { jurisdiction: 'CA' } } },
    select: { billType: true, billNumber: true, congressNumber: true, billTitle: true, legiscanBillId: true },
  });
  console.log(`[ingest-marker-cosponsors-ca] ${markerBills.length} CA marker bills`);

  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'CA', legiscanPeopleId: { not: null } },
    select: { id: true, legiscanPeopleId: true },
  });
  const idByPeopleId = new Map<number, string>();
  for (const l of legs) if (l.legiscanPeopleId) idByPeopleId.set(l.legiscanPeopleId, l.id);
  console.log(`[ingest-marker-cosponsors-ca] ${idByPeopleId.size} CA legislators in lookup`);

  interface Row {
    congress: number;
    billNumber: string;
    legislatorId: string;
  }
  const allRows: Row[] = [];
  let foundFile = 0;
  let mismatchedId = 0;
  let missingFile = 0;
  let unmapped = 0;

  for (const mb of markerBills) {
    const baseName = fileNameForBillNumber(mb.billNumber);
    const filePath = path.join(billsDir, baseName);
    if (!fs.existsSync(filePath)) {
      console.warn(`  missing file: ${baseName}  (${mb.billTitle?.slice(0, 50)})`);
      missingFile += 1;
      continue;
    }
    let json: BulkBill;
    try {
      json = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BulkBill;
    } catch {
      missingFile += 1;
      continue;
    }
    // Disambiguate prior-session reuse (e.g. AB-2200 in 2025-26 is a
    // different bill from AB-2200 CalCare in 2023-24). If our seed pinned
    // a legiscanBillId and the bulk file's bill_id doesn't match, skip —
    // the bill we want is in a different session.
    if (mb.legiscanBillId !== null && json.bill.bill_id !== mb.legiscanBillId) {
      console.warn(
        `  ${mb.billNumber}: bulk file bill_id=${json.bill.bill_id} != seed legiscanBillId=${mb.legiscanBillId} (prior session?)`,
      );
      mismatchedId += 1;
      continue;
    }
    foundFile += 1;
    const sponsors = json.bill.sponsors ?? [];
    for (const s of sponsors) {
      if (!s.people_id) continue;
      const legId = idByPeopleId.get(s.people_id);
      if (!legId) {
        unmapped += 1;
        continue;
      }
      allRows.push({ congress: mb.congressNumber, billNumber: mb.billNumber, legislatorId: legId });
    }
    console.log(`  ${mb.billNumber}: ${sponsors.length} sponsors+cosponsors · ${(mb.billTitle ?? '').slice(0, 50)}`);
  }

  // Dedupe — a sponsor can rarely appear twice (different sponsor_type_id).
  const seen = new Set<string>();
  const deduped: Row[] = [];
  for (const r of allRows) {
    const k = `${r.congress}/${r.billNumber}/${r.legislatorId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
  }
  console.log(
    `[ingest-marker-cosponsors-ca] ${foundFile} files matched · ${mismatchedId} skipped (prior session) · ${missingFile} missing · ${
      deduped.length
    } unique rows (${allRows.length - deduped.length} dupes) · ${unmapped} unmapped`,
  );

  if (flags.dryRun) {
    console.log('[ingest-marker-cosponsors-ca] DRY RUN — first 8 rows:');
    for (const r of deduped.slice(0, 8)) {
      console.log(`  ${r.congress}/${r.billNumber}  leg=${r.legislatorId}`);
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
        params.push('CA', r.congress, 'CA_BILL', r.billNumber, r.legislatorId);
        return `(gen_random_uuid()::text, $${base + 1}::"Jurisdiction", $${base + 2}, $${base + 3}, $${base + 4}, $${
          base + 5
        }, NULL, NOW())`;
      })
      .join(',');
    const sql =
      `INSERT INTO "BillCosponsor" ` +
      `("id", "jurisdiction", "congressNumber", "billType", "billNumber", "legislatorId", "cosponsoredAt", "createdAt") ` +
      `VALUES ${values} ` +
      `ON CONFLICT ("jurisdiction", "congressNumber", "billType", "billNumber", "legislatorId") DO NOTHING`;
    await prisma.$executeRawUnsafe(sql, ...params);
    written += slice.length;
  }
  console.log(`[ingest-marker-cosponsors-ca] ✓ ${written} BillCosponsor rows upserted`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
