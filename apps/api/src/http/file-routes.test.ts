import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import { apiErrorSchema, PHOTO_MAX_BYTES } from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../testing/create-test-app.js';
import { jpegOf } from '../testing/photos-kit.js';
import { routesOf } from '../testing/routes.js';
import { FILE_ROUTES } from './file-routes.js';

const PATH = '/api/people/staff/0199a000-0000-7000-8000-000000000099/photo';

/** Sends a body in chunks, with no length, as a client may. */
function sendChunked(
  server: Server,
  type: string,
  chunks: Buffer[],
): Promise<{ status: number; body: unknown }> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      { port, method: 'PUT', path: PATH, headers: { 'Content-Type': type } },
      (response) => {
        const parts: Buffer[] = [];
        response.on('data', (part: Buffer) => parts.push(part));
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown,
          });
        });
      },
    );
    outgoing.on('error', (error: NodeJS.ErrnoException) => {
      // The server may answer and close before the rest is sent.
      if (error.code !== 'EPIPE' && error.code !== 'ECONNRESET') {
        reject(error);
      }
    });
    for (const chunk of chunks) {
      outgoing.write(chunk);
    }
    outgoing.end();
  });
}

const codeOf = (body: unknown) => apiErrorSchema.parse(body).error.code;

// Task 2.2c-2: the declared exceptions of the JSON-only rule
// (.claude/rules/api.md; the note of 0.7c: "a short list of method and path
// in this folder, pinned by a test against the declaration of the route").
describe('declared file routes', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('are exactly the handlers that read a file, at their method and path', () => {
    const declared = routesOf(app)
      .filter((route) => route.takesFile !== undefined)
      .map((route) => ({ method: route.method, path: route.path, file: route.takesFile }));
    expect(declared).toEqual(
      FILE_ROUTES.map((route) => ({ method: route.method, path: route.path, file: route })),
    );
  });

  it('read a file before the guards: a small one reaches the sign-in check', async () => {
    const response = await request(server)
      .put(PATH)
      .set('Content-Type', 'image/jpeg')
      .send(jpegOf(10, 10));
    expect(response.status).toBe(401);
    expect(codeOf(response.body)).toBe('not_signed_in');
  });

  it('refuse more than the limit with their own code, also sent in chunks without a length', async () => {
    const announced = await request(server)
      .put(PATH)
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(PHOTO_MAX_BYTES + 1));
    expect(announced.status).toBe(413);
    expect(codeOf(announced.body)).toBe('photo_too_large');

    const chunked = await sendChunked(server, 'image/jpeg', [
      Buffer.alloc(PHOTO_MAX_BYTES / 2),
      Buffer.alloc(PHOTO_MAX_BYTES / 2),
      Buffer.alloc(1),
    ]);
    expect(chunked.status).toBe(413);
    expect(codeOf(chunked.body)).toBe('photo_too_large');

    const exact = await sendChunked(server, 'image/jpeg', [
      Buffer.alloc(PHOTO_MAX_BYTES / 2),
      Buffer.alloc(PHOTO_MAX_BYTES / 2),
    ]);
    expect(exact.status).toBe(401);
  });

  it('refuse a compressed body and every type they do not declare', async () => {
    const compressed = await request(server)
      .put(PATH)
      .set('Content-Type', 'image/jpeg')
      .set('Content-Encoding', 'gzip')
      .send(gzipSync(jpegOf(10, 10)));
    expect(compressed.status).toBe(415);
    expect(codeOf(compressed.body)).toBe('unsupported_media_type');
    for (const type of [
      'multipart/form-data; boundary=x',
      'application/x-www-form-urlencoded',
      'text/plain',
      'image/webp',
    ]) {
      const response = await request(server).put(PATH).set('Content-Type', type).send('x=1');
      expect(response.status, type).toBe(415);
      expect(codeOf(response.body)).toBe('unsupported_media_type');
    }
  });

  it('take nothing but JSON on the same path with another method', async () => {
    const response = await request(server)
      .post(PATH)
      .set('Content-Type', 'image/jpeg')
      .send(jpegOf(10, 10));
    expect(response.status).toBe(415);
  });
});
