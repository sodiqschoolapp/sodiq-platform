import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { apiErrorSchema } from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
