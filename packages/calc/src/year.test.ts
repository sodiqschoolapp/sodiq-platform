import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Fraction } from './fraction.js';
import { CalcInputError } from './input.js';
import { yearResult, type QuarterOutcome } from './year.js';

const HALF_49 = Fraction.of(99n, 2n);

function codeOf(quarters: readonly QuarterOutcome[]): string | undefined {
  try {
    yearResult(quarters);
  } catch (error) {
    if (error instanceof CalcInputError) return error.code;
    throw error;
  }
  return undefined;
}

// docs/spec/07-journal.md, Calculation rules 10 and 11; edge/calculation, the year row; the
// owner's answer L210 of 15 October 2026 (issue #42).
describe('yearResult', () => {
  it('gives 49.75, shown 50, grade 3, for quarters of 49.5, 49.5, 49.4, 49.5 shown 50, 50, 49, 50', () => {
    const result = yearResult([HALF_49, HALF_49, Fraction.of(247n, 5n), HALF_49]);
    expect(result).toMatchObject({ kind: 'number', shown: 50n, grade: 3, basedOn: 4 });
    if (result.kind !== 'number') return;
    expect(result.value.equals(Fraction.of(199n, 4n))).toBe(true);
  });

  it('means the quarter results as shown, not the exact ones', () => {
    // 66.4, 66.4, 66.5, 66.5 are shown 66, 66, 67, 67, whose mean 66.5 shows 67 and grade 4; the
    // exact mean 66.45 would show 66 and grade 3.
    const low = Fraction.of(332n, 5n);
    const high = Fraction.of(133n, 2n);
    const result = yearResult([low, low, high, high]);
    expect(result).toMatchObject({ kind: 'number', shown: 67n, grade: 4 });
    if (result.kind !== 'number') return;
    expect(result.value.equals(Fraction.of(133n, 2n))).toBe(true);
  });

  it('is the exact mean of the shown quarters, rounded once more half up', () => {
    const quarter = fc
      .tuple(fc.bigInt({ min: 0n, max: 100n }), fc.bigInt({ min: 1n, max: 40n }))
      .chain(([whole, den]) =>
        fc
          .bigInt({ min: 0n, max: whole === 100n ? 0n : den - 1n })
          .map((part) => Fraction.of(whole * den + part, den)),
      );
    fc.assert(
      fc.property(fc.array(quarter, { minLength: 4, maxLength: 4 }), (quarters) => {
        const result = yearResult(quarters);
        const shown = quarters.map((one) => Fraction.whole(one.roundHalfUp()));
        const mean = Fraction.meanOf(shown);
        expect(result.kind).toBe('number');
        if (result.kind !== 'number' || mean === null) return;
        expect(result.value.equals(mean)).toBe(true);
        expect(result.shown).toBe(mean.roundHalfUp());
      }),
    );
  });

  it('leaves an Exempt quarter out, based on 3 of 4', () => {
    const result = yearResult([
      Fraction.whole(60n),
      'exempt',
      Fraction.whole(70n),
      Fraction.whole(80n),
    ]);
    expect(result).toMatchObject({ kind: 'number', basedOn: 3, shown: 70n, grade: 4 });
  });

  // edge/academic-year, "The school goes live in the middle of the year".
  it('leaves out quarters "not in the system" before go-live, based on 2 of 4', () => {
    const result = yearResult([
      'not_in_system',
      'not_in_system',
      Fraction.whole(84n),
      Fraction.of(167n, 2n),
    ]);
    // 83.5 is published as 84, so the year is exactly 84.
    expect(result).toMatchObject({ kind: 'number', basedOn: 2, shown: 84n, grade: 5 });
    if (result.kind !== 'number') return;
    expect(result.value.equals(Fraction.whole(84n))).toBe(true);
  });

  it('leaves out a "not official" start quarter, "Not assessed" and "No result"', () => {
    const result = yearResult(['not_official', 'not_assessed', 'no_result', Fraction.whole(41n)]);
    expect(result).toMatchObject({ kind: 'number', basedOn: 1, shown: 41n, grade: 2 });
  });

  it('gives no result when no quarter is a number', () => {
    expect(yearResult(['exempt', 'not_in_system', 'no_result', 'not_assessed'])).toEqual({
      kind: 'no_result',
    });
  });

  it('takes exactly four quarters', () => {
    const q = Fraction.whole(50n);
    expect(codeOf([q, q, q])).toBe('out_of_range');
    expect(codeOf([q, q, q, q, q])).toBe('out_of_range');
  });

  // Correction 3 of the plan review: a quarter result outside 0 to 100 is a caller fault.
  it('refuses a quarter result outside 0 to 100 and an unknown state', () => {
    const q = Fraction.whole(50n);
    expect(codeOf([q, q, q, Fraction.of(201n, 2n)])).toBe('out_of_range');
    expect(codeOf([q, q, q, Fraction.of(-1n, 1n)])).toBe('out_of_range');
    expect(codeOf([q, q, q, 'missing' as QuarterOutcome])).toBe('out_of_range');
  });
});
