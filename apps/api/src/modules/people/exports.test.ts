import {
  BRANCH_HEADER,
  phoneText,
  staffDetailSchema,
  vacancyDetailSchema,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { binary, dateOfCell, fileOf } from '../../testing/xlsx-kit.js';

/** A stored phone as the file writes it (finding 24). */
const grouped = (phone: string | null): string => phoneText(phone ?? '');

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// All names are invented. Task 2.2c-1, the plan approved on pull request #58
// with its corrections: the export of the staff list and of the Vacancies list
// (docs/spec/04-people.md, Teacher and staff record, Vacancy;
// docs/spec/edge-cases/people-roles-accounts.md, Personal data and the audit
// log: "An export contains only what the role may see" and "Every export is
// logged with its filters and row count"). The clock stands at 23:55 on 10
// October 2026 in Tashkent.
describe('the export of the staff and vacancy lists', () => {
  let t: DayTemplatesKit;
  let academic: string;
  let steam: string;
  let mathematics: string;
  let tutor: string;
  let headTeacher: string;
  let count = 0;

  /** A count as Latin letters, so that a name stays short and of letters only. */
  const lettersOf = (n: number): string =>
    n < 26
      ? String.fromCharCode(97 + n)
      : lettersOf(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26));

  async function person(overrides: Record<string, unknown> = {}, branch = t.north) {
    count += 1;
    const response = await t.post('/api/people/staff', branch, {
      firstName: 'Malika',
      lastName: `Yusupova${lettersOf(count)}`,
      fatherName: '',
      sex: 'female',
      birthDate: '1991-02-03',
      educationLevel: 'master',
      phone: `+99891${String(1000000 + count)}`,
      email: '',
      jshshir: '',
      admissionDate: '2026-09-01',
      contractType: 'full_time',
      contractDate: '2026-09-01',
      weeklyLessons: 18,
      dailyLessons: 5,
      divisions: [{ divisionId: academic, departmentId: steam, main: true }],
      ...overrides,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return staffDetailSchema.parse(response.body);
  }

  async function vacancy(branch = t.north) {
    count += 1;
    const response = await t.post('/api/people/vacancies', branch, {
      name: `Mathematics vacancy ${String(count)}`,
      departmentId: steam,
      subjects: [{ subjectId: mathematics, grades: [7, 8] }],
      languages: ['uz', 'ru'],
      weeklyLessons: 16,
      dailyLessons: 5,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return vacancyDetailSchema.parse(response.body);
  }

  const put = (path: string, branch: string, body: object) =>
    request(t.kit.server).put(path).set('Cookie', t.admin).set(BRANCH_HEADER, branch).send(body);

  /** An export as the Export button sends it; the answer's body as bytes. */
  const exportOf = (
    path: string,
    body: object,
    cookie = t.admin,
    branch = t.north,
  ): Promise<Response> =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .send(body)
      .buffer(true)
      .parse(binary);

  const send = (ids: string[], columns: string[], extra: Record<string, unknown> = {}) => ({
    ids,
    columns,
    selection: 'matching',
    search: '',
    filters: {},
    ...extra,
  });

  /** The error code of an answer read as bytes. */
  const codeOf = (response: Response): string => {
    const parsed = JSON.parse((response.body as Buffer).toString('utf8')) as {
      error: { code: string };
    };
    return parsed.error.code;
  };

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, (response.body as Buffer).toString('utf8')).toBe(status);
    expect(codeOf(response)).toBe(code);
  };

  /** Every account reads and exports in this language. */
  const speak = async (language: 'uz' | 'ru' | 'en') => {
    await t.database.migrator.updateTable('accounts').set({ language }).execute();
  };

  /** Every row of the staff tables and the audit log: what a refused export leaves as it was. */
  async function snapshot(): Promise<Record<string, unknown>> {
    const rows: Record<string, unknown> = {};
    for (const table of [
      'staff',
      'staff_branches',
      'staff_divisions',
      'staff_subjects',
      'staff_languages',
      'staff_statuses',
      'audit_log',
    ] as const) {
      rows[table] = await sql`select * from ${sql.table(table)} order by 1`.execute(
        t.database.migrator,
      );
    }
    return rows;
  }

  const assignmentOf = async (role: string) =>
    (
      await t.database.migrator
        .selectFrom('assignments')
        .select('id')
        .where('role', '=', role)
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow()
    ).id;

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
    const tutorBrowser = await t.kit.fullSession('Sardor', 'Tursunov');
    await t.kit.giveRole(tutorBrowser.account.id, { role: 'tutor', branchId: t.north });
    tutor = tutorBrowser.cookie;
    const headBrowser = await t.kit.fullSession('Nodira', 'Qodirova');
    await t.kit.giveRole(headBrowser.account.id, { role: 'head_teacher', branchId: t.north });
    headTeacher = headBrowser.cookie;
  });

  afterAll(async () => {
    await t.close();
  });

  describe('of the staff list', () => {
    it('writes the rows in the order sent and the columns asked, and logs the export', async () => {
      await speak('en');
      const first = await person({ lastName: 'Rahimova' });
      const second = await person({ lastName: 'Ahmedova' });
      const taught = await put(`/api/people/staff/${second.id}/teaching`, t.north, {
        subjects: [{ subjectId: mathematics, grades: [5, 7] }],
        languages: ['ru', 'uz'],
      });
      expect(taught.status, JSON.stringify(taught.body)).toBe(200);
      const response = await exportOf(
        '/api/people/staff/export',
        send(
          [second.id, first.id],
          ['name', 'staffId', 'department', 'subjects', 'grades', 'languages', 'phone', 'status'],
          { search: 'ova', filters: { status: 'active' }, selection: 'ticked' },
        ),
      );
      expect(response.status, (response.body as Buffer).toString('utf8')).toBe(200);
      const file = await fileOf(response);
      expect(file.type).toBe(XLSX);
      expect(file.cacheControl).toBe('no-store');
      expect(file.disposition).toBe(
        'attachment; filename="staff-2026-10-10.xlsx"; filename*=UTF-8\'\'Staff-2026-10-10.xlsx',
      );
      expect(file.columns).toBe('name,staffId,department,subjects,grades,languages,phone,status');
      expect(file.sheet.name).toBe('Staff');
      expect(file.sheet.headings).toEqual([
        'Name',
        'Staff ID',
        'Department',
        'Subjects',
        'Grades',
        'Languages of instruction',
        'Phone',
        'Status',
        'Planned status',
        'Planned from',
      ]);
      expect(file.sheet.rows).toEqual([
        [
          `Ahmedova Malika`,
          second.staffId,
          'STEAM',
          'Mathematics',
          '5, 7',
          'Russian, Uzbek',
          grouped(second.phone),
          'Active',
          null,
          null,
        ],
        [
          `Rahimova Malika`,
          first.staffId,
          'STEAM',
          '',
          '',
          '',
          grouped(first.phone),
          'Active',
          null,
          null,
        ],
      ]);
      const [entry, ...more] = await t.entries('staff.export');
      expect(more).toEqual([]);
      expect(entry).toMatchObject({
        branch_id: t.north,
        assignment_id: t.adminAssignment,
        record_type: null,
        request_id: expect.any(String) as unknown,
        details: {
          list: 'staff',
          selection: 'ticked',
          search: 'ova',
          filters: { status: 'active' },
          columns: [
            'name',
            'staffId',
            'department',
            'subjects',
            'grades',
            'languages',
            'phone',
            'status',
          ],
          rows: 2,
        },
      });
    });

    it('is made for the Academic Vice Principal with the phone, and logged with the assignment', async () => {
      await speak('en');
      const someone = await person();
      const response = await exportOf(
        '/api/people/staff/export',
        send([someone.id], ['name', 'phone']),
        t.vicePrincipal,
      );
      expect(response.status).toBe(200);
      const file = await fileOf(response);
      expect(file.sheet.rows).toEqual([[`${someone.lastName} Malika`, grouped(someone.phone)]]);
      const entries = await t.entries('staff.export');
      expect(entries.at(-1)).toMatchObject({
        assignment_id: t.viceAssignment,
        details: { columns: ['name', 'phone'], rows: 1 },
      });
    });

    // Decision 4: "Whole-branch exports with contact or identity fields are
    // for the Super Admin and Academic Vice Principal."
    it("leaves the phone out of the Principal's file, says so, and refuses a file of the phone only", async () => {
      await speak('en');
      const someone = await person();
      const response = await exportOf(
        '/api/people/staff/export',
        send([someone.id], ['name', 'phone', 'status']),
        t.principal,
      );
      expect(response.status).toBe(200);
      const file = await fileOf(response);
      expect(file.columns).toBe('name,status');
      expect(file.sheet.headings).toEqual(['Name', 'Status', 'Planned status', 'Planned from']);
      expect(JSON.stringify(file.sheet.rows)).not.toContain(someone.phone);
      expect(JSON.stringify(file.sheet.rows)).not.toContain(grouped(someone.phone));
      expect((await t.entries('staff.export')).at(-1)).toMatchObject({
        assignment_id: await assignmentOf('principal'),
        details: { columns: ['name', 'status'], rows: 1 },
      });

      const before = await snapshot();
      refusedWith(
        await exportOf('/api/people/staff/export', send([someone.id], ['phone']), t.principal),
        403,
        'permission_denied',
      );
      expect(await snapshot()).toEqual(before);
    });

    // `.claude/rules/api.md`: a part allowed to some roles only is decided
    // from every current assignment, and the entry names the one that allowed it.
    it('decides the phone from every assignment, in the branch of the request, and names the one that allowed it', async () => {
      await speak('en');
      const someone = await person();
      const both = await t.kit.completeSession('Lola', 'Hamidova');
      const principalHeld = await t.kit.giveRole(both.account.id, {
        role: 'principal',
        branchId: t.north,
      });
      const viceHeld = await t.kit.giveRole(both.account.id, {
        role: 'academic_vice_principal',
        branchId: t.north,
      });
      const withPhone = await fileOf(
        await exportOf(
          '/api/people/staff/export',
          send([someone.id], ['name', 'phone']),
          both.cookie,
        ),
      );
      expect(withPhone.sheet.rows).toEqual([[`${someone.lastName} Malika`, grouped(someone.phone)]]);
      expect((await t.entries('staff.export')).at(-1)).toMatchObject({
        assignment_id: viceHeld.id,
        details: { columns: ['name', 'phone'], leftOut: [] },
      });
      const withoutPhone = await fileOf(
        await exportOf('/api/people/staff/export', send([someone.id], ['name']), both.cookie),
      );
      expect(withoutPhone.columns).toBe('name');
      expect([principalHeld.id, viceHeld.id]).toContain(
        (await t.entries('staff.export')).at(-1)?.assignment_id,
      );

      // A Principal here who is Academic Vice Principal of another branch gets no phone here.
      const elsewhere = await t.kit.completeSession('Zarina', 'Sobirova');
      await t.kit.giveRole(elsewhere.account.id, { role: 'principal', branchId: t.north });
      await t.kit.giveRole(elsewhere.account.id, {
        role: 'academic_vice_principal',
        branchId: t.south,
      });
      const north = await fileOf(
        await exportOf(
          '/api/people/staff/export',
          send([someone.id], ['name', 'phone']),
          elsewhere.cookie,
        ),
      );
      expect(north.columns).toBe('name');
      expect((await t.entries('staff.export')).at(-1)).toMatchObject({
        details: { columns: ['name'], leftOut: ['phone'] },
      });
    });

    it('writes a planned status with its first day as a date, the same day in any time zone of the server', async () => {
      await speak('en');
      const someone = await person();
      const planned = await t.post(`/api/people/staff/${someone.id}/status`, t.north, {
        status: 'inactive',
        from: '2026-11-02',
      });
      expect(planned.status, JSON.stringify(planned.body)).toBe(200);
      const zone = process.env.TZ;
      try {
        for (const timeZone of ['Asia/Tashkent', 'UTC', 'America/Los_Angeles']) {
          process.env.TZ = timeZone;
          const file = await fileOf(
            await exportOf('/api/people/staff/export', send([someone.id], ['status'])),
          );
          const [row] = file.sheet.rows;
          expect(row?.slice(0, 2)).toEqual(['Active', 'Inactive']);
          expect(dateOfCell(row?.[2]), timeZone).toBe('2026-11-02');
        }
      } finally {
        process.env.TZ = zone;
      }
    });

    it('writes the texts, the sheet and the file name in the language of the account', async () => {
      const someone = await person();
      await speak('ru');
      const russian = await fileOf(
        await exportOf('/api/people/staff/export', send([someone.id], ['name', 'status'])),
      );
      expect(russian.sheet.name).toBe('Сотрудники');
      expect(russian.sheet.headings.slice(0, 2)).toEqual(['Имя', 'Статус']);
      expect(russian.sheet.rows[0]?.[1]).toBe('Активен');
      expect(russian.disposition).toContain(
        `filename*=UTF-8''${encodeURIComponent('Сотрудники-2026-10-10.xlsx')}`,
      );
      await speak('uz');
      const uzbek = await fileOf(
        await exportOf('/api/people/staff/export', send([someone.id], ['languages', 'grades'])),
      );
      expect(uzbek.sheet.headings).toEqual(['Taʼlim tillari', 'Sinflar']);
      expect(uzbek.sheet.name).toBe('Xodimlar');
    });

    // `04`, Vacancy: "exports leave them out unless asked" (decision 6), and
    // `.claude/rules/api.md`: an id in the body of another branch or unknown
    // answers 404 with the rows of both branches and the audit log unchanged.
    it('answers 404 for a person of another branch, an unknown id and a vacancy, also to the Super Admin', async () => {
      const here = await person();
      const elsewhere = await person({}, t.south);
      const open = await vacancy();
      const before = await snapshot();
      for (const cookie of [t.admin, t.vicePrincipal, t.principal]) {
        for (const id of [elsewhere.id, UNKNOWN, open.id]) {
          refusedWith(
            await exportOf('/api/people/staff/export', send([here.id, id], ['name']), cookie),
            404,
            'not_found',
          );
        }
      }
      expect(await snapshot()).toEqual(before);
    });

    it('lists both branches of a person linked to two, the main one first, as the list does', async () => {
      await speak('en');
      const someone = await person();
      const linked = await put(`/api/people/staff/${someone.id}/branches`, t.north, {
        mainBranchId: t.north,
        furtherBranchIds: [t.south],
      });
      expect(linked.status, JSON.stringify(linked.body)).toBe(200);
      const file = await fileOf(
        await exportOf('/api/people/staff/export', send([someone.id], ['branches'])),
      );
      expect(file.sheet.rows).toEqual([['North, South']]);
    });
  });

  describe('of the vacancy list', () => {
    it('writes the vacancies of the branch with the load as a number, and logs the export', async () => {
      await speak('en');
      const first = await vacancy();
      const second = await vacancy();
      const response = await exportOf(
        '/api/people/vacancies/export',
        send(
          [first.id, second.id],
          ['name', 'department', 'subjects', 'grades', 'languages', 'weeklyLessons', 'status'],
        ),
        t.principal,
      );
      expect(response.status).toBe(200);
      const file = await fileOf(response);
      expect(file.sheet.name).toBe('Vacancies');
      expect(file.disposition).toContain('filename="vacancies-2026-10-10.xlsx"');
      expect(file.sheet.rows).toEqual([
        [first.name, 'STEAM', 'Mathematics', '7–8', 'Russian, Uzbek', 16, 'Open'],
        [second.name, 'STEAM', 'Mathematics', '7–8', 'Russian, Uzbek', 16, 'Open'],
      ]);
      expect((await t.entries('vacancy.export')).at(-1)).toMatchObject({
        branch_id: t.north,
        assignment_id: await assignmentOf('principal'),
        details: { list: 'vacancies', rows: 2 },
      });
    });

    it('answers 404 for a vacancy of another branch, an unknown id and a person', async () => {
      const here = await vacancy();
      const elsewhere = await vacancy(t.south);
      const someone = await person();
      const before = await snapshot();
      for (const cookie of [t.admin, t.vicePrincipal, t.principal]) {
        for (const id of [elsewhere.id, UNKNOWN, someone.id]) {
          refusedWith(
            await exportOf('/api/people/vacancies/export', send([here.id, id], ['name']), cookie),
            404,
            'not_found',
          );
        }
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('refusals', () => {
    it('refuses a Teacher, a Tutor and a Head Teacher on both routes, with nothing logged', async () => {
      const someone = await person();
      const open = await vacancy();
      const before = await snapshot();
      for (const cookie of [t.teacher, tutor, headTeacher]) {
        refusedWith(
          await exportOf('/api/people/staff/export', send([someone.id], ['name']), cookie),
          403,
          'permission_denied',
        );
        refusedWith(
          await exportOf('/api/people/vacancies/export', send([open.id], ['name']), cookie),
          403,
          'permission_denied',
        );
      }
      expect(await snapshot()).toEqual(before);
    });

    it('refuses a body that is not JSON and one that does not fit, with nothing logged', async () => {
      const someone = await person();
      const before = await snapshot();
      const form = await request(t.kit.server)
        .post('/api/people/staff/export')
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, t.north)
        .type('form')
        .send({ ids: someone.id });
      expect(form.status).toBe(415);
      expect(errorCode(form)).toBe('unsupported_media_type');
      const invalid = await t.post('/api/people/staff/export', t.north, {
        ids: [someone.id, someone.id],
        columns: ['birthDate'],
        selection: 'matching',
        search: '',
        filters: {},
      });
      expect(invalid.status).toBe(400);
      expect(errorCode(invalid)).toBe('validation_failed');
      expect(
        (invalid.body as { error: { details: { path: string }[] } }).error.details.map(
          (detail) => detail.path,
        ),
      ).toEqual(expect.arrayContaining(['ids', 'columns.0']));
      expect(await snapshot()).toEqual(before);
    });
  });
});
