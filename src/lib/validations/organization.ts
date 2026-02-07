import { z } from 'zod';

const httpUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
    message: 'URL must start with http:// or https://',
  });
const httpUrlOptional = httpUrl.optional().nullable();

export const organizationSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  description: z.string().optional().nullable(),
  logoUrl: httpUrlOptional,
  website: httpUrlOptional,
});

export const addManagerSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  userEmail: z.string().email('Valid email is required'),
});

export type OrganizationSchema = z.infer<typeof organizationSchema>;
export type AddManagerSchema = z.infer<typeof addManagerSchema>;
