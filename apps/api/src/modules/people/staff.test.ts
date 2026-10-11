import {
  apiErrorSchema,
  BRANCH_HEADER,
  divisionListSchema,
  staffCheckResultSchema,
  staffDetailSchema,
  staffIdentitySchema,
  staffListSchema,
  type StaffDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { errorCode, NEW_PASSWORD } from '../../testing/sign-in-kit.js';

// All names are invented. docs/spec/04-people.md, Teacher and staff record;
// docs/spec/edge-cases/people-roles-accounts.md (Who can act, Staff over time,
// Accounts and sign-in); the plan approved on pull request #53 with its
// corrections. The clock stands at 23:55 on 10 October 2026 in Tashkent.
describe('staff records', () => {
  let t: DayTemplatesKit;
  let academic: string;
  let management: string;
  let steam: string;
  let languages: string;
  let mathematics: string;
  let count = 0;

  const put = (path: string, branch: string, body: object, cookie = t.admin) =>
    request(t.kit.server).put(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body);

  /** A new person's body with a name and phone of its own. */
  function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    count += 1;
    return {
      firstName: 'Akmal',
      lastName: `Karimov${'a'.repeat(count)}`,
      fatherName: '',
      sex: 'male',
      birthDate: '1990-01-01',
      educationLevel: 'master',
      phone: `+99890${String(1000000 + count)}`,
      email: '',
      jshshir: '',
      admissionDate: '2026-09-01',
      contractType: 'full_time',
      contractDate: '2026-09-01',
      weeklyLessons: 18,
      dailyLessons: 5,
      divisions: [{ divisionId: academic, departmentId: steam, main: true }],
      ...overrides,
    };
  }

  /** What an edit sends: the fields of the answer. */
  const editBody = (staff: StaffDetail, overrides: Record<string, unknown> = {}) => ({
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
    divisions: staff.divisions,
    ...overrides,
  });

  async function create(overrides: Record<string, unknown> = {}, branch = t.north) {
    const response = await t.post('/api/people/staff', branch, body(overrides));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return staffDetailSchema.parse(response.body);
  }

  const detail = async (id: string, branch = t.north, cookie = t.admin) => {
    const response = await t.get(`/api/people/staff/${id}`, branch, cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return staffDetailSchema.parse(response.body);
  };

  /** Every row of the staff tables and the audit count: what a refused change leaves as it was. */
  async function snapshot(): Promise<Record<string, unknown>> {
    const rows: Record<string, unknown> = { audit: await t.auditCount() };
    for (const table of [
      'staff',
      'staff_branches',
      'staff_divisions',
      'staff_subjects',
      'staff_languages',
      'staff_statuses',
      'assignments',
    ] as const) {
      rows[table] = await sql`select * from ${sql.table(table)} order by 1, 2`.execute(
        t.database.migrator,
      );
    }
    return rows;
  }

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(t.database.migrator);
    return found.rows[0]?.waiting ?? 0;
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
    management = await id('divisions', 'Management');
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
  });

  afterAll(async () => {
    await t.close();
  });

  describe('create', () => {
    it('gives the staff ID of the admission year and the first status from the admission date', async () => {
      const first = await create({ admissionDate: '2015-08-25' });
      const second = await create({ admissionDate: '2015-09-01' });
      expect(first.staffId).toBe('S-150001');
      expect(second.staffId).toBe('S-150002');
      expect(first.statuses).toEqual([
        { id: expect.any(String) as unknown, status: 'active', from: '2015-08-25', until: null },
      ]);
      expect(first.status).toBe('active');
      expect(first.branches).toEqual([{ branchId: t.north, name: 'North', main: true }]);
      expect(first.rights).toEqual({ all: true, contact: true, teaching: true });
      const [entry] = await t.entries('staff.create', first.id);
      expect(entry).toMatchObject({
        branch_id: t.north,
        assignment_id: t.adminAssignment,
        person_id: first.id,
        request_id: expect.any(String) as unknown,
      });
    });

    it('stores a typed name in its one form', async () => {
      const created = await create({ firstName: "O'tkir", lastName: 'G’ofurov' });
      expect([created.firstName, created.lastName]).toEqual(['Oʻtkir', 'Gʻofurov']);
    });

    it('is seen only in the branch it is linked to', async () => {
      const created = await create();
      refusedWith(await t.get(`/api/people/staff/${created.id}`, t.south), 404, 'not_found');
      const south = staffListSchema.parse((await t.get('/api/people/staff', t.south)).body);
      expect(south.staff.map((person) => person.id)).not.toContain(created.id);
      const north = staffListSchema.parse((await t.get('/api/people/staff', t.north)).body);
      expect(north.staff.map((person) => person.id)).toContain(created.id);
      expect(north.today).toBe('2026-10-10');
    });

    it('is refused to the Academic Vice Principal, the Principal and a Teacher', async () => {
      const before = await snapshot();
      for (const cookie of [t.vicePrincipal, t.principal, t.teacher]) {
        refusedWith(
          await t.post('/api/people/staff', t.north, body(), cookie),
          403,
          'permission_denied',
        );
      }
      expect(await snapshot()).toEqual(before);
    });

    it('refuses a taken JSHSHIR by its field, also from another branch', async () => {
      await create({ jshshir: '41234567890123' });
      const before = await snapshot();
      const response = await t.post(
        '/api/people/staff',
        t.south,
        body({ jshshir: '41234567890123' }),
      );
      refusedWith(response, 409, 'already_exists');
      expect(apiErrorSchema.parse(response.body).error.details?.map((d) => d.path)).toEqual([
        'jshshir',
      ]);
      expect(await snapshot()).toEqual(before);
    });

    it('refuses a record without a department in Academic, and unknown divisions', async () => {
      refusedWith(
        await t.post(
          '/api/people/staff',
          t.north,
          body({ divisions: [{ divisionId: academic, departmentId: null, main: true }] }),
        ),
        409,
        'staff_department_required',
      );
      refusedWith(
        await t.post(
          '/api/people/staff',
          t.north,
          body({ divisions: [{ divisionId: UNKNOWN, departmentId: null, main: true }] }),
        ),
        404,
        'not_found',
      );
      refusedWith(
        await t.post(
          '/api/people/staff',
          t.north,
          body({ divisions: [{ divisionId: management, departmentId: steam, main: true }] }),
        ),
        404,
        'not_found',
      );
      expect(
        (
          await t.post(
            '/api/people/staff',
            t.north,
            body({ divisions: [{ divisionId: management, departmentId: null, main: true }] }),
          )
        ).status,
      ).toBe(201);
    });

    it('refuses what the shared schema refuses', async () => {
      const response = await t.post('/api/people/staff', t.north, body({ firstName: 'Ўткир' }));
      refusedWith(response, 400, 'validation_failed');
    });
  });

  describe('edit', () => {
    it('lets the Academic Vice Principal change name, phone and email, and names that assignment', async () => {
      const created = await create();
      const response = await put(
        `/api/people/staff/${created.id}`,
        t.north,
        editBody(created, { phone: '+998 91 000 00 01', email: 'teacher@school.uz' }),
        t.vicePrincipal,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const changed = staffDetailSchema.parse(response.body);
      expect([changed.phone, changed.email]).toEqual(['+998910000001', 'teacher@school.uz']);
      expect(changed.rights).toEqual({ all: false, contact: true, teaching: true });
      const [entry] = await t.entries('staff.edit', created.id);
      expect(entry).toMatchObject({
        assignment_id: t.viceAssignment,
        old_value: { phone: created.phone, email: null },
      });
    });

    it('keeps every other field to the Super Admin', async () => {
      const created = await create();
      const before = await snapshot();
      for (const overrides of [
        { sex: 'female' },
        { weeklyLessons: 20 },
        { divisions: [{ divisionId: management, departmentId: null, main: true }] },
      ]) {
        refusedWith(
          await put(
            `/api/people/staff/${created.id}`,
            t.north,
            editBody(created, overrides),
            t.vicePrincipal,
          ),
          403,
          'permission_denied',
        );
      }
      refusedWith(
        await put(`/api/people/staff/${created.id}`, t.north, editBody(created), t.principal),
        403,
        'permission_denied',
      );
      expect(await snapshot()).toEqual(before);
    });

    // `.claude/rules/api.md`: a part allowed to one role only is decided from
    // every current assignment. An account whose first assignment is the
    // Academic Vice Principal's and which also holds the Super Admin's.
    it("decides the Super Admin's part from every assignment and names that one", async () => {
      const browser = await t.kit.completeSession('Lola', 'Rasulova');
      const vice = await t.kit.giveRole(browser.account.id, {
        role: 'academic_vice_principal',
        branchId: t.north,
      });
      const admin = await t.kit.giveRole(browser.account.id, { role: 'super_admin' });
      expect(vice.id < admin.id).toBe(true);
      const created = await create();
      const response = await put(
        `/api/people/staff/${created.id}`,
        t.north,
        editBody(created, { weeklyLessons: 22 }),
        browser.cookie,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const [entry] = await t.entries('staff.edit', created.id);
      expect(entry).toMatchObject({ assignment_id: admin.id });
      const status = await t.post(
        `/api/people/staff/${created.id}/status`,
        t.north,
        { status: 'inactive', from: '2026-10-20' },
        browser.cookie,
      );
      expect(status.status).toBe(200);
      const [statusEntry] = await t.entries('staff.status', created.id);
      expect(statusEntry).toMatchObject({ assignment_id: admin.id });
    });

    it('keeps the staff ID through a correction of the admission date (decision 7)', async () => {
      const created = await create({ admissionDate: '2026-09-01' });
      const response = await put(
        `/api/people/staff/${created.id}`,
        t.north,
        editBody(created, { admissionDate: '2025-09-01' }),
      );
      expect(response.status).toBe(200);
      const changed = staffDetailSchema.parse(response.body);
      expect(changed.staffId).toBe(created.staffId);
      expect(changed.admissionDate).toBe('2025-09-01');
      expect(changed.statuses).toEqual(created.statuses);
    });

    it('answers 404 for a record of another branch and for an unknown one, and changes nothing', async () => {
      const created = await create();
      const before = await snapshot();
      for (const [id, branch] of [
        [created.id, t.south],
        [UNKNOWN, t.north],
      ] as const) {
        refusedWith(
          await put(`/api/people/staff/${id}`, branch, editBody(created)),
          404,
          'not_found',
        );
        refusedWith(
          await put(`/api/people/staff/${id}/teaching`, branch, { subjects: [], languages: [] }),
          404,
          'not_found',
        );
        refusedWith(
          await put(`/api/people/staff/${id}/branches`, branch, {
            mainBranchId: t.north,
            furtherBranchIds: [],
          }),
          404,
          'not_found',
        );
        refusedWith(
          await t.post(`/api/people/staff/${id}/status`, branch, {
            status: 'inactive',
            from: '2026-10-20',
          }),
          404,
          'not_found',
        );
        // As the Super Admin, whom the guard lets into every branch: the
        // handler runs and the membership filter answers 404, with no entry.
        refusedWith(await t.post(`/api/people/staff/${id}/identity`, branch, {}), 404, 'not_found');
        refusedWith(await t.get(`/api/people/staff/${id}`, branch), 404, 'not_found');
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('teaching', () => {
    it('takes subjects of the Academic department with their grades, and languages', async () => {
      const created = await create();
      const response = await put(
        `/api/people/staff/${created.id}/teaching`,
        t.north,
        { subjects: [{ subjectId: mathematics, grades: [7, 8] }], languages: ['uz', 'ru'] },
        t.vicePrincipal,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const changed = staffDetailSchema.parse(response.body);
      expect(changed.subjects).toEqual([{ subjectId: mathematics, grades: [7, 8] }]);
      expect(changed.languages).toEqual(['ru', 'uz']);
      const [entry] = await t.entries('staff.teaching', created.id);
      expect(entry).toMatchObject({ assignment_id: t.viceAssignment });
    });

    it('refuses a subject of another department, a grade the subject lacks and an unknown subject', async () => {
      const created = await create({
        divisions: [{ divisionId: academic, departmentId: languages, main: true }],
      });
      const before = await snapshot();
      const teach = (subjects: object[]) =>
        put(`/api/people/staff/${created.id}/teaching`, t.north, { subjects, languages: ['uz'] });
      refusedWith(
        await teach([{ subjectId: mathematics, grades: [7] }]),
        409,
        'subject_outside_department',
      );
      const own = await create();
      refusedWith(
        await put(`/api/people/staff/${own.id}/teaching`, t.north, {
          subjects: [{ subjectId: mathematics, grades: [9] }],
          languages: ['uz'],
        }),
        409,
        'grade_not_in_subject',
      );
      refusedWith(await teach([{ subjectId: UNKNOWN, grades: [7] }]), 404, 'not_found');
      refusedWith(
        await put(
          `/api/people/staff/${created.id}/teaching`,
          t.north,
          { subjects: [], languages: [] },
          t.principal,
        ),
        403,
        'permission_denied',
      );
      const after = await snapshot();
      // The second create is the only change.
      expect((after.staff as { rows: unknown[] }).rows.length).toBe(
        (before.staff as { rows: unknown[] }).rows.length + 1,
      );
    });
  });

  describe('branches', () => {
    it('lets the Super Admin add and move branches; the record is then seen there too', async () => {
      const created = await create();
      const response = await put(`/api/people/staff/${created.id}/branches`, t.north, {
        mainBranchId: t.south,
        furtherBranchIds: [t.north],
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(staffDetailSchema.parse(response.body).branches).toEqual([
        { branchId: t.south, name: 'South', main: true },
        { branchId: t.north, name: 'North', main: false },
      ]);
      expect((await t.get(`/api/people/staff/${created.id}`, t.south)).status).toBe(200);
      const [entry] = await t.entries('staff.branches', created.id);
      expect(entry).toMatchObject({ assignment_id: t.adminAssignment });
    });

    it('keeps them to the Super Admin and refuses an unknown branch', async () => {
      const created = await create();
      const before = await snapshot();
      refusedWith(
        await put(
          `/api/people/staff/${created.id}/branches`,
          t.north,
          { mainBranchId: t.north, furtherBranchIds: [t.south] },
          t.vicePrincipal,
        ),
        403,
        'permission_denied',
      );
      refusedWith(
        await put(`/api/people/staff/${created.id}/branches`, t.north, {
          mainBranchId: t.north,
          furtherBranchIds: [UNKNOWN],
        }),
        404,
        'not_found',
      );
      expect(await snapshot()).toEqual(before);
    });

    // The permission review of pull request #53: the Super Admin removes the
    // branch of the request; the answer is the record as it now is.
    it('lets the Super Admin remove the branch it works in from a person', async () => {
      const created = await create();
      await put(`/api/people/staff/${created.id}/branches`, t.north, {
        mainBranchId: t.north,
        furtherBranchIds: [t.south],
      });
      const response = await put(`/api/people/staff/${created.id}/branches`, t.north, {
        mainBranchId: t.south,
        furtherBranchIds: [],
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(staffDetailSchema.parse(response.body).branches).toEqual([
        { branchId: t.south, name: 'South', main: true },
      ]);
      refusedWith(await t.get(`/api/people/staff/${created.id}`, t.north), 404, 'not_found');
    });

    it('shows a reader who is not the Super Admin only the branch it works in', async () => {
      const created = await create();
      await put(`/api/people/staff/${created.id}/branches`, t.north, {
        mainBranchId: t.south,
        furtherBranchIds: [t.north],
      });
      expect((await detail(created.id, t.north, t.vicePrincipal)).branches).toEqual([
        { branchId: t.north, name: 'North', main: false },
      ]);
    });
  });

  describe('status', () => {
    const statusOf = (id: string, status: string, from: string, cookie = t.admin) =>
      t.post(`/api/people/staff/${id}/status`, t.north, { status, from }, cookie);

    const rowsOf = async (id: string) =>
      (
        await t.database.migrator
          .selectFrom('staff_statuses')
          .select(['status', 'valid_from', 'valid_until'])
          .where('staff_id', '=', id)
          .orderBy('valid_from')
          .orderBy('created_at')
          .execute()
      ).map((row) => [row.status, row.valid_from, row.valid_until]);

    it('changes from a date today or later and keeps the history', async () => {
      const created = await create();
      const response = await statusOf(created.id, 'inactive', '2026-10-10');
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const changed = staffDetailSchema.parse(response.body);
      expect(changed.status).toBe('inactive');
      expect(changed.statuses.map((row) => [row.status, row.from, row.until])).toEqual([
        ['active', '2026-09-01', '2026-10-10'],
        ['inactive', '2026-10-10', null],
      ]);
      const [entry] = await t.entries('staff.status', created.id);
      expect(entry).toMatchObject({ assignment_id: t.adminAssignment });
      refusedWith(await statusOf(created.id, 'active', '2026-10-09'), 409, 'status_from_past');
      refusedWith(await statusOf(created.id, 'inactive', '2026-10-12'), 409, 'status_unchanged');
    });

    it("is the Super Admin's only", async () => {
      const created = await create();
      const before = await snapshot();
      refusedWith(
        await statusOf(created.id, 'left', '2026-10-20', t.vicePrincipal),
        403,
        'permission_denied',
      );
      refusedWith(
        await statusOf(created.id, 'left', '2026-10-20', t.principal),
        403,
        'permission_denied',
      );
      expect(await snapshot()).toEqual(before);
    });

    // Correction 6: a planned change is taken back, never grown or deleted.
    it('replaces a planned change with one dated before it', async () => {
      const created = await create();
      expect((await statusOf(created.id, 'left', '2026-10-20')).status).toBe(200);
      const response = await statusOf(created.id, 'inactive', '2026-10-15');
      expect(response.status).toBe(200);
      expect(await rowsOf(created.id)).toEqual([
        ['active', '2026-09-01', '2026-10-15'],
        ['inactive', '2026-10-15', null],
        ['left', '2026-10-20', '2026-10-20'],
      ]);
      expect(staffDetailSchema.parse(response.body).planned).toEqual({
        status: 'inactive',
        from: '2026-10-15',
      });
    });

    it('replaces a planned change with one dated after it', async () => {
      const created = await create();
      expect((await statusOf(created.id, 'inactive', '2026-10-15')).status).toBe(200);
      expect((await statusOf(created.id, 'left', '2026-10-25')).status).toBe(200);
      expect(await rowsOf(created.id)).toEqual([
        ['active', '2026-09-01', '2026-10-15'],
        ['inactive', '2026-10-15', '2026-10-15'],
        ['active', '2026-10-15', '2026-10-25'],
        ['left', '2026-10-25', null],
      ]);
    });

    it('re-hires on the same record with the same staff ID (done-when)', async () => {
      const created = await create();
      expect((await statusOf(created.id, 'left', '2026-10-10')).status).toBe(200);
      t.clock.set('2026-10-10T23:56:00+05:00');
      const response = await statusOf(created.id, 'active', '2026-10-12');
      expect(response.status).toBe(200);
      const hired = staffDetailSchema.parse(response.body);
      expect(hired.staffId).toBe(created.staffId);
      expect(hired.statuses.map((row) => row.status)).toEqual(['active', 'left', 'active']);
      t.clock.set('2026-10-10T23:55:00+05:00');
    });

    describe('of a record with an account', () => {
      async function linked() {
        const browser = await t.kit.fullSession('Sardor', `Qodirov${'a'.repeat((count += 1))}`);
        const created = await create();
        await t.database.migrator
          .updateTable('staff')
          .set({ account_id: browser.account.id })
          .where('id', '=', created.id)
          .execute();
        return { browser, created };
      }

      // Correction 4: each role ends at 00:00 of the date, or at its own later start.
      it('ends the roles on the date of left, and puts them back when left is taken back', async () => {
        const { browser, created } = await linked();
        const now = await t.kit.giveRole(browser.account.id, {
          role: 'teacher',
          branchId: t.north,
        });
        const later = await t.database.migrator
          .insertInto('assignments')
          .values({
            account_id: browser.account.id,
            role: 'tutor',
            branch_id: t.north,
            valid_from: new Date('2026-10-25T00:00:00+05:00'),
            created_at: new Date('2026-10-10T23:00:00+05:00'),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        expect((await statusOf(created.id, 'left', '2026-10-20')).status).toBe(200);
        const ends = async () =>
          (
            await t.database.migrator
              .selectFrom('assignments')
              .select(['id', 'valid_until', 'ended_by'])
              .where('id', 'in', [now.id, later.id])
              .orderBy('valid_from')
              .execute()
          ).map((row) => row.valid_until?.toISOString() ?? null);
        expect(await ends()).toEqual([
          new Date('2026-10-20T00:00:00+05:00').toISOString(),
          new Date('2026-10-25T00:00:00+05:00').toISOString(),
        ]);
        expect(await t.entries('assignment.end', now.id)).toHaveLength(1);
        // Taken back by a change dated before it: the roles get their ends back.
        expect((await statusOf(created.id, 'inactive', '2026-10-15')).status).toBe(200);
        expect(await ends()).toEqual([null, null]);
        expect(await t.entries('assignment.end_withdrawn', now.id)).toHaveLength(1);
      });

      // Correction 3: refused only after the password matched; in the sign-in history.
      it('refuses the sign-in of an inactive person and every request from the date', async () => {
        const { browser, created } = await linked();
        expect((await t.kit.get('/api/auth/session', browser.cookie)).status).toBe(200);
        expect((await statusOf(created.id, 'inactive', '2026-10-10')).status).toBe(200);
        expect((await t.kit.get('/api/auth/session', browser.cookie)).status).toBe(401);
        const wrong = await t.kit.signIn(browser.account.login, 'a-wrong-password-11');
        refusedWith(wrong, 401, 'sign_in_failed');
        const right = await t.kit.signIn(browser.account.login, NEW_PASSWORD);
        refusedWith(right, 403, 'account_inactive');
        const entries = await t.database.migrator
          .selectFrom('audit_log_school')
          .select('action')
          .where('record_id', '=', browser.account.id)
          .where('action', '=', 'auth.sign_in_inactive')
          .execute();
        expect(entries).toHaveLength(1);
      });

      it('takes effect on its date, not before', async () => {
        const { browser, created } = await linked();
        expect((await statusOf(created.id, 'inactive', '2026-10-11')).status).toBe(200);
        expect((await t.kit.get('/api/auth/session', browser.cookie)).status).toBe(200);
        // 00:00 on 11 October in Tashkent: within the idle limit of the session.
        t.clock.set('2026-10-11T00:01:00+05:00');
        expect((await t.kit.get('/api/auth/session', browser.cookie)).status).toBe(401);
        t.clock.set('2026-10-10T23:55:00+05:00');
      });

      // Correction 5.
      it('refuses the Super Admin setting their own record to inactive or left', async () => {
        const created = await create();
        const admin = await t.database.migrator
          .selectFrom('assignments')
          .select('account_id')
          .where('id', '=', t.adminAssignment)
          .executeTakeFirstOrThrow();
        await t.database.migrator
          .updateTable('staff')
          .set({ account_id: admin.account_id })
          .where('id', '=', created.id)
          .execute();
        const before = await snapshot();
        refusedWith(await statusOf(created.id, 'left', '2026-10-20'), 409, 'own_status');
        refusedWith(await statusOf(created.id, 'inactive', '2026-10-20'), 409, 'own_status');
        expect(await snapshot()).toEqual(before);
      });
    });
  });

  describe('identity and the duplicate warning', () => {
    it('hides birth date and JSHSHIR from the Principal, with a logged show', async () => {
      const created = await create({ jshshir: '51234567890123', birthDate: '1988-03-04' });
      const seen = await detail(created.id, t.north, t.principal);
      expect([seen.birthDate, seen.jshshir, seen.identityHidden]).toEqual([null, null, true]);
      const shown = await t.post(
        `/api/people/staff/${created.id}/identity`,
        t.north,
        {},
        t.principal,
      );
      expect(shown.status).toBe(200);
      expect(staffIdentitySchema.parse(shown.body)).toEqual({
        birthDate: '1988-03-04',
        jshshir: '51234567890123',
      });
      expect(await t.entries('staff.identity_shown', created.id)).toHaveLength(1);
      const vice = await detail(created.id, t.north, t.vicePrincipal);
      expect([vice.birthDate, vice.identityHidden]).toEqual(['1988-03-04', false]);
    });

    it('names the matches of the branch and says only whether another branch has one', async () => {
      const north = await create({
        firstName: 'Ravshan',
        lastName: 'Umarov',
        birthDate: '1979-07-07',
      });
      const ask = (branch: string) =>
        t.post('/api/people/staff/check', branch, {
          firstName: 'ravshan',
          lastName: 'UMAROV',
          birthDate: '1979-07-07',
          phone: '+998 99 999 99 99',
          staffRecordId: null,
        });
      const here = staffCheckResultSchema.parse((await ask(t.north)).body);
      expect(here.sameNameAndBirth.map((match) => match.id)).toEqual([north.id]);
      expect(here.elsewhere).toBe(false);
      const there = staffCheckResultSchema.parse((await ask(t.south)).body);
      expect(there).toEqual({ sameNameAndBirth: [], samePhone: [], elsewhere: true });
    });
  });

  describe('divisions, departments and subjects', () => {
    it('refuses the archive of a division or department while somebody who has not left is in it', async () => {
      const division = await t.database.migrator
        .insertInto('divisions')
        .values({ name_uz: 'Xavfsizlik', name_ru: 'Охрана', name_en: 'Guarding', position: 90 })
        .returning('id')
        .executeTakeFirstOrThrow();
      const department = await t.database.migrator
        .insertInto('departments')
        .values({
          division_id: division.id,
          name_uz: 'Kecha',
          name_ru: 'Ночь',
          name_en: 'Night',
          position: 1,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const created = await create({
        divisions: [{ divisionId: division.id, departmentId: department.id, main: true }],
      });
      const archive = (path: string) =>
        request(t.kit.server).post(path).set('Cookie', t.admin).send({});
      refusedWith(
        await archive(`/api/setup/departments/${department.id}/archive`),
        409,
        'department_has_staff',
      );
      refusedWith(
        await archive(`/api/setup/divisions/${division.id}/archive`),
        409,
        'archive_refused',
      );
      const counts = divisionListSchema.parse(
        (await t.get('/api/setup/divisions', t.north)).body,
      ).staffCounts;
      expect(counts.find((row) => row.divisionId === division.id)?.people).toBe(1);
      // Inactive is still employed; left is out (decision 6).
      expect(
        (
          await t.post(`/api/people/staff/${created.id}/status`, t.north, {
            status: 'left',
            from: '2026-10-10',
          })
        ).status,
      ).toBe(200);
      expect((await archive(`/api/setup/departments/${department.id}/archive`)).status).toBe(200);
      expect((await archive(`/api/setup/divisions/${division.id}/archive`)).status).toBe(200);
    });

    it('makes a staff save wait for a division archive at the same moment, then refuses it', async () => {
      const division = await t.database.migrator
        .insertInto('divisions')
        .values({ name_uz: 'Oshxona', name_ru: 'Кухня', name_en: 'Kitchen', position: 91 })
        .returning('id')
        .executeTakeFirstOrThrow();
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked: () => void = () => undefined;
      const isLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const archive = t.database.migrator.transaction().execute(async (transaction) => {
        await transaction
          .selectFrom('divisions')
          .select('id')
          .where('id', '=', division.id)
          .forUpdate()
          .execute();
        await transaction
          .updateTable('divisions')
          .set({ archived_at: new Date('2026-10-10T23:55:00+05:00') })
          .where('id', '=', division.id)
          .execute();
        locked();
        await held;
      });
      await isLocked;
      const save = t
        .post(
          '/api/people/staff',
          t.north,
          body({ divisions: [{ divisionId: division.id, departmentId: null, main: true }] }),
        )
        .then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      release();
      await archive;
      refusedWith(await save, 409, 'division_archived');
    });

    it('refuses a subject change that would leave a teacher outside it, naming those of the branch', async () => {
      const subject = (
        await t.post('/api/setup/subjects', t.north, {
          names: { uz: 'Fizika', ru: 'Физика', en: 'Physics' },
          departmentId: steam,
          grades: [7, 8, 9],
          colour: 'red',
          journalType: 'graded',
          ratingExam: false,
          groupSubject: false,
          languageRule: true,
          demanding: false,
          daily: { attendance: 10, classwork: 50, homework: 40 },
        })
      ).body as { id: string; names: object };
      const teacher = await create();
      expect(
        (
          await put(`/api/people/staff/${teacher.id}/teaching`, t.north, {
            subjects: [{ subjectId: subject.id, grades: [9] }],
            languages: ['uz'],
          })
        ).status,
      ).toBe(200);
      const edit = (branch: string, overrides: Record<string, unknown>) =>
        put(`/api/setup/subjects/${subject.id}`, branch, {
          names: { uz: 'Fizika', ru: 'Физика', en: 'Physics' },
          departmentId: steam,
          grades: [7, 8, 9],
          colour: 'red',
          journalType: 'graded',
          ratingExam: false,
          groupSubject: false,
          languageRule: true,
          demanding: false,
          daily: null,
          ...overrides,
        });
      const subjectRow = () =>
        t.database.migrator
          .selectFrom('subjects')
          .selectAll()
          .where('id', '=', subject.id)
          .executeTakeFirstOrThrow();
      const before = { subject: await subjectRow(), audit: await t.auditCount() };
      const inBranch = await edit(t.north, { grades: [7, 8] });
      refusedWith(inBranch, 409, 'subject_has_teachers');
      expect(apiErrorSchema.parse(inBranch.body).error.details).toEqual([
        expect.objectContaining({ path: `staff.${teacher.id}`, code: 'teaches' }),
      ]);
      const elsewhere = await edit(t.south, { departmentId: languages });
      refusedWith(elsewhere, 409, 'subject_has_teachers');
      expect(apiErrorSchema.parse(elsewhere.body).error.details).toEqual([
        expect.objectContaining({ path: 'elsewhere', code: '1' }),
      ]);
      expect({ subject: await subjectRow(), audit: await t.auditCount() }).toEqual(before);
      expect((await edit(t.north, { grades: [8, 9] })).status).toBe(200);
    });
  });
});
