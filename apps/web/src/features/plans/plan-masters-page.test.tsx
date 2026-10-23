import type {
  Plan,
  PlanList,
  PlanMaster,
  PlanMasterCompare,
  PlanMasters,
  PlanParallel,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const JOURNAL = uid(1);
const YEAR = uid(3);
const Q1 = uid(11);
const MASTER = uid(30);
const ALL = uid(31);

const subject = {
  id: uid(5),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  colour: 'blue' as const,
};

// All names are invented. Task 7.3, pull request #216: 09, Master plans.
const summary = {
  id: MASTER,
  scope: 'branch' as const,
  subject,
  grade: 7,
  language: 'uz' as const,
  startYear: 2026,
  quarter: 1,
  name: 'Core',
  items: 2,
  archived: false,
  canEdit: true,
};

const MASTERS: PlanMasters = {
  years: [{ id: YEAR, startDate: '2026-09-01', endDate: '2027-05-31' }],
  yearId: YEAR,
  masters: [
    summary,
    { ...summary, id: ALL, scope: 'all', name: 'School', items: 5, canEdit: false },
  ],
  keeps: [{ subject, grades: [7, 8], scopes: ['branch'] }],
};

const MASTER_ONE: PlanMaster = {
  ...summary,
  revision: 4,
  masterItems: [
    {
      id: uid(40),
      position: 1,
      topic: 'Fractions',
      objectives: '',
      links: [],
      classworks: [{ id: uid(41), title: 'Quiz 1', description: '' }],
      homeworks: [],
    },
    {
      id: uid(42),
      position: 2,
      topic: 'Decimals',
      objectives: '',
      links: [],
      classworks: [],
      homeworks: [],
    },
  ],
};

const PLAN: Plan = {
  journalId: JOURNAL,
  unit: { kind: 'class', id: uid(6), name: '7 Oxford' },
  subject,
  quarters: [{ id: Q1, number: 1, startDate: '2026-09-01', endDate: '2026-10-31' }],
  quarterId: Q1,
  owner: 'Karimova Nodira',
  ownerStaffId: uid(8),
  canEdit: true,
  closed: false,
  rows: [],
  notCovered: [],
  request: null,
  window: { state: 'open', startDate: '2026-09-01', endDate: '2026-10-31' },
  flag: null,
  requests: [],
  sharedWith: [],
  shareCandidates: [],
  master: null,
};

const LIST: PlanList = {
  years: [{ id: YEAR, startDate: '2026-09-01', endDate: '2027-05-31', closed: false }],
  yearId: YEAR,
  quarters: PLAN.quarters,
  plans: [
    {
      journalId: JOURNAL,
      unit: PLAN.unit,
      subject,
      quarters: [
        { quarterId: Q1, state: 'incomplete', rows: 3, empty: 1, flag: null, masterUpdated: true },
      ],
    },
  ],
};

function open(input: {
  role?: 'teacher' | 'head_teacher';
  language?: 'en' | 'ru';
  path: string;
  routes?: Record<string, () => Response>;
}) {
  const language = input.language ?? 'en';
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(
        sessionOf({
          language,
          assignments: [
            input.role === 'teacher'
              ? { role: 'teacher', branchId: NORTH.id }
              : { role: 'head_teacher', branchId: NORTH.id },
          ],
        }),
      ),
    'GET /api/plans/masters': () => json(MASTERS),
    [`GET /api/plans/masters/${MASTER}`]: () => json(MASTER_ONE),
    'GET /api/plans': () => json(LIST),
    [`GET /api/plans/journals/${JOURNAL}`]: () => json(PLAN),
    ...input.routes,
  });
  renderApp(input.path, language);
  return calls;
}

const rows = () => [...document.querySelectorAll('tbody tr')];

describe('Master plans', () => {
  it('lists the masters with their scope, and creates one for a subject the reader keeps', async () => {
    const calls = open({
      path: '/plans/masters',
      routes: { 'POST /api/plans/masters': () => json({ ...MASTER_ONE, id: uid(33) }, 201) },
    });
    await screen.findByRole('heading', { name: en.plans.masters.title });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(rows()[1]?.textContent).toContain(en.plans.masters.scopes.all);
    fireEvent.click(
      screen.getAllByRole('button', { name: en.plans.masters.add })[0] as HTMLElement,
    );
    const form = await screen.findByRole('form', { name: en.plans.masters.newTitle });
    fireEvent.change(within(form).getByRole('combobox', { name: en.plans.masters.grade }), {
      target: { value: '8' },
    });
    fireEvent.change(within(form).getByRole('combobox', { name: en.plans.masters.quarter }), {
      target: { value: '2' },
    });
    fireEvent.change(within(form).getByRole('textbox', { name: en.plans.masters.name }), {
      target: { value: 'Level A' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.find((call) => call.route === 'POST /api/plans/masters')?.body).toEqual({
        yearId: YEAR,
        subjectId: subject.id,
        grade: 8,
        language: 'uz',
        quarter: 2,
        name: 'Level A',
        scope: 'branch',
      });
    });
  });

  it('shows the list in Russian, and no Add for a teacher', async () => {
    open({
      path: '/plans/masters',
      role: 'teacher',
      language: 'ru',
      routes: { 'GET /api/plans/masters': () => json({ ...MASTERS, keeps: [] }) },
    });
    await screen.findByRole('heading', { name: ru.plans.masters.title });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(rows()[1]?.textContent).toContain('Все филиалы');
    expect(screen.queryByRole('button', { name: ru.plans.masters.add })).toBeNull();
  });

  it('edits an item of a master with its revision and works without ids, and moves it down', async () => {
    const calls = open({
      path: `/plans/masters/${MASTER}`,
      routes: {
        [`PUT /api/plans/masters/${MASTER}/items/${uid(40)}`]: () => json(MASTER_ONE),
        [`PUT /api/plans/masters/${MASTER}/order`]: () => json(MASTER_ONE),
      },
    });
    await screen.findByRole('heading', { name: 'Core' });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole('button', { name: /Fractions/ }));
    fireEvent.click(await screen.findByRole('button', { name: en.form.edit }));
    const form = await screen.findByRole('form', { name: 'Row 1' });
    fireEvent.change(within(form).getByRole('textbox', { name: en.plans.plan.topic }), {
      target: { value: 'Fractions, part 1' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find(
          (call) =>
            call.route.startsWith('PUT /api/plans/masters/') && call.route.includes('/items/'),
        )?.body,
      ).toEqual({
        revision: 4,
        values: {
          topic: 'Fractions, part 1',
          objectives: '',
          links: [],
          classworks: [{ title: 'Quiz 1', description: '' }],
          homeworks: [],
        },
      });
    });
    fireEvent.click(await screen.findByRole('button', { name: en.plans.master.moveDown }));
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/order'))?.body).toEqual({
        revision: 4,
        order: [uid(42), uid(40)],
      });
    });
  });

  it('copies a master that fits the plan into it', async () => {
    const calls = open({
      path: `/plans/${JOURNAL}`,
      role: 'teacher',
      routes: { [`POST /api/plans/journals/${JOURNAL}/copy`]: () => json(PLAN) },
    });
    fireEvent.click(await screen.findByRole('button', { name: en.plans.masterCopy.open }));
    const form = await screen.findByRole('form', { name: en.plans.masterCopy.title });
    const select = await within(form).findByRole('combobox', { name: en.plans.masterCopy.master });
    fireEvent.change(select, { target: { value: ALL } });
    fireEvent.click(within(form).getByRole('button', { name: en.plans.share.copySend }));
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/copy'))?.body).toEqual({
        quarterId: Q1,
        source: { masterId: ALL },
      });
    });
    expect(calls.find((call) => call.route === 'GET /api/plans/masters')?.query).toContain(
      `journalId=${JOURNAL}`,
    );
  });

  it('shows "master updated" with the comparison side by side, and takes the changes', async () => {
    const compare: PlanMasterCompare = {
      master: { id: MASTER, name: 'Core', scope: 'branch', revision: 6, archived: false },
      rows: [
        {
          change: 'changed',
          masterItemId: uid(40),
          master: {
            topic: 'Fractions, part 1',
            objectives: '',
            links: [],
            classworks: [],
            homeworks: [],
          },
          plan: {
            itemId: uid(50),
            topic: 'Fractions',
            objectives: '',
            links: [],
            classworks: [],
            homeworks: [],
          },
          held: false,
        },
        {
          change: 'removed',
          masterItemId: uid(42),
          master: null,
          plan: {
            itemId: uid(51),
            topic: 'Decimals',
            objectives: '',
            links: [],
            classworks: [],
            homeworks: [],
          },
          held: true,
        },
      ],
    };
    const calls = open({
      path: `/plans/${JOURNAL}`,
      role: 'teacher',
      routes: {
        [`GET /api/plans/journals/${JOURNAL}`]: () =>
          json({ ...PLAN, master: { id: MASTER, name: 'Core', scope: 'branch', updated: true } }),
        [`GET /api/plans/journals/${JOURNAL}/master-compare`]: () => json(compare),
        [`POST /api/plans/journals/${JOURNAL}/master-take`]: () => json(PLAN),
      },
    });
    const section = await screen.findByRole('region', { name: 'Copied from the master "Core"' });
    expect(within(section).getByText(en.plans.updated.mark)).toBeDefined();
    fireEvent.click(within(section).getByRole('button', { name: en.plans.updated.compare }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog.querySelectorAll('tbody tr')).toHaveLength(2);
    });
    const [changed, removed] = [...dialog.querySelectorAll('tbody tr')];
    expect(changed?.textContent).toContain('Fractions, part 1');
    expect(changed?.textContent).toContain('Fractions');
    expect(removed?.textContent).toContain(en.plans.updated.held);
    fireEvent.click(within(dialog).getByRole('button', { name: en.plans.updated.take }));
    // Neither take nor keep can be undone: it asks first.
    const sure = await screen.findByRole('alertdialog');
    expect(sure.textContent).toContain(en.plans.updated.takeTitle);
    expect(calls.some((call) => call.route.endsWith('/master-take'))).toBe(false);
    fireEvent.click(within(sure).getByRole('button', { name: en.plans.updated.take }));
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/master-take'))?.body).toEqual({
        quarterId: Q1,
        revision: 6,
      });
    });
  });

  it('marks a plan whose master changed in the plans list', async () => {
    open({ path: '/plans', role: 'teacher' });
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(rows()[0]?.textContent).toContain(en.plans.updated.mark);
  });

  it('shows the parallel classes side by side with the lesson each has reached', async () => {
    const parallel: PlanParallel = {
      units: [
        {
          journalId: JOURNAL,
          unit: PLAN.unit,
          grades: [7],
          rows: 8,
          reached: { number: 3, date: '2026-09-21', topic: 'Percent' },
          next: { number: 4, date: '2026-09-28', topic: null },
        },
        {
          journalId: uid(2),
          unit: { kind: 'group', id: uid(7), name: 'Maths 7-8' },
          grades: [7, 8],
          rows: 0,
          reached: null,
          next: null,
        },
      ],
    };
    const calls = open({
      path: '/plans/parallel',
      routes: { 'GET /api/plans/parallel': () => json(parallel) },
    });
    await screen.findByRole('heading', { name: en.plans.parallel.title });
    const oxford = await screen.findByRole('region', { name: '7 Oxford' });
    expect(oxford.querySelector('[data-reached]')?.textContent).toContain(
      'lesson 3, 21 September: Percent',
    );
    expect(oxford.querySelector('[data-next]')?.textContent).toContain(
      'lesson 4, 28 September: no topic',
    );
    const group = screen.getByRole('region', { name: 'Maths 7-8' });
    expect(group.querySelector('[data-reached]')?.textContent).toContain(
      en.plans.parallel.notStarted,
    );
    expect(calls.find((call) => call.route === 'GET /api/plans/parallel')?.query).toContain(
      `subjectId=${subject.id}`,
    );
  });
});
