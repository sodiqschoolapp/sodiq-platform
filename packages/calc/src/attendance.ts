/**
 * The attendance value of a lesson (docs/spec/07-journal.md, Entering data and
 * Calculation rules 1): present 100, late and skipped the values of the lesson's
 * quarter (`quarters.late_value`, `quarters.skipped_value`, 50 and 0 by default,
 * whole numbers 0 to 100: task 1.6, answer 20), absent 0. Marks 4 and 5 are set
 * by the system from an exemption and leave the lesson out of every average of
 * the student.
 */
import { Fraction } from './fraction.js';
import { CalcInputError, wholeNumberIn } from './input.js';

/** 0 absent, 1 present, 2 late, 3 at school but not at the lesson, 4 temporarily exempt, 5 fully exempt. */
export type AttendanceMark = 0 | 1 | 2 | 3 | 4 | 5;

/** The quarter's values of late and skipped. */
export interface AttendanceValues {
  readonly lateValue: number;
  readonly skippedValue: number;
}

/** The quarter's values as `bigint`s; refused unless whole numbers from 0 to 100. */
export function checkedAttendanceValues(values: AttendanceValues): readonly [bigint, bigint] {
  return [
    wholeNumberIn(values.lateValue, 'lateValue', 0n, 100n),
    wholeNumberIn(values.skippedValue, 'skippedValue', 0n, 100n),
  ];
}

export function attendanceValue(
  mark: AttendanceMark,
  values: AttendanceValues,
): Fraction | 'exempt' {
  const [late, skipped] = checkedAttendanceValues(values);
  switch (mark) {
    case 0:
      return Fraction.whole(0n);
    case 1:
      return Fraction.whole(100n);
    case 2:
      return Fraction.whole(late);
    case 3:
      return Fraction.whole(skipped);
    case 4:
    case 5:
      return 'exempt';
    default:
      throw new CalcInputError('unknown_mark', `Unknown attendance mark ${String(mark)}.`);
  }
}
