/**
 * POST /api/users/:userId/liked-posts
 * - Allows an authenticated user to add a post to
 * their liked posts.
 *
 * JSON body: {
 *  postId: string
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
  const postId = z.coerce
    .number()
    .int()
    .positive()
    .safeParse(body?.postId);
  if (!postId.success) {
    return NextResponse.json({ error: 'Invalid post id' }, { status: 400 });
  }

  // Check first if the post is already liked
  const isLiked = await prisma.postLike.count({
    where: {
      userId,
      postId: postId.data,
    },
  });

  if (isLiked) {
    // Post is already liked, return 409 Conflict
    return NextResponse.json({}, { status: 409 });
  }

  // Like the post
  const res = await prisma.postLike.create({
    data: {
      userId,
      postId: postId.data,
    },
  });

  // Record a 'POST_LIKE' activity
  const postOwner = await prisma.post.findUnique({
    where: {
      id: postId.data,
    },
    select: {
      userId: true,
    },
  });
  if (postOwner) {
    await prisma.activity.create({
      data: {
        type: 'POST_LIKE',
        sourceId: res.id,
        sourceUserId: userId,
        targetId: postId.data,
        targetUserId: postOwner?.userId,
      },
    });
  }

  return NextResponse.json({});
}
