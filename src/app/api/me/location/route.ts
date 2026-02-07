import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { locationSchema } from '@/lib/validations/onboarding';

// POST /api/me/location - Update user's location (zip + street address)
export async function POST(request: Request) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 20, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = locationSchema.parse(body);

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        zipCode: validated.zipCode,
        streetAddress: validated.streetAddress || null,
      },
      select: { id: true, zipCode: true, streetAddress: true },
    });

    return NextResponse.json({ success: true, user });
  } catch (error) {
    logError('Error updating user location', error);
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json({ error: 'Invalid data', details: error }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to update location' }, { status: 500 });
  }
}
