import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Fraction } from './fraction.js';
import type { ResultFlag, StudentQuarterOutcome } from './outcome.js';
import { classFigure, oneDecimal, ratingPlaces, subjectsFigure } from './rating.js';

interface Labels {
  readonly basedOn: { readonly expected: number; readonly held: number };
  readonly from: string | null;
  readonly leftSubjectOn: string | null;
  readonly atLeaving: string | null;
  readonly flags: readonly ResultFlag[];
  readonly staleDecision: boolean;
}

const labels: Labels = {
  basedOn: { expected: 10, held: 10 },
  from: null,
  leftSubjectOn: null,
  atLeaving: null,
  flags: [],
  staleDecision: false,
};

/** A number outcome of the exact value given (the rest of the result does not matter here). */
function numberOf(value: Fraction, extra: Partial<Labels> = {}): StudentQuarterOutcome {
  return {
    ...labels,
    ...extra,
    kind: 'number',
    decision: null,
    undecided: false,
    result: {
      kind: 'number',
      value,
      shown: value.roundHalfUp(),
      grade: 5,
      averages: { attendance: null, classwork: null, homework: null, ratingExam: null },
      leftOut: [],
      provisional: false,
    },
  };
}

const exempt: StudentQuarterOutcome = { ...labels, kind: 'exempt', cause: 'no_lesson_remains' };
const notAssessed: StudentQuarterOutcome = { ...labels, kind: 'not_assessed' };
const noResult: StudentQuarterOutcome = { ...labels, kind: 'no_result' };

// docs/spec/edge-cases/calculation.md, "Two students both show 84": "Order is by the exact value.
// Students share a place only when exactly equal, and places are numbered 1, 1, 3."
describe('ratingPlaces', () => {
  it('orders by the exact value, not the figure shown', () => {
    // Both show 84.0 with one decimal; 84.04 is above 84.
    const places = ratingPlaces([
      { id: 'a', value: Fraction.whole(84n) },
      { id: 'b', value: Fraction.of(8404n, 100n) },
    ]);
    expect(places.map((one) => [one.id, one.place])).toEqual([
      ['b', 1],
      ['a', 2],
    ]);
  });

  it('shares a place only when exactly equal, numbered 1, 1, 3', () => {
    const places = ratingPlaces([
      { id: 'c', value: Fraction.of(169n, 2n) },
      { id: 'a', value: Fraction.of(169n, 2n) },
      { id: 'b', value: Fraction.of(338n, 4n) },
      { id: 'd', value: Fraction.whole(70n) },
    ]);
    expect(places.map((one) => [one.id, one.place])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 1],
      ['d', 4],
    ]);
    const three = ratingPlaces([
      { id: 'a', value: Fraction.whole(90n) },
      { id: 'b', value: Fraction.whole(90n) },
      { id: 'c', value: Fraction.whole(80n) },
    ]);
    expect(three.map((one) => one.place)).toEqual([1, 1, 3]);
  });

  // edge/00-definitions, Result states: "Only a number is graded, averaged or ranked."
  it('lists an entry without a number after the ranked ones, with no place', () => {
    const places = ratingPlaces([
      { id: 'n', value: null },
      { id: 'a', value: Fraction.whole(50n) },
    ]);
    expect(places.map((one) => [one.id, one.place])).toEqual([
      ['a', 1],
      ['n', null],
    ]);
  });

  it('gives a place one more than the count of strictly greater values', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 1, max: 4 })), {
          maxLength: 25,
        }),
        (pairs) => {
          const entries = pairs.map(([num, den], index) => ({
            id: String(index).padStart(3, '0'),
            value: Fraction.of(BigInt(num), BigInt(den)),
          }));
          const places = ratingPlaces(entries);
          expect(places).toHaveLength(entries.length);
          let previous = 0;
          for (const one of places) {
            const value = entries.find((entry) => entry.id === one.id)?.value;
            if (value === undefined || one.place === null) throw new Error('lost an entry');
            const greater = entries.filter((entry) => entry.value.compare(value) > 0).length;
            expect(one.place).toBe(greater + 1);
            expect(one.place).toBeGreaterThanOrEqual(previous);
            previous = one.place;
          }
        },
      ),
    );
  });
});

// edge/calculation, "Two students both show 84": "Rating lists show one decimal"; `07` rule 10,
// halves up.
describe('oneDecimal', () => {
  it('rounds once to tenths, halves up', () => {
    expect(oneDecimal(Fraction.of(8425n, 100n))).toBe(843n);
    expect(oneDecimal(Fraction.of(4995n, 100n))).toBe(500n);
    expect(oneDecimal(Fraction.of(8424n, 100n))).toBe(842n);
    expect(oneDecimal(Fraction.of(1n, 3n))).toBe(3n);
  });
});

// edge/calculation, "One student has 9 subjects, another 11": "The all-subject figure is the plain
// mean of the graded subjects that have a number, with the count of subjects shown." `07`, Effect
// on totals, Rating: "Across subjects, the mean covers the subjects that have a result, and the
// student is marked as having fewer subjects."
describe('subjectsFigure', () => {
  it('is the plain exact mean of the subjects with a number, with their count', () => {
    const nine = Array.from({ length: 9 }, (_, index) =>
      numberOf(Fraction.whole(BigInt(60 + index))),
    );
    const eleven = Array.from({ length: 11 }, () => numberOf(Fraction.of(161n, 2n)));
    expect(subjectsFigure(nine)).toEqual({
      value: Fraction.whole(64n),
      subjects: 9,
      fewerSubjects: false,
    });
    const figure = subjectsFigure(eleven);
    expect(figure.value?.equals(Fraction.of(161n, 2n))).toBe(true);
    expect(figure.subjects).toBe(11);
  });

  it('keeps the exact values, not the published whole numbers', () => {
    // 49.5 and 49.4 publish as 50 and 49 (mean 49.5); exactly they are 49.45.
    const figure = subjectsFigure([
      numberOf(Fraction.of(99n, 2n)),
      numberOf(Fraction.of(247n, 5n)),
    ]);
    expect(figure.value?.equals(Fraction.of(989n, 20n))).toBe(true);
  });

  it('leaves out an "Exempt", a "Not assessed" and a "No result" and marks fewer subjects', () => {
    const figure = subjectsFigure([
      numberOf(Fraction.whole(80n)),
      numberOf(Fraction.whole(60n)),
      exempt,
      notAssessed,
      noResult,
    ]);
    expect(figure).toEqual({ value: Fraction.whole(70n), subjects: 2, fewerSubjects: true });
  });

  // Decided without the owner, decision 5: an undecided flagged result is a number until the
  // close decides it; a "left the subject" number counts in the mean.
  it('counts an undecided flagged number and a "left the subject" number', () => {
    const flagged: StudentQuarterOutcome = {
      ...numberOf(Fraction.whole(40n), { flags: ['few_lessons'] }),
      kind: 'number',
      decision: null,
      undecided: true,
    } as StudentQuarterOutcome;
    const left = numberOf(Fraction.whole(80n), {
      flags: ['left_subject'],
      leftSubjectOn: '2026-10-01',
    });
    expect(subjectsFigure([flagged, left])).toEqual({
      value: Fraction.whole(60n),
      subjects: 2,
      fewerSubjects: false,
    });
  });

  it('has no value when no subject has a number', () => {
    expect(subjectsFigure([exempt, noResult])).toEqual({
      value: null,
      subjects: 0,
      fewerSubjects: true,
    });
    expect(subjectsFigure([])).toEqual({ value: null, subjects: 0, fewerSubjects: false });
  });

  // edge/calculation, "A student left the school before the quarter ended": "left out of ...
  // rating".
  it('refuses an outcome at leaving: such a student is left out before', () => {
    expect(() =>
      subjectsFigure([numberOf(Fraction.whole(50n), { atLeaving: '2026-10-10' })]),
    ).toThrow();
  });
});

// `08`, Rating: "Classes in a grade and in the branch: ordered by the mean result of their
// students"; edge/calculation, week 6: "each student counts once".
describe('classFigure', () => {
  it('is the exact mean of the students with a figure', () => {
    expect(
      classFigure([Fraction.of(99n, 2n), Fraction.whole(50n), null])?.equals(Fraction.of(199n, 4n)),
    ).toBe(true);
    expect(classFigure([null])).toBeNull();
    expect(classFigure([])).toBeNull();
  });
});
