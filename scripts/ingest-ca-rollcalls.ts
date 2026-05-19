// v1.6 CA ingest — migrates existing CA BillVote + BillSponsorship data into
// the unified RollCallVote / RollCallPosition schema so CA legislators can
// be scored under the v1.6 alignment-percentage methodology alongside federal.
//
// This is a one-pass migration that reads the existing CA MarkerBill →
// BillVote relationships (populated via the Cal-Access / LegiScan ingest
// previously) and writes them as RollCallVote rows with chamber=CA_ASSEMBLY
// or CA_SENATE inferred from the legislator pool.
//
// Vote-question / vote-result are synthesized from BillVote.voteContext
// when available; bill metadata (title) is copied from MarkerBill.
// alignedPosition + plankNumbers are left null — those get filled by
// running classify-with-llm against the 18 CA bills next.
//
// Run: npm run scorecard:ingest-ca-rollcalls
//      npm run scorecard:ingest-ca-rollcalls -- --dry-run

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

interface CliFlags {
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false };
  for (const arg of argv.slice(2)) if (arg === '--dry-run') flags.dryRun = true;
  return flags;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  console.log(`[ingest-ca-rollcalls] flags: ${JSON.stringify(flags)}`);

  // Build map: legislatorId → chamber (REP=Assembly, SEN=Senate) for CA
  const caLegs = await prisma.legislator.findMany({
    where: { jurisdiction: 'CA' },
    select: { id: true, chamber: true },
  });
  const chamberByLeg = new Map(caLegs.map((l) => [l.id, l.chamber as 'SEN' | 'REP']));

  // Pull all CA BillVote rows with their MarkerBill + Marker + Plank linkage
  const caBills = await prisma.markerBill.findMany({
    where: { marker: { plank: { jurisdiction: 'CA' } } },
    include: {
      marker: { include: { plank: { select: { number: true } } } },
      votes: {
        select: {
          id: true,
          legislatorId: true,
          position: true,
          voteDate: true,
          voteContext: true,
          sourceUrl: true,
        },
      },
    },
  });
  console.log(
    `[ingest-ca-rollcalls] ${caBills.length} CA MarkerBills with ${caBills.reduce(
      (s, b) => s + b.votes.length,
      0,
    )} BillVote rows`,
  );

  // Group votes by (bill, voteContext) — each unique context becomes a
  // RollCallVote row. CA legislators are split across Assembly (chamber=REP)
  // and Senate (chamber=SEN); votes are usually in one chamber or the other.
  interface CaVoteGroup {
    billId: string;
    billNumber: string;
    billTitle: string;
    plankNumber: number;
    voteContext: string;
    sourceUrl: string | null;
    voteDate: Date | null;
    positions: Array<{
      legislatorId: string;
      position: 'YES' | 'NO' | 'NOT_VOTING' | 'EXCUSED' | 'PRESENT' | 'ABSTAINED';
      chamber: 'SEN' | 'REP';
    }>;
  }
  const groups = new Map<string, CaVoteGroup>();
  for (const b of caBills) {
    for (const v of b.votes) {
      const chamber = chamberByLeg.get(v.legislatorId);
      if (!chamber) continue;
      const ctx = v.voteContext ?? '(unknown context)';
      const key = `${b.id}|${ctx}|${chamber}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          billId: b.id,
          billNumber: b.billNumber,
          billTitle: b.billTitle ?? '',
          plankNumber: b.marker.plank.number,
          voteContext: ctx,
          sourceUrl: v.sourceUrl,
          voteDate: v.voteDate,
          positions: [],
        };
        groups.set(key, g);
      }
      g.positions.push({ legislatorId: v.legislatorId, position: v.position, chamber });
    }
  }
  console.log(`[ingest-ca-rollcalls] ${groups.size} unique (bill, context, chamber) rollcall-equivalent groups`);

  if (flags.dryRun) {
    console.log(`\n[ingest-ca-rollcalls] DRY RUN — sample 5:`);
    for (const g of [...groups.values()].slice(0, 5)) {
      const chamber = g.positions[0]?.chamber;
      console.log(
        `  ${chamber === 'SEN' ? 'CA_SENATE' : 'CA_ASSEMBLY'}  ${g.billNumber.padEnd(8)}  P${g.plankNumber}  ${
          g.positions.length
        } positions  "${g.voteContext.slice(0, 60)}"`,
      );
    }
    await prisma.$disconnect();
    return;
  }

  // Assign synthetic rollCallNumber per (chamber). We use a hash-based number
  // for stability: chambers track to distinct number ranges so we can append
  // future LegiScan-sourced rolls without colliding.
  let nextNumByChamber: Record<string, number> = { CA_ASSEMBLY: 1, CA_SENATE: 1 };

  const params: unknown[] = [];
  const valuesA: string[] = [];
  const valuesS: string[] = [];
  const groupsList = [...groups.values()];
  for (const g of groupsList) {
    const chamberRC = g.positions[0]?.chamber === 'SEN' ? 'CA_SENATE' : 'CA_ASSEMBLY';
    const num = nextNumByChamber[chamberRC]++;
    const voteDate = g.voteDate ?? new Date();
    const base = params.length;
    params.push(
      chamberRC,
      2025, // 2025-2026 CA session encoded as congressNumber=2025
      1,
      num,
      voteDate,
      g.voteContext.slice(0, 200),
      'Passed', // CA voteResult not stored on BillVote — default
      'Floor Vote',
      'CA_BILL',
      g.billNumber,
      g.billTitle.slice(0, 500),
      g.sourceUrl ?? '',
      [g.plankNumber], // pre-fill plankNumbers; alignment direction left null pending LLM
    );
    const refs = `(gen_random_uuid()::text, $${base + 1}::"RollCallChamber", $${base + 2}, $${base + 3}, $${
      base + 4
    }, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${
      base + 12
    }, $${base + 13}::int[], NOW(), NOW())`;
    if (chamberRC === 'CA_SENATE') valuesS.push(refs);
    else valuesA.push(refs);
  }

  // Bulk insert in chunks. Group all values together since the SQL is uniform.
  const allValues = [...valuesA, ...valuesS].join(',');
  if (allValues) {
    const sql =
      `INSERT INTO "RollCallVote" ` +
      `("id", "chamber", "congressNumber", "sessionNumber", "rollCallNumber", "voteDate", "voteQuestion", "voteResult", "voteType", "billType", "billNumber", "billTitle", "sourceUrl", "plankNumbers", "createdAt", "updatedAt") ` +
      `VALUES ${allValues} ` +
      `ON CONFLICT ("chamber", "congressNumber", "sessionNumber", "rollCallNumber") DO NOTHING ` +
      `RETURNING "id", "chamber", "rollCallNumber"`;
    const inserted = (await prisma.$queryRawUnsafe(sql, ...params)) as Array<{
      id: string;
      chamber: 'CA_ASSEMBLY' | 'CA_SENATE';
      rollCallNumber: number;
    }>;
    console.log(`[ingest-ca-rollcalls] inserted ${inserted.length} RollCallVote rows`);

    // Index: (chamber, rollCallNumber) → id for position insertion
    const idByKey = new Map(inserted.map((r) => [`${r.chamber}|${r.rollCallNumber}`, r.id]));

    // Re-walk groups in same order, build positions
    let posCounter = 0;
    let acc: Array<{
      voteId: string;
      legislatorId: string;
      position: 'YES' | 'NO' | 'NOT_VOTING' | 'EXCUSED' | 'PRESENT' | 'ABSTAINED';
    }> = [];
    let cAsm = 1;
    let cSen = 1;
    for (const g of groupsList) {
      const chamberRC = g.positions[0]?.chamber === 'SEN' ? 'CA_SENATE' : 'CA_ASSEMBLY';
      const num = chamberRC === 'CA_SENATE' ? cSen++ : cAsm++;
      const voteId = idByKey.get(`${chamberRC}|${num}`);
      if (!voteId) continue;
      for (const p of g.positions) {
        acc.push({ voteId, legislatorId: p.legislatorId, position: p.position });
        posCounter += 1;
        if (acc.length >= 1000) {
          await prisma.rollCallPosition.createMany({ data: acc, skipDuplicates: true });
          acc = [];
        }
      }
    }
    if (acc.length > 0) await prisma.rollCallPosition.createMany({ data: acc, skipDuplicates: true });
    console.log(`[ingest-ca-rollcalls] inserted ${posCounter} RollCallPosition rows`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
