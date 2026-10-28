import type { ErrorCode, SessionResponse } from '@sodiq/shared';
import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { App, createShell, type Shell } from '@/app/shell';
import type { LiveConnector } from '@/features/notifications/live';
import { createI18n } from '@/i18n/i18n';
import type { Language } from '@/i18n/languages';
import { ThemeStore } from '@/theme/theme';

/** Answers one route of the API; it is given the JSON body of the request, if any. */
export type Handler = (body: unknown) => Response | Promise<Response>;

export interface ApiCall {
  /** For example `POST /api/auth/sign-in`. */
  route: string;
  body: unknown;
  /** The query of the address, `?` included, when there is one (task 2.4b-2). */
  query?: string;
}

export const json = (body: unknown, status = 200): Response => Response.json(body, { status });

export const nothing = (): Response => new Response(null, { status: 204 });

/** A refusal in the one error shape of the API. The message is never shown to a person. */
export function refusal(code: ErrorCode, status: number, retryAfterSeconds?: number): Response {
  return Response.json(
    { error: { code, message: 'ENGLISH TEXT FOR THE DEVELOPER', requestId: 'test-request' } },
    {
      status,
      headers: retryAfterSeconds === undefined ? {} : { 'Retry-After': String(retryAfterSeconds) },
    },
  );
}

/** A branch of the tests; invented. */
export const NORTH = { id: '0198a000-0000-7000-8000-000000000001', name: 'North' };
export const SOUTH = { id: '0198a000-0000-7000-8000-000000000002', name: 'South' };

/**
 * The language of the last `renderApp`: the account of `sessionOf` is in it,
 * so that the app does not switch language at the first answer (task 0.8d: the
 * account's language applies to a complete session). A test of that switch
 * gives `language` itself.
 */
let renderedLanguage: Language = 'en';

/** A session that owes no step and holds the Teacher role in one branch; give the fields that differ. */
export function sessionOf(fields: Partial<SessionResponse> = {}): SessionResponse {
  return {
    login: 'm.ergasheva',
    name: null,
    secondStep: 'not_needed',
    mustChangePassword: false,
    passwordResetBy: null,
    trustedUntil: null,
    language: renderedLanguage,
    assignments: [{ role: 'teacher', branchId: NORTH.id }],
    branches: [NORTH],
    ...fields,
  };
}

/**
 * Replaces the browser's fetch with the given routes and records every call.
 * A route that is not named fails like a lost connection.
 */
/**
 * Calls the shell makes on every page for some roles, answered unless a test
 * gives its own: the count of Super Admins of the banner (task 2.3a), two, so
 * that no banner shows; the branches without an Academic Vice Principal
 * (task 2.3b-2), none; the own lessons of the home page of a role that
 * teaches (task 5.9b), none, since the default session is a Teacher's; its
 * exemption cards (task 8.5), none; the cards of the home pages (task 9.4b),
 * each empty.
 */
const SHELL_ANSWERS: Record<string, Handler> = {
  'GET /api/access/super-admins': () => json({ active: 2 }),
  'GET /api/access/branches-without-vice-principal': () => json({ branches: [] }),
  'GET /api/timetable/home': () =>
    json({
      today: '2026-10-19',
      week: { from: '2026-10-19', to: '2026-10-25' },
      branches: [],
      days: [],
      lessons: [],
      exams: [],
      busy: [],
    }),
  'GET /api/journal/exemptions-today': () =>
    json({ date: '2026-10-19', exemptToday: [], backToday: [] }),
  // Task 8.7: the reminders of the teaching home.
  'GET /api/journal/reminders': () => json({ today: '2026-10-19', reminders: [] }),
  // Task 9.4b: the cards of the home pages.
  'GET /api/results/early-warning': () =>
    json({
      quarter: null,
      quarters: [],
      thresholds: {
        lowResult: 50,
        resultDrop: 15,
        attendancePercent: 80,
        absencesInRow: 3,
        gradedWorks: 5,
      },
      daysAgoDate: null,
      entries: [],
      prepared: { updatedAt: null, updating: false },
    }),
  'GET /api/plans/requests': () => json({ requests: [], events: [] }),
  'GET /api/journal/unlocks': () => json({ requests: [] }),
  'GET /api/journal/attendance-today': () =>
    json({
      date: '2026-10-19',
      weekFrom: '2026-10-19',
      threshold: 80,
      total: { attended: 0, marked: 0, unmarked: 0, exempt: 0, percent: null },
      classes: [],
      prepared: { updatedAt: null, updating: false },
    }),
  'GET /api/journal/lessons-today': () =>
    json({
      date: '2026-10-19',
      ahead: 0,
      held: 0,
      notStarted: 0,
      inProgress: 0,
      complete: 0,
      incomplete: [],
      prepared: { updatedAt: null, updating: false },
    }),
  'GET /api/timetable/conflicts-summary': () => json({ drafts: [], published: null }),
  'GET /api/results/branch-summary': () =>
    json({
      date: '2026-10-19',
      students: 0,
      staff: 0,
      attendanceToday: { attended: 0, marked: 0, unmarked: 0, exempt: 0, percent: null },
      quarter: null,
      grades: [],
      prepared: { updatedAt: null, updating: false },
    }),
  'GET /api/results/closing': () =>
    json({
      quarters: [],
      quarterId: null,
      state: 'not_open',
      opensOn: null,
      lastDay: null,
      closable: false,
      lockNowNeeded: false,
      startQuarter: false,
      earlierOpen: false,
      closing: null,
      reopenings: [],
      reopening: null,
      changes: [],
      closedJournals: [],
      reopenedJournals: [],
      check: null,
      canApply: false,
      canEdit: false,
      schoolDays: null,
      blocking: 0,
      warnings: 0,
      items: [],
    }),
};

export function fakeApi(handlers: Record<string, Handler>): ApiCall[] {
  const calls: ApiCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      if (!(input instanceof Request)) {
        throw new TypeError('The generated client hands fetch a Request.');
      }
      const route = `${input.method} ${new URL(input.url).pathname}`;
      // A file (a photo, task 2.2c-2) is recorded by its type and size, not read as JSON.
      const type = input.headers.get('Content-Type') ?? '';
      let body: unknown;
      if (type.startsWith('image/')) {
        body = { type, size: (await input.arrayBuffer()).byteLength };
      } else {
        const text = await input.text();
        body = text === '' ? undefined : JSON.parse(text);
      }
      const query = new URL(input.url).search;
      calls.push({ route, body, ...(query === '' ? {} : { query }) });
      const handler = handlers[route] ?? SHELL_ANSWERS[route];
      if (handler === undefined) {
        throw new TypeError('Failed to fetch');
      }
      return handler(body);
    }),
  );
  return calls;
}

/** A live connection that never opens: the tests of other pages need none. */
export const noLive: LiveConnector = () => ({ close: () => undefined });

/**
 * The whole app at an address, in a language (English when left out). The
 * theme is read from the browser as at a start, unless a store is given; the
 * live connection of the notifications is a fake, or none.
 */
export function renderApp(
  path = '/',
  language: Language = 'en',
  theme: ThemeStore = new ThemeStore(),
  live: LiveConnector = noLive,
): Shell {
  renderedLanguage = language;
  const i18n = createI18n(language);
  const shell = createShell(i18n, createMemoryHistory({ initialEntries: [path] }), live);
  render(<App i18n={i18n} shell={shell} theme={theme} />);
  return shell;
}
