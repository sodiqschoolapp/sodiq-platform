import { z } from 'zod';
import { academicYearStatusSchema, schoolDateSchema } from './academic-year.js';
import { classGradeSchema } from './classes.js';
import { instructionLanguageSchema } from './settings.js';

/**
 * Groups and splits (docs/spec/05-classes-groups-subjects.md, Group; task
 * 3.2a, pull request #91). The bounds are decisions 6 and 7 of the plan; the
 * database keeps the same numbers (db/migrations/0046), and a test compares
 * them. A group has no teacher (decision 15, Look first): the teacher of a
 * group is the teacher of its teaching load row (task 3.4).
 */

/** Decision 6: 1 to 40 characters after trimming. */
export const GROUP_NAME_MAX_LENGTH = 40;

/** Decision 7: the maximum size of a group, from 1 to 60. */
export const GROUP_MAX_SIZE = 60;

/** The classes a group may name at once: every class of two grades of a branch. */
export const GROUP_MAX_CLASSES = 40;

/**
 * Decision 6: letters, digits 0 to 9, spaces, hyphens and the Uzbek
 * apostrophes (U+02BB, U+02BC); a digit may come first ("7-M-1"). Digits 0 to
 * 9 only, so that it refuses every name `groups_name_check` of
 * db/migrations/0046 refuses (correction 3: "7-M-1²").
 */
export const groupNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(GROUP_NAME_MAX_LENGTH)
  .regex(/^[\p{L}0-9][\p{L}0-9 'ʻʼ-]*$/u, {
    message: 'A group name holds letters, digits, spaces and hyphens.',
  });

const classIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(GROUP_MAX_CLASSES)
  .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
    message: 'A class is named once.',
  });

/**
 * What is typed for a group, at the create and the edit (decision 8): the
 * language is `null` when the classes share one (the group takes it), and is
 * chosen when they differ; `confirmMixedLanguage` confirms the warning for a
 * subject under the language rule.
 */
export const groupRecordSchema = z.object({
  classIds: classIdsSchema,
  name: groupNameSchema,
  language: instructionLanguageSchema.nullable(),
  maxSize: z.int().min(1).max(GROUP_MAX_SIZE),
  confirmMixedLanguage: z.boolean().default(false),
});

export type GroupRecord = z.infer<typeof groupRecordSchema>;

/** The create names the academic year and the subject, fixed afterwards (decision 5). */
export const groupCreateSchema = groupRecordSchema.extend({
  academicYearId: z.uuid(),
  subjectId: z.uuid(),
});

export type GroupCreate = z.infer<typeof groupCreateSchema>;

/** The edit names the state it was made on ("group changed, reload"). */
export const groupEditSchema = groupRecordSchema.extend({ version: z.int().min(0) });

export type GroupEdit = z.infer<typeof groupEditSchema>;

/**
 * The restore (code round 1 of pull request #91, finding 1): classes that
 * differ in language while the group was archived bring it back mixed, so the
 * warning of a subject under the language rule is confirmed, as at the save.
 */
export const groupRestoreSchema = z.object({
  confirmMixedLanguage: z.boolean().default(false),
});

export type GroupRestore = z.infer<typeof groupRestoreSchema>;

export const groupParamsSchema = z.object({ id: z.uuid() });

export type GroupParams = z.infer<typeof groupParamsSchema>;

/** The classes of a slot check, comma-separated in the query. */
export const groupSlotQuerySchema = z.strictObject({
  classIds: z
    .string()
    .max(GROUP_MAX_CLASSES * 37)
    .transform((text) => text.split(','))
    .pipe(classIdsSchema),
});

export type GroupSlotQuery = z.infer<typeof groupSlotQuerySchema>;

/** Decision 3: one class is a split of it, several are a group across classes. */
export const GROUP_KINDS = ['split', 'across'] as const;

export const groupKindSchema = z.enum(GROUP_KINDS);

export type GroupKind = z.infer<typeof groupKindSchema>;

/** The kind of a group of these many classes. */
export const groupKindOf = (classCount: number): GroupKind =>
  classCount === 1 ? 'split' : 'across';

/** A class as a group names it. */
export const groupClassSchema = z.object({
  id: z.uuid(),
  grade: classGradeSchema,
  name: z.string(),
  language: instructionLanguageSchema,
  archived: z.boolean(),
});

export type GroupClass = z.infer<typeof groupClassSchema>;

/** A lesson slot both grades have at the same clock times (minutes after midnight, branch time). */
export const sharedSlotSchema = z.object({
  start: z.int().min(0),
  end: z.int().min(0),
  lessonA: z.int().min(1),
  lessonB: z.int().min(1),
});

/** One working weekday (ISO, Monday 1) of a two-grade group: its first date and the shared slots. */
export const twoGradeDaySchema = z.object({
  weekday: z.int().min(1).max(7),
  date: schoolDateSchema,
  slots: z.array(sharedSlotSchema),
});

export type TwoGradeDay = z.infer<typeof twoGradeDaySchema>;

/**
 * The shared slots of a group of two grades (decision 9): the two grades and
 * each working weekday; `null` for a group of one grade.
 */
export const groupSlotsSchema = z
  .object({
    grades: z.tuple([classGradeSchema, classGradeSchema]),
    days: z.array(twoGradeDaySchema),
  })
  .nullable();

export type GroupSlots = z.infer<typeof groupSlotsSchema>;

/** A group as the list and the panel read it. */
export const groupSchema = z.object({
  id: z.uuid(),
  academicYearId: z.uuid(),
  /** "2026–2027". */
  yearName: z.string(),
  yearStatus: academicYearStatusSchema,
  subject: z.object({
    id: z.uuid(),
    names: z.object({ uz: z.string(), ru: z.string(), en: z.string() }),
    languageRule: z.boolean(),
  }),
  name: z.string(),
  language: instructionLanguageSchema,
  maxSize: z.int().min(1),
  /** The grades of its classes, ascending: one or two. */
  grades: z.array(classGradeSchema),
  classes: z.array(groupClassSchema),
  kind: groupKindSchema,
  /** The members today (the card's count; task 3.2b). */
  students: z.int().min(0),
  archived: z.boolean(),
  /** The state an edit is made on. */
  version: z.int().min(0),
});

export type SchoolGroup = z.infer<typeof groupSchema>;

export const groupListSchema = z.object({ groups: z.array(groupSchema) });

export type GroupList = z.infer<typeof groupListSchema>;

/** A group with the shared slots of its two grades, as the panel and an answer of a save read it. */
export const groupDetailSchema = groupSchema.extend({ slots: groupSlotsSchema });

export type GroupDetail = z.infer<typeof groupDetailSchema>;

/** The answer of a slot check: the shared slots of the classes chosen. */
export const groupSlotCheckSchema = z.object({ slots: groupSlotsSchema });

export type GroupSlotCheck = z.infer<typeof groupSlotCheckSchema>;

/**
 * Group membership (task 3.2b, pull request #92). "Put into a group" places
 * 1 to GROUP_MAX_SIZE students at once, all or none (the 3.1b precedent): a
 * group holds at most that many.
 */
export const GROUP_PLACEMENT_MAX_STUDENTS = GROUP_MAX_SIZE;

export const groupMemberParamsSchema = z.object({ id: z.uuid(), memberId: z.uuid() });

export type GroupMemberParams = z.infer<typeof groupMemberParamsSchema>;

/**
 * "Put into a group" from a date (decision 15 of the plan). A student is
 * refused by state when another change came first (decision 11): the
 * student's `version` does not count group rows.
 */
export const groupPlacementSchema = z.strictObject({
  students: z
    .array(z.strictObject({ id: z.uuid() }))
    .min(1)
    .max(GROUP_PLACEMENT_MAX_STUDENTS)
    .refine(
      (students) =>
        new Set(students.map((student) => student.id.toLowerCase())).size === students.length,
      { message: 'A student is named once.' },
    ),
  from: schoolDateSchema,
});

export type GroupPlacement = z.infer<typeof groupPlacementSchema>;

/** `current`: in the group today; `planned`: joins after today. */
export const groupMemberStateSchema = z.enum(['current', 'planned']);

export type GroupMemberState = z.infer<typeof groupMemberStateSchema>;

/** A member of a group as its Students tab shows them: the Basic group, the class and the dates. */
export const groupMemberSchema = z.object({
  /** The group row; a planned one is withdrawn by it. */
  id: z.uuid(),
  studentId: z.uuid(),
  uid: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  /** The class of the student on the first day of the row. */
  class: z.object({ id: z.uuid(), grade: classGradeSchema, name: z.string() }),
  from: schoolDateSchema,
  /** The first day without the group. */
  until: schoolDateSchema,
  state: groupMemberStateSchema,
  /** "Placed automatically, review" (decision 3). */
  review: z.boolean(),
});

export type GroupMember = z.infer<typeof groupMemberSchema>;

/**
 * The Students tab of a group: the members in force today and the planned
 * ones, by surname; the free seats today and the fewest on any date from
 * today on, scheduled joins and leaves counted. A Tutor reads the members of
 * own classes only (decision 4): `othersCount` counts the rest, `0` for
 * every other reader.
 */
export const groupMembersSchema = z.object({
  members: z.array(groupMemberSchema),
  othersCount: z.int().min(0),
  freeToday: z.int(),
  freeLeast: z.int(),
  today: schoolDateSchema,
});

export type GroupMembers = z.infer<typeof groupMembersSchema>;

/** One grade, or one pair of grades, comma-separated in the query. */
const placementGradesSchema = z
  .string()
  .max(5)
  .transform((text) => text.split(',').map(Number))
  .pipe(
    z
      .array(classGradeSchema)
      .min(1)
      .max(2)
      .refine((grades) => new Set(grades).size === grades.length, {
        message: 'A grade is named once.',
      }),
  );

/**
 * The bulk placement screen (`05`: "into groups for one subject and one
 * grade, or one pair of grades, at a time"), on a date.
 */
export const groupPlacementQuerySchema = z.strictObject({
  subjectId: z.uuid(),
  grades: placementGradesSchema,
  on: schoolDateSchema,
});

export type GroupPlacementQuery = z.infer<typeof groupPlacementQuerySchema>;

/** A group of the screen: its members on the date and its free seats from the date on. */
export const placementGroupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  language: instructionLanguageSchema,
  classes: z.array(z.object({ id: z.uuid(), grade: classGradeSchema, name: z.string() })),
  maxSize: z.int().min(1),
  /** The members on the date. */
  members: z.int().min(0),
  /** The fewest free seats on any date from the date on. */
  free: z.int(),
});

export type PlacementGroup = z.infer<typeof placementGroupSchema>;

/**
 * A student not yet placed (decision 14): a class row on the date in a class
 * the screen's groups draw from, and no group of the subject on or after the
 * date (the rule of `student_has_group`, decision 10).
 */
export const unplacedStudentSchema = z.object({
  id: z.uuid(),
  uid: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  class: z.object({ id: z.uuid(), grade: classGradeSchema, name: z.string() }),
  /** The first day of the class row that holds the date. */
  classFrom: schoolDateSchema,
});

export type UnplacedStudent = z.infer<typeof unplacedStudentSchema>;

export const groupPlacementBoardSchema = z.object({
  groups: z.array(placementGroupSchema),
  unplaced: z.array(unplacedStudentSchema),
  today: schoolDateSchema,
});

export type GroupPlacementBoard = z.infer<typeof groupPlacementBoardSchema>;

/** "Place automatically": every student not yet placed on the screen, from a date. */
export const automaticPlacementSchema = z.strictObject({
  subjectId: z.uuid(),
  grades: z
    .array(classGradeSchema)
    .min(1)
    .max(2)
    .refine((grades) => new Set(grades).size === grades.length, {
      message: 'A grade is named once.',
    }),
  from: schoolDateSchema,
});

export type AutomaticPlacement = z.infer<typeof automaticPlacementSchema>;

/** What "Place automatically" did: the students placed, each with its group. */
export const automaticPlacementResultSchema = z.object({
  placed: z.array(z.object({ studentId: z.uuid(), groupId: z.uuid() })),
});

export type AutomaticPlacementResult = z.infer<typeof automaticPlacementResultSchema>;

/**
 * A group as a student names it (the list's `groups` column, the Academic
 * block): in force today, else the first planned, one per subject; `review`
 * is the tag of an automatic placement.
 */
export const studentGroupSchema = z.object({
  id: z.uuid(),
  /** The group row shown, which a group transfer names (task 3.3a, decision 6). */
  membershipId: z.uuid(),
  name: z.string(),
  subjectId: z.uuid(),
  from: schoolDateSchema,
  state: groupMemberStateSchema,
  review: z.boolean(),
});

export type StudentGroup = z.infer<typeof studentGroupSchema>;
