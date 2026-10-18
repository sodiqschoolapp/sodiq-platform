import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LoadKit } from '../../testing/load-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
const STARTS_ON = '2026-10-19';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// What the database keeps of a publish (db/migrations/0073; task 5.5a-1, pull
// request #139, decisions 4, 8 and 9, spec review of the plan, should-fix 1):
// a draft is published once and stays published; nothing of a published
// version changes, the mark "out of date" and the edit lock included; the
// reason of a row marked "deliberately short" is trimmed and 1 to 500
// characters. All names are invented.
describe('publish in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LoadKit;
  let branchCount = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** A draft in a branch of its own with a current year. */
  async function draft(
    yearStatus: 'current' | 'closed' = 'current',
  ): Promise<{ branch: string; year: string; version: string }> {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Publish branch ${String(branchCount)}`);
    const year = await kit.classes.year(branch);
    const version = await kit.version(branch, year, { startsOn: STARTS_ON });
    if (yearStatus === 'closed') {
      await kit.classes.setYear(year, 'closed');
    }
    return { branch, year, version };
  }

  const setStatus = (branch: string, version: string, status: 'draft' | 'published' | 'archived') =>
    inBranch(branch, (transaction) =>
      transaction
        .updateTable('timetable_versions')
        .set({ status })
        .where('id', '=', version)
        .execute(),
    );

  const statusOf = async (version: string) =>
    (
      await database.migrator
        .selectFrom('timetable_versions')
        .select('status')
        .where('id', '=', version)
        .executeTakeFirstOrThrow()
    ).status;

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = new LoadKit(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('publishes a draft once', async () => {
    const { branch, version } = await draft();
    await setStatus(branch, version, 'published');
    expect(await statusOf(version)).toBe('published');
    // The same status again changes nothing and is not refused.
    await setStatus(branch, version, 'published');
    expect(await statusOf(version)).toBe('published');
  });

  it('refuses every other change of the status', async () => {
    const { branch, version } = await draft();
    const archived = await refusal(setStatus(branch, version, 'archived'));
    expect(archived).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'timetable_versions_status',
    });
    await setStatus(branch, version, 'published');
    // Task 5.5a-3a, decision 2 (Look first): published to archived is allowed
    // for a version that has not started; publish-chain.database.test.ts
    // tests it and its refusals.
    for (const status of ['draft'] as const) {
      const refused = await refusal(setStatus(branch, version, status));
      expect(refused).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'timetable_versions_status',
      });
    }
    expect(await statusOf(version)).toBe('published');
  });

  it('refuses a publish in a closed year', async () => {
    const { branch, version } = await draft('closed');
    const refused = await refusal(setStatus(branch, version, 'published'));
    expect(refused).toMatchObject({ code: CHECK_VIOLATION, constraint: 'version_year_closed' });
    expect(await statusOf(version)).toBe('draft');
  });

  it('writes the mark and the edit lock on a draft', async () => {
    const { branch, version } = await draft();
    await inBranch(branch, (transaction) =>
      transaction
        .updateTable('timetable_versions')
        .set({ out_of_date_at: new Date(NOW), edit_holder_id: null, edit_seen_at: null })
        .where('id', '=', version)
        .execute(),
    );
    const row = await database.migrator
      .selectFrom('timetable_versions')
      .select('out_of_date_at')
      .where('id', '=', version)
      .executeTakeFirstOrThrow();
    expect(row.out_of_date_at).toEqual(new Date(NOW));
  });

  it('changes no column of a published version', async () => {
    const { branch, version } = await draft();
    await setStatus(branch, version, 'published');
    const changes = [
      { starts_on: '2026-10-26' },
      { left_rows: JSON.stringify([]) },
      { templates_confirmed: JSON.stringify([]) },
      { weight_main_room: 4 },
      { rules_confirmed: JSON.stringify({}) },
      { out_of_date_at: new Date(NOW) },
      { edit_seen_at: new Date(NOW) },
    ] as const;
    for (const set of changes) {
      const refused = await refusal(
        inBranch(branch, (transaction) =>
          transaction
            .updateTable('timetable_versions')
            .set(set)
            .where('id', '=', version)
            .execute(),
        ),
      );
      expect(refused, JSON.stringify(set)).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'timetable_versions_draft',
      });
    }
  });

  it('refuses the edit lock of a published version', async () => {
    const { branch, version } = await draft();
    const account = await kit.classes.account();
    await setStatus(branch, version, 'published');
    const refused = await refusal(
      inBranch(branch, (transaction) =>
        transaction
          .updateTable('timetable_versions')
          .set({ edit_holder_id: account, edit_seen_at: new Date(NOW) })
          .where('id', '=', version)
          .execute(),
      ),
    );
    expect(refused).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'timetable_versions_draft',
    });
  });

  describe('the reason of a row marked deliberately short', () => {
    async function rowOf(): Promise<{ branch: string; version: string; row: string }> {
      const { branch, year, version } = await draft();
      const subject = await kit.classes.subject({ grades: [7] });
      const teacher = await kit.teacher(branch, { subjects: [{ subject, grades: [7] }] });
      const row = await kit.row({
        branch_id: branch,
        version_id: version,
        class_id: await kit.classes.schoolClass(branch, year, { grade: 7 }),
        subject_id: subject,
        teacher_id: teacher.staffId,
      });
      return { branch, version, row };
    }

    const setReason = (branch: string, row: string, reason: string | null) =>
      inBranch(branch, (transaction) =>
        transaction
          .updateTable('teaching_load_rows')
          .set({ short_reason: reason })
          .where('id', '=', row)
          .execute(),
      );

    it('takes a reason of 1 to 500 characters and takes it away', async () => {
      const { branch, row } = await rowOf();
      await setReason(branch, row, 'Taught in the other half of the year');
      await setReason(branch, row, 'x'.repeat(500));
      await setReason(branch, row, null);
    });

    it('refuses an empty, padded or too long reason', async () => {
      const { branch, row } = await rowOf();
      for (const reason of ['', ' ', ' Lab closed', 'Lab closed ', 'x'.repeat(501)]) {
        const refused = await refusal(setReason(branch, row, reason));
        expect(refused, reason).toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'teaching_load_rows_short_reason_check',
        });
      }
    });

    it('refuses a reason on a row of a published version', async () => {
      const { branch, version, row } = await rowOf();
      await setStatus(branch, version, 'published');
      const refused = await refusal(setReason(branch, row, 'Lab closed'));
      expect(refused).toMatchObject({ code: CHECK_VIOLATION, constraint: 'load_version_draft' });
    });
  });
});
