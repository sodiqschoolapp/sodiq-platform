import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NOTIFICATION_SOCKET_PATH, apiErrorSchema } from '@sodiq/shared';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../testing/create-test-app.js';
import { FixedClock } from '../testing/fixed-clock.js';
import { ProbeController, signInKit, type SignInKit } from '../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { ownOriginOf } from './same-site.js';

/** A browser's own-site request through a load balancer that ended TLS. */
const BEHIND_TLS = { 'X-Forwarded-Proto': 'https' };

// All names are invented.
// docs/build-plan.md, task 0.10; docs/decisions.md 0.7c and progress 0.9:
// behind Render's load balancer the connection to the API is plain HTTP and
// the browser's Origin is https://…; with TRUST_PROXY=1 the first hop's
// X-Forwarded-Proto says the protocol, for the cross-site check of the API
// and for the handshake of the live connection alike. Without it the header
// is ignored, so a caller cannot claim HTTPS.
describe('the own origin behind a proxy', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let server: Server;
  let kit: SignInKit;
  let host: string;
  const open: Socket[] = [];

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      database: database.app,
      clock: new FixedClock('2026-10-09T09:00:00+05:00'),
      controllers: [ProbeController],
      config: { trustProxy: true },
    });
    kit = signInKit(app);
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
    host = `127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterEach(() => {
    for (const socket of open.splice(0)) {
      socket.disconnect();
    }
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  /** `connected`, or the code of the refusal. */
  function tab(cookie: string, headers: Record<string, string>): Promise<string> {
    const socket = connect(`http://${host}`, {
      path: NOTIFICATION_SOCKET_PATH,
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { Cookie: cookie, ...headers },
    });
    open.push(socket);
    return new Promise((resolve) => {
      socket.once('connect', () => {
        resolve('connected');
      });
      socket.once('connect_error', (error) => {
        resolve(error.message);
      });
    });
  }

  it('lets an HTTPS origin of a browser that sends no Sec-Fetch-Site through', async () => {
    const response = await request(server)
      .post('/api/auth/sign-in')
      .set(BEHIND_TLS)
      .set('Origin', `https://${host}`)
      .send({});

    // The route answers: the request passed the cross-site check.
    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(response.body).error.code).toBe('validation_failed');
  });

  it('still refuses an origin of another site, and an origin of the wrong protocol', async () => {
    for (const origin of ['https://another-site.example', `http://${host}`]) {
      const response = await request(server)
        .post('/api/auth/sign-in')
        .set(BEHIND_TLS)
        .set('Origin', origin)
        .send({});

      expect(response.status).toBe(403);
      expect(apiErrorSchema.parse(response.body).error.code).toBe('cross_site_request');
    }
  });

  it('reads the first hop only when a proxy appended its own value', () => {
    const request = {
      headers: { host, 'x-forwarded-proto': 'https, http' },
      socket: {},
    } as unknown as Parameters<typeof ownOriginOf>[0];

    expect(ownOriginOf(request, true)).toBe(`https://${host}`);
    expect(ownOriginOf(request, false)).toBe(`http://${host}`);
  });

  it('admits the live connection of a tab with an HTTPS origin, by the same rule', async () => {
    const { cookie } = await kit.fullSession('Dilnoza', 'Karimova');

    expect(await tab(cookie, { ...BEHIND_TLS, Origin: `https://${host}` })).toBe('connected');
    expect(await tab(cookie, { ...BEHIND_TLS, Origin: 'https://another-site.example' })).toBe(
      'cross_site_request',
    );
    expect(await tab(cookie, { ...BEHIND_TLS, Origin: `http://${host}` })).toBe(
      'cross_site_request',
    );
  });
});

describe('the own origin without a trusted proxy', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    app = await createTestApp({ config: { trustProxy: false } });
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('ignores a forged X-Forwarded-Proto: an HTTPS origin does not match a plain request', async () => {
    const host = `127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    const response = await request(server)
      .post('/api/auth/sign-in')
      .set(BEHIND_TLS)
      .set('Origin', `https://${host}`)
      .send({});

    expect(response.status).toBe(403);
    expect(apiErrorSchema.parse(response.body).error.code).toBe('cross_site_request');
  });
});
