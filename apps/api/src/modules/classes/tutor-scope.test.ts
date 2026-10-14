import {
  BRANCH_HEADER,
  classDetailSchema,
  classListSchema,
  classMembersSchema,
  studentDetailSchema,
  studentListSchema,
  studentRelativesSchema,
} from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClassesKit } from '../../testing/classes-kit.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { binary, fileOf } from '../../testing/xlsx-kit.js';

// All names are invented. docs/spec/02-roles-and-access.md, the Tutor row:
// "Own class or classes; student list of the branch ... Views the full
// student list of the branch (view only) and the profiles of own class";
// edge/people-roles-accounts, Personal data and the audit log (Contact: "and
// the class Tutor"; "Tutors export their own class"); edge/students-classes-
// groups, "The Tutor of a class changes in January" ("the earlier one loses
// access on the end date. An acting Tutor can be set for a period"). Task
// 3.1c, pull request #90, with the corrections of its review. The clock
// stands at 23:55 on 10 October 2026 in Tashkent.
describe('the class scope of a Tutor', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let members: MembersKit;
  let year: string;
  let oxford: string;
  let yale: string;
  let harvard: string;
  let princeton: string;
  /** The Tutor of 7 Oxford. */
  let tutor: string;
  let tutorAssignment: string;
  /** The acting Tutor of 7 Yale. */
  let acting: string;
  /** A Tutor of 7 Oxford who is also Head Teacher in the branch. */
  let tutorHeadTeacher: string;
  let headTeacher: string;
  /** A Tutor whose row ends at midnight, and one whose row begins at midnight. */
  let ending: string;
  let starting: string;
  let own: string;
  let planned: string;
  let former: string;
  let other: string;
  let noClass: string;
  let southern: string;

  const FROM = new Date('2026-09-01T00:00:00+05:00');
  const MIDNIGHT = new Date('2026-10-11T00:00:00+05:00');

  /** A signed-in Tutor of the branch with a staff record that teaches in Uzbek. */
  async function tutorOf(
    first: string,
    last: string,
    branch = '',
  ): Promise<{ cookie: string; assignment: string; accountId: string }> {
    const browser = await t.kit.completeSession(first, last);
    await classes.person(branch || t.north, ['uz'], { accountId: browser.account.id, first, last });
    const given = await t.kit.giveRole(browser.account.id, {
      role: 'tutor',
      branchId: branch || t.north,
      validFrom: FROM,
    });
    return { cookie: browser.cookie, assignment: given.id, accountId: browser.account.id };
  }

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  const exportOf = (ids: readonly string[], cookie: string, extra: Record<string, unknown> = {}) =>
    request(t.kit.server)
      .post('/api/people/students/export')
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, t.north)
      .send({
        ids,
        columns: ['uid', 'name'],
        selection: 'matching',
        search: '',
        filters: {},
        ...extra,
      })
      .buffer(true)
      .parse(binary);

  const refusedExport = (
    ids: readonly string[],
    cookie: string,
    extra: Record<string, unknown> = {},
  ) =>
    t.post(
      '/api/people/students/export',
      t.north,
      { ids, columns: ['uid', 'name'], selection: 'matching', search: '', filters: {}, ...extra },
      cookie,
    );

  const uidOf = async (id: string) =>
    (
      await t.database.migrator
        .selectFrom('students')
        .select('uid')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).uid;

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
    members = new MembersKit(t.database.migrator, await classes.account());
    year = await classes.year(t.north);
    const southYear = await classes.year(t.south);
    oxford = await classes.schoolClass(t.north, year, { name: 'Oxford' });
    yale = await classes.schoolClass(t.north, year, { name: 'Yale' });
    harvard = await classes.schoolClass(t.north, year, { name: 'Harvard' });
    princeton = await classes.schoolClass(t.north, year, { name: 'Princeton' });
    const southClass = await classes.schoolClass(t.south, southYear, { name: 'Southern' });

    const first = await tutorOf('Gulnora', 'Tursunova');
    tutor = first.cookie;
    tutorAssignment = first.assignment;
    await classes.tutorRow(t.north, oxford, tutorAssignment, { from: FROM });
    const second = await tutorOf('Zarina', 'Olimova');
    acting = second.cookie;
    await classes.tutorRow(t.north, yale, second.assignment, { kind: 'acting', from: FROM });
    const third = await tutorOf('Bobur', 'Nazarov');
    tutorHeadTeacher = third.cookie;
    await classes.tutorRow(t.north, oxford, third.assignment, { kind: 'acting', from: FROM });
    await t.kit.giveRole(third.accountId, { role: 'head_teacher', branchId: t.north });
    const plain = await t.kit.completeSession('Sardor', 'Ergashev');
    await t.kit.giveRole(plain.account.id, { role: 'head_teacher', branchId: t.north });
    headTeacher = plain.cookie;
    const fourth = await tutorOf('Kamola', 'Saidova');
    ending = fourth.cookie;
    await classes.tutorRow(t.north, harvard, fourth.assignment, { from: FROM, until: MIDNIGHT });
    const fifth = await tutorOf('Jasur', 'Qodirov');
    starting = fifth.cookie;
    await classes.tutorRow(t.north, princeton, fifth.assignment, { from: MIDNIGHT });

    own = await members.student(t.north);
    await members.member({ branch: t.north, classId: oxford, studentId: own, from: '2026-09-01' });
    planned = await members.student(t.north);
    await members.member({
      branch: t.north,
      classId: yale,
      studentId: planned,
      from: '2026-09-01',
      ownUntil: '2026-10-20',
    });
    await members.member({
      branch: t.north,
      classId: oxford,
      studentId: planned,
      from: '2026-10-20',
    });
    former = await members.student(t.north);
    await members.member({
      branch: t.north,
      classId: oxford,
      studentId: former,
      from: '2026-09-01',
      ownUntil: '2026-10-01',
    });
    await members.member({ branch: t.north, classId: yale, studentId: former, from: '2026-10-01' });
    other = await members.student(t.north);
    await members.member({ branch: t.north, classId: yale, studentId: other, from: '2026-09-01' });
    await members.member({
      branch: t.north,
      classId: harvard,
      studentId: await members.student(t.north),
      from: '2026-09-01',
    });
    noClass = await members.student(t.north, { startsOn: '2026-10-20' });
    southern = await members.student(t.south);
    await members.member({
      branch: t.south,
      classId: southClass,
      studentId: southern,
      from: '2026-09-01',
    });
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the student record (decisions 2, 7 and 9)', () => {
    it('opens a student of the own class, with Contact and without Identity or Financial', async () => {
      for (const id of [own, planned]) {
        const response = await t.get(`/api/people/students/${id}`, t.north, tutor);
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        const record = studentDetailSchema.parse(response.body);
        expect(record.opens).toBe(true);
        expect(record.contact).not.toBeNull();
        expect(record.identity).toBeNull();
        expect(record.financial).toBeNull();
      }
    });

    it('refuses another class, a former member and a student with no class', async () => {
      for (const id of [other, former, noClass]) {
        refusedWith(
          await t.get(`/api/people/students/${id}`, t.north, tutor),
          403,
          'permission_denied',
        );
      }
    });

    it("answers 404 for another branch's student and an unknown one", async () => {
      const before = await t.auditCount();
      for (const id of [southern, UNKNOWN]) {
        refusedWith(await t.get(`/api/people/students/${id}`, t.north, tutor), 404, 'not_found');
      }
      expect(await t.auditCount()).toBe(before);
    });

    it('opens the class of an acting Tutor', async () => {
      const record = studentDetailSchema.parse(
        (await t.get(`/api/people/students/${other}`, t.north, acting).expect(200)).body,
      );
      expect(record.contact).not.toBeNull();
      refusedWith(
        await t.get(`/api/people/students/${own}`, t.north, acting),
        403,
        'permission_denied',
      );
    });

    it('decides Contact from every assignment: a Tutor who is also Head Teacher', async () => {
      const ownRecord = studentDetailSchema.parse(
        (await t.get(`/api/people/students/${own}`, t.north, tutorHeadTeacher).expect(200)).body,
      );
      expect(ownRecord.contact).not.toBeNull();
      const otherRecord = studentDetailSchema.parse(
        (await t.get(`/api/people/students/${other}`, t.north, tutorHeadTeacher).expect(200)).body,
      );
      expect(otherRecord.contact).toBeNull();
      // The Head Teacher alone opens every profile and reads no Contact (decision 11).
      const plain = studentDetailSchema.parse(
        (await t.get(`/api/people/students/${own}`, t.north, headTeacher).expect(200)).body,
      );
      expect(plain.contact).toBeNull();
    });

    it('refuses the identity show to a Tutor', async () => {
      refusedWith(
        await t.post(`/api/people/students/${own}/identity`, t.north, {}, tutor),
        403,
        'permission_denied',
      );
    });
  });

  describe('the list (decision 8)', () => {
    it('holds the whole branch and opens the rows the record would answer', async () => {
      const cases: [string, Record<string, boolean>][] = [
        [
          tutor,
          { [own]: true, [planned]: true, [former]: false, [other]: false, [noClass]: false },
        ],
        [
          tutorHeadTeacher,
          { [own]: true, [planned]: true, [former]: true, [other]: true, [noClass]: true },
        ],
        [
          // The planned joiner of 7 Oxford is still in 7 Yale until the 20th.
          acting,
          { [own]: false, [planned]: true, [former]: true, [other]: true, [noClass]: false },
        ],
      ];
      for (const [cookie, expected] of cases) {
        const list = studentListSchema.parse(
          (await t.get('/api/people/students', t.north, cookie).expect(200)).body,
        );
        for (const [id, opens] of Object.entries(expected)) {
          const row = list.students.find((item) => item.id === id);
          expect(row?.opens, id).toBe(opens);
          const record = await t.get(`/api/people/students/${id}`, t.north, cookie);
          expect(record.status, id).toBe(opens ? 200 : 403);
        }
      }
    });
  });

  describe('the Relatives tab (decision 2)', () => {
    it('is read for the own class with names, relationship and phones only', async () => {
      for (const id of [own, planned]) {
        const tab = studentRelativesSchema.parse(
          (await t.get(`/api/people/students/${id}/relatives`, t.north, tutor).expect(200)).body,
        );
        expect(tab.relatives).toHaveLength(1);
        expect(tab.relatives[0]).toMatchObject({
          relationship: 'mother',
          identity: null,
          portalAccess: null,
        });
        expect(tab.canEdit).toBe(false);
      }
    });

    it('is refused for another class and a former member, 404 for another branch and unknown', async () => {
      for (const id of [other, former, noClass]) {
        refusedWith(
          await t.get(`/api/people/students/${id}/relatives`, t.north, tutor),
          403,
          'permission_denied',
        );
      }
      for (const id of [southern, UNKNOWN]) {
        refusedWith(
          await t.get(`/api/people/students/${id}/relatives`, t.north, tutor),
          404,
          'not_found',
        );
      }
      // A Tutor who is also Head Teacher: the own class only.
      await t.get(`/api/people/students/${own}/relatives`, t.north, tutorHeadTeacher).expect(200);
      refusedWith(
        await t.get(`/api/people/students/${other}/relatives`, t.north, tutorHeadTeacher),
        403,
        'permission_denied',
      );
    });
  });

  describe('the export (decisions 3 and 5)', () => {
    it('writes the own class only, Basic columns only, and counts the rows left out', async () => {
      const ids = [own, planned, former, other, noClass];
      const response = await exportOf(ids, tutor, {
        columns: ['uid', 'name', 'phone', 'contractNumber'],
      });
      expect(response.status).toBe(200);
      expect(response.headers['x-export-rows-left-out']).toBe('3');
      const file = await fileOf(response);
      expect(file.columns).toBe('uid,name');
      expect(file.sheet.rows.map((row) => row[0])).toEqual([
        await uidOf(own),
        await uidOf(planned),
      ]);
      const [entry] = (await t.entries('student.export')).slice(-1);
      expect(entry).toMatchObject({
        assignment_id: tutorAssignment,
        details: { rows: 2, rowsLeftOut: 3, leftOut: ['phone', 'contractNumber'] },
      });
    });

    it('refuses a file with no row of the own class, and the consent filter', async () => {
      const before = await t.auditCount();
      refusedWith(await refusedExport([other, former], tutor), 403, 'permission_denied');
      refusedWith(
        await refusedExport([own], tutor, { filters: { consent: 'missing' } }),
        403,
        'permission_denied',
      );
      expect(await t.auditCount()).toBe(before);
    });

    it("answers 404 for another branch's student and an unknown one, writing nothing", async () => {
      const before = await t.auditCount();
      for (const id of [southern, UNKNOWN]) {
        refusedWith(await refusedExport([own, id], tutor), 404, 'not_found');
      }
      expect(await t.auditCount()).toBe(before);
    });

    it('leaves the export of a class-wide reader whole, with no count', async () => {
      const response = await exportOf([own, other], t.vicePrincipal);
      expect(response.status).toBe(200);
      expect(response.headers['x-export-rows-left-out']).toBeUndefined();
      expect((await fileOf(response)).sheet.rows).toHaveLength(2);
      const [entry] = (await t.entries('student.export')).slice(-1);
      expect(entry?.details).not.toHaveProperty('rowsLeftOut');
    });
  });

  describe('the classes (decisions 1 and 9)', () => {
    it('lists the own classes only and reads them with their members', async () => {
      const list = classListSchema.parse(
        (await t.get('/api/classes', t.north, tutor).expect(200)).body,
      );
      expect(list.classes.map((one) => one.id)).toEqual([oxford]);
      const actingList = classListSchema.parse(
        (await t.get('/api/classes', t.north, acting).expect(200)).body,
      );
      expect(actingList.classes.map((one) => one.id)).toEqual([yale]);
      expect(
        classDetailSchema.parse(
          (await t.get(`/api/classes/${oxford}`, t.north, tutor).expect(200)).body,
        ).id,
      ).toBe(oxford);
      const tab = classMembersSchema.parse(
        (await t.get(`/api/classes/${oxford}/members`, t.north, tutor).expect(200)).body,
      );
      expect(tab.members.map((member) => member.studentId).sort()).toEqual([own, planned].sort());
      // A Head Teacher reads every class.
      const all = classListSchema.parse(
        (await t.get('/api/classes', t.north, headTeacher).expect(200)).body,
      );
      expect(all.classes.length).toBeGreaterThanOrEqual(4);
    });

    it("refuses another class 403 and another branch's or an unknown one 404", async () => {
      for (const path of ['', '/members']) {
        refusedWith(
          await t.get(`/api/classes/${yale}${path}`, t.north, tutor),
          403,
          'permission_denied',
        );
        for (const id of [UNKNOWN]) {
          refusedWith(await t.get(`/api/classes/${id}${path}`, t.north, tutor), 404, 'not_found');
        }
      }
    });

    it('refuses every write, the candidates and the export of classes to a Tutor', async () => {
      const before = await t.auditCount();
      refusedWith(
        await t.get('/api/classes/tutor-candidates', t.north, tutor),
        403,
        'permission_denied',
      );
      refusedWith(
        await t.post('/api/classes/export', t.north, {}, tutor),
        403,
        'permission_denied',
      );
      refusedWith(
        await t.post(`/api/classes/${oxford}/archive`, t.north, {}, tutor),
        403,
        'permission_denied',
      );
      refusedWith(
        await t.post(
          `/api/classes/${oxford}/members`,
          t.north,
          { students: [], from: '2026-10-12' },
          tutor,
        ),
        403,
        'permission_denied',
      );
      expect(await t.auditCount()).toBe(before);
    });

    it('holds no class of a closed year (decision 14)', async () => {
      const east = await t.newBranch();
      const eastYear = await classes.year(east);
      const eastClass = await classes.schoolClass(east, eastYear, { name: 'Eastern' });
      const eastTutor = await tutorOf('Nodira', 'Yusupova', east);
      await classes.tutorRow(east, eastClass, eastTutor.assignment, { from: FROM });
      const before = classListSchema.parse(
        (await t.get('/api/classes', east, eastTutor.cookie).expect(200)).body,
      );
      expect(before.classes.map((one) => one.id)).toEqual([eastClass]);
      await classes.setYear(eastYear, 'closed');
      const after = classListSchema.parse(
        (await t.get('/api/classes', east, eastTutor.cookie).expect(200)).body,
      );
      expect(after.classes).toEqual([]);
      refusedWith(
        await t.get(`/api/classes/${eastClass}`, east, eastTutor.cookie),
        403,
        'permission_denied',
      );
      // The Tutor assignment of another branch gives nothing in north.
      refusedWith(await t.get('/api/classes', t.north, eastTutor.cookie), 403, 'permission_denied');
    });
  });

  // Last: the clock passes midnight. "Rights are read again on every request".
  describe('a Tutor row in time (decision 10)', () => {
    it('gives the class from the start moment and takes it at the end moment', async () => {
      const harvardOf = async (cookie: string) =>
        classListSchema
          .parse((await t.get('/api/classes', t.north, cookie).expect(200)).body)
          .classes.map((one) => one.id);
      expect(await harvardOf(ending)).toEqual([harvard]);
      expect(await harvardOf(starting)).toEqual([]);
      t.clock.advance(6 * 60 * 1000);
      expect(await harvardOf(ending)).toEqual([]);
      refusedWith(
        await t.get(`/api/classes/${harvard}`, t.north, ending),
        403,
        'permission_denied',
      );
      expect(await harvardOf(starting)).toEqual([princeton]);
    });
  });
});
