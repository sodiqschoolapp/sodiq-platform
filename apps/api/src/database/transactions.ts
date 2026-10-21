import { Inject, Injectable } from '@nestjs/common';
import { branchIdSchema, type Clock } from '@sodiq/shared';
import { sql, type Transaction as KyselyTransaction } from 'kysely';
import type { Database } from './database.js';
import { CLOCK } from '../clock/clock.module.js';
import { DATABASE } from './database.tokens.js';
import type { DB } from './types.generated.js';

export type Transaction = KyselyTransaction<DB>;

/** The transaction setting that the row policies read (db/migrations/0002). */
export const BRANCH_SETTING = 'app.branch_ids';

/**
 * The transaction setting with the moment of the injected clock at the start
 * of the transaction. A rule the database holds against time reads it
 * (`assignments_end_guard`, db/migrations/0027), so the database follows the
 * clock of the application and of its tests, never its own.
 */
export const MOMENT_SETTING = 'app.now';

/**
 * The moment `Transactions.run` set for this transaction (`MOMENT_SETTING`):
 * what a rule compares with when the database compares with it too
 * (`assignments_end_guard`), so that the code and the trigger never see two
 * moments (task 2.3a, finding 6 of the spec review).
 */
export async function transactionMoment(transaction: Transaction): Promise<Date> {
  const found = await sql<{ moment: string | null }>`
    select current_setting(${MOMENT_SETTING}, true) as moment
  `.execute(transaction);
  const moment = found.rows[0]?.moment;
  if (moment == null || moment === '') {
    throw new Error('The transaction has no moment: it was not opened by Transactions.run.');
  }
  return new Date(moment);
}

/**
 * Task 5.8b (decision 4, correction 2 of pull request #195): every line of
 * the lesson history this transaction wrote has an audit entry of this
 * transaction in the lesson's branch, which names who. Asked of the database
 * (`lesson_history_unaudited`, 0105, read past the branch filter) before the
 * commit; a writer that fails it writes the missing entry, the check is never
 * relaxed.
 */
export async function assertLessonChangesAudited(transaction: Transaction): Promise<void> {
  const found = await sql<{ unaudited: boolean }>`
    select lesson_history_unaudited(pg_current_xact_id_if_assigned()) as unaudited
  `.execute(transaction);
  if (found.rows[0]?.unaudited !== false) {
    throw new Error(
      'A change of a dated lesson has no audit entry in its branch (lesson_change_unaudited).',
    );
  }
}

/**
 * The value of `app.branch_ids` for a list of branch ids: a PostgreSQL array
 * of uuids. Each id is checked first, so nothing else can reach the setting.
 */
export function branchFilterValue(branchIds: readonly string[]): string {
  for (const id of branchIds) {
    if (!branchIdSchema.safeParse(id).success) {
      // The value is not repeated: it may be text that a caller sent.
      throw new Error('The branch filter was given something that is not a branch id.');
    }
  }
  return `{${branchIds.join(',')}}`;
}

/**
 * Where business code gets its transaction. The branch filter is set for this
 * transaction only (docs/spec/edge-cases/developer-rules.md, "Branch filter"),
 * so it never stays on a pooled connection.
 */
@Injectable()
export class Transactions {
  /** True once the user of this connection was seen to be subject to the branch filter. */
  private filtered = false;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The row policies do nothing for a superuser, a user with BYPASSRLS, or the
   * owner of the tables (or a member of the owner). Such a user would see every
   * branch, so it is given no transaction.
   */
  private async assertFiltered(transaction: Transaction): Promise<void> {
    const found = await sql<{ unfiltered: boolean }>`
      select r.rolsuper or r.rolbypassrls or pg_has_role(current_user, c.relowner, 'MEMBER')
        as unfiltered
      from pg_roles r, pg_class c
      where r.rolname = current_user and c.oid = 'public.branches'::regclass
    `.execute(transaction);
    if (found.rows[0]?.unfiltered !== false) {
      throw new Error(
        'The database user of the application is not subject to the branch filter (superuser, BYPASSRLS or owner of the tables).',
      );
    }
    this.filtered = true;
  }

  /**
   * Runs `work` in one transaction that sees and writes only rows of
   * `branchIds`: normally one branch, several for a person who works across
   * branches, none (`[]`) for work on school-wide tables only. Commits when
   * `work` returns and rolls back when it throws. The moment of the clock is
   * set for the transaction too (`MOMENT_SETTING`).
   */
  async run<T>(
    branchIds: readonly string[],
    work: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    const filter = branchFilterValue(branchIds);
    return this.database.transaction().execute(async (transaction) => {
      if (!this.filtered) {
        await this.assertFiltered(transaction);
      }
      await sql`
        select set_config(${BRANCH_SETTING}, ${filter}, true),
          set_config(${MOMENT_SETTING}, ${this.clock.now().toISOString()}, true)
      `.execute(transaction);
      const result = await work(transaction);
      await assertLessonChangesAudited(transaction);
      return result;
    });
  }

  /** The transactions that joined a sending branch: one join each. */
  private readonly joined = new WeakSet<Transaction>();

  /**
   * The accept and the decline of a move to another branch only (task 3.3c,
   * decision 1 of pull request #97, Look first): the receiving branch must
   * cut the sending branch's class and group rows, close its release, write
   * its audit entry and change the branch of the student, which the filter of
   * the receiving branch forbids. Asks `branch_move_sending` (0053) for an
   * open release with the id given to `branchId`, the branch of the request,
   * which the filter of this transaction must already hold; then adds the
   * sending branch of that release, and no other, to the filter of the rest
   * of this one transaction. Answers the student and the sending branch, or
   * `undefined` when no such release is open (the caller answers 404).
   * Refuses a second join in one transaction.
   */
  async joinSendingBranch(
    transaction: Transaction,
    moveId: string,
    branchId: string,
  ): Promise<{ studentId: string; fromBranchId: string; effectiveOn: string } | undefined> {
    if (this.joined.has(transaction)) {
      throw new Error('A transaction joins a sending branch once.');
    }
    const found = await sql<{
      student_id: string;
      from_branch_id: string;
      effective_on: string;
      filter: string | null;
    }>`
      select s.student_id, s.from_branch_id, s.effective_on::text as effective_on,
        current_setting(${BRANCH_SETTING}, true) as filter
      from branch_move_sending(${moveId}::uuid, ${branchId}::uuid) s
    `.execute(transaction);
    const row = found.rows[0];
    if (row === undefined) {
      return undefined;
    }
    const current = (row.filter ?? '')
      .replace(/^\{|\}$/g, '')
      .split(',')
      .filter((id) => id !== '');
    const has = (id: string) => current.some((one) => one.toLowerCase() === id.toLowerCase());
    if (!has(branchId)) {
      throw new Error('The receiving branch is not in the filter of this transaction.');
    }
    if (!has(row.from_branch_id)) {
      const filter = branchFilterValue([...current, row.from_branch_id]);
      await sql`select set_config(${BRANCH_SETTING}, ${filter}, true)`.execute(transaction);
    }
    this.joined.add(transaction);
    return {
      studentId: row.student_id,
      fromBranchId: row.from_branch_id,
      effectiveOn: row.effective_on,
    };
  }

  /**
   * The branch create only (task 1.6, correction 2 of pull request #49): its
   * transaction begins with no branch (the branch does not exist yet), and the
   * rows that every branch has (its settings) belong to the new branch. This
   * sets the filter of the rest of that one transaction to the new branch.
   * It refuses a branch this transaction did not insert (its row last written
   * by this transaction, and created at its start: `created_at` defaults to
   * `now()`, the moment the transaction began, so a branch only updated here
   * is refused), and a transaction that already works for a branch, so it can
   * never widen what a request sees.
   */
  async enterCreatedBranch(transaction: Transaction, branchId: string): Promise<void> {
    const filter = branchFilterValue([branchId]);
    const found = await sql<{ created_here: boolean; filter: string | null }>`
      select
        exists (
          select 1 from branches
          where id = ${branchId}::uuid
            and xmin::text = (pg_current_xact_id()::xid)::text
            and created_at = now()
        ) as created_here,
        current_setting(${BRANCH_SETTING}, true) as filter
    `.execute(transaction);
    const row = found.rows[0];
    if (row?.created_here !== true || row.filter !== '{}') {
      throw new Error(
        'Only a branch inserted by this transaction, which works for no branch, is entered.',
      );
    }
    await sql`select set_config(${BRANCH_SETTING}, ${filter}, true)`.execute(transaction);
  }

  /**
   * The shortening and the withdraw of an absence only (task 5.7b-2, decision
   * 1 of pull request #192, Look first): "Shortening the absence returns
   * future lessons to the teacher" in every branch, and the rows of another
   * branch are outside the filter of the request. Asks
   * `absence_substitution_branches` (0102) for the branches holding a
   * substitution in force made for the absence on a lesson not started, which
   * answers nothing unless the absence's person is linked to `branchId`, the
   * branch of the request, which the filter must already hold; then adds
   * those branches, and no other, to the filter of the rest of this one
   * transaction. Answers them, the branch of the request among them when it
   * holds such a lesson. Refuses a second join in one transaction.
   */
  async joinAbsenceBranches(
    transaction: Transaction,
    absenceId: string,
    branchId: string,
  ): Promise<string[]> {
    if (this.joined.has(transaction)) {
      throw new Error('A transaction joins other branches once.');
    }
    const found = await sql<{ branch_id: string }>`
      select s.branch_id
      from absence_substitution_branches(${absenceId}::uuid, ${branchId}::uuid) s
    `.execute(transaction);
    const filter = await sql<{ filter: string | null }>`
      select current_setting(${BRANCH_SETTING}, true) as filter
    `.execute(transaction);
    const current = (filter.rows[0]?.filter ?? '')
      .replace(/^\{|\}$/g, '')
      .split(',')
      .filter((id) => id !== '');
    const has = (id: string) => current.some((one) => one.toLowerCase() === id.toLowerCase());
    if (!has(branchId)) {
      throw new Error('The branch of the request is not in the filter of this transaction.');
    }
    const branches = found.rows.map((row) => row.branch_id);
    const added = branches.filter((id) => !has(id));
    if (added.length > 0) {
      await sql`select set_config(${BRANCH_SETTING}, ${branchFilterValue([...current, ...added])}, true)`.execute(
        transaction,
      );
    }
    this.joined.add(transaction);
    return branches;
  }
}
