import { z } from 'zod';

export const locationSchema = z.object({
  zipCode: z
    .string()
    .min(5, 'Zip code must be at least 5 characters')
    .max(10, 'Zip code must be at most 10 characters')
    .regex(/^\d{5}(-\d{4})?$/, 'Please enter a valid US zip code'),
  streetAddress: z.string().optional().nullable(),
});

export const causesSchema = z.object({
  causeIds: z.array(z.string()).min(4, 'Please select at least 4 causes that matter to you'),
});

export const onboardingSchema = locationSchema.merge(causesSchema);

export type LocationSchema = z.infer<typeof locationSchema>;
export type CausesSchema = z.infer<typeof causesSchema>;
export type OnboardingSchema = z.infer<typeof onboardingSchema>;
