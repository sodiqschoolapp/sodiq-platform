import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const EXCLUSION_VIOLATION = '23P01';

/** Wednesday 14 October 2026, 10:00 in Tashkent. */
const NOW = '2026-10-14T10:00:00+05:00';
const NOVEMBER = new Date('2026-11-01T00:00:00+05:00');
const DECEMBER = new Date('2026-12-01T00:00:00+05:00');

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

// Task 9.4e (db/migrations/0152; the owner's spec change of 1 November 2026):
// a class of grades 0–4 takes a Class teacher and one of grades 5–11 a Tutor,
// for main and acting rows (`edge/people-roles-accounts`: "Refused, not a
// warning"; decision 3); a Class teacher has one own class at a time, across
// branches, apart from acting (`02`, Class teacher; decision 4); a role end
// ends her rows (`edge/students-classes-groups`); a grade edit across 4 ↔ 5 is
// refused while a row of the other role is in force or planned (decision 5);
// the Tutor lessons name her (`edge/00-definitions`, Tutor of a class).
describe('the Class teacher of a class of grades 0–4 in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let clock: FixedClock;
  let kit: ClassesKit;
  let north: string;
  let south: string;
  let northYear: string;
  let southYear: string;
  let editor: string;

  const inBranch = <T>(branch: string | string[], work: (transaction: Transaction) => Promise<T>) =>
    transactions.run(Array.isArray(branch) ? branch : [branch], work);

  /** A row of the class's Tutor or Class teacher, inserted as the application inserts it. */
  const give = (
    branch: string,
    classId: string,
    assignmentId: string,
    input: { kind?: 'tutor' | 'acting'; from?: Date; until?: Date | null } = {},
  ) =>
    inBranch(branch, (transaction) =>
      transaction
        .insertInto('class_tutors')
        .values({
          branch_id: branch,
          class_id: classId,
          assignment_id: assignmentId,
          kind: input.kind ?? 'tutor',
          valid_from: input.from ?? clock.now(),
          own_until: input.until ?? null,
          given_by: editor,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );

  /** A person of the branch with a role there. */
  async function holder(
    branch: string,
    role: 'tutor' | 'class_teacher',
    accountId?: string,
  ): Promise<{ staffId: string; accountId: string; assignmentId: string }> {
    const person =
      accountId === undefined ? await kit.person(branch, ['uz']) : { staffId: '', accountId };
    return { ...person, assignmentId: await kit.role(person.accountId, branch, role) };
  }

  const setGrade = (branch: string, classId: string, grade: number) =>
    inBranch(branch, (transaction) =>
      transaction.updateTable('classes').set({ grade }).where('id', '=', classId).execute(),
    );

  const endRole = (assignmentId: string, until: Date | null) =>
    inBranch([north, south], (transaction) =>
      transaction
        .updateTable('assignments')
        .set({ valid_until: until })
        .where('id', '=', assignmentId)
        .execute(),
    );

  beforeAll(async () => {
    database = await createTestDatabase();
    clock = new FixedClock(NOW);
    transactions = new Transactions(database.app, clock);
    kit = new ClassesKit(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    northYear = await kit.year(north);
    southYear = await kit.year(south);
    editor = await kit.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('the role of the grade', () => {
    it('gives a class of grade 1 a Class teacher, and of grade 0 too', async () => {
      const first = await kit.schoolClass(north, northYear, { grade: 1, name: 'London' });
      const zero = await kit.schoolClass(north, northYear, { grade: 0, name: 'London' });
      const malika = await holder(north, 'class_teacher');
      const other = await holder(north, 'class_teacher');
      await give(north, first, malika.assignmentId);
      await give(north, zero, other.assignmentId);
      const rows = await database.migrator
        .selectFrom('class_tutors')
        .select(['class_id', 'own_class_account'])
        .where('class_id', 'in', [first, zero])
        .orderBy('class_id')
        .execute();
      expect(rows.map((row) => row.own_class_account).sort()).toEqual(
        [malika.accountId, other.accountId].sort(),
      );
    });

    it('refuses a Tutor for a class of grades 0–4, as main and as acting', async () => {
      const second = await kit.schoolClass(north, northYear, { grade: 2, name: 'London' });
      const tutor = await holder(north, 'tutor');
      for (const kind of ['tutor', 'acting'] as const) {
        expect(await refusal(give(north, second, tutor.assignmentId, { kind }))).toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'class_tutors_needs_class_teacher',
        });
      }
    });

    it('refuses a Class teacher for a class of grades 5–11, as main and as acting', async () => {
      const sixth = await kit.schoolClass(north, northYear, { grade: 6, name: 'Oxford' });
      const fifth = await kit.schoolClass(north, northYear, { grade: 5, name: 'Oxford' });
      const classTeacher = await holder(north, 'class_teacher');
      for (const [classId, kind] of [
        [sixth, 'tutor'],
        [sixth, 'acting'],
        [fifth, 'tutor'],
      ] as const) {
        expect(
          await refusal(give(north, classId, classTeacher.assignmentId, { kind })),
        ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'class_tutors_needs_tutor' });
      }
    });

    it('gives a class of grade 4 a Class teacher and one of grade 5 a Tutor', async () => {
      const fourth = await kit.schoolClass(north, northYear, { grade: 4, name: 'Brown' });
      const fifth = await kit.schoolClass(north, northYear, { grade: 5, name: 'Brown' });
      await give(north, fourth, (await holder(north, 'class_teacher')).assignmentId);
      await give(north, fifth, (await holder(north, 'tutor')).assignmentId);
    });

    it('still refuses another role, such as a Teacher', async () => {
      const third = await kit.schoolClass(north, northYear, { grade: 3, name: 'Yale' });
      const person = await kit.person(north, ['uz']);
      const teacher = await kit.role(person.accountId, north, 'teacher');
      expect(await refusal(give(north, third, teacher))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'class_tutors_not_tutor',
      });
    });
  });

  describe('one own class at a time', () => {
    it('refuses a second own class at the same time, and gives it after the first ends', async () => {
      const first = await kit.schoolClass(north, northYear, { grade: 1, name: 'Harvard' });
      const second = await kit.schoolClass(north, northYear, { grade: 2, name: 'Harvard' });
      const malika = await holder(north, 'class_teacher');
      await give(north, first, malika.assignmentId, { until: DECEMBER });
      expect(await refusal(give(north, second, malika.assignmentId))).toMatchObject({
        code: EXCLUSION_VIOLATION,
        constraint: 'class_tutors_one_class',
      });
      expect(
        await refusal(give(north, second, malika.assignmentId, { from: NOVEMBER })),
      ).toMatchObject({ code: EXCLUSION_VIOLATION, constraint: 'class_tutors_one_class' });
      await give(north, second, malika.assignmentId, { from: DECEMBER });
    });

    it('lets her act for another class beside her own', async () => {
      const own = await kit.schoolClass(north, northYear, { grade: 1, name: 'Cornell' });
      const other = await kit.schoolClass(north, northYear, { grade: 2, name: 'Cornell' });
      const malika = await holder(north, 'class_teacher');
      await give(north, own, malika.assignmentId);
      await give(north, other, malika.assignmentId, { kind: 'acting', until: DECEMBER });
      const acting = await database.migrator
        .selectFrom('class_tutors')
        .select('own_class_account')
        .where('class_id', '=', other)
        .executeTakeFirstOrThrow();
      expect(acting.own_class_account).toBeNull();
    });

    it('refuses a second own class in another branch through her role there', async () => {
      const northClass = await kit.schoolClass(north, northYear, { grade: 1, name: 'Princeton' });
      const southClass = await kit.schoolClass(south, southYear, { grade: 1, name: 'Princeton' });
      // One person linked to both branches, with a Class teacher role in each.
      const person = await kit.person(north, ['uz'], { further: [south] });
      const here = await kit.role(person.accountId, north, 'class_teacher');
      const there = await kit.role(person.accountId, south, 'class_teacher');
      await give(north, northClass, here);
      expect(await refusal(give(south, southClass, there))).toMatchObject({
        code: EXCLUSION_VIOLATION,
        constraint: 'class_tutors_one_class',
      });
    });

    it('lets a Tutor keep two classes at once', async () => {
      const seventh = await kit.schoolClass(north, northYear, { grade: 7, name: 'Duke' });
      const eighth = await kit.schoolClass(north, northYear, { grade: 8, name: 'Duke' });
      const tutor = await holder(north, 'tutor');
      await give(north, seventh, tutor.assignmentId);
      await give(north, eighth, tutor.assignmentId);
    });
  });

  it('ends her rows with the end of her role', async () => {
    const own = await kit.schoolClass(north, northYear, { grade: 1, name: 'Stanford' });
    const malika = await holder(north, 'class_teacher');
    const row = await give(north, own, malika.assignmentId);
    await endRole(malika.assignmentId, DECEMBER);
    expect(await kit.tutorRowOf(row)).toMatchObject({ valid_until: DECEMBER, end_cause: 'role' });
    await endRole(malika.assignmentId, null);
    expect(await kit.tutorRowOf(row)).toMatchObject({ valid_until: null, end_cause: null });
  });

  describe('a grade edit across 4 and 5', () => {
    it('is refused while her row is in force', async () => {
      const fourth = await kit.schoolClass(north, northYear, { grade: 4, name: 'Columbia' });
      await give(north, fourth, (await holder(north, 'class_teacher')).assignmentId);
      expect(await refusal(setGrade(north, fourth, 5))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'classes_grade_tutor_role',
      });
    });

    it('is refused while her row is planned', async () => {
      const fourth = await kit.schoolClass(north, northYear, { grade: 4, name: 'Rice' });
      await give(north, fourth, (await holder(north, 'class_teacher')).assignmentId, {
        from: DECEMBER,
      });
      expect(await refusal(setGrade(north, fourth, 5))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'classes_grade_tutor_role',
      });
    });

    it('is refused from 5 to 4 while a Tutor row is in force', async () => {
      const fifth = await kit.schoolClass(north, northYear, { grade: 5, name: 'Emory' });
      await give(north, fifth, (await holder(north, 'tutor')).assignmentId);
      expect(await refusal(setGrade(north, fifth, 4))).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'classes_grade_tutor_role',
      });
    });

    it('passes from 3 to 4 with her row in force, and from 6 to 7 with a Tutor', async () => {
      const third = await kit.schoolClass(north, northYear, { grade: 3, name: 'Tufts' });
      const sixth = await kit.schoolClass(north, northYear, { grade: 6, name: 'Tufts' });
      await give(north, third, (await holder(north, 'class_teacher')).assignmentId);
      await give(north, sixth, (await holder(north, 'tutor')).assignmentId);
      await setGrade(north, third, 4);
      await setGrade(north, sixth, 7);
    });

    it('passes once her row has ended, or was withdrawn', async () => {
      const fourth = await kit.schoolClass(north, northYear, { grade: 4, name: 'Vassar' });
      const malika = await holder(north, 'class_teacher');
      const row = await give(north, fourth, malika.assignmentId, { from: DECEMBER });
      await inBranch(north, (transaction) =>
        transaction
          .updateTable('class_tutors')
          .set({ valid_until: DECEMBER, own_until: null, end_cause: 'ended', ended_by: editor })
          .where('id', '=', row)
          .execute(),
      );
      await setGrade(north, fourth, 5);
    });
  });

  it('names her as the Tutor of her class for its Tutor lessons', async () => {
    const own = await kit.schoolClass(north, northYear, { grade: 1, name: 'Brandeis' });
    const malika = await holder(north, 'class_teacher');
    await give(north, own, malika.assignmentId);
    const found = await sql<{ teacher: string | null }>`
      select class_tutor_on(${own}::uuid, '2026-10-20'::date) as teacher
    `.execute(database.migrator);
    expect(found.rows[0]?.teacher).toBe(malika.staffId);
  });

  it('keeps the 16 roles in the checks of assignments and feedback reports', async () => {
    const definitions = await sql<{ conname: string; definition: string }>`
      select conname, pg_get_constraintdef(oid) as definition from pg_constraint
      where conname in ('assignments_role_check', 'feedback_reports_roles_check')
    `.execute(database.migrator);
    expect(definitions.rows).toHaveLength(2);
    for (const row of definitions.rows) {
      expect(row.definition, row.conname).toContain("'class_teacher'");
    }
  });
});
