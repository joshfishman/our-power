/**
 * PATCH /api/users/:userId/notifications/:notificationId
 * - Allows an authenticated to mark one of their notification,
 * specified by the `notificationId`, as read.
 */
import { getServerUser } from '@/lib/getServerUser';
import prisma from '@/lib/prisma/prisma';
import { NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/api-utils';
import { z } from 'zod';

async function verifyAccessToNotification(notificationId: number) {
  const [user] = await getServerUser();
  const count = await prisma.activity.count({
    where: {
      id: notificationId,
      targetUserId: user?.id,
    },
  });

  return count > 0;
}

export async function PATCH(request: Request, { params }: { params: { userId: string; notificationId: string } }) {
  const rateLimitResponse = await enforceRateLimit(request, { limit: 60, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const parsedUserId = z.string().cuid().safeParse(params.userId);
  const parsedNotificationId = z.coerce.number().int().positive().safeParse(params.notificationId);
  if (!parsedUserId.success || !parsedNotificationId.success) {
    return NextResponse.json({ error: 'Invalid user or notification id' }, { status: 400 });
  }

  const [user] = await getServerUser();
  if (!user || user.id !== parsedUserId.data) return NextResponse.json({}, { status: 403 });

  const notificationId = parsedNotificationId.data;
  if (!(await verifyAccessToNotification(notificationId))) return NextResponse.json({}, { status: 403 });

  await prisma.activity.update({
    where: {
      id: notificationId,
    },
    data: {
      isNotificationRead: true,
    },
  });

  return NextResponse.json({});
}
