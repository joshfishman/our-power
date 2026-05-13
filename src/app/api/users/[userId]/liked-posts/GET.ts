/**
 * GET /api/users/:userId/liked-posts
 * - Returns the liked posts of the specified user.
 */
import prisma from '@/lib/prisma/prisma';
import { NextResponse } from 'next/server';

export async function GET(request: Request, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
  const res = await prisma.postLike.findMany({
    where: {
      userId: params.userId,
    },
  });

  return NextResponse.json(res);
}
