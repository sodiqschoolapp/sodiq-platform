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
