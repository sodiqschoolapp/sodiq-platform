import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Transactions } from '../../database/transactions.js';
import { Accounts, type CreatedAccount } from './accounts.service.js';

/** The command was run although an account exists. */
export class AccountsExistError extends Error {
  constructor() {
    super('An account already exists. The first account is created only once.');
  }
}

/** Any fixed number: two runs of the command at the same moment wait for each other. */
const FIRST_ACCOUNT_LOCK = 60_601;

/**
 * Edge cases, "Accounts and sign-in": the first Super Admin is created by a
 * one-time command on the server, which is logged. Roles arrive with task 0.7,
 * which makes this command also write the Super Admin assignment; until then
 * it creates the first account.
 */
@Injectable()
export class FirstAccount {
  constructor(
    private readonly transactions: Transactions,
    private readonly accounts: Accounts,
  ) {}

  /** Throws `AccountsExistError` when there is an account, `LoginNameError` for a name without a login. */
  create(firstName: string, lastName: string): Promise<CreatedAccount> {
    return this.transactions.run([], async (transaction) => {
      await sql`select pg_advisory_xact_lock(${FIRST_ACCOUNT_LOCK})`.execute(transaction);
      const existing = await transaction
        .selectFrom('accounts')
        .select('id')
        .limit(1)
        .executeTakeFirst();
      if (existing !== undefined) {
        throw new AccountsExistError();
      }
      return this.accounts.create(transaction, {
        firstName,
        lastName,
        createdBy: null,
        details: { command: 'first-account' },
      });
    });
  }
}
