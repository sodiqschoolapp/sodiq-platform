import { sessionResponseSchema, type SessionResponse } from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';

/** Who is signed in, or `null` when nobody is. */
export type Session = SessionResponse | null;

export const SESSION_KEY = ['session'] as const;

async function readSession(): Promise<Session> {
  try {
    return sessionResponseSchema.parse(await answerOf(api.GET('/api/auth/session')));
  } catch (error) {
    if (error instanceof ApiFailure && error.code === 'not_signed_in') {
      return null;
    }
    throw error;
  }
}

/**
 * The session as the server sees it. It is asked again when a page is opened
 * more than a minute after the last answer, never on a timer: a call by
 * itself would count as use and keep an idle session alive.
 */
export const sessionQuery = queryOptions({
  queryKey: SESSION_KEY,
  queryFn: readSession,
  staleTime: 60_000,
});

/**
 * What a session owes before anything else, in the order of the server
 * (docs/decisions.md, task 0.6c): the code of the second step, the forced
 * password change, the set-up of a required second step.
 */
export type Step = 'sign_in' | 'code' | 'password' | 'set_up' | 'none';

export function stepOf(session: Session): Step {
  if (session === null) {
    return 'sign_in';
  }
  if (session.secondStep === 'pending') {
    return 'code';
  }
  if (session.mustChangePassword) {
    return 'password';
  }
  if (session.secondStep === 'set_up_required') {
    return 'set_up';
  }
  return 'none';
}

/** The page of each step; `none` is the home page. */
export const STEP_PATH = {
  sign_in: '/sign-in',
  code: '/sign-in/code',
  password: '/password',
  set_up: '/second-step/set-up',
  none: '/',
} as const satisfies Record<Step, string>;

/** The session an answer of the API just described (sign-in, the code). */
export function keepSession(queryClient: QueryClient, answer: unknown): Session {
  const session = sessionResponseSchema.parse(answer);
  queryClient.setQueryData(SESSION_KEY, session);
  return session;
}

/** Asks the server again, whatever the age of the last answer. */
export function refreshSession(queryClient: QueryClient): Promise<Session> {
  return queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 });
}

/**
 * After sign-out or an ended session: nobody is signed in, and nothing that
 * was loaded for the last person stays in memory.
 */
export function forgetSession(queryClient: QueryClient): void {
  queryClient.clear();
  queryClient.setQueryData(SESSION_KEY, null);
}

/** Codes that say the session is not what this tab believes it to be. */
export const SESSION_CHANGED_CODES = [
  'not_signed_in',
  'second_step_required',
  'password_change_required',
  'second_step_set_up_required',
] as const;
