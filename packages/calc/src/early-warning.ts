/**
 * The early-warning list (task 9.4a; docs/spec/08-results-rating-analytics.md, Early-warning
 * list; edge/calculation, "The early-warning list compares a mid-quarter figure without the exam
 * against last quarter's final with the exam"; edge/journal, Attendance figures, "Three absences
 * in a row").
 *
 * - The "current work" figure: attendance, classwork and homework, no exam. It is `quarterResult`
 *   with the rating exam left out, the other weights scaled up as rule 7 does for a part left out
 *   (spec review of the plan, should-fix 1); the same figure of the previous quarter and as it
 *   stood 28 days ago are this function over those lessons (plan decisions 3 and 9).
 * - "Five graded works counts the student's own works": the works with a number of the student's
 *   lessons that are not exempt.
 * - "Three held lessons in a row of one journal marked 0 or 3. Exempt and cancelled lessons
 *   neither break nor extend the run": the current run, counted back from the latest lesson; a
 *   lesson with any other mark, or none, ends it (plan decision 8). Cancelled lessons are never
 *   passed.
 * - The reasons: the provisional quarter result below the threshold, by the rounded number
 *   (decision 2; "Thresholds such as 'below 50' use the same rounded number"); a drop of the
 *   current-work figure by the threshold or more against 28 days ago or the previous quarter, by
 *   the rounded numbers (decision 4), never for a result flagged "based on few lessons" (`08`,
 *   Exemptions); the attendance average below the threshold, rounded (decision 5); the current run
 *   at the threshold or longer. A subject with fewer than five graded works raises none (`08`,
 *   Not too early; decision 6).
 */
import type { AttendanceMark } from './attendance.js';
import type { Fraction } from './fraction.js';
import { CalcInputError, wholeNumber, wholeNumberIn } from './input.js';
import type { StudentQuarterOutcome } from './outcome.js';
import { quarterResult, type QuarterLesson, type QuarterResultInput } from './quarter.js';

/** `08`, Not too early: "A subject is judged only after five graded works in the quarter". */
export const MIN_GRADED_WORKS = 5;

const isExempt = (mark: AttendanceMark | null): boolean => mark === 4 || mark === 5;

/** The current-work figure: the quarter result without the rating exam; `null` with no part. */
export function currentWorkFigure(input: Omit<QuarterResultInput, 'ratingExam'>): Fraction | null {
  const result = quarterResult({
    ...input,
    ratingExam: input.weights.ratingExam === null ? null : { kind: 'not_held' },
  });
  return result.kind === 'number' ? result.value : null;
}

/** The student's own works with a number, in the lessons that are not exempt. */
export function ownGradedWorks(lessons: readonly QuarterLesson[]): number {
  return lessons
    .filter((lesson) => !isExempt(lesson.mark))
    .reduce(
      (count, lesson) =>
        count +
        [...lesson.classworks, ...lesson.homeworks].filter((work) => work.score !== null).length,
      0,
    );
}

/** The current run of lessons marked 0 or 3, back from the latest; `start` is its first lesson's index. */
export function currentAbsenceRun(lessons: readonly Pick<QuarterLesson, 'mark'>[]): {
  readonly length: number;
  readonly start: number | null;
} {
  let length = 0;
  let start: number | null = null;
  for (let index = lessons.length - 1; index >= 0; index -= 1) {
    const mark = lessons[index]?.mark ?? null;
    if (isExempt(mark)) continue;
    if (mark !== 0 && mark !== 3) break;
    length += 1;
    start = index;
  }
  return { length, start };
}

/** The thresholds of the branch (`branch_settings`, task 1.6). */
export interface EarlyWarningThresholds {
  readonly lowResult: number;
  readonly resultDrop: number;
  readonly attendancePercent: number;
  readonly absencesInRow: number;
}

export interface EarlyWarningInput {
  readonly thresholds: EarlyWarningThresholds;
  readonly gradedWorks: number;
  /** The provisional quarter outcome; `null` when there is none. */
  readonly outcome: StudentQuarterOutcome | null;
  readonly currentWork: {
    readonly now: Fraction | null;
    readonly daysAgo: Fraction | null;
    readonly previousQuarter: Fraction | null;
  };
  /** The quarter attendance average of the subject. */
  readonly attendance: Fraction | null;
  /** The length of the current run of absences. */
  readonly absenceRun: number;
}

export type EarlyWarningReason =
  | { readonly kind: 'low_result'; readonly shown: bigint }
  | {
      readonly kind: 'result_drop';
      /** The larger drop that reaches the threshold, in points of the rounded figures. */
      readonly points: bigint;
      readonly against: readonly ('days_ago' | 'previous_quarter')[];
    }
  | { readonly kind: 'low_attendance'; readonly shown: bigint }
  | { readonly kind: 'absences_in_row'; readonly length: bigint };

export type EarlyWarningKind = EarlyWarningReason['kind'];

export interface EarlyWarningJudgement {
  /** Five graded works or more: the subject is judged. */
  readonly judged: boolean;
  readonly reasons: readonly EarlyWarningReason[];
}

export function earlyWarningReasons(input: EarlyWarningInput): EarlyWarningJudgement {
  const lowResult = wholeNumberIn(input.thresholds.lowResult, 'thresholds.lowResult', 1n, 100n);
  const resultDrop = wholeNumberIn(input.thresholds.resultDrop, 'thresholds.resultDrop', 1n, 100n);
  const attendancePercent = wholeNumberIn(
    input.thresholds.attendancePercent,
    'thresholds.attendancePercent',
    1n,
    100n,
  );
  const absencesInRow = wholeNumberIn(
    input.thresholds.absencesInRow,
    'thresholds.absencesInRow',
    1n,
    30n,
  );
  const works = wholeNumber(input.gradedWorks, 'gradedWorks');
  const run = wholeNumber(input.absenceRun, 'absenceRun');
  if (works < 0n || run < 0n) {
    throw new CalcInputError('out_of_range', 'gradedWorks and absenceRun must be 0 or more.');
  }
  if (works < BigInt(MIN_GRADED_WORKS)) return { judged: false, reasons: [] };

  const reasons: EarlyWarningReason[] = [];
  const outcome = input.outcome;
  if (outcome?.kind === 'number' && outcome.result.shown < lowResult) {
    reasons.push({ kind: 'low_result', shown: outcome.result.shown });
  }

  const fewLessons = outcome !== null && outcome.flags.includes('few_lessons');
  const now = input.currentWork.now;
  if (now !== null && !fewLessons) {
    const shownNow = now.roundHalfUp();
    const drops = (
      [
        ['days_ago', input.currentWork.daysAgo],
        ['previous_quarter', input.currentWork.previousQuarter],
      ] as const
    ).flatMap(([against, before]) => {
      if (before === null) return [];
      const points = before.roundHalfUp() - shownNow;
      return points >= resultDrop ? [{ against, points }] : [];
    });
    if (drops.length > 0) {
      reasons.push({
        kind: 'result_drop',
        points: drops.reduce((most, drop) => (drop.points > most ? drop.points : most), 0n),
        against: drops.map((drop) => drop.against),
      });
    }
  }

  if (input.attendance !== null && input.attendance.roundHalfUp() < attendancePercent) {
    reasons.push({ kind: 'low_attendance', shown: input.attendance.roundHalfUp() });
  }
  if (run >= absencesInRow) reasons.push({ kind: 'absences_in_row', length: run });
  return { judged: true, reasons };
}
