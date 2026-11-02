import { z } from 'zod';

/**
 * The grades of the school, 0 to 11 (`05`, Class: "Grade (0–11)"; the spec
 * change of 1 November 2026, item 3; task 9.4d). Every grade that is typed,
 * checked or chosen reads these two, as the checks of the database do (0151).
 */
export const FIRST_GRADE = 0;
export const LAST_GRADE = 11;

/** Every grade, 0 to 11, in order. */
export const GRADES: readonly number[] = Array.from(
  { length: LAST_GRADE - FIRST_GRADE + 1 },
  (_, index) => FIRST_GRADE + index,
);

/** A grade of the school in a body or an answer. */
export const schoolGradeSchema = z.int().min(FIRST_GRADE).max(LAST_GRADE);

/** A grade of the school as the text of a query string, "0" to "11" (no sign, no leading zero). */
export const schoolGradeTextSchema = z.string().regex(/^(?:[0-9]|1[01])$/);

/**
 * A grade of the school in a query string, read as its number. Never `z.coerce`: it reads an
 * empty `?grade=` as 0, which is a grade since task 9.4d; an empty grade is refused.
 */
export const schoolGradeQuerySchema = z.union([
  schoolGradeSchema,
  schoolGradeTextSchema.transform(Number),
]);

/**
 * Grades as ranges (task 2.7b-1, finding 19; `04` Teacher list columns, read
 * as "grades, as ranges" by decision 2): "1–4, 7, 9–11" reads faster than
 * every grade one by one. Only digits, an en dash and commas, so the text is
 * the same in the three languages; a screen and its export use this one.
 */
export function gradeRanges(grades: Iterable<number>): string {
  const sorted = [...new Set(grades)].sort((a, b) => a - b);
  const runs: string[] = [];
  let index = 0;
  while (index < sorted.length) {
    const from = sorted[index] ?? 0;
    let to = from;
    while (sorted[index + 1] === to + 1) {
      index += 1;
      to += 1;
    }
    runs.push(from === to ? String(from) : `${String(from)}–${String(to)}`);
    index += 1;
  }
  return runs.join(', ');
}
