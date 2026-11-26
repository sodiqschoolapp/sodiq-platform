import { z } from 'zod';

/**
 * A score or a total of a classwork or homework (task 11.25b): the rule of the value, imported by
 * every schema that carries one.
 */

/** `edge/journal`: "A total is from 1 to 1000" (`journal_works_total_check`, 0108; `work_amount`, 0188). */
export const WORK_TOTAL_MIN = 1;
export const WORK_TOTAL_MAX = 1000;

/**
 * A score or a total as `String` writes it: digits, and at most two digits after a point
 * (`07`, The total; the owner's spec changes of 25 November 2026, decimal scores and decimal
 * totals). Anchored, so an exponent form ("1e-7") never matches; the same rule as `workAmount`
 * of `packages/calc` and the domain `work_amount` (0188).
 */
const WORK_AMOUNT_TEXT = /^\d+(\.\d{1,2})?$/;

/** A score or a total the journal keeps: from 0 to 1000, with at most two digits after the point. */
export function isWorkAmount(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= WORK_TOTAL_MAX &&
    WORK_AMOUNT_TEXT.test(String(value))
  );
}


/** A score or a total as stored (0 to 1000, at most two decimals). */
export const workAmountSchema = z
  .number()
  .min(0)
  .max(WORK_TOTAL_MAX)
  .multipleOf(0.01)
  .refine(isWorkAmount, { message: 'At most two digits after the point.' });

/** A work's total: from 1 to 1000, with at most two digits after the point. */
export const workTotalAmountSchema = z
  .number()
  .min(WORK_TOTAL_MIN)
  .max(WORK_TOTAL_MAX)
  .multipleOf(0.01)
  .refine(isWorkAmount, { message: 'At most two digits after the point.' });
