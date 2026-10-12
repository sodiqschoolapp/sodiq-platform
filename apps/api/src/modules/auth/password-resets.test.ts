import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import {
  cookieOf,
  errorCode,
  NEW_PASSWORD,
  ProbeController,
  signInKit,
  type SignInKit,
} from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { FIRST_PASSWORD_LENGTH } from './accounts.service.js';
import {
  OwnPasswordResetError,
  PasswordResets,
  UnknownAccountError,
} from './password-resets.service.js';

const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;

// Edge cases, "Accounts and sign-in": a reset gives a one-time password valid
// for 24 hours and forces a change before anything else. It ends all sessions,
// is logged as "reset by X for Y", and the user sees "your password was reset
// by X" at next sign-in. The route comes with task 2.3; this is the service.
// All names are invented.
describe('a password reset by an administrator', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  const clock = new FixedClock('2026-10-05T09:00:00+05:00');

  beforeAll(async () => {
    database = await createTestDatabase();
    app = await createTestApp({
      database: database.app,
      clock,
      controllers: [ProbeController],
    });
    kit = signInKit(app);
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  /** The reset as the route of task 2.3 will call it; answers the one-time password. */
  async function reset(accountId: string, resetBy: string): Promise<string> {
    const result = await app
      .get(Transactions)
      .run([], (transaction) =>
        app.get(PasswordResets).byAdministrator(transaction, { accountId, resetBy }),
      );
    return result.oneTimePassword;
  }

  async function accountRow(accountId: string) {
    const found = await sql<{
      must_change_password: boolean;
      password_expires_at: Date | null;
      password_reset_by: string | null;
      password_reset_at: Date | null;
      text: string;
    }>`
      select must_change_password, password_expires_at, password_reset_by, password_reset_at,
        to_jsonb(a)::text as text
      from accounts a where id = ${accountId}
    `.execute(database.migrator);
    return found.rows[0];
  }

  it('replaces the password with a random one-time password that is stored as a hash only', async () => {
    clock.set('2026-10-05T09:00:00+05:00');
    const administrator = await kit.newAccount('Aziz', 'Maxmudov');
    const { account } = await kit.fullSession('Barno', 'Maxmudova');

    const first = await reset(account.id, administrator.id);
    expect(first).toHaveLength(FIRST_PASSWORD_LENGTH);
    expect(errorCode(await kit.signIn(account.login, NEW_PASSWORD))).toBe('sign_in_failed');
    expect((await accountRow(account.id))?.text).not.toContain(first);

    const second = await reset(account.id, administrator.id);
    expect(second).not.toBe(first);
    expect(errorCode(await kit.signIn(account.login, first))).toBe('sign_in_failed');
    expect((await kit.signIn(account.login, second)).status).toBe(200);
  });

  it('forces a change before anything else', async () => {
    clock.set('2026-10-05T09:00:00+05:00');
    const administrator = await kit.newAccount('Charos', 'Maxmudova');
    const { account } = await kit.fullSession('Dilshod', 'Maxmudov');
    const oneTime = await reset(account.id, administrator.id);

    const signedIn = await kit.signIn(account.login, oneTime);
    const cookie = cookieOf(signedIn) ?? '';

    expect(signedIn.body).toMatchObject({ mustChangePassword: true });
    const refused = await kit.probe(cookie);
    expect(refused.status).toBe(403);
    expect(errorCode(refused)).toBe('password_change_required');

    expect((await kit.changePassword(cookie, oneTime, 'another-password-88')).status).toBe(204);
    expect((await kit.probe(cookie)).status).toBe(200);
  });

  describe('gives a password that is valid for 24 hours', () => {
    it('signs in one second before the 24 hours are over', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const administrator = await kit.newAccount('Elyor', 'Maxmudov');
      const { account } = await kit.fullSession('Feruza', 'Maxmudova');
      const oneTime = await reset(account.id, administrator.id);

      clock.advance(24 * HOUR - SECOND);

      expect((await kit.signIn(account.login, oneTime)).status).toBe(200);
    });

    it('is refused as expired when the 24 hours are over', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const administrator = await kit.newAccount('Gulom', 'Maxmudov');
      const { account } = await kit.fullSession('Hilola', 'Maxmudova');
      const oneTime = await reset(account.id, administrator.id);
      expect((await accountRow(account.id))?.password_expires_at).toEqual(
        new Date('2026-10-06T09:00:00+05:00'),
      );

      clock.advance(24 * HOUR);

      const response = await kit.signIn(account.login, oneTime);
      expect(response.status).toBe(401);
      expect(errorCode(response)).toBe('password_expired');
    });

    it('no longer expires once the person chose a password', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const administrator = await kit.newAccount('Ikrom', 'Maxmudov');
      const { account } = await kit.fullSession('Jasur', 'Maxmudov');
      const oneTime = await reset(account.id, administrator.id);
      const cookie = cookieOf(await kit.signIn(account.login, oneTime)) ?? '';
      await kit.changePassword(cookie, oneTime, 'another-password-88');

      clock.advance(30 * 24 * HOUR);

      expect((await kit.signIn(account.login, 'another-password-88')).status).toBe(200);
    });
  });

  it('ends all sessions of the account and none of anybody else', async () => {
    clock.set('2026-10-08T14:00:00+05:00');
    const administrator = await kit.fullSession('Kamola', 'Maxmudova');
    const { account, cookie: laptop } = await kit.fullSession('Laziz', 'Maxmudov');
    const phone = cookieOf(await kit.signIn(account.login, NEW_PASSWORD)) ?? '';

    await reset(account.id, administrator.account.id);

    expect(errorCode(await kit.probe(laptop))).toBe('not_signed_in');
    expect(errorCode(await kit.probe(phone))).toBe('not_signed_in');
    expect((await kit.probe(administrator.cookie)).status).toBe(200);
    const sessions = await sql<{ ended_at: Date | null; end_reason: string | null }>`
      select ended_at, end_reason from sessions where account_id = ${account.id}
    `.execute(database.migrator);
    expect(sessions.rows).toEqual([
      { ended_at: new Date('2026-10-08T14:00:00+05:00'), end_reason: 'password_reset' },
      { ended_at: new Date('2026-10-08T14:00:00+05:00'), end_reason: 'password_reset' },
    ]);
  });

  // Found by the review: a session that was over by time keeps its own end.
  it('leaves a session that was already over by time its own end and does not count it', async () => {
    clock.set('2026-10-08T14:00:00+05:00');
    const administrator = await kit.newAccount('Yulduz', 'Nazarova');
    const { account } = await kit.fullSession('Zafar', 'Nazarov');
    clock.advance(40 * 60 * SECOND);
    await kit.signIn(account.login, NEW_PASSWORD);

    await reset(account.id, administrator.id);

    const sessions = await sql<{ ended_at: Date | null; end_reason: string | null }>`
      select ended_at, end_reason from sessions where account_id = ${account.id} order by id
    `.execute(database.migrator);
    expect(sessions.rows).toEqual([
      { ended_at: new Date('2026-10-08T14:30:00+05:00'), end_reason: 'idle' },
      { ended_at: new Date('2026-10-08T14:40:00+05:00'), end_reason: 'password_reset' },
    ]);
    const entries = await sql<{ details: unknown }>`
      select details from audit_log_school
      where action = 'account.password_reset' and record_id = ${account.id}
    `.execute(database.migrator);
    expect(entries.rows).toEqual([{ details: { endedSessions: 1 } }]);
  });

  it('is logged as "reset by X for Y", without any password', async () => {
    clock.set('2026-10-08T14:00:00+05:00');
    const administrator = await kit.newAccount('Malika', 'Maxmudova');
    const { account } = await kit.fullSession('Nodir', 'Maxmudov');

    const oneTime = await reset(account.id, administrator.id);

    const entries = await sql<{
      actor_id: string | null;
      record_type: string | null;
      record_id: string | null;
      details: unknown;
      occurred_at: Date;
      text: string;
    }>`
      select actor_id, record_type, record_id, details, occurred_at, to_jsonb(l)::text as text
      from audit_log_school l where action = 'account.password_reset' and record_id = ${account.id}
    `.execute(database.migrator);
    expect(entries.rows).toHaveLength(1);
    expect(entries.rows[0]).toMatchObject({
      actor_id: administrator.id,
      record_type: 'account',
      record_id: account.id,
      details: { endedSessions: 1 },
      occurred_at: new Date('2026-10-08T14:00:00+05:00'),
    });
    expect(entries.rows[0]?.text).not.toContain(oneTime);
    expect(entries.rows[0]?.text).not.toContain('$argon2id$');
  });

  describe('tells the person who reset the password', () => {
    it('and tells nobody else: not the administrator, not a third person', async () => {
      const administrator = await kit.fullSession('Hamid', 'Nazarov');
      const third = await kit.fullSession('Jahongir', 'Nazarov');
      const { account } = await kit.fullSession('Kamola', 'Nazarova');

      await reset(account.id, administrator.account.id);

      for (const cookie of [administrator.cookie, third.cookie]) {
        expect((await kit.get('/api/auth/session', cookie)).body).toMatchObject({
          mustChangePassword: false,
          name: null,
          passwordResetBy: null,
          language: 'uz',
          trustedUntil: null,
          assignments: [],
          branches: [],
        });
      }
    });

    it('at the next sign-in and while the one-time password is in use', async () => {
      clock.set('2026-10-08T14:00:00+05:00');
      const administrator = await kit.newAccount('Odil', 'Maxmudov');
      const { account } = await kit.fullSession('Parvina', 'Maxmudova');
      const oneTime = await reset(account.id, administrator.id);

      const signedIn = await kit.signIn(account.login, oneTime);

      const answer = {
        login: 'p.maxmudova',
        secondStep: 'not_needed',
        mustChangePassword: true,
        name: null,
        passwordResetBy: 'o.maxmudov',
        language: 'uz',
        trustedUntil: null,
        assignments: [],
        branches: [],
      };
      expect(signedIn.body).toEqual(answer);
      const read = await kit.get('/api/auth/session', cookieOf(signedIn));
      expect(read.body).toEqual(answer);
      expect(await accountRow(account.id)).toMatchObject({
        password_reset_by: administrator.id,
        password_reset_at: new Date('2026-10-08T14:00:00+05:00'),
      });
    });

    it('no longer once the person chose a password', async () => {
      const administrator = await kit.newAccount('Qobil', 'Maxmudov');
      const { account } = await kit.fullSession('Rano', 'Maxmudova');
      const oneTime = await reset(account.id, administrator.id);
      const cookie = cookieOf(await kit.signIn(account.login, oneTime)) ?? '';

      await kit.changePassword(cookie, oneTime, 'another-password-88');

      expect((await kit.get('/api/auth/session', cookie)).body).toEqual({
        login: 'r.maxmudova',
        secondStep: 'not_needed',
        mustChangePassword: false,
        name: null,
        passwordResetBy: null,
        language: 'uz',
        trustedUntil: null,
        assignments: [],
        branches: [],
      });
      expect(await accountRow(account.id)).toMatchObject({
        must_change_password: false,
        password_expires_at: null,
        password_reset_by: null,
        password_reset_at: null,
      });
    });

    it('says nothing to an account that was never reset', async () => {
      const account = await kit.newAccount('Sardor', 'Maxmudov');

      expect((await kit.signIn(account.login, account.firstPassword)).body).toEqual({
        login: 's.maxmudov',
        secondStep: 'not_needed',
        mustChangePassword: true,
        name: null,
        passwordResetBy: null,
        language: 'uz',
        trustedUntil: null,
        assignments: [],
        branches: [],
      });
    });
  });

  // Decided by the owner: an own password is changed with the current one,
  // never reset by oneself.
  it('refuses an administrator who resets their own password, and changes nothing', async () => {
    const { account, cookie } = await kit.fullSession('Temur', 'Maxmudov');

    await expect(reset(account.id, account.id)).rejects.toBeInstanceOf(OwnPasswordResetError);

    expect((await kit.probe(cookie)).status).toBe(200);
    expect((await kit.signIn(account.login, NEW_PASSWORD)).status).toBe(200);
    expect(await accountRow(account.id)).toMatchObject({
      must_change_password: false,
      password_reset_by: null,
    });
  });

  it('refuses an account that does not exist, and writes nothing', async () => {
    const administrator = await kit.newAccount('Umida', 'Maxmudova');
    const nobody = '00000000-0000-7000-8000-000000000000';

    await expect(reset(nobody, administrator.id)).rejects.toBeInstanceOf(UnknownAccountError);

    const entries = await sql`
      select from audit_log_school where action = 'account.password_reset' and record_id = ${nobody}
    `.execute(database.migrator);
    expect(entries.rows).toEqual([]);
  });

  // Decided by the owner: a reset also clears the attempt count of the login.
  describe('clears the count of failed sign-ins of the login', () => {
    const WRONG = 'not-the-password';

    async function counts(): Promise<number> {
      const found = await sql<{ rows: number }>`
        select count(*)::int as rows from sign_in_throttle
      `.execute(database.migrator);
      return found.rows[0]?.rows ?? 0;
    }

    it('so a person who had to wait signs in with the one-time password at once', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const administrator = await kit.newAccount('Yulduz', 'Maxmudova');
      const { account } = await kit.fullSession('Zafar', 'Maxmudov');
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        expect((await kit.signIn(account.login, WRONG)).status).toBe(401);
      }
      expect((await kit.signIn(account.login, NEW_PASSWORD)).status).toBe(429);

      const oneTime = await reset(account.id, administrator.id);

      expect((await kit.signIn(account.login, oneTime)).status).toBe(200);
    });

    it('on every device, and starts the count from the beginning', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const administrator = await kit.newAccount('Anora', 'Nazarova');
      const { account, device } = await kit.fullSession('Bahrom', 'Nazarov');
      await sql`delete from sign_in_throttle`.execute(database.migrator);
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await kit.signIn(account.login, WRONG);
        await kit.signIn(account.login, WRONG, device);
      }
      expect(await counts()).toBe(2);

      await reset(account.id, administrator.id);

      expect(await counts()).toBe(0);
      // Five new failures are answered as failures again; the sixth waits.
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        expect((await kit.signIn(account.login, WRONG, device)).status).toBe(401);
      }
      expect((await kit.signIn(account.login, WRONG, device)).status).toBe(429);
    });

    it('and leaves the count of every other login', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const administrator = await kit.newAccount('Dildora', 'Nazarova');
      const { account } = await kit.fullSession('Erkin', 'Nazarov');
      const colleague = await kit.fullSession('Gavhar', 'Nazarova');
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await kit.signIn(colleague.account.login, WRONG);
      }

      await reset(account.id, administrator.id);

      expect((await kit.signIn(colleague.account.login, NEW_PASSWORD)).status).toBe(429);
    });

    it('not when the reset is refused', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      const { account } = await kit.fullSession('Ibrohim', 'Nazarov');
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await kit.signIn(account.login, WRONG);
      }

      await expect(reset(account.id, account.id)).rejects.toBeInstanceOf(OwnPasswordResetError);

      expect((await kit.signIn(account.login, NEW_PASSWORD)).status).toBe(429);
    });
  });

  it('also helps a person whose first password expired', async () => {
    clock.set('2026-10-05T09:00:00+05:00');
    const administrator = await kit.newAccount('Vali', 'Maxmudov');
    const account = await kit.newAccount('Xurshid', 'Maxmudov');
    clock.advance(8 * 24 * HOUR);
    expect(errorCode(await kit.signIn(account.login, account.firstPassword))).toBe(
      'password_expired',
    );

    const oneTime = await reset(account.id, administrator.id);

    expect((await kit.signIn(account.login, oneTime)).status).toBe(200);
  });
});
