// scripts/ingest-pac-data.ts
//
// Phase 3 federal PAC-money ingestion.
//
// Two input modes:
//
//   1. OpenSecrets bulk CSVs (recommended, auditable):
//        --opensecrets-dir=/Users/me/opensecrets-data/2026
//      Expects pipe-delimited bulk files from
//      https://www.opensecrets.org/bulk-data. Specifically:
//        - cands{YY}.txt    candidate-level totals (FEC ID, total receipts)
//        - cmtes{YY}.txt    committee classifications (corporate/labor/etc.)
//        - pacs{YY}{2}.txt  PAC contributions to candidates
//
//   2. Curated CSV (faster for demo, transparent for review):
//        --csv=path/to/file.csv
//      Header row: bioguideId,cycleYear,corporatePacAmount,totalReceipts,sourceUrl
//      Each row writes one PacMoneyData record. Use when OpenSecrets bulk
//      isn't downloaded yet — every row should cite a public source URL
//      (typically the OpenSecrets candidate page) so reviewers can audit.
//
// Both modes write to the same PacMoneyData table with dataSource =
// OPENSECRETS_BULK. The corporate-pac-refusal achievement is recomputed
// from these rows by scripts/compute-scores.ts.

import './load-env';

import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

interface CliFlags {
  opensecretsDir: string | null;
  csvPath: string | null;
  cycleYear: number;
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    opensecretsDir: null,
    csvPath: null,
    cycleYear: 2026,
    dryRun: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--opensecrets-dir=')) flags.opensecretsDir = arg.split('=')[1];
    else if (arg.startsWith('--csv=')) flags.csvPath = arg.split('=')[1];
    else if (arg.startsWith('--cycle=')) flags.cycleYear = Number(arg.split('=')[1]);
  }
  return flags;
}

interface PacRecord {
  bioguideId: string;
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
  const bioguideIdx = idx('bioguideid');
  const cycleIdx = idx('cycleyear');
  const corpIdx = idx('corporatepacamount');
  const totalIdx = idx('totalreceipts');
  const sourceIdx = idx('sourceurl');

  if ([bioguideIdx, cycleIdx, corpIdx, totalIdx].some((i) => i < 0)) {
    throw new Error(
      `Curated CSV missing required columns. Header must include: bioguideId, cycleYear, corporatePacAmount, totalReceipts, sourceUrl. Got: ${header.join(
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
      bioguideId: cells[bioguideIdx],
      cycleYear: Number(cells[cycleIdx]),
      corporatePacAmount: corp,
      totalReceipts: total,
      sourceUrl: sourceIdx >= 0 ? cells[sourceIdx] : '',
    });
  }
  return records;
}

/**
 * Parse OpenSecrets bulk pipe-delimited files for one cycle. The exact
 * field positions are documented in OpenSecrets'
 * https://www.opensecrets.org/resources/dataguide.pdf — this implementation
 * targets the published 2024+ schema. Adjust if the schema shifts in a
 * future cycle.
 */
async function ingestFromOpenSecrets(dir: string, cycleYear: number): Promise<PacRecord[]> {
  const yy = String(cycleYear).slice(-2);
  const candsPath = path.join(dir, `cands${yy}.txt`);
  const cmtesPath = path.join(dir, `cmtes${yy}.txt`);
  const pacsPath = path.join(dir, `pacs${yy}2.txt`); // pacs files are split by chunk; 2 = direct contributions

  for (const p of [candsPath, cmtesPath, pacsPath]) {
    try {
      await fs.access(p);
    } catch {
      throw new Error(
        `OpenSecrets bulk file not found: ${p}. Expected layout: ${dir}/cands${yy}.txt, cmtes${yy}.txt, pacs${yy}2.txt. Download from https://www.opensecrets.org/bulk-data.`,
      );
    }
  }

  // Parse cmtes — committee_id -> primary_code (industry classification).
  // OpenSecrets uses a 5-char "RealCode" system; corporate PACs are those
  // whose primary code begins with a letter A-N (industry sectors), as
  // opposed to 'J' (single-issue ideological), 'K' (party), 'L' (labor),
  // 'Q' (candidate), 'Y' (non-contribution), 'Z' (unclassified).
  // This is OpenSecrets' own corporate-PAC heuristic per their methodology.
  const corporateCommittees = new Set<string>();
  {
    const text = await fs.readFile(cmtesPath, 'utf-8');
    for (const line of text.split(/\r?\n/)) {
      const cells = parseOpenSecretsLine(line);
      if (cells.length < 8) continue;
      // cmtes schema: cycle, cmte_id, name, ..., PrimaryCode at index 7
      const cmteId = cells[1];
      const primaryCode = cells[7];
      if (!cmteId || !primaryCode) continue;
      const sector = primaryCode.charAt(0);
      // A=agribusiness, B=communications/tech, C=construction,
      // D=defense, E=energy/natural-resources, F=finance/insurance/real-estate,
      // G=health, H=lawyers/lobbyists (treat as corp), N=other corp
      // Treat A-H + N as corporate; explicitly exclude L (labor),
      // J (ideological/single-issue), K (party), Q (candidate), Y, Z.
      if (/^[A-HN]/.test(primaryCode)) corporateCommittees.add(cmteId);
    }
  }

  // Parse cands — recipient FEC ID -> total receipts.
  // Bioguide ID isn't directly in OpenSecrets bulk; it links via FEC ID.
  // Caller will look up Legislator.fecIds to resolve.
  const totalReceiptsByFecId = new Map<string, number>();
  {
    const text = await fs.readFile(candsPath, 'utf-8');
    for (const line of text.split(/\r?\n/)) {
      const cells = parseOpenSecretsLine(line);
      if (cells.length < 12) continue;
      // cands schema: cycle, fec_cand_id, cid, first_last_p, party, distid_runfor, distidcurr, currcand, cyclecand, crpico, recipcode, nopacs[, total]
      const fecId = cells[1];
      const total = Number(cells[11] ?? 0);
      if (fecId && Number.isFinite(total)) {
        totalReceiptsByFecId.set(fecId, (totalReceiptsByFecId.get(fecId) ?? 0) + total);
      }
    }
  }

  // Parse pacs — sum corporate PAC contributions per recipient.
  const corporatePacByFecId = new Map<string, number>();
  {
    const text = await fs.readFile(pacsPath, 'utf-8');
    for (const line of text.split(/\r?\n/)) {
      const cells = parseOpenSecretsLine(line);
      if (cells.length < 7) continue;
      // pacs schema: cycle, fecrecno, pac_id, cid, amount, date, recipfecid
      const cmteId = cells[2];
      const recipFecId = cells[6];
      const amount = Number(cells[4] ?? 0);
      if (!cmteId || !recipFecId || !Number.isFinite(amount)) continue;
      if (!corporateCommittees.has(cmteId)) continue;
      corporatePacByFecId.set(recipFecId, (corporatePacByFecId.get(recipFecId) ?? 0) + amount);
    }
  }

  // Look up legislators by FEC ID and assemble PacRecords.
  const legislators = await prisma.legislator.findMany({
    where: { isActive: true, jurisdiction: 'FEDERAL' },
    select: { id: true, bioguideId: true, fecIds: true },
  });

  const records: PacRecord[] = [];
  for (const leg of legislators) {
    if (!leg.bioguideId) continue;
    let totalReceipts = 0;
    let corporatePac = 0;
    for (const fecId of leg.fecIds) {
      totalReceipts += totalReceiptsByFecId.get(fecId) ?? 0;
      corporatePac += corporatePacByFecId.get(fecId) ?? 0;
    }
    if (totalReceipts <= 0) continue;
    records.push({
      bioguideId: leg.bioguideId,
      cycleYear,
      corporatePacAmount: corporatePac,
      totalReceipts,
      sourceUrl: `https://www.opensecrets.org/members-of-congress/summary?cid=${leg.bioguideId}&cycle=${cycleYear}`,
    });
  }
  return records;
}

/** Splits a pipe-delimited OpenSecrets bulk line, stripping the surrounding |"..."| quotes. */
function parseOpenSecretsLine(line: string): string[] {
  if (!line.trim()) return [];
  // OpenSecrets bulk format wraps each value in |"..."|. Tokens are split
  // by `,` between the closing+opening |"..."|"..."|.
  return line
    .replace(/^,/, '')
    .split(/,(?=\|")/)
    .map((cell) => cell.replace(/^\|"/, '').replace(/"\|$/, ''));
}

async function writeRecords(records: PacRecord[], dryRun: boolean): Promise<number> {
  let written = 0;
  for (const r of records) {
    const leg = await prisma.legislator.findUnique({
      where: { bioguideId: r.bioguideId },
      select: { id: true },
    });
    if (!leg) {
      console.warn(`  [skip] no legislator for bioguideId=${r.bioguideId}`);
      continue;
    }
    const pct = r.totalReceipts > 0 ? r.corporatePacAmount / r.totalReceipts : 0;
    if (dryRun) {
      console.log(
        `  [dry-run] ${r.bioguideId} cycle=${r.cycleYear} corp=$${r.corporatePacAmount.toFixed(
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
          dataSource: 'OPENSECRETS_BULK',
        },
      },
      create: {
        legislatorId: leg.id,
        cycleYear: r.cycleYear,
        corporatePacAmount: r.corporatePacAmount,
        totalReceipts: r.totalReceipts,
        corporatePacPercentage: pct,
        dataSource: 'OPENSECRETS_BULK',
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
  console.log(`[ingest-pac-data] flags: ${JSON.stringify(flags)}`);

  if (!flags.opensecretsDir && !flags.csvPath) {
    console.error(
      'Specify either --opensecrets-dir=<path> or --csv=<path>. See script header for the curated CSV format.',
    );
    process.exit(1);
  }

  let records: PacRecord[] = [];
  if (flags.opensecretsDir) {
    records = await ingestFromOpenSecrets(flags.opensecretsDir, flags.cycleYear);
    console.log(`[ingest-pac-data] parsed ${records.length} records from OpenSecrets bulk`);
  } else if (flags.csvPath) {
    records = await ingestFromCsv(flags.csvPath);
    console.log(`[ingest-pac-data] parsed ${records.length} records from curated CSV`);
  }

  const written = await writeRecords(records, flags.dryRun);
  console.log(`[ingest-pac-data] wrote ${written} PacMoneyData row(s)` + (flags.dryRun ? ' (dry-run)' : ''));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
