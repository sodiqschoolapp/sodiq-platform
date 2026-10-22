import type {
  AcademicYear,
  GridAnswer,
  LoadRow,
  TimetableHistory,
  TimetableVersion,
  VersionComparison,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// All names are invented. Task 5.8a, pull request #194: docs/spec/06-timetable.md,
// Protection: "Version history shows every version in the order of their
// start dates, names the version in force on the first day of each quarter,
// compares two versions, and can reopen an old one as a new draft".
const texts = en.timetable.history;
const PATH = '/timetable/versions';

const YEAR: AcademicYear = {
  id: uid(1),
  name: '2026–2027',
  startDate: '2026-09-01',
  endDate: '2027-05-31',
  status: 'current',
  quarters: [
    { number: 1, startDate: '2026-09-01', endDate: '2026-10-31' },
    { number: 2, startDate: '2026-11-09', endDate: '2026-12-28' },
    { number: 3, startDate: '2027-01-11', endDate: '2027-03-20' },
    { number: 4, startDate: '2027-03-30', endDate: '2027-05-31' },
  ],
};

const version = (n: number, fields: Partial<TimetableVersion> = {}): TimetableVersion => ({
  id: uid(500 + n),
  academicYearId: YEAR.id,
  yearName: YEAR.name,
  yearStatus: 'current',
  number: n,
  status: 'published',
  startsOn: '2026-09-01',
  fromVersion: null,
  rows: 1,
  leftRows: 0,
  leftBlocks: 0,
  outOfDate: false,
  editLock: null,
  ...fields,
});

const V1 = version(1);
const V2 = version(2, { startsOn: '2026-11-16', fromVersion: { id: V1.id, number: 1 } });
const V3 = version(3, {
  status: 'draft',
  startsOn: '2027-01-11',
  fromVersion: { id: V2.id, number: 2 },
});

const HISTORY: TimetableHistory = {
  versions: [V1, V2, V3],
  quarters: [
    { number: 1, startsOn: '2026-09-01', version: { id: V1.id, number: 1 } },
    { number: 2, startsOn: '2026-11-09', version: { id: V1.id, number: 1 } },
    { number: 3, startsOn: '2027-01-11', version: { id: V2.id, number: 2 } },
    { number: 4, startsOn: '2027-03-30', version: { id: V2.id, number: 2 } },
  ],
  today: '2026-10-10',
};

const OXFORD = uid(100);
const MATHS = uid(200);
const row = (n: number, teacher: { id: string; name: string }): LoadRow => ({
  id: uid(700 + n),
  unit: { kind: 'class', id: OXFORD, name: 'Oxford', grades: [7], language: 'uz', archived: false },
  subject: { id: MATHS, names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' } },
  teacher: { id: teacher.id, kind: 'person', name: teacher.name },
  lessonsPerWeek: 2,
  room: null,
  roomType: null,
  doubleLessons: false,
  mixedBlock: false,
  shortReason: null,
  block: [],
  unplaced: 0,
  problems: [],
});
const KARIMOVA = { id: uid(300), name: 'Karimova Aziza' };
const TOSHEV = { id: uid(301), name: 'Toshev Bekzod' };
const ROOM = { id: uid(400), name: 'Room 12' };

const COMPARISON: VersionComparison = {
  before: V1,
  after: V2,
  rows: [row(1, KARIMOVA), row(2, TOSHEV)],
  rooms: [ROOM],
  differences: [
    {
      kind: 'teacher',
      classId: OXFORD,
      groupId: null,
      subjectId: MATHS,
      before: KARIMOVA.id,
      after: TOSHEV.id,
      tutorRow: false,
    },
    {
      kind: 'placement_time',
      classId: OXFORD,
      groupId: null,
      subjectId: MATHS,
      weekday: 1,
      slotPosition: 3,
      before: { start: 535, end: 580 },
      after: { start: 540, end: 585 },
    },
    {
      kind: 'entry_room',
      classId: OXFORD,
      groupId: null,
      subjectId: MATHS,
      weekday: 2,
      slotPosition: 1,
      before: null,
      after: ROOM.id,
    },
  ],
};

const vice = () =>
  sessionOf({
    assignments: [{ role: 'academic_vice_principal', branchId: NORTH.id }],
    branches: [NORTH],
  });
const principal = () =>
  sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }], branches: [NORTH] });

/** The board of the draft V3, with what the print offers: a class, a teacher and a room. */
const GRID: GridAnswer = {
  version: V3,
  editable: true,
  classes: [{ id: OXFORD, name: 'Oxford', grade: 7 }],
  rows: [
    {
      id: uid(701),
      unit: {
        kind: 'class',
        id: OXFORD,
        name: 'Oxford',
        grades: [7],
        language: 'uz',
        archived: false,
      },
      subject: {
        id: MATHS,
        names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
        colour: 'blue',
      },
      teacher: { id: KARIMOVA.id, kind: 'person', name: KARIMOVA.name },
      lessonsPerWeek: 2,
      mixedBlock: false,
    },
  ],
  rooms: [ROOM],
  blocks: [],
  facts: {
    branchId: NORTH.id,
    startDate: '2027-01-11',
    versionEnd: '2027-05-31',
    teachers: [],
    subjects: [],
    rooms: [],
    units: [],
    classStudents: [],
    days: [],
    year: { firstDate: '2026-09-01', lastDate: '2027-05-31', quarters: [] },
    travel: [],
    classDailyLessons: null,
    rows: [],
    busyElsewhere: [],
    otherDrafts: [],
    branches: [],
  },
  pins: [],
  locks: [],
  results: [],
  left: { blocks: [], rows: [] },
};

const pdfAnswer = () =>
  new Response(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="version-3-school.pdf"; filename*=UTF-8''version-3-school.pdf`,
    },
  });

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')]
    .filter((one) => one.closest('[role="complementary"]') === null)
    .map((one) => [...one.querySelectorAll('td')].map((cell) => cell.textContent ?? ''));

async function openList(
  input: {
    session?: ReturnType<typeof sessionOf>;
    history?: TimetableHistory;
    comparison?: VersionComparison;
    exportAnswer?: () => Response;
  } = {},
) {
  const made: TimetableVersion[] = [];
  const calls = fakeApi({
    'GET /api/auth/session': () => json({ ...(input.session ?? vice()), language: 'en' }),
    'GET /api/setup/academic-years': () => json({ years: [YEAR] }),
    'GET /api/timetable/history': () => json(input.history ?? HISTORY),
    [`GET /api/timetable/versions/${V1.id}/compare`]: () => json(input.comparison ?? COMPARISON),
    'GET /api/timetable/versions': () =>
      json({ versions: [V1, V2, V3, ...made], today: '2026-10-10' }),
    [`GET /api/timetable/versions/${V3.id}/grid`]: () => json(GRID),
    [`POST /api/timetable/versions/${V3.id}/export`]: () => (input.exportAnswer ?? pdfAnswer)(),
    'POST /api/timetable/versions': (body) => {
      const { startsOn } = body as { startsOn: string };
      const draft = version(4, {
        status: 'draft',
        startsOn,
        fromVersion: { id: V1.id, number: 1 },
      });
      made.push(draft);
      return json(draft, 201);
    },
  });
  renderApp(PATH, 'en');
  await screen.findByRole('heading', { name: texts.title });
  return calls;
}

const openPanel = async (name: string) => {
  fireEvent.click(await screen.findByText(name, { selector: 'button' }));
  return screen.findByRole('complementary', { name });
};

describe('the version history page', () => {
  it('lists the versions by start date with the quarters each is in force on', async () => {
    const calls = await openList();
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(3);
    });
    expect(rowsDrawn()).toEqual([
      [
        'Version 1',
        '1 September 2026',
        en.timetable.load.statuses.published,
        '—',
        'the first days of quarters 1, 2',
      ],
      [
        'Version 2',
        '16 November 2026',
        en.timetable.load.statuses.published,
        'Version 1',
        'the first days of quarters 3, 4',
      ],
      ['Version 3', '11 January 2027', en.timetable.load.statuses.draft, 'Version 2', ''],
    ]);
    expect(calls.find((one) => one.route === 'GET /api/timetable/history')?.query).toBe(
      `?academicYearId=${YEAR.id}`,
    );
  });

  it('compares the version opened with another, naming each by its part in the change', async () => {
    const calls = await openList();
    const panel = await openPanel('Version 2');
    fireEvent.change(within(panel).getByLabelText(texts.compareWith), {
      target: { value: V1.id },
    });
    await waitFor(() => {
      expect(panel.querySelectorAll('[data-difference]')).toHaveLength(3);
    });
    expect(panel.querySelector('[data-comparison-of]')?.textContent).toBe(
      'Changes from Version 1 to Version 2',
    );
    expect([...panel.querySelectorAll('[data-difference]')].map((one) => one.textContent)).toEqual([
      'Teacher: Karimova Aziza → Toshev Bekzod',
      'Time of the lesson on Monday, slot 3: 08:55–09:40 → 09:00–09:45',
      'Room of the lesson on Tuesday, slot 1: no room → Room 12',
    ]);
    expect(within(panel).getByRole('heading', { name: '7 Oxford, Mathematics' })).toBeTruthy();
    expect(
      calls.find((one) => one.route === `GET /api/timetable/versions/${V1.id}/compare`)?.query,
    ).toBe(`?with=${V2.id}`);
  });

  it('draws every kind of difference', async () => {
    const unit = { classId: OXFORD, groupId: null, subjectId: MATHS };
    await openList({
      comparison: {
        ...COMPARISON,
        differences: [
          { kind: 'row_added', ...unit, teacherId: TOSHEV.id, lessonsPerWeek: 2 },
          { kind: 'row_removed', ...unit, teacherId: KARIMOVA.id, lessonsPerWeek: 1 },
          { kind: 'row_room', ...unit, before: null, after: ROOM.id },
          { kind: 'row_field', ...unit, field: 'roomType', before: null, after: 'laboratory' },
          { kind: 'row_field', ...unit, field: 'doubleLessons', before: false, after: true },
          { kind: 'row_field', ...unit, field: 'lessonsPerWeek', before: 2, after: 3 },
          { kind: 'placement_added', ...unit, weekday: 3, slotPosition: 5, roomId: null },
          { kind: 'placement_removed', ...unit, weekday: 4, slotPosition: 1, roomId: ROOM.id },
          {
            kind: 'placement_double',
            ...unit,
            weekday: 5,
            slotPosition: 1,
            before: false,
            after: true,
          },
          {
            kind: 'placement_double',
            ...unit,
            weekday: 5,
            slotPosition: 3,
            before: true,
            after: false,
          },
        ],
      },
    });
    const panel = await openPanel('Version 2');
    fireEvent.change(within(panel).getByLabelText(texts.compareWith), {
      target: { value: V1.id },
    });
    await waitFor(() => {
      expect(panel.querySelectorAll('[data-difference]')).toHaveLength(10);
    });
    expect([...panel.querySelectorAll('[data-difference]')].map((one) => one.textContent)).toEqual([
      'Added: Toshev Bekzod, 2 lessons a week',
      'Removed: Karimova Aziza, 1 lesson a week',
      'Room: no room → Room 12',
      'Room type: — → Laboratory',
      'Double lessons: no → yes',
      'Lessons per week: 2 → 3',
      'Lesson added: Wednesday, slot 5, no room',
      'Lesson removed: Thursday, slot 1, Room 12',
      'The lesson on Friday, slot 1 became part of a double lesson',
      'The lesson on Friday, slot 3 is no longer part of a double lesson',
    ]);
  });

  it('compares only once a second version is chosen', async () => {
    const calls = await openList();
    const panel = await openPanel('Version 2');
    expect(within(panel).getByLabelText<HTMLSelectElement>(texts.compareWith).value).toBe('');
    expect(calls.some((one) => one.route.endsWith('/compare'))).toBe(false);
    expect(panel.querySelector('[data-comparison-of]')).toBeNull();
  });

  it('says when the year has no other version to compare with', async () => {
    await openList({ history: { ...HISTORY, versions: [V1] } });
    const panel = await openPanel('Version 1');
    expect(within(panel).getByText(texts.nothingToCompare)).toBeTruthy();
    expect(within(panel).queryByLabelText(texts.compareWith)).toBeNull();
  });

  it('says when two versions have no differences', async () => {
    await openList({ comparison: { ...COMPARISON, differences: [] } });
    const panel = await openPanel('Version 2');
    fireEvent.change(within(panel).getByLabelText(texts.compareWith), {
      target: { value: V1.id },
    });
    await waitFor(() => {
      expect(panel.querySelector('[data-no-differences]')?.textContent).toBe(texts.noDifferences);
    });
  });

  it('restores a version as a new draft that copies it, then opens the builder on it', async () => {
    const calls = await openList();
    const panel = await openPanel('Version 1');
    fireEvent.click(within(panel).getByRole('button', { name: texts.restore }));
    fireEvent.change(within(panel).getByLabelText(en.timetable.load.startsOn), {
      target: { value: '2027-01-11' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.some((one) => one.route === 'POST /api/timetable/versions')).toBe(true);
    });
    expect(calls.find((one) => one.route === 'POST /api/timetable/versions')?.body).toEqual({
      academicYearId: YEAR.id,
      startsOn: '2027-01-11',
      copyFrom: V1.id,
    });
    // The builder opens on the new draft.
    await screen.findByRole('heading', { name: en.timetable.builder.title });
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>(en.timetable.load.version).value).toBe(
        uid(504),
      );
    });
  });

  it('gives the Principal the comparison and no restore', async () => {
    await openList({ session: principal() });
    const panel = await openPanel('Version 1');
    expect(within(panel).getByLabelText(texts.compareWith)).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: texts.restore })).toBeNull();
  });

  it('shows the empty state of a year with no versions', async () => {
    await openList({ history: { ...HISTORY, versions: [], quarters: [] } });
    expect(await screen.findByText(texts.emptyTitle)).toBeTruthy();
  });
});

// Task 5.9c-2, pull request #200: Print, PDF and Excel of a version's weekly
// pattern (06, step 8 "Print and export"; edge/timetable, "The wall
// timetable is out of date"), for the roles with timetable export.
describe('the print of a version', () => {
  const sent = (calls: { route: string; body: unknown }[]) =>
    calls
      .filter((one) => one.route === `POST /api/timetable/versions/${V3.id}/export`)
      .map((one) => one.body);

  it('offers the school, the classes, teachers and rooms of the version, and sends each with its own id', async () => {
    const saved: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
    });
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:file');
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    try {
      const calls = await openList();
      const panel = await openPanel('Version 3');
      const select = await within(panel).findByLabelText(texts.printWhat);
      expect([...select.querySelectorAll('option')].map((one) => one.textContent)).toEqual([
        'The whole school',
        'Class 7 Oxford',
        'Teacher Karimova Aziza',
        'Room Room 12',
      ]);
      within(panel).getByRole('button', { name: en.timetable.views.pdf }).click();
      await waitFor(() => {
        expect(saved).toEqual(['version-3-school.pdf']);
      });
      for (const [value, body] of [
        [`class:${OXFORD}`, { kind: 'class', classId: OXFORD, format: 'xlsx' }],
        [`teacher:${KARIMOVA.id}`, { kind: 'teacher', staffId: KARIMOVA.id, format: 'xlsx' }],
        [`room:${ROOM.id}`, { kind: 'room', roomId: ROOM.id, format: 'xlsx' }],
      ] as const) {
        fireEvent.change(select, { target: { value } });
        const before = sent(calls).length;
        within(panel).getByRole('button', { name: en.timetable.views.excel }).click();
        await waitFor(() => {
          expect(sent(calls)).toHaveLength(before + 1);
        });
        expect(sent(calls).at(-1)).toEqual(body);
      }
      expect(sent(calls)[0]).toEqual({ kind: 'branch', format: 'pdf' });
    } finally {
      click.mockRestore();
      created.mockRestore();
      revoked.mockRestore();
    }
  });

  it('shows a refusal under the buttons', async () => {
    await openList({ exportAnswer: () => refusal('pdf_unavailable', 503) });
    const panel = await openPanel('Version 3');
    (await within(panel).findByRole('button', { name: en.timetable.views.pdf })).click();
    expect(await within(panel).findByText(en.errors.pdf_unavailable)).toBeTruthy();
  });

  it('is shown to the Principal, who may print a draft (decision 1)', async () => {
    await openList({ session: principal() });
    const panel = await openPanel('Version 3');
    expect(await within(panel).findByLabelText(texts.printWhat)).toBeTruthy();
  });
});
