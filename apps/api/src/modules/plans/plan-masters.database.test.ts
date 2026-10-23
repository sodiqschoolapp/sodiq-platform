import {
  PLAN_LINKS_MAX,
  PLAN_MASTER_NAME_MAX_LENGTH,
  PLAN_OBJECTIVES_MAX_LENGTH,
  PLAN_TOPIC_MAX_LENGTH,
  PLAN_WORK_TITLE_MAX_LENGTH,
  PLAN_WORKS_MAX,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const NOW = '2026-10-15T10:00:00+05:00';

async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// Task 7.3, pull request #216 (db/migrations/0118): master plans. A master of a
// branch is filtered to it, one of all branches (no branch) is read by every
// branch (decision 1, Look first); every child names its parent with the scope
// (spec review of the plan, must-fix 1); the bounds are the shared constants.
// Invented names.
describe('master plans in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let classes: ClassesKit;
  let north: string;
  let south: string;
  let subject: string;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  let names = 0;
  const masterValues = (branch: string | null, change: Record<string, unknown> = {}) => {
    names += 1;
    return {
      branch_id: branch,
      subject_id: subject,
      grade: 7,
      language: 'uz',
      start_year: 2026,
      quarter: 2,
      name: `Core ${String(names)}`,
      ...change,
    };
  };

  /** A master written by the migrator; gives its id. */
  const master = async (branch: string | null, change: Record<string, unknown> = {}) =>
    (
      await database.migrator
        .insertInto('lesson_plan_masters')
        .values(masterValues(branch, change))
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  const itemValues = (branch: string | null, masterId: string, position = 1) => ({
    branch_id: branch,
    master_id: masterId,
    position,
    topic: 'Fractions',
    added_revision: 0,
    changed_revision: 0,
  });

  const item = async (branch: string | null, masterId: string, position = 1) =>
    (
      await database.migrator
        .insertInto('lesson_plan_master_items')
        .values(itemValues(branch, masterId, position))
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    classes = new ClassesKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    subject = await classes.subject({ grades: [7, 8] });
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('shows a branch its own masters and those of all branches, never another branch’s', async () => {
    const own = await master(north);
    const theirs = await master(south);
    const all = await master(null);
    const seen = await inBranch(north, (transaction) =>
      transaction.selectFrom('lesson_plan_masters').select('id').execute(),
    );
    const ids = seen.map((row) => row.id);
    expect(ids).toContain(own);
    expect(ids).toContain(all);
    expect(ids).not.toContain(theirs);
    // A master of another branch is refused by the policy's check.
    const refused = await refusal(
      inBranch(north, (transaction) =>
        transaction.insertInto('lesson_plan_masters').values(masterValues(south)).execute(),
      ),
    );
    expect(refused.code).toBe('42501');
  });

  it('refuses an item or a work whose branch is not its master’s, in both directions (review must-fix 1)', async () => {
    const own = await master(north);
    const all = await master(null);
    // An item of no branch on a branch master, and a branch item on a master of all branches.
    expect(
      (
        await refusal(
          database.migrator
            .insertInto('lesson_plan_master_items')
            .values(itemValues(null, own))
            .execute(),
        )
      ).constraint,
    ).toBe('lesson_plan_master_items_master_fkey');
    expect(
      (
        await refusal(
          database.migrator
            .insertInto('lesson_plan_master_items')
            .values(itemValues(north, all))
            .execute(),
        )
      ).constraint,
    ).toBe('lesson_plan_master_items_master_fkey');
    const ownItem = await item(north, own);
    const allItem = await item(null, all);
    const work = (branch: string | null, itemId: string) =>
      database.migrator
        .insertInto('lesson_plan_master_works')
        .values({
          branch_id: branch,
          item_id: itemId,
          kind: 'classwork',
          position: 1,
          title: 'Quiz',
        })
        .execute();
    expect((await refusal(work(null, ownItem))).constraint).toBe(
      'lesson_plan_master_works_item_fkey',
    );
    expect((await refusal(work(south, allItem))).constraint).toBe(
      'lesson_plan_master_works_item_fkey',
    );
    await work(north, ownItem);
    await work(null, allItem);
  });

  it('holds the bounds of the shared constants', async () => {
    const write = (change: Record<string, unknown>) =>
      database.migrator
        .insertInto('lesson_plan_masters')
        .values(masterValues(north, change))
        .execute();
    await write({ name: 'n'.repeat(PLAN_MASTER_NAME_MAX_LENGTH) });
    expect(
      (await refusal(write({ name: 'n'.repeat(PLAN_MASTER_NAME_MAX_LENGTH + 1) }))).constraint,
    ).toBe('lesson_plan_masters_name_check');
    expect((await refusal(write({ name: '  ' }))).constraint).toBe(
      'lesson_plan_masters_name_check',
    );
    expect((await refusal(write({ quarter: 5 }))).constraint).toBe(
      'lesson_plan_masters_quarter_check',
    );
    expect((await refusal(write({ language: 'en' }))).constraint).toBe(
      'lesson_plan_masters_language_check',
    );
    const own = await master(north);
    const itemWrite = (change: Record<string, unknown>) =>
      database.migrator
        .insertInto('lesson_plan_master_items')
        .values({ ...itemValues(north, own, 50), ...change })
        .execute();
    expect(
      (await refusal(itemWrite({ topic: 't'.repeat(PLAN_TOPIC_MAX_LENGTH + 1) }))).constraint,
    ).toBe('lesson_plan_master_items_topic_check');
    expect(
      (await refusal(itemWrite({ objectives: 'o'.repeat(PLAN_OBJECTIVES_MAX_LENGTH + 1) })))
        .constraint,
    ).toBe('lesson_plan_master_items_objectives_check');
    expect(
      (
        await refusal(
          itemWrite({
            links: Array.from({ length: PLAN_LINKS_MAX + 1 }, () => 'https://example.org'),
          }),
        )
      ).constraint,
    ).toBe('lesson_plan_master_items_links_check');
    const itemId = await item(north, own, 60);
    expect(
      (
        await refusal(
          database.migrator
            .insertInto('lesson_plan_master_works')
            .values({
              branch_id: north,
              item_id: itemId,
              kind: 'homework',
              position: 1,
              title: 't'.repeat(PLAN_WORK_TITLE_MAX_LENGTH + 1),
            })
            .execute(),
        )
      ).constraint,
    ).toBe('lesson_plan_master_works_title_check');
    for (let position = 1; position <= PLAN_WORKS_MAX; position += 1) {
      await database.migrator
        .insertInto('lesson_plan_master_works')
        .values({ branch_id: north, item_id: itemId, kind: 'homework', position, title: 'Task' })
        .execute();
    }
    expect(
      (
        await refusal(
          database.migrator
            .insertInto('lesson_plan_master_works')
            .values({
              branch_id: north,
              item_id: itemId,
              kind: 'homework',
              position: 11,
              title: 'Task',
            })
            .execute(),
        )
      ).constraint,
    ).toBe('lesson_plan_works_limit');
  });

  it('keeps one live name per scope, subject, grade, language, year and quarter, case and spaces ignored', async () => {
    await master(north, { name: 'Level A' });
    expect((await refusal(master(north, { name: ' level a ' }))).constraint).toBe(
      'lesson_plan_masters_name_idx',
    );
    expect(
      (
        await refusal(
          master(north, { name: 'УРОВЕНЬ' }).then(() => master(north, { name: 'уровень' })),
        )
      ).constraint,
    ).toBe('lesson_plan_masters_name_idx');
    // Another scope, grade or language takes the same name (decision 14).
    await master(null, { name: 'Level A' });
    await master(north, { name: 'Level A', grade: 8 });
    await master(north, { name: 'Level A', language: 'ru' });
    await master(south, { name: 'Level A' });
  });

  it('refuses a master of an attendance-only subject, or of a grade the subject is not taught in', async () => {
    const attendance = await classes.subject({ grades: [7], journalType: 'attendance_only' });
    expect((await refusal(master(north, { subject_id: attendance }))).constraint).toBe(
      'lesson_plan_master_attendance_only',
    );
    expect((await refusal(master(north, { grade: 9 }))).constraint).toBe(
      'lesson_plan_master_grade',
    );
  });

  it('lets the application change only the name, revision and archive of a master, never its branch; the revision only grows; nothing is deleted', async () => {
    const own = await master(north);
    const check = async (statement: string) =>
      (await refusal(inBranch(north, (transaction) => sql.raw(statement).execute(transaction))))
        .code;
    expect(await check(`update lesson_plan_masters set branch_id = null where id = '${own}'`)).toBe(
      '42501',
    );
    expect(await check(`update lesson_plan_masters set grade = 8 where id = '${own}'`)).toBe(
      '42501',
    );
    expect(await check(`delete from lesson_plan_masters where id = '${own}'`)).toBe('42501');
    const ownItem = await item(north, own, 70);
    expect(await check(`delete from lesson_plan_master_items where id = '${ownItem}'`)).toBe(
      '42501',
    );
    expect(
      await check(
        `update lesson_plan_master_items set master_id = master_id where id = '${ownItem}'`,
      ),
    ).toBe('42501');
    await inBranch(north, (transaction) =>
      transaction
        .updateTable('lesson_plan_masters')
        .set({ revision: 3, name: 'Renamed' })
        .where('id', '=', own)
        .execute(),
    );
    expect(
      (
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('lesson_plan_masters')
              .set({ revision: 2 })
              .where('id', '=', own)
              .execute(),
          ),
        )
      ).constraint,
    ).toBe('lesson_plan_master_revision');
  });

  it('lets a plan name a master of its branch or of all branches only, and the application change only its master link', async () => {
    const year = await classes.year(north);
    const classId = await classes.schoolClass(north, year, { grade: 7 });
    const journal = (
      await database.migrator
        .insertInto('journals')
        .values({
          branch_id: north,
          academic_year_id: year,
          class_id: classId,
          subject_id: subject,
          runs: '{[2026-09-07,)}',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const plan = (
      await database.migrator
        .selectFrom('lesson_plan_journals')
        .select('plan_id')
        .where('journal_id', '=', journal)
        .orderBy('quarter_id')
        .executeTakeFirstOrThrow()
    ).plan_id;
    const link = (masterId: string) =>
      inBranch(north, (transaction) =>
        transaction
          .updateTable('lesson_plans')
          .set({ master_id: masterId, master_revision: 0 })
          .where('id', '=', plan)
          .execute(),
      );
    await link(await master(north));
    await link(await master(null));
    // Another branch's master: hidden by the filter and refused by the trigger, also for the migrator.
    const theirs = await master(south);
    expect((await refusal(link(theirs))).constraint).toBe('lesson_plan_master_branch');
    expect(
      (
        await refusal(
          database.migrator
            .updateTable('lesson_plans')
            .set({ master_id: theirs, master_revision: 0 })
            .where('id', '=', plan)
            .execute(),
        )
      ).constraint,
    ).toBe('lesson_plan_master_branch');
    // An item names a master item of its branch or of all branches only.
    const theirItem = await item(south, theirs, 1);
    expect(
      (
        await refusal(
          database.migrator
            .insertInto('lesson_plan_items')
            .values({ branch_id: north, plan_id: plan, topic: 'Copied', master_item_id: theirItem })
            .execute(),
        )
      ).constraint,
    ).toBe('lesson_plan_master_branch');
    // The link is both columns or neither.
    expect(
      (
        await refusal(
          database.migrator
            .updateTable('lesson_plans')
            .set({ master_revision: null })
            .where('id', '=', plan)
            .execute(),
        )
      ).constraint,
    ).toBe('lesson_plans_master_check');
    expect(
      (
        await refusal(
          inBranch(north, (transaction) =>
            sql`update lesson_plans set subject_id = subject_id where id = ${plan}`.execute(
              transaction,
            ),
          ),
        )
      ).code,
    ).toBe('42501');
  });

  it('writes an item only in the current revision of its master (spec review of the code, should-fix 7)', async () => {
    const own = await master(north);
    expect(
      (
        await refusal(
          database.migrator
            .insertInto('lesson_plan_master_items')
            .values({ ...itemValues(north, own, 1), added_revision: 1, changed_revision: 1 })
            .execute(),
        )
      ).constraint,
    ).toBe('lesson_plan_master_item_revision');
    const itemId = await item(north, own, 1);
    await database.migrator
      .updateTable('lesson_plan_masters')
      .set({ revision: 2 })
      .where('id', '=', own)
      .execute();
    // A change written in an older revision, or a removal in one, would hide it from the comparison.
    for (const change of [
      { changed_revision: 1 },
      { removed_revision: 1 },
      { added_revision: 2 },
    ]) {
      expect(
        (
          await refusal(
            database.migrator
              .updateTable('lesson_plan_master_items')
              .set(change)
              .where('id', '=', itemId)
              .execute(),
          )
        ).constraint,
      ).toBe('lesson_plan_master_item_revision');
    }
    await database.migrator
      .updateTable('lesson_plan_master_items')
      .set({ topic: 'Changed', changed_revision: 2 })
      .where('id', '=', itemId)
      .execute();
    await database.migrator
      .updateTable('lesson_plan_master_items')
      .set({ removed_revision: 2 })
      .where('id', '=', itemId)
      .execute();
  });
});
