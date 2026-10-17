/**
 * The rules of a timetable and their results (docs/spec/06-timetable.md,
 * Rules; Teachers who work in several branches; Changes after publishing,
 * Exam; 05-classes-groups-subjects.md, Language of instruction;
 * edge-cases/timetable.md; task 5.2, pull request #109).
 *
 * One code per rule. The grid, the conflict panel, every route that writes a
 * lesson or an exam, publish and the re-check of the solver's output read the
 * same results (`06`, Auto-generation: "The generator and the grid use one
 * rule engine"). The texts are the web app's i18n keys `timetable.rule.<code>`
 * (decision 5); the engine has none.
 */

/** Every rule, in the order its results are reported. */
export const RULE_ORDER = [
  // One place at a time (06, Rules, the first three rows; the exam row).
  'teacher_double',
  'room_double',
  'room_shared_full',
  'room_shared_capacity',
  'class_double',
  'student_double',
  'split_apart',
  // The day (06, Rules: "No lesson on a day off, outside the academic year, or
  // outside that day's lesson times"; review correction 1).
  'outside_year',
  'vacation',
  'day_off',
  'not_working_day',
  'no_template',
  'exam_week',
  'not_a_slot',
  'break_slot',
  'two_grade_slot',
  'double_apart',
  'double_not_allowed',
  // The teacher, the subject and the room.
  'teacher_branch',
  'teacher_inactive',
  'teacher_subject',
  'teacher_grade',
  'teacher_language',
  'substitute_vacancy',
  'substitute_language',
  'teacher_unavailable',
  'teacher_unavailable_later',
  'subject_inactive',
  'room_inactive',
  'room_under_repair',
  'travel_time',
  'travel_time_not_set',
  // Invigilators (06, Exam; review correction 2).
  'invigilator_vacancy',
  'invigilator_inactive',
  'invigilator_unavailable',
  'invigilator_subject',
  // Warnings of the load and the day.
  'room_capacity',
  'teacher_week_load',
  'teacher_day_load',
  'class_day_load',
  'subject_twice',
  'class_free_period',
  'load_mismatch',
  'other_draft',
] as const;

export type RuleCode = (typeof RULE_ORDER)[number];

export type Severity = 'blocked' | 'warning';

/** The warnings of the Rules table, and the warnings the exam row and `05` add; every other code blocks. */
export const WARNINGS: readonly RuleCode[] = [
  'substitute_language',
  'teacher_unavailable_later',
  'room_under_repair',
  'invigilator_unavailable',
  'invigilator_subject',
  'room_capacity',
  'teacher_week_load',
  'teacher_day_load',
  'class_day_load',
  'subject_twice',
  'class_free_period',
  'load_mismatch',
  'other_draft',
];

/**
 * The fixed rules shown at step 5 of the builder (06, Building a timetable:
 * "Reviews the fixed rules"; task 5.3b-1, decision 4): the blocked rules a
 * weekly pattern can break, which the generator never breaks. Left out: the
 * rules of dated lessons only (`outside_year`, `vacation`), of a one-day
 * change (`substitute_vacancy`) and of an exam (`invigilator_*`); they are
 * still checked where they apply.
 */
export const FIXED_RULES = [
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
  'double_not_allowed',
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
] as const satisfies readonly RuleCode[];

export type FixedRule = (typeof FIXED_RULES)[number];

/**
 * The blocked rules that a one-day change turns into warnings with a tick
 * when no teacher of the subject is free (`edge/timetable`, After publishing,
 * "No teacher of the subject is free"; review correction 3). Double booking,
 * status, branch and a vacancy as a substitute stay blocked.
 */
export const RELAXED_WHEN_NO_TEACHER_FREE: readonly RuleCode[] = [
  'teacher_subject',
  'teacher_grade',
  'teacher_unavailable',
];

/** One broken rule: its code, its severity, the day and every lesson or exam involved. */
export interface RuleResult {
  readonly rule: RuleCode;
  readonly severity: Severity;
  /** The day of the placements: a school date, a weekday ('1' to '7'), or '' for the week. */
  readonly day: string;
  /** The ids of the placements involved, in the order of their start, then their id. */
  readonly lessonIds: readonly string[];
  /** Numbers that explain the result (for example the travel time and the gap). */
  readonly detail?: Readonly<Record<string, number | string>>;
}

/**
 * The results a move or a swap within the week cannot change: they count the
 * lessons of a week, not where they sit (task 5.4a). The grid leaves them out
 * of a slot's status while dragging, or every slot of a row short of its
 * load would show the same warning.
 */
export const WEEK_COUNT_RULES: readonly RuleCode[] = ['teacher_week_load', 'load_mismatch'];

/** What a slot shows while dragging (06, Editing in the grid: "free, warning or blocked"). */
export type SlotStatus = 'free' | 'warning' | 'blocked';

/** The status of a slot from the results of a candidate placed there. */
export function slotStatus(results: readonly RuleResult[]): SlotStatus {
  if (results.some((result) => result.severity === 'blocked')) {
    return 'blocked';
  }
  return results.length > 0 ? 'warning' : 'free';
}
