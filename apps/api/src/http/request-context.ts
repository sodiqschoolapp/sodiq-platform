import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * What the request is known to carry, for code that runs during it without
 * the request object: today the integration key it was made through (task
 * 10.10, decision 12 of pull request #369), which `Audit.record` names on
 * every entry written while the request runs.
 */
export interface RequestContext {
  /** Set by `SessionGuard` once the key is found; never by anything the caller sends. */
  integrationKey?: { id: string; name: string };
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Opens an empty context for every request, before anything else reads it.
 * The store is the request's own object: the guard fills it, and every
 * continuation of the request (the route, its transactions, its audit
 * entries) reads the same object. A job runs outside a request and sees none.
 */
export function requestContextMiddleware(
  _request: Request,
  _response: Response,
  next: NextFunction,
): void {
  storage.run({}, next);
}

/** The context of the request being served, or none outside a request (a job, a command). */
export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
