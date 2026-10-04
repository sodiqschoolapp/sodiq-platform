import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { Audit } from '../audit/audit.service.js';
import { hashPassword, verifyPassword } from './password-hash.js';

/**
 * The token in the session cookie is this many random bytes from
 * `crypto.randomBytes`, written as base64url (43 characters). It is the only
 * secret of a session; 32 bytes cannot be guessed.
 */
export const SESSION_TOKEN_BYTES = 32;

/** What the database keeps of a token: its SHA-256, so a reader of the table cannot use a session. */
function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The session of a request, read from the database on that request. */
export interface ActiveSession {
  sessionId: string;
  accountId: string;
  login: string;
  /** A first password is in use: nothing but the password change is allowed. */
  mustChangePassword: boolean;
}

export interface SignedIn {
  /** For the cookie. It is stored nowhere on the server. */
  token: string;
  session: ActiveSession;
}

/**
 * Sign-in, sign-out and the password change (docs/spec/13-technology.md,
 * Security: cookie sessions kept in the database). Every one writes its audit
 * entry in the same transaction; none of them holds a password or a token.
 */
@Injectable()
export class Sessions {
  /** Hashed once: an unknown login then takes as long as a wrong password. */
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Opens a session. An unknown login and a wrong password are refused alike
   * (`sign_in_failed`). A first password older than 7 days is refused as
   * `password_expired`, but only to somebody who typed it correctly.
   */
  async signIn(login: string, password: string, requestId?: string): Promise<SignedIn> {
    const account = await this.transactions.run([], (transaction) =>
      transaction
        .selectFrom('accounts')
        .select(['id', 'password_hash', 'must_change_password', 'password_expires_at'])
        .where('login', '=', login)
        .executeTakeFirst(),
    );
    // Outside a transaction: the hash takes tens of milliseconds.
    const stored = account?.password_hash ?? (await this.unknownLoginHash());
    const matches = await verifyPassword(stored, password);
    if (account === undefined || !matches) {
      throw new ApiException('sign_in_failed', 401);
    }
    const now = this.clock.now();
    if (account.password_expires_at !== null && account.password_expires_at <= now) {
      throw new ApiException('password_expired', 401);
    }

    const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
    return this.transactions.run([], async (transaction) => {
      // The password may have been changed since it was checked above.
      const current = await transaction
        .selectFrom('accounts')
        .select('password_hash')
        .where('id', '=', account.id)
        .forShare()
        .executeTakeFirstOrThrow();
      if (current.password_hash !== account.password_hash) {
        throw new ApiException('sign_in_failed', 401);
      }
      const session = await transaction
        .insertInto('sessions')
        .values({ account_id: account.id, token_hash: tokenHash(token), created_at: now })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit.record(transaction, {
        branchId: null,
        actorId: account.id,
        action: 'auth.sign_in',
        record: { type: 'session', id: session.id },
        ...(requestId === undefined ? {} : { requestId }),
      });
      return {
        token,
        session: {
          sessionId: session.id,
          accountId: account.id,
          login,
          mustChangePassword: account.must_change_password,
        },
      };
    });
  }

  /** The session a token stands for, while it has not ended. */
  async resolve(token: string): Promise<ActiveSession | undefined> {
    const found = await this.transactions.run([], (transaction) =>
      transaction
        .selectFrom('sessions')
        .innerJoin('accounts', 'accounts.id', 'sessions.account_id')
        .select([
          'sessions.id as session_id',
          'accounts.id as account_id',
          'accounts.login',
          'accounts.must_change_password',
        ])
        .where('sessions.token_hash', '=', tokenHash(token))
        .where('sessions.ended_at', 'is', null)
        .executeTakeFirst(),
    );
    return found === undefined
      ? undefined
      : {
          sessionId: found.session_id,
          accountId: found.account_id,
          login: found.login,
          mustChangePassword: found.must_change_password,
        };
  }

  /** Ends this session; other sessions of the account stay. */
  async signOut(session: ActiveSession, requestId?: string): Promise<void> {
    await this.transactions.run([], async (transaction) => {
      const ended = await transaction
        .updateTable('sessions')
        .set({ ended_at: this.clock.now(), end_reason: 'sign_out' })
        .where('id', '=', session.sessionId)
        .where('ended_at', 'is', null)
        .returning('id')
        .executeTakeFirst();
      if (ended === undefined) {
        // Ended by another request in the meantime: nothing to do or to record.
        return;
      }
      await this.audit.record(transaction, {
        branchId: null,
        actorId: session.accountId,
        action: 'auth.sign_out',
        record: { type: 'session', id: session.sessionId },
        ...(requestId === undefined ? {} : { requestId }),
      });
    });
  }

  /**
   * Edge cases, "Accounts and sign-in": staff change their own password with
   * the current one, and a password change ends all other sessions. This also
   * lifts the forced change of a first password.
   */
  async changePassword(
    session: ActiveSession,
    currentPassword: string,
    newPassword: string,
    requestId?: string,
  ): Promise<void> {
    const account = await this.transactions.run([], (transaction) =>
      transaction
        .selectFrom('accounts')
        .select('password_hash')
        .where('id', '=', session.accountId)
        .executeTakeFirstOrThrow(),
    );
    if (!(await verifyPassword(account.password_hash, currentPassword))) {
      throw new ApiException('current_password_wrong', 403);
    }
    if (newPassword === currentPassword) {
      throw new ApiException('password_unchanged', 400);
    }
    const newHash = await hashPassword(newPassword);

    await this.transactions.run([], async (transaction) => {
      const now = this.clock.now();
      const changed = await transaction
        .updateTable('accounts')
        .set({
          password_hash: newHash,
          must_change_password: false,
          password_expires_at: null,
          password_changed_at: now,
        })
        .where('id', '=', session.accountId)
        // Not if another request changed the password since it was checked above.
        .where('password_hash', '=', account.password_hash)
        .returning('id')
        .executeTakeFirst();
      if (changed === undefined) {
        throw new ApiException('current_password_wrong', 403);
      }
      const ended = await transaction
        .updateTable('sessions')
        .set({ ended_at: now, end_reason: 'password_change' })
        .where('account_id', '=', session.accountId)
        .where('id', '<>', session.sessionId)
        .where('ended_at', 'is', null)
        .returning('id')
        .execute();
      await this.audit.record(transaction, {
        branchId: null,
        actorId: session.accountId,
        action: 'auth.password_change',
        record: { type: 'account', id: session.accountId },
        details: { endedSessions: ended.length },
        ...(requestId === undefined ? {} : { requestId }),
      });
    });
  }

  private unknownLoginHash(): Promise<string> {
    this.dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
    return this.dummyHash;
  }
}
