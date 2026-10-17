import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHT, MAX_WEIGHT, PREFERENCES } from './preferences.js';

// Task 5.3b-1: the preferences of 06, Auto-generation, in the order of its
// table, each with a weight from 0 (not used) to 10, starting at 5 (decision 3).

describe('PREFERENCES', () => {
  it('lists the eight preferences of 06 in the order of its table', () => {
    expect(PREFERENCES).toEqual([
      'class_no_gaps',
      'teacher_few_gaps',
      'subject_spread',
      'demanding_early',
      'class_even_days',
      'main_room',
      'part_time_few_days',
      'teacher_preferred_times',
    ]);
  });

  it('weighs from 0 to 10, starting at 5', () => {
    expect(MAX_WEIGHT).toBe(10);
    expect(DEFAULT_WEIGHT).toBe(5);
  });
});
