// scripts/ingest-cal-access.ts
//
// Phase 3 California PAC ingestion.
//
// Two input modes:
//
//   1. Curated CSV (recommended for first-pass CA data):
//        --csv=path/to/file.csv
//      Header row required:
//        openStatesId,cycleYear,corporatePacAmount,totalReceipts,sourceUrl
//      Each row writes one PacMoneyData record. Use the CalMatters or
//      Cal-Access committee summary page URL as `sourceUrl` so reviewers
//      can audit the entry.
//
//   2. CCDC Big Local News bulk CSVs (target for full coverage):
//        --ccdc-dir=path/to/calaccess-extracted
//      Walks the CCDC processed CSV exports — specifically Form 460
//      receipts (Statement of Receipts and Expenditures) joined against
//      filer/committee tables — and rolls up corporate vs non-corporate
//      contributions per candidate per cycle. Requires `CommitteeClassification`
//      table to be populated for top-N CA committees; un-classified
//      committees default to "non-corporate" rather than corporate, on
//      the methodology principle of conservative attribution.
//
//      CCDC publishes raw Cal-Access tables plus normalized "processed"
//      CSVs at https://calaccess.californiacivicdata.org/downloads/latest/.
//      The bulk path here is a SKELETON pending real Cal-Access data on
//      hand — column positions and join keys are documented inline as
//      TODOs to fill in once a snapshot is downloaded.
//
// All writes use dataSource=CAL_ACCESS_CCDC (the only CA source enum value
// today). The corporate-pac-refusal-ca achievement is recomputed from
// these rows by scripts/compute-scores.ts. Methodology: under-5%
// threshold, same as federal.

import './load-env';

import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { parseCalAccess, type PacAggregate } from '../src/lib/scorecard/calaccess-parser';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

interface CliFlags {
  csvPath: string | null;
  ccdcDir: string | null;
  cycleYear: number;
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    csvPath: null,
    ccdcDir: null,
    cycleYear: 2026,
    dryRun: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--csv=')) flags.csvPath = arg.split('=')[1];
    else if (arg.startsWith('--ccdc-dir=')) flags.ccdcDir = arg.split('=')[1];
    else if (arg.startsWith('--cycle=')) flags.cycleYear = Number(arg.split('=')[1]);
  }
  return flags;
}

interface PacRecord {
  openStatesId: string;
  cycleYear: number;
  corporatePacAmount: number;
  totalReceipts: number;
  sourceUrl: string;
}

async function ingestFromCsv(csvPath: string): Promise<PacRecord[]> {
  const text = await fs.readFile(csvPath, 'utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
  const idx = (col: string) => header.indexOf(col);
  const openStatesIdx = idx('openstatesid');
  const cycleIdx = idx('cycleyear');
  const corpIdx = idx('corporatepacamount');
  const totalIdx = idx('totalreceipts');
  const sourceIdx = idx('sourceurl');

  if ([openStatesIdx, cycleIdx, corpIdx, totalIdx].some((i) => i < 0)) {
    throw new Error(
      `Curated CSV missing required columns. Header must include: openStatesId, cycleYear, corporatePacAmount, totalReceipts, sourceUrl. Got: ${header.join(
        ', ',
      )}`,
    );
  }

  const records: PacRecord[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((s) => s.trim());
    const corp = Number(cells[corpIdx]);
    const total = Number(cells[totalIdx]);
    if (!Number.isFinite(corp) || !Number.isFinite(total) || total <= 0) continue;
    records.push({
      openStatesId: cells[openStatesIdx],
      cycleYear: Number(cells[cycleIdx]),
      corporatePacAmount: corp,
      totalReceipts: total,
      sourceUrl: sourceIdx >= 0 ? cells[sourceIdx] : '',
    });
  }
  return records;
}

/**
 * CCDC bulk path — implemented for the raw CAL-ACCESS .csv exports
 * published via Big Local News. Pass the directory holding the six
 * downloaded files (`rcpt_cd.csv`, `cvr_campaign_disclosure_cd.csv`,
 * `filer_filings_cd.csv`, `filername_cd.csv`, `filer_to_filer_type_cd.csv`,
 * `filer_types_cd.csv`) — only the first two are actively used; the
 * others are kept on disk for future expansion of the classifier.
 *
 * Returns aggregates keyed by (legislatorId, cycleYear). The script then
 * dual-writes via `writeAggregates` (no openStatesId join needed since the
 * parser already resolves legislatorId).
 */
async function ingestFromCcdc(
  dir: string,
  cycleYear: number,
): Promise<{ aggregates: PacAggregate[]; unclassifiedTop: Array<{ name: string; amount: number }> }> {
  const legislators = await prisma.legislator.findMany({
    where: { jurisdiction: 'CA', isActive: true },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      fullName: true,
      chamber: true,
      district: true,
    },
  });

  // Always include the requested cycle plus the previous cycle so the
  // page can fall back to the prior cycle when a new legislator hasn't
  // raised meaningful money yet.
  const cycles = [cycleYear - 2, cycleYear];

  const result = await parseCalAccess(
    dir,
    legislators.map((l) => ({
      id: l.id,
      firstName: l.firstName,
      lastName: l.lastName,
      fullName: l.fullName,
      chamber: l.chamber as 'SEN' | 'REP',
      district: l.district,
    })),
    cycles,
  );

  console.log(
    `[ca-access] aggregates: ${result.aggregates.length} (one per legislator-cycle); legislators matched: ${result.matchedLegislatorCount}/${legislators.length}`,
  );

  return { aggregates: result.aggregates, unclassifiedTop: result.unclassifiedTopContributors };
}

async function writeAggregates(aggregates: PacAggregate[], dryRun: boolean): Promise<number> {
  let written = 0;
  for (const a of aggregates) {
    if (a.totalReceipts <= 0) continue;
    const pct = a.corporatePacAmount / a.totalReceipts;
    if (dryRun) {
      console.log(
        `  [dry-run] legislator=${a.legislatorId} cycle=${a.cycleYear} corp=$${a.corporatePacAmount.toFixed(
          0,
        )} total=$${a.totalReceipts.toFixed(0)} pct=${(pct * 100).toFixed(2)}%`,
      );
      written += 1;
      continue;
    }
    await prisma.pacMoneyData.upsert({
      where: {
        legislatorId_cycleYear_dataSource: {
          legislatorId: a.legislatorId,
          cycleYear: a.cycleYear,
          dataSource: 'CAL_ACCESS_CCDC',
        },
      },
      create: {
        legislatorId: a.legislatorId,
        cycleYear: a.cycleYear,
        corporatePacAmount: a.corporatePacAmount,
        totalReceipts: a.totalReceipts,
        corporatePacPercentage: pct,
        dataSource: 'CAL_ACCESS_CCDC',
        dataSourceUrl: 'https://cal-access.sos.ca.gov/Campaign/Candidates/',
      },
      update: {
        corporatePacAmount: a.corporatePacAmount,
        totalReceipts: a.totalReceipts,
        corporatePacPercentage: pct,
        fetchedAt: new Date(),
      },
    });
    written += 1;
  }
  return written;
}

async function writeRecords(records: PacRecord[], dryRun: boolean): Promise<number> {
  let written = 0;
  for (const r of records) {
    const leg = await prisma.legislator.findUnique({
      where: { openStatesId: r.openStatesId },
      select: { id: true, fullName: true },
    });
    if (!leg) {
      console.warn(`  [skip] no CA legislator for openStatesId=${r.openStatesId}`);
      continue;
    }
    const pct = r.totalReceipts > 0 ? r.corporatePacAmount / r.totalReceipts : 0;
    if (dryRun) {
      console.log(
        `  [dry-run] ${leg.fullName.padEnd(30)} cycle=${r.cycleYear} corp=$${r.corporatePacAmount.toFixed(
          0,
        )} total=$${r.totalReceipts.toFixed(0)} pct=${(pct * 100).toFixed(2)}%`,
      );
      written += 1;
      continue;
    }
    await prisma.pacMoneyData.upsert({
      where: {
        legislatorId_cycleYear_dataSource: {
          legislatorId: leg.id,
          cycleYear: r.cycleYear,
          dataSource: 'CAL_ACCESS_CCDC',
        },
      },
      create: {
        legislatorId: leg.id,
        cycleYear: r.cycleYear,
        corporatePacAmount: r.corporatePacAmount,
        totalReceipts: r.totalReceipts,
        corporatePacPercentage: pct,
        dataSource: 'CAL_ACCESS_CCDC',
        dataSourceUrl: r.sourceUrl,
      },
      update: {
        corporatePacAmount: r.corporatePacAmount,
        totalReceipts: r.totalReceipts,
        corporatePacPercentage: pct,
        dataSourceUrl: r.sourceUrl,
        fetchedAt: new Date(),
      },
    });
    written += 1;
  }
  return written;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-cal-access] flags: ${JSON.stringify(flags)}`);

  if (!flags.csvPath && !flags.ccdcDir) {
    console.error('Specify either --csv=<path> or --ccdc-dir=<path>. See script header for the curated CSV format.');
    process.exit(1);
  }

  let written = 0;
  if (flags.ccdcDir) {
    const { aggregates, unclassifiedTop } = await ingestFromCcdc(flags.ccdcDir, flags.cycleYear);
    console.log(`[ingest-cal-access] parsed ${aggregates.length} aggregate(s) from CCDC bulk`);
    written = await writeAggregates(aggregates, flags.dryRun);
    if (unclassifiedTop.length > 0) {
      console.log('\n[ingest-cal-access] top unclassified committee contributors (review for classifier tuning):');
      for (const u of unclassifiedTop.slice(0, 15)) {
        console.log(`  $${u.amount.toFixed(0).padStart(12)}  ${u.name}`);
      }
    }
  } else if (flags.csvPath) {
    const records = await ingestFromCsv(flags.csvPath);
    console.log(`[ingest-cal-access] parsed ${records.length} record(s) from curated CSV`);
    written = await writeRecords(records, flags.dryRun);
  }

  console.log(`[ingest-cal-access] wrote ${written} PacMoneyData row(s)${flags.dryRun ? ' (dry-run)' : ''}`);

  if (written > 0) {
    console.log('\nNext: npm run scorecard:compute -- --auto-verify --publish --jurisdiction=CA');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

// Avoid unused-import warning when path is not actively used in csv-only path.
void path;
