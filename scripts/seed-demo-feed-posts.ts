/**
 * Seeds a small set of activism posts on the account whose feed is published
 * publicly, so the Action Network reads as organizing rather than as personal
 * photos.
 *
 * The artwork is authored SVG served from /public/activism — no external host,
 * no licence to audit, no next/image remote pattern needed.
 *
 * Idempotent: each post is keyed by its leading marker line, so re-running
 * updates rather than duplicates. `--dry-run` reports without writing.
 * `--remove` deletes them again.
 */
import './load-env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const url = new URL(process.env.DATABASE_URL!);
if (!url.searchParams.has('pgbouncer')) url.searchParams.set('pgbouncer', 'true');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });

const ACCOUNT_EMAIL = 'thejoshfishman@gmail.com';

const POSTS: Array<{ content: string; image: string }> = [
  {
    content:
      'Five commitments, one platform. Every plank came from ideas the public already agrees on — nothing below 55% support made the cut. Read it, then check how your representative scores. #PeoplesPlatform',
    image: '/activism/march.svg',
  },
  {
    content:
      'A primary is decided by a fraction of the electorate. That is exactly why outside money concentrates there. Showing up to vote in one is the cheapest power a citizen holds. #HonestGovernment',
    image: '/activism/ballot.svg',
  },
  {
    content:
      'We do not ask who a member of Congress votes with. We ask what they voted for, and who paid for the campaign that got them there. Same rubric, every party. #WeThePeople',
    image: '/activism/megaphone.svg',
  },
  {
    content:
      'Town halls are still the one room where a representative has to answer in public, on the record, to the people who hired them. Find yours and take a neighbor. #OurChildrenOurFuture',
    image: '/activism/assembly.svg',
  },
  {
    content:
      'Doors still move more votes than ads do. A conversation on a porch beats thirty seconds of television, and it costs nothing but an afternoon. #MakingALiving',
    image: '/activism/canvass.svg',
  },
];

/** Stable key for idempotency: the first eight words of the post. */
const keyOf = (content: string): string => content.split(/\s+/).slice(0, 8).join(' ');

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const remove = process.argv.includes('--remove');

  const account = await prisma.user.findUnique({ where: { email: ACCOUNT_EMAIL }, select: { id: true } });
  if (!account) {
    console.error(`[demo-feed] no account for ${ACCOUNT_EMAIL} — nothing to do`);
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.post.findMany({
    where: { userId: account.id },
    select: { id: true, content: true },
  });
  const byKey = new Map(existing.map((p) => [keyOf(p.content ?? ''), p.id]));

  if (remove) {
    const ids = POSTS.map((p) => byKey.get(keyOf(p.content))).filter((id): id is number => id != null);
    console.log(`[demo-feed] ${dryRun ? 'would delete' : 'deleting'} ${ids.length} demo posts`);
    if (!dryRun && ids.length) await prisma.post.deleteMany({ where: { id: { in: ids } } });
    return;
  }

  let created = 0;
  let updated = 0;
  for (const post of POSTS) {
    const id = byKey.get(keyOf(post.content));
    if (id != null) {
      console.log(`[demo-feed] ${dryRun ? 'would update' : 'update'} #${id}`);
      if (!dryRun) {
        await prisma.visualMedia.deleteMany({ where: { postId: id } });
        await prisma.post.update({
          where: { id },
          data: {
            content: post.content,
            visualMedia: { create: [{ type: 'PHOTO', fileName: post.image, userId: account.id }] },
          },
        });
      }
      updated += 1;
    } else {
      console.log(`[demo-feed] ${dryRun ? 'would create' : 'create'} "${keyOf(post.content)}…"`);
      if (!dryRun) {
        await prisma.post.create({
          data: {
            content: post.content,
            userId: account.id,
            visualMedia: { create: [{ type: 'PHOTO', fileName: post.image, userId: account.id }] },
          },
        });
      }
      created += 1;
    }
  }

  console.log(
    `\n[demo-feed] ${dryRun ? 'would create' : 'created'} ${created}, ${
      dryRun ? 'would update' : 'updated'
    } ${updated}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
