import { describe, expect, it } from 'vitest';
import {
  currentAbsenceRun,
  currentWorkFigure,
  earlyWarningReasons,
  MIN_GRADED_WORKS,
  ownGradedWorks,
  type EarlyWarningInput,
} from './early-warning.js';
import { Fraction } from './fraction.js';
import type { ResultFlag, StudentQuarterOutcome } from './outcome.js';
import type { QuarterLesson } from './quarter.js';

const values = { lateValue: 50, skippedValue: 0 };

const lesson = (
  mark: QuarterLesson['mark'],
  classworks: (number | null)[] = [],
  homeworks: (number | null)[] = [],
): QuarterLesson => ({
  mark,
  classworks: classworks.map((score) => ({ total: 100, score })),
  homeworks: homeworks.map((score) => ({ total: 100, score })),
});

const thresholds = { lowResult: 50, resultDrop: 15, attendancePercent: 80, absencesInRow: 3 };

function numberOutcome(value: Fraction, flags: ResultFlag[] = []): StudentQuarterOutcome {
  return {
    kind: 'number',
    basedOn: { expected: 10, held: 10 },
    from: null,
    leftSubjectOn: null,
    atLeaving: null,
    flags,
    staleDecision: false,
    decision: null,
    undecided: flags.length > 0,
    result: {
      kind: 'number',
      value,
      shown: value.roundHalfUp(),
      grade: 3,
      averages: { attendance: null, classwork: null, homework: null, ratingExam: null },
      leftOut: [],
      provisional: true,
    },
  };
}

const base: EarlyWarningInput = {
  thresholds,
  gradedWorks: MIN_GRADED_WORKS,
  outcome: null,
  currentWork: { now: null, daysAgo: null, previousQuarter: null },
  attendance: null,
  absenceRun: 0,
};

const kinds = (input: EarlyWarningInput) =>
  earlyWarningReasons(input).reasons.map((reason) => reason.kind);

describe('currentWorkFigure: attendance, classwork, homework, no exam (edge/calculation)', () => {
  it('leaves the rating exam out and scales the other weights up', () => {
    // Weights 20 · 20 · 20 · 40; attendance 100, classwork 50, homework 30: (100 + 50 + 30) ÷ 3 = 60.
    const figure = currentWorkFigure({
      weights: { attendance: 20, classwork: 20, homework: 20, ratingExam: 40 },
      attendanceValues: values,
      lessons: [lesson(1, [50], [30])],
      quarterClosed: false,
    });
    expect(figure?.equals(Fraction.whole(60n))).toBe(true);
  });

  it('is the weighted figure of a subject without a rating exam', () => {
    // Weights 20 · 40 · 40; attendance 100, classwork 50, homework 25: 20 + 20 + 10 = 50.
    const figure = currentWorkFigure({
      weights: { attendance: 20, classwork: 40, homework: 40, ratingExam: null },
      attendanceValues: values,
      lessons: [lesson(1, [50], [25])],
      quarterClosed: false,
    });
    expect(figure?.equals(Fraction.whole(50n))).toBe(true);
  });

  it('is null with no part', () => {
    expect(
      currentWorkFigure({
        weights: { attendance: 20, classwork: 20, homework: 20, ratingExam: 40 },
        attendanceValues: values,
        lessons: [],
        quarterClosed: false,
      }),
    ).toBeNull();
  });

  it('leaves exempt lessons out (07, Effect on totals)', () => {
    const figure = currentWorkFigure({
      weights: { attendance: 50, classwork: 49, homework: 1, ratingExam: null },
      attendanceValues: values,
      lessons: [lesson(1, [80]), lesson(4), lesson(5)],
      quarterClosed: false,
    });
    // attendance 100 and classwork 80 only, no homework: (50 × 100 + 49 × 80) ÷ 99.
    expect(figure?.equals(Fraction.of(8920n, 99n))).toBe(true);
  });
});

describe('ownGradedWorks: "Five graded works" counts the student\'s own works', () => {
  it('counts the works with a number, a 0 included, and not the empty ones', () => {
    expect(
      ownGradedWorks([lesson(1, [0, null], [40]), lesson(0, [10]), lesson(2, [], [null])]),
    ).toBe(3);
  });

  it('leaves out the lessons of an exemption', () => {
    expect(ownGradedWorks([lesson(4), lesson(5), lesson(1, [70])])).toBe(1);
  });
});

describe('currentAbsenceRun: edge/journal, "Three absences in a row"', () => {
  const marks = (...list: QuarterLesson['mark'][]) => list.map((mark) => ({ mark }));

  it('counts back from the latest lesson marked 0 or 3', () => {
    expect(currentAbsenceRun(marks(1, 0, 3, 0))).toEqual({ length: 3, start: 1 });
  });

  it('exempt lessons neither break nor extend the run', () => {
    expect(currentAbsenceRun(marks(1, 0, 4, 3, 5, 0))).toEqual({ length: 3, start: 1 });
  });

  it('a present or late lesson ends the run', () => {
    expect(currentAbsenceRun(marks(0, 0, 0, 1))).toEqual({ length: 0, start: null });
    expect(currentAbsenceRun(marks(0, 0, 2, 0))).toEqual({ length: 1, start: 3 });
  });

  it('an unmarked held lesson ends the run (plan decision 8)', () => {
    expect(currentAbsenceRun(marks(0, 0, null, 0, 3))).toEqual({ length: 2, start: 3 });
  });
});

describe('earlyWarningReasons (08, Early-warning list)', () => {
  it('a subject with fewer than five graded works lists nobody, whatever its figures', () => {
    const all: EarlyWarningInput = {
      ...base,
      outcome: numberOutcome(Fraction.whole(20n)),
      currentWork: {
        now: Fraction.whole(20n),
        daysAgo: Fraction.whole(90n),
        previousQuarter: null,
      },
      attendance: Fraction.whole(10n),
      absenceRun: 5,
    };
    expect(earlyWarningReasons({ ...all, gradedWorks: 4 })).toEqual({ judged: false, reasons: [] });
    expect(kinds(all)).toEqual(['low_result', 'result_drop', 'low_attendance', 'absences_in_row']);
  });

  it('"below 50" uses the rounded number: 49.5 is shown 50 and not listed', () => {
    expect(kinds({ ...base, outcome: numberOutcome(Fraction.of(99n, 2n)) })).toEqual([]);
    expect(kinds({ ...base, outcome: numberOutcome(Fraction.of(4949n, 100n)) })).toEqual([
      'low_result',
    ]);
  });

  it('only a number raises a low result', () => {
    const exempt: StudentQuarterOutcome = {
      kind: 'exempt',
      cause: 'no_lesson_remains',
      basedOn: { expected: 0, held: 10 },
      from: null,
      leftSubjectOn: null,
      atLeaving: null,
      flags: [],
      staleDecision: false,
    };
    expect(kinds({ ...base, outcome: exempt })).toEqual([]);
  });

  it('a drop of 15 points by the rounded figures, against 28 days ago or the previous quarter', () => {
    // 75.5 is shown 76, 60.5 is shown 61: 15 points.
    const now = Fraction.of(121n, 2n);
    const listed = earlyWarningReasons({
      ...base,
      currentWork: { now, daysAgo: Fraction.of(151n, 2n), previousQuarter: Fraction.whole(70n) },
    });
    expect(listed.reasons).toEqual([{ kind: 'result_drop', points: 15n, against: ['days_ago'] }]);
    // 75.4 is shown 75: 14 points, not listed.
    expect(
      kinds({
        ...base,
        currentWork: { now, daysAgo: Fraction.of(754n, 10n), previousQuarter: null },
      }),
    ).toEqual([]);
    const both = earlyWarningReasons({
      ...base,
      currentWork: { now, daysAgo: Fraction.whole(80n), previousQuarter: Fraction.whole(90n) },
    });
    expect(both.reasons).toEqual([
      { kind: 'result_drop', points: 29n, against: ['days_ago', 'previous_quarter'] },
    ]);
  });

  it('a result flagged "based on few lessons" is not listed as a drop', () => {
    expect(
      kinds({
        ...base,
        outcome: numberOutcome(Fraction.whole(60n), ['few_lessons']),
        currentWork: {
          now: Fraction.whole(60n),
          daysAgo: Fraction.whole(90n),
          previousQuarter: null,
        },
      }),
    ).toEqual([]);
    expect(
      kinds({
        ...base,
        outcome: numberOutcome(Fraction.whole(60n), ['attendance_only']),
        currentWork: {
          now: Fraction.whole(60n),
          daysAgo: Fraction.whole(90n),
          previousQuarter: null,
        },
      }),
    ).toEqual(['result_drop']);
  });

  it('attendance below 80 percent, rounded', () => {
    expect(kinds({ ...base, attendance: Fraction.of(795n, 10n) })).toEqual([]);
    expect(kinds({ ...base, attendance: Fraction.of(794n, 10n) })).toEqual(['low_attendance']);
  });

  it('three absences in a row, at the threshold or longer', () => {
    expect(kinds({ ...base, absenceRun: 2 })).toEqual([]);
    expect(earlyWarningReasons({ ...base, absenceRun: 3 }).reasons).toEqual([
      { kind: 'absences_in_row', length: 3n },
    ]);
  });

  it('takes the branch thresholds', () => {
    expect(
      kinds({
        ...base,
        thresholds: { ...thresholds, lowResult: 61, absencesInRow: 5 },
        outcome: numberOutcome(Fraction.whole(60n)),
        absenceRun: 4,
      }),
    ).toEqual(['low_result']);
  });

  it('refuses thresholds out of their bounds', () => {
    expect(() =>
      earlyWarningReasons({ ...base, thresholds: { ...thresholds, absencesInRow: 31 } }),
    ).toThrow();
    expect(() =>
      earlyWarningReasons({ ...base, thresholds: { ...thresholds, lowResult: 0 } }),
    ).toThrow();
    expect(() => earlyWarningReasons({ ...base, gradedWorks: -1 })).toThrow();
  });
});
