import type { Plan, PlanItem, PlanList, PlanRequest, PlanWindows } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const JOURNAL = uid(1);
const Q1 = uid(11);
const Q2 = uid(12);
const LESSONS = [uid(21), uid(22), uid(23)];

const subject = {
  id: uid(5),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  colour: 'blue' as const,
};

const quarters = [
  { id: Q1, number: 1, startDate: '2026-09-01', endDate: '2026-10-31' },
  { id: Q2, number: 2, startDate: '2026-11-09', endDate: '2026-12-28' },
];

// All names are invented.
const LIST: PlanList = {
  years: [{ id: uid(3), startDate: '2026-09-01', endDate: '2027-05-31', closed: false }],
  yearId: uid(3),
  quarters,
  plans: [
    {
      journalId: JOURNAL,
      unit: { kind: 'class', id: uid(6), name: '7 Oxford' },
      subject,
      quarters: [
        { quarterId: Q1, state: 'incomplete', rows: 3, empty: 2, flag: null },
        { quarterId: Q2, state: 'not_started', rows: 8, empty: 8, flag: null },
      ],
    },
    {
      journalId: uid(2),
      unit: { kind: 'group', id: uid(7), name: 'English A' },
      subject,
      quarters: [
        { quarterId: Q1, state: 'complete', rows: 3, empty: 0, flag: null },
        { quarterId: Q2, state: 'no_lessons', rows: 0, empty: 0, flag: null },
      ],
    },
  ],
};

const ITEM: PlanItem = {
  movedFrom: null,
  copiedFrom: null,
  editedAfterLesson: false,
  id: uid(40),
  position: 1,
  topic: 'Fractions',
  objectives: '',
  links: [],
  classworks: [{ id: uid(41), title: 'Exercise 1', description: '' }],
  homeworks: [],
  files: [],
};

const planOf = (canEdit: boolean, item: PlanItem | null = ITEM): Plan => ({
  journalId: JOURNAL,
  unit: { kind: 'class', id: uid(6), name: '7 Oxford' },
  subject,
  quarters,
  quarterId: Q1,
  owner: 'Karimova Nodira',
  ownerStaffId: uid(8),
  canEdit,
  closed: false,
  rows: [
    {
      number: 1,
      lessonId: LESSONS[0] ?? '',
      date: '2026-10-12',
      start: 480,
      end: 525,
      slot: 1,
      held: true,
      started: true,
      open: canEdit ? 'all' : 'none',
      item,
    },
    {
      number: 2,
      lessonId: LESSONS[1] ?? '',
      date: '2026-10-19',
      start: 480,
      end: 525,
      slot: 1,
      held: false,
      started: false,
      open: canEdit ? 'all' : 'none',
      item: null,
    },
    {
      number: 3,
      lessonId: LESSONS[2] ?? '',
      date: '2026-10-19',
      start: 540,
      end: 585,
      slot: 2,
      held: false,
      started: false,
      open: canEdit ? 'all' : 'none',
      item: null,
    },
  ],
  notCovered: [],
  request: null,
  window: { state: 'open', startDate: '2026-09-01', endDate: '2026-10-31' },
  flag: null,
  requests: [],
  sharedWith: [],
  shareCandidates: [],
});

function open(
  input: {
    role?: 'teacher' | 'head_teacher' | 'academic_vice_principal';
    language?: 'en' | 'ru';
    plan?: Plan;
    path?: string;
    save?: () => Response;
    routes?: Record<string, () => Response>;
  } = {},
) {
  const language = input.language ?? 'en';
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(
        sessionOf({
          language,
          assignments: [{ role: input.role ?? 'teacher', branchId: NORTH.id }],
        }),
      ),
    'GET /api/plans': () => json(LIST),
    [`GET /api/plans/journals/${JOURNAL}`]: () => json(input.plan ?? planOf(true)),
    [`POST /api/plans/journals/${JOURNAL}/items`]: () =>
      json({ ...ITEM, id: uid(50), position: 2, topic: 'Decimals', classworks: [] }, 201),
    [`PUT /api/plans/items/${ITEM.id}`]: input.save ?? (() => json(ITEM)),
    ...input.routes,
  });
  renderApp(input.path ?? '/plans', language);
  return calls;
}

const rows = () => [...document.querySelectorAll('tbody tr')];

// Task 7.1a, pull request #212: 09, What a plan contains; edge/lesson-plans.
describe('Lesson plans', () => {
  it('lists the plans of the tab with the state of each quarter', async () => {
    open();
    await screen.findByRole('heading', { name: en.plans.page.title });
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    const [row] = rows();
    expect(row?.textContent).toContain('7 Oxford');
    expect(row?.textContent).toContain('2 rows without a topic');
    expect(row?.textContent).toContain(en.plans.state.not_started);
  });

  it('shows the states in Russian', async () => {
    open({ language: 'ru' });
    await screen.findByRole('heading', { name: ru.plans.page.title });
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(rows()[0]?.textContent).toContain('2 строки без темы');
  });

  it('draws one row per lesson, with the items the server attached', async () => {
    open({ path: `/plans/${JOURNAL}` });
    await screen.findByRole('heading', { name: '7 Oxford · Mathematics' });
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    const [first, second] = rows();
    expect(first?.textContent).toContain('Fractions');
    expect(first?.textContent).toContain('Exercise 1');
    expect(second?.textContent).toContain(en.plans.plan.emptyRow);
  });

  // Task 7.1b, pull request #213: 09, When something else changes.
  it('shows the items not covered, the moved-from mark and the prepared request', async () => {
    const plan = planOf(true);
    const first = plan.rows[0];
    open({
      path: `/plans/${JOURNAL}`,
      plan: {
        ...plan,
        rows: plan.rows.map((row) =>
          row === first && row.item !== null
            ? { ...row, item: { ...row.item, movedFrom: '2026-10-05' } }
            : row,
        ),
        notCovered: [{ ...ITEM, id: uid(60), position: 4, topic: 'Percentages' }],
        request: {
          id: uid(70),
          lessons: [],
          fromDate: '2026-10-19',
          causes: [
            { kind: 'not_covered', onDate: '2026-10-19', items: 1 },
            { kind: 'owner_changed', onDate: '2026-10-26', items: 0 },
          ],
        },
      },
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    expect(rows()[0]?.textContent).toContain('Moved from');
    const notCovered = await screen.findByRole('region', { name: en.plans.plan.notCovered });
    expect(within(notCovered).getByText('Percentages')).toBeTruthy();
    const request = screen.getByRole('region', { name: en.plans.requests.title });
    const causes = within(request)
      .getAllByRole('listitem')
      .map((one) => one.textContent);
    expect(causes).toHaveLength(2);
    expect(causes[0]).toContain('1 item no longer fits');
    expect(causes[1]).toContain('A new teacher takes over');
  });

  it('lets the owner fill an empty row, sending its number and the works without ids', async () => {
    const calls = open({ path: `/plans/${JOURNAL}` });
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    fireEvent.click(screen.getByRole('button', { name: /19 October · lesson 1/ }));
    fireEvent.click(await screen.findByRole('button', { name: en.plans.panel.fill }));
    const form = await screen.findByRole('form', { name: 'Row 2' });
    fireEvent.change(within(form).getByRole('textbox', { name: en.plans.plan.topic }), {
      target: { value: 'Decimals' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.plans.panel.addHomework }));
    fireEvent.change(within(form).getByRole('textbox', { name: 'Homework 1' }), {
      target: { value: 'Read 3.1' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.find((call) => call.route.startsWith('POST /api/plans/'))?.body).toEqual({
        quarterId: Q1,
        position: 2,
        lessonId: LESSONS[1],
        values: {
          topic: 'Decimals',
          objectives: '',
          links: [],
          classworks: [],
          homeworks: [{ title: 'Read 3.1', description: '' }],
        },
      });
    });
  });

  it('adds up to 10 classworks, and says a homework of the first of two lessons is checked today', async () => {
    open({ path: `/plans/${JOURNAL}` });
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    fireEvent.click(screen.getByRole('button', { name: /19 October · lesson 1/ }));
    fireEvent.click(await screen.findByRole('button', { name: en.plans.panel.fill }));
    const form = await screen.findByRole('form', { name: 'Row 2' });
    // The next row is the same day, lesson 2 (edge/lesson-plans, "A double lesson").
    expect(within(form).getByText('Will be checked today in lesson 2.')).toBeDefined();
    for (let added = 0; added < 10; added += 1) {
      fireEvent.click(within(form).getByRole('button', { name: en.plans.panel.addClasswork }));
    }
    expect(within(form).getByRole('textbox', { name: 'Classwork 10' })).toBeDefined();
    expect(within(form).queryByRole('button', { name: en.plans.panel.addClasswork })).toBeNull();
    expect(within(form).getByRole('button', { name: en.plans.panel.addHomework })).toBeDefined();
  });

  it('offers the topic of the previous lesson on the second of two lessons of a day', async () => {
    const plan = planOf(true);
    const second = plan.rows[1];
    if (second !== undefined) second.item = { ...ITEM, id: uid(60), position: 2, topic: 'Ratios' };
    open({ path: `/plans/${JOURNAL}`, plan });
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    fireEvent.click(screen.getByRole('button', { name: /19 October · lesson 2/ }));
    fireEvent.click(await screen.findByRole('button', { name: en.plans.panel.fill }));
    const form = await screen.findByRole('form', { name: 'Row 3' });
    fireEvent.click(within(form).getByRole('button', { name: en.plans.panel.sameTopic }));
    expect(within(form).getByRole('textbox', { name: en.plans.plan.topic })).toHaveProperty(
      'value',
      'Ratios',
    );
  });

  it('shows the value saved meanwhile beside the typed one on a stale save', async () => {
    const calls = open({
      path: `/plans/${JOURNAL}`,
      save: () =>
        json(
          {
            error: {
              code: 'plan_item_stale',
              message: 'x',
              requestId: uid(99),
              details: [
                {
                  path: 'values.topic',
                  code: 'plan_item_stale',
                  message: 'x',
                  storedPlanValue: 'Fractions and decimals',
                },
              ],
            },
          },
          409,
        ),
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    fireEvent.click(screen.getByRole('button', { name: /12 October · lesson 1/ }));
    fireEvent.click(await screen.findByRole('button', { name: en.form.edit }));
    const form = await screen.findByRole('form', { name: 'Row 1' });
    fireEvent.change(within(form).getByRole('textbox', { name: en.plans.plan.topic }), {
      target: { value: 'Fractions again' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await within(form).findByText('Saved meanwhile: Fractions and decimals');
    expect(within(form).getByRole('textbox', { name: en.plans.plan.topic })).toHaveProperty(
      'value',
      'Fractions again',
    );
    const sent = calls.find((call) => call.route.startsWith('PUT /api/plans/items/'));
    expect(sent?.body).toMatchObject({
      base: { topic: 'Fractions', classworks: [{ id: uid(41), title: 'Exercise 1' }] },
      values: { topic: 'Fractions again', classworks: [{ id: uid(41), title: 'Exercise 1' }] },
    });
  });

  it('gives a reader who does not own the plan no way to change it', async () => {
    open({ role: 'head_teacher', path: `/plans/${JOURNAL}`, plan: planOf(false) });
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    fireEvent.click(screen.getByRole('button', { name: /12 October · lesson 1/ }));
    await screen.findByText('Exercise 1', { selector: 'li' });
    expect(screen.queryByRole('button', { name: en.form.edit })).toBeNull();
    expect(screen.queryByRole('button', { name: en.plans.panel.clear })).toBeNull();
    expect(screen.queryByRole('button', { name: en.plans.panel.addFile })).toBeNull();
  });

  // Task 7.1c, pull request #214: 09, What a plan contains ("can share one plan
  // between them ... A shared plan can be separated later"; "A plan can be
  // copied"); When something else changes ("The plan screen shows where each
  // class is").
  describe('shared plans', () => {
    const OTHER = uid(2);
    const shared = (canEdit: boolean): Plan => ({
      ...planOf(canEdit),
      sharedWith: [
        {
          journalId: OTHER,
          unit: { kind: 'class', id: uid(8), name: '7 Princeton' },
          next: { number: 2, date: '2026-10-19', topic: 'Ratios' },
          notCovered: 1,
        },
      ],
    });

    it('shows where each class of a shared plan stands, and separates after a confirm', async () => {
      const calls = open({
        path: `/plans/${JOURNAL}`,
        plan: shared(true),
        routes: { [`POST /api/plans/journals/${JOURNAL}/separate`]: () => json(planOf(true)) },
      });
      const section = await screen.findByRole('region', { name: en.plans.share.sharedTitle });
      const line = section.querySelector(`[data-shared-journal="${OTHER}"]`);
      expect(line?.textContent).toContain('7 Princeton');
      expect(line?.textContent).toContain('Lesson 2, 19 October: Ratios');
      expect(line?.textContent).toContain('1 item not covered');
      fireEvent.click(within(section).getByRole('button', { name: en.plans.share.separate }));
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog.textContent).toContain('Separate 7 Oxford from the shared plan?');
      fireEvent.click(within(dialog).getByRole('button', { name: en.plans.share.separate }));
      await waitFor(() => {
        expect(calls.find((call) => call.route.endsWith('/separate'))?.body).toEqual({
          quarterId: Q1,
        });
      });
    });

    it('gives a reader who does not own the plan no share, separate or copy', async () => {
      open({ path: `/plans/${JOURNAL}`, role: 'head_teacher', plan: shared(false) });
      const section = await screen.findByRole('region', { name: en.plans.share.sharedTitle });
      expect(within(section).queryByRole('button')).toBeNull();
      expect(screen.queryByRole('button', { name: en.plans.share.copy })).toBeNull();
      expect(screen.queryByRole('button', { name: en.plans.share.share })).toBeNull();
    });

    it('shares with a class the server offers, and shows a refusal in the dialog', async () => {
      const calls = open({
        path: `/plans/${JOURNAL}`,
        plan: {
          ...planOf(true),
          shareCandidates: [
            { journalId: OTHER, unit: { kind: 'class', id: uid(8), name: '7 Princeton' } },
          ],
        },
        routes: {
          [`POST /api/plans/journals/${JOURNAL}/share`]: () =>
            json(
              {
                error: {
                  code: 'plan_share_language',
                  message: 'Their languages of instruction differ.',
                  requestId: uid(99),
                },
              },
              409,
            ),
        },
      });
      fireEvent.click(await screen.findByRole('button', { name: en.plans.share.share }));
      const form = await screen.findByRole('form', { name: en.plans.share.shareTitle });
      fireEvent.click(within(form).getByRole('button', { name: en.plans.share.shareSend }));
      expect(await within(form).findByText(en.plans.share.choose)).toBeDefined();
      expect(calls.some((call) => call.route.endsWith('/share'))).toBe(false);
      fireEvent.change(within(form).getByRole('combobox', { name: en.plans.share.shareWith }), {
        target: { value: OTHER },
      });
      fireEvent.click(within(form).getByRole('button', { name: en.plans.share.shareSend }));
      await waitFor(() => {
        expect(calls.find((call) => call.route.endsWith('/share'))?.body).toEqual({
          quarterId: Q1,
          journalId: OTHER,
        });
      });
      await waitFor(() => {
        expect(within(form).getByRole('alert').textContent).toContain(
          en.errors.plan_share_language,
        );
      });
    });

    it('copies the remaining items of a plan of the same subject from the year chosen', async () => {
      const calls = open({
        path: `/plans/${JOURNAL}`,
        routes: { [`POST /api/plans/journals/${JOURNAL}/copy`]: () => json(planOf(true)) },
      });
      fireEvent.click(await screen.findByRole('button', { name: en.plans.share.copy }));
      const form = await screen.findByRole('form', { name: en.plans.share.copyTitle });
      const source = await within(form).findByRole('combobox', { name: en.plans.share.copySource });
      expect([...source.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
        en.plans.share.chooseOption,
        '7 Oxford',
        'English A',
      ]);
      fireEvent.change(source, { target: { value: uid(2) } });
      fireEvent.change(within(form).getByRole('combobox', { name: en.plans.share.copyQuarter }), {
        target: { value: Q2 },
      });
      fireEvent.change(within(form).getByRole('combobox', { name: en.plans.share.copyPart }), {
        target: { value: 'remaining' },
      });
      fireEvent.click(within(form).getByRole('button', { name: en.plans.share.copySend }));
      await waitFor(() => {
        expect(calls.find((call) => call.route.endsWith('/copy'))?.body).toEqual({
          quarterId: Q1,
          source: { journalId: uid(2), quarterId: Q2 },
          part: 'remaining',
        });
      });
      await waitFor(() => {
        expect(screen.queryByRole('form', { name: en.plans.share.copyTitle })).toBeNull();
      });
    });

    it('links the plan a copied item came from', async () => {
      const plan = planOf(true);
      const first = plan.rows[0];
      if (first?.item != null)
        first.item = { ...first.item, copiedFrom: { journalId: OTHER, quarterId: Q2 } };
      open({ path: `/plans/${JOURNAL}`, plan });
      await waitFor(() => {
        expect(rows()).toHaveLength(3);
      });
      fireEvent.click(screen.getByRole('button', { name: /12 October · lesson 1/ }));
      const link = await screen.findByRole('link', { name: en.plans.share.openSource });
      expect(link.getAttribute('href')).toBe(`/plans/${OTHER}?quarter=${Q2}`);
    });
  });
});

// Task 7.2, pull request #215: the plan window and edit requests.
describe('the plan window and edit requests', () => {
  const ended = (plan: Plan): Plan => ({
    ...plan,
    window: { state: 'ended', startDate: '2026-09-01', endDate: '2026-10-10' },
    flag: 'overdue',
    rows: plan.rows.map((row) => ({ ...row, open: 'none' })),
  });

  it('shows the window and the overdue flag, keeps the rows closed, and lets the owner ask to edit', async () => {
    const calls = open({
      path: `/plans/${JOURNAL}`,
      plan: ended(planOf(true)),
      routes: {
        [`POST /api/plans/journals/${JOURNAL}/requests`]: () =>
          json({ ...REQUEST, status: 'sent' }, 201),
      },
    });
    const window = await screen.findByText(/ended/);
    expect(window.closest('[data-plan-window]')?.textContent).toContain(en.plans.flag.overdue);
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    fireEvent.click(rows()[1]?.querySelector('a, button') ?? document.body);
    expect(screen.queryByRole('button', { name: en.plans.panel.fill })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: en.plans.requests.ask }));
    const form = await screen.findByRole('form', { name: en.plans.requests.askTitle });
    fireEvent.change(within(form).getByRole('combobox', { name: en.plans.requests.lastLabel }), {
      target: { value: LESSONS[1] },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.plans.requests.send }));
    expect(await within(form).findByText(en.plans.requests.reasonNeeded)).toBeDefined();
    fireEvent.change(within(form).getByRole('textbox', { name: en.plans.requests.reasonLabel }), {
      target: { value: 'Typos' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.plans.requests.send }));
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/requests'))?.body).toEqual({
        kind: 'text',
        quarterId: Q1,
        lessonIds: [LESSONS[0], LESSONS[1]],
        reason: 'Typos',
      });
    });
  });

  it('asks to confirm the lessons held without a plan, then opens the window', async () => {
    let tries = 0;
    const calls = open({
      role: 'academic_vice_principal',
      path: '/plans/windows',
      routes: {
        'GET /api/plans/windows': () => json(WINDOWS),
        [`PUT /api/plans/windows/${Q2}`]: () => {
          tries += 1;
          return tries === 1
            ? json(
                {
                  error: {
                    code: 'plan_window_confirm',
                    message: 'Lessons will be held without a plan.',
                    requestId: uid(98),
                    details: [
                      {
                        path: 'endDate',
                        code: 'plan_window_confirm',
                        message: 'Lessons will be held without a plan.',
                        lessonsWithoutPlan: 4,
                      },
                    ],
                  },
                },
                409,
              )
            : json(WINDOWS);
        },
      },
    });
    const form = await screen.findByRole('form', {
      name: en.plans.windows.formTitle.replace('{{number}}', '2'),
    });
    fireEvent.click(within(form).getByRole('button', { name: en.plans.windows.open }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain(
      '4 lessons will be held before the window ends without a plan.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: en.plans.windows.save }));
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.route === `PUT /api/plans/windows/${Q2}`)
          .map((call) => call.body),
      ).toEqual([
        { startDate: '2026-11-09', endDate: '2026-12-28' },
        { startDate: '2026-11-09', endDate: '2026-12-28', confirm: true },
      ]);
    });
  });

  it('keeps the typed text in the form when a save arrives after the window, and says to ask', async () => {
    open({
      path: `/plans/${JOURNAL}`,
      save: () =>
        json(
          {
            error: { code: 'plan_window_closed', message: 'x', requestId: uid(97) },
          },
          409,
        ),
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    fireEvent.click(screen.getByRole('button', { name: /12 October · lesson 1/ }));
    fireEvent.click(await screen.findByRole('button', { name: en.form.edit }));
    const form = await screen.findByRole('form', { name: 'Row 1' });
    fireEvent.change(within(form).getByRole('textbox', { name: en.plans.plan.topic }), {
      target: { value: 'Fractions late' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(within(form).getByRole('alert').textContent).toContain(en.errors.plan_window_closed);
    });
    expect(within(form).getByRole('textbox', { name: en.plans.plan.topic })).toHaveProperty(
      'value',
      'Fractions late',
    );
  });

  it('marks an item edited after its lesson', async () => {
    const plan = planOf(false, { ...ITEM, editedAfterLesson: true });
    open({ path: `/plans/${JOURNAL}`, plan });
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    expect(rows()[0]?.textContent).toContain(en.plans.plan.editedAfterLesson);
  });

  it('lists the requests to decide, marks a late one, and approves with the days chosen, a lesson unticked', async () => {
    const calls = open({
      role: 'head_teacher',
      path: '/plans/requests',
      routes: {
        'GET /api/plans/requests': () => json({ requests: [REQUEST], events: [] }),
        [`POST /api/plans/requests/${REQUEST.id}/decide`]: () =>
          json({ ...REQUEST, status: 'approved', canDecide: false }),
      },
    });
    const row = await waitFor(() => {
      const found = document.querySelector('tbody tr');
      if (found === null || !(found.textContent ?? '').includes('7 Oxford'))
        throw new Error('no row');
      return found;
    });
    expect(row.textContent).toContain(en.plans.requests.late);
    fireEvent.click(within(row as HTMLElement).getByText('7 Oxford'));
    fireEvent.click(await screen.findByRole('button', { name: en.plans.requests.decide }));
    const form = await screen.findByRole('form', { name: en.plans.requests.decideTitle });
    fireEvent.change(within(form).getByRole('textbox', { name: en.plans.requests.daysLabel }), {
      target: { value: '3' },
    });
    fireEvent.click(within(form).getAllByRole('checkbox')[0] ?? form);
    fireEvent.change(within(form).getByRole('textbox', { name: en.plans.requests.untickReason }), {
      target: { value: 'Fine as it is' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.plans.requests.approve }));
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/decide'))?.body).toEqual({
        decision: 'approve',
        days: 3,
        untick: [{ lessonId: LESSONS[0], reason: 'Fine as it is' }],
      });
    });
  });
});

const REQUEST: PlanRequest = {
  id: uid(80),
  journalId: JOURNAL,
  quarterId: Q1,
  quarter: 1,
  unit: { kind: 'class', id: uid(6), name: '7 Oxford' },
  subject,
  owner: 'Karimova Nodira',
  kind: 'text',
  status: 'sent',
  fromDate: null,
  lessons: [
    { lessonId: LESSONS[0] ?? '', date: '2026-10-12', approved: true, untickReason: '' },
    { lessonId: LESSONS[1] ?? '', date: '2026-10-19', approved: true, untickReason: '' },
  ],
  reason: 'Typos',
  causes: [],
  sentAt: '2026-10-20T10:00:00.000Z',
  decidedBy: null,
  decidedAt: null,
  decisionReason: '',
  days: null,
  openUntil: null,
  open: false,
  finishedAt: null,
  waitingDays: 3,
  late: true,
  canDecide: true,
};

const WINDOWS: PlanWindows = {
  yearId: uid(3),
  canEdit: true,
  quarters: [
    {
      quarter: quarters[0] ?? { id: Q1, number: 1, startDate: '', endDate: '' },
      published: true,
      window: { startDate: '2026-09-01', endDate: '2026-10-10', state: 'ended', extensions: [] },
    },
    {
      quarter: quarters[1] ?? { id: Q2, number: 2, startDate: '', endDate: '' },
      published: true,
      window: null,
    },
  ],
};
