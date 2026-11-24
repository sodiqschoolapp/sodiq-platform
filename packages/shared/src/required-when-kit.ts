import { expect } from 'vitest';
import type { z } from 'zod';
import { leftEmpty, type RequiredKnown, type RequiredWhen } from './required-when.js';

/**
 * Task 11.18 (`12`, No lost work: "A field without the mark may be left
 * empty"). A form marks a field from its schema's own rule for the field, and
 * from the schema's `requiredWhen` for what only a refine or the server says.
 * For each valid sample, each field is emptied in turn: when the schema then
 * refuses the record with refine issues only (the field's own rule is read
 * from the schema by the form), the map must say the field is required, and
 * when the schema takes the emptied record, the map must not.
 */
export function expectTiedTo(
  schema: z.ZodType,
  samples: readonly Record<string, unknown>[],
  map: RequiredWhen,
  known: RequiredKnown = {},
  /** Requirements the server checks outside the schema: their own test. */
  outside: readonly string[] = [],
): void {
  for (const sample of samples) {
    expect(schema.safeParse(sample).success, JSON.stringify(sample)).toBe(true);
    for (const field of Object.keys(sample)) {
      if (outside.includes(field) || leftEmpty(sample[field])) {
        continue;
      }
      // Empty as a form sends it: '' for a text, null for a field that may be none.
      const ownRule = (checked: ReturnType<typeof schema.safeParse>) =>
        !checked.success &&
        checked.error.issues.some((issue) => issue.path[0] === field && issue.code !== 'custom');
      const empties: unknown[] = Array.isArray(sample[field]) ? [[]] : ['', null, undefined];
      const tries = empties.map((empty) => schema.safeParse({ ...sample, [field]: empty }));
      const checked = tries.find((one) => !ownRule(one));
      if (checked === undefined) {
        continue;
      }
      const byRefine = !checked.success;
      const says = map[field]?.(sample, known) ?? false;
      expect({ field, sample, required: says }).toEqual({ field, sample, required: byRefine });
    }
  }
}
