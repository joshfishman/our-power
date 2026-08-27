/**
 * GET /api/posts/public
 *
 * The signed-out feed. It serves the published account's own follow-graph feed
 * so a visitor sees a curated Action Network rather than a bare global list,
 * falling back to every recent post if that account cannot be resolved.
 *
 * This exposes no more than a signed-in member could already see — Post has no
 * visibility field, so every post is readable by any authenticated user — but
 * it does make that content world-readable, so it deliberately returns only
 * what the post card renders and never anything account-scoped.
 *
 * A signed-in caller is served their own follow-graph feed by
 * /api/users/:userId/feed instead; this route always returns the global list.
 */
import { postsSorterFromUrl } from '@/lib/postsSorterFromUrl';
import prisma from '@/lib/prisma/prisma';
import { selectPost } from '@/lib/prisma/selectPost';
import { toGetPosts } from '@/lib/prisma/toGetPost';
import { NextResponse } from 'next/server';
import { getPublicFeedAccountId } from '@/lib/publicFeedAccount';
import { GetPost } from '@/types/definitions';

export async function GET(request: Request) {
  const { filters, limitAndOrderBy } = postsSorterFromUrl(request.url);

  // READ-ONLY: this id only narrows which posts are SELECTED for display. No
  // session is created and the caller is never treated as this account — every
  // write path still authenticates the real caller.
  const accountId = await getPublicFeedAccountId();
  const where = accountId
    ? {
        OR: [{ userId: accountId }, { user: { followers: { some: { followerId: accountId } } } }],
        ...filters,
      }
    : { ...filters };

  const res = await prisma.post.findMany({
    ...{ where },
    ...limitAndOrderBy,
    // undefined => the reader is anonymous and has liked nothing.
    select: selectPost(undefined),
  });

  return NextResponse.json<GetPost[]>(await toGetPosts(res));
}
