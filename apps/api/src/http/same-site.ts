import type { NextFunction, Request, Response } from 'express';
import { ApiException } from './api-exception.js';
import { sendError } from './error-response.js';

/** Requests that change nothing. Every other method is checked. */
const READING_METHODS = new Set(['GET', 'HEAD']);

/** What a browser sends for a request of our own page, or one the person typed. */
const OWN_SITE = new Set(['same-origin', 'none']);

/**
 * Refuses a changing request that another site started (cross-site request
 * forgery). The session cookie is `SameSite=Strict` already; this is the second
 * guard, and it needs no token because web app and API share one origin.
 *
 * - With `Sec-Fetch-Site` (every current browser sends it and a page cannot
 *   set it): only `same-origin` and `none` pass.
 * - Without it but with `Origin`: the origin must be the request's own.
 * - With neither, the caller is not a browser (a test, the uptime check, the
 *   later mobile apps) and cannot be made to carry somebody's cookie.
 */
export function sameSiteMiddleware(request: Request, response: Response, next: NextFunction) {
  if (READING_METHODS.has(request.method)) {
    next();
    return;
  }
  const site = request.headers['sec-fetch-site'];
  const origin = request.headers.origin;
  const allowed =
    site !== undefined
      ? typeof site === 'string' && OWN_SITE.has(site)
      : origin === undefined || origin === `${request.protocol}://${request.headers.host ?? ''}`;
  if (allowed) {
    next();
    return;
  }
  sendError(response, new ApiException('cross_site_request', 403));
}
