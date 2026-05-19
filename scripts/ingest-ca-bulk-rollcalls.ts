// v1.6.1 — fast bulk CA roll-call ingest from the LegiScan dataset on disk.
//
// Walks /data/2025-2026_Regular_Session/{bill,vote} and writes ALL substantive
// CA floor votes to RollCallVote + RollCallPosition. Filters out procedural
// votes (committee passes, "Read first time", reference assignments) and
// keeps Third Reading / Concurrence / final passage votes plus any divisive
// committee vote (both yes AND no recorded).
//
// Replaces the 77-row CA migration from existing BillVote data with full
// session coverage — expect ~4,000-8,000 substantive votes once filtered.
//
// Run: npm run scorecard:ingest-ca-bulk
//      npm run scorecard:ingest-ca-bulk -- --limit=100 --dry-run

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs';
import path from 'node:path';

const DATASET_DIR = '/Users/joshuafishman/dev/op/data/2025-2026_Regular_Session';
const SESSION_TAG = 20252026;

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

interface CliFlags {
  limit: number;
  dryRun: boolean;
  onlySubstantive: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { limit: 0, dryRun: false, onlySubstantive: true };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--include-procedural') flags.onlySubstantive = false;
    else if (arg.startsWith('--limit=')) flags.limit = Number(arg.split('=')[1]);
  }
  return flags;
}

// Patterns that identify SUBSTANTIVE (scorable) floor votes vs procedural.
// Conservative: anything that doesn't match the substantive patterns is excluded.
function isSubstantiveVoteDesc(desc: string): boolean {
  const d = desc.trim();
  // Substantive patterns
  if (/Third Reading|Concurrence|Final Passage|Floor Vote|Senate Floor|Assembly Floor/i.test(d)) return true;
  // "Do pass" + a floor-vote chamber count is committee — skip
  // Bill-number patterns like "AB 1 Connolly Assembly Third Reading"
  if (/(Assembly|Senate) Third Reading/i.test(d)) return true;
  // "Concurrence in Senate Amendments"
  if (/Concur(rence)? in (Senate|Assembly) Amendments/i.test(d)) return true;
  return false;
}

interface BillSummary {
  billId: number;
  billNumber: string;
  title: string;
  body: string; // A=Assembly, S=Senate
  subjects: string[];
  history: Array<{ date: string; action: string; chamber: string }>;
}

interface VoteRecord {
  rollCallId: number;
  billId: number;
  date: string;
  desc: string;
  chamber: string; // 'A' or 'S'
  yea: number;
  nay: number;
  nv: number;
  absent: number;
  passed: number;
  positions: Array<{ peopleId: number; voteText: string }>;
}

function mapVoteText(s: string): 'YES' | 'NO' | 'PRESENT' | 'NOT_VOTING' | null {
  const t = s.trim().toLowerCase();
  if (t === 'yea' || t === 'aye' || t === 'yes') return 'YES';
  if (t === 'nay' || t === 'no') return 'NO';
  if (t === 'nv' || t === 'not voting') return 'NOT_VOTING';
  if (t === 'absent') return 'NOT_VOTING';
  if (t === 'present') return 'PRESENT';
  return null;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-ca-bulk] flags: ${JSON.stringify(flags)}`);

  // Build people_id → legislator_id map
  const legs = await prisma.legislator.findMany({
    where: { jurisdiction: 'CA' },
    select: { id: true, legiscanPeopleId: true },
  });
  const legByPeopleId = new Map<number, string>();
  for (const l of legs) {
    if (l.legiscanPeopleId != null) legByPeopleId.set(l.legiscanPeopleId, l.id);
  }
  console.log(
    `[ingest-ca-bulk] ${legByPeopleId.size} CA legislators mapped by legiscanPeopleId (of ${legs.length} total)`,
  );
  if (legByPeopleId.size === 0) {
    console.error('No legislators have legiscanPeopleId set. Run: npm run scorecard:backfill-people');
    return;
  }

  // Load all bills (in-memory map keyed by bill_id)
  console.log(`[ingest-ca-bulk] reading bill JSONs...`);
  const billDir = path.join(DATASET_DIR, 'bill');
  const billFiles = fs.readdirSync(billDir);
  const billById = new Map<number, BillSummary>();
  for (const f of billFiles) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(billDir, f), 'utf-8'));
      const b = raw.bill;
      if (!b) continue;
      billById.set(b.bill_id, {
        billId: b.bill_id,
        billNumber: b.bill_number,
        title: b.title ?? '',
        body: b.body ?? '',
        subjects: (b.subjects ?? []).map((s: { subject_name?: string }) => s.subject_name ?? '').filter(Boolean),
        history: b.history ?? [],
      });
    } catch {
      // skip bad files
    }
  }
  console.log(`[ingest-ca-bulk] loaded ${billById.size} bills`);

  // Walk vote dir
  const voteDir = path.join(DATASET_DIR, 'vote');
  const voteFiles = fs.readdirSync(voteDir);
  console.log(`[ingest-ca-bulk] ${voteFiles.length} vote files on disk`);

  let totalScanned = 0;
  let totalSubstantive = 0;
  let totalSkippedProcedural = 0;
  let totalSkippedNoBill = 0;
  let totalKept: VoteRecord[] = [];

  for (const f of voteFiles) {
    if (flags.limit > 0 && totalScanned >= flags.limit) break;
    totalScanned += 1;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(voteDir, f), 'utf-8'));
      const rc = raw.roll_call ?? raw;
      const bill = billById.get(rc.bill_id);
      if (!bill) {
        totalSkippedNoBill += 1;
        continue;
      }
      if (flags.onlySubstantive && !isSubstantiveVoteDesc(rc.desc ?? '')) {
        totalSkippedProcedural += 1;
        continue;
      }
      totalSubstantive += 1;
      const positions: VoteRecord['positions'] = [];
      for (const v of rc.votes ?? []) {
        if (v.people_id && v.vote_text) {
          positions.push({ peopleId: v.people_id, voteText: v.vote_text });
        }
      }
      totalKept.push({
        rollCallId: rc.roll_call_id,
        billId: rc.bill_id,
        date: rc.date,
        desc: rc.desc ?? '',
        chamber: rc.chamber ?? bill.body,
        yea: rc.yea ?? 0,
        nay: rc.nay ?? 0,
        nv: rc.nv ?? 0,
        absent: rc.absent ?? 0,
        passed: rc.passed ?? 0,
        positions,
      });
    } catch {
      // skip bad files
    }
  }
  console.log(
    `[ingest-ca-bulk] scanned=${totalScanned} substantive=${totalSubstantive} procedural-skipped=${totalSkippedProcedural} no-bill=${totalSkippedNoBill}`,
  );

  if (flags.dryRun) {
    console.log(`\n[ingest-ca-bulk] DRY RUN — sample 10 substantive votes:`);
    for (const v of totalKept.slice(0, 10)) {
      const b = billById.get(v.billId)!;
      console.log(`  ${b.billNumber.padEnd(8)}  ${v.chamber}  yea=${v.yea} nay=${v.nay}  ${v.desc.slice(0, 70)}`);
    }
    await prisma.$disconnect();
    return;
  }

  // Bulk insert in batches of 100 votes
  let totalVotesWritten = 0;
  let totalPositionsWritten = 0;
  let totalUnmatchedPeople = 0;
  const BATCH = 100;

  for (let i = 0; i < totalKept.length; i += BATCH) {
    const slice = totalKept.slice(i, i + BATCH);

    // Build VALUES for RollCallVote bulk INSERT
    const params: unknown[] = [];
    const values = slice
      .map((v, idx) => {
        const bill = billById.get(v.billId)!;
        const chamberCode = v.chamber === 'S' ? 'CA_SENATE' : 'CA_ASSEMBLY';
        const sessionN = 1;
        const sourceUrl = `https://legiscan.com/CA/rollcall/${bill.billNumber}/id/${v.rollCallId}`;
        const base = idx * 13;
        const voteDate = v.date ? new Date(v.date) : new Date(0);
        const result = v.passed === 1 ? 'Passed' : 'Failed';
        params.push(
          chamberCode,
          SESSION_TAG,
          sessionN,
          v.rollCallId, // unique per roll, fits @@unique([chamber, congressNumber, sessionNumber, rollCallNumber])
          voteDate,
          v.desc.slice(0, 200),
          result,
          'Floor Vote',
          'CA_BILL',
          bill.billNumber,
          bill.title.slice(0, 500),
          sourceUrl,
          bill.subjects, // billSubjects array — Json column
        );
        return `(gen_random_uuid()::text, $${base + 1}::"RollCallChamber", $${base + 2}, $${base + 3}, $${base + 4}, $${
          base + 5
        }, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${
          base + 13
        }::jsonb, NOW(), NOW())`;
      })
      .join(',');
    const sql =
      `INSERT INTO "RollCallVote" ` +
      `("id", "chamber", "congressNumber", "sessionNumber", "rollCallNumber", "voteDate", "voteQuestion", "voteResult", "voteType", "billType", "billNumber", "billTitle", "sourceUrl", "billSubjects", "createdAt", "updatedAt") ` +
      `VALUES ${values} ` +
      `ON CONFLICT ("chamber", "congressNumber", "sessionNumber", "rollCallNumber") DO UPDATE SET ` +
      `"voteDate" = EXCLUDED."voteDate", "voteQuestion" = EXCLUDED."voteQuestion", "voteResult" = EXCLUDED."voteResult", ` +
      `"billNumber" = EXCLUDED."billNumber", "billTitle" = EXCLUDED."billTitle", "sourceUrl" = EXCLUDED."sourceUrl", ` +
      `"billSubjects" = EXCLUDED."billSubjects", "updatedAt" = NOW() ` +
      `RETURNING "id", "chamber", "rollCallNumber"`;
    const upserted = (await prisma.$executeRawUnsafe(
      `${sql.replace(' RETURNING "id", "chamber", "rollCallNumber"', '')}`,
      ...params,
    )) as number;
    totalVotesWritten += slice.length;

    // Fetch the just-upserted IDs by querying (since $executeRawUnsafe returns row count, not rows)
    const ids = await prisma.rollCallVote.findMany({
      where: {
        chamber: { in: ['CA_ASSEMBLY', 'CA_SENATE'] },
        congressNumber: SESSION_TAG,
        rollCallNumber: { in: slice.map((v) => v.rollCallId) },
      },
      select: { id: true, rollCallNumber: true },
    });
    const idByRoll = new Map(ids.map((r) => [r.rollCallNumber, r.id]));

    // Delete old positions for these votes, then bulk insert new
    const voteIds = [...idByRoll.values()];
    await prisma.rollCallPosition.deleteMany({ where: { voteId: { in: voteIds } } });

    const positionRows: Array<{
      voteId: string;
      legislatorId: string;
      position: 'YES' | 'NO' | 'PRESENT' | 'NOT_VOTING';
    }> = [];
    for (const v of slice) {
      const voteId = idByRoll.get(v.rollCallId);
      if (!voteId) continue;
      for (const p of v.positions) {
        const legislatorId = legByPeopleId.get(p.peopleId);
        if (!legislatorId) {
          totalUnmatchedPeople += 1;
          continue;
        }
        const pos = mapVoteText(p.voteText);
        if (!pos) continue;
        positionRows.push({ voteId, legislatorId, position: pos });
      }
    }
    if (positionRows.length > 0) {
      const CHUNK = 1000;
      for (let j = 0; j < positionRows.length; j += CHUNK) {
        await prisma.rollCallPosition.createMany({
          data: positionRows.slice(j, j + CHUNK),
          skipDuplicates: true,
        });
      }
      totalPositionsWritten += positionRows.length;
    }

    if ((i / BATCH) % 10 === 0) {
      console.log(`  ${i + slice.length}/${totalKept.length} votes upserted · ${totalPositionsWritten} positions`);
    }
  }
  console.log(
    `[ingest-ca-bulk] ✓ ${totalVotesWritten} CA RollCallVotes · ${totalPositionsWritten} positions · ${totalUnmatchedPeople} unmatched people_ids`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
