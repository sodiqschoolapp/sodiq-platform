/**
 * A group of two grades (docs/spec/edge-cases/timetable.md, Structure:
 * "Its lessons may be placed only in a lesson slot that has the same start and
 * end time in the day templates of both grades on that weekday"; 06, Rules,
 * Blocked; task 3.2a, decision 9 of pull request #91).
 *
 * Slots are compared by their clock times, never by their numbers (`edge`:
 * "Every clash check uses real clock time, never slot numbers"). The load step
 * (task 3.4) refuses a group with no shared slot on any school weekday; the
 * group's own save only shows them.
 */
import type { Day } from './day.js';
import { firstOn, templateFor, type TemplateSettings } from './templates.js';

/** A lesson slot both days have at the same times, with its lesson number in each. */
export interface SharedSlot {
  readonly start: number;
  readonly end: number;
  readonly lessonA: number;
  readonly lessonB: number;
}

/** The lesson slots of `a` with the same start and end as a lesson slot of `b`, in the order of the day. */
export function sharedLessonSlots(a: Day, b: Day): SharedSlot[] {
  const shared: SharedSlot[] = [];
  for (const slot of a.slots) {
    if (slot.lessonNumber === null) continue;
    const twin = b.slots.find(
      (other) =>
        other.lessonNumber !== null && other.start === slot.start && other.end === slot.end,
    );
    if (twin?.lessonNumber != null) {
      shared.push({
        start: slot.start,
        end: slot.end,
        lessonA: slot.lessonNumber,
        lessonB: twin.lessonNumber,
      });
    }
  }
  return shared;
}

/** One weekday of the week from a date: its first date and the slots both grades share on it. */
export interface TwoGradeDay {
  readonly weekday: number;
  readonly date: string;
  readonly slots: readonly SharedSlot[];
}

/**
 * For each working weekday, from `from` on: the first date of that weekday and
 * the lesson slots the two grades' templates in force on it share (the weekly
 * pattern: `templateFor` with no special dates). `dayOf` gives the times of a
 * template on a date, or `null` when it has none. A weekday where a grade has
 * no template shares nothing.
 */
export function twoGradeSlots(
  gradeA: number,
  gradeB: number,
  from: string,
  workingWeekdays: readonly number[],
  settings: TemplateSettings,
  dayOf: (templateId: string, date: string) => Day | null,
): TwoGradeDay[] {
  const weekly: TemplateSettings = { assignments: settings.assignments };
  return [...workingWeekdays]
    .sort((x, y) => x - y)
    .map((weekday) => {
      const date = firstOn(from, weekday);
      const idA = templateFor(gradeA, date, weekly);
      const idB = templateFor(gradeB, date, weekly);
      const dayA = idA === null ? null : dayOf(idA, date);
      const dayB = idB === null ? null : dayOf(idB, date);
      return {
        weekday,
        date,
        slots: dayA === null || dayB === null ? [] : sharedLessonSlots(dayA, dayB),
      };
    });
}
