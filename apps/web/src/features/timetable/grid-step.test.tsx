import { weekdaySchema, type GridAnswer, type TimetableVersion } from '@sodiq/shared';
import { patternModel, RULE_ORDER, suggestPlaces } from '@sodiq/timetable-rules';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { uz } from '@/i18n/locales/uz';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';
import { setWindowWidth } from '@/testing/window-width';
import { rearrangeOf } from './grid-suggest-dialog';
import { boardOf, cellStatus, newBlockOf } from './use-slot-status';

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
  editLock: null,
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
const LOCK = uid(1900);
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
      doublePairId: null,
    },
    {
      id: BLOCK_PRINCETON,
      weekday: 1,
      slotPosition: 3,
      start: 530,
      end: 575,
      lessons: [{ id: uid(1001), loadRowId: ROW_PRINCETON, roomId: null }],
      doublePairId: null,
    },
    {
      id: BLOCK_GROUP,
      weekday: 2,
      slotPosition: 1,
      start: 480,
      end: 525,
      lessons: [{ id: uid(1002), loadRowId: ROW_GROUP, roomId: null }],
      doublePairId: null,
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
    rooms: [
      {
        id: ROOM,
        type: 'classroom',
        status: 'in_use',
        shared: false,
        lessonsAtOnce: 1,
        capacity: 30,
      },
    ],
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
        roomType: null,
        lessonsPerWeek: 3,
        mixedBlock: false,
        doubleLessons: false,
        block: [ROW_OXFORD],
      },
      {
        id: ROW_PRINCETON,
        classId: PRINCETON,
        groupId: null,
        subjectId: MATH,
        teacherId: KARIMOVA,
        roomId: null,
        roomType: null,
        lessonsPerWeek: 3,
        mixedBlock: false,
        doubleLessons: false,
        block: [ROW_PRINCETON],
      },
      {
        id: ROW_GROUP,
        classId: null,
        groupId: GROUP,
        subjectId: ENGLISH,
        teacherId: TOSHEVA,
        roomId: null,
        roomType: null,
        lessonsPerWeek: 2,
        mixedBlock: false,
        doubleLessons: false,
        block: [ROW_GROUP],
      },
    ],
    busyElsewhere: [],
    otherDrafts: [],
    branches: [],
  },
  pins: [],
  locks: [],
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
    /** Task 5.4c-2: the board as the server holds it now, read again before an undo. */
    gridNow?: () => GridAnswer;
    moved?: (body: unknown) => Response;
    placed?: (body: unknown) => Response;
    roomed?: (body: unknown) => Response;
    rearranged?: (body: unknown) => Response;
    removed?: () => Response;
    /** More routes, such as a block placed again under a new id. */
    extra?: Record<string, (body: unknown) => Response>;
    /** The version as the list answers it (task 5.4c-1: its edit lock). */
    version?: TimetableVersion;
    /** "Take over" and "still here" (task 5.4c-1). */
    tookLock?: () => Response;
    /** Step 7's mark of the readiness answer (task 5.4b-2a). */
    gridMark?: { ready: boolean; blocked: number; warnings: number };
    /** Every step 1 to 5 ready. */
    allReady?: boolean;
  } = {},
) {
  const language = options.language ?? 'en';
  const calls = fakeApi({
    'GET /api/auth/session': () => json({ ...(options.session ?? vice()), language }),
    'GET /api/timetable/versions': () =>
      json({ versions: [options.version ?? VERSION], today: '2026-10-10' }),
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
        ...(options.gridMark === undefined ? {} : { grid: options.gridMark }),
        ...(options.allReady === true ? { ready: true } : {}),
        rules: {
          ready: options.allReady === true,
          confirmed: options.allReady === true,
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
    [`GET /api/timetable/versions/${VERSION.id}/grid`]: () =>
      json(options.gridNow?.() ?? options.grid ?? GRID),
    [`POST /api/timetable/versions/${VERSION.id}/pattern/${BLOCK_OXFORD}/move`]: (body) =>
      options.moved?.(body) ?? json(options.grid ?? GRID),
    [`POST /api/timetable/versions/${VERSION.id}/pattern`]: (body) =>
      options.placed?.(body) ?? json(options.grid ?? GRID, 201),
    [`POST /api/timetable/versions/${VERSION.id}/pattern/${BLOCK_OXFORD}/room`]: (body) =>
      options.roomed?.(body) ?? json(options.grid ?? GRID),
    [`POST /api/timetable/versions/${VERSION.id}/pattern/rearrange`]: (body) =>
      options.rearranged?.(body) ?? json(options.grid ?? GRID),
    [`DELETE /api/timetable/versions/${VERSION.id}/pattern/${BLOCK_OXFORD}`]: () =>
      options.removed?.() ?? json(options.grid ?? GRID),
    ...options.extra,
    [`POST /api/timetable/versions/${VERSION.id}/edit-lock`]: () =>
      options.tookLock?.() ?? json(options.version ?? VERSION),
    [`POST /api/timetable/versions/${VERSION.id}/locks`]: () => json(options.grid ?? GRID, 201),
    [`DELETE /api/timetable/versions/${VERSION.id}/locks/${LOCK}`]: () =>
      json(options.grid ?? GRID),
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
    const free = dialog.querySelector<HTMLButtonElement>('[data-move-cell="3:5"] button');
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

const SOUTH = uid(50);
const ELSEWHERE = uid(5000);

/** The grid with Karimova's lesson in the South branch on Wednesday at 08:05–08:45, a 40-minute slot there. */
const WITH_ELSEWHERE: GridAnswer = {
  ...GRID,
  facts: {
    ...GRID.facts,
    busyElsewhere: [
      {
        id: ELSEWHERE,
        teacherId: KARIMOVA,
        branchId: SOUTH,
        weekday: 3,
        start: 485,
        end: 525,
        tutorLesson: false,
      },
    ],
    branches: [{ id: SOUTH, name: 'South branch' }],
  },
};

const chooseView = (view: string) => {
  fireEvent.change(screen.getByLabelText(en.timetable.grid.view), { target: { value: view } });
};

// Task 5.4b-1: 06, Teachers who work in several branches ("Busy elsewhere",
// "Two drafts at once"); edge/timetable, Structure: "Teacher and room views
// use a clock axis".
describe('the views by teacher and room', () => {
  it('shows a teacher’s lessons on a clock axis, with the lesson elsewhere as a grey block that cannot be moved', async () => {
    await openGrid({ grid: WITH_ELSEWHERE });
    chooseView('teacher');
    const board = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(`[data-clock-board="${KARIMOVA}"]`);
      expect(found).not.toBeNull();
      return found;
    });
    if (board === null) throw new Error('No board.');
    // Both of Karimova's classes, none of Tosheva's group.
    expect(board.querySelector(`[data-block="${BLOCK_OXFORD}"]`)).not.toBeNull();
    expect(board.querySelector(`[data-block="${BLOCK_PRINCETON}"]`)).not.toBeNull();
    expect(board.querySelector(`[data-block="${BLOCK_GROUP}"]`)).toBeNull();
    const grey = board.querySelector<HTMLElement>(`[data-busy-elsewhere="${ELSEWHERE}"]`);
    expect(grey?.textContent).toBe('Busy elsewhere: South branch');
    expect(grey?.closest('[data-clock-cell]')?.getAttribute('data-clock-cell')).toBe('3:485-525');
    expect(within(board).queryByRole('button', { name: en.timetable.grid.move })).toBeNull();
    expect(within(board).queryByRole('button', { name: en.timetable.grid.remove })).toBeNull();
    // The clock axis: 08:00–08:45 and 08:05–08:45 overlap and sit by their real times.
    const times = [...board.querySelectorAll('tbody th')].map((one) => one.textContent);
    expect(times.slice(0, 3)).toEqual(['08:00–08:45', '08:05–08:45', '08:50–09:35']);
  });

  it('opens the class board of a lesson from the teacher view', async () => {
    await openGrid();
    chooseView('teacher');
    const board = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-clock-board]');
      expect(found).not.toBeNull();
      return found;
    });
    const princeton = board?.querySelector<HTMLElement>(`[data-block="${BLOCK_PRINCETON}"]`);
    const cell = princeton?.parentElement;
    if (cell === null || cell === undefined) throw new Error('No lesson.');
    fireEvent.click(within(cell).getByRole('button', { name: en.timetable.grid.openClass }));
    await waitFor(() => {
      expect(document.querySelector(`[data-board="${PRINCETON}"]`)).not.toBeNull();
    });
    expect(tile(BLOCK_PRINCETON)).not.toBeNull();
  });

  it('shows the lessons in a room', async () => {
    await openGrid();
    chooseView('room');
    const board = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(`[data-clock-board="${ROOM}"]`);
      expect(found).not.toBeNull();
      return found;
    });
    expect(board?.querySelector(`[data-block="${BLOCK_OXFORD}"]`)).not.toBeNull();
    expect(board?.querySelector(`[data-block="${BLOCK_PRINCETON}"]`)).toBeNull();
  });

  it('names the branch whose draft also plans the teacher on the lesson', async () => {
    await openGrid({
      grid: {
        ...WITH_ELSEWHERE,
        results: [
          {
            rule: 'other_draft',
            severity: 'warning',
            weekday: 1,
            lessonIds: [uid(1000), uid(5001)],
            detail: { branchId: SOUTH },
          },
        ],
      },
    });
    const own = tile(BLOCK_OXFORD);
    expect(own?.querySelector('[data-tile-rules]')?.textContent).toContain(
      en.timetable.rule.other_draft,
    );
    expect(own?.querySelector('[data-other-draft]')?.textContent).toBe(
      'Also planned in a draft of South branch.',
    );
  });
});

describe('the status of a slot while a lesson is moved', () => {
  it('is blocked where the teacher has a lesson in another branch (06, One clash check)', () => {
    const model = patternModel(WITH_ELSEWHERE.facts);
    const board = boardOf(WITH_ELSEWHERE, model, OXFORD);
    const oxford = WITH_ELSEWHERE.blocks[0];
    const wednesday = board.cellAt(3, 1);
    if (oxford === undefined || wednesday === null) throw new Error('No cell.');
    expect(cellStatus(model, board, WITH_ELSEWHERE.blocks, oxford, wednesday)).toMatchObject({
      status: 'blocked',
      rule: 'teacher_double',
    });
  });

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

const ROOM_14 = uid(901);
const ROOM_3 = uid(902);
const NORTH_2 = uid(950);
const BUSY = uid(1100);
const DRAFTED = uid(1101);

/** The grid with three rooms; the English group sits on Monday at 08:00 in Room 14. */
const ROOMS_GRID: GridAnswer = {
  ...GRID,
  rooms: [
    { id: ROOM, name: 'Room 12' },
    { id: ROOM_14, name: 'Room 14' },
    { id: ROOM_3, name: 'Room 3' },
  ],
  blocks: GRID.blocks.map((block) =>
    block.id === BLOCK_GROUP
      ? {
          ...block,
          weekday: 1,
          lessons: block.lessons.map((lesson) => ({ ...lesson, roomId: ROOM_14 })),
        }
      : block,
  ),
  facts: {
    ...GRID.facts,
    rooms: [
      ...GRID.facts.rooms,
      {
        id: ROOM_14,
        type: 'classroom',
        status: 'in_use',
        shared: false,
        lessonsAtOnce: 1,
        capacity: 30,
      },
      {
        id: ROOM_3,
        type: 'classroom',
        status: 'in_use',
        shared: false,
        lessonsAtOnce: 1,
        capacity: 2,
      },
    ],
  },
};

const panel = () => document.querySelector<HTMLElement>('[aria-labelledby="grid-to-place"]');
const conflicts = () => [...document.querySelectorAll<HTMLElement>('[data-conflict]')];

// Task 5.4b-2a: 06, Editing in the grid: "A side panel lists what still has
// to be placed", "The room picker lists only rooms that are free in that slot,
// best fit first", "A conflict panel lists every error and warning in the
// draft, with a button that jumps to the lesson"; step 7, "The conflict panel
// shows no errors".
describe('the panels of the grid', () => {
  it('lists what is left to place by class, and places an entry by keyboard with the slot marks', async () => {
    const calls = await openGrid();
    const list = panel();
    if (list === null) throw new Error('No panel.');
    const oxford = list.querySelector<HTMLElement>(`[data-to-place="${ROW_OXFORD}"]`);
    expect(oxford?.textContent).toContain('Mathematics, 7 Oxford: 1 of 3 lessons placed');
    // The group of two classes is one entry, under its first class.
    expect(list.querySelectorAll(`[data-to-place="${ROW_GROUP}"]`)).toHaveLength(1);
    expect(
      list.querySelector(`[data-to-place-class="${OXFORD}"] [data-to-place="${ROW_GROUP}"]`),
    ).not.toBeNull();
    if (oxford === null) throw new Error('No entry.');
    fireEvent.click(within(oxford).getByRole('button', { name: en.timetable.grid.place }));
    const dialog = await screen.findByRole('dialog');
    // Monday 08:50: Karimova teaches Princeton then.
    const busy = dialog.querySelector<HTMLElement>('[data-move-cell="1:3"]');
    expect(busy?.querySelector('button')?.disabled).toBe(true);
    expect(busy?.querySelector('[data-reason]')?.textContent).toContain(
      en.timetable.rule.teacher_double,
    );
    const free = dialog.querySelector<HTMLButtonElement>('[data-move-cell="3:5"] button');
    if (free === null) throw new Error('No free slot.');
    fireEvent.click(free);
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/pattern'))?.body).toEqual({
        loadRowId: ROW_OXFORD,
        weekday: 3,
        slotPosition: 5,
      });
    });
  });

  it('switches to the board of an entry of another class before placing it', async () => {
    await openGrid();
    const princeton = panel()?.querySelector<HTMLElement>(`[data-to-place="${ROW_PRINCETON}"]`);
    if (princeton === null || princeton === undefined) throw new Error('No entry.');
    fireEvent.click(within(princeton).getByRole('button', { name: en.timetable.grid.place }));
    await screen.findByRole('dialog');
    expect(document.querySelector('[data-board]')?.getAttribute('data-board')).toBe(PRINCETON);
  });

  it('lists a half of a mixed split without a way to place it', async () => {
    await openGrid({
      grid: {
        ...GRID,
        rows: GRID.rows.map((row) => (row.id === ROW_GROUP ? { ...row, mixedBlock: true } : row)),
      },
    });
    const mixed = panel()?.querySelector<HTMLElement>(`[data-to-place="${ROW_GROUP}"]`);
    expect(mixed?.textContent).toContain(en.timetable.grid.mixedLater);
    expect(mixed?.querySelector('button')).toBeNull();
    expect(mixed?.className).not.toContain('cursor-grab');
  });

  it('lists only the rooms free at the lesson’s time, best fit first, and saves the one chosen', async () => {
    const calls = await openGrid({ grid: ROOMS_GRID });
    const own = tile(BLOCK_OXFORD);
    if (own === null) throw new Error('No tile.');
    fireEvent.click(within(own).getByRole('button', { name: /Room of Mathematics/ }));
    const dialog = await screen.findByRole('dialog');
    const offered = [...dialog.querySelectorAll('[data-room-choice]')].map((one) =>
      one.getAttribute('data-room-choice'),
    );
    // Room 14 holds the English group then; the main classroom, then the closest fit.
    expect(offered).toEqual([ROOM, ROOM_3]);
    const small = dialog.querySelector<HTMLButtonElement>(`[data-room-choice="${ROOM_3}"] button`);
    if (small === null) throw new Error('No room.');
    fireEvent.click(small);
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/room'))?.body).toEqual({
        lessonId: uid(1000),
        roomId: ROOM_3,
      });
    });
  });

  it('lists errors before warnings with their numbers, and shows the lesson of each', async () => {
    const grid: GridAnswer = {
      ...GRID,
      facts: {
        ...GRID.facts,
        busyElsewhere: [
          {
            id: BUSY,
            teacherId: KARIMOVA,
            branchId: NORTH_2,
            weekday: 1,
            start: 480,
            end: 525,
            tutorLesson: false,
          },
        ],
        branches: [{ id: NORTH_2, name: 'Riverside' }],
      },
      results: [
        {
          rule: 'load_mismatch',
          severity: 'warning',
          weekday: null,
          lessonIds: [],
          detail: { loadRowId: ROW_PRINCETON, placed: 0, lessonsPerWeek: 3 },
        },
        {
          rule: 'teacher_double',
          severity: 'blocked',
          weekday: 1,
          lessonIds: [uid(1000), BUSY],
        },
      ],
    };
    await openGrid({ grid });
    fireEvent.change(screen.getByLabelText(en.timetable.grid.class), {
      target: { value: PRINCETON },
    });
    const [first, second] = conflicts();
    expect(first?.getAttribute('data-severity')).toBe('blocked');
    expect(first?.textContent).toContain(en.timetable.rule.teacher_double);
    expect(first?.textContent).toContain('Busy in Riverside');
    expect(second?.querySelector('[data-conflict-numbers]')?.textContent).toBe(
      '0 of 3 lessons placed.',
    );
    if (first === undefined || second === undefined) throw new Error('Two results.');
    // The lesson of this branch: its class board, its tile focused.
    expect(within(first).getAllByRole('button', { name: en.timetable.grid.show })).toHaveLength(1);
    fireEvent.click(within(first).getByRole('button', { name: en.timetable.grid.show }));
    await waitFor(() => {
      expect(document.activeElement).toBe(tile(BLOCK_OXFORD));
    });
    expect(tile(BLOCK_OXFORD)?.hasAttribute('data-highlighted')).toBe(true);
    // A row with no lesson placed: its class board and its "To place" entry.
    fireEvent.click(within(second).getByRole('button', { name: en.timetable.grid.show }));
    await waitFor(() => {
      expect(document.querySelector('[data-board]')?.getAttribute('data-board')).toBe(PRINCETON);
    });
    expect(
      panel()
        ?.querySelector(`[data-to-place="${ROW_PRINCETON}"]`)
        ?.hasAttribute('data-highlighted'),
    ).toBe(true);
  });

  it('names a lesson of another branch’s draft by its branch, with no button for a result of other branches only', async () => {
    const grid: GridAnswer = {
      ...GRID,
      facts: {
        ...GRID.facts,
        otherDrafts: [
          {
            id: DRAFTED,
            kind: 'lesson',
            branchId: NORTH_2,
            day: '1',
            start: 480,
            end: 525,
            blockId: DRAFTED,
            doublePairId: null,
            classId: null,
            groupId: null,
            classIds: [],
            studentIds: [],
            exemptStudentIds: [],
            subjectId: null,
            loadRowId: null,
            teacherIds: [KARIMOVA],
            substitute: false,
            roomId: null,
            examRooms: [],
            fixed: false,
          },
        ],
        branches: [{ id: NORTH_2, name: 'Riverside' }],
      },
      results: [{ rule: 'other_draft', severity: 'warning', weekday: 1, lessonIds: [DRAFTED] }],
    };
    await openGrid({ grid });
    const [only] = conflicts();
    expect(only?.textContent).toContain('In a draft of Riverside');
    expect(only?.querySelector('button')).toBeNull();
  });

  it('marks step 7 with its errors and warnings, apart from the gate of generation', async () => {
    await openGrid({ allReady: true, gridMark: { ready: false, blocked: 1, warnings: 2 } });
    await waitFor(() => {
      expect(document.querySelector('[data-step="grid"]')?.textContent).toContain(
        '1 error, 2 warnings',
      );
    });
    expect(screen.getByText(en.timetable.builder.readyForGeneration)).toBeTruthy();
  });

  it('marks step 7 with no errors in Russian', async () => {
    await openGrid({ language: 'ru', gridMark: { ready: true, blocked: 0, warnings: 5 } });
    await waitFor(() => {
      expect(document.querySelector('[data-step="grid"]')?.textContent).toContain(
        `${ru.timetable.builder.gridClean}, 5 предупреждений`,
      );
    });
  });
});

// Task 5.4b-2b: "Suggest a place" (06, Editing in the grid: "shows the best
// free slots, or a swap of two or three lessons that makes room for it").
describe('Suggest a place', () => {
  const model = patternModel(GRID.facts);
  const oxford = GRID.blocks.find((one) => one.id === BLOCK_OXFORD);
  if (oxford === undefined) throw new Error('No Oxford block.');

  it('offers as free only slots the drag marks free or warning (review finding 9)', () => {
    const board = boardOf(GRID, model, OXFORD);
    const { free } = suggestPlaces(model, GRID.blocks, oxford);
    expect(free.length).toBeGreaterThan(0);
    for (const one of free) {
      const to = one.changes[0]?.to;
      const cell = to === undefined ? null : board.cellAt(to.weekday, to.slotPosition);
      if (cell === null) throw new Error('A suggestion off the board.');
      expect(cellStatus(model, board, GRID.blocks, oxford, cell).status).not.toBe('blocked');
    }
  });

  it('lists the free slots of a lesson, never where its teacher or class is busy, and applies one', async () => {
    const calls = await openGrid();
    const own = tile(BLOCK_OXFORD);
    if (own === null) throw new Error('No tile.');
    fireEvent.click(within(own).getByRole('button', { name: en.timetable.grid.suggest }));
    const dialog = await screen.findByRole('dialog');
    const offered = [...dialog.querySelectorAll('[data-suggestion="free"]')].map(
      (one) => one.textContent,
    );
    expect(offered.length).toBeGreaterThan(0);
    // Monday 08:50 Karimova teaches Princeton; Tuesday 08:00 Oxford has English.
    expect(offered.some((text) => text?.includes('Monday, 08:50'))).toBe(false);
    expect(offered.some((text) => text?.includes('Tuesday, 08:00'))).toBe(false);
    const [best] = suggestPlaces(model, GRID.blocks, oxford).free;
    if (best === undefined) throw new Error('No suggestion.');
    const first = dialog.querySelector<HTMLButtonElement>('[data-suggestion="free"] button');
    if (first === null) throw new Error('No button.');
    fireEvent.click(first);
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/rearrange'))?.body).toEqual(
        rearrangeOf(model, best),
      );
    });
    expect(calls.find((call) => call.route.endsWith('/rearrange'))?.body).toEqual({
      changes: [
        {
          blockId: BLOCK_OXFORD,
          weekday: best.changes[0]?.to.weekday,
          slotPosition: best.changes[0]?.to.slotPosition,
        },
      ],
    });
  });

  it('suggests a place for an entry of "To place" and sends its row', async () => {
    const calls = await openGrid();
    const entry = panel()?.querySelector<HTMLElement>(`[data-to-place="${ROW_OXFORD}"]`);
    if (entry === null || entry === undefined) throw new Error('No entry.');
    fireEvent.click(within(entry).getByRole('button', { name: en.timetable.grid.suggest }));
    const dialog = await screen.findByRole('dialog');
    const first = dialog.querySelector<HTMLButtonElement>('[data-suggestion="free"] button');
    if (first === null) throw new Error('No button.');
    fireEvent.click(first);
    const [best] = suggestPlaces(model, GRID.blocks, newBlockOf(model, ROW_OXFORD)).free;
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/rearrange'))?.body).toEqual({
        changes: [
          {
            loadRowId: ROW_OXFORD,
            weekday: best?.changes[0]?.to.weekday,
            slotPosition: best?.changes[0]?.to.slotPosition,
          },
        ],
      });
    });
  });

  // Monday only, two lessons: Karimova teaches Oxford at 08:00, Princeton's
  // English group (Princeton only here) is at 08:50.
  const MONDAY_DAY = { ...DAY, end: 575, slots: DAY.slots.slice(0, 3) };
  const FULL: GridAnswer = {
    ...GRID,
    blocks: [
      { ...oxford },
      {
        ...GRID.blocks[2],
        doublePairId: null,
        id: BLOCK_GROUP,
        weekday: 1,
        slotPosition: 3,
        start: 530,
        end: 575,
        lessons: [{ id: uid(1002), loadRowId: ROW_GROUP, roomId: null }],
      },
    ],
    facts: {
      ...GRID.facts,
      units: GRID.facts.units.map((one) =>
        one.id === GROUP ? { ...one, classIds: [PRINCETON], studentIds: [uid(3003)] } : one,
      ),
      days: GRID.facts.days.map((one) =>
        one.weekday === 1
          ? { ...one, day: { lessons: true as const, day: MONDAY_DAY, noRegularLessons: false } }
          : { ...one, day: { lessons: false as const, reason: 'not_working_day' as const } },
      ),
    },
  };

  it('offers moves of two lessons that make room when no slot is free, and applies one', async () => {
    const calls = await openGrid({ grid: FULL });
    fireEvent.change(screen.getByLabelText(en.timetable.grid.class), {
      target: { value: PRINCETON },
    });
    const entry = panel()?.querySelector<HTMLElement>(`[data-to-place="${ROW_PRINCETON}"]`);
    if (entry === null || entry === undefined) throw new Error('No entry.');
    fireEvent.click(within(entry).getByRole('button', { name: en.timetable.grid.suggest }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('[data-suggestion="free"]')).toBeNull();
    const moves = dialog.querySelectorAll('[data-suggestion="rearrange"]');
    expect(moves.length).toBeGreaterThan(0);
    expect(moves[0]?.textContent).toContain('→');
    const fullModel = patternModel(FULL.facts);
    const [best] = suggestPlaces(
      fullModel,
      FULL.blocks,
      newBlockOf(fullModel, ROW_PRINCETON),
    ).rearrangements;
    if (best === undefined) throw new Error('No rearrangement.');
    expect(best.changes).toHaveLength(2);
    const first = moves[0]?.querySelector('button');
    if (first === null || first === undefined) throw new Error('No button.');
    fireEvent.click(first);
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/rearrange'))?.body).toEqual(
        rearrangeOf(fullModel, best),
      );
    });
  });

  it('says so when nothing makes room, and has no button for the Principal', async () => {
    const stuck: GridAnswer = {
      ...FULL,
      facts: {
        ...FULL.facts,
        // Karimova is away all Monday but 08:00: neither lesson can move.
        teachers: FULL.facts.teachers.map((one) =>
          one.id === KARIMOVA
            ? {
                ...one,
                availability: one.availability.map((entry) => ({
                  ...entry,
                  ranges: [{ weekday: 1, start: 480, end: 525 }],
                })),
              }
            : {
                ...one,
                availability: one.availability.map((entry) => ({
                  ...entry,
                  ranges: [{ weekday: 1, start: 530, end: 575 }],
                })),
              },
        ),
      },
    };
    await openGrid({ grid: stuck });
    fireEvent.change(screen.getByLabelText(en.timetable.grid.class), {
      target: { value: PRINCETON },
    });
    const entry = panel()?.querySelector<HTMLElement>(`[data-to-place="${ROW_PRINCETON}"]`);
    if (entry === null || entry === undefined) throw new Error('No entry.');
    fireEvent.click(within(entry).getByRole('button', { name: en.timetable.grid.suggest }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(en.timetable.grid.nothingFound);
  });

  it('gives the Principal no Suggest button', async () => {
    await openGrid({ session: principal() });
    const own = tile(BLOCK_OXFORD);
    expect(own).not.toBeNull();
    expect(
      within(own as HTMLElement).queryByRole('button', { name: en.timetable.grid.suggest }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: en.timetable.grid.suggest })).toBeNull();
  });
});

// Task 5.4c-1: the edit lock of a draft (06, Editing in the grid: "Several
// people can view a draft; one edits at a time") and the locks of the grid.
describe('the edit lock and the locks', () => {
  const HELD: TimetableVersion = {
    ...VERSION,
    editLock: {
      holder: { id: uid(1901), name: 'Tosheva Malika' },
      seenAt: '2026-10-10T18:50:00Z',
      mine: false,
    },
  };
  const MINE: TimetableVersion = {
    ...VERSION,
    editLock: {
      holder: { id: uid(1902), name: 'Saidova Dilnoza' },
      seenAt: '2026-10-10T18:50:00Z',
      mine: true,
    },
  };
  const lockCalls = (calls: readonly { route: string }[]) =>
    calls.filter((call) => call.route.endsWith('/edit-lock'));

  it('names who edits the draft, leaves the grid read only, and takes over on request', async () => {
    const calls = await openGrid({ version: HELD });
    const banner = document.querySelector<HTMLElement>('[data-edit-lock]');
    if (banner === null) throw new Error('No banner.');
    expect(banner.textContent).toContain('Tosheva Malika');
    const own = tile(BLOCK_OXFORD);
    if (own === null) throw new Error('No tile.');
    expect(within(own).queryByRole('button', { name: en.timetable.grid.move })).toBeNull();
    expect(within(own).queryByRole('button', { name: en.timetable.grid.lock })).toBeNull();
    fireEvent.click(within(banner).getByRole('button', { name: en.timetable.editLock.takeOver }));
    await waitFor(() => {
      expect(lockCalls(calls)).toHaveLength(1);
    });
  });

  it('says why a take over before 5 minutes is refused', async () => {
    await openGrid({ version: HELD, tookLock: () => refusal('draft_edit_locked', 409) });
    const banner = document.querySelector<HTMLElement>('[data-edit-lock]');
    if (banner === null) throw new Error('No banner.');
    fireEvent.click(within(banner).getByRole('button', { name: en.timetable.editLock.takeOver }));
    expect(await screen.findByText(en.errors.draft_edit_locked)).toBeTruthy();
  });

  it('keeps the holder’s lock on a key or a pointer at most once a minute', async () => {
    const calls = await openGrid({ version: MINE });
    expect(document.querySelector('[data-edit-lock]')).toBeNull();
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.pointerDown(window);
    fireEvent.keyDown(window, { key: 'b' });
    await waitFor(() => {
      expect(lockCalls(calls)).toHaveLength(1);
    });
  });

  it('never takes a free lock on a key or a pointer (review correction 1)', async () => {
    const calls = await openGrid();
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.pointerDown(window);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lockCalls(calls)).toHaveLength(0);
  });

  it('locks a lesson from its tile, shows it locked, and unlocks it', async () => {
    const calls = await openGrid();
    const own = tile(BLOCK_OXFORD);
    if (own === null) throw new Error('No tile.');
    fireEvent.click(within(own).getByRole('button', { name: en.timetable.grid.lock }));
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/locks'))?.body).toEqual({
        kind: 'block',
        blockId: BLOCK_OXFORD,
      });
    });
  });

  it('shows a locked lesson with Unlock, lists the lock, and suggests no place for it', async () => {
    const calls = await openGrid({
      grid: { ...GRID, locks: [{ id: LOCK, kind: 'block', blockId: BLOCK_OXFORD }] },
    });
    const own = tile(BLOCK_OXFORD);
    if (own === null) throw new Error('No tile.');
    expect(own.querySelector('[data-tile-locked]')).not.toBeNull();
    expect(document.querySelector(`[data-lock="${LOCK}"]`)?.textContent).toContain('Mathematics');
    fireEvent.click(within(own).getByRole('button', { name: en.timetable.grid.suggest }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('[data-suggest-locked]')).not.toBeNull();
    expect(dialog.querySelector('[data-suggestion]')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.grid.close }));
    fireEvent.click(within(own).getByRole('button', { name: en.timetable.grid.unlock }));
    await waitFor(() => {
      expect(
        calls.some(
          (call) => call.route === `DELETE /api/timetable/versions/${VERSION.id}/locks/${LOCK}`,
        ),
      ).toBe(true);
    });
  });

  it('locks the class shown, a day and a teacher from the panel', async () => {
    const calls = await openGrid();
    const locks = document.querySelector<HTMLElement>('[data-locks]');
    if (locks === null) throw new Error('No panel.');
    const sent = () =>
      calls.filter((call) => call.route.endsWith('/locks')).map((call) => call.body);
    const click = async (name: string, count: number) => {
      await waitFor(() => {
        expect(within(locks).getByRole('button', { name })).toHaveProperty('disabled', false);
      });
      fireEvent.click(within(locks).getByRole('button', { name }));
      await waitFor(() => {
        expect(sent()).toHaveLength(count);
      });
    };
    await click(en.timetable.grid.lockClass, 1);
    fireEvent.change(within(locks).getByLabelText(en.timetable.grid.lockDayLabel), {
      target: { value: '2' },
    });
    await click(en.timetable.grid.lockDay, 2);
    await click(en.timetable.grid.lockTeacher, 3);
    expect(sent()).toEqual([
      { kind: 'class', classId: OXFORD },
      { kind: 'day', weekday: 2 },
      { kind: 'teacher', teacherId: KARIMOVA },
    ]);
  });
});

// Task 5.4c-2 (Done when): 06, Editing in the grid: "Undo and redo". A move, a
// room change, a removal and an applied suggestion are undone and redone, each
// through its route; a step refused by the rules is shown and kept.
describe('undo and redo', () => {
  const PLACED_AGAIN = uid(1500);
  const CREATED = uid(1501);
  const slotTimes = (position: number) => {
    const slot = DAY.slots.find((one) => one.position === position);
    if (slot === undefined) throw new Error('No slot.');
    return { start: slot.start, end: slot.end };
  };
  const at = (body: unknown) => body as { weekday: number; slotPosition: number };
  /** A server that keeps the board each write answers, read again by the undo. */
  const server = (start: GridAnswer) => {
    let board = start;
    return {
      now: () => board,
      answer: (blocks: GridAnswer['blocks'], status = 200) => {
        board = { ...board, blocks };
        return json(board, status);
      },
      blocks: () => board.blocks,
    };
  };
  const movedTo = (blocks: GridAnswer['blocks'], id: string, weekday: number, position: number) =>
    blocks.map((one) =>
      one.id === id
        ? {
            ...one,
            weekday: weekdaySchema.parse(weekday),
            slotPosition: position,
            ...slotTimes(position),
          }
        : one,
    );
  const button = (name: RegExp) => screen.getByRole('button', { name });
  const disabled = (name: string | RegExp) =>
    screen.getByRole<HTMLButtonElement>('button', { name }).disabled;
  const routesOf = <T extends { route: string }>(calls: readonly T[], end: string) =>
    calls.filter((call) => call.route.endsWith(end));
  const moveOxfordTo = async (weekday: number, position: number) => {
    const own = tile(BLOCK_OXFORD);
    if (own === null) throw new Error('No tile.');
    fireEvent.click(within(own).getByRole('button', { name: en.timetable.grid.move }));
    const dialog = await screen.findByRole('dialog');
    const free = dialog.querySelector<HTMLButtonElement>(
      `[data-move-cell="${String(weekday)}:${String(position)}"] button`,
    );
    if (free === null) throw new Error('No free slot.');
    fireEvent.click(free);
  };
  const blocked = () =>
    json(
      {
        error: {
          code: 'pattern_blocked',
          message: 'A blocked rule refuses the lesson at that slot.',
          requestId: uid(4000),
          details: [
            {
              path: '',
              code: 'teacher_double',
              message: 'A blocked rule of the timetable.',
              rule: { weekday: 1, lessonIds: [uid(1000)] },
            },
          ],
        },
      },
      409,
    );

  it('undoes and redoes a move through the move route, naming the step', async () => {
    const s = server(GRID);
    const calls = await openGrid({
      gridNow: s.now,
      moved: (body) =>
        s.answer(movedTo(s.blocks(), BLOCK_OXFORD, at(body).weekday, at(body).slotPosition)),
    });
    expect(disabled(en.timetable.grid.history.undo)).toBe(true);
    await moveOxfordTo(3, 5);
    const named = await screen.findByRole('button', {
      name: 'Undo: moving Mathematics, 7 Oxford',
    });
    fireEvent.click(named);
    await waitFor(() => {
      expect(routesOf(calls, '/move').at(-1)?.body).toEqual({ weekday: 1, slotPosition: 1 });
    });
    fireEvent.click(await screen.findByRole('button', { name: /^Redo: moving Mathematics/ }));
    await waitFor(() => {
      expect(routesOf(calls, '/move')).toHaveLength(3);
    });
    expect(routesOf(calls, '/move').at(-1)?.body).toEqual({ weekday: 3, slotPosition: 5 });
    // Each step read the board again first.
    expect(routesOf(calls, '/grid').length).toBeGreaterThanOrEqual(3);
    await waitFor(() => {
      expect(button(/^Undo: moving/)).not.toBeNull();
    });
  });

  it('undoes and redoes a room change through the room route', async () => {
    const s = server(ROOMS_GRID);
    const calls = await openGrid({
      grid: ROOMS_GRID,
      gridNow: s.now,
      roomed: (body) => {
        const { roomId } = body as { roomId: string | null };
        return s.answer(
          s
            .blocks()
            .map((one) =>
              one.id === BLOCK_OXFORD
                ? { ...one, lessons: one.lessons.map((lesson) => ({ ...lesson, roomId })) }
                : one,
            ),
        );
      },
    });
    const own = tile(BLOCK_OXFORD);
    if (own === null) throw new Error('No tile.');
    fireEvent.click(within(own).getByRole('button', { name: /Room of Mathematics/ }));
    const dialog = await screen.findByRole('dialog');
    const small = dialog.querySelector<HTMLButtonElement>(`[data-room-choice="${ROOM_3}"] button`);
    if (small === null) throw new Error('No room.');
    fireEvent.click(small);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Undo: the room of Mathematics, 7 Oxford' }),
    );
    await waitFor(() => {
      expect(routesOf(calls, '/room').at(-1)?.body).toEqual({ lessonId: uid(1000), roomId: ROOM });
    });
    fireEvent.click(await screen.findByRole('button', { name: /^Redo: the room of/ }));
    await waitFor(() => {
      expect(routesOf(calls, '/room')).toHaveLength(3);
    });
    expect(routesOf(calls, '/room').at(-1)?.body).toEqual({ lessonId: uid(1000), roomId: ROOM_3 });
  });

  it('undoes a removal by placing the block again with its room, and redoes it on the new block', async () => {
    const s = server(GRID);
    const oxford = GRID.blocks.find((one) => one.id === BLOCK_OXFORD);
    if (oxford === undefined) throw new Error('No Oxford block.');
    const calls = await openGrid({
      gridNow: s.now,
      removed: () => s.answer(s.blocks().filter((one) => one.id !== BLOCK_OXFORD)),
      placed: () =>
        s.answer(
          [
            ...s.blocks(),
            {
              ...oxford,
              id: PLACED_AGAIN,
              lessons: [{ id: uid(1600), loadRowId: ROW_OXFORD, roomId: ROOM }],
            },
          ],
          201,
        ),
      extra: {
        [`DELETE /api/timetable/versions/${VERSION.id}/pattern/${PLACED_AGAIN}`]: () =>
          s.answer(s.blocks().filter((one) => one.id !== PLACED_AGAIN)),
      },
    });
    const own = tile(BLOCK_OXFORD);
    if (own === null) throw new Error('No tile.');
    fireEvent.click(within(own).getByRole('button', { name: en.timetable.grid.remove }));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: en.timetable.grid.remove }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Undo: removing Mathematics, 7 Oxford' }),
    );
    await waitFor(() => {
      expect(routesOf(calls, '/pattern').at(-1)?.body).toEqual({
        loadRowId: ROW_OXFORD,
        weekday: 1,
        slotPosition: 1,
        rooms: [{ loadRowId: ROW_OXFORD, roomId: ROOM }],
      });
    });
    fireEvent.click(await screen.findByRole('button', { name: /^Redo: removing/ }));
    await waitFor(() => {
      expect(calls.map((call) => call.route)).toContain(
        `DELETE /api/timetable/versions/${VERSION.id}/pattern/${PLACED_AGAIN}`,
      );
    });
  });

  it('undoes an applied suggestion that created a block as one step, removing it, and redoes it', async () => {
    const s = server(GRID);
    const model = patternModel(GRID.facts);
    const [best] = suggestPlaces(model, GRID.blocks, newBlockOf(model, ROW_OXFORD)).free;
    const to = best?.changes[0]?.to;
    if (to === undefined) throw new Error('No suggestion.');
    const created = {
      ...to,
      weekday: weekdaySchema.parse(to.weekday),
      id: CREATED,
      lessons: to.lessons.map((lesson) => ({ ...lesson, id: uid(1601) })),
    };
    const calls = await openGrid({
      gridNow: s.now,
      rearranged: (body) => {
        const record = body as { remove?: string[] };
        return record.remove === undefined
          ? s.answer([...s.blocks(), created])
          : s.answer(s.blocks().filter((one) => !record.remove?.includes(one.id)));
      },
    });
    const entry = panel()?.querySelector<HTMLElement>(`[data-to-place="${ROW_OXFORD}"]`);
    if (entry === null || entry === undefined) throw new Error('No entry.');
    fireEvent.click(within(entry).getByRole('button', { name: en.timetable.grid.suggest }));
    const dialog = await screen.findByRole('dialog');
    const first = dialog.querySelector<HTMLButtonElement>('[data-suggestion="free"] button');
    if (first === null) throw new Error('No button.');
    fireEvent.click(first);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Undo: the suggestion for Mathematics, 7 Oxford',
      }),
    );
    await waitFor(() => {
      expect(routesOf(calls, '/rearrange')).toHaveLength(2);
    });
    expect(routesOf(calls, '/rearrange').at(-1)?.body).toEqual({ changes: [], remove: [CREATED] });
    fireEvent.click(await screen.findByRole('button', { name: /^Redo: the suggestion/ }));
    await waitFor(() => {
      expect(routesOf(calls, '/rearrange')).toHaveLength(3);
    });
    expect(routesOf(calls, '/rearrange').at(-1)?.body).toEqual({
      changes: [
        {
          loadRowId: ROW_OXFORD,
          weekday: to.weekday,
          slotPosition: to.slotPosition,
          rooms: to.lessons.map((lesson) => ({
            loadRowId: lesson.loadRowId,
            roomId: lesson.roomId,
          })),
        },
      ],
    });
  });

  it('shows an undo the rules refuse and keeps the step', async () => {
    const s = server(GRID);
    let writes = 0;
    await openGrid({
      gridNow: s.now,
      moved: (body) => {
        writes += 1;
        return writes === 1
          ? s.answer(movedTo(s.blocks(), BLOCK_OXFORD, at(body).weekday, at(body).slotPosition))
          : blocked();
      },
    });
    await moveOxfordTo(3, 5);
    fireEvent.click(await screen.findByRole('button', { name: /^Undo: moving/ }));
    const alert = await screen.findByText((text) =>
      text.includes(en.timetable.rule.teacher_double),
    );
    expect(alert.textContent).toContain(en.errors.pattern_blocked);
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: /^Undo: moving/ }).disabled,
      ).toBe(false);
    });
    expect(disabled(en.timetable.grid.history.redo)).toBe(true);
  });

  it('drops a step whose lesson changed since, sending nothing (decision 3)', async () => {
    const s = server(GRID);
    let elsewhere = false;
    const calls = await openGrid({
      gridNow: () =>
        elsewhere ? { ...s.now(), blocks: movedTo(s.blocks(), BLOCK_OXFORD, 4, 1) } : s.now(),
      moved: (body) =>
        s.answer(movedTo(s.blocks(), BLOCK_OXFORD, at(body).weekday, at(body).slotPosition)),
    });
    await moveOxfordTo(3, 5);
    const undo = await screen.findByRole('button', { name: /^Undo: moving/ });
    elsewhere = true;
    fireEvent.click(undo);
    expect(await screen.findByText(en.timetable.grid.history.changedSince)).not.toBeNull();
    expect(routesOf(calls, '/move')).toHaveLength(1);
    expect(disabled(en.timetable.grid.history.undo)).toBe(true);
  });

  it('clears the history when the draft is another account’s (decision 6)', async () => {
    const s = server(GRID);
    let writes = 0;
    await openGrid({
      gridNow: s.now,
      moved: (body) => {
        writes += 1;
        return writes === 1
          ? s.answer(movedTo(s.blocks(), BLOCK_OXFORD, at(body).weekday, at(body).slotPosition))
          : json(
              {
                error: {
                  code: 'draft_edit_locked',
                  message: 'Another account edits the draft.',
                  requestId: uid(4001),
                },
              },
              409,
            );
      },
    });
    await moveOxfordTo(3, 5);
    fireEvent.click(await screen.findByRole('button', { name: /^Undo: moving/ }));
    await waitFor(() => {
      expect(disabled(en.timetable.grid.history.undo)).toBe(true);
    });
  });

  it('undoes by Ctrl+Z and redoes by Ctrl+Y, and keeps the history over a visit to step 2', async () => {
    const s = server(GRID);
    const calls = await openGrid({
      gridNow: s.now,
      moved: (body) =>
        s.answer(movedTo(s.blocks(), BLOCK_OXFORD, at(body).weekday, at(body).slotPosition)),
    });
    await moveOxfordTo(3, 5);
    await screen.findByRole('button', { name: /^Undo: moving/ });
    const step = (name: string) =>
      document.querySelector<HTMLElement>(`[data-step="${name}"] button`);
    fireEvent.click(step('load') ?? document.body);
    await waitFor(() => {
      expect(document.querySelector('[data-board]')).toBeNull();
    });
    fireEvent.click(step('grid') ?? document.body);
    await screen.findByRole('button', { name: /^Undo: moving/ });
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      expect(routesOf(calls, '/move')).toHaveLength(2);
    });
    await screen.findByRole('button', { name: /^Redo: moving/ });
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    await waitFor(() => {
      expect(routesOf(calls, '/move')).toHaveLength(3);
    });
    expect(routesOf(calls, '/move').at(-1)?.body).toEqual({ weekday: 3, slotPosition: 5 });
  });

  it('speaks Russian and Uzbek', () => {
    expect(ru.timetable.grid.history.undo).not.toBe(en.timetable.grid.history.undo);
    expect(uz.timetable.grid.history.changedSince).toContain('oʻ');
  });
});

// Task 5.4c-3a: double lessons (edge/timetable, Structure: "Two linked lessons
// in consecutive lesson slots with the same teacher and room. They are moved,
// cancelled and substituted together").
describe('double lessons', () => {
  const SECOND_HALF = uid(810);
  const PAIR = uid(811);
  /** Oxford's mathematics allows doubles. */
  const ALLOWED: GridAnswer = {
    ...GRID,
    facts: {
      ...GRID.facts,
      rows: GRID.facts.rows.map((one) =>
        one.id === ROW_OXFORD ? { ...one, doubleLessons: true } : one,
      ),
    },
  };
  /** Oxford's mathematics as a double on Wednesday 08:00 and 08:50. */
  const PAIRED: GridAnswer = {
    ...ALLOWED,
    blocks: [
      {
        id: BLOCK_OXFORD,
        weekday: 3,
        slotPosition: 1,
        start: 480,
        end: 525,
        lessons: [{ id: uid(1000), loadRowId: ROW_OXFORD, roomId: ROOM }],
        doublePairId: PAIR,
      },
      {
        id: SECOND_HALF,
        weekday: 3,
        slotPosition: 3,
        start: 530,
        end: 575,
        lessons: [{ id: uid(1010), loadRowId: ROW_OXFORD, roomId: ROOM }],
        doublePairId: PAIR,
      },
      ...GRID.blocks.slice(1),
    ],
  };

  it('marks both halves on the board', async () => {
    await openGrid({ grid: PAIRED });
    expect(tile(BLOCK_OXFORD)?.querySelector('[data-tile-double]')?.textContent).toBe(
      en.timetable.grid.double,
    );
    expect(tile(SECOND_HALF)?.querySelector('[data-tile-double]')).not.toBeNull();
  });

  it('places an entry of "To place" as a double, the last slot of a day marked as having no place', async () => {
    const calls = await openGrid({ grid: ALLOWED });
    const entry = panel()?.querySelector<HTMLElement>(`[data-to-place="${ROW_OXFORD}"]`);
    if (entry === null || entry === undefined) throw new Error('No entry.');
    // Princeton's row does not allow doubles: no switch there.
    const princeton = panel()?.querySelector<HTMLElement>(`[data-to-place="${ROW_PRINCETON}"]`);
    expect(
      princeton === null || princeton === undefined
        ? null
        : within(princeton).queryByRole('checkbox'),
    ).toBeNull();
    fireEvent.click(within(entry).getByRole('checkbox', { name: en.timetable.grid.placeDouble }));
    fireEvent.click(within(entry).getByRole('button', { name: en.timetable.grid.place }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector<HTMLButtonElement>('[data-move-cell="3:5"] button')?.disabled).toBe(
      true,
    );
    const free = dialog.querySelector<HTMLButtonElement>('[data-move-cell="3:1"] button');
    if (free === null) throw new Error('No free slot.');
    fireEvent.click(free);
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/pattern'))?.body).toEqual({
        loadRowId: ROW_OXFORD,
        weekday: 3,
        slotPosition: 1,
        double: true,
      });
    });
  });

  it('moves a double by its second half, the first half going before it', async () => {
    const calls = await openGrid({
      grid: PAIRED,
      extra: {
        [`POST /api/timetable/versions/${VERSION.id}/pattern/${SECOND_HALF}/move`]: () =>
          json(PAIRED),
      },
    });
    const own = tile(SECOND_HALF);
    if (own === null) throw new Error('No tile.');
    fireEvent.click(within(own).getByRole('button', { name: en.timetable.grid.move }));
    const dialog = await screen.findByRole('dialog');
    // The first lesson slot has no slot before it for the first half.
    expect(dialog.querySelector<HTMLButtonElement>('[data-move-cell="4:1"] button')?.disabled).toBe(
      true,
    );
    const free = dialog.querySelector<HTMLButtonElement>('[data-move-cell="4:5"] button');
    if (free === null) throw new Error('No free slot.');
    fireEvent.click(free);
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith(`${SECOND_HALF}/move`))?.body).toEqual({
        weekday: 4,
        slotPosition: 5,
      });
    });
  });

  it('marks blocked a swap that would take one half away', () => {
    const model = patternModel(PAIRED.facts);
    const board = boardOf(PAIRED, model, OXFORD);
    const group = PAIRED.blocks.find((one) => one.id === BLOCK_GROUP);
    const half = board.cellAt(3, 3);
    if (group === undefined || half === null) throw new Error('No cell.');
    expect(cellStatus(model, board, PAIRED.blocks, group, half)).toMatchObject({
      status: 'blocked',
      rule: 'double_apart',
      drop: { kind: 'swap' },
    });
  });

  it('says that a room change takes both halves', async () => {
    await openGrid({ grid: PAIRED });
    const own = tile(BLOCK_OXFORD);
    if (own === null) throw new Error('No tile.');
    fireEvent.click(within(own).getByRole('button', { name: /Room of Mathematics/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(en.timetable.grid.roomBothHalves);
  });

  it('suggests free slots only for a double and applies one by the move route', async () => {
    const calls = await openGrid({ grid: PAIRED });
    const own = tile(BLOCK_OXFORD);
    if (own === null) throw new Error('No tile.');
    fireEvent.click(within(own).getByRole('button', { name: en.timetable.grid.suggest }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(en.timetable.grid.freeSlotsOnly);
    expect(dialog.querySelector('[data-suggestion="rearrangement"]')).toBeNull();
    const first = dialog.querySelector<HTMLButtonElement>('[data-suggestion="free"] button');
    if (first === null) throw new Error('No suggestion.');
    fireEvent.click(first);
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith(`${BLOCK_OXFORD}/move`))).toBeDefined();
    });
    expect(calls.find((call) => call.route.endsWith('/rearrange'))).toBeUndefined();
  });
});
