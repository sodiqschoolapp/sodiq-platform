import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';

/**
 * The acting teacher of a vacancy's journal (task 5.7a-3c, pull request #190;
 * `edge/timetable`, After publishing, "A vacancy lasts a quarter: who writes
 * the plan and grades?": "The Academic Vice Principal names an acting teacher
 * for the journal for a period"). A period is school dates, half-open:
 * `until` is the first day the person no longer owns the journal, `null`
 * while open-ended (decision 4, review correction 2).
 */
export const actingTeacherBodySchema = z
  .strictObject({
    vacancyId: z.uuid(),
    journalId: z.uuid(),
    personId: z.uuid(),
    from: schoolDateSchema,
    until: schoolDateSchema.optional(),
    /** Decision 5: the person does not teach in the class's language, named on purpose. */
    confirmLanguage: z.literal(true).optional(),
  })
  // Review correction 1: an empty period is made only by the withdraw.
  .refine((one) => one.until === undefined || one.until > one.from, {
    path: ['until'],
    message: 'acting_until',
  });

export type ActingTeacherBody = z.infer<typeof actingTeacherBodySchema>;

/** The end of a period: the first day the person no longer owns the journal; its start withdraws a planned one. */
export const actingTeacherEndSchema = z.strictObject({ until: schoolDateSchema });

export type ActingTeacherEnd = z.infer<typeof actingTeacherEndSchema>;

export const actingTeacherParamsSchema = z.strictObject({ id: z.uuid() });

export type ActingTeacherParams = z.infer<typeof actingTeacherParamsSchema>;

/** Why a person cannot be named, as the check answers it (decision 5). */
export const ACTING_PROBLEMS = [
  'acting_not_vacancy',
  'acting_person',
  'acting_profile',
  'acting_start_past',
  'acting_overlap',
] as const;

export const actingProblemSchema = z.enum(ACTING_PROBLEMS);

/** The check of a naming, written nowhere: what refuses it and whether the language asks a confirmation. */
export const actingTeacherCheckSchema = z.object({
  problems: z.array(actingProblemSchema),
  language: z.boolean(),
});

export type ActingTeacherCheck = z.infer<typeof actingTeacherCheckSchema>;

/** The state of a period on today. */
export const ACTING_STATES = ['planned', 'current', 'ended', 'withdrawn'] as const;

/** A period as the vacancy's record and the routes answer it. */
export const actingTeacherSchema = z.object({
  id: z.uuid(),
  journalId: z.uuid(),
  person: z.object({ id: z.uuid(), name: z.string() }),
  from: schoolDateSchema,
  /** As typed or ended: the first day the person no longer owns the journal. */
  until: schoolDateSchema.nullable(),
  /**
   * Decision 2: the first day on or after `from`, before `until`, on which
   * the journal's row in the published version in force no longer names the
   * vacancy (the fill date, when a fill made it so); `null` for none.
   */
  endsOn: schoolDateSchema.nullable(),
  state: z.enum(ACTING_STATES),
  canEnd: z.boolean(),
  canWithdraw: z.boolean(),
});

export type ActingTeacher = z.infer<typeof actingTeacherSchema>;

/** A journal of a vacancy with its periods, on the vacancy's record. */
export const vacancyJournalSchema = z.object({
  id: z.uuid(),
  classId: z.uuid().nullable(),
  groupId: z.uuid().nullable(),
  subjectId: z.uuid(),
  /** The runs from today on which the published rows name the vacancy, half-open (`until` `null`: to the year's end). */
  runs: z.array(z.object({ from: schoolDateSchema, until: schoolDateSchema.nullable() })),
  acting: z.array(actingTeacherSchema),
});

export type VacancyJournal = z.infer<typeof vacancyJournalSchema>;
