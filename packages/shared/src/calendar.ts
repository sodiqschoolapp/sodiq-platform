import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { FIRST_GRADE, LAST_GRADE } from './day-templates.js';
import { weekdaySchema } from './setup.js';
import {
  dayChangesAnswerSchema,
  dayDecisionsSchema,
  dayKeepBodySchema,
  NEEDS_TEACHER_REASONS,
  previewNamesSchema,
  shortenedDaySchema,
  transitionKeySchema,
} from './timetable.js';

/**
 * The academic calendar of a branch (docs/spec/03-school-setup.md, Academic
 * calendar; docs/spec/edge-cases/time-dates-calendar.md; task 1.4). The bounds
 * and fields are the owner's answers 15 to 18 (docs/decisions.md, "Decided
 * ahead for tasks 1.3 to 1.6") and the decisions of pull request #47; the
 * database keeps the same ones (db/migrations/0018), and a test compares them.
 */

/** Answer 15: "one typed name (branch data such as 'Navruz', not a three-language term)". */
export const CALENDAR_ENTRY_NAME_MAX_LENGTH = 60;

/** Answer 15: "An entry has a kind (day off or special day)". */
export const CALENDAR_ENTRY_KINDS = ['day_off', 'special_day'] as const;

export const calendarEntryKindSchema = z.enum(CALENDAR_ENTRY_KINDS);

export type CalendarEntryKindName = z.infer<typeof calendarEntryKindSchema>;

/** Answer 15: an exam week says "regular lessons on this template" or "no regular lessons". */
export const EXAM_WEEKS = ['regular_lessons', 'no_regular_lessons'] as const;

export const examWeekSchema = z.enum(EXAM_WEEKS);

export type ExamWeekName = z.infer<typeof examWeekSchema>;

const nameSchema = z.string().trim().min(1).max(CALENDAR_ENTRY_NAME_MAX_LENGTH);
const gradeSchema = z.int().min(FIRST_GRADE).max(LAST_GRADE);

// What is typed.

/**
 * An entry as a form sends it. Both dates count (decision 1). The grades are
 * both given (a range upwards) or neither (the whole branch). A special day
 * names a template and may name the weekday it follows and an exam week; a day
 * off names none of the three. The server checks the dates against its clock
 * and the years, and the followed weekday against the working weekdays; the
 * database keeps the same shape (`calendar_entries_kind_check`).
 */
const calendarEntryFields = z.object({
  kind: calendarEntryKindSchema,
  name: nameSchema,
  firstDate: schoolDateSchema,
  lastDate: schoolDateSchema,
  gradeFrom: gradeSchema.nullable(),
  gradeTo: gradeSchema.nullable(),
  dayTemplateId: z.uuid().nullable(),
  followsWeekday: weekdaySchema.nullable(),
  examWeek: examWeekSchema.nullable(),
});

function refineEntry(
  record: z.infer<typeof calendarEntryFields>,
  context: z.core.$RefinementCtx,
): void {
  {
    if (record.lastDate < record.firstDate) {
      context.addIssue({
        code: 'custom',
        path: ['lastDate'],
        message: 'The last date is not before the first.',
      });
    }
    if ((record.gradeFrom === null) !== (record.gradeTo === null)) {
      context.addIssue({
        code: 'custom',
        path: [record.gradeFrom === null ? 'gradeFrom' : 'gradeTo'],
        message: 'Both grades, or neither for the whole branch.',
      });
    }
    if (record.gradeFrom !== null && record.gradeTo !== null && record.gradeFrom > record.gradeTo) {
      context.addIssue({
        code: 'custom',
        path: ['gradeTo'],
        message: 'The last grade is not before the first.',
      });
    }
    if (record.kind === 'special_day' && record.dayTemplateId === null) {
      context.addIssue({
        code: 'custom',
        path: ['dayTemplateId'],
        message: 'A special day names a day template.',
      });
    }
    if (record.kind === 'day_off') {
      for (const field of ['dayTemplateId', 'followsWeekday', 'examWeek'] as const) {
        if (record[field] !== null) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: 'A day off names no template, weekday or exam week.',
          });
        }
      }
    }
  }
}

export const calendarEntryRecordSchema = calendarEntryFields.superRefine(refineEntry);

export type CalendarEntryRecord = z.infer<typeof calendarEntryRecordSchema>;

/**
 * The choices of the lessons kept on the shortened days of the dates a
 * calendar save writes (task 5.6b-2b, pull request #171, decision 2): one per
 * date and class, in the shape of the draft's choice (`dayKeepBodySchema`);
 * an empty list of positions removes the stored choice.
 */
export const calendarDayKeepsSchema = z
  .array(dayKeepBodySchema)
  .max(500)
  .refine((list) => new Set(list.map((one) => `${one.date}|${one.classId}`)).size === list.length, {
    message: 'Each date and class once.',
  });

export type CalendarDayKeeps = z.infer<typeof calendarDayKeepsSchema>;

/** Task 5.6b-2c-1: the two choices for a shared block newly under an exam (`edge/timetable`, Exams, second row). */
export const CALENDAR_EXAM_BLOCK_CHOICES = ['cancel', 'keep'] as const;

/**
 * Task 5.6b-2c-1 (decision 5): for a class sitting an exam whose lesson at the
 * exam's time a calendar save newly puts in a block shared with classes that
 * do not sit, the choice of the Exams row: `cancel` the whole block with the
 * reason "exam", or `keep` it for the other classes and take the sitting
 * class out of it. Once per exam, class and block ("For each [block], the
 * Academic Vice Principal chooses"), the block named by its first minute of
 * the day after the save, as the preview lists it (`blocks[].start`).
 */
export const calendarExamBlocksSchema = z
  .array(
    z.strictObject({
      examId: z.uuid(),
      classId: z.uuid(),
      start: z.int().min(0).max(1440),
      choice: z.enum(CALENDAR_EXAM_BLOCK_CHOICES),
    }),
  )
  .max(500)
  .refine(
    (list) =>
      new Set(
        list.map(
          (one) => `${one.examId.toLowerCase()}|${one.classId.toLowerCase()}|${String(one.start)}`,
        ),
      ).size === list.length,
    {
      message: 'Each exam, class and block once.',
    },
  );

export type CalendarExamBlocks = z.infer<typeof calendarExamBlocksSchema>;

/**
 * A create or an edit (task 5.6b-2a): the entry, with the key of the sorting
 * of the stored one-day changes and bulk cancels the preview showed
 * (`CalendarLessons.dayChanges.key`) and a choice for each "needs a
 * decision" item, as a publish sends them; without them, a save over dates
 * with nothing stored, as before. Strict, so that a misspelt field is refused
 * rather than dropped (permission review should-fix 5).
 */
export const calendarSaveSchema = z
  .strictObject({
    ...calendarEntryFields.shape,
    dayChangesKey: transitionKeySchema.optional(),
    dayDecisions: dayDecisionsSchema.optional(),
    /** Task 5.6b-2b: the shortened days' choices. */
    dayKeeps: calendarDayKeepsSchema.optional(),
    /** Task 5.6b-2c-1: the choices for shared blocks newly under an exam. */
    examBlocks: calendarExamBlocksSchema.optional(),
  })
  .superRefine(refineEntry);

/**
 * An archive or a restore: the body of a withdraw (task 5.6b-2a) and the
 * shortened days' choices (task 5.6b-2b).
 */
export const calendarDaysBodySchema = z
  .strictObject({
    dayChangesKey: transitionKeySchema.optional(),
    dayDecisions: dayDecisionsSchema.optional(),
    dayKeeps: calendarDayKeepsSchema.optional(),
    examBlocks: calendarExamBlocksSchema.optional(),
  })
  .default({});

export type CalendarDaysBody = z.infer<typeof calendarDaysBodySchema>;

export type CalendarSave = z.infer<typeof calendarSaveSchema>;

/**
 * A save that can change what a date has, as the preview takes it (`03`;
 * `edge/time-dates-calendar`, "the impact preview is shown first"; decision 11).
 */
export const calendarChangeSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    record: calendarEntryRecordSchema,
    dayKeeps: calendarDayKeepsSchema.optional(),
    examBlocks: calendarExamBlocksSchema.optional(),
  }),
  z.object({
    action: z.literal('edit'),
    id: z.uuid(),
    record: calendarEntryRecordSchema,
    dayKeeps: calendarDayKeepsSchema.optional(),
    examBlocks: calendarExamBlocksSchema.optional(),
  }),
  z.object({
    action: z.literal('archive'),
    id: z.uuid(),
    dayKeeps: calendarDayKeepsSchema.optional(),
    examBlocks: calendarExamBlocksSchema.optional(),
  }),
  z.object({
    action: z.literal('restore'),
    id: z.uuid(),
    dayKeeps: calendarDayKeepsSchema.optional(),
    examBlocks: calendarExamBlocksSchema.optional(),
  }),
]);

export type CalendarChange = z.infer<typeof calendarChangeSchema>;

export const calendarDayQuerySchema = z.object({ date: schoolDateSchema });

export type CalendarDayQuery = z.infer<typeof calendarDayQuerySchema>;

// What the routes answer.

export const calendarEntrySchema = z.object({
  id: z.uuid(),
  kind: calendarEntryKindSchema,
  name: z.string(),
  firstDate: schoolDateSchema,
  lastDate: schoolDateSchema,
  gradeFrom: z.int().nullable(),
  gradeTo: z.int().nullable(),
  dayTemplateId: z.uuid().nullable(),
  /** The name of the template, for the list; `null` for a day off. */
  dayTemplateName: z.string().nullable(),
  followsWeekday: weekdaySchema.nullable(),
  examWeek: examWeekSchema.nullable(),
  archivedAt: z.iso.datetime().nullable(),
});

export type CalendarEntry = z.infer<typeof calendarEntrySchema>;

/**
 * Every entry of the branch, archived ones included, by first date. `today` is
 * the school date of the server's clock in branch time: the web app never
 * reads the device's clock (`edge/00-definitions`, Branch time).
 */
export const calendarEntryListSchema = z.object({
  today: schoolDateSchema,
  entries: z.array(calendarEntrySchema),
});

export type CalendarEntryList = z.infer<typeof calendarEntryListSchema>;

/** Why a date has no lessons for a grade: an entry, a weekday without school, or no template set yet. */
export const NO_LESSONS_REASONS = ['day_off', 'not_working_day', 'no_template'] as const;

/** What a grade has on a date (`dayOn` of `packages/timetable-rules`), with the names to show. */
export const calendarDaySchema = z.discriminatedUnion('lessons', [
  z.object({
    lessons: z.literal(false),
    reason: z.enum(NO_LESSONS_REASONS),
    entryId: z.uuid().nullable(),
    entryName: z.string().nullable(),
  }),
  z.object({
    lessons: z.literal(true),
    dayTemplateId: z.uuid(),
    dayTemplateName: z.string(),
    followsWeekday: weekdaySchema,
    examWeek: examWeekSchema.nullable(),
    entryId: z.uuid().nullable(),
    entryName: z.string().nullable(),
  }),
]);

export type CalendarDay = z.infer<typeof calendarDaySchema>;

/** Every grade on one date ("Check a date", decision 15). */
export const calendarDateSchema = z.object({
  date: schoolDateSchema,
  grades: z.array(z.object({ grade: z.int(), day: calendarDaySchema })),
});

export type CalendarDate = z.infer<typeof calendarDateSchema>;

/** A dated lesson of the branch as the preview of a calendar save names it (task 5.6b-1): minutes of its day. */
export const calendarLessonSchema = z.object({
  date: schoolDateSchema,
  start: z.int().min(0).max(1440),
  end: z.int().min(0).max(1440),
  unitId: z.uuid(),
  subjectId: z.uuid(),
  /** Empty for a lesson with no teacher (a Tutor lesson with no Tutor). */
  teacherIds: z.array(z.uuid()),
  roomId: z.uuid().nullable(),
});

export type CalendarLesson = z.infer<typeof calendarLessonSchema>;

/** Why the rewrite of a date creates a lesson cancelled (`edge/time-dates-calendar`). */
export const CALENDAR_CANCEL_CAUSES = ['not_in_template', 'day_off', 'exam_week'] as const;

/** A time of a day in minutes, as `calendarLessonSchema` gives it. */
const dayTimeSchema = z.object({
  start: z.int().min(0).max(1440),
  end: z.int().min(0).max(1440),
});

/**
 * What a calendar save does to the dated lessons of the published versions
 * (task 5.6b-1; `edge/time-dates-calendar`, "the impact preview is shown
 * first"): the lessons of the changed dates removed, created and created
 * cancelled, those that will need a teacher, the teachers who will be told,
 * and what refuses the save: the blocked conflicts by date
 * (`calendar_blocked`). It names records of the branch only.
 */
export const calendarLessonsSchema = z.object({
  removed: z.array(calendarLessonSchema),
  created: z.array(calendarLessonSchema),
  cancelled: z.array(calendarLessonSchema.extend({ cause: z.enum(CALENDAR_CANCEL_CAUSES) })),
  needsTeacher: z.array(
    z.object({
      date: schoolDateSchema,
      unitId: z.uuid(),
      subjectId: z.uuid(),
      reason: z.enum(NEEDS_TEACHER_REASONS),
    }),
  ),
  /** The teachers (staff ids) who get a notice: a person with an account, never a vacancy. */
  notified: z.array(z.uuid()),
  blocked: z.array(
    z.object({
      date: schoolDateSchema,
      /** The rule (`timetable.rule.<code>`). */
      rule: z.string().regex(/^[a-z_]+$/),
      lessons: z.array(z.object({ unitId: z.uuid(), subjectId: z.uuid() })),
    }),
  ),
  /**
   * Task 5.6b-2a: the stored one-day changes and bulk cancels of the changed
   * dates, sorted as a publish sorts them, with the key the save sends back.
   */
  dayChanges: dayChangesAnswerSchema,
  /**
   * Task 5.6b-2b: the dates written that are shortened for a class, with the
   * lessons kept (the choice sent, the stored one, or by their order in the day).
   */
  shortenedDays: z.array(
    shortenedDaySchema.extend({
      /** Each lesson with its class or group and subject, named in `names`. */
      lessons: z.array(
        shortenedDaySchema.shape.lessons.element.extend({
          subjects: z.array(z.object({ unitId: z.uuid(), subjectId: z.uuid() })),
        }),
      ),
    }),
  ),
  /**
   * Task 5.6b-2b, decision 10: the preview's ticks it cannot apply, left out
   * (the stored choice decides); the save refuses them with the same code.
   */
  keepRefusals: z.array(
    z.object({
      date: schoolDateSchema,
      classId: z.uuid(),
      code: z.enum([
        'day_keep_date_passed',
        'day_keep_not_short',
        'day_keep_lessons',
        'day_keep_over_slots',
      ]),
    }),
  ),
  /**
   * Task 5.6b-2c-1: each exam standing on a date written, as the save leaves
   * it: cancelled for a day off, moved with its slots, kept, or refused with
   * its code (a detail of `calendar_blocked` in the save); the rules its
   * recheck meets, and the shared blocks newly under it with the choice sent
   * (`null`: none yet, which the save refuses).
   */
  exams: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      date: schoolDateSchema,
      outcome: z.enum(['cancelled_day_off', 'moved', 'kept', 'refused']),
      before: dayTimeSchema,
      /** `null` for an exam cancelled or refused. */
      after: dayTimeSchema.nullable(),
      code: z.enum(['calendar_exam_slots', 'calendar_exam_templates']).nullable(),
      blockedRules: z.array(z.string().regex(/^[a-z_]+$/)),
      blocks: z.array(
        z.object({
          classId: z.uuid(),
          /** The block's first minute after the save: names it in `examBlocks`. */
          start: z.int().min(0).max(1440),
          lessons: z.array(z.object({ unitId: z.uuid(), subjectId: z.uuid() })),
          choice: z.enum(CALENDAR_EXAM_BLOCK_CHOICES).nullable(),
        }),
      ),
    }),
  ),
  names: previewNamesSchema,
});

export type CalendarLessons = z.infer<typeof calendarLessonsSchema>;

/**
 * What a save changes: runs of consecutive dates and of grades whose day is
 * the same before and the same after (decision 11), oldest date first; and
 * what it does to the dated lessons (task 5.6b-1).
 */
export const calendarPreviewSchema = z.object({
  changes: z.array(
    z.object({
      firstDate: schoolDateSchema,
      lastDate: schoolDateSchema,
      gradeFrom: z.int(),
      gradeTo: z.int(),
      before: calendarDaySchema,
      after: calendarDaySchema,
    }),
  ),
  lessons: calendarLessonsSchema,
});

export type CalendarPreview = z.infer<typeof calendarPreviewSchema>;
