import { auth } from '@/auth';
import { apiError, enforceRateLimit, requestId } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { resolveRepresentatives } from '@/lib/integrations/representatives';

// GET /api/civic/representatives?address=...
export async function GET(request: Request) {
  const reqId = requestId();
  try {
    const rateLimitResponse = await enforceRateLimit(request, { limit: 20, windowSeconds: 60 });
    if (rateLimitResponse) return rateLimitResponse;

    const session = await auth();
    if (!session?.user?.id) {
      return apiError('Unauthorized', 401, reqId);
    }

    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    if (!address) {
      return apiError('Address is required', 400, reqId);
    }
    const normalizedInput = address
      .replace(/\s+/g, ' ')
      .replace(/\s*,\s*/g, ', ')
      .trim();
    const hasZip = /\b\d{5}(?:-\d{4})?\b/.test(normalizedInput);
    const hasStreetLike = /^[^,]+,/.test(normalizedInput);
    if (!hasZip || !hasStreetLike) {
      return apiError('Use a full address: street, city, state zip', 400, reqId);
    }

    const { officials, normalizedAddress, error: resolveError } = await resolveRepresentatives(normalizedInput);
    if (!normalizedAddress) {
      const isTimeout = resolveError?.includes('timed out') || resolveError?.includes('TimeoutError');
      if (isTimeout) {
        return apiError('The Census geocoder is slow right now. Please try again in a moment.', 503, reqId);
      }
      return apiError(
        'We could not validate this address with the Census geocoder. Please check your street, state, and zip code.',
        422,
        reqId,
      );
    }

    return Response.json({ normalizedAddress, officials }, { headers: { 'X-Request-Id': reqId } });
  } catch (error) {
    logError('Error fetching representatives', error);
    return apiError('Failed to fetch representatives', 500, reqId);
  }
}
