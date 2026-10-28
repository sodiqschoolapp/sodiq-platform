import { describe, expect, it } from 'vitest';
import { CLASS_NAMES, SIZES } from './real-size.js';

// The Speed run builds `triple` only in its own workflow, five hours long; a
// size with more classes in a grade than there are class names failed there
// on the first class it could not name (`classes_name_key`, 28 October 2026).
describe('the sizes of the real-size and speed runs', () => {
  it.each(Object.values(SIZES))('names every class of a grade in $name', (size) => {
    const largest = Math.max(...size.classesPerGrade.flat());
    expect(largest).toBeLessThanOrEqual(CLASS_NAMES.length);
    expect(new Set(CLASS_NAMES).size).toBe(CLASS_NAMES.length);
  });
});
