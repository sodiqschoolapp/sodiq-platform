import { describe, expect, it } from 'vitest';
import { absentNow, dailyAttendance, type AttendanceCell } from './daily-attendance.js';
import { Fraction } from './fraction.js';

const cell = (mark: AttendanceCell['mark'], exempt = false): AttendanceCell => ({ mark, exempt });

describe('dailyAttendance: edge/journal, "Daily attendance percent of a class"', () => {
  it('divides the cells marked present or late by all marked cells', () => {
    const figure = dailyAttendance([cell(1), cell(2), cell(0), cell(3)]);
    expect(figure).toMatchObject({ attended: 2, marked: 4, unmarked: 0, exempt: 0 });
    expect(figure.percent?.equals(Fraction.whole(50n))).toBe(true);
  });

  it('leaves unmarked cells out of both and counts them apart', () => {
    const figure = dailyAttendance([cell(1), cell(1), cell(0), cell(null), cell(null)]);
    expect(figure).toMatchObject({ attended: 2, marked: 3, unmarked: 2 });
    expect(figure.percent?.equals(Fraction.of(200n, 3n))).toBe(true);
  });

  it('takes exempt students out of the number expected (07, Effect on totals)', () => {
    const figure = dailyAttendance([cell(1), cell(0, true), cell(null, true), cell(0)]);
    expect(figure).toMatchObject({ attended: 1, marked: 2, unmarked: 0, exempt: 2 });
    expect(figure.percent?.equals(Fraction.whole(50n))).toBe(true);
  });

  it('is null with nothing marked', () => {
    expect(dailyAttendance([cell(null), cell(1, true)]).percent).toBeNull();
    expect(dailyAttendance([]).percent).toBeNull();
  });

  it('sums a week or a branch as one ratio of cells, not a mean of percents', () => {
    // Monday 1 of 1, Tuesday 1 of 3: the mean of percents would be 66.67, the ratio is 50.
    const figure = dailyAttendance([cell(1), cell(1), cell(0), cell(0)]);
    expect(figure.percent?.equals(Fraction.whole(50n))).toBe(true);
  });

  it('refuses a mark outside 0 to 3', () => {
    expect(() => dailyAttendance([{ mark: 4 as never, exempt: false }])).toThrow();
  });
});

describe("absentNow: edge/journal, \"'Absent now' on the Tutor's page\"", () => {
  it('is true when the latest marked lesson today is 0', () => {
    expect(absentNow({ lessons: [{ mark: 1 }, { mark: 0 }], exemptNow: false })).toBe(true);
  });

  it('reads the latest marked lesson: a later unmarked lesson changes nothing', () => {
    expect(absentNow({ lessons: [{ mark: 0 }, { mark: null }], exemptNow: false })).toBe(true);
  });

  it('is false when a later lesson is marked present, late or skipped', () => {
    expect(absentNow({ lessons: [{ mark: 0 }, { mark: 1 }], exemptNow: false })).toBe(false);
    expect(absentNow({ lessons: [{ mark: 0 }, { mark: 2 }], exemptNow: false })).toBe(false);
    expect(absentNow({ lessons: [{ mark: 0 }, { mark: 3 }], exemptNow: false })).toBe(false);
  });

  it('is false for a student exempt now', () => {
    expect(absentNow({ lessons: [{ mark: 0 }], exemptNow: true })).toBe(false);
  });

  it('is false with no marked lesson today', () => {
    expect(absentNow({ lessons: [{ mark: null }], exemptNow: false })).toBe(false);
    expect(absentNow({ lessons: [], exemptNow: false })).toBe(false);
  });
});
