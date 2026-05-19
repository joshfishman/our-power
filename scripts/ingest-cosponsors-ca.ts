// v1.7 — extract CA bill sponsors + cosponsors from LegiScan bulk JSONs
// on disk and load into BillCosponsor.
//
// CA "cosponsorship" in LegiScan vocabulary = the `sponsors` array on each bill
// JSON. Roles include primary author (sponsor_type_id=1), principal coauthor
// (sponsor_type_id=2), coauthor (sponsor_type_id=3). For v1.7 scoring we treat
// ALL of these as "cosponsors" — i.e. signals of support — so we ingest every
// sponsor regardless of type. The compute step unions cosponsorship with
// aligned-vote signals at the bill level.
//
// Filter: only bills that appear in our CA RollCallVote universe AND are
// plank-relevant (isScorable + plankNumbers populated). Bills we'd never score
// don't need cosponsor data.
//
// Run:
//   npm run scorecard:ingest-cosponsors-ca
//   npm run scorecard:ingest-cosponsors-ca -- --dry-run --limit=20
//   npm run scorecard:ingest-cosponsors-ca -- --all-bills

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs';
import path from 'path';

// LEGISCAN_DATASET_DIR points at the parent (./data); session dir lives one
// level deeper (./data/2025-2026_Regular_Session). Allow either form.
const RAW_DIR = process.env.LEGISCAN_DATASET_DIR || './data';
const SESSION_DIR_NAME = '2025-2026_Regular_Session';
const DATASET_DIR = RAW_DIR.endsWith(SESSION_DIR_NAME) ? RAW_DIR : path.join(RAW_DIR, SESSION_DIR_NAME);
const CA_CONGRESS = 2025; // we store session-year as congressNumber for CA

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

interface BulkBill {
  bill: {
    bill_number?: string;
    bill_type?: string;
    sponsors?: Array<{ people_id?: number; sponsor_type_id?: number }>;
  };
}

function parseCaBill(billNumber: string): { type: string; num: string } | null {
  // CA bill numbers in our DB are stored as "AB123", "SB45", etc.
  const m = billNumber.match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  return { type: m[1], num: m[2] };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-cosponsors-ca] flags: ${JSON.stringify(flags)}`);

  const billsDir = path.join(DATASET_DIR, 'bill');
  if (!fs.existsSync(billsDir)) {
    console.error(`[ingest-cosponsors-ca] dataset dir missing: ${billsDir}`);
    process.exit(1);
  }

  // CA bills in our roll-call universe — plank-relevant unless --all-bills.
  const whereBill: Record<string, unknown> = {
    chamber: { in: ['CA_ASSEMBLY', 'CA_SENATE'] },
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
  console.log(
    `[ingest-cosponsors-ca] ${unique.length} unique CA bills (filter: ${flags.allBills ? 'all' : 'plank-relevant'})`,
  );

  // Skip bills already ingested unless --force.
  let toFetch = unique.filter((u) => u.billType && u.billNumber);
  if (!flags.force) {
    const existing = await prisma.billCosponsor.findMany({
      where: { jurisdiction: 'CA', congressNumber: CA_CONGRESS },
      select: { billType: true, billNumber: true },
      distinct: ['billType', 'billNumber'],
    });
    const have = new Set(existing.map((e) => `${e.billType}/${e.billNumber}`));
    toFetch = toFetch.filter((u) => !have.has(`${u.billType}/${u.billNumber}`));
    console.log(`[ingest-cosponsors-ca] ${toFetch.length} need ingest (${unique.length - toFetch.length} cached)`);
  }
  if (flags.limit > 0) toFetch = toFetch.slice(0, flags.limit);

  // peopleId → legislatorId (CA only)
  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'CA', legiscanPeopleId: { not: null } },
    select: { id: true, legiscanPeopleId: true },
  });
  const idByPeopleId = new Map<number, string>();
  for (const l of legs) if (l.legiscanPeopleId) idByPeopleId.set(l.legiscanPeopleId, l.id);
  console.log(`[ingest-cosponsors-ca] ${idByPeopleId.size} CA legislators in lookup`);

  interface Row {
    billType: string;
    billNumber: string;
    legislatorId: string;
  }
  const allRows: Row[] = [];
  let foundFile = 0;
  let missingFile = 0;
  let unmapped = 0;
  for (const b of toFetch) {
    // CA bill files are named "AB1.json" — i.e. the bare bill number (which
    // in our schema is stored fully-formed like "AB1", "SB400"). billType is
    // always "CA_BILL" and not part of the filename.
    const baseName = `${b.billNumber}.json`;
    const filePath = path.join(billsDir, baseName);
    if (!fs.existsSync(filePath)) {
      missingFile += 1;
      continue;
    }
    foundFile += 1;
    let json: BulkBill;
    try {
      json = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BulkBill;
    } catch {
      continue;
    }
    const sponsors = json.bill?.sponsors ?? [];
    for (const s of sponsors) {
      if (!s.people_id) continue;
      const legId = idByPeopleId.get(s.people_id);
      if (!legId) {
        unmapped += 1;
        continue;
      }
      allRows.push({ billType: b.billType!, billNumber: b.billNumber!, legislatorId: legId });
    }
  }
  // Dedupe — CA sponsor lists can repeat a person across types (rare).
  const seen = new Set<string>();
  const deduped: Row[] = [];
  for (const r of allRows) {
    const k = `${r.billType}/${r.billNumber}/${r.legislatorId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
  }
  console.log(
    `[ingest-cosponsors-ca] ${foundFile} bills found · ${missingFile} missing files · ${
      deduped.length
    } unique cosponsor rows (${allRows.length - deduped.length} dupes) · ${unmapped} unmapped`,
  );
  allRows.length = 0;
  allRows.push(...deduped);

  if (flags.dryRun) {
    console.log('[ingest-cosponsors-ca] DRY RUN — first 8 rows:');
    for (const r of allRows.slice(0, 8)) {
      console.log(`  ${r.billType}/${r.billNumber}  leg=${r.legislatorId}`);
    }
    await prisma.$disconnect();
    return;
  }

  // Bulk-upsert. Dedupe within batch (a sponsor can rarely repeat — same person
  // listed twice with different sponsor_type_id values shouldn't happen but be
  // defensive: ON CONFLICT will collapse).
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < allRows.length; i += BATCH) {
    const slice = allRows.slice(i, i + BATCH);
    const params: unknown[] = [];
    const values = slice
      .map((r, idx) => {
        const base = idx * 5;
        params.push('CA', CA_CONGRESS, r.billType, r.billNumber, r.legislatorId);
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
  console.log(`[ingest-cosponsors-ca] ✓ ${written} BillCosponsor rows upserted`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
