import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { getLaCityCouncilDistrict, getLaCityOfficials } from '@/lib/integrations/laCityOfficials';

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

describe('getLaCityOfficials', () => {
  it('returns council member + 3 citywide officials for a valid district', () => {
    const officials = getLaCityOfficials(1);
    expect(officials).toHaveLength(4);

    const council = officials.find((o) => o.office.includes('District 1'));
    expect(council).toBeDefined();
    expect(council!.name).toBe('Eunisses Hernandez');
    expect(council!.phones).toEqual(['(213) 473-7001']);
    expect(council!.emails).toEqual(['councilmember.hernandez@lacity.org']);
    expect(council!.urls).toEqual(['https://cd1.lacity.gov/']);

    const offices = officials.map((o) => o.office);
    expect(offices).toContain('Mayor of Los Angeles');
    expect(offices).toContain('LA City Controller');
    expect(offices).toContain('LA City Attorney');
  });

  it('returns only 3 citywide officials when district is null', () => {
    const officials = getLaCityOfficials(null);
    expect(officials).toHaveLength(3);

    const offices = officials.map((o) => o.office);
    expect(offices).toContain('Mayor of Los Angeles');
    expect(offices).toContain('LA City Controller');
    expect(offices).toContain('LA City Attorney');
  });

  it('returns correct council member for each district 1-15', () => {
    for (let d = 1; d <= 15; d += 1) {
      const officials = getLaCityOfficials(d);
      expect(officials.length).toBe(4);
      const council = officials.find((o) => o.office.includes(`District ${d}`));
      expect(council).toBeDefined();
      expect(council!.name).toBeTruthy();
    }
  });

  it('returns only citywide officials for an invalid district', () => {
    const officials = getLaCityOfficials(99);
    expect(officials).toHaveLength(3);
  });

  it('all officials conform to the Official interface shape', () => {
    const officials = getLaCityOfficials(5);
    for (const o of officials) {
      expect(o.office).toBeTruthy();
      expect(o.name).toBeTruthy();
      expect(o.party).toBeNull();
      expect(Array.isArray(o.phones)).toBe(true);
      expect(Array.isArray(o.urls)).toBe(true);
      expect(Array.isArray(o.emails)).toBe(true);
      expect(o).toHaveProperty('photoUrl');
    }
  });

  it('mayor has no email but has phone', () => {
    const officials = getLaCityOfficials(null);
    const mayor = officials.find((o) => o.office === 'Mayor of Los Angeles');
    expect(mayor).toBeDefined();
    expect(mayor!.name).toBe('Karen Bass');
    expect(mayor!.emails).toEqual([]);
    expect(mayor!.phones).toEqual(['(213) 978-0600']);
  });
});

describe('getLaCityCouncilDistrict', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns district number from valid GIS response', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        features: [{ attributes: { District: 1 } }],
      }),
    );

    const district = await getLaCityCouncilDistrict(34.0753, -118.2137);
    expect(district).toBe(1);
  });

  it('returns null when point is outside LA city limits (empty features)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ features: [] }));

    const district = await getLaCityCouncilDistrict(34.5, -118.5);
    expect(district).toBeNull();
  });

  it('returns null on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const district = await getLaCityCouncilDistrict(34.0753, -118.2137);
    expect(district).toBeNull();
  });

  it('returns null on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}, false, 500));

    const district = await getLaCityCouncilDistrict(34.0753, -118.2137);
    expect(district).toBeNull();
  });

  it('returns null for invalid district value in response', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        features: [{ attributes: { District: 0 } }],
      }),
    );

    const district = await getLaCityCouncilDistrict(34.0753, -118.2137);
    expect(district).toBeNull();
  });

  it('passes correct query parameters to the GIS API', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ features: [{ attributes: { District: 7 } }] }));

    await getLaCityCouncilDistrict(34.25, -118.45);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('geometry=-118.45%2C34.25');
    expect(url).toContain('geometryType=esriGeometryPoint');
    expect(url).toContain('inSR=4326');
    expect(url).toContain('outFields=District');
    expect(url).toContain('f=json');
  });
});
