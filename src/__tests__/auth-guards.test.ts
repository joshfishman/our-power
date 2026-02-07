import { describe, it, expect } from 'vitest';
import { organizationSchema, addManagerSchema } from '@/lib/validations/organization';
import { campaignSchema, actionSchema } from '@/lib/validations/campaign';
import { checkRateLimit } from '@/lib/rateLimit';

describe('Organization Schema Validation', () => {
  it('should validate a valid organization', () => {
    const result = organizationSchema.safeParse({
      name: 'Test Organization',
      description: 'A test organization for activism.',
    });
    expect(result.success).toBe(true);
  });

  it('should reject an organization with a name too short', () => {
    const result = organizationSchema.safeParse({
      name: 'A',
    });
    expect(result.success).toBe(false);
  });

  it('should accept optional fields as null', () => {
    const result = organizationSchema.safeParse({
      name: 'Test Organization',
      description: null,
      logoUrl: null,
      website: null,
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid website URL', () => {
    const result = organizationSchema.safeParse({
      name: 'Test Organization',
      website: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid website URL', () => {
    const result = organizationSchema.safeParse({
      name: 'Test Organization',
      website: 'https://example.org',
    });
    expect(result.success).toBe(true);
  });
});

describe('Add Manager Schema Validation', () => {
  it('should validate a valid add manager request', () => {
    const result = addManagerSchema.safeParse({
      organizationId: 'org-123',
      userEmail: 'user@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid email', () => {
    const result = addManagerSchema.safeParse({
      organizationId: 'org-123',
      userEmail: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty organization ID', () => {
    const result = addManagerSchema.safeParse({
      organizationId: '',
      userEmail: 'user@example.com',
    });
    expect(result.success).toBe(false);
  });
});

describe('Campaign Schema - Auth Guard Scenarios', () => {
  it('should require orgId to create a campaign', () => {
    const result = campaignSchema.safeParse({
      name: 'Test Campaign',
      description: 'A valid description for testing.',
      type: 'COMMUNITY',
      causeId: 'cause-1',
      orgId: '', // empty
    });
    expect(result.success).toBe(false);
  });

  it('should require causeId to create a campaign', () => {
    const result = campaignSchema.safeParse({
      name: 'Test Campaign',
      description: 'A valid description for testing.',
      type: 'COMMUNITY',
      causeId: '', // empty
      orgId: 'org-1',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid campaign type', () => {
    const result = campaignSchema.safeParse({
      name: 'Test Campaign',
      description: 'A valid description for testing.',
      type: 'INVALID_TYPE',
      causeId: 'cause-1',
      orgId: 'org-1',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid campaign status', () => {
    const result = campaignSchema.safeParse({
      name: 'Test Campaign',
      description: 'A valid description for testing.',
      type: 'COMMUNITY',
      status: 'INVALID_STATUS',
      causeId: 'cause-1',
      orgId: 'org-1',
    });
    expect(result.success).toBe(false);
  });
});

describe('Action Schema - Auth Guard Scenarios', () => {
  it('should require campaignId', () => {
    const result = actionSchema.safeParse({
      title: 'Test Action',
      type: 'EVENT',
      dueDate: new Date().toISOString(),
      campaignId: '', // empty
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid action type', () => {
    const result = actionSchema.safeParse({
      title: 'Test Action',
      type: 'INVALID_TYPE',
      dueDate: new Date().toISOString(),
      campaignId: 'campaign-1',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid email targets', () => {
    const result = actionSchema.safeParse({
      title: 'Email Campaign',
      type: 'EMAIL',
      dueDate: new Date().toISOString(),
      campaignId: 'campaign-1',
      emailTargets: ['not-an-email'],
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid email targets', () => {
    const result = actionSchema.safeParse({
      title: 'Email Campaign',
      type: 'EMAIL',
      dueDate: new Date().toISOString(),
      campaignId: 'campaign-1',
      emailTargets: ['rep@gov.example.com', 'senator@gov.example.com'],
    });
    expect(result.success).toBe(true);
  });
});

describe('Rate Limiter', () => {
  it('should allow requests under the limit', async () => {
    const result = await checkRateLimit('test-ip-1', { limit: 5, windowSeconds: 60 });
    expect(result).toBeNull();
  });

  it('should block requests over the limit', async () => {
    const ip = `test-ip-block-${Date.now()}`;
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await checkRateLimit(ip, { limit: 5, windowSeconds: 60 });
    }
    const result = await checkRateLimit(ip, { limit: 5, windowSeconds: 60 });
    expect(result).not.toBeNull();
    expect(result?.status).toBe(429);
  });
});
