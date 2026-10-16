import {
  apiErrorSchema,
  BRANCH_HEADER,
  staffDetailSchema,
  staffListSchema,
  staffReportSchema,
  subjectListSchema,
  subjectSchema,
  type ErrorDetail,
  type StaffDetail,
  type StaffListItem,
  type Subject,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  START,
  TOMORROW,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { lockDepartmentMoves } from './department-moves.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { binary, fileOf } from '../../testing/xlsx-kit.js';

/** A start date after the kit's today (Saturday 10 October 2026) and inside the year. */
const MOVE_ON = '2026-11-02';
const STARTS_ON = '2026-10-19';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const detailsOf = (response: Response): ErrorDetail[] =>
  apiErrorSchema.parse(response.body).error.details ?? [];

/** A start date sent without a move (spec review, should-fix 4: the detail code, not only the status). */
const refusedNoMove = (response: Response) => {
  refusedWith(response, 400, 'validation_failed');
  expect(detailsOf(response)).toEqual([
    expect.objectContaining({ path: 'departmentStartsOn', code: 'no_move' }),
  ]);
};

// All names are invented. edge-cases/people-roles-accounts.md, row 15: "A
// teacher moves to another department, or a subject is moved, mid-year. Both
// changes carry a start date and are made by the Super Admin. They are refused
// while a teaching load would have a teacher outside the subject's department;
// those loads are listed for reassignment first." Task 3.4c, the plan approved
// on pull request #101 with corrections 1 to 5. The clock stands at 23:55 on
// Saturday 10 October 2026 in Tashkent.
describe('the department move against the load', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let year: string;
  let academic: string;
  let management: string;
  let steam: string;
  let national: string;
  let tutors: string;

  const put = (path: string, body: object, cookie = t.admin, branch = t.north) =>
    request(t.kit.server).put(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body);

  const detail = async (id: string, branch = t.north): Promise<StaffDetail> => {
    const response = await t.get(`/api/people/staff/${id}`, branch, t.admin);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return staffDetailSchema.parse(response.body);
  };

  /**
   * What a staff edit sends: the fields of the answer, a planned move's
   * department in place of the one in force, as the form does (task 3.6b-3).
   */
  const staffBody = (staff: StaffDetail, overrides: Record<string, unknown> = {}) => ({
    firstName: staff.firstName,
    lastName: staff.lastName,
    fatherName: staff.fatherName ?? '',
    sex: staff.sex,
    birthDate: staff.birthDate,
    educationLevel: staff.educationLevel,
    phone: staff.phone,
    email: staff.email ?? '',
    jshshir: staff.jshshir ?? '',
    admissionDate: staff.admissionDate,
    contractType: staff.contractType,
    contractDate: staff.contractDate,
    weeklyLessons: staff.weeklyLessons,
    dailyLessons: staff.dailyLessons,
    divisions: staff.divisions.map(({ divisionId, departmentId, departmentMove, main }) => ({
      divisionId,
      departmentId: departmentMove === null ? departmentId : departmentMove.departmentId,
      main,
    })),
    ...overrides,
  });

  const toDepartment = (departmentId: string | null) => [
    { divisionId: academic, departmentId, main: true },
  ];

  const subjectAnswer = async (id: string): Promise<Subject> => {
    const response = await t.get('/api/setup/subjects', t.north, t.admin);
    const found = (response.body as { subjects: unknown[] }).subjects
      .map((one) => subjectSchema.parse(one))
      .find((one) => one.id === id);
    if (found === undefined) {
      throw new Error('The subject is listed.');
    }
    return found;
  };

  /**
   * What a subject edit sends: the fields of the answer, without the branch's
   * weights; a planned move's department in place of the one in force, as the
   * form does (task 3.6b-3).
   */
  const subjectBody = (subject: Subject, overrides: Record<string, unknown> = {}) => ({
    names: subject.names,
    departmentId: subject.departmentMove?.departmentId ?? subject.departmentId,
    grades: subject.grades,
    colour: subject.colour,
    journalType: subject.journalType,
    ratingExam: subject.ratingExam,
    groupSubject: subject.groupSubject,
    languageRule: subject.languageRule,
    demanding: subject.demanding,
    // The kit's subjects have no daily distribution in the North yet.
    daily: subject.daily === null ? { attendance: 10, classwork: 50, homework: 40 } : null,
    ...overrides,
  });

  /** A subject move sent by the Super Admin, in the North unless said. */
  const moveSubjectTo = async (
    subject: string,
    department: string,
    startsOn: string,
    branch = t.north,
  ) => {
    const listedNow = await t.get('/api/setup/subjects', branch, t.admin);
    const answer = (listedNow.body as { subjects: unknown[] }).subjects
      .map((one) => subjectSchema.parse(one))
      .find((one) => one.id === subject);
    if (answer === undefined) {
      throw new Error('The subject is listed.');
    }
    return put(
      `/api/setup/subjects/${subject}`,
      subjectBody(answer, { departmentId: department, departmentStartsOn: startsOn }),
      t.admin,
      branch,
    );
  };

  /** A STEAM teacher of a STEAM subject of grade 7 on a class row of a new draft of the North. */
  async function steamRow(
    input: { branch?: string; year?: string; further?: string[] } = {},
  ): Promise<{ row: string; teacher: string; subject: string; version: string; classId: string }> {
    const branch = input.branch ?? t.north;
    const subject = await load.classes.subject({ grades: [7] });
    const classId = await load.classes.schoolClass(branch, input.year ?? year, { grade: 7 });
    const { staffId } = await load.teacher(branch, {
      subjects: [{ subject, grades: [7] }],
      ...(input.further === undefined ? {} : { further: input.further }),
    });
    const version = await load.version(branch, input.year ?? year, { startsOn: STARTS_ON });
    const row = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: classId,
      subject_id: subject,
      teacher_id: staffId,
    });
    return { row, teacher: staffId, subject, version, classId };
  }

  /** Every row the two edits write, in both branches, and the audit count. */
  const rowsOf = () =>
    Promise.all([
      sql`select * from staff order by id`.execute(t.database.migrator),
      sql`select * from staff_divisions order by staff_id, division_id`.execute(
        t.database.migrator,
      ),
      sql`select * from staff_subjects order by staff_id, subject_id`.execute(t.database.migrator),
      sql`select * from subjects order by id`.execute(t.database.migrator),
      sql`select * from teaching_load_rows order by id`.execute(t.database.migrator),
      t.auditCount(),
    ]);

  /** The rows of the branch a refusal lists, by id. */
  const listed = (response: Response): string[] =>
    detailsOf(response)
      .filter((detail) => detail.path.startsWith('load.'))
      .map((detail) => detail.path.slice('load.'.length));

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

  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(t.database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  const untilWaiting = async () => {
    for (let tries = 0; tries < 200 && (await waitingForALock()) === 0; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(await waitingForALock()).toBeGreaterThan(0);
  };

  beforeAll(async () => {
    t = await dayTemplatesKit();
    load = new LoadKit(t.database.migrator);
    year = await load.classes.year(t.north);
    await load.classes.year(t.south);
    const id = async (table: 'divisions' | 'departments', en: string) =>
      (
        await t.database.migrator
          .selectFrom(table)
          .select('id')
          .where('name_en', '=', en)
          .executeTakeFirstOrThrow()
      ).id;
    academic = await id('divisions', 'Academic');
    management = await id('divisions', 'Management');
    steam = await id('departments', 'STEAM');
    national = await id('departments', 'National');
    tutors = await id('departments', 'Tutors');
  });

  afterAll(async () => {
    await t.close();
  });

  describe('a teacher move', () => {
    it('is refused with the rows of the branch listed, what each line shows, and nothing written', async () => {
      const { row, teacher, subject, version, classId } = await steamRow();
      const staff = await detail(teacher);
      const before = await rowsOf();
      const refused = await put(
        `/api/people/staff/${teacher}`,
        staffBody(staff, { divisions: toDepartment(national), departmentStartsOn: MOVE_ON }),
      );
      refusedWith(refused, 409, 'department_move_loads');
      expect(detailsOf(refused)).toEqual([
        {
          path: `load.${row}`,
          code: 'teaches',
          message: expect.any(String) as string,
          load: {
            versionId: version,
            versionNumber: expect.any(Number) as number,
            versionStartsOn: STARTS_ON,
            unit: { kind: 'class', id: classId, name: expect.any(String) as string, grade: 7 },
            subjectId: subject,
            teacher: { id: teacher, name: `${staff.lastName} ${staff.firstName}`, vacancy: false },
          },
        },
      ]);
      expect(await rowsOf()).toEqual(before);
    });

    it('passes once the rows are reassigned and the profile fits, with the start date audited and shown', async () => {
      const { row, teacher } = await steamRow();
      const staff = await detail(teacher);
      const move = staffBody(staff, {
        divisions: toDepartment(national),
        departmentStartsOn: MOVE_ON,
      });
      const other = await load.teacher(t.north, {
        subjects: (
          await t.database.migrator
            .selectFrom('staff_subjects')
            .select(['subject_id', 'grades'])
            .where('staff_id', '=', teacher)
            .execute()
        ).map((one) => ({ subject: one.subject_id, grades: one.grades })),
      });
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ teacher_id: other.staffId })
        .where('id', '=', row)
        .execute();
      // The loads pass; the profile's own check at the commit still refuses
      // (task 3.4c, decision 2).
      refusedWith(
        await put(`/api/people/staff/${teacher}`, move),
        409,
        'subject_outside_department',
      );
      const cleared = await put(`/api/people/staff/${teacher}/teaching`, {
        subjects: [],
        languages: ['uz'],
      });
      expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
      const moved = await put(`/api/people/staff/${teacher}`, move);
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      // Task 3.6b-3 (L195): the record shows STEAM until the start date.
      expect(staffDetailSchema.parse(moved.body).divisions).toEqual([
        {
          divisionId: academic,
          departmentId: steam,
          main: true,
          departmentSince: null,
          departmentMove: { departmentId: national, startsOn: MOVE_ON },
        },
      ]);
      const entry = (await t.entries('staff.edit', teacher)).at(-1);
      expect(entry).toMatchObject({
        assignment_id: t.adminAssignment,
        request_id: moved.headers['x-request-id'],
        new_value: { departmentStartsOn: MOVE_ON },
      });
    });

    it('lists the rows of the branch first and counts those of another branch', async () => {
      const subject = await load.classes.subject({ grades: [7] });
      const southYear = (
        await t.database.migrator
          .selectFrom('academic_years')
          .select('id')
          .where('branch_id', '=', t.south)
          .executeTakeFirstOrThrow()
      ).id;
      const { staffId } = await load.teacher(t.north, {
        further: [t.south],
        subjects: [{ subject, grades: [7] }],
      });
      const southVersion = await load.version(t.south, southYear, { startsOn: STARTS_ON });
      await load.row({
        branch_id: t.south,
        version_id: southVersion,
        class_id: await load.classes.schoolClass(t.south, southYear, { grade: 7 }),
        subject_id: subject,
        teacher_id: staffId,
      });
      const northVersion = await load.version(t.north, year, { startsOn: STARTS_ON });
      const northRow = await load.row({
        branch_id: t.north,
        version_id: northVersion,
        class_id: await load.classes.schoolClass(t.north, year, { grade: 7 }),
        subject_id: subject,
        teacher_id: staffId,
      });
      const refused = await put(
        `/api/people/staff/${staffId}`,
        staffBody(await detail(staffId), {
          divisions: toDepartment(national),
          departmentStartsOn: MOVE_ON,
        }),
      );
      refusedWith(refused, 409, 'department_move_loads');
      expect(listed(refused)).toEqual([northRow]);
      expect(detailsOf(refused).at(-1)).toMatchObject({ path: 'elsewhere', code: '1' });
    });

    it('with the Academic division removed lists every row', async () => {
      const { row, teacher } = await steamRow();
      const refused = await put(
        `/api/people/staff/${teacher}`,
        staffBody(await detail(teacher), {
          divisions: [{ divisionId: management, departmentId: null, main: true }],
          departmentStartsOn: MOVE_ON,
        }),
      );
      refusedWith(refused, 409, 'department_move_loads');
      expect(listed(refused)).toEqual([row]);
    });

    it('passes when the only rows are of a version whose year ends before the start date', async () => {
      const own = await t.newBranch();
      const ownYear = await load.classes.year(own, 'current', '2026-09-01', '2027-05-31');
      const subject = await load.classes.subject({ grades: [7] });
      const { staffId } = await load.teacher(own, {
        further: [t.north],
        subjects: [{ subject, grades: [7] }],
      });
      await load.row({
        branch_id: own,
        version_id: await load.version(own, ownYear, { startsOn: STARTS_ON }),
        class_id: await load.classes.schoolClass(own, ownYear, { grade: 7 }),
        subject_id: subject,
        teacher_id: staffId,
      });
      // The North's planned year reaches into 2028: a start date in it is
      // allowed, and the own branch's year ended before it.
      await load.classes.year(t.north, 'planned', '2027-09-01', '2028-05-31');
      await put(
        `/api/people/staff/${staffId}/teaching`,
        { subjects: [], languages: ['uz'] },
        t.admin,
        own,
      );
      const moved = await put(
        `/api/people/staff/${staffId}`,
        staffBody(await detail(staffId), {
          divisions: toDepartment(national),
          departmentStartsOn: '2027-09-01',
        }),
      );
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    });
  });

  describe('the start date (decision 2, correction 5)', () => {
    it('is required for a move and refused without one', async () => {
      const { teacher } = await steamRow();
      const staff = await detail(teacher);
      const required = await put(
        `/api/people/staff/${teacher}`,
        staffBody(staff, { divisions: toDepartment(national) }),
      );
      refusedWith(required, 400, 'validation_failed');
      expect(detailsOf(required)).toEqual([
        expect.objectContaining({ path: 'departmentStartsOn', code: 'required' }),
      ]);
      const noMove = await put(
        `/api/people/staff/${teacher}`,
        staffBody(staff, { departmentStartsOn: MOVE_ON }),
      );
      refusedWith(noMove, 400, 'validation_failed');
      expect(detailsOf(noMove)).toEqual([
        expect.objectContaining({ path: 'departmentStartsOn', code: 'no_move' }),
      ]);
    });

    it('is today or later in branch time and no later than the end of the latest year', async () => {
      const { teacher } = await steamRow();
      const staff = await detail(teacher);
      const at = (date: string) =>
        put(
          `/api/people/staff/${teacher}`,
          staffBody(staff, { divisions: toDepartment(national), departmentStartsOn: date }),
        );
      for (const date of ['2026-10-09', '2099-09-01']) {
        const refused = await at(date);
        refusedWith(refused, 422, 'department_move_start_outside');
        expect(detailsOf(refused)).toEqual([
          expect.objectContaining({ path: 'departmentStartsOn' }),
        ]);
      }
      // Today passes the date (the loads answer next), until midnight in Tashkent.
      refusedWith(await at('2026-10-10'), 409, 'department_move_loads');
      t.clock.set('2026-10-11T00:01:00+05:00');
      try {
        refusedWith(await at('2026-10-10'), 422, 'department_move_start_outside');
      } finally {
        t.clock.set('2026-10-10T23:55:00+05:00');
      }
    });

    it('has no upper bound in a branch with no year; other branches still count against their own', async () => {
      const own = await t.newBranch();
      const subject = await load.classes.subject({ grades: [7] });
      const { staffId } = await load.teacher(own, {
        further: [t.north],
        subjects: [{ subject, grades: [7] }],
      });
      await load.row({
        branch_id: t.north,
        version_id: await load.version(t.north, year, { startsOn: STARTS_ON }),
        class_id: await load.classes.schoolClass(t.north, year, { grade: 7 }),
        subject_id: subject,
        teacher_id: staffId,
      });
      const at = async (date: string) =>
        put(
          `/api/people/staff/${staffId}`,
          staffBody(await detail(staffId, own), {
            divisions: toDepartment(national),
            departmentStartsOn: date,
          }),
          t.admin,
          own,
        );
      const counted = await at(MOVE_ON);
      refusedWith(counted, 409, 'department_move_loads');
      expect(detailsOf(counted)).toEqual([
        expect.objectContaining({ path: 'elsewhere', code: '1' }),
      ]);
      // A far date: the North's year ends before it; only the profile is left.
      refusedWith(await at('2099-09-01'), 409, 'subject_outside_department');
    });
  });

  describe('what is not a move (decision 5, correction 4)', () => {
    /** A teacher with a stale row the check would refuse: its subject moved to National. */
    async function staleTeacher(): Promise<{ teacher: string; row: string }> {
      const { teacher, row, subject } = await steamRow();
      await t.database.migrator
        .deleteFrom('staff_subjects')
        .where('staff_id', '=', teacher)
        .execute();
      await t.database.migrator
        .updateTable('subjects')
        .set({ department_id: national })
        .where('id', '=', subject)
        .execute();
      return { teacher, row };
    }

    it('swapping main and further with the department unchanged runs no check and keeps the date', async () => {
      const { teacher } = await staleTeacher();
      await t.database.migrator
        .insertInto('staff_divisions')
        .values({ staff_id: teacher, division_id: management, department_id: null, is_main: false })
        .execute();
      await t.database.migrator
        .updateTable('staff_divisions')
        .set({ department_since: '2026-09-15' })
        .where('staff_id', '=', teacher)
        .where('division_id', '=', academic)
        .execute();
      const swapped = [
        { divisionId: academic, departmentId: steam, main: false },
        { divisionId: management, departmentId: null, main: true },
      ];
      const staff = await detail(teacher);
      refusedNoMove(
        await put(
          `/api/people/staff/${teacher}`,
          staffBody(staff, { divisions: swapped, departmentStartsOn: MOVE_ON }),
        ),
      );
      const moved = await put(
        `/api/people/staff/${teacher}`,
        staffBody(staff, { divisions: swapped }),
      );
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect(staffDetailSchema.parse(moved.body).divisions).toContainEqual({
        divisionId: academic,
        departmentId: steam,
        main: false,
        departmentSince: '2026-09-15',
        departmentMove: null,
      });
    });

    it('adding Academic as a further division is not a move, and runs no check', async () => {
      // A person of Management whose stale row of a STEAM subject a move to
      // National would refuse.
      const { teacher } = await steamRow();
      await t.database.migrator.transaction().execute(async (transaction) => {
        await transaction.deleteFrom('staff_subjects').where('staff_id', '=', teacher).execute();
        await transaction.deleteFrom('staff_divisions').where('staff_id', '=', teacher).execute();
        await transaction
          .insertInto('staff_divisions')
          .values({
            staff_id: teacher,
            division_id: management,
            department_id: null,
            is_main: true,
          })
          .execute();
      });
      const staff = await detail(teacher);
      const added = [
        { divisionId: management, departmentId: null, main: true },
        { divisionId: academic, departmentId: national, main: false },
      ];
      refusedNoMove(
        await put(
          `/api/people/staff/${teacher}`,
          staffBody(staff, { divisions: added, departmentStartsOn: MOVE_ON }),
        ),
      );
      const moved = await put(
        `/api/people/staff/${teacher}`,
        staffBody(staff, { divisions: added }),
      );
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    });
  });

  describe('who may move', () => {
    it('refuses the Academic Vice Principal, the Principal and a Teacher, and answers 404 for another branch', async () => {
      const { teacher } = await steamRow();
      const body = staffBody(await detail(teacher), {
        divisions: toDepartment(national),
        departmentStartsOn: MOVE_ON,
      });
      const before = await rowsOf();
      refusedWith(
        await put(`/api/people/staff/${teacher}`, body, t.vicePrincipal),
        403,
        'permission_denied',
      );
      for (const cookie of [t.principal, t.teacher]) {
        refusedWith(
          await put(`/api/people/staff/${teacher}`, body, cookie),
          403,
          'permission_denied',
        );
      }
      const elsewhere = await put(`/api/people/staff/${teacher}`, body, t.admin, t.south);
      expect(elsewhere.status).toBe(404);
      expect((await put(`/api/people/staff/${UNKNOWN}`, body)).status).toBe(404);
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('a subject move', () => {
    it('is refused with the loads before the profiles, and passes once both are cleared', async () => {
      const { row, teacher, subject } = await steamRow();
      const body = subjectBody(await subjectAnswer(subject), {
        departmentId: national,
        departmentStartsOn: MOVE_ON,
      });
      const before = await rowsOf();
      const refused = await put(`/api/setup/subjects/${subject}`, body);
      refusedWith(refused, 409, 'department_move_loads');
      expect(listed(refused)).toEqual([row]);
      expect(await rowsOf()).toEqual(before);
      await t.database.migrator.deleteFrom('teaching_load_rows').where('id', '=', row).execute();
      refusedWith(await put(`/api/setup/subjects/${subject}`, body), 409, 'subject_has_teachers');
      await t.database.migrator
        .deleteFrom('staff_subjects')
        .where('staff_id', '=', teacher)
        .execute();
      const moved = await put(`/api/setup/subjects/${subject}`, body);
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      // Task 3.6b-3 (L195): the record shows STEAM until the start date.
      expect(subjectSchema.parse(moved.body)).toMatchObject({
        departmentId: steam,
        departmentSince: null,
        departmentMove: { departmentId: national, startsOn: MOVE_ON },
      });
      expect(
        (
          await t.database.migrator
            .selectFrom('audit_log_school')
            .selectAll()
            .where('action', '=', 'subject.edit')
            .where('record_id', '=', subject)
            .orderBy('occurred_at')
            .orderBy('id')
            .execute()
        ).at(-1),
      ).toMatchObject({
        assignment_id: t.adminAssignment,
        old_value: { departmentId: steam },
        new_value: { departmentId: national, departmentStartsOn: MOVE_ON },
      });
    });

    it('lists the rows of the branch and counts those of another branch', async () => {
      const subject = await load.classes.subject({ grades: [7] });
      const southYear = (
        await t.database.migrator
          .selectFrom('academic_years')
          .select('id')
          .where('branch_id', '=', t.south)
          .executeTakeFirstOrThrow()
      ).id;
      const southTeacher = await load.teacher(t.south, { subjects: [{ subject, grades: [7] }] });
      await load.row({
        branch_id: t.south,
        version_id: await load.version(t.south, southYear, { startsOn: STARTS_ON }),
        class_id: await load.classes.schoolClass(t.south, southYear, { grade: 7 }),
        subject_id: subject,
        teacher_id: southTeacher.staffId,
      });
      const northTeacher = await load.teacher(t.north, { subjects: [{ subject, grades: [7] }] });
      const northRow = await load.row({
        branch_id: t.north,
        version_id: await load.version(t.north, year, { startsOn: STARTS_ON }),
        class_id: await load.classes.schoolClass(t.north, year, { grade: 7 }),
        subject_id: subject,
        teacher_id: northTeacher.staffId,
      });
      const refused = await moveSubjectTo(subject, national, MOVE_ON);
      refusedWith(refused, 409, 'department_move_loads');
      expect(listed(refused)).toEqual([northRow]);
      expect(detailsOf(refused).at(-1)).toMatchObject({ path: 'elsewhere', code: '1' });
    });

    it('passes when the only rows are of a version whose year ends before the start date', async () => {
      const own = await t.newBranch();
      const ownYear = await load.classes.year(own, 'current', '2026-09-01', '2027-05-31');
      const subject = await load.classes.subject({ grades: [7] });
      const { staffId } = await load.teacher(own, { subjects: [{ subject, grades: [7] }] });
      await load.row({
        branch_id: own,
        version_id: await load.version(own, ownYear, { startsOn: STARTS_ON }),
        class_id: await load.classes.schoolClass(own, ownYear, { grade: 7 }),
        subject_id: subject,
        teacher_id: staffId,
      });
      await t.database.migrator
        .deleteFrom('staff_subjects')
        .where('staff_id', '=', staffId)
        .execute();
      // Asked in a branch with no year: no upper bound (correction 5).
      const bare = await t.newBranch();
      const moved = await moveSubjectTo(subject, national, '2027-09-01', bare);
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      const subjectAfter = subjectSchema.parse(moved.body);
      expect(subjectAfter.departmentMove).toEqual({
        departmentId: national,
        startsOn: '2027-09-01',
      });
    });

    it('is refused by a row that names a vacancy of the old department (correction 1)', async () => {
      const subject = await load.classes.subject({ grades: [7] });
      const vacancy = await load.vacancy(t.north, { subjects: [{ subject, grades: [7] }] });
      const row = await load.row({
        branch_id: t.north,
        version_id: await load.version(t.north, year, { startsOn: STARTS_ON }),
        class_id: await load.classes.schoolClass(t.north, year, { grade: 7 }),
        subject_id: subject,
        teacher_id: vacancy,
      });
      const refused = await put(
        `/api/setup/subjects/${subject}`,
        subjectBody(await subjectAnswer(subject), {
          departmentId: national,
          departmentStartsOn: MOVE_ON,
        }),
      );
      refusedWith(refused, 409, 'department_move_loads');
      expect(detailsOf(refused)).toEqual([
        expect.objectContaining({
          path: `load.${row}`,
          load: expect.objectContaining({
            teacher: { id: vacancy, name: expect.any(String) as string, vacancy: true },
          }) as unknown,
        }),
      ]);
    });

    it('into the Tutors department leaves the class Tutor’s rows out', async () => {
      const { teacher, subject, classId } = await steamRow();
      const accountId = (
        await t.database.migrator
          .selectFrom('staff')
          .select('account_id')
          .where('id', '=', teacher)
          .executeTakeFirstOrThrow()
      ).account_id;
      if (accountId === null) {
        throw new Error('The kit gives every person an account.');
      }
      await load.tutorOf(t.north, classId, accountId);
      await t.database.migrator
        .deleteFrom('staff_subjects')
        .where('staff_id', '=', teacher)
        .execute();
      const moved = await put(
        `/api/setup/subjects/${subject}`,
        subjectBody(await subjectAnswer(subject), {
          departmentId: tutors,
          departmentStartsOn: MOVE_ON,
        }),
      );
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    });

    it('needs a start date, refuses one without a move, and refuses the Academic Vice Principal', async () => {
      const subject = await load.classes.subject({ grades: [7] });
      const answer = await subjectAnswer(subject);
      const required = await put(
        `/api/setup/subjects/${subject}`,
        subjectBody(answer, { departmentId: national }),
      );
      refusedWith(required, 400, 'validation_failed');
      expect(detailsOf(required)).toEqual([
        expect.objectContaining({ path: 'departmentStartsOn', code: 'required' }),
      ]);
      refusedNoMove(
        await put(
          `/api/setup/subjects/${subject}`,
          subjectBody(answer, { departmentStartsOn: MOVE_ON }),
        ),
      );
      refusedWith(
        await put(
          `/api/setup/subjects/${subject}`,
          subjectBody(answer, { departmentId: national, departmentStartsOn: '2099-09-01' }),
        ),
        422,
        'department_move_start_outside',
      );
      refusedWith(
        await put(
          `/api/setup/subjects/${subject}`,
          subjectBody(answer, { departmentId: national, departmentStartsOn: MOVE_ON }),
          t.vicePrincipal,
        ),
        403,
        'subject_move_super_admin',
      );
    });

    it('refuses the Academic Vice Principal, the Principal and a Teacher, and nothing is written', async () => {
      const { subject } = await steamRow();
      const body = subjectBody(await subjectAnswer(subject), {
        departmentId: national,
        departmentStartsOn: MOVE_ON,
      });
      const before = await rowsOf();
      refusedWith(
        await put(`/api/setup/subjects/${subject}`, body, t.vicePrincipal),
        403,
        'subject_move_super_admin',
      );
      for (const cookie of [t.principal, t.teacher]) {
        refusedWith(
          await put(`/api/setup/subjects/${subject}`, body, cookie),
          403,
          'permission_denied',
        );
      }
      expect(await rowsOf()).toEqual(before);
    });

    // Permission review, should-fix 4: a row whose teacher this branch no
    // longer sees is still listed, without the name.
    it('lists a row whose teacher is no longer linked to the branch, without the name', async () => {
      const { row, teacher, subject } = await steamRow({ further: [t.south] });
      // The person's main link moves to the South, and the North link goes.
      await t.database.migrator.transaction().execute(async (transaction) => {
        await transaction
          .deleteFrom('staff_branches')
          .where('staff_id', '=', teacher)
          .where('branch_id', '=', t.north)
          .execute();
        await transaction
          .updateTable('staff_branches')
          .set({ is_main: true })
          .where('staff_id', '=', teacher)
          .where('branch_id', '=', t.south)
          .execute();
      });
      const refused = await put(
        `/api/setup/subjects/${subject}`,
        subjectBody(await subjectAnswer(subject), {
          departmentId: national,
          departmentStartsOn: MOVE_ON,
        }),
      );
      refusedWith(refused, 409, 'department_move_loads');
      expect(detailsOf(refused)).toEqual([
        expect.objectContaining({
          path: `load.${row}`,
          load: expect.objectContaining({
            teacher: { id: teacher, name: null, vacancy: false },
          }) as unknown,
        }),
      ]);
    });
  });

  // Decision 9: the edit decides the lock of department moves from a read
  // without a row lock; a change of the department that lands between that
  // read and the row lock was not ordered, in either direction.
  describe('a department changed between the read and the lock', () => {
    /** A teacher with no subjects and no rows, whose department the held side changes. */
    async function bareTeacher(): Promise<string> {
      return (await load.teacher(t.north)).staffId;
    }

    const heldDepartment = (teacher: string, department: string) =>
      holdOpen(async (transaction) => {
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', teacher)
          .forUpdate()
          .execute();
        await transaction
          .updateTable('staff_divisions')
          .set({ department_id: department })
          .where('staff_id', '=', teacher)
          .where('division_id', '=', academic)
          .execute();
      });

    it('answers staff_changed when the move the edit locked for is gone', async () => {
      const teacher = await bareTeacher();
      const staff = await detail(teacher);
      const held = await heldDepartment(teacher, national);
      const sent = put(
        `/api/people/staff/${teacher}`,
        staffBody(staff, { divisions: toDepartment(national), departmentStartsOn: MOVE_ON }),
      ).then((response) => response);
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await sent, 409, 'staff_changed');
    });

    it('answers staff_changed when a move appears that the edit did not lock for', async () => {
      const teacher = await bareTeacher();
      const staff = await detail(teacher);
      const held = await heldDepartment(teacher, national);
      const sent = put(`/api/people/staff/${teacher}`, staffBody(staff)).then(
        (response) => response,
      );
      await untilWaiting();
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await sent, 409, 'staff_changed');
    });

    it('answers subject_changed in both directions', async () => {
      for (const asked of ['national', 'steam'] as const) {
        const subject = await load.classes.subject({ grades: [7] });
        const answer = await subjectAnswer(subject);
        const held = await holdOpen(async (transaction) => {
          await transaction
            .selectFrom('subjects')
            .select('id')
            .where('id', '=', subject)
            .forUpdate()
            .execute();
          await transaction
            .updateTable('subjects')
            .set({ department_id: national })
            .where('id', '=', subject)
            .execute();
        });
        const body =
          asked === 'national'
            ? subjectBody(answer, { departmentId: national, departmentStartsOn: MOVE_ON })
            : subjectBody(answer);
        const sent = put(`/api/setup/subjects/${subject}`, body).then((response) => response);
        await untilWaiting();
        held.release();
        expect(await held.done).toBeUndefined();
        refusedWith(await sent, 409, 'subject_changed');
      }
    });
  });

  // Decision 6 and correction 3: a load write and a move at the same moment
  // never both pass. Each pair in both orders; the real route runs on the
  // side whose order is proved, the held side writes what its route writes.
  describe('at the same moment', () => {
    const rowBody = (fields: object) => ({
      classId: null,
      groupId: null,
      lessonsPerWeek: 2,
      roomId: null,
      roomType: null,
      doubleLessons: false,
      ...fields,
    });

    const createRow = (version: string, fields: object) =>
      t.post(`/api/timetable/versions/${version}/load`, t.north, rowBody(fields), t.vicePrincipal);

    /** A Tutor subject, a class of grade 7 and its Tutor, with a draft of the North. */
    async function tutorCase(): Promise<{
      subject: string;
      classId: string;
      tutor: string;
      version: string;
    }> {
      const subject = await load.tutorSubject({ grades: [7] });
      const classId = await load.classes.schoolClass(t.north, year, { grade: 7 });
      const { staffId, accountId } = await load.teacher(t.north);
      await load.tutorOf(t.north, classId, accountId);
      const version = await load.version(t.north, year, { startsOn: STARTS_ON });
      return { subject, classId, tutor: staffId, version };
    }

    /** A held subject move: the lock of moves, the subject FOR UPDATE, its department written. */
    const heldSubjectMove = (subject: string, department: string) =>
      holdOpen(async (transaction) => {
        await lockDepartmentMoves(transaction);
        await transaction
          .selectFrom('subjects')
          .select('id')
          .where('id', '=', subject)
          .forUpdate()
          .execute();
        await transaction
          .updateTable('subjects')
          .set({ department_id: department, department_since: MOVE_ON })
          .where('id', '=', subject)
          .execute();
      });

    const moveSubject = async (subject: string, department: string) =>
      put(
        `/api/setup/subjects/${subject}`,
        subjectBody(await subjectAnswer(subject), {
          departmentId: department,
          departmentStartsOn: MOVE_ON,
        }),
      );

    describe('a teacher move and a load create naming the teacher', () => {
      // The profile rule stands on both sides (04: "a teacher's subjects come
      // from one department"): the move passes and the create is refused in
      // either order; the person's lock orders them.
      it('the create waits for a move in flight and is refused', async () => {
        const subject = await load.classes.subject({ grades: [7] });
        const classId = await load.classes.schoolClass(t.north, year, { grade: 7 });
        const { staffId } = await load.teacher(t.north);
        const version = await load.version(t.north, year, { startsOn: STARTS_ON });
        const held = await holdOpen(async (transaction) => {
          await lockDepartmentMoves(transaction);
          await transaction
            .selectFrom('staff')
            .select('id')
            .where('id', '=', staffId)
            .forUpdate()
            .execute();
          await transaction
            .updateTable('staff_divisions')
            .set({ department_id: national, department_since: MOVE_ON })
            .where('staff_id', '=', staffId)
            .where('division_id', '=', academic)
            .execute();
        });
        const sent = createRow(version, { classId, subjectId: subject, teacherId: staffId }).then(
          (response) => response,
        );
        await untilWaiting();
        held.release();
        expect(await held.done).toBeUndefined();
        refusedWith(await sent, 409, 'load_teacher_subject');
      });

      it('the move waits for a create in flight, which is refused, and passes', async () => {
        const subject = await load.classes.subject({ grades: [7] });
        const classId = await load.classes.schoolClass(t.north, year, { grade: 7 });
        const { staffId } = await load.teacher(t.north);
        const version = await load.version(t.north, year, { startsOn: STARTS_ON });
        const staff = await detail(staffId);
        let heldWrite: string | undefined;
        const held = await holdOpen(async (transaction) => {
          // What the create does: the teacher FOR KEY SHARE, then the row,
          // which the trigger of 0055 refuses (no profile row); under a
          // savepoint, so the lock stays while the move is sent.
          await transaction
            .selectFrom('staff')
            .select('id')
            .where('id', '=', staffId)
            .forKeyShare()
            .execute();
          await sql`savepoint create_row`.execute(transaction);
          try {
            await transaction
              .insertInto('teaching_load_rows')
              .values({
                branch_id: t.north,
                version_id: version,
                class_id: classId,
                subject_id: subject,
                teacher_id: staffId,
                lessons_per_week: 2,
              })
              .execute();
            heldWrite = 'written';
          } catch (error) {
            heldWrite = (error as { constraint?: string }).constraint;
            await sql`rollback to savepoint create_row`.execute(transaction);
          }
        });
        expect(heldWrite).toBe('load_teacher_subject');
        const sent = put(
          `/api/people/staff/${staffId}`,
          staffBody(staff, { divisions: toDepartment(national), departmentStartsOn: MOVE_ON }),
        ).then((response) => response);
        await untilWaiting();
        held.release();
        expect(await held.done).toBeUndefined();
        const moved = await sent;
        expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      });
    });

    describe('a Tutor subject leaving the Tutors department', () => {
      it('and a Tutor row create: a create sent during the move is refused', async () => {
        const { subject, classId, tutor, version } = await tutorCase();
        const held = await heldSubjectMove(subject, national);
        const sent = createRow(version, { classId, subjectId: subject, teacherId: tutor }).then(
          (response) => response,
        );
        await untilWaiting();
        held.release();
        expect(await held.done).toBeUndefined();
        refusedWith(await sent, 409, 'load_teacher_subject');
      });

      it('and a Tutor row create: a move sent during the create is refused', async () => {
        const { subject, classId, tutor, version } = await tutorCase();
        const held = await holdOpen(async (transaction) => {
          await transaction
            .selectFrom('subjects')
            .select('id')
            .where('id', '=', subject)
            .forKeyShare()
            .execute();
          await transaction
            .insertInto('teaching_load_rows')
            .values({
              branch_id: t.north,
              version_id: version,
              class_id: classId,
              subject_id: subject,
              teacher_id: tutor,
              lessons_per_week: 2,
            })
            .execute();
        });
        const sent = moveSubject(subject, national);
        await untilWaiting();
        held.release();
        expect(await held.done).toBeUndefined();
        refusedWith(await sent, 409, 'department_move_loads');
      });

      /** A row of the Tutor subject taken by a teacher of the Tutors department who is not the Tutor. */
      async function rowOfAnother(): Promise<{
        subject: string;
        tutor: string;
        version: string;
        row: string;
        other: string;
      }> {
        const tutorCaseRows = await tutorCase();
        const { staffId } = await load.teacher(t.north);
        await t.database.migrator
          .updateTable('staff_divisions')
          .set({ department_id: tutors })
          .where('staff_id', '=', staffId)
          .execute();
        await load.profile(staffId, [{ subject: tutorCaseRows.subject, grades: [7] }]);
        const row = await load.row({
          branch_id: t.north,
          version_id: tutorCaseRows.version,
          class_id: tutorCaseRows.classId,
          subject_id: tutorCaseRows.subject,
          teacher_id: staffId,
        });
        // Out of the profiles, so that only the loads decide the move.
        await t.database.migrator
          .deleteFrom('staff_subjects')
          .where('staff_id', '=', staffId)
          .execute();
        return { ...tutorCaseRows, row, other: staffId };
      }

      const editBody = (teacherId: string) => ({
        teacherId,
        lessonsPerWeek: 2,
        roomId: null,
        roomType: null,
        doubleLessons: false,
      });

      it('and the teacher edit of a row to the Tutor: an edit sent during the move is refused', async () => {
        const { subject, tutor, version, row } = await rowOfAnother();
        const held = await heldSubjectMove(subject, national);
        const sent = t
          .patch(
            `/api/timetable/versions/${version}/load/${row}`,
            t.north,
            editBody(tutor),
            t.vicePrincipal,
          )
          .then((response) => response);
        await untilWaiting();
        held.release();
        expect(await held.done).toBeUndefined();
        refusedWith(await sent, 409, 'load_teacher_subject');
      });

      it('and the teacher edit of a row to the Tutor: a move sent during the edit is refused', async () => {
        const { subject, tutor, row, other } = await rowOfAnother();
        // The other teacher moves to National first, so that before the edit
        // the row does not count against a move of the subject to National:
        // only the edit's teacher makes it count (spec review, must-fix 1).
        await t.database.migrator
          .updateTable('staff_divisions')
          .set({ department_id: national })
          .where('staff_id', '=', other)
          .execute();
        const held = await holdOpen(async (transaction) => {
          await transaction
            .selectFrom('subjects')
            .select('id')
            .where('id', '=', subject)
            .forKeyShare()
            .execute();
          await transaction
            .updateTable('teaching_load_rows')
            .set({ teacher_id: tutor })
            .where('id', '=', row)
            .execute();
        });
        const sent = moveSubject(subject, national);
        await untilWaiting();
        held.release();
        expect(await held.done).toBeUndefined();
        const refused = await sent;
        refusedWith(refused, 409, 'department_move_loads');
        expect(listed(refused)).toEqual([row]);
      });

      it('and a copy: a copy sent during the move leaves the Tutor row', async () => {
        const { subject, classId, tutor, version } = await tutorCase();
        const source = await load.row({
          branch_id: t.north,
          version_id: version,
          class_id: classId,
          subject_id: subject,
          teacher_id: tutor,
        });
        const held = await heldSubjectMove(subject, national);
        const sent = t
          .post(
            '/api/timetable/versions',
            t.north,
            { academicYearId: year, startsOn: STARTS_ON, copyFrom: version },
            t.vicePrincipal,
          )
          .then((response) => response);
        await untilWaiting();
        held.release();
        expect(await held.done).toBeUndefined();
        const copied = await sent;
        expect(copied.status, JSON.stringify(copied.body)).toBe(201);
        const copy = (copied.body as { id: string }).id;
        const stored = await t.database.migrator
          .selectFrom('timetable_versions')
          .select('left_rows')
          .where('id', '=', copy)
          .executeTakeFirstOrThrow();
        expect(stored.left_rows).toMatchObject([
          { sourceRowId: source, problems: ['load_teacher_subject'] },
        ]);
      });

      it('and a copy: a move sent during the copy is refused by the copied row too', async () => {
        const { subject, classId, tutor, version } = await tutorCase();
        const source = await load.row({
          branch_id: t.north,
          version_id: version,
          class_id: classId,
          subject_id: subject,
          teacher_id: tutor,
        });
        let copied = '';
        // What the copy writes, in its order: the year FOR UPDATE, the
        // teachers and then the subjects FOR KEY SHARE, the version with its
        // source and the copied row. The copy route takes its locks before any
        // point where a third transaction could stop it after the subject
        // lock, so the two real routes cannot be ordered with `inOrder`; the
        // other direction runs the real copy.
        const held = await holdOpen(async (transaction) => {
          await transaction
            .selectFrom('academic_years')
            .select('id')
            .where('id', '=', year)
            .forUpdate()
            .execute();
          await transaction
            .selectFrom('staff')
            .select('id')
            .where('id', '=', tutor)
            .forKeyShare()
            .execute();
          await transaction
            .selectFrom('subjects')
            .select('id')
            .where('id', '=', subject)
            .forKeyShare()
            .execute();
          const copy = await transaction
            .insertInto('timetable_versions')
            .values({
              branch_id: t.north,
              academic_year_id: year,
              number: 900,
              starts_on: STARTS_ON,
              from_version_id: version,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          copied = (
            await transaction
              .insertInto('teaching_load_rows')
              .values({
                branch_id: t.north,
                version_id: copy.id,
                class_id: classId,
                subject_id: subject,
                teacher_id: tutor,
                lessons_per_week: 2,
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id;
        });
        const sent = moveSubject(subject, national);
        await untilWaiting();
        held.release();
        expect(await held.done).toBeUndefined();
        const refused = await sent;
        refusedWith(refused, 409, 'department_move_loads');
        // The copied row is listed beside its source: the move read after the copy.
        expect([...listed(refused)].sort()).toEqual([source, copied].sort());
      });
    });

    describe('two moves on one stale row (the lock of department moves)', () => {
      /** A row of a STEAM subject whose teacher has moved to National, out of the profiles. */
      async function staleRow(): Promise<{ teacher: string; subject: string; row: string }> {
        const { teacher, subject, row } = await steamRow();
        await t.database.migrator
          .deleteFrom('staff_subjects')
          .where('staff_id', '=', teacher)
          .execute();
        await t.database.migrator
          .updateTable('staff_divisions')
          .set({ department_id: national })
          .where('staff_id', '=', teacher)
          .execute();
        return { teacher, subject, row };
      }

      it('a subject move sent during a teacher move sees the teacher’s new department', async () => {
        const { teacher, subject, row } = await staleRow();
        const held = await holdOpen(async (transaction) => {
          await lockDepartmentMoves(transaction);
          await transaction
            .selectFrom('staff')
            .select('id')
            .where('id', '=', teacher)
            .forUpdate()
            .execute();
          await transaction
            .updateTable('staff_divisions')
            .set({ department_id: steam, department_since: MOVE_ON })
            .where('staff_id', '=', teacher)
            .execute();
        });
        const sent = moveSubject(subject, national);
        await untilWaiting();
        held.release();
        expect(await held.done).toBeUndefined();
        const refused = await sent;
        refusedWith(refused, 409, 'department_move_loads');
        expect(listed(refused)).toEqual([row]);
      });

      it('a teacher move sent during a subject move sees the subject’s new department', async () => {
        const { teacher, subject, row } = await staleRow();
        const staff = await detail(teacher);
        const held = await heldSubjectMove(subject, national);
        const sent = put(
          `/api/people/staff/${teacher}`,
          staffBody(staff, { divisions: toDepartment(steam), departmentStartsOn: MOVE_ON }),
        ).then((response) => response);
        await untilWaiting();
        held.release();
        expect(await held.done).toBeUndefined();
        const refused = await sent;
        refusedWith(refused, 409, 'department_move_loads');
        expect(listed(refused)).toEqual([row]);
      });
    });
  });
  // Task 3.6b-3, the plan approved on pull request #123 with corrections 1
  // and 2. Owner's answer of 15 October 2026, L195 (issue #42): "The move
  // takes effect on its start date: the record shows the old department until
  // then". The rules read the department after the move from the save
  // (decision 1); only what is shown follows the start date.
  describe('the move on its start date (task 3.6b-3)', () => {
    const KIT_NOW = START;
    let general: string;

    beforeAll(async () => {
      general = (
        await t.database.migrator
          .selectFrom('departments')
          .select('id')
          .where('name_en', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
    });

    /**
     * Runs `work` with the clock at `moment`, at most minutes after the kit's
     * (the sessions end after a longer idle time), then sets it back.
     */
    async function at<T>(moment: string, work: () => Promise<T>): Promise<T> {
      t.clock.set(moment);
      try {
        return await work();
      } finally {
        t.clock.set(KIT_NOW);
      }
    }

    const departmentNames = async (id: string) => {
      const row = await t.database.migrator
        .selectFrom('departments')
        .select(['name_uz', 'name_ru', 'name_en'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      return { uz: row.name_uz, ru: row.name_ru, en: row.name_en };
    };

    /** The Academic division of a staff answer. */
    const academicOf = (staff: StaffDetail | StaffListItem) =>
      staff.divisions.find((division) => division.divisionId === academic);

    const exportCell = async (
      path: '/api/people/staff/export' | '/api/setup/subjects/export',
      id: string,
    ): Promise<unknown> => {
      const response = await request(t.kit.server)
        .post(path)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, t.north)
        .send({ ids: [id], columns: ['department'], selection: 'ticked', search: '', filters: {} })
        .buffer(true)
        .parse(binary);
      expect(response.status).toBe(200);
      return (await fileOf(response)).sheet.rows[0]?.[0];
    };

    /** Every reader of a person's department, as the Super Admin and the Academic Vice Principal. */
    async function teacherReads(teacher: string) {
      const reads = [];
      for (const cookie of [t.admin, t.vicePrincipal]) {
        const one = await t.get(`/api/people/staff/${teacher}`, t.north, cookie);
        expect(one.status, JSON.stringify(one.body)).toBe(200);
        const list = await t.get('/api/people/staff', t.north, cookie);
        expect(list.status, JSON.stringify(list.body)).toBe(200);
        const item = staffListSchema.parse(list.body).staff.find((row) => row.id === teacher);
        reads.push(academicOf(staffDetailSchema.parse(one.body)), item && academicOf(item));
      }
      const report = await t.post(`/api/people/staff/${teacher}/report`, t.north, {}, t.admin);
      expect(report.status, JSON.stringify(report.body)).toBe(200);
      return {
        reads,
        file: await exportCell('/api/people/staff/export', teacher),
        report: staffReportSchema
          .parse(report.body)
          .staff.divisions.find((division) => division.division.en === 'Academic')?.department,
      };
    }

    async function subjectReads(subject: string) {
      const reads = [];
      for (const cookie of [t.admin, t.vicePrincipal]) {
        const list = await t.get('/api/setup/subjects', t.north, cookie);
        expect(list.status, JSON.stringify(list.body)).toBe(200);
        const found = subjectListSchema.parse(list.body).subjects.find((one) => one.id === subject);
        reads.push(
          found && {
            departmentId: found.departmentId,
            departmentSince: found.departmentSince,
            departmentMove: found.departmentMove,
          },
        );
      }
      return { reads, file: await exportCell('/api/setup/subjects/export', subject) };
    }

    /** The `subject.edit` entries of the school-wide log, of one subject when given. */
    const schoolEntries = (subject?: string) =>
      t.database.migrator
        .selectFrom('audit_log_school')
        .selectAll()
        .where('action', '=', 'subject.edit')
        .$if(subject !== undefined, (query) => query.where('record_id', '=', subject ?? ''))
        .orderBy('occurred_at')
        .orderBy('id')
        .execute();

    const departmentRows = () =>
      Promise.all([
        sql`select * from staff_divisions order by staff_id, division_id`.execute(
          t.database.migrator,
        ),
        sql`select * from subjects order by id`.execute(t.database.migrator),
        t.entries('staff.edit'),
        schoolEntries(),
      ]);

    const teacherMove = async (teacher: string, department: string, startsOn?: string) =>
      put(
        `/api/people/staff/${teacher}`,
        staffBody(await detail(teacher), {
          divisions: toDepartment(department),
          ...(startsOn === undefined ? {} : { departmentStartsOn: startsOn }),
        }),
      );

    const subjectMove = async (subject: string, department: string, startsOn?: string) =>
      put(
        `/api/setup/subjects/${subject}`,
        subjectBody(await subjectAnswer(subject), {
          departmentId: department,
          ...(startsOn === undefined ? {} : { departmentStartsOn: startsOn }),
        }),
      );

    const ok = (response: Response) => {
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return response;
    };

    it('L195, a teacher: the old department until the start date, the new one on it, with nothing written', async () => {
      const { staffId: teacher } = await load.teacher(t.north);
      // Saved today, Saturday 10 October, to start tomorrow.
      ok(await teacherMove(teacher, national, TOMORROW));
      const steamNames = await departmentNames(steam);
      const nationalNames = await departmentNames(national);
      const before = await departmentRows();
      const dayBefore = await teacherReads(teacher);
      const planned = {
        divisionId: academic,
        departmentId: steam,
        main: true,
        departmentSince: null,
        departmentMove: { departmentId: national, startsOn: TOMORROW },
      };
      expect(dayBefore.reads).toEqual([planned, planned, planned, planned]);
      expect(Object.values(steamNames)).toContain(dayBefore.file);
      expect(dayBefore.report).toEqual(steamNames);
      const onTheDay = await at('2026-10-11T00:01:00+05:00', () => teacherReads(teacher));
      const moved = {
        divisionId: academic,
        departmentId: national,
        main: true,
        departmentSince: TOMORROW,
        departmentMove: null,
      };
      expect(onTheDay.reads).toEqual([moved, moved, moved, moved]);
      expect(Object.values(nationalNames)).toContain(onTheDay.file);
      expect(onTheDay.report).toEqual(nationalNames);
      expect(await departmentRows()).toEqual(before);
    });

    it('L195, a subject: the old department until the start date, the new one on it, with nothing written', async () => {
      const subject = await load.classes.subject({ grades: [7] });
      ok(await subjectMove(subject, national, TOMORROW));
      const before = await departmentRows();
      const dayBefore = await subjectReads(subject);
      const planned = {
        departmentId: steam,
        departmentSince: null,
        departmentMove: { departmentId: national, startsOn: TOMORROW },
      };
      expect(dayBefore.reads).toEqual([planned, planned]);
      expect(Object.values(await departmentNames(steam))).toContain(dayBefore.file);
      const onTheDay = await at('2026-10-11T00:01:00+05:00', () => subjectReads(subject));
      const moved = { departmentId: national, departmentSince: TOMORROW, departmentMove: null };
      expect(onTheDay.reads).toEqual([moved, moved]);
      expect(Object.values(await departmentNames(national))).toContain(onTheDay.file);
      expect(await departmentRows()).toEqual(before);
    });

    it('a move from today shows at once and keeps no department before it; a second one the same day passes', async () => {
      const { staffId: teacher } = await load.teacher(t.north);
      const first = ok(await teacherMove(teacher, national, '2026-10-10'));
      expect(academicOf(staffDetailSchema.parse(first.body))).toMatchObject({
        departmentId: national,
        departmentSince: '2026-10-10',
        departmentMove: null,
      });
      const stored = await t.database.migrator
        .selectFrom('staff_divisions')
        .select(['department_before', 'department_before_since'])
        .where('staff_id', '=', teacher)
        .executeTakeFirstOrThrow();
      expect(stored).toEqual({ department_before: null, department_before_since: null });
      const second = ok(await teacherMove(teacher, general, '2026-10-10'));
      expect(academicOf(staffDetailSchema.parse(second.body))).toMatchObject({
        departmentId: general,
        departmentSince: '2026-10-10',
        departmentMove: null,
      });
    });

    it('a change of a plan keeps the department in force and runs the load check with the new department and date', async () => {
      // A person of STEAM since 15 September with a row of a STEAM subject in
      // another branch whose year ends on 20 November: a move after that day
      // does not count it (task 3.4c, decision 1).
      const own = await t.newBranch();
      const shortYear = await load.classes.year(own, 'current', '2025-12-01', '2026-11-20');
      const subject = await load.classes.subject({ grades: [7] });
      const { staffId: teacher } = await load.teacher(own, {
        subjects: [{ subject, grades: [7] }],
      });
      await load.row({
        branch_id: own,
        version_id: await load.version(own, shortYear, { startsOn: STARTS_ON }),
        class_id: await load.classes.schoolClass(own, shortYear, { grade: 7 }),
        subject_id: subject,
        teacher_id: teacher,
      });
      await t.database.migrator
        .deleteFrom('staff_subjects')
        .where('staff_id', '=', teacher)
        .execute();
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: teacher, branch_id: t.north, is_main: false })
        .execute();
      await t.database.migrator
        .updateTable('staff_divisions')
        .set({ department_since: '2026-09-15' })
        .where('staff_id', '=', teacher)
        .execute();
      ok(await teacherMove(teacher, national, '2026-11-25'));
      // Another department before the date: STEAM stays in force.
      const changed = ok(await teacherMove(teacher, general, '2026-11-25'));
      expect(academicOf(staffDetailSchema.parse(changed.body))).toEqual({
        divisionId: academic,
        departmentId: steam,
        main: true,
        departmentSince: '2026-09-15',
        departmentMove: { departmentId: general, startsOn: '2026-11-25' },
      });
      // The same department with an earlier date: the row now counts.
      const before = await rowsOf();
      const refused = await teacherMove(teacher, general, '2026-11-02');
      refusedWith(refused, 409, 'department_move_loads');
      expect(detailsOf(refused)).toEqual([
        expect.objectContaining({ path: 'elsewhere', code: '1' }),
      ]);
      expect(await rowsOf()).toEqual(before);
      // And to another department from that date too.
      refusedWith(await teacherMove(teacher, national, '2026-11-02'), 409, 'department_move_loads');
      const later = ok(await teacherMove(teacher, general, '2026-11-23'));
      expect(academicOf(staffDetailSchema.parse(later.body))).toMatchObject({
        departmentId: steam,
        departmentSince: '2026-09-15',
        departmentMove: { departmentId: general, startsOn: '2026-11-23' },
      });
      expect((await t.entries('staff.edit', teacher)).at(-1)).toMatchObject({
        assignment_id: t.adminAssignment,
        old_value: { departmentStartsOn: '2026-11-25' },
        new_value: { departmentStartsOn: '2026-11-23' },
      });
    });

    it('a cancel gives back the department in force and its date, as the Super Admin only', async () => {
      const { staffId: teacher } = await load.teacher(t.north);
      const { staffId: south } = await load.teacher(t.south);
      ok(await teacherMove(teacher, national, '2026-10-10'));
      ok(await teacherMove(teacher, general, MOVE_ON));
      const before = await rowsOf();
      // With a start date: not a cancel (no_move).
      refusedNoMove(await teacherMove(teacher, national, MOVE_ON));
      // The Academic Vice Principal changes the contact fields only.
      refusedWith(
        await put(
          `/api/people/staff/${teacher}`,
          staffBody(await detail(teacher), { divisions: toDepartment(national) }),
          t.vicePrincipal,
        ),
        403,
        'permission_denied',
      );
      // Another branch's record.
      refusedWith(
        await put(
          `/api/people/staff/${south}`,
          staffBody(await detail(teacher), { divisions: toDepartment(national) }),
        ),
        404,
        'not_found',
      );
      expect(await rowsOf()).toEqual(before);
      const cancelled = ok(await teacherMove(teacher, national));
      expect(academicOf(staffDetailSchema.parse(cancelled.body))).toEqual({
        divisionId: academic,
        departmentId: national,
        main: true,
        departmentSince: '2026-10-10',
        departmentMove: null,
      });
      expect(
        await t.database.migrator
          .selectFrom('staff_divisions')
          .select([
            'department_id',
            'department_since',
            'department_before',
            'department_before_since',
          ])
          .where('staff_id', '=', teacher)
          .executeTakeFirstOrThrow(),
      ).toEqual({
        department_id: national,
        department_since: '2026-10-10',
        department_before: null,
        department_before_since: null,
      });
      expect((await t.entries('staff.edit', teacher)).at(-1)).toMatchObject({
        assignment_id: t.adminAssignment,
        request_id: cancelled.headers['x-request-id'],
        old_value: {
          divisions: [{ divisionId: academic, departmentId: general, main: true }],
          departmentStartsOn: MOVE_ON,
        },
        new_value: {
          divisions: [{ divisionId: academic, departmentId: national, main: true }],
          departmentMoveCancelled: true,
        },
      });
    });

    it('a teacher cancel is refused while a load row or the profile holds the planned department', async () => {
      const { staffId: teacher } = await load.teacher(t.north);
      ok(await teacherMove(teacher, national, MOVE_ON));
      // The rules read National already (decision 1): a National subject fits.
      const subject = await load.classes.subject({ grades: [7] });
      await t.database.migrator
        .updateTable('subjects')
        .set({ department_id: national })
        .where('id', '=', subject)
        .execute();
      ok(
        await put(`/api/people/staff/${teacher}/teaching`, {
          subjects: [{ subjectId: subject, grades: [7] }],
          languages: ['uz'],
        }),
      );
      const row = await load.row({
        branch_id: t.north,
        version_id: await load.version(t.north, year, { startsOn: '2026-10-05' }),
        class_id: await load.classes.schoolClass(t.north, year, { grade: 7 }),
        subject_id: subject,
        teacher_id: teacher,
      });
      const before = await rowsOf();
      const refused = await teacherMove(teacher, steam);
      refusedWith(refused, 409, 'department_move_loads');
      expect(listed(refused)).toEqual([row]);
      expect(await rowsOf()).toEqual(before);
      await t.database.migrator.deleteFrom('teaching_load_rows').where('id', '=', row).execute();
      // The profile's own check at the commit.
      refusedWith(await teacherMove(teacher, steam), 409, 'subject_outside_department');
      ok(await put(`/api/people/staff/${teacher}/teaching`, { subjects: [], languages: ['uz'] }));
      ok(await teacherMove(teacher, steam));
    });

    it('a subject cancel is refused while a load row or a profile holds the planned department, and as the Academic Vice Principal', async () => {
      const subject = await load.classes.subject({ grades: [7] });
      ok(await subjectMove(subject, national, MOVE_ON));
      const { staffId: teacher } = await load.teacher(t.north);
      await t.database.migrator
        .updateTable('staff_divisions')
        .set({ department_id: national })
        .where('staff_id', '=', teacher)
        .execute();
      ok(
        await put(`/api/people/staff/${teacher}/teaching`, {
          subjects: [{ subjectId: subject, grades: [7] }],
          languages: ['uz'],
        }),
      );
      const row = await load.row({
        branch_id: t.north,
        version_id: await load.version(t.north, year, { startsOn: '2026-10-05' }),
        class_id: await load.classes.schoolClass(t.north, year, { grade: 7 }),
        subject_id: subject,
        teacher_id: teacher,
      });
      const before = await rowsOf();
      refusedWith(await subjectMove(subject, steam, MOVE_ON), 400, 'validation_failed');
      refusedWith(
        await put(
          `/api/setup/subjects/${subject}`,
          subjectBody(await subjectAnswer(subject), { departmentId: steam }),
          t.vicePrincipal,
        ),
        403,
        'subject_move_super_admin',
      );
      const refused = await subjectMove(subject, steam);
      refusedWith(refused, 409, 'department_move_loads');
      expect(listed(refused)).toEqual([row]);
      expect(await rowsOf()).toEqual(before);
      await t.database.migrator.deleteFrom('teaching_load_rows').where('id', '=', row).execute();
      refusedWith(await subjectMove(subject, steam), 409, 'subject_has_teachers');
      ok(await put(`/api/people/staff/${teacher}/teaching`, { subjects: [], languages: ['uz'] }));
      const cancelled = ok(await subjectMove(subject, steam));
      expect(subjectSchema.parse(cancelled.body)).toMatchObject({
        departmentId: steam,
        departmentSince: null,
        departmentMove: null,
      });
      expect((await schoolEntries(subject)).at(-1)).toMatchObject({
        assignment_id: t.adminAssignment,
        old_value: { departmentId: national, departmentStartsOn: MOVE_ON },
        new_value: { departmentId: steam, departmentMoveCancelled: true },
      });
    });

    it('a cancel into an archived department is refused, for a teacher and for a subject', async () => {
      const { staffId: teacher } = await load.teacher(t.north);
      const subject = await load.classes.subject({ grades: [7] });
      ok(await teacherMove(teacher, general, '2026-10-10'));
      ok(await subjectMove(subject, general, '2026-10-10'));
      ok(await teacherMove(teacher, national, MOVE_ON));
      ok(await subjectMove(subject, national, MOVE_ON));
      // General has no member by the rules now (decision 9).
      await t.database.migrator
        .updateTable('departments')
        .set({ archived_at: new Date('2026-10-10T12:00:00Z') })
        .where('id', '=', general)
        .execute();
      try {
        refusedWith(await teacherMove(teacher, general), 409, 'department_archived');
        refusedWith(await subjectMove(subject, general), 409, 'department_archived');
      } finally {
        await t.database.migrator
          .updateTable('departments')
          .set({ archived_at: null })
          .where('id', '=', general)
          .execute();
      }
    });

    it('the rules read the department after the move while it is planned', async () => {
      const { staffId: teacher } = await load.teacher(t.north);
      ok(await teacherMove(teacher, national, MOVE_ON));
      const steamSubject = await load.classes.subject({ grades: [7] });
      refusedWith(
        await put(`/api/people/staff/${teacher}/teaching`, {
          subjects: [{ subjectId: steamSubject, grades: [7] }],
          languages: ['uz'],
        }),
        409,
        'subject_outside_department',
      );
      const nationalSubject = await load.classes.subject({ grades: [7] });
      ok(await subjectMove(nationalSubject, national, '2026-10-10'));
      ok(
        await put(`/api/people/staff/${teacher}/teaching`, {
          subjects: [{ subjectId: nationalSubject, grades: [7] }],
          languages: ['uz'],
        }),
      );
      // A subject moved to National later: a STEAM teacher may no longer take it.
      const moved = await load.classes.subject({ grades: [7] });
      ok(await subjectMove(moved, national, MOVE_ON));
      const { staffId: steamTeacher } = await load.teacher(t.north);
      refusedWith(
        await put(`/api/people/staff/${steamTeacher}/teaching`, {
          subjects: [{ subjectId: moved, grades: [7] }],
          languages: ['uz'],
        }),
        409,
        'subject_outside_department',
      );
    });

    it('an edit of the phone with the planned department, with or without its date, changes nothing about the department', async () => {
      // A row of STEAM in another branch whose year ends on 20 November: a
      // move or a cancel from today would be refused by it.
      const own = await t.newBranch();
      const shortYear = await load.classes.year(own, 'current', '2025-12-01', '2026-11-20');
      const subject = await load.classes.subject({ grades: [7] });
      const { staffId: teacher } = await load.teacher(own, {
        subjects: [{ subject, grades: [7] }],
      });
      await load.row({
        branch_id: own,
        version_id: await load.version(own, shortYear, { startsOn: STARTS_ON }),
        class_id: await load.classes.schoolClass(own, shortYear, { grade: 7 }),
        subject_id: subject,
        teacher_id: teacher,
      });
      await t.database.migrator
        .deleteFrom('staff_subjects')
        .where('staff_id', '=', teacher)
        .execute();
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: teacher, branch_id: t.north, is_main: false })
        .execute();
      ok(await teacherMove(teacher, national, '2026-11-25'));
      const stored = () =>
        t.database.migrator
          .selectFrom('staff_divisions')
          .selectAll()
          .where('staff_id', '=', teacher)
          .execute();
      const divisionsBefore = await stored();
      for (const [phone, startsOn] of [
        ['+998 90 765 43 01', '2026-11-25'],
        ['+998 90 765 43 02', undefined],
      ] as const) {
        const staff = await detail(teacher);
        const saved = await put(
          `/api/people/staff/${teacher}`,
          staffBody(staff, {
            phone,
            ...(startsOn === undefined ? {} : { departmentStartsOn: startsOn }),
          }),
          t.vicePrincipal,
        );
        ok(saved);
        expect(await stored()).toEqual(divisionsBefore);
        const entry = (await t.entries('staff.edit', teacher)).at(-1);
        expect(entry).toMatchObject({ assignment_id: t.viceAssignment });
        expect(Object.keys(entry?.['new_value'] as object)).toEqual(['phone']);
      }
    });

    it('the Academic division removed takes effect when saved (decision 3)', async () => {
      const { staffId: teacher } = await load.teacher(t.north);
      const removed = ok(
        await put(
          `/api/people/staff/${teacher}`,
          staffBody(await detail(teacher), {
            divisions: [{ divisionId: management, departmentId: null, main: true }],
            departmentStartsOn: MOVE_ON,
          }),
        ),
      );
      expect(staffDetailSchema.parse(removed.body).divisions).toEqual([
        {
          divisionId: management,
          departmentId: null,
          main: true,
          departmentSince: null,
          departmentMove: null,
        },
      ]);
    });

    describe('at the same moment (the kind is decided from the locked read)', () => {
      it('a stale edit of a teacher after another Super Admin planned a move answers staff_changed', async () => {
        const { staffId: teacher } = await load.teacher(t.north);
        const staff = await detail(teacher);
        // The held side plans a move to National as its route does.
        const held = await holdOpen(async (transaction) => {
          await lockDepartmentMoves(transaction);
          await transaction
            .selectFrom('staff')
            .select('id')
            .where('id', '=', teacher)
            .forUpdate()
            .execute();
          await transaction
            .updateTable('staff_divisions')
            .set({
              department_id: national,
              department_since: MOVE_ON,
              department_before: steam,
              department_before_since: null,
            })
            .where('staff_id', '=', teacher)
            .execute();
        });
        // A Super Admin edits the name from the form read before: STEAM, no date.
        const sent = put(
          `/api/people/staff/${teacher}`,
          staffBody(staff, { firstName: 'Shahnoza' }),
        ).then((response) => response);
        await untilWaiting();
        held.release();
        expect(await held.done).toBeUndefined();
        refusedWith(await sent, 409, 'staff_changed');
      });

      it('a change of a subject’s plan after another Super Admin cancelled it answers subject_changed', async () => {
        const subject = await load.classes.subject({ grades: [7] });
        ok(await subjectMove(subject, national, MOVE_ON));
        const answer = await subjectAnswer(subject);
        // The held side cancels as its route does.
        const held = await holdOpen(async (transaction) => {
          await lockDepartmentMoves(transaction);
          await transaction
            .selectFrom('subjects')
            .select('id')
            .where('id', '=', subject)
            .forUpdate()
            .execute();
          await transaction
            .updateTable('subjects')
            .set({
              department_id: steam,
              department_since: null,
              department_before: null,
              department_before_since: null,
            })
            .where('id', '=', subject)
            .execute();
        });
        const sent = put(
          `/api/setup/subjects/${subject}`,
          subjectBody(answer, { departmentId: general, departmentStartsOn: MOVE_ON }),
        ).then((response) => response);
        await untilWaiting();
        held.release();
        expect(await held.done).toBeUndefined();
        refusedWith(await sent, 409, 'subject_changed');
      });
    });
  });
});
