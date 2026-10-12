import { HOME_KIND, MENU, ROLES, type Role } from '@sodiq/shared';
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

// Every page is built here, so that the menu shows the whole row of the table.
vi.mock('./menu-pages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./menu-pages')>();
  const { MENU_ITEMS } = await import('@sodiq/shared');
  const pages = Object.fromEntries(
    MENU_ITEMS.map((item) => [
      item,
      // Home at its own address, the others elsewhere, so one item is the current page.
      {
        titleKey: `menu.${item}`,
        to: item === 'home' ? '/' : '/setup',
        icon: actual.MENU_ICONS[item],
      },
    ]),
  );
  return { ...actual, BUILT_PAGES: pages, BUILT_ITEMS: new Set(MENU_ITEMS) };
});

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
    });

    renderApp('/');

    await heading(en.home.title);
    const links = side().getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(MENU[role].map((item) => en.menu[item]));
    // The current page is marked for a screen reader as well as by its fill
    // (docs/design-system.md, Layout shell, Menu; pull request #61, decision 9).
    expect(links.filter((link) => link.getAttribute('aria-current') === 'page')).toEqual([
      links[0],
    ]);
    // The own account page (task 0.8d) is reached from the person at the foot of the menu
    // (pull request #61, decision 7).
    expect(screen.getByRole('button', { name: en.layout.account })).toBeDefined();
    expect(screen.getByText(en.home[HOME_KIND[role]])).toBeDefined();
    expect(screen.queryByLabelText(en.switcher.role)).toBeNull();
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
    });

  it('starts with the first role of the table and changes menu and home without a call', async () => {
    const calls = twoRoles();
    renderApp('/');
    await heading(en.home.title);
    expect(screen.getByText(en.home.tutor)).toBeDefined();
    const before = calls.length;

    fireEvent.change(screen.getByLabelText(en.switcher.role), { target: { value: 'teacher' } });

    expect(await screen.findByText(en.home.teaching)).toBeDefined();
    expect(side().queryByText(en.menu.plans)).not.toBeNull();
    expect(side().queryByText(en.menu.people)).toBeNull();
    expect(calls).toHaveLength(before);
    expect(window.sessionStorage.getItem(ROLE_STORAGE_KEY)).toBe('teacher');
  });

  it('is not shown for one role', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
    renderApp('/');
    await heading(en.home.title);

    expect(screen.queryByLabelText(en.switcher.role)).toBeNull();
  });

  it('falls back to the default when the stored role is not held', async () => {
    window.sessionStorage.setItem(ROLE_STORAGE_KEY, 'principal');
    window.sessionStorage.setItem(BRANCH_STORAGE_KEY, SOUTH.id);
    twoRoles();

    renderApp('/');

    expect(await screen.findByText(en.home.tutor)).toBeDefined();
  });

  it('keeps the choice of the tab across a change of page', async () => {
    twoRoles();
    window.sessionStorage.setItem(ROLE_STORAGE_KEY, 'teacher');

    renderApp('/');

    expect(await screen.findByText(en.home.teaching)).toBeDefined();
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
    expect(bar.getAllByRole('link').map((link) => link.textContent)).toEqual(items.slice(0, 4));
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
