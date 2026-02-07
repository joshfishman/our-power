/**
 * DELETE /api/users/:userId:/liked-posts/:postId
 * - Allows an authenticated user to delete a post
 * from their liked posts.
 */

import { getServerUser } from '@/lib/getServerUser';
import prisma from '@/lib/prisma/prisma';
import { NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/api-utils';
import { z } from 'zod';

export async function DELETE(request: Request, { params }: { params: { userId: string; postId: string } }) {
  const rateLimitResponse = await enforceRateLimit(request, { limit: 40, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const parsedUserId = z.string().cuid().safeParse(params.userId);
  const parsedPostId = z.coerce.number().int().positive().safeParse(params.postId);
  if (!parsedUserId.success || !parsedPostId.success) {
    return NextResponse.json({ error: 'Invalid user or post id' }, { status: 400 });
  }

  const [user] = await getServerUser();
  if (!user || parsedUserId.data !== user.id) return NextResponse.json({}, { status: 401 });

  const postId = parsedPostId.data;

  const isLiked = await prisma.postLike.count({
    where: {
      userId: user.id,
      postId,
    },
  });

  if (!isLiked) {
    // If the post is NOT liked, return 409 Conflict
    return NextResponse.json({}, { status: 409 });
  }

  const res = await prisma.postLike.delete({
    where: {
      userId_postId: {
        userId: user.id,
        postId,
      },
    },
  });

  // Delete the associated 'POST_LIKE' activity
  await prisma.activity.deleteMany({
    where: {
      type: 'POST_LIKE',
      sourceUserId: user.id,
      sourceId: res.id,
      targetId: postId,
    },
  });

  return NextResponse.json({});
}
