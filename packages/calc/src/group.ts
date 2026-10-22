/**
 * The average of a class or group (docs/spec/07-journal.md, Layout, Bottom row:
 * "Class or group averages"; docs/spec/edge-cases/calculation.md, "A student moved
 * from one group to another in week 6": "Class, group and teacher averages are the
 * mean of the results of students who are members on the reference date; each
 * student counts once"; task 6.2, decisions 5 and 6).
 *
 * The caller passes one exact figure per student counted (the members on the
 * reference date whose figure is a number: edge/00-definitions, Result states,
 * "Only a number is graded, averaged or ranked"). The mean is kept exact and
 * rounded once, halves up (rule 10).
 */
import { Fraction } from './fraction.js';

export interface GroupAverage {
  readonly value: Fraction;
  /** The whole number shown, halves up. */
  readonly shown: bigint;
}

export function groupAverage(values: readonly Fraction[]): GroupAverage | null {
  const value = Fraction.meanOf(values);
  if (value === null) return null;
  return { value, shown: value.roundHalfUp() };
}
