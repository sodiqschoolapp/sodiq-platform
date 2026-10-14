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

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// The rules of groups on the class side that the database itself keeps
// (db/migrations/0049, task 3.2c, pull request #93): "A class membership
// cannot be saved without a group for every split or group subject of that
// class, from the same date" (edge/students-classes-groups, first row),
// checked at the commit of every insert of a class row over every day it
// holds (decision 1); `group_placement_gaps`, the check task 3.4 calls
// ("Every student of the classes involved must be in exactly one group for
// that subject", 05; decision 8); `class_group_subjects` (decision 5); the
// causes of a row given back and its review tag (decision 4). All names are
// invented.
describe('groups on the class side in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let classes: ClassesKit;
  let members: MembersKit;
  let north: string;
  let south: string;
  let northYear: string;
  let southYear: string;
  let maths: string;
  let english: string;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  /** The gaps as the application reads them, in a transaction of the branch. */
  const gaps = (branch: string, classIds: readonly string[], subject: string, from: string) =>
    inBranch(branch, async (transaction) => {
      const found = await sql<{ student_id: string; class_id: string; first_day: string }>`
        select student_id, class_id, first_day::text as first_day
        from group_placement_gaps(${sql.val(classIds)}::uuid[], ${subject}::uuid, ${from}::date)
      `.execute(transaction);
      return found.rows;
    });

  const subjectsOf = (classId: string) =>
    inBranch(north, async (transaction) => {
      const found = await sql<{ subject: string }>`
        select class_group_subjects(${classId}::uuid) as subject
      `.execute(transaction);
      return found.rows.map((row) => row.subject).sort();
    });

  /** A student of the class from `from`, written before any group draws from it. */
  async function pupil(classId: string, from = '2026-09-01', until?: string) {
    const student = await members.student(north, { startsOn: '2026-09-01' });
    const row = await members.member({
      branch: north,
      classId,
      studentId: student,
      from,
      ...(until === undefined ? {} : { ownUntil: until }),
    });
    return { student, row };
  }

  /** A group row as the application writes it, in a transaction of the branch. */
  const groupRow = (
    groupId: string,
    subjectId: string,
    studentId: string,
    from: string,
    until = '2027-06-01',
  ) =>
    inBranch(north, (transaction) =>
      members.groupMember(
        { branch: north, groupId, subjectId, studentId, from, ownUntil: until },
        transaction,
      ),
    );

  /** A class row and the group rows given, in one transaction of the migrator. */
  const together = (
    classRow: Parameters<typeof memberValues>[0],
    groupRows: readonly Parameters<typeof groupMemberValues>[0][],
    later: (transaction: Transaction) => Promise<void> = () => Promise.resolve(),
  ) =>
    database.migrator.transaction().execute(async (transaction) => {
      await transaction.insertInto('class_memberships').values(memberValues(classRow)).execute();
      for (const row of groupRows) {
        await transaction.insertInto('group_memberships').values(groupMemberValues(row)).execute();
      }
      await later(transaction);
    });

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    classes = new ClassesKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    northYear = await classes.year(north);
    southYear = await classes.year(south);
    maths = await classes.subject({ grades: [7, 8] });
    english = await classes.subject({ grades: [7, 8], languageRule: false });
    members = new MembersKit(database.migrator, await classes.account());
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('group_placement_gaps', () => {
    it('lists a student with no group row of the subject from the date, not a placed one', async () => {
      const oxford = await classes.schoolClass(north, northYear);
      const unplaced = await pupil(oxford);
      const placed = await pupil(oxford);
      const group = await classes.group(north, northYear, maths, [oxford]);
      await groupRow(group, maths, placed.student, '2026-09-01');
      expect(await gaps(north, [oxford], maths, '2026-10-12')).toEqual([
        { student_id: unplaced.student, class_id: oxford, first_day: '2026-10-12' },
      ]);
      // Another subject: both are missing it.
      expect((await gaps(north, [oxford], english, '2026-10-12')).length).toBe(2);
    });

    it('finds the first day without a group: after a row that ends early, before one that starts late', async () => {
      const oxford = await classes.schoolClass(north, northYear);
      const endsEarly = await pupil(oxford);
      const startsLate = await pupil(oxford);
      const group = await classes.group(north, northYear, maths, [oxford]);
      await groupRow(group, maths, endsEarly.student, '2026-09-01', '2026-11-02');
      await groupRow(group, maths, startsLate.student, '2026-11-02');
      expect(await gaps(north, [oxford], maths, '2026-10-12')).toEqual([
        { student_id: endsEarly.student, class_id: oxford, first_day: '2026-11-02' },
        { student_id: startsLate.student, class_id: oxford, first_day: '2026-10-12' },
      ]);
    });

    it('counts a withdrawn group row as none', async () => {
      const oxford = await classes.schoolClass(north, northYear);
      const planned = await pupil(oxford, '2026-11-02');
      const group = await classes.group(north, northYear, maths, [oxford]);
      const row = await groupRow(group, maths, planned.student, '2026-11-02');
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('group_memberships')
          .set({ valid_until: '2026-11-02', ended_by: 'withdrawn' })
          .where('id', '=', row)
          .execute(),
      );
      expect(await gaps(north, [oxford], maths, '2026-10-12')).toEqual([
        { student_id: planned.student, class_id: oxford, first_day: '2026-11-02' },
      ]);
    });

    it('reads only class rows with days after the date, of the classes named', async () => {
      const oxford = await classes.schoolClass(north, northYear);
      const yale = await classes.schoolClass(north, northYear);
      const gone = await pupil(oxford, '2026-09-01', '2026-10-01');
      const later = await pupil(yale, '2026-11-02');
      await classes.group(north, northYear, maths, [oxford, yale]);
      expect(await gaps(north, [oxford], maths, '2026-10-12')).toEqual([]);
      expect(await gaps(north, [oxford, yale], maths, '2026-10-12')).toEqual([
        { student_id: later.student, class_id: yale, first_day: '2026-11-02' },
      ]);
      // The day before the first class row ended, it is a gap.
      expect(await gaps(north, [oxford], maths, '2026-09-30')).toEqual([
        { student_id: gone.student, class_id: oxford, first_day: '2026-09-30' },
      ]);
    });

    it('sees no class of another branch: the branch filter applies', async () => {
      const southClass = await classes.schoolClass(south, southYear);
      const student = await members.student(south, { startsOn: '2026-09-01' });
      await members.member({
        branch: south,
        classId: southClass,
        studentId: student,
        from: '2026-09-01',
      });
      expect(await gaps(north, [southClass], maths, '2026-10-12')).toEqual([]);
      expect(await gaps(south, [southClass], maths, '2026-10-12')).toHaveLength(1);
    });
  });

  describe('class_group_subjects', () => {
    it('names the subjects of the active groups that draw from the class, a split and a group across classes', async () => {
      const oxford = await classes.schoolClass(north, northYear);
      const yale = await classes.schoolClass(north, northYear);
      expect(await subjectsOf(oxford)).toEqual([]);
      await classes.group(north, northYear, maths, [oxford]);
      await classes.group(north, northYear, maths, [oxford]);
      const across = await classes.group(north, northYear, english, [oxford, yale]);
      expect(await subjectsOf(oxford)).toEqual([maths, english].sort());
      expect(await subjectsOf(yale)).toEqual([english]);
      await database.migrator
        .updateTable('groups')
        .set({ archived_at: new Date('2026-10-01T00:00:00+05:00') })
        .where('id', '=', across)
        .execute();
      expect(await subjectsOf(yale)).toEqual([]);
    });

    it('does not mix the classes of another year', async () => {
      const nextYear = await classes.year(north, 'planned', '2027-09-01', '2028-05-31');
      const now = await classes.schoolClass(north, northYear);
      const next = await classes.schoolClass(north, nextYear);
      await classes.group(north, northYear, maths, [now]);
      expect(await subjectsOf(now)).toEqual([maths]);
      expect(await subjectsOf(next)).toEqual([]);
      await classes.group(north, nextYear, english, [next]);
      expect(await subjectsOf(now)).toEqual([maths]);
      expect(await subjectsOf(next)).toEqual([english]);
    });
  });

  describe('class_memberships_need_groups', () => {
    it('refuses at the commit a class row of a class split for a subject without a group row', async () => {
      const oxford = await classes.schoolClass(north, northYear);
      await classes.group(north, northYear, maths, [oxford]);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      const failure = await refusal(
        members.member({ branch: north, classId: oxford, studentId: student, from: '2026-10-12' }),
      );
      expect(failure).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'class_memberships_need_groups',
      });
      expect(
        await database.migrator
          .selectFrom('class_memberships')
          .select('id')
          .where('student_id', '=', student)
          .execute(),
      ).toEqual([]);
    });

    it('lets in a class row with group rows over every day it holds', async () => {
      const oxford = await classes.schoolClass(north, northYear);
      const group = await classes.group(north, northYear, maths, [oxford]);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      await together({ branch: north, classId: oxford, studentId: student, from: '2026-10-12' }, [
        { branch: north, groupId: group, subjectId: maths, studentId: student, from: '2026-10-12' },
      ]);
      // Two rows back to back cover it too.
      const other = await members.student(north, { startsOn: '2026-09-01' });
      const second = await classes.group(north, northYear, maths, [oxford]);
      await together({ branch: north, classId: oxford, studentId: other, from: '2026-10-12' }, [
        {
          branch: north,
          groupId: group,
          subjectId: maths,
          studentId: other,
          from: '2026-10-12',
          ownUntil: '2026-12-01',
        },
        { branch: north, groupId: second, subjectId: maths, studentId: other, from: '2026-12-01' },
      ]);
    });

    it('refuses a group row that starts a day after the class row, and a day missing at the end', async () => {
      const oxford = await classes.schoolClass(north, northYear);
      const group = await classes.group(north, northYear, maths, [oxford]);
      const late = await members.student(north, { startsOn: '2026-09-01' });
      expect(
        await refusal(
          together({ branch: north, classId: oxford, studentId: late, from: '2026-10-12' }, [
            {
              branch: north,
              groupId: group,
              subjectId: maths,
              studentId: late,
              from: '2026-10-13',
            },
          ]),
        ),
      ).toMatchObject({ constraint: 'class_memberships_need_groups' });
      const early = await members.student(north, { startsOn: '2026-09-01' });
      expect(
        await refusal(
          together({ branch: north, classId: oxford, studentId: early, from: '2026-10-12' }, [
            {
              branch: north,
              groupId: group,
              subjectId: maths,
              studentId: early,
              from: '2026-10-12',
              ownUntil: '2027-05-31',
            },
          ]),
        ),
      ).toMatchObject({ constraint: 'class_memberships_need_groups' });
    });

    it('refuses a class feeding two subjects with only one placed', async () => {
      const oxford = await classes.schoolClass(north, northYear);
      const mathsGroup = await classes.group(north, northYear, maths, [oxford]);
      await classes.group(north, northYear, english, [oxford]);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      expect(
        await refusal(
          together({ branch: north, classId: oxford, studentId: student, from: '2026-10-12' }, [
            {
              branch: north,
              groupId: mathsGroup,
              subjectId: maths,
              studentId: student,
              from: '2026-10-12',
            },
          ]),
        ),
      ).toMatchObject({ constraint: 'class_memberships_need_groups' });
    });

    it('refuses a group created in the transaction of the class row, after it', async () => {
      const oxford = await classes.schoolClass(north, northYear);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      const failure = await refusal(
        together(
          { branch: north, classId: oxford, studentId: student, from: '2026-10-12' },
          [],
          async (transaction) => {
            const group = await transaction
              .insertInto('groups')
              .values({
                branch_id: north,
                academic_year_id: northYear,
                subject_id: maths,
                name: 'G-Same',
                language: 'uz',
                max_size: 20,
              })
              .returning('id')
              .executeTakeFirstOrThrow();
            await transaction
              .insertInto('group_classes')
              .values({ group_id: group.id, class_id: oxford, branch_id: north })
              .execute();
          },
        ),
      );
      expect(failure).toMatchObject({ constraint: 'class_memberships_need_groups' });
    });

    it('refuses nothing when the group comes later: a group created, a class added, a group archived', async () => {
      const oxford = await classes.schoolClass(north, northYear);
      const yale = await classes.schoolClass(north, northYear);
      const first = await pupil(oxford);
      // A group created in a later transaction.
      const group = await classes.group(north, northYear, maths, [oxford]);
      // A class added to a group that holds members.
      const second = await pupil(yale);
      const across = await classes.group(north, northYear, english, [yale]);
      await groupRow(across, english, second.student, '2026-09-01');
      await database.migrator
        .insertInto('group_classes')
        .values({ group_id: across, class_id: oxford, branch_id: north })
        .execute();
      // A class with no group lets its rows in.
      const harvard = await classes.schoolClass(north, northYear);
      await pupil(harvard);
      expect(
        (await gaps(north, [oxford], maths, '2026-10-12')).map((one) => one.student_id),
      ).toEqual([first.student]);
      // An archive of a group whose rows ended.
      await database.migrator
        .updateTable('groups')
        .set({ archived_at: new Date('2026-10-01T00:00:00+05:00') })
        .where('id', '=', group)
        .execute();
      expect(await subjectsOf(oxford)).toEqual([english]);
    });

    it('lets in a class row with no days, and a class row of a class with no group', async () => {
      const oxford = await classes.schoolClass(north, northYear);
      await classes.group(north, northYear, maths, [oxford]);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      const leaving = await members.leaving(database.migrator, north, student, '2026-11-02');
      // A planned row written already emptied by a scheduled leaving (3.1b).
      await members.member({
        branch: north,
        classId: oxford,
        studentId: student,
        from: '2026-11-02',
        until: '2026-11-02',
        endedBy: 'leaving',
        leavingId: leaving,
      });
    });
  });

  describe('the causes of a row given back', () => {
    it('lets a cancel or an undo give back a row with its review tag, not a placement by hand', async () => {
      const oxford = await classes.schoolClass(north, northYear);
      const group = await classes.group(north, northYear, maths, [oxford]);
      for (const cause of ['cancel', 'undo', 'automatic'] as const) {
        const student = await members.student(north, { startsOn: '2026-09-01' });
        await database.migrator.transaction().execute(async (transaction) => {
          await transaction
            .insertInto('class_memberships')
            .values(
              memberValues({
                branch: north,
                classId: oxford,
                studentId: student,
                from: '2026-10-12',
              }),
            )
            .execute();
          await transaction
            .insertInto('group_memberships')
            .values({
              ...groupMemberValues({
                branch: north,
                groupId: group,
                subjectId: maths,
                studentId: student,
                from: '2026-10-12',
              }),
              cause,
              review: true,
            })
            .execute();
        });
      }
      const student = await members.student(north, { startsOn: '2026-09-01' });
      const failure = await refusal(
        database.migrator.transaction().execute(async (transaction) => {
          await transaction
            .insertInto('class_memberships')
            .values(
              memberValues({
                branch: north,
                classId: oxford,
                studentId: student,
                from: '2026-10-12',
              }),
            )
            .execute();
          await transaction
            .insertInto('group_memberships')
            .values({
              ...groupMemberValues({
                branch: north,
                groupId: group,
                subjectId: maths,
                studentId: student,
                from: '2026-10-12',
              }),
              cause: 'placement',
              review: true,
            })
            .execute();
        }),
      );
      expect(failure).toMatchObject({ constraint: 'group_memberships_review' });
      expect(
        await refusal(
          database.migrator
            .insertInto('group_memberships')
            .values({
              ...groupMemberValues({
                branch: north,
                groupId: group,
                subjectId: maths,
                studentId: student,
                from: '2026-10-12',
              }),
              // Task 3.3a (decision 12 of pull request #95) made `transfer` a cause;
              // a cause no task names is still refused.
              cause: 'merge',
            })
            .execute(),
        ),
      ).toMatchObject({ constraint: 'group_memberships_cause_check' });
    });
  });
});
