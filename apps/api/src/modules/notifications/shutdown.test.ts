import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NOTIFICATION_MESSAGES, NOTIFICATION_SOCKET_PATH } from '@sodiq/shared';
import { sql } from 'kysely';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { ProbeController, signInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { LiveListener } from './live/listener.js';

/** The `application_name` of the listener's connection (listener.ts). */
const LISTENER_NAME = 'sodiq-api-live';

async function listenerConnections(database: TestDatabase): Promise<number> {
  const found = await sql<{ count: number }>`
    select count(*)::int as count from pg_stat_activity
    where application_name = ${LISTENER_NAME} and datname = current_database()
  `.execute(database.migrator);
  return found.rows[0]?.count ?? 0;
}

// All names are invented.
// docs/spec/13-technology.md, Hosting: releases are made without stopping the
// service. Task 0.10: on Render's stop signal the API closes in order: the
// listener's connection ends, the open live connections close without
// `session.ended` (the tab opens a new one on the next instance), the pool
// closes. The sessions themselves stay: nobody is signed out by a release.
describe('a stop of the API', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let socket: Socket;
  const closed: string[] = [];
  const ended: unknown[] = [];

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      database: database.app,
      clock: new FixedClock('2026-10-09T09:00:00+05:00'),
      controllers: [ProbeController],
    });
    await app.listen(0, '127.0.0.1');
    await app.get(LiveListener).start(database.appUrl);
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    const { cookie } = await signInKit(app).fullSession('Sardor', 'Alimov');
    socket = connect(`http://127.0.0.1:${String(port)}`, {
      path: NOTIFICATION_SOCKET_PATH,
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { Cookie: cookie },
    });
    socket.on(NOTIFICATION_MESSAGES.ended, (payload: unknown) => ended.push(payload));
    socket.on('disconnect', (reason) => closed.push(reason));
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
  });

  afterAll(async () => {
    socket.disconnect();
    await database.destroy();
  });

  it('ends the listener and the live connections, and signs nobody out', async () => {
    expect(await listenerConnections(database)).toBe(1);

    await app.close();

    for (let attempt = 0; attempt < 40 && closed.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(closed).toEqual(['transport close']);
    // No "session ended": the session is still there for the next instance.
    expect(ended).toEqual([]);
    // No reconnection by the listener after its stop.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await listenerConnections(database)).toBe(0);
    const sessions = await sql<{ count: number }>`
      select count(*)::int as count from sessions where ended_at is null
    `.execute(database.migrator);
    expect(sessions.rows[0]?.count).toBe(1);
  });
});
