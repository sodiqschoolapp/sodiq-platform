/**
 * Task 11.4: the portal as a Telegram mini app (`10`, What parents see). Telegram opens the page
 * with its launch data in the address's fragment (`#tgWebAppData=…`); the data is kept for this
 * tab from the first moment of the app, before the router changes the address, and sent to the
 * server, which checks Telegram's signature. Nothing here decides anything: the server does.
 */

/** Telegram's script of mini apps; the Content Security Policy allows it on `/portal` only. */
export const TELEGRAM_SCRIPT = 'https://telegram.org/js/telegram-web-app.js';

/** The tab's copy, so that a reload inside the mini app keeps the launch. */
const STORE_KEY = 'sodiq.telegramLaunch';

let captured: string | undefined;

/** The part of Telegram's `WebApp` object the portal uses. */
export interface TelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  close(): void;
}

interface TelegramWindow {
  Telegram?: { WebApp?: TelegramWebApp };
}

/** Reads the launch data from an address fragment, once at the start of the app. */
export function captureTelegramLaunch(hash: string): void {
  const data = new URLSearchParams(hash.replace(/^#/, '')).get('tgWebAppData');
  if (data === null || data === '') {
    return;
  }
  captured = data;
  try {
    sessionStorage.setItem(STORE_KEY, data);
  } catch {
    // A tab without storage keeps it in memory only.
  }
}

/** The launch data of this tab, when it was opened by Telegram. */
export function telegramLaunchData(): string | undefined {
  if (captured !== undefined) {
    return captured;
  }
  try {
    return sessionStorage.getItem(STORE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Forgets the launch of this tab (tests). */
export function forgetTelegramLaunch(): void {
  captured = undefined;
  try {
    sessionStorage.removeItem(STORE_KEY);
  } catch {
    // Nothing kept.
  }
}

/** Telegram's object, when the page runs inside the mini app and the script is loaded. */
export function telegramWebApp(): TelegramWebApp | undefined {
  const app = (window as TelegramWindow).Telegram?.WebApp;
  return app !== undefined && app.initData !== '' ? app : undefined;
}

let loading: Promise<void> | undefined;

/** Loads Telegram's script once, and tells Telegram the page is ready. Never fails the page. */
export function loadTelegramScript(): Promise<void> {
  loading ??= new Promise<void>((resolve) => {
    const script = document.createElement('script');
    script.src = TELEGRAM_SCRIPT;
    script.async = true;
    script.onload = () => {
      const app = telegramWebApp();
      app?.ready();
      app?.expand();
      resolve();
    };
    // Without the script the portal still works: only the window's fitting is lost.
    script.onerror = () => {
      resolve();
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Closes the mini app after a sign-out inside it; nothing in a browser. */
export function closeMiniApp(): void {
  telegramWebApp()?.close();
}
