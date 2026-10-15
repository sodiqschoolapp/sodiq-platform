import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AttendanceMark } from './attendance.js';
import { lessonScore, type DailyWeights, type LessonScoreInput, type Work } from './daily.js';
import { Fraction } from './fraction.js';
import { CalcInputError } from './input.js';

const VALUES = { lateValue: 50, skippedValue: 0 };

function input(overrides: Partial<LessonScoreInput>): LessonScoreInput {
  return {
    weights: { attendance: 20, classwork: 30, homework: 50 },
    mark: 1,
    attendanceValues: VALUES,
    countsForAttendance: true,
    classworks: [],
    homeworks: [],
    ...overrides,
  };
}

function scoreOf(value: LessonScoreInput): Fraction {
  const result = lessonScore(value);
  if (result.kind !== 'score') throw new Error(`expected a score, got ${result.kind}`);
  return result.value;
}

function expectExactly(actual: Fraction, num: bigint, den = 1n): void {
  expect({ num: actual.num, den: actual.den }).toEqual({ num, den });
}

// docs/spec/07-journal.md, Calculation rules 3 and 4; docs/spec/edge-cases/calculation.md.
describe('lessonScore', () => {
  // edge/calculation, "A result lands exactly on a boundary".
  it('lands exactly on 49.5 for weights 10 · 50 · 40, classworks 10, 10, 25 of 30, homework 29 of 80', () => {
    const score = scoreOf(
      input({
        weights: { attendance: 10, classwork: 50, homework: 40 },
        classworks: [
          { total: 30, score: 10 },
          { total: 30, score: 10 },
          { total: 30, score: 25 },
        ],
        homeworks: [{ total: 80, score: 29 }],
      }),
    );
    expectExactly(score, 99n, 2n);
    expect(score.roundHalfUp()).toBe(50n);
  });

  // edge/calculation, row 1: "Tests include totals of 3, 7 and 30 that land exactly on
  // 49.5, 66.5 and 83.5."
  it.each([
    { weights: [10, 35, 55], classworks: [1, 1], homework: 17, num: 99n, shown: 50n },
    { weights: [10, 35, 55], classworks: [2, 4], homework: 19, num: 133n, shown: 67n },
    { weights: [10, 21, 69], classworks: [2, 6], homework: 25, num: 167n, shown: 84n },
  ])(
    'lands exactly on $num/2 with totals of 3, 7 and 30, shown $shown',
    ({ weights, classworks, homework, num, shown }) => {
      const [attendance = 0, classwork = 0, homeworkWeight = 0] = weights;
      const [ofThree = 0, ofSeven = 0] = classworks;
      const score = scoreOf(
        input({
          weights: { attendance, classwork, homework: homeworkWeight },
          classworks: [
            { total: 3, score: ofThree },
            { total: 7, score: ofSeven },
          ],
          homeworks: [{ total: 30, score: homework }],
        }),
      );
      expectExactly(score, num, 2n);
      expect(score.roundHalfUp()).toBe(shown);
    },
  );

  // edge/calculation, "A lesson has three classworks: 100%, 50% and 60%".
  it('takes the classwork part as the mean of the lesson classworks', () => {
    const result = lessonScore(
      input({
        classworks: [
          { total: 10, score: 10 },
          { total: 10, score: 5 },
          { total: 5, score: 3 },
        ],
      }),
    );
    expect(result.kind).toBe('score');
    if (result.kind !== 'score') return;
    expectExactly(result.parts.classwork ?? Fraction.whole(-1n), 70n);
    expect(result.parts.homework).toBeNull();
  });

  it('leaves out a lesson without classwork and scales the other weights', () => {
    // (20 × 100 + 50 × 50) ÷ 70
    expectExactly(scoreOf(input({ homeworks: [{ total: 10, score: 5 }] })), 450n, 7n);
  });

  it('leaves out a lesson without homework and scales the other weights', () => {
    // (20 × 100 + 30 × 40) ÷ 50
    expectExactly(scoreOf(input({ classworks: [{ total: 5, score: 2 }] })), 64n);
  });

  it('is the attendance value alone in a lesson with no work', () => {
    expectExactly(scoreOf(input({ mark: 2 })), 50n);
    expectExactly(
      scoreOf(input({ mark: 2, attendanceValues: { lateValue: 75, skippedValue: 0 } })),
      75n,
    );
    expectExactly(
      scoreOf(input({ mark: 3, attendanceValues: { lateValue: 50, skippedValue: 20 } })),
      20n,
    );
  });

  // edge/calculation, "numbers for only some of the lesson's classworks"; 07 rule 4.
  it('leaves an empty number out of the mean and counts a 0', () => {
    const result = lessonScore(
      input({
        classworks: [
          { total: 10, score: 8 },
          { total: 10, score: null },
          { total: 10, score: 0 },
        ],
      }),
    );
    expect(result.kind === 'score' && result.parts.classwork?.equals(Fraction.whole(40n))).toBe(
      true,
    );
  });

  it('leaves a part with only empty numbers out', () => {
    // (20 × 100 + 50 × 60) ÷ 70
    const score = scoreOf(
      input({
        classworks: [{ total: 10, score: null }],
        homeworks: [{ total: 10, score: 6 }],
      }),
    );
    expectExactly(score, 500n, 7n);
  });

  // Decision 2: a mark not yet typed is left out, never read as absent.
  it('leaves an attendance mark not yet typed out and counts the works', () => {
    const result = lessonScore(input({ mark: null, classworks: [{ total: 4, score: 3 }] }));
    expect(result.kind).toBe('score');
    if (result.kind !== 'score') return;
    expectExactly(result.value, 75n);
    expect(result.parts.attendance).toBeNull();
  });

  it('counts the numbers of an absent student', () => {
    // (20 × 0 + 30 × 100) ÷ 50
    expectExactly(scoreOf(input({ mark: 0, classworks: [{ total: 2, score: 2 }] })), 60n);
  });

  it('is blank when no part has data', () => {
    expect(lessonScore(input({ mark: null }))).toEqual({ kind: 'blank' });
    expect(
      lessonScore(
        input({
          mark: null,
          classworks: [{ total: 10, score: null }],
          homeworks: [{ total: 10, score: null }],
        }),
      ),
    ).toEqual({ kind: 'blank' });
  });

  // 07 rule 1; decision 3.
  it('gives no score for an exempt mark and refuses a number with it', () => {
    expect(lessonScore(input({ mark: 4 }))).toEqual({ kind: 'exempt' });
    expect(lessonScore(input({ mark: 5, classworks: [{ total: 10, score: null }] }))).toEqual({
      kind: 'exempt',
    });
    expect(() => lessonScore(input({ mark: 5, classworks: [{ total: 10, score: 4 }] }))).toThrow(
      CalcInputError,
    );
    expect(() => lessonScore(input({ mark: 4, homeworks: [{ total: 10, score: 0 }] }))).toThrow(
      CalcInputError,
    );
  });

  // edge/calculation, "An extra Saturday lesson"; decision 7.
  it('leaves the attendance part out when the lesson does not count for attendance', () => {
    const result = lessonScore(
      input({ countsForAttendance: false, mark: 0, homeworks: [{ total: 10, score: 9 }] }),
    );
    expect(result.kind === 'score' && result.value.equals(Fraction.whole(90n))).toBe(true);
    expect(lessonScore(input({ countsForAttendance: false, mark: 1 }))).toEqual({ kind: 'blank' });
  });

  it('refuses a daily distribution that is not three whole parts of 1 to 100 totalling 100', () => {
    const refuse = (weights: DailyWeights) =>
      expect(() => lessonScore(input({ weights }))).toThrow(CalcInputError);
    refuse({ attendance: 20, classwork: 30, homework: 40 });
    refuse({ attendance: 0, classwork: 50, homework: 50 });
    refuse({ attendance: 2.5, classwork: 47.5, homework: 50 });
    refuse({ attendance: 101, classwork: -1, homework: 0 });
  });

  it('refuses a work that workPercent refuses', () => {
    expect(() => lessonScore(input({ classworks: [{ total: 10, score: 11 }] }))).toThrow(
      CalcInputError,
    );
    expect(() => lessonScore(input({ homeworks: [{ total: 0, score: null }] }))).toThrow(
      CalcInputError,
    );
  });
});

// The independent reference: BigInt cross-multiplication only, no Fraction.
interface Ratio {
  num: bigint;
  den: bigint;
}

function meanOfWorks(works: readonly Work[]): Ratio | null {
  const scored = works.flatMap((work) =>
    work.score === null ? [] : [{ score: BigInt(work.score), total: BigInt(work.total) }],
  );
  if (scored.length === 0) return null;
  const product = scored.reduce((all, work) => all * work.total, 1n);
  const num = scored.reduce((sum, work) => sum + 100n * work.score * (product / work.total), 0n);
  return { num, den: product * BigInt(scored.length) };
}

function reference(value: LessonScoreInput): Ratio | null {
  const parts: [bigint, Ratio][] = [];
  const marks: Record<number, bigint> = {
    0: 0n,
    1: 100n,
    2: BigInt(value.attendanceValues.lateValue),
    3: BigInt(value.attendanceValues.skippedValue),
  };
  if (value.countsForAttendance && value.mark !== null) {
    parts.push([BigInt(value.weights.attendance), { num: marks[value.mark] ?? -1n, den: 1n }]);
  }
  const classwork = meanOfWorks(value.classworks);
  if (classwork) parts.push([BigInt(value.weights.classwork), classwork]);
  const homework = meanOfWorks(value.homeworks);
  if (homework) parts.push([BigInt(value.weights.homework), homework]);
  if (parts.length === 0) return null;
  const common = parts.reduce((all, [, part]) => all * part.den, 1n);
  const num = parts.reduce(
    (sum, [weight, part]) => sum + weight * part.num * (common / part.den),
    0n,
  );
  const weights = parts.reduce((sum, [weight]) => sum + weight, 0n);
  return { num, den: common * weights };
}

const weights = fc
  .tuple(fc.integer({ min: 1, max: 98 }), fc.integer({ min: 1, max: 98 }))
  .filter(([attendance, classwork]) => attendance + classwork <= 99)
  .map(([attendance, classwork]) => ({
    attendance,
    classwork,
    homework: 100 - attendance - classwork,
  }));
const work = fc
  .integer({ min: 1, max: 1000 })
  .chain((total) =>
    fc.record({ total: fc.constant(total), score: fc.option(fc.integer({ min: 0, max: total })) }),
  );
const lesson = fc.record({
  weights,
  mark: fc.option(fc.constantFrom<AttendanceMark>(0, 1, 2, 3)),
  attendanceValues: fc.record({
    lateValue: fc.integer({ min: 0, max: 100 }),
    skippedValue: fc.integer({ min: 0, max: 100 }),
  }),
  countsForAttendance: fc.boolean(),
  classworks: fc.array(work, { maxLength: 4 }),
  homeworks: fc.array(work, { maxLength: 4 }),
});

describe('lessonScore against an independent reference', () => {
  it('equals the cross-multiplied weighted mean of the parts present', () => {
    fc.assert(
      fc.property(lesson, (value) => {
        const expected = reference(value);
        const result = lessonScore(value);
        if (expected === null) {
          expect(result).toEqual({ kind: 'blank' });
          return;
        }
        expect(result.kind).toBe('score');
        if (result.kind !== 'score') return;
        expect(result.value.num * expected.den).toBe(expected.num * result.value.den);
        expect(result.value.compare(Fraction.whole(0n))).toBeGreaterThanOrEqual(0);
        expect(result.value.compare(Fraction.whole(100n))).toBeLessThanOrEqual(0);
      }),
    );
  });

  it('does not depend on the order of the works', () => {
    fc.assert(
      fc.property(lesson, (value) => {
        const reversed = {
          ...value,
          classworks: [...value.classworks].reverse(),
          homeworks: [...value.homeworks].reverse(),
        };
        expect(lessonScore(reversed)).toEqual(lessonScore(value));
      }),
    );
  });

  it('is 100 when every part is 100 and 0 when every part is 0', () => {
    fc.assert(
      fc.property(
        weights,
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        (w, a, b) => {
          const full = { total: a, score: a };
          const none = { total: b, score: 0 };
          expectExactly(
            scoreOf(input({ weights: w, mark: 1, classworks: [full], homeworks: [full] })),
            100n,
          );
          expectExactly(
            scoreOf(input({ weights: w, mark: 0, classworks: [none], homeworks: [none] })),
            0n,
          );
        },
      ),
    );
  });
});
