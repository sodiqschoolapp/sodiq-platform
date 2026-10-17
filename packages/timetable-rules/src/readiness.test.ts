import { describe, expect, it } from 'vitest';
import {
  draftReady,
  loadReadiness,
  roomsReadiness,
  teachersReadiness,
  templatesReadiness,
  type TemplateCell,
} from './readiness.js';

// Task 5.3a (pull request #127): the "ready when" checks of steps 1 to 4 of
// the draft builder (06, Building a timetable).

const MONDAY = '2026-10-19';
const TODAY = '2026-10-17';

const regular: TemplateCell['template'] = {
  id: 'regular',
  slots: [
    ['lesson', 480, 525],
    ['break', 525, 535],
    ['lesson', 535, 580],
  ],
};

const cell = (
  weekday: number,
  grade: number,
  template: TemplateCell['template'] = regular,
): TemplateCell => ({
  weekday,
  grade,
  date: `2026-10-${String(18 + weekday).padStart(2, '0')}`,
  template,
});

const table = [cell(1, 7), cell(2, 7), cell(1, 9), cell(2, 9)];

describe('templatesReadiness (step 1)', () => {
  it('is ready when the table is confirmed as it stands', () => {
    expect(
      templatesReadiness({ startsOn: MONDAY, today: TODAY, cells: table, confirmed: table }),
    ).toEqual({ ready: true, startPast: false, confirmed: true, changed: [], missing: [] });
  });

  it('is not ready while nothing is confirmed', () => {
    expect(
      templatesReadiness({ startsOn: MONDAY, today: TODAY, cells: table, confirmed: null }),
    ).toMatchObject({ ready: false, confirmed: false, changed: [] });
  });

  it('is not ready with a start date before today, the table confirmed', () => {
    expect(
      templatesReadiness({ startsOn: '2026-10-16', today: TODAY, cells: table, confirmed: table }),
    ).toMatchObject({ ready: false, startPast: true, confirmed: true });
  });

  it('takes a start date of today', () => {
    expect(
      templatesReadiness({ startsOn: TODAY, today: TODAY, cells: table, confirmed: table }).ready,
    ).toBe(true);
  });

  it('marks a cell with another template changed', () => {
    const now = [cell(1, 7), cell(2, 7, { ...regular, id: 'short day' }), cell(1, 9), cell(2, 9)];
    expect(
      templatesReadiness({ startsOn: MONDAY, today: TODAY, cells: now, confirmed: table }),
    ).toMatchObject({ ready: false, confirmed: false, changed: [{ weekday: 2, grade: 7 }] });
  });

  it('marks a cell whose template has another slot time changed (a break moved)', () => {
    const moved: TemplateCell['template'] = {
      id: 'regular',
      slots: [
        ['lesson', 480, 525],
        ['break', 525, 540],
        ['lesson', 540, 585],
      ],
    };
    const now = [cell(1, 7), cell(2, 7), cell(1, 9, moved), cell(2, 9)];
    expect(
      templatesReadiness({ startsOn: MONDAY, today: TODAY, cells: now, confirmed: table }).changed,
    ).toEqual([{ weekday: 1, grade: 9 }]);
  });

  it('marks the cells of a grade that has a class since the confirm changed', () => {
    const now = [...table, cell(1, 4), cell(2, 4)];
    expect(
      templatesReadiness({ startsOn: MONDAY, today: TODAY, cells: now, confirmed: table }),
    ).toMatchObject({
      ready: false,
      changed: [
        { weekday: 1, grade: 4 },
        { weekday: 2, grade: 4 },
      ],
    });
  });

  // Correction 1 of the review: the dates move with the start date; the table does not.
  it('stays confirmed when only the dates of the cells moved', () => {
    const later = table.map((one) => ({ ...one, date: '2026-11-02' }));
    expect(
      templatesReadiness({ startsOn: '2026-11-02', today: TODAY, cells: later, confirmed: table }),
    ).toMatchObject({ ready: true, confirmed: true, changed: [] });
  });

  it('is not ready with a cell that has no template, and names it', () => {
    const now = [cell(1, 7), cell(2, 7, null), cell(1, 9), cell(2, 9)];
    expect(
      templatesReadiness({ startsOn: MONDAY, today: TODAY, cells: now, confirmed: now }),
    ).toEqual({
      ready: false,
      startPast: false,
      confirmed: true,
      changed: [],
      missing: [{ weekday: 2, grade: 7 }],
    });
  });

  it('is not ready with an empty table (no class in the year)', () => {
    expect(
      templatesReadiness({ startsOn: MONDAY, today: TODAY, cells: [], confirmed: [] }).ready,
    ).toBe(false);
  });
});

describe('loadReadiness (step 2)', () => {
  const fits = [{ id: 'oxford', lessons: 28, lessonSlots: 30 }];

  it('is ready with rows that have no problem and classes that fit', () => {
    expect(
      loadReadiness({ rows: [{ id: 'r1', problems: [] }], leftRows: 0, classes: fits }),
    ).toEqual({ ready: true, empty: false, rows: [], leftRows: 0, classesOver: [] });
  });

  it('is not ready with no row', () => {
    expect(loadReadiness({ rows: [], leftRows: 0, classes: [] })).toMatchObject({
      ready: false,
      empty: true,
    });
  });

  it.each([
    'load_teacher_subject',
    'load_no_tutor',
    'load_tutor_row_teacher',
    'load_group_gaps',
    'load_block_lessons',
  ] as const)('is not ready with a row with %s', (problem) => {
    expect(
      loadReadiness({
        rows: [
          { id: 'r1', problems: [] },
          { id: 'r2', problems: [problem] },
        ],
        leftRows: 0,
        classes: fits,
      }),
    ).toMatchObject({ ready: false, rows: ['r2'] });
  });

  it('leaves the room problems to step 4', () => {
    expect(
      loadReadiness({
        rows: [{ id: 'r1', problems: ['load_room_closed'] }],
        leftRows: 0,
        classes: fits,
      }),
    ).toMatchObject({ ready: true, rows: [] });
  });

  it('is not ready while rows a copy left wait for dismissal', () => {
    expect(
      loadReadiness({ rows: [{ id: 'r1', problems: [] }], leftRows: 2, classes: fits }),
    ).toMatchObject({ ready: false, leftRows: 2 });
  });

  it('is not ready with a class whose lessons do not fit its week, and takes one that just fits', () => {
    expect(
      loadReadiness({
        rows: [{ id: 'r1', problems: [] }],
        leftRows: 0,
        classes: [
          { id: 'oxford', lessons: 31, lessonSlots: 30 },
          { id: 'brown', lessons: 30, lessonSlots: 30 },
        ],
      }),
    ).toMatchObject({ ready: false, classesOver: ['oxford'] });
  });
});

describe('teachersReadiness (step 3)', () => {
  it('is ready when every teacher has hours and no more lessons than free slots', () => {
    expect(teachersReadiness([{ id: 'a', lessons: 24, freeSlots: 24 }])).toEqual({
      ready: true,
      noHours: [],
      over: [],
    });
  });

  it('is not ready with a teacher with no hours entry in force', () => {
    expect(teachersReadiness([{ id: 'a', lessons: 2, freeSlots: null }])).toEqual({
      ready: false,
      noHours: ['a'],
      over: [],
    });
  });

  // 06, Rules: a vacancy is bound by every blocked rule that binds a teacher.
  it('is not ready with a teacher or a vacancy over the free slots', () => {
    expect(
      teachersReadiness([
        { id: 'teacher', lessons: 26, freeSlots: 24 },
        { id: 'vacancy', lessons: 5, freeSlots: 4 },
      ]),
    ).toEqual({ ready: false, noHours: [], over: ['teacher', 'vacancy'] });
  });
});

describe('roomsReadiness (step 4)', () => {
  const rooms = [
    { type: 'classroom', closed: false },
    { type: 'laboratory', closed: true },
    { type: 'sports_hall', closed: false },
  ];

  it('is ready when every room need is met', () => {
    expect(
      roomsReadiness({
        rows: [
          { id: 'r1', roomType: 'sports_hall', problems: [] },
          { id: 'r2', roomType: null, problems: [] },
        ],
        rooms,
      }),
    ).toEqual({ ready: true, closed: [], typeNone: [] });
  });

  it('is not ready with a room type whose only room is closed, or no room of it', () => {
    expect(
      roomsReadiness({
        rows: [
          { id: 'r1', roomType: 'laboratory', problems: [] },
          { id: 'r2', roomType: 'hall', problems: [] },
        ],
        rooms,
      }),
    ).toEqual({ ready: false, closed: [], typeNone: ['r1', 'r2'] });
  });

  it('is not ready with a row that names a closed room', () => {
    expect(
      roomsReadiness({
        rows: [{ id: 'r1', roomType: null, problems: ['load_room_closed'] }],
        rooms,
      }),
    ).toEqual({ ready: false, closed: ['r1'], typeNone: [] });
  });

  it('takes a room under repair, the only room of its type (it is not closed)', () => {
    expect(
      roomsReadiness({
        rows: [{ id: 'r1', roomType: 'hall', problems: [] }],
        rooms: [{ type: 'hall', closed: false }],
      }).ready,
    ).toBe(true);
  });
});

describe('draftReady', () => {
  it('is ready only when every step is', () => {
    expect(draftReady([{ ready: true }, { ready: true }])).toBe(true);
    expect(draftReady([{ ready: true }, { ready: false }])).toBe(false);
  });
});
