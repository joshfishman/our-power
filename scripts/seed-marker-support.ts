// Seeds Marker.popularSupport + Marker.popularSupportPoll from a curated
// public-opinion-polling file (methodology v1.9.2 popular-support floor).
//
// Data source: data/marker-popular-support.json — a hand-curated list of
// per-marker national polling figures. Each entry keys a Marker by the stable
// tuple (jurisdiction, plankNumber, markerSlug) — the same identity used by
// federal-planks.ts / ca-planks.ts and enforced in the DB by the
// Marker @@unique([plankId, slug]) constraint (slugs are unique within a
// plank, and plank is unique within a jurisdiction via @@unique([jurisdiction,
// number])). markerName is carried for human readability only.
//
// JSON shape:
//   [
//     {
//       "jurisdiction": "FEDERAL",      // "FEDERAL" | "CA"
//       "plankNumber": 1,                // 1..5
//       "markerSlug": "stock-trading-ban",
//       "markerName": "Cosponsored congressional stock trading ban", // optional
//       "supportPct": 86,                // 0..100, or null = leave field null
//       "poll": "Pollster, field date, https://..., \"question wording\""
//     },
//     ...
//   ]
//
// Behaviour:
//   - Idempotent: updates the matched Marker's popularSupport + popularSupportPoll.
//   - supportPct === null → leaves popularSupport (and poll) null on the Marker
//     (the marker stays unassessed and therefore still counts toward scoring).
//   - Unmatched key → logged + skipped (no crash).
//   - Missing JSON file → clean exit with a message (the sibling agent may not
//     have written it yet).
//   - --dry-run → reports what it WOULD write, touches nothing.
//
// Run:
//   npm run scorecard:seed-marker-support
//   npm run scorecard:seed-marker-support -- --dry-run

import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA_PATH = resolve(process.cwd(), 'data/marker-popular-support.json');

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

type Jurisdiction = 'FEDERAL' | 'CA';

interface SupportEntry {
  jurisdiction: Jurisdiction;
  plankNumber: number;
  markerSlug: string;
  markerName?: string;
  supportPct: number | null;
  poll?: string | null;
}

interface CliFlags {
  dryRun: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') flags.dryRun = true;
  }
  return flags;
}

function isValidEntry(e: unknown): e is SupportEntry {
  if (typeof e !== 'object' || e === null) return false;
  const r = e as Record<string, unknown>;
  if (r.jurisdiction !== 'FEDERAL' && r.jurisdiction !== 'CA') return false;
  if (typeof r.plankNumber !== 'number') return false;
  if (typeof r.markerSlug !== 'string' || r.markerSlug.length === 0) return false;
  if (r.supportPct !== null && typeof r.supportPct !== 'number') return false;
  return true;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);

  if (!existsSync(DATA_PATH)) {
    console.log(`[seed-marker-support] ${DATA_PATH} not found — nothing to seed. Exiting cleanly.`);
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  } catch (err) {
    console.error(`[seed-marker-support] failed to parse ${DATA_PATH}:`, err);
    process.exitCode = 1;
    return;
  }

  if (!Array.isArray(raw)) {
    console.error('[seed-marker-support] expected the JSON root to be an array of entries.');
    process.exitCode = 1;
    return;
  }

  const entries = raw.filter(isValidEntry);
  const skippedShape = raw.length - entries.length;
  if (skippedShape > 0) {
    console.warn(`[seed-marker-support] skipped ${skippedShape} malformed entr${skippedShape === 1 ? 'y' : 'ies'}.`);
  }

  console.log(
    `[seed-marker-support] ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} loaded${
      flags.dryRun ? ' (DRY RUN — no writes)' : ''
    }`,
  );

  let matched = 0;
  let updated = 0;
  let unmatched = 0;
  let leftNull = 0;

  for (const entry of entries) {
    // Match by (jurisdiction, plankNumber) → plank, then (plankId, slug) → marker.
    const plank = await prisma.plank.findFirst({
      where: { jurisdiction: entry.jurisdiction, number: entry.plankNumber },
      select: { id: true },
    });
    if (!plank) {
      console.warn(
        `[seed-marker-support] no plank for ${entry.jurisdiction} plank #${entry.plankNumber} — skipping ${entry.markerSlug}`,
      );
      unmatched += 1;
      continue;
    }

    const marker = await prisma.marker.findUnique({
      where: { plankId_slug: { plankId: plank.id, slug: entry.markerSlug } },
      select: { id: true, name: true, popularSupport: true },
    });
    if (!marker) {
      console.warn(
        `[seed-marker-support] no marker "${entry.markerSlug}" on ${entry.jurisdiction} plank #${entry.plankNumber} — skipping`,
      );
      unmatched += 1;
      continue;
    }

    matched += 1;

    if (entry.supportPct === null) {
      // Explicit null — leave the marker unassessed (still counts toward scoring).
      leftNull += 1;
      console.log(`[seed-marker-support]   ${marker.name}: supportPct=null → left unassessed`);
      continue;
    }

    const poll = entry.poll ?? null;
    console.log(`[seed-marker-support]   ${marker.name}: ${marker.popularSupport ?? 'null'} → ${entry.supportPct}%`);

    if (!flags.dryRun) {
      await prisma.marker.update({
        where: { id: marker.id },
        data: { popularSupport: entry.supportPct, popularSupportPoll: poll },
      });
    }
    updated += 1;
  }

  console.log(
    `[seed-marker-support] done — ${matched} matched, ${updated} ${
      flags.dryRun ? 'would update' : 'updated'
    }, ${leftNull} left null, ${unmatched} unmatched.`,
  );
}

main()
  .catch((err) => {
    console.error('[seed-marker-support] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
