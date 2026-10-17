import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRANCH_SETTING, Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LoadKit } from '../../testing/load-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const INSUFFICIENT_PRIVILEGE = '42501';

/** Thursday 15 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-15T10:00:00+05:00';
const STARTS_ON = '2026-10-19';

interface Line {
  row_id: string | null;
  version_id: string | null;
  branch_id: string;
  rows: number;
}

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// `department_move_loads` of 0057 (task 3.4c, pull request #101): the load
// rows a department move would leave with a teacher outside the subject's
// department (edge/people-roles-accounts, row 15), drafts included (decision
// 1), of versions whose year reaches the start date (decision 2); a vacancy's
// row on a subject move (correction 1); the Tutor exception of row 13
// (decision 7); the rows of other branches as a count only (decision 3). All
// names are invented.
describe('department_move_loads in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let kit: LoadKit;
  let north: string;
  let south: string;
  let northYear: string;
  let southYear: string;
  let steam: string;
  let national: string;
  let tutorsDepartment: string;
  let branchCount = 0;

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  const loads = (
    branch: string,
    input: {
      teacher?: string | null;
      subject?: string | null;
      department: string | null;
      startsOn?: string | null;
      asBranch?: string;
    },
  ): Promise<Line[]> =>
    inBranch(input.asBranch ?? branch, async (transaction) => {
      const found = await sql<Line>`
        select row_id, version_id, branch_id, rows
        from department_move_loads(
          ${branch}::uuid, ${input.teacher ?? null}::uuid, ${input.subject ?? null}::uuid,
          ${input.department}::uuid, ${input.startsOn === undefined ? STARTS_ON : input.startsOn}::date
        )
        order by branch_id, row_id
      `.execute(transaction);
      return found.rows;
    });

  /** A STEAM teacher of a STEAM subject on a class row of a new draft. */
  async function steamRow(
    input: { branch?: string; year?: string; version?: string } = {},
  ): Promise<{ row: string; teacher: string; subject: string; version: string; classId: string }> {
    const branch = input.branch ?? north;
    const year = input.year ?? northYear;
    const subject = await kit.classes.subject({ grades: [7] });
    const classId = await kit.classes.schoolClass(branch, year, { grade: 7, language: 'uz' });
    const { staffId } = await kit.teacher(branch, { subjects: [{ subject, grades: [7] }] });
    const version = input.version ?? (await kit.version(branch, year, { startsOn: STARTS_ON }));
    const row = await kit.row({
      branch_id: branch,
      version_id: version,
      class_id: classId,
      subject_id: subject,
      teacher_id: staffId,
    });
    return { row, teacher: staffId, subject, version, classId };
  }

  /** A branch of its own with a year, for a test that closes it or dates it. */
  async function ownBranch(
    status: 'planned' | 'current' | 'closed' = 'current',
    start?: string,
    end?: string,
  ): Promise<{ branch: string; year: string }> {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Branch ${String(branchCount)}`);
    return { branch, year: await kit.classes.year(branch, status, start, end) };
  }

  const departmentId = async (name: string): Promise<string> =>
    (
      await database.migrator
        .selectFrom('departments')
        .select('id')
        .where('name_en', '=', name)
        .executeTakeFirstOrThrow()
    ).id;

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    kit = new LoadKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    northYear = await kit.classes.year(north);
    southYear = await kit.classes.year(south);
    steam = await departmentId('STEAM');
    national = await departmentId('National');
    tutorsDepartment = await departmentId('Tutors');
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('a teacher move', () => {
    it('counts a row whose subject stays in the old department, with its version', async () => {
      const { row, teacher, version } = await steamRow();
      expect(await loads(north, { teacher, department: national })).toEqual([
        { row_id: row, version_id: version, branch_id: north, rows: 1 },
      ]);
    });

    it('leaves a row whose subject is in the new department', async () => {
      const { teacher } = await steamRow();
      expect(await loads(north, { teacher, department: steam })).toEqual([]);
    });

    it('with the Academic division removed counts every row but the Tutor’s own Tutor rows', async () => {
      const { row, teacher, version, classId } = await steamRow();
      const accountId = (
        await database.migrator
          .selectFrom('staff')
          .select('account_id')
          .where('id', '=', teacher)
          .executeTakeFirstOrThrow()
      ).account_id;
      if (accountId === null) {
        throw new Error('The kit gives every person an account.');
      }
      await kit.tutorOf(north, classId, accountId);
      const tutorSubject = await kit.tutorSubject({ grades: [7] });
      await kit.row({
        branch_id: north,
        version_id: version,
        class_id: classId,
        subject_id: tutorSubject,
        teacher_id: teacher,
      });
      expect(await loads(north, { teacher, department: null })).toEqual([
        { row_id: row, version_id: version, branch_id: north, rows: 1 },
      ]);
    });
  });

  describe('a subject move', () => {
    it('counts a row whose teacher stays in the old department, and leaves one of the new', async () => {
      const { row, subject, version } = await steamRow();
      expect(await loads(north, { subject, department: national })).toEqual([
        { row_id: row, version_id: version, branch_id: north, rows: 1 },
      ]);
      expect(await loads(north, { subject, department: steam })).toEqual([]);
    });

    it('counts a row that names a vacancy of the old department (correction 1)', async () => {
      const subject = await kit.classes.subject({ grades: [7] });
      const classId = await kit.classes.schoolClass(north, northYear, { grade: 7 });
      const vacancy = await kit.vacancy(north, { subjects: [{ subject, grades: [7] }] });
      const version = await kit.version(north, northYear, { startsOn: STARTS_ON });
      const row = await kit.row({
        branch_id: north,
        version_id: version,
        class_id: classId,
        subject_id: subject,
        teacher_id: vacancy,
      });
      expect(await loads(north, { subject, department: national })).toEqual([
        { row_id: row, version_id: version, branch_id: north, rows: 1 },
      ]);
    });
  });

  describe('the Tutor exception (row 13, decision 7)', () => {
    /** A Tutor subject on a class row of a teacher, the class's Tutor or not. */
    async function tutorRow(input: {
      tutor: boolean;
      versionStart?: string;
      tutorFrom?: Date;
      tutorUntil?: Date | null;
    }): Promise<{ row: string; teacher: string; subject: string; version: string }> {
      const subject = await kit.tutorSubject({ grades: [7] });
      const classId = await kit.classes.schoolClass(north, northYear, { grade: 7 });
      const { staffId, accountId } = await kit.teacher(north, {
        subjects: input.tutor ? [] : [],
      });
      if (input.tutor) {
        await kit.tutorOf(north, classId, accountId, {
          ...(input.tutorFrom === undefined ? {} : { from: input.tutorFrom }),
          ...(input.tutorUntil === undefined ? {} : { until: input.tutorUntil }),
        });
      } else {
        // The profile row a teacher who is not the Tutor needs (0055); the
        // record moves to the Tutors department with it.
        await database.migrator
          .updateTable('staff_divisions')
          .set({ department_id: tutorsDepartment })
          .where('staff_id', '=', staffId)
          .execute();
        await kit.profile(staffId, [{ subject, grades: [7] }]);
      }
      const version = await kit.version(north, northYear, {
        startsOn: input.versionStart ?? STARTS_ON,
      });
      // Task 3.6c-2: only the class's Tutor may be written on a Tutor row; a
      // row of another teacher is one 3.4a let be written.
      const row = await (input.tutor ? kit.row.bind(kit) : kit.rowAsBefore.bind(kit))({
        branch_id: north,
        version_id: version,
        class_id: classId,
        subject_id: subject,
        teacher_id: staffId,
      });
      return { row, teacher: staffId, subject, version };
    }

    it('leaves the class Tutor’s row of a Tutor subject on a teacher move', async () => {
      const { teacher } = await tutorRow({ tutor: true });
      expect(await loads(north, { teacher, department: national })).toEqual([]);
    });

    it('counts the same row of a teacher who is not the class Tutor', async () => {
      const { row, teacher, version } = await tutorRow({ tutor: false });
      expect(await loads(north, { teacher, department: national })).toEqual([
        { row_id: row, version_id: version, branch_id: north, rows: 1 },
      ]);
    });

    it('counts the class Tutor’s row when the subject leaves the Tutors department', async () => {
      const { row, subject, version } = await tutorRow({ tutor: true });
      expect(await loads(north, { subject, department: national })).toEqual([
        { row_id: row, version_id: version, branch_id: north, rows: 1 },
      ]);
      // A move of the subject within the rule keeps the exception.
      expect(await loads(north, { subject, department: tutorsDepartment })).toEqual([]);
    });

    it('reads the Tutor on today in a draft whose start date has passed', async () => {
      // The Tutor row ended yesterday; the draft started on 12 October and the
      // move is dated 13 October, so only today leaves the Tutor out.
      const { row, teacher, version } = await tutorRow({
        tutor: true,
        versionStart: '2026-10-12',
        tutorUntil: new Date('2026-10-14T00:00:00+05:00'),
      });
      expect(await loads(north, { teacher, department: national, startsOn: '2026-10-13' })).toEqual(
        [{ row_id: row, version_id: version, branch_id: north, rows: 1 }],
      );
    });

    it('reads the Tutor on the start date of the move when it is later', async () => {
      // The Tutor row ends before the move's start date.
      const { row, teacher, version } = await tutorRow({
        tutor: true,
        tutorUntil: new Date('2026-11-01T00:00:00+05:00'),
      });
      expect(await loads(north, { teacher, department: national, startsOn: '2026-10-20' })).toEqual(
        [],
      );
      expect(await loads(north, { teacher, department: national, startsOn: '2026-11-02' })).toEqual(
        [{ row_id: row, version_id: version, branch_id: north, rows: 1 }],
      );
    });

    it('counts a Tutor subject on a group row of the class Tutor', async () => {
      const subject = await kit.tutorSubject({ grades: [7] });
      await database.migrator
        .updateTable('subjects')
        .set({ group_subject: true })
        .where('id', '=', subject)
        .execute();
      const classId = await kit.classes.schoolClass(north, northYear, { grade: 7 });
      const group = await kit.classes.group(north, northYear, subject, [classId]);
      const { staffId, accountId } = await kit.teacher(north);
      await kit.tutorOf(north, classId, accountId);
      await database.migrator
        .updateTable('staff_divisions')
        .set({ department_id: tutorsDepartment })
        .where('staff_id', '=', staffId)
        .execute();
      await kit.profile(staffId, [{ subject, grades: [7] }]);
      const version = await kit.version(north, northYear, { startsOn: STARTS_ON });
      const row = await kit.row({
        branch_id: north,
        version_id: version,
        group_id: group,
        subject_id: subject,
        teacher_id: staffId,
      });
      expect(await loads(north, { teacher: staffId, department: national })).toEqual([
        { row_id: row, version_id: version, branch_id: north, rows: 1 },
      ]);
    });

    it('counts a Tutor subject on a class row of a vacancy, which is never a Tutor', async () => {
      const subject = await kit.tutorSubject({ grades: [7] });
      const classId = await kit.classes.schoolClass(north, northYear, { grade: 7 });
      const vacancy = await kit.vacancy(north);
      await database.migrator
        .updateTable('staff_divisions')
        .set({ department_id: tutorsDepartment })
        .where('staff_id', '=', vacancy)
        .execute();
      await kit.profile(vacancy, [{ subject, grades: [7] }]);
      const version = await kit.version(north, northYear, { startsOn: STARTS_ON });
      // Written as 3.4a let it be (task 3.6c-2: no longer).
      const row = await kit.rowAsBefore({
        branch_id: north,
        version_id: version,
        class_id: classId,
        subject_id: subject,
        teacher_id: vacancy,
      });
      // The vacancy's record leaves the Tutors department; the subject stays.
      await database.migrator.transaction().execute(async (transaction) => {
        await transaction.deleteFrom('staff_subjects').where('staff_id', '=', vacancy).execute();
        await transaction
          .updateTable('staff_divisions')
          .set({ department_id: steam })
          .where('staff_id', '=', vacancy)
          .execute();
      });
      expect(await loads(north, { subject, department: tutorsDepartment })).toEqual([
        { row_id: row, version_id: version, branch_id: north, rows: 1 },
      ]);
    });
  });

  describe('the versions that count (decisions 1 and 2)', () => {
    it('counts a draft and a published version, not an archived one', async () => {
      const draft = await steamRow();
      const published = await steamRow();
      await kit.setVersion(published.version, 'published');
      const archived = await steamRow();
      await kit.setVersion(archived.version, 'archived');
      expect(await loads(north, { teacher: draft.teacher, department: national })).toHaveLength(1);
      expect(await loads(north, { teacher: published.teacher, department: national })).toHaveLength(
        1,
      );
      expect(await loads(north, { teacher: archived.teacher, department: national })).toEqual([]);
    });

    it('leaves a version of a closed year', async () => {
      const own = await ownBranch();
      const { teacher } = await steamRow(own);
      await kit.classes.setYear(own.year, 'closed');
      expect(await loads(own.branch, { teacher, department: national })).toEqual([]);
    });

    it('leaves a version whose year ends before the start date, and counts it on the last day', async () => {
      const { row, teacher, version } = await steamRow();
      expect(await loads(north, { teacher, department: national, startsOn: '2027-06-01' })).toEqual(
        [],
      );
      expect(await loads(north, { teacher, department: national, startsOn: '2027-05-31' })).toEqual(
        [{ row_id: row, version_id: version, branch_id: north, rows: 1 }],
      );
    });
  });

  describe('the branches (decision 3)', () => {
    it('gives another branch’s rows as a count with no id', async () => {
      const subject = await kit.classes.subject({ grades: [7] });
      const southClass = await kit.classes.schoolClass(south, southYear, { grade: 7 });
      const northClass = await kit.classes.schoolClass(north, northYear, { grade: 7 });
      const { staffId } = await kit.teacher(north, {
        further: [south],
        subjects: [{ subject, grades: [7] }],
      });
      const southVersion = await kit.version(south, southYear, { startsOn: STARTS_ON });
      const northVersion = await kit.version(north, northYear, { startsOn: STARTS_ON });
      const southClassTwo = await kit.classes.schoolClass(south, southYear, { grade: 7 });
      for (const classId of [southClass, southClassTwo]) {
        await kit.row({
          branch_id: south,
          version_id: southVersion,
          class_id: classId,
          subject_id: subject,
          teacher_id: staffId,
        });
      }
      const northRow = await kit.row({
        branch_id: north,
        version_id: northVersion,
        class_id: northClass,
        subject_id: subject,
        teacher_id: staffId,
      });
      const lines = await loads(north, { teacher: staffId, department: national });
      expect(lines).toHaveLength(2);
      expect(lines).toContainEqual({
        row_id: northRow,
        version_id: northVersion,
        branch_id: north,
        rows: 1,
      });
      expect(lines).toContainEqual({ row_id: null, version_id: null, branch_id: south, rows: 2 });
    });

    it('refuses a branch outside the transaction and a teacher not linked to the branch', async () => {
      const { teacher } = await steamRow();
      expect(
        (await refusal(loads(north, { teacher, department: national, asBranch: south })))
          .constraint,
      ).toBe('department_move_branch');
      const southOnly = await kit.teacher(south);
      expect(
        (await refusal(loads(north, { teacher: southOnly.staffId, department: national })))
          .constraint,
      ).toBe('department_move_branch');
    });

    it('refuses both refs, neither ref, a subject move with no department and no start date', async () => {
      const { teacher, subject } = await steamRow();
      for (const input of [
        { teacher, subject, department: national },
        { department: national },
        { subject, department: null },
        { teacher, department: national, startsOn: null },
      ]) {
        expect((await refusal(loads(north, input))).constraint).toBe('department_move_input');
      }
    });

    it('refuses a transaction with no moment', async () => {
      const { teacher } = await steamRow();
      const refused = await refusal(
        database.migrator.transaction().execute(async (transaction) => {
          await sql`select set_config(${BRANCH_SETTING}, ${`{${north}}`}, true)`.execute(
            transaction,
          );
          await sql`select * from department_move_loads(${north}::uuid, ${teacher}::uuid, null, ${national}::uuid, ${STARTS_ON}::date)`.execute(
            transaction,
          );
        }),
      );
      expect(refused.constraint).toBe('department_move_needs_moment');
    });
  });

  describe('the grants', () => {
    it('runs for the application only', async () => {
      const found = await sql<{ grantee: string }>`
        select grantee::regrole::text as grantee
        from pg_proc p, aclexplode(p.proacl)
        where p.proname = 'department_move_loads' and privilege_type = 'EXECUTE'
        order by 1
      `.execute(database.migrator);
      expect(
        found.rows.map((row) => row.grantee).filter((name) => name !== 'sodiq_migrator'),
      ).toEqual(['sodiq_app']);
    });

    it('lets the application write the start date of the department', async () => {
      const { subject, teacher } = await steamRow();
      await inBranch(north, async (transaction) => {
        await transaction
          .updateTable('subjects')
          .set({ department_since: '2026-10-20' })
          .where('id', '=', subject)
          .execute();
        await transaction
          .updateTable('staff_divisions')
          .set({ department_since: '2026-10-20' })
          .where('staff_id', '=', teacher)
          .execute();
      });
      const refused = await refusal(
        inBranch(north, (transaction) =>
          transaction.updateTable('departments').set({ tutors: true }).execute(),
        ),
      );
      expect(refused.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it('adds the update of department_since to the columns the application writes, and nothing else', async () => {
      const found = await sql<{ table_name: string; columns: string }>`
        select table_name, string_agg(column_name, ',' order by column_name) as columns
        from information_schema.column_privileges
        where grantee = 'sodiq_app' and privilege_type = 'UPDATE'
          and table_name in ('subjects', 'staff_divisions')
        group by table_name
        order by table_name
      `.execute(database.migrator);
      expect(found.rows).toEqual([
        // Task 3.6b-3 (db/migrations/0065): the department before a planned move.
        {
          table_name: 'staff_divisions',
          columns:
            'department_before,department_before_since,department_id,department_since,is_main',
        },
        {
          table_name: 'subjects',
          columns:
            'archived_at,colour,demanding,department_before,department_before_since,department_id,department_since,grades,group_subject,journal_type,language_rule,name_en,name_ru,name_uz,rating_exam,rating_round,weights_round',
        },
      ]);
    });
  });
  // 0065 (task 3.6b-3, pull request #123, decision 8): the department in
  // force until a planned move's start date, stored beside it.
  describe('the department before a planned move (0065)', () => {
    const CHECK_VIOLATION = '23514';
    const FOREIGN_KEY_VIOLATION = '23503';

    it('refuses a department before without a start date, and a date before without a department, on both tables', async () => {
      const { subject, teacher } = await steamRow();
      for (const table of ['subjects', 'staff_divisions'] as const) {
        const update = (values: {
          department_since: string | null;
          department_before: string | null;
          department_before_since: string | null;
        }) =>
          table === 'subjects'
            ? database.migrator
                .updateTable('subjects')
                .set(values)
                .where('id', '=', subject)
                .execute()
            : database.migrator
                .updateTable('staff_divisions')
                .set(values)
                .where('staff_id', '=', teacher)
                .execute();
        const constraint = `${table}_department_before_check`;
        const alone = await refusal(
          update({
            department_since: null,
            department_before: national,
            department_before_since: null,
          }),
        );
        expect(alone).toMatchObject({ code: CHECK_VIOLATION, constraint });
        const dateAlone = await refusal(
          update({
            department_since: '2026-11-02',
            department_before: null,
            department_before_since: '2026-09-15',
          }),
        );
        expect(dateAlone).toMatchObject({ code: CHECK_VIOLATION, constraint });
        // Every value valid: a planned move with the department before it and its date.
        await update({
          department_since: '2026-11-02',
          department_before: national,
          department_before_since: '2026-09-15',
        });
        await update({
          department_since: null,
          department_before: null,
          department_before_since: null,
        });
      }
    });

    it('refuses a department before of another division for a person, and an unknown one for a subject', async () => {
      const { subject, teacher } = await steamRow();
      const medical = await departmentId('Medical');
      const person = await refusal(
        database.migrator
          .updateTable('staff_divisions')
          .set({ department_since: '2026-11-02', department_before: medical })
          .where('staff_id', '=', teacher)
          .execute(),
      );
      expect(person).toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
        constraint: 'staff_divisions_department_before_fkey',
      });
      const unknown = await refusal(
        database.migrator
          .updateTable('subjects')
          .set({
            department_since: '2026-11-02',
            department_before: '0199a000-0000-7000-8000-000000000099',
          })
          .where('id', '=', subject)
          .execute(),
      );
      expect(unknown).toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
        constraint: 'subjects_department_before_fkey',
      });
    });

    it('lets the application write the department before a move', async () => {
      const { subject, teacher } = await steamRow();
      await inBranch(north, async (transaction) => {
        await transaction
          .updateTable('subjects')
          .set({
            department_since: '2026-11-02',
            department_before: national,
            department_before_since: null,
          })
          .where('id', '=', subject)
          .execute();
        await transaction
          .updateTable('staff_divisions')
          .set({
            department_since: '2026-11-02',
            department_before: national,
            department_before_since: null,
          })
          .where('staff_id', '=', teacher)
          .execute();
      });
    });
  });
});
