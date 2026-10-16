import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import {
  BRANCH_SETTING,
  MOMENT_SETTING,
  Transactions,
  type Transaction,
} from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { MembersKit, moveStudentBranch } from '../../testing/members-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

/** Wednesday 14 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-14T10:00:00+05:00';

/** The constraint a promise was refused with, `written` when it was not. */
const outcome = (work: Promise<unknown>): Promise<string | undefined> =>
  work.then(
    () => 'written',
    (error: unknown) => (error as { constraint?: string }).constraint,
  );

// The dates of a year against its class and group stays (db/migrations/0064;
// owner's answer of 15 October 2026, L128): a year is made longer at any time
// and shorter only when no stay stands in the days cut off; a stay that runs
// to the year's last day follows it, and nothing else may move an own end.
describe('the dates of a year and its stays in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let classes: ClassesKit;
  let members: MembersKit;
  let maths: string;
  let count = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** A fresh branch with a year from 1 September 2026 to 31 May 2027, a class and a group. */
  async function setting() {
    count += 1;
    const branch = await insertBranch(database.migrator, `Year dates ${String(count)}`);
    const year = await classes.year(branch);
    const oxford = await classes.schoolClass(branch, year, { name: 'Oxford', grade: 7 });
    const grouped = await classes.schoolClass(branch, year, { name: 'Yale', grade: 7 });
    const group = await classes.group(branch, year, maths, [grouped]);
    return { branch, year, oxford, grouped, group };
  }

  /** A student of the grouped class with a class row and a group row, in one transaction. */
  async function groupedStudent(
    setup: { branch: string; grouped: string; group: string },
    from = '2026-09-01',
  ) {
    const student = await members.student(setup.branch);
    return inBranch(setup.branch, async (transaction) => ({
      student,
      classRow: await members.member(
        { branch: setup.branch, classId: setup.grouped, studentId: student, from },
        transaction,
      ),
      groupRow: await members.groupMember(
        { branch: setup.branch, groupId: setup.group, subjectId: maths, studentId: student, from },
        transaction,
      ),
    }));
  }

  const setDates = (branch: string, year: string, start: string, end: string) =>
    inBranch(branch, (transaction) =>
      transaction
        .updateTable('academic_years')
        .set({ start_date: start, end_date: end })
        .where('id', '=', year)
        .execute(),
    );

  const holds = (branch: string, year: string, start: string, end: string) =>
    inBranch(branch, async (transaction) => {
      const found = await sql<{ row_id: string }>`
        select row_id from year_cut_holds(${year}, ${start}::date, ${end}::date)
      `.execute(transaction);
      return found.rows.map((row) => row.row_id);
    });

  /** The migrator in a transaction with the branch filter and the moment set, as the app's would be. */
  const asMigrator = <T>(
    branch: string,
    work: (transaction: Transaction) => Promise<T>,
    moment = NOW,
  ) =>
    database.migrator.transaction().execute(async (transaction) => {
      await sql`
        select set_config(${BRANCH_SETTING}, ${`{${branch}}`}, true),
          set_config(${MOMENT_SETTING}, ${new Date(moment).toISOString()}, true)
      `.execute(transaction);
      return work(transaction);
    });

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    classes = new ClassesKit(database.migrator);
    maths = await classes.subject({ grades: [7, 8] });
    members = new MembersKit(database.migrator, await classes.account());
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('carries the rows in force, class and group, to a later last day', async () => {
    const setup = await setting();
    const { classRow, groupRow } = await groupedStudent(setup);
    await setDates(setup.branch, setup.year, '2026-09-01', '2027-06-30');
    expect(await members.rowOf(classRow)).toMatchObject({
      valid_until: '2027-07-01',
      own_until: '2027-07-01',
      ended_by: null,
    });
    expect(await members.groupRowOf(groupRow)).toMatchObject({
      valid_until: '2027-07-01',
      own_until: '2027-07-01',
    });
  });

  // The cancel of the leaving afterwards, which gives the row back to the new
  // end, is a route test: class-members.test.ts, "gives a row back to the new
  // last day when its leaving is cancelled after the year moved".
  it('gives a row ended by a leaving the new own end only', async () => {
    const { branch, year, oxford } = await setting();
    const student = await members.student(branch);
    const row = await inBranch(branch, async (transaction) => {
      const leaving = await members.leaving(transaction, branch, student, '2026-12-01');
      return members.member(
        {
          branch,
          classId: oxford,
          studentId: student,
          from: '2026-09-01',
          until: '2026-12-01',
          endedBy: 'leaving',
          leavingId: leaving,
        },
        transaction,
      );
    });
    await setDates(branch, year, '2026-09-01', '2027-06-30');
    expect(await members.rowOf(row)).toMatchObject({
      valid_until: '2026-12-01',
      own_until: '2027-07-01',
      ended_by: 'leaving',
    });
  });

  it('leaves a withdrawn row and a row of another year as they are', async () => {
    const { branch, year, oxford } = await setting();
    const otherYear = await classes.year(branch, 'planned', '2027-09-01', '2028-05-31');
    const other = await classes.schoolClass(branch, otherYear, { name: 'Yale', grade: 7 });
    const student = await members.student(branch);
    const planned = await members.member({
      branch,
      classId: oxford,
      studentId: student,
      from: '2026-12-01',
    });
    await inBranch(branch, (transaction) =>
      transaction
        .updateTable('class_memberships')
        .set({ valid_until: '2026-12-01', ended_by: 'withdrawn' })
        .where('id', '=', planned)
        .execute(),
    );
    const next = await members.member({
      branch,
      classId: other,
      studentId: student,
      from: '2027-09-01',
      ownUntil: '2028-06-01',
    });
    await setDates(branch, year, '2026-09-01', '2027-06-30');
    expect(await members.rowOf(planned)).toMatchObject({
      valid_until: '2026-12-01',
      own_until: '2027-06-01',
      ended_by: 'withdrawn',
    });
    expect(await members.rowOf(next)).toMatchObject({
      valid_until: '2028-06-01',
      own_until: '2028-06-01',
    });
  });

  it('cuts the rows in force to an earlier last day', async () => {
    const setup = await setting();
    const { classRow, groupRow } = await groupedStudent(setup);
    await setDates(setup.branch, setup.year, '2026-09-01', '2027-05-20');
    expect(await members.rowOf(classRow)).toMatchObject({
      valid_until: '2027-05-21',
      own_until: '2027-05-21',
    });
    expect(await members.groupRowOf(groupRow)).toMatchObject({
      valid_until: '2027-05-21',
      own_until: '2027-05-21',
    });
  });

  it('refuses an earlier last day with a stay that starts, or ends by a leaving or a move, in the days cut off', async () => {
    const { branch, year, oxford } = await setting();
    // A stay planned after the new last day.
    const planned = await members.student(branch);
    await members.member({ branch, classId: oxford, studentId: planned, from: '2027-05-25' });
    expect(await outcome(setDates(branch, year, '2026-09-01', '2027-05-20'))).toBe(
      'academic_years_cut_holds',
    );
    // A leaving dated inside the days cut off, and on the first of them.
    for (const day of ['2027-05-25', '2027-05-21']) {
      const fresh = await setting();
      const leaver = await members.student(fresh.branch);
      await inBranch(fresh.branch, async (transaction) => {
        const leaving = await members.leaving(transaction, fresh.branch, leaver, day);
        await members.member(
          {
            branch: fresh.branch,
            classId: fresh.oxford,
            studentId: leaver,
            from: '2026-09-01',
            until: day,
            endedBy: 'leaving',
            leavingId: leaving,
          },
          transaction,
        );
      });
      expect(await outcome(setDates(fresh.branch, fresh.year, '2026-09-01', '2027-05-20'))).toBe(
        'academic_years_cut_holds',
      );
      // The same leaving, one day earlier than the cut, is not in the way.
      expect(await holds(fresh.branch, fresh.year, '2026-09-01', '2027-05-24')).toHaveLength(
        day === '2027-05-25' ? 1 : 0,
      );
    }
  });

  it('does not count an empty row among the stays in the way', async () => {
    const { branch, year, oxford } = await setting();
    const student = await members.student(branch);
    const planned = await members.member({
      branch,
      classId: oxford,
      studentId: student,
      from: '2027-05-25',
    });
    await inBranch(branch, (transaction) =>
      transaction
        .updateTable('class_memberships')
        .set({ valid_until: '2027-05-25', ended_by: 'withdrawn' })
        .where('id', '=', planned)
        .execute(),
    );
    await setDates(branch, year, '2026-09-01', '2027-05-20');
    expect(await members.rowOf(planned)).toMatchObject({ ended_by: 'withdrawn' });
  });

  it('refuses a later start with a stay from the old start, and lets an earlier start change nothing', async () => {
    const { branch, year, oxford } = await setting();
    const student = await members.student(branch);
    const row = await members.member({
      branch,
      classId: oxford,
      studentId: student,
      from: '2026-09-01',
    });
    expect(await outcome(setDates(branch, year, '2026-09-08', '2027-05-31'))).toBe(
      'academic_years_cut_holds',
    );
    await setDates(branch, year, '2026-08-25', '2027-05-31');
    expect(await members.rowOf(row)).toMatchObject({
      valid_from: '2026-09-01',
      own_until: '2027-06-01',
    });
  });

  it('counts the stay of a student now in another branch', async () => {
    const { branch, year, oxford } = await setting();
    const other = await insertBranch(database.migrator, 'Elsewhere');
    const student = await members.student(branch);
    const row = await members.member({
      branch,
      classId: oxford,
      studentId: student,
      from: '2026-09-01',
    });
    await moveStudentBranch(database.migrator, student, branch, other);
    expect(await outcome(setDates(branch, year, '2026-09-08', '2027-05-31'))).toBe(
      'academic_years_cut_holds',
    );
    expect(await holds(branch, year, '2026-09-08', '2027-05-31')).toEqual([row]);
  });

  // Item 5 of code round 1: a row a leaving emptied gives its days back when
  // the leaving is cancelled, so it stands in the days cut off as a stay would.
  it('refuses an earlier last day with a row a leaving on its first day emptied in the days cut off', async () => {
    const { branch, year, oxford } = await setting();
    const student = await members.student(branch);
    const row = await inBranch(branch, async (transaction) => {
      const leaving = await members.leaving(transaction, branch, student, '2027-05-25');
      return members.member(
        {
          branch,
          classId: oxford,
          studentId: student,
          from: '2027-05-25',
          until: '2027-05-25',
          endedBy: 'leaving',
          leavingId: leaving,
        },
        transaction,
      );
    });
    expect(await outcome(setDates(branch, year, '2026-09-01', '2027-05-20'))).toBe(
      'academic_years_cut_holds',
    );
    const listed = await inBranch(branch, async (transaction) => {
      const found = await sql<{ row_id: string; valid_from: string; valid_until: string }>`
        select row_id, valid_from::text as valid_from, valid_until::text as valid_until
        from year_cut_holds(${year}, '2026-09-01'::date, '2027-05-20'::date)
      `.execute(transaction);
      return found.rows;
    });
    // Answered with the days a cancel gives back: to its own end.
    expect(listed).toEqual([{ row_id: row, valid_from: '2027-05-25', valid_until: '2027-06-01' }]);
    expect(await members.rowOf(row)).toMatchObject({ own_until: '2027-06-01' });
  });

  it('refuses an earlier last day with a stay a class move ends in the days cut off', async () => {
    const { branch, year, oxford } = await setting();
    const grouped = await classes.schoolClass(branch, year, { name: 'Harvard', grade: 7 });
    const student = await members.student(branch);
    const row = await members.member({
      branch,
      classId: oxford,
      studentId: student,
      from: '2026-09-01',
    });
    const move = await members.move({
      branch,
      studentId: student,
      from: '2027-05-25',
      fromClassId: oxford,
      toClassId: grouped,
    });
    const target = await inBranch(branch, async (transaction) => {
      await transaction
        .updateTable('class_memberships')
        .set({ valid_until: '2027-05-25', ended_by: 'transfer', ended_by_move_id: move })
        .where('id', '=', row)
        .execute();
      return members.member(
        {
          branch,
          classId: grouped,
          studentId: student,
          from: '2027-05-25',
          cause: 'transfer',
          writtenByMoveId: move,
        },
        transaction,
      );
    });
    expect(await outcome(setDates(branch, year, '2026-09-01', '2027-05-20'))).toBe(
      'academic_years_cut_holds',
    );
    // The row from 1 September stands by its end alone; the row the move
    // writes, by its start.
    expect((await holds(branch, year, '2026-09-01', '2027-05-20')).sort()).toEqual(
      [row, target].sort(),
    );
    expect(await members.rowOf(row)).toMatchObject({
      valid_until: '2027-05-25',
      own_until: '2027-06-01',
    });
  });

  it('refuses an earlier last day with a group stay a group move ends in the days cut off', async () => {
    const setup = await setting();
    const { branch, year } = setup;
    const other = await classes.group(branch, year, maths, [setup.grouped]);
    const { student, groupRow } = await groupedStudent(setup);
    const move = await members.move({
      branch,
      studentId: student,
      from: '2027-05-25',
      fromGroupId: setup.group,
      toGroupId: other,
      subjectId: maths,
    });
    const target = await inBranch(branch, async (transaction) => {
      await transaction
        .updateTable('group_memberships')
        .set({ valid_until: '2027-05-25', ended_by: 'transfer', ended_by_move_id: move })
        .where('id', '=', groupRow)
        .execute();
      return members.groupMember(
        {
          branch,
          groupId: other,
          subjectId: maths,
          studentId: student,
          from: '2027-05-25',
          cause: 'transfer',
          writtenByMoveId: move,
        },
        transaction,
      );
    });
    expect(await outcome(setDates(branch, year, '2026-09-01', '2027-05-20'))).toBe(
      'academic_years_cut_holds',
    );
    // The class row runs to the last day and follows; the group row from 1
    // September stands by its end alone, the moved one by its start.
    expect(await holds(branch, year, '2026-09-01', '2027-05-20')).toEqual(
      expect.arrayContaining([groupRow, target]),
    );
    expect(await holds(branch, year, '2026-09-01', '2027-05-20')).toHaveLength(2);
  });

  // A row a move wrote and its undo emptied, and a row joined into the one
  // before it, are final: they start in the days a shorter year cuts off and
  // would be in the way if they counted, and a longer year leaves their own
  // end as it is.
  it('leaves an undone row and a joined row as they are, and does not count them in the way', async () => {
    const { branch, year, oxford } = await setting();
    const grouped = await classes.schoolClass(branch, year, { name: 'Harvard', grade: 7 });
    const moved = await members.student(branch);
    const row = await members.member({
      branch,
      classId: oxford,
      studentId: moved,
      from: '2026-09-01',
    });
    const move = await members.move({
      branch,
      studentId: moved,
      from: '2027-05-25',
      fromClassId: oxford,
      toClassId: grouped,
    });
    const undone = await inBranch(branch, async (transaction) => {
      await transaction
        .updateTable('class_memberships')
        .set({ valid_until: '2027-05-25', ended_by: 'transfer', ended_by_move_id: move })
        .where('id', '=', row)
        .execute();
      return members.member(
        {
          branch,
          classId: grouped,
          studentId: moved,
          from: '2027-05-25',
          cause: 'transfer',
          writtenByMoveId: move,
        },
        transaction,
      );
    });
    // Undone once it has begun: the moment of the undo is 26 May.
    const undoneAt = '2027-05-26T10:00:00+05:00';
    await asMigrator(
      branch,
      async (transaction) => {
        await transaction
          .updateTable('student_moves')
          .set({ undone_at: new Date(undoneAt), reason: 'Typed by mistake' })
          .where('id', '=', move)
          .execute();
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2027-05-25', ended_by: 'undone', ended_by_move_id: move })
          .where('id', '=', undone)
          .execute();
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2027-06-01', ended_by: null, ended_by_move_id: null })
          .where('id', '=', row)
          .execute();
      },
      undoneAt,
    );
    const pupil = await members.student(branch);
    const { first, second } = await asMigrator(branch, async (transaction) => {
      const first = await members.member(
        { branch, classId: oxford, studentId: pupil, from: '2026-09-01', ownUntil: '2027-05-25' },
        transaction,
      );
      const second = await members.member(
        { branch, classId: oxford, studentId: pupil, from: '2027-05-25' },
        transaction,
      );
      await transaction
        .updateTable('class_memberships')
        .set({
          valid_until: sql<string>`valid_from`,
          ended_by: 'joined',
          joined_into_id: first,
          joined_xact: sql<string>`pg_current_xact_id()`,
        })
        .where('id', '=', second)
        .execute();
      await transaction
        .updateTable('class_memberships')
        .set({ valid_until: '2027-06-01', own_until: '2027-06-01' })
        .where('id', '=', first)
        .execute();
      return { first, second };
    });
    expect(await holds(branch, year, '2026-09-01', '2027-05-20')).toEqual([]);
    await setDates(branch, year, '2026-09-01', '2027-06-30');
    for (const [id, endedBy] of [
      [undone, 'undone'],
      [second, 'joined'],
    ] as const) {
      expect(await members.rowOf(id)).toMatchObject({
        valid_from: '2027-05-25',
        valid_until: '2027-05-25',
        own_until: '2027-06-01',
        ended_by: endedBy,
      });
    }
    await setDates(branch, year, '2026-09-01', '2027-05-20');
    for (const id of [row, first]) {
      expect(await members.rowOf(id)).toMatchObject({
        valid_until: '2027-05-21',
        own_until: '2027-05-21',
        ended_by: null,
      });
    }
    expect(await members.rowOf(undone)).toMatchObject({
      own_until: '2027-06-01',
      ended_by: 'undone',
    });
    expect(await members.rowOf(second)).toMatchObject({
      own_until: '2027-06-01',
      ended_by: 'joined',
    });
  });

  describe('nothing but the follow moves an own end', () => {
    it('refuses a direct growth of the own end or the end in force, in both tables, also under the mark', async () => {
      const setup = await setting();
      const { branch } = setup;
      const { classRow: row, groupRow } = await groupedStudent(setup);
      for (const [table, id] of [
        ['class_memberships', row],
        ['group_memberships', groupRow],
      ] as const) {
        const grow = (values: { own_until: string; valid_until?: string }) =>
          inBranch(branch, (transaction) =>
            transaction.updateTable(table).set(values).where('id', '=', id).execute(),
          );
        expect(await outcome(grow({ own_until: '2027-07-01', valid_until: '2027-07-01' }))).toBe(
          `${table}_only_shrink`,
        );
        expect(await outcome(grow({ own_until: '2027-05-01', valid_until: '2027-05-01' }))).toBe(
          `${table}_only_shrink`,
        );
      }
    });

    // The follow's exact shape written by hand: the year's end now stands at
    // 31 May, the rows end on 1 May, and the mark names exactly that move. A
    // write at depth one is not the follow, whatever mark it carries.
    it('refuses the exact shape of the follow written outside the follow, in both tables', async () => {
      const setup = await setting();
      const { branch, year } = setup;
      const student = await members.student(branch);
      const { classRow, groupRow } = await inBranch(branch, async (transaction) => ({
        classRow: await members.member(
          {
            branch,
            classId: setup.grouped,
            studentId: student,
            from: '2026-09-01',
            ownUntil: '2027-05-01',
          },
          transaction,
        ),
        groupRow: await members.groupMember(
          {
            branch,
            groupId: setup.group,
            subjectId: maths,
            studentId: student,
            from: '2026-09-01',
            ownUntil: '2027-05-01',
          },
          transaction,
        ),
      }));
      for (const [table, id] of [
        ['class_memberships', classRow],
        ['group_memberships', groupRow],
      ] as const) {
        const marked = inBranch(branch, async (transaction) => {
          await sql`select set_config('app.year_follow', ${`${year}|2027-04-30|2027-05-31`}, true)`.execute(
            transaction,
          );
          await transaction
            .updateTable(table)
            .set({ own_until: '2027-06-01', valid_until: '2027-06-01' })
            .where('id', '=', id)
            .execute();
        });
        expect(await outcome(marked)).toBe(`${table}_only_shrink`);
      }
    });

    // Item 3 of code round 1: a write at trigger depth 2, as the follow's own
    // writes are, from the path of another trigger. Only the mark tells it
    // from the follow: without one, or with the mark of another year or of
    // another old end, the exact shape is refused. A scratch table of this
    // test database stands for the other trigger.
    it('refuses the exact shape of the follow written at depth 2 from another trigger without its mark, in both tables', async () => {
      await sql`
        create table if not exists scratch_follow_writes (
          id serial primary key, target_table text not null, target uuid not null, mark text
        );
        create or replace function scratch_follow_write() returns trigger
        language plpgsql as $f$
        begin
          if new.mark is not null then
            perform set_config('app.year_follow', new.mark, true);
          end if;
          execute format(
            'update %I set own_until = $1, valid_until = $1 where id = $2',
            new.target_table
          ) using '2027-06-01'::date, new.target;
          return null;
        end;
        $f$;
        drop trigger if exists scratch_follow_write on scratch_follow_writes;
        create trigger scratch_follow_write after insert on scratch_follow_writes
          for each row execute function scratch_follow_write();
        grant insert on scratch_follow_writes to sodiq_app;
        grant usage on sequence scratch_follow_writes_id_seq to sodiq_app;
      `.execute(database.migrator);
      const setup = await setting();
      const { branch, year } = setup;
      const otherYear = await classes.year(branch, 'planned', '2027-09-01', '2028-05-31');
      const student = await members.student(branch);
      const { classRow, groupRow } = await inBranch(branch, async (transaction) => ({
        classRow: await members.member(
          {
            branch,
            classId: setup.grouped,
            studentId: student,
            from: '2026-09-01',
            ownUntil: '2027-05-01',
          },
          transaction,
        ),
        groupRow: await members.groupMember(
          {
            branch,
            groupId: setup.group,
            subjectId: maths,
            studentId: student,
            from: '2026-09-01',
            ownUntil: '2027-05-01',
          },
          transaction,
        ),
      }));
      const write = (table: string, id: string, mark: string | null) =>
        inBranch(branch, (transaction) =>
          sql`insert into scratch_follow_writes (target_table, target, mark) values (${table}, ${id}, ${mark})`.execute(
            transaction,
          ),
        );
      for (const [table, id] of [
        ['class_memberships', classRow],
        ['group_memberships', groupRow],
      ] as const) {
        for (const mark of [
          null,
          `${otherYear}|2027-04-30|2027-05-31`,
          `${year}|2027-04-29|2027-05-31`,
          `${year}|2027-04-30|2027-06-30`,
        ]) {
          expect(await outcome(write(table, id, mark)), String(mark)).toBe(`${table}_only_shrink`);
        }
      }
      expect(await members.rowOf(classRow)).toMatchObject({ own_until: '2027-05-01' });
      expect(await members.groupRowOf(groupRow)).toMatchObject({ own_until: '2027-05-01' });
    });
  });
});
