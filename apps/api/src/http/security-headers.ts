import type { NextFunction, Request, Response } from 'express';

/**
 * What the browser may load and run for a page of this server (task 10.3a).
 *
 * - Scripts only from the own origin: Vite builds the entry as
 *   `<script type="module" src>`, and no page has an inline script
 *   (`security-headers.test.ts` holds `apps/web/index.html` to that).
 * - Styles also inline: AG Grid adds `<style>` elements to the page at run
 *   time and draws its icons as SVG with a `<style>` inside.
 * - Images and fonts also as `data:` and `blob:` (the grid's icons, a photo
 *   chosen before it is sent).
 * - Requests to the own origin, the live connection included, and to Sentry,
 *   where the web app sends its error reports (`apps/web/src/reporting`).
 * - `blob:` frames and objects for Print, which opens the PDF made in the
 *   browser in a new tab; that tab keeps this policy.
 * - No page of another site may show these pages in a frame.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.sentry.io",
  "frame-src 'self' blob:",
  "object-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** A year, once the address is only reached over HTTPS behind the load balancer. */
export const STRICT_TRANSPORT = 'max-age=31536000';

const FIXED_HEADERS: readonly (readonly [string, string])[] = [
  ['Content-Security-Policy', CONTENT_SECURITY_POLICY],
  ['X-Frame-Options', 'DENY'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'same-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
];

/**
 * The security headers of every answer, the web app's files and the API's
 * answers and refusals alike (`docs/spec/13-technology.md`, Security). It runs
 * before anything else answers. `Strict-Transport-Security` only behind the
 * load balancer of the servers (`trustProxy`, task 0.10), which ends HTTPS: a
 * local `http://localhost` must keep working.
 */
export function securityHeadersMiddleware(behindProxy: boolean) {
  return (_request: Request, response: Response, next: NextFunction): void => {
    for (const [name, value] of FIXED_HEADERS) {
      response.setHeader(name, value);
    }
    if (behindProxy) {
      response.setHeader('Strict-Transport-Security', STRICT_TRANSPORT);
    }
    next();
  };
}
