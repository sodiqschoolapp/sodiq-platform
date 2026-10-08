import type { IncomingMessage } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { ApiException } from './api-exception.js';
import { sendError } from './error-response.js';

/** Requests that change nothing. Every other method is checked. */
const READING_METHODS = new Set(['GET', 'HEAD']);

/** What a browser sends for a request of our own page, or one the person typed. */
const OWN_SITE = new Set(['same-origin', 'none']);

/** The headers that say where a request came from, as a browser sends them. */
export interface SiteHeaders {
  'sec-fetch-site'?: string | string[] | undefined;
  origin?: string | string[] | undefined;
}

/**
 * Whether a request came from our own site, or from no site at all.
 *
 * - With `Sec-Fetch-Site` (every current browser sends it and a page cannot
 *   set it): only `same-origin` and `none` pass.
 * - Without it but with `Origin`: the origin must be `ownOrigin`, the
 *   protocol and host of the request itself.
 * - With neither, the caller is not a browser (a test, the uptime check, the
 *   later mobile apps) and cannot be made to carry somebody's cookie.
 *
 * The same rule serves the changing requests of the API (the middleware
 * below) and the handshake of the live connection (task 0.9), which does not
 * pass through the middleware.
 */
export function fromOwnSite(headers: SiteHeaders, ownOrigin: string): boolean {
  const site = headers['sec-fetch-site'];
  const origin = headers.origin;
  return site !== undefined
    ? typeof site === 'string' && OWN_SITE.has(site)
    : origin === undefined || origin === ownOrigin;
}

/**
 * The protocol and host the request was made to, as a browser writes them into
 * `Origin`. One helper for the requests of Express and for the handshake of
 * the live connection (task 0.9), so the two cannot drift apart.
 *
 * Behind a load balancer that ends TLS (Render, task 0.10) the connection to
 * the API is plain HTTP, and the browser's `Origin` is `https://…`: with
 * `trustProxy` the first hop's `X-Forwarded-Proto` says the protocol. Without
 * it (a laptop, CI) that header is ignored, so nobody can claim HTTPS.
 */
export function ownOriginOf(request: IncomingMessage, trustProxy: boolean): string {
  const forwarded = trustProxy ? firstValue(request.headers['x-forwarded-proto']) : undefined;
  const encrypted = (request.socket as { encrypted?: boolean }).encrypted === true;
  const protocol = forwarded ?? (encrypted ? 'https' : 'http');
  return `${protocol}://${request.headers.host ?? ''}`;
}

/**
 * Render sets `X-Forwarded-Proto` itself, so there is one value. Were a proxy
 * to append its value to one it received, the first would be the client's
 * claim: the same reading as Express's `request.protocol`, and a wrong claim
 * only makes the origin check fail.
 */
function firstValue(header: string | string[] | undefined): string | undefined {
  const text = Array.isArray(header) ? header[0] : header;
  const first = text?.split(',')[0]?.trim();
  return first === undefined || first === '' ? undefined : first;
}

/**
 * Refuses a changing request that another site started (cross-site request
 * forgery). The session cookie is `SameSite=Strict` already; this is the second
 * guard, and it needs no token because web app and API share one origin.
 */
export function sameSiteMiddleware(trustProxy: boolean) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (READING_METHODS.has(request.method)) {
      next();
      return;
    }
    if (fromOwnSite(request.headers, ownOriginOf(request, trustProxy))) {
      next();
      return;
    }
    sendError(response, new ApiException('cross_site_request', 403));
  };
}
