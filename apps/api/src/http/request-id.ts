import { randomUUID } from 'node:crypto';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Gives every request its own id before anything else runs. The id is ours:
 * one sent by the client is ignored, so the log cannot be written by a caller.
 */
export function requestIdMiddleware(_request: Request, response: Response, next: NextFunction) {
  response.setHeader(REQUEST_ID_HEADER, randomUUID());
  next();
}

/** The id of the request that this answer belongs to. */
export function requestIdOf(response: Response): string {
  const id = response.getHeader(REQUEST_ID_HEADER);
  if (typeof id === 'string') {
    return id;
  }
  // Only if the middleware did not run; the answer still gets an id.
  const fresh = randomUUID();
  if (!response.headersSent) {
    response.setHeader(REQUEST_ID_HEADER, fresh);
  }
  return fresh;
}

/**
 * The id of the request, for the audit entries a route writes.
 *
 *     signIn(@RequestId() requestId: string)
 */
export const RequestId = createParamDecorator((_data: unknown, context: ExecutionContext): string =>
  requestIdOf(context.switchToHttp().getResponse<Response>()),
);
