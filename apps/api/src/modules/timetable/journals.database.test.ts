import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const NOW = '2026-10-15T10:00:00+05:00';
const OPEN = '{[2026-10-19,)}';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// Task 5.5c-1, pull request #155 (db/migrations/0081): edge/developer-rules,
// One journal: "Unique on (class or group, subject, academic year)." Every
// write is made as `sodiq_app` through the branch filter, with no service in
// between. All names are invented.
describe('the journals in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LessonsKit;
  let north: string;
  let south: string;
  let year: string;
  let otherYear: string;
  let subject: string;

  const inBranch = <T>(work: (transaction: Transaction) => Promise<T>, branch = north) =>
    transactions.run([branch], work);

  const insert = (
    values: {
      classId?: string | null;
      groupId?: string | null;
      subjectId?: string;
      yearId?: string;
      runs?: string;
    },
    branch = north,
  ) =>
    inBranch(
      (transaction) =>
        transaction
          .insertInto('journals')
          .values({
            branch_id: branch,
            academic_year_id: values.yearId ?? year,
            class_id: values.classId ?? null,
            group_id: values.groupId ?? null,
            subject_id: values.subjectId ?? subject,
            runs: values.runs ?? OPEN,
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      branch,
    );

  const schoolClass = (inYear = year) => kit.load.classes.schoolClass(north, inYear, { grade: 7 });

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    year = (await kit.year(north)).year;
    otherYear = await kit.load.classes.year(north, 'planned', '2027-09-01', '2028-05-31');
    subject = await kit.load.classes.subject({ grades: [7] });
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('refuses a second journal of the same class, subject and year, and allows another year', async () => {
    const oxford = await schoolClass();
    await insert({ classId: oxford });
    expect(await refusal(insert({ classId: oxford }))).toMatchObject({
      constraint: 'journals_class_key',
    });
    const planned = await schoolClass(otherYear);
    await insert({ classId: planned, yearId: otherYear });
  });

  it('refuses a second journal of the same group, subject and year', async () => {
    const oxford = await schoolClass();
    const group = await kit.load.classes.group(north, year, subject, [oxford]);
    await insert({ groupId: group });
    expect(await refusal(insert({ groupId: group }))).toMatchObject({
      constraint: 'journals_group_key',
    });
  });

  it('refuses a journal of both a class and a group, or of neither', async () => {
    const oxford = await schoolClass();
    const group = await kit.load.classes.group(north, year, subject, [oxford]);
    expect(await refusal(insert({ classId: oxford, groupId: group }))).toMatchObject({
      constraint: 'journals_unit_check',
    });
    expect(await refusal(insert({}))).toMatchObject({ constraint: 'journals_unit_check' });
  });

  it('refuses a class of another year and a group of another subject', async () => {
    const planned = await schoolClass(otherYear);
    expect(await refusal(insert({ classId: planned }))).toMatchObject({
      constraint: 'journal_unit_year',
    });
    const oxford = await schoolClass();
    const group = await kit.load.classes.group(north, year, subject, [oxford]);
    const other = await kit.load.classes.subject({ grades: [7] });
    expect(await refusal(insert({ groupId: group, subjectId: other }))).toMatchObject({
      constraint: 'journal_group_subject',
    });
  });

  it('updates the runs only: no delete, no change of unit, subject, year or branch (no grant)', async () => {
    const oxford = await schoolClass();
    const { id } = await insert({ classId: oxford });
    await inBranch((transaction) =>
      transaction
        .updateTable('journals')
        .set({ runs: '{[2026-10-19,2026-11-09)}' })
        .where('id', '=', id)
        .execute(),
    );
    const princeton = await schoolClass();
    const other = await kit.load.classes.subject({ grades: [7] });
    for (const set of [
      { class_id: princeton },
      { subject_id: other },
      { academic_year_id: otherYear },
      { branch_id: south },
    ]) {
      expect(
        await refusal(
          inBranch((transaction) =>
            transaction.updateTable('journals').set(set).where('id', '=', id).execute(),
          ),
        ),
      ).toMatchObject({ code: '42501' });
    }
    expect(
      await refusal(
        inBranch((transaction) =>
          transaction.deleteFrom('journals').where('id', '=', id).execute(),
        ),
      ),
    ).toMatchObject({ code: '42501' });
    const stored = await database.migrator
      .selectFrom('journals')
      .select(['class_id', 'subject_id', (eb) => eb.cast<string>('runs', 'text').as('runs')])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({
      class_id: oxford,
      subject_id: subject,
      runs: '{[2026-10-19,2026-11-09)}',
    });
  });

  it("hides another branch's journal through the branch filter", async () => {
    const oxford = await schoolClass();
    const { id } = await insert({ classId: oxford });
    const seen = await inBranch(
      (transaction) =>
        transaction.selectFrom('journals').select('id').where('id', '=', id).execute(),
      south,
    );
    expect(seen).toEqual([]);
  });
});
