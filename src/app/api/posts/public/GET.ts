/**
 * GET /api/posts/public
 *
 * The signed-out feed: the most recent posts on the platform, readable without
 * an account so a visitor can look around before deciding to join.
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
import { GetPost } from '@/types/definitions';

export async function GET(request: Request) {
  const { filters, limitAndOrderBy } = postsSorterFromUrl(request.url);

  const res = await prisma.post.findMany({
    where: { ...filters },
    ...limitAndOrderBy,
    // undefined => the reader is anonymous and has liked nothing.
    select: selectPost(undefined),
  });

  return NextResponse.json<GetPost[]>(await toGetPosts(res));
}
