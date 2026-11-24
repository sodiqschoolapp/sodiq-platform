/**
 * The fields a form must fill only in some states, which its schema says
 * through an object-level refine or the server checks outside the schema
 * (task 11.18; docs/spec/12-ux-standards.md, No lost work: "A field without
 * the mark may be left empty"). A form reads the field-level requirements from
 * the schema itself; zod skips an object-level refine while another field is
 * wrong (an unchosen select), and a server check is not in the schema at all,
 * so those are declared here, beside the schema, and `required-when.test.ts`
 * ties each map to its schema.
 */

/** What the form knows from the server, never from the device's clock. */
export interface RequiredKnown {
  /** The branch's today (`YYYY-MM-DD`), once read; `undefined` while it is not. */
  readonly today?: string | undefined;
  /** The record the form changes is already stored (a rating entry over a stored one). */
  readonly stored?: boolean | undefined;
}

/** The values the schema checks, as the form's `read` hands them over. */
export type RequiredValues = Readonly<Record<string, unknown>>;

/** Field name → whether that field must be filled now. */
export type RequiredWhen = Readonly<
  Record<string, (values: RequiredValues, known: RequiredKnown) => boolean>
>;

/** A value the schema reads as "left empty": nothing, no text, or no choice of a list. */
export const leftEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);
