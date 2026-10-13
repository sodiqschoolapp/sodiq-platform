import type { TFunction } from 'i18next';

/**
 * The browser and the system of a session from the browser's own string
 * (finding 11 of the hand test of 13 October 2026; task 2.7b-1, decision 6):
 * "Edge on Windows" instead of "Mozilla/5.0 (Windows NT 10.0; …) … Edg/154".
 * No library: a dozen patterns cover the devices of the school.
 */

export type BrowserKey =
  | 'edge'
  | 'opera'
  | 'yandex'
  | 'samsung'
  | 'firefox'
  | 'chrome'
  | 'safari'
  | 'other';
export type SystemKey = 'windows' | 'android' | 'ios' | 'macos' | 'linux' | 'other';

/**
 * In this order: Edge, Opera, Yandex and Samsung Internet also say "Chrome",
 * and Chrome also says "Safari".
 */
const BROWSERS: readonly (readonly [BrowserKey, RegExp])[] = [
  ['edge', /\bEdg(?:e|A|iOS)?\//],
  ['opera', /\bOPR\/|\bOpera\b/],
  ['yandex', /\bYaBrowser\//],
  ['samsung', /\bSamsungBrowser\//],
  ['firefox', /\b(?:Firefox|FxiOS)\//],
  ['chrome', /\b(?:Chrome|CriOS)\//],
  ['safari', /\bVersion\/[\d.]+.*\bSafari\//],
];

/** iPhone and iPad before macOS: their strings also say "Mac OS X". */
const SYSTEMS: readonly (readonly [SystemKey, RegExp])[] = [
  ['windows', /\bWindows\b/],
  ['android', /\bAndroid\b/],
  ['ios', /\b(?:iPhone|iPad|iPod)\b/],
  ['macos', /\bMac OS X\b|\bMacintosh\b/],
  ['linux', /\bLinux\b|\bX11\b/],
];

/** The browser and the system a string names; `other` for what is not known. */
export function deviceOf(userAgent: string): { browser: BrowserKey; os: SystemKey } {
  const browser = BROWSERS.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? 'other';
  const os = SYSTEMS.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? 'other';
  return { browser, os };
}

/**
 * The device as a person reads it: "Edge on Windows". When neither the
 * browser nor the system is known, the string as the browser sent it, as
 * before; `null` when the session holds none.
 */
export function deviceName(t: TFunction, userAgent: string | null): string | null {
  if (userAgent === null) {
    return null;
  }
  const { browser, os } = deviceOf(userAgent);
  if (browser === 'other' && os === 'other') {
    return userAgent;
  }
  return t('devices.name', {
    browser: t(`devices.browsers.${browser}`),
    os: t(`devices.systems.${os}`),
  });
}
