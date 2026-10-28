import { Fraction } from '@sodiq/calc';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decode, encode } from './codec.js';

const roundTrip = (value: unknown): unknown => decode(JSON.parse(JSON.stringify(encode(value))));

describe('the codec of prepared totals (task 9.3b-1)', () => {
  it('keeps an exact fraction above 2^53 without floating point (review correction 4)', () => {
    const big = 2n ** 80n + 7n;
    const value = Fraction.of(big, 3n);
    const back = roundTrip(value);
    expect(back).toBeInstanceOf(Fraction);
    expect((back as Fraction).num).toBe(value.num);
    expect((back as Fraction).den).toBe(value.den);
    expect(roundTrip(big)).toBe(big);
  });

  it('keeps every fraction exactly (CLAUDE.md, exact arithmetic)', () => {
    fc.assert(
      fc.property(
        fc.bigInt(),
        fc.bigInt().filter((den) => den !== 0n),
        (num, den) => {
          const value = Fraction.of(num, den);
          const back = roundTrip(value) as Fraction;
          expect(back.num).toBe(value.num);
          expect(back.den).toBe(value.den);
        },
      ),
    );
  });

  it('keeps moments, maps, sets, undefined and plain objects, with tag-like field names', () => {
    const value = {
      at: new Date('2026-10-28T08:30:00.000Z'),
      byStudent: new Map([['a', { $f: 'not a tag', n: 1 }]]),
      students: new Set(['x', 'y']),
      missing: undefined,
      list: [1, null, undefined, 'z', true],
    };
    expect(roundTrip(value)).toEqual(value);
  });

  it('refuses an object of another class and a number that is not finite', () => {
    class Other {
      readonly a = 1;
    }
    expect(() => encode(new Other())).toThrow();
    expect(() => encode(Number.NaN)).toThrow();
  });

  it('refuses a whole number written as a floating-point text', () => {
    expect(() => decode({ $b: '1e3' })).toThrow();
    expect(() => decode({ $f: ['1.5', '2'] })).toThrow();
  });
});
