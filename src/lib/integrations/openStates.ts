import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { logError } from '@/lib/logger';
import type { Official } from './representatives';

const OPENSTATES_BASE = 'https://v3.openstates.org';

interface OpenStatesContactDetail {
  type: string;
  value: string;
  note?: string;
}

interface OpenStatesPerson {
  name: string;
  party: string;
  current_role: {
    title: string;
    org_classification: string;
    district: string | number;
  } | null;
  contact_details: OpenStatesContactDetail[];
  links: Array<{ url: string }>;
  email: string | null;
  photo_url: string | null;
}

/**
 * Returns current state legislators for the given lat/lng using the OpenStates API.
 * Returns [] gracefully if the API key is missing or the request fails.
 */
export async function getStateLegislators(lat: number, lng: number): Promise<Official[]> {
  const apiKey = process.env.OPENSTATES_API_KEY;
  if (!apiKey) {
    logError('OPENSTATES_API_KEY not configured — skipping state legislator lookup', undefined, {});
    return [];
  }

  try {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    const response = await fetchWithTimeout(
      `${OPENSTATES_BASE}/people.geo?${params}`,
      { headers: { 'X-API-KEY': apiKey } },
      8_000,
    );

    if (!response.ok) {
      logError('OpenStates API error', undefined, { status: response.status });
      return [];
    }

    const data = await response.json();
    const results: OpenStatesPerson[] = data?.results ?? [];

    return results
      .filter((p) => p.current_role?.org_classification === 'legislature')
      .map((p): Official => {
        const role = p.current_role!;
        const district = role.district ? `, District ${role.district}` : '';
        const office = `State ${role.title}${district}`;

        const phones = p.contact_details
          .filter((c) => c.type === 'voice')
          .map((c) => c.value)
          .filter(Boolean);

        const emails = [
          ...p.contact_details.filter((c) => c.type === 'email').map((c) => c.value),
          ...(p.email ? [p.email] : []),
        ].filter(Boolean);

        const urls = p.links.map((l) => l.url).filter(Boolean);

        return {
          office,
          name: p.name,
          party: p.party ?? null,
          phones,
          urls,
          emails: Array.from(new Set(emails)),
          photoUrl: p.photo_url ?? null,
        };
      });
  } catch (error) {
    logError('OpenStates lookup failed', error);
    return [];
  }
}
