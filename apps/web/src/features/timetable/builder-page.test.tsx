import type { AcademicYear, DraftReadiness, LoadRow, TimetableVersion } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';
import { comingQuarterStarts } from './version-form';

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const YEAR: AcademicYear = {
  id: uid(1),
  name: '2026–2027',
  startDate: '2026-09-01',
  endDate: '2027-05-31',
  status: 'current',
  quarters: [
    { number: 1, startDate: '2026-09-01', endDate: '2026-10-24' },
    { number: 2, startDate: '2026-11-02', endDate: '2026-12-26' },
    { number: 3, startDate: '2027-01-11', endDate: '2027-03-20' },
    { number: 4, startDate: '2027-03-30', endDate: '2027-05-31' },
  ],
};

const VERSION: TimetableVersion = {
  id: uid(500),
  academicYearId: YEAR.id,
  yearName: YEAR.name,
  yearStatus: 'current',
  number: 1,
  status: 'draft',
  startsOn: '2026-10-19',
  fromVersion: null,
  rows: 1,
  leftRows: 0,
};

// All names are invented.
const ROW: LoadRow = {
  id: uid(700),
  unit: {
    kind: 'class',
    id: uid(101),
    name: 'Oxford',
    grades: [7],
    language: 'uz',
    archived: false,
  },
  subject: {
    id: uid(201),
    names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  },
  teacher: { id: uid(600), kind: 'person', name: 'Karimova Aziza' },
  lessonsPerWeek: 4,
  room: null,
  roomType: null,
  doubleLessons: false,
  mixedBlock: false,
  block: [],
  unplaced: 0,
  problems: [],
};

const cell = (weekday: 1 | 2 | 3 | 4 | 5) => ({
  weekday,
  grade: 7,
  date: `2026-10-${String(18 + weekday)}`,
  template: { id: uid(800), name: 'Regular', start: 480, end: 615, lessonSlots: 3 },
});

const FIGURES: DraftReadiness['teachers']['teachers'][number] = {
  ...ROW.teacher,
  lessons: 4,
  freeSlots: 15,
  elsewhere: [],
  contract: null,
  dailyLessons: null,
  noHours: false,
  over: false,
};

const readiness = (fields: Partial<DraftReadiness> = {}): DraftReadiness => ({
  ready: false,
  templates: {
    ready: false,
    startsOn: '2026-10-19',
    startPast: false,
    cells: [cell(1), cell(2), cell(3), cell(4), cell(5)],
    confirmed: false,
    changed: [],
    missing: [],
  },
  load: { ready: true, rows: 1, problemRows: [], leftRows: 0, classesOver: [] },
  teachers: {
    ready: true,
    teachers: [FIGURES],
  },
  rooms: { ready: true, rows: [], classesWithoutRoom: [] },
  ...fields,
});

const vice = () =>
  sessionOf({
    assignments: [{ role: 'academic_vice_principal', branchId: NORTH.id }],
    branches: [NORTH],
  });

const principal = () =>
  sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }], branches: [NORTH] });

async function openPage(
  options: {
    session?: ReturnType<typeof sessionOf>;
    answer?: DraftReadiness;
    confirmed?: DraftReadiness;
    path?: string;
  } = {},
) {
  let answer = options.answer ?? readiness();
  const calls = fakeApi({
    'GET /api/auth/session': () => json({ ...(options.session ?? vice()), language: 'en' }),
    'GET /api/timetable/versions': () => json({ versions: [VERSION], today: '2026-10-10' }),
    [`GET /api/timetable/versions/${VERSION.id}/readiness`]: () => json(answer),
    [`POST /api/timetable/versions/${VERSION.id}/templates/confirm`]: () => {
      answer = options.confirmed ?? answer;
      return json(answer);
    },
    'GET /api/setup/academic-years': () => json({ years: [YEAR] }),
  });
  renderApp(options.path ?? '/timetable/builder', 'en');
  await screen.findByRole('heading', { name: en.timetable.builder.title });
  return calls;
}

const stepMark = (key: string): string =>
  document.querySelector(`[data-step="${key}"]`)?.textContent ?? '';

// docs/spec/06-timetable.md, Building a timetable; task 5.3a, pull request #127.
describe('the draft builder', () => {
  it('marks each step from the readiness, and steps 5 to 8 as not yet available', async () => {
    await openPage({
      answer: readiness({
        teachers: { ready: false, teachers: [FIGURES] },
      }),
    });
    await waitFor(() => {
      expect(stepMark('templates')).toContain(en.timetable.builder.notReady);
    });
    expect(stepMark('load')).toContain(en.timetable.builder.ready);
    expect(stepMark('teachers')).toContain(en.timetable.builder.notReady);
    expect(stepMark('rooms')).toContain(en.timetable.builder.ready);
    for (const key of ['rules', 'generate', 'grid', 'publish']) {
      expect(stepMark(key)).toContain(en.timetable.builder.later);
      expect(
        document.querySelector<HTMLButtonElement>(`[data-step="${key}"] button`)?.disabled,
      ).toBe(true);
    }
    expect(document.querySelector('[data-ready]')?.textContent).toBe(
      'Not ready for generation: 2 steps are not ready',
    );
  });

  it('confirms the templates and shows step 1 ready afterwards', async () => {
    const done = readiness({
      templates: { ...readiness().templates, ready: true, confirmed: true },
    });
    const calls = await openPage({ confirmed: { ...done, ready: true } });
    const button = await screen.findByRole('button', { name: en.timetable.builder.confirm });
    fireEvent.click(button);
    await waitFor(() => {
      expect(stepMark('templates')).toContain(en.timetable.builder.ready);
    });
    expect(calls.map((call) => call.route)).toContain(
      `POST /api/timetable/versions/${VERSION.id}/templates/confirm`,
    );
    expect(screen.queryByRole('button', { name: en.timetable.builder.confirm })).toBeNull();
    expect(document.querySelector('[data-ready]')?.textContent).toBe(
      en.timetable.builder.readyForGeneration,
    );
  });

  it('marks the cells changed since the confirm, and offers no confirm to the Principal', async () => {
    await openPage({
      session: principal(),
      answer: readiness({
        templates: { ...readiness().templates, changed: [{ weekday: 3, grade: 7 }] },
      }),
    });
    await screen.findByText(en.timetable.builder.changedSince);
    expect(document.querySelectorAll('[data-changed="true"]')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: en.timetable.builder.confirm })).toBeNull();
    expect(screen.queryByRole('button', { name: en.timetable.load.changeStart })).toBeNull();
  });

  it('lists the rows with a problem and links to the teaching load', async () => {
    await openPage({
      path: `/timetable/builder?version=${VERSION.id}&step=load`,
      answer: readiness({
        load: {
          ready: false,
          rows: 1,
          problemRows: [{ ...ROW, problems: ['load_teacher_status'] }],
          leftRows: 1,
          classesOver: [{ id: uid(101), name: 'Oxford', grade: 7, lessons: 31, lessonSlots: 30 }],
        },
      }),
    });
    const line = await waitFor(() => {
      const found = document.querySelector(`[data-problem-row="${ROW.id}"]`);
      expect(found).not.toBeNull();
      return found;
    });
    expect(line?.textContent).toBe('7 Oxford, Mathematics · Teacher out on the start date');
    expect(document.querySelector(`[data-class-over="${uid(101)}"]`)?.textContent).toBe(
      '7 Oxford: 31 lessons, 30 lesson slots',
    );
    expect(document.querySelector('[data-reason="leftRows"]')).not.toBeNull();
    expect(
      screen.getByRole('link', { name: en.timetable.builder.openLoad }).getAttribute('href'),
    ).toBe(`/timetable/load?version=${VERSION.id}`);
  });

  it('shows a teacher with no hours and links to the staff record', async () => {
    await openPage({
      path: `/timetable/builder?version=${VERSION.id}&step=teachers`,
      answer: readiness({
        teachers: {
          ready: false,
          teachers: [{ ...FIGURES, freeSlots: null, noHours: true }],
        },
      }),
    });
    const teacherRow = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(`[data-teacher="${ROW.teacher.id}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(within(teacherRow).getByText(en.timetable.builder.noHours)).toBeTruthy();
    expect(within(teacherRow).getByRole('link').getAttribute('href')).toBe(
      `/people/staff?open=${ROW.teacher.id}`,
    );
  });
});

describe('comingQuarterStarts (decision 6)', () => {
  it('offers the quarters that start today or later, never a past one', () => {
    expect(comingQuarterStarts(YEAR, '2026-11-02')).toEqual([
      { number: 2, date: '2026-11-02' },
      { number: 3, date: '2027-01-11' },
      { number: 4, date: '2027-03-30' },
    ]);
    expect(comingQuarterStarts(YEAR, '2027-04-01')).toEqual([]);
  });

  it('offers nothing for a year with undated quarters or none', () => {
    expect(
      comingQuarterStarts(
        { ...YEAR, quarters: YEAR.quarters.map((one) => ({ ...one, startDate: null })) },
        '2026-10-10',
      ),
    ).toEqual([]);
    expect(comingQuarterStarts(undefined, '2026-10-10')).toEqual([]);
  });
});
