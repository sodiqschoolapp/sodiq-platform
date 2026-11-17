import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { MembersKit, groupMemberValues, memberValues } from '../../testing/members-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';

/** Wednesday 14 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-14T10:00:00+05:00';

type Sex = 'male' | 'female';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

/** What a promise came to: `written`, or the constraint that refused it. */
const outcome = (work: Promise<unknown>): Promise<string | undefined> =>
  work.then(
    () => 'written',
    (error: unknown) => (error as { constraint?: string }).constraint,
  );

// Groups for one sex (db/migrations/0171; the owner's spec change of 17
// November 2026). 05, Group: "A group may be for girls only or for boys only;
// it takes only students of that sex. [...] Every student of the classes
// involved must be in exactly one group for that subject that is open to
// them: a subject whose groups in a class are all for one sex binds only the
// students of that sex (taekwondo for the boys only)." The rule holds on the
// insert of a group row, on a row carried to another student, on a row that
// takes back days, on a group's sex set and on a student's sex corrected, and
// at the same moment in both orders. All names are invented.
describe('groups for one sex in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let classes: ClassesKit;
  let members: MembersKit;
  let account: string;
  let north: string;
  let year: string;
  let taekwondo: string;
  let gymnastics: string;
  let pe: string;

  const inBranch = <T>(work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([north], work);

  /** A student of the class from 1 September, written before any group draws from it. */
  async function pupil(classId: string, sex: Sex): Promise<string> {
    const student = await members.student(north, { startsOn: '2026-09-01', sex });
    await members.member({ branch: north, classId, studentId: student, from: '2026-09-01' });
    return student;
  }

  /** A group row as the application writes it. */
  const groupRow = (
    groupId: string,
    subjectId: string,
    studentId: string,
    from = '2026-09-01',
    until = '2027-06-01',
    db?: Transaction,
  ) => {
    const row = { branch: north, groupId, subjectId, studentId, from, ownUntil: until };
    return db === undefined
      ? inBranch((transaction) => members.groupMember(row, transaction))
      : members.groupMember(row, db);
  };

  const setGroupSex = (groupId: string, sex: Sex | null, db?: Transaction) => {
    const write = (transaction: Transaction) =>
      transaction.updateTable('groups').set({ sex }).where('id', '=', groupId).execute();
    return db === undefined ? inBranch(write) : write(db);
  };

  const setStudentSex = (studentId: string, sex: Sex, db?: Transaction) => {
    const write = (transaction: Transaction) =>
      transaction.updateTable('students').set({ sex }).where('id', '=', studentId).execute();
    return db === undefined ? inBranch(write) : write(db);
  };

  /** The backend of a transaction, to wait for. */
  const backendOf = async (transaction: Transaction): Promise<number> => {
    const found = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(transaction);
    return found.rows[0]?.pid ?? 0;
  };

  /** Whether a backend of the test database is blocked by `pid` right now. */
  async function blockedBy(pid: number): Promise<boolean> {
    const found = await sql<{ waiting: number }>`
      select count(*)::int as waiting from pg_stat_activity a
      where a.datname = current_database() and ${pid}::int = any (pg_blocking_pids(a.pid))
    `.execute(database.migrator);
    return (found.rows[0]?.waiting ?? 0) > 0;
  }

  /**
   * `first` done in a transaction held open; `second` started meanwhile, seen
   * waiting on the held transaction, then the held one committed. Gives what
   * each came to.
   */
  async function sameMoment(
    first: (transaction: Transaction) => Promise<unknown>,
    second: () => Promise<unknown>,
  ): Promise<{ first: string | undefined; second: string | undefined }> {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pid = 0;
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const held = outcome(
      inBranch(async (transaction) => {
        pid = await backendOf(transaction);
        await first(transaction);
        // The deferred checks run now, before the other side starts.
        await sql`set constraints all immediate`.execute(transaction);
        ready();
        await released;
      }),
    );
    await Promise.race([isReady, held]);
    const other = new Promise<string | undefined>((resolve, reject) => {
      outcome(second()).then(resolve, reject);
    });
    await expect.poll(() => blockedBy(pid), { timeout: 20_000, interval: 50 }).toBe(true);
    release();
    return { first: await held, second: await other };
  }

  /** The merge row as the service writes it first: `merged` into `kept` (as student-merges.database.test.ts). */
  async function mergeRow(transaction: Transaction, kept: string, merged: string): Promise<string> {
    const pair = await transaction
      .selectFrom('students')
      .select(['id', 'uid', 'branch_id'])
      .where('id', 'in', [kept, merged])
      .execute();
    const of = (id: string) => {
      const found = pair.find((one) => one.id === id);
      if (found === undefined) throw new Error('A record of the pair is not found.');
      return found;
    };
    const row = await transaction
      .insertInto('student_merges')
      .values({
        branch_id: of(kept).branch_id,
        kept_id: kept,
        merged_id: merged,
        merged_branch_id: of(merged).branch_id,
        kept_uid: of(kept).uid,
        merged_uid: of(merged).uid,
        merged_uids: [of(merged).uid],
        merged_record: JSON.stringify({ id: merged }),
        left_rows: JSON.stringify({}),
        reason: 'Created twice by mistake',
        merged_by: account,
        merged_at: new Date(NOW),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    classes = new ClassesKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    year = await classes.year(north);
    taekwondo = await classes.subject({ grades: [7, 8] });
    gymnastics = await classes.subject({ grades: [7, 8] });
    pe = await classes.subject({ grades: [7, 8] });
    account = await classes.account();
    members = new MembersKit(database.migrator, account);
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('a group row', () => {
    it('takes a student of the group’s sex, and anyone into a group for everyone', async () => {
      const oxford = await classes.schoolClass(north, year);
      const girl = await pupil(oxford, 'female');
      const boy = await pupil(oxford, 'male');
      const boys = await classes.group(north, year, taekwondo, [oxford], { sex: 'male' });
      const everyone = await classes.group(north, year, pe, [oxford]);
      expect(await refusal(groupRow(boys, taekwondo, girl))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'group_memberships_sex',
      });
      await groupRow(boys, taekwondo, boy);
      await groupRow(everyone, pe, girl);
      await groupRow(everyone, pe, boy);
      expect(
        await database.migrator
          .selectFrom('group_memberships')
          .select('student_id')
          .where('group_id', '=', boys)
          .execute(),
      ).toEqual([{ student_id: boy }]);
    });

    it('cannot be carried to a student of the other sex (a merge moves rows by their student)', async () => {
      const oxford = await classes.schoolClass(north, year);
      const boy = await pupil(oxford, 'male');
      const girl = await pupil(oxford, 'female');
      const boys = await classes.group(north, year, taekwondo, [oxford], { sex: 'male' });
      const row = await groupRow(boys, taekwondo, boy);
      // The merge of the boy's record into the girl's, as the service writes it
      // first (`memberships_merge` lets a carry through only with it).
      const failure = await refusal(
        inBranch(async (transaction) => {
          await mergeRow(transaction, girl, boy);
          await transaction
            .updateTable('group_memberships')
            .set({ student_id: girl })
            .where('id', '=', row)
            .execute();
        }),
      );
      expect(failure).toMatchObject({ constraint: 'group_memberships_sex' });
    });

    it('cannot take back days in a group of the other sex (a leaving cancelled after the group was set to the boys)', async () => {
      const oxford = await classes.schoolClass(north, year);
      const girl = await members.student(north, { startsOn: '2026-09-01', sex: 'female' });
      const classRow = await members.member({
        branch: north,
        classId: oxford,
        studentId: girl,
        from: '2026-09-01',
      });
      const group = await classes.group(north, year, pe, [oxford]);
      const row = await groupRow(group, pe, girl);
      // She left from 1 October: her rows are cut there and no longer count.
      const leaving = await database.migrator.transaction().execute(async (transaction) => {
        const id = await members.leaving(transaction, north, girl, '2026-10-01');
        for (const table of ['class_memberships', 'group_memberships'] as const) {
          await transaction
            .updateTable(table)
            .set({ valid_until: '2026-10-01', ended_by: 'leaving', leaving_id: id })
            .where('id', '=', table === 'class_memberships' ? classRow : row)
            .execute();
        }
        return id;
      });
      await setGroupSex(group, 'male');
      // The leaving is cancelled: the rows take their days back, and the girl's
      // row in the boys' group is refused at the commit.
      const failure = await refusal(
        database.migrator.transaction().execute(async (transaction) => {
          const status = await transaction
            .selectFrom('student_statuses')
            .select('valid_from')
            .where('id', '=', leaving)
            .executeTakeFirstOrThrow();
          await transaction
            .updateTable('student_statuses')
            .set({ valid_until: status.valid_from })
            .where('id', '=', leaving)
            .execute();
          await transaction
            .insertInto('student_statuses')
            .values({
              student_id: girl,
              branch_id: north,
              status: 'active',
              valid_from: status.valid_from,
              cause: 'cancel',
            })
            .execute();
          for (const [table, id] of [
            ['class_memberships', classRow],
            ['group_memberships', row],
          ] as const) {
            await transaction
              .updateTable(table)
              .set({ valid_until: '2027-06-01', ended_by: null, leaving_id: null })
              .where('id', '=', id)
              .execute();
          }
        }),
      );
      expect(failure).toMatchObject({ constraint: 'group_memberships_sex' });
    });
  });

  describe('the students a subject binds', () => {
    it('lets a girl join a class whose taekwondo groups are all for the boys, without one', async () => {
      const oxford = await classes.schoolClass(north, year);
      await classes.group(north, year, taekwondo, [oxford], { sex: 'male' });
      const girl = await members.student(north, { startsOn: '2026-09-01', sex: 'female' });
      await members.member({ branch: north, classId: oxford, studentId: girl, from: '2026-10-15' });
      const boy = await members.student(north, { startsOn: '2026-09-01', sex: 'male' });
      expect(
        await refusal(
          members.member({ branch: north, classId: oxford, studentId: boy, from: '2026-10-15' }),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'class_memberships_need_groups' });
    });

    it('lets a boy in with his taekwondo group, and binds a girl to gymnastics for the girls', async () => {
      const oxford = await classes.schoolClass(north, year);
      const boys = await classes.group(north, year, taekwondo, [oxford], { sex: 'male' });
      const girls = await classes.group(north, year, gymnastics, [oxford], { sex: 'female' });
      const boy = await members.student(north, { startsOn: '2026-09-01', sex: 'male' });
      await database.migrator.transaction().execute(async (transaction) => {
        await transaction
          .insertInto('class_memberships')
          .values(
            memberValues({ branch: north, classId: oxford, studentId: boy, from: '2026-10-15' }),
          )
          .execute();
        await transaction
          .insertInto('group_memberships')
          .values(
            groupMemberValues({
              branch: north,
              groupId: boys,
              subjectId: taekwondo,
              studentId: boy,
              from: '2026-10-15',
            }),
          )
          .execute();
      });
      const girl = await members.student(north, { startsOn: '2026-09-01', sex: 'female' });
      expect(
        await refusal(
          members.member({ branch: north, classId: oxford, studentId: girl, from: '2026-10-15' }),
        ),
      ).toMatchObject({ constraint: 'class_memberships_need_groups' });
      expect(girls).toBeTruthy();
    });

    it('binds a girl to a subject with a boys’ group and a group for everyone', async () => {
      const oxford = await classes.schoolClass(north, year);
      await classes.group(north, year, pe, [oxford], { sex: 'male' });
      await classes.group(north, year, pe, [oxford]);
      const girl = await members.student(north, { startsOn: '2026-09-01', sex: 'female' });
      expect(
        await refusal(
          members.member({ branch: north, classId: oxford, studentId: girl, from: '2026-10-15' }),
        ),
      ).toMatchObject({ constraint: 'class_memberships_need_groups' });
    });

    it('lists no girl as a gap of a subject whose groups are all for the boys', async () => {
      const oxford = await classes.schoolClass(north, year);
      const girl = await pupil(oxford, 'female');
      const boy = await pupil(oxford, 'male');
      await classes.group(north, year, taekwondo, [oxford], { sex: 'male' });
      // `class_row_needs_groups` is the one check of both class triggers.
      const needs = await inBranch(async (transaction) => {
        const found = await sql<{ student_id: string; needs: boolean }>`
          select m.student_id, class_row_needs_groups(m.id, m.class_id, '2026-10-15'::date) as needs
          from class_memberships m where m.class_id = ${oxford}::uuid
        `.execute(transaction);
        return new Map(found.rows.map((one) => [one.student_id, one.needs]));
      });
      expect(needs.get(girl)).toBe(false);
      expect(needs.get(boy)).toBe(true);
    });
  });

  describe('a group’s sex', () => {
    it('is refused while a student of the other sex has a row from today on', async () => {
      const oxford = await classes.schoolClass(north, year);
      const girl = await pupil(oxford, 'female');
      const group = await classes.group(north, year, pe, [oxford]);
      await groupRow(group, pe, girl);
      expect(await refusal(setGroupSex(group, 'male'))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'groups_sex_members',
      });
      await setGroupSex(group, 'female');
      await setGroupSex(group, null);
    });

    it('is allowed over a row that ended before today: the past is history', async () => {
      const oxford = await classes.schoolClass(north, year);
      const girl = await pupil(oxford, 'female');
      const group = await classes.group(north, year, pe, [oxford]);
      await groupRow(group, pe, girl, '2026-09-01', '2026-10-14');
      await setGroupSex(group, 'male');
      expect(
        await database.migrator
          .selectFrom('groups')
          .select('sex')
          .where('id', '=', group)
          .executeTakeFirstOrThrow(),
      ).toEqual({ sex: 'male' });
    });
  });

  describe('a student’s sex', () => {
    it('is refused while they have a row of a group of their sex from today on', async () => {
      const oxford = await classes.schoolClass(north, year);
      const girl = await pupil(oxford, 'female');
      const girls = await classes.group(north, year, gymnastics, [oxford], { sex: 'female' });
      await groupRow(girls, gymnastics, girl);
      expect(await refusal(setStudentSex(girl, 'male'))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'students_sex_groups',
      });
    });

    it('is allowed with only a past row there, and with rows of groups for everyone', async () => {
      const oxford = await classes.schoolClass(north, year);
      const girl = await pupil(oxford, 'female');
      const girls = await classes.group(north, year, gymnastics, [oxford], { sex: 'female' });
      const everyone = await classes.group(north, year, pe, [oxford]);
      await groupRow(girls, gymnastics, girl, '2026-09-01', '2026-10-14');
      await groupRow(everyone, pe, girl);
      await setStudentSex(girl, 'male');
    });
  });

  // .claude/rules/database.md: each pair that meets on a row, in both orders;
  // the held side writes what its route writes, and the other side is seen
  // waiting on the held transaction's own backend.
  describe('two changes at the same moment', () => {
    it('a sex correction first: the group row of the girls’ group waits and is refused', async () => {
      const oxford = await classes.schoolClass(north, year);
      const student = await pupil(oxford, 'female');
      const girls = await classes.group(north, year, gymnastics, [oxford], { sex: 'female' });
      const result = await sameMoment(
        (transaction) => setStudentSex(student, 'male', transaction),
        () => groupRow(girls, gymnastics, student),
      );
      expect(result).toEqual({ first: 'written', second: 'group_memberships_sex' });
    });

    it('the group row first: the sex correction waits and is refused', async () => {
      const oxford = await classes.schoolClass(north, year);
      const student = await pupil(oxford, 'female');
      const girls = await classes.group(north, year, gymnastics, [oxford], { sex: 'female' });
      const result = await sameMoment(
        (transaction) => groupRow(girls, gymnastics, student, undefined, undefined, transaction),
        () => setStudentSex(student, 'male'),
      );
      expect(result).toEqual({ first: 'written', second: 'students_sex_groups' });
    });

    it('a group’s sex first: a girl’s row waits and is refused', async () => {
      const oxford = await classes.schoolClass(north, year);
      const girl = await pupil(oxford, 'female');
      const group = await classes.group(north, year, pe, [oxford]);
      const result = await sameMoment(
        (transaction) => setGroupSex(group, 'male', transaction),
        () => groupRow(group, pe, girl),
      );
      expect(result).toEqual({ first: 'written', second: 'group_memberships_sex' });
    });

    it('a girl’s row first: the group’s sex waits and is refused', async () => {
      const oxford = await classes.schoolClass(north, year);
      const girl = await pupil(oxford, 'female');
      const group = await classes.group(north, year, pe, [oxford]);
      const result = await sameMoment(
        (transaction) => groupRow(group, pe, girl, undefined, undefined, transaction),
        () => setGroupSex(group, 'male'),
      );
      expect(result).toEqual({ first: 'written', second: 'groups_sex_members' });
    });

    it('a group’s sex first: a member’s sex correction waits and is refused', async () => {
      const oxford = await classes.schoolClass(north, year);
      const boy = await pupil(oxford, 'male');
      const group = await classes.group(north, year, pe, [oxford]);
      await groupRow(group, pe, boy);
      const result = await sameMoment(
        (transaction) => setGroupSex(group, 'male', transaction),
        () => setStudentSex(boy, 'female'),
      );
      expect(result).toEqual({ first: 'written', second: 'students_sex_groups' });
    });

    it('a member’s sex correction first: the group’s sex waits and is refused', async () => {
      const oxford = await classes.schoolClass(north, year);
      const boy = await pupil(oxford, 'male');
      const group = await classes.group(north, year, pe, [oxford]);
      await groupRow(group, pe, boy);
      const result = await sameMoment(
        (transaction) => setStudentSex(boy, 'female', transaction),
        () => setGroupSex(group, 'male'),
      );
      expect(result).toEqual({ first: 'written', second: 'groups_sex_members' });
    });
  });
});
