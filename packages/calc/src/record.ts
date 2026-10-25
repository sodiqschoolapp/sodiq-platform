/**
 * The stored form of a final quarter result, and the "recalculate and compare" check
 * (docs/spec/edge-cases/calculation.md, "A bug is found after results were closed and exported":
 * "The calculation module has a version, stored with every final result. A 'recalculate and
 * compare' tool lists the differences without changing anything"; task 4.3).
 *
 * A record holds the six items of docs/spec/edge-cases/developer-rules.md, Calculation ("Stored
 * per final result: the inputs, the exact result, the rounded result, the grade, the settings used
 * and the calculation module's version"): `inputs` (the settings used are its `weights` and
 * `attendanceValues`), the outcome's `result.value`, `result.shown` and `result.grade` when it is a
 * number, and `moduleVersion`. It is plain JSON: a fraction is `{ num, den }`, the decimal strings
 * of the reduced `bigint`s, a `bigint` is its decimal string, so nothing passes through a float
 * (task 4.3, decision 13). `format: 1` names this shape, which is frozen: a later shape is
 * format 2, with a reader for format 1. (Task 3.6c-1, decision 10, took `countsForAttendance` out of
 * a lesson in place, before any record was stored; a lesson holds only `mark`, `classworks` and
 * `homeworks`.) `recalculateAndCompare` lists a record the current
 * module refuses (`refused`, its code) instead of throwing, so a check over many records goes on.
 *
 * Two kinds (decisions 6 and 8):
 * - `closing`, made when the quarter is closed: refused for an open quarter, for a flag that is
 *   undecided or carries a stale decision (the closing checklist lists it as "decision outdated:
 *   clear it or decide again", review of the plan, correction 1; 9.2a), and for a rating subject
 *   with no rating exam entry, "exempt on exam day, pending" included (07 rule 8), and for a
 *   student with a leaving date, who is not on the checklist (`final_record_at_leaving`);
 * - `at_leaving`, the "result at leaving", stored when the student leaves the school or the
 *   branch while the quarter is open; the student is not on the closing checklist, so none of
 *   the closing refusals apply.
 */
import type { AttendanceMark } from './attendance.js';
import { Fraction } from './fraction.js';
import { CalcInputError, type CalcInputErrorCode } from './input.js';
import type { Grade } from './grade.js';
import {
  studentQuarterOutcome,
  type QuarterNumber,
  type ResultFlag,
  type StudentQuarterInput,
  type StudentQuarterOutcome,
} from './outcome.js';
import type {
  LeftOutPart,
  QuarterAverages,
  QuarterLesson,
  QuarterPart,
  RatingExamEntry,
} from './quarter.js';
import type { Work } from './daily.js';
import { CALC_VERSION } from './version.js';

export type StoredValue =
  | string
  | number
  | boolean
  | null
  | readonly StoredValue[]
  | { readonly [key: string]: StoredValue };

export type RecordKind = 'closing' | 'at_leaving';

export interface FinalQuarterRecord {
  readonly format: 1;
  readonly kind: RecordKind;
  readonly moduleVersion: number;
  readonly inputs: StudentQuarterInput;
  readonly outcome: StoredValue;
}

export interface Comparison {
  readonly storedVersion: number;
  readonly currentVersion: number;
  readonly same: boolean;
  /** The paths in the outcome whose stored value differs from the value calculated now. */
  readonly differences: readonly string[];
  readonly stored: StoredValue;
  /** The outcome calculated now; `null` when the current module refuses the stored inputs. */
  readonly now: StoredValue | null;
  /** The code the current module refuses the stored inputs with, else `null`. */
  readonly refused: CalcInputErrorCode | null;
}

/** A value of the module as plain JSON: a fraction as `{ num, den }`, a `bigint` as a string. */
function stored(value: unknown): StoredValue {
  if (value instanceof Fraction) return { num: value.num.toString(), den: value.den.toString() };
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(stored);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stored(item)]));
  }
  throw new CalcInputError('record_shape', 'A value that cannot be stored.');
}

function shapeError(path: string): CalcInputError {
  return new CalcInputError('record_shape', `The stored record is not format 1 at ${path}.`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (!isObject(value)) throw shapeError(path);
  return value;
}

function numberAt(value: unknown, path: string): number {
  if (typeof value !== 'number') throw shapeError(path);
  return value;
}

function numberOrNullAt(value: unknown, path: string): number | null {
  return value === null ? null : numberAt(value, path);
}

function stringOrNullAt(value: unknown, path: string): string | null {
  if (value !== null && typeof value !== 'string') throw shapeError(path);
  return value;
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw shapeError(path);
  return value;
}

function arrayAt(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw shapeError(path);
  return value;
}

function isMark(value: unknown): value is AttendanceMark {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function worksAt(value: unknown, path: string): Work[] {
  return arrayAt(value, path).map((item, index) => {
    const work = objectAt(item, `${path}[${index}]`);
    return {
      score: numberOrNullAt(work.score, `${path}[${index}].score`),
      total: numberAt(work.total, `${path}[${index}].total`),
    };
  });
}

const LESSON_KEYS: ReadonlySet<string> = new Set(['mark', 'classworks', 'homeworks']);

function lessonsAt(value: unknown, path: string): QuarterLesson[] {
  return arrayAt(value, path).map((item, index) => {
    const at = `${path}[${index}]`;
    const lesson = objectAt(item, at);
    for (const key of Object.keys(lesson)) {
      if (!LESSON_KEYS.has(key)) throw shapeError(`${at}.${key}`);
    }
    const mark = lesson.mark;
    if (mark !== null && !isMark(mark)) throw shapeError(`${at}.mark`);
    return {
      mark,
      classworks: worksAt(lesson.classworks, `${at}.classworks`),
      homeworks: worksAt(lesson.homeworks, `${at}.homeworks`),
    };
  });
}

function ratingAt(value: unknown, path: string): RatingExamEntry | null {
  if (value === null) return null;
  const entry = objectAt(value, path);
  switch (entry.kind) {
    case 'score':
      return { kind: 'score', score: numberAt(entry.score, `${path}.score`) };
    case 'did_not_sit':
    case 'exempt':
    case 'not_held':
      return { kind: entry.kind };
    default:
      throw shapeError(`${path}.kind`);
  }
}

function decisionAt(value: unknown, path: string): StudentQuarterInput['decision'] {
  if (value === null || value === 'keep' || value === 'exempt' || value === 'not_assessed') {
    return value;
  }
  throw shapeError(path);
}

/**
 * The inputs read from an unknown value, field by field, as a new object: the shape only; the
 * values are checked by the calculation itself.
 */
function inputsAt(value: unknown, path: string): StudentQuarterInput {
  const inputs = objectAt(value, path);
  const weights = objectAt(inputs.weights, `${path}.weights`);
  const values = objectAt(inputs.attendanceValues, `${path}.attendanceValues`);
  return {
    weights: {
      attendance: numberAt(weights.attendance, `${path}.weights.attendance`),
      classwork: numberAt(weights.classwork, `${path}.weights.classwork`),
      homework: numberAt(weights.homework, `${path}.weights.homework`),
      ratingExam: numberOrNullAt(weights.ratingExam, `${path}.weights.ratingExam`),
    },
    attendanceValues: {
      lateValue: numberAt(values.lateValue, `${path}.attendanceValues.lateValue`),
      skippedValue: numberAt(values.skippedValue, `${path}.attendanceValues.skippedValue`),
    },
    lessons: lessonsAt(inputs.lessons, `${path}.lessons`),
    ratingExam: ratingAt(inputs.ratingExam, `${path}.ratingExam`),
    quarterClosed: booleanAt(inputs.quarterClosed, `${path}.quarterClosed`),
    heldInJournals: numberAt(inputs.heldInJournals, `${path}.heldInJournals`),
    countsFrom: stringOrNullAt(inputs.countsFrom, `${path}.countsFrom`),
    leftSubjectOn: stringOrNullAt(inputs.leftSubjectOn, `${path}.leftSubjectOn`),
    atLeaving: stringOrNullAt(inputs.atLeaving, `${path}.atLeaving`),
    decision: decisionAt(inputs.decision, `${path}.decision`),
  };
}

export function finalQuarterRecord(
  input: StudentQuarterInput,
  kind: RecordKind,
): FinalQuarterRecord {
  // A copy, so a later change of the caller's objects never reaches the record.
  const inputs = inputsAt(input, 'inputs');
  const outcome = studentQuarterOutcome(inputs);
  if (kind === 'at_leaving') {
    if (inputs.atLeaving === null) {
      throw new CalcInputError('final_record_not_leaving', 'A result at leaving needs its date.');
    }
  } else {
    // A student who left is not on the closing checklist (decision 6): a closing record would
    // skip the flags without a word.
    if (inputs.atLeaving !== null) {
      throw new CalcInputError('final_record_at_leaving', 'A result at leaving is not closed.');
    }
    if (!inputs.quarterClosed) {
      throw new CalcInputError('final_record_open_quarter', 'The quarter is not closed.');
    }
    if (outcome.staleDecision || (outcome.kind === 'number' && outcome.undecided)) {
      throw new CalcInputError(
        'final_record_undecided',
        'A flagged result is undecided, or its decision is outdated: clear it or decide again.',
      );
    }
    if (inputs.weights.ratingExam !== null && inputs.ratingExam === null) {
      throw new CalcInputError('final_record_rating_missing', 'The rating exam entry is missing.');
    }
  }
  return { format: 1, kind, moduleVersion: CALC_VERSION, inputs, outcome: stored(outcome) };
}

function isList(value: StoredValue): value is readonly StoredValue[] {
  return Array.isArray(value);
}

function isRecord(value: StoredValue): value is { readonly [key: string]: StoredValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The paths below `path` where the two stored values differ. */
function differencesOf(before: StoredValue, after: StoredValue, path: string): string[] {
  if (isList(before) && isList(after)) {
    const length = before.length > after.length ? before.length : after.length;
    return Array.from({ length }, (_, index) =>
      differencesOf(before[index] ?? null, after[index] ?? null, `${path}[${index}]`),
    ).flat();
  }
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) =>
      // A key on one side only is a difference: a stored record that lost a field is not "same".
      key in before && key in after
        ? differencesOf(
            before[key] ?? null,
            after[key] ?? null,
            path === '' ? key : `${path}.${key}`,
          )
        : [path === '' ? key : `${path}.${key}`],
    );
  }
  return before === after ? [] : [path === '' ? '(outcome)' : path];
}

function storedValueAt(value: unknown, path: string): StoredValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  if (Array.isArray(value))
    return value.map((item, index) => storedValueAt(item, `${path}[${index}]`));
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, storedValueAt(item, `${path}.${key}`)]),
    );
  }
  throw shapeError(path);
}

/**
 * Recalculates a stored record with the current module and lists the differences. It reads
 * the record (from `jsonb`) as an unknown value, checks its shape first, and changes nothing.
 */
export function recalculateAndCompare(record: unknown): Comparison {
  const value = objectAt(record, 'record');
  if (value.format !== 1) throw shapeError('format');
  if (value.kind !== 'closing' && value.kind !== 'at_leaving') throw shapeError('kind');
  const storedVersion = numberAt(value.moduleVersion, 'moduleVersion');
  if (!Number.isSafeInteger(storedVersion) || storedVersion < 1) throw shapeError('moduleVersion');
  const inputs = inputsAt(value.inputs, 'inputs');
  // The kind agrees with the inputs, as `finalQuarterRecord` made it.
  if ((value.kind === 'at_leaving') !== (inputs.atLeaving !== null)) throw shapeError('kind');
  if (value.kind === 'closing' && !inputs.quarterClosed) throw shapeError('kind');
  const before = storedValueAt(value.outcome, 'outcome');
  let now: StoredValue;
  try {
    now = stored(studentQuarterOutcome(inputs));
  } catch (error) {
    // The nightly check over many records lists a refused one and goes on (9.2c).
    if (!(error instanceof CalcInputError)) throw error;
    return {
      storedVersion,
      currentVersion: CALC_VERSION,
      same: false,
      differences: ['(refused)'],
      stored: before,
      now: null,
      refused: error.code,
    };
  }
  const differences = differencesOf(before, now, '');
  return {
    storedVersion,
    currentVersion: CALC_VERSION,
    same: differences.length === 0,
    differences,
    stored: before,
    now,
    refused: null,
  };
}

const FLAGS: ReadonlySet<string> = new Set(['few_lessons', 'attendance_only', 'left_subject']);
const PARTS: ReadonlySet<string> = new Set(['attendance', 'classwork', 'homework', 'ratingExam']);
const LEFT_OUT_REASONS: ReadonlySet<string> = new Set(['no_data', 'exempt', 'not_held']);

/** A stored decimal string of a `bigint`. */
function bigintAt(value: unknown, path: string): bigint {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) throw shapeError(path);
  return BigInt(value);
}

function fractionAt(value: unknown, path: string): Fraction {
  const stored = objectAt(value, path);
  const den = bigintAt(stored.den, `${path}.den`);
  if (den <= 0n) throw shapeError(`${path}.den`);
  return Fraction.of(bigintAt(stored.num, `${path}.num`), den);
}

function fractionOrNullAt(value: unknown, path: string): Fraction | null {
  return value === null ? null : fractionAt(value, path);
}

function averagesAt(value: unknown, path: string): QuarterAverages {
  const averages = objectAt(value, path);
  return {
    attendance: fractionOrNullAt(averages.attendance, `${path}.attendance`),
    classwork: fractionOrNullAt(averages.classwork, `${path}.classwork`),
    homework: fractionOrNullAt(averages.homework, `${path}.homework`),
    ratingExam: fractionOrNullAt(averages.ratingExam, `${path}.ratingExam`),
  };
}

function gradeAt(value: unknown, path: string): Grade {
  if (value === 2 || value === 3 || value === 4 || value === 5) return value;
  throw shapeError(path);
}

function numberResultAt(value: unknown, path: string): QuarterNumber {
  const result = objectAt(value, path);
  if (result.kind !== 'number') throw shapeError(`${path}.kind`);
  return {
    kind: 'number',
    value: fractionAt(result.value, `${path}.value`),
    shown: bigintAt(result.shown, `${path}.shown`),
    grade: gradeAt(result.grade, `${path}.grade`),
    averages: averagesAt(result.averages, `${path}.averages`),
    leftOut: arrayAt(result.leftOut, `${path}.leftOut`).map((item, index): LeftOutPart => {
      const at = `${path}.leftOut[${index}]`;
      const left = objectAt(item, at);
      const { part, reason } = left;
      if (typeof part !== 'string' || !PARTS.has(part)) throw shapeError(`${at}.part`);
      if (typeof reason !== 'string' || !LEFT_OUT_REASONS.has(reason)) {
        throw shapeError(`${at}.reason`);
      }
      return { part: part as QuarterPart, reason: reason as LeftOutPart['reason'] };
    }),
    provisional: booleanAt(result.provisional, `${path}.provisional`),
  };
}

/**
 * The outcome stored in a final record, read back as the module's value (task 9.2b, review
 * decision 1, Look first): a closed quarter's figures are read from here, never calculated again,
 * so a later release never changes a closed result silently (`edge/calculation`, "A bug is found
 * after results were closed and exported"; `07`: "the results are stored as final"). The record is
 * read as an unknown value from `jsonb`, its shape checked field by field (`record_shape`); the
 * values are the ones the module stored, the nightly check (9.2c) compares them with the inputs.
 */
export function storedQuarterOutcome(record: unknown): StudentQuarterOutcome {
  const value = objectAt(record, 'record');
  if (value.format !== 1) throw shapeError('format');
  if (value.kind !== 'closing' && value.kind !== 'at_leaving') throw shapeError('kind');
  const outcome = objectAt(value.outcome, 'outcome');
  const basedOn = objectAt(outcome.basedOn, 'outcome.basedOn');
  const flags = arrayAt(outcome.flags, 'outcome.flags').map((flag, index) => {
    if (typeof flag !== 'string' || !FLAGS.has(flag)) throw shapeError(`outcome.flags[${index}]`);
    return flag as ResultFlag;
  });
  const labels = {
    basedOn: {
      expected: numberAt(basedOn.expected, 'outcome.basedOn.expected'),
      held: numberAt(basedOn.held, 'outcome.basedOn.held'),
    },
    from: stringOrNullAt(outcome.from, 'outcome.from'),
    leftSubjectOn: stringOrNullAt(outcome.leftSubjectOn, 'outcome.leftSubjectOn'),
    atLeaving: stringOrNullAt(outcome.atLeaving, 'outcome.atLeaving'),
    flags,
    staleDecision: booleanAt(outcome.staleDecision, 'outcome.staleDecision'),
  };
  switch (outcome.kind) {
    case 'number': {
      const decision = outcome.decision;
      if (decision !== null && decision !== 'keep') throw shapeError('outcome.decision');
      return {
        ...labels,
        kind: 'number',
        result: numberResultAt(outcome.result, 'outcome.result'),
        decision,
        undecided: booleanAt(outcome.undecided, 'outcome.undecided'),
      };
    }
    case 'exempt': {
      const cause = outcome.cause;
      if (cause !== 'no_lesson_remains' && cause !== 'decided') throw shapeError('outcome.cause');
      return { ...labels, kind: 'exempt', cause };
    }
    case 'not_assessed':
      return { ...labels, kind: 'not_assessed' };
    case 'no_result':
      return { ...labels, kind: 'no_result' };
    default:
      throw shapeError('outcome.kind');
  }
}

/**
 * The inputs stored in a final record (task 9.2b), read field by field as `recalculateAndCompare`
 * reads them: the entries, weights and values the quarter was closed with.
 */
export function storedQuarterInputs(record: unknown): StudentQuarterInput {
  const value = objectAt(record, 'record');
  if (value.format !== 1) throw shapeError('format');
  return inputsAt(value.inputs, 'inputs');
}
