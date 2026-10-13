import type { Weekday } from '@sodiq/shared';
import { en } from '@/i18n/locales/en';
import { uz } from '@/i18n/locales/uz';

/**
 * Every date and time a person reads (`12`, Language: "Dates, numbers and
 * weekdays follow the chosen language"; task 2.7a). Nothing else in the web
 * app formats a date: a lint rule refuses `Intl.DateTimeFormat` and
 * `toLocale…String` outside this file.
 *
 * - Uzbek names come from the app's own texts (`dates.months`,
 *   `dates.weekdays`), never from the browser: where its language data is
 *   trimmed, `Intl` claims Uzbek and answers "2026 M09 2" (issue #39, hand
 *   test of 13 October 2026, finding 3). "8-dekabr, 2026", "8-dekabr, 2026,
 *   15:03".
 * - English is day-first with the 24-hour clock, "13 Oct 2026, 15:03" (the
 *   owner's answer 38 on issue #39).
 * - Russian is the browser's own, with the 24-hour clock.
 */

type MonthStyle = 'long' | 'short';

/** The numbers of a moment in a time zone; numeric parts never depend on the language data. */
interface Parts {
  year: number;
  month: number;
  day: number;
  hour: string;
  minute: string;
}

function partsOf(moment: Date, timeZone: string | undefined): Parts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).formatToParts(moment);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((one) => one.type === type)?.value ?? '';
  return {
    year: Number(part('year')),
    month: Number(part('month')),
    day: Number(part('day')),
    hour: part('hour'),
    minute: part('minute'),
  };
}

/** The Uzbek name of a month, 1 to 12, in lower case as inside a date. */
function uzMonth(month: number): string {
  const months: Record<string, string> = uz.dates.months;
  return months[String(month)] ?? '';
}

function capital(text: string, language: string): string {
  return text.charAt(0).toLocaleUpperCase(language) + text.slice(1);
}

function uzDate(day: number, month: number, year: number | undefined): string {
  const date = `${day}-${uzMonth(month)}`;
  return year === undefined ? date : `${date}, ${year}`;
}

/** The locale `Intl` is asked for: English is day-first (answer 38). */
function intlLocale(language: string): string {
  return language === 'en' ? 'en-GB' : language;
}

/**
 * A school date (`YYYY-MM-DD`): "10 November 2026", "10-noyabr, 2026", or
 * without the year. Read as a day of the calendar, never moved by a time zone.
 */
export function schoolDateText(date: string, language: string, withYear = true): string {
  const [year, month, day] = date.split('-').map(Number);
  if (language === 'uz') {
    return uzDate(day ?? 1, month ?? 1, withYear ? (year ?? 1970) : undefined);
  }
  return new Intl.DateTimeFormat(intlLocale(language), {
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)));
}

/** The name of a month as a label, with a capital: "September", "Sentabr". */
function monthLabel(date: string, language: string): string {
  const [year, month] = date.split('-').map(Number);
  if (language === 'uz') {
    return capital(uzMonth(month ?? 1), language);
  }
  const name = new Intl.DateTimeFormat(intlLocale(language), {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1)));
  return capital(name, language);
}

/**
 * The months a quarter covers (`03`, Quarters: "Months are derived from
 * dates"): "September – October".
 */
export function monthsText(startDate: string, endDate: string, language: string): string {
  const first = monthLabel(startDate, language);
  const last = monthLabel(endDate, language);
  return startDate.slice(0, 7) === endDate.slice(0, 7) ? first : `${first} – ${last}`;
}

/**
 * The name of a weekday (1 is Monday, 7 is Sunday) with a capital first
 * letter, as a label has. The first of January 2024 was a Monday.
 */
export function weekdayName(language: string, day: Weekday): string {
  if (language === 'uz') {
    const weekdays: Record<string, string> = uz.dates.weekdays;
    return capital(weekdays[String(day)] ?? '', language);
  }
  const name = new Intl.DateTimeFormat(intlLocale(language), {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2024, 0, day)));
  return capital(name, language);
}

interface MomentOptions {
  /** The time zone; the device's when left out. */
  timeZone?: string;
  /** "13 Oct 2026" (the default) or "13 October 2026"; Uzbek has the long month only. */
  month?: MonthStyle;
}

/** The date of a stored moment, without the time: "1 Oct 2026", "1-oktabr, 2026". */
export function momentDateText(language: string, iso: string, options: MomentOptions = {}): string {
  const moment = new Date(iso);
  if (language === 'uz') {
    const parts = partsOf(moment, options.timeZone);
    return uzDate(parts.day, parts.month, parts.year);
  }
  if (language === 'en' && (options.month ?? 'short') === 'short') {
    // The browser's English short month of September is "Sept" in newer
    // language data and "Sep" in older: one form, "13 Oct 2026", "2 Sep 2026"
    // (answer 38).
    const parts = partsOf(moment, options.timeZone);
    const months: Record<string, string> = en.dates.months;
    return `${String(parts.day)} ${(months[String(parts.month)] ?? '').slice(0, 3)} ${String(parts.year)}`;
  }
  return new Intl.DateTimeFormat(intlLocale(language), {
    day: 'numeric',
    month: options.month ?? 'short',
    year: 'numeric',
    ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
  }).format(moment);
}

/**
 * A stored moment with its time, on the 24-hour clock: "13 Oct 2026, 15:03",
 * "13-oktabr, 2026, 15:03", in the time zone given or the device's.
 */
export function momentText(language: string, iso: string, options: MomentOptions = {}): string {
  const parts = partsOf(new Date(iso), options.timeZone);
  return `${momentDateText(language, iso, options)}, ${parts.hour}:${parts.minute}`;
}

/**
 * A stored moment in the language of the page and in the time zone of the
 * device. The moments of sessions and devices belong to an account, which has
 * no branch (decided at the plan of task 0.8d).
 */
export function formatMoment(language: string, iso: string): string {
  return momentText(language, iso);
}

/** A stored moment in a given time zone: the branch's, on a printout (task 2.6b). */
export function formatMomentIn(language: string, iso: string, timeZone: string): string {
  return momentText(language, iso, { timeZone });
}
