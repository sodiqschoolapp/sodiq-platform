import { z } from 'zod';
import { staffStatusSchema } from './staff.js';
import { schoolDateSchema } from './academic-year.js';
import { studentStatusSchema } from './students.js';

/**
 * Ctrl+K over records (docs/spec/12-ux-standards.md, One pattern everywhere,
 * Search: "Ctrl+K opens a search across students, staff, classes, groups and
 * pages"; task 3.2d, pull request #94). Four read routes, one per kind, each
 * guarded as the record route of its kind; each answers at most
 * `SEARCH_LIMIT` records of the reader's scope, with `more` when a further one
 * matched (decision 6).
 */

/** The most records of one kind Ctrl+K lists (decision 6). */
export const SEARCH_LIMIT = 8;

/** The longest typed text a search route takes. */
export const SEARCH_QUERY_MAX_LENGTH = 100;

/** The typed text, trimmed; folded by the server itself (`searchWords`). */
export const searchQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(SEARCH_QUERY_MAX_LENGTH),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

/**
 * A student found: the UID always shown (`edge/journal`: "The UID is always
 * shown in pickers and search"), the class in force today, and the status
 * today as the student list shows it (before the start date the first row,
 * active; `null` only without a status row).
 */
export const studentFoundSchema = z.object({
  id: z.uuid(),
  uid: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  paternalName: z.string().nullable(),
  class: z.object({ grade: z.int(), name: z.string() }).nullable(),
  status: studentStatusSchema.nullable(),
  /** The start date: before it an active student reads "From <date>" (issue #105, H13). */
  startsOn: schoolDateSchema,
  /**
   * The relative whose main phone found the student (task 3.5b, H33 of issue
   * #105), for the readers of relatives; absent when found otherwise.
   */
  relative: z.string().optional(),
});

export type StudentFound = z.infer<typeof studentFoundSchema>;

/** A person of the staff found, with the status the staff list shows (`null`: not started). */
export const staffFoundSchema = z.object({
  id: z.uuid(),
  staffId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  status: staffStatusSchema.nullable(),
});

export type StaffFound = z.infer<typeof staffFoundSchema>;

/**
 * A relative found (task 3.5b, H33 of issue #105): linked to a student of
 * the branch, with the main phone (`null`: no phone of their own) and the
 * number of the branch's students linked.
 */
export const relativeFoundSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  phone: z.string().nullable(),
  students: z.int().min(1),
});

export type RelativeFound = z.infer<typeof relativeFoundSchema>;

/** A class found, of a year that is not closed. */
export const classFoundSchema = z.object({
  id: z.uuid(),
  grade: z.int(),
  name: z.string(),
  yearName: z.string(),
});

export type ClassFound = z.infer<typeof classFoundSchema>;

/** A group found, with its subject in the three languages, so the answer does not depend on the reader's. */
export const groupFoundSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  subject: z.object({ uz: z.string(), ru: z.string(), en: z.string() }),
  yearName: z.string(),
});

export type GroupFound = z.infer<typeof groupFoundSchema>;

const foundSchema = <Item extends z.ZodType>(item: Item) =>
  z.object({ items: z.array(item).max(SEARCH_LIMIT), more: z.boolean() });

/** With today in the branch's time zone, which the start dates are compared with (H13). */
export const studentSearchSchema = foundSchema(studentFoundSchema).extend({
  today: schoolDateSchema,
});
export type StudentSearch = z.infer<typeof studentSearchSchema>;

export const staffSearchSchema = foundSchema(staffFoundSchema);
export type StaffSearch = z.infer<typeof staffSearchSchema>;

export const relativeSearchSchema = foundSchema(relativeFoundSchema);
export type RelativeSearch = z.infer<typeof relativeSearchSchema>;

export const classSearchSchema = foundSchema(classFoundSchema);
export type ClassSearch = z.infer<typeof classSearchSchema>;

export const groupSearchSchema = foundSchema(groupFoundSchema);
export type GroupSearch = z.infer<typeof groupSearchSchema>;

/**
 * The first `SEARCH_LIMIT` of the rows found, already in order and in the
 * reader's scope, and whether a further one matched (the scope before the
 * limit: the rows outside it are dropped first).
 */
export function limited<Row>(rows: readonly Row[]): { items: Row[]; more: boolean } {
  return { items: rows.slice(0, SEARCH_LIMIT), more: rows.length > SEARCH_LIMIT };
}
