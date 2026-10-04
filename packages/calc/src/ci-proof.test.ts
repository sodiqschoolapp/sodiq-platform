import { expect, test } from 'vitest';

// Deliberately failing: proves that CI turns a pull request red. Never merged.
test('ci proof', () => {
  expect(1).toBe(2);
});
