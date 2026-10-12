import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_LANGUAGE, LOGIN_MAX_LENGTH, type Clock } from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import type { Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { Audit } from '../audit/audit.service.js';
import { loginBase, loginForms, LoginNameError } from './login.js';
import { hashPassword } from './password-hash.js';

/** Edge cases, "Accounts and sign-in": first passwords are valid for 7 days. */
export const FIRST_PASSWORD_VALID_MS = 7 * 24 * 60 * 60 * 1000;

export const FIRST_PASSWORD_LENGTH = 16;

/** Letters and digits without the ones that look alike on a printed slip (0 O, 1 l I). */
const FIRST_PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Also the one-time password of a reset (`PasswordResets`). */
export function randomFirstPassword(): string {
  let password = '';
  for (let index = 0; index < FIRST_PASSWORD_LENGTH; index += 1) {
    password += FIRST_PASSWORD_ALPHABET.charAt(randomInt(FIRST_PASSWORD_ALPHABET.length));
  }
  return password;
}

/** The chosen login is given to another account; logins are never reused. */
export class LoginTakenError extends Error {
  constructor() {
    super('The login is given to another account.');
  }
}

export interface NewAccount {
  /** Used for the login only; an account stores no name. */
  firstName: string;
  lastName: string;
  /**
   * The login the Super Admin chose (task 2.3a): the suggestion or a typed
   * one, already checked against its form. Left out, the login is made from
   * the name (the first-account command).
   */
  login?: string;
  /** The account of the administrator who creates this one; `null` for the server command. */
  createdBy: string | null;
  /** For the audit entry, for example which command acted. */
  details?: JsonValue;
  requestId?: string;
  /** For the audit entry: the assignment that allowed the administrator to act (task 2.3a). */
  actingAssignmentId?: string;
  /** For the audit entry: the staff record of the person (task 2.3a). */
  personId?: string;
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
    const base = account.login ?? loginBase(account.firstName, account.lastName);
    const firstPassword = randomFirstPassword();
    const passwordHash = await hashPassword(firstPassword);
    const now = this.clock.now();

    // The unique constraint is the guard. When somebody else takes the login
    // between the read and the insert, the insert adds nothing and the next
    // round reads again.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const login = account.login ?? (await this.nextLogin(transaction, base));
      const inserted = await transaction
        .insertInto('accounts')
        .values({
          login,
          password_hash: passwordHash,
          must_change_password: true,
          password_expires_at: new Date(now.getTime() + FIRST_PASSWORD_VALID_MS),
          created_at: now,
          created_by: account.createdBy,
          // A new account is in Uzbek (decided by the owner, task 0.8d).
          language: DEFAULT_LANGUAGE,
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
          ...(account.actingAssignmentId === undefined
            ? {}
            : { assignmentId: account.actingAssignmentId }),
          ...(account.personId === undefined ? {} : { personId: account.personId }),
        });
        return { id: inserted.id, login, firstPassword };
      }
      if (account.login !== undefined) {
        // A chosen login is not changed: somebody has it.
        throw new LoginTakenError();
      }
    }
    throw new Error('No free login was found for a new account.');
  }

  /**
   * The first free login of the owner's answer 14 for a person (task 2.3a):
   * `a.karimov`, `akmal.karimov`, `akmal.b.karimov` (without a father's
   * name, not this one), then `akmal.karimov2`, 3, ... A form longer than
   * `LOGIN_MAX_LENGTH` is skipped, a number too. `null` when no form fits
   * or the name gives no login: the Super Admin types one.
   */
  async suggest(
    transaction: Transaction,
    name: { firstName: string; lastName: string; fatherName: string | null },
  ): Promise<string | null> {
    let forms: string[];
    try {
      forms = loginForms(name.firstName, name.lastName, name.fatherName);
    } catch (error) {
      if (error instanceof LoginNameError) {
        return null;
      }
      throw error;
    }
    for (const form of forms) {
      if (form.length > LOGIN_MAX_LENGTH) {
        continue;
      }
      const taken = await transaction
        .selectFrom('accounts')
        .select('id')
        .where('login', '=', form)
        .executeTakeFirst();
      if (taken === undefined) {
        return form;
      }
    }
    // The whole first name and the surname, also when it is the first form
    // (a one-letter first name), never the form with the father's initial.
    const numbered = loginForms(name.firstName, name.lastName, null).at(-1);
    if (numbered === undefined) {
      return null;
    }
    const next = await this.nextLogin(transaction, numbered);
    return next.length > LOGIN_MAX_LENGTH ? null : next;
  }

  /**
   * `a.karimov` for the first holder, then `a.karimov2`, `a.karimov3`. Always
   * one above the highest number in use: accounts are never removed, so a
   * login is never given twice.
   */
  private async nextLogin(transaction: Transaction, base: string): Promise<string> {
    // The base holds letters and dots only (`loginBase`, `loginForms`).
    const pattern = `^${base.replaceAll('.', '\\.')}[0-9]*$`;
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
