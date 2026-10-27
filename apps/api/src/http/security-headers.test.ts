import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { repositoryRoot } from '../database/config.js';
import { createTestApp } from '../testing/create-test-app.js';
import { CONTENT_SECURITY_POLICY, STRICT_TRANSPORT } from './security-headers.js';

const INDEX = '<!doctype html><html><body><div id="root"></div></body></html>';

const FIXED: Record<string, string> = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
};

function expectFixedHeaders(headers: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(FIXED)) {
    expect(headers[name], name).toBe(value);
  }
}

// docs/spec/13-technology.md, Security; task 10.3a: every answer of the
// server, the web app's files, the API's answers and its refusals, carries
// the security headers.
describe('the security headers', () => {
  let directory: string;
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sodiq-security-headers-'));
    await writeFile(path.join(directory, 'index.html'), INDEX);
    app = await createTestApp({ config: { webFiles: directory } });
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('are on an answer of the API', async () => {
    const response = await request(server).get('/api/health');

    expect(response.status).toBe(200);
    expectFixedHeaders(response.headers);
  });

  it('are on an unknown address of the API', async () => {
    const response = await request(server).get('/api/no-such-route');

    expect(response.status).toBe(404);
    expectFixedHeaders(response.headers);
  });

  it('are on a body refused before it is read', async () => {
    const response = await request(server)
      .post('/api/auth/sign-in')
      .set('Content-Type', 'text/plain')
      .send('login');

    expect(response.status).toBe(415);
    expectFixedHeaders(response.headers);
  });

  it('are on the web app, at the root and on a page of the app', async () => {
    for (const page of ['/', '/journal/42']) {
      const response = await request(server).get(page);

      expect(response.status).toBe(200);
      expect(response.text).toBe(INDEX);
      expectFixedHeaders(response.headers);
    }
  });

  it('leave out Strict-Transport-Security without the load balancer, so http://localhost works', async () => {
    const response = await request(server).get('/api/health');

    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('let no other site show a page in a frame, and run scripts of the own origin only', () => {
    const directives = CONTENT_SECURITY_POLICY.split('; ');

    expect(directives).toContain("frame-ancestors 'none'");
    expect(directives).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
  });
});

describe('the security headers behind the load balancer', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ config: { trustProxy: true } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('add Strict-Transport-Security for a year', async () => {
    const response = await request(app.getHttpServer() as Server).get('/api/health');

    expect(response.headers['strict-transport-security']).toBe(STRICT_TRANSPORT);
    expectFixedHeaders(response.headers);
  });
});

/** The HTML files of the web app that Vite builds or copies as they are. */
function webHtmlFiles(): string[] {
  const web = path.join(repositoryRoot, 'apps/web');
  const publicDirectory = path.join(web, 'public');
  const inPublic = readdirSync(publicDirectory, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.html'))
    .map((file) => path.join(publicDirectory, file));
  return [path.join(web, 'index.html'), ...inPublic];
}

// `script-src 'self'` blocks an inline script and an inline event handler: the
// pages must have none, or the app would not start on the servers. The browser
// tests run on Vite's development server, which sends no policy.
describe('the pages of the web app', () => {
  it('have no inline script and no inline event handler', () => {
    const files = webHtmlFiles();

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const html = readFileSync(file, 'utf8');
      const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((match) => match[1] ?? '');

      expect(
        scripts.every((attributes) => /\bsrc\s*=/.test(attributes)),
        file,
      ).toBe(true);
      expect(html, file).not.toMatch(/\son[a-z]+\s*=/i);
      expect(html, file).not.toMatch(/javascript:/i);
    }
  });
});
