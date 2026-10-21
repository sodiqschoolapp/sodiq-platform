import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { DAY_CHANGE_REASON_MAX, SUBSTITUTE_GROUPS } from './day-changes.js';

/**
 * The substitution per journal (task 5.7b-2, pull request #192;
 * docs/spec/06-timetable.md, Changes after publishing: "Substitution. ... It
 * can be started from a single lesson (pick a substitute for it) or from a
 * teacher (mark them absent for one or more dates). In the second case the
 * system lists all their lessons in the period and, for each, suggests
 * teachers who are free in that slot"; edge-cases/timetable.md, After
 * publishing: "One substitute can be assigned per journal for the whole
 * absence in one action, each date still being checked.").
 *
 * The same action is offered for a vacancy's journal over a period, with its
 * acting teacher in force (task 5.7a-3c From line; edge-cases/timetable.md:
 * "substitutes are arranged as for an open-ended absence").
 */

const reason = z.string().trim().min(1).max(DAY_CHANGE_REASON_MAX);

/** The absence's per-journal action. `confirm` ticks the warnings a save answered by date. */
export const absenceJournalSubstituteBodySchema = z.strictObject({
  journalId: z.uuid(),
  teacherId: z.uuid(),
  reason,
  confirm: z.boolean().optional(),
});

export type AbsenceJournalSubstituteBody = z.infer<typeof absenceJournalSubstituteBodySchema>;

/** The period of a vacancy's journal: from a day (not before today), to the first day after it (`null`: open-ended). */
const vacancyPeriod = {
  from: schoolDateSchema,
  until: schoolDateSchema.nullable().optional(),
};

const periodOrdered = (body: { from: string; until?: string | null | undefined }) =>
  body.until === undefined || body.until === null || body.until > body.from;

/** A vacancy's per-journal action over a period (decision 7). */
export const vacancyJournalSubstituteBodySchema = z
  .strictObject({
    journalId: z.uuid(),
    teacherId: z.uuid(),
    ...vacancyPeriod,
    reason,
    confirm: z.boolean().optional(),
  })
  .refine(periodOrdered, { path: ['until'], message: 'The period ends after it starts.' });

export type VacancyJournalSubstituteBody = z.infer<typeof vacancyJournalSubstituteBodySchema>;

export const absenceJournalParamsSchema = z.object({ id: z.uuid(), journalId: z.uuid() });

export type AbsenceJournalParams = z.infer<typeof absenceJournalParamsSchema>;

export const vacancyJournalParamsSchema = absenceJournalParamsSchema;

export type VacancyJournalParams = AbsenceJournalParams;

/** The period of the vacancy's suggestions. */
export const vacancyJournalSubstitutesQuerySchema = z
  .object(vacancyPeriod)
  .refine(periodOrdered, { path: ['until'], message: 'The period ends after it starts.' });

export type VacancyJournalSubstitutesQuery = z.infer<typeof vacancyJournalSubstitutesQuerySchema>;

/**
 * The suggested substitutes for every lesson of the journal in the run
 * (decision 11), in the order of a lesson's suggestions (subject, the
 * subject's department, the others; language last and marked): each with
 * the dates it can take and those it cannot. A teacher who can take no date
 * is not listed. `acting`: the vacancy's acting teacher in force on the
 * first day (decision 7).
 */
export const journalSubstitutesAnswerSchema = z.object({
  /** The dates of the run that a save would try: lessons not started and not substituted. */
  dates: z.array(schoolDateSchema),
  teachers: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      group: z.enum(SUBSTITUTE_GROUPS),
      language: z.boolean(),
      acting: z.boolean(),
      dates: z.array(schoolDateSchema),
      blockedDates: z.array(schoolDateSchema),
    }),
  ),
});

export type JournalSubstitutesAnswer = z.infer<typeof journalSubstitutesAnswerSchema>;

/**
 * What a per-journal action did (decisions 5 and 6): the lessons saved
 * (each with whether it was saved under the exception "no teacher of the
 * subject is free"), the dates blocked with their rules, and the lessons
 * already substituted and left as they are.
 */
export const journalSubstituteAnswerSchema = z.object({
  substitutionId: z.uuid(),
  saved: z.array(z.object({ lessonId: z.uuid(), date: schoolDateSchema, relaxed: z.boolean() })),
  blocked: z.array(
    z.object({
      lessonIds: z.array(z.uuid()),
      date: schoolDateSchema,
      rules: z.array(z.string().regex(/^[a-z_]+$/)),
    }),
  ),
  taken: z.array(z.object({ lessonId: z.uuid(), date: schoolDateSchema })),
});

export type JournalSubstituteAnswer = z.infer<typeof journalSubstituteAnswerSchema>;
