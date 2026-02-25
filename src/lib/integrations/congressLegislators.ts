import legislators from '@/data/congress-legislators-current.json';
import type { Official } from './representatives';

interface Term {
  type: 'sen' | 'rep';
  state: string;
  district?: number;
  party?: string;
  url?: string;
  contact_form?: string;
  phone?: string;
  office?: string;
  start: string;
  end: string;
}

interface Legislator {
  id?: { bioguide?: string };
  name: { official_full?: string; first: string; last: string };
  terms: Term[];
}

function toOfficial(legislator: Legislator, lastTerm: Term): Official {
  const urls: string[] = [];
  if (lastTerm.contact_form) urls.push(lastTerm.contact_form);
  if (lastTerm.url) urls.push(lastTerm.url);

  const office =
    lastTerm.type === 'sen'
      ? `U.S. Senator (${lastTerm.state})`
      : `U.S. Representative, District ${lastTerm.district ?? 'At Large'} (${lastTerm.state})`;

  return {
    office,
    name: legislator.name.official_full ?? `${legislator.name.first} ${legislator.name.last}`,
    party: lastTerm.party ?? null,
    phones: lastTerm.phone ? [lastTerm.phone] : [],
    urls,
    emails: [], // Congress members use contact forms, not direct email
    photoUrl: legislator.id?.bioguide
      ? `https://raw.githubusercontent.com/unitedstates/images/gh-pages/congress/225x275/${legislator.id.bioguide}.jpg`
      : null,
  };
}

/**
 * Returns current federal legislators for the given state and congressional district.
 * Synchronous — uses the bundled static JSON.
 */
export function getFederalLegislators(stateAbbr: string, congressionalDistrict: number): Official[] {
  const results: Official[] = [];

  for (const legislator of legislators as Legislator[]) {
    const lastTerm = legislator.terms[legislator.terms.length - 1];
    if (!lastTerm || lastTerm.state !== stateAbbr) continue;

    if (lastTerm.type === 'sen') {
      results.push(toOfficial(legislator, lastTerm));
    } else if (lastTerm.type === 'rep') {
      const dist = lastTerm.district ?? 0;
      // 0 = at-large; match if districts match or either side is at-large
      if (dist === congressionalDistrict || dist === 0 || congressionalDistrict === 0) {
        results.push(toOfficial(legislator, lastTerm));
      }
    }
  }

  return results;
}
