import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma/prisma';
import { withCors, corsOptionsResponse, enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';

const cacheHeaders = {
  'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
};

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

// GET /api/causes - Get all causes
export async function GET(request: Request) {
  try {
    const rateLimitResponse = await enforceRateLimit(request);
    if (rateLimitResponse) return rateLimitResponse;

    const causes = await prisma.cause.findMany({
      orderBy: { name: 'asc' },
    });
    return withCors(NextResponse.json(causes, { headers: cacheHeaders }), request);
  } catch (error) {
    logError('Error fetching causes', error);
    return withCors(NextResponse.json({ error: 'Failed to fetch causes' }, { status: 500 }), request);
  }
}
