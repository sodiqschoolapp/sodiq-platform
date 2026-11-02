import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOTS = [
  path.resolve(HERE, '../..'),
  path.resolve(HERE, '../../../../../packages/shared/src'),
];

/** Every source file of the API and of `packages/shared`, tests and test helpers left out. */
function sources(): { file: string; text: string }[] {
  return ROOTS.flatMap((root) =>
    readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter(
        (file) =>
          file.endsWith('.ts') &&
          !file.endsWith('.test.ts') &&
          !file.split(path.sep).includes('testing'),
      )
      .map((file) => ({
        file: path.relative(path.resolve(HERE, '../../../../..'), path.join(root, file)),
        text: readFileSync(path.join(root, file), 'utf8'),
      })),
  );
}

/**
 * The ways of reading the Tutor role alone: a comparison, a set or list of
 * that role only, and a query of that role only.
 */
const TUTOR_ALONE = [
  /role\s*===\s*'tutor'/,
  /role\s*!==\s*'tutor'/,
  /\.has\(\s*'tutor'\s*\)/,
  /\[\s*'tutor'\s*\]/,
  /role',\s*'=',\s*'tutor'/,
];

/**
 * Where the Tutor role alone is meant: the give of a row chooses which of the
 * two refusals of the grade it answers (`class_needs_class_teacher` for a
 * Tutor given a class of grades 0–4).
 */
const ALLOWED: Readonly<Record<string, number>> = {
  'apps/api/src/modules/classes/class-tutors.service.ts': 1,
};

// Task 9.4e (edge/00-definitions, Tutor of a class): "Every rule that names the Tutor of a
// class … applies in the same way to the Class teacher of a class of grades 0–4." Code that
// decides own class reads OWN_CLASS_ROLES (packages/shared/src/roles.ts), never the Tutor
// role alone, so that a new reader of own class cannot leave the Class teacher out.
describe('the own class of a Tutor or a Class teacher', () => {
  it('is never read from the Tutor role alone', () => {
    const found: Record<string, number> = {};
    for (const { file, text } of sources()) {
      const count = TUTOR_ALONE.reduce(
        (sum, pattern) => sum + (text.match(new RegExp(pattern, 'g'))?.length ?? 0),
        0,
      );
      if (count > 0) found[file] = count;
    }
    expect(found).toEqual(ALLOWED);
  });

  it('is in every table keyed by role that names the Tutor', () => {
    const missing = sources()
      .filter(({ text }) => /\n\s+tutor: \[/.test(text) && !/\bclass_teacher\b/.test(text))
      .map(({ file }) => file);
    expect(missing).toEqual([]);
  });

  it('matches the ways of writing the Tutor role alone', () => {
    for (const sample of [
      "one.role === 'tutor'",
      "one.role !== 'tutor'",
      "roles.has('tutor')",
      "permitting(context, ['tutor'])",
      ".where('assignments.role', '=', 'tutor')",
    ]) {
      expect(
        TUTOR_ALONE.some((pattern) => pattern.test(sample)),
        sample,
      ).toBe(true);
    }
  });
});
