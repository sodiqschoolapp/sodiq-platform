import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NOTIFICATION_LIST_LIMIT, notificationListSchema } from '@sodiq/shared';
import { sql } from 'kysely';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { JobRunner } from '../../jobs/job-runner.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { storedJobs } from '../../testing/sample-job.js';
import {
  cookieOf,
  errorCode,
  NEW_PASSWORD,
  ProbeController,
  signInKit,
  type SignInKit,
} from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { deliverNotifications, deliverNotificationsJob } from './deliver.job.js';
import {
  LIVE_CHANNEL,
  LIVE_CHUNK,
  livePayloadSchema,
  type LivePayload,
} from './live/live-payload.js';
import { Notifications, type NewNotification } from './notifications.service.js';

const START = '2026-10-08T09:00:00+05:00';
const MINUTE_MS = 60 * 1000;
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA';

// All names are invented.
// docs/spec/10-portal-notifications-release-2.md, Notifications, last
// paragraph: staff notifications in the app are Release 1. docs/build-plan.md,
// task 0.9, done when: a test event reaches the right person and nobody else.
// Decided by the owner at the plan: one row per person, the text made in the
// browser from the kind and its data, the delivery through a job in the same
// transaction, no audit entry for a notification sent or read.
describe('notifications', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let transactions: Transactions;
  let notifications: Notifications;
  let north: string;
  let south: string;
  const clock = new FixedClock(START);

  /** A connection of its own that hears the channel, as the API process does. */
  let ear: Client;
  let heard: LivePayload[] = [];

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    app = await createTestApp({
      database: database.app,
      jobsDatabaseUrl: database.appUrl,
      clock,
      controllers: [ProbeController],
    });
    kit = signInKit(app);
    transactions = app.get(Transactions);
    notifications = app.get(Notifications);
    ear = new Client({ connectionString: database.appUrl });
    ear.on('notification', (message) => {
      heard.push(livePayloadSchema.parse(JSON.parse(message.payload ?? '')));
    });
    await ear.connect();
    await ear.query(`listen ${LIVE_CHANNEL}`);
  });

  afterAll(async () => {
    await ear.end();
    await app.close();
    await database.destroy();
  });

  /** Sends as a later task would: in a transaction of its own, for the branch of the event. */
  function send(
    accountIds: string[],
    fields: Partial<NewNotification<'sample.message'>> = {},
  ): Promise<string[]> {
    const branchId = fields.branchId ?? null;
    return transactions.run(branchId === null ? [] : [branchId], (transaction) =>
      notifications.send(transaction, {
        kind: 'sample.message',
        data: { text: 'The timetable of Monday changed.' },
        branchId,
        accountIds,
        ...fields,
      }),
    );
  }

  const rowsOf = (accountId: string) =>
    database.migrator
      .selectFrom('notifications')
      .selectAll()
      .where('account_id', '=', accountId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();

  const list = async (cookie: string) => {
    const response = await kit.get('/api/notifications', cookie);
    expect(response.status).toBe(200);
    return notificationListSchema.parse(response.body);
  };

  const auditRows = async (): Promise<number> => {
    const school = await database.migrator
      .selectFrom('audit_log_school')
      .select((builder) => builder.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    const branch = await database.migrator
      .selectFrom('audit_log')
      .select((builder) => builder.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    return Number(school.n) + Number(branch.n);
  };

  /** Waits until the channel delivered what a committed transaction sent. */
  async function heardAfter(count: number): Promise<LivePayload[]> {
    for (let attempt = 0; attempt < 40 && heard.length < count; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return heard;
  }

  describe('are sent by the helper', () => {
    it('as one row per account with the moment of the clock, and one delivery job with no branch, in the same transaction', async () => {
      clock.set(START);
      const { account: one } = await kit.fullSession('Aziza', 'Qodirova');
      const { account: two } = await kit.fullSession('Bahrom', 'Qodirov');
      const before = (await storedJobs(database.migrator)).length;

      const ids = await send([one.id, two.id, one.id], { branchId: north });

      expect(ids).toHaveLength(2);
      const rows = [...(await rowsOf(one.id)), ...(await rowsOf(two.id))];
      expect(rows.map((row) => row.id).sort()).toEqual([...ids].sort());
      expect(rows).toMatchObject([
        {
          account_id: one.id,
          branch_id: north,
          kind: 'sample.message',
          data: { text: 'The timetable of Monday changed.' },
          created_at: new Date(START),
          read_at: null,
        },
        { account_id: two.id, branch_id: north, read_at: null },
      ]);
      const jobs = (await storedJobs(database.migrator)).slice(before);
      expect(jobs).toMatchObject([
        {
          name: deliverNotificationsJob.name,
          state: 'created',
          data: { branchIds: [], data: { notificationIds: ids } },
        },
      ]);
      expect(await auditRows()).toBe(await auditRows());
    });

    it('and nothing stays when the transaction rolls back', async () => {
      const { account } = await kit.fullSession('Dilnoza', 'Qodirova');
      const before = (await storedJobs(database.migrator)).length;

      await expect(
        transactions.run([], async (transaction) => {
          await notifications.send(transaction, {
            kind: 'sample.message',
            data: { text: 'Undone.' },
            branchId: null,
            accountIds: [account.id],
          });
          throw new Error('The change failed.');
        }),
      ).rejects.toThrow('The change failed.');

      expect(await rowsOf(account.id)).toEqual([]);
      expect((await storedJobs(database.migrator)).length).toBe(before);
    });

    it('refuses an unknown kind, data that does not fit the kind, no recipient, and a branch the transaction does not work for', async () => {
      const { account } = await kit.fullSession('Elmira', 'Qodirova');

      await expect(
        send([account.id], { kind: 'timetable.changed' as 'sample.message' }),
      ).rejects.toThrow('not in the list of kinds');
      await expect(send([account.id], { data: { text: '' } })).rejects.toThrow(
        'does not fit its kind',
      );
      await expect(
        send([account.id], { data: { text: 'x', extra: 1 } as { text: string } }),
      ).rejects.toThrow('does not fit its kind');
      await expect(send([])).rejects.toThrow('at least one account');
      await expect(
        transactions.run([north], (transaction) =>
          notifications.send(transaction, {
            kind: 'sample.message',
            data: { text: 'Wrong branch.' },
            branchId: south,
            accountIds: [account.id],
          }),
        ),
      ).rejects.toThrow('does not work for');
      expect(await rowsOf(account.id)).toEqual([]);
    });

    it('writes no audit entry', async () => {
      const { account } = await kit.fullSession('Farrux', 'Qodirov');
      const before = await auditRows();

      await send([account.id]);

      expect(await auditRows()).toBe(before);
    });
  });

  describe('are delivered by the job', () => {
    /** Accounts written straight into the table: a hash each would take seconds. */
    async function manyAccounts(count: number): Promise<string[]> {
      const rows = await database.migrator
        .insertInto('accounts')
        .values(
          Array.from({ length: count }, (_, index) => ({
            login: `m.many${String(index)}`,
            password_hash: HASH,
            must_change_password: false,
            created_at: clock.now(),
          })),
        )
        .returning('id')
        .execute();
      return rows.map((row) => row.id);
    }

    it('with one payload on the channel per 100 ids, every id once, at the commit', async () => {
      const accounts = await manyAccounts(250);
      const ids = await send(accounts);
      heard = [];

      await transactions.run([], async (transaction) => {
        await deliverNotifications(transaction, { notificationIds: ids });
        // Not before the commit: NOTIFY is transactional.
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(heard).toEqual([]);
      });

      const payloads = await heardAfter(3);
      expect(payloads.map((payload) => payload.kind)).toEqual(['new', 'new', 'new']);
      const sizes = payloads.map((payload) => (payload.kind === 'new' ? payload.ids.length : -1));
      expect(sizes).toEqual([LIVE_CHUNK, LIVE_CHUNK, 50]);
      expect(payloads.flatMap((payload) => (payload.kind === 'new' ? payload.ids : []))).toEqual(
        ids,
      );
    });

    it('once: a second delivery of the same job runs nothing', async () => {
      const { account } = await kit.fullSession('Gulnora', 'Qodirova');
      const ids = await send([account.id]);
      const delivery = {
        id: randomUUID(),
        data: { branchIds: [], data: { notificationIds: ids } },
      };
      heard = [];

      await app.get(JobRunner).deliver(deliverNotificationsJob.name, delivery);
      await app.get(JobRunner).deliver(deliverNotificationsJob.name, delivery);

      expect(await heardAfter(1)).toEqual([{ kind: 'new', ids }]);
      expect(heard).toHaveLength(1);
    });
  });

  describe('are listed for the own account', () => {
    it('newest first, with the branch name and the unread count, and nobody else sees them', async () => {
      clock.set(START);
      const mine = await kit.fullSession('Hamid', 'Qodirov');
      const other = await kit.fullSession('Iroda', 'Qodirova');
      const [first] = await send([mine.account.id], { branchId: north });
      clock.advance(MINUTE_MS);
      const [second] = await send([mine.account.id, other.account.id]);
      clock.advance(MINUTE_MS);
      const [third] = await send([mine.account.id], {
        branchId: south,
        data: { text: 'Room 12 is taken.' },
      });

      const answer = await list(mine.cookie);

      expect(answer.unreadCount).toBe(3);
      expect(answer.items).toEqual([
        {
          id: third,
          kind: 'sample.message',
          data: { text: 'Room 12 is taken.' },
          branchId: south,
          branchName: 'South',
          createdAt: new Date(new Date(START).getTime() + 2 * MINUTE_MS).toISOString(),
          readAt: null,
        },
        {
          id: second,
          kind: 'sample.message',
          data: { text: 'The timetable of Monday changed.' },
          branchId: null,
          branchName: null,
          createdAt: new Date(new Date(START).getTime() + MINUTE_MS).toISOString(),
          readAt: null,
        },
        {
          id: first,
          kind: 'sample.message',
          data: { text: 'The timetable of Monday changed.' },
          branchId: north,
          branchName: 'North',
          createdAt: new Date(START).toISOString(),
          readAt: null,
        },
      ]);
      const theirs = await list(other.cookie);
      expect(theirs.unreadCount).toBe(1);
      expect(theirs.items.map((item) => item.id)).not.toContain(first);
      expect(theirs.items.map((item) => item.id)).not.toContain(third);
      expect(theirs.items).toHaveLength(1);
    });

    it('at most the latest 50, while the count has them all', async () => {
      clock.set(START);
      const { account, cookie } = await kit.fullSession('Jasur', 'Qodirov');
      const ids: string[] = [];
      for (let index = 0; index < NOTIFICATION_LIST_LIMIT + 2; index += 1) {
        clock.advance(1000);
        ids.push(...(await send([account.id])));
      }

      const answer = await list(cookie);

      expect(answer.unreadCount).toBe(NOTIFICATION_LIST_LIMIT + 2);
      expect(answer.items).toHaveLength(NOTIFICATION_LIST_LIMIT);
      expect(answer.items.map((item) => item.id)).toEqual(ids.slice(2).reverse());
    });

    it('as an empty list for an account without any', async () => {
      const { cookie } = await kit.fullSession('Kamola', 'Qodirova');

      expect(await list(cookie)).toEqual({ unreadCount: 0, items: [] });
    });
  });

  describe('are marked read', () => {
    it('one at a time, with the moment of the clock, told on the channel, and a second mark changes nothing', async () => {
      clock.set(START);
      const { account, cookie } = await kit.fullSession('Laziz', 'Qodirov');
      const [id] = await send([account.id]);
      const [other] = await send([account.id]);
      clock.advance(5 * MINUTE_MS);
      heard = [];

      const response = await kit.post(`/api/notifications/${id ?? ''}/read`, cookie);

      expect(response.status).toBe(204);
      const rows = await rowsOf(account.id);
      expect(rows.find((row) => row.id === id)?.read_at).toEqual(clock.now());
      expect(rows.find((row) => row.id === other)?.read_at).toBeNull();
      expect(await heardAfter(1)).toEqual([
        { kind: 'read', accountId: account.id, ids: [id], readAt: clock.now().toISOString() },
      ]);
      const answer = await list(cookie);
      expect(answer.unreadCount).toBe(1);
      expect(answer.items.find((item) => item.id === id)?.readAt).toBe(clock.now().toISOString());

      clock.advance(MINUTE_MS);
      heard = [];
      expect((await kit.post(`/api/notifications/${id ?? ''}/read`, cookie)).status).toBe(204);
      expect((await rowsOf(account.id)).find((row) => row.id === id)?.read_at).toEqual(
        new Date(new Date(START).getTime() + 5 * MINUTE_MS),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(heard).toEqual([]);
    });

    it("only among the own: another account's is not found, and stays unread", async () => {
      const mine = await kit.fullSession('Malika', 'Qodirova');
      const other = await kit.fullSession('Nodir', 'Qodirov');
      const [theirs] = await send([other.account.id]);

      const response = await kit.post(`/api/notifications/${theirs ?? ''}/read`, mine.cookie);

      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('not_found');
      expect((await rowsOf(other.account.id))[0]?.read_at).toBeNull();
      const missing = await kit.post(`/api/notifications/${randomUUID()}/read`, mine.cookie);
      expect(missing.status).toBe(404);
    });

    it('all at once for the own account and none of another, told once without ids', async () => {
      clock.set(START);
      const mine = await kit.fullSession('Otabek', 'Qodirov');
      const other = await kit.fullSession('Parvina', 'Qodirova');
      await send([mine.account.id, other.account.id]);
      await send([mine.account.id]);
      clock.advance(MINUTE_MS);
      heard = [];

      const response = await kit.post('/api/notifications/read-all', mine.cookie);

      expect(response.status).toBe(204);
      expect((await rowsOf(mine.account.id)).map((row) => row.read_at)).toEqual([
        clock.now(),
        clock.now(),
      ]);
      expect((await rowsOf(other.account.id)).map((row) => row.read_at)).toEqual([null]);
      expect(await heardAfter(1)).toEqual([
        { kind: 'read_all', accountId: mine.account.id, readAt: clock.now().toISOString() },
      ]);
      expect((await list(mine.cookie)).unreadCount).toBe(0);

      // Nothing unread: nothing is told.
      heard = [];
      expect((await kit.post('/api/notifications/read-all', mine.cookie)).status).toBe(204);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(heard).toEqual([]);
    });

    it('with an id that is an id', async () => {
      const { cookie } = await kit.fullSession('Rustam', 'Qodirov');

      const response = await kit.post('/api/notifications/first/read', cookie);

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('validation_failed');
    });

    it('without an audit entry', async () => {
      const { account, cookie } = await kit.fullSession('Sevara', 'Qodirova');
      const [id] = await send([account.id]);
      await send([account.id]);
      const before = await auditRows();

      await kit.post(`/api/notifications/${id ?? ''}/read`, cookie);
      await kit.post('/api/notifications/read-all', cookie);

      expect(await auditRows()).toBe(before);
    });
  });

  describe('need a complete session', () => {
    it('refuse a call without one', async () => {
      for (const call of [
        () => kit.get('/api/notifications'),
        () => kit.post(`/api/notifications/${randomUUID()}/read`),
        () => kit.post('/api/notifications/read-all'),
      ]) {
        const response = await call();
        expect(response.status).toBe(401);
        expect(errorCode(response)).toBe('not_signed_in');
      }
    });

    /** Each of the three routes with the cookie of a session that owes a step. */
    async function refusedOnEveryRoute(cookie: string, code: string): Promise<void> {
      for (const call of [
        () => kit.get('/api/notifications', cookie),
        () => kit.post(`/api/notifications/${randomUUID()}/read`, cookie),
        () => kit.post('/api/notifications/read-all', cookie),
      ]) {
        const response = await call();
        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe(code);
      }
    }

    it('refuse a session with a first password', async () => {
      const { cookie } = await kit.firstSession('Timur', 'Qodirov');

      await refusedOnEveryRoute(cookie, 'password_change_required');
    });

    it('refuse a session before the code of the second step', async () => {
      const { account, cookie } = await kit.fullSession('Umida', 'Qodirova');
      await kit.setUpSecondStep(cookie);
      const pending = cookieOf(await kit.signIn(account.login, NEW_PASSWORD)) ?? '';

      await refusedOnEveryRoute(pending, 'second_step_required');
    });

    it('refuse a session before the set-up of a required second step', async () => {
      const { account, cookie } = await kit.fullSession('Vohid', 'Qodirov');
      await kit.giveRole(account.id, { role: 'academic_vice_principal', branchId: north });

      await refusedOnEveryRoute(cookie, 'second_step_set_up_required');
    });
  });

  it('keep the data as JSON the row was given', async () => {
    const { account } = await kit.fullSession('Yulduz', 'Qodirova');
    await send([account.id], { data: { text: 'Quotes "and" braces {}' } });

    const found = await sql<{ text: string }>`
      select data->>'text' as text from notifications where account_id = ${account.id}
    `.execute(database.migrator);

    expect(found.rows).toEqual([{ text: 'Quotes "and" braces {}' }]);
  });
});
