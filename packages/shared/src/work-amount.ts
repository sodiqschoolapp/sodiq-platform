import { z } from 'zod';

/**
 * A score or a total of a classwork or homework (task 11.25b). The journal's limits are
 * `WORK_TOTAL_MIN` and `WORK_TOTAL_MAX` of `journal-works.ts`; this file holds the rule of the
 * value itself, imported by every schema that carries one.
 */
export const WORK_AMOUNT_MAX = 1000;

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
    value <= WORK_AMOUNT_MAX &&
    WORK_AMOUNT_TEXT.test(String(value))
  );
}

/**
 * A score or a total as a person reads it: a point in every language, no trailing zeros (`07`,
 * The total: "shown with a point, without trailing zeros (7.50 shows 7.5)"). `String` writes
 * every value of `isWorkAmount` that way, never with an exponent.
 */
export function formatWorkAmount(value: number): string {
  return String(value);
}

/** A score or a total as stored (0 to 1000, at most two decimals). */
export const workAmountSchema = z
  .number()
  .min(0)
  .max(WORK_AMOUNT_MAX)
  .multipleOf(0.01)
  .refine(isWorkAmount, { message: 'At most two digits after the point.' });

/** A work's total: from 1 to 1000, with at most two digits after the point. */
export const workTotalAmountSchema = z
  .number()
  .min(1)
  .max(WORK_AMOUNT_MAX)
  .multipleOf(0.01)
  .refine(isWorkAmount, { message: 'At most two digits after the point.' });
