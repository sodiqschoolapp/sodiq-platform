import type { Attention, AttentionGroup, Role } from '@sodiq/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';

const sessionAs = (role: Role) =>
  sessionOf({ assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }] });

const NOTHING: Attention = {
  needsTeacher: [],
  unresolved: [],
  needsInvigilator: [],
  needsRoom: [],
  examsNeedRoom: [],
};

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
          json({
            needsTeacher: [absence],
            unresolved: [vacancy],
            needsInvigilator: [],
            needsRoom: [],
            examsNeedRoom: [],
          } satisfies Attention),
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
            needsInvigilator: [],
            needsRoom: [],
            examsNeedRoom: [],
          } satisfies Attention),
      });
      renderApp('/');
      await bothAsked(calls);
      const needs = await screen.findByRole('region', { name: en.home.needsTeacher.title });
      const row = needs.querySelector('[data-group="absence"]') as HTMLElement;
      expect(within(row).getByText(en.home.attention.absenceUnnamed)).toBeDefined();
      expect(within(row).queryByText(/^, /)).toBeNull();
    });

    // Task 5.7a-2a: a person inactive, left or locked is a cause of its own.
    it('names the inactive, left and locked causes, in Russian too', async () => {
      const causes: AttentionGroup[] = (['inactive', 'left', 'locked'] as const).map(
        (cause, index) => ({
          ...absence,
          cause,
          teacher: { id: uid(10 + index), kind: 'person', name: `Rahimov Bobur ${String(index)}` },
          absence: null,
          suggestPermanent: false,
        }),
      );
      const open = async (language: 'en' | 'ru') => {
        const calls = fakeApi({
          'GET /api/auth/session': () =>
            json({ ...sessionAs('academic_vice_principal'), language }),
          'GET /api/people/students/no-class': () => json({ count: 0 }),
          'GET /api/people/relatives/no-valid-phone': () => json({ count: 0 }),
          'GET /api/timetable/attention': () =>
            json({
              needsTeacher: causes,
              unresolved: [],
              needsInvigilator: [],
              needsRoom: [],
              examsNeedRoom: [],
            } satisfies Attention),
        });
        renderApp('/', language);
        await bothAsked(calls);
        const title = language === 'ru' ? ru.home.needsTeacher.title : en.home.needsTeacher.title;
        const needs = await screen.findByRole('region', { name: title });
        const name = (cause: string) =>
          needs.querySelector(`[data-group="${cause}"] .font-semibold`)?.textContent;
        return { name };
      };
      const english = await open('en');
      expect(english.name('inactive')).toBe('Rahimov Bobur 0, inactive');
      expect(english.name('left')).toBe('Rahimov Bobur 1, has left');
      expect(english.name('locked')).toBe('Rahimov Bobur 2, account locked');
      cleanup();
      const russian = await open('ru');
      expect(russian.name('locked')).toBe('Rahimov Bobur 2, учётная запись заблокирована');
    });

    // Task 5.7a-2a (decision 9): the exams that need an invigilator.
    it('lists an exam that needs an invigilator with each one away and why, and keeps the page from being empty', async () => {
      const calls = fakeApi({
        'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
        'GET /api/people/students/no-class': () => json({ count: 0 }),
        'GET /api/people/relatives/no-valid-phone': () => json({ count: 0 }),
        'GET /api/timetable/attention': () =>
          json({
            needsTeacher: [],
            unresolved: [],
            needsInvigilator: [
              {
                examId: uid(20),
                title: 'Quarter exam',
                date: '2026-10-19',
                start: 535,
                end: 580,
                invigilators: [
                  { id: uid(21), name: 'Saidova Dilnoza', cause: 'absence' },
                  { id: uid(22), name: '', cause: 'locked' },
                ],
              },
            ],
            needsRoom: [],
            examsNeedRoom: [],
          } satisfies Attention),
      });
      renderApp('/');
      await bothAsked(calls);
      const exams = await screen.findByRole('region', { name: en.home.needsInvigilator.title });
      const row = exams.querySelector(`[data-exam="${uid(20)}"]`) as HTMLElement;
      expect(within(row).getByText(/^Quarter exam · /)).toBeDefined();
      expect(within(row).getByText('Saidova Dilnoza · absent')).toBeDefined();
      expect(
        within(row).getByText(`${en.home.attention.invigilatorUnnamed} · account locked`),
      ).toBeDefined();
      expect(
        within(row).getByRole('link', { name: en.home.attention.openExams }).getAttribute('href'),
      ).toBe('/timetable/exams?date=2026-10-19');
      expect(emptyPage()).toBeNull();
    });

    // Task 5.7a-2b (decisions 2, 7 and 10): the lessons and the exams that need a room.
    it('lists the lessons that need a room by closure and by status, and the exams that need a room', async () => {
      const calls = fakeApi({
        'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
        'GET /api/people/students/no-class': () => json({ count: 0 }),
        'GET /api/people/relatives/no-valid-phone': () => json({ count: 0 }),
        'GET /api/timetable/attention': () =>
          json({
            needsTeacher: [],
            unresolved: [],
            needsInvigilator: [],
            needsRoom: [
              {
                cause: 'closure',
                room: { id: uid(30), name: 'Laboratory 1' },
                closure: { id: uid(31), startsOn: '2026-10-19', endsOn: '2026-10-30' },
                lessons: 3,
                firstDate: '2026-10-19',
                lastDate: '2026-10-26',
              },
              {
                cause: 'under_repair',
                room: { id: uid(32), name: 'Room 12' },
                closure: null,
                lessons: 1,
                firstDate: '2026-10-20',
                lastDate: '2026-10-20',
              },
            ],
            examsNeedRoom: [
              {
                examId: uid(33),
                title: 'Quarter exam',
                date: '2026-10-21',
                start: 535,
                end: 580,
                rooms: [{ id: uid(30), name: 'Laboratory 1', cause: 'closure' }],
              },
            ],
          } satisfies Attention),
      });
      renderApp('/');
      await bothAsked(calls);
      const rooms = await screen.findByRole('region', { name: en.home.needsRoom.title });
      const closure = rooms.querySelector('[data-room-row="closure"]') as HTMLElement;
      expect(within(closure).getByText('Laboratory 1, closed for a period')).toBeDefined();
      expect(
        within(closure)
          .getByRole('link', { name: en.home.attention.openClosure })
          .getAttribute('href'),
      ).toBe(`/timetable/room-closures?open=${uid(31)}`);
      const repair = rooms.querySelector('[data-room-row="under_repair"]') as HTMLElement;
      expect(within(repair).getByText('Room 12, under repair')).toBeDefined();
      expect(
        within(repair).getByRole('link', { name: en.home.attention.open }).getAttribute('href'),
      ).toBe('/timetable/day?date=2026-10-20');
      const exams = await screen.findByRole('region', { name: en.home.examsNeedRoom.title });
      const row = exams.querySelector(`[data-exam="${uid(33)}"]`) as HTMLElement;
      expect(within(row).getByText('Laboratory 1 · closed for a period')).toBeDefined();
      expect(emptyPage()).toBeNull();
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
