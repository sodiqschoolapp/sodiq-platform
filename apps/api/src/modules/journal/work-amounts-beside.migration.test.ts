import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../database/database.js';
import { migrate } from '../../database/migrate.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
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
const BESIDE = '0188_work_amounts_beside.sql';
/** The moment of the writes before the migration. */
const BEFORE = '2026-11-20T12:00:00+05:00';
/** The moment of the writes after it, as the application writes them. */
const AFTER = '2026-11-20T13:00:00+05:00';

/** Every column of 0188 with its twin. */
const TWINS: readonly (readonly [table: string, column: string])[] = [
  ['journal_cells', 'score'],
  ['journal_works', 'total'],
  ['journal_cell_history', 'score_before'],
  ['journal_cell_history', 'score_after'],
  ['journal_work_history', 'total_before'],
  ['journal_work_history', 'total_after'],
  ['journal_voids', 'score'],
  ['exemption_clears', 'score'],
  ['journal_save_refusals', 'value_sent'],
  ['digest_entries', 'sent_score'],
  ['digest_entries', 'sent_total'],
];
const TABLES = [...new Set(TWINS.map(([table]) => table))];

/**
 * The twins of 0188, which 0189 (task 11.25b) renames into the old names: the generated types
 * describe the schema after 0189, and this file reads a database migrated to 0188 only.
 */
type BesideTwins = {
  journal_cells: { score_exact: number | null };
  journal_save_refusals: { value_sent_exact: number | null };
  digest_entries: { sent_score_exact: number | null; sent_total_exact: number | null };
  journal_cell_history: { score_before_exact: number | null; score_after_exact: number | null };
  journal_work_history: { total_before_exact: number | null; total_after_exact: number | null };
};

const twins = (migrator: Database) => migrator.withTables<BesideTwins>();

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

/** The rows of the tables 0188 fills, every column but the twins, in a stable order. */
async function snapshot(migrator: Database): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};
  for (const table of [...TABLES, 'audit_log', 'report_changes']) {
    const exists = await sql<{ found: string | null }>`
      select to_regclass(${table})::text as found
    `.execute(migrator);
    if (exists.rows[0]?.found === null) throw new Error(`No table ${table}.`);
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

/** The rows whose twin differs from its column, per column. */
async function differing(migrator: Database): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const [table, column] of TWINS) {
    const { rows } = await sql<{ count: number }>`
      select count(*)::int as count from ${sql.table(table)}
      where ${sql.ref(`${column}_exact`)} is distinct from ${sql.ref(column)}
    `.execute(migrator);
    result[`${table}.${column}`] = rows[0]?.count ?? -1;
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

// Task 11.25a (pull request #395; Done when): "every twin equals its old column after the
// migration; nothing else of any row changed (versions, moments, history, reports, the audit
// log); the user triggers are on again in every partition; a write of each kind afterwards keeps
// the twins equal." The rows are written as the code before 0188 wrote them: a cell with a score,
// a cleared one, a cell in a closed quarter and one of a locked lesson, works with a total and
// "not held", their history, a void, an exemption clear, a refusal of each kind (a score of 1500
// among them, review correction 1) and digest entries. Names are invented.
describe('migration 0188 puts an exact twin beside every work score and total', () => {
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
  let appCell: string;
  let before: Record<string, unknown[]>;

  beforeAll(async () => {
    database = await createTestDatabase({ empty: true });
    directory = await mkdtemp(path.join(tmpdir(), 'sodiq-work-amounts-'));
    for (const name of (await readdir(MIGRATIONS)).filter((one) => one.endsWith('.sql'))) {
      if (name < BESIDE) await copyFile(path.join(MIGRATIONS, name), path.join(directory, name));
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

    before = await snapshot(migrator);
    // 0188 alone (task 11.25b): 0189 drops the twins this file reads.
    await copyFile(path.join(MIGRATIONS, BESIDE), path.join(directory, BESIDE));
    await migrate({ connectionString: database.migrationUrl, directory });
    await rm(directory, { recursive: true, force: true });
  }, 120_000);

  afterAll(async () => {
    await database.destroy();
  });

  it('has a row with a value behind every twin', async () => {
    for (const [table, column] of TWINS) {
      const { rows } = await sql<{ count: number }>`
        select count(*)::int as count from ${sql.table(table)} where ${sql.ref(column)} is not null
      `.execute(database.migrator);
      expect(rows[0]?.count, `${table}.${column}`).toBeGreaterThan(0);
    }
  });

  it('fills every twin with the value of its column, 8 as 8 and nulls as nulls', async () => {
    expect(Object.values(await differing(database.migrator)).every((count) => count === 0)).toBe(
      true,
    );
    const stored = await twins(database.migrator)
      .selectFrom('journal_cells')
      .select(['id', 'score', 'score_exact'])
      .where('id', 'in', [cells.closed, cells.locked, cells.open, cells.cleared])
      .execute();
    expect(new Map(stored.map((one) => [one.id, [one.score, one.score_exact]]))).toEqual(
      new Map([
        [cells.closed, [8, 8]],
        [cells.locked, [17, 17]],
        [cells.open, [5, 5]],
        [cells.cleared, [null, null]],
      ]),
    );
    const refusal1500 = await twins(database.migrator)
      .selectFrom('journal_save_refusals')
      .select('value_sent_exact')
      .where('kind', '=', 'score')
      .executeTakeFirstOrThrow();
    expect(refusal1500.value_sent_exact).toBe(1500);
  });

  it('changes nothing else of any row: versions, moments, history, reports, the audit log', async () => {
    // The fixture holds rows of the history, the reports and the audit log to compare.
    expect(before.journal_cell_history?.length).toBeGreaterThan(0);
    expect(before.journal_work_history?.length).toBeGreaterThan(0);
    expect(before.report_changes?.length).toBeGreaterThan(0);
    expect(await snapshot(database.migrator)).toEqual(before);
  });

  it('turns the user triggers on again, in every partition', async () => {
    const { rows } = await sql<{ name: string }>`
      select c.relname || '.' || t.tgname as name
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and t.tgenabled <> 'O'
    `.execute(database.migrator);
    expect(rows).toEqual([]);
    // The read above reaches the partitions: they carry the user triggers of their parents.
    const cloned = await sql<{ count: number }>`
      select count(*)::int as count
      from pg_trigger t
      join pg_inherits i on i.inhrelid = t.tgrelid
      join pg_class p on p.oid = i.inhparent
      where not t.tgisinternal
        and p.relname in ('journal_cell_history', 'journal_work_history', 'journal_save_refusals')
    `.execute(database.migrator);
    expect(cloned.rows[0]?.count).toBeGreaterThan(0);
  });

  it('holds every twin of a score or total in the domain work_amount, and the refusal as sent in numeric', async () => {
    const { rows } = await sql<{ name: string; domain: string | null; type: string }>`
      select table_name || '.' || column_name as name, domain_name as domain, data_type as type
      from information_schema.columns
      where table_schema = 'public' and column_name like '%\\_exact'
        and table_name in (${sql.join(TABLES)})
      order by 1
    `.execute(database.migrator);
    expect(rows).toEqual(
      [...TWINS]
        .map(([table, column]) => ({
          name: `${table}.${column}_exact`,
          domain: table === 'journal_save_refusals' ? null : 'work_amount',
          type: 'numeric',
        }))
        .sort((a, b) => (a.name < b.name ? -1 : 1)),
    );
  });

  it('refuses three decimals, a value below 0 and one above 1000, and takes two decimals', async () => {
    const cast = (value: string) =>
      sql<{ value: number }>`select ${value}::work_amount as value`.execute(database.migrator);
    for (const value of ['7.555', '-1', '1000.01', '-0.5']) {
      expect((await refusal(cast(value))).message, value).toMatch(/work_amount_check/);
    }
    for (const [value, read] of [
      ['7.5', 7.5],
      ['8.25', 8.25],
      ['1000', 1000],
      ['0', 0],
    ] as const) {
      expect((await cast(value)).rows[0]?.value).toBe(read);
    }
  });

  it('refuses through the twin checks what the old checks refuse', async () => {
    // The mirror writes the twin from its column on every write, so a twin is written alone
    // here with the table's user triggers off, in a transaction that is rolled back.
    const alone = (table: string, set: string, where: string) =>
      refusal(
        database.migrator.transaction().execute(async (transaction) => {
          await sql`alter table ${sql.table(table)} disable trigger user`.execute(transaction);
          await sql.raw(`update ${table} set ${set} where ${where}`).execute(transaction);
          // Never committed: the triggers must not stay off when the write is taken.
          throw new Error(`The write of ${table} was taken.`);
        }),
      );
    expect(
      (await alone('journal_works', 'total_exact = 0', `id = '${works.open}'`)).message,
    ).toMatch(/journal_works_total_exact_check/);
    expect((await alone('journal_cells', 'score_exact = 1', `work_id is null`)).message).toMatch(
      /journal_cells_attendance_exact_check/,
    );
    expect(
      (
        await alone(
          'journal_cells',
          'score = null, not_graded = true, score_exact = 1',
          `id = '${cells.open}'`,
        )
      ).message,
    ).toMatch(/journal_cells_not_graded_exact_check/);
    expect((await alone('exemption_clears', 'score_exact = null', 'mark is null')).message).toMatch(
      /exemption_clears_value_exact_check/,
    );
    expect(
      (await alone('digest_entries', 'sent_score_exact = 1', `state = 'removed'`)).message,
    ).toMatch(/digest_entries_removed_exact_check/);
    // Every trigger is on again after the rolled-back transactions.
    const { rows } = await sql<{ count: number }>`
      select count(*)::int as count from pg_trigger where not tgisinternal and tgenabled <> 'O'
    `.execute(database.migrator);
    expect(rows[0]?.count).toBe(0);
  });

  describe('a write after the migration, as the application writes it', () => {
    beforeAll(async () => {
      const migrator = database.migrator;
      const [, second, third] = students as [string, string, string];
      await at(migrator, AFTER, async (transaction) => {
        // A total changed, a number typed again, a cleared cell typed, a new number.
        await transaction
          .updateTable('journal_works')
          .set({ total: 6, changed_by: teacher, changed_how: 'entry' })
          .where('id', '=', works.open)
          .execute();
        await transaction
          .updateTable('journal_cells')
          .set({ score: 6, changed_by: teacher, changed_how: 'entry' })
          .where('id', '=', cells.open)
          .execute();
        await transaction
          .updateTable('journal_cells')
          .set({ score: 1, changed_by: teacher, changed_how: 'entry' })
          .where('id', '=', cells.cleared)
          .execute();
        await transaction
          .insertInto('journal_works')
          .values({
            branch_id: branch,
            lesson_id: lessons.open,
            source_lesson_id: lessons.open,
            kind: 'homework',
            position: 1,
            title: 'Exercise at home',
            total: 12,
            changed_by: teacher,
            changed_how: 'entry',
          })
          .execute();
      });
      // The number of the second student cleared by an exemption, kept in its clear.
      await at(migrator, AFTER, async (transaction) => {
        await transaction
          .updateTable('journal_cells')
          .set({ score: null, changed_by: teacher, changed_how: 'exemption' })
          .where('id', '=', cells.cleared)
          .execute();
        await transaction
          .insertInto('exemption_clears')
          .values({
            branch_id: branch,
            exemption_id: exemption,
            cell_id: cells.cleared,
            lesson_id: lessons.open,
            student_id: second,
            score: 1,
            cleared_version: 6,
          })
          .execute();
      });
      const status = await migrator
        .selectFrom('student_statuses')
        .select('id')
        .where('student_id', '=', third)
        .executeTakeFirstOrThrow();
      await migrator
        .insertInto('journal_voids')
        .values({
          branch_id: branch,
          student_id: third,
          leaving_id: status.id,
          cell_id: cells.open,
          score: 6,
          version: 7,
          reason: 'Left for another school',
          voided_by: teacher,
          voided_at: new Date(AFTER),
        })
        .execute();
      await at(migrator, AFTER, (transaction) =>
        transaction
          .insertInto('journal_save_refusals')
          .values({
            branch_id: branch,
            journal_id: journal,
            student_id: third,
            kind: 'score',
            lesson_id: lessons.open,
            work_id: works.open,
            value_sent: 2500,
            code: 'cell_above_total',
            account_id: teacher,
            refused_at: new Date(AFTER),
          })
          .execute(),
      );
      // A first save of a number and a digest entry sent for it, as the running version writes
      // them: inserts, as the application role, in a transaction of the branch.
      const [first] = students as [string];
      await new Transactions(database.app, new FixedClock(AFTER)).run(
        [branch],
        async (transaction) => {
          const homework = await transaction
            .selectFrom('journal_works')
            .select('id')
            .where('lesson_id', '=', lessons.open)
            .where('kind', '=', 'homework')
            .executeTakeFirstOrThrow();
          const cell = await transaction
            .insertInto('journal_cells')
            .values({
              branch_id: branch,
              lesson_id: lessons.open,
              student_id: first,
              work_id: homework.id,
              score: 9,
              version: 1,
              changed_by: teacher,
              changed_how: 'entry',
              changed_at: new Date(AFTER),
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          appCell = cell.id;
          // The audit entry the save writes in its transaction (lesson_change_unaudited).
          await heldEntry(transaction, branch);
          await transaction
            .insertInto('digest_entries')
            .values({
              digest_id: digestId,
              account_id: teacher,
              student_id: first,
              kind: 'score',
              source_id: cell.id,
              subject_id: null,
              lesson_date: '2026-11-19',
              state: 'new',
              sent_score: 9,
              sent_total: 12,
              sent_version: 1,
            })
            .execute();
        },
      );
    }, 60_000);

    it('keeps every twin equal to its column, for an insert, an update and a clear', async () => {
      expect(await differing(database.migrator)).toEqual(
        Object.fromEntries(TWINS.map(([table, column]) => [`${table}.${column}`, 0])),
      );
      const cleared = await twins(database.migrator)
        .selectFrom('journal_cells')
        .select(['score', 'score_exact'])
        .where('id', '=', cells.cleared)
        .executeTakeFirstOrThrow();
      expect(cleared).toEqual({ score: null, score_exact: null });
      const inserted = await twins(database.migrator)
        .selectFrom('journal_cells')
        .select(['score', 'score_exact'])
        .where('id', '=', appCell)
        .executeTakeFirstOrThrow();
      expect(inserted).toEqual({ score: 9, score_exact: 9 });
      const sent = await twins(database.migrator)
        .selectFrom('digest_entries')
        .select(['sent_score_exact', 'sent_total_exact'])
        .where('source_id', '=', appCell)
        .executeTakeFirstOrThrow();
      expect(sent).toEqual({ sent_score_exact: 9, sent_total_exact: 12 });
      const history = await twins(database.migrator)
        .selectFrom('journal_cell_history')
        .select(['score_before_exact', 'score_after_exact'])
        .where('cell_id', '=', cells.open)
        .where('changed_at', '=', new Date(AFTER))
        .executeTakeFirstOrThrow();
      expect(history).toEqual({ score_before_exact: 5, score_after_exact: 6 });
      const total = await twins(database.migrator)
        .selectFrom('journal_work_history')
        .select(['total_before_exact', 'total_after_exact'])
        .where('work_id', '=', works.open)
        .where('total_after', '=', 6)
        .executeTakeFirstOrThrow();
      expect(total).toEqual({ total_before_exact: 5, total_after_exact: 6 });
    });
  });
});
