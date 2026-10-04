import type { NextFunction, Request, Response } from 'express';

/**
 * Every answer says that nobody may keep it (task 0.7c, from the review of
 * 0.6a): a shared classroom computer keeps no answer of the API in the cache
 * of its browser, and neither does anything between the browser and the server.
 * Set before anything else runs, so refusals and unknown paths carry it too.
 */
export function noStoreMiddleware(_request: Request, response: Response, next: NextFunction) {
  response.setHeader('Cache-Control', 'no-store');
  next();
}
