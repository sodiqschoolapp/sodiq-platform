/**
 * The percent of a classwork or homework (docs/spec/07-journal.md, The total, and
 * Calculation rules 2): the number typed ÷ the total of that work × 100, kept
 * exact. "Only the percent goes into averages, results, rating and reports."
 *
 * The module takes any whole total of 1 or more; the journal's upper limit of
 * 1000 (docs/spec/edge-cases/journal.md, Entering) is an input rule of the
 * journal's schema (task 4.1, decision 10, correction 1 of the plan review).
 */
import { Fraction } from './fraction.js';
import { CalcInputError, wholeNumber } from './input.js';

/** The exact percent of `score` out of `total`. */
export function workPercent(score: number, total: number): Fraction {
  const whole = wholeNumber(total, 'total');
  if (whole < 1n) {
    throw new CalcInputError('total_below_one', `A total is 1 or more, got ${whole}.`);
  }
  const typed = wholeNumber(score, 'score');
  if (typed < 0n) {
    throw new CalcInputError('score_below_zero', `A number is 0 or more, got ${typed}.`);
  }
  if (typed > whole) {
    throw new CalcInputError('score_above_total', `${typed} is above the total ${whole}.`);
  }
  return Fraction.of(typed * 100n, whole);
}

/** The whole percent shown next to the number: "13 out of 30 shows 43%". */
export function shownPercent(score: number, total: number): bigint {
  return workPercent(score, total).roundHalfUp();
}
