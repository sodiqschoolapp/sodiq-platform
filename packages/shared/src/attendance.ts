import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { correctionSchema } from './journal-correction.js';
import {
  accountNamedSchema,
  cellChangeSchema,
  cellWorkKindSchema,
  workLineSchema,
} from './reset-entries.js';

/**
 * Attendance (task 6.3, pull request #211; `07`, Entering data; `edge/journal`,
 * Entering and "A Tutor records why a student was absent"). The marks are the
 * attendance cells of 0108; the reasons are `student_absence_reasons` (0113).
 */

/**
 * The marks a person types (`07`, Entering data): 1 present, 0 absent from
 * school, 2 late, 3 at school but not at the lesson. Marks 4 and 5 come from
 * an exemption and are never typed (6.1a, decision 4); the check of
 * `journal_cells` holds 0 to 3, and this schema is never wider.
 */
export const ATTENDANCE_MARKS = [1, 0, 2, 3] as const;

export const attendanceMarkSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

export type AttendanceMark = z.infer<typeof attendanceMarkSchema>;

/** At most the cells of one lesson's students per call (decision 5). */
export const ATTENDANCE_SAVES_MAX = 60;

export const journalLessonParamsSchema = z.object({ lessonId: z.uuid() });

export type JournalLessonParams = z.infer<typeof journalLessonParamsSchema>;

export const lessonStudentParamsSchema = z.object({ lessonId: z.uuid(), studentId: z.uuid() });

export type LessonStudentParams = z.infer<typeof lessonStudentParamsSchema>;

/** The typed marks of one lesson; `mark: null` clears the cell. */
export const attendanceSaveSchema = z
  .strictObject({
    saves: z
      .array(
        z.strictObject({
          studentId: z.uuid(),
          mark: attendanceMarkSchema.nullable(),
          /** The version the mark was typed on; `null` for a cell never saved. */
          version: z.int().min(1).nullable(),
          /**
           * Task 8.1, decision 15: a change from present or late to absent or
           * skipped of a student with numbers in the lesson keeps or clears
           * them; left out there, the save is refused `numbers_keep_or_clear`.
           */
          numbers: z.enum(['keep', 'clear']).optional(),
        }),
      )
      .min(1)
      .max(ATTENDANCE_SAVES_MAX),
    /** Task 8.4: a correction of the Academic Vice Principal or the Super Admin, with its reason. */
    correction: correctionSchema.optional(),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.saves.forEach((save, index) => {
      const key = save.studentId.toLowerCase();
      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['saves', index, 'studentId'],
          message: 'A call saves each student once.',
        });
      }
      seen.add(key);
    });
  });

export type AttendanceSave = z.infer<typeof attendanceSaveSchema>;

/** An attendance cell as stored after a save. */
const savedAttendanceSchema = z.object({
  studentId: z.uuid(),
  mark: attendanceMarkSchema.nullable(),
  version: z.int().min(1),
});

export const attendanceSavedSchema = z.object({
  cells: z.array(savedAttendanceSchema),
  /** The numbers a "clear" of keep-or-clear emptied, with their new versions, for the undo (task 8.3a). */
  cleared: z.array(z.object({ studentId: z.uuid(), workId: z.uuid(), version: z.int().min(1) })),
  /**
   * The students saved with 0 who had a 1, 2 or 3 in a lesson of the branch
   * that started earlier the same day (`edge/journal`: "A hint is shown and
   * the day is listed for the Tutor"; decision 9).
   */
  presentEarlier: z.array(z.uuid()),
});

export type AttendanceSaved = z.infer<typeof attendanceSavedSchema>;

/** "All present": the cells filled with 1 and those skipped with the mark they hold (decision 4). */
export const allPresentSchema = z.object({
  filled: z.array(z.object({ studentId: z.uuid(), version: z.int().min(1) })),
  skipped: z.array(z.object({ studentId: z.uuid(), mark: attendanceMarkSchema })),
});

export type AllPresent = z.infer<typeof allPresentSchema>;

/** The history of a student's cells in one lesson (`07`: "It opens from the cell"; decision 16). */
export const cellHistorySchema = z.object({
  lines: z.array(
    z.object({
      /** `null`: the attendance cell. */
      work: z.object({ id: z.uuid(), kind: cellWorkKindSchema }).nullable(),
      version: z.int().min(1),
      before: z.int().nullable(),
      after: z.int().nullable(),
      changedBy: accountNamedSchema,
      changedHow: cellChangeSchema,
      changedAt: z.iso.datetime(),
    }),
  ),
  /** The total and "not held" lines of the lesson's works the grid shows (task 8.1; From 6.3 decision 16). */
  workLines: z.array(workLineSchema),
});

export type CellHistory = z.infer<typeof cellHistorySchema>;

// ---------------------------------------------------------------------------
// The reasons of an absence.

/** `edge/journal`: "a category (illness, family, permitted by the school, unexcused, unknown)". */
export const ABSENCE_CATEGORIES = [
  'illness',
  'family',
  'school_permitted',
  'unexcused',
  'unknown',
] as const;

export const absenceCategorySchema = z.enum(ABSENCE_CATEGORIES);

export type AbsenceCategory = z.infer<typeof absenceCategorySchema>;

/** The note of a reason; the check of `student_absence_reasons` (0113) holds the same bound. */
export const ABSENCE_REASON_NOTE_MAX = 500;

/** The longest range the Student absences page reads (decision 13). */
export const STUDENT_ABSENCES_MAX_DAYS = 31;

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/**
 * Without a class: the first the reader may choose; without dates: Monday of
 * this week to today (decision 13). The dates come together or not at all.
 */
export const studentAbsencesQuerySchema = z
  .strictObject({
    classId: z.uuid().optional(),
    from: schoolDateSchema.optional(),
    to: schoolDateSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.from === undefined || value.to === undefined) {
      if (value.from !== value.to) {
        context.addIssue({
          code: 'custom',
          path: [value.from === undefined ? 'from' : 'to'],
          message: 'Both dates or none.',
        });
      }
      return;
    }
    const days = dayNumber(value.to) - dayNumber(value.from);
    if (days < 0) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'The end is before the start.' });
    } else if (days + 1 > STUDENT_ABSENCES_MAX_DAYS) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: `At most ${STUDENT_ABSENCES_MAX_DAYS} days.`,
      });
    }
  });

export type StudentAbsencesQuery = z.infer<typeof studentAbsencesQuerySchema>;

export const absenceReasonParamsSchema = z.object({
  studentId: z.uuid(),
  date: schoolDateSchema,
});

export type AbsenceReasonParams = z.infer<typeof absenceReasonParamsSchema>;

/** The name of the file of a reason, in the query of its upload (task 8.5). */
export const absenceReasonFileQuerySchema = z.object({
  name: z.string().trim().min(1).max(200),
});

export type AbsenceReasonFileQuery = z.infer<typeof absenceReasonFileQuerySchema>;

/** A reason as typed; no category clears it, and then the note is empty (decision 8). */
export const absenceReasonRecordSchema = z
  .strictObject({
    category: absenceCategorySchema.nullable(),
    note: z.string().max(ABSENCE_REASON_NOTE_MAX),
  })
  .superRefine((value, context) => {
    if (value.category === null && value.note !== '') {
      context.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'A cleared reason has no note.',
      });
    }
  });

export type AbsenceReasonRecord = z.infer<typeof absenceReasonRecordSchema>;

export const absenceReasonSchema = z.object({
  studentId: z.uuid(),
  date: schoolDateSchema,
  category: absenceCategorySchema.nullable(),
  note: z.string(),
  /** Task 8.5 (From 6.3, decision 10): the file attached, a medical certificate for example. */
  file: z.object({ name: z.string(), type: z.string() }).nullable(),
  changedBy: accountNamedSchema,
  changedAt: z.iso.datetime(),
});

export type AbsenceReason = z.infer<typeof absenceReasonSchema>;

/** One student and date of the Student absences page (decision 13). */
export const studentAbsenceDaySchema = z.object({
  student: z.object({
    id: z.uuid(),
    uid: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    paternalName: z.string().nullable(),
  }),
  date: schoolDateSchema,
  /** The held lessons of the day marked 0 or 3, in their order. */
  lessons: z.array(
    z.object({
      id: z.uuid(),
      start: z.int().min(0),
      subject: z.object({ uz: z.string(), ru: z.string(), en: z.string() }),
      mark: z.union([z.literal(0), z.literal(3)]),
    }),
  ),
  /** A 0 after a 1, 2 or 3 earlier that day (decision 9). */
  presentEarlier: z.boolean(),
  /** `null`: no reason, or a cleared one. */
  reason: absenceReasonSchema.nullable(),
  /** The reader may set the reason of this student and date. */
  canEdit: z.boolean(),
});

export type StudentAbsenceDay = z.infer<typeof studentAbsenceDaySchema>;

export const studentAbsencesSchema = z.object({
  /** The class shown, `null` when the reader has none to choose. */
  classId: z.uuid().nullable(),
  from: schoolDateSchema,
  to: schoolDateSchema,
  /** The classes the reader may choose (a Tutor's own, every class of the branch's year otherwise). */
  classes: z.array(z.object({ id: z.uuid(), name: z.string() })),
  days: z.array(studentAbsenceDaySchema),
});

export type StudentAbsences = z.infer<typeof studentAbsencesSchema>;
