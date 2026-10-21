import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const LOCK_NOT_AVAILABLE = '55P03';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
/** 40 days earlier: a forced delete made then can no longer be restored. */
const LONG_AGO = '2026-09-05T10:00:00+05:00';
/** Monday 19 October 2026, a school day after today. */
const MONDAY = '2026-10-19';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

type Kind = 'building' | 'floor' | 'room';

const TABLES = { building: 'buildings', floor: 'floors', room: 'rooms' } as const;

// The forced delete of a building, floor or room in the database
// (db/migrations/0106; task 5.8c, pull request #196). 03, Building, floor,
// room: "The Super Admin's forced delete (06) also removes a building, floor
// or room that no lesson, timetable entry or other record references, with a
// reason, an audit entry and 30 days to restore; a referenced one stays
// archive-only." Every write below is made as `sodiq_app` through the branch
// filter, with no service in between. All names are invented.
describe('the forced delete of a building, floor or room in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let earlier: Transactions;
  let kit: LessonsKit;
  let north: string;
  let account: string;
  let year: { year: string; quarters: string[] };
  let subject: string;
  let count = 0;

  const inNorth = <T>(work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([north], work);

  /** A building with a floor and a room, written by the migrator. */
  async function place(): Promise<{ building: string; floor: string; room: string }> {
    count += 1;
    const building = await database.migrator
      .insertInto('buildings')
      .values({ branch_id: north, name: `Block ${String(count)}` })
      .returning('id')
      .executeTakeFirstOrThrow();
    const floor = await database.migrator
      .insertInto('floors')
      .values({ branch_id: north, building_id: building.id, name: 'Ground' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const room = await database.migrator
      .insertInto('rooms')
      .values({
        branch_id: north,
        floor_id: floor.id,
        name: `Studio ${String(count)}`,
        type: 'classroom',
        capacity: 24,
        status: 'in_use',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { building: building.id, floor: floor.id, room: room.id };
  }

  /** A store row of the kind naming the record, in the transaction. */
  const stored = (transaction: Transaction, kind: Kind | 'lesson', id: string, rows: object = {}) =>
    transaction
      .insertInto('forced_deletes')
      .values({
        branch_id: north,
        record_type: kind,
        record_id: id,
        rows: JSON.stringify(rows),
        reason: 'Added by mistake',
        deleted_by: account,
        deleted_at: new Date(NOW),
        restore_until: new Date(NOW),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

  /** The forced delete of one record as the application makes it: the store row, then the delete. */
  const forceDelete = (kind: Kind, id: string, rows: object = {}) =>
    inNorth(async (transaction) => {
      await stored(transaction, kind, id, rows);
      await transaction.deleteFrom(TABLES[kind]).where('id', '=', id).execute();
    });

  const exists = async (kind: Kind, id: string) =>
    (await database.migrator
      .selectFrom(TABLES[kind])
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst()) !== undefined;

  /** A lesson of its own block in the room, as the application writes one. */
  async function lessonIn(room: string): Promise<string> {
    const classId = await kit.load.classes.schoolClass(north, year.year, { grade: 7 });
    const source = await kit.source(north, year.year, [
      { classId, groupId: null, subjectId: subject },
    ]);
    return inNorth(async (transaction) => {
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: north,
          academic_year_id: year.year,
          quarter_id: year.quarters[0] ?? '',
          lesson_date: MONDAY,
          starts_at: at(MONDAY, '09:00'),
          ends_at: at(MONDAY, '09:45'),
          version_id: source.versionId,
          pattern_block_id: source.patternBlockId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const row = await transaction
        .insertInto('lessons')
        .values({
          branch_id: north,
          block_id: block.id,
          lesson_date: MONDAY,
          starts_at: at(MONDAY, '09:00'),
          ends_at: at(MONDAY, '09:45'),
          class_id: classId,
          subject_id: subject,
          load_row_id: source.lessons[0]?.loadRowId ?? '',
          pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
          room_id: room,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    earlier = new Transactions(database.app, new FixedClock(LONG_AGO));
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    year = await kit.year(north);
    subject = await kit.load.classes.subject({ grades: [5, 6, 7, 8, 9, 10, 11] });
    account = await kit.load.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('the store takes the three kinds', () => {
    it.each(['building', 'floor', 'room'] as const)('keeps a %s', async (kind) => {
      const ids = await place();
      await inNorth((transaction) => stored(transaction, kind, ids[kind]));
    });

    it('refuses a kind it does not know', async () => {
      const failed = await refusal(
        inNorth((transaction) => stored(transaction, 'teacher' as Kind, account)),
      );
      expect(failed.constraint).toBe('forced_deletes_record_type_check');
    });
  });

  describe('a place is deleted only by a forced delete of the same transaction', () => {
    it.each(['building', 'floor', 'room'] as const)(
      'refuses the delete of a %s with no store row',
      async (kind) => {
        const ids = await place();
        const failed = await refusal(
          inNorth((transaction) =>
            transaction.deleteFrom(TABLES[kind]).where('id', '=', ids[kind]).execute(),
          ),
        );
        expect(failed).toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'place_delete_unforced',
        });
        expect(await exists(kind, ids[kind])).toBe(true);
      },
    );

    it('refuses the delete for a store row of an earlier transaction', async () => {
      const ids = await place();
      await inNorth((transaction) => stored(transaction, 'room', ids.room));
      const failed = await refusal(
        inNorth((transaction) =>
          transaction.deleteFrom('rooms').where('id', '=', ids.room).execute(),
        ),
      );
      expect(failed.constraint).toBe('place_delete_unforced');
    });

    it('refuses the delete of a room for a store row of another kind', async () => {
      const ids = await place();
      const failed = await refusal(
        inNorth(async (transaction) => {
          await stored(transaction, 'floor', ids.room);
          await transaction.deleteFrom('rooms').where('id', '=', ids.room).execute();
        }),
      );
      expect(failed.constraint).toBe('place_delete_unforced');
    });

    it('lets a room that nothing references go, then its floor, then its building', async () => {
      const ids = await place();
      await forceDelete('room', ids.room);
      await forceDelete('floor', ids.floor);
      expect(await exists('room', ids.room)).toBe(false);
      expect(await exists('floor', ids.floor)).toBe(false);
    });

    it('lets the floors of a building go with it, named by the building row (correction 1)', async () => {
      const ids = await place();
      await forceDelete('room', ids.room);
      // The floor's store row of the room's delete names the floor; a
      // building's own forced delete leaves its rows of this transaction out.
      await database.migrator
        .updateTable('forced_deletes')
        .set({ restore_until: new Date('2020-01-01T00:00:00Z') })
        .where('record_id', '=', ids.room)
        .execute();
      await inNorth(async (transaction) => {
        await stored(transaction, 'building', ids.building, { floors: [{ id: ids.floor }] });
        await transaction.deleteFrom('floors').where('building_id', '=', ids.building).execute();
        await transaction.deleteFrom('buildings').where('id', '=', ids.building).execute();
      });
      expect(await exists('floor', ids.floor)).toBe(false);
      expect(await exists('building', ids.building)).toBe(false);
    });

    it('refuses a floor its building row does not name', async () => {
      const ids = await place();
      const other = await place();
      await forceDelete('room', other.room);
      const failed = await refusal(
        inNorth(async (transaction) => {
          await stored(transaction, 'building', ids.building, { floors: [{ id: ids.floor }] });
          await transaction.deleteFrom('floors').where('id', '=', other.floor).execute();
        }),
      );
      expect(failed.constraint).toBe('place_delete_unforced');
    });
  });

  describe('a referenced place is refused (decision 2)', () => {
    it('refuses a floor with a room on it, and a building with a room on a floor', async () => {
      const ids = await place();
      expect((await refusal(forceDelete('floor', ids.floor))).constraint).toBe('place_referenced');
      const failed = await refusal(
        inNorth(async (transaction) => {
          await stored(transaction, 'building', ids.building, { floors: [{ id: ids.floor }] });
          await transaction.deleteFrom('floors').where('building_id', '=', ids.building).execute();
          await transaction.deleteFrom('buildings').where('id', '=', ids.building).execute();
        }),
      );
      expect(failed.constraint).toBe('place_referenced');
      expect(await exists('floor', ids.floor)).toBe(true);
    });

    it('refuses a room a lesson is in by its key', async () => {
      const ids = await place();
      await lessonIn(ids.room);
      const failed = await refusal(forceDelete('room', ids.room));
      expect(failed.code).toBe(FOREIGN_KEY_VIOLATION);
      expect(await exists('room', ids.room)).toBe(true);
    });

    it.each(['room_before', 'room_after'] as const)(
      'refuses a room the lesson history names in %s',
      async (column) => {
        const ids = await place();
        // A history line of its own, as a fixture: the guard of 0105 lets only
        // the trigger write one, so the test turns the guard off around it.
        await database.migrator.transaction().execute(async (transaction) => {
          await sql`alter table lesson_history disable trigger lesson_history_direct`.execute(
            transaction,
          );
          await transaction
            .insertInto('lesson_history')
            .values({
              branch_id: north,
              lesson_id: account,
              kind: 'changed',
              changed_at: new Date(NOW),
              [column]: ids.room,
            })
            .execute();
          await sql`alter table lesson_history enable trigger lesson_history_direct`.execute(
            transaction,
          );
        });
        expect((await refusal(forceDelete('room', ids.room))).constraint).toBe('place_referenced');
      },
    );

    it.each(['left_rows', 'left_blocks'] as const)(
      "refuses a room a draft's %s name",
      async (column) => {
        const ids = await place();
        await database.migrator
          .insertInto('timetable_versions')
          .values({
            branch_id: north,
            academic_year_id: year.year,
            number: 900 + count,
            starts_on: MONDAY,
            [column]: JSON.stringify([{ lessons: [{ roomId: ids.room }] }]),
          })
          .execute();
        expect((await refusal(forceDelete('room', ids.room))).constraint).toBe('place_referenced');
      },
    );

    it("refuses a room named as the room of a lesson's store row while it can be restored", async () => {
      const ids = await place();
      await inNorth((transaction) =>
        stored(transaction, 'lesson', account, { lesson: { id: account, room_id: ids.room } }),
      );
      expect((await refusal(forceDelete('room', ids.room))).constraint).toBe('place_referenced');
    });

    it('lets the room go once that store row is restored', async () => {
      const ids = await place();
      const row = await inNorth((transaction) =>
        stored(transaction, 'lesson', account, { lesson: { id: account, room_id: ids.room } }),
      );
      await inNorth((transaction) =>
        transaction
          .updateTable('forced_deletes')
          .set({ restored_by: account, restored_at: new Date(0) })
          .where('id', '=', row.id)
          .execute(),
      );
      await forceDelete('room', ids.room);
      expect(await exists('room', ids.room)).toBe(false);
    });

    it('lets the room go once that store row can no longer be restored', async () => {
      const ids = await place();
      await earlier.run([north], (transaction) =>
        stored(transaction, 'lesson', account, { lesson: { id: account, room_id: ids.room } }),
      );
      await forceDelete('room', ids.room);
      expect(await exists('room', ids.room)).toBe(false);
    });

    it('refuses the floor and the building of a room deleted for good in its 30 days', async () => {
      const ids = await place();
      await forceDelete('room', ids.room, { room: { id: ids.room, floor_id: ids.floor } });
      expect((await refusal(forceDelete('floor', ids.floor))).constraint).toBe('place_referenced');
    });
  });

  describe('the same ids come back only by a restore', () => {
    it.each(['building', 'floor', 'room'] as const)(
      'refuses an insert of a stored %s id outside a restore',
      async (kind) => {
        const ids = await place();
        await forceDelete('room', ids.room);
        if (kind !== 'room') await forceDelete('floor', ids.floor);
        if (kind === 'building') await forceDelete('building', ids.building);
        const failed = await refusal(
          inNorth((transaction) =>
            kind === 'building'
              ? transaction
                  .insertInto('buildings')
                  .values({ id: ids.building, branch_id: north, name: 'Back' })
                  .execute()
              : kind === 'floor'
                ? transaction
                    .insertInto('floors')
                    .values({
                      id: ids.floor,
                      branch_id: north,
                      building_id: ids.building,
                      name: 'Back',
                    })
                    .execute()
                : transaction
                    .insertInto('rooms')
                    .values({
                      id: ids.room,
                      branch_id: north,
                      floor_id: ids.floor,
                      name: 'Back',
                      type: 'classroom',
                      capacity: 10,
                      status: 'in_use',
                    })
                    .execute(),
          ),
        );
        expect(failed.constraint).toBe('forced_delete_id');
      },
    );

    it("lets a building's floors back with the building's restore, and refuses them without it", async () => {
      const ids = await place();
      await forceDelete('room', ids.room);
      await database.migrator
        .updateTable('forced_deletes')
        .set({ restore_until: new Date('2020-01-01T00:00:00Z') })
        .where('record_id', '=', ids.room)
        .execute();
      const row = await inNorth(async (transaction) => {
        const one = await stored(transaction, 'building', ids.building, {
          floors: [{ id: ids.floor }],
        });
        await transaction.deleteFrom('floors').where('building_id', '=', ids.building).execute();
        await transaction.deleteFrom('buildings').where('id', '=', ids.building).execute();
        return one;
      });
      const floor = { id: ids.floor, branch_id: north, building_id: ids.building, name: 'Ground' };
      const outside = await refusal(
        inNorth(async (transaction) => {
          await transaction
            .insertInto('buildings')
            .values({ id: ids.building, branch_id: north, name: 'Back' })
            .execute();
        }),
      );
      expect(outside.constraint).toBe('forced_delete_id');
      await inNorth(async (transaction) => {
        await transaction
          .updateTable('forced_deletes')
          .set({ restored_by: account, restored_at: new Date(0) })
          .where('id', '=', row.id)
          .execute();
        await transaction
          .insertInto('buildings')
          .values({ id: ids.building, branch_id: north, name: 'Back' })
          .execute();
        await transaction.insertInto('floors').values(floor).execute();
      });
      expect(await exists('floor', ids.floor)).toBe(true);
    });
  });

  describe('a lesson that leaves its room holds the room until its commit (database point 4)', () => {
    it.each(['a change of room', 'a delete'] as const)(
      'holds the room it leaves by %s',
      async (how) => {
        const ids = await place();
        const other = await place();
        const lesson = await lessonIn(ids.room);
        const failed = await inNorth(async (transaction) => {
          // The audit entry of the change, as `Audit.record` writes it (0105's commit check).
          await transaction
            .insertInto('audit_log')
            .values({ occurred_at: new Date(NOW), branch_id: north, action: 'test.lesson_change' })
            .execute();
          if (how === 'a delete') {
            await transaction.deleteFrom('lessons').where('id', '=', lesson).execute();
          } else {
            await transaction
              .updateTable('lessons')
              .set({ room_id: other.room })
              .where('id', '=', lesson)
              .execute();
          }
          return refusal(
            sql`select id from rooms where id = ${ids.room} for update nowait`.execute(
              database.migrator,
            ),
          );
        });
        expect(failed.code).toBe(LOCK_NOT_AVAILABLE);
      },
    );
  });

  describe('the catalog', () => {
    /**
     * The uuid columns that name a building, floor or room without a key, each
     * read by `place_referenced` (0106); `exam_room_id` has a key to `exam_rooms`.
     * A jsonb column cannot be found by its name: the ones read are
     * `timetable_versions.left_rows`, `timetable_versions.left_blocks` and
     * `forced_deletes.rows`.
     */
    const READ_WITHOUT_KEY = ['lesson_history.room_before', 'lesson_history.room_after'];

    it('has a key to its table, or a reader in place_referenced, for every uuid column naming a place', async () => {
      const columns = await sql<{ name: string; target: string | null }>`
        select c.table_name || '.' || c.column_name as name,
          (
            select ref.relname::text
            from pg_constraint k
            join pg_class src on src.oid = k.conrelid
            join pg_class ref on ref.oid = k.confrelid
            join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
            where k.contype = 'f' and src.relname = c.table_name and a.attname = c.column_name
              and ref.relname in ('rooms', 'floors', 'buildings', 'exam_rooms')
            limit 1
          ) as target
        from information_schema.columns c
        join pg_class t on t.relname = c.table_name and t.relkind in ('r', 'p')
        join pg_namespace n on n.oid = t.relnamespace and n.nspname = c.table_schema
        where c.table_schema = 'public' and c.data_type = 'uuid'
          and (c.column_name like '%room%' or c.column_name like '%floor%' or c.column_name like '%building%')
          and not t.relispartition
        order by 1
      `.execute(database.migrator);
      const unread = columns.rows
        .filter((one) => one.target === null)
        .map((one) => one.name)
        .filter((name) => !READ_WITHOUT_KEY.includes(name));
      expect(unread).toEqual([]);
      // Each column a key holds points at the place it names.
      const keyed = columns.rows.filter((one) => one.target !== null);
      expect(keyed.length).toBeGreaterThan(0);
    });
  });
});
