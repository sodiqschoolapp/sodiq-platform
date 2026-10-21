import { z } from 'zod';
import { schoolDateSchema, type SchoolDate } from './academic-year.js';
import { dayLessonSchema, daySlotSchema } from './day-changes.js';

/**
 * The timetable views (task 5.9a, pull request #197; `06`, Views and outputs:
 * "Views by class, by teacher, by room and the whole school; by day and by
 * week"). Read only, built from the dated lessons with every one-day change
 * applied (decision 5): "The platform always shows the timetable in force on
 * the date being viewed" (`06`, How surprises are prevented, One source).
 */

export const VIEW_KINDS = ['branch', 'class', 'teacher', 'room'] as const;

export type ViewKind = (typeof VIEW_KINDS)[number];

export const VIEW_SPANS = ['day', 'week'] as const;

export type ViewSpan = (typeof VIEW_SPANS)[number];

const span = z.enum(VIEW_SPANS);

/** Without a date: today in the branch, which the answer names (`today`). */
export const viewChoicesQuerySchema = z.object({ date: schoolDateSchema.optional() });

export type ViewChoicesQuery = z.infer<typeof viewChoicesQuerySchema>;

export const branchViewQuerySchema = z.object({ date: schoolDateSchema, span });

export type BranchViewQuery = z.infer<typeof branchViewQuerySchema>;

export const classViewQuerySchema = z.object({ date: schoolDateSchema, span, classId: z.uuid() });

export type ClassViewQuery = z.infer<typeof classViewQuerySchema>;

/** A teacher view names a staff record of a person or a vacancy (both are `staff` rows). */
export const teacherViewQuerySchema = z.object({ date: schoolDateSchema, span, staffId: z.uuid() });

export type TeacherViewQuery = z.infer<typeof teacherViewQuerySchema>;

export const roomViewQuerySchema = z.object({ date: schoolDateSchema, span, roomId: z.uuid() });

export type RoomViewQuery = z.infer<typeof roomViewQuerySchema>;

const named = z.object({ id: z.uuid(), name: z.string() });

/** What the caller may open on a date (decision 3, the scope table of the plan). */
export const viewChoicesSchema = z.object({
  today: schoolDateSchema,
  branch: z.boolean(),
  classes: z.array(named),
  teachers: z.array(named.extend({ kind: z.enum(['person', 'vacancy']) })),
  rooms: z.array(named),
  /** The caller's own staff record in the branch, or `null`. */
  own: z.uuid().nullable(),
});

export type ViewChoices = z.infer<typeof viewChoicesSchema>;

/** A day of the view's span. */
export const viewDaySchema = z.object({
  date: schoolDateSchema,
  /** Outside every academic year of the branch: nothing else is listed (spec review should-fix 5). */
  outsideYear: z.boolean(),
  /** The name of the day off, or `null`. */
  dayOff: z.string().nullable(),
  /** The published version in force on the date (decision 10), or `null`. */
  version: z.object({ number: z.int().min(1), startsOn: schoolDateSchema }).nullable(),
  /**
   * The version in force was published before 0079 and has no dated lessons:
   * the day is read from its pattern, one-day changes not included (decision 13).
   */
  fromPattern: z.boolean(),
  /** Lesson numbers, or clock time when the day's lessons come from templates with different times (decision 9). */
  axis: z.enum(['slots', 'clock']),
  /** The lesson slots of the day on the `slots` axis (the class's, or the one template's); none on `clock`. */
  slots: z.array(daySlotSchema),
});

export type ViewDay = z.infer<typeof viewDaySchema>;

/** A lesson as the views show it: the day page's lesson without its action flags. */
export const viewLessonSchema = dayLessonSchema
  .omit({ canCancel: true, canRestore: true, canCorrect: true, canSubstitute: true })
  .extend({
    /** The class, or the classes the group draws from: the rows of the school view. */
    classIds: z.array(z.uuid()),
    /** Its number among the lesson slots of its class's day, `null` when no slot has its times. */
    lessonNumber: z.int().min(1).nullable(),
    /**
     * On a teacher view: the lesson was this teacher's and a substitute took it
     * (decision 7), shown "Replaced by <name>".
     */
    replacedHere: z.boolean(),
  });

export type ViewLesson = z.infer<typeof viewLessonSchema>;

/** A standing exam of the view, marked "exam" (`06`, Exam). */
export const viewExamSchema = z.object({
  id: z.uuid(),
  date: schoolDateSchema,
  title: z.string(),
  subject: z
    .object({ id: z.uuid(), names: z.object({ uz: z.string(), ru: z.string(), en: z.string() }) })
    .nullable(),
  start: z.int().min(0),
  end: z.int().min(1),
  /** The rooms of the exam the view shows, each with the classes it holds and its invigilators. */
  rooms: z.array(
    z.object({
      room: named,
      classIds: z.array(z.uuid()),
      units: z.array(z.string()),
      invigilators: z.array(z.string()),
    }),
  ),
});

export type ViewExam = z.infer<typeof viewExamSchema>;

/** A lesson or exam of the teacher in another branch: a grey block (decision 8). */
export const viewBusySchema = z.object({
  date: schoolDateSchema,
  start: z.int().min(0),
  end: z.int().min(1),
  branch: named,
});

export type ViewBusy = z.infer<typeof viewBusySchema>;

export const timetableViewSchema = z.object({
  kind: z.enum(VIEW_KINDS),
  span,
  today: schoolDateSchema,
  /** The class, teacher or room shown; `null` for the school view. */
  subject: named.nullable(),
  /** The classes of the school view in order (the class itself on a class view). */
  classes: z.array(named),
  days: z.array(viewDaySchema),
  lessons: z.array(viewLessonSchema),
  exams: z.array(viewExamSchema),
  busy: z.array(viewBusySchema),
});

export type TimetableView = z.infer<typeof timetableViewSchema>;

const DAY_MS = 86_400_000;

function dateOfUtc(at: number): SchoolDate {
  return new Date(at).toISOString().slice(0, 10);
}

/** The dates of a view's span: the date, or Monday to Sunday of its week (decision 6). */
export function viewDates(date: SchoolDate, viewSpan: ViewSpan): SchoolDate[] {
  if (viewSpan === 'day') return [date];
  const at = Date.parse(`${date}T00:00:00Z`);
  // getUTCDay: 0 is Sunday; the week starts on Monday.
  const monday = at - ((new Date(at).getUTCDay() + 6) % 7) * DAY_MS;
  return Array.from({ length: 7 }, (_, index) => dateOfUtc(monday + index * DAY_MS));
}

/** The times of a template's lesson slots on a day. */
export type SlotTimes = readonly { readonly start: number; readonly end: number }[];

/**
 * The axis of a teacher or room view's day (decision 9; `edge/timetable`,
 * Structure: "Teacher and room views use a clock axis when more than one
 * template is in force"): clock when the day's lessons and exams come from
 * templates whose lesson slots differ in time, or when the day holds a busy
 * block of another branch, which has clock times only; else lesson numbers.
 */
export function viewAxisOf(templates: readonly SlotTimes[], busy: boolean): 'slots' | 'clock' {
  if (busy) return 'clock';
  const distinct = new Set(
    templates.map((slots) => slots.map((slot) => `${slot.start}-${slot.end}`).join(',')),
  );
  return distinct.size > 1 ? 'clock' : 'slots';
}
