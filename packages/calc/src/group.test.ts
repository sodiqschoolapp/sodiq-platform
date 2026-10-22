import { describe, expect, it } from 'vitest';
import { Fraction } from './fraction.js';
import { groupAverage } from './group.js';

// docs/spec/edge-cases/calculation.md, "A student moved from one group to another in week 6":
// "Class, group and teacher averages are the mean of the results of students who are members
// on the reference date; each student counts once." edge/00-definitions, Result states: "Only a
// number is graded, averaged or ranked." Task 6.2, decisions 5 and 6.
describe('groupAverage', () => {
  it('is the exact mean of the students counted, rounded once at the end', () => {
    // 49.5 and 50 give 49.75, shown 50; rounding each first would give 50 too, so also 49.5 alone.
    const average = groupAverage([Fraction.of(99n, 2n), Fraction.whole(50n)]);
    expect(average?.value.equals(Fraction.of(199n, 4n))).toBe(true);
    expect(average?.shown).toBe(50n);
    expect(groupAverage([Fraction.of(99n, 2n)])?.shown).toBe(50n);
  });

  it('rounds the exact mean, not the rounded figures', () => {
    // Shown 50, 50 and 49 would average 49.67, shown 50; the exact 49.4, 49.4, 49.4 give 49.
    const average = groupAverage([
      Fraction.of(247n, 5n),
      Fraction.of(247n, 5n),
      Fraction.of(247n, 5n),
    ]);
    expect(average?.shown).toBe(49n);
  });

  it('counts each value once and gives null for none', () => {
    expect(groupAverage([])).toBeNull();
    expect(groupAverage([Fraction.whole(100n), Fraction.whole(0n)])?.shown).toBe(50n);
  });

  it('refuses a value below 0', () => {
    expect(() => groupAverage([Fraction.of(-1n, 1n)])).toThrow();
  });
});
