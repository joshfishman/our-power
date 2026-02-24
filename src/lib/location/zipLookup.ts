import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

const ZIP_LOOKUP_URL = 'https://api.zippopotam.us/us';

export interface ZipLookupResult {
  zip: string;
  state: string;
  city: string;
}

export async function lookupStateByZip(rawZip: string): Promise<ZipLookupResult | null> {
  const zip = rawZip.trim().slice(0, 5);
  if (!/^\d{5}$/.test(zip)) return null;

  const response = await fetchWithTimeout(`${ZIP_LOOKUP_URL}/${zip}`, {}, 8_000);
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    'post code'?: string;
    places?: Array<{
      'place name'?: string;
      state?: string;
      'state abbreviation'?: string;
    }>;
  };

  const stateAbbr = payload.places?.[0]?.['state abbreviation']?.toUpperCase();
  const city = payload.places?.[0]?.['place name']?.trim();
  if (!stateAbbr || !/^[A-Z]{2}$/.test(stateAbbr)) {
    return null;
  }
  if (!city) {
    return null;
  }

  return {
    zip,
    state: stateAbbr,
    city,
  };
}
