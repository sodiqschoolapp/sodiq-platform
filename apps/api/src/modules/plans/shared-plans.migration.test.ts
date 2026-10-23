import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../database/migrate.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../db/migrations',
);
const SHARED_PLANS = '0116_shared_plans.sql';

// Task 7.1c (pull request #214, decision 2, Look first; spec review of the
// plan, should-fix 10): the rows are written the way 7.1a and 7.1b wrote them
// (an item's position and mark on the item, a cleared item that gave its
// position up, items past the last row with a gap, a plan with no snapshot),
// then 0116 runs: every item not cleared has its place in the plan's journal,
// at its position, with its mark; a cleared item has none. Invented names.
describe('migration 0116 keeps the place of every item per journal', () => {
  let database: TestDatabase;
  let directory: string;
  let written: {
    laid: { plan: string; journal: string; items: Record<string, string> };
    unlaid: { plan: string; journal: string; item: string };
  };

  beforeAll(async () => {
    database = await createTestDatabase({ empty: true });
    directory = await mkdtemp(path.join(tmpdir(), 'sodiq-shared-plans-'));
    for (const name of (await readdir(MIGRATIONS)).filter((one) => one.endsWith('.sql'))) {
      if (name < SHARED_PLANS) {
        await copyFile(path.join(MIGRATIONS, name), path.join(directory, name));
      }
    }
    await migrate({ connectionString: database.migrationUrl, directory });
    const m = database.migrator;
    const classes = new ClassesKit(m);
    const north = await insertBranch(m, 'North');
    const year = await classes.year(north);
    const quarter = (
      await m
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
    const journalOf = async () => {
      const subject = await classes.subject({ grades: [7] });
      const classId = await classes.schoolClass(north, year, { grade: 7 });
      const journal = await m
        .insertInto('journals')
        .values({
          branch_id: north,
          academic_year_id: year,
          class_id: classId,
          group_id: null,
          subject_id: subject,
          runs: '{[2026-09-07,)}',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const plan = await m
        .insertInto('lesson_plans')
        .values({ branch_id: north, quarter_id: quarter, subject_id: subject })
        .returning('id')
        .executeTakeFirstOrThrow();
      await m
        .insertInto('lesson_plan_journals')
        .values({ branch_id: north, plan_id: plan.id, journal_id: journal.id, quarter_id: quarter })
        .execute();
      return { plan: plan.id, journal: journal.id };
    };
    // The columns 0116 drops are written with SQL: the generated types are of 0116.
    const item = async (
      plan: string,
      position: number,
      extra: { movedFrom?: string; cleared?: boolean } = {},
    ) =>
      (
        await sql<{ id: string }>`
          insert into lesson_plan_items (branch_id, plan_id, position, topic, moved_from, cleared_at)
          values (${north}, ${plan}, ${position}, ${`Topic ${String(position)}`},
            ${extra.movedFrom ?? null}::date,
            ${extra.cleared === true ? new Date('2026-10-10T10:00:00Z') : null})
          returning id
        `.execute(m)
      ).rows[0]?.id ?? '';
    const laid = await journalOf();
    const items: Record<string, string> = {
      cleared: await item(laid.plan, 2, { cleared: true }),
      first: await item(laid.plan, 1),
      second: await item(laid.plan, 2),
      movedBack: await item(laid.plan, 3, { movedFrom: '2026-09-14' }),
      // Past the last row, with a gap at 40 (task 7.1b: the gaps are kept).
      past: await item(laid.plan, 41),
    };
    await m
      .updateTable('lesson_plan_journals')
      .set({ laid_at: new Date('2026-10-01T10:00:00Z') })
      .where('plan_id', '=', laid.plan)
      .execute();
    const unlaid = await journalOf();
    written = {
      laid: { ...laid, items },
      unlaid: { ...unlaid, item: await item(unlaid.plan, 7) },
    };
    await migrate({ connectionString: database.migrationUrl, directory: MIGRATIONS });
  });

  afterAll(async () => {
    await database.destroy();
    await rm(directory, { recursive: true });
  });

  const placesOf = (plan: string) =>
    database.migrator
      .selectFrom('lesson_plan_places')
      .select([
        'item_id',
        'journal_id',
        'position',
        sql<string | null>`moved_from::text`.as('moved_from'),
      ])
      .where('plan_id', '=', plan)
      .orderBy('position')
      .execute();

  it('places every item not cleared at its position in the journal, with its mark', async () => {
    const { plan, journal, items } = written.laid;
    expect(await placesOf(plan)).toEqual([
      { item_id: items.first, journal_id: journal, position: 1, moved_from: null },
      { item_id: items.second, journal_id: journal, position: 2, moved_from: null },
      { item_id: items.movedBack, journal_id: journal, position: 3, moved_from: '2026-09-14' },
      { item_id: items.past, journal_id: journal, position: 41, moved_from: null },
    ]);
  });

  it('gives a cleared item no place', async () => {
    const found = await database.migrator
      .selectFrom('lesson_plan_places')
      .select('item_id')
      .where('item_id', '=', written.laid.items.cleared ?? '')
      .execute();
    expect(found).toEqual([]);
  });

  it('places the items of a plan with no snapshot as they are, and keeps its laid_at empty', async () => {
    const { plan, journal, item } = written.unlaid;
    expect(await placesOf(plan)).toEqual([
      { item_id: item, journal_id: journal, position: 7, moved_from: null },
    ]);
    const link = await database.migrator
      .selectFrom('lesson_plan_journals')
      .select('laid_at')
      .where('plan_id', '=', plan)
      .executeTakeFirstOrThrow();
    expect(link.laid_at).toBeNull();
  });
});
