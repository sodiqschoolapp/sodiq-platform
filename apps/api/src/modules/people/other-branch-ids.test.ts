import { studentDetailSchema, studentRelativesSchema, type StudentDetail } from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClassesKit } from '../../testing/classes-kit.js';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { expectNotFound, expectRefusedById, UNKNOWN_ID } from '../../testing/id-refusal-kit.js';

// All names are invented. `.claude/rules/api.md`, tasks 1.3 and 1.5: an id of
// another branch's record, or an unknown one, in the path or the body is
// answered 404, with every row of the tables the route writes, in both
// branches, and the audit log unchanged (task 10.3b). A shared record (a staff
// member, a relative) of another branch is one linked only to that branch. The
// requests are sent as the Super Admin, whom the guard lets in every branch, so
// the 404 comes from the route. The clock stands at 23:55 on Saturday
// 10 October 2026 in Tashkent.
describe('people routes with an id of another branch', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let northStaff: string;
  let southStaff: string;
  let southStudent: StudentDetail;
  let count = 0;

  /** A new student's body of grade 7 from 2 September, with the relatives given. */
  function body(relatives: Record<string, unknown>[]): Record<string, unknown> {
    count += 1;
    return {
      uid: String(2609300 + count),
      firstName: 'Shahzoda',
      lastName: `Yoqubova${String.fromCharCode(97 + (count % 26))}`,
      paternalName: null,
      sex: 'female',
      birthDate: `2013-06-${String((count % 28) + 1).padStart(2, '0')}`,
      grade: 7,
      startsOn: '2026-09-02',
      documentType: null,
      documentNumber: null,
      jshshir: null,
      phone: null,
      email: null,
      address: null,
      region: null,
      previousSchool: null,
      diagnosticScore: null,
      scholarship: { type: 'none', coverage: null, amount: null },
      consentSignedOn: null,
      contract: { number: `PB-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives,
    };
  }

  const relative = (fullName: string, mainContact: boolean) => ({
    kind: 'new',
    relative: { fullName, phone: null, workplace: '', email: '' },
    relationship: mainContact ? 'mother' : 'father',
    mainContact,
    portalAccess: true,
    receivesNotices: true,
  });

  async function student(branch: string, relatives: Record<string, unknown>[]) {
    const response = await t.postStudent(branch, body(relatives));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  async function relativesOf(branch: string, studentId: string) {
    const response = await t.get(`/api/people/students/${studentId}/relatives`, branch);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return studentRelativesSchema.parse(response.body).relatives;
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
    await classes.year(t.north);
    await classes.year(t.south);
    northStaff = (await classes.person(t.north, ['uz'])).staffId;
    southStaff = (await classes.person(t.south, ['uz'])).staffId;
    southStudent = await student(t.south, [relative('Gulnora Hasanova', true)]);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('POST /api/people/staff/check', () => {
    const check = (staffRecordId: string) =>
      t.post('/api/people/staff/check', t.north, {
        firstName: 'Sardor',
        lastName: 'Ibragimov',
        birthDate: '1988-02-03',
        phone: '+998901112233',
        staffRecordId,
      });

    it('answers 404 to the check of an edit of a staff member of another branch only or an unknown one', async () => {
      expect((await check(northStaff)).status).toBe(200);
      for (const id of [southStaff, UNKNOWN_ID]) {
        expectNotFound(await check(id));
      }
    });
  });

  describe('GET /api/people/students/:id/history', () => {
    it('answers 404 to the History of a student of another branch or an unknown one', async () => {
      for (const id of [southStudent.id, UNKNOWN_ID]) {
        expectNotFound(await t.get(`/api/people/students/${id}/history`, t.north));
      }
    });
  });

  describe('POST /api/people/students/:id/relatives/:relativeId/unlink', () => {
    it('answers 404 to a new main contact of another branch only or an unknown one, changing nothing', async () => {
      const northStudent = await student(t.north, [
        relative('Malohat Rashidova', true),
        relative('Botir Rashidov', false),
      ]);
      const main = (await relativesOf(t.north, northStudent.id)).find((one) => one.mainContact);
      const southRelative = (await relativesOf(t.south, southStudent.id))[0]?.relativeId ?? '';
      expect(southRelative).not.toBe('');
      await expectRefusedById({
        database: t.database.migrator,
        tables: ['student_relatives', 'relatives', 'relative_accounts', 'students'],
        ids: [southRelative, UNKNOWN_ID],
        send: (id) =>
          t.post(
            `/api/people/students/${northStudent.id}/relatives/${main?.relativeId ?? ''}/unlink`,
            t.north,
            { newMainContactId: id },
          ),
      });
    });
  });
});
