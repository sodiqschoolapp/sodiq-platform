import { describe, expect, it } from 'vitest';
import { mondayOf, publishImpact, transitionWeek, type ImpactLesson } from './impact.js';
import { weekdayOf } from './templates.js';

// Task 5.5a-2b-1: the impact preview and the transition week. Invented names only.

const L2 = { start: 530, end: 575 };
const L3 = { start: 595, end: 640 };

const at = (date: string, extra: Partial<ImpactLesson> = {}): ImpactLesson => ({
  date,
  weekday: weekdayOf(date),
  ...L2,
  unitId: '7a',
  subjectId: 'math',
  classIds: ['7a'],
  teacherIds: ['t1'],
  roomId: 'r1',
  ...extra,
});

// Mondays and Tuesdays of two weeks (16 and 23 November 2026).
const MONDAYS = ['2026-11-16', '2026-11-23'];
const TUESDAYS = ['2026-11-17', '2026-11-24'];

describe('publishImpact', () => {
  it('lists nothing for lessons that stay the same', () => {
    const lessons = MONDAYS.map((date) => at(date));
    const impact = publishImpact({ before: lessons, after: lessons.map((one) => ({ ...one })) });
    expect(impact.changes).toEqual([]);
    expect(impact.counts).toEqual({ created: 0, moved: 0, removed: 0, changed: 0, unchanged: 2 });
    expect(impact.teacherIds).toEqual([]);
  });

  it('does not count a teacher whose lessons are all unchanged as affected', () => {
    const before = [
      at(MONDAYS[0] ?? ''),
      at(MONDAYS[0] ?? '', { unitId: '7b', classIds: ['7b'], teacherIds: ['t2'], roomId: 'r2' }),
    ];
    const after = [at(MONDAYS[0] ?? '', { teacherIds: ['t3'] }), before[1] ?? at('')];
    const impact = publishImpact({ before, after });
    expect(impact.teacherIds).toEqual(['t1', 't3']);
    expect(impact.classIds).toEqual(['7a']);
  });

  it('gives a teacher change at the same time as changed, both teachers affected', () => {
    const before = MONDAYS.map((date) => at(date));
    const after = MONDAYS.map((date) => at(date, { teacherIds: ['t2'] }));
    const impact = publishImpact({ before, after });
    expect(impact.changes).toEqual([
      {
        kind: 'changed',
        unitId: '7a',
        subjectId: 'math',
        classIds: ['7a'],
        before: { weekday: 1, ...L2, teacherIds: ['t1'], roomId: 'r1' },
        after: { weekday: 1, ...L2, teacherIds: ['t2'], roomId: 'r1' },
        count: 2,
        firstDate: '2026-11-16',
        lastDate: '2026-11-23',
      },
    ]);
    expect(impact.teacherIds).toEqual(['t1', 't2']);
    expect(impact.roomIds).toEqual(['r1']);
  });

  it('gives a room change as changed, both rooms affected', () => {
    const impact = publishImpact({
      before: [at(MONDAYS[0] ?? '')],
      after: [at(MONDAYS[0] ?? '', { roomId: 'r2' })],
    });
    expect(impact.counts.changed).toBe(1);
    expect(impact.roomIds).toEqual(['r1', 'r2']);
  });

  it('gives Monday slot 2 to Tuesday slot 3 as one moved line with the count of its dates', () => {
    const before = MONDAYS.map((date) => at(date));
    const after = TUESDAYS.map((date) => at(date, L3));
    const impact = publishImpact({ before, after });
    expect(impact.changes).toEqual([
      {
        kind: 'moved',
        unitId: '7a',
        subjectId: 'math',
        classIds: ['7a'],
        before: { weekday: 1, ...L2, teacherIds: ['t1'], roomId: 'r1' },
        after: { weekday: 2, ...L3, teacherIds: ['t1'], roomId: 'r1' },
        count: 2,
        firstDate: '2026-11-16',
        lastDate: '2026-11-24',
      },
    ]);
  });

  it('never pairs a move across two weeks', () => {
    // A Friday lesson of one week and the Monday of the next.
    const impact = publishImpact({
      before: [at('2026-11-20')],
      after: [at('2026-11-23')],
    });
    expect(impact.changes.map((one) => one.kind)).toEqual(['created', 'removed']);
    expect(impact.counts).toMatchObject({ created: 1, removed: 1, moved: 0 });
  });

  it('gives a new subject as created and a dropped one as removed', () => {
    const impact = publishImpact({
      before: [at(MONDAYS[0] ?? '', { subjectId: 'art' })],
      after: [at(MONDAYS[0] ?? '', { subjectId: 'music', ...L3 })],
    });
    expect(
      impact.changes.map((one) => [one.kind, one.subjectId, one.before?.start, one.after?.start]),
    ).toEqual([
      ['created', 'music', undefined, L3.start],
      ['removed', 'art', L2.start, undefined],
    ]);
  });

  it('keeps two changes that differ only in their room as two lines', () => {
    const before = MONDAYS.map((date) => at(date));
    const after = [
      at(MONDAYS[0] ?? '', { teacherIds: ['t2'] }),
      at(MONDAYS[1] ?? '', { teacherIds: ['t2'], roomId: 'r2' }),
    ];
    const impact = publishImpact({ before, after });
    expect(impact.changes).toHaveLength(2);
    expect(impact.changes.map((one) => [one.after?.roomId, one.count])).toEqual([
      ['r1', 1],
      ['r2', 1],
    ]);
  });

  it('names every class a group lesson draws from', () => {
    const group = { unitId: 'g-pe', subjectId: 'pe', classIds: ['9a', '10b'] };
    const impact = publishImpact({ before: [], after: [at(MONDAYS[0] ?? '', group)] });
    expect(impact.classIds).toEqual(['10b', '9a']);
    expect(impact.changes[0]?.classIds).toEqual(['10b', '9a']);
  });
});

describe('transitionWeek', () => {
  // The week of Wednesday 18 November 2026: Monday 16 to Sunday 22.
  const START = '2026-11-18';
  const load = [{ unitId: '7a', subjectId: 'math', lessonsPerWeek: 3 }];

  it('is the Monday-to-Sunday week of the start', () => {
    expect(mondayOf(START)).toBe('2026-11-16');
    expect(mondayOf('2026-11-16')).toBe('2026-11-16');
    expect(mondayOf('2026-11-22')).toBe('2026-11-16');
  });

  it('lists every class and subject of a Wednesday start against the load, the differences marked', () => {
    const week = transitionWeek({
      startsOn: START,
      // The earlier version: Monday and Tuesday mathematics, Monday art.
      before: [at('2026-11-16'), at('2026-11-17'), at('2026-11-16', { subjectId: 'art', ...L3 })],
      // The new version: Wednesday and Thursday mathematics, Thursday art.
      after: [at('2026-11-18'), at('2026-11-19'), at('2026-11-19', { subjectId: 'art', ...L3 })],
      load: [...load, { unitId: '7a', subjectId: 'art', lessonsPerWeek: 2 }],
    });
    expect(week).toEqual({
      weekStart: '2026-11-16',
      weekEnd: '2026-11-22',
      rows: [
        { unitId: '7a', subjectId: 'art', before: 1, after: 1, lessonsPerWeek: 2, differs: false },
        { unitId: '7a', subjectId: 'math', before: 2, after: 2, lessonsPerWeek: 3, differs: true },
      ],
    });
  });

  it('leaves out lessons outside the week and on the wrong side of the start', () => {
    const week = transitionWeek({
      startsOn: START,
      before: [at('2026-11-16'), at('2026-11-18'), at('2026-11-09')],
      after: [at('2026-11-17'), at('2026-11-19'), at('2026-11-23')],
      load,
    });
    expect(week?.rows).toEqual([
      { unitId: '7a', subjectId: 'math', before: 1, after: 1, lessonsPerWeek: 3, differs: true },
    ]);
  });

  it('gives a day off in the week as a difference', () => {
    // Mathematics on Monday to Thursday, 4 a week; Tuesday is a day off, so
    // the earlier version gives only Monday.
    const week = transitionWeek({
      startsOn: START,
      before: [at('2026-11-16')],
      after: [at('2026-11-18'), at('2026-11-19')],
      load: [{ unitId: '7a', subjectId: 'math', lessonsPerWeek: 4 }],
    });
    expect(week?.rows[0]).toMatchObject({ before: 1, after: 2, lessonsPerWeek: 4, differs: true });
  });

  it('is none for a Monday start', () => {
    expect(
      transitionWeek({ startsOn: '2026-11-16', before: [], after: [at('2026-11-16')], load }),
    ).toBeNull();
  });

  it('is none when no date before the start has lessons (a vacation, the start of the year)', () => {
    // A quarter that starts on a Wednesday after a vacation: the earlier dates give no lessons.
    expect(
      transitionWeek({ startsOn: START, before: [], after: [at('2026-11-18')], load }),
    ).toBeNull();
  });

  it('lists a subject only the earlier lessons have against 0', () => {
    const week = transitionWeek({
      startsOn: START,
      before: [at('2026-11-16', { subjectId: 'art' })],
      after: [],
      load: [],
    });
    expect(week?.rows).toEqual([
      { unitId: '7a', subjectId: 'art', before: 1, after: 0, lessonsPerWeek: 0, differs: true },
    ]);
  });

  it('lists a subject of the load with no lesson in the week', () => {
    const week = transitionWeek({
      startsOn: START,
      before: [at('2026-11-16', { subjectId: 'art' })],
      after: [],
      load,
    });
    expect(week?.rows.map((row) => [row.subjectId, row.before + row.after, row.differs])).toEqual([
      ['art', 1, true],
      ['math', 0, true],
    ]);
  });
});
