import { BRANCH_HEADER } from '@sodiq/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ask, assistantScene, type AssistantScene } from '../../testing/assistant-kit.js';
import { answer, calls } from '../../testing/assistant-model.js';
import { ASSISTANT_DATA_GROUPS } from '@sodiq/shared';
import { AssistantRoutes } from '../access/assistant-routes.check.js';
import { MAX_READS } from './assistant.engine.js';
import { GENERATED_TOOLS } from './tools.generated.js';

// Task 11.20 (`02`, Personal data and the model: "The Super Admin can keep any of these groups
// from the model, each with its own switch … A group switched off reaches the model as
// '[removed]'"): with the six groups switched off, the test of 11.12 holds over every read of the
// Super Admin's list; with them on (the start), the fields reach the model (decision 2, Look
// first: the requirement changed).
//
// Task 11.12 (build plan, Done when: "a test per field that never goes to the model"; plan
// review, must fix 3). `02`, Assistant: "Passport and birth certificate numbers, medical data,
// the financial group, phone numbers and addresses, passwords and secrets" never go to the
// model; plan decision 2 (Look first) adds the rest of Contact, Identity and Financial and the
// diagnostic score. A student, their relative and a staff member are written through the
// platform's own routes with a sentinel in every such field; the fake model then calls every
// tool of the Super Admin's list, and no sentinel reaches what the model is given or what is
// stored as a read. Every value is invented.

const SENTINELS: Readonly<Record<string, string>> = {
  'student document number': 'AB7654321',
  'student JSHSHIR': '31999999999991',
  'student phone': '901110001',
  'student email': 'sentinel.student@example.com',
  'student address': 'Sentinelstreet 17',
  'student previous school': 'Sentinel school 9',
  'student contract number': 'SENT-2026/1',
  'student birth date': '2013-02-13',
  'student consent date': '2026-08-13',
  'relative phone': '901110002',
  'relative workplace': 'Sentinel works',
  'relative email': 'sentinel.parent@example.com',
  'relative name (main contact)': 'Sentinelova Parent',
  'staff phone': '901110003',
  'staff email': 'sentinel.staff@example.com',
  'staff JSHSHIR': '31999999999992',
  'staff birth date': '1985-05-15',
};

const UNKNOWN = '0199a000-0000-7000-8000-000000000999';

describe('the personal-data groups switched off, through every read of the Super Admin', () => {
  let scene: AssistantScene;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    scene = await assistantScene();
    const { kit, north, northYear, people } = scene;
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ daily_limit: 500, data_groups_off: [...ASSISTANT_DATA_GROUPS] })
      .execute();
    ids.classId = await people.schoolClass(north, northYear, { name: 'Oxford F' });
    const division = async (table: 'divisions' | 'departments', name: string) =>
      (
        await scene.database.migrator
          .selectFrom(table)
          .select('id')
          .where('name_en', '=', name)
          .executeTakeFirstOrThrow()
      ).id;
    const staff = await kit
      .post('/api/people/staff', scene.admin)
      .set(BRANCH_HEADER, north)
      .send({
        firstName: 'Ravshan',
        lastName: 'Sentinelov',
        fatherName: '',
        sex: 'male',
        birthDate: SENTINELS['staff birth date'],
        educationLevel: 'master',
        phone: `+998${SENTINELS['staff phone'] ?? ''}`,
        email: SENTINELS['staff email'],
        jshshir: SENTINELS['staff JSHSHIR'],
        admissionDate: '2026-09-01',
        contractType: 'full_time',
        contractDate: '2026-09-01',
        weeklyLessons: 18,
        dailyLessons: 5,
        divisions: [
          {
            divisionId: await division('divisions', 'Academic'),
            departmentId: await division('departments', 'STEAM'),
            main: true,
          },
        ],
      });
    expect(staff.status, JSON.stringify(staff.body)).toBe(201);
    ids.staffId = (staff.body as { id: string }).id;
    const student = await kit
      .post('/api/people/students', scene.admin)
      .set(BRANCH_HEADER, north)
      .send({
        uid: '2607999',
        firstName: 'Kamola',
        lastName: 'Sentinelova',
        paternalName: '',
        sex: 'female',
        birthDate: SENTINELS['student birth date'],
        grade: 7,
        startsOn: '2026-09-02',
        classId: ids.classId,
        documentType: 'passport',
        documentNumber: SENTINELS['student document number'],
        jshshir: SENTINELS['student JSHSHIR'],
        phone: `+998${SENTINELS['student phone'] ?? ''}`,
        email: SENTINELS['student email'],
        address: SENTINELS['student address'],
        region: 'khorezm',
        previousSchool: SENTINELS['student previous school'],
        diagnosticScore: 74,
        scholarship: { type: 'merit', coverage: 'partial', amount: 1500000 },
        consentSignedOn: SENTINELS['student consent date'],
        contract: { number: SENTINELS['student contract number'], signedOn: '2026-08-20' },
        relatives: [
          {
            kind: 'new',
            relative: {
              fullName: SENTINELS['relative name (main contact)'],
              phone: `+998${SENTINELS['relative phone'] ?? ''}`,
              workplace: SENTINELS['relative workplace'],
              email: SENTINELS['relative email'],
            },
            relationship: 'mother',
            mainContact: true,
            portalAccess: true,
            receivesNotices: true,
          },
        ],
      });
    expect(student.status, JSON.stringify(student.body)).toBe(201);
    ids.studentId = (student.body as { id: string }).id;
  }, 180_000);

  afterAll(async () => {
    await scene.close();
  });

  /** Arguments for a tool from its parameters: the fixture's ids by name, a date, an enum's first value. */
  function argsOf(route: string): Record<string, unknown> {
    const tool = GENERATED_TOOLS[route];
    const args: Record<string, unknown> = {};
    for (const parameter of tool?.parameters ?? []) {
      const schema = parameter.schema as {
        type?: string;
        format?: string;
        enum?: string[];
        minimum?: number;
        anyOf?: { type?: string; minimum?: number }[];
      };
      const type = schema.type ?? schema.anyOf?.[0]?.type;
      if (schema.format === 'uuid') {
        const name = parameter.name.toLowerCase();
        args[parameter.name] =
          route.includes('/students') || name.includes('student')
            ? ids.studentId
            : route.includes('/staff') || name.includes('staff') || name.includes('teacher')
              ? ids.staffId
              : name.includes('class') || route.startsWith('GET /api/classes')
                ? ids.classId
                : UNKNOWN;
      } else if (schema.format === 'date') {
        args[parameter.name] = '2026-11-20';
      } else if (schema.enum !== undefined) {
        args[parameter.name] = schema.enum[0];
      } else if (type === 'integer' || type === 'number') {
        args[parameter.name] = schema.minimum ?? schema.anyOf?.[0]?.minimum ?? 7;
      } else if (type === 'boolean') {
        args[parameter.name] = false;
      } else if (parameter.required || parameter.name === 'q') {
        args[parameter.name] = 'Sentinelova';
      }
    }
    return args;
  }

  it('gives the model no sentinel of any such field, whatever read it calls', async () => {
    // The reads (changes are proposed, never read; a file answer has no tool).
    const listed = scene.app.get(AssistantRoutes);
    const routes = Object.keys(listed.linesOf('super_admin')).filter(
      (route) => listed.factsOf(route)?.kind === 'read',
    );
    expect(routes.length).toBeGreaterThan(50);
    scene.model.requests.length = 0;
    const statuses: Record<string, number> = {};
    for (let start = 0; start < routes.length; start += MAX_READS) {
      const batch = routes.slice(start, start + MAX_READS);
      scene.model.script(
        calls(
          ...batch.map((route) => ({
            name: GENERATED_TOOLS[route]?.name ?? '',
            args: argsOf(route),
          })),
        ),
        answer('Read.'),
      );
      const response = await ask(scene, scene.admin, scene.north, {
        text: `Read batch ${String(start)}.`,
      });
      expect(response.status, JSON.stringify(response.body).slice(0, 400)).toBe(202);
    }
    const stored = await scene.database.migrator
      .selectFrom('assistant_messages')
      .select('content')
      .where('kind', '=', 'read')
      .execute();
    for (const row of stored) {
      const content = row.content as { route: string | null; status: number };
      if (content.route !== null) statuses[content.route] = content.status;
    }
    // Every route was read; the records that hold the sentinels were answered.
    expect(Object.keys(statuses).sort()).toEqual([...routes].sort());
    for (const route of [
      'GET /api/people/students',
      'GET /api/people/students/:id',
      'GET /api/people/staff',
      'GET /api/people/staff/:id',
      'GET /api/classes/:id/members',
      'GET /api/search/students',
      'GET /api/search/staff',
    ]) {
      expect(statuses[route], route).toBe(200);
    }
    const given = JSON.stringify(scene.model.requests);
    const kept = JSON.stringify(stored);
    // The records really were read: the student's name is there.
    expect(given).toContain('Sentinelova');
    for (const [field, value] of Object.entries(SENTINELS)) {
      expect(given.includes(value), `${field} reached the model`).toBe(false);
      expect(kept.includes(value), `${field} is stored as a read`).toBe(false);
    }
    // The diagnostic score and the scholarship's amount are numbers: no such key is given.
    for (const key of ['diagnosticScore', 'scholarship', 'contracts', 'documentType', 'region']) {
      expect(given.includes(`"${key}"`), key).toBe(false);
    }
    // The values are in the database all the same: the filter took them out, not the fixture.
    const raw = JSON.stringify(
      (await sql`select * from students`.execute(scene.database.migrator)).rows,
    );
    expect(raw).toContain(SENTINELS['student address']);
  });

  it('gives the model the fields of every group switched on, as at the start, and never a secret', async () => {
    await scene.database.migrator
      .updateTable('assistant_settings')
      .set({ data_groups_off: [] })
      .execute();
    scene.model.requests.length = 0;
    scene.model.script(
      calls({
        name: GENERATED_TOOLS['GET /api/people/students/:id']?.name ?? '',
        args: { id: ids.studentId ?? '' },
      }),
      answer('Read.'),
    );
    const response = await ask(scene, scene.admin, scene.north, { text: 'Read the student.' });
    expect(response.status).toBe(202);
    const given = JSON.stringify(scene.model.requests);
    expect(given).toContain(SENTINELS['student address']);
    expect(given).toContain(SENTINELS['student JSHSHIR']);
  });
});
