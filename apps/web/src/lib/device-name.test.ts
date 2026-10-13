import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { deviceName, deviceOf } from './device-name';

// Strings of the shape real browsers send (finding 11 of the hand test of
// 13 October 2026; task 2.7b-1, decision 6).
const STRINGS = {
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/154.0.0.0 Mobile/15E148 Safari/604.1',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  samsungAndroid:
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
  operaWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 OPR/120.0.0.0',
  yandexWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 YaBrowser/25.8.0.0 Safari/537.36',
} as const;

describe('deviceOf', () => {
  it('names the browser and the system, the ones that also say "Chrome" or "Safari" first', () => {
    expect(deviceOf(STRINGS.edgeWindows)).toEqual({ browser: 'edge', os: 'windows' });
    expect(deviceOf(STRINGS.chromeAndroid)).toEqual({ browser: 'chrome', os: 'android' });
    expect(deviceOf(STRINGS.chromeIphone)).toEqual({ browser: 'chrome', os: 'ios' });
    expect(deviceOf(STRINGS.firefoxLinux)).toEqual({ browser: 'firefox', os: 'linux' });
    expect(deviceOf(STRINGS.safariIphone)).toEqual({ browser: 'safari', os: 'ios' });
    expect(deviceOf(STRINGS.safariMac)).toEqual({ browser: 'safari', os: 'macos' });
    expect(deviceOf(STRINGS.samsungAndroid)).toEqual({ browser: 'samsung', os: 'android' });
    expect(deviceOf(STRINGS.operaWindows)).toEqual({ browser: 'opera', os: 'windows' });
    expect(deviceOf(STRINGS.yandexWindows)).toEqual({ browser: 'yandex', os: 'windows' });
  });

  it('knows neither in a string that names none', () => {
    expect(deviceOf('Invented Browser 12')).toEqual({ browser: 'other', os: 'other' });
  });
});

describe('deviceName', () => {
  const t = i18next.createInstance();
  void t.init({ lng: 'en', resources: { en: { translation: en } } });

  it('reads "Edge on Windows", and keeps a string that names neither as sent', () => {
    expect(deviceName(t.t, STRINGS.edgeWindows)).toBe('Edge on Windows');
    expect(deviceName(t.t, 'curl/8.0 Linux')).toBe('Another browser on Linux');
    expect(deviceName(t.t, 'Invented Browser 12')).toBe('Invented Browser 12');
    expect(deviceName(t.t, null)).toBeNull();
  });
});
