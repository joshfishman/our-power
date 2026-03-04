import { logError, logInfo } from '@/lib/logger';
import { geocodeAddress } from './censusGeocoder';
import { getCaStateLegislators } from './caStateLegislators';
import { getFederalLegislators } from './congressLegislators';
import { getLaCityCouncilDistrict, getLaCityOfficials } from './laCityOfficials';
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
 * Combines the Census Geocoder, congress-legislators static JSON,
 * bundled CA state legislators, and OpenStates API.
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

  const federal = getFederalLegislators(geo.stateAbbr, geo.congressionalDistrict);

  const bundledState =
    geo.stateAbbr === 'CA' ? getCaStateLegislators(geo.stateSenateDistrict, geo.stateHouseDistrict) : [];

  const openStatesState = await getStateLegislators(geo.lat, geo.lng);

  const bundledNames = new Set(bundledState.map((o) => o.name));
  const deduped = openStatesState.filter((o) => !bundledNames.has(o.name));

  let laCity: Official[] = [];
  if (geo.stateAbbr === 'CA') {
    const laDistrict = await getLaCityCouncilDistrict(geo.lat, geo.lng);
    if (laDistrict !== null) {
      laCity = getLaCityOfficials(laDistrict);
    }
  }

  const officials = [...federal, ...bundledState, ...deduped, ...laCity];

  logInfo('Representatives resolved', {
    address,
    normalizedAddress: geo.normalizedAddress,
    stateAbbr: geo.stateAbbr,
    district: geo.congressionalDistrict,
    stateSenateDistrict: geo.stateSenateDistrict,
    stateHouseDistrict: geo.stateHouseDistrict,
    federalCount: federal.length,
    bundledStateCount: bundledState.length,
    openStatesCount: deduped.length,
    laCityCount: laCity.length,
  });

  return { officials, normalizedAddress: geo.normalizedAddress };
}
