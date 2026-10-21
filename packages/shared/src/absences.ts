import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { attentionExamRoomSchema, attentionRoomSchema } from './room-closures.js';
import { awayCauseSchema, lessonStateSchema } from './timetable.js';

/**
 * Teacher absences (task 5.7a-1, pull request #185; docs/spec/06-timetable.md,
 * Teachers who work in several branches: "An absence is entered once for the
 * person and covers every branch"; edge-cases/timetable.md, After publishing:
 * "An absence record has a start and an end, or is open-ended. All lessons in
 * the range go to 'needs a teacher'. ... Shortening the absence returns
 * future lessons to the teacher. After 10 school days the system suggests a
 * permanent change.").
 *
 * The days are typed; the rule compares the moments stored from them
 * (decision 5): an absence entered today starts at the save, and an end set
 * to the day before today ends it at the save, so a lesson that has started
 * keeps its state.
 */

/** The longest reason, as `absences_reason_check` (0096) allows. */
export const ABSENCE_REASON_MAX = 500;

/** "After 10 school days the system suggests a permanent change" (decision 10). */
export const ABSENCE_PERMANENT_DAYS = 10;

const dayBefore = (date: string): string => {
  const moment = new Date(`${date}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() - 1);
  return moment.toISOString().slice(0, 10);
};

/** A new absence. */
export const absenceRecordSchema = z
  .strictObject({
    staffId: z.uuid(),
    startsOn: schoolDateSchema,
    /** `null`: open-ended. */
    endsOn: schoolDateSchema.nullable(),
    reason: z.string().trim().min(1).max(ABSENCE_REASON_MAX),
  })
  .refine((body) => body.endsOn === null || body.endsOn >= body.startsOn, {
    path: ['endsOn'],
    message: 'The last day is on or after the first.',
  });

export type AbsenceRecord = z.infer<typeof absenceRecordSchema>;

/**
 * A change of the days. The last day may be the day before the first only
 * for an absence that started today: it ends at the save (review correction
 * 1); the server decides the rest.
 */
export const absenceEditSchema = z
  .strictObject({
    startsOn: schoolDateSchema,
    endsOn: schoolDateSchema.nullable(),
  })
  .refine((body) => body.endsOn === null || body.endsOn >= dayBefore(body.startsOn), {
    path: ['endsOn'],
    message: 'The last day is on or after the day before the first.',
  });

export type AbsenceEdit = z.infer<typeof absenceEditSchema>;

export const absenceParamsSchema = z.object({ id: z.uuid() });

export type AbsenceParams = z.infer<typeof absenceParamsSchema>;

export const absencesQuerySchema = z.object({
  /** `open`: current and planned (the default); `all`: withdrawn and ended too. */
  state: z.enum(['open', 'all']).default('open'),
});

export type AbsencesQuery = z.infer<typeof absencesQuerySchema>;

export const ABSENCE_STATES = ['planned', 'current', 'ended', 'withdrawn'] as const;

/** An absence as the list and the side panel show it. */
export const absenceSchema = z.object({
  id: z.uuid(),
  staff: z.object({ id: z.uuid(), name: z.string() }),
  startsOn: schoolDateSchema,
  /** `null`: open-ended. */
  endsOn: schoolDateSchema.nullable(),
  reason: z.string(),
  state: z.enum(ABSENCE_STATES),
  /** Not withdrawn and not ended at the moment of the request. */
  canEdit: z.boolean(),
  /** Not started at the moment of the request (decision 5). */
  canWithdraw: z.boolean(),
  /**
   * Task 5.7b-2 (decisions 1 and 2): what a shortening or a withdraw did to
   * the substitutions made for the absence in the branch of the request: the
   * lessons returned to the teacher, and those kept with their substitute
   * because the return clashes, with the rules. Only on the answer of a
   * change.
   */
  returns: z
    .object({
      returned: z.array(z.uuid()),
      kept: z.array(
        z.object({
          lessonId: z.uuid(),
          date: schoolDateSchema,
          rules: z.array(z.string().regex(/^[a-z_]+$/)),
        }),
      ),
    })
    .optional(),
});

export type Absence = z.infer<typeof absenceSchema>;

export const absenceListSchema = z.object({ absences: z.array(absenceSchema) });

export type AbsenceList = z.infer<typeof absenceListSchema>;

const names = z.object({ uz: z.string(), ru: z.string(), en: z.string() });

/** A lesson of the branch inside an absence: "the list of own affected lessons". */
export const absenceLessonSchema = z.object({
  id: z.uuid(),
  date: schoolDateSchema,
  /** Clock minutes of the day in branch time, half-open. */
  start: z.int().min(0),
  end: z.int().min(1),
  unit: z.string(),
  subject: names,
  room: z.string().nullable(),
  state: lessonStateSchema,
  /** Task 5.7b-2: the substitute in force on the lesson, `null` for none. */
  substitute: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** Task 5.7b-2: the lesson's journal, for the per-journal action; `null` before a publish opened one. */
  journalId: z.uuid().nullable(),
});

export type AbsenceLesson = z.infer<typeof absenceLessonSchema>;

export const absenceLessonsSchema = z.object({ lessons: z.array(absenceLessonSchema) });

export type AbsenceLessons = z.infer<typeof absenceLessonsSchema>;

/**
 * One row of the home page's "needs a teacher" or "unresolved" list
 * (decision 9): the lessons of one cause, a person away (absent, inactive,
 * left or locked; task 5.7a-2a), a vacancy or nobody recorded.
 */
export const attentionGroupSchema = z.object({
  cause: z.enum(['absence', 'inactive', 'left', 'locked', 'vacancy', 'nobody']),
  /** The person or the vacancy; `null` for nobody recorded. */
  teacher: z
    .object({ id: z.uuid(), kind: z.enum(['person', 'vacancy']), name: z.string() })
    .nullable(),
  absence: z
    .object({ id: z.uuid(), startsOn: schoolDateSchema, endsOn: schoolDateSchema.nullable() })
    .nullable(),
  lessons: z.int().min(1),
  firstDate: schoolDateSchema,
  lastDate: schoolDateSchema,
  /** The absence has covered 10 school days of the branch up to today (decision 10). */
  suggestPermanent: z.boolean(),
});

export type AttentionGroup = z.infer<typeof attentionGroupSchema>;

/**
 * An exam of the branch not started and not cancelled with an invigilator
 * away at its start (task 5.7a-2a, decision 9): "needs an invigilator".
 */
export const attentionExamSchema = z.object({
  examId: z.uuid(),
  title: z.string(),
  date: schoolDateSchema,
  /** Clock minutes of the day in branch time, half-open. */
  start: z.int().min(0),
  end: z.int().min(1),
  invigilators: z.array(z.object({ id: z.uuid(), name: z.string(), cause: awayCauseSchema })),
});

export type AttentionExam = z.infer<typeof attentionExamSchema>;

export const attentionSchema = z.object({
  needsTeacher: z.array(attentionGroupSchema),
  unresolved: z.array(attentionGroupSchema),
  needsInvigilator: z.array(attentionExamSchema),
  /** Task 5.7a-2b (decisions 2 and 7): the lessons not started whose room is out. */
  needsRoom: z.array(attentionRoomSchema),
  /** Task 5.7a-2b (decision 10): the exams not started with a room out at their start. */
  examsNeedRoom: z.array(attentionExamRoomSchema),
});

export type Attention = z.infer<typeof attentionSchema>;
