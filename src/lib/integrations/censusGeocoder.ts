import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

const CENSUS_GEOCODER_URL = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';

export interface GeoResult {
  lat: number;
  lng: number;
  /** Two-letter state abbreviation e.g. "OR" */
  stateAbbr: string;
  /** Congressional district number, or 0 for at-large districts */
  congressionalDistrict: number;
  /** State senate (upper chamber) district number, or null if unavailable */
  stateSenateDistrict: number | null;
  /** State house/assembly (lower chamber) district number, or null if unavailable */
  stateHouseDistrict: number | null;
  normalizedAddress: string;
}

/**
 * Geocodes a US address using the Census Geocoder and returns
 * lat/lng, state abbreviation, and congressional district.
 * Throws if the address cannot be matched.
 */
export async function geocodeAddress(address: string): Promise<GeoResult> {
  const params = new URLSearchParams({
    address,
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    format: 'json',
  });

  const url = `${CENSUS_GEOCODER_URL}?${params}`;

  let response: Response | undefined;
  try {
    response = await fetchWithTimeout(url, {}, 15_000);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      response = await fetchWithTimeout(url, {}, 15_000);
    } else {
      throw err;
    }
  }
  if (!response) {
    throw new Error('Census Geocoder timed out after retries');
  }
  if (!response.ok) {
    throw new Error(`Census Geocoder error: ${response.status}`);
  }

  const data = await response.json();
  const matches: unknown[] = data?.result?.addressMatches ?? [];
  if (!matches.length) {
    throw new Error('Address not found');
  }

  const match = matches[0] as {
    matchedAddress: string;
    coordinates: { x: number; y: number };
    geographies: Record<string, Array<{ STUSAB?: string; BASENAME?: string }>>;
  };

  const stateAbbr = match.geographies?.States?.[0]?.STUSAB;
  if (!stateAbbr) {
    throw new Error('Could not determine state from address');
  }

  const geoKeys = Object.keys(match.geographies ?? {});

  const cdKey = geoKeys.find((k) => k.toLowerCase().includes('congressional district'));
  const districtBasename = (cdKey ? match.geographies[cdKey]?.[0]?.BASENAME : undefined) ?? '0';
  const congressionalDistrict = districtBasename === 'At Large' ? 0 : parseInt(districtBasename, 10) || 0;

  const upperKey = geoKeys.find((k) => /legislative.*upper/i.test(k));
  const lowerKey = geoKeys.find((k) => /legislative.*lower/i.test(k));
  const parseDistrict = (key: string | undefined) => {
    if (!key) return null;
    const val = match.geographies[key]?.[0]?.BASENAME;
    if (!val) return null;
    const num = parseInt(val, 10);
    return Number.isNaN(num) ? null : num;
  };

  return {
    lat: match.coordinates.y,
    lng: match.coordinates.x,
    stateAbbr,
    congressionalDistrict,
    stateSenateDistrict: parseDistrict(upperKey),
    stateHouseDistrict: parseDistrict(lowerKey),
    normalizedAddress: match.matchedAddress,
  };
}
