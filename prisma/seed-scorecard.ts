import dotenv from 'dotenv';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

import { FEDERAL_PLANKS } from '../src/lib/scorecard/federal-planks';
import { CA_PLANKS } from '../src/lib/scorecard/ca-planks';
import { seedLegislatorsFromFederalJson, seedLegislatorsFromCaJson } from '../src/lib/scorecard/legislators-from-json';
import type { SeedPlank } from '../src/lib/scorecard/types';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

/**
 * Validates the static seed data before any DB write. Catches Option C
 * violations and dangling parallelMarkerSlug references at seed time
 * rather than letting them through to runtime.
 */
function validatePlanks(planks: SeedPlank[]): void {
  for (const plank of planks) {
    const primaryCount = plank.markers.filter((m) => m.markerType === 'PRIMARY').length;
    if (primaryCount !== 1) {
      throw new Error(
        `[seed-scorecard] Plank ${plank.jurisdiction}/${plank.slug} has ${primaryCount} primary markers; exactly one is required.`,
      );
    }

    const slugSet = new Set(plank.markers.map((m) => m.slug));
    for (const marker of plank.markers) {
      if (marker.markerType === 'PRIMARY' && marker.isRepublicanAlternative) {
        throw new Error(
          `[seed-scorecard] Marker ${plank.slug}/${marker.slug} cannot be both PRIMARY and isRepublicanAlternative — Option C violation.`,
        );
      }
      if (marker.isRepublicanAlternative && !marker.parallelMarkerSlug) {
        throw new Error(
          `[seed-scorecard] Republican alternative marker ${plank.slug}/${marker.slug} must declare parallelMarkerSlug.`,
        );
      }
      if (marker.parallelMarkerSlug && !slugSet.has(marker.parallelMarkerSlug)) {
        throw new Error(
          `[seed-scorecard] Marker ${plank.slug}/${marker.slug} references parallelMarkerSlug='${marker.parallelMarkerSlug}' that is not present on the same plank.`,
        );
      }
    }
  }
}

async function seedPlanks(planks: SeedPlank[]): Promise<{
  planksCreated: number;
  markersCreated: number;
  billsCreated: number;
}> {
  let planksCreated = 0;
  let markersCreated = 0;
  let billsCreated = 0;

  for (const seed of planks) {
    const plank = await prisma.plank.upsert({
      where: { jurisdiction_slug: { jurisdiction: seed.jurisdiction, slug: seed.slug } },
      create: {
        jurisdiction: seed.jurisdiction,
        slug: seed.slug,
        number: seed.number,
        name: seed.name,
        shortDescription: seed.shortDescription,
        tagline: seed.tagline,
        body: seed.body,
        color: seed.color,
      },
      update: {
        number: seed.number,
        name: seed.name,
        shortDescription: seed.shortDescription,
        tagline: seed.tagline,
        body: seed.body,
        color: seed.color,
      },
    });
    planksCreated += 1;

    // Two-pass marker upsert so parallelMarkerId can resolve.
    // Pass 1: create/update all markers without parallelMarkerId.
    const slugToId = new Map<string, string>();
    for (const m of seed.markers) {
      const marker = await prisma.marker.upsert({
        where: { plankId_slug: { plankId: plank.id, slug: m.slug } },
        create: {
          plankId: plank.id,
          jurisdiction: seed.jurisdiction,
          slug: m.slug,
          name: m.name,
          markerType: m.markerType,
          description: m.description,
          methodologyNotes: m.methodologyNotes ?? null,
          displayOrder: m.displayOrder ?? 0,
          isRepublicanAlternative: m.isRepublicanAlternative ?? false,
        },
        update: {
          name: m.name,
          markerType: m.markerType,
          description: m.description,
          methodologyNotes: m.methodologyNotes ?? null,
          displayOrder: m.displayOrder ?? 0,
          isRepublicanAlternative: m.isRepublicanAlternative ?? false,
          // parallelMarkerId is set in Pass 2.
        },
      });
      slugToId.set(m.slug, marker.id);
      markersCreated += 1;

      // PRE-PASS — release publicSlug from any existing rows under this
      // marker BEFORE we upsert. publicSlug is globally unique, so if a
      // bill is being renamed (e.g., AB-2200 → AB-1900 owning 'calcare'),
      // the new bill's create-step would collide with the old row's
      // existing slug. Null-out slugs first; the upsert below sets the
      // correct one back.
      await prisma.markerBill.updateMany({
        where: { markerId: marker.id, publicSlug: { not: null } },
        data: { publicSlug: null },
      });

      // Bills: upsert by (markerId, billType, billNumber).
      for (const bill of m.bills) {
        await prisma.markerBill.upsert({
          where: {
            markerId_billType_billNumber: {
              markerId: marker.id,
              billType: bill.billType,
              billNumber: bill.billNumber,
            },
          },
          create: {
            markerId: marker.id,
            congressNumber: bill.congressNumber,
            billType: bill.billType,
            billNumber: bill.billNumber,
            billTitle: bill.billTitle,
            actionType: bill.actionType,
            notes: bill.notes ?? null,
            isProvisional: bill.isProvisional ?? true,
            legiscanBillId: bill.legiscanBillId ?? null,
            publicSlug: bill.publicSlug ?? null,
            publicDescription: bill.publicDescription ?? null,
            statusNote: bill.statusNote ?? null,
            callToAction: bill.callToAction ?? null,
            isFeatured: bill.isFeatured ?? false,
          },
          update: {
            congressNumber: bill.congressNumber,
            billTitle: bill.billTitle,
            actionType: bill.actionType,
            notes: bill.notes ?? null,
            isProvisional: bill.isProvisional ?? true,
            // Only overwrite legiscanBillId if the seed pins one; otherwise
            // preserve whatever the sync may have backfilled from a prior run.
            ...(bill.legiscanBillId !== undefined ? { legiscanBillId: bill.legiscanBillId } : {}),
            publicSlug: bill.publicSlug ?? null,
            publicDescription: bill.publicDescription ?? null,
            statusNote: bill.statusNote ?? null,
            callToAction: bill.callToAction ?? null,
            isFeatured: bill.isFeatured ?? false,
          },
        });
        billsCreated += 1;
      }

      // Prune any MarkerBill rows under this marker that aren't in the seed.
      // Necessary because the upsert key is (markerId, billType, billNumber),
      // so renumbering a bill (e.g., S.1170 → S.1498) creates a new row
      // instead of updating the old one. Without this pass, stale rows would
      // accumulate under existing markers across reseed runs.
      const seedKeys = new Set(m.bills.map((b) => `${b.billType}::${b.billNumber}`));
      const existing = await prisma.markerBill.findMany({
        where: { markerId: marker.id },
        select: { id: true, billType: true, billNumber: true },
      });
      const stale = existing.filter((row) => !seedKeys.has(`${row.billType}::${row.billNumber}`));
      if (stale.length > 0) {
        await prisma.markerBill.deleteMany({
          where: { id: { in: stale.map((s) => s.id) } },
        });
        console.log(`  [prune] removed ${stale.length} stale MarkerBill row(s) under marker ${m.slug}`);
      }
    }

    // Pass 2: now that all markers exist, resolve parallelMarkerId references.
    for (const m of seed.markers) {
      if (!m.parallelMarkerSlug) continue;
      const targetId = slugToId.get(m.parallelMarkerSlug);
      const sourceId = slugToId.get(m.slug);
      if (!targetId || !sourceId) continue;
      await prisma.marker.update({
        where: { id: sourceId },
        data: { parallelMarkerId: targetId },
      });
    }
  }

  return { planksCreated, markersCreated, billsCreated };
}

async function seedLegislators(): Promise<{ federalCount: number; caCount: number }> {
  const federal = seedLegislatorsFromFederalJson();
  const ca = seedLegislatorsFromCaJson();

  let federalCount = 0;
  for (const leg of federal) {
    if (!leg.bioguideId) continue;
    await prisma.legislator.upsert({
      where: { bioguideId: leg.bioguideId },
      create: {
        jurisdiction: leg.jurisdiction,
        bioguideId: leg.bioguideId,
        firstName: leg.firstName,
        lastName: leg.lastName,
        fullName: leg.fullName,
        chamber: leg.chamber,
        state: leg.state,
        district: leg.district,
        party: leg.party,
        opensecretsId: leg.opensecretsId,
        fecIds: leg.fecIds,
        govtrackId: leg.govtrackId,
        photoUrl: leg.photoUrl,
        isActive: leg.isActive,
      },
      update: {
        firstName: leg.firstName,
        lastName: leg.lastName,
        fullName: leg.fullName,
        chamber: leg.chamber,
        state: leg.state,
        district: leg.district,
        party: leg.party,
        opensecretsId: leg.opensecretsId,
        fecIds: leg.fecIds,
        govtrackId: leg.govtrackId,
        photoUrl: leg.photoUrl,
        isActive: leg.isActive,
      },
    });
    federalCount += 1;
  }

  let caCount = 0;
  for (const leg of ca) {
    // Prefer openStatesId when available (now sourced from the OpenStates CSV
    // `id` column). Fall back to (jurisdiction, fullName, chamber, district)
    // for rows that pre-date the backfill.
    const existing = leg.openStatesId
      ? await prisma.legislator.findFirst({
          where: {
            OR: [
              { openStatesId: leg.openStatesId },
              {
                jurisdiction: 'CA',
                fullName: leg.fullName,
                chamber: leg.chamber,
                district: leg.district,
              },
            ],
          },
        })
      : await prisma.legislator.findFirst({
          where: {
            jurisdiction: 'CA',
            fullName: leg.fullName,
            chamber: leg.chamber,
            district: leg.district,
          },
        });
    if (existing) {
      await prisma.legislator.update({
        where: { id: existing.id },
        data: {
          firstName: leg.firstName,
          lastName: leg.lastName,
          state: leg.state,
          party: leg.party,
          photoUrl: leg.photoUrl,
          isActive: leg.isActive,
          ...(leg.openStatesId ? { openStatesId: leg.openStatesId } : {}),
        },
      });
    } else {
      await prisma.legislator.create({
        data: {
          jurisdiction: leg.jurisdiction,
          openStatesId: leg.openStatesId,
          firstName: leg.firstName,
          lastName: leg.lastName,
          fullName: leg.fullName,
          chamber: leg.chamber,
          state: leg.state,
          district: leg.district,
          party: leg.party,
          fecIds: leg.fecIds,
          photoUrl: leg.photoUrl,
          isActive: leg.isActive,
        },
      });
    }
    caCount += 1;
  }

  return { federalCount, caCount };
}

async function main() {
  console.log('[seed-scorecard] Validating seed data...');
  validatePlanks(FEDERAL_PLANKS);
  validatePlanks(CA_PLANKS);
  console.log('[seed-scorecard] Seed data valid.');

  console.log('[seed-scorecard] Seeding federal planks...');
  const fed = await seedPlanks(FEDERAL_PLANKS);
  console.log(
    `[seed-scorecard]   federal: ${fed.planksCreated} planks, ${fed.markersCreated} markers, ${fed.billsCreated} bills`,
  );

  console.log('[seed-scorecard] Seeding CA planks...');
  const ca = await seedPlanks(CA_PLANKS);
  console.log(
    `[seed-scorecard]   CA: ${ca.planksCreated} planks, ${ca.markersCreated} markers, ${ca.billsCreated} bills`,
  );

  console.log('[seed-scorecard] Seeding legislators from bundled JSONs...');
  const { federalCount, caCount } = await seedLegislators();
  console.log(`[seed-scorecard]   federal: ${federalCount} legislators, CA: ${caCount} legislators`);

  console.log('[seed-scorecard] Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
