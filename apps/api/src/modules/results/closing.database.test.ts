import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const INSUFFICIENT_PRIVILEGE = '42501';

const MOMENT = '2026-10-27T12:00:00+05:00';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// The decisions of the closing checklist in the database (db/migrations/0132; task 9.2a, pull
// request #229): one row per student, subject and quarter, in the branch's row filter, the
// moment from the transaction, no delete, and no decision in a closed year. Every write is made
// as `sodiq_app` through the branch filter. All names are invented.
describe('quarter_result_decisions', () => {
  let database: TestDatabase;
  let clock: FixedClock;
  let transactions: Transactions;
  let north: string;
  let south: string;
  let northQuarter: string;
  let southQuarter: string;
  let northYear: string;
  let subject: string;
  let account: string;
  let load: LoadKit;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) => {
    clock.set(MOMENT);
    return transactions.run([branch], work);
  };

  const studentIn = async (branch: string) =>
    new MembersKit(database.migrator, account).student(branch, {
      startsOn: '2026-09-01',
      grade: 7,
    });

  const decide = (
    transaction: Transaction,
    values: { branch: string; quarter: string; student: string; decision?: string | null },
  ) =>
    transaction
      .insertInto('quarter_result_decisions')
      .values({
        branch_id: values.branch,
        quarter_id: values.quarter,
        subject_id: subject,
        student_id: values.student,
        decision: values.decision === undefined ? 'keep' : values.decision,
        decided_by: account,
        decided_at: new Date(0),
      })
      .returning(['id', 'decided_at', 'version'])
      .executeTakeFirstOrThrow();

  const quarterOf = async (year: string) =>
    (
      await database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;

  beforeAll(async () => {
    database = await createTestDatabase();
    clock = new FixedClock(MOMENT);
    transactions = new Transactions(database.app, clock);
    load = new LoadKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    northYear = await load.classes.year(north);
    northQuarter = await quarterOf(northYear);
    southQuarter = await quarterOf(await load.classes.year(south));
    subject = await load.classes.subject({ grades: [7], journalType: 'graded' });
    account = await load.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('writes the moment of the transaction, never the one sent, and starts at version 1', async () => {
    const student = await studentIn(north);
    const row = await inBranch(north, (transaction) =>
      decide(transaction, { branch: north, quarter: northQuarter, student }),
    );
    expect(row.decided_at).toEqual(new Date(MOMENT));
    expect(row.version).toBe(1);
  });

  it('keeps one row per student, subject and quarter, and a known decision only', async () => {
    const student = await studentIn(north);
    await inBranch(north, (transaction) =>
      decide(transaction, { branch: north, quarter: northQuarter, student }),
    );
    const twice = await refusal(
      inBranch(north, (transaction) =>
        decide(transaction, { branch: north, quarter: northQuarter, student, decision: null }),
      ),
    );
    expect([twice.code, twice.constraint]).toEqual([
      UNIQUE_VIOLATION,
      'quarter_result_decisions_key',
    ]);
    const unknown = await refusal(
      inBranch(north, async (transaction) =>
        decide(transaction, {
          branch: north,
          quarter: northQuarter,
          student: await studentIn(north),
          decision: 'pass',
        }),
      ),
    );
    expect([unknown.code, unknown.constraint]).toEqual([
      CHECK_VIOLATION,
      'quarter_result_decisions_decision_check',
    ]);
  });

  it('filters by branch and refuses a quarter of another branch', async () => {
    const student = await studentIn(north);
    await inBranch(north, (transaction) =>
      decide(transaction, { branch: north, quarter: northQuarter, student }),
    );
    const seen = await inBranch(south, (transaction) =>
      transaction
        .selectFrom('quarter_result_decisions')
        .select('id')
        .where('student_id', '=', student)
        .execute(),
    );
    expect(seen).toEqual([]);
    const otherBranch = await refusal(
      inBranch(south, (transaction) =>
        decide(transaction, { branch: north, quarter: northQuarter, student: student }),
      ),
    );
    expect(otherBranch.code).toBe(INSUFFICIENT_PRIVILEGE);
    const otherQuarter = await refusal(
      inBranch(north, async (transaction) =>
        decide(transaction, {
          branch: north,
          quarter: southQuarter,
          student: await studentIn(north),
        }),
      ),
    );
    expect([otherQuarter.code, otherQuarter.constraint]).toEqual([
      FOREIGN_KEY_VIOLATION,
      'quarter_result_decisions_quarter_fkey',
    ]);
  });

  it('lets the application clear a decision but never delete the row or move it to another student outside a merge', async () => {
    const student = await studentIn(north);
    const row = await inBranch(north, (transaction) =>
      decide(transaction, { branch: north, quarter: northQuarter, student }),
    );
    await inBranch(north, (transaction) =>
      transaction
        .updateTable('quarter_result_decisions')
        .set({ decision: null, version: 2 })
        .where('id', '=', row.id)
        .execute(),
    );
    const deleted = await refusal(
      inBranch(north, (transaction) =>
        transaction.deleteFrom('quarter_result_decisions').where('id', '=', row.id).execute(),
      ),
    );
    expect(deleted.code).toBe(INSUFFICIENT_PRIVILEGE);
    const moved = await refusal(
      inBranch(north, async (transaction) =>
        transaction
          .updateTable('quarter_result_decisions')
          .set({ student_id: await studentIn(north) })
          .where('id', '=', row.id)
          .execute(),
      ),
    );
    // Only the merge of this transaction moves a decision (0128's journal_merge_carry).
    expect([moved.code, moved.constraint]).toEqual([CHECK_VIOLATION, 'journal_merge_carry']);
  });

  it('refuses a write with no moment and any write in a closed year', async () => {
    const student = await studentIn(north);
    const noMoment = await refusal(
      inBranch(north, async (transaction) => {
        await sql`select set_config('app.now', '', true)`.execute(transaction);
        return decide(transaction, { branch: north, quarter: northQuarter, student });
      }),
    );
    expect([noMoment.code, noMoment.constraint]).toEqual([CHECK_VIOLATION, 'journal_cell_moment']);
    // A branch of its own: a closed year is never opened again.
    const east = await insertBranch(database.migrator, 'East');
    const eastYear = await load.classes.year(east);
    const eastQuarter = await quarterOf(eastYear);
    const first = await studentIn(east);
    const later = await studentIn(east);
    const stored = await inBranch(east, (transaction) =>
      decide(transaction, { branch: east, quarter: eastQuarter, student: first }),
    );
    await database.migrator
      .updateTable('academic_years')
      .set({ status: 'closed' })
      .where('id', '=', eastYear)
      .execute();
    const inserted = await refusal(
      inBranch(east, (transaction) =>
        decide(transaction, { branch: east, quarter: eastQuarter, student: later }),
      ),
    );
    expect([inserted.code, inserted.constraint]).toEqual([
      CHECK_VIOLATION,
      'academic_years_closed',
    ]);
    const updated = await refusal(
      inBranch(east, (transaction) =>
        transaction
          .updateTable('quarter_result_decisions')
          .set({ decision: 'not_assessed', version: 2 })
          .where('id', '=', stored.id)
          .execute(),
      ),
    );
    expect([updated.code, updated.constraint]).toEqual([CHECK_VIOLATION, 'academic_years_closed']);
  });
});
