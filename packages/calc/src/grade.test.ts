import { describe, expect, it } from 'vitest';
import { Fraction } from './fraction.js';
import { GRADE_BANDS, gradeOf } from './grade.js';
import { CalcInputError } from './input.js';

// docs/spec/07-journal.md, Calculation rules 9 and 10; edge/calculation, "Which value gives the grade?".
describe('gradeOf', () => {
  it.each([
    [0n, 1n, 2],
    [49n, 1n, 2],
    [98999n, 2000n, 2],
    [99n, 2n, 3],
    [50n, 1n, 3],
    [66n, 1n, 3],
    [133n, 2n, 4],
    [83n, 1n, 4],
    [167n, 2n, 5],
    [100n, 1n, 5],
  ] as const)('gives %i/%i grade %i', (num, den, grade) => {
    expect(gradeOf(Fraction.of(num, den))).toBe(grade);
  });

  it('refuses a result outside 0 to 100', () => {
    for (const value of [Fraction.of(-1n, 2n), Fraction.of(201n, 2n)]) {
      expect(() => gradeOf(value)).toThrow(CalcInputError);
    }
  });
});

describe('GRADE_BANDS', () => {
  it('are the bands of rule 9', () => {
    expect(GRADE_BANDS).toEqual([
      { grade: 2, from: 0, to: 49 },
      { grade: 3, from: 50, to: 66 },
      { grade: 4, from: 67, to: 83 },
      { grade: 5, from: 84, to: 100 },
    ]);
  });

  it('cover every whole result from 0 to 100 exactly once', () => {
    for (let value = 0; value <= 100; value += 1) {
      expect(GRADE_BANDS.filter(({ from, to }) => value >= from && value <= to)).toHaveLength(1);
    }
  });

  it('cannot be changed', () => {
    expect(Object.isFrozen(GRADE_BANDS)).toBe(true);
    expect(GRADE_BANDS.every((band) => Object.isFrozen(band))).toBe(true);
  });
});
