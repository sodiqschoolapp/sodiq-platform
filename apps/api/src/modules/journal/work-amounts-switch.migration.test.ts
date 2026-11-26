import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../database/database.js';
import { migrate } from '../../database/migrate.js';
import type { Transaction } from '../../database/transactions.js';
import { insertBranch, setEditDays } from '../../testing/branch-filter-sql.js';
import { CellsKit } from '../../testing/cells-kit.js';
import { closeQuarter } from '../../testing/closing-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { heldEntry } from '../../testing/held-entry.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../db/migrations',
);
const SWITCH = '0189_work_amounts_switch.sql';
/** The moment of the writes before the migration. */
const BEFORE = '2026-11-20T12:00:00+05:00';
/** The moment of the writes after it. */
const AFTER = '2026-11-20T13:00:00+05:00';

/** Every column 0189 switches to its exact twin, with the type it has after the switch. */
const COLUMNS: readonly (readonly [table: string, column: string, type: string])[] = [
  ['journal_cells', 'score', 'work_amount'],
  ['journal_works', 'total', 'work_amount'],
  ['journal_cell_history', 'score_before', 'work_amount'],
  ['journal_cell_history', 'score_after', 'work_amount'],
  ['journal_work_history', 'total_before', 'work_amount'],
  ['journal_work_history', 'total_after', 'work_amount'],
  ['journal_voids', 'score', 'work_amount'],
  ['exemption_clears', 'score', 'work_amount'],
  ['journal_save_refusals', 'value_sent', 'numeric'],
  ['digest_entries', 'sent_score', 'work_amount'],
  ['digest_entries', 'sent_total', 'work_amount'],
];
const TABLES = [...new Set(COLUMNS.map(([table]) => table))];

/** The checks 0189 gives back their names, each on its table. */
const CHECKS: readonly (readonly [table: string, name: string])[] = [
  ['journal_cells', 'journal_cells_score_check'],
  ['journal_cells', 'journal_cells_attendance_check'],
  ['journal_cells', 'journal_cells_not_graded_check'],
  ['journal_works', 'journal_works_total_check'],
  ['exemption_clears', 'exemption_clears_value_check'],
  ['digest_entries', 'digest_entries_removed_check'],
];

/** Writes as the migrator at a moment, the way the code before 0188 wrote its rows. */
const at = <T>(
  migrator: Database,
  moment: string,
  work: (transaction: Transaction) => Promise<T>,
): Promise<T> =>
  migrator.transaction().execute(async (transaction) => {
    await sql`select set_config('app.now', ${new Date(moment).toISOString()}, true)`.execute(
      transaction,
    );
    return work(transaction);
  });

/**
 * The rows of the tables 0189 switches, and of the audit log and the reports, every column but
 * the twins of 0188, as JSON in a stable order: a `numeric` 8 and an `integer` 8 are both 8.
 */
async function snapshot(migrator: Database): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};
  for (const table of [...TABLES, 'forced_deletes', 'audit_log', 'report_changes']) {
    const { rows } = await sql<{ row: Record<string, unknown> }>`
      select to_jsonb(t) - array(
        select column_name::text from information_schema.columns
        where table_schema = 'public' and table_name = ${table} and column_name like '%\\_exact'
      ) as row
      from ${sql.table(table)} t
    `.execute(migrator);
    result[table] = rows
      .map((one) => one.row)
      .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  }
  return result;
}

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<Error> {
  try {
    await work;
  } catch (error) {
    return error as Error;
  }
  throw new Error('The write was not refused.');
}

// Task 11.25b (pull request #397; the build line: "step 2 drops the mirrors and the old columns and
// renames the twins and their checks into the old names (metadata only …), and drops and creates
// `forced_store_cells` and `forced_store_works` returning `work_amount`, with `execute` granted
// to `sodiq_app` again; a store written before the change and one written after … are restored in
// a test"). The rows are written on a database migrated to 0188, as the code of 11.25a wrote them
// (the fixture of the 0188 test: cells, cleared and of a closed quarter and a locked lesson,
// works with a total changed and "not held", their history, a void, an exemption clear, a refusal
// of each kind with a score of 1500, digest entries) and a forced-delete store of whole numbers.
// Then 0189 runs. Names are invented.
describe('migration 0189 switches every work score and total to its exact twin', () => {
  let database: TestDatabase;
  let directory: string;
  let branch: string;
  let teacher: string;
  let students: readonly string[];
  let lessons: { closed: string; locked: string; open: string };
  let works: { closed: string; locked: string; open: string; notHeld: string };
  let cells: { closed: string; locked: string; open: string; cleared: string };
  let exemption: string;
  let quarter: string;
  let journal: string;
  let digestId: string;
  let storeBefore: string;
  let before: Record<string, unknown[]>;

  beforeAll(async () => {
    database = await createTestDatabase({ empty: true });
    directory = await mkdtemp(path.join(tmpdir(), 'sodiq-work-switch-'));
    for (const name of (await readdir(MIGRATIONS)).filter((one) => one.endsWith('.sql'))) {
      if (name < SWITCH) await copyFile(path.join(MIGRATIONS, name), path.join(directory, name));
    }
    await migrate({ connectionString: database.migrationUrl, directory });
    const migrator = database.migrator;

    const kit = await CellsKit.create(migrator);
    branch = await insertBranch(migrator, 'North');
    const { year, quarters } = await kit.lessons.year(branch);
    const classId = await kit.lessons.load.classes.schoolClass(branch, year, { grade: 7 });
    students = await kit.lessons.pupils(branch, classId, 3);
    teacher = await kit.lessons.load.classes.account();
    lessons = {
      closed: await kit.lesson(branch, year, classId, '2026-10-05'),
      locked: await kit.lesson(branch, year, classId, '2026-11-10'),
      open: await kit.lesson(branch, year, classId, '2026-11-19'),
    };
    const [first, second, third] = students as [string, string, string];

    const work = (lesson: string, total: number | null, notHeld = false) =>
      at(migrator, BEFORE, async (transaction) => {
        const row = await transaction
          .insertInto('journal_works')
          .values({
            branch_id: branch,
            lesson_id: lesson,
            source_lesson_id: lesson,
            kind: 'classwork',
            position: notHeld ? 2 : 1,
            title: 'Exercise',
            total,
            not_held: notHeld,
            changed_by: teacher,
            changed_how: 'entry',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return row.id;
      });
    const score = (lesson: string, work: string, student: string, value: number) =>
      at(migrator, BEFORE, async (transaction) => {
        const row = await transaction
          .insertInto('journal_cells')
          .values({
            branch_id: branch,
            lesson_id: lesson,
            student_id: student,
            work_id: work,
            score: value,
            version: 1,
            changed_by: teacher,
            changed_how: 'entry',
            changed_at: new Date(BEFORE),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return row.id;
      });

    works = {
      closed: await work(lessons.closed, 10),
      locked: await work(lessons.locked, 30),
      open: await work(lessons.open, 5),
      notHeld: await work(lessons.open, null, true),
    };
    // A total changed, so that the work history holds a total before and after.
    await at(migrator, BEFORE, (transaction) =>
      transaction
        .updateTable('journal_works')
        .set({ total: 20, changed_by: teacher, changed_how: 'entry' })
        .where('id', '=', works.locked)
        .execute(),
    );
    // An attendance cell: a mark, no work and no number.
    await kit.cell(branch, {
      lessonId: lessons.open,
      studentId: first,
      mark: 1,
      by: teacher,
      at: new Date(BEFORE).toISOString(),
    });
    cells = {
      closed: await score(lessons.closed, works.closed, first, 8),
      locked: await score(lessons.locked, works.locked, first, 17),
      open: await score(lessons.open, works.open, first, 4),
      cleared: await score(lessons.open, works.open, second, 3),
    };
    await at(migrator, BEFORE, (transaction) =>
      transaction
        .updateTable('journal_cells')
        .set({ score: 5, changed_by: teacher, changed_how: 'entry' })
        .where('id', '=', cells.open)
        .execute(),
    );
    await kit.clear(cells.cleared, teacher, new Date(BEFORE).toISOString());

    // An exemption that cleared a number typed before it (exemption_clears keeps it).
    const exemptCell = await score(lessons.open, works.open, third, 2);
    exemption = await at(migrator, BEFORE, async (transaction) => {
      const row = await transaction
        .insertInto('exemptions')
        .values({
          branch_id: branch,
          student_id: third,
          year_id: year,
          batch_id: '019a0000-0000-7000-8000-000000001125',
          kind: 'temporary',
          all_subjects: true,
          start_date: '2026-11-19',
          end_date: '2026-11-19',
          category: 'illness',
          detail: 'A certificate from the clinic',
          granted_by: teacher,
          granted_at: new Date(0),
          version: 0,
          changed_at: new Date(0),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
    await at(migrator, BEFORE, async (transaction) => {
      await transaction
        .updateTable('journal_cells')
        .set({ score: null, changed_by: teacher, changed_how: 'exemption' })
        .where('id', '=', exemptCell)
        .execute();
      await transaction
        .insertInto('exemption_clears')
        .values({
          branch_id: branch,
          exemption_id: exemption,
          cell_id: exemptCell,
          lesson_id: lessons.open,
          student_id: third,
          score: 2,
          cleared_version: 3,
        })
        .execute();
    });

    // A void of a number (as a leaving's void writes it; the status row is the student's own).
    const status = await migrator
      .selectFrom('student_statuses')
      .select('id')
      .where('student_id', '=', second)
      .executeTakeFirstOrThrow();
    await migrator
      .insertInto('journal_voids')
      .values({
        branch_id: branch,
        student_id: first,
        leaving_id: status.id,
        cell_id: cells.locked,
        score: 17,
        version: 2,
        reason: 'Left for another school',
        voided_by: teacher,
        voided_at: new Date(BEFORE),
      })
      .execute();

    // A refusal of each kind, one of a score of 1500 (no upper bound on what was sent).
    // The journal of a refusal has no key to the journals (0131); the fixture has none.
    journal = '019a0000-0000-7000-8000-000000011250';
    quarter = quarters[0] ?? '';
    const refused = {
      branch_id: branch,
      journal_id: journal,
      student_id: first,
      code: 'cell_above_total',
      account_id: teacher,
      refused_at: new Date(BEFORE),
    };
    await at(migrator, BEFORE, (transaction) =>
      transaction
        .insertInto('journal_save_refusals')
        .values([
          {
            ...refused,
            kind: 'score',
            lesson_id: lessons.open,
            work_id: works.open,
            value_sent: 1500,
          },
          { ...refused, kind: 'attendance', lesson_id: lessons.open, value_sent: 2 },
          { ...refused, kind: 'rating', quarter_id: quarter, value_sent: 75, entry_kind: 'score' },
        ])
        .execute(),
    );

    // Digest entries: one sent with a score and total, one removed. Its link is a fixture of
    // its own (the link's guard of parent accounts is lifted for its insert only).
    await sql`alter table telegram_links disable trigger user`.execute(migrator);
    const link = await migrator
      .insertInto('telegram_links')
      .values({ account_id: teacher, telegram_user_id: 1125, linked_at: new Date(BEFORE) })
      .returning('id')
      .executeTakeFirstOrThrow();
    await sql`alter table telegram_links enable trigger user`.execute(migrator);
    const digest = await migrator
      .insertInto('digests')
      .values({
        account_id: teacher,
        digest_date: '2026-11-20',
        telegram_link_id: link.id,
        due_at: new Date(BEFORE),
        next_try_at: new Date(BEFORE),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    digestId = digest.id;
    const entry = {
      digest_id: digest.id,
      account_id: teacher,
      student_id: first,
      kind: 'score',
      subject_id: kit.subject,
      lesson_date: '2026-11-19',
    };
    await migrator
      .insertInto('digest_entries')
      .values([
        {
          ...entry,
          source_id: cells.open,
          state: 'new',
          sent_score: 5,
          sent_total: 5,
          sent_version: 2,
        },
        { ...entry, source_id: cells.cleared, state: 'removed' },
      ])
      .execute();

    // Quarter 1 closed, and the lesson of 10 November locked (5 edit days at 20 November).
    await closeQuarter(database, { branchId: branch, quarterId: quarter, accountId: teacher });
    await setEditDays(migrator, branch, 5);


    // A forced-delete store written before the switch: its cell and work hold whole numbers.
    storeBefore = await kept(database.migrator, branch, teacher, lessons.open, {
      score: 4,
      total: 5,
    });

    before = await snapshot(migrator);
    await copyFile(path.join(MIGRATIONS, SWITCH), path.join(directory, SWITCH));
    await migrate({ connectionString: database.migrationUrl, directory });
    await rm(directory, { recursive: true, force: true });
  }, 120_000);

  afterAll(async () => {
    await database.destroy();
  });

  it('changes no value and nothing else of any row: 8 stays 8, nulls stay, versions, moments, history, reports, the audit log', async () => {
    expect(await snapshot(database.migrator)).toEqual(before);
    const stored = await database.migrator
      .selectFrom('journal_cells')
      .select(['id', 'score'])
      .where('id', 'in', [cells.closed, cells.locked, cells.open, cells.cleared])
      .execute();
    expect(new Map(stored.map((one) => [one.id, one.score]))).toEqual(
      new Map([
        [cells.closed, 8],
        [cells.locked, 17],
        [cells.open, 5],
        [cells.cleared, null],
      ]),
    );
    const sent = await database.migrator
      .selectFrom('journal_save_refusals')
      .select('value_sent')
      .where('kind', '=', 'score')
      .executeTakeFirstOrThrow();
    expect(sent.value_sent).toBe(1500);
  });

  it('leaves no twin, mirror trigger or mirror function behind, and gives each column its exact type', async () => {
    const twins = await sql<{ name: string }>`
      select table_name || '.' || column_name as name from information_schema.columns
      where table_schema = 'public' and column_name like '%\\_exact'
    `.execute(database.migrator);
    expect(twins.rows).toEqual([]);
    const mirrors = await sql<{ name: string }>`
      select tgname::text as name from pg_trigger where tgname like '%exact_mirror%'
      union all
      select proname::text from pg_proc where proname like '%exact_mirror%'
    `.execute(database.migrator);
    expect(mirrors.rows).toEqual([]);
    for (const [table, column, type] of COLUMNS) {
      const { rows } = await sql<{ type: string }>`
        select format_type(atttypid, atttypmod) as type from pg_attribute
        where attrelid = ${table}::regclass and attname = ${column} and not attisdropped
      `.execute(database.migrator);
      expect(rows.map((one) => one.type), `${table}.${column}`).toEqual([type]);
    }
    // The partitions of the history tables follow their parent.
    const partitions = await sql<{ type: string }>`
      select distinct format_type(a.atttypid, a.atttypmod) as type
      from pg_inherits i join pg_attribute a on a.attrelid = i.inhrelid
      where i.inhparent in ('journal_cell_history'::regclass, 'journal_work_history'::regclass)
        and a.attname in ('score_before', 'score_after', 'total_before', 'total_after')
        and not a.attisdropped
    `.execute(database.migrator);
    expect(partitions.rows).toEqual([{ type: 'work_amount' }]);
  });

  it('keeps the checks under their old names, valid, and none under a twin name', async () => {
    for (const [table, name] of CHECKS) {
      const { rows } = await sql<{ valid: boolean }>`
        select convalidated as valid from pg_constraint
        where conrelid = ${table}::regclass and conname = ${name}
      `.execute(database.migrator);
      expect(rows, name).toEqual([{ valid: true }]);
    }
    const left = await sql<{ name: string }>`
      select conname::text as name from pg_constraint where conname like '%\\_exact\\_check'
    `.execute(database.migrator);
    expect(left.rows).toEqual([]);
  });

  it('refuses through the checks and the domain what they refuse: a total of 0, a score with no work, three decimals', async () => {
    const alone = (table: string, set: string, where: string) =>
      refusal(
        database.migrator.transaction().execute(async (transaction) => {
          await sql`alter table ${sql.table(table)} disable trigger user`.execute(transaction);
          await sql.raw(`update ${table} set ${set} where ${where}`).execute(transaction);
          throw new Error(`The write of ${table} was taken.`);
        }),
      );
    expect((await alone('journal_works', 'total = 0', `id = '${works.open}'`)).message).toMatch(
      /journal_works_total_check/,
    );
    expect((await alone('journal_cells', 'score = 1', 'work_id is null')).message).toMatch(
      /journal_cells_attendance_check/,
    );
    expect(
      (await alone('journal_cells', 'not_graded = true', `id = '${cells.open}'`))
        .message,
    ).toMatch(/journal_cells_not_graded_check/);
    expect((await alone('exemption_clears', 'score = null', 'mark is null')).message).toMatch(
      /exemption_clears_value_check/,
    );
    expect(
      (await alone('digest_entries', 'sent_score = 1', `state = 'removed'`)).message,
    ).toMatch(/digest_entries_removed_check/);
    expect((await alone('journal_cells', 'score = 4.555', `id = '${cells.open}'`)).message).toMatch(
      /work_amount_check/,
    );
    const { rows } = await sql<{ count: number }>`
      select count(*)::int as count from pg_trigger where not tgisinternal and tgenabled <> 'O'
    `.execute(database.migrator);
    expect(rows[0]?.count).toBe(0);
  });

  it('keeps the rights of the application on each column, and on the store readers for it alone', async () => {
    for (const [table, column] of COLUMNS) {
      const { rows } = await sql<{ select: boolean; insert: boolean }>`
        select has_column_privilege('sodiq_app', ${table}, ${column}, 'SELECT') as select,
          has_column_privilege('sodiq_app', ${table}, ${column}, 'INSERT') as insert
      `.execute(database.migrator);
      expect(rows[0], `${table}.${column}`).toEqual({ select: true, insert: true });
    }
    const updates = await sql<{ cells: boolean; works: boolean }>`
      select has_column_privilege('sodiq_app', 'journal_cells', 'score', 'UPDATE') as cells,
        has_column_privilege('sodiq_app', 'journal_works', 'total', 'UPDATE') as works
    `.execute(database.migrator);
    expect(updates.rows[0]).toEqual({ cells: true, works: true });
    for (const name of ['forced_store_cells', 'forced_store_works']) {
      const { rows } = await sql<{ app: boolean; open: boolean; type: string }>`
        select has_function_privilege('sodiq_app', p.oid, 'EXECUTE') as app,
          exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as open,
          pg_get_function_result(p.oid) as type
        from pg_proc p where p.proname = ${name}
      `.execute(database.migrator);
      expect(rows.length, name).toBe(1);
      expect(rows[0]).toMatchObject({ app: true, open: false });
      expect(rows[0]?.type).toMatch(/(score|total) work_amount/);
    }
  });

  it('reads a store written before the switch (whole numbers) and one written after it (7.5)', async () => {
    const storeAfter = await kept(database.migrator, branch, teacher, lessons.open, {
      score: 7.5,
      total: 7.5,
    });
    const read = async (store: string) => {
      const cells = await sql<{ score: number }>`
        select c.score from forced_deletes f cross join lateral forced_store_cells(f) c
        where f.id = ${store}
      `.execute(database.migrator);
      const works = await sql<{ total: number }>`
        select w.total from forced_deletes f cross join lateral forced_store_works(f) w
        where f.id = ${store}
      `.execute(database.migrator);
      return [cells.rows.map((one) => one.score), works.rows.map((one) => one.total)];
    };
    expect(await read(storeBefore)).toEqual([[4], [5]]);
    expect(await read(storeAfter)).toEqual([[7.5], [7.5]]);
  });

  // Written on the pooled connection that wrote the fixture before the switch, as a running
  // version writes across the deploy: without the recompile at the end of 0189, its cached
  // trigger functions still hold `score` as `integer` and the write fails ("type of parameter …
  // does not match that when preparing the plan").
  it('keeps a number of 7.5 written after the switch as 7.5, with its history line, on a session that wrote before it', async () => {
    await at(database.migrator, AFTER, (transaction: Transaction) =>
      transaction
        .updateTable('journal_cells')
        .set({ score: 4.5, changed_by: teacher, changed_how: 'entry' })
        .where('id', '=', cells.open)
        .execute(),
    );
    const cell = await database.migrator
      .selectFrom('journal_cells')
      .select(['score', sql<string>`score::text`.as('text')])
      .where('id', '=', cells.open)
      .executeTakeFirstOrThrow();
    expect(cell).toEqual({ score: 4.5, text: '4.5' });
    const line = await database.migrator
      .selectFrom('journal_cell_history')
      .select(['score_before', 'score_after'])
      .where('cell_id', '=', cells.open)
      .where('changed_at', '=', new Date(AFTER))
      .executeTakeFirstOrThrow();
    expect(line).toEqual({ score_before: 5, score_after: 4.5 });
  });
});

/**
 * A forced-delete store of one cell and one work, as the forced delete keeps them
 * (`forced_deletes.rows`: the rows of the lesson as `to_jsonb` writes them).
 */
async function kept(
  migrator: Database,
  branch: string,
  teacher: string,
  lesson: string,
  values: { score: number; total: number },
): Promise<string> {
  const work = '019a0000-0000-7000-8000-0000000' + String(Math.round(values.total * 100)).padStart(5, '0');
  const row = await at(migrator, BEFORE, (transaction: Transaction) =>
    transaction
      .insertInto('forced_deletes')
      .values({
        branch_id: branch,
        record_type: 'lesson',
        record_id: lesson,
        reason: 'Entered for the wrong class',
        deleted_by: teacher,
        deleted_at: new Date(BEFORE),
        restore_until: new Date('2026-12-20T12:00:00+05:00'),
        rows: JSON.stringify({
          cells: [
            {
              id: work.replace(/.$/, 'c'),
              student_id: teacher,
              work_id: work,
              mark: null,
              score: values.score,
              version: 1,
              changed_by: teacher,
              changed_how: 'entry',
              changed_at: BEFORE,
            },
          ],
          works: [
            {
              id: work,
              kind: 'classwork',
              total: values.total,
              not_held: false,
              source_lesson_id: lesson,
              plan_work_id: null,
              position: 1,
              carried_from_lesson_id: null,
              version: 1,
              changed_by: teacher,
              changed_how: 'entry',
              changed_at: BEFORE,
            },
          ],
        }),
      })
      .returning('id')
      .executeTakeFirstOrThrow(),
  );
  return row.id;
}
