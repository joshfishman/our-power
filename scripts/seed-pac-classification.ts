// v1.7.1 — bulk-seed PacClassification from data/pac-candidates.csv.
//
// CSV → DB upsert by committee_id. The CSV is the human-reviewed source of
// truth; we re-run this whenever the CSV changes. Uses bulk raw SQL because
// Prisma 7's transaction budget can't hold 20K upserts.
//
// Run:
//   npm run scorecard:seed-pac-classification
//   npm run scorecard:seed-pac-classification -- --dry-run

import './load-env';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const CSV_PATH = path.join(process.cwd(), 'data', 'pac-candidates.csv');
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const VALID_CLASSES = new Set([
  'CORPORATE',
  'DARK_MONEY',
  'FOREIGN_POLICY',
  'ACTIVIST',
  'LABOR',
  'LEADERSHIP',
  'IDEOLOGICAL',
  'CONDUIT',
  'UNKNOWN',
]);

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

interface PacRow {
  committeeId: string;
  name: string;
  committeeType: string;
  orgType: string;
  connectedOrg: string;
  proposedClass: string;
  reason: string;
  finalClass: string;
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"' && !inQ) inQ = true;
    else if (ch === '"' && inQ) inQ = false;
    else if (ch === ',' && !inQ) {
      cols.push(cur);
      cur = '';
    } else cur += ch;
  }
  cols.push(cur);
  return cols;
}

function loadCsv(): PacRow[] {
  const text = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = text.split('\n');
  const rows: PacRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 11) continue;
    rows.push({
      committeeId: cols[0],
      name: cols[1],
      committeeType: cols[2],
      orgType: cols[3],
      connectedOrg: cols[4],
      proposedClass: cols[8],
      reason: cols[9],
      finalClass: cols[10],
    });
  }
  return rows;
}

function classifySource(reason: string): string {
  if (reason.startsWith('inline:')) return 'inline';
  if (reason.startsWith('override:')) return 'override';
  if (reason.startsWith('llm:')) return 'llm';
  return 'auto';
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[seed-pac-classification] flags: ${JSON.stringify(flags)}`);
  console.log(`[seed-pac-classification] loading ${CSV_PATH}…`);
  const rows = loadCsv();
  console.log(`[seed-pac-classification] ${rows.length} rows from CSV`);

  // Filter: keep only rows with a valid class. UNKNOWN is a valid class
  // (we still seed it so the UI can show "we don't know yet" honestly).
  const valid = rows.filter((r) => {
    const cls = r.finalClass || r.proposedClass;
    return VALID_CLASSES.has(cls);
  });
  console.log(`[seed-pac-classification] ${valid.length} rows with valid class`);

  // Breakdown
  const counts: Record<string, number> = {};
  for (const r of valid) {
    const cls = r.finalClass || r.proposedClass;
    counts[cls] = (counts[cls] ?? 0) + 1;
  }
  console.log(`[seed-pac-classification] breakdown: ${JSON.stringify(counts)}`);

  if (flags.dryRun) {
    console.log('[seed-pac-classification] DRY RUN — first 5 rows:');
    for (const r of valid.slice(0, 5)) {
      const cls = r.finalClass || r.proposedClass;
      console.log(`  ${r.committeeId}  ${cls.padEnd(15)}  ${r.name.slice(0, 60)}`);
    }
    await prisma.$disconnect();
    return;
  }

  // Bulk upsert via raw SQL. 500 rows per statement to stay under the
  // Postgres pooler's 5s transaction limit.
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < valid.length; i += BATCH) {
    const slice = valid.slice(i, i + BATCH);
    const params: unknown[] = [];
    const values = slice
      .map((r, idx) => {
        const base = idx * 8;
        const cls = r.finalClass || r.proposedClass;
        params.push(
          r.committeeId,
          r.name.slice(0, 200),
          r.committeeType || null,
          r.orgType || null,
          r.connectedOrg.slice(0, 200) || null,
          cls,
          r.reason.slice(0, 500) || null,
          classifySource(r.reason),
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::"PacClass", $${
          base + 7
        }, $${base + 8}, NOW(), NOW())`;
      })
      .join(',');
    const sql =
      `INSERT INTO "PacClassification" ` +
      `("committeeId", "name", "committeeType", "orgType", "connectedOrg", "class", "reason", "source", "createdAt", "updatedAt") ` +
      `VALUES ${values} ` +
      `ON CONFLICT ("committeeId") DO UPDATE SET ` +
      `"name" = EXCLUDED."name", ` +
      `"committeeType" = EXCLUDED."committeeType", ` +
      `"orgType" = EXCLUDED."orgType", ` +
      `"connectedOrg" = EXCLUDED."connectedOrg", ` +
      `"class" = EXCLUDED."class", ` +
      `"reason" = EXCLUDED."reason", ` +
      `"source" = EXCLUDED."source", ` +
      `"updatedAt" = NOW()`;
    await prisma.$executeRawUnsafe(sql, ...params);
    written += slice.length;
    if (written % 5000 === 0 || i + BATCH >= valid.length) {
      console.log(`  upserted ${written}/${valid.length}`);
    }
  }
  console.log(`[seed-pac-classification] ✓ upserted ${written} PacClassification rows`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
