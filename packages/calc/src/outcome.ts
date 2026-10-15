/**
 * The outcome of one student's quarter in one graded subject: one of the result states of
 * docs/spec/edge-cases/00-definitions.md (a number, "Exempt", "Not assessed", "No result"), with
 * the flags the Academic Vice Principal decides at closing (task 4.3).
 *
 * - "Exempt" by itself when the student had at least one lesson and every one was exempt (mark
 *   4 or 5), whatever the rating entry (docs/spec/07-journal.md, Exemptions, Effect on totals:
 *   "If none remain, the result is 'Exempt': no number and no grade"; decision 1).
 * - "No result" when no part has data (edge/calculation, "Nothing at all was entered").
 * - The flags on a number (edge/calculation):
 *   - `few_lessons` when n × 3 < N, n being the lessons the student was expected at (not
 *     exempt) and N the lessons held in the student's journals (decisions 2 and 10);
 *   - `attendance_only` when no classwork number, no homework number and no rating score was
 *     used: "did not sit" assesses nothing (decision 4);
 *   - `left_subject` when the student moved to a class without the subject (decision 5).
 *   A result at leaving raises none: the student is left out of the closing checklist
 *   (decision 6), and its date wins over a "left the subject" date (decision 12).
 * - One decision per student, subject and quarter covers every flag raised: `keep` and
 *   `not_assessed` for any flag, `exempt` only with `few_lessons` when the exemption explains it,
 *   (n + e) × 3 ≥ N. A decision the current data does not allow is not applied and reported as
 *   `staleDecision`; it never throws, so a stored decision stays readable (decision 3).
 * - The start quarter's "from <date>" label is carried on every outcome. No dated lessons exist
 *   before the branch's start date (edge/academic-year), so the lessons and N passed are
 *   already counted from it (decision 7).
 *
 * Only a graded subject comes here: an attendance-only subject has no result (task 4.1,
 * decision 13; `quarterAttendanceAverage`).
 */
import type { Fraction } from './fraction.js';
import { CalcInputError, wholeNumber } from './input.js';
import { quarterResult, type QuarterResult, type QuarterResultInput } from './quarter.js';
import type { QuarterOutcome } from './year.js';

export type FlagDecision = 'keep' | 'exempt' | 'not_assessed';

export type ResultFlag = 'few_lessons' | 'attendance_only' | 'left_subject';

export interface StudentQuarterInput extends QuarterResultInput {
  /**
   * N: the lessons held in the subject during the quarter, for each school day in the journal
   * the student belonged to that day; before the first membership and in a gap, the journal of
   * the next membership; after leaving the subject or the branch, none (decision 10).
   */
  readonly heldInJournals: number;
  /** The branch's start date (`YYYY-MM-DD`) when it falls inside this quarter. */
  readonly countsFrom: string | null;
  /** The date of a move to a class that does not study the subject. */
  readonly leftSubjectOn: string | null;
  /** The date of leaving the school or of a move to another branch: a result at leaving. */
  readonly atLeaving: string | null;
  /** The Academic Vice Principal's decision on a flagged result. */
  readonly decision: FlagDecision | null;
}

export type QuarterNumber = Extract<QuarterResult, { kind: 'number' }>;

interface OutcomeLabels {
  /** "based on n of N lessons". */
  readonly basedOn: { readonly expected: number; readonly held: number };
  readonly from: string | null;
  readonly leftSubjectOn: string | null;
  readonly atLeaving: string | null;
  readonly flags: readonly ResultFlag[];
  /** A decision was given that the current data does not allow; it is not applied. */
  readonly staleDecision: boolean;
}

export type StudentQuarterOutcome =
  | (OutcomeLabels & {
      readonly kind: 'number';
      readonly result: QuarterNumber;
      /** `keep` when a flagged result was kept, else `null`. */
      readonly decision: 'keep' | null;
      /** A flag is raised and no decision applies: blocks closing. */
      readonly undecided: boolean;
    })
  | (OutcomeLabels & {
      readonly kind: 'exempt';
      readonly cause: 'no_lesson_remains' | 'decided';
    })
  | (OutcomeLabels & { readonly kind: 'not_assessed' })
  | (OutcomeLabels & { readonly kind: 'no_result' });

/** The days of each month in a year that is not a leap year. */
const DAYS_IN_MONTH: Readonly<Record<string, bigint>> = {
  '01': 31n,
  '02': 28n,
  '03': 31n,
  '04': 30n,
  '05': 31n,
  '06': 30n,
  '07': 31n,
  '08': 31n,
  '09': 30n,
  '10': 31n,
  '11': 30n,
  '12': 31n,
};

/** A real calendar day as `YYYY-MM-DD`, or `null`; checked with whole numbers only. */
function checkedDate(value: string | null, name: string): string | null {
  if (value === null) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const [, yearText, monthText, dayText] = parts ?? [];
  const monthDays = monthText === undefined ? undefined : DAYS_IN_MONTH[monthText];
  if (yearText === undefined || dayText === undefined || monthDays === undefined) {
    throw new CalcInputError('not_a_date', `${name} must be a YYYY-MM-DD date.`);
  }
  const year = BigInt(yearText);
  const day = BigInt(dayText);
  const leap = year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n);
  const last = monthText === '02' && leap ? 29n : monthDays;
  if (day < 1n || day > last) {
    throw new CalcInputError('not_a_date', `${name} is not a day of the calendar.`);
  }
  return value;
}

function checkedDecision(decision: FlagDecision | null): FlagDecision | null {
  if (decision === null || decision === 'keep' || decision === 'exempt') return decision;
  if (decision === 'not_assessed') return decision;
  throw new CalcInputError('out_of_range', `Unknown decision ${String(decision)}.`);
}

export function studentQuarterOutcome(input: StudentQuarterInput): StudentQuarterOutcome {
  const held = wholeNumber(input.heldInJournals, 'heldInJournals');
  if (held < 0n) {
    throw new CalcInputError('out_of_range', 'heldInJournals must be 0 or more.');
  }
  if (BigInt(input.lessons.length) > held) {
    throw new CalcInputError('lessons_above_held', 'More lessons than held in the journals.');
  }
  const from = checkedDate(input.countsFrom, 'countsFrom');
  const leftSubjectOn = checkedDate(input.leftSubjectOn, 'leftSubjectOn');
  const atLeaving = checkedDate(input.atLeaving, 'atLeaving');
  const decision = checkedDecision(input.decision);

  // Every input is checked by `quarterResult`, also when the outcome is "Exempt".
  const result = quarterResult(input);

  const exemptCount = input.lessons.filter(({ mark }) => mark === 4 || mark === 5).length;
  const expected = input.lessons.length - exemptCount;
  const n = BigInt(expected);
  const e = BigInt(exemptCount);
  const labels = {
    basedOn: { expected, held: input.heldInJournals },
    from,
    leftSubjectOn,
    atLeaving,
  };

  if (input.lessons.length > 0 && expected === 0) {
    return {
      ...labels,
      kind: 'exempt',
      cause: 'no_lesson_remains',
      flags: [],
      staleDecision: decision !== null,
    };
  }
  if (result.kind === 'no_result') {
    return { ...labels, kind: 'no_result', flags: [], staleDecision: decision !== null };
  }

  const flags: ResultFlag[] = [];
  if (atLeaving === null) {
    if (n * 3n < held) flags.push('few_lessons');
    const assessed =
      result.averages.classwork !== null ||
      result.averages.homework !== null ||
      input.ratingExam?.kind === 'score';
    if (!assessed) flags.push('attendance_only');
    if (leftSubjectOn !== null) flags.push('left_subject');
  }

  const allowed =
    decision !== null &&
    flags.length > 0 &&
    (decision !== 'exempt' || (flags.includes('few_lessons') && (n + e) * 3n >= held));

  if (allowed && decision === 'exempt') {
    return { ...labels, kind: 'exempt', cause: 'decided', flags, staleDecision: false };
  }
  if (allowed && decision === 'not_assessed') {
    return { ...labels, kind: 'not_assessed', flags, staleDecision: false };
  }
  return {
    ...labels,
    kind: 'number',
    result,
    flags,
    decision: allowed ? 'keep' : null,
    undecided: flags.length > 0 && !allowed,
    staleDecision: decision !== null && !allowed,
  };
}

/** The outcome as `yearResult` takes it: only a number counts (07 rule 11, Effect on totals). */
export function outcomeForYear(outcome: StudentQuarterOutcome): QuarterOutcome {
  switch (outcome.kind) {
    case 'number':
      return outcome.result.value satisfies Fraction;
    case 'exempt':
      return 'exempt';
    case 'not_assessed':
      return 'not_assessed';
    case 'no_result':
      return 'no_result';
    default:
      throw new CalcInputError('out_of_range', 'Unknown outcome.');
  }
}
