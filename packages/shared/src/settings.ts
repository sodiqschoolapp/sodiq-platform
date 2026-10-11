import { z } from 'zod';
import { academicYearStatusSchema, schoolDateSchema } from './academic-year.js';
import { branchIdSchema } from './branches.js';

/**
 * The settings of a branch and the setup checklist (task 1.6). The bounds and
 * defaults are the owner's answers 19 to 24 (docs/decisions.md, "Decided ahead
 * for tasks 1.3 to 1.6") and the decisions of pull request #49; the database
 * keeps the same ones (db/migrations/0019), and a test compares them.
 */

/** Answer 19: "edit days 1 to 30 (default 7)"; `07`, Editing rules and locks. */
export const EDIT_DAYS_MIN = 1;
export const EDIT_DAYS_MAX = 30;
export const EDIT_DAYS_DEFAULT = 7;

/**
 * Answer 19 and `08`, Early-warning list: the defaults; the bounds keep each
 * threshold meaningful (decision 2). "Five graded works" stays fixed in code
 * with the early-warning task, not here.
 */
export const EARLY_WARNING_BOUNDS = {
  lowResult: { min: 1, max: 100, default: 50 },
  resultDrop: { min: 1, max: 100, default: 15 },
  attendancePercent: { min: 1, max: 100, default: 80 },
  absencesInRow: { min: 1, max: 30, default: 3 },
} as const;

/** Answer 20 and `16` question 2: late 50, skipped 0, percent of a present lesson. */
export const ATTENDANCE_VALUE_MIN = 0;
export const ATTENDANCE_VALUE_MAX = 100;
export const LATE_VALUE_DEFAULT = 50;
export const SKIPPED_VALUE_DEFAULT = 0;

/** Answer 21: "0 to 180 minutes". */
export const TRAVEL_MINUTES_MAX = 180;

/**
 * `05`, Language of instruction: "The languages are Uzbek and Russian"; fixed
 * and shown read only (answer 22). Classes, groups and teachers use the list.
 */
export const INSTRUCTION_LANGUAGES = ['uz', 'ru'] as const;

export const instructionLanguageSchema = z.enum(INSTRUCTION_LANGUAGES);

export type InstructionLanguage = z.infer<typeof instructionLanguageSchema>;

const bounded = (bounds: { min: number; max: number }) => z.int().min(bounds.min).max(bounds.max);

// What is typed.

export const editDaysRecordSchema = z.object({
  editDays: z.int().min(EDIT_DAYS_MIN).max(EDIT_DAYS_MAX),
});

export type EditDaysRecord = z.infer<typeof editDaysRecordSchema>;

export const earlyWarningRecordSchema = z.object({
  lowResult: bounded(EARLY_WARNING_BOUNDS.lowResult),
  resultDrop: bounded(EARLY_WARNING_BOUNDS.resultDrop),
  attendancePercent: bounded(EARLY_WARNING_BOUNDS.attendancePercent),
  absencesInRow: bounded(EARLY_WARNING_BOUNDS.absencesInRow),
});

export type EarlyWarningRecord = z.infer<typeof earlyWarningRecordSchema>;

const attendanceValueSchema = z.int().min(ATTENDANCE_VALUE_MIN).max(ATTENDANCE_VALUE_MAX);

export const attendanceValuesRecordSchema = z.object({
  lateValue: attendanceValueSchema,
  skippedValue: attendanceValueSchema,
});

export type AttendanceValuesRecord = z.infer<typeof attendanceValuesRecordSchema>;

/** The pair is the branch of the request and `otherBranchId`. */
export const travelTimeRecordSchema = z.object({
  otherBranchId: branchIdSchema,
  minutes: z.int().min(0).max(TRAVEL_MINUTES_MAX),
});

export type TravelTimeRecord = z.infer<typeof travelTimeRecordSchema>;

// What the routes answer.

/** The settings of the branch of the request. */
export const branchSettingsSchema = earlyWarningRecordSchema.extend(editDaysRecordSchema.shape);

export type BranchSettings = z.infer<typeof branchSettingsSchema>;

/** One quarter of a planned or current year with its two values. */
export const quarterAttendanceValuesSchema = z.object({
  id: z.uuid(),
  number: z.int().min(1).max(4),
  startDate: schoolDateSchema.nullable(),
  endDate: schoolDateSchema.nullable(),
  lateValue: attendanceValueSchema,
  skippedValue: attendanceValueSchema,
});

export type QuarterAttendanceValues = z.infer<typeof quarterAttendanceValuesSchema>;

/** The planned and current years of the branch, oldest first, each with its four quarters. */
export const attendanceValuesListSchema = z.object({
  years: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      status: academicYearStatusSchema,
      quarters: z.array(quarterAttendanceValuesSchema),
    }),
  ),
});

export type AttendanceValuesList = z.infer<typeof attendanceValuesListSchema>;

/** Every other branch, by name, with the minutes of the pair; `null` while not set. */
export const travelTimeListSchema = z.object({
  pairs: z.array(
    z.object({
      branchId: branchIdSchema,
      branchName: z.string(),
      minutes: z.int().min(0).max(TRAVEL_MINUTES_MAX).nullable(),
    }),
  ),
});

export type TravelTimeList = z.infer<typeof travelTimeListSchema>;

/**
 * `edge/academic-year`: "Each branch has a setup checklist in a fixed order".
 * The items of Phase 1 (answer 23); a later task adds its own key here.
 */
export const CHECKLIST_ITEMS = [
  'branch',
  'rooms',
  'departments',
  'year',
  'quarters',
  'slotTypes',
  'defaultTemplate',
  'calendar',
] as const;

export const checklistItemKeySchema = z.enum(CHECKLIST_ITEMS);

export type ChecklistItemKey = z.infer<typeof checklistItemKeySchema>;

/**
 * One item. `done` is `null` for an item that never blocks (the calendar,
 * answer 23); `count` is the calendar's number of entries; `years` names the
 * planned or current years whose quarters are not all dated.
 */
export const checklistItemSchema = z.object({
  key: checklistItemKeySchema,
  done: z.boolean().nullable(),
  count: z.int().min(0).nullable(),
  years: z.array(z.string()),
});

export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const setupChecklistSchema = z.object({ items: z.array(checklistItemSchema) });

export type SetupChecklist = z.infer<typeof setupChecklistSchema>;
