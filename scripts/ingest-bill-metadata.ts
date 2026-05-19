// v1.6 Phase B — fetch + cache Congress.gov bill metadata for every
// unique (billType, billNumber) referenced in RollCallVote rows.
//
// Captures:
//   - title (short title)
//   - policyArea (Congress.gov category, e.g. "Energy", "Education")
//   - subjects (legislative-subject tags)
//   - sponsor party (for direction inference)
//   - summary (CRS bill summary; one paragraph)
//
// All cached on RollCallVote columns to avoid a separate Bill table for
// now (each vote's bill linkage is already in billType/billNumber).
//
// Run: npm run scorecard:ingest-bill-metadata
//      npm run scorecard:ingest-bill-metadata -- --limit=20 --dry-run

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const API_KEY = process.env.FEC_API_KEY || process.env.FEC_DATA_API!;
const PAUSE_MS = 80; // api.data.gov ~1000/hr ceiling

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

interface CliFlags {
  limit: number;
  dryRun: boolean;
  force: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { limit: 0, dryRun: false, force: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--force') flags.force = true;
    else if (arg.startsWith('--limit=')) flags.limit = Number(arg.split('=')[1]);
  }
  return flags;
}

let lastCallAt = 0;
async function pace() {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS - elapsed));
  lastCallAt = Date.now();
}

interface BillMeta {
  title: string;
  policyArea: string | null;
  subjects: string[];
  sponsorParty: string | null; // 'D' / 'R' / 'I' / null
  sponsorBioguide: string | null;
  summary: string | null;
}

async function fetchBill(type: string, num: string): Promise<BillMeta | null> {
  const typeL = type.toLowerCase();
  await pace();
  const url = `https://api.congress.gov/v3/bill/119/${typeL}/${num}?api_key=${API_KEY}&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    bill?: {
      title?: string;
      policyArea?: { name?: string };
      sponsors?: Array<{ bioguideId?: string; party?: string }>;
    };
  };
  const bill = json.bill;
  if (!bill) return null;
  const sponsor = bill.sponsors?.[0];

  // Subjects + summary are separate endpoints. We make those calls only when
  // we have a real bill — total ≤ 3 calls per bill = ~340 * 3 = ~1020 calls.
  await pace();
  const subjectsRes = await fetch(
    `https://api.congress.gov/v3/bill/119/${typeL}/${num}/subjects?api_key=${API_KEY}&format=json&limit=20`,
  );
  const subjects: string[] = [];
  if (subjectsRes.ok) {
    const sj = (await subjectsRes.json()) as { subjects?: { legislativeSubjects?: { name: string }[] } };
    for (const s of sj.subjects?.legislativeSubjects ?? []) subjects.push(s.name);
  }

  await pace();
  const sumRes = await fetch(
    `https://api.congress.gov/v3/bill/119/${typeL}/${num}/summaries?api_key=${API_KEY}&format=json&limit=1`,
  );
  let summary: string | null = null;
  if (sumRes.ok) {
    const sj = (await sumRes.json()) as { summaries?: Array<{ text?: string }> };
    const raw = sj.summaries?.[0]?.text;
    if (raw)
      summary = raw
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1200);
  }

  return {
    title: bill.title ?? '',
    policyArea: bill.policyArea?.name ?? null,
    subjects,
    sponsorParty: sponsor?.party ?? null,
    sponsorBioguide: sponsor?.bioguideId ?? null,
    summary,
  };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-bill-metadata] flags: ${JSON.stringify(flags)}`);

  // Unique (billType, billNumber) pairs from RollCallVote
  const unique = await prisma.rollCallVote.groupBy({
    by: ['billType', 'billNumber'],
    where: { billNumber: { not: null }, billType: { not: null } },
    _count: { _all: true },
  });
  console.log(`[ingest-bill-metadata] ${unique.length} unique bills to fetch`);

  // Skip bills we already have metadata for (any vote with non-null policy area)
  let toFetch = unique;
  if (!flags.force) {
    const existing = await prisma.rollCallVote.findMany({
      where: { billPolicyArea: { not: null } },
      select: { billType: true, billNumber: true },
      distinct: ['billType', 'billNumber'],
    });
    const existingSet = new Set(existing.map((e) => `${e.billType}/${e.billNumber}`));
    toFetch = toFetch.filter((u) => !existingSet.has(`${u.billType}/${u.billNumber}`));
    console.log(
      `[ingest-bill-metadata] ${toFetch.length} need fetching (${unique.length - toFetch.length} already cached)`,
    );
  }

  if (flags.limit > 0) toFetch = toFetch.slice(0, flags.limit);

  // Per-bill fetch + bulk-update via raw SQL
  const updates: Array<{ type: string; number: string; meta: BillMeta }> = [];
  let fetched = 0;
  let failed = 0;
  for (const b of toFetch) {
    if (!b.billType || !b.billNumber) continue;
    const meta = await fetchBill(b.billType, b.billNumber);
    if (!meta) {
      failed += 1;
      continue;
    }
    updates.push({ type: b.billType, number: b.billNumber, meta });
    fetched += 1;
    if (fetched % 25 === 0) {
      console.log(`  fetched ${fetched}/${toFetch.length} bills (${failed} failed)`);
    }
  }
  console.log(`[ingest-bill-metadata] fetched ${fetched} bills (${failed} 404s/errors)`);

  if (flags.dryRun) {
    console.log('[ingest-bill-metadata] DRY RUN — first 5 fetched bills:');
    for (const u of updates.slice(0, 5)) {
      console.log(`  ${u.type}/${u.number}  ${u.meta.policyArea ?? '(no area)'}  ${u.meta.title.slice(0, 80)}`);
      console.log(
        `     sponsor: ${u.meta.sponsorParty ?? '?'}/${u.meta.sponsorBioguide ?? '?'}  subjects: ${u.meta.subjects
          .slice(0, 3)
          .join('; ')}`,
      );
    }
    await prisma.$disconnect();
    return;
  }

  // Bulk-update: one UPDATE per bill via prepared SQL. Updates all RollCallVote
  // rows referencing that (billType, billNumber) — usually 1-5 rows per bill.
  for (const u of updates) {
    await prisma.rollCallVote.updateMany({
      where: { billType: u.type, billNumber: u.number },
      data: {
        billTitle: u.meta.title || null,
        billPolicyArea: u.meta.policyArea,
        billSubjects: u.meta.subjects,
        billSponsorParty: u.meta.sponsorParty,
        billSponsorBioguide: u.meta.sponsorBioguide,
      },
    });
  }
  console.log(`[ingest-bill-metadata] ✓ updated metadata on RollCallVote rows for ${updates.length} bills`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
