import { z } from 'zod';
import { academicYearStatusSchema, schoolDateSchema } from './academic-year.js';
import { tableCellSchema } from './day-templates.js';
import { instructionLanguageSchema } from './settings.js';
import { roomTypeSchema, weekdaySchema } from './setup.js';

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
  'load_split_and_whole',
  'load_mixed_not_split',
  'load_no_tutor',
  'load_tutor_row_teacher',
  'load_teacher_branch',
  'load_teacher_status',
  'load_teacher_subject',
  'load_teacher_grade',
  'load_teacher_language',
  'load_block_mixed',
  'load_block_lessons',
  'load_block_teacher',
  'load_room_closed',
  'load_group_gaps',
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
  /**
   * One teacher or one vacancy (06, Model). `null` on a Tutor row (a Tutor
   * subject on a class row), whose teacher the server writes: the class's
   * Tutor (task 3.6c-2, decision 1); a teacher sent there is refused
   * (`load_tutor_row_teacher`); a new row that is not a Tutor row needs one
   * (`load_teacher_needed`). On an edit, `null` keeps the teacher.
   */
  teacherId: z.uuid().nullable(),
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
    /** Task 3.4b, decision 12: a half of a split that is part of a mixed block. */
    mixedBlock: z.boolean().default(false),
  })
  .refine((row) => (row.classId === null) !== (row.groupId === null), {
    message: 'A class or a group.',
    path: ['classId'],
  })
  .refine(oneRoomChoice, ROOM_CHOICE);

export type LoadRowRecord = z.infer<typeof loadRowRecordSchema>;

/**
 * The edit of a row: the unit and the subject are fixed. A change of lessons
 * per week (or of `mixedBlock`, kept when absent) is written to every part of
 * the block (of the split for the mark; task 3.4b, decision 3).
 */
export const loadRowEditSchema = loadRowFieldsSchema
  .extend({ mixedBlock: z.boolean().optional() })
  .refine(oneRoomChoice, ROOM_CHOICE);

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
  mixedBlock: z.boolean(),
  /** Task 3.4b: the rows of the block of a group row, this one included, by group name; empty for a class row. */
  block: z.array(z.object({ id: z.uuid(), name: z.string() })),
  /** Task 3.4b, decision 4: the students not placed in one of the block's groups; 0 for a class row. */
  unplaced: z.int().min(0),
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
 * The teachers and vacancies a row may take (decision 2): the class's Tutor
 * first, marked. On a Tutor row (`tutorRow`) the class's Tutor of the version
 * alone, also as `defaultTeacherId`, which nobody changes (task 3.6c-2,
 * decision 1); otherwise `defaultTeacherId` is empty.
 */
export const loadTeachersSchema = z.object({
  /** A Tutor subject on a class row: the server writes the class's Tutor. */
  tutorRow: z.boolean(),
  teachers: z.array(loadTeacherSchema.extend({ tutor: z.boolean() })),
  defaultTeacherId: z.uuid().nullable(),
  /**
   * The teachers and vacancies whose profile has the subject but who cannot
   * take the row, with the first reason (task 3.5b, H30 of issue #105): not
   * active, not every grade, not the class's language, or teaching another
   * part of the block (`blockGroup`, that part's group).
   */
  excluded: z.array(
    loadTeacherSchema.extend({
      reason: z.enum(['status', 'grade', 'language', 'block']),
      blockGroup: z.string().nullable(),
    }),
  ),
  /** A Tutor subject on a class row whose class has no Tutor in force (H30). */
  noTutor: z.boolean(),
});

export type LoadTeachers = z.infer<typeof loadTeachersSchema>;

/**
 * The weekly totals of a version (06, Building a timetable, steps 2 and 3;
 * Teachers who work in several branches, Weekly load; task 3.4b, decisions 5
 * to 8): each class's lessons against the lesson slots of its week, each
 * teacher's lessons here against the free slots here (`null`: no hours
 * entry in force), the lessons of the version running in each other branch
 * (marked `draft` when it is a draft) and the contract load (`null`: not
 * set). Shown, never refusing.
 */
export const loadTotalsSchema = z.object({
  classes: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      grade: z.int(),
      lessons: z.int().min(0),
      lessonSlots: z.int().min(0),
    }),
  ),
  teachers: z.array(
    loadTeacherSchema.extend({
      lessons: z.int().min(0),
      freeSlots: z.int().min(0).nullable(),
      elsewhere: z.array(
        z.object({
          branchId: z.uuid(),
          branchName: z.string(),
          lessons: z.int().min(0),
          draft: z.boolean(),
        }),
      ),
      contract: z.int().min(1).nullable(),
    }),
  ),
});

export type LoadTotals = z.infer<typeof loadTotalsSchema>;

/** A cell of the table of step 1, named by its weekday and grade. */
export const readinessCellKeySchema = z.object({ weekday: weekdaySchema, grade: z.int() });

/** A teacher or vacancy of step 3, with the figures of the totals and the daily maximum. */
const readinessTeacherSchema = loadTotalsSchema.shape.teachers.element.extend({
  /** The most lessons per day of the record (`null`: not set); shown, never refusing. */
  dailyLessons: z.int().min(1).nullable(),
  /** No hours entry in force in the branch. */
  noHours: z.boolean(),
  /** More lessons in the draft than free slots in the branch. */
  over: z.boolean(),
});

/**
 * The preferences of the generator (06, Auto-generation), in the order of its
 * table: the same codes as `PREFERENCES` of packages/timetable-rules (a test
 * of the API compares the two). Task 5.3b-1, decision 3: a weight is a whole
 * number from 0 (not used) to 10, starting at 5; the database keeps the same
 * bounds (db/migrations/0069).
 */
export const PREFERENCE_CODES = [
  'class_no_gaps',
  'teacher_few_gaps',
  'subject_spread',
  'demanding_early',
  'class_even_days',
  'main_room',
  'part_time_few_days',
  'teacher_preferred_times',
] as const;

export const preferenceCodeSchema = z.enum(PREFERENCE_CODES);

export type PreferenceCode = z.infer<typeof preferenceCodeSchema>;

export const PREFERENCE_WEIGHT_MAX = 10;

const weightSchema = z.int().min(0).max(PREFERENCE_WEIGHT_MAX);

/** A weight for each of the eight preferences, every one required. */
export const preferenceWeightsSchema = z.strictObject({
  class_no_gaps: weightSchema,
  teacher_few_gaps: weightSchema,
  subject_spread: weightSchema,
  demanding_early: weightSchema,
  class_even_days: weightSchema,
  main_room: weightSchema,
  part_time_few_days: weightSchema,
  teacher_preferred_times: weightSchema,
});

export type PreferenceWeights = z.infer<typeof preferenceWeightsSchema>;

/**
 * The body of the weights save and of the confirm of step 5: the eight
 * weights, for the confirm the ones the person sees (decision 9).
 */
export const preferenceWeightsBodySchema = z.strictObject({ weights: preferenceWeightsSchema });

export type PreferenceWeightsBody = z.infer<typeof preferenceWeightsBodySchema>;

/**
 * The readiness of steps 1 to 5 of the draft builder (06, Building a
 * timetable; tasks 5.3a, pull request #127, and 5.3b-1), read on each request
 * from the draft and the data in force (decision 3): ready for generation
 * when every step is ready.
 */
export const draftReadinessSchema = z.object({
  ready: z.boolean(),
  /** Step 1: the start date and the table of templates per weekday and grade. */
  templates: z.object({
    ready: z.boolean(),
    startsOn: schoolDateSchema,
    /** Decision 5: the start date is before today. */
    startPast: z.boolean(),
    /** Each read on the weekday's first date on or after the later of the start date and today (decision 2). */
    cells: z.array(tableCellSchema.extend({ date: schoolDateSchema })),
    confirmed: z.boolean(),
    changed: z.array(readinessCellKeySchema),
    missing: z.array(readinessCellKeySchema),
  }),
  /** Step 2: the teaching load. */
  load: z.object({
    ready: z.boolean(),
    rows: z.int().min(0),
    /** The rows with a problem of step 2 (every problem but the room problems). */
    problemRows: z.array(loadRowSchema),
    leftRows: z.int().min(0),
    classesOver: loadTotalsSchema.shape.classes,
  }),
  /** Step 3: every teacher and vacancy of the draft, those that hold the step back first. */
  teachers: z.object({
    ready: z.boolean(),
    teachers: z.array(readinessTeacherSchema),
  }),
  /** Step 4: the rows whose room need nothing meets, and the classes with no main classroom. */
  rooms: z.object({
    ready: z.boolean(),
    rows: z.array(loadRowSchema.extend({ reason: z.enum(['load_room_closed', 'room_type_none']) })),
    classesWithoutRoom: z.array(z.object({ id: z.uuid(), name: z.string(), grade: z.int() })),
  }),
  /** Step 5: the weights stored now, and whether they are the ones confirmed (task 5.3b-1). */
  rules: z.object({
    ready: z.boolean(),
    confirmed: z.boolean(),
    weights: preferenceWeightsSchema,
    /** The preferences whose weight differs from the confirmed one. */
    changed: z.array(preferenceCodeSchema),
  }),
});

export type DraftReadiness = z.infer<typeof draftReadinessSchema>;
