import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { enforceRateLimit } from '@/lib/api-utils';
import { lookupStateByZip } from '@/lib/location/zipLookup';

// GET /api/me/zip-lookup?zip=12345
export async function GET(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request, { limit: 30, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const zip = searchParams.get('zip') || '';

  const result = await lookupStateByZip(zip);
  if (!result) {
    return NextResponse.json({ error: 'Zip not found' }, { status: 404 });
  }

  return NextResponse.json(result);
}
