import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { lessonStateSchema, roomOutCauseSchema } from './timetable.js';

/**
 * Room closures (task 5.7a-2b, pull request #187; docs/spec/edge-cases/
 * timetable.md, After publishing: "A laboratory is under repair for three
 * weeks. A room closure has a start, an end and a reason. Lessons in the
 * range go to 'needs a room', with 'move all to room R for the period'. The
 * pattern is unchanged and the lessons return afterwards.").
 *
 * The days are typed; the rule compares the moments stored from them, as for
 * an absence (decision 4): a closure entered today starts at the save, and an
 * end set to the day before today ends it at the save, so a lesson that has
 * started keeps what it was.
 */

/** The longest reason, as `room_closures_reason_check` (0098) allows. */
export const ROOM_CLOSURE_REASON_MAX = 500;

const dayBefore = (date: string): string => {
  const moment = new Date(`${date}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() - 1);
  return moment.toISOString().slice(0, 10);
};

/** A new closure; both days required (decision 3). */
export const roomClosureRecordSchema = z
  .strictObject({
    roomId: z.uuid(),
    startsOn: schoolDateSchema,
    endsOn: schoolDateSchema,
    reason: z.string().trim().min(1).max(ROOM_CLOSURE_REASON_MAX),
  })
  .refine((body) => body.endsOn >= body.startsOn, {
    path: ['endsOn'],
    message: 'The last day is on or after the first.',
  });

export type RoomClosureRecord = z.infer<typeof roomClosureRecordSchema>;

/**
 * A change of the days. The last day may be the day before the first only
 * for a closure that started today: it ends at the save; the server decides
 * the rest.
 */
export const roomClosureEditSchema = z
  .strictObject({
    startsOn: schoolDateSchema,
    endsOn: schoolDateSchema,
  })
  .refine((body) => body.endsOn >= dayBefore(body.startsOn), {
    path: ['endsOn'],
    message: 'The last day is on or after the day before the first.',
  });

export type RoomClosureEdit = z.infer<typeof roomClosureEditSchema>;

export const roomClosureParamsSchema = z.object({ id: z.uuid() });

export type RoomClosureParams = z.infer<typeof roomClosureParamsSchema>;

export const roomClosuresQuerySchema = z.object({
  /** `open`: current and planned (the default); `all`: withdrawn and ended too. */
  state: z.enum(['open', 'all']).default('open'),
});

export type RoomClosuresQuery = z.infer<typeof roomClosuresQuerySchema>;

export const ROOM_CLOSURE_STATES = ['planned', 'current', 'ended', 'withdrawn'] as const;

/** A closure as the list and the side panel show it. */
export const roomClosureSchema = z.object({
  id: z.uuid(),
  room: z.object({ id: z.uuid(), name: z.string() }),
  startsOn: schoolDateSchema,
  endsOn: schoolDateSchema,
  reason: z.string(),
  state: z.enum(ROOM_CLOSURE_STATES),
  /** Not withdrawn and not ended at the moment of the request. */
  canEdit: z.boolean(),
  /** Not started at the moment of the request. */
  canWithdraw: z.boolean(),
});

export type RoomClosure = z.infer<typeof roomClosureSchema>;

export const roomClosureListSchema = z.object({
  closures: z.array(roomClosureSchema),
  /** Today in branch time: the first day a new closure may take. */
  today: schoolDateSchema,
});

export type RoomClosureList = z.infer<typeof roomClosureListSchema>;

const names = z.object({ uz: z.string(), ru: z.string(), en: z.string() });

/** A lesson of the closed room that starts inside the closure. */
export const roomClosureLessonSchema = z.object({
  id: z.uuid(),
  date: schoolDateSchema,
  /** Clock minutes of the day in branch time, half-open. */
  start: z.int().min(0),
  end: z.int().min(1),
  unit: z.string(),
  subject: names,
  teacher: z.string().nullable(),
  state: lessonStateSchema,
  /** `needsRoomOf` (decision 2): not started, not cancelled, still in the closed room. */
  needsRoom: z.boolean(),
});

export type RoomClosureLesson = z.infer<typeof roomClosureLessonSchema>;

export const roomClosureLessonsSchema = z.object({ lessons: z.array(roomClosureLessonSchema) });

export type RoomClosureLessons = z.infer<typeof roomClosureLessonsSchema>;

/** "Move all to room R for the period" (decision 6): every lesson that needs a room by the closure. */
export const roomClosureMoveSchema = z.strictObject({
  roomId: z.uuid(),
  reason: z.string().trim().min(1).max(ROOM_CLOSURE_REASON_MAX),
});

export type RoomClosureMove = z.infer<typeof roomClosureMoveSchema>;

export const roomClosureMoveAnswerSchema = z.object({
  /** The lessons moved, the halves of a double each counted. */
  moved: z.int().min(1),
});

export type RoomClosureMoveAnswer = z.infer<typeof roomClosureMoveAnswerSchema>;

/**
 * One row of the home page's "Lessons that need a room" (decision 7): the
 * lessons of one closure, or of one room by its status.
 */
export const attentionRoomSchema = z.object({
  cause: roomOutCauseSchema,
  room: z.object({ id: z.uuid(), name: z.string() }),
  /** The closure of a `closure` row; `null` for a room by its status. */
  closure: z
    .object({ id: z.uuid(), startsOn: schoolDateSchema, endsOn: schoolDateSchema })
    .nullable(),
  lessons: z.int().min(1),
  firstDate: schoolDateSchema,
  lastDate: schoolDateSchema,
});

export type AttentionRoom = z.infer<typeof attentionRoomSchema>;

/**
 * An exam of the branch not started and not cancelled with a room out at its
 * start (decision 10): "Exams that need a room".
 */
export const attentionExamRoomSchema = z.object({
  examId: z.uuid(),
  title: z.string(),
  date: schoolDateSchema,
  /** Clock minutes of the day in branch time, half-open. */
  start: z.int().min(0),
  end: z.int().min(1),
  rooms: z.array(z.object({ id: z.uuid(), name: z.string(), cause: roomOutCauseSchema })),
});

export type AttentionExamRoom = z.infer<typeof attentionExamRoomSchema>;
