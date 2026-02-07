import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { enforceRateLimit } from '@/lib/api-utils';
import { logError } from '@/lib/logger';

const CIVIC_ENDPOINT = 'https://www.googleapis.com/civicinfo/v2/representatives';

// GET /api/civic/representatives?address=...
export async function GET(request: Request) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 20, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const civicKey = process.env.CIVIC_API_KEY;
    if (!civicKey) {
      return NextResponse.json({ error: 'Civic API key not configured' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    if (!address) {
      return NextResponse.json({ error: 'Address is required' }, { status: 400 });
    }

    const url = `${CIVIC_ENDPOINT}?key=${encodeURIComponent(civicKey)}&address=${encodeURIComponent(address)}`;
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: 'Failed to fetch representatives', details: errorText }, { status: 502 });
    }

    const data = await response.json();
    const officials =
      data.offices?.flatMap((office: { name: string; officialIndices: number[] }) =>
        office.officialIndices.map((index) => {
          const official = data.officials?.[index] || {};
          return {
            office: office.name,
            name: official.name || 'Unknown',
            party: official.party || null,
            phones: official.phones || [],
            urls: official.urls || [],
            emails: official.emails || [],
            photoUrl: official.photoUrl || null,
          };
        }),
      ) || [];

    return NextResponse.json({
      normalizedAddress: data.normalizedInput || null,
      officials,
    });
  } catch (error) {
    logError('Error fetching civic representatives', error);
    return NextResponse.json({ error: 'Failed to fetch representatives' }, { status: 500 });
  }
}
