import {
  automaticPlacementResultSchema,
  groupDetailSchema,
  groupPlacementBoardSchema,
  studentDetailSchema,
  type StudentDetail,
} from '@sodiq/shared';
import { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClassesKit } from '../../testing/classes-kit.js';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { relativesInput } from '../../testing/relatives-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

type Sex = 'male' | 'female';

// Groups for one sex through the routes (the owner's spec change of 17
// November 2026; db/migrations/0171). 05, Group: "A group may be for girls only
// or for boys only; it takes only students of that sex. [...] a subject whose
// groups in a class are all for one sex binds only the students of that sex
// (taekwondo for the boys only); the screen lists students not yet placed."
// edge/students-classes-groups, first row: "Bulk placement puts students into
// the smallest suitable group (for a group for one sex, only a student of that
// sex) and tags them \"placed automatically, review\"; a student placed in the
// only group open to them is not tagged." Each new refusal is reached through
// a route that maps it. All names are invented; the clock stands at 23:55 on
// Saturday 10 October 2026 in Tashkent.
describe('groups for one sex through the routes', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let year: string;
  let taekwondo: string;
  let gymnastics: string;
  let pe: string;
  let count = 0;

  const get = (path: string) => t.get(path, t.north, t.vicePrincipal);
  const post = (path: string, body: object = {}) => t.post(path, t.north, body, t.vicePrincipal);
  const put = (path: string, body: object) => t.put(path, t.north, body, t.vicePrincipal);

  /** The typed fields of a student (the edit's record). */
  function record(sex: Sex): Record<string, unknown> {
    count += 1;
    return {
      firstName: sex === 'male' ? 'Sardor' : 'Dilnoza',
      lastName: `${sex === 'male' ? 'Karimov' : 'Karimova'}${String.fromCharCode(97 + (count % 26))}${'c'.repeat(count % 7)}`,
      paternalName: null,
      sex,
      birthDate: `2013-04-${String((count % 28) + 1).padStart(2, '0')}`,
      grade: 7,
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
      contract: { number: `SG-2026/${String(count)}`, signedOn: '2026-08-20' },
    };
  }

  /** A student created by the route into the class from 2 September. */
  async function pupil(classId: string, sex: Sex): Promise<StudentDetail & { typed: object }> {
    const typed = record(sex);
    const response = await post('/api/people/students', {
      ...typed,
      uid: String(2607800 + count),
      startsOn: '2026-09-02',
      relatives: relativesInput(),
      classId,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return { ...studentDetailSchema.parse(response.body), typed };
  }

  const rowsOfStudent = (id: string) =>
    t.database.migrator
      .selectFrom('group_memberships')
      .select(['group_id', 'cause', 'review'])
      .where('student_id', '=', id)
      .where((eb) => eb('valid_from', '<', eb.ref('valid_until')))
      .orderBy('id')
      .execute();

  const groupOf = (classIds: string[], subject: string, sex: Sex | null) =>
    classes.group(t.north, year, subject, classIds, sex === null ? {} : { sex });

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
    year = await classes.year(t.north);
    taekwondo = await classes.subject({ grades: [7] });
    gymnastics = await classes.subject({ grades: [7] });
    pe = await classes.subject({ grades: [7] });
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the group', () => {
    it('is created for one sex, and answers it', async () => {
      const oxford = await classes.schoolClass(t.north, year);
      const response = await post('/api/groups', {
        academicYearId: year,
        subjectId: gymnastics,
        classIds: [oxford],
        name: 'Gym girls',
        language: null,
        maxSize: 20,
        sex: 'female',
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(groupDetailSchema.parse(response.body).sex).toBe('female');
      const row = await t.database.migrator
        .selectFrom('groups')
        .select('sex')
        .where('name', '=', 'Gym girls')
        .executeTakeFirstOrThrow();
      expect(row.sex).toBe('female');
    });

    it('refuses a sex that a member of the other sex has from today (group_sex_members)', async () => {
      const oxford = await classes.schoolClass(t.north, year);
      const girl = await pupil(oxford, 'female');
      const group = await groupOf([oxford], pe, null);
      const placed = await post(`/api/groups/${group}/members`, {
        students: [{ id: girl.id }],
        from: '2026-10-12',
      });
      expect(placed.status, JSON.stringify(placed.body)).toBe(201);
      const detail = groupDetailSchema.parse((await get(`/api/groups/${group}`)).body);
      const audit = await t.auditCount();
      refusedWith(
        await put(`/api/groups/${group}`, {
          classIds: [oxford],
          name: detail.name,
          language: null,
          maxSize: detail.maxSize,
          sex: 'male',
          version: detail.version,
        }),
        409,
        'group_sex_members',
      );
      expect(await t.auditCount()).toBe(audit);
      // Girls only is allowed.
      const edited = await put(`/api/groups/${group}`, {
        classIds: [oxford],
        name: detail.name,
        language: null,
        maxSize: detail.maxSize,
        sex: 'female',
        version: detail.version,
      });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(groupDetailSchema.parse(edited.body).sex).toBe('female');
    });
  });

  describe('a placement by hand', () => {
    it('refuses a girl in a group for the boys (group_member_sex)', async () => {
      const oxford = await classes.schoolClass(t.north, year);
      const girl = await pupil(oxford, 'female');
      const boys = await groupOf([oxford], taekwondo, 'male');
      refusedWith(
        await post(`/api/groups/${boys}/members`, {
          students: [{ id: girl.id }],
          from: '2026-10-12',
        }),
        409,
        'group_member_sex',
      );
      expect(await rowsOfStudent(girl.id)).toEqual([]);
    });

    it('refuses a group transfer of a boy into a group for the girls (group_member_sex)', async () => {
      const oxford = await classes.schoolClass(t.north, year);
      const boy = await pupil(oxford, 'male');
      const everyone = await groupOf([oxford], pe, null);
      const girls = await groupOf([oxford], pe, 'female');
      const placed = await post(`/api/groups/${everyone}/members`, {
        students: [{ id: boy.id }],
        from: '2026-10-12',
      });
      expect(placed.status, JSON.stringify(placed.body)).toBe(201);
      const member = await t.database.migrator
        .selectFrom('group_memberships')
        .select('id')
        .where('student_id', '=', boy.id)
        .executeTakeFirstOrThrow();
      refusedWith(
        await post('/api/groups/transfers', {
          studentId: boy.id,
          memberId: member.id,
          toGroupId: girls,
          from: '2026-10-19',
        }),
        409,
        'group_member_sex',
      );
    });
  });

  describe('a class join', () => {
    it('places a boy in the only boys’ group untagged, and asks no group of a girl', async () => {
      const oxford = await classes.schoolClass(t.north, year);
      const boys = await groupOf([oxford], taekwondo, 'male');
      const girl = await pupil(oxford, 'female');
      expect(await rowsOfStudent(girl.id)).toEqual([]);
      const boy = await pupil(oxford, 'male');
      expect(await rowsOfStudent(boy.id)).toEqual([
        { group_id: boys, cause: 'automatic', review: false },
      ]);
    });

    it('offers a girl only the girls’ group of a subject with both, untagged', async () => {
      const oxford = await classes.schoolClass(t.north, year);
      await groupOf([oxford], pe, 'male');
      const girls = await groupOf([oxford], pe, 'female');
      const girl = await pupil(oxford, 'female');
      expect(await rowsOfStudent(girl.id)).toEqual([
        { group_id: girls, cause: 'automatic', review: false },
      ]);
    });

    it('still tags a student placed in one of two groups open to them', async () => {
      const oxford = await classes.schoolClass(t.north, year);
      await groupOf([oxford], pe, null);
      await groupOf([oxford], pe, null);
      const girl = await pupil(oxford, 'female');
      expect((await rowsOfStudent(girl.id)).map((one) => one.review)).toEqual([true]);
    });
  });

  describe('the placement screen', () => {
    it('lists no girl for taekwondo of the boys, and places the boys untagged', async () => {
      // The students first, then the groups: they are not yet placed.
      const oxford = await classes.schoolClass(t.north, year);
      const girl = await pupil(oxford, 'female');
      const boy = await pupil(oxford, 'male');
      const boys = await groupOf([oxford], taekwondo, 'male');
      const board = groupPlacementBoardSchema.parse(
        (await get(`/api/groups/placement?subjectId=${taekwondo}&grades=7&on=2026-10-12`)).body,
      );
      const listed = board.unplaced.map((one) => one.id);
      expect(listed).toContain(boy.id);
      expect(listed).not.toContain(girl.id);
      expect(board.groups.find((one) => one.id === boys)?.sex).toBe('male');
      const result = await post('/api/groups/placement/automatic', {
        subjectId: taekwondo,
        grades: [7],
        from: '2026-10-12',
      });
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      const placed = automaticPlacementResultSchema.parse(result.body).placed;
      expect(placed.filter((one) => one.studentId === boy.id || one.studentId === girl.id)).toEqual(
        [{ studentId: boy.id, groupId: boys }],
      );
      expect(await rowsOfStudent(boy.id)).toEqual([
        { group_id: boys, cause: 'automatic', review: false },
      ]);
    });
  });

  describe('a student’s sex', () => {
    it('is refused while the student is in a group for that sex from today (student_sex_groups)', async () => {
      const oxford = await classes.schoolClass(t.north, year);
      const girl = await pupil(oxford, 'female');
      const girls = await groupOf([oxford], gymnastics, 'female');
      const placed = await post(`/api/groups/${girls}/members`, {
        students: [{ id: girl.id }],
        from: '2026-10-12',
      });
      expect(placed.status, JSON.stringify(placed.body)).toBe(201);
      const audit = await t.auditCount();
      refusedWith(
        await put(`/api/people/students/${girl.id}`, { ...girl.typed, sex: 'male' }),
        409,
        'student_sex_groups',
      );
      expect(await t.auditCount()).toBe(audit);
    });
  });
});
