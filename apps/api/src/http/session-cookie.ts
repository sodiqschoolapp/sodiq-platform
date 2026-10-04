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
 * another site started (docs/decisions.md, task 0.6a). No `Max-Age`: when a
 * session ends is decided by the server from stored moments.
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
  set(token: string): void;
  clear(): void;
}

/**
 * The session cookie of the answer, for the sign-in and sign-out routes.
 *
 *     signIn(@SessionCookie() cookie: SessionCookieJar)
 */
export const SessionCookie = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionCookieJar => {
    const response = context.switchToHttp().getResponse<Response>();
    return {
      set: (token) => {
        response.cookie(SESSION_COOKIE, token, OPTIONS);
      },
      clear: () => {
        response.clearCookie(SESSION_COOKIE, OPTIONS);
      },
    };
  },
);
