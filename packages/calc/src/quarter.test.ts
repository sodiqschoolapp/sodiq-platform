import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AttendanceMark } from './attendance.js';
import type { Work } from './daily.js';
import { Fraction } from './fraction.js';
import { CalcInputError } from './input.js';
import {
  quarterAttendanceAverage,
  quarterResult,
  type QuarterLesson,
  type QuarterResult,
  type QuarterResultInput,
  type QuarterWeights,
} from './quarter.js';

const VALUES = { lateValue: 50, skippedValue: 0 };
const NO_RATING: QuarterWeights = { attendance: 20, classwork: 30, homework: 50, ratingExam: null };
const WITH_RATING: QuarterWeights = { attendance: 20, classwork: 20, homework: 20, ratingExam: 40 };

type Pair = readonly [number | null, number];

function works(pairs: readonly Pair[]): Work[] {
  return pairs.map(([score, total]) => ({ score, total }));
}

function lesson(
  mark: AttendanceMark | null,
  classworks: readonly Pair[] = [],
  homeworks: readonly Pair[] = [],
): QuarterLesson {
  return {
    mark,
    classworks: works(classworks),
    homeworks: works(homeworks),
  };
}

function input(overrides: Partial<QuarterResultInput>): QuarterResultInput {
  return {
    weights: NO_RATING,
    attendanceValues: VALUES,
    lessons: [],
    ratingExam: null,
    quarterClosed: false,
    ...overrides,
  };
}

function numberOf(result: QuarterResult) {
  if (result.kind !== 'number') throw new Error(`expected a number, got ${result.kind}`);
  return result;
}

function resultOf(value: QuarterResultInput) {
  return numberOf(quarterResult(value));
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof CalcInputError) return error.code;
    throw error;
  }
  return undefined;
}

function expectExactly(actual: Fraction | null, num: bigint, den = 1n): void {
  expect(actual && { num: actual.num, den: actual.den }).toEqual({ num, den });
}

// docs/spec/07-journal.md, Calculation rules 5 to 10.
describe('quarterResult', () => {
  // 07, the worked example under Calculation rules.
  it('gives 55.6, shown 56, grade 3 for weights 20 · 20 · 20 · 40 and 100, 50, 30, 49', () => {
    const result = resultOf(
      input({
        weights: WITH_RATING,
        lessons: [lesson(1, [[15, 30]], [[3, 10]])],
        ratingExam: { kind: 'score', score: 49 },
        quarterClosed: true,
      }),
    );
    expectExactly(result.value, 278n, 5n);
    expect(result.shown).toBe(56n);
    expect(result.grade).toBe(3);
    expectExactly(result.averages.attendance, 100n);
    expectExactly(result.averages.classwork, 50n);
    expectExactly(result.averages.homework, 30n);
    expectExactly(result.averages.ratingExam, 49n);
    expect(result.leftOut).toEqual([]);
    expect(result.provisional).toBe(false);
  });

  // edge/calculation, "A result lands exactly on a boundary".
  it('lands exactly on 49.5, grade 3, for 10 · 50 · 40, classworks 10, 10, 25 of 30, homework 29 of 80', () => {
    const result = resultOf(
      input({
        weights: { attendance: 10, classwork: 50, homework: 40, ratingExam: null },
        lessons: [
          lesson(
            1,
            [
              [10, 30],
              [10, 30],
              [25, 30],
            ],
            [[29, 80]],
          ),
        ],
      }),
    );
    expectExactly(result.value, 99n, 2n);
    expect(result.shown).toBe(50n);
    expect(result.grade).toBe(3);
  });

  // edge/calculation, first row: "Tests include totals of 3, 7 and 30 that land exactly on
  // 49.5, 66.5 and 83.5". With an odd total, one work per part and a whole attendance
  // average no result ends in .5, so totals 3 and 7 take one late lesson (50) at an odd weight.
  it.each([
    [3, [1, 24, 75], 2, 3, 1, 99n, 3],
    [3, [1, 1, 98], 2, 2, 2, 133n, 4],
    [3, [1, 16, 83], 2, 0, 3, 167n, 5],
    [7, [1, 23, 76], 2, 5, 3, 99n, 3],
    [7, [1, 11, 88], 2, 2, 5, 133n, 4],
    [7, [1, 13, 86], 2, 5, 6, 167n, 5],
    [30, [1, 2, 97], 1, 0, 15, 99n, 3],
    [30, [1, 1, 98], 1, 5, 20, 133n, 4],
    [30, [1, 1, 98], 1, 25, 25, 167n, 5],
  ] as const)(
    'total %i with weights %j lands exactly on a .5 boundary',
    (total, [attendance, classwork, homework], mark, cw, hw, half, grade) => {
      const result = resultOf(
        input({
          weights: { attendance, classwork, homework, ratingExam: null },
          lessons: [lesson(mark, [[cw, total]], [[hw, total]])],
        }),
      );
      expectExactly(result.value, half, 2n);
      expect(result.grade).toBe(grade);
    },
  );

  // 07 rule 6; edge/calculation, "A lesson has three classworks".
  it('counts each work once: 100, 50 and 60 in one lesson and 90 in another give 75', () => {
    const result = resultOf(
      input({
        lessons: [
          lesson(1, [
            [100, 100],
            [50, 100],
            [60, 100],
          ]),
          lesson(1, [[90, 100]]),
        ],
      }),
    );
    expectExactly(result.averages.classwork, 75n);
  });

  // 07 rule 5; task 4.2, decision 1.
  it('averages attendance over the marked lessons with the quarter values of late and skipped', () => {
    const lessons = [
      lesson(1),
      lesson(2),
      lesson(3),
      lesson(0),
      lesson(4),
      lesson(5),
      lesson(null),
    ];
    const attendanceValues = { lateValue: 75, skippedValue: 25 };
    const result = resultOf(input({ lessons, attendanceValues }));
    // (100 + 75 + 25 + 0) ÷ 4: exempt and unmarked lessons are left out.
    expectExactly(result.averages.attendance, 50n);
    // edge/calculation, "Ma'naviyat soati": the same figure with no weights.
    expectExactly(quarterAttendanceAverage({ attendanceValues, lessons }), 50n);
  });

  it('gives no attendance average when no lesson has a value', () => {
    expect(
      quarterAttendanceAverage({ attendanceValues: VALUES, lessons: [lesson(null), lesson(4)] }),
    ).toBeNull();
  });

  // 07, Effect on totals: "Exempt lessons, and works given in them, are left out"; decision 4.
  it('leaves out the works of exempt lessons, the homeworks checked there included', () => {
    const result = resultOf(
      input({
        lessons: [
          lesson(4, [[null, 10]], [[null, 10]]),
          lesson(5, [[null, 30]], [[null, 5]]),
          lesson(1, [[8, 10]], [[2, 5]]),
        ],
      }),
    );
    expectExactly(result.averages.classwork, 80n);
    expectExactly(result.averages.homework, 40n);
  });

  it('refuses a number on an exempt lesson', () => {
    expect(codeOf(() => quarterResult(input({ lessons: [lesson(4, [[3, 10]])] })))).toBe(
      'number_on_exempt_lesson',
    );
    expect(codeOf(() => quarterResult(input({ lessons: [lesson(5, [], [[0, 10]])] })))).toBe(
      'number_on_exempt_lesson',
    );
  });

  // 07 rule 4: an empty score is not counted; a 0 is.
  it('leaves out an empty number and counts a 0 and a number equal to the total', () => {
    const result = resultOf(
      input({
        lessons: [
          lesson(1, [
            [null, 10],
            [0, 10],
            [5, 5],
          ]),
        ],
      }),
    );
    expectExactly(result.averages.classwork, 50n);
  });

  // 07 rule 8; edge/calculation, "The rating exam".
  describe('the rating exam', () => {
    const base = { weights: WITH_RATING, lessons: [lesson(1, [[15, 30]], [[3, 10]])] };

    it('counts "did not sit" as 0', () => {
      const result = resultOf(input({ ...base, ratingExam: { kind: 'did_not_sit' } }));
      expectExactly(result.averages.ratingExam, 0n);
      // 20 + 10 + 6 + 0.
      expectExactly(result.value, 36n);
      expect(result.provisional).toBe(false);
    });

    it.each(['exempt', 'not_held'] as const)(
      'leaves the part out for %s and scales the others up',
      (kind) => {
        const result = resultOf(input({ ...base, ratingExam: { kind } }));
        expect(result.averages.ratingExam).toBeNull();
        expect(result.leftOut).toEqual([{ part: 'ratingExam', reason: kind }]);
        // (20 + 10 + 6) ÷ 60 × 100.
        expectExactly(result.value, 60n);
        expect(result.provisional).toBe(false);
      },
    );

    it('is provisional with no entry while the quarter is open, and not once closed', () => {
      const open = resultOf(input({ ...base, ratingExam: null }));
      expect(open.leftOut).toEqual([{ part: 'ratingExam', reason: 'no_data' }]);
      expect(open.provisional).toBe(true);
      expectExactly(open.value, 60n);
      const closed = resultOf(input({ ...base, ratingExam: null, quarterClosed: true }));
      expect(closed.provisional).toBe(false);
      expect(closed.leftOut).toEqual(open.leftOut);
    });

    it('refuses an entry when the distribution has no rating part', () => {
      expect(
        codeOf(() =>
          quarterResult(input({ weights: NO_RATING, ratingExam: { kind: 'did_not_sit' } })),
        ),
      ).toBe('rating_exam_without_weight');
    });

    it('refuses a score that is not a whole number from 0 to 100', () => {
      expect(
        codeOf(() => quarterResult(input({ ...base, ratingExam: { kind: 'score', score: 101 } }))),
      ).toBe('out_of_range');
      expect(
        codeOf(() => quarterResult(input({ ...base, ratingExam: { kind: 'score', score: -1 } }))),
      ).toBe('out_of_range');
      expect(
        codeOf(() => quarterResult(input({ ...base, ratingExam: { kind: 'score', score: 4.5 } }))),
      ).toBe('not_whole_number');
    });
  });

  // edge/calculation, "A part has a weight but no data"; 14, Rule tests.
  it('scales over the parts with data when no homework was given all quarter', () => {
    const lessons = [lesson(1, [[6, 10]]), lesson(0, [[4, 10]])];
    const open = resultOf(input({ lessons }));
    // attendance 50, classwork 50: (20 × 50 + 30 × 50) ÷ 50.
    expectExactly(open.value, 50n);
    expect(open.leftOut).toEqual([{ part: 'homework', reason: 'no_data' }]);
    expect(open.provisional).toBe(true);
    const closed = resultOf(input({ lessons, quarterClosed: true }));
    expect(closed.leftOut).toEqual([{ part: 'homework', reason: 'no_data' }]);
    expect(closed.provisional).toBe(false);
  });

  // 14, Rule tests: "no classwork in a quarter", "homeworks with no classwork".
  it('scales over attendance and homework when the quarter has homeworks and no classwork', () => {
    const result = resultOf(
      input({ lessons: [lesson(1, [], [[7, 10]]), lesson(1, [], [[9, 10]])] }),
    );
    expect(result.averages.classwork).toBeNull();
    // (20 × 100 + 50 × 80) ÷ 70.
    expectExactly(result.value, 600n, 7n);
    expect(result.leftOut).toEqual([{ part: 'classwork', reason: 'no_data' }]);
  });

  // edge/calculation, "Nothing at all was entered"; decision 5.
  it('gives no result when nothing was entered', () => {
    const result = quarterResult(input({ lessons: [lesson(null, [[null, 10]]), lesson(null)] }));
    expect(result.kind).toBe('no_result');
  });

  it('gives a number when only attendance has data (the attendance-only flag is task 4.3)', () => {
    const result = resultOf(input({ lessons: [lesson(1), lesson(1)] }));
    expectExactly(result.value, 100n);
  });

  // 07, Effect on totals: "If none remain, the result is 'Exempt'". The "Exempt" outcome is
  // task 4.3; here only that it is not a number (correction 2 of the plan review).
  it('gives no number when every lesson is exempt', () => {
    const result = quarterResult(
      input({ lessons: [lesson(4, [[null, 10]]), lesson(5), lesson(4)] }),
    );
    expect(result.kind).not.toBe('number');
  });

  // 07, Transfers; edge/calculation, "A student moved from one group to another in week 6".
  it('gives the same figures for the lessons of two journals as for one list', () => {
    const oldGroup = [lesson(1, [[3, 5]], []), lesson(2, [], [[10, 30]])];
    const newGroup = [lesson(1, [[25, 30]], [[1, 3]]), lesson(0)];
    const both = resultOf(input({ lessons: [...oldGroup, ...newGroup] }));
    const reversed = resultOf(input({ lessons: [...newGroup, ...oldGroup] }));
    expect(reversed).toEqual(both);
    // classworks 60 and 250/3, homeworks 100/3 and 100/3, attendance (100 + 50 + 100 + 0) ÷ 4.
    expectExactly(both.averages.classwork, 215n, 3n);
    expectExactly(both.averages.homework, 100n, 3n);
    expectExactly(both.averages.attendance, 125n, 2n);
  });

  // 14, Rule tests: "a weight changed mid-quarter"; edge/calculation, "Quarterly weights are
  // changed in week 7": the quarter is computed whole on the distribution in force.
  it('applies the one distribution passed to every lesson of the quarter', () => {
    const lessons = [lesson(1, [[10, 10]]), lesson(1, [[0, 10]], [[5, 10]])];
    const before = resultOf(input({ lessons }));
    const after = resultOf(
      input({
        lessons,
        weights: { attendance: 50, classwork: 25, homework: 25, ratingExam: null },
      }),
    );
    // (20 × 100 + 30 × 50 + 50 × 50) ÷ 100 and (50 × 100 + 25 × 50 + 25 × 50) ÷ 100.
    expectExactly(before.value, 60n);
    expectExactly(after.value, 75n);
  });

  // 14, Rule tests: "a total changed after numbers were typed": the average reads the total in force.
  it('reads the current total of a work', () => {
    const before = resultOf(input({ lessons: [lesson(1, [[4, 10]])] }));
    const after = resultOf(input({ lessons: [lesson(1, [[4, 5]])] }));
    expectExactly(before.averages.classwork, 40n);
    expectExactly(after.averages.classwork, 80n);
  });

  it('gives grade 2 at 0 and grade 5 at 100', () => {
    const zero = resultOf(
      input({
        weights: WITH_RATING,
        lessons: [lesson(0, [[0, 30]], [[0, 1]])],
        ratingExam: { kind: 'did_not_sit' },
      }),
    );
    expectExactly(zero.value, 0n);
    expect(zero.grade).toBe(2);
    const full = resultOf(
      input({
        weights: WITH_RATING,
        lessons: [lesson(1, [[30, 30]], [[1, 1]])],
        ratingExam: { kind: 'score', score: 100 },
      }),
    );
    expectExactly(full.value, 100n);
    expect(full.grade).toBe(5);
  });

  it('refuses a wrong quarterly distribution', () => {
    expect(
      codeOf(() =>
        quarterResult(
          input({ weights: { attendance: 0, classwork: 50, homework: 50, ratingExam: null } }),
        ),
      ),
    ).toBe('out_of_range');
    expect(
      codeOf(() =>
        quarterResult(
          input({ weights: { attendance: 20, classwork: 20, homework: 20, ratingExam: 39 } }),
        ),
      ),
    ).toBe('weights_not_100');
    expect(
      codeOf(() =>
        quarterResult(
          input({ weights: { attendance: 20, classwork: 20, homework: 20, ratingExam: null } }),
        ),
      ),
    ).toBe('weights_not_100');
  });

  it('checks the attendance values and every total on every call', () => {
    expect(
      codeOf(() => quarterResult(input({ attendanceValues: { lateValue: 101, skippedValue: 0 } }))),
    ).toBe('out_of_range');
    expect(codeOf(() => quarterResult(input({ lessons: [lesson(4, [[null, 0]])] })))).toBe(
      'total_below_one',
    );
    expect(codeOf(() => quarterResult(input({ lessons: [lesson(1, [[11, 10]])] })))).toBe(
      'score_above_total',
    );
  });
});

// The independent reference: BigInt cross-multiplication only, no Fraction.
interface Ratio {
  num: bigint;
  den: bigint;
}

function mean(values: readonly Ratio[]): Ratio | null {
  if (values.length === 0) return null;
  const common = values.reduce((all, value) => all * value.den, 1n);
  const num = values.reduce((sum, value) => sum + value.num * (common / value.den), 0n);
  return { num, den: common * BigInt(values.length) };
}

function reference(value: QuarterResultInput): Ratio | null {
  const marks: Record<number, bigint> = {
    0: 0n,
    1: 100n,
    2: BigInt(value.attendanceValues.lateValue),
    3: BigInt(value.attendanceValues.skippedValue),
  };
  const attended = value.lessons.filter((item) => item.mark !== 4 && item.mark !== 5);
  const percents = (pick: (item: QuarterLesson) => readonly Work[]): Ratio[] =>
    attended.flatMap((item) =>
      pick(item).flatMap((work) =>
        work.score === null ? [] : [{ num: 100n * BigInt(work.score), den: BigInt(work.total) }],
      ),
    );
  const parts: [bigint, Ratio | null][] = [
    [
      BigInt(value.weights.attendance),
      mean(
        attended.flatMap((item) =>
          item.mark === null ? [] : [{ num: marks[item.mark] ?? -1n, den: 1n }],
        ),
      ),
    ],
    [BigInt(value.weights.classwork), mean(percents((item) => item.classworks))],
    [BigInt(value.weights.homework), mean(percents((item) => item.homeworks))],
  ];
  if (value.weights.ratingExam !== null && value.ratingExam !== null) {
    const entry = value.ratingExam;
    if (entry.kind === 'score') {
      parts.push([BigInt(value.weights.ratingExam), { num: BigInt(entry.score), den: 1n }]);
    } else if (entry.kind === 'did_not_sit') {
      parts.push([BigInt(value.weights.ratingExam), { num: 0n, den: 1n }]);
    }
  }
  const present = parts.flatMap(([weight, part]) =>
    part === null ? [] : [[weight, part] as const],
  );
  if (present.length === 0) return null;
  const common = present.reduce((all, [, part]) => all * part.den, 1n);
  const num = present.reduce(
    (sum, [weight, part]) => sum + weight * part.num * (common / part.den),
    0n,
  );
  const weights = present.reduce((sum, [weight]) => sum + weight, 0n);
  return { num, den: common * weights };
}

// Whole weights from 1 up, totalling 100, with or without a rating part.
const quarterWeights = fc
  .tuple(fc.integer({ min: 1, max: 97 }), fc.integer({ min: 1, max: 97 }), fc.boolean())
  .filter(([a, c]) => a + c <= 98)
  .chain(([attendance, classwork, rating]): fc.Arbitrary<QuarterWeights> =>
    rating
      ? fc.integer({ min: 1, max: 99 - attendance - classwork }).map((homework) => ({
          attendance,
          classwork,
          homework,
          ratingExam: 100 - attendance - classwork - homework,
        }))
      : fc.constant({
          attendance,
          classwork,
          homework: 100 - attendance - classwork,
          ratingExam: null,
        }),
  );
const work = fc
  .integer({ min: 1, max: 1000 })
  .chain((total) =>
    fc.record({ total: fc.constant(total), score: fc.option(fc.integer({ min: 0, max: total })) }),
  );
const emptyWork = fc.integer({ min: 1, max: 1000 }).map((total) => ({ total, score: null }));
const heldLesson = fc.record({
  mark: fc.option(fc.constantFrom<AttendanceMark>(0, 1, 2, 3)),
  classworks: fc.array(work, { maxLength: 3 }),
  homeworks: fc.array(work, { maxLength: 3 }),
});
const exemptLesson = fc.record({
  mark: fc.constantFrom<AttendanceMark>(4, 5),
  classworks: fc.array(emptyWork, { maxLength: 2 }),
  homeworks: fc.array(emptyWork, { maxLength: 2 }),
});
const quarter = fc
  .record({
    weights: quarterWeights,
    attendanceValues: fc.record({
      lateValue: fc.integer({ min: 0, max: 100 }),
      skippedValue: fc.integer({ min: 0, max: 100 }),
    }),
    lessons: fc.array(fc.oneof(heldLesson, heldLesson, exemptLesson), { maxLength: 8 }),
    ratingExam: fc.option(
      fc.oneof(
        fc.record({ kind: fc.constant('score' as const), score: fc.integer({ min: 0, max: 100 }) }),
        fc.constantFrom(
          { kind: 'did_not_sit' as const },
          { kind: 'exempt' as const },
          { kind: 'not_held' as const },
        ),
      ),
    ),
    quarterClosed: fc.boolean(),
  })
  .map((value) =>
    // An entry needs a rating part; without one the entry is dropped.
    value.weights.ratingExam === null ? { ...value, ratingExam: null } : value,
  );

describe('quarterResult against an independent reference', () => {
  it('equals the cross-multiplied weighted mean of the parts with data, between 0 and 100', () => {
    fc.assert(
      fc.property(quarter, (value) => {
        const expected = reference(value);
        const result = quarterResult(value);
        if (expected === null) {
          expect(result.kind).toBe('no_result');
          return;
        }
        const number = numberOf(result);
        expect(number.value.num * expected.den).toBe(expected.num * number.value.den);
        expect(number.value.compare(Fraction.whole(0n))).toBeGreaterThanOrEqual(0);
        expect(number.value.compare(Fraction.whole(100n))).toBeLessThanOrEqual(0);
        expect(number.shown).toBe(number.value.roundHalfUp());
      }),
    );
  });

  it('does not depend on the order of the lessons', () => {
    fc.assert(
      fc.property(quarter, (value) => {
        const reversed = { ...value, lessons: [...value.lessons].reverse() };
        expect(quarterResult(reversed)).toEqual(quarterResult(value));
      }),
    );
  });

  // 07 rule 6: each work counts once, whichever lesson holds it.
  it('keeps the classwork and homework averages when a work moves between non-exempt lessons', () => {
    fc.assert(
      fc.property(quarter, heldLesson, heldLesson, (value, first, second) => {
        const moved: QuarterLesson = {
          ...second,
          classworks: [...second.classworks, ...first.classworks],
          homeworks: [...second.homeworks, ...first.homeworks],
        };
        const emptied: QuarterLesson = { ...first, classworks: [], homeworks: [] };
        const before = quarterResult({ ...value, lessons: [...value.lessons, first, second] });
        const after = quarterResult({ ...value, lessons: [...value.lessons, emptied, moved] });
        expect(after.averages.classwork).toEqual(before.averages.classwork);
        expect(after.averages.homework).toEqual(before.averages.homework);
      }),
    );
  });
});
