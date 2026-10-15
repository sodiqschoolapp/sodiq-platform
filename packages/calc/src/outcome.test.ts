import { describe, expect, it } from 'vitest';
import type { AttendanceMark } from './attendance.js';
import { Fraction } from './fraction.js';
import { CalcInputError } from './input.js';
import {
  outcomeForYear,
  studentQuarterOutcome,
  type StudentQuarterInput,
  type StudentQuarterOutcome,
} from './outcome.js';
import type { QuarterLesson, QuarterWeights } from './quarter.js';
import { yearResult } from './year.js';

const VALUES = { lateValue: 50, skippedValue: 0 };
const NO_RATING: QuarterWeights = { attendance: 20, classwork: 30, homework: 50, ratingExam: null };
const WITH_RATING: QuarterWeights = { attendance: 20, classwork: 20, homework: 20, ratingExam: 40 };

function lesson(
  mark: AttendanceMark | null,
  classwork: number | null = null,
  homework: number | null = null,
  countsForAttendance = true,
): QuarterLesson {
  return {
    mark,
    countsForAttendance,
    classworks: classwork === null ? [] : [{ score: classwork, total: 100 }],
    homeworks: homework === null ? [] : [{ score: homework, total: 100 }],
  };
}

function times(count: number, make: () => QuarterLesson): QuarterLesson[] {
  return Array.from({ length: count }, make);
}

function input(overrides: Partial<StudentQuarterInput>): StudentQuarterInput {
  const lessons = overrides.lessons ?? [];
  return {
    weights: NO_RATING,
    attendanceValues: VALUES,
    lessons,
    ratingExam: null,
    quarterClosed: false,
    heldInJournals: lessons.length,
    countsFrom: null,
    leftSubjectOn: null,
    atLeaving: null,
    decision: null,
    ...overrides,
  };
}

function numberOf(outcome: StudentQuarterOutcome) {
  if (outcome.kind !== 'number') throw new Error(`expected a number, got ${outcome.kind}`);
  return outcome;
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof CalcInputError) return error.code;
    throw error;
  }
  return undefined;
}

// docs/spec/07-journal.md, Exemptions, Effect on totals, Quarter result: "Calculated from the
// remaining lessons. If none remain, the result is 'Exempt': no number and no grade."
describe('07 Effect on totals: the quarter result of an exempt student', () => {
  it('is Exempt when every lesson is exempt, marks 4 and 5 mixed', () => {
    const outcome = studentQuarterOutcome(
      input({ lessons: [lesson(4), lesson(5), lesson(4)], heldInJournals: 3 }),
    );
    expect(outcome).toMatchObject({
      kind: 'exempt',
      cause: 'no_lesson_remains',
      flags: [],
      basedOn: { expected: 0, held: 3 },
    });
  });

  // Decision 1: whatever the rating entry; a later sitting does not make a lesson remain.
  it.each([
    [{ kind: 'score', score: 70 }],
    [{ kind: 'did_not_sit' }],
    [{ kind: 'exempt' }],
    [null],
  ] as const)('is Exempt with every lesson exempt and the rating entry %j', (ratingExam) => {
    const outcome = studentQuarterOutcome(
      input({ weights: WITH_RATING, lessons: [lesson(5), lesson(5)], ratingExam }),
    );
    expect(outcome.kind).toBe('exempt');
  });

  it('is a number with the few-lessons flag, "based on 1 of 40", when one lesson of 40 remains', () => {
    const outcome = numberOf(
      studentQuarterOutcome(
        input({ lessons: [lesson(1, 80, 80), ...times(39, () => lesson(4))], heldInJournals: 40 }),
      ),
    );
    expect(outcome.flags).toEqual(['few_lessons']);
    expect(outcome.basedOn).toEqual({ expected: 1, held: 40 });
    expect(outcome.undecided).toBe(true);
    expect(outcome.result.shown).toBe(84n);
  });

  it.each([
    ['exempt', 'exempt'],
    ['not_assessed', 'not_assessed'],
    ['keep', 'number'],
  ] as const)('applies the decision %s on that flagged result', (decision, kind) => {
    const outcome = studentQuarterOutcome(
      input({
        lessons: [lesson(1, 80, 80), ...times(39, () => lesson(4))],
        heldInJournals: 40,
        decision,
      }),
    );
    expect(outcome.kind).toBe(kind);
    expect(outcome.staleDecision).toBe(false);
    if (outcome.kind === 'exempt') expect(outcome.cause).toBe('decided');
    if (outcome.kind === 'number') {
      expect(outcome.decision).toBe('keep');
      expect(outcome.undecided).toBe(false);
    }
  });
});

// edge/calculation, "Nothing at all was entered for a student."
describe('edge/calculation: nothing entered', () => {
  it('is No result, not 0, when held lessons have no data and no exemption', () => {
    const outcome = studentQuarterOutcome(input({ lessons: times(10, () => lesson(null)) }));
    expect(outcome.kind).toBe('no_result');
    expect(outcome.basedOn).toEqual({ expected: 10, held: 10 });
  });

  it('is No result when the student has no lesson at all', () => {
    expect(studentQuarterOutcome(input({ heldInJournals: 0 })).kind).toBe('no_result');
  });
});

// edge/calculation, "A student attends one lesson of forty, with no graded work, and gets 100.
// Another is absent all quarter and gets 0, grade 2, without ever being assessed."
describe('edge/calculation: a result on attendance alone', () => {
  it('flags one lesson of forty attended with no graded work, with the few-lessons flag', () => {
    const outcome = numberOf(
      studentQuarterOutcome(input({ lessons: [lesson(1)], heldInJournals: 40 })),
    );
    expect(outcome.result.shown).toBe(100n);
    expect(outcome.flags).toEqual(['few_lessons', 'attendance_only']);
    expect(outcome.undecided).toBe(true);
  });

  it('flags a student absent all quarter with "did not sit" in a rating subject (decision 4)', () => {
    const outcome = numberOf(
      studentQuarterOutcome(
        input({
          weights: WITH_RATING,
          lessons: times(40, () => lesson(0)),
          ratingExam: { kind: 'did_not_sit' },
        }),
      ),
    );
    expect(outcome.result.shown).toBe(0n);
    expect(outcome.result.grade).toBe(2);
    expect(outcome.flags).toEqual(['attendance_only']);
    expect(outcome.basedOn).toEqual({ expected: 40, held: 40 });
  });

  it('flags a student absent all quarter in a subject without a rating exam', () => {
    const outcome = numberOf(studentQuarterOutcome(input({ lessons: times(40, () => lesson(0)) })));
    expect(outcome.flags).toEqual(['attendance_only']);
  });

  it.each([
    ['a typed classwork 0', [lesson(0, 0)], null],
    ['a homework number', [lesson(0, null, 40)], null],
    ['a rating score', [lesson(0)], { kind: 'score', score: 30 }],
  ] as const)('is not attendance alone with %s', (_label, lessons, ratingExam) => {
    const outcome = numberOf(
      studentQuarterOutcome(input({ weights: WITH_RATING, lessons, ratingExam })),
    );
    expect(outcome.flags).toEqual([]);
    expect(outcome.undecided).toBe(false);
  });

  it.each(['keep', 'not_assessed'] as const)('takes the decision %s', (decision) => {
    const outcome = studentQuarterOutcome(input({ lessons: times(40, () => lesson(0)), decision }));
    expect(outcome.kind).toBe(decision === 'keep' ? 'number' : 'not_assessed');
    expect(outcome.staleDecision).toBe(false);
  });

  it('does not apply Exempt there: no exemption explains it (decision 3)', () => {
    const outcome = numberOf(
      studentQuarterOutcome(input({ lessons: times(40, () => lesson(0)), decision: 'exempt' })),
    );
    expect(outcome.staleDecision).toBe(true);
    expect(outcome.undecided).toBe(true);
    expect(outcome.decision).toBeNull();
  });
});

// edge/calculation, "A student joined late, returned, or started the subject mid-quarter and has
// few lessons": N held, n expected, the flag when n × 3 < N, whatever the cause.
describe('edge/calculation: few lessons', () => {
  function withExpected(expected: number, held: number, exempt = 0) {
    return input({
      lessons: [...times(expected, () => lesson(1, 70, 70)), ...times(exempt, () => lesson(4))],
      heldInJournals: held,
    });
  }

  it('flags 13 of 40 (39 < 40)', () => {
    expect(numberOf(studentQuarterOutcome(withExpected(13, 40))).flags).toEqual(['few_lessons']);
  });

  it('does not flag 14 of 42 (42 is not less than 42)', () => {
    expect(numberOf(studentQuarterOutcome(withExpected(14, 42))).flags).toEqual([]);
  });

  it('does not flag a quarter with no held lesson', () => {
    expect(studentQuarterOutcome(input({ heldInJournals: 0 })).flags).toEqual([]);
  });

  it('counts a late joiner: lessons before joining are in N, not in the lessons', () => {
    const outcome = numberOf(studentQuarterOutcome(withExpected(8, 40)));
    expect(outcome.flags).toEqual(['few_lessons']);
    expect(outcome.basedOn).toEqual({ expected: 8, held: 40 });
  });

  it('counts unmarked lessons and extra lessons off attendance as expected (decision 2)', () => {
    const lessons = [
      ...times(10, () => lesson(1, 70, 70)),
      ...times(2, () => lesson(null)),
      ...times(2, () => lesson(1, null, null, false)),
    ];
    const outcome = numberOf(studentQuarterOutcome(input({ lessons, heldInJournals: 42 })));
    expect(outcome.basedOn.expected).toBe(14);
    expect(outcome.flags).toEqual([]);
  });

  it('does not count exempt lessons as expected', () => {
    const outcome = numberOf(studentQuarterOutcome(withExpected(13, 40, 2)));
    expect(outcome.basedOn).toEqual({ expected: 13, held: 40 });
    expect(outcome.flags).toEqual(['few_lessons']);
  });

  // Decision 3: "Exempt (when an exemption explains it)": (n + e) × 3 ≥ N.
  it('applies Exempt when the exempt lessons explain the flag: 10 + 4 of 40', () => {
    const outcome = studentQuarterOutcome({ ...withExpected(10, 40, 4), decision: 'exempt' });
    expect(outcome).toMatchObject({ kind: 'exempt', cause: 'decided', staleDecision: false });
  });

  it('does not apply Exempt when they do not: 10 + 3 of 40', () => {
    const outcome = numberOf(
      studentQuarterOutcome({ ...withExpected(10, 40, 3), decision: 'exempt' }),
    );
    expect(outcome.staleDecision).toBe(true);
    expect(outcome.undecided).toBe(true);
  });
});

// Decision 3: a stored decision the data no longer allows is not applied and never throws.
describe('stale decisions', () => {
  it('reports a voided exemption under an Exempt decision as stale', () => {
    // The only exempt lessons were voided: the marks given back are absences.
    const outcome = numberOf(
      studentQuarterOutcome(
        input({
          lessons: [...times(5, () => lesson(1, 70, 70)), ...times(35, () => lesson(0))],
          heldInJournals: 121,
          decision: 'exempt',
        }),
      ),
    );
    expect(outcome.flags).toEqual(['few_lessons']);
    expect(outcome.staleDecision).toBe(true);
    expect(outcome.undecided).toBe(true);
  });

  it.each(['keep', 'not_assessed', 'exempt'] as const)(
    'reports %s with no flag raised as stale',
    (decision) => {
      const outcome = numberOf(
        studentQuarterOutcome(input({ lessons: times(10, () => lesson(1, 70, 70)), decision })),
      );
      expect(outcome.flags).toEqual([]);
      expect(outcome.staleDecision).toBe(true);
      expect(outcome.undecided).toBe(false);
      expect(outcome.decision).toBeNull();
    },
  );

  it('reports a decision on an Exempt or No result outcome as stale', () => {
    expect(
      studentQuarterOutcome(input({ lessons: [lesson(4)], decision: 'keep' })).staleDecision,
    ).toBe(true);
    expect(
      studentQuarterOutcome(input({ lessons: [lesson(null)], decision: 'keep' })).staleDecision,
    ).toBe(true);
  });
});

// edge/calculation, "A student moved to a class that does not study the subject."
describe('edge/calculation: left the subject', () => {
  const left = input({ lessons: times(20, () => lesson(1, 70, 70)), leftSubjectOn: '2026-11-02' });

  it('labels the result and flags it for a decision at closing', () => {
    const outcome = numberOf(studentQuarterOutcome(left));
    expect(outcome.flags).toEqual(['left_subject']);
    expect(outcome.leftSubjectOn).toBe('2026-11-02');
    expect(outcome.undecided).toBe(true);
  });

  it.each([
    ['keep', 'number', false],
    ['not_assessed', 'not_assessed', false],
    ['exempt', 'number', true],
  ] as const)('takes %s as %s (stale: %s)', (decision, kind, stale) => {
    const outcome = studentQuarterOutcome({ ...left, decision });
    expect(outcome.kind).toBe(kind);
    expect(outcome.staleDecision).toBe(stale);
  });
});

// edge/calculation, "A student left the school before the quarter ended" and "A student moved
// between branches mid-quarter": a result at leaving, labelled, with the number of lessons.
describe('edge/calculation: a result at leaving', () => {
  it('carries its date and lesson count and raises no flag (decision 6)', () => {
    const outcome = numberOf(
      studentQuarterOutcome(
        input({ lessons: [lesson(1)], heldInJournals: 40, atLeaving: '2026-10-09' }),
      ),
    );
    expect(outcome.atLeaving).toBe('2026-10-09');
    expect(outcome.basedOn).toEqual({ expected: 1, held: 40 });
    expect(outcome.flags).toEqual([]);
    expect(outcome.undecided).toBe(false);
  });

  it('applies over a "left the subject" date, which stays as a label (decision 12)', () => {
    const outcome = numberOf(
      studentQuarterOutcome(
        input({
          lessons: times(10, () => lesson(1, 70, 70)),
          leftSubjectOn: '2026-10-05',
          atLeaving: '2026-10-20',
        }),
      ),
    );
    expect(outcome.flags).toEqual([]);
    expect(outcome.leftSubjectOn).toBe('2026-10-05');
    expect(outcome.atLeaving).toBe('2026-10-20');
  });

  it('counts the new branch from its own lessons, and the few-lessons flag applies', () => {
    // Moved in week 7 of 10: the new branch's journal held 40 lessons, the student was in 12.
    const outcome = numberOf(
      studentQuarterOutcome(
        input({ lessons: times(12, () => lesson(1, 70, 70)), heldInJournals: 40 }),
      ),
    );
    expect(outcome.flags).toEqual(['few_lessons']);
  });
});

// edge/calculation, "A student left and came back in the same quarter": "Lessons before leaving
// count. The gap shows closed cells, not absences."
describe('edge/calculation: left and came back', () => {
  it('counts the lessons before leaving and after the return; the gap is in N only', () => {
    const before = times(10, () => lesson(1, 90, 90));
    const after = times(15, () => lesson(1, 60, 60));
    const outcome = numberOf(
      studentQuarterOutcome(input({ lessons: [...before, ...after], heldInJournals: 40 })),
    );
    expect(outcome.basedOn).toEqual({ expected: 25, held: 40 });
    expect(outcome.flags).toEqual([]);
    expect(outcome.result.value.equals(Fraction.of(388n, 5n))).toBe(true);
  });
});

// edge/academic-year, "The school goes live in the middle of the year": "Its result is labelled
// 'from' with the date".
describe('edge/academic-year: the start quarter', () => {
  it.each([
    ['a number', [lesson(1, 70, 70)]],
    ['Exempt', [lesson(4)]],
    ['No result', [lesson(null)]],
  ] as const)('labels %s with the start date', (_label, lessons) => {
    expect(studentQuarterOutcome(input({ lessons, countsFrom: '2026-11-16' })).from).toBe(
      '2026-11-16',
    );
  });

  it('counts only the lessons given: none exist before the start date', () => {
    const outcome = numberOf(
      studentQuarterOutcome(
        input({ lessons: times(12, () => lesson(1, 70, 70)), countsFrom: '2026-11-16' }),
      ),
    );
    expect(outcome.flags).toEqual([]);
  });
});

// edge/exemptions, the rows with a part in the calculation.
describe('edge/exemptions: exempt lessons in the result', () => {
  // "A student with a year-long physical education exemption falls ill for three days."
  it('leaves out lessons with mark 4 and with mark 5 alike', () => {
    const base = times(10, () => lesson(1, 80, 80));
    const plain = numberOf(studentQuarterOutcome(input({ lessons: base, heldInJournals: 13 })));
    const mixed = numberOf(
      studentQuarterOutcome(
        input({ lessons: [...base, lesson(4), lesson(5), lesson(5)], heldInJournals: 13 }),
      ),
    );
    expect(mixed.result.value.equals(plain.result.value)).toBe(true);
    expect(mixed.basedOn).toEqual({ expected: 10, held: 13 });
  });

  // "A certificate for 1–10 October arrives on 20 October": keep as attended, or exempt and clear.
  it('counts a lesson kept as attended with its numbers and leaves out an exempted, cleared one', () => {
    const others = times(9, () => lesson(1, 60, 60));
    const kept = numberOf(
      studentQuarterOutcome(input({ lessons: [...others, lesson(1, 100, 100)] })),
    );
    const cleared = numberOf(studentQuarterOutcome(input({ lessons: [...others, lesson(4)] })));
    expect(kept.result.value.equals(Fraction.of(356n, 5n))).toBe(true);
    expect(cleared.result.value.equals(Fraction.whole(68n))).toBe(true);
  });

  it('refuses a number left on an exempt lesson', () => {
    expect(codeOf(() => studentQuarterOutcome(input({ lessons: [lesson(4, 70)] })))).toBe(
      'number_on_exempt_lesson',
    );
  });

  // "An exemption was entered for the wrong student": cells get back the mark they had before.
  it('follows the marks: a voided exemption gives the earlier result back', () => {
    const lessons = times(5, () => lesson(1, 70, 70));
    const exempt = studentQuarterOutcome(input({ lessons: times(5, () => lesson(4)) }));
    const voided = numberOf(studentQuarterOutcome(input({ lessons })));
    expect(exempt.kind).toBe('exempt');
    expect(voided.result.shown).toBe(76n);
  });

  // "A student with an exemption transfers": the exemption belongs to the student.
  it('leaves out exempt lessons of the old and the new journal together', () => {
    const oldJournal = [...times(6, () => lesson(1, 50, 50)), lesson(4), lesson(4)];
    const newJournal = [lesson(4), ...times(6, () => lesson(1, 90, 90))];
    const outcome = numberOf(
      studentQuarterOutcome(input({ lessons: [...oldJournal, ...newJournal], heldInJournals: 15 })),
    );
    expect(outcome.basedOn).toEqual({ expected: 12, held: 15 });
    expect(outcome.result.value.equals(Fraction.whole(76n))).toBe(true);
  });
});

// 07, Effect on totals, Year result: "The mean of the quarters that have a result."
describe('outcomeForYear', () => {
  it('leaves Exempt and Not assessed quarters out of the year result, based on 2 of 4', () => {
    const quarters = [
      studentQuarterOutcome(input({ lessons: times(10, () => lesson(1, 70, 70)) })),
      studentQuarterOutcome(input({ lessons: times(10, () => lesson(4)) })),
      studentQuarterOutcome(input({ lessons: times(10, () => lesson(1, 50, 50)) })),
      studentQuarterOutcome(
        input({ lessons: times(10, () => lesson(0)), decision: 'not_assessed' }),
      ),
    ].map(outcomeForYear);
    expect(quarters.slice(1).filter((quarter) => !(quarter instanceof Fraction))).toEqual([
      'exempt',
      'not_assessed',
    ]);
    const year = yearResult(quarters);
    expect(year).toMatchObject({ kind: 'number', basedOn: 2 });
  });

  it('passes the exact value of a number and No result as it is', () => {
    const number = studentQuarterOutcome(input({ lessons: [lesson(1, 33, 33)] }));
    const value = outcomeForYear(number);
    expect(value instanceof Fraction && value.equals(numberOf(number).result.value)).toBe(true);
    expect(outcomeForYear(studentQuarterOutcome(input({ lessons: [lesson(null)] })))).toBe(
      'no_result',
    );
  });
});

describe('refused input', () => {
  it('refuses more lessons than held', () => {
    expect(
      codeOf(() =>
        studentQuarterOutcome(input({ lessons: [lesson(1), lesson(1)], heldInJournals: 1 })),
      ),
    ).toBe('lessons_above_held');
  });

  it.each([-1, 1.5])('refuses heldInJournals %d', (heldInJournals) => {
    expect(codeOf(() => studentQuarterOutcome(input({ heldInJournals })))).toBeDefined();
  });

  it.each(['2026-02-30', '2026-1-5', '2027-02-29', '2026-13-01', '2026-00-10', ' 2026-01-05'])(
    'refuses the date %j',
    (date) => {
      expect(codeOf(() => studentQuarterOutcome(input({ countsFrom: date })))).toBe('not_a_date');
      expect(codeOf(() => studentQuarterOutcome(input({ leftSubjectOn: date })))).toBe(
        'not_a_date',
      );
      expect(codeOf(() => studentQuarterOutcome(input({ atLeaving: date })))).toBe('not_a_date');
    },
  );

  it.each(['2028-02-29', '2000-02-29', '2026-12-31'])('takes the date %s', (date) => {
    expect(codeOf(() => studentQuarterOutcome(input({ countsFrom: date })))).toBeUndefined();
  });

  it('refuses 1900-02-29, not a leap day', () => {
    expect(codeOf(() => studentQuarterOutcome(input({ countsFrom: '1900-02-29' })))).toBe(
      'not_a_date',
    );
  });

  it('refuses an unknown decision', () => {
    expect(
      codeOf(() =>
        studentQuarterOutcome(
          input({ decision: 'maybe' as unknown as StudentQuarterInput['decision'] }),
        ),
      ),
    ).toBe('out_of_range');
  });
});
