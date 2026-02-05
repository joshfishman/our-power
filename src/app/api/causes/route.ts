import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma/prisma';
import { withCors, corsOptionsResponse, isRateLimited, rateLimitedResponse } from '@/lib/api-utils';

export async function OPTIONS() {
  return corsOptionsResponse();
}

// GET /api/causes - Get all causes
export async function GET(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    if (isRateLimited(ip)) return rateLimitedResponse();

    const causes = await prisma.cause.findMany({
      orderBy: { name: 'asc' },
    });
    return withCors(NextResponse.json(causes));
  } catch (error) {
    console.error('Error fetching causes:', error);
    return withCors(NextResponse.json({ error: 'Failed to fetch causes' }, { status: 500 }));
  }
}
