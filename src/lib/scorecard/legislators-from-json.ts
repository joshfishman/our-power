// Backfill Legislator rows from the existing static JSON files.
//
// Federal source: src/data/congress-legislators-current.json (United States
// project — already used by src/lib/integrations/congressLegislators.ts).
// Provides bioguide, opensecrets, FEC, and govtrack IDs for every sitting
// member of Congress.
//
// CA source: src/data/ca-state-legislators.json (already used by
// src/lib/integrations/caStateLegislators.ts). Has name/party/chamber/
// district/contact info but NO OpenStates IDs — those must be backfilled
// separately via the OpenStates API after Phase 1.

import federalJson from '@/data/congress-legislators-current.json';
import caJson from '@/data/ca-state-legislators.json';

export type SeedChamber = 'SEN' | 'REP';
export type SeedParty = 'D' | 'R' | 'I';
export type SeedJurisdiction = 'FEDERAL' | 'CA';

export interface SeedLegislator {
  jurisdiction: SeedJurisdiction;
  bioguideId: string | null;
  openStatesId: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  chamber: SeedChamber;
  state: string;
  district: number | null;
  party: SeedParty;
  opensecretsId: string | null;
  fecIds: string[];
  govtrackId: number | null;
  photoUrl: string | null;
  isActive: boolean;
}

interface FederalRawTerm {
  type: 'sen' | 'rep';
  state: string;
  district?: number;
  party?: string;
  start: string;
  end: string;
}

interface FederalRawLegislator {
  id?: {
    bioguide?: string;
    opensecrets?: string;
    fec?: string[];
    govtrack?: number;
  };
  name: { first: string; last: string; official_full?: string };
  terms: FederalRawTerm[];
}

interface CaRawLegislator {
  openStatesId?: string | null;
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

function mapParty(raw: string | null | undefined): SeedParty {
  if (!raw) return 'I';
  const norm = raw.toLowerCase();
  if (norm.startsWith('democrat')) return 'D';
  if (norm.startsWith('republican')) return 'R';
  return 'I';
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/**
 * Returns one SeedLegislator per currently sitting member of Congress,
 * derived from the bundled congress-legislators-current.json.
 */
export function seedLegislatorsFromFederalJson(): SeedLegislator[] {
  const out: SeedLegislator[] = [];
  for (const raw of federalJson as FederalRawLegislator[]) {
    const lastTerm = raw.terms[raw.terms.length - 1];
    if (!lastTerm) continue;
    if (lastTerm.type !== 'sen' && lastTerm.type !== 'rep') continue;

    const fullName = raw.name.official_full ?? `${raw.name.first} ${raw.name.last}`;
    out.push({
      jurisdiction: 'FEDERAL',
      bioguideId: raw.id?.bioguide ?? null,
      openStatesId: null,
      firstName: raw.name.first,
      lastName: raw.name.last,
      fullName,
      chamber: lastTerm.type === 'sen' ? 'SEN' : 'REP',
      state: lastTerm.state,
      district: lastTerm.type === 'sen' ? null : lastTerm.district ?? 0,
      party: mapParty(lastTerm.party),
      opensecretsId: raw.id?.opensecrets ?? null,
      fecIds: raw.id?.fec ?? [],
      govtrackId: raw.id?.govtrack ?? null,
      photoUrl: raw.id?.bioguide
        ? `https://raw.githubusercontent.com/unitedstates/images/gh-pages/congress/225x275/${raw.id.bioguide}.jpg`
        : null,
      isActive: true,
    });
  }
  return out;
}

/**
 * Returns one SeedLegislator per currently seated CA state legislator,
 * derived from the bundled ca-state-legislators.json.
 *
 * NOTE: openStatesId is intentionally null here. A separate one-time
 * backfill script (scripts/backfill-ca-openstates-ids.ts) populates these
 * via the OpenStates v3 /people endpoint, which requires OPENSTATES_API_KEY.
 */
export function seedLegislatorsFromCaJson(): SeedLegislator[] {
  const out: SeedLegislator[] = [];
  for (const raw of caJson as CaRawLegislator[]) {
    const { first, last } = splitName(raw.name);
    out.push({
      jurisdiction: 'CA',
      bioguideId: null,
      openStatesId: raw.openStatesId ?? null,
      firstName: first,
      lastName: last,
      fullName: raw.name,
      chamber: raw.chamber === 'upper' ? 'SEN' : 'REP',
      state: 'CA',
      district: raw.district,
      party: mapParty(raw.party),
      opensecretsId: null,
      fecIds: [],
      govtrackId: null,
      photoUrl: raw.photoUrl,
      isActive: true,
    });
  }
  return out;
}
