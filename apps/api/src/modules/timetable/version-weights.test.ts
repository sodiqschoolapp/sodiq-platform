import { PREFERENCE_CODES, PREFERENCE_WEIGHT_MAX } from '@sodiq/shared';
import { MAX_WEIGHT, PREFERENCES } from '@sodiq/timetable-rules';
import { describe, expect, it } from 'vitest';
import { confirmedWeightsOf, sameWeights, weightColumnsOf, weightsOf } from './version-weights.js';

// Task 5.3b-1: the preferences of step 5 are written once in the rule engine
// and once in the shared schemas; the two lists and bounds are the same.
describe('the weights of a version', () => {
  it('names the preferences and their bound as the rule engine does', () => {
    expect([...PREFERENCE_CODES]).toEqual([...PREFERENCES]);
    expect(PREFERENCE_WEIGHT_MAX).toBe(MAX_WEIGHT);
  });

  it('reads back from its columns the weights written, each in its own column', () => {
    const weights = {
      class_no_gaps: 0,
      teacher_few_gaps: 1,
      subject_spread: 2,
      demanding_early: 3,
      class_even_days: 4,
      main_room: 6,
      part_time_few_days: 7,
      teacher_preferred_times: 8,
    };
    expect(weightsOf(weightColumnsOf(weights))).toEqual(weights);
    expect(new Set(Object.values(weightColumnsOf(weights))).size).toBe(8);
    expect(confirmedWeightsOf(weights)).toEqual(weights);
    expect(confirmedWeightsOf(null)).toBeNull();
    expect(sameWeights(weights, { ...weights })).toBe(true);
    expect(sameWeights(weights, { ...weights, teacher_preferred_times: 9 })).toBe(false);
  });
});
