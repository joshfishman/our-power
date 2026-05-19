// v1.6 Phase B — LLM-classify roll-call votes whose rule-based classification
// is low-confidence or needs-review. Uses KIE.AI's Claude Opus 4.7 endpoint
// (Anthropic-compatible Messages API) with tool-use to force structured JSON.
//
// Cost: ~0.20 credits per bill × ~340 unique bills = ~$70 worst case.
// One call per unique bill (not per vote) — multiple votes on the same
// bill (passage + recommit + concurrence) share the classification.
//
// Run: npm run scorecard:classify-llm
//      npm run scorecard:classify-llm -- --dry-run
//      npm run scorecard:classify-llm -- --only-needs-review  (default; skips high-confidence rule-based)
//      npm run scorecard:classify-llm -- --reclassify-all

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const KIE_API_KEY = process.env.KIE_API_KEY!;
const KIE_URL = 'https://api.kie.ai/claude/v1/messages';
const KIE_MODEL = 'claude-opus-4-7';
const PARALLEL = 5; // concurrent LLM calls

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

interface CliFlags {
  dryRun: boolean;
  reclassifyAll: boolean;
  limit: number;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false, reclassifyAll: false, limit: 0 };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--reclassify-all') flags.reclassifyAll = true;
    else if (arg.startsWith('--limit=')) flags.limit = Number(arg.split('=')[1]);
  }
  return flags;
}

const SYSTEM_PROMPT = `You are a methodology analyst for the Common Ground civic scorecard, a cross-partisan accountability rating for U.S. Congress.

The scorecard scores legislators on five planks:

1. **Honest Government** — corporate-PAC refusal, stock-trading ban, public financing of elections, dark-money disclosure, lobbying reform, voting rights.
2. **Our Children Our Future** — public education funding, clean energy / climate (solar, wind, nuclear), science / research funding, environmental protection, infrastructure (broadband, water, roads), early childhood education.
3. **Making a Living** — federal minimum wage, wage theft enforcement, paid family leave, affordable housing supply, predatory lending caps, worker protections, non-compete bans.
4. **The Care We Owe** — Medicare / Medicaid protection, prescription drug pricing, veterans benefits (PACT Act), Social Security solvency, childcare funding.
5. **Peace and Strength** — war powers reassertion (Congress, not exec), Pentagon audit, antitrust against monopolies, State Department / diplomatic funding, trade-agreement labor protections.

For each bill, classify:
- Which plank(s) does this bill belong to? Most belong to 0 or 1 plank. Some bills cross planks (e.g., a child-tax-credit bill touches P3 and P4). Bills wholly outside the five planks (immigration enforcement, judicial nominations, censures, naming post offices, ceremonial resolutions) get []. Procedural bills (rules for considering other bills) also get [].
- What's the platform-aligned position (YES or NO)? Platform-aligned = the position a legislator who agrees with the Common Ground platform should take. Most pro-plank bills are aligned=YES; bills that cut against the planks are aligned=NO. Republican-led "Option C" alternatives in Planks 3 & 4 (e.g., Hawley's Higher Wages Act, Bice-Houlahan paid leave) are platform-aligned even though R-sponsored.
- Confidence: 0.0-1.0. Use 0.5 only when genuinely uncertain.
- Reasoning: one short sentence explaining the call.

The platform is cross-partisan and civic, not progressive. It opposes both:
- Corporate-money capture of politics (anti-corporate-PAC)
- War-without-limit / endless military expansion
- Cuts to Medicare/Medicaid/Social Security
- Anti-voter laws

It supports:
- Worker wages
- Clean energy investment
- Veteran care
- Pentagon accountability
- Bipartisan ethics reforms (regardless of which party leads them)

Output JSON via the classifyBill tool. Be precise.`;

interface BillInfo {
  billType: string;
  billNumber: string;
  billTitle: string;
  billPolicyArea: string | null;
  billSubjects: string[];
  billSponsorParty: string | null;
}

interface LlmClassification {
  plankNumbers: number[];
  alignedPosition: 'YES' | 'NO' | null;
  confidence: number;
  reasoning: string;
}

async function classifyBillWithLlm(bill: BillInfo): Promise<LlmClassification | null> {
  const userText = `Classify this bill against the 5 Common Ground planks.

Bill: ${bill.billType} ${bill.billNumber}
Title: ${bill.billTitle || '(no title)'}
Policy area: ${bill.billPolicyArea ?? '(none)'}
Subjects: ${bill.billSubjects.slice(0, 8).join('; ') || '(none)'}
Sponsor party: ${bill.billSponsorParty ?? 'unknown'}

Output via the classifyBill tool.`;

  const body = {
    model: KIE_MODEL,
    max_tokens: 400,
    stream: false,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: 'classifyBill',
        description: 'Return the Common Ground classification for this bill.',
        input_schema: {
          type: 'object',
          properties: {
            plankNumbers: {
              type: 'array',
              items: { type: 'integer', enum: [1, 2, 3, 4, 5] },
              description: 'Which plank(s) does this bill relate to? Empty array if none.',
            },
            alignedPosition: {
              type: 'string',
              enum: ['YES', 'NO', 'NEUTRAL'],
              description: 'What position aligns with the Common Ground platform. NEUTRAL when bill is off-plank.',
            },
            confidence: {
              type: 'number',
              description: '0.0 (very uncertain) to 1.0 (highly confident)',
            },
            reasoning: {
              type: 'string',
              description: 'One short sentence explaining the classification.',
            },
          },
          required: ['plankNumbers', 'alignedPosition', 'confidence', 'reasoning'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'classifyBill' },
    messages: [{ role: 'user', content: userText }],
  };

  const res = await fetch(KIE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(`  [llm] HTTP ${res.status} for ${bill.billType}/${bill.billNumber}: ${text.slice(0, 200)}`);
    return null;
  }
  const json = (await res.json()) as { content?: Array<{ type: string; input?: unknown }> };
  const toolBlock = json.content?.find((c) => c.type === 'tool_use');
  if (!toolBlock?.input) return null;
  const out = toolBlock.input as Record<string, unknown>;
  // Defensive coercion — LLM occasionally returns the wrong types.
  let plankNumbers: number[] = [];
  const raw = out.plankNumbers;
  if (Array.isArray(raw)) {
    plankNumbers = raw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
  } else if (typeof raw === 'string') {
    // Sometimes returned as "1,2" or "[1,2]"
    plankNumbers = raw
      .replace(/[\[\]\s]/g, '')
      .split(',')
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
  } else if (typeof raw === 'number') {
    if (Number.isInteger(raw) && raw >= 1 && raw <= 5) plankNumbers = [raw];
  }
  const alignedPosition =
    out.alignedPosition === 'YES' || out.alignedPosition === 'NO' ? (out.alignedPosition as 'YES' | 'NO') : null;
  const confidence = typeof out.confidence === 'number' ? out.confidence : Number(out.confidence) || 0;
  const reasoning = typeof out.reasoning === 'string' ? out.reasoning : '';
  return { plankNumbers, alignedPosition, confidence, reasoning };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[classify-llm] flags: ${JSON.stringify(flags)}`);

  // Pull unique bills from RollCallVote. We classify per bill (one LLM call),
  // then apply the classification to all votes on that bill.
  let bills = await prisma.rollCallVote.groupBy({
    by: ['billType', 'billNumber', 'billTitle', 'billPolicyArea', 'billSubjects', 'billSponsorParty'],
    where: {
      billNumber: { not: null },
      billType: { not: null },
      // Default: only re-classify bills whose current classification is low-confidence
      ...(flags.reclassifyAll
        ? {}
        : { OR: [{ classificationConfidence: { lt: 0.8 } }, { classificationConfidence: null }] }),
    },
    _count: { _all: true },
  });
  console.log(`[classify-llm] ${bills.length} unique bills to LLM-classify`);
  if (flags.limit > 0) bills = bills.slice(0, flags.limit);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const billClassifications: Array<{ bill: BillInfo; result: LlmClassification }> = [];

  // Process in parallel batches
  for (let i = 0; i < bills.length; i += PARALLEL) {
    const slice = bills.slice(i, i + PARALLEL);
    const results = await Promise.all(
      slice.map(async (b) => {
        const bill: BillInfo = {
          billType: b.billType!,
          billNumber: b.billNumber!,
          billTitle: b.billTitle ?? '',
          billPolicyArea: b.billPolicyArea,
          billSubjects: Array.isArray(b.billSubjects) ? (b.billSubjects as string[]) : [],
          billSponsorParty: b.billSponsorParty,
        };
        const cls = await classifyBillWithLlm(bill);
        return { bill, result: cls };
      }),
    );
    for (const r of results) {
      processed += 1;
      if (r.result) {
        succeeded += 1;
        billClassifications.push({ bill: r.bill, result: r.result });
      } else {
        failed += 1;
      }
    }
    if ((i / PARALLEL) % 4 === 0) {
      console.log(`  classified ${processed}/${bills.length} (${succeeded} ok, ${failed} fail)`);
    }
  }
  console.log(`[classify-llm] LLM done: ${succeeded} classified, ${failed} failed`);

  // Stats
  const buckets = new Map<number, number>();
  const noPlank = billClassifications.filter((b) => b.result.plankNumbers.length === 0).length;
  for (const c of billClassifications) {
    for (const p of c.result.plankNumbers) buckets.set(p, (buckets.get(p) ?? 0) + 1);
  }
  console.log(`\n[classify-llm] LLM classification distribution:`);
  console.log(`  no plank: ${noPlank}`);
  for (const p of [1, 2, 3, 4, 5]) console.log(`  P${p}: ${buckets.get(p) ?? 0}`);

  if (flags.dryRun) {
    console.log(`\n[classify-llm] DRY RUN — sample 10 classifications:`);
    for (const c of billClassifications.slice(0, 10)) {
      console.log(
        `  ${c.bill.billType}/${c.bill.billNumber}  P[${c.result.plankNumbers.join(',')}]/${
          c.result.alignedPosition ?? '-'
        }  conf=${c.result.confidence.toFixed(2)}  "${c.bill.billTitle.slice(0, 60)}"`,
      );
      console.log(`     ${c.result.reasoning}`);
    }
    await prisma.$disconnect();
    return;
  }

  // Apply classifications: update RollCallVote for every vote on each bill.
  // Wrap each in a try/catch so one bad row doesn't kill the whole batch.
  const now = new Date();
  let updated = 0;
  let writeErrors = 0;
  for (const c of billClassifications) {
    const isScorable =
      c.result.plankNumbers.length > 0 && c.result.alignedPosition !== null && c.result.confidence >= 0.5;
    try {
      const r = await prisma.rollCallVote.updateMany({
        where: { billType: c.bill.billType, billNumber: c.bill.billNumber },
        data: {
          plankNumbers: c.result.plankNumbers,
          alignedPosition: c.result.alignedPosition,
          classificationConfidence: c.result.confidence,
          classificationReasoning: c.result.reasoning,
          classificationSource: 'auto',
          classifiedAt: now,
          classifiedBy: 'kie-claude-opus-4-7',
          isScorable,
        },
      });
      updated += r.count;
    } catch (err) {
      writeErrors += 1;
      console.warn(
        `  [warn] write failed for ${c.bill.billType}/${c.bill.billNumber}: ${(err as Error).message.slice(0, 100)}`,
      );
    }
  }
  if (writeErrors > 0) console.log(`[classify-llm] ${writeErrors} write errors (logged above)`);
  console.log(
    `[classify-llm] ✓ updated ${updated} RollCallVote rows from ${billClassifications.length} unique-bill classifications`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
