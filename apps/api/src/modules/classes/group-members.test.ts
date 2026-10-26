import {
  apiErrorSchema,
  automaticPlacementResultSchema,
  groupListSchema,
  groupMembersSchema,
  groupPlacementBoardSchema,
  studentDetailSchema,
  studentListSchema,
  type GroupMembers,
  type StudentDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { relativesInput } from '../../testing/relatives-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const detailsOf = (response: Response) => apiErrorSchema.parse(response.body).error.details ?? [];

// All names are invented. docs/spec/05-classes-groups-subjects.md, Group:
// "Every student of the classes involved must be in exactly one group for
// that subject; the screen lists students not yet placed"; "A bulk screen
// places students ... into groups for one subject and one grade, or one pair
// of grades, at a time"; docs/spec/edge-cases/students-classes-groups.md
// ("Bulk placement puts students into the smallest suitable group and tags
// them \"placed automatically, review\""; "A class is full ... Groups work the
// same way"); docs/spec/04-people.md, Student list and Movements; task 3.2b,
// pull request #92, with corrections 1 and 2 of its review. The clock stands
// at 23:55 on Saturday 10 October 2026 in Tashkent.
describe('group membership', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let year: string;
  let southYear: string;
  let maths: string;
  let english: string;
  let headTeacher: string;
  let otherHeadTeacher: string;
  let tutor: string;
  let tutorClass: string;
  /**
   * The students of the Tutor's class, one for each Tutor test. Their class
   * rows come before any group of the class (0049: only the insert of a class
   * row needs its group rows), so they are not yet placed.
   */
  let tutorPupils: [StudentDetail, StudentDetail];
  let count = 0;

  const FROM = new Date('2026-09-01T00:00:00+05:00');

  const get = (path: string, cookie = t.vicePrincipal, branch = t.north) =>
    t.get(path, branch, cookie);
  const post = (path: string, body: object = {}, cookie = t.vicePrincipal, branch = t.north) =>
    t.post(path, branch, body, cookie);

  /** A new student's body: grade 7, from 2 September, in the class named. */
  function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    count += 1;
    return {
      uid: String(2607500 + count),
      firstName: 'Dilnoza',
      lastName: `Karimova${'b'.repeat(count % 9)}${String.fromCharCode(97 + (count % 26))}`,
      paternalName: null,
      sex: 'female',
      birthDate: `2013-04-${String((count % 28) + 1).padStart(2, '0')}`,
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
      contract: { number: `GM-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives: relativesInput(),
      ...overrides,
    };
  }

  /** A student of the class, created by the route, in it from 2 September. */
  async function pupil(classId: string, overrides: Record<string, unknown> = {}) {
    const response = await post('/api/people/students', body({ classId, ...overrides }));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  const schoolClass = (grade = 7, branch = '', yearId = '') =>
    classes.schoolClass(branch || t.north, yearId || year, { grade });

  const group = (
    classIds: readonly string[],
    input: { subject?: string; size?: number; name?: string; branch?: string; year?: string } = {},
  ) =>
    classes.group(input.branch ?? t.north, input.year ?? year, input.subject ?? maths, classIds, {
      size: input.size ?? 20,
      ...(input.name === undefined ? {} : { name: input.name }),
    });

  const place = (
    groupId: string,
    students: readonly { id: string }[],
    from = '2026-10-12',
    cookie = t.vicePrincipal,
    branch = t.north,
  ) =>
    post(
      `/api/groups/${groupId}/members`,
      { students: students.map((one) => ({ id: one.id })), from },
      cookie,
      branch,
    );

  const placed = (response: Response): GroupMembers => {
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return groupMembersSchema.parse(response.body);
  };

  const membersOf = async (groupId: string, cookie = t.vicePrincipal) => {
    const response = await get(`/api/groups/${groupId}/members`, cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return groupMembersSchema.parse(response.body);
  };

  const rowsOfStudent = (id: string) =>
    t.database.migrator
      .selectFrom('group_memberships')
      .select(['group_id', 'valid_from', 'valid_until', 'own_until', 'ended_by', 'cause', 'review'])
      .where('student_id', '=', id)
      .orderBy('valid_from')
      .orderBy('id')
      .execute();

  /** Every row of the tables the group membership routes write, in both branches, and the log. */
  const rowsOf = () =>
    Promise.all([
      t.database.migrator.selectFrom('group_memberships').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('groups').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('class_memberships').selectAll().orderBy('id').execute(),
      t.auditCount(),
    ]);

  const board = (subjectId: string, grades: string, on = '2026-10-12', cookie = t.vicePrincipal) =>
    get(`/api/groups/placement?subjectId=${subjectId}&grades=${grades}&on=${on}`, cookie);

  const automatic = (subjectId: string, grades: number[], from = '2026-10-12') =>
    post('/api/groups/placement/automatic', { subjectId, grades, from });

  /** A signed-in account with a role in the North branch, or school-wide for the Senior Head Teacher. */
  async function signedIn(
    first: string,
    last: string,
    role: string,
    subjectIds?: readonly string[],
  ): Promise<{ cookie: string; assignment: string; accountId: string }> {
    const browser = await t.kit.completeSession(first, last);
    const given = await t.kit.giveRole(browser.account.id, {
      role: role as never,
      ...(role === 'senior_head_teacher' ? {} : { branchId: t.north }),
      ...(role === 'tutor' ? { validFrom: FROM } : {}),
      ...(subjectIds === undefined ? {} : { subjectIds }),
    });
    return { cookie: browser.cookie, assignment: given.id, accountId: browser.account.id };
  }

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(t.database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  /** Runs `work` in a transaction of the application that stays open until released. */
  async function holdOpen(work: (transaction: Transaction) => Promise<void>) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const done = t.app
      .get(Transactions)
      .run([t.north], async (transaction) => {
        await work(transaction);
        ready();
        await released;
      })
      .catch((error: unknown) => error);
    await Promise.race([isReady, done]);
    return { release, done };
  }

  /** The writes of a placement, as the route makes them: the students, then the groups, by id. */
  async function writePlacement(
    transaction: Transaction,
    rows: readonly { studentId: string; groupId: string; from?: string; cause?: string }[],
  ): Promise<void> {
    await transaction
      .selectFrom('students')
      .select('id')
      .where('id', 'in', [...new Set(rows.map((row) => row.studentId))].sort())
      .orderBy('id')
      .forUpdate()
      .execute();
    await transaction
      .selectFrom('groups')
      .select('id')
      .where('id', 'in', [...new Set(rows.map((row) => row.groupId))].sort())
      .orderBy('id')
      .forUpdate()
      .execute();
    for (const row of rows) {
      await transaction
        .insertInto('group_memberships')
        .values({
          branch_id: t.north,
          student_id: row.studentId,
          group_id: row.groupId,
          subject_id: maths,
          valid_from: row.from ?? '2026-10-12',
          valid_until: '2027-06-01',
          own_until: '2027-06-01',
          cause: row.cause ?? 'placement',
          review: row.cause === 'automatic',
        })
        .execute();
    }
  }

  /**
   * The writes of a leaving, as the leaving route makes them: the student
   * FOR UPDATE, the status rows, the class rows cut, then the groups of its
   * group rows FOR UPDATE in the order of their id and those rows cut.
   */
  async function writeLeaving(
    transaction: Transaction,
    studentId: string,
    firstInactiveDay: string,
  ): Promise<void> {
    await transaction
      .selectFrom('students')
      .select('id')
      .where('id', '=', studentId)
      .forUpdate()
      .execute();
    await transaction
      .updateTable('student_statuses')
      .set({ valid_until: firstInactiveDay })
      .where('student_id', '=', studentId)
      .where('valid_until', 'is', null)
      .execute();
    const leaving = await transaction
      .insertInto('student_statuses')
      .values({
        student_id: studentId,
        branch_id: t.north,
        status: 'inactive',
        valid_from: firstInactiveDay,
        cause: 'leaving',
        reason: 'The family moved.',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable('class_memberships')
      .set({ valid_until: firstInactiveDay, ended_by: 'leaving', leaving_id: leaving.id })
      .where('student_id', '=', studentId)
      .where('valid_until', '>', firstInactiveDay)
      .execute();
    const groups = await transaction
      .selectFrom('group_memberships')
      .select('group_id')
      .where('student_id', '=', studentId)
      .where('valid_until', '>', firstInactiveDay)
      .execute();
    await transaction
      .selectFrom('groups')
      .select('id')
      .where('id', 'in', groups.length === 0 ? [UNKNOWN] : groups.map((row) => row.group_id).sort())
      .orderBy('id')
      .forUpdate()
      .execute();
    await transaction
      .updateTable('group_memberships')
      .set({ valid_until: firstInactiveDay, ended_by: 'leaving', leaving_id: leaving.id })
      .where('student_id', '=', studentId)
      .where('valid_until', '>', firstInactiveDay)
      .execute();
  }

  /** The writes of a group edit, as the route makes them: its classes FOR SHARE, then the group. */
  async function writeGroupEdit(
    transaction: Transaction,
    groupId: string,
    change: { maxSize?: number; removeClass?: string; archive?: boolean },
  ): Promise<void> {
    const links = await transaction
      .selectFrom('group_classes')
      .select('class_id')
      .where('group_id', '=', groupId)
      .execute();
    await transaction
      .selectFrom('classes')
      .select('id')
      .where(
        'id',
        'in',
        links.map((link) => link.class_id),
      )
      .orderBy('id')
      .forShare()
      .execute();
    await transaction
      .selectFrom('groups')
      .select('id')
      .where('id', '=', groupId)
      .forUpdate()
      .execute();
    if (change.maxSize !== undefined) {
      await transaction
        .updateTable('groups')
        .set({ max_size: change.maxSize })
        .where('id', '=', groupId)
        .execute();
    }
    if (change.archive === true) {
      await transaction
        .updateTable('groups')
        .set({ archived_at: new Date('2026-10-10T23:55:00+05:00') })
        .where('id', '=', groupId)
        .execute();
    }
    if (change.removeClass !== undefined) {
      await transaction
        .deleteFrom('group_classes')
        .where('group_id', '=', groupId)
        .where('class_id', '=', change.removeClass)
        .execute();
    }
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
    year = await classes.year(t.north);
    southYear = await classes.year(t.south);
    maths = await classes.subject({ grades: [7, 8, 9, 10] });
    english = await classes.subject({ grades: [7, 8, 9, 10], languageRule: false });
    headTeacher = (await signedIn('Rustam', 'Aliyev', 'head_teacher', [maths])).cookie;
    otherHeadTeacher = (await signedIn('Bekzod', 'Usmonov', 'head_teacher', [english])).cookie;
    const tutoring = await signedIn('Zarina', 'Qodirova', 'tutor');
    tutor = tutoring.cookie;
    await classes.person(t.north, ['uz'], { accountId: tutoring.accountId });
    tutorClass = await schoolClass();
    await classes.tutorRow(t.north, tutorClass, tutoring.assignment, { from: FROM });
    tutorPupils = [await pupil(tutorClass), await pupil(tutorClass)];
  });

  afterAll(async () => {
    await t.close();
  });

  describe('"Put into a group"', () => {
    it('places students from a date and logs each on the student record', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const two = await pupil(oxford);
      const maths1 = await group([oxford]);
      const response = await place(maths1, [one, two], '2026-10-12');
      const tab = placed(response);
      expect(tab.members.map((member) => member.studentId).sort()).toEqual([one.id, two.id].sort());
      expect(tab.members[0]).toMatchObject({
        from: '2026-10-12',
        until: '2027-06-01',
        state: 'planned',
        review: false,
        class: { id: oxford, grade: 7 },
      });
      expect(tab).toMatchObject({ freeToday: 20, freeLeast: 18, othersCount: 0 });
      expect(await rowsOfStudent(one.id)).toEqual([
        {
          group_id: maths1,
          valid_from: '2026-10-12',
          valid_until: '2027-06-01',
          own_until: '2027-06-01',
          ended_by: null,
          cause: 'placement',
          review: false,
        },
      ]);
      const [entry] = await t.entries('student.group_joined', one.id);
      expect(entry).toMatchObject({
        assignment_id: t.viceAssignment,
        request_id: response.headers['x-request-id'],
        new_value: {
          groupId: maths1,
          from: '2026-10-12',
          until: '2027-06-01',
          cause: 'placement',
          review: false,
        },
      });
    });

    it('lets the Super Admin place, and shows the groups in the list, the record and the card', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const maths1 = await group([oxford], { name: 'M-Card' });
      const response = await place(maths1, [one], '2026-10-10', t.admin);
      placed(response);
      expect((await t.entries('student.group_joined', one.id))[0]).toMatchObject({
        assignment_id: t.adminAssignment,
        request_id: response.headers['x-request-id'],
      });
      const list = studentListSchema.parse((await get('/api/people/students')).body);
      expect(list.students.find((row) => row.id === one.id)?.groups).toEqual([
        {
          id: maths1,
          // Task 3.3a: the row a group move names.
          membershipId: expect.any(String) as string,
          name: 'M-Card',
          subjectId: maths,
          from: '2026-10-10',
          state: 'current',
          review: false,
        },
      ]);
      const record = studentDetailSchema.parse((await get(`/api/people/students/${one.id}`)).body);
      expect(record.groups.map((one) => one.id)).toEqual([maths1]);
      const groups = groupListSchema.parse((await get('/api/groups')).body);
      expect(groups.groups.find((row) => row.id === maths1)?.students).toBe(1);
    });

    it('refuses each student by its own rule, all or none, named in details', async () => {
      const oxford = await schoolClass();
      const elsewhere = await schoolClass();
      const held = await pupil(oxford);
      const outside = await pupil(elsewhere);
      const fine = await pupil(oxford);
      const maths1 = await group([oxford]);
      const maths2 = await group([oxford]);
      placed(await place(maths2, [held], '2026-11-02'));
      const before = await rowsOf();
      const response = await place(maths1, [fine, held, outside], '2026-10-12');
      refusedWith(response, 409, 'student_has_group');
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({
          path: 'students.1',
          code: 'student_has_group',
          recordId: held.id,
        }),
        expect.objectContaining({
          path: 'students.2',
          code: 'student_not_in_group_class',
          recordId: outside.id,
        }),
      ]);
      expect(await rowsOf()).toEqual(before);
    });

    it('refuses more students than free seats, with the free seats named', async () => {
      const oxford = await schoolClass();
      const [one, two, three] = [await pupil(oxford), await pupil(oxford), await pupil(oxford)];
      const small = await group([oxford], { size: 2 });
      placed(await place(small, [one], '2026-11-02'));
      const response = await place(small, [two, three], '2026-10-12');
      refusedWith(response, 409, 'group_full');
      expect(detailsOf(response)).toEqual([expect.objectContaining({ freeSeats: 1 })]);
    });

    it('refuses an archived group and a date outside its year', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const maths1 = await group([oxford]);
      refusedWith(await place(maths1, [one], '2027-06-01'), 409, 'group_membership_outside_year');
      await t.database.migrator
        .updateTable('groups')
        .set({ archived_at: new Date('2026-10-01T00:00:00+05:00') })
        .where('id', '=', maths1)
        .execute();
      refusedWith(await place(maths1, [one]), 409, 'group_archived');
    });

    it('answers 404 for a group or a student of another branch or unknown, changing nothing', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const maths1 = await group([oxford]);
      const southClass = await schoolClass(7, t.south, southYear);
      const southPupil = studentDetailSchema.parse(
        (await t.post('/api/people/students', t.south, body({ classId: southClass }), t.admin))
          .body,
      );
      const southGroup = await group([southClass], { branch: t.south, year: southYear });
      const before = await rowsOf();
      for (const [groupId, students] of [
        [southGroup, [one]],
        [UNKNOWN, [one]],
        [maths1, [southPupil]],
        [maths1, [{ id: UNKNOWN }]],
      ] as const) {
        refusedWith(await place(groupId, students, '2026-10-12', t.admin), 404, 'not_found');
      }
      expect(await rowsOf()).toEqual(before);
    });

    it('refuses every role that does not edit groups, with nothing logged', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const maths1 = await group([oxford]);
      const before = await rowsOf();
      for (const cookie of [t.principal, headTeacher, tutor, t.teacher]) {
        refusedWith(await place(maths1, [one], '2026-10-12', cookie), 403, 'permission_denied');
      }
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('the Students tab and its readers (decisions 4 and 6)', () => {
    it('lets a Head Teacher read a group of own subjects, not another', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const maths1 = await group([oxford]);
      const englishGroup = await group([oxford], { subject: english });
      placed(await place(maths1, [one]));
      expect((await membersOf(maths1, headTeacher)).members).toHaveLength(1);
      refusedWith(
        await get(`/api/groups/${englishGroup}/members`, headTeacher),
        403,
        'permission_denied',
      );
      refusedWith(
        await get(`/api/groups/${maths1}/members`, otherHeadTeacher),
        403,
        'permission_denied',
      );
    });

    it('lets a Senior Head Teacher read a group of own subjects in a branch of no assignment of theirs', async () => {
      const senior = (await signedIn('Nodira', 'Usmonova', 'senior_head_teacher', [maths])).cookie;
      const southClass = await schoolClass(7, t.south, southYear);
      const southMaths = await group([southClass], { branch: t.south, year: southYear });
      const southEnglish = await group([southClass], {
        branch: t.south,
        year: southYear,
        subject: english,
      });
      const tab = await get(`/api/groups/${southMaths}/members`, senior, t.south);
      expect(tab.status, JSON.stringify(tab.body)).toBe(200);
      refusedWith(
        await get(`/api/groups/${southEnglish}/members`, senior, t.south),
        403,
        'permission_denied',
      );
    });

    it('lets a Tutor read the members of own class only, with a count of the others', async () => {
      const other = await schoolClass();
      const own = tutorPupils[0];
      const foreign = await pupil(other);
      const across = await group([tutorClass, other]);
      placed(await place(across, [own, foreign], '2026-10-10'));
      const tab = await membersOf(across, tutor);
      expect(tab.members.map((member) => member.studentId)).toEqual([own.id]);
      expect(tab.othersCount).toBe(1);
      expect(tab.freeToday).toBe(18);
      const notOwn = await group([other]);
      refusedWith(await get(`/api/groups/${notOwn}/members`, tutor), 403, 'permission_denied');
      refusedWith(await get(`/api/groups/${UNKNOWN}/members`), 404, 'not_found');
      // Another branch's group: 404 with the header of the north, also for the Super Admin.
      const southClass = await schoolClass(7, t.south, southYear);
      const southGroup = await group([southClass], { branch: t.south, year: southYear });
      for (const cookie of [t.vicePrincipal, t.admin]) {
        refusedWith(await get(`/api/groups/${southGroup}/members`, cookie), 404, 'not_found');
      }
    });

    // Task 3.6a, owner's answer L147: groups on every row for every reader
    // (was the rows of own class only, decision 4 of pull request #92).
    it('shows a Tutor the groups of every row of the student list', async () => {
      const other = await schoolClass();
      const own = tutorPupils[1];
      const foreign = await pupil(other);
      const across = await group([tutorClass, other]);
      placed(await place(across, [own, foreign], '2026-10-10'));
      const list = studentListSchema.parse((await get('/api/people/students', tutor)).body);
      expect(list.students.find((row) => row.id === own.id)?.groups.map((one) => one.id)).toEqual([
        across,
      ]);
      const foreignRow = list.students.find((row) => row.id === foreign.id);
      expect(foreignRow?.opens).toBe(false);
      expect(foreignRow?.groups.map((one) => one.id)).toEqual([across]);
    });
  });

  describe('the withdraw of a planned placement and "Mark reviewed"', () => {
    it('withdraws a planned placement for good and refuses one in force', async () => {
      const oxford = await schoolClass();
      const later = await pupil(oxford);
      const now = await pupil(oxford);
      const maths1 = await group([oxford]);
      const tab = placed(await place(maths1, [later], '2026-10-12'));
      placed(await place(maths1, [now], '2026-10-10'));
      const planned = tab.members[0];
      const response = await post(`/api/groups/${maths1}/members/${planned?.id ?? ''}/withdraw`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await rowsOfStudent(later.id)).toEqual([
        expect.objectContaining({ valid_until: '2026-10-12', ended_by: 'withdrawn' }),
      ]);
      const [entry] = await t.entries('student.group_withdrawn', later.id);
      expect(entry).toMatchObject({
        assignment_id: t.viceAssignment,
        request_id: response.headers['x-request-id'],
        new_value: { until: '2026-10-12', endedBy: 'withdrawn' },
      });
      // Answered as it is when repeated.
      const again = await post(`/api/groups/${maths1}/members/${planned?.id ?? ''}/withdraw`);
      expect(again.status).toBe(200);
      const inForce = (await membersOf(maths1)).members.find((one) => one.studentId === now.id);
      refusedWith(
        await post(`/api/groups/${maths1}/members/${inForce?.id ?? ''}/withdraw`),
        409,
        'group_membership_in_force',
      );
    });

    it('answers 404 for a member of another group, of another branch or unknown', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const maths1 = await group([oxford]);
      const maths2 = await group([oxford], { subject: english });
      const tab = placed(await place(maths1, [one], '2026-10-12'));
      const member = tab.members[0]?.id ?? '';
      const southClass = await schoolClass(7, t.south, southYear);
      const southGroup = await group([southClass], { branch: t.south, year: southYear });
      const before = await rowsOf();
      for (const action of ['withdraw', 'reviewed']) {
        refusedWith(
          await post(`/api/groups/${maths2}/members/${member}/${action}`),
          404,
          'not_found',
        );
        refusedWith(
          await post(`/api/groups/${maths1}/members/${UNKNOWN}/${action}`),
          404,
          'not_found',
        );
        refusedWith(
          await post(`/api/groups/${maths1}/members/${member}/${action}`, {}, t.admin, t.south),
          404,
          'not_found',
        );
      }
      // The group of the path unknown or of another branch.
      for (const action of ['withdraw', 'reviewed']) {
        for (const path of [UNKNOWN, southGroup]) {
          refusedWith(
            await post(`/api/groups/${path}/members/${member}/${action}`, {}, t.admin),
            404,
            'not_found',
          );
        }
      }
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('more refusals of the members routes', () => {
    it('answers an ended placement not planned, and a repeated "Mark reviewed" as it is', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const maths1 = await group([oxford]);
      // A row that ended before today, written as a leaving of 1 October would leave it.
      const leaving = await t.database.migrator.transaction().execute(async (transaction) => {
        await transaction
          .updateTable('student_statuses')
          .set({ valid_until: '2026-10-01' })
          .where('student_id', '=', one.id)
          .execute();
        const row = await transaction
          .insertInto('student_statuses')
          .values({
            student_id: one.id,
            branch_id: t.north,
            status: 'inactive',
            valid_from: '2026-10-01',
            cause: 'leaving',
            reason: 'The family moved.',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: '2026-10-01', ended_by: 'leaving', leaving_id: row.id })
          .where('student_id', '=', one.id)
          .execute();
        return row.id;
      });
      const ended = await t.database.migrator
        .insertInto('group_memberships')
        .values({
          branch_id: t.north,
          student_id: one.id,
          group_id: maths1,
          subject_id: maths,
          valid_from: '2026-09-02',
          valid_until: '2026-10-01',
          own_until: '2027-06-01',
          cause: 'automatic',
          review: true,
          ended_by: 'leaving',
          leaving_id: leaving,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      refusedWith(
        await post(`/api/groups/${maths1}/members/${ended.id}/withdraw`),
        409,
        'group_membership_not_planned',
      );
      const first = await post(`/api/groups/${maths1}/members/${ended.id}/reviewed`);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const before = await t.auditCount();
      const again = await post(`/api/groups/${maths1}/members/${ended.id}/reviewed`);
      expect(again.status).toBe(200);
      expect(await t.auditCount()).toBe(before);
    });

    it('answers a planned row a leaving emptied as it is, keeping its cause', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const maths1 = await group([oxford]);
      placed(await place(maths1, [one], '2026-11-16'));
      const fresh = studentDetailSchema.parse((await get(`/api/people/students/${one.id}`)).body);
      const left = await post(`/api/people/students/${one.id}/leaving`, {
        lastDay: '2026-10-31',
        reason: 'The family moved.',
        version: fresh.version,
      });
      expect(left.status).toBe(200);
      const row = await t.database.migrator
        .selectFrom('group_memberships')
        .select('id')
        .where('student_id', '=', one.id)
        .executeTakeFirstOrThrow();
      const response = await post(`/api/groups/${maths1}/members/${row.id}/withdraw`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await rowsOfStudent(one.id)).toEqual([
        expect.objectContaining({ valid_until: '2026-11-16', ended_by: 'leaving' }),
      ]);
    });

    it('refuses a group of a closed year, on a placement and on a run', async () => {
      const branch = await t.newBranch();
      const oldYear = await classes.year(branch, 'planned', '2025-09-01', '2026-05-31');
      const oldClass = await schoolClass(7, branch, oldYear);
      const oldGroup = await group([oldClass], { branch, year: oldYear });
      await classes.setYear(oldYear, 'current');
      await classes.setYear(oldYear, 'closed');
      await classes.year(branch, 'current', '2026-09-01', '2027-05-31');
      const created = await t.postStudent(branch, body({ startsOn: '2026-09-02' }), t.admin);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const one = studentDetailSchema.parse(created.body);
      const before = await rowsOf();
      refusedWith(
        await place(oldGroup, [one], '2026-01-12', t.admin, branch),
        409,
        'group_year_closed',
      );
      refusedWith(
        await t.post(
          '/api/groups/placement/automatic',
          branch,
          { subjectId: maths, grades: [7], from: '2026-01-12' },
          t.admin,
        ),
        409,
        'group_year_closed',
      );
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('the bulk placement screen and "Place automatically" (decisions 12 to 14)', () => {
    it('lists the groups of the screen’s grades and the students not yet placed', async () => {
      const subject = await classes.subject({ grades: [9, 10] });
      const nine = await schoolClass(9);
      const ten = await schoolClass(10);
      const placedLater = await pupil(nine, { grade: 9 });
      const waiting = await pupil(nine, { grade: 9 });
      const pair = await group([nine, ten], { subject, name: 'P-910' });
      const ninth = await group([nine], { subject, name: 'P-9' });
      placed(await place(ninth, [placedLater], '2026-11-02'));
      const onNine = groupPlacementBoardSchema.parse((await board(subject, '9')).body);
      expect(onNine.groups.map((one) => one.id)).toEqual([ninth]);
      // A student placed from a later date is placed (decision 10).
      expect(onNine.unplaced.map((one) => one.id)).toEqual([waiting.id]);
      const onPair = groupPlacementBoardSchema.parse((await board(subject, '9,10')).body);
      expect(onPair.groups.map((one) => one.id).sort()).toEqual([pair, ninth].sort());
      refusedWith(await board(UNKNOWN, '9'), 404, 'not_found');
      for (const cookie of [t.principal, headTeacher, tutor]) {
        refusedWith(await board(subject, '9', '2026-10-12', cookie), 403, 'permission_denied');
      }
    });

    it('places every student into the smallest suitable group, tagged for review', async () => {
      const subject = await classes.subject({ grades: [8] });
      const oxford = await schoolClass(8);
      const yale = await schoolClass(8);
      const students = [
        await pupil(oxford, { grade: 8 }),
        await pupil(oxford, { grade: 8 }),
        await pupil(yale, { grade: 8 }),
      ];
      const alpha = await group([oxford, yale], { subject, name: 'A-8' });
      const beta = await group([oxford], { subject, name: 'B-8' });
      const response = await automatic(subject, [8]);
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const result = automaticPlacementResultSchema.parse(response.body);
      expect(result.placed).toHaveLength(3);
      // The Yale student fits only A-8; the two of Oxford share out by size, ties by name.
      const of = (id: string) => result.placed.find((one) => one.studentId === id)?.groupId;
      expect(of(students[2]?.id ?? '')).toBe(alpha);
      const oxfordGroups = [of(students[0]?.id ?? ''), of(students[1]?.id ?? '')];
      expect(oxfordGroups.sort()).toEqual([alpha, beta].sort());
      for (const one of students) {
        expect(await rowsOfStudent(one.id)).toEqual([
          expect.objectContaining({ cause: 'automatic', review: true }),
        ]);
        expect((await t.entries('student.group_joined', one.id))[0]).toMatchObject({
          assignment_id: t.viceAssignment,
          request_id: response.headers['x-request-id'],
          new_value: { cause: 'automatic', review: true },
        });
      }
      const tab = await membersOf(beta);
      expect(tab.members[0]?.review).toBe(true);
      const reviewed = await post(
        `/api/groups/${beta}/members/${tab.members[0]?.id ?? ''}/reviewed`,
      );
      expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
      expect(groupMembersSchema.parse(reviewed.body).members[0]?.review).toBe(false);
      const reviewEntries = await t.entries('student.group_reviewed', tab.members[0]?.studentId);
      expect(reviewEntries).toHaveLength(1);
      expect(reviewEntries[0]).toMatchObject({
        assignment_id: t.viceAssignment,
        request_id: reviewed.headers['x-request-id'],
        new_value: { review: false },
      });
      const empty = groupPlacementBoardSchema.parse((await board(subject, '8')).body);
      expect(empty.unplaced).toEqual([]);
    });

    it('breaks a tie of sizes by the name of the group, the students in the order of their names', async () => {
      const subject = await classes.subject({ grades: [8] });
      const oxford = await schoolClass(8);
      const first = await pupil(oxford, { grade: 8, lastName: 'Aminova' });
      const second = await pupil(oxford, { grade: 8, lastName: 'Botirova' });
      // Created B first, so that the id would put it first: the name decides.
      const later = await group([oxford], { subject, name: 'Z-8' });
      const earlier = await group([oxford], { subject, name: 'Y-8' });
      const response = await automatic(subject, [8]);
      expect(automaticPlacementResultSchema.parse(response.body).placed).toEqual([
        { studentId: first.id, groupId: earlier },
        { studentId: second.id, groupId: later },
      ]);
    });

    it('answers 404 for an unknown subject of a run, changing nothing', async () => {
      const before = await rowsOf();
      refusedWith(await automatic(UNKNOWN, [7]), 404, 'not_found');
      expect(await rowsOf()).toEqual(before);
    });

    it('places none when a student finds no seat, and names them', async () => {
      const subject = await classes.subject({ grades: [8] });
      const oxford = await schoolClass(8);
      const students = [await pupil(oxford, { grade: 8 }), await pupil(oxford, { grade: 8 })];
      await group([oxford], { subject, size: 1 });
      const before = await rowsOf();
      const response = await automatic(subject, [8]);
      refusedWith(response, 409, 'placement_no_seat');
      expect(detailsOf(response)).toHaveLength(1);
      expect(students.map((one) => one.id)).toContain(detailsOf(response)[0]?.recordId);
      expect(await rowsOf()).toEqual(before);
    });

    it('uses only the screen’s groups: a grade 9 run leaves a 9 and 10 group alone (correction 1)', async () => {
      const subject = await classes.subject({ grades: [9, 10] });
      const nine = await schoolClass(9);
      const ten = await schoolClass(10);
      const one = await pupil(nine, { grade: 9 });
      const pair = await group([nine, ten], { subject });
      const refused = await automatic(subject, [9]);
      // The grade 9 screen shows no group: the student is not on it.
      expect(automaticPlacementResultSchema.parse(refused.body).placed).toEqual([]);
      const run = await automatic(subject, [9, 10]);
      expect(automaticPlacementResultSchema.parse(run.body).placed).toEqual([
        { studentId: one.id, groupId: pair },
      ]);
    });
  });

  describe('the group rows follow the class rows (decisions 8 and 9)', () => {
    it('cuts the group rows at a leaving and withdraws a planned one, named in the entry', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const maths1 = await group([oxford]);
      const englishGroup = await group([oxford], { subject: english });
      placed(await place(maths1, [one], '2026-10-10'));
      placed(await place(englishGroup, [one], '2026-11-16'));
      const fresh = studentDetailSchema.parse((await get(`/api/people/students/${one.id}`)).body);
      const left = await post(`/api/people/students/${one.id}/leaving`, {
        lastDay: '2026-10-31',
        reason: 'The family moved.',
        version: fresh.version,
      });
      expect(left.status, JSON.stringify(left.body)).toBe(200);
      expect(await rowsOfStudent(one.id)).toEqual([
        expect.objectContaining({
          group_id: maths1,
          valid_until: '2026-11-01',
          ended_by: 'leaving',
        }),
        expect.objectContaining({
          group_id: englishGroup,
          valid_from: '2026-11-16',
          valid_until: '2026-11-16',
          ended_by: 'leaving',
        }),
      ]);
      const [entry] = await t.entries('student.leave', one.id);
      expect(entry?.new_value).toMatchObject({
        groupMemberships: {
          cut: [
            { groupId: maths1, until: '2026-11-01', endedBy: 'leaving' },
            { groupId: englishGroup, until: '2026-11-16', endedBy: 'leaving' },
          ],
        },
      });
      // Task 3.2c (decision 6 of pull request #93; the requirement changed from
      // decision 9 of 3.2b): a cancel gives back the group rows the leaving cut,
      // and the days before the planned English row get the smallest group.
      const after = studentDetailSchema.parse(left.body);
      const cancelled = await post(`/api/people/students/${one.id}/leaving/cancel`, {
        version: after.version,
      });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      expect(
        (await rowsOfStudent(one.id)).map((row) => [
          row.group_id,
          row.valid_from,
          row.valid_until,
          row.cause,
        ]),
      ).toEqual([
        // One stay per group (task 3.5c, H36): the maths row grows back; the
        // English days from the first day taken back are one automatic row
        // that runs on through the planned row's days, which stays emptied.
        [maths1, '2026-10-10', '2027-06-01', 'placement'],
        [englishGroup, '2026-11-01', '2027-06-01', 'automatic'],
        [englishGroup, '2026-11-16', '2026-11-16', 'placement'],
      ]);
    });

    it('names the new leaving on the group rows of a scheduled leaving replaced by an earlier date', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const maths1 = await group([oxford]);
      placed(await place(maths1, [one], '2026-12-20'));
      const leave = async (lastDay: string) => {
        const fresh = studentDetailSchema.parse((await get(`/api/people/students/${one.id}`)).body);
        const response = await post(`/api/people/students/${one.id}/leaving`, {
          lastDay,
          reason: 'The family moved.',
          version: fresh.version,
        });
        expect(response.status, JSON.stringify(response.body)).toBe(200);
      };
      const leavingOf = async (from: string) =>
        (
          await t.database.migrator
            .selectFrom('student_statuses')
            .select('id')
            .where('student_id', '=', one.id)
            .where('status', '=', 'inactive')
            .where('valid_from', '=', from)
            .executeTakeFirstOrThrow()
        ).id;
      await leave('2026-12-14');
      const rowOf = () =>
        t.database.migrator
          .selectFrom('group_memberships')
          .select(['valid_from', 'valid_until', 'ended_by', 'leaving_id'])
          .where('student_id', '=', one.id)
          .executeTakeFirstOrThrow();
      expect(await rowOf()).toMatchObject({
        valid_until: '2026-12-20',
        ended_by: 'leaving',
        leaving_id: await leavingOf('2026-12-15'),
      });
      // The replace by 30 November: the withdrawn row is the new leaving's (decision 9).
      await leave('2026-11-30');
      expect(await rowOf()).toMatchObject({
        valid_until: '2026-12-20',
        ended_by: 'leaving',
        leaving_id: await leavingOf('2026-12-01'),
      });
    });

    it('withdraws the group rows of a planned class placement withdrawn', async () => {
      const oxford = await schoolClass();
      const later = await pupil(oxford, { startsOn: '2026-10-12' });
      const maths1 = await group([oxford]);
      placed(await place(maths1, [later], '2026-10-12'));
      const classTab = (await get(`/api/classes/${oxford}/members`)).body as {
        members: { id: string; studentId: string }[];
      };
      const classRow = classTab.members.find((one) => one.studentId === later.id);
      const response = await post(`/api/classes/${oxford}/members/${classRow?.id ?? ''}/withdraw`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await rowsOfStudent(later.id)).toEqual([
        expect.objectContaining({ valid_until: '2026-10-12', ended_by: 'class_withdrawn' }),
      ]);
      const [entry] = await t.entries('student.class_withdrawn', later.id);
      expect(entry?.new_value).toMatchObject({
        groupMemberships: [{ groupId: maths1, endedBy: 'class_withdrawn' }],
      });
    });

    it('keeps the group rows of a student deleted as created twice in the delete entry', async () => {
      const oxford = await schoolClass();
      const twice = await pupil(oxford, { startsOn: '2026-10-12' });
      const maths1 = await group([oxford]);
      placed(await place(maths1, [twice], '2026-10-12'));
      const fresh = studentDetailSchema.parse((await get(`/api/people/students/${twice.id}`)).body);
      const removed = await post(`/api/people/students/${twice.id}/delete`, {
        version: fresh.version,
        reason: 'Created twice by mistake.',
      });
      expect(removed.status, JSON.stringify(removed.body)).toBe(204);
      expect(await rowsOfStudent(twice.id)).toEqual([]);
      const [entry] = await t.entries('student.delete', twice.id);
      expect((entry?.old_value as { groupMemberships: unknown[] }).groupMemberships).toEqual([
        expect.objectContaining({ groupId: maths1, validFrom: '2026-10-12' }),
      ]);
    });
  });

  describe('the group’s side of its members (decision 16)', () => {
    it('refuses an archive with members, a maximum below them and a class whose students it holds', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const [one, two] = [await pupil(oxford), await pupil(oxford)];
      const maths1 = await group([oxford, yale], { size: 5 });
      placed(await place(maths1, [one, two], '2026-10-12'));
      const detail = (await get(`/api/groups/${maths1}`)).body as { version: number; name: string };
      const edit = (fields: object) =>
        t.put(
          `/api/groups/${maths1}`,
          t.north,
          {
            classIds: [oxford, yale],
            name: detail.name,
            language: null,
            maxSize: 5,
            version: detail.version,
            ...fields,
          },
          t.vicePrincipal,
        );
      refusedWith(await post(`/api/groups/${maths1}/archive`), 409, 'group_has_members');
      refusedWith(await edit({ maxSize: 1 }), 409, 'group_size_below_members');
      refusedWith(await edit({ classIds: [yale] }), 409, 'group_class_has_members');
      // A class whose students the group does not hold may go.
      const edited = await edit({ classIds: [oxford] });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    });
  });

  describe('at the same moment', () => {
    it('refuses the second of two placements into the last seat', async () => {
      const oxford = await schoolClass();
      const [one, two] = [await pupil(oxford), await pupil(oxford)];
      const small = await group([oxford], { size: 1 });
      const held = await holdOpen((transaction) =>
        writePlacement(transaction, [{ studentId: one.id, groupId: small }]),
      );
      const second = place(small, [two]).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await second, 409, 'group_full');
    });

    it('meets a lower maximum of a group edit on the group row, both directions', async () => {
      const oxford = await schoolClass();
      const [one, two] = [await pupil(oxford), await pupil(oxford)];
      const [three, four] = [await pupil(oxford), await pupil(oxford)];
      const small = await group([oxford], { size: 2 });
      placed(await place(small, [one]));
      // The edit first: the placement waits, then finds the group full.
      const edit = await holdOpen((transaction) =>
        writeGroupEdit(transaction, small, { maxSize: 1 }),
      );
      const placing = place(small, [two]).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
      edit.release();
      expect(await edit.done).toBeUndefined();
      refusedWith(await placing, 409, 'group_full');
      // The placement first: the edit route waits, then refuses the lower maximum.
      const roomy = await group([oxford], { size: 3 });
      placed(await place(roomy, [three]));
      const held = await holdOpen((transaction) =>
        writePlacement(transaction, [{ studentId: four.id, groupId: roomy }]),
      );
      const detail = (await get(`/api/groups/${roomy}`)).body as { version: number; name: string };
      const editing = t
        .put(
          `/api/groups/${roomy}`,
          t.north,
          {
            classIds: [oxford],
            name: detail.name,
            language: null,
            maxSize: 1,
            version: detail.version,
          },
          t.vicePrincipal,
        )
        .then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await editing, 409, 'group_size_below_members');
    });

    it('meets the removal of a class from the group, both directions', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(yale);
      const two = await pupil(yale);
      const maths1 = await group([oxford, yale]);
      // The removal first: the placement waits, then finds no class of the group.
      const removal = await holdOpen((transaction) =>
        writeGroupEdit(transaction, maths1, { removeClass: yale }),
      );
      const placing = place(maths1, [one]).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
      removal.release();
      expect(await removal.done).toBeUndefined();
      refusedWith(await placing, 409, 'student_not_in_group_class');
      // The placement first: the edit route waits, then refuses the removal.
      const across = await group([oxford, yale]);
      const held = await holdOpen((transaction) =>
        writePlacement(transaction, [{ studentId: two.id, groupId: across }]),
      );
      const detail = (await get(`/api/groups/${across}`)).body as { version: number; name: string };
      const editing = t
        .put(
          `/api/groups/${across}`,
          t.north,
          {
            classIds: [oxford],
            name: detail.name,
            language: null,
            maxSize: 20,
            version: detail.version,
          },
          t.vicePrincipal,
        )
        .then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await editing, 409, 'group_class_has_members');
    });

    it('meets the group archive, both directions', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const two = await pupil(oxford);
      const maths1 = await group([oxford]);
      const archive = await holdOpen((transaction) =>
        writeGroupEdit(transaction, maths1, { archive: true }),
      );
      const placing = place(maths1, [one]).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
      archive.release();
      expect(await archive.done).toBeUndefined();
      refusedWith(await placing, 409, 'group_archived');
      const other = await group([oxford]);
      const held = await holdOpen((transaction) =>
        writePlacement(transaction, [{ studentId: two.id, groupId: other }]),
      );
      const archiving = post(`/api/groups/${other}/archive`).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await archiving, 409, 'group_has_members');
    });

    it('meets a leaving of the student, both directions', async () => {
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const two = await pupil(oxford);
      const maths1 = await group([oxford]);
      // The placement first: the leaving route waits on the student, then cuts the new row too.
      const held = await holdOpen((transaction) =>
        writePlacement(transaction, [{ studentId: one.id, groupId: maths1 }]),
      );
      const leaving = post(`/api/people/students/${one.id}/leaving`, {
        lastDay: '2026-10-31',
        reason: 'The family moved.',
        version: one.version,
      }).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
      held.release();
      expect(await held.done).toBeUndefined();
      expect((await leaving).status, JSON.stringify((await leaving).body)).toBe(200);
      expect(await rowsOfStudent(one.id)).toEqual([
        expect.objectContaining({ valid_until: '2026-11-01', ended_by: 'leaving' }),
      ]);
      // The leaving first: the placement route waits on the student, then
      // places up to the leaving's first inactive day, cut by it.
      const left = await holdOpen((transaction) => writeLeaving(transaction, two.id, '2026-11-01'));
      const placing = place(maths1, [two]).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
      left.release();
      expect(await left.done).toBeUndefined();
      expect((await placing).status, JSON.stringify((await placing).body)).toBe(201);
      expect(await rowsOfStudent(two.id)).toEqual([
        expect.objectContaining({
          valid_from: '2026-10-12',
          valid_until: '2026-11-01',
          ended_by: 'leaving',
        }),
      ]);
    });

    it('meets the withdraw of the student’s planned class row', async () => {
      const oxford = await schoolClass();
      const later = await pupil(oxford, { startsOn: '2026-10-12' });
      const second = await pupil(oxford, { startsOn: '2026-10-12' });
      const maths1 = await group([oxford]);
      const classRow = await t.database.migrator
        .selectFrom('class_memberships')
        .select(['id', 'valid_from'])
        .where('student_id', '=', later.id)
        .executeTakeFirstOrThrow();
      // The withdraw first: the placement waits, then finds no class row.
      const withdraw = await holdOpen(async (transaction) => {
        await transaction
          .selectFrom('students')
          .select('id')
          .where('id', '=', later.id)
          .forUpdate()
          .execute();
        await transaction
          .updateTable('class_memberships')
          .set({ valid_until: classRow.valid_from, ended_by: 'withdrawn' })
          .where('id', '=', classRow.id)
          .execute();
      });
      const placing = place(maths1, [later]).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
      withdraw.release();
      expect(await withdraw.done).toBeUndefined();
      refusedWith(await placing, 409, 'student_not_in_group_class');
      // The placement first: the withdraw route waits, then withdraws both rows.
      const secondRow = await t.database.migrator
        .selectFrom('class_memberships')
        .select('id')
        .where('student_id', '=', second.id)
        .executeTakeFirstOrThrow();
      const held = await holdOpen((transaction) =>
        writePlacement(transaction, [{ studentId: second.id, groupId: maths1 }]),
      );
      const withdrawing = post(`/api/classes/${oxford}/members/${secondRow.id}/withdraw`).then(
        (response) => response,
      );
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
      held.release();
      expect(await held.done).toBeUndefined();
      expect((await withdrawing).status).toBe(200);
      expect(await rowsOfStudent(second.id)).toEqual([
        expect.objectContaining({ ended_by: 'class_withdrawn' }),
      ]);
    });

    /** Two groups of grades 9 and 10 with a seat each, a student of each grade not yet placed. */
    async function sharedGroups(size = 1) {
      const subject = await classes.subject({ grades: [9, 10] });
      const nine = await schoolClass(9);
      const ten = await schoolClass(10);
      const ninth = await pupil(nine, { grade: 9 });
      const tenth = await pupil(ten, { grade: 10 });
      const first = await group([nine, ten], { subject, size });
      const second = await group([nine, ten], { subject, size });
      return { subject, first, second, ninth, tenth };
    }

    /** The writes of a placement into a group of another subject than maths, as the routes make them. */
    async function writeInto(
      transaction: Transaction,
      subject: string,
      studentId: string,
      groupIds: readonly string[],
      into: string,
      cause: 'placement' | 'automatic',
    ): Promise<void> {
      await transaction
        .selectFrom('students')
        .select('id')
        .where('id', '=', studentId)
        .forUpdate()
        .execute();
      await transaction
        .selectFrom('groups')
        .select('id')
        .where('id', 'in', [...groupIds].sort())
        .orderBy('id')
        .forUpdate()
        .execute();
      await transaction
        .insertInto('group_memberships')
        .values({
          branch_id: t.north,
          student_id: studentId,
          group_id: into,
          subject_id: subject,
          valid_from: '2026-10-12',
          valid_until: '2027-06-01',
          own_until: '2027-06-01',
          cause,
          review: cause === 'automatic',
        })
        .execute();
    }

    it('lets an automatic run wait for a placement into the last seat and take the other group', async () => {
      const { subject, first, second, ninth, tenth } = await sharedGroups();
      const held = await holdOpen((transaction) =>
        writeInto(transaction, subject, tenth.id, [first], first, 'placement'),
      );
      const run = automatic(subject, [9, 10]).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
      held.release();
      expect(await held.done).toBeUndefined();
      const result = await run;
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      expect(automaticPlacementResultSchema.parse(result.body).placed).toEqual([
        { studentId: ninth.id, groupId: second },
      ]);
    });

    it('refuses a placement into the last seat an automatic run took first', async () => {
      const { subject, first, second, ninth, tenth } = await sharedGroups();
      const held = await holdOpen((transaction) =>
        writeInto(transaction, subject, ninth.id, [first, second], first, 'automatic'),
      );
      const placing = place(first, [tenth]).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await placing, 409, 'group_full');
    });

    it('orders two automatic runs on shared groups: the second places only who is left', async () => {
      const { subject, first, second, ninth, tenth } = await sharedGroups(5);
      // The first run holds the ninth grader and both groups.
      const held = await holdOpen((transaction) =>
        writeInto(transaction, subject, ninth.id, [first, second], first, 'automatic'),
      );
      const run = automatic(subject, [9, 10]).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
      held.release();
      expect(await held.done).toBeUndefined();
      const result = await run;
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      // Read again under the locks: the ninth grader is placed; the other goes to the smaller group.
      expect(automaticPlacementResultSchema.parse(result.body).placed).toEqual([
        { studentId: tenth.id, groupId: second },
      ]);
    });

    it('lets an automatic run see a leaving that came first', async () => {
      const subject = await classes.subject({ grades: [9] });
      const nine = await schoolClass(9);
      const leaver = await pupil(nine, { grade: 9 });
      const stays = await pupil(nine, { grade: 9 });
      const other = await pupil(nine, { grade: 9 });
      const waiting = await pupil(nine, { grade: 9 });
      const g1 = await group([nine], { subject, name: 'L-1' });
      const g2 = await group([nine], { subject, name: 'L-2' });
      placed(await place(g1, [leaver, stays], '2026-10-10'));
      placed(await place(g2, [other], '2026-10-10'));
      // Without the leaving L-1 holds two and L-2 one; from 12 October L-1 holds one.
      const left = await holdOpen((transaction) =>
        writeLeaving(transaction, leaver.id, '2026-10-12'),
      );
      const run = automatic(subject, [9]).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
      left.release();
      expect(await left.done).toBeUndefined();
      const result = await run;
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      // A tie on the date, broken by name: L-1.
      expect(automaticPlacementResultSchema.parse(result.body).placed).toEqual([
        { studentId: waiting.id, groupId: g1 },
      ]);
    });
  });

  it('shows no group on the record of a student in none', async () => {
    const oxford = await schoolClass();
    const one: StudentDetail = await pupil(oxford);
    expect(one.groups).toEqual([]);
  });
});
