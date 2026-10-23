import { z } from 'zod';
import { planImpactSchema } from './plans.js';
import { schoolDateSchema } from './academic-year.js';
import { DAY_CHANGE_REASON_MAX, dayLessonSchema } from './day-changes.js';
import { heldDataSchema } from './held-data.js';

/**
 * A bulk cancel of the published timetable (task 5.6a-3, pull request #162;
 * docs/spec/06-timetable.md, Changes after publishing: "Bulk cancel. For an
 * event: chosen classes, date and slots, with a reason."; edge-cases/
 * timetable.md, After publishing: "7 Oxford goes on an excursion, and group
 * 7-M-1 has students from 7 Oxford and 7 Princeton. The bulk cancel lists
 * such blocks. For each, the Academic Vice Principal chooses: cancel the
 * whole block, or keep it and exempt the students of the chosen classes for
 * those slots in the same action.").
 */

/** The highest lesson number a bulk cancel names, as `bulk_cancels_lesson_numbers_check` (0086) allows. */
export const BULK_CANCEL_LESSON_MAX = 20;

const distinct = <T>(values: readonly T[]) => new Set(values).size === values.length;

const sortedDistinct = (values: readonly number[]) =>
  values.every((value, index) => index === 0 || (values[index - 1] ?? value) < value);

/**
 * The classes, the date and the lesson numbers: each class's slots of those
 * numbers on its own day of the date (decision 2). The screen's "Every class
 * of the branch" sends every class (decision 3).
 */
const scopeShape = {
  date: schoolDateSchema,
  classIds: z.array(z.uuid()).min(1).max(500).refine(distinct, { message: 'Each class once.' }),
  lessonNumbers: z
    .array(z.int().min(1).max(BULK_CANCEL_LESSON_MAX))
    .min(1)
    .max(BULK_CANCEL_LESSON_MAX)
    .refine(sortedDistinct, { message: 'Sorted, each number once.' }),
};

/** What the check of a bulk cancel takes (`POST /api/timetable/bulk-cancels/check`). */
export const bulkCancelCheckBodySchema = z.strictObject(scopeShape);

export type BulkCancelCheckBody = z.infer<typeof bulkCancelCheckBodySchema>;

export const BULK_CANCEL_CHOICES = ['keep', 'cancel'] as const;

export type BulkCancelChoice = (typeof BULK_CANCEL_CHOICES)[number];

/**
 * The bulk cancel itself: the scope, the reason, one choice for each shared
 * block the check listed (decision 7), and every lesson the check listed to
 * cancel under those choices (`cancel`, and of each shared block all its
 * lessons for "cancel" or `chosenOnly` for "keep"), so that a scope changed
 * meanwhile is refused, never cancelled unseen (decision 12).
 */
export const bulkCancelBodySchema = z.strictObject({
  ...scopeShape,
  reason: z.string().trim().min(1).max(DAY_CHANGE_REASON_MAX),
  blocks: z
    .array(z.strictObject({ blockId: z.uuid(), choice: z.enum(BULK_CANCEL_CHOICES) }))
    .max(2000)
    .refine((blocks) => distinct(blocks.map((one) => one.blockId)), {
      message: 'One choice for each block.',
    }),
  lessonIds: z.array(z.uuid()).max(10000).refine(distinct, { message: 'Each lesson once.' }),
  /**
   * Task 6.1b-2 (decision 4; edge/time-dates-calendar: "For a lesson that
   * already has data, the Academic Vice Principal chooses 'keep as held' or
   * 'cancel'"): one choice for each lesson with data the save cancels under
   * the block choices; `lessonIds` leaves out those kept and the other half
   * of their double.
   */
  dataChoices: z
    .array(z.strictObject({ lessonId: z.uuid(), choice: z.enum(BULK_CANCEL_CHOICES) }))
    .max(10000)
    .refine((choices) => distinct(choices.map((one) => one.lessonId)), {
      message: 'One choice for each lesson.',
    })
    .default([]),
});

export type BulkCancelBody = z.infer<typeof bulkCancelBodySchema>;

/** A class as the check names it ("7 Oxford"). */
const classNameSchema = z.object({ id: z.uuid(), name: z.string() });

/**
 * A block shared with classes not chosen, with the other half of its double
 * when that comes in (decision 4): `blockId` is the block the choice names
 * (the earlier one of a double), `chosenOnly` the lessons fed only by chosen
 * classes, which a "keep" cancels too (decision 5).
 */
export const bulkCancelSharedSchema = z.object({
  blockId: z.uuid(),
  pairBlockId: z.uuid().nullable(),
  lessons: z.array(dayLessonSchema),
  chosenOnly: z.array(z.uuid()),
  chosenClasses: z.array(classNameSchema),
  otherClasses: z.array(classNameSchema),
});

export type BulkCancelShared = z.infer<typeof bulkCancelSharedSchema>;

/**
 * A lesson with data that a bulk cancel would cancel under some choice of
 * its block (task 6.1b-2, decision 4): what it holds, the lessons of the
 * other half of its double that take its choice, and its shared block, whose
 * "cancel" cancels it whatever it is given (`null` when not shared).
 */
export const bulkCancelDataLessonSchema = z.object({
  lessonId: z.uuid(),
  heldData: heldDataSchema,
  pairLessonIds: z.array(z.uuid()),
  sharedBlockId: z.uuid().nullable(),
});

export type BulkCancelDataLesson = z.infer<typeof bulkCancelDataLessonSchema>;

/** What a bulk cancel would do, written nowhere (decision 12). */
export const bulkCancelCheckAnswerSchema = z.object({
  date: schoolDateSchema,
  /** The lessons cancelled whatever is chosen, by start; `broughtIn` for the other half of a double outside the slots. */
  cancel: z.array(z.object({ lesson: dayLessonSchema, broughtIn: z.boolean() })),
  shared: z.array(bulkCancelSharedSchema),
  /** Lessons of the chosen classes in the slots already cancelled, left as they are (decision 9). */
  alreadyCancelled: z.array(dayLessonSchema),
  /** The other half of a double outside the slots that has started: held, not cancelled (review correction 1). */
  held: z.array(dayLessonSchema),
  /** Task 6.1b-2: the lessons of `cancel` and `shared` that hold data, by start. */
  withData: z.array(bulkCancelDataLessonSchema),
  /** Task 7.1b: per plan, the items that no longer fit and the rows left empty. */
  plans: z.array(planImpactSchema),
});

export type BulkCancelCheckAnswer = z.infer<typeof bulkCancelCheckAnswerSchema>;

export const bulkCancelAnswerSchema = z.object({
  id: z.uuid(),
  /** Every lesson the bulk cancel cancelled. */
  cancelled: z.array(z.uuid()),
  /** The shared blocks kept, the chosen classes' students exempt (decision 1). */
  kept: z.array(z.uuid()),
  /** Task 6.1b-2: the lessons with data kept as held, and the other halves of their doubles. */
  keptWithData: z.array(z.uuid()),
});

export type BulkCancelAnswer = z.infer<typeof bulkCancelAnswerSchema>;
