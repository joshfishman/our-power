// v1.7.2 — Reclassify UNKNOWN PacClassification stubs.
//
// Why this exists:
//   The leadership-PAC inflow ingest (map-leadership-pacs.ts) backfilled
//   PacClassification rows for donor PACs that weren't in the original
//   top-20K classified set. Same backfill happens during JFC pass-through
//   and other ingest paths. These stubs have `class='UNKNOWN'`, `name`
//   equal to the committee_id (no real name), and a reason tag of
//   `auto:*-backfill`.
//
//   This script enriches them with real metadata from cm.txt (across 4
//   cycles) and runs them through the existing classifier patterns from
//   spike-pac-candidates.ts. Stubs that classify into a non-UNKNOWN class
//   get UPDATEd. Unmatched stubs stay UNKNOWN but get their real name
//   filled in.
//
// Usage:
//   npm run scorecard:classify-unknown-stubs
//   npm run scorecard:classify-unknown-stubs -- --dry-run

import './load-env';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { autoClassify } from './spike-pac-candidates';
import type { PacRow } from './spike-pac-candidates';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const CYCLES = [2018, 2020, 2022, 2024];
const FEC_BULK_BASE = path.join(process.cwd(), 'data');

interface CliFlags {
  dryRun: boolean;
  all: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false, all: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--all') flags.all = true;
  }
  return flags;
}

// cm.txt columns (pipe-delimited):
//   0  CMTE_ID
//   1  CMTE_NM
//   8  CMTE_DSGN     (P=Principal, A=Authorized, J=JFC, D=Leadership, U/B=Unauthorized/Other)
//   9  CMTE_TP       (Q=Qualified, N=Non-qualified, X/Y/Z=IE/Hybrid/Party, etc.)
//   12 ORG_TP        (C=Corp, T=Trade, L=Labor, M=Membership, V=Cooperative, W=Other)
//   13 CONNECTED_ORG_NM
interface CmEntry {
  name: string;
  committeeType: string;
  designation: string;
  orgType: string;
  connectedOrg: string;
}

// Build an index across cycles. Later cycles overwrite earlier ones so the
// most recent metadata wins for committees that exist in multiple cycles.
function loadCmIndex(): Map<string, CmEntry> {
  const idx = new Map<string, CmEntry>();
  for (const cycle of CYCLES) {
    const filePath = path.join(FEC_BULK_BASE, `fec-bulk-${cycle}`, 'cm.txt');
    if (!fs.existsSync(filePath)) {
      console.warn(`  [warn] cm.txt missing for cycle ${cycle}`);
      continue;
    }
    const text = fs.readFileSync(filePath, 'utf-8');
    let n = 0;
    for (const line of text.split('\n')) {
      if (!line) continue;
      const cols = line.split('|');
      if (cols.length < 14) continue;
      const id = cols[0];
      idx.set(id, {
        name: cols[1] ?? '',
        designation: cols[8] ?? '',
        committeeType: cols[9] ?? '',
        orgType: cols[12] ?? '',
        connectedOrg: cols[13] ?? '',
      });
      n += 1;
    }
    console.log(`  cycle ${cycle}: indexed ${n.toLocaleString()} committees`);
  }
  return idx;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[classify-unknown-stubs] flags: ${JSON.stringify(flags)}`);

  // 1. Fetch UNKNOWN committees to reclassify.
  //   default: only auto-backfilled stubs (reason starts with 'auto:*-backfill').
  //   --all:   every class=UNKNOWN row EXCEPT human-locked ones (source !=
  //            'inline'/'override'/'llm'). This lets us sweep the ~4K UNKNOWN
  //            donor committees that came in via FEC ingest but were never in
  //            the top-20K classified set. We still protect human-reviewed
  //            rows: anything with source in (inline, override, llm) is left
  //            alone even under --all.
  const stubs = flags.all
    ? await prisma.pacClassification.findMany({
        where: {
          class: 'UNKNOWN',
          source: { notIn: ['inline', 'override', 'llm'] },
        },
        select: { committeeId: true, name: true, reason: true },
      })
    : await prisma.pacClassification.findMany({
        where: {
          class: 'UNKNOWN',
          OR: [
            { reason: { startsWith: 'auto:leadership-' } },
            { reason: { startsWith: 'auto:fec-classified-' } },
            { reason: { startsWith: 'auto:jfc-' } },
          ],
        },
        select: { committeeId: true, name: true, reason: true },
      });
  console.log(`[classify-unknown-stubs] ${stubs.length} candidate stubs (all=${flags.all})`);
  if (stubs.length === 0) {
    await prisma.$disconnect();
    return;
  }

  // 2. Load cm.txt index.
  console.log('[classify-unknown-stubs] loading cm.txt index across 4 cycles…');
  const cm = loadCmIndex();
  console.log(`[classify-unknown-stubs] indexed ${cm.size} unique committees`);

  // 3. Apply classifier to each stub.
  interface Result {
    committeeId: string;
    name: string;
    proposed: string;
    reason: string;
    committeeType: string;
    orgType: string;
    connectedOrg: string;
    foundInCm: boolean;
  }
  const results: Result[] = [];
  let foundInCm = 0;
  for (const stub of stubs) {
    const cmRow = cm.get(stub.committeeId);
    if (!cmRow) {
      // Committee not in any of our cm.txt files — leave the stub as UNKNOWN
      // but record so we know it wasn't classifiable.
      results.push({
        committeeId: stub.committeeId,
        name: stub.name,
        proposed: 'UNKNOWN',
        reason: 'cm.txt: no match across 4 cycles',
        committeeType: '',
        orgType: '',
        connectedOrg: '',
        foundInCm: false,
      });
      continue;
    }
    foundInCm += 1;

    // SPECIAL CASE: CMTE_DSGN='P' (Principal) or 'A' (Authorized) means this
    // is a candidate's own committee — not a real PAC donor. When such a
    // committee transfers money to a leadership PAC or other vehicle, it's
    // intra-political transfer, not concentrated-wealth influence. Treat as
    // LEADERSHIP (doesn't-count category) without running the full classifier
    // which would mis-tag "JEFF FLAKE FOR US SENATE INC" as CORPORATE via
    // the bare \bINC\b regex.
    if (cmRow.designation === 'P' || cmRow.designation === 'A') {
      results.push({
        committeeId: stub.committeeId,
        name: cmRow.name,
        proposed: 'LEADERSHIP',
        reason: `cm-designation=${cmRow.designation} (candidate's own committee — intra-political)`,
        committeeType: cmRow.committeeType,
        orgType: cmRow.orgType,
        connectedOrg: cmRow.connectedOrg,
        foundInCm: true,
      });
      continue;
    }

    // SPECIAL CASE: CMTE_TP='Y' is a party committee (DCCC/NRCC/DSCC/NRSC/
    // RNC/DNC + state parties). High-confidence FEC signal. Classify PARTY.
    if (cmRow.committeeType === 'Y') {
      results.push({
        committeeId: stub.committeeId,
        name: cmRow.name,
        proposed: 'PARTY',
        reason: `cm-type=Y (party committee)`,
        committeeType: cmRow.committeeType,
        orgType: cmRow.orgType,
        connectedOrg: cmRow.connectedOrg,
        foundInCm: true,
      });
      continue;
    }

    const pacRow: PacRow = {
      committee_id: stub.committeeId,
      name: cmRow.name,
      committee_type: cmRow.committeeType,
      total_receipts: 0,
      contribs_to_others: 0,
      ind_exp: 0,
      influence_volume: 0,
      org_type: cmRow.orgType,
      connected_org: cmRow.connectedOrg,
    };
    let { proposed, reason } = autoClassify(pacRow);
    // CONFIDENCE GATE (--all mode only): a blind sweep of thousands of small
    // committees can't trust the loose name-pattern fallbacks — e.g. the bare
    // /\bINC\b/, /\bLLC\b/, /\bENERGY\b/, /\bDEFENSE\b/ corporate patterns
    // mislabel activist orgs like "KNOCK FOR DEMOCRACY, INC." or "VOTING
    // RIGHTS DEFENSE FUND". In --all mode we ONLY accept high-confidence
    // signals: explicit overrides, FEC org_type, and a curated set of strong
    // named patterns. Everything weaker stays UNKNOWN (honest > wrong).
    if (flags.all && proposed !== 'UNKNOWN') {
      const strong =
        reason.startsWith('override:') ||
        reason.startsWith('org_type=') ||
        // Strong, unambiguous named orgs (foreign-policy, major labor, conduits).
        /AIPAC|AMERICAN ISRAEL|J ?STREET|TURKISH AMERICAN|HELLENIC|AFL-?CIO|TEAMSTER|\bSEIU\b|AFSCME|\bUAW\b|UFCW|\bNEA\b|ACTBLUE|WINRED|CLUB FOR GROWTH|SENATE LEADERSHIP FUND|CONGRESSIONAL LEADERSHIP FUND|HOUSE MAJORITY PAC|SENATE MAJORITY PAC|EMILY'?S LIST|EVERYTOWN|GIFFORDS|SIERRA CLUB|PLANNED PARENTHOOD/i.test(
          `${cmRow.name} ${cmRow.connectedOrg}`,
        );
      if (!strong) {
        proposed = 'UNKNOWN';
        reason = `--all gate: weak signal (${reason}) left UNKNOWN`;
      }
    }
    results.push({
      committeeId: stub.committeeId,
      name: cmRow.name,
      proposed,
      reason,
      committeeType: cmRow.committeeType,
      orgType: cmRow.orgType,
      connectedOrg: cmRow.connectedOrg,
      foundInCm: true,
    });
  }
  console.log(`[classify-unknown-stubs] ${foundInCm}/${stubs.length} found in cm.txt`);

  // 4. Breakdown
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.proposed] = (counts[r.proposed] ?? 0) + 1;
  console.log(`[classify-unknown-stubs] breakdown: ${JSON.stringify(counts)}`);

  if (flags.dryRun) {
    console.log('\n[DRY RUN] sample of newly-classified rows (non-UNKNOWN, first 20):');
    for (const r of results.filter((x) => x.proposed !== 'UNKNOWN').slice(0, 20)) {
      console.log(`  ${r.proposed.padEnd(15)} ${r.committeeId}  ${r.name.slice(0, 50).padEnd(50)}  ${r.reason}`);
    }
    console.log('\n[DRY RUN] sample of still-UNKNOWN rows (first 10):');
    for (const r of results.filter((x) => x.proposed === 'UNKNOWN').slice(0, 10)) {
      const tag = r.foundInCm ? `name="${r.name.slice(0, 40)}" orgTp=${r.orgType}` : 'NOT IN cm.txt';
      console.log(`  ${r.committeeId}  ${tag}`);
    }
    await prisma.$disconnect();
    return;
  }

  // 5. Write updates. Two paths:
  //    (a) Now-classified rows → update class + name + reason + metadata
  //    (b) Still-UNKNOWN but found in cm.txt → just enrich name + metadata
  let updated = 0;
  let enriched = 0;
  for (const r of results) {
    if (!r.foundInCm) continue; // leave unchanged
    if (r.proposed !== 'UNKNOWN') {
      await prisma.pacClassification.update({
        where: { committeeId: r.committeeId },
        data: {
          class: r.proposed as
            | 'CORPORATE'
            | 'DARK_MONEY'
            | 'FOREIGN_POLICY'
            | 'ACTIVIST'
            | 'LABOR'
            | 'LEADERSHIP'
            | 'IDEOLOGICAL'
            | 'CONDUIT'
            | 'PARTY'
            | 'UNKNOWN',
          name: r.name.slice(0, 200),
          committeeType: r.committeeType || null,
          orgType: r.orgType || null,
          connectedOrg: r.connectedOrg.slice(0, 200) || null,
          reason: `auto:reclass: ${r.reason}`.slice(0, 500),
          source: 'auto',
        },
      });
      updated += 1;
    } else {
      // enrich name + metadata only
      await prisma.pacClassification.update({
        where: { committeeId: r.committeeId },
        data: {
          name: r.name.slice(0, 200),
          committeeType: r.committeeType || null,
          orgType: r.orgType || null,
          connectedOrg: r.connectedOrg.slice(0, 200) || null,
        },
      });
      enriched += 1;
    }
  }
  console.log(`[classify-unknown-stubs] ✓ reclassified ${updated}, enriched (name only) ${enriched}`);

  // 6. Surface the most impactful reclassifications: how much $ did we just
  // newly-attribute as counts-against?
  const impactRows = await prisma.$queryRaw<Array<{ class: string; total: string }>>`
    WITH reclassed AS (
      SELECT "committeeId" FROM "PacClassification"
      WHERE reason LIKE 'auto:reclass:%'
    )
    SELECT pc.class::text AS class, SUM(lpi.amount::numeric)::text AS total
    FROM "LeadershipPacInflow" lpi
    JOIN "PacClassification" pc ON pc."committeeId" = lpi."donorCommitteeId"
    WHERE lpi."donorCommitteeId" IN (SELECT "committeeId" FROM reclassed)
    GROUP BY pc.class
    ORDER BY total DESC
  `;
  console.log('\n[classify-unknown-stubs] LeadershipPacInflow $ newly attributed by class:');
  for (const r of impactRows) {
    console.log(`  ${r.class.padEnd(15)} $${Number(r.total).toLocaleString()}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
