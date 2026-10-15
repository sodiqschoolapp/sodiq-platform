import { z } from 'zod';
import { academicYearStatusSchema, schoolDateSchema } from './academic-year.js';
import { instructionLanguageSchema } from './settings.js';
import { roomTypeSchema } from './setup.js';

/**
 * Draft timetable versions and their teaching load (docs/spec/05-classes-groups-subjects.md,
 * Teaching load; 06-timetable.md, Model, Building a timetable;
 * edge-cases/timetable.md, Versions and drafts; task 3.4a, pull request #99).
 * The database keeps the same bounds (db/migrations/0055), and a test compares
 * them.
 */

/** Decision 12: lessons per week of one row, 1 to 40. */
export const LOAD_LESSONS_MAX = 40;

/** The states of a version (06, Model); 3.4a writes drafts only. */
export const TIMETABLE_VERSION_STATUSES = ['draft', 'published', 'archived'] as const;

export const timetableVersionStatusSchema = z.enum(TIMETABLE_VERSION_STATUSES);

export type TimetableVersionStatus = z.infer<typeof timetableVersionStatusSchema>;

/**
 * The problems of a load row, in the order the rule engine reports them
 * (`LOAD_PROBLEM_ORDER` of packages/timetable-rules; a test of the API
 * compares the two). Each is also an error code with its text.
 */
export const LOAD_PROBLEMS = [
  'load_unit_year',
  'load_unit_archived',
  'load_group_subject',
  'load_subject_archived',
  'load_subject_grade',
  'load_group_no_shared_slot',
  'load_teacher_branch',
  'load_teacher_status',
  'load_teacher_subject',
  'load_teacher_grade',
  'load_teacher_language',
  'load_room_closed',
] as const;

export const loadProblemSchema = z.enum(LOAD_PROBLEMS);

export type LoadProblem = z.infer<typeof loadProblemSchema>;

/** A version as the list shows it. */
export const timetableVersionSchema = z.object({
  id: z.uuid(),
  academicYearId: z.uuid(),
  yearName: z.string(),
  yearStatus: academicYearStatusSchema,
  number: z.int().min(1),
  status: timetableVersionStatusSchema,
  startsOn: schoolDateSchema,
  /** The version a copy started from ("Each draft remembers the version it started from"). */
  fromVersion: z.object({ id: z.uuid(), number: z.int().min(1) }).nullable(),
  rows: z.int().min(0),
  leftRows: z.int().min(0),
});

export type TimetableVersion = z.infer<typeof timetableVersionSchema>;

/** The versions of the branch, newest year first, and today in the branch's time zone. */
export const timetableVersionListSchema = z.object({
  versions: z.array(timetableVersionSchema),
  today: schoolDateSchema,
});

export type TimetableVersionList = z.infer<typeof timetableVersionListSchema>;

/**
 * A new draft (decisions 5 and 10): the year, the intended start date, and
 * optionally a version of the same branch and year to copy.
 */
export const timetableVersionCreateSchema = z.object({
  academicYearId: z.uuid(),
  startsOn: schoolDateSchema,
  copyFrom: z.uuid().nullable().default(null),
});

export type TimetableVersionCreate = z.infer<typeof timetableVersionCreateSchema>;

/** The edit of a draft: its start date, or the dismissal of the rows a copy left (decision 10). */
export const timetableVersionEditSchema = z
  .object({
    startsOn: schoolDateSchema.optional(),
    dismissLeftRows: z.literal(true).optional(),
  })
  .refine((edit) => edit.startsOn !== undefined || edit.dismissLeftRows !== undefined, {
    message: 'A start date or the dismissal of the left rows.',
  });

export type TimetableVersionEdit = z.infer<typeof timetableVersionEditSchema>;

export const timetableVersionParamsSchema = z.object({ id: z.uuid() });

export type TimetableVersionParams = z.infer<typeof timetableVersionParamsSchema>;

export const loadRowParamsSchema = z.object({ id: z.uuid(), rowId: z.uuid() });

export type LoadRowParams = z.infer<typeof loadRowParamsSchema>;

/** The fields of a row that an edit may change (decision 7). */
const loadRowFieldsSchema = z.object({
  /** One teacher or one vacancy (06, Model). */
  teacherId: z.uuid(),
  lessonsPerWeek: z.int().min(1).max(LOAD_LESSONS_MAX),
  /** Decision 13: a room, a room type, or neither. */
  roomId: z.uuid().nullable(),
  roomType: roomTypeSchema.nullable(),
  doubleLessons: z.boolean(),
});

const oneRoomChoice = (row: { roomId: string | null; roomType: string | null }) =>
  row.roomId === null || row.roomType === null;

const ROOM_CHOICE = { message: 'A room or a room type, not both.', path: ['roomType'] };

/** What is typed for a new row: a class or a group, its subject, and the fields. */
export const loadRowRecordSchema = loadRowFieldsSchema
  .extend({
    classId: z.uuid().nullable(),
    groupId: z.uuid().nullable(),
    subjectId: z.uuid(),
  })
  .refine((row) => (row.classId === null) !== (row.groupId === null), {
    message: 'A class or a group.',
    path: ['classId'],
  })
  .refine(oneRoomChoice, ROOM_CHOICE);

export type LoadRowRecord = z.infer<typeof loadRowRecordSchema>;

/** The edit of a row: the unit and the subject are fixed. */
export const loadRowEditSchema = loadRowFieldsSchema.refine(oneRoomChoice, ROOM_CHOICE);

export type LoadRowEdit = z.infer<typeof loadRowEditSchema>;

/** The class or group of a row. */
export const loadUnitSchema = z.object({
  kind: z.enum(['class', 'group']),
  id: z.uuid(),
  /** The class's name ("Oxford", shown with its grade) or the group's ("7-M-1"). */
  name: z.string(),
  grades: z.array(z.int()),
  language: instructionLanguageSchema,
  archived: z.boolean(),
});

export type LoadUnit = z.infer<typeof loadUnitSchema>;

/** A teacher or a vacancy; the name is empty when the record is no longer of the branch. */
export const loadTeacherSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['person', 'vacancy']),
  name: z.string().nullable(),
});

export type LoadTeacher = z.infer<typeof loadTeacherSchema>;

/** A row of a version with the problems it has today (decision 3). */
export const loadRowSchema = z.object({
  id: z.uuid(),
  unit: loadUnitSchema,
  subject: z.object({
    id: z.uuid(),
    names: z.object({ uz: z.string(), ru: z.string(), en: z.string() }),
  }),
  teacher: loadTeacherSchema,
  lessonsPerWeek: z.int().min(1).max(LOAD_LESSONS_MAX),
  room: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  roomType: roomTypeSchema.nullable(),
  doubleLessons: z.boolean(),
  problems: z.array(loadProblemSchema),
});

export type LoadRow = z.infer<typeof loadRowSchema>;

/**
 * The load of a version: its rows with their problems today, and the rows a
 * copy left with the problems that kept them out (decision 10; `id` is the
 * row of the version copied).
 */
export const loadSchema = z.object({
  version: timetableVersionSchema,
  rows: z.array(loadRowSchema),
  leftRows: z.array(loadRowSchema),
});

export type Load = z.infer<typeof loadSchema>;

/** The unit and subject whose possible teachers are asked for. */
export const loadTeachersQuerySchema = z
  .object({
    classId: z.uuid().optional(),
    groupId: z.uuid().optional(),
    subjectId: z.uuid(),
  })
  .refine((query) => (query.classId === undefined) !== (query.groupId === undefined), {
    message: 'A class or a group.',
    path: ['classId'],
  });

export type LoadTeachersQuery = z.infer<typeof loadTeachersQuerySchema>;

/**
 * The teachers and vacancies a row may take (decision 2): the class's Tutors
 * first, marked; `defaultTeacherId` is the class's Tutor for a Tutor subject
 * (correction 1: the main Tutor, the acting one when there is no main),
 * otherwise empty.
 */
export const loadTeachersSchema = z.object({
  teachers: z.array(loadTeacherSchema.extend({ tutor: z.boolean() })),
  defaultTeacherId: z.uuid().nullable(),
});

export type LoadTeachers = z.infer<typeof loadTeachersSchema>;
