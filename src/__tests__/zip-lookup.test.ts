import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { lookupStateByZip } from '@/lib/location/zipLookup';

vi.mock('@/lib/fetchWithTimeout', () => ({
  fetchWithTimeout: vi.fn(),
}));

const mockFetch = vi.mocked(fetchWithTimeout);

function mockResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('lookupStateByZip', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns null for invalid zip format', async () => {
    await expect(lookupStateByZip('abcde')).resolves.toBeNull();
  });

  it('returns state abbreviation and city for valid zip', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        'post code': '90210',
        places: [{ 'place name': 'Beverly Hills', state: 'California', 'state abbreviation': 'CA' }],
      }),
    );

    await expect(lookupStateByZip('90210')).resolves.toEqual({
      zip: '90210',
      state: 'CA',
      city: 'Beverly Hills',
    });
  });

  it('returns null when upstream lookup fails', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(null, false));

    await expect(lookupStateByZip('00000')).resolves.toBeNull();
  });

  it('uses an 8-second timeout', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        'post code': '97201',
        places: [{ 'place name': 'Portland', state: 'Oregon', 'state abbreviation': 'OR' }],
      }),
    );

    await lookupStateByZip('97201');
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('97201'), {}, 8_000);
  });
});
