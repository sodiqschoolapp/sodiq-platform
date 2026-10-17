/**
 * The weights of the preferences of a version and their confirmation (task
 * 5.3b-1, pull request #128): the eight `weight_<code>` columns of
 * `timetable_versions` (db/migrations/0069) and `rules_confirmed`, the
 * weights as confirmed, by code.
 */
import { PREFERENCE_CODES, preferenceWeightsSchema, type PreferenceWeights } from '@sodiq/shared';

/** The columns of the weights, as the version rows carry them. */
export interface WeightColumns {
  weight_class_no_gaps: number;
  weight_teacher_few_gaps: number;
  weight_subject_spread: number;
  weight_demanding_early: number;
  weight_class_even_days: number;
  weight_main_room: number;
  weight_part_time_few_days: number;
  weight_teacher_preferred_times: number;
}

export const WEIGHT_COLUMNS = [
  'timetable_versions.weight_class_no_gaps',
  'timetable_versions.weight_teacher_few_gaps',
  'timetable_versions.weight_subject_spread',
  'timetable_versions.weight_demanding_early',
  'timetable_versions.weight_class_even_days',
  'timetable_versions.weight_main_room',
  'timetable_versions.weight_part_time_few_days',
  'timetable_versions.weight_teacher_preferred_times',
] as const;

/** The weights of a version row, by code. */
export function weightsOf(row: WeightColumns): PreferenceWeights {
  return {
    class_no_gaps: row.weight_class_no_gaps,
    teacher_few_gaps: row.weight_teacher_few_gaps,
    subject_spread: row.weight_subject_spread,
    demanding_early: row.weight_demanding_early,
    class_even_days: row.weight_class_even_days,
    main_room: row.weight_main_room,
    part_time_few_days: row.weight_part_time_few_days,
    teacher_preferred_times: row.weight_teacher_preferred_times,
  };
}

/** The columns to write for the weights. */
export function weightColumnsOf(weights: PreferenceWeights): WeightColumns {
  return {
    weight_class_no_gaps: weights.class_no_gaps,
    weight_teacher_few_gaps: weights.teacher_few_gaps,
    weight_subject_spread: weights.subject_spread,
    weight_demanding_early: weights.demanding_early,
    weight_class_even_days: weights.class_even_days,
    weight_main_room: weights.main_room,
    weight_part_time_few_days: weights.part_time_few_days,
    weight_teacher_preferred_times: weights.teacher_preferred_times,
  };
}

/**
 * `rules_confirmed` as stored; `null` when never confirmed. A preference
 * added after the confirmation is missing from it and counts as changed
 * (permission review, should-fix 2), never as a fault.
 */
export function confirmedWeightsOf(stored: unknown): Partial<PreferenceWeights> | null {
  return stored === null ? null : preferenceWeightsSchema.partial().parse(stored);
}

/** Whether the weights confirmed (or sent) are the weights stored, code by code. */
export const sameWeights = (a: Partial<PreferenceWeights>, b: PreferenceWeights): boolean =>
  PREFERENCE_CODES.every((code) => a[code] === b[code]);
