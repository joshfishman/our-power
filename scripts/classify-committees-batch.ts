import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { writeFileSync } from 'fs';
const p = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! }),
});
const KEY = process.env.KIE_API_KEY!;
const URL = 'https://api.kie.ai/claude/v1/messages';
const VALID = [
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
];
const SYSTEM = `You are a campaign-finance taxonomy expert classifying federal PACs for the Common Ground civic scorecard. Classes:
CORPORATE (direct corporate PACs, trade-association/industry PACs incl. Realtors/Bankers/PhRMA/Chamber, crypto super PACs Fairshake, law/lobby/accounting firm PACs Deloitte/EY/Akin Gump), FOREIGN_POLICY (US PACs shaping foreign policy toward a country — AIPAC, J Street, NORPAC), DARK_MONEY (partisan super PACs / large-donor or undisclosed networks — Club for Growth, Senate Leadership Fund, Senate Majority PAC, Future Forward, AFP Action, state "Battleground/Better Together" super PACs), LABOR (union PACs — SEIU, AFT, IBEW, Teamsters, NEA), ACTIVIST (single-issue cause PACs — Everytown, Sierra Club, EMILY's List, SBA List, End Citizens United, VoteVets, "Victory Fund" orgs), IDEOLOGICAL (broad partisan grassroots, not single-issue; prefer ACTIVIST when a cause is clear), LEADERSHIP (politician-controlled PACs distributing to others — "Friends of X", AMERIPAC, PAC to the Future), PARTY (DCCC/NRCC/DSCC/NRSC/RNC/DNC + state parties), CONDUIT (ActBlue/WinRed earmarking), UNKNOWN (RARE — pure acronym, no hint, no connected org). Tips: "Action" suffix on partisan name→DARK_MONEY; named after a politician→LEADERSHIP; auto/free-trade→CORPORATE; vague patriotic super PAC + no cause→DARK_MONEY; clear cause in name→ACTIVIST. Cross-partisan, factual — applied identically regardless of party.`;
async function classifyBatch(items: any[]): Promise<Record<string, { class: string; reason: string }>> {
  const list = items
    .map(
      (c, i) =>
        `${i + 1}. id=${c.id} | name="${c.name || '(none)'}" | fecType=${c.committeeType || '-'} | connectedOrg="${
          c.connectedOrg || '(none)'
        }"`,
    )
    .join('\n');
  const user = `Classify each committee. Return JSON via the tool — one entry per committee with its id, class, confidence (0-1), and a <12-word reason.\n\n${list}`;
  const body = {
    model: 'claude-opus-4-7',
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
    tools: [
      {
        name: 'classifyBatch',
        description: 'Return classifications',
        input_schema: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  class: { type: 'string', enum: VALID },
                  confidence: { type: 'number' },
                  reason: { type: 'string' },
                },
                required: ['id', 'class', 'confidence', 'reason'],
              },
            },
          },
          required: ['results'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'classifyBatch' },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j: any = await r.json();
      const tool = (j.content || []).find((c: any) => c.type === 'tool_use');
      const results = tool?.input?.results || [];
      const out: Record<string, { class: string; reason: string }> = {};
      for (const x of results) {
        if (x?.id && VALID.includes(x.class))
          out[x.id] = {
            class: x.class,
            reason: `${x.reason || ''} [kie-batch conf=${x.confidence ?? '?'}]`.slice(0, 500),
          };
      }
      if (Object.keys(out).length) return out;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  return {};
}
(async () => {
  const rows: any = await p.$queryRawUnsafe(`
    SELECT pc."committeeId" id, pc.name, pc."committeeType", pc."connectedOrg"
    FROM "PacClassification" pc JOIN "PacContribution" k ON k."donorCommitteeId"=pc."committeeId"
    WHERE pc.class='UNKNOWN' AND pc."finalClass" IS NULL
    GROUP BY pc."committeeId", pc.name, pc."committeeType", pc."connectedOrg"
    ORDER BY SUM(k.amount::numeric) DESC`);
  let proposalsInit: Record<string, { class: string; reason: string }> = {};
  try {
    proposalsInit = JSON.parse(require('fs').readFileSync('data/committee-proposals-batch.json', 'utf8'));
  } catch {}
  const todo = rows.filter((r: any) => !proposalsInit[r.id]);
  console.log(
    `[batch] ${rows.length} total, ${Object.keys(proposalsInit).length} already done, ${
      todo.length
    } to classify (CONC=12)`,
  );
  const SIZE = 25,
    CONC = 12;
  const batches: any[][] = [];
  for (let i = 0; i < todo.length; i += SIZE) batches.push(todo.slice(i, i + SIZE));
  const proposals: Record<string, { class: string; reason: string }> = { ...proposalsInit };
  let done = 0;
  for (let i = 0; i < batches.length; i += CONC) {
    const slice = batches.slice(i, i + CONC);
    const res = await Promise.all(slice.map((b) => classifyBatch(b)));
    for (const r of res) Object.assign(proposals, r);
    done += slice.reduce((s, b) => s + b.length, 0);
    console.log(`[batch] classified ${Object.keys(proposals).length}/${rows.length} (through ${done})`);
    writeFileSync('data/committee-proposals-batch.json', JSON.stringify(proposals, null, 1));
  }
  console.log(`[batch] DONE classified ${Object.keys(proposals).length}/${rows.length}`);
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
