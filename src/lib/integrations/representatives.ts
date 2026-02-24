import { logError, logInfo } from '@/lib/logger';
import { geocodeAddress } from './censusGeocoder';
import { getFederalLegislators } from './congressLegislators';
import { getStateLegislators } from './openStates';

export interface Official {
  office: string;
  name: string;
  party: string | null;
  phones: string[];
  urls: string[];
  emails: string[];
  photoUrl: string | null;
}

/**
 * Resolves all federal + state elected officials for a given US address.
 * Combines the Census Geocoder, congress-legislators static JSON, and OpenStates API.
 * Returns an empty array (not throws) if the address cannot be geocoded.
 */
export async function resolveRepresentatives(
  address: string,
): Promise<{ officials: Official[]; normalizedAddress: string | null; error?: string }> {
  let geo;
  try {
    geo = await geocodeAddress(address);
  } catch (error) {
    logError('Census geocoder failed', error, { address });
    return { officials: [], normalizedAddress: null, error: error instanceof Error ? error.message : String(error) };
  }

  const [federal, state] = await Promise.all([
    Promise.resolve(getFederalLegislators(geo.stateAbbr, geo.congressionalDistrict)),
    getStateLegislators(geo.lat, geo.lng),
  ]);

  const officials = [...federal, ...state];

  logInfo('Representatives resolved', {
    address,
    normalizedAddress: geo.normalizedAddress,
    stateAbbr: geo.stateAbbr,
    district: geo.congressionalDistrict,
    federalCount: federal.length,
    stateCount: state.length,
  });

  return { officials, normalizedAddress: geo.normalizedAddress };
}
