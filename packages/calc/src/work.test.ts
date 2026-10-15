import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Fraction } from './fraction.js';
import { CalcInputError } from './input.js';
import { shownPercent, workPercent } from './work.js';

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof CalcInputError) return error.code;
    throw error;
  }
  return undefined;
}

// docs/spec/07-journal.md, The total, and Calculation rules 2.
describe('workPercent', () => {
  it('turns the number typed into a percent of the total, exactly', () => {
    expect(workPercent(12, 30).equals(Fraction.whole(40n))).toBe(true);
    expect(workPercent(4, 5).equals(Fraction.whole(80n))).toBe(true);
    expect(workPercent(85, 100).equals(Fraction.whole(85n))).toBe(true);
    expect(workPercent(13, 30).equals(Fraction.of(130n, 3n))).toBe(true);
    expect(shownPercent(13, 30)).toBe(43n);
  });

  // docs/spec/14-quality-plan.md, Rule tests: "totals of 1, 5, 30 and 100, a number
  // equal to the total".
  it.each([1, 5, 30, 100])(
    'gives 100 for a number equal to a total of %i, and 0 for 0',
    (total) => {
      expect(workPercent(total, total).equals(Fraction.whole(100n))).toBe(true);
      expect(workPercent(0, total).isZero()).toBe(true);
    },
  );

  // docs/spec/14-quality-plan.md, Rule tests: "a total changed after numbers were
  // typed"; 07, The total: "All percents of that work are recalculated at once. If a
  // number already typed is above the new total, the change is refused".
  it('recalculates under a changed total and refuses a number above it', () => {
    expect(workPercent(12, 30).equals(Fraction.whole(40n))).toBe(true);
    expect(workPercent(12, 40).equals(Fraction.whole(30n))).toBe(true);
    expect(workPercent(35, 40).equals(Fraction.of(175n, 2n))).toBe(true);
    expect(codeOf(() => workPercent(35, 30))).toBe('score_above_total');
  });

  it('refuses a total that is not a whole number of 1 or more', () => {
    expect(codeOf(() => workPercent(0, 0))).toBe('total_below_one');
    expect(codeOf(() => workPercent(0, -3))).toBe('total_below_one');
    expect(codeOf(() => workPercent(1, 2.5))).toBe('not_whole_number');
    expect(codeOf(() => workPercent(1, Number.NaN))).toBe('not_whole_number');
    expect(codeOf(() => workPercent(1, Number.POSITIVE_INFINITY))).toBe('not_whole_number');
    expect(codeOf(() => workPercent(1, 2 ** 53))).toBe('not_whole_number');
  });

  it('refuses a number that is not a whole number from 0 up to the total', () => {
    expect(codeOf(() => workPercent(31, 30))).toBe('score_above_total');
    expect(codeOf(() => workPercent(-1, 30))).toBe('score_below_zero');
    expect(codeOf(() => workPercent(4.5, 5))).toBe('not_whole_number');
    expect(codeOf(() => workPercent(Number.NaN, 5))).toBe('not_whole_number');
  });

  it('is exact for every total and number: percent x total = number x 100', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 1_000_000 })
          .chain((total) => fc.tuple(fc.constant(total), fc.integer({ min: 0, max: total }))),
        ([total, score]) => {
          const percent = workPercent(score, total);
          expect(
            percent.mul(Fraction.whole(BigInt(total))).equals(Fraction.whole(BigInt(score) * 100n)),
          ).toBe(true);
        },
      ),
    );
  });

  it('always refuses a decimal', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true }).filter((value) => !Number.isInteger(value)),
        fc.integer({ min: 1, max: 1000 }),
        (decimal, whole) => {
          expect(codeOf(() => workPercent(decimal, 1000))).toBe('not_whole_number');
          expect(codeOf(() => workPercent(whole, decimal))).toBe('not_whole_number');
        },
      ),
    );
  });
});
