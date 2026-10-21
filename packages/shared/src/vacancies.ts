import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { instructionLanguageSchema } from './settings.js';
import { DAILY_LESSONS_MAX, WEEKLY_LESSONS_MAX } from './staff.js';
import { subjectGradesSchema } from './subjects.js';
import { vacancyJournalSchema } from './acting-teachers.js';
import { vacancyFillHistorySchema, vacancyFillUnitSchema } from './vacancy-fills.js';

/**
 * Vacancies (docs/spec/04-people.md, Vacancy; task 2.2b, pull request #57): a
 * staff record that stands for a teacher not yet hired, with a name, one
 * branch, the Academic division and one department, subjects with the grades
 * taught, languages of instruction, availability and contract load, and
 * nothing personal. The database keeps the same bounds (db/migrations/0024,
 * `staff_vacancy_check`); a test compares them.
 */

/** The check of `vacancy_name` in db/migrations/0024. */
export const VACANCY_NAME_MAX_LENGTH = 100;

/** `04`: "Status: open or closed". */
export const VACANCY_STATUSES = ['open', 'closed'] as const;

export const vacancyStatusSchema = z.enum(VACANCY_STATUSES);

export type VacancyStatus = z.infer<typeof vacancyStatusSchema>;

export const vacancyNameSchema = z.string().trim().min(1).max(VACANCY_NAME_MAX_LENGTH);

/**
 * What is typed for a vacancy, as the create and the edit take it: the
 * bounds of a person's teaching (`staffTeachingSchema`) and contract load.
 */
export const vacancyRecordSchema = z
  .object({
    name: vacancyNameSchema,
    departmentId: z.uuid(),
    subjects: z
      .array(z.object({ subjectId: z.uuid(), grades: subjectGradesSchema }))
      .max(30)
      .refine((rows) => new Set(rows.map((row) => row.subjectId)).size === rows.length, {
        message: 'Each subject once.',
      }),
    languages: z
      .array(instructionLanguageSchema)
      .max(2)
      .refine((languages) => new Set(languages).size === languages.length, {
        message: 'Each language once.',
      }),
    weeklyLessons: z.int().min(1).max(WEEKLY_LESSONS_MAX).nullable(),
    dailyLessons: z.int().min(1).max(DAILY_LESSONS_MAX).nullable(),
  })
  .refine((vacancy) => vacancy.subjects.length === 0 || vacancy.languages.length > 0, {
    path: ['languages'],
    message: 'A language of instruction once there is a subject.',
  });

export type VacancyRecord = z.infer<typeof vacancyRecordSchema>;

/** A row of the status history. */
export const vacancyStatusRowSchema = z.object({
  id: z.uuid(),
  status: vacancyStatusSchema,
  from: schoolDateSchema,
  until: schoolDateSchema.nullable(),
});

export type VacancyStatusRow = z.infer<typeof vacancyStatusRowSchema>;

/** A vacancy as the list answers it. */
export const vacancyListItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  departmentId: z.uuid(),
  subjects: z.array(z.object({ subjectId: z.uuid(), grades: z.array(z.int()) })),
  languages: z.array(instructionLanguageSchema),
  weeklyLessons: z.int().nullable(),
  dailyLessons: z.int().nullable(),
  /** The status in force today in the branch's time zone. */
  status: vacancyStatusSchema,
  /**
   * Task 5.7a-3b: the first day of a close planned from a day after today (a
   * live `closed` status row; the empty row of a cancelled plan is skipped),
   * or `null`.
   */
  closesOn: schoolDateSchema.nullable(),
});

export type VacancyListItem = z.infer<typeof vacancyListItemSchema>;

export const vacancyListSchema = z.object({
  vacancies: z.array(vacancyListItemSchema),
  /** Today in the time zone of the branch of the request. */
  today: schoolDateSchema,
});

export type VacancyList = z.infer<typeof vacancyListSchema>;

/** A vacancy as the record route answers it. */
export const vacancyDetailSchema = vacancyListItemSchema.extend({
  statuses: z.array(vacancyStatusRowSchema),
  /** Task 5.7a-3a: every fill, newest first. */
  fills: z.array(vacancyFillHistorySchema),
  /** Task 5.7a-3b: the classes and groups the rows of `fills` name, archived ones included. */
  fillUnits: z.array(vacancyFillUnitSchema),
  /**
   * Task 5.7a-3c: the journals whose published rows name the vacancy from
   * today, with their acting teachers; their classes and groups are in
   * `fillUnits` too.
   */
  journals: z.array(vacancyJournalSchema),
  today: schoolDateSchema,
});

export type VacancyDetail = z.infer<typeof vacancyDetailSchema>;

export const vacancyParamsSchema = z.object({ id: z.uuid() });

export type VacancyParams = z.infer<typeof vacancyParamsSchema>;
