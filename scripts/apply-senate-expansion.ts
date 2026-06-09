// scripts/apply-senate-expansion.ts
//
// Applies the Senate vote-expansion classification plan (Issue #2: Senate
// under-coverage) to RollCallVote rows. The Senate was scored on only 11
// distinct bills because the original classifier dropped cloture / motion-to-
// proceed / joint-resolution-discharge votes as "procedural." In the modern
// 60-vote Senate those are frequently THE decisive substantive vote.
//
// This script brings in EVERY plank-relevant Senate roll-call vote the owner
// approved ("keep them all — it's the truth"), including the Plank-5 war-powers
// and foreign-military-sale (FMS) disapprovals. For each in-scope RollCallVote
// it sets:
//     isScorable        = true
//     plankNumbers      = int[] (the CG plank(s) the bill maps to)
//     alignedPosition   = 'YES' | 'NO' (what counts as platform-aligned)
//
// Source of truth: docs/scorecard/senate-vote-expansion.md, with the
// classifier-flagged direction traps CORRECTED here (see TRAP NOTES below).
//
// Model: keyed by (billType, billNumber). The score dedups to bills, so every
// non-procedural roll call for an in-scope bill gets the SAME classification.
// Per-bill `excludeVoteIds` drops the procedural noise rows (recess / table /
// point-of-order / reconsider / decision-of-chair) the doc flagged EXCLUDE.
//
// Idempotent: re-running produces the same end state (plain field updates).
//
// Usage:
//   npx tsx scripts/apply-senate-expansion.ts            # DRY RUN (default) — prints, no writes
//   npx tsx scripts/apply-senate-expansion.ts --apply    # writes to the DB
//
// NB: defaults to --dry-run. Only writes when explicitly passed --apply.

import './load-env';

import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

type Aligned = 'YES' | 'NO';

interface BillPlan {
  billType: string;
  billNumber: string;
  planks: number[];
  aligned: Aligned;
  /** Short label for the dry-run print. */
  label: string;
  /**
   * Roll-call ids to EXCLUDE for this bill (procedural noise: recess, table,
   * point-of-order, reconsider, decision-of-chair, etc.). Every OTHER roll
   * call for the bill is brought in. Empty = bring in all roll calls.
   */
  excludeVoteIds?: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// TRAP NOTES — directions corrected vs the raw classifier:
//
//  • S 3386 "Health Care Freedom for Patients Act" → Plank 4, aligned NO.
//    Name trap: it's an ACA / reproductive-care rollback, not health support.
//  • HJRES 140 Boundary Waters → Plank 2, aligned NO. INVERSE of the other BLM
//    rows: this CRA disapproves a *protective* mineral withdrawal, so killing
//    it (a YES on disapproval) is pro-mining. Platform-aligned vote = NO.
//  • SJRES 107 IRS clean-electricity-credit termination → Plank 2, aligned YES.
//    Double negative: the rule *terminates* clean-energy credits, so DISAPPROVING
//    the rule preserves the credits → the aligned vote is YES on disapproval.
//  • SJRES 84 CMS "Marketplace Integrity & Affordability" → Plank 4, aligned YES.
//    The rule strips ACA coverage (CMS itself projects up to ~1.8M losing
//    coverage), so disapproving it protects coverage → aligned YES. (Doc had
//    this LOW/“NO?”; corrected to YES.)
//  • SJRES 103 VA "Reproductive Health Services" → Plank 4, aligned YES.
//    The underlying VA rule REINSTATES abortion-care exclusions for veterans, so
//    disapproving it restores veteran health-care access → aligned YES. (Doc had
//    “NO”; corrected.)
//  • Environmental / energy-efficiency / public-lands CRA disapprovals → Plank 2,
//    aligned NO (killing the rule cuts a platform priority).
//  • CFPB consumer-finance CRA disapprovals → Plank 3, aligned NO.
//  • War-powers discharge motions → Plank 5, aligned YES.
//  • Tariff / trade-emergency terminations → Plank 5, aligned YES.
//  • Foreign-military-sale (FMS) disapprovals → Plank 5, aligned YES (blocking
//    the arms sale is the peace-aligned vote).
//
// EXCLUDED categories (genuinely non-plank): immigration (S 5, SJRES 99),
// abortion/culture-war messaging (S 6, S 9, S 3627), en-bloc nominations
// (SRES 377/412/520/532/690), private relief (S 1071), pure appropriations /
// CR / budget cloture series not tied to a plank (HR 1968/5371/7147/7148,
// S 2882/2806/3012, HCONRES 14, SCONRES 7/22/33), and assorted off-plank
// items (S 331 fentanyl, HR 23 ICC sanctions, HJRES 142 DC tax, SJRES 82 APA,
// SJRES 95 corporate-AMT, SRES 195/526, S 1582 stablecoin, HJRES 25 / SJRES 3
// crypto broker-reporting).
// ───────────────────────────────────────────────────────────────────────────

const PLAN: BillPlan[] = [
  // ── Plank 2 — environment / energy / public lands CRA disapprovals (aligned NO) ──
  { billType: 'HJRES', billNumber: '104', planks: [2], aligned: 'NO', label: 'disapprove BLM Miles City RMP' },
  { billType: 'HJRES', billNumber: '105', planks: [2], aligned: 'NO', label: 'disapprove BLM North Dakota RMP' },
  { billType: 'HJRES', billNumber: '106', planks: [2], aligned: 'NO', label: 'disapprove BLM Central Yukon RMP' },
  { billType: 'HJRES', billNumber: '130', planks: [2], aligned: 'NO', label: 'disapprove BLM Buffalo RMP' },
  { billType: 'HJRES', billNumber: '131', planks: [2], aligned: 'NO', label: 'disapprove BLM Coastal Plain (ANWR) leasing' },
  { billType: 'HJRES', billNumber: '20', planks: [2], aligned: 'NO', label: 'disapprove DOE gas water-heater std' },
  { billType: 'HJRES', billNumber: '24', planks: [2], aligned: 'NO', label: 'disapprove DOE walk-in cooler/freezer std' },
  { billType: 'HJRES', billNumber: '35', planks: [2], aligned: 'NO', label: 'disapprove EPA methane waste-emissions charge' },
  { billType: 'HJRES', billNumber: '42', planks: [2], aligned: 'NO', label: 'disapprove DOE appliance-standards certification' },
  { billType: 'HJRES', billNumber: '60', planks: [2], aligned: 'NO', label: 'disapprove NPS Glen Canyon motor-vehicle rule' },
  { billType: 'HJRES', billNumber: '61', planks: [2], aligned: 'NO', label: 'disapprove EPA rubber-tire HAP std' },
  { billType: 'HJRES', billNumber: '75', planks: [2], aligned: 'NO', label: 'disapprove DOE commercial-refrigeration std' },
  { billType: 'HJRES', billNumber: '87', planks: [2], aligned: 'NO', label: 'disapprove EPA CA Advanced Clean Trucks waiver' },
  { billType: 'HJRES', billNumber: '88', planks: [2], aligned: 'NO', label: 'disapprove EPA CA Advanced Clean Cars II waiver' },
  { billType: 'HJRES', billNumber: '89', planks: [2], aligned: 'NO', label: 'disapprove EPA CA Omnibus Low-NOx waiver' },
  // TRAP: protective withdrawal — disapproving = pro-mining → aligned NO.
  { billType: 'HJRES', billNumber: '140', planks: [2], aligned: 'NO', label: 'disapprove BLM Boundary Waters withdrawal (protective; aligned NO)' },
  { billType: 'SJRES', billNumber: '11', planks: [2], aligned: 'NO', label: 'disapprove BOEM marine-archaeology protection' },
  { billType: 'SJRES', billNumber: '12', planks: [2], aligned: 'NO', label: 'disapprove EPA methane waste-emissions charge' },
  { billType: 'SJRES', billNumber: '31', planks: [2], aligned: 'NO', label: 'disapprove EPA Clean Air Act major-source reclassification' },
  {
    billType: 'SJRES',
    billNumber: '55',
    planks: [2],
    aligned: 'NO',
    label: 'disapprove NHTSA hydrogen-vehicle safety std (KEEP MTP+passage only)',
    // EXCLUDE: adjourn / table / point-of-order / recess procedural rows.
    excludeVoteIds: [
      '77e634cb-dd85-4985-b592-b8127e3eb3cb', // Motion to Adjourn
      '9202520c-df91-4b3c-a0c2-4ac94e88b022', // Motion to Table (Failed)
      '23638698-33e7-4e0f-b7cd-3d4c2093c832', // Motion to Table (Agreed)
      '5332112d-3e3b-4747-a2d7-d54519094f8c', // Point of Order
      '23e26610-ee65-41c4-a39d-f34f5621294a', // Point of Order
      'a12ea257-04d8-4229-9f18-c5764bbc05cc', // Recess 10
      '34a69868-de2f-4704-824f-70149976419b', // Recess 90
      '12e5dcc0-f120-4555-98bb-2527a2049439', // Recess 60
      '1725e88d-cc18-4b51-8299-0b87dc7c8216', // Recess 30
      'e32715a4-9ff7-44c9-8074-2b268dfa077f', // Recess 15
    ],
  },
  { billType: 'SJRES', billNumber: '60', planks: [2], aligned: 'NO', label: 'disapprove EPA Indiana cross-state air-pollution rule' },
  { billType: 'SJRES', billNumber: '69', planks: [2], aligned: 'NO', label: 'disapprove FWS Barred Owl management' },
  { billType: 'SJRES', billNumber: '76', planks: [2], aligned: 'NO', label: 'disapprove EPA oil/gas methane deadline-extension' },
  { billType: 'SJRES', billNumber: '80', planks: [2], aligned: 'NO', label: 'disapprove BLM NPR-Alaska activity plan' },
  { billType: 'SJRES', billNumber: '86', planks: [2], aligned: 'NO', label: 'disapprove EPA South Dakota regional-haze plan' },
  { billType: 'SJRES', billNumber: '89', planks: [2], aligned: 'NO', label: 'disapprove BLM Buffalo coal RMP' },
  { billType: 'SJRES', billNumber: '91', planks: [2], aligned: 'NO', label: 'disapprove BLM Coastal Plain (ANWR) leasing' },
  { billType: 'SJRES', billNumber: '139', planks: [2], aligned: 'NO', label: 'disapprove EPA Colorado regional-haze plan' },
  { billType: 'SJRES', billNumber: '7', planks: [2], aligned: 'NO', label: 'disapprove FCC E-Rate school-broadband (homework gap)' },
  // Plank 2 — aligned YES (terminate energy "emergency" / preserve clean-energy credits)
  { billType: 'SJRES', billNumber: '10', planks: [2], aligned: 'YES', label: 'terminate national energy emergency' },
  { billType: 'SJRES', billNumber: '71', planks: [2], aligned: 'YES', label: 'terminate national energy emergency' },
  // TRAP: double-negative — disapprove rule that TERMINATES clean-energy credits → aligned YES.
  { billType: 'SJRES', billNumber: '107', planks: [2], aligned: 'YES', label: 'disapprove IRS clean-electricity-credit termination (double-neg; aligned YES)' },

  // ── Plank 3 — CFPB consumer-finance CRA disapprovals (aligned NO) ──
  { billType: 'SJRES', billNumber: '130', planks: [3], aligned: 'NO', label: 'disapprove CFPB overdraft opt-in withdrawal' },
  { billType: 'SJRES', billNumber: '132', planks: [3], aligned: 'NO', label: 'disapprove CFPB servicemember-protection withdrawal' },
  { billType: 'SJRES', billNumber: '141', planks: [3], aligned: 'NO', label: 'disapprove CFPB medical-debt collection withdrawal' },

  // ── Plank 4 — healthcare ──
  { billType: 'S', billNumber: '3385', planks: [4], aligned: 'YES', label: 'Lower Health Care Costs Act (cloture)' },
  // TRAP: "Freedom" name = ACA/repro rollback → aligned NO.
  { billType: 'S', billNumber: '3386', planks: [4], aligned: 'NO', label: 'Health Care Freedom for Patients Act (rollback; aligned NO)' },
  // TRAP: ACA rule strips coverage → disapproving it protects coverage → aligned YES.
  { billType: 'SJRES', billNumber: '84', planks: [4], aligned: 'YES', label: 'disapprove CMS ACA Marketplace-Integrity rule (coverage-protective; aligned YES)' },
  // SJRES 103 (VA reproductive-health) intentionally EXCLUDED — abortion-adjacent;
  // kept out per the platform's non-culture-war voice register (owner decision).

  // ── Plank 5 — war-powers discharge motions (aligned YES) ──
  { billType: 'SJRES', billNumber: '59', planks: [5], aligned: 'YES', label: 'discharge — Iran war powers' },
  { billType: 'SJRES', billNumber: '83', planks: [5], aligned: 'YES', label: 'discharge — generic unauthorized-hostilities war powers' },
  { billType: 'SJRES', billNumber: '90', planks: [5], aligned: 'YES', label: 'discharge — Venezuela war powers' },
  { billType: 'SJRES', billNumber: '98', planks: [5], aligned: 'YES', label: 'discharge (+POO) — Venezuela war powers' },
  { billType: 'SJRES', billNumber: '104', planks: [5], aligned: 'YES', label: 'discharge — Iran war powers' },
  { billType: 'SJRES', billNumber: '114', planks: [5], aligned: 'YES', label: 'discharge — Iran war powers' },
  { billType: 'SJRES', billNumber: '116', planks: [5], aligned: 'YES', label: 'discharge — Iran war powers' },
  { billType: 'SJRES', billNumber: '118', planks: [5], aligned: 'YES', label: 'discharge — Iran war powers' },
  { billType: 'SJRES', billNumber: '123', planks: [5], aligned: 'YES', label: 'discharge — Iran war powers' },
  // SJRES 124 — the Point of Order is the only recorded floor vote (Cuba war powers).
  { billType: 'SJRES', billNumber: '124', planks: [5], aligned: 'YES', label: 'point-of-order — Cuba war powers (only vote)' },
  { billType: 'SJRES', billNumber: '163', planks: [5], aligned: 'YES', label: 'discharge — Iran war powers' },
  { billType: 'SJRES', billNumber: '184', planks: [5], aligned: 'YES', label: 'discharge — Iran war powers' },

  // ── Plank 5 — tariff / trade-emergency terminations (aligned YES) ──
  { billType: 'SJRES', billNumber: '37', planks: [5], aligned: 'YES', label: 'terminate Canada-tariff emergency' },
  {
    billType: 'SJRES',
    billNumber: '49',
    planks: [5],
    aligned: 'YES',
    label: 'terminate global-tariff emergency (KEEP passage only)',
    excludeVoteIds: ['07a4b142-d894-436b-8064-16f378d0c21c'], // Motion to Table — procedural
  },
  { billType: 'SJRES', billNumber: '77', planks: [5], aligned: 'YES', label: 'terminate Canada-tariff emergency' },
  { billType: 'SJRES', billNumber: '81', planks: [5], aligned: 'YES', label: 'terminate Brazil-tariff emergency' },
  { billType: 'SJRES', billNumber: '88', planks: [5], aligned: 'YES', label: 'terminate global-tariff emergency' },

  // ── Plank 5 — foreign-military-sale (FMS) disapprovals (aligned YES) ──
  { billType: 'SJRES', billNumber: '26', planks: [5], aligned: 'YES', label: 'disapprove FMS to Israel' },
  { billType: 'SJRES', billNumber: '32', planks: [5], aligned: 'YES', label: 'disapprove FMS to Israel' },
  { billType: 'SJRES', billNumber: '33', planks: [5], aligned: 'YES', label: 'disapprove FMS to Israel' },
  { billType: 'SJRES', billNumber: '34', planks: [5], aligned: 'YES', label: 'disapprove FMS to Israel' },
  { billType: 'SJRES', billNumber: '41', planks: [5], aligned: 'YES', label: 'disapprove defense-article export to Israel' },
  { billType: 'SJRES', billNumber: '53', planks: [5], aligned: 'YES', label: 'disapprove FMS to Qatar' },
  { billType: 'SJRES', billNumber: '54', planks: [5], aligned: 'YES', label: 'disapprove FMS to UAE' },
  { billType: 'SJRES', billNumber: '138', planks: [5], aligned: 'YES', label: 'disapprove FMS to Israel' },
];

function parseApply(argv: string[]): boolean {
  return argv.slice(2).some((a) => a === '--apply');
}

interface ResolvedVote {
  id: string;
  voteQuestion: string;
  isScorable: boolean;
  plankNumbers: number[];
  alignedPosition: string | null;
}

interface PlanResult extends BillPlan {
  votes: ResolvedVote[];
  missing: boolean;
}

async function main(): Promise<void> {
  const apply = parseApply(process.argv);
  console.log(
    `[apply-senate-expansion] mode: ${apply ? 'APPLY (writing)' : 'DRY RUN (no writes — pass --apply to write)'}`,
  );

  const results: PlanResult[] = [];
  for (const plan of PLAN) {
    const rows = await prisma.rollCallVote.findMany({
      where: { chamber: 'SENATE', billType: plan.billType, billNumber: plan.billNumber },
      select: { id: true, voteQuestion: true, isScorable: true, plankNumbers: true, alignedPosition: true },
    });
    const exclude = new Set(plan.excludeVoteIds ?? []);
    const votes = rows.filter((r) => !exclude.has(r.id));
    results.push({ ...plan, votes, missing: votes.length === 0 });
  }

  // ── Report missing bills (precision guard) ──
  const missing = results.filter((r) => r.missing);
  if (missing.length > 0) {
    console.warn(`\n⚠️  ${missing.length} planned bill(s) matched ZERO roll calls — check billType/number:`);
    for (const m of missing) console.warn(`    ${m.billType} ${m.billNumber} — ${m.label}`);
  }

  // ── Apply (or simulate) ──
  let voteWrites = 0;
  let voteNoops = 0;
  for (const r of results) {
    for (const v of r.votes) {
      const samePlanks =
        v.plankNumbers.length === r.planks.length && r.planks.every((p, i) => v.plankNumbers[i] === p);
      const alreadyApplied = v.isScorable && samePlanks && v.alignedPosition === r.aligned;
      if (alreadyApplied) {
        voteNoops += 1;
        continue;
      }
      voteWrites += 1;
      if (apply) {
        await prisma.rollCallVote.update({
          where: { id: v.id },
          data: {
            isScorable: true,
            plankNumbers: r.planks,
            alignedPosition: r.aligned as 'YES' | 'NO',
            classificationSource: 'auto-then-human',
            reviewedBy: 'senate-expansion-issue-2',
            reviewedAt: new Date(),
          },
        });
      }
    }
  }

  // ── Dry-run / summary report grouped by plank ──
  const byPlank = new Map<number, { bills: Set<string>; votes: number; lines: string[] }>();
  for (const r of results) {
    if (r.missing) continue;
    const billKey = `${r.billType} ${r.billNumber}`;
    for (const p of r.planks) {
      if (!byPlank.has(p)) byPlank.set(p, { bills: new Set(), votes: 0, lines: [] });
      const bucket = byPlank.get(p)!;
      bucket.bills.add(billKey);
      bucket.votes += r.votes.length;
    }
    // Attach a per-bill line to its lowest plank for readability.
    const primary = Math.min(...r.planks);
    byPlank.get(primary)!.lines.push(
      `    ${billKey.padEnd(11)} planks=[${r.planks.join(',')}] aligned=${r.aligned.padEnd(3)} votes=${r.votes.length}  ${r.label}`,
    );
  }

  console.log(`\n[apply-senate-expansion] planned changes by plank:`);
  for (const plank of [...byPlank.keys()].sort((a, b) => a - b)) {
    const b = byPlank.get(plank)!;
    console.log(`\n  ── Plank ${plank}: ${b.bills.size} distinct bill(s), ${b.votes} roll-call vote(s) ──`);
    for (const line of b.lines.sort()) console.log(line);
  }

  // ── Distinct-bill totals ──
  const newBillKeys = new Set(results.filter((r) => !r.missing).map((r) => `${r.billType} ${r.billNumber}`));
  const existingScorable = await prisma.rollCallVote.findMany({
    where: { chamber: 'SENATE', isScorable: true, billType: { not: null }, billNumber: { not: null } },
    select: { billType: true, billNumber: true },
  });
  const existingBillKeys = new Set(existingScorable.map((v) => `${v.billType} ${v.billNumber}`));
  const unionBillKeys = new Set([...existingBillKeys, ...newBillKeys]);
  const trulyNew = [...newBillKeys].filter((k) => !existingBillKeys.has(k));

  const totalPlannedVotes = results.reduce((acc, r) => acc + r.votes.length, 0);

  console.log(`\n[apply-senate-expansion] ─── TOTALS ───`);
  console.log(`  planned in-scope bills:        ${newBillKeys.size}`);
  console.log(`  planned roll-call votes:       ${totalPlannedVotes}`);
  console.log(`  vote rows to write (changed):  ${voteWrites}`);
  console.log(`  vote rows already-applied:     ${voteNoops} (idempotent no-op)`);
  console.log(`  Senate scorable bills BEFORE:  ${existingBillKeys.size}`);
  console.log(`  of planned, NOT already scorable: ${trulyNew.length}`);
  console.log(`  Senate DISTINCT-BILL TOTAL AFTER: ${unionBillKeys.size}`);

  if (!apply) {
    console.log(`\n[apply-senate-expansion] DRY RUN complete — no DB writes performed. Re-run with --apply to write.`);
  } else {
    console.log(`\n[apply-senate-expansion] APPLY complete — wrote ${voteWrites} vote row(s).`);
    console.log(`  Next: re-run \`npx tsx scripts/compute-scores.ts\` to recompute RepresentativeScore rows.`);
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
