/**
 * DELETE /api/users/:userId/following/:targetUserId
 * - Allows an authenticated user to remove a user
 * from their following list / unfollow the :targetUserId.
 */
import { getServerUser } from '@/lib/getServerUser';
import prisma from '@/lib/prisma/prisma';
import { NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/api-utils';
import { z } from 'zod';

export async function DELETE(request: Request, { params }: { params: { userId: string; targetUserId: string } }) {
  const rateLimitResponse = await enforceRateLimit(request, { limit: 20, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const parsedUserId = z.string().min(1).safeParse(params.userId);
  const parsedTargetUserId = z.string().min(1).safeParse(params.targetUserId);
  if (!parsedUserId.success || !parsedTargetUserId.success) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
  }

  const [user] = await getServerUser();
  if (!user || user.id !== parsedUserId.data) return NextResponse.json({}, { status: 403 });

  const isFollowing = await prisma.follow.count({
    where: {
      followerId: user.id,
      followingId: parsedTargetUserId.data,
    },
  });

  if (isFollowing) {
    const res = await prisma.follow.delete({
      where: {
        followerId_followingId: {
          followerId: user.id,
          followingId: parsedTargetUserId.data,
        },
      },
    });

    // Delete the associated 'CREATE_FOLLOW' activity
    await prisma.activity.deleteMany({
      where: {
        type: 'CREATE_FOLLOW',
        sourceId: res.id,
        sourceUserId: user.id,
        targetUserId: parsedTargetUserId.data,
      },
    });

    return NextResponse.json({ unfollowed: true });
  }
  return NextResponse.json({ error: 'You are not following this user.' }, { status: 409 });
}
