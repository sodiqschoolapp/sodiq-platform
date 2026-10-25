import { describe, expect, it } from 'vitest';
import type { AttendanceMark } from './attendance.js';
import { CalcInputError } from './input.js';
import type { StudentQuarterInput } from './outcome.js';
import type { QuarterLesson } from './quarter.js';
import { studentQuarterOutcome } from './outcome.js';
import {
  finalQuarterRecord,
  recalculateAndCompare,
  storedQuarterInputs,
  storedQuarterOutcome,
  type FinalQuarterRecord,
} from './record.js';
import { CALC_VERSION } from './version.js';

function lesson(mark: AttendanceMark | null, score: number | null = null): QuarterLesson {
  return {
    mark,
    classworks: score === null ? [] : [{ score, total: 30 }],
    homeworks: score === null ? [] : [{ score, total: 30 }],
  };
}

function times(count: number, make: () => QuarterLesson): QuarterLesson[] {
  return Array.from({ length: count }, make);
}

// Worked example of 07: 20 · 20 · 20 · 40 with attendance 100, classwork 50, homework 30,
// rating 49 gives 55.6, shown 56, grade 3.
const CLOSED: StudentQuarterInput = {
  weights: { attendance: 20, classwork: 20, homework: 20, ratingExam: 40 },
  attendanceValues: { lateValue: 50, skippedValue: 0 },
  lessons: [
    {
      mark: 1,
      classworks: [{ score: 15, total: 30 }],
      homeworks: [{ score: 3, total: 10 }],
    },
  ],
  ratingExam: { kind: 'score', score: 49 },
  quarterClosed: true,
  heldInJournals: 1,
  countsFrom: null,
  leftSubjectOn: null,
  atLeaving: null,
  decision: null,
};

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof CalcInputError) return error.code;
    throw error;
  }
  return undefined;
}

function throughJson(record: FinalQuarterRecord): unknown {
  return JSON.parse(JSON.stringify(record));
}

// edge/calculation, "A bug is found after results were closed and exported": "The calculation
// module has a version, stored with every final result. A 'recalculate and compare' tool lists
// the differences without changing anything."
describe('finalQuarterRecord', () => {
  it('carries the format, the kind and the module version', () => {
    const record = finalQuarterRecord(CLOSED, 'closing');
    expect(record).toMatchObject({ format: 1, kind: 'closing', moduleVersion: CALC_VERSION });
  });

  // edge/developer-rules, Calculation: "Stored per final result: the inputs, the exact result,
  // the rounded result, the grade, the settings used and the calculation module's version"
  // (review of the plan, correction 3).
  it('holds each of the six stored items of edge/developer-rules', () => {
    const stored = throughJson(finalQuarterRecord(CLOSED, 'closing'));
    expect(stored).toMatchObject({
      // the inputs
      inputs: { lessons: CLOSED.lessons, ratingExam: CLOSED.ratingExam, heldInJournals: 1 },
      outcome: {
        kind: 'number',
        result: {
          // the exact result, 278/5 = 55.6
          value: { num: '278', den: '5' },
          // the rounded result
          shown: '56',
          // the grade
          grade: 3,
        },
      },
      // the module's version
      moduleVersion: CALC_VERSION,
    });
    // the settings used: the weights and the late and skipped values of the quarter
    expect(stored).toHaveProperty('inputs.weights', CLOSED.weights);
    expect(stored).toHaveProperty('inputs.attendanceValues', CLOSED.attendanceValues);
  });

  it('is plain JSON: fractions are decimal strings of the reduced numerator and denominator', () => {
    const record = finalQuarterRecord(CLOSED, 'closing');
    expect(throughJson(record)).toEqual(record);
    expect(JSON.stringify(record)).not.toMatch(/\d\.\d/);
  });

  it('copies the inputs: a later change of the caller object does not reach the record', () => {
    const lessons = [lesson(1, 20)];
    const record = finalQuarterRecord({ ...CLOSED, lessons, heldInJournals: 2 }, 'closing');
    lessons.push(lesson(0, 0));
    expect(record.inputs.lessons).toHaveLength(1);
  });

  it('refuses a closing record of an open quarter', () => {
    expect(codeOf(() => finalQuarterRecord({ ...CLOSED, quarterClosed: false }, 'closing'))).toBe(
      'final_record_open_quarter',
    );
  });

  // 07, Closing a quarter: "A result flagged 'based on few lessons' is undecided: Blocks closing".
  it('refuses a closing record with an undecided flag', () => {
    const flagged = { ...CLOSED, lessons: [lesson(1, 20)], heldInJournals: 40 };
    expect(codeOf(() => finalQuarterRecord(flagged, 'closing'))).toBe('final_record_undecided');
    expect(codeOf(() => finalQuarterRecord({ ...flagged, decision: 'keep' }, 'closing'))).toBe(
      undefined,
    );
  });

  // Correction 1 of the review: a decision the module does not apply refuses the record; the
  // closing checklist lists it (9.2a).
  it('refuses a closing record with a stale decision', () => {
    const stale = { ...CLOSED, lessons: times(5, () => lesson(1, 20)), heldInJournals: 5 };
    expect(codeOf(() => finalQuarterRecord({ ...stale, decision: 'keep' }, 'closing'))).toBe(
      'final_record_undecided',
    );
  });

  // 07 rule 8; edge/calculation, "A student is exempt on the exam day": "A pending entry blocks
  // closing".
  it('refuses a closing record in a rating subject with no rating entry, pending included', () => {
    expect(codeOf(() => finalQuarterRecord({ ...CLOSED, ratingExam: null }, 'closing'))).toBe(
      'final_record_rating_missing',
    );
  });

  it('takes a closing record of an Exempt or a Not assessed outcome', () => {
    const exempt = { ...CLOSED, lessons: [lesson(4)], ratingExam: { kind: 'exempt' } } as const;
    expect(finalQuarterRecord(exempt, 'closing').outcome).toMatchObject({ kind: 'exempt' });
    const notAssessed = {
      ...CLOSED,
      lessons: [lesson(0)],
      ratingExam: { kind: 'did_not_sit' },
      decision: 'not_assessed',
    } as const;
    expect(finalQuarterRecord(notAssessed, 'closing').outcome).toMatchObject({
      kind: 'not_assessed',
    });
  });

  // edge/calculation, "A student left the school before the quarter ended": stored at leaving,
  // while the quarter is open (decision 6).
  it('stores a result at leaving in an open quarter, with no rating entry and a few lessons', () => {
    const leaving = {
      ...CLOSED,
      quarterClosed: false,
      ratingExam: null,
      lessons: [lesson(1, 20)],
      heldInJournals: 40,
      atLeaving: '2026-10-09',
    };
    const record = finalQuarterRecord(leaving, 'at_leaving');
    expect(record.kind).toBe('at_leaving');
    expect(record.outcome).toMatchObject({
      atLeaving: '2026-10-09',
      basedOn: { expected: 1, held: 40 },
    });
  });

  it('refuses a closing record of a student who left: the flags would be skipped', () => {
    const left = { ...CLOSED, lessons: [lesson(1)], heldInJournals: 40, atLeaving: '2026-10-09' };
    expect(codeOf(() => finalQuarterRecord(left, 'closing'))).toBe('final_record_at_leaving');
  });

  it('refuses a record at leaving with no leaving date', () => {
    expect(codeOf(() => finalQuarterRecord(CLOSED, 'at_leaving'))).toBe('final_record_not_leaving');
  });
});

describe('recalculateAndCompare', () => {
  it('finds no difference for a record read back from JSON', () => {
    const compared = recalculateAndCompare(throughJson(finalQuarterRecord(CLOSED, 'closing')));
    expect(compared).toMatchObject({
      storedVersion: CALC_VERSION,
      currentVersion: CALC_VERSION,
      same: true,
      differences: [],
    });
  });

  it('lists a stored value changed by hand, and changes nothing', () => {
    const stored = throughJson(finalQuarterRecord(CLOSED, 'closing'));
    const tampered = JSON.parse(
      JSON.stringify(stored).replace('"shown":"56"', '"shown":"55"'),
    ) as unknown;
    const before = JSON.stringify(tampered);
    const compared = recalculateAndCompare(tampered);
    expect(compared.same).toBe(false);
    expect(compared.differences).toEqual(['result.shown']);
    expect(JSON.stringify(tampered)).toBe(before);
  });

  it.each(['decision', 'from', 'result.averages.homework'])(
    'lists a stored field that was lost: %s',
    (path) => {
      const stored = throughJson(finalQuarterRecord(CLOSED, 'closing')) as {
        outcome: Record<string, unknown>;
      };
      const keys = path.split('.');
      const last = keys.pop() ?? '';
      let holder: Record<string, unknown> = stored.outcome;
      for (const key of keys) holder = holder[key] as Record<string, unknown>;
      expect(last in holder).toBe(true);
      delete holder[last];
      const compared = recalculateAndCompare(stored);
      expect(compared.same).toBe(false);
      expect(compared.differences).toEqual([path]);
    },
  );

  it('lists a record the current module refuses, and does not throw', () => {
    const stored = throughJson(finalQuarterRecord(CLOSED, 'closing')) as {
      inputs: { weights: Record<string, unknown> };
    };
    stored.inputs.weights.attendance = 21;
    const compared = recalculateAndCompare(stored);
    expect(compared).toMatchObject({ same: false, refused: 'weights_not_100', now: null });
  });

  it('lists a changed outcome kind', () => {
    const stored = throughJson(finalQuarterRecord(CLOSED, 'closing')) as Record<string, unknown>;
    const compared = recalculateAndCompare({
      ...stored,
      outcome: { kind: 'no_result' },
    });
    expect(compared.same).toBe(false);
    expect(compared.differences).toContain('kind');
  });

  type Stored = Record<string, unknown>;
  const edits: readonly [string, (stored: Stored) => unknown][] = [
    ['not an object', () => 'record'],
    ['format 2', (stored) => ({ ...stored, format: 2 })],
    [
      'a missing field',
      (stored) => Object.fromEntries(Object.entries(stored).filter(([key]) => key !== 'inputs')),
    ],
    [
      'a wrong type',
      (stored) => ({ ...stored, inputs: { ...(stored.inputs as Stored), heldInJournals: '1' } }),
    ],
    ['an unknown kind', (stored) => ({ ...stored, kind: 'reopened' })],
    ['module version 0', (stored) => ({ ...stored, moduleVersion: 0 })],
    ['module version 1.5', (stored) => ({ ...stored, moduleVersion: 1.5 })],
    ['a kind at leaving with no leaving date', (stored) => ({ ...stored, kind: 'at_leaving' })],
    [
      'a closing kind of an open quarter',
      (stored) => ({ ...stored, inputs: { ...(stored.inputs as Stored), quarterClosed: false } }),
    ],
    [
      'a lesson with no works list',
      (stored): unknown =>
        JSON.parse(JSON.stringify(stored).replace('"classworks":', '"classwork":')),
    ],
    [
      'a lesson with a key outside the format (countsForAttendance)',
      (stored): unknown =>
        JSON.parse(
          JSON.stringify(stored).replace('"mark":1', '"mark":1,"countsForAttendance":true'),
        ),
    ],
    [
      'an unknown mark',
      (stored): unknown => JSON.parse(JSON.stringify(stored).replace('"mark":1', '"mark":6')),
    ],
  ];

  it.each(edits)('refuses a record with %s', (_label, edit) => {
    const stored = throughJson(finalQuarterRecord(CLOSED, 'closing')) as Stored;
    expect(codeOf(() => recalculateAndCompare(edit(stored)))).toBe('record_shape');
  });
});

// Task 9.2b, review decision 1 (Look first): a closed quarter's figures are read from the stored
// record, never recalculated (07: "the results are stored as final"; edge/calculation: "A release
// never changes closed results silently").
describe('storedQuarterOutcome', () => {
  const cases: readonly [string, StudentQuarterInput, 'closing' | 'at_leaving'][] = [
    ['a number with every part', CLOSED, 'closing'],
    [
      'a kept number with a flag and a part left out',
      { ...CLOSED, lessons: [lesson(1)], heldInJournals: 40, decision: 'keep' },
      'closing',
    ],
    [
      'an Exempt with no lesson remaining',
      { ...CLOSED, lessons: [lesson(4)], ratingExam: { kind: 'exempt' } },
      'closing',
    ],
    [
      'a Not assessed',
      {
        ...CLOSED,
        lessons: [lesson(0)],
        ratingExam: { kind: 'did_not_sit' },
        decision: 'not_assessed',
      },
      'closing',
    ],
    [
      'a No result',
      { ...CLOSED, lessons: [lesson(null)], ratingExam: { kind: 'not_held' } },
      'closing',
    ],
    ['a start quarter with its from date', { ...CLOSED, countsFrom: '2026-11-16' }, 'closing'],
    [
      'a result at leaving',
      {
        ...CLOSED,
        quarterClosed: false,
        ratingExam: null,
        lessons: [lesson(1, 20)],
        heldInJournals: 40,
        atLeaving: '2026-10-09',
      },
      'at_leaving',
    ],
  ];

  it.each(cases)('reads %s back as the module gave it', (_, input, kind) => {
    const stored = throughJson(finalQuarterRecord(input, kind));
    expect(storedQuarterOutcome(stored)).toEqual(studentQuarterOutcome(input));
  });

  // The stored value wins over the inputs: a later module that would calculate otherwise never
  // changes what was closed.
  it('answers the stored outcome, not one calculated again from the inputs', () => {
    const stored = throughJson(finalQuarterRecord(CLOSED, 'closing'));
    const changed = JSON.parse(
      JSON.stringify(stored).replace('"shown":"56"', '"shown":"55"'),
    ) as unknown;
    const outcome = storedQuarterOutcome(changed);
    expect(outcome.kind === 'number' ? outcome.result.shown : null).toBe(55n);
  });

  type Stored = { outcome: Record<string, unknown> } & Record<string, unknown>;
  const resultOf = (stored: Stored) => stored.outcome.result as Record<string, unknown>;
  const broken: readonly [string, (stored: Stored) => unknown][] = [
    ['not an object', () => 7],
    ['format 2', (stored) => ({ ...stored, format: 2 })],
    [
      'an unknown outcome kind',
      (stored) => ({ ...stored, outcome: { ...stored.outcome, kind: 'maybe' } }),
    ],
    [
      'a fraction as a number',
      (stored) => ({
        ...stored,
        outcome: { ...stored.outcome, result: { ...resultOf(stored), value: 55.6 } },
      }),
    ],
    [
      'a grade out of the bands',
      (stored) => ({
        ...stored,
        outcome: { ...stored.outcome, result: { ...resultOf(stored), grade: 6 } },
      }),
    ],
    [
      'an unknown flag',
      (stored) => ({ ...stored, outcome: { ...stored.outcome, flags: ['late'] } }),
    ],
  ];

  it.each(broken)('refuses %s with record_shape', (_, edit) => {
    const stored = throughJson(finalQuarterRecord(CLOSED, 'closing')) as Stored;
    expect(codeOf(() => storedQuarterOutcome(edit(stored)))).toBe('record_shape');
  });
});

// Task 9.2b: the averages of a closed quarter whose outcome is not a number are read from the
// inputs stored with it, never from the entries of today.
describe('storedQuarterInputs', () => {
  it('reads the stored inputs back as they were given', () => {
    const stored = throughJson(finalQuarterRecord(CLOSED, 'closing'));
    expect(storedQuarterInputs(stored)).toEqual(CLOSED);
  });

  it('refuses a record of another format with record_shape', () => {
    const stored = throughJson(finalQuarterRecord(CLOSED, 'closing')) as Record<string, unknown>;
    expect(codeOf(() => storedQuarterInputs({ ...stored, format: 2 }))).toBe('record_shape');
  });
});
