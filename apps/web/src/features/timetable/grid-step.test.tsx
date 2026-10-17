import type { GridAnswer, TimetableVersion } from '@sodiq/shared';
import { patternModel, RULE_ORDER } from '@sodiq/timetable-rules';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { uz } from '@/i18n/locales/uz';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';
import { setWindowWidth } from '@/testing/window-width';
import { boardOf, cellStatus } from './use-slot-status';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const YEAR_ID = uid(1);

const VERSION: TimetableVersion = {
  id: uid(500),
  academicYearId: YEAR_ID,
  yearName: '2026–2027',
  yearStatus: 'current',
  number: 1,
  status: 'draft',
  startsOn: '2026-10-19',
  fromVersion: null,
  rows: 3,
  leftRows: 0,
};

const OXFORD = uid(101);
const PRINCETON = uid(102);
const GROUP = uid(103);
const KARIMOVA = uid(600);
const TOSHEVA = uid(602);
const MATH = uid(201);
const ENGLISH = uid(202);
const ROW_OXFORD = uid(700);
const ROW_PRINCETON = uid(701);
const ROW_GROUP = uid(702);
const BLOCK_OXFORD = uid(800);
const BLOCK_PRINCETON = uid(801);
const BLOCK_GROUP = uid(802);
const ROOM = uid(900);

// Grade 7: lesson, break, lesson, break, lesson from 08:00 (positions 1 to 5).
const DAY = {
  start: 480,
  end: 625,
  slots: [
    { position: 1, kind: 'lesson' as const, start: 480, end: 525, lessonNumber: 1 },
    { position: 2, kind: 'break' as const, start: 525, end: 530, lessonNumber: null },
    { position: 3, kind: 'lesson' as const, start: 530, end: 575, lessonNumber: 2 },
    { position: 4, kind: 'break' as const, start: 575, end: 580, lessonNumber: null },
    { position: 5, kind: 'lesson' as const, start: 580, end: 625, lessonNumber: 3 },
  ],
};

const teacher = (id: string) => ({
  id,
  vacancy: false,
  out: false,
  branchIds: [NORTH.id],
  subjects: [MATH, ENGLISH].map((subjectId) => ({ subjectId, grades: [7] })),
  languages: ['uz'],
  availability: [
    {
      branchId: NORTH.id,
      validFrom: '2026-09-01',
      validUntil: null,
      ranges: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: 0, end: 1440 })),
    },
  ],
  weeklyLessons: null,
  dailyLessons: null,
});

const unit = (
  id: string,
  name: string,
  kind: 'class' | 'group' = 'class',
): GridAnswer['rows'][number]['unit'] => ({
  kind,
  id,
  name,
  grades: [7],
  language: 'uz',
  archived: false,
});

// All names are invented. Karimova teaches mathematics in Oxford and in
// Princeton; Tosheva the English group that draws from both classes.
const GRID: GridAnswer = {
  version: VERSION,
  editable: true,
  classes: [
    { id: OXFORD, name: 'Oxford', grade: 7 },
    { id: PRINCETON, name: 'Princeton', grade: 7 },
  ],
  rows: [
    {
      id: ROW_OXFORD,
      unit: unit(OXFORD, 'Oxford'),
      subject: {
        id: MATH,
        names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
        colour: 'blue',
      },
      teacher: { id: KARIMOVA, kind: 'person', name: 'Karimova Aziza' },
      lessonsPerWeek: 3,
      mixedBlock: false,
    },
    {
      id: ROW_PRINCETON,
      unit: unit(PRINCETON, 'Princeton'),
      subject: {
        id: MATH,
        names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
        colour: 'blue',
      },
      teacher: { id: KARIMOVA, kind: 'person', name: 'Karimova Aziza' },
      lessonsPerWeek: 3,
      mixedBlock: false,
    },
    {
      id: ROW_GROUP,
      unit: unit(GROUP, '7-E-1', 'group'),
      subject: {
        id: ENGLISH,
        names: { uz: 'Ingliz tili', ru: 'Английский язык', en: 'English' },
        colour: 'green',
      },
      teacher: { id: TOSHEVA, kind: 'person', name: 'Tosheva Dilnoza' },
      lessonsPerWeek: 2,
      mixedBlock: false,
    },
  ],
  rooms: [{ id: ROOM, name: 'Room 12' }],
  blocks: [
    {
      id: BLOCK_OXFORD,
      weekday: 1,
      slotPosition: 1,
      start: 480,
      end: 525,
      lessons: [{ id: uid(1000), loadRowId: ROW_OXFORD, roomId: ROOM }],
    },
    {
      id: BLOCK_PRINCETON,
      weekday: 1,
      slotPosition: 3,
      start: 530,
      end: 575,
      lessons: [{ id: uid(1001), loadRowId: ROW_PRINCETON, roomId: null }],
    },
    {
      id: BLOCK_GROUP,
      weekday: 2,
      slotPosition: 1,
      start: 480,
      end: 525,
      lessons: [{ id: uid(1002), loadRowId: ROW_GROUP, roomId: null }],
    },
  ],
  facts: {
    branchId: NORTH.id,
    startDate: '2026-10-19',
    versionEnd: '2027-05-31',
    teachers: [teacher(KARIMOVA), teacher(TOSHEVA)],
    subjects: [MATH, ENGLISH].map((id) => ({
      id,
      active: true,
      languageRule: false,
      tutorSubject: false,
    })),
    rooms: [{ id: ROOM, status: 'in_use', shared: false, lessonsAtOnce: 1, capacity: 30 }],
    units: [
      {
        id: OXFORD,
        kind: 'class',
        grades: [7],
        language: 'uz',
        tutorOnStart: null,
        classIds: [OXFORD],
        studentIds: [uid(3001), uid(3002)],
        mainRoomId: ROOM,
      },
      {
        id: PRINCETON,
        kind: 'class',
        grades: [7],
        language: 'uz',
        tutorOnStart: null,
        classIds: [PRINCETON],
        studentIds: [uid(3003)],
        mainRoomId: null,
      },
      {
        id: GROUP,
        kind: 'group',
        grades: [7],
        language: 'uz',
        tutorOnStart: null,
        classIds: [OXFORD, PRINCETON],
        studentIds: [uid(3001), uid(3002), uid(3003)],
        mainRoomId: null,
      },
    ],
    classStudents: [
      { classId: OXFORD, studentIds: [uid(3001), uid(3002)] },
      { classId: PRINCETON, studentIds: [uid(3003)] },
    ],
    days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      grade: 7,
      weekday,
      day:
        weekday <= 5
          ? { lessons: true as const, day: DAY, noRegularLessons: false }
          : { lessons: false as const, reason: 'not_working_day' as const },
    })),
    year: {
      firstDate: '2026-09-01',
      lastDate: '2027-05-31',
      quarters: [{ firstDate: '2026-09-01', lastDate: '2027-05-31' }],
    },
    travel: [],
    classDailyLessons: null,
    rows: [
      {
        id: ROW_OXFORD,
        classId: OXFORD,
        groupId: null,
        subjectId: MATH,
        teacherId: KARIMOVA,
        roomId: null,
        lessonsPerWeek: 3,
        mixedBlock: false,
        block: [ROW_OXFORD],
      },
      {
        id: ROW_PRINCETON,
        classId: PRINCETON,
        groupId: null,
        subjectId: MATH,
        teacherId: KARIMOVA,
        roomId: null,
        lessonsPerWeek: 3,
        mixedBlock: false,
        block: [ROW_PRINCETON],
      },
      {
        id: ROW_GROUP,
        classId: null,
        groupId: GROUP,
        subjectId: ENGLISH,
        teacherId: TOSHEVA,
        roomId: null,
        lessonsPerWeek: 2,
        mixedBlock: false,
        block: [ROW_GROUP],
      },
    ],
    otherDrafts: [],
  },
  results: [],
};

const vice = () =>
  sessionOf({
    assignments: [{ role: 'academic_vice_principal', branchId: NORTH.id }],
    branches: [NORTH],
  });

const principal = () =>
  sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }], branches: [NORTH] });

const READINESS_STEP = { ready: true };

async function openGrid(
  options: {
    session?: ReturnType<typeof sessionOf>;
    language?: 'en' | 'ru';
    grid?: GridAnswer;
    moved?: () => Response;
    placed?: () => Response;
  } = {},
) {
  const language = options.language ?? 'en';
  const calls = fakeApi({
    'GET /api/auth/session': () => json({ ...(options.session ?? vice()), language }),
    'GET /api/timetable/versions': () => json({ versions: [VERSION], today: '2026-10-10' }),
    [`GET /api/timetable/versions/${VERSION.id}/readiness`]: () =>
      json({
        ready: false,
        templates: {
          ...READINESS_STEP,
          startsOn: '2026-10-19',
          startPast: false,
          cells: [],
          confirmed: true,
          changed: [],
          missing: [],
        },
        load: {
          ...READINESS_STEP,
          rows: 3,
          problemRows: [],
          leftRows: 0,
          classesOver: [],
          tutorPinClashes: [],
        },
        teachers: { ...READINESS_STEP, teachers: [] },
        rooms: { ...READINESS_STEP, rows: [], classesWithoutRoom: [] },
        rules: {
          ready: false,
          confirmed: false,
          weights: {
            class_no_gaps: 5,
            teacher_few_gaps: 5,
            subject_spread: 5,
            demanding_early: 5,
            class_even_days: 5,
            main_room: 5,
            part_time_few_days: 5,
            teacher_preferred_times: 5,
          },
          changed: [],
          pins: [],
          pinsChanged: false,
          conflicts: [],
          problems: [],
        },
      }),
    'GET /api/setup/academic-years': () => json({ years: [] }),
    [`GET /api/timetable/versions/${VERSION.id}/grid`]: () => json(options.grid ?? GRID),
    [`POST /api/timetable/versions/${VERSION.id}/pattern/${BLOCK_OXFORD}/move`]: () =>
      options.moved?.() ?? json(options.grid ?? GRID),
    [`POST /api/timetable/versions/${VERSION.id}/pattern`]: () =>
      options.placed?.() ?? json(options.grid ?? GRID, 201),
  });
  renderApp(`/timetable/builder?version=${VERSION.id}&step=grid`, language);
  await waitFor(() => {
    expect(document.querySelector('[data-board]')).not.toBeNull();
  });
  return calls;
}

const tile = (blockId: string) => document.querySelector<HTMLElement>(`[data-block="${blockId}"]`);
const cellOf = (weekday: number, position: number) =>
  document.querySelector<HTMLElement>(`[data-cell="${String(weekday)}:${String(position)}"]`);

// docs/spec/06-timetable.md, Editing in the grid; task 5.4a, pull request #130.
describe('the grid of step 7', () => {
  it('shows the board of a class with its lessons, a group block of two classes on both (review correction 2)', async () => {
    await openGrid();
    const oxford = tile(BLOCK_OXFORD);
    expect(oxford?.textContent).toContain('Mathematics');
    expect(oxford?.textContent).toContain('Karimova Aziza');
    expect(oxford?.textContent).toContain('Room 12');
    expect(tile(BLOCK_PRINCETON)).toBeNull();
    expect(cellOf(2, 1)?.contains(tile(BLOCK_GROUP))).toBe(true);
    fireEvent.change(screen.getByLabelText(en.timetable.grid.class), {
      target: { value: PRINCETON },
    });
    await waitFor(() => {
      expect(tile(BLOCK_PRINCETON)).not.toBeNull();
    });
    expect(tile(BLOCK_OXFORD)).toBeNull();
    expect(cellOf(2, 1)?.contains(tile(BLOCK_GROUP))).toBe(true);
  });

  it('opens Move by a tap, marks the slot where the teacher is busy blocked with the rule, and moves to a free slot', async () => {
    const calls = await openGrid();
    const own = tile(BLOCK_OXFORD);
    if (own === null) throw new Error('No tile.');
    const move = within(own).getByRole('button', { name: en.timetable.grid.move });
    // A real button: the keyboard reaches and presses it as a tap does.
    move.focus();
    expect(document.activeElement).toBe(move);
    fireEvent.pointerDown(move);
    fireEvent.click(move);
    const dialog = await screen.findByRole('dialog');
    const busy = dialog.querySelector<HTMLElement>('[data-move-cell="1:3"]');
    expect(busy?.querySelector('button')?.disabled).toBe(true);
    expect(busy?.querySelector('[data-status]')?.getAttribute('data-status')).toBe('blocked');
    expect(busy?.querySelector('[data-reason]')?.textContent).toContain(
      en.timetable.rule.teacher_double,
    );
    const free = dialog.querySelector<HTMLElement>('[data-move-cell="3:5"] button');
    expect(free?.disabled).toBe(false);
    if (free === null || free === undefined) throw new Error('No free slot.');
    fireEvent.click(free);
    await waitFor(() => {
      expect(calls.map((call) => call.route)).toContain(
        `POST /api/timetable/versions/${VERSION.id}/pattern/${BLOCK_OXFORD}/move`,
      );
    });
    expect(calls.find((call) => call.route.endsWith(`${BLOCK_OXFORD}/move`))?.body).toEqual({
      weekday: 3,
      slotPosition: 5,
    });
  });

  it('shows the rule the server names when it refuses a move', async () => {
    await openGrid({
      moved: () =>
        json(
          {
            error: {
              code: 'pattern_blocked',
              message: 'A blocked rule refuses the lesson at that slot.',
              requestId: uid(4000),
              details: [
                {
                  path: '',
                  code: 'teacher_unavailable',
                  message: 'A blocked rule of the timetable.',
                  rule: { weekday: 3, lessonIds: [uid(1000)] },
                },
              ],
            },
          },
          409,
        ),
    });
    const own = tile(BLOCK_OXFORD);
    if (own === null) throw new Error('No tile.');
    fireEvent.click(within(own).getByRole('button', { name: en.timetable.grid.move }));
    const dialog = await screen.findByRole('dialog');
    const free = dialog.querySelector<HTMLButtonElement>('[data-move-cell="3:5"] button');
    if (free === null) throw new Error('No free slot.');
    fireEvent.click(free);
    const alert = await screen.findByText((text) =>
      text.includes(en.timetable.rule.teacher_unavailable),
    );
    expect(alert.textContent).toContain(en.errors.pattern_blocked);
  });

  it('places a row from an empty slot with the position of its slot', async () => {
    const calls = await openGrid();
    const empty = cellOf(4, 3);
    if (empty === null) throw new Error('No cell.');
    fireEvent.click(within(empty).getByRole('button', { name: /Add a lesson/ }));
    const form = await screen.findByRole('form');
    const select = within(form).getByLabelText(en.timetable.grid.lesson);
    const options = [...select.querySelectorAll('option')].map((one) => one.textContent);
    // Oxford's own row and the group drawing from it; not Princeton's.
    expect(options).toEqual([
      en.timetable.grid.choose,
      'Mathematics, 7 Oxford: 1 of 3 lessons placed',
      'English, 7-E-1: 1 of 2 lessons placed',
    ]);
    fireEvent.change(select, { target: { value: ROW_OXFORD } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/pattern'))?.body).toEqual({
        loadRowId: ROW_OXFORD,
        weekday: 4,
        slotPosition: 3,
      });
    });
  });

  it('gives the Principal the board with no move, remove or add', async () => {
    await openGrid({ session: principal() });
    expect(tile(BLOCK_OXFORD)).not.toBeNull();
    expect(screen.queryByRole('button', { name: en.timetable.grid.move })).toBeNull();
    expect(screen.queryByRole('button', { name: en.timetable.grid.remove })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add a lesson/ })).toBeNull();
  });

  it('is view only at phone width (12, Devices)', async () => {
    setWindowWidth(375);
    await openGrid();
    expect(tile(BLOCK_OXFORD)).not.toBeNull();
    expect(screen.queryByRole('button', { name: en.timetable.grid.move })).toBeNull();
    expect(screen.getByText(en.timetable.grid.phoneView)).toBeTruthy();
  });

  it('is read only for a published version', async () => {
    await openGrid({ grid: { ...GRID, editable: false } });
    expect(screen.queryByRole('button', { name: en.timetable.grid.move })).toBeNull();
    expect(screen.getByText(en.timetable.grid.readOnly)).toBeTruthy();
  });

  it('speaks Russian', async () => {
    await openGrid({ language: 'ru' });
    const own = tile(BLOCK_OXFORD);
    expect(own?.textContent).toContain('Математика');
    expect(
      within(own ?? document.body).getByRole('button', { name: ru.timetable.grid.move }),
    ).toBeTruthy();
  });
});

describe('the status of a slot while a lesson is moved', () => {
  const model = patternModel(GRID.facts);
  const board = boardOf(GRID, model, OXFORD);
  const oxford = GRID.blocks[0];
  if (oxford === undefined) throw new Error('No block.');

  it('is blocked with the rule where the teacher is busy, free elsewhere, and a swap onto another lesson', () => {
    const busy = board.cellAt(1, 3);
    const free = board.cellAt(3, 1);
    const taken = board.cellAt(2, 1);
    if (busy === null || free === null || taken === null) throw new Error('No cell.');
    expect(cellStatus(model, board, GRID.blocks, oxford, busy)).toMatchObject({
      status: 'blocked',
      rule: 'teacher_double',
    });
    // A row short of its load warns on every slot alike: not shown while moving.
    expect(cellStatus(model, board, GRID.blocks, oxford, free)).toMatchObject({
      status: 'free',
      rule: null,
      drop: { kind: 'move' },
    });
    expect(cellStatus(model, board, GRID.blocks, oxford, taken).drop.kind).toBe('swap');
  });

  it('has a text for every rule of the engine in each language', () => {
    for (const locale of [en, ru, uz]) {
      for (const rule of RULE_ORDER) {
        expect(locale.timetable.rule[rule], rule).toBeTruthy();
      }
    }
  });
});
