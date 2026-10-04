import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import type { Transaction } from '../../database/transactions.js';
import { Audit } from '../audit/audit.service.js';
import { UnknownAccountError } from './password-resets.service.js';
import { Sessions } from './sessions.service.js';

/** The reason of a lock is kept with it and in the audit log; longer texts are refused. */
export const LOCK_REASON_MAX_LENGTH = 500;

/** Nobody locks or unlocks their own account (decided by the owner). */
export class OwnAccountLockError extends Error {
  constructor() {
    super('An administrator cannot lock or unlock their own account.');
  }
}

export class AccountAlreadyLockedError extends Error {
  constructor() {
    super('The account is already locked.');
  }
}

export class AccountNotLockedError extends Error {
  constructor() {
    super('The account is not locked.');
  }
}

/** Edge cases, "Staff over time": a lock is logged with a reason. */
export class LockReasonError extends Error {
  constructor() {
    super(`A lock needs a reason of 1 to ${String(LOCK_REASON_MAX_LENGTH)} characters.`);
  }
}

export interface AccountLock {
  /** The account that is locked. */
  accountId: string;
  /** The account of the administrator who locks it. */
  lockedBy: string;
  reason: string;
  requestId?: string;
}

export interface AccountUnlock {
  /** The account that is unlocked. */
  accountId: string;
  /** The account of the administrator who unlocks it. */
  unlockedBy: string;
  requestId?: string;
}

/**
 * Edge cases, "Staff over time": locking an account is separate from
 * employment status. "Lock now" ends all sessions at once, needs no
 * reassignment and is logged with a reason. A locked account cannot sign in
 * until it is unlocked; its password, second step and roles stay as they were.
 *
 * Until the screens of task 2.3 this service has no route: who may lock whom,
 * and the refusal to lock the last active Super Admin, are questions of roles
 * (task 0.7). Only tests call it.
 */
@Injectable()
export class AccountLocks {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: Audit,
    private readonly sessions: Sessions,
  ) {}

  async lock(transaction: Transaction, lock: AccountLock): Promise<void> {
    if (lock.lockedBy === lock.accountId) {
      throw new OwnAccountLockError();
    }
    const reason = lock.reason.trim();
    if (reason === '' || reason.length > LOCK_REASON_MAX_LENGTH) {
      throw new LockReasonError();
    }
    const account = await this.lockedRow(transaction, lock.accountId);
    if (account.locked_at !== null) {
      throw new AccountAlreadyLockedError();
    }
    const now = this.clock.now();
    await transaction
      .updateTable('accounts')
      .set({ locked_at: now, locked_by: lock.lockedBy, lock_reason: reason })
      .where('id', '=', lock.accountId)
      .execute();
    await this.sessions.writeEndsByTime(transaction, lock.accountId);
    const ended = await transaction
      .updateTable('sessions')
      .set({ ended_at: now, end_reason: 'account_locked' })
      .where('account_id', '=', lock.accountId)
      .where('ended_at', 'is', null)
      .returning('id')
      .execute();
    await this.audit.record(transaction, {
      branchId: null,
      actorId: lock.lockedBy,
      action: 'account.locked',
      record: { type: 'account', id: lock.accountId },
      reason,
      details: { endedSessions: ended.length },
      ...(lock.requestId === undefined ? {} : { requestId: lock.requestId }),
    });
  }

  async unlock(transaction: Transaction, unlock: AccountUnlock): Promise<void> {
    if (unlock.unlockedBy === unlock.accountId) {
      throw new OwnAccountLockError();
    }
    const account = await this.lockedRow(transaction, unlock.accountId);
    if (account.locked_at === null) {
      throw new AccountNotLockedError();
    }
    await transaction
      .updateTable('accounts')
      .set({ locked_at: null, locked_by: null, lock_reason: null })
      .where('id', '=', unlock.accountId)
      .execute();
    await this.audit.record(transaction, {
      branchId: null,
      actorId: unlock.unlockedBy,
      action: 'account.unlocked',
      record: { type: 'account', id: unlock.accountId },
      details: { lockedAt: account.locked_at.toISOString(), lockedBy: account.locked_by },
      ...(unlock.requestId === undefined ? {} : { requestId: unlock.requestId }),
    });
  }

  /**
   * The row of the account, locked until the transaction ends. A sign-in takes
   * the same row before it writes its session (`Sessions.signIn`), so of a lock
   * and a sign-in at the same moment one waits for the other: no session of a
   * locked account stays open, by the database and not by timing.
   */
  private async lockedRow(
    transaction: Transaction,
    accountId: string,
  ): Promise<{ locked_at: Date | null; locked_by: string | null }> {
    const account = await transaction
      .selectFrom('accounts')
      .select(['locked_at', 'locked_by'])
      .where('id', '=', accountId)
      .forUpdate()
      .executeTakeFirst();
    if (account === undefined) {
      throw new UnknownAccountError();
    }
    return account;
  }
}
