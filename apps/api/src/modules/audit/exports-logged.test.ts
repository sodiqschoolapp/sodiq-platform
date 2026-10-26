import {
  BRANCH_HEADER,
  buildingSchema,
  floorSchema,
  roomSchema,
  staffDetailSchema,
  studentDetailSchema,
  vacancyDetailSchema,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { relativesInput } from '../../testing/relatives-kit.js';
import { routesOf } from '../../testing/routes.js';

// All names are invented. docs/spec/edge-cases/people-roles-accounts.md,
// Personal data and the audit log: "An export contains only what the role may
// see ... Every export is logged with its filters and row count." Task 2.6a,
// decision 13 of pull request #75 with correction 4: every export route of the
// application is in the list below, which proves for each one entry per file.
describe('every export is logged', () => {
  let t: DayTemplatesKit;
  let academic: string;
  let steam: string;
  let mathematics: string;

  const binary = (response: Response, callback: (error: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.on('end', () => {
      callback(null, Buffer.concat(chunks));
    });
  };

  const exportOf = (path: string, body: object): Promise<Response> =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, t.north)
      .send(body)
      .buffer(true)
      .parse(binary as never);

  const created = (response: Response): unknown => {
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body;
  };

  /** One row of each list in the branch `north`, the column sent, the audit action and the list. */
  let staffPhones = 0;
  const nextStaffPhone = () => {
    staffPhones += 1;
    return `+99891777${String(staffPhones).padStart(4, '0')}`;
  };
  const EXPORTS: Record<
    string,
    { action: string; list: string; column: string; row: () => Promise<string> }
  > = {
    'POST /api/setup/buildings/export': {
      action: 'building.export',
      list: 'buildings',
      column: 'name',
      row: async () =>
        buildingSchema.parse(
          created(await t.post('/api/setup/buildings', t.north, { name: 'Logged block' })),
        ).id,
    },
    'POST /api/setup/rooms/export': {
      action: 'room.export',
      list: 'rooms',
      column: 'name',
      row: async () => {
        const building = buildingSchema.parse(
          created(await t.post('/api/setup/buildings', t.north, { name: 'Logged rooms block' })),
        );
        const floor = floorSchema.parse(
          created(
            await t.post(`/api/setup/buildings/${building.id}/floors`, t.north, { name: '1' }),
          ),
        );
        return roomSchema.parse(
          created(
            await t.post('/api/setup/rooms', t.north, {
              name: '101',
              floorId: floor.id,
              type: 'laboratory',
              capacity: 24,
              status: 'in_use',
              shared: false,
              maxSimultaneousLessons: null,
            }),
          ),
        ).id;
      },
    },
    'POST /api/setup/divisions/export': {
      action: 'division.export',
      list: 'divisions',
      column: 'name',
      row: () => Promise.resolve(academic),
    },
    // Task 3.1a.
    'POST /api/classes/export': {
      action: 'class.export',
      list: 'classes',
      column: 'name',
      row: async () => {
        const year = await t.database.migrator
          .selectFrom('academic_years')
          .select('id')
          .where('branch_id', '=', t.north)
          .executeTakeFirstOrThrow();
        const row = await t.database.migrator
          .insertInto('classes')
          .values({
            branch_id: t.north,
            academic_year_id: year.id,
            grade: 7,
            name: 'Logged',
            language: 'uz',
            max_size: 25,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return row.id;
      },
    },
    // Task 3.2a.
    'POST /api/groups/export': {
      action: 'group.export',
      list: 'groups',
      column: 'name',
      row: async () => {
        const year = await t.database.migrator
          .selectFrom('academic_years')
          .select('id')
          .where('branch_id', '=', t.north)
          .executeTakeFirstOrThrow();
        return t.database.migrator.transaction().execute(async (transaction) => {
          const schoolClass = await transaction
            .insertInto('classes')
            .values({
              branch_id: t.north,
              academic_year_id: year.id,
              grade: 7,
              name: 'Logged group class',
              language: 'uz',
              max_size: 25,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          const group = await transaction
            .insertInto('groups')
            .values({
              branch_id: t.north,
              academic_year_id: year.id,
              subject_id: mathematics,
              name: 'Logged-1',
              language: 'uz',
              max_size: 20,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await transaction
            .insertInto('group_classes')
            .values({ group_id: group.id, class_id: schoolClass.id, branch_id: t.north })
            .execute();
          return group.id;
        });
      },
    },
    'POST /api/setup/subjects/export': {
      action: 'subject.export',
      list: 'subjects',
      column: 'name',
      row: () => Promise.resolve(mathematics),
    },
    'POST /api/people/staff/export': {
      action: 'staff.export',
      list: 'staff',
      column: 'name',
      row: async () =>
        staffDetailSchema.parse(
          created(
            await t.post('/api/people/staff', t.north, {
              firstName: 'Ozoda',
              lastName: 'Mirzayeva',
              fatherName: '',
              sex: 'female',
              birthDate: '1992-04-05',
              educationLevel: 'master',
              // A phone of its own each time: a staff phone is unique (task 3.6b-1).
              phone: nextStaffPhone(),
              email: '',
              jshshir: '',
              admissionDate: '2026-09-01',
              contractType: 'full_time',
              contractDate: '2026-09-01',
              weeklyLessons: 18,
              dailyLessons: 5,
              divisions: [{ divisionId: academic, departmentId: steam, main: true }],
            }),
          ),
        ).id,
    },
    'POST /api/people/vacancies/export': {
      action: 'vacancy.export',
      list: 'vacancies',
      column: 'name',
      row: async () =>
        vacancyDetailSchema.parse(
          created(
            await t.post('/api/people/vacancies', t.north, {
              name: 'Logged vacancy',
              departmentId: steam,
              subjects: [{ subjectId: mathematics, grades: [7] }],
              languages: ['uz'],
              weeklyLessons: 16,
              dailyLessons: 5,
            }),
          ),
        ).id,
    },
    'POST /api/people/students/export': {
      action: 'student.export',
      list: 'students',
      column: 'name',
      row: async () =>
        studentDetailSchema.parse(
          created(
            await t.postStudent(t.north, {
              uid: '2607901',
              confirmUidSet: true,
              firstName: 'Shoira',
              lastName: 'Komilova',
              paternalName: null,
              sex: 'female',
              birthDate: '2013-02-03',
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
              contract: { number: 'EX-2026/1', signedOn: '2026-08-20' },
              relatives: relativesInput(),
            }),
          ),
        ).id,
    },
  };

  /** A student of `north` with a relative of its own, created by the route. */
  const reportStudent = async (uid: string, contract: string): Promise<string> =>
    studentDetailSchema.parse(
      created(
        await t.postStudent(t.north, {
          uid,
          confirmUidSet: true,
          firstName: 'Nodira',
          lastName: 'Tursunova',
          paternalName: null,
          sex: 'female',
          birthDate: '2013-05-06',
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
          contract: { number: contract, signedOn: '2026-08-20' },
          relatives: relativesInput(),
        }),
      ),
    ).id;

  /**
   * The personal data report of each kind of person (task 2.6b, pull request
   * #76, decision 3): an export of the Super Admin, logged as one entry with
   * the person's record, in the branch of the request.
   */
  const REPORTS: Record<string, { action: string; type: string; row: () => Promise<string> }> = {
    'POST /api/people/students/:id/report': {
      action: 'student.personal_data_report',
      type: 'student',
      row: () => reportStudent('2607911', 'PD-2026/1'),
    },
    'POST /api/people/staff/:id/report': {
      action: 'staff.personal_data_report',
      type: 'staff',
      row: () => EXPORTS['POST /api/people/staff/export']?.row() ?? Promise.reject(new Error()),
    },
    'POST /api/people/relatives/:id/report': {
      action: 'relative.personal_data_report',
      type: 'relative',
      row: async () => {
        const student = await reportStudent('2607912', 'PD-2026/2');
        return (
          await t.database.migrator
            .selectFrom('student_relatives')
            .select('relative_id')
            .where('student_id', '=', student)
            .executeTakeFirstOrThrow()
        ).relative_id;
      },
    },
  };

  /**
   * The files of a timetable view (task 5.9c-1, pull request #199): Print,
   * PDF and Excel, logged as one entry with the request and the counts.
   */
  const VIEW_FILES: Record<string, { action: string }> = {
    'POST /api/timetable/views/export': { action: 'timetable_view.export' },
  };

  /** The files of a version's pattern (task 5.9c-2, pull request #200): one entry with the version and the count. */
  const VERSION_FILES: Record<string, { action: string }> = {
    'POST /api/timetable/versions/:id/export': { action: 'timetable_version.export' },
  };

  /**
   * Task 8.8 (pull request #226, decisions 2 and 17): a plan's PDF or Excel and a plan report's
   * Excel, one entry each; the plan's own file is tested with a plan in `plan-delivery.test.ts`.
   */
  const PLAN_FILES: Record<string, { action: string }> = {
    'POST /api/plans/reports/export': { action: 'plan_report.export' },
    'POST /api/plans/journals/:journalId/export': { action: 'plan.export' },
  };

  /** Task 9.3a: a rating list in Excel, one entry; the lists themselves are tested in `rating.test.ts`. */
  const RATING_FILES: Record<string, { action: string }> = {
    'POST /api/results/rating/export': { action: 'rating.export' },
  };

  /**
   * Task 8.9 (pull request #227): a journal's file, and the branch export: the request, its
   * list and its download. Each writes its entries (`journal.export`,
   * `journal.branch_export`, `journal.branch_export_ready`, `journal.branch_export_download`)
   * as `journal-exports.test.ts` tests with a journal; the list holds no data of the journals.
   */
  const JOURNAL_FILES: Record<string, { action: string | null }> = {
    'POST /api/journal/journals/:journalId/export': { action: 'journal.export' },
    'POST /api/journal/exports': { action: 'journal.branch_export' },
    'GET /api/journal/exports': { action: null },
    'GET /api/journal/exports/:exportId/file': { action: 'journal.branch_export_download' },
  };

  /** The entries of an action in both logs. */
  const countOf = async (action: string): Promise<number> => {
    const found = await sql<{ count: number }>`
      select (
        (select count(*) from audit_log where action = ${action})
        + (select count(*) from audit_log_school where action = ${action})
      )::int as count
    `.execute(t.database.migrator);
    return found.rows[0]?.count ?? 0;
  };

  beforeAll(async () => {
    t = await dayTemplatesKit();
    await t.database.migrator.transaction().execute(async (transaction) => {
      const year = await transaction
        .insertInto('academic_years')
        .values({ branch_id: t.north, start_date: '2026-09-01', end_date: '2027-05-31' })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const number of [1, 2, 3, 4]) {
        await transaction
          .insertInto('quarters')
          .values({ branch_id: t.north, academic_year_id: year.id, number })
          .execute();
      }
    });
    const id = async (table: 'divisions' | 'departments', name: string) =>
      (
        await t.database.migrator
          .selectFrom(table)
          .select('id')
          .where('name_en', '=', name)
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
          grades: [7, 8],
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

  it('lists every export route of the application: those that require export and those named so', () => {
    const exports = routesOf(t.app)
      .filter(
        (route) =>
          route.path.endsWith('/export') ||
          route.access.some((access) => access.kind === 'requires' && access.action === 'export'),
      )
      .map((route) => route.name)
      .sort();
    expect(exports).toEqual(
      [
        ...Object.keys(EXPORTS),
        ...Object.keys(REPORTS),
        ...Object.keys(VIEW_FILES),
        ...Object.keys(VERSION_FILES),
        ...Object.keys(PLAN_FILES),
        ...Object.keys(JOURNAL_FILES),
        ...Object.keys(RATING_FILES),
      ].sort(),
    );
  });

  it.each(Object.entries(VIEW_FILES))(
    '%s writes one entry with the view and the counts',
    async (route, spec) => {
      const path = route.replace('POST ', '');
      const before = await countOf(spec.action);
      const response = await exportOf(path, {
        kind: 'branch',
        date: '2026-10-19',
        span: 'day',
        format: 'xlsx',
      });
      expect(response.status).toBe(200);
      expect(await countOf(spec.action)).toBe(before + 1);
      const [entry] = await t.database.migrator
        .selectFrom('audit_log')
        .select(['details', 'branch_id'])
        .where('action', '=', spec.action)
        .orderBy('occurred_at', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .execute();
      expect(entry?.branch_id).toBe(t.north);
      expect(entry?.details).toMatchObject({ kind: 'branch', format: 'xlsx', lessons: 0 });

      const refused = await exportOf(path, {
        kind: 'class',
        classId: UNKNOWN,
        date: '2026-10-19',
        span: 'day',
        format: 'xlsx',
      });
      expect(refused.status).toBe(404);
      expect(await countOf(spec.action)).toBe(before + 1);
    },
  );

  it.each(Object.entries(VERSION_FILES))(
    '%s writes one entry with the version and the count',
    async (route, spec) => {
      const year = await t.database.migrator
        .selectFrom('academic_years')
        .select('id')
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      const draft = await t.post('/api/timetable/versions', t.north, {
        academicYearId: year.id,
        startsOn: '2026-10-19',
        copyFrom: null,
      });
      expect(draft.status, JSON.stringify(draft.body)).toBe(201);
      const version = (draft.body as { id: string }).id;
      const path = route.replace('POST ', '').replace(':id', version);
      const before = await countOf(spec.action);
      const response = await exportOf(path, { kind: 'branch', format: 'xlsx' });
      expect(response.status).toBe(200);
      expect(await countOf(spec.action)).toBe(before + 1);
      const [entry] = await t.database.migrator
        .selectFrom('audit_log')
        .select(['details', 'branch_id'])
        .where('action', '=', spec.action)
        .orderBy('occurred_at', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .execute();
      expect(entry?.branch_id).toBe(t.north);
      expect(entry?.details).toMatchObject({
        versionId: version,
        status: 'draft',
        kind: 'branch',
        format: 'xlsx',
        lessons: 0,
      });

      const refused = await exportOf(path, { kind: 'class', classId: UNKNOWN, format: 'xlsx' });
      expect(refused.status).toBe(404);
      expect(await countOf(spec.action)).toBe(before + 1);
    },
  );

  it('POST /api/plans/reports/export writes one entry; a refusal writes none', async () => {
    const action = 'plan_report.export';
    const before = await countOf(action);
    const response = await exportOf('/api/plans/reports/export', { report: 'completeness' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await countOf(action)).toBe(before + 1);
    const [entry] = await t.database.migrator
      .selectFrom('audit_log')
      .select(['details', 'branch_id'])
      .where('action', '=', action)
      .orderBy('occurred_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .execute();
    expect(entry?.branch_id).toBe(t.north);
    expect(entry?.details).toMatchObject({ report: 'completeness', rows: 0 });
    const refused = await exportOf('/api/plans/reports/export', {
      report: 'progress',
      quarterId: UNKNOWN,
    });
    expect(refused.status).toBe(404);
    expect(await countOf(action)).toBe(before + 1);
  });

  it('POST /api/plans/journals/:journalId/export writes no entry when refused', async () => {
    const before = await countOf('plan.export');
    const refused = await exportOf(`/api/plans/journals/${UNKNOWN}/export`, {
      quarterId: UNKNOWN,
      format: 'xlsx',
    });
    expect(refused.status).toBe(404);
    expect(await countOf('plan.export')).toBe(before);
  });

  it.each(Object.entries(REPORTS))(
    '%s writes one entry with the person and the counts',
    async (route, spec) => {
      const path = route.replace('POST ', '');
      const row = await spec.row();
      const before = await countOf(spec.action);
      const response = await request(t.kit.server)
        .post(path.replace(':id', row))
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, t.north)
        .send({});
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await countOf(spec.action)).toBe(before + 1);
      const [entry] = await t.database.migrator
        .selectFrom('audit_log')
        .select(['details', 'actor_id', 'branch_id', 'record_type', 'record_id', 'person_id'])
        .where('action', '=', spec.action)
        .orderBy('occurred_at', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .execute();
      expect(entry).toMatchObject({
        branch_id: t.north,
        record_type: spec.type,
        record_id: row,
        person_id: row,
      });
      expect(entry?.details).toMatchObject({ entriesLeftOut: 0 });

      const refused = await request(t.kit.server)
        .post(path.replace(':id', UNKNOWN))
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, t.north)
        .send({});
      expect(refused.status).toBe(404);
      expect(await countOf(spec.action)).toBe(before + 1);
    },
  );

  it.each(Object.entries(EXPORTS))(
    '%s writes one entry with its filters, columns and row count',
    async (route, spec) => {
      const path = route.replace('POST ', '');
      const row = await spec.row();
      const before = await countOf(spec.action);
      const response = await exportOf(path, {
        ids: [row],
        columns: [spec.column],
        selection: 'matching',
        search: 'logged search',
        filters: { status: 'active' },
      });
      expect(response.status).toBe(200);
      expect(await countOf(spec.action)).toBe(before + 1);
      const [entry] = await t.database.migrator
        .selectFrom('audit_log')
        .select(['details', 'actor_id', 'branch_id'])
        .where('action', '=', spec.action)
        .orderBy('occurred_at', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .execute();
      expect(entry?.branch_id).toBe(t.north);
      expect(entry?.details).toMatchObject({
        list: spec.list,
        selection: 'matching',
        search: 'logged search',
        filters: { status: 'active' },
        columns: [spec.column],
        rows: 1,
      });

      const refused = await exportOf(path, {
        ids: [UNKNOWN],
        columns: [spec.column],
        selection: 'matching',
        search: '',
        filters: {},
      });
      expect(refused.status).toBe(404);
      expect(await countOf(spec.action)).toBe(before + 1);
    },
  );
});
