import { z } from 'zod';
import { preparedStampSchema } from './prepared.js';
import { schoolDateSchema } from './academic-year.js';
import { journalSubjectSchema, journalUnitSchema } from './journal-units.js';
import { correctionSchema } from './journal-correction.js';
import { lessonStatusSchema } from './lesson-status.js';

/**
 * "Not graded", the reminders, the counts per teacher and the orphan lessons
 * (task 8.7, pull request #225; `07`, Lesson status, Reminders; `08`, Journal
 * discipline; `edge/journal`, "A teacher leaves the school with incomplete
 * lessons").
 */

/** At most the works of one lesson (10 classworks and 10 homeworks, `LESSON_WORKS_MAX`) per call. */
export const NOT_GRADED_WORKS_MAX = 20;

/**
 * "Not graded" for a lesson: the empty cells of the students waited for, in
 * the works named (every counted work with a total when none is named).
 */
export const notGradedSchema = z
  .strictObject({
    workIds: z.array(z.uuid()).min(1).max(NOT_GRADED_WORKS_MAX).optional(),
    correction: correctionSchema.optional(),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    (value.workIds ?? []).forEach((id, index) => {
      const key = id.toLowerCase();
      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['workIds', index],
          message: 'A call names each work once.',
        });
      }
      seen.add(key);
    });
  });

export type NotGraded = z.infer<typeof notGradedSchema>;

const cellRef = z.object({ studentId: z.uuid(), workId: z.uuid() });

export const notGradedAnswerSchema = z.object({
  /** The cells set "not graded", with their versions. */
  filled: z.array(cellRef.extend({ version: z.int().min(1) })),
  /** The cells typed between the read and the write, left as they are (`edge/journal`). */
  skipped: z.array(cellRef),
});

export type NotGradedAnswer = z.infer<typeof notGradedAnswerSchema>;

/** A lesson named by a reminder, a count or the orphan list. */
export const statusLessonSchema = z.object({
  id: z.uuid(),
  journalId: z.uuid().nullable(),
  date: schoolDateSchema,
  /** Clock minutes of the day in branch time. */
  start: z.int().min(0),
  unit: journalUnitSchema.nullable(),
  subject: journalSubjectSchema,
  status: lessonStatusSchema,
});

export type StatusLesson = z.infer<typeof statusLessonSchema>;

export const REMINDER_KINDS = [
  'no_attendance',
  'numbers_missing',
  'no_topic',
  'about_to_lock',
] as const;

export type ReminderKind = (typeof REMINDER_KINDS)[number];

/** `07`, Reminders, decision 9: an incomplete lesson whose lock moment is this close. */
export const ABOUT_TO_LOCK_HOURS = 48;

/** `07`, Reminders, decision 10: "the last two weeks of a quarter", its last day included. */
export const RATING_REMINDER_DAYS = 14;

export const reminderSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(REMINDER_KINDS),
    lesson: statusLessonSchema,
    /** Students unmarked (`no_attendance`) or works missing numbers (`numbers_missing`); 1 otherwise. */
    count: z.int().min(1),
    /** The lock moment, for `about_to_lock`. */
    locksAt: z.iso.datetime().nullable(),
  }),
  z.object({
    kind: z.literal('rating_missing'),
    journal: z.object({
      id: z.uuid(),
      unit: journalUnitSchema,
      subject: journalSubjectSchema,
    }),
    quarterId: z.uuid(),
    /** The quarter's last day. */
    lastDay: schoolDateSchema,
    /** Members on today with no score, "did not sit", "exempt" or "pending". */
    count: z.int().min(1),
  }),
]);

export type Reminder = z.infer<typeof reminderSchema>;

export const remindersSchema = z.object({
  today: schoolDateSchema,
  reminders: z.array(reminderSchema),
});

export type Reminders = z.infer<typeof remindersSchema>;

export const ownRemindersQuerySchema = z.strictObject({});

export type OwnRemindersQuery = z.infer<typeof ownRemindersQuerySchema>;

/** Decision 14: the counts read at most this many days, inside one academic year. */
export const DISCIPLINE_DAYS_MAX = 92;

export const disciplineQuerySchema = z
  .strictObject({
    from: schoolDateSchema,
    to: schoolDateSchema,
    departmentId: z.uuid().optional(),
  })
  .refine((value) => value.from <= value.to, {
    path: ['to'],
    message: 'The range ends after it starts.',
  });

export type DisciplineQuery = z.infer<typeof disciplineQuerySchema>;

/** The counts of one teacher (`07`, Lesson status; `08`, Journal discipline, decision 14). */
export const disciplineRowSchema = z.object({
  teacher: z.object({ id: z.uuid(), name: z.string() }),
  held: z.int().min(0),
  notStarted: z.int().min(0),
  inProgress: z.int().min(0),
  complete: z.int().min(0),
  lockedIncomplete: z.int().min(0),
  noAttendance: z.int().min(0),
  noTopic: z.int().min(0),
  worksMissing: z.int().min(0),
  unplanned: z.int().min(0),
  lateEntries: z.int().min(0),
});

export type DisciplineRow = z.infer<typeof disciplineRowSchema>;

export const disciplineSchema = z.object({
  from: schoolDateSchema,
  to: schoolDateSchema,
  /** The departments the reader may filter by. */
  departments: z.array(
    z.object({ id: z.uuid(), names: z.object({ uz: z.string(), ru: z.string(), en: z.string() }) }),
  ),
  teachers: z.array(disciplineRowSchema),
  /** Task 9.3b-1: the prepared lesson facts the counts were read from. */
  prepared: preparedStampSchema,
});

export type Discipline = z.infer<typeof disciplineSchema>;

export const ORPHAN_REASON_MAX_LENGTH = 500;
export const ORPHAN_DAYS_MIN = 1;
export const ORPHAN_DAYS_MAX = 7;

export const orphanAssignmentSchema = z.object({
  id: z.uuid(),
  teacher: z.object({ id: z.uuid(), name: z.string() }),
  reason: z.string(),
  days: z.int().min(ORPHAN_DAYS_MIN).max(ORPHAN_DAYS_MAX),
  openUntil: z.iso.datetime(),
  assignedAt: z.iso.datetime(),
});

export type OrphanAssignment = z.infer<typeof orphanAssignmentSchema>;

export const orphanLessonsSchema = z.object({
  lessons: z.array(
    z.object({
      lesson: statusLessonSchema,
      /** The teacher the lesson counts for, who left the school. */
      teacher: z.object({ id: z.uuid(), name: z.string() }),
      assignment: orphanAssignmentSchema.nullable(),
    }),
  ),
  /** The teachers who may be assigned: persons active in the branch. */
  teachers: z.array(z.object({ id: z.uuid(), name: z.string() })),
});

export type OrphanLessons = z.infer<typeof orphanLessonsSchema>;

export const orphanParamsSchema = z.object({ lessonId: z.uuid() });

export const orphanAssignSchema = z.strictObject({
  staffId: z.uuid(),
  days: z.int().min(ORPHAN_DAYS_MIN).max(ORPHAN_DAYS_MAX),
  reason: z.string().trim().min(1).max(ORPHAN_REASON_MAX_LENGTH),
});

export type OrphanAssign = z.infer<typeof orphanAssignSchema>;

export const orphanAssignmentParamsSchema = z.object({ assignmentId: z.uuid() });
