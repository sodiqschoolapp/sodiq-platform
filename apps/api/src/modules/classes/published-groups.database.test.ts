import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BRANCH_SETTING,
  MOMENT_SETTING,
  Transactions,
  type Transaction,
} from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit, groupMemberValues, memberValues } from '../../testing/members-kit.js';
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

// The split or group subjects of a class from the published version in force
// (db/migrations/0075, task 5.5a-2c, pull request #144): "The live load is
// read only; it changes only in a draft and takes effect on that version's
// start date" (edge/timetable, Versions and drafts); "Whether a class is split
// for a subject is set in the teaching load" (05, Group). On the run of a
// published version its group rows bind the class rows of the classes their
// groups draw from (decision 1); before the year's first published version
// the active groups bind, as 0049 did (its tests stand unchanged in
// class-groups.database.test.ts). Each test has a branch of its own, so that
// no published version of one test runs over another's class rows. All
// names are invented.
describe('the split and group subjects from the published version', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LoadKit;
  let members: MembersKit;
  let branchCount = 0;

  /**
   * A branch of its own with a year, a class of grade 7 with a Maths group
   * that draws from it (active), and a teacher of Maths.
   */
  async function school() {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Branch ${String(branchCount)}`);
    const year = await kit.classes.year(branch);
    const maths = await kit.classes.subject({ grades: [7] });
    const oxford = await kit.classes.schoolClass(branch, year);
    const group = await kit.classes.group(branch, year, maths, [oxford]);
    const { staffId } = await kit.teacher(branch, { subjects: [{ subject: maths, grades: [7] }] });
    return { branch, year, maths, oxford, group, teacher: staffId };
  }

  type School = Awaited<ReturnType<typeof school>>;

  /**
   * A version of the school's year from `startsOn` with one Maths row of the
   * class (`unit: 'class'`) or of a group, published unless said otherwise.
   */
  async function version(
    one: School,
    startsOn: string,
    unit: 'class' | { group: string },
    status: 'draft' | 'published' = 'published',
  ): Promise<string> {
    const id = await kit.version(one.branch, one.year, { startsOn });
    await kit.row({
      branch_id: one.branch,
      version_id: id,
      ...(unit === 'class' ? { class_id: one.oxford } : { group_id: unit.group }),
      subject_id: one.maths,
      teacher_id: one.teacher,
    });
    if (status === 'published') {
      await kit.setVersion(id, 'published');
    }
    return id;
  }

  /** A class row of a new student and the group rows given, in one transaction of the migrator. */
  async function join(
    one: School,
    from: string,
    groupRows: readonly { from: string; until?: string; group?: string }[] = [],
    until?: string,
  ): Promise<string> {
    const student = await members.student(one.branch, { startsOn: '2026-09-01' });
    await database.migrator.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('class_memberships')
        .values(
          memberValues({
            branch: one.branch,
            classId: one.oxford,
            studentId: student,
            from,
            ...(until === undefined ? {} : { ownUntil: until }),
          }),
        )
        .execute();
      for (const row of groupRows) {
        await transaction
          .insertInto('group_memberships')
          .values(
            groupMemberValues({
              branch: one.branch,
              groupId: row.group ?? one.group,
              subjectId: one.maths,
              studentId: student,
              from: row.from,
              ...(row.until === undefined ? {} : { ownUntil: row.until }),
            }),
          )
          .execute();
      }
    });
    return student;
  }

  /** The stretches of `class_group_subject_runs`, in a transaction of the branches given. */
  const runsOf = (branches: readonly string[], classId: string) =>
    transactions.run(branches, async (transaction) => {
      const found = await sql<{
        subject_id: string;
        from_day: string | null;
        until_day: string | null;
        group_ids: string[];
      }>`
        select subject_id, from_day::text as from_day, until_day::text as until_day, group_ids
        from class_group_subject_runs(${classId}::uuid)
      `.execute(transaction);
      return found.rows;
    });

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = new LoadKit(database.migrator);
    members = new MembersKit(database.migrator, await kit.classes.account());
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('class_memberships_need_groups', () => {
    it('binds a class row to a group row of the published load from the version’s start (Done when)', async () => {
      const one = await school();
      await version(one, '2026-09-01', 'class');
      await version(one, '2026-11-02', { group: one.group });
      expect(await refusal(join(one, '2026-10-12'))).toMatchObject({
        constraint: 'class_memberships_need_groups',
      });
      // A group row from the day after the start leaves the start uncovered.
      expect(await refusal(join(one, '2026-10-12', [{ from: '2026-11-03' }]))).toMatchObject({
        constraint: 'class_memberships_need_groups',
      });
      await join(one, '2026-10-12', [{ from: '2026-11-02' }]);
      await join(one, '2026-10-12', [], '2026-11-02');
    });

    it('lets in a class row while the published load teaches the class whole, an active group of the subject drawing from it', async () => {
      const one = await school();
      await version(one, '2026-09-01', 'class');
      await join(one, '2026-10-12');
    });

    it('lets a draft bind nobody: a draft’s group row of the class, an active group, inside a whole-class run', async () => {
      const one = await school();
      await version(one, '2026-09-01', 'class');
      await version(one, '2026-11-02', { group: one.group }, 'draft');
      await join(one, '2026-10-12');
    });

    it('binds by the active groups before the year’s first published version', async () => {
      const one = await school();
      await version(one, '2026-11-02', 'class');
      expect(await refusal(join(one, '2026-10-12', [], '2026-11-02'))).toMatchObject({
        constraint: 'class_memberships_need_groups',
      });
      await join(one, '2026-11-02');
      await join(one, '2026-10-12', [{ from: '2026-10-12', until: '2026-11-02' }]);
    });

    it('binds nothing by a published row whose group was archived', async () => {
      const one = await school();
      await version(one, '2026-09-01', { group: one.group });
      expect(await refusal(join(one, '2026-10-12'))).toMatchObject({
        constraint: 'class_memberships_need_groups',
      });
      await database.migrator
        .updateTable('groups')
        .set({ archived_at: new Date(NOW) })
        .where('id', '=', one.group)
        .execute();
      await join(one, '2026-10-12');
    });

    it('binds nothing by a published row whose group no longer draws from the class', async () => {
      const one = await school();
      const yale = await kit.classes.schoolClass(one.branch, one.year);
      const across = await kit.classes.group(one.branch, one.year, one.maths, [one.oxford, yale]);
      await version(one, '2026-09-01', { group: across });
      // The class's own group is not in the load, so only `across` could bind.
      expect(await refusal(join(one, '2026-10-12'))).toMatchObject({
        constraint: 'class_memberships_need_groups',
      });
      await database.migrator
        .deleteFrom('group_classes')
        .where('group_id', '=', across)
        .where('class_id', '=', one.oxford)
        .execute();
      await join(one, '2026-10-12');
    });
  });

  describe('class_memberships_regained', () => {
    /** In a transaction of the branch with the moment set, as the application runs. */
    const inBranch = (one: School, work: (transaction: Transaction) => Promise<void>) =>
      database.migrator.transaction().execute(async (transaction) => {
        await sql`
          select set_config(${BRANCH_SETTING}, ${`{${one.branch}}`}, true),
            set_config(${MOMENT_SETTING}, ${new Date(NOW).toISOString()}, true)
        `.execute(transaction);
        await work(transaction);
      });

    /**
     * A student of the class from 1 September with no group row, whose class
     * row a leaving cut at 10 October (as one-stay.database.test.ts writes it).
     */
    async function gone(one: School): Promise<{ student: string; row: string; leaving: string }> {
      const student = await join(one, '2026-09-01', [], YEAR_END);
      const row = await database.migrator
        .selectFrom('class_memberships')
        .select('id')
        .where('student_id', '=', student)
        .executeTakeFirstOrThrow();
      let leaving = '';
      await inBranch(one, async (transaction) => {
        leaving = await members.leaving(transaction, one.branch, student, '2026-10-10');
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-10-10', ended_by: 'leaving', leaving_id: leaving })
          .where('id', '=', row.id)
          .execute();
      });
      return { student, row: row.id, leaving };
    }

    /** The undo of that leaving with the class row grown back to its own end. */
    const grow = (one: School, gone: { student: string; row: string; leaving: string }) =>
      inBranch(one, async (transaction) => {
        const status = await transaction
          .selectFrom('student_statuses')
          .select('valid_from')
          .where('id', '=', gone.leaving)
          .executeTakeFirstOrThrow();
        await transaction
          .updateTable('student_statuses')
          .set({ valid_until: status.valid_from })
          .where('id', '=', gone.leaving)
          .execute();
        await transaction
          .insertInto('student_statuses')
          .values({
            student_id: gone.student,
            branch_id: one.branch,
            status: 'active',
            valid_from: status.valid_from,
            cause: 'cancel',
          })
          .execute();
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: YEAR_END, ended_by: null, leaving_id: null, ended_by_move_id: null })
          .where('id', '=', gone.row)
          .execute();
      });

    it('refuses an extension into the run of a published group row with no group row', async () => {
      const one = await school();
      await version(one, '2026-09-01', 'class');
      const left = await gone(one);
      await version(one, '2026-11-02', { group: one.group });
      expect(await refusal(grow(one, left))).toMatchObject({
        constraint: 'class_memberships_need_groups',
      });
    });

    it('lets in an extension into a run that teaches the class whole, an active group present', async () => {
      const one = await school();
      await version(one, '2026-09-01', 'class');
      const left = await gone(one);
      await version(one, '2026-11-02', 'class');
      await grow(one, left);
    });
  });

  describe('class_group_subject_runs', () => {
    it('gives the active groups up to the first published start, then each run, joining runs with the same groups', async () => {
      const one = await school();
      const second = await kit.classes.group(one.branch, one.year, one.maths, [one.oxford]);
      await version(one, '2026-10-19', { group: one.group });
      await version(one, '2026-11-02', { group: one.group });
      await version(one, '2026-12-07', 'class');
      await version(one, '2027-01-11', { group: second });
      expect(await runsOf([one.branch], one.oxford)).toEqual([
        {
          subject_id: one.maths,
          from_day: null,
          until_day: '2026-10-19',
          group_ids: [one.group, second].sort(),
        },
        {
          subject_id: one.maths,
          from_day: '2026-10-19',
          until_day: '2026-12-07',
          group_ids: [one.group],
        },
        { subject_id: one.maths, from_day: '2027-01-11', until_day: null, group_ids: [second] },
      ]);
    });

    it('gives a run on one start to the higher number', async () => {
      const one = await school();
      await version(one, '2026-09-01', { group: one.group });
      await version(one, '2026-09-01', 'class');
      // Only the active groups before the year's first day: no day of the year.
      expect(await runsOf([one.branch], one.oxford)).toEqual([
        { subject_id: one.maths, from_day: null, until_day: '2026-09-01', group_ids: [one.group] },
      ]);
    });

    it('reads only the versions of the class’s branch and year, also in a transaction of two branches', async () => {
      const one = await school();
      const other = await school();
      await version(one, '2026-09-01', 'class');
      // Another branch's version with a later start and a higher number, and
      // a version of the next year: either would end or replace the run if read.
      await version(other, '2026-11-02', 'class');
      await kit.version(other.branch, other.year, { startsOn: '2026-11-03', status: 'published' });
      const nextYear = await kit.classes.year(one.branch, 'planned', '2027-09-01', '2028-05-31');
      await kit.version(one.branch, nextYear, { startsOn: '2027-09-01', status: 'published' });
      await version(one, '2026-11-02', { group: one.group });
      expect(await runsOf([one.branch, other.branch], one.oxford)).toEqual([
        { subject_id: one.maths, from_day: null, until_day: '2026-09-01', group_ids: [one.group] },
        { subject_id: one.maths, from_day: '2026-11-02', until_day: null, group_ids: [one.group] },
      ]);
    });
  });
});
