import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/me/location/route';
import prisma from '@/lib/prisma/prisma';
import { auth } from '@/auth';
import { enforceRateLimit } from '@/lib/api-utils';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/api-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-utils')>();
  return {
    ...actual,
    enforceRateLimit: vi.fn(),
  };
});

vi.mock('@/lib/prisma/prisma', () => ({
  default: {
    user: {
      update: vi.fn(),
    },
  },
}));

const mockAuth = vi.mocked(auth);
const mockRateLimit = vi.mocked(enforceRateLimit);
const mockPrisma = prisma as unknown as {
  user: { update: ReturnType<typeof vi.fn> };
};

describe('POST /api/me/location', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRateLimit.mockResolvedValue(null);
  });

  it('returns 401 when unauthenticated', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce(null as any);

    const request = new Request('http://localhost/api/me/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zipCode: '90210', state: 'CA' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('persists normalized state and zip', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.user.update.mockResolvedValueOnce({
      id: 'user-1',
      zipCode: '90210',
      state: 'CA',
      streetAddress: '123 Main St',
    });

    const request = new Request('http://localhost/api/me/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zipCode: '90210', state: 'ca', streetAddress: '123 Main St' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          zipCode: '90210',
          state: 'CA',
        }),
      }),
    );
  });
});
