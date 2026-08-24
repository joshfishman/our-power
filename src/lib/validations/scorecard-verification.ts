import { z } from 'zod';
import { MAX_BULK_REVIEW } from '@/lib/scorecard/verification';

const httpUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
    message: 'Citation URL must start with http:// or https://',
  });

/**
 * Body of `POST /api/admin/scorecard/verify`.
 *
 * One endpoint serves both the single-row action and the bulk action, so the
 * server-side rules cannot diverge between them. Bulk is made deliberate
 * rather than one careless click by `bulkConfirmation`: the client must echo
 * back the exact number of rows it intends to act on, and the count must match
 * the ids actually submitted.
 */
export const reviewAchievementsSchema = z
  .object({
    achievementIds: z
      .array(z.string().min(1))
      .min(1, 'Select at least one achievement')
      .max(MAX_BULK_REVIEW, `A single action may cover at most ${MAX_BULK_REVIEW} achievements`),
    action: z.enum(['VERIFY', 'REJECT', 'REVOKE']),
    citationUrl: httpUrl.optional().nullable(),
    note: z.string().trim().min(1).max(2000).optional().nullable(),
    /** Must equal `achievementIds.length` whenever more than one row is targeted. */
    bulkConfirmation: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    const unique = new Set(value.achievementIds);
    if (unique.size !== value.achievementIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['achievementIds'],
        message: 'Duplicate achievement ids',
      });
    }

    if (value.action === 'VERIFY' && !value.citationUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['citationUrl'],
        message: 'Paste the source URL you opened before verifying',
      });
    }

    if ((value.action === 'REJECT' || value.action === 'REVOKE') && !value.note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'A written reason is required',
      });
    }

    if (value.achievementIds.length > 1) {
      if (value.bulkConfirmation !== value.achievementIds.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['bulkConfirmation'],
          message: 'Confirm the exact number of achievements this bulk action will change',
        });
      }
      if (!value.note) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['note'],
          message: 'Bulk actions require a note explaining why the batch is mechanical',
        });
      }
    }
  });

export type ReviewAchievementsInput = z.infer<typeof reviewAchievementsSchema>;

/** Query params for `GET /api/admin/scorecard/verify` and the queue page. */
export const verificationQueueQuerySchema = z.object({
  tier: z.enum(['RED', 'YELLOW', 'GREEN', 'REJECTED', 'ALL']).default('RED'),
  jurisdiction: z.enum(['FEDERAL', 'CA']).optional(),
  plank: z.coerce.number().int().min(1).max(5).optional(),
  legislatorId: z.string().min(1).optional(),
  /** Narrow to a single achievement — used by the single-item evidence route. */
  achievementId: z.string().min(1).max(64).optional(),
  markerType: z.enum(['PRIMARY', 'SECONDARY']).optional(),
  sort: z.enum(['oldest', 'newest', 'legislator', 'plank']).default('oldest'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type VerificationQueueQuery = z.infer<typeof verificationQueueQuerySchema>;
