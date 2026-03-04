import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { logError, logInfo } from '@/lib/logger';
import laOfficials from '@/data/la-city-officials.json';
import type { Official } from './representatives';

const LA_CITY_GIS_URL = 'https://maps.lacity.org/lahub/rest/services/Boundaries/MapServer/13/query';

interface LaCityOfficial {
  office: string;
  name: string;
  district: number | null;
  email: string | null;
  phone: string | null;
  website: string | null;
}

function toOfficial(entry: LaCityOfficial): Official {
  return {
    office: entry.office,
    name: entry.name,
    party: null,
    phones: entry.phone ? [entry.phone] : [],
    urls: entry.website ? [entry.website] : [],
    emails: entry.email ? [entry.email] : [],
    photoUrl: null,
  };
}

/**
 * Queries the LA City ArcGIS service to determine which City Council
 * district a lat/lng falls within. Returns null if the point is outside
 * LA city limits.
 */
export async function getLaCityCouncilDistrict(lat: number, lng: number): Promise<number | null> {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'District',
    f: 'json',
  });

  try {
    const response = await fetchWithTimeout(`${LA_CITY_GIS_URL}?${params}`, {}, 10_000);
    if (!response.ok) {
      logError('LA City GIS API error', null, { status: response.status });
      return null;
    }

    const data = (await response.json()) as {
      features?: Array<{ attributes?: { District?: number } }>;
    };

    const district = data.features?.[0]?.attributes?.District;
    if (typeof district === 'number' && district >= 1 && district <= 15) {
      logInfo('LA City council district resolved', { lat, lng, district });
      return district;
    }

    return null;
  } catch (error) {
    logError('LA City GIS lookup failed', error, { lat, lng });
    return null;
  }
}

/**
 * Returns LA city officials for a given council district.
 * Always includes citywide officials (Mayor, Controller, City Attorney).
 * If district is provided, also includes the matching council member.
 */
export function getLaCityOfficials(district: number | null): Official[] {
  const entries = laOfficials as LaCityOfficial[];
  const citywide = entries.filter((e) => e.district === null).map(toOfficial);

  if (district === null) return citywide;

  const councilMember = entries.find((e) => e.district === district);
  if (!councilMember) return citywide;

  return [toOfficial(councilMember), ...citywide];
}
