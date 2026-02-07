/**
 * POST /api/users/:userId/following
 * - Allows an authenticated user to follow another user.
 *
 * JSON body: {
 *   userIdToFollow: string
 * }
 */

import { getServerUser } from '@/lib/getServerUser';
import prisma from '@/lib/prisma/prisma';
import { followPostSchema } from '@/lib/validations/follow';
import { Prisma } from '@/generated/prisma/client';
import { NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/api-utils';
import { z } from 'zod';

export async function POST(request: Request, { params }: { params: { userId: string } }) {
  const rateLimitResponse = await enforceRateLimit(request, { limit: 30, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const parsedUserId = z.string().min(1).safeParse(params.userId);
  if (!parsedUserId.success) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
  }

  const [user] = await getServerUser();
  if (!user || user.id !== parsedUserId.data) return NextResponse.json({}, { status: 403 });

  try {
    const { userIdToFollow } = followPostSchema.parse(await request.json());
    const res = await prisma.follow.create({
      data: {
        followerId: user.id,
        followingId: userIdToFollow,
      },
    });

    // Record a 'CREATE_FOLLOW' activity
    await prisma.activity.create({
      data: {
        type: 'CREATE_FOLLOW',
        sourceId: res.id,
        sourceUserId: user.id,
        targetUserId: userIdToFollow,
      },
    });

    return NextResponse.json({ followed: true }, { status: 200 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return NextResponse.json({ error: 'You are already following this user.' }, { status: 409 });
      }
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(error.issues, { status: 422 });
    }

    return NextResponse.json(null, { status: 500 });
  }
}
