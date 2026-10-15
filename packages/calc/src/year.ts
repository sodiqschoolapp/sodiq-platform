/**
 * The year result (docs/spec/07-journal.md, Calculation rules 11;
 * docs/spec/edge-cases/calculation.md, "The year result when quarters show 50,
 * 50, 49, 50"; task 4.2, decision 6): the mean of the exact quarter results that
 * are numbers, each quarter counted once, rounded once at the end, labelled
 * "based on n of 4 quarters". "Exempt", "Not assessed", "No result", and the
 * go-live states "not in the system" and "not official"
 * (docs/spec/edge-cases/academic-year.md) are left out. A year has four quarters
 * (docs/spec/03-school-setup.md, Quarters).
 *
 * When the year result is shown (docs/spec/08-results-rating-analytics.md: "when
 * the fourth quarter is closed") is the caller's.
 */
import { Fraction } from './fraction.js';
import { checkedResult, gradeOf, type Grade } from './grade.js';
import { CalcInputError } from './input.js';

/** The outcome of one quarter: its exact result, or a state that is not a number. */
export type QuarterOutcome =
  Fraction | 'exempt' | 'not_assessed' | 'no_result' | 'not_in_system' | 'not_official';

const NOT_A_NUMBER: ReadonlySet<string> = new Set([
  'exempt',
  'not_assessed',
  'no_result',
  'not_in_system',
  'not_official',
]);

export type YearResult =
  | {
      readonly kind: 'number';
      readonly value: Fraction;
      readonly shown: bigint;
      readonly grade: Grade;
      /** n of "based on n of 4 quarters". */
      readonly basedOn: number;
    }
  | { readonly kind: 'no_result' };

export function yearResult(quarters: readonly QuarterOutcome[]): YearResult {
  if (quarters.length !== 4) {
    throw new CalcInputError('out_of_range', `A year has 4 quarters, got ${quarters.length}.`);
  }
  const numbers = quarters.flatMap((quarter, index) => {
    if (quarter instanceof Fraction) return [checkedResult(quarter, `quarters[${index}]`)];
    if (NOT_A_NUMBER.has(quarter)) return [];
    throw new CalcInputError('out_of_range', `Unknown quarter outcome ${String(quarter)}.`);
  });
  const value = Fraction.meanOf(numbers);
  if (value === null) return { kind: 'no_result' };
  return {
    kind: 'number',
    value,
    shown: value.roundHalfUp(),
    grade: gradeOf(value),
    basedOn: numbers.length,
  };
}
