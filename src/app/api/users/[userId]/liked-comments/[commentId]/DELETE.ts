/**
 * DELETE /api/users/:userId/liked-comments/:commentId
 * - Allows an authenticated user to delete a comment
 * from their liked comments.
 */

import { getServerUser } from '@/lib/getServerUser';
import prisma from '@/lib/prisma/prisma';
import { NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/api-utils';
import { z } from 'zod';

export async function DELETE(request: Request, { params }: { params: { userId: string; commentId: string } }) {
  const rateLimitResponse = await enforceRateLimit(request, { limit: 40, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const parsedUserId = z.string().min(1).safeParse(params.userId);
  const parsedCommentId = z.coerce.number().int().positive().safeParse(params.commentId);
  if (!parsedUserId.success || !parsedCommentId.success) {
    return NextResponse.json({ error: 'Invalid user or comment id' }, { status: 400 });
  }

  const [user] = await getServerUser();
  if (!user || parsedUserId.data !== user.id) return NextResponse.json({}, { status: 401 });

  const commentId = parsedCommentId.data;

  const isLiked = await prisma.commentLike.count({
    where: {
      userId: user.id,
      commentId,
    },
  });

  if (!isLiked) {
    // If the post is NOT liked, return 409 Conflict
    return NextResponse.json({}, { status: 409 });
  }

  const res = await prisma.commentLike.delete({
    where: {
      userId_commentId: {
        userId: user.id,
        commentId,
      },
    },
  });

  // Delete the associated 'COMMENT_LIKE' or 'REPLY_LIKE' activity
  const comment = await prisma.comment.findUnique({
    where: {
      id: commentId,
    },
    select: {
      parentId: true,
      userId: true,
    },
  });
  const type = comment?.parentId ? 'REPLY_LIKE' : 'COMMENT_LIKE';
  await prisma.activity.deleteMany({
    where: {
      type,
      sourceUserId: user.id,
      sourceId: res.id,
      targetId: commentId,
    },
  });

  return NextResponse.json({});
}
