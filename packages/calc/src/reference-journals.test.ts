import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AttendanceMark } from './attendance.js';
import { Fraction } from './fraction.js';
import {
  quarterResult,
  type LeftOutPart,
  type QuarterLesson,
  type QuarterResultInput,
  type RatingExamEntry,
} from './quarter.js';
import { yearResult, type QuarterOutcome } from './year.js';

// docs/spec/14-quality-plan.md, Journal, "Reference journals": every file of the folder is
// reproduced "to the last point". The format is in reference-journals/README.md.
const directory = new URL('../reference-journals/', import.meta.url);
const files = readdirSync(directory).filter((name) => name.endsWith('.json'));

class FormatError extends Error {}

function fail(path: string, expected: string): never {
  throw new FormatError(`${path}: expected ${expected}`);
}

type Json = unknown;

function record(value: Json, path: string, allowed: readonly string[]): Record<string, Json> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'an object');
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) fail(`${path}.${unknown}`, `one of ${allowed.join(', ')}`);
  return value as Record<string, Json>;
}

function list(value: Json, path: string): Json[] {
  if (!Array.isArray(value)) fail(path, 'a list');
  return value;
}

function whole(value: Json, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(path, 'a whole number');
  return value;
}

function text(value: Json, path: string): string {
  if (typeof value !== 'string' || value === '') fail(path, 'a text');
  return value;
}

function bool(value: Json, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'true or false');
  return value;
}

/**
 * An exact figure: a decimal that ends or a fraction, read with `bigint` only, never
 * through a JS number (correction 1 of the plan review).
 */
function exact(value: Json, path: string): Fraction {
  const figure = text(value, path);
  const asFraction = /^(\d+)\/(\d+)$/.exec(figure);
  if (asFraction) {
    const [, num = '', den = ''] = asFraction;
    if (BigInt(den) === 0n) fail(path, 'a fraction with a denominator above 0');
    return Fraction.of(BigInt(num), BigInt(den));
  }
  const asDecimal = /^(\d+)(?:\.(\d+))?$/.exec(figure);
  if (asDecimal) {
    const [, units = '', decimals = ''] = asDecimal;
    return Fraction.of(BigInt(units + decimals), 10n ** BigInt(decimals.length));
  }
  return fail(path, `an exact figure such as "49.475" or "148/3", got "${figure}"`);
}

function exactOrNull(value: Json, path: string): Fraction | null {
  return value === null ? null : exact(value, path);
}

function wholeOrNull(value: Json, path: string): number | null {
  return value === null ? null : whole(value, path);
}

function works(value: Json, path: string) {
  return list(value, path).map((item, index) => {
    const pair = list(item, `${path}[${index}]`);
    if (pair.length !== 2) fail(`${path}[${index}]`, '[number, total]');
    return {
      score: wholeOrNull(pair[0], `${path}[${index}][0]`),
      total: whole(pair[1], `${path}[${index}][1]`),
    };
  });
}

function lesson(value: Json, path: string): QuarterLesson {
  const item = record(value, path, ['mark', 'classworks', 'homeworks']);
  const mark = wholeOrNull(item.mark, `${path}.mark`);
  if (mark !== null && (mark < 0 || mark > 5)) fail(`${path}.mark`, 'a mark from 0 to 5');
  return {
    mark: mark as AttendanceMark | null,
    classworks: works(item.classworks, `${path}.classworks`),
    homeworks: works(item.homeworks, `${path}.homeworks`),
  };
}

function ratingExam(value: Json, path: string): RatingExamEntry | null {
  if (value === null) return null;
  const entry = record(value, path, ['kind', 'score']);
  switch (entry.kind) {
    case 'score':
      return { kind: 'score', score: whole(entry.score, `${path}.score`) };
    case 'did_not_sit':
    case 'exempt':
    case 'not_held':
      return { kind: entry.kind };
    default:
      return fail(`${path}.kind`, '"score", "did_not_sit", "exempt" or "not_held"');
  }
}

function leftOut(value: Json, path: string): LeftOutPart[] {
  return list(value, path).map((item, index) => {
    const part = record(item, `${path}[${index}]`, ['part', 'reason']);
    if (!['attendance', 'classwork', 'homework', 'ratingExam'].includes(String(part.part))) {
      fail(`${path}[${index}].part`, 'attendance, classwork, homework or ratingExam');
    }
    if (!['no_data', 'exempt', 'not_held'].includes(String(part.reason))) {
      fail(`${path}[${index}].reason`, 'no_data, exempt or not_held');
    }
    return part as unknown as LeftOutPart;
  });
}

function checkHeader(file: Record<string, Json>): void {
  text(file.title, 'title');
  text(file.source, 'source');
  if (file.status !== 'sample' && file.status !== 'signed off')
    fail('status', '"sample" or "signed off"');
}

interface Case {
  name: string;
  run: () => void;
}

function expectFigure(actual: Fraction | null, expected: Fraction | null, label: string): void {
  expect(actual === null ? null : `${actual.num}/${actual.den}`, label).toBe(
    expected === null ? null : `${expected.num}/${expected.den}`,
  );
}

function quarterCases(file: Record<string, Json>): Case[] {
  const weights = record(file.weights, 'weights', [
    'attendance',
    'classwork',
    'homework',
    'ratingExam',
  ]);
  const values = record(file.attendanceValues, 'attendanceValues', ['lateValue', 'skippedValue']);
  const base = {
    weights: {
      attendance: whole(weights.attendance, 'weights.attendance'),
      classwork: whole(weights.classwork, 'weights.classwork'),
      homework: whole(weights.homework, 'weights.homework'),
      ratingExam: wholeOrNull(weights.ratingExam, 'weights.ratingExam'),
    },
    attendanceValues: {
      lateValue: whole(values.lateValue, 'attendanceValues.lateValue'),
      skippedValue: whole(values.skippedValue, 'attendanceValues.skippedValue'),
    },
    quarterClosed: bool(file.quarterClosed, 'quarterClosed'),
  };
  const students = list(file.students, 'students');
  if (students.length === 0) fail('students', 'at least one student');
  return students.map((value, index) => {
    const path = `students[${index}]`;
    const student = record(value, path, ['name', 'lessons', 'ratingExam', 'expected']);
    const name = text(student.name, `${path}.name`);
    const input: QuarterResultInput = {
      ...base,
      lessons: list(student.lessons, `${path}.lessons`).map((item, at) =>
        lesson(item, `${path}.lessons[${at}]`),
      ),
      ratingExam: ratingExam(student.ratingExam, `${path}.ratingExam`),
    };
    const want = record(student.expected, `${path}.expected`, [
      'attendance',
      'classwork',
      'homework',
      'ratingExam',
      'result',
      'shown',
      'grade',
      'leftOut',
      'provisional',
    ]);
    const expected = {
      attendance: exactOrNull(want.attendance, `${path}.expected.attendance`),
      classwork: exactOrNull(want.classwork, `${path}.expected.classwork`),
      homework: exactOrNull(want.homework, `${path}.expected.homework`),
      ratingExam: exactOrNull(want.ratingExam, `${path}.expected.ratingExam`),
      result: exactOrNull(want.result, `${path}.expected.result`),
      shown: wholeOrNull(want.shown, `${path}.expected.shown`),
      grade: wholeOrNull(want.grade, `${path}.expected.grade`),
      leftOut: leftOut(want.leftOut, `${path}.expected.leftOut`),
      provisional: bool(want.provisional, `${path}.expected.provisional`),
    };
    return {
      name,
      run: () => {
        const result = quarterResult(input);
        expectFigure(result.averages.attendance, expected.attendance, 'attendance');
        expectFigure(result.averages.classwork, expected.classwork, 'classwork');
        expectFigure(result.averages.homework, expected.homework, 'homework');
        expectFigure(result.averages.ratingExam, expected.ratingExam, 'ratingExam');
        if (result.kind === 'number') {
          expectFigure(result.value, expected.result, 'result');
          expect(result.shown, 'shown').toBe(
            expected.shown === null ? null : BigInt(expected.shown),
          );
          expect(result.grade, 'grade').toBe(expected.grade);
          expect(result.leftOut, 'leftOut').toEqual(expected.leftOut);
          expect(result.provisional, 'provisional').toBe(expected.provisional);
        } else {
          // "No result" carries no figure, no marker and is never provisional (README).
          expect(expected.result, 'result').toBeNull();
          expect([expected.shown, expected.grade], 'shown and grade').toEqual([null, null]);
          expect(expected.leftOut, 'leftOut').toEqual([]);
          expect(expected.provisional, 'provisional').toBe(false);
        }
      },
    };
  });
}

const QUARTER_STATES = ['exempt', 'not_assessed', 'no_result', 'not_in_system', 'not_official'];

function yearCases(file: Record<string, Json>): Case[] {
  const year = record(file.year, 'year', ['quarters', 'expected']);
  const quarters: QuarterOutcome[] = list(year.quarters, 'year.quarters').map((value, index) =>
    typeof value === 'string' && QUARTER_STATES.includes(value)
      ? (value as QuarterOutcome)
      : exact(value, `year.quarters[${index}]`),
  );
  const want = record(year.expected, 'year.expected', ['result', 'shown', 'grade', 'basedOn']);
  const expected = {
    result: exactOrNull(want.result, 'year.expected.result'),
    shown: wholeOrNull(want.shown, 'year.expected.shown'),
    grade: wholeOrNull(want.grade, 'year.expected.grade'),
    basedOn: wholeOrNull(want.basedOn, 'year.expected.basedOn'),
  };
  return [
    {
      name: 'year',
      run: () => {
        const result = yearResult(quarters);
        if (result.kind === 'number') {
          expectFigure(result.value, expected.result, 'result');
          expect(result.shown, 'shown').toBe(
            expected.shown === null ? null : BigInt(expected.shown),
          );
          expect(result.grade, 'grade').toBe(expected.grade);
          expect(result.basedOn, 'basedOn').toBe(expected.basedOn);
        } else {
          expect(expected, 'no result').toEqual({
            result: null,
            shown: null,
            grade: null,
            basedOn: null,
          });
        }
      },
    },
  ];
}

function casesOf(value: Json): Case[] {
  const header = ['title', 'source', 'status'];
  const top = record(value, 'the file', [
    ...header,
    'year',
    'weights',
    'attendanceValues',
    'quarterClosed',
    'students',
  ]);
  const file =
    'year' in top
      ? record(top, 'the file', [...header, 'year'])
      : record(top, 'the file', [
          ...header,
          'weights',
          'attendanceValues',
          'quarterClosed',
          'students',
        ]);
  checkHeader(file);
  return 'year' in file ? yearCases(file) : quarterCases(file);
}

describe('reference journals', () => {
  it('has the samples to run', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        '07-worked-example.json',
        'boundary-49-5.json',
        'year-50-50-49-50.json',
      ]),
    );
  });

  describe.each(files)('%s', (name) => {
    const cases = casesOf(JSON.parse(readFileSync(new URL(name, directory), 'utf8')) as Json);
    it.each(cases.map((item) => [item.name, item] as const))('reproduces %s', (_name, item) => {
      item.run();
    });
  });

  it('refuses a file that does not follow the format, with the place and what was expected', () => {
    const valid = JSON.parse(
      readFileSync(new URL('07-worked-example.json', directory), 'utf8'),
    ) as Record<string, Json>;
    expect(() => casesOf({ ...valid, status: 'draft' })).toThrow(
      'status: expected "sample" or "signed off"',
    );
    expect(() =>
      casesOf({
        ...valid,
        weights: { ...(valid.weights as Record<string, Json>), homework: 20.5 },
      }),
    ).toThrow('weights.homework: expected a whole number');
    const student = list(valid.students, 's')[0] as Record<string, Json>;
    const expected = student.expected as Record<string, Json>;
    expect(() =>
      casesOf({ ...valid, students: [{ ...student, expected: { ...expected, result: '55,6' } }] }),
    ).toThrow('students[0].expected.result: expected an exact figure');
    expect(() =>
      casesOf({ ...valid, students: [{ ...student, expected: { ...expected, result: 55.6 } }] }),
    ).toThrow('students[0].expected.result: expected a text');
    const lesson = list(student.lessons, 'l')[0] as Record<string, Json>;
    expect(() =>
      casesOf({
        ...valid,
        students: [{ ...student, lessons: [{ ...lesson, countsForAtendance: false }] }],
      }),
    ).toThrow('students[0].lessons[0].countsForAtendance: expected one of');
  });

  it('reads exact figures without floating point', () => {
    expect(exact('49.475', 'x').equals(Fraction.of(1979n, 40n))).toBe(true);
    expect(exact('148/3', 'x').equals(Fraction.of(148n, 3n))).toBe(true);
    expect(exact('100', 'x').equals(Fraction.whole(100n))).toBe(true);
    expect(() => exact('1e2', 'x')).toThrow(FormatError);
    expect(() => exact('.5', 'x')).toThrow(FormatError);
  });
});
