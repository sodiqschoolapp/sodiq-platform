import { z } from 'zod';
import {
  quarterItemSchema,
  quarterListSchema,
  refineQuarters,
  schoolDateSchema,
} from './academic-year.js';
import { calendarLessonsSchema } from './calendar.js';
import { templateDaysBodySchema } from './template-changes.js';

/**
 * A save of a year's quarters with what it does to the published timetable
 * (task 5.6b-5a; `edge/time-dates-calendar`, "Quarter dates are edited after
 * lessons exist", "The academic year is extended or shortened").
 */

/**
 * The four quarters with the choices for the dated lessons the save writes
 * again (decision 1 of the plan): the calendar's choices without
 * `groupBlocks`, as a template change takes them; a quarter change leaves no
 * single grade off.
 */
export const quartersSaveSchema = z
  .object({ quarters: quarterListSchema, days: templateDaysBodySchema.optional() })
  .superRefine(refineQuarters);

export type QuartersSave = z.infer<typeof quartersSaveSchema>;

/** The most items one list of a refusal or a preview names; the count of the rest follows. */
export const QUARTER_ITEMS_LISTED = 50;

/** A list of at most `QUARTER_ITEMS_LISTED` items and the count of the rest. */
const itemsOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), more: z.int().min(0) });

/**
 * What a save of the quarters does to the published timetable, and what
 * refuses it, as lines (decision 10): the lessons of the dates that leave or
 * join the quarters, written again (`lessons`); the dates whose blocks move
 * to another quarter, with their count; the three refusals.
 */
export const quartersPreviewSchema = z.object({
  lessons: calendarLessonsSchema,
  movedBlocks: z.array(z.object({ date: schoolDateSchema, blocks: z.int().min(1) })),
  pastLessons: itemsOf(quarterItemSchema),
  exams: itemsOf(quarterItemSchema),
  splitMoves: itemsOf(quarterItemSchema),
});

export type QuartersPreview = z.infer<typeof quartersPreviewSchema>;
