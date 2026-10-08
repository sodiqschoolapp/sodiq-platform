import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  NOTIFICATION_MESSAGES,
  NOTIFICATION_SOCKET_PATH,
  notificationListSchema,
  type Notification,
} from '@sodiq/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { JobRunner } from '../../jobs/job-runner.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import {
  NEW_PASSWORD,
  ProbeController,
  signInKit,
  type SignInKit,
} from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { AccountLocks } from '../auth/account-locks.service.js';
import { IDLE_LIMIT_MS } from '../auth/idle-limit.js';
import { Sessions } from '../auth/sessions.service.js';
import { LiveListener } from './live/listener.js';
import { LiveSockets } from './live/socket-server.js';
import { Notifications } from './notifications.service.js';

const START = '2026-10-08T09:00:00+05:00';
const MINUTE_MS = 60 * 1000;
/** How long a message may take through the queue, the channel and the socket. */
const ARRIVAL_MS = 10_000;
/** How long to wait for a message that must not come. */
const SILENCE_MS = 500;

// All names are invented.
// docs/spec/13-technology.md: Socket.IO for live updates; two application
// servers behind a load balancer. docs/build-plan.md, task 0.9: live arrival
// over Socket.IO; done when a test event reaches the right person and nobody
// else. Decided by the owner at the plan: the handshake refuses another site,
// no session, a session that is over, a locked account and an owed step; a
// connection is not use of the session; every connection gets the state; a
// push always goes through the job and the channel.
describe('the live connection', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let url: string;
  let north: string;
  const clock = new FixedClock(START);
  const open: Socket[] = [];

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    app = await createTestApp({
      database: database.app,
      jobsDatabaseUrl: database.appUrl,
      jobsPollingIntervalSeconds: 0.5,
      clock,
      controllers: [ProbeController],
    });
    kit = signInKit(app);
    await app.listen(0, '127.0.0.1');
    const address = (app.getHttpServer() as Server).address() as AddressInfo;
    url = `http://127.0.0.1:${String(address.port)}`;
    // As the worker and the API process: the job runs here, the channel is heard here.
    await app.get(JobRunner).start();
    await app.get(LiveListener).start(database.appUrl);
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

  /** A tab: the cookie it holds and the headers a browser would add. */
  function tab(cookie?: string, headers: Record<string, string> = {}): Socket {
    const socket = connect(url, {
      path: NOTIFICATION_SOCKET_PATH,
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { ...(cookie === undefined ? {} : { Cookie: cookie }), ...headers },
    });
    open.push(socket);
    return socket;
  }

  /** The next message of a kind, or a failure after `ARRIVAL_MS`. */
  function next<T>(socket: Socket, message: string, timeoutMs = ARRIVAL_MS): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`No "${message}" within ${String(timeoutMs)} ms.`));
      }, timeoutMs);
      socket.once(message, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  /** The connection and the state that comes with it. */
  async function connected(socket: Socket): Promise<unknown> {
    const state = next<unknown>(socket, NOTIFICATION_MESSAGES.state);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', (error) => {
        reject(new Error(error.message));
      });
    });
    return state;
  }

  /** The code of a refused handshake. */
  function refused(socket: Socket): Promise<string> {
    return new Promise((resolve, reject) => {
      socket.once('connect_error', (error) => {
        resolve(error.message);
      });
      socket.once('connect', () => {
        reject(new Error('The handshake was not refused.'));
      });
    });
  }

  /** Resolves when nothing of the kind came within `SILENCE_MS`; fails when something did. */
  function silence(socket: Socket, message: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const heard = (payload: unknown) => {
        clearTimeout(timer);
        reject(new Error(`A "${message}" came: ${JSON.stringify(payload)}`));
      };
      const timer = setTimeout(() => {
        socket.off(message, heard);
        resolve();
      }, SILENCE_MS);
      socket.once(message, heard);
    });
  }

  function send(accountIds: string[], text: string): Promise<string[]> {
    return app.get(Transactions).run([north], (transaction) =>
      app.get(Notifications).send(transaction, {
        kind: 'sample.message',
        data: { text },
        branchId: north,
        accountIds,
      }),
    );
  }

  const list = async (cookie: string) =>
    notificationListSchema.parse((await kit.get('/api/notifications', cookie)).body);

  const lastUsedAt = async (accountId: string): Promise<Date[]> =>
    (
      await database.migrator
        .selectFrom('sessions')
        .select('last_used_at')
        .where('account_id', '=', accountId)
        .execute()
    ).map((row) => row.last_used_at);

  describe('at the handshake', () => {
    it('gives a complete session its state: the unread count and the latest items', async () => {
      clock.set(START);
      const { account, cookie } = await kit.fullSession('Aziza', 'Yusupova');
      const [id] = await send([account.id], 'Before the connection.');

      const state = await connected(tab(cookie));

      expect(state).toEqual({
        unreadCount: 1,
        items: [
          {
            id,
            kind: 'sample.message',
            data: { text: 'Before the connection.' },
            branchId: north,
            branchName: 'North',
            createdAt: clock.now().toISOString(),
            readAt: null,
          },
        ],
      });
    });

    it('does not count as use of the session', async () => {
      clock.set(START);
      const { account, cookie } = await kit.fullSession('Bahrom', 'Yusupov');
      const before = await lastUsedAt(account.id);
      clock.advance(5 * MINUTE_MS);

      await connected(tab(cookie));

      expect(await lastUsedAt(account.id)).toEqual(before);
    });

    it('refuses a tab without a session cookie', async () => {
      expect(await refused(tab())).toBe('not_signed_in');
    });

    it('refuses a session that was signed out', async () => {
      const { cookie } = await kit.fullSession('Dilnoza', 'Yusupova');
      expect((await kit.post('/api/auth/sign-out', cookie)).status).toBe(204);

      expect(await refused(tab(cookie))).toBe('not_signed_in');
    });

    it('refuses a session that is over by time, without ending it itself', async () => {
      clock.set(START);
      const { account, cookie } = await kit.fullSession('Elmira', 'Yusupova');
      clock.advance(IDLE_LIMIT_MS + MINUTE_MS);

      expect(await refused(tab(cookie))).toBe('not_signed_in');

      const rows = await database.migrator
        .selectFrom('sessions')
        .select('ended_at')
        .where('account_id', '=', account.id)
        .execute();
      expect(rows.map((row) => row.ended_at)).toEqual([null]);
    });

    it('refuses a session of a locked account', async () => {
      clock.set(START);
      const { account, cookie } = await kit.fullSession('Farrux', 'Yusupov');
      const { account: admin } = await kit.fullSession('Gulnora', 'Yusupova');
      await app.get(Transactions).run([], (transaction) =>
        app.get(AccountLocks).lock(transaction, {
          accountId: account.id,
          lockedBy: admin.id,
          reason: 'A test lock.',
        }),
      );

      expect(await refused(tab(cookie))).toBe('not_signed_in');
    });

    it('refuses a session of a locked account also while the session row is still open', async () => {
      clock.set(START);
      const { account, cookie } = await kit.fullSession('Gulbahor', 'Yusupova');
      const { account: admin } = await kit.fullSession('Hakim', 'Yusupov');
      // A lock ends the sessions; the check of the account itself is the one looked at here.
      await database.migrator
        .updateTable('accounts')
        .set({ locked_at: clock.now(), locked_by: admin.id, lock_reason: 'A test lock.' })
        .where('id', '=', account.id)
        .execute();

      expect(await refused(tab(cookie))).toBe('not_signed_in');
    });

    it('refuses a handshake whose check failed, and goes on', async () => {
      const { cookie } = await kit.fullSession('Husan', 'Yusupov');
      const peek = vi.spyOn(app.get(Sessions), 'peek').mockRejectedValueOnce(new Error('away'));

      expect(await refused(tab(cookie))).toBe('not_signed_in');

      peek.mockRestore();
      await connected(tab(cookie));
    });

    it('refuses a session that still owes a step of its sign-in, naming the step', async () => {
      const first = await kit.firstSession('Hamid', 'Yusupov');
      expect(await refused(tab(first.cookie))).toBe('password_change_required');

      const { account, cookie } = await kit.fullSession('Iroda', 'Yusupova');
      await kit.setUpSecondStep(cookie);
      const pending = await kit.signIn(account.login, NEW_PASSWORD);
      const pendingCookie = pending.headers['set-cookie'] as string[] | undefined;
      const sessionCookie = pendingCookie?.find((line) => line.startsWith('__Host-sodiq_session='));
      expect(await refused(tab(sessionCookie?.split(';')[0] ?? ''))).toBe('second_step_required');

      const vice = await kit.fullSession('Jasur', 'Yusupov');
      await kit.giveRole(vice.account.id, { role: 'academic_vice_principal', branchId: north });
      expect(await refused(tab(vice.cookie))).toBe('second_step_set_up_required');
    });

    it('refuses a request from another site, by the rule of the API', async () => {
      const { cookie } = await kit.fullSession('Kamola', 'Yusupova');

      expect(await refused(tab(cookie, { 'Sec-Fetch-Site': 'cross-site' }))).toBe(
        'cross_site_request',
      );
      expect(await refused(tab(cookie, { 'Sec-Fetch-Site': 'same-site' }))).toBe(
        'cross_site_request',
      );
      expect(await refused(tab(cookie, { Origin: 'https://other.example' }))).toBe(
        'cross_site_request',
      );
      await connected(
        tab(cookie, { 'Sec-Fetch-Site': 'same-origin', Origin: 'https://x.example' }),
      );
      await connected(tab(cookie, { Origin: url }));
    });
  });

  describe('tells the tabs of the person', () => {
    it('of a new notification, as the list answers it, and tells nobody else', async () => {
      clock.set(START);
      const mine = await kit.fullSession('Laziz', 'Yusupov');
      const other = await kit.fullSession('Malika', 'Yusupova');
      const myTab = tab(mine.cookie);
      const myOtherTab = tab(mine.cookie);
      const theirTab = tab(other.cookie);
      await Promise.all([connected(myTab), connected(myOtherTab), connected(theirTab)]);
      const arrivals = [
        next<{ items: Notification[] }>(myTab, NOTIFICATION_MESSAGES.new),
        next<{ items: Notification[] }>(myOtherTab, NOTIFICATION_MESSAGES.new),
      ];
      const nothing = silence(theirTab, NOTIFICATION_MESSAGES.new);

      const [id] = await send([mine.account.id], 'Only for one person.');

      const [first, second] = await Promise.all(arrivals);
      const expected = (await list(mine.cookie)).items.find((item) => item.id === id);
      expect(first).toEqual({ items: [expected] });
      expect(second).toEqual({ items: [expected] });
      await nothing;
    });

    it('of a read mark made in another tab, and of "read all"', async () => {
      clock.set(START);
      const { account, cookie } = await kit.fullSession('Nodir', 'Yusupov');
      const [id] = await send([account.id], 'To be read.');
      await send([account.id], 'To be read too.');
      const other = tab(cookie);
      await connected(other);
      clock.advance(MINUTE_MS);

      const read = next<unknown>(other, NOTIFICATION_MESSAGES.read);
      expect((await kit.post(`/api/notifications/${id ?? ''}/read`, cookie)).status).toBe(204);
      expect(await read).toEqual({ ids: [id], readAt: clock.now().toISOString() });

      clock.advance(MINUTE_MS);
      const readAll = next<unknown>(other, NOTIFICATION_MESSAGES.readAll);
      expect((await kit.post('/api/notifications/read-all', cookie)).status).toBe(204);
      expect(await readAll).toEqual({ readAt: clock.now().toISOString() });
    });

    it('with the state at a reconnection: what was sent while the tab was away is in it', async () => {
      clock.set(START);
      const { account, cookie } = await kit.fullSession('Otabek', 'Yusupov');
      const first = tab(cookie);
      await connected(first);
      first.disconnect();
      await send([account.id], 'While away.');
      await send([account.id], 'And again.');

      const state = await connected(tab(cookie));

      expect(notificationListSchema.parse(state)).toMatchObject({
        unreadCount: 2,
        items: [{ data: { text: 'And again.' } }, { data: { text: 'While away.' } }],
      });
    });

    it('nothing once the session ended: the tab is told so and closed at the next push', async () => {
      clock.set(START);
      const { account, cookie } = await kit.fullSession('Parvina', 'Yusupova');
      const stale = tab(cookie);
      await connected(stale);
      expect(await app.get(LiveSockets).connectionsOf(account.id)).toBe(1);
      expect((await kit.post('/api/auth/sign-out', cookie)).status).toBe(204);
      const ended = next<unknown>(stale, NOTIFICATION_MESSAGES.ended);
      const closed = next<string>(stale, 'disconnect');
      const nothing = silence(stale, NOTIFICATION_MESSAGES.new);

      await send([account.id], 'After the sign-out.');

      expect(await ended).toEqual({ code: 'not_signed_in' });
      expect(await closed).toBe('io server disconnect');
      await nothing;
      expect(await app.get(LiveSockets).connectionsOf(account.id)).toBe(0);
    });

    it('nothing once the session owes a step again: told with the step, and closed', async () => {
      clock.set(START);
      const { account, cookie } = await kit.fullSession('Shahlo', 'Yusupova');
      const socket = tab(cookie);
      await connected(socket);
      // The Academic Vice Principal must set up the second step: the open session owes it now.
      await kit.giveRole(account.id, { role: 'academic_vice_principal', branchId: north });
      const ended = next<unknown>(socket, NOTIFICATION_MESSAGES.ended);
      const nothing = silence(socket, NOTIFICATION_MESSAGES.new);

      await send([account.id], 'After the role was given.');

      expect(await ended).toEqual({ code: 'second_step_set_up_required' });
      await nothing;
      expect(socket.connected).toBe(false);
    });

    it('and acts on nothing a tab sends', async () => {
      clock.set(START);
      const { account, cookie } = await kit.fullSession('Rustam', 'Yusupov');
      const [id] = await send([account.id], 'Not to be marked by a message.');
      const socket = tab(cookie);
      await connected(socket);

      socket.emit(NOTIFICATION_MESSAGES.read, { ids: [id] });
      socket.emit(NOTIFICATION_MESSAGES.readAll, {});
      socket.emit('anything', { accountId: account.id });
      await silence(socket, NOTIFICATION_MESSAGES.read);

      expect((await list(cookie)).unreadCount).toBe(1);
      expect(socket.connected).toBe(true);
    });
  });
});
