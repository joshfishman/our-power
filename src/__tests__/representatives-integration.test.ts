/**
 * Unit tests for the representatives integration layer.
 * Tests censusGeocoder, congressLegislators, openStates, and the resolveRepresentatives orchestrator.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

import { geocodeAddress } from '@/lib/integrations/censusGeocoder';
import { getFederalLegislators } from '@/lib/integrations/congressLegislators';
import { getStateLegislators } from '@/lib/integrations/openStates';
import { resolveRepresentatives } from '@/lib/integrations/representatives';

// Mocks are hoisted — define them before any module imports
vi.mock('@/lib/fetchWithTimeout', () => ({
  fetchWithTimeout: vi.fn(),
}));

vi.mock('@/data/congress-legislators-current.json', () => ({
  default: [
    // OR Senator 1
    {
      name: { official_full: 'Jane Smith', first: 'Jane', last: 'Smith' },
      terms: [
        {
          type: 'sen',
          state: 'OR',
          party: 'Democrat',
          phone: '503-555-0100',
          url: 'https://smith.senate.gov',
          contact_form: 'https://smith.senate.gov/contact',
          start: '2021-01-03',
          end: '2027-01-03',
        },
      ],
    },
    // OR Senator 2
    {
      name: { official_full: 'Bob Jones', first: 'Bob', last: 'Jones' },
      terms: [
        {
          type: 'sen',
          state: 'OR',
          party: 'Democrat',
          phone: '503-555-0200',
          start: '2019-01-03',
          end: '2025-01-03',
        },
      ],
    },
    // OR Representative District 1
    {
      name: { official_full: 'Carol Rep', first: 'Carol', last: 'Rep' },
      terms: [
        {
          type: 'rep',
          state: 'OR',
          district: 1,
          party: 'Democrat',
          phone: '503-555-0300',
          start: '2021-01-03',
          end: '2023-01-03',
        },
      ],
    },
    // OR Representative District 3 — should NOT match district 1
    {
      name: { official_full: 'Eve Reps', first: 'Eve', last: 'Reps' },
      terms: [
        {
          type: 'rep',
          state: 'OR',
          district: 3,
          party: 'Republican',
          phone: '503-555-0400',
          start: '2021-01-03',
          end: '2023-01-03',
        },
      ],
    },
    // WY At-Large Representative (district 0)
    {
      name: { official_full: 'Dan AtLarge', first: 'Dan', last: 'AtLarge' },
      terms: [
        {
          type: 'rep',
          state: 'WY',
          district: 0,
          party: 'Republican',
          phone: '307-555-0100',
          start: '2021-01-03',
          end: '2023-01-03',
        },
      ],
    },
    // WY Senator
    {
      name: { official_full: 'WY Senator', first: 'WY', last: 'Senator' },
      terms: [
        {
          type: 'sen',
          state: 'WY',
          party: 'Republican',
          phone: '307-555-0200',
          start: '2021-01-03',
          end: '2027-01-03',
        },
      ],
    },
  ],
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

const mockFetch = vi.mocked(fetchWithTimeout);

/** Creates a mock Response-like object */
function mockResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const censusMockSuccess = {
  result: {
    addressMatches: [
      {
        matchedAddress: '123 MAIN ST, PORTLAND, OR 97201',
        coordinates: { x: -122.6765, y: 45.5231 },
        geographies: {
          States: [{ STUSAB: 'OR' }],
          'Congressional Districts': [{ BASENAME: '1' }],
        },
      },
    ],
  },
};

// ─────────────────────────────────────────────
// censusGeocoder tests
// ─────────────────────────────────────────────
describe('censusGeocoder.geocodeAddress', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns GeoResult on successful geocode', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(censusMockSuccess));

    const result = await geocodeAddress('123 Main St, Portland, OR');
    expect(result.stateAbbr).toBe('OR');
    expect(result.congressionalDistrict).toBe(1);
    expect(result.lat).toBe(45.5231);
    expect(result.lng).toBe(-122.6765);
    expect(result.normalizedAddress).toBe('123 MAIN ST, PORTLAND, OR 97201');
  });

  it('throws "Address not found" when no matches returned', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ result: { addressMatches: [] } }));

    await expect(geocodeAddress('Nowhere, XX 99999')).rejects.toThrow('Address not found');
  });

  it('throws on HTTP error (non-200 Census response)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(null, false, 500));

    await expect(geocodeAddress('123 Main St')).rejects.toThrow('Census Geocoder error: 500');
  });

  it('uses 15-second timeout', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(censusMockSuccess));

    await geocodeAddress('123 Main St, Portland, OR');
    expect(mockFetch).toHaveBeenCalledWith(expect.any(String), {}, 15_000);
  });

  it('handles at-large congressional districts', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        result: {
          addressMatches: [
            {
              matchedAddress: '123 MAIN ST, CHEYENNE, WY 82001',
              coordinates: { x: -104.8202, y: 41.1399 },
              geographies: {
                States: [{ STUSAB: 'WY' }],
                'Congressional Districts': [{ BASENAME: 'At Large' }],
              },
            },
          ],
        },
      }),
    );

    const result = await geocodeAddress('123 Main St, Cheyenne, WY');
    expect(result.congressionalDistrict).toBe(0); // At Large = 0
    expect(result.stateAbbr).toBe('WY');
  });
});

// ─────────────────────────────────────────────
// congressLegislators tests (synchronous, uses mocked JSON)
// ─────────────────────────────────────────────
describe('congressLegislators.getFederalLegislators', () => {
  it('returns 2 senators for a state', () => {
    const results = getFederalLegislators('OR', 1);
    const senators = results.filter((r) => r.office.includes('Senator'));
    expect(senators).toHaveLength(2);
  });

  it('returns the representative for a specific district', () => {
    const results = getFederalLegislators('OR', 1);
    const reps = results.filter((r) => r.office.includes('Representative'));
    expect(reps).toHaveLength(1);
    expect(reps[0].name).toBe('Carol Rep');
  });

  it('does not include representatives from other districts', () => {
    const results = getFederalLegislators('OR', 1);
    const names = results.map((r) => r.name);
    expect(names).not.toContain('Eve Reps'); // District 3, not District 1
  });

  it('returns the at-large rep when district is 0', () => {
    const results = getFederalLegislators('WY', 0);
    const reps = results.filter((r) => r.office.includes('Representative'));
    expect(reps).toHaveLength(1);
    expect(reps[0].name).toBe('Dan AtLarge');
  });

  it('returns empty array for unknown state', () => {
    const results = getFederalLegislators('XX', 1);
    expect(results).toHaveLength(0);
  });

  it('shapes official object with office, name, party, phones, urls', () => {
    const results = getFederalLegislators('OR', 1);
    const senator = results.find((r) => r.name === 'Jane Smith');
    expect(senator).toBeDefined();
    expect(senator?.office).toBe('U.S. Senator (OR)');
    expect(senator?.party).toBe('Democrat');
    expect(senator?.phones).toEqual(['503-555-0100']);
    expect(senator?.emails).toEqual([]);
  });
});

// ─────────────────────────────────────────────
// openStates tests
// ─────────────────────────────────────────────
describe('openStates.getStateLegislators', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.OPENSTATES_API_KEY;
  });

  it('returns empty array when OPENSTATES_API_KEY is not set', async () => {
    const result = await getStateLegislators(45.5231, -122.6765);
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('parses officials correctly from API response', async () => {
    process.env.OPENSTATES_API_KEY = 'test-key';
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        results: [
          {
            name: 'State Rep Alice',
            party: 'Democrat',
            current_role: {
              title: 'Representative',
              org_classification: 'legislature',
              district: '42',
            },
            contact_details: [
              { type: 'voice', value: '503-555-9999' },
              { type: 'email', value: 'alice@oregonlegislature.gov' },
            ],
            links: [{ url: 'https://oregonlegislature.gov/alice' }],
            email: null,
            photo_url: 'https://example.com/alice.jpg',
          },
        ],
      }),
    );

    const results = await getStateLegislators(45.5231, -122.6765);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('State Rep Alice');
    expect(results[0].office).toBe('State Representative, District 42');
    expect(results[0].party).toBe('Democrat');
    expect(results[0].phones).toEqual(['503-555-9999']);
    expect(results[0].emails).toContain('alice@oregonlegislature.gov');
    expect(results[0].photoUrl).toBe('https://example.com/alice.jpg');
  });

  it('returns empty array on network/API failure (graceful fallback)', async () => {
    process.env.OPENSTATES_API_KEY = 'test-key';
    mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

    const result = await getStateLegislators(45.5231, -122.6765);
    expect(result).toEqual([]);
  });

  it('returns empty array when API returns non-200 status', async () => {
    process.env.OPENSTATES_API_KEY = 'test-key';
    mockFetch.mockResolvedValueOnce(mockResponse(null, false, 403));

    const result = await getStateLegislators(45.5231, -122.6765);
    expect(result).toEqual([]);
  });

  it('filters out non-legislature officials', async () => {
    process.env.OPENSTATES_API_KEY = 'test-key';
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        results: [
          {
            name: 'Executive Official',
            party: 'Republican',
            current_role: {
              title: 'Governor',
              org_classification: 'executive', // Not legislature
              district: '',
            },
            contact_details: [],
            links: [],
            email: null,
            photo_url: null,
          },
        ],
      }),
    );

    const results = await getStateLegislators(45.5231, -122.6765);
    expect(results).toHaveLength(0);
  });

  it('sends API key in request headers', async () => {
    process.env.OPENSTATES_API_KEY = 'my-secret-key';
    mockFetch.mockResolvedValueOnce(mockResponse({ results: [] }));

    await getStateLegislators(45.5231, -122.6765);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('v3.openstates.org'),
      expect.objectContaining({ headers: { 'X-API-KEY': 'my-secret-key' } }),
      expect.any(Number),
    );
  });
});

// ─────────────────────────────────────────────
// resolveRepresentatives orchestrator tests
// ─────────────────────────────────────────────
describe('resolveRepresentatives orchestrator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.OPENSTATES_API_KEY = 'test-key';
  });

  it('geocodes, fetches federal + state legislators, and merges results', async () => {
    // Census geocoder call
    mockFetch.mockResolvedValueOnce(mockResponse(censusMockSuccess));
    // OpenStates call
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        results: [
          {
            name: 'State Rep Oregon',
            party: 'Democrat',
            current_role: {
              title: 'Representative',
              org_classification: 'legislature',
              district: '15',
            },
            contact_details: [],
            links: [],
            email: 'state.rep@oregonlegislature.gov',
            photo_url: null,
          },
        ],
      }),
    );

    const { officials, normalizedAddress } = await resolveRepresentatives('123 Main St, Portland, OR');

    // From test JSON: OR district 1 → 2 senators + 1 rep = 3 federal
    // From OpenStates mock: 1 state rep
    expect(officials.length).toBeGreaterThan(0);
    expect(normalizedAddress).toBe('123 MAIN ST, PORTLAND, OR 97201');

    // Should include federal legislators
    const federalNames = officials.map((o) => o.name);
    expect(federalNames).toContain('Jane Smith'); // OR senator
    expect(federalNames).toContain('Carol Rep'); // OR dist 1 rep

    // Should include state legislators
    expect(federalNames).toContain('State Rep Oregon');
  });

  it('returns empty officials and null normalizedAddress when geocoding fails', async () => {
    // Census geocoder returns no matches
    mockFetch.mockResolvedValueOnce(mockResponse({ result: { addressMatches: [] } }));

    const { officials, normalizedAddress } = await resolveRepresentatives('zzz invalid address');
    expect(officials).toEqual([]);
    expect(normalizedAddress).toBeNull();
  });

  it('returns empty officials and null normalizedAddress when geocoder network fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('DNS failure'));

    const { officials, normalizedAddress } = await resolveRepresentatives('123 Main St');
    expect(officials).toEqual([]);
    expect(normalizedAddress).toBeNull();
  });

  it('still returns federal officials when OpenStates is unavailable', async () => {
    // Census geocoder succeeds
    mockFetch.mockResolvedValueOnce(mockResponse(censusMockSuccess));
    // OpenStates fails (key missing or network error) — unset key
    delete process.env.OPENSTATES_API_KEY;

    const { officials } = await resolveRepresentatives('123 Main St, Portland, OR');
    // Should still get federal results from static JSON
    const federalNames = officials.map((o) => o.name);
    expect(federalNames).toContain('Jane Smith');
  });
});
