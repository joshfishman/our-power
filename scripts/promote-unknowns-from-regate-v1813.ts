// v1.8.13 — Evidence-based promotion of 1,223 super PACs from UNKNOWN → DARK_MONEY
// (or LEADERSHIP/LABOR/ACTIVIST when better evidence supports).
//
// Context: PR #45 (v1.8.8) gated the corporate-name regex pack on
// `connectedOrg IS NOT NULL` and flipped 1,223 super PACs CORPORATE → UNKNOWN
// (conservative landing — better than asserting CORPORATE without sponsor
// evidence). Those rows have `reason LIKE 'v1.8.8-regate%'`. Currently $112M
// of super-PAC IE_OPPOSE doesn't count against anyone because UNKNOWN is
// non-counts-against. This script applies per-row evidence rules to flip
// each into the right class.
//
// Usage:
//   npx tsx scripts/promote-unknowns-from-regate-v1813.ts --dry-run
//   npx tsx scripts/promote-unknowns-from-regate-v1813.ts --apply

import './load-env';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes('--apply');
const DRY = process.argv.includes('--dry-run') || !APPLY;
const COUNTS_AGAINST_THRESHOLD = 100_000; // dollars

// Super-PAC committee types per FEC schema. O = independent expenditure
// (super PAC), I = qualified non-party, V = pcc qualified super-only, W =
// hybrid (Carey), U = single-cand IE, E = electioneering only.
const SUPER_PAC_TYPES = new Set(['O', 'I', 'V', 'W', 'U', 'E']);
// Labor union committee types: N (qualified party committee — not used here),
// Q (qualified non-party). Conservative: only Q + name-pattern.
const LABOR_TYPES = new Set(['N', 'Q']);

const LABOR_NAME_PATTERN =
  /\b(SEIU|AFSCME|AFT-?|NEA|UAW|UFCW|IBEW|AFL-?CIO|TEAMSTERS|UFW|UNITE HERE|CWA|IATSE|USW|UMWA|UNION|WORKERS)\b/i;

const POLITICAL_NAME_PATTERN =
  /\b(ACTION|FUND|PAC|COMMITTEE|FORWARD|DEFENDING|HONOR|FUTURE|VICTORY|MAJORITY|FIRST|LEADS|AMERICA(N)?|USA|CONSERVATIVE|PROGRESSIVE|REPUBLICAN|DEMOCRAT|LIBERTY|FREEDOM|PATRIOT|NATION|PRESERVING|RESTORING|SAVING|UNITED|CITIZENS|INC|LLC)\b/i;

const SINGLE_ISSUE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(CLIMATE|ENVIRONMENT|GREEN|EARTH|RENEWABLE|CONSERVATION)\b/i, 'climate/environment'],
  [/\b(CHOICE|REPRO(DUCTIVE)?|PLANNED PARENTHOOD)\b/i, 'reproductive-rights'],
  [/\b(PRO-?LIFE|UNBORN|RIGHT TO LIFE)\b/i, 'pro-life'],
  [/\b(GUN|FIREARM|2A|SECOND AMENDMENT)\b/i, 'gun-rights / gun-control'],
  [/\b(VETERAN(S)?|VFW)\b/i, 'veterans'],
  [/\b(EDUCATION|TEACHERS?|SCHOOL|STUDENT)\b/i, 'education'],
  [/\b(HOUSING|TENANT|HOMELESS(NESS)?)\b/i, 'housing'],
  [/\b(IMMIGRATION|IMMIGRANT|DACA|DREAMER)\b/i, 'immigration'],
];

type Row = {
  committeeId: string;
  name: string;
  committeeType: string | null;
  connectedOrg: string | null;
  totalCountsAgainst: number;
};

type Decision = {
  committeeId: string;
  name: string;
  oldClass: 'UNKNOWN';
  newClass:
    | 'DARK_MONEY'
    | 'LEADERSHIP'
    | 'LABOR'
    | 'ACTIVIST'
    | 'UNKNOWN'; // stays
  rule: string;
  totalCountsAgainst: number;
};

function decide(row: Row, legislatorNamePieces: Set<string>): Decision {
  const name = row.name.toUpperCase();
  const cType = row.committeeType ?? '';
  const sponsor = (row.connectedOrg ?? '').trim().toUpperCase();
  const sponsorIsEmpty = sponsor === '' || sponsor === 'NONE';

  // (1) LEADERSHIP — connectedOrg names a known legislator.
  if (!sponsorIsEmpty) {
    for (const piece of legislatorNamePieces) {
      if (sponsor.includes(piece)) {
        return {
          committeeId: row.committeeId,
          name: row.name,
          oldClass: 'UNKNOWN',
          newClass: 'LEADERSHIP',
          rule: `leadership: connectedOrg "${row.connectedOrg}" matches legislator surname "${piece}"`,
          totalCountsAgainst: row.totalCountsAgainst,
        };
      }
    }
  }

  // (2) LABOR — labor pattern + Q committee type (or sponsor names a union).
  if (LABOR_NAME_PATTERN.test(name) && (LABOR_TYPES.has(cType) || LABOR_NAME_PATTERN.test(sponsor))) {
    return {
      committeeId: row.committeeId,
      name: row.name,
      oldClass: 'UNKNOWN',
      newClass: 'LABOR',
      rule: `labor: name + committeeType=${cType || '?'}`,
      totalCountsAgainst: row.totalCountsAgainst,
    };
  }

  // (3) ACTIVIST — single-issue cause word AND no candidate/party signal.
  // Skip if the name also looks political-party-aligned (Republican / Democrat).
  if (!/\b(REPUBLICAN|DEMOCRAT|GOP|RNC|DNC|PARTY)\b/i.test(name)) {
    for (const [pattern, label] of SINGLE_ISSUE_PATTERNS) {
      if (pattern.test(name)) {
        return {
          committeeId: row.committeeId,
          name: row.name,
          oldClass: 'UNKNOWN',
          newClass: 'ACTIVIST',
          rule: `activist: single-issue match "${label}"`,
          totalCountsAgainst: row.totalCountsAgainst,
        };
      }
    }
  }

  // (4) DARK_MONEY — super PAC + no real corporate sponsor + $ threshold.
  // Two pathways:
  //   (4a) sponsor is empty AND name matches political pattern (catches the
  //        named super PACs: America First Action, Honor PA, etc.)
  //   (4b) sponsor is empty OR sponsor is itself a super-PAC-shaped name
  //        ("...Fund", "...Action", "...Committee" — i.e., not a real
  //        corporate parent) AND >$1M counts-against. Catches single-word
  //        super PACs (FAIRSHAKE) and shell-sponsored ones (DITCH FUND,
  //        whose sponsor is "DEMOCRATIC DEFENSE FUND").
  const isSuperPacType = SUPER_PAC_TYPES.has(cType);
  const looksPolitical = POLITICAL_NAME_PATTERN.test(name);
  const aboveThreshold = row.totalCountsAgainst > COUNTS_AGAINST_THRESHOLD;
  const aboveHighThreshold = row.totalCountsAgainst > 1_000_000;
  // Sponsor is "effectively empty" if it's blank/NONE OR matches a super-PAC
  // name shape (no real corporate parent).
  const sponsorShape = /\b(FUND|ACTION|PAC|COMMITTEE|FORWARD|VICTORY|MAJORITY|LEADERSHIP)\b/i;
  const sponsorIsAnotherSuperPac = !sponsorIsEmpty && sponsorShape.test(sponsor);
  const sponsorEffectivelyEmpty = sponsorIsEmpty || sponsorIsAnotherSuperPac;

  if (isSuperPacType && sponsorIsEmpty && looksPolitical && aboveThreshold) {
    return {
      committeeId: row.committeeId,
      name: row.name,
      oldClass: 'UNKNOWN',
      newClass: 'DARK_MONEY',
      rule: `dark_money: super-pac type=${cType}, no connectedOrg, political name, $${row.totalCountsAgainst.toLocaleString()} counts-against`,
      totalCountsAgainst: row.totalCountsAgainst,
    };
  }
  if (isSuperPacType && sponsorEffectivelyEmpty && aboveHighThreshold) {
    return {
      committeeId: row.committeeId,
      name: row.name,
      oldClass: 'UNKNOWN',
      newClass: 'DARK_MONEY',
      rule: `dark_money: super-pac type=${cType}, sponsor="${sponsor || '(empty)'}" (no real corporate parent), $${row.totalCountsAgainst.toLocaleString()} counts-against (>$1M)`,
      totalCountsAgainst: row.totalCountsAgainst,
    };
  }

  // (5) Leave as UNKNOWN.
  return {
    committeeId: row.committeeId,
    name: row.name,
    oldClass: 'UNKNOWN',
    newClass: 'UNKNOWN',
    rule: `stays_unknown: type=${cType || '?'} sponsor="${sponsor || '(empty)'}" political=${looksPolitical} above_threshold=${aboveThreshold}`,
    totalCountsAgainst: row.totalCountsAgainst,
  };
}

async function main() {
  console.log(`[v1.8.13] mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  // Load all active legislator surnames for the LEADERSHIP rule.
  const legs = await prisma.legislator.findMany({
    select: { fullName: true },
  });
  const legislatorNamePieces = new Set<string>();
  for (const leg of legs) {
    if (!leg.fullName) continue;
    const pieces = leg.fullName.toUpperCase().split(/[\s,.]+/).filter((p) => p.length >= 5);
    for (const p of pieces) legislatorNamePieces.add(p);
  }
  console.log(`[v1.8.13] loaded ${legislatorNamePieces.size} legislator-name pieces for LEADERSHIP rule`);

  // Pull every UNKNOWN row from the v1.8.8 regate batch.
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT pc."committeeId", pc.name, pc."committeeType", pc."connectedOrg",
           COALESCE(SUM(c.amount::numeric)::float, 0) AS "totalCountsAgainst"
    FROM "PacClassification" pc
    LEFT JOIN "PacContribution" c
      ON c."donorCommitteeId" = pc."committeeId"
      AND c.kind IN ('DIRECT', 'IE_SUPPORT', 'IE_OPPOSE')
    WHERE pc.class = 'UNKNOWN'
      AND pc.reason LIKE 'v1.8.8-regate%'
      AND pc."finalClass" IS NULL
    GROUP BY pc."committeeId", pc.name, pc."committeeType", pc."connectedOrg"
  `;
  console.log(`[v1.8.13] candidates: ${rows.length} UNKNOWN rows from v1.8.8 regate batch`);

  const decisions = rows.map((r) => decide(r, legislatorNamePieces));

  // Tally
  const byClass: Record<string, { count: number; dollars: number }> = {};
  for (const d of decisions) {
    if (!byClass[d.newClass]) byClass[d.newClass] = { count: 0, dollars: 0 };
    byClass[d.newClass].count += 1;
    byClass[d.newClass].dollars += d.totalCountsAgainst;
  }

  console.log('\n[v1.8.13] proposed distribution:');
  for (const [cls, { count, dollars }] of Object.entries(byClass).sort((a, b) => b[1].dollars - a[1].dollars)) {
    console.log(`  ${cls.padEnd(12)}: ${count.toString().padStart(5)} rows · $${(dollars / 1e6).toFixed(2)}M`);
  }

  // Top 10 reference cases
  console.log('\n[v1.8.13] top 10 by $ counts-against:');
  const top = [...decisions].sort((a, b) => b.totalCountsAgainst - a.totalCountsAgainst).slice(0, 10);
  for (const d of top) {
    console.log(`  ${d.committeeId}  ${d.name.padEnd(45)}  $${(d.totalCountsAgainst / 1e6).toFixed(2)}M  → ${d.newClass}  (${d.rule})`);
  }

  // Write report
  const report = {
    timestamp: '2026-05-30',
    mode: APPLY ? 'APPLY' : 'DRY-RUN',
    totalCandidates: rows.length,
    distribution: byClass,
    decisions: decisions.sort((a, b) => b.totalCountsAgainst - a.totalCountsAgainst),
  };
  writeFileSync('data/v1813-promotion-report.json', JSON.stringify(report, null, 2));
  console.log(`\n[v1.8.13] wrote data/v1813-promotion-report.json (${decisions.length} decisions)`);

  if (!APPLY) {
    console.log('[v1.8.13] DRY-RUN — no DB writes. Pass --apply to commit.');
    await prisma.$disconnect();
    return;
  }

  // APPLY — wrap in transaction
  const promotions = decisions.filter((d) => d.newClass !== 'UNKNOWN');
  if (promotions.length === 0) {
    console.log('[v1.8.13] no promotions to apply (all stay UNKNOWN).');
    await prisma.$disconnect();
    return;
  }

  // Sequential apply — script is safely re-runnable since each update is
  // class='UNKNOWN' → new class, and a re-run will find 0 UNKNOWN rows for
  // already-applied committeeIds. Transaction atomicity not required.
  console.log(`[v1.8.13] applying ${promotions.length} promotions sequentially...`);
  let applied = 0;
  for (const d of promotions) {
    await prisma.pacClassification.update({
      where: { committeeId: d.committeeId },
      data: {
        class: d.newClass as 'DARK_MONEY' | 'LEADERSHIP' | 'LABOR' | 'ACTIVIST',
        reason: `v1.8.13-promote: ${d.rule}`,
        source: 'auto',
      },
    });
    applied += 1;
    if (applied % 25 === 0) console.log(`  applied ${applied}/${promotions.length}`);
  }
  console.log(`[v1.8.13] applied ${applied} promotions.`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
