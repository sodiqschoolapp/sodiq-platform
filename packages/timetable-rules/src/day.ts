/**
 * The times of a school day (docs/spec/03-school-setup.md, Slot types and day
 * templates; task 1.5): "A day template is a start time and an ordered list of
 * slots … every start and end time is calculated from the order and the
 * lengths. Times are never typed by hand, so a lesson can only fill a whole
 * lesson slot."
 *
 * Times are whole minutes after midnight of the school date, in branch time.
 * Ranges are half-open (docs/spec/edge-cases/developer-rules.md, Lesson
 * times): a slot that ends at 09:45 does not overlap one that starts at 09:45.
 */

/** A lesson slot holds one lesson; a break (a break, a long break, lunch) holds none. */
export type SlotKind = 'lesson' | 'break';

/** The minutes of a whole day: the end of a day may be 24:00 at the latest. */
export const MINUTES_PER_DAY = 24 * 60;

/** One slot of a template, as its slot type gives it on the date. */
export interface DaySlotInput {
  readonly kind: SlotKind;
  readonly lengthMinutes: number;
}

/** One slot of a day with its calculated times. */
export interface DaySlot {
  /** 1 for the first slot of the day, breaks included. */
  readonly position: number;
  readonly kind: SlotKind;
  readonly start: number;
  readonly end: number;
  /**
   * The order of a lesson slot among the lesson slots of the day (1, 2, …);
   * `null` for a break. Lessons are matched by this order
   * (docs/spec/edge-cases/time-dates-calendar.md, the shortened day).
   */
  readonly lessonNumber: number | null;
}

export interface Day {
  readonly start: number;
  readonly slots: readonly DaySlot[];
  /** The end of the last slot; the start when the day has none. */
  readonly end: number;
}

/** The slots of a day with their times, from the start time, the order and the lengths. */
export function dayTimes(startMinutes: number, slots: readonly DaySlotInput[]): Day {
  let time = startMinutes;
  let lessons = 0;
  const timed = slots.map((slot, index): DaySlot => {
    const start = time;
    time += slot.lengthMinutes;
    if (slot.kind === 'lesson') {
      lessons += 1;
    }
    return {
      position: index + 1,
      kind: slot.kind,
      start,
      end: time,
      lessonNumber: slot.kind === 'lesson' ? lessons : null,
    };
  });
  return { start: startMinutes, slots: timed, end: time };
}

/** Whether the day runs past midnight: a lesson date is one school date. */
export function dayEndsAfterMidnight(day: Day): boolean {
  return day.end > MINUTES_PER_DAY;
}

/**
 * Why a lesson cannot take the given lesson number on this day, or `null`. A
 * break has no lesson number, so a lesson named by its number can never sit in
 * a break (docs/spec/06-timetable.md, Model, Slot).
 */
export function lessonSlotProblem(day: Day, lessonNumber: number): 'no_such_lesson_slot' | null {
  return day.slots.some((slot) => slot.lessonNumber === lessonNumber)
    ? null
    : 'no_such_lesson_slot';
}

/**
 * Why a lesson cannot have these times on this day, or `null`: "A lesson fills
 * exactly one lesson slot of the day template. It cannot be placed in a break
 * or lunch slot, across two slots, or at a time typed by hand"
 * (docs/spec/06-timetable.md, Rules).
 */
export function lessonTimeProblem(
  day: Day,
  start: number,
  end: number,
): 'break_slot' | 'not_a_slot' | null {
  const slot = day.slots.find((one) => one.start === start && one.end === end);
  if (slot === undefined) {
    return 'not_a_slot';
  }
  return slot.kind === 'lesson' ? null : 'break_slot';
}
