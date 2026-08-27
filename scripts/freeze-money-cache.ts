/**
 * Freezes each legislator's PacContribution-derived aggregates onto
 * `Legislator.moneyCache`.
 *
 * WHY: PacContribution is ~1.8M rows and ~646MB — by far the largest table, and
 * the reason the database exceeds its size limit. Nothing about it needs to be
 * live: it is an ingest-time input whose only runtime job is feeding six
 * per-legislator aggregates. Precompute those and the itemized rows become
 * droppable, re-ingested only when the data is refreshed and re-frozen.
 *
 * WORKFLOW
 *   1. npm run scorecard:freeze-money -- --dry-run     see what would be written
 *   2. npm run scorecard:freeze-money                  write the cache
 *   3. npm run scorecard:freeze-money -- --verify      diff frozen vs live
 *   4. only once --verify is clean, drop PacContribution
 *
 * --verify recomputes from the live table and compares against what was frozen,
 * so you find out BEFORE dropping 1.8M rows whether the cache is faithful.
 * Deleting first and discovering a mismatch later is unrecoverable without a
 * full re-ingest.
 */
import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { computeMoneyCacheBundle } from '../src/lib/scorecard/queries';
import { MONEY_CACHE_VERSION, readMoneyCache } from '../src/lib/scorecard/money-cache';

const url = new URL(process.env.DATABASE_URL!);
if (!url.searchParams.has('pgbouncer')) url.searchParams.set('pgbouncer', 'true');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });

/** Compares the numbers that actually reach the page, ignoring key order. */
function summarize(bundle: Awaited<ReturnType<typeof computeMoneyCacheBundle>>) {
  return JSON.stringify({
    pacScore: bundle.moneyTrail?.pacScore ?? null,
    countsAgainst: bundle.moneyTrail?.countsAgainst ?? null,
    denominator: bundle.moneyTrail?.denominator ?? null,
    totalInfluence: bundle.moneyTrail?.totalInfluence ?? null,
    ca: bundle.caMoneyTrail?.total ?? null,
    donors: bundle.topDonors.length,
    opposed: bundle.opposedBy.length,
    ieSupport: bundle.outsideMoney?.ieSupportTotal ?? null,
    influence: bundle.pacInfluence20222024,
  });
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const verify = process.argv.includes('--verify');

  const legislators = await prisma.legislator.findMany({
    select: { id: true, fullName: true, jurisdiction: true, moneyCache: true },
    orderBy: { fullName: 'asc' },
  });
  console.log(
    `[freeze] ${legislators.length} legislators — mode: ${verify ? 'VERIFY' : dryRun ? 'DRY RUN' : 'WRITE'}\n`,
  );

  let written = 0;
  let matched = 0;
  const mismatches: string[] = [];

  for (let i = 0; i < legislators.length; i += 1) {
    const leg = legislators[i];
    const bundle = await computeMoneyCacheBundle(leg.id);

    if (verify) {
      const frozen = readMoneyCache(leg.moneyCache);
      if (!frozen) {
        mismatches.push(`${leg.fullName}: NO CACHE`);
      } else {
        const live = summarize(bundle);
        const cached = summarize({
          moneyTrail: frozen.moneyTrail,
          caMoneyTrail: frozen.caMoneyTrail,
          topDonors: frozen.topDonors,
          opposedBy: frozen.opposedBy,
          outsideMoney: frozen.outsideMoney,
          pacInfluence20222024: frozen.pacInfluence20222024,
        } as Awaited<ReturnType<typeof computeMoneyCacheBundle>>);
        if (live === cached) matched += 1;
        else mismatches.push(`${leg.fullName}\n    live:   ${live}\n    frozen: ${cached}`);
      }
    } else if (!dryRun) {
      await prisma.legislator.update({
        where: { id: leg.id },
        data: {
          moneyCache: {
            version: MONEY_CACHE_VERSION,
            frozenAt: new Date().toISOString(),
            ...bundle,
          } as never,
        },
      });
      written += 1;
    } else {
      written += 1;
    }

    if ((i + 1) % 50 === 0 || i === legislators.length - 1) {
      process.stdout.write(`\r[freeze]   ${i + 1}/${legislators.length}`);
    }
  }
  console.log('');

  if (verify) {
    console.log(`\n[freeze] VERIFY — ${matched} match, ${mismatches.length} differ`);
    mismatches.slice(0, 15).forEach((m) => console.log(`[freeze]   ✗ ${m}`));
    if (mismatches.length > 15) console.log(`[freeze]   … and ${mismatches.length - 15} more`);
    if (mismatches.length === 0) {
      console.log('\n[freeze] Cache is faithful. PacContribution is now safe to drop.');
    } else {
      console.log('\n[freeze] DO NOT drop PacContribution — re-run the freeze first.');
      process.exitCode = 1;
    }
    return;
  }

  console.log(`\n[freeze] ${dryRun ? 'would write' : 'wrote'} ${written} caches`);
  if (!dryRun) console.log('[freeze] next: npm run scorecard:freeze-money -- --verify');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
