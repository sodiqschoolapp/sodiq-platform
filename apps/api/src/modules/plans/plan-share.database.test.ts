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

// Task 7.1c, pull request #214 (db/migrations/0116): the database holds who
// shares a plan (`05`, Language of instruction: "A shared plan can join only
// classes with the same language"; `09`: classes of one grade, groups of the
// same grades), at the commit, also when a class's language or grade, a
// group's language or its classes change later (plan review, corrections 1
// and 2). The transactions here are bare (no follow before the commit), so
// nothing separates the plan and the check refuses. Invented names.
describe('shared plans in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let classes: ClassesKit;
  let north: string;
  let year: string;
  let quarter: string;

  const inBranch = <T>(work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([north], work);

  const journalOf = async (
    subject: string,
    unit: { classId: string } | { groupId: string },
  ): Promise<string> =>
    (
      await database.migrator
        .insertInto('journals')
        .values({
          branch_id: north,
          academic_year_id: year,
          class_id: 'classId' in unit ? unit.classId : null,
          group_id: 'groupId' in unit ? unit.groupId : null,
          subject_id: subject,
          runs: '{[2026-09-07,)}',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  /** The plan of a journal: task 7.2 makes the record with the journal (0117). */
  const planOf = (_subject: string, journal: string) =>
    inBranch(async (transaction) => {
      const row = await transaction
        .selectFrom('lesson_plan_journals')
        .select('plan_id')
        .where('journal_id', '=', journal)
        .where('quarter_id', '=', quarter)
        .executeTakeFirstOrThrow();
      return row.plan_id;
    });

  /** A journal joins a plan as the application does: its link moves (7.1c, decision 5). */
  const link = (transaction: Transaction, plan: string, journal: string) =>
    transaction
      .updateTable('lesson_plan_journals')
      .set({ plan_id: plan })
      .where('journal_id', '=', journal)
      .where('quarter_id', '=', quarter)
      .execute();

  const join = (plan: string, journal: string) =>
    inBranch((transaction) => link(transaction, plan, journal));

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    classes = new ClassesKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    year = await classes.year(north);
    quarter = (
      await database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('lets two classes of one grade and language share a plan', async () => {
    const subject = await classes.subject({ grades: [7] });
    const oxford = await classes.schoolClass(north, year, { grade: 7, language: 'uz' });
    const princeton = await classes.schoolClass(north, year, { grade: 7, language: 'uz' });
    const plan = await planOf(subject, await journalOf(subject, { classId: oxford }));
    await join(plan, await journalOf(subject, { classId: princeton }));
    const links = await database.migrator
      .selectFrom('lesson_plan_journals')
      .select('journal_id')
      .where('plan_id', '=', plan)
      .execute();
    expect(links).toHaveLength(2);
  });

  it('refuses classes of different languages one plan (the Done when of 7.1c)', async () => {
    const subject = await classes.subject({ grades: [7] });
    const oxford = await classes.schoolClass(north, year, { grade: 7, language: 'uz' });
    const princeton = await classes.schoolClass(north, year, { grade: 7, language: 'ru' });
    const plan = await planOf(subject, await journalOf(subject, { classId: oxford }));
    const refused = await refusal(join(plan, await journalOf(subject, { classId: princeton })));
    expect(refused.constraint).toBe('lesson_plan_share_language');
  });

  it('refuses classes of another grade, a class with a group, a two-grade group with a one-grade group', async () => {
    const subject = await classes.subject({ grades: [7, 8] });
    const seven = await classes.schoolClass(north, year, { grade: 7 });
    const sevenB = await classes.schoolClass(north, year, { grade: 7 });
    const eight = await classes.schoolClass(north, year, { grade: 8 });
    const plan = await planOf(subject, await journalOf(subject, { classId: seven }));
    expect(
      (await refusal(join(plan, await journalOf(subject, { classId: eight })))).constraint,
    ).toBe('lesson_plan_share_grade');
    const group = await classes.group(north, year, subject, [sevenB]);
    expect(
      (await refusal(join(plan, await journalOf(subject, { groupId: group })))).constraint,
    ).toBe('lesson_plan_share_kind');
    const twoGrades = await classes.group(north, year, subject, [
      await classes.schoolClass(north, year, { grade: 7 }),
      await classes.schoolClass(north, year, { grade: 8 }),
    ]);
    const oneGrade = await classes.group(north, year, subject, [
      await classes.schoolClass(north, year, { grade: 7 }),
    ]);
    const groupPlan = await planOf(subject, await journalOf(subject, { groupId: twoGrades }));
    expect(
      (await refusal(join(groupPlan, await journalOf(subject, { groupId: oneGrade })))).constraint,
    ).toBe('lesson_plan_share_grade');
  });

  it('refuses the commit of a class language changed while it shares a plan, and marks the journals for the follow', async () => {
    const subject = await classes.subject({ grades: [7] });
    const oxford = await classes.schoolClass(north, year, { grade: 7, language: 'uz' });
    const princeton = await classes.schoolClass(north, year, { grade: 7, language: 'uz' });
    const plan = await planOf(subject, await journalOf(subject, { classId: oxford }));
    const joined = await journalOf(subject, { classId: princeton });
    await join(plan, joined);
    const refused = await refusal(
      inBranch(async (transaction) => {
        await transaction
          .updateTable('classes')
          .set({ language: 'ru' })
          .where('id', '=', princeton)
          .execute();
        const marks = await sql<{ journal_id: string }>`
          select journal_id from lesson_plan_follow_marks
          where written_xact = pg_current_xact_id_if_assigned()
          order by journal_id
        `.execute(transaction);
        expect(marks.rows.map((row) => row.journal_id)).toContain(joined);
      }),
    );
    expect(refused.constraint).toBe('lesson_plan_share_language');
    const stored = await database.migrator
      .selectFrom('classes')
      .select('language')
      .where('id', '=', princeton)
      .executeTakeFirstOrThrow();
    expect(stored.language).toBe('uz');
  });

  it('refuses the commit of a group language changed, or a class of another grade added to a group, while it shares a plan', async () => {
    const subject = await classes.subject({ grades: [7, 8] });
    // Groups that mix an Uzbek and a Russian class, so the Academic Vice
    // Principal chooses their language (`05`, Groups).
    const mixed = async () =>
      classes.group(
        north,
        year,
        subject,
        [
          await classes.schoolClass(north, year, { grade: 7, language: 'uz' }),
          await classes.schoolClass(north, year, { grade: 7, language: 'ru' }),
        ],
        { language: 'uz' },
      );
    const first = await mixed();
    const second = await mixed();
    const plan = await planOf(subject, await journalOf(subject, { groupId: first }));
    await join(plan, await journalOf(subject, { groupId: second }));
    const language = await refusal(
      inBranch((transaction) =>
        transaction
          .updateTable('groups')
          .set({ language: 'ru' })
          .where('id', '=', second)
          .execute(),
      ),
    );
    expect(language.constraint).toBe('lesson_plan_share_language');
    const eight = await classes.schoolClass(north, year, { grade: 8 });
    const grade = await refusal(
      inBranch(async (transaction) => {
        // As the group edit writes it: the group row, then its classes.
        await transaction
          .updateTable('groups')
          .set({ name: 'Mixed' })
          .where('id', '=', second)
          .execute();
        await transaction
          .insertInto('group_classes')
          .values({ branch_id: north, group_id: second, class_id: eight })
          .execute();
      }),
    );
    expect(grade.constraint).toBe('lesson_plan_share_grade');
  });

  it('checks nothing when the class is in no shared plan', async () => {
    const subject = await classes.subject({ grades: [7] });
    const alone = await classes.schoolClass(north, year, { grade: 7, language: 'uz' });
    await planOf(subject, await journalOf(subject, { classId: alone }));
    await inBranch((transaction) =>
      transaction.updateTable('classes').set({ language: 'ru' }).where('id', '=', alone).execute(),
    );
  });

  // Code review of 7.1c, should-fix 8: each path of the guard.
  it('refuses the commit of a class grade changed while it shares a plan', async () => {
    const subject = await classes.subject({ grades: [7, 8] });
    const oxford = await classes.schoolClass(north, year, { grade: 7 });
    const princeton = await classes.schoolClass(north, year, { grade: 7 });
    const plan = await planOf(subject, await journalOf(subject, { classId: oxford }));
    await join(plan, await journalOf(subject, { classId: princeton }));
    const refused = await refusal(
      inBranch((transaction) =>
        transaction.updateTable('classes').set({ grade: 8 }).where('id', '=', princeton).execute(),
      ),
    );
    expect(refused.constraint).toBe('lesson_plan_share_grade');
  });

  it('refuses the commit of a class taken out of a two-grade group that shares a plan', async () => {
    const subject = await classes.subject({ grades: [7, 8] });
    const twoGrades = async () => {
      const eighth = await classes.schoolClass(north, year, { grade: 8 });
      const group = await classes.group(north, year, subject, [
        await classes.schoolClass(north, year, { grade: 7 }),
        eighth,
      ]);
      return { group, eighth };
    };
    const first = await twoGrades();
    const second = await twoGrades();
    const plan = await planOf(subject, await journalOf(subject, { groupId: first.group }));
    await join(plan, await journalOf(subject, { groupId: second.group }));
    const refused = await refusal(
      inBranch(async (transaction) => {
        await transaction
          .updateTable('groups')
          .set({ name: 'Seven only' })
          .where('id', '=', second.group)
          .execute();
        await transaction
          .deleteFrom('group_classes')
          .where('group_id', '=', second.group)
          .where('class_id', '=', second.eighth)
          .execute();
      }),
    );
    expect(refused.constraint).toBe('lesson_plan_share_grade');
  });

  it('refuses a link moved into a plan of another language (the update of plan_id)', async () => {
    const subject = await classes.subject({ grades: [7] });
    const oxford = await classes.schoolClass(north, year, { grade: 7, language: 'uz' });
    const princeton = await classes.schoolClass(north, year, { grade: 7, language: 'ru' });
    const plan = await planOf(subject, await journalOf(subject, { classId: oxford }));
    const joining = await journalOf(subject, { classId: princeton });
    const own = await planOf(subject, joining);
    const refused = await refusal(
      inBranch((transaction) =>
        transaction
          .updateTable('lesson_plan_journals')
          .set({ plan_id: plan })
          .where('plan_id', '=', own)
          .where('journal_id', '=', joining)
          .execute(),
      ),
    );
    expect(refused.constraint).toBe('lesson_plan_share_language');
  });
});
