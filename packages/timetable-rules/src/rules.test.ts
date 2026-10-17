import { describe, expect, it } from 'vitest';
import { FIXED_RULES, RULE_ORDER, WARNINGS } from './rules.js';

// Task 5.3b-1, decision 4: step 5 of the builder shows the fixed rules, the
// blocked codes a weekly pattern can break; the generator keeps them (5.10).

describe('FIXED_RULES', () => {
  it('are the blocked rules of a weekly pattern, written out by hand', () => {
    expect(FIXED_RULES).toEqual([
      'teacher_double',
      'room_double',
      'room_shared_full',
      'room_shared_capacity',
      'class_double',
      'student_double',
      'split_apart',
      'day_off',
      'not_working_day',
      'no_template',
      'exam_week',
      'not_a_slot',
      'break_slot',
      'two_grade_slot',
      'double_apart',
      'teacher_branch',
      'teacher_inactive',
      'teacher_subject',
      'teacher_grade',
      'teacher_language',
      'teacher_unavailable',
      'subject_inactive',
      'room_inactive',
      'travel_time',
      'travel_time_not_set',
    ]);
  });

  it('are every blocked rule but those of dated lessons, one-day changes and exams, in the order of the results', () => {
    expect([...FIXED_RULES]).toEqual(
      RULE_ORDER.filter(
        (code) =>
          !WARNINGS.includes(code) &&
          !['outside_year', 'vacation', 'substitute_vacancy'].includes(code) &&
          !code.startsWith('invigilator_'),
      ),
    );
  });
});
