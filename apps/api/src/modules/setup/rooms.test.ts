import type { INestApplication } from '@nestjs/common';
import { apiErrorSchema, BRANCH_HEADER, roomListSchema } from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { errorCode, signInKit, type SignInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { Transactions } from '../../database/transactions.js';
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

    it('and refused with floor_archived on an archived floor, and not found on a floor of another branch or an unknown one; nothing is written', async () => {
      const before = (await entries('room.create')).length;
      const onArchived = await post('/api/setup/rooms', roomOf('F-1', archivedFloor));
      expect(onArchived.status).toBe(409);
      expect(errorCode(onArchived)).toBe('floor_archived');
      for (const floorId of [southFloor, UNKNOWN]) {
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

    it('and refused with already_exists for the name of another room, and with floor_archived for a move to an archived floor', async () => {
      const id = await createRoom(roomOf('203', first));

      expect(errorCode(await put(`/api/setup/rooms/${id}`, roomOf('202', first)))).toBe(
        'already_exists',
      );
      const moved = await put(`/api/setup/rooms/${id}`, roomOf('203', archivedFloor));
      expect(moved.status).toBe(409);
      expect(errorCode(moved)).toBe('floor_archived');
      expect(await entries('room.edit', id)).toHaveLength(0);
    });

    // A room on an archived floor is closed and stays so until the floor is
    // restored or the room is moved; it may still be renamed (spec review).
    it('keeps a closed room on an archived floor closed: a rename in place is saved, any other status is refused with floor_archived', async () => {
      const cellar = bodyId(
        await post(`/api/setup/buildings/${mainBuilding}/floors`, { name: 'Cellar' }),
      );
      const id = await createRoom(roomOf('C-1', cellar, { status: 'closed' }));
      expect((await post(`/api/setup/floors/${cellar}/archive`)).status).toBe(200);

      const renamed = await put(
        `/api/setup/rooms/${id}`,
        roomOf('C-1a', cellar, { status: 'closed' }),
      );
      expect(renamed.status).toBe(200);
      expect(await entries('room.edit', id)).toHaveLength(1);
      expect((await entries('room.edit', id))[0]).toMatchObject({
        assignment_id: expect.any(String) as string,
        old_value: { name: 'C-1' },
        new_value: { name: 'C-1a' },
      });

      const opened = await put(
        `/api/setup/rooms/${id}`,
        roomOf('C-1a', cellar, { status: 'in_use' }),
      );
      expect(opened.status).toBe(409);
      expect(errorCode(opened)).toBe('floor_archived');
      expect(await entries('room.edit', id)).toHaveLength(1);

      // Moved to an active floor, it can be in use again.
      expect((await put(`/api/setup/rooms/${id}`, roomOf('C-1a', first))).status).toBe(200);
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

  // Spec review of the branch (must-fix 1): under read committed two unlocked
  // reads could interleave and leave a room in use on an archived floor. The
  // floor is read with a share lock when a room is saved, and taken for update
  // when it is archived, so the two wait for each other.
  describe('wait for each other with the archive of their floor', () => {
    /** A promise that is settled from outside. */
    function gate(): { opened: Promise<void>; open: () => void } {
      let open = (): void => undefined;
      const opened = new Promise<void>((resolve) => {
        open = resolve;
      });
      return { opened, open };
    }

    const settled = async (promise: Promise<unknown>): Promise<boolean> => {
      const marker = Symbol('pending');
      const first = await Promise.race([
        promise.then(() => 'done'),
        new Promise((resolve) => setTimeout(() => resolve(marker), 400)),
      ]);
      return first !== marker;
    };

    it('a room is not created on a floor while its archive holds the floor, and is refused once the floor is archived', async () => {
      const floorId = bodyId(
        await post(`/api/setup/buildings/${mainBuilding}/floors`, { name: 'Locked A' }),
      );
      const { opened, open } = gate();
      // As archiveFloor does: the floor row taken for update, then the archive, then the commit.
      const archive = app.get(Transactions).run([north], async (transaction) => {
        await transaction
          .selectFrom('floors')
          .select('id')
          .where('id', '=', floorId)
          .forUpdate()
          .execute();
        await opened;
        await transaction
          .updateTable('floors')
          .set({ archived_at: clock.now() })
          .where('id', '=', floorId)
          .execute();
      });

      const creation = post('/api/setup/rooms', roomOf('L-1', floorId));
      expect(await settled(creation)).toBe(false);

      open();
      await archive;
      const response = await creation;
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('floor_archived');
    });

    it('a floor is not archived while a room is being saved on it, and is refused once the room is in use', async () => {
      const floorId = bodyId(
        await post(`/api/setup/buildings/${mainBuilding}/floors`, { name: 'Locked B' }),
      );
      const { opened, open } = gate();
      // As Rooms.create does: the floor row shared, the room written, then the commit.
      const saving = app.get(Transactions).run([north], async (transaction) => {
        await transaction
          .selectFrom('floors')
          .select('id')
          .where('id', '=', floorId)
          .forShare()
          .execute();
        await transaction
          .insertInto('rooms')
          .values({
            branch_id: north,
            floor_id: floorId,
            name: 'L-2',
            type: 'classroom',
            capacity: 20,
            status: 'in_use',
          })
          .execute();
        await opened;
      });

      const archive = post(`/api/setup/floors/${floorId}/archive`);
      expect(await settled(archive)).toBe(false);

      open();
      await saving;
      const response = await archive;
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('archive_refused');
    });
  });
});
