import { describe, expect, it } from 'vitest';
import {
  dayEndsAfterMidnight,
  dayTimes,
  lessonSlotProblem,
  lessonTimeProblem,
  type DaySlotInput,
} from './day.js';

const lesson45: DaySlotInput = { kind: 'lesson', lengthMinutes: 45 };
const break15: DaySlotInput = { kind: 'break', lengthMinutes: 15 };
const lunch40: DaySlotInput = { kind: 'break', lengthMinutes: 40 };

/** "08:30" as minutes after midnight. */
const at = (hours: number, minutes: number): number => hours * 60 + minutes;

// docs/spec/03-school-setup.md, Slot types and day templates: "every start and
// end time is calculated from the order and the lengths. Times are never typed
// by hand, so a lesson can only fill a whole lesson slot."
describe('dayTimes', () => {
  it('calculates every start and end from the start time, the order and the lengths', () => {
    const day = dayTimes(at(8, 30), [lesson45, break15, lesson45, lunch40, lesson45]);
    expect(day.slots.map((slot) => [slot.start, slot.end])).toEqual([
      [at(8, 30), at(9, 15)],
      [at(9, 15), at(9, 30)],
      [at(9, 30), at(10, 15)],
      [at(10, 15), at(10, 55)],
      [at(10, 55), at(11, 40)],
    ]);
    expect(day.end).toBe(at(11, 40));
  });

  it('numbers the lesson slots in their order in the day and gives breaks no number', () => {
    const day = dayTimes(at(8, 0), [lesson45, break15, lesson45, lunch40, lesson45]);
    expect(day.slots.map((slot) => slot.lessonNumber)).toEqual([1, null, 2, null, 3]);
    expect(day.slots.map((slot) => slot.position)).toEqual([1, 2, 3, 4, 5]);
  });

  it('recalculates the times when the slots are reordered', () => {
    const before = dayTimes(at(8, 0), [lesson45, lunch40, lesson45]);
    const after = dayTimes(at(8, 0), [lesson45, lesson45, lunch40]);
    expect(before.slots[2]).toMatchObject({ kind: 'lesson', start: at(9, 25), end: at(10, 10) });
    expect(after.slots[1]).toMatchObject({ kind: 'lesson', start: at(8, 45), end: at(9, 30) });
    expect(after.slots[2]).toMatchObject({ kind: 'break', start: at(9, 30), end: at(10, 10) });
    expect(before.end).toBe(after.end);
  });

  it('gives a day with no slot its start as its end', () => {
    expect(dayTimes(at(8, 0), [])).toEqual({ start: at(8, 0), slots: [], end: at(8, 0) });
  });
});

// A lesson date is one school date (docs/spec/edge-cases/developer-rules.md,
// Lesson times): the day ends by midnight. Ranges are half-open, so a day that
// ends exactly at 24:00 is allowed.
describe('dayEndsAfterMidnight', () => {
  it('allows a day that ends at 24:00 and refuses one that ends a minute later', () => {
    expect(dayEndsAfterMidnight(dayTimes(at(23, 15), [lesson45]))).toBe(false);
    expect(dayEndsAfterMidnight(dayTimes(at(23, 16), [lesson45]))).toBe(true);
  });

  it('refuses twenty slots of 180 minutes', () => {
    const long = Array.from(
      { length: 20 },
      () => ({ kind: 'lesson', lengthMinutes: 180 }) as const,
    );
    expect(dayEndsAfterMidnight(dayTimes(0, long))).toBe(true);
  });
});

// docs/spec/06-timetable.md, Model, Slot: "A lesson always fills exactly one
// lesson slot. Break and lunch slots cannot hold lessons, and no lesson can
// have a time typed by hand."
describe('lessonSlotProblem', () => {
  const day = dayTimes(at(8, 0), [lesson45, break15, lesson45, lunch40, lesson45]);

  it('places a lesson on a lesson number the day has', () => {
    expect(lessonSlotProblem(day, 1)).toBeNull();
    expect(lessonSlotProblem(day, 3)).toBeNull();
  });

  it('refuses a lesson number the day does not have', () => {
    // edge/time-dates-calendar, "A shortened day has 5 lesson slots and a class has 7 lessons".
    expect(lessonSlotProblem(day, 4)).toBe('no_such_lesson_slot');
    expect(lessonSlotProblem(day, 0)).toBe('no_such_lesson_slot');
    expect(lessonSlotProblem(day, 1.5)).toBe('no_such_lesson_slot');
  });
});

describe('lessonTimeProblem', () => {
  const day = dayTimes(at(8, 0), [lesson45, break15, lesson45, lunch40, lesson45]);

  it('accepts exactly the times of a lesson slot', () => {
    expect(lessonTimeProblem(day, at(8, 0), at(8, 45))).toBeNull();
    expect(lessonTimeProblem(day, at(9, 0), at(9, 45))).toBeNull();
  });

  it('refuses the times of a break or a lunch slot', () => {
    expect(lessonTimeProblem(day, at(8, 45), at(9, 0))).toBe('break_slot');
    expect(lessonTimeProblem(day, at(9, 45), at(10, 25))).toBe('break_slot');
  });

  it('refuses a lesson across two slots or at a typed time', () => {
    expect(lessonTimeProblem(day, at(8, 0), at(9, 45))).toBe('not_a_slot');
    expect(lessonTimeProblem(day, at(8, 10), at(8, 55))).toBe('not_a_slot');
    expect(lessonTimeProblem(day, at(14, 0), at(14, 45))).toBe('not_a_slot');
  });
});
