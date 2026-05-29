// v1.7.6 — Ingest DIME recipient profiles (Adam Bonica, Stanford).
//
// Source: dime_recipients_all_1979_2024.csv (candidate/committee level,
// 1979-2024). Joined to our legislators by FEC candidate id.
//
// Why this exists:
//   Individual-donor money is ~half of all candidate money but the per-
//   employer breakdown is noise (top firm ≈ 2.5% of base). DIME gives
//   WHOLE-BASE funding-character metrics instead:
//     - contributor.cfscore: donor-base ideology (−left / +right). Bonica's
//       signature metric — one number for "who funds this person."
//     - recipient.cfscore: the candidate's own ideology from their funders.
//     - total.unitemized: small-dollar (<$200) money → grassroots vs big-check
//       ratio, computed in the query layer as unitemized / indiv.
//
// Scope: federal House/Senate candidates, cycles 2018/2020/2022/2024,
//   matched to a Legislator by FEC.ID. Most-recent matching cycle wins per
//   (leg, cycle) via upsert.
//
// Usage:
//   npm run scorecard:ingest-dime
//   npm run scorecard:ingest-dime -- --dry-run

import './load-env';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { createId } from '@paralleldrive/cuid2';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const CSV_PATH = path.join(process.cwd(), 'data', 'dime_recipients_all_1979_2024.csv');
const CYCLES = new Set([2018, 2020, 2022, 2024]);

// 0-based column indices (verified against the header).
const COL = {
  cycle: 1,
  name: 5,
  party: 12,
  seat: 14,
  recipientCfscore: 19,
  contributorCfscore: 21,
  totalReceipts: 31,
  totalIndivContribs: 33,
  totalUnitemized: 34,
  totalPacContribs: 35,
  totalPartyContribs: 36,
  recipientType: 48,
  // DIME's "FEC.ID" (idx 54) is the principal COMMITTEE id (C00…). The
  // candidate id that matches our Legislator.fecIds is "Cand.ID" (idx 53).
  candId: 53,
};

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

// Quote-aware CSV line splitter. DIME fields are double-quoted and names
// contain commas ("sanders, bernard"), so a naive split(',') is wrong.
function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      // doubled "" inside a quoted field = literal quote
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQ = !inQ;
      }
    } else if (ch === ',' && !inQ) {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

function num(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function floatOrNull(s: string | undefined): number | null {
  if (s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-dime] flags: ${JSON.stringify(flags)}`);
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Missing ${CSV_PATH}`);
    process.exit(1);
  }

  // 1. FEC cand id → legislatorId (include inactive — defeated challengers too).
  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL' },
    select: { id: true, fecIds: true },
  });
  const fecToLeg = new Map<string, string>();
  for (const l of legs) for (const f of l.fecIds ?? []) fecToLeg.set(f, l.id);
  console.log(`[ingest-dime] ${legs.length} federal legislators, ${fecToLeg.size} FEC ids`);

  // 2. Stream CSV.
  interface Row {
    legislatorId: string;
    cycleYear: number;
    recipientCfscore: number | null;
    contributorCfscore: number | null;
    totalReceipts: number;
    totalIndivContribs: number;
    totalUnitemized: number;
    totalPacContribs: number;
    totalPartyContribs: number;
  }
  // Keep one row per (leg, cycle) — last match wins (rows are unique per
  // cycle anyway, but a candidate can have multiple committee rows; prefer
  // the one with the largest receipts).
  const byKey = new Map<string, Row>();
  let scanned = 0;
  let matched = 0;

  const rl = readline.createInterface({ input: fs.createReadStream(CSV_PATH), crlfDelay: Infinity });
  let isHeader = true;
  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    if (!line) continue;
    scanned += 1;
    if (scanned % 100000 === 0) console.log(`  scanned ${(scanned / 1000).toFixed(0)}K rows, ${matched} matched`);
    const cols = parseCsvLine(line);
    const cycle = num(cols[COL.cycle]);
    if (!CYCLES.has(cycle)) continue;
    const fecId = (cols[COL.candId] ?? '').trim();
    if (!fecId) continue;
    const legId = fecToLeg.get(fecId);
    if (!legId) continue;
    // Only candidate rows (recipient.type 'CAND'), not committee rows.
    const rtype = (cols[COL.recipientType] ?? '').trim().toUpperCase();
    if (rtype && rtype !== 'CAND') continue;

    const row: Row = {
      legislatorId: legId,
      cycleYear: cycle,
      recipientCfscore: floatOrNull(cols[COL.recipientCfscore]),
      contributorCfscore: floatOrNull(cols[COL.contributorCfscore]),
      totalReceipts: num(cols[COL.totalReceipts]),
      totalIndivContribs: num(cols[COL.totalIndivContribs]),
      totalUnitemized: num(cols[COL.totalUnitemized]),
      totalPacContribs: num(cols[COL.totalPacContribs]),
      totalPartyContribs: num(cols[COL.totalPartyContribs]),
    };
    const key = `${legId}|${cycle}`;
    const existing = byKey.get(key);
    // Prefer the row with larger receipts (the real principal-committee row).
    if (!existing || row.totalReceipts > existing.totalReceipts) byKey.set(key, row);
    matched += 1;
  }
  console.log(
    `[ingest-dime] scanned ${scanned.toLocaleString()} rows, ${matched} matched, ${byKey.size} (leg,cycle) profiles`,
  );

  const rows = [...byKey.values()];

  if (flags.dryRun) {
    console.log('\n[DRY RUN] sample profiles:');
    // Show a spread: most-left, most-right donor bases + a few marquee names.
    const withScore = rows.filter((r) => r.contributorCfscore !== null);
    withScore.sort((a, b) => (a.contributorCfscore ?? 0) - (b.contributorCfscore ?? 0));
    const legName = new Map<string, string>();
    const legsFull = await prisma.legislator.findMany({
      where: { id: { in: rows.map((r) => r.legislatorId) } },
      select: { id: true, fullName: true, party: true, state: true },
    });
    for (const l of legsFull) legName.set(l.id, `${l.fullName} (${l.party}-${l.state})`);
    const fmtRow = (r: Row) => {
      const smallPct = r.totalIndivContribs > 0 ? (r.totalUnitemized / r.totalIndivContribs) * 100 : 0;
      return `  ${r.cycleYear} ${(legName.get(r.legislatorId) ?? r.legislatorId).padEnd(34)} donorCf=${(
        r.contributorCfscore ?? 0
      )
        .toFixed(2)
        .padStart(6)}  smallDollar=${smallPct.toFixed(0).padStart(3)}%  indiv=$${(r.totalIndivContribs / 1e6).toFixed(
        1,
      )}M`;
    };
    console.log(' Most LEFT donor bases:');
    for (const r of withScore.slice(0, 5)) console.log(fmtRow(r));
    console.log(' Most RIGHT donor bases:');
    for (const r of withScore.slice(-5).reverse()) console.log(fmtRow(r));
    await prisma.$disconnect();
    return;
  }

  // 3. Bulk upsert.
  console.log('[ingest-dime] writing LegislatorDimeProfile rows…');
  // Clear existing then bulk insert (idempotent re-run).
  await prisma.legislatorDimeProfile.deleteMany({});
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const params2: unknown[] = [];
    const values2 = slice
      .map((r, idx) => {
        const b = idx * 10;
        params2.push(
          createId(),
          r.legislatorId,
          r.cycleYear,
          r.recipientCfscore,
          r.contributorCfscore,
          r.totalReceipts,
          r.totalIndivContribs,
          r.totalUnitemized,
          r.totalPacContribs,
          r.totalPartyContribs,
        );
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::numeric, $${b + 7}::numeric, $${
          b + 8
        }::numeric, $${b + 9}::numeric, $${b + 10}::numeric, NOW(), NOW())`;
      })
      .join(',');
    await prisma.$executeRawUnsafe(
      `INSERT INTO "LegislatorDimeProfile" ` +
        `("id","legislatorId","cycleYear","recipientCfscore","contributorCfscore","totalReceipts","totalIndivContribs","totalUnitemized","totalPacContribs","totalPartyContribs","createdAt","updatedAt") ` +
        `VALUES ${values2} ` +
        `ON CONFLICT ("legislatorId","cycleYear") DO UPDATE SET ` +
        `"recipientCfscore"=EXCLUDED."recipientCfscore","contributorCfscore"=EXCLUDED."contributorCfscore",` +
        `"totalReceipts"=EXCLUDED."totalReceipts","totalIndivContribs"=EXCLUDED."totalIndivContribs",` +
        `"totalUnitemized"=EXCLUDED."totalUnitemized","totalPacContribs"=EXCLUDED."totalPacContribs",` +
        `"totalPartyContribs"=EXCLUDED."totalPartyContribs","updatedAt"=NOW()`,
      ...params2,
    );
    written += slice.length;
    if (written % 2000 === 0 || i + BATCH >= rows.length) console.log(`  upserted ${written}/${rows.length}`);
  }
  console.log(`[ingest-dime] ✓ wrote ${written} LegislatorDimeProfile rows`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
