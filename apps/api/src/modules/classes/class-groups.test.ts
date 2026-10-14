import {
  apiErrorSchema,
  classPlacementResultSchema,
  groupMembersSchema,
  studentDetailSchema,
  type StudentDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { relativesInput } from '../../testing/relatives-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { groupPlacementGaps } from './class-groups.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const detailsOf = (response: Response) => apiErrorSchema.parse(response.body).error.details ?? [];

// All names are invented. docs/spec/edge-cases/students-classes-groups.md,
// first row: "A class membership cannot be saved without a group for every
// split or group subject of that class, from the same date. Bulk placement
// puts students into the smallest suitable group and tags them \"placed
// automatically, review\""; "A class is full ... Groups work the same way";
// docs/spec/05-classes-groups-subjects.md, Group; task 3.2c, pull request #93
// with corrections 1 and 2 of its review. Every path that writes a class row:
// "Put into a class", the create of a student with a class, the cancel and
// the undo of a leaving and the replace of a scheduled leaving. The clock
// stands at 23:55 on Saturday 10 October 2026 in Tashkent.
describe('groups on every class membership path', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let year: string;
  let headTeacher: string;
  let headSubject: string;
  let tutor: string;
  let count = 0;

  const FROM = new Date('2026-09-01T00:00:00+05:00');

  const get = (path: string, cookie = t.vicePrincipal) => t.get(path, t.north, cookie);
  const post = (path: string, body: object = {}, cookie = t.vicePrincipal) =>
    t.post(path, t.north, body, cookie);

  /** A new student's body: grade 7, from 2 September, in the class named or none. */
  function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    count += 1;
    return {
      uid: String(2607800 + count),
      confirmUidSet: true,
      firstName: 'Shahnoza',
      lastName: `Yusupova${'c'.repeat(count % 9)}${String.fromCharCode(97 + (count % 26))}`,
      paternalName: null,
      sex: 'female',
      birthDate: `2013-03-${String((count % 28) + 1).padStart(2, '0')}`,
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
      contract: { number: `CG-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives: relativesInput(),
      ...overrides,
    };
  }

  /** A student created by the route: in the class from 2 September, or with no class from 12 October. */
  async function pupil(classId: string | null, overrides: Record<string, unknown> = {}) {
    const response = await post(
      '/api/people/students',
      body(
        classId === null
          ? { classId: null, startsOn: '2026-10-12', ...overrides }
          : { classId, ...overrides },
      ),
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  const fresh = async (id: string): Promise<StudentDetail> =>
    studentDetailSchema.parse((await get(`/api/people/students/${id}`)).body);

  const schoolClass = () => classes.schoolClass(t.north, year, { grade: 7 });

  /** A subject of its own per test, so that no other test's groups take part. */
  const subject = () => classes.subject({ grades: [7] });

  const group = (subjectId: string, classIds: readonly string[], size = 20, name?: string) =>
    classes.group(t.north, year, subjectId, classIds, {
      size,
      ...(name === undefined ? {} : { name: `${name}-${String((count += 1))}` }),
    });

  const putIntoClass = (
    classId: string,
    students: readonly StudentDetail[],
    from = '2026-10-12',
    cookie = t.vicePrincipal,
  ) =>
    post(
      `/api/classes/${classId}/members`,
      { students: students.map((one) => ({ id: one.id, version: one.version })), from },
      cookie,
    );

  const placeInGroup = async (
    groupId: string,
    students: readonly { id: string }[],
    from: string,
  ) => {
    const response = await post(`/api/groups/${groupId}/members`, {
      students: students.map((one) => ({ id: one.id })),
      from,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
  };

  const leave = async (id: string, lastDay: string) => {
    const response = await post(`/api/people/students/${id}/leaving`, {
      lastDay,
      reason: 'The family moved.',
      version: (await fresh(id)).version,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  };

  const cancel = async (id: string) =>
    post(`/api/people/students/${id}/leaving/cancel`, { version: (await fresh(id)).version });

  const undo = async (id: string) =>
    post(`/api/people/students/${id}/leaving/undo`, {
      reason: 'Entered by mistake.',
      version: (await fresh(id)).version,
    });

  const rowsOfStudent = (id: string) =>
    t.database.migrator
      .selectFrom('group_memberships')
      .select(['group_id', 'valid_from', 'valid_until', 'own_until', 'ended_by', 'cause', 'review'])
      .where('student_id', '=', id)
      .orderBy('valid_from')
      .orderBy('id')
      .execute();

  /** Every row of the tables the class paths write, in both branches, and the log. */
  const rowsOf = () =>
    Promise.all([
      t.database.migrator.selectFrom('group_memberships').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('class_memberships').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_statuses').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('students').select('id').orderBy('id').execute(),
      t.auditCount(),
    ]);

  const archiveGroup = (groupId: string) =>
    t.database.migrator
      .updateTable('groups')
      .set({ archived_at: new Date('2026-10-10T12:00:00+05:00') })
      .where('id', '=', groupId)
      .execute();

  /** A signed-in account with a role in the North branch. */
  async function signedIn(first: string, last: string, role: string) {
    const browser = await t.kit.completeSession(first, last);
    const given = await t.kit.giveRole(browser.account.id, {
      role: role as never,
      branchId: t.north,
      ...(role === 'tutor' ? { validFrom: FROM } : {}),
      ...(role === 'head_teacher' ? { subjectIds: [headSubject] } : {}),
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

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
    year = await classes.year(t.north);
    headSubject = await classes.subject({ grades: [7] });
    headTeacher = (await signedIn('Rustam', 'Aliyev', 'head_teacher')).cookie;
    tutor = (await signedIn('Zarina', 'Qodirova', 'tutor')).cookie;
  });

  afterAll(async () => {
    await t.close();
  });

  describe('"Put into a class"', () => {
    it('places each student into the smallest group of every split or group subject, from the date, tagged', async () => {
      const maths = await subject();
      const english = await subject();
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const already = await pupil(oxford);
      const crowded = await group(maths, [oxford], 20, 'M-A');
      const small = await group(maths, [oxford], 20, 'M-B');
      const across = await group(english, [oxford, yale], 20, 'E-1');
      await placeInGroup(crowded, [already], '2026-10-12');
      const one = await pupil(null);
      const response = await putIntoClass(oxford, [one], '2026-10-12');
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const answer = classPlacementResultSchema.parse(response.body);
      expect(answer.groupsPlaced).toEqual(
        expect.arrayContaining([
          { studentId: one.id, groupId: small, subjectId: maths },
          { studentId: one.id, groupId: across, subjectId: english },
        ]),
      );
      expect(answer.groupsPlaced).toHaveLength(2);
      const rows = await rowsOfStudent(one.id);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row).toMatchObject({
          valid_from: '2026-10-12',
          valid_until: '2027-06-01',
          own_until: '2027-06-01',
          ended_by: null,
          cause: 'automatic',
          review: true,
        });
      }
      expect(rows.map((row) => row.group_id).sort()).toEqual([small, across].sort());
      const entries = await t.entries('student.group_joined', one.id);
      expect(entries).toHaveLength(2);
      for (const entry of entries) {
        expect(entry).toMatchObject({
          assignment_id: t.viceAssignment,
          request_id: response.headers['x-request-id'],
          new_value: { from: '2026-10-12', cause: 'automatic', review: true },
        });
      }
      // The record shows the groups with the tag.
      expect((await fresh(one.id)).groups.map((one) => one.review)).toEqual([true, true]);
    });

    it('breaks a tie of sizes by the name of the group', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      await group(maths, [oxford], 20, 'Z-1');
      const first = await group(maths, [oxford], 20, 'A-1');
      const one = await pupil(null);
      expect((await putIntoClass(oxford, [one])).status).toBe(201);
      expect((await rowsOfStudent(one.id)).map((row) => row.group_id)).toEqual([first]);
    });

    it('places a planned join from its own date, and cuts the rows at a scheduled leaving', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      await group(maths, [oxford]);
      const one = await pupil(null);
      await leave(one.id, '2026-12-31');
      const response = await putIntoClass(oxford, [await fresh(one.id)], '2026-11-02');
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(await rowsOfStudent(one.id)).toEqual([
        expect.objectContaining({
          valid_from: '2026-11-02',
          valid_until: '2027-01-01',
          own_until: '2027-06-01',
          ended_by: 'leaving',
          cause: 'automatic',
        }),
      ]);
    });

    it('refuses all or none when a subject has no group with a free seat, naming each student and subject', async () => {
      const maths = await subject();
      const english = await subject();
      const oxford = await schoolClass();
      const already = await pupil(oxford);
      const full = await group(maths, [oxford], 1);
      await group(english, [oxford], 20);
      await placeInGroup(full, [already], '2026-10-12');
      const [one, two] = [await pupil(null), await pupil(null)];
      const before = await rowsOf();
      const response = await putIntoClass(oxford, [one, two]);
      refusedWith(response, 409, 'class_group_no_seat');
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({ path: 'students.0', recordId: one.id, subjectId: maths }),
        expect.objectContaining({ path: 'students.1', recordId: two.id, subjectId: maths }),
      ]);
      expect(await rowsOf()).toEqual(before);
    });

    it('counts the seats the same request gives: the second student goes to the other group', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const a = await group(maths, [oxford], 1, 'A-1');
      const b = await group(maths, [oxford], 1, 'B-1');
      const [one, two] = [await pupil(null), await pupil(null)];
      expect((await putIntoClass(oxford, [one, two])).status).toBe(201);
      const groups = [
        ...(await rowsOfStudent(one.id)).map((row) => row.group_id),
        ...(await rowsOfStudent(two.id)).map((row) => row.group_id),
      ].sort();
      expect(groups).toEqual([a, b].sort());
    });

    it('refuses every role that does not edit classes, with nothing written', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      await group(maths, [oxford]);
      const one = await pupil(null);
      const before = await rowsOf();
      for (const cookie of [t.principal, headTeacher, tutor, t.teacher]) {
        refusedWith(
          await putIntoClass(oxford, [one], '2026-10-12', cookie),
          403,
          'permission_denied',
        );
      }
      expect(await rowsOf()).toEqual(before);
    });

    it('lets the withdraw of an automatic planned group row leave the student not yet placed', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const maths1 = await group(maths, [oxford]);
      const one = await pupil(null);
      expect((await putIntoClass(oxford, [one], '2026-10-20')).status).toBe(201);
      const tab = groupMembersSchema.parse((await get(`/api/groups/${maths1}/members`)).body);
      const member = tab.members.find((row) => row.studentId === one.id);
      expect(member?.review).toBe(true);
      const withdrawn = await post(`/api/groups/${maths1}/members/${member?.id ?? ''}/withdraw`);
      expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
      const gaps = await t.app
        .get(Transactions)
        .run([t.north], (transaction) =>
          groupPlacementGaps(transaction, [oxford], maths, '2026-10-12'),
        );
      expect(gaps).toEqual([
        expect.objectContaining({ studentId: one.id, firstDay: '2026-10-20' }),
      ]);
    });
  });

  describe('the create of a student with a class', () => {
    it('places the new student into the groups of the class from the start date, tagged', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const maths1 = await group(maths, [oxford]);
      const one = await pupil(oxford);
      expect(await rowsOfStudent(one.id)).toEqual([
        expect.objectContaining({
          group_id: maths1,
          valid_from: '2026-09-02',
          cause: 'automatic',
          review: true,
        }),
      ]);
      expect(one.groups).toEqual([expect.objectContaining({ id: maths1, review: true })]);
      expect(await t.entries('student.group_joined', one.id)).toHaveLength(1);
    });

    it('refuses the create on the class field when a group subject has no seat', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const already = await pupil(oxford);
      const full = await group(maths, [oxford], 1);
      await placeInGroup(full, [already], '2026-10-12');
      const before = await rowsOf();
      const response = await post(
        '/api/people/students',
        body({ classId: oxford, startsOn: '2026-10-12' }),
      );
      refusedWith(response, 409, 'class_group_no_seat');
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({ path: 'classId', subjectId: maths }),
      ]);
      expect(await rowsOf()).toEqual(before);
    });

    it('refuses every role that does not create students, with nothing written', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      await group(maths, [oxford]);
      const before = await rowsOf();
      for (const cookie of [t.principal, headTeacher, tutor, t.teacher]) {
        refusedWith(
          await post('/api/people/students', body({ classId: oxford }), cookie),
          403,
          'permission_denied',
        );
      }
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('a leaving taken back (decision 6)', () => {
    it('gives back on a cancel the group rows the leaving cut, with their tag, named in the entry', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const maths1 = await group(maths, [oxford]);
      const one = await pupil(oxford);
      await leave(one.id, '2026-10-31');
      const response = await cancel(one.id);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await rowsOfStudent(one.id)).toEqual([
        expect.objectContaining({
          group_id: maths1,
          valid_from: '2026-09-02',
          valid_until: '2026-11-01',
          ended_by: 'leaving',
          cause: 'automatic',
          review: true,
        }),
        expect.objectContaining({
          group_id: maths1,
          valid_from: '2026-11-01',
          valid_until: '2027-06-01',
          own_until: '2027-06-01',
          ended_by: null,
          cause: 'cancel',
          review: true,
        }),
      ]);
      const [entry] = await t.entries('student.leave_cancelled', one.id);
      expect(entry).toMatchObject({
        assignment_id: t.viceAssignment,
        request_id: response.headers['x-request-id'],
        new_value: {
          groupMemberships: {
            written: [
              {
                groupId: maths1,
                from: '2026-11-01',
                until: '2027-06-01',
                cause: 'cancel',
                review: true,
              },
            ],
          },
        },
      });
      // A row given back is no new automatic placement.
      expect(await t.entries('student.group_joined', one.id)).toHaveLength(1);
    });

    it('gives back on an undo, from the first inactive day', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await pupil(oxford);
      const maths1 = await group(maths, [oxford, yale]);
      await placeInGroup(maths1, [one], '2026-09-02');
      await leave(one.id, '2026-10-05');
      const response = await undo(one.id);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect((await rowsOfStudent(one.id)).slice(1)).toEqual([
        expect.objectContaining({
          group_id: maths1,
          valid_from: '2026-10-06',
          valid_until: '2027-06-01',
          cause: 'undo',
          review: false,
        }),
      ]);
    });

    it('puts the student into the smallest other group when the group the leaving cut was archived', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const gone = await group(maths, [oxford], 20, 'A-gone');
      const other = await group(maths, [oxford], 20, 'B-other');
      await placeInGroup(gone, [one], '2026-09-02');
      await leave(one.id, '2026-10-05');
      await archiveGroup(gone);
      const response = await undo(one.id);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect((await rowsOfStudent(one.id)).slice(1)).toEqual([
        expect.objectContaining({
          group_id: other,
          valid_from: '2026-10-06',
          cause: 'automatic',
          review: true,
        }),
      ]);
    });

    it('refuses an undo and a cancel when no group of a subject has a seat, changing nothing', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const two = await pupil(oxford);
      const blocker = await pupil(oxford);
      const gone = await group(maths, [oxford], 20, 'A-gone');
      const full = await group(maths, [oxford], 1, 'B-full');
      await placeInGroup(gone, [one], '2026-09-02');
      await leave(one.id, '2026-10-05');
      await archiveGroup(gone);
      await placeInGroup(full, [blocker], '2026-09-02');
      let before = await rowsOf();
      const undone = await undo(one.id);
      refusedWith(undone, 409, 'class_group_no_seat');
      expect(detailsOf(undone)).toEqual([
        expect.objectContaining({ recordId: one.id, subjectId: maths }),
      ]);
      expect(await rowsOf()).toEqual(before);
      // A cancel of a student who had no group of the subject before the leaving.
      await leave(two.id, '2026-10-31');
      before = await rowsOf();
      refusedWith(await cancel(two.id), 409, 'class_group_no_seat');
      expect(await rowsOf()).toEqual(before);
    });

    it('places on a cancel a student who had no group of the subject before the leaving (decision 3)', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const maths1 = await group(maths, [oxford]);
      await leave(one.id, '2026-10-31');
      expect((await cancel(one.id)).status).toBe(200);
      expect(await rowsOfStudent(one.id)).toEqual([
        expect.objectContaining({
          group_id: maths1,
          valid_from: '2026-11-01',
          cause: 'automatic',
          review: true,
        }),
      ]);
    });

    it('fills the days before a planned group row the leaving emptied, stopping where it begins', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const maths1 = await group(maths, [oxford]);
      await placeInGroup(maths1, [one], '2026-11-16');
      await leave(one.id, '2026-10-31');
      expect((await cancel(one.id)).status).toBe(200);
      expect(
        (await rowsOfStudent(one.id)).filter((row) => row.valid_from < row.valid_until),
      ).toEqual([
        expect.objectContaining({
          group_id: maths1,
          valid_from: '2026-11-01',
          valid_until: '2026-11-16',
          own_until: '2026-11-16',
          ended_by: null,
          cause: 'automatic',
        }),
        expect.objectContaining({
          group_id: maths1,
          valid_from: '2026-11-16',
          valid_until: '2027-06-01',
          cause: 'cancel',
          review: false,
        }),
      ]);
    });

    it('gives back up to a later scheduled leaving that replaces the first, cut by it', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const maths1 = await group(maths, [oxford]);
      const one = await pupil(oxford);
      await leave(one.id, '2026-10-31');
      await leave(one.id, '2026-11-30');
      expect((await rowsOfStudent(one.id)).slice(1)).toEqual([
        expect.objectContaining({
          group_id: maths1,
          valid_from: '2026-11-01',
          valid_until: '2026-12-01',
          own_until: '2027-06-01',
          ended_by: 'leaving',
          cause: 'cancel',
          review: true,
        }),
      ]);
    });

    it('never gives back overlapping rows: a leaving, its cancel, a second leaving and its cancel', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      await group(maths, [oxford]);
      const one = await pupil(oxford);
      await leave(one.id, '2026-10-31');
      expect((await cancel(one.id)).status).toBe(200);
      await leave(one.id, '2026-11-30');
      expect((await cancel(one.id)).status).toBe(200);
      const held = (await rowsOfStudent(one.id)).filter((row) => row.valid_from < row.valid_until);
      expect(held.map((row) => [row.valid_from, row.valid_until])).toEqual([
        ['2026-09-02', '2026-11-01'],
        ['2026-11-01', '2026-12-01'],
        ['2026-12-01', '2027-06-01'],
      ]);
    });

    it('gives back nothing when the class row is not given back: the class archived', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      const maths1 = await group(maths, [oxford]);
      await placeInGroup(maths1, [one], '2026-09-02');
      await leave(one.id, '2026-10-05');
      await archiveGroup(maths1);
      await t.database.migrator
        .updateTable('classes')
        .set({ archived_at: new Date('2026-10-10T12:00:00+05:00') })
        .where('id', '=', oxford)
        .execute();
      const response = await undo(one.id);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await rowsOfStudent(one.id)).toHaveLength(1);
    });

    it('refuses the leaving routes to every role that does not archive students, with nothing written', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      await group(maths, [oxford]);
      const one = await pupil(oxford);
      await leave(one.id, '2026-10-31');
      const before = await rowsOf();
      const version = (await fresh(one.id)).version;
      for (const cookie of [t.principal, headTeacher, tutor, t.teacher]) {
        refusedWith(
          await post(`/api/people/students/${one.id}/leaving/cancel`, { version }, cookie),
          403,
          'permission_denied',
        );
        refusedWith(
          await post(
            `/api/people/students/${one.id}/leaving/undo`,
            { version, reason: 'Entered by mistake.' },
            cookie,
          ),
          403,
          'permission_denied',
        );
        refusedWith(
          await post(
            `/api/people/students/${one.id}/leaving`,
            { version, lastDay: '2026-11-30', reason: 'The family moved.' },
            cookie,
          ),
          403,
          'permission_denied',
        );
      }
      expect(await rowsOf()).toEqual(before);
    });
  });

  // `.claude/rules/api.md`: each pair that meets on a row, both directions;
  // the held side writes what its route writes.
  describe('at the same moment', () => {
    /** The writes of a group placement, as the route makes them: the students, then the group. */
    async function writeGroupPlacement(
      transaction: Transaction,
      groupId: string,
      subjectId: string,
      studentId: string,
      from = '2026-10-12',
    ) {
      await transaction
        .selectFrom('students')
        .select('id')
        .where('id', '=', studentId)
        .forUpdate()
        .execute();
      await transaction
        .selectFrom('groups')
        .select('id')
        .where('id', '=', groupId)
        .forUpdate()
        .execute();
      await transaction
        .insertInto('group_memberships')
        .values({
          branch_id: t.north,
          student_id: studentId,
          group_id: groupId,
          subject_id: subjectId,
          valid_from: from,
          valid_until: '2027-06-01',
          own_until: '2027-06-01',
          cause: 'placement',
          review: false,
        })
        .execute();
    }

    /**
     * The writes of "Put into a class" (or the create's placement), as the
     * route makes them: the student, the class, the groups by id, the class
     * row, then the group row.
     */
    async function writeClassPlacement(
      transaction: Transaction,
      classId: string,
      studentId: string,
      groupId: string,
      subjectId: string,
      from = '2026-10-12',
    ) {
      await transaction
        .selectFrom('students')
        .select('id')
        .where('id', '=', studentId)
        .forUpdate()
        .execute();
      await transaction
        .selectFrom('classes')
        .select('id')
        .where('id', '=', classId)
        .forUpdate()
        .execute();
      await transaction
        .selectFrom('groups')
        .select('id')
        .where('id', '=', groupId)
        .forUpdate()
        .execute();
      await transaction
        .insertInto('class_memberships')
        .values({
          branch_id: t.north,
          student_id: studentId,
          class_id: classId,
          valid_from: from,
          valid_until: '2027-06-01',
          own_until: '2027-06-01',
          cause: 'placement',
        })
        .execute();
      await transaction
        .insertInto('group_memberships')
        .values({
          branch_id: t.north,
          student_id: studentId,
          group_id: groupId,
          subject_id: subjectId,
          valid_from: from,
          valid_until: '2027-06-01',
          own_until: '2027-06-01',
          cause: 'automatic',
          review: true,
        })
        .execute();
    }

    /** The writes of a group create, as the route makes them: its classes FOR SHARE, then the rows. */
    async function writeGroupCreate(
      transaction: Transaction,
      subjectId: string,
      classIds: readonly string[],
      name: string,
    ) {
      await transaction
        .selectFrom('classes')
        .select('id')
        .where('id', 'in', [...classIds].sort())
        .orderBy('id')
        .forShare()
        .execute();
      const row = await transaction
        .insertInto('groups')
        .values({
          branch_id: t.north,
          academic_year_id: year,
          subject_id: subjectId,
          name,
          language: 'uz',
          max_size: 20,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const classId of classIds) {
        await transaction
          .insertInto('group_classes')
          .values({ group_id: row.id, class_id: classId, branch_id: t.north })
          .execute();
      }
    }

    /** The writes of a group edit, as the route makes them: its classes (old and new) FOR SHARE, then the group. */
    async function writeGroupEdit(
      transaction: Transaction,
      groupId: string,
      classIds: readonly string[],
      change: { maxSize?: number; addClass?: string; archive?: boolean; restore?: boolean },
    ) {
      await transaction
        .selectFrom('classes')
        .select('id')
        .where('id', 'in', [...classIds].sort())
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
      if (change.restore === true) {
        await transaction
          .updateTable('groups')
          .set({ archived_at: null })
          .where('id', '=', groupId)
          .execute();
      }
      if (change.addClass !== undefined) {
        await transaction
          .insertInto('group_classes')
          .values({ group_id: groupId, class_id: change.addClass, branch_id: t.north })
          .execute();
      }
    }

    const waitForTheLock = () =>
      expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);

    it('meets a group placement into the last seat, both directions', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const other = await pupil(oxford);
      const last = await group(maths, [oxford], 1, 'A-last');
      // The group placement first: "Put into a class" waits, then finds no seat.
      const held = await holdOpen((transaction) =>
        writeGroupPlacement(transaction, last, maths, other.id),
      );
      const one = await pupil(null);
      const putting = putIntoClass(oxford, [one]).then((response) => response);
      await waitForTheLock();
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await putting, 409, 'class_group_no_seat');
      // "Put into a class" first: the group placement waits, then finds the group full.
      const maths2 = await subject();
      const yale = await schoolClass();
      const waiting = await pupil(yale);
      const seat = await group(maths2, [yale], 1, 'B-last');
      const two = await pupil(null);
      const holding = await holdOpen((transaction) =>
        writeClassPlacement(transaction, yale, two.id, seat, maths2),
      );
      const placing = post(`/api/groups/${seat}/members`, {
        students: [{ id: waiting.id }],
        from: '2026-10-12',
      }).then((response) => response);
      await waitForTheLock();
      holding.release();
      expect(await holding.done).toBeUndefined();
      refusedWith(await placing, 409, 'group_full');
    });

    it('refuses the second of two "Put into a class" into the last seat of a group', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const last = await group(maths, [oxford], 1);
      const [one, two] = [await pupil(null), await pupil(null)];
      const held = await holdOpen((transaction) =>
        writeClassPlacement(transaction, oxford, one.id, last, maths),
      );
      const putting = putIntoClass(oxford, [two]).then((response) => response);
      await waitForTheLock();
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await putting, 409, 'class_group_no_seat');
    });

    it('meets a group create that draws from the class, both directions', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      // The group create first: "Put into a class" waits on the class, then places into it.
      const held = await holdOpen((transaction) =>
        writeGroupCreate(transaction, maths, [oxford], 'G-first'),
      );
      const one = await pupil(null);
      const putting = putIntoClass(oxford, [one]).then((response) => response);
      await waitForTheLock();
      held.release();
      expect(await held.done).toBeUndefined();
      expect((await putting).status).toBe(201);
      expect(await rowsOfStudent(one.id)).toEqual([
        expect.objectContaining({ cause: 'automatic' }),
      ]);
      // "Put into a class" first: the group create route waits, then commits; the student is not yet placed.
      const maths2 = await subject();
      const yale = await schoolClass();
      const two = await pupil(null);
      const holding = await holdOpen(async (transaction) => {
        await transaction
          .selectFrom('students')
          .select('id')
          .where('id', '=', two.id)
          .forUpdate()
          .execute();
        await transaction
          .selectFrom('classes')
          .select('id')
          .where('id', '=', yale)
          .forUpdate()
          .execute();
        await transaction
          .insertInto('class_memberships')
          .values({
            branch_id: t.north,
            student_id: two.id,
            class_id: yale,
            valid_from: '2026-10-12',
            valid_until: '2027-06-01',
            own_until: '2027-06-01',
            cause: 'placement',
          })
          .execute();
      });
      const creating = post('/api/groups', {
        academicYearId: year,
        subjectId: maths2,
        classIds: [yale],
        name: 'G-second',
        language: null,
        maxSize: 20,
      }).then((response) => response);
      await waitForTheLock();
      holding.release();
      expect(await holding.done).toBeUndefined();
      expect((await creating).status, JSON.stringify((await creating).body)).toBe(201);
      const gaps = await t.app
        .get(Transactions)
        .run([t.north], (transaction) =>
          groupPlacementGaps(transaction, [yale], maths2, '2026-10-12'),
        );
      expect(gaps.map((one) => one.studentId)).toEqual([two.id]);
    });

    it('meets a group edit that adds the class, both directions', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const maths1 = await group(maths, [yale]);
      // The edit first: "Put into a class" waits, then places into the group.
      const held = await holdOpen((transaction) =>
        writeGroupEdit(transaction, maths1, [yale, oxford], { addClass: oxford }),
      );
      const one = await pupil(null);
      const putting = putIntoClass(oxford, [one]).then((response) => response);
      await waitForTheLock();
      held.release();
      expect(await held.done).toBeUndefined();
      expect((await putting).status).toBe(201);
      expect((await rowsOfStudent(one.id)).map((row) => row.group_id)).toEqual([maths1]);
      // "Put into a class" first (a class with no group yet): the edit route waits, then adds it.
      const maths2 = await subject();
      const harvard = await schoolClass();
      const cambridge = await schoolClass();
      const maths2Group = await group(maths2, [cambridge]);
      const two = await pupil(null);
      const holding = await holdOpen(async (transaction) => {
        await transaction
          .selectFrom('students')
          .select('id')
          .where('id', '=', two.id)
          .forUpdate()
          .execute();
        await transaction
          .selectFrom('classes')
          .select('id')
          .where('id', '=', harvard)
          .forUpdate()
          .execute();
        await transaction
          .insertInto('class_memberships')
          .values({
            branch_id: t.north,
            student_id: two.id,
            class_id: harvard,
            valid_from: '2026-10-12',
            valid_until: '2027-06-01',
            own_until: '2027-06-01',
            cause: 'placement',
          })
          .execute();
      });
      const detail = (await get(`/api/groups/${maths2Group}`)).body as {
        version: number;
        name: string;
      };
      const editing = t
        .put(
          `/api/groups/${maths2Group}`,
          t.north,
          {
            classIds: [cambridge, harvard],
            name: detail.name,
            language: null,
            maxSize: 20,
            version: detail.version,
          },
          t.vicePrincipal,
        )
        .then((response) => response);
      await waitForTheLock();
      holding.release();
      expect(await holding.done).toBeUndefined();
      expect((await editing).status, JSON.stringify((await editing).body)).toBe(200);
      expect(await rowsOfStudent(two.id)).toEqual([]);
    });

    it('meets a group archive and a restore, both directions', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const a = await group(maths, [oxford], 20, 'A-arch');
      const b = await group(maths, [oxford], 20, 'B-stay');
      // The archive first: "Put into a class" waits, then takes the other group.
      const held = await holdOpen((transaction) =>
        writeGroupEdit(transaction, a, [oxford], { archive: true }),
      );
      const one = await pupil(null);
      const putting = putIntoClass(oxford, [one]).then((response) => response);
      await waitForTheLock();
      held.release();
      expect(await held.done).toBeUndefined();
      expect((await putting).status).toBe(201);
      expect((await rowsOfStudent(one.id)).map((row) => row.group_id)).toEqual([b]);
      // "Put into a class" first: the archive route waits, then finds members.
      const two = await pupil(null);
      const holding = await holdOpen((transaction) =>
        writeClassPlacement(transaction, oxford, two.id, b, maths),
      );
      const archiving = post(`/api/groups/${b}/archive`).then((response) => response);
      await waitForTheLock();
      holding.release();
      expect(await holding.done).toBeUndefined();
      refusedWith(await archiving, 409, 'group_has_members');
      // A restore first: "Put into a class" waits, then sees the group again (the smaller one).
      const restoring = await holdOpen((transaction) =>
        writeGroupEdit(transaction, a, [oxford], { restore: true }),
      );
      const three = await pupil(null);
      const putting3 = putIntoClass(oxford, [three]).then((response) => response);
      await waitForTheLock();
      restoring.release();
      expect(await restoring.done).toBeUndefined();
      expect((await putting3).status).toBe(201);
      expect((await rowsOfStudent(three.id)).map((row) => row.group_id)).toEqual([a]);
      // "Put into a class" first: the restore route waits on the class, then restores.
      const maths3 = await subject();
      const yale = await schoolClass();
      const gone = await group(maths3, [yale], 20, 'A-gone');
      await archiveGroup(gone);
      const four = await pupil(null);
      const holding4 = await holdOpen(async (transaction) => {
        await transaction
          .selectFrom('students')
          .select('id')
          .where('id', '=', four.id)
          .forUpdate()
          .execute();
        await transaction
          .selectFrom('classes')
          .select('id')
          .where('id', '=', yale)
          .forUpdate()
          .execute();
        await transaction
          .insertInto('class_memberships')
          .values({
            branch_id: t.north,
            student_id: four.id,
            class_id: yale,
            valid_from: '2026-10-12',
            valid_until: '2027-06-01',
            own_until: '2027-06-01',
            cause: 'placement',
          })
          .execute();
      });
      const restoringRoute = post(`/api/groups/${gone}/restore`, {}).then((response) => response);
      await waitForTheLock();
      holding4.release();
      expect(await holding4.done).toBeUndefined();
      expect((await restoringRoute).status, JSON.stringify((await restoringRoute).body)).toBe(200);
      expect(await rowsOfStudent(four.id)).toEqual([]);
    });

    it('meets a lower group maximum, both directions', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const already = await pupil(oxford);
      const maths1 = await group(maths, [oxford], 2);
      await placeInGroup(maths1, [already], '2026-10-12');
      // The edit first: "Put into a class" waits, then finds no seat.
      const held = await holdOpen((transaction) =>
        writeGroupEdit(transaction, maths1, [oxford], { maxSize: 1 }),
      );
      const one = await pupil(null);
      const putting = putIntoClass(oxford, [one]).then((response) => response);
      await waitForTheLock();
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await putting, 409, 'class_group_no_seat');
      // "Put into a class" first: the edit route waits, then refuses the lower maximum.
      await t.database.migrator
        .updateTable('groups')
        .set({ max_size: 3 })
        .where('id', '=', maths1)
        .execute();
      const two = await pupil(null);
      const holding = await holdOpen((transaction) =>
        writeClassPlacement(transaction, oxford, two.id, maths1, maths),
      );
      const detail = (await get(`/api/groups/${maths1}`)).body as { version: number; name: string };
      const editing = t
        .put(
          `/api/groups/${maths1}`,
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
      await waitForTheLock();
      holding.release();
      expect(await holding.done).toBeUndefined();
      refusedWith(await editing, 409, 'group_size_below_members');
    });

    it('meets the create of a student with a class: a group create and the last seat, both directions', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      // A group create first: the create waits on the class, then places into it.
      const held = await holdOpen((transaction) =>
        writeGroupCreate(transaction, maths, [oxford], 'C-first'),
      );
      const creating = post('/api/people/students', body({ classId: oxford })).then(
        (response) => response,
      );
      await waitForTheLock();
      held.release();
      expect(await held.done).toBeUndefined();
      const created = await creating;
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(await rowsOfStudent(studentDetailSchema.parse(created.body).id)).toHaveLength(1);
      // The create first (its class row and group row): the group create route waits, then commits.
      const maths2 = await subject();
      const yale = await schoolClass();
      const seat = await group(maths2, [yale], 1);
      const one = await pupil(null);
      const holding = await holdOpen((transaction) =>
        writeClassPlacement(transaction, yale, one.id, seat, maths2),
      );
      const grouping = post('/api/groups', {
        academicYearId: year,
        subjectId: maths2,
        classIds: [yale],
        name: 'C-second',
        language: null,
        maxSize: 20,
      }).then((response) => response);
      await waitForTheLock();
      holding.release();
      expect(await holding.done).toBeUndefined();
      expect((await grouping).status).toBe(201);
      // A placement into the last seat first: the create waits, then is refused.
      const other = await pupil(yale);
      expect(await rowsOfStudent(other.id)).toHaveLength(1);
      const maths3 = await subject();
      const harvard = await schoolClass();
      const blocker = await pupil(harvard);
      const last = await group(maths3, [harvard], 1);
      const placing = await holdOpen((transaction) =>
        writeGroupPlacement(transaction, last, maths3, blocker.id),
      );
      const refused = post('/api/people/students', body({ classId: harvard })).then(
        (response) => response,
      );
      await waitForTheLock();
      placing.release();
      expect(await placing.done).toBeUndefined();
      refusedWith(await refused, 409, 'class_group_no_seat');
      // The create first: the group placement route waits, then finds the group full.
      const maths4 = await subject();
      const cambridge = await schoolClass();
      const waiting = await pupil(cambridge);
      const seat4 = await group(maths4, [cambridge], 1);
      const two = await pupil(null);
      const creatingHeld = await holdOpen((transaction) =>
        writeClassPlacement(transaction, cambridge, two.id, seat4, maths4),
      );
      const placingRoute = post(`/api/groups/${seat4}/members`, {
        students: [{ id: waiting.id }],
        from: '2026-10-12',
      }).then((response) => response);
      await waitForTheLock();
      creatingHeld.release();
      expect(await creatingHeld.done).toBeUndefined();
      refusedWith(await placingRoute, 409, 'group_full');
    });

    /**
     * Two real routes in a fixed order (the cancel and the undo write status,
     * class and group rows that a held transaction would only imitate): a
     * transaction holds the group FOR UPDATE, the first route starts and
     * waits on it, then the second; PostgreSQL grants the lock in the order
     * of the queue, so the first runs to its commit before the second reads.
     */
    async function inOrder(
      groupId: string,
      first: () => Promise<Response>,
      second: () => Promise<Response>,
    ): Promise<[Response, Response]> {
      const gate = await holdOpen(async (transaction) => {
        await transaction
          .selectFrom('groups')
          .select('id')
          .where('id', '=', groupId)
          .forUpdate()
          .execute();
      });
      const one = first().then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(0);
      const two = second().then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBeGreaterThan(1);
      gate.release();
      expect(await gate.done).toBeUndefined();
      return [await one, await two];
    }

    it('meets two cancels into one class and the last seat of one group, both directions', async () => {
      for (const order of [0, 1]) {
        const maths = await subject();
        const oxford = await schoolClass();
        const [one, two] = [await pupil(oxford), await pupil(oxford)];
        const last = await group(maths, [oxford], 1);
        await leave(one.id, '2026-10-31');
        await leave(two.id, '2026-10-31');
        const [winner, loser] = order === 0 ? [one, two] : [two, one];
        const [first, second] = await inOrder(
          last,
          () => cancel(winner.id),
          () => cancel(loser.id),
        );
        expect(first.status, JSON.stringify(first.body)).toBe(200);
        refusedWith(second, 409, 'class_group_no_seat');
        expect((await rowsOfStudent(winner.id)).map((row) => row.group_id)).toEqual([last]);
        expect(await rowsOfStudent(loser.id)).toEqual([]);
      }
    });

    it('meets a cancel and an undo of two students into one group, both directions', async () => {
      for (const order of [0, 1]) {
        const maths = await subject();
        const oxford = await schoolClass();
        const [scheduled, past] = [await pupil(oxford), await pupil(oxford)];
        const last = await group(maths, [oxford], 1);
        await leave(scheduled.id, '2026-10-31');
        await leave(past.id, '2026-10-05');
        const cancelling = () => cancel(scheduled.id);
        const undoing = () => undo(past.id);
        const [first, second] =
          order === 0
            ? await inOrder(last, undoing, cancelling)
            : await inOrder(last, cancelling, undoing);
        expect(first.status, JSON.stringify(first.body)).toBe(200);
        refusedWith(second, 409, 'class_group_no_seat');
      }
    });

    it('meets a group create on the returned class, for a cancel, both directions', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const one = await pupil(oxford);
      await leave(one.id, '2026-10-31');
      // A group create first: the cancel waits on the class, then places the student into it.
      const held = await holdOpen((transaction) =>
        writeGroupCreate(transaction, maths, [oxford], 'K-first'),
      );
      const cancelling = cancel(one.id).then((response) => response);
      await waitForTheLock();
      held.release();
      expect(await held.done).toBeUndefined();
      expect((await cancelling).status).toBe(200);
      expect(await rowsOfStudent(one.id)).toEqual([
        expect.objectContaining({ cause: 'automatic' }),
      ]);
      // The cancel first (waiting on its group, holding the class): the group create route
      // waits on the class, then commits; the student is not yet placed in the new subject.
      const maths2 = await subject();
      const english2 = await subject();
      const yale = await schoolClass();
      const two = await pupil(yale);
      const seat = await group(maths2, [yale], 2);
      await leave(two.id, '2026-10-31');
      const [cancelled, created] = await inOrder(
        seat,
        () => cancel(two.id),
        () =>
          post('/api/groups', {
            academicYearId: year,
            subjectId: english2,
            classIds: [yale],
            name: 'K-second',
            language: null,
            maxSize: 20,
          }),
      );
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect((await rowsOfStudent(two.id)).map((row) => row.group_id)).toEqual([seat]);
      const gaps = await t.app
        .get(Transactions)
        .run([t.north], (transaction) =>
          groupPlacementGaps(transaction, [yale], english2, '2026-11-01'),
        );
      expect(gaps.map((row) => row.studentId)).toEqual([two.id]);
    });

    it('meets a lower group maximum, for a cancel, both directions', async () => {
      const maths = await subject();
      const harvard = await schoolClass();
      const [three, blocker] = [await pupil(harvard), await pupil(harvard)];
      const small = await group(maths, [harvard], 2);
      await placeInGroup(small, [blocker], '2026-09-02');
      await leave(three.id, '2026-10-31');
      // A lower maximum first: the cancel waits, then finds no seat.
      const lowering = await holdOpen((transaction) =>
        writeGroupEdit(transaction, small, [harvard], { maxSize: 1 }),
      );
      const cancelled = cancel(three.id).then((response) => response);
      await waitForTheLock();
      lowering.release();
      expect(await lowering.done).toBeUndefined();
      refusedWith(await cancelled, 409, 'class_group_no_seat');
      // The cancel first: the edit route waits, then refuses the lower maximum.
      await t.database.migrator
        .updateTable('groups')
        .set({ max_size: 2 })
        .where('id', '=', small)
        .execute();
      const detail = (await get(`/api/groups/${small}`)).body as { version: number; name: string };
      const [first, second] = await inOrder(
        small,
        () => cancel(three.id),
        () =>
          t.put(
            `/api/groups/${small}`,
            t.north,
            {
              classIds: [harvard],
              name: detail.name,
              language: null,
              maxSize: 1,
              version: detail.version,
            },
            t.vicePrincipal,
          ),
      );
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      refusedWith(second, 409, 'group_size_below_members');
    });

    it('meets a group placement into the last seat for a cancel and for the replace by a later date, both directions', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const [one, other] = [await pupil(oxford), await pupil(oxford)];
      const last = await group(maths, [oxford], 1);
      await leave(one.id, '2026-10-31');
      // The placement first: the cancel waits, then finds no seat.
      const held = await holdOpen((transaction) =>
        writeGroupPlacement(transaction, last, maths, other.id),
      );
      const cancelling = cancel(one.id).then((response) => response);
      await waitForTheLock();
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await cancelling, 409, 'class_group_no_seat');
      // The cancel first: the placement route waits, then finds the group full.
      const maths2 = await subject();
      const yale = await schoolClass();
      const [two, waiting] = [await pupil(yale), await pupil(yale)];
      const seat = await group(maths2, [yale], 1);
      await leave(two.id, '2026-10-31');
      const [cancelled, placing] = await inOrder(
        seat,
        () => cancel(two.id),
        () =>
          post(`/api/groups/${seat}/members`, {
            students: [{ id: waiting.id }],
            from: '2026-11-02',
          }),
      );
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      refusedWith(placing, 409, 'group_full');
      // The placement first: the replace by a later date waits, then finds no seat.
      const maths3 = await subject();
      const harvard = await schoolClass();
      const [three, blocker] = [await pupil(harvard), await pupil(harvard)];
      const seat3 = await group(maths3, [harvard], 1);
      await leave(three.id, '2026-10-31');
      const placingHeld = await holdOpen((transaction) =>
        writeGroupPlacement(transaction, seat3, maths3, blocker.id),
      );
      const version = (await fresh(three.id)).version;
      const replacing = post(`/api/people/students/${three.id}/leaving`, {
        lastDay: '2026-11-30',
        reason: 'The family moved.',
        version,
      }).then((response) => response);
      await waitForTheLock();
      placingHeld.release();
      expect(await placingHeld.done).toBeUndefined();
      refusedWith(await replacing, 409, 'class_group_no_seat');
      // The replace first: the placement route waits, then finds the group full.
      const maths4 = await subject();
      const cambridge = await schoolClass();
      const [four, late] = [await pupil(cambridge), await pupil(cambridge)];
      const seat4 = await group(maths4, [cambridge], 1);
      await leave(four.id, '2026-10-31');
      const version4 = (await fresh(four.id)).version;
      const [replaced, placed4] = await inOrder(
        seat4,
        () =>
          post(`/api/people/students/${four.id}/leaving`, {
            lastDay: '2026-11-30',
            reason: 'The family moved.',
            version: version4,
          }),
        () =>
          post(`/api/groups/${seat4}/members`, { students: [{ id: late.id }], from: '2026-11-02' }),
      );
      expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
      refusedWith(placed4, 409, 'group_full');
    });
  });
});
