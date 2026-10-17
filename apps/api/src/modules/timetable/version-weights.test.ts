import { PIN_PROBLEM_CODES, PREFERENCE_CODES, PREFERENCE_WEIGHT_MAX } from '@sodiq/shared';
import { MAX_WEIGHT, PIN_PROBLEMS, PREFERENCES } from '@sodiq/timetable-rules';
import { describe, expect, it } from 'vitest';
import {
  confirmationOf,
  confirmedPinsOf,
  confirmedWeightsOf,
  samePins,
  sameWeights,
  weightColumnsOf,
  weightsOf,
} from './version-weights.js';

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
    // A preference added after the confirmation is missing from it: read, and not the same.
    const older = Object.fromEntries(
      Object.entries(weights).filter(([code]) => code !== 'main_room'),
    );
    expect(confirmedWeightsOf(older)).toEqual(older);
    expect(sameWeights(older, weights)).toBe(false);
    expect(sameWeights(weights, { ...weights })).toBe(true);
    expect(sameWeights(weights, { ...weights, teacher_preferred_times: 9 })).toBe(false);
  });

  // Task 5.3b-2, decision 7: the confirmation holds the pin ids beside the weights.
  it('reads the pins of a confirmation, none from one stored before pins', () => {
    const weights = {
      class_no_gaps: 5,
      teacher_few_gaps: 5,
      subject_spread: 5,
      demanding_early: 5,
      class_even_days: 5,
      main_room: 5,
      part_time_few_days: 5,
      teacher_preferred_times: 5,
    };
    const a = '01900000-0000-7000-8000-00000000000a';
    const b = '01900000-0000-7000-8000-00000000000b';
    const stored: unknown = JSON.parse(confirmationOf(weights, [b, a, b]));
    expect(stored).toEqual({ ...weights, pins: [a, b] });
    expect(confirmedWeightsOf(stored)).toEqual(weights);
    expect(confirmedPinsOf(stored)).toEqual([a, b]);
    expect(confirmedPinsOf(weights)).toEqual([]);
    expect(confirmedPinsOf(null)).toBeNull();
    expect(samePins([a, b], [b, a])).toBe(true);
    expect(samePins([a], [a, b])).toBe(false);
  });

  it('names the pin problems as the rule engine does', () => {
    expect([...PIN_PROBLEM_CODES]).toEqual([...PIN_PROBLEMS]);
  });
});
