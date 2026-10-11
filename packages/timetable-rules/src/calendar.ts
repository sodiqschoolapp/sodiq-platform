/**
 * What a grade has on a date: no lessons, or one day template
 * (docs/spec/03-school-setup.md, Academic calendar: "Each date resolves to 'no
 * lessons' or to one day template"; task 1.4).
 *
 * Dates are school dates, `YYYY-MM-DD`, in branch time. An entry of the
 * calendar covers its first and its last date and every date between.
 * Vacations, the gaps between quarters, are not entries
 * (docs/spec/edge-cases/time-dates-calendar.md, "Vacations between quarters"):
 * publishing skips the dates outside the quarters (decision 6 of task 1.4).
 */
import { specialDateFor, templateFor, weekdayOf, type TemplateAssignment } from './templates.js';

export type CalendarEntryKind = 'day_off' | 'special_day';

/** An exam week: "regular lessons on this template" or "no regular lessons" (owner's answer 15). */
export type ExamWeek = 'regular_lessons' | 'no_regular_lessons';

/**
 * An active entry of the calendar (archived ones are left out by the caller).
 * A grade range is given for both ends or neither (the whole branch). A
 * special day names a template; a day off names none.
 */
export interface CalendarEntry {
  readonly id: string;
  readonly kind: CalendarEntryKind;
  readonly firstDate: string;
  readonly lastDate: string;
  readonly gradeFrom: number | null;
  readonly gradeTo: number | null;
  readonly dayTemplateId: string | null;
  /** ISO weekday, Monday 1 to Sunday 7, followed on the entry's dates that are not working weekdays. */
  readonly followsWeekday: number | null;
  readonly examWeek: ExamWeek | null;
}

export interface CalendarSettings {
  /** ISO weekdays of the branch on which school is held. */
  readonly workingWeekdays: readonly number[];
  /** Every setting of the templates, the rules take those in force on the date. */
  readonly assignments: readonly TemplateAssignment[];
  readonly entries: readonly CalendarEntry[];
}

export type DayResult =
  | {
      readonly lessons: false;
      /**
       * `day_off`: an entry; `not_working_day`: a weekday on which school is
       * not held; `no_template`: no template applies yet.
       */
      readonly reason: 'day_off' | 'not_working_day' | 'no_template';
      readonly entryId: string | null;
    }
  | {
      readonly lessons: true;
      readonly dayTemplateId: string;
      /** The weekday whose pattern the lessons come from. */
      readonly followsWeekday: number;
      readonly examWeek: ExamWeek | null;
      /** The special day that decided it, or `null` for the regular settings. */
      readonly entryId: string | null;
    };

/** The grades of a school, 1 to 11. */
const FIRST_GRADE = 1;
const LAST_GRADE = 11;

/** Whether the entry covers the date for the grade (a whole-branch entry covers every grade). */
export function entryCovers(entry: CalendarEntry, date: string, grade: number): boolean {
  return (
    entry.firstDate <= date &&
    date <= entry.lastDate &&
    (entry.gradeFrom === null ||
      entry.gradeTo === null ||
      (entry.gradeFrom <= grade && grade <= entry.gradeTo))
  );
}

/**
 * What a class of this grade has on this date. A day off that covers the
 * grade wins (owner's answer 17: "a day off beats a special day"); then a
 * special day, for the grade's range before the whole branch (`03`'s order,
 * through `specialDateFor`, as `templateFor` reads it); then a weekday that is not a working weekday has no
 * lessons; then the template set for the date.
 *
 * A special day's lessons follow the date's own weekday on a working weekday
 * and the entry's followed weekday on any other (answer 15: "on a non-working
 * weekday, the weekday it follows"; the review of the plan, correction 1).
 */
export function dayOn(grade: number, date: string, settings: CalendarSettings): DayResult {
  const covering = settings.entries.filter((entry) => entryCovers(entry, date, grade));
  const dayOff = covering.find((entry) => entry.kind === 'day_off');
  if (dayOff !== undefined) {
    return { lessons: false, reason: 'day_off', entryId: dayOff.id };
  }

  const weekday = weekdayOf(date);
  const working = settings.workingWeekdays.includes(weekday);
  // The special days of the date as special dates of templateFor, whose
  // order (grade range, then branch) decides which one applies.
  const chosen = specialDateFor(
    grade,
    date,
    covering.flatMap((entry) =>
      entry.kind === 'special_day' && entry.dayTemplateId !== null
        ? [
            {
              entryId: entry.id,
              date,
              gradeFrom: entry.gradeFrom,
              gradeTo: entry.gradeTo,
              dayTemplateId: entry.dayTemplateId,
            },
          ]
        : [],
    ),
  );
  const special = covering.find((entry) => entry.id === chosen?.entryId);
  if (special !== undefined && special.dayTemplateId !== null) {
    return {
      lessons: true,
      dayTemplateId: special.dayTemplateId,
      followsWeekday: working ? weekday : (special.followsWeekday ?? weekday),
      examWeek: special.examWeek,
      entryId: special.id,
    };
  }

  if (!working) {
    return { lessons: false, reason: 'not_working_day', entryId: null };
  }
  const dayTemplateId = templateFor(grade, date, { assignments: settings.assignments });
  if (dayTemplateId === null) {
    return { lessons: false, reason: 'no_template', entryId: null };
  }
  return { lessons: true, dayTemplateId, followsWeekday: weekday, examWeek: null, entryId: null };
}

/**
 * Whether the date is a school day: some grade has lessons on it, or would
 * have once a template is set (`edge/academic-year`, "Go-live can be on any
 * school day"; decision 7 of task 1.4). The calendar decides a school day, not
 * the templates: the go-live date may be set before the first template.
 */
export function isSchoolDay(date: string, settings: CalendarSettings): boolean {
  for (let grade = FIRST_GRADE; grade <= LAST_GRADE; grade += 1) {
    const day = dayOn(grade, date, settings);
    if (day.lessons || day.reason === 'no_template') {
      return true;
    }
  }
  return false;
}
