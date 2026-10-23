import { z } from 'zod';
import { ATTENDANCE_SAVES_MAX, attendanceMarkSchema } from './attendance.js';
import { LESSON_WORKS_MAX } from './journal-works.js';

/**
 * Saving and stale saves (task 8.3a; `edge/journal`, Saving and working
 * together; `edge/system-behaviour`, the release at 19:00).
 */

/** The header that carries the application version of the page that sends a request. */
export const APP_VERSION_HEADER = 'X-App-Version';

/**
 * The application version: a whole number raised by a release that changes
 * what the API takes (decision 4). The web app sends it with every request.
 */
export const APP_VERSION = 1;

/**
 * The oldest version whose writes are still accepted: the previous release
 * (`edge/system-behaviour`: "Entries from the previous version are accepted
 * for at least one release").
 */
export const OLDEST_APP_VERSION = APP_VERSION - 1;

/** A version header as sent: a whole number written in digits. */
export const appVersionSchema = z
  .string()
  .regex(/^\d{1,9}$/)
  .transform(Number);

/**
 * At most the cells of the largest action that can be undone: an attendance
 * save of a lesson's students whose keep-or-clear clears up to 20 numbers of
 * each (a scores save holds at most 600).
 */
export const UNDO_CELLS_MAX = ATTENDANCE_SAVES_MAX * (1 + 2 * LESSON_WORKS_MAX);

/** The cells of one student in an undo: the attendance cell and the works' cells. */
const studentCellsSchema = z.strictObject({
  studentId: z.uuid(),
  cells: z
    .array(
      z.strictObject({
        /** `null`: the attendance cell. */
        workId: z.uuid().nullable(),
        /** The version the person's own action gave the cell. */
        version: z.int().min(1),
      }),
    )
    .min(1)
    .max(1 + 2 * LESSON_WORKS_MAX),
});

/**
 * Undo of the person's own last action on the page: its cells, grouped by
 * student (`edge/journal`, Undo). Grouped, the largest action stays well
 * inside the body limit of a request (100 kB).
 */
export const undoSchema = z
  .strictObject({
    students: z.array(studentCellsSchema).min(1).max(ATTENDANCE_SAVES_MAX),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    let count = 0;
    value.students.forEach((student, index) => {
      student.cells.forEach((cell, at) => {
        count += 1;
        const key = `${student.studentId.toLowerCase()}/${cell.workId?.toLowerCase() ?? ''}`;
        if (seen.has(key)) {
          context.addIssue({
            code: 'custom',
            path: ['students', index, 'cells', at],
            message: 'Each cell once.',
          });
        }
        seen.add(key);
      });
    });
    if (count > UNDO_CELLS_MAX) {
      context.addIssue({
        code: 'custom',
        path: ['students'],
        message: `At most ${String(UNDO_CELLS_MAX)} cells.`,
      });
    }
  });

/** The cells of an undo, one by one. */
export const undoCellsOf = (input: Undo) =>
  input.students.flatMap((student) =>
    student.cells.map((cell) => ({ studentId: student.studentId, ...cell })),
  );

export type Undo = z.infer<typeof undoSchema>;

/**
 * Why a cell of an undo was skipped: changed since (`changed`), or a restore
 * the database refuses now (a closed cell, a number above the work's total, a
 * work "not held" or without a total).
 */
export const UNDO_SKIPS = [
  'changed',
  'cell_closed',
  'score_above_total',
  'work_total_missing',
  'work_not_held',
] as const;

export const undoneSchema = z.object({
  undone: z.array(
    z.object({ studentId: z.uuid(), workId: z.uuid().nullable(), version: z.int().min(1) }),
  ),
  skipped: z.array(
    z.object({ studentId: z.uuid(), workId: z.uuid().nullable(), code: z.enum(UNDO_SKIPS) }),
  ),
});

export type Undone = z.infer<typeof undoneSchema>;

/** "Copy attendance": the cells filled from the first lesson of the double, and those skipped. */
export const attendanceCopySchema = z.object({
  filled: z.array(z.object({ studentId: z.uuid(), version: z.int().min(1) })),
  skipped: z.array(z.object({ studentId: z.uuid(), mark: attendanceMarkSchema.nullable() })),
});

export type AttendanceCopy = z.infer<typeof attendanceCopySchema>;
