import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const UNIQUE_VIOLATION = '23505';

const NOW = '2026-10-15T10:00:00+05:00';

async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// The plans follow the timetable in the database (task 7.1b, pull request #213;
// db/migrations/0115): the marks the triggers write for the follow before the
// commit, the journal of a lesson read in the year whose dates hold it, nothing
// marked by the migrator or by a change of a student, and one prepared request
// per plan. The follow itself is not registered here (no plans module), so the
// marks stay for the test to read. Invented names.
describe('the follow of the plans in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let classes: ClassesKit;
  let north: string;
  let branches = 0;
  const yearIn = (branch: string) => classes.year(branch);

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** The journals marked by the transaction so far. */
  const marksOf = async (transaction: Transaction) =>
    (
      await sql<{ journal_id: string }>`
        select distinct journal_id from lesson_plan_follow_marks
        where written_xact = pg_current_xact_id_if_assigned()
        order by journal_id
      `.execute(transaction)
    ).rows.map((row) => row.journal_id);

  /** A class journal of a graded subject in a year, with a plan of its first quarter. */
  async function planned(branch: string, year: string) {
    const subject = await classes.subject({ grades: [7], journalType: 'graded' });
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
    // Task 7.2: the journal's plan records are made with it (0117).
    const plan = await database.migrator
      .selectFrom('lesson_plan_journals')
      .select('plan_id as id')
      .where('journal_id', '=', journal.id)
      .where('quarter_id', '=', quarter.id)
      .executeTakeFirstOrThrow();
    return { classId, subject, journal: journal.id, quarter: quarter.id, plan: plan.id };
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    const clock = new FixedClock(NOW);
    transactions = new Transactions(database.app, clock);
    classes = new ClassesKit(database.migrator);
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('reads the journal of a lesson in the year whose dates hold its date', async () => {
    const year = await yearIn(
      (north = await insertBranch(database.migrator, `North ${String((branches += 1))}`)),
    );
    const dates = await database.migrator
      .selectFrom('academic_years')
      .select([sql<string>`start_date::text`.as('start'), sql<string>`end_date::text`.as('end')])
      .where('id', '=', year)
      .executeTakeFirstOrThrow();
    const unit = await planned(north, year);
    const found = await sql<{ journal_id: string }>`
      select journal_id from lesson_plan_journals_of_lessons(
        array[${north}::uuid, ${north}::uuid], array[${unit.classId}::uuid, ${unit.classId}::uuid],
        array[null::uuid, null::uuid], array[${unit.subject}::uuid, ${unit.subject}::uuid],
        array[${dates.start}::date, (${dates.end}::date + 1)]
      )
    `.execute(database.migrator);
    // The day after the year's end is in no year of the journal.
    expect(found.rows.map((row) => row.journal_id)).toEqual([unit.journal]);
  });

  it("marks every journal with a plan of a year when a quarter's dates change, and nothing when they stay", async () => {
    const year = await yearIn(
      (north = await insertBranch(database.migrator, `North ${String((branches += 1))}`)),
    );
    const unit = await planned(north, year);
    const other = await planned(north, year);
    await database.migrator
      .updateTable('quarters')
      .set({ start_date: '2026-09-01', end_date: '2026-10-31' })
      .where('id', '=', unit.quarter)
      .execute();
    const rolledBack = new Error('rolled back');
    const seen: string[][] = [];
    await inBranch(north, async (transaction) => {
      await sql`update quarters set end_date = end_date where id = ${unit.quarter}`.execute(
        transaction,
      );
      seen.push(await marksOf(transaction));
      await sql`update quarters set end_date = end_date - 1 where id = ${unit.quarter}`.execute(
        transaction,
      );
      seen.push(await marksOf(transaction));
      throw rolledBack;
    }).catch((error: unknown) => {
      if (error !== rolledBack) throw error;
    });
    expect(seen[0]).toEqual([]);
    expect(seen[1]).toEqual([unit.journal, other.journal].sort());
  });

  /** Runs `work` as the application, reads the marks, and rolls back. */
  async function marksAfter(branch: string, work: (transaction: Transaction) => Promise<unknown>) {
    const rolledBack = new Error('rolled back');
    let marks: string[] = [];
    await inBranch(branch, async (transaction) => {
      await work(transaction);
      marks = await marksOf(transaction);
      throw rolledBack;
    }).catch((error: unknown) => {
      if (error !== rolledBack) throw error;
    });
    return marks;
  }

  it('marks the journal whose runs a publish changes, and nothing when they stay', async () => {
    const year = await yearIn(
      (north = await insertBranch(database.migrator, `North ${String((branches += 1))}`)),
    );
    const unit = await planned(north, year);
    expect(
      await marksAfter(north, (transaction) =>
        sql`update journals set runs = runs where id = ${unit.journal}`.execute(transaction),
      ),
    ).toEqual([]);
    expect(
      await marksAfter(north, (transaction) =>
        sql`update journals set runs = '{[2026-09-07,2026-12-01)}' where id = ${unit.journal}`.execute(
          transaction,
        ),
      ),
    ).toEqual([unit.journal]);
  });

  it('marks the journals a person acts for when their status or branch link changes (personOutOf)', async () => {
    const year = await yearIn(
      (north = await insertBranch(database.migrator, `North ${String((branches += 1))}`)),
    );
    const unit = await planned(north, year);
    const other = await planned(north, year);
    const load = new LoadKit(database.migrator);
    const vacancy = await load.vacancy(north, {
      subjects: [{ subject: unit.subject, grades: [7] }],
    });
    const person = await load.teacher(north, {
      subjects: [{ subject: unit.subject, grades: [7] }],
    });
    await database.migrator
      .insertInto('journal_acting_teachers')
      .values({
        branch_id: north,
        journal_id: unit.journal,
        vacancy_id: vacancy,
        person_id: person.staffId,
        valid_from: '2026-09-07',
        valid_until: null,
        given_by: await classes.account(),
      })
      .execute();
    expect(
      await marksAfter(north, (transaction) =>
        transaction
          .updateTable('staff_statuses')
          .set({ valid_until: '2027-06-01' })
          .where('staff_id', '=', person.staffId)
          .execute(),
      ),
    ).toEqual([unit.journal]);
    expect(
      await marksAfter(north, (transaction) =>
        transaction
          .deleteFrom('staff_branches')
          .where('staff_id', '=', person.staffId)
          .where('branch_id', '=', north)
          .execute(),
      ),
    ).toEqual([unit.journal]);
    // The other journal has no acting period of the person.
    expect(other.journal).not.toBe(unit.journal);
  });

  it('marks nothing for a write of the migrator', async () => {
    const year = await yearIn(
      (north = await insertBranch(database.migrator, `North ${String((branches += 1))}`)),
    );
    const unit = await planned(north, year);
    await database.migrator.transaction().execute(async (transaction) => {
      await sql`update journals set runs = '{[2026-09-07,2026-12-01)}' where id = ${unit.journal}`.execute(
        transaction,
      );
      const marks = await sql<{ count: number }>`
        select count(*)::int as count from lesson_plan_follow_marks
        where written_xact = pg_current_xact_id_if_assigned()
      `.execute(transaction);
      expect(marks.rows[0]?.count).toBe(0);
    });
  });

  it('has no mark on the tables of students, their classes and groups, or exemptions (09: "A student is transferred or exempt: No effect")', async () => {
    const triggers = await sql<{ table: string }>`
      select c.relname as table from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and t.tgname like 'lesson_plan_mark%'
      order by 1
    `.execute(database.migrator);
    // Task 7.1c (plan review of #214, correction 1): a class's language or
    // grade and a group's language or classes mark the journals of the shared
    // plans they take part in; no student, membership or exemption table.
    expect([...new Set(triggers.rows.map((row) => row.table))]).toEqual([
      'classes',
      'group_classes',
      'groups',
      'journal_acting_teachers',
      'journals',
      'lessons',
      'quarters',
      'staff_branches',
      'staff_statuses',
      'timetable_versions',
    ]);
  });

  it('keeps one prepared request per plan and journal', async () => {
    const year = await yearIn(
      (north = await insertBranch(database.migrator, `North ${String((branches += 1))}`)),
    );
    const unit = await planned(north, year);
    const prepare = () =>
      inBranch(north, (transaction) =>
        transaction
          .insertInto('lesson_plan_requests')
          .values({
            branch_id: north,
            plan_id: unit.plan,
            journal_id: unit.journal,
            quarter_id: unit.quarter,
            kind: 'replan',
            status: 'prepared',
            from_date: '2026-10-19',
            prepared_at: new Date(NOW),
            updated_at: new Date(NOW),
          })
          .execute(),
      );
    await prepare();
    const refused = await refusal(prepare());
    expect(refused.code).toBe(UNIQUE_VIOLATION);
    expect(refused.constraint).toBe('lesson_plan_requests_prepared_idx');
  });
});
