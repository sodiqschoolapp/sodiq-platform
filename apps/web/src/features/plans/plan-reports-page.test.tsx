import type { PlanCompleteness, PlanMinimums, PlanProgress } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const Q1 = uid(11);
const quarters = [{ id: Q1, number: 1, startDate: '2026-09-01', endDate: '2026-10-31' }];
const subject = {
  id: uid(5),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  colour: 'blue' as const,
};
const unit = { kind: 'class' as const, id: uid(6), name: '7 Oxford' };
// All names are invented.
const teacher = { id: uid(7), name: 'Karimova Aziza' };
const department = { id: uid(8), names: { uz: 'STEAM', ru: 'STEAM', en: 'STEAM' } };

const counts = {
  plans: 2,
  complete: 1,
  incomplete: 1,
  noTopic: 4,
  notStarted: 0,
  overdue: 1,
  windowNotOpened: 0,
  belowMinimum: 1,
  percentComplete: 50,
};

const COMPLETENESS: PlanCompleteness = {
  quarters,
  quarterId: Q1,
  departments: [department],
  plans: [
    {
      journalId: uid(1),
      unit,
      subject,
      teacher,
      department,
      state: 'incomplete',
      rows: 9,
      empty: 4,
      flag: 'overdue',
      belowMinimum: { classworks: 1, homeworks: 0, minimumClassworks: 2, minimumHomeworks: 1 },
    },
  ],
  teachers: [{ teacher, counts }],
  byDepartment: [{ department, counts }],
  branch: counts,
};

const PROGRESS: PlanProgress = {
  quarters,
  quarterId: Q1,
  departments: [department],
  plans: [
    {
      journalId: uid(1),
      unit,
      subject,
      teacher,
      department,
      rows: 9,
      planned: 7,
      held: 5,
      delivered: 4,
      notCovered: 1,
      behind: true,
    },
  ],
  teachers: [{ teacher, plannedWorks: 8, notHeld: 2, percentNotHeld: 25 }],
};

const MINIMUMS: PlanMinimums = {
  subjects: [{ subject, classworks: 0, homeworks: 0, version: null }],
  canEdit: true,
};

function open(path: string, routes: Record<string, (body: unknown) => Response> = {}) {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(sessionOf({ assignments: [{ role: 'academic_vice_principal', branchId: NORTH.id }] })),
    'GET /api/plans/reports/completeness': () => json(COMPLETENESS),
    'GET /api/plans/reports/progress': () => json(PROGRESS),
    ...routes,
  });
  renderApp(path);
  return calls;
}

// docs/spec/09-lesson-plans.md, Reports; docs/spec/edge-cases/lesson-plans.md, "A plan has 40
// topics and not one graded work"; task 8.8.
describe('the plan reports', () => {
  it('shows completeness per teacher with the counts and the percent the server gives', async () => {
    open('/plans/reports');
    await screen.findByRole('heading', { name: en.plans.reports.title });
    const rows = await waitFor(() => {
      const found = document.querySelectorAll('tbody tr');
      expect(found.length).toBe(1);
      return found;
    });
    expect(rows[0]?.textContent).toContain('Karimova Aziza');
    expect(rows[0]?.textContent).toContain('50%');
    expect(document.querySelector('[data-branch-counts]')?.textContent).toBe(
      'Branch: 1 of 2 plans complete (50%)',
    );
  });

  it('shows each plan with its warnings, and progress with the share of "not held"', async () => {
    open('/plans/reports?part=plans');
    const row = await waitFor(() => {
      const found = document.querySelector('tbody tr');
      expect(found?.textContent).toContain('7 Oxford');
      return found;
    });
    expect(row?.textContent).toContain(en.plans.flag.overdue);
    expect(row?.textContent).toContain(en.plans.minimum.below);
    fireEvent.click(screen.getByRole('radio', { name: en.plans.reports.progressTitle }));
    fireEvent.click(await screen.findByRole('radio', { name: en.plans.reports.byTeacher }));
    await waitFor(() => {
      expect(document.querySelector('tbody tr')?.textContent).toContain('25%');
    });
  });

  it('exports the report shown to Excel', async () => {
    const calls = open('/plans/reports', {
      'POST /api/plans/reports/export': () =>
        new Response(new Blob(['xlsx']), {
          status: 200,
          headers: {
            'Content-Disposition': 'attachment; filename="plan-report-completeness.xlsx"',
          },
        }),
    });
    await waitFor(() => {
      expect(document.querySelectorAll('tbody tr').length).toBe(1);
    });
    fireEvent.click(screen.getByRole('button', { name: en.plans.reports.excel }));
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.route === 'POST /api/plans/reports/export')
          .map((call) => call.body),
      ).toEqual([{ report: 'completeness' }]);
    });
  });
});

describe('the minimum works of a subject', () => {
  it('sets a minimum on the version read', async () => {
    const calls = open('/plans/windows', {
      'GET /api/plans/windows': () =>
        json({ years: [], yearId: null, quarters: [], canEdit: true }),
      'GET /api/plans/minimums': () => json(MINIMUMS),
      'PUT /api/plans/minimums': () =>
        json({ ...MINIMUMS, subjects: [{ subject, classworks: 2, homeworks: 1, version: 1 }] }),
    });
    const row = await waitFor(() => {
      const found = document.querySelector(`[data-minimum="${subject.id}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.change(within(row).getByLabelText(en.plans.minimum.classworks), {
      target: { value: '2' },
    });
    fireEvent.change(within(row).getByLabelText(en.plans.minimum.homeworks), {
      target: { value: '1' },
    });
    fireEvent.click(within(row).getByRole('button', { name: en.plans.minimum.save }));
    await waitFor(() => {
      expect(
        calls.filter((call) => call.route === 'PUT /api/plans/minimums').map((call) => call.body),
      ).toEqual([{ subjectId: subject.id, classworks: 2, homeworks: 1, version: null }]);
    });
  });
});
