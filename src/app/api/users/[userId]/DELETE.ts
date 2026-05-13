import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/getServerUser';
import { enforceRateLimit } from '@/lib/api-utils';
import prisma from '@/lib/prisma/prisma';
import { z } from 'zod';

/**
 * DELETE /api/users/:userId
 * Allows an authenticated user to delete their own account.
 */
export async function DELETE(request: Request, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const rateLimitResponse = await enforceRateLimit(request, { limit: 5, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const parsedUserId = z.string().min(1).safeParse(params.userId);
  if (!parsedUserId.success) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
  }

  const [user] = await getServerUser();
  if (!user || user.id !== parsedUserId.data) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await prisma.user.delete({
    where: { id: user.id },
  });

  return NextResponse.json({ success: true });
}
