import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../testing/create-test-app.js';
import { smokeTest, SmokeError } from './smoke.js';

// docs/build-plan.md, task 0.10: a smoke test after deploy; done when it passes
// on the test environment. Here it runs against the application as it runs
// on a server: with the web app's files and the live connection attached.
describe('the smoke test', () => {
  let directory: string;
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sodiq-smoke-'));
    await writeFile(
      path.join(directory, 'index.html'),
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );
    app = await createTestApp({ config: { webFiles: directory } });
    await app.listen(0, '127.0.0.1');
    const address = (app.getHttpServer() as Server).address() as AddressInfo;
    url = `http://127.0.0.1:${String(address.port)}`;
  });

  afterAll(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('passes every check against the application as it runs on a server', async () => {
    const results = await smokeTest(`${url}/`, { timeoutMs: 5000 });

    expect(results).toEqual([
      { name: 'health' },
      { name: 'web app' },
      { name: 'session without a cookie' },
      { name: 'a body that is not JSON' },
      { name: 'live connection' },
    ]);
  });

  it('fails, naming every failed check, when the address serves something else', async () => {
    const other = await createTestApp({ config: { webFiles: undefined } });
    await other.listen(0, '127.0.0.1');
    try {
      const address = other.getHttpServer().address() as AddressInfo;

      const failure = await smokeTest(`http://127.0.0.1:${String(address.port)}`, {
        timeoutMs: 5000,
      }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(SmokeError);
      expect((failure as Error).message).toContain('1 of 5 checks failed');
      expect((failure as Error).message).toContain('web app (status 404)');
    } finally {
      await other.close();
    }
  });

  it('fails when nothing answers at the address', async () => {
    await expect(smokeTest('http://127.0.0.1:1', { timeoutMs: 2000 })).rejects.toThrow(
      /5 of 5 checks failed/,
    );
  });
});
