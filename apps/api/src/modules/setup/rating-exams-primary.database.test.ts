import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

/** Thursday 15 October 2026, 10:00 in Tashkent: quarter 1 has started. */
const NOW = '2026-10-15T10:00:00+05:00';

/** The error a promise was refused with, or a failure when it was not refused. */
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

// Rating exams in grades 0–4 in the database (db/migrations/0153; task 9.4f, pull request #276).
// `05`, Grading weights on a subject, Grades 0–4: "A school setting 'Rating exams in grades
// 0–4', kept by the Super Admin, off by default ... acts on open quarters only"; turning it off
// is refused while a journal of grades 0–4 of an open quarter holds a rating exam entry; Group: a
// group of grades 4 and 5 of a rating subject is refused while it is off. `edge/00-definitions`,
// Rating journal: "a closed quarter keeps the state it closed with". Every write of the
// application is made as `sodiq_app` through the branch filter. All names are invented.
describe('rating exams in grades 0–4 in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LessonsKit;
  let north: string;
  let south: string;
  let account: string;
  const years = new Map<string, { year: string; quarters: string[] }>();

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  const audited = (transaction: Transaction, branch: string | null) =>
    branch === null
      ? sql`insert into audit_log_school (occurred_at, action) values (${new Date(NOW)}, 'test.rating_primary')`.execute(
          transaction,
        )
      : transaction
          .insertInto('audit_log')
          .values({ occurred_at: new Date(NOW), branch_id: branch, action: 'test.rating_primary' })
          .execute();

  const quarterOf = (branch: string, number: number) =>
    years.get(branch)?.quarters[number - 1] ?? '';

  /** A graded subject of these grades with the rating exam (or none). */
  const subject = async (grades: readonly number[], rating = true) => {
    const id = await kit.load.classes.subject({ grades, journalType: 'graded' });
    if (rating) {
      await database.migrator
        .updateTable('subjects')
        .set({ rating_exam: true })
        .where('id', '=', id)
        .execute();
    }
    return id;
  };

  /** A class of the grade with one pupil, and its journal of the subject. */
  async function journalOf(branch: string, subjectId: string, grade: number) {
    const year = years.get(branch)?.year ?? '';
    const classId = await kit.load.classes.schoolClass(branch, year, { grade });
    const student = await kit.members.student(branch, { startsOn: '2026-09-01', grade });
    await kit.members.member({ branch, classId, studentId: student, from: '2026-09-01' });
    const journal = await database.migrator
      .insertInto('journals')
      .values({
        branch_id: branch,
        academic_year_id: year,
        class_id: classId,
        subject_id: subjectId,
        runs: sql`'{[2026-09-01,)}'::datemultirange`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { classId, student, journal: journal.id };
  }

  /** The rating exam row of a journal, as the application writes it. */
  const examRow = (branch: string, journal: string, quarter = quarterOf(branch, 1)) =>
    inBranch(branch, async (transaction) => {
      await audited(transaction, branch);
      return (
        await transaction
          .insertInto('journal_rating_exams')
          .values({
            branch_id: branch,
            journal_id: journal,
            quarter_id: quarter,
            exam_date: '2026-10-12',
            version: 1,
            changed_by: account,
            changed_at: new Date(0),
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    });

  const writeEntry = (
    transaction: Transaction,
    branch: string,
    exam: string,
    student: string,
    kind: 'score' | 'did_not_sit' | 'exempt' = 'score',
  ) =>
    transaction
      .insertInto('journal_rating_entries')
      .values({
        branch_id: branch,
        rating_exam_id: exam,
        student_id: student,
        kind,
        score: kind === 'score' ? 60 : null,
        version: 1,
        changed_by: account,
        changed_how: 'entry',
        changed_at: new Date(0),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

  const entry = (
    branch: string,
    exam: string,
    student: string,
    kind?: 'score' | 'did_not_sit' | 'exempt',
  ) =>
    inBranch(branch, async (transaction) => {
      await audited(transaction, branch);
      return writeEntry(transaction, branch, exam, student, kind);
    });

  /** The setting and the states of the quarters named, as the change of the setting writes them. */
  const writeSetting = async (transaction: Transaction, on: boolean, quarters: string[]) => {
    await transaction.updateTable('school_settings').set({ rating_exams_primary: on }).execute();
    if (quarters.length > 0) {
      await transaction
        .updateTable('quarter_rating_states')
        .set({ rating_exams_primary: on })
        .where('quarter_id', 'in', quarters)
        .execute();
    }
  };

  /** The setting turned for every quarter of both branches. */
  const setting = (on: boolean, quarters = allQuarters()) =>
    transactions.run([...years.keys()], async (transaction) => {
      await audited(transaction, null);
      await writeSetting(transaction, on, quarters);
    });

  const allQuarters = () => [...years.values()].flatMap((one) => one.quarters);

  let branches = 0;
  /** A branch of its own with a dated year, so the states of one test leave the others alone. */
  const fresh = async () => {
    branches += 1;
    const branch = await insertBranch(database.migrator, `Branch ${String(branches)}`);
    years.set(branch, await kit.year(branch));
    return branch;
  };
  const quartersOf = (branch: string) => years.get(branch)?.quarters ?? [];

  const stateOf = async (quarter: string) =>
    (
      await database.migrator
        .selectFrom('quarter_rating_states')
        .select('rating_exams_primary')
        .where('quarter_id', '=', quarter)
        .executeTakeFirstOrThrow()
    ).rating_exams_primary;

  const ratingOn = async (journal: string, quarter: string) => {
    const { rows } = await sql<{ on: boolean }>`
      select journal_rating_on(${journal}::uuid, ${quarter}::uuid) as on
    `.execute(database.migrator);
    return rows[0]?.on;
  };

  /** A group of the subject drawing from the classes, written in one transaction (its rules run at the commit). */
  const group = (branch: string, subjectId: string, classIds: readonly string[]) =>
    database.migrator.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto('groups')
        .values({
          branch_id: branch,
          academic_year_id: years.get(branch)?.year ?? '',
          subject_id: subjectId,
          name: `Group ${String(Math.random()).slice(2, 8)}`,
          language: 'uz',
          max_size: 20,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const classId of classIds) {
        await transaction
          .insertInto('group_classes')
          .values({ branch_id: branch, group_id: row.id, class_id: classId })
          .execute();
      }
      return row.id;
    });

  const classOf = (branch: string, grade: number) =>
    kit.load.classes.schoolClass(branch, years.get(branch)?.year ?? '', { grade });

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  async function untilWaiting(): Promise<void> {
    for (let tries = 0; tries < 200; tries += 1) {
      if ((await waitingForALock()) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Nothing waited for a lock.');
  }

  /** A transaction held open after `work` until `release` is called; its answer or refusal after. */
  function held(branches: string[], work: (transaction: Transaction) => Promise<unknown>) {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const done = transactions.run(branches, async (transaction) => {
      await work(transaction);
      ready();
      await gate;
    });
    return { started, release, done };
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    years.set(north, await kit.year(north));
    years.set(south, await kit.year(south));
    account = await kit.load.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('starts off in a school without journals of grades 0–4, with a state for every quarter', async () => {
    const setting = await database.migrator
      .selectFrom('school_settings')
      .select('rating_exams_primary')
      .executeTakeFirstOrThrow();
    expect(setting.rating_exams_primary).toBe(false);
    for (const quarter of allQuarters()) expect(await stateOf(quarter)).toBe(false);
  });

  it('reads a journal of grades 0–4 for a class, a group of grades 3 and 4, and not 4 and 5', async () => {
    const b = await fresh();
    const id = await subject([3, 4, 5, 7]);
    const third = await journalOf(b, id, 3);
    const seventh = await journalOf(b, id, 7);
    const primary = async (journal: string) =>
      (
        await sql<{ on: boolean }>`select journal_primary(${journal}::uuid) as on`.execute(
          database.migrator,
        )
      ).rows[0]?.on;
    expect(await primary(third.journal)).toBe(true);
    expect(await primary(seventh.journal)).toBe(false);
    const plain = await subject([3, 4, 5], false);
    const lower = await group(b, plain, [await classOf(b, 3), await classOf(b, 4)]);
    const upper = await group(b, plain, [await classOf(b, 4), await classOf(b, 5)]);
    const groupJournal = async (groupId: string) =>
      (
        await database.migrator
          .insertInto('journals')
          .values({
            branch_id: b,
            academic_year_id: years.get(b)?.year ?? '',
            group_id: groupId,
            subject_id: plain,
            runs: sql`'{[2026-09-01,)}'::datemultirange`,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    expect(await primary(await groupJournal(lower))).toBe(true);
    expect(await primary(await groupJournal(upper))).toBe(false);
  });

  it('refuses the rating exam and its entries of a grade 1 journal while the state is off, and keeps grade 7', async () => {
    const b = await fresh();
    const id = await subject([1, 7]);
    const first = await journalOf(b, id, 1);
    const seventh = await journalOf(b, id, 7);
    const quarter = quarterOf(b, 1);
    expect(await ratingOn(first.journal, quarter)).toBe(false);
    expect(await ratingOn(seventh.journal, quarter)).toBe(true);
    expect((await refusal(examRow(b, first.journal))).constraint).toBe('journal_rating_switch_off');
    const exam = await examRow(b, seventh.journal);
    await entry(b, exam, seventh.student);
    // Turned on: the grade 1 journal has its exam; an entry is saved.
    await setting(true, quartersOf(b));
    expect(await ratingOn(first.journal, quarter)).toBe(true);
    const firstExam = await examRow(b, first.journal);
    await entry(b, firstExam, first.student);
    // The update of an existing exam row is refused once its quarter is off again: the entry
    // is cleared first, so the turn-off itself is allowed.
    await inBranch(b, async (transaction) => {
      await audited(transaction, b);
      await transaction
        .updateTable('journal_rating_entries')
        .set({
          kind: null,
          score: null,
          reason: 'Entered by mistake',
          changed_by: account,
          changed_how: 'entry',
        })
        .where('rating_exam_id', '=', firstExam)
        .execute();
    });
    // A cleared entry does not refuse the turn-off.
    await setting(false, quartersOf(b));
    const updated = await refusal(
      inBranch(b, async (transaction) => {
        await audited(transaction, b);
        await transaction
          .updateTable('journal_rating_exams')
          .set({ exam_date: '2026-10-13', changed_by: account })
          .where('id', '=', firstExam)
          .execute();
      }),
    );
    expect(updated.constraint).toBe('journal_rating_switch_off');
  });

  it('refuses turning a quarter off while a grade 0–4 journal holds a score, "did not sit" or "exempt"', async () => {
    const b = await fresh();
    const id = await subject([2]);
    await setting(true, quartersOf(b));
    const quarter = quarterOf(b, 1);
    for (const kind of ['score', 'did_not_sit', 'exempt'] as const) {
      const second = await journalOf(b, id, 2);
      const exam = await examRow(b, second.journal);
      const written = await entry(b, exam, second.student, kind);
      const failed = await refusal(setting(false, [quarter]));
      expect(failed.constraint).toBe('quarter_rating_state_entries');
      expect(await stateOf(quarter)).toBe(true);
      // Cleared, it no longer refuses.
      await inBranch(b, async (transaction) => {
        await audited(transaction, b);
        await transaction
          .updateTable('journal_rating_entries')
          .set({
            kind: null,
            score: null,
            reason: 'Cleared',
            changed_by: account,
            changed_how: 'entry',
          })
          .where('id', '=', written.id)
          .execute();
      });
    }
    await setting(false, quartersOf(b));
    expect(await stateOf(quarter)).toBe(false);
  });

  it('keeps the state of a quarter with a closing in force, and gives a new quarter the school value', async () => {
    const b = await fresh();
    const quarter = quarterOf(b, 1);
    await setting(false, quartersOf(b));
    await inBranch(b, async (transaction) => {
      await audited(transaction, b);
      await transaction
        .insertInto('quarter_closings')
        .values({
          branch_id: b,
          quarter_id: quarter,
          version: 1,
          closed_at: new Date(0),
          closed_by: account,
          lock_now: false,
          warnings: sql`'[]'::jsonb`,
        })
        .execute();
    });
    const failed = await refusal(setting(true, [quarter]));
    expect(failed.constraint).toBe('quarter_rating_state_closed');
    expect(await stateOf(quarter)).toBe(false);
    // The quarter's branch and id never change.
    const fixed = await refusal(
      database.migrator
        .updateTable('quarter_rating_states')
        .set({ branch_id: north })
        .where('quarter_id', '=', quarterOf(b, 2))
        .execute(),
    );
    expect(fixed.code).toBeDefined();
    // A new year's quarters take the school's value, whatever the insert names.
    await setting(true, []);
    const year = await kit.load.classes.year(b, 'planned', '2027-09-01', '2028-05-31');
    const created = await database.migrator
      .selectFrom('quarter_rating_states')
      .innerJoin('quarters', 'quarters.id', 'quarter_rating_states.quarter_id')
      .select('quarter_rating_states.rating_exams_primary')
      .where('quarters.academic_year_id', '=', year)
      .execute();
    expect(created.map((one) => one.rating_exams_primary)).toEqual([true, true, true, true]);
    await setting(false, []);
  });

  describe('a group of grades 4 and 5 of a rating subject (decision 5)', () => {
    it('is refused while off, on create, on a class added and on restore, and allowed while on', async () => {
      const b = await fresh();
      await setting(false, quartersOf(b));
      const id = await subject([4, 5]);
      const fourth = await classOf(b, 4);
      const fifth = await classOf(b, 5);
      expect((await refusal(group(b, id, [fourth, fifth]))).message).toContain(
        'groups_rating_primary_span',
      );
      // A class added to a group of grade 4.
      const four = await group(b, id, [fourth]);
      const added = await refusal(
        database.migrator
          .insertInto('group_classes')
          .values({ branch_id: b, group_id: four, class_id: fifth })
          .execute(),
      );
      expect(added.message).toContain('groups_rating_primary_span');
      // Allowed while on; then the turn-off is refused while it exists.
      await setting(true, quartersOf(b));
      const both = await group(b, id, [fourth, fifth]);
      const off = await refusal(setting(false, quartersOf(b)));
      expect(off.constraint).toBe('quarter_rating_state_groups');
      // Archived, the turn-off goes through; restored while off, it is refused.
      await database.migrator
        .updateTable('groups')
        .set({ archived_at: new Date(NOW) })
        .where('id', '=', both)
        .execute();
      await setting(false, quartersOf(b));
      const restored = await refusal(
        database.migrator
          .updateTable('groups')
          .set({ archived_at: null })
          .where('id', '=', both)
          .execute(),
      );
      expect(restored.message).toContain('groups_rating_primary_span');
    });

    it('refuses the rating switch turned on while such a group exists and the setting is off', async () => {
      const b = await fresh();
      await setting(false, quartersOf(b));
      const id = await subject([4, 5], false);
      await group(b, id, [await classOf(b, 4), await classOf(b, 5)]);
      const failed = await refusal(
        database.migrator
          .updateTable('subjects')
          .set({ rating_exam: true })
          .where('id', '=', id)
          .execute(),
      );
      expect(failed.message).toContain('groups_rating_primary_span');
      // A group of grades 3 and 4 follows the setting and refuses nothing.
      const lower = await subject([3, 4], false);
      await group(b, lower, [await classOf(b, 3), await classOf(b, 4)]);
      await database.migrator
        .updateTable('subjects')
        .set({ rating_exam: true })
        .where('id', '=', lower)
        .execute();
    });
  });

  describe('a class moved into grades 0–4 (decision 6)', () => {
    const regrade = (classId: string, grade: number) =>
      database.migrator.updateTable('classes').set({ grade }).where('id', '=', classId).execute();

    it('is refused while its journal holds an entry in an open quarter whose state is off', async () => {
      const b = await fresh();
      await setting(false, quartersOf(b));
      const id = await subject([4, 7]);
      const seventh = await journalOf(b, id, 7);
      const exam = await examRow(b, seventh.journal);
      await entry(b, exam, seventh.student);
      expect((await refusal(regrade(seventh.classId, 4))).message).toContain(
        'classes_grade_rating_primary',
      );
      // Without an entry (and without members, which refuse any grade edit), the move is made.
      const empty = await classOf(b, 7);
      await database.migrator
        .insertInto('journals')
        .values({
          branch_id: b,
          academic_year_id: years.get(b)?.year ?? '',
          class_id: empty,
          subject_id: id,
          runs: sql`'{[2026-09-01,)}'::datemultirange`,
        })
        .execute();
      await regrade(empty, 4);
    });

    it('is refused where a quarter with a closing in force has the state off', async () => {
      const b = await fresh();
      const branch = b;
      await setting(false, []);
      const id = await subject([4, 5]);
      const fifth = await journalOf(branch, id, 5);
      await inBranch(branch, async (transaction) => {
        await audited(transaction, branch);
        await transaction
          .insertInto('quarter_closings')
          .values({
            branch_id: branch,
            quarter_id: quarterOf(branch, 1),
            version: 1,
            closed_at: new Date(0),
            closed_by: account,
            lock_now: false,
            warnings: sql`'[]'::jsonb`,
          })
          .execute();
      });
      expect((await refusal(regrade(fifth.classId, 4))).message).toContain(
        'classes_grade_rating_primary',
      );
    });
  });

  describe('the distribution without the rating exam (decision 7)', () => {
    const write = (
      branch: string,
      subjectId: string,
      quarter: string,
      values: { attendance: number; classwork: number; homework: number },
      rounds = { weights_round: 1, rating_round: 1 },
    ) =>
      inBranch(branch, (transaction) =>
        transaction
          .insertInto('subject_quarter_primary_weights')
          .values({
            branch_id: branch,
            subject_id: subjectId,
            quarter_id: quarter,
            ...values,
            ...rounds,
          })
          .onConflict((conflict) =>
            conflict.columns(['branch_id', 'subject_id', 'quarter_id']).doUpdateSet(values),
          )
          .execute(),
      );

    it('totals 100, is for a rating subject only, and counts in the rounds of the quarter', async () => {
      const b = await fresh();
      const id = await subject([1, 7]);
      const quarter = quarterOf(b, 2);
      for (const homework of [39, 41]) {
        expect(
          (await refusal(write(b, id, quarter, { attendance: 10, classwork: 50, homework })))
            .constraint,
        ).toBe('subject_quarter_primary_weights_total_check');
      }
      await write(b, id, quarter, { attendance: 10, classwork: 50, homework: 40 });
      const plain = await subject([1], false);
      expect(
        (await refusal(write(b, plain, quarter, { attendance: 10, classwork: 50, homework: 40 })))
          .constraint,
      ).toBe('subject_quarter_primary_weights_rating');
      expect(
        (
          await refusal(
            write(
              b,
              id,
              quarterOf(b, 3),
              { attendance: 10, classwork: 50, homework: 40 },
              { weights_round: 1, rating_round: 2 },
            ),
          )
        ).constraint,
      ).toBe('subject_quarter_weights_current_rating_round');
      expect(
        (
          await refusal(
            write(
              b,
              id,
              quarterOf(b, 3),
              { attendance: 10, classwork: 50, homework: 40 },
              { weights_round: 2, rating_round: 1 },
            ),
          )
        ).constraint,
      ).toBe('subject_weights_current_round');
    });

    it('refuses an insert and an update in a closed quarter and in a closed year', async () => {
      const b = await fresh();
      const branch = b;
      const id = await subject([1]);
      await write(branch, id, quarterOf(branch, 2), {
        attendance: 10,
        classwork: 50,
        homework: 40,
      });
      await inBranch(branch, async (transaction) => {
        await audited(transaction, branch);
        await transaction
          .insertInto('quarter_closings')
          .values({
            branch_id: branch,
            quarter_id: quarterOf(branch, 2),
            version: 1,
            closed_at: new Date(0),
            closed_by: account,
            lock_now: false,
            warnings: sql`'[]'::jsonb`,
          })
          .execute();
      });
      expect(
        (
          await refusal(
            write(branch, id, quarterOf(branch, 2), {
              attendance: 20,
              classwork: 40,
              homework: 40,
            }),
          )
        ).constraint,
      ).toBe('quarters_closed');
      // An open quarter of the same year takes it.
      await write(branch, id, quarterOf(branch, 1), {
        attendance: 10,
        classwork: 50,
        homework: 40,
      });
      const closedBranch = await insertBranch(database.migrator, 'Old');
      const closedYear = await kit.load.classes.year(closedBranch, 'closed');
      const closedQuarter = await database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', closedYear)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow();
      expect(
        (
          await refusal(
            write(closedBranch, id, closedQuarter.id, {
              attendance: 10,
              classwork: 50,
              homework: 40,
            }),
          )
        ).constraint,
      ).toBe('academic_years_closed');
    });
  });

  it('keeps both new branch tables to the branch of the request', async () => {
    const id = await subject([1]);
    await database.migrator
      .insertInto('subject_quarter_primary_weights')
      .values({
        branch_id: south,
        subject_id: id,
        quarter_id: quarterOf(south, 3),
        attendance: 10,
        classwork: 50,
        homework: 40,
        weights_round: 1,
        rating_round: 1,
      })
      .execute();
    await inBranch(north, async (transaction) => {
      const states = await transaction
        .selectFrom('quarter_rating_states')
        .select('branch_id')
        .execute();
      expect(states.length).toBeGreaterThan(0);
      expect(states.every((one) => one.branch_id === north)).toBe(true);
      const weights = await transaction
        .selectFrom('subject_quarter_primary_weights')
        .select('branch_id')
        .execute();
      expect(weights.every((one) => one.branch_id === north)).toBe(true);
    });
  });

  it('puts the branch behind for the prepared totals when a state changes', async () => {
    const b = await fresh();
    await setting(false, quartersOf(b));
    const before = await database.migrator
      .selectFrom('report_changes')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('branch_id', '=', b)
      .executeTakeFirstOrThrow();
    await setting(true, [quarterOf(b, 4)]);
    const after = await database.migrator
      .selectFrom('report_changes')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('branch_id', '=', b)
      .executeTakeFirstOrThrow();
    expect(after.count).toBeGreaterThan(before.count);
    await setting(false, [quarterOf(b, 4)]);
  });

  describe('at the same moment', () => {
    it('makes a turn-off wait for an entry being written, and refuses it after', async () => {
      const b = await fresh();
      await setting(true, quartersOf(b));
      const id = await subject([1]);
      const first = await journalOf(b, id, 1);
      const exam = await examRow(b, first.journal);
      const side = held([b], async (transaction) => {
        await audited(transaction, b);
        await writeEntry(transaction, b, exam, first.student);
      });
      await side.started;
      const turning = setting(false, [quarterOf(b, 1)]).then(
        () => 'done',
        (error: { constraint?: string }) => error.constraint,
      );
      await untilWaiting();
      side.release();
      await side.done;
      expect(await turning).toBe('quarter_rating_state_entries');
    });

    it('makes an entry wait for a turn-off being written, and refuses it after', async () => {
      const b = await fresh();
      await setting(true, quartersOf(b));
      const id = await subject([1]);
      const first = await journalOf(b, id, 1);
      const exam = await examRow(b, first.journal);
      const side = held([...years.keys()], async (transaction) => {
        await audited(transaction, null);
        await writeSetting(transaction, false, [quarterOf(b, 1)]);
      });
      await side.started;
      const writing = entry(b, exam, first.student).then(
        () => 'done',
        (error: { constraint?: string }) => error.constraint,
      );
      await untilWaiting();
      side.release();
      await side.done;
      expect(await writing).toBe('journal_rating_switch_off');
    });

    it('makes a group of grades 4 and 5 wait for a turn-off, and refuses it after', async () => {
      const b = await fresh();
      await setting(true, quartersOf(b));
      const id = await subject([4, 5]);
      const fourth = await classOf(b, 4);
      const fifth = await classOf(b, 5);
      const side = held([...years.keys()], async (transaction) => {
        await audited(transaction, null);
        await writeSetting(transaction, false, []);
      });
      await side.started;
      const creating = group(b, id, [fourth, fifth]).then(
        () => 'done',
        (error: { message?: string }) =>
          error.message?.includes('groups_rating_primary_span') === true
            ? 'refused'
            : error.message,
      );
      await untilWaiting();
      side.release();
      await side.done;
      expect(await creating).toBe('refused');
    });

    it('makes a turn-off wait for a close of the quarter, and refuses it after', async () => {
      const b = await fresh();
      const branch = b;
      await setting(false, []);
      await setting(true, [quarterOf(branch, 1)]);
      const side = held([branch], async (transaction) => {
        await audited(transaction, branch);
        await transaction
          .insertInto('quarter_closings')
          .values({
            branch_id: branch,
            quarter_id: quarterOf(branch, 1),
            version: 1,
            closed_at: new Date(0),
            closed_by: account,
            lock_now: false,
            warnings: sql`'[]'::jsonb`,
          })
          .execute();
      });
      await side.started;
      const turning = transactions
        .run([branch], async (transaction) => {
          await audited(transaction, branch);
          await transaction
            .updateTable('quarter_rating_states')
            .set({ rating_exams_primary: false })
            .where('quarter_id', '=', quarterOf(branch, 1))
            .execute();
        })
        .then(
          () => 'done',
          (error: { constraint?: string }) => error.constraint,
        );
      await untilWaiting();
      side.release();
      await side.done;
      expect(await turning).toBe('quarter_rating_state_closed');
    });
  });
});
