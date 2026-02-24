import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { logActionCompleted, logActionRSVP } from '@/lib/notifications/campaignNotifications';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/api-utils', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/notifications/campaignNotifications', () => ({
  logActionRSVP: vi.fn(),
  logActionCompleted: vi.fn(),
}));

vi.mock('@/lib/prisma/prisma', () => ({
  default: {
    action: { findUnique: vi.fn() },
    campaignMember: { findUnique: vi.fn() },
    actionParticipation: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

const mockAuth = vi.mocked(auth);
const mockPrisma = prisma as unknown as {
  action: { findUnique: ReturnType<typeof vi.fn> };
  campaignMember: { findUnique: ReturnType<typeof vi.fn> };
  actionParticipation: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
};
const mockLogActionRSVP = vi.mocked(logActionRSVP);
const mockLogActionCompleted = vi.mocked(logActionCompleted);
let POST: typeof import('@/app/api/actions/[id]/participate/route').POST;

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/db';
  ({ POST } = await import('@/app/api/actions/[id]/participate/route'));
});

describe('POST /api/actions/[id]/participate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce(null as any);
    const request = new Request('http://localhost/api/actions/action-1/participate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ willAttend: true }),
    });

    const response = await POST(request, { params: { id: 'cjld2cjxh0000qzrmn831i7rn' } });
    expect(response.status).toBe(401);
  });

  it('logs RSVP when user signs up', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.action.findUnique.mockResolvedValueOnce({
      id: 'cjld2cjxh0000qzrmn831i7rn',
      campaignId: 'campaign-1',
      campaign: { id: 'campaign-1', name: 'Test Campaign' },
    });
    mockPrisma.campaignMember.findUnique.mockResolvedValueOnce({ id: 'member-1' });
    mockPrisma.actionParticipation.findUnique.mockResolvedValueOnce(null);
    mockPrisma.actionParticipation.upsert.mockResolvedValueOnce({ id: 'participation-1' });

    const request = new Request('http://localhost/api/actions/cjld2cjxh0000qzrmn831i7rn/participate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ willAttend: true }),
    });

    const response = await POST(request, { params: { id: 'cjld2cjxh0000qzrmn831i7rn' } });
    expect(response.status).toBe(200);
    expect(mockLogActionRSVP).toHaveBeenCalledTimes(1);
    expect(mockLogActionCompleted).not.toHaveBeenCalled();
  });
});
