import { apiError, corsOptionsResponse, enforceRateLimit, requestId, withCors } from '@/lib/api-utils';
import { logError } from '@/lib/logger';
import { findLegislatorByAnyId, computePublishedTotal, VOTING_RECORD_PUBLISHED } from '@/lib/scorecard/queries';
import { METHODOLOGY_VERSION } from '@/lib/scorecard/scoring';

// GET /api/scorecard/legislators/:id
//
// Public, read-only single-legislator scorecard endpoint. Accepts
// bioguideId, openStatesId, or internal cuid in the :id slot. Returns
// the legislator's profile, published per-plank scores, and verified
// marker achievements with evidence URLs.
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const reqId = requestId();
  try {
    const rateLimited = await enforceRateLimit(request, { limit: 60, windowSeconds: 60 });
    if (rateLimited) return rateLimited;

    const id = decodeURIComponent(params.id);
    const legislator = await findLegislatorByAnyId(id);
    if (!legislator) {
      return apiError('Legislator not found', 404, reqId);
    }

    const total = computePublishedTotal(legislator.scores);
    const maxScore = legislator.jurisdiction === 'FEDERAL' ? 25 : 20;

    return withCors(
      Response.json(
        {
          legislator: {
            id: legislator.id,
            jurisdiction: legislator.jurisdiction,
            bioguideId: legislator.bioguideId,
            openStatesId: legislator.openStatesId,
            fullName: legislator.fullName,
            chamber: legislator.chamber,
            state: legislator.state,
            district: legislator.district,
            party: legislator.party,
            photoUrl: legislator.photoUrl,
          },
          total,
          maxScore,
          // The Voting Record (per-plank alignment + the `total` mean) rests on
          // auto-classified bills whose aligned direction is not yet
          // human-verified, so it is temporarily not published on the public
          // site. The API still returns the data for transparency, but flags it
          // so consumers don't treat the voting numbers as final. Flip
          // VOTING_RECORD_PUBLISHED in queries.ts to restore published status.
          votingPublished: VOTING_RECORD_PUBLISHED,
          votingStatus: VOTING_RECORD_PUBLISHED ? 'published' : 'under-revision',
          scores: legislator.scores.map((s) => ({
            plankId: s.plankId,
            plankNumber: s.plank.number,
            plankName: s.plank.name,
            score: s.score,
            methodologyVersion: s.methodologyVersion,
            publishedAt: s.publishedAt,
          })),
          achievements: legislator.achievements.map((a) => ({
            markerId: a.markerId,
            markerName: a.marker.name,
            markerType: a.marker.markerType,
            isRepublicanAlternative: a.marker.isRepublicanAlternative,
            plankNumber: a.marker.plank.number,
            achieved: a.achieved,
            evidenceType: a.evidenceType,
            evidenceSourceUrl: a.evidenceSourceUrl,
          })),
          pacData: legislator.pacData.map((p) => ({
            cycleYear: p.cycleYear,
            corporatePacAmount: p.corporatePacAmount.toString(),
            totalReceipts: p.totalReceipts.toString(),
            corporatePacPercentage: p.corporatePacPercentage.toString(),
            dataSource: p.dataSource,
            dataSourceUrl: p.dataSourceUrl,
          })),
          methodologyVersion: METHODOLOGY_VERSION,
        },
        { headers: { 'X-Request-Id': reqId, 'Cache-Control': 'public, max-age=300' } },
      ),
      request,
    );
  } catch (error) {
    logError('Error fetching legislator scorecard', error);
    return apiError('Failed to fetch legislator scorecard', 500, reqId);
  }
}

export function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}
