import {
  apiErrorSchema,
  BRANCH_HEADER,
  classDetailSchema,
  classMembersSchema,
  classSeatsSchema,
  studentDetailSchema,
  studentListSchema,
  studentNoClassSchema,
  type ClassMembers,
  type StudentDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { relativesInput } from '../../testing/relatives-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { binary, fileOf } from '../../testing/xlsx-kit.js';

// All names are invented. docs/spec/05-classes-groups-subjects.md, Class;
// docs/spec/edge-cases/students-classes-groups.md ("A student is enrolled in
// August before classes are formed", "A class is full", "A transfer or a
// leaving is set for a future date", "Two people move the same student at the
// same moment"); docs/spec/04-people.md, Movements; task 3.1b, pull request
// #89, with the corrections of its review. The clock stands at 23:55 on 10
// October 2026 in Tashkent; north and south each have the year 2026–2027.
describe('class membership', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let northYear: string;
  let southYear: string;
  let count = 0;
  let classCount = 0;

  /** A new student's body: grade 7, from 2 September, with a UID of its own. */
  function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    count += 1;
    return {
      uid: String(2607300 + count),
      confirmUidSet: true,
      firstName: 'Shahlo',
      lastName: `Yusupova${'a'.repeat(count % 7)}`,
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
      contract: { number: `CM-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives: relativesInput(),
      ...overrides,
    };
  }

  /** A student created by the route; with no class unless one is named. */
  async function student(
    overrides: Record<string, unknown> = {},
    branch = '',
  ): Promise<StudentDetail> {
    const response = await t.post('/api/people/students', branch || t.north, {
      ...body({ startsOn: '2026-10-12', classId: null }),
      ...overrides,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  const readStudent = async (id: string, branch = '') =>
    studentDetailSchema.parse((await t.get(`/api/people/students/${id}`, branch || t.north)).body);

  /** A class of the branch, grade 7 by default, with a maximum size. */
  async function schoolClass(
    input: { grade?: number; size?: number; branch?: string; year?: string } = {},
  ): Promise<string> {
    classCount += 1;
    const id = await classes.schoolClass(input.branch ?? t.north, input.year ?? northYear, {
      grade: input.grade ?? 7,
      name: `Member ${'abcdefghijklmnopqrstuvwxyz'.charAt(classCount % 26)}${'m'.repeat(
        Math.floor(classCount / 26),
      )}`,
    });
    if (input.size !== undefined) {
      await t.database.migrator
        .updateTable('classes')
        .set({ max_size: input.size })
        .where('id', '=', id)
        .execute();
    }
    return id;
  }

  const place = (
    classId: string,
    students: readonly StudentDetail[],
    from = '2026-10-12',
    cookie = t.vicePrincipal,
    branch = '',
  ) =>
    t.post(
      `/api/classes/${classId}/members`,
      branch || t.north,
      { students: students.map((one) => ({ id: one.id, version: one.version })), from },
      cookie,
    );

  const placed = (response: Response): ClassMembers => {
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return classMembersSchema.parse(response.body);
  };

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  const detailsOf = (response: Response) => apiErrorSchema.parse(response.body).error.details ?? [];

  /** Every row of the tables a membership route writes, in both branches, and the log. */
  const rowsOf = () =>
    Promise.all([
      t.database.migrator.selectFrom('class_memberships').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('classes').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('students').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_statuses').selectAll().orderBy('id').execute(),
      t.auditCount(),
    ]);

  const rowsOfStudent = (id: string) =>
    t.database.migrator
      .selectFrom('class_memberships')
      .select(['class_id', 'valid_from', 'valid_until', 'own_until', 'cause', 'ended_by'])
      .where('student_id', '=', id)
      .orderBy('valid_from')
      .orderBy('id')
      .execute();

  const leave = (one: StudentDetail, lastDay: string) =>
    t.post(`/api/people/students/${one.id}/leaving`, t.north, {
      lastDay,
      reason: 'The family moved.',
      version: one.version,
    });

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
    northYear = await classes.year(t.north);
    southYear = await classes.year(t.south);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('"Put into a class" (decisions 5, 6 and 14)', () => {
    it('places students from a date, all at once, with an entry on each student record', async () => {
      const oxford = await schoolClass({ size: 3 });
      const one = await student();
      const two = await student();
      const response = await place(oxford, [one, two], '2026-10-12');
      const members = placed(response);
      expect(members.today).toBe('2026-10-10');
      expect(members.members.map((member) => [member.studentId, member.state])).toEqual(
        [one, two]
          .sort((a, b) => a.lastName.localeCompare(b.lastName))
          .map((member) => [member.id, 'planned']),
      );
      expect(members.members[0]).toMatchObject({ from: '2026-10-12', until: '2027-06-01' });
      expect(members).toMatchObject({ freeToday: 3, freeLeast: 1 });
      for (const member of [one, two]) {
        const [entry] = await t.entries('student.class_joined', member.id);
        expect(entry).toMatchObject({
          assignment_id: t.viceAssignment,
          request_id: response.headers['x-request-id'],
          new_value: { classId: oxford, from: '2026-10-12', until: '2027-06-01' },
        });
        // The version counts the class row (decision 17).
        expect((await readStudent(member.id)).version).toBe(member.version + 1);
      }
      // The Principal reads the Students tab and places no one.
      const tab = await t.get(`/api/classes/${oxford}/members`, t.north, t.principal);
      expect(classMembersSchema.parse(tab.body).members).toHaveLength(2);
      const third = await student();
      const before = await rowsOf();
      refusedWith(
        await place(oxford, [third], '2026-10-12', t.principal),
        403,
        'permission_denied',
      );
      expect(await rowsOf()).toEqual(before);
    });

    it('refuses all when one student is refused, naming each and why', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const eighth = await student({ grade: 8 });
      const inClass = await student();
      placed(await place(yale, [inClass]));
      const fresh = await student();
      const stale = await student();
      const late = await student({ startsOn: '2026-10-20' });
      const before = await rowsOf();
      const response = await place(
        oxford,
        [fresh, eighth, await readStudent(inClass.id), stale, late].map((one) =>
          one.id === stale.id ? { ...one, version: one.version + 1 } : one,
        ),
        '2026-10-12',
      );
      refusedWith(response, 409, 'class_grade_differs');
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({
          path: 'students.1',
          code: 'class_grade_differs',
          recordId: eighth.id,
        }),
        expect.objectContaining({
          path: 'students.2',
          code: 'student_has_class',
          recordId: inClass.id,
        }),
        expect.objectContaining({
          path: 'students.3',
          code: 'student_changed',
          recordId: stale.id,
        }),
        expect.objectContaining({
          path: 'students.4',
          code: 'membership_before_start',
          recordId: late.id,
        }),
      ]);
      expect(await rowsOf()).toEqual(before);
    });

    it('refuses a student who is not active from the date, and places one up to a scheduled leaving', async () => {
      const oxford = await schoolClass();
      const gone = await student({ startsOn: '2026-09-02', classId: oxford });
      const left = studentDetailSchema.parse((await leave(gone, '2026-09-30')).body);
      const other = await schoolClass();
      refusedWith(await place(other, [left], '2026-10-12'), 409, 'student_not_active_on');

      const leaving = await student();
      const scheduled = studentDetailSchema.parse((await leave(leaving, '2026-12-31')).body);
      placed(await place(other, [scheduled], '2026-10-12'));
      expect(await rowsOfStudent(leaving.id)).toEqual([
        expect.objectContaining({
          class_id: other,
          valid_from: '2026-10-12',
          valid_until: '2027-01-01',
          own_until: '2027-06-01',
          ended_by: 'leaving',
        }),
      ]);
    });

    it('refuses more students than the fewest free seats on any date, counting scheduled joins', async () => {
      const oxford = await schoolClass({ size: 2 });
      placed(await place(oxford, [await student()], '2026-10-12'));
      placed(await place(oxford, [await student({ startsOn: '2026-11-02' })], '2026-11-02'));
      const response = await place(oxford, [await student()], '2026-10-12');
      refusedWith(response, 409, 'class_full');
      // Task 3.5b, H24: the class and the first day without a seat for the one student.
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({
          code: 'class_full',
          freeSeats: 0,
          classId: oxford,
          fullFrom: '2026-11-02',
          students: 1,
        }),
      ]);
    });

    // Task 3.5b, H24 of issue #105: the refusal is true for several students too.
    it('names the first day with fewer free seats than the students placed', async () => {
      const oxford = await schoolClass({ size: 2 });
      const response = await place(oxford, [await student(), await student(), await student()]);
      refusedWith(response, 409, 'class_full');
      expect(detailsOf(response)).toEqual([
        expect.objectContaining({
          code: 'class_full',
          freeSeats: 2,
          classId: oxford,
          fullFrom: '2026-10-12',
          students: 3,
        }),
      ]);
    });

    it('refuses a date outside the year, an archived class and a class of a closed year', async () => {
      const oxford = await schoolClass();
      const one = await student();
      refusedWith(await place(oxford, [one], '2027-06-01'), 409, 'membership_outside_year');
      const archived = await schoolClass();
      await t.database.migrator
        .updateTable('classes')
        .set({ archived_at: new Date('2026-10-01T09:00:00+05:00') })
        .where('id', '=', archived)
        .execute();
      refusedWith(await place(archived, [one]), 409, 'class_archived');
      const branch = await t.newBranch();
      const old = await classes.year(branch, 'current', '2025-09-01', '2026-05-31');
      const closed = await schoolClass({ branch, year: old });
      const pupil = await new MembersKit(t.database.migrator, await classes.account()).student(
        branch,
        { startsOn: '2025-09-01' },
      );
      await classes.setYear(old, 'closed');
      refusedWith(
        await t.post(`/api/classes/${closed}/members`, branch, {
          students: [{ id: pupil, version: 1 }],
          from: '2025-10-01',
        }),
        409,
        'class_year_closed',
      );
    });

    it('answers 404 for a class or a student of another branch or unknown, changing nothing', async () => {
      const southClass = await schoolClass({ branch: t.south, year: southYear });
      const northClass = await schoolClass();
      const north = await student();
      const south = await student({}, t.south);
      const before = await rowsOf();
      for (const cookie of [t.vicePrincipal, t.admin]) {
        refusedWith(await place(southClass, [north], '2026-10-12', cookie), 404, 'not_found');
        refusedWith(await place(UNKNOWN, [north], '2026-10-12', cookie), 404, 'not_found');
        refusedWith(await place(northClass, [south], '2026-10-12', cookie), 404, 'not_found');
        refusedWith(
          await t.post(
            `/api/classes/${northClass}/members`,
            t.north,
            { students: [{ id: UNKNOWN, version: 1 }], from: '2026-10-12' },
            cookie,
          ),
          404,
          'not_found',
        );
        for (const id of [southClass, UNKNOWN]) {
          refusedWith(await t.get(`/api/classes/${id}/members`, t.north, cookie), 404, 'not_found');
        }
      }
      expect(await rowsOf()).toEqual(before);
    });

    it('refuses the second of two placements of one student at the same moment: student changed', async () => {
      // A placement holds the student FOR UPDATE; the second, made on the
      // same version, waits and is refused (edge: "The second one gets
      // \"student changed, reload\""). Both sides are the same route.
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const one = await student();
      const held = await holdOpen(async (transaction) => {
        await transaction
          .selectFrom('students')
          .select('id')
          .where('id', '=', one.id)
          .forUpdate()
          .execute();
        await transaction
          .insertInto('class_memberships')
          .values({
            branch_id: t.north,
            student_id: one.id,
            class_id: oxford,
            valid_from: '2026-10-12',
            valid_until: '2027-06-01',
            own_until: '2027-06-01',
            cause: 'placement',
          })
          .execute();
      });
      const second = place(yale, [one], '2026-10-12').then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await second, 409, 'student_changed');
      expect(await rowsOfStudent(one.id)).toEqual([expect.objectContaining({ class_id: oxford })]);
    });
  });

  describe('the withdraw of a planned placement (decision 10)', () => {
    it('withdraws a planned placement for good and refuses one in force', async () => {
      const oxford = await schoolClass();
      const planned = await student();
      const tab = placed(await place(oxford, [planned], '2026-10-12'));
      const member = tab.members[0];
      expect(member).toBeDefined();
      const response = await t.post(
        `/api/classes/${oxford}/members/${member?.id ?? ''}/withdraw`,
        t.north,
        {},
        t.vicePrincipal,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(classMembersSchema.parse(response.body).members).toEqual([]);
      expect(await rowsOfStudent(planned.id)).toEqual([
        expect.objectContaining({
          valid_from: '2026-10-12',
          valid_until: '2026-10-12',
          ended_by: 'withdrawn',
        }),
      ]);
      const [entry] = await t.entries('student.class_withdrawn', planned.id);
      expect(entry).toMatchObject({ assignment_id: t.viceAssignment });
      // The student can be placed again, in another class.
      placed(await place(await schoolClass(), [await readStudent(planned.id)], '2026-10-12'));

      const inForce = await student({ startsOn: '2026-09-02', classId: oxford });
      const own = classMembersSchema
        .parse((await t.get(`/api/classes/${oxford}/members`, t.north)).body)
        .members.find((one) => one.studentId === inForce.id);
      refusedWith(
        await t.post(`/api/classes/${oxford}/members/${own?.id ?? ''}/withdraw`, t.north),
        409,
        'membership_in_force',
      );
    });

    it('answers 404 for a member of another class, of another branch or unknown', async () => {
      const oxford = await schoolClass();
      const yale = await schoolClass();
      const tab = placed(await place(oxford, [await student()], '2026-10-12'));
      const memberId = tab.members[0]?.id ?? '';
      const southClass = await schoolClass({ branch: t.south, year: southYear });
      // A member of a class of the south, sent under a class of the north.
      const southTab = classMembersSchema.parse(
        (
          await t.post(
            `/api/classes/${southClass}/members`,
            t.south,
            {
              students: [{ id: (await student({}, t.south)).id, version: 1 }],
              from: '2026-10-12',
            },
            t.admin,
          )
        ).body,
      );
      const southMember = southTab.members[0]?.id ?? '';
      expect(southMember).not.toBe('');
      const before = await rowsOf();
      for (const path of [
        `/api/classes/${oxford}/members/${southMember}/withdraw`,
        `/api/classes/${yale}/members/${memberId}/withdraw`,
        `/api/classes/${oxford}/members/${UNKNOWN}/withdraw`,
        `/api/classes/${southClass}/members/${memberId}/withdraw`,
        `/api/classes/${UNKNOWN}/members/${memberId}/withdraw`,
      ]) {
        for (const cookie of [t.vicePrincipal, t.admin]) {
          refusedWith(await t.post(path, t.north, {}, cookie), 404, 'not_found');
        }
      }
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('the class, the year and the student against their members', () => {
    it('refuses a lower maximum below the members, a grade change and an archive of a class with members', async () => {
      const oxford = await schoolClass({ size: 3 });
      placed(await place(oxford, [await student(), await student()], '2026-10-12'));
      const detail = classDetailSchema.parse((await t.get(`/api/classes/${oxford}`, t.north)).body);
      const edit = (fields: Record<string, unknown>) =>
        t.put(`/api/classes/${oxford}`, t.north, {
          grade: detail.grade,
          name: detail.name,
          language: detail.language,
          mainRoomId: null,
          maxSize: detail.maxSize,
          version: detail.version,
          ...fields,
        });
      const before = await rowsOf();
      refusedWith(await edit({ maxSize: 1 }), 409, 'class_size_below_members');
      refusedWith(await edit({ grade: 8 }), 409, 'class_grade_members');
      refusedWith(
        await t.post(`/api/classes/${oxford}/archive`, t.north),
        409,
        'class_has_members',
      );
      expect(await rowsOf()).toEqual(before);
      const raised = await edit({ maxSize: 5 });
      expect(raised.status, JSON.stringify(raised.body)).toBe(200);
    });

    it('refuses a start of the year past a stay with the list, and lets the end move with the stay (L128)', async () => {
      const branch = await t.newBranch();
      const year = await classes.year(branch, 'planned');
      const oxford = await schoolClass({ branch, year });
      const one = await student({ startsOn: '2026-10-12', classId: null }, branch);
      const response = await t.post(`/api/classes/${oxford}/members`, branch, {
        students: [{ id: one.id, version: one.version }],
        from: '2026-10-12',
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const before = await rowsOf();
      const refused = await t.put(`/api/setup/academic-years/${year}`, branch, {
        startDate: '2026-10-20',
        endDate: '2027-05-31',
      });
      refusedWith(refused, 409, 'year_cut_holds');
      const details = apiErrorSchema.parse(refused.body).error.details ?? [];
      expect(details).toHaveLength(1);
      expect(details[0]?.message).toContain(one.firstName);
      expect(details[0]?.message).toContain('2026-10-12');
      expect(await rowsOf()).toEqual(before);
      // Longer, and shorter where no stay stands: the stay follows the last day.
      for (const endDate of ['2027-06-30', '2027-05-20']) {
        const moved = await t.put(`/api/setup/academic-years/${year}`, branch, {
          startDate: '2026-09-01',
          endDate,
        });
        expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      }
      const rows = await t.database.migrator
        .selectFrom('class_memberships')
        .select(['valid_until', 'own_until'])
        .where('student_id', '=', one.id)
        .execute();
      expect(rows).toEqual([
        expect.objectContaining({ valid_until: '2027-05-21', own_until: '2027-05-21' }),
      ]);
      const written = await t.database.migrator
        .selectFrom('audit_log')
        .select('new_value')
        .where('action', '=', 'academic_year.edit')
        .where('record_id', '=', year)
        .orderBy('id')
        .execute();
      expect(written.at(-1)?.new_value).toMatchObject({
        endDate: '2027-05-20',
        rowsFollowed: [
          expect.objectContaining({
            table: 'class_memberships',
            ownUntil: ['2027-07-01', '2027-05-21'],
            validUntil: ['2027-07-01', '2027-05-21'],
          }),
        ],
      });
    });

    it('refuses the grade edit of a student in a class', async () => {
      const oxford = await schoolClass();
      const one = await student({ startsOn: '2026-09-02', classId: oxford });
      const before = await rowsOf();
      const response = await t.put(`/api/people/students/${one.id}`, t.north, {
        ...Object.fromEntries(
          Object.entries(body()).filter(
            ([key]) => !['uid', 'confirmUidSet', 'startsOn', 'relatives', 'classId'].includes(key),
          ),
        ),
        firstName: one.firstName,
        lastName: one.lastName,
        grade: 8,
        contract: { number: one.financial?.contracts[0]?.number, signedOn: '2026-08-20' },
      });
      refusedWith(response, 409, 'student_grade_class');
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('the create of a student (decision 2)', () => {
    it('needs a class from a start date of today or earlier, and not from tomorrow', async () => {
      const before = await rowsOf();
      for (const startsOn of ['2026-09-02', '2026-10-10']) {
        const response = await t.post(
          '/api/people/students',
          t.north,
          body({ startsOn, classId: null }),
        );
        refusedWith(response, 422, 'student_needs_class');
      }
      expect(await rowsOf()).toEqual(before);
      const tomorrow = await student({ startsOn: '2026-10-11', classId: null });
      expect(tomorrow).toMatchObject({ class: null, plannedClass: null });
    });

    it('places the student from the start date, with an entry beside the create', async () => {
      const oxford = await schoolClass();
      const response = await t.post(
        '/api/people/students',
        t.north,
        body({ startsOn: '2026-09-02', classId: oxford }),
      );
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const created = studentDetailSchema.parse(response.body);
      expect(created.class).toMatchObject({ id: oxford, from: '2026-09-02', until: '2027-06-01' });
      const [entry] = await t.entries('student.class_joined', created.id);
      expect(entry).toMatchObject({
        assignment_id: t.adminAssignment,
        request_id: response.headers['x-request-id'],
        new_value: { classId: oxford, from: '2026-09-02', cause: 'create' },
      });
      expect(await t.entries('student.create', created.id)).toHaveLength(1);
    });

    it('answers 404 for a class of another branch or unknown, creating nothing', async () => {
      const southClass = await schoolClass({ branch: t.south, year: southYear });
      const before = await rowsOf();
      for (const classId of [southClass, UNKNOWN]) {
        refusedWith(
          await t.post('/api/people/students', t.north, body({ classId })),
          404,
          'not_found',
        );
      }
      expect(await rowsOf()).toEqual(before);
    });
  });

  // Task 3.5b, H24 of issue #105: the free seats the Add student form marks.
  describe('the seats of the classes a new student can join', () => {
    const seats = async (from: string, cookie = t.vicePrincipal, branch = '') => {
      const response = await t.get(`/api/classes/seats?from=${from}`, branch || t.north, cookie);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return classSeatsSchema.parse(response.body).classes;
    };
    const seatOf = async (classId: string, from: string) =>
      (await seats(from)).find((one) => one.classId === classId);

    it('names the first day with no seat, a scheduled join and a scheduled leaving counted', async () => {
      const filling = await schoolClass({ size: 2 });
      placed(await place(filling, [await student()], '2026-10-12'));
      placed(await place(filling, [await student({ startsOn: '2026-11-02' })], '2026-11-02'));
      expect(await seatOf(filling, '2026-10-12')).toEqual({
        classId: filling,
        maxSize: 2,
        fullFrom: '2026-11-02',
      });

      const freeing = await schoolClass({ size: 1 });
      const going = await student();
      placed(await place(freeing, [going], '2026-10-12'));
      await leave(await readStudent(going.id), '2026-12-31');
      expect((await seatOf(freeing, '2026-10-12'))?.fullFrom).toBe('2026-10-12');
      expect((await seatOf(freeing, '2027-01-01'))?.fullFrom).toBeNull();

      const empty = await schoolClass({ size: 3 });
      expect((await seatOf(empty, '2026-10-12'))?.fullFrom).toBeNull();
    });

    it('lists no class of another branch, no archived class and none of another year', async () => {
      const southClass = await schoolClass({ branch: t.south, year: southYear });
      const archived = await schoolClass();
      await t.database.migrator
        .updateTable('classes')
        .set({ archived_at: new Date('2026-10-01T09:00:00+05:00') })
        .where('id', '=', archived)
        .execute();
      const listed = (await seats('2026-10-12')).map((one) => one.classId);
      expect(listed).not.toContain(southClass);
      expect(listed).not.toContain(archived);
      expect(await seats('2027-07-01')).toEqual([]);
    });

    it('is for the roles that add a student, and refuses a date that is not one', async () => {
      await seats('2026-10-12', t.admin);
      refusedWith(
        await t.get('/api/classes/seats?from=2026-10-12', t.north, t.principal),
        403,
        'permission_denied',
      );
      refusedWith(
        await t.get('/api/classes/seats?from=12.10.2026', t.north),
        400,
        'validation_failed',
      );
    });
  });

  describe('a leaving and its taking back (decision 1, correction 1)', () => {
    it('cuts the class at a scheduled leaving and gives it back at its cancel', async () => {
      const oxford = await schoolClass();
      const one = await student({ startsOn: '2026-09-02', classId: oxford });
      const left = studentDetailSchema.parse((await leave(one, '2026-10-31')).body);
      expect(await rowsOfStudent(one.id)).toEqual([
        expect.objectContaining({ valid_until: '2026-11-01', ended_by: 'leaving' }),
      ]);
      const [entry] = await t.entries('student.leave', one.id);
      expect(entry?.new_value).toMatchObject({
        memberships: { cut: [{ classId: oxford, from: '2026-09-02', until: '2026-11-01' }] },
      });
      const cancelled = await t.post(`/api/people/students/${one.id}/leaving/cancel`, t.north, {
        version: left.version,
      });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      // One stay (task 3.5c, H36): the cut row grows back to its own end.
      expect(await rowsOfStudent(one.id)).toEqual([
        expect.objectContaining({
          valid_from: '2026-09-02',
          valid_until: '2027-06-01',
          cause: 'create',
          ended_by: null,
        }),
      ]);
      expect(studentDetailSchema.parse(cancelled.body).class).toMatchObject({ id: oxford });
    });

    it('gives an emptied planned row back on its planned date (correction 1)', async () => {
      const oxford = await schoolClass();
      const one = await student({ startsOn: '2026-10-12', classId: null });
      placed(await place(oxford, [one], '2026-11-02'));
      const left = studentDetailSchema.parse(
        (await leave(await readStudent(one.id), '2026-10-20')).body,
      );
      expect(await rowsOfStudent(one.id)).toEqual([
        expect.objectContaining({
          valid_from: '2026-11-02',
          valid_until: '2026-11-02',
          ended_by: 'leaving',
        }),
      ]);
      const cancelled = await t.post(`/api/people/students/${one.id}/leaving/cancel`, t.north, {
        version: left.version,
      });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      expect(await rowsOfStudent(one.id)).toEqual([
        expect.objectContaining({
          valid_from: '2026-11-02',
          valid_until: '2027-06-01',
          cause: 'placement',
          ended_by: null,
        }),
      ]);
    });

    it('moves the class with the replace of a scheduled leaving, earlier and later', async () => {
      const oxford = await schoolClass();
      const one = await student({ startsOn: '2026-09-02', classId: oxford });
      const first = studentDetailSchema.parse((await leave(one, '2026-11-30')).body);
      const earlier = studentDetailSchema.parse((await leave(first, '2026-10-31')).body);
      expect(await rowsOfStudent(one.id)).toEqual([
        expect.objectContaining({ valid_until: '2026-11-01', ended_by: 'leaving' }),
      ]);
      const later = await leave(earlier, '2026-12-31');
      expect(later.status, JSON.stringify(later.body)).toBe(200);
      expect(await rowsOfStudent(one.id)).toEqual([
        expect.objectContaining({
          valid_from: '2026-09-02',
          valid_until: '2027-01-01',
          own_until: '2027-06-01',
          ended_by: 'leaving',
        }),
      ]);
    });

    it('undoes a leaving in force with the class back, and refuses a cancel that would overfill the class', async () => {
      const oxford = await schoolClass({ size: 1 });
      const one = await student({ startsOn: '2026-09-02', classId: oxford });
      const gone = studentDetailSchema.parse((await leave(one, '2026-10-05')).body);
      const undone = await t.post(`/api/people/students/${one.id}/leaving/undo`, t.north, {
        reason: 'Entered by mistake.',
        version: gone.version,
      });
      expect(undone.status, JSON.stringify(undone.body)).toBe(200);
      expect(await rowsOfStudent(one.id)).toEqual([
        expect.objectContaining({
          valid_from: '2026-09-02',
          valid_until: '2027-06-01',
          ended_by: null,
        }),
      ]);

      // The seat of a scheduled leaver is taken from the leaving day: the cancel finds the class full.
      const leaver = await student({
        startsOn: '2026-09-02',
        classId: await schoolClass({ size: 1 }),
      });
      const classId = leaver.class?.id ?? '';
      const scheduled = studentDetailSchema.parse((await leave(leaver, '2026-10-31')).body);
      placed(await place(classId, [await student({ startsOn: '2026-11-01' })], '2026-11-01'));
      const before = await rowsOf();
      refusedWith(
        await t.post(`/api/people/students/${leaver.id}/leaving/cancel`, t.north, {
          version: scheduled.version,
        }),
        409,
        'class_full',
      );
      expect(await rowsOf()).toEqual(before);
    });

    it('gives the class back without an overlap after a leaving, its cancel, an earlier leaving and its undo', async () => {
      // Found by the browser test of the build: the first row and the row the
      // cancel wrote back both keep the year as their own end.
      const oxford = await schoolClass();
      const one = await student({ startsOn: '2026-09-02', classId: oxford });
      const scheduled = studentDetailSchema.parse((await leave(one, '2026-10-20')).body);
      const cancelled = await t.post(`/api/people/students/${one.id}/leaving/cancel`, t.north, {
        version: scheduled.version,
      });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      const gone = studentDetailSchema.parse(
        (await leave(studentDetailSchema.parse(cancelled.body), '2026-10-01')).body,
      );
      expect(gone.class).toBeNull();
      const undone = await t.post(`/api/people/students/${one.id}/leaving/undo`, t.north, {
        reason: 'Entered for the wrong student.',
        version: gone.version,
      });
      expect(undone.status, JSON.stringify(undone.body)).toBe(200);
      expect(studentDetailSchema.parse(undone.body).class).toMatchObject({ id: oxford });
      const live = (await rowsOfStudent(one.id)).filter((row) => row.valid_from < row.valid_until);
      expect(live.map((row) => [row.valid_from, row.valid_until, row.cause])).toEqual([
        ['2026-09-02', '2027-06-01', 'create'],
      ]);
    });

    it('orders two cancels of students of one class at the same moment, without a deadlock', async () => {
      // Spec review of the build, must-fix 1: each change locks the classes it
      // gives back FOR UPDATE before the guard does, so two of them wait in turn.
      const oxford = await schoolClass();
      const scheduled: StudentDetail[] = [];
      for (let n = 0; n < 2; n += 1) {
        const one = await student({ startsOn: '2026-09-02', classId: oxford });
        scheduled.push(studentDetailSchema.parse((await leave(one, '2026-10-31')).body));
      }
      const [first, second] = scheduled;
      if (first === undefined || second === undefined) {
        throw new Error('Two students are scheduled to leave.');
      }
      const cancel = (one: StudentDetail) =>
        t.post(`/api/people/students/${one.id}/leaving/cancel`, t.north, { version: one.version });
      // A held change of the first student, as the route makes it: its student,
      // then the class FOR UPDATE; the second student's cancel waits on the class.
      const held = await holdOpen(async (transaction) => {
        await transaction
          .selectFrom('students')
          .select('id')
          .where('id', '=', first.id)
          .forUpdate()
          .execute();
        await transaction
          .selectFrom('classes')
          .select('id')
          .where('id', '=', oxford)
          .forUpdate()
          .execute();
      });
      const waiting = cancel(second).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      expect(await held.done).toBeUndefined();
      const answered = await waiting;
      expect(answered.status, JSON.stringify(answered.body)).toBe(200);
      // Both at once through the routes: each answers, neither is a deadlock.
      const again = await Promise.all([
        leave(await readStudent(first.id), '2026-10-31'),
        leave(await readStudent(second.id), '2026-10-31'),
      ]);
      const left = again.map((response) => studentDetailSchema.parse(response.body));
      const both = await Promise.all(left.map(cancel));
      expect(both.map((response) => response.status)).toEqual([200, 200]);
    });

    it('names a class archived meanwhile and does not give it back', async () => {
      const oxford = await schoolClass();
      const one = await student({ startsOn: '2026-09-02', classId: oxford });
      const gone = studentDetailSchema.parse((await leave(one, '2026-10-05')).body);
      const archived = await t.post(`/api/classes/${oxford}/archive`, t.north);
      expect(archived.status, JSON.stringify(archived.body)).toBe(200);
      const undone = await t.post(`/api/people/students/${one.id}/leaving/undo`, t.north, {
        reason: 'Entered by mistake.',
        version: gone.version,
      });
      expect(undone.status, JSON.stringify(undone.body)).toBe(200);
      const answer = studentDetailSchema.parse(undone.body);
      expect(answer.classesNotRestored).toEqual([
        { classId: oxford, grade: 7, name: expect.any(String) as string },
      ]);
      expect(answer.class).toBeNull();
      expect(await rowsOfStudent(one.id)).toHaveLength(1);
    });
  });

  describe('what reads the memberships', () => {
    it('shows the class, the planned class and the Tutor in the list and the record, and counts the card', async () => {
      const oxford = await schoolClass();
      const person = await classes.person(t.north, ['uz'], { first: 'Gulnora', last: 'Tosheva' });
      const role = await classes.role(person.accountId, t.north);
      await classes.tutorRow(t.north, oxford, role);
      const room = await classes.room(t.north);
      await t.database.migrator
        .updateTable('classes')
        .set({ main_room_id: room })
        .where('id', '=', oxford)
        .execute();
      const now = await student({ startsOn: '2026-09-02', classId: oxford });
      const later = await student({ startsOn: '2026-10-12', classId: null });
      placed(await place(oxford, [later], '2026-11-02'));
      const list = studentListSchema.parse((await t.get('/api/people/students', t.north)).body);
      expect(list.students.find((one) => one.id === now.id)).toMatchObject({
        class: { id: oxford, grade: 7 },
        plannedClass: null,
        tutor: { firstName: 'Gulnora', lastName: 'Tosheva' },
      });
      expect(list.students.find((one) => one.id === later.id)).toMatchObject({
        class: null,
        plannedClass: { id: oxford, from: '2026-11-02' },
        tutor: null,
      });
      const record = await readStudent(now.id);
      expect(record.mainRoom).toMatch(/^Room /);
      const detail = classDetailSchema.parse((await t.get(`/api/classes/${oxford}`, t.north)).body);
      expect(detail.students).toBe(1);
    });

    it('takes a placed student out of the "No class" counter', async () => {
      const count = async () =>
        studentNoClassSchema.parse(
          (await t.get('/api/people/students/no-class', t.north, t.vicePrincipal)).body,
        ).count;
      const before = await count();
      const one = await student({ startsOn: '2026-10-12', classId: null });
      expect(await count()).toBe(before + 1);
      placed(await place(await schoolClass(), [one], '2026-10-12'));
      expect(await count()).toBe(before);
    });

    it('exports the class and its Tutor', async () => {
      const oxford = await schoolClass();
      const person = await classes.person(t.north, ['uz'], { first: 'Zarina', last: 'Olimova' });
      await classes.tutorRow(t.north, oxford, await classes.role(person.accountId, t.north));
      const one = await student({ startsOn: '2026-09-02', classId: oxford });
      const response = await request(t.kit.server)
        .post('/api/people/students/export')
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, t.north)
        .send({
          ids: [one.id],
          columns: ['class', 'tutor'],
          selection: 'ticked',
          search: '',
          filters: {},
        })
        .buffer(true)
        .parse(binary);
      const file = await fileOf(response);
      // The Super Admin of the kit reads Uzbek.
      expect(file.sheet.headings).toEqual(['Sinf', 'Tyutor']);
      expect(file.sheet.rows[0]).toEqual([`7 ${String(one.class?.name)}`, 'Olimova Zarina']);
    });
  });
});
