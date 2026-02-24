import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { auth } from '@/auth';
import { resolveRepresentatives } from '@/lib/integrations/representatives';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/api-utils', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(null),
  apiError: (message: string, status: number, reqId?: string) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (reqId) headers['X-Request-Id'] = reqId;
    return new Response(JSON.stringify({ error: message }), { status, headers });
  },
  requestId: vi.fn().mockReturnValue('test-request-id'),
}));

vi.mock('@/lib/integrations/representatives', () => ({
  resolveRepresentatives: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

const mockAuth = vi.mocked(auth);
const mockResolveRepresentatives = vi.mocked(resolveRepresentatives);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: (...args: any[]) => Promise<Response>;

beforeAll(async () => {
  ({ GET } = await import('@/app/api/civic/representatives/route'));
});

describe('GET /api/civic/representatives', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 401 when unauthenticated', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce(null as any);

    const request = new Request('http://localhost/api/civic/representatives?address=123+Main+St');
    const response = await GET(request);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toMatch(/unauthorized/i);
  });

  it('returns 400 when address query param is missing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);

    const request = new Request('http://localhost/api/civic/representatives');
    const response = await GET(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/address/i);
  });

  it('returns 400 when address is missing zip or street comma', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);

    const request = new Request('http://localhost/api/civic/representatives?address=123+Main+St+Portland+OR');
    const response = await GET(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/full address/i);
  });

  it('returns 200 with officials array on success', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    const mockOfficials = [
      {
        office: 'U.S. Senator (OR)',
        name: 'Jane Smith',
        party: 'Democrat',
        phones: ['503-555-0100'],
        urls: ['https://smith.senate.gov'],
        emails: [],
        photoUrl: null,
      },
    ];
    mockResolveRepresentatives.mockResolvedValueOnce({
      officials: mockOfficials,
      normalizedAddress: '123 Main St, Portland, OR 97201',
    });

    const request = new Request('http://localhost/api/civic/representatives?address=123+Main+St,+Portland,+OR+97201');
    const response = await GET(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.officials).toHaveLength(1);
    expect(data.officials[0].name).toBe('Jane Smith');
    expect(data.normalizedAddress).toBe('123 Main St, Portland, OR 97201');
  });

  it('returns 500 when resolveRepresentatives throws unexpectedly', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockResolveRepresentatives.mockRejectedValueOnce(new Error('Unexpected failure'));

    const request = new Request('http://localhost/api/civic/representatives?address=123+Main+St,+Portland,+OR+97201');
    const response = await GET(request);
    expect(response.status).toBe(500);
  });

  it('passes the normalized address string to resolveRepresentatives', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockResolveRepresentatives.mockResolvedValueOnce({ officials: [], normalizedAddress: null });

    const request = new Request('http://localhost/api/civic/representatives?address=456+Oak+Ave,+Austin,+TX+78701');
    await GET(request);
    expect(mockResolveRepresentatives).toHaveBeenCalledWith('456 Oak Ave, Austin, TX 78701');
  });

  it('returns empty officials array when no representatives found', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockResolveRepresentatives.mockResolvedValueOnce({ officials: [], normalizedAddress: 'Unknown Address' });

    const request = new Request(
      'http://localhost/api/civic/representatives?address=999+Nowhere+St,+Fakeville,+ZZ+00000',
    );
    const response = await GET(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.officials).toEqual([]);
  });
});
