import { describe, expect, it } from 'vitest';
import { branchIdSchema } from './branches.js';

describe('branchIdSchema', () => {
  it('accepts an id as the database makes it', () => {
    const id = '0199b2f4-6c1e-7a52-9d3b-4f8e2a1c7b60';

    expect(branchIdSchema.parse(id)).toBe(id);
  });

  it.each([
    ['a number', 1],
    ['an empty text', ''],
    ['a text that is not an id', 'main-branch'],
    ['an id with text after it', '0199b2f4-6c1e-7a52-9d3b-4f8e2a1c7b60}, {'],
    ['null', null],
  ])('refuses %s', (_name, value) => {
    expect(branchIdSchema.safeParse(value).success).toBe(false);
  });
});
