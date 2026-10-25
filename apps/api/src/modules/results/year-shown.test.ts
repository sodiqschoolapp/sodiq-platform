import { studentQuarterOutcome, type StudentQuarterOutcome } from '@sodiq/calc';
import { describe, expect, it } from 'vitest';
import { yearShown } from './student-results.service.js';

// Task 9.1: the year result of the student results (docs/spec/07-journal.md, rule 11;
// docs/spec/edge-cases/calculation.md, "The year result when quarters show 50, 50, 49, 50 but
// are exactly 49.5, 49.5, 49.4, 49.5"; docs/spec/edge-cases/academic-year.md, Earlier quarters).
// The quarters' outcomes come from `studentQuarterOutcome` of packages/calc, as the route feeds it.

const QUARTERS = [1, 2, 3, 4].map((number) => ({
  id: `q${String(number)}`,
  number,
  startDate: ['2026-09-01', '2026-11-09', '2027-01-11', '2027-03-30'][number - 1] ?? '',
  endDate: ['2026-10-31', '2026-12-28', '2027-03-20', '2027-05-31'][number - 1] ?? '',
}));

/**
 * One quarter of weights 10 · 50 · 40, attendance 100, classworks 10, 10 and 25 of 30 (a
 * classwork part of 50) and the homework given: 29 of 80 gives exactly 49.5 (the boundary row
 * of edge/calculation), 9 of 25 gives exactly 49.4.
 */
const quarterOf = (homework: { score: number; total: number }): StudentQuarterOutcome =>
  studentQuarterOutcome({
    weights: { attendance: 10, classwork: 50, homework: 40, ratingExam: null },
    attendanceValues: { lateValue: 50, skippedValue: 0 },
    lessons: [
      {
        mark: 1,
        classworks: [
          { score: 10, total: 30 },
          { score: 10, total: 30 },
          { score: 25, total: 30 },
        ],
        homeworks: [homework],
      },
    ],
    ratingExam: null,
    quarterClosed: true,
    heldInJournals: 1,
    countsFrom: null,
    leftSubjectOn: null,
    atLeaving: null,
    decision: null,
  });

const EXEMPT = studentQuarterOutcome({
  weights: { attendance: 10, classwork: 50, homework: 40, ratingExam: null },
  attendanceValues: { lateValue: 50, skippedValue: 0 },
  lessons: [{ mark: 4, classworks: [], homeworks: [] }],
  ratingExam: null,
  quarterClosed: true,
  heldInJournals: 1,
  countsFrom: null,
  leftSubjectOn: null,
  atLeaving: null,
  decision: null,
});

describe('the year result of the student results', () => {
  it('is the mean of the quarters as published: 50, 50, 49, 50 give 50, grade 3', () => {
    const half = quarterOf({ score: 29, total: 80 });
    const below = quarterOf({ score: 9, total: 25 });
    const exact = (one: StudentQuarterOutcome) =>
      one.kind === 'number' ? [one.result.value.num, one.result.value.den] : null;
    expect(exact(half)).toEqual([99n, 2n]);
    expect(exact(below)).toEqual([247n, 5n]);
    expect(
      yearShown(
        null,
        QUARTERS,
        new Map([
          [1, half],
          [2, half],
          [3, below],
          [4, half],
        ]),
      ),
    ).toEqual({ kind: 'number', shown: 50, grade: 3, basedOn: 4 });
  });

  it('leaves an "Exempt" quarter, a quarter with no result and one not in the system out, "based on n of 4"', () => {
    const half = quarterOf({ score: 29, total: 80 });
    expect(
      yearShown(
        null,
        QUARTERS,
        new Map([
          [1, half],
          [2, EXEMPT],
          [3, half],
        ]),
      ),
    ).toEqual({ kind: 'number', shown: 50, grade: 3, basedOn: 2 });
    // Going live on 10 November: quarter 1 is not in the system, whatever it holds.
    expect(
      yearShown(
        '2026-11-10',
        QUARTERS,
        new Map([
          [1, half],
          [2, EXEMPT],
          [3, below()],
        ]),
      ),
    ).toEqual({ kind: 'number', shown: 49, grade: 2, basedOn: 1 });
    expect(yearShown(null, QUARTERS, new Map([[2, EXEMPT]]))).toEqual({ kind: 'no_result' });
  });
});

function below(): StudentQuarterOutcome {
  return quarterOf({ score: 9, total: 25 });
}
