/**
 * Which day template a class has on a date (docs/spec/03-school-setup.md,
 * Slot types and day templates; task 1.5).
 *
 * Every setting is a dated row: in force from `validFrom` up to, not
 * including, `validUntil` (`null`: open). A row whose `validUntil` equals its
 * `validFrom` was withdrawn before it took effect and is never in force.
 * Dates are school dates, `YYYY-MM-DD`, in branch time.
 */

/** A row in force over `[validFrom, validUntil)`. */
export interface DatedRow {
  readonly validFrom: string;
  readonly validUntil: string | null;
}

/** Whether the row is in force on the date (half-open, docs/spec/edge-cases/developer-rules.md). */
export function isInForceOn(row: DatedRow, date: string): boolean {
  return row.validFrom <= date && (row.validUntil === null || date < row.validUntil);
}

/** The rows in force on the date, in their order. */
export function inForceOn<Row extends DatedRow>(rows: readonly Row[], date: string): Row[] {
  return rows.filter((row) => isInForceOn(row, date));
}

/** The four levels a template is set at in task 1.5; special dates come with the calendar (1.4). */
export type TemplateLevel = 'default' | 'grades' | 'weekday' | 'weekday_grades';

/**
 * A template set at one level from a date. `weekday` (ISO, Monday 1 to Sunday
 * 7) is given for the two weekday levels only, the grade range for the two
 * grade levels only.
 */
export interface TemplateAssignment extends DatedRow {
  readonly level: TemplateLevel;
  readonly weekday: number | null;
  readonly gradeFrom: number | null;
  readonly gradeTo: number | null;
  readonly dayTemplateId: string;
}

/** A special date of the calendar that names a template, for the branch (no grades) or a range of grades. */
export interface SpecialDateTemplate {
  readonly date: string;
  readonly gradeFrom: number | null;
  readonly gradeTo: number | null;
  readonly dayTemplateId: string;
}

export interface TemplateSettings {
  readonly assignments: readonly TemplateAssignment[];
  readonly specialDates?: readonly SpecialDateTemplate[];
}

/** The ISO weekday of a school date: Monday 1 to Sunday 7. */
export function weekdayOf(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

const holds = (range: { gradeFrom: number | null; gradeTo: number | null }, grade: number) =>
  range.gradeFrom !== null &&
  range.gradeTo !== null &&
  range.gradeFrom <= grade &&
  grade <= range.gradeTo;

/**
 * The template of a class of this grade on this date, or `null` when nothing
 * applies. "For a class on a date, the first of these that applies wins: a
 * special date for its grade range, then a special date for the branch, then
 * weekday with grade range, then weekday, then grade range, then the default."
 * Grade ranges at one level never overlap (the database keeps them apart), so
 * each level gives at most one template.
 *
 * `weekday` is the weekday of the date unless given: the table of School
 * setup reads the settings in force on one date for every weekday (owner's
 * answer 13), and passes no special dates.
 */
export function templateFor(
  grade: number,
  date: string,
  settings: TemplateSettings,
  weekday: number = weekdayOf(date),
): string | null {
  const special = (settings.specialDates ?? []).filter((entry) => entry.date === date);
  const assignments = inForceOn(settings.assignments, date);
  const at = (level: TemplateLevel) => assignments.filter((row) => row.level === level);

  const found =
    special.find((entry) => holds(entry, grade)) ??
    special.find((entry) => entry.gradeFrom === null) ??
    at('weekday_grades').find((row) => row.weekday === weekday && holds(row, grade)) ??
    at('weekday').find((row) => row.weekday === weekday) ??
    at('grades').find((row) => holds(row, grade)) ??
    at('default')[0];
  return found?.dayTemplateId ?? null;
}
