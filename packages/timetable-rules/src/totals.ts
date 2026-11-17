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
import { isSplit, splitKeyOf, type BlockGroup, type GroupSex } from './blocks.js';
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
  /** "For a group whether it is part of a mixed block" (05, Teaching load). */
  readonly mixedBlock: boolean;
}

/** A group as the totals read it: the classes it draws from and the sex it is for. */
export type TotalsGroup = Pick<BlockGroup, 'classIds' | 'sex'>;

/** The rows marked mixed of one split whose groups are all for one sex (task 5.16). */
interface OneSexSplit {
  readonly classIds: readonly string[];
  readonly rows: { readonly row: TotalsRow; readonly sex: GroupSex }[];
}

/**
 * The lessons per week of each class: a whole-class row counts its lessons;
 * the group rows of a subject that draw from the class count once, the most
 * lessons of them (the parts of one block run at the same time). A group of
 * two grades counts for each of its classes.
 *
 * Task 5.16: the rows marked mixed of one split (one class or a pair of
 * classes, `splitKeyOf`) whose groups are all for one sex pair a boys' lesson
 * with a girls' lesson of another subject in one slot (edge/timetable,
 * Structure: "A mixed block is allowed: boys have physical education while
 * girls have technology, and the reverse in another slot"; 06, Rules: "a
 * mixed block pairs parts of two subjects instead"). Every student of the
 * split has exactly one lesson in such a slot, so the split needs the larger
 * of the boys' and the girls' lessons (decision 2), each side summed by
 * subject, the most lessons of its rows of the subject (each student is in
 * one group of a subject, 05, Group). An unpaired extra half still counts
 * (decision 3). A split with a mixed row for everyone counts all its rows per
 * subject, as every other group row does (decision 4): without the students
 * the total cannot tell which halves are complementary, and counting more
 * only holds a named step. A class counts its own split and its pair's split
 * once each (decision 5). Code round 1: never fewer than the lessons one
 * teacher or vacancy has in the split, which cannot share a slot.
 */
export function classWeekLessons(
  rows: readonly TotalsRow[],
  groups: ReadonlyMap<string, TotalsGroup>,
): Map<string, number> {
  const splits = new Map<string, OneSexSplit>();
  const forEveryone = new Set<string>();
  for (const row of rows) {
    const group = row.groupId === null ? undefined : groups.get(row.groupId);
    if (!row.mixedBlock || group === undefined || !isSplit(group)) continue;
    const key = splitKeyOf(group);
    if (group.sex === null) {
      forEveryone.add(key);
      continue;
    }
    const split = splits.get(key) ?? { classIds: [...new Set(group.classIds)], rows: [] };
    split.rows.push({ row, sex: group.sex });
    splits.set(key, split);
  }
  for (const key of forEveryone) splits.delete(key);
  const sided = new Set([...splits.values()].flatMap((split) => split.rows.map((one) => one.row)));

  const totals = new Map<string, number>();
  const add = (classId: string, lessons: number) =>
    totals.set(classId, (totals.get(classId) ?? 0) + lessons);
  const grouped = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.classId !== null) {
      add(row.classId, row.lessonsPerWeek);
    } else if (row.groupId !== null && !sided.has(row)) {
      for (const classId of groups.get(row.groupId)?.classIds ?? []) {
        const subjects = grouped.get(classId) ?? new Map<string, number>();
        subjects.set(row.subjectId, Math.max(subjects.get(row.subjectId) ?? 0, row.lessonsPerWeek));
        grouped.set(classId, subjects);
      }
    }
  }
  for (const [classId, subjects] of grouped) {
    for (const lessons of subjects.values()) add(classId, lessons);
  }
  for (const split of splits.values()) {
    const side = (sex: GroupSex): number => {
      const subjects = new Map<string, number>();
      for (const { row } of split.rows.filter((one) => one.sex === sex)) {
        subjects.set(row.subjectId, Math.max(subjects.get(row.subjectId) ?? 0, row.lessonsPerWeek));
      }
      return [...subjects.values()].reduce((sum, lessons) => sum + lessons, 0);
    };
    // Code round 1: one teacher or vacancy may take both sides (3.4b, decision 12), and two of its
    // lessons never share a slot (teacher_double), so the split needs at least its lessons there.
    // With the sides this is the fewest slots a pairing of boys' and girls' lessons of different
    // teachers can take (Hall's condition on the teachers), so it never counts too few.
    const ofTeacher = new Map<string, number>();
    for (const { row } of split.rows) {
      ofTeacher.set(row.teacherId, (ofTeacher.get(row.teacherId) ?? 0) + row.lessonsPerWeek);
    }
    const lessons = Math.max(side('male'), side('female'), ...ofTeacher.values());
    for (const classId of split.classIds) add(classId, lessons);
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
