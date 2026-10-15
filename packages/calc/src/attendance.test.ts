import { describe, expect, it } from 'vitest';
import { attendanceValue, type AttendanceMark } from './attendance.js';
import { Fraction } from './fraction.js';
import { CalcInputError } from './input.js';

const DEFAULTS = { lateValue: 50, skippedValue: 0 };

function valueOf(mark: AttendanceMark, values = DEFAULTS): bigint | 'exempt' {
  const value = attendanceValue(mark, values);
  if (value === 'exempt') return value;
  expect(value.den).toBe(1n);
  return value.num;
}

// docs/spec/07-journal.md, Entering data and Calculation rules 1.
describe('attendanceValue', () => {
  it('gives present 100, late 50, skipped 0 and absent 0 by default', () => {
    expect(valueOf(1)).toBe(100n);
    expect(valueOf(2)).toBe(50n);
    expect(valueOf(3)).toBe(0n);
    expect(valueOf(0)).toBe(0n);
  });

  it('leaves the exempt marks out', () => {
    expect(valueOf(4)).toBe('exempt');
    expect(valueOf(5)).toBe('exempt');
  });

  // docs/spec/edge-cases/calculation.md, "The value of late is changed from 50 to 75".
  it("takes the quarter's late and skipped values", () => {
    expect(valueOf(2, { lateValue: 75, skippedValue: 0 })).toBe(75n);
    expect(valueOf(3, { lateValue: 50, skippedValue: 20 })).toBe(20n);
    expect(valueOf(1, { lateValue: 75, skippedValue: 20 })).toBe(100n);
    expect(attendanceValue(0, { lateValue: 75, skippedValue: 20 })).toEqual(Fraction.whole(0n));
  });

  it('refuses values outside 0 to 100 or not whole, and an unknown mark', () => {
    const codeOf = (run: () => unknown): string | undefined => {
      try {
        run();
      } catch (error) {
        if (error instanceof CalcInputError) return error.code;
        throw error;
      }
      return undefined;
    };
    expect(codeOf(() => attendanceValue(2, { lateValue: 101, skippedValue: 0 }))).toBe(
      'out_of_range',
    );
    expect(codeOf(() => attendanceValue(2, { lateValue: -1, skippedValue: 0 }))).toBe(
      'out_of_range',
    );
    expect(codeOf(() => attendanceValue(2, { lateValue: 50.5, skippedValue: 0 }))).toBe(
      'not_whole_number',
    );
    expect(codeOf(() => attendanceValue(3, { lateValue: 50, skippedValue: 100.5 }))).toBe(
      'not_whole_number',
    );
    expect(codeOf(() => attendanceValue(6 as AttendanceMark, DEFAULTS))).toBe('unknown_mark');
    expect(codeOf(() => attendanceValue(1.5 as AttendanceMark, DEFAULTS))).toBe('unknown_mark');
  });
});
