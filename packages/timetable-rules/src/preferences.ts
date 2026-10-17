/**
 * The preferences of the generator (docs/spec/06-timetable.md,
 * Auto-generation: "Preferences, each with a weight set by the Academic Vice
 * Principal"; task 5.3b-1). Decision 3: a weight is a whole number from 0
 * (the preference is not used) to `MAX_WEIGHT`, starting at `DEFAULT_WEIGHT`.
 * Each is a column `weight_<code>` of `timetable_versions` (0069); the solver
 * (5.10) reads them as the weights of its soft constraints.
 */

/** In the order of the preferences table of `06`. */
export const PREFERENCES = [
  // A class has no empty lesson slot between its first and last lesson.
  'class_no_gaps',
  // A teacher has few empty slots between lessons.
  'teacher_few_gaps',
  // Lessons of one subject are spread over the week, and not twice in a day
  // unless a double lesson is allowed.
  'subject_spread',
  // Demanding subjects are in the first slots of the day.
  'demanding_early',
  // A class has a similar number of lessons each day.
  'class_even_days',
  // A class stays in its main classroom when the subject needs no special room.
  'main_room',
  // A part-time teacher's lessons fall on as few days as possible.
  'part_time_few_days',
  // A teacher's preferred days and slots are respected.
  'teacher_preferred_times',
] as const;

export type Preference = (typeof PREFERENCES)[number];

/** A weight for every preference. */
export type Weights = Readonly<Record<Preference, number>>;

export const MAX_WEIGHT = 10;

export const DEFAULT_WEIGHT = 5;
