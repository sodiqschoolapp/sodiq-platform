import { z } from 'zod';
import { academicYearStatusSchema, schoolDateSchema } from './academic-year.js';
import { tableCellSchema } from './day-templates.js';
import { instructionLanguageSchema } from './settings.js';
import { roomTypeSchema, weekdaySchema } from './setup.js';
import { subjectColourSchema } from './subjects.js';

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

/** "The edit lock is released after 5 minutes without activity" (edge/timetable, Generator and editing; task 5.4c-1). */
export const DRAFT_EDIT_LOCK_MINUTES = 5;

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
  /**
   * A publish marked the draft out of date (task 5.5a-1, decision 4): another
   * version of the branch and year was published after it was started, and
   * it cannot be published until it is brought up to date (5.5a-3).
   */
  outOfDate: z.boolean(),
  /**
   * Who edits the draft now (task 5.4c-1): the account that holds its edit
   * lock and was active in the last 5 minutes, with its name, and whether it
   * is the reader's; `null` when the lock is free (`edge/timetable`,
   * Generator and editing).
   */
  editLock: z
    .object({
      holder: z.object({ id: z.uuid(), name: z.string() }),
      seenAt: z.iso.datetime({ offset: true }),
      mine: z.boolean(),
    })
    .nullable(),
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

/** The longest reason of a row marked "deliberately short" (0073). */
export const SHORT_REASON_MAX = 500;

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
  /**
   * "Deliberately short" with its reason (06, Rules, last row; task 5.5a-1,
   * decision 8): no reason, not short. Absent on an edit keeps it; absent on
   * a new row is none.
   */
  shortReason: z.string().trim().min(1).max(SHORT_REASON_MAX).nullable().optional(),
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
  /** "Deliberately short" with its reason (task 5.5a-1); `null` when not marked. */
  shortReason: z.string().nullable(),
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

/** A slot of a template in the table of step 1: its position (breaks included), kind and clock minutes (task 5.3b-2). */
export const cellSlotSchema = z.object({
  position: z.int().min(1),
  kind: z.enum(['lesson', 'break']),
  start: z.int(),
  end: z.int(),
});

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
 * The confirm of step 5 (task 5.3b-2, decision 7): the weights and the ids of
 * the pins the person sees, refused when either is not what is stored.
 */
export const rulesConfirmBodySchema = z.strictObject({
  weights: preferenceWeightsSchema,
  pins: z.array(z.uuid()).max(2000),
});

export type RulesConfirmBody = z.infer<typeof rulesConfirmBodySchema>;

/** The last slot position of a day template, as pattern_blocks.slot_position (db/migrations/0058). */
export const PIN_SLOT_POSITION_MAX = 20;

/**
 * A pinned lesson (task 5.3b-2, decision 2): a load row of the draft, a
 * weekday and the position of a slot of the day template, breaks included.
 */
export const pinRecordSchema = z.strictObject({
  loadRowId: z.uuid(),
  weekday: weekdaySchema,
  slotPosition: z.int().min(1).max(PIN_SLOT_POSITION_MAX),
});

export type PinRecord = z.infer<typeof pinRecordSchema>;

export const pinParamsSchema = z.object({ id: z.uuid(), pinId: z.uuid() });

/**
 * The problems of a pin that give the rule engine nothing to check (`PIN_PROBLEMS`
 * of packages/timetable-rules; a test of the API compares the two).
 */
export const PIN_PROBLEM_CODES = ['pin_no_slot', 'pin_over_load', 'pin_mixed_block'] as const;

export const pinProblemSchema = z.enum(PIN_PROBLEM_CODES);

/** A pin as the builder shows it, with its row and the clock time of its slot today (`null` when the slot is missing). */
export const pinSchema = z.object({
  id: z.uuid(),
  loadRowId: z.uuid(),
  unit: loadUnitSchema,
  subject: loadRowSchema.shape.subject,
  teacher: loadTeacherSchema,
  weekday: weekdaySchema,
  slotPosition: z.int().min(1).max(PIN_SLOT_POSITION_MAX),
  time: z.object({ start: z.int(), end: z.int() }).nullable(),
});

export type PinAnswer = z.infer<typeof pinSchema>;

/**
 * A blocked result of the pins checked on their own: the rule (a code of
 * `RULE_ORDER` of packages/timetable-rules, its text `timetable.rule.<code>`),
 * the weekday and the pins that put its lessons there.
 */
export const pinConflictSchema = z.object({
  rule: z.string().regex(/^[a-z_]+$/),
  weekday: weekdaySchema,
  pinIds: z.array(z.uuid()),
  /** A lesson of the teacher in another branch's published timetable is part of it (5.4b-1). */
  elsewhere: z.boolean(),
});

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
    /**
     * Each read on the weekday's first date on or after the later of the start
     * date and today (decision 2); task 5.3b-2: with the slots of the template,
     * breaks included, which a pin names by position.
     */
    cells: z.array(
      tableCellSchema.extend({
        date: schoolDateSchema,
        template: tableCellSchema.shape.template
          .unwrap()
          .extend({ slots: z.array(cellSlotSchema) })
          .nullable(),
      }),
    ),
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
    /** Task 5.3b-2: a Tutor of two classes whose pinned lessons fall at the same time (edge/timetable, Structure). */
    tutorPinClashes: z.array(pinConflictSchema),
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
  /** Step 5: the weights and the pins stored now, and whether they are the ones confirmed (tasks 5.3b-1, 5.3b-2). */
  rules: z.object({
    ready: z.boolean(),
    confirmed: z.boolean(),
    weights: preferenceWeightsSchema,
    /** The preferences whose weight differs from the confirmed one. */
    changed: z.array(preferenceCodeSchema),
    pins: z.array(pinSchema),
    /** A pin was added or removed since the confirmation. */
    pinsChanged: z.boolean(),
    /** The blocked results of the pins checked on their own. */
    conflicts: z.array(pinConflictSchema),
    problems: z.array(z.object({ pinId: z.uuid(), problem: pinProblemSchema })),
  }),
  /**
   * Step 7 (task 5.4b-2a, decision 7): the results of the draft's pattern now;
   * ready with no blocked one ("The conflict panel shows no errors"). Only the
   * readiness route reads it; it is not part of `ready`, the gate of generation.
   */
  grid: z
    .object({ ready: z.boolean(), blocked: z.int().min(0), warnings: z.int().min(0) })
    .optional(),
});

export type DraftReadiness = z.infer<typeof draftReadinessSchema>;

/**
 * The grid of step 7 (06, Editing in the grid; task 5.4a, pull request #130):
 * the lessons of a draft's weekly pattern placed, moved, swapped and removed
 * by hand, each write checked by the rule engine on the server as the grid
 * checks it while dragging (14, Timetable, One rule engine).
 */

/** The rule engine's input of the pattern as data (`PatternFactsData` of packages/timetable-rules, decision 2). */
const engineDaySchema = z.union([
  z.object({
    lessons: z.literal(true),
    day: z.object({
      start: z.int(),
      end: z.int(),
      slots: z.array(
        z.object({
          position: z.int().min(1),
          kind: z.enum(['lesson', 'break']),
          start: z.int(),
          end: z.int(),
          lessonNumber: z.int().min(1).nullable(),
        }),
      ),
    }),
    noRegularLessons: z.boolean(),
  }),
  z.object({
    lessons: z.literal(false),
    reason: z.enum(['day_off', 'not_working_day', 'no_template']),
  }),
]);

const datedRangeSchema = z.object({
  validFrom: schoolDateSchema,
  validUntil: schoolDateSchema.nullable(),
});

/** A lesson of another branch or draft as the engine reads it (busy elsewhere, 5.4b). */
const enginePlacementSchema = z.object({
  id: z.string(),
  kind: z.enum(['lesson', 'exam']),
  branchId: z.uuid(),
  day: z.string(),
  start: z.int(),
  end: z.int(),
  blockId: z.string().nullable(),
  doublePairId: z.string().nullable(),
  classId: z.uuid().nullable(),
  groupId: z.uuid().nullable(),
  classIds: z.array(z.uuid()),
  studentIds: z.array(z.uuid()),
  exemptStudentIds: z.array(z.uuid()),
  subjectId: z.uuid().nullable(),
  loadRowId: z.uuid().nullable(),
  teacherIds: z.array(z.uuid()),
  substitute: z.boolean(),
  roomId: z.uuid().nullable(),
  examRooms: z.array(z.object({ roomId: z.uuid(), students: z.int().min(0) })),
  fixed: z.boolean(),
});

export const patternFactsDataSchema = z.object({
  branchId: z.uuid(),
  startDate: schoolDateSchema,
  versionEnd: schoolDateSchema,
  teachers: z.array(
    z.object({
      id: z.uuid(),
      vacancy: z.boolean(),
      out: z.boolean(),
      branchIds: z.array(z.uuid()),
      subjects: z.array(z.object({ subjectId: z.uuid(), grades: z.array(z.int()) })),
      languages: z.array(z.string()),
      availability: z.array(
        datedRangeSchema.extend({
          branchId: z.uuid(),
          ranges: z.array(
            z.object({ weekday: z.int().min(1).max(7), start: z.int(), end: z.int() }),
          ),
        }),
      ),
      weeklyLessons: z.int().nullable(),
      dailyLessons: z.int().nullable(),
    }),
  ),
  subjects: z.array(
    z.object({
      id: z.uuid(),
      active: z.boolean(),
      languageRule: z.boolean(),
      tutorSubject: z.boolean(),
    }),
  ),
  /** Every room of the branch, with its type; an entry's room is a room of its branch (0058; task 5.4b-2a, decision 12). */
  rooms: z.array(
    z.object({
      id: z.uuid(),
      type: roomTypeSchema,
      status: z.enum(['in_use', 'under_repair', 'closed']),
      shared: z.boolean(),
      lessonsAtOnce: z.int().min(1),
      capacity: z.int().min(0),
    }),
  ),
  units: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(['class', 'group']),
      grades: z.array(z.int()),
      language: z.string(),
      tutorOnStart: z.uuid().nullable(),
      classIds: z.array(z.uuid()),
      /** Ids of the members on the reading date; no names (decision 2). */
      studentIds: z.array(z.uuid()),
      mainRoomId: z.uuid().nullable(),
    }),
  ),
  classStudents: z.array(z.object({ classId: z.uuid(), studentIds: z.array(z.uuid()) })),
  days: z.array(z.object({ grade: z.int(), weekday: z.int().min(1).max(7), day: engineDaySchema })),
  year: z.object({
    firstDate: schoolDateSchema,
    lastDate: schoolDateSchema,
    quarters: z.array(z.object({ firstDate: schoolDateSchema, lastDate: schoolDateSchema })),
  }),
  travel: z.array(z.object({ branchA: z.uuid(), branchB: z.uuid(), minutes: z.int().min(0) })),
  classDailyLessons: z.int().nullable(),
  rows: z.array(
    z.object({
      id: z.uuid(),
      classId: z.uuid().nullable(),
      groupId: z.uuid().nullable(),
      subjectId: z.uuid(),
      teacherId: z.uuid(),
      roomId: z.uuid().nullable(),
      roomType: roomTypeSchema.nullable(),
      lessonsPerWeek: z.int().min(1),
      mixedBlock: z.boolean(),
      /** "Whether double lessons are allowed" (05, Teaching load; task 5.4c-3a). */
      doubleLessons: z.boolean(),
      /** Marked "deliberately short" with a reason (task 5.5a-1, decision 8). */
      deliberatelyShort: z.boolean(),
      block: z.array(z.uuid()),
    }),
  ),
  /** A teacher's lessons in other branches' published patterns: weekday, times, branch only (5.4b-1, decision 2). */
  busyElsewhere: z.array(
    z.object({
      id: z.uuid(),
      teacherId: z.uuid(),
      branchId: z.uuid(),
      weekday: z.int().min(1).max(7),
      start: z.int(),
      end: z.int(),
      tutorLesson: z.boolean(),
    }),
  ),
  otherDrafts: z.array(enginePlacementSchema),
  /** The names of the other branches met. */
  branches: z.array(z.object({ id: z.uuid(), name: z.string() })),
});

export type PatternFactsDataAnswer = z.infer<typeof patternFactsDataSchema>;

/**
 * A result of the rule engine (`RuleResult`): the rule (`RULE_ORDER`, its text
 * `timetable.rule.<code>`), its severity, its weekday (`null` when it names the
 * week: `teacher_week_load`, `load_mismatch`), the lessons involved and the
 * numbers that explain it.
 */
export const ruleResultSchema = z.object({
  rule: z.string().regex(/^[a-z_]+$/),
  severity: z.enum(['blocked', 'warning']),
  weekday: weekdaySchema.nullable(),
  lessonIds: z.array(z.string()),
  detail: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  /** A result of a date (task 5.5a-2a): its school date; `weekday` is the date's. */
  date: schoolDateSchema.optional(),
});

export type RuleResultAnswer = z.infer<typeof ruleResultSchema>;

/**
 * A placed block: a weekday, the position of its slot (breaks counted), its
 * minutes, one lesson per load row; task 5.4c-3a: the pair of a double lesson.
 */
export const gridBlockSchema = z.object({
  id: z.uuid(),
  weekday: weekdaySchema,
  slotPosition: z.int().min(1).max(PIN_SLOT_POSITION_MAX),
  start: z.int(),
  end: z.int(),
  lessons: z.array(z.object({ id: z.uuid(), loadRowId: z.uuid(), roomId: z.uuid().nullable() })),
  doublePairId: z.uuid().nullable(),
});

export type GridBlock = z.infer<typeof gridBlockSchema>;

/** A load row as a tile shows it. */
export const gridRowSchema = z.object({
  id: z.uuid(),
  unit: loadUnitSchema,
  subject: loadRowSchema.shape.subject.extend({ colour: subjectColourSchema }),
  teacher: loadTeacherSchema,
  lessonsPerWeek: z.int().min(1).max(LOAD_LESSONS_MAX),
  mixedBlock: z.boolean(),
});

export type GridRow = z.infer<typeof gridRowSchema>;

/** The kinds of lock (06, Auto-generation: "A lesson, a class, a teacher or a day can be locked"). */
export const TIMETABLE_LOCK_KINDS = ['block', 'class', 'teacher', 'day'] as const;

/** A lock of a draft (task 5.4c-1): a lesson by its block, a class, a teacher or vacancy, or a weekday. */
export const timetableLockRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('block'), blockId: z.uuid() }),
  z.strictObject({ kind: z.literal('class'), classId: z.uuid() }),
  z.strictObject({ kind: z.literal('teacher'), teacherId: z.uuid() }),
  z.strictObject({ kind: z.literal('day'), weekday: weekdaySchema }),
]);

export type TimetableLockRecord = z.infer<typeof timetableLockRecordSchema>;

export const timetableLockSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.uuid(), kind: z.literal('block'), blockId: z.uuid() }),
  z.object({ id: z.uuid(), kind: z.literal('class'), classId: z.uuid() }),
  z.object({ id: z.uuid(), kind: z.literal('teacher'), teacherId: z.uuid() }),
  z.object({ id: z.uuid(), kind: z.literal('day'), weekday: weekdaySchema }),
]);

export type TimetableLock = z.infer<typeof timetableLockSchema>;

export const timetableLockParamsSchema = z.object({ id: z.uuid(), lockId: z.uuid() });

export type TimetableLockParams = z.infer<typeof timetableLockParamsSchema>;

export const gridSchema = z.object({
  version: timetableVersionSchema,
  /** A draft is edited; a published or archived version is read only (decision 16). */
  editable: z.boolean(),
  /** Every class the rows occupy, a class a group draws from included (review correction 2). */
  classes: z.array(z.object({ id: z.uuid(), name: z.string(), grade: z.int() })),
  rows: z.array(gridRowSchema),
  rooms: z.array(z.object({ id: z.uuid(), name: z.string() })),
  blocks: z.array(gridBlockSchema),
  facts: patternFactsDataSchema,
  /** The pins of step 5 (task 5.4b-2b): "Suggest a place" never moves a block that holds one as a blocker. */
  pins: z.array(
    z.object({
      loadRowId: z.uuid(),
      weekday: weekdaySchema,
      slotPosition: z.int().min(1).max(PIN_SLOT_POSITION_MAX),
    }),
  ),
  /** The locks of the draft (task 5.4c-1): "Suggest a place" leaves what they hold where it is. */
  locks: z.array(timetableLockSchema),
  /** Every result of the draft's pattern now (the conflict panel of 5.4b lists them). */
  results: z.array(ruleResultSchema),
});

export type GridAnswer = z.infer<typeof gridSchema>;

const slotPositionSchema = z.int().min(1).max(PIN_SLOT_POSITION_MAX);

/** "A swap of two or three lessons" (06, Editing in the grid): the blocks one suggestion changes. */
export const REARRANGE_BLOCKS_MAX = 3;
/** The rooms of one change: one per lesson of its block. */
const REARRANGE_ROOMS_MAX = 20;

/**
 * The room of each lesson of a block, by load row; `null` is no room (task
 * 5.4c-2: an undo gives back a lesson that had none; the picker never sends it).
 */
const blockRoomsSchema = z
  .array(z.strictObject({ loadRowId: z.uuid(), roomId: z.uuid().nullable() }))
  .max(REARRANGE_ROOMS_MAX)
  .refine((rooms) => new Set(rooms.map((one) => one.loadRowId)).size === rooms.length, {
    message: 'One room per load row.',
  });

/**
 * A lesson placed by clicking an empty slot: a load row (with its whole block),
 * a weekday and a slot position; task 5.4b-2a: the room of the chosen row's
 * lesson from the room picker (the other lessons of its block take their new
 * lesson's room); task 5.4c-2: or the room of every lesson by load row, for
 * the undo of a removal; task 5.4c-3a: `double` places a double lesson, the
 * slot taking its first half and the next lesson slot its second (the rooms
 * apply to both halves); task 5.4c-3b: `partnerRowId` pairs a half of a mixed
 * split with a half of another subject's mixed split of the same class in one
 * block (without it, a mixed half takes its whole split).
 */
export const placeRecordSchema = z
  .strictObject({
    loadRowId: z.uuid(),
    partnerRowId: z.uuid().optional(),
    weekday: weekdaySchema,
    slotPosition: slotPositionSchema,
    roomId: z.uuid().optional(),
    rooms: blockRoomsSchema.optional(),
    double: z.boolean().optional(),
  })
  .refine((place) => place.roomId === undefined || place.rooms === undefined, {
    message: 'A room or the rooms of the block.',
    path: ['rooms'],
  });

export type PlaceRecord = z.infer<typeof placeRecordSchema>;

/** A block moved to a weekday and a slot position. */
export const moveRecordSchema = z.strictObject({
  weekday: weekdaySchema,
  slotPosition: slotPositionSchema,
});

export type MoveRecord = z.infer<typeof moveRecordSchema>;

/** Two blocks that exchange their slots. */
export const swapRecordSchema = z
  .strictObject({ blockIds: z.tuple([z.uuid(), z.uuid()]) })
  .refine((swap) => swap.blockIds[0] !== swap.blockIds[1], {
    message: 'Two different blocks.',
    path: ['blockIds'],
  });

export type SwapRecord = z.infer<typeof swapRecordSchema>;

/** The room of one lesson of a block, from the room picker (task 5.4b-2a). */
export const lessonRoomRecordSchema = z.strictObject({
  lessonId: z.uuid(),
  /** Task 5.4c-2: `null` gives back "no room" on an undo; the picker never sends it. */
  roomId: z.uuid().nullable(),
});

export type LessonRoomRecord = z.infer<typeof lessonRoomRecordSchema>;

/**
 * A suggestion of "Suggest a place" applied (task 5.4b-2b): one to three
 * changes, each a stored block moved (`blockId`) or a new block of a load row
 * placed (`loadRowId`, at most one), at a weekday and slot, with the rooms its
 * lessons take (by load row) where they change; task 5.4c-3b: a new block of a
 * pairing names its partner row (`partnerRowId`, with `loadRowId` only).
 */
export const rearrangeChangeSchema = z
  .strictObject({
    blockId: z.uuid().optional(),
    loadRowId: z.uuid().optional(),
    partnerRowId: z.uuid().optional(),
    weekday: weekdaySchema,
    slotPosition: slotPositionSchema,
    rooms: blockRoomsSchema.optional(),
  })
  .refine((change) => (change.blockId === undefined) !== (change.loadRowId === undefined), {
    message: 'A block or a load row.',
    path: ['blockId'],
  })
  .refine((change) => change.partnerRowId === undefined || change.loadRowId !== undefined, {
    message: 'A partner of a new block only.',
    path: ['partnerRowId'],
  });

export const rearrangeRecordSchema = z
  .strictObject({
    changes: z.array(rearrangeChangeSchema).max(REARRANGE_BLOCKS_MAX),
    /**
     * Task 5.4c-2: a block removed in the same transaction, for the undo of a
     * suggestion that created it (From 5.4b-2b line: "the rearrange route,
     * widened").
     */
    remove: z.array(z.uuid()).max(1).optional(),
  })
  .refine(
    (record) => {
      const total = record.changes.length + (record.remove ?? []).length;
      return total >= 1 && total <= REARRANGE_BLOCKS_MAX;
    },
    { message: 'One to three blocks.', path: ['changes'] },
  )
  .refine(
    (record) => {
      const blocks = [
        ...record.changes.flatMap((one) => (one.blockId === undefined ? [] : [one.blockId])),
        ...(record.remove ?? []),
      ];
      return new Set(blocks).size === blocks.length;
    },
    { message: 'Each block once.', path: ['changes'] },
  )
  .refine((record) => record.changes.filter((one) => one.loadRowId !== undefined).length <= 1, {
    message: 'At most one new block.',
    path: ['changes'],
  });

export type RearrangeRecord = z.infer<typeof rearrangeRecordSchema>;

export const patternBlockParamsSchema = z.object({ id: z.uuid(), blockId: z.uuid() });

/**
 * Why a publish is refused (task 5.5a-1, pull request #139): the start date
 * (`06`, How surprises are prevented, Start date), a later published version
 * (decision 3, until 5.5a-3), the mark "out of date" (decision 4), a step of
 * the builder not ready (decision 5), a problem of a load row, a blocked
 * result of the pattern, a difference from the load (`06`, Rules, last row),
 * and the year and subject settings (`edge/academic-year`: "Publishing is
 * blocked unless the year has four dated quarters and every subject in the
 * load has its journal type and, if it is graded, its daily distribution and
 * its quarterly distribution for each quarter the version touches").
 * Task 5.5a-2a: `date_blocked`, a blocked result that only a date of the
 * version shows (`edge/timetable`, "The pattern is valid but one date is
 * not": "A blocked conflict on any date stops the save and is listed by date").
 */
export const PUBLISH_REFUSALS = [
  'version_start_too_early',
  'version_start_outside_year',
  'version_later_published',
  'draft_out_of_date',
  'draft_not_ready',
  'load_problem',
  'pattern_blocked',
  'date_blocked',
  'load_mismatch',
  'year_quarters',
  'subject_daily_weights',
  'subject_quarter_weights',
  // Task 5.5a-2b-1, decision 11: a transition week that differs from the load, not acknowledged.
  'transition_unacknowledged',
  // Task 5.5a-3a: "carry the change into them" sent when it is not offered;
  // "run until" or "carry" on the start of a published version (decision 5);
  // later versions other than those shown (spec review of the plan, should-fix 2).
  'chain_carry_not_offered',
  'chain_start_taken',
  'chain_changed',
] as const;

export const publishRefusalCodeSchema = z.enum(PUBLISH_REFUSALS);

export type PublishRefusalCode = z.infer<typeof publishRefusalCodeSchema>;

/** The builder steps a publish requires besides the pattern's own check (decision 5). */
export const PUBLISH_STEPS = ['templates', 'load', 'teachers', 'rooms'] as const;

/** One reason a publish is refused, with what names it. */
export const publishRefusalSchema = z.object({
  code: publishRefusalCodeSchema,
  /** `draft_not_ready`: the step. */
  step: z.enum(PUBLISH_STEPS).optional(),
  /** `load_problem` and `load_mismatch`: the row; `load_problem` also names its problem. */
  loadRowId: z.uuid().optional(),
  problem: loadProblemSchema.optional(),
  /** `subject_daily_weights` and `subject_quarter_weights`: the subject; the second also its quarter, 1 to 4. */
  subjectId: z.uuid().optional(),
  quarter: z.int().min(1).max(4).optional(),
  /** `pattern_blocked`, `date_blocked` and `load_mismatch`: the result of the rule engine. */
  result: ruleResultSchema.optional(),
  /** `version_later_published`: the number of the published version. */
  versionNumber: z.int().min(1).optional(),
});

/**
 * The answer to a publish before a later published version (task 5.5a-3a;
 * `edge/timetable`, Versions and drafts: "'run until that version starts',
 * 'replace the versions that follow', or ... 'carry the change into them'").
 */
export const PUBLISH_CHAINS = ['run_until', 'replace', 'carry'] as const;

export const publishChainSchema = z.enum(PUBLISH_CHAINS);

export type PublishChain = z.infer<typeof publishChainSchema>;

export type PublishRefusal = z.infer<typeof publishRefusalSchema>;

/** A lesson of a date created as cancelled at publish (task 5.5a-2a): its pattern entries. */
export const cancelledLessonSchema = z.object({
  date: schoolDateSchema,
  reason: z.enum(['not_in_template', 'day_off']),
  entryIds: z.array(z.uuid()),
});

export type CancelledLesson = z.infer<typeof cancelledLessonSchema>;

/**
 * Why a dated lesson is "needs a teacher" at publish (task 5.5a-2a): a Tutor
 * row with no Tutor on the date, or whose Tutor of the date clashes
 * (decision 11); a worked weekday the teacher is not available on
 * (decision 9); a teacher inactive or left from a date after the start
 * (decision 10).
 */
export const NEEDS_TEACHER_REASONS = [
  'no_tutor',
  'tutor_clash',
  'not_available_real_day',
  'teacher_out',
] as const;

export const needsTeacherSchema = z.object({
  date: schoolDateSchema,
  entryId: z.uuid(),
  reason: z.enum(NEEDS_TEACHER_REASONS),
});

export type NeedsTeacherAnswer = z.infer<typeof needsTeacherSchema>;

/** The key of a transition week that differs from the load: SHA-256, lower hex (decision 11). */
export const transitionKeySchema = z.string().regex(/^[0-9a-f]{64}$/);

/** The kinds of change of the impact preview (task 5.5a-2b-1, decision 3). */
export const IMPACT_KINDS = ['created', 'moved', 'removed', 'changed'] as const;

/** Where lessons are, without their dates: the weekday of the pattern, the times, teacher and room. */
export const impactSlotSchema = z.object({
  weekday: weekdaySchema,
  start: z.int().min(0).max(1440),
  end: z.int().min(0).max(1440),
  /** Empty for a Tutor lesson with no Tutor on its dates. */
  teacherIds: z.array(z.uuid()),
  roomId: z.uuid().nullable(),
});

/** Lessons of one class or group and subject changed the same way on `count` dates (decision 5). */
export const impactChangeSchema = z.object({
  kind: z.enum(IMPACT_KINDS),
  unitId: z.uuid(),
  subjectId: z.uuid(),
  classIds: z.array(z.uuid()),
  before: impactSlotSchema.nullable(),
  after: impactSlotSchema.nullable(),
  count: z.int().min(1),
  firstDate: schoolDateSchema,
  lastDate: schoolDateSchema,
});

export type ImpactChangeAnswer = z.infer<typeof impactChangeSchema>;

/** A class or group and subject in the transition week (decision 10, review correction 1). */
export const transitionRowSchema = z.object({
  unitId: z.uuid(),
  subjectId: z.uuid(),
  before: z.int().min(0),
  after: z.int().min(0),
  lessonsPerWeek: z.int().min(0),
  differs: z.boolean(),
});

export type TransitionRowAnswer = z.infer<typeof transitionRowSchema>;

/**
 * The impact preview of a publish (task 5.5a-2b-1; `06`, How surprises are
 * prevented, Impact preview): the lessons created, moved, removed and changed
 * against the version in force before the start, the teachers, classes and
 * rooms affected, who will be notified, the lessons per week under each
 * vacancy, and the transition week. It names records of the branch only.
 */
export const publishImpactSchema = z.object({
  /** The published version the draft replaces from its start; `null` for a first publish. */
  beforeVersion: z.object({ id: z.uuid(), number: z.int().min(1) }).nullable(),
  counts: z.object({
    created: z.int().min(0),
    moved: z.int().min(0),
    removed: z.int().min(0),
    changed: z.int().min(0),
    unchanged: z.int().min(0),
  }),
  changes: z.array(impactChangeSchema),
  /** Decisions 6 and 7: a vacancy is never notified, a person only with an account. */
  teachers: z.array(z.object({ id: z.uuid(), vacancy: z.boolean(), notified: z.boolean() })),
  classIds: z.array(z.uuid()),
  roomIds: z.array(z.uuid()),
  /** Decision 8: every vacancy of the draft's pattern. */
  vacancies: z.array(z.object({ id: z.uuid(), lessonsPerWeek: z.int().min(0) })),
  /** Decision 10: `null` when no date of the start's week before it has lessons. */
  transition: z
    .object({
      weekStart: schoolDateSchema,
      weekEnd: schoolDateSchema,
      rows: z.array(transitionRowSchema),
      /** Decision 11: the key a publish sends back; `null` when no row differs. */
      key: transitionKeySchema.nullable(),
    })
    .nullable(),
  /**
   * Task 5.5a-3a (decision 7, spec review must-fix 1): under "carry", each
   * carried version's lessons over its own run, before and after the change;
   * their teachers, classes and rooms are counted above.
   */
  carried: z.array(
    z.object({
      versionId: z.uuid(),
      number: z.int().min(1),
      counts: z.object({
        created: z.int().min(0),
        moved: z.int().min(0),
        removed: z.int().min(0),
        changed: z.int().min(0),
        unchanged: z.int().min(0),
      }),
      changes: z.array(impactChangeSchema),
    }),
  ),
  /** The names of what the preview names (decision 12). */
  names: z.object({
    units: z.array(
      z.object({
        id: z.uuid(),
        kind: z.enum(['class', 'group']),
        name: z.string(),
        grades: z.array(z.int()),
      }),
    ),
    subjects: z.array(
      z.object({
        id: z.uuid(),
        names: z.object({ uz: z.string(), ru: z.string(), en: z.string() }),
      }),
    ),
    teachers: z.array(z.object({ id: z.uuid(), name: z.string() })),
    rooms: z.array(z.object({ id: z.uuid(), name: z.string() })),
  }),
});

export type PublishImpactAnswer = z.infer<typeof publishImpactSchema>;

/** One change carried into later versions (task 5.5a-3a, decision 4): a row's teacher or room, an entry's room. */
export const carryChangeSchema = z.object({
  kind: z.enum(['teacher', 'row_room', 'entry_room']),
  classId: z.uuid().nullable(),
  groupId: z.uuid().nullable(),
  subjectId: z.uuid(),
  /** `entry_room`: the entry's weekday and slot position. */
  weekday: weekdaySchema.optional(),
  slotPosition: z.int().min(1).max(20).optional(),
  before: z.uuid().nullable(),
  after: z.uuid().nullable(),
});

export type CarryChangeAnswer = z.infer<typeof carryChangeSchema>;

/**
 * The later published versions of a publish and what each answer does to
 * them (task 5.5a-3a). `key` goes back with the publish (`laterKey`).
 */
export const publishChainAnswerSchema = z.object({
  key: transitionKeySchema,
  later: z.array(z.object({ id: z.uuid(), number: z.int().min(1), startsOn: schoolDateSchema })),
  carryOffered: z.boolean(),
  /** Why carry is not offered: no source, nothing changed, or another change. */
  carryReason: z.enum(['no_source', 'nothing_changed', 'other_changes']).nullable(),
  changes: z.array(carryChangeSchema),
  /** With `chain=carry`: each later version, carried or left as it is (decision 8). */
  carried: z.array(
    z.object({
      versionId: z.uuid(),
      number: z.int().min(1),
      startsOn: schoolDateSchema,
      /** The number of changes the version takes; 0: nothing to carry. */
      applied: z.int().min(0),
      left: z.boolean(),
      refusals: z.array(publishRefusalSchema),
    }),
  ),
});

export type PublishChainAnswer = z.infer<typeof publishChainAnswerSchema>;

/** The start date a publish is checked on. */
export const publishCheckQuerySchema = z.object({
  startsOn: schoolDateSchema,
  /** Task 5.5a-3a: the answer the check and the preview follow. */
  chain: publishChainSchema.optional(),
});

export type PublishCheckQuery = z.infer<typeof publishCheckQuerySchema>;

/** A publish (decision 7): the start date, the draft's or a changed one. */
export const publishBodySchema = z.strictObject({
  startsOn: schoolDateSchema,
  /**
   * Task 5.5a-2b-1, decision 11: the key of the transition week shown
   * (`PublishImpact.transition.key`), when it differs from the load.
   */
  transitionKey: transitionKeySchema.optional(),
  /** Task 5.5a-3a: the answer to the later published versions, with the key of those shown. */
  chain: publishChainSchema.optional(),
  laterKey: transitionKeySchema.optional(),
});

export type PublishBody = z.infer<typeof publishBodySchema>;

/**
 * A date shortened for a class (task 5.5a-2b-2, edge/time-dates-calendar, "A
 * shortened day"): the lesson slots of the day, the class's lessons on the
 * weekday the date follows (their slot positions and pattern entries), the
 * positions kept (the stored choice, or by their order in the day) and the
 * stored positions that hold no lesson of the class (decision 11).
 */
export const shortenedDaySchema = z.object({
  date: schoolDateSchema,
  classId: z.uuid(),
  lessonSlots: z.int().min(0),
  lessons: z.array(
    z.object({
      slotPosition: z.int().min(1).max(PIN_SLOT_POSITION_MAX),
      entryIds: z.array(z.uuid()),
    }),
  ),
  kept: z.array(z.int().min(1).max(PIN_SLOT_POSITION_MAX)),
  chosen: z.boolean(),
  missingPositions: z.array(z.int().min(1).max(PIN_SLOT_POSITION_MAX)),
});

export type ShortenedDay = z.infer<typeof shortenedDaySchema>;

/**
 * The choice of the lessons a class keeps on a shortened day of a draft (task
 * 5.5a-2b-2, decision 2): the slot positions of the lessons kept, breaks
 * included, in the template of the weekday the date follows. An empty list
 * removes the choice (decision 6).
 */
export const dayKeepBodySchema = z.strictObject({
  classId: z.uuid(),
  date: schoolDateSchema,
  slotPositions: z
    .array(z.int().min(1).max(PIN_SLOT_POSITION_MAX))
    .max(PIN_SLOT_POSITION_MAX)
    .refine((list) => new Set(list).size === list.length, { message: 'Each slot once.' }),
});

export type DayKeepBody = z.infer<typeof dayKeepBodySchema>;

/** A choice as stored, the positions in their order in the day. */
export const dayKeepSchema = z.object({
  classId: z.uuid(),
  date: schoolDateSchema,
  slotPositions: z.array(z.int().min(1).max(PIN_SLOT_POSITION_MAX)),
});

export type DayKeep = z.infer<typeof dayKeepSchema>;

/**
 * What a publish on a date would do, written nowhere (decision 13): the dates
 * offered (decision 15), every refusal and the warnings of the pattern.
 */
export const publishCheckSchema = z.object({
  startsOn: schoolDateSchema,
  earliest: schoolDateSchema,
  defaultStart: schoolDateSchema,
  quarterStarts: z.array(schoolDateSchema),
  refusals: z.array(publishRefusalSchema),
  warnings: z.array(ruleResultSchema),
  /**
   * Task 5.5a-2a, decision 7: the lessons the day's template cannot hold, a
   * group of two grades on a date off for one of them; created as cancelled,
   * never refusing (`edge/timetable`, "The pattern is valid but one date is
   * not", first exception). An exam week's cancelled lessons are not listed.
   */
  cancelledLessons: z.array(cancelledLessonSchema),
  /** Decisions 9 to 11: lessons that will be "needs a teacher", listed, not refused. */
  needsTeacher: z.array(needsTeacherSchema),
  /** Task 5.5a-2b-1: `null` while the start date itself is refused (nothing else is read then). */
  impact: publishImpactSchema.nullable(),
  /** Task 5.5a-2b-2: the dates shortened for a class, with the lessons kept. */
  shortenedDays: z.array(shortenedDaySchema),
  /** Task 5.5a-2b-2, decisions 3 and 11: stored choices that decide nothing on their date. */
  unusedKeeps: z.array(z.object({ date: schoolDateSchema, classId: z.uuid() })),
  /** Task 5.5a-3a: `null` when no published version of the year starts on or after the start. */
  chain: publishChainAnswerSchema.nullable(),
  canPublish: z.boolean(),
});

export type PublishCheck = z.infer<typeof publishCheckSchema>;

/**
 * The changes that mark a draft out of date (task 5.5a-3b-1, decision 2), by
 * their audit action; the same list as the check of 0077.
 * docs/spec/edge-cases/timetable.md, Versions and drafts: "Any publish, or any
 * change to templates, calendar, availability or rooms, marks the other drafts
 * out of date."
 */
export const OUT_OF_DATE_ACTIONS = {
  'timetable_version.publish': 'publish',
  'calendar_entry.create': 'calendar',
  'calendar_entry.edit': 'calendar',
  'calendar_entry.archive': 'calendar',
  'calendar_entry.restore': 'calendar',
  'slot_type.length_change': 'templates',
  'day_template.version_create': 'templates',
  'day_template_assignment.set': 'templates',
  'day_template_assignment.end': 'templates',
  'staff.availability_set': 'availability',
  'staff.availability_end': 'availability',
  'room.edit': 'rooms',
} as const;

export type OutOfDateAction = keyof typeof OUT_OF_DATE_ACTIONS;

export const outOfDateActionSchema = z.enum(
  Object.keys(OUT_OF_DATE_ACTIONS) as [OutOfDateAction, ...OutOfDateAction[]],
);

export const OUT_OF_DATE_KINDS = [
  'publish',
  'calendar',
  'templates',
  'availability',
  'rooms',
] as const;

export const outOfDateKindSchema = z.enum(OUT_OF_DATE_KINDS);

export type OutOfDateKind = z.infer<typeof outOfDateKindSchema>;

/** One cause of the mark, oldest first, with the record it names. */
export const outOfDateCauseSchema = z.object({
  id: z.uuid(),
  kind: outOfDateKindSchema,
  action: outOfDateActionSchema,
  causedAt: z.iso.datetime({ offset: true }),
  /**
   * The record changed: its name (a calendar entry, template, slot type, staff
   * member or room), the dates of a calendar entry, the number of a published
   * version. `null` when it cannot be read any more, or for a publish that
   * marked the draft before the causes were kept (decision 6).
   */
  record: z
    .object({
      id: z.uuid(),
      name: z.string().nullable(),
      firstDate: schoolDateSchema.nullable(),
      lastDate: schoolDateSchema.nullable(),
      versionNumber: z.int().min(1).nullable(),
    })
    .nullable(),
});

export type OutOfDateCause = z.infer<typeof outOfDateCauseSchema>;

/** A side of a difference of a draft brought up to date after a publish (task 5.5a-3b-2). */
export const UP_TO_DATE_SIDES = ['draft', 'published'] as const;

export const upToDateSideSchema = z.enum(UP_TO_DATE_SIDES);

export type UpToDateSide = z.infer<typeof upToDateSideSchema>;

/** What one side (the version the draft started from, the draft, the published version) holds of a load row. */
export const upToDateValuesSchema = z.object({
  /** `null` for a Tutor row: its teacher follows the Tutor (decision 6). */
  teacherId: z.uuid().nullable(),
  teacherName: z.string().nullable(),
  roomId: z.uuid().nullable(),
  roomName: z.string().nullable(),
  lessonsPerWeek: z.int().min(0),
  roomType: z.string().nullable(),
  doubleLessons: z.boolean(),
  mixedBlock: z.boolean(),
  shortReason: z.string().nullable(),
  /** The lessons of the row in the weekly pattern, by weekday and slot position. */
  placements: z.array(
    z.object({
      weekday: weekdaySchema,
      slotPosition: z.int().min(1),
      roomId: z.uuid().nullable(),
      roomName: z.string().nullable(),
      /** The keys of the other rows of its block. */
      with: z.array(z.string()),
      /** The slot of the other half of a double; `null` for a single lesson. */
      pairedWith: z.object({ weekday: weekdaySchema, slotPosition: z.int().min(1) }).nullable(),
    }),
  ),
  pins: z.array(z.object({ weekday: weekdaySchema, slotPosition: z.int().min(1) })),
});

export type UpToDateValues = z.infer<typeof upToDateValuesSchema>;

/**
 * One difference between the draft and the published version it is compared
 * with, picked whole (task 5.5a-3b-2, decisions 5 and 7): its rows, who
 * changed it against the version the draft started from, the default pick.
 */
export const upToDateItemSchema = z.object({
  key: z.string(),
  rows: z.array(
    z.object({
      key: z.string(),
      classId: z.uuid().nullable(),
      groupId: z.uuid().nullable(),
      /** The class's or group's name. */
      unitName: z.string(),
      subjectId: z.uuid(),
      subjectNames: z.object({ uz: z.string(), ru: z.string(), en: z.string() }),
      tutorRow: z.boolean(),
      base: upToDateValuesSchema.nullable(),
      draft: upToDateValuesSchema.nullable(),
      published: upToDateValuesSchema.nullable(),
    }),
  ),
  changedBy: z.enum(['draft', 'published', 'both']),
  defaultPick: upToDateSideSchema.nullable(),
});

export type UpToDateItem = z.infer<typeof upToDateItemSchema>;

/**
 * The causes of a draft's mark and the key that bringing it up to date sends
 * back. Task 5.5a-3b-2: with a publish cause, the published version compared
 * (decision 3), the version the draft started from, and the differences.
 */
export const outOfDateAnswerSchema = z.object({
  causes: z.array(outOfDateCauseSchema),
  key: transitionKeySchema,
  other: z.object({ id: z.uuid(), number: z.int().min(1), startsOn: schoolDateSchema }).nullable(),
  base: z.object({ id: z.uuid(), number: z.int().min(1) }).nullable(),
  items: z.array(upToDateItemSchema),
});

export type OutOfDateAnswer = z.infer<typeof outOfDateAnswerSchema>;

/** Bringing a draft up to date: the key of what was shown, and a pick for every difference (task 5.5a-3b-2). */
export const upToDateBodySchema = z.strictObject({
  key: transitionKeySchema,
  picks: z
    .array(z.strictObject({ item: z.string().min(1).max(2000), side: upToDateSideSchema }))
    .max(2000)
    .default([]),
});

export type UpToDateBody = z.infer<typeof upToDateBodySchema>;
