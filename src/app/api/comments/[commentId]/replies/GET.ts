/**
 * GET /api/comments/:commentId/replies
 * - Returns the replies of a comment specified by the
 * :commentId parameter.
 */
import { getServerUser } from '@/lib/getServerUser';
import { includeToComment } from '@/lib/prisma/includeToComment';
import prisma from '@/lib/prisma/prisma';
import { toGetComment } from '@/lib/prisma/toGetComment';
import { NextResponse } from 'next/server';
import { FindCommentResult } from '@/types/definitions';
import { enforceRateLimit } from '@/lib/api-utils';
import { z } from 'zod';

export async function GET(request: Request, props: { params: Promise<{ commentId: string }> }) {
  const params = await props.params;
  /**
   * The `userId` will only be used to check whether the user
   * requesting the comments has liked them or not.
   */
  const rateLimitResponse = await enforceRateLimit(request, { limit: 120, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const commentId = z.coerce.number().int().positive().safeParse(params.commentId);
  if (!commentId.success) {
    return NextResponse.json({ error: 'Invalid comment id' }, { status: 400 });
  }

  const [user] = await getServerUser();
  const userId = user?.id;

  const res: FindCommentResult[] = await prisma.comment.findMany({
    where: {
      parentId: commentId.data,
    },
    include: includeToComment(userId),
    orderBy: {
      id: 'asc',
    },
  });

  const repliesPromises = res.map(toGetComment);
  const replies = await Promise.all(repliesPromises);

  return NextResponse.json(replies);
}
