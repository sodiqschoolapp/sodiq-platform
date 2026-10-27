import { studentDetailSchema, type StudentDetail } from '@sodiq/shared';
import { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClassesKit } from '../../testing/classes-kit.js';
import {
  dayTemplatesKit,
  TOMORROW,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { relativesInput } from '../../testing/relatives-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const ok = (response: Response): StudentDetail => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return studentDetailSchema.parse(response.body);
};

// All names are invented. Task 10.3a: the limits inside the people routes
// that the role harness cannot see (docs/spec/02-roles-and-access.md, Rules:
// "Every role is limited to a branch, and where it applies to subjects, a
// class or own lessons. ... The limit is enforced on the server"). Each test
// gives the role an assignment that the guard lets in, and a case inside the
// limit that the route answers, so that it fails if the route's own check
// goes. The clock stands at 23:55 on Saturday 10 October 2026 in Tashkent.
describe('the limits inside the people routes', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let year: string;
  let ownSubject: string;
  let otherSubject: string;
  let headTeacher: string;
  let seniorHeadTeacher: string;
  let count = 0;

  const post = (path: string, body: object = {}, cookie = t.vicePrincipal) =>
    t.post(path, t.north, body, cookie);

  async function pupil(classId: string): Promise<StudentDetail> {
    count += 1;
    const response = await post('/api/people/students', {
      uid: String(2607800 + count),
      firstName: 'Mohira',
      lastName: `Sobirova${'e'.repeat(count % 9)}${String.fromCharCode(97 + (count % 26))}`,
      paternalName: null,
      sex: 'female',
      birthDate: `2013-07-${String((count % 28) + 1).padStart(2, '0')}`,
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
      contract: { number: `SR-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives: relativesInput(),
      classId,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  const schoolClass = () => classes.schoolClass(t.north, year, { grade: 7 });

  const group = (subjectId: string, classIds: readonly string[]) =>
    classes.group(t.north, year, subjectId, classIds, { size: 20 });

  const placeInGroup = async (groupId: string, studentId: string) => {
    const response = await post(`/api/groups/${groupId}/members`, {
      students: [{ id: studentId }],
      from: TOMORROW,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
  };

  const memberOf = async (studentId: string, groupId: string) =>
    (
      await t.database.migrator
        .selectFrom('group_memberships')
        .select('id')
        .where('student_id', '=', studentId)
        .where('group_id', '=', groupId)
        .orderBy('valid_from')
        .executeTakeFirstOrThrow()
    ).id;

  const lastMoveId = async (studentId: string) =>
    (
      await t.database.migrator
        .selectFrom('student_moves')
        .select('id')
        .where('student_id', '=', studentId)
        .orderBy('id', 'desc')
        .executeTakeFirstOrThrow()
    ).id;

  /** Every row a group move writes, as `group-transfers.test.ts` reads them, and the audit log. */
  const rowsOf = () =>
    Promise.all([
      t.database.migrator.selectFrom('student_moves').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('group_memberships').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('journal_cells').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('journal_voids').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('journal_optional_cells').selectAll().orderBy('id').execute(),
      t.auditCount(),
    ]);

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
    year = await classes.year(t.north);
    ownSubject = await classes.subject({ grades: [7] });
    otherSubject = await classes.subject({ grades: [7] });
    const head = await t.kit.completeSession('Jahongir', 'Rustamov');
    await t.kit.giveRole(head.account.id, {
      role: 'head_teacher',
      branchId: t.north,
      subjectIds: [ownSubject],
    });
    headTeacher = head.cookie;
    const senior = await t.kit.completeSession('Shoxida', 'Azimova');
    // A Senior Head Teacher works in every branch: no branch on the assignment.
    await t.kit.giveRole(senior.account.id, {
      role: 'senior_head_teacher',
      subjectIds: [ownSubject],
    });
    seniorHeadTeacher = senior.cookie;
  });

  afterAll(async () => {
    await t.close();
  });

  // `02`, Head Teacher: "Moves students between groups of those subjects";
  // Senior Head Teacher: "Everything a Head Teacher can do, for the subjects
  // given to them" (task 3.3a, decision 2).
  describe('a group transfer of another subject', () => {
    it('is refused to a Head Teacher and a Senior Head Teacher of another subject, writing nothing', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const [x, y] = [await group(otherSubject, [oxford]), await group(otherSubject, [oxford])];
      await placeInGroup(x, one.id);
      const member = await memberOf(one.id, x);
      const before = await rowsOf();
      for (const cookie of [headTeacher, seniorHeadTeacher]) {
        refusedWith(
          await post(
            '/api/groups/transfers',
            { studentId: one.id, memberId: member, toGroupId: y, from: '2026-10-19' },
            cookie,
          ),
          403,
          'permission_denied',
        );
      }
      expect(await rowsOf()).toEqual(before);
      // Inside the limit: the same move in the own subject is made.
      const [a, b] = [await group(ownSubject, [oxford]), await group(ownSubject, [oxford])];
      await placeInGroup(a, one.id);
      ok(
        await post(
          '/api/groups/transfers',
          {
            studentId: one.id,
            memberId: await memberOf(one.id, a),
            toGroupId: b,
            from: '2026-10-19',
          },
          seniorHeadTeacher,
        ),
      );
    });

    it('is refused to a Senior Head Teacher of another subject on change, cancel and undo, writing nothing', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const [x, y, z] = [
        await group(otherSubject, [oxford]),
        await group(otherSubject, [oxford]),
        await group(otherSubject, [oxford]),
      ];
      await placeInGroup(x, one.id);
      ok(
        await post('/api/groups/transfers', {
          studentId: one.id,
          memberId: await memberOf(one.id, x),
          toGroupId: y,
          from: '2026-10-19',
        }),
      );
      const foreign = await lastMoveId(one.id);
      const before = await rowsOf();
      for (const [path, body] of [
        ['change', { toGroupId: z, from: '2026-10-26' }],
        ['cancel', {}],
        ['undo', { reason: 'Wrong group.' }],
      ] as const) {
        refusedWith(
          await post(`/api/groups/transfers/${foreign}/${path}`, body, seniorHeadTeacher),
          403,
          'permission_denied',
        );
      }
      expect(await rowsOf()).toEqual(before);
      // Inside the limit: a move of the own subject is cancelled.
      const [a, b] = [await group(ownSubject, [oxford]), await group(ownSubject, [oxford])];
      await placeInGroup(a, one.id);
      ok(
        await post(
          '/api/groups/transfers',
          {
            studentId: one.id,
            memberId: await memberOf(one.id, a),
            toGroupId: b,
            from: '2026-10-19',
          },
          seniorHeadTeacher,
        ),
      );
      ok(
        await post(
          `/api/groups/transfers/${await lastMoveId(one.id)}/cancel`,
          {},
          seniorHeadTeacher,
        ),
      );
    });
  });

  // edge/people-roles-accounts, Personal data: "Identity (...): Super Admin,
  // Academic Vice Principal and Head Tutor; the Principal sees them hidden,
  // with a logged 'show'". A Senior Head Teacher reads the record and is
  // neither.
  it('refuses the identity show to a Senior Head Teacher who reads the record, writing nothing', async () => {
    const one = await pupil(await schoolClass());
    ok(await t.get(`/api/people/students/${one.id}`, t.north, seniorHeadTeacher));
    const before = await t.auditCount();
    refusedWith(
      await post(`/api/people/students/${one.id}/identity`, {}, seniorHeadTeacher),
      403,
      'permission_denied',
    );
    expect(await t.auditCount()).toBe(before);
  });
});
