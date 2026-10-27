import type { INestApplication } from '@nestjs/common';
import { BRANCH_HEADER } from '@sodiq/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { expectRefusedById, UNKNOWN_ID } from '../../testing/id-refusal-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { signInKit, type SignInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const START = '2026-10-10T09:00:00+05:00';

/**
 * The tables a write of a building, a floor or a room writes: the places,
 * and the drafts a room change marks out of date with their causes (task
 * 5.5a-3b-1).
 */
const PLACE_TABLES = [
  'buildings',
  'floors',
  'rooms',
  'timetable_versions',
  'timetable_version_out_of_date_causes',
];

interface Place {
  building: string;
  floor: string;
  room: string;
}

// All names are invented. `.claude/rules/api.md`, tasks 1.3 and 1.5: an id of
// another branch's record, or an unknown one, in the path or the body of a
// setup route is answered 404, with every row of the tables the route writes
// in both branches and the audit log unchanged (task 10.3b). Sent as the Super
// Admin, who passes the guard in every branch: only the route's own check can
// answer 404.
describe('the setup routes, for an id of another branch or an unknown one', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let admin: string;
  let north: string;
  let south: string;
  let own: Place;
  let foreign: Place;
  const clock = new FixedClock(START);

  async function place(branch: string, name: string): Promise<Place> {
    const building = await database.migrator
      .insertInto('buildings')
      .values({ branch_id: branch, name })
      .returning('id')
      .executeTakeFirstOrThrow();
    const floor = await database.migrator
      .insertInto('floors')
      .values({ branch_id: branch, building_id: building.id, name: '1' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const room = await database.migrator
      .insertInto('rooms')
      .values({
        branch_id: branch,
        floor_id: floor.id,
        name: `${name} 101`,
        type: 'classroom',
        capacity: 28,
        status: 'in_use',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { building: building.id, floor: floor.id, room: room.id };
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    app = await createTestApp({ database: database.app, clock });
    kit = signInKit(app);
    const browser = await kit.completeSession('Aziza', 'Karimova');
    await kit.giveRole(browser.account.id, { role: 'super_admin' });
    admin = browser.cookie;
    own = await place(north, 'Main');
    foreign = await place(south, 'Far');
    // A draft in each branch, which a change of a room would mark.
    const classes = new ClassesKit(database.migrator);
    const load = new LoadKit(database.migrator);
    for (const branch of [north, south]) {
      await load.version(branch, await classes.year(branch));
    }
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  const post = (path: string, body: object = {}) =>
    kit.post(path, admin).set(BRANCH_HEADER, north).send(body);

  const put = (path: string, body: object) =>
    request(kit.server).put(path).set('Cookie', admin).set(BRANCH_HEADER, north).send(body);

  const roomOf = (floorId: string) => ({
    name: 'New 202',
    floorId,
    type: 'classroom',
    capacity: 30,
    status: 'in_use',
    shared: false,
    maxSimultaneousLessons: null,
  });

  const refused = (send: (id: string) => ReturnType<typeof post>) =>
    expectRefusedById({
      database: database.migrator,
      tables: PLACE_TABLES,
      ids: [foreign.building, UNKNOWN_ID],
      send,
    });

  it('PUT /api/setup/buildings/:id answers 404', async () => {
    await refused((id) => put(`/api/setup/buildings/${id}`, { name: 'Taken over' }));
  });

  it('POST /api/setup/buildings/:id/archive and /restore answer 404', async () => {
    await refused((id) => post(`/api/setup/buildings/${id}/archive`));
    await refused((id) => post(`/api/setup/buildings/${id}/restore`));
  });

  it('POST /api/setup/buildings/:id/floors answers 404', async () => {
    await refused((id) => post(`/api/setup/buildings/${id}/floors`, { name: '2' }));
  });

  it('PUT /api/setup/floors/:id, its archive and its restore answer 404', async () => {
    for (const send of [
      (id: string) => put(`/api/setup/floors/${id}`, { name: '2' }),
      (id: string) => post(`/api/setup/floors/${id}/archive`),
      (id: string) => post(`/api/setup/floors/${id}/restore`),
    ]) {
      await expectRefusedById({
        database: database.migrator,
        tables: PLACE_TABLES,
        ids: [foreign.floor, UNKNOWN_ID],
        send,
      });
    }
  });

  it('POST /api/setup/rooms answers 404 for the floor', async () => {
    await expectRefusedById({
      database: database.migrator,
      tables: PLACE_TABLES,
      ids: [foreign.floor, UNKNOWN_ID],
      send: (id) => post('/api/setup/rooms', roomOf(id)),
    });
  });

  it('PUT /api/setup/rooms/:id answers 404 for the room and for the floor', async () => {
    await expectRefusedById({
      database: database.migrator,
      tables: PLACE_TABLES,
      ids: [foreign.room, UNKNOWN_ID],
      send: (id) => put(`/api/setup/rooms/${id}`, roomOf(own.floor)),
    });
    await expectRefusedById({
      database: database.migrator,
      tables: PLACE_TABLES,
      ids: [foreign.floor, UNKNOWN_ID],
      send: (id) => put(`/api/setup/rooms/${own.room}`, roomOf(id)),
    });
  });
});
