import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';

// POST /api/onboarding/skip - Skip onboarding
export async function POST() {
  try {
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
    console.error('Skip onboarding error:', error);
    return NextResponse.json({ error: 'Failed to skip onboarding' }, { status: 500 });
  }
}
