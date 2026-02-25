import caLegislators from '@/data/ca-state-legislators.json';
import type { Official } from './representatives';

interface CaLegislator {
  name: string;
  party: string | null;
  chamber: 'upper' | 'lower';
  district: number;
  email: string | null;
  phone: string | null;
  photoUrl: string | null;
  contactUrl: string | null;
  websiteUrl: string | null;
}

function toOfficial(leg: CaLegislator): Official {
  const office =
    leg.chamber === 'upper'
      ? `CA State Senator, District ${leg.district}`
      : `CA Assembly Member, District ${leg.district}`;

  const urls: string[] = [];
  if (leg.contactUrl) urls.push(leg.contactUrl);
  if (leg.websiteUrl && leg.websiteUrl !== leg.contactUrl) urls.push(leg.websiteUrl);

  return {
    office,
    name: leg.name,
    party: leg.party,
    phones: leg.phone ? [leg.phone] : [],
    urls,
    emails: leg.email ? [leg.email] : [],
    photoUrl: leg.photoUrl,
  };
}

/**
 * Returns CA state legislators for the given state senate and assembly districts.
 * Synchronous — uses bundled static JSON from OpenStates bulk data.
 */
export function getCaStateLegislators(
  stateSenateDistrict: number | null,
  stateHouseDistrict: number | null,
): Official[] {
  const results: Official[] = [];

  for (const leg of caLegislators as CaLegislator[]) {
    if (leg.chamber === 'upper' && stateSenateDistrict != null && leg.district === stateSenateDistrict) {
      results.push(toOfficial(leg));
    } else if (leg.chamber === 'lower' && stateHouseDistrict != null && leg.district === stateHouseDistrict) {
      results.push(toOfficial(leg));
    }
  }

  return results;
}
