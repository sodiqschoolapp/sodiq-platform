import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';

/**
 * The one cookie of the platform. `__Host-` makes the browser accept it only
 * with `Secure`, with `Path=/` and without a `Domain`, so no other host of the
 * same site can set or read it.
 */
export const SESSION_COOKIE = '__Host-sodiq_session';

/**
 * Not readable by scripts, sent over HTTPS only, and never with a request that
 * another site started (docs/decisions.md, task 0.6a). When a session ends is
 * decided by the server from stored moments. Without `Expires` the browser
 * drops the cookie when it closes; only the session of a trusted device gets
 * one, the moment its 7 days are over, so that "that browser stays signed in
 * for 7 days" also holds after the browser was closed (task 0.6d).
 */
const OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' };

/** A token as `Sessions` makes it: base64url text, nothing else. */
const TOKEN = /^[A-Za-z0-9_-]{43,200}$/;

/**
 * The session token a request carries, if any. The header is read by hand and
 * nothing here throws: whatever a caller puts into `Cookie`, the worst outcome
 * is "no session".
 */
export function readSessionToken(request: Request): string | undefined {
  return readTokenCookie(request, SESSION_COOKIE);
}

/** The same for any cookie of ours that holds a token (the device cookie). */
export function readTokenCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (typeof header !== 'string') {
    return undefined;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return TOKEN.test(value) ? value : undefined;
    }
  }
  return undefined;
}

/** Sets and clears the session cookie on the answer of a route. */
export interface SessionCookieJar {
  /** `until`: the moment the session of a trusted device ends; left out, the cookie ends with the browser. */
  set(token: string, until?: Date | null): void;
  /**
   * Sets the cookie the request came with once more: until that moment when
   * the trust of its session began, or to end with the browser (`null`) when
   * that trust ended.
   */
  keep(until: Date | null): void;
  clear(): void;
}

/**
 * The session cookie of the answer, for the sign-in and sign-out routes.
 *
 *     signIn(@SessionCookie() cookie: SessionCookieJar)
 */
export const SessionCookie = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionCookieJar => {
    const http = context.switchToHttp();
    const response = http.getResponse<Response>();
    const set = (token: string, until?: Date | null): void => {
      response.cookie(
        SESSION_COOKIE,
        token,
        until === undefined || until === null ? OPTIONS : { ...OPTIONS, expires: until },
      );
    };
    return {
      set,
      keep: (until) => {
        const token = readSessionToken(http.getRequest<Request>());
        if (token !== undefined) {
          set(token, until);
        }
      },
      clear: () => {
        response.clearCookie(SESSION_COOKIE, OPTIONS);
      },
    };
  },
);
