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

// Task 8.1, pull request #217: the work columns of a journal's lessons (`07`,
// Entering data; `09`, In the journal; `edge/journal`, Entering).

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
  carriedFromLessonId: null,
  version: 1,
  hasNumbers: false,
  ...more,
});

const run = (input: Partial<ColumnsInput> & Pick<ColumnsInput, 'lessons'>) =>
  lessonColumns({ planned: new Map(), stored: [], journalClosed: false, ...input });

const titles = (columns: ReturnType<typeof run>, lessonId: string, kind?: string) =>
  (columns.get(lessonId)?.columns ?? [])
    .filter((column) => kind === undefined || column.kind === kind)
    .map((column) => column.title ?? `#${column.workId ?? ''}`);

describe('lessonColumns', () => {
  it('gives the first lesson of a journal no homework column (Done when)', () => {
    const columns = run({
      lessons: [lesson(1), lesson(2)],
      planned: new Map([
        ['L1', [cw('c1'), hw('h1')]],
        ['L2', [cw('c2')]],
      ]),
    });
    expect(titles(columns, 'L1')).toEqual(['c1']);
    expect(titles(columns, 'L1', 'homework')).toEqual([]);
    expect(titles(columns, 'L2')).toEqual(['c2', 'h1']);
  });

  it('gives a lesson after one with no homework no homework column', () => {
    const columns = run({
      lessons: [lesson(1), lesson(2), lesson(3)],
      planned: new Map([
        ['L1', [hw('h1')]],
        ['L2', [cw('c2')]],
        ['L3', []],
      ]),
    });
    expect(titles(columns, 'L3')).toEqual([]);
    expect(columns.get('L3')?.planItem).toBe(true);
  });

  it('takes three homeworks and no classwork, each its own column', () => {
    const columns = run({
      lessons: [lesson(1), lesson(2)],
      planned: new Map([['L1', [hw('a'), hw('b'), hw('c')]]]),
    });
    expect(titles(columns, 'L1')).toEqual([]);
    expect(columns.get('L2')?.columns.map((one) => [one.kind, one.position])).toEqual([
      ['homework', 1],
      ['homework', 2],
      ['homework', 3],
    ]);
  });

  it('skips a cancelled lesson as the source and as the check lesson', () => {
    const columns = run({
      lessons: [lesson(1), lesson(2, { cancelled: true }), lesson(3)],
      planned: new Map([['L1', [hw('h1')]]]),
    });
    expect(titles(columns, 'L2')).toEqual([]);
    expect(titles(columns, 'L3')).toEqual(['h1']);
    expect(columns.get('L3')?.source).toBe('L1');
  });

  it('skips a lesson that started without a teacher (unresolved)', () => {
    const columns = run({
      lessons: [lesson(1), lesson(2, { held: false }), lesson(3)],
      planned: new Map([['L1', [hw('h1')]]]),
    });
    expect(titles(columns, 'L3')).toEqual(['h1']);
  });

  it('crosses quarters: homework of the last lesson of a quarter is a column of the next one', () => {
    // L5 ends quarter 1, L6 starts quarter 2: the lessons are the year's.
    const columns = run({
      lessons: [lesson(5), lesson(6)],
      planned: new Map([['L5', [hw('h5')]]]),
    });
    expect(titles(columns, 'L6')).toEqual(['h5']);
  });

  it('moves a homework with a total and no number to the next lesson when its check lesson is cancelled', () => {
    const row = stored('w1', {
      kind: 'homework',
      lessonId: 'L2',
      sourceLessonId: 'L1',
      planWorkId: 'h1',
      total: 5,
    });
    const columns = run({
      lessons: [lesson(1), lesson(2, { cancelled: true }), lesson(3)],
      planned: new Map([['L1', [hw('h1')]]]),
      stored: [row],
    });
    const at3 = columns.get('L3')?.columns ?? [];
    expect(at3.map((one) => [one.workId, one.total, one.storedAt])).toEqual([['w1', 5, 'L2']]);
    expect(columns.get('L2')?.columns).toEqual([]);
  });

  it('keeps a homework with a number at its own lesson when that lesson is cancelled', () => {
    const row = stored('w1', {
      kind: 'homework',
      lessonId: 'L2',
      sourceLessonId: 'L1',
      planWorkId: 'h1',
      total: 5,
      hasNumbers: true,
    });
    const columns = run({
      lessons: [lesson(1), lesson(2, { cancelled: true }), lesson(3)],
      planned: new Map([['L1', [hw('h1')]]]),
      stored: [row],
    });
    expect(columns.get('L2')?.columns.map((one) => one.workId)).toEqual(['w1']);
    expect(columns.get('L3')?.columns).toEqual([]);
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

  it('shows a lesson with no plan item as "No plan" with its hand-added works', () => {
    const columns = run({
      lessons: [lesson(1), lesson(2)],
      planned: new Map([['L1', null]]),
      stored: [stored('w1', { position: 1 }), stored('w2', { kind: 'homework', position: 1 })],
    });
    expect(columns.get('L1')?.planItem).toBe(false);
    expect(columns.get('L1')?.columns.map((one) => one.workId)).toEqual(['w1']);
    // The homework given by hand is stored at L1 and shown at its check lesson.
    expect(columns.get('L2')?.columns.map((one) => [one.workId, one.storedAt])).toEqual([
      ['w2', 'L1'],
    ]);
    expect(columns.get('L1')?.given).toEqual([
      { workId: 'w2', planWorkId: null, title: null, checkAt: 'L2', ungraded: null },
    ]);
  });

  it('puts a carried homework at the next check lesson, beside that lesson’s own', () => {
    const carried = stored('w1', {
      kind: 'homework',
      lessonId: 'L2',
      sourceLessonId: 'L1',
      planWorkId: 'h1',
      carriedFromLessonId: 'L2',
      total: 5,
    });
    const columns = run({
      lessons: [lesson(1), lesson(2), lesson(3)],
      planned: new Map([
        ['L1', [hw('h1')]],
        ['L2', [hw('h2')]],
      ]),
      stored: [carried],
    });
    expect(titles(columns, 'L2')).toEqual([]);
    expect(columns.get('L3')?.columns.map((one) => [one.title, one.carriedFrom])).toEqual([
      ['h2', null],
      ['h1', 'L2'],
    ]);
  });

  it('gives no column for homework of the last lesson, labelled by why', () => {
    const input = {
      lessons: [lesson(1), lesson(2)],
      planned: new Map([['L2', [hw('h2')]]]),
    };
    expect(run(input).get('L2')?.given[0]?.ungraded).toBe('year_end');
    expect(run({ ...input, journalClosed: true }).get('L2')?.given[0]?.ungraded).toBe(
      'group_closed',
    );
    expect(run(input).get('L2')?.given[0]?.checkAt).toBeNull();
  });

  // Code review, must-fix 1: a homework with a total and no check lesson left stays visible.
  it('keeps a homework with a total at its own lesson when no lesson after it can check it, and lists an empty one as given only', () => {
    const totalled = stored('w1', {
      kind: 'homework',
      lessonId: 'L2',
      sourceLessonId: 'L1',
      planWorkId: 'h1',
      total: 5,
    });
    const carried = stored('w2', {
      kind: 'homework',
      lessonId: 'L3',
      sourceLessonId: 'L1',
      planWorkId: 'h2',
      carriedFromLessonId: 'L3',
      notHeld: false,
      total: 3,
    });
    const empty = stored('w3', { kind: 'homework', lessonId: 'L3', sourceLessonId: 'L3' });
    const columns = run({
      lessons: [
        lesson(1),
        lesson(2, { cancelled: true }),
        lesson(3),
        lesson(4, { cancelled: true }),
      ],
      planned: new Map([['L1', [hw('h1'), hw('h2')]]]),
      stored: [totalled, carried, empty],
    });
    // The check lesson of L1's homework is L3; the carry from L3 has no lesson after it.
    expect(columns.get('L3')?.columns.map((one) => one.workId)).toEqual(['w1', 'w2']);
    expect(columns.get('L2')?.columns).toEqual([]);
    expect(columns.get('L3')?.given.map((one) => [one.workId, one.ungraded])).toEqual([
      ['w3', 'year_end'],
    ]);
    expect(columns.get('L3')?.next).toBeNull();
    expect(columns.get('L1')?.next).toBe('L3');
  });

  it('shows a future lesson its columns', () => {
    const columns = run({
      lessons: [lesson(10), lesson(11)],
      planned: new Map([
        ['L10', [hw('h10')]],
        ['L11', [cw('c11')]],
      ]),
    });
    expect(titles(columns, 'L11')).toEqual(['c11', 'h10']);
  });

  it('keeps a row with data a column of its own lesson when its source changed (must-fix 2)', () => {
    // Numbers typed at L3 for homework given at L1; then L2, unresolved
    // before, has its teacher recorded and is held: source(L3) is L2 now.
    const row = stored('w1', {
      kind: 'homework',
      lessonId: 'L3',
      sourceLessonId: 'L1',
      planWorkId: 'h1',
      total: 5,
      hasNumbers: true,
    });
    const columns = run({
      lessons: [lesson(1), lesson(2), lesson(3)],
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
    expect(columns.get('L3')?.columns.map((one) => one.workId)).toEqual(['w1']);
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

  it('finds a column with no row by its plan work and source', () => {
    const columns = run({
      lessons: [lesson(1), lesson(2)],
      planned: new Map([['L1', [hw('h1')]]]),
    });
    expect(columnAt(columns, 'L2', { planWorkId: 'h1', sourceLessonId: 'L1' })?.kind).toBe(
      'homework',
    );
    expect(columnAt(columns, 'L1', { planWorkId: 'h1', sourceLessonId: 'L1' })).toBeNull();
  });

  it('shows every stored row with a number in exactly one lesson', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 2, maxLength: 8 }),
        fc.array(
          fc.record({
            at: fc.nat(7),
            source: fc.nat(7),
            homework: fc.boolean(),
            numbers: fc.boolean(),
          }),
          { maxLength: 6 },
        ),
        (cancelled, rows) => {
          const lessons = cancelled.map((one, at) => lesson(at + 1, { cancelled: one }));
          const works = rows.map((row, at) =>
            stored(`w${at}`, {
              lessonId: `L${(row.at % lessons.length) + 1}`,
              sourceLessonId: `L${(row.source % lessons.length) + 1}`,
              kind: row.homework ? 'homework' : 'classwork',
              position: at + 1,
              total: 10,
              hasNumbers: row.numbers,
            }),
          );
          const columns = run({ lessons, stored: works });
          for (const work of works.filter((one) => one.hasNumbers)) {
            const places = [...columns.values()].filter((one) =>
              one.columns.some((column) => column.workId === work.id),
            );
            expect(places).toHaveLength(1);
          }
        },
      ),
    );
  });
});
