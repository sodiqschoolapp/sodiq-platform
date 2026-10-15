import type {
  AcademicYear,
  Load,
  LoadRow,
  LoadTeachers,
  Room,
  SchoolClass,
  Subject,
  TimetableVersion,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';
import { setWindowWidth } from '@/testing/window-width';

const PATH = '/timetable/load';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const YEAR: AcademicYear = {
  id: uid(1),
  name: '2026–2027',
  startDate: '2026-09-01',
  endDate: '2027-05-31',
  status: 'current',
  quarters: [],
};

// All names are invented.
const OXFORD: SchoolClass = {
  id: uid(101),
  academicYearId: YEAR.id,
  yearName: YEAR.name,
  yearStatus: 'current',
  grade: 7,
  name: 'Oxford',
  language: 'uz',
  mainRoom: null,
  maxSize: 25,
  students: 0,
  tutor: null,
  acting: null,
  archived: false,
  version: 0,
};

const subject = (n: number, fields: Partial<Subject> = {}): Subject => ({
  id: uid(200 + n),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  departmentId: uid(9),
  grades: [7, 8],
  colour: 'blue',
  journalType: 'graded',
  ratingExam: false,
  groupSubject: false,
  languageRule: true,
  demanding: false,
  archivedAt: null,
  daily: { attendance: 10, classwork: 50, homework: 40 },
  quarterWeightsMissing: 0,
  quarterCount: 4,
  ...fields,
});

const MATHS = subject(1);
const SPIRITUAL = subject(2, {
  names: { uz: 'Maʼnaviyat soati', ru: 'Час духовности', en: 'Spiritual hour' },
  grades: [5, 6, 7, 8, 9, 10, 11],
});

const LAB: Room = {
  id: uid(400),
  name: 'Lab 1',
  floorId: uid(401),
  floorName: 'First',
  buildingId: uid(402),
  buildingName: 'Main',
  type: 'laboratory',
  capacity: 30,
  status: 'in_use',
  shared: false,
  maxSimultaneousLessons: null,
};

const version = (n: number, fields: Partial<TimetableVersion> = {}): TimetableVersion => ({
  id: uid(500 + n),
  academicYearId: YEAR.id,
  yearName: YEAR.name,
  yearStatus: 'current',
  number: n,
  status: 'draft',
  startsOn: '2026-10-19',
  fromVersion: null,
  rows: 0,
  leftRows: 0,
  ...fields,
});

const TEACHER = { id: uid(600), kind: 'person' as const, name: 'Karimova Aziza' };
const TUTOR = { id: uid(601), kind: 'person' as const, name: 'Nazarova Lola' };

const row = (n: number, fields: Partial<LoadRow> = {}): LoadRow => ({
  id: uid(700 + n),
  unit: {
    kind: 'class',
    id: OXFORD.id,
    name: 'Oxford',
    grades: [7],
    language: 'uz',
    archived: false,
  },
  subject: { id: MATHS.id, names: MATHS.names },
  teacher: TEACHER,
  lessonsPerWeek: 4,
  room: null,
  roomType: null,
  doubleLessons: false,
  problems: [],
  ...fields,
});

const vice = () =>
  sessionOf({
    assignments: [{ role: 'academic_vice_principal', branchId: NORTH.id }],
    branches: [NORTH],
  });

const principal = () =>
  sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }], branches: [NORTH] });

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((one) =>
    [...one.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

const type = (input: HTMLElement, value: string): void => {
  fireEvent.change(input, { target: { value } });
};

async function openPage(
  options: {
    session?: ReturnType<typeof sessionOf>;
    versions?: TimetableVersion[];
    load?: Partial<Load>;
    teachers?: (query: string) => LoadTeachers;
    extra?: Record<string, (body: unknown) => Response>;
    language?: 'en' | 'ru';
  } = {},
) {
  const session = { ...(options.session ?? vice()), language: options.language ?? 'en' };
  const versions = options.versions ?? [version(1)];
  const calls = fakeApi({
    'GET /api/auth/session': () => json(session),
    'GET /api/timetable/versions': () => json({ versions, today: '2026-10-10' }),
    ...Object.fromEntries(
      versions.map((one) => [
        `GET /api/timetable/versions/${one.id}/load`,
        () => json({ version: one, rows: [], leftRows: [], ...options.load }),
      ]),
    ),
    'GET /api/classes': () => json({ classes: [OXFORD] }),
    'GET /api/groups': () => json({ groups: [] }),
    'GET /api/setup/academic-years': () => json({ years: [YEAR] }),
    'GET /api/setup/subjects': () =>
      json({ subjects: [MATHS, SPIRITUAL], mayMoveDepartment: false }),
    'GET /api/setup/rooms': () => json({ rooms: [LAB] }),
    ...Object.fromEntries(
      versions.map((one) => [
        `GET /api/timetable/versions/${one.id}/load/teachers`,
        () => json(options.teachers?.('') ?? { teachers: [], defaultTeacherId: null }),
      ]),
    ),
    ...options.extra,
  });
  renderApp(PATH, options.language ?? 'en');
  await screen.findByRole('heading', {
    name: options.language === 'ru' ? ru.timetable.load.title : en.timetable.load.title,
  });
  return calls;
}

async function openNewRow() {
  await waitFor(() => {
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: en.timetable.load.add }).disabled,
    ).toBe(false);
  });
  fireEvent.click(screen.getByRole('button', { name: en.timetable.load.add }));
  return within(
    await screen.findByRole('complementary', { name: en.timetable.load.newRow }),
  ).getByRole('form', { name: en.timetable.load.newRow });
}

// docs/spec/05-classes-groups-subjects.md, Teaching load; 06-timetable.md,
// Building a timetable; edge-cases/timetable.md, Versions and drafts; task
// 3.4a, pull request #99.
describe('the teaching load page', () => {
  it('lists the rows of the version with the problems each has today (decision 3)', async () => {
    setWindowWidth(1440);
    await openPage({
      load: {
        rows: [
          row(1),
          row(2, {
            subject: { id: SPIRITUAL.id, names: SPIRITUAL.names },
            teacher: { id: uid(602), kind: 'vacancy', name: 'Teacher wanted' },
            roomType: 'laboratory',
            doubleLessons: true,
            problems: ['load_teacher_status'],
          }),
        ],
      },
    });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    expect(rowsDrawn()).toEqual([
      ['7 Oxford', 'Mathematics', 'Karimova Aziza', '4', 'No special room', 'No', 'None'],
      [
        '7 Oxford',
        'Spiritual hour',
        'Teacher wanted (vacancy)',
        '4',
        'Any Laboratory',
        'Yes',
        'Teacher out on the start date',
      ],
    ]);
    const picker = screen.getByLabelText<HTMLSelectElement>(en.timetable.load.version);
    expect(picker.selectedOptions[0]?.textContent).toBe('Version 1, 2026–2027: Draft');
  });

  it('names the columns in Russian when Russian is chosen', async () => {
    setWindowWidth(1440);
    await openPage({ language: 'ru', load: { rows: [row(1)] } });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    const headers = [...document.querySelectorAll('thead th')].map((cell) => cell.textContent);
    expect(headers).toEqual(
      expect.arrayContaining([ru.timetable.load.columns.unit, ru.timetable.load.columns.problems]),
    );
    expect(rowsDrawn()[0]?.[1]).toBe('Математика');
  });

  it('starts the first draft on next Monday by default (decision 5)', async () => {
    const calls = await openPage({
      versions: [],
      extra: { 'POST /api/timetable/versions': () => json(version(1), 201) },
    });
    expect(await screen.findByText(en.timetable.load.noVersion)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.timetable.load.newDraft }));
    const form = await screen.findByRole('form', { name: en.timetable.load.newDraftTitle });
    expect(within(form).getByLabelText<HTMLInputElement>(en.timetable.load.startsOn).value).toBe(
      '2026-10-12',
    );
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/timetable/versions')?.body).toEqual({
        academicYearId: YEAR.id,
        startsOn: '2026-10-12',
        copyFrom: null,
      });
    });
  });

  it('offers a copy of a version of the same year', async () => {
    await openPage({ versions: [version(1)] });
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: en.timetable.load.newDraft })
          .disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: en.timetable.load.newDraft }));
    const form = await screen.findByRole('form', { name: en.timetable.load.newDraftTitle });
    const copy = within(form).getByLabelText<HTMLSelectElement>(en.timetable.load.copyFrom);
    expect([...copy.options].map((option) => option.textContent)).toEqual([
      en.timetable.load.startEmpty,
      'Copy of version 1',
    ]);
  });

  it('adds a row with a teacher the server offers', async () => {
    const calls = await openPage({
      teachers: () => ({ teachers: [{ ...TEACHER, tutor: false }], defaultTeacherId: null }),
      extra: {
        [`POST /api/timetable/versions/${version(1).id}/load`]: () => json(row(1), 201),
      },
    });
    const form = await openNewRow();
    type(within(form).getByLabelText(en.timetable.load.unit), `class:${OXFORD.id}`);
    type(within(form).getByLabelText(en.timetable.load.subject), MATHS.id);
    const teacher = await within(form).findByLabelText<HTMLSelectElement>(
      en.timetable.load.teacher,
    );
    await waitFor(() => {
      expect([...teacher.options].map((option) => option.textContent)).toEqual([
        en.timetable.load.chooseTeacher,
        'Karimova Aziza',
      ]);
    });
    // No teacher is chosen for an ordinary subject (correction 1).
    expect(teacher.value).toBe('');
    type(teacher, TEACHER.id);
    type(within(form).getByLabelText(en.timetable.load.lessons), '4');
    type(within(form).getByLabelText(en.timetable.load.room), `room:${LAB.id}`);
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `POST /api/timetable/versions/${version(1).id}/load`)
          ?.body,
      ).toEqual({
        classId: OXFORD.id,
        groupId: null,
        subjectId: MATHS.id,
        teacherId: TEACHER.id,
        lessonsPerWeek: 4,
        roomId: LAB.id,
        roomType: null,
        doubleLessons: false,
      });
    });
  });

  it('chooses the class Tutor already for a Tutor subject, first and marked (correction 1)', async () => {
    await openPage({
      teachers: () => ({
        teachers: [
          { ...TUTOR, tutor: true },
          { ...TEACHER, tutor: false },
        ],
        defaultTeacherId: TUTOR.id,
      }),
    });
    const form = await openNewRow();
    type(within(form).getByLabelText(en.timetable.load.unit), `class:${OXFORD.id}`);
    type(within(form).getByLabelText(en.timetable.load.subject), SPIRITUAL.id);
    const teacher = await within(form).findByLabelText<HTMLSelectElement>(
      en.timetable.load.teacher,
    );
    await waitFor(() => {
      expect(teacher.value).toBe(TUTOR.id);
    });
    expect(teacher.options[1]?.textContent).toBe('Nazarova Lola (Tutor)');
  });

  it('says what the refusal of the server means', async () => {
    await openPage({
      teachers: () => ({ teachers: [{ ...TEACHER, tutor: false }], defaultTeacherId: null }),
      extra: {
        [`POST /api/timetable/versions/${version(1).id}/load`]: () =>
          refusal('load_teacher_grade', 409),
      },
    });
    const form = await openNewRow();
    type(within(form).getByLabelText(en.timetable.load.unit), `class:${OXFORD.id}`);
    type(within(form).getByLabelText(en.timetable.load.subject), MATHS.id);
    const teacher = await within(form).findByLabelText<HTMLSelectElement>(
      en.timetable.load.teacher,
    );
    await waitFor(() => {
      expect(teacher.options).toHaveLength(2);
    });
    type(teacher, TEACHER.id);
    type(within(form).getByLabelText(en.timetable.load.lessons), '4');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await within(form).findByText(en.errors.load_teacher_grade)).not.toBeNull();
  });

  it('shows the rows a copy left with their reasons, and dismisses them (decision 10)', async () => {
    const copy = version(2, { fromVersion: { id: uid(501), number: 1 }, leftRows: 1 });
    const calls = await openPage({
      versions: [copy, version(1)],
      load: {
        leftRows: [row(9, { problems: ['load_teacher_language'] })],
      },
      extra: {
        [`PATCH /api/timetable/versions/${copy.id}`]: () => json({ ...copy, leftRows: 0 }),
      },
    });
    const left = await screen.findByRole('region', { name: en.timetable.load.leftTitle });
    expect(within(left).getByText('Language of instruction')).not.toBeNull();
    expect(screen.getByText('Copied from version 1')).not.toBeNull();
    fireEvent.click(within(left).getByRole('button', { name: en.timetable.load.dismiss }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.load.dismiss }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route === `PATCH /api/timetable/versions/${copy.id}`)?.body,
      ).toEqual({ dismissLeftRows: true });
    });
  });

  it('lets the Principal read and change nothing (decision 4)', async () => {
    setWindowWidth(1440);
    const calls = await openPage({ session: principal(), load: { rows: [row(1)] } });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    expect(screen.queryByRole('button', { name: en.timetable.load.newDraft })).toBeNull();
    expect(screen.queryByRole('button', { name: en.timetable.load.add })).toBeNull();
    expect(screen.queryByRole('button', { name: en.timetable.load.changeStart })).toBeNull();
    // The lists of the forms are read only by those who change the load.
    expect(calls.some((call) => call.route === 'GET /api/classes')).toBe(false);
  });

  it('reads a published version without offering a change', async () => {
    await openPage({ versions: [version(1, { status: 'published' })], load: { rows: [row(1)] } });
    expect(await screen.findByText(en.timetable.load.readOnly)).not.toBeNull();
    expect(screen.queryByRole('button', { name: en.timetable.load.add })).toBeNull();
  });
});

describe('the timetable page', () => {
  it.each([
    ['academic_vice_principal', true],
    ['principal', true],
    ['super_admin', true],
  ] as const)('shows the teaching load link to %s', async (role, shown) => {
    fakeApi({
      'GET /api/auth/session': () =>
        json(
          sessionOf({
            assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
            branches: [NORTH],
          }),
        ),
    });
    renderApp('/timetable');
    await screen.findByRole('heading', { name: en.timetable.title });
    expect(screen.queryByRole('link', { name: en.timetable.loadLink }) !== null).toBe(shown);
  });

  it('is not open to a Teacher until the views of lessons come (task 5.9)', async () => {
    fakeApi({
      'GET /api/auth/session': () =>
        json(
          sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }], branches: [NORTH] }),
        ),
    });
    renderApp('/timetable');
    expect(await screen.findByRole('heading', { name: en.problems.noAccessTitle })).not.toBeNull();
  });
});
