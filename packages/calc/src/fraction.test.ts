import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CalcInputError } from './input.js';
import { Fraction } from './fraction.js';

const big = fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n });
const nonZero = big.filter((value) => value !== 0n);
const fraction = fc.tuple(big, nonZero).map(([n, d]) => Fraction.of(n, d));
const nonZeroFraction = fc.tuple(nonZero, nonZero).map(([n, d]) => Fraction.of(n, d));
const nonNegative = fc
  .tuple(fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.bigInt({ min: 1n, max: 10n ** 12n }))
  .map(([n, d]) => Fraction.of(n, d));

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function isReduced(value: Fraction): boolean {
  return value.den > 0n && gcd(value.num, value.den) === 1n;
}

describe('Fraction', () => {
  it('is kept reduced with a positive denominator', () => {
    expect(Fraction.of(2n, 4n).equals(Fraction.of(1n, 2n))).toBe(true);
    expect(Fraction.of(2n, 4n)).toMatchObject({ num: 1n, den: 2n });
    expect(Fraction.of(1n, -2n)).toMatchObject({ num: -1n, den: 2n });
    expect(Fraction.of(0n, -7n)).toMatchObject({ num: 0n, den: 1n });
    expect(Fraction.whole(5n)).toMatchObject({ num: 5n, den: 1n });
  });

  it('refuses a zero denominator and a division by zero', () => {
    expect(() => Fraction.of(1n, 0n)).toThrow(CalcInputError);
    expect(() => Fraction.whole(1n).div(Fraction.whole(0n))).toThrow(CalcInputError);
  });

  it('is immutable', () => {
    const half = Fraction.of(1n, 2n);
    half.add(Fraction.of(1n, 3n));
    expect(half).toMatchObject({ num: 1n, den: 2n });
    expect(Object.isFrozen(half)).toBe(true);
  });

  // docs/spec/07-journal.md, Calculation rules 10: "rounded only for display: to a
  // whole number, halves up"; docs/spec/edge-cases/calculation.md, row 1.
  it('rounds halves up, once', () => {
    expect(Fraction.of(99n, 2n).roundHalfUp()).toBe(50n);
    expect(Fraction.of(133n, 2n).roundHalfUp()).toBe(67n);
    expect(Fraction.of(167n, 2n).roundHalfUp()).toBe(84n);
    expect(Fraction.of(494999n, 10000n).roundHalfUp()).toBe(49n);
    expect(Fraction.of(130n, 3n).roundHalfUp()).toBe(43n);
    expect(Fraction.whole(0n).roundHalfUp()).toBe(0n);
    expect(Fraction.whole(100n).roundHalfUp()).toBe(100n);
    expect(Fraction.of(1n, 2n).roundHalfUp()).toBe(1n);
  });

  it('refuses to round a negative value', () => {
    expect(() => Fraction.of(-1n, 2n).roundHalfUp()).toThrow(CalcInputError);
  });

  it('gives no mean of nothing', () => {
    expect(Fraction.meanOf([])).toBeNull();
    expect(
      Fraction.meanOf([Fraction.whole(100n), Fraction.whole(50n), Fraction.whole(60n)])?.equals(
        Fraction.whole(70n),
      ),
    ).toBe(true);
  });

  it('keeps every result reduced', () => {
    fc.assert(
      fc.property(fraction, nonZeroFraction, (a, b) =>
        [a, b, a.add(b), a.sub(b), a.mul(b), a.div(b)].every(isReduced),
      ),
    );
  });

  it('adds and multiplies in any order and grouping', () => {
    fc.assert(
      fc.property(fraction, fraction, fraction, (a, b, c) => {
        expect(a.add(b).equals(b.add(a))).toBe(true);
        expect(a.mul(b).equals(b.mul(a))).toBe(true);
        expect(
          a
            .add(b)
            .add(c)
            .equals(a.add(b.add(c))),
        ).toBe(true);
        expect(
          a
            .mul(b)
            .mul(c)
            .equals(a.mul(b.mul(c))),
        ).toBe(true);
      }),
    );
  });

  it('undoes a subtraction and a division exactly', () => {
    fc.assert(
      fc.property(fraction, nonZeroFraction, (a, b) => {
        expect(a.sub(a).isZero()).toBe(true);
        expect(a.sub(b).add(b).equals(a)).toBe(true);
        expect(a.div(b).mul(b).equals(a)).toBe(true);
      }),
    );
  });

  it('compares as cross-multiplication does', () => {
    fc.assert(
      fc.property(fraction, fraction, (a, b) => {
        const left = a.num * b.den;
        const right = b.num * a.den;
        expect(a.compare(b)).toBe(left < right ? -1 : left > right ? 1 : 0);
        expect(a.equals(b)).toBe(left === right);
      }),
    );
  });

  it('rounds to r exactly when r - 1/2 <= x < r + 1/2', () => {
    fc.assert(
      fc.property(nonNegative, (x) => {
        const r = Fraction.whole(x.roundHalfUp());
        const half = Fraction.of(1n, 2n);
        expect(r.sub(half).compare(x)).toBeLessThanOrEqual(0);
        expect(x.compare(r.add(half))).toBe(-1);
      }),
    );
  });

  it('gives a mean that times the count is the sum', () => {
    fc.assert(
      fc.property(fc.array(fraction, { minLength: 1, maxLength: 12 }), (values) => {
        const sum = values.reduce((total, value) => total.add(value), Fraction.whole(0n));
        const mean = Fraction.meanOf(values);
        expect(mean?.mul(Fraction.whole(BigInt(values.length))).equals(sum)).toBe(true);
      }),
    );
  });
});
