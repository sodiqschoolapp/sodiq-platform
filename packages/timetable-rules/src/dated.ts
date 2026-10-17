/**
 * The lessons of a weekly pattern on its dates (task 5.5a-2a): what a publish
 * checks date by date, and what 5.5b creates as dated lessons
 * (docs/spec/06-timetable.md, Model, Dated lesson: "generated from the
 * published pattern using the academic calendar and that day's template …
 * Days off produce no lessons").
 *
 * A date gives a block's lessons when the block's weekday is the weekday the
 * date follows (`dayOn`: the date's own on a working weekday, the followed one
 * on a worked Saturday) for its grades. A lesson is matched by its order in
 * the day, per grade (edge/time-dates-calendar, "A shortened day": "Lessons are
 * matched by their order in the day"): the lesson number of the slot with the
 * block's stored times in the grade's weekly template, then the slot of that
 * number in the grade's template on the date. What the day cannot hold is
 * listed as cancelled, never checked (edge/timetable, "The pattern is valid
 * but one date is not", first exception; decisions 4 and 7):
 * - `not_in_template`: no slot of that number on the date, or, for a group of
 *   two grades, slots whose times differ between its grades;
 * - `day_off`: a group of two grades on a date off for one of them, until the
 *   choice of the calendar entry is stored (5.6b);
 * - `exam_week`: an exam week with "no regular lessons", a bulk cancel with
 *   that reason (edge/time-dates-calendar, "The last week of a quarter").
 * A vacation date (in no quarter), a day off and a weekday off give nothing.
 */
import type { Day } from './day.js';
import type { Placement } from './placement.js';

/** One lesson of a pattern block: a load row's entry. */
export interface DatedEntry {
  /** The pattern entry. */
  readonly id: string;
  readonly loadRowId: string;
  readonly classId: string | null;
  readonly groupId: string | null;
  /** The class, or the classes the group draws from. */
  readonly classIds: readonly string[];
  readonly subjectId: string;
  /** The entry's teacher or vacancy. */
  readonly teacherId: string;
  readonly roomId: string | null;
  /** A Tutor row: its teacher on a date is the class's Tutor then (edge/timetable, Structure; decision 11). */
  readonly tutorRow: boolean;
}

/** A block of the pattern with its lessons. */
export interface DatedBlock {
  readonly id: string;
  readonly weekday: number;
  readonly start: number;
  readonly end: number;
  readonly doublePairId: string | null;
  /** The grades of the block's classes and groups. */
  readonly grades: readonly number[];
  readonly entries: readonly DatedEntry[];
}

/** What a grade has on a date, as the calendar gives it (`dayOn` with the template's times). */
export type DatedDay =
  | { readonly lessons: false }
  | {
      readonly lessons: true;
      readonly day: Day;
      /** The weekday whose pattern the date follows. */
      readonly followsWeekday: number;
      readonly noRegularLessons: boolean;
    };

export interface DatedPatternInput {
  readonly branchId: string;
  /** The first and the last date, both included. */
  readonly firstDate: string;
  readonly lastDate: string;
  readonly blocks: readonly DatedBlock[];
  /** The quarters of the year: a date in none is a vacation. */
  readonly quarters: readonly { readonly firstDate: string; readonly lastDate: string }[];
  /** The weekly day of a grade on a weekday, where the block's times were taken; `null` with none. */
  readonly weeklyDay: (grade: number, weekday: number) => Day | null;
  /** What a grade has on a date. */
  readonly dayOn: (grade: number, date: string) => DatedDay;
  /** The expected students of a class or group on a date. */
  readonly studentsOn: (unitId: string, date: string) => readonly string[];
  /** The teacher of a Tutor row's lesson on a date at its start minute; `null`: no Tutor. */
  readonly tutorOn: (classId: string, date: string, start: number) => string | null;
}

/** A lesson of a date: the engine's placement and where it comes from. */
export interface DatedLesson {
  readonly placement: Placement;
  readonly entryId: string;
  readonly date: string;
  /** A Tutor row whose Tutor on the date is not the entry's teacher (decision 11). */
  readonly tutorFollowed: boolean;
}

export type DatedCancelReason = 'not_in_template' | 'day_off' | 'exam_week';

/** The lessons of a block on a date created as cancelled. */
export interface DatedCancelled {
  readonly date: string;
  readonly reason: DatedCancelReason;
  readonly blockId: string;
  readonly entryIds: readonly string[];
}

/** A Tutor row's lesson with no Tutor on its date: "needs a teacher". */
export interface DatedNoTutor {
  readonly date: string;
  readonly entryId: string;
}

export interface DatedPattern {
  readonly lessons: readonly DatedLesson[];
  readonly cancelled: readonly DatedCancelled[];
  readonly noTutor: readonly DatedNoTutor[];
}

/** The date `days` after `date`. */
export function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** The id of a dated lesson, block or pair made from a pattern id. */
export const datedId = (patternId: string, date: string) => `${patternId}@${date}`;

/** The pattern id and the date of a dated id. */
export function patternIdOf(id: string): { id: string; date: string } | null {
  const at = id.lastIndexOf('@');
  return at < 0 ? null : { id: id.slice(0, at), date: id.slice(at + 1) };
}

type BlockOnDate =
  | { readonly kind: 'none' }
  | { readonly kind: 'cancelled'; readonly reason: DatedCancelReason }
  | { readonly kind: 'lessons'; readonly start: number; readonly end: number };

function blockOn(block: DatedBlock, date: string, input: DatedPatternInput): BlockOnDate {
  const days = block.grades.map((grade) => ({ grade, day: input.dayOn(grade, date) }));
  const holding = days.filter((one) => one.day.lessons && one.day.followsWeekday === block.weekday);
  if (holding.length === 0) {
    return { kind: 'none' };
  }
  if (holding.length < days.length) {
    // A group of two grades: one grade is off, or follows another weekday.
    return {
      kind: 'cancelled',
      reason: days.some((one) => !one.day.lessons) ? 'day_off' : 'not_in_template',
    };
  }
  if (holding.some((one) => one.day.lessons && one.day.noRegularLessons)) {
    return { kind: 'cancelled', reason: 'exam_week' };
  }
  const times = new Set<string>();
  for (const one of holding) {
    if (!one.day.lessons) continue;
    const weekly = input.weeklyDay(one.grade, block.weekday);
    const number = weekly?.slots.find(
      (slot) => slot.start === block.start && slot.end === block.end,
    )?.lessonNumber;
    const slot =
      number === undefined || number === null
        ? undefined
        : one.day.day.slots.find((candidate) => candidate.lessonNumber === number);
    if (slot === undefined) {
      return { kind: 'cancelled', reason: 'not_in_template' };
    }
    times.add(`${slot.start}-${slot.end}`);
  }
  const [only] = [...times];
  if (times.size !== 1 || only === undefined) {
    return { kind: 'cancelled', reason: 'not_in_template' };
  }
  const [start, end] = only.split('-').map(Number);
  return { kind: 'lessons', start: start ?? 0, end: end ?? 0 };
}

/** Every lesson of the pattern from the first to the last date (see the file's comment). */
export function datedPattern(input: DatedPatternInput): DatedPattern {
  const lessons: DatedLesson[] = [];
  const cancelled: DatedCancelled[] = [];
  const noTutor: DatedNoTutor[] = [];
  for (let date = input.firstDate; date <= input.lastDate; date = addDays(date, 1)) {
    if (!input.quarters.some((one) => one.firstDate <= date && date <= one.lastDate)) {
      continue;
    }
    for (const block of input.blocks) {
      const found = blockOn(block, date, input);
      if (found.kind === 'none') continue;
      if (found.kind === 'cancelled') {
        cancelled.push({
          date,
          reason: found.reason,
          blockId: block.id,
          entryIds: block.entries.map((entry) => entry.id),
        });
        continue;
      }
      for (const entry of block.entries) {
        let teacherId: string | null = entry.teacherId;
        if (entry.tutorRow && entry.classId !== null) {
          teacherId = input.tutorOn(entry.classId, date, found.start);
          if (teacherId === null) {
            noTutor.push({ date, entryId: entry.id });
          }
        }
        const unitId = entry.classId ?? entry.groupId ?? '';
        lessons.push({
          entryId: entry.id,
          date,
          tutorFollowed: teacherId !== null && teacherId !== entry.teacherId,
          placement: {
            id: datedId(entry.id, date),
            kind: 'lesson',
            branchId: input.branchId,
            day: date,
            start: found.start,
            end: found.end,
            blockId: datedId(block.id, date),
            doublePairId: block.doublePairId === null ? null : datedId(block.doublePairId, date),
            classId: entry.classId,
            groupId: entry.groupId,
            classIds: entry.classIds,
            studentIds: input.studentsOn(unitId, date),
            exemptStudentIds: [],
            subjectId: entry.subjectId,
            loadRowId: entry.loadRowId,
            teacherIds: teacherId === null ? [] : [teacherId],
            substitute: false,
            roomId: entry.roomId,
            examRooms: [],
            fixed: false,
          },
        });
      }
    }
  }
  return { lessons, cancelled, noTutor };
}
