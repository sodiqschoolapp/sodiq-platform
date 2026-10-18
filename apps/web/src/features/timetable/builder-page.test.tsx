import type {
  AcademicYear,
  DraftReadiness,
  LoadRow,
  PreferenceWeights,
  TimetableVersion,
} from '@sodiq/shared';
import { FIXED_RULES } from '@sodiq/timetable-rules';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';
import { pinSlots } from './pins-section';
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
  outOfDate: false,
  editLock: null,
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
  shortReason: null,
  block: [],
  unplaced: 0,
  problems: [],
};

const cell = (weekday: 1 | 2 | 3 | 4 | 5) => ({
  weekday,
  grade: 7,
  date: `2026-10-${String(18 + weekday)}`,
  template: {
    id: uid(800),
    name: 'Regular',
    start: 480,
    end: 615,
    lessonSlots: 3,
    // Task 5.3b-2: the slots a pin names, breaks included.
    slots: [
      { position: 1, kind: 'lesson' as const, start: 480, end: 525 },
      { position: 2, kind: 'break' as const, start: 525, end: 530 },
      { position: 3, kind: 'lesson' as const, start: 530, end: 570 },
      { position: 4, kind: 'break' as const, start: 570, end: 575 },
      { position: 5, kind: 'lesson' as const, start: 575, end: 615 },
    ],
  },
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

const WEIGHTS: PreferenceWeights = {
  class_no_gaps: 5,
  teacher_few_gaps: 5,
  subject_spread: 5,
  demanding_early: 5,
  class_even_days: 5,
  main_room: 5,
  part_time_few_days: 5,
  teacher_preferred_times: 5,
};

/** Step 5 with no pin (task 5.3b-2). */
const NO_PINS = { pins: [], pinsChanged: false, conflicts: [], problems: [] };

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
  load: {
    ready: true,
    rows: 1,
    problemRows: [],
    leftRows: 0,
    classesOver: [],
    tutorPinClashes: [],
  },
  teachers: {
    ready: true,
    teachers: [FIGURES],
  },
  rooms: { ready: true, rows: [], classesWithoutRoom: [] },
  // Task 5.3b-1 (review correction 1): step 5, not confirmed yet.
  rules: { ready: false, confirmed: false, weights: WEIGHTS, changed: [], ...NO_PINS },
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
    saved?: (body: unknown) => DraftReadiness;
    rulesConfirmed?: DraftReadiness;
    pinned?: (body: unknown) => DraftReadiness;
    unpinned?: DraftReadiness;
    path?: string;
    /** More answers of the fake API (task 5.5a-1: the publish routes). */
    extra?: Parameters<typeof fakeApi>[0];
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
    [`PUT /api/timetable/versions/${VERSION.id}/preferences`]: (body) => {
      answer = options.saved?.(body) ?? answer;
      return json(answer);
    },
    [`POST /api/timetable/versions/${VERSION.id}/rules/confirm`]: () => {
      answer = options.rulesConfirmed ?? answer;
      return json(answer);
    },
    'GET /api/setup/academic-years': () => json({ years: [YEAR] }),
    [`GET /api/timetable/versions/${VERSION.id}/load`]: () =>
      json({ version: VERSION, rows: [ROW], leftRows: [] }),
    [`POST /api/timetable/versions/${VERSION.id}/pins`]: (body) => {
      answer = options.pinned?.(body) ?? answer;
      return json(answer);
    },
    ...(options.unpinned === undefined
      ? {}
      : {
          [`DELETE /api/timetable/versions/${VERSION.id}/pins/${uid(900)}`]: () => {
            answer = options.unpinned ?? answer;
            return json(answer);
          },
        }),
    ...options.extra,
  });
  renderApp(options.path ?? '/timetable/builder', 'en');
  await screen.findByRole('heading', { name: en.timetable.builder.title });
  return calls;
}

const stepMark = (key: string): string =>
  document.querySelector(`[data-step="${key}"]`)?.textContent ?? '';

// docs/spec/06-timetable.md, Building a timetable; task 5.3a, pull request #127.
describe('the draft builder', () => {
  it('marks each step from the readiness, step 6 as not yet available, and the grid and publish open (5.4a, 5.5a-1)', async () => {
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
    expect(stepMark('rules')).toContain(en.timetable.builder.notReady);
    expect(stepMark('generate')).toContain(en.timetable.builder.later);
    expect(
      document.querySelector<HTMLButtonElement>('[data-step="generate"] button')?.disabled,
    ).toBe(true);
    // Task 5.5a-1: step 8 opens for a draft, marked not published.
    expect(stepMark('publish')).toContain(en.timetable.builder.notPublished);
    expect(
      document.querySelector<HTMLButtonElement>('[data-step="publish"] button')?.disabled,
    ).toBe(false);
    // Task 5.4a: step 7 opens for any draft; its mark comes with the conflict panel (decision 13).
    expect(stepMark('grid')).toContain(en.timetable.builder.byHand);
    expect(document.querySelector<HTMLButtonElement>('[data-step="grid"] button')?.disabled).toBe(
      false,
    );
    expect(document.querySelector('[data-ready]')?.textContent).toBe(
      'Not ready for generation: 3 steps are not ready',
    );
    expect(document.querySelector('[data-reason="notReadySteps"]')?.textContent).toBe(
      'Steps not ready: Period and day templates, Teachers, Rules',
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
          tutorPinClashes: [],
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

// Step 5 (task 5.3b-1, pull request #128): the fixed rules, the weights and
// the confirmation of the weights shown (decisions 2, 3, 4 and 9).
describe('step 5 of the draft builder', () => {
  const STEP_FIVE = `/timetable/builder?version=${VERSION.id}&step=rules`;
  const weightSelects = () =>
    document.querySelectorAll('[aria-labelledby="preference-weights"] select');
  const select = (code: keyof PreferenceWeights) =>
    screen.getByLabelText<HTMLSelectElement>(en.timetable.preference[code]);

  it('lists the fixed rules of the rule engine and a weight from 0 to 10 for each preference', async () => {
    await openPage({ path: STEP_FIVE });
    await waitFor(() => {
      expect(document.querySelectorAll('[data-rule]')).toHaveLength(FIXED_RULES.length);
    });
    expect(document.querySelector('[data-rule="teacher_double"]')?.textContent).toBe(
      'A teacher cannot be in two lessons at the same time.',
    );
    expect(select('main_room').value).toBe('5');
    expect([...select('main_room').options].map((option) => option.textContent)).toEqual([
      en.timetable.builder.rulesStep.weightOption0,
      ...Array.from({ length: 10 }, (_, index) => String(index + 1)),
    ]);
    expect(weightSelects()).toHaveLength(8);
  });

  it('saves all eight weights, keeps Confirm off while a weight is not saved, then confirms the weights shown', async () => {
    const changed = { ...WEIGHTS, main_room: 0 };
    const calls = await openPage({
      path: STEP_FIVE,
      saved: () =>
        readiness({
          rules: { ready: false, confirmed: false, weights: changed, changed: [], ...NO_PINS },
        }),
      rulesConfirmed: readiness({
        rules: { ready: true, confirmed: true, weights: changed, changed: [], ...NO_PINS },
      }),
    });
    await waitFor(() => {
      expect(weightSelects()).toHaveLength(8);
    });
    fireEvent.change(select('main_room'), { target: { value: '0' } });
    const confirmButton = screen.getByRole<HTMLButtonElement>('button', {
      name: en.timetable.builder.rulesStep.confirm,
    });
    expect(confirmButton.disabled).toBe(true);
    expect(document.querySelector('[data-reason="saveFirst"]')).not.toBeNull();
    fireEvent.click(
      within(screen.getByRole('form', { name: en.timetable.builder.rulesStep.weights })).getByRole(
        'button',
        { name: en.form.save },
      ),
    );
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>('button', {
          name: en.timetable.builder.rulesStep.confirm,
        }).disabled,
      ).toBe(false);
    });
    expect(calls.find((call) => call.route.startsWith('PUT'))?.body).toEqual({ weights: changed });
    fireEvent.click(screen.getByRole('button', { name: en.timetable.builder.rulesStep.confirm }));
    await waitFor(() => {
      expect(stepMark('rules')).toContain(en.timetable.builder.ready);
    });
    // Task 5.3b-2 (review correction 2): the confirm carries the pins shown, none here.
    expect(calls.find((call) => call.route.endsWith('/rules/confirm'))?.body).toEqual({
      weights: changed,
      pins: [],
    });
  });

  it('names the weights changed since the confirmation, and shows the Principal the weights only', async () => {
    await openPage({
      path: STEP_FIVE,
      session: principal(),
      answer: readiness({
        rules: {
          ready: false,
          confirmed: false,
          weights: { ...WEIGHTS, subject_spread: 0 },
          changed: ['subject_spread'],
          ...NO_PINS,
        },
      }),
    });
    await screen.findByText(
      `Weights changed since the confirmation: ${en.timetable.preference.subject_spread}`,
    );
    expect(weightSelects()).toHaveLength(0);
    expect(document.querySelector('[data-preference="subject_spread"] dd')?.textContent).toBe(
      en.timetable.builder.rulesStep.weightOption0,
    );
    expect(
      screen.queryByRole('button', { name: en.timetable.builder.rulesStep.confirm }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: en.form.save })).toBeNull();
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

// Task 5.3b-2: the pinned lessons of step 5 (06, Building a timetable, step 5:
// "pins lessons that must stay at a fixed time"; edge/timetable, Generator and
// editing: "the locked and pinned lessons are checked on their own").
describe('the pinned lessons of step 5', () => {
  const STEP_FIVE = `/timetable/builder?version=${VERSION.id}&step=rules`;
  const PIN: DraftReadiness['rules']['pins'][number] = {
    id: uid(900),
    loadRowId: ROW.id,
    unit: ROW.unit,
    subject: ROW.subject,
    teacher: ROW.teacher,
    weekday: 5,
    slotPosition: 5,
    time: { start: 575, end: 615 },
  };
  const OTHER: DraftReadiness['rules']['pins'][number] = {
    ...PIN,
    id: uid(901),
    unit: { ...ROW.unit, id: uid(102), name: 'Princeton' },
  };
  const withPins = (rules: Partial<DraftReadiness['rules']>) =>
    readiness({
      rules: {
        ready: false,
        confirmed: false,
        weights: WEIGHTS,
        changed: [],
        ...NO_PINS,
        ...rules,
      },
    });
  const pinForm = () => screen.getByRole('form', { name: en.timetable.builder.pins.add });

  it('lists the pins with the time of their slot, and the conflicts with the rule named', async () => {
    await openPage({
      path: STEP_FIVE,
      answer: withPins({
        pins: [PIN, OTHER],
        conflicts: [
          { rule: 'teacher_double', weekday: 5, pinIds: [PIN.id, OTHER.id], elsewhere: false },
        ],
        problems: [{ pinId: OTHER.id, problem: 'pin_no_slot' }],
      }),
    });
    const row = await waitFor(() => {
      const found = document.querySelector(`[data-pin="${PIN.id}"]`);
      expect(found).not.toBeNull();
      return found;
    });
    const cells = [...(row?.querySelectorAll('td') ?? [])].map((one) => one.textContent);
    expect(cells.slice(0, 5)).toEqual([
      '7 Oxford',
      'Mathematics',
      'Karimova Aziza',
      'Friday',
      expect.stringMatching(/^5\. 09:35.10:15$/),
    ]);
    const conflict = document.querySelector('[data-pin-conflicts] [data-rule="teacher_double"]');
    expect(conflict?.textContent).toBe(
      `${en.timetable.rule.teacher_double} · 7 Oxford, Mathematics, Friday, slot 5; 7 Princeton, Mathematics, Friday, slot 5`,
    );
    expect(
      document.querySelector('[data-pin-problems] [data-problem="pin_no_slot"]')?.textContent,
    ).toBe(
      `${en.timetable.builder.pins.problems.pin_no_slot} · 7 Princeton, Mathematics, Friday, slot 5`,
    );
  });

  it('pins a lesson to a slot offered from the templates, and removes a pin', async () => {
    const calls = await openPage({
      path: STEP_FIVE,
      pinned: () => withPins({ pins: [PIN] }),
      unpinned: withPins({}),
    });
    await screen.findByText(en.timetable.builder.pins.none);
    const form = await waitFor(() => pinForm());
    const lesson = await within(form).findByRole('option', { name: '7 Oxford, Mathematics' });
    fireEvent.change(
      within(form).getByLabelText<HTMLSelectElement>(en.timetable.builder.pins.row),
      {
        target: { value: (lesson as HTMLOptionElement).value },
      },
    );
    fireEvent.change(
      within(form).getByLabelText<HTMLSelectElement>(en.timetable.builder.pins.weekday),
      { target: { value: '5' } },
    );
    const slot = within(form).getByLabelText<HTMLSelectElement>(en.timetable.builder.pins.slot);
    // Only the lesson slots, by position: the breaks 2 and 4 are not offered.
    expect([...slot.options].map((one) => one.value)).toEqual(['', '1', '3', '5']);
    fireEvent.change(slot, { target: { value: '5' } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(document.querySelector(`[data-pin="${PIN.id}"]`)).not.toBeNull();
    });
    expect(calls.find((call) => call.route.endsWith('/pins'))?.body).toEqual({
      loadRowId: ROW.id,
      weekday: 5,
      slotPosition: 5,
    });
    fireEvent.click(screen.getByRole('button', { name: en.timetable.builder.pins.remove }));
    await screen.findByText(en.timetable.builder.pins.none);
    expect(calls.some((call) => call.route.startsWith('DELETE'))).toBe(true);
  });

  it('confirms the pins shown and names a change of the pins since the confirmation', async () => {
    const calls = await openPage({
      path: STEP_FIVE,
      answer: withPins({ pins: [PIN], pinsChanged: true }),
    });
    await screen.findByText(en.timetable.builder.rulesStep.pinsChangedSince);
    fireEvent.click(
      await screen.findByRole('button', { name: en.timetable.builder.rulesStep.confirm }),
    );
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/rules/confirm'))?.body).toEqual({
        weights: WEIGHTS,
        pins: [PIN.id],
      });
    });
  });

  it('shows the Principal the pins with no form and no Remove', async () => {
    await openPage({ path: STEP_FIVE, session: principal(), answer: withPins({ pins: [PIN] }) });
    await waitFor(() => {
      expect(document.querySelector(`[data-pin="${PIN.id}"]`)).not.toBeNull();
    });
    expect(screen.queryByRole('form', { name: en.timetable.builder.pins.add })).toBeNull();
    expect(screen.queryByRole('button', { name: en.timetable.builder.pins.remove })).toBeNull();
  });

  it('lists a Tutor of two classes pinned at the same time in the load step', async () => {
    const clash = {
      rule: 'teacher_double',
      weekday: 5 as const,
      pinIds: [PIN.id, OTHER.id],
      elsewhere: false,
    };
    await openPage({
      path: `/timetable/builder?version=${VERSION.id}&step=load`,
      answer: readiness({
        load: {
          ready: true,
          rows: 2,
          problemRows: [],
          leftRows: 0,
          classesOver: [],
          tutorPinClashes: [clash],
        },
        rules: {
          ready: false,
          confirmed: true,
          weights: WEIGHTS,
          changed: [],
          ...NO_PINS,
          pins: [PIN, OTHER],
          conflicts: [clash],
        },
      }),
    });
    const line = await waitFor(() => {
      const found = document.querySelector('[data-tutor-clash]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(line?.textContent).toBe(
      '7 Oxford, Mathematics, Friday, slot 5; 7 Princeton, Mathematics, Friday, slot 5',
    );
  });

  it('names a lesson in another branch beside a pin it meets in the load step (task 5.4b-1)', async () => {
    const clash = {
      rule: 'teacher_double',
      weekday: 5 as const,
      pinIds: [PIN.id],
      elsewhere: true,
    };
    await openPage({
      path: `/timetable/builder?version=${VERSION.id}&step=load`,
      answer: readiness({
        load: {
          ready: true,
          rows: 2,
          problemRows: [],
          leftRows: 0,
          classesOver: [],
          tutorPinClashes: [clash],
        },
        rules: {
          ready: false,
          confirmed: true,
          weights: WEIGHTS,
          changed: [],
          ...NO_PINS,
          pins: [PIN],
          conflicts: [clash],
        },
      }),
    });
    const line = await waitFor(() => {
      const found = document.querySelector('[data-tutor-clash]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(line?.textContent).toBe(
      `7 Oxford, Mathematics, Friday, slot 5; ${en.timetable.builder.pins.elsewhere}`,
    );
  });
});

describe('pinSlots', () => {
  const day = (grade: number, slots: [number, number][]) => ({
    weekday: 1 as const,
    grade,
    date: '2026-10-19',
    template: {
      id: uid(800 + grade),
      name: 'Day',
      start: 480,
      end: 700,
      lessonSlots: slots.length,
      slots: slots.flatMap(([start, end], index) => [
        ...(index === 0
          ? []
          : [{ position: index * 2, kind: 'break' as const, start: start - 5, end: start }]),
        { position: index * 2 + 1, kind: 'lesson' as const, start, end },
      ]),
    },
  });

  it('offers a group of two grades only the slots with the same times in both templates', () => {
    const ninth = day(9, [
      [480, 525],
      [530, 575],
      [580, 625],
    ]);
    const tenth = day(10, [
      [480, 525],
      [530, 580],
      [585, 630],
    ]);
    expect(pinSlots([ninth, tenth], [10, 9], 1)).toEqual([{ position: 1, start: 480, end: 525 }]);
    expect(pinSlots([ninth, tenth], [9], 1).map((slot) => slot.position)).toEqual([1, 3, 5]);
    expect(pinSlots([ninth], [9, 10], 1)).toEqual([]);
    expect(pinSlots([ninth, tenth], [9], 2)).toEqual([]);
  });

  // Task 5.5a-1, pull request #139: step 8 (06, Editing in the grid: "Publish:
  // confirm the start date set at step 1, or change it ... A draft with errors
  // cannot be published").
  describe('step 8, review and publish', () => {
    const CHECK = {
      startsOn: '2026-10-19',
      earliest: '2026-10-11',
      defaultStart: '2026-10-12',
      quarterStarts: ['2026-11-02', '2027-01-11'],
      refusals: [],
      warnings: [],
      cancelledLessons: [],
      needsTeacher: [],
      impact: null,
      shortenedDays: [],
      unusedKeeps: [],
      chain: null,
      canPublish: true,
    };
    const checkRoute = `GET /api/timetable/versions/${VERSION.id}/publish-check`;
    const publishRoute = `POST /api/timetable/versions/${VERSION.id}/publish`;

    it('lists every reason the draft cannot be published, with the row named, and keeps Publish off', async () => {
      await openPage({
        path: `/timetable/builder?version=${VERSION.id}&step=publish`,
        extra: {
          [checkRoute]: () =>
            json({
              ...CHECK,
              canPublish: false,
              refusals: [
                {
                  code: 'load_mismatch',
                  loadRowId: ROW.id,
                  result: {
                    rule: 'load_mismatch',
                    severity: 'warning',
                    weekday: null,
                    lessonIds: [],
                    detail: { loadRowId: ROW.id, placed: 3, lessonsPerWeek: 4 },
                  },
                },
                { code: 'year_quarters' },
              ],
            }),
        },
      });
      const list = await waitFor(() => {
        const found = document.querySelector('[data-refusals]');
        if (found === null) throw new Error('No list yet.');
        return found;
      });
      const items = [...list.querySelectorAll('li')].map((item) => item.textContent);
      expect(items).toEqual([
        `7 Oxford, Mathematics: 3 of 4 lessons placed. Place them, or mark the row deliberately short with a reason.`,
        en.timetable.publish.refusals.year_quarters,
      ]);
      expect(screen.getByRole('button', { name: en.timetable.publish.action })).toHaveProperty(
        'disabled',
        true,
      );
    });

    // Task 5.5a-2a, pull request #140: what a date of the version shows.
    it('lists a refusal and a warning by date, the lessons the day cannot hold and those that need a teacher', async () => {
      const entry = '0199a000-0000-7000-8000-000000000950';
      await openPage({
        path: `/timetable/builder?version=${VERSION.id}&step=publish`,
        extra: {
          [checkRoute]: () =>
            json({
              ...CHECK,
              canPublish: false,
              refusals: [
                {
                  code: 'date_blocked',
                  result: {
                    rule: 'teacher_double',
                    severity: 'blocked',
                    weekday: 1,
                    date: '2026-11-16',
                    lessonIds: [entry],
                    detail: { branchId: '0199a000-0000-7000-8000-000000000951' },
                  },
                },
              ],
              warnings: [
                {
                  rule: 'teacher_unavailable_later',
                  severity: 'warning',
                  weekday: 1,
                  date: '2027-01-11',
                  lessonIds: [entry],
                  detail: { date: '2027-01-11' },
                },
              ],
              cancelledLessons: [
                { date: '2026-11-23', reason: 'not_in_template', entryIds: [entry] },
              ],
              needsTeacher: [
                { date: '2026-11-21', entryId: entry, reason: 'not_available_real_day' },
              ],
            }),
        },
      });
      const refusals = await waitFor(() => {
        const found = document.querySelector('[data-refusals]');
        if (found === null) throw new Error('No list yet.');
        return found;
      });
      expect([...refusals.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
        `16 November 2026: ${en.timetable.rule.teacher_double}. ${en.timetable.publish.busyInAnother}`,
      ]);
      expect(document.querySelector('[data-date="2027-01-11"]')?.textContent).toBe(
        `11 January 2027: ${en.timetable.rule.teacher_unavailable_later}`,
      );
      expect(document.querySelector('[data-cancelled] li')?.textContent).toBe(
        `23 November 2026: ${en.timetable.publish.cancelled.not_in_template}`,
      );
      expect(document.querySelector('[data-needs-teacher] li')?.textContent).toBe(
        `21 November 2026: ${en.timetable.publish.needsTeacher.not_available_real_day}`,
      );
      screen.getByRole('heading', { name: '1 lesson the day cannot hold' });
      screen.getByRole('heading', { name: '1 lesson will need a teacher' });
    });

    it('checks the date chosen by a shortcut and publishes on it after the confirmation', async () => {
      const calls = await openPage({
        path: `/timetable/builder?version=${VERSION.id}&step=publish`,
        extra: {
          [checkRoute]: () => json(CHECK),
          [publishRoute]: () => json({ ...VERSION, status: 'published', startsOn: '2026-11-02' }),
        },
      });
      await screen.findByText(en.timetable.publish.nothingRefused);
      fireEvent.click(screen.getByRole('button', { name: 'Quarter start: 2 November 2026' }));
      await waitFor(() => {
        expect(
          calls.filter((call) => call.route === checkRoute).map((call) => call.query),
        ).toContain('?startsOn=2026-11-02');
      });
      fireEvent.click(await screen.findByRole('button', { name: en.timetable.publish.action }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.publish.action }));
      await waitFor(() => {
        expect(calls.find((call) => call.route === publishRoute)?.body).toEqual({
          startsOn: '2026-11-02',
        });
      });
    });

    // Task 5.5a-3a, pull request #145: edge/timetable, Versions and drafts,
    // the question of a publish before a later published version.
    it('asks what happens to the later versions, keeps carry off with its reason, and sends the answer with its key', async () => {
      const KEY = 'a'.repeat(64);
      const LATER = { id: uid(901), number: 4, startsOn: '2026-11-09' };
      const chainOf = (carryOffered: boolean) => ({
        key: KEY,
        later: [LATER],
        carryOffered,
        carryReason: carryOffered ? null : 'other_changes',
        changes: [],
        carried: [],
      });
      // The check with an answer refuses nothing; the fake API has no query, so a flag tells them apart.
      let chosen = false;
      const calls = await openPage({
        path: `/timetable/builder?version=${VERSION.id}&step=publish`,
        extra: {
          [checkRoute]: () =>
            json(
              chosen
                ? { ...CHECK, chain: chainOf(false) }
                : {
                    ...CHECK,
                    canPublish: false,
                    refusals: [{ code: 'version_later_published', versionNumber: 4 }],
                    chain: chainOf(false),
                  },
            ),
          [publishRoute]: () => json({ ...VERSION, status: 'published' }),
        },
      });
      const later = await waitFor(() => {
        const found = document.querySelector('[data-later] li');
        if (found === null) throw new Error('No later versions yet.');
        return found;
      });
      expect(later.textContent).toBe('Version 4, from 9 November 2026');
      expect(screen.getByRole('button', { name: en.timetable.publish.action })).toHaveProperty(
        'disabled',
        true,
      );
      const carry = screen.getByRole('radio', { name: en.timetable.publish.chain.answers.carry });
      expect(carry).toHaveProperty('disabled', true);
      expect(document.querySelector('[data-hint="carry"]')?.textContent).toBe(
        en.timetable.publish.chain.notOffered.other_changes,
      );
      chosen = true;
      fireEvent.click(
        screen.getByRole('radio', { name: en.timetable.publish.chain.answers.run_until }),
      );
      await waitFor(() => {
        expect(
          calls.filter((call) => call.route === checkRoute).map((call) => call.query),
        ).toContain('?startsOn=2026-10-19&chain=run_until');
      });
      await screen.findByText(en.timetable.publish.nothingRefused);
      fireEvent.click(screen.getByRole('button', { name: en.timetable.publish.action }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.publish.action }));
      await waitFor(() => {
        expect(calls.find((call) => call.route === publishRoute)?.body).toEqual({
          startsOn: '2026-10-19',
          chain: 'run_until',
          laterKey: KEY,
        });
      });
    });

    // Task 5.5a-2b-2, pull request #143: the lessons kept on a shortened day.
    describe('a shortened day', () => {
      const keepRoute = `PUT /api/timetable/versions/${VERSION.id}/day-keeps`;
      const DAY = {
        date: '2026-11-16',
        classId: ROW.unit.id,
        lessonSlots: 2,
        lessons: [
          { slotPosition: 1, entryIds: [uid(801)] },
          { slotPosition: 3, entryIds: [uid(802)] },
          { slotPosition: 5, entryIds: [uid(803)] },
        ],
        kept: [1, 3],
        chosen: false,
        missingPositions: [],
      };
      const boxes = () => [
        ...document.querySelectorAll<HTMLInputElement>('[data-shortened] input[type="checkbox"]'),
      ];

      it('ticks the lessons kept, keeps Save off with too many, and saves the lessons chosen', async () => {
        const calls = await openPage({
          path: `/timetable/builder?version=${VERSION.id}&step=publish`,
          extra: {
            [checkRoute]: () => json({ ...CHECK, shortenedDays: [DAY] }),
            [keepRoute]: () =>
              json({ classId: ROW.unit.id, date: '2026-11-16', slotPositions: [1, 5] }),
          },
        });
        await screen.findByRole('heading', { name: '1 shortened day' });
        expect(document.querySelector('[data-shortened] p')?.textContent).toBe(
          '16 November 2026, 7 Oxford',
        );
        expect(boxes().map((box) => box.checked)).toEqual([true, true, false]);
        const save = screen.getByRole('button', { name: en.timetable.publish.shortened.save });
        expect(save).toHaveProperty('disabled', true);
        expect(
          screen.queryByRole('button', { name: en.timetable.publish.shortened.reset }),
        ).toBeNull();
        fireEvent.click(boxes()[2] as HTMLInputElement);
        expect(document.querySelector('[data-kept-count]')?.textContent).toBe(
          'Lessons kept: 3 of 2',
        );
        expect(document.querySelector('[data-too-many]')).not.toBeNull();
        expect(save).toHaveProperty('disabled', true);
        fireEvent.click(boxes()[1] as HTMLInputElement);
        expect(document.querySelector('[data-too-many]')).toBeNull();
        expect(save).toHaveProperty('disabled', false);
        fireEvent.click(save);
        await waitFor(() => {
          expect(calls.find((call) => call.route === keepRoute)?.body).toEqual({
            classId: ROW.unit.id,
            date: '2026-11-16',
            slotPositions: [1, 5],
          });
        });
      });

      it('goes back to the default and removes a choice that no longer applies with an empty list', async () => {
        const calls = await openPage({
          path: `/timetable/builder?version=${VERSION.id}&step=publish`,
          extra: {
            [checkRoute]: () =>
              json({
                ...CHECK,
                shortenedDays: [{ ...DAY, kept: [1, 5], chosen: true, missingPositions: [7] }],
                unusedKeeps: [{ date: '2026-11-23', classId: ROW.unit.id }],
              }),
            [keepRoute]: (body) => json(body),
          },
        });
        await screen.findByRole('heading', { name: '1 shortened day' });
        expect(document.querySelector('[data-chosen]')).not.toBeNull();
        expect(document.querySelector('[data-missing]')?.textContent).toBe(
          en.timetable.publish.shortened.missing,
        );
        expect(boxes().map((box) => box.checked)).toEqual([true, false, true]);
        fireEvent.click(screen.getByRole('button', { name: en.timetable.publish.shortened.reset }));
        await waitFor(() => {
          expect(calls.filter((call) => call.route === keepRoute).map((call) => call.body)).toEqual(
            [{ classId: ROW.unit.id, date: '2026-11-16', slotPositions: [] }],
          );
        });
        const unused = document.querySelector('[data-unused]');
        expect(unused?.textContent).toContain('23 November 2026, 7 Oxford');
        fireEvent.click(
          within(unused as HTMLElement).getByRole('button', {
            name: en.timetable.publish.shortened.remove,
          }),
        );
        await waitFor(() => {
          expect(
            calls.filter((call) => call.route === keepRoute).map((call) => call.body),
          ).toContainEqual({ classId: ROW.unit.id, date: '2026-11-23', slotPositions: [] });
        });
      });
    });

    // Task 5.5a-2b-1, pull request #142: the impact preview and the transition week.
    it('shows the impact preview and keeps Publish off until the transition week is ticked, then sends its key', async () => {
      const second = uid(601);
      const vacancy = uid(602);
      const key = 'a'.repeat(64);
      const slot = (teacherId: string) => ({
        weekday: 1,
        start: 530,
        end: 575,
        teacherIds: [teacherId],
        roomId: null,
      });
      const calls = await openPage({
        path: `/timetable/builder?version=${VERSION.id}&step=publish`,
        extra: {
          [checkRoute]: () =>
            json({
              ...CHECK,
              impact: {
                beforeVersion: { id: uid(950), number: 1 },
                carried: [],
                counts: { created: 0, moved: 0, removed: 0, changed: 12, unchanged: 40 },
                changes: [
                  {
                    kind: 'changed',
                    unitId: ROW.unit.id,
                    subjectId: ROW.subject.id,
                    classIds: [ROW.unit.id],
                    before: slot(ROW.teacher.id),
                    after: slot(second),
                    count: 12,
                    firstDate: '2026-10-19',
                    lastDate: '2027-05-24',
                  },
                ],
                teachers: [
                  { id: ROW.teacher.id, vacancy: false, notified: true },
                  { id: second, vacancy: false, notified: false },
                ],
                classIds: [ROW.unit.id],
                roomIds: [],
                vacancies: [{ id: vacancy, lessonsPerWeek: 3 }],
                transition: {
                  weekStart: '2026-10-19',
                  weekEnd: '2026-10-25',
                  rows: [
                    {
                      unitId: ROW.unit.id,
                      subjectId: ROW.subject.id,
                      before: 2,
                      after: 3,
                      lessonsPerWeek: 4,
                      differs: true,
                    },
                  ],
                  key,
                },
                names: {
                  units: [{ id: ROW.unit.id, kind: 'class', name: 'Oxford', grades: [7] }],
                  subjects: [{ id: ROW.subject.id, names: ROW.subject.names }],
                  teachers: [
                    { id: ROW.teacher.id, name: 'Karimova Aziza' },
                    { id: second, name: 'Rahimov Bobur' },
                    { id: vacancy, name: 'Teacher wanted' },
                  ],
                  rooms: [],
                },
              },
            }),
          [publishRoute]: () => json({ ...VERSION, status: 'published' }),
        },
      });
      const changes = await waitFor(() => {
        const found = document.querySelector('[data-changes]');
        if (found === null) throw new Error('No preview yet.');
        return found;
      });
      expect([...changes.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
        'Teacher or room changed: 7 Oxford, Mathematics. Monday 08:50–09:35, Karimova Aziza becomes Monday 08:50–09:35, Rahimov Bobur. 12 lessons. 19 October 2026 to 24 May 2027',
      ]);
      expect(
        [...document.querySelectorAll('[data-teachers] li')].map((item) => item.textContent),
      ).toEqual(['Karimova Aziza: notified', 'Rahimov Bobur: no account, not notified']);
      expect(document.querySelector('[data-vacancies] li')?.textContent).toBe(
        'Teacher wanted: 3 lessons a week',
      );
      const row = document.querySelector('[data-transition] tbody tr');
      expect([...(row?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent)).toEqual([
        '7 Oxford',
        'Mathematics',
        '2',
        '3',
        '4',
        en.timetable.publish.transition.differs,
      ]);
      const action = screen.getByRole('button', { name: en.timetable.publish.action });
      expect(action).toHaveProperty('disabled', true);
      expect(document.querySelector('[data-tick-needed]')?.textContent).toBe(
        en.timetable.publish.transition.tickNeeded,
      );
      fireEvent.click(screen.getByRole('checkbox', { name: en.timetable.publish.transition.tick }));
      expect(action).toHaveProperty('disabled', false);
      fireEvent.click(action);
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: en.timetable.publish.action }));
      await waitFor(() => {
        expect(calls.find((call) => call.route === publishRoute)?.body).toEqual({
          startsOn: '2026-10-19',
          transitionKey: key,
        });
      });
    });

    it('needs no tick for a transition week that matches the load', async () => {
      await openPage({
        path: `/timetable/builder?version=${VERSION.id}&step=publish`,
        extra: {
          [checkRoute]: () =>
            json({
              ...CHECK,
              impact: {
                beforeVersion: { id: uid(950), number: 1 },
                carried: [],
                counts: { created: 0, moved: 0, removed: 0, changed: 0, unchanged: 40 },
                changes: [],
                teachers: [],
                classIds: [],
                roomIds: [],
                vacancies: [],
                transition: {
                  weekStart: '2026-10-19',
                  weekEnd: '2026-10-25',
                  rows: [
                    {
                      unitId: ROW.unit.id,
                      subjectId: ROW.subject.id,
                      before: 1,
                      after: 3,
                      lessonsPerWeek: 4,
                      differs: false,
                    },
                  ],
                  key: null,
                },
                names: {
                  units: [{ id: ROW.unit.id, kind: 'class', name: 'Oxford', grades: [7] }],
                  subjects: [{ id: ROW.subject.id, names: ROW.subject.names }],
                  teachers: [],
                  rooms: [],
                },
              },
            }),
        },
      });
      await waitFor(() => {
        if (document.querySelector('[data-transition] tbody tr') === null)
          throw new Error('No row.');
      });
      expect(
        screen.queryByRole('checkbox', { name: en.timetable.publish.transition.tick }),
      ).toBeNull();
      expect(screen.getByRole('button', { name: en.timetable.publish.action })).toHaveProperty(
        'disabled',
        false,
      );
    });
  });
});

// Task 5.5a-3b-1, pull request #146: what marked a draft out of date, and
// bringing it up to date (06, How surprises are prevented: "the draft must be
// brought up to date before publishing; the differences are shown").
describe('a draft out of date', () => {
  const KEY = 'a'.repeat(64);
  const BRANCH = {
    id: NORTH.id,
    name: 'North',
    address: null,
    phone: null,
    email: null,
    workingWeekdays: [1, 2, 3, 4, 5],
    timeZone: 'Asia/Tashkent',
    goLiveDate: null,
  };
  const CHECK = {
    startsOn: '2026-10-19',
    earliest: '2026-10-11',
    defaultStart: '2026-10-12',
    quarterStarts: [],
    refusals: [{ code: 'draft_out_of_date' }, { code: 'year_quarters' }],
    warnings: [],
    cancelledLessons: [],
    needsTeacher: [],
    impact: null,
    shortenedDays: [],
    unusedKeeps: [],
    chain: null,
    canPublish: false,
  };
  const CALENDAR = {
    id: uid(960),
    kind: 'calendar',
    action: 'calendar_entry.create',
    causedAt: '2026-10-10T08:30:00.000Z',
    record: {
      id: uid(961),
      name: 'Teachers day',
      firstDate: '2026-11-04',
      lastDate: '2026-11-04',
      versionNumber: null,
    },
  };
  const ROOM_GONE = {
    id: uid(962),
    kind: 'rooms',
    action: 'room.edit',
    causedAt: '2026-10-10T09:05:00.000Z',
    record: null,
  };
  const causesRoute = `GET /api/timetable/versions/${VERSION.id}/out-of-date`;
  const bringRoute = `POST /api/timetable/versions/${VERSION.id}/up-to-date`;

  /** The page with the draft out of date until it is brought up to date. */
  async function outOfDate(
    causes: readonly object[],
    options: { session?: ReturnType<typeof sessionOf>; causesFail?: boolean } = {},
  ) {
    let marked = true;
    const calls = await openPage({
      ...(options.session === undefined ? {} : { session: options.session }),
      extra: {
        'GET /api/timetable/versions': () =>
          json({ versions: [{ ...VERSION, outOfDate: marked }], today: '2026-10-10' }),
        'GET /api/setup/branch': () => json(BRANCH),
        [causesRoute]: () =>
          options.causesFail === true
            ? json({ error: { code: 'internal_error', message: 'x', requestId: 'r' } }, 500)
            : json({ causes: marked ? causes : [], key: KEY }),
        [`GET /api/timetable/versions/${VERSION.id}/publish-check`]: () => json(CHECK),
        [bringRoute]: () => {
          marked = false;
          return json({ ...VERSION, outOfDate: false });
        },
      },
    });
    return calls;
  }

  const panel = () =>
    waitFor(() => {
      const found = document.querySelector('[data-out-of-date-panel]');
      if (found === null || found.querySelector('li') === null) throw new Error('No panel yet.');
      return found as HTMLElement;
    });

  it('lists each cause with its record and moment in branch time, counts the check, and brings the draft up to date', async () => {
    const calls = await outOfDate([CALENDAR, ROOM_GONE]);
    const found = await panel();
    expect([...found.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      `${en.audit.actions.calendar_entry.create}: Teachers day, 4 November 2026 · 10 Oct 2026, 13:30`,
      `${en.audit.actions.room.edit}: ${en.timetable.outOfDate.recordGone} · 10 Oct 2026, 14:05`,
    ]);
    await waitFor(() => {
      expect(found.querySelector('[data-check]')?.textContent).toContain(
        en.timetable.outOfDate.check.replace('{{refusals}}', '1').replace('{{warnings}}', '0'),
      );
    });
    fireEvent.click(within(found).getByRole('button', { name: en.timetable.outOfDate.bring }));
    await waitFor(() => {
      expect(document.querySelector('[data-out-of-date-panel]')).toBeNull();
    });
    expect(calls.find((call) => call.route === bringRoute)?.body).toEqual({ key: KEY });
    expect(document.querySelector('[data-out-of-date="true"]')).toBeNull();
  });

  it('switches the button off with its reason while a publish marked the draft', async () => {
    const calls = await outOfDate([
      CALENDAR,
      {
        id: uid(963),
        kind: 'publish',
        action: 'timetable_version.publish',
        causedAt: '2026-10-10T09:10:00.000Z',
        record: null,
      },
    ]);
    const found = await panel();
    expect([...found.querySelectorAll('li')][1]?.textContent).toContain(
      en.timetable.outOfDate.earlierPublish,
    );
    expect(within(found).getByText(en.timetable.outOfDate.byPublish)).toBeTruthy();
    expect(
      within(found).getByRole('button', { name: en.timetable.outOfDate.bring }),
    ).toHaveProperty('disabled', true);
    expect(calls.some((call) => call.route === bringRoute)).toBe(false);
  });

  it('shows the Principal the causes with no button', async () => {
    await outOfDate([CALENDAR], { session: principal() });
    const found = await panel();
    expect(within(found).queryByRole('button', { name: en.timetable.outOfDate.bring })).toBeNull();
  });

  it('says when the causes cannot be read, with a retry', async () => {
    await outOfDate([CALENDAR], { causesFail: true });
    expect(await screen.findByRole('button', { name: en.problems.retry })).toBeTruthy();
    expect(document.querySelector('[data-out-of-date-panel]')).toBeNull();
  });
});
