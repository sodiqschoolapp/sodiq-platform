import type { INestApplication } from '@nestjs/common';
import { apiErrorSchema, BRANCH_HEADER } from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { errorCode, signInKit, type SignInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { z } from 'zod';

const START = '2026-10-10T09:00:00+05:00';

/** The id of the record an answer names. */
const bodyId = (response: Response): string => z.object({ id: z.uuid() }).parse(response.body).id;

/** The fields a refused body names, in order. */
const detailPaths = (response: Response): string[] =>
  apiErrorSchema.parse(response.body).error.details?.map((detail) => detail.path) ?? [];

const RECORD = {
  name: 'East',
  address: 'Yunusobod, 4',
  phone: '+998 71 200 00 00',
  email: 'east@example.test',
  workingWeekdays: [1, 2, 3, 4, 5, 6],
};

// All names are invented.
// docs/spec/03-school-setup.md, Branch: "Name, address, working weekdays,
// contacts. Every record belongs to one branch." Owner: Super Admin.
// docs/spec/02-roles-and-access.md, Super Admin: "Only this role creates
// branches"; Principal: "Views everything in the branch ... Changes nothing."
describe('the record of a branch', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let north: string;
  let south: string;
  let admin: string;
  let principal: string;
  let vicePrincipal: string;
  let teacher: string;
  const clock = new FixedClock(START);

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
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
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  const create = (cookie: string, body: object = RECORD) =>
    kit.post('/api/setup/branches', cookie).send(body);

  const read = (cookie: string, branch: string) =>
    kit.get('/api/setup/branch', cookie).set(BRANCH_HEADER, branch);

  const put = (cookie: string, branch: string, body: object) =>
    request(kit.server)
      .put('/api/setup/branch')
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .send(body);

  const schoolEntries = (action: string) =>
    database.migrator
      .selectFrom('audit_log_school')
      .selectAll()
      .where('action', '=', action)
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();

  const branchEntries = (action: string, branch: string) =>
    database.migrator
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', action)
      .where('branch_id', '=', branch)
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();

  const stored = (id: string) =>
    database.migrator
      .selectFrom('branches')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  describe('is created by the Super Admin', () => {
    it('with its fields, Monday first, the time zone of every branch, and an audit entry of the whole school that names the branch, the assignment and the request', async () => {
      const response = await create(admin);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.any(String) as string,
        ...RECORD,
        timeZone: 'Asia/Tashkent',
        goLiveDate: null,
      });
      const row = await stored(bodyId(response));
      expect(row).toMatchObject({
        name: 'East',
        address: 'Yunusobod, 4',
        phone: '+998 71 200 00 00',
        email: 'east@example.test',
        working_weekdays: [1, 2, 3, 4, 5, 6],
        time_zone: 'Asia/Tashkent',
      });
      const entries = await schoolEntries('branch.create');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        record_type: 'branch',
        record_id: bodyId(response),
        assignment_id: expect.any(String) as string,
        old_value: null,
        new_value: {
          ...RECORD,
          settings: {
            editDays: 7,
            lowResult: 50,
            resultDrop: 15,
            attendancePercent: 80,
            absencesInRow: 3,
          },
        },
        request_id: response.headers['x-request-id'],
      });
      expect(entries[0]?.actor_id).not.toBeNull();
      // Every branch has its settings row (task 1.6, decision 8).
      const settings = await database.migrator
        .selectFrom('branch_settings')
        .selectAll()
        .where('branch_id', '=', bodyId(response))
        .executeTakeFirstOrThrow();
      expect(settings).toMatchObject({ edit_days: 7, low_result: 50, absences_in_row: 3 });
      expect(entries[0]?.occurred_at.toISOString()).toBe(new Date(START).toISOString());
    });

    it('with a trimmed name and nothing for the empty optional fields', async () => {
      const response = await create(admin, {
        name: '  West  ',
        address: '',
        phone: ' ',
        email: '',
        workingWeekdays: [1, 2, 3, 4, 5],
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        name: 'West',
        address: null,
        phone: null,
        email: null,
      });
    });

    it('and refused with already_exists when a branch of that name exists, whatever the case; nothing is written', async () => {
      const before = (await schoolEntries('branch.create')).length;

      const response = await create(admin, { ...RECORD, name: ' NORTH ' });

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('already_exists');
      expect((await schoolEntries('branch.create')).length).toBe(before);
      const rows = await database.migrator.selectFrom('branches').select('name').execute();
      expect(rows.filter((row) => row.name.trim().toLowerCase() === 'north')).toHaveLength(1);
    });

    it('and refused with validation_failed, naming the field, for no working weekday, a repeated one, or a text that is not an email', async () => {
      for (const [body, path] of [
        [{ ...RECORD, name: 'A1', workingWeekdays: [] }, 'workingWeekdays'],
        [{ ...RECORD, name: 'A2', workingWeekdays: [2, 1] }, 'workingWeekdays'],
        [{ ...RECORD, name: 'A3', email: 'east' }, 'email'],
        [{ ...RECORD, name: '' }, 'name'],
      ] as const) {
        const response = await create(admin, body);
        expect(response.status).toBe(400);
        expect(errorCode(response)).toBe('validation_failed');
        expect(detailPaths(response)).toEqual([path]);
      }
      const rows = await database.migrator.selectFrom('branches').select('name').execute();
      expect(rows.map((row) => row.name)).not.toContain('A1');
    });

    it('and refused for the Principal, the Academic Vice Principal and a Teacher', async () => {
      for (const cookie of [principal, vicePrincipal, teacher]) {
        const response = await create(cookie, { ...RECORD, name: 'Refused' });
        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('permission_denied');
      }
    });
  });

  describe('is read', () => {
    it('by the Super Admin, the Principal and the Academic Vice Principal in the branch of the request', async () => {
      for (const cookie of [admin, principal, vicePrincipal]) {
        const response = await read(cookie, north);
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          id: north,
          name: 'North',
          address: null,
          phone: null,
          email: null,
          workingWeekdays: [1, 2, 3, 4, 5],
          timeZone: 'Asia/Tashkent',
          goLiveDate: null,
        });
      }
    });

    it('and refused for the Principal and the Academic Vice Principal of another branch, and for a Teacher', async () => {
      expect(errorCode(await read(principal, south))).toBe('permission_denied');
      expect(errorCode(await read(vicePrincipal, south))).toBe('permission_denied');
      expect(errorCode(await read(teacher, north))).toBe('permission_denied');
    });

    it('by the Super Admin in any branch, and refused for a branch that does not exist', async () => {
      expect((await read(admin, south)).body).toMatchObject({ id: south, name: 'South' });
      const response = await read(admin, '0199a000-0000-7000-8000-000000000099');
      expect(response.status).toBe(403);
    });
  });

  describe('is edited by the Super Admin', () => {
    it('with an audit entry of the branch that carries only the fields that changed, old and new', async () => {
      clock.set('2026-10-10T09:05:00+05:00');

      const response = await put(admin, south, {
        name: 'South',
        address: 'Sergeli, 9',
        phone: null,
        email: null,
        workingWeekdays: [1, 2, 3, 4, 5, 6],
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: south,
        address: 'Sergeli, 9',
        workingWeekdays: [1, 2, 3, 4, 5, 6],
      });
      const entries = await branchEntries('branch.edit', south);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        record_type: 'branch',
        record_id: south,
        assignment_id: expect.any(String) as string,
        old_value: { address: null, workingWeekdays: [1, 2, 3, 4, 5] },
        new_value: { address: 'Sergeli, 9', workingWeekdays: [1, 2, 3, 4, 5, 6] },
        request_id: response.headers['x-request-id'],
      });
      expect(entries[0]?.occurred_at.toISOString()).toBe(
        new Date('2026-10-10T09:05:00+05:00').toISOString(),
      );
      expect((await stored(south)).time_zone).toBe('Asia/Tashkent');
    });

    it('and nothing is written when nothing changed', async () => {
      const before = (await branchEntries('branch.edit', south)).length;

      const response = await put(admin, south, {
        name: 'South',
        address: 'Sergeli, 9',
        phone: '',
        email: '',
        workingWeekdays: [1, 2, 3, 4, 5, 6],
      });

      expect(response.status).toBe(200);
      expect((await branchEntries('branch.edit', south)).length).toBe(before);
    });

    it('and refused with already_exists for the name of another branch', async () => {
      const response = await put(admin, south, { ...RECORD, name: 'north' });

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('already_exists');
      expect((await stored(south)).name).toBe('South');
    });

    it('and refused for the Principal and the Academic Vice Principal of the branch, and in another branch', async () => {
      for (const [cookie, branch] of [
        [principal, north],
        [vicePrincipal, north],
        [principal, south],
        [teacher, north],
      ] as const) {
        const response = await put(cookie, branch, RECORD);
        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('permission_denied');
      }
      expect((await stored(north)).name).toBe('North');
    });
  });

  it('answers nobody who is not signed in', async () => {
    expect((await kit.get('/api/setup/branch').set(BRANCH_HEADER, north)).status).toBe(401);
    expect((await kit.post('/api/setup/branches').send(RECORD)).status).toBe(401);
  });
});
