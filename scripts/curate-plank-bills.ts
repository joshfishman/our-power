// Curate 119th-Congress passage-vote bills into a per-plank review worksheet.
//
// For every distinct bill that reached a passage-type floor vote, ask Claude
// (via KIE) whether it DIRECTLY and substantively serves one of the five
// Common Ground planks, in the people-serving direction — excluding naming /
// ceremonial bills, purely procedural votes, CRA / regulatory-disapproval
// resolutions, and tangential/indirect bills.
//
// Writes NOTHING to the DB. Emits data/plank-bill-curation.csv +
// data/plank-bill-curation.md for human review.
//
// Run: npx tsx scripts/curate-plank-bills.ts [--limit=N]
import './load-env';
import fs from 'fs';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const u = new URL(process.env.DATABASE_URL!);
if (!u.searchParams.has('pgbouncer')) u.searchParams.set('pgbouncer', 'true');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: u.toString() }) });

const KIE_API_KEY = process.env.KIE_API_KEY!;
const KIE_URL = 'https://api.kie.ai/claude/v1/messages';
const KIE_MODEL = 'claude-opus-4-7';
const BATCH = 10;
// KIE drops concurrent requests, so go sequential (CONCURRENCY=1). ~27 batches.
const CONCURRENCY = 1;
// KIE drops requests with large max_tokens (4000 fails; 1500 is reliable). 10
// bills × ~80 output tokens each fits comfortably under 1500.
const MAX_TOKENS = 1500;

const SYSTEM_PROMPT = `You curate U.S. federal bills for the Common Ground civic scorecard — a cross-partisan accountability tool. You decide whether a bill that received a floor vote should COUNT toward one of five planks, and which vote serves the people.

The five planks:
1. Honest Government — anti-corruption, congressional ethics, stock-trading ban, campaign-finance/dark-money reform, lobbying limits, transparency.
2. Our Children Our Future — public education, scientific research, clean energy, environmental protection, infrastructure, early childhood, broadband/water/transit.
3. Making a Living — minimum wage, worker rights, wage theft, non-competes, consumer financial protection (rate caps), housing supply/affordability, paid leave.
4. The Care We Owe — healthcare cost/access, Medicaid/Medicare protection, veterans' benefits (PACT etc.), Social Security solvency, paid family/medical leave, childcare.
5. Peace and Strength — war-powers reassertion, Pentagon audit/defense oversight, antitrust, diplomacy/State funding, labor+environmental protections in trade.

STRICT inclusion rules — KEEP a bill ONLY if it DIRECTLY and substantively advances (or directly attacks) a plank's goal. DROP (keep=false, plank=0) if it is:
- a naming/ceremonial bill (post offices, medals, commemorations, renaming),
- purely procedural,
- a Congressional Review Act resolution or other regulatory-disapproval/repeal resolution,
- only tangentially or indirectly related,
- off-theme for all five planks.

For KEPT bills, set the PEOPLE-SERVING direction:
- direction=YES when voting YES advances the plank (a bill that helps people in the plank's domain).
- direction=NO when voting NO advances the plank (the bill harms the plank's goal — e.g. cuts Medicaid, guts clean-energy funding, weakens worker protections — so the people-serving vote is NO).
Be willing to mark direction=NO for harmful bills; that is how we score opposition fairly.

Be conservative: when unsure whether a bill is substantive and direct, DROP it.`;

interface Bill {
  idx: number;
  key: string;
  chamber: string;
  billType: string;
  billNumber: string;
  title: string;
  policyArea: string;
  subjects: string[];
  sponsorParty: string;
}

interface Result {
  index: number;
  plank: number;
  direction: 'YES' | 'NO' | 'NA';
  keep: boolean;
  confidence: number;
  reason: string;
}

async function fetchWithRetry(body: unknown, tries = 4): Promise<Record<string, unknown> | null> {
  for (let t = 0; t < tries; t++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 90_000);
      const res = await fetch(KIE_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(to);
      if (!res.ok) {
        const errtxt = await res.text().catch(() => '');
        console.warn(`    [http ${res.status}] ${errtxt.slice(0, 160)}`);
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** t));
          continue;
        }
        return null;
      }
      const json = (await res.json()) as {
        content?: Array<{ type: string; input?: unknown }>;
        stop_reason?: string;
      };
      const tool = json.content?.find((c) => c.type === 'tool_use');
      if (!tool?.input) {
        console.warn(
          `    [no tool_use] stop=${json.stop_reason} content types=${json.content?.map((c) => c.type).join(',')}`,
        );
        return null;
      }
      return tool.input as Record<string, unknown>;
    } catch (e) {
      console.warn(`    [fetch err attempt ${t}] ${(e as Error).name}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** t));
    }
  }
  return null;
}

async function classifyBatch(bills: Bill[]): Promise<Map<number, Result>> {
  const list = bills
    .map(
      (b) =>
        `[${b.idx}] ${b.chamber} ${b.billType}${b.billNumber} — "${b.title}" | policy: ${
          b.policyArea
        } | subjects: ${b.subjects.slice(0, 6).join('; ')} | sponsor: ${b.sponsorParty}`,
    )
    .join('\n');
  const body = {
    model: KIE_MODEL,
    max_tokens: MAX_TOKENS,
    stream: false,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: 'curate',
        description: 'Return one classification per bill, keyed by its [index].',
        input_schema: {
          type: 'object',
          properties: {
            classifications: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  index: { type: 'integer' },
                  plank: { type: 'integer', description: '1-5, or 0 for none/drop' },
                  direction: { type: 'string', enum: ['YES', 'NO', 'NA'] },
                  keep: { type: 'boolean' },
                  confidence: { type: 'number' },
                  reason: { type: 'string', description: 'one short sentence' },
                },
                required: ['index', 'plank', 'direction', 'keep', 'confidence', 'reason'],
              },
            },
          },
          required: ['classifications'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'curate' },
    messages: [
      {
        role: 'user',
        content: `Curate these ${bills.length} bills. Return one entry per [index].\n\n${list}`,
      },
    ],
  };
  const out = await fetchWithRetry(body);
  const map = new Map<number, Result>();
  if (!out) {
    console.warn(`  [curate] batch starting ${bills[0]?.key} → NULL response (network/parse)`);
    return map;
  }
  const arr = (out.classifications as Result[]) ?? [];
  if (arr.length === 0) console.warn(`  [curate] batch ${bills[0]?.key} → out keys: ${Object.keys(out).join(',')}`);
  for (const r of arr) if (typeof r.index === 'number') map.set(r.index, r);
  return map;
}

async function main(): Promise<void> {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 0;

  const votes = await prisma.rollCallVote.findMany({
    where: { congressNumber: 119, billNumber: { not: null } },
    select: {
      chamber: true,
      billType: true,
      billNumber: true,
      billTitle: true,
      billPolicyArea: true,
      billSubjects: true,
      billSponsorParty: true,
      voteQuestion: true,
    },
  });
  const passage = votes.filter((v) => /passage|suspend the rules and pass|concur/i.test(v.voteQuestion || ''));
  const seen = new Set<string>();
  const bills: Bill[] = [];
  for (const v of passage) {
    const key = `${v.chamber}:${v.billType}${v.billNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bills.push({
      idx: bills.length,
      key,
      chamber: v.chamber,
      billType: v.billType!,
      billNumber: v.billNumber!,
      title: v.billTitle || '(no title)',
      policyArea: v.billPolicyArea || '(none)',
      subjects: Array.isArray(v.billSubjects) ? (v.billSubjects as string[]) : [],
      sponsorParty: v.billSponsorParty || '?',
    });
  }
  const work = limit > 0 ? bills.slice(0, limit) : bills;
  console.log(`[curate] ${work.length} distinct passage bills to classify (batch ${BATCH}, conc ${CONCURRENCY})`);

  const batches: Bill[][] = [];
  for (let i = 0; i < work.length; i += BATCH) batches.push(work.slice(i, i + BATCH));

  const results = new Map<number, Result>();
  let done = 0;
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const slice = batches.slice(i, i + CONCURRENCY);
    const maps = await Promise.all(slice.map((b) => classifyBatch(b)));
    for (const m of maps) for (const [idx, r] of m) results.set(idx, r);
    done += slice.reduce((s, b) => s + b.length, 0);
    console.log(`[curate]   ${done}/${work.length} classified (${results.size} results)`);
  }

  // Assemble rows
  const rows = work.map((b) => {
    const r = results.get(b.idx);
    return {
      ...b,
      plank: r?.plank ?? -1,
      direction: r?.direction ?? 'NA',
      keep: r?.keep ?? false,
      confidence: r?.confidence ?? 0,
      reason: (r?.reason ?? 'NO RESULT').replace(/"/g, "'").replace(/\n/g, ' '),
    };
  });

  // CSV
  const csv = ['chamber,bill,plank,direction,keep,confidence,policyArea,title,reason']
    .concat(
      rows.map(
        (r) =>
          `${r.chamber},${r.billType}${r.billNumber},${r.plank},${r.direction},${r.keep},${r.confidence},"${
            r.policyArea
          }","${r.title.replace(/"/g, "'")}","${r.reason}"`,
      ),
    )
    .join('\n');
  fs.writeFileSync('data/plank-bill-curation.csv', csv);

  // Markdown grouped by plank (kept only)
  let md = `# 119th passage-bill curation — review worksheet\n\nKEEP-flagged bills, grouped by plank. Score = vote on these (people-serving direction); cosponsorship is bonus.\n\n`;
  const kept = rows.filter((r) => r.keep && r.plank >= 1 && r.plank <= 5);
  const dropped = rows.filter((r) => !(r.keep && r.plank >= 1 && r.plank <= 5));
  const PLANK = [
    '',
    'Honest Government',
    'Our Children Our Future',
    'Making a Living',
    'The Care We Owe',
    'Peace and Strength',
  ];
  for (let pl = 1; pl <= 5; pl++) {
    const inPlank = kept.filter((r) => r.plank === pl).sort((a, b) => b.confidence - a.confidence);
    md += `\n## Plank ${pl}: ${PLANK[pl]} — ${inPlank.length} bills\n\n`;
    md += `| Chamber | Bill | Serve-vote | Conf | Title | Why |\n|---|---|---|--:|---|---|\n`;
    for (const r of inPlank) {
      md += `| ${r.chamber === 'SENATE' ? 'Sen' : 'House'} | ${r.billType}${r.billNumber} | **${
        r.direction
      }** | ${r.confidence.toFixed(2)} | ${r.title.slice(0, 70)} | ${r.reason} |\n`;
    }
  }
  md += `\n## Dropped (${dropped.length}) — naming / CRA / procedural / off-theme / tangential\n\n`;
  md += `| Chamber | Bill | Title | Why |\n|---|---|---|---|\n`;
  for (const r of dropped.slice(0, 200))
    md += `| ${r.chamber === 'SENATE' ? 'Sen' : 'House'} | ${r.billType}${r.billNumber} | ${r.title.slice(0, 70)} | ${
      r.reason
    } |\n`;
  fs.writeFileSync('data/plank-bill-curation.md', md);

  // Summary
  console.log(`\n[curate] KEPT ${kept.length} / DROPPED ${dropped.length}`);
  for (let pl = 1; pl <= 5; pl++) {
    const inPlank = kept.filter((r) => r.plank === pl);
    const h = inPlank.filter((r) => r.chamber !== 'SENATE').length;
    const s = inPlank.filter((r) => r.chamber === 'SENATE').length;
    const yes = inPlank.filter((r) => r.direction === 'YES').length;
    const no = inPlank.filter((r) => r.direction === 'NO').length;
    console.log(`  Plank ${pl}: ${inPlank.length} kept (House ${h}, Sen ${s}) · serve-YES ${yes}, serve-NO ${no}`);
  }
  console.log(`\n[curate] wrote data/plank-bill-curation.csv + data/plank-bill-curation.md`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
