// v1.9.x — KIE LLM classifier for PAC FUNDER committees (campaign-finance
// committees), mirroring scripts/classify-with-llm.ts (the bill classifier).
//
// ─── SAFETY (READ THIS FIRST) ───────────────────────────────────────────────
// The public PAC Score is LIVE and is the published headline. The live score
// reads PacClassification.class (the enum) at query time:
//   - getPacScoresByLegislatorV171  (src/lib/scorecard/queries.ts:469)
//   - getLegislatorMoneyTrail       (src/lib/scorecard/queries.ts:562/568)
//   - getLegislatorPacScore / getPacScoresByLegislator read pre-computed
//     PacMoneyData ratios — they don't touch PacClassification at all.
// NONE of the live read paths read PacClassification.finalClass.
//
// Therefore this script NEVER writes the database. It emits REVIEWABLE
// PROPOSALS to a JSON file in the exact shape that scripts/apply-unknown-batch.ts
// already consumes ({ committeeId: { class, reason } }), plus a human-readable
// review sidecar CSV (committee, $impact, proposed class, confidence, reasoning).
// Because no DB column is written, no legislator's live PAC Score can move
// until a human reviews the proposals and runs apply-unknown-batch.ts (which
// itself only promotes rows that are currently class='UNKNOWN' AND
// finalClass IS NULL). Coordination, not control: the human is the gate.
//
// ─── INPUT PRIORITIZATION ────────────────────────────────────────────────────
// We classify the UNKNOWN PacClassification committees with the LARGEST dollar
// impact first: the sum of counts-eligible PacContribution flowing to scored
// (published-score) legislators. Biggest-dollar UNKNOWNs are where a wrong
// classification most distorts the headline, so they're worth a human's review
// time first.
//
// Run:
//   npm run scorecard:classify-committees-llm -- --dry-run --limit=10
//   npm run scorecard:classify-committees-llm -- --limit=10
//   npm run scorecard:classify-committees-llm -- --top=300
//   npm run scorecard:classify-committees-llm -- --out=data/committee-proposals-202606.json
//
// Cost: ~1 KIE call per committee at ~300 output tokens. --limit / --top bound it.

import './load-env';
import fs from 'fs';
import path from 'path';
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

// Confidence below which a proposal is flagged needsHumanLook=true in the
// review sidecar (still written, but surfaced for closer scrutiny). Mirrors the
// bill classifier's lock threshold concept — but here NOTHING is auto-applied,
// so this is advisory only.
const LOW_CONFIDENCE_THRESHOLD = 0.6;

// The PacClass enum values that apply-unknown-batch.ts will accept. These are
// the ACTUAL Prisma enum members — there is intentionally no TRADE_ASSOCIATION
// in PacClass (that label lives in the separate CommitteeClassification
// taxonomy); trade-association PACs map to CORPORATE here, consistent with the
// existing taxonomy in scripts/llm-classify-pacs.ts.
const VALID_CLASSES = [
  'CORPORATE',
  'DARK_MONEY',
  'FOREIGN_POLICY',
  'ACTIVIST',
  'LABOR',
  'LEADERSHIP',
  'IDEOLOGICAL',
  'CONDUIT',
  'PARTY',
  'UNKNOWN',
] as const;
type PacClassName = (typeof VALID_CLASSES)[number];

// Reused verbatim from scripts/llm-classify-pacs.ts so the DB-driven and
// CSV-driven classifiers stay calibration-consistent. Cross-partisan, factual
// voice — no "progressive / MAGA / stakeholders / equity".
const SYSTEM_PROMPT = `You are a campaign-finance taxonomy expert classifying federal PACs for the Common Ground civic scorecard.

Each PAC must fit one of these classes:

1. CORPORATE — Industry-aligned PACs. Includes:
   - Direct corporate PACs (Boeing PAC, Pfizer PAC, AT&T PAC, Comcast PAC)
   - Trade-association PACs that lobby for industry interests (Realtors, Bankers, Insurance Brokers, AMA, AHIP, PhRMA, NFIB, Chamber of Commerce)
   - Crypto industry super PACs (Fairshake, Defend American Jobs, Protect Progress)
   - Law/lobbying firm PACs (Akin Gump, Holland & Knight)
   - Accounting/consulting firm PACs (Deloitte, EY, KPMG, McKinsey)
   - Medical specialty associations operating as corporate lobby (AAFP, ACEP)

2. FOREIGN_POLICY — US-domiciled PACs whose primary purpose is shaping US foreign policy toward a specific country or region. They reward/punish legislators based on foreign-policy votes. Examples: AIPAC, J Street, Republican Jewish Coalition, NORPAC, Democratic Majority for Israel, Pro-Israel America, United Democracy Project, Turkish/Indian/Cuban/Korean/Vietnamese American political PACs.

3. DARK_MONEY — Partisan super PACs and 501(c)(4)-aligned PACs heavily funded by large-donor networks or undisclosed donors, not transparent small-dollar grassroots. Examples:
   - Senate Conservatives Fund, Club for Growth, Crossroads, Senate Leadership Fund, Congressional Leadership Fund, America PAC, Preserve America, Restoration, Americans for Prosperity Action, Sentinel Action Fund, Lincoln Project.
   - Senate Majority PAC, House Majority PAC, Future Forward, Priorities USA, American Bridge, Majority Forward, Democracy PAC, Sixteen Thirty Fund.
   - State-focused: Buckeye Values, Leadership for Ohio, Battleground NY, A Better Wisconsin Together.

4. LABOR — Labor union PACs and labor-affiliated political committees. Examples: SEIU COPE, LIUNA PAC, AFT, IBEW, UFCW, AFSCME, NEA, Air Line Pilots, Teamsters, UA Plumbers & Pipefitters, Communications Workers of America, National Nurses United.

5. ACTIVIST — Single-issue cause advocacy PACs. The org's purpose is to advance a specific policy commitment (gun policy either direction, climate, abortion either direction, women's representation, voting rights, civil rights, veterans' advocacy, immigration) rather than just elect candidates. Examples: Everytown, Giffords, Gun Owners of America, Sierra Club, LCV Victory Fund, EDF Action, Planned Parenthood, NARAL, EMILY's List, Susan B Anthony List, HRC PAC, ACLU PAC, End Citizens United, Common Cause, RepresentUs, VoteVets, With Honor.

6. IDEOLOGICAL — BROAD partisan/values grassroots PACs that aren't single-issue (broad caucus PACs, generic small-dollar partisan PACs without large-donor funding). Distinct from ACTIVIST (single-cause). Most PACs aren't here — when in doubt between IDEOLOGICAL and ACTIVIST, prefer ACTIVIST if there's a clear cause.

7. LEADERSHIP — Politician-controlled PACs that distribute money to other candidates. The PAC bears a politician's name, common phrases ("Friends of", "Team X"), or is sponsored by their candidate committee. Examples: AMERIPAC (Hoyer), Eye of the Tiger PAC (Scalise), PAC to the Future (Pelosi), E-PAC (Stefanik), Stand for America (Haley), In the Arena (Ernst). Note: ideological orgs with "Victory Fund" in the name (LCV Victory Fund, Everytown Victory Fund) are NOT leadership — they go to ACTIVIST.

8. PARTY — Party committees: DCCC/NRCC/DSCC/NRSC/RNC/DNC and state party committees. Party apparatus supporting its own candidates.

9. CONDUIT — Earmarking/conduit committees that bundle individual contributions to candidates (e.g. ActBlue, WinRed) without taking a position of their own.

10. UNKNOWN — RARELY USED. Reserve only for committees whose name is a pure acronym with no contextual hint AND no connected organization. NOT acceptable for any PAC with patriotic vocabulary, industry keywords, single-issue phrasing, state names, or a politician's name. Make the call.

Disambiguation tips:
- "Action Fund"/"Action" suffix on a partisan-named PAC (AFP Action, Sentinel Action) = Super PAC arm of an ideological/dark-money group → usually DARK_MONEY.
- State-named Super PAC + significant independent-expenditure spending → DARK_MONEY.
- Auto / Automotive / Auto Dealers / Free Trade PACs → CORPORATE.
- Named after a politician (Friends of X) → LEADERSHIP.
- Generic patriotic super PAC name with no connected org + high IE spending → DARK_MONEY.

Methodology stance (factual, cross-partisan — applied identically regardless of party):
- CORPORATE, FOREIGN_POLICY, DARK_MONEY count AGAINST the legislator's PAC score (concentrated influence-buying signals).
- ACTIVIST, LABOR, IDEOLOGICAL, LEADERSHIP, PARTY, CONDUIT do NOT count against (cause advocacy, labor organizing, broad partisan grassroots, intra-political transfer, or party/conduit mechanics).
- If a Super PAC has a clear cause in its name, classify as ACTIVIST even if large-donor-funded; if it's a vague patriotic name with no cause, classify as DARK_MONEY.

Output JSON via the classifyCommittee tool. Be precise and factual.`;

interface CommitteeInfo {
  committeeId: string;
  name: string;
  committeeType: string | null;
  orgType: string | null;
  connectedOrg: string | null;
  dollarImpact: number; // counts-eligible $ to scored legislators
  legislatorCount: number;
}

interface LlmCommitteeClassification {
  class: PacClassName;
  confidence: number;
  reasoning: string;
}

interface CliFlags {
  dryRun: boolean;
  limit: number;
  top: number;
  force: boolean; // include even committees already proposed in a prior run's out file
  out: string;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    dryRun: false,
    limit: 0,
    top: 0,
    force: false,
    out: 'data/committee-proposals.json',
  };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--force') flags.force = true;
    else if (arg.startsWith('--limit=')) flags.limit = Number(arg.split('=')[1]);
    else if (arg.startsWith('--top=')) flags.top = Number(arg.split('=')[1]);
    else if (arg.startsWith('--out=')) flags.out = arg.split('=').slice(1).join('=');
  }
  return flags;
}

async function classifyCommitteeWithLlm(c: CommitteeInfo): Promise<LlmCommitteeClassification | null> {
  const userText = `Classify this federal campaign-finance committee into one Common Ground PAC class.

Committee name: ${c.name || '(no name)'}
FEC committee ID: ${c.committeeId}
Committee type (FEC): ${c.committeeType ?? '(none)'}
Org type (FEC): ${c.orgType ?? '(none)'}
Connected organization: ${c.connectedOrg ?? '(none)'}

Output via the classifyCommittee tool.`;

  const body = {
    model: KIE_MODEL,
    max_tokens: 400,
    stream: false,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: 'classifyCommittee',
        description: 'Return the Common Ground PAC class for this committee.',
        input_schema: {
          type: 'object',
          properties: {
            class: {
              type: 'string',
              enum: [...VALID_CLASSES],
              description: 'The single best-fit PAC class.',
            },
            confidence: {
              type: 'number',
              description: '0.0 (very uncertain) to 1.0 (highly confident). Use 0.5 only when genuinely uncertain.',
            },
            reasoning: {
              type: 'string',
              description: 'One short sentence explaining the call (what the committee is and why it fits the class).',
            },
          },
          required: ['class', 'confidence', 'reasoning'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'classifyCommittee' },
    messages: [{ role: 'user', content: userText }],
  };

  const res = await fetch(KIE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(`  [llm] HTTP ${res.status} for ${c.committeeId}: ${text.slice(0, 200)}`);
    return null;
  }
  const json = (await res.json()) as { content?: Array<{ type: string; input?: unknown }> };
  const toolBlock = json.content?.find((b) => b.type === 'tool_use');
  if (!toolBlock?.input) return null;
  const out = toolBlock.input as Record<string, unknown>;

  const rawClass = typeof out.class === 'string' ? out.class.trim().toUpperCase() : '';
  const cls = (VALID_CLASSES as readonly string[]).includes(rawClass) ? (rawClass as PacClassName) : null;
  if (cls === null) {
    console.warn(`  [llm] invalid class "${rawClass}" for ${c.committeeId} — skipping`);
    return null;
  }
  const confidenceRaw = typeof out.confidence === 'number' ? out.confidence : Number(out.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;
  const reasoning = typeof out.reasoning === 'string' ? out.reasoning : '';
  return { class: cls, confidence, reasoning };
}

// Rank UNKNOWN committees by counts-eligible dollars flowing to published-score
// legislators. We only sum the kinds the live PAC Score actually counts
// (DIRECT, JFC_PASS_THROUGH, LEADERSHIP_PASS_THROUGH, IE_SUPPORT) so the dollar
// ranking matches the score's exposure surface.
async function loadUnknownCommitteesByDollarImpact(limit: number): Promise<CommitteeInfo[]> {
  // SQL-level LIMIT. Prisma binds the interpolated number as a query parameter
  // (same pattern as src/lib/scorecard/queries.ts:753 `LIMIT ${limit}`), so this
  // is injection-safe — `limit` is also Number()-coerced at parse time. limit<=0
  // means "all rows": we use a high sentinel bound so the planner can still
  // short-circuit the GROUP BY/ORDER BY rather than materialize every group.
  const sqlLimit = limit > 0 ? limit : 1_000_000;

  // PERF: rank by SUM($) ONLY. We deliberately do NOT compute
  // COUNT(DISTINCT legislatorId) in the ranking pass — on the 1.8M-row
  // PacContribution table that per-group DISTINCT was the entire cost (~226s
  // and tripped the server statement_timeout). SUM-only over the same filter
  // is ~12s. The DISTINCT legislator count is informational (review sidecar
  // only, not used for ranking), so we enrich just the top-N ids with it in a
  // cheap follow-up below. Raise the per-statement timeout for this session
  // only (CLI script connection; does not affect the app's pooled connections).
  await prisma.$executeRawUnsafe(`SET statement_timeout = '180000'`);
  const ranked = await prisma.$queryRaw<Array<{ committeeId: string; dollarImpact: string }>>`
    WITH published_legs AS (
      SELECT DISTINCT "legislatorId" FROM "RepresentativeScore" WHERE "publishedAt" IS NOT NULL
    ),
    unknown_cmtes AS (
      SELECT "committeeId" FROM "PacClassification" WHERE class = 'UNKNOWN' AND "finalClass" IS NULL
    )
    SELECT
      pcontrib."donorCommitteeId"        AS "committeeId",
      SUM(pcontrib.amount::numeric)::text AS "dollarImpact"
    FROM "PacContribution" pcontrib
    WHERE pcontrib.kind IN ('DIRECT', 'JFC_PASS_THROUGH', 'LEADERSHIP_PASS_THROUGH', 'IE_SUPPORT')
      AND pcontrib."legislatorId" IN (SELECT "legislatorId" FROM published_legs)
      AND pcontrib."donorCommitteeId" IN (SELECT "committeeId" FROM unknown_cmtes)
    GROUP BY pcontrib."donorCommitteeId"
    ORDER BY SUM(pcontrib.amount::numeric) DESC
    LIMIT ${sqlLimit}
  `;
  if (ranked.length === 0) return [];

  const topIds = ranked.map((r) => r.committeeId);

  // Enrich the (small) top-N set with committee metadata — cheap @id lookups.
  const metaRows = await prisma.pacClassification.findMany({
    where: { committeeId: { in: topIds } },
    select: { committeeId: true, name: true, committeeType: true, orgType: true, connectedOrg: true },
  });
  const metaById = new Map(metaRows.map((m) => [m.committeeId, m]));

  // DISTINCT legislator count, but only for the top-N ids (small set → fast).
  const legCountRows = await prisma.$queryRaw<Array<{ committeeId: string; legislatorCount: bigint }>>`
    WITH published_legs AS (
      SELECT DISTINCT "legislatorId" FROM "RepresentativeScore" WHERE "publishedAt" IS NOT NULL
    )
    SELECT
      pcontrib."donorCommitteeId"               AS "committeeId",
      COUNT(DISTINCT pcontrib."legislatorId")   AS "legislatorCount"
    FROM "PacContribution" pcontrib
    WHERE pcontrib.kind IN ('DIRECT', 'JFC_PASS_THROUGH', 'LEADERSHIP_PASS_THROUGH', 'IE_SUPPORT')
      AND pcontrib."legislatorId" IN (SELECT "legislatorId" FROM published_legs)
      AND pcontrib."donorCommitteeId" = ANY(${topIds})
    GROUP BY pcontrib."donorCommitteeId"
  `;
  const legCountById = new Map(legCountRows.map((r) => [r.committeeId, Number(r.legislatorCount)]));

  // Preserve the dollar-ranked order from the ranking query.
  return ranked.map((r) => {
    const m = metaById.get(r.committeeId);
    return {
      committeeId: r.committeeId,
      name: m?.name ?? '',
      committeeType: m?.committeeType ?? null,
      orgType: m?.orgType ?? null,
      connectedOrg: m?.connectedOrg ?? null,
      dollarImpact: Number(r.dollarImpact),
      legislatorCount: legCountById.get(r.committeeId) ?? 0,
    };
  });
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[classify-committees] flags: ${JSON.stringify(flags)}`);

  // top and limit both bound the candidate set; the effective cap is the
  // smaller positive of the two (top is just a friendlier alias for limit).
  let cap = 0;
  if (flags.limit > 0 && flags.top > 0) cap = Math.min(flags.limit, flags.top);
  else cap = flags.limit > 0 ? flags.limit : flags.top;

  let committees = await loadUnknownCommitteesByDollarImpact(cap);
  console.log(
    `[classify-committees] ${committees.length} UNKNOWN (finalClass-null) committees with money to published-score legislators`,
  );

  // Idempotency: skip committees already present in the out file unless --force.
  const proposalPath = path.resolve(process.cwd(), flags.out);
  let existing: Record<string, { class: string; reason: string }> = {};
  if (fs.existsSync(proposalPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(proposalPath, 'utf-8')) as Record<
        string,
        { class: string; reason: string }
      >;
      console.log(`[classify-committees] loaded ${Object.keys(existing).length} existing proposals from ${flags.out}`);
    } catch {
      console.warn(`[classify-committees] could not parse existing ${flags.out}; treating as empty`);
    }
  }
  if (!flags.force) {
    const before = committees.length;
    committees = committees.filter((c) => existing[c.committeeId] === undefined);
    if (before !== committees.length) {
      console.log(`[classify-committees] skipped ${before - committees.length} already-proposed (use --force to redo)`);
    }
  }

  if (committees.length === 0) {
    console.log('[classify-committees] nothing to classify.');
    await prisma.$disconnect();
    return;
  }

  const results: Array<{ committee: CommitteeInfo; result: LlmCommitteeClassification }> = [];
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < committees.length; i += PARALLEL) {
    const slice = committees.slice(i, i + PARALLEL);
    const batch = await Promise.all(
      slice.map(async (c) => ({ committee: c, result: await classifyCommitteeWithLlm(c) })),
    );
    for (const r of batch) {
      processed += 1;
      if (r.result) {
        succeeded += 1;
        results.push({ committee: r.committee, result: r.result });
      } else {
        failed += 1;
      }
    }
    console.log(`  classified ${processed}/${committees.length} (${succeeded} ok, ${failed} fail)`);
  }
  console.log(`[classify-committees] LLM done: ${succeeded} classified, ${failed} failed`);

  // Distribution + sample
  const dist = new Map<string, number>();
  for (const r of results) dist.set(r.result.class, (dist.get(r.result.class) ?? 0) + 1);
  console.log('\n[classify-committees] proposed-class distribution:');
  for (const [k, v] of [...dist.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

  console.log('\n[classify-committees] sample (top by $ impact):');
  for (const r of results.slice(0, 10)) {
    console.log(
      `  $${Math.round(r.committee.dollarImpact).toLocaleString().padStart(11)}  legs=${String(
        r.committee.legislatorCount,
      ).padStart(3)}  ${r.committee.committeeId}  ${r.result.class.padEnd(13)} conf=${r.result.confidence.toFixed(
        2,
      )}  ${r.committee.name.slice(0, 48)}`,
    );
    console.log(`     ${r.result.reasoning}`);
  }

  if (flags.dryRun) {
    console.log('\n[classify-committees] DRY RUN — no files written.');
    await prisma.$disconnect();
    return;
  }

  // ─── SAFE WRITE: proposal JSON (apply-unknown-batch.ts format) + review CSV ──
  // We NEVER write the database. The JSON is the machine-applyable proposal; the
  // CSV is the human-review sidecar. A human reviews/edits, then runs:
  //   npx tsx scripts/apply-unknown-batch.ts --dry-run data/committee-proposals.json
  //   npx tsx scripts/apply-unknown-batch.ts            data/committee-proposals.json
  const stamp = new Date().toISOString();
  const provenance = `kie-${KIE_MODEL}`;
  const merged: Record<string, { class: string; reason: string }> = { ...existing };
  for (const r of results) {
    const conf = r.result.confidence.toFixed(2);
    merged[r.committee.committeeId] = {
      class: r.result.class,
      // Stamp source + confidence + timestamp into the reason string so the
      // provenance survives into PacClassification.reason when applied.
      reason: `${r.result.reasoning} [${provenance} conf=${conf} ${stamp}]`.slice(0, 500),
    };
  }
  fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
  fs.writeFileSync(proposalPath, JSON.stringify(merged, null, 2));
  console.log(
    `\n[classify-committees] ✓ wrote ${results.length} new proposals (${Object.keys(merged).length} total) to ${
      flags.out
    } — NO database writes`,
  );

  // Review sidecar CSV next to the JSON.
  const csvPath = proposalPath.replace(/\.json$/i, '') + '.review.csv';
  const header =
    'committeeId,name,committeeType,connectedOrg,dollarImpact,legislators,proposedClass,confidence,needsHumanLook,reasoning,source,proposedAt';
  const lines = [header];
  for (const r of results.sort((a, b) => b.committee.dollarImpact - a.committee.dollarImpact)) {
    lines.push(
      [
        r.committee.committeeId,
        csvCell(r.committee.name),
        r.committee.committeeType ?? '',
        csvCell(r.committee.connectedOrg ?? ''),
        Math.round(r.committee.dollarImpact),
        r.committee.legislatorCount,
        r.result.class,
        r.result.confidence.toFixed(2),
        r.result.confidence < LOW_CONFIDENCE_THRESHOLD ? 'YES' : '',
        csvCell(r.result.reasoning),
        provenance,
        stamp,
      ].join(','),
    );
  }
  fs.writeFileSync(csvPath, lines.join('\n') + '\n');
  console.log(`[classify-committees] ✓ wrote review sidecar to ${path.relative(process.cwd(), csvPath)}`);
  console.log(
    `\n[classify-committees] APPROVAL: review the CSV, edit/remove rows in the JSON as needed, then:\n` +
      `  npx tsx scripts/apply-unknown-batch.ts --dry-run ${flags.out}\n` +
      `  npx tsx scripts/apply-unknown-batch.ts ${flags.out}\n` +
      `apply-unknown-batch.ts only promotes rows still class='UNKNOWN' AND finalClass IS NULL.`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
