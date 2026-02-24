import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

const CENSUS_GEOCODER_URL = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';

export interface GeoResult {
  lat: number;
  lng: number;
  /** Two-letter state abbreviation e.g. "OR" */
  stateAbbr: string;
  /** Congressional district number, or 0 for at-large districts */
  congressionalDistrict: number;
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

  const cdKey = Object.keys(match.geographies ?? {}).find((k) => k.toLowerCase().includes('congressional district'));
  const districtBasename = (cdKey ? match.geographies[cdKey]?.[0]?.BASENAME : undefined) ?? '0';
  const congressionalDistrict = districtBasename === 'At Large' ? 0 : parseInt(districtBasename, 10) || 0;

  return {
    lat: match.coordinates.y,
    lng: match.coordinates.x,
    stateAbbr,
    congressionalDistrict,
    normalizedAddress: match.matchedAddress,
  };
}
