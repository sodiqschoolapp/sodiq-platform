import type { INestApplication } from '@nestjs/common';
import {
  apiErrorSchema,
  BRANCH_HEADER,
  departmentSchema,
  divisionListSchema,
  divisionSchema,
  type Division,
} from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { errorCode, signInKit, type SignInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { z } from 'zod';

const START = '2026-10-10T09:00:00+05:00';
// Five minutes on: the Super Admin's idle limit is 15.
const LATER = '2026-10-10T09:05:00+05:00';
const UNKNOWN = '0199a000-0000-7000-8000-000000000099';

/** The id of the record an answer names. */
const bodyId = (response: Response): string => z.object({ id: z.uuid() }).parse(response.body).id;

/** The fields a refused body names, in order. */
const detailPaths = (response: Response): string[] =>
  apiErrorSchema.parse(response.body).error.details?.map((detail) => detail.path) ?? [];

/** Invented names for a new division or department; `en` is what the tests call it. */
const names = (en: string) => ({ uz: `${en} (uz)`, ru: `${en} (ru)`, en });

/** The division of this id in the answer of the list. */
function divisionOf(response: Response, id: string): Division {
  const found = divisionListSchema.parse(response.body).divisions.find((one) => one.id === id);
  if (found === undefined) {
    throw new Error('The list does not hold the division.');
  }
  return found;
}

/** The eight divisions of `03`, in the order of its table, by their English and Uzbek names. */
const SPEC_DIVISIONS = [
  ['Academic', 'Oʻquv boʻlimi'],
  ['Management', 'Rahbariyat'],
  ['Student Services', 'Oʻquvchilarga xizmat koʻrsatish boʻlimi'],
  ['Admissions and Marketing', 'Qabul va marketing boʻlimi'],
  ['Finance', 'Moliya boʻlimi'],
  ['HR', 'Kadrlar boʻlimi'],
  ['IT', 'Axborot texnologiyalari boʻlimi'],
  ['Operations', 'Xoʻjalik boʻlimi'],
];

/** The departments of the Departments column of `03`, per division, in its order. */
const SPEC_DEPARTMENTS: Record<string, string[]> = {
  Academic: ['STEAM', 'Foreign languages', 'National', 'Natural sciences', 'General', 'Tutors'],
  Management: [],
  'Student Services': ['Medical', 'Psychology', 'Library', 'Clubs and events'],
  'Admissions and Marketing': [],
  Finance: [],
  HR: [],
  IT: [],
  Operations: ['Facilities', 'Catering', 'Security', 'Transport'],
};

// All names of people are invented.
// docs/spec/03-school-setup.md, Divisions: "The school has eight (decided)";
// "One list for the whole school"; "Academic is built in. It cannot be renamed
// or archived"; "Other divisions are data. The Super Admin adds, renames and
// archives them"; "Each division and department has a name in three
// languages." `02`, Super Admin: "Only this role creates ... divisions".
// Departments archived and restored with their division as buildings and
// floors are (decided by the owner, pull request #40, answer 4).
describe('divisions and departments', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let north: string;
  let admin: string;
  let principal: string;
  let vicePrincipal: string;
  let teacher: string;
  let academic: Division;
  const clock = new FixedClock(START);

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    app = await createTestApp({ database: database.app, clock });
    kit = signInKit(app);
    const adminBrowser = await kit.completeSession('Aziza', 'Karimova');
    await kit.giveRole(adminBrowser.account.id, { role: 'super_admin' });
    admin = adminBrowser.cookie;
    const principalBrowser = await kit.fullSession('Bobur', 'Aliyev');
    await kit.giveRole(principalBrowser.account.id, { role: 'principal', branchId: north });
    principal = principalBrowser.cookie;
    const viceBrowser = await kit.completeSession('Dilnoza', 'Saidova');
    await kit.giveRole(viceBrowser.account.id, {
      role: 'academic_vice_principal',
      branchId: north,
    });
    vicePrincipal = viceBrowser.cookie;
    const teacherBrowser = await kit.fullSession('Jasur', 'Toshev');
    await kit.giveRole(teacherBrowser.account.id, { role: 'teacher', branchId: north });
    teacher = teacherBrowser.cookie;
    const listed = divisionListSchema.parse((await list()).body).divisions;
    const first = listed[0];
    if (first === undefined) {
      throw new Error('The seed holds no division.');
    }
    academic = first;
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  /** The one reading route, bound to the branch of the request. */
  const list = (cookie = admin, branch: string | null = north) => {
    const call = kit.get('/api/setup/divisions', cookie);
    return branch === null ? call : call.set(BRANCH_HEADER, branch);
  };

  /** The writing routes are school-wide: no branch header. */
  const post = (path: string, body: object = {}, cookie = admin) =>
    kit.post(path, cookie).send(body);

  const put = (path: string, body: object, cookie = admin) =>
    request(kit.server).put(path).set('Cookie', cookie).send(body);

  const entries = (action: string, recordId?: string) => {
    let query = database.migrator
      .selectFrom('audit_log_school')
      .selectAll()
      .where('action', '=', action)
      .orderBy('occurred_at')
      .orderBy('id');
    if (recordId !== undefined) {
      query = query.where('record_id', '=', recordId);
    }
    return query.execute();
  };

  async function division(en: string): Promise<string> {
    const response = await post('/api/setup/divisions', { names: names(en) });
    expect(response.status).toBe(201);
    return bodyId(response);
  }

  async function department(divisionId: string, en: string): Promise<string> {
    const response = await post(`/api/setup/divisions/${divisionId}/departments`, {
      names: names(en),
    });
    expect(response.status).toBe(201);
    return bodyId(response);
  }

  describe('the list', () => {
    it('holds the eight divisions of the spec in its order, Academic built in, each with the departments of the spec', async () => {
      const response = await list();

      expect(response.status).toBe(200);
      const divisions = divisionListSchema.parse(response.body).divisions;
      expect(divisions.map((one) => [one.names.en, one.names.uz])).toEqual(SPEC_DIVISIONS);
      expect(divisions.map((one) => one.builtIn)).toEqual([true, ...Array<boolean>(7).fill(false)]);
      expect(divisions.every((one) => one.archivedAt === null)).toBe(true);
      expect(
        Object.fromEntries(
          divisions.map((one) => [one.names.en, one.departments.map((each) => each.names.en)]),
        ),
      ).toEqual(SPEC_DEPARTMENTS);
      expect(divisions[0]?.names.ru).toBe('Учебный отдел');
      expect(divisions[0]?.departments[5]?.names).toEqual({
        uz: 'Tyutorlar',
        ru: 'Тьюторы',
        en: 'Tutors',
      });
    });

    it('is read by the Principal and the Academic Vice Principal, not by a Teacher, and not without a branch', async () => {
      expect((await list(principal)).status).toBe(200);
      expect((await list(vicePrincipal)).status).toBe(200);
      expect(errorCode(await list(teacher))).toBe('permission_denied');
      // The branch header is an input of a route bound to a branch: missing, it fails validation.
      const noBranch = await list(admin, null);
      expect(noBranch.status).toBe(400);
      expect(errorCode(noBranch)).toBe('validation_failed');
    });
  });

  describe('a division', () => {
    it('is added by the Super Admin after the last one, with an audit entry of the whole school', async () => {
      const response = await post('/api/setup/divisions', {
        names: { uz: ' Sport ', ru: 'Спорт', en: 'Sports' },
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.any(String) as string,
        names: { uz: 'Sport', ru: 'Спорт', en: 'Sports' },
        builtIn: false,
        archivedAt: null,
        departments: [],
      });
      const listed = divisionListSchema.parse((await list()).body).divisions;
      expect(listed.at(-1)?.id).toBe(bodyId(response));
      const written = await entries('division.create', bodyId(response));
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        record_type: 'division',
        assignment_id: expect.any(String) as string,
        new_value: { names: { uz: 'Sport', ru: 'Спорт', en: 'Sports' } },
        request_id: response.headers['x-request-id'],
      });
    });

    it('is refused with already_exists, naming the language, when an active division has that name in any language, whatever its case; nothing is written', async () => {
      const before = (await entries('division.create')).length;

      const english = await post('/api/setup/divisions', { names: names(' finance ') });
      const russian = await post('/api/setup/divisions', {
        names: { ...names('Money'), ru: 'ФИНАНСОВЫЙ ОТДЕЛ' },
      });

      expect(english.status).toBe(409);
      expect(errorCode(english)).toBe('already_exists');
      expect(detailPaths(english)).toEqual(['names.en']);
      expect(errorCode(russian)).toBe('already_exists');
      expect(detailPaths(russian)).toEqual(['names.ru']);
      expect((await entries('division.create')).length).toBe(before);
    });

    it('is renamed, with the old and the new names in the audit entry; the same names write nothing; a taken name is refused', async () => {
      const id = await division('Catering unit');

      const renamed = await put(`/api/setup/divisions/${id}`, {
        names: { ...names('Catering unit'), en: 'Catering division' },
      });
      const same = await put(`/api/setup/divisions/${id}`, {
        names: { ...names('Catering unit'), en: 'Catering division' },
      });
      const taken = await put(`/api/setup/divisions/${id}`, {
        names: { ...names('Catering unit'), uz: 'Moliya boʻlimi' },
      });

      expect(renamed.status).toBe(200);
      expect(divisionSchema.parse(renamed.body).names.en).toBe('Catering division');
      expect(same.status).toBe(200);
      expect(errorCode(taken)).toBe('already_exists');
      expect(detailPaths(taken)).toEqual(['names.uz']);
      const written = await entries('division.edit', id);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        assignment_id: expect.any(String) as string,
        old_value: { names: names('Catering unit') },
        new_value: { names: { ...names('Catering unit'), en: 'Catering division' } },
      });
    });

    // `03`: "Academic is built in. It cannot be renamed or archived, because
    // departments, subjects and the teaching load depend on it."
    it('that is Academic is neither renamed nor archived; nothing is written', async () => {
      const renamed = await put(`/api/setup/divisions/${academic.id}`, { names: names('Study') });
      const archived = await post(`/api/setup/divisions/${academic.id}/archive`);

      expect(renamed.status).toBe(409);
      expect(errorCode(renamed)).toBe('built_in');
      expect(archived.status).toBe(409);
      expect(errorCode(archived)).toBe('built_in');
      expect(await entries('division.edit', academic.id)).toHaveLength(0);
      expect(await entries('division.archive', academic.id)).toHaveLength(0);
      expect(divisionOf(await list(), academic.id)).toEqual(academic);
    });

    it('that is unknown is not found', async () => {
      expect((await put(`/api/setup/divisions/${UNKNOWN}`, { names: names('X') })).status).toBe(
        404,
      );
      expect((await post(`/api/setup/divisions/${UNKNOWN}/archive`)).status).toBe(404);
      expect((await post(`/api/setup/divisions/${UNKNOWN}/restore`)).status).toBe(404);
      expect(
        (await post(`/api/setup/divisions/${UNKNOWN}/departments`, { names: names('X') })).status,
      ).toBe(404);
    });

    it('is archived with its active departments at the moment of the clock, once only, and restored with exactly those; one archived earlier stays archived; its names are free meanwhile', async () => {
      clock.set(START);
      const id = await division('Events');
      const earlier = await department(id, 'Fairs');
      const first = await department(id, 'Concerts');
      const second = await department(id, 'Trips');
      expect((await post(`/api/setup/departments/${earlier}/archive`)).status).toBe(200);
      clock.set(LATER);

      const archived = await post(`/api/setup/divisions/${id}/archive`);

      expect(archived.status).toBe(200);
      const archivedDivision = divisionSchema.parse(archived.body);
      expect(archivedDivision.archivedAt).toBe(new Date(LATER).toISOString());
      expect(archivedDivision.departments.map((one) => [one.id, one.archivedAt])).toEqual([
        [earlier, new Date(START).toISOString()],
        [first, new Date(LATER).toISOString()],
        [second, new Date(LATER).toISOString()],
      ]);
      const archives = await entries('division.archive', id);
      expect(archives).toHaveLength(1);
      expect(archives[0]).toMatchObject({
        assignment_id: expect.any(String) as string,
        old_value: { archivedAt: null },
        new_value: { archivedAt: new Date(LATER).toISOString() },
        details: { departmentIds: [first, second] },
      });

      // An archived division stays as it is.
      expect(
        divisionSchema.parse((await post(`/api/setup/divisions/${id}/archive`)).body).archivedAt,
      ).toBe(new Date(LATER).toISOString());
      expect(await entries('division.archive', id)).toHaveLength(1);

      // Its names are free; while an active division has one, the restore is refused.
      const taker = await division('Events');
      const refused = await post(`/api/setup/divisions/${id}/restore`);
      expect(errorCode(refused)).toBe('already_exists');
      expect(detailPaths(refused)).toEqual(['names.uz']);
      expect(
        (await put(`/api/setup/divisions/${taker}`, { names: names('Festivals') })).status,
      ).toBe(200);

      const restored = await post(`/api/setup/divisions/${id}/restore`);
      expect(restored.status).toBe(200);
      const restoredDivision = divisionSchema.parse(restored.body);
      expect(restoredDivision.archivedAt).toBeNull();
      expect(restoredDivision.departments.map((one) => [one.id, one.archivedAt])).toEqual([
        [earlier, new Date(START).toISOString()],
        [first, null],
        [second, null],
      ]);
      const restores = await entries('division.restore', id);
      expect(restores).toHaveLength(1);
      expect(restores[0]).toMatchObject({
        assignment_id: expect.any(String) as string,
        old_value: { archivedAt: new Date(LATER).toISOString() },
        new_value: { archivedAt: null },
        details: { departmentIds: [first, second] },
      });
      // An active division stays as it is.
      expect((await post(`/api/setup/divisions/${id}/restore`)).status).toBe(200);
      expect(await entries('division.restore', id)).toHaveLength(1);
    });

    it('is not renamed while archived; nothing is written', async () => {
      const id = await division('Frozen');
      expect((await post(`/api/setup/divisions/${id}/archive`)).status).toBe(200);

      const response = await put(`/api/setup/divisions/${id}`, { names: names('Thawed') });

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('archived_record');
      expect(await entries('division.edit', id)).toHaveLength(0);
    });
  });

  describe('a department', () => {
    it('is added to an active division after its last one, with an audit entry that names the division', async () => {
      const id = await division('Hosting');

      const response = await post(`/api/setup/divisions/${id}/departments`, {
        names: { uz: ' Mehmonxona ', ru: 'Гостиница', en: 'Hotel' },
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.any(String) as string,
        names: { uz: 'Mehmonxona', ru: 'Гостиница', en: 'Hotel' },
        archivedAt: null,
      });
      const written = await entries('department.create', bodyId(response));
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        record_type: 'department',
        assignment_id: expect.any(String) as string,
        new_value: { names: { uz: 'Mehmonxona', ru: 'Гостиница', en: 'Hotel' }, divisionId: id },
        request_id: response.headers['x-request-id'],
      });
      await department(id, 'Kitchen');
      expect(divisionOf(await list(), id).departments.map((one) => one.names.en)).toEqual([
        'Hotel',
        'Kitchen',
      ]);
    });

    it('is refused with already_exists, naming the language, for a second active department of that name in the division, while another division may have it', async () => {
      const first = await division('Twins A');
      const second = await division('Twins B');
      await department(first, 'Shared name');

      const same = await post(`/api/setup/divisions/${first}/departments`, {
        names: { ...names('Other'), ru: ' SHARED NAME (RU) ' },
      });
      expect(errorCode(same)).toBe('already_exists');
      expect(detailPaths(same)).toEqual(['names.ru']);
      expect(
        (await post(`/api/setup/divisions/${second}/departments`, { names: names('Shared name') }))
          .status,
      ).toBe(201);
    });

    it('is renamed with its audit entry; the same names write nothing', async () => {
      const id = await division('Renaming');
      const departmentId = await department(id, 'One');

      const renamed = await put(`/api/setup/departments/${departmentId}`, { names: names('1') });
      const same = await put(`/api/setup/departments/${departmentId}`, { names: names('1') });

      expect(renamed.status).toBe(200);
      expect(departmentSchema.parse(renamed.body).names).toEqual(names('1'));
      expect(same.status).toBe(200);
      const written = await entries('department.edit', departmentId);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        assignment_id: expect.any(String) as string,
        old_value: { names: names('One') },
        new_value: { names: names('1') },
      });
    });

    it('is archived at the moment of the clock, once only, and restored, with an entry each', async () => {
      clock.set(START);
      const id = await division('Quiet');
      const departmentId = await department(id, 'Still');

      const archived = await post(`/api/setup/departments/${departmentId}/archive`);
      const again = await post(`/api/setup/departments/${departmentId}/archive`);
      const restored = await post(`/api/setup/departments/${departmentId}/restore`);
      const restoredAgain = await post(`/api/setup/departments/${departmentId}/restore`);

      expect(archived.status).toBe(200);
      expect(departmentSchema.parse(archived.body).archivedAt).toBe(new Date(START).toISOString());
      expect(departmentSchema.parse(again.body).archivedAt).toBe(new Date(START).toISOString());
      expect(departmentSchema.parse(restored.body).archivedAt).toBeNull();
      expect(departmentSchema.parse(restoredAgain.body).archivedAt).toBeNull();
      const archives = await entries('department.archive', departmentId);
      expect(archives).toHaveLength(1);
      expect(archives[0]).toMatchObject({
        assignment_id: expect.any(String) as string,
        old_value: { archivedAt: null },
        new_value: { archivedAt: new Date(START).toISOString() },
      });
      const restores = await entries('department.restore', departmentId);
      expect(restores).toHaveLength(1);
      expect(restores[0]).toMatchObject({
        assignment_id: expect.any(String) as string,
        old_value: { archivedAt: new Date(START).toISOString() },
        new_value: { archivedAt: null },
      });
    });

    it('is not added to, renamed in or restored in an archived division, and not renamed while archived itself', async () => {
      const id = await division('Shut');
      const open = await department(id, 'Open');
      const closed = await department(id, 'Closed');
      expect((await post(`/api/setup/departments/${closed}/archive`)).status).toBe(200);

      const renamedArchived = await put(`/api/setup/departments/${closed}`, { names: names('C') });
      expect(errorCode(renamedArchived)).toBe('archived_record');

      expect((await post(`/api/setup/divisions/${id}/archive`)).status).toBe(200);
      const added = await post(`/api/setup/divisions/${id}/departments`, { names: names('New') });
      const renamed = await put(`/api/setup/departments/${open}`, { names: names('O') });
      const restored = await post(`/api/setup/departments/${open}/restore`);
      for (const response of [added, renamed, restored]) {
        expect(response.status).toBe(409);
        expect(errorCode(response)).toBe('archived_record');
      }
      expect(await entries('department.edit', open)).toHaveLength(0);
      expect(await entries('department.edit', closed)).toHaveLength(0);
    });

    it('cannot be restored while an active department of its name is in the division', async () => {
      const id = await division('Doubled');
      const departmentId = await department(id, 'Same');
      expect((await post(`/api/setup/departments/${departmentId}/archive`)).status).toBe(200);
      await department(id, 'Same');

      const response = await post(`/api/setup/departments/${departmentId}/restore`);

      expect(errorCode(response)).toBe('already_exists');
      expect(detailPaths(response)).toEqual(['names.uz']);
    });

    it('that is unknown is not found', async () => {
      expect((await put(`/api/setup/departments/${UNKNOWN}`, { names: names('X') })).status).toBe(
        404,
      );
      expect((await post(`/api/setup/departments/${UNKNOWN}/archive`)).status).toBe(404);
      expect((await post(`/api/setup/departments/${UNKNOWN}/restore`)).status).toBe(404);
    });
  });

  // `02`, Principal: "Changes nothing"; the Academic Vice Principal reads the
  // list only (decided by the owner, pull request #40, answer 5).
  it('refuses the Principal, the Academic Vice Principal and a Teacher on every writing route', async () => {
    const id = await division('Guarded');
    const departmentId = await department(id, 'Watched');
    for (const cookie of [principal, vicePrincipal, teacher]) {
      const writes = [
        () => post('/api/setup/divisions', { names: names('P') }, cookie),
        () => put(`/api/setup/divisions/${id}`, { names: names('P') }, cookie),
        () => post(`/api/setup/divisions/${id}/archive`, {}, cookie),
        () => post(`/api/setup/divisions/${id}/restore`, {}, cookie),
        () => post(`/api/setup/divisions/${id}/departments`, { names: names('P') }, cookie),
        () => put(`/api/setup/departments/${departmentId}`, { names: names('P') }, cookie),
        () => post(`/api/setup/departments/${departmentId}/archive`, {}, cookie),
        () => post(`/api/setup/departments/${departmentId}/restore`, {}, cookie),
      ];
      for (const write of writes) {
        const response = await write();
        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('permission_denied');
      }
    }
    expect(await entries('division.edit', id)).toHaveLength(0);
    expect(await entries('department.edit', departmentId)).toHaveLength(0);
  });

  it('refuses a body that fails the schema, naming the field, and writes nothing', async () => {
    const before = (await entries('division.create')).length;

    const response = await post('/api/setup/divisions', { names: { uz: 'A', en: 'A' } });

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe('validation_failed');
    expect(detailPaths(response)).toEqual(['names.ru']);
    expect((await entries('division.create')).length).toBe(before);
  });
});
