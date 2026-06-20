// READ-ONLY AI review of PacClassification across four classes (IDEOLOGICAL,
// PARTY, CORPORATE, UNKNOWN). Surfaces misclassifications before the PAC Score
// is finalized. NEVER writes the DB. Emits proposals JSON + summary to stdout.
//
// Dollar impact = SUM(counts-eligible PacContribution) flowing to published-score
// legislators, matching the live PAC Score exposure surface.

import './load-env';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const KIE_API_KEY = process.env.KIE_API_KEY!;
const KIE_URL = 'https://api.kie.ai/claude/v1/messages';
const KIE_MODEL = 'claude-opus-4-7';
const PARALLEL = 6;

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

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

// Classes that count a committee's money as "corporate" against the PAC Score.
const COUNTS_AGAINST = new Set(['CORPORATE', 'DARK_MONEY', 'FOREIGN_POLICY', 'LEADERSHIP']);

// Reused verbatim from scripts/classify-committees-with-llm.ts for calibration consistency.
const SYSTEM_PROMPT = `You are a campaign-finance taxonomy expert classifying federal PACs for the Common Ground civic scorecard.

Each PAC must fit one of these classes:

1. CORPORATE — Industry-aligned PACs. Includes:
   - Direct corporate PACs (Boeing PAC, Pfizer PAC, AT&T PAC, Comcast PAC)
   - Trade-association PACs that lobby for industry interests (Realtors, Bankers, Insurance Brokers, AMA, AHIP, PhRMA, NFIB, Chamber of Commerce)
   - Crypto industry super PACs (Fairshake, Defend American Jobs, Protect Progress)
   - Law/lobbying firm PACs (Akin Gump, Holland & Knight)
   - Accounting/consulting firm PACs (Deloitte, EY, KPMG, McKinsey)
   - Medical specialty associations operating as corporate lobby (AAFP, ACEP)

2. FOREIGN_POLICY — US-domiciled PACs whose primary purpose is shaping US foreign policy toward a specific country or region. Examples: AIPAC, J Street, Republican Jewish Coalition, NORPAC, Democratic Majority for Israel, Pro-Israel America, United Democracy Project, Turkish/Indian/Cuban/Korean/Vietnamese American political PACs.

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
- CORPORATE, FOREIGN_POLICY, DARK_MONEY, LEADERSHIP count AGAINST the legislator's PAC score (concentrated influence / intra-political-machine signals).
- ACTIVIST, LABOR, IDEOLOGICAL, PARTY, CONDUIT do NOT count against (cause advocacy, labor organizing, broad partisan grassroots, party/conduit mechanics).
- If a Super PAC has a clear cause in its name, classify as ACTIVIST even if large-donor-funded; if it's a vague patriotic name with no cause, classify as DARK_MONEY.

Output JSON via the classifyCommittee tool. Be precise and factual.`;

interface CommitteeInfo {
  committeeId: string;
  name: string;
  committeeType: string | null;
  orgType: string | null;
  connectedOrg: string | null;
  currentClass: string;
  dollarImpact: number;
}

interface LlmResult {
  class: PacClassName;
  confidence: number;
  reasoning: string;
}

async function classify(c: CommitteeInfo): Promise<LlmResult | null> {
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
            class: { type: 'string', enum: [...VALID_CLASSES] },
            confidence: { type: 'number' },
            reasoning: { type: 'string' },
          },
          required: ['class', 'confidence', 'reasoning'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'classifyCommittee' },
    messages: [{ role: 'user', content: userText }],
  };

  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(KIE_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = `HTTP ${res.status}`;
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) {
        lastErr = `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`;
        break;
      }
      const json = (await res.json()) as { content?: Array<{ type: string; input?: unknown }> };
      const tb = json.content?.find((b) => b.type === 'tool_use');
      if (!tb?.input) {
        lastErr = 'no tool_use';
        break;
      }
      const out = tb.input as Record<string, unknown>;
      const raw = typeof out.class === 'string' ? out.class.trim().toUpperCase() : '';
      const cls = (VALID_CLASSES as readonly string[]).includes(raw) ? (raw as PacClassName) : null;
      if (!cls) {
        lastErr = `invalid class ${raw}`;
        break;
      }
      const cr = typeof out.confidence === 'number' ? out.confidence : Number(out.confidence);
      const confidence = Number.isFinite(cr) ? Math.max(0, Math.min(1, cr)) : 0;
      const reasoning = typeof out.reasoning === 'string' ? out.reasoning : '';
      return { class: cls, confidence, reasoning };
    } catch (e) {
      lastErr = String(e);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  console.warn(`  [llm] failed ${c.committeeId}: ${lastErr}`);
  return null;
}

// Top committees by counts-eligible dollars to published-score legislators,
// for a given current class.
async function loadTopByClass(currentClass: string, limit: number): Promise<CommitteeInfo[]> {
  await prisma.$executeRawUnsafe(`SET statement_timeout = '240000'`);
  const ranked = await prisma.$queryRaw<Array<{ committeeId: string; dollarImpact: string }>>`
    WITH published_legs AS (
      SELECT DISTINCT "legislatorId" FROM "RepresentativeScore" WHERE "publishedAt" IS NOT NULL
    ),
    cls_cmtes AS (
      SELECT "committeeId" FROM "PacClassification" WHERE class = ${currentClass}::"PacClass"
    )
    SELECT pc."donorCommitteeId" AS "committeeId", SUM(pc.amount::numeric)::text AS "dollarImpact"
    FROM "PacContribution" pc
    WHERE pc.kind IN ('DIRECT','JFC_PASS_THROUGH','LEADERSHIP_PASS_THROUGH','IE_SUPPORT')
      AND pc."legislatorId" IN (SELECT "legislatorId" FROM published_legs)
      AND pc."donorCommitteeId" IN (SELECT "committeeId" FROM cls_cmtes)
    GROUP BY pc."donorCommitteeId"
    ORDER BY SUM(pc.amount::numeric) DESC
    LIMIT ${limit}
  `;
  if (ranked.length === 0) return [];
  const ids = ranked.map((r) => r.committeeId);
  const meta = await prisma.pacClassification.findMany({
    where: { committeeId: { in: ids } },
    select: { committeeId: true, name: true, committeeType: true, orgType: true, connectedOrg: true, class: true },
  });
  const byId = new Map(meta.map((m) => [m.committeeId, m]));
  return ranked.map((r) => {
    const m = byId.get(r.committeeId);
    return {
      committeeId: r.committeeId,
      name: m?.name ?? '',
      committeeType: m?.committeeType ?? null,
      orgType: m?.orgType ?? null,
      connectedOrg: m?.connectedOrg ?? null,
      currentClass,
      dollarImpact: Number(r.dollarImpact),
    };
  });
}

async function reviewClass(currentClass: string, limit: number) {
  console.log(`\n=== Reviewing ${currentClass} (top ${limit} by $ to published-score legislators) ===`);
  const committees = await loadTopByClass(currentClass, limit);
  console.log(`  loaded ${committees.length} committees`);
  const out: Array<{ c: CommitteeInfo; r: LlmResult }> = [];
  for (let i = 0; i < committees.length; i += PARALLEL) {
    const slice = committees.slice(i, i + PARALLEL);
    const batch = await Promise.all(slice.map(async (c) => ({ c, r: await classify(c) })));
    for (const b of batch) if (b.r) out.push({ c: b.c, r: b.r });
    process.stdout.write(`  ${Math.min(i + PARALLEL, committees.length)}/${committees.length}\r`);
  }
  console.log('');
  return out;
}

function fmt$(n: number) {
  return '$' + Math.round(n).toLocaleString();
}

async function main() {
  const proposals: Record<
    string,
    {
      currentClass: string;
      proposedClass: string;
      confidence: number;
      dollars: number;
      reason: string;
    }
  > = {};

  // Track mismatches per class for the summary.
  const summary: Record<
    string,
    { reviewed: number; mismatches: number; mismatchDollars: number; scoreFlips: number; scoreFlipDollars: number }
  > = {};
  const allMismatches: Array<{
    class: string;
    id: string;
    name: string;
    dollars: number;
    from: string;
    to: string;
    conf: number;
    reason: string;
    flipsScore: boolean;
  }> = [];

  const PLAN: Array<[string, number]> = [
    ['IDEOLOGICAL', 30],
    ['PARTY', 30],
    ['CORPORATE', 40],
    ['UNKNOWN', 60],
  ];

  for (const [cls, lim] of PLAN) {
    const results = await reviewClass(cls, lim);
    let mismatches = 0,
      mmDollars = 0,
      flips = 0,
      flipDollars = 0;
    for (const { c, r } of results) {
      const isUnknown = cls === 'UNKNOWN';
      const mismatch = r.class !== c.currentClass;
      if (isUnknown) {
        // For UNKNOWN we record every resolution (UNKNOWN→X is always a change).
        if (r.class !== 'UNKNOWN') {
          proposals[c.committeeId] = {
            currentClass: c.currentClass,
            proposedClass: r.class,
            confidence: r.confidence,
            dollars: Math.round(c.dollarImpact),
            reason: r.reasoning,
          };
        }
      } else if (mismatch) {
        proposals[c.committeeId] = {
          currentClass: c.currentClass,
          proposedClass: r.class,
          confidence: r.confidence,
          dollars: Math.round(c.dollarImpact),
          reason: r.reasoning,
        };
      }
      // Count as a "mismatch" for the summary when proposed != current.
      if (mismatch) {
        mismatches += 1;
        mmDollars += c.dollarImpact;
        const flipsScore = COUNTS_AGAINST.has(c.currentClass) !== COUNTS_AGAINST.has(r.class);
        if (flipsScore) {
          flips += 1;
          flipDollars += c.dollarImpact;
        }
        allMismatches.push({
          class: cls,
          id: c.committeeId,
          name: c.name,
          dollars: c.dollarImpact,
          from: c.currentClass,
          to: r.class,
          conf: r.confidence,
          reason: r.reasoning,
          flipsScore,
        });
      }
    }
    summary[cls] = {
      reviewed: results.length,
      mismatches,
      mismatchDollars: mmDollars,
      scoreFlips: flips,
      scoreFlipDollars: flipDollars,
    };
  }

  // Write proposals JSON.
  const outPath = path.resolve(process.cwd(), 'data/pac-class-review-202606.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(proposals, null, 2));

  // Print summary.
  console.log('\n\n========== PER-CLASS SUMMARY ==========');
  for (const [cls] of PLAN) {
    const s = summary[cls];
    console.log(
      `\n${cls}: reviewed ${s.reviewed}, mismatches ${s.mismatches} (${fmt$(s.mismatchDollars)}), ` +
        `score-flipping ${s.scoreFlips} (${fmt$(s.scoreFlipDollars)})`,
    );
  }

  console.log('\n\n========== TOP MISMATCHES (score-flipping first, then $) ==========');
  const ranked = [...allMismatches].sort((a, b) => {
    if (a.flipsScore !== b.flipsScore) return a.flipsScore ? -1 : 1;
    return b.dollars - a.dollars;
  });
  for (const m of ranked.slice(0, 25)) {
    const flag = m.flipsScore ? '[SCORE-FLIP]' : '[no-flip]  ';
    console.log(`${flag} ${fmt$(m.dollars).padStart(13)}  ${m.id}  ${m.from}→${m.to} conf=${m.conf.toFixed(2)}`);
    console.log(`            ${m.name.slice(0, 70)}`);
    console.log(`            ${m.reason.slice(0, 110)}`);
  }
  console.log(`\nProposals written: ${outPath} (${Object.keys(proposals).length} entries)`);

  // Emit machine-readable block for the agent to parse the final report.
  console.log('\n<<<JSON_SUMMARY>>>');
  console.log(
    JSON.stringify({ summary, topMismatches: ranked.slice(0, 20), proposalCount: Object.keys(proposals).length }),
  );
  console.log('<<<END_JSON_SUMMARY>>>');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
