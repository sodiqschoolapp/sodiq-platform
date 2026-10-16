/**
 * The quarter figures of one student in one subject (docs/spec/07-journal.md,
 * Calculation rules 5 to 10; docs/spec/edge-cases/calculation.md; task 4.2).
 *
 * - The attendance average is the mean of the attendance values of the lessons
 *   with a mark (rule 5). Marks 4 and 5 and a lesson not yet marked are left out
 *   (decision 1).
 * - The classwork and homework averages count each work once over the quarter
 *   (rule 6), never the lesson's parts. Works of a lesson with mark 4 or 5 are
 *   left out, the homeworks checked at it included, and a number there is a
 *   fault (07, Effect on totals; decision 4). An empty number is left out, a 0
 *   counts (rule 4).
 * - The rating exam: a score counts as itself, "did not sit" counts 0, "exempt"
 *   and "not held" leave the part out (rule 8; edge/calculation, "The rating
 *   exam"). No entry yet, also "exempt on exam day, pending", leaves the part out
 *   as having no data (decision 3).
 * - The quarter result is the sum of weight × part over the parts that have data,
 *   divided by the sum of their weights (rule 7; edge/calculation, "A part has a
 *   weight but no data"). With no part at all there is no number (decision 5).
 *   It is provisional while the quarter is open and a weighted part has no data;
 *   in a closed quarter `leftOut` is the "part left out" marker (decision 2).
 *
 * The caller passes the student's held, not cancelled lessons of the subject in
 * the quarter, from every journal the student belonged to, on the dates the
 * student was a member (07, Transfers; decisions 9 and 10). The "Exempt" and
 * "Not assessed" outcomes and the flags are `studentQuarterOutcome` (outcome.ts, task 4.3).
 */
import {
  attendanceValue,
  checkedAttendanceValues,
  type AttendanceMark,
  type AttendanceValues,
} from './attendance.js';
import type { Work } from './daily.js';
import { Fraction } from './fraction.js';
import { gradeOf, type Grade } from './grade.js';
import { CalcInputError, wholeNumberIn } from './input.js';
import { workPercent } from './work.js';

/** The quarterly distribution of the subject and quarter (task 2.1): `ratingExam` is `null` for a subject without one. */
export interface QuarterWeights {
  readonly attendance: number;
  readonly classwork: number;
  readonly homework: number;
  readonly ratingExam: number | null;
}

/** One held lesson of the student in the quarter. */
export interface QuarterLesson {
  /** The attendance mark, `null` while not typed. */
  readonly mark: AttendanceMark | null;
  /** The lesson's classworks. */
  readonly classworks: readonly Work[];
  /** The homeworks checked at the lesson. */
  readonly homeworks: readonly Work[];
}

/** The student's rating exam entry for the quarter. */
export type RatingExamEntry =
  | { readonly kind: 'score'; readonly score: number }
  | { readonly kind: 'did_not_sit' }
  | { readonly kind: 'exempt' }
  | { readonly kind: 'not_held' };

export interface QuarterResultInput {
  readonly weights: QuarterWeights;
  /** The late and skipped values of the quarter. */
  readonly attendanceValues: AttendanceValues;
  readonly lessons: readonly QuarterLesson[];
  /** `null` while there is no entry, also for "exempt on exam day, pending". */
  readonly ratingExam: RatingExamEntry | null;
  /** Whether the quarter is closed, read by the caller from its stored state. */
  readonly quarterClosed: boolean;
}

export type QuarterPart = 'attendance' | 'classwork' | 'homework' | 'ratingExam';

/** A weighted part left out of the result, and why. */
export interface LeftOutPart {
  readonly part: QuarterPart;
  readonly reason: 'no_data' | 'exempt' | 'not_held';
}

/** The exact value of each part; `null` for a part with no data or left out. */
export interface QuarterAverages {
  readonly attendance: Fraction | null;
  readonly classwork: Fraction | null;
  readonly homework: Fraction | null;
  readonly ratingExam: Fraction | null;
}

export type QuarterResult =
  | {
      readonly kind: 'number';
      readonly value: Fraction;
      /** The whole number shown, halves up. */
      readonly shown: bigint;
      readonly grade: Grade;
      readonly averages: QuarterAverages;
      readonly leftOut: readonly LeftOutPart[];
      readonly provisional: boolean;
    }
  | { readonly kind: 'no_result'; readonly averages: QuarterAverages };

function checkedWeights(weights: QuarterWeights): Readonly<Record<QuarterPart, bigint | null>> {
  const attendance = wholeNumberIn(weights.attendance, 'weights.attendance', 1n, 100n);
  const classwork = wholeNumberIn(weights.classwork, 'weights.classwork', 1n, 100n);
  const homework = wholeNumberIn(weights.homework, 'weights.homework', 1n, 100n);
  const ratingExam =
    weights.ratingExam === null
      ? null
      : wholeNumberIn(weights.ratingExam, 'weights.ratingExam', 1n, 100n);
  if (attendance + classwork + homework + (ratingExam ?? 0n) !== 100n) {
    throw new CalcInputError('weights_not_100', 'The quarterly distribution totals 100.');
  }
  return { attendance, classwork, homework, ratingExam };
}

/** The attendance value of a lesson for the averages; `null` when it is left out. */
function countedValue(
  lesson: Pick<QuarterLesson, 'mark'>,
  values: AttendanceValues,
): Fraction | 'exempt' | null {
  return lesson.mark === null ? null : attendanceValue(lesson.mark, values);
}

/**
 * The quarter attendance average alone (rule 5), with no weights: also the figure
 * of an attendance-only subject (edge/calculation, "Ma'naviyat soati and the
 * Homework slot"). `null` when no lesson has a value.
 */
export function quarterAttendanceAverage(input: {
  readonly attendanceValues: AttendanceValues;
  readonly lessons: readonly Pick<QuarterLesson, 'mark'>[];
}): Fraction | null {
  checkedAttendanceValues(input.attendanceValues);
  return Fraction.meanOf(
    input.lessons.flatMap((lesson) => {
      const value = countedValue(lesson, input.attendanceValues);
      return value === null || value === 'exempt' ? [] : [value];
    }),
  );
}

/** The exact percents of the works with a number; every total is checked. */
function percentsOf(works: readonly Work[]): Fraction[] {
  return works.flatMap((work) => {
    if (work.score === null) {
      // The total is still checked: a work is passed only with its total set.
      workPercent(0, work.total);
      return [];
    }
    return [workPercent(work.score, work.total)];
  });
}

function ratingPart(entry: RatingExamEntry): Fraction | 'exempt' | 'not_held' {
  switch (entry.kind) {
    case 'score':
      return Fraction.whole(wholeNumberIn(entry.score, 'ratingExam.score', 0n, 100n));
    case 'did_not_sit':
      return Fraction.whole(0n);
    case 'exempt':
      return 'exempt';
    case 'not_held':
      return 'not_held';
    default:
      throw new CalcInputError('out_of_range', 'Unknown rating exam entry.');
  }
}

export function quarterResult(input: QuarterResultInput): QuarterResult {
  const weights = checkedWeights(input.weights);
  const attendance = quarterAttendanceAverage(input);

  const classworks: Fraction[] = [];
  const homeworks: Fraction[] = [];
  for (const lesson of input.lessons) {
    const value = countedValue(lesson, input.attendanceValues);
    const lessonClassworks = percentsOf(lesson.classworks);
    const lessonHomeworks = percentsOf(lesson.homeworks);
    if (value === 'exempt') {
      if ([...lesson.classworks, ...lesson.homeworks].some((work) => work.score !== null)) {
        throw new CalcInputError('number_on_exempt_lesson', 'An exempt lesson holds no number.');
      }
      continue;
    }
    classworks.push(...lessonClassworks);
    homeworks.push(...lessonHomeworks);
  }

  if (input.ratingExam !== null && weights.ratingExam === null) {
    throw new CalcInputError(
      'rating_exam_without_weight',
      'A rating exam entry needs a rating part in the quarterly distribution.',
    );
  }
  const rating = input.ratingExam === null ? null : ratingPart(input.ratingExam);

  const averages: QuarterAverages = {
    attendance,
    classwork: Fraction.meanOf(classworks),
    homework: Fraction.meanOf(homeworks),
    ratingExam: rating instanceof Fraction ? rating : null,
  };

  const leftOut: LeftOutPart[] = [];
  let weighted = Fraction.whole(0n);
  let weightSum = 0n;
  for (const part of ['attendance', 'classwork', 'homework', 'ratingExam'] as const) {
    const weight = weights[part];
    if (weight === null) continue;
    const value = averages[part];
    if (value === null) {
      const reason =
        part === 'ratingExam' && (rating === 'exempt' || rating === 'not_held')
          ? rating
          : 'no_data';
      leftOut.push({ part, reason });
      continue;
    }
    weighted = weighted.add(Fraction.whole(weight).mul(value));
    weightSum += weight;
  }
  if (weightSum === 0n) return { kind: 'no_result', averages };

  const value = weighted.div(Fraction.whole(weightSum));
  return {
    kind: 'number',
    value,
    shown: value.roundHalfUp(),
    grade: gradeOf(value),
    averages,
    leftOut,
    provisional: !input.quarterClosed && leftOut.some(({ reason }) => reason === 'no_data'),
  };
}
