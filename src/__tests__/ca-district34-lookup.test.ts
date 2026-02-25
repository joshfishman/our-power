/**
 * Verifies the representative lookup pipeline works for a real CA address.
 * Uses the actual bundled congress-legislators JSON (not mocked) to confirm
 * federal reps are returned for California's 34th congressional district.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { resolveRepresentatives } from '@/lib/integrations/representatives';

vi.mock('@/lib/fetchWithTimeout', () => ({
  fetchWithTimeout: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

const mockFetch = vi.mocked(fetchWithTimeout);

function mockResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

const censusMockLA = {
  result: {
    addressMatches: [
      {
        matchedAddress: '131 N AVE 25, LOS ANGELES, CA, 90031',
        coordinates: { x: -118.2275, y: 34.0839 },
        geographies: {
          States: [{ STUSAB: 'CA' }],
          'Congressional Districts': [{ BASENAME: '34' }],
        },
      },
    ],
  },
};

describe('CA District 34 representative lookup (131 N Ave 25, LA)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.OPENSTATES_API_KEY;
  });

  it('returns at least 3 federal reps for a CA-34 address', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(censusMockLA));

    const { officials, normalizedAddress } = await resolveRepresentatives('131 North Avenue 25, Los Angeles, CA 90031');

    expect(normalizedAddress).toBe('131 N AVE 25, LOS ANGELES, CA, 90031');
    expect(officials.length).toBeGreaterThanOrEqual(3);
  });

  it('includes both CA senators', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(censusMockLA));

    const { officials } = await resolveRepresentatives('131 North Avenue 25, Los Angeles, CA 90031');

    const senators = officials.filter((o) => o.office.includes('Senator'));
    expect(senators.length).toBe(2);

    const names = senators.map((s) => s.name);
    expect(names).toContain('Adam B. Schiff');
    expect(names).toContain('Alex Padilla');
  });

  it('includes the district 34 House representative', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(censusMockLA));

    const { officials } = await resolveRepresentatives('131 North Avenue 25, Los Angeles, CA 90031');

    const houseReps = officials.filter((o) => o.office.includes('Representative'));
    expect(houseReps.length).toBeGreaterThanOrEqual(1);

    const districtRep = houseReps.find((r) => r.office.includes('District 34'));
    expect(districtRep).toBeDefined();
    expect(districtRep!.name).toBe('Jimmy Gomez');
  });

  it('all officials have proper shape with office, name, party', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(censusMockLA));

    const { officials } = await resolveRepresentatives('131 North Avenue 25, Los Angeles, CA 90031');

    for (const official of officials) {
      expect(official.office).toBeTruthy();
      expect(official.name).toBeTruthy();
      expect(official).toHaveProperty('party');
      expect(official).toHaveProperty('phones');
      expect(official).toHaveProperty('emails');
      expect(official).toHaveProperty('urls');
    }
  });

  it('includes state legislators when OpenStates is configured', async () => {
    process.env.OPENSTATES_API_KEY = 'test-key';
    // Census geocoder
    mockFetch.mockResolvedValueOnce(mockResponse(censusMockLA));
    // OpenStates
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        results: [
          {
            name: 'CA State Senator',
            party: 'Democrat',
            current_role: { title: 'Senator', org_classification: 'legislature', district: '24' },
            contact_details: [{ type: 'voice', value: '213-555-0001' }],
            links: [],
            email: 'senator@ca.gov',
            photo_url: null,
          },
          {
            name: 'CA Assembly Member',
            party: 'Democrat',
            current_role: { title: 'Assembly Member', org_classification: 'legislature', district: '51' },
            contact_details: [],
            links: [],
            email: 'assembly@ca.gov',
            photo_url: null,
          },
        ],
      }),
    );

    const { officials } = await resolveRepresentatives('131 North Avenue 25, Los Angeles, CA 90031');

    expect(officials.length).toBeGreaterThanOrEqual(5);

    const stateNames = officials.map((o) => o.name);
    expect(stateNames).toContain('CA State Senator');
    expect(stateNames).toContain('CA Assembly Member');
  });
});
