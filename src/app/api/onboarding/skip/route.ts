import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';

// POST /api/onboarding/skip - Skip onboarding
export async function POST(request: Request) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 10, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Mark onboarding as complete without setting location/causes
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        onboardingComplete: true,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logError('Skip onboarding error', error);
    return NextResponse.json({ error: 'Failed to skip onboarding' }, { status: 500 });
  }
}
