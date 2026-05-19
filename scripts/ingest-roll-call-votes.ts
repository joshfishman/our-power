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

async function ingestHouseVote(
  bioguideToLegislatorId: Map<string, string>,
  listing: HouseVoteListing,
  dryRun: boolean,
): Promise<{ scored: boolean; positionsWritten: number; matched: number }> {
  const year = listing.startDate.slice(0, 4);
  const xml = await fetchHouseVoteXml(listing.rollCallNumber, year);
  if (!xml) return { scored: false, positionsWritten: 0, matched: 0 };
  const billRef = parseLegisNum(xml.legisNum);
  const voteDate = parseActionDate(xml.actionDate, xml.actionTime);
  const sourceUrl = `https://clerk.house.gov/Votes/${year}${listing.rollCallNumber.toString().padStart(3, '0')}`;

  // Match positions to legislators in our DB
  let matched = 0;
  const positionRows: Array<{ legislatorId: string; position: 'YES' | 'NO' | 'PRESENT' | 'NOT_VOTING' }> = [];
  for (const p of xml.positions) {
    if (!p.bioguideId) continue;
    const legId = bioguideToLegislatorId.get(p.bioguideId);
    if (!legId) continue;
    const pos = mapPosition(p.position);
    if (!pos) continue;
    positionRows.push({ legislatorId: legId, position: pos });
    matched += 1;
  }

  if (dryRun) {
    return { scored: false, positionsWritten: positionRows.length, matched };
  }

  // Upsert the RollCallVote
  const upserted = await prisma.rollCallVote.upsert({
    where: {
      chamber_congressNumber_sessionNumber_rollCallNumber: {
        chamber: 'HOUSE',
        congressNumber: CONGRESS,
        sessionNumber: listing.sessionNumber,
        rollCallNumber: listing.rollCallNumber,
      },
    },
    create: {
      chamber: 'HOUSE',
      congressNumber: CONGRESS,
      sessionNumber: listing.sessionNumber,
      rollCallNumber: listing.rollCallNumber,
      voteDate,
      voteQuestion: xml.voteQuestion || listing.voteType,
      voteResult: xml.voteResult || listing.result,
      voteType: xml.voteType || listing.voteType,
      billType: billRef?.type ?? null,
      billNumber: billRef?.number ?? null,
      billTitle: xml.voteDesc || null,
      sourceUrl,
    },
    update: {
      voteDate,
      voteQuestion: xml.voteQuestion || listing.voteType,
      voteResult: xml.voteResult || listing.result,
      voteType: xml.voteType || listing.voteType,
      billType: billRef?.type ?? null,
      billNumber: billRef?.number ?? null,
      billTitle: xml.voteDesc || null,
      sourceUrl,
    },
  });

  // Bulk insert positions (delete + insert is cleaner than per-row upsert here)
  await prisma.rollCallPosition.deleteMany({ where: { voteId: upserted.id } });
  if (positionRows.length > 0) {
    await prisma.rollCallPosition.createMany({
      data: positionRows.map((p) => ({
        voteId: upserted.id,
        legislatorId: p.legislatorId,
        position: p.position,
      })),
      skipDuplicates: true,
    });
  }

  return { scored: true, positionsWritten: positionRows.length, matched };
}

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

    let totalPos = 0;
    let totalMatched = 0;
    let processed = 0;
    for (const listing of listings) {
      processed += 1;
      await pace();
      const result = await ingestHouseVote(bioguideToLegislatorId, listing, flags.dryRun);
      totalPos += result.positionsWritten;
      totalMatched += result.matched;
      if (processed % 25 === 0) {
        console.log(
          `  processed ${processed}/${listings.length} · positions written: ${totalPos} · matched: ${totalMatched}`,
        );
      }
    }
    console.log(
      `[ingest-rollcalls] House done: ${processed} votes · ${totalPos} positions written · ${totalMatched} legislator-matches`,
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
