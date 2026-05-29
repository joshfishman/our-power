// v1.7.5 — Ingest itemized INDIVIDUAL contributions (FEC indiv{YY}.txt).
//
// Why this exists:
//   ~53% of all political money ($4.7B across our 4-cycle window) is
//   individual contributions, NOT PAC money. The PAC Score is blind to it.
//   This surfaces "who actually bankrolls each legislator" — the finance /
//   law-firm / industry concentration in their individual-donor base.
//
// What it does (per cycle):
//   1. Build principal-committee → legislator map from ccl{cycle}.txt
//      (designation='P') joined to Legislator.fecIds.
//   2. STREAM indiv{YY}.txt out of the zip (unzip -p | readline) so we never
//      write the ~20GB uncompressed file to disk. For each itemized
//      individual contribution (ENTITY_TP='IND') to a known principal
//      committee, aggregate by (legislator, employer).
//   3. Per legislator: total itemized $, contribution count, top-25 employers
//      by aggregate $. Upsert LegislatorIndividualMoney.
//
// Employer strings are raw FEC values, uppercased + trimmed. Industry
// normalization (mapping "GOLDMAN SACHS & CO" → finance) is a future pass.
//
// indiv{YY}.txt columns (pipe-delimited):
//   0 CMTE_ID, 6 ENTITY_TP, 7 NAME, 11 EMPLOYER, 12 OCCUPATION,
//   13 TRANSACTION_DT, 14 TRANSACTION_AMT, 15 OTHER_ID
//
// Usage:
//   npm run scorecard:ingest-individual -- --cycle=2024
//   npm run scorecard:ingest-individual -- --cycle=2024 --dry-run

import './load-env';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';
import { createId } from '@paralleldrive/cuid2';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const FEC_BULK_BASE = path.join(process.cwd(), 'data');
const CCL_BASE = path.join(FEC_BULK_BASE, 'fec-bulk-ccl');

// FEC employer field catch-alls that carry no industry signal. We still count
// these dollars in the per-leg TOTAL, but exclude them from the top-employers
// list so real organizations (banks, law firms, tech, unions) surface. These
// dominate by volume — most individual donors are retirees / self-employed /
// not-employed — so without this filter the "top employers" are useless.
const NON_INFORMATIVE_EMPLOYERS = new Set([
  'NOT EMPLOYED',
  'NOT-EMPLOYED',
  'NOTEMPLOYED',
  'UNEMPLOYED',
  'SELF-EMPLOYED',
  'SELF EMPLOYED',
  'SELFEMPLOYED',
  'SELF',
  'RETIRED',
  'HOMEMAKER',
  'N/A',
  'NA',
  'NONE',
  'NULL',
  '(UNKNOWN EMPLOYER)',
  'UNKNOWN',
  'NOT APPLICABLE',
  'NOT PROVIDED',
  'INFORMATION REQUESTED',
  'INFORMATION REQUESTED PER BEST EFFORTS',
  'REQUESTED',
  'BEST EFFORTS',
  'REFUSED',
  'DECLINED',
  'DISABLED',
  'STUDENT',
  'NOT REQUIRED',
  'PROFESSIONAL',
  'SELF- EMPLOYED',
  'SELF -EMPLOYED',
  'SELF EMPLOYED/',
  'ENTREPRENEUR',
  'BUSINESS OWNER',
  'OWNER',
  'INVESTOR',
  'PRIVATE INVESTOR',
  'HOUSEWIFE',
  'CONSULTANT',
  'EMPLOYED',
  'SELF EMPLOYEED',
]);

function isInformativeEmployer(e: string): boolean {
  if (!e || e.length < 3) return false;
  return !NON_INFORMATIVE_EMPLOYERS.has(e);
}

interface CliFlags {
  cycle: number;
  dryRun: boolean;
  topN: number;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { cycle: 2024, dryRun: false, topN: 25 };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--cycle=')) flags.cycle = Number(arg.split('=')[1]);
    else if (arg.startsWith('--top=')) flags.topN = Number(arg.split('=')[1]);
  }
  return flags;
}

// Build principal-committee → legislatorId map for a cycle.
// ccl columns: 0 CAND_ID, 3 CMTE_ID, 5 CMTE_DSGN. designation 'P' = principal.
function buildPrincipalMap(cycle: number, fecToLeg: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  const fp = path.join(CCL_BASE, `ccl${cycle}.txt`);
  if (!fs.existsSync(fp)) {
    console.warn(`  [warn] no ccl${cycle}.txt — principal map will be empty`);
    return out;
  }
  const text = fs.readFileSync(fp, 'utf-8');
  for (const line of text.split('\n')) {
    if (!line) continue;
    const cols = line.split('|');
    if (cols.length < 6) continue;
    if (cols[5] !== 'P') continue; // principal committee only
    const candId = cols[0];
    const cmteId = cols[3];
    const legId = fecToLeg.get(candId);
    if (legId) out.set(cmteId, legId);
  }
  return out;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-individual] flags: ${JSON.stringify(flags)}`);
  const yy = String(flags.cycle).slice(2);
  const zipPath = path.join(FEC_BULK_BASE, `indiv${yy}.zip`);
  if (!fs.existsSync(zipPath)) {
    console.error(
      `Missing ${zipPath}. Download: curl -sL -o ${zipPath} https://www.fec.gov/files/bulk-downloads/${flags.cycle}/indiv${yy}.zip`,
    );
    process.exit(1);
  }

  // 1. FEC cand id → legislator id (include inactive so defeated challengers
  // also get individual-money rows).
  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL' },
    select: { id: true, fecIds: true },
  });
  const fecToLeg = new Map<string, string>();
  for (const l of legs) for (const f of l.fecIds ?? []) fecToLeg.set(f, l.id);
  console.log(`[ingest-individual] ${legs.length} federal legislators, ${fecToLeg.size} FEC ids`);

  // 2. principal committee → legislator
  const principalToLeg = buildPrincipalMap(flags.cycle, fecToLeg);
  console.log(`[ingest-individual] ${principalToLeg.size} principal committees mapped to legislators`);
  if (principalToLeg.size === 0) {
    console.error('No principal committees mapped — aborting.');
    await prisma.$disconnect();
    return;
  }

  // 3. Stream indiv{YY}.txt out of the zip.
  // Per-leg aggregation: Map<legId, { total, count, employers: Map<emp,{total,count}> }>
  interface LegAgg {
    total: number;
    count: number;
    employers: Map<string, { total: number; count: number }>;
  }
  const byLeg = new Map<string, LegAgg>();

  // Memory guard: employer is free-text, so a popular legislator accumulates
  // hundreds of thousands of distinct strings ("GOLDMAN SACHS", "GOLDMAN
  // SACHS & CO", "RETIRED", "SELF", "N/A"…). Keeping them all OOMs the heap.
  // When a leg's employer map exceeds PRUNE_AT, we drop the long tail down to
  // PRUNE_KEEP by total $. The top-25 we ultimately want sit far above the
  // pruning cutoff (they have $50K+ each), so pruning the $250-one-off tail
  // doesn't affect the result. Per-leg TOTAL and COUNT are always exact —
  // they're accumulated independently of the employer map.
  const PRUNE_AT = 4000;
  const PRUNE_KEEP = 800;
  function pruneEmployers(m: Map<string, { total: number; count: number }>): void {
    if (m.size <= PRUNE_AT) return;
    const kept = [...m.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, PRUNE_KEEP);
    m.clear();
    for (const [k, v] of kept) m.set(k, v);
  }

  // The zip contains the full `itcont.txt` (~11GB) PLUS redundant by_date/
  // splits of the SAME data. Extract ONLY itcont.txt or we'd double-count.
  console.log(`[ingest-individual] streaming itcont.txt from indiv${yy}.zip…`);
  const unzip = spawn('unzip', ['-p', zipPath, 'itcont.txt'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const rl = readline.createInterface({ input: unzip.stdout, crlfDelay: Infinity });

  let scanned = 0;
  let matched = 0;
  await new Promise<void>((resolve, reject) => {
    rl.on('line', (line) => {
      if (!line) return;
      scanned += 1;
      if (scanned % 5_000_000 === 0) {
        console.log(`  scanned ${(scanned / 1e6).toFixed(0)}M rows, ${matched.toLocaleString()} matched`);
      }
      const cols = line.split('|');
      if (cols.length < 16) return;
      const cmteId = cols[0];
      const legId = principalToLeg.get(cmteId);
      if (!legId) return; // not a tracked principal committee
      if (cols[6] !== 'IND') return; // individual contributions only
      const amt = Number(cols[14]) || 0;
      if (amt <= 0) return; // skip refunds / zero
      const employer = (cols[11] || '').trim().toUpperCase() || '(UNKNOWN EMPLOYER)';
      let agg = byLeg.get(legId);
      if (!agg) {
        agg = { total: 0, count: 0, employers: new Map() };
        byLeg.set(legId, agg);
      }
      agg.total += amt;
      agg.count += 1;
      const e = agg.employers.get(employer) ?? { total: 0, count: 0 };
      e.total += amt;
      e.count += 1;
      agg.employers.set(employer, e);
      if (agg.employers.size > PRUNE_AT) pruneEmployers(agg.employers);
      matched += 1;
    });
    rl.on('close', resolve);
    unzip.on('error', reject);
  });
  console.log(
    `[ingest-individual] done streaming: ${scanned.toLocaleString()} rows, ${matched.toLocaleString()} matched to tracked legislators`,
  );
  console.log(`[ingest-individual] ${byLeg.size} legislators with individual money`);

  // 4. Build rows + top employers
  interface OutRow {
    legislatorId: string;
    total: number;
    count: number;
    topEmployers: Array<{ employer: string; total: number; count: number }>;
  }
  const rows: OutRow[] = [];
  for (const [legId, agg] of byLeg) {
    const top = [...agg.employers.entries()]
      .filter(([employer]) => isInformativeEmployer(employer))
      .map(([employer, v]) => ({ employer, total: Math.round(v.total), count: v.count }))
      .sort((a, b) => b.total - a.total)
      .slice(0, flags.topN);
    rows.push({ legislatorId: legId, total: agg.total, count: agg.count, topEmployers: top });
  }

  if (flags.dryRun) {
    const sorted = [...rows].sort((a, b) => b.total - a.total);
    console.log(`\n[DRY RUN] top 15 legislators by itemized individual $ (cycle ${flags.cycle}):`);
    const names = await prisma.legislator.findMany({
      where: { id: { in: sorted.slice(0, 15).map((r) => r.legislatorId) } },
      select: { id: true, fullName: true, party: true, state: true },
    });
    const nameMap = new Map(names.map((n) => [n.id, n]));
    for (const r of sorted.slice(0, 15)) {
      const l = nameMap.get(r.legislatorId);
      const topE = r.topEmployers
        .slice(0, 3)
        .map((e) => `${e.employer.slice(0, 24)} $${(e.total / 1000).toFixed(0)}K`)
        .join(', ');
      console.log(
        `  ${l?.party}-${l?.state}  $${(r.total / 1e6).toFixed(1)}M (${r.count.toLocaleString()})  ${(
          l?.fullName ?? ''
        ).padEnd(26)}  top: ${topE}`,
      );
    }
    await prisma.$disconnect();
    return;
  }

  // 5. Upsert
  console.log(`[ingest-individual] upserting ${rows.length} LegislatorIndividualMoney rows…`);
  let written = 0;
  for (const r of rows) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "LegislatorIndividualMoney"
        ("id","legislatorId","cycleYear","totalItemized","contributionCount","topEmployers","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4::numeric,$5,$6::jsonb,NOW(),NOW())
       ON CONFLICT ("legislatorId","cycleYear") DO UPDATE SET
         "totalItemized"=EXCLUDED."totalItemized",
         "contributionCount"=EXCLUDED."contributionCount",
         "topEmployers"=EXCLUDED."topEmployers",
         "updatedAt"=NOW()`,
      createId(),
      r.legislatorId,
      flags.cycle,
      r.total,
      r.count,
      JSON.stringify(r.topEmployers),
    );
    written += 1;
    if (written % 200 === 0 || written === rows.length) console.log(`  upserted ${written}/${rows.length}`);
  }
  console.log(`[ingest-individual] ✓ wrote ${written} rows for cycle ${flags.cycle}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
