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
  let changed: { first: string; second: string };

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

    // A stay split in three by two take-backs, and its group row in two.
    const student = await members.student(north, { startsOn: '2026-09-01' });
    chain = await asMigrator([north], async (transaction) => {
      const rows = [
        await members.member(
          {
            branch: north,
            classId: oxford,
            studentId: student,
            from: '2026-09-01',
            ownUntil: '2026-09-20',
          },
          transaction,
        ),
        await members.member(
          {
            branch: north,
            classId: oxford,
            studentId: student,
            from: '2026-09-20',
            ownUntil: '2026-10-05',
            cause: 'cancel',
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
            ownUntil: '2026-09-20',
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
          },
          transaction,
        ),
      ];
      return { student, rows, groupRows };
    });

    // A stay split in two whose later row a move to another branch cut
    // (correction 2 of the plan review: the test site holds such rows).
    const yale = await classes.schoolClass(north, year);
    const harvard = await classes.schoolClass(south, southYear);
    const leaver = await members.student(north, { startsOn: '2026-09-01' });
    branchMoved = await asMigrator([north, south], async (transaction) => {
      const rows = [
        await members.member(
          {
            branch: north,
            classId: yale,
            studentId: leaver,
            from: '2026-09-01',
            ownUntil: '2026-10-01',
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
      return { first, second };
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
      ])
      .where('student_id', '=', student)
      .orderBy('valid_from')
      .orderBy('id')
      .execute();

  it('joins a chain of three class rows and two group rows into one each', async () => {
    const [first, second, third] = chain.rows;
    expect(await classRowsOf(chain.student)).toEqual([
      expect.objectContaining({
        id: first,
        valid_from: '2026-09-01',
        valid_until: YEAR_END,
        own_until: YEAR_END,
        ended_by: null,
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
      .where('id', 'in', [changed.first, changed.second])
      .execute();
    expect(found.find((one) => one.id === changed.second)?.replaces_move_id).toBe(changed.first);
    expect(found.find((one) => one.id === changed.first)?.replaces_move_id).toBeNull();
  });
});
