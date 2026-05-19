// v1.6 — bulk ingest federal roll-call votes from Congress.gov + Clerk.gov.
//
// What it does:
//   1. List all House roll-calls for 119th Congress via Congress.gov API.
//      (~537 votes across 2 sessions as of this commit.)
//   2. For each: fetch the Clerk.gov XML to get per-member positions and
//      vote-question text.
//   3. Upsert RollCallVote + RollCallPosition rows.
//   4. Senate equivalent: list via senate.gov XML index + fetch each
//      vote XML.
//
// What it does NOT do:
//   - Classify votes by plank (separate `classify-roll-call-votes.ts`).
//   - Score legislators (separate compute step).
//
// Idempotent: re-running picks up new votes and refreshes existing ones.
//
// Usage:
//   npm run scorecard:ingest-rollcalls
//   npm run scorecard:ingest-rollcalls -- --chamber=house --limit=50
//   npm run scorecard:ingest-rollcalls -- --dry-run

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const API_KEY = process.env.FEC_API_KEY || process.env.FEC_DATA_API!;
const CONGRESS = 119;
const PAUSE_MS = 60; // Stay under api.data.gov 1000/hr ceiling

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

interface CliFlags {
  chamber: 'house' | 'senate' | 'both';
  limit: number; // 0 = unlimited
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { chamber: 'both', limit: 0, dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--chamber=')) {
      const v = arg.split('=')[1] as CliFlags['chamber'];
      if (v === 'house' || v === 'senate' || v === 'both') flags.chamber = v;
    } else if (arg.startsWith('--limit=')) flags.limit = Number(arg.split('=')[1]);
  }
  return flags;
}

let lastCallAt = 0;
async function pace() {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS - elapsed));
  lastCallAt = Date.now();
}

interface HouseVoteListing {
  rollCallNumber: number;
  sessionNumber: number;
  startDate: string;
  legislationNumber?: string;
  legislationType?: string;
  result: string;
  voteType: string;
}

async function fetchHouseListings(session: number): Promise<HouseVoteListing[]> {
  const out: HouseVoteListing[] = [];
  let offset = 0;
  const LIMIT = 250;
  while (true) {
    await pace();
    const url = `https://api.congress.gov/v3/house-vote/${CONGRESS}/${session}?api_key=${API_KEY}&format=json&limit=${LIMIT}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  [warn] HTTP ${res.status} on ${url}`);
      break;
    }
    const json = (await res.json()) as { houseRollCallVotes?: HouseVoteListing[] };
    const rows = json.houseRollCallVotes ?? [];
    out.push(...rows);
    if (rows.length < LIMIT) break;
    offset += LIMIT;
  }
  return out;
}

interface HouseVoteXml {
  voteQuestion: string;
  voteResult: string;
  voteType: string;
  voteDesc: string;
  actionDate: string;
  actionTime: string;
  legisNum: string;
  positions: Array<{ legiscanCandidateLastName?: string; bioguideId?: string; position: string }>;
}

async function fetchHouseVoteXml(rollNumber: number, year: string): Promise<HouseVoteXml | null> {
  const padNum = rollNumber.toString().padStart(3, '0');
  const url = `https://clerk.house.gov/evs/${year}/roll${padNum}.xml`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const xml = await res.text();
  const get = (tag: string): string => {
    const m = xml.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`));
    return m ? m[1].trim() : '';
  };
  // Per-member positions look like:
  //   <recorded-vote><legislator name-id="A000370" ...>...</legislator><vote>Yea</vote></recorded-vote>
  const positions: HouseVoteXml['positions'] = [];
  const memberBlocks = xml.match(/<recorded-vote>[\s\S]*?<\/recorded-vote>/g) ?? [];
  for (const block of memberBlocks) {
    const idM = block.match(/name-id="([^"]+)"/);
    const voteM = block.match(/<vote>([^<]+)<\/vote>/);
    if (idM && voteM) {
      positions.push({ bioguideId: idM[1], position: voteM[1].trim() });
    }
  }
  return {
    voteQuestion: get('vote-question'),
    voteResult: get('vote-result'),
    voteType: get('vote-type'),
    voteDesc: get('vote-desc'),
    actionDate: get('action-date'),
    actionTime: get('action-time'),
    legisNum: get('legis-num'),
    positions,
  };
}

// Map Clerk.gov vote-string → our VotePosition enum
function mapPosition(s: string): 'YES' | 'NO' | 'PRESENT' | 'NOT_VOTING' | null {
  const v = s.trim().toLowerCase();
  if (v === 'yea' || v === 'aye') return 'YES';
  if (v === 'nay' || v === 'no') return 'NO';
  if (v === 'present') return 'PRESENT';
  if (v === 'not voting' || v === 'no vote') return 'NOT_VOTING';
  return null;
}

// Parse "12-Sep-2025 6:56 PM" → Date
function parseActionDate(date: string, time: string): Date {
  if (!date) return new Date(0);
  const months: Record<string, number> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };
  const m = date.match(/^(\d{1,2})-(\w{3})-(\d{4})/);
  if (!m) return new Date(0);
  const day = parseInt(m[1], 10);
  const mon = months[m[2]] ?? 0;
  const yr = parseInt(m[3], 10);
  // Parse time as "6:56 PM"
  let hour = 12;
  let min = 0;
  const tm = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (tm) {
    hour = parseInt(tm[1], 10) % 12;
    min = parseInt(tm[2], 10);
    if (tm[3]?.toUpperCase() === 'PM') hour += 12;
  }
  return new Date(yr, mon, day, hour, min);
}

// Extract bill type + number from Clerk legis-num like "H R 3424" or "S 1234" or "H J Res 88"
function parseLegisNum(s: string): { type: string; number: string } | null {
  if (!s) return null;
  const t = s.trim().toUpperCase();
  // Patterns: "H R 3424", "S 1234", "H J RES 88", "H CON RES 14", "H RES 682", "S J RES 18"
  const m = t.match(/^(H R|S|H J RES|S J RES|H CON RES|S CON RES|H RES|S RES)\s+(\d+)/);
  if (!m) return null;
  const map: Record<string, string> = {
    'H R': 'HR',
    S: 'S',
    'H J RES': 'HJRES',
    'S J RES': 'SJRES',
    'H CON RES': 'HCONRES',
    'S CON RES': 'SCONRES',
    'H RES': 'HRES',
    'S RES': 'SRES',
  };
  return { type: map[m[1]] ?? m[1], number: m[2] };
}

// Parse a single Clerk XML + return a normalized record. Pure function,
// no DB access — lets us fetch XMLs in parallel batches without holding
// DB connections.
interface ParsedVote {
  listing: HouseVoteListing;
  voteDate: Date;
  voteQuestion: string;
  voteResult: string;
  voteType: string;
  voteDesc: string;
  billType: string | null;
  billNumber: string | null;
  sourceUrl: string;
  positions: Array<{ legislatorId: string; position: 'YES' | 'NO' | 'PRESENT' | 'NOT_VOTING' }>;
  matchedRaw: number; // total bioguide-matched positions before mapping
}

async function parseHouseVote(
  bioguideToLegislatorId: Map<string, string>,
  listing: HouseVoteListing,
): Promise<ParsedVote | null> {
  const year = listing.startDate.slice(0, 4);
  const xml = await fetchHouseVoteXml(listing.rollCallNumber, year);
  if (!xml) return null;
  const billRef = parseLegisNum(xml.legisNum);
  const voteDate = parseActionDate(xml.actionDate, xml.actionTime);
  const sourceUrl = `https://clerk.house.gov/Votes/${year}${listing.rollCallNumber.toString().padStart(3, '0')}`;
  let matchedRaw = 0;
  const positionRows: ParsedVote['positions'] = [];
  for (const p of xml.positions) {
    if (!p.bioguideId) continue;
    const legId = bioguideToLegislatorId.get(p.bioguideId);
    if (!legId) continue;
    matchedRaw += 1;
    const pos = mapPosition(p.position);
    if (!pos) continue;
    positionRows.push({ legislatorId: legId, position: pos });
  }
  return {
    listing,
    voteDate,
    voteQuestion: xml.voteQuestion || listing.voteType,
    voteResult: xml.voteResult || listing.result,
    voteType: xml.voteType || listing.voteType,
    voteDesc: xml.voteDesc,
    billType: billRef?.type ?? null,
    billNumber: billRef?.number ?? null,
    sourceUrl,
    positions: positionRows,
    matchedRaw,
  };
}

// Bulk-upsert a slice of parsed votes via raw SQL — single INSERT ...
// ON CONFLICT ... DO UPDATE for all RollCallVotes in the slice, then a
// single bulk delete + createMany for all positions.
async function flushBatch(slice: ParsedVote[]): Promise<{ votesWritten: number; positionsWritten: number }> {
  if (slice.length === 0) return { votesWritten: 0, positionsWritten: 0 };

  // 1. Bulk upsert RollCallVote rows.
  const params: unknown[] = [];
  const values = slice
    .map((v, idx) => {
      const base = idx * 12;
      params.push(
        'HOUSE',
        CONGRESS,
        v.listing.sessionNumber,
        v.listing.rollCallNumber,
        v.voteDate,
        v.voteQuestion,
        v.voteResult,
        v.voteType,
        v.billType,
        v.billNumber,
        v.voteDesc || null,
        v.sourceUrl,
      );
      return (
        `(gen_random_uuid()::text, $${base + 1}::"RollCallChamber", $${base + 2}, $${base + 3}, $${base + 4}, ` +
        `$${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${
          base + 12
        }, NOW(), NOW())`
      );
    })
    .join(',');
  const upsertSql =
    `INSERT INTO "RollCallVote" ` +
    `("id", "chamber", "congressNumber", "sessionNumber", "rollCallNumber", "voteDate", "voteQuestion", "voteResult", "voteType", "billType", "billNumber", "billTitle", "sourceUrl", "createdAt", "updatedAt") ` +
    `VALUES ${values} ` +
    `ON CONFLICT ("chamber", "congressNumber", "sessionNumber", "rollCallNumber") DO UPDATE SET ` +
    `"voteDate" = EXCLUDED."voteDate", ` +
    `"voteQuestion" = EXCLUDED."voteQuestion", ` +
    `"voteResult" = EXCLUDED."voteResult", ` +
    `"voteType" = EXCLUDED."voteType", ` +
    `"billType" = EXCLUDED."billType", ` +
    `"billNumber" = EXCLUDED."billNumber", ` +
    `"billTitle" = EXCLUDED."billTitle", ` +
    `"sourceUrl" = EXCLUDED."sourceUrl", ` +
    `"updatedAt" = NOW() ` +
    `RETURNING "id", "chamber", "congressNumber", "sessionNumber", "rollCallNumber"`;
  const upserted = (await prisma.$queryRawUnsafe(upsertSql, ...params)) as Array<{
    id: string;
    chamber: string;
    congressNumber: number;
    sessionNumber: number;
    rollCallNumber: number;
  }>;
  // Map (session, rollcall) → id so we can attach positions
  const idByKey = new Map<string, string>();
  for (const r of upserted) idByKey.set(`${r.sessionNumber}-${r.rollCallNumber}`, r.id);

  // 2. Delete all existing positions for these votes.
  const voteIds = [...idByKey.values()];
  await prisma.rollCallPosition.deleteMany({ where: { voteId: { in: voteIds } } });

  // 3. Bulk-insert positions across all votes in this slice. Chunk to
  //    1000 positions per createMany call to stay well within payload limits.
  const allPositions: Array<{
    voteId: string;
    legislatorId: string;
    position: 'YES' | 'NO' | 'PRESENT' | 'NOT_VOTING';
  }> = [];
  for (const v of slice) {
    const voteId = idByKey.get(`${v.listing.sessionNumber}-${v.listing.rollCallNumber}`);
    if (!voteId) continue;
    for (const p of v.positions) allPositions.push({ voteId, legislatorId: p.legislatorId, position: p.position });
  }
  const CHUNK = 1000;
  for (let i = 0; i < allPositions.length; i += CHUNK) {
    await prisma.rollCallPosition.createMany({
      data: allPositions.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
  }

  return { votesWritten: upserted.length, positionsWritten: allPositions.length };
}

// Mutable bulk-batch buffer holder. Pending parsed votes accumulate here
// between Promise.all batches and get flushed when we hit FLUSH_BATCH.
const mainLoopState: { pending?: ParsedVote[] } = {};

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-rollcalls] flags: ${JSON.stringify(flags)}`);

  // Build bioguide → legislatorId map for fast position lookup
  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'FEDERAL', bioguideId: { not: null } },
    select: { id: true, bioguideId: true },
  });
  const bioguideToLegislatorId = new Map(legs.map((l) => [l.bioguideId!, l.id]));
  console.log(`[ingest-rollcalls] ${bioguideToLegislatorId.size} federal legislators indexed by bioguide`);

  if (flags.chamber === 'house' || flags.chamber === 'both') {
    console.log('\n[ingest-rollcalls] === HOUSE ===\n');
    const s1 = await fetchHouseListings(1);
    const s2 = await fetchHouseListings(2);
    let listings = [...s1, ...s2];
    if (flags.limit > 0) listings = listings.slice(0, flags.limit);
    console.log(`[ingest-rollcalls] ${listings.length} House votes to process`);

    // Fast path: parallel Clerk.gov XML fetches (Clerk doesn't rate-limit
    // aggressively), then bulk-upsert via raw SQL in batches of 100 votes.
    const FETCH_CONCURRENCY = 20;
    const FLUSH_BATCH = 100;
    let totalVotes = 0;
    let totalPos = 0;
    let totalNullXml = 0;

    for (let i = 0; i < listings.length; i += FETCH_CONCURRENCY) {
      const slice = listings.slice(i, i + FETCH_CONCURRENCY);
      const parsed = await Promise.all(slice.map((l) => parseHouseVote(bioguideToLegislatorId, l)));
      const valid = parsed.filter((p): p is ParsedVote => p !== null);
      totalNullXml += parsed.length - valid.length;

      if (!flags.dryRun) {
        // Accumulate into a pending bulk batch, flush when >= FLUSH_BATCH.
        const pending: ParsedVote[] = (mainLoopState.pending ??= []);
        pending.push(...valid);
        if (pending.length >= FLUSH_BATCH) {
          const result = await flushBatch(pending.splice(0, pending.length));
          totalVotes += result.votesWritten;
          totalPos += result.positionsWritten;
        }
      } else {
        totalVotes += valid.length;
        totalPos += valid.reduce((s, v) => s + v.positions.length, 0);
      }

      if ((i / FETCH_CONCURRENCY) % 5 === 0) {
        console.log(
          `  fetched ${Math.min(i + FETCH_CONCURRENCY, listings.length)}/${
            listings.length
          } · votes upserted: ${totalVotes} · positions: ${totalPos}`,
        );
      }
    }

    // Final flush of any remaining buffered votes.
    if (!flags.dryRun && mainLoopState.pending && mainLoopState.pending.length > 0) {
      const result = await flushBatch(mainLoopState.pending.splice(0, mainLoopState.pending.length));
      totalVotes += result.votesWritten;
      totalPos += result.positionsWritten;
    }

    console.log(
      `[ingest-rollcalls] House done: ${totalVotes} votes upserted · ${totalPos} positions written · ${totalNullXml} XML fetches failed`,
    );
  }

  if (flags.chamber === 'senate' || flags.chamber === 'both') {
    console.log('\n[ingest-rollcalls] === SENATE === (deferred — Senate XML ingest separate)');
    console.log('  TODO: implement senate.gov XML ingest in next pass.');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
