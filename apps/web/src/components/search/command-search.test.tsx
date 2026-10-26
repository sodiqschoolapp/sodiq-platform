import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { uz } from '@/i18n/locales/uz';
import { schoolDateText } from '@/lib/dates';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf } from '@/testing/render-app';
import { isSearchShortcut } from './command-search';
import { recordSearchQuery } from './search-api';

type Language = 'en' | 'ru' | 'uz';
const TEXTS = { en, ru, uz };

/** The home page, signed in. */
async function openHome(language: Language = 'en', address = '/') {
  fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
  const shell = renderApp(address, language);
  if (address === '/') {
    await screen.findByRole('heading', { name: TEXTS[language].home.title });
  }
  return shell;
}

const pressShortcut = (key = 'k', modifier: 'ctrlKey' | 'metaKey' = 'ctrlKey'): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key,
    [modifier]: true,
    bubbles: true,
    cancelable: true,
  });
  document.body.dispatchEvent(event);
  return event;
};

const dialog = (language: Language = 'en') =>
  screen.findByRole('dialog', { name: TEXTS[language].search.label });

const box = (language: Language = 'en') =>
  screen.getByRole<HTMLInputElement>('combobox', { name: TEXTS[language].search.label });

const optionNames = (): string[] =>
  screen.getAllByRole('option').map((option) => option.textContent ?? '');

const noDialog = () =>
  waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });

// docs/spec/12-ux-standards.md, One pattern everywhere, Search: "Ctrl+K opens a
// search across students, staff, classes, groups and pages" (this task: pages);
// Speed targets: "Results while typing"; Look and feel: "full keyboard use".
describe('the search of pages', () => {
  it('opens with Ctrl+K, takes the key from the browser, puts the focus in the box and lists every page', async () => {
    await openHome();

    const event = pressShortcut();

    expect(event.defaultPrevented).toBe(true);
    await dialog();
    await waitFor(() => {
      expect(document.activeElement).toBe(box());
    });
    // The teacher's "Timetable" opens the timetable views (task 5.9a, decision 2);
    // "Journal" the Journals page (task 6.2); "Lesson plans" the plans (task 7.1a).
    expect(optionNames()).toEqual([
      en.home.title,
      en.menu.timetable,
      en.menu.journal,
      en.menu.plans,
      // Task 9.3a: the rating.
      en.menu.results,
      // Task 8.4: the unlock requests, under "Journal".
      en.journal.unlocks.title,
      en.account.title,
      en.password.titleOwn,
      en.sample.title,
    ]);
    // Task 3.2d: the pages are one group of the list, the records others.
    expect(screen.getByRole('listbox', { name: en.search.label })).toBeDefined();
    expect(screen.getByRole('group', { name: en.search.pages })).toBeDefined();
  });

  // Task 2.7c-3, decision 13: the Branches list is the Super Admin's
  // (`03`, Branch), so the search offers it to no other role of School setup.
  it('offers the Branches list to the Super Admin only', async () => {
    const offered = async (role: 'super_admin' | 'principal' | 'academic_vice_principal') => {
      fakeApi({
        'GET /api/auth/session': () =>
          json(
            sessionOf({
              assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
              branches: [NORTH],
            }),
          ),
        'GET /api/access/branches-without-vice-principal': () => json({ branches: [] }),
      });
      renderApp('/account');
      await screen.findByRole('heading', { name: en.account.title });
      pressShortcut();
      await dialog();
      fireEvent.change(box(), { target: { value: en.setup.branches.title } });
      // None may match: no option at all.
      const names = screen.queryAllByRole('option').map((option) => option.textContent ?? '');
      cleanup();
      return names;
    };
    expect(await offered('super_admin')).toContain(en.setup.branches.title);
    expect(await offered('principal')).not.toContain(en.setup.branches.title);
    expect(await offered('academic_vice_principal')).not.toContain(en.setup.branches.title);
  });

  // Task 3.2a: the Groups list is under the Classes item, for those who view groups.
  it('offers the Groups list to a role with the Classes item that views groups', async () => {
    const offered = async (role: 'academic_vice_principal' | 'teacher') => {
      fakeApi({
        'GET /api/auth/session': () =>
          json(sessionOf({ assignments: [{ role, branchId: NORTH.id }], branches: [NORTH] })),
      });
      renderApp('/account');
      await screen.findByRole('heading', { name: en.account.title });
      pressShortcut();
      await dialog();
      fireEvent.change(box(), { target: { value: en.groups.title } });
      const names = screen.queryAllByRole('option').map((option) => option.textContent ?? '');
      cleanup();
      return names;
    };
    expect(await offered('academic_vice_principal')).toContain(en.groups.title);
    expect(await offered('teacher')).not.toContain(en.groups.title);
  });

  it('opens with Cmd+K too, and closes with Escape with the focus back where it was', async () => {
    await openHome();
    const button = screen.getByRole('button', { name: en.search.label });
    button.focus();

    pressShortcut('K', 'metaKey');
    await dialog();

    fireEvent.keyDown(box(), { key: 'Escape' });
    await noDialog();
    await waitFor(() => {
      expect(document.activeElement).toBe(button);
    });
  });

  it('opens from the button in the top bar and closes with its own button, for a tablet or a phone', async () => {
    await openHome();

    fireEvent.click(screen.getByRole('button', { name: en.search.label }));
    const open = await dialog();

    fireEvent.click(within(open).getByRole('button', { name: en.layout.dismiss }));

    await noDialog();
  });

  it.each([
    ['any case', 'en', 'CHANGE PASS', en.password.titleOwn],
    ['the chosen language', 'ru', 'парол', ru.password.titleOwn],
    [
      'the apostrophe of the keyboard for the letter oʻ',
      'uz',
      "o'zgartirish",
      uz.password.titleOwn,
    ],
    ['two words in any order', 'en', 'password change', en.password.titleOwn],
  ] as const)('finds a page while typing, in %s', async (_name, language, typed, found) => {
    await openHome(language);
    pressShortcut();
    await dialog(language);

    fireEvent.change(box(language), { target: { value: typed } });

    expect(optionNames()).toEqual([found]);
    expect(box(language).getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: found }).id,
    );
  });

  it('says when no page matches', async () => {
    // The default account is a Teacher, who searches the students taught too
    // (task 3.6a, L48): here none.
    fakeApi({
      'GET /api/auth/session': () => json(sessionOf()),
      'GET /api/search/students': () => json({ items: [], more: false, today: '2026-10-10' }),
    });
    renderApp('/', 'en');
    await screen.findByRole('heading', { name: en.home.title });
    pressShortcut();
    await dialog();

    fireEvent.change(box(), { target: { value: 'timetable of the moon' } });

    expect(screen.queryAllByRole('option')).toEqual([]);
    await waitFor(async () => {
      expect(within(await dialog()).getByRole('status').textContent).toBe(en.search.noMatch);
    });
    expect(box().getAttribute('aria-activedescendant')).toBeNull();
    // Enter with nothing to open does nothing.
    fireEvent.keyDown(box(), { key: 'Enter' });
    await dialog();
  });

  it('moves with the arrows and opens the page with Enter', async () => {
    const { router } = await openHome();
    pressShortcut();
    await dialog();

    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    // The teacher's second page is "Timetable" (task 5.9a, decision 2).
    const second = screen.getByRole('option', { name: en.menu.timetable });
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(box().getAttribute('aria-activedescendant')).toBe(second.id);
    // Not past the last page, not before the first.
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(
      screen.getByRole('option', { name: en.sample.title }).getAttribute('aria-selected'),
    ).toBe('true');
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    expect(screen.getByRole('option', { name: en.home.title }).getAttribute('aria-selected')).toBe(
      'true',
    );
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });

    fireEvent.keyDown(box(), { key: 'Enter' });

    await noDialog();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/account/password');
    });
    expect(await screen.findByRole('heading', { name: en.password.titleOwn })).toBeDefined();
  });

  it('opens a page with a click, and the box is empty the next time', async () => {
    const { router } = await openHome();
    pressShortcut();
    await dialog();
    fireEvent.change(box(), { target: { value: 'pat' } });

    fireEvent.click(screen.getByRole('option', { name: en.sample.title }));

    await noDialog();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dev/patterns');
    });
    pressShortcut();
    await dialog();
    expect(box().value).toBe('');
    expect(optionNames()).toHaveLength(9);
  });

  // The side panel of a list closes on Escape unless a dialog took the key (0.8b-1).
  it('leaves an open side panel open when Escape closes the search', async () => {
    await openHome('en', '/dev/patterns?q=abdullayev&open=sample-0002');
    await screen.findByRole('complementary', { name: 'Bekzod Abdullayev' });
    pressShortcut();
    await dialog();

    fireEvent.keyDown(box(), { key: 'Escape' });

    await noDialog();
    expect(screen.getByRole('complementary', { name: 'Bekzod Abdullayev' })).toBeDefined();
  });

  it('is not there before sign-in', async () => {
    fakeApi({ 'GET /api/auth/session': () => refusal('not_signed_in', 401) });
    renderApp('/sign-in');
    await screen.findByRole('heading', { name: en.signIn.title });

    const event = pressShortcut();

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: en.search.label })).toBeNull();
  });
});

describe('the shortcut', () => {
  const press = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

  it('is Ctrl+K or Cmd+K, in either case, also on a Cyrillic layout', () => {
    expect(isSearchShortcut(press({ key: 'k', ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(press({ key: 'K', metaKey: true }))).toBe(true);
    // The same key of a Russian or Cyrillic Uzbek layout.
    expect(isSearchShortcut(press({ key: 'л', code: 'KeyK', ctrlKey: true }))).toBe(true);
  });

  it('is not K alone, nor with Shift or Alt, nor another key', () => {
    expect(isSearchShortcut(press({ key: 'k' }))).toBe(false);
    expect(isSearchShortcut(press({ key: 'k', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSearchShortcut(press({ key: 'k', ctrlKey: true, altKey: true }))).toBe(false);
    expect(isSearchShortcut(press({ key: 'j', ctrlKey: true }))).toBe(false);
  });
});

// Task 3.2d (pull request #94): Ctrl+K over students, staff, classes and
// groups, each kind asked of its own route only when the active role views
// it (decision 4), from the second typed character (decision 7). All names
// are invented.
describe('the search of records', () => {
  const OXFORD = {
    id: '0198b000-0000-7000-8000-000000000001',
    grade: 7,
    name: 'Oxford',
    yearName: '2026–2027',
  };
  const STUDENT = {
    id: '0198b000-0000-7000-8000-000000000002',
    uid: '2600123',
    firstName: 'Gʻulnora',
    lastName: 'Qodirova',
    paternalName: 'Rustamovna',
    class: { grade: 7, name: 'Oxford' },
    status: 'active',
    startsOn: '2026-09-02',
  };
  const PERSON = {
    id: '0198b000-0000-7000-8000-000000000003',
    staffId: 'S-260001',
    firstName: 'Dilshod',
    lastName: 'Karimov',
    status: 'left',
  };
  const GROUP = {
    id: '0198b000-0000-7000-8000-000000000004',
    name: 'Oxford Physics',
    subject: { uz: 'Fizika', ru: 'Физика', en: 'Physics' },
    yearName: '2026–2027',
  };
  const PARENT_ID = '0198b000-0000-7000-8000-000000000005';
  const none = () => json({ items: [], more: false });
  // The students' answer has today (issue #105, H13).
  const noStudents = () => json({ items: [], more: false, today: '2026-10-10' });

  /** A signed-in account of one role in North, at the account page, with the search open. */
  async function searchAs(
    role: 'teacher' | 'tutor' | 'academic_vice_principal' | 'head_tutor',
    answers: Record<string, () => Response>,
    language: Language = 'en',
    roles: readonly ('teacher' | 'tutor' | 'academic_vice_principal' | 'head_tutor')[] = [role],
  ) {
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(
          sessionOf({
            assignments: roles.map((one) => ({ role: one, branchId: NORTH.id })),
            branches: [NORTH],
          }),
        ),
      'GET /api/access/branches-without-vice-principal': () => json({ branches: [] }),
      ...answers,
    });
    const shell = renderApp('/account', language);
    await screen.findByRole('heading', { name: TEXTS[language].account.title });
    pressShortcut();
    await dialog(language);
    return { calls, ...shell };
  }

  const searchCalls = (calls: { route: string; query?: string }[]) =>
    calls.filter((call) => call.route.startsWith('GET /api/search/'));

  const type = (text: string, language: Language = 'en') => {
    fireEvent.change(box(language), { target: { value: text } });
  };

  /** Lets the pause before the records are asked for pass, on the fake clock. */
  async function pastThePause(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
  }

  // Task 3.6a (L48; decision 13 of pull request #118): a Teacher searches the
  // students taught, and never the classes, groups or staff, which the
  // Teacher does not view and the server refuses.
  it('asks a Teacher’s students only, past the pause', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { calls } = await searchAs('teacher', { 'GET /api/search/students': noStudents });
      expect(box().getAttribute('placeholder')).toBe(en.search.placeholderRecords);
      type('Oxford');
      await pastThePause();
      await waitFor(() => {
        expect(within(screen.getByRole('dialog')).getByRole('status').textContent).toBe(
          en.search.noMatch,
        );
      });
      expect(searchCalls(calls).map((call) => `${call.route}${call.query ?? ''}`)).toEqual([
        'GET /api/search/students?q=Oxford',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks nothing for one character past the pause, and asks at the second', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { calls } = await searchAs('tutor', {
        'GET /api/search/students': noStudents,
        'GET /api/search/classes': none,
        'GET /api/search/groups': none,
      });
      type('O');
      await pastThePause();
      expect(searchCalls(calls)).toEqual([]);
      type('Ox');
      await pastThePause();
      await waitFor(() => {
        expect(searchCalls(calls)).toHaveLength(3);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks a Tutor’s students, classes and groups, never staff, from the second character', async () => {
    const { calls } = await searchAs('tutor', {
      'GET /api/search/students': () =>
        json({ items: [STUDENT], more: false, today: '2026-10-10' }),
      'GET /api/search/classes': () => json({ items: [OXFORD], more: false }),
      'GET /api/search/groups': () => json({ items: [GROUP], more: false }),
    });
    expect(box().getAttribute('placeholder')).toBe(en.search.placeholderRecords);
    type('Oxford');

    expect(await screen.findByRole('option', { name: /^7 Oxford/ })).toBeDefined();
    expect(
      searchCalls(calls)
        .map((call) => `${call.route}${call.query ?? ''}`)
        .sort(),
    ).toEqual([
      'GET /api/search/classes?q=Oxford',
      'GET /api/search/groups?q=Oxford',
      'GET /api/search/students?q=Oxford',
    ]);
    const students = screen.getByRole('group', { name: en.search.students });
    // The UID, the class and the status are always on a student's line.
    expect(within(students).getByRole('option').textContent).toBe(
      `Qodirova Gʻulnora · Rustamovna2600123 · 7 Oxford · ${en.people.students.statuses.active}`,
    );
    expect(
      within(screen.getByRole('group', { name: en.search.groups })).getByRole('option').textContent,
    ).toBe('Oxford Physics' + 'Physics · 2026–2027');
    expect(screen.queryByRole('group', { name: en.search.staff })).toBeNull();
  });

  it('asks nothing for one character, nor without a branch (decision 7)', () => {
    expect(recordSearchQuery('classes', NORTH.id, 'O', true).enabled).toBe(false);
    expect(recordSearchQuery('classes', NORTH.id, 'Ox', true).enabled).toBe(true);
    expect(recordSearchQuery('classes', null, 'Ox', true).enabled).toBe(false);
    expect(recordSearchQuery('classes', NORTH.id, 'Ox', false).enabled).toBe(false);
  });

  it('moves with the arrows across the kinds and opens a class in the side panel of its list', async () => {
    const { router } = await searchAs('tutor', {
      'GET /api/search/students': () =>
        json({ items: [STUDENT], more: false, today: '2026-10-10' }),
      'GET /api/search/classes': () => json({ items: [OXFORD], more: false }),
      'GET /api/search/groups': none,
    });
    type('Oxford');
    const student = await screen.findByRole('option', { name: /^Qodirova/ });
    // No page is called Oxford: the student is first.
    expect(student.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    const oxford = screen.getByRole('option', { name: /^7 Oxford/ });
    expect(oxford.getAttribute('aria-selected')).toBe('true');
    expect(box().getAttribute('aria-activedescendant')).toBe(oxford.id);
    fireEvent.keyDown(box(), { key: 'Enter' });

    await noDialog();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/classes');
    });
    expect(router.state.location.search).toEqual({ open: OXFORD.id });
  });

  it('shows a person with the status and opens the list searched from "More on the list"', async () => {
    const { router } = await searchAs('academic_vice_principal', {
      'GET /api/search/students': noStudents,
      'GET /api/search/staff': () => json({ items: [PERSON], more: true }),
      'GET /api/search/classes': none,
      'GET /api/search/groups': none,
    });
    type('Karimov');
    const staff = within(await screen.findByRole('group', { name: en.search.staff }));
    expect(staff.getAllByRole('option').map((option) => option.textContent)).toEqual([
      `Karimov DilshodS-260001 · ${en.people.staff.statuses.left}`,
      en.search.more,
    ]);

    fireEvent.click(staff.getByRole('option', { name: en.search.more }));

    await noDialog();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/people/staff');
    });
    expect(router.state.location.search).toEqual({ q: 'Karimov' });
  });

  // Task 3.5b, H33 of issue #105: parents in Ctrl+K, and the child found by
  // a parent's phone, for the readers of relatives.
  it("lists Parents by name and phone, and a child found by the parent's phone, for the Academic Vice Principal", async () => {
    const { calls, router } = await searchAs('academic_vice_principal', {
      'GET /api/search/students': () =>
        json({
          items: [{ ...STUDENT, relative: 'Qodirov Rustam' }],
          more: false,
          today: '2026-10-10',
        }),
      'GET /api/search/staff': none,
      'GET /api/search/relatives': () =>
        json({
          items: [
            { id: PARENT_ID, fullName: 'Qodirov Rustam', phone: '+998977771122', students: 1 },
          ],
          more: false,
        }),
      'GET /api/search/classes': none,
      'GET /api/search/groups': none,
    });
    type('977771122');
    const parents = await screen.findByRole('group', { name: en.search.relatives });
    expect(within(parents).getByRole('option').textContent).toBe(
      `Qodirov Rustam+998 97 777 11 22 · ${en.search.relativeStudents_one.replace('{{count}}', '1')}`,
    );
    const students = screen.getByRole('group', { name: en.search.students });
    expect(within(students).getByRole('option').textContent).toContain(
      en.search.relativeOf.replace('{{name}}', 'Qodirov Rustam'),
    );
    expect(searchCalls(calls).map((call) => call.route)).toContain('GET /api/search/relatives');
    fireEvent.click(within(parents).getByRole('option'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/people/parents');
    });
    expect(router.state.location.search).toEqual({ open: PARENT_ID });
  });

  it('asks no Parents of a role that does not read relatives', async () => {
    const { calls } = await searchAs('head_tutor', {
      'GET /api/search/students': noStudents,
      'GET /api/search/classes': none,
      'GET /api/search/groups': none,
    });
    type('977771122');
    await waitFor(() => {
      expect(searchCalls(calls).length).toBeGreaterThan(0);
    });
    expect(searchCalls(calls).map((call) => call.route)).not.toContain('GET /api/search/relatives');
  });

  it('says when a kind could not be searched, keeps the pages, and asks again on Retry', async () => {
    let failing = true;
    const { calls } = await searchAs('academic_vice_principal', {
      'GET /api/search/students': () =>
        failing
          ? refusal('internal_error', 500)
          : json({ items: [STUDENT], more: false, today: '2026-10-10' }),
      'GET /api/search/staff': none,
      'GET /api/search/relatives': none,
      'GET /api/search/classes': none,
      'GET /api/search/groups': none,
    });
    type(en.account.title.slice(0, 6));

    expect((await screen.findByRole('alert')).textContent).toBe(en.search.failed);
    expect(screen.getByRole('option', { name: en.account.title })).toBeDefined();
    expect(within(screen.getByRole('dialog')).queryByText(en.search.noMatch)).toBeNull();
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: en.problems.retry }));

    expect(await screen.findByRole('option', { name: /^Qodirova/ })).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      searchCalls(calls).filter((call) => call.route === 'GET /api/search/students'),
    ).toHaveLength(2);
  });

  it('says that nothing matches only when no page and every kind answered with nothing', async () => {
    const { calls } = await searchAs('academic_vice_principal', {
      'GET /api/search/students': noStudents,
      'GET /api/search/staff': none,
      'GET /api/search/relatives': none,
      'GET /api/search/classes': none,
      'GET /api/search/groups': none,
    });
    type('Zzyzx');
    // During the pause the records are not asked for yet: never "Nothing matches" then.
    expect(within(screen.getByRole('dialog')).getByRole('status').textContent).toBe(
      en.search.searching,
    );

    await waitFor(() => {
      expect(within(screen.getByRole('dialog')).getByRole('status').textContent).toBe(
        en.search.noMatch,
      );
    });
    expect(searchCalls(calls)).toHaveLength(5);
    expect(screen.queryAllByRole('option')).toEqual([]);
  });

  it('never says that nothing matches when no page matches but a kind found a record', async () => {
    await searchAs('academic_vice_principal', {
      'GET /api/search/students': () =>
        json({ items: [STUDENT], more: false, today: '2026-10-10' }),
      'GET /api/search/staff': none,
      'GET /api/search/relatives': none,
      'GET /api/search/classes': none,
      'GET /api/search/groups': none,
    });
    type('Qodirova');
    expect(within(screen.getByRole('dialog')).queryByText(en.search.noMatch)).toBeNull();

    expect(await screen.findByRole('option', { name: /^Qodirova/ })).toBeDefined();
    expect(within(screen.getByRole('dialog')).queryByText(en.search.noMatch)).toBeNull();
    expect(within(screen.getByRole('dialog')).queryByRole('status')).toBeNull();
  });

  it('shows the status of a person and of a student with none in force', async () => {
    await searchAs('academic_vice_principal', {
      'GET /api/search/students': () =>
        json({
          items: [{ ...STUDENT, class: null, status: null }],
          more: false,
          today: '2026-10-10',
        }),
      'GET /api/search/staff': () => json({ items: [{ ...PERSON, status: null }], more: false }),
      'GET /api/search/classes': none,
      'GET /api/search/groups': none,
    });
    type('Qodirova');
    const students = within(await screen.findByRole('group', { name: en.search.students }));
    expect(students.getByRole('option').textContent).toBe(
      `Qodirova Gʻulnora · Rustamovna2600123 · ${en.people.students.notStarted}`,
    );
    const staff = within(screen.getByRole('group', { name: en.search.staff }));
    expect(staff.getByRole('option').textContent).toBe(
      `Karimov DilshodS-260001 · ${en.people.staff.notStarted}`,
    );
  });

  // Issue #105, H13: a student whose start date is ahead reads "From <date>".
  it('shows "From <date>" for a student who starts later', async () => {
    await searchAs('academic_vice_principal', {
      'GET /api/search/students': () =>
        json({
          items: [{ ...STUDENT, class: null, startsOn: '2026-10-19' }],
          more: false,
          today: '2026-10-10',
        }),
      'GET /api/search/staff': none,
      'GET /api/search/relatives': none,
      'GET /api/search/classes': none,
      'GET /api/search/groups': none,
    });
    type('Qodirova');
    const students = within(await screen.findByRole('group', { name: en.search.students }));
    expect(students.getByRole('option').textContent).toBe(
      `Qodirova Gʻulnora · Rustamovna2600123 · ${en.people.students.startsFrom.replace('{{date}}', schoolDateText('2026-10-19', 'en'))}`,
    );
  });

  it('speaks Russian, with the subject of a group in Russian', async () => {
    await searchAs(
      'tutor',
      {
        'GET /api/search/students': noStudents,
        'GET /api/search/classes': none,
        'GET /api/search/groups': () => json({ items: [GROUP], more: false }),
      },
      'ru',
    );
    type('Физика', 'ru');

    const groups = within(await screen.findByRole('group', { name: ru.search.groups }));
    expect(groups.getByRole('option').textContent).toBe('Oxford Physics' + 'Физика · 2026–2027');
  });
});
