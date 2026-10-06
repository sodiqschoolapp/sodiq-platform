import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { uz } from '@/i18n/locales/uz';
import { fakeApi, json, refusal, renderApp, sessionOf } from '@/testing/render-app';
import { isSearchShortcut } from './command-search';

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
    expect(optionNames()).toEqual([en.home.title, en.password.titleOwn, en.sample.title]);
    expect(screen.getByRole('listbox', { name: en.search.pages })).toBeDefined();
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
    await openHome();
    pressShortcut();
    await dialog();

    fireEvent.change(box(), { target: { value: 'timetable of the moon' } });

    expect(screen.queryAllByRole('option')).toEqual([]);
    expect(within(await dialog()).getByRole('status').textContent).toBe(en.search.noMatch);
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
    const second = screen.getByRole('option', { name: en.password.titleOwn });
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(box().getAttribute('aria-activedescendant')).toBe(second.id);
    // Not past the last page, not before the first.
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(
      screen.getByRole('option', { name: en.sample.title }).getAttribute('aria-selected'),
    ).toBe('true');
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    expect(screen.getByRole('option', { name: en.home.title }).getAttribute('aria-selected')).toBe(
      'true',
    );
    fireEvent.keyDown(box(), { key: 'ArrowDown' });

    fireEvent.keyDown(box(), { key: 'Enter' });

    await noDialog();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/password');
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
    expect(optionNames()).toHaveLength(3);
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
