import type { INestApplication } from '@nestjs/common';
import {
  apiErrorSchema,
  BRANCH_HEADER,
  buildingListSchema,
  buildingSchema,
  floorSchema,
  type Building,
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

/** The id of the record an answer names. */
const bodyId = (response: Response): string => z.object({ id: z.uuid() }).parse(response.body).id;

/** The fields a refused body names, in order. */
const detailPaths = (response: Response): string[] =>
  apiErrorSchema.parse(response.body).error.details?.map((detail) => detail.path) ?? [];

/** The building of this id in the answer of the list. */
function buildingOf(response: Response, id: string): Building {
  const found = buildingListSchema.parse(response.body).buildings.find((one) => one.id === id);
  if (found === undefined) {
    throw new Error('The list does not hold the building.');
  }
  return found;
}
// Five minutes on: the Super Admin's idle limit is 15.
const LATER = '2026-10-10T09:05:00+05:00';
const UNKNOWN = '0199a000-0000-7000-8000-000000000099';

const ROOM = {
  type: 'classroom',
  capacity: 28,
  status: 'in_use',
  shared: false,
  maxSimultaneousLessons: null,
};

// All names are invented.
// docs/spec/03-school-setup.md, Building, floor, room: "Rooms are added floor
// by floor." Owner: Super Admin. Archived, never deleted (`12`, No lost work;
// CLAUDE.md): a building or a floor is archived only once every room on it is
// closed, and can be restored (decided by the owner, pull request #37).
describe('buildings and floors', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let north: string;
  let south: string;
  let admin: string;
  let principal: string;
  let vicePrincipal: string;
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
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

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

  async function building(name: string): Promise<string> {
    const response = await post('/api/setup/buildings', { name });
    expect(response.status).toBe(201);
    return bodyId(response);
  }

  async function floor(buildingId: string, name: string): Promise<string> {
    const response = await post(`/api/setup/buildings/${buildingId}/floors`, { name });
    expect(response.status).toBe(201);
    return bodyId(response);
  }

  async function room(floorId: string, name: string, status = 'in_use'): Promise<string> {
    const response = await post('/api/setup/rooms', { ...ROOM, name, floorId, status });
    expect(response.status).toBe(201);
    return bodyId(response);
  }

  const closeRoom = (id: string) =>
    database.migrator.updateTable('rooms').set({ status: 'closed' }).where('id', '=', id).execute();

  describe('a building', () => {
    it('is created by the Super Admin in the branch of the request, with an audit entry', async () => {
      const response = await post('/api/setup/buildings', { name: ' Main ' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.any(String) as string,
        name: 'Main',
        archivedAt: null,
        floors: [],
      });
      const row = await database.migrator
        .selectFrom('buildings')
        .selectAll()
        .where('id', '=', bodyId(response))
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({ branch_id: north, name: 'Main', archived_at: null });
      const written = await entries('building.create', bodyId(response));
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        branch_id: north,
        record_type: 'building',
        assignment_id: expect.any(String) as string,
        new_value: { name: 'Main' },
        request_id: response.headers['x-request-id'],
      });
    });

    it('is listed with its floors in its branch only', async () => {
      const inNorth = await get('/api/setup/buildings');
      const inSouth = await get('/api/setup/buildings', admin, south);

      expect(inNorth.status).toBe(200);
      expect(buildingListSchema.parse(inNorth.body).buildings.map((one) => one.name)).toContain(
        'Main',
      );
      expect(inSouth.body).toEqual({ buildings: [] });
    });

    it('is refused with already_exists when an active building of that name exists in the branch; nothing is written', async () => {
      const before = (await entries('building.create')).length;

      const response = await post('/api/setup/buildings', { name: 'main' });

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('already_exists');
      expect((await entries('building.create')).length).toBe(before);
    });

    it('is renamed, with the old and the new name in the audit entry; the same name writes nothing', async () => {
      const id = await building('Annex');

      const renamed = await put(`/api/setup/buildings/${id}`, { name: 'Annex B' });
      const same = await put(`/api/setup/buildings/${id}`, { name: 'Annex B' });

      expect(renamed.status).toBe(200);
      expect(renamed.body).toMatchObject({ id, name: 'Annex B' });
      expect(same.status).toBe(200);
      const written = await entries('building.edit', id);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        assignment_id: expect.any(String) as string,
        old_value: { name: 'Annex' },
        new_value: { name: 'Annex B' },
      });
    });

    it('cannot take the name of another active building', async () => {
      const id = await building('Annex C');

      const response = await put(`/api/setup/buildings/${id}`, { name: 'MAIN' });

      expect(errorCode(response)).toBe('already_exists');
    });

    it('of another branch, or unknown, is not found', async () => {
      const id = await building('Elsewhere');

      expect((await put(`/api/setup/buildings/${id}`, { name: 'X' }, admin, south)).status).toBe(
        404,
      );
      expect((await post(`/api/setup/buildings/${id}/archive`, {}, admin, south)).status).toBe(404);
      expect((await post(`/api/setup/buildings/${UNKNOWN}/floors`, { name: '1' })).status).toBe(
        404,
      );
    });

    it('is refused for the Principal, who views the branch and changes nothing', async () => {
      expect((await get('/api/setup/buildings', principal)).status).toBe(200);
      expect(errorCode(await post('/api/setup/buildings', { name: 'P' }, principal))).toBe(
        'permission_denied',
      );
      expect(errorCode(await get('/api/setup/buildings', principal, south))).toBe(
        'permission_denied',
      );
    });
  });

  describe('a floor', () => {
    it('is added to an active building, with an audit entry that names the building', async () => {
      const id = await building('Floors');

      const response = await post(`/api/setup/buildings/${id}/floors`, { name: ' Ground ' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.any(String) as string,
        name: 'Ground',
        archivedAt: null,
        roomCount: 0,
      });
      const written = await entries('floor.create', bodyId(response));
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        branch_id: north,
        record_type: 'floor',
        new_value: { name: 'Ground', buildingId: id },
      });
      const found = buildingOf(await get('/api/setup/buildings'), id);
      expect(found.floors).toEqual([
        { id: bodyId(response), name: 'Ground', archivedAt: null, roomCount: 0 },
      ]);
    });

    it('is refused with already_exists for a second active floor of that name in the building, while another building may have it', async () => {
      const first = await building('Twins A');
      const second = await building('Twins B');
      await floor(first, '1');

      expect(errorCode(await post(`/api/setup/buildings/${first}/floors`, { name: ' 1 ' }))).toBe(
        'already_exists',
      );
      expect((await post(`/api/setup/buildings/${second}/floors`, { name: '1' })).status).toBe(201);
    });

    it('is renamed with its audit entry, and not found in another branch', async () => {
      const id = await building('Rename');
      const floorId = await floor(id, 'One');

      const renamed = await put(`/api/setup/floors/${floorId}`, { name: '1' });

      expect(renamed.status).toBe(200);
      expect(renamed.body).toMatchObject({ id: floorId, name: '1' });
      const written = await entries('floor.edit', floorId);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({ assignment_id: expect.any(String) as string });
      expect((await put(`/api/setup/floors/${floorId}`, { name: '2' }, admin, south)).status).toBe(
        404,
      );
    });

    it('counts its rooms in the list', async () => {
      const id = await building('Counted');
      const floorId = await floor(id, '1');
      await room(floorId, 'C-1');
      await room(floorId, 'C-2', 'closed');

      const found = buildingOf(await get('/api/setup/buildings'), id);

      expect(found.floors[0]?.roomCount).toBe(2);
    });

    it('cannot be archived while a room on it is in use or under repair; nothing is written', async () => {
      const id = await building('Busy');
      const floorId = await floor(id, '1');
      const roomId = await room(floorId, 'B-1', 'under_repair');

      const response = await post(`/api/setup/floors/${floorId}/archive`);

      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('archive_refused');
      expect(await entries('floor.archive', floorId)).toHaveLength(0);
      await closeRoom(roomId);
      expect((await post(`/api/setup/floors/${floorId}/archive`)).status).toBe(200);
    });

    it('is archived at the moment of the clock once every room is closed, once only, and restored with an entry each', async () => {
      clock.set(START);
      const id = await building('Quiet');
      const floorId = await floor(id, '1');
      await room(floorId, 'Q-1', 'closed');

      const archived = await post(`/api/setup/floors/${floorId}/archive`);
      const again = await post(`/api/setup/floors/${floorId}/archive`);
      const restored = await post(`/api/setup/floors/${floorId}/restore`);
      const restoredAgain = await post(`/api/setup/floors/${floorId}/restore`);

      expect(archived.status).toBe(200);
      expect(floorSchema.parse(archived.body).archivedAt).toBe(new Date(START).toISOString());
      expect(floorSchema.parse(again.body).archivedAt).toBe(new Date(START).toISOString());
      expect(floorSchema.parse(restored.body).archivedAt).toBeNull();
      expect(floorSchema.parse(restoredAgain.body).archivedAt).toBeNull();
      const archives = await entries('floor.archive', floorId);
      expect(archives).toHaveLength(1);
      expect(archives[0]).toMatchObject({
        assignment_id: expect.any(String) as string,
        old_value: { archivedAt: null },
        new_value: { archivedAt: new Date(START).toISOString() },
      });
      const restores = await entries('floor.restore', floorId);
      expect(restores).toHaveLength(1);
      expect(restores[0]).toMatchObject({
        assignment_id: expect.any(String) as string,
        old_value: { archivedAt: new Date(START).toISOString() },
        new_value: { archivedAt: null },
      });
    });

    it('cannot be added to an archived building, and is not restored while its building is archived', async () => {
      const id = await building('Shut');
      const floorId = await floor(id, '1');
      expect((await post(`/api/setup/buildings/${id}/archive`)).status).toBe(200);

      const added = await post(`/api/setup/buildings/${id}/floors`, { name: '2' });
      expect(added.status).toBe(409);
      expect(errorCode(added)).toBe('archived_record');
      const response = await post(`/api/setup/floors/${floorId}/restore`);
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('archived_record');
    });

    // Spec review (should-fix 2): the unique indexes cover active names only,
    // so an archived record keeps its name until it is restored.
    it('is not renamed while archived, nor is its building; nothing is written', async () => {
      const id = await building('Frozen');
      const floorId = await floor(id, '1');
      expect((await post(`/api/setup/floors/${floorId}/archive`)).status).toBe(200);

      const floorRenamed = await put(`/api/setup/floors/${floorId}`, { name: '2' });
      expect(floorRenamed.status).toBe(409);
      expect(errorCode(floorRenamed)).toBe('archived_record');

      expect((await post(`/api/setup/buildings/${id}/archive`)).status).toBe(200);
      const buildingRenamed = await put(`/api/setup/buildings/${id}`, { name: 'Thawed' });
      expect(buildingRenamed.status).toBe(409);
      expect(errorCode(buildingRenamed)).toBe('archived_record');
      expect(await entries('floor.edit', floorId)).toHaveLength(0);
      expect(await entries('building.edit', id)).toHaveLength(0);
    });

    // Permission review: the records of another branch, on every route that names one.
    it('of another branch is not found by the restore, the archive and the floors of its building', async () => {
      const id = await building('Far');
      const floorId = await floor(id, '1');
      const southBuilding = await database.migrator
        .insertInto('buildings')
        .values({ branch_id: south, name: 'Far south' })
        .returning('id')
        .executeTakeFirstOrThrow();

      expect((await post(`/api/setup/buildings/${id}/restore`, {}, admin, south)).status).toBe(404);
      expect((await post(`/api/setup/floors/${floorId}/archive`, {}, admin, south)).status).toBe(
        404,
      );
      expect((await post(`/api/setup/floors/${floorId}/restore`, {}, admin, south)).status).toBe(
        404,
      );
      expect(
        (await post(`/api/setup/buildings/${southBuilding.id}/floors`, { name: '1' })).status,
      ).toBe(404);
    });

    it('cannot be restored while an active floor of its name exists in the building', async () => {
      const id = await building('Doubled');
      const floorId = await floor(id, '1');
      expect((await post(`/api/setup/floors/${floorId}/archive`)).status).toBe(200);
      await floor(id, '1');

      expect(errorCode(await post(`/api/setup/floors/${floorId}/restore`))).toBe('already_exists');
    });
  });

  describe('archiving a building', () => {
    it('is refused while a room on any of its floors is in use; nothing is written', async () => {
      const id = await building('Open');
      const ground = await floor(id, 'Ground');
      const first = await floor(id, '1');
      await room(ground, 'O-1', 'closed');
      await room(first, 'O-2');

      const response = await post(`/api/setup/buildings/${id}/archive`);

      expect(errorCode(response)).toBe('archive_refused');
      expect(await entries('building.archive', id)).toHaveLength(0);
      const found = buildingOf(await get('/api/setup/buildings'), id);
      expect(found.archivedAt).toBeNull();
      expect(found.floors.every((one) => one.archivedAt === null)).toBe(true);
    });

    it('takes its active floors with it, and restoring brings back exactly those; a floor archived earlier stays archived', async () => {
      clock.set(START);
      const id = await building('Whole');
      const earlier = await floor(id, 'Attic');
      const ground = await floor(id, 'Ground');
      const first = await floor(id, '1');
      await room(ground, 'W-1', 'closed');
      expect((await post(`/api/setup/floors/${earlier}/archive`)).status).toBe(200);
      clock.set(LATER);

      const archived = await post(`/api/setup/buildings/${id}/archive`);

      expect(archived.status).toBe(200);
      const archivedBuilding = buildingSchema.parse(archived.body);
      expect(archivedBuilding.archivedAt).toBe(new Date(LATER).toISOString());
      expect(archivedBuilding.floors).toEqual([
        { id: earlier, name: 'Attic', archivedAt: new Date(START).toISOString(), roomCount: 0 },
        { id: ground, name: 'Ground', archivedAt: new Date(LATER).toISOString(), roomCount: 1 },
        { id: first, name: '1', archivedAt: new Date(LATER).toISOString(), roomCount: 0 },
      ]);
      const archives = await entries('building.archive', id);
      expect(archives).toHaveLength(1);
      expect(archives[0]).toMatchObject({
        assignment_id: expect.any(String) as string,
        old_value: { archivedAt: null },
        new_value: { archivedAt: new Date(LATER).toISOString() },
        details: { floorIds: [ground, first] },
      });

      // An archived building stays as it is; its name is free meanwhile.
      expect(
        buildingSchema.parse((await post(`/api/setup/buildings/${id}/archive`)).body).archivedAt,
      ).toBe(new Date(LATER).toISOString());
      expect(await entries('building.archive', id)).toHaveLength(1);
      const taken = await building('Whole');

      const refused = await post(`/api/setup/buildings/${id}/restore`);
      expect(errorCode(refused)).toBe('already_exists');
      expect((await put(`/api/setup/buildings/${taken}`, { name: 'Whole 2' })).status).toBe(200);

      const restored = await post(`/api/setup/buildings/${id}/restore`);
      expect(restored.status).toBe(200);
      const restoredBuilding = buildingSchema.parse(restored.body);
      expect(restoredBuilding.archivedAt).toBeNull();
      expect(restoredBuilding.floors).toEqual([
        { id: earlier, name: 'Attic', archivedAt: new Date(START).toISOString(), roomCount: 0 },
        { id: ground, name: 'Ground', archivedAt: null, roomCount: 1 },
        { id: first, name: '1', archivedAt: null, roomCount: 0 },
      ]);
      const restores = await entries('building.restore', id);
      expect(restores).toHaveLength(1);
      expect(restores[0]).toMatchObject({
        assignment_id: expect.any(String) as string,
        old_value: { archivedAt: new Date(LATER).toISOString() },
        new_value: { archivedAt: null },
        details: { floorIds: [ground, first] },
      });
      // An active building stays as it is.
      expect((await post(`/api/setup/buildings/${id}/restore`)).status).toBe(200);
      expect(await entries('building.restore', id)).toHaveLength(1);
    });

    it('is refused for the Principal and the Academic Vice Principal on every writing route, and in another branch', async () => {
      const id = await building('Guarded');
      const floorId = await floor(id, '1');
      const writes = [
        () => post('/api/setup/buildings', { name: 'P' }, vicePrincipal),
        () => put(`/api/setup/buildings/${id}`, { name: 'P' }, vicePrincipal),
        () => post(`/api/setup/buildings/${id}/floors`, { name: '2' }, vicePrincipal),
        () => put(`/api/setup/floors/${floorId}`, { name: '2' }, vicePrincipal),
        () => post(`/api/setup/floors/${floorId}/archive`, {}, vicePrincipal),
        () => post(`/api/setup/floors/${floorId}/restore`, {}, vicePrincipal),
        () => post(`/api/setup/buildings/${id}/archive`, {}, vicePrincipal),
        () => post(`/api/setup/buildings/${id}/restore`, {}, vicePrincipal),
        () => put(`/api/setup/buildings/${id}`, { name: 'P' }, principal),
        () => put(`/api/setup/floors/${floorId}`, { name: '2' }, principal),
        () => post(`/api/setup/floors/${floorId}/archive`, {}, principal),
        () => get('/api/setup/buildings', vicePrincipal, south),
      ];
      for (const write of writes) {
        const response = await write();
        expect(response.status).toBe(403);
        expect(errorCode(response)).toBe('permission_denied');
      }

      expect(errorCode(await post(`/api/setup/buildings/${id}/archive`, {}, principal))).toBe(
        'permission_denied',
      );
      expect(errorCode(await post(`/api/setup/buildings/${id}/restore`, {}, principal))).toBe(
        'permission_denied',
      );
    });
  });

  it('refuses a body that fails the schema, naming the field, and writes nothing', async () => {
    const before = (await entries('building.create')).length;

    const response = await post('/api/setup/buildings', { name: 'N'.repeat(101) });

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe('validation_failed');
    expect(detailPaths(response)).toEqual(['name']);
    expect((await entries('building.create')).length).toBe(before);
  });
});
