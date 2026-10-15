/**
 * The boundary between typed numbers and exact arithmetic. Every number that
 * comes into the module is a whole number (docs/spec/07-journal.md, The total:
 * "The number typed is a whole number. Decimals are not accepted"; CLAUDE.md,
 * "Typed scores and totals are whole numbers") and becomes a `bigint` here, so no
 * arithmetic is ever done on a JS `number` (task 4.1, decision 8).
 *
 * The API validates its input with the schemas of `packages/shared` before it
 * calls the module, so a `CalcInputError` is a fault in the caller, not a
 * message for a person: it carries a code, never a text to translate.
 */
export type CalcInputErrorCode =
  | 'not_whole_number'
  | 'out_of_range'
  | 'zero_denominator'
  | 'negative_rounding'
  | 'total_below_one'
  | 'score_below_zero'
  | 'score_above_total'
  | 'unknown_mark'
  | 'weights_not_100'
  | 'number_on_exempt_lesson'
  | 'rating_exam_without_weight'
  | 'lessons_above_held'
  | 'not_a_date'
  | 'final_record_open_quarter'
  | 'final_record_undecided'
  | 'final_record_rating_missing'
  | 'final_record_not_leaving'
  | 'record_shape';

export class CalcInputError extends Error {
  readonly code: CalcInputErrorCode;

  constructor(code: CalcInputErrorCode, message: string) {
    super(message);
    this.name = 'CalcInputError';
    this.code = code;
  }
}

/** A safe whole JS number as a `bigint`; anything else (a decimal, NaN, Infinity, an unsafe size) throws. */
export function wholeNumber(value: number, name: string): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new CalcInputError(
      'not_whole_number',
      `${name} must be a whole number, got ${String(value)}.`,
    );
  }
  return BigInt(value);
}

/** A whole number from `min` to `max`, both included, as a `bigint`. */
export function wholeNumberIn(value: number, name: string, min: bigint, max: bigint): bigint {
  const whole = wholeNumber(value, name);
  if (whole < min || whole > max) {
    throw new CalcInputError(
      'out_of_range',
      `${name} must be from ${min} to ${max}, got ${whole}.`,
    );
  }
  return whole;
}
