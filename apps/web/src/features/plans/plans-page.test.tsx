import type { Plan, PlanItem, PlanList } from '@sodiq/shared';
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
        { quarterId: Q1, state: 'incomplete', rows: 3, empty: 2 },
        { quarterId: Q2, state: 'not_started', rows: 8, empty: 8 },
      ],
    },
    {
      journalId: uid(2),
      unit: { kind: 'group', id: uid(7), name: 'English A' },
      subject,
      quarters: [
        { quarterId: Q1, state: 'complete', rows: 3, empty: 0 },
        { quarterId: Q2, state: 'no_lessons', rows: 0, empty: 0 },
      ],
    },
  ],
};

const ITEM: PlanItem = {
  movedFrom: null,
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
      item: null,
    },
  ],
  notCovered: [],
  request: null,
});

function open(
  input: {
    role?: 'teacher' | 'head_teacher';
    language?: 'en' | 'ru';
    plan?: Plan;
    path?: string;
    save?: () => Response;
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
    const request = screen.getByRole('region', { name: en.plans.plan.request.title });
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
});
