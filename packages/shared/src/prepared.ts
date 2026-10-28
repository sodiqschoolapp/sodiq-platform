import { z } from 'zod';

/**
 * How fresh the figures of a report are (task 9.3b-1; `edge/system-behaviour`: "Prepared totals
 * for reports show 'updated at'. A page that finds them behind calculates from source and shows
 * 'updating'").
 */
export const preparedStampSchema = z.object({
  /** The oldest preparation the answer used; `null` when it used none. */
  updatedAt: z.iso.datetime().nullable(),
  /** A part was behind and was calculated from source for this answer. */
  updating: z.boolean(),
});

export type PreparedStamp = z.infer<typeof preparedStampSchema>;
