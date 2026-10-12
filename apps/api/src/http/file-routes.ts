import { PHOTO_MAX_BYTES, PHOTO_TYPES, type ErrorCode } from '@sodiq/shared';
import type { NextFunction, Request, Response } from 'express';
import { ApiException } from './api-exception.js';
import { sendError } from './error-response.js';

/**
 * The declared exceptions of the JSON-only rule (`json-only.ts`): the routes
 * that take a file as their body, each with the types it takes and its size
 * limit (task 2.2c-2; the owner's answer 2: "one upload route per photo kind
 * may take a file instead of JSON"). The file is the raw body, never
 * multipart: a cross-site HTML form can send only form-encoded, multipart and
 * plain-text bodies, so the reason for the JSON-only rule still holds.
 * A handler reads the file only through `ValidFile` with its entry here, and
 * a test pins this list against those handlers.
 */
export interface FileRoute {
  method: 'PUT';
  /** The full path as the route declares it, parameters as `:name`. */
  path: string;
  types: readonly string[];
  /** The largest body taken, in bytes; one more is refused with `tooLarge` (413). */
  maxBytes: number;
  tooLarge: ErrorCode;
}

/** A staff member's photo (task 2.2c-2). */
export const STAFF_PHOTO_ROUTE: FileRoute = {
  method: 'PUT',
  path: '/api/people/staff/:id/photo',
  types: PHOTO_TYPES,
  maxBytes: PHOTO_MAX_BYTES,
  tooLarge: 'photo_too_large',
};

export const FILE_ROUTES: readonly FileRoute[] = [STAFF_PHOTO_ROUTE];

/**
 * The body of a file route as `fileBodyMiddleware` read it. A class of its
 * own, so that no JSON body can pass for a file: JSON makes plain objects.
 */
export class UploadedFile {
  constructor(
    readonly bytes: Buffer,
    /** The media type the request declared, one of its route's `types`. */
    readonly type: string,
  ) {}
}

function matches(pattern: string, path: string): boolean {
  const wanted = pattern.split('/');
  const given = path.split('/');
  return (
    wanted.length === given.length &&
    wanted.every((part, index) => {
      const actual = given[index] ?? '';
      return part.startsWith(':') ? actual !== '' : part === actual;
    })
  );
}

/** The media type of a `Content-Type` header, without its parameters, in lower case. */
export function mediaTypeOf(contentType: string | undefined): string | undefined {
  return contentType?.split(';')[0]?.trim().toLowerCase();
}

/** The declared route a request is for, when it sends one of that route's types. */
export function fileRouteOf(request: Request): FileRoute | undefined {
  const type = mediaTypeOf(request.headers['content-type']);
  return FILE_ROUTES.find(
    (route) =>
      route.method === request.method &&
      matches(route.path, request.path) &&
      type !== undefined &&
      route.types.includes(type),
  );
}

/**
 * The body of a request as bytes, at most `limit` of them: `null` when it
 * is longer (the rest is not read). The length the request announces is
 * believed only to refuse early.
 */
function readBody(request: Request, limit: number): Promise<Buffer | null> {
  const announced = Number(request.headers['content-length']);
  if (Number.isFinite(announced) && announced > limit) {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    const onData = (chunk: Buffer) => {
      length += chunk.length;
      if (length > limit) {
        request.off('data', onData);
        request.off('end', onEnd);
        request.resume();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      resolve(Buffer.concat(chunks));
    };
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', reject);
  });
}

/**
 * Reads the body of a declared file route into an `UploadedFile`, before any
 * guard: a body over the limit is refused with the route's own code (413),
 * whoever sends it (correction 3 of the review of pull request #59). A
 * compressed body is not taken. Every other request passes untouched.
 */
export function fileBodyMiddleware(request: Request, response: Response, next: NextFunction) {
  const route = fileRouteOf(request);
  if (route === undefined) {
    next();
    return;
  }
  const encoding = request.headers['content-encoding']?.trim().toLowerCase();
  if (encoding !== undefined && encoding !== 'identity') {
    sendError(response, new ApiException('unsupported_media_type', 415));
    return;
  }
  readBody(request, route.maxBytes).then(
    (bytes) => {
      if (bytes === null) {
        sendError(response, new ApiException(route.tooLarge, 413));
        return;
      }
      if (bytes.length > 0) {
        request.body = new UploadedFile(bytes, mediaTypeOf(request.headers['content-type']) ?? '');
      }
      next();
    },
    () => {
      sendError(response, new ApiException('malformed_request', 400));
    },
  );
}
