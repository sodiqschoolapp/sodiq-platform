import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { lessonsHoldingData } from './lesson-data.js';

const CHECK_VIOLATION = '23514';
const INSUFFICIENT_PRIVILEGE = '42501';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
/** Monday 19 October 2026, a school day after today. */
const MONDAY = '2026-10-19';
/** Monday 12 October 2026, a school day before today. */
const PAST = '2026-10-12';

/** The error a promise was refused with, or a failure when it was not refused. */
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

// The protection of dated lessons in the database (db/migrations/0105; task
// 5.8b, pull request #195). 06, Protection: "A dated lesson that already has
// attendance or marks cannot be deleted and cannot change its class, group or
// subject. Its teacher, room and time can change, with a log entry." "Forced
// delete is for Super Admin only, with a typed reason. The attendance and
// marks are kept for 30 days and can be restored." "Every change records who,
// when, the value before and the value after." Every write below is made as
// `sodiq_app` through the branch filter, with no service in between. All
// names are invented.
describe('the protection of dated lessons in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LessonsKit;
  let north: string;
  let south: string;
  let account: string;
  const years = new Map<string, { year: string; quarters: string[] }>();
  let subject: string;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** An audit entry of the transaction in the branch, as `Audit.record` writes it. */
  const audited = (transaction: Transaction, branch: string) =>
    transaction
      .insertInto('audit_log')
      .values({ occurred_at: new Date(NOW), branch_id: branch, action: 'test.lesson_change' })
      .execute();

  /** A lesson of its own block on a date, as the application writes one. */
  async function lesson(
    branch: string,
    input: { date?: string; teacherId?: string | null; classId?: string } = {},
  ): Promise<{ block: string; lesson: string }> {
    const date = input.date ?? MONDAY;
    const classId =
      input.classId ??
      (await kit.load.classes.schoolClass(branch, years.get(branch)?.year ?? '', { grade: 7 }));
    const source = await kit.source(branch, years.get(branch)?.year ?? '', [
      { classId, groupId: null, subjectId: subject },
    ]);
    return inBranch(branch, async (transaction) => {
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: branch,
          academic_year_id: years.get(branch)?.year ?? '',
          quarter_id: years.get(branch)?.quarters[0] ?? '',
          lesson_date: date,
          starts_at: at(date, '09:00'),
          ends_at: at(date, '09:45'),
          version_id: source.versionId,
          pattern_block_id: source.patternBlockId,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      const row = await transaction
        .insertInto('lessons')
        .values({
          branch_id: branch,
          block_id: block.id,
          lesson_date: block.lesson_date,
          starts_at: block.starts_at,
          ends_at: block.ends_at,
          class_id: classId,
          subject_id: subject,
          load_row_id: source.lessons[0]?.loadRowId ?? '',
          pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
          teacher_id: input.teacherId ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { block: block.id, lesson: row.id };
    });
  }

  /** A store row naming the lesson (and its block when given), in the transaction. */
  const storeRow = (
    transaction: Transaction,
    branch: string,
    lessonId: string,
    blockId: string | null = null,
  ) =>
    transaction
      .insertInto('forced_deletes')
      .values({
        branch_id: branch,
        record_type: 'lesson',
        record_id: lessonId,
        rows: JSON.stringify(blockId === null ? { block: null } : { block: { id: blockId } }),
        reason: 'Entered for the wrong class',
        deleted_by: account,
        deleted_at: new Date('2020-01-01T00:00:00Z'),
        restore_until: new Date('2099-01-01T00:00:00Z'),
      })
      .returning(['id', 'deleted_at', 'restore_until'])
      .executeTakeFirstOrThrow();

  const historyOf = (lessonId: string) =>
    database.migrator
      .selectFrom('lesson_history')
      .selectAll()
      .where('lesson_id', '=', lessonId)
      .orderBy('changed_at')
      .orderBy('id')
      .execute();

  const teacher = async (branch = north) => (await kit.load.teacher(branch)).staffId;

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    years.set(north, await kit.year(north));
    years.set(south, await kit.year(south));
    subject = await kit.load.classes.subject({ grades: [5, 6, 7, 8, 9, 10, 11] });
    account = await kit.load.classes.account();
    // A stand-in for the cells of 6.1: the lessons this table names hold data.
    await sql`create table test_lessons_with_data (lesson_id uuid primary key)`.execute(
      database.migrator,
    );
    await sql`grant select on test_lessons_with_data to sodiq_app`.execute(database.migrator);
    await sql`
      create or replace function lesson_holds_data(lesson_ref uuid) returns boolean
      language sql stable set search_path = pg_catalog, public
      as $$ select exists (select 1 from test_lessons_with_data t where t.lesson_id = lesson_ref) $$
    `.execute(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('rule 1: the class, group and subject never change', () => {
    it.each(['class_id', 'group_id', 'subject_id', 'block_id'] as const)(
      'refuses an update of %s as the application',
      async (column) => {
        const { lesson: id } = await lesson(north);
        const other =
          column === 'block_id'
            ? (await lesson(north)).block
            : column === 'subject_id'
              ? subject
              : await kit.load.classes.schoolClass(north, years.get(north)?.year ?? '', {
                  grade: 7,
                });
        const failed = await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('lessons')
              .set({ [column]: other })
              .where('id', '=', id)
              .execute(),
          ),
        );
        expect(failed.code).toBe(INSUFFICIENT_PRIVILEGE);
      },
    );
  });

  describe('rule 1: a lesson that holds data is never deleted', () => {
    it('reads which lessons hold data from the one function (lessonsHoldingData)', async () => {
      const held = await lesson(north);
      const empty = await lesson(north);
      await database.migrator
        .insertInto('test_lessons_with_data' as never)
        .values({ lesson_id: held.lesson })
        .execute();
      const found = await inBranch(north, (transaction) =>
        lessonsHoldingData(transaction, [held.lesson, empty.lesson]),
      );
      expect([...found]).toEqual([held.lesson]);
      expect(await inBranch(north, (transaction) => lessonsHoldingData(transaction, []))).toEqual(
        new Set(),
      );
    });

    it('refuses the delete of a future lesson holding data, and lets one without data go', async () => {
      const held = await lesson(north);
      const empty = await lesson(north);
      await database.migrator
        .insertInto('test_lessons_with_data' as never)
        .values({ lesson_id: held.lesson })
        .execute();
      const failed = await refusal(
        inBranch(north, async (transaction) => {
          await audited(transaction, north);
          await transaction.deleteFrom('lessons').where('id', '=', held.lesson).execute();
        }),
      );
      expect(failed.constraint).toBe('lesson_holds_data');
      await inBranch(north, async (transaction) => {
        await audited(transaction, north);
        await transaction.deleteFrom('lessons').where('id', '=', empty.lesson).execute();
      });
      expect(await historyOf(empty.lesson)).toMatchObject([{ kind: 'removed' }]);
    });

    it('lets a forced delete of the same transaction remove it, and nothing else', async () => {
      const held = await lesson(north);
      const other = await lesson(north);
      await database.migrator
        .insertInto('test_lessons_with_data' as never)
        .values([{ lesson_id: held.lesson }, { lesson_id: other.lesson }] as never)
        .execute();
      // A store row of another transaction opens nothing.
      await inBranch(north, (transaction) => storeRow(transaction, north, other.lesson));
      const earlier = await refusal(
        inBranch(north, async (transaction) => {
          await audited(transaction, north);
          await transaction.deleteFrom('lessons').where('id', '=', other.lesson).execute();
        }),
      );
      expect(earlier.constraint).toBe('lesson_holds_data');
      // One of this transaction naming another lesson opens nothing either.
      const elsewhere = await refusal(
        inBranch(north, async (transaction) => {
          await storeRow(transaction, north, other.lesson);
          await audited(transaction, north);
          await transaction.deleteFrom('lessons').where('id', '=', held.lesson).execute();
        }),
      );
      expect(elsewhere.constraint).toBe('lesson_holds_data');
      await inBranch(north, async (transaction) => {
        await storeRow(transaction, north, held.lesson);
        await audited(transaction, north);
        await transaction.deleteFrom('lessons').where('id', '=', held.lesson).execute();
      });
      expect(await historyOf(held.lesson)).toMatchObject([{ kind: 'forced_delete' }]);
    });

    it('refuses the delete of a past lesson and its block, except by a forced delete', async () => {
      // Written as of the past day, then deleted on the moment of NOW.
      const early = new Transactions(database.app, new FixedClock('2026-10-09T10:00:00+05:00'));
      const saved = transactions;
      transactions = early;
      const old = await lesson(north, { date: PAST });
      transactions = saved;
      const failed = await refusal(
        inBranch(north, async (transaction) => {
          await audited(transaction, north);
          await transaction.deleteFrom('lessons').where('id', '=', old.lesson).execute();
        }),
      );
      expect(failed.constraint).toBe('lesson_delete_past');
      await inBranch(north, async (transaction) => {
        await storeRow(transaction, north, old.lesson, old.block);
        await audited(transaction, north);
        await transaction.deleteFrom('lessons').where('id', '=', old.lesson).execute();
        await transaction.deleteFrom('lesson_blocks').where('id', '=', old.block).execute();
      });
      expect(
        await database.migrator
          .selectFrom('lesson_blocks')
          .select('id')
          .where('id', '=', old.block)
          .execute(),
      ).toEqual([]);
    });
  });

  describe('rule 4: the history of a lesson', () => {
    it('writes one line per change of teacher, room or cancel, with before, after and the moment', async () => {
      const first = await teacher();
      const second = await teacher();
      const { lesson: id } = await lesson(north, { teacherId: first });
      await inBranch(north, async (transaction) => {
        await audited(transaction, north);
        await transaction
          .updateTable('lessons')
          .set({ teacher_id: second })
          .where('id', '=', id)
          .execute();
      });
      await inBranch(north, async (transaction) => {
        await audited(transaction, north);
        await transaction
          .updateTable('lessons')
          .set({ cancel_cause: 'reason', cancel_reason: 'Excursion to the museum' })
          .where('id', '=', id)
          .execute();
      });
      // The same values again change nothing and write nothing.
      await inBranch(north, async (transaction) => {
        await transaction
          .updateTable('lessons')
          .set({ teacher_id: second })
          .where('id', '=', id)
          .execute();
      });
      const lines = await historyOf(id);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({
        kind: 'changed',
        teacher_before: first,
        teacher_after: second,
        cancel_before: null,
        cancel_after: null,
        branch_id: north,
      });
      expect(lines[0]?.changed_at.toISOString()).toBe(new Date(NOW).toISOString());
      expect(lines[1]).toMatchObject({
        kind: 'changed',
        teacher_before: second,
        teacher_after: second,
        cancel_before: null,
        cancel_after: 'reason',
        cancel_reason_after: 'Excursion to the museum',
      });
    });

    it('writes a line for each lesson of a block moved, through the cascade of the block', async () => {
      const { lesson: id, block } = await lesson(north);
      await inBranch(north, async (transaction) => {
        await audited(transaction, north);
        await transaction
          .updateTable('lesson_blocks')
          .set({ starts_at: at(MONDAY, '10:00'), ends_at: at(MONDAY, '10:45') })
          .where('id', '=', block)
          .execute();
      });
      const lines = await historyOf(id);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.starts_before?.toISOString()).toBe(at(MONDAY, '09:00').toISOString());
      expect(lines[0]?.starts_after?.toISOString()).toBe(at(MONDAY, '10:00').toISOString());
    });

    it('refuses a change with no audit entry of its transaction in the lesson’s branch', async () => {
      const { lesson: id } = await lesson(north);
      const smith = await teacher();
      const none = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('lessons')
            .set({ teacher_id: smith })
            .where('id', '=', id)
            .execute(),
        ),
      );
      expect(none.message).toContain('lesson_change_unaudited');
      const elsewhere = await refusal(
        transactions.run([north, south], async (transaction) => {
          await audited(transaction, south);
          await transaction
            .updateTable('lessons')
            .set({ teacher_id: smith })
            .where('id', '=', id)
            .execute();
        }),
      );
      expect(elsewhere.message).toContain('lesson_change_unaudited');
      // The entry is found whatever filter is in force at the end.
      await transactions.run([north, south], async (transaction) => {
        await audited(transaction, north);
        await transaction
          .updateTable('lessons')
          .set({ teacher_id: smith })
          .where('id', '=', id)
          .execute();
        await sql`select set_config('app.branch_ids', ${`{${south}}`}, true)`.execute(transaction);
      });
      expect(await historyOf(id)).toHaveLength(1);
    });

    it('keeps the history append-only and written by its triggers only', async () => {
      const { lesson: id } = await lesson(north);
      const insert = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .insertInto('lesson_history')
            .values({ branch_id: north, lesson_id: id, kind: 'changed', changed_at: new Date(NOW) })
            .execute(),
        ),
      );
      expect(insert.constraint).toBe('lesson_history_direct');
      const smith = await teacher();
      await inBranch(north, async (transaction) => {
        await audited(transaction, north);
        await transaction
          .updateTable('lessons')
          .set({ teacher_id: smith })
          .where('id', '=', id)
          .execute();
      });
      const update = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('lesson_history')
            .set({ kind: 'removed' })
            .where('lesson_id', '=', id)
            .execute(),
        ),
      );
      expect(update.code).toBe(INSUFFICIENT_PRIVILEGE);
      const remove = await refusal(
        inBranch(north, (transaction) =>
          transaction.deleteFrom('lesson_history').where('lesson_id', '=', id).execute(),
        ),
      );
      expect(remove.code).toBe(INSUFFICIENT_PRIVILEGE);
      // The migrator's write (a migration, a fixture) is no change of the application.
      await database.migrator
        .updateTable('lessons')
        .set({ teacher_id: null })
        .where('id', '=', id)
        .execute();
      expect(await historyOf(id)).toHaveLength(1);
    });
  });

  describe('the rights of a forced delete and a restore', () => {
    it('lets a stored id back only through a restore of this transaction', async () => {
      const { lesson: id, block } = await lesson(north);
      const kept = await database.migrator
        .selectFrom('lessons')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      const store = await inBranch(north, async (transaction) => {
        const row = await storeRow(transaction, north, id);
        await audited(transaction, north);
        await transaction.deleteFrom('lessons').where('id', '=', id).execute();
        return row;
      });
      const { created_at: _created, ...values } = kept;
      void _created;
      const outside = await refusal(
        inBranch(north, async (transaction) => {
          await audited(transaction, north);
          await transaction.insertInto('lessons').values(values).execute();
        }),
      );
      expect(outside.constraint).toBe('forced_delete_id');
      await inBranch(north, async (transaction) => {
        await transaction
          .updateTable('forced_deletes')
          .set({ restored_by: account, restored_at: new Date(0) })
          .where('id', '=', store.id)
          .execute();
        await audited(transaction, north);
        await transaction.insertInto('lessons').values(values).execute();
      });
      expect((await historyOf(id)).map((one) => one.kind)).toEqual(['forced_delete', 'restored']);
      expect(block).toBe(values.block_id);
    });

    it('lets an emptied link come back only to a lesson restored in this transaction', async () => {
      const { lesson: id } = await lesson(north);
      const change = await database.migrator
        .insertInto('lesson_day_changes')
        .values({
          branch_id: north,
          lesson_id: null,
          kind: 'room',
          class_id: await kit.load.classes.schoolClass(north, years.get(north)?.year ?? '', {
            grade: 7,
          }),
          subject_id: subject,
          from_date: MONDAY,
          from_starts_at: at(MONDAY, '09:00'),
          from_ends_at: at(MONDAY, '09:45'),
          to_date: MONDAY,
          to_starts_at: at(MONDAY, '09:00'),
          to_ends_at: at(MONDAY, '09:45'),
          reason: 'Room repainted',
          changed_at: new Date(NOW),
          changed_by: account,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const failed = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .updateTable('lesson_day_changes')
            .set({ lesson_id: id })
            .where('id', '=', change.id)
            .execute(),
        ),
      );
      expect(failed.constraint).toBe('forced_restore_link');
    });

    it('refuses the delete of a record that a vacancy lesson was taught outside a forced delete', async () => {
      const { lesson: id } = await lesson(north);
      await database.migrator
        .insertInto('lesson_absence_taught')
        .values({
          branch_id: north,
          lesson_id: id,
          recorded_by: account,
          recorded_at: new Date(NOW),
        })
        .execute();
      const failed = await refusal(
        inBranch(north, (transaction) =>
          transaction.deleteFrom('lesson_absence_taught').where('lesson_id', '=', id).execute(),
        ),
      );
      expect(failed.constraint).toBe('lesson_absence_taught_delete');
    });
  });

  describe('the store of forced deletes', () => {
    it('keeps 30 days from the moment of the transaction, whatever is sent', async () => {
      const { lesson: id } = await lesson(north);
      const row = await inBranch(north, (transaction) => storeRow(transaction, north, id));
      expect(row.deleted_at.toISOString()).toBe(new Date(NOW).toISOString());
      expect(row.restore_until.toISOString()).toBe(
        new Date(new Date(NOW).getTime() + 30 * 86_400_000).toISOString(),
      );
    });

    it('restores once, only before its end, and is never deleted', async () => {
      const { lesson: id } = await lesson(north);
      const row = await inBranch(north, (transaction) => storeRow(transaction, north, id));
      const restore = (clock: Transactions) =>
        clock.run([north], (transaction) =>
          transaction
            .updateTable('forced_deletes')
            .set({ restored_by: account, restored_at: new Date(0) })
            .where('id', '=', row.id)
            .execute(),
        );
      const late = new Transactions(database.app, new FixedClock('2026-11-14T10:00:00+05:00'));
      expect((await refusal(restore(late))).constraint).toBe('forced_delete_expired');
      await restore(transactions);
      expect((await refusal(restore(transactions))).constraint).toBe('forced_delete_restored');
      const removed = await refusal(
        inBranch(north, (transaction) =>
          transaction.deleteFrom('forced_deletes').where('id', '=', row.id).execute(),
        ),
      );
      expect(removed.code).toBe(INSUFFICIENT_PRIVILEGE);
      const stored = await database.migrator
        .selectFrom('forced_deletes')
        .select(['restored_at'])
        .where('id', '=', row.id)
        .executeTakeFirstOrThrow();
      expect(stored.restored_at?.toISOString()).toBe(new Date(NOW).toISOString());
    });

    it('refuses a reason of spaces only', async () => {
      const { lesson: id } = await lesson(north);
      const failed = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .insertInto('forced_deletes')
            .values({
              branch_id: north,
              record_type: 'lesson',
              record_id: id,
              rows: '{}',
              reason: '   ',
              deleted_by: account,
              deleted_at: new Date(NOW),
              restore_until: new Date(NOW),
            })
            .execute(),
        ),
      );
      expect(failed.code).toBe(CHECK_VIOLATION);
    });
  });
});
