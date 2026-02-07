/**
 * GET /api/posts/:postId
 * - Returns the data of a specific post.
 */

import { getServerUser } from '@/lib/getServerUser';
import prisma from '@/lib/prisma/prisma';
import { selectPost } from '@/lib/prisma/selectPost';
import { toGetPost } from '@/lib/prisma/toGetPost';
import { enforceRateLimit } from '@/lib/api-utils';
import { NextResponse } from 'next/server';
import { GetPost } from '@/types/definitions';
import { z } from 'zod';

export async function GET(request: Request, { params }: { params: { postId: string } }) {
  /**
   * The [user] will only be used to check whether the
   * user requesting the Post has like it or not.
   */
  const rateLimitResponse = await enforceRateLimit(request, { limit: 120, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const postId = z.coerce.number().int().positive().safeParse(params.postId);
  if (!postId.success) {
    return NextResponse.json({ error: 'Invalid post id' }, { status: 400 });
  }
  const [user] = await getServerUser();
  const res = await prisma.post.findUnique({
    where: {
      id: postId.data,
    },
    select: selectPost(user?.id),
  });

  if (res === null) return NextResponse.json(null);
  return NextResponse.json<GetPost>(await toGetPost(res));
}
