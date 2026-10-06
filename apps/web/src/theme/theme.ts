import { createContext, useContext, useSyncExternalStore } from 'react';

/**
 * docs/spec/12-ux-standards.md, Look and feel: "Light and dark themes". The
 * choice is light, dark, or as the device prefers; "as the device" by default,
 * kept in the browser like the language (decided by the owner, task 0.8b-3).
 */
export const THEMES = ['device', 'light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'device';

/** Where a browser keeps the chosen theme. */
export const THEME_STORAGE_KEY = 'sodiq.theme';

/** The media query that says what the device prefers. */
export const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value);
}

/** Whether the page is dark for a choice, given what the device prefers. */
export function isDark(theme: Theme, deviceDark: boolean): boolean {
  return theme === 'dark' || (theme === 'device' && deviceDark);
}

// A browser may refuse storage (private mode, settings): the choice then lasts
// for the visit only, as with the language.
function readStoredTheme(): Theme {
  try {
    const stored: unknown = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Nothing to do: see above.
  }
}

/** The device's preference, and a way to hear of a change; nothing where the browser cannot say. */
function deviceQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
}

/**
 * The theme of one tab. It puts the class `dark` on `<html>` (the `dark`
 * variant of the styles and `color-scheme` read it) and follows the device
 * while the choice is "as the device".
 */
export class ThemeStore {
  private theme: Theme;
  private readonly query: MediaQueryList | null;
  private readonly listeners = new Set<() => void>();

  constructor(initial: Theme = readStoredTheme()) {
    this.theme = initial;
    this.query = deviceQuery();
    this.query?.addEventListener('change', this.apply);
    this.apply();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly snapshot = (): Theme => this.theme;

  /** Whether the page is dark now. */
  get dark(): boolean {
    return isDark(this.theme, this.query?.matches ?? false);
  }

  set(theme: Theme): void {
    this.theme = theme;
    storeTheme(theme);
    this.apply();
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Stops following the device; for tests that make several stores. */
  stop(): void {
    this.query?.removeEventListener('change', this.apply);
  }

  private readonly apply = (): void => {
    document.documentElement.classList.toggle('dark', this.dark);
  };
}

/** The theme of the running app, applied before the first render (main.tsx). */
export function startTheme(): ThemeStore {
  return new ThemeStore();
}

export const ThemeContext = createContext<ThemeStore | null>(null);

const subscribeToNothing = (): (() => void) => () => undefined;
const defaultTheme = (): Theme => DEFAULT_THEME;

/** The chosen theme and a way to change it. The default outside the app (a piece drawn alone in a test). */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const store = useContext(ThemeContext);
  const theme = useSyncExternalStore(
    store?.subscribe ?? subscribeToNothing,
    store?.snapshot ?? defaultTheme,
  );
  return {
    theme,
    setTheme: (next) => {
      store?.set(next);
    },
  };
}
