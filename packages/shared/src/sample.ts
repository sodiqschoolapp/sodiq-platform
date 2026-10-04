import { z } from 'zod';

/**
 * The record of the sample form (task 0.8b-2, `/dev/patterns` of the web app).
 * For development only: no route takes it. It lives here because a form checks
 * its fields with the schema the server would use.
 */
export const sampleRecordSchema = z.object({
  name: z.string().trim().min(2).max(100),
  className: z.string().trim().min(1).max(40),
  grade: z.number().int().min(1).max(11),
  language: z.enum(['uz', 'ru']),
  /** Nothing for a record without a score. */
  score: z.number().int().min(0).max(100).nullable(),
});

export type SampleRecord = z.infer<typeof sampleRecordSchema>;
