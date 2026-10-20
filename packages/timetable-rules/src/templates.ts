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
  /** The calendar entry it comes from, when there is one (task 1.4). */
  readonly entryId?: string;
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

/** The first date on or after `from` that falls on the ISO weekday. */
export function firstOn(from: string, weekday: number): string {
  const ahead = (weekday - weekdayOf(from) + 7) % 7;
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + ahead);
  return date.toISOString().slice(0, 10);
}

const holds = (range: { gradeFrom: number | null; gradeTo: number | null }, grade: number) =>
  range.gradeFrom !== null &&
  range.gradeTo !== null &&
  range.gradeFrom <= grade &&
  grade <= range.gradeTo;

/**
 * The special date that applies to a class of this grade on this date: one
 * for its grade range before one for the branch (`03`: "a special date for
 * its grade range, then a special date for the branch"). The one place of
 * that order, used by `templateFor` and by the calendar's `dayOn`.
 */
export function specialDateFor<Special extends SpecialDateTemplate>(
  grade: number,
  date: string,
  specialDates: readonly Special[],
): Special | undefined {
  const special = specialDates.filter((entry) => entry.date === date);
  return (
    special.find((entry) => holds(entry, grade)) ??
    special.find((entry) => entry.gradeFrom === null)
  );
}

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
  const assignments = inForceOn(settings.assignments, date);
  const at = (level: TemplateLevel) => assignments.filter((row) => row.level === level);

  const found =
    specialDateFor(grade, date, settings.specialDates ?? []) ??
    at('weekday_grades').find((row) => row.weekday === weekday && holds(row, grade)) ??
    at('weekday').find((row) => row.weekday === weekday) ??
    at('grades').find((row) => holds(row, grade)) ??
    at('default')[0];
  return found?.dayTemplateId ?? null;
}

/** Why a change takes a lesson slot from the published timetable (task 5.6b-4a). */
export interface UsedSlotProblem {
  readonly lessonNumber: number;
  readonly problem: 'removed' | 'reordered';
}

/**
 * The lesson slots a change of a grade's day on a date takes from the
 * published timetable (edge/time-dates-calendar, "A slot type's length or a
 * day template is changed mid-year": "A lesson slot used by the published
 * timetable cannot be removed or reordered without a new version"; task
 * 5.6b-4a, decision 4).
 *
 * Lesson slots are matched by their number in the day (edge/time-dates-
 * calendar, "A shortened day": "Lessons are matched by their order in the
 * day"); a slot has no identity across template versions. `before` and
 * `after` are the slot types of the day's lesson slots in their order (number
 * 1 first), `used` the lesson numbers the published version's blocks take
 * that day. A used number the day before has and the day after has not is
 * `removed`. Within one template (`sameTemplate`: a new version of the
 * template the grade already has), one the day after holds with another slot
 * type is `reordered` (also a "Lesson 40" type put in place of a "Lesson 45"
 * slot: its length is changed on the slot type instead); a slot type tells
 * lesson slots apart only within one template, so a setting that gives the
 * grade another template is refused only for a used number it lacks.
 * Everything else (breaks added, moved or removed, the start, the lengths,
 * lesson slots after the last used number) takes the new times. A number the
 * day before already lacks (a shortened day) is no problem of the change.
 */
export function usedSlotProblems(
  before: readonly string[],
  after: readonly string[],
  used: readonly number[],
  options: { readonly sameTemplate: boolean } = { sameTemplate: true },
): UsedSlotProblem[] {
  return [...new Set(used)]
    .sort((a, b) => a - b)
    .flatMap((lessonNumber): UsedSlotProblem[] => {
      const was = before[lessonNumber - 1];
      if (was === undefined) return [];
      const now = after[lessonNumber - 1];
      if (now === undefined) return [{ lessonNumber, problem: 'removed' }];
      return now === was || !options.sameTemplate ? [] : [{ lessonNumber, problem: 'reordered' }];
    });
}
