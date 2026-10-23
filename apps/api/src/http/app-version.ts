import { APP_VERSION_HEADER, OLDEST_APP_VERSION, appVersionSchema } from '@sodiq/shared';
import type { NextFunction, Request, Response } from 'express';
import { ApiException } from './api-exception.js';
import { sendError } from './error-response.js';

/** Requests that change nothing, never refused for their version. */
const READING_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The sign-in and its steps: an outdated tab still signs in (decision 9). */
const AUTH_PATH = /^\/api\/auth(\/|$)/;

/**
 * The application version of a writing request (task 8.3a, decisions 4 and 9;
 * `edge/system-behaviour`: "Every request carries the application version.
 * Entries from the previous version are accepted for at least one release;
 * otherwise the page asks to reload and keeps the unsent entries"). A write
 * from a page older than `OLDEST_APP_VERSION` is refused `app_outdated`;
 * reads and the sign-in are not, so the page can still show what it holds. A
 * request without the header (the health check, a script) passes; the web app
 * always sends it.
 */
export function appVersionCheck(oldest: number) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const header = request.headers[APP_VERSION_HEADER.toLowerCase()];
    if (
      header === undefined ||
      READING_METHODS.has(request.method) ||
      AUTH_PATH.test(request.path)
    ) {
      next();
      return;
    }
    const parsed = appVersionSchema.safeParse(header);
    if (!parsed.success) {
      sendError(
        response,
        new ApiException('validation_failed', 400, undefined, [
          { path: APP_VERSION_HEADER, code: 'invalid', message: 'The version is a whole number.' },
        ]),
      );
      return;
    }
    if (parsed.data < oldest) {
      sendError(response, new ApiException('app_outdated', 409));
      return;
    }
    next();
  };
}

/** The check with the oldest version this release accepts. */
export const appVersionMiddleware = appVersionCheck(OLDEST_APP_VERSION);
