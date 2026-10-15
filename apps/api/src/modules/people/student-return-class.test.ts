import { apiErrorSchema, studentDetailSchema, type StudentDetail } from '@sodiq/shared';
import { sql } from 'kysely';
import { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { relativesInput } from '../../testing/relatives-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const detailsOf = (response: Response) => apiErrorSchema.parse(response.body).error.details ?? [];

const accepted = (response: Response): StudentDetail => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return studentDetailSchema.parse(response.body);
};

// All names are invented. docs/spec/04-people.md, Movements, "Coming back":
// the student "is placed in a class from the return date"; edge/students-
// classes-groups, "A student returns", "A student is graduated by mistake"
// ("restores the student to active with a class and a reason"), "A class is
// full", first row ("the smallest suitable group ... placed automatically,
// review"); task 3.3b, pull request #96 with correction 1 of its review. The
// clock stands at 23:55 on Saturday 10 October 2026 in Tashkent.
describe('the class of a return and of a graduate restore', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let members: MembersKit;
  let year: string;
  let closedClass: string;
  let nextYear: string;
  let southYear: string;
  let count = 0;

  const get = (path: string, cookie = t.admin) => t.get(path, t.north, cookie);
  const post = (path: string, body: object = {}, cookie = t.admin) =>
    t.post(path, t.north, body, cookie);

  /** A new student's body: grade 7, from 2 September, in the class named. */
  function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    count += 1;
    return {
      uid: String(2608300 + count),
      confirmUidSet: true,
      firstName: 'Dilnoza',
      lastName: `Karimova${'d'.repeat(count % 9)}${String.fromCharCode(97 + (count % 26))}`,
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
      contract: { number: `RC-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives: relativesInput(),
      ...overrides,
    };
  }

  /** A student created by the route: in the class from 2 September, or with no class from 12 October. */
  async function pupil(classId: string | null, branch = t.north): Promise<StudentDetail> {
    const response = await t.post(
      '/api/people/students',
      branch,
      body(classId === null ? { classId: null, startsOn: '2026-10-12' } : { classId }),
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  const fresh = async (id: string): Promise<StudentDetail> =>
    studentDetailSchema.parse((await get(`/api/people/students/${id}`)).body);

  const schoolClass = (input: { grade?: number; language?: 'uz' | 'ru'; maxSize?: number } = {}) =>
    classes.schoolClass(t.north, year, { grade: 7, ...input });

  /** A subject of its own per test, so that no other test's groups take part. */
  const subject = () => classes.subject({ grades: [7, 8] });

  const group = (subjectId: string, classIds: readonly string[], size = 20, name?: string) =>
    classes.group(t.north, year, subjectId, classIds, {
      size,
      ...(name === undefined ? {} : { name: `${name}-${String((count += 1))}` }),
    });

  /** A group row from 2 September, written by the migrator (as an earlier placement left it). */
  const inGroup = (groupId: string, subjectId: string, studentId: string, from = '2026-09-02') =>
    members.groupMember({ branch: t.north, groupId, subjectId, studentId, from });

  const leave = async (id: string, lastDay = '2026-10-05') => {
    const response = await post(`/api/people/students/${id}/leaving`, {
      lastDay,
      reason: 'The family moved.',
      version: (await fresh(id)).version,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  };

  /** A return from a date into a class, with a contract of its own. */
  const giveBack = async (
    id: string,
    classId: string,
    input: { from?: string; grade?: number; confirmLanguage?: boolean; version?: number } = {},
    cookie = t.admin,
  ) => {
    count += 1;
    return post(
      `/api/people/students/${id}/return`,
      {
        from: input.from ?? '2026-10-08',
        grade: input.grade ?? 7,
        classId,
        contract: { number: `RC-BACK/${String(count)}`, signedOn: '2026-10-08' },
        reason: null,
        ...(input.confirmLanguage === undefined ? {} : { confirmLanguage: input.confirmLanguage }),
        version: input.version ?? (await fresh(id)).version,
      },
      cookie,
    );
  };

  /** A graduate restore from a date into a class. */
  const restoreInto = async (id: string, classId: string, from = '2026-10-01', version?: number) =>
    post(`/api/people/students/${id}/restore`, {
      from,
      classId,
      reason: 'Graduated by mistake.',
      version: version ?? (await fresh(id)).version,
    });

  /** A student who left on 5 October, in the class from 2 September. */
  async function leftFrom(classId: string): Promise<StudentDetail> {
    const student = await pupil(classId);
    await leave(student.id);
    return fresh(student.id);
  }

  /**
   * A graduated student of grade 7 from 1 October, as the year close of task
   * 9.5a will write one (migrator): no class row ends after the graduation.
   */
  async function graduated(): Promise<StudentDetail> {
    const student = await pupil(await schoolClass());
    await t.database.migrator
      .deleteFrom('class_memberships')
      .where('student_id', '=', student.id)
      .execute();
    await t.database.migrator
      .updateTable('student_statuses')
      .set({ valid_until: '2026-10-01' })
      .where('student_id', '=', student.id)
      .execute();
    await t.database.migrator
      .insertInto('student_statuses')
      .values({
        student_id: student.id,
        branch_id: t.north,
        status: 'graduated',
        valid_from: '2026-10-01',
        cause: 'graduation',
      })
      .execute();
    return fresh(student.id);
  }

  const classRows = (id: string) =>
    t.database.migrator
      .selectFrom('class_memberships')
      .select(['class_id', 'valid_from', 'valid_until', 'own_until', 'cause', 'ended_by'])
      .where('student_id', '=', id)
      .orderBy('valid_from')
      .orderBy('id')
      .execute();

  /** The group rows with days from the date on. */
  const groupRows = (id: string, from = '2026-10-06') =>
    t.database.migrator
      .selectFrom('group_memberships')
      .select(['group_id', 'subject_id', 'valid_from', 'valid_until', 'cause', 'review'])
      .where('student_id', '=', id)
      .where('valid_from', '>=', from)
      .whereRef('valid_from', '<', 'valid_until')
      .orderBy('valid_from')
      .orderBy('id')
      .execute();

  /** Every row of the tables the two routes write, in both branches, and the log. */
  const rowsOf = () =>
    Promise.all([
      t.database.migrator.selectFrom('group_memberships').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('class_memberships').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_statuses').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_contracts').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('students').selectAll().orderBy('id').execute(),
      t.auditCount(),
    ]);

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

  /**
   * Two real routes in a fixed order (`inOrder` of `class-groups.test.ts`):
   * a third transaction holds the group FOR UPDATE, the first route waits on
   * it, then the second; the first runs to its commit before the second reads.
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

  beforeAll(async () => {
    t = await dayTemplatesKit();
    classes = new ClassesKit(t.database.migrator);
    members = new MembersKit(t.database.migrator, await classes.account());
    // The closed year first: one year of the branch is current at a time.
    const closedYear = await classes.year(t.north, 'planned', '2025-09-01', '2026-05-31');
    closedClass = await classes.schoolClass(t.north, closedYear, { grade: 7 });
    await classes.setYear(closedYear, 'current');
    await classes.setYear(closedYear, 'closed');
    year = await classes.year(t.north);
    nextYear = await classes.year(t.north, 'planned', '2027-09-01', '2028-05-31');
    southYear = await classes.year(t.south);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('a return into a class (04: "is placed in a class from the return date")', () => {
    it('writes the status row, the class row from the date to the year end and a group of every subject, and logs them', async () => {
      const maths = await subject();
      const english = await subject();
      const oxford = await schoolClass();
      const student = await leftFrom(oxford);
      // The record names the class left, which the form offers first.
      expect(student.classLeft).toMatchObject({ id: oxford, until: '2026-10-06' });
      const mathsGroup = await group(maths, [oxford]);
      const englishGroup = await group(english, [oxford]);
      const response = await giveBack(student.id, oxford, {}, t.vicePrincipal);
      const back = accepted(response);
      expect(back).toMatchObject({ status: 'active', grade: 7 });
      expect(back.statuses.at(-1)).toMatchObject({ status: 'active', from: '2026-10-08' });
      expect(back.groupsPlaced).toEqual(
        expect.arrayContaining([
          { studentId: student.id, groupId: mathsGroup, subjectId: maths },
          { studentId: student.id, groupId: englishGroup, subjectId: english },
        ]),
      );
      expect(back.groupsPlaced).toHaveLength(2);
      expect((await classRows(student.id)).at(-1)).toEqual({
        class_id: oxford,
        valid_from: '2026-10-08',
        valid_until: '2027-06-01',
        own_until: '2027-06-01',
        cause: 'return',
        ended_by: null,
      });
      const groups = await groupRows(student.id);
      expect(groups).toHaveLength(2);
      for (const row of groups) {
        expect(row).toMatchObject({
          valid_from: '2026-10-08',
          valid_until: '2027-06-01',
          cause: 'automatic',
          review: true,
        });
      }
      const requestId = response.headers['x-request-id'];
      const [joined] = (await t.entries('student.class_joined', student.id)).filter(
        (entry) => entry.request_id === requestId,
      );
      expect(joined).toMatchObject({
        assignment_id: t.viceAssignment,
        new_value: { classId: oxford, from: '2026-10-08', cause: 'return' },
      });
      const [entry] = await t.entries('student.return', student.id);
      expect(entry).toMatchObject({
        request_id: requestId,
        new_value: {
          classId: oxford,
          classMembershipId: (joined?.new_value as { membershipId?: string }).membershipId,
          languageConfirmed: false,
          groupsPlaced: 2,
        },
      });
      expect(
        (await t.entries('student.group_joined', student.id)).filter(
          (one) => one.request_id === requestId,
        ),
      ).toHaveLength(2);
      // The History tab shows the class joined by the return.
      const history = await get(`/api/people/students/${student.id}/history`);
      expect(history.status, JSON.stringify(history.body)).toBe(200);
      expect(JSON.stringify(history.body)).toContain('"from":"2026-10-08"');
    });

    it('places the class and the groups from yesterday for a backdated return', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const student = await leftFrom(oxford);
      await group(maths, [oxford]);
      accepted(await giveBack(student.id, oxford, { from: '2026-10-09' }));
      expect((await classRows(student.id)).at(-1)).toMatchObject({ valid_from: '2026-10-09' });
      expect(await groupRows(student.id)).toEqual([
        expect.objectContaining({ valid_from: '2026-10-09', cause: 'automatic' }),
      ]);
    });
  });

  describe('the restore of a graduated student (edge: "with a class and a reason")', () => {
    it('writes the class row with the cause restore, takes the class grade and takes the graduation back', async () => {
      const maths = await subject();
      const student = await graduated();
      const eighth = await schoolClass({ grade: 8 });
      const mathsGroup = await group(maths, [eighth]);
      const response = await restoreInto(student.id, eighth);
      const restored = accepted(response);
      // The grade of the class (decision 6): `students_grade_class` lets it through.
      expect(restored).toMatchObject({ status: 'active', grade: 8 });
      expect(restored.statuses.map((row) => [row.status, row.from, row.until, row.cause])).toEqual([
        // The graduation taken back on its first day holds no day, and is not shown.
        ['active', '2026-09-02', '2026-10-01', 'start'],
        ['active', '2026-10-01', null, 'restore'],
      ]);
      expect(restored.groupsPlaced).toEqual([
        { studentId: student.id, groupId: mathsGroup, subjectId: maths },
      ]);
      expect(await classRows(student.id)).toEqual([
        expect.objectContaining({ class_id: eighth, valid_from: '2026-10-01', cause: 'restore' }),
      ]);
      const [entry] = await t.entries('student.graduate_restored', student.id);
      expect(entry).toMatchObject({
        assignment_id: t.adminAssignment,
        old_value: { grade: 7 },
        new_value: { classId: eighth, grade: 8, groupsPlaced: 1 },
      });
      expect((entry?.new_value as Record<string, unknown>).languageConfirmed).toBeUndefined();
      // The last class joined: the first is of the create, before the graduation.
      const joined = (await t.entries('student.class_joined', student.id)).at(-1);
      expect(joined).toMatchObject({ new_value: { classId: eighth, cause: 'restore' } });
    });

    it('asks no confirmation of the language (the review: decision 2)', async () => {
      const student = await graduated();
      const russian = await schoolClass({ language: 'ru' });
      accepted(await restoreInto(student.id, russian));
    });
  });

  describe('the group of each subject (edge, first row; decision 5 with correction 1)', () => {
    it('chooses the smaller of two groups of one subject', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const student = await leftFrom(oxford);
      const other = await pupil(oxford);
      const bigger = await group(maths, [oxford], 20, 'A');
      const smaller = await group(maths, [oxford], 20, 'B');
      await inGroup(bigger, maths, other.id);
      accepted(await giveBack(student.id, oxford));
      expect((await groupRows(student.id)).map((row) => row.group_id)).toEqual([smaller]);
    });

    it('skips a group out of service', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const student = await leftFrom(oxford);
      const other = await pupil(oxford);
      const archived = await group(maths, [oxford], 20, 'A');
      const open = await group(maths, [oxford], 20, 'B');
      await inGroup(open, maths, other.id);
      await t.database.migrator
        .updateTable('groups')
        .set({ archived_at: new Date('2026-10-10T12:00:00+05:00') })
        .where('id', '=', archived)
        .execute();
      accepted(await giveBack(student.id, oxford));
      expect((await groupRows(student.id)).map((row) => row.group_id)).toEqual([open]);
    });

    /**
     * The class left, with the group the leaving cut fuller than another
     * group of the subject: the student and another in `cut` from 2
     * September, `small` empty, then the leaving of 5 October.
     */
    async function cutAndSmall(input: { cutSize?: number; alsoDrawsFrom?: string } = {}) {
      const maths = await subject();
      const oxford = await schoolClass();
      const student = await pupil(oxford);
      const other = await pupil(oxford);
      const filler = await pupil(oxford);
      const cut = await group(
        maths,
        input.alsoDrawsFrom === undefined ? [oxford] : [oxford, input.alsoDrawsFrom],
        input.cutSize ?? 20,
        'A',
      );
      const small = await group(maths, [oxford], 20, 'B');
      await inGroup(cut, maths, student.id);
      await inGroup(cut, maths, other.id);
      await leave(student.id);
      return { maths, oxford, student, other, filler, cut, small };
    }

    it('gives back the group the leaving cut on a return into the class left, though it is not the smallest', async () => {
      const { oxford, student, cut } = await cutAndSmall();
      const back = accepted(await giveBack(student.id, oxford));
      expect(
        (await groupRows(student.id)).map((row) => [row.group_id, row.cause, row.review]),
      ).toEqual([[cut, 'automatic', true]]);
      expect(back.groupsPlaced?.map((row) => row.groupId)).toEqual([cut]);
    });

    it('takes the smallest group when the group the leaving cut is archived', async () => {
      const { oxford, student, other, cut, small } = await cutAndSmall();
      // Empty from today, so it can be archived; by name it would come first.
      await t.database.migrator
        .deleteFrom('group_memberships')
        .where('group_id', '=', cut)
        .where('student_id', '=', other.id)
        .execute();
      await t.database.migrator
        .updateTable('groups')
        .set({ archived_at: new Date('2026-10-10T12:00:00+05:00') })
        .where('id', '=', cut)
        .execute();
      accepted(await giveBack(student.id, oxford));
      expect((await groupRows(student.id)).map((row) => row.group_id)).toEqual([small]);
    });

    it('takes the smallest group when the group the leaving cut is full', async () => {
      // A size of 2: another student takes the seat the leaving freed.
      const { maths, oxford, student, filler, cut, small } = await cutAndSmall({ cutSize: 2 });
      await inGroup(cut, maths, filler.id, '2026-10-06');
      accepted(await giveBack(student.id, oxford));
      expect((await groupRows(student.id)).map((row) => row.group_id)).toEqual([small]);
    });

    // "No longer draws from the class" is not reachable: while the row the
    // leaving cut exists, `group_class_has_members` keeps the class in the
    // group, so the case is left to `planClassGroups`'s `offered` check.

    it('takes no group of the class left on a return into another class', async () => {
      const yale = await schoolClass();
      const { maths, student, cut } = await cutAndSmall({ alsoDrawsFrom: yale });
      const yaleOnly = await group(maths, [yale], 20, 'Z');
      // `cut` draws from Yale too and is first by name, but holds one student.
      accepted(await giveBack(student.id, yale));
      expect((await groupRows(student.id)).map((row) => row.group_id)).toEqual([yaleOnly]);
      expect(yaleOnly).not.toBe(cut);
    });
  });

  describe('refusals of a return: all or none, on the field of the rule', () => {
    async function refusedReturn(
      response: Promise<Response>,
      code: string,
      path: 'classId' | 'from',
    ): Promise<void> {
      const before = await rowsOf();
      const answer = await response;
      refusedWith(answer, 409, code);
      expect(detailsOf(answer)[0]).toMatchObject({ path, code });
      expect(await rowsOf()).toEqual(before);
    }

    it('refuses a class whose last seat a scheduled join holds (class_full)', async () => {
      const oxford = await schoolClass({ maxSize: 2 });
      const student = await leftFrom(oxford);
      await pupil(oxford);
      const planned = await pupil(null);
      const placed = await post(`/api/classes/${oxford}/members`, {
        students: [{ id: planned.id, version: planned.version }],
        from: '2026-11-02',
      });
      expect(placed.status, JSON.stringify(placed.body)).toBe(201);
      const version = (await fresh(student.id)).version;
      const before = await rowsOf();
      const answer = await giveBack(student.id, oxford, { version });
      refusedWith(answer, 409, 'class_full');
      expect(detailsOf(answer)).toEqual([
        expect.objectContaining({ path: 'classId', code: 'class_full', freeSeats: 0 }),
      ]);
      expect(await rowsOf()).toEqual(before);
    });

    it('refuses a class of another grade, an archived class and a class of a closed year', async () => {
      const oxford = await schoolClass();
      const student = await leftFrom(oxford);
      const version = (await fresh(student.id)).version;
      await refusedReturn(
        giveBack(student.id, oxford, { grade: 8, version }),
        'class_grade_differs',
        'classId',
      );
      const archived = await schoolClass();
      await t.database.migrator
        .updateTable('classes')
        .set({ archived_at: new Date('2026-10-10T12:00:00+05:00') })
        .where('id', '=', archived)
        .execute();
      await refusedReturn(giveBack(student.id, archived, { version }), 'class_archived', 'classId');
      await refusedReturn(
        giveBack(student.id, closedClass, { version }),
        'class_year_closed',
        'classId',
      );
    });

    it('refuses a date outside the class year (return_outside_year, decision 10)', async () => {
      const oxford = await schoolClass();
      const student = await leftFrom(oxford);
      const coming = await classes.schoolClass(t.north, nextYear, { grade: 7 });
      await refusedReturn(
        giveBack(student.id, coming, { version: (await fresh(student.id)).version }),
        'return_outside_year',
        'from',
      );
    });

    it('refuses all or none when a subject has no group with a free seat', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const student = await leftFrom(oxford);
      const other = await pupil(oxford);
      const full = await group(maths, [oxford], 1);
      await inGroup(full, maths, other.id);
      const version = (await fresh(student.id)).version;
      const before = await rowsOf();
      const answer = await giveBack(student.id, oxford, { version });
      refusedWith(answer, 409, 'class_group_no_seat');
      expect(detailsOf(answer)).toEqual([
        expect.objectContaining({ path: 'classId', recordId: student.id, subjectId: maths }),
      ]);
      expect(await rowsOf()).toEqual(before);
    });

    it('asks to confirm a class of another language than the class left, then records the confirmation', async () => {
      const oxford = await schoolClass({ language: 'uz' });
      const yale = await schoolClass({ language: 'ru' });
      const student = await leftFrom(oxford);
      const version = (await fresh(student.id)).version;
      await refusedReturn(
        giveBack(student.id, yale, { version }),
        'return_language_differs',
        'classId',
      );
      await refusedReturn(
        giveBack(student.id, yale, { version, confirmLanguage: false }),
        'return_language_differs',
        'classId',
      );
      accepted(await giveBack(student.id, yale, { version, confirmLanguage: true }));
      const [entry] = await t.entries('student.return', student.id);
      expect(entry).toMatchObject({ new_value: { classId: yale, languageConfirmed: true } });
      // A class of the same language asks nothing (the first test).
    });
  });

  describe('refusals of a restore: all or none, the grade unchanged', () => {
    async function refusedRestore(
      student: StudentDetail,
      classId: string,
      code: string,
      path: 'classId' | 'from',
      from = '2026-10-01',
    ): Promise<void> {
      const before = await rowsOf();
      const answer = await restoreInto(student.id, classId, from, student.version);
      refusedWith(answer, 409, code);
      expect(detailsOf(answer)[0]).toMatchObject({ path, code });
      expect(await rowsOf()).toEqual(before);
      expect((await fresh(student.id)).grade).toBe(7);
    }

    it('refuses a full class, an archived class, a date outside the year and no group seat', async () => {
      const student = await graduated();
      const full = await schoolClass({ maxSize: 1 });
      await pupil(full);
      await refusedRestore(student, full, 'class_full', 'classId');
      const archived = await schoolClass({ grade: 8 });
      await t.database.migrator
        .updateTable('classes')
        .set({ archived_at: new Date('2026-10-10T12:00:00+05:00') })
        .where('id', '=', archived)
        .execute();
      await refusedRestore(student, archived, 'class_archived', 'classId');
      const coming = await classes.schoolClass(t.north, nextYear, { grade: 8 });
      await refusedRestore(student, coming, 'return_outside_year', 'from');
      const maths = await subject();
      const grouped = await schoolClass();
      const other = await pupil(grouped);
      const last = await group(maths, [grouped], 1);
      await inGroup(last, maths, other.id);
      await refusedRestore(student, grouped, 'class_group_no_seat', 'classId');
    });
  });

  describe('the class of the body (a branch record named in the body)', () => {
    it('answers 404 for a class of another branch or an unknown one on both routes, also as the Super Admin', async () => {
      const oxford = await schoolClass();
      const student = await leftFrom(oxford);
      const graduate = await graduated();
      const southClass = await classes.schoolClass(t.south, southYear, { grade: 7 });
      const before = await rowsOf();
      for (const classId of [southClass, UNKNOWN]) {
        for (const cookie of [t.admin, t.vicePrincipal]) {
          refusedWith(await giveBack(student.id, classId, {}, cookie), 404, 'not_found');
        }
        refusedWith(await restoreInto(graduate.id, classId), 404, 'not_found');
      }
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('two changes at the same moment (student, class, groups)', () => {
    it('meets a return and "Put into a class" of another student into the last seat, both directions', async () => {
      for (const order of [0, 1]) {
        const maths = await subject();
        const oxford = await schoolClass({ maxSize: 2 });
        const student = await leftFrom(oxford);
        await pupil(oxford);
        const gate = await group(maths, [oxford]);
        const newcomer = await pupil(null);
        const version = (await fresh(student.id)).version;
        const returning = () => giveBack(student.id, oxford, { version });
        const placing = () =>
          post(`/api/classes/${oxford}/members`, {
            students: [{ id: newcomer.id, version: newcomer.version }],
            from: '2026-10-12',
          });
        const [first, second] =
          order === 0
            ? await inOrder(gate, returning, placing)
            : await inOrder(gate, placing, returning);
        expect([200, 201]).toContain(first.status);
        refusedWith(second, 409, 'class_full');
        expect((await classRows(student.id)).filter((row) => row.cause === 'return')).toHaveLength(
          order === 0 ? 1 : 0,
        );
      }
    });

    it('meets a return and a group placement into the last seat of the only group, both directions', async () => {
      for (const order of [0, 1]) {
        const maths = await subject();
        const oxford = await schoolClass();
        const student = await leftFrom(oxford);
        const other = await pupil(oxford);
        const last = await group(maths, [oxford], 1);
        const version = (await fresh(student.id)).version;
        const returning = () => giveBack(student.id, oxford, { version });
        const grouping = () =>
          post(`/api/groups/${last}/members`, {
            students: [{ id: other.id }],
            from: '2026-10-12',
          });
        const [first, second] =
          order === 0
            ? await inOrder(last, returning, grouping)
            : await inOrder(last, grouping, returning);
        expect([200, 201]).toContain(first.status);
        expect(second.status, JSON.stringify(second.body)).toBe(409);
        if (order === 1) {
          expect(errorCode(second)).toBe('class_group_no_seat');
          expect((await fresh(student.id)).status).toBe('inactive');
        } else {
          expect((await groupRows(student.id)).map((row) => row.group_id)).toEqual([last]);
        }
      }
    });

    it('meets a restore and "Put into a class" into the last seat, both directions', async () => {
      for (const order of [0, 1]) {
        const maths = await subject();
        const oxford = await schoolClass({ maxSize: 1 });
        const gate = await group(maths, [oxford]);
        const student = await graduated();
        const newcomer = await pupil(null);
        const restoring = () => restoreInto(student.id, oxford, '2026-10-01', student.version);
        const placing = () =>
          post(`/api/classes/${oxford}/members`, {
            students: [{ id: newcomer.id, version: newcomer.version }],
            from: '2026-10-12',
          });
        const [first, second] =
          order === 0
            ? await inOrder(gate, restoring, placing)
            : await inOrder(gate, placing, restoring);
        expect([200, 201]).toContain(first.status);
        refusedWith(second, 409, 'class_full');
        expect((await fresh(student.id)).status).toBe(order === 0 ? 'active' : 'graduated');
      }
    });

    it('answers student_changed to the second of two returns of one student', async () => {
      const maths = await subject();
      const oxford = await schoolClass();
      const student = await leftFrom(oxford);
      const gate = await group(maths, [oxford]);
      const version = (await fresh(student.id)).version;
      const [first, second] = await inOrder(
        gate,
        () => giveBack(student.id, oxford, { version }),
        () => giveBack(student.id, oxford, { version }),
      );
      accepted(first);
      refusedWith(second, 409, 'student_changed');
    });
  });
});
