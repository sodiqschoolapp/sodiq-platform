import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions } from '../../database/transactions.js';
import { Assignments } from '../access/assignments.service.js';
import { notEnded } from '../access/current-assignments.js';
import { Accounts, type CreatedAccount } from './accounts.service.js';

/** The command was run although a Super Admin exists. */
export class SuperAdminExistsError extends Error {
  constructor() {
    super('A Super Admin already exists. The first account is created only once.');
  }
}

/** Any fixed number: two runs of the command at the same moment wait for each other. */
const FIRST_ACCOUNT_LOCK = 60_601;

/**
 * Edge cases, "Accounts and sign-in": the first Super Admin is created by a
 * one-time command on the server, which is logged. It creates the account and
 * gives it the Super Admin role, together. Every later account and role comes
 * from a Super Admin (task 2.3).
 */
@Injectable()
export class FirstAccount {
  constructor(
    private readonly transactions: Transactions,
    private readonly accounts: Accounts,
    private readonly assignments: Assignments,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Refused while a Super Admin assignment that has not ended exists, one that
   * begins later included and one that was taken back before it began not
   * (decided by the owner); accounts without that role
   * do not stand in its way. Throws `SuperAdminExistsError`, and
   * `LoginNameError` for a name without a login.
   */
  create(firstName: string, lastName: string): Promise<CreatedAccount> {
    return this.transactions.run([], async (transaction) => {
      await sql`select pg_advisory_xact_lock(${FIRST_ACCOUNT_LOCK})`.execute(transaction);
      const now = this.clock.now();
      const existing = await transaction
        .selectFrom('assignments')
        .select('id')
        .where('role', '=', 'super_admin')
        .where(notEnded(now))
        .limit(1)
        .executeTakeFirst();
      if (existing !== undefined) {
        throw new SuperAdminExistsError();
      }
      const details = { command: 'first-account' };
      const created = await this.accounts.create(transaction, {
        firstName,
        lastName,
        createdBy: null,
        details,
      });
      await this.assignments.give(transaction, {
        accountId: created.id,
        role: 'super_admin',
        branchId: null,
        givenBy: null,
        details,
      });
      return created;
    });
  }
}
