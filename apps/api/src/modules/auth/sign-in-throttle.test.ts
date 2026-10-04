import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import {
  CLEANUP_BATCH,
  delayAfterMs,
  FORGET_AFTER_MS,
  SignInThrottle,
  type ThrottleKey,
} from './sign-in-throttle.service.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

// Edge cases, "Accounts and sign-in": after five failures each further attempt
// is delayed; accounts are never locked permanently by failures. The lengths
// were decided by the owner: 30 seconds, doubled by each further failure, 15
// minutes at most.
describe('the wait after failed attempts', () => {
  it.each([
    [1, 0],
    [4, 0],
    [5, 30 * SECOND],
    [6, MINUTE],
    [7, 2 * MINUTE],
    [8, 4 * MINUTE],
    [9, 8 * MINUTE],
    [10, 15 * MINUTE],
    [11, 15 * MINUTE],
    [1000, 15 * MINUTE],
    [1_000_000_000, 15 * MINUTE],
  ])('after %i failures in a row is %i ms', (failures, wait) => {
    expect(delayAfterMs(failures)).toBe(wait);
  });
});

describe('the count of failed attempts', () => {
  let database: TestDatabase;
  let throttle: SignInThrottle;
  const clock = new FixedClock('2026-10-05T09:00:00+05:00');

  const keyOf = (letter: string): ThrottleKey => ({
    loginHash: letter.repeat(64),
    deviceKey: 'unknown',
  });

  beforeAll(async () => {
    database = await createTestDatabase();
    throttle = new SignInThrottle(new Transactions(database.app), clock);
  });

  afterAll(async () => {
    await database.destroy();
  });

  async function rows(): Promise<number> {
    const found = await sql<{ rows: number }>`
      select count(*)::int as rows from sign_in_throttle
    `.execute(database.migrator);
    return found.rows[0]?.rows ?? 0;
  }

  /** Counts that are older than the clock by this much, for logins nobody uses in these tests. */
  async function addOldCounts(count: number, ageMs: number, mark: string): Promise<void> {
    const last = new Date(clock.now().getTime() - ageMs);
    await sql`
      insert into sign_in_throttle (login_hash, device_key, failures, last_failure_at)
      select ${mark}::text || lpad(to_hex(n), 62, '0'), 'unknown', 3, ${last}::timestamptz
      from generate_series(1, ${count}::int) as n
    `.execute(database.migrator);
  }

  it('passes five attempts and makes the sixth wait', async () => {
    clock.set('2026-10-05T09:00:00+05:00');
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await throttle.begin(keyOf('a'));
    }

    await expect(throttle.begin(keyOf('a'))).rejects.toMatchObject({
      code: 'too_many_attempts',
      retryAfterSeconds: 30,
    });
  });

  it('does not count an attempt that had to wait', async () => {
    clock.set('2026-10-05T09:00:00+05:00');
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await throttle.begin(keyOf('b'));
    }
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      await expect(throttle.begin(keyOf('b'))).rejects.toMatchObject({ retryAfterSeconds: 30 });
    }

    clock.advance(30 * SECOND);
    await throttle.begin(keyOf('b'));
    // The sixth failure, not the twenty-sixth.
    await expect(throttle.begin(keyOf('b'))).rejects.toMatchObject({ retryAfterSeconds: 60 });
  });

  it('counts each login and each device on its own', async () => {
    clock.set('2026-10-05T09:00:00+05:00');
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await throttle.begin(keyOf('c'));
    }

    await throttle.begin(keyOf('d'));
    await throttle.begin({ loginHash: 'c'.repeat(64), deviceKey: 'e'.repeat(64) });
    await expect(throttle.begin(keyOf('c'))).rejects.toMatchObject({ code: 'too_many_attempts' });
  });

  // Attempts are counted before the password is looked at, one after the other.
  it('counts ten attempts at the same moment as ten: five pass, five wait', async () => {
    clock.set('2026-10-05T09:00:00+05:00');

    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, () => throttle.begin(keyOf('f'))),
    );

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(5);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(5);
  });

  // Found by the review: an attempt whose row was removed at the same moment
  // (by a right password, a reset or the cleanup) ended as a fault. The moment
  // cannot be forced, so many attempts and removals run against each other.
  it('never ends as a fault when counts are removed while attempts are counted', async () => {
    clock.set('2026-10-05T09:00:00+05:00');
    const transactions = new Transactions(database.app);
    const key = keyOf('9');

    for (let round = 1; round <= 15; round += 1) {
      const outcomes = await Promise.allSettled(
        Array.from({ length: 12 }, (_unused, index) => {
          if (index % 3 === 1) {
            return throttle.passed(key);
          }
          if (index % 3 === 2) {
            return transactions.run([], (transaction) =>
              sql`delete from sign_in_throttle where login_hash = ${key.loginHash}`.execute(
                transaction,
              ),
            );
          }
          return throttle.begin(key);
        }),
      );

      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toMatchObject({ code: 'too_many_attempts' });
        }
      }
    }
  });

  it('starts again after a right password', async () => {
    clock.set('2026-10-05T09:00:00+05:00');
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await throttle.begin(keyOf('1'));
    }
    await throttle.begin(keyOf('1'));
    await throttle.passed(keyOf('1'));

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await throttle.begin(keyOf('1'));
    }
    await expect(throttle.begin(keyOf('1'))).rejects.toMatchObject({ retryAfterSeconds: 30 });
  });

  // Decided by the owner: failures are forgotten 24 hours after the last one.
  describe('24 hours after the last failure', () => {
    it('still knows the failures one second before', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await throttle.begin(keyOf('2'));
      }
      clock.advance(FORGET_AFTER_MS - SECOND);

      await throttle.begin(keyOf('2'));
      await expect(throttle.begin(keyOf('2'))).rejects.toMatchObject({
        code: 'too_many_attempts',
      });
    });

    it('has forgotten them', async () => {
      clock.set('2026-10-05T09:00:00+05:00');
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await throttle.begin(keyOf('3'));
      }
      clock.advance(FORGET_AFTER_MS);

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await throttle.begin(keyOf('3'));
      }
      await expect(throttle.begin(keyOf('3'))).rejects.toMatchObject({ retryAfterSeconds: 30 });
    });
  });

  // Asked for by the owner: unknown logins are counted too, so the table must
  // not grow without bound. Each attempt removes a small batch of old counts.
  describe('the removal of forgotten counts', () => {
    it('removes one batch of counts older than 24 hours with each attempt, and no younger one', async () => {
      clock.set('2026-11-20T09:00:00+05:00');
      await sql`delete from sign_in_throttle`.execute(database.migrator);
      await addOldCounts(2 * CLEANUP_BATCH + 10, FORGET_AFTER_MS, 'aa');
      await addOldCounts(7, FORGET_AFTER_MS - SECOND, 'bb');
      const young = 7;
      const own = 1;

      await throttle.begin(keyOf('4'));
      expect(await rows()).toBe(CLEANUP_BATCH + 10 + young + own);

      await throttle.begin(keyOf('4'));
      expect(await rows()).toBe(10 + young + own);

      await throttle.begin(keyOf('4'));
      expect(await rows()).toBe(young + own);

      await throttle.begin(keyOf('4'));
      expect(await rows()).toBe(young + own);
    });

    it('also happens with an attempt that has to wait', async () => {
      clock.set('2026-12-20T09:00:00+05:00');
      await sql`delete from sign_in_throttle`.execute(database.migrator);
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await throttle.begin(keyOf('5'));
      }
      await addOldCounts(3, FORGET_AFTER_MS + SECOND, 'cc');

      await expect(throttle.begin(keyOf('5'))).rejects.toMatchObject({
        code: 'too_many_attempts',
      });

      expect(await rows()).toBe(1);
    });

    it('removes the own old count and starts it again', async () => {
      clock.set('2027-01-20T09:00:00+05:00');
      await sql`delete from sign_in_throttle`.execute(database.migrator);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await throttle.begin(keyOf('6'));
      }
      clock.advance(3 * FORGET_AFTER_MS);

      await throttle.begin(keyOf('6'));

      const found = await sql<{ failures: number }>`
        select failures from sign_in_throttle where login_hash = ${'6'.repeat(64)}
      `.execute(database.migrator);
      expect(found.rows).toEqual([{ failures: 1 }]);
    });
  });
});
