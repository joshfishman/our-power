/**
 * GET /api/posts/:postId/comments
 * - Returns the comments of a post specified by the postId provided.
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma/prisma';
import { FindCommentResult, GetComment } from '@/types/definitions';
import { getServerUser } from '@/lib/getServerUser';
import { includeToComment } from '@/lib/prisma/includeToComment';
import { toGetComment } from '@/lib/prisma/toGetComment';
import { enforceRateLimit } from '@/lib/api-utils';
import { z } from 'zod';

export async function GET(request: Request, { params }: { params: { postId: string } }) {
  /**
   * The `userId` will only be used to check whether the user
   * requesting the comments has liked them or not.
   */
  const rateLimitResponse = await enforceRateLimit(request, { limit: 120, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const postId = z.coerce.number().int().positive().safeParse(params.postId);
  if (!postId.success) {
    return NextResponse.json({ error: 'Invalid post id' }, { status: 400 });
  }

  const [user] = await getServerUser();
  const userId = user?.id;

  const res: FindCommentResult[] = await prisma.comment.findMany({
    where: {
      postId: postId.data,
      parentId: null,
    },
    include: includeToComment(userId),
    orderBy: {
      id: 'asc',
    },
  });

  const commentsPromises = res.map(toGetComment);
  const comments = await Promise.all(commentsPromises);

  return NextResponse.json<GetComment[]>(comments);
}
