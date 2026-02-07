import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { onboardingSchema } from '@/lib/validations/onboarding';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';

// POST /api/onboarding - Complete user onboarding
export async function POST(request: Request) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 30, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = onboardingSchema.parse(body);

    // Update user with location and causes
    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        zipCode: validatedData.zipCode,
        streetAddress: validatedData.streetAddress,
        onboardingComplete: true,
        causes: {
          connect: validatedData.causeIds.map((id) => ({ id })),
        },
      },
      include: {
        causes: true,
      },
    });

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        zipCode: updatedUser.zipCode,
        onboardingComplete: updatedUser.onboardingComplete,
        causes: updatedUser.causes,
      },
    });
  } catch (error) {
    logError('Onboarding error', error);

    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json({ error: 'Invalid data', details: error }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to complete onboarding' }, { status: 500 });
  }
}

// GET /api/onboarding - Get user's onboarding status
export async function GET(request: Request) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 60, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        zipCode: true,
        streetAddress: true,
        onboardingComplete: true,
        causes: {
          select: {
            id: true,
            name: true,
            icon: true,
            color: true,
          },
        },
      },
    });

    return NextResponse.json(user);
  } catch (error) {
    logError('Error fetching onboarding status', error);
    return NextResponse.json({ error: 'Failed to fetch onboarding status' }, { status: 500 });
  }
}
