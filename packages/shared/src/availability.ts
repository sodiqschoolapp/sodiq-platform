import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { minutesOf, timeOfDaySchema } from './day-templates.js';
import { weekdaySchema } from './setup.js';

/**
 * Availability of a staff record per branch (docs/spec/04-people.md,
 * Availability; 06, Teachers who work in several branches; task 2.2b, pull
 * request #57). An entry is the whole week of one branch from a date (owner's
 * answer 10; decision 2): time ranges per weekday, half-open, as minutes after
 * midnight in the database (db/migrations/0025) and `HH:MM` here. An entry
 * with no ranges means no hours in that branch from its date.
 */

/** The most ranges one entry may hold: a few per weekday. */
export const AVAILABILITY_RANGES_MAX = 35;

/** The end of a range: `HH:MM`, 00:01 to 24:00. */
export const rangeEndSchema = z
  .string()
  .trim()
  .regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, { message: 'A time as HH:MM.' });

export const availabilityRangeSchema = z
  .object({
    weekday: weekdaySchema,
    start: timeOfDaySchema,
    end: rangeEndSchema,
  })
  .refine((range) => minutesOf(range.end) > minutesOf(range.start), {
    path: ['end'],
    message: 'The end comes after the start.',
  });

export type AvailabilityRange = z.infer<typeof availabilityRangeSchema>;

/** Whether two ranges share a minute of one weekday; touching ranges do not. */
export function rangesOverlap(a: AvailabilityRange, b: AvailabilityRange): boolean {
  return (
    a.weekday === b.weekday &&
    minutesOf(a.start) < minutesOf(b.end) &&
    minutesOf(b.start) < minutesOf(a.end)
  );
}

/** A new entry from a date (`PUT /api/people/staff/:id/availability`). */
export const availabilitySetSchema = z.object({
  from: schoolDateSchema,
  ranges: z
    .array(availabilityRangeSchema)
    .max(AVAILABILITY_RANGES_MAX)
    .superRefine((ranges, context) => {
      ranges.forEach((range, index) => {
        if (ranges.slice(0, index).some((earlier) => rangesOverlap(earlier, range))) {
          context.addIssue({
            code: 'custom',
            path: [index, 'start'],
            message: 'Ranges of one weekday do not overlap.',
          });
        }
      });
    }),
});

export type AvailabilitySet = z.infer<typeof availabilitySetSchema>;

/** An entry as answered; `until` is `null` while open. */
export const availabilityEntrySchema = z.object({
  id: z.uuid(),
  from: schoolDateSchema,
  until: schoolDateSchema.nullable(),
  ranges: z.array(availabilityRangeSchema),
});

export type AvailabilityEntry = z.infer<typeof availabilityEntrySchema>;

/** The hours of a record: the branch of the request, and the other branches read only. */
export const availabilitySchema = z.object({
  entries: z.array(availabilityEntrySchema),
  elsewhere: z.array(
    z.object({
      branchId: z.uuid(),
      name: z.string(),
      entries: z.array(availabilityEntrySchema),
    }),
  ),
  /** Today in the time zone of the branch of the request. */
  today: schoolDateSchema,
  /** The first date a new entry may start from (decision 4). */
  earliestFrom: schoolDateSchema,
});

export type Availability = z.infer<typeof availabilitySchema>;
