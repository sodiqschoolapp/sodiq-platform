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
  });
  renderApp(options.path ?? '/timetable/builder', 'en');
  await screen.findByRole('heading', { name: en.timetable.builder.title });
  return calls;
}

const stepMark = (key: string): string =>
  document.querySelector(`[data-step="${key}"]`)?.textContent ?? '';

// docs/spec/06-timetable.md, Building a timetable; task 5.3a, pull request #127.
describe('the draft builder', () => {
  it('marks each step from the readiness, steps 6 and 8 as not yet available, and the grid open (5.4a)', async () => {
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
    for (const key of ['generate', 'publish']) {
      expect(stepMark(key)).toContain(en.timetable.builder.later);
      expect(
        document.querySelector<HTMLButtonElement>(`[data-step="${key}"] button`)?.disabled,
      ).toBe(true);
    }
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
});
