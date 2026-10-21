import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit, type LessonSource } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { heldEntry } from '../../testing/held-entry.js';

/** Thursday 15 October 2026, 23:30 in Tashkent: today is the 15th, tomorrow the 16th. */
const NOW = '2026-10-15T23:30:00+05:00';
const TODAY = '2026-10-15';
const TOMORROW = '2026-10-16';
const YESTERDAY = '2026-10-14';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// The guards of the deletes and the re-pointing that a publish writes
// (db/migrations/0079; task 5.5b-1, pull request #152, decisions 2 and 3).
// 06, How surprises are prevented: "Publishing or regenerating cannot change
// any lesson dated today or earlier." edge/timetable, Versions and drafts: "An
// unchanged lesson keeps its identity". Every write is made as `sodiq_app`
// through the branch filter, with no service in between. All names are
// invented.
describe('the deletes and re-pointing of dated lessons in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LessonsKit;
  let north: string;
  let year: string;
  let quarter: string;
  let subject: string;

  const inBranch = <T>(work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([north], work);

  const schoolClass = () => kit.load.classes.schoolClass(north, year, { grade: 7 });

  /** A published version with a pattern block of one entry per class (`LessonsKit.source`). */
  const sourceOf = (classIds: readonly string[]) =>
    kit.source(
      north,
      year,
      classIds.map((classId) => ({ classId, groupId: null, subjectId: subject })),
    );

  /** A block on `date` at 23:45 to 23:59 and one lesson per entry of the source, by the migrator. */
  async function dated(
    source: LessonSource,
    unitIds: readonly string[],
    date: string,
    unit: 'class' | 'group' = 'class',
  ): Promise<{ block: string; lessons: string[] }> {
    const block = await database.migrator
      .insertInto('lesson_blocks')
      .values({
        branch_id: north,
        academic_year_id: year,
        quarter_id: quarter,
        lesson_date: date,
        starts_at: at(date, '23:45'),
        ends_at: at(date, '23:59'),
        version_id: source.versionId,
        pattern_block_id: source.patternBlockId,
      })
      .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
      .executeTakeFirstOrThrow();
    const lessons: string[] = [];
    for (const [index, unitId] of unitIds.entries()) {
      const from = source.lessons[index];
      const row = await database.migrator
        .insertInto('lessons')
        .values({
          branch_id: north,
          block_id: block.id,
          lesson_date: block.lesson_date,
          starts_at: block.starts_at,
          ends_at: block.ends_at,
          class_id: unit === 'class' ? unitId : null,
          group_id: unit === 'group' ? unitId : null,
          subject_id: subject,
          load_row_id: from?.loadRowId ?? '',
          pattern_entry_id: from?.patternEntryId ?? '',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      lessons.push(row.id);
    }
    return { block: block.id, lessons };
  }

  /** The block and its lessons re-pointed to another source, as a publish does it. */
  const repoint = (
    transaction: Transaction,
    written: { block: string; lessons: string[] },
    target: LessonSource,
    lessons = true,
  ) =>
    (async () => {
      await transaction
        .updateTable('lesson_blocks')
        .set({ version_id: target.versionId, pattern_block_id: target.patternBlockId })
        .where('id', '=', written.block)
        .execute();
      if (!lessons) return;
      for (const [index, id] of written.lessons.entries()) {
        await transaction
          .updateTable('lessons')
          .set({
            load_row_id: target.lessons[index]?.loadRowId ?? '',
            pattern_entry_id: target.lessons[index]?.patternEntryId ?? '',
          })
          .where('id', '=', id)
          .execute();
      }
    })();

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    const made = await kit.year(north);
    year = made.year;
    quarter = made.quarters[0] ?? '';
    subject = await kit.load.classes.subject({ grades: [7] });
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('a delete (lessons_delete_past, lesson_blocks_delete_past)', () => {
    it('deletes a lesson and its block dated tomorrow, with their claims', async () => {
      const oxford = await schoolClass();
      const written = await dated(await sourceOf([oxford]), [oxford], TOMORROW);
      await inBranch(async (transaction) => {
        await transaction.deleteFrom('lessons').where('block_id', '=', written.block).execute();
        await transaction.deleteFrom('lesson_blocks').where('id', '=', written.block).execute();
        await heldEntry(transaction, north);
      });
      const left = await database.migrator
        .selectFrom('time_claims')
        .select('id')
        .where('block_id', '=', written.block)
        .execute();
      expect(left).toEqual([]);
    });

    it('refuses a lesson and a block dated today, also one that has not started yet', async () => {
      const oxford = await schoolClass();
      // 23:45 today, after the moment of 23:30.
      const written = await dated(await sourceOf([oxford]), [oxford], TODAY);
      expect(
        await refusal(
          inBranch((transaction) =>
            transaction.deleteFrom('lessons').where('block_id', '=', written.block).execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'lesson_delete_past' });
      const empty = await dated(await sourceOf([oxford]), [], TODAY);
      expect(
        await refusal(
          inBranch((transaction) =>
            transaction.deleteFrom('lesson_blocks').where('id', '=', empty.block).execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'lesson_delete_past' });
    });

    it('refuses a lesson dated yesterday', async () => {
      const oxford = await schoolClass();
      const written = await dated(await sourceOf([oxford]), [oxford], YESTERDAY);
      expect(
        await refusal(
          inBranch((transaction) =>
            transaction.deleteFrom('lessons').where('block_id', '=', written.block).execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'lesson_delete_past' });
    });

    it('refuses a delete without a moment of the transaction, even after tomorrow', async () => {
      const oxford = await schoolClass();
      const written = await dated(await sourceOf([oxford]), [oxford], '2026-10-20');
      expect(
        await refusal(
          inBranch(async (transaction) => {
            await sql`select set_config('app.now', '', true)`.execute(transaction);
            await transaction.deleteFrom('lessons').where('block_id', '=', written.block).execute();
          }),
        ),
      ).toMatchObject({ constraint: 'lesson_delete_past' });
    });
  });

  describe('a re-point (lesson_repoint, lesson_repoint_past)', () => {
    it('re-points a block and its lessons to another published version at the commit', async () => {
      const oxford = await schoolClass();
      const written = await dated(await sourceOf([oxford]), [oxford], TOMORROW);
      const target = await sourceOf([oxford]);
      await inBranch((transaction) => repoint(transaction, written, target));
      const block = await database.migrator
        .selectFrom('lesson_blocks')
        .select(['version_id', 'pattern_block_id'])
        .where('id', '=', written.block)
        .executeTakeFirstOrThrow();
      expect(block).toEqual({
        version_id: target.versionId,
        pattern_block_id: target.patternBlockId,
      });
    });

    it('refuses a block re-pointed while its lessons keep the rows of the earlier version', async () => {
      const oxford = await schoolClass();
      const written = await dated(await sourceOf([oxford]), [oxford], TOMORROW);
      const target = await sourceOf([oxford]);
      expect(
        await refusal(inBranch((transaction) => repoint(transaction, written, target, false))),
      ).toMatchObject({ constraint: 'lesson_repoint' });
    });

    it('refuses a lesson re-pointed to a row of another published version', async () => {
      const oxford = await schoolClass();
      const written = await dated(await sourceOf([oxford]), [oxford], TOMORROW);
      const other = await sourceOf([oxford]);
      expect(
        await refusal(
          inBranch((transaction) =>
            transaction
              .updateTable('lessons')
              .set({
                load_row_id: other.lessons[0]?.loadRowId ?? '',
                pattern_entry_id: other.lessons[0]?.patternEntryId ?? '',
              })
              .where('id', '=', written.lessons[0] ?? '')
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'lesson_repoint' });
    });

    it('refuses a lesson re-pointed to a row of another class', async () => {
      const oxford = await schoolClass();
      const princeton = await schoolClass();
      const written = await dated(await sourceOf([oxford]), [oxford], TOMORROW);
      const target = await sourceOf([princeton]);
      expect(
        await refusal(inBranch((transaction) => repoint(transaction, written, target))),
      ).toMatchObject({ constraint: 'lesson_repoint' });
    });

    // 0079, `lesson_repoint`: `r.group_id is distinct from l.group_id` on
    // its own (second opinion of round 2): the two rows have no class and the
    // same version, block and subject, so only the group tells them apart.
    it('refuses a group lesson re-pointed to the row of another group', async () => {
      const oxford = await schoolClass();
      const first = await kit.load.classes.group(north, year, subject, [oxford]);
      const second = await kit.load.classes.group(north, year, subject, [oxford]);
      const groupSource = (groupId: string) =>
        kit.source(north, year, [{ classId: null, groupId, subjectId: subject }]);
      const written = await dated(await groupSource(first), [first], TOMORROW, 'group');
      const other = await groupSource(second);
      expect(
        await refusal(inBranch((transaction) => repoint(transaction, written, other))),
      ).toMatchObject({ constraint: 'lesson_repoint' });
      // The same re-point to a row of the lesson's own group passes.
      const own = await groupSource(first);
      await inBranch((transaction) => repoint(transaction, written, own));
    });

    it("refuses an entry of another row, on the block's pattern block or on another", async () => {
      const oxford = await schoolClass();
      const princeton = await schoolClass();
      const written = await dated(await sourceOf([oxford]), [oxford], TOMORROW);
      // The target's block holds an entry for each class; the lesson of
      // Oxford takes Oxford's row with Princeton's entry.
      const target = await sourceOf([oxford, princeton]);
      const crossed: LessonSource = {
        ...target,
        lessons: [
          {
            loadRowId: target.lessons[0]?.loadRowId ?? '',
            patternEntryId: target.lessons[1]?.patternEntryId ?? '',
          },
        ],
      };
      expect(
        await refusal(inBranch((transaction) => repoint(transaction, written, crossed))),
      ).toMatchObject({ constraint: 'lesson_repoint' });
      // Oxford's row and entry of the target, the block left on its earlier pattern block.
      const elsewhere = await sourceOf([oxford]);
      expect(
        await refusal(
          inBranch(async (transaction) => {
            await transaction
              .updateTable('lesson_blocks')
              .set({ version_id: target.versionId, pattern_block_id: target.patternBlockId })
              .where('id', '=', written.block)
              .execute();
            await transaction
              .updateTable('lessons')
              .set({
                load_row_id: target.lessons[0]?.loadRowId ?? '',
                pattern_entry_id: elsewhere.lessons[0]?.patternEntryId ?? '',
              })
              .where('id', '=', written.lessons[0] ?? '')
              .execute();
          }),
        ),
      ).toMatchObject({ constraint: 'lesson_repoint' });
    });

    // 0079, `lesson_repoint`: `e.block_id is distinct from block.pattern_block_id`
    // on its own (code round 3, finding 1): the row of two lessons a week has
    // an entry in two pattern blocks of the target, and the lesson takes its
    // own row's entry of the pattern block its block is not on. Version,
    // class, group and the entry's row all match.
    it("refuses a lesson re-pointed to its own row's entry in another pattern block", async () => {
      const oxford = await schoolClass();
      const written = await dated(await sourceOf([oxford]), [oxford], TOMORROW);
      const target = await sourceOf([oxford]);
      const first = target.lessons[0];
      const firstEntry = await database.migrator
        .selectFrom('pattern_entries')
        .select('teacher_id')
        .where('id', '=', first?.patternEntryId ?? '')
        .executeTakeFirstOrThrow();
      await kit.load.setVersion(target.versionId, 'draft');
      const tuesday = await database.migrator
        .insertInto('pattern_blocks')
        .values({
          branch_id: north,
          version_id: target.versionId,
          weekday: 2,
          slot_position: 1,
          start_minutes: 540,
          end_minutes: 585,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const second = await database.migrator
        .insertInto('pattern_entries')
        .values({
          branch_id: north,
          version_id: target.versionId,
          block_id: tuesday.id,
          weekday: 2,
          start_minutes: 540,
          end_minutes: 585,
          load_row_id: first?.loadRowId ?? '',
          teacher_id: firstEntry.teacher_id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await kit.load.setVersion(target.versionId, 'published');
      const tuesdayEntry: LessonSource = {
        ...target,
        lessons: [{ loadRowId: first?.loadRowId ?? '', patternEntryId: second.id }],
      };
      expect(
        await refusal(inBranch((transaction) => repoint(transaction, written, tuesdayEntry))),
      ).toMatchObject({ constraint: 'lesson_repoint' });
      // The same row with its entry of the block's own pattern block passes.
      await inBranch((transaction) => repoint(transaction, written, target));
    });

    it('refuses a block re-pointed to a draft, and to a version of another year', async () => {
      const oxford = await schoolClass();
      // Blocks with no lesson: only the version's state or year can refuse them.
      const written = await dated(await sourceOf([oxford]), [], TOMORROW);
      const draft = await kit.load.version(north, year, { startsOn: '2026-10-19' });
      const draftBlock = await database.migrator
        .insertInto('pattern_blocks')
        .values({
          branch_id: north,
          version_id: draft,
          weekday: 5,
          slot_position: 1,
          start_minutes: 540,
          end_minutes: 585,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      expect(
        await refusal(
          inBranch((transaction) =>
            transaction
              .updateTable('lesson_blocks')
              .set({ version_id: draft, pattern_block_id: draftBlock.id })
              .where('id', '=', written.block)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'lesson_repoint' });

      const planned = await kit.load.classes.year(north, 'planned', '2027-09-01', '2028-05-31');
      const later = await kit.load.version(north, planned, { startsOn: '2027-09-01' });
      const laterBlock = await database.migrator
        .insertInto('pattern_blocks')
        .values({
          branch_id: north,
          version_id: later,
          weekday: 5,
          slot_position: 1,
          start_minutes: 540,
          end_minutes: 585,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await kit.load.setVersion(later, 'published');
      expect(
        await refusal(
          inBranch((transaction) =>
            transaction
              .updateTable('lesson_blocks')
              .set({ version_id: later, pattern_block_id: laterBlock.id })
              .where('id', '=', written.block)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'lesson_repoint' });
    });

    it('refuses a re-point of a block and of a lesson dated today', async () => {
      const oxford = await schoolClass();
      const written = await dated(await sourceOf([oxford]), [oxford], TODAY);
      const target = await sourceOf([oxford]);
      expect(
        await refusal(inBranch((transaction) => repoint(transaction, written, target, false))),
      ).toMatchObject({ constraint: 'lesson_repoint_past' });
      expect(
        await refusal(
          inBranch((transaction) =>
            transaction
              .updateTable('lessons')
              .set({
                load_row_id: target.lessons[0]?.loadRowId ?? '',
                pattern_entry_id: target.lessons[0]?.patternEntryId ?? '',
              })
              .where('id', '=', written.lessons[0] ?? '')
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'lesson_repoint_past' });
    });
  });

  // db/migrations/0080 (code review of #152, round 2, finding 1):
  // edge/timetable, After publishing: "A class cannot be archived while it
  // has future lessons or members."
  describe('the archive of a class (classes_lessons_guard)', () => {
    const archive = (id: string) =>
      inBranch((transaction) =>
        transaction
          .updateTable('classes')
          .set({ archived_at: new Date(NOW) })
          .where('id', '=', id)
          .execute(),
      );

    it('refuses an archive while the class has a lesson dated tomorrow', async () => {
      const oxford = await schoolClass();
      await dated(await sourceOf([oxford]), [oxford], TOMORROW);
      expect(await refusal(archive(oxford))).toMatchObject({ constraint: 'classes_has_lessons' });
    });

    it('archives a class whose lessons are dated today or earlier, also one later today', async () => {
      const oxford = await schoolClass();
      // 23:45 today, after the moment of 23:30: not yet held, but not future by date.
      await dated(await sourceOf([oxford]), [oxford], TODAY);
      await dated(await sourceOf([oxford]), [oxford], YESTERDAY);
      await archive(oxford);
      const row = await database.migrator
        .selectFrom('classes')
        .select('archived_at')
        .where('id', '=', oxford)
        .executeTakeFirstOrThrow();
      expect(row.archived_at).toEqual(new Date(NOW));
    });

    it('counts only the lessons of the class archived', async () => {
      const oxford = await schoolClass();
      const cambridge = await schoolClass();
      await dated(await sourceOf([cambridge]), [cambridge], TOMORROW);
      await archive(oxford);
      expect(await refusal(archive(cambridge))).toMatchObject({
        constraint: 'classes_has_lessons',
      });
    });
  });
});
