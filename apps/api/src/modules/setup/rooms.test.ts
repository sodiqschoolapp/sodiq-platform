import type { INestApplication } from '@nestjs/common';
import { apiErrorSchema, BRANCH_HEADER, roomListSchema } from '@sodiq/shared';
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
const UNKNOWN = '0199a000-0000-7000-8000-000000000099';

// All names are invented.
// docs/spec/03-school-setup.md, Building, floor, room: "Room: name or number,
// floor, type (classroom, laboratory, sports hall, hall, other), capacity,
// status (in use, under repair, closed)." docs/spec/edge-cases/timetable.md,
// Structure: "A room has a 'shared' switch and a maximum number of lessons at
// the same time." Owner: Super Admin.
describe('rooms', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let north: string;
  let south: string;
  let admin: string;
  let principal: string;
  let vicePrincipal: string;
  let mainBuilding: string;
  let ground: string;
  let first: string;
  let archivedFloor: string;
  let southFloor: string;
  const clock = new FixedClock(START);

  const get = (path: string, cookie = admin, branch = north) =>
    kit.get(path, cookie).set(BRANCH_HEADER, branch);

  const post = (path: string, body: object = {}, cookie = admin, branch = north) =>
    kit.post(path, cookie).set(BRANCH_HEADER, branch).send(body);

  const put = (path: string, body: object, cookie = admin, branch = north) =>
    request(kit.server).put(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body);

  const entries = (action: string, recordId?: string) => {
    let query = database.migrator
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', action)
      .orderBy('occurred_at')
      .orderBy('id');
    if (recordId !== undefined) {
      query = query.where('record_id', '=', recordId);
    }
    return query.execute();
  };

  const roomOf = (name: string, floorId = ground, fields: object = {}) => ({
    name,
    floorId,
    type: 'classroom',
    capacity: 28,
    status: 'in_use',
    shared: false,
    maxSimultaneousLessons: null,
    ...fields,
  });

  async function createRoom(body: object): Promise<string> {
    const response = await post('/api/setup/rooms', body);
    expect(response.status).toBe(201);
    return bodyId(response);
  }

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

    const building = await post('/api/setup/buildings', { name: 'Main' });
    mainBuilding = bodyId(building);
    ground = bodyId(await post(`/api/setup/buildings/${mainBuilding}/floors`, { name: 'Ground' }));
    first = bodyId(await post(`/api/setup/buildings/${mainBuilding}/floors`, { name: '1' }));
    archivedFloor = bodyId(
      await post(`/api/setup/buildings/${mainBuilding}/floors`, { name: 'Attic' }),
    );
    expect((await post(`/api/setup/floors/${archivedFloor}/archive`)).status).toBe(200);
    const southBuilding = await database.migrator
      .insertInto('buildings')
      .values({ branch_id: south, name: 'Main' })
      .returning('id')
      .executeTakeFirstOrThrow();
    southFloor = (
      await database.migrator
        .insertInto('floors')
        .values({ branch_id: south, building_id: southBuilding.id, name: 'Ground' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  describe('are created by the Super Admin', () => {
    it('on an active floor of the branch, with the names of floor and building, and an audit entry with the fields', async () => {
      const response = await post('/api/setup/rooms', roomOf(' 101 '));

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.any(String) as string,
        name: '101',
        floorId: ground,
        floorName: 'Ground',
        buildingId: mainBuilding,
        buildingName: 'Main',
        type: 'classroom',
        capacity: 28,
        status: 'in_use',
        shared: false,
        maxSimultaneousLessons: null,
      });
      const written = await entries('room.create', bodyId(response));
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        branch_id: north,
        record_type: 'room',
        assignment_id: expect.any(String) as string,
        old_value: null,
        new_value: roomOf('101'),
        request_id: response.headers['x-request-id'],
      });
    });

    it('as a shared room with the number of lessons it holds at once', async () => {
      const response = await post(
        '/api/setup/rooms',
        roomOf('Sports hall', ground, {
          type: 'sports_hall',
          capacity: 120,
          shared: true,
          maxSimultaneousLessons: 3,
        }),
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ shared: true, maxSimultaneousLessons: 3 });
    });

    it('and refused with validation_failed, naming the field, for a shared room without the number, a number on a room not shared, and a capacity of 0', async () => {
      const before = (await entries('room.create')).length;
      for (const [fields, path] of [
        [{ shared: true, maxSimultaneousLessons: null }, 'maxSimultaneousLessons'],
        [{ shared: false, maxSimultaneousLessons: 2 }, 'maxSimultaneousLessons'],
        [{ capacity: 0 }, 'capacity'],
        [{ type: 'gym' }, 'type'],
      ] as const) {
        const response = await post('/api/setup/rooms', roomOf('V-1', ground, fields));
        expect(response.status).toBe(400);
        expect(errorCode(response)).toBe('validation_failed');
        expect(detailPaths(response)).toEqual([path]);
      }
      expect((await entries('room.create')).length).toBe(before);
    });

    it('and not found on an archived floor, a floor of another branch, or an unknown floor; nothing is written', async () => {
      const before = (await entries('room.create')).length;
      for (const floorId of [archivedFloor, southFloor, UNKNOWN]) {
        const response = await post('/api/setup/rooms', roomOf('F-1', floorId));
        expect(response.status).toBe(404);
        expect(errorCode(response)).toBe('not_found');
      }
      expect((await entries('room.create')).length).toBe(before);
      const rows = await database.migrator.selectFrom('rooms').select('name').execute();
      expect(rows.map((row) => row.name)).not.toContain('F-1');
    });

    it('and refused with already_exists for the name of a room anywhere in the branch, whatever the case', async () => {
      const response = await post('/api/setup/rooms', roomOf(' 101', first));

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('already_exists');
    });

    it('and refused for the Principal and the Academic Vice Principal', async () => {
      for (const cookie of [principal, vicePrincipal]) {
        const response = await post('/api/setup/rooms', roomOf('P-1'), cookie);
        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('permission_denied');
      }
    });
  });

  describe('are listed', () => {
    it('for the three roles that view, in the branch of the request only', async () => {
      await database.migrator
        .insertInto('rooms')
        .values({
          branch_id: south,
          floor_id: southFloor,
          name: 'S-1',
          type: 'other',
          capacity: 10,
          status: 'closed',
        })
        .execute();

      for (const cookie of [admin, principal, vicePrincipal]) {
        const response = await get('/api/setup/rooms', cookie);
        expect(response.status).toBe(200);
        const names = roomListSchema.parse(response.body).rooms.map((room) => room.name);
        expect(names).toContain('101');
        expect(names).not.toContain('S-1');
      }
      const inSouth = await get('/api/setup/rooms', admin, south);
      expect(roomListSchema.parse(inSouth.body).rooms.map((room) => room.name)).toEqual(['S-1']);
      expect(errorCode(await get('/api/setup/rooms', principal, south))).toBe('permission_denied');
    });
  });

  describe('are edited by the Super Admin', () => {
    it('in every field, the floor included, with the changed fields old and new in the audit entry', async () => {
      const id = await createRoom(roomOf('201', first));
      clock.set('2026-10-10T09:05:00+05:00');

      const response = await put(
        `/api/setup/rooms/${id}`,
        roomOf('201', ground, { capacity: 30, status: 'under_repair' }),
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id,
        floorId: ground,
        floorName: 'Ground',
        capacity: 30,
        status: 'under_repair',
      });
      const written = await entries('room.edit', id);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        old_value: { floorId: first, capacity: 28, status: 'in_use' },
        new_value: { floorId: ground, capacity: 30, status: 'under_repair' },
        request_id: response.headers['x-request-id'],
      });
      expect(written[0]?.occurred_at.toISOString()).toBe(
        new Date('2026-10-10T09:05:00+05:00').toISOString(),
      );
    });

    it('and nothing is written when nothing changed', async () => {
      const id = await createRoom(roomOf('202', first));

      const response = await put(`/api/setup/rooms/${id}`, roomOf(' 202 ', first));

      expect(response.status).toBe(200);
      expect(await entries('room.edit', id)).toHaveLength(0);
    });

    it('and refused with already_exists for the name of another room, and not found for an archived floor', async () => {
      const id = await createRoom(roomOf('203', first));

      expect(errorCode(await put(`/api/setup/rooms/${id}`, roomOf('202', first)))).toBe(
        'already_exists',
      );
      expect((await put(`/api/setup/rooms/${id}`, roomOf('203', archivedFloor))).status).toBe(404);
      expect(await entries('room.edit', id)).toHaveLength(0);
    });

    it('and not found for a room of another branch', async () => {
      const id = await createRoom(roomOf('204', first));

      expect((await put(`/api/setup/rooms/${id}`, roomOf('204', first), admin, south)).status).toBe(
        404,
      );
      expect((await put(`/api/setup/rooms/${UNKNOWN}`, roomOf('205', first))).status).toBe(404);
    });

    it('and refused for the Principal and the Academic Vice Principal', async () => {
      const id = await createRoom(roomOf('206', first));

      for (const cookie of [principal, vicePrincipal]) {
        const response = await put(`/api/setup/rooms/${id}`, roomOf('206', first), cookie);
        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('permission_denied');
      }
    });
  });
});
