import {
  PLAN_FILE_MAX_BYTES,
  PLAN_FILE_NAME_MAX_LENGTH,
  PLAN_FILE_TYPES,
  PLAN_FILES_MAX,
  PLAN_LINK_MAX_LENGTH,
  PLAN_LINKS_MAX,
  PLAN_OBJECTIVES_MAX_LENGTH,
  PLAN_TOPIC_MAX_LENGTH,
  PLAN_WORK_DESCRIPTION_MAX_LENGTH,
  PLAN_WORK_TITLE_MAX_LENGTH,
  PLAN_WORKS_MAX,
} from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const INSUFFICIENT_PRIVILEGE = '42501';

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

// Lesson plans in the database (task 7.1a, pull request #212; db/migrations/0114):
// the branch filter, one plan per journal and quarter, the subject, year and
// attendance-only refusals, one item per position, the limits of 10 works of a kind
// and 10 files, the checks against the shared bounds and the grants. Invented names.
describe('lesson plans in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let classes: ClassesKit;
  let north: string;
  let south: string;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  interface Unit {
    readonly branch: string;
    readonly year: string;
    readonly quarter: string;
    readonly subject: string;
    readonly journal: string;
  }

  /** A class journal of a subject in the branch's year, with the year's first quarter. */
  async function unit(
    branch: string,
    year: string,
    journalType: 'graded' | 'attendance_only' = 'graded',
  ): Promise<Unit> {
    const subject = await classes.subject({ grades: [7], journalType });
    const classId = await classes.schoolClass(branch, year, { grade: 7 });
    const journal = await database.migrator
      .insertInto('journals')
      .values({
        branch_id: branch,
        academic_year_id: year,
        class_id: classId,
        group_id: null,
        subject_id: subject,
        runs: '{[2026-09-07,)}',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const quarter = await database.migrator
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', year)
      .where('number', '=', 1)
      .executeTakeFirstOrThrow();
    return { branch, year, quarter: quarter.id, subject, journal: journal.id };
  }

  const yearOf = async (branch: string) =>
    (
      await database.migrator
        .selectFrom('academic_years')
        .select('id')
        .where('branch_id', '=', branch)
        .executeTakeFirstOrThrow()
    ).id;

  /** A plan of the unit, linked, written as the application. */
  const plan = (u: Unit) =>
    inBranch(u.branch, async (transaction) => {
      const row = await transaction
        .insertInto('lesson_plans')
        .values({ branch_id: u.branch, quarter_id: u.quarter, subject_id: u.subject })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('lesson_plan_journals')
        .values({
          branch_id: u.branch,
          plan_id: row.id,
          journal_id: u.journal,
          quarter_id: u.quarter,
        })
        .execute();
      return row.id;
    });

  const item = (branch: string, planId: string, position: number, change: object = {}) =>
    inBranch(branch, (transaction) =>
      transaction
        .insertInto('lesson_plan_items')
        .values({ branch_id: branch, plan_id: planId, position, topic: 'Fractions', ...change })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );

  const work = (branch: string, itemId: string, kind: string, change: object = {}) =>
    inBranch(branch, (transaction) =>
      transaction
        .insertInto('lesson_plan_works')
        .values({
          branch_id: branch,
          item_id: itemId,
          kind,
          position: 1,
          title: 'Exercise',
          ...change,
        })
        .execute(),
    );

  const file = (branch: string, itemId: string, change: object = {}) =>
    inBranch(branch, (transaction) =>
      transaction
        .insertInto('lesson_plan_files')
        .values({
          branch_id: branch,
          item_id: itemId,
          name: 'Sheet.pdf',
          type: 'application/pdf',
          bytes: 100,
          ...change,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    classes = new ClassesKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    await classes.year(north);
    await classes.year(south);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('shows no row of another branch in any plan table', async () => {
    const u = await unit(north, await yearOf(north));
    const planId = await plan(u);
    const { id } = await item(north, planId, 1);
    await work(north, id, 'classwork');
    await file(north, id);
    for (const table of [
      'lesson_plans',
      'lesson_plan_journals',
      'lesson_plan_items',
      'lesson_plan_works',
      'lesson_plan_files',
    ] as const) {
      const own = await inBranch(north, (transaction) =>
        transaction.selectFrom(table).selectAll().execute(),
      );
      const other = await inBranch(south, (transaction) =>
        transaction.selectFrom(table).selectAll().execute(),
      );
      expect(own.length, table).toBeGreaterThan(0);
      expect(other, table).toEqual([]);
    }
  });

  it('keeps one plan per journal and quarter, of the plan’s quarter', async () => {
    const u = await unit(north, await yearOf(north));
    await plan(u);
    const second = await refusal(plan(u));
    expect(second.code).toBe(UNIQUE_VIOLATION);
    expect(second.constraint).toBe('lesson_plan_journals_key');
    // A link naming another quarter than its plan's.
    const quarter2 = await database.migrator
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', u.year)
      .where('number', '=', 2)
      .executeTakeFirstOrThrow();
    const mismatched = await refusal(
      inBranch(north, async (transaction) => {
        const row = await transaction
          .insertInto('lesson_plans')
          .values({ branch_id: north, quarter_id: u.quarter, subject_id: u.subject })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('lesson_plan_journals')
          .values({
            branch_id: north,
            plan_id: row.id,
            journal_id: u.journal,
            quarter_id: quarter2.id,
          })
          .execute();
      }),
    );
    expect(mismatched.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(mismatched.constraint).toBe('lesson_plan_journals_plan_fkey');
  });

  it('refuses a plan of an attendance-only subject, of another subject and of another year', async () => {
    const year = await yearOf(south);
    const attendance = await unit(south, year, 'attendance_only');
    const only = await refusal(plan(attendance));
    expect(only.code).toBe(CHECK_VIOLATION);
    expect(only.constraint).toBe('lesson_plan_attendance_only');

    const u = await unit(south, year);
    const other = await classes.subject({ grades: [7] });
    const subject = await refusal(plan({ ...u, subject: other }));
    expect(subject.constraint).toBe('lesson_plan_journal_subject');

    const nextYear = await classes.year(south, 'planned', '2027-09-01', '2028-05-31');
    const quarter = await database.migrator
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', nextYear)
      .where('number', '=', 1)
      .executeTakeFirstOrThrow();
    const wrongYear = await refusal(plan({ ...u, quarter: quarter.id }));
    expect(wrongYear.constraint).toBe('lesson_plan_journal_year');
  });

  it('keeps one item per position among those not cleared', async () => {
    const u = await unit(north, await yearOf(north));
    const planId = await plan(u);
    const first = await item(north, planId, 1);
    const taken = await refusal(item(north, planId, 1));
    expect(taken.code).toBe(UNIQUE_VIOLATION);
    expect(taken.constraint).toBe('lesson_plan_items_position_idx');
    await inBranch(north, (transaction) =>
      transaction
        .updateTable('lesson_plan_items')
        .set({ cleared_at: new Date(NOW) })
        .where('id', '=', first.id)
        .execute(),
    );
    await item(north, planId, 1);
    expect((await refusal(item(north, planId, 0))).constraint).toBe(
      'lesson_plan_items_position_check',
    );
  });

  it('holds 10 works of a kind and 10 files on an item, also for the migrator', async () => {
    const u = await unit(north, await yearOf(north));
    const planId = await plan(u);
    const { id } = await item(north, planId, 1);
    for (let index = 0; index < PLAN_WORKS_MAX; index += 1) {
      await work(north, id, 'classwork', { position: index + 1 });
      await work(north, id, 'homework', { position: index + 1 });
    }
    const eleventh = await refusal(work(north, id, 'classwork', { position: 11 }));
    expect(eleventh.code).toBe(CHECK_VIOLATION);
    expect(eleventh.constraint).toBe('lesson_plan_works_limit');
    const byMigrator = await refusal(
      database.migrator
        .insertInto('lesson_plan_works')
        .values({ branch_id: north, item_id: id, kind: 'homework', position: 11, title: 'More' })
        .execute(),
    );
    expect(byMigrator.constraint).toBe('lesson_plan_works_limit');

    const files: string[] = [];
    for (let index = 0; index < PLAN_FILES_MAX; index += 1) {
      files.push((await file(north, id)).id);
    }
    const full = await refusal(file(north, id));
    expect(full.constraint).toBe('lesson_plan_files_limit');
    expect(
      (
        await refusal(
          database.migrator
            .insertInto('lesson_plan_files')
            .values({
              branch_id: north,
              item_id: id,
              name: 'x.pdf',
              type: 'application/pdf',
              bytes: 1,
            })
            .execute(),
        )
      ).constraint,
    ).toBe('lesson_plan_files_limit');
    // A removed file does not count.
    await inBranch(north, (transaction) =>
      transaction
        .updateTable('lesson_plan_files')
        .set({ removed_at: new Date(NOW) })
        .where('id', '=', files[0] ?? '')
        .execute(),
    );
    await file(north, id);
  });

  it('checks the texts, links and files against the bounds of packages/shared', async () => {
    const u = await unit(north, await yearOf(north));
    const planId = await plan(u);
    let position = 0;
    const next = () => {
      position += 1;
      return position;
    };
    await item(north, planId, next(), { topic: 'x'.repeat(PLAN_TOPIC_MAX_LENGTH) });
    for (const change of [
      { topic: 'x'.repeat(PLAN_TOPIC_MAX_LENGTH + 1) },
      { topic: '  ' },
      { objectives: 'x'.repeat(PLAN_OBJECTIVES_MAX_LENGTH + 1) },
      {
        links: Array.from({ length: PLAN_LINKS_MAX + 1 }, (_, i) => `https://example.org/${i}`),
      },
      { links: [`https://${'x'.repeat(PLAN_LINK_MAX_LENGTH)}`] },
      { links: ['example.org'] },
      { links: ['https://example.org/a b'] },
    ]) {
      const refused = await refusal(item(north, planId, next(), change));
      expect(refused.code, JSON.stringify(change).slice(0, 60)).toBe(CHECK_VIOLATION);
    }
    await item(north, planId, next(), {
      objectives: 'x'.repeat(PLAN_OBJECTIVES_MAX_LENGTH),
      links: Array.from(
        { length: PLAN_LINKS_MAX },
        (_, i) => `https://example.org/${'x'.repeat(PLAN_LINK_MAX_LENGTH - 25)}${i}`,
      ),
    });
    const { id } = await item(north, planId, next());
    await work(north, id, 'classwork', {
      title: 'x'.repeat(PLAN_WORK_TITLE_MAX_LENGTH),
      description: 'x'.repeat(PLAN_WORK_DESCRIPTION_MAX_LENGTH),
    });
    for (const change of [
      { title: 'x'.repeat(PLAN_WORK_TITLE_MAX_LENGTH + 1) },
      { title: ' ' },
      { description: 'x'.repeat(PLAN_WORK_DESCRIPTION_MAX_LENGTH + 1) },
      { kind: 'test' },
    ]) {
      expect((await refusal(work(north, id, 'homework', change))).code).toBe(CHECK_VIOLATION);
    }
    for (const type of PLAN_FILE_TYPES) {
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('lesson_plan_files')
          .set({ removed_at: new Date(NOW) })
          .where('item_id', '=', id)
          .execute(),
      );
      await file(north, id, { type, bytes: PLAN_FILE_MAX_BYTES });
    }
    for (const change of [
      { type: 'image/gif' },
      { bytes: PLAN_FILE_MAX_BYTES + 1 },
      { bytes: 0 },
      { name: 'x'.repeat(PLAN_FILE_NAME_MAX_LENGTH + 1) },
    ]) {
      expect((await refusal(file(north, id, change))).code).toBe(CHECK_VIOLATION);
    }
  });

  it('refuses a row whose parent is of another branch, by every composite key', async () => {
    const own = await unit(north, await yearOf(north));
    const other = await unit(south, await yearOf(south));
    const otherPlan = await plan(other);
    const otherItem = await item(south, otherPlan, 1);
    const ownPlan = await plan(own);
    const key = async (work: Promise<unknown>, constraint: string) => {
      const refused = await refusal(work);
      expect(refused.code, constraint).toBe(
        constraint.endsWith('_fkey') ? FOREIGN_KEY_VIOLATION : CHECK_VIOLATION,
      );
      expect(refused.constraint).toBe(constraint);
    };
    const m = database.migrator;
    await key(
      m
        .insertInto('lesson_plans')
        .values({ branch_id: north, quarter_id: other.quarter, subject_id: own.subject })
        .execute(),
      'lesson_plans_quarter_fkey',
    );
    await key(
      m
        .insertInto('lesson_plan_journals')
        .values({
          branch_id: north,
          plan_id: ownPlan,
          journal_id: other.journal,
          quarter_id: own.quarter,
        })
        .execute(),
      // The check of the link reads the journal in the plan's branch first and finds
      // none; the key stands behind it.
      'lesson_plan_journal_subject',
    );
    await key(
      m
        .insertInto('lesson_plan_items')
        .values({ branch_id: north, plan_id: otherPlan, position: 1, topic: 'Fractions' })
        .execute(),
      'lesson_plan_items_plan_fkey',
    );
    await key(
      m
        .insertInto('lesson_plan_works')
        .values({
          branch_id: north,
          item_id: otherItem.id,
          kind: 'classwork',
          position: 1,
          title: 'X',
        })
        .execute(),
      'lesson_plan_works_item_fkey',
    );
    await key(
      m
        .insertInto('lesson_plan_files')
        .values({
          branch_id: north,
          item_id: otherItem.id,
          name: 'a.pdf',
          type: 'application/pdf',
          bytes: 1,
        })
        .execute(),
      'lesson_plan_files_item_fkey',
    );
  });

  it('lets the application delete only works, and change no plan or quarter (7.1b moves the position)', async () => {
    const u = await unit(north, await yearOf(north));
    const planId = await plan(u);
    const { id } = await item(north, planId, 1);
    await work(north, id, 'classwork');
    const fileId = (await file(north, id)).id;
    for (const [table, key, value] of [
      ['lesson_plans', 'id', planId],
      ['lesson_plan_journals', 'plan_id', planId],
      ['lesson_plan_items', 'id', id],
      ['lesson_plan_files', 'id', fileId],
    ] as const) {
      const refused = await refusal(
        inBranch(north, (transaction) =>
          transaction.deleteFrom(table).where(key, '=', value).execute(),
        ),
      );
      expect(refused.code, table).toBe(INSUFFICIENT_PRIVILEGE);
    }
    // Task 7.1b (pull request #213): the follow of the queue rewrites the
    // position (0115), so the application may change it; the plan stays.
    for (const set of [{ plan_id: planId }]) {
      const refused = await refusal(
        inBranch(north, (transaction) =>
          transaction.updateTable('lesson_plan_items').set(set).where('id', '=', id).execute(),
        ),
      );
      expect(refused.code).toBe(INSUFFICIENT_PRIVILEGE);
    }
    expect(
      (
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('lesson_plans')
              .set({ quarter_id: u.quarter })
              .where('id', '=', planId)
              .execute(),
          ),
        )
      ).code,
    ).toBe(INSUFFICIENT_PRIVILEGE);
    await inBranch(north, (transaction) =>
      transaction.deleteFrom('lesson_plan_works').where('item_id', '=', id).execute(),
    );
  });
});
