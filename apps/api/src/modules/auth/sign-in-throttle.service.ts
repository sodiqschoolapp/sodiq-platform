import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';

/** Edge cases, "Accounts and sign-in": after five failures each further attempt is delayed. */
export const FREE_FAILURES = 5;

/** The wait after the fifth failure; each further failure doubles it (decided by the owner). */
export const FIRST_DELAY_MS = 30 * 1000;

/** The longest wait. Accounts are never locked permanently by failures. */
export const LONGEST_DELAY_MS = 15 * 60 * 1000;

/** Failures are forgotten this long after the last one. */
export const FORGET_AFTER_MS = 24 * 60 * 60 * 1000;

/** How many forgotten rows one attempt removes at most. */
export const CLEANUP_BATCH = 50;

/** Every browser that has not signed in to the account before shares this count. */
const UNKNOWN_DEVICE = 'unknown';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** What the database keeps of a device token: its SHA-256. */
export function deviceTokenHash(token: string): string {
  return sha256(token);
}

/** The wait that follows the given number of failures in a row. */
export function delayAfterMs(failures: number): number {
  if (failures < FREE_FAILURES) {
    return 0;
  }
  // The exponent is bounded, so the power stays a small whole number.
  const doublings = Math.min(failures - FREE_FAILURES, 10);
  return Math.min(FIRST_DELAY_MS * 2 ** doublings, LONGEST_DELAY_MS);
}

/** One count of failures: a login on a device. */
export interface ThrottleKey {
  loginHash: string;
  deviceKey: string;
}

/**
 * The limit on password attempts (edge cases, "Accounts and sign-in"): per
 * account and device, not per network address, because the whole school shares
 * one. A browser that signed in to the account before has a count of its own;
 * all other browsers share one per login, so guesses from elsewhere delay only
 * unknown browsers. An unknown login is counted like a known one, so the
 * answers do not tell which logins exist.
 */
@Injectable()
export class SignInThrottle {
  constructor(
    private readonly transactions: Transactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The count an attempt belongs to. `accountId` is the account of the login,
   * if there is one; `deviceToken` is what the device cookie of the request holds.
   */
  async keyOf(
    transaction: Transaction,
    login: string,
    accountId: string | undefined,
    deviceToken: string | undefined,
  ): Promise<ThrottleKey> {
    const loginHash = sha256(login);
    if (accountId === undefined || deviceToken === undefined) {
      return { loginHash, deviceKey: UNKNOWN_DEVICE };
    }
    const hash = deviceTokenHash(deviceToken);
    const known = await transaction
      .selectFrom('known_devices')
      .select('token_hash')
      .where('token_hash', '=', hash)
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    return { loginHash, deviceKey: known === undefined ? UNKNOWN_DEVICE : hash };
  }

  /**
   * Called before a password is looked at. Counts the attempt as a failure, so
   * attempts at the same moment cannot slip past the count; `passed` takes it
   * back. Throws `too_many_attempts` while the wait is not over: such an
   * attempt is not counted and its password is not looked at.
   */
  async begin(key: ThrottleKey): Promise<void> {
    const now = this.clock.now();
    const waitMs = await this.transactions.run([], async (transaction) => {
      const wait = await this.count(transaction, key, now);
      // After the own row is held, and skipping held rows: no attempt waits
      // for another one here.
      await this.removeForgotten(transaction, now);
      return wait;
    });
    if (waitMs > 0) {
      throw new ApiException('too_many_attempts', 429, Math.ceil(waitMs / 1000));
    }
  }

  /** Adds one failure to the count, or answers how long the wait still is. */
  private async count(transaction: Transaction, key: ThrottleKey, now: Date): Promise<number> {
    // One statement makes the row or locks the one that is there: a row that
    // a right password, a reset or the cleanup removes at the same moment is
    // made again, never missed (found by the review). The lock puts attempts
    // at the same moment in a line.
    const row = await transaction
      .insertInto('sign_in_throttle')
      .values({
        login_hash: key.loginHash,
        device_key: key.deviceKey,
        failures: 0,
        last_failure_at: now,
      })
      .onConflict((conflict) =>
        conflict
          .columns(['login_hash', 'device_key'])
          .doUpdateSet((builder) => ({ failures: builder.ref('sign_in_throttle.failures') })),
      )
      .returning(['failures', 'last_failure_at', 'blocked_until'])
      .executeTakeFirstOrThrow();
    if (row.blocked_until !== null && row.blocked_until > now) {
      return row.blocked_until.getTime() - now.getTime();
    }
    const forgotten = row.last_failure_at.getTime() + FORGET_AFTER_MS <= now.getTime();
    const failures = (forgotten ? 0 : row.failures) + 1;
    const delay = delayAfterMs(failures);
    await transaction
      .updateTable('sign_in_throttle')
      .set({
        failures,
        last_failure_at: now,
        blocked_until: delay === 0 ? null : new Date(now.getTime() + delay),
      })
      .where('login_hash', '=', key.loginHash)
      .where('device_key', '=', key.deviceKey)
      .execute();
    return 0;
  }

  /** The password was right: the count of this login on this device starts again. */
  async passed(key: ThrottleKey): Promise<void> {
    await this.transactions.run([], (transaction) =>
      transaction
        .deleteFrom('sign_in_throttle')
        .where('login_hash', '=', key.loginHash)
        .where('device_key', '=', key.deviceKey)
        .execute(),
    );
  }

  /**
   * A reset by an administrator: every count of the login starts again, on
   * every device, in the transaction of the reset (decided by the owner). A
   * person who waits after failed attempts can use the one-time password at once.
   */
  async forget(transaction: Transaction, login: string): Promise<void> {
    await transaction
      .deleteFrom('sign_in_throttle')
      .where('login_hash', '=', sha256(login))
      .execute();
  }

  /**
   * Unknown logins are counted too, so the table would grow with every text
   * somebody types. Each attempt removes a small batch of rows whose
   * last failure is older than 24 hours. Rows that another attempt holds are
   * skipped, so two attempts never wait for each other here.
   */
  private async removeForgotten(transaction: Transaction, now: Date): Promise<void> {
    const before = new Date(now.getTime() - FORGET_AFTER_MS);
    const forgotten = await transaction
      .selectFrom('sign_in_throttle')
      .select(['login_hash', 'device_key'])
      .where('last_failure_at', '<=', before)
      .orderBy('last_failure_at')
      .limit(CLEANUP_BATCH)
      .forUpdate()
      .skipLocked()
      .execute();
    for (const row of forgotten) {
      await transaction
        .deleteFrom('sign_in_throttle')
        .where('login_hash', '=', row.login_hash)
        .where('device_key', '=', row.device_key)
        .execute();
    }
  }
}
