import { z } from 'zod';

const httpUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
    message: 'URL must start with http:// or https://',
  });
const httpUrlOptional = httpUrl.optional().nullable();
const actionTargetMode = z.enum(['CIVIC', 'MANUAL', 'BOTH']);
const actionTargetLevel = z.enum(['LOCAL', 'STATE', 'FEDERAL']);
const manualTargetSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
});

export const campaignSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(100),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  type: z.enum(['LEGISLATIVE', 'FISCAL', 'CRIMINAL_JUSTICE', 'ELECTORAL', 'COMMUNITY', 'OTHER']),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']).optional(),
  imageUrl: httpUrlOptional,
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  causeId: z.string().min(1, 'Please select a cause'),
  orgId: z.string().min(1, 'Organization is required'),
});

export const actionSchemaBase = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(100),
  description: z.string().optional().nullable(),
  type: z.enum(['EVENT', 'PHONE', 'EMAIL', 'CANVASS']),
  dueDate: z.string().datetime(),
  campaignId: z.string().min(1, 'Campaign is required'),

  // EVENT fields
  location: z.string().optional().nullable(),
  eventTime: z.string().datetime().optional().nullable(),
  eventEndTime: z.string().datetime().optional().nullable(),
  locationUrl: httpUrlOptional,

  // PHONE fields
  callScript: z.string().optional().nullable(),
  phoneNumbers: z.array(z.string()).optional(),

  // EMAIL fields
  emailSubject: z
    .string()
    .optional()
    .nullable()
    .refine((value) => !value || !/[\r\n]/.test(value), {
      message: 'Email subject must be a single line',
    }),
  emailBody: z.string().optional().nullable(),
  emailTargets: z.array(z.string().email()).optional(),

  // CANVASS fields
  canvassArea: z.string().optional().nullable(),
  canvassTurf: z.any().optional().nullable(),
  ecanvasserCampaignId: z.string().optional().nullable(),

  // Shareable content
  graphics: z.array(httpUrl).optional(),
  shareText: z.string().optional().nullable(),
  // Support targeting (PHONE/EMAIL)
  targetMode: actionTargetMode.optional().nullable(),
  targetLevel: actionTargetLevel.optional().nullable(),
  targetOffices: z.array(z.string()).optional(),
  manualTargets: z.array(manualTargetSchema).optional(),
});

export const actionSchema = actionSchemaBase.superRefine((data, ctx) => {
  const isSupportType = data.type === 'EMAIL' || data.type === 'PHONE';
  if (
    !isSupportType &&
    (data.targetMode || data.targetLevel || data.targetOffices?.length || data.manualTargets?.length)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetMode'],
      message: 'Support targeting is only available for email or phone actions.',
    });
    return;
  }

  if (!isSupportType) return;

  const civicEnabled = data.targetMode === 'CIVIC' || data.targetMode === 'BOTH';
  const manualEnabled = data.targetMode === 'MANUAL' || data.targetMode === 'BOTH';

  if (civicEnabled) {
    if (!data.targetLevel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetLevel'],
        message: 'Target level is required for civic targeting.',
      });
    }
  }

  if (manualEnabled) {
    if (!data.manualTargets || data.manualTargets.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['manualTargets'],
        message: 'Add at least one manual target.',
      });
      return;
    }

    if (data.type === 'EMAIL') {
      const missingEmail = data.manualTargets.find((target) => !target.email);
      if (missingEmail) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['manualTargets'],
          message: 'Each manual email target needs an email address.',
        });
      }
    }

    if (data.type === 'PHONE') {
      const missingPhone = data.manualTargets.find((target) => !target.phone);
      if (missingPhone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['manualTargets'],
          message: 'Each manual call target needs a phone number.',
        });
      }
    }
  }
});

export type CampaignSchema = z.infer<typeof campaignSchema>;
export type ActionSchema = z.infer<typeof actionSchema>;
