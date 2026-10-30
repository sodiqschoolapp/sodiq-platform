import { z } from 'zod';

/**
 * The status of a held lesson (task 8.7, pull request #225; `07`, Lesson
 * status), worked out on each request from what is stored, never stored
 * itself. Every reader (the journal grid, the teaching home, the timetable
 * views, the reminders, the counts per teacher and the orphan lessons) calls
 * `lessonStatusOf` with the facts of `lessonStatusFacts`
 * (`apps/api/src/modules/journal/lesson-status.query.ts`).
 *
 * - Attendance waits for the expected students without an optional cell
 *   (decision 2: `journal_optional_cells`, 0127, and `exemption_reopened_cells`,
 *   0123; `edge/journal`: "They are optional: the lesson's status does not
 *   change").
 * - A work waits for the numbers of those students marked 1 or 2 (`07`:
 *   "Exempt and absent students are not waited for"; `edge/journal`, row 1),
 *   less the students optional for that work (a homework given while they
 *   were not expected, row 15). A number or "not graded" ends the wait.
 * - Not started: no data on the lesson (`edge/00-definitions`, Data on a
 *   lesson). Complete: every mark, total and number waited for is there.
 *   Locked incomplete: not complete from the lock moment (decision 7).
 */
export const LESSON_STATUSES = [
  'not_started',
  'in_progress',
  'complete',
  'locked_incomplete',
] as const;

export const lessonStatusSchema = z.enum(LESSON_STATUSES);

export type LessonStatus = z.infer<typeof lessonStatusSchema>;

/** A counted work of a lesson (a column of `lessonColumns`, not "not held"). */
export interface StatusWork {
  /** `null` while the teacher has not set it. */
  readonly total: number | null;
  /** Students optional for this work (row 15): never waited for here. */
  readonly optional: readonly string[];
  /** The students with a number in the work's cell. */
  readonly numbered: readonly string[];
  /** The students whose cell is "not graded". */
  readonly notGraded: readonly string[];
}

export interface StatusFacts {
  /** `edge/00-definitions`, Held lesson (`lessonStateOf` is `held`). */
  readonly held: boolean;
  /** The lock moment (`journal_lesson_lock`); `null` while it cannot be worked out. */
  readonly locksAt: Date | null;
  /** The expected students without an optional or reopened cell. */
  readonly waited: readonly string[];
  /** The attendance mark of each student marked (0 to 3). */
  readonly marks: ReadonlyMap<string, number>;
  readonly works: readonly StatusWork[];
  /** Data on the lesson entered by a person: a mark, a number, a total, "not held" or a comment. */
  readonly data: boolean;
}

/** The status with what keeps it from complete, for the reminders and the counts. */
export interface StatusAnswer {
  readonly status: LessonStatus;
  /** Waited-for students without an attendance mark. */
  readonly unmarked: number;
  /** Counted works with no total, or with a number waited for missing. */
  readonly worksMissing: number;
}

const PRESENT = new Set([1, 2]);

/**
 * What keeps a held lesson from complete, the same at every moment (task 10.1b: the prepared
 * totals keep it per lesson, so the closing checklist reads it without the lesson's facts).
 */
export function statusCountsOf(
  facts: StatusFacts,
): Pick<StatusAnswer, 'unmarked' | 'worksMissing'> {
  const unmarked = facts.waited.filter((student) => !facts.marks.has(student)).length;
  const present = facts.waited.filter((student) => PRESENT.has(facts.marks.get(student) ?? -1));
  const worksMissing = facts.works.filter((work) => {
    if (work.total === null) return true;
    const done = new Set([...work.numbered, ...work.notGraded]);
    const optional = new Set(work.optional);
    return present.some((student) => !optional.has(student) && !done.has(student));
  }).length;
  return { unmarked, worksMissing };
}

/** The status of a lesson at `now`; `null` for a lesson not held (no status, `07`). */
export function lessonStatusOf(facts: StatusFacts, now: Date): StatusAnswer | null {
  if (!facts.held) return null;
  const { unmarked, worksMissing } = statusCountsOf(facts);
  const complete = unmarked === 0 && worksMissing === 0;
  let status: LessonStatus;
  if (complete) status = 'complete';
  else if (facts.locksAt !== null && now.getTime() >= facts.locksAt.getTime()) {
    status = 'locked_incomplete';
  } else status = facts.data ? 'in_progress' : 'not_started';
  return { status, unmarked, worksMissing };
}
