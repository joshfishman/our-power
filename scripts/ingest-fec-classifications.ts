// One-time-ish bulk seed of CommitteeClassification (jurisdiction=FEDERAL)
// from the FEC's free Committee Master bulk export (`cm{cycle}.zip`).
//
// Why: OpenSecrets' RealCode CSV requires a free-but-pending registered
// account. FEC's own Committee Master is public + no signup and contains
// `ORG_TP` (organization type) for the ~3,000 "connected" PACs sponsored
// by corporations, labor unions, trade associations, and membership orgs.
// Less coverage than OpenSecrets (super PACs are not classified here —
// their ORG_TP is blank because they're "non-connected"), but enough to
// make federal IE attribution non-zero and v1.4-grade.
//
// What it does:
//   1. Download cm{cycle}.zip from fec.gov (follows the 302 to S3).
//   2. Parse cm.txt (pipe-delimited, no header row).
//   3. Map ORG_TP → CommitteeCategory:
//        C → CORPORATE
//        W → CORPORATE (corp without capital stock)
//        L → LABOR
//        M → IDEOLOGICAL (membership org, e.g. AARP)
//        T → TRADE_ASSOCIATION
//        V → CORPORATE (cooperative, e.g. dairy / electric coops)
//        (blank) → skipped — covers super PACs + many non-connected PACs.
//                  Conservative-attribution rule from the methodology:
//                  if we can't classify it, we don't call it corporate.
//   4. Upsert to CommitteeClassification.
//
// Coverage gap: super PACs (the heavy IE spenders post-Citizens United)
// stay UNCLASSIFIED. To classify those, a hand-curated CSV can be added
// later via `--manual-csv=path/to/super-pacs.csv` (same shape as the
// existing `CmteIds-current.csv` reader — 1 row per committee, columns:
// committeeId,committeeName,category,sourceNotes).
//
// Usage:
//   npm run scorecard:ingest-fec-classifications
//   npm run scorecard:ingest-fec-classifications -- --cycle=2024
//   npm run scorecard:ingest-fec-classifications -- --zip=/tmp/cm26.zip
//   npm run scorecard:ingest-fec-classifications -- --manual-csv=data/manual.csv
//   npm run scorecard:ingest-fec-classifications -- --dry-run

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { parse } from 'csv-parse';
import { Readable } from 'node:stream';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const FEC_BULK_URL = (cycle: number) =>
  `https://www.fec.gov/files/bulk-downloads/${cycle}/cm${String(cycle).slice(2)}.zip`;

type Category = 'CORPORATE' | 'LABOR' | 'IDEOLOGICAL' | 'TRADE_ASSOCIATION' | 'PARTY';
type Motivation = 'MONEY' | 'PEOPLE';

// Strict mapping per FEC's published codebook for cm.txt ORG_TP:
//   https://www.fec.gov/campaign-finance-data/committee-master-file-description/
const ORG_TP_MAP: Record<string, { category: Category; motivation: Motivation }> = {
  C: { category: 'CORPORATE', motivation: 'MONEY' }, // corporation
  W: { category: 'CORPORATE', motivation: 'MONEY' }, // corporation without capital stock
  V: { category: 'CORPORATE', motivation: 'MONEY' }, // cooperative
  L: { category: 'LABOR', motivation: 'PEOPLE' }, // labor union (member-dues funded)
  // Membership orgs (M): AMA / AARP / NAR — professional/fraternal. Their
  // funding model is concentrated (professional fees from a narrow
  // industry) rather than mass-grassroots, so v1.5 defaults them to MONEY.
  // A manual CSV override can move specific membership orgs to PEOPLE.
  M: { category: 'IDEOLOGICAL', motivation: 'MONEY' },
  T: { category: 'TRADE_ASSOCIATION', motivation: 'MONEY' }, // trade association
};

interface CliFlags {
  cycleYear: number;
  zipPath: string | null;
  manualCsv: string | null;
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { cycleYear: 2026, zipPath: null, manualCsv: null, dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--cycle=')) flags.cycleYear = Number(arg.split('=')[1]);
    else if (arg.startsWith('--zip=')) flags.zipPath = arg.split('=')[1];
    else if (arg.startsWith('--manual-csv=')) flags.manualCsv = arg.split('=')[1];
  }
  return flags;
}

async function downloadZip(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = require('node:fs').createWriteStream(destPath);
    function get(currentUrl: string, redirectsLeft: number): void {
      https
        .get(currentUrl, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            const loc = res.headers.location;
            if (!loc || redirectsLeft <= 0) {
              reject(new Error(`Too many redirects fetching ${url}`));
              return;
            }
            res.resume();
            get(loc, redirectsLeft - 1);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Failed to fetch ${currentUrl}: HTTP ${res.statusCode}`));
            return;
          }
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
          file.on('error', reject);
        })
        .on('error', reject);
    }
    get(url, 5);
  });
}

interface ParsedRow {
  committeeId: string;
  committeeName: string;
  category: Category;
  motivationClass: Motivation;
  sponsorName: string | null;
  sourceNotes: string;
}

async function parseCmTxt(txt: string): Promise<ParsedRow[]> {
  const rows: ParsedRow[] = [];
  // cm.txt is pipe-delimited, no header row. Column order per FEC codebook:
  //   1 CMTE_ID
  //   2 CMTE_NM
  //   3 TRES_NM
  //   4 CMTE_ST1
  //   5 CMTE_ST2
  //   6 CMTE_CITY
  //   7 CMTE_ST
  //   8 CMTE_ZIP
  //   9 CMTE_DSGN
  //  10 CMTE_TP
  //  11 CMTE_PTY_AFFILIATION
  //  12 CMTE_FILING_FREQ
  //  13 ORG_TP        ← what we want
  //  14 CONNECTED_ORG_NM
  //  15 CAND_ID
  return new Promise((resolve, reject) => {
    Readable.from(txt)
      // quote: false — cm.txt uses pipe-delimiters with no quoting; some
      // committee names contain stray " characters (e.g. titles like
      // "MR. SUJEET") that csv-parse would otherwise misinterpret.
      .pipe(parse({ delimiter: '|', quote: false, relax_column_count: true, skip_empty_lines: true, trim: true }))
      .on('data', (cols: string[]) => {
        const committeeId = cols[0];
        const committeeName = cols[1];
        const orgTp = (cols[12] ?? '').toUpperCase();
        const connectedOrg = cols[13] || null;
        if (!committeeId || !committeeName) return;
        const mapped = ORG_TP_MAP[orgTp];
        if (!mapped) return; // ORG_TP blank or 'U' (unknown) — skip, conservative-attribution
        rows.push({
          committeeId,
          committeeName,
          category: mapped.category,
          motivationClass: mapped.motivation,
          sponsorName: connectedOrg,
          sourceNotes: `FEC Committee Master cm.txt: ORG_TP=${orgTp}; CONNECTED_ORG=${connectedOrg ?? ''}`,
        });
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function parseManualCsv(csvPath: string): Promise<ParsedRow[]> {
  // Manual CSV columns: committeeId,committeeName,category,motivationClass,sponsorName,sourceNotes
  // The motivationClass column was added in v1.5 — MONEY vs PEOPLE binary
  // is what the scoring engine actually uses. Category stays for historical
  // / display purposes. If motivationClass is missing on a row, default
  // to MONEY (conservative-attribution).
  const txt = await fs.readFile(csvPath, 'utf-8');
  const rows: ParsedRow[] = [];
  return new Promise((resolve, reject) => {
    Readable.from(txt)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }))
      .on('data', (row: Record<string, string>) => {
        const committeeId = row.committeeId?.trim();
        const committeeName = row.committeeName?.trim();
        const category = row.category?.trim().toUpperCase() as Category;
        const rawMotivation = row.motivationClass?.trim().toUpperCase();
        const motivationClass: Motivation = rawMotivation === 'PEOPLE' ? 'PEOPLE' : 'MONEY';
        if (!committeeId || !committeeName) return;
        if (!['CORPORATE', 'LABOR', 'IDEOLOGICAL', 'TRADE_ASSOCIATION', 'PARTY'].includes(category)) return;
        rows.push({
          committeeId,
          committeeName,
          category,
          motivationClass,
          sponsorName: row.sponsorName?.trim() || null,
          sourceNotes: row.sourceNotes?.trim() || `manual classification: ${csvPath}`,
        });
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-fec-classifications] flags: ${JSON.stringify(flags)}`);

  // 1. Get cm.txt — either from explicit zip path or download.
  let zipPath = flags.zipPath;
  if (!zipPath) {
    const url = FEC_BULK_URL(flags.cycleYear);
    zipPath = path.join(os.tmpdir(), `cm${flags.cycleYear}.zip`);
    console.log(`[ingest-fec-classifications] downloading ${url} → ${zipPath}`);
    await downloadZip(url, zipPath);
  } else {
    console.log(`[ingest-fec-classifications] using local zip ${zipPath}`);
  }

  // 2. Extract cm.txt from the zip. Use unzip CLI — pure-JS unzip libs add
  // a dependency for one operation; macOS + Linux + Windows all ship unzip.
  const extractDir = path.join(os.tmpdir(), `cm${flags.cycleYear}_extracted`);
  await fs.mkdir(extractDir, { recursive: true });
  execSync(`unzip -o '${zipPath}' -d '${extractDir}'`, { stdio: 'pipe' });
  const cmTxt = await fs.readFile(path.join(extractDir, 'cm.txt'), 'utf-8');

  // 3. Parse + classify.
  const bulkRows = await parseCmTxt(cmTxt);
  console.log(`[ingest-fec-classifications] bulk parsed ${bulkRows.length} classifiable committees from cm.txt`);

  // 4. Optional manual CSV overlay (super PACs etc).
  let manualRows: ParsedRow[] = [];
  if (flags.manualCsv) {
    manualRows = await parseManualCsv(flags.manualCsv);
    console.log(`[ingest-fec-classifications] manual parsed ${manualRows.length} rows from ${flags.manualCsv}`);
  }

  // 5. Manual overrides win over bulk for the same committeeId.
  const byCommitteeId = new Map<string, ParsedRow>();
  for (const r of bulkRows) byCommitteeId.set(r.committeeId, r);
  for (const r of manualRows) byCommitteeId.set(r.committeeId, r);
  const merged = [...byCommitteeId.values()];
  console.log(`[ingest-fec-classifications] merged total: ${merged.length} (bulk + manual de-duped)`);

  // 6. Histogram by category + by motivationClass (the v1.5 signal).
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
    console.log('[ingest-fec-classifications] DRY RUN — no DB writes');
    await prisma.$disconnect();
    return;
  }

  // 7. Upsert in batches (PgBouncer transaction-mode is happiest under
  // small batches; 100 rows per batch ≈ 30 batches for cm.txt).
  let written = 0;
  // Prisma 7's effective transaction ceiling under Supabase PgBouncer is
  // ~5s regardless of the explicit timeout option (same issue compute-scores
  // hit). 20 upserts per batch fits comfortably inside that.
  const BATCH = 20;
  for (let i = 0; i < merged.length; i += BATCH) {
    const slice = merged.slice(i, i + BATCH);
    const ops = slice.map((r) =>
      prisma.committeeClassification.upsert({
        where: { jurisdiction_committeeId: { jurisdiction: 'FEDERAL', committeeId: r.committeeId } },
        create: {
          jurisdiction: 'FEDERAL',
          committeeId: r.committeeId,
          committeeName: r.committeeName,
          category: r.category,
          motivationClass: r.motivationClass,
          sponsorName: r.sponsorName,
          sourceNotes: r.sourceNotes,
          classifiedBy: flags.manualCsv && merged === manualRows ? 'manual' : 'fec-bulk',
          classifiedAt: new Date(),
        },
        update: {
          committeeName: r.committeeName,
          category: r.category,
          motivationClass: r.motivationClass,
          sponsorName: r.sponsorName,
          sourceNotes: r.sourceNotes,
          classifiedAt: new Date(),
        },
      }),
    );
    await prisma.$transaction(ops, { timeout: 60_000, maxWait: 10_000 });
    written += slice.length;
    if (i % 500 === 0 || written === merged.length) {
      console.log(`[ingest-fec-classifications] upserted ${written}/${merged.length}`);
    }
  }
  console.log(`[ingest-fec-classifications] ✓ wrote ${written} CommitteeClassification rows`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
