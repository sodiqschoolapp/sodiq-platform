import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemClock } from '../../clock/system-clock.js';
import { Transactions } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { teachingRolesOf, teachingRolesTogether } from './notice-roles.js';

// Task 10.11 (pull request #371, decisions 2 and 13): a notice about a lesson, a journal or a
// plan names the post its holder holds it by: a subject of a Tutors department (on any unit,
// as `namesTutorWork`) as the Tutor, or the Class teacher in a class of grades 0–4
// (`edge/00-definitions`, "Tutor of a class"); every other subject as the Teacher.
describe('the role by which a lesson is held', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let branch: string;
  let maths: string;
  let tutorSubject: string;
  let grade3: string;
  let grade7: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new SystemClock());
    branch = await insertBranch(database.migrator, 'North');
    const kit = new ClassesKit(database.migrator);
    const year = await kit.year(branch);
    grade3 = await kit.schoolClass(branch, year, { grade: 3 });
    grade7 = await kit.schoolClass(branch, year, { grade: 7 });
    maths = await kit.subject({ grades: [3, 7] });
    tutorSubject = await kit.subject({ grades: [3, 7], journalType: 'attendance_only' });
    const tutors = await database.migrator
      .selectFrom('departments')
      .select('id')
      .where('tutors', '=', true)
      .executeTakeFirstOrThrow();
    await database.migrator
      .updateTable('subjects')
      .set({ department_id: tutors.id })
      .where('id', '=', tutorSubject)
      .execute();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('as the Teacher, the Tutor, the Class teacher of grades 0–4, and the Tutor on a group', async () => {
    const roles = await transactions.run([branch], (transaction) =>
      teachingRolesOf(transaction, [
        { subjectId: maths, classId: grade7 },
        { subjectId: maths, classId: grade3 },
        { subjectId: maths, classId: null },
        { subjectId: tutorSubject, classId: grade7 },
        { subjectId: tutorSubject, classId: grade3 },
        { subjectId: tutorSubject, classId: null },
      ]),
    );
    expect(roles).toEqual(['teacher', 'teacher', 'teacher', 'tutor', 'class_teacher', 'tutor']);
  });

  it('as the Tutor or the Class teacher by the stored post of the class row, a holder without that row (a substitute) as the Teacher', async () => {
    const kit = new ClassesKit(database.migrator);
    const tutor = await kit.person(branch, ['uz']);
    const classTeacher = await kit.person(branch, ['uz']);
    const substitute = await kit.person(branch, ['uz']);
    await kit.tutorRow(branch, grade7, await kit.role(tutor.accountId, branch, 'tutor'));
    await kit.tutorRow(
      branch,
      grade3,
      await kit.role(classTeacher.accountId, branch, 'class_teacher'),
    );
    const roles = await transactions.run([branch], (transaction) =>
      teachingRolesOf(transaction, [
        { subjectId: tutorSubject, classId: grade7, holderStaffId: tutor.staffId },
        { subjectId: tutorSubject, classId: grade3, holderStaffId: classTeacher.staffId },
        { subjectId: tutorSubject, classId: grade7, holderStaffId: substitute.staffId },
        { subjectId: tutorSubject, classId: grade3, holderStaffId: tutor.staffId },
        { subjectId: maths, classId: grade7, holderStaffId: tutor.staffId },
      ]),
    );
    expect(roles).toEqual(['tutor', 'class_teacher', 'teacher', 'teacher', 'teacher']);
  });

  it('joined once for a notice of several lessons, the Teacher when it names none', async () => {
    await transactions.run([branch], async (transaction) => {
      expect(
        await teachingRolesTogether(transaction, [
          { subjectId: tutorSubject, classId: grade7 },
          { subjectId: maths, classId: grade7 },
          { subjectId: maths, classId: grade3 },
        ]),
      ).toEqual(['teacher', 'tutor']);
      expect(await teachingRolesTogether(transaction, [])).toEqual(['teacher']);
    });
  });
});
