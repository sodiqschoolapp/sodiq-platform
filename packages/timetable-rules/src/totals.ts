/**
 * The weekly totals of a teaching load (docs/spec/06-timetable.md, Building a
 * timetable, steps 2 and 3; Teachers who work in several branches, Weekly
 * load; task 3.4b, pull request #100).
 *
 * "The weekly lessons of every class fit into the week's lesson slots", "No
 * teacher has more lessons than free slots", and the teacher's total across
 * branches "compared with the contract load". The totals are shown, never
 * refused (decision 5); the readiness that blocks generation is task 5.3's.
 * Every comparison of slots uses clock minutes, never slot numbers
 * (docs/spec/edge-cases/timetable.md, Structure). Ranges are half-open.
 */
import type { Day } from './day.js';
import { firstOn, templateFor, type TemplateSettings } from './templates.js';

/** One working weekday of a version's week: its first date from the start date and its day. */
export interface WeekDay {
  readonly weekday: number;
  readonly date: string;
  /** The times of the grade's template on that date; `null` when it has none. */
  readonly day: Day | null;
}

/** A span of clock minutes of a day, half-open. */
export interface Interval {
  readonly start: number;
  readonly end: number;
}

/**
 * Decision 6 with correction 2: for each working weekday, the template of the
 * grade in force on the first date of that weekday on or after `from` (the
 * weekly pattern: no special dates), as `twoGradeSlots` reads it.
 */
export function weekDaysOf(
  grade: number,
  from: string,
  workingWeekdays: readonly number[],
  settings: TemplateSettings,
  dayOf: (templateId: string, date: string) => Day | null,
): WeekDay[] {
  const weekly: TemplateSettings = { assignments: settings.assignments };
  return [...workingWeekdays]
    .sort((x, y) => x - y)
    .map((weekday) => {
      const date = firstOn(from, weekday);
      const id = templateFor(grade, date, weekly);
      return { weekday, date, day: id === null ? null : dayOf(id, date) };
    });
}

/** The lesson slots of a day as clock intervals, in the order of the day. */
export function lessonIntervals(day: Day): Interval[] {
  return day.slots
    .filter((slot) => slot.lessonNumber !== null)
    .map((slot) => ({ start: slot.start, end: slot.end }));
}

/** The lesson slots of a week: the sum over its days. */
export function weekLessonSlots(days: readonly WeekDay[]): number {
  return days.reduce(
    (sum, one) => sum + (one.day === null ? 0 : lessonIntervals(one.day).length),
    0,
  );
}

/**
 * Decision 7: the free slots of a teacher on one weekday, the most lesson
 * slots that do not overlap in clock time among `slots` (the lesson slots of
 * the templates of every grade the teacher teaches) that lie wholly inside one
 * of the teacher's `hours` that day. The greedy choice by earliest end gives
 * the largest set of intervals that do not overlap.
 */
export function freeSlots(slots: readonly Interval[], hours: readonly Interval[]): number {
  const inside = slots.filter((slot) =>
    hours.some((range) => range.start <= slot.start && slot.end <= range.end),
  );
  const ordered = [...inside].sort((a, b) => a.end - b.end || a.start - b.start);
  let count = 0;
  let free = Number.NEGATIVE_INFINITY;
  for (const slot of ordered) {
    if (slot.start >= free) {
      count += 1;
      free = slot.end;
    }
  }
  return count;
}

/** A row of a version as the totals read it. */
export interface TotalsRow {
  readonly classId: string | null;
  readonly groupId: string | null;
  readonly subjectId: string;
  readonly teacherId: string;
  readonly lessonsPerWeek: number;
}

/**
 * The lessons per week of each class: a whole-class row counts its lessons;
 * the group rows of a subject that draw from the class count once, the most
 * lessons of them (the parts of one block run at the same time). A group of
 * two grades counts for each of its classes.
 */
export function classWeekLessons(
  rows: readonly TotalsRow[],
  groupClasses: ReadonlyMap<string, readonly string[]>,
): Map<string, number> {
  const whole = new Map<string, number>();
  const grouped = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.classId !== null) {
      whole.set(row.classId, (whole.get(row.classId) ?? 0) + row.lessonsPerWeek);
    } else if (row.groupId !== null) {
      for (const classId of groupClasses.get(row.groupId) ?? []) {
        const subjects = grouped.get(classId) ?? new Map<string, number>();
        subjects.set(row.subjectId, Math.max(subjects.get(row.subjectId) ?? 0, row.lessonsPerWeek));
        grouped.set(classId, subjects);
      }
    }
  }
  const totals = new Map(whole);
  for (const [classId, subjects] of grouped) {
    let sum = totals.get(classId) ?? 0;
    for (const lessons of subjects.values()) {
      sum += lessons;
    }
    totals.set(classId, sum);
  }
  return totals;
}

/** The lessons per week of each teacher or vacancy: the sum of its rows. */
export function teacherWeekLessons(rows: readonly TotalsRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.teacherId, (totals.get(row.teacherId) ?? 0) + row.lessonsPerWeek);
  }
  return totals;
}
