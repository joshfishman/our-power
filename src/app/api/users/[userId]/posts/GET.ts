/**
 * GET /api/users/:userId/posts
 * - Returns the posts composed by a single user, specified
 * by the :userId parameter.
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma/prisma';
import { selectPost } from '@/lib/prisma/selectPost';
import { GetPost } from '@/types/definitions';
import { toGetPosts } from '@/lib/prisma/toGetPost';
import { getServerUser } from '@/lib/getServerUser';
import { postsSorterFromUrl } from '@/lib/postsSorterFromUrl';

export async function GET(request: Request, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  /**
   * The [user] will only be used to check whether the
   * user requesting the Posts have like them or not.
   */
  const [user] = await getServerUser();
  const { filters, limitAndOrderBy } = postsSorterFromUrl(request.url);

  const rawPosts = await prisma.post.findMany({
    where: {
      userId: params.userId,
      ...filters,
    },
    ...limitAndOrderBy,
    select: selectPost(user?.id),
  });

  const posts: GetPost[] = await toGetPosts(rawPosts);
  return NextResponse.json<GetPost[] | null>(posts);
}
