/**
 * GET /api/posts/hashtag/:hashtag
 * - Returns the posts that contains the specified `hashtag`.
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma/prisma';
import { selectPost } from '@/lib/prisma/selectPost';
import { GetPost } from '@/types/definitions';
import { toGetPosts } from '@/lib/prisma/toGetPost';
import { getServerUser } from '@/lib/getServerUser';
import { postsSorterFromUrl } from '@/lib/postsSorterFromUrl';

export async function GET(request: Request, props: { params: Promise<{ hashtag: string }> }) {
  const params = await props.params;
  /**
   * The [user] will only be used to check whether the
   * user requesting the Posts have like them or not.
   */
  const [user] = await getServerUser();
  const { filters, limitAndOrderBy } = postsSorterFromUrl(request.url);

  const res = await prisma.post.findMany({
    where: {
      content: {
        search: params.hashtag,
      },
      ...filters,
    },
    ...limitAndOrderBy,
    select: selectPost(user?.id),
  });

  const posts = await toGetPosts(res);

  return NextResponse.json<GetPost[] | null>(posts);
}
