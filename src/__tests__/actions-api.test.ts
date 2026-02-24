import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { auth } from '@/auth';
import prisma from '@/lib/prisma/prisma';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/api-utils', () => ({
  // Plain functions so vi.resetAllMocks() in beforeEach doesn't strip them
  enforceRateLimit: vi.fn(),
  withCors: (response: Response) => response,
  corsOptionsResponse: () => new Response(null, { status: 204 }),
  apiError: (message: string, status: number, reqId?: string) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (reqId) headers['X-Request-Id'] = reqId;
    return new Response(JSON.stringify({ error: message }), { status, headers });
  },
  requestId: () => 'test-request-id',
}));

vi.mock('@/lib/prisma/prisma', () => ({
  default: {
    action: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    campaign: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

const mockAuth = vi.mocked(auth);
const mockPrisma = prisma as unknown as {
  action: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  campaign: {
    findFirst: ReturnType<typeof vi.fn>;
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET_LIST: (...args: any[]) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST_CREATE: (...args: any[]) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET_ONE: (...args: any[]) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PATCH: (...args: any[]) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DELETE: (...args: any[]) => Promise<Response>;

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/db';
  ({ GET: GET_LIST, POST: POST_CREATE } = await import('@/app/api/actions/route'));
  ({ GET: GET_ONE, PATCH, DELETE } = await import('@/app/api/actions/[id]/route'));
});

const baseAction = {
  id: 'action-1',
  title: 'Test Action',
  description: 'A description',
  type: 'EVENT',
  dueDate: new Date('2026-06-01'),
  campaignId: 'campaign-1',
  isActive: true,
  campaign: { id: 'campaign-1', name: 'Test Campaign', cause: { name: 'Cause', icon: '🌱' } },
  _count: { participants: 0 },
};

describe('GET /api/actions', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns actions list without authentication', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce(null as any);
    mockPrisma.action.findMany.mockResolvedValueOnce([baseAction]);

    const request = new Request('http://localhost/api/actions');
    const response = await GET_LIST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
  });

  it('filters by campaignId', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce(null as any);
    mockPrisma.action.findMany.mockResolvedValueOnce([baseAction]);

    const request = new Request('http://localhost/api/actions?campaignId=campaign-1');
    await GET_LIST(request);
    expect(mockPrisma.action.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ campaignId: 'campaign-1' }),
      }),
    );
  });

  it('filters by type', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce(null as any);
    mockPrisma.action.findMany.mockResolvedValueOnce([]);

    const request = new Request('http://localhost/api/actions?type=PHONE');
    await GET_LIST(request);
    expect(mockPrisma.action.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: 'PHONE' }),
      }),
    );
  });

  it('filters upcoming actions when upcoming=true', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce(null as any);
    mockPrisma.action.findMany.mockResolvedValueOnce([]);

    const request = new Request('http://localhost/api/actions?upcoming=true');
    await GET_LIST(request);
    expect(mockPrisma.action.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ dueDate: { gte: expect.any(Date) } }),
      }),
    );
  });
});

describe('POST /api/actions', () => {
  beforeEach(() => vi.resetAllMocks());

  const validEventPayload = {
    title: 'New Event Action',
    description: 'Description for new event action',
    type: 'EVENT',
    dueDate: '2026-06-01T23:59:00.000Z',
    campaignId: 'campaign-1',
  };

  it('returns 401 when unauthenticated', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce(null as any);
    const request = new Request('http://localhost/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validEventPayload),
    });
    const response = await POST_CREATE(request);
    expect(response.status).toBe(401);
  });

  it('returns 403 when user is not an org manager', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.campaign.findFirst.mockResolvedValueOnce(null);

    const request = new Request('http://localhost/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validEventPayload),
    });
    const response = await POST_CREATE(request);
    expect(response.status).toBe(403);
  });

  it('returns 400 on validation failure (invalid type)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    const request = new Request('http://localhost/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'ab', type: 'INVALID_TYPE' }),
    });
    const response = await POST_CREATE(request);
    expect(response.status).toBe(400);
  });

  it('creates EVENT action with 201', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.campaign.findFirst.mockResolvedValueOnce({ id: 'campaign-1' });
    mockPrisma.action.create.mockResolvedValueOnce({ ...baseAction, id: 'new-action-1' });

    const request = new Request('http://localhost/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validEventPayload),
    });
    const response = await POST_CREATE(request);
    expect(response.status).toBe(201);
  });

  it('creates EMAIL action with email fields', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.campaign.findFirst.mockResolvedValueOnce({ id: 'campaign-1' });
    mockPrisma.action.create.mockResolvedValueOnce({ ...baseAction, type: 'EMAIL' });

    const request = new Request('http://localhost/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Email Campaign Action',
        type: 'EMAIL',
        dueDate: '2026-06-01T23:59:00.000Z',
        campaignId: 'campaign-1',
        emailSubject: 'Support the bill',
        emailBody: 'Dear representative, please vote yes on the climate bill.',
      }),
    });
    const response = await POST_CREATE(request);
    expect(response.status).toBe(201);
  });

  it('creates PHONE action with callScript', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.campaign.findFirst.mockResolvedValueOnce({ id: 'campaign-1' });
    mockPrisma.action.create.mockResolvedValueOnce({ ...baseAction, type: 'PHONE' });

    const request = new Request('http://localhost/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Phone Bank Action',
        type: 'PHONE',
        dueDate: '2026-06-01T23:59:00.000Z',
        campaignId: 'campaign-1',
        callScript: 'Call and ask them to vote yes on the bill.',
      }),
    });
    const response = await POST_CREATE(request);
    expect(response.status).toBe(201);
  });

  it('creates CANVASS action', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.campaign.findFirst.mockResolvedValueOnce({ id: 'campaign-1' });
    mockPrisma.action.create.mockResolvedValueOnce({ ...baseAction, type: 'CANVASS' });

    const request = new Request('http://localhost/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Door Knocking Action',
        type: 'CANVASS',
        dueDate: '2026-06-01T23:59:00.000Z',
        campaignId: 'campaign-1',
        canvassArea: 'Downtown District',
      }),
    });
    const response = await POST_CREATE(request);
    expect(response.status).toBe(201);
  });
});

describe('GET /api/actions/[id]', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns action with 200', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce(null as any);
    mockPrisma.action.findUnique.mockResolvedValueOnce({
      ...baseAction,
      campaign: {
        id: 'campaign-1',
        name: 'Test Campaign',
        description: 'Desc',
        status: 'ACTIVE',
        cause: { id: 'cause-1', name: 'Cause', icon: '🌱', color: '#green' },
        org: { id: 'org-1', name: 'Org', logoUrl: null },
      },
    });

    const request = new Request('http://localhost/api/actions/action-1');
    const response = await GET_ONE(request, { params: { id: 'action-1' } });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.id).toBe('action-1');
  });

  it('returns 404 if action not found', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce(null as any);
    mockPrisma.action.findUnique.mockResolvedValueOnce(null);

    const request = new Request('http://localhost/api/actions/nonexistent');
    const response = await GET_ONE(request, { params: { id: 'nonexistent' } });
    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/actions/[id]', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 401 when unauthenticated', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce(null as any);
    const request = new Request('http://localhost/api/actions/action-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Title' }),
    });
    const response = await PATCH(request, { params: { id: 'action-1' } });
    expect(response.status).toBe(401);
  });

  it('returns 403 when user is not org manager', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.action.findFirst.mockResolvedValueOnce(null);

    const request = new Request('http://localhost/api/actions/action-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Title' }),
    });
    const response = await PATCH(request, { params: { id: 'action-1' } });
    expect(response.status).toBe(403);
  });

  it('updates action successfully', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.action.findFirst.mockResolvedValueOnce(baseAction);
    mockPrisma.action.update.mockResolvedValueOnce({ ...baseAction, title: 'Updated Title' });

    const request = new Request('http://localhost/api/actions/action-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Title' }),
    });
    const response = await PATCH(request, { params: { id: 'action-1' } });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.title).toBe('Updated Title');
  });
});

describe('DELETE /api/actions/[id]', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 401 when unauthenticated', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce(null as any);
    const request = new Request('http://localhost/api/actions/action-1', { method: 'DELETE' });
    const response = await DELETE(request, { params: { id: 'action-1' } });
    expect(response.status).toBe(401);
  });

  it('returns 403 when user is not org manager', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.action.findFirst.mockResolvedValueOnce(null);

    const request = new Request('http://localhost/api/actions/action-1', { method: 'DELETE' });
    const response = await DELETE(request, { params: { id: 'action-1' } });
    expect(response.status).toBe(403);
  });

  it('soft deletes action by setting isActive to false', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1' } } as any);
    mockPrisma.action.findFirst.mockResolvedValueOnce({ id: 'action-1' });
    mockPrisma.action.update.mockResolvedValueOnce({ ...baseAction, isActive: false });

    const request = new Request('http://localhost/api/actions/action-1', { method: 'DELETE' });
    const response = await DELETE(request, { params: { id: 'action-1' } });
    expect(response.status).toBe(200);
    expect(mockPrisma.action.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }));
  });
});
