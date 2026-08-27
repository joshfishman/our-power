/**
 * Reclaims database space by dropping data nothing reads.
 *
 * TIER 1 ONLY — none of this changes a single published score:
 *
 *  1. RollCallPosition — the v1.7 engine's auto-classified roll-call net.
 *     v2.0 scores the Voting Record from curated BillVote rows instead, and
 *     nothing under src/ reads RollCallPosition at all (verified by grep). It
 *     is written by ingest scripts and consumed only by superseded compute
 *     scripts, both of which can rebuild it from LegiScan if ever needed.
 *
 *  2. Superseded RepresentativeScore versions — every methodologyVersion
 *     except the ones the app actually reads. The read path already filters
 *     by version, so these rows are invisible today.
 *
 *  3. ApiCallLog — request telemetry, safe to truncate.
 *
 * Deleting rows does NOT return space to the filesystem; Postgres keeps it for
 * reuse. Pass --vacuum to run VACUUM FULL afterwards, which does reclaim it but
 * takes an ACCESS EXCLUSIVE lock on each table for the duration — the site will
 * error on those tables while it runs. VACUUM FULL cannot run through pgbouncer
 * or inside a transaction, so it uses DIRECT_URL.
 *
 * Dry run by default. Pass --execute to actually delete.
 */
import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/** Versions the running app still reads. Everything else is dead weight. */
const KEEP_SCORE_VERSIONS = [
  'v2.0', // VOTING_DISPLAY_METHODOLOGY — the public Voting Record
  'v1.9.1', // PLANK_ENGINE_VERSION — keys ScoreCalibration anchors
];

const pooled = new URL(process.env.DATABASE_URL!);
if (!pooled.searchParams.has('pgbouncer')) pooled.searchParams.set('pgbouncer', 'true');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: pooled.toString() }) });

const fmt = (n: number): string => n.toLocaleString();

async function totalSize(): Promise<string> {
  const [row] = await prisma.$queryRawUnsafe<Array<{ size: string }>>(
    `SELECT pg_size_pretty(pg_database_size(current_database())) AS size`,
  );
  return row.size;
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const vacuum = process.argv.includes('--vacuum');
  const mode = execute ? 'EXECUTE' : 'DRY RUN';

  console.log(`[prune] ${mode} — database is currently ${await totalSize()}\n`);

  // 1. RollCallPosition
  const positions = await prisma.rollCallPosition.count();
  console.log(`[prune] RollCallPosition: ${fmt(positions)} rows (~129 MB) — no read sites in src/`);
  if (execute && positions > 0) {
    // Chunked so a single statement never holds a huge transaction open.
    let removed = 0;
    for (;;) {
      const batch = await prisma.rollCallPosition.findMany({ take: 20_000, select: { id: true } });
      if (batch.length === 0) break;
      await prisma.rollCallPosition.deleteMany({ where: { id: { in: batch.map((r) => r.id) } } });
      removed += batch.length;
      process.stdout.write(`\r[prune]   deleted ${fmt(removed)}/${fmt(positions)}`);
    }
    console.log('');
  }

  // 2. Superseded RepresentativeScore versions
  const versions = await prisma.representativeScore.groupBy({
    by: ['methodologyVersion'],
    _count: { _all: true },
  });
  const stale = versions.filter((v) => !KEEP_SCORE_VERSIONS.includes(v.methodologyVersion));
  const staleRows = stale.reduce((sum, v) => sum + v._count._all, 0);
  console.log(
    `\n[prune] RepresentativeScore: dropping ${stale.length} superseded versions ` +
      `(${fmt(staleRows)} rows), keeping ${KEEP_SCORE_VERSIONS.join(' + ')}`,
  );
  stale.forEach((v) => console.log(`[prune]   - ${v.methodologyVersion}: ${fmt(v._count._all)} rows`));
  if (execute && staleRows > 0) {
    const { count } = await prisma.representativeScore.deleteMany({
      where: { methodologyVersion: { notIn: KEEP_SCORE_VERSIONS } },
    });
    console.log(`[prune]   deleted ${fmt(count)}`);
  }

  // 3. ApiCallLog
  const logs = await prisma.apiCallLog.count();
  console.log(`\n[prune] ApiCallLog: ${fmt(logs)} rows`);
  if (execute && logs > 0) {
    const { count } = await prisma.apiCallLog.deleteMany({});
    console.log(`[prune]   deleted ${fmt(count)}`);
  }

  if (!execute) {
    console.log('\n[prune] DRY RUN — nothing deleted. Re-run with --execute (and --vacuum to reclaim disk).');
    return;
  }

  console.log(`\n[prune] deletes complete — database reports ${await totalSize()}`);
  console.log('[prune] (space is not returned to disk until VACUUM FULL)');

  if (vacuum) {
    await prisma.$disconnect();
    const direct = process.env.DIRECT_URL || process.env.DATABASE_URL!;
    const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: direct }) });
    console.log('\n[prune] VACUUM FULL — tables are exclusively locked while this runs');
    for (const table of ['RollCallPosition', 'RepresentativeScore', 'ApiCallLog', 'PacContribution']) {
      process.stdout.write(`[prune]   ${table}… `);
      await raw.$executeRawUnsafe(`VACUUM (FULL, ANALYZE) "${table}"`);
      console.log('done');
    }
    console.log(
      `\n[prune] final size: ${await raw
        .$queryRawUnsafe(`SELECT pg_size_pretty(pg_database_size(current_database()))`)
        .then((r: any) => r[0].pg_size_pretty)}`,
    );
    await raw.$disconnect();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().catch(() => {}));
