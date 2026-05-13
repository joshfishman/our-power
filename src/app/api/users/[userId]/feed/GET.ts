/**
 * GET /api/users/:userId/feed
 * - Allows an authenticated user to retrieve the most recent posts
 * posted by the user and their followed users.
 */

import { postsSorterFromUrl } from '@/lib/postsSorterFromUrl';
import { getServerUser } from '@/lib/getServerUser';
import prisma from '@/lib/prisma/prisma';
import { selectPost } from '@/lib/prisma/selectPost';
import { toGetPosts } from '@/lib/prisma/toGetPost';
import { NextResponse } from 'next/server';
import { GetPost } from '@/types/definitions';

export async function GET(request: Request, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const { filters, limitAndOrderBy } = postsSorterFromUrl(request.url);

  const [user] = await getServerUser();
  if (!user || params.userId !== user.id) return NextResponse.json({}, { status: 401 });

  // Single-query feed: posts authored by the user OR by anyone they follow.
  // Previously this was two sequential queries (one for follows, one for
  // posts), which doubled connection-setup latency on empty feeds. The
  // nested relation filter pushes the join to Postgres and returns in one
  // round trip.
  const res = await prisma.post.findMany({
    where: {
      OR: [{ userId: user.id }, { user: { followers: { some: { followerId: user.id } } } }],
      ...filters,
    },
    ...limitAndOrderBy,
    select: selectPost(user.id),
  });

  const posts = await toGetPosts(res);

  return NextResponse.json<GetPost[]>(posts);
}
