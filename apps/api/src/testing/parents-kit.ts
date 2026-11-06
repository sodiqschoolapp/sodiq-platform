import type { INestApplication } from '@nestjs/common';
import { relativeNameKey } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Database } from '../database/database.js';
import { MOMENT_SETTING, Transactions } from '../database/transactions.js';
import { Accounts, type CreatedAccount } from '../modules/auth/accounts.service.js';
import { MembersKit } from './members-kit.js';
import { cookieOf, NEW_PASSWORD, signInKit } from './sign-in-kit.js';

let count = 0;

/**
 * Students, relatives and Parent accounts for the tests of task 11.1, written by the migrator
 * (the records) and by the application (the accounts). Names are invented.
 */
export class ParentsKit {
  readonly members: MembersKit;

  constructor(
    private readonly app: INestApplication,
    private readonly migrator: Database,
    createdBy: string,
  ) {
    this.members = new MembersKit(migrator, createdBy);
  }

  /** A student of the branch, active from 1 September, and the relative MembersKit links. */
  async student(branch: string): Promise<{ studentId: string; relativeId: string }> {
    const studentId = await this.members.student(branch);
    const link = await this.migrator
      .selectFrom('student_relatives')
      .select('relative_id')
      .where('student_id', '=', studentId)
      .executeTakeFirstOrThrow();
    return { studentId, relativeId: link.relative_id };
  }

  /** A student whose main relative is the one given (the relative MembersKit made is removed). */
  async childOf(branch: string, relativeId: string): Promise<string> {
    const { studentId, relativeId: own } = await this.student(branch);
    await this.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config(${MOMENT_SETTING}, ${'2026-08-20T04:00:00.000Z'}, true)`.execute(
        transaction,
      );
      await transaction
        .updateTable('student_relatives')
        .set({ main_contact: false })
        .where('student_id', '=', studentId)
        .execute();
      await transaction
        .insertInto('student_relatives')
        .values({
          student_id: studentId,
          branch_id: branch,
          relative_id: relativeId,
          relationship: 'mother',
          main_contact: true,
          linked_at: new Date('2026-08-20T09:00:00+05:00'),
        })
        .execute();
      await transaction
        .updateTable('student_relatives')
        .set({ unlinked_at: new Date('2026-08-20T09:00:00+05:00') })
        .where('student_id', '=', studentId)
        .where('relative_id', '=', own)
        .execute();
    });
    return studentId;
  }

  /** A further relative of a student, not the main contact. */
  async relativeOf(
    branch: string,
    studentId: string,
    input: { fullName?: string; portalAccess?: boolean; phone?: string | null } = {},
  ): Promise<string> {
    count += 1;
    const fullName = input.fullName ?? `Shahlo Nazarova${'a'.repeat(count % 5)}`;
    return this.migrator.transaction().execute(async (transaction) => {
      const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
      const id = found.rows[0]?.id ?? '';
      await transaction
        .insertInto('relatives')
        .values({
          id,
          full_name: fullName,
          name_key: relativeNameKey(fullName),
          phone: input.phone ?? null,
        })
        .execute();
      await transaction
        .insertInto('relative_accounts')
        .values({ relative_id: id, created_at: new Date('2026-08-20T09:00:00+05:00') })
        .execute();
      await transaction
        .insertInto('student_relatives')
        .values({
          student_id: studentId,
          branch_id: branch,
          relative_id: id,
          relationship: 'father',
          main_contact: false,
          portal_access: input.portalAccess ?? true,
          linked_at: new Date('2026-08-20T09:00:00+05:00'),
        })
        .execute();
      return id;
    });
  }

  /** A Parent account of the relative, with a first password valid for 30 days. */
  async account(relativeId: string): Promise<CreatedAccount> {
    count += 1;
    const created = await this.app.get(Transactions).run([], (transaction) =>
      this.app.get(Accounts).create(transaction, {
        firstName: 'Parent',
        lastName: `Kit${'x'.repeat(count)}`,
        createdBy: null,
        validForMs: 30 * 24 * 60 * 60 * 1000,
      }),
    );
    await this.migrator
      .updateTable('relative_accounts')
      .set({ account_id: created.id, switched_on_at: new Date('2026-08-20T09:00:00+05:00') })
      .where('relative_id', '=', relativeId)
      .execute();
    return created;
  }

  /** A browser signed in as the parent, its password changed to `NEW_PASSWORD`. */
  async session(relativeId: string): Promise<{ account: CreatedAccount; cookie: string }> {
    const account = await this.account(relativeId);
    const kit = signInKit(this.app);
    const signed = await kit.signIn(account.login, account.firstPassword);
    const cookie = cookieOf(signed);
    if (signed.status !== 200 || cookie === undefined) {
      throw new Error(`The sign-in of the parent failed with ${String(signed.status)}.`);
    }
    const changed = await kit.changePassword(cookie, account.firstPassword, NEW_PASSWORD);
    if (changed.status !== 204) {
      throw new Error(`The password change of the parent failed with ${String(changed.status)}.`);
    }
    return { account, cookie };
  }
}
