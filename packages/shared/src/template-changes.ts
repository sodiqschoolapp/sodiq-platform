import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import {
  calendarDayKeepsSchema,
  calendarExamBlocksSchema,
  calendarLessonsSchema,
} from './calendar.js';
import {
  assignmentEndSchema,
  assignmentFieldsSchema,
  dayTemplateVersionRecordSchema,
  refineAssignment,
  slotLengthChangeSchema,
  templateTableSchema,
} from './day-templates.js';
import { weekdaySchema } from './setup.js';
import { dayDecisionsSchema, transitionKeySchema } from './timetable.js';

/**
 * The saves of `day_templates` that change the times of dates from a date,
 * with what they do to the published timetable (task 5.6b-4a;
 * `edge/time-dates-calendar`, "A slot type's length or a day template is
 * changed mid-year"; `edge/timetable`, Versions and drafts: "Publish, a
 * calendar change and a template change each test every affected date with
 * the full rule set"). Apart from `day-templates.ts`, which the calendar's
 * schemas read.
 */

/**
 * The choices a template change takes for the dated lessons it writes again
 * (decision 8), as a calendar save takes them (task 5.6b-2a to 2c-1): the key
 * of the stored one-day changes shown and a choice per "needs a decision"
 * item, the lessons kept on a shortened special date, and a choice per shared
 * block newly under an exam. Strict: a change leaves no grade off, so the
 * calendar's `groupBlocks` is refused (`.claude/rules/api.md`).
 */
export const templateDaysBodySchema = z.strictObject({
  dayChangesKey: transitionKeySchema.optional(),
  dayDecisions: dayDecisionsSchema.optional(),
  dayKeeps: calendarDayKeepsSchema.optional(),
  examBlocks: calendarExamBlocksSchema.optional(),
});

export type TemplateDaysBody = z.infer<typeof templateDaysBodySchema>;

const days = { days: templateDaysBodySchema.optional() };

/** A new length of a slot type from a date (answer 12), with the choices. */
export const slotLengthSaveSchema = z.object({ ...slotLengthChangeSchema.shape, ...days });

export type SlotLengthSave = z.infer<typeof slotLengthSaveSchema>;

/** A new version of a template from a date (answer 12), with the choices. */
export const dayTemplateVersionSaveSchema = z.object({
  ...dayTemplateVersionRecordSchema.shape,
  ...days,
});

export type DayTemplateVersionSave = z.infer<typeof dayTemplateVersionSaveSchema>;

/** A template set at a level from a date (answer 11), with the choices. */
export const assignmentSaveSchema = z
  .object({ ...assignmentFieldsSchema.shape, ...days })
  .superRefine(refineAssignment);

export type AssignmentSave = z.infer<typeof assignmentSaveSchema>;

/** The end of a setting from a date, with the choices. */
export const assignmentEndSaveSchema = z.object({ ...assignmentEndSchema.shape, ...days });

export type AssignmentEndSave = z.infer<typeof assignmentEndSaveSchema>;

/**
 * A save that can change the table of templates, as the preview takes it
 * (`03`: "saving a template at any level shows that table with the changes
 * marked, as the preview of the change"; decision 19 of the review of 1.5).
 */
export const templateChangeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('slot_length'),
    slotTypeId: z.uuid(),
    change: slotLengthSaveSchema,
  }),
  z.object({
    kind: z.literal('template_version'),
    dayTemplateId: z.uuid(),
    change: dayTemplateVersionSaveSchema,
  }),
  z.object({ kind: z.literal('assignment_set'), change: assignmentSaveSchema }),
  z.object({
    kind: z.literal('assignment_end'),
    assignmentId: z.uuid(),
    change: assignmentEndSaveSchema,
  }),
]);

export type TemplateChange = z.infer<typeof templateChangeSchema>;

/** Why a change takes a lesson slot the published timetable uses (decision 4). */
export const USED_SLOT_PROBLEMS = ['removed', 'reordered'] as const;

/**
 * A lesson slot the published timetable uses that the change removes or
 * reorders (`template_slot_in_use`), for a run of dates with the same grade,
 * lesson number and problem.
 */
export const slotInUseSchema = z.object({
  firstDate: schoolDateSchema,
  lastDate: schoolDateSchema,
  grade: z.int(),
  /** The weekday whose pattern the dates follow. */
  weekday: weekdaySchema,
  lessonNumber: z.int(),
  problem: z.enum(USED_SLOT_PROBLEMS),
});

export type SlotInUse = z.infer<typeof slotInUseSchema>;

/**
 * The table on the date of a change, before and after, with the cells that
 * differ; and (task 5.6b-4a) what the change does to the published
 * timetable's dated lessons, with what refuses its save as lines.
 */
export const templatePreviewSchema = z.object({
  before: templateTableSchema,
  after: templateTableSchema,
  changed: z.array(z.object({ weekday: weekdaySchema, grade: z.int() })),
  lessons: calendarLessonsSchema,
  slotsInUse: z.array(slotInUseSchema),
});

export type TemplatePreview = z.infer<typeof templatePreviewSchema>;
