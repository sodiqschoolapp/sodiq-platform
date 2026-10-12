import {
  apiErrorSchema,
  availabilitySchema,
  BRANCH_HEADER,
  staffDetailSchema,
  staffListSchema,
  vacancyDetailSchema,
  vacancyListSchema,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  TODAY,
  TOMORROW,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

// All names are invented. docs/spec/04-people.md (Availability, Vacancy);
// docs/spec/06-timetable.md (Teachers who work in several branches);
// docs/spec/edge-cases/people-roles-accounts.md (Who can act); the plan
// approved on pull request #57 with its corrections. The clock stands at
// 23:55 on 10 October 2026 in Tashkent.
describe('availability and vacancies', () => {
  let t: DayTemplatesKit;
  let academic: string;
  let steam: string;
  let languages: string;
  let mathematics: string;
  let southVice: string;
  let southViceAssignment: string;
  let count = 0;

  const put = (path: string, branch: string, body: object, cookie = t.admin) =>
    request(t.kit.server).put(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body);

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  const lettersOf = (n: number): string =>
    n < 26
      ? String.fromCharCode(97 + n)
      : lettersOf(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26));

  /** A person created by the Super Admin in a branch, with further branches. */
  async function person(branch = t.north, further: string[] = []): Promise<string> {
    count += 1;
    const created = await t.post('/api/people/staff', branch, {
      firstName: 'Akmal',
      lastName: `Rahimov${lettersOf(count)}`,
      fatherName: '',
      sex: 'male',
      birthDate: '1990-01-01',
      educationLevel: null,
      phone: `+99891${String(1000000 + count)}`,
      email: '',
      jshshir: '',
      admissionDate: '2026-09-01',
      contractType: null,
      contractDate: null,
      weeklyLessons: null,
      dailyLessons: null,
      divisions: [{ divisionId: academic, departmentId: steam, main: true }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = staffDetailSchema.parse(created.body).id;
    if (further.length > 0) {
      const linked = await put(`/api/people/staff/${id}/branches`, branch, {
        mainBranchId: branch,
        furtherBranchIds: further,
      });
      expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    }
    return id;
  }

  const monday = (start: string, end: string) => ({ weekday: 1, start, end });

  const setHours = (
    id: string,
    branch: string,
    from: string,
    ranges: object[],
    cookie = t.vicePrincipal,
  ) => put(`/api/people/staff/${id}/availability`, branch, { from, ranges }, cookie);

  const hours = async (id: string, branch: string, cookie = t.vicePrincipal) => {
    const response = await t.get(`/api/people/staff/${id}/availability`, branch, cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return availabilitySchema.parse(response.body);
  };

  /** A vacancy's body with a name of its own. */
  function vacancyBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    count += 1;
    return {
      name: `English vacancy ${String(count)}`,
      departmentId: steam,
      subjects: [{ subjectId: mathematics, grades: [7, 8] }],
      languages: ['uz'],
      weeklyLessons: 18,
      dailyLessons: 6,
      ...overrides,
    };
  }

  async function vacancy(overrides: Record<string, unknown> = {}, branch = t.north) {
    const response = await t.post(
      '/api/people/vacancies',
      branch,
      vacancyBody(overrides),
      branch === t.north ? t.vicePrincipal : southVice,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return vacancyDetailSchema.parse(response.body);
  }

  /** Every row of the tables these routes write, and the audit count. */
  async function snapshot(): Promise<Record<string, unknown>> {
    const rows: Record<string, unknown> = { audit: await t.auditCount() };
    for (const table of [
      'staff',
      'staff_branches',
      'staff_divisions',
      'staff_subjects',
      'staff_languages',
      'staff_statuses',
      'staff_availability',
      'staff_availability_ranges',
    ] as const) {
      rows[table] = (
        await sql`select * from ${sql.table(table)} order by 1, 2`.execute(t.database.migrator)
      ).rows;
    }
    return rows;
  }

  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(t.database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  /** Runs `work` in a transaction of the application that stays open until released. */
  async function holdOpen(branches: string[], work: (transaction: Transaction) => Promise<void>) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const done = t.app.get(Transactions).run(branches, async (transaction) => {
      await work(transaction);
      ready();
      await released;
    });
    await Promise.race([isReady, done]);
    return { release, done };
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    const id = async (table: 'divisions' | 'departments', en: string) =>
      (
        await t.database.migrator
          .selectFrom(table)
          .select('id')
          .where('name_en', '=', en)
          .executeTakeFirstOrThrow()
      ).id;
    academic = await id('divisions', 'Academic');
    steam = await id('departments', 'STEAM');
    languages = await id('departments', 'Foreign languages');
    mathematics = (
      await t.database.migrator
        .insertInto('subjects')
        .values({
          name_uz: 'Matematika',
          name_ru: 'Математика',
          name_en: 'Mathematics',
          department_id: steam,
          grades: [5, 6, 7, 8],
          colour: 'blue',
          journal_type: 'graded',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const browser = await t.kit.completeSession('Malika', 'Yusupova');
    const assignment = await t.kit.giveRole(browser.account.id, {
      role: 'academic_vice_principal',
      branchId: t.south,
    });
    southVice = browser.cookie;
    southViceAssignment = assignment.id;
  });

  afterAll(async () => {
    await t.close();
  });

  describe('availability', () => {
    it('takes the first hours of a branch from today, then changes from tomorrow', async () => {
      const id = await person();
      const first = await setHours(id, t.north, TODAY, [monday('08:00', '13:00')]);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const [entry] = await t.entries('staff.availability_set', id);
      expect(entry).toMatchObject({
        branch_id: t.north,
        assignment_id: t.viceAssignment,
        person_id: id,
        request_id: expect.any(String) as unknown,
      });
      const answer = availabilitySchema.parse(first.body);
      expect(answer.entries).toEqual([
        {
          id: expect.any(String) as unknown,
          from: TODAY,
          until: null,
          ranges: [monday('08:00', '13:00')],
        },
      ]);
      expect(answer.earliestFrom).toBe(TOMORROW);
      refusedWith(await setHours(id, t.north, TODAY, []), 409, 'date_not_in_future');
      const changed = availabilitySchema.parse(
        (await setHours(id, t.north, TOMORROW, [monday('09:00', '12:00')])).body,
      );
      expect(changed.entries.map((one) => [one.from, one.until])).toEqual([
        [TODAY, TOMORROW],
        [TOMORROW, null],
      ]);
    });

    it('runs a change to the next planned entry, and withdraws one planned from the same date', async () => {
      const id = await person();
      expect((await setHours(id, t.north, '2026-11-02', [monday('08:00', '12:00')])).status).toBe(
        200,
      );
      const before = availabilitySchema.parse(
        (await setHours(id, t.north, '2026-10-20', [monday('10:00', '12:00')])).body,
      );
      expect(before.entries.map((one) => [one.from, one.until])).toEqual([
        ['2026-10-20', '2026-11-02'],
        ['2026-11-02', null],
      ]);
      const after = availabilitySchema.parse((await setHours(id, t.north, '2026-11-02', [])).body);
      expect(after.entries.map((one) => [one.from, one.until, one.ranges.length])).toEqual([
        ['2026-10-20', '2026-11-02', 1],
        ['2026-11-02', '2026-11-02', 1],
        ['2026-11-02', null, 0],
      ]);
    });

    it('refuses hours overlapping another branch on a weekday, without its times', async () => {
      const id = await person(t.north, [t.south]);
      expect((await setHours(id, t.north, TODAY, [monday('08:00', '13:00')])).status).toBe(200);
      const seen = await hours(id, t.south, southVice);
      expect(seen.entries).toEqual([]);
      expect(seen.elsewhere).toEqual([
        {
          branchId: t.north,
          name: 'North',
          entries: [
            {
              id: expect.any(String) as unknown,
              from: TODAY,
              until: null,
              ranges: [monday('08:00', '13:00')],
            },
          ],
        },
      ]);
      const before = await snapshot();
      const refused = await setHours(
        id,
        t.south,
        '2026-11-02',
        [monday('12:00', '15:00'), { weekday: 2, start: '08:00', end: '09:00' }],
        southVice,
      );
      refusedWith(refused, 409, 'availability_overlap');
      expect(apiErrorSchema.parse(refused.body).error.details).toEqual([
        expect.objectContaining({ path: 'weekday.1', code: 'overlap' }),
      ]);
      // Neither the message nor the details carry the other branch's times
      // (the request id is random and is left out of the check).
      const { message, details } = apiErrorSchema.parse(refused.body).error;
      expect(JSON.stringify({ message, details })).not.toMatch(/08:00|13:00|\b480\b|\b780\b/);
      expect(await snapshot()).toEqual(before);
      const touching = await setHours(id, t.south, TODAY, [monday('13:00', '17:00')], southVice);
      expect(touching.status, JSON.stringify(touching.body)).toBe(200);
      const [entry] = await t
        .entries('staff.availability_set', id)
        .then((all) => all.filter((one) => one.branch_id === t.south));
      expect(entry).toMatchObject({ assignment_id: southViceAssignment });
    });

    it('reads the branch of the request only, also for the Super Admin', async () => {
      const id = await person(t.north, [t.south]);
      expect((await setHours(id, t.north, TODAY, [monday('08:00', '13:00')])).status).toBe(200);
      const fromSouth = await hours(id, t.south, t.admin);
      expect(fromSouth.entries).toEqual([]);
      expect(fromSouth.elsewhere.map((branch) => branch.branchId)).toEqual([t.north]);
      const fromNorth = await hours(id, t.north, t.admin);
      expect(fromNorth.entries).toHaveLength(1);
      expect(fromNorth.elsewhere).toEqual([]);
    });

    it('answers 404 for a record of another branch or an unknown one, changing nothing', async () => {
      const south = await person(t.south);
      const before = await snapshot();
      for (const id of [south, UNKNOWN]) {
        refusedWith(await t.get(`/api/people/staff/${id}/availability`, t.north), 404, 'not_found');
        refusedWith(await setHours(id, t.north, TODAY, []), 404, 'not_found');
      }
      expect(await snapshot()).toEqual(before);
    });

    it('lets the Principal read and refuses his change and a Teacher', async () => {
      const id = await person();
      expect(
        (await t.get(`/api/people/staff/${id}/availability`, t.north, t.principal)).status,
      ).toBe(200);
      const before = await snapshot();
      refusedWith(await setHours(id, t.north, TODAY, [], t.principal), 403, 'permission_denied');
      refusedWith(await setHours(id, t.north, TODAY, [], t.teacher), 403, 'permission_denied');
      refusedWith(
        await t.get(`/api/people/staff/${id}/availability`, t.north, t.teacher),
        403,
        'permission_denied',
      );
      expect(await snapshot()).toEqual(before);
    });

    it('checks the ranges', async () => {
      const id = await person();
      for (const ranges of [
        [monday('13:00', '08:00')],
        [monday('08:00', '13:00'), monday('12:00', '14:00')],
        [{ weekday: 8, start: '08:00', end: '09:00' }],
        [monday('08:00', '24:30')],
      ]) {
        refusedWith(await setHours(id, t.north, TODAY, ranges), 400, 'validation_failed');
      }
      expect((await setHours(id, t.north, TODAY, [monday('18:00', '24:00')])).status).toBe(200);
    });

    it('ends the hours of a branch removed from the person from tomorrow', async () => {
      const id = await person(t.north, [t.south]);
      expect(
        (await setHours(id, t.south, TODAY, [monday('08:00', '13:00')], southVice)).status,
      ).toBe(200);
      expect((await setHours(id, t.south, '2026-11-02', [], southVice)).status).toBe(200);
      const removed = await put(`/api/people/staff/${id}/branches`, t.north, {
        mainBranchId: t.north,
        furtherBranchIds: [],
      });
      expect(removed.status, JSON.stringify(removed.body)).toBe(200);
      const rows = await t.database.migrator
        .selectFrom('staff_availability')
        .select([
          sql<string>`valid_from::text`.as('from'),
          sql<string>`valid_until::text`.as('until'),
        ])
        .where('staff_id', '=', id)
        .orderBy('valid_from')
        .execute();
      expect(rows).toEqual([
        { from: TODAY, until: TOMORROW },
        { from: '2026-11-02', until: '2026-11-02' },
      ]);
      const [entry] = await t.entries('staff.availability_end', id);
      expect(entry).toMatchObject({ branch_id: t.south, reason: 'branch_removed' });
      // The hours of the removed branch no longer block the others.
      expect((await setHours(id, t.north, '2026-11-02', [monday('08:00', '13:00')])).status).toBe(
        200,
      );
    });

    it('lets a write of another branch at the same moment wait for the first, then refuses it', async () => {
      const id = await person(t.north, [t.south]);
      const first = await holdOpen([t.north], async (transaction) => {
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', id)
          .forUpdate()
          .execute();
        const entry = await transaction
          .insertInto('staff_availability')
          .values({ branch_id: t.north, staff_id: id, valid_from: TODAY })
          .returning(['id', 'valid_until'])
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_availability_ranges')
          .values({
            entry_id: entry.id,
            branch_id: t.north,
            staff_id: id,
            weekday: 1,
            start_minutes: 480,
            end_minutes: 780,
            valid_from: TODAY,
            valid_until: entry.valid_until,
          })
          .execute();
      });
      const second = setHours(id, t.south, TODAY, [monday('09:00', '10:00')], southVice).then(
        (response) => response,
      );
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      first.release();
      await first.done;
      refusedWith(await second, 409, 'availability_overlap');
    });
  });

  describe('vacancies', () => {
    it('are created by the Academic Vice Principal with nothing personal and listed on their own', async () => {
      const created = await vacancy({ name: '  English vacancy A ' });
      expect(created).toMatchObject({
        name: 'English vacancy A',
        departmentId: steam,
        subjects: [{ subjectId: mathematics, grades: [7, 8] }],
        languages: ['uz'],
        weeklyLessons: 18,
        dailyLessons: 6,
        status: 'open',
        statuses: [{ status: 'open', from: TODAY, until: null }],
        today: TODAY,
      });
      const [entry] = await t.entries('vacancy.create', created.id);
      expect(entry).toMatchObject({
        branch_id: t.north,
        assignment_id: t.viceAssignment,
        person_id: null,
        request_id: expect.any(String) as unknown,
      });
      const row = await t.database.migrator
        .selectFrom('staff')
        .selectAll()
        .where('id', '=', created.id)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        kind: 'vacancy',
        staff_id: null,
        account_id: null,
        first_name: null,
      });
      const list = vacancyListSchema.parse(
        (await t.get('/api/people/vacancies', t.north, t.principal)).body,
      );
      expect(list.vacancies.map((one) => one.id)).toContain(created.id);
      const staff = staffListSchema.parse((await t.get('/api/people/staff', t.north)).body);
      expect(staff.staff.map((one) => one.id)).not.toContain(created.id);
      refusedWith(await t.get(`/api/people/staff/${created.id}`, t.north), 404, 'not_found');
      const south = vacancyListSchema.parse((await t.get('/api/people/vacancies', t.south)).body);
      expect(south.vacancies.map((one) => one.id)).not.toContain(created.id);
    });

    it('keeps a name to one open vacancy of the branch', async () => {
      const first = await vacancy({ name: 'Physics vacancy 1' });
      const before = await snapshot();
      const taken = await t.post(
        '/api/people/vacancies',
        t.north,
        vacancyBody({ name: 'physics VACANCY 1' }),
        t.vicePrincipal,
      );
      refusedWith(taken, 409, 'already_exists');
      expect(apiErrorSchema.parse(taken.body).error.details).toEqual([
        expect.objectContaining({ path: 'name' }),
      ]);
      expect(await snapshot()).toEqual(before);
      await vacancy({ name: 'Physics vacancy 1' }, t.south);
      expect(
        (await t.post(`/api/people/vacancies/${first.id}/close`, t.north, {}, t.vicePrincipal))
          .status,
      ).toBe(200);
      const second = await vacancy({ name: 'Physics vacancy 1' });
      expect(second.status).toBe('open');
      refusedWith(
        await t.post(`/api/people/vacancies/${first.id}/reopen`, t.north, {}, t.vicePrincipal),
        409,
        'already_exists',
      );
    });

    it('checks the department and the subjects', async () => {
      refusedWith(
        await t.post(
          '/api/people/vacancies',
          t.north,
          vacancyBody({ departmentId: languages }),
          t.vicePrincipal,
        ),
        409,
        'subject_outside_department',
      );
      refusedWith(
        await t.post(
          '/api/people/vacancies',
          t.north,
          vacancyBody({ subjects: [{ subjectId: mathematics, grades: [11] }] }),
          t.vicePrincipal,
        ),
        409,
        'grade_not_in_subject',
      );
      refusedWith(
        await t.post(
          '/api/people/vacancies',
          t.north,
          vacancyBody({ departmentId: UNKNOWN }),
          t.vicePrincipal,
        ),
        404,
        'not_found',
      );
      refusedWith(
        await t.post(
          '/api/people/vacancies',
          t.north,
          vacancyBody({ languages: [] }),
          t.vicePrincipal,
        ),
        400,
        'validation_failed',
      );
      // Fields of a person are not part of a vacancy and are never stored.
      const stripped = await t.post(
        '/api/people/vacancies',
        t.north,
        vacancyBody({ phone: '+998901234567', firstName: 'Akmal' }),
        t.vicePrincipal,
      );
      expect(stripped.status, JSON.stringify(stripped.body)).toBe(201);
      const row = await t.database.migrator
        .selectFrom('staff')
        .select(['phone', 'first_name'])
        .where('id', '=', vacancyDetailSchema.parse(stripped.body).id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ phone: null, first_name: null });
    });

    it('answer 404 for an unknown department or subject in the body, changing nothing', async () => {
      const created = await vacancy();
      const before = await snapshot();
      const unknownSubject = { subjects: [{ subjectId: UNKNOWN, grades: [7] }] };
      for (const body of [{ departmentId: UNKNOWN }, unknownSubject]) {
        refusedWith(
          await t.post('/api/people/vacancies', t.north, vacancyBody(body), t.vicePrincipal),
          404,
          'not_found',
        );
        refusedWith(
          await put(
            `/api/people/vacancies/${created.id}`,
            t.north,
            vacancyBody(body),
            t.vicePrincipal,
          ),
          404,
          'not_found',
        );
      }
      expect(await snapshot()).toEqual(before);
    });

    it('refuse a department outside the Academic division', async () => {
      const division = await t.database.migrator
        .insertInto('divisions')
        .values({ name_uz: 'Xoʻjalik', name_ru: 'Хозяйство', name_en: 'Facilities', position: 91 })
        .returning('id')
        .executeTakeFirstOrThrow();
      const department = await t.database.migrator
        .insertInto('departments')
        .values({
          division_id: division.id,
          name_uz: 'Bogʻ',
          name_ru: 'Сад',
          name_en: 'Garden',
          position: 1,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const before = await snapshot();
      refusedWith(
        await t.post(
          '/api/people/vacancies',
          t.north,
          vacancyBody({ departmentId: department.id, subjects: [], languages: [] }),
          t.vicePrincipal,
        ),
        409,
        'department_not_academic',
      );
      expect(await snapshot()).toEqual(before);
    });

    it('are deleted by the Super Admin too, the audit entry naming that assignment', async () => {
      const created = await vacancy();
      expect(
        (await t.post(`/api/people/vacancies/${created.id}/delete`, t.north, {}, t.admin)).status,
      ).toBe(204);
      const [entry] = await t.entries('vacancy.delete', created.id);
      expect(entry).toMatchObject({ assignment_id: t.adminAssignment });
    });

    it('are edited, closed and reopened, each audited', async () => {
      const created = await vacancy();
      const edited = await put(
        `/api/people/vacancies/${created.id}`,
        t.north,
        vacancyBody({ name: 'Mathematics vacancy E', weeklyLessons: 12, languages: ['uz', 'ru'] }),
        t.vicePrincipal,
      );
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(vacancyDetailSchema.parse(edited.body)).toMatchObject({
        name: 'Mathematics vacancy E',
        weeklyLessons: 12,
        languages: ['ru', 'uz'],
      });
      expect(await t.entries('vacancy.edit', created.id)).toHaveLength(1);
      const closed = await t.post(
        `/api/people/vacancies/${created.id}/close`,
        t.north,
        {},
        t.vicePrincipal,
      );
      expect(vacancyDetailSchema.parse(closed.body)).toMatchObject({
        status: 'closed',
        statuses: [
          { status: 'open', from: TODAY, until: TODAY },
          { status: 'closed', from: TODAY, until: null },
        ],
      });
      refusedWith(
        await t.post(`/api/people/vacancies/${created.id}/close`, t.north, {}, t.vicePrincipal),
        409,
        'status_unchanged',
      );
      const reopened = await t.post(
        `/api/people/vacancies/${created.id}/reopen`,
        t.north,
        {},
        t.admin,
      );
      expect(vacancyDetailSchema.parse(reopened.body).status).toBe('open');
      expect(await t.entries('vacancy.close', created.id)).toHaveLength(1);
      const [reopen] = await t.entries('vacancy.reopen', created.id);
      expect(reopen).toMatchObject({ assignment_id: t.adminAssignment });
    });

    it('checks on a reopen what changed while the vacancy was closed', async () => {
      const subject = (
        await t.database.migrator
          .insertInto('subjects')
          .values({
            name_uz: 'Kimyo',
            name_ru: 'Химия',
            name_en: 'Chemistry',
            department_id: steam,
            grades: [8, 9],
            colour: 'green',
            journal_type: 'attendance_only',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      const created = await vacancy({ subjects: [{ subjectId: subject, grades: [8, 9] }] });
      const close = () =>
        t.post(`/api/people/vacancies/${created.id}/close`, t.north, {}, t.vicePrincipal);
      const reopen = () =>
        t.post(`/api/people/vacancies/${created.id}/reopen`, t.north, {}, t.vicePrincipal);
      expect((await close()).status).toBe(200);
      // A closed vacancy does not keep its subject's grades (decision 14).
      const subjectEdit = await put(`/api/setup/subjects/${subject}`, t.north, {
        names: { uz: 'Kimyo', ru: 'Химия', en: 'Chemistry' },
        departmentId: steam,
        grades: [9],
        colour: 'green',
        journalType: 'attendance_only',
        ratingExam: false,
        groupSubject: false,
        languageRule: true,
        demanding: false,
        daily: null,
      });
      expect(subjectEdit.status, JSON.stringify(subjectEdit.body)).toBe(200);
      refusedWith(await reopen(), 409, 'grade_not_in_subject');
      await t.database.migrator
        .updateTable('subjects')
        .set({ grades: [8, 9] })
        .where('id', '=', subject)
        .execute();
      // The subject moved to another department while the vacancy was closed.
      await t.database.migrator
        .updateTable('subjects')
        .set({ department_id: languages })
        .where('id', '=', subject)
        .execute();
      refusedWith(await reopen(), 409, 'subject_outside_department');
      await t.database.migrator
        .updateTable('subjects')
        .set({ department_id: steam })
        .where('id', '=', subject)
        .execute();
      await t.database.migrator
        .updateTable('departments')
        .set({ archived_at: new Date('2026-10-10T12:00:00Z') })
        .where('id', '=', steam)
        .execute();
      try {
        refusedWith(await reopen(), 409, 'department_archived');
      } finally {
        await t.database.migrator
          .updateTable('departments')
          .set({ archived_at: null })
          .where('id', '=', steam)
          .execute();
      }
      expect((await reopen()).status).toBe(200);
    });

    it('keep a department from its archive and a subject from losing a grade while open', async () => {
      const department = (
        await t.database.migrator
          .insertInto('departments')
          .values({
            division_id: academic,
            name_uz: 'Sanʼat',
            name_ru: 'Искусство',
            name_en: 'Arts',
            position: 50,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      const subject = (
        await t.post('/api/setup/subjects', t.north, {
          names: { uz: 'Musiqa', ru: 'Музыка', en: 'Music' },
          departmentId: department,
          grades: [5, 6],
          colour: 'red',
          journalType: 'attendance_only',
          ratingExam: false,
          groupSubject: false,
          languageRule: true,
          demanding: false,
          daily: null,
        })
      ).body as { id: string };
      const created = await vacancy({
        departmentId: department,
        subjects: [{ subjectId: subject.id, grades: [5, 6] }],
      });
      const edit = (branch: string) =>
        put(`/api/setup/subjects/${subject.id}`, branch, {
          names: { uz: 'Musiqa', ru: 'Музыка', en: 'Music' },
          departmentId: department,
          grades: [5],
          colour: 'red',
          journalType: 'attendance_only',
          ratingExam: false,
          groupSubject: false,
          languageRule: true,
          demanding: false,
          daily: null,
        });
      const here = await edit(t.north);
      refusedWith(here, 409, 'subject_has_teachers');
      expect(apiErrorSchema.parse(here.body).error.details).toEqual([
        expect.objectContaining({ path: `vacancy.${created.id}`, code: 'teaches' }),
      ]);
      const elsewhere = await edit(t.south);
      refusedWith(elsewhere, 409, 'subject_has_teachers');
      expect(apiErrorSchema.parse(elsewhere.body).error.details).toEqual([
        expect.objectContaining({ path: 'elsewhere', code: '1' }),
      ]);
      expect(
        (await t.post(`/api/people/vacancies/${created.id}/close`, t.north, {}, t.vicePrincipal))
          .status,
      ).toBe(200);
      expect((await edit(t.north)).status).toBe(200);
      // A department without subjects, with an open vacancy in it.
      const empty = (
        await t.database.migrator
          .insertInto('departments')
          .values({
            division_id: academic,
            name_uz: 'Hunar',
            name_ru: 'Ремёсла',
            name_en: 'Crafts',
            position: 51,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      const open = await vacancy({ departmentId: empty, subjects: [], languages: [] });
      const archive = () =>
        request(t.kit.server)
          .post(`/api/setup/departments/${empty}/archive`)
          .set('Cookie', t.admin)
          .send({});
      refusedWith(await archive(), 409, 'department_has_staff');
      expect(
        (await t.post(`/api/people/vacancies/${open.id}/close`, t.north, {}, t.vicePrincipal))
          .status,
      ).toBe(200);
      expect((await archive()).status).toBe(200);
    });

    it('are deleted with the whole record kept in the audit entry', async () => {
      const created = await vacancy();
      expect((await setHours(created.id, t.north, TODAY, [monday('08:00', '13:00')])).status).toBe(
        200,
      );
      const deleted = await t.post(
        `/api/people/vacancies/${created.id}/delete`,
        t.north,
        {},
        t.vicePrincipal,
      );
      expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);
      const [entry] = await t.entries('vacancy.delete', created.id);
      expect(entry).toMatchObject({
        assignment_id: t.viceAssignment,
        old_value: {
          name: created.name,
          departmentId: steam,
          subjects: [{ subjectId: mathematics, grades: [7, 8] }],
          languages: ['uz'],
          weeklyLessons: 18,
          dailyLessons: 6,
          statuses: [{ status: 'open', from: TODAY, until: null }],
          availability: [
            {
              from: TODAY,
              until: null,
              ranges: [{ weekday: 1, startMinutes: 480, endMinutes: 780 }],
            },
          ],
        },
      });
      refusedWith(await t.get(`/api/people/vacancies/${created.id}`, t.north), 404, 'not_found');
      expect(
        await t.database.migrator
          .selectFrom('staff')
          .select('id')
          .where('id', '=', created.id)
          .execute(),
      ).toEqual([]);
    });

    it('answer 404 for a vacancy of another branch, an unknown id and a person, changing nothing', async () => {
      const south = await vacancy({}, t.south);
      const teacher = await person();
      const before = await snapshot();
      for (const id of [south.id, UNKNOWN, teacher]) {
        refusedWith(await t.get(`/api/people/vacancies/${id}`, t.north), 404, 'not_found');
        refusedWith(
          await put(`/api/people/vacancies/${id}`, t.north, vacancyBody()),
          404,
          'not_found',
        );
        for (const action of ['close', 'reopen', 'delete']) {
          refusedWith(
            await t.post(`/api/people/vacancies/${id}/${action}`, t.north, {}),
            404,
            'not_found',
          );
        }
      }
      expect(await snapshot()).toEqual(before);
    });

    it('refuse every change of the Principal and a Teacher', async () => {
      const created = await vacancy();
      const before = await snapshot();
      for (const cookie of [t.principal, t.teacher]) {
        refusedWith(
          await t.post('/api/people/vacancies', t.north, vacancyBody(), cookie),
          403,
          'permission_denied',
        );
        refusedWith(
          await put(`/api/people/vacancies/${created.id}`, t.north, vacancyBody(), cookie),
          403,
          'permission_denied',
        );
        for (const action of ['close', 'reopen', 'delete']) {
          refusedWith(
            await t.post(`/api/people/vacancies/${created.id}/${action}`, t.north, {}, cookie),
            403,
            'permission_denied',
          );
        }
      }
      refusedWith(
        await t.get('/api/people/vacancies', t.north, t.teacher),
        403,
        'permission_denied',
      );
      expect(await snapshot()).toEqual(before);
    });

    it('give two creates of one name at the same moment one vacancy', async () => {
      const name = 'Biology vacancy 1';
      const answers = await Promise.all([
        t.post('/api/people/vacancies', t.north, vacancyBody({ name }), t.vicePrincipal),
        t.post('/api/people/vacancies', t.north, vacancyBody({ name }), t.admin),
      ]);
      expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409]);
    });

    it('let a create wait for a reopen that holds the branch, then see its name', async () => {
      const created = await vacancy({ name: 'History vacancy 1' });
      expect(
        (await t.post(`/api/people/vacancies/${created.id}/close`, t.north, {}, t.vicePrincipal))
          .status,
      ).toBe(200);
      const reopen = await holdOpen([t.north], async (transaction) => {
        await transaction
          .selectFrom('branches')
          .select('id')
          .where('id', '=', t.north)
          .forNoKeyUpdate()
          .execute();
        await transaction
          .updateTable('staff_statuses')
          .set({ valid_until: TODAY })
          .where('staff_id', '=', created.id)
          .where('status', '=', 'closed')
          .execute();
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: created.id, status: 'open', valid_from: TODAY })
          .execute();
      });
      const create = t
        .post(
          '/api/people/vacancies',
          t.north,
          vacancyBody({ name: 'History vacancy 1' }),
          t.vicePrincipal,
        )
        .then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      reopen.release();
      await reopen.done;
      refusedWith(await create, 409, 'already_exists');
    });

    it('let a delete wait for a change that holds the record, and a close after a delete find nothing', async () => {
      const created = await vacancy();
      const close = await holdOpen([t.north], async (transaction) => {
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', created.id)
          .forUpdate()
          .execute();
      });
      const deleted = t
        .post(`/api/people/vacancies/${created.id}/delete`, t.north, {}, t.vicePrincipal)
        .then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      close.release();
      await close.done;
      expect((await deleted).status).toBe(204);
      refusedWith(
        await t.post(`/api/people/vacancies/${created.id}/close`, t.north, {}, t.vicePrincipal),
        404,
        'not_found',
      );
      refusedWith(await setHours(created.id, t.north, TODAY, []), 404, 'not_found');
    });
  });

  // .claude/rules/api.md: each pair of changes that meet on a row, run at the
  // same moment, in both directions. One side is held open in a transaction
  // that does what its route does; the real route of the other side is sent,
  // waits for the lock, and then sees the result of the first.
  describe('at the same moment', () => {
    /** Starts a route, waits until it waits for a lock, then lets the held side commit. */
    async function routeAfter(
      held: { release: () => void; done: Promise<void> },
      route: () => Promise<Response>,
    ): Promise<Response> {
      const answer = route().then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      await held.done;
      return answer;
    }

    /** What the availability write does first: the record, then its link in the branch. */
    async function lockForHours(transaction: Transaction, id: string, branch: string) {
      await transaction.selectFrom('staff').select('id').where('id', '=', id).forUpdate().execute();
      await transaction
        .selectFrom('staff_branches')
        .select('staff_id')
        .where('staff_id', '=', id)
        .where('branch_id', '=', branch)
        .forShare()
        .execute();
    }

    /** An open entry written as the availability write writes it. */
    async function writeEntry(
      transaction: Transaction,
      id: string,
      branch: string,
      start: number,
      end: number,
    ) {
      const entry = await transaction
        .insertInto('staff_availability')
        .values({ branch_id: branch, staff_id: id, valid_from: TODAY })
        .returning(['id', 'valid_until'])
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_availability_ranges')
        .values({
          entry_id: entry.id,
          branch_id: branch,
          staff_id: id,
          weekday: 1,
          start_minutes: start,
          end_minutes: end,
          valid_from: TODAY,
          valid_until: entry.valid_until,
        })
        .execute();
    }

    /** A vacancy written as the create writes it, after the lock of the branch row. */
    async function createVacancy(transaction: Transaction, name: string) {
      await transaction
        .selectFrom('branches')
        .select('id')
        .where('id', '=', t.north)
        .forNoKeyUpdate()
        .execute();
      const id = (await sql<{ id: string }>`select uuidv7() as id`.execute(transaction)).rows[0]
        ?.id;
      if (id === undefined) {
        throw new Error('No id.');
      }
      await transaction
        .insertInto('staff')
        .values({ id, kind: 'vacancy', vacancy_name: name })
        .execute();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: id, branch_id: t.north, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({ staff_id: id, division_id: academic, department_id: steam, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: id, status: 'open', valid_from: TODAY })
        .execute();
    }

    it('an hours write waits for a removal of its branch, then finds nothing', async () => {
      const id = await person(t.north, [t.south]);
      const removal = await holdOpen([t.north, t.south], async (transaction) => {
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', id)
          .forUpdate()
          .execute();
        await transaction
          .deleteFrom('staff_branches')
          .where('staff_id', '=', id)
          .where('branch_id', '=', t.south)
          .execute();
      });
      refusedWith(
        await routeAfter(removal, () =>
          setHours(id, t.south, TODAY, [monday('08:00', '13:00')], southVice),
        ),
        404,
        'not_found',
      );
      expect(
        await t.database.migrator
          .selectFrom('staff_availability')
          .select('id')
          .where('staff_id', '=', id)
          .execute(),
      ).toEqual([]);
    });

    it('a removal of a branch waits for an hours write there, then ends those hours', async () => {
      const id = await person(t.north, [t.south]);
      const write = await holdOpen([t.south], async (transaction) => {
        await lockForHours(transaction, id, t.south);
        await writeEntry(transaction, id, t.south, 480, 780);
      });
      const removed = await routeAfter(write, () =>
        put(`/api/people/staff/${id}/branches`, t.north, {
          mainBranchId: t.north,
          furtherBranchIds: [],
        }),
      );
      expect(removed.status, JSON.stringify(removed.body)).toBe(200);
      const rows = await t.database.migrator
        .selectFrom('staff_availability')
        .select(sql<string>`valid_until::text`.as('until'))
        .where('staff_id', '=', id)
        .execute();
      expect(rows).toEqual([{ until: TOMORROW }]);
    });

    it('an hours write of the first branch waits for one of the second, then is refused', async () => {
      const id = await person(t.north, [t.south]);
      const south = await holdOpen([t.south], async (transaction) => {
        await lockForHours(transaction, id, t.south);
        await writeEntry(transaction, id, t.south, 540, 600);
      });
      refusedWith(
        await routeAfter(south, () => setHours(id, t.north, TODAY, [monday('08:00', '13:00')])),
        409,
        'availability_overlap',
      );
    });

    it('a reopen waits for a create of its name, then is refused', async () => {
      const created = await vacancy({ name: 'Drawing vacancy 1' });
      expect(
        (await t.post(`/api/people/vacancies/${created.id}/close`, t.north, {}, t.vicePrincipal))
          .status,
      ).toBe(200);
      const create = await holdOpen([t.north], (transaction) =>
        createVacancy(transaction, 'Drawing vacancy 1'),
      );
      refusedWith(
        await routeAfter(create, () =>
          t.post(`/api/people/vacancies/${created.id}/reopen`, t.north, {}, t.vicePrincipal),
        ),
        409,
        'already_exists',
      );
    });

    it('a rename waits for a create of that name, then is refused', async () => {
      const created = await vacancy({ name: 'Singing vacancy 1' });
      const create = await holdOpen([t.north], (transaction) =>
        createVacancy(transaction, 'Singing vacancy 2'),
      );
      refusedWith(
        await routeAfter(create, () =>
          put(
            `/api/people/vacancies/${created.id}`,
            t.north,
            vacancyBody({ name: 'Singing vacancy 2' }),
            t.vicePrincipal,
          ),
        ),
        409,
        'already_exists',
      );
    });

    it('a close waits for a delete, then finds nothing', async () => {
      const created = await vacancy();
      const deleting = await holdOpen([t.north], async (transaction) => {
        await sql`select vacancy_delete(${created.id}::uuid)`.execute(transaction);
      });
      refusedWith(
        await routeAfter(deleting, () =>
          t.post(`/api/people/vacancies/${created.id}/close`, t.north, {}, t.vicePrincipal),
        ),
        404,
        'not_found',
      );
    });

    it('a delete waits for a close, then keeps the closed row in its audit entry', async () => {
      const created = await vacancy();
      const closing = await holdOpen([t.north], async (transaction) => {
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', created.id)
          .forUpdate()
          .execute();
        await transaction
          .updateTable('staff_statuses')
          .set({ valid_until: TODAY })
          .where('staff_id', '=', created.id)
          .execute();
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: created.id, status: 'closed', valid_from: TODAY })
          .execute();
      });
      const deleted = await routeAfter(closing, () =>
        t.post(`/api/people/vacancies/${created.id}/delete`, t.north, {}, t.vicePrincipal),
      );
      expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);
      const [entry] = await t.entries('vacancy.delete', created.id);
      expect(entry).toMatchObject({
        old_value: {
          statuses: [
            { status: 'open', from: TODAY, until: TODAY },
            { status: 'closed', from: TODAY, until: null },
          ],
        },
      });
    });

    it('an hours write waits for a delete, then finds nothing', async () => {
      const created = await vacancy();
      const deleting = await holdOpen([t.north], async (transaction) => {
        await sql`select vacancy_delete(${created.id}::uuid)`.execute(transaction);
      });
      refusedWith(
        await routeAfter(deleting, () =>
          setHours(created.id, t.north, TODAY, [monday('08:00', '13:00')]),
        ),
        404,
        'not_found',
      );
    });
  });
});
