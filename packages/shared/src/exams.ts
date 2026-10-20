import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { DAY_CHANGE_REASON_MAX } from './day-changes.js';

/**
 * Exams in the timetable (task 5.6c-1, pull request #181; docs/spec/
 * 06-timetable.md, Changes after publishing, Exam: "A timetabled exam on one
 * date: a title, a subject if it has one, one or more consecutive lesson
 * slots of the day template (the breaks between them included), the classes
 * that sit it, and one or more rooms, each with the classes it holds and one
 * or more invigilators. A class sits in one room; an invigilator is any
 * active staff member, never a vacancy."; edge-cases/timetable.md, Exams).
 */

/** The longest title, as `exams_title_check` (0060) allows. */
export const EXAM_TITLE_MAX = 200;

/** The most rooms of one exam, and the longest range of the exam list in days. */
export const EXAM_ROOMS_MAX = 20;
export const EXAM_RANGE_DAYS = 42;

const ids = (max: number) => z.array(z.uuid()).max(max);

/** A room of an exam with the classes or groups it holds and its invigilators. */
export const examRoomBodySchema = z.strictObject({
  roomId: z.uuid(),
  classIds: ids(60),
  groupIds: ids(60),
  invigilatorIds: ids(20).min(1),
});

export type ExamRoomBody = z.infer<typeof examRoomBodySchema>;

/**
 * The choice for a sitting class and a block it shares with classes that do
 * not sit (edge/timetable, Exams: "cancel the whole block with the reason
 * 'exam', or keep it for the other classes"), the block named by its dated
 * id; either half of a double names the pair (decision 7).
 */
export const examBlockChoiceSchema = z.strictObject({
  classId: z.uuid(),
  blockId: z.uuid(),
  choice: z.enum(['cancel', 'keep']),
});

export type ExamBlockChoice = z.infer<typeof examBlockChoiceSchema>;

const reason = z.string().trim().min(1).max(DAY_CHANGE_REASON_MAX);

/**
 * The lessons that can no longer be restored and stay cancelled with a
 * reason (decision 3). The reason goes with a list that is not empty.
 */
const keepCancelled = {
  keepCancelled: ids(200).optional(),
  keepReason: reason.optional(),
};

function keptWithReason(body: {
  keepCancelled?: string[] | undefined;
  keepReason?: string | undefined;
}) {
  return (body.keepCancelled ?? []).length === 0 || body.keepReason !== undefined;
}

const keptMessage = { path: ['keepReason'], message: 'Lessons kept cancelled need a reason.' };

/**
 * An exam as a create or a change sends it. The slots are lesson numbers of
 * the day (decision 6). Refused here: a class or group in two rooms, an
 * invigilator twice, a room twice, a room with nothing in it, a group with
 * no subject (`exam_group_subject`: a group sits only with its subject).
 */
export const examBodySchema = z
  .strictObject({
    date: schoolDateSchema,
    firstLesson: z.int().min(1).max(30),
    lastLesson: z.int().min(1).max(30),
    title: z.string().trim().min(1).max(EXAM_TITLE_MAX),
    subjectId: z.uuid().nullable(),
    rooms: z.array(examRoomBodySchema).min(1).max(EXAM_ROOMS_MAX),
    blockChoices: z.array(examBlockChoiceSchema).max(200).default([]),
    /** The tick of the warnings a save answered with `exam_warnings` (decision 8). */
    confirm: z.boolean().default(false),
    ...keepCancelled,
  })
  .superRefine((body, context) => {
    if (body.lastLesson < body.firstLesson) {
      context.addIssue({
        code: 'custom',
        path: ['lastLesson'],
        message: 'The last lesson comes before the first.',
      });
    }
    const twice = (values: string[]) => values.length !== new Set(values).size;
    if (twice(body.rooms.map((room) => room.roomId))) {
      context.addIssue({ code: 'custom', path: ['rooms'], message: 'A room is named twice.' });
    }
    for (const [index, room] of body.rooms.entries()) {
      if (room.classIds.length + room.groupIds.length === 0) {
        context.addIssue({
          code: 'custom',
          path: ['rooms', index, 'classIds'],
          message: 'A room holds a class or a group.',
        });
      }
      if (room.groupIds.length > 0 && body.subjectId === null) {
        context.addIssue({
          code: 'custom',
          path: ['rooms', index, 'groupIds'],
          message: 'A group sits only an exam of its subject.',
        });
      }
    }
    if (twice(body.rooms.flatMap((room) => [...room.classIds, ...room.groupIds]))) {
      context.addIssue({
        code: 'custom',
        path: ['rooms'],
        message: 'A class or group sits in one room.',
      });
    }
    if (twice(body.rooms.flatMap((room) => room.invigilatorIds))) {
      context.addIssue({
        code: 'custom',
        path: ['rooms'],
        message: 'An invigilator is named twice.',
      });
    }
    if (twice(body.blockChoices.map((one) => `${one.classId}|${one.blockId}`))) {
      context.addIssue({
        code: 'custom',
        path: ['blockChoices'],
        message: 'A block is chosen twice.',
      });
    }
    if (!keptWithReason(body)) context.addIssue({ code: 'custom', ...keptMessage });
  });

export type ExamBody = z.input<typeof examBodySchema>;
export type ExamInput = z.output<typeof examBodySchema>;

/** The cancel of an exam: the lessons kept cancelled when a restore is refused (decision 3). */
export const examCancelBodySchema = z
  .strictObject(keepCancelled)
  .refine(keptWithReason, keptMessage);

export type ExamCancelBody = z.infer<typeof examCancelBodySchema>;

export const examParamsSchema = z.object({ id: z.uuid() });

export type ExamParams = z.infer<typeof examParamsSchema>;

/** The exams of a range of dates, at most `EXAM_RANGE_DAYS` days. */
export const examsQuerySchema = z.object({ from: schoolDateSchema, to: schoolDateSchema }).refine(
  (query) => {
    const days = (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000;
    return days >= 0 && days < EXAM_RANGE_DAYS;
  },
  { path: ['to'], message: `A range of 1 to ${EXAM_RANGE_DAYS} days.` },
);

export type ExamsQuery = z.infer<typeof examsQuerySchema>;

const named = z.object({ id: z.uuid(), name: z.string() });

/** An exam as the list and the save answer it. */
export const examSchema = z.object({
  id: z.uuid(),
  date: schoolDateSchema,
  /** The lesson numbers of its first and last slot today; `null` when the day no longer has them. */
  firstLesson: z.int().min(1).nullable(),
  lastLesson: z.int().min(1).nullable(),
  /** Clock minutes of the day in branch time, half-open. */
  start: z.int().min(0),
  end: z.int().min(1),
  title: z.string(),
  subject: z
    .object({ id: z.uuid(), names: z.object({ uz: z.string(), ru: z.string(), en: z.string() }) })
    .nullable(),
  rooms: z.array(
    z.object({
      room: named,
      classes: z.array(named),
      groups: z.array(named),
      invigilators: z.array(named),
    }),
  ),
  cancelled: z.boolean(),
  /** The lessons it keeps cancelled (`lesson_exam_cancels`). */
  lessonIds: z.array(z.uuid()),
});

export type Exam = z.infer<typeof examSchema>;

export const examsAnswerSchema = z.object({ exams: z.array(examSchema) });

export type ExamsAnswer = z.infer<typeof examsAnswerSchema>;

/** A save of an exam: the exam and the warnings ticked. */
export const examSaveAnswerSchema = z.object({
  exam: examSchema,
  warnings: z.array(z.string()),
});

export type ExamSaveAnswer = z.infer<typeof examSaveAnswerSchema>;
