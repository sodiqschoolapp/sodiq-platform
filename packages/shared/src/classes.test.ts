import { describe, expect, it } from 'vitest';
import { classNameSchema } from './classes.js';

// All names are invented. Decision 17 of task 3.1a; the schema refuses every
// name `classes_name_check` (db/migrations/0043) refuses, so the API answers a
// validation error, never the database's refusal (pull request #88).
describe('classNameSchema', () => {
  it.each(['Oxford', 'Oxford 2', 'Gʻalaba', 'Ilm-fan', 'Оксфорд'])('accepts %s', (name) => {
    expect(classNameSchema.parse(name)).toBe(name);
  });

  it.each(['7-A', 'A', 'Oxford²', 'Oxford ٣', 'Oxford!'])('refuses %s', (name) => {
    expect(classNameSchema.safeParse(name).success).toBe(false);
  });
});
