/**
 * The rating (task 9.3a; docs/spec/08-results-rating-analytics.md, Rating;
 * docs/spec/07-journal.md, Effect on totals, Rating; edge/calculation, "Which value gives the
 * grade?", "Two students both show 84", "One student has 9 subjects, another 11").
 *
 * - Places: ordered by the exact value; students share a place only when exactly equal, and
 *   places are numbered 1, 1, 3. Only a number is ranked (edge/00-definitions, Result states);
 *   an entry without one comes after, with no place.
 * - One decimal: the figure a rating list shows, rounded once, halves up (rule 10). Ranking never
 *   uses it.
 * - The all-subject figure of a student: the plain mean of the exact quarter results of the graded
 *   subjects that have a number, with their count; "fewer subjects" when a graded subject of the
 *   student has none (plan decisions 2, 3 and 5: an undecided flagged number counts until the
 *   close decides it). A result at leaving is never rated: the caller leaves such a student out.
 * - A class's figure: the exact mean of its counted students' all-subject figures, each once.
 */
import { Fraction } from './fraction.js';
import { CalcInputError } from './input.js';
import type { StudentQuarterOutcome } from './outcome.js';

export interface RatingEntry {
  readonly id: string;
  readonly value: Fraction | null;
}

export interface RatingPlace {
  readonly id: string;
  readonly value: Fraction | null;
  /** `null` for an entry without a number. */
  readonly place: number | null;
}

/** The entries in rating order with their places; equal values in the order of their ids. */
export function ratingPlaces(entries: readonly RatingEntry[]): RatingPlace[] {
  const byId = (a: RatingEntry, b: RatingEntry) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const ranked = entries
    .flatMap((entry) => (entry.value === null ? [] : [{ id: entry.id, value: entry.value }]))
    .sort((a, b) => b.value.compare(a.value) || byId(a, b));
  const places: RatingPlace[] = [];
  ranked.forEach((entry, index) => {
    const before = places[index - 1];
    const shared =
      before !== undefined && before.value !== null && before.value.compare(entry.value) === 0;
    places.push({ ...entry, place: shared ? before.place : index + 1 });
  });
  const unranked = entries.filter((entry) => entry.value === null).sort(byId);
  return [...places, ...unranked.map((entry) => ({ ...entry, place: null }))];
}

const TEN = Fraction.whole(10n);

/** The figure in tenths, rounded once, halves up: 84.25 gives 843 (84.3). */
export function oneDecimal(value: Fraction): bigint {
  return value.mul(TEN).roundHalfUp();
}

export interface SubjectsFigure {
  readonly value: Fraction | null;
  /** The subjects with a number. */
  readonly subjects: number;
  readonly fewerSubjects: boolean;
}

/** A student's figure across the graded subjects of a quarter, one outcome per subject. */
export function subjectsFigure(outcomes: readonly StudentQuarterOutcome[]): SubjectsFigure {
  const numbers: Fraction[] = [];
  for (const outcome of outcomes) {
    if (outcome.atLeaving !== null) {
      throw new CalcInputError('rating_at_leaving', 'A result at leaving is not rated.');
    }
    if (outcome.kind === 'number') numbers.push(outcome.result.value);
  }
  return {
    value: Fraction.meanOf(numbers),
    subjects: numbers.length,
    fewerSubjects: numbers.length < outcomes.length,
  };
}

/** A class's figure: the mean of its students' figures that are numbers. */
export function classFigure(students: readonly (Fraction | null)[]): Fraction | null {
  return Fraction.meanOf(students.flatMap((value) => (value === null ? [] : [value])));
}
