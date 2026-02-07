import { describe, expect, it } from 'vitest';
import { actionSchema, campaignSchema } from '@/lib/validations/campaign';
import { organizationSchema } from '@/lib/validations/organization';

// eslint-disable-next-line no-script-url
const JAVASCRIPT_URL = 'javascript:alert(1)';

describe('URL validation', () => {
  it('rejects javascript: urls in campaign imageUrl', () => {
    const result = campaignSchema.safeParse({
      name: 'Clean Energy Act',
      description: 'Support the Clean Energy Act with a coalition of partners.',
      type: 'LEGISLATIVE',
      causeId: 'cause-1',
      orgId: 'org-1',
      imageUrl: JAVASCRIPT_URL,
    });

    expect(result.success).toBe(false);
  });

  it('rejects javascript: urls in action locationUrl', () => {
    const result = actionSchema.safeParse({
      title: 'Town Hall',
      description: 'Join the community town hall.',
      type: 'EVENT',
      dueDate: new Date().toISOString(),
      campaignId: 'campaign-1',
      locationUrl: JAVASCRIPT_URL,
    });

    expect(result.success).toBe(false);
  });

  it('allows https urls for action graphics', () => {
    const result = actionSchema.safeParse({
      title: 'Shareable Graphic',
      description: 'Share this action.',
      type: 'EMAIL',
      dueDate: new Date().toISOString(),
      campaignId: 'campaign-1',
      graphics: ['https://example.com/graphic.png'],
      emailSubject: 'Please support this action',
      emailBody: 'Take a moment to send this email.',
      emailTargets: ['rep@example.gov'],
    });

    expect(result.success).toBe(true);
  });

  it('rejects javascript: urls in organization website', () => {
    const result = organizationSchema.safeParse({
      name: 'Community Org',
      website: JAVASCRIPT_URL,
    });

    expect(result.success).toBe(false);
  });
});
