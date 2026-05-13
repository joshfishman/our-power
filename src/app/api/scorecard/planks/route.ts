import { apiError, corsOptionsResponse, enforceRateLimit, requestId, withCors } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { getPublicPlanks, parseJurisdictionParam } from '@/lib/scorecard/queries';

// GET /api/scorecard/planks?jurisdiction=FEDERAL|CA
//
// Public, read-only taxonomy endpoint. Returns planks with their markers
// and bills. Used by the embed widget, partner integrations, and the
// public methodology page.
export async function GET(request: Request) {
  const reqId = requestId();
  try {
    const rateLimited = await enforceRateLimit(request, { limit: 60, windowSeconds: 60 });
    if (rateLimited) return rateLimited;

    const { searchParams } = new URL(request.url);
    const jurisdiction = parseJurisdictionParam(searchParams.get('jurisdiction'));

    const planks = await getPublicPlanks(jurisdiction ?? undefined);

    return withCors(
      Response.json(
        { planks, methodologyVersion: 'v1.0' },
        { headers: { 'X-Request-Id': reqId, 'Cache-Control': 'public, max-age=300' } },
      ),
      request,
    );
  } catch (error) {
    logError('Error fetching scorecard planks', error);
    return apiError('Failed to fetch scorecard planks', 500, reqId);
  }
}

export function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}
