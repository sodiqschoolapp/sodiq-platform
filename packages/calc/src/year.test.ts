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

// docs/spec/07-journal.md, Calculation rules 11; edge/calculation, the year row.
describe('yearResult', () => {
  it('gives exactly 49.475, shown 49, grade 2, for quarters of 49.5, 49.5, 49.4, 49.5', () => {
    const result = yearResult([HALF_49, HALF_49, Fraction.of(247n, 5n), HALF_49]);
    expect(result).toMatchObject({ kind: 'number', shown: 49n, grade: 2, basedOn: 4 });
    if (result.kind !== 'number') return;
    expect(result.value.equals(Fraction.of(1979n, 40n))).toBe(true);
  });

  it('means the exact quarter results, not the shown ones', () => {
    // Shown 50, 50, 49, 50, whose mean 49.75 would show 50 and grade 3; the exact mean shows 49.
    const result = yearResult([HALF_49, HALF_49, Fraction.of(247n, 5n), HALF_49]);
    expect(result).toMatchObject({ kind: 'number', shown: 49n, grade: 2 });
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
    expect(result).toMatchObject({ kind: 'number', basedOn: 2, grade: 5 });
    if (result.kind !== 'number') return;
    expect(result.value.equals(Fraction.of(335n, 4n))).toBe(true);
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
