import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { MembersKit, groupMemberValues, type GroupMemberRow } from '../../testing/members-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const EXCLUSION_VIOLATION = '23P01';

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

// The rules of group membership that the database itself keeps
// (db/migrations/0048), also when the application has a fault: one group per
// student per subject per date (developer rules, Membership; the done-when of
// task 3.2b); the maximum size on every date of a row, counting scheduled
// joins and leaves (edge, "Groups work the same way"); a group row only inside
// a class row of one of the group's classes, checked at the commit from both
// sides (decision 8); the group's archive, maximum and classes against its
// members (decision 16); rows that only shrink, the review tag from true to
// false (decision 3); the grants, the branch filter and the cascade of a
// student deleted. All names are invented.
describe('group membership in the database', () => {
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

  const inBranch = <T>(branch: string | string[], work: (transaction: Transaction) => Promise<T>) =>
    transactions.run(Array.isArray(branch) ? branch : [branch], work);

  /** A group row as the application writes it, in a transaction of its branch. */
  const placeInGroup = (row: GroupMemberRow) =>
    inBranch(row.branch, (transaction) => members.groupMember(row, transaction));

  /**
   * Two classes of grade 7 in the north, a maths group of both, a student of
   * the first in force, and `others` more students of the first in force from
   * the start of the year. The class rows come before the group, in
   * transactions of their own, so the students are not yet placed (0049: only
   * the insert of a class row needs its group rows).
   */
  async function setting(input: { size?: number; startsOn?: string; others?: number } = {}) {
    const oxford = await classes.schoolClass(north, northYear);
    const yale = await classes.schoolClass(north, northYear);
    const student = await members.student(north, { startsOn: input.startsOn ?? '2026-09-01' });
    const classRow = await members.member({
      branch: north,
      classId: oxford,
      studentId: student,
      from: input.startsOn ?? '2026-09-01',
    });
    const others: string[] = [];
    for (let index = 0; index < (input.others ?? 0); index += 1) {
      others.push(await pupilOf(oxford));
    }
    const group = await classes.group(north, northYear, maths, [oxford, yale], {
      size: input.size ?? 20,
    });
    return { oxford, yale, group, student, classRow, others };
  }

  /** A student of the class in force from the start of the year. */
  async function pupilOf(classId: string, from = '2026-09-01'): Promise<string> {
    const student = await members.student(north, { startsOn: '2026-09-01' });
    await members.member({ branch: north, classId, studentId: student, from });
    return student;
  }

  /**
   * A leaving written as the service writes it, in one transaction: the
   * status rows and every class row of the student cut at the first inactive
   * day. Answers the inactive row.
   */
  const leaveClasses = (branch: string, studentId: string, day: string) =>
    database.migrator.transaction().execute(async (transaction) => {
      const leaving = await members.leaving(transaction, branch, studentId, day);
      await transaction
        .updateTable('class_memberships')
        .set({ valid_until: day, ended_by: 'leaving', leaving_id: leaving })
        .where('student_id', '=', studentId)
        .where('valid_until', '>', day)
        .execute();
      return leaving;
    });

  /** A branch with a year of its own, for a closed year in the past. */
  async function closedYearBranch(name: string, start: string, end: string) {
    const branch = await insertBranch(database.migrator, name);
    const year = await classes.year(branch, 'planned', start, end);
    return { branch, year };
  }

  const groupRowsOf = (studentId: string) =>
    database.migrator
      .selectFrom('group_memberships')
      .select(['group_id', 'valid_from', 'valid_until', 'ended_by'])
      .where('student_id', '=', studentId)
      .orderBy('valid_from')
      .execute();

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

  describe('one group per student per subject per date (developer rules, Membership)', () => {
    it('refuses a student in two groups of one subject on one date', async () => {
      const { oxford, group, student } = await setting();
      const second = await classes.group(north, northYear, maths, [oxford]);
      await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-09-01',
      });
      const refused = await refusal(
        placeInGroup({
          branch: north,
          groupId: second,
          subjectId: maths,
          studentId: student,
          from: '2026-10-14',
        }),
      );
      expect(refused).toMatchObject({
        code: EXCLUSION_VIOLATION,
        constraint: 'group_memberships_no_overlap',
      });
      expect(await groupRowsOf(student)).toHaveLength(1);
    });

    it('allows groups of two subjects on one date, ends that touch, and an empty row', async () => {
      const { oxford, group, student } = await setting();
      const englishGroup = await classes.group(north, northYear, english, [oxford]);
      const second = await classes.group(north, northYear, maths, [oxford]);
      await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-10-14',
        ownUntil: '2026-11-02',
      });
      await placeInGroup({
        branch: north,
        groupId: englishGroup,
        subjectId: english,
        studentId: student,
        from: '2026-10-14',
      });
      // One maths group up to 2 November and the next from that day.
      const next = await placeInGroup({
        branch: north,
        groupId: second,
        subjectId: maths,
        studentId: student,
        from: '2026-11-02',
      });
      // A withdrawn row holds no day and meets nothing.
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('group_memberships')
          .set({ valid_until: '2026-11-02', ended_by: 'withdrawn' })
          .where('id', '=', next)
          .execute(),
      );
      const third = await classes.group(north, northYear, maths, [oxford]);
      await placeInGroup({
        branch: north,
        groupId: third,
        subjectId: maths,
        studentId: student,
        from: '2026-11-02',
      });
      expect(await groupRowsOf(student)).toHaveLength(4);
    });

    it('refuses a row whose subject is not its group’s', async () => {
      const { group, student } = await setting();
      expect(
        await refusal(
          placeInGroup({
            branch: north,
            groupId: group,
            subjectId: english,
            studentId: student,
            from: '2026-10-14',
          }),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'group_memberships_subject' });
    });
  });

  describe('the maximum size, scheduled joins and leaves counted', () => {
    it('refuses a third member of a group of two on a date both hold', async () => {
      const {
        group,
        student,
        others: [second = '', third = ''],
      } = await setting({ size: 2, others: 2 });
      await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-10-14',
      });
      // A scheduled join takes its seat from its date.
      await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: second,
        from: '2026-12-01',
      });
      expect(
        await refusal(
          placeInGroup({
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: third,
            from: '2026-10-14',
          }),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'group_memberships_full' });
    });

    it('lets a member in up to a scheduled leaving of another', async () => {
      const {
        group,
        student,
        others: [second = ''],
      } = await setting({ size: 1, others: 1 });
      const leaving = await leaveClasses(north, student, '2026-12-01');
      await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-10-14',
        until: '2026-12-01',
        endedBy: 'leaving',
        leavingId: leaving,
      });
      expect(
        await refusal(
          placeInGroup({
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: second,
            from: '2026-11-01',
          }),
        ),
      ).toMatchObject({ constraint: 'group_memberships_full' });
      await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: second,
        from: '2026-12-01',
      });
      expect(await groupRowsOf(second)).toHaveLength(1);
    });
  });

  describe('a group row only inside a class row of one of the group’s classes (decision 8)', () => {
    it('refuses a group row of a student of no class of the group, at the commit', async () => {
      const other = await classes.schoolClass(north, northYear);
      const group = await classes.group(north, northYear, maths, [other]);
      const student = await members.student(north);
      const elsewhere = await classes.schoolClass(north, northYear);
      await members.member({
        branch: north,
        classId: elsewhere,
        studentId: student,
        from: '2026-09-01',
      });
      expect(
        await refusal(
          placeInGroup({
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2026-10-14',
          }),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'group_memberships_in_class' });
      expect(await groupRowsOf(student)).toEqual([]);
    });

    it('refuses a group row that runs past its class row', async () => {
      const { group, student, classRow } = await setting();
      await leaveClasses(north, student, '2026-12-01');
      expect(await members.rowOf(classRow)).toMatchObject({ valid_until: '2026-12-01' });
      expect(
        await refusal(
          placeInGroup({
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2026-10-14',
          }),
        ),
      ).toMatchObject({ constraint: 'group_memberships_in_class' });
    });

    it('refuses a class row cut by a leaving without its group rows, and passes with them', async () => {
      const { group, student, classRow } = await setting();
      const row = await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-10-14',
      });
      const leave = (cutGroups: boolean) =>
        inBranch(north, async (transaction) => {
          const leaving = await members.leaving(transaction, north, student, '2026-12-01');
          await transaction
            .updateTable('class_memberships')
            .set({ valid_until: '2026-12-01', ended_by: 'leaving', leaving_id: leaving })
            .where('id', '=', classRow)
            .execute();
          if (cutGroups) {
            await transaction
              .updateTable('group_memberships')
              .set({ valid_until: '2026-12-01', ended_by: 'leaving', leaving_id: leaving })
              .where('id', '=', row)
              .execute();
          }
        });
      expect(await refusal(leave(false))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'group_memberships_in_class',
      });
      expect(await members.groupRowOf(row)).toMatchObject({ valid_until: '2027-06-01' });
      await leave(true);
      expect(await members.groupRowOf(row)).toMatchObject({
        valid_until: '2026-12-01',
        ended_by: 'leaving',
      });
    });

    it('refuses the withdraw of a planned class row that keeps its group row', async () => {
      const oxford = await classes.schoolClass(north, northYear);
      const student = await members.student(north, { startsOn: '2026-09-01' });
      const classRow = await members.member({
        branch: north,
        classId: oxford,
        studentId: student,
        from: '2026-11-02',
      });
      const group = await classes.group(north, northYear, maths, [oxford]);
      const row = await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-11-02',
      });
      const withdraw = (withGroup: boolean) =>
        inBranch(north, async (transaction) => {
          await transaction
            .updateTable('class_memberships')
            .set({ valid_until: '2026-11-02', ended_by: 'withdrawn' })
            .where('id', '=', classRow)
            .execute();
          if (withGroup) {
            await transaction
              .updateTable('group_memberships')
              .set({ valid_until: '2026-11-02', ended_by: 'class_withdrawn' })
              .where('id', '=', row)
              .execute();
          }
        });
      expect(await refusal(withdraw(false))).toMatchObject({
        constraint: 'group_memberships_in_class',
      });
      await withdraw(true);
      expect(await members.groupRowOf(row)).toMatchObject({
        valid_until: '2026-11-02',
        ended_by: 'class_withdrawn',
      });
    });

    it('refuses taking a class out of a group that holds or held its students', async () => {
      const { oxford, yale, group, student } = await setting();
      await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-10-14',
      });
      const takeOut = (classId: string, groupId = group) =>
        inBranch(north, (transaction) =>
          transaction
            .deleteFrom('group_classes')
            .where('group_id', '=', groupId)
            .where('class_id', '=', classId)
            .execute(),
        );
      expect(await refusal(takeOut(oxford))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'group_class_has_members',
      });
      // A class whose students the group does not hold may go.
      await takeOut(yale);

      // A group that held the class's students only in the past.
      const cambridge = await classes.schoolClass(north, northYear);
      const harvard = await classes.schoolClass(north, northYear);
      const former = await members.student(north);
      const leaving = await members.leaving(database.migrator, north, former, '2026-10-01');
      await database.migrator
        .insertInto('class_memberships')
        .values({
          branch_id: north,
          student_id: former,
          class_id: cambridge,
          valid_from: '2026-09-01',
          valid_until: '2026-10-01',
          own_until: '2027-06-01',
          cause: 'placement',
          ended_by: 'leaving',
          leaving_id: leaving,
        })
        .execute();
      const past = await classes.group(north, northYear, maths, [cambridge, harvard]);
      await database.migrator
        .insertInto('group_memberships')
        .values(
          groupMemberValues({
            branch: north,
            groupId: past,
            subjectId: maths,
            studentId: former,
            from: '2026-09-01',
            until: '2026-10-01',
            endedBy: 'leaving',
            leavingId: leaving,
          }),
        )
        .execute();
      expect(await refusal(takeOut(cambridge, past))).toMatchObject({
        constraint: 'group_class_has_members',
      });
    });
  });

  describe('the guard of a new row', () => {
    it('refuses a row of an archived group', async () => {
      const { group, student } = await setting();
      await database.migrator
        .updateTable('groups')
        .set({ archived_at: new Date(NOW) })
        .where('id', '=', group)
        .execute();
      expect(
        await refusal(
          placeInGroup({
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2026-10-14',
          }),
        ),
      ).toMatchObject({ constraint: 'group_memberships_group_archived' });
    });

    it('refuses a row in a closed year', async () => {
      const { branch: west, year } = await closedYearBranch('West', '2025-09-01', '2026-05-31');
      const south = west;
      const oldClass = await classes.schoolClass(south, year);
      const student = await members.student(south, { startsOn: '2025-09-01' });
      await members.member({
        branch: south,
        classId: oldClass,
        studentId: student,
        from: '2025-09-01',
        ownUntil: '2026-06-01',
      });
      const group = await classes.group(south, year, maths, [oldClass]);
      await classes.setYear(year, 'current');
      await classes.setYear(year, 'closed');
      expect(
        await refusal(
          placeInGroup({
            branch: south,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2025-10-01',
            ownUntil: '2026-06-01',
          }),
        ),
      ).toMatchObject({ constraint: 'class_year_closed' });
    });

    it('refuses a row outside the year', async () => {
      const { group, student } = await setting();
      expect(
        await refusal(
          placeInGroup({
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2026-10-14',
            ownUntil: '2027-07-01',
          }),
        ),
      ).toMatchObject({ constraint: 'group_memberships_outside_year' });
    });

    it('refuses a student of another branch', async () => {
      const { group } = await setting();
      const southern = await members.student(south);
      expect(
        await refusal(
          placeInGroup({
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: southern,
            from: '2026-10-14',
          }),
        ),
      ).toMatchObject({ constraint: 'group_memberships_student_branch' });
    });

    it('refuses a row inserted cut other than by a leaving, and a leaving of no leaving', async () => {
      const { group, student } = await setting();
      expect(
        await refusal(
          placeInGroup({
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2026-10-14',
            until: '2026-10-14',
            ownUntil: '2026-12-01',
            endedBy: null,
          }),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'group_memberships_insert_ended' });
      const withdrawn = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .insertInto('group_memberships')
            .values({
              ...groupMemberValues({
                branch: north,
                groupId: group,
                subjectId: maths,
                studentId: student,
                from: '2026-10-14',
              }),
              valid_until: '2026-10-14',
              ended_by: 'withdrawn',
            })
            .execute(),
        ),
      );
      expect(withdrawn).toMatchObject({ constraint: 'group_memberships_insert_ended' });
      const statusOfAnother = await database.migrator
        .selectFrom('student_statuses')
        .select('id')
        .where('student_id', '<>', student)
        .executeTakeFirstOrThrow();
      expect(
        await refusal(
          placeInGroup({
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2026-10-14',
            until: '2026-12-01',
            endedBy: 'leaving',
            leavingId: statusOfAnother.id,
          }),
        ),
      ).toMatchObject({ constraint: 'group_memberships_leaving' });
    });

    it('refuses the review tag on a placement by hand', async () => {
      const { group, student } = await setting();
      expect(
        await refusal(
          placeInGroup({
            branch: north,
            groupId: group,
            subjectId: maths,
            studentId: student,
            from: '2026-10-14',
            cause: 'placement',
            review: true,
          }),
        ),
      ).toMatchObject({ constraint: 'group_memberships_review' });
      await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-10-14',
        cause: 'automatic',
        review: true,
      });
    });
  });

  describe('rows only shrink (decision 3)', () => {
    it('refuses a row that grows, a withdrawn row changed, a leaving end taken back and another column', async () => {
      const { group, student } = await setting();
      const row = await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-10-14',
        cause: 'automatic',
        review: true,
      });
      const change = (values: Record<string, unknown>, id = row) =>
        inBranch(north, (transaction) =>
          transaction.updateTable('group_memberships').set(values).where('id', '=', id).execute(),
        );
      // The review tag goes from true to false, never back.
      await change({ review: false });
      expect(await refusal(change({ review: true }))).toMatchObject({
        constraint: 'group_memberships_only_shrink',
      });
      // Through the migrator, a column the application may not write.
      expect(
        await refusal(
          database.migrator
            .updateTable('group_memberships')
            .set({ valid_from: '2026-10-15' })
            .where('id', '=', row)
            .execute(),
        ),
      ).toMatchObject({ constraint: 'group_memberships_only_shrink' });

      // A leaving cuts the class row and the group row in one transaction.
      const leaving = await inBranch(north, async (transaction) => {
        const inactive = await members.leaving(transaction, north, student, '2027-03-01');
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2027-03-01', ended_by: 'leaving', leaving_id: inactive })
          .where('student_id', '=', student)
          .execute();
        await transaction
          .updateTable('group_memberships')
          .set({ valid_until: '2027-03-01', ended_by: 'leaving', leaving_id: inactive })
          .where('id', '=', row)
          .execute();
        return inactive;
      });
      expect(await members.groupRowOf(row)).toMatchObject({ leaving_id: leaving });
      expect(
        await refusal(change({ valid_until: '2027-06-01', ended_by: null, leaving_id: null })),
      ).toMatchObject({ constraint: 'group_memberships_only_shrink' });
      expect(await refusal(change({ valid_until: '2027-04-01' }))).toMatchObject({
        constraint: 'group_memberships_only_shrink',
      });
    });

    it('withdraws a planned row only before its day, and for good', async () => {
      const {
        group,
        student,
        others: [other = ''],
      } = await setting({ others: 1 });
      const planned = await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-11-02',
      });
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('group_memberships')
          .set({ valid_until: '2026-11-02', ended_by: 'withdrawn' })
          .where('id', '=', planned)
          .execute(),
      );
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('group_memberships')
              .set({ ended_by: 'class_withdrawn' })
              .where('id', '=', planned)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'group_memberships_only_shrink' });

      const inForce = await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: other,
        from: '2026-10-14',
      });
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('group_memberships')
              .set({ valid_until: '2026-10-14', ended_by: 'withdrawn' })
              .where('id', '=', inForce)
              .execute(),
          ),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'group_memberships_withdraw_planned' });
    });

    it('withdraws with a class row only before its day, and names only a leaving of the student', async () => {
      const {
        group,
        student,
        others: [other = ''],
      } = await setting({ others: 1 });
      const inForce = await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-10-14',
      });
      const change = (values: Record<string, unknown>) =>
        inBranch(north, (transaction) =>
          transaction
            .updateTable('group_memberships')
            .set(values)
            .where('id', '=', inForce)
            .execute(),
        );
      expect(
        await refusal(change({ valid_until: '2026-10-14', ended_by: 'class_withdrawn' })),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'group_memberships_withdraw_planned' });
      // The update branch of the leaving check: a leaving of another student.
      const foreign = await leaveClasses(north, other, '2027-03-01');
      expect(
        await refusal(
          change({ valid_until: '2027-03-01', ended_by: 'leaving', leaving_id: foreign }),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'group_memberships_leaving' });
    });

    it('refuses a change of the end in a closed year', async () => {
      const { branch: east, year } = await closedYearBranch('East', '2024-09-01', '2025-05-31');
      const south = east;
      const oldClass = await classes.schoolClass(south, year);
      const student = await members.student(south, { startsOn: '2024-09-01' });
      await members.member({
        branch: south,
        classId: oldClass,
        studentId: student,
        from: '2024-09-01',
        ownUntil: '2025-06-01',
      });
      const group = await classes.group(south, year, maths, [oldClass]);
      const row = await members.groupMember({
        branch: south,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2024-09-01',
        ownUntil: '2025-06-01',
      });
      // A leaving of 1 April cut both rows before the year closed.
      const leaving = await database.migrator.transaction().execute(async (transaction) => {
        const inactive = await members.leaving(transaction, south, student, '2025-04-01');
        for (const table of ['class_memberships', 'group_memberships'] as const) {
          await transaction
            .updateTable(table)
            .set({ valid_until: '2025-04-01', ended_by: 'leaving', leaving_id: inactive })
            .where('student_id', '=', student)
            .execute();
        }
        return inactive;
      });
      await classes.setYear(year, 'current');
      await classes.setYear(year, 'closed');
      // The same leaving cutting the row again, earlier, in the closed year.
      expect(
        await refusal(
          database.migrator
            .updateTable('group_memberships')
            .set({ valid_until: '2025-03-01', ended_by: 'leaving', leaving_id: leaving })
            .where('id', '=', row)
            .execute(),
        ),
      ).toMatchObject({ constraint: 'class_year_closed' });
    });
  });

  describe('the group’s side (decision 16)', () => {
    it('refuses the archive of a group with members in force or planned, not with past ones', async () => {
      const { group, student } = await setting();
      await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-11-02',
      });
      const archive = (id: string) =>
        inBranch(north, (transaction) =>
          transaction
            .updateTable('groups')
            .set({ archived_at: new Date(NOW) })
            .where('id', '=', id)
            .execute(),
        );
      expect(await refusal(archive(group))).toMatchObject({ constraint: 'group_has_members' });

      const cambridge = await classes.schoolClass(north, northYear);
      const former = await members.student(north);
      const leaving = await members.leaving(database.migrator, north, former, '2026-10-01');
      await members.member({
        branch: north,
        classId: cambridge,
        studentId: former,
        from: '2026-09-01',
        until: '2026-10-01',
        endedBy: 'leaving',
        leavingId: leaving,
      });
      const past = await classes.group(north, northYear, maths, [cambridge]);
      await members.groupMember({
        branch: north,
        groupId: past,
        subjectId: maths,
        studentId: former,
        from: '2026-09-01',
        until: '2026-10-01',
        endedBy: 'leaving',
        leavingId: leaving,
      });
      await archive(past);
    });

    it('refuses a maximum below the members of a date from today on', async () => {
      const {
        group,
        student,
        others: [second = ''],
      } = await setting({ size: 3, others: 1 });
      await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-10-14',
      });
      await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: second,
        from: '2026-12-01',
      });
      const resize = (size: number) =>
        inBranch(north, (transaction) =>
          transaction
            .updateTable('groups')
            .set({ max_size: size })
            .where('id', '=', group)
            .execute(),
        );
      expect(await refusal(resize(1))).toMatchObject({ constraint: 'group_size_below_members' });
      await resize(2);
    });
  });

  describe('grants, the branch filter and the cascade', () => {
    it('gives the application no delete and no write of the fixed columns', async () => {
      const { group, student } = await setting();
      const row = await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-10-14',
      });
      // Task 3.3d (decision 2 of pull request #98, Look first): the student
      // has an update grant, guarded: never without a merge of the pair
      // written in the transaction (`memberships_merge`, 0054).
      const other = await members.student(north);
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('group_memberships')
              .set({ student_id: other })
              .where('id', '=', row)
              .execute(),
          ),
        ),
      ).toMatchObject({ constraint: 'memberships_merge' });
      for (const values of [
        { group_id: group },
        { subject_id: maths },
        { valid_from: '2026-10-15' },
        { own_until: '2027-05-01' },
        { cause: 'automatic' },
      ]) {
        expect(
          await refusal(
            inBranch(north, (transaction) =>
              transaction
                .updateTable('group_memberships')
                .set(values)
                .where('id', '=', row)
                .execute(),
            ),
          ),
        ).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
      }
      expect(
        await refusal(
          inBranch(north, (transaction) =>
            transaction.deleteFrom('group_memberships').where('id', '=', row).execute(),
          ),
        ),
      ).toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    });

    it('shows a branch its own rows only, and refuses a row of another branch', async () => {
      const { group, student } = await setting();
      await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-10-14',
      });
      const seen = await inBranch(south, (transaction) =>
        transaction
          .selectFrom('group_memberships')
          .select('id')
          .where('student_id', '=', student)
          .execute(),
      );
      expect(seen).toEqual([]);
      expect(
        await refusal(
          inBranch(south, (transaction) =>
            members.groupMember(
              {
                branch: north,
                groupId: group,
                subjectId: maths,
                studentId: student,
                from: '2026-12-01',
              },
              transaction,
            ),
          ),
        ),
        // The south sees no student of the north: the guard refuses before the row filter.
      ).toMatchObject({ constraint: 'group_memberships_student_branch' });
      expect(await groupRowsOf(student)).toHaveLength(1);
      // A group of the south named with the north as its branch: the composite key refuses.
      const southClass = await classes.schoolClass(south, southYear);
      const southGroup = await classes.group(south, southYear, maths, [southClass]);
      expect(
        await refusal(
          database.migrator
            .insertInto('group_memberships')
            .values(
              groupMemberValues({
                branch: north,
                groupId: southGroup,
                subjectId: maths,
                studentId: await members.student(north),
                from: '2026-12-01',
              }),
            )
            .execute(),
        ),
      ).toMatchObject({ constraint: 'group_memberships_group_fkey' });
    });

    it('takes the group rows with a student deleted as created twice', async () => {
      const { group, student } = await setting();
      await placeInGroup({
        branch: north,
        groupId: group,
        subjectId: maths,
        studentId: student,
        from: '2026-10-14',
      });
      await inBranch(north, (transaction) =>
        transaction.deleteFrom('students').where('id', '=', student).execute(),
      );
      expect(await groupRowsOf(student)).toEqual([]);
    });
  });

  it('counts the members of a date as the guard does', async () => {
    const {
      group,
      student,
      others: [second = ''],
    } = await setting({ others: 1 });
    await placeInGroup({
      branch: north,
      groupId: group,
      subjectId: maths,
      studentId: student,
      from: '2026-10-14',
    });
    await placeInGroup({
      branch: north,
      groupId: group,
      subjectId: maths,
      studentId: second,
      from: '2026-12-01',
    });
    const peak = (from: string, until: string | null) =>
      inBranch(north, async (transaction) => {
        const found = await sql<{
          peak: number;
        }>`select group_members_peak(${group}::uuid, ${from}::date, ${until}::date) as peak`.execute(
          transaction,
        );
        return found.rows[0]?.peak;
      });
    expect(await peak('2026-10-14', '2026-12-01')).toBe(1);
    expect(await peak('2026-10-14', null)).toBe(2);
  });
});
