import type { INestApplication } from '@nestjs/common';
import { apiErrorSchema } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEVICE_COOKIE } from '../../http/device-cookie.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import {
  cookieOf,
  errorCode,
  NEW_PASSWORD,
  ProbeController,
  setCookies,
  signInKit,
  type SignInKit,
} from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const WRONG = 'not-the-password';

// Edge cases, "Accounts and sign-in": the attempt limit. An unknown login and a
// wrong password get the same answer. After five failures each further attempt
// is delayed; accounts are never locked permanently by failures. Limits are
// per account and device, not per network address. All names are invented.
describe('the limit on sign-in attempts', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  const clock = new FixedClock('2026-10-05T09:00:00+05:00');

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({ database: database.app, clock, controllers: [ProbeController] });
    kit = signInKit(app);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  /** Signs in wrongly this many times and expects each to be answered as a failed sign-in. */
  async function fail(login: string, times: number, cookies?: string): Promise<void> {
    for (let attempt = 1; attempt <= times; attempt += 1) {
      const response = await kit.signIn(login, WRONG, cookies);
      expect(response.status).toBe(401);
      expect(errorCode(response)).toBe('sign_in_failed');
    }
  }

  function expectWait(response: Response, seconds: number): void {
    expect(response.status).toBe(429);
    expect(errorCode(response)).toBe('too_many_attempts');
    expect(response.headers['retry-after']).toBe(String(seconds));
    expect(setCookies(response)).toEqual([]);
  }

  async function auditAbout(action: string, accountId: string) {
    const found = await sql<{ actor_id: string | null; request_id: string | null; text: string }>`
      select actor_id, request_id, to_jsonb(l)::text as text
      from audit_log_school l
      where action = ${action} and record_type = 'account' and record_id = ${accountId}
    `.execute(database.migrator);
    return found.rows;
  }

  it('answers five failures as failures and makes the sixth attempt wait', async () => {
    clock.set('2026-10-05T09:00:00+05:00');
    const account = await kit.newAccount('Aziz', 'Karimov');

    await fail(account.login, 5);

    expectWait(await kit.signIn(account.login, WRONG), 30);
  });

  it('does not look at the password while the wait lasts: the right one waits too', async () => {
    clock.set('2026-10-05T09:00:00+05:00');
    const account = await kit.newAccount('Barno', 'Karimova');
    await fail(account.login, 5);

    expectWait(await kit.signIn(account.login, account.firstPassword), 30);
  });

  // The wait is a stored moment, compared with the clock at each attempt.
  it('ends the wait at its moment: not one second before, and then the right password signs in', async () => {
    clock.set('2026-10-05T09:00:00+05:00');
    const account = await kit.newAccount('Charos', 'Karimova');
    await fail(account.login, 5);

    clock.advance(29 * SECOND);
    expectWait(await kit.signIn(account.login, account.firstPassword), 1);

    clock.advance(SECOND);
    expect((await kit.signIn(account.login, account.firstPassword)).status).toBe(200);
  });

  // Decided by the owner: 30 seconds, doubled by each further failure, 15 minutes at most.
  it('doubles the wait with each further failure, up to 15 minutes', async () => {
    clock.set('2026-10-05T09:00:00+05:00');
    const account = await kit.newAccount('Dilshod', 'Karimov');
    await fail(account.login, 4);

    for (const seconds of [30, 60, 120, 240, 480, 900, 900, 900]) {
      await fail(account.login, 1);
      expectWait(await kit.signIn(account.login, WRONG), seconds);
      clock.advance(seconds * SECOND);
    }
  });

  it('never locks an account for good: after the longest wait the right password signs in', async () => {
    clock.set('2026-10-05T09:00:00+05:00');
    const account = await kit.newAccount('Elyor', 'Karimov');
    await fail(account.login, 4);
    for (let failure = 5; failure <= 14; failure += 1) {
      await fail(account.login, 1);
      clock.advance(15 * MINUTE);
    }

    expect((await kit.signIn(account.login, account.firstPassword)).status).toBe(200);
  });

  it('starts the count again after a sign-in', async () => {
    clock.set('2026-10-05T09:00:00+05:00');
    const account = await kit.newAccount('Feruza', 'Karimova');
    await fail(account.login, 4);
    expect((await kit.signIn(account.login, account.firstPassword)).status).toBe(200);

    await fail(account.login, 4);

    expect((await kit.signIn(account.login, account.firstPassword)).status).toBe(200);
  });

  describe('for a login that no account has', () => {
    it('answers exactly as for a wrong password, before and after the fifth failure', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const account = await kit.newAccount('Gulom', 'Karimov');
      const withoutId = (response: Response) => ({
        status: response.status,
        retryAfter: response.headers['retry-after'],
        error: { ...apiErrorSchema.parse(response.body).error, requestId: '' },
        cookies: setCookies(response),
      });

      for (let attempt = 1; attempt <= 7; attempt += 1) {
        const known = await kit.signIn(account.login, WRONG);
        const unknown = await kit.signIn('x.nobody', WRONG);

        expect(withoutId(unknown)).toEqual(withoutId(known));
        expect(known.status).toBe(attempt <= 5 ? 401 : 429);
      }
    });

    it('stores a hash of the login only', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      await kit.signIn('q.typedsecret', WRONG);

      const stored = await sql<{ text: string }>`
        select to_jsonb(t)::text as text from sign_in_throttle t
      `.execute(database.migrator);

      expect(stored.rows.length).toBeGreaterThan(0);
      for (const row of stored.rows) {
        expect(row.text).not.toContain('typedsecret');
      }
    });

    // 0.6a: such a text never reaches the database. No account can have it, so
    // there is nothing to protect and nothing to count.
    it('does not count a text that cannot be a login', async () => {
      for (let attempt = 1; attempt <= 7; attempt += 1) {
        const response = await kit.signIn('Not A Login', WRONG);

        expect(response.status).toBe(401);
        expect(errorCode(response)).toBe('sign_in_failed');
      }
    });
  });

  // "Per account and device": a browser that signed in to the account before
  // has a count of its own; all other browsers share one per account.
  describe('per device', () => {
    it('does not delay the known browser of a person when somebody guesses from elsewhere', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, device } = await kit.fullSession('Hilola', 'Karimova');

      await fail(account.login, 5);
      expectWait(await kit.signIn(account.login, NEW_PASSWORD), 30);

      expect((await kit.signIn(account.login, NEW_PASSWORD, device)).status).toBe(200);
    });

    it('limits the known browser too, on its own count', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, device } = await kit.fullSession('Ikrom', 'Karimov');

      await fail(account.login, 5, device);
      expectWait(await kit.signIn(account.login, NEW_PASSWORD, device), 30);

      // Another browser is not delayed by it.
      expect((await kit.signIn(account.login, NEW_PASSWORD)).status).toBe(200);
    });

    it('counts a browser that is known for another account only with the unknown ones', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account } = await kit.fullSession('Jasur', 'Karimov');
      const colleague = await kit.fullSession('Kamola', 'Karimova');
      await fail(account.login, 5);

      expectWait(await kit.signIn(account.login, NEW_PASSWORD, colleague.device), 30);
    });

    it('counts a device cookie that nobody was given with the unknown ones', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account } = await kit.fullSession('Laziz', 'Karimov');
      await fail(account.login, 5);

      for (const cookie of [
        `${DEVICE_COOKIE}=${'A'.repeat(43)}`,
        `${DEVICE_COOKIE}=abc`,
        `${DEVICE_COOKIE}=`,
      ]) {
        expectWait(await kit.signIn(account.login, NEW_PASSWORD, cookie), 30);
      }
    });

    it('knows one browser for several accounts, as on a classroom computer', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const first = await kit.fullSession('Malika', 'Karimova');
      const second = await kit.newAccount('Nodir', 'Karimov');
      const signedIn = await kit.signIn(second.login, second.firstPassword, first.device);
      expect(signedIn.status).toBe(200);
      // The browser keeps the token it had.
      expect(cookieOf(signedIn, DEVICE_COOKIE)).toBe(first.device);

      await fail(first.account.login, 5);
      await fail(second.login, 5);

      expect((await kit.signIn(first.account.login, NEW_PASSWORD, first.device)).status).toBe(200);
      expect((await kit.signIn(second.login, second.firstPassword, first.device)).status).toBe(200);
    });
  });

  describe('the device cookie', () => {
    it('is set at a sign-in, kept for 400 days, unreadable for scripts, for HTTPS and this site only', async () => {
      const account = await kit.newAccount('Odil', 'Karimov');

      const response = await kit.signIn(account.login, account.firstPassword);

      const line = setCookies(response).find((cookie) => cookie.startsWith(`${DEVICE_COOKIE}=`));
      const [pair, ...attributes] = (line ?? '').split('; ');
      expect(pair).toMatch(/^__Host-sodiq_device=[A-Za-z0-9_-]{43}$/);
      expect(attributes.filter((attribute) => !attribute.startsWith('Expires=')).sort()).toEqual([
        'HttpOnly',
        'Max-Age=34560000',
        'Path=/',
        'SameSite=Strict',
        'Secure',
      ]);
    });

    it('is stored as a hash only, and opens nothing by itself', async () => {
      const { device } = await kit.fullSession('Parvina', 'Karimova');
      const token = device.slice(`${DEVICE_COOKIE}=`.length);

      const stored = await sql<{ text: string }>`
        select to_jsonb(d)::text as text from known_devices d
      `.execute(database.migrator);
      expect(stored.rows.length).toBeGreaterThan(0);
      for (const row of stored.rows) {
        expect(row.text).not.toContain(token);
      }
      expect(errorCode(await kit.probe(device))).toBe('not_signed_in');
    });

    it('is not set by a failed sign-in', async () => {
      const account = await kit.newAccount('Qobil', 'Karimov');

      expect(setCookies(await kit.signIn(account.login, WRONG))).toEqual([]);
    });
  });

  // 0.6a left this for 0.6b: the current password of a password change is a
  // password attempt like any other.
  describe('for the current password of a password change', () => {
    it('makes the sixth attempt wait, also with the right password, and changes nothing', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, cookie, device } = await kit.fullSession('Rano', 'Karimova');
      const cookies = `${cookie}; ${device}`;

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const response = await kit.changePassword(cookies, WRONG, 'another-password-88');
        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('current_password_wrong');
      }
      const waiting = await kit.changePassword(cookies, NEW_PASSWORD, 'another-password-88');
      expect(waiting.status).toBe(429);
      expect(errorCode(waiting)).toBe('too_many_attempts');
      expect(waiting.headers['retry-after']).toBe('30');

      clock.advance(30 * SECOND);
      expect(errorCode(await kit.signIn(account.login, 'another-password-88'))).toBe(
        'sign_in_failed',
      );
    });

    it('accepts the right password once the wait is over', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { cookie, device } = await kit.fullSession('Sardor', 'Karimov');
      const cookies = `${cookie}; ${device}`;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await kit.changePassword(cookies, WRONG, 'another-password-88');
      }

      clock.advance(30 * SECOND);

      expect((await kit.changePassword(cookies, NEW_PASSWORD, 'another-password-88')).status).toBe(
        204,
      );
    });

    it('shares the count with the sign-ins of that login from that device', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account, cookie, device } = await kit.fullSession('Temur', 'Karimov');
      await fail(account.login, 3, device);
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        await kit.changePassword(`${cookie}; ${device}`, WRONG, 'another-password-88');
      }

      expectWait(await kit.signIn(account.login, NEW_PASSWORD, device), 30);
    });
  });

  // Edge cases, "Personal data and the audit log": the log records sign-ins.
  describe('in the audit log', () => {
    it('writes a failed sign-in for an account, with the request and without what was typed', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const account = await kit.newAccount('Umida', 'Karimova');

      const response = await kit.signIn(account.login, 'a-wrong-password-41');

      const entries = await auditAbout('auth.sign_in_failed', account.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actor_id: null,
        request_id: response.headers['x-request-id'],
      });
      expect(entries[0]?.text).not.toContain('a-wrong-password-41');
    });

    it('writes nothing for an attempt that had to wait', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const account = await kit.newAccount('Vali', 'Karimov');
      await fail(account.login, 5);

      await kit.signIn(account.login, WRONG);
      await kit.signIn(account.login, WRONG);

      expect(await auditAbout('auth.sign_in_failed', account.id)).toHaveLength(5);
    });

    it('writes nothing for a login that no account has', async () => {
      const before = await sql<{ entries: number }>`
        select count(*)::int as entries from audit_log_school where action = 'auth.sign_in_failed'
      `.execute(database.migrator);

      await kit.signIn('y.nobody', WRONG);

      const after = await sql<{ entries: number }>`
        select count(*)::int as entries from audit_log_school where action = 'auth.sign_in_failed'
      `.execute(database.migrator);
      expect(after.rows).toEqual(before.rows);
    });
  });
});
