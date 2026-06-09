// scripts/apply-house-expansion.ts
//
// Applies the House vote-expansion classification plan to RollCallVote rows.
// Companion to scripts/apply-senate-expansion.ts (same model, same conventions).
//
// The House is already scored on 144 distinct bills — the unused pile is mostly
// genuine procedure (rule adoptions, Previous Question, MTRs) and off-plank
// messaging. This script admits the HIGH-confidence substantive stragglers:
//
//   • Plank 5 — six HCONRES war-powers resolutions (§5(c) removal directives).
//     "On Agreeing to the Resolution" on an HCONRES war-powers resolution is the
//     substantive floor vote on the resolution ITSELF (the House analog of the
//     Senate's war-powers discharge motions) — NOT a rule adoption. All six
//     failed by razor-thin margins. Aligned = YES.
//   • Plank 4 — HR 2483 SUPPORT Act reauthorization (bipartisan opioid/SUD
//     treatment). Passage only. Aligned = YES.
//   • Plank 2 — HR 375 / HR 776 conservation suspension bills. Aligned = YES.
//
// For each in-scope RollCallVote it sets:
//     isScorable        = true
//     plankNumbers      = int[] (the CG plank(s) the bill maps to)
//     alignedPosition   = 'YES' | 'NO' (what counts as platform-aligned)
//
// Source of truth: docs/scorecard/house-vote-expansion.md.
//
// Model: keyed by (billType, billNumber). The score dedups to bills, so every
// non-procedural roll call for an in-scope bill gets the SAME classification.
// Per-bill `excludeVoteIds` drops roll calls that must NOT share the bill's
// alignedPosition — in the House that's chiefly the AMENDMENT-VOTE TRAP:
// "On Agreeing to the Amendment" attaches to the parent bill's (billType,
// billNumber), but an amendment's aligned direction can be the OPPOSITE of the
// bill's (e.g. a protective amendment to a misaligned bill). Any amendment roll
// call whose direction isn't independently verified is excluded here.
//
//   TRAP exclusion in this plan:
//     • HR 2483 — 1 amendment roll call (Failed 213-210), direction unverified
//       → excluded; only the passage vote is admitted.
//
//   TRAPS flagged but needing NO action (bills not in this plan stay untouched;
//   their amendment roll calls remain isScorable=false):
//     • HR 3838 (NDAA FY26, scored P5/NO) — 17 amendment roll calls must remain
//       unused (war-powers/audit amendments would be aligned YES ≠ bill's NO).
//     • HR 4776 (SPEED Act, scored P2/NO) — 3 failed (likely protective)
//       amendment roll calls must remain unused.
//     • HR 1048 / HR 3383 / HR 7567 / HR 2988 / HR 7148 — amendment votes on
//       LOW-confidence or excluded bills; classify separately if ever admitted.
//
// Idempotent: re-running produces the same end state (plain field updates).
//
// Usage:
//   npx tsx scripts/apply-house-expansion.ts            # DRY RUN (default) — prints, no writes
//   npx tsx scripts/apply-house-expansion.ts --apply    # writes to the DB
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
   * Roll-call ids to EXCLUDE for this bill (amendment-vote traps + procedural
   * noise). Every OTHER roll call for the bill is brought in. Empty = bring in
   * all roll calls.
   */
  excludeVoteIds?: string[];
}

const PLAN: BillPlan[] = [
  // ── Plank 2 — conservation / invasive-species suspension bills (aligned YES) ──
  { billType: 'HR', billNumber: '375', planks: [2], aligned: 'YES', label: 'Continued Rapid Ohia Death Response Act (invasive pathogen)' },
  { billType: 'HR', billNumber: '776', planks: [2], aligned: 'YES', label: 'Nutria Eradication and Control Reauthorization Act' },

  // ── Plank 4 — SUPPORT Act reauthorization (aligned YES) ──
  {
    billType: 'HR',
    billNumber: '2483',
    planks: [4],
    aligned: 'YES',
    label: 'SUPPORT for Patients and Communities Reauthorization (passage only)',
    // AMENDMENT TRAP: "On Agreeing to the Amendment" (Failed 213-210) — direction
    // unverified; must not inherit the bill's aligned=YES. EXCLUDE.
    excludeVoteIds: ['137e3315-d683-4644-8b80-ba8f5eeb3f5f'],
  },

  // ── Plank 5 — HCONRES war-powers resolutions (§5(c) removal; aligned YES) ──
  // "On Agreeing to the Resolution" here is the substantive vote on the war-powers
  // resolution itself — the House analog of the Senate war-powers discharge motions.
  { billType: 'HCONRES', billNumber: '38', planks: [5], aligned: 'YES', label: 'war powers — remove forces from hostilities (Failed 212-219)' },
  { billType: 'HCONRES', billNumber: '40', planks: [5], aligned: 'YES', label: 'war powers — remove forces from hostilities (Failed 213-213)' },
  { billType: 'HCONRES', billNumber: '61', planks: [5], aligned: 'YES', label: 'war powers — remove forces from hostilities (Failed 210-215)' },
  { billType: 'HCONRES', billNumber: '64', planks: [5], aligned: 'YES', label: 'war powers — remove forces from Venezuela (Failed 210-212)' },
  { billType: 'HCONRES', billNumber: '68', planks: [5], aligned: 'YES', label: 'war powers — remove forces from Venezuela (Failed 215-215)' },
  { billType: 'HCONRES', billNumber: '75', planks: [5], aligned: 'YES', label: 'war powers — remove forces from hostilities (Failed 211-211)' },
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
    `[apply-house-expansion] mode: ${apply ? 'APPLY (writing)' : 'DRY RUN (no writes — pass --apply to write)'}`,
  );

  const results: PlanResult[] = [];
  for (const plan of PLAN) {
    const rows = await prisma.rollCallVote.findMany({
      where: { chamber: 'HOUSE', billType: plan.billType, billNumber: plan.billNumber },
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
            reviewedBy: 'house-expansion',
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

  console.log(`\n[apply-house-expansion] planned changes by plank:`);
  for (const plank of [...byPlank.keys()].sort((a, b) => a - b)) {
    const b = byPlank.get(plank)!;
    console.log(`\n  ── Plank ${plank}: ${b.bills.size} distinct bill(s), ${b.votes} roll-call vote(s) ──`);
    for (const line of b.lines.sort()) console.log(line);
  }

  // ── Distinct-bill totals ──
  const newBillKeys = new Set(results.filter((r) => !r.missing).map((r) => `${r.billType} ${r.billNumber}`));
  const existingScorable = await prisma.rollCallVote.findMany({
    where: { chamber: 'HOUSE', isScorable: true, billType: { not: null }, billNumber: { not: null } },
    select: { billType: true, billNumber: true },
  });
  const existingBillKeys = new Set(existingScorable.map((v) => `${v.billType} ${v.billNumber}`));
  const unionBillKeys = new Set([...existingBillKeys, ...newBillKeys]);
  const trulyNew = [...newBillKeys].filter((k) => !existingBillKeys.has(k));

  const totalPlannedVotes = results.reduce((acc, r) => acc + r.votes.length, 0);

  console.log(`\n[apply-house-expansion] ─── TOTALS ───`);
  console.log(`  planned in-scope bills:        ${newBillKeys.size}`);
  console.log(`  planned roll-call votes:       ${totalPlannedVotes}`);
  console.log(`  vote rows to write (changed):  ${voteWrites}`);
  console.log(`  vote rows already-applied:     ${voteNoops} (idempotent no-op)`);
  console.log(`  House scorable bills BEFORE:   ${existingBillKeys.size}`);
  console.log(`  of planned, NOT already scorable: ${trulyNew.length}`);
  console.log(`  House DISTINCT-BILL TOTAL AFTER: ${unionBillKeys.size}`);

  if (!apply) {
    console.log(`\n[apply-house-expansion] DRY RUN complete — no DB writes performed. Re-run with --apply to write.`);
  } else {
    console.log(`\n[apply-house-expansion] APPLY complete — wrote ${voteWrites} vote row(s).`);
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
