/**
 * Pure Zod schema tests for actionSchema and actionSchemaBase cross-field validations.
 * No mocks needed — these run against the real validation logic.
 */
import { describe, it, expect } from 'vitest';
import { actionSchema, actionSchemaBase } from '@/lib/validations/campaign';

const baseValid = {
  title: 'Valid Action Title',
  type: 'EVENT' as const,
  dueDate: new Date().toISOString(),
  campaignId: 'campaign-1',
};

describe('actionSchemaBase — core field validation', () => {
  it('accepts a minimal valid EVENT action', () => {
    const result = actionSchemaBase.safeParse(baseValid);
    expect(result.success).toBe(true);
  });

  it('rejects title shorter than 3 characters', () => {
    const result = actionSchemaBase.safeParse({ ...baseValid, title: 'Hi' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid action type', () => {
    const result = actionSchemaBase.safeParse({ ...baseValid, type: 'INVALID' });
    expect(result.success).toBe(false);
  });

  it('rejects emailSubject containing a newline', () => {
    const result = actionSchemaBase.safeParse({
      ...baseValid,
      type: 'EMAIL',
      emailSubject: 'Subject line\nSecond line',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const emailSubjectIssue = result.error.issues.find((i) => i.path.includes('emailSubject'));
      expect(emailSubjectIssue).toBeDefined();
    }
  });

  it('rejects emailSubject containing a carriage return', () => {
    const result = actionSchemaBase.safeParse({
      ...baseValid,
      type: 'EMAIL',
      emailSubject: 'Subject\r\nInjection',
    });
    expect(result.success).toBe(false);
  });

  it('accepts emailSubject without newlines', () => {
    const result = actionSchemaBase.safeParse({
      ...baseValid,
      type: 'EMAIL',
      emailSubject: 'A perfectly normal single-line subject',
    });
    expect(result.success).toBe(true);
  });

  it('rejects javascript: URL in graphics array', () => {
    const result = actionSchemaBase.safeParse({
      ...baseValid,
      // eslint-disable-next-line no-script-url
      graphics: ['javascript:alert(1)'],
    });
    expect(result.success).toBe(false);
  });

  it('accepts https:// URL in graphics array', () => {
    const result = actionSchemaBase.safeParse({
      ...baseValid,
      graphics: ['https://example.com/image.jpg'],
    });
    expect(result.success).toBe(true);
  });
});

describe('actionSchema — cross-field superRefine validations', () => {
  it('accepts a valid EVENT action without targeting fields', () => {
    const result = actionSchema.safeParse(baseValid);
    expect(result.success).toBe(true);
  });

  it('accepts a valid PHONE action with callScript', () => {
    const result = actionSchema.safeParse({
      ...baseValid,
      type: 'PHONE',
      callScript: 'Ask them to vote yes on SB 100.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid EMAIL action with emailSubject and emailBody', () => {
    const result = actionSchema.safeParse({
      ...baseValid,
      type: 'EMAIL',
      emailSubject: 'Support the Climate Bill',
      emailBody: 'Dear Representative...',
      emailTargets: ['rep@house.gov'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid CANVASS action with canvassArea', () => {
    const result = actionSchema.safeParse({
      ...baseValid,
      type: 'CANVASS',
      canvassArea: 'Downtown District',
    });
    expect(result.success).toBe(true);
  });

  // targetMode on non-support types
  it('rejects targetMode on EVENT type', () => {
    const result = actionSchema.safeParse({
      ...baseValid,
      type: 'EVENT',
      targetMode: 'CIVIC',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('targetMode'));
      expect(issue?.message).toMatch(/email or phone/i);
    }
  });

  it('rejects targetMode on CANVASS type', () => {
    const result = actionSchema.safeParse({
      ...baseValid,
      type: 'CANVASS',
      targetMode: 'MANUAL',
      manualTargets: [{ name: 'Someone', phone: '555-1234' }],
    });
    expect(result.success).toBe(false);
  });

  // CIVIC targeting requirements
  it('rejects CIVIC targetMode without targetLevel for EMAIL', () => {
    const result = actionSchema.safeParse({
      ...baseValid,
      type: 'EMAIL',
      emailSubject: 'Subject',
      emailBody: 'Body',
      targetMode: 'CIVIC',
      // targetLevel intentionally omitted
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('targetLevel'));
      expect(issue?.message).toMatch(/target level/i);
    }
  });

  it('accepts CIVIC targetMode with targetLevel for PHONE', () => {
    const result = actionSchema.safeParse({
      ...baseValid,
      type: 'PHONE',
      targetMode: 'CIVIC',
      targetLevel: 'FEDERAL',
    });
    expect(result.success).toBe(true);
  });

  // MANUAL targeting requirements
  it('rejects MANUAL targetMode when manualTargets is empty for EMAIL', () => {
    const result = actionSchema.safeParse({
      ...baseValid,
      type: 'EMAIL',
      targetMode: 'MANUAL',
      manualTargets: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('manualTargets'));
      expect(issue?.message).toMatch(/at least one/i);
    }
  });

  it('rejects MANUAL EMAIL targetMode when manualTargets lack email field', () => {
    const result = actionSchema.safeParse({
      ...baseValid,
      type: 'EMAIL',
      targetMode: 'MANUAL',
      manualTargets: [
        { name: 'Rep Jones' }, // missing email
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('manualTargets'));
      expect(issue?.message).toMatch(/email address/i);
    }
  });

  it('accepts MANUAL EMAIL targetMode when manualTargets have email fields', () => {
    const result = actionSchema.safeParse({
      ...baseValid,
      type: 'EMAIL',
      targetMode: 'MANUAL',
      manualTargets: [{ name: 'Rep Jones', email: 'jones@house.gov' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects MANUAL PHONE targetMode when manualTargets lack phone field', () => {
    const result = actionSchema.safeParse({
      ...baseValid,
      type: 'PHONE',
      targetMode: 'MANUAL',
      manualTargets: [
        { name: 'Rep Jones' }, // missing phone
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('manualTargets'));
      expect(issue?.message).toMatch(/phone number/i);
    }
  });

  it('accepts MANUAL PHONE targetMode when manualTargets have phone fields', () => {
    const result = actionSchema.safeParse({
      ...baseValid,
      type: 'PHONE',
      targetMode: 'MANUAL',
      manualTargets: [{ name: 'Rep Jones', phone: '555-123-4567' }],
    });
    expect(result.success).toBe(true);
  });

  // BOTH mode
  it('accepts BOTH targetMode with targetLevel and manualTargets for EMAIL', () => {
    const result = actionSchema.safeParse({
      ...baseValid,
      type: 'EMAIL',
      targetMode: 'BOTH',
      targetLevel: 'STATE',
      manualTargets: [{ name: 'Extra Target', email: 'extra@example.com' }],
    });
    expect(result.success).toBe(true);
  });
});
