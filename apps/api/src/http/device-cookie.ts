import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { readTokenCookie } from './session-cookie.js';

/**
 * Names the browser, not the person: a random token that a browser gets at a
 * successful sign-in and keeps. Failed sign-ins are counted per account and
 * device (edge cases, "Accounts and sign-in"), and this is the device. It
 * opens nothing by itself.
 */
export const DEVICE_COOKIE = '__Host-sodiq_device';

/** Browsers keep a cookie for 400 days at most. */
const DEVICE_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

const OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
  maxAge: DEVICE_COOKIE_MAX_AGE_MS,
};

/** Reads the device cookie of a request and sets it on the answer. */
export interface DeviceCookieJar {
  /** The token the browser sent, if it sent one that can be a token. */
  token: string | undefined;
  set(token: string): void;
}

/**
 * The device cookie, for the routes that check a password.
 *
 *     signIn(@DeviceCookie() device: DeviceCookieJar)
 */
export const DeviceCookie = createParamDecorator(
  (_data: unknown, context: ExecutionContext): DeviceCookieJar => {
    const http = context.switchToHttp();
    const response = http.getResponse<Response>();
    return {
      token: readTokenCookie(http.getRequest<Request>(), DEVICE_COOKIE),
      set: (token) => {
        response.cookie(DEVICE_COOKIE, token, OPTIONS);
      },
    };
  },
);

/** Longer texts are cut: the label of a session needs no more. */
export const USER_AGENT_MAX_LENGTH = 200;

/**
 * The browser as it names itself, cut to 200 characters, or `undefined`. A
 * label for the session list only: any caller can send any text here.
 *
 *     signIn(@UserAgent() userAgent: string | undefined)
 */
export const UserAgent = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined => {
    const header = context.switchToHttp().getRequest<Request>().headers['user-agent'];
    if (typeof header !== 'string' || header === '') {
      return undefined;
    }
    // A zero byte cannot be stored in a PostgreSQL text.
    return header.replaceAll('\u0000', '').slice(0, USER_AGENT_MAX_LENGTH);
  },
);
