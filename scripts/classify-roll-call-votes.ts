// v1.6 Phase B — classify every RollCallVote by plank + aligned position.
//
// Two-stage:
//   1. Rule-based classifier (src/lib/scorecard/plank-classifier.ts).
//      For ~70-80% of votes, the policy area + subject hints give us a
//      high-confidence classification.
//   2. LLM fallback for votes flagged as needsReview. (LLM call uses
//      Anthropic API if ANTHROPIC_API_KEY is set; otherwise skips and
//      leaves classifications at low confidence for later human review.)
//
// Writes plankNumbers, alignedPosition, classificationConfidence,
// classificationReasoning, isScorable on each RollCallVote.
//
// Run: npm run scorecard:classify-rollcalls
//      npm run scorecard:classify-rollcalls -- --dry-run
//      npm run scorecard:classify-rollcalls -- --rule-only  (skip LLM)

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { classifyVote, isSubstantiveVote, type PlankNumber } from '../src/lib/scorecard/plank-classifier';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

interface CliFlags {
  dryRun: boolean;
  ruleOnly: boolean;
  limit: number;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false, ruleOnly: false, limit: 0 };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--rule-only') flags.ruleOnly = true;
    else if (arg.startsWith('--limit=')) flags.limit = Number(arg.split('=')[1]);
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[classify-rollcalls] flags: ${JSON.stringify(flags)}`);

  // Skip votes already LLM-classified — rule-based pass would overwrite
  // their higher-quality classifications.
  let votes = await prisma.rollCallVote.findMany({
    where: { OR: [{ classifiedBy: null }, { classifiedBy: { not: 'kie-claude-opus-4-7' } }] },
    select: {
      id: true,
      chamber: true,
      rollCallNumber: true,
      sessionNumber: true,
      voteQuestion: true,
      voteType: true,
      billType: true,
      billNumber: true,
      billTitle: true,
      billPolicyArea: true,
      billSubjects: true,
      billSponsorParty: true,
    },
  });
  if (flags.limit > 0) votes = votes.slice(0, flags.limit);
  console.log(`[classify-rollcalls] ${votes.length} votes to classify`);

  // We don't have sponsorParty cached on RollCallVote (yet) — fetch from
  // a sponsor map per unique bill via a separate query if we end up needing
  // it. For now the classifier handles null sponsorParty by flagging for
  // review where it would change the alignment call.
  let scorable = 0;
  let notScorable = 0;
  let needsReview = 0;
  const byPlank = new Map<number, number>();
  const updates: Array<{
    id: string;
    plankNumbers: number[];
    alignedPosition: 'YES' | 'NO' | null;
    confidence: number;
    reasoning: string;
    isScorable: boolean;
  }> = [];

  for (const v of votes) {
    const subjects = Array.isArray(v.billSubjects) ? (v.billSubjects as string[]) : [];
    const classification = classifyVote({
      policyArea: v.billPolicyArea,
      subjects,
      title: v.billTitle ?? '',
      sponsorParty: v.billSponsorParty,
      voteQuestion: v.voteQuestion,
      voteType: v.voteType,
    });
    const isScorableNow =
      isSubstantiveVote(v.voteQuestion, v.voteType) &&
      classification.plankNumbers.length > 0 &&
      classification.alignedPosition !== null &&
      classification.confidence >= 0.5;
    if (isScorableNow) {
      scorable += 1;
      for (const p of classification.plankNumbers) byPlank.set(p, (byPlank.get(p) ?? 0) + 1);
    } else {
      notScorable += 1;
    }
    if (classification.needsReview) needsReview += 1;
    updates.push({
      id: v.id,
      plankNumbers: classification.plankNumbers,
      alignedPosition: classification.alignedPosition,
      confidence: classification.confidence,
      reasoning: classification.reasoning,
      isScorable: isScorableNow,
    });
  }

  console.log(`\n[classify-rollcalls] summary:`);
  console.log(`  scorable now:  ${scorable}`);
  console.log(`  not scorable:  ${notScorable}`);
  console.log(`  needs review:  ${needsReview}`);
  console.log(`  by plank (sum, can be >scorable since multi-plank possible):`);
  for (const [p, n] of [...byPlank.entries()].sort()) console.log(`    P${p}: ${n}`);

  if (flags.dryRun) {
    console.log(`\n[classify-rollcalls] DRY RUN — no DB writes`);
    console.log(`\n  Sample 10 scorable classifications:`);
    const sampleScorable = updates.filter((u) => u.isScorable).slice(0, 10);
    for (const u of sampleScorable) {
      const v = votes.find((x) => x.id === u.id)!;
      console.log(
        `    roll ${v.rollCallNumber}/S${v.sessionNumber}  ${(v.billType ?? '?').padEnd(8)}${(
          v.billNumber ?? ''
        ).padEnd(6)}  P${u.plankNumbers.join(',')}/${u.alignedPosition}  conf=${u.confidence.toFixed(2)}  ${(
          v.billTitle ?? ''
        ).slice(0, 50)}`,
      );
    }
    console.log(`\n  Sample 10 needs-review:`);
    const sampleReview = updates.filter((u) => !u.isScorable && u.plankNumbers.length > 0).slice(0, 10);
    for (const u of sampleReview) {
      const v = votes.find((x) => x.id === u.id)!;
      console.log(
        `    roll ${v.rollCallNumber}/S${v.sessionNumber}  ${(v.billType ?? '?').padEnd(8)}${(
          v.billNumber ?? ''
        ).padEnd(6)}  ${u.reasoning}`,
      );
    }
    await prisma.$disconnect();
    return;
  }

  // Bulk update — straight prisma.updateMany per row. ~537 rows is small.
  const now = new Date();
  let written = 0;
  for (const u of updates) {
    await prisma.rollCallVote.update({
      where: { id: u.id },
      data: {
        plankNumbers: u.plankNumbers,
        alignedPosition: u.alignedPosition,
        classificationConfidence: u.confidence,
        classificationReasoning: u.reasoning,
        classificationSource: 'auto',
        classifiedAt: now,
        classifiedBy: 'rule-based-v1',
        isScorable: u.isScorable,
      },
    });
    written += 1;
    if (written % 100 === 0) console.log(`  classified ${written}/${updates.length}`);
  }
  console.log(`[classify-rollcalls] ✓ ${written} votes classified`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
