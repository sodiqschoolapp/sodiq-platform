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

  // The owner's spec change of 25 November 2026 (decimal totals; task 11.25b, decision 1, Look
  // first): `workPercent(1, 2.5)` was refused as `not_whole_number` until version 8 and is 40 now.
  it('refuses a total below 1, or one that is not a number with at most two decimals', () => {
    expect(codeOf(() => workPercent(0, 0))).toBe('total_below_one');
    expect(codeOf(() => workPercent(0, -3))).toBe('total_below_one');
    expect(codeOf(() => workPercent(0, 0.5))).toBe('total_below_one');
    expect(workPercent(1, 2.5).equals(Fraction.whole(40n))).toBe(true);
    expect(codeOf(() => workPercent(1, 2.555))).toBe('more_than_two_decimals');
    expect(codeOf(() => workPercent(1, Number.NaN))).toBe('not_whole_number');
    expect(codeOf(() => workPercent(1, Number.POSITIVE_INFINITY))).toBe('not_whole_number');
    expect(codeOf(() => workPercent(1, 2 ** 53))).toBe('not_whole_number');
  });

  // The owner's spec change of 25 November 2026 (decimal scores; task 11.25b, decision 1, Look
  // first): `workPercent(4.5, 5)` was refused as `not_whole_number` until version 8 and is 90 now.
  it('refuses a number below 0, above the total, or with more than two decimals', () => {
    expect(codeOf(() => workPercent(31, 30))).toBe('score_above_total');
    expect(codeOf(() => workPercent(30.01, 30))).toBe('score_above_total');
    expect(codeOf(() => workPercent(-1, 30))).toBe('score_below_zero');
    expect(codeOf(() => workPercent(-0.5, 30))).toBe('score_below_zero');
    expect(workPercent(4.5, 5).equals(Fraction.whole(90n))).toBe(true);
    expect(codeOf(() => workPercent(7.555, 10))).toBe('more_than_two_decimals');
    expect(codeOf(() => workPercent(0.1 + 0.2, 10))).toBe('more_than_two_decimals');
    expect(codeOf(() => workPercent(1e-7, 10))).toBe('not_whole_number');
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

  // Task 11.25b, decision 1 (Look first): until version 8 this was "always refuses a decimal".
  it('always refuses more than two digits after the point', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true, min: 0, max: 1000 }).filter((value) => {
          const text = String(value);
          return /^\d+\.\d{3,}$/.test(text) || /e/.test(text);
        }),
        (decimal) => {
          // Three or more digits after the point: `more_than_two_decimals`; an exponent form
          // (1e-7): `not_whole_number`, as version 8 refused it. The total is read first.
          const expected = /e/.test(String(decimal))
            ? 'not_whole_number'
            : 'more_than_two_decimals';
          expect(codeOf(() => workPercent(decimal, 1000))).toBe(expected);
          expect(codeOf(() => workPercent(0, decimal))).toBe(expected);
        },
      ),
    );
  });

  // The owner's spec changes of 25 November 2026 (decimal scores and decimal totals); 07, The
  // total ("Give half points | 10 | 7.5 | 75%"); 14, Rule tests ("scores and totals with one and
  // two decimals (7.5 and 8.25)"); the Done when of 11.25b.
  describe('scores and totals with decimals', () => {
    it('gives 75 for 7.5 out of 10, 80 for 6 out of 7.5, and exactly 75 for 8.25 out of 11', () => {
      expect(workPercent(7.5, 10).equals(Fraction.whole(75n))).toBe(true);
      expect(shownPercent(7.5, 10)).toBe(75n);
      expect(workPercent(6, 7.5).equals(Fraction.whole(80n))).toBe(true);
      expect(workPercent(8.25, 11).equals(Fraction.whole(75n))).toBe(true);
      expect(workPercent(6.6, 8.25).equals(Fraction.whole(80n))).toBe(true);
      expect(workPercent(9.75, 10).equals(Fraction.of(195n, 2n))).toBe(true);
      expect(workPercent(7.55, 7.55).equals(Fraction.whole(100n))).toBe(true);
      expect(workPercent(0.01, 1000).equals(Fraction.of(1n, 1000n))).toBe(true);
    });

    it('reads a value from its decimal text, never from its binary form', () => {
      // 7.55 is not exact in binary; its text is, and that is what was typed.
      expect(workPercent(7.55, 10).equals(Fraction.of(151n, 2n))).toBe(true);
      expect(workPercent(0.29, 1).equals(Fraction.whole(29n))).toBe(true);
    });

    it('refuses a value whose hundredths are not a safe whole number', () => {
      expect(codeOf(() => workPercent(1, 2 ** 53 / 100))).toBe('not_whole_number');
      expect(codeOf(() => workPercent(1, 1e21))).toBe('not_whole_number');
    });

    it('gives the same fraction as version 8 for every whole number and total', () => {
      // Version 8 read whole numbers only: score x 100 / total. The domain where version 8 and
      // version 9 meet: whole totals whose hundredths are safe ((2^53 - 1) / 100 and below).
      fc.assert(
        fc.property(
          fc
            .integer({ min: 1, max: Math.floor(Number.MAX_SAFE_INTEGER / 100) })
            .chain((total) => fc.tuple(fc.constant(total), fc.integer({ min: 0, max: total }))),
          ([total, score]) => {
            expect(
              workPercent(score, total).equals(Fraction.of(BigInt(score) * 100n, BigInt(total))),
            ).toBe(true);
          },
        ),
      );
    });

    it('is exact for every score and total in hundredths: percent x total = score x 100', () => {
      fc.assert(
        fc.property(
          fc
            .integer({ min: 100, max: 100_000 })
            .chain((total) => fc.tuple(fc.constant(total), fc.integer({ min: 0, max: total }))),
          ([totalHundredths, scoreHundredths]) => {
            const total = totalHundredths / 100;
            const score = scoreHundredths / 100;
            const percent = workPercent(score, total);
            expect(
              percent
                .mul(Fraction.of(BigInt(totalHundredths), 100n))
                .equals(Fraction.of(BigInt(scoreHundredths) * 100n, 100n)),
            ).toBe(true);
          },
        ),
      );
    });
  });
});
