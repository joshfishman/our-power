import { z } from 'zod';

export const organizationSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  description: z.string().optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
  website: z.string().url().optional().nullable(),
});

export const addManagerSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  userEmail: z.string().email('Valid email is required'),
});

export type OrganizationSchema = z.infer<typeof organizationSchema>;
export type AddManagerSchema = z.infer<typeof addManagerSchema>;
