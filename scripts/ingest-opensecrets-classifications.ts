// One-time-ish bulk seed of CommitteeClassification from OpenSecrets'
// publicly-downloadable RealCode CSV.
//
// Usage:
//   npm run scorecard:ingest-opensecrets-classifications
//   npm run scorecard:ingest-opensecrets-classifications -- --csv=path/to/local.csv
//   npm run scorecard:ingest-opensecrets-classifications -- --dry-run

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs/promises';
import https from 'node:https';
import { parse } from 'csv-parse';
import { Readable } from 'node:stream';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

// Documented at https://www.opensecrets.org/open-data/downloads. Update if
// they rotate the URL.
const OPENSECRETS_CSV_URL = 'https://www.opensecrets.org/downloads/crp/CmteIds-current.csv';

interface CliFlags {
  csvPath: string | null;
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { csvPath: null, dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--csv=')) flags.csvPath = arg.split('=')[1];
  }
  return flags;
}

async function fetchCsv(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch ${url}: ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

type Category = 'CORPORATE' | 'LABOR' | 'PARTY' | 'IDEOLOGICAL' | 'CANDIDATE' | 'TRADE_ASSOCIATION';

function mapOpenSecretsToCategory(primCode: string, catName: string): Category | null {
  const cat = catName.toLowerCase();
  if (cat.includes('labor') || cat.includes('union')) return 'LABOR';
  if (cat.includes('party') || cat.includes('committee on political')) return 'PARTY';
  if (cat.includes('candidate')) return 'CANDIDATE';
  if (cat.includes('trade association')) return 'TRADE_ASSOCIATION';
  if (cat.includes('ideolog') || cat.includes('single-issue') || cat.includes('non-connected')) {
    return 'IDEOLOGICAL';
  }
  // RealCode top-level alphabetic prefixes: A-N are business / industry buckets.
  // If we have a primCode and no other category mapped, treat as corporate.
  if (primCode && /^[A-Q]/.test(primCode)) return 'CORPORATE';
  return null;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-opensecrets] flags: ${JSON.stringify(flags)}`);

  const csv = flags.csvPath ? await fs.readFile(flags.csvPath, 'utf-8') : await fetchCsv(OPENSECRETS_CSV_URL);

  console.log(`[ingest-opensecrets] CSV size: ${csv.length} bytes`);

  let mapped = 0;
  let skipped = 0;
  let upserted = 0;

  const parser = Readable.from(csv).pipe(parse({ columns: true, skip_empty_lines: true, relax_column_count: true }));

  for await (const row of parser) {
    const fecCommitteeId = (row.Cmte_ID || row.CMTEID || row.committee_id || '').trim();
    if (!fecCommitteeId) {
      skipped += 1;
      continue;
    }
    const primCode = (row.PrimCode || row.prim_code || '').trim();
    const catName = (row.Catname || row.cat_name || row.category || '').trim();
    const mappedCat = mapOpenSecretsToCategory(primCode, catName);
    if (!mappedCat) {
      skipped += 1;
      continue;
    }
    mapped += 1;
    if (flags.dryRun) continue;
    await prisma.committeeClassification.upsert({
      where: { jurisdiction_committeeId: { jurisdiction: 'FEDERAL', committeeId: fecCommitteeId } },
      create: {
        jurisdiction: 'FEDERAL',
        committeeId: fecCommitteeId,
        committeeName: row.Cmte_Name ?? row.cmte_name ?? '',
        category: mappedCat,
        sourceNotes: 'https://www.opensecrets.org/open-data/downloads',
      },
      update: {
        category: mappedCat,
        committeeName: row.Cmte_Name ?? row.cmte_name ?? '',
        sourceNotes: 'https://www.opensecrets.org/open-data/downloads',
      },
    });
    upserted += 1;
  }

  console.log(
    `[ingest-opensecrets] summary: mapped=${mapped}, upserted=${upserted}, skipped=${skipped}${
      flags.dryRun ? ' (dry-run)' : ''
    }`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
