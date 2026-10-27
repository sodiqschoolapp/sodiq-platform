import {
  groupMembersSchema,
  groupPlacementBoardSchema,
  automaticPlacementResultSchema,
  studentDetailSchema,
  type StudentDetail,
} from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClassesKit } from '../../testing/classes-kit.js';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import {
  expectNotFound,
  expectRefusedById,
  rowsOfTables,
  UNKNOWN_ID,
} from '../../testing/id-refusal-kit.js';
import { relativesInput } from '../../testing/relatives-kit.js';

// All names are invented. `.claude/rules/api.md`, tasks 1.3 and 1.5: an id of
// another branch's record, or an unknown one, in the path, the query or the
// body is answered 404, with every row of the tables the route writes, in both
// branches, and the audit log unchanged (task 10.3b). The requests are sent as
// the Super Admin, whom the guard lets in every branch, so the 404 comes from
// the route. The clock stands at 23:55 on Saturday 10 October 2026 in Tashkent.
describe('class and group routes with an id of another branch', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let year: string;
  let southYear: string;
  let maths: string;
  let northClass: string;
  let southClass: string;
  let northAssignment: string;
  let southAssignment: string;
  let northTutorRow: string;
  let southTutorRow: string;
  let northGroup: string;
  let southGroup: string;
  let northMember: string;
  let southMember: string;
  let southPupil: StudentDetail;
  let count = 0;

  /** The tables a Tutor change writes, its follow and its notices included (task 3.6c-2, 5.5c-3b). */
  const TUTOR_TABLES = [
    'classes',
    'class_tutors',
    'lessons',
    'time_claims',
    'teaching_load_rows',
    'pattern_entries',
    'notifications',
  ];
  /** The tables the group membership routes write. */
  const MEMBER_TABLES = ['group_memberships', 'groups', 'class_memberships'];

  /** A new student's body: grade 7, from 2 September, in the class named. */
  function body(classId: string): Record<string, unknown> {
    count += 1;
    return {
      uid: String(2609100 + count),
      firstName: 'Malika',
      lastName: `Sobirova${String.fromCharCode(97 + (count % 26))}`,
      paternalName: null,
      sex: 'female',
      birthDate: `2013-05-${String((count % 28) + 1).padStart(2, '0')}`,
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
      contract: { number: `OB-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives: relativesInput(),
      classId,
    };
  }

  async function pupil(branch: string, classId: string): Promise<StudentDetail> {
    const response = await t.post('/api/people/students', branch, body(classId));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  /** The id of the first member row of a group answered by a placement. */
  async function placeInGroup(branch: string, groupId: string, studentId: string) {
    const response = await t.post(`/api/groups/${groupId}/members`, branch, {
      students: [{ id: studentId }],
      from: '2026-10-12',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return groupMembersSchema.parse(response.body).members[0]?.id ?? '';
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
    year = await classes.year(t.north);
    southYear = await classes.year(t.south);
    maths = await classes.subject({ grades: [7, 8] });
    northClass = await classes.schoolClass(t.north, year, { grade: 7 });
    southClass = await classes.schoolClass(t.south, southYear, { grade: 7 });
    const northPerson = await classes.person(t.north, ['uz']);
    northAssignment = await classes.role(northPerson.accountId, t.north);
    const southPerson = await classes.person(t.south, ['uz']);
    southAssignment = await classes.role(southPerson.accountId, t.south);
    northTutorRow = await classes.tutorRow(t.north, northClass, northAssignment, {
      from: new Date('2026-09-01T00:00:00+05:00'),
    });
    southTutorRow = await classes.tutorRow(t.south, southClass, southAssignment, {
      from: new Date('2026-09-01T00:00:00+05:00'),
    });
    const northPupil = await pupil(t.north, northClass);
    southPupil = await pupil(t.south, southClass);
    northGroup = await classes.group(t.north, year, maths, [northClass]);
    southGroup = await classes.group(t.south, southYear, maths, [southClass]);
    northMember = await placeInGroup(t.north, northGroup, northPupil.id);
    southMember = await placeInGroup(t.south, southGroup, southPupil.id);
    // A student of the South class left unplaced for the board and the run.
    await pupil(t.south, southClass);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('POST /api/classes/:id/tutors/preview', () => {
    const preview = (classId: string, assignmentId: string) =>
      t.post(`/api/classes/${classId}/tutors/preview`, t.north, {
        kind: 'tutor',
        from: '2026-10-11',
        until: null,
        assignmentId,
      });

    it('answers 404 to the preview of a Tutor for another branch’s or an unknown class, changing nothing', async () => {
      const own = await classes.schoolClass(t.north, year, { grade: 8 });
      expect((await preview(own, northAssignment)).status).toBe(200);
      await expectRefusedById({
        database: t.database.migrator,
        tables: TUTOR_TABLES,
        ids: [southClass, UNKNOWN_ID],
        send: (id) => preview(id, northAssignment),
      });
    });

    it('answers 404 to the preview of a Tutor for another branch’s or an unknown assignment, changing nothing', async () => {
      const own = await classes.schoolClass(t.north, year, { grade: 8 });
      await expectRefusedById({
        database: t.database.migrator,
        tables: TUTOR_TABLES,
        ids: [southAssignment, UNKNOWN_ID],
        send: (id) => preview(own, id),
      });
    });
  });

  describe('POST /api/classes/:id/tutors/:tutorId/end', () => {
    const end = (classId: string, tutorId: string) =>
      t.post(`/api/classes/${classId}/tutors/${tutorId}/end`, t.north, { from: '2026-10-11' });

    it('answers 404 to the end of a Tutor for another branch’s or an unknown class, changing nothing', async () => {
      await expectRefusedById({
        database: t.database.migrator,
        tables: TUTOR_TABLES,
        ids: [southClass, UNKNOWN_ID],
        send: (id) => end(id, northTutorRow),
      });
    });

    it('answers 404 to the end of another branch’s or an unknown Tutor row, changing nothing', async () => {
      await expectRefusedById({
        database: t.database.migrator,
        tables: TUTOR_TABLES,
        ids: [southTutorRow, UNKNOWN_ID],
        send: (id) => end(northClass, id),
      });
    });
  });

  describe('GET /api/groups/:id/members', () => {
    it('answers 404 to the Students tab of another branch’s or an unknown group', async () => {
      for (const id of [southGroup, UNKNOWN_ID]) {
        expectNotFound(await t.get(`/api/groups/${id}/members`, t.north));
      }
    });
  });

  describe('POST /api/groups/:id/members/:memberId/withdraw and reviewed', () => {
    it('answers 404 to withdraw for another branch’s or an unknown group, changing nothing', async () => {
      await expectRefusedById({
        database: t.database.migrator,
        tables: MEMBER_TABLES,
        ids: [southGroup, UNKNOWN_ID],
        send: (id) => t.post(`/api/groups/${id}/members/${northMember}/withdraw`, t.north),
      });
    });

    it('answers 404 to withdraw for another branch’s or an unknown member row, changing nothing', async () => {
      await expectRefusedById({
        database: t.database.migrator,
        tables: MEMBER_TABLES,
        ids: [southMember, UNKNOWN_ID],
        send: (id) => t.post(`/api/groups/${northGroup}/members/${id}/withdraw`, t.north),
      });
    });

    it('answers 404 to reviewed for another branch’s or an unknown group, changing nothing', async () => {
      await expectRefusedById({
        database: t.database.migrator,
        tables: MEMBER_TABLES,
        ids: [southGroup, UNKNOWN_ID],
        send: (id) => t.post(`/api/groups/${id}/members/${northMember}/reviewed`, t.north),
      });
    });

    it('answers 404 to reviewed for another branch’s or an unknown member row, changing nothing', async () => {
      await expectRefusedById({
        database: t.database.migrator,
        tables: MEMBER_TABLES,
        ids: [southMember, UNKNOWN_ID],
        send: (id) => t.post(`/api/groups/${northGroup}/members/${id}/reviewed`, t.north),
      });
    });
  });

  describe('GET /api/groups/placement', () => {
    it('answers 404 for an unknown subject, and none of another branch’s groups or students for a subject both branches have', async () => {
      expectNotFound(
        await t.get(
          `/api/groups/placement?subjectId=${UNKNOWN_ID}&grades=7&on=2026-10-12`,
          t.north,
        ),
      );
      const response = await t.get(
        `/api/groups/placement?subjectId=${maths}&grades=7&on=2026-10-12`,
        t.north,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const board = groupPlacementBoardSchema.parse(response.body);
      expect(board.groups.map((one) => one.id)).toEqual([northGroup]);
      const southern = await t.database.migrator
        .selectFrom('students')
        .select('id')
        .where('branch_id', '=', t.south)
        .execute();
      const answered = JSON.stringify(board);
      for (const one of [...southern.map((row) => row.id), southGroup, southClass]) {
        expect(answered).not.toContain(one);
      }
    });
  });

  describe('POST /api/groups/placement/automatic', () => {
    it('answers 404 for an unknown subject and places none of another branch’s students, changing nothing there', async () => {
      await expectRefusedById({
        database: t.database.migrator,
        tables: MEMBER_TABLES,
        ids: [UNKNOWN_ID],
        send: (id) =>
          t.post('/api/groups/placement/automatic', t.north, {
            subjectId: id,
            grades: [7],
            from: '2026-10-12',
          }),
      });
      const before = await rowsOfTables(t.database.migrator, MEMBER_TABLES);
      const response = await t.post('/api/groups/placement/automatic', t.north, {
        subjectId: maths,
        grades: [7],
        from: '2026-10-12',
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(automaticPlacementResultSchema.parse(response.body).placed).toEqual([]);
      expect(await rowsOfTables(t.database.migrator, MEMBER_TABLES)).toEqual(before);
      expect(southPupil.id).not.toBe('');
    });
  });

  describe('POST /api/groups/export', () => {
    it('answers 404 for another branch’s or an unknown group, logging nothing', async () => {
      await expectRefusedById({
        database: t.database.migrator,
        tables: [],
        ids: [southGroup, UNKNOWN_ID],
        send: (id) =>
          t.post('/api/groups/export', t.north, {
            ids: [northGroup, id],
            columns: ['name'],
            selection: 'ticked',
            search: '',
            filters: {},
          }),
      });
    });
  });
});
