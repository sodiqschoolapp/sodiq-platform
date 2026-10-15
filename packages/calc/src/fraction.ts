/**
 * An exact fraction: a `bigint` numerator over a positive `bigint` denominator,
 * always reduced (docs/spec/edge-cases/developer-rules.md, Calculation: "Exact
 * fractions (integer numerator and denominator) from typed number and total to
 * the result"; docs/spec/14-quality-plan.md: "never floating point and never
 * fixed-precision decimals"). A value never changes; every operation gives a new
 * one. Equality is by the reduced form (task 4.1, decision 12).
 *
 * The only way out to a person is `roundHalfUp`, the one rounding at the end
 * (docs/spec/07-journal.md, Calculation rules 10). No float or string conversion
 * is offered.
 */
import { CalcInputError } from './input.js';

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

export class Fraction {
  readonly num: bigint;
  readonly den: bigint;

  private constructor(num: bigint, den: bigint) {
    if (den === 0n) {
      throw new CalcInputError('zero_denominator', 'A fraction cannot have a denominator of 0.');
    }
    const sign = den < 0n ? -1n : 1n;
    // gcd(num, den) is never 0 here: den is not 0.
    const divisor = gcd(num, den);
    this.num = (sign * num) / divisor;
    this.den = (sign * den) / divisor;
    Object.freeze(this);
  }

  /** `num / den`, reduced. */
  static of(num: bigint, den: bigint): Fraction {
    return new Fraction(num, den);
  }

  /** A whole number as a fraction. */
  static whole(value: bigint): Fraction {
    return new Fraction(value, 1n);
  }

  /** The mean of the values, each counted once; `null` for no values. */
  static meanOf(values: readonly Fraction[]): Fraction | null {
    if (values.length === 0) return null;
    const sum = values.reduce((total, value) => total.add(value), Fraction.whole(0n));
    return sum.div(Fraction.whole(BigInt(values.length)));
  }

  add(other: Fraction): Fraction {
    return new Fraction(this.num * other.den + other.num * this.den, this.den * other.den);
  }

  sub(other: Fraction): Fraction {
    return new Fraction(this.num * other.den - other.num * this.den, this.den * other.den);
  }

  mul(other: Fraction): Fraction {
    return new Fraction(this.num * other.num, this.den * other.den);
  }

  div(other: Fraction): Fraction {
    if (other.num === 0n) {
      throw new CalcInputError('zero_denominator', 'A fraction cannot be divided by 0.');
    }
    return new Fraction(this.num * other.den, this.den * other.num);
  }

  /** -1, 0 or 1 as this is below, equal to or above `other`. */
  compare(other: Fraction): -1 | 0 | 1 {
    const left = this.num * other.den;
    const right = other.num * this.den;
    return left < right ? -1 : left > right ? 1 : 0;
  }

  equals(other: Fraction): boolean {
    return this.num === other.num && this.den === other.den;
  }

  isZero(): boolean {
    return this.num === 0n;
  }

  /**
   * The whole number shown: halves up, `floor(x + 1/2)` (docs/spec/07-journal.md,
   * Calculation rules 10; task 4.1, decision 4). Every value of the module is 0 or
   * more, so a negative value is a fault and is refused; for 0 or more, `bigint`
   * division (which truncates) is the floor.
   */
  roundHalfUp(): bigint {
    if (this.num < 0n) {
      throw new CalcInputError('negative_rounding', 'Only a value of 0 or more is rounded.');
    }
    return (2n * this.num + this.den) / (2n * this.den);
  }
}
