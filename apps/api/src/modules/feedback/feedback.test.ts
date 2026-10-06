import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { FEEDBACK_REPORTS_PER_DAY, FEEDBACK_WINDOW_MS } from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import {
  cookieOf,
  errorCode,
  NEW_PASSWORD,
  signInKit,
  type SignInKit,
} from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const START = '2026-10-05T09:00:00+05:00';
const MINUTE_MS = 60 * 1000;

const startMs = (): number => new Date(START).getTime();

// All names are invented.
// docs/spec/14-quality-plan.md, Whole system, Monitoring: "A feedback button on
// every page sends a report with the page and role attached." Decided by the
// owner (task 0.8b-3): the roles come from the session, never from the body;
// the page is the path without the query; at most 20 reports in 24 hours per
// account, refused with too_many_attempts; no audit entry.
describe('a feedback report', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let server: Server;
  let kit: SignInKit;
  let north: string;
  let south: string;
  const clock = new FixedClock(START);

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    app = await createTestApp({ database: database.app, clock });
    server = app.getHttpServer() as Server;
    kit = signInKit(app);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  const REPORT = { page: '/dev/patterns', text: 'The list jumps when the rows arrive.' };

  const send = (cookies: string | undefined, body: object = REPORT) => {
    const call = request(server).post('/api/feedback');
    return (cookies === undefined ? call : call.set('Cookie', cookies)).send(body);
  };

  /** The reports of an account, oldest first, as the owner reads them. */
  const reportsOf = (accountId: string) =>
    database.migrator
      .selectFrom('feedback_reports')
      .selectAll()
      .where('account_id', '=', accountId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();

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

  describe('is stored', () => {
    it('with the account, the roles of the session once each in the order of the roles table, the page, the trimmed text, the moment and the request id', async () => {
      clock.set(START);
      const browser = await kit.fullSession('Dilnoza', 'Rahimova');
      // Teacher in two branches and Head Teacher in one: three assignments, two roles.
      await kit.giveRole(browser.account.id, { role: 'teacher', branchId: north });
      await kit.giveRole(browser.account.id, { role: 'teacher', branchId: south });
      await kit.giveRole(browser.account.id, { role: 'head_teacher', branchId: north });

      const response = await send(browser.cookie, {
        page: '/dev/patterns',
        text: '  The list jumps.  ',
      });

      expect(response.status).toBe(204);
      const rows = await reportsOf(browser.account.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        account_id: browser.account.id,
        roles: ['head_teacher', 'teacher'],
        page: '/dev/patterns',
        text: 'The list jumps.',
        request_id: response.headers['x-request-id'],
      });
      expect(rows[0]?.created_at.toISOString()).toBe(new Date(START).toISOString());
    });

    it('with no roles for an account that holds none', async () => {
      const browser = await kit.fullSession('Timur', 'Aliev');

      expect((await send(browser.cookie)).status).toBe(204);

      expect((await reportsOf(browser.account.id))[0]?.roles).toEqual([]);
    });

    it('with the account and the roles of the session, whatever the body claims', async () => {
      const browser = await kit.fullSession('Kamila', 'Yusupova');
      const other = await kit.newAccount('Jasur', 'Yusupov');

      const response = await send(browser.cookie, {
        ...REPORT,
        roles: ['super_admin'],
        accountId: other.id,
      });

      expect(response.status).toBe(204);
      expect((await reportsOf(browser.account.id))[0]?.roles).toEqual([]);
      expect(await reportsOf(other.id)).toEqual([]);
    });

    it('with a page of 500 characters and a text of 2000', async () => {
      const browser = await kit.fullSession('Bobur', 'Karimov');

      const response = await send(browser.cookie, {
        page: `/${'a'.repeat(499)}`,
        text: 'b'.repeat(2000),
      });

      expect(response.status).toBe(204);
    });

    it('without an audit entry (decided by the owner)', async () => {
      const browser = await kit.fullSession('Zarina', 'Tursunova');
      const before = await auditRows();

      expect((await send(browser.cookie)).status).toBe(204);

      expect(await auditRows()).toBe(before);
    });
  });

  // CLAUDE.md, Conventions: every API input is validated with a schema of packages/shared.
  describe('is refused as not valid, and nothing is stored,', () => {
    it.each([
      ['a page with a query', { page: '/dev/patterns?q=x', text: 'Text' }],
      ['a page with a fragment', { page: '/dev/patterns#top', text: 'Text' }],
      ['a page without a leading slash', { page: 'dev/patterns', text: 'Text' }],
      ['an empty page', { page: '', text: 'Text' }],
      ['a page of 501 characters', { page: `/${'a'.repeat(500)}`, text: 'Text' }],
      ['an empty text', { page: '/', text: '' }],
      ['a blank text', { page: '/', text: '  \n\t ' }],
      ['a text of 2001 characters', { page: '/', text: 'b'.repeat(2001) }],
      ['a report without a page', { text: 'Text' }],
      ['a report without a text', { page: '/' }],
      ['a text that is not text', { page: '/', text: 7 }],
    ])('for %s', async (_name, body) => {
      const browser = await kit.fullSession('Malika', 'Sobirova');

      const response = await send(browser.cookie, body);

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('validation_failed');
      expect(await reportsOf(browser.account.id)).toEqual([]);
    });
  });

  // Decided by the owner: at most 20 reports a day per account, refused with
  // too_many_attempts. "A day" is the last 24 hours, counted from the stored
  // moments against the injected clock (developer rules, "Time-based state").
  describe('is limited to 20 in 24 hours per account', () => {
    it('allows 20, refuses the 21st with the wait until the first is 24 hours old, and allows one more then', async () => {
      clock.set(START);
      const browser = await kit.fullSession('Sardor', 'Nazarov');
      for (let sent = 1; sent <= FEEDBACK_REPORTS_PER_DAY; sent += 1) {
        // The first report at START + 1 min, the twentieth at START + 20 min.
        clock.advance(MINUTE_MS);
        expect((await send(browser.cookie)).status).toBe(204);
      }

      const refused = await send(browser.cookie);
      expect(refused.status).toBe(429);
      expect(errorCode(refused)).toBe('too_many_attempts');
      // From START + 20 min until the first report is 24 hours old, at START + 1 min + 24 h.
      expect(refused.headers['retry-after']).toBe(String((24 * 60 - 19) * 60));
      expect(await reportsOf(browser.account.id)).toHaveLength(FEEDBACK_REPORTS_PER_DAY);

      // One second before the first is 24 hours old: refused, one second to wait.
      // The session of the morning has ended by then (idle sign-out): the
      // person signs in again, and the count is the account's, not the session's.
      clock.set(new Date(startMs() + MINUTE_MS + FEEDBACK_WINDOW_MS - 1000));
      const nextDay = cookieOf(await kit.signIn(browser.account.login, NEW_PASSWORD));
      expect(nextDay).toBeDefined();
      const stillRefused = await send(nextDay);
      expect(stillRefused.status).toBe(429);
      expect(stillRefused.headers['retry-after']).toBe('1');

      // Exactly 24 hours after the first: it is out of the window, one place is free.
      clock.advance(1000);
      expect((await send(nextDay)).status).toBe(204);
      expect(await reportsOf(browser.account.id)).toHaveLength(FEEDBACK_REPORTS_PER_DAY + 1);

      // The second report is now the oldest of the twenty: a minute to wait.
      const again = await send(nextDay);
      expect(again.status).toBe(429);
      expect(again.headers['retry-after']).toBe('60');
    });

    it('counts each account by itself', async () => {
      clock.set(START);
      const full = await kit.fullSession('Nilufar', 'Qodirova');
      const other = await kit.fullSession('Jasur', 'Qodirov');
      for (let sent = 0; sent < FEEDBACK_REPORTS_PER_DAY; sent += 1) {
        expect((await send(full.cookie)).status).toBe(204);
      }
      expect((await send(full.cookie)).status).toBe(429);

      expect((await send(other.cookie)).status).toBe(204);
    });

    // The limit is application code, not a constraint: the row of the account is
    // held while the reports are counted and the new one is written, so two
    // reports sent at the same moment count each other.
    it('stores exactly one of two reports sent at the same moment to the one place left', async () => {
      clock.set(START);
      const browser = await kit.fullSession('Gulnora', 'Rashidova');
      for (let sent = 0; sent < FEEDBACK_REPORTS_PER_DAY - 1; sent += 1) {
        expect((await send(browser.cookie)).status).toBe(204);
      }

      const responses = await Promise.all([send(browser.cookie), send(browser.cookie)]);

      expect(responses.map((response) => response.status).sort()).toEqual([204, 429]);
      expect(await reportsOf(browser.account.id)).toHaveLength(FEEDBACK_REPORTS_PER_DAY);
    });
  });

  // The route carries no @AllowedBefore… mark: a session that owes a step of
  // sign-in reaches nothing but that step. Who may call it as which role is
  // tested by the harness (route-permissions.test.ts).
  describe('needs a complete session', () => {
    it('is refused without a session', async () => {
      const response = await send(undefined);

      expect(response.status).toBe(401);
      expect(errorCode(response)).toBe('not_signed_in');
    });

    it('is refused while a first password is in use', async () => {
      const browser = await kit.firstSession('Farrux', 'Olimov');

      const response = await send(browser.cookie);

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('password_change_required');
      expect(await reportsOf(browser.account.id)).toEqual([]);
    });

    it('is refused while the second step is owed, and while its set-up is', async () => {
      const strict = signInKit(app, {
        newAccountsHold: { role: 'academic_vice_principal', branchId: north },
      });
      const setUpOwed = await strict.fullSession('Hamid', 'Olimov');
      const refusedSetUp = await send(setUpOwed.cookie);
      expect(refusedSetUp.status).toBe(403);
      expect(errorCode(refusedSetUp)).toBe('second_step_set_up_required');

      const complete = await strict.completeSession('Iroda', 'Olimova');
      const signedInAgain = await kit.signIn(complete.account.login, NEW_PASSWORD);
      const pending = cookieOf(signedInAgain);
      expect(pending).toBeDefined();
      const refusedCode = await send(pending);
      expect(refusedCode.status).toBe(403);
      expect(errorCode(refusedCode)).toBe('second_step_required');

      expect(await reportsOf(setUpOwed.account.id)).toEqual([]);
      expect(await reportsOf(complete.account.id)).toEqual([]);
    });
  });
});
