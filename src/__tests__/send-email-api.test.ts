import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';
import { sendEmail } from '@/lib/email';
import { resolveRepresentatives } from '@/lib/integrations/representatives';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/api-utils', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/prisma/prisma', () => ({
  default: {
    action: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    actionParticipation: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/integrations/representatives', () => ({
  resolveRepresentatives: vi.fn(),
}));

vi.mock('@/lib/notifications/campaignNotifications', () => ({
  logActionRSVP: vi.fn(),
  logActionCompleted: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

const mockAuth = vi.mocked(auth);
const mockPrisma = prisma as unknown as {
  action: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  actionParticipation: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};
const mockSendEmail = vi.mocked(sendEmail);
const mockResolveRepresentatives = vi.mocked(resolveRepresentatives);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: (...args: any[]) => Promise<Response>;

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/db';
  ({ POST } = await import('@/app/api/actions/[id]/send-email/route'));
});

const baseEmailAction = {
  id: 'action-1',
  type: 'EMAIL',
  campaignId: 'campaign-1',
  emailSubject: 'Support the Climate Bill',
  emailBody: 'Dear Representative, please vote yes on the climate bill.',
  emailTargets: ['rep@house.gov'],
  targetMode: null,
  targetLevel: null,
  targetOffices: [],
  manualTargets: null,
  campaign: { id: 'campaign-1', name: 'Climate Campaign' },
};

const baseUser = {
  name: 'Test User',
  email: 'testuser@example.com',
  zipCode: '97201',
  streetAddress: '123 Main St',
};

describe('POST /api/actions/[id]/send-email', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPrisma.actionParticipation.findUnique.mockResolvedValue(null);
    mockPrisma.actionParticipation.upsert.mockResolvedValue({ id: 'participation-1' });
  });

  it('returns 401 when unauthenticated', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce(null as any);

    const request = new Request('http://localhost/api/actions/action-1/send-email', {
      method: 'POST',
    });
    const response = await POST(request, { params: { id: 'action-1' } });
    expect(response.status).toBe(401);
  });

  it('returns 404 when action not found', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.action.findUnique.mockResolvedValueOnce(null);

    const request = new Request('http://localhost/api/actions/action-1/send-email', {
      method: 'POST',
    });
    const response = await POST(request, { params: { id: 'action-1' } });
    expect(response.status).toBe(404);
  });

  it('returns 400 when action type is not EMAIL', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.action.findUnique.mockResolvedValueOnce({
      ...baseEmailAction,
      type: 'PHONE',
    });

    const request = new Request('http://localhost/api/actions/action-1/send-email', {
      method: 'POST',
    });
    const response = await POST(request, { params: { id: 'action-1' } });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/not an email action/i);
  });

  it('returns 400 when action is missing subject or body', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.action.findUnique.mockResolvedValueOnce({
      ...baseEmailAction,
      emailSubject: null,
      emailBody: null,
    });

    const request = new Request('http://localhost/api/actions/action-1/send-email', {
      method: 'POST',
    });
    const response = await POST(request, { params: { id: 'action-1' } });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/missing subject or body/i);
  });

  it('sends to emailTargets when targetMode is null', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.action.findUnique.mockResolvedValueOnce(baseEmailAction);
    mockPrisma.user.findUnique.mockResolvedValueOnce(baseUser);
    mockSendEmail.mockResolvedValueOnce(undefined as never);

    const request = new Request('http://localhost/api/actions/action-1/send-email', {
      method: 'POST',
    });
    const response = await POST(request, { params: { id: 'action-1' } });
    expect(response.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'rep@house.gov' }));
  });

  it('sends to manualTargets emails in MANUAL mode', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.action.findUnique.mockResolvedValueOnce({
      ...baseEmailAction,
      targetMode: 'MANUAL',
      emailTargets: [],
      manualTargets: [
        { name: 'Rep Jones', email: 'jones@house.gov', phone: null },
        { name: 'Sen Smith', email: 'smith@senate.gov', phone: null },
      ],
    });
    mockPrisma.user.findUnique.mockResolvedValueOnce(baseUser);
    mockSendEmail.mockResolvedValue(undefined as never);

    const request = new Request('http://localhost/api/actions/action-1/send-email', {
      method: 'POST',
    });
    const response = await POST(request, { params: { id: 'action-1' } });
    expect(response.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    const data = await response.json();
    expect(data.sent).toBe(2);
    expect(data.failed).toBe(0);
  });

  it('uses resolveRepresentatives in CIVIC mode', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.action.findUnique.mockResolvedValueOnce({
      ...baseEmailAction,
      targetMode: 'CIVIC',
      targetLevel: 'FEDERAL',
      emailTargets: [],
      manualTargets: null,
    });
    mockPrisma.user.findUnique.mockResolvedValueOnce(baseUser);
    mockResolveRepresentatives.mockResolvedValueOnce({
      officials: [
        {
          office: 'U.S. Senator (OR)',
          name: 'Jane Smith',
          party: 'Democrat',
          phones: [],
          urls: [],
          emails: ['senator@senate.gov'],
          photoUrl: null,
        },
      ],
      normalizedAddress: '123 Main St, Portland, OR 97201',
    });
    mockSendEmail.mockResolvedValue(undefined as never);

    const request = new Request('http://localhost/api/actions/action-1/send-email', {
      method: 'POST',
    });
    const response = await POST(request, { params: { id: 'action-1' } });
    expect(response.status).toBe(200);
    expect(mockResolveRepresentatives).toHaveBeenCalledWith('123 Main St, 97201');
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'senator@senate.gov' }));
  });

  it('returns 400 in CIVIC mode when user has no address', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.action.findUnique.mockResolvedValueOnce({
      ...baseEmailAction,
      targetMode: 'CIVIC',
      emailTargets: [],
      manualTargets: null,
    });
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      ...baseUser,
      zipCode: null,
      streetAddress: null,
    });

    const request = new Request('http://localhost/api/actions/action-1/send-email', {
      method: 'POST',
    });
    const response = await POST(request, { params: { id: 'action-1' } });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/address/i);
  });

  it('returns 400 when no target emails are configured', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.action.findUnique.mockResolvedValueOnce({
      ...baseEmailAction,
      emailTargets: [],
      manualTargets: null,
      targetMode: null,
    });
    mockPrisma.user.findUnique.mockResolvedValueOnce(baseUser);

    const request = new Request('http://localhost/api/actions/action-1/send-email', {
      method: 'POST',
    });
    const response = await POST(request, { params: { id: 'action-1' } });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/no email targets/i);
  });

  it('marks participation as completed after a successful send', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.action.findUnique.mockResolvedValueOnce(baseEmailAction);
    mockPrisma.user.findUnique.mockResolvedValueOnce(baseUser);
    mockSendEmail.mockResolvedValueOnce(undefined as never);
    mockPrisma.actionParticipation.findUnique.mockResolvedValueOnce(null);

    const request = new Request('http://localhost/api/actions/action-1/send-email', {
      method: 'POST',
    });
    await POST(request, { params: { id: 'action-1' } });

    expect(mockPrisma.actionParticipation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ attended: true }),
        create: expect.objectContaining({ attended: true, willAttend: true }),
      }),
    );
  });

  it('reports partial send failures with sent and failed counts', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.action.findUnique.mockResolvedValueOnce({
      ...baseEmailAction,
      targetMode: 'MANUAL',
      emailTargets: [],
      manualTargets: [
        { name: 'Rep Jones', email: 'jones@house.gov', phone: null },
        { name: 'Sen Smith', email: 'smith@senate.gov', phone: null },
      ],
    });
    mockPrisma.user.findUnique.mockResolvedValueOnce(baseUser);
    mockSendEmail.mockResolvedValueOnce(undefined as never); // first succeeds
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP error')); // second fails

    const request = new Request('http://localhost/api/actions/action-1/send-email', {
      method: 'POST',
    });
    const response = await POST(request, { params: { id: 'action-1' } });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.sent).toBe(1);
    expect(data.failed).toBe(1);
  });
});
