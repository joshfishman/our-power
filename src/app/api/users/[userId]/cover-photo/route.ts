import { useUpdateProfileAndCoverPhoto } from '@/hooks/useUpdateProfileAndCoverPhoto';
import { enforceRateLimit } from '@/lib/api-utils';
import { NextResponse } from 'next/server';
import { z } from 'zod';

// Allow uploads up to 10MB
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request, { params }: { params: { userId: string } }) {
  const rateLimitResponse = await enforceRateLimit(request, { limit: 10, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const parsedUserId = z.string().min(1).safeParse(params.userId);
  if (!parsedUserId.success) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks -- not a React hook, it's a server utility
  return useUpdateProfileAndCoverPhoto({
    request,
    toUpdate: 'coverPhoto',
    userIdParam: parsedUserId.data,
  });
}
