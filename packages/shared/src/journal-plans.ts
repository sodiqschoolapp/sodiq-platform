import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { planFileSchema, planWorkSchema } from './plans.js';

/**
 * Plans in the journal (task 8.8, pull request #226; `09`, In the journal;
 * `edge/lesson-plans`, Plans and the journal): the lesson card, "topic not
 * delivered" and "homework not given".
 */

/** A homework given at the lesson (`09`: "given today"). */
export const cardGivenSchema = z.object({
  /** `null` for a homework given by hand at a lesson with no plan item. */
  planWorkId: z.uuid().nullable(),
  title: z.string().nullable(),
  /** The plan's description; `null` for a reader of topic and homework only. */
  description: z.string().nullable(),
  /** Marked "not given": the next lesson has no column for it. */
  notGiven: z.boolean(),
  /** The lesson that checks it, with its date and slot; `null` when none does. */
  checkAt: z
    .object({ lessonId: z.uuid(), date: schoolDateSchema, slot: z.int().min(1).nullable() })
    .nullable(),
  /**
   * `edge/lesson-plans`, "A double lesson": "Homework on the first of two same-day lessons shows
   * the warning 'will be checked today in slot N'".
   */
  checkedSameDay: z.boolean(),
  ungraded: z.enum(['year_end', 'group_closed']).nullable(),
});

/** A homework checked at the lesson (`09`: "checked today", given at the previous lesson). */
export const cardCheckedSchema = z.object({
  title: z.string().nullable(),
  /** The date of the lesson it was given at, `null` for a homework carried in. */
  givenOn: schoolDateSchema.nullable(),
});

export const lessonCardSchema = z.object({
  lessonId: z.uuid(),
  journalId: z.uuid(),
  /** `edge/lesson-plans`, "Lesson numbers after a cancellation"; `null` for a cancelled lesson. */
  number: z.int().min(1).nullable(),
  date: schoolDateSchema,
  /** Clock minutes of the day in branch time. */
  start: z.int().min(0),
  end: z.int().min(1),
  slot: z.int().min(1).nullable(),
  held: z.boolean(),
  /** The lesson's row has a plan item. */
  planItem: z.boolean(),
  topic: z.string().nullable(),
  /**
   * The reader sees the whole item (a reader of the plan, the lesson's teacher or its substitute
   * in force); `false` gives topic and homework titles only (`edge/lesson-plans`: "A Tutor sees
   * topic and homework of the class through the journal").
   */
  whole: z.boolean(),
  classworks: z.array(planWorkSchema),
  objectives: z.string().nullable(),
  links: z.array(z.string()),
  files: z.array(planFileSchema),
  givenToday: z.array(cardGivenSchema),
  checkedToday: z.array(cardCheckedSchema),
  /** "Topic not delivered" and the version a change of it is sent on (`null` before the first). */
  delivery: z.object({ notDelivered: z.boolean(), version: z.int().min(1).nullable() }),
  /** The reader may set the marks now: the lesson's teacher, held, inside the edit period. */
  canMark: z.boolean(),
  editedAfterLesson: z.boolean(),
  movedFrom: schoolDateSchema.nullable(),
});

export type LessonCard = z.infer<typeof lessonCardSchema>;

/** "Topic not delivered" set or undone, on the version read. */
export const lessonDeliverySchema = z.strictObject({
  notDelivered: z.boolean(),
  version: z.int().min(1).nullable(),
});

export type LessonDelivery = z.infer<typeof lessonDeliverySchema>;

export const lessonDeliveryAnswerSchema = z.object({
  notDelivered: z.boolean(),
  version: z.int().min(1),
  /** The copy of the item put into "not covered", while it is there. */
  copyItemId: z.uuid().nullable(),
});

export type LessonDeliveryAnswer = z.infer<typeof lessonDeliveryAnswerSchema>;

/** At most the homeworks of one item (`LESSON_WORKS_MAX`). */
export const NOT_GIVEN_MAX = 10;

/** "Not given" set or undone on some or all of the item's homeworks. */
export const homeworkGivenSchema = z
  .strictObject({
    planWorkIds: z.array(z.uuid()).min(1).max(NOT_GIVEN_MAX),
    notGiven: z.boolean(),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.planWorkIds.forEach((id, index) => {
      const key = id.toLowerCase();
      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['planWorkIds', index],
          message: 'A call names each homework once.',
        });
      }
      seen.add(key);
    });
  });

export type HomeworkGiven = z.infer<typeof homeworkGivenSchema>;

export const homeworkGivenAnswerSchema = z.object({
  /** The homeworks of the item marked "not given" now. */
  notGiven: z.array(z.uuid()),
});

export type HomeworkGivenAnswer = z.infer<typeof homeworkGivenAnswerSchema>;
