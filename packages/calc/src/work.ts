/**
 * The percent of a classwork or homework (docs/spec/07-journal.md, The total, and
 * Calculation rules 2): the number typed ÷ the total of that work × 100, kept
 * exact. "Only the percent goes into averages, results, rating and reports."
 *
 * The module takes any total of 1 or more with at most two digits after the
 * point (the owner's spec change of 25 November 2026, decimal totals); the
 * journal's upper limit of 1000 (docs/spec/edge-cases/journal.md, Entering) is
 * an input rule of the journal's schema (task 4.1, decision 10, correction 1 of
 * the plan review).
 */
import { Fraction } from './fraction.js';
import { CalcInputError } from './input.js';

/** A plain decimal as `String` writes it: a sign, digits, and digits after a point. */
const DECIMAL_TEXT = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * A score or a total of a work as an exact fraction (docs/spec/07-journal.md, The total: "up to
 * two digits after the decimal point … enters every calculation as an exact fraction";
 * edge/developer-rules, Calculation: "8.25 is 825/100"). The value is read from its shortest
 * decimal text (`String`), never by arithmetic on the JS number: 7.55 is 755/100 (task 11.25b,
 * decision 2, Look first). More than two digits after the point is refused, never rounded
 * (`more_than_two_decimals`); NaN, Infinity, an exponent form and a value whose hundredths are not
 * a safe whole number are refused as `not_whole_number`, as version 8 refused them. A negative
 * value is read, so that the caller keeps its own range codes.
 */
export function workAmount(value: number, name: string): Fraction {
  const parts = DECIMAL_TEXT.exec(String(value));
  if (parts === null) {
    throw new CalcInputError(
      'not_whole_number',
      `${name} must be a number with at most two decimals, got ${String(value)}.`,
    );
  }
  const [, sign = '', whole = '', decimals = ''] = parts;
  if (decimals.length > 2) {
    throw new CalcInputError(
      'more_than_two_decimals',
      `${name} has more than two digits after the point: ${String(value)}.`,
    );
  }
  const hundredths = BigInt(`${whole}${decimals.padEnd(2, '0')}`);
  if (hundredths > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CalcInputError(
      'not_whole_number',
      `${name} is too large to read exactly: ${String(value)}.`,
    );
  }
  return Fraction.of(sign === '-' ? -hundredths : hundredths, 100n);
}

/** A work with its total set; `score` is `null` while empty or "not graded". */
export interface Work {
  readonly total: number;
  readonly score: number | null;
}

/** The exact percent of `score` out of `total`. */
export function workPercent(score: number, total: number): Fraction {
  const exactTotal = workAmount(total, 'total');
  if (exactTotal.compare(Fraction.whole(1n)) < 0) {
    throw new CalcInputError('total_below_one', `A total is 1 or more, got ${String(total)}.`);
  }
  const typed = workAmount(score, 'score');
  if (typed.compare(Fraction.whole(0n)) < 0) {
    throw new CalcInputError('score_below_zero', `A number is 0 or more, got ${String(score)}.`);
  }
  if (typed.compare(exactTotal) > 0) {
    throw new CalcInputError(
      'score_above_total',
      `${String(score)} is above the total ${String(total)}.`,
    );
  }
  return typed.mul(Fraction.whole(100n)).div(exactTotal);
}

/** The whole percent shown next to the number: "13 out of 30 shows 43%". */
export function shownPercent(score: number, total: number): bigint {
  return workPercent(score, total).roundHalfUp();
}
