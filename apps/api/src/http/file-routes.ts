import {
  EXEMPTION_FILE_MAX_BYTES,
  EXEMPTION_FILE_TYPES,
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
  PLAN_FILE_MAX_BYTES,
  PLAN_FILE_TYPES,
  type ErrorCode,
} from '@sodiq/shared';
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

/**
 * The own photo of the person signed in (task 2.3c-2, decision 2 of pull
 * request #66, Look first): the same kind, types and size as the staff photo.
 */
export const OWN_PHOTO_ROUTE: FileRoute = {
  method: 'PUT',
  path: '/api/auth/photo',
  types: PHOTO_TYPES,
  maxBytes: PHOTO_MAX_BYTES,
  tooLarge: 'photo_too_large',
};

/**
 * A student's photo (task 2.4b-2, decision 4 of pull request #70, Look
 * first; answer 2: "one upload route per photo kind"): the same types and
 * size as the staff photo.
 */
export const STUDENT_PHOTO_ROUTE: FileRoute = {
  method: 'PUT',
  path: '/api/people/students/:id/photo',
  types: PHOTO_TYPES,
  maxBytes: PHOTO_MAX_BYTES,
  tooLarge: 'photo_too_large',
};

/**
 * A file of a plan item (task 7.1a, pull request #212, decision 1, Look
 * first; edge/lesson-plans: "Limits: 20 MB per file, 10 files per item, a
 * fixed list of file types"). The name travels in the query.
 */
export const PLAN_FILE_ROUTE: FileRoute = {
  method: 'PUT',
  path: '/api/plans/items/:itemId/files',
  types: PLAN_FILE_TYPES,
  maxBytes: PLAN_FILE_MAX_BYTES,
  tooLarge: 'plan_file_too_large',
};

/**
 * The document of an exemption (task 8.5, pull request #223, decisions 8 and
 * 17, Look first): PDF, JPEG or PNG up to 10 MB. The name travels in the query.
 */
export const EXEMPTION_FILE_ROUTE: FileRoute = {
  method: 'PUT',
  path: '/api/exemptions/:id/document',
  types: EXEMPTION_FILE_TYPES,
  maxBytes: EXEMPTION_FILE_MAX_BYTES,
  tooLarge: 'exemption_file_too_large',
};

/**
 * The file of a reason of absence (task 6.3, decision 10, Look first; task
 * 8.5): the same kind as the exemption's document.
 */
export const ABSENCE_REASON_FILE_ROUTE: FileRoute = {
  method: 'PUT',
  path: '/api/journal/student-absences/:studentId/:date/file',
  types: EXEMPTION_FILE_TYPES,
  maxBytes: EXEMPTION_FILE_MAX_BYTES,
  tooLarge: 'exemption_file_too_large',
};

export const FILE_ROUTES: readonly FileRoute[] = [
  STAFF_PHOTO_ROUTE,
  OWN_PHOTO_ROUTE,
  STUDENT_PHOTO_ROUTE,
  PLAN_FILE_ROUTE,
  EXEMPTION_FILE_ROUTE,
  ABSENCE_REASON_FILE_ROUTE,
];

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
    // A client that goes away before the end: the chunks are let go (permission review).
    const onClose = () => {
      if (!request.complete) {
        chunks.length = 0;
        reject(new Error('The request was closed before its body ended.'));
      }
    };
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', reject);
    request.on('close', onClose);
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
