import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { dayDecisionsSchema, publishCheckSchema, transitionKeySchema } from './timetable.js';

/**
 * Filling a vacancy (task 5.7a-3a, pull request #188; docs/spec/06-timetable.md,
 * Changes after publishing: "the Academic Vice Principal fills the vacancy
 * with the person from a date, tomorrow at the earliest, for all of its load
 * rows or the chosen ones"). A row is named by its class or group and its
 * subject, as the carry matches rows across versions (decision 10).
 */
export const vacancyFillRowSchema = z
  .strictObject({
    classId: z.uuid().optional(),
    groupId: z.uuid().optional(),
    subjectId: z.uuid(),
  })
  .refine((one) => (one.classId === undefined) !== (one.groupId === undefined), {
    message: 'class_or_group',
  });

export type VacancyFillRow = z.infer<typeof vacancyFillRowSchema>;

/** The key of a row: its class or group and its subject. */
export const vacancyFillRowKeyOf = (one: {
  readonly classId?: string | null | undefined;
  readonly groupId?: string | null | undefined;
  readonly subjectId: string;
}): string => `${one.classId ?? ''}|${one.groupId ?? ''}|${one.subjectId}`;

/** What the check of a fill takes: the vacancy, the person, the date and the rows (none: all of them). */
export const vacancyFillCheckBodySchema = z.strictObject({
  vacancyId: z.uuid(),
  personId: z.uuid(),
  startsOn: schoolDateSchema,
  rows: z
    .array(vacancyFillRowSchema)
    .min(1)
    .max(200)
    .refine((list) => new Set(list.map(vacancyFillRowKeyOf)).size === list.length, {
      message: 'rows_not_unique',
    })
    .optional(),
});

export type VacancyFillCheckBody = z.infer<typeof vacancyFillCheckBodySchema>;

/**
 * The fill: the check's body and the keys of what the check showed, as a
 * publish sends them (decision 2): the rows (`rowsKey`, spec review of the
 * plan, should-fix 1), the transition week, the later versions, the stored
 * one-day changes and a choice for each "needs a decision" item.
 */
export const vacancyFillBodySchema = vacancyFillCheckBodySchema.extend({
  rowsKey: transitionKeySchema,
  transitionKey: transitionKeySchema.optional(),
  laterKey: transitionKeySchema.optional(),
  dayChangesKey: transitionKeySchema.optional(),
  dayDecisions: dayDecisionsSchema.optional(),
});

export type VacancyFillBody = z.infer<typeof vacancyFillBodySchema>;

/**
 * Why a row stays with the vacancy (decision 3): a blocked date of one of its
 * lessons with the person on it, listed in `dates`, or the person's profile
 * (subject, grades, language).
 */
export const VACANCY_FILL_LEFT_REASONS = ['blocked', 'profile'] as const;

export const vacancyFillRowAnswerSchema = z.object({
  classId: z.uuid().nullable(),
  groupId: z.uuid().nullable(),
  subjectId: z.uuid(),
  filled: z.boolean(),
  reason: z.enum(VACANCY_FILL_LEFT_REASONS).nullable(),
  /** The blocked dates of a row left `blocked`, in order; empty otherwise. */
  dates: z.array(schoolDateSchema),
});

export type VacancyFillRowAnswer = z.infer<typeof vacancyFillRowAnswerSchema>;

/** What still holds the vacancy from the fill date after the fill (decision 5). */
export const vacancyFillHolderSchema = z.object({
  versionId: z.uuid().nullable(),
  versionNumber: z.int().nullable(),
  lessonDate: schoolDateSchema.nullable(),
});

/**
 * The check of a fill, written nowhere: the rows, the key of the rows, the
 * publish's check of what the fill publishes or carries (`null` when no row
 * would be filled), whether the vacancy would close from the date and what
 * would still hold it, and whether the change is carried into a version that
 * starts on the date (`inPlace`, decision 4).
 */
export const vacancyFillCheckSchema = z.object({
  rows: z.array(vacancyFillRowAnswerSchema),
  rowsKey: transitionKeySchema,
  inPlace: z.boolean(),
  publish: publishCheckSchema.nullable(),
  closes: z.boolean(),
  holders: z.array(vacancyFillHolderSchema),
});

export type VacancyFillCheck = z.infer<typeof vacancyFillCheckSchema>;

/** A fill done. */
export const vacancyFillSchema = z.object({
  id: z.uuid(),
  vacancyId: z.uuid(),
  personId: z.uuid(),
  startsOn: schoolDateSchema,
  /** The version the fill published; `null` when it was carried into a version starting on the date. */
  versionId: z.uuid().nullable(),
  rows: z.array(vacancyFillRowAnswerSchema),
  closed: z.boolean(),
  holders: z.array(vacancyFillHolderSchema),
});

export type VacancyFill = z.infer<typeof vacancyFillSchema>;

/** A fill in the vacancy's history (`04`: "its history lists every fill with the date, the person and the rows"). */
export const vacancyFillHistorySchema = z.object({
  id: z.uuid(),
  startsOn: schoolDateSchema,
  person: z.object({ id: z.uuid(), name: z.string() }),
  rows: z.array(
    z.object({ classId: z.uuid().nullable(), groupId: z.uuid().nullable(), subjectId: z.uuid() }),
  ),
  versionNumber: z.int().nullable(),
  /** The version the fill published was withdrawn (decision 11). */
  withdrawn: z.boolean(),
});

export type VacancyFillHistory = z.infer<typeof vacancyFillHistorySchema>;
