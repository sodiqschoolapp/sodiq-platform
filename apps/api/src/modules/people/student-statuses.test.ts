import {
  apiErrorSchema,
  studentDetailSchema,
  studentListSchema,
  studentNameKey,
  type StudentDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { CellsKit, markInStore } from '../../testing/cells-kit.js';
import { closeQuarter } from '../../testing/closing-kit.js';
import { moveStudentBranch } from '../../testing/members-kit.js';
import { linkRelative, relativesInput } from '../../testing/relatives-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const MOMENT = new Date(START);
/** Six minutes after the start of the kit: 11 October in Tashkent. */
const NEXT_DAY = '2026-10-11T00:01:00+05:00';

// All names are invented. docs/spec/04-people.md, Movements;
// docs/spec/edge-cases/students-classes-groups.md; the plan approved on pull
// request #68 with its corrections. The clock stands at 23:55 on 10 October
// 2026 in Tashkent; north has the years 2025–2026 (closed once the students
// that start in it exist), 2026–2027 and 2027–2028, south the year 2026–2027.
describe('leaving, return and delete of a student', () => {
  let t: DayTemplatesKit;
  let spiritual: string;
  let headTutor: string;
  let tutor: string;
  let headTeacher: string;
  let seniorHeadTeacher: string;
  let closedYearStudent: StudentDetail;
  let currentYear: string;
  let count = 0;

  function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    count += 1;
    return {
      uid: String(2607200 + count),
      confirmUidSet: true,
      firstName: 'Shahzoda',
      lastName: `Murodova${'a'.repeat(count % 7)}`,
      paternalName: null,
      sex: 'female',
      birthDate: `2014-05-${String((count % 28) + 1).padStart(2, '0')}`,
      grade: 7,
      startsOn: '2026-09-02',
      documentType: null,
      documentNumber: null,
      jshshir: String(31405140000000 + count),
      phone: null,
      email: null,
      address: null,
      region: null,
      previousSchool: null,
      diagnosticScore: null,
      scholarship: { type: 'none', coverage: null, amount: null },
      consentSignedOn: null,
      contract: { number: `LV-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives: relativesInput(),
      ...overrides,
    };
  }

  async function create(
    overrides: Record<string, unknown> = {},
    branch = '',
  ): Promise<StudentDetail> {
    const response = await t.postStudent(branch || t.north, body(overrides));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  const detail = async (id: string, cookie = t.admin) => {
    const response = await t.get(`/api/people/students/${id}`, t.north, cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return studentDetailSchema.parse(response.body);
  };

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  const accepted = (response: Response): StudentDetail => {
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return studentDetailSchema.parse(response.body);
  };

  const leave = (
    student: StudentDetail,
    lastDay: string,
    cookie = t.admin,
    version = student.version,
  ) =>
    t.post(
      `/api/people/students/${student.id}/leaving`,
      t.north,
      { lastDay, reason: 'The family moved to another city.', version },
      cookie,
    );

  /** A return into grade 8, into the kit's class of grade 8 of the date (task 3.3b, decision 1). */
  const giveBack = async (
    student: StudentDetail,
    from: string,
    number: string,
    version = student.version,
    cookie = t.admin,
  ) =>
    t.post(
      `/api/people/students/${student.id}/return`,
      t.north,
      {
        from,
        grade: 8,
        classId: await t.classOf(t.north, 8, from),
        contract: { number, signedOn: from },
        reason: null,
        version,
      },
      cookie,
    );

  const remove = (student: StudentDetail, version = student.version, cookie = t.admin) =>
    t.post(
      `/api/people/students/${student.id}/delete`,
      t.north,
      { reason: 'Created twice by mistake.', version },
      cookie,
    );

  /** Every row of the tables the routes write and the audit count, in both branches. */
  async function snapshot(): Promise<Record<string, unknown>> {
    const rows: Record<string, unknown> = { audit: await t.auditCount() };
    for (const table of [
      'students',
      'student_uids',
      'student_contracts',
      'student_statuses',
      'student_accounts',
      // Task 3.3b: the return and the restore write class and group rows (permission review).
      'class_memberships',
      'group_memberships',
      // Task 8.6: the leaving and the return void and open journal cells.
      'journal_cells',
      'journal_voids',
      'journal_optional_cells',
    ] as const) {
      rows[table] = (
        await sql`select * from ${sql.table(table)} order by 1, 2`.execute(t.database.migrator)
      ).rows;
    }
    return rows;
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
  async function holdOpen(branch: string, work: (transaction: Transaction) => Promise<void>) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const done = t.app.get(Transactions).run([branch], async (transaction) => {
      await work(transaction);
      ready();
      await released;
    });
    await Promise.race([isReady, done]);
    return { release, done };
  }

  /** The held side runs first and holds its locks; the real route waits, then answers. */
  async function race(
    held: (transaction: Transaction) => Promise<void>,
    route: () => Promise<Response>,
  ): Promise<Response> {
    const hold = await holdOpen(t.north, held);
    const answer = route().then((response) => response);
    await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
    hold.release();
    await hold.done;
    return answer;
  }

  /** What the routes do first: the student row locked. */
  const lockStudent = (transaction: Transaction, id: string) =>
    transaction.selectFrom('students').select('id').where('id', '=', id).forUpdate().execute();

  /** The writes of a leaving from a date, after the lock, its class rows cut (task 3.1b). */
  async function heldLeave(transaction: Transaction, id: string, from: string): Promise<void> {
    await lockStudent(transaction, id);
    await transaction
      .updateTable('student_statuses')
      .set({ valid_until: from })
      .where('student_id', '=', id)
      .where('valid_until', 'is', null)
      .execute();
    const leaving = await transaction
      .insertInto('student_statuses')
      .values({
        student_id: id,
        branch_id: t.north,
        status: 'inactive',
        valid_from: from,
        cause: 'leaving',
        reason: 'Held',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable('class_memberships')
      .set({
        valid_until: sql<string>`greatest(valid_from, ${from}::date)`,
        ended_by: 'leaving',
        leaving_id: leaving.id,
      })
      .where('student_id', '=', id)
      .where('valid_until', '>', from)
      .whereRef('valid_from', '<', 'valid_until')
      .execute();
  }

  /** The writes of a return from a date with a contract and its class row, after the lock. */
  async function heldReturn(
    transaction: Transaction,
    id: string,
    from: string,
    number: string,
  ): Promise<void> {
    await lockStudent(transaction, id);
    await transaction
      .updateTable('student_statuses')
      .set({ valid_until: from })
      .where('student_id', '=', id)
      .where('valid_until', 'is', null)
      .execute();
    await transaction
      .insertInto('student_statuses')
      .values({
        student_id: id,
        branch_id: t.north,
        status: 'active',
        valid_from: from,
        cause: 'return',
      })
      .execute();
    await transaction
      .insertInto('student_contracts')
      .values({ student_id: id, branch_id: t.north, number, signed_on: from })
      .execute();
    // Task 3.3b: a return writes its class row too (the kit's class of grade 7).
    await transaction
      .insertInto('class_memberships')
      .values({
        branch_id: t.north,
        student_id: id,
        class_id: (await t.classOf(t.north, 7, from)) ?? UNKNOWN,
        valid_from: from,
        valid_until: '2027-06-01',
        own_until: '2027-06-01',
        cause: 'return',
      })
      .execute();
  }

  const heldDelete = async (transaction: Transaction, id: string) => {
    await lockStudent(transaction, id);
    await transaction.deleteFrom('students').where('id', '=', id).execute();
  };

  /** The writes of a create, with a contract number of its own. */
  async function heldCreate(transaction: Transaction, uid: string, number: string): Promise<void> {
    const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
    const id = found.rows[0]?.id ?? '';
    const admin = await transaction
      .selectFrom('accounts')
      .select('id')
      .orderBy('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('students')
      .values({
        id,
        branch_id: t.north,
        uid,
        first_name: 'Ziyoda',
        last_name: 'Holmatova',
        name_key: studentNameKey('Holmatova', 'Ziyoda'),
        sex: 'female',
        birth_date: '2013-05-05',
        grade: 7,
        starts_on: '2026-09-02',
        created_by: admin.id,
      })
      .execute();
    await transaction
      .insertInto('student_uids')
      .values({ uid, student_id: id, branch_id: t.north, held_from: MOMENT })
      .execute();
    await transaction
      .insertInto('student_contracts')
      .values({ student_id: id, branch_id: t.north, number, signed_on: '2026-08-20' })
      .execute();
    await linkRelative(transaction, id, t.north, MOMENT);
  }

  async function signedIn(first: string, last: string, role: string, branchId: string | null) {
    const browser = await t.kit.fullSession(first, last);
    await t.kit.giveRole(browser.account.id, {
      role: role as never,
      ...(branchId === null ? {} : { branchId }),
    });
    return browser.cookie;
  }

  /** A graduated student, as the year close of task 9.5a will write one (migrator). */
  async function graduated(): Promise<StudentDetail> {
    const student = await create();
    // No route ends a class row at a graduation before 9.5a: the row goes first.
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
    return detail(student.id);
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    const yearIds: string[] = [];
    for (const [branch, start, end] of [
      [t.north, '2025-09-01', '2026-05-31'],
      [t.north, '2026-09-01', '2027-05-31'],
      [t.north, '2027-09-01', '2028-05-31'],
      [t.south, '2026-09-01', '2027-05-31'],
    ] as const) {
      await t.database.migrator.transaction().execute(async (transaction) => {
        const year = await transaction
          .insertInto('academic_years')
          .values({ branch_id: branch, start_date: start, end_date: end })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const number of [1, 2, 3, 4]) {
          await transaction
            .insertInto('quarters')
            .values({ branch_id: branch, academic_year_id: year.id, number })
            .execute();
        }
        yearIds.push(year.id);
      });
    }
    closedYearStudent = await create({ startsOn: '2025-09-02' });
    const closed = yearIds[0] ?? '';
    currentYear = yearIds[1] ?? '';
    for (const status of ['current', 'closed']) {
      await t.database.migrator
        .updateTable('academic_years')
        .set({ status })
        .where('id', '=', closed)
        .execute();
    }
    spiritual = await signedIn('Gulnora', 'Tosheva', 'spiritual_vice_principal', t.north);
    headTutor = await signedIn('Malika', 'Yusupova', 'head_tutor', t.north);
    tutor = await signedIn('Sardor', 'Rahimov', 'tutor', t.north);
    headTeacher = await signedIn('Feruza', 'Nazarova', 'head_teacher', t.north);
    seniorHeadTeacher = await signedIn('Nodir', 'Usmonov', 'senior_head_teacher', null);
  });

  afterEach(() => {
    t.clock.set(START);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('leaving (04: "Asks for confirmation, date and reason")', () => {
    it('schedules a leaving whose last day is today, shown as a badge, and logs it', async () => {
      const student = await create();
      const response = await leave(student, '2026-10-10', t.vicePrincipal);
      const left = accepted(response);
      expect(left).toMatchObject({
        status: 'active',
        planned: { status: 'inactive', from: '2026-10-11' },
        // Two status rows and the class row the leaving cut (task 3.1b, decision 17).
        version: 3,
      });
      expect(left.statuses).toEqual([
        { status: 'active', from: '2026-09-02', until: '2026-10-11', cause: 'start', reason: null },
        {
          status: 'inactive',
          from: '2026-10-11',
          until: null,
          cause: 'leaving',
          reason: 'The family moved to another city.',
        },
      ]);
      const list = studentListSchema.parse((await t.get('/api/people/students', t.north)).body);
      expect(list.students.find((item) => item.id === student.id)).toMatchObject({
        planned: { status: 'inactive', from: '2026-10-11' },
        version: 3,
      });
      expect(list.canArchive).toBe(true);
      for (const viewer of [t.principal, headTutor]) {
        const theirs = studentListSchema.parse(
          (await t.get('/api/people/students', t.north, viewer)).body,
        );
        expect(theirs.canArchive).toBe(false);
      }
      expect(await detail(student.id, t.principal)).toMatchObject({
        canArchive: false,
        canRestoreGraduated: false,
        deletable: false,
      });
      const [entry] = await t.entries('student.leave', student.id);
      expect(entry).toMatchObject({
        branch_id: t.north,
        assignment_id: t.viceAssignment,
        request_id: response.headers['x-request-id'],
        reason: 'The family moved to another city.',
      });
      // The next day, by the injected clock, the leaving is in force.
      t.clock.set(NEXT_DAY);
      expect(await detail(student.id)).toMatchObject({ status: 'inactive', planned: null });
    });

    it('records a past last day (edge: "leaving is recorded on 15 October")', async () => {
      const student = await create();
      const left = accepted(await leave(student, '2026-10-01'));
      expect(left).toMatchObject({ status: 'inactive', planned: null });
      expect(left.uid).toBe(student.uid);
    });

    it('shows the reason to the Financial readers only (decision 9)', async () => {
      const student = await create();
      accepted(await leave(student, '2026-10-01'));
      // Task 3.6a (L59): the Head Tutor reads Financial, so the reason; the
      // Spiritual VP reads neither.
      const forSpiritual = await detail(student.id, spiritual);
      expect(forSpiritual.statuses.map((row) => row.reason)).toEqual([null, null]);
      expect(forSpiritual.statuses.map((row) => row.cause)).toEqual(['start', 'leaving']);
      for (const reader of [t.principal, headTutor]) {
        expect((await detail(student.id, reader)).statuses[1]?.reason).toBe(
          'The family moved to another city.',
        );
      }
      expect(await detail(student.id, headTutor)).toMatchObject({
        canArchive: false,
        deletable: false,
      });
    });

    it('replaces a scheduled leaving with a new one (edge: "It can be changed")', async () => {
      const student = await create();
      const first = accepted(await leave(student, '2026-11-30'));
      const second = accepted(await leave(first, '2026-10-20'));
      expect(second.planned).toEqual({ status: 'inactive', from: '2026-10-21' });
      expect(second.statuses.filter((row) => row.status === 'inactive')).toHaveLength(1);
    });

    it('refuses a last day before the start, a leaving of an inactive student and a closed year', async () => {
      const student = await create();
      refusedWith(await leave(student, '2026-08-20'), 409, 'leaving_before_start');
      const left = accepted(await leave(student, '2026-10-01'));
      refusedWith(await leave(left, '2026-10-05'), 409, 'student_not_active');
      const before = await snapshot();
      refusedWith(await leave(closedYearStudent, '2026-05-10'), 409, 'date_in_closed_year');
      expect(await snapshot()).toEqual(before);
    });

    it('lets a student who never started leave on the day before the start', async () => {
      const student = await create({ startsOn: '2026-11-02' });
      const left = accepted(await leave(student, '2026-11-01'));
      expect(left.statuses).toEqual([
        {
          status: 'inactive',
          from: '2026-11-02',
          until: null,
          cause: 'leaving',
          reason: 'The family moved to another city.',
        },
      ]);
    });

    it('wants a reason and the version', async () => {
      const student = await create();
      for (const input of [
        { lastDay: '2026-10-10', reason: '', version: 1 },
        { lastDay: '2026-10-10', reason: 'Moved.' },
        { lastDay: '10.10.2026', reason: 'Moved.', version: 1 },
      ]) {
        refusedWith(
          await t.post(`/api/people/students/${student.id}/leaving`, t.north, input),
          400,
          'validation_failed',
        );
      }
    });
  });

  describe('cancel and undo (edge: "cancelled until the date"; "undo leaving")', () => {
    it('cancels a scheduled leaving until its date, then only undoes it with a reason', async () => {
      const student = await create();
      const scheduled = accepted(await leave(student, '2026-10-10'));
      const cancelled = accepted(
        await t.post(`/api/people/students/${student.id}/leaving/cancel`, t.north, {
          version: scheduled.version,
        }),
      );
      // Three status rows and one class row: the cut row grew back (task
      // 3.5c, H36: "a cancel or an undo gives the stay back as it was before").
      expect(cancelled).toMatchObject({ status: 'active', planned: null, version: 4 });
      const stay = await t.database.migrator
        .selectFrom('class_memberships')
        .select(['valid_from', 'valid_until', 'own_until', 'ended_by'])
        .where('student_id', '=', student.id)
        .execute();
      expect(stay).toHaveLength(1);
      expect(stay[0]).toMatchObject({ valid_from: '2026-09-02', ended_by: null });
      expect(stay[0]?.valid_until).toBe(stay[0]?.own_until);
      expect(await t.entries('student.leave_cancelled', student.id)).toHaveLength(1);
      // One unbroken line (issue #39, hand test of 13 October 2026, finding 7).
      expect(cancelled.statuses.map((row) => [row.status, row.from, row.until, row.cause])).toEqual(
        [['active', '2026-09-02', null, 'start']],
      );

      const again = accepted(await leave(cancelled, '2026-10-10'));
      t.clock.set(NEXT_DAY);
      refusedWith(
        await t.post(`/api/people/students/${student.id}/leaving/cancel`, t.north, {
          version: again.version,
        }),
        409,
        'leaving_in_force',
      );
      const undone = accepted(
        await t.post(`/api/people/students/${student.id}/leaving/undo`, t.north, {
          reason: 'Entered for the wrong student.',
          version: again.version,
        }),
      );
      expect(undone).toMatchObject({ status: 'active', planned: null });
      // The undo leaves no break on the record (finding 7 of the hand test of
      // 13 October 2026, correction 3 of the review of pull request #77): the
      // line holds the first day; the undo's row and its reason stay stored
      // and in the audit log.
      expect(undone.statuses.map((row) => [row.status, row.from, row.until, row.cause])).toEqual([
        ['active', '2026-09-02', null, 'start'],
      ]);
      const stored = await t.database.migrator
        .selectFrom('student_statuses')
        .select(['status', 'valid_from', 'valid_until', 'cause', 'reason'])
        .where('student_id', '=', student.id)
        .where('cause', '=', 'undo')
        .execute();
      expect(stored).toEqual([
        {
          status: 'active',
          valid_from: '2026-10-11',
          valid_until: null,
          cause: 'undo',
          reason: 'Entered for the wrong student.',
        },
      ]);
      const [entry] = await t.entries('student.leave_undone', student.id);
      expect(entry?.reason).toBe('Entered for the wrong student.');
    });

    it('lets the Academic Vice Principal cancel and undo, naming the assignment', async () => {
      const one = accepted(await leave(await create(), '2026-10-20', t.vicePrincipal));
      accepted(
        await t.post(
          `/api/people/students/${one.id}/leaving/cancel`,
          t.north,
          { version: one.version },
          t.vicePrincipal,
        ),
      );
      expect((await t.entries('student.leave_cancelled', one.id))[0]).toMatchObject({
        assignment_id: t.viceAssignment,
      });
      const two = accepted(await leave(await create(), '2026-10-01', t.vicePrincipal));
      accepted(
        await t.post(
          `/api/people/students/${two.id}/leaving/undo`,
          t.north,
          { reason: 'Entered by mistake.', version: two.version },
          t.vicePrincipal,
        ),
      );
      expect((await t.entries('student.leave_undone', two.id))[0]).toMatchObject({
        assignment_id: t.viceAssignment,
        reason: 'Entered by mistake.',
      });
    });

    it('refuses a cancel with nothing scheduled and an undo of a scheduled leaving or a graduation', async () => {
      const student = await create();
      refusedWith(
        await t.post(`/api/people/students/${student.id}/leaving/cancel`, t.north, {
          version: student.version,
        }),
        409,
        'leaving_not_planned',
      );
      const scheduled = accepted(await leave(student, '2026-10-20'));
      refusedWith(
        await t.post(`/api/people/students/${student.id}/leaving/undo`, t.north, {
          reason: 'Why',
          version: scheduled.version,
        }),
        409,
        'student_not_inactive',
      );
      const done = await graduated();
      refusedWith(
        await t.post(`/api/people/students/${done.id}/leaving/undo`, t.north, {
          reason: 'Why',
          version: done.version,
        }),
        409,
        'student_not_inactive',
      );
    });
  });

  describe('return (the done-when: "a leaving and a return keep the UID and history")', () => {
    it('brings the student back with the same UID, every row and a new contract', async () => {
      const student = await create();
      const left = accepted(await leave(student, '2026-09-30'));
      const response = await giveBack(
        left,
        '2026-10-05',
        'LV-RETURN/1',
        left.version,
        t.vicePrincipal,
      );
      const back = accepted(response);
      // Three status rows, the class row the leaving cut and the class row of
      // the return (task 3.3b, decision 1).
      expect(back).toMatchObject({ uid: student.uid, status: 'active', grade: 8, version: 5 });
      expect(back.statuses.map((row) => [row.status, row.from, row.until, row.cause])).toEqual([
        ['active', '2026-09-02', '2026-10-01', 'start'],
        ['inactive', '2026-10-01', '2026-10-05', 'leaving'],
        ['active', '2026-10-05', null, 'return'],
      ]);
      expect(back.financial?.contracts.map((contract) => contract.number)).toEqual([
        'LV-RETURN/1',
        student.financial?.contracts[0]?.number,
      ]);
      const uids = await t.database.migrator
        .selectFrom('student_uids')
        .select('uid')
        .where('student_id', '=', student.id)
        .execute();
      expect(uids).toEqual([{ uid: student.uid }]);
      const [entry] = await t.entries('student.return', student.id);
      expect(entry).toMatchObject({ assignment_id: t.viceAssignment });
      expect(entry?.old_value).toMatchObject({ grade: 7 });
      expect(entry?.new_value).toMatchObject({ grade: 8 });

      // An edit after the return corrects the return's contract (finding 14).
      const edited = await t.put(`/api/people/students/${student.id}`, t.north, {
        ...editOf(back),
        contract: { number: 'LV-RETURN/1A', signedOn: '2026-10-05' },
      });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(
        studentDetailSchema.parse(edited.body).financial?.contracts.map((one) => one.number),
      ).toEqual(['LV-RETURN/1A', student.financial?.contracts[0]?.number]);
    });

    it('refuses the first inactive day, a date after today, an active student and a taken contract', async () => {
      const student = await create();
      refusedWith(await giveBack(student, '2026-10-05', 'LV-R/2'), 409, 'student_not_inactive');
      const left = accepted(await leave(student, '2026-09-30'));
      refusedWith(await giveBack(left, '2026-10-01', 'LV-R/3'), 409, 'return_too_early');
      refusedWith(await giveBack(left, '2026-10-11', 'LV-R/4'), 409, 'status_date_future');
      const other = await create();
      const taken = await giveBack(
        left,
        '2026-10-05',
        String(other.financial?.contracts[0]?.number),
      );
      refusedWith(taken, 409, 'student_value_taken');
      expect(apiErrorSchema.parse(taken.body).error.details?.[0]).toMatchObject({
        path: 'contract.number',
        recordId: other.id,
      });
      const south = await create({}, t.south);
      const elsewhere = await giveBack(
        left,
        '2026-10-05',
        String(south.financial?.contracts[0]?.number),
      );
      refusedWith(elsewhere, 409, 'student_value_taken');
      expect(apiErrorSchema.parse(elsewhere.body).error.details?.[0]).toMatchObject({
        path: 'contract.number',
        code: 'held_elsewhere',
      });
      expect((await detail(student.id)).status).toBe('inactive');
    });
  });

  // Task 9.2b (From 2.4b-1, pull request #68): edge/students-classes-groups, "A student stopped
  // coming on 1 October": "A date in a closed quarter is refused." A branch of its own with
  // dated quarters (quarter 1 to 4 October, quarter 2 from 5 October), its students written
  // before quarter 1 is closed: a closed quarter refuses the fixture's rows too.
  describe('a closed quarter (task 9.2b)', () => {
    it('refuses a leaving, an undo and a return dated in a closed quarter, and takes them dated after it', async () => {
      const branch = await t.newBranch();
      await t.database.migrator.transaction().execute(async (transaction) => {
        const year = await transaction
          .insertInto('academic_years')
          .values({ branch_id: branch, start_date: '2026-09-01', end_date: '2027-05-31' })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const [number, start, end] of [
          [1, '2026-09-01', '2026-10-04'],
          [2, '2026-10-05', '2026-12-27'],
          [3, '2027-01-11', '2027-03-20'],
          [4, '2027-03-28', '2027-05-31'],
        ] as const) {
          await transaction
            .insertInto('quarters')
            .values({
              branch_id: branch,
              academic_year_id: year.id,
              number,
              start_date: start,
              end_date: end,
            })
            .execute();
        }
        await transaction
          .updateTable('academic_years')
          .set({ status: 'current' })
          .where('id', '=', year.id)
          .execute();
      });
      const first = await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('branch_id', '=', branch)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow();
      const classId = (await t.classOf(branch, 7, '2026-09-02')) ?? UNKNOWN;
      const staying = await create({ classId }, branch);
      const leaving = await create({ classId }, branch);
      const version = async (id: string) =>
        studentDetailSchema.parse((await t.get(`/api/people/students/${id}`, branch)).body).version;
      const leave = async (id: string, lastDay: string) =>
        t.post(`/api/people/students/${id}/leaving`, branch, {
          lastDay,
          reason: 'The family moved to another city.',
          version: await version(id),
        });
      const giveBack = async (id: string, from: string) =>
        t.post(`/api/people/students/${id}/return`, branch, {
          from,
          grade: 7,
          classId,
          contract: { number: `LV-QUARTER/${from}`, signedOn: from },
          reason: null,
          version: await version(id),
        });
      // Left from 1 October, a day of quarter 1, while it was open.
      accepted(await leave(leaving.id, '2026-09-30'));
      await closeQuarter(t.database, {
        branchId: branch,
        quarterId: first.id,
        accountId: (
          await t.database.migrator
            .selectFrom('accounts')
            .select('id')
            .orderBy('id')
            .executeTakeFirstOrThrow()
        ).id,
      });
      const before = await snapshot();
      refusedWith(await leave(staying.id, '2026-10-01'), 409, 'date_in_closed_quarter');
      // An unknown student is 404 before the quarter's refusal (`.claude/rules/api.md`).
      refusedWith(
        await t.post(`/api/people/students/${UNKNOWN}/leaving`, branch, {
          lastDay: '2026-10-01',
          reason: 'The family moved to another city.',
          version: 1,
        }),
        404,
        'not_found',
      );
      refusedWith(
        await t.post(`/api/people/students/${leaving.id}/leaving/undo`, branch, {
          reason: 'Entered by mistake.',
          version: await version(leaving.id),
        }),
        409,
        'date_in_closed_quarter',
      );
      refusedWith(await giveBack(leaving.id, '2026-10-02'), 409, 'date_in_closed_quarter');
      expect(await snapshot()).toEqual(before);
      // Dates in quarter 2 are taken.
      const left = accepted(await leave(staying.id, '2026-10-06'));
      expect(left.statuses.map((row) => [row.status, row.from, row.until])).toEqual([
        ['active', '2026-09-02', '2026-10-07'],
        ['inactive', '2026-10-07', null],
      ]);
      const back = accepted(await giveBack(leaving.id, '2026-10-05'));
      expect(back.statuses.map((row) => [row.status, row.from, row.until])).toEqual([
        ['active', '2026-09-02', '2026-10-01'],
        ['inactive', '2026-10-01', '2026-10-05'],
        ['active', '2026-10-05', null],
      ]);
    });
  });

  describe('the restore of a graduated student (edge: "graduated by mistake")', () => {
    it('lets the Super Admin restore with a reason, and refuses the Academic Vice Principal', async () => {
      const student = await graduated();
      expect(student).toMatchObject({ status: 'graduated', canRestoreGraduated: true });
      expect((await detail(student.id, t.vicePrincipal)).canRestoreGraduated).toBe(false);
      const input = {
        from: '2026-10-01',
        classId: await t.classOf(t.north, 7, '2026-10-01'),
        reason: 'Grade 10, not 11.',
        version: student.version,
      };
      refusedWith(
        await t.post(`/api/people/students/${student.id}/restore`, t.north, input, t.vicePrincipal),
        403,
        'permission_denied',
      );
      refusedWith(
        await t.post(`/api/people/students/${student.id}/restore`, t.north, {
          ...input,
          from: '2026-09-30',
        }),
        409,
        'restore_before_graduation',
      );
      const response = await t.post(`/api/people/students/${student.id}/restore`, t.north, input);
      const restored = accepted(response);
      expect(restored).toMatchObject({ status: 'active' });
      expect(restored.statuses.at(-1)).toMatchObject({
        cause: 'restore',
        reason: 'Grade 10, not 11.',
      });
      const [entry] = await t.entries('student.graduate_restored', student.id);
      expect(entry).toMatchObject({ assignment_id: t.adminAssignment });
      refusedWith(
        await t.post(`/api/people/students/${student.id}/restore`, t.north, {
          ...input,
          version: restored.version,
        }),
        409,
        'student_not_graduated',
      );
    });
  });

  describe('the delete of a student created twice (edge; decisions 3, 4 and 14)', () => {
    it('deletes a student without data, keeps the UID for good and logs the whole record', async () => {
      const student = await create();
      expect(student.deletable).toBe(true);
      const response = await remove(student, student.version, t.vicePrincipal);
      expect(response.status, JSON.stringify(response.body)).toBe(204);
      refusedWith(await t.get(`/api/people/students/${student.id}`, t.north), 404, 'not_found');
      const [entry] = await t.entries('student.delete', student.id);
      expect(entry).toMatchObject({
        assignment_id: t.viceAssignment,
        reason: 'Created twice by mistake.',
      });
      const old = entry?.old_value as Record<string, unknown>;
      expect(old.uids).toEqual([student.uid]);
      expect((old.contracts as unknown[]).length).toBe(1);
      expect((old.statuses as unknown[]).length).toBe(1);

      const again = await t.postStudent(t.north, body({ uid: student.uid }));
      refusedWith(again, 409, 'student_value_taken');
      const detailOf = apiErrorSchema.parse(again.body).error.details?.[0];
      expect(detailOf).toMatchObject({ path: 'uid', code: 'uid_released' });
      expect(detailOf?.recordId).toBeUndefined();
    });

    it('refuses a student with a scholarship, a leaving or a second contract', async () => {
      const scholar = await create({
        scholarship: { type: 'gift', coverage: 'full', amount: null },
      });
      expect(scholar.deletable).toBe(false);
      const left = accepted(await leave(await create(), '2026-10-01'));
      expect(left.deletable).toBe(false);
      const back = accepted(await giveBack(left, '2026-10-05', 'LV-DEL/1'));
      expect(back.deletable).toBe(false);
      const before = await snapshot();
      for (const student of [scholar, left, back]) {
        const fresh = await detail(student.id);
        refusedWith(await remove(fresh), 409, 'student_has_data');
      }
      expect(await snapshot()).toEqual(before);
    });

    it('refuses a student with a journal cell (task 6.1a, From 2.4b-1)', async () => {
      const cells = await CellsKit.create(t.database.migrator);
      const student = await create();
      const lesson = await cells.lesson(
        t.north,
        currentYear,
        student.class?.id ?? '',
        '2026-10-12',
      );
      await cells.cell(t.north, {
        lessonId: lesson,
        studentId: student.id,
        mark: 1,
        by: await cells.lessons.load.classes.account(),
        at: t.clock.now().toISOString(),
      });
      const fresh = await detail(student.id);
      expect(fresh.deletable).toBe(false);
      const before = await snapshot();
      refusedWith(await remove(fresh), 409, 'student_has_data');
      expect(await snapshot()).toEqual(before);
    });

    it('refuses a student whose only reason of absence, a cleared one, is one this branch does not see, by the key (task 6.3)', async () => {
      const student = await create();
      const by = await (await CellsKit.create(t.database.migrator)).lessons.load.classes.account();
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`select set_config('app.now', ${t.clock.now().toISOString()}, true)`.execute(
          transaction,
        );
        await transaction
          .insertInto('student_absence_reasons')
          .values({
            // Kept in the branch of its date after a move (0113): out of this branch's sight.
            branch_id: t.south,
            student_id: student.id,
            absence_date: '2026-10-12',
            category: null,
            note: '',
            changed_by: by,
            changed_at: t.clock.now(),
          })
          .execute();
      });
      const fresh = await detail(student.id);
      const before = await snapshot();
      refusedWith(await remove(fresh), 409, 'student_has_data');
      expect(await snapshot()).toEqual(before);
    });

    it('refuses a student whose only mark is kept by a forced delete of another branch that can still be restored, and deletes once its 30 days are over (task 6.1b-2, decision 7)', async () => {
      const student = await create();
      const by = await t.database.migrator
        .selectFrom('accounts')
        .select('id')
        .executeTakeFirstOrThrow();
      const store = await markInStore(t.database.migrator, {
        branchId: t.south,
        studentId: student.id,
        by: by.id,
        at: t.clock.now().toISOString(),
      });
      const fresh = await detail(student.id);
      const before = await snapshot();
      refusedWith(await remove(fresh), 409, 'student_has_data');
      expect(await snapshot()).toEqual(before);
      // Its 30 days over: the mark can no longer come back, and nothing holds the student.
      await t.database.migrator
        .updateTable('forced_deletes')
        .set({ restore_until: t.clock.now() })
        .where('id', '=', store)
        .execute();
      expect((await remove(await detail(student.id))).status).toBe(204);
    });

    it('deletes a student whose cells are all empty, the history kept (decision 13)', async () => {
      const cells = await CellsKit.create(t.database.migrator);
      const student = await create();
      const lesson = await cells.lesson(
        t.north,
        currentYear,
        student.class?.id ?? '',
        '2026-10-12',
      );
      const by = await cells.lessons.load.classes.account();
      const cell = await cells.cell(t.north, {
        lessonId: lesson,
        studentId: student.id,
        mark: 1,
        by,
        at: t.clock.now().toISOString(),
      });
      await cells.clear(cell, by, t.clock.now().toISOString());
      const fresh = await detail(student.id);
      expect(fresh.deletable).toBe(true);
      expect((await remove(fresh)).status).toBe(204);
      const lines = await t.database.migrator
        .selectFrom('journal_cell_history')
        .select('version')
        .where('cell_id', '=', cell)
        .execute();
      expect(lines).toHaveLength(2);
    });

    it('refuses a student whose only cell this branch does not see, by the key', async () => {
      const cells = await CellsKit.create(t.database.migrator);
      // A student of the other branch with a cell there, who then moved here:
      // the cell stays with its lesson's branch (0108), out of this branch's sight.
      const student = await create({}, t.south);
      const southYear = await t.database.migrator
        .selectFrom('academic_years')
        .select('id')
        .where('branch_id', '=', t.south)
        .executeTakeFirstOrThrow();
      const lesson = await cells.lesson(
        t.south,
        southYear.id,
        student.class?.id ?? '',
        '2026-10-12',
      );
      await cells.cell(t.south, {
        lessonId: lesson,
        studentId: student.id,
        mark: 1,
        by: await cells.lessons.load.classes.account(),
        at: t.clock.now().toISOString(),
      });
      await moveStudentBranch(t.database.migrator, student.id, t.south, t.north);
      const fresh = await detail(student.id);
      expect(fresh.deletable).toBe(true);
      const before = await snapshot();
      refusedWith(await remove(fresh), 409, 'student_has_data');
      expect(await snapshot()).toEqual(before);
    });

    it('deletes a student whose leaving was cancelled', async () => {
      const student = await create();
      const scheduled = accepted(await leave(student, '2026-10-20'));
      expect(scheduled.deletable).toBe(false);
      const cancelled = accepted(
        await t.post(`/api/people/students/${student.id}/leaving/cancel`, t.north, {
          version: scheduled.version,
        }),
      );
      expect(cancelled.deletable).toBe(true);
      expect((await remove(cancelled)).status).toBe(204);
    });
  });

  describe('a change made on an older state (edge: "student changed, reload")', () => {
    it('refuses every route sent with an old version', async () => {
      const student = await create();
      accepted(await leave(student, '2026-10-20'));
      refusedWith(await leave(student, '2026-10-25'), 409, 'student_changed');
      refusedWith(
        await t.post(`/api/people/students/${student.id}/leaving/cancel`, t.north, { version: 1 }),
        409,
        'student_changed',
      );
      refusedWith(await remove(student, 1), 409, 'student_changed');
    });
  });

  describe('refusals by role and branch', () => {
    it('refuses every route to every role but the Super Admin and the Academic VP', async () => {
      const student = await create();
      const before = await snapshot();
      for (const cookie of [
        t.principal,
        spiritual,
        headTutor,
        tutor,
        headTeacher,
        seniorHeadTeacher,
        t.teacher,
      ]) {
        for (const [path, input] of await routes(student)) {
          refusedWith(await t.post(path, t.north, input, cookie), 403, 'permission_denied');
        }
      }
      expect(await snapshot()).toEqual(before);
    });

    it('answers 404 for a student of another branch or an unknown id on every route', async () => {
      const south = await create({}, t.south);
      const before = await snapshot();
      for (const id of [south.id, UNKNOWN]) {
        for (const [path, input] of await routes({ ...south, id })) {
          refusedWith(await t.post(path, t.north, input), 404, 'not_found');
        }
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('two changes at the same moment (the student row locked first)', () => {
    it('refuses the second of two leavings, both orders being the same route', async () => {
      const student = await create();
      const response = await race(
        (transaction) => heldLeave(transaction, student.id, '2026-10-21'),
        () => leave(student, '2026-10-25'),
      );
      refusedWith(response, 409, 'student_changed');
    });

    it('refuses a return that waited for an undo, and an undo that waited for a return', async () => {
      const one = accepted(await leave(await create(), '2026-09-30'));
      const undone = await race(
        async (transaction) => {
          await lockStudent(transaction, one.id);
          await transaction
            .updateTable('student_statuses')
            .set({ valid_until: '2026-10-01' })
            .where('student_id', '=', one.id)
            .where('valid_until', 'is', null)
            .execute();
          await transaction
            .insertInto('student_statuses')
            .values({
              student_id: one.id,
              branch_id: t.north,
              status: 'active',
              valid_from: '2026-10-01',
              cause: 'undo',
              reason: 'Held',
            })
            .execute();
        },
        () => giveBack(one, '2026-10-05', 'LV-RACE/1'),
      );
      refusedWith(undone, 409, 'student_changed');

      const two = accepted(await leave(await create(), '2026-09-30'));
      const returned = await race(
        (transaction) => heldReturn(transaction, two.id, '2026-10-05', 'LV-RACE/2'),
        () =>
          t.post(`/api/people/students/${two.id}/leaving/undo`, t.north, {
            reason: 'Mistake',
            version: two.version,
          }),
      );
      refusedWith(returned, 409, 'student_changed');
    });

    it('refuses a leaving that waited for a return, and a return that waited for a leaving', async () => {
      const one = accepted(await leave(await create(), '2026-09-30'));
      refusedWith(
        await race(
          (transaction) => heldReturn(transaction, one.id, '2026-10-05', 'LV-RACE/3'),
          () => leave(one, '2026-10-08'),
        ),
        409,
        'student_changed',
      );
      const two = await create();
      refusedWith(
        await race(
          (transaction) => heldLeave(transaction, two.id, '2026-10-01'),
          () => giveBack(two, '2026-10-05', 'LV-RACE/4'),
        ),
        409,
        'student_changed',
      );
    });

    it('answers 404 to a leaving that waited for a delete, and refuses a delete that waited for a leaving', async () => {
      const one = await create();
      refusedWith(
        await race(
          (transaction) => heldDelete(transaction, one.id),
          () => leave(one, '2026-10-20'),
        ),
        404,
        'not_found',
      );
      const two = await create();
      refusedWith(
        await race(
          (transaction) => heldLeave(transaction, two.id, '2026-10-21'),
          () => remove(two),
        ),
        409,
        'student_changed',
      );
    });

    it('answers 404 to an edit or a UID correction that waited for a delete, and deletes after either', async () => {
      const one = await create();
      refusedWith(
        await race(
          (transaction) => heldDelete(transaction, one.id),
          () => t.put(`/api/people/students/${one.id}`, t.north, editOf(one)),
        ),
        404,
        'not_found',
      );
      const two = await create();
      refusedWith(
        await race(
          (transaction) => heldDelete(transaction, two.id),
          () =>
            t.put(`/api/people/students/${two.id}/uid`, t.north, {
              uid: '2607899',
              reason: 'Typo.',
              confirmUidSet: true,
            }),
        ),
        404,
        'not_found',
      );
      const three = await create();
      const afterEdit = await race(
        async (transaction) => {
          await lockStudent(transaction, three.id);
          // A field the edit writes; the grade is held by the class (task 3.1b, decision 4).
          await transaction
            .updateTable('students')
            .set({ paternal_name: 'Rustamovich' })
            .where('id', '=', three.id)
            .execute();
        },
        () => remove(three),
      );
      expect(afterEdit.status, JSON.stringify(afterEdit.body)).toBe(204);
      const four = await create();
      const afterCorrection = await race(
        async (transaction) => {
          await lockStudent(transaction, four.id);
          await transaction
            .updateTable('students')
            .set({ uid: '2607898' })
            .where('id', '=', four.id)
            .execute();
          await transaction
            .insertInto('student_uids')
            .values({ uid: '2607898', student_id: four.id, branch_id: t.north, held_from: MOMENT })
            .execute();
        },
        () => remove(four),
      );
      expect(afterCorrection.status, JSON.stringify(afterCorrection.body)).toBe(204);
      const released = await t.database.migrator
        .selectFrom('student_uids')
        .select(['uid', 'student_id'])
        .where('uid', 'in', [four.uid, '2607898'])
        .orderBy('uid')
        .execute();
      expect(released.map((row) => row.student_id)).toEqual([null, null]);
    });

    it('refuses a return or a create that claims a contract number another write holds, both ways', async () => {
      const left = accepted(await leave(await create(), '2026-09-30'));
      const returnWaited = await race(
        (transaction) => heldCreate(transaction, '2607801', 'LV-CLAIM/1'),
        () => giveBack(left, '2026-10-05', 'LV-CLAIM/1'),
      );
      refusedWith(returnWaited, 409, 'student_value_taken');

      const other = accepted(await leave(await create(), '2026-09-30'));
      const createWaited = await race(
        (transaction) => heldReturn(transaction, other.id, '2026-10-05', 'LV-CLAIM/2'),
        () =>
          t.postStudent(
            t.north,
            body({ contract: { number: 'LV-CLAIM/2', signedOn: '2026-08-20' } }),
          ),
      );
      refusedWith(createWaited, 409, 'student_value_taken');

      const editing = await create();
      const third = accepted(await leave(await create(), '2026-09-30'));
      const editWaited = await race(
        (transaction) => heldReturn(transaction, third.id, '2026-10-05', 'LV-CLAIM/3'),
        () =>
          t.put(`/api/people/students/${editing.id}`, t.north, {
            ...editOf(editing),
            contract: { number: 'LV-CLAIM/3', signedOn: '2026-08-20' },
          }),
      );
      refusedWith(editWaited, 409, 'student_value_taken');

      const fourth = accepted(await leave(await create(), '2026-09-30'));
      const editing2 = await create();
      const returnWaitedForEdit = await race(
        async (transaction) => {
          await lockStudent(transaction, editing2.id);
          await transaction
            .updateTable('student_contracts')
            .set({ number: 'LV-CLAIM/4' })
            .where('student_id', '=', editing2.id)
            .execute();
        },
        () => giveBack(fourth, '2026-10-05', 'LV-CLAIM/4'),
      );
      refusedWith(returnWaitedForEdit, 409, 'student_value_taken');
    });

    it('refuses a leaving that waited for the close of its academic year', async () => {
      const branch = await t.newBranch();
      const year = await t.database.migrator.transaction().execute(async (transaction) => {
        const created = await transaction
          .insertInto('academic_years')
          .values({ branch_id: branch, start_date: '2026-09-01', end_date: '2027-05-31' })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const number of [1, 2, 3, 4]) {
          await transaction
            .insertInto('quarters')
            .values({ branch_id: branch, academic_year_id: created.id, number })
            .execute();
        }
        return created.id;
      });
      const student = await create({}, branch);
      await t.database.migrator
        .updateTable('academic_years')
        .set({ status: 'current' })
        .where('id', '=', year)
        .execute();
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const closing = t.database.migrator.transaction().execute(async (transaction) => {
        await transaction
          .updateTable('academic_years')
          .set({ status: 'closed' })
          .where('id', '=', year)
          .execute();
        ready();
        await released;
      });
      await isReady;
      const answer = t
        .post(`/api/people/students/${student.id}/leaving`, branch, {
          lastDay: '2026-10-10',
          reason: 'Moved.',
          version: student.version,
        })
        .then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      release();
      await closing;
      refusedWith(await answer, 409, 'date_in_closed_year');
    });
  });

  /** Every route of the task with a valid body for the student. */
  async function routes(student: StudentDetail): Promise<[string, Record<string, unknown>][]> {
    const base = `/api/people/students/${student.id}`;
    // Task 3.3b: the return and the restore name a class of the branch of the request.
    const classId = await t.classOf(t.north, 7, '2026-10-05');
    return [
      [`${base}/leaving`, { lastDay: '2026-10-20', reason: 'Moved.', version: student.version }],
      [`${base}/leaving/cancel`, { version: student.version }],
      [`${base}/leaving/undo`, { reason: 'Mistake.', version: student.version }],
      [`${base}/return/cancel`, { version: student.version }],
      [
        `${base}/return`,
        {
          from: '2026-10-05',
          grade: 7,
          classId,
          contract: { number: 'LV-ROLE/1', signedOn: '2026-10-05' },
          reason: null,
          version: student.version,
        },
      ],
      [
        `${base}/restore`,
        { from: '2026-10-05', classId, reason: 'Mistake.', version: student.version },
      ],
      [`${base}/delete`, { reason: 'Twice.', version: student.version }],
    ];
  }

  /** What an edit sends: the record of the answer of a Super Admin. */
  function editOf(student: StudentDetail): Record<string, unknown> {
    if (student.identity === null || student.financial === null || student.contact === null) {
      throw new Error('An edit body is made from the answer of a reader of every group.');
    }
    const contract = student.financial.contracts[0];
    if (contract === undefined) {
      throw new Error('A student has a contract.');
    }
    return {
      firstName: student.firstName,
      lastName: student.lastName,
      paternalName: student.paternalName,
      sex: student.sex,
      birthDate: student.identity.birthDate,
      grade: student.grade,
      documentType: student.identity.documentType,
      documentNumber: student.identity.documentNumber,
      jshshir: student.identity.jshshir,
      phone: student.contact.phone,
      email: student.contact.email,
      address: student.identity.address,
      region: student.identity.region,
      previousSchool: student.financial.previousSchool,
      diagnosticScore: student.diagnosticScore,
      scholarship: student.financial.scholarship,
      consentSignedOn: student.financial.consentSignedOn,
      contract: { number: contract.number, signedOn: contract.signedOn },
    };
  }
});
