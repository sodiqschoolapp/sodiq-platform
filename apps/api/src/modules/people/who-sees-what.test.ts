import { studentDetailSchema, studentListSchema, studentSearchSchema } from '@sodiq/shared';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

// All names are invented. Task 3.6a, the owner's answers of 15 October 2026
// on issue #42, L48: "A Teacher sees the students they teach (the members of
// their classes and groups in the teaching load in force), with the Basic
// fields only, and no other student. A Teacher with no classes sees no
// student." Decisions 4, 12, 13 and 14 of pull request #118 with corrections
// 1 and 3 of its review. Publishing comes with task 5.5, so the published
// versions are written as the migrator. The clock of the kit stands on
// Saturday 10 October 2026 in Tashkent.
describe('who sees what: the students a Teacher teaches', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let members: MembersKit;
  /** The Teacher of Mathematics in 7 Oxford and of English in group A of 7 Yale. */
  let teacher: string;
  /** In 7 Oxford. */
  let inClass: string;
  /** In 7 Yale and its English group A. */
  let inGroup: string;
  /** In 7 Yale and its English group B: a classmate of the other group. */
  let classmate: string;
  /** In 7 Yale and group B today, in group A from 19 October. */
  let movingIn: string;
  /** In 7 Harvard. */
  let elsewhere: string;
  /** In 7 Oxford of the planned year only. */
  let nextYear: string;
  let harvard: string;

  const get = (path: string, cookie: string) => t.get(path, t.north, cookie);
  const listed = async (cookie: string) => {
    const response = await get('/api/people/students', cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return studentListSchema.parse(response.body);
  };
  const listedIds = async (cookie: string) =>
    (await listed(cookie)).students.map((row) => row.id).sort();

  /** A signed-in Teacher of the branch with a staff record that teaches `subjects` in grade 7. */
  async function teacherOf(first: string, last: string, subjects: readonly string[]) {
    const browser = await t.kit.completeSession(first, last);
    const person = await load.teacher(t.north, {
      accountId: browser.account.id,
      subjects: subjects.map((subject) => ({ subject, grades: [7] })),
    });
    await t.kit.giveRole(browser.account.id, { role: 'teacher', branchId: t.north });
    return { cookie: browser.cookie, staffId: person.staffId, accountId: browser.account.id };
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    load = new LoadKit(t.database.migrator);
    members = new MembersKit(t.database.migrator, await load.classes.account());
    const year = await load.classes.year(t.north);
    const planned = await load.classes.year(t.north, 'planned', '2027-09-01', '2028-05-31');
    const oxford = await load.classes.schoolClass(t.north, year, { name: 'Oxford' });
    const yale = await load.classes.schoolClass(t.north, year, { name: 'Yale' });
    harvard = await load.classes.schoolClass(t.north, year, { name: 'Harvard' });
    const nextOxford = await load.classes.schoolClass(t.north, planned, { name: 'Oxford' });
    const maths = await load.classes.subject({ grades: [7] });
    const english = await load.classes.subject({ grades: [7] });
    const groupA = await load.classes.group(t.north, year, english, [yale], { name: 'English A' });
    const groupB = await load.classes.group(t.north, year, english, [yale], { name: 'English B' });

    const main = await teacherOf('Dilshod', 'Aminov', [maths, english]);
    teacher = main.cookie;

    /** A student of the class, and of its English groups as given, written together. */
    const student = async (
      classId: string,
      from = '2026-09-01',
      groups: readonly { groupId: string; from: string; ownUntil?: string }[] = [],
    ) => {
      const id = await members.student(t.north);
      await t.database.migrator.transaction().execute(async (transaction) => {
        // A class of the planned year runs to that year's end.
        const ownUntil = from >= '2027-09-01' ? { ownUntil: '2028-06-01' } : {};
        await members.member(
          { branch: t.north, classId, studentId: id, from, ...ownUntil },
          transaction,
        );
        for (const group of groups) {
          await members.groupMember(
            { branch: t.north, subjectId: english, studentId: id, ...group },
            transaction,
          );
        }
      });
      return id;
    };
    inClass = await student(oxford);
    inGroup = await student(yale, '2026-09-01', [{ groupId: groupA, from: '2026-09-01' }]);
    classmate = await student(yale, '2026-09-01', [{ groupId: groupB, from: '2026-09-01' }]);
    movingIn = await student(yale, '2026-09-01', [
      { groupId: groupB, from: '2026-09-01', ownUntil: '2026-10-19' },
      { groupId: groupA, from: '2026-10-19' },
    ]);
    elsewhere = await student(harvard);
    nextYear = await student(nextOxford, '2027-09-01');

    // The versions of the year: an older published one, the one in force
    // (the latest start on or before today), a later published one and a
    // draft. Each gives Mathematics in 7 Oxford to another teacher.
    const older = await teacherOf('Kamol', 'Rasulov', [maths]);
    const later = await teacherOf('Lola', 'Ismoilova', [maths]);
    const drafted = await teacherOf('Hamid', 'Yusupov', [maths]);
    const atNext = await teacherOf('Sevara', 'Qosimova', [maths]);
    // Rows are written into a draft (0055), which is then published.
    const versionOf = (startsOn: string, yearId = year) =>
      load.version(t.north, yearId, { startsOn });
    const row = (version: string, teacherId: string, unit: object, subject = maths) =>
      load.row({
        branch_id: t.north,
        version_id: version,
        subject_id: subject,
        teacher_id: teacherId,
        ...unit,
      });
    const v1 = await versionOf('2026-09-01');
    await row(v1, older.staffId, { class_id: oxford });
    const v2 = await versionOf('2026-10-05');
    await row(v2, main.staffId, { class_id: oxford });
    await row(v2, main.staffId, { group_id: groupA }, english);
    const v3 = await versionOf('2026-10-19');
    await row(v3, later.staffId, { class_id: oxford });
    const draft = await versionOf('2026-10-12');
    await row(draft, drafted.staffId, { class_id: oxford });
    // The planned year: its published version starts on its first day, and
    // counts already (decision 4 as confirmed by the review).
    const next = await versionOf('2027-09-01', planned);
    await row(next, atNext.staffId, { class_id: nextOxford });
    // Every row is in; the four versions are published.
    const publish = async () => {
      for (const id of [v1, v2, v3, next]) {
        await load.setVersion(id, 'published');
      }
    };
    // A Tutor of 7 Harvard who teaches Mathematics in 7 Princeton.
    const princeton = await load.classes.schoolClass(t.north, year, { name: 'Princeton' });
    taughtByBoth = await student(princeton);
    const both = await teacherOf('Zilola', 'Karimova', [maths]);
    const tutorFrom = new Date('2026-09-01T00:00:00+05:00');
    const tutorRole = await t.kit.giveRole(both.accountId, {
      role: 'tutor',
      branchId: t.north,
      validFrom: tutorFrom,
    });
    await load.classes.tutorRow(t.north, harvard, tutorRole.id, { from: tutorFrom });
    await row(v2, both.staffId, { class_id: princeton });
    await publish();
    tutorTeacher = both.cookie;
    await t.database.migrator
      .updateTable('students')
      .set({ diagnostic_score: 55 })
      .where('id', 'in', [elsewhere, taughtByBoth])
      .execute();
    olderTeacher = older.cookie;
    laterTeacher = later.cookie;
    draftTeacher = drafted.cookie;
    plannedTeacher = atNext.cookie;
  });

  let olderTeacher: string;
  let tutorTeacher: string;
  let taughtByBoth: string;
  let laterTeacher: string;
  let draftTeacher: string;
  let plannedTeacher: string;

  afterAll(async () => {
    await t.close();
  });

  describe('the list, the record, the photo and Ctrl+K', () => {
    it('lists the taught students only: a taught class, a taught group, a planned move into it', async () => {
      expect(await listedIds(teacher)).toEqual([inClass, inGroup, movingIn].sort());
      const list = await listed(teacher);
      expect(list).toMatchObject({ exportGroups: [], readsFinancial: false });
    });

    it('reads the published version in force only: not an older, a later or a draft', async () => {
      for (const cookie of [olderTeacher, laterTeacher, draftTeacher]) {
        expect(await listedIds(cookie)).toEqual([]);
      }
    });

    it('reads the published version of the planned year from its first day', async () => {
      expect(await listedIds(plannedTeacher)).toEqual([nextYear]);
    });

    it('answers the Basic group, the groups, the status and the start date, field by field', async () => {
      const row = (await listed(teacher)).students.find((one) => one.id === inGroup);
      expect(row).toMatchObject({
        mergedUids: [],
        consentMissing: null,
        status: 'active',
        startsOn: expect.any(String) as string,
        planned: null,
        plannedClass: null,
        tutor: null,
        actingTutor: null,
        opens: true,
      });
      expect(row?.groups.map((group) => group.name)).toEqual(['English A']);
      const response = await get(`/api/people/students/${inGroup}`, teacher);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const read = studentDetailSchema.parse(response.body);
      expect(read).toMatchObject({
        contact: null,
        identity: null,
        identityHidden: false,
        financial: null,
        diagnosticScore: null,
        readsDiagnostic: false,
        consentMissing: null,
        statuses: [],
        mergedUids: [],
        planned: null,
        plannedClass: null,
        tutor: null,
        actingTutor: null,
        mainRoom: null,
        scheduledMoves: [],
        lastClassMove: null,
        lastBranchMove: null,
        branchMove: null,
        status: 'active',
        canEdit: false,
        canArchive: false,
        readsHistory: false,
      });
      expect(read.class?.name).toBe('Yale');
      expect(read.groups.map((group) => group.name)).toEqual(['English A']);
    });

    it('refuses another student on the record, the photo and Ctrl+K', async () => {
      for (const id of [classmate, elsewhere, nextYear]) {
        refusedWith(await get(`/api/people/students/${id}`, teacher), 403, 'permission_denied');
        refusedWith(
          await get(`/api/people/students/${id}/photo`, teacher),
          403,
          'permission_denied',
        );
      }
      // A taught student without a photo: past the scope, 404.
      refusedWith(await get(`/api/people/students/${inClass}/photo`, teacher), 404, 'not_found');
      const search = await get('/api/search/students?q=Rahimova', teacher);
      expect(search.status, JSON.stringify(search.body)).toBe(200);
      expect(
        studentSearchSchema
          .parse(search.body)
          .items.map((item) => item.id)
          .sort(),
      ).toEqual([inClass, inGroup, movingIn].sort());
    });

    it('refuses the History and Relatives tabs, the export, the counter and the show', async () => {
      const before = await t.auditCount();
      for (const path of [
        `/api/people/students/${inClass}/history`,
        `/api/people/students/${inClass}/relatives`,
        '/api/people/students/no-class',
      ]) {
        refusedWith(await get(path, teacher), 403, 'permission_denied');
      }
      refusedWith(
        await t.post(`/api/people/students/${inClass}/identity`, t.north, {}, teacher),
        403,
        'permission_denied',
      );
      refusedWith(
        await t.post(
          '/api/people/students/export',
          t.north,
          { ids: [inClass], columns: ['uid'], selection: 'ticked', search: '', filters: {} },
          teacher,
        ),
        403,
        'permission_denied',
      );
      expect(await t.auditCount()).toBe(before);
    });

    it('lists no student to a Teacher with no load', async () => {
      expect(await listedIds(t.teacher)).toEqual([]);
      refusedWith(
        await get(`/api/people/students/${inClass}`, t.teacher),
        403,
        'permission_denied',
      );
    });
  });

  // Decision 14 of pull request #118: a person who also holds a role that
  // opens the student gets what that role reads; a taught student of another
  // class is read as a Teacher only.
  describe('a Tutor who also teaches', () => {
    it('reads a taught student of another class Basic only, and own class with Contact and the score', async () => {
      expect(await listedIds(tutorTeacher)).toEqual(
        expect.arrayContaining([classmate, taughtByBoth]),
      );
      const taught = studentDetailSchema.parse(
        (await get(`/api/people/students/${taughtByBoth}`, tutorTeacher)).body,
      );
      expect(taught).toMatchObject({
        contact: null,
        diagnosticScore: null,
        readsDiagnostic: false,
        statuses: [],
        tutor: null,
      });
      const own = studentDetailSchema.parse(
        (await get(`/api/people/students/${elsewhere}`, tutorTeacher)).body,
      );
      expect(own.contact).not.toBeNull();
      expect(own).toMatchObject({ diagnosticScore: 55, readsDiagnostic: true, identity: null });
    });
  });
});
