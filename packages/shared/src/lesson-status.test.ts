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
    expect(
      statusOf(facts({ works: [work({ numbered: ['a', 'b'] })], data: true })),
    ).toBe('in_progress');
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

  it('an entry never turns a lesson back to not started (every mark and number step)', () => {
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
          const status = statusOf(facts({ marks, works: [work({ numbered })], data }));
          expect(status === 'not_started').toBe(!data);
        }
      }
    }
  });
});
