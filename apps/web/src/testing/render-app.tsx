import type { ErrorCode, SessionResponse } from '@sodiq/shared';
import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { App, createShell, type Shell } from '@/app/shell';
import { createI18n } from '@/i18n/i18n';
import type { Language } from '@/i18n/languages';
import { ThemeStore } from '@/theme/theme';

/** Answers one route of the API; it is given the JSON body of the request, if any. */
export type Handler = (body: unknown) => Response;

export interface ApiCall {
  /** For example `POST /api/auth/sign-in`. */
  route: string;
  body: unknown;
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
export function fakeApi(handlers: Record<string, Handler>): ApiCall[] {
  const calls: ApiCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      if (!(input instanceof Request)) {
        throw new TypeError('The generated client hands fetch a Request.');
      }
      const route = `${input.method} ${new URL(input.url).pathname}`;
      const text = await input.text();
      const body: unknown = text === '' ? undefined : JSON.parse(text);
      calls.push({ route, body });
      const handler = handlers[route];
      if (handler === undefined) {
        throw new TypeError('Failed to fetch');
      }
      return handler(body);
    }),
  );
  return calls;
}

/**
 * The whole app at an address, in a language (English when left out). The
 * theme is read from the browser as at a start, unless a store is given.
 */
export function renderApp(
  path = '/',
  language: Language = 'en',
  theme: ThemeStore = new ThemeStore(),
): Shell {
  renderedLanguage = language;
  const i18n = createI18n(language);
  const shell = createShell(i18n, createMemoryHistory({ initialEntries: [path] }));
  render(<App i18n={i18n} shell={shell} theme={theme} />);
  return shell;
}
