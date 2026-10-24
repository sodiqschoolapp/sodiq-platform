import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lessonStatusOf, type StatusFacts, type StatusWork } from './lesson-status.js';

const NOW = new Date('2026-10-20T10:00:00Z');
const LATER = new Date('2026-10-29T10:00:00Z');

function facts(change: Partial<StatusFacts> = {}): StatusFacts {
  return {
    held: true,
    locksAt: new Date('2026-10-28T19:00:00Z'),
    waited: ['a', 'b'],
    marks: new Map(),
    works: [],
    data: false,
    ...change,
  };
}

function work(change: Partial<StatusWork> = {}): StatusWork {
  return { total: 10, optional: [], numbered: [], notGraded: [], ...change };
}

const statusOf = (input: StatusFacts, now = NOW) => lessonStatusOf(input, now)?.status ?? null;

describe('lessonStatusOf (07, Lesson status)', () => {
  it('has no status for a lesson not held: future, cancelled, unresolved', () => {
    expect(lessonStatusOf(facts({ held: false }), NOW)).toBeNull();
  });

  it('is not started while nothing is entered', () => {
    expect(statusOf(facts())).toBe('not_started');
  });

  it('is complete once attendance is marked for a lesson with no works', () => {
    expect(
      statusOf(
        facts({
          marks: new Map([
            ['a', 1],
            ['b', 0],
          ]),
          data: true,
        }),
      ),
    ).toBe('complete');
  });

  it('stays in progress while a waited-for student has no mark', () => {
    const answer = lessonStatusOf(facts({ marks: new Map([['a', 1]]), data: true }), NOW);
    expect(answer).toEqual({ status: 'in_progress', unmarked: 1, worksMissing: 0 });
  });

  it('numbers typed with attendance empty: in progress (edge/journal, row 3)', () => {
    expect(statusOf(facts({ works: [work({ numbered: ['a', 'b'] })], data: true }))).toBe(
      'in_progress',
    );
  });

  it('a 0 or 3 student without a number does not keep it in progress (row 1)', () => {
    const marks = new Map([
      ['a', 1],
      ['b', 3],
    ]);
    expect(statusOf(facts({ marks, works: [work({ numbered: ['a'] })], data: true }))).toBe(
      'complete',
    );
    const absent = new Map([
      ['a', 0],
      ['b', 2],
    ]);
    expect(statusOf(facts({ marks: absent, works: [work({ numbered: ['b'] })], data: true }))).toBe(
      'complete',
    );
  });

  it('a mark changed from 0 to 1 makes the empty cell waited for again (row 2)', () => {
    const works = [work({ numbered: ['a'] })];
    const before = new Map([
      ['a', 1],
      ['b', 0],
    ]);
    expect(statusOf(facts({ marks: before, works, data: true }))).toBe('complete');
    const after = new Map([
      ['a', 1],
      ['b', 1],
    ]);
    expect(lessonStatusOf(facts({ marks: after, works, data: true }), NOW)).toEqual({
      status: 'in_progress',
      unmarked: 0,
      worksMissing: 1,
    });
  });

  it('a work with no total keeps it in progress, with its total counted as data', () => {
    const marks = new Map([
      ['a', 0],
      ['b', 0],
    ]);
    expect(statusOf(facts({ marks, works: [work({ total: null })], data: true }))).toBe(
      'in_progress',
    );
    expect(statusOf(facts({ waited: [], works: [work({ total: null })], data: true }))).toBe(
      'in_progress',
    );
  });

  it('"not graded" completes the lesson', () => {
    const marks = new Map([
      ['a', 1],
      ['b', 1],
    ]);
    expect(
      statusOf(facts({ marks, works: [work({ numbered: ['a'], notGraded: ['b'] })], data: true })),
    ).toBe('complete');
  });

  it('a homework cell of a student not expected where it was given is optional (row 15)', () => {
    const marks = new Map([
      ['a', 1],
      ['b', 1],
    ]);
    expect(
      statusOf(facts({ marks, works: [work({ numbered: ['a'], optional: ['b'] })], data: true })),
    ).toBe('complete');
  });

  it('a student with an optional or reopened cell is not waited for (8.5, 8.6)', () => {
    // The reader leaves them out of `waited`; a mark of theirs changes nothing.
    expect(statusOf(facts({ waited: ['a'], marks: new Map([['a', 1]]), data: true }))).toBe(
      'complete',
    );
  });

  it('every student exempt: complete with nothing to mark', () => {
    expect(statusOf(facts({ waited: [] }))).toBe('complete');
  });

  it('a lesson holding only a general note is in progress, not "not started"', () => {
    expect(statusOf(facts({ data: true }))).toBe('in_progress');
  });

  it('from the lock moment an incomplete lesson is locked incomplete, a complete one stays', () => {
    expect(statusOf(facts(), LATER)).toBe('locked_incomplete');
    expect(statusOf(facts({ data: true, marks: new Map([['a', 1]]) }), LATER)).toBe(
      'locked_incomplete',
    );
    const done = facts({
      marks: new Map([
        ['a', 1],
        ['b', 1],
      ]),
      data: true,
    });
    expect(statusOf(done, LATER)).toBe('complete');
    const at = facts({ locksAt: NOW });
    expect(statusOf(at, NOW)).toBe('locked_incomplete');
    expect(statusOf(at, new Date(NOW.getTime() - 1))).toBe('not_started');
  });

  it('over every mark and number of two students, gives the status the marks and numbers decide', () => {
    const marksOf = (a: number | null, b: number | null) =>
      new Map(
        (
          [
            ['a', a],
            ['b', b],
          ] as const
        ).flatMap(([student, mark]) => (mark === null ? [] : [[student, mark] as const])),
      );
    const values = [null, 0, 1, 2, 3];
    for (const a of values) {
      for (const b of values) {
        for (const numbered of [[], ['a'], ['a', 'b']]) {
          const marks = marksOf(a, b);
          const data = marks.size > 0 || numbered.length > 0;
          // Told apart here from the marks and numbers alone: every student marked, and each
          // one marked 1 or 2 numbered (row 1).
          const present = [
            ['a', a],
            ['b', b],
          ].filter(([, mark]) => mark === 1 || mark === 2);
          const complete =
            a !== null &&
            b !== null &&
            present.every(([student]) => numbered.includes(String(student)));
          const expected = complete ? 'complete' : data ? 'in_progress' : 'not_started';
          const answer = lessonStatusOf(facts({ marks, works: [work({ numbered })], data }), NOW);
          expect(answer?.status).toBe(expected);
          expect(answer?.unmarked).toBe((a === null ? 1 : 0) + (b === null ? 1 : 0));
        }
      }
    }
  });

  describe('fast-check', () => {
    const students = ['a', 'b', 'c'];
    const subset = fc.subarray(students);
    const workArb = fc.record({
      total: fc.option(fc.integer({ min: 0, max: 20 }), { nil: null }),
      optional: subset,
      numbered: subset,
      notGraded: subset,
    });
    const factsArb = fc.record({
      held: fc.constant(true),
      locksAt: fc.option(fc.date({ min: NOW, max: LATER, noInvalidDate: true }), { nil: null }),
      waited: subset,
      marks: fc
        .array(fc.tuple(fc.constantFrom(...students), fc.integer({ min: 0, max: 3 })), {
          maxLength: 3,
        })
        .map((pairs) => new Map(pairs)),
      works: fc.array(workArb, { maxLength: 3 }),
      data: fc.boolean(),
    });
    const moment = fc.date({ min: NOW, max: LATER, noInvalidDate: true });

    it('adding a mark or a number never turns complete into not started', () => {
      fc.assert(
        fc.property(
          factsArb,
          moment,
          fc.constantFrom(...students),
          fc.integer({ min: 0, max: 3 }),
          fc.nat(),
          (before, now, student, mark, at) => {
            fc.pre(lessonStatusOf(before, now)?.status === 'complete');
            // A mark: the reader counts it as data on the lesson.
            const marked = {
              ...before,
              marks: new Map([...before.marks, [student, mark]]),
              data: true,
            };
            expect(lessonStatusOf(marked, now)?.status).not.toBe('not_started');
            // A number in a work, when the lesson has one.
            if (before.works.length === 0) return;
            const index = at % before.works.length;
            const numbered = {
              ...before,
              works: before.works.map((one, position) =>
                position === index && !one.numbered.includes(student)
                  ? { ...one, numbered: [...one.numbered, student] }
                  : one,
              ),
              data: true,
            };
            const answer = lessonStatusOf(numbered, now);
            expect(answer?.status).not.toBe('not_started');
            // A number never takes anything away from a complete lesson.
            expect(answer?.status).toBe('complete');
          },
        ),
      );
    });

    it('is never not started while a mark or a number is entered', () => {
      fc.assert(
        fc.property(factsArb, moment, (input, now) => {
          const entered =
            input.marks.size > 0 || input.works.some((one) => one.numbered.length > 0);
          // The reader sets `data` from what is entered: never false with a mark or a number.
          const answer = lessonStatusOf({ ...input, data: input.data || entered }, now);
          if (entered) expect(answer?.status).not.toBe('not_started');
        }),
      );
    });
  });
});
