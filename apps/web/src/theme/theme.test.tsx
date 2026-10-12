import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, refusal, renderApp, sessionOf } from '@/testing/render-app';
import { DARK_QUERY, THEME_STORAGE_KEY, ThemeStore, isDark } from './theme';

/** A device that prefers light or dark, and can change its mind. */
function fakeDevice(dark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches: dark,
    media: DARK_QUERY,
    addEventListener: (_type: 'change', listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: 'change', listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => {
      expect(media).toBe(DARK_QUERY);
      return query as unknown as MediaQueryList;
    }),
  );
  return {
    set(nextDark: boolean): void {
      query.matches = nextDark;
      for (const listener of listeners) {
        listener({ matches: nextDark } as MediaQueryListEvent);
      }
    },
    listeners,
  };
}

const isPageDark = (): boolean => document.documentElement.classList.contains('dark');

const stores: ThemeStore[] = [];
const newStore = (): ThemeStore => {
  const store = new ThemeStore();
  stores.push(store);
  return store;
};

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.stop();
  }
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
});

// docs/spec/12-ux-standards.md, Look and feel: "Light and dark themes".
// Decided by the owner (task 0.8b-3): light, dark or as the device; as the
// device by default; kept in the browser.
describe('the theme of the page', () => {
  it('follows the device by default, also when the device changes its mind', () => {
    const device = fakeDevice(true);

    const store = newStore();

    expect(store.snapshot()).toBe('device');
    expect(isPageDark()).toBe(true);
    device.set(false);
    expect(isPageDark()).toBe(false);
    device.set(true);
    expect(isPageDark()).toBe(true);
  });

  it('is the one chosen before in this browser, applied at the start', () => {
    fakeDevice(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    const store = newStore();

    expect(store.snapshot()).toBe('dark');
    expect(isPageDark()).toBe(true);
  });

  it('follows the device when the stored value is not a theme', () => {
    fakeDevice(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'blue');

    expect(newStore().snapshot()).toBe('device');
    expect(isPageDark()).toBe(true);
  });

  it('stays light with a light choice on a dark device, and stops following the device', () => {
    const device = fakeDevice(true);
    const store = newStore();

    store.set('light');

    expect(isPageDark()).toBe(false);
    device.set(false);
    device.set(true);
    expect(isPageDark()).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('works in a browser that cannot say what the device prefers', () => {
    vi.stubGlobal('matchMedia', undefined);

    const store = newStore();

    expect(isPageDark()).toBe(false);
    store.set('dark');
    expect(isPageDark()).toBe(true);
  });

  it('keeps the choice for the visit when the browser refuses storage', () => {
    fakeDevice(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage is refused.');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage is refused.');
    });

    const store = newStore();
    store.set('dark');

    expect(store.snapshot()).toBe('dark');
    expect(isPageDark()).toBe(true);
  });

  it.each([
    ['device', false, false],
    ['device', true, true],
    ['light', true, false],
    ['dark', false, true],
  ] as const)('is %s with a device that prefers dark=%s: dark=%s', (theme, deviceDark, dark) => {
    expect(isDark(theme, deviceDark)).toBe(dark);
  });
});

describe('the theme choice', () => {
  // In the app the three choices are in the person menu at the foot of the
  // navy menu (docs/design-system.md, Layout shell; pull request #61, decision 3).
  it('offers the three choices in the person menu, changes the page and stores the choice', async () => {
    fakeDevice(false);
    fakeApi({ 'GET /api/auth/session': () => json(sessionOf()) });
    renderApp('/', 'en', newStore());
    await screen.findByRole('heading', { name: en.home.title });
    const open = () => {
      fireEvent.click(screen.getByRole('button', { name: en.layout.account }));
    };
    const item = (name: string) => screen.findByRole('menuitemradio', { name });

    open();
    expect((await item(en.theme.device)).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: en.theme.light })).toBeDefined();

    fireEvent.click(await item(en.theme.dark));
    expect(isPageDark()).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    if (screen.queryByRole('menuitemradio', { name: en.theme.light }) === null) {
      open();
    }
    fireEvent.click(await item(en.theme.light));
    expect(isPageDark()).toBe(false);
  });

  // "These rules apply to every page" (12): before sign-in too, as the theme
  // button of the sign-in page (docs/design-system.md, Brand moments, Sign-in;
  // pull request #61, decision 2).
  it('is a button on the sign-in page, beside the language chooser, that sets the other theme', async () => {
    fakeDevice(true);
    fakeApi({ 'GET /api/auth/session': () => refusal('not_signed_in', 401) });
    renderApp('/sign-in', 'en', newStore());
    await screen.findByRole('heading', { name: en.signIn.title });

    expect(isPageDark()).toBe(true);
    expect(screen.getByRole('combobox', { name: en.language.label })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: en.theme.toLight }));
    expect(isPageDark()).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: en.theme.toDark }));
    expect(isPageDark()).toBe(true);
  });
});
