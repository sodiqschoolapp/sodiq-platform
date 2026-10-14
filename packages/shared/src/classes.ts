import { z } from 'zod';
import { academicYearStatusSchema, schoolDateSchema } from './academic-year.js';
import { personNameSchema } from './accounts.js';
import { instructionLanguageSchema } from './settings.js';
import { roomStatusSchema } from './setup.js';

/**
 * Classes and their Tutors (docs/spec/05-classes-groups-subjects.md, Class;
 * docs/spec/edge-cases/students-classes-groups.md; task 3.1a, pull request
 * #88). The bounds are decisions 14 and 17 of the plan; the database keeps the
 * same numbers (db/migrations/0042), and a test compares them.
 */

/** Decision 17: 2 to 40 characters after trimming, beginning with a letter. */
export const CLASS_NAME_MIN_LENGTH = 2;
export const CLASS_NAME_MAX_LENGTH = 40;

/** Decision 14: the maximum size of a class, from 1 to 60. */
export const CLASS_MAX_SIZE = 60;

/** `05`: "Grade (1–11)". */
export const CLASS_GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

/**
 * The Cyrillic letters folded to the Latin letter their capital looks like,
 * in both cases (`edge/students-classes-groups`: "Look-alike Cyrillic and
 * Latin letters in class and group names are treated as the same"). The same
 * list as `class_name_key` of db/migrations/0042.
 */
const LOOK_ALIKES: Readonly<Record<string, string>> = {
  А: 'A',
  а: 'a',
  В: 'B',
  в: 'b',
  Е: 'E',
  е: 'e',
  К: 'K',
  к: 'k',
  М: 'M',
  м: 'm',
  Н: 'H',
  н: 'h',
  О: 'O',
  о: 'o',
  Р: 'P',
  р: 'p',
  С: 'C',
  с: 'c',
  Т: 'T',
  т: 't',
  У: 'Y',
  у: 'y',
  Х: 'X',
  х: 'x',
  І: 'I',
  і: 'i',
  Ј: 'J',
  ј: 'j',
  Ѕ: 'S',
  ѕ: 's',
};

/**
 * The folded name a class is compared by (decision 4): look-alike Cyrillic
 * letters as their Latin twins, lower case, runs of white space as one space,
 * no outer spaces. Equal to `class_name_key` of the database, which computes
 * the stored key; a test compares the two over generated names.
 */
export function classNameKey(name: string): string {
  let latin = '';
  for (const letter of name) {
    latin += LOOK_ALIKES[letter] ?? letter;
  }
  return latin
    .replace(/[ \t\n\r\f\v]+/g, ' ')
    .replace(/^ +| +$/g, '')
    .toLowerCase();
}

/** A class as it is shown: grade and name, "7 Oxford" (`05`). */
export const classDisplayName = (grade: number, name: string): string => `${String(grade)} ${name}`;

export const classGradeSchema = z.int().min(1).max(11);

/** Decision 17: begins with a letter, so "7-A" and "A" are refused. */
export const classNameSchema = z
  .string()
  .trim()
  .min(CLASS_NAME_MIN_LENGTH)
  .max(CLASS_NAME_MAX_LENGTH)
  .regex(/^\p{L}/u, { message: 'A class name begins with a letter.' });

/** What is typed for a class, at the create and the edit. */
export const classRecordSchema = z.object({
  grade: classGradeSchema,
  name: classNameSchema,
  language: instructionLanguageSchema,
  /** Optional (decision 7); a room of the branch that is not closed. */
  mainRoomId: z.uuid().nullable(),
  maxSize: z.int().min(1).max(CLASS_MAX_SIZE),
});

export type ClassRecord = z.infer<typeof classRecordSchema>;

/** The create names the academic year, fixed afterwards (decision 6). */
export const classCreateSchema = classRecordSchema.extend({ academicYearId: z.uuid() });

export type ClassCreate = z.infer<typeof classCreateSchema>;

/** The edit names the state it was made on ("class changed, reload"). */
export const classEditSchema = classRecordSchema.extend({ version: z.int().min(0) });

export type ClassEdit = z.infer<typeof classEditSchema>;

export const classParamsSchema = z.object({ id: z.uuid() });

export type ClassParams = z.infer<typeof classParamsSchema>;

export const classTutorParamsSchema = z.object({ id: z.uuid(), tutorId: z.uuid() });

export type ClassTutorParams = z.infer<typeof classTutorParamsSchema>;

/** Decision 15: the Tutor of a class, and an acting Tutor for a period beside them. */
export const CLASS_TUTOR_KINDS = ['tutor', 'acting'] as const;

export const classTutorKindSchema = z.enum(CLASS_TUTOR_KINDS);

export type ClassTutorKind = z.infer<typeof classTutorKindSchema>;

/** `planned`: begins later; `current`: in force now; `ended`: its end has come, or it was withdrawn. */
export const CLASS_TUTOR_STATES = ['planned', 'current', 'ended'] as const;

export const classTutorStateSchema = z.enum(CLASS_TUTOR_STATES);

export type ClassTutorState = z.infer<typeof classTutorStateSchema>;

/** Correction 2: who ended a row: the end route or a typed end, the end of the role, the archive. */
export const CLASS_TUTOR_END_CAUSES = ['ended', 'role', 'archive'] as const;

export const classTutorEndCauseSchema = z.enum(CLASS_TUTOR_END_CAUSES);

export type ClassTutorEndCause = z.infer<typeof classTutorEndCauseSchema>;

/**
 * A Tutor from a date (decision 9): today begins now, a later date at 00:00
 * of that day; `until` is the first day without the class, or `null`.
 */
export const classTutorGiveSchema = z
  .object({
    assignmentId: z.uuid(),
    kind: classTutorKindSchema,
    from: schoolDateSchema,
    until: schoolDateSchema.nullable(),
  })
  .refine((give) => give.until === null || give.until > give.from, {
    path: ['until'],
    message: 'The end comes after the start.',
  });

export type ClassTutorGive = z.infer<typeof classTutorGiveSchema>;

/** The end of a Tutor row from a date: today ends it now, a later date at 00:00 of that day. */
export const classTutorEndSchema = z.object({ from: schoolDateSchema });

export type ClassTutorEnd = z.infer<typeof classTutorEndSchema>;

/** A Tutor as a class names them: the person of the Tutor assignment. */
export const classTutorPersonSchema = z.object({
  assignmentId: z.uuid(),
  /** The staff record of the account; `null` when it has none. */
  staffId: z.uuid().nullable(),
  name: personNameSchema.nullable(),
});

export type ClassTutorPerson = z.infer<typeof classTutorPersonSchema>;

/** One dated Tutor row of a class, with its dates in the branch's time zone. */
export const classTutorSchema = classTutorPersonSchema.extend({
  id: z.uuid(),
  kind: classTutorKindSchema,
  from: schoolDateSchema,
  /** The first day without the class; `null` while it has no end. */
  until: schoolDateSchema.nullable(),
  state: classTutorStateSchema,
  endCause: classTutorEndCauseSchema.nullable(),
});

export type ClassTutor = z.infer<typeof classTutorSchema>;

/** A class as the list and the panel read it. */
export const classSchema = z.object({
  id: z.uuid(),
  academicYearId: z.uuid(),
  /** "2026–2027". */
  yearName: z.string(),
  yearStatus: academicYearStatusSchema,
  grade: classGradeSchema,
  name: z.string(),
  language: instructionLanguageSchema,
  mainRoom: z.object({ id: z.uuid(), name: z.string(), status: roomStatusSchema }).nullable(),
  maxSize: z.int().min(1),
  /** The Tutor and the acting Tutor in force now; `null` when there is none (decision 11). */
  tutor: classTutorSchema.nullable(),
  acting: classTutorSchema.nullable(),
  archived: z.boolean(),
  /** The state an edit is made on. */
  version: z.int().min(0),
});

export type SchoolClass = z.infer<typeof classSchema>;

export const classListSchema = z.object({ classes: z.array(classSchema) });

export type ClassList = z.infer<typeof classListSchema>;

/** A class and every Tutor row it had, has and will have, newest start first. */
export const classDetailSchema = classSchema.extend({ tutors: z.array(classTutorSchema) });

export type ClassDetail = z.infer<typeof classDetailSchema>;

/**
 * A Tutor assignment of the branch in force or planned (decision 8): the
 * person, the languages they teach in and the classes they hold now or later.
 */
export const tutorCandidateSchema = classTutorPersonSchema.extend({
  languages: z.array(instructionLanguageSchema),
  from: schoolDateSchema,
  until: schoolDateSchema.nullable(),
  classes: z.array(
    z.object({
      id: z.uuid(),
      grade: classGradeSchema,
      name: z.string(),
      kind: classTutorKindSchema,
    }),
  ),
});

export type TutorCandidate = z.infer<typeof tutorCandidateSchema>;

export const tutorCandidateListSchema = z.object({ candidates: z.array(tutorCandidateSchema) });

export type TutorCandidateList = z.infer<typeof tutorCandidateListSchema>;
