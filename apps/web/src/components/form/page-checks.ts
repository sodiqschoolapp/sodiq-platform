import type { FormIssue, FormSchema } from './form-messages';

type Typed = Readonly<Record<string, string>>;

/**
 * A check of a page that is stricter than the body of its route: fields the
 * page refuses empty although the route would take them (the login of a
 * reset request, trimmed), or that the route never gets (the new password
 * typed again). It feeds `requiredOf`, so these fields carry the red asterisk
 * too (task 11.18, decision 2: a field the form refuses empty is marked).
 */
export function filledOnPage(fields: readonly string[]): FormSchema<Typed> {
  return {
    safeParse: (input) => {
      const typed: Typed = typeof input === 'object' && input !== null ? (input as Typed) : {};
      const issues: FormIssue[] = fields
        .filter((field) => (typed[field] ?? '').trim() === '')
        .map((field) => ({ code: 'too_small', path: [field] }));
      return issues.length === 0
        ? { success: true, data: typed }
        : { success: false, error: { issues } };
    },
  };
}
