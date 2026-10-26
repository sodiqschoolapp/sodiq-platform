import {
  HOME_KIND,
  MENU,
  MENU_ITEMS,
  PERMISSIONS,
  ROLES,
  visibleMenu,
  type Role,
} from '@sodiq/shared';
import { MutationObserver } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
import { getBranchInUse } from '@/api/branch-in-use';
import { en } from '@/i18n/locales/en';
import {
  fakeApi,
  json,
  nothing,
  NORTH,
  refusal,
  renderApp,
  SOUTH,
  sessionOf,
} from '@/testing/render-app';
import { BRANCH_STORAGE_KEY, ROLE_STORAGE_KEY } from './view-store';

const roleButton = (role: Role) => en.switcher.roleButton.replace('{{role}}', en.roles[role]);
const ROLE_BUTTON = new RegExp(`^${en.switcher.rolePrefix}`);

// The items a principal finds under "More" (the fifth to the eighth of its row).
const { MORE_OF_PRINCIPAL } = vi.hoisted(() => ({
  MORE_OF_PRINCIPAL: new Set(['timetable', 'journal', 'results', 'plans']),
}));

// Every page is built here, so that the menu shows the whole row of the table.
vi.mock('./menu-pages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./menu-pages')>();
  const { MENU_ITEMS } = await import('@sodiq/shared');
  const pages = Object.fromEntries(
    MENU_ITEMS.map((item) => [
      item,
      // Home at its own address, the others elsewhere, so one item is the current
      // page; the items a principal finds under "More" lead to the account page.
      {
        titleKey: `menu.${item}`,
        shortKey: `menu.short.${item}`,
        to: item === 'home' ? '/' : MORE_OF_PRINCIPAL.has(item) ? '/account' : '/setup',
        icon: actual.MENU_ICONS[item],
      },
    ]),
  );
  return { ...actual, BUILT_PAGES: pages, BUILT_ITEMS: new Set(MENU_ITEMS) };
});

/**
 * The roles whose menu row has "Timetable" without the area `timetable` (task
 * 3.4a, decision 4): since task 5.9a (decision 2) their item opens the views.
 */
const VIEWS_ONLY: ReadonlySet<Role> = new Set([
  'spiritual_vice_principal',
  'head_tutor',
  'tutor',
  'senior_head_teacher',
  'head_teacher',
  'teacher',
]);

/** The teaching home of task 5.9b with nothing in the week. */
const NO_LESSONS = {
  today: '2026-10-19',
  week: { from: '2026-10-19', to: '2026-10-25' },
  branches: [],
  days: [],
  lessons: [],
  exams: [],
  busy: [],
};

/** The home kinds that show the person's own lessons since task 5.9b, not the empty page. */
const TEACHING_HOME: ReadonlySet<string> = new Set(['teaching', 'tutor']);

const heading = (name: string) => screen.findByRole('heading', { name });
const side = () => within(screen.getByRole('navigation', { name: en.layout.menu }));

const held = (role: Role) => ({
  role,
  branchId: role === 'super_admin' || role === 'senior_head_teacher' ? null : NORTH.id,
});

// docs/spec/02-roles-and-access.md: "a left menu that shows only what the role
// can use"; docs/spec/08: home pages by role. All 15 roles.
describe('the menu and the home page of each role', () => {
  it.each(ROLES)('shows the row of the table and the first screen of %s', async (role) => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionOf({ assignments: [held(role)] })),
      // The two counters of the Academic Vice Principal's home, both 0: the
      // page is then the empty page with the kind's own line (pull request
      // #80, correction 1).
      'GET /api/timetable/attention': () =>
        json({
          needsTeacher: [],
          unresolved: [],
          needsInvigilator: [],
          needsRoom: [],
          examsNeedRoom: [],
        }),
      'GET /api/people/students/no-class': () => json({ count: 0 }),
      'GET /api/people/relatives/no-valid-phone': () => json({ count: 0 }),
      'GET /api/timetable/home': () => json(NO_LESSONS),
    });

    renderApp('/');

    await heading(en.home.title);
    const links = side().getAllByRole('link');
    // The row of the table. "Timetable" of the six roles that see no draft
    // opens the timetable views (task 5.9a, decision 2): the area `timetable`
    // (task 3.4a, decision 4) is the Super Admin's, the Principal's and the
    // Academic Vice Principal's.
    // Task 9.3a: "Results" opens for a reader of the rating or the closing checklist; task 9.4a
    // adds the early-warning list, so the Vice Principal for Spiritual and Moral Education sees
    // it too, and it opens the early-warning list for that role.
    expect(links.map((link) => link.textContent)).toEqual(
      visibleMenu(role, new Set(MENU_ITEMS), PERMISSIONS).map((item) => en.menu[item]),
    );
    expect(visibleMenu(role, new Set(MENU_ITEMS), PERMISSIONS)).toEqual(MENU[role]);
    if (role === 'spiritual_vice_principal') {
      expect(links.find((link) => link.textContent === en.menu.results)?.getAttribute('href')).toBe(
        '/results/early-warning',
      );
    }
    const timetable = links.find((link) => link.textContent === en.menu.timetable);
    // The pages of this test stand in for the built ones; the views of a role
    // with no draft are its own address.
    if (VIEWS_ONLY.has(role)) {
      expect(timetable?.getAttribute('href')).toBe('/timetable/views');
    }
    // The current page is marked for a screen reader as well as by its fill
    // (docs/design-system.md, Layout shell, Menu; pull request #61, decision 9).
    expect(links.filter((link) => link.getAttribute('aria-current') === 'page')).toEqual([
      links[0],
    ]);
    // The own account page (task 0.8d) is reached from the person at the foot of the menu
    // (pull request #61, decision 7).
    expect(screen.getByRole('button', { name: en.layout.account })).toBeDefined();
    if (TEACHING_HOME.has(HOME_KIND[role])) {
      // Task 5.9b: the own lessons of every branch, here none.
      expect(await screen.findByText(en.home.lessons.noToday)).toBeDefined();
      expect(screen.queryByRole('heading', { name: en.home.emptyTitle })).toBeNull();
    } else {
      // Home is the empty page of the design system until its tasks fill it,
      // with one short line of its own per kind (pull request #80, decision 3).
      const line = await screen.findByText(en.home[HOME_KIND[role]]);
      expect(line.tagName).toBe('P');
      expect(screen.getByRole('heading', { name: en.home.emptyTitle })).toBeDefined();
    }
    expect(screen.queryByRole('button', { name: ROLE_BUTTON })).toBeNull();
  });
});

describe('the role switcher', () => {
  const twoRoles = () =>
    fakeApi({
      'GET /api/auth/session': () =>
        json(
          sessionOf({
            assignments: [held('tutor'), held('teacher')],
          }),
        ),
      'GET /api/timetable/home': () => json(NO_LESSONS),
    });

  it('starts with the first role of the table and changes menu and home without a call', async () => {
    const calls = twoRoles();
    renderApp('/');
    await heading(en.home.title);
    // Both roles show the own lessons (task 5.9b): one query, asked once.
    expect(await screen.findByText(en.home.lessons.noToday)).toBeDefined();
    // Task 3.1c (decision 4 of pull request #90): the Tutor's own classes.
    expect(side().queryByText(en.menu.classes)).not.toBeNull();
    const before = calls.length;

    // Issue #105, H11b: the button says what the choice changes; its menu says the rights stay.
    const button = screen.getByRole('button', { name: roleButton('tutor') });
    expect(button.textContent).toBe(`${en.switcher.rolePrefix}${en.roles.tutor}`);
    fireEvent.click(button);
    expect(await screen.findByText(en.switcher.roleHint)).toBeDefined();
    expect(
      screen
        .getAllByRole('menuitemradio')
        .map((item) => [item.textContent, item.getAttribute('aria-checked')]),
    ).toEqual([
      [en.roles.tutor, 'true'],
      [en.roles.teacher, 'false'],
    ]);
    fireEvent.click(screen.getByRole('menuitemradio', { name: en.roles.teacher }));

    expect(await screen.findByRole('button', { name: roleButton('teacher') })).toBeDefined();
    expect(side().queryByText(en.menu.plans)).not.toBeNull();
    expect(side().queryByText(en.menu.people)).toBeNull();
    expect(side().queryByText(en.menu.classes)).toBeNull();
    expect(calls).toHaveLength(before);
    expect(window.sessionStorage.getItem(ROLE_STORAGE_KEY)).toBe('teacher');
    expect(screen.getByRole('button', { name: roleButton('teacher') })).toBeDefined();
  });

  it('is not shown for one role', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
    renderApp('/');
    await heading(en.home.title);

    expect(screen.queryByRole('button', { name: ROLE_BUTTON })).toBeNull();
  });

  it('falls back to the default when the stored role is not held', async () => {
    window.sessionStorage.setItem(ROLE_STORAGE_KEY, 'principal');
    window.sessionStorage.setItem(BRANCH_STORAGE_KEY, SOUTH.id);
    twoRoles();

    renderApp('/');

    expect(await screen.findByRole('button', { name: roleButton('tutor') })).toBeDefined();
  });

  it('keeps the choice of the tab across a change of page', async () => {
    twoRoles();
    window.sessionStorage.setItem(ROLE_STORAGE_KEY, 'teacher');

    renderApp('/');

    expect(await screen.findByRole('button', { name: roleButton('teacher') })).toBeDefined();
  });
});

describe('the branch switcher', () => {
  it('is shown with several branches and puts the branch in the header of every call', async () => {
    const seen: (string | null)[] = [];
    fakeApi({
      'GET /api/auth/session': () => {
        seen.push(getBranchInUse());
        return json(
          sessionOf({
            assignments: [
              { role: 'teacher', branchId: NORTH.id },
              { role: 'teacher', branchId: SOUTH.id },
            ],
            branches: [NORTH, SOUTH],
          }),
        );
      },
    });
    renderApp('/');
    await heading(en.home.title);
    const chooser = screen.getByLabelText(en.switcher.branch);
    expect((chooser as HTMLSelectElement).value).toBe(NORTH.id);

    fireEvent.change(chooser, { target: { value: SOUTH.id } });

    await waitFor(() => {
      expect(getBranchInUse()).toBe(SOUTH.id);
    });
    expect(window.sessionStorage.getItem(BRANCH_STORAGE_KEY)).toBe(SOUTH.id);
  });

  it('is not shown with one branch', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
    renderApp('/');
    await heading(en.home.title);

    expect(screen.queryByLabelText(en.switcher.branch)).toBeNull();
  });

  it('gives a Super Admin every branch', async () => {
    fakeApi({
      'GET /api/auth/session': () =>
        json(
          sessionOf({
            assignments: [{ role: 'super_admin', branchId: null }],
            branches: [NORTH, SOUTH],
          }),
        ),
    });
    renderApp('/');
    await heading(en.home.title);

    const chooser = screen.getByLabelText(en.switcher.branch);

    expect(
      within(chooser)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['North', 'South']);
  });
});

describe('sign-out', () => {
  it('clears the role and the branch of the tab', async () => {
    window.sessionStorage.setItem(ROLE_STORAGE_KEY, 'teacher');
    window.sessionStorage.setItem(BRANCH_STORAGE_KEY, NORTH.id);
    fakeApi({
      'GET /api/auth/session': () => json(sessionOf()),
      'POST /api/auth/sign-out': nothing,
    });
    renderApp('/');
    await heading(en.home.title);

    fireEvent.click(screen.getByRole('button', { name: en.layout.signOut }));

    await heading(en.signIn.title);
    expect(window.sessionStorage.getItem(ROLE_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(BRANCH_STORAGE_KEY)).toBeNull();
  });
});

describe('a session that ended', () => {
  it('clears the role and the branch of the tab, so that the next person does not inherit them', async () => {
    window.sessionStorage.setItem(ROLE_STORAGE_KEY, 'teacher');
    window.sessionStorage.setItem(BRANCH_STORAGE_KEY, NORTH.id);
    fakeApi({
      'GET /api/auth/session': () => json(sessionOf()),
      'GET /api/auth/sessions': () => refusal('not_signed_in', 401),
    });
    const shell = renderApp('/');
    await heading(en.home.title);

    // Any call that the server refuses because the session ended.
    await new MutationObserver(shell.queryClient, {
      mutationFn: () => answerOf(api.GET('/api/auth/sessions')),
    })
      .mutate()
      .catch(() => undefined);

    await heading(en.signIn.title);
    expect(window.sessionStorage.getItem(ROLE_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(BRANCH_STORAGE_KEY)).toBeNull();
  });
});

describe('a session found to be over', () => {
  it('clears a role and a branch left in the tab when the session is read as ended', async () => {
    window.sessionStorage.setItem(ROLE_STORAGE_KEY, 'teacher');
    window.sessionStorage.setItem(BRANCH_STORAGE_KEY, NORTH.id);
    fakeApi({ 'GET /api/auth/session': () => refusal('not_signed_in', 401) });

    renderApp('/');

    await heading(en.signIn.title);
    expect(window.sessionStorage.getItem(ROLE_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(BRANCH_STORAGE_KEY)).toBeNull();
  });

  it('does not keep a choice made before the next person signs in', async () => {
    let signedIn = false;
    fakeApi({
      'GET /api/auth/session': () => (signedIn ? json(sessionOf()) : refusal('not_signed_in', 401)),
      'POST /api/auth/sign-in': () => {
        signedIn = true;
        return json(sessionOf());
      },
    });
    const shell = renderApp('/sign-in');
    await heading(en.signIn.title);
    shell.view.chooseRole('teacher');

    fireEvent.change(screen.getByLabelText(en.signIn.login), { target: { value: 'a.person' } });
    fireEvent.change(screen.getByLabelText(en.signIn.password), {
      target: { value: 'a-password-of-ten' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.signIn.submit }));

    await heading(en.home.title);
    expect(window.sessionStorage.getItem(ROLE_STORAGE_KEY)).toBeNull();
  });
});

// docs/design-system.md, Layout shell, Phone width; This app, Phone tab bar:
// "The role's first four menu items and \"More\"".
describe('the tab bar on a phone', () => {
  it('shows the first four items and "More" with the rest, the own entries and sign-out', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionOf({ assignments: [held('principal')] })),
    });
    renderApp('/');
    await heading(en.home.title);

    const bar = within(screen.getByRole('navigation', { name: en.menu.tabs }));
    const items = MENU.principal.map((item) => en.menu[item]);
    // Issue #105, H16: the short labels on the bar, the full names as the tabs' names.
    expect(bar.getAllByRole('link').map((link) => link.textContent)).toEqual(
      MENU.principal.slice(0, 4).map((item) => en.menu.short[item]),
    );
    expect(bar.getAllByRole('link').map((link) => link.getAttribute('aria-label'))).toEqual(
      items.slice(0, 4),
    );
    expect(bar.getAllByRole('link')[0]?.getAttribute('aria-current')).toBe('page');

    fireEvent.click(bar.getByRole('button', { name: en.menu.more }));

    const dialog = await screen.findByRole('dialog', { name: en.menu.more });
    const rest = within(within(dialog).getByRole('navigation', { name: en.menu.moreItems }));
    expect(rest.getAllByRole('link').map((link) => link.textContent)).toEqual(items.slice(4));
    expect(within(dialog).getByRole('button', { name: en.layout.signOut })).toBeDefined();
    fireEvent.click(within(dialog).getByRole('link', { name: en.account.title }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: en.menu.more })).toBeNull();
    });
  });
});

describe('the "More" tab', () => {
  it('is the current one on a page reached through it', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionOf({ assignments: [held('principal')] })),
      'GET /api/auth/sessions': () => json({ sessions: [] }),
      'GET /api/auth/trusted-devices': () => json({ devices: [] }),
      'GET /api/auth/second-step': () => json({ on: false, required: false, recoveryCodesLeft: 0 }),
    });
    renderApp('/account');
    await heading(en.account.title);

    const bar = within(screen.getByRole('navigation', { name: en.menu.tabs }));
    expect(bar.getByRole('button', { name: en.menu.more }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(bar.getAllByRole('link').every((link) => !link.hasAttribute('aria-current'))).toBe(true);
  });
});
