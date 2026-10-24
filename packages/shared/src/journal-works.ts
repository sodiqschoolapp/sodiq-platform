import { z } from 'zod';
import { correctionSchema } from './journal-correction.js';
import { cellWorkKindSchema } from './reset-entries.js';

/**
 * Classwork and homework in the journal (task 8.1, pull request #217; `07`,
 * Entering data, The total; `edge/journal`, Entering). A column is named by
 * its stored work, or, before its first write, by its plan work and the
 * lesson whose item holds it.
 */

/** `edge/journal`: "A total is from 1 to 1000" (`journal_works_total_check`, 0108). */
export const WORK_TOTAL_MIN = 1;
export const WORK_TOTAL_MAX = 1000;

/** `edge/journal`: "at most 10 classworks and at most 10 homeworks given" (`journal_works_limit`, 0119). */
export const LESSON_WORKS_MAX = 10;

/** At most the cells of one lesson's students and works per call (6.3 decision 5, `ATTENDANCE_SAVES_MAX`). */
export const SCORES_SAVES_MAX = 600;

export const workColumnSchema = z.union([
  z.strictObject({ workId: z.uuid() }),
  z.strictObject({ planWorkId: z.uuid(), sourceLessonId: z.uuid() }),
]);

export type WorkColumn = z.infer<typeof workColumnSchema>;

export const journalWorkParamsSchema = z.object({ lessonId: z.uuid(), workId: z.uuid() });

export type JournalWorkParams = z.infer<typeof journalWorkParamsSchema>;

/** A work added by hand at a lesson with no plan item: a classwork or a "homework given". */
export const workAddSchema = z.strictObject({
  kind: cellWorkKindSchema,
  correction: correctionSchema.optional(),
});

export type WorkAdd = z.infer<typeof workAddSchema>;

/** The version a change was made on; `null` for a column with no row yet. */
const workVersionSchema = z.int().min(1).nullable();

export const workTotalSchema = z.strictObject({
  column: workColumnSchema,
  total: z.int().min(WORK_TOTAL_MIN).max(WORK_TOTAL_MAX),
  version: workVersionSchema,
  /** Sent after a `total_confirm`: the change of a total with numbers. */
  confirm: z.boolean().default(false),
  /** Task 8.4: a correction with its reason. */
  correction: correctionSchema.optional(),
});

export type WorkTotal = z.input<typeof workTotalSchema>;

export const workNotHeldSchema = z.strictObject({
  column: workColumnSchema,
  notHeld: z.boolean(),
  version: workVersionSchema,
  /** Sent after a `not_held_confirm`. */
  confirm: z.boolean().default(false),
  /** Task 8.4: a correction with its reason. */
  correction: correctionSchema.optional(),
});

export type WorkNotHeld = z.input<typeof workNotHeldSchema>;

export const workCarrySchema = z.strictObject({
  column: workColumnSchema,
  version: workVersionSchema,
  /** Task 8.4: a correction with its reason. */
  correction: correctionSchema.optional(),
});

export type WorkCarry = z.infer<typeof workCarrySchema>;

/** A work as stored after a change. */
export const workSavedSchema = z.object({
  id: z.uuid(),
  kind: cellWorkKindSchema,
  total: z.int().min(WORK_TOTAL_MIN).max(WORK_TOTAL_MAX).nullable(),
  notHeld: z.boolean(),
  carriedFrom: z.uuid().nullable(),
  version: z.int().min(1),
});

export type WorkSaved = z.infer<typeof workSavedSchema>;

/** The numbers typed for works of one lesson; `score: null` clears the cell. */
export const scoresSaveSchema = z
  .strictObject({
    saves: z
      .array(
        z.strictObject({
          studentId: z.uuid(),
          column: workColumnSchema,
          score: z.int().min(0).max(WORK_TOTAL_MAX).nullable(),
          /** The version the number was typed on; `null` for a cell never saved. */
          version: z.int().min(1).nullable(),
        }),
      )
      .min(1)
      .max(SCORES_SAVES_MAX),
    /** Task 8.4: a correction with its reason. */
    correction: correctionSchema.optional(),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.saves.forEach((save, index) => {
      const column =
        'workId' in save.column
          ? save.column.workId
          : `${save.column.planWorkId}/${save.column.sourceLessonId}`;
      const key = `${save.studentId}/${column}`.toLowerCase();
      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['saves', index, 'studentId'],
          message: 'A call saves each cell once.',
        });
      }
      seen.add(key);
    });
  });

export type ScoresSave = z.infer<typeof scoresSaveSchema>;

export const scoresSavedSchema = z.object({
  cells: z.array(
    z.object({
      studentId: z.uuid(),
      workId: z.uuid(),
      score: z.int().min(0).nullable(),
      /** The percent shown (`packages/calc`), `null` when the cell is empty. */
      percent: z.int().min(0).max(100).nullable(),
      version: z.int().min(1),
    }),
  ),
  /** The works the save wrote first (a column with no row before). */
  works: z.array(workSavedSchema),
});

export type ScoresSaved = z.infer<typeof scoresSavedSchema>;
