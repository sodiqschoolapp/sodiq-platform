import { z } from 'zod';
import { planImpactSchema } from './plans.js';
import { schoolDateSchema } from './academic-year.js';
import { DAY_CHANGE_REASON_MAX, dayLessonSchema } from './day-changes.js';
import { errorDetailSchema } from './errors.js';

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
const placeFields = {
  date: schoolDateSchema,
  firstLesson: z.int().min(1).max(30),
  lastLesson: z.int().min(1).max(30),
  title: z.string().trim().min(1).max(EXAM_TITLE_MAX),
  subjectId: z.uuid().nullable(),
  rooms: z.array(examRoomBodySchema).min(1).max(EXAM_ROOMS_MAX),
  blockChoices: z.array(examBlockChoiceSchema).max(200).default([]),
  /**
   * The quarter's rating exam of the journals it reaches (task 5.6c-3b;
   * edge/timetable, Exams, "The exam is the quarter's rating exam"); only
   * with a subject.
   */
  ratingExam: z.boolean().default(false),
};

const examFields = {
  ...placeFields,
  /** The tick of the warnings a save answered with `exam_warnings` (decision 8). */
  confirm: z.boolean().default(false),
};

type ExamChecked = {
  firstLesson: number;
  lastLesson: number;
  subjectId: string | null;
  ratingExam: boolean;
  rooms: { roomId: string; classIds: string[]; groupIds: string[]; invigilatorIds: string[] }[];
  blockChoices: { classId: string; blockId: string }[];
  keepCancelled?: string[] | undefined;
  keepReason?: string | undefined;
};

const checkExam = (body: ExamChecked, context: z.RefinementCtx, needsReason = true): void => {
  if (body.lastLesson < body.firstLesson) {
    context.addIssue({
      code: 'custom',
      path: ['lastLesson'],
      message: 'The last lesson comes before the first.',
    });
  }
  const twice = (values: string[]) => values.length !== new Set(values).size;
  if (body.ratingExam && body.subjectId === null) {
    context.addIssue({
      code: 'custom',
      path: ['ratingExam'],
      message: 'A rating exam has a subject.',
    });
  }
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
  if (needsReason && !keptWithReason(body)) context.addIssue({ code: 'custom', ...keptMessage });
};

/** A change of an exam: the lessons it gives back may be kept cancelled with a reason (decision 3). */
export const examBodySchema = z
  .strictObject({ ...examFields, ...keepCancelled })
  .superRefine((body, context) => checkExam(body, context));

/**
 * A new exam: it gives no lesson back, so it takes no `keepCancelled`
 * (`.claude/rules/api.md`: a field a path has no use for is refused).
 */
export const examCreateBodySchema = z
  .strictObject(examFields)
  .superRefine((body, context) => checkExam(body, context));

/**
 * The check of a save (task 5.6c-2, decision 3 of its plan): the exam as a
 * save would send it, `examId` for a change, never `confirm` (the check
 * lists the warnings), and lessons kept cancelled only on a change (a new
 * exam gives no lesson back; `.claude/rules/api.md`: a field a path has no
 * use for is refused).
 */
export const examCheckBodySchema = z
  .strictObject({ examId: z.uuid().optional(), ...placeFields, ...keepCancelled })
  .superRefine((body, context) => {
    // The check answers nothing on the reason: lessons are named to stay
    // cancelled before it is typed.
    checkExam(body, context, false);
    if (body.examId === undefined && body.keepCancelled !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['keepCancelled'],
        message: 'A new exam gives no lesson back.',
      });
    }
    if (body.examId === undefined && body.keepReason !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['keepReason'],
        message: 'A new exam gives no lesson back.',
      });
    }
  });

export type ExamCheckBody = z.input<typeof examCheckBodySchema>;
export type ExamCheckInput = z.output<typeof examCheckBodySchema>;

export type ExamBody = z.input<typeof examBodySchema>;
export type ExamCreateBody = z.input<typeof examCreateBodySchema>;
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

/**
 * A journal the rating exam reaches (task 5.6c-3b): its class or group and
 * its subject.
 */
export const examRatingJournalSchema = z.object({
  id: z.uuid(),
  unit: z.object({ kind: z.enum(['class', 'group']), id: z.uuid(), name: z.string() }),
});

export type ExamRatingJournal = z.infer<typeof examRatingJournalSchema>;

/**
 * The journals of a rating exam (edge/timetable, Exams: "class journals, and
 * group journals whose students all come from sitting classes. A group
 * journal with students outside the exam is listed and not linked; its
 * teacher sets the date by hand"), by name.
 */
export const examRatingSchema = z.object({
  linked: z.array(examRatingJournalSchema),
  notLinked: z.array(examRatingJournalSchema),
});

export type ExamRating = z.infer<typeof examRatingSchema>;

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
  /**
   * Its start is at or before the server's moment of the request (task
   * 5.6c-2, plan review should-fix 7): it is no longer changed or cancelled,
   * and the page never reads the device's clock to know it.
   */
  started: z.boolean(),
  /** The lessons it keeps cancelled (`lesson_exam_cancels`). */
  lessonIds: z.array(z.uuid()),
  /** Its journals when it is the quarter's rating exam (task 5.6c-3b); `null`: it is not. */
  rating: examRatingSchema.nullable(),
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

/**
 * A shared block of a sitting class under the exam (edge/timetable, Exams:
 * "The save lists such blocks. For each, the Academic Vice Principal
 * chooses"): the block named by its dated id, its lessons, the classes that
 * do not sit, the choice the check used (the body's, else the stored one)
 * and the stored one of a change.
 */
export const examCheckChoiceSchema = z.object({
  classId: z.uuid(),
  className: z.string(),
  blockId: z.uuid(),
  lessons: z.array(dayLessonSchema),
  otherClasses: z.array(z.string()),
  choice: z.enum(['cancel', 'keep']).nullable(),
  stored: z.enum(['cancel', 'keep']).nullable(),
});

export type ExamCheckChoice = z.infer<typeof examCheckChoiceSchema>;

/**
 * What a change does to a lesson it gives back (decision 3 of 5.6c-1):
 * restored, blocked (with the rules; it is kept cancelled with a reason or
 * the save is refused), kept cancelled as asked, `restorable` (named to stay
 * cancelled but it can be restored: the save refuses that), or still under
 * another exam.
 */
export const EXAM_GIVEN_BACK_STATES = [
  'restored',
  'blocked',
  'kept',
  'restorable',
  'otherExam',
] as const;

export const examGivenBackSchema = z.object({
  lesson: dayLessonSchema,
  state: z.enum(EXAM_GIVEN_BACK_STATES),
  rules: z.array(errorDetailSchema),
});

export type ExamGivenBack = z.infer<typeof examGivenBackSchema>;

/**
 * The answer of the check (task 5.6c-2): what a save of the body would do,
 * nothing written. `blocked`, `warnings` and `givenBack` are `null` while
 * they are not worked out: every list after a missing choice, and the
 * lessons given back while a rule blocks the exam.
 */
export const examCheckSchema = z.object({
  cancels: z.array(dayLessonSchema),
  choices: z.array(examCheckChoiceSchema),
  blocked: z.array(errorDetailSchema).nullable(),
  warnings: z.array(errorDetailSchema).nullable(),
  givenBack: z.array(examGivenBackSchema).nullable(),
  freeRooms: z.array(named),
  /** The journals a save would store, when the body is a rating exam (task 5.6c-3b). */
  rating: examRatingSchema.nullable(),
  canSave: z.boolean(),
  /** Task 7.1b: per plan, the items that no longer fit and the rows left empty. */
  plans: z.array(planImpactSchema),
});

export type ExamCheck = z.infer<typeof examCheckSchema>;
