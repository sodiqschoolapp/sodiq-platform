import type { Attention, AttentionGroup, Role } from '@sodiq/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';

const sessionAs = (role: Role) =>
  sessionOf({ assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }] });

const NOTHING: Attention = { needsTeacher: [], unresolved: [] };

const emptyPage = () => screen.queryByRole('heading', { name: en.home.emptyTitle });

/** Waits until both counters of the Academic Vice Principal's home were asked for. */
async function bothAsked(calls: { route: string }[]): Promise<void> {
  await waitFor(() => {
    expect(calls.some((call) => call.route === 'GET /api/people/students/no-class')).toBe(true);
    expect(calls.some((call) => call.route === 'GET /api/people/relatives/no-valid-phone')).toBe(
      true,
    );
  });
}

// Task 2.7c-1: Home is the empty page of the design system until its tasks fill
// it (pull request #80, decision 3), and the Academic Vice Principal's home is
// never blank (correction 1; .claude/rules/web.md: "Every screen has loading,
// empty and error states").
describe('the home page', () => {
  it('is the empty page with one short line of its kind, no intro and no action', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionAs('teacher')) });
    renderApp('/');
    const title = await screen.findByRole('heading', { name: en.home.emptyTitle });
    const panel = title.closest('div.bg-card');
    expect(panel).not.toBeNull();
    expect(within(panel as HTMLElement).getByText(en.home.teaching).tagName).toBe('P');
    expect(within(panel as HTMLElement).queryByRole('button')).toBeNull();
    expect(within(panel as HTMLElement).queryByRole('link')).toBeNull();
    // Each kind keeps a line of its own, so a test of which home a role gets can fail.
    const lines = Object.values(en.home).filter((value) => typeof value === 'string');
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('shows the Academic Vice Principal the empty page once both counters answered 0', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students/no-class': () => json({ count: 0 }),
      'GET /api/people/relatives/no-valid-phone': () => json({ count: 0 }),
      'GET /api/timetable/attention': () => json(NOTHING),
    });
    renderApp('/');
    await bothAsked(calls);
    expect(await screen.findByRole('heading', { name: en.home.emptyTitle })).toBeDefined();
    expect(screen.getByText(en.home.academic_vice_principal)).toBeDefined();
    expect(screen.queryByRole('region', { name: en.home.noClass.title })).toBeNull();
    expect(screen.queryByRole('region', { name: en.home.noValidPhone.title })).toBeNull();
  });

  it('shows the tiles only when one of them counts something', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students/no-class': () => json({ count: 0 }),
      'GET /api/people/relatives/no-valid-phone': () => json({ count: 4 }),
      'GET /api/timetable/attention': () => json(NOTHING),
    });
    renderApp('/');
    await bothAsked(calls);
    const tile = await screen.findByRole('region', { name: en.home.noValidPhone.title });
    // 24 between the tiles and before the empty page (docs/design-system.md, Spacing).
    expect(tile.parentElement?.className).toContain('gap-6');
    expect(emptyPage()).toBeNull();
    expect(screen.queryByText(en.home.academic_vice_principal)).toBeNull();
  });

  it('shows a failed counter with its retry, not the empty page', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students/no-class': () => json({ count: 0 }),
      'GET /api/people/relatives/no-valid-phone': () => refusal('internal_error', 500),
      'GET /api/timetable/attention': () => json(NOTHING),
    });
    renderApp('/');
    await bothAsked(calls);
    // The failed tile says so, with a retry; the page is not called empty.
    expect(await screen.findByRole('button', { name: en.problems.retry })).toBeDefined();
    expect(emptyPage()).toBeNull();
  });

  it('drops the empty page when a counter fails on a later refetch', async () => {
    let failing = false;
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students/no-class': () =>
        failing ? refusal('internal_error', 500) : json({ count: 0 }),
      'GET /api/people/relatives/no-valid-phone': () => json({ count: 0 }),
      'GET /api/timetable/attention': () => json(NOTHING),
    });
    const { queryClient } = renderApp('/');
    await bothAsked(calls);
    expect(await screen.findByRole('heading', { name: en.home.emptyTitle })).toBeDefined();
    failing = true;
    await queryClient.refetchQueries();
    // The tile says it failed, with a retry, and the page is not called empty under it.
    expect(await screen.findByRole('button', { name: en.problems.retry })).toBeDefined();
    expect(emptyPage()).toBeNull();
  });

  // Task 5.7a-1 (decisions 9 and 10): the lessons that need a teacher and
  // the unresolved ones, each hidden when empty.
  describe('the lessons that need a teacher', () => {
    const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
    const absence: AttentionGroup = {
      cause: 'absence',
      teacher: { id: uid(1), kind: 'person', name: 'Karimova Aziza' },
      absence: { id: uid(2), startsOn: '2026-10-19', endsOn: null },
      lessons: 12,
      firstDate: '2026-10-19',
      lastDate: '2026-11-13',
      suggestPermanent: true,
    };
    const vacancy: AttentionGroup = {
      cause: 'vacancy',
      teacher: { id: uid(3), kind: 'vacancy', name: 'English vacancy 2' },
      absence: null,
      lessons: 1,
      firstDate: '2026-10-12',
      lastDate: '2026-10-12',
      suggestPermanent: false,
    };

    it('lists each cause with its count, its dates and a link to the day, and the suggestion of a permanent change', async () => {
      const calls = fakeApi({
        'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
        'GET /api/people/students/no-class': () => json({ count: 0 }),
        'GET /api/people/relatives/no-valid-phone': () => json({ count: 0 }),
        'GET /api/timetable/attention': () =>
          json({ needsTeacher: [absence], unresolved: [vacancy] } satisfies Attention),
      });
      renderApp('/');
      await bothAsked(calls);
      const needs = await screen.findByRole('region', { name: en.home.needsTeacher.title });
      const row = needs.querySelector('[data-group="absence"]') as HTMLElement;
      expect(within(row).getByText('Karimova Aziza, absent')).toBeDefined();
      expect(within(row).getByText(/12 lessons/)).toBeDefined();
      expect(within(row).getByText(en.home.attention.permanent)).toBeDefined();
      expect(
        within(row).getByRole('link', { name: en.home.attention.open }).getAttribute('href'),
      ).toBe('/timetable/day?date=2026-10-19');
      const unresolved = screen.getByRole('region', { name: en.home.unresolved.title });
      const other = unresolved.querySelector('[data-group="vacancy"]') as HTMLElement;
      expect(within(other).getByText('English vacancy 2 (vacancy)')).toBeDefined();
      expect(within(other).getByText(/1 lesson/)).toBeDefined();
      expect(within(other).queryByText(en.home.attention.permanent)).toBeNull();
      expect(emptyPage()).toBeNull();
    });

    it('names an absence the branch cannot name with a text of its own, never a blank (code review finding 1)', async () => {
      const calls = fakeApi({
        'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
        'GET /api/people/students/no-class': () => json({ count: 0 }),
        'GET /api/people/relatives/no-valid-phone': () => json({ count: 0 }),
        'GET /api/timetable/attention': () =>
          json({
            needsTeacher: [
              {
                ...absence,
                teacher: { ...absence.teacher, name: '' } as AttentionGroup['teacher'],
              },
            ],
            unresolved: [],
          } satisfies Attention),
      });
      renderApp('/');
      await bothAsked(calls);
      const needs = await screen.findByRole('region', { name: en.home.needsTeacher.title });
      const row = needs.querySelector('[data-group="absence"]') as HTMLElement;
      expect(within(row).getByText(en.home.attention.absenceUnnamed)).toBeDefined();
      expect(within(row).queryByText(/^, /)).toBeNull();
    });

    it('hides an empty list and keeps the page empty when all four are 0', async () => {
      const calls = fakeApi({
        'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
        'GET /api/people/students/no-class': () => json({ count: 0 }),
        'GET /api/people/relatives/no-valid-phone': () => json({ count: 0 }),
        'GET /api/timetable/attention': () => json(NOTHING),
      });
      renderApp('/');
      await bothAsked(calls);
      expect(await screen.findByRole('heading', { name: en.home.emptyTitle })).toBeDefined();
      expect(screen.queryByRole('region', { name: en.home.needsTeacher.title })).toBeNull();
      expect(screen.queryByRole('region', { name: en.home.unresolved.title })).toBeNull();
    });

    it('shows a failed list with its retry, not the empty page', async () => {
      const calls = fakeApi({
        'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
        'GET /api/people/students/no-class': () => json({ count: 0 }),
        'GET /api/people/relatives/no-valid-phone': () => json({ count: 0 }),
        'GET /api/timetable/attention': () => refusal('internal_error', 500),
      });
      renderApp('/');
      await bothAsked(calls);
      expect(await screen.findByRole('button', { name: en.problems.retry })).toBeDefined();
      expect(emptyPage()).toBeNull();
    });

    it('asks nothing of the timetable for a Teacher', async () => {
      const calls = fakeApi({ 'GET /api/auth/session': () => json(sessionAs('teacher')) });
      renderApp('/');
      expect(await screen.findByRole('heading', { name: en.home.emptyTitle })).toBeDefined();
      expect(calls.some((call) => call.route === 'GET /api/timetable/attention')).toBe(false);
    });
  });

  it('says so when the account holds no role', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf({ assignments: [] })) });
    renderApp('/');
    expect(await screen.findByText(en.home.noRole)).toBeDefined();
    expect(emptyPage()).not.toBeNull();
  });
});
