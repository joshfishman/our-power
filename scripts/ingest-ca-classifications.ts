// One-time-ish bulk classification of CA Cal-Access committees, writing
// to CommitteeClassification (jurisdiction=CA).
//
// Source: filername_cd.csv (the Cal-Access filer roster) — has ~1.3M rows
// covering every entity that has ever filed with the FPPC. We focus on
// filers with FILER_TYPE in ('CTBR' | 'PAYE' | 'OTH' | committee codes)
// that are still active, classify each by name pattern using the same
// classifyCommittee heuristic the existing PAC parser uses, and assign
// a motivationClass for v1.5:
//
//   CORPORATE         → MONEY
//   TRADE_ASSOCIATION → MONEY
//   PARTY             → MONEY
//   IDEOLOGICAL       → MONEY  (default; manual overlay can flip to PEOPLE)
//   LABOR             → PEOPLE
//   CANDIDATE         → skip (candidate-controlled committees aren't outside money)
//   UNCLASSIFIED      → skip (conservative-attribution)
//
// Optional manual overlay CSV (mirrors federal manual format) lets us
// override individual CA filers — same columns as the federal one,
// plus jurisdiction defaults to CA on this script.
//
// Usage:
//   npm run scorecard:ingest-ca-classifications
//   npm run scorecard:ingest-ca-classifications -- --filername=data/calaccess/raw/filername_cd.csv
//   npm run scorecard:ingest-ca-classifications -- --manual-csv=data/manual-ca-classifications.csv
//   npm run scorecard:ingest-ca-classifications -- --dry-run

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse';
import { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { classifyCommittee, type CommitteeClass } from '../src/lib/scorecard/calaccess-parser';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

type Motivation = 'MONEY' | 'PEOPLE';

const CLASS_TO_MOTIVATION: Partial<Record<CommitteeClass, Motivation>> = {
  CORPORATE: 'MONEY',
  TRADE_ASSOCIATION: 'MONEY',
  PARTY: 'MONEY',
  IDEOLOGICAL: 'MONEY', // Default — manual overlay can flip grassroots/membership orgs to PEOPLE
  LABOR: 'PEOPLE',
};

interface CliFlags {
  filernamePath: string;
  manualCsv: string | null;
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    filernamePath: 'data/calaccess/raw/filername_cd.csv',
    manualCsv: null,
    dryRun: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--filername=')) flags.filernamePath = arg.split('=')[1];
    else if (arg.startsWith('--manual-csv=')) flags.manualCsv = arg.split('=')[1];
  }
  return flags;
}

interface ParsedRow {
  committeeId: string; // Cal-Access FILER_ID
  committeeName: string;
  category: Exclude<CommitteeClass, 'CANDIDATE' | 'UNCLASSIFIED'>;
  motivationClass: Motivation;
  sourceNotes: string;
}

async function parseFilernameCsv(filePath: string): Promise<ParsedRow[]> {
  const rows: ParsedRow[] = [];
  // Dedupe by FILER_ID — the file has many rows per filer (one per
  // name-change / status-change event).
  const seenFilerId = new Set<string>();
  return new Promise((resolve, reject) => {
    createReadStream(filePath)
      .pipe(
        parse({
          columns: true,
          quote: '"',
          skip_empty_lines: true,
          trim: true,
          relax_quotes: true,
          relax_column_count: true,
        }),
      )
      .on('data', (row: Record<string, string>) => {
        const filerId = row.FILER_ID?.trim();
        const naml = row.NAML?.trim();
        if (!filerId || !naml) return;
        if (seenFilerId.has(filerId)) return;
        seenFilerId.add(filerId);
        const klass = classifyCommittee(naml);
        if (klass === 'CANDIDATE' || klass === 'UNCLASSIFIED') return;
        const motivation = CLASS_TO_MOTIVATION[klass];
        if (!motivation) return;
        rows.push({
          committeeId: filerId,
          committeeName: naml,
          category: klass,
          motivationClass: motivation,
          sourceNotes: `Cal-Access filername_cd.csv name-heuristic classification: NAML="${naml.replace(/"/g, "'")}"`,
        });
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function parseManualCsv(csvPath: string): Promise<ParsedRow[]> {
  const txt = await fs.readFile(csvPath, 'utf-8');
  const rows: ParsedRow[] = [];
  return new Promise((resolve, reject) => {
    Readable.from(txt)
      .pipe(parse({ columns: true, quote: false, skip_empty_lines: true, trim: true }))
      .on('data', (row: Record<string, string>) => {
        const committeeId = row.committeeId?.trim();
        const committeeName = row.committeeName?.trim();
        const category = row.category?.trim().toUpperCase() as ParsedRow['category'];
        const rawMotivation = row.motivationClass?.trim().toUpperCase();
        const motivationClass: Motivation = rawMotivation === 'PEOPLE' ? 'PEOPLE' : 'MONEY';
        if (!committeeId || !committeeName) return;
        if (!['CORPORATE', 'LABOR', 'IDEOLOGICAL', 'TRADE_ASSOCIATION', 'PARTY'].includes(category)) return;
        rows.push({
          committeeId,
          committeeName,
          category,
          motivationClass,
          sourceNotes: row.sourceNotes?.trim() || `manual CA classification: ${csvPath}`,
        });
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-ca-classifications] flags: ${JSON.stringify(flags)}`);

  const fpath = path.resolve(flags.filernamePath);
  await fs.access(fpath); // throws clear error if missing

  const bulkRows = await parseFilernameCsv(fpath);
  console.log(
    `[ingest-ca-classifications] bulk parsed ${bulkRows.length} classifiable CA committees from filername_cd`,
  );

  let manualRows: ParsedRow[] = [];
  if (flags.manualCsv) {
    manualRows = await parseManualCsv(flags.manualCsv);
    console.log(`[ingest-ca-classifications] manual parsed ${manualRows.length} rows from ${flags.manualCsv}`);
  }

  const byCommitteeId = new Map<string, ParsedRow>();
  for (const r of bulkRows) byCommitteeId.set(r.committeeId, r);
  for (const r of manualRows) byCommitteeId.set(r.committeeId, r); // manual wins
  const merged = [...byCommitteeId.values()];
  console.log(`[ingest-ca-classifications] merged total: ${merged.length} (bulk + manual de-duped)`);

  const catHist = new Map<string, number>();
  const motHist = new Map<string, number>();
  for (const r of merged) {
    catHist.set(r.category, (catHist.get(r.category) ?? 0) + 1);
    motHist.set(r.motivationClass, (motHist.get(r.motivationClass) ?? 0) + 1);
  }
  console.log('  by category:');
  for (const [c, n] of [...catHist.entries()].sort()) console.log(`    ${c}: ${n}`);
  console.log('  by motivationClass:');
  for (const [m, n] of [...motHist.entries()].sort()) console.log(`    ${m}: ${n}`);

  if (flags.dryRun) {
    console.log('[ingest-ca-classifications] DRY RUN — no DB writes');
    await prisma.$disconnect();
    return;
  }

  // Build a Set of manual-overridden IDs once (avoids O(n²) lookup in the loop).
  const manualIds = new Set(manualRows.map((m) => m.committeeId));

  // Bulk upsert via raw SQL — single INSERT ... ON CONFLICT ... DO UPDATE
  // per batch instead of per-row Prisma upserts. Per-row over PgBouncer
  // averaged ~50ms × 29,695 rows = 25 min. A batched VALUES insert with
  // 500 rows in one statement collapses that to ~2 min. The conflict
  // target matches the @@unique([jurisdiction, committeeId]).
  let written = 0;
  const BATCH = 500;
  const now = new Date();
  for (let i = 0; i < merged.length; i += BATCH) {
    const slice = merged.slice(i, i + BATCH);
    // Each row: 8 placeholders (id auto, plus 7 columns + classifiedBy + classifiedAt)
    // Columns: jurisdiction, committeeId, committeeName, category, motivationClass, sourceNotes, classifiedBy, classifiedAt
    const params: unknown[] = [];
    const valuesSql = slice
      .map((r, idx) => {
        const base = idx * 8;
        params.push(
          'CA',
          r.committeeId,
          r.committeeName,
          r.category,
          r.motivationClass,
          r.sourceNotes,
          manualIds.has(r.committeeId) ? 'manual' : 'ca-bulk-heuristic',
          now,
        );
        // cuid() default works at the DB level (Prisma applies via the @id default).
        // Casting jurisdiction to the enum type explicitly avoids implicit-cast issues.
        return `(gen_random_uuid()::text, $${base + 1}::"Jurisdiction", $${base + 2}, $${base + 3}, $${
          base + 4
        }::"CommitteeCategory", $${base + 5}::"MotivationClass", $${base + 6}, $${base + 7}, $${
          base + 8
        }, NOW(), NOW())`;
      })
      .join(',');
    const sql =
      `INSERT INTO "CommitteeClassification" ` +
      `("id", "jurisdiction", "committeeId", "committeeName", "category", "motivationClass", "sourceNotes", "classifiedBy", "classifiedAt", "createdAt", "updatedAt") ` +
      `VALUES ${valuesSql} ` +
      `ON CONFLICT ("jurisdiction", "committeeId") DO UPDATE SET ` +
      `"committeeName" = EXCLUDED."committeeName", ` +
      `"category" = EXCLUDED."category", ` +
      `"motivationClass" = EXCLUDED."motivationClass", ` +
      `"sourceNotes" = EXCLUDED."sourceNotes", ` +
      `"classifiedAt" = EXCLUDED."classifiedAt", ` +
      `"updatedAt" = NOW()`;

    await prisma.$executeRawUnsafe(sql, ...params);
    written += slice.length;
    if (i % 5000 === 0 || written === merged.length) {
      console.log(`[ingest-ca-classifications] upserted ${written}/${merged.length}`);
    }
  }
  console.log(`[ingest-ca-classifications] ✓ wrote ${written} CA CommitteeClassification rows (bulk-upsert path)`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
