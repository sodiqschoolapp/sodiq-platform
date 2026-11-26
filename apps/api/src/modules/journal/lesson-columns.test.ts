import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  columnAt,
  lessonColumns,
  type ColumnLesson,
  type ColumnsInput,
  type PlannedWork,
  type StoredWork,
} from './lesson-columns.js';

// Task 8.1, pull request #217, and task 11.24: the work columns of a journal's
// lessons (`07`, Entering data, Homework column: "A homework is graded at the
// lesson where it was given ... No other lesson has a column for it"; `09`,
// In the journal; `edge/journal`, Entering).

/** Lesson `L<day>` on 2026-11-<day>; days up to 10 have started and are held. */
const lesson = (day: number, more: Partial<ColumnLesson> = {}): ColumnLesson => ({
  id: `L${day}`,
  startsAt: new Date(`2026-11-${String(day).padStart(2, '0')}T09:00:00Z`),
  cancelled: false,
  started: day <= 10,
  held: day <= 10,
  ...more,
});

const cw = (id: string, title = id): PlannedWork => ({ id, kind: 'classwork', title });
const hw = (id: string, title = id): PlannedWork => ({ id, kind: 'homework', title });

const stored = (id: string, more: Partial<StoredWork>): StoredWork => ({
  id,
  lessonId: 'L1',
  sourceLessonId: 'L1',
  kind: 'classwork',
  planWorkId: null,
  position: 1,
  total: null,
  notHeld: false,
  title: null,
  version: 1,
  hasNumbers: false,
  ...more,
});

const run = (input: Partial<ColumnsInput> & Pick<ColumnsInput, 'lessons'>) =>
  lessonColumns({ planned: new Map(), stored: [], ...input });

const titles = (columns: ReturnType<typeof run>, lessonId: string, kind?: string): string[] =>
  (columns.get(lessonId)?.columns ?? [])
    .filter((column) => kind === undefined || column.kind === kind)
    .map((column) => column.title ?? `#${column.workId ?? ''}`);

const workIds = (columns: ReturnType<typeof run>, lessonId: string): (string | null)[] =>
  (columns.get(lessonId)?.columns ?? []).map((column) => column.workId);

describe('lessonColumns', () => {
  it("gives a homework of Monday's item a column of Monday's lesson and of no other (Done when)", () => {
    const columns = run({
      lessons: [lesson(1), lesson(2), lesson(3)],
      planned: new Map([
        ['L1', [cw('c1'), hw('h1')]],
        ['L2', [cw('c2')]],
      ]),
    });
    expect(titles(columns, 'L1')).toEqual(['c1', 'h1']);
    expect(titles(columns, 'L2')).toEqual(['c2']);
    expect(titles(columns, 'L3')).toEqual([]);
    expect(columns.get('L1')?.columns.find((one) => one.kind === 'homework')?.sourceLessonId).toBe(
      'L1',
    );
  });

  it('gives the first lesson of a journal (after the start date) its homework column', () => {
    const columns = run({
      lessons: [lesson(1), lesson(2)],
      planned: new Map([['L1', [hw('h1')]]]),
    });
    expect(titles(columns, 'L1', 'homework')).toEqual(['h1']);
  });

  it('gives the last lesson of the year its homework column (no "will not be graded")', () => {
    const columns = run({
      lessons: [lesson(1), lesson(2)],
      planned: new Map([['L2', [hw('h2')]]]),
    });
    expect(titles(columns, 'L2', 'homework')).toEqual(['h2']);
    expect(columns.get('L2')?.given).toEqual([
      { workId: null, planWorkId: 'h2', title: 'h2', notGiven: false },
    ]);
  });

  it('counts homework given at the last lesson of a quarter in that lesson, not the next', () => {
    // L5 ends quarter 1, L6 starts quarter 2: the lessons are the year's.
    const columns = run({
      lessons: [lesson(5), lesson(6)],
      planned: new Map([['L5', [hw('h5')]]]),
    });
    expect(titles(columns, 'L5')).toEqual(['h5']);
    expect(titles(columns, 'L6')).toEqual([]);
  });

  // Task 10.8 (plan decision 4): an item the journal's add made, with no topic yet, is "No plan",
  // while its works are planned columns.
  it('counts an item with no topic as no plan item, and still gives its works their columns', () => {
    const columns = run({
      lessons: [lesson(1), lesson(2)],
      planned: new Map([['L1', [cw('c1'), hw('h1')]]]),
      topicless: new Set(['L1']),
    });
    expect(columns.get('L1')?.planItem).toBe(false);
    expect(titles(columns, 'L1')).toEqual(['c1', 'h1']);
    expect(titles(columns, 'L2')).toEqual([]);
  });

  it('takes three homeworks and no classwork, each its own column', () => {
    const columns = run({
      lessons: [lesson(1), lesson(2)],
      planned: new Map([['L1', [hw('a'), hw('b'), hw('c')]]]),
    });
    expect(columns.get('L1')?.columns.map((one) => [one.kind, one.position])).toEqual([
      ['homework', 1],
      ['homework', 2],
      ['homework', 3],
    ]);
    expect(titles(columns, 'L2')).toEqual([]);
  });

  it('gives a cancelled lesson no planned column, and moves nothing to the next lesson', () => {
    const columns = run({
      lessons: [lesson(1), lesson(2, { cancelled: true }), lesson(3)],
      planned: new Map([['L2', [hw('h2')]]]),
    });
    expect(titles(columns, 'L2')).toEqual([]);
    expect(titles(columns, 'L3')).toEqual([]);
  });

  // Review round 1, finding 5: "A cancelled or unresolved lesson shows only the rows kept at it."
  it('skips a lesson that started without a teacher (unresolved): no planned column, its stored rows kept', () => {
    const row = stored('w1', { kind: 'homework', lessonId: 'L2', sourceLessonId: 'L2', total: 5 });
    const columns = run({
      lessons: [lesson(1), lesson(2, { held: false }), lesson(3)],
      planned: new Map([['L2', [cw('c2'), hw('h2')]]]),
      stored: [row],
    });
    expect(workIds(columns, 'L2')).toEqual(['w1']);
    expect(titles(columns, 'L2')).toEqual(['#w1']);
    expect(columns.get('L3')?.columns).toEqual([]);
  });

  it('keeps a homework with a total at its own lesson when that lesson is later cancelled', () => {
    const row = stored('w1', { kind: 'homework', lessonId: 'L2', sourceLessonId: 'L2', total: 5 });
    const columns = run({
      lessons: [lesson(1), lesson(2, { cancelled: true }), lesson(3)],
      planned: new Map([['L2', [hw('h2')]]]),
      stored: [{ ...row, planWorkId: 'h2' }],
    });
    expect(workIds(columns, 'L2')).toEqual(['w1']);
    expect(columns.get('L3')?.columns).toEqual([]);
  });

  it('shows a double lesson its own homework, with nothing of the other half', () => {
    // Two lessons on one day: each half is its own lesson with its own item.
    const first = lesson(4);
    const second = { ...lesson(4), id: 'L4b', startsAt: new Date('2026-11-04T10:00:00Z') };
    const columns = run({
      lessons: [first, second],
      planned: new Map([
        ['L4', [hw('h4')]],
        ['L4b', [cw('c4b')]],
      ]),
    });
    expect(titles(columns, 'L4')).toEqual(['h4']);
    expect(titles(columns, 'L4b')).toEqual(['c4b']);
  });

  it('takes hand-added works under their stored link and leaves the others unplanned', () => {
    const linked = stored('w1', { planWorkId: 'c1', position: 1 });
    const free = stored('w2', { position: 2 });
    const columns = run({
      lessons: [lesson(1)],
      planned: new Map([['L1', [cw('c1', 'Test'), cw('c2', 'Quiz')]]]),
      stored: [linked, free],
    });
    const list = columns.get('L1')?.columns ?? [];
    expect(list.map((one) => [one.workId, one.title, one.unplanned])).toEqual([
      ['w1', 'Test', false],
      [null, 'Quiz', false],
      ['w2', null, true],
    ]);
  });

  it('never maps an unplanned row onto a planned work by position (review correction 1)', () => {
    const columns = run({
      lessons: [lesson(1)],
      planned: new Map([['L1', [cw('c1')]]]),
      stored: [stored('w1', { position: 1, total: 10, hasNumbers: true })],
    });
    expect(columns.get('L1')?.columns.map((one) => [one.workId, one.planWorkId])).toEqual([
      [null, 'c1'],
      ['w1', null],
    ]);
  });

  it('shows a lesson with no plan item as "No plan" with its hand-added works, homework included', () => {
    const columns = run({
      lessons: [lesson(1), lesson(2)],
      planned: new Map([['L1', null]]),
      stored: [stored('w1', { position: 1 }), stored('w2', { kind: 'homework', position: 1 })],
    });
    expect(columns.get('L1')?.planItem).toBe(false);
    expect(workIds(columns, 'L1')).toEqual(['w1', 'w2']);
    expect(columns.get('L2')?.columns).toEqual([]);
    expect(columns.get('L1')?.given).toEqual([
      { workId: 'w2', planWorkId: null, title: null, notGiven: false },
    ]);
  });

  it('shows a future lesson its columns', () => {
    const columns = run({
      lessons: [lesson(10), lesson(11)],
      planned: new Map([
        ['L10', [hw('h10')]],
        ['L11', [cw('c11')]],
      ]),
    });
    expect(titles(columns, 'L11')).toEqual(['c11']);
    expect(titles(columns, 'L10')).toEqual(['h10']);
  });

  it('keeps a row with data a column of its own lesson when its plan no longer names it', () => {
    const row = stored('w1', {
      kind: 'homework',
      lessonId: 'L3',
      sourceLessonId: 'L3',
      planWorkId: 'h1',
      total: 5,
      hasNumbers: true,
    });
    const columns = run({
      lessons: [lesson(1), lesson(2), lesson(3)],
      // The item of L1 names h1 now (the plan moved), L3's item does not.
      planned: new Map([['L1', [hw('h1', 'Read')]]]),
      stored: [row],
    });
    expect(columns.get('L3')?.columns.map((one) => [one.workId, one.title])).toEqual([
      ['w1', 'Read'],
    ]);
  });

  it('keeps a row whose source lesson was removed a column of its own lesson', () => {
    const row = stored('w1', {
      kind: 'homework',
      lessonId: 'L3',
      sourceLessonId: null,
      planWorkId: null,
      total: 5,
    });
    const columns = run({ lessons: [lesson(3)], stored: [row] });
    expect(workIds(columns, 'L3')).toEqual(['w1']);
  });

  it('takes a work marked "not held" out of the columns and lists it apart', () => {
    const columns = run({
      lessons: [lesson(1)],
      planned: new Map([['L1', [cw('c1'), cw('c2')]]]),
      stored: [stored('w1', { planWorkId: 'c1', total: 10, notHeld: true })],
    });
    expect(columns.get('L1')?.columns.map((one) => one.planWorkId)).toEqual(['c2']);
    expect(columns.get('L1')?.notHeld.map((one) => one.workId)).toEqual(['w1']);
    expect(columnAt(columns, 'L1', { workId: 'w1' })?.notHeld).toBe(true);
  });

  it('finds a column with no row by its plan work and its own lesson, and at no other lesson', () => {
    const columns = run({
      lessons: [lesson(1), lesson(2)],
      planned: new Map([['L1', [hw('h1')]]]),
    });
    expect(columnAt(columns, 'L1', { planWorkId: 'h1', sourceLessonId: 'L1' })?.kind).toBe(
      'homework',
    );
    expect(columnAt(columns, 'L2', { planWorkId: 'h1', sourceLessonId: 'L1' })).toBeNull();
  });

  it('shows every stored row in exactly one lesson, its own (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 2, maxLength: 8 }),
        fc.array(fc.record({ at: fc.nat(7), homework: fc.boolean(), numbers: fc.boolean() }), {
          maxLength: 6,
        }),
        (cancelled, rows) => {
          const lessons = cancelled.map((one, at) => lesson(at + 1, { cancelled: one }));
          const works = rows.map((row, at) => {
            const lessonId = `L${(row.at % lessons.length) + 1}`;
            return stored(`w${String(at)}`, {
              lessonId,
              sourceLessonId: lessonId,
              kind: row.homework ? 'homework' : 'classwork',
              position: at + 1,
              total: 10,
              hasNumbers: row.numbers,
            });
          });
          const columns = run({ lessons, stored: works });
          for (const work of works) {
            const places = [...columns.entries()].filter(([, one]) =>
              one.columns.some((column) => column.workId === work.id),
            );
            expect(places.map(([id]) => id)).toEqual([work.lessonId]);
          }
        },
      ),
    );
  });
});

// Task 8.8, pull request #226, and task 11.24: `edge/lesson-plans`, "A substitute supervises the
// class": "a homework not given has no column".
describe('lessonColumns, a homework not given', () => {
  const planned = new Map([
    ['L1', [hw('h1'), hw('h2')]],
    ['L2', [cw('c2')]],
  ]);

  it('removes its column at its own lesson (Done when) and keeps the other homework', () => {
    const before = run({ lessons: [lesson(1), lesson(2)], planned });
    expect(titles(before, 'L1', 'homework')).toEqual(['h1', 'h2']);
    const columns = run({ lessons: [lesson(1), lesson(2)], planned, notGiven: new Set(['L1/h1']) });
    expect(titles(columns, 'L1', 'homework')).toEqual(['h2']);
    expect(titles(columns, 'L2')).toEqual(['c2']);
    const given = columns.get('L1')?.given ?? [];
    expect(given.find((one) => one.planWorkId === 'h1')?.notGiven).toBe(true);
    expect(given.find((one) => one.planWorkId === 'h2')?.notGiven).toBe(false);
  });

  it('hides a stored row written and cleared, which holds nothing (spec review must-fix 1)', () => {
    const columns = run({
      lessons: [lesson(1), lesson(2)],
      planned,
      stored: [stored('w1', { kind: 'homework', planWorkId: 'h1', lessonId: 'L1', version: 3 })],
      notGiven: new Set(['L1/h1']),
    });
    expect(titles(columns, 'L1', 'homework')).toEqual(['h2']);
    expect(columns.get('L1')?.notHeld).toEqual([]);
  });

  it('keeps a stored row that holds data on the grid (nothing typed leaves it)', () => {
    const columns = run({
      lessons: [lesson(1), lesson(2)],
      planned,
      stored: [stored('w1', { kind: 'homework', planWorkId: 'h1', lessonId: 'L1', total: 10 })],
      notGiven: new Set(['L1/h1']),
    });
    expect(titles(columns, 'L1', 'homework')).toEqual(['h1', 'h2']);
  });

  it('brings the column back once the mark is undone', () => {
    const columns = run({ lessons: [lesson(1), lesson(2)], planned, notGiven: new Set() });
    expect(titles(columns, 'L1', 'homework')).toEqual(['h1', 'h2']);
  });

  it('never shows more columns with a mark than without (property)', () => {
    fc.assert(
      fc.property(fc.subarray(['L1/h1', 'L1/h2']), (marked) => {
        const without = run({ lessons: [lesson(1), lesson(2)], planned });
        const withMarks = run({
          lessons: [lesson(1), lesson(2)],
          planned,
          notGiven: new Set(marked),
        });
        expect(withMarks.get('L1')?.columns.length).toBe(
          (without.get('L1')?.columns.length ?? 0) - marked.length,
        );
      }),
    );
  });
});
