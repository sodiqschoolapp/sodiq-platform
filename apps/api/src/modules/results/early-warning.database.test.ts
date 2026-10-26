import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
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

// The early-warning entries marked handled in the database (db/migrations/0137; task 9.4a, pull
// request #235): append-only, in the branch's row filter, the moment from the transaction, the
// quarter and the student of the row's own branch, the reason, figure and note checked. Every
// write is made as `sodiq_app` through the branch filter. All names are invented.
describe('early_warning_handled', () => {
  let database: TestDatabase;
  let clock: FixedClock;
  let transactions: Transactions;
  let north: string;
  let south: string;
  let northQuarter: string;
  let southQuarter: string;
  let subject: string;
  let account: string;
  let assignment: string;
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

  const handle = (
    transaction: Transaction,
    values: {
      branch: string;
      quarter: string;
      student: string;
      reason?: string;
      figure?: number;
      note?: string;
    },
  ) =>
    transaction
      .insertInto('early_warning_handled')
      .values({
        branch_id: values.branch,
        quarter_id: values.quarter,
        student_id: values.student,
        subject_id: subject,
        reason: values.reason ?? 'low_result',
        figure: values.figure ?? 42,
        note: values.note ?? 'Spoke to the parents.',
        handled_by: account,
        assignment_id: assignment,
        handled_at: new Date(0),
      })
      .returning(['id', 'handled_at'])
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
    northQuarter = await quarterOf(await load.classes.year(north));
    southQuarter = await quarterOf(await load.classes.year(south));
    subject = await load.classes.subject({ grades: [7], journalType: 'graded' });
    account = await load.classes.account();
    assignment = '019a0000-0000-7000-8000-0000000000b1';
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('writes the moment of the transaction, never the one sent', async () => {
    const student = await studentIn(north);
    const row = await inBranch(north, (transaction) =>
      handle(transaction, { branch: north, quarter: northQuarter, student }),
    );
    expect(row.handled_at).toEqual(new Date(MOMENT));
  });

  it('keeps every row of one entry: the newest is in force', async () => {
    const student = await studentIn(north);
    for (const figure of [40, 35]) {
      await inBranch(north, (transaction) =>
        handle(transaction, { branch: north, quarter: northQuarter, student, figure }),
      );
    }
    const rows = await database.migrator
      .selectFrom('early_warning_handled')
      .select('figure')
      .where('student_id', '=', student)
      .execute();
    expect(rows.map((row) => row.figure).sort()).toEqual([35, 40]);
  });

  it('checks the reason, the figure and the note', async () => {
    const student = await studentIn(north);
    const cases: [Partial<Parameters<typeof handle>[1]>, string][] = [
      [{ reason: 'low_mood' }, 'early_warning_handled_reason_check'],
      [{ figure: -1 }, 'early_warning_handled_figure_check'],
      [{ figure: 1001 }, 'early_warning_handled_figure_check'],
      [{ note: 'x'.repeat(501) }, 'early_warning_handled_note_check'],
      [{ note: ' padded ' }, 'early_warning_handled_note_check'],
    ];
    for (const [patch, constraint] of cases) {
      const refused = await refusal(
        inBranch(north, (transaction) =>
          handle(transaction, { branch: north, quarter: northQuarter, student, ...patch }),
        ),
      );
      expect([refused.code, refused.constraint], constraint).toEqual([CHECK_VIOLATION, constraint]);
    }
    // The bounds themselves pass: EARLY_WARNING_NOTE_MAX_LENGTH, 0 and 1000, every reason.
    for (const reason of ['low_result', 'result_drop', 'low_attendance', 'absences_in_row']) {
      await inBranch(north, (transaction) =>
        handle(transaction, {
          branch: north,
          quarter: northQuarter,
          student,
          reason,
          figure: reason === 'result_drop' ? 1000 : 0,
          note: 'x'.repeat(500),
        }),
      );
    }
  });

  it('filters by branch and refuses a quarter or a student of another branch', async () => {
    const student = await studentIn(north);
    await inBranch(north, (transaction) =>
      handle(transaction, { branch: north, quarter: northQuarter, student }),
    );
    const seen = await inBranch(south, (transaction) =>
      transaction
        .selectFrom('early_warning_handled')
        .select('id')
        .where('student_id', '=', student)
        .execute(),
    );
    expect(seen).toEqual([]);
    const otherBranch = await refusal(
      inBranch(south, (transaction) =>
        handle(transaction, { branch: north, quarter: northQuarter, student }),
      ),
    );
    expect(otherBranch.code).toBe(INSUFFICIENT_PRIVILEGE);
    const otherQuarter = await refusal(
      inBranch(north, (transaction) =>
        handle(transaction, { branch: north, quarter: southQuarter, student }),
      ),
    );
    expect([otherQuarter.code, otherQuarter.constraint]).toEqual([
      FOREIGN_KEY_VIOLATION,
      'early_warning_handled_quarter_fkey',
    ]);
    const southStudent = await studentIn(south);
    const otherStudent = await refusal(
      inBranch(north, (transaction) =>
        handle(transaction, { branch: north, quarter: northQuarter, student: southStudent }),
      ),
    );
    expect([otherStudent.code, otherStudent.constraint]).toEqual([
      FOREIGN_KEY_VIOLATION,
      'early_warning_handled_student_fkey',
    ]);
  });

  it('never lets the application change or delete a row outside a merge', async () => {
    const student = await studentIn(north);
    const row = await inBranch(north, (transaction) =>
      handle(transaction, { branch: north, quarter: northQuarter, student }),
    );
    const deleted = await refusal(
      inBranch(north, (transaction) =>
        transaction.deleteFrom('early_warning_handled').where('id', '=', row.id).execute(),
      ),
    );
    expect(deleted.code).toBe(INSUFFICIENT_PRIVILEGE);
    const changed = await refusal(
      inBranch(north, (transaction) =>
        transaction
          .updateTable('early_warning_handled')
          .set({ note: 'Changed later.' })
          .where('id', '=', row.id)
          .execute(),
      ),
    );
    expect(changed.code).toBe(INSUFFICIENT_PRIVILEGE);
    // Only the merge of this transaction moves a row (0128's journal_merge_carry).
    const moved = await refusal(
      inBranch(north, async (transaction) =>
        transaction
          .updateTable('early_warning_handled')
          .set({ student_id: await studentIn(north) })
          .where('id', '=', row.id)
          .execute(),
      ),
    );
    expect([moved.code, moved.constraint]).toEqual([CHECK_VIOLATION, 'journal_merge_carry']);
    const unchanged = await refusal(
      inBranch(north, (transaction) =>
        transaction
          .updateTable('early_warning_handled')
          .set({ student_id: student })
          .where('id', '=', row.id)
          .execute(),
      ),
    );
    expect([unchanged.code, unchanged.constraint]).toEqual([
      CHECK_VIOLATION,
      'journal_merge_carry',
    ]);
  });

  it('keeps the moment a fixture of the migrator writes when there is none', async () => {
    const student = await studentIn(north);
    const row = await database.migrator
      .insertInto('early_warning_handled')
      .values({
        branch_id: north,
        quarter_id: northQuarter,
        student_id: student,
        subject_id: subject,
        reason: 'low_attendance',
        figure: 70,
        handled_by: account,
        assignment_id: assignment,
        handled_at: new Date('2026-10-20T09:00:00+05:00'),
      })
      .returning(['handled_at', 'note'])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ handled_at: new Date('2026-10-20T09:00:00+05:00'), note: '' });
    expect(
      (
        await sql<{ now: string | null }>`select current_setting('app.now', true) as now`.execute(
          database.migrator,
        )
      ).rows[0]?.now ?? '',
    ).toBe('');
  });
});
