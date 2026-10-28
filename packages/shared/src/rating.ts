import { z } from 'zod';
import { preparedStampSchema } from './prepared.js';
import { schoolDateSchema } from './academic-year.js';
import { journalSubjectSchema, journalUnitSchema } from './journal.js';
import { RESULT_FLAGS } from './results.js';
import { instructionLanguageSchema } from './settings.js';

/**
 * The rating (task 9.3a; `08`, Rating; `07`, Effect on totals, Rating; `edge/calculation`, "Two
 * students both show 84", "One student has 9 subjects, another 11"). Worked out on read through
 * `packages/calc` (`ratingPlaces`, `oneDecimal`, `subjectsFigure`, `classFigure`), for one
 * quarter of the branch of the request:
 *
 * - `GET /api/results/rating/choices?yearId=`: the years, quarters and lists the reader may open;
 * - `GET /api/results/rating/subject?quarterId=&journalId=`: the students of a class or group in
 *   one subject, by quarter result;
 * - `GET /api/results/rating/class?quarterId=&classId=`: the students of a class across all
 *   subjects, by the mean of their quarter results;
 * - `GET /api/results/rating/classes?quarterId=&grade=&language=`: the classes of a grade or of
 *   the branch, by the mean result of their students;
 * - `POST /api/results/rating/export`: one of the three lists as an Excel file.
 *
 * Figures are in tenths (`edge/calculation`: "Rating lists show one decimal"); places are shared
 * only by exactly equal values (1, 1, 3). Only a number is ranked: a student without one is
 * listed after the ranked rows with no place (plan decision 6); a student with a result at
 * leaving is left out.
 */

export const RATING_KINDS = ['subject', 'class', 'classes'] as const;

export type RatingKind = (typeof RATING_KINDS)[number];

export const ratingChoicesQuerySchema = z.object({
  /** The academic year; when left out, the current one, else the newest that has started. */
  yearId: z.uuid().optional(),
});

export type RatingChoicesQuery = z.infer<typeof ratingChoicesQuerySchema>;

export const ratingSubjectQuerySchema = z.object({
  quarterId: z.uuid(),
  journalId: z.uuid(),
});

export type RatingSubjectQuery = z.infer<typeof ratingSubjectQuerySchema>;

export const ratingClassQuerySchema = z.object({
  quarterId: z.uuid(),
  classId: z.uuid(),
});

export type RatingClassQuery = z.infer<typeof ratingClassQuerySchema>;

/** A grade of the school (`05`: grades 1 to 11), sent as text in a query. */
const gradeQuerySchema = z.coerce.number().int().min(1).max(11);

export const ratingClassesQuerySchema = z.object({
  quarterId: z.uuid(),
  /** Left out: every class of the branch. */
  grade: gradeQuerySchema.optional(),
  /** `05`, Reports: "Language is a filter in class lists, results, rating and analytics". */
  language: instructionLanguageSchema.optional(),
});

export type RatingClassesQuery = z.infer<typeof ratingClassesQuerySchema>;

export const ratingExportSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('subject'), quarterId: z.uuid(), journalId: z.uuid() }),
  z.strictObject({ kind: z.literal('class'), quarterId: z.uuid(), classId: z.uuid() }),
  z.strictObject({
    kind: z.literal('classes'),
    quarterId: z.uuid(),
    grade: z.int().min(1).max(11).optional(),
    language: instructionLanguageSchema.optional(),
  }),
]);

export type RatingExport = z.infer<typeof ratingExportSchema>;

const ratingYearSchema = z.object({
  id: z.uuid(),
  startDate: schoolDateSchema,
  endDate: schoolDateSchema,
  status: z.enum(['planned', 'current', 'closed']),
});

const ratingQuarterSchema = z.object({
  id: z.uuid(),
  number: z.int().min(1).max(4),
  startDate: schoolDateSchema,
  endDate: schoolDateSchema,
  /** The quarter has a close in force; its figures are the stored final results. */
  closed: z.boolean(),
  /** Task 9.2b: the start quarter closed "not official" (plan decision 10). */
  notOfficial: z.boolean(),
});

const ratingClassSchema = z.object({
  id: z.uuid(),
  /** The class shown with its grade ("7 Oxford"). */
  name: z.string(),
  grade: z.int().min(1).max(11),
  language: instructionLanguageSchema,
});

export type RatingClass = z.infer<typeof ratingClassSchema>;

const ratingJournalSchema = z.object({
  id: z.uuid(),
  subject: journalSubjectSchema,
  unit: journalUnitSchema,
  /** The grades of the class, or of the classes the group draws from. */
  grades: z.array(z.int().min(1).max(11)),
  language: instructionLanguageSchema,
});

export type RatingJournal = z.infer<typeof ratingJournalSchema>;

export const ratingChoicesSchema = z.object({
  /** `null` when the branch has no year to show. */
  year: ratingYearSchema.nullable(),
  years: z.array(ratingYearSchema),
  /** The quarters of the year that have started. */
  quarters: z.array(ratingQuarterSchema),
  /** The graded journals the reader may rank in one subject, in the year. */
  journals: z.array(ratingJournalSchema),
  /** The classes the reader may rank across all subjects. */
  classes: z.array(ratingClassSchema),
  /** The reader may open the list of classes (management). */
  classesList: z.boolean(),
});

export type RatingChoices = z.infer<typeof ratingChoicesSchema>;

/** A result state that is not a number (`edge/00-definitions`, Result states). */
export const RATING_STATES = ['number', 'exempt', 'not_assessed', 'no_result'] as const;

export type RatingState = (typeof RATING_STATES)[number];

const ratingStudentSchema = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  paternalName: z.string().nullable(),
});

/** The figure in tenths (843 is 84.3), `null` without a number. */
const tenthsSchema = z.int().min(0).max(1000).nullable();

/** What a list says of its quarter: provisional while open (`08`), "not official" (9.2b). */
const ratingStateOfListSchema = z.object({
  quarter: ratingQuarterSchema,
  /** Task 9.3b-1: the prepared totals the list was read from. */
  prepared: preparedStampSchema,
  provisional: z.boolean(),
  /** The close in force the figures were read from; `null` while provisional. */
  final: z.object({ closedAt: z.iso.datetime(), version: z.int().min(1) }).nullable(),
});

export const ratingSubjectListSchema = ratingStateOfListSchema.extend({
  journal: ratingJournalSchema,
  rows: z.array(
    z.object({
      student: ratingStudentSchema,
      /** `null` for a student without a number. */
      place: z.int().min(1).nullable(),
      value: tenthsSchema,
      state: z.enum(RATING_STATES),
      /** The flags still to be decided at closing (plan decision 5). */
      flags: z.array(z.enum(RESULT_FLAGS)),
      leftSubjectOn: schoolDateSchema.nullable(),
    }),
  ),
});

export type RatingSubjectList = z.infer<typeof ratingSubjectListSchema>;

export const ratingClassListSchema = ratingStateOfListSchema.extend({
  class: ratingClassSchema,
  rows: z.array(
    z.object({
      student: ratingStudentSchema,
      place: z.int().min(1).nullable(),
      value: tenthsSchema,
      /** The subjects with a number. */
      subjects: z.int().min(0),
      /** `07`: "the student is marked as having fewer subjects". */
      fewerSubjects: z.boolean(),
    }),
  ),
});

export type RatingClassList = z.infer<typeof ratingClassListSchema>;

export const ratingClassesListSchema = ratingStateOfListSchema.extend({
  grade: z.int().min(1).max(11).nullable(),
  language: instructionLanguageSchema.nullable(),
  rows: z.array(
    z.object({
      class: ratingClassSchema,
      place: z.int().min(1).nullable(),
      value: tenthsSchema,
      /** The students counted: members on the reference date with a figure. */
      students: z.int().min(0),
    }),
  ),
});

export type RatingClassesList = z.infer<typeof ratingClassesListSchema>;
