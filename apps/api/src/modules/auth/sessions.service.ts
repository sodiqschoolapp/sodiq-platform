import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { Audit } from '../audit/audit.service.js';
import { SHORT_IDLE_LIMIT_MS } from './idle-limit.js';
import { LOGIN_FORMAT } from './login.js';
import { hashPassword, verifyPassword } from './password-hash.js';
import { deviceTokenHash, SignInThrottle } from './sign-in-throttle.service.js';

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

function randomToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

/** The session of a request, read from the database on that request. */
export interface ActiveSession {
  sessionId: string;
  accountId: string;
  login: string;
  /** A first or reset password is in use: nothing but the password change is allowed. */
  mustChangePassword: boolean;
  /** The login of the administrator who reset the password, while the reset password is in use. */
  passwordResetBy: string | null;
}

export interface SignedIn {
  /** For the cookie. It is stored nowhere on the server. */
  token: string;
  /** For the device cookie: the one the browser sent, or a new one. */
  deviceToken: string;
  session: ActiveSession;
}

/** What a request that checks a password says about where it comes from. */
export interface PasswordCheckOrigin {
  /** The token of the device cookie, if the browser sent one. */
  deviceToken: string | undefined;
  requestId?: string;
}

export interface SignInOrigin extends PasswordCheckOrigin {
  /** The browser as it names itself; a label for the session list. */
  userAgent: string | undefined;
}

/** One open session of an account, as the profile lists it. */
export interface ListedSession {
  id: string;
  startedAt: Date;
  lastUsedAt: Date;
  userAgent: string | null;
  current: boolean;
}

/**
 * Sign-in, sign-out and the password change (docs/spec/13-technology.md,
 * Security: cookie sessions kept in the database, ended after a period without
 * use; sign-in attempts limited). Every one writes its audit entry in the same
 * transaction; none of them holds a password or a token.
 */
@Injectable()
export class Sessions {
  /** Hashed once: an unknown login then takes as long as a wrong password. */
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly throttle: SignInThrottle,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Opens a session. An unknown login and a wrong password are refused alike
   * (`sign_in_failed`), and both are counted: after five failures each further
   * attempt waits (`too_many_attempts`). A first password older than 7 days or
   * a reset password older than 24 hours is refused as `password_expired`, but
   * only to somebody who typed it correctly.
   */
  async signIn(login: string, password: string, origin: SignInOrigin): Promise<SignedIn> {
    // Text that no login can be is an unknown login. It is not sent to the
    // database, which would refuse some of it (a zero byte) with a fault, and
    // it is not counted: no account can ever have it.
    const found = LOGIN_FORMAT.test(login)
      ? await this.transactions.run([], async (transaction) => {
          const account = await transaction
            .selectFrom('accounts')
            .select([
              'id',
              'password_hash',
              'must_change_password',
              'password_expires_at',
              'password_reset_by',
            ])
            .where('login', '=', login)
            .executeTakeFirst();
          const key = await this.throttle.keyOf(
            transaction,
            login,
            account?.id,
            origin.deviceToken,
          );
          return { account, key };
        })
      : undefined;
    if (found !== undefined) {
      await this.throttle.begin(found.key);
    }
    const account = found?.account;
    // Outside a transaction: the hash takes tens of milliseconds.
    const stored = account?.password_hash ?? (await this.unknownLoginHash());
    const matches = await verifyPassword(stored, password);
    if (found === undefined || account === undefined || !matches) {
      if (account !== undefined) {
        await this.recordFailedSignIn(account.id, origin.requestId);
      }
      throw new ApiException('sign_in_failed', 401);
    }
    await this.throttle.passed(found.key);
    const now = this.clock.now();
    if (account.password_expires_at !== null && account.password_expires_at <= now) {
      throw new ApiException('password_expired', 401);
    }

    const token = randomToken();
    const deviceToken = origin.deviceToken ?? randomToken();
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
        .values({
          account_id: account.id,
          token_hash: tokenHash(token),
          created_at: now,
          last_used_at: now,
          user_agent: origin.userAgent ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      // From now on failures from this browser have a count of their own.
      await transaction
        .insertInto('known_devices')
        .values({
          token_hash: deviceTokenHash(deviceToken),
          account_id: account.id,
          first_signed_in_at: now,
        })
        .onConflict((conflict) => conflict.columns(['token_hash', 'account_id']).doNothing())
        .execute();
      await this.audit.record(transaction, {
        branchId: null,
        actorId: account.id,
        action: 'auth.sign_in',
        record: { type: 'session', id: session.id },
        ...(origin.requestId === undefined ? {} : { requestId: origin.requestId }),
      });
      return {
        token,
        deviceToken,
        session: {
          sessionId: session.id,
          accountId: account.id,
          login,
          mustChangePassword: account.must_change_password,
          passwordResetBy: await this.loginOf(transaction, account.password_reset_by),
        },
      };
    });
  }

  /**
   * The session a token stands for, while it has not ended. Every call is a
   * use: it moves the moment of the last use. A session that was not used for
   * the idle limit is over, whatever its row says; the first request after
   * that writes the end down.
   */
  async resolve(token: string): Promise<ActiveSession | undefined> {
    const now = this.clock.now();
    const limit = this.idleLimitMs();
    return this.transactions.run([], async (transaction) => {
      const use = () =>
        transaction
          .updateTable('sessions')
          // Never backwards: of two requests at the same moment the later clock stays.
          .set({ last_used_at: sql<Date>`greatest(last_used_at, ${now})` })
          .where('token_hash', '=', tokenHash(token))
          .where('ended_at', 'is', null)
          .where('last_used_at', '>', new Date(now.getTime() - limit))
          .returning(['id', 'account_id'])
          .executeTakeFirst();
      let used = await use();
      if (used === undefined && (await this.endIfIdle(transaction, token, now, limit))) {
        // Another request used the session in between: it is in force.
        used = await use();
      }
      if (used === undefined) {
        return undefined;
      }
      const account = await transaction
        .selectFrom('accounts')
        .select(['login', 'must_change_password', 'password_reset_by'])
        .where('id', '=', used.account_id)
        .executeTakeFirstOrThrow();
      return {
        sessionId: used.id,
        accountId: used.account_id,
        login: account.login,
        mustChangePassword: account.must_change_password,
        passwordResetBy: await this.loginOf(transaction, account.password_reset_by),
      };
    });
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
   * Edge cases, "Accounts and sign-in": several sessions are allowed and the
   * profile lists them. Only sessions that are still in force, newest first.
   */
  async list(session: ActiveSession): Promise<ListedSession[]> {
    const now = this.clock.now();
    const found = await this.transactions.run([], (transaction) =>
      transaction
        .selectFrom('sessions')
        .select(['id', 'created_at', 'last_used_at', 'user_agent'])
        .where('account_id', '=', session.accountId)
        .where('ended_at', 'is', null)
        .where('last_used_at', '>', new Date(now.getTime() - this.idleLimitMs()))
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .execute(),
    );
    return found.map((row) => ({
      id: row.id,
      startedAt: row.created_at,
      lastUsedAt: row.last_used_at,
      userAgent: row.user_agent,
      current: row.id === session.sessionId,
    }));
  }

  /** "Sign out everywhere": ends every session of the account, this one included. */
  async signOutEverywhere(session: ActiveSession, requestId?: string): Promise<void> {
    await this.transactions.run([], async (transaction) => {
      await this.writeIdleEnds(transaction, session.accountId);
      const ended = await transaction
        .updateTable('sessions')
        .set({ ended_at: this.clock.now(), end_reason: 'sign_out_everywhere' })
        .where('account_id', '=', session.accountId)
        .where('ended_at', 'is', null)
        .returning('id')
        .execute();
      if (ended.length === 0) {
        // Ended by another request in the meantime: nothing to do or to record.
        return;
      }
      await this.audit.record(transaction, {
        branchId: null,
        actorId: session.accountId,
        action: 'auth.sign_out_everywhere',
        record: { type: 'account', id: session.accountId },
        details: { endedSessions: ended.length },
        ...(requestId === undefined ? {} : { requestId }),
      });
    });
  }

  /**
   * Edge cases, "Accounts and sign-in": staff change their own password with
   * the current one, and a password change ends all other sessions. This also
   * lifts the forced change of a first or reset password. Such a password is
   * no longer valid here either once its time is over, in a session that was
   * opened in time. Wrong current passwords are counted like failed sign-ins.
   */
  async changePassword(
    session: ActiveSession,
    currentPassword: string,
    newPassword: string,
    origin: PasswordCheckOrigin,
  ): Promise<void> {
    const { account, key } = await this.transactions.run([], async (transaction) => ({
      account: await transaction
        .selectFrom('accounts')
        .select(['password_hash', 'password_expires_at'])
        .where('id', '=', session.accountId)
        .executeTakeFirstOrThrow(),
      key: await this.throttle.keyOf(
        transaction,
        session.login,
        session.accountId,
        origin.deviceToken,
      ),
    }));
    await this.throttle.begin(key);
    if (!(await verifyPassword(account.password_hash, currentPassword))) {
      await this.recordFailedPasswordCheck(session, origin.requestId);
      throw new ApiException('current_password_wrong', 403);
    }
    await this.throttle.passed(key);
    if (account.password_expires_at !== null && account.password_expires_at <= this.clock.now()) {
      throw new ApiException('password_expired', 401);
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
          password_reset_by: null,
          password_reset_at: null,
        })
        .where('id', '=', session.accountId)
        // Not if another request changed the password since it was checked above.
        .where('password_hash', '=', account.password_hash)
        .returning('id')
        .executeTakeFirst();
      if (changed === undefined) {
        throw new ApiException('current_password_wrong', 403);
      }
      await this.writeIdleEnds(transaction, session.accountId);
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
        ...(origin.requestId === undefined ? {} : { requestId: origin.requestId }),
      });
    });
  }

  /**
   * How long a session may stay without use. Task 0.7 brings the roles and
   * must call `idleLimitMs(roles)` here: 15 minutes for the Super Admin and
   * the Academic Vice Principal, 30 for everybody else. Until then every
   * session gets the short limit, the strict side (decided by the owner).
   */
  private idleLimitMs(): number {
    return SHORT_IDLE_LIMIT_MS;
  }

  /**
   * Writes down the end of every session of the account that is over by time
   * and was not seen since, each with the moment it was over and its own audit
   * entry. Whatever ends "all sessions" (sign out everywhere, a password
   * change, a reset) calls this first, in its transaction, so that it ends and
   * counts only sessions that were still in force (found by the review).
   */
  async writeIdleEnds(transaction: Transaction, accountId: string): Promise<void> {
    const limit = this.idleLimitMs();
    const ended = await transaction
      .updateTable('sessions')
      .set({
        ended_at: sql<Date>`last_used_at + ${limit} * interval '1 millisecond'`,
        end_reason: 'idle',
      })
      .where('account_id', '=', accountId)
      .where('ended_at', 'is', null)
      .where('last_used_at', '<=', new Date(this.clock.now().getTime() - limit))
      .returning(['id', 'ended_at'])
      .execute();
    for (const session of ended) {
      await this.audit.record(transaction, {
        branchId: null,
        actorId: accountId,
        action: 'auth.session_idle',
        record: { type: 'session', id: session.id },
        details: { endedAt: session.ended_at?.toISOString() ?? null },
      });
    }
  }

  /**
   * Writes down the end of a session that was not used for the idle limit.
   * Answers `true` when the session turned out to be in force after all.
   */
  private async endIfIdle(
    transaction: Transaction,
    token: string,
    now: Date,
    limit: number,
  ): Promise<boolean> {
    const idle = await transaction
      .selectFrom('sessions')
      .select(['id', 'account_id', 'last_used_at'])
      .where('token_hash', '=', tokenHash(token))
      .where('ended_at', 'is', null)
      .executeTakeFirst();
    if (idle === undefined) {
      return false;
    }
    // Used by another request since the update above found it idle: still in force.
    if (idle.last_used_at.getTime() + limit > now.getTime()) {
      return true;
    }
    // The moment it was over, not the moment somebody noticed.
    const endedAt = new Date(idle.last_used_at.getTime() + limit);
    const ended = await transaction
      .updateTable('sessions')
      .set({ ended_at: endedAt, end_reason: 'idle' })
      .where('id', '=', idle.id)
      .where('ended_at', 'is', null)
      // Not if another request used the session since it was read above.
      .where('last_used_at', '=', idle.last_used_at)
      .returning('id')
      .executeTakeFirst();
    if (ended === undefined) {
      return false;
    }
    await this.audit.record(transaction, {
      branchId: null,
      actorId: idle.account_id,
      action: 'auth.session_idle',
      record: { type: 'session', id: idle.id },
      details: { endedAt: endedAt.toISOString() },
    });
    return false;
  }

  /**
   * A wrong current password at the password change: a password event like a
   * failed sign-in (edge cases, "Personal data and the audit log").
   */
  private async recordFailedPasswordCheck(
    session: ActiveSession,
    requestId?: string,
  ): Promise<void> {
    await this.transactions.run([], (transaction) =>
      this.audit.record(transaction, {
        branchId: null,
        actorId: session.accountId,
        action: 'auth.password_change_failed',
        record: { type: 'account', id: session.accountId },
        ...(requestId === undefined ? {} : { requestId }),
      }),
    );
  }

  /** A wrong password for a login that exists. An unknown login leaves no entry: there is nobody to name. */
  private async recordFailedSignIn(accountId: string, requestId?: string): Promise<void> {
    await this.transactions.run([], (transaction) =>
      this.audit.record(transaction, {
        branchId: null,
        // Nobody is signed in: who typed it is not known.
        actorId: null,
        action: 'auth.sign_in_failed',
        record: { type: 'account', id: accountId },
        ...(requestId === undefined ? {} : { requestId }),
      }),
    );
  }

  private async loginOf(
    transaction: Transaction,
    accountId: string | null,
  ): Promise<string | null> {
    if (accountId === null) {
      return null;
    }
    const account = await transaction
      .selectFrom('accounts')
      .select('login')
      .where('id', '=', accountId)
      .executeTakeFirstOrThrow();
    return account.login;
  }

  private unknownLoginHash(): Promise<string> {
    this.dummyHash ??= hashPassword(randomBytes(16).toString('hex')).catch((error: unknown) => {
      // Not kept: the next unknown login tries again.
      this.dummyHash = undefined;
      throw error;
    });
    return this.dummyHash;
  }
}
