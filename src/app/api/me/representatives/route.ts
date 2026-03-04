import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { z } from 'zod';

const representativeSchema = z.object({
  office: z.string(),
  name: z.string(),
  party: z.string().nullable(),
  phones: z.array(z.string()),
  urls: z.array(z.string()),
  emails: z.array(z.string()),
  photoUrl: z.string().nullable().optional(),
});

const saveRepsSchema = z.object({
  representatives: z.array(representativeSchema).max(100),
  address: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 20, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = saveRepsSchema.parse(body);

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        cachedRepresentatives: validated.representatives,
        repsLookedUpAt: new Date(),
        repsLookupAddress: validated.address,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logError('Error saving cached representatives', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to save representatives' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 30, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        cachedRepresentatives: true,
        repsLookedUpAt: true,
        repsLookupAddress: true,
      },
    });

    return NextResponse.json({
      representatives: user?.cachedRepresentatives ?? null,
      lookedUpAt: user?.repsLookedUpAt ?? null,
      address: user?.repsLookupAddress ?? null,
    });
  } catch (error) {
    logError('Error fetching cached representatives', error);
    return NextResponse.json({ error: 'Failed to fetch representatives' }, { status: 500 });
  }
}
