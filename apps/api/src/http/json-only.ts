import type { NextFunction, Request, Response } from 'express';
import { ApiException } from './api-exception.js';
import { sendError } from './error-response.js';
import { fileRouteOf, mediaTypeOf } from './file-routes.js';

/**
 * Refuses a request whose body is not JSON, before the body is read (task
 * 0.7c, from the review of 0.6a). A plain HTML form of another site can only
 * send form-encoded, multipart or plain-text bodies; none of them is read here,
 * whatever the route. A request without a body passes.
 *
 * A route that takes a file is a declared exception (`FILE_ROUTES` in
 * `file-routes.ts`, task 2.2c-2): it passes with one of its own types only,
 * and `fileBodyMiddleware` reads it. Every other route, and those routes with
 * any other type (multipart, form-encoded, plain text), is still refused.
 */
export function jsonOnlyMiddleware(request: Request, response: Response, next: NextFunction) {
  if (
    hasBody(request) &&
    !isJson(request.headers['content-type']) &&
    fileRouteOf(request) === undefined
  ) {
    sendError(response, new ApiException('unsupported_media_type', 415));
    return;
  }
  next();
}

/** A browser sends `Content-Length: 0` with a POST that has no body: that is no body. */
function hasBody(request: Request): boolean {
  if (request.headers['transfer-encoding'] !== undefined) {
    return true;
  }
  const length = request.headers['content-length'];
  return length !== undefined && length.trim() !== '0';
}

/** `application/json`, with or without parameters such as the charset. No type at all is not JSON. */
function isJson(contentType: string | undefined): boolean {
  return mediaTypeOf(contentType) === 'application/json';
}
