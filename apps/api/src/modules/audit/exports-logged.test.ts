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
              phone: '+998917770101',
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
            await t.post('/api/people/students', t.north, {
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
    expect(exports).toEqual(Object.keys(EXPORTS).sort());
  });

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
