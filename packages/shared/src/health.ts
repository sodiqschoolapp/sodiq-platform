import { z } from 'zod';

/** The answer of `GET /api/health`. Unknown fields are dropped. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
