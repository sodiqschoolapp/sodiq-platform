import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../database/migrate.js';
import { BRANCH_SETTING, MOMENT_SETTING, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../db/migrations',
);
const ONE_STAY = '0062_one_stay.sql';
const NOW = '2026-10-14T10:00:00+05:00';
const YEAR_END = '2027-06-01';

// Task 3.5c (pull request #117, decision 4, Look first): issue #105, H36,
// "the stays already split on the test site are joined (a migration or a
// one-off fix in the same task)", and H34, a changed move is one move. The
// rows are written the way the code before 0062 wrote them (a cancel or an
// undo wrote a new row from the day it took back), then 0062 runs: each chain
// of adjoining rows of one class or group is one row, ended as its last row
// was, and a change names the move it replaced, from its audit entry.
describe('migration 0062 joins the stays already split', () => {
  let database: TestDatabase;
  let directory: string;
  let classes: ClassesKit;
  let members: MembersKit;
  let north: string;
  let south: string;
  let chain: { student: string; rows: string[]; groupRows: string[] };
  let branchMoved: { student: string; rows: string[]; branchMove: string };
  let changed: { first: string; second: string; groupFirst: string; groupSecond: string };
  let emptied: string[];
  let undone: {
    student: string;
    row: string;
    groupRow: string;
    target: string;
    continuation: string;
    groupContinuation: string;
  };
  let cancelled: { student: string; groupRow: string; target: string; continuation: string };

  /** A transaction of the migrator with the branches and the moment set. */
  const asMigrator = <T>(branches: string[], work: (transaction: Transaction) => Promise<T>) =>
    database.migrator.transaction().execute(async (transaction) => {
      await sql`
        select set_config(${BRANCH_SETTING}, ${`{${branches.join(',')}}`}, true),
          set_config(${MOMENT_SETTING}, ${new Date(NOW).toISOString()}, true)
      `.execute(transaction);
      return work(transaction);
    });

  beforeAll(async () => {
    database = await createTestDatabase({ empty: true });
    directory = await mkdtemp(path.join(tmpdir(), 'sodiq-one-stay-'));
    for (const name of (await readdir(MIGRATIONS)).filter((one) => one.endsWith('.sql'))) {
      if (name < ONE_STAY) {
        await copyFile(path.join(MIGRATIONS, name), path.join(directory, name));
      }
    }
    await migrate({ connectionString: database.migrationUrl, directory });
    classes = new ClassesKit(database.migrator);
    members = new MembersKit(database.migrator, await classes.account());
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    const year = await classes.year(north);
    const southYear = await classes.year(south);
    const maths = await classes.subject({ grades: [7] });
    const oxford = await classes.schoolClass(north, year);
    const group = await classes.group(north, year, maths, [oxford]);

    // A stay split in three as the code before 0062 wrote it: a leaving cut
    // the row at 20 September and its cancel wrote a row from that day; a
    // second leaving cut that row at 5 October and its undo wrote a third.
    // Each cut row keeps its own end (the year's) and names the leaving taken
    // back; the group row the same, in two (spec review of the build,
    // must-fix 3).
    const student = await members.student(north, { startsOn: '2026-09-01' });
    chain = await asMigrator([north], async (transaction) => {
      const takenBack = async (day: string, cause: 'cancel' | 'undo') => {
        const leaving = await members.leaving(transaction, north, student, day);
        await transaction
          .updateTable('student_statuses')
          .set({ valid_until: day })
          .where('id', '=', leaving)
          .execute();
        await transaction
          .insertInto('student_statuses')
          .values({
            student_id: student,
            branch_id: north,
            status: 'active',
            valid_from: day,
            cause,
            reason: cause === 'undo' ? 'Entered by mistake' : null,
          })
          .execute();
        return leaving;
      };
      const first = await takenBack('2026-09-20', 'cancel');
      const second = await takenBack('2026-10-05', 'undo');
      const rows = [
        await members.member(
          {
            branch: north,
            classId: oxford,
            studentId: student,
            from: '2026-09-01',
            until: '2026-09-20',
            endedBy: 'leaving',
            leavingId: first,
          },
          transaction,
        ),
        await members.member(
          {
            branch: north,
            classId: oxford,
            studentId: student,
            from: '2026-09-20',
            until: '2026-10-05',
            cause: 'cancel',
            endedBy: 'leaving',
            leavingId: second,
          },
          transaction,
        ),
        await members.member(
          { branch: north, classId: oxford, studentId: student, from: '2026-10-05', cause: 'undo' },
          transaction,
        ),
      ];
      const groupRows = [
        await members.groupMember(
          {
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2026-09-01',
            until: '2026-09-20',
            endedBy: 'leaving',
            leavingId: first,
          },
          transaction,
        ),
        await members.groupMember(
          {
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2026-09-20',
            until: '2026-10-05',
            cause: 'cancel',
            endedBy: 'leaving',
            leavingId: second,
          },
          transaction,
        ),
        await members.groupMember(
          {
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2026-10-05',
            cause: 'undo',
          },
          transaction,
        ),
      ];
      return { student, rows, groupRows };
    });

    // A class move undone as the code before 0062 wrote it
    // (`student-moves.service.ts` of main before 0062): the class row and the
    // group row the move cut keep their end `transfer` and their own end; the
    // row the move wrote in the other class is emptied `undone`; the undo
    // writes a class row and a group row from the move's date, cause `undo`,
    // named as written by the move.
    const yale = await classes.schoolClass(north, year);
    const returned = await members.student(north, { startsOn: '2026-09-01' });
    const first = await asMigrator([north], async (transaction) => {
      const row = await members.member(
        { branch: north, classId: oxford, studentId: returned, from: '2026-09-01' },
        transaction,
      );
      const groupRow = await members.groupMember(
        {
          branch: north,
          groupId: group,
          subjectId: maths,
          studentId: returned,
          from: '2026-09-01',
        },
        transaction,
      );
      return { row, groupRow };
    });
    const undoneMove = await members.move({
      branch: north,
      studentId: returned,
      from: '2026-10-07',
      fromClassId: oxford,
      toClassId: yale,
    });
    const target = await asMigrator([north], async (transaction) => {
      for (const table of ['class_memberships', 'group_memberships'] as const) {
        await transaction
          .updateTable(table)
          .set({ valid_until: '2026-10-07', ended_by: 'transfer', ended_by_move_id: undoneMove })
          .where('student_id', '=', returned)
          .execute();
      }
      return members.member(
        {
          branch: north,
          classId: yale,
          studentId: returned,
          from: '2026-10-07',
          cause: 'transfer',
          writtenByMoveId: undoneMove,
        },
        transaction,
      );
    });
    undone = await asMigrator([north], async (transaction) => {
      await transaction
        .updateTable('student_moves')
        .set({ undone_at: new Date(NOW), reason: 'Typed by mistake' })
        .where('id', '=', undoneMove)
        .execute();
      await transaction
        .updateTable('class_memberships')
        .set({ valid_until: '2026-10-07', ended_by: 'undone', ended_by_move_id: undoneMove })
        .where('id', '=', target)
        .execute();
      return {
        student: returned,
        ...first,
        target,
        continuation: await members.member(
          {
            branch: north,
            classId: oxford,
            studentId: returned,
            from: '2026-10-07',
            cause: 'undo',
            writtenByMoveId: undoneMove,
          },
          transaction,
        ),
        groupContinuation: await members.groupMember(
          {
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: returned,
            from: '2026-10-07',
            cause: 'undo',
            writtenByMoveId: undoneMove,
          },
          transaction,
        ),
      };
    });

    // A scheduled group move cancelled as the code before 0062 wrote it: the
    // group row it cut keeps its end `transfer`; the row it wrote in the
    // other group is emptied `withdrawn`; the cancel writes a group row from
    // the move's date, cause `cancel`, named as written by the move.
    const geometry = await classes.group(north, year, maths, [oxford]);
    const stayer = await members.student(north, { startsOn: '2026-09-01' });
    const stayerRow = await asMigrator([north], async (transaction) => {
      await members.member(
        { branch: north, classId: oxford, studentId: stayer, from: '2026-09-01' },
        transaction,
      );
      return members.groupMember(
        { branch: north, groupId: group, subjectId: maths, studentId: stayer, from: '2026-09-01' },
        transaction,
      );
    });
    const cancelledMove = await members.move({
      branch: north,
      studentId: stayer,
      from: '2026-10-20',
      fromGroupId: group,
      toGroupId: geometry,
      subjectId: maths,
    });
    const stayerTarget = await asMigrator([north], async (transaction) => {
      await transaction
        .updateTable('group_memberships')
        .set({ valid_until: '2026-10-20', ended_by: 'transfer', ended_by_move_id: cancelledMove })
        .where('id', '=', stayerRow)
        .execute();
      return members.groupMember(
        {
          branch: north,
          groupId: geometry,
          subjectId: maths,
          studentId: stayer,
          from: '2026-10-20',
          cause: 'transfer',
          writtenByMoveId: cancelledMove,
        },
        transaction,
      );
    });
    cancelled = await asMigrator([north], async (transaction) => {
      await transaction
        .updateTable('student_moves')
        .set({ cancelled_at: new Date(NOW) })
        .where('id', '=', cancelledMove)
        .execute();
      await transaction
        .updateTable('group_memberships')
        .set({ valid_until: '2026-10-20', ended_by: 'withdrawn' })
        .where('id', '=', stayerTarget)
        .execute();
      return {
        student: stayer,
        groupRow: stayerRow,
        target: stayerTarget,
        continuation: await members.groupMember(
          {
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: stayer,
            from: '2026-10-20',
            cause: 'cancel',
            writtenByMoveId: cancelledMove,
          },
          transaction,
        ),
      };
    });

    // A cancel's row that a later, earlier-dated leaving emptied (still in
    // force): it holds no day, so it is no stay and is not joined; the undo
    // of that leaving grows the first row over its days (must-fix 2,
    // `continuesStay`).
    const emptiedStudent = await members.student(north, { startsOn: '2026-09-01' });
    emptied = await asMigrator([north], async (transaction) => {
      const leaving = await members.leaving(transaction, north, emptiedStudent, '2026-10-02');
      await members.groupMember(
        {
          branch: north,
          groupId: group,
          subjectId: maths,
          studentId: emptiedStudent,
          from: '2026-09-01',
          until: '2026-10-02',
          endedBy: 'leaving',
          leavingId: leaving,
        },
        transaction,
      );
      return [
        await members.member(
          {
            branch: north,
            classId: oxford,
            studentId: emptiedStudent,
            from: '2026-09-01',
            until: '2026-10-02',
            endedBy: 'leaving',
            leavingId: leaving,
          },
          transaction,
        ),
        await members.member(
          {
            branch: north,
            classId: oxford,
            studentId: emptiedStudent,
            from: '2026-10-21',
            until: '2026-10-21',
            cause: 'cancel',
            endedBy: 'leaving',
            leavingId: leaving,
          },
          transaction,
        ),
      ];
    });

    // A stay split in two whose later row a move to another branch cut
    // (correction 2 of the plan review: the test site holds such rows). The
    // earlier row is cut by a leaving its cancel took back, and keeps that
    // end, the leaving and its own end at the year's end, as the code before
    // 0062 left it.
    const harvard = await classes.schoolClass(south, southYear);
    const leaver = await members.student(north, { startsOn: '2026-09-01' });
    branchMoved = await asMigrator([north, south], async (transaction) => {
      const leaving = await members.leaving(transaction, north, leaver, '2026-10-01');
      await transaction
        .updateTable('student_statuses')
        .set({ valid_until: '2026-10-01' })
        .where('id', '=', leaving)
        .execute();
      await transaction
        .insertInto('student_statuses')
        .values({
          student_id: leaver,
          branch_id: north,
          status: 'active',
          valid_from: '2026-10-01',
          cause: 'cancel',
        })
        .execute();
      const rows = [
        await members.member(
          {
            branch: north,
            classId: yale,
            studentId: leaver,
            from: '2026-09-01',
            until: '2026-10-01',
            endedBy: 'leaving',
            leavingId: leaving,
          },
          transaction,
        ),
        await members.member(
          { branch: north, classId: yale, studentId: leaver, from: '2026-10-01', cause: 'cancel' },
          transaction,
        ),
      ];
      const release = await transaction
        .insertInto('student_branch_moves')
        .values({
          branch_id: north,
          student_id: leaver,
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
        .where('id', '=', rows[1] ?? '')
        .execute();
      await transaction
        .updateTable('students')
        .set({ branch_id: south })
        .where('id', '=', leaver)
        .execute();
      await transaction
        .insertInto('class_memberships')
        .values({
          branch_id: south,
          student_id: leaver,
          class_id: harvard,
          valid_from: '2026-10-14',
          valid_until: YEAR_END,
          own_until: YEAR_END,
          cause: 'branch_move',
        })
        .execute();
      return { student: leaver, rows, branchMove: release.id };
    });

    // A scheduled move changed: the first cancelled, the second written, one
    // audit entry of the change naming both.
    const mover = await members.student(north, { startsOn: '2026-09-01' });
    changed = await asMigrator([north], async (transaction) => {
      const first = await members.move(
        {
          branch: north,
          studentId: mover,
          from: '2026-10-20',
          fromClassId: oxford,
          toClassId: yale,
        },
        transaction,
      );
      await transaction
        .updateTable('student_moves')
        .set({ cancelled_at: new Date(NOW) })
        .where('id', '=', first)
        .execute();
      const second = await members.move(
        {
          branch: north,
          studentId: mover,
          from: '2026-10-27',
          fromClassId: oxford,
          toClassId: yale,
        },
        transaction,
      );
      await transaction
        .insertInto('audit_log')
        .values({
          occurred_at: new Date(NOW),
          branch_id: north,
          action: 'student.class_transfer_changed',
          record_type: 'student',
          record_id: mover,
          old_value: JSON.stringify({ moveId: first }),
          new_value: JSON.stringify({ moveId: second }),
        })
        .execute();
      // The same for a group move, from the entry of its change.
      const groupMove = (from: string) =>
        members.move(
          {
            branch: north,
            studentId: mover,
            from,
            fromGroupId: group,
            toGroupId: geometry,
            subjectId: maths,
          },
          transaction,
        );
      const groupFirst = await groupMove('2026-10-20');
      await transaction
        .updateTable('student_moves')
        .set({ cancelled_at: new Date(NOW) })
        .where('id', '=', groupFirst)
        .execute();
      const groupSecond = await groupMove('2026-10-27');
      await transaction
        .insertInto('audit_log')
        .values({
          occurred_at: new Date(NOW),
          branch_id: north,
          action: 'student.group_transfer_changed',
          record_type: 'student',
          record_id: mover,
          old_value: JSON.stringify({ moveId: groupFirst }),
          new_value: JSON.stringify({ moveId: groupSecond }),
        })
        .execute();
      return { first, second, groupFirst, groupSecond };
    });

    await copyFile(path.join(MIGRATIONS, ONE_STAY), path.join(directory, ONE_STAY));
    expect(await migrate({ connectionString: database.migrationUrl, directory })).toEqual([
      '0062_one_stay',
    ]);
  });

  afterAll(async () => {
    await database.destroy();
    await rm(directory, { recursive: true });
  });

  const classRowsOf = (student: string) =>
    database.migrator
      .selectFrom('class_memberships')
      .select([
        'id',
        'valid_from',
        'valid_until',
        'own_until',
        'ended_by',
        'joined_into_id',
        'ended_by_branch_move_id',
        'ended_by_move_id',
        'leaving_id',
      ])
      .where('student_id', '=', student)
      .orderBy('valid_from')
      .orderBy('id')
      .execute();

  const groupRowsOf = (student: string) =>
    database.migrator
      .selectFrom('group_memberships')
      .select([
        'id',
        'valid_from',
        'valid_until',
        'own_until',
        'ended_by',
        'joined_into_id',
        'ended_by_move_id',
      ])
      .where('student_id', '=', student)
      .orderBy('valid_from')
      .orderBy('id')
      .execute();

  it('joins a chain of three class rows and three group rows into one each', async () => {
    const [first, second, third] = chain.rows;
    expect(await classRowsOf(chain.student)).toEqual([
      expect.objectContaining({
        id: first,
        valid_from: '2026-09-01',
        valid_until: YEAR_END,
        own_until: YEAR_END,
        ended_by: null,
        leaving_id: null,
      }),
      expect.objectContaining({
        id: second,
        valid_from: '2026-09-20',
        valid_until: '2026-09-20',
        ended_by: 'joined',
        joined_into_id: first,
      }),
      expect.objectContaining({
        id: third,
        valid_from: '2026-10-05',
        valid_until: '2026-10-05',
        ended_by: 'joined',
        joined_into_id: first,
      }),
    ]);
    const groups = await database.migrator
      .selectFrom('group_memberships')
      .select(['id', 'valid_from', 'valid_until', 'ended_by', 'joined_into_id'])
      .where('student_id', '=', chain.student)
      .orderBy('valid_from')
      .execute();
    expect(groups).toEqual([
      {
        id: chain.groupRows[0],
        valid_from: '2026-09-01',
        valid_until: YEAR_END,
        ended_by: null,
        joined_into_id: null,
      },
      {
        id: chain.groupRows[1],
        valid_from: '2026-09-20',
        valid_until: '2026-09-20',
        ended_by: 'joined',
        joined_into_id: chain.groupRows[0],
      },
      {
        id: chain.groupRows[2],
        valid_from: '2026-10-05',
        valid_until: '2026-10-05',
        ended_by: 'joined',
        joined_into_id: chain.groupRows[0],
      },
    ]);
  });

  it('joins the rows a move undone and a move cancelled had split, and leaves their targets empty', async () => {
    expect(await classRowsOf(undone.student)).toEqual([
      expect.objectContaining({
        id: undone.row,
        valid_from: '2026-09-01',
        valid_until: YEAR_END,
        own_until: YEAR_END,
        ended_by: null,
        ended_by_move_id: null,
      }),
      expect.objectContaining({
        id: undone.target,
        valid_from: '2026-10-07',
        valid_until: '2026-10-07',
        ended_by: 'undone',
        joined_into_id: null,
      }),
      expect.objectContaining({
        id: undone.continuation,
        valid_from: '2026-10-07',
        valid_until: '2026-10-07',
        ended_by: 'joined',
        joined_into_id: undone.row,
      }),
    ]);
    expect(await groupRowsOf(undone.student)).toEqual([
      expect.objectContaining({
        id: undone.groupRow,
        valid_from: '2026-09-01',
        valid_until: YEAR_END,
        ended_by: null,
        ended_by_move_id: null,
      }),
      expect.objectContaining({
        id: undone.groupContinuation,
        valid_from: '2026-10-07',
        valid_until: '2026-10-07',
        ended_by: 'joined',
        joined_into_id: undone.groupRow,
      }),
    ]);
    expect(await groupRowsOf(cancelled.student)).toEqual([
      expect.objectContaining({
        id: cancelled.groupRow,
        valid_from: '2026-09-01',
        valid_until: YEAR_END,
        own_until: YEAR_END,
        ended_by: null,
        ended_by_move_id: null,
      }),
      expect.objectContaining({
        id: cancelled.target,
        valid_from: '2026-10-20',
        valid_until: '2026-10-20',
        ended_by: 'withdrawn',
        joined_into_id: null,
      }),
      expect.objectContaining({
        id: cancelled.continuation,
        valid_from: '2026-10-20',
        valid_until: '2026-10-20',
        ended_by: 'joined',
        joined_into_id: cancelled.groupRow,
      }),
    ]);
  });

  it('leaves a row that holds no day as it is', async () => {
    const after = await database.migrator
      .selectFrom('class_memberships')
      .select(['id', 'valid_from', 'valid_until', 'ended_by'])
      .where('id', 'in', emptied)
      .orderBy('valid_from')
      .execute();
    expect(after.map((row) => [row.valid_from, row.valid_until, row.ended_by])).toEqual([
      ['2026-09-01', '2026-10-02', 'leaving'],
      ['2026-10-21', '2026-10-21', 'leaving'],
    ]);
  });

  it('keeps the end of the last row of a chain, a move to another branch included', async () => {
    const [first, second] = branchMoved.rows;
    const rows = (await classRowsOf(branchMoved.student)).filter((row) => row.id !== undefined);
    expect(rows.find((row) => row.id === first)).toMatchObject({
      valid_from: '2026-09-01',
      valid_until: '2026-10-14',
      own_until: YEAR_END,
      ended_by: 'branch_move',
      ended_by_branch_move_id: branchMoved.branchMove,
      // The end of the leaving taken back went with the join.
      leaving_id: null,
    });
    expect(rows.find((row) => row.id === second)).toMatchObject({
      valid_until: '2026-10-01',
      ended_by: 'joined',
      joined_into_id: first,
    });
  });

  it('writes one entry per student and branch of the rows joined', async () => {
    const entries = await database.migrator
      .selectFrom('audit_log')
      .select(['branch_id', 'record_id', 'actor_id', 'new_value'])
      .where('action', '=', 'student.stays_joined')
      .orderBy('record_id')
      .execute();
    const of = (student: string) => entries.filter((one) => one.record_id === student);
    expect(of(chain.student)).toEqual([
      {
        branch_id: north,
        record_id: chain.student,
        actor_id: null,
        new_value: {
          memberships: [
            {
              keptId: chain.rows[0],
              joinedId: chain.rows[1],
              from: '2026-09-20',
              until: '2026-10-05',
            },
            { keptId: chain.rows[0], joinedId: chain.rows[2], from: '2026-10-05', until: YEAR_END },
          ],
          groupMemberships: [
            {
              keptId: chain.groupRows[0],
              joinedId: chain.groupRows[1],
              from: '2026-09-20',
              until: '2026-10-05',
            },
            {
              keptId: chain.groupRows[0],
              joinedId: chain.groupRows[2],
              from: '2026-10-05',
              until: YEAR_END,
            },
          ],
        },
      },
    ]);
    // The rows of the student who moved stay in the branch they were in.
    expect(of(branchMoved.student).map((one) => one.branch_id)).toEqual([north]);
  });

  it('names the move a change replaced, from the entry of the change', async () => {
    const found = await database.migrator
      .selectFrom('student_moves')
      .select(['id', 'replaces_move_id'])
      .where('id', 'in', [changed.first, changed.second, changed.groupFirst, changed.groupSecond])
      .execute();
    const replaced = (id: string) => found.find((one) => one.id === id)?.replaces_move_id;
    expect(replaced(changed.second)).toBe(changed.first);
    expect(replaced(changed.first)).toBeNull();
    // From `student.group_transfer_changed` too.
    expect(replaced(changed.groupSecond)).toBe(changed.groupFirst);
    expect(replaced(changed.groupFirst)).toBeNull();
  });
});
