/**
 * POST /api/users/:userId/liked-comments
 * - Allows an authenticated user to add a comment to
 * their liked comments.
 *
 * JSON body: {
 *  commentId: string
 * }
 */

import { getServerUser } from '@/lib/getServerUser';
import prisma from '@/lib/prisma/prisma';
import { NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/api-utils';
import { z } from 'zod';

export async function POST(request: Request, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const rateLimitResponse = await enforceRateLimit(request, { limit: 40, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const parsedUserId = z.string().min(1).safeParse(params.userId);
  if (!parsedUserId.success) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
  }

  const [user] = await getServerUser();
  if (!user || parsedUserId.data !== user.id) return NextResponse.json({}, { status: 401 });
  const userId = user.id;

  const body = await request.json();
  const commentId = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(body?.commentId);
  if (!commentId.success) {
    return NextResponse.json({ error: 'Invalid comment id' }, { status: 400 });
  }

  // Check first if the comment is already liked
  const isLiked = await prisma.commentLike.count({
    where: {
      userId,
      commentId: commentId.data,
    },
  });

  // Comment is already liked, return 409 Conflict
  if (isLiked) {
    return NextResponse.json({}, { status: 409 });
  }

  // Like the comment
  const res = await prisma.commentLike.create({
    data: {
      userId,
      commentId: commentId.data,
    },
  });

  // Record a 'REPLY_LIKE' or a 'COMMENT_LIKE' activity
  const comment = await prisma.comment.findUnique({
    where: {
      id: commentId.data,
    },
    select: {
      parentId: true,
      userId: true,
    },
  });
  if (comment) {
    const type = comment?.parentId ? 'REPLY_LIKE' : 'COMMENT_LIKE';
    await prisma.activity.create({
      data: {
        type,
        sourceId: res.id,
        sourceUserId: userId,
        targetId: commentId.data,
        targetUserId: comment?.userId,
      },
    });
  }

  return NextResponse.json({});
}
