/**
 * The lesson score, AVG of the journal (docs/spec/07-journal.md, Calculation
 * rules 3 and 4; the build plan's "daily result"; task 4.1, decision 9): the
 * subject's daily distribution applied to the attendance value, the classwork part
 * and the homework part of one lesson for one student.
 *
 * - The classwork part is the mean of the exact percents of the lesson's
 *   classworks that have a number; the homework part likewise for the homeworks
 *   checked at the lesson (decision 5). An empty number (`null`, also a "not
 *   graded" cell) is left out; a 0 counts. A work marked "not held" is not passed
 *   at all (decision 10).
 * - A part with no data is left out and the weights of the parts present are
 *   scaled up to 100: the sum of weight × part over the parts present, divided by
 *   the sum of their weights (decision 6; docs/spec/edge-cases/calculation.md).
 * - An attendance mark not yet typed, or a lesson that does not count for
 *   attendance (an extra lesson with the switch off), leaves the attendance part
 *   out (decisions 2 and 7).
 * - Marks 4 and 5 give no score; a number with them is a fault (decision 3).
 *
 * The lesson score is for display only and never enters a quarter figure
 * (docs/spec/edge-cases/calculation.md): the quarter averages count each work
 * once (07, Calculation rules 6), never these parts. The `parts` of the answer are
 * kept for the tests and for the support view of docs/spec/edge-cases/journal.md
 * ("how the result was calculated"); no journal cell shows them (decision 14).
 *
 * An attendance-only subject has no daily distribution and so no lesson score; it
 * is never passed here (decision 13).
 */
import {
  attendanceValue,
  isExemptMark,
  type AttendanceMark,
  type AttendanceValues,
} from './attendance.js';
import { Fraction } from './fraction.js';
import { CalcInputError, wholeNumberIn } from './input.js';
import { workPercent } from './work.js';

/** The subject's daily distribution: three whole parts of 1 to 100, totalling 100 (task 2.1). */
export interface DailyWeights {
  readonly attendance: number;
  readonly classwork: number;
  readonly homework: number;
}

/** A work with its total set; `score` is `null` while empty or "not graded". */
export interface Work {
  readonly total: number;
  readonly score: number | null;
}

export interface LessonScoreInput {
  readonly weights: DailyWeights;
  /** The attendance mark, `null` while not typed. */
  readonly mark: AttendanceMark | null;
  /** The late and skipped values of the lesson's quarter. */
  readonly attendanceValues: AttendanceValues;
  /** `false` only for an extra lesson whose "counts for attendance" switch is off. */
  readonly countsForAttendance: boolean;
  /** The lesson's classworks. */
  readonly classworks: readonly Work[];
  /** The homeworks checked at the lesson. */
  readonly homeworks: readonly Work[];
}

/** The exact value of each part used; `null` for a part left out. */
export interface LessonParts {
  readonly attendance: Fraction | null;
  readonly classwork: Fraction | null;
  readonly homework: Fraction | null;
}

export type LessonScore =
  | { readonly kind: 'score'; readonly value: Fraction; readonly parts: LessonParts }
  | { readonly kind: 'blank' }
  | { readonly kind: 'exempt' };

function checkedWeights(weights: DailyWeights): readonly [bigint, bigint, bigint] {
  const attendance = wholeNumberIn(weights.attendance, 'weights.attendance', 1n, 100n);
  const classwork = wholeNumberIn(weights.classwork, 'weights.classwork', 1n, 100n);
  const homework = wholeNumberIn(weights.homework, 'weights.homework', 1n, 100n);
  if (attendance + classwork + homework !== 100n) {
    throw new CalcInputError('weights_not_100', 'The daily distribution totals 100.');
  }
  return [attendance, classwork, homework];
}

function partOf(works: readonly Work[]): Fraction | null {
  return Fraction.meanOf(
    works.flatMap((work) => {
      if (work.score === null) {
        // The total is still checked: a work is passed only with its total set.
        workPercent(0, work.total);
        return [];
      }
      return [workPercent(work.score, work.total)];
    }),
  );
}

export function lessonScore(input: LessonScoreInput): LessonScore {
  const [attendanceWeight, classworkWeight, homeworkWeight] = checkedWeights(input.weights);

  if (input.mark !== null && isExemptMark(input.mark)) {
    if ([...input.classworks, ...input.homeworks].some((work) => work.score !== null)) {
      throw new CalcInputError('number_on_exempt_lesson', 'An exempt lesson holds no number.');
    }
    return { kind: 'exempt' };
  }

  let attendance: Fraction | null = null;
  if (input.countsForAttendance && input.mark !== null) {
    const value = attendanceValue(input.mark, input.attendanceValues);
    // Not exempt: the exempt marks returned above.
    attendance = value === 'exempt' ? null : value;
  }
  const classwork = partOf(input.classworks);
  const homework = partOf(input.homeworks);

  const present = (
    [
      [attendanceWeight, attendance],
      [classworkWeight, classwork],
      [homeworkWeight, homework],
    ] as const
  ).flatMap(([weight, part]) => (part === null ? [] : [{ weight: Fraction.whole(weight), part }]));
  if (present.length === 0) return { kind: 'blank' };

  const weighted = present.reduce(
    (sum, { weight, part }) => sum.add(weight.mul(part)),
    Fraction.whole(0n),
  );
  const weights = present.reduce((sum, { weight }) => sum.add(weight), Fraction.whole(0n));
  return {
    kind: 'score',
    value: weighted.div(weights),
    parts: { attendance, classwork, homework },
  };
}
