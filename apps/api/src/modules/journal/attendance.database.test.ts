import { ABSENCE_CATEGORIES, ABSENCE_REASON_NOTE_MAX } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { MembersKit } from '../../testing/members-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const INSUFFICIENT_PRIVILEGE = '42501';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';

async function refusal(
  work: Promise<unknown>,
): Promise<{ code?: string; constraint?: string; message?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string; message?: string };
  }
  throw new Error('The database did not refuse it.');
}

// The reasons of a student's absence in the database (task 6.3, pull request #211;
// db/migrations/0113): the branch filter, the key with no action, the unique key per
// student and date, the checks, the moment from the injected clock, the grants and the
// student changed only by a merge (review correction 2). All names are invented.
describe('reasons of absence in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let classes: ClassesKit;
  let members: MembersKit;
  let north: string;
  let south: string;
  let account: string;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  const values = (
    branch: string,
    studentId: string,
    input: { date?: string; category?: string | null; note?: string } = {},
  ) => ({
    branch_id: branch,
    student_id: studentId,
    absence_date: input.date ?? '2026-10-12',
    category: input.category === undefined ? 'illness' : input.category,
    note: input.note ?? '',
    changed_by: account,
    changed_at: new Date(0),
  });

  /** A reason written as the application. */
  const insert = (
    branch: string,
    studentId: string,
    input: { date?: string; category?: string | null; note?: string } = {},
  ) =>
    inBranch(branch, (transaction) =>
      transaction
        .insertInto('student_absence_reasons')
        .values(values(branch, studentId, input))
        .returning(['id', 'changed_at'])
        .executeTakeFirstOrThrow(),
    );

  const pupil = (branch: string) => members.student(branch, { startsOn: '2026-09-01', grade: 7 });

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    classes = new ClassesKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    await classes.year(north);
    await classes.year(south);
    account = await classes.account();
    members = new MembersKit(database.migrator, account);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('writes the moment from the injected clock, whatever the insert says', async () => {
    const student = await pupil(north);
    const row = await insert(north, student);
    expect(new Date(row.changed_at).toISOString()).toBe(new Date(NOW).toISOString());
    const failed = await refusal(
      database.migrator
        .insertInto('student_absence_reasons')
        .values(values(north, student, { date: '2026-10-13' }))
        .execute(),
    );
    expect(failed.constraint).toBe('student_absence_reasons_moment');
  });

  it('shows a branch its own reasons only', async () => {
    const student = await pupil(south);
    await insert(south, student);
    const seen = await inBranch(north, (transaction) =>
      transaction
        .selectFrom('student_absence_reasons')
        .select('id')
        .where('student_id', '=', student)
        .execute(),
    );
    expect(seen).toEqual([]);
    // A transaction of the north branch writes no row of the south branch.
    const written = await refusal(
      inBranch(north, (transaction) =>
        transaction
          .insertInto('student_absence_reasons')
          .values(values(south, student, { date: '2026-10-20' }))
          .execute(),
      ),
    );
    expect(written.code).not.toBeUndefined();
  });

  it('keeps one reason per student and date in a branch', async () => {
    const student = await pupil(north);
    await insert(north, student, { date: '2026-10-14' });
    const failed = await refusal(
      insert(north, student, { date: '2026-10-14', category: 'family' }),
    );
    expect(failed.code).toBe(UNIQUE_VIOLATION);
    expect(failed.constraint).toBe('student_absence_reasons_key');
  });

  it('holds the categories and the note bound of packages/shared, and an empty note on a cleared reason', async () => {
    const student = await pupil(north);
    for (const [index, category] of ABSENCE_CATEGORIES.entries()) {
      await insert(north, student, { date: `2026-11-0${String(index + 1)}`, category });
    }
    const other = await refusal(
      insert(north, student, { date: '2026-11-10', category: 'holiday' }),
    );
    expect(other.code).toBe(CHECK_VIOLATION);
    expect(other.constraint).toBe('student_absence_reasons_category_check');
    await insert(north, student, { date: '2026-11-11', note: 'x'.repeat(ABSENCE_REASON_NOTE_MAX) });
    const long = await refusal(
      insert(north, student, { date: '2026-11-12', note: 'x'.repeat(ABSENCE_REASON_NOTE_MAX + 1) }),
    );
    expect(long.constraint).toBe('student_absence_reasons_note_check');
    await insert(north, student, { date: '2026-11-13', category: null });
    const noted = await refusal(
      insert(north, student, { date: '2026-11-14', category: null, note: 'x' }),
    );
    expect(noted.constraint).toBe('student_absence_reasons_note_check');
  });

  it('refuses the delete of a student with a reason by the key', async () => {
    const student = await pupil(north);
    await insert(north, student);
    const failed = await refusal(
      database.migrator.transaction().execute(async (transaction) => {
        await sql`select set_config('app.now', ${NOW}, true)`.execute(transaction);
        await transaction.deleteFrom('students').where('id', '=', student).execute();
      }),
    );
    expect(failed.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(failed.constraint).toBe('student_absence_reasons_student_fkey');
  });

  it('grants no delete and no change of the branch or the date to the application', async () => {
    const student = await pupil(north);
    const row = await insert(north, student, { date: '2026-10-21' });
    const deleted = await refusal(
      inBranch(north, (transaction) =>
        transaction.deleteFrom('student_absence_reasons').where('id', '=', row.id).execute(),
      ),
    );
    expect(deleted.code).toBe(INSUFFICIENT_PRIVILEGE);
    for (const set of [{ absence_date: '2026-10-22' }, { branch_id: south }]) {
      const changed = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('student_absence_reasons')
            .set(set)
            .where('id', '=', row.id)
            .execute(),
        ),
      );
      expect(changed.code).toBe(INSUFFICIENT_PRIVILEGE);
    }
    // The category, the note and who changed it are the application's to write.
    await inBranch(north, (transaction) =>
      transaction
        .updateTable('student_absence_reasons')
        .set({ category: 'unexcused', note: 'No word', changed_by: account })
        .where('id', '=', row.id)
        .execute(),
    );
  });

  it('refuses a change of the student outside a merge written in the same transaction', async () => {
    const kept = await pupil(north);
    const merged = await pupil(north);
    const row = await insert(north, merged, { date: '2026-10-23' });
    const moved = await refusal(
      inBranch(north, (transaction) =>
        transaction
          .updateTable('student_absence_reasons')
          .set({ student_id: kept })
          .where('id', '=', row.id)
          .execute(),
      ),
    );
    expect(moved.constraint).toBe('student_absence_reasons_merge');
    // The merge itself carries it: student-merges.test.ts.
  });
});
