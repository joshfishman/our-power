import { z } from 'zod';

export const campaignSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(100),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  type: z.enum(['LEGISLATIVE', 'FISCAL', 'CRIMINAL_JUSTICE', 'ELECTORAL', 'COMMUNITY', 'OTHER']),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']).optional(),
  imageUrl: z.string().url().optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  causeId: z.string().min(1, 'Please select a cause'),
  orgId: z.string().min(1, 'Organization is required'),
});

export const actionSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(100),
  description: z.string().optional().nullable(),
  type: z.enum(['EVENT', 'PHONE', 'EMAIL', 'CANVASS']),
  dueDate: z.string().datetime(),
  campaignId: z.string().min(1, 'Campaign is required'),

  // EVENT fields
  location: z.string().optional().nullable(),
  eventTime: z.string().datetime().optional().nullable(),
  eventEndTime: z.string().datetime().optional().nullable(),
  locationUrl: z.string().url().optional().nullable(),

  // PHONE fields
  callScript: z.string().optional().nullable(),
  phoneNumbers: z.array(z.string()).optional(),
  dialerUrl: z.string().url().optional().nullable(),

  // EMAIL fields
  emailSubject: z.string().optional().nullable(),
  emailBody: z.string().optional().nullable(),
  emailTargets: z.array(z.string().email()).optional(),

  // CANVASS fields
  canvassArea: z.string().optional().nullable(),
  canvassTurf: z.any().optional().nullable(),
  ecanvasserCampaignId: z.string().optional().nullable(),

  // Shareable content
  graphics: z.array(z.string().url()).optional(),
  shareText: z.string().optional().nullable(),
});

export type CampaignSchema = z.infer<typeof campaignSchema>;
export type ActionSchema = z.infer<typeof actionSchema>;
