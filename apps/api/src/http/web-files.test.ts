import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Logger, type INestApplication } from '@nestjs/common';
import type { ErrorEvent, NodeOptions } from '@sentry/node';
import { apiErrorSchema } from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startReporting, stopReporting } from '../reporting/reporting.js';
import { createTestApp } from '../testing/create-test-app.js';

const INDEX = '<!doctype html><html><body><div id="root"></div></body></html>';
const SCRIPT = 'console.log("built");';

// docs/build-plan.md, task 0.10; decided by the owner at the plan: the API
// serves the web app's built files, so web app and API are one origin for the
// cookie session, the cross-site check and the live connection.
describe('the web app served by the API', () => {
  let directory: string;
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sodiq-web-files-'));
    await writeFile(path.join(directory, 'index.html'), INDEX);
    await writeFile(path.join(directory, 'favicon.ico'), Buffer.from([0, 0, 1, 0]));
    await mkdir(path.join(directory, 'assets'));
    await writeFile(path.join(directory, 'assets', 'index-a1b2c3d4.js'), SCRIPT);
    app = await createTestApp({ config: { webFiles: directory } });
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('serves index.html at the root, checked by the browser at every load', async () => {
    const response = await request(server).get('/');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.text).toBe(INDEX);
  });

  it.each(['/timetable', '/account/password', '/journal/42?week=3', '/nothing-like-this'])(
    'gives index.html for the page %s, so the app opens it',
    async (page) => {
      const response = await request(server).get(page);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(response.text).toBe(INDEX);
    },
  );

  it('serves a hashed asset as immutable for a year', async () => {
    const response = await request(server).get('/assets/index-a1b2c3d4.js');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.text).toBe(SCRIPT);
  });

  it('serves a plain file outside assets, checked at every load', async () => {
    const response = await request(server).get('/favicon.ico');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/x-icon');
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.headers['content-length']).toBe('4');
  });

  it('answers HEAD with the headers and no body', async () => {
    const response = await request(server).head('/assets/index-a1b2c3d4.js');

    expect(response.status).toBe(200);
    expect(response.headers['content-length']).toBe(String(SCRIPT.length));
    expect(response.text).toBeUndefined();
  });

  it('gives index.html, never a file above the directory, for a path that climbs', async () => {
    for (const climb of ['/..%2Fpackage.json', '/assets/..%2F..%2Fpackage.json', '/%00']) {
      const response = await request(server).get(climb);

      expect(response.status).toBe(200);
      expect(response.text).toBe(INDEX);
    }
  });

  it('decides "immutable" from the file, not from the path as typed', async () => {
    const response = await request(server).get('/assets/..%2Findex.html');

    expect(response.status).toBe(200);
    expect(response.text).toBe(INDEX);
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('gives index.html for a directory path', async () => {
    for (const directory of ['/assets', '/assets/']) {
      const response = await request(server).get(directory);

      expect(response.status).toBe(200);
      expect(response.text).toBe(INDEX);
      expect(response.headers['cache-control']).toBe('no-cache');
    }
  });

  it('leaves the API alone whatever the case of the prefix, as Express routes', async () => {
    const response = await request(server).get('/API/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('leaves the API alone: its answers keep no-store and its unknown paths are 404', async () => {
    const health = await request(server).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok' });
    expect(health.headers['cache-control']).toBe('no-store');

    const unknown = await request(server).get('/api/no-such-route');
    expect(unknown.status).toBe(404);
    expect(apiErrorSchema.parse(unknown.body).error.code).toBe('not_found');

    const prefixOnly = await request(server).get('/api');
    expect(prefixOnly.status).toBe(404);
    expect(apiErrorSchema.parse(prefixOnly.body).error.code).toBe('not_found');
  });

  it('answers a method other than GET or HEAD on a page as the API does: not found', async () => {
    const response = await request(server).post('/timetable').send({});

    expect(response.status).toBe(404);
    expect(apiErrorSchema.parse(response.body).error.code).toBe('not_found');
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

// From the owner's review: startup is the only gate before a new version takes
// traffic; a wrong directory must not pass the health check and answer 500 pages.
describe('a wrong WEB_FILES', () => {
  it('stops the start when the directory has no index.html, naming the variable', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'sodiq-web-files-empty-'));
    try {
      await expect(createTestApp({ config: { webFiles: empty } })).rejects.toThrow(
        /WEB_FILES must be a directory/,
      );
      await expect(
        createTestApp({ config: { webFiles: path.join(empty, 'missing') } }),
      ).rejects.toThrow(/WEB_FILES must be a directory/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

// From the owner's review: a tab that closes or moves on while a file is
// being sent is not a fault of the server; nothing is logged or reported.
describe('a download the browser abandons', () => {
  let directory: string;
  let app: INestApplication;
  let port: number;
  const events: ErrorEvent[] = [];
  const transport: NodeOptions['transport'] = () => ({
    send: (envelope) => {
      for (const [header, payload] of envelope[1] as [{ type: string }, unknown][]) {
        if (header.type === 'event') {
          events.push(payload as ErrorEvent);
        }
      }
      return Promise.resolve({});
    },
    flush: () => Promise.resolve(true),
  });

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sodiq-web-files-large-'));
    await writeFile(path.join(directory, 'index.html'), INDEX);
    await mkdir(path.join(directory, 'assets'));
    // Far more than the socket's buffers hold: the send is still under way when the client goes.
    await writeFile(
      path.join(directory, 'assets', 'big-0123abcd.js'),
      Buffer.alloc(32 * 1024 * 1024, 0x20),
    );
    startReporting(
      {
        dsn: 'https://0123456789abcdef@o0.ingest.sentry.example/1',
        environment: 'test',
        release: undefined,
      },
      { transport, processHandlers: false },
    );
    app = await createTestApp({ config: { webFiles: directory } });
    await app.listen(0, '127.0.0.1');
    port = ((app.getHttpServer() as Server).address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
    await stopReporting();
    await rm(directory, { recursive: true, force: true });
  });

  it('is neither logged nor reported', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      await new Promise<void>((resolve, reject) => {
        const call = http.get(
          { host: '127.0.0.1', port, path: '/assets/big-0123abcd.js' },
          (response) => {
            expect(response.statusCode).toBe(200);
            // Read nothing: the server's buffers fill, then the client is gone.
            response.destroy();
            resolve();
          },
        );
        call.on('error', reject);
      });
      await delay(500);

      expect(logged).not.toHaveBeenCalled();
      expect(events).toEqual([]);
      // The server still answers afterwards.
      const health = await request(app.getHttpServer() as Server).get('/api/health');
      expect(health.status).toBe(200);
    } finally {
      logged.mockRestore();
    }
  });
});

describe('without WEB_FILES', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ config: { webFiles: undefined } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves nothing outside the API: a page is not found', async () => {
    const response = await request(app.getHttpServer() as Server).get('/');

    expect(response.status).toBe(404);
    expect(apiErrorSchema.parse(response.body).error.code).toBe('not_found');
  });
});
