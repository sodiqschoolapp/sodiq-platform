import type { INestApplication } from '@nestjs/common';
import {
  secondStepSetUpSchema,
  sessionListSchema,
  sessionResponseSchema,
  trustedDeviceListSchema,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { SESSION_COOKIE } from '../../http/session-cookie.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import {
  base32Decode,
  cookieOf,
  errorCode,
  NEW_PASSWORD,
  OptionalSecondStep,
  ProbeController,
  setCookies,
  signInKit,
  type SignInKit,
} from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { AccountLocks } from './account-locks.service.js';
import { PasswordResets } from './password-resets.service.js';
import { Sessions } from './sessions.service.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;
const START = '2026-10-05T09:00:00+05:00';
/** 7 days after `START`. */
const START_PLUS_7_DAYS = '2026-10-12T04:00:00.000Z';
const NOBODY = '00000000-0000-7000-8000-000000000000';

/** 7 days after `START`, as a cookie names it. */
const START_PLUS_7_DAYS_COOKIE = 'Expires=Mon, 12 Oct 2026 04:00:00 GMT';

/** The `Set-Cookie` line of the session cookie in an answer, if it has one. */
function sessionCookieLine(response: Response): string | undefined {
  return setCookies(response).find((line) => line.startsWith(`${SESSION_COOKIE}=`));
}

interface SessionRow {
  id: string;
  ended_at: Date | null;
  end_reason: string | null;
  trust_requested: boolean;
  trusted_from: Date | null;
  trust_ended_at: Date | null;
}

function helpers(database: () => TestDatabase) {
  async function sessionsOf(accountId: string): Promise<SessionRow[]> {
    const found = await sql<SessionRow>`
      select id, ended_at, end_reason, trust_requested, trusted_from, trust_ended_at
      from sessions where account_id = ${accountId} order by created_at, id
    `.execute(database().migrator);
    return found.rows;
  }

  /** Audit entries about an account or one of its sessions, by action. */
  async function auditOf(action: string, accountId: string) {
    const found = await sql<{
      actor_id: string | null;
      record_type: string | null;
      record_id: string | null;
      details: unknown;
    }>`
      select actor_id, record_type, record_id, details from audit_log_school
      where action = ${action} and (actor_id = ${accountId} or record_id = ${accountId})
      order by occurred_at, id
    `.execute(database().migrator);
    return found.rows;
  }

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(database().migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  return { sessionsOf, auditOf, waitingForALock };
}

// Edge cases, "Accounts and sign-in": with "Trust this device" a browser stays
// signed in for 7 days from the sign-in, with no idle sign-out. Trust ends at
// once on "sign out", "sign out everywhere", a password change or reset, and an
// account lock. The profile lists trusted devices and each can be removed;
// removing one ends its session at once. All names are invented.
describe('a trusted device', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  const clock = new FixedClock(START);
  const { sessionsOf, auditOf } = helpers(() => database);

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      database: database.app,
      clock,
      controllers: [ProbeController],
      secondStepRule: new OptionalSecondStep(),
    });
    kit = signInKit(app);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  /** An account whose password is `NEW_PASSWORD`, and nothing signed in that matters. */
  async function account(firstName: string, lastName: string) {
    const browser = await kit.fullSession(firstName, lastName);
    return browser.account;
  }

  /** A sign-in with the switch on; answers the session cookie. */
  async function trust(login: string, password: string = NEW_PASSWORD): Promise<string> {
    const response = await kit.signIn(login, password, undefined, true);
    expect(response.status).toBe(200);
    return cookieOf(response) ?? '';
  }

  /** A sign-in without the switch; answers the session cookie. */
  async function plain(login: string): Promise<string> {
    const response = await kit.signIn(login, NEW_PASSWORD);
    expect(response.status).toBe(200);
    return cookieOf(response) ?? '';
  }

  const readSession = async (cookie: string) =>
    sessionResponseSchema.parse((await kit.get('/api/auth/session', cookie)).body);

  const devicesOf = async (cookie: string) =>
    trustedDeviceListSchema.parse((await kit.get('/api/auth/trusted-devices', cookie)).body)
      .devices;

  const remove = (id: string, cookie?: string) => {
    const call = request(kit.server).delete(`/api/auth/trusted-devices/${id}`);
    return cookie === undefined ? call : call.set('Cookie', cookie);
  };

  describe('is made by the switch of the sign-in page, which is off by default', () => {
    it('leaves a sign-in without the switch under the idle sign-out', async () => {
      clock.set(START);
      const { login, id } = await account('Aziz', 'Karimov');

      const response = await kit.signIn(login, NEW_PASSWORD);
      const cookie = cookieOf(response) ?? '';

      expect(response.body).toMatchObject({ trustedUntil: null });
      expect((await sessionsOf(id)).at(-1)).toMatchObject({
        trust_requested: false,
        trusted_from: null,
      });
      clock.advance(15 * MINUTE);
      expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
    });

    it('keeps a sign-in with the switch signed in without use, and says until when', async () => {
      clock.set(START);
      const { login } = await account('Barno', 'Karimova');

      const response = await kit.signIn(login, NEW_PASSWORD, undefined, true);
      const cookie = cookieOf(response) ?? '';

      expect(response.body).toMatchObject({ trustedUntil: START_PLUS_7_DAYS });
      clock.advance(6 * DAY);
      expect((await kit.probe(cookie)).status).toBe(200);
      expect((await readSession(cookie)).trustedUntil).toBe(START_PLUS_7_DAYS);
    });

    it('refuses a switch that is neither on nor off', async () => {
      const { login } = await account('Charos', 'Karimova');

      const response = await request(kit.server)
        .post('/api/auth/sign-in')
        .send({ login, password: NEW_PASSWORD, trustDevice: 'yes' });

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('validation_failed');
    });

    // "A sign-in with trust is recorded in the sign-in history."
    it('is recorded with the sign-in, and only when the switch was on', async () => {
      clock.set(START);
      const { login, id } = await account('Dilshod', 'Karimov');
      const before = (await auditOf('auth.sign_in', id)).length;

      await plain(login);
      await trust(login);

      const signIns = (await auditOf('auth.sign_in', id)).slice(before);
      expect(signIns.map((entry) => entry.details)).toEqual([
        { secondStep: 'not_needed' },
        { secondStep: 'not_needed', trustRequested: true },
      ]);
      const trusted = (await sessionsOf(id)).at(-1);
      expect(await auditOf('auth.device_trusted', id)).toEqual([
        {
          actor_id: id,
          record_type: 'session',
          record_id: trusted?.id,
          details: { trustedUntil: START_PLUS_7_DAYS },
        },
      ]);
    });
  });

  // "That browser stays signed in for 7 days": without an end of its own the
  // cookie would be gone when the browser closes (found by the reviews).
  describe('keeps its cookie when the browser is closed, and no other session does', () => {
    it('gives the cookie of a trusted sign-in the moment the 7 days are over', async () => {
      clock.set(START);
      const { login } = await account('Aziza', 'Salimova');

      const line = sessionCookieLine(await kit.signIn(login, NEW_PASSWORD, undefined, true));

      expect(line).toContain(START_PLUS_7_DAYS_COOKIE);
      expect(line).not.toContain('Max-Age');
      expect(line).toContain('HttpOnly');
      expect(line).toContain('Secure');
      expect(line).toContain('SameSite=Strict');
    });

    it('gives the cookie of a sign-in without the switch no end: it goes with the browser', async () => {
      clock.set(START);
      const { login } = await account('Bobur', 'Salimov');

      const line = sessionCookieLine(await kit.signIn(login, NEW_PASSWORD));

      expect(line).toBeDefined();
      expect(line).not.toContain('Expires');
      expect(line).not.toContain('Max-Age');
    });

    it('gives the cookie of a first sign-in with the switch no end either', async () => {
      clock.set(START);
      const created = await kit.newAccount('Dilnoza', 'Salimova');

      const line = sessionCookieLine(
        await kit.signIn(created.login, created.firstPassword, undefined, true),
      );

      expect(line).toBeDefined();
      expect(line).not.toContain('Expires');
    });

    it('takes the end from the cookie again when a password change ends the trust', async () => {
      clock.set(START);
      const { login } = await account('Eldor', 'Salimov');
      const cookie = await trust(login);

      const refused = await kit.changePassword(cookie, 'not-the-password', 'another-password-88');
      expect(sessionCookieLine(refused)).toBeUndefined();

      const changed = await kit.changePassword(cookie, NEW_PASSWORD, 'another-password-88');
      const line = sessionCookieLine(changed);
      // The same session, now without an end of its own.
      expect(line?.split(';')[0]).toBe(cookie);
      expect(line).not.toContain('Expires');
      expect(line).not.toContain('Max-Age');
    });

    it('leaves the cookie alone at a password change of a session that was not trusted', async () => {
      clock.set(START);
      const { login } = await account('Farida', 'Salimova');
      const cookie = await plain(login);

      const changed = await kit.changePassword(cookie, NEW_PASSWORD, 'another-password-88');

      expect(changed.status).toBe(204);
      expect(sessionCookieLine(changed)).toBeUndefined();
    });
  });

  // "Every session ends 7 days after sign-in at the latest, trusted or not."
  describe('stays signed in for 7 days from the sign-in', () => {
    it('works one millisecond before the 7 days are over, and is over with them', async () => {
      clock.set(START);
      const { login, id } = await account('Elyor', 'Karimov');
      const cookie = await trust(login);

      clock.advance(7 * DAY - 1);
      expect((await kit.probe(cookie)).status).toBe(200);

      clock.advance(1);
      expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
      expect((await sessionsOf(id)).at(-1)).toMatchObject({
        ended_at: new Date(START_PLUS_7_DAYS),
        end_reason: 'expired',
      });
    });

    it('writes the end down with the moment it was over, whenever it is noticed', async () => {
      clock.set(START);
      const { login, id } = await account('Feruza', 'Karimova');
      const cookie = await trust(login);

      clock.advance(9 * DAY);
      expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');

      const session = (await sessionsOf(id)).at(-1);
      expect(session).toMatchObject({
        ended_at: new Date(START_PLUS_7_DAYS),
        end_reason: 'expired',
      });
      expect(await auditOf('auth.session_expired', id)).toEqual([
        {
          actor_id: id,
          record_type: 'session',
          record_id: session?.id,
          details: { endedAt: START_PLUS_7_DAYS },
        },
      ]);
    });

    it('needs a new sign-in afterwards', async () => {
      clock.set(START);
      const { login } = await account('Gulnora', 'Karimova');
      const cookie = await trust(login);
      clock.advance(7 * DAY);

      expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
      expect((await kit.probe(await plain(login))).status).toBe(200);
    });
  });

  // Decided by the owner: after a forced password change the person signs in
  // again to trust the device.
  describe('is never made by a sign-in with a first or reset password', () => {
    it('leaves a first sign-in with the switch untrusted, also after the forced change', async () => {
      clock.set(START);
      const created = await kit.newAccount('Hamid', 'Karimov');

      const response = await kit.signIn(created.login, created.firstPassword, undefined, true);
      const cookie = cookieOf(response) ?? '';
      expect(response.body).toMatchObject({ mustChangePassword: true, trustedUntil: null });

      expect((await kit.changePassword(cookie, created.firstPassword, NEW_PASSWORD)).status).toBe(
        204,
      );
      expect((await readSession(cookie)).trustedUntil).toBeNull();
      expect(await auditOf('auth.device_trusted', created.id)).toEqual([]);
      clock.advance(15 * MINUTE);
      expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
    });

    it('leaves a sign-in with a reset password and the switch untrusted', async () => {
      clock.set(START);
      const administrator = await kit.newAccount('Iroda', 'Karimova');
      const { login, id } = await account('Jasur', 'Karimov');
      const reset = await app
        .get(Transactions)
        .run([], (transaction) =>
          app
            .get(PasswordResets)
            .byAdministrator(transaction, { accountId: id, resetBy: administrator.id }),
        );

      const cookie = await trust(login, reset.oneTimePassword);
      expect((await readSession(cookie)).trustedUntil).toBeNull();
      expect(
        (await kit.changePassword(cookie, reset.oneTimePassword, 'another-password-88')).status,
      ).toBe(204);

      expect((await readSession(cookie)).trustedUntil).toBeNull();
      clock.advance(15 * MINUTE);
      expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
    });
  });

  // Found by the review: the guard reads the session before the change is
  // written. A session that ended in between changes nothing.
  it('changes no password and ends no trust from a session that ended after the guard read it', async () => {
    clock.set(START);
    const { login, id } = await account('Gulbahor', 'Salimova');
    const other = await plain(login);
    const cookie = await trust(login);
    const read = await app.get(Sessions).resolve(cookie.slice(`${SESSION_COOKIE}=`.length));
    if (read === undefined) {
      throw new Error('The trusted session of the test was not found.');
    }
    // Another session of the account removes this device.
    const [device] = await devicesOf(other);
    expect((await remove(device?.id ?? '', other)).status).toBe(204);

    await expect(
      app.get(Sessions).changePassword(read, NEW_PASSWORD, 'another-password-88', {
        deviceToken: undefined,
      }),
    ).rejects.toMatchObject({ code: 'not_signed_in' });

    expect((await kit.signIn(login, NEW_PASSWORD)).status).toBe(200);
    expect((await kit.probe(other)).status).toBe(200);
    expect(await auditOf('auth.trust_ended', id)).toEqual([]);
    expect((await sessionsOf(id)).at(-2)).toMatchObject({
      end_reason: 'trusted_device_removed',
      trust_ended_at: null,
    });
  });

  describe('ends at once', () => {
    it('on "sign out"', async () => {
      clock.set(START);
      const { login, id } = await account('Kamola', 'Karimova');
      const cookie = await trust(login);
      const other = await trust(login);

      expect((await kit.post('/api/auth/sign-out', cookie)).status).toBe(204);

      expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
      expect((await sessionsOf(id)).at(-2)).toMatchObject({ end_reason: 'sign_out' });
      expect(await devicesOf(other)).toHaveLength(1);
    });

    it('on "sign out everywhere", for every trusted device of the account', async () => {
      clock.set(START);
      const { login, id } = await account('Lola', 'Karimova');
      const first = await trust(login);
      const second = await trust(login);

      expect((await kit.post('/api/auth/sign-out-everywhere', first)).status).toBe(204);

      expect(errorCode(await kit.probe(first))).toBe('not_signed_in');
      expect(errorCode(await kit.probe(second))).toBe('not_signed_in');
      expect((await sessionsOf(id)).slice(-2).map((session) => session.end_reason)).toEqual([
        'sign_out_everywhere',
        'sign_out_everywhere',
      ]);
    });

    // Answered by the owner: the session that changes the password stays
    // signed in and loses its trust, as the spec says literally.
    it('on a password change: the other devices are signed out, this one loses its trust', async () => {
      clock.set(START);
      const { login, id } = await account('Mansur', 'Karimov');
      const cookie = await trust(login);
      const other = await trust(login);
      clock.advance(DAY);

      expect((await kit.changePassword(cookie, NEW_PASSWORD, 'another-password-88')).status).toBe(
        204,
      );

      expect(errorCode(await kit.probe(other))).toBe('not_signed_in');
      const [, changed, ended] = await sessionsOf(id);
      expect(ended).toMatchObject({ end_reason: 'password_change' });
      expect(changed).toMatchObject({ ended_at: null, trust_ended_at: clock.now() });
      expect((await readSession(cookie)).trustedUntil).toBeNull();
      expect(await devicesOf(cookie)).toEqual([]);
      expect(await auditOf('auth.trust_ended', id)).toEqual([
        {
          actor_id: id,
          record_type: 'session',
          record_id: changed?.id,
          details: { reason: 'password_change' },
        },
      ]);

      // From now on the idle sign-out holds for it.
      clock.advance(15 * MINUTE - 1);
      expect((await kit.probe(cookie)).status).toBe(200);
      clock.advance(15 * MINUTE);
      expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
      expect((await sessionsOf(id))[1]).toMatchObject({ end_reason: 'idle' });
    });

    it('on a password reset by an administrator', async () => {
      clock.set(START);
      const administrator = await kit.newAccount('Nodira', 'Karimova');
      const { login, id } = await account('Otabek', 'Karimov');
      const cookie = await trust(login);

      await app
        .get(Transactions)
        .run([], (transaction) =>
          app
            .get(PasswordResets)
            .byAdministrator(transaction, { accountId: id, resetBy: administrator.id }),
        );

      expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
      expect((await sessionsOf(id)).at(-1)).toMatchObject({ end_reason: 'password_reset' });
    });

    it('on an account lock', async () => {
      clock.set(START);
      const administrator = await kit.newAccount('Parvina', 'Karimova');
      const { login, id } = await account('Qodir', 'Karimov');
      const cookie = await trust(login);

      await app.get(Transactions).run([], (transaction) =>
        app.get(AccountLocks).lock(transaction, {
          accountId: id,
          lockedBy: administrator.id,
          reason: 'Dismissed today.',
        }),
      );

      expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
      expect((await sessionsOf(id)).at(-1)).toMatchObject({ end_reason: 'account_locked' });
    });
  });

  // "Within the 7 days a trusted device is never asked for the password again,
  // whatever the action. The one exception is changing one's own password,
  // which always needs the current one."
  describe('still needs the current password for a password change', () => {
    it('refuses a wrong current password and keeps the trust', async () => {
      clock.set(START);
      const { login, id } = await account('Rustam', 'Karimov');
      const cookie = await trust(login);

      const refused = await kit.changePassword(cookie, 'not-the-password', 'another-password-88');

      expect(refused.status).toBe(403);
      expect(errorCode(refused)).toBe('current_password_wrong');
      expect((await readSession(cookie)).trustedUntil).toBe(START_PLUS_7_DAYS);
      expect(await auditOf('auth.trust_ended', id)).toEqual([]);
      expect((await kit.signIn(login, NEW_PASSWORD)).status).toBe(200);
    });
  });

  describe('is listed in the profile', () => {
    it('with the trusted sessions of the own account only', async () => {
      clock.set(START);
      const { login } = await account('Sardor', 'Karimov');
      const stranger = await account('Tohir', 'Karimov');
      await trust(stranger.login);
      const untrusted = await plain(login);
      clock.advance(MINUTE);
      const first = await trust(login);
      clock.advance(MINUTE);
      const second = await trust(login);

      const devices = await devicesOf(second);

      expect(devices).toHaveLength(2);
      expect(devices.map((device) => device.current)).toEqual([true, false]);
      expect(devices[0]).toMatchObject({
        startedAt: '2026-10-05T04:02:00.000Z',
        lastUsedAt: '2026-10-05T04:02:00.000Z',
        trustedUntil: '2026-10-12T04:02:00.000Z',
        userAgent: null,
      });
      expect(devices[1]).toMatchObject({ trustedUntil: '2026-10-12T04:01:00.000Z' });
      // The same list for a session of the account that is not trusted itself.
      expect((await devicesOf(untrusted)).map((device) => device.current)).toEqual([false, false]);
      expect((await devicesOf(first)).map((device) => device.current)).toEqual([false, true]);
    });

    it('and marked in the list of sessions', async () => {
      clock.set(START);
      const { login } = await account('Umida', 'Karimova');
      const untrusted = await plain(login);
      clock.advance(MINUTE);
      await trust(login);

      const list = sessionListSchema.parse((await kit.get('/api/auth/sessions', untrusted)).body);

      // Newest first; the last one is the session that changed the first password.
      expect(list.sessions.map((session) => [session.current, session.trusted])).toEqual([
        [false, true],
        [true, false],
        [false, false],
      ]);
    });

    it('without the devices whose 7 days are over', async () => {
      clock.set(START);
      const { login } = await account('Vali', 'Karimov');
      await trust(login);
      clock.advance(6 * DAY);
      const later = await trust(login);
      clock.advance(DAY);

      const devices = await devicesOf(later);

      expect(devices).toHaveLength(1);
      expect(devices[0]).toMatchObject({ current: true });
    });

    it('with these fields and no token', async () => {
      const { login } = await account('Hilola', 'Salimova');
      const cookie = await trust(login);

      const response = await kit.get('/api/auth/trusted-devices', cookie);

      expect(JSON.stringify(response.body)).not.toContain(
        cookie.slice(`${SESSION_COOKIE}=`.length),
      );
      expect(Object.keys(response.body as object)).toEqual(['devices']);
      expect(Object.keys((response.body as { devices: object[] }).devices[0] ?? {}).sort()).toEqual(
        ['current', 'id', 'lastUsedAt', 'startedAt', 'trustedUntil', 'userAgent'],
      );
    });

    it('to nobody without a session', async () => {
      const response = await kit.get('/api/auth/trusted-devices');

      expect(response.status).toBe(401);
      expect(errorCode(response)).toBe('not_signed_in');
    });
  });

  // "Each can be removed; removing one ends its session at once."
  describe('can be removed', () => {
    it('which ends its session at once and leaves the others', async () => {
      clock.set(START);
      const { login, id } = await account('Xurshid', 'Karimov');
      const untrusted = await plain(login);
      const kept = await trust(login);
      const removed = await trust(login);
      const target = (await devicesOf(kept)).find((device) => !device.current);
      clock.advance(MINUTE);

      const response = await remove(target?.id ?? '', kept);

      expect(response.status).toBe(204);
      expect(setCookies(response)).toEqual([]);
      expect(errorCode(await kit.probe(removed))).toBe('not_signed_in');
      expect((await kit.probe(kept)).status).toBe(200);
      expect((await kit.probe(untrusted)).status).toBe(200);
      expect((await sessionsOf(id)).at(-1)).toMatchObject({
        ended_at: clock.now(),
        end_reason: 'trusted_device_removed',
      });
      expect(await auditOf('auth.trusted_device_removed', id)).toEqual([
        {
          actor_id: id,
          record_type: 'session',
          record_id: target?.id,
          details: { current: false },
        },
      ]);
    });

    it('from a session of the account that is not trusted itself', async () => {
      clock.set(START);
      const { login } = await account('Yulduz', 'Karimova');
      const untrusted = await plain(login);
      const trusted = await trust(login);
      const [device] = await devicesOf(untrusted);

      expect((await remove(device?.id ?? '', untrusted)).status).toBe(204);

      expect(errorCode(await kit.probe(trusted))).toBe('not_signed_in');
      expect((await kit.probe(untrusted)).status).toBe(200);
    });

    // Answered by the owner: like sign-out, the cookie is cleared.
    it('also when it is the device that asks, which works like sign-out', async () => {
      clock.set(START);
      const { login, id } = await account('Zafar', 'Karimov');
      const cookie = await trust(login);
      const [device] = await devicesOf(cookie);

      const response = await remove(device?.id ?? '', cookie);

      expect(response.status).toBe(204);
      expect(setCookies(response).some((line) => line.startsWith(`${SESSION_COOKIE}=;`))).toBe(
        true,
      );
      expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
      expect(
        (await auditOf('auth.trusted_device_removed', id)).map((entry) => entry.details),
      ).toEqual([{ current: true }]);
    });

    it('but not by another account: its id is answered as not found and stays signed in', async () => {
      clock.set(START);
      const owner = await account('Anvar', 'Tursunov');
      const stranger = await account('Bahrom', 'Tursunov');
      const ownerCookie = await trust(owner.login);
      const strangerCookie = await trust(stranger.login);
      const [device] = await devicesOf(ownerCookie);

      const response = await remove(device?.id ?? '', strangerCookie);

      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('not_found');
      expect((await kit.probe(ownerCookie)).status).toBe(200);
      expect(await auditOf('auth.trusted_device_removed', owner.id)).toEqual([]);
      expect(await auditOf('auth.trusted_device_removed', stranger.id)).toEqual([]);
    });

    it('but not a session that is not trusted, which is answered alike and stays signed in', async () => {
      clock.set(START);
      const { login, id } = await account('Davron', 'Tursunov');
      const untrusted = await plain(login);
      const trusted = await trust(login);
      const untrustedId = (await sessionsOf(id)).at(-2)?.id ?? '';

      const response = await remove(untrustedId, trusted);

      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('not_found');
      expect((await kit.probe(untrusted)).status).toBe(200);
    });

    it('but not twice, and not an id that no session has', async () => {
      clock.set(START);
      const { login } = await account('Eldor', 'Tursunov');
      const cookie = await trust(login);
      await trust(login);
      const other = (await devicesOf(cookie)).find((device) => !device.current);

      expect((await remove(other?.id ?? '', cookie)).status).toBe(204);
      expect((await remove(other?.id ?? '', cookie)).status).toBe(404);
      expect((await remove(NOBODY, cookie)).status).toBe(404);
    });

    it('but not once its 7 days are over: it is no device any more', async () => {
      clock.set(START);
      const { login, id } = await account('Ilhom', 'Salimov');
      await trust(login);
      const old = (await sessionsOf(id)).at(-1)?.id ?? '';
      clock.advance(7 * DAY);
      const fresh = await trust(login);

      const response = await remove(old, fresh);

      expect(response.status).toBe(404);
      expect(errorCode(response)).toBe('not_found');
      expect(await auditOf('auth.trusted_device_removed', id)).toEqual([]);
      expect((await kit.probe(fresh)).status).toBe(200);
    });

    it('but not with an id that cannot be one', async () => {
      const { login } = await account('Farrux', 'Tursunov');
      const cookie = await trust(login);

      const response = await remove('not-an-id', cookie);

      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('validation_failed');
    });

    it('by nobody without a session', async () => {
      const response = await remove(NOBODY);

      expect(response.status).toBe(401);
      expect(errorCode(response)).toBe('not_signed_in');
    });
  });
});

// "The sign-in that starts the trust still asks for the second step where the
// account has one." Here the second step is required for every account, as in
// the application until task 0.7.
describe('a trusted device of an account with a second step', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  const clock = new FixedClock(START);
  const { sessionsOf, auditOf, waitingForALock } = helpers(() => database);

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({ database: database.app, clock, controllers: [ProbeController] });
    kit = signInKit(app);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  /** A new code: the app shows another one every 30 seconds, and a code counts once. */
  function nextCode(secret: Buffer): string {
    clock.advance(30 * SECOND);
    return kit.codeOf(secret);
  }

  const readSession = async (cookie: string) =>
    sessionResponseSchema.parse((await kit.get('/api/auth/session', cookie)).body);

  const remove = (id: string, cookie: string) =>
    request(kit.server).delete(`/api/auth/trusted-devices/${id}`).set('Cookie', cookie);

  it('is not trusted by the password alone: the code is owed and the idle sign-out holds', async () => {
    clock.set(START);
    const { account } = await kit.completeSession('Aziz', 'Rahimov');

    const response = await kit.signIn(account.login, NEW_PASSWORD, undefined, true);
    const cookie = cookieOf(response) ?? '';

    expect(response.body).toMatchObject({ secondStep: 'pending', trustedUntil: null });
    expect(errorCode(await kit.probe(cookie))).toBe('second_step_required');
    expect((await sessionsOf(account.id)).at(-1)).toMatchObject({
      trust_requested: true,
      trusted_from: null,
    });
    expect(await auditOf('auth.device_trusted', account.id)).toEqual([]);

    clock.advance(15 * MINUTE);
    expect(errorCode(await kit.get('/api/auth/session', cookie))).toBe('not_signed_in');
    expect((await sessionsOf(account.id)).at(-1)).toMatchObject({ end_reason: 'idle' });
  });

  it('is trusted from the code on, for 7 days from the sign-in', async () => {
    clock.set(START);
    const { account, secret } = await kit.completeSession('Barno', 'Rahimova');
    clock.set('2026-10-05T10:00:00+05:00');
    const signedIn = await kit.signIn(account.login, NEW_PASSWORD, undefined, true);
    const cookie = cookieOf(signedIn) ?? '';
    // Not trusted yet: the cookie of the password step ends with the browser.
    expect(sessionCookieLine(signedIn)).not.toContain('Expires');
    clock.advance(10 * MINUTE);

    const passed = await kit.passSecondStep(cookie, kit.codeOf(secret));

    expect(passed.status).toBe(200);
    // The same cookie once more, now until the 7 days of the sign-in are over.
    expect(sessionCookieLine(passed)?.split(';')[0]).toBe(cookie);
    expect(sessionCookieLine(passed)).toContain('Expires=Mon, 12 Oct 2026 05:00:00 GMT');
    // From the sign-in, not from the code.
    expect(passed.body).toMatchObject({
      secondStep: 'passed',
      trustedUntil: '2026-10-12T05:00:00.000Z',
    });
    expect((await sessionsOf(account.id)).at(-1)).toMatchObject({ trusted_from: clock.now() });
    expect(await auditOf('auth.device_trusted', account.id)).toHaveLength(1);
    clock.advance(6 * DAY);
    expect((await kit.probe(cookie)).status).toBe(200);
    clock.set('2026-10-12T10:00:00+05:00');
    expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
  });

  it('gives no trust to a sign-in without the switch, code or not', async () => {
    clock.set(START);
    const { account, secret } = await kit.completeSession('Charos', 'Rahimova');
    const cookie = cookieOf(await kit.signIn(account.login, NEW_PASSWORD)) ?? '';

    const passed = await kit.passSecondStep(cookie, nextCode(secret));

    expect(passed.body).toMatchObject({ secondStep: 'passed', trustedUntil: null });
    expect(sessionCookieLine(passed)).toBeUndefined();
    clock.advance(15 * MINUTE);
    expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
  });

  it('is asked for the code again at a new sign-in from the same browser inside the 7 days', async () => {
    clock.set(START);
    const { account, secret, device } = await kit.completeSession('Dilshod', 'Rahimov');
    const first = cookieOf(await kit.signIn(account.login, NEW_PASSWORD, device, true)) ?? '';
    expect((await kit.passSecondStep(first, nextCode(secret))).status).toBe(200);
    clock.advance(DAY);

    const again = await kit.signIn(account.login, NEW_PASSWORD, `${first}; ${device}`, true);

    expect(again.body).toMatchObject({ secondStep: 'pending', trustedUntil: null });
    expect(errorCode(await kit.probe(cookieOf(again) ?? ''))).toBe('second_step_required');
  });

  it('is trusted from the end of a required set-up on', async () => {
    clock.set(START);
    const { account } = await kit.fullSession('Elyor', 'Rahimov');
    const response = await kit.signIn(account.login, NEW_PASSWORD, undefined, true);
    const cookie = cookieOf(response) ?? '';
    expect(response.body).toMatchObject({ secondStep: 'set_up_required', trustedUntil: null });
    expect(sessionCookieLine(response)).not.toContain('Expires');

    const started = await kit.post('/api/auth/second-step/set-up', cookie);
    const secret = base32Decode(secondStepSetUpSchema.parse(started.body).secret);
    const confirmed = await kit
      .post('/api/auth/second-step/confirm', cookie)
      .send({ code: kit.codeOf(secret) });

    expect(confirmed.status).toBe(200);
    expect(sessionCookieLine(confirmed)?.split(';')[0]).toBe(cookie);
    expect(sessionCookieLine(confirmed)).toContain(START_PLUS_7_DAYS_COOKIE);

    expect(await readSession(cookie)).toMatchObject({
      secondStep: 'passed',
      trustedUntil: START_PLUS_7_DAYS,
    });
    clock.advance(6 * DAY);
    expect((await kit.probe(cookie)).status).toBe(200);
  });

  // The first days of an account: first password, forced change, set-up.
  it('is not trusted after a first password, also when the set-up follows', async () => {
    clock.set(START);
    const created = await kit.newAccount('Feruza', 'Rahimova');
    const cookie =
      cookieOf(await kit.signIn(created.login, created.firstPassword, undefined, true)) ?? '';
    expect((await kit.changePassword(cookie, created.firstPassword, NEW_PASSWORD)).status).toBe(
      204,
    );

    await kit.setUpSecondStep(cookie);

    expect(await readSession(cookie)).toMatchObject({ secondStep: 'passed', trustedUntil: null });
    expect(await auditOf('auth.device_trusted', created.id)).toEqual([]);
    clock.advance(15 * MINUTE);
    expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
  });

  // "Trust ends at once on a password change", also before it began.
  it('is not trusted when the password was changed while the set-up was owed', async () => {
    clock.set(START);
    const { account } = await kit.fullSession('Gulnora', 'Rahimova');
    const cookie = cookieOf(await kit.signIn(account.login, NEW_PASSWORD, undefined, true)) ?? '';
    expect((await kit.changePassword(cookie, NEW_PASSWORD, 'another-password-88')).status).toBe(
      204,
    );

    await kit.setUpSecondStep(cookie);

    expect(await readSession(cookie)).toMatchObject({ secondStep: 'passed', trustedUntil: null });
    expect((await sessionsOf(account.id)).at(-1)).toMatchObject({
      trust_requested: true,
      trusted_from: null,
    });
    expect(await auditOf('auth.trust_ended', account.id)).toEqual([]);
  });

  // The routes of the trusted devices declare nothing: a session that owes a
  // step of sign-in reaches neither.
  describe('is listed and removed only by a session that owes no step', () => {
    it('not while the code is owed', async () => {
      clock.set(START);
      const { account } = await kit.completeSession('Hamid', 'Rahimov');
      const cookie = cookieOf(await kit.signIn(account.login, NEW_PASSWORD)) ?? '';

      for (const response of [
        await kit.get('/api/auth/trusted-devices', cookie),
        await remove(NOBODY, cookie),
      ]) {
        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('second_step_required');
      }
    });

    it('not while the password must be changed', async () => {
      clock.set(START);
      const { cookie } = await kit.firstSession('Iroda', 'Rahimova');

      for (const response of [
        await kit.get('/api/auth/trusted-devices', cookie),
        await remove(NOBODY, cookie),
      ]) {
        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('password_change_required');
      }
    });

    it('not while the second step must be set up', async () => {
      clock.set(START);
      const { cookie } = await kit.fullSession('Jasur', 'Rahimov');

      for (const response of [
        await kit.get('/api/auth/trusted-devices', cookie),
        await remove(NOBODY, cookie),
      ]) {
        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('second_step_set_up_required');
      }
    });

    it('and by a session of the account that is not trusted itself', async () => {
      clock.set(START);
      const { account, secret, cookie: complete } = await kit.completeSession('Kamola', 'Rahimova');
      const trusted =
        cookieOf(await kit.signIn(account.login, NEW_PASSWORD, undefined, true)) ?? '';
      expect((await kit.passSecondStep(trusted, nextCode(secret))).status).toBe(200);
      const devices = trustedDeviceListSchema.parse(
        (await kit.get('/api/auth/trusted-devices', complete)).body,
      ).devices;

      expect(devices).toHaveLength(1);
      expect((await remove(devices[0]?.id ?? '', complete)).status).toBe(204);
      expect(errorCode(await kit.probe(trusted))).toBe('not_signed_in');
    });
  });

  // Found by the review: the code and an account lock at the same moment. The
  // lock ends the session first; the code that waited for it begins no trust.
  it('begins no trust with a code that arrives while the account is being locked', async () => {
    clock.set(START);
    const administrator = await kit.newAccount('Lola', 'Rahimova');
    const { account, secret } = await kit.completeSession('Mansur', 'Rahimov');
    const cookie = cookieOf(await kit.signIn(account.login, NEW_PASSWORD, undefined, true)) ?? '';
    const code = nextCode(secret);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    // The lock is written and its transaction stays open.
    const locking = app.get(Transactions).run([], async (transaction) => {
      await app.get(AccountLocks).lock(transaction, {
        accountId: account.id,
        lockedBy: administrator.id,
        reason: 'Dismissed today.',
      });
      await held;
    });
    const passing = kit.passSecondStep(cookie, code).then((response) => response);
    try {
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
    } finally {
      release();
    }
    await locking;
    const response = await passing;

    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe('not_signed_in');
    expect(sessionCookieLine(response)).toBeUndefined();
    expect((await sessionsOf(account.id)).at(-1)).toMatchObject({
      end_reason: 'account_locked',
      trusted_from: null,
    });
    expect(await auditOf('auth.device_trusted', account.id)).toEqual([]);
  });
});
