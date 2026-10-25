import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const INSUFFICIENT_PRIVILEGE = '42501';

const MOMENT = '2026-10-27T12:00:00+05:00';

async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// The tables of task 8.9 in the database (db/migrations/0131, pull request #227):
// the refusals of saves, append-only, and the branch exports, one queued per person in a
// branch, their columns tied to the status, the status moving one way only and the 24 hours
// of the link written by the trigger (decisions 4, 6 and 7). Every write is made as
// `sodiq_app` through the branch filter at the moment of `clock`. All names are invented.
describe('journal exports and refusals in the database', () => {
  let database: TestDatabase;
  let clock: FixedClock;
  let transactions: Transactions;
  let kit: LessonsKit;
  let north: string;
  let south: string;
  let quarter: string;
  let southQuarter: string;
  let account: string;
  let assignment: string;

  const inBranch = <T>(
    branch: string,
    moment: string,
    work: (transaction: Transaction) => Promise<T>,
  ): Promise<T> => {
    clock.set(moment);
    return transactions.run([branch], work);
  };

  const queued = (branch: string, moment: string, quarterId = quarter) =>
    inBranch(branch, moment, (transaction) =>
      transaction
        .insertInto('journal_exports')
        .values({
          branch_id: branch,
          account_id: account,
          assignment_id: assignment,
          quarter_id: quarterId,
          month: null,
          format: 'xlsx',
          language: 'en',
          requested_at: new Date(0),
        })
        .returning(['id', 'requested_at', 'status'])
        .executeTakeFirstOrThrow(),
    );

  const ready = (branch: string, id: string, moment: string) =>
    inBranch(branch, moment, (transaction) =>
      transaction
        .updateTable('journal_exports')
        .set({
          status: 'ready',
          as_of: new Date(MOMENT),
          file_key: `exports/${id}/file`,
          journals: 3,
          rows: 60,
        })
        .where('id', '=', id)
        .returning(['ready_at', 'expires_at'])
        .executeTakeFirstOrThrow(),
    );

  const refusalRow = (branch: string) =>
    inBranch(branch, MOMENT, (transaction) =>
      transaction
        .insertInto('journal_save_refusals')
        .values({
          branch_id: branch,
          journal_id: '01a10000-0000-7000-8000-000000000001',
          lesson_id: '01a10000-0000-7000-8000-000000000002',
          student_id: '01a10000-0000-7000-8000-000000000003',
          kind: 'attendance',
          value_sent: 1,
          version_sent: null,
          code: 'journal_locked',
          account_id: account,
          refused_at: new Date(MOMENT),
        })
        .returning(['id', 'refused_at'])
        .executeTakeFirstOrThrow(),
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    clock = new FixedClock(MOMENT);
    transactions = new Transactions(database.app, clock);
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    const year = await kit.year(north);
    quarter = year.quarters[0] ?? '';
    southQuarter = (await kit.year(south)).quarters[0] ?? '';
    account = await kit.load.classes.account();
    assignment = (
      await database.migrator
        .insertInto('assignments')
        .values({
          account_id: account,
          role: 'academic_vice_principal',
          branch_id: north,
          valid_from: new Date('2026-09-01T00:00:00+05:00'),
          created_at: new Date('2026-09-01T00:00:00+05:00'),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('journal_save_refusals', () => {
    it('takes the moment of the transaction, and no update or delete from the application', async () => {
      const row = await refusalRow(north);
      expect(row.refused_at.toISOString()).toBe(new Date(MOMENT).toISOString());
      // Any other moment is refused.
      const other = await refusal(
        inBranch(north, MOMENT, (transaction) =>
          transaction
            .insertInto('journal_save_refusals')
            .values({
              branch_id: north,
              journal_id: '01a10000-0000-7000-8000-000000000001',
              lesson_id: '01a10000-0000-7000-8000-000000000002',
              student_id: '01a10000-0000-7000-8000-000000000003',
              kind: 'attendance',
              code: 'journal_locked',
              account_id: account,
              refused_at: new Date('2026-10-27T11:00:00+05:00'),
            })
            .execute(),
        ),
      );
      expect(other).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_cell_moment' });
      for (const statement of [
        sql`update journal_save_refusals set code = 'other' where id = ${row.id}::uuid`,
        sql`delete from journal_save_refusals where id = ${row.id}::uuid`,
      ]) {
        const failed = await refusal(
          inBranch(north, MOMENT, (transaction) => statement.execute(transaction)),
        );
        expect(failed.code).toBe(INSUFFICIENT_PRIVILEGE);
      }
    });

    it('ties the columns to the kind of the save', async () => {
      const failed = await refusal(
        inBranch(north, MOMENT, (transaction) =>
          transaction
            .insertInto('journal_save_refusals')
            .values({
              branch_id: north,
              journal_id: '01a10000-0000-7000-8000-000000000001',
              lesson_id: null,
              student_id: '01a10000-0000-7000-8000-000000000003',
              kind: 'attendance',
              code: 'journal_locked',
              account_id: account,
              refused_at: new Date(MOMENT),
            })
            .execute(),
        ),
      );
      expect(failed).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'journal_save_refusals_shape_check',
      });
    });

    it("hides another branch's rows", async () => {
      const row = await refusalRow(south);
      const seen = await inBranch(north, MOMENT, (transaction) =>
        transaction
          .selectFrom('journal_save_refusals')
          .select('id')
          .where('id', '=', row.id)
          .execute(),
      );
      expect(seen).toEqual([]);
    });
  });

  describe('journal_exports', () => {
    it('writes the moments of the request and of the 24 hours of its link', async () => {
      const row = await queued(north, MOMENT);
      expect(row.status).toBe('queued');
      expect(row.requested_at.toISOString()).toBe(new Date(MOMENT).toISOString());
      const done = await ready(north, row.id, '2026-10-27T12:05:00+05:00');
      expect(done.ready_at?.toISOString()).toBe('2026-10-27T07:05:00.000Z');
      expect(done.expires_at?.toISOString()).toBe('2026-10-28T07:05:00.000Z');
      // The status moves one way, once.
      const again = await refusal(
        inBranch(north, MOMENT, (transaction) =>
          transaction
            .updateTable('journal_exports')
            .set({ status: 'failed', failure: 'journal_export_failed' })
            .where('id', '=', row.id)
            .execute(),
        ),
      );
      expect(again).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_export_status' });
      // A failed export moves nowhere: not to ready, not back to queued.
      const failed = await queued(north, MOMENT);
      await inBranch(north, MOMENT, (transaction) =>
        transaction
          .updateTable('journal_exports')
          .set({ status: 'failed', failure: 'journal_export_failed' })
          .where('id', '=', failed.id)
          .execute(),
      );
      for (const set of [
        {
          status: 'ready',
          failure: null,
          as_of: new Date(MOMENT),
          file_key: 'exports/late/file',
          journals: 1,
          rows: 1,
        },
        { status: 'queued', failure: null },
      ]) {
        const moved = await refusal(
          inBranch(north, MOMENT, (transaction) =>
            transaction
              .updateTable('journal_exports')
              .set(set)
              .where('id', '=', failed.id)
              .execute(),
          ),
        );
        expect(moved).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_export_status' });
      }
    });

    it('refuses a second queued export of one person in a branch, and takes one in another branch', async () => {
      const first = await queued(north, MOMENT);
      const second = await refusal(queued(north, MOMENT));
      expect(second).toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'journal_exports_queued_key',
      });
      await queued(south, MOMENT, southQuarter);
      await inBranch(north, MOMENT, (transaction) =>
        transaction
          .updateTable('journal_exports')
          .set({ status: 'failed', failure: 'journal_export_failed' })
          .where('id', '=', first.id)
          .execute(),
      );
      await queued(north, MOMENT);
    });

    it('marks a queued export stale only 20 minutes after its request', async () => {
      await inBranch(north, MOMENT, (transaction) =>
        transaction
          .updateTable('journal_exports')
          .set({ status: 'failed', failure: 'journal_export_failed' })
          .where('status', '=', 'queued')
          .execute(),
      );
      const row = await queued(north, MOMENT);
      const stale = (moment: string) =>
        inBranch(north, moment, (transaction) =>
          transaction
            .updateTable('journal_exports')
            .set({ status: 'failed', failure: 'journal_export_stale' })
            .where('id', '=', row.id)
            .execute(),
        );
      expect(await refusal(stale('2026-10-27T12:19:59+05:00'))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'journal_export_status',
      });
      await stale('2026-10-27T12:20:00+05:00');
    });

    it('refuses a ready export without its file, counts or snapshot, and a failed one without its code', async () => {
      await inBranch(north, MOMENT, (transaction) =>
        transaction
          .updateTable('journal_exports')
          .set({ status: 'failed', failure: 'journal_export_failed' })
          .where('status', '=', 'queued')
          .execute(),
      );
      const row = await queued(north, MOMENT);
      const noFile = await refusal(
        inBranch(north, MOMENT, (transaction) =>
          transaction
            .updateTable('journal_exports')
            .set({ status: 'ready', as_of: new Date(MOMENT), journals: 1, rows: 1 })
            .where('id', '=', row.id)
            .execute(),
        ),
      );
      expect(noFile).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'journal_exports_ready_check',
      });
      const noCode = await refusal(
        inBranch(north, MOMENT, (transaction) =>
          transaction
            .updateTable('journal_exports')
            .set({ status: 'failed' })
            .where('id', '=', row.id)
            .execute(),
        ),
      );
      expect(noCode).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'journal_exports_failed_check',
      });
      // The moments are the trigger's: the application cannot write a longer link.
      const longer = await refusal(
        inBranch(north, MOMENT, (transaction) =>
          sql`update journal_exports set expires_at = now() + interval '7 days' where id = ${row.id}::uuid`.execute(
            transaction,
          ),
        ),
      );
      expect(longer.code).toBe(INSUFFICIENT_PRIVILEGE);
      const deleted = await refusal(
        inBranch(north, MOMENT, (transaction) =>
          sql`delete from journal_exports where id = ${row.id}::uuid`.execute(transaction),
        ),
      );
      expect(deleted.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it("hides another branch's exports, and keeps a queued export from staying queued by an update", async () => {
      // The earlier tests left a queued export in the south: it is ended first.
      await inBranch(south, MOMENT, (transaction) =>
        transaction
          .updateTable('journal_exports')
          .set({ status: 'failed', failure: 'journal_export_failed' })
          .where('status', '=', 'queued')
          .execute(),
      );
      const row = await queued(south, MOMENT, southQuarter);
      const seen = await inBranch(north, MOMENT, (transaction) =>
        transaction.selectFrom('journal_exports').select('id').where('id', '=', row.id).execute(),
      );
      expect(seen).toEqual([]);
      const still = await refusal(
        inBranch(south, MOMENT, (transaction) =>
          transaction
            .updateTable('journal_exports')
            .set({ status: 'queued' })
            .where('id', '=', row.id)
            .execute(),
        ),
      );
      expect(still).toMatchObject({ code: CHECK_VIOLATION, constraint: 'journal_export_status' });
    });
  });
});
