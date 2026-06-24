// One-off corrective pass: flip isScorable=false on procedural roll-call votes
// that were wrongly marked scorable.
//
// Root cause: isSubstantiveVote() listed "On Motion to Recommit" as a
// substantive vote, and its exact-match procedural set missed suffixed
// variants (e.g. "On Ordering the Previous Question (H. Res. …)"). A Motion to
// Recommit is the minority party's procedural tool — scoring it inverts
// direction (the whole party votes YES on its own MTR, but the underlying
// bill's aligned direction is the opposite), so members got dinged for voting
// WITH their party. This pass re-evaluates every scorable vote against the
// corrected isSubstantiveVote() and flips the now-procedural ones.
//
// Surgical: ONLY touches isScorable. alignedPosition / plankNumbers /
// classificationSource are left untouched, so human/LLM review work is
// preserved. After this, recompute the Voting Record:
//   npm run scorecard:compute-v17 -- --publish
//
// Run:
//   npx tsx scripts/fix-procedural-scorable.ts --dry-run
//   npx tsx scripts/fix-procedural-scorable.ts

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! }),
});

// A vote is procedural (NOT a clean policy position) when its question is a
// minority/floor procedural motion. We use a TARGETED denylist rather than the
// narrow isSubstantiveVote() whitelist, because final-passage votes are worded
// many ways (CA "Be adopted. To third reading", "Motion to Concur in the
// Senate Amendment", war-powers "On Agreeing to the Resolution") and must NOT
// be swept up. The substantive guard runs first so anything that is final
// passage / concurrence / third reading / a conference report is always kept.
function isProceduralVote(q: string): boolean {
  const s = q.trim();
  if (/Concur|Concurrence|Third Reading|On Passage|Final Passage|Conference Report/i.test(s)) return false;
  return /Motion to Recommit|Previous Question|Motion to Table|Motion to Adjourn|Motion to Reconsider|Motion to Commit\b|Motion to Proceed|Approving the Journal|Question of Consideration|\bQuorum\b|Election of|On the Speaker/i.test(
    s,
  );
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const scorable = await prisma.rollCallVote.findMany({
    where: { isScorable: true },
    select: { id: true, voteQuestion: true, voteType: true },
  });
  const toFlip = scorable.filter((v) => isProceduralVote(v.voteQuestion));

  // Tally by normalized question so the report is readable.
  const byQuestion = new Map<string, number>();
  for (const v of toFlip) byQuestion.set(v.voteQuestion, (byQuestion.get(v.voteQuestion) ?? 0) + 1);

  console.log(`[fix-procedural] ${scorable.length} scorable votes; ${toFlip.length} now procedural → isScorable=false`);
  for (const [q, n] of [...byQuestion.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)} · ${q}`);
  }

  if (dryRun) {
    console.log('\n[fix-procedural] DRY RUN — no writes');
    await prisma.$disconnect();
    return;
  }
  if (toFlip.length > 0) {
    const res = await prisma.rollCallVote.updateMany({
      where: { id: { in: toFlip.map((v) => v.id) } },
      data: { isScorable: false },
    });
    console.log(`\n[fix-procedural] flipped ${res.count} votes to isScorable=false`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
