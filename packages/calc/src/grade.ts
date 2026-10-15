/**
 * The grade bands and the grade of a result (docs/spec/07-journal.md, Calculation
 * rules 9 and 10; docs/spec/edge-cases/calculation.md, "Which value gives the
 * grade?"): the band of the result rounded to a whole number, halves up, once at
 * the end. The bands are fixed for the whole school and are not a setting
 * (edge/calculation, "The value of 'late' is changed"; task 4.2, decision 11).
 */
import { Fraction } from './fraction.js';
import { CalcInputError } from './input.js';

export type Grade = 2 | 3 | 4 | 5;

export interface GradeBand {
  readonly grade: Grade;
  /** The lowest rounded result of the band. */
  readonly from: number;
  /** The highest rounded result of the band. */
  readonly to: number;
}

/** 0–49 is 2, 50–66 is 3, 67–83 is 4, 84–100 is 5. */
export const GRADE_BANDS: readonly GradeBand[] = Object.freeze([
  Object.freeze({ grade: 2, from: 0, to: 49 }),
  Object.freeze({ grade: 3, from: 50, to: 66 }),
  Object.freeze({ grade: 4, from: 67, to: 83 }),
  Object.freeze({ grade: 5, from: 84, to: 100 }),
] as const);

const ZERO = Fraction.whole(0n);
const HUNDRED = Fraction.whole(100n);

/** `value` itself; a result outside 0 to 100 is a fault in the caller and throws. */
export function checkedResult(value: Fraction, name: string): Fraction {
  if (value.compare(ZERO) < 0 || value.compare(HUNDRED) > 0) {
    throw new CalcInputError('out_of_range', `${name} must be from 0 to 100.`);
  }
  return value;
}

/** The grade of an exact result: the band of its rounded value. */
export function gradeOf(result: Fraction): Grade {
  const rounded = checkedResult(result, 'result').roundHalfUp();
  const band = GRADE_BANDS.find(({ from, to }) => rounded >= BigInt(from) && rounded <= BigInt(to));
  // Every whole number from 0 to 100 is in exactly one band (grade.test.ts).
  if (band === undefined) {
    throw new CalcInputError('out_of_range', `No grade band holds ${rounded}.`);
  }
  return band.grade;
}
