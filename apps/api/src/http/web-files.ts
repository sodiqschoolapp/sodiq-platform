import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';

/** The types of the files Vite writes; anything else is served as bytes. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Vite names every file here with a hash of its content: it never changes. */
const IMMUTABLE_PREFIX = '/assets/';
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** `index.html` and the few plain files: the browser asks again every time. */
const REVALIDATE = 'no-cache';

/**
 * Serves the web app's built files on the API's own origin (task 0.10; decided
 * by the owner: one origin for the cookie session, the cross-site check and
 * the live connection, with nothing in between). Everything outside the API
 * prefix is the web app: a path that is a file is sent, any other path gets
 * `index.html`, so the app's own router opens the page. Only GET and HEAD;
 * other methods fall through to the API's "not found".
 *
 * Caching is the opposite of the API's `no-store`: hashed assets for a year,
 * `index.html` checked at every load so that a release is seen at the next
 * open (`edge/system-behaviour`: a tab opened before a release).
 */
export function webFilesMiddleware(directory: string, apiPrefix: string) {
  const root = path.resolve(directory);
  const index = path.join(root, 'index.html');
  return (request: Request, response: Response, next: NextFunction): void => {
    if (
      isApiPath(request.path, apiPrefix) ||
      (request.method !== 'GET' && request.method !== 'HEAD')
    ) {
      next();
      return;
    }
    void serve(request, response, next, root, index);
  };
}

function isApiPath(requestPath: string, apiPrefix: string): boolean {
  return requestPath === `/${apiPrefix}` || requestPath.startsWith(`/${apiPrefix}/`);
}

async function serve(
  request: Request,
  response: Response,
  next: NextFunction,
  root: string,
  index: string,
): Promise<void> {
  try {
    const file = fileOf(root, request.path);
    const immutable = file !== undefined && request.path.startsWith(IMMUTABLE_PREFIX);
    if (file !== undefined && (await isFile(file))) {
      await send(request, response, file, immutable ? IMMUTABLE : REVALIDATE);
    } else {
      await send(request, response, index, REVALIDATE);
    }
  } catch (error) {
    next(error);
  }
}

/** The file under `root` that the path names, or none when the path climbs out of it. */
function fileOf(root: string, requestPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0')) {
    return undefined;
  }
  const file = path.resolve(root, `.${decoded}`);
  return file === root || file.startsWith(root + path.sep) ? file : undefined;
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function send(
  request: Request,
  response: Response,
  file: string,
  cacheControl: string,
): Promise<void> {
  const { size } = await stat(file);
  response.status(200);
  response.setHeader(
    'Content-Type',
    CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
  );
  response.setHeader('Content-Length', String(size));
  response.setHeader('Cache-Control', cacheControl);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(response);
  });
}
