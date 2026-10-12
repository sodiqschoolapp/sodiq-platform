import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf, SOUTH } from '@/testing/render-app';
import { initialsOf, MenuItemText, tabBarSplit } from './app-menu';
import { MENU_STORAGE_KEY } from './menu-state';

const heading = (name: string) => screen.findByRole('heading', { name });
const side = () => within(screen.getByRole('navigation', { name: en.layout.menu }));

// docs/design-system.md, This app, Phone tab bar: "The role's first four menu
// items and \"More\""; "More" is always there (pull request #61, plan review 6).
describe('the split of the tab bar', () => {
  it.each([
    [2, 2, 0],
    [4, 4, 0],
    [5, 4, 1],
    [9, 4, 5],
  ])('gives %i items as %i tabs and %i under "More"', (count, tabs, more) => {
    const items = Array.from({ length: count }, (_, index) => index);
    const split = tabBarSplit(items);
    expect(split.tabs).toEqual(items.slice(0, tabs));
    expect(split.more).toEqual(items.slice(tabs));
    expect(split.more).toHaveLength(more);
  });

  it('keeps "More" for a role with few items', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
    renderApp('/');
    await heading(en.home.title);
    const bar = within(screen.getByRole('navigation', { name: en.menu.tabs }));
    expect(bar.getAllByRole('link').length).toBeLessThanOrEqual(4);
    expect(bar.getByRole('button', { name: en.menu.more })).toBeDefined();
  });
});

// docs/design-system.md, Layout shell, Menu: "a count as a plain number at
// the right of an item"; What we never do 4 and 12: no pill, no dot.
describe('a count in the menu', () => {
  it('is a plain number beside the word, and nothing when there is none', () => {
    const { container, rerender } = render(<MenuItemText title="Requests" count={3} />);
    const count = container.querySelector('[data-count]');
    expect(count?.textContent).toBe('3');
    expect(count?.className).not.toMatch(/rounded|bg-/);
    rerender(<MenuItemText title="Requests" count={0} />);
    expect(container.querySelector('[data-count]')).toBeNull();
    rerender(<MenuItemText title="Requests" />);
    expect(container.textContent).toBe('Requests');
  });
});

describe('the person at the foot of the menu', () => {
  it('has initials from the parts of the login', () => {
    expect(initialsOf('d.karimova')).toBe('DK');
    expect(initialsOf('aziz')).toBe('AZ');
    // The modifier letter of oʻ is not a letter of its own.
    expect(initialsOf('oʻ.rahimov')).toBe('OR');
    expect(initialsOf('')).toBe('');
  });

  // Pull request #61, decision 6: the login and the role on display.
  it('shows the login, the role and the initials, with sign-out beside it', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf({ login: 'n.saidova' })) });
    renderApp('/');
    await heading(en.home.title);

    const person = screen.getByRole('button', { name: en.layout.account });
    expect(person.textContent).toContain('NS');
    expect(person.textContent).toContain('n.saidova');
    expect(person.textContent).toContain(en.roles.teacher);
    expect(screen.getByRole('button', { name: en.layout.signOut })).toBeDefined();
  });
});

// docs/design-system.md, Layout shell, Menu: "It can collapse to a 72-wide
// rail of icons with the shield logo; the choice is kept in the browser"
// ("Decided ahead for tasks 2.2d and 2.7", item 5: key `sodiq.menu`).
describe('the collapsed menu', () => {
  it('keeps its items by name, and is kept in the browser', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
    renderApp('/');
    await heading(en.home.title);

    const collapse = screen.getByRole('button', { name: en.menu.collapse });
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(collapse);

    expect(window.localStorage.getItem(MENU_STORAGE_KEY)).toBe('rail');
    const expand = screen.getByRole('button', { name: en.menu.expand });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    // An icon alone is named (Icons; pull request #61, decision 9).
    const home = side().getByRole('link', { name: en.menu.home });
    expect(home.textContent).toBe('');
    expect(home.getAttribute('aria-current')).toBe('page');
    // The login and role leave the foot; the person keeps its name.
    expect(screen.getByRole('button', { name: en.layout.account }).textContent).not.toContain(
      'm.ergasheva',
    );
  });

  it('is read back when the app opens again', async () => {
    window.localStorage.setItem(MENU_STORAGE_KEY, 'rail');
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
    renderApp('/');
    await heading(en.home.title);

    expect(screen.getByRole('button', { name: en.menu.expand })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: en.menu.expand }));
    expect(window.localStorage.getItem(MENU_STORAGE_KEY)).toBe('open');
  });

  it('opens as the full menu when the browser refuses its storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage refused');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage refused');
    });
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
    try {
      renderApp('/');
      await heading(en.home.title);
      expect(screen.getByRole('button', { name: en.menu.collapse })).toBeDefined();
      // The choice still holds for the visit.
      fireEvent.click(screen.getByRole('button', { name: en.menu.collapse }));
      expect(screen.getByRole('button', { name: en.menu.expand })).toBeDefined();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

// `12`, Context: "The branch, academic year and quarter in use are always
// shown in the top bar."
describe('the branch in the top bar', () => {
  it('is its name with one branch, and a select with two', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
    renderApp('/');
    await heading(en.home.title);
    const banner = within(screen.getByRole('banner', { name: en.layout.topBar }));
    expect(banner.getByTitle(en.switcher.branch).textContent).toContain(NORTH.name);
    expect(banner.queryByRole('combobox', { name: en.switcher.branch })).toBeNull();
  });

  it('is a select with two branches', async () => {
    fakeApi({
      'GET /api/auth/session': () =>
        json(
          sessionOf({
            assignments: [
              { role: 'teacher', branchId: NORTH.id },
              { role: 'teacher', branchId: SOUTH.id },
            ],
            branches: [NORTH, SOUTH],
          }),
        ),
    });
    renderApp('/');
    await heading(en.home.title);
    expect(
      within(screen.getByRole('banner', { name: en.layout.topBar })).getByRole('combobox', {
        name: en.switcher.branch,
      }),
    ).toBeDefined();
  });
});

// docs/design-system.md, Layout shell, Top bar: "the search field with \"Ctrl
// K\" as plain text at its right, and at the right the notifications button".
describe('the top bar', () => {
  it('holds the search with its shortcut as plain text, the notifications and the feedback', async () => {
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
    renderApp('/');
    await heading(en.home.title);
    const banner = within(screen.getByRole('banner', { name: en.layout.topBar }));

    const search = banner.getByRole('button', { name: en.search.label });
    expect(search.textContent).toContain(en.search.shortcut);
    expect(search.querySelector('kbd')).toBeNull();
    expect(banner.getByRole('button', { name: en.notifications.button })).toBeDefined();
    expect(banner.getByRole('button', { name: en.feedback.button })).toBeDefined();
    // The theme and the language are in the person menu (pull request #61, decision 3).
    expect(banner.queryByRole('radiogroup', { name: en.theme.label })).toBeNull();
    expect(banner.queryByRole('combobox', { name: en.language.label })).toBeNull();
  });
});
