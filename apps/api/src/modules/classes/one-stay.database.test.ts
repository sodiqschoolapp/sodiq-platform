import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../database/database.js';
import {
  BRANCH_SETTING,
  MOMENT_SETTING,
  Transactions,
  type Transaction,
} from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { MembersKit } from '../../testing/members-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

/** Wednesday 14 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-14T10:00:00+05:00';
const YEAR_END = '2027-06-01';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// One stay in a class and in a group (task 3.5c, pull request #117, migration
// 0062): issue #105, H36, "one continuous stay in one class is one stay
// everywhere ... a cancel or an undo gives the stay back as it was before,
// not as a new planned stay; the same for group stays". The database refuses
// two adjoining rows of one student in one class or group (decision 2, the
// done-when), lets a row cut by a leaving or a move grow back once that cut
// is taken back (decision 1), checks the days it gets back as an insert's at
// the commit, joins two adjoining rows (corrections 2 and 3), and links a
// changed move to the one it replaced (H34). All names are invented.
describe('one stay in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let classes: ClassesKit;
  let members: MembersKit;
  let north: string;
  let year: string;
  let maths: string;

  const inBranch = <T>(work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([north], work);

  /** A transaction of the migrator with the branch and the moment set, as the application's. */
  const asMigrator = <T>(work: (transaction: Transaction) => Promise<T>) =>
    database.migrator.transaction().execute(async (transaction) => {
      await sql`
        select set_config(${BRANCH_SETTING}, ${`{${north}}`}, true),
          set_config(${MOMENT_SETTING}, ${new Date(NOW).toISOString()}, true)
      `.execute(transaction);
      return work(transaction);
    });

  /** A student of a new class of the North branch from 1 September, with the class row. */
  async function pupil(input: { maxSize?: number; classId?: string } = {}) {
    const oxford =
      input.classId ?? (await classes.schoolClass(north, year, { maxSize: input.maxSize }));
    const yale = await classes.schoolClass(north, year);
    const student = await members.student(north, { startsOn: '2026-09-01' });
    const row = await members.member({
      branch: north,
      classId: oxford,
      studentId: student,
      from: '2026-09-01',
    });
    return { oxford, yale, student, row };
  }

  /** A leaving with its first inactive day, the class rows given cut at it, in the transaction. */
  async function leave(
    db: Transaction,
    student: string,
    firstInactiveDay: string,
    rows: { table: 'class_memberships' | 'group_memberships'; id: string }[],
    branch = north,
  ): Promise<string> {
    const leaving = await members.leaving(db, branch, student, firstInactiveDay);
    for (const { table, id } of rows) {
      await db
        .updateTable(table)
        .set({ valid_until: firstInactiveDay, ended_by: 'leaving', leaving_id: leaving })
        .where('id', '=', id)
        .execute();
    }
    return leaving;
  }

  /** The status rows of a cancel or an undo of a leaving: its inactive row emptied, the active time written again. */
  async function takeBack(
    db: Transaction,
    student: string,
    leaving: string,
    branch = north,
  ): Promise<void> {
    const row = await db
      .selectFrom('student_statuses')
      .select('valid_from')
      .where('id', '=', leaving)
      .executeTakeFirstOrThrow();
    await db
      .updateTable('student_statuses')
      .set({ valid_until: row.valid_from })
      .where('id', '=', leaving)
      .execute();
    await db
      .insertInto('student_statuses')
      .values({
        student_id: student,
        branch_id: branch,
        status: 'active',
        valid_from: row.valid_from,
        cause: 'cancel',
      })
      .execute();
  }

  /** A row grown back to its own end, with no end. */
  const growBack = (
    db: Transaction | Database,
    table: 'class_memberships' | 'group_memberships',
    id: string,
  ) =>
    db
      .updateTable(table)
      .set({ valid_until: YEAR_END, ended_by: null, leaving_id: null, ended_by_move_id: null })
      .where('id', '=', id)
      .execute();

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    classes = new ClassesKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    year = await classes.year(north);
    maths = await classes.subject({ grades: [7, 8] });
    members = new MembersKit(database.migrator, await classes.account());
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('two adjoining rows of one stay (the done-when)', () => {
    it('refuses two adjoining rows of one student in one class at the commit', async () => {
      // The row of 1 September ends on 1 October; another row of the class
      // from that day continues it: one stay stored as two is refused.
      const oxford = await classes.schoolClass(north, year);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      expect(
        await refusal(
          asMigrator(async (transaction) => {
            await members.member(
              {
                branch: north,
                classId: oxford,
                studentId: student,
                from: '2026-09-01',
                ownUntil: '2026-10-01',
              },
              transaction,
            );
            await members.member(
              { branch: north, classId: oxford, studentId: student, from: '2026-10-01' },
              transaction,
            );
          }),
        ),
      ).toMatchObject({ constraint: 'class_memberships_one_stay' });
    });

    it('lets a gap of a day, another class or an empty row meet a row', async () => {
      const oxford = await classes.schoolClass(north, year);
      const yale = await classes.schoolClass(north, year);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      await asMigrator(async (transaction) => {
        await members.member(
          {
            branch: north,
            classId: oxford,
            studentId: student,
            from: '2026-09-01',
            ownUntil: '2026-10-01',
          },
          transaction,
        );
        // Another class from the next day: a move.
        await members.member(
          {
            branch: north,
            classId: yale,
            studentId: student,
            from: '2026-10-01',
            ownUntil: '2026-10-10',
          },
          transaction,
        );
        // The first class again after a gap of a day.
        await members.member(
          {
            branch: north,
            classId: oxford,
            studentId: student,
            from: '2026-10-11',
            ownUntil: '2026-11-02',
          },
          transaction,
        );
        // A planned row of the first class from the day that row ends,
        // withdrawn: an empty row on the last day of a row's closed range.
        const planned = await members.member(
          {
            branch: north,
            classId: oxford,
            studentId: student,
            from: '2026-11-02',
            ownUntil: '2026-11-10',
          },
          transaction,
        );
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-11-02', ended_by: 'withdrawn' })
          .where('id', '=', planned)
          .execute();
        await members.member(
          { branch: north, classId: yale, studentId: student, from: '2026-11-02' },
          transaction,
        );
      });
      const held = await database.migrator
        .selectFrom('class_memberships')
        .select(['class_id', 'valid_from', 'valid_until', 'ended_by'])
        .where('student_id', '=', student)
        .orderBy('valid_from')
        .orderBy('valid_until')
        .execute();
      expect(
        held.map((one) => [one.class_id, one.valid_from, one.valid_until, one.ended_by]),
      ).toEqual([
        [oxford, '2026-09-01', '2026-10-01', null],
        [yale, '2026-10-01', '2026-10-10', null],
        [oxford, '2026-10-11', '2026-11-02', null],
        [oxford, '2026-11-02', '2026-11-02', 'withdrawn'],
        [yale, '2026-11-02', YEAR_END, null],
      ]);
    });

    it('refuses two adjoining rows of one student in one group at the commit', async () => {
      const { oxford, student } = await pupil();
      const group = await classes.group(north, year, maths, [oxford]);
      expect(
        await refusal(
          asMigrator(async (transaction) => {
            await members.groupMember(
              {
                branch: north,
                groupId: group,
                subjectId: maths,
                studentId: student,
                from: '2026-09-01',
                ownUntil: '2026-10-01',
              },
              transaction,
            );
            await members.groupMember(
              {
                branch: north,
                groupId: group,
                subjectId: maths,
                studentId: student,
                from: '2026-10-01',
              },
              transaction,
            );
          }),
        ),
      ).toMatchObject({ constraint: 'group_memberships_one_stay' });
    });
  });

  describe('a row grows back once what cut it is taken back (decision 1)', () => {
    it('grows a row a leaving cut once the leaving is cancelled, and refuses it while it stands', async () => {
      const { student, row } = await pupil();
      const leaving = await inBranch((transaction) =>
        leave(transaction, student, '2026-11-01', [{ table: 'class_memberships', id: row }]),
      );
      expect(
        await refusal(inBranch((transaction) => growBack(transaction, 'class_memberships', row))),
      ).toMatchObject({ constraint: 'class_memberships_only_shrink' });
      await inBranch(async (transaction) => {
        await takeBack(transaction, student, leaving);
        await growBack(transaction, 'class_memberships', row);
      });
      expect(await members.rowOf(row)).toMatchObject({
        valid_from: '2026-09-01',
        valid_until: YEAR_END,
        ended_by: null,
      });
    });

    it('grows a row up to a leaving that stands, never to one taken back', async () => {
      const { student, row } = await pupil();
      const first = await inBranch((transaction) =>
        leave(transaction, student, '2026-11-01', [{ table: 'class_memberships', id: row }]),
      );
      // The replace of the scheduled leaving by a later one.
      const replace = (named: 'first' | 'second') =>
        inBranch(async (transaction) => {
          await transaction
            .updateTable('student_statuses')
            .set({ valid_until: '2026-11-01' })
            .where('id', '=', first)
            .execute();
          await transaction
            .insertInto('student_statuses')
            .values({
              student_id: student,
              branch_id: north,
              status: 'active',
              valid_from: '2026-11-01',
              valid_until: '2026-12-01',
              cause: 'cancel',
            })
            .execute();
          const second = await transaction
            .insertInto('student_statuses')
            .values({
              student_id: student,
              branch_id: north,
              status: 'inactive',
              valid_from: '2026-12-01',
              cause: 'leaving',
              reason: 'Moved to another city',
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await transaction
            .updateTable('class_memberships')
            .set({
              valid_until: '2026-12-01',
              ended_by: 'leaving',
              leaving_id: named === 'first' ? first : second.id,
            })
            .where('id', '=', row)
            .execute();
        });
      expect(await refusal(replace('first'))).toMatchObject({
        constraint: 'class_memberships_only_shrink',
      });
      await replace('second');
      expect(await members.rowOf(row)).toMatchObject({
        valid_until: '2026-12-01',
        ended_by: 'leaving',
      });
    });

    it('grows a row a move cut once the move is cancelled, and refuses it while the move is live', async () => {
      const { oxford, yale, student, row } = await pupil();
      const move = await members.move({
        branch: north,
        studentId: student,
        from: '2026-10-20',
        fromClassId: oxford,
        toClassId: yale,
      });
      const target = await inBranch(async (transaction) => {
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-10-20', ended_by: 'transfer', ended_by_move_id: move })
          .where('id', '=', row)
          .execute();
        return members.member(
          {
            branch: north,
            classId: yale,
            studentId: student,
            from: '2026-10-20',
            cause: 'transfer',
            writtenByMoveId: move,
          },
          transaction,
        );
      });
      expect(
        await refusal(inBranch((transaction) => growBack(transaction, 'class_memberships', row))),
      ).toMatchObject({ constraint: 'class_memberships_only_shrink' });
      await inBranch(async (transaction) => {
        await transaction
          .updateTable('student_moves')
          .set({ cancelled_at: new Date(NOW) })
          .where('id', '=', move)
          .execute();
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-10-20', ended_by: 'withdrawn' })
          .where('id', '=', target)
          .execute();
        await growBack(transaction, 'class_memberships', row);
      });
      expect(await members.rowOf(row)).toMatchObject({ valid_until: YEAR_END, ended_by: null });
    });

    it('grows a row up to a live move at its date only', async () => {
      const { oxford, yale, student, row } = await pupil();
      const harvard = await classes.schoolClass(north, year);
      const first = await members.move({
        branch: north,
        studentId: student,
        from: '2026-10-20',
        fromClassId: oxford,
        toClassId: yale,
      });
      const target = await inBranch(async (transaction) => {
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-10-20', ended_by: 'transfer', ended_by_move_id: first })
          .where('id', '=', row)
          .execute();
        return members.member(
          {
            branch: north,
            classId: yale,
            studentId: student,
            from: '2026-10-20',
            cause: 'transfer',
            writtenByMoveId: first,
          },
          transaction,
        );
      });
      // The change of the move: the first cancelled, a second one later.
      const change = (until: string) =>
        inBranch(async (transaction) => {
          await transaction
            .updateTable('student_moves')
            .set({ cancelled_at: new Date(NOW) })
            .where('id', '=', first)
            .execute();
          await transaction
            .updateTable('class_memberships')
            .set({ valid_until: '2026-10-20', ended_by: 'withdrawn' })
            .where('id', '=', target)
            .execute();
          const second = await members.move(
            {
              branch: north,
              studentId: student,
              from: '2026-10-27',
              fromClassId: oxford,
              toClassId: harvard,
            },
            transaction,
          );
          await transaction
            .updateTable('class_memberships')
            .set({ valid_until: until, ended_by: 'transfer', ended_by_move_id: second })
            .where('id', '=', row)
            .execute();
          await members.member(
            {
              branch: north,
              classId: harvard,
              studentId: student,
              from: '2026-10-27',
              cause: 'transfer',
              writtenByMoveId: second,
            },
            transaction,
          );
        });
      expect(await refusal(change('2026-10-25'))).toMatchObject({
        constraint: 'memberships_move_end',
      });
      await change('2026-10-27');
      expect(await members.rowOf(row)).toMatchObject({
        valid_until: '2026-10-27',
        ended_by: 'transfer',
      });
    });

    it('never grows a planned row a withdraw emptied', async () => {
      const oxford = await classes.schoolClass(north, year);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      const planned = await members.member({
        branch: north,
        classId: oxford,
        studentId: student,
        from: '2026-11-02',
      });
      await inBranch((transaction) =>
        transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-11-02', ended_by: 'withdrawn' })
          .where('id', '=', planned)
          .execute(),
      );
      expect(
        await refusal(
          inBranch((transaction) => growBack(transaction, 'class_memberships', planned)),
        ),
      ).toMatchObject({ constraint: 'class_memberships_only_shrink' });
    });

    it('never grows a row past its own end', async () => {
      const { student, row } = await pupil();
      const leaving = await inBranch((transaction) =>
        leave(transaction, student, '2026-11-01', [{ table: 'class_memberships', id: row }]),
      );
      expect(
        await refusal(
          inBranch(async (transaction) => {
            await takeBack(transaction, student, leaving);
            await transaction
              .updateTable('class_memberships')
              .set({ valid_until: '2027-07-01', ended_by: null, leaving_id: null })
              .where('id', '=', row)
              .execute();
          }),
        ),
      ).toMatchObject({ code: '23514', constraint: 'class_memberships_ended_check' });
    });
  });

  describe('the days a row gets back are checked as an insert at the commit (plan item 3)', () => {
    /** A student whose class row a leaving dated in the past cut on 10 October. */
    async function gone(input: { maxSize?: number; classId?: string } = {}) {
      const one = await pupil(input);
      const leaving = await inBranch((transaction) =>
        leave(transaction, one.student, '2026-10-10', [
          { table: 'class_memberships', id: one.row },
        ]),
      );
      return { ...one, leaving };
    }

    /** The undo of that leaving with the class row grown back. */
    const undo = (one: { student: string; row: string; leaving: string }) =>
      inBranch(async (transaction) => {
        await takeBack(transaction, one.student, one.leaving);
        await growBack(transaction, 'class_memberships', one.row);
      });

    it('refuses a class archived meanwhile', async () => {
      const one = await gone();
      await database.migrator
        .updateTable('classes')
        .set({ archived_at: new Date(NOW) })
        .where('id', '=', one.oxford)
        .execute();
      expect(await refusal(undo(one))).toMatchObject({
        constraint: 'class_memberships_class_archived',
      });
    });

    it('refuses a class whose seats were taken meanwhile', async () => {
      const one = await gone({ maxSize: 1 });
      const other = await members.student(north, { startsOn: '2026-09-01' });
      await members.member({
        branch: north,
        classId: one.oxford,
        studentId: other,
        from: '2026-10-12',
      });
      expect(await refusal(undo(one))).toMatchObject({ constraint: 'class_memberships_full' });
    });

    it('refuses a class of another grade than the student now has', async () => {
      const one = await gone();
      // The row ended before today, so the grade may change (`students_grade_class`).
      await asMigrator((transaction) =>
        transaction
          .updateTable('students')
          .set({ grade: 8 })
          .where('id', '=', one.student)
          .execute(),
      );
      expect(await refusal(undo(one))).toMatchObject({ constraint: 'class_memberships_grade' });
    });

    it('refuses a class that feeds a group the student has no row of on those days', async () => {
      const one = await gone();
      await classes.group(north, year, maths, [one.oxford]);
      expect(await refusal(undo(one))).toMatchObject({
        constraint: 'class_memberships_need_groups',
      });
    });

    it('refuses a class of a closed year', async () => {
      // A move undone and the row it cut grown back, the year closed before
      // the commit: the commit check refuses the days given back.
      const west = await insertBranch(database.migrator, 'West');
      const closedYear = await classes.year(west, 'current', '2025-09-01', '2026-05-31');
      const old = await classes.schoolClass(west, closedYear);
      const next = await classes.schoolClass(west, closedYear);
      const student = await members.student(west, { startsOn: '2025-09-01' });
      const row = await members.member({
        branch: west,
        classId: old,
        studentId: student,
        from: '2025-09-01',
        ownUntil: '2026-06-01',
      });
      const move = await members.move({
        branch: west,
        studentId: student,
        from: '2026-03-02',
        fromClassId: old,
        toClassId: next,
      });
      await transactions.run([west], async (transaction) => {
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-03-02', ended_by: 'transfer', ended_by_move_id: move })
          .where('id', '=', row)
          .execute();
        await members.member(
          {
            branch: west,
            classId: next,
            studentId: student,
            from: '2026-03-02',
            ownUntil: '2026-06-01',
            cause: 'transfer',
            writtenByMoveId: move,
          },
          transaction,
        );
      });
      expect(
        await refusal(
          database.migrator.transaction().execute(async (transaction) => {
            await sql`
              select set_config(${BRANCH_SETTING}, ${`{${west}}`}, true),
                set_config(${MOMENT_SETTING}, ${new Date(NOW).toISOString()}, true)
            `.execute(transaction);
            await transaction
              .updateTable('student_moves')
              .set({ undone_at: new Date(NOW), reason: 'Typed by mistake' })
              .where('id', '=', move)
              .execute();
            await transaction
              .updateTable('class_memberships')
              .set({ valid_until: '2026-03-02', ended_by: 'undone', ended_by_move_id: move })
              .where('written_by_move_id', '=', move)
              .execute();
            await transaction
              .updateTable('class_memberships')
              .set({ valid_until: '2026-06-01', ended_by: null, ended_by_move_id: null })
              .where('id', '=', row)
              .execute();
            await transaction
              .updateTable('academic_years')
              .set({ status: 'closed' })
              .where('id', '=', closedYear)
              .execute();
          }),
        ),
      ).toMatchObject({ constraint: 'class_year_closed' });
    });

    it('refuses a group whose seats were taken meanwhile', async () => {
      const oxford = await classes.schoolClass(north, year);
      const small = await classes.group(north, year, maths, [oxford], { size: 1 });
      const student = await members.student(north, { startsOn: '2026-09-01' });
      const { row, groupRow } = await asMigrator(async (transaction) => ({
        row: await members.member(
          { branch: north, classId: oxford, studentId: student, from: '2026-09-01' },
          transaction,
        ),
        groupRow: await members.groupMember(
          {
            branch: north,
            groupId: small,
            subjectId: maths,
            studentId: student,
            from: '2026-09-01',
          },
          transaction,
        ),
      }));
      const one = { student, row };
      const leaving = await inBranch((transaction) =>
        leave(transaction, one.student, '2026-10-10', [
          { table: 'class_memberships', id: one.row },
          { table: 'group_memberships', id: groupRow },
        ]),
      );
      const other = await members.student(north, { startsOn: '2026-09-01' });
      await asMigrator(async (transaction) => {
        await members.member(
          { branch: north, classId: oxford, studentId: other, from: '2026-10-12' },
          transaction,
        );
        await members.groupMember(
          {
            branch: north,
            groupId: small,
            subjectId: maths,
            studentId: other,
            from: '2026-10-12',
          },
          transaction,
        );
      });
      expect(
        await refusal(
          inBranch(async (transaction) => {
            await takeBack(transaction, one.student, leaving);
            await growBack(transaction, 'class_memberships', one.row);
            await growBack(transaction, 'group_memberships', groupRow);
          }),
        ),
      ).toMatchObject({ constraint: 'group_memberships_full' });
    });
  });

  describe('two adjoining rows joined into one (corrections 2 and 3)', () => {
    /** Two rows of one student in one class, back to back, in the transaction; the second ends as given. */
    async function pair(
      transaction: Transaction,
      input: {
        classId: string;
        student: string;
        second?: Partial<Parameters<MembersKit['member']>[0]>;
      },
    ) {
      const first = await members.member(
        {
          branch: north,
          classId: input.classId,
          studentId: input.student,
          from: '2026-09-01',
          ownUntil: '2026-10-01',
        },
        transaction,
      );
      const second = await members.member(
        {
          branch: north,
          classId: input.classId,
          studentId: input.student,
          from: '2026-10-01',
          ...input.second,
        },
        transaction,
      );
      return { first, second };
    }

    /** The join as the merge and the migration write it: the later row emptied into the earlier, which takes its end. */
    async function join(
      transaction: Transaction,
      first: string,
      second: string,
      end: { valid_until: string; own_until?: string; ended_by?: 'leaving' | 'transfer' | null } & {
        leaving_id?: string | null;
        ended_by_move_id?: string | null;
      },
    ) {
      await transaction
        .updateTable('class_memberships')
        .set({
          valid_until: sql<string>`valid_from`,
          ended_by: 'joined',
          joined_into_id: first,
          joined_xact: sql<string>`pg_current_xact_id()`,
          leaving_id: null,
          ended_by_move_id: null,
        })
        .where('id', '=', second)
        .execute();
      await transaction
        .updateTable('class_memberships')
        .set({
          valid_until: end.valid_until,
          own_until: end.own_until ?? YEAR_END,
          ended_by: end.ended_by ?? null,
          leaving_id: end.leaving_id ?? null,
          ended_by_move_id: end.ended_by_move_id ?? null,
        })
        .where('id', '=', first)
        .execute();
    }

    it('joins a row into the one before it, which takes its end and own end', async () => {
      const oxford = await classes.schoolClass(north, year);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      const { first, second } = await asMigrator(async (transaction) => {
        const rows = await pair(transaction, { classId: oxford, student });
        await join(transaction, rows.first, rows.second, { valid_until: YEAR_END });
        return rows;
      });
      expect(await members.rowOf(first)).toMatchObject({
        valid_from: '2026-09-01',
        valid_until: YEAR_END,
        own_until: YEAR_END,
        ended_by: null,
      });
      expect(await members.rowOf(second)).toMatchObject({
        valid_from: '2026-10-01',
        valid_until: '2026-10-01',
        ended_by: 'joined',
      });
    });

    it('takes over an end of a leaving and of a live move', async () => {
      const oxford = await classes.schoolClass(north, year);
      const yale = await classes.schoolClass(north, year);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      const first = await asMigrator(async (transaction) => {
        const move = await members.move(
          {
            branch: north,
            studentId: student,
            from: '2026-11-02',
            fromClassId: oxford,
            toClassId: yale,
          },
          transaction,
        );
        const rows = await pair(transaction, {
          classId: oxford,
          student,
          second: { until: '2026-11-02', endedBy: 'transfer', endedByMoveId: move },
        });
        await members.member(
          {
            branch: north,
            classId: yale,
            studentId: student,
            from: '2026-11-02',
            cause: 'transfer',
            writtenByMoveId: move,
          },
          transaction,
        );
        await join(transaction, rows.first, rows.second, {
          valid_until: '2026-11-02',
          ended_by: 'transfer',
          ended_by_move_id: move,
        });
        return rows.first;
      });
      expect(await members.rowOf(first)).toMatchObject({
        valid_until: '2026-11-02',
        ended_by: 'transfer',
      });
      const other = await members.student(north, { startsOn: '2026-09-01' });
      const leaving = await asMigrator(async (transaction) => {
        const out = await members.leaving(transaction, north, other, '2026-12-01');
        const rows = await pair(transaction, {
          classId: oxford,
          student: other,
          second: { until: '2026-12-01', endedBy: 'leaving', leavingId: out },
        });
        await join(transaction, rows.first, rows.second, {
          valid_until: '2026-12-01',
          ended_by: 'leaving',
          leaving_id: out,
        });
        return out;
      });
      const held = await database.migrator
        .selectFrom('class_memberships')
        .select(['valid_until', 'ended_by', 'leaving_id'])
        .where('student_id', '=', other)
        .where('ended_by', '<>', 'joined')
        .execute();
      expect(held).toEqual([
        { valid_until: '2026-12-01', ended_by: 'leaving', leaving_id: leaving },
      ]);
    });

    it('joins rows of a closed year (decision 5): a join changes no day', async () => {
      const east = await insertBranch(database.migrator, 'East');
      const closedYear = await classes.year(east, 'current', '2025-09-01', '2026-05-31');
      const old = await classes.schoolClass(east, closedYear);
      const student = await members.student(east, { startsOn: '2025-09-01' });
      await asMigrator(async (transaction) => {
        const first = await members.member(
          {
            branch: east,
            classId: old,
            studentId: student,
            from: '2025-09-01',
            ownUntil: '2026-01-10',
          },
          transaction,
        );
        const second = await members.member(
          {
            branch: east,
            classId: old,
            studentId: student,
            from: '2026-01-10',
            ownUntil: '2026-06-01',
          },
          transaction,
        );
        await transaction
          .updateTable('academic_years')
          .set({ status: 'closed' })
          .where('id', '=', closedYear)
          .execute();
        await join(transaction, first, second, {
          valid_until: '2026-06-01',
          own_until: '2026-06-01',
        });
      });
      const held = await database.migrator
        .selectFrom('class_memberships')
        .select(['valid_from', 'valid_until'])
        .where('student_id', '=', student)
        .whereRef('valid_from', '<', 'valid_until')
        .execute();
      expect(held).toEqual([{ valid_from: '2025-09-01', valid_until: '2026-06-01' }]);
    });

    it('refuses a join of rows with a gap, of another class or of another student', async () => {
      const oxford = await classes.schoolClass(north, year);
      const yale = await classes.schoolClass(north, year);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      const other = await members.student(north, { startsOn: '2026-09-01' });
      for (const later of [
        { classId: oxford, studentId: student, from: '2026-10-02' },
        { classId: yale, studentId: student, from: '2026-10-01' },
        { classId: oxford, studentId: other, from: '2026-10-01' },
      ]) {
        expect(
          await refusal(
            asMigrator(async (transaction) => {
              const first = await members.member(
                {
                  branch: north,
                  classId: oxford,
                  studentId: student,
                  from: '2026-09-01',
                  ownUntil: '2026-10-01',
                },
                transaction,
              );
              const second = await members.member({ branch: north, ...later }, transaction);
              await join(transaction, first, second, { valid_until: YEAR_END });
            }),
          ),
        ).toMatchObject({ constraint: 'class_memberships_join' });
      }
    });

    it('refuses a row emptied into a row that does not take its days and end (correction 3)', async () => {
      const oxford = await classes.schoolClass(north, year);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      // Emptied, and the row named never grown: a stay lost.
      expect(
        await refusal(
          asMigrator(async (transaction) => {
            const rows = await pair(transaction, { classId: oxford, student });
            await transaction
              .updateTable('class_memberships')
              .set({
                valid_until: sql<string>`valid_from`,
                ended_by: 'joined',
                joined_into_id: rows.first,
                joined_xact: sql<string>`pg_current_xact_id()`,
              })
              .where('id', '=', rows.second)
              .execute();
          }),
        ),
      ).toMatchObject({ constraint: 'class_memberships_join' });
      // Grown to the end, but not with the end the joined row had.
      const out = await members.student(north, { startsOn: '2026-09-01' });
      expect(
        await refusal(
          asMigrator(async (transaction) => {
            const leaving = await members.leaving(transaction, north, out, '2026-12-01');
            const rows = await pair(transaction, {
              classId: oxford,
              student: out,
              second: { until: '2026-12-01', endedBy: 'leaving', leavingId: leaving },
            });
            await join(transaction, rows.first, rows.second, {
              valid_until: '2026-12-01',
              ended_by: 'leaving',
              leaving_id: leaving,
              own_until: '2027-05-01',
            });
          }),
        ),
      ).toMatchObject({ constraint: 'class_memberships_join' });
    });

    it('keeps a joined row final, except for the carry of a merge', async () => {
      const oxford = await classes.schoolClass(north, year);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      const second = await asMigrator(async (transaction) => {
        const rows = await pair(transaction, { classId: oxford, student });
        await join(transaction, rows.first, rows.second, { valid_until: YEAR_END });
        return rows.second;
      });
      expect(
        await refusal(
          inBranch((transaction) =>
            transaction
              .updateTable('class_memberships')
              .set({
                valid_until: '2026-12-01',
                ended_by: null,
                joined_into_id: null,
                joined_xact: null,
              })
              .where('id', '=', second)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'class_memberships_only_shrink' });
    });
  });

  // The spec review of the build, must-fix 1 and 4: a join holds its row to
  // the joined rows' days and end; every refusal branch of the new guards is
  // reached by a test of its own, nothing before it refusing first.
  describe('the guards of a join and of a row given back, branch by branch', () => {
    /** A student of a new class with a group row, back to back with a second pair of rows, in one transaction of the migrator. */
    async function twoPairs(
      transaction: Transaction,
      oxford: string,
      group: string | null,
      student: string,
    ) {
      const rows = [
        await members.member(
          {
            branch: north,
            classId: oxford,
            studentId: student,
            from: '2026-09-01',
            ownUntil: '2026-10-01',
          },
          transaction,
        ),
        await members.member(
          {
            branch: north,
            classId: oxford,
            studentId: student,
            from: '2026-10-01',
            ownUntil: '2026-12-01',
          },
          transaction,
        ),
      ];
      if (group === null) {
        return { rows, groupRows: [] };
      }
      const groupRows = [
        await members.groupMember(
          {
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2026-09-01',
            ownUntil: '2026-10-01',
          },
          transaction,
        ),
        await members.groupMember(
          {
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2026-10-01',
            ownUntil: '2026-12-01',
          },
          transaction,
        ),
      ];
      return { rows, groupRows };
    }

    /** Empties the later row into the earlier one, which then takes the end given. */
    async function joinAs(
      transaction: Transaction,
      table: 'class_memberships' | 'group_memberships',
      [first, second]: string[],
      end: Record<string, unknown>,
    ) {
      await transaction
        .updateTable(table)
        .set({
          valid_until: sql<string>`valid_from`,
          ended_by: 'joined',
          joined_into_id: first ?? '',
          joined_xact: sql<string>`pg_current_xact_id()`,
          leaving_id: null,
          ended_by_move_id: null,
          ended_by_branch_move_id: null,
        })
        .where('id', '=', second ?? '')
        .execute();
      await transaction
        .updateTable(table)
        .set(end)
        .where('id', '=', first ?? '')
        .execute();
    }

    it('refuses a join that grows past the joined row or changes its own end, for a class and a group', async () => {
      const plain = await classes.schoolClass(north, year);
      const oxford = await classes.schoolClass(north, year);
      const group = await classes.group(north, year, maths, [oxford]);
      for (const [table, end] of [
        // Past the end the joined row had, with no end at all.
        [
          'class_memberships',
          { valid_until: YEAR_END, own_until: YEAR_END, ended_by: null, leaving_id: null },
        ],
        // Its days, but another own end and end than the joined row had.
        [
          'group_memberships',
          { valid_until: '2026-12-01', own_until: YEAR_END, ended_by: 'leaving' },
        ],
      ] as const) {
        const student = await members.student(north, { startsOn: '2026-09-01' });
        expect(
          await refusal(
            asMigrator(async (transaction) => {
              // The class without a group, so that only the join can refuse.
              const { rows, groupRows } = await twoPairs(
                transaction,
                table === 'class_memberships' ? plain : oxford,
                table === 'class_memberships' ? null : group,
                student,
              );
              if (table === 'group_memberships') {
                // The class rows joined as they should be; only the group's join is wrong.
                await joinAs(transaction, 'class_memberships', rows, {
                  valid_until: '2026-12-01',
                  own_until: '2026-12-01',
                });
              }
              await joinAs(
                transaction,
                table,
                table === 'class_memberships' ? rows : groupRows,
                table === 'class_memberships'
                  ? end
                  : {
                      ...end,
                      leaving_id: await members.leaving(transaction, north, student, '2026-12-01'),
                    },
              );
            }),
          ),
        ).toMatchObject({
          constraint:
            table === 'class_memberships' ? 'class_memberships_join' : 'group_memberships_join',
        });
      }
    });

    it('refuses a join written in another transaction and the join of a row with no days', async () => {
      const oxford = await classes.schoolClass(north, year);
      const group = await classes.group(north, year, maths, [oxford]);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      expect(
        await refusal(
          asMigrator(async (transaction) => {
            const { rows } = await twoPairs(transaction, oxford, group, student);
            await transaction
              .updateTable('class_memberships')
              .set({
                valid_until: sql<string>`valid_from`,
                ended_by: 'joined',
                joined_into_id: rows[0] ?? '',
                joined_xact: sql<string>`'1'::xid8`,
                leaving_id: null,
              })
              .where('id', '=', rows[1] ?? '')
              .execute();
          }),
        ),
      ).toMatchObject({ constraint: 'class_memberships_join' });
      // A planned row a leaving emptied holds no day: it is never joined.
      const planned = await classes.schoolClass(north, year);
      const other = await members.student(north, { startsOn: '2026-09-01' });
      const { first, empty } = await asMigrator(async (transaction) => {
        const out = await members.leaving(transaction, north, other, '2026-10-20');
        return {
          first: await members.member(
            {
              branch: north,
              classId: planned,
              studentId: other,
              from: '2026-09-01',
              until: '2026-10-20',
              ownUntil: '2026-11-02',
              endedBy: 'leaving',
              leavingId: out,
            },
            transaction,
          ),
          empty: await members.member(
            {
              branch: north,
              classId: planned,
              studentId: other,
              from: '2026-11-02',
              until: '2026-11-02',
              endedBy: 'leaving',
              leavingId: out,
            },
            transaction,
          ),
        };
      });
      expect(
        await refusal(
          asMigrator((transaction) =>
            transaction
              .updateTable('class_memberships')
              .set({
                ended_by: 'joined',
                leaving_id: null,
                joined_into_id: first,
                joined_xact: sql<string>`pg_current_xact_id()`,
              })
              .where('id', '=', empty)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'class_memberships_join' });
    });

    it('never grows a group row a class withdraw emptied, nor a class row an undo emptied', async () => {
      const oxford = await classes.schoolClass(north, year);
      const group = await classes.group(north, year, maths, [oxford]);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      const { groupRow } = await asMigrator(async (transaction) => {
        await members.member(
          { branch: north, classId: oxford, studentId: student, from: '2026-11-02' },
          transaction,
        );
        return {
          groupRow: await members.groupMember(
            {
              branch: north,
              groupId: group,
              subjectId: maths,
              studentId: student,
              from: '2026-11-02',
            },
            transaction,
          ),
        };
      });
      await inBranch(async (transaction) => {
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-11-02', ended_by: 'withdrawn' })
          .where('student_id', '=', student)
          .execute();
        await transaction
          .updateTable('group_memberships')
          .set({ valid_until: '2026-11-02', ended_by: 'class_withdrawn' })
          .where('id', '=', groupRow)
          .execute();
      });
      expect(
        await refusal(
          inBranch((transaction) => growBack(transaction, 'group_memberships', groupRow)),
        ),
      ).toMatchObject({ constraint: 'group_memberships_only_shrink' });
      // An undone target row of a move stays empty for good.
      const { oxford: from, yale, student: mover, row } = await pupil();
      const move = await members.move({
        branch: north,
        studentId: mover,
        from: '2026-10-07',
        fromClassId: from,
        toClassId: yale,
      });
      const target = await inBranch(async (transaction) => {
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-10-07', ended_by: 'transfer', ended_by_move_id: move })
          .where('id', '=', row)
          .execute();
        return members.member(
          {
            branch: north,
            classId: yale,
            studentId: mover,
            from: '2026-10-07',
            cause: 'transfer',
            writtenByMoveId: move,
          },
          transaction,
        );
      });
      await inBranch(async (transaction) => {
        await transaction
          .updateTable('student_moves')
          .set({ undone_at: new Date(NOW), reason: 'Typed by mistake' })
          .where('id', '=', move)
          .execute();
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-10-07', ended_by: 'undone', ended_by_move_id: move })
          .where('id', '=', target)
          .execute();
        await growBack(transaction, 'class_memberships', row);
      });
      // The row the move cut grows back once the move is undone.
      expect(await members.rowOf(row)).toMatchObject({
        valid_from: '2026-09-01',
        valid_until: YEAR_END,
        ended_by: null,
      });
      expect(
        await refusal(
          inBranch((transaction) => growBack(transaction, 'class_memberships', target)),
        ),
      ).toMatchObject({ constraint: 'class_memberships_only_shrink' });
    });

    it('keeps a row a move to another branch cut final, except as the joined row of a join (correction 2)', async () => {
      const south = await insertBranch(database.migrator, 'One stay South');
      await classes.year(south);
      const oxford = await classes.schoolClass(north, year);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      const southClass = await classes.schoolClass(
        south,
        (
          await database.migrator
            .selectFrom('academic_years')
            .select('id')
            .where('branch_id', '=', south)
            .executeTakeFirstOrThrow()
        ).id,
      );
      const accept = async (transaction: Transaction, row: string) => {
        const release = await transaction
          .insertInto('student_branch_moves')
          .values({
            branch_id: north,
            student_id: student,
            from_branch_id: north,
            to_branch_id: south,
            effective_on: '2026-10-14',
            released_at: new Date(NOW),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .updateTable('student_branch_moves')
          .set({ accepted_at: new Date(NOW) })
          .where('id', '=', release.id)
          .execute();
        await transaction
          .updateTable('class_memberships')
          .set({
            valid_until: '2026-10-14',
            ended_by: 'branch_move',
            ended_by_branch_move_id: release.id,
          })
          .where('id', '=', row)
          .execute();
        await transaction
          .updateTable('students')
          .set({ branch_id: south })
          .where('id', '=', student)
          .execute();
        await transaction
          .insertInto('class_memberships')
          .values({
            branch_id: south,
            student_id: student,
            class_id: southClass,
            valid_from: '2026-10-14',
            valid_until: YEAR_END,
            own_until: YEAR_END,
            cause: 'branch_move',
          })
          .execute();
      };
      const asBoth = <T>(work: (transaction: Transaction) => Promise<T>) =>
        database.migrator.transaction().execute(async (transaction) => {
          await sql`
            select set_config(${BRANCH_SETTING}, ${`{${north},${south}}`}, true),
              set_config(${MOMENT_SETTING}, ${new Date(NOW).toISOString()}, true)
          `.execute(transaction);
          return work(transaction);
        });
      const [first, second] = await asBoth(async (transaction) => {
        const rows = [
          await members.member(
            {
              branch: north,
              classId: oxford,
              studentId: student,
              from: '2026-09-01',
              ownUntil: '2026-10-01',
            },
            transaction,
          ),
          await members.member(
            { branch: north, classId: oxford, studentId: student, from: '2026-10-01' },
            transaction,
          ),
        ];
        await accept(transaction, rows[1] ?? '');
        // The join: the earlier row takes the end of the move to the South.
        const release = await transaction
          .selectFrom('student_branch_moves')
          .select('id')
          .where('student_id', '=', student)
          .executeTakeFirstOrThrow();
        await joinAs(transaction, 'class_memberships', rows, {
          valid_until: '2026-10-14',
          own_until: YEAR_END,
          ended_by: 'branch_move',
          ended_by_branch_move_id: release.id,
        });
        return rows;
      });
      expect(await members.rowOf(first ?? '')).toMatchObject({
        valid_until: '2026-10-14',
        ended_by: 'branch_move',
      });
      expect(await members.rowOf(second ?? '')).toMatchObject({ ended_by: 'joined' });
      // Changed any other way, it is refused: grown, or emptied.
      for (const values of [
        { valid_until: YEAR_END, ended_by: null, ended_by_branch_move_id: null },
        { valid_until: '2026-09-01', ended_by: 'withdrawn', ended_by_branch_move_id: null },
      ] as const) {
        expect(
          await refusal(
            asBoth((transaction) =>
              transaction
                .updateTable('class_memberships')
                .set(values)
                .where('id', '=', first ?? '')
                .execute(),
            ),
          ),
        ).toMatchObject({ constraint: 'class_memberships_only_shrink' });
      }
    });

    it('refuses the days given back to a group archived meanwhile', async () => {
      const oxford = await classes.schoolClass(north, year);
      const group = await classes.group(north, year, maths, [oxford]);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      const { row, groupRow } = await asMigrator(async (transaction) => ({
        row: await members.member(
          { branch: north, classId: oxford, studentId: student, from: '2026-09-01' },
          transaction,
        ),
        groupRow: await members.groupMember(
          {
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2026-09-01',
          },
          transaction,
        ),
      }));
      const leaving = await inBranch((transaction) =>
        leave(transaction, student, '2026-10-10', [
          { table: 'class_memberships', id: row },
          { table: 'group_memberships', id: groupRow },
        ]),
      );
      await database.migrator
        .updateTable('groups')
        .set({ archived_at: new Date(NOW) })
        .where('id', '=', group)
        .execute();
      expect(
        await refusal(
          inBranch(async (transaction) => {
            await takeBack(transaction, student, leaving);
            await growBack(transaction, 'class_memberships', row);
            await growBack(transaction, 'group_memberships', groupRow);
          }),
        ),
      ).toMatchObject({ constraint: 'group_memberships_group_archived' });
    });
  });

  // The review of the build, round 2, finding 1: the group copies of the
  // guards, each reached with nothing before it refusing first.
  describe('the group copies of the guards of a join and of a row given back', () => {
    /** The refusal of the statement itself, before any check deferred to the commit runs; then rolled back. */
    async function refusedAtOnce(
      work: (transaction: Transaction) => Promise<unknown>,
    ): Promise<{ code?: string; constraint?: string } | 'not refused'> {
      let caught: { code?: string; constraint?: string } | 'not refused' = 'not refused';
      await refusal(
        asMigrator(async (transaction) => {
          try {
            await work(transaction);
          } catch (error) {
            caught = error as { code?: string; constraint?: string };
          }
          throw new Error('Rolled back.');
        }),
      );
      return caught;
    }

    /** A student of a new class with a row of a maths group the class feeds, from 1 September. */
    async function groupPupil() {
      const oxford = await classes.schoolClass(north, year);
      const group = await classes.group(north, year, maths, [oxford]);
      const other = await classes.group(north, year, maths, [oxford]);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      const { row, groupRow } = await asMigrator(async (transaction) => ({
        row: await members.member(
          { branch: north, classId: oxford, studentId: student, from: '2026-09-01' },
          transaction,
        ),
        groupRow: await members.groupMember(
          {
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2026-09-01',
          },
          transaction,
        ),
      }));
      return { oxford, group, other, student, row, groupRow };
    }

    it('grows a group row a leaving cut only once the leaving is taken back', async () => {
      const one = await groupPupil();
      const leaving = await inBranch((transaction) =>
        leave(transaction, one.student, '2026-11-01', [
          { table: 'class_memberships', id: one.row },
          { table: 'group_memberships', id: one.groupRow },
        ]),
      );
      // The group row alone, while the leaving stands: refused by the row's
      // own guard, at the statement.
      expect(
        await refusal(
          inBranch((transaction) => growBack(transaction, 'group_memberships', one.groupRow)),
        ),
      ).toMatchObject({ constraint: 'group_memberships_only_shrink' });
      await inBranch(async (transaction) => {
        await takeBack(transaction, one.student, leaving);
        await growBack(transaction, 'class_memberships', one.row);
        await growBack(transaction, 'group_memberships', one.groupRow);
      });
      expect(await members.groupRowOf(one.groupRow)).toMatchObject({
        valid_from: '2026-09-01',
        valid_until: YEAR_END,
        ended_by: null,
        leaving_id: null,
      });
    });

    it('grows a group row a move cut once the move is cancelled, and refuses it while the move is live', async () => {
      const one = await groupPupil();
      const move = await members.move({
        branch: north,
        studentId: one.student,
        from: '2026-10-20',
        fromGroupId: one.group,
        toGroupId: one.other,
        subjectId: maths,
      });
      const target = await inBranch(async (transaction) => {
        await transaction
          .updateTable('group_memberships')
          .set({ valid_until: '2026-10-20', ended_by: 'transfer', ended_by_move_id: move })
          .where('id', '=', one.groupRow)
          .execute();
        return members.groupMember(
          {
            branch: north,
            groupId: one.other,
            subjectId: maths,
            studentId: one.student,
            from: '2026-10-20',
            cause: 'transfer',
            writtenByMoveId: move,
          },
          transaction,
        );
      });
      expect(
        await refusal(
          inBranch((transaction) => growBack(transaction, 'group_memberships', one.groupRow)),
        ),
      ).toMatchObject({ constraint: 'group_memberships_only_shrink' });
      await inBranch(async (transaction) => {
        await transaction
          .updateTable('student_moves')
          .set({ cancelled_at: new Date(NOW) })
          .where('id', '=', move)
          .execute();
        await transaction
          .updateTable('group_memberships')
          .set({ valid_until: '2026-10-20', ended_by: 'withdrawn' })
          .where('id', '=', target)
          .execute();
        await growBack(transaction, 'group_memberships', one.groupRow);
      });
      expect(await members.groupRowOf(one.groupRow)).toMatchObject({
        valid_until: YEAR_END,
        ended_by: null,
      });
    });

    it('grows a group row up to a leaving that stands, never to one taken back', async () => {
      const one = await groupPupil();
      const first = await inBranch((transaction) =>
        leave(transaction, one.student, '2026-11-01', [
          { table: 'class_memberships', id: one.row },
          { table: 'group_memberships', id: one.groupRow },
        ]),
      );
      // The replace of the scheduled leaving by a later one; the class row
      // takes the new leaving, the group row the one named.
      const replace = (named: 'first' | 'second') =>
        inBranch(async (transaction) => {
          await transaction
            .updateTable('student_statuses')
            .set({ valid_until: '2026-11-01' })
            .where('id', '=', first)
            .execute();
          await transaction
            .insertInto('student_statuses')
            .values({
              student_id: one.student,
              branch_id: north,
              status: 'active',
              valid_from: '2026-11-01',
              valid_until: '2026-12-01',
              cause: 'cancel',
            })
            .execute();
          const second = await transaction
            .insertInto('student_statuses')
            .values({
              student_id: one.student,
              branch_id: north,
              status: 'inactive',
              valid_from: '2026-12-01',
              cause: 'leaving',
              reason: 'Moved to another city',
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await transaction
            .updateTable('class_memberships')
            .set({ valid_until: '2026-12-01', ended_by: 'leaving', leaving_id: second.id })
            .where('id', '=', one.row)
            .execute();
          await transaction
            .updateTable('group_memberships')
            .set({
              valid_until: '2026-12-01',
              ended_by: 'leaving',
              leaving_id: named === 'first' ? first : second.id,
            })
            .where('id', '=', one.groupRow)
            .execute();
        });
      expect(await refusal(replace('first'))).toMatchObject({
        constraint: 'group_memberships_only_shrink',
      });
      await replace('second');
      expect(await members.groupRowOf(one.groupRow)).toMatchObject({
        valid_until: '2026-12-01',
        ended_by: 'leaving',
      });
    });

    it('refuses the days given back to a group of a closed year', async () => {
      // A group move undone and the group row it cut grown back, the year
      // closed before the commit: only the group rows change, and the
      // commit check of the group refuses the days given back.
      const west = await insertBranch(database.migrator, 'One stay West');
      const closedYear = await classes.year(west, 'current', '2025-09-01', '2026-05-31');
      const old = await classes.schoolClass(west, closedYear);
      const group = await classes.group(west, closedYear, maths, [old]);
      const other = await classes.group(west, closedYear, maths, [old]);
      const student = await members.student(west, { startsOn: '2025-09-01' });
      const groupRow = await database.migrator.transaction().execute(async (transaction) => {
        await members.member(
          {
            branch: west,
            classId: old,
            studentId: student,
            from: '2025-09-01',
            ownUntil: '2026-06-01',
          },
          transaction,
        );
        return members.groupMember(
          {
            branch: west,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2025-09-01',
            ownUntil: '2026-06-01',
          },
          transaction,
        );
      });
      const move = await members.move({
        branch: west,
        studentId: student,
        from: '2026-03-02',
        fromGroupId: group,
        toGroupId: other,
        subjectId: maths,
      });
      await transactions.run([west], async (transaction) => {
        await transaction
          .updateTable('group_memberships')
          .set({ valid_until: '2026-03-02', ended_by: 'transfer', ended_by_move_id: move })
          .where('id', '=', groupRow)
          .execute();
        await members.groupMember(
          {
            branch: west,
            groupId: other,
            subjectId: maths,
            studentId: student,
            from: '2026-03-02',
            ownUntil: '2026-06-01',
            cause: 'transfer',
            writtenByMoveId: move,
          },
          transaction,
        );
      });
      const undo = (close: boolean) =>
        database.migrator.transaction().execute(async (transaction) => {
          await sql`
            select set_config(${BRANCH_SETTING}, ${`{${west}}`}, true),
              set_config(${MOMENT_SETTING}, ${new Date(NOW).toISOString()}, true)
          `.execute(transaction);
          await transaction
            .updateTable('student_moves')
            .set({ undone_at: new Date(NOW), reason: 'Typed by mistake' })
            .where('id', '=', move)
            .execute();
          await transaction
            .updateTable('group_memberships')
            .set({ valid_until: '2026-03-02', ended_by: 'undone', ended_by_move_id: move })
            .where('written_by_move_id', '=', move)
            .execute();
          await transaction
            .updateTable('group_memberships')
            .set({ valid_until: '2026-06-01', ended_by: null, ended_by_move_id: null })
            .where('id', '=', groupRow)
            .execute();
          if (close) {
            await transaction
              .updateTable('academic_years')
              .set({ status: 'closed' })
              .where('id', '=', closedYear)
              .execute();
          }
          // The checks of the commit, run now; then nothing is kept.
          await sql`set constraints all immediate`.execute(transaction);
          throw new Error('Rolled back.');
        });
      // The same undo with the year left open reaches the end: only the
      // closed year refuses.
      expect(await refusal(undo(false))).toMatchObject({ message: 'Rolled back.' });
      expect(await refusal(undo(true))).toMatchObject({ constraint: 'class_year_closed' });
    });

    it('refuses at the statement a group join of rows with a gap, of another group, of another student or of a row with no days', async () => {
      const oxford = await classes.schoolClass(north, year);
      const group = await classes.group(north, year, maths, [oxford]);
      const other = await classes.group(north, year, maths, [oxford]);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      const someone = await members.student(north, { startsOn: '2026-09-01' });
      const join = (transaction: Transaction, later: string, into: string) =>
        transaction
          .updateTable('group_memberships')
          .set({
            valid_until: sql<string>`valid_from`,
            ended_by: 'joined',
            joined_into_id: into,
            joined_xact: sql<string>`pg_current_xact_id()`,
            leaving_id: null,
            ended_by_move_id: null,
          })
          .where('id', '=', later)
          .execute();
      for (const later of [
        { groupId: group, studentId: student, from: '2026-10-02' },
        { groupId: other, studentId: student, from: '2026-10-01' },
        { groupId: group, studentId: someone, from: '2026-10-01' },
      ]) {
        expect(
          await refusedAtOnce(async (transaction) => {
            for (const studentId of [student, someone]) {
              await members.member(
                { branch: north, classId: oxford, studentId, from: '2026-09-01' },
                transaction,
              );
            }
            const first = await members.groupMember(
              {
                branch: north,
                groupId: group,
                subjectId: maths,
                studentId: student,
                from: '2026-09-01',
                ownUntil: '2026-10-01',
              },
              transaction,
            );
            const second = await members.groupMember(
              { branch: north, subjectId: maths, ...later },
              transaction,
            );
            await join(transaction, second, first);
          }),
        ).toMatchObject({ constraint: 'group_memberships_join' });
      }
      // A planned row a leaving emptied, right where the earlier row ends:
      // only its having no day refuses.
      expect(
        await refusedAtOnce(async (transaction) => {
          const out = await members.leaving(transaction, north, student, '2026-11-02');
          await members.member(
            {
              branch: north,
              classId: oxford,
              studentId: student,
              from: '2026-09-01',
              until: '2026-11-02',
              endedBy: 'leaving',
              leavingId: out,
            },
            transaction,
          );
          const first = await members.groupMember(
            {
              branch: north,
              groupId: group,
              subjectId: maths,
              studentId: student,
              from: '2026-09-01',
              ownUntil: '2026-11-02',
            },
            transaction,
          );
          const empty = await members.groupMember(
            {
              branch: north,
              groupId: group,
              subjectId: maths,
              studentId: student,
              from: '2026-11-02',
              until: '2026-11-02',
              endedBy: 'leaving',
              leavingId: out,
            },
            transaction,
          );
          await join(transaction, empty, first);
        }),
      ).toMatchObject({ constraint: 'group_memberships_join' });
    });
  });

  describe('a changed move names the move it replaced (H34)', () => {
    it('takes a cancelled move of the same student and kind only, and fills it once', async () => {
      const { oxford, yale, student } = await pupil();
      const other = await pupil();
      const first = await members.move({
        branch: north,
        studentId: student,
        from: '2026-10-20',
        fromClassId: oxford,
        toClassId: yale,
      });
      const insert = (replaced: string, studentId = student) =>
        inBranch((transaction) =>
          transaction
            .insertInto('student_moves')
            .values({
              branch_id: north,
              student_id: studentId,
              kind: 'class',
              from_class_id: studentId === student ? oxford : other.oxford,
              to_class_id: studentId === student ? yale : other.yale,
              effective_on: '2026-10-27',
              made_at: new Date(NOW),
              replaces_move_id: replaced,
            })
            .returning('id')
            .executeTakeFirstOrThrow(),
        );
      // A live move is not replaced.
      expect(await refusal(insert(first))).toMatchObject({ constraint: 'student_moves_replaces' });
      await inBranch((transaction) =>
        transaction
          .updateTable('student_moves')
          .set({ cancelled_at: new Date(NOW) })
          .where('id', '=', first)
          .execute(),
      );
      // Nor a move of another student.
      expect(await refusal(insert(first, other.student))).toMatchObject({
        constraint: 'student_moves_replaces',
      });
      const second = await insert(first);
      // The application never changes it afterwards.
      expect(
        await refusal(
          inBranch((transaction) =>
            transaction
              .updateTable('student_moves')
              .set({ replaces_move_id: null })
              .where('id', '=', second.id)
              .execute(),
          ),
        ),
      ).toMatchObject({ code: '42501' });
      // The migration's fill: once, where it is empty, nothing else changing.
      const third = await members.move({
        branch: north,
        studentId: student,
        from: '2026-11-03',
        fromClassId: oxford,
        toClassId: yale,
      });
      const fourth = await members.move({
        branch: north,
        studentId: student,
        from: '2026-11-10',
        fromClassId: oxford,
        toClassId: yale,
      });
      await inBranch((transaction) =>
        transaction
          .updateTable('student_moves')
          .set({ cancelled_at: new Date(NOW) })
          .where('id', '=', fourth)
          .execute(),
      );
      expect(
        await refusal(
          database.migrator
            .updateTable('student_moves')
            .set({ replaces_move_id: fourth })
            .where('id', '=', second.id)
            .execute(),
        ),
      ).toMatchObject({ constraint: 'student_moves_state' });
      expect(
        await refusal(
          database.migrator
            .updateTable('student_moves')
            .set({ replaces_move_id: fourth, effective_on: '2026-11-04' })
            .where('id', '=', third)
            .execute(),
        ),
      ).toMatchObject({ constraint: 'student_moves_state' });
      await database.migrator
        .updateTable('student_moves')
        .set({ replaces_move_id: fourth })
        .where('id', '=', third)
        .execute();
      const filled = await database.migrator
        .selectFrom('student_moves')
        .select('replaces_move_id')
        .where('id', '=', third)
        .executeTakeFirstOrThrow();
      expect(filled.replaces_move_id).toBe(fourth);
    });

    it('refuses a move of another kind or subject as the one replaced, and a move replaced twice', async () => {
      const { oxford, yale, student } = await pupil();
      const physics = await classes.subject({ grades: [7, 8] });
      const [algebra, geometry, optics, mechanics] = [
        await classes.group(north, year, maths, [oxford]),
        await classes.group(north, year, maths, [oxford]),
        await classes.group(north, year, physics, [oxford]),
        await classes.group(north, year, physics, [oxford]),
      ];
      const cancelled = async (row: Parameters<MembersKit['move']>[0]) => {
        const id = await members.move(row);
        await inBranch((transaction) =>
          transaction
            .updateTable('student_moves')
            .set({ cancelled_at: new Date(NOW) })
            .where('id', '=', id)
            .execute(),
        );
        return id;
      };
      const classMove = await cancelled({
        branch: north,
        studentId: student,
        from: '2026-10-20',
        fromClassId: oxford,
        toClassId: yale,
      });
      const mathsMove = await cancelled({
        branch: north,
        studentId: student,
        from: '2026-10-20',
        fromGroupId: algebra ?? '',
        toGroupId: geometry ?? '',
        subjectId: maths,
      });
      const groupMove = (subject: string, from: string, to: string, replaced: string) =>
        inBranch((transaction) =>
          transaction
            .insertInto('student_moves')
            .values({
              branch_id: north,
              student_id: student,
              kind: 'group',
              subject_id: subject,
              from_group_id: from,
              to_group_id: to,
              effective_on: '2026-10-27',
              made_at: new Date(NOW),
              replaces_move_id: replaced,
            })
            .returning('id')
            .executeTakeFirstOrThrow(),
        );
      // A group move does not replace a class move.
      expect(
        await refusal(groupMove(maths, algebra ?? '', geometry ?? '', classMove)),
      ).toMatchObject({ constraint: 'student_moves_replaces' });
      // A physics move does not replace a maths move.
      expect(
        await refusal(groupMove(physics, optics ?? '', mechanics ?? '', mathsMove)),
      ).toMatchObject({ constraint: 'student_moves_replaces' });
      // The maths move replaces it, once only.
      await groupMove(maths, algebra ?? '', geometry ?? '', mathsMove);
      expect(
        await refusal(groupMove(maths, algebra ?? '', geometry ?? '', mathsMove)),
      ).toMatchObject({ code: '23505', constraint: 'student_moves_replaces_idx' });
    });
  });
});
