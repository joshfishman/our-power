/**
 * PATCH /api/users/:userId/notifications
 * - Allows an authenticated to mark all of thier notifications as read.
 */
import { getServerUser } from '@/lib/getServerUser';
import prisma from '@/lib/prisma/prisma';
import { NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/api-utils';
import { z } from 'zod';

export async function PATCH(request: Request, { params }: { params: { userId: string } }) {
  const rateLimitResponse = await enforceRateLimit(request, { limit: 30, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const parsedUserId = z.string().cuid().safeParse(params.userId);
  if (!parsedUserId.success) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
  }

  const [user] = await getServerUser();
  if (!user || user.id !== parsedUserId.data) return NextResponse.json({}, { status: 401 });

  await prisma.activity.updateMany({
    where: {
      targetUserId: user.id,
    },
    data: {
      isNotificationRead: true,
    },
  });

  return NextResponse.json({});
}
