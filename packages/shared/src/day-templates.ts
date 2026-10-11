import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { weekdaySchema } from './setup.js';

/**
 * Slot types and day templates (docs/spec/03-school-setup.md, Slot types and
 * day templates; task 1.5). The bounds are the owner's answers 9 and 10
 * (docs/decisions.md, "Decided ahead for tasks 1.3 to 1.6") and the decisions
 * of pull request #46; the database keeps the same ones (db/migrations/0017),
 * and a test compares them.
 */

/** One typed name of a slot type or a template, not three languages (decision 17). */
export const SLOT_TYPE_NAME_MAX_LENGTH = 60;
export const DAY_TEMPLATE_NAME_MAX_LENGTH = 60;

/** Answer 9: "length 5 to 180 whole minutes". */
export const SLOT_LENGTH_MIN_MINUTES = 5;
export const SLOT_LENGTH_MAX_MINUTES = 180;

/** Answer 10: "1 to 20 ordered slots with at least one lesson slot". */
export const DAY_TEMPLATE_SLOTS_MAX = 20;

/** The grades of the school (answer 13: "grades 1 to 11"). */
export const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

export const FIRST_GRADE = 1;
export const LAST_GRADE = 11;

/** Answer 9: "kind lesson or break (lunch is a break named Lunch)". */
export const SLOT_KINDS = ['lesson', 'break'] as const;

export const slotKindSchema = z.enum(SLOT_KINDS);

export type SlotKindName = z.infer<typeof slotKindSchema>;

/**
 * Where a template is set (answer 11): the default, a grade range, a weekday,
 * a weekday with a grade range. Special dates come with the calendar (1.4).
 */
export const TEMPLATE_LEVELS = ['default', 'grades', 'weekday', 'weekday_grades'] as const;

export const templateLevelSchema = z.enum(TEMPLATE_LEVELS);

export type TemplateLevelName = z.infer<typeof templateLevelSchema>;

/** Whether a level names a weekday, and whether it names a grade range. */
export const levelHasWeekday = (level: TemplateLevelName): boolean =>
  level === 'weekday' || level === 'weekday_grades';
export const levelHasGrades = (level: TemplateLevelName): boolean =>
  level === 'grades' || level === 'weekday_grades';

const MINUTES_PER_HOUR = 60;

/** The one typed time of a template (answer 10): `HH:MM`, 00:00 to 23:59. */
export const timeOfDaySchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'A time as HH:MM.' });

/** `08:30` as minutes after midnight (decision 6: integers in every calculation). */
export function minutesOf(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * MINUTES_PER_HOUR + Number(minutes);
}

/** The school date after the one given: the first date a change can take effect from today. */
export function nextDay(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

/** Minutes after midnight as `HH:MM`; the end of a day may be `24:00`. */
export function timeText(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

const slotTypeNameSchema = z.string().trim().min(1).max(SLOT_TYPE_NAME_MAX_LENGTH);
const dayTemplateNameSchema = z.string().trim().min(1).max(DAY_TEMPLATE_NAME_MAX_LENGTH);
const lengthMinutesSchema = z.int().min(SLOT_LENGTH_MIN_MINUTES).max(SLOT_LENGTH_MAX_MINUTES);
const gradeSchema = z.int().min(FIRST_GRADE).max(LAST_GRADE);

/**
 * The date a change takes effect: tomorrow at the earliest in branch time
 * (`03`; `edge/time-dates-calendar`). The server compares it with its clock
 * (`date_not_in_future`); the schema checks the form only.
 */
const fromSchema = schoolDateSchema;

// What is typed.

/** A new slot type: its kind is fixed from now on (decision 3). */
export const slotTypeRecordSchema = z.object({
  name: slotTypeNameSchema,
  kind: slotKindSchema,
  lengthMinutes: lengthMinutesSchema,
});

export type SlotTypeRecord = z.infer<typeof slotTypeRecordSchema>;

/** A new name of a slot type or a template, in place (decision 5). */
export const slotTypeRenameSchema = z.object({ name: slotTypeNameSchema });

export type SlotTypeRename = z.infer<typeof slotTypeRenameSchema>;

export const dayTemplateRenameSchema = z.object({ name: dayTemplateNameSchema });

export type DayTemplateRename = z.infer<typeof dayTemplateRenameSchema>;

/** A new length of a slot type from a date (answer 12). */
export const slotLengthChangeSchema = z.object({
  lengthMinutes: lengthMinutesSchema,
  from: fromSchema,
});

export type SlotLengthChange = z.infer<typeof slotLengthChangeSchema>;

/** The slot types of a template in their order, 1 to 20 (answer 10). The kinds are checked by the server. */
const slotTypeIdsSchema = z.array(z.uuid()).min(1).max(DAY_TEMPLATE_SLOTS_MAX);

/** A new template: its name, its start time and its slots. */
export const dayTemplateRecordSchema = z.object({
  name: dayTemplateNameSchema,
  startTime: timeOfDaySchema,
  slotTypeIds: slotTypeIdsSchema,
});

export type DayTemplateRecord = z.infer<typeof dayTemplateRecordSchema>;

/** New slots or a new start time of a template from a date (answer 12). */
export const dayTemplateVersionRecordSchema = z.object({
  from: fromSchema,
  startTime: timeOfDaySchema,
  slotTypeIds: slotTypeIdsSchema,
});

export type DayTemplateVersionRecord = z.infer<typeof dayTemplateVersionRecordSchema>;

/**
 * A template set at a level from a date (answer 11). Flat, as a form sends
 * it: the weekday only for the two weekday levels, the grade range only for
 * the two grade levels, and the range upwards. The database keeps the same
 * rule (`day_template_assignments_key_check`).
 */
export const assignmentRecordSchema = z
  .object({
    level: templateLevelSchema,
    weekday: weekdaySchema.nullable(),
    gradeFrom: gradeSchema.nullable(),
    gradeTo: gradeSchema.nullable(),
    dayTemplateId: z.uuid(),
    from: fromSchema,
  })
  .superRefine((record, context) => {
    const needsWeekday = levelHasWeekday(record.level);
    if (needsWeekday !== (record.weekday !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['weekday'],
        message: needsWeekday ? 'This level names a weekday.' : 'This level names no weekday.',
      });
    }
    const needsGrades = levelHasGrades(record.level);
    for (const field of ['gradeFrom', 'gradeTo'] as const) {
      if (needsGrades !== (record[field] !== null)) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: needsGrades ? 'This level names grades.' : 'This level names no grades.',
        });
      }
    }
    if (record.gradeFrom !== null && record.gradeTo !== null && record.gradeFrom > record.gradeTo) {
      context.addIssue({
        code: 'custom',
        path: ['gradeTo'],
        message: 'The last grade is not before the first.',
      });
    }
  });

export type AssignmentRecord = z.infer<typeof assignmentRecordSchema>;

/** The end of a template set at a level, from a date. The default cannot be ended (decision 8). */
export const assignmentEndSchema = z.object({ from: fromSchema });

export type AssignmentEnd = z.infer<typeof assignmentEndSchema>;

/**
 * A save that can change the table of templates, as the preview takes it
 * (`03`: "saving a template at any level shows that table with the changes
 * marked, as the preview of the change"; decision 19 of the review).
 */
export const templateChangeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('slot_length'),
    slotTypeId: z.uuid(),
    change: slotLengthChangeSchema,
  }),
  z.object({
    kind: z.literal('template_version'),
    dayTemplateId: z.uuid(),
    change: dayTemplateVersionRecordSchema,
  }),
  z.object({ kind: z.literal('assignment_set'), change: assignmentRecordSchema }),
  z.object({
    kind: z.literal('assignment_end'),
    assignmentId: z.uuid(),
    change: assignmentEndSchema,
  }),
]);

export type TemplateChange = z.infer<typeof templateChangeSchema>;

/** The date of the table: any school date. */
export const templateTableQuerySchema = z.object({ date: schoolDateSchema });

export type TemplateTableQuery = z.infer<typeof templateTableQuerySchema>;

/** The date the slots of a template are timed on. */
export const dayTemplateQuerySchema = z.object({ date: schoolDateSchema });

export type DayTemplateQuery = z.infer<typeof dayTemplateQuerySchema>;

// What the routes answer.

/** A dated row as the answers show it: in force over `[validFrom, validUntil)`. */
const datedSchema = {
  validFrom: schoolDateSchema,
  /** `null` while open. */
  validUntil: schoolDateSchema.nullable(),
};

export const slotLengthSchema = z.object({ lengthMinutes: z.int(), ...datedSchema });

export type SlotLength = z.infer<typeof slotLengthSchema>;

export const slotTypeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: slotKindSchema,
  /** The length in force today in branch time. */
  lengthMinutes: z.int(),
  /** Every length, oldest first; withdrawn ones left out. */
  lengths: z.array(slotLengthSchema),
  archivedAt: z.iso.datetime().nullable(),
});

export type SlotType = z.infer<typeof slotTypeSchema>;

/**
 * `today` is the school date of the server's clock in branch time: the web app
 * never reads the device's clock (`edge/00-definitions`, Branch time), and
 * offers tomorrow as the first date of a change.
 */
export const slotTypeListSchema = z.object({
  today: schoolDateSchema,
  slotTypes: z.array(slotTypeSchema),
});

export type SlotTypeList = z.infer<typeof slotTypeListSchema>;

/** One slot of a template on a date, with its calculated times. */
export const timedSlotSchema = z.object({
  position: z.int(),
  slotTypeId: z.uuid(),
  name: z.string(),
  kind: slotKindSchema,
  lengthMinutes: z.int(),
  /** Minutes after midnight. */
  start: z.int(),
  end: z.int(),
  /** The order of a lesson slot among the day's lesson slots; `null` for a break. */
  lessonNumber: z.int().nullable(),
});

export type TimedSlot = z.infer<typeof timedSlotSchema>;

export const dayTemplateVersionSchema = z.object({
  id: z.uuid(),
  startMinutes: z.int(),
  slotTypeIds: z.array(z.uuid()),
  ...datedSchema,
});

export type DayTemplateVersion = z.infer<typeof dayTemplateVersionSchema>;

/** A template in the list, with its day on the date of the list (today in branch time). */
export const dayTemplateSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  archivedAt: z.iso.datetime().nullable(),
  /** The start and end of its day, and its lesson slots; `null` before its first version. */
  start: z.int().nullable(),
  end: z.int().nullable(),
  lessonSlots: z.int(),
  /** Whether a setting of it is in force today or later. */
  inUse: z.boolean(),
});

export type DayTemplateSummary = z.infer<typeof dayTemplateSummarySchema>;

export const dayTemplateListSchema = z.object({
  today: schoolDateSchema,
  dayTemplates: z.array(dayTemplateSummarySchema),
});

export type DayTemplateList = z.infer<typeof dayTemplateListSchema>;

/** One template: its versions, and its slots timed on the date asked for. */
export const dayTemplateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  archivedAt: z.iso.datetime().nullable(),
  date: schoolDateSchema,
  /** The slots in force on the date; empty before the first version. */
  slots: z.array(timedSlotSchema),
  /** Every version, oldest first; withdrawn ones left out. */
  versions: z.array(dayTemplateVersionSchema),
});

export type DayTemplate = z.infer<typeof dayTemplateSchema>;

export const assignmentSchema = z.object({
  id: z.uuid(),
  level: templateLevelSchema,
  weekday: weekdaySchema.nullable(),
  gradeFrom: z.int().nullable(),
  gradeTo: z.int().nullable(),
  dayTemplateId: z.uuid(),
  ...datedSchema,
});

export type Assignment = z.infer<typeof assignmentSchema>;

/** Every setting of the branch, withdrawn ones left out, by level and then date. */
export const assignmentListSchema = z.object({
  today: schoolDateSchema,
  assignments: z.array(assignmentSchema),
});

export type AssignmentList = z.infer<typeof assignmentListSchema>;

/** The template of one weekday and grade on the date, with its day; `null` when none applies. */
export const tableCellSchema = z.object({
  weekday: weekdaySchema,
  grade: z.int(),
  template: z
    .object({
      id: z.uuid(),
      name: z.string(),
      start: z.int(),
      end: z.int(),
      lessonSlots: z.int(),
    })
    .nullable(),
});

export type TableCell = z.infer<typeof tableCellSchema>;

/**
 * The resulting template for every working weekday and grade 1 to 11 on a
 * date (`03`: "School setup shows the template that results for every weekday
 * and grade in one table"; answer 13).
 */
export const templateTableSchema = z.object({
  date: schoolDateSchema,
  weekdays: z.array(weekdaySchema),
  cells: z.array(tableCellSchema),
});

export type TemplateTable = z.infer<typeof templateTableSchema>;

/** The table on the date of a change, before and after, with the cells that differ. */
export const templatePreviewSchema = z.object({
  before: templateTableSchema,
  after: templateTableSchema,
  changed: z.array(z.object({ weekday: weekdaySchema, grade: z.int() })),
});

export type TemplatePreview = z.infer<typeof templatePreviewSchema>;
