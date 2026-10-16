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

/**
 * Decision 17: begins with a letter, so "7-A" and "A" are refused; then
 * letters, digits, spaces, hyphens and the Uzbek apostrophes (U+02BB, U+02BC),
 * digits 0 to 9 only, so that it refuses every name `classes_name_check` of
 * db/migrations/0043 refuses ("Oxford²": pull request #88, code review round 1).
 */
export const classNameSchema = z
  .string()
  .trim()
  .min(CLASS_NAME_MIN_LENGTH)
  .max(CLASS_NAME_MAX_LENGTH)
  .regex(/^\p{L}[\p{L}0-9 '\u02BB\u02BC-]*$/u, {
    message: 'A class name begins with a letter and holds letters, digits and spaces.',
  });

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
export const classEditSchema = classRecordSchema.extend({
  version: z.int().min(0),
  /**
   * Confirms that a language change makes an active group of a subject under
   * the language rule mix languages (task 3.2a, decision 8).
   */
  confirmMixedGroups: z.boolean().default(false),
});

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

/**
 * What a give would do to the class's Tutor lessons (task 3.6c-2, decision
 * 10; owner's answer 1 of 16 October 2026: the clashing lessons "are listed
 * in the appointment's preview"): the dated lessons that go to a Tutor, those
 * that will need a teacher with what they clash with (only the branch of a
 * clash in another branch, decision 13), and the draft rows and pattern
 * entries that change. Nothing is written.
 */
export const classTutorPreviewSchema = z.object({
  moved: z.array(
    z.object({
      lessonId: z.uuid(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      subjectNames: z.object({ uz: z.string(), ru: z.string(), en: z.string() }),
      to: personNameSchema.nullable(),
    }),
  ),
  needsTeacher: z.array(
    z.object({
      lessonId: z.uuid(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      subjectNames: z.object({ uz: z.string(), ru: z.string(), en: z.string() }),
      /** Empty: no Tutor is in force at the lesson's start. */
      clashes: z.array(
        z.object({
          startsAt: z.iso.datetime(),
          endsAt: z.iso.datetime(),
          /** `null`: this branch. */
          branchName: z.string().nullable(),
        }),
      ),
    }),
  ),
  draftRows: z.int().min(0),
  draftEntriesRemoved: z.int().min(0),
});

export type ClassTutorPreview = z.infer<typeof classTutorPreviewSchema>;

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
  /** The members in force today in the branch's time zone (task 3.1b: "the student count of the class card"). */
  students: z.int().min(0),
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

/**
 * A class and every Tutor row it had, has and will have, newest start first;
 * `today` in the branch's time zone, the first date a give or an end takes.
 */
export const classDetailSchema = classSchema.extend({
  tutors: z.array(classTutorSchema),
  today: schoolDateSchema,
});

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

/**
 * Class membership (task 3.1b, pull request #89). "Put into a class" places 1
 * to PLACEMENT_MAX_STUDENTS students at once, all or none (decision 5): a
 * class holds at most CLASS_MAX_SIZE.
 */
export const PLACEMENT_MAX_STUDENTS = CLASS_MAX_SIZE;

export const classMemberParamsSchema = z.object({ id: z.uuid(), memberId: z.uuid() });

export type ClassMemberParams = z.infer<typeof classMemberParamsSchema>;

/**
 * "Put into a class" from a date (decision 6): each student with the state
 * the person saw (`version` of the list or the record), so that a student
 * changed meanwhile is refused `student_changed` (decision 17).
 */
export const classPlacementSchema = z.strictObject({
  students: z
    .array(z.strictObject({ id: z.uuid(), version: z.int().min(0) }))
    .min(1)
    .max(PLACEMENT_MAX_STUDENTS)
    .refine((students) => new Set(students.map((student) => student.id)).size === students.length, {
      message: 'A student is named once.',
    }),
  from: schoolDateSchema,
});

export type ClassPlacement = z.infer<typeof classPlacementSchema>;

/** `current`: in the class today; `planned`: joins after today. */
export const CLASS_MEMBER_STATES = ['current', 'planned'] as const;

export const classMemberStateSchema = z.enum(CLASS_MEMBER_STATES);

export type ClassMemberState = z.infer<typeof classMemberStateSchema>;

/** A member of a class as its Students tab shows them: the Basic group and the dates. */
export const classMemberSchema = z.object({
  /** The membership row; a planned one is withdrawn by it. */
  id: z.uuid(),
  studentId: z.uuid(),
  uid: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  from: schoolDateSchema,
  /** The first day without the class: a scheduled leaving, or the day after the year's end. */
  until: schoolDateSchema,
  state: classMemberStateSchema,
});

export type ClassMember = z.infer<typeof classMemberSchema>;

/**
 * The Students tab: the members in force today and the planned ones, by
 * surname; the free seats today and the fewest free seats on any date from
 * today on, scheduled joins and leaves counted (edge, "A class is full").
 */
export const classMembersSchema = z.object({
  members: z.array(classMemberSchema),
  freeToday: z.int(),
  freeLeast: z.int(),
  today: schoolDateSchema,
});

/** The date the free seats of the Add student form are read from (task 3.5b, H24 of issue #105). */
export const classSeatsQuerySchema = z.object({ from: schoolDateSchema });

export type ClassSeatsQuery = z.infer<typeof classSeatsQuerySchema>;

/**
 * The classes a new student can join on a date (not archived, the year open
 * and holding the date), each with the first day from that date on with no
 * free seat for one more student, scheduled joins and leaves counted, or
 * `null` (`edge/students-classes-groups`, "A class is full").
 */
export const classSeatsSchema = z.object({
  classes: z.array(
    z.object({
      classId: z.uuid(),
      maxSize: z.int(),
      fullFrom: schoolDateSchema.nullable(),
    }),
  ),
});

export type ClassSeats = z.infer<typeof classSeatsSchema>;

export type ClassMembers = z.infer<typeof classMembersSchema>;

/**
 * The answer of "Put into a class" (task 3.2c, decision 10): the Students
 * tab, and the groups each student was placed into automatically, tagged
 * "placed automatically, review" (`edge/students-classes-groups`, first row).
 */
export const classPlacementResultSchema = classMembersSchema.extend({
  groupsPlaced: z.array(z.object({ studentId: z.uuid(), groupId: z.uuid(), subjectId: z.uuid() })),
});

export type ClassPlacementResult = z.infer<typeof classPlacementResultSchema>;

/** A class as a student names it, with the dates of that membership. */
export const studentClassSchema = z.object({
  id: z.uuid(),
  grade: classGradeSchema,
  name: z.string(),
  language: instructionLanguageSchema,
  from: schoolDateSchema,
  /** The first day without the class. */
  until: schoolDateSchema,
});

export type StudentClass = z.infer<typeof studentClassSchema>;

/** A class a change of a leaving could not give back: archived meanwhile, or its year closed (decision 1). */
export const classNotRestoredSchema = z.object({
  classId: z.uuid(),
  grade: classGradeSchema,
  name: z.string(),
});

export type ClassNotRestored = z.infer<typeof classNotRestoredSchema>;
