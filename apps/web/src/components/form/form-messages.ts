import type { TFunction } from 'i18next';

/**
 * What a schema of `packages/shared` says is wrong with one field: the part of
 * a zod issue the form reads. Written out here, so the web app needs no
 * library of its own for it.
 */
export interface FormIssue {
  readonly code: string;
  /** The name of the field comes first. */
  readonly path: readonly PropertyKey[];
  readonly minimum?: number | bigint;
  readonly maximum?: number | bigint;
  /** What was measured: `string` for a length, `number` or `int` for a value. */
  readonly origin?: string;
  readonly expected?: string;
}

/** A schema of `packages/shared`, as far as a form uses it. */
export interface FormSchema<Values> {
  safeParse: (
    input: unknown,
  ) =>
    { success: true; data: Values } | { success: false; error: { issues: readonly FormIssue[] } };
}

const isNumber = (kind: string | undefined): boolean =>
  kind === 'number' || kind === 'int' || kind === 'bigint';

/**
 * docs/spec/12-ux-standards.md, No lost work: forms "say in plain words what
 * to fix". The text for one issue of a field, in the language of the person;
 * `typed` is what stands in the field.
 */
export function formMessage(
  t: TFunction,
  language: string,
  issue: FormIssue,
  typed: string,
): string {
  // Too few choices in a checkbox group: not a text to fill in or lengthen
  // (issue #39, hand test of 13 October 2026, finding 21).
  if (issue.code === 'too_small' && issue.origin === 'array') {
    return t('form.chooseOne');
  }
  if (typed.trim() === '') {
    return t('form.required');
  }
  const number = new Intl.NumberFormat(language);
  if (issue.code === 'too_small' && issue.minimum !== undefined) {
    return isNumber(issue.origin)
      ? t('form.tooSmall', { min: number.format(issue.minimum) })
      : t('form.tooShort', { count: Number(issue.minimum), n: number.format(issue.minimum) });
  }
  if (issue.code === 'too_big' && issue.maximum !== undefined) {
    return isNumber(issue.origin)
      ? t('form.tooBig', { max: number.format(issue.maximum) })
      : t('form.tooLong', { count: Number(issue.maximum), n: number.format(issue.maximum) });
  }
  if (issue.code === 'invalid_type' && isNumber(issue.expected)) {
    return t('form.wholeNumber');
  }
  return t('form.invalid');
}

/**
 * What is typed into a field for a whole number, as the schema wants it: the
 * number, nothing for an empty field, and the text itself when it is not a
 * whole number (the schema then refuses it). Typed scores and totals are whole
 * numbers (CLAUDE.md): `1.5`, `1,5` and `1e3` are not read as numbers.
 */
export function wholeNumber(typed: string): number | string | undefined {
  const text = typed.trim();
  if (text === '') {
    return undefined;
  }
  return /^-?\d{1,15}$/.test(text) ? Number(text) : text;
}
