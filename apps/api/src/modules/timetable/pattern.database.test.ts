import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const EXCLUSION_VIOLATION = '23P01';
const FOREIGN_KEY_VIOLATION = '23503';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

/** A transaction held open after `work`, released by the test. */
function holding(
  run: (work: (transaction: Transaction) => Promise<void>) => Promise<void>,
  work: (transaction: Transaction) => Promise<void>,
): { ready: Promise<void>; release: () => void; done: Promise<void> } {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready: () => void = () => undefined;
  const isReady = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const done = run(async (transaction) => {
    await work(transaction);
    ready();
    await released;
  });
  return { ready: Promise.race([isReady, done]), release, done };
}

/** A pattern slot as a test writes it: a weekday and clock minutes. */
interface Slot {
  weekday?: number;
  start: number;
  end: number;
  pairId?: string | null;
}

/** An entry of a block: its load row (with the row's teacher) and a room. */
interface EntryInput {
  row: { id: string; teacher: string };
  roomId?: string | null;
}

// The pattern rules that the database itself keeps per version
// (db/migrations/0058; task 5.1a, pull request #107): edge/developer-rules,
// Pattern entries, "The same teacher, room and class rules per version", by
// clock minutes per weekday (decision 7), with a shared room limited to its
// number of lessons at once (decision 2; the pattern has no date, decision
// 8). Every write is made as `sodiq_app` through the branch filter. All names
// are invented.
describe('the pattern of a timetable version in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LessonsKit;
  let north: string;
  let south: string;
  let year: string;
  let southYear: string;
  let subject: string;
  let version: string;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** A block and its entries, written in the transaction given. */
  async function write(
    transaction: Transaction,
    versionId: string,
    slot: Slot,
    entries: readonly EntryInput[],
    branch = north,
  ): Promise<{ block: string; entries: string[] }> {
    const weekday = slot.weekday ?? 1;
    const block = await transaction
      .insertInto('pattern_blocks')
      .values({
        branch_id: branch,
        version_id: versionId,
        weekday,
        slot_position: 1,
        start_minutes: slot.start,
        end_minutes: slot.end,
        double_pair_id: slot.pairId ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const ids: string[] = [];
    for (const entry of entries) {
      const row = await transaction
        .insertInto('pattern_entries')
        .values({
          branch_id: branch,
          version_id: versionId,
          block_id: block.id,
          weekday,
          start_minutes: slot.start,
          end_minutes: slot.end,
          load_row_id: entry.row.id,
          teacher_id: entry.row.teacher,
          room_id: entry.roomId ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      ids.push(row.id);
    }
    return { block: block.id, entries: ids };
  }

  /** A block and its entries, written as the application writes them. */
  const place = (slot: Slot, entries: readonly EntryInput[], versionId = version, branch = north) =>
    inBranch(branch, (transaction) => write(transaction, versionId, slot, entries, branch));

  /** How many connections to the test database wait for a lock right now. */
  async function untilWaiting(count: number): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const found = await sql<{ waiting: number }>`
        select count(distinct l.pid)::int as waiting
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and not l.granted
      `.execute(database.migrator);
      if ((found.rows[0]?.waiting ?? 0) >= count) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Nothing waited for a lock.');
  }

  const schoolClass = (grade = 7) => kit.load.classes.schoolClass(north, year, { grade });

  /** A teacher of the north who may take every row of the subjects named. */
  const teacher = async (subjects: readonly string[] = [subject]) =>
    (
      await kit.load.teacher(north, {
        subjects: subjects.map((one) => ({ subject: one, grades: [7, 9, 10] })),
      })
    ).staffId;

  /** A load row of the version for a class (or a group), with a teacher of its own unless given. */
  async function row(
    unit: { classId?: string; groupId?: string; subjectId?: string },
    input: { teacher?: string; versionId?: string } = {},
  ): Promise<{ id: string; teacher: string }> {
    const subjectId = unit.subjectId ?? subject;
    const teacherId = input.teacher ?? (await teacher([subjectId]));
    const id = await kit.load.row({
      branch_id: north,
      version_id: input.versionId ?? version,
      class_id: unit.classId ?? null,
      group_id: unit.groupId ?? null,
      subject_id: subjectId,
      teacher_id: teacherId,
    });
    return { id, teacher: teacherId };
  }

  const classesOf = (block: string) =>
    database.migrator
      .selectFrom('pattern_block_classes')
      .select(['class_id', 'weekday', 'start_minutes'])
      .where('block_id', '=', block)
      .orderBy('class_id')
      .execute();

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    year = (await kit.year(north)).year;
    southYear = (await kit.year(south)).year;
    subject = await kit.load.classes.subject({ grades: [7, 9, 10] });
  });

  beforeEach(async () => {
    version = await kit.load.version(north, year);
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('a teacher, a room and a class in one place per version and weekday', () => {
    it('refuses one teacher in two entries at once, and passes another weekday and another version', async () => {
      const smith = await teacher();
      const oxford = await row({ classId: await schoolClass() }, { teacher: smith });
      const princeton = await row({ classId: await schoolClass() }, { teacher: smith });
      await place({ start: 540, end: 585 }, [{ row: oxford }]);
      expect(await refusal(place({ start: 560, end: 605 }, [{ row: princeton }]))).toMatchObject({
        code: EXCLUSION_VIOLATION,
        constraint: 'pattern_entries_teacher_excl',
      });
      // Half-open minutes, another weekday.
      await place({ start: 585, end: 630 }, [{ row: princeton }]);
      await place({ weekday: 2, start: 540, end: 585 }, [{ row: princeton }]);
      // Another version of the branch: its own week.
      const other = await kit.load.version(north, year);
      const again = await row(
        { classId: await schoolClass() },
        { teacher: smith, versionId: other },
      );
      await place({ start: 540, end: 585 }, [{ row: again }], other);
    });

    it('refuses a room that is not shared in two entries at once, and a room change into it', async () => {
      const room = await kit.room(north);
      await place({ start: 600, end: 645 }, [
        { row: await row({ classId: await schoolClass() }), roomId: room },
      ]);
      expect(
        await refusal(
          place({ start: 600, end: 645 }, [
            { row: await row({ classId: await schoolClass() }), roomId: room },
          ]),
        ),
      ).toMatchObject({ code: EXCLUSION_VIOLATION, constraint: 'pattern_entries_room_excl' });
      const other = await place({ start: 620, end: 665 }, [
        { row: await row({ classId: await schoolClass() }) },
      ]);
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('pattern_entries')
              .set({ room_id: room })
              .where('id', '=', other.entries[0] ?? '')
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'pattern_entries_room_excl' });
    });

    it('refuses a class row and a group row of that class in two blocks at once, and passes a split in one block', async () => {
      const oxford = await schoolClass();
      const english = await kit.load.classes.subject({ grades: [7, 9, 10] });
      const first = await kit.load.classes.group(north, year, english, [oxford]);
      const second = await kit.load.classes.group(north, year, english, [oxford]);
      const split = await place({ start: 700, end: 745 }, [
        { row: await row({ groupId: first, subjectId: english }) },
        { row: await row({ groupId: second, subjectId: english }) },
      ]);
      expect(await classesOf(split.block)).toEqual([
        { class_id: oxford, weekday: 1, start_minutes: 700 },
      ]);
      expect(
        await refusal(place({ start: 720, end: 765 }, [{ row: await row({ classId: oxford }) }])),
      ).toMatchObject({ code: EXCLUSION_VIOLATION, constraint: 'pattern_block_classes_excl' });
    });

    it('lets a group of two grades occupy both classes', async () => {
      const edinburgh = await schoolClass(9);
      const brown = await schoolClass(10);
      const sport = await kit.load.classes.subject({ grades: [7, 9, 10] });
      const both = await kit.load.classes.group(north, year, sport, [edinburgh, brown]);
      await place({ start: 800, end: 845 }, [
        { row: await row({ groupId: both, subjectId: sport }) },
      ]);
      expect(
        await refusal(place({ start: 800, end: 845 }, [{ row: await row({ classId: brown }) }])),
      ).toMatchObject({ constraint: 'pattern_block_classes_excl' });
    });
  });

  describe('a shared room (pattern_room_shared_full)', () => {
    it('takes a shared room up to its number of lessons at once, counted at the new start too', async () => {
      const hall = await kit.room(north, { most: 2 });
      const entry = async () => ({
        row: await row({ classId: await schoolClass() }),
        roomId: hall,
      });
      await place({ start: 540, end: 585 }, [await entry()]);
      await place({ start: 540, end: 585 }, [await entry()]);
      expect(await refusal(place({ start: 540, end: 585 }, [await entry()]))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'pattern_room_shared_full',
      });
      // Correction 3: from 09:10 to 09:55 the third meets both at 09:10.
      expect(await refusal(place({ start: 550, end: 595 }, [await entry()]))).toMatchObject({
        constraint: 'pattern_room_shared_full',
      });
      await place({ start: 585, end: 630 }, [await entry()]);
    });

    it('checks two entries added at the same moment one after the other', async () => {
      const hall = await kit.room(north, { most: 2 });
      const entry = async () => ({
        row: await row({ classId: await schoolClass() }),
        roomId: hall,
      });
      await place({ start: 900, end: 945 }, [await entry()]);
      const first = await entry();
      const second = await entry();
      const held = holding(
        (work) => inBranch(north, work),
        async (transaction) => {
          await write(transaction, version, { start: 900, end: 945 }, [first]);
          await sql`set constraints pattern_entries_shared_room immediate`.execute(transaction);
        },
      );
      await held.ready;
      const late = place({ start: 900, end: 945 }, [second]).then(
        () => 'written',
        (error: unknown) => (error as { constraint?: string }).constraint,
      );
      await untilWaiting(1);
      held.release();
      await held.done;
      expect(await late).toBe('pattern_room_shared_full');
    });
  });

  describe('the version and the year (pattern_version_draft, pattern_year_closed)', () => {
    it('refuses an entry of a published version at the commit', async () => {
      const oxford = await row({ classId: await schoolClass() });
      await kit.load.setVersion(version, 'published');
      expect(await refusal(place({ start: 540, end: 585 }, [{ row: oxford }]))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'pattern_version_draft',
      });
    });

    it('refuses an entry in a closed year', async () => {
      const east = await insertBranch(database.migrator, 'East');
      const eastYear = await kit.load.classes.year(east);
      const eastVersion = await kit.load.version(east, eastYear);
      const eastSubject = await kit.load.classes.subject({ grades: [7] });
      const smith = (
        await kit.load.teacher(east, { subjects: [{ subject: eastSubject, grades: [7] }] })
      ).staffId;
      const eastRow = await kit.load.row({
        branch_id: east,
        version_id: eastVersion,
        class_id: await kit.load.classes.schoolClass(east, eastYear, { grade: 7 }),
        subject_id: eastSubject,
        teacher_id: smith,
      });
      await kit.load.classes.setYear(eastYear, 'closed');
      expect(
        await refusal(
          place(
            { start: 540, end: 585 },
            [{ row: { id: eastRow, teacher: smith } }],
            eastVersion,
            east,
          ),
        ),
      ).toMatchObject({ constraint: 'pattern_year_closed' });
    });
  });

  describe('two branches (decision 18)', () => {
    it('passes one teacher at the same time in the patterns of two branches, each written with its own branch only', async () => {
      // 06, Two drafts at once: "The first to publish stands": the dated
      // claims refuse the second publish, not the pattern.
      const southVersion = await kit.load.version(south, southYear);
      const smith = (
        await kit.load.teacher(north, {
          subjects: [{ subject, grades: [7, 9, 10] }],
          further: [south],
        })
      ).staffId;
      await place({ start: 540, end: 585 }, [
        { row: await row({ classId: await schoolClass() }, { teacher: smith }) },
      ]);
      const southRow = await kit.load.row({
        branch_id: south,
        version_id: southVersion,
        class_id: await kit.load.classes.schoolClass(south, southYear, { grade: 7 }),
        subject_id: subject,
        teacher_id: smith,
      });
      await place(
        { start: 540, end: 585 },
        [{ row: { id: southRow, teacher: smith } }],
        southVersion,
        south,
      );
    });
  });

  describe('the keys of an entry', () => {
    it('refuses a load row of another version', async () => {
      const other = await kit.load.version(north, year);
      const foreign = await row({ classId: await schoolClass() }, { versionId: other });
      expect(await refusal(place({ start: 540, end: 585 }, [{ row: foreign }]))).toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
        constraint: 'pattern_entries_load_row_fkey',
      });
    });

    it('refuses a teacher other than the load row’s', async () => {
      const oxford = await row({ classId: await schoolClass() });
      expect(
        await refusal(
          place({ start: 540, end: 585 }, [{ row: { id: oxford.id, teacher: await teacher() } }]),
        ),
      ).toMatchObject({ code: FOREIGN_KEY_VIOLATION, constraint: 'pattern_entries_load_row_fkey' });
    });

    it('refuses a block of a version of another branch', async () => {
      const southVersion = await kit.load.version(south, southYear);
      expect(await refusal(place({ start: 540, end: 585 }, [], southVersion, north))).toMatchObject(
        { code: FOREIGN_KEY_VIOLATION, constraint: 'pattern_blocks_version_fkey' },
      );
    });
  });

  describe('changes that cascade', () => {
    it('moves the entries and the classes of a block moved to another weekday', async () => {
      const oxford = await schoolClass();
      const placed = await place({ start: 540, end: 585 }, [
        { row: await row({ classId: oxford }) },
      ]);
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('pattern_blocks')
          .set({ weekday: 3, start_minutes: 600, end_minutes: 645 })
          .where('id', '=', placed.block)
          .execute(),
      );
      const entry = await database.migrator
        .selectFrom('pattern_entries')
        .select(['weekday', 'start_minutes', 'end_minutes'])
        .where('id', '=', placed.entries[0] ?? '')
        .executeTakeFirstOrThrow();
      expect(entry).toEqual({ weekday: 3, start_minutes: 600, end_minutes: 645 });
      expect(await classesOf(placed.block)).toEqual([
        { class_id: oxford, weekday: 3, start_minutes: 600 },
      ]);
    });

    it('carries a teacher changed on the load row into its entries, and refuses one who is busy then', async () => {
      const smith = await teacher();
      const jones = await teacher();
      const oxford = await row({ classId: await schoolClass() }, { teacher: smith });
      const placed = await place({ start: 1000, end: 1045 }, [{ row: oxford }]);
      await place({ start: 1000, end: 1045 }, [
        { row: await row({ classId: await schoolClass() }, { teacher: jones }) },
      ]);
      const changeTo = (teacherId: string) =>
        inBranch(north, (transaction) =>
          transaction
            .updateTable('teaching_load_rows')
            .set({ teacher_id: teacherId })
            .where('id', '=', oxford.id)
            .execute(),
        );
      expect(await refusal(changeTo(jones))).toMatchObject({
        constraint: 'pattern_entries_teacher_excl',
      });
      const brown = await teacher();
      await changeTo(brown);
      const entry = await database.migrator
        .selectFrom('pattern_entries')
        .select('teacher_id')
        .where('id', '=', placed.entries[0] ?? '')
        .executeTakeFirstOrThrow();
      expect(entry.teacher_id).toBe(brown);
    });

    it('deletes the entries and the classes of a deleted draft load row', async () => {
      const oxford = await row({ classId: await schoolClass() });
      const placed = await place({ start: 1100, end: 1145 }, [{ row: oxford }]);
      await inBranch(north, (transaction) =>
        transaction.deleteFrom('teaching_load_rows').where('id', '=', oxford.id).execute(),
      );
      expect(
        await database.migrator
          .selectFrom('pattern_entries')
          .select('id')
          .where('block_id', '=', placed.block)
          .execute(),
      ).toEqual([]);
      expect(await classesOf(placed.block)).toEqual([]);
    });
  });

  // Task 5.4a: the grid moves a block by an update of pattern_blocks whose
  // time cascades to its entries and classes; every guard of 0058 holds on
  // that path too, and a swap defers the clash constraints to the commit.
  describe('a block moved by the grid (task 5.4a)', () => {
    const moveBlock = (block: string, slot: Slot) =>
      inBranch(north, (transaction) =>
        transaction
          .updateTable('pattern_blocks')
          .set({ weekday: slot.weekday ?? 1, start_minutes: slot.start, end_minutes: slot.end })
          .where('id', '=', block)
          .execute(),
      );

    it('refuses a move that puts the teacher in two lessons at once', async () => {
      const busy = await teacher();
      await place({ weekday: 2, start: 480, end: 525 }, [
        { row: await row({ classId: await schoolClass() }, { teacher: busy }) },
      ]);
      const moved = await place({ weekday: 2, start: 540, end: 585 }, [
        { row: await row({ classId: await schoolClass() }, { teacher: busy }) },
      ]);
      expect(
        await refusal(moveBlock(moved.block, { weekday: 2, start: 500, end: 545 })),
      ).toMatchObject({ code: EXCLUSION_VIOLATION, constraint: 'pattern_entries_teacher_excl' });
    });

    it('refuses a move into a room that is not shared and already in use', async () => {
      const room = await kit.room(north);
      await place({ weekday: 2, start: 600, end: 645 }, [
        { row: await row({ classId: await schoolClass() }), roomId: room },
      ]);
      const moved = await place({ weekday: 2, start: 660, end: 705 }, [
        { row: await row({ classId: await schoolClass() }), roomId: room },
      ]);
      expect(
        await refusal(moveBlock(moved.block, { weekday: 2, start: 620, end: 665 })),
      ).toMatchObject({ code: EXCLUSION_VIOLATION, constraint: 'pattern_entries_room_excl' });
    });

    it('refuses a move that gives a class two blocks at once', async () => {
      const oxford = await schoolClass();
      const art = await kit.load.classes.subject({ grades: [7, 9, 10] });
      await place({ weekday: 2, start: 720, end: 765 }, [{ row: await row({ classId: oxford }) }]);
      const moved = await place({ weekday: 2, start: 780, end: 825 }, [
        { row: await row({ classId: oxford, subjectId: art }) },
      ]);
      expect(
        await refusal(moveBlock(moved.block, { weekday: 2, start: 740, end: 785 })),
      ).toMatchObject({ code: EXCLUSION_VIOLATION, constraint: 'pattern_block_classes_excl' });
    });

    it('refuses a move into a shared room already holding its number of lessons', async () => {
      const hall = await kit.room(north, { most: 2 });
      for (let one = 0; one < 2; one += 1) {
        await place({ weekday: 4, start: 540, end: 585 }, [
          { row: await row({ classId: await schoolClass() }), roomId: hall },
        ]);
      }
      const moved = await place({ weekday: 4, start: 600, end: 645 }, [
        { row: await row({ classId: await schoolClass() }), roomId: hall },
      ]);
      expect(
        await refusal(moveBlock(moved.block, { weekday: 4, start: 560, end: 605 })),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'pattern_room_shared_full' });
    });

    it('lets a swap pass through a clash when the constraints are deferred, and refuses one still clashing at the commit', async () => {
      const busy = await teacher();
      const a = await place({ weekday: 5, start: 480, end: 525 }, [
        { row: await row({ classId: await schoolClass() }, { teacher: busy }) },
      ]);
      const b = await place({ weekday: 5, start: 540, end: 585 }, [
        { row: await row({ classId: await schoolClass() }, { teacher: busy }) },
      ]);
      const swap = (third: boolean) =>
        inBranch(north, async (transaction) => {
          await sql`set constraints pattern_entries_teacher_excl, pattern_entries_room_excl, pattern_block_classes_excl deferred`.execute(
            transaction,
          );
          await transaction
            .updateTable('pattern_blocks')
            .set({ start_minutes: 540, end_minutes: 585 })
            .where('id', '=', a.block)
            .execute();
          await transaction
            .updateTable('pattern_blocks')
            .set({ start_minutes: third ? 500 : 480, end_minutes: third ? 545 : 525 })
            .where('id', '=', b.block)
            .execute();
        });
      // Without the deferral the first update is refused at once.
      expect(await refusal(moveBlock(a.block, { weekday: 5, start: 540, end: 585 }))).toMatchObject(
        {
          constraint: 'pattern_entries_teacher_excl',
        },
      );
      // A swap whose second block still meets the first at the commit.
      expect(await refusal(swap(true))).toMatchObject({
        code: EXCLUSION_VIOLATION,
        constraint: 'pattern_entries_teacher_excl',
      });
      await swap(false);
      const starts = await database.migrator
        .selectFrom('pattern_entries')
        .select(['block_id', 'start_minutes'])
        .where('block_id', 'in', [a.block, b.block])
        .orderBy('start_minutes')
        .execute();
      expect(starts).toEqual([
        { block_id: b.block, start_minutes: 480 },
        { block_id: a.block, start_minutes: 540 },
      ]);
    });
  });

  describe('double lessons (pattern_double_pair)', () => {
    it('refuses a third block in a pair, and a pair on two weekdays', async () => {
      const pair = '00000000-0000-7000-8000-000000000011';
      await place({ start: 540, end: 585, pairId: pair }, []);
      await place({ start: 590, end: 635, pairId: pair }, []);
      expect(await refusal(place({ start: 640, end: 685, pairId: pair }, []))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'pattern_double_pair',
      });
      const other = '00000000-0000-7000-8000-000000000012';
      await place({ start: 700, end: 745, pairId: other }, []);
      expect(
        await refusal(place({ weekday: 2, start: 750, end: 795, pairId: other }, [])),
      ).toMatchObject({ constraint: 'pattern_double_pair' });
    });
  });

  describe('the classes of a block are the database’s', () => {
    it('refuses an insert, an update and a delete by the application', async () => {
      const oxford = await schoolClass();
      const placed = await place({ start: 1200, end: 1245 }, [
        { row: await row({ classId: oxford }) },
      ]);
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .insertInto('pattern_block_classes')
              .values({
                branch_id: north,
                version_id: version,
                block_id: placed.block,
                weekday: 1,
                start_minutes: 1200,
                end_minutes: 1245,
                class_id: oxford,
              })
              .execute(),
          ),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'pattern_block_classes_direct' });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('pattern_block_classes')
              .set({ start_minutes: 1200 })
              .where('block_id', '=', placed.block)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'pattern_block_classes_direct' });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .deleteFrom('pattern_block_classes')
              .where('block_id', '=', placed.block)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'pattern_block_classes_direct' });
      expect(await classesOf(placed.block)).toHaveLength(1);
    });
  });
});
