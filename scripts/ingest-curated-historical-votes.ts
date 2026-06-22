// Targeted ingest of the CURATED historical (pre-119th) vote-bills' roll-call
// votes — both chambers — into RollCallVote + RollCallPosition. We fetch only
// the specific landmark bills in src/lib/scorecard/curated-votes.ts (IIJA,
// CHIPS, IRA, PACT), not whole Congresses, via Congress.gov's per-bill
// recordedVotes (which links the House Clerk XML and Senate LIS XML directly).
//
//   House  → clerk.house.gov XML, keyed by bioguide id.
//   Senate → senate.gov LIS XML,  keyed by (last name, state) → sitting senator.
//
// Idempotent (upsert on chamber+congress+session+rollcall). Run:
//   npx tsx scripts/ingest-curated-historical-votes.ts --dry-run
//   npx tsx scripts/ingest-curated-historical-votes.ts

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CURATED_VOTE_BILLS } from '../src/lib/scorecard/curated-votes';

const url = new URL(process.env.DATABASE_URL!);
if (!url.searchParams.has('pgbouncer')) url.searchParams.set('pgbouncer', 'true');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
const KEY = process.env.FEC_API_KEY || process.env.FEC_DATA_API || '';

// Final-passage roll calls per (congress|billType|billNumber), per chamber.
const PASSAGE: Record<string, Array<{ chamber: 'House' | 'Senate'; roll: number }>> = {
  '117|HR|3684': [
    { chamber: 'House', roll: 369 },
    { chamber: 'Senate', roll: 314 },
  ], // IIJA
  '117|HR|4346': [
    { chamber: 'House', roll: 404 },
    { chamber: 'Senate', roll: 271 },
  ], // CHIPS
  '117|HR|5376': [
    { chamber: 'House', roll: 420 },
    { chamber: 'Senate', roll: 325 },
  ], // IRA
  '117|S|3373': [
    { chamber: 'House', roll: 309 },
    { chamber: 'Senate', roll: 280 },
  ], // PACT
};

type Pos = 'YES' | 'NO' | 'PRESENT' | 'NOT_VOTING';
function mapPos(s: string): Pos | null {
  const t = s.trim().toLowerCase();
  if (t === 'yea' || t === 'aye' || t === 'yes') return 'YES';
  if (t === 'nay' || t === 'no') return 'NO';
  if (t === 'present') return 'PRESENT';
  if (t.startsWith('not voting') || t === 'absent') return 'NOT_VOTING';
  return null;
}
const tag = (xml: string, name: string): string | null =>
  xml.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))?.[1]?.trim() ?? null;

// Fetch with a few retries — Congress.gov / clerk / senate.gov occasionally
// drop the connection (ECONNRESET) on back-to-back requests.
async function fetchRetry(u: string, tries = 4): Promise<Response | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u);
      if (r.ok) return r;
      if (r.status === 404) return null;
    } catch {
      /* retry */
    }
    await new Promise((res) => setTimeout(res, 500 * (i + 1)));
  }
  return null;
}

interface ParsedVote {
  chamber: 'HOUSE' | 'SENATE';
  congress: number;
  session: number;
  rollNumber: number;
  voteDate: Date;
  voteQuestion: string;
  voteResult: string;
  voteType: string;
  billType: string;
  billNumber: string;
  billTitle: string;
  positions: Array<{ legislatorId: string; position: Pos }>;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL' },
    select: { id: true, bioguideId: true, lastName: true, state: true, chamber: true },
  });
  const byBioguide = new Map<string, string>();
  const senatorByNameState = new Map<string, string>();
  for (const l of legs) {
    if (l.bioguideId) byBioguide.set(l.bioguideId, l.id);
    if (l.chamber === 'SEN' && l.lastName && l.state)
      senatorByNameState.set(`${l.lastName.toLowerCase()}|${l.state.toUpperCase()}`, l.id);
  }

  // Unique historical (congress<119) curated bills.
  const histBills = [
    ...new Map(
      CURATED_VOTE_BILLS.filter((b) => b.congress < 119).map((b) => [`${b.congress}|${b.billType}|${b.billNumber}`, b]),
    ).values(),
  ];
  console.log(
    `[hist] ${histBills.length} historical curated bills: ${histBills
      .map((b) => `${b.billType}${b.billNumber}(${b.congress})`)
      .join(', ')}`,
  );

  const parsed: ParsedVote[] = [];
  for (const bill of histBills) {
    const r = await fetchRetry(
      `https://api.congress.gov/v3/bill/${bill.congress}/${bill.billType.toLowerCase()}/${
        bill.billNumber
      }/actions?api_key=${KEY}&format=json&limit=250`,
    );
    const j: any = (await r?.json().catch(() => ({}))) ?? {};
    const seen = new Set<string>();
    const rvs: any[] = [];
    // Pin the exact FINAL-passage roll call per chamber (verified against the
    // Congress.gov action text + recorded margins). Senate vote-a-rama and
    // cloture votes are all confusingly labeled, so heuristics aren't safe — we
    // name the votes explicitly. These are the votes that sent each bill to the
    // President (e.g. IRA #420 concur, not the 2021 Build Back Better #385).
    const pins = PASSAGE[`${bill.congress}|${bill.billType}|${bill.billNumber}`] ?? [];
    for (const a of j?.actions ?? [])
      for (const rv of a.recordedVotes ?? []) {
        if (!pins.some((p) => p.chamber === rv.chamber && p.roll === rv.rollNumber)) continue;
        const k = `${rv.chamber}|${rv.rollNumber}|${rv.sessionNumber}`;
        if (!seen.has(k)) {
          seen.add(k);
          rvs.push(rv);
        }
      }
    console.log(`[hist] ${bill.billType}${bill.billNumber}(${bill.congress}): ${rvs.length} recorded votes`);
    for (const rv of rvs) {
      const pv =
        rv.chamber === 'Senate'
          ? await parseSenate(rv, bill, senatorByNameState)
          : await parseHouse(rv, bill, byBioguide);
      if (pv) {
        parsed.push(pv);
        console.log(`    ${pv.chamber} #${pv.rollNumber} "${pv.voteQuestion}" → ${pv.positions.length} positions`);
      }
    }
  }

  if (dryRun) {
    console.log('[hist] DRY RUN — no writes');
    await prisma.$disconnect();
    return;
  }
  let votesW = 0,
    posW = 0;
  for (const v of parsed) {
    const row = (await prisma.$queryRawUnsafe(
      `INSERT INTO "RollCallVote" ("id","chamber","congressNumber","sessionNumber","rollCallNumber","voteDate","voteQuestion","voteResult","voteType","billType","billNumber","billTitle","isScorable","createdAt","updatedAt")
       VALUES (gen_random_uuid()::text,$1::"RollCallChamber",$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,NOW(),NOW())
       ON CONFLICT ("chamber","congressNumber","sessionNumber","rollCallNumber") DO UPDATE SET "voteQuestion"=EXCLUDED."voteQuestion","voteResult"=EXCLUDED."voteResult","billType"=EXCLUDED."billType","billNumber"=EXCLUDED."billNumber","billTitle"=EXCLUDED."billTitle","isScorable"=true,"updatedAt"=NOW()
       RETURNING "id"`,
      v.chamber,
      v.congress,
      v.session,
      v.rollNumber,
      v.voteDate,
      v.voteQuestion,
      v.voteResult,
      v.voteType,
      v.billType,
      v.billNumber,
      v.billTitle,
    )) as Array<{ id: string }>;
    const voteId = row[0].id;
    await prisma.rollCallPosition.deleteMany({ where: { voteId } });
    await prisma.rollCallPosition.createMany({
      data: v.positions.map((p) => ({ voteId, legislatorId: p.legislatorId, position: p.position })),
      skipDuplicates: true,
    });
    votesW += 1;
    posW += v.positions.length;
  }
  console.log(`[hist] ✓ ${votesW} votes upserted · ${posW} positions written`);
  await prisma.$disconnect();
}

async function parseHouse(rv: any, bill: any, byBioguide: Map<string, string>): Promise<ParsedVote | null> {
  const res = await fetchRetry(rv.url);
  if (!res) return null;
  const xml = await res.text();
  const positions: ParsedVote['positions'] = [];
  for (const blk of xml.match(/<recorded-vote>[\s\S]*?<\/recorded-vote>/g) ?? []) {
    const bio = blk.match(/name-id="([A-Z0-9]+)"/)?.[1];
    const vote = blk.match(/<vote>([^<]*)<\/vote>/)?.[1];
    if (!bio || !vote) continue;
    const legId = byBioguide.get(bio);
    const pos = mapPos(vote);
    if (legId && pos) positions.push({ legislatorId: legId, position: pos });
  }
  return {
    chamber: 'HOUSE',
    congress: rv.congress,
    session: rv.sessionNumber,
    rollNumber: rv.rollNumber,
    voteDate: new Date(rv.date || bill.congress),
    voteQuestion: tag(xml, 'vote-question') || 'On Passage',
    voteResult: tag(xml, 'vote-result') || '',
    voteType: tag(xml, 'vote-type') || '',
    billType: bill.billType,
    billNumber: bill.billNumber,
    billTitle: bill.label,
    positions,
  };
}

async function parseSenate(rv: any, bill: any, senatorByNameState: Map<string, string>): Promise<ParsedVote | null> {
  const res = await fetchRetry(rv.url);
  if (!res) return null;
  const xml = await res.text();
  const positions: ParsedVote['positions'] = [];
  for (const blk of xml.match(/<member>[\s\S]*?<\/member>/g) ?? []) {
    const last = tag(blk, 'last_name');
    const state = tag(blk, 'state');
    const cast = tag(blk, 'vote_cast');
    if (!last || !state || !cast) continue;
    const legId = senatorByNameState.get(`${last.toLowerCase()}|${state.toUpperCase()}`);
    const pos = mapPos(cast);
    if (legId && pos) positions.push({ legislatorId: legId, position: pos });
  }
  return {
    chamber: 'SENATE',
    congress: rv.congress,
    session: rv.sessionNumber,
    rollNumber: rv.rollNumber,
    voteDate: new Date(rv.date || bill.congress),
    voteQuestion: tag(xml, 'question') || 'On Passage',
    voteResult: tag(xml, 'vote_result') || '',
    voteType: 'Yea-And-Nay',
    billType: bill.billType,
    billNumber: bill.billNumber,
    billTitle: bill.label,
    positions,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
