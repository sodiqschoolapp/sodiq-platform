import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import type { Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { Audit } from '../audit/audit.service.js';
import { loginBase } from './login.js';
import { hashPassword } from './password-hash.js';

/** Edge cases, "Accounts and sign-in": first passwords are valid for 7 days. */
export const FIRST_PASSWORD_VALID_MS = 7 * 24 * 60 * 60 * 1000;

export const FIRST_PASSWORD_LENGTH = 16;

/** Letters and digits without the ones that look alike on a printed slip (0 O, 1 l I). */
const FIRST_PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomFirstPassword(): string {
  let password = '';
  for (let index = 0; index < FIRST_PASSWORD_LENGTH; index += 1) {
    password += FIRST_PASSWORD_ALPHABET.charAt(randomInt(FIRST_PASSWORD_ALPHABET.length));
  }
  return password;
}

export interface NewAccount {
  /** Used for the login only; an account stores no name. */
  firstName: string;
  lastName: string;
  /** The account of the administrator who creates this one; `null` for the server command. */
  createdBy: string | null;
  /** For the audit entry, for example which command acted. */
  details?: JsonValue;
  requestId?: string;
}

export interface CreatedAccount {
  id: string;
  login: string;
  /** Shown once to the administrator and stored nowhere. */
  firstPassword: string;
}

/**
 * docs/spec/02-roles-and-access.md, Rules: there is no open sign-up; every
 * account is created by an administrator. Until the screens of task 2.3 this
 * service has no route: the first-account command and tests call it.
 */
@Injectable()
export class Accounts {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: Audit,
  ) {}

  /**
   * Creates an account with a generated login and a random first password,
   * which is valid for 7 days and must be changed at the first sign-in. Throws
   * `LoginNameError` for a name that cannot give a login.
   */
  async create(transaction: Transaction, account: NewAccount): Promise<CreatedAccount> {
    const base = loginBase(account.firstName, account.lastName);
    const firstPassword = randomFirstPassword();
    const passwordHash = await hashPassword(firstPassword);
    const now = this.clock.now();

    // The unique constraint is the guard. When somebody else takes the login
    // between the read and the insert, the insert adds nothing and the next
    // round reads again.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const login = await this.nextLogin(transaction, base);
      const inserted = await transaction
        .insertInto('accounts')
        .values({
          login,
          password_hash: passwordHash,
          must_change_password: true,
          password_expires_at: new Date(now.getTime() + FIRST_PASSWORD_VALID_MS),
          created_at: now,
          created_by: account.createdBy,
        })
        .onConflict((conflict) => conflict.column('login').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (inserted !== undefined) {
        await this.audit.record(transaction, {
          branchId: null,
          actorId: account.createdBy,
          action: 'account.create',
          record: { type: 'account', id: inserted.id },
          newValue: { login },
          ...(account.details === undefined ? {} : { details: account.details }),
          ...(account.requestId === undefined ? {} : { requestId: account.requestId }),
        });
        return { id: inserted.id, login, firstPassword };
      }
    }
    throw new Error('No free login was found for a new account.');
  }

  /**
   * `a.karimov` for the first holder, then `a.karimov2`, `a.karimov3`. Always
   * one above the highest number in use: accounts are never removed, so a
   * login is never given twice.
   */
  private async nextLogin(transaction: Transaction, base: string): Promise<string> {
    // The base holds letters and one dot only (`loginBase`).
    const pattern = `^${base.replace('.', '\\.')}[0-9]*$`;
    const found = await transaction
      .selectFrom('accounts')
      .select('login')
      .where(sql<boolean>`login ~ ${pattern}`)
      .execute();
    if (found.length === 0) {
      return base;
    }
    const highest = Math.max(
      ...found.map((row) => (row.login === base ? 1 : Number(row.login.slice(base.length)))),
    );
    return `${base}${String(highest + 1)}`;
  }
}
