import type { Database } from '../database/database.js';
import { Transactions } from '../database/transactions.js';
import { FixedClock } from './fixed-clock.js';

/**
 * Task 9.2b: a quarter closed as the close writes its closing row (the close itself is tested
 * in `closing.test.ts`), for the tests of the writes a closed quarter refuses. The moment is
 * the transaction's; the account is the closer. Task 9.2c: the names of every journal of the
 * quarter's year are stored with it, as the close stores them, so a journal can be reopened.
 * Answers the closing's id.
 */
export async function closeQuarter(
  database: { readonly app: Database; readonly migrator: Database },
  input: {
    readonly branchId: string;
    readonly quarterId: string;
    readonly accountId: string;
    readonly at?: string;
  },
): Promise<string> {
  const transactions = new Transactions(
    database.app,
    new FixedClock(input.at ?? '2026-10-31T18:00:00+05:00'),
  );
  return transactions.run([input.branchId], async (transaction) => {
    const row = await transaction
      .insertInto('quarter_closings')
      .values({
        branch_id: input.branchId,
        quarter_id: input.quarterId,
        version: 1,
        closed_at: new Date(0),
        closed_by: input.accountId,
        lock_now: false,
        start_quarter: null,
        warnings: JSON.stringify([]),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const journals = await transaction
      .selectFrom('journals')
      .innerJoin('quarters', 'quarters.academic_year_id', 'journals.academic_year_id')
      .select('journals.id')
      .where('quarters.id', '=', input.quarterId)
      .where('journals.branch_id', '=', input.branchId)
      .execute();
    if (journals.length > 0) {
      await transaction
        .insertInto('quarter_closing_journals')
        .values(
          journals.map((journal) => ({
            branch_id: input.branchId,
            closing_id: row.id,
            journal_id: journal.id,
            unit_name: '7 Oxford',
            subject_names: JSON.stringify({ uz: 'Fizika', ru: 'Физика', en: 'Physics' }),
            teacher_name: null,
          })),
        )
        .execute();
    }
    return row.id;
  });
}

/**
 * Task 9.2c: a reopening as the route writes it, of the whole branch (`journalId` null) or of
 * one journal, at a moment (its end from the trigger). Answers the reopening's id.
 */
export async function reopenQuarter(
  database: { readonly app: Database },
  input: {
    readonly branchId: string;
    readonly quarterId: string;
    readonly journalId: string | null;
    readonly accountId: string;
    readonly at: string;
    readonly days?: number;
  },
): Promise<string> {
  const transactions = new Transactions(database.app, new FixedClock(input.at));
  return transactions.run([input.branchId], async (transaction) => {
    const closing = await transaction
      .selectFrom('quarter_closings')
      .select('id')
      .where('quarter_id', '=', input.quarterId)
      .where('cause', '=', 'close')
      .where('reopened_at', 'is', null)
      .executeTakeFirstOrThrow();
    const row = await transaction
      .insertInto('quarter_reopenings')
      .values({
        branch_id: input.branchId,
        quarter_id: input.quarterId,
        closing_id: closing.id,
        journal_id: input.journalId,
        reason: 'A mark was typed in the wrong row',
        days: input.days ?? 3,
        reopened_at: new Date(0),
        open_until: new Date(0),
        reopened_by: input.accountId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  });
}

/**
 * Task 9.2c: the re-close of a reopened journal as the route writes its rows (the re-close
 * itself is tested in `closing.test.ts`): the next version for that journal, its names, and its
 * reopening ended. Answers the closing's id.
 */
export async function closeJournalAgain(
  database: { readonly app: Database },
  input: {
    readonly branchId: string;
    readonly quarterId: string;
    readonly journalId: string;
    readonly accountId: string;
    readonly at: string;
  },
): Promise<string> {
  const transactions = new Transactions(database.app, new FixedClock(input.at));
  return transactions.run([input.branchId], async (transaction) => {
    const row = await transaction
      .insertInto('quarter_closings')
      .values({
        branch_id: input.branchId,
        quarter_id: input.quarterId,
        version: 0,
        closed_at: new Date(0),
        closed_by: input.accountId,
        lock_now: false,
        start_quarter: null,
        warnings: JSON.stringify([]),
        cause: 'journal_close',
        journal_id: input.journalId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarter_closing_journals')
      .values({
        branch_id: input.branchId,
        closing_id: row.id,
        journal_id: input.journalId,
        unit_name: '7 Oxford',
        subject_names: JSON.stringify({ uz: 'Fizika', ru: 'Физика', en: 'Physics' }),
        teacher_name: null,
      })
      .execute();
    await transaction
      .updateTable('quarter_reopenings')
      .set({ ended_by_closing_id: row.id })
      .where('quarter_id', '=', input.quarterId)
      .where('journal_id', '=', input.journalId)
      .where('ended_by_closing_id', 'is', null)
      .execute();
    return row.id;
  });
}
