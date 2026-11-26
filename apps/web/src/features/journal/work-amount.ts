import type { TFunction } from 'i18next';

/**
 * A score or a total typed in the journal (task 11.25b; `07`, The total: "up to two digits after
 * the decimal point … The decimal separator is a point in every language; a comma is refused";
 * `edge/journal`, "The teacher types "1" then "2" for 12.": "Letters, a comma, numbers above the
 * total and more than two digits after the point are refused in the cell; "8." is read as 8").
 */

/** Why a typed number is refused in its cell. */
export type AmountRefusalReason = 'comma' | 'decimals' | 'notNumber' | 'range';

/** A refused number with what the cell's message names: the reason and the range. */
export interface NumberRefusal {
  /** `whole`: a rating exam score, whole numbers only (`edge/journal`). */
  readonly reason: AmountRefusalReason | 'whole';
  readonly min: number;
  readonly max: number;
}

/** What was typed: a number, `null` for an emptied cell, or the reason it is refused. */
export type ReadAmount =
  | { readonly kind: 'value'; readonly value: number | null }
  | { readonly kind: 'refused'; readonly reason: AmountRefusalReason };

const AMOUNT = /^(\d+)(?:\.(\d*))?$/;

/** Reads a score (from 0) or a total (from 1) typed with at most two digits after a point. */
export function readWorkAmount(typed: unknown, min: number, max: number): ReadAmount {
  const text =
    typeof typed === 'number' ? String(typed) : typeof typed === 'string' ? typed.trim() : '';
  if (text === '') return { kind: 'value', value: null };
  if (text.includes(',')) return { kind: 'refused', reason: 'comma' };
  const parts = AMOUNT.exec(text);
  if (parts === null) return { kind: 'refused', reason: 'notNumber' };
  const [, whole = '', decimals = ''] = parts;
  if (decimals.length > 2) return { kind: 'refused', reason: 'decimals' };
  // "8." is 8; the text is a plain decimal of at most two places, which a JS number writes back
  // exactly (`String`), and which the server reads from that text (`packages/calc`).
  const value = Number(decimals === '' ? whole : `${whole}.${decimals}`);
  if (value < min || value > max) return { kind: 'refused', reason: 'range' };
  return { kind: 'value', value };
}

/** The message of a refused number, in the person's language. */
export function refusalText(t: TFunction, refusal: NumberRefusal): string {
  switch (refusal.reason) {
    case 'comma':
      return t('journal.refusals.comma');
    case 'decimals':
      return t('journal.refusals.decimals');
    case 'notNumber':
      return t('journal.refusals.notNumber');
    case 'whole':
      return t('journal.rating.wholeNumber', { max: refusal.max });
    case 'range':
      return refusal.min === 0
        ? t('journal.works.amount', { total: refusal.max })
        : t('journal.works.totalAmount');
  }
}

/**
 * Types a point at the cursor of a number field (`07`, Keyboard: "digits and a point type"): the
 * phone keypad's own decimal key may be a comma, which the spec refuses (task 11.25b, decision
 * 11), so lesson mode and the total field have a point key of their own.
 */
export function withPoint(input: HTMLInputElement): string {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  return `${input.value.slice(0, start)}.${input.value.slice(end)}`;
}
