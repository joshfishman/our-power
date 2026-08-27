/**
 * Backfills Plank.commitments from the seed files.
 *
 * Deliberately narrower than `npm run prisma:seed-scorecard`: the full seed also
 * upserts markers and bills, releases publicSlugs and prunes orphan MarkerBill
 * rows. None of that is needed to populate one new column, and none of it should
 * run against production just to land a copy change. This touches Plank rows
 * only, matching on (jurisdiction, slug).
 *
 * Idempotent. Pass --dry-run to see what would change without writing.
 */
import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { FEDERAL_PLANKS } from '../src/lib/scorecard/federal-planks';
import { CA_PLANKS } from '../src/lib/scorecard/ca-planks';

const url = new URL(process.env.DATABASE_URL!);
if (!url.searchParams.has('pgbouncer')) url.searchParams.set('pgbouncer', 'true');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const seeds = [...FEDERAL_PLANKS, ...CA_PLANKS];
  let updated = 0;
  let unchanged = 0;
  let missing = 0;

  for (const seed of seeds) {
    const existing = await prisma.plank.findUnique({
      where: { jurisdiction_slug: { jurisdiction: seed.jurisdiction, slug: seed.slug } },
      select: { id: true, commitments: true },
    });
    if (!existing) {
      console.warn(`[backfill] MISSING ${seed.jurisdiction}/${seed.slug} — not in DB, skipping`);
      missing += 1;
      continue;
    }
    const same =
      existing.commitments.length === seed.commitments.length &&
      existing.commitments.every((c, i) => c === seed.commitments[i]);
    if (same) {
      unchanged += 1;
      continue;
    }
    console.log(
      `[backfill] ${dryRun ? 'WOULD SET' : 'SET'} ${seed.jurisdiction}/${seed.slug} — ${
        seed.commitments.length
      } commitments (was ${existing.commitments.length})`,
    );
    if (!dryRun) {
      await prisma.plank.update({ where: { id: existing.id }, data: { commitments: seed.commitments } });
    }
    updated += 1;
  }

  console.log(
    `\n[backfill] ${dryRun ? 'would update' : 'updated'} ${updated}, unchanged ${unchanged}, missing ${missing}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
