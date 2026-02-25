/**
 * Verifies the representative lookup pipeline works for a real CA address.
 * Uses the actual bundled congress + CA state legislators JSON (not mocked)
 * to confirm federal and state reps are returned for CA-34 / SD-26 / AD-54.
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
          '119th Congressional Districts': [{ BASENAME: '34' }],
          '2024 State Legislative Districts - Upper': [{ BASENAME: '26' }],
          '2024 State Legislative Districts - Lower': [{ BASENAME: '54' }],
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

  it('returns federal + CA state reps for a CA-34/SD-26/AD-54 address', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(censusMockLA));

    const { officials, normalizedAddress } = await resolveRepresentatives('131 North Avenue 25, Los Angeles, CA 90031');

    expect(normalizedAddress).toBe('131 N AVE 25, LOS ANGELES, CA, 90031');
    expect(officials.length).toBeGreaterThanOrEqual(5);
  });

  it('includes both CA U.S. senators', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(censusMockLA));

    const { officials } = await resolveRepresentatives('131 North Avenue 25, Los Angeles, CA 90031');

    const usSenators = officials.filter((o) => o.office.includes('U.S. Senator'));
    expect(usSenators.length).toBe(2);

    const names = usSenators.map((s) => s.name);
    expect(names).toContain('Adam B. Schiff');
    expect(names).toContain('Alex Padilla');
  });

  it('includes the district 34 U.S. House representative', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(censusMockLA));

    const { officials } = await resolveRepresentatives('131 North Avenue 25, Los Angeles, CA 90031');

    const districtRep = officials.find((o) => o.office.includes('U.S. Representative') && o.office.includes('34'));
    expect(districtRep).toBeDefined();
    expect(districtRep!.name).toBe('Jimmy Gomez');
  });

  it('includes CA state senator for district 26', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(censusMockLA));

    const { officials } = await resolveRepresentatives('131 North Avenue 25, Los Angeles, CA 90031');

    const stateSenator = officials.find((o) => o.office.includes('CA State Senator') && o.office.includes('26'));
    expect(stateSenator).toBeDefined();
    expect(stateSenator!.name).toContain('Durazo');
    expect(stateSenator!.emails.length).toBeGreaterThan(0);
  });

  it('includes CA assembly member for district 54', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(censusMockLA));

    const { officials } = await resolveRepresentatives('131 North Avenue 25, Los Angeles, CA 90031');

    const assemblyMember = officials.find((o) => o.office.includes('CA Assembly Member') && o.office.includes('54'));
    expect(assemblyMember).toBeDefined();
    expect(assemblyMember!.name).toContain('Gonz');
    expect(assemblyMember!.emails.length).toBeGreaterThan(0);
  });

  it('all officials have proper shape', async () => {
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

  it('deduplicates when OpenStates returns same legislators', async () => {
    process.env.OPENSTATES_API_KEY = 'test-key';
    mockFetch.mockResolvedValueOnce(mockResponse(censusMockLA));
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        results: [
          {
            name: 'María Elena Durazo',
            party: 'Democrat',
            current_role: { title: 'Senator', org_classification: 'legislature', district: '26' },
            contact_details: [],
            links: [],
            email: 'senator.durazo@senate.ca.gov',
            photo_url: null,
          },
        ],
      }),
    );

    const { officials } = await resolveRepresentatives('131 North Avenue 25, Los Angeles, CA 90031');

    const durazoCount = officials.filter((o) => o.name.includes('Durazo')).length;
    expect(durazoCount).toBe(1);
  });
});
