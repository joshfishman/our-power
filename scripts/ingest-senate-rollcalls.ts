// v1.6 Senate ingest — pulls all Senate roll-call votes for 119th Congress
// from senate.gov XML feeds. Skips nomination + treaty votes (not plank-
// relevant). Matches members to our Legislator table by (state, lastName).
//
// Vote menu: https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_119_{session}.xml
// Per-vote:  https://www.senate.gov/legislative/LIS/roll_call_votes/vote{cong}{session}/vote_{cong}_{session}_{NNNNN}.xml
//
// Run: npm run scorecard:ingest-senate
//      npm run scorecard:ingest-senate -- --limit=20 --dry-run

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const CONGRESS = 119;
const PARALLEL = 15;
const FLUSH_BATCH = 50;

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

interface CliFlags {
  limit: number;
  dryRun: boolean;
  session: 'all' | '1' | '2';
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { limit: 0, dryRun: false, session: 'all' };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--limit=')) flags.limit = Number(arg.split('=')[1]);
    else if (arg === '--session=1') flags.session = '1';
    else if (arg === '--session=2') flags.session = '2';
  }
  return flags;
}

interface VoteListing {
  voteNumber: number;
  sessionNumber: number;
  voteDate: Date;
  voteQuestion: string;
  voteResult: string;
  documentType: string; // PN = nomination, S = senate bill, HR = house bill, etc.
  documentNumber: string;
}

async function fetchVoteMenu(session: number): Promise<VoteListing[]> {
  const url = `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${CONGRESS}_${session}.xml`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  [warn] menu fetch failed for session ${session}: HTTP ${res.status}`);
    return [];
  }
  const xml = await res.text();
  const matches = xml.match(/<vote>[\s\S]*?<\/vote>/g) ?? [];
  const out: VoteListing[] = [];
  for (const v of matches) {
    const get = (tag: string): string => {
      const m = v.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`));
      return m ? m[1].trim() : '';
    };
    const num = parseInt(get('vote_number').replace(/^0+/, '') || '0', 10);
    if (!num) continue;
    out.push({
      voteNumber: num,
      sessionNumber: session,
      voteDate: parseDate(get('vote_date')),
      voteQuestion: get('question'),
      voteResult: get('result'),
      documentType:
        get('issue')
          .replace(/\d+.*$/, '')
          .trim() || get('issue').slice(0, 3),
      documentNumber: get('issue').replace(/^[A-Za-z. ]+/, ''),
    });
  }
  return out;
}

// Senate dates look like "December 17, 2025,  02:38 PM" or "18-Dec"
function parseDate(s: string): Date {
  if (!s) return new Date(0);
  // Full format with comma
  const long = s.match(/(\w+)\s+(\d{1,2}),\s+(\d{4}),\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (long) {
    const monthNames: Record<string, number> = {
      January: 0,
      February: 1,
      March: 2,
      April: 3,
      May: 4,
      June: 5,
      July: 6,
      August: 7,
      September: 8,
      October: 9,
      November: 10,
      December: 11,
    };
    const mon = monthNames[long[1]] ?? 0;
    const day = parseInt(long[2], 10);
    const yr = parseInt(long[3], 10);
    let hr = parseInt(long[4], 10) % 12;
    const mi = parseInt(long[5], 10);
    if (long[6]?.toUpperCase() === 'PM') hr += 12;
    return new Date(yr, mon, day, hr, mi);
  }
  return new Date(0);
}

interface VoteDetail {
  voteNumber: number;
  sessionNumber: number;
  voteDate: Date;
  voteQuestion: string;
  voteResult: string;
  voteTitle: string;
  documentType: string;
  documentNumber: string;
  documentTitle: string;
  positions: Array<{ lastName: string; state: string; party: string; vote: string }>;
}

async function fetchVoteDetail(voteNumber: number, session: number): Promise<VoteDetail | null> {
  const padded = voteNumber.toString().padStart(5, '0');
  const url = `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${CONGRESS}${session}/vote_${CONGRESS}_${session}_${padded}.xml`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const xml = await res.text();
  const get = (tag: string): string => {
    const m = xml.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, 's'));
    return m ? m[1].trim() : '';
  };
  const positions: VoteDetail['positions'] = [];
  const memberBlocks = xml.match(/<member>[\s\S]*?<\/member>/g) ?? [];
  for (const block of memberBlocks) {
    const get2 = (tag: string): string => {
      const m = block.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`));
      return m ? m[1].trim() : '';
    };
    const lastName = get2('last_name');
    if (!lastName) continue;
    positions.push({
      lastName,
      state: get2('state'),
      party: get2('party'),
      vote: get2('vote_cast'),
    });
  }
  return {
    voteNumber,
    sessionNumber: session,
    voteDate: parseDate(get('vote_date')),
    voteQuestion: get('vote_question_text') || get('question'),
    voteResult: get('vote_result') || get('vote_result_text'),
    voteTitle: get('vote_title') || get('vote_document_text'),
    documentType: get('document_type'),
    documentNumber: get('document_number'),
    documentTitle: get('document_title'),
    positions,
  };
}

function mapPosition(s: string): 'YES' | 'NO' | 'PRESENT' | 'NOT_VOTING' | null {
  const v = s.trim().toLowerCase();
  if (v === 'yea' || v === 'aye' || v === 'guilty') return 'YES';
  if (v === 'nay' || v === 'no' || v === 'not guilty') return 'NO';
  if (v === 'present') return 'PRESENT';
  if (v === 'not voting' || v === '') return 'NOT_VOTING';
  return null;
}

// Map Senate document_type to our (billType, billNumber) format
function mapBillRef(docType: string, docNum: string): { type: string; number: string } | null {
  if (!docType || !docNum) return null;
  // PN = nomination, TD = treaty document — skip
  if (docType === 'PN' || docType === 'TD') return null;
  const map: Record<string, string> = {
    S: 'S',
    'S.J.Res.': 'SJRES',
    'S.Con.Res.': 'SCONRES',
    'S.Res.': 'SRES',
    'H.R.': 'HR',
    'H.J.Res.': 'HJRES',
    'H.Con.Res.': 'HCONRES',
    'H.Res.': 'HRES',
  };
  const t = map[docType] ?? docType.replace(/\./g, '').toUpperCase();
  return { type: t, number: docNum };
}

// Bulk upsert RollCallVote + bulk insert positions for a slice of detail rows
async function flushBatch(
  detail: VoteDetail[],
  legByStateLast: Map<string, string>,
): Promise<{ votes: number; positions: number; skipped: number }> {
  if (detail.length === 0) return { votes: 0, positions: 0, skipped: 0 };

  // Filter out nominations/treaties early — those have no billRef
  const filtered = detail
    .map((d) => ({ d, bill: mapBillRef(d.documentType, d.documentNumber) }))
    .filter((x) => x.bill !== null) as Array<{ d: VoteDetail; bill: { type: string; number: string } }>;
  const skipped = detail.length - filtered.length;
  if (filtered.length === 0) return { votes: 0, positions: 0, skipped };

  // Bulk INSERT ... ON CONFLICT ... DO UPDATE
  const params: unknown[] = [];
  const values = filtered
    .map(({ d, bill }, idx) => {
      const base = idx * 12;
      params.push(
        'SENATE',
        CONGRESS,
        d.sessionNumber,
        d.voteNumber,
        d.voteDate,
        d.voteQuestion || '',
        d.voteResult || '',
        d.voteQuestion || '',
        bill.type,
        bill.number,
        d.documentTitle || d.voteTitle || '',
        `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${CONGRESS}${d.sessionNumber}/vote_${CONGRESS}_${
          d.sessionNumber
        }_${d.voteNumber.toString().padStart(5, '0')}.htm`,
      );
      return (
        `(gen_random_uuid()::text, $${base + 1}::"RollCallChamber", $${base + 2}, $${base + 3}, $${base + 4}, ` +
        `$${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${
          base + 12
        }, NOW(), NOW())`
      );
    })
    .join(',');
  const sql =
    `INSERT INTO "RollCallVote" ` +
    `("id", "chamber", "congressNumber", "sessionNumber", "rollCallNumber", "voteDate", "voteQuestion", "voteResult", "voteType", "billType", "billNumber", "billTitle", "sourceUrl", "createdAt", "updatedAt") ` +
    `VALUES ${values} ` +
    `ON CONFLICT ("chamber", "congressNumber", "sessionNumber", "rollCallNumber") DO UPDATE SET ` +
    `"voteDate" = EXCLUDED."voteDate", "voteQuestion" = EXCLUDED."voteQuestion", "voteResult" = EXCLUDED."voteResult", ` +
    `"voteType" = EXCLUDED."voteType", "billType" = EXCLUDED."billType", "billNumber" = EXCLUDED."billNumber", ` +
    `"billTitle" = EXCLUDED."billTitle", "sourceUrl" = EXCLUDED."sourceUrl", "updatedAt" = NOW() ` +
    `RETURNING "id", "sessionNumber", "rollCallNumber"`;
  const upserted = (await prisma.$queryRawUnsafe(sql, ...params)) as Array<{
    id: string;
    sessionNumber: number;
    rollCallNumber: number;
  }>;
  const idByKey = new Map(upserted.map((r) => [`${r.sessionNumber}-${r.rollCallNumber}`, r.id]));

  // Delete then bulk-insert positions
  const voteIds = [...idByKey.values()];
  await prisma.rollCallPosition.deleteMany({ where: { voteId: { in: voteIds } } });
  const allPositions: Array<{
    voteId: string;
    legislatorId: string;
    position: 'YES' | 'NO' | 'PRESENT' | 'NOT_VOTING';
  }> = [];
  for (const { d } of filtered) {
    const voteId = idByKey.get(`${d.sessionNumber}-${d.voteNumber}`);
    if (!voteId) continue;
    for (const p of d.positions) {
      const key = `${p.state}|${p.lastName.toUpperCase()}`;
      const legislatorId = legByStateLast.get(key);
      if (!legislatorId) continue;
      const pos = mapPosition(p.vote);
      if (!pos) continue;
      allPositions.push({ voteId, legislatorId, position: pos });
    }
  }
  const CHUNK = 1000;
  for (let i = 0; i < allPositions.length; i += CHUNK) {
    await prisma.rollCallPosition.createMany({
      data: allPositions.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
  }
  return { votes: upserted.length, positions: allPositions.length, skipped };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-senate] flags: ${JSON.stringify(flags)}`);

  // Build (state, UPPER lastName) → legislatorId map for Senate position matching
  const senators = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL', chamber: 'SEN' },
    select: { id: true, lastName: true, state: true },
  });
  const legByStateLast = new Map<string, string>(senators.map((s) => [`${s.state}|${s.lastName.toUpperCase()}`, s.id]));
  console.log(`[ingest-senate] ${senators.length} senators indexed by (state, lastName)`);

  // Pull listings from both sessions
  const sessions: number[] = flags.session === '1' ? [1] : flags.session === '2' ? [2] : [1, 2];
  let listings: VoteListing[] = [];
  for (const s of sessions) {
    const m = await fetchVoteMenu(s);
    console.log(`[ingest-senate] session ${s}: ${m.length} votes in menu`);
    listings = listings.concat(m);
  }
  if (flags.limit > 0) listings = listings.slice(0, flags.limit);
  console.log(`[ingest-senate] ${listings.length} total Senate votes to process`);

  // Parallel fetch with bulk flush
  let totalVotes = 0;
  let totalPos = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let pending: VoteDetail[] = [];
  for (let i = 0; i < listings.length; i += PARALLEL) {
    const slice = listings.slice(i, i + PARALLEL);
    const results = await Promise.all(slice.map((l) => fetchVoteDetail(l.voteNumber, l.sessionNumber)));
    for (const r of results) {
      if (!r) {
        totalFailed += 1;
        continue;
      }
      pending.push(r);
    }
    if (!flags.dryRun && pending.length >= FLUSH_BATCH) {
      const flushSlice = pending.splice(0, pending.length);
      const out = await flushBatch(flushSlice, legByStateLast);
      totalVotes += out.votes;
      totalPos += out.positions;
      totalSkipped += out.skipped;
    }
    if ((i / PARALLEL) % 5 === 0) {
      console.log(
        `  fetched ${Math.min(i + PARALLEL, listings.length)}/${
          listings.length
        } · votes upserted ${totalVotes} · positions ${totalPos} · skipped(nom/treaty) ${totalSkipped} · failed ${totalFailed}`,
      );
    }
  }
  // Final flush
  if (!flags.dryRun && pending.length > 0) {
    const out = await flushBatch(pending, legByStateLast);
    totalVotes += out.votes;
    totalPos += out.positions;
    totalSkipped += out.skipped;
  }
  console.log(
    `[ingest-senate] Senate done: ${totalVotes} votes upserted · ${totalPos} positions · ${totalSkipped} skipped(nom/treaty) · ${totalFailed} XML failures`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
