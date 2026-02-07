import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/campaigns/route';
import prisma from '@/lib/prisma/prisma';
import { auth } from '@/auth';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/prisma/prisma', () => ({
  default: {
    organization: {
      findFirst: vi.fn(),
    },
    campaign: {
      create: vi.fn(),
    },
  },
}));

const mockAuth = vi.mocked(auth);
const mockPrisma = prisma as unknown as {
  organization: { findFirst: ReturnType<typeof vi.fn> };
  campaign: { create: ReturnType<typeof vi.fn> };
};

describe('POST /api/campaigns', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValueOnce(null);
    const request = new Request('http://localhost/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test',
        description: 'Valid description for campaign',
        type: 'LEGISLATIVE',
        causeId: 'cjld2cjxh0000qzrmn831i7rn',
        orgId: 'cjld2cjxh0000qzrmn831i7ro',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('returns 403 when user is not an org manager', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'cjld2cjxh0000qzrmn831i7rn' } } as any);
    mockPrisma.organization.findFirst.mockResolvedValueOnce(null);

    const request = new Request('http://localhost/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Campaign',
        description: 'Valid description for campaign',
        type: 'LEGISLATIVE',
        causeId: 'cjld2cjxh0000qzrmn831i7rn',
        orgId: 'cjld2cjxh0000qzrmn831i7ro',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it('creates campaign for authorized manager', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'cjld2cjxh0000qzrmn831i7rn' } } as any);
    mockPrisma.organization.findFirst.mockResolvedValueOnce({ id: 'org-1' });
    mockPrisma.campaign.create.mockResolvedValueOnce({ id: 'campaign-1' });

    const request = new Request('http://localhost/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Campaign',
        description: 'Valid description for campaign',
        type: 'LEGISLATIVE',
        causeId: 'cjld2cjxh0000qzrmn831i7rn',
        orgId: 'cjld2cjxh0000qzrmn831i7ro',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
  });
});
