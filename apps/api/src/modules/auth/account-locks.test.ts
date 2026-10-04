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
  setCookies,
  signInKit,
  type SignInKit,
} from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import {
  AccountAlreadyLockedError,
  AccountLocks,
  AccountNotLockedError,
  LockReasonError,
  OwnAccountLockError,
} from './account-locks.service.js';
import { UnknownAccountError } from './password-resets.service.js';
import { Sessions } from './sessions.service.js';

const MINUTE = 60 * 1000;
const START = '2026-10-05T09:00:00+05:00';
const NOBODY = '00000000-0000-7000-8000-000000000000';

// Edge cases, "Staff over time": locking an account is separate from employment
// status. "Lock now" ends all sessions at once, needs no reassignment and is
// logged with a reason. The routes come with task 2.3; this is the service.
// All names are invented.
describe('an account lock', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  const clock = new FixedClock(START);

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

  /** The lock as the route of task 2.3 will call it. */
  function lock(accountId: string, lockedBy: string, reason = 'Dismissed today.'): Promise<void> {
    return app
      .get(Transactions)
      .run([], (transaction) =>
        app.get(AccountLocks).lock(transaction, { accountId, lockedBy, reason }),
      );
  }

  function unlock(accountId: string, unlockedBy: string): Promise<void> {
    return app
      .get(Transactions)
      .run([], (transaction) =>
        app.get(AccountLocks).unlock(transaction, { accountId, unlockedBy }),
      );
  }

  async function sessionsOf(accountId: string) {
    const found = await sql<{ ended_at: Date | null; end_reason: string | null }>`
      select ended_at, end_reason from sessions
      where account_id = ${accountId} order by created_at, id
    `.execute(database.migrator);
    return found.rows;
  }

  async function lockOf(accountId: string) {
    const found = await sql<{
      locked_at: Date | null;
      locked_by: string | null;
      lock_reason: string | null;
    }>`
      select locked_at, locked_by, lock_reason from accounts where id = ${accountId}
    `.execute(database.migrator);
    return found.rows[0];
  }

  async function auditOf(action: string, accountId: string) {
    const found = await sql<{
      actor_id: string | null;
      record_type: string | null;
      record_id: string | null;
      reason: string | null;
      details: unknown;
    }>`
      select actor_id, record_type, record_id, reason, details from audit_log_school
      where action = ${action} and (actor_id = ${accountId} or record_id = ${accountId})
      order by occurred_at, id
    `.execute(database.migrator);
    return found.rows;
  }

  /**
   * For a test that holds a transaction open while another one runs into its
   * lock. `reached()` is called inside the held transaction once it has the
   * lock; `whenReached(holding)` resolves then, and fails if the held
   * transaction fails first. The other side is started only after that:
   * started at the same moment, it can take the row first, finish at once, and
   * nothing ever waits (seen in CI).
   */
  function gate() {
    let reached: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => {
      reached = resolve;
    });
    return {
      reached: () => {
        reached();
      },
      whenReached: (holding: Promise<unknown>) =>
        Promise.race([opened, holding.then(() => opened)]),
    };
  }

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  it('ends all sessions at once and is logged with its reason', async () => {
    clock.set(START);
    const administrator = await kit.newAccount('Aziz', 'Nazarov');
    const { account, cookie } = await kit.fullSession('Barno', 'Nazarova');
    const second = cookieOf(await kit.signIn(account.login, NEW_PASSWORD)) ?? '';
    clock.advance(MINUTE);

    await lock(account.id, administrator.id, '  Dismissed today.  ');

    expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
    expect(errorCode(await kit.probe(second))).toBe('not_signed_in');
    expect(await sessionsOf(account.id)).toEqual([
      { ended_at: clock.now(), end_reason: 'account_locked' },
      { ended_at: clock.now(), end_reason: 'account_locked' },
    ]);
    expect(await lockOf(account.id)).toEqual({
      locked_at: clock.now(),
      locked_by: administrator.id,
      lock_reason: 'Dismissed today.',
    });
    expect(await auditOf('account.locked', account.id)).toEqual([
      {
        actor_id: administrator.id,
        record_type: 'account',
        record_id: account.id,
        reason: 'Dismissed today.',
        details: { endedSessions: 2 },
      },
    ]);
  });

  it('does not count sessions that were over by time already', async () => {
    clock.set(START);
    const administrator = await kit.newAccount('Charos', 'Nazarova');
    const { account } = await kit.fullSession('Dilshod', 'Nazarov');
    clock.advance(40 * MINUTE);
    await kit.signIn(account.login, NEW_PASSWORD);

    await lock(account.id, administrator.id);

    expect((await sessionsOf(account.id)).map((session) => session.end_reason)).toEqual([
      'idle',
      'account_locked',
    ]);
    expect((await auditOf('account.locked', account.id))[0]?.details).toEqual({
      endedSessions: 1,
    });
  });

  // Answered by the owner: `account_locked` after the right password only,
  // `sign_in_failed` after a wrong one, as for `password_expired`.
  describe('keeps the account from signing in', () => {
    it('refuses the right password as locked, opens no session and writes it down', async () => {
      clock.set(START);
      const administrator = await kit.newAccount('Elyor', 'Nazarov');
      const { account } = await kit.fullSession('Feruza', 'Nazarova');
      await lock(account.id, administrator.id);
      const before = (await sessionsOf(account.id)).length;

      const response = await kit.signIn(account.login, NEW_PASSWORD);

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('account_locked');
      expect(setCookies(response)).toEqual([]);
      expect(await sessionsOf(account.id)).toHaveLength(before);
      expect(await auditOf('auth.sign_in_locked', account.id)).toEqual([
        {
          actor_id: null,
          record_type: 'account',
          record_id: account.id,
          reason: null,
          details: null,
        },
      ]);
    });

    it('answers a wrong password as for any account', async () => {
      clock.set(START);
      const administrator = await kit.newAccount('Gulnora', 'Nazarova');
      const { account } = await kit.fullSession('Hamid', 'Nazarov');
      await lock(account.id, administrator.id);

      const response = await kit.signIn(account.login, 'not-the-password');

      expect(response.status).toBe(401);
      expect(errorCode(response)).toBe('sign_in_failed');
      expect(await auditOf('auth.sign_in_locked', account.id)).toEqual([]);
    });

    // A first password older than 7 days: the lock is what the person is told.
    it('also when the password of the account has expired', async () => {
      clock.set(START);
      const administrator = await kit.newAccount('Shahlo', 'Nazarova');
      const account = await kit.newAccount('Sherzod', 'Nazarov');
      await lock(account.id, administrator.id);
      clock.advance(8 * 24 * 60 * MINUTE);

      expect(errorCode(await kit.signIn(account.login, account.firstPassword))).toBe(
        'account_locked',
      );
    });

    // Found by the review: the guard reads the session before the change is
    // written; a lock in between leaves the password as it was.
    it('and from changing its password in a request the guard let through before the lock', async () => {
      clock.set(START);
      const administrator = await kit.newAccount('Sitora', 'Nazarova');
      const { account, cookie } = await kit.fullSession('Sobir', 'Nazarov');
      const token = cookie.slice(cookie.indexOf('=') + 1);
      const read = await app.get(Sessions).resolve(token);
      if (read === undefined) {
        throw new Error('The session of the test was not found.');
      }
      await lock(account.id, administrator.id);

      await expect(
        app.get(Sessions).changePassword(read, NEW_PASSWORD, 'another-password-88', {
          deviceToken: undefined,
        }),
      ).rejects.toMatchObject({ code: 'not_signed_in' });

      await unlock(account.id, administrator.id);
      expect(errorCode(await kit.signIn(account.login, 'another-password-88'))).toBe(
        'sign_in_failed',
      );
      expect((await kit.signIn(account.login, NEW_PASSWORD)).status).toBe(200);
      expect(await auditOf('auth.password_change', account.id)).toHaveLength(1);
    });

    it('with the trust switch as without it', async () => {
      clock.set(START);
      const administrator = await kit.newAccount('Iroda', 'Nazarova');
      const { account } = await kit.fullSession('Jasur', 'Nazarov');
      await lock(account.id, administrator.id);

      expect(errorCode(await kit.signIn(account.login, NEW_PASSWORD, undefined, true))).toBe(
        'account_locked',
      );
    });

    // `Sessions.resolve` does not rest on the lock having ended the sessions.
    it('also if a session of the account were still open', async () => {
      clock.set(START);
      const administrator = await kit.newAccount('Kamola', 'Nazarova');
      const { account, cookie } = await kit.fullSession('Lola', 'Nazarova');

      // Not through the service: the sessions stay open.
      await sql`
        update accounts set locked_at = ${clock.now()}, locked_by = ${administrator.id},
          lock_reason = 'Dismissed today.'
        where id = ${account.id}
      `.execute(database.migrator);

      expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
      expect(errorCode(await kit.get('/api/auth/session', cookie))).toBe('not_signed_in');
    });
  });

  describe('is lifted by an unlock', () => {
    it('after which the password of before signs in again', async () => {
      clock.set(START);
      const administrator = await kit.newAccount('Mansur', 'Nazarov');
      const { account, cookie } = await kit.fullSession('Nodira', 'Nazarova');
      await lock(account.id, administrator.id);
      const lockedAt = clock.now();
      clock.advance(MINUTE);

      await unlock(account.id, administrator.id);

      expect(await lockOf(account.id)).toEqual({
        locked_at: null,
        locked_by: null,
        lock_reason: null,
      });
      // The sessions of before the lock stay over.
      expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
      const again = await kit.signIn(account.login, NEW_PASSWORD);
      expect(again.status).toBe(200);
      expect((await kit.probe(cookieOf(again) ?? '')).status).toBe(200);
      expect(await auditOf('account.unlocked', account.id)).toEqual([
        {
          actor_id: administrator.id,
          record_type: 'account',
          record_id: account.id,
          reason: null,
          details: { lockedAt: lockedAt.toISOString(), lockedBy: administrator.id },
        },
      ]);
    });

    it('and can be locked again', async () => {
      const administrator = await kit.newAccount('Otabek', 'Nazarov');
      const { account } = await kit.fullSession('Parvina', 'Nazarova');
      await lock(account.id, administrator.id);
      await unlock(account.id, administrator.id);

      await lock(account.id, administrator.id, 'Left the school.');

      expect(errorCode(await kit.signIn(account.login, NEW_PASSWORD))).toBe('account_locked');
      expect(await auditOf('account.locked', account.id)).toHaveLength(2);
    });
  });

  describe('is refused', () => {
    it('for the own account, locking and unlocking', async () => {
      const { account, cookie } = await kit.fullSession('Qodir', 'Nazarov');

      await expect(lock(account.id, account.id)).rejects.toBeInstanceOf(OwnAccountLockError);
      await expect(unlock(account.id, account.id)).rejects.toBeInstanceOf(OwnAccountLockError);

      expect((await kit.probe(cookie)).status).toBe(200);
      expect(await auditOf('account.locked', account.id)).toEqual([]);
    });

    it('for an account that does not exist', async () => {
      const administrator = await kit.newAccount('Rustam', 'Nazarov');

      await expect(lock(NOBODY, administrator.id)).rejects.toBeInstanceOf(UnknownAccountError);
      await expect(unlock(NOBODY, administrator.id)).rejects.toBeInstanceOf(UnknownAccountError);
    });

    it('for an account that is locked already, which keeps its first lock', async () => {
      clock.set(START);
      const administrator = await kit.newAccount('Sardor', 'Nazarov');
      const other = await kit.newAccount('Tohir', 'Nazarov');
      const { account } = await kit.fullSession('Umida', 'Nazarova');
      await lock(account.id, administrator.id);
      const first = await lockOf(account.id);
      clock.advance(MINUTE);

      await expect(lock(account.id, other.id, 'Another reason.')).rejects.toBeInstanceOf(
        AccountAlreadyLockedError,
      );

      expect(await lockOf(account.id)).toEqual(first);
      expect(await auditOf('account.locked', account.id)).toHaveLength(1);
    });

    it('as an unlock of an account that is not locked', async () => {
      const administrator = await kit.newAccount('Vali', 'Nazarov');
      const { account } = await kit.fullSession('Xurshid', 'Nazarov');

      await expect(unlock(account.id, administrator.id)).rejects.toBeInstanceOf(
        AccountNotLockedError,
      );
      expect(await auditOf('account.unlocked', account.id)).toEqual([]);
    });

    it.each([
      ['no reason', ''],
      ['a reason of spaces', '   '],
      ['a reason of 501 characters', 'x'.repeat(501)],
    ])('with %s', async (_name, reason) => {
      const administrator = await kit.newAccount('Yulduz', 'Nazarova');
      const { account, cookie } = await kit.fullSession('Zafar', 'Nazarov');

      await expect(lock(account.id, administrator.id, reason)).rejects.toBeInstanceOf(
        LockReasonError,
      );

      expect((await kit.probe(cookie)).status).toBe(200);
      expect((await lockOf(account.id))?.locked_at).toBeNull();
    });
  });

  // Every change is audited in the same transaction.
  it('leaves nothing behind when its transaction rolls back', async () => {
    const administrator = await kit.newAccount('Anvar', 'Olimov');
    const { account, cookie } = await kit.fullSession('Bahrom', 'Olimov');

    await expect(
      app.get(Transactions).run([], async (transaction) => {
        await app.get(AccountLocks).lock(transaction, {
          accountId: account.id,
          lockedBy: administrator.id,
          reason: 'Dismissed today.',
        });
        throw new Error('The route failed after the lock.');
      }),
    ).rejects.toThrow('The route failed after the lock.');

    expect((await kit.probe(cookie)).status).toBe(200);
    expect((await lockOf(account.id))?.locked_at).toBeNull();
    expect(await auditOf('account.locked', account.id)).toEqual([]);
  });

  // Asked for by the owner: a lock and a sign-in both take the row of the
  // account, so no session of a locked account stays open, by the database
  // and not by timing.
  describe('at the same moment as a sign-in', () => {
    it('makes a sign-in that comes while the lock is being written wait, and refuses it', async () => {
      clock.set(START);
      const administrator = await kit.newAccount('Davron', 'Olimov');
      const { account } = await kit.fullSession('Eldor', 'Olimov');
      const before = (await sessionsOf(account.id)).length;
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });

      const lockWritten = gate();

      // The lock is written and its transaction stays open.
      const locking = app.get(Transactions).run([], async (transaction) => {
        await app.get(AccountLocks).lock(transaction, {
          accountId: account.id,
          lockedBy: administrator.id,
          reason: 'Dismissed today.',
        });
        lockWritten.reached();
        await held;
      });
      // The sign-in starts only once the lock holds the row of the account. If
      // the held transaction failed instead, nothing is held and the test ends here.
      await lockWritten.whenReached(locking);
      const signingIn = kit.signIn(account.login, NEW_PASSWORD).then((response) => response);
      try {
        // The sign-in has checked the password and now waits for the row of the account.
        await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      } finally {
        release();
      }
      await locking;
      const response = await signingIn;

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe('account_locked');
      expect(setCookies(response)).toEqual([]);
      expect(await sessionsOf(account.id)).toHaveLength(before);
    });

    it('makes a lock that comes while a sign-in is being written wait, and ends the new session', async () => {
      clock.set(START);
      const administrator = await kit.newAccount('Farrux', 'Olimov');
      const { account } = await kit.fullSession('Gulshan', 'Olimova');
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });

      const sessionWritten = gate();

      // What a sign-in does in its transaction: the row of the account, then the session.
      const signingIn = app.get(Transactions).run([], async (transaction) => {
        await transaction
          .selectFrom('accounts')
          .select('id')
          .where('id', '=', account.id)
          .forUpdate()
          .execute();
        await transaction
          .insertInto('sessions')
          .values({
            account_id: account.id,
            token_hash: 'f'.repeat(64),
            created_at: clock.now(),
            last_used_at: clock.now(),
          })
          .execute();
        sessionWritten.reached();
        await held;
      });
      // The lock starts only once the sign-in holds the row of the account.
      await sessionWritten.whenReached(signingIn);
      const locking = lock(account.id, administrator.id);
      try {
        // The lock waits for the row of the account.
        await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      } finally {
        release();
      }
      await signingIn;
      await locking;

      const sessions = await sessionsOf(account.id);
      expect(sessions.at(-1)).toMatchObject({ end_reason: 'account_locked' });
      expect(sessions.filter((session) => session.ended_at === null)).toEqual([]);
    });

    it('never leaves a session of the locked account open, whichever comes first', async () => {
      clock.set(START);
      const administrator = await kit.newAccount('Hamid', 'Olimov');

      for (const name of ['Iroda', 'Jamila', 'Kamola', 'Lola', 'Malika', 'Nargiza']) {
        const { account } = await kit.fullSession(name, 'Olimova');

        const [, response] = await Promise.all([
          lock(account.id, administrator.id),
          kit.signIn(account.login, NEW_PASSWORD),
        ]);

        expect([200, 403]).toContain(response.status);
        const open = (await sessionsOf(account.id)).filter((session) => session.ended_at === null);
        expect(open).toEqual([]);
        const cookie = cookieOf(response);
        if (cookie !== undefined) {
          expect(errorCode(await kit.probe(cookie))).toBe('not_signed_in');
        }
      }
    });
  });
});
