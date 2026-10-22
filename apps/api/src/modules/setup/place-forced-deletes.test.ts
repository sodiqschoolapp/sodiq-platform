import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  forcedDeleteListSchema,
  forcedDeleteSchema,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { publishedScene, type PublishedScene } from '../../testing/published-scene.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

/** The answer of a forced delete or a restore of a place. */
const done = (response: Response) => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const answer = forcedDeleteSchema.parse(response.body);
  if (answer.recordType === 'lesson') throw new Error('A place was expected.');
  return answer;
};

/** The details of a refusal: what each names and why. */
const detailsOf = (response: Response) =>
  (response.body as { error: { details: { code: string; path: string }[] } }).error.details;

type Kind = 'building' | 'floor' | 'room';

const PATHS = { building: 'buildings', floor: 'floors', room: 'rooms' } as const;

// All names are invented. Task 5.8c, pull request #196: the Super Admin's
// forced delete of a building, floor or room and its restore
// (docs/spec/03-school-setup.md, Building, floor, room: "The Super Admin's
// forced delete (06) also removes a building, floor or room that no lesson,
// timetable entry or other record references, with a reason, an audit entry
// and 30 days to restore; a referenced one stays archive-only"). The clock
// stands at 23:55 on Saturday 10 October 2026 in Tashkent.
describe('the forced delete of a building, floor or room and its restore', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let northScene: PublishedScene;
  /** A second Super Admin, for the request keys (at most three: `MAX_SUPER_ADMINS`). */
  let second: { cookie: string };
  let count = 0;

  const keyed = (path: string, branch: string, body: object, cookie: string, key: string) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, key)
      .send(body);

  const forceDelete = (
    branch: string,
    kind: Kind,
    id: string,
    reason: unknown = 'Added by mistake',
    cookie = t.admin,
    key: string = randomUUID(),
  ) => keyed(`/api/setup/${PATHS[kind]}/${id}/forced-delete`, branch, { reason }, cookie, key);

  const restore = (branch: string, id: string, cookie = t.admin, key: string = randomUUID()) =>
    keyed(`/api/forced-deletes/${id}/restore`, branch, {}, cookie, key);

  const list = (branch: string, cookie = t.admin) => t.get('/api/forced-deletes', branch, cookie);

  /** A building with a floor and a room, written by the migrator. */
  async function place(
    branch = t.north,
  ): Promise<{ building: string; floor: string; room: string; roomName: string }> {
    count += 1;
    const building = await t.database.migrator
      .insertInto('buildings')
      .values({ branch_id: branch, name: `Annex ${String(count)}` })
      .returning('id')
      .executeTakeFirstOrThrow();
    const floor = await t.database.migrator
      .insertInto('floors')
      .values({ branch_id: branch, building_id: building.id, name: 'Upper' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const roomName = `Workshop ${String(count)}`;
    const room = await t.database.migrator
      .insertInto('rooms')
      .values({
        branch_id: branch,
        floor_id: floor.id,
        name: roomName,
        type: 'laboratory',
        capacity: 18,
        status: 'in_use',
        shared: true,
        max_simultaneous_lessons: 2,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { building: building.id, floor: floor.id, room: room.id, roomName };
  }

  /** A building, floor or room of the branch that nothing references. */
  async function unused(kind: Kind, branch = t.north): Promise<string> {
    count += 1;
    const building = await t.database.migrator
      .insertInto('buildings')
      .values({ branch_id: branch, name: `Shed ${String(count)}` })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (kind === 'building') return building.id;
    const floor = await t.database.migrator
      .insertInto('floors')
      .values({ branch_id: branch, building_id: building.id, name: 'Loft' })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (kind === 'floor') return floor.id;
    return (await place(branch)).room;
  }

  /** The store row of a record put past its 30 days; answers its end before. */
  async function expire(recordId: string): Promise<Date> {
    const row = await t.database.migrator
      .selectFrom('forced_deletes')
      .select('restore_until')
      .where('record_id', '=', recordId)
      .executeTakeFirstOrThrow();
    await t.database.migrator
      .updateTable('forced_deletes')
      .set({ restore_until: new Date(START) })
      .where('record_id', '=', recordId)
      .execute();
    return row.restore_until;
  }

  const rowOf = (kind: Kind, id: string) =>
    t.database.migrator.selectFrom(PATHS[kind]).selectAll().where('id', '=', id).executeTakeFirst();

  /** Every row of the tables a forced delete or a restore writes, and the log. */
  const everything = () =>
    Promise.all([
      t.database.migrator.selectFrom('buildings').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('floors').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('rooms').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('lessons').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('forced_deletes').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('audit_log').select('id').orderBy('id').execute(),
      t.database.migrator.selectFrom('request_keys').selectAll().orderBy('key').execute(),
    ]);

  /** The stored lessons of the scene's first class on a date. */
  const lessonOf = async (s: PublishedScene, date: string) => {
    const found = await t.database.migrator
      .selectFrom('lessons')
      .selectAll()
      .where('branch_id', '=', s.branch)
      .where('class_id', '=', s.classId)
      .where('lesson_date', '=', date)
      .orderBy('starts_at')
      .executeTakeFirst();
    if (found === undefined) throw new Error('No such lesson.');
    return found;
  };

  /** A lesson of the scene put into a room of its own by the migrator (no history line). */
  async function lessonIn(s: PublishedScene, date: string, room: string) {
    const lesson = await lessonOf(s, date);
    await t.database.migrator
      .updateTable('lessons')
      .set({ room_id: room })
      .where('id', '=', lesson.id)
      .execute();
    return lesson.id;
  }

  async function waiting(): Promise<number> {
    const found = await sql<{ n: number }>`
      select count(distinct l.pid)::int as n
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(t.database.migrator);
    return found.rows[0]?.n ?? 0;
  }

  /** Two real requests behind the publish lock held open, the first sent first. */
  async function inOrder(
    branch: string,
    first: () => Promise<Response>,
    second: () => Promise<Response>,
  ): Promise<[Response, Response]> {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const held = t.app
      .get(Transactions)
      .run([branch], async (transaction: Transaction) => {
        await sql`select pg_advisory_xact_lock(550001)`.execute(transaction);
        ready();
        await released;
      })
      .catch((error: unknown) => error);
    await isReady;
    const one = first().then((response) => response);
    await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(1);
    const two = second().then((response) => response);
    await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(2);
    release();
    expect(await held).toBeUndefined();
    return Promise.all([one, two]);
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    northScene = await publishedScene(t, load, { branch: t.north });
    const browser = await t.kit.completeSession('Nodira', 'Qosimova');
    await t.kit.giveRole(browser.account.id, { role: 'super_admin' });
    second = browser;
  });

  afterAll(async () => {
    await t.close();
  });

  describe('a forced delete', () => {
    it('removes a room nothing references, keeps it in the store with its names, and writes its entry', async () => {
      const ids = await place();
      const answer = done(await forceDelete(t.north, 'room', ids.room, '  Added by mistake  '));
      expect(answer).toMatchObject({
        recordType: 'room',
        reason: 'Added by mistake',
        place: {
          id: ids.room,
          name: ids.roomName,
          building: { id: ids.building },
          floor: { id: ids.floor, name: 'Upper' },
          floors: [],
        },
        restoredAt: null,
        restorable: true,
      });
      expect(answer.restoreUntil).toBe(
        new Date(new Date(START).getTime() + 30 * 86_400_000).toISOString(),
      );
      expect(await rowOf('room', ids.room)).toBeUndefined();
      const [entry] = await t.entries('room.forced_delete', ids.room);
      expect(entry).toMatchObject({ assignment_id: t.adminAssignment, reason: 'Added by mistake' });
      const listed = forcedDeleteListSchema.parse((await list(t.north)).body);
      expect(listed.entries.find((one) => one.id === answer.id)?.recordType).toBe('room');
    });

    it('removes a floor with no room on it', async () => {
      const ids = await place();
      done(await forceDelete(t.north, 'room', ids.room));
      // The room's store row names its floor for 30 days (decision 2).
      await t.database.migrator
        .updateTable('forced_deletes')
        .set({ restore_until: new Date(START) })
        .where('record_id', '=', ids.room)
        .execute();
      const answer = done(await forceDelete(t.north, 'floor', ids.floor));
      expect(answer.place).toMatchObject({ id: ids.floor, building: { id: ids.building } });
      expect(await rowOf('floor', ids.floor)).toBeUndefined();
      expect(await t.entries('floor.forced_delete', ids.floor)).toHaveLength(1);
    });

    it('removes a building with its empty floors, an archived one included', async () => {
      count += 1;
      const building = await t.database.migrator
        .insertInto('buildings')
        .values({ branch_id: t.north, name: `Pavilion ${String(count)}` })
        .returning('id')
        .executeTakeFirstOrThrow();
      const floors = await t.database.migrator
        .insertInto('floors')
        .values([
          { branch_id: t.north, building_id: building.id, name: 'Lower' },
          {
            branch_id: t.north,
            building_id: building.id,
            name: 'Attic',
            archived_at: new Date(START),
          },
        ])
        .returning('id')
        .execute();
      const answer = done(await forceDelete(t.north, 'building', building.id));
      expect(answer.place.floors.map((one) => one.name).sort()).toEqual(['Attic', 'Lower']);
      expect(await rowOf('building', building.id)).toBeUndefined();
      for (const floor of floors) {
        expect(await rowOf('floor', floor.id)).toBeUndefined();
        // Each floor has an entry of its own, with the reason.
        expect(await t.entries('floor.forced_delete', floor.id)).toMatchObject([
          { reason: 'Added by mistake' },
        ]);
      }
    });

    it('refuses a building or a floor with a room on it, and nothing changes', async () => {
      const ids = await place();
      const before = await everything();
      refusedWith(await forceDelete(t.north, 'building', ids.building), 409, 'place_referenced');
      refusedWith(await forceDelete(t.north, 'floor', ids.floor), 409, 'place_referenced');
      expect(await everything()).toEqual(before);
    });

    it('refuses a room a lesson is in, a class has as its home room, a load row names or a closure closes (by their keys)', async () => {
      const s = northScene;
      const inLesson = await place();
      await lessonIn(s, '2026-11-23', inLesson.room);
      const inRow = await place();
      // A row of a draft (a published version's rows never change).
      await load.row({
        branch_id: t.north,
        version_id: await load.version(t.north, s.year, { startsOn: '2026-11-30' }),
        class_id: s.classId,
        subject_id: s.subject,
        teacher_id: s.teacher.staffId,
        room_id: inRow.room,
      });
      const closed = await place();
      await t.database.migrator
        .insertInto('room_closures')
        .values({
          branch_id: t.north,
          room_id: closed.room,
          starts_on: '2026-11-02',
          ends_on: '2026-11-03',
          applies_from: new Date(START),
          applies_until: new Date('2026-11-04T00:00:00+05:00'),
          reason: 'Painting',
          created_by: (
            await t.database.migrator
              .selectFrom('assignments')
              .select('account_id')
              .where('id', '=', t.adminAssignment)
              .executeTakeFirstOrThrow()
          ).account_id,
        })
        .execute();
      const before = await everything();
      for (const room of [s.room, inLesson.room, inRow.room, closed.room]) {
        refusedWith(await forceDelete(t.north, 'room', room), 409, 'place_referenced');
      }
      expect(await everything()).toEqual(before);
    });

    it('refuses a room the lesson history names (a lesson moved out of it), through the route', async () => {
      const s = northScene;
      const ids = await place();
      const other = await place();
      const lesson = await lessonIn(s, '2026-11-09', ids.room);
      const moved = await keyed(
        `/api/timetable/lessons/${lesson}/room`,
        t.north,
        { roomId: other.room, reason: 'Projector broken' },
        t.admin,
        randomUUID(),
      );
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      refusedWith(await forceDelete(t.north, 'room', ids.room), 409, 'place_referenced');
      expect(await rowOf('room', ids.room)).toBeDefined();
    });

    it('refuses a reason missing, of spaces only or of 501 characters as an input error', async () => {
      const ids = await place();
      refusedWith(
        await keyed(
          `/api/setup/rooms/${ids.room}/forced-delete`,
          t.north,
          {},
          t.admin,
          randomUUID(),
        ),
        400,
        'validation_failed',
      );
      for (const reason of ['   ', 'x'.repeat(501)]) {
        refusedWith(await forceDelete(t.north, 'room', ids.room, reason), 400, 'validation_failed');
      }
      expect(await rowOf('room', ids.room)).toBeDefined();
    });

    it.each(['building', 'floor', 'room'] as const)(
      'refuses the forced delete of a %s to the Academic Vice Principal, the Principal and a Teacher, and nothing changes',
      async (kind) => {
        const ids = await place();
        const before = await everything();
        for (const cookie of [t.vicePrincipal, t.principal, t.teacher]) {
          refusedWith(
            await forceDelete(t.north, kind, ids[kind], 'Rain', cookie),
            403,
            'permission_denied',
          );
        }
        expect(await everything()).toEqual(before);
      },
    );

    it.each(['building', 'floor', 'room'] as const)(
      'answers 404 for a %s of another branch and an unknown one, and nothing changes',
      async (kind) => {
        const branch = await t.newBranch();
        const foreign = await place(branch);
        const before = await everything();
        refusedWith(await forceDelete(t.north, kind, foreign[kind]), 404, 'not_found');
        refusedWith(await forceDelete(t.north, kind, UNKNOWN), 404, 'not_found');
        expect(await everything()).toEqual(before);
      },
    );

    it.each(['building', 'floor', 'room'] as const)(
      'keeps a used key of a %s to its account, its branch and its role (request keys)',
      async (kind) => {
        const id = await unused(kind);
        const branch = await t.newBranch();
        const foreign = await unused(kind, branch);
        const key = randomUUID();
        const first = done(await forceDelete(t.north, kind, id, 'Rain', t.admin, key));
        const after = await everything();
        // The repeat finds the record in the store: the row is gone by then.
        expect(done(await forceDelete(t.north, kind, id, 'Rain', t.admin, key)).id).toBe(first.id);
        expect(await everything()).toEqual(after);
        refusedWith(
          await forceDelete(t.north, kind, id, 'Rain', second.cookie, key),
          409,
          'request_key_reused',
        );
        refusedWith(
          await forceDelete(t.north, kind, foreign, 'Rain', t.admin, key),
          404,
          'not_found',
        );
        refusedWith(
          await forceDelete(t.north, kind, UNKNOWN, 'Rain', t.admin, key),
          404,
          'not_found',
        );
        refusedWith(
          await forceDelete(t.north, kind, id, 'Rain', t.vicePrincipal, key),
          403,
          'permission_denied',
        );
        expect(await everything()).toEqual(after);
        expect(await t.entries(`${kind}.forced_delete`, id)).toHaveLength(1);
      },
    );
  });

  describe('a restore', () => {
    it('puts back the same room with its values, writes its entry, and is refused a second time', async () => {
      const ids = await place();
      const before = await rowOf('room', ids.room);
      const store = done(await forceDelete(t.north, 'room', ids.room)).id;
      const answer = done(await restore(t.north, store));
      expect(answer).toMatchObject({
        restorable: false,
        restoredBy: { id: expect.any(String) as unknown },
      });
      expect(await rowOf('room', ids.room)).toEqual(before);
      const [entry] = await t.entries('forced_delete.restore', ids.room);
      expect(entry).toMatchObject({ assignment_id: t.adminAssignment });
      refusedWith(await restore(t.north, store), 409, 'forced_delete_restored');
    });

    it('puts back a building with its floors, an archived one archived', async () => {
      count += 1;
      const building = await t.database.migrator
        .insertInto('buildings')
        .values({ branch_id: t.north, name: `Wing ${String(count)}` })
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('floors')
        .values([
          { branch_id: t.north, building_id: building.id, name: 'Lower' },
          {
            branch_id: t.north,
            building_id: building.id,
            name: 'Attic',
            archived_at: new Date(START),
          },
        ])
        .execute();
      const floorsBefore = await t.database.migrator
        .selectFrom('floors')
        .selectAll()
        .where('building_id', '=', building.id)
        .orderBy('id')
        .execute();
      const store = done(await forceDelete(t.north, 'building', building.id)).id;
      done(await restore(t.north, store));
      expect(
        await t.database.migrator
          .selectFrom('floors')
          .selectAll()
          .where('building_id', '=', building.id)
          .orderBy('id')
          .execute(),
      ).toEqual(floorsBefore);
    });

    it('is refused for a floor whose building was archived since, and lets an archived floor back', async () => {
      const ids = await place();
      done(await forceDelete(t.north, 'room', ids.room));
      await t.database.migrator
        .updateTable('forced_deletes')
        .set({ restore_until: new Date(START) })
        .where('record_id', '=', ids.room)
        .execute();
      const extra = await t.database.migrator
        .insertInto('floors')
        .values({
          branch_id: t.north,
          building_id: ids.building,
          name: 'Cellar',
          archived_at: new Date(START),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const active = done(await forceDelete(t.north, 'floor', ids.floor)).id;
      const archived = done(await forceDelete(t.north, 'floor', extra.id)).id;
      await t.database.migrator
        .updateTable('buildings')
        .set({ archived_at: new Date(START) })
        .where('id', '=', ids.building)
        .execute();
      const refused = await restore(t.north, active);
      refusedWith(refused, 409, 'forced_delete_place_parent');
      expect(detailsOf(refused)).toMatchObject([{ path: 'building', code: 'archived_record' }]);
      expect(await rowOf('floor', ids.floor)).toBeUndefined();
      done(await restore(t.north, archived));
      expect(await rowOf('floor', extra.id)).toBeDefined();
    });

    it('is refused for a room whose floor was archived since, whatever its status', async () => {
      const ids = await place();
      const store = done(await forceDelete(t.north, 'room', ids.room)).id;
      await t.database.migrator
        .updateTable('floors')
        .set({ archived_at: new Date(START) })
        .where('id', '=', ids.floor)
        .execute();
      const refused = await restore(t.north, store);
      refusedWith(refused, 409, 'forced_delete_place_parent');
      expect(detailsOf(refused)).toMatchObject([{ path: 'floor', code: 'floor_archived' }]);
      expect(await rowOf('room', ids.room)).toBeUndefined();
    });

    it.each(['room', 'floor'] as const)(
      'is refused for a %s whose parent was deleted for good since',
      async (kind) => {
        const ids = await place();
        if (kind === 'floor') {
          done(await forceDelete(t.north, 'room', ids.room));
          await expire(ids.room);
        }
        const child = kind === 'room' ? ids.room : ids.floor;
        const store = done(await forceDelete(t.north, kind, child)).id;
        // The child's store row names its parent for 30 days (decision 2); the
        // fixture lets the parent go and gives the row its days back.
        const until = await expire(child);
        if (kind === 'room') {
          done(await forceDelete(t.north, 'floor', ids.floor));
        } else {
          done(await forceDelete(t.north, 'building', ids.building));
        }
        await t.database.migrator
          .updateTable('forced_deletes')
          .set({ restore_until: until })
          .where('id', '=', store)
          .execute();
        const refused = await restore(t.north, store);
        refusedWith(refused, 409, 'forced_delete_place_parent');
        expect(detailsOf(refused)).toMatchObject([
          { path: kind === 'room' ? 'floor' : 'building', code: 'not_found' },
        ]);
        expect(await rowOf(kind, child)).toBeUndefined();
      },
    );

    it('is refused when a closed room took the name since', async () => {
      const ids = await place();
      const store = done(await forceDelete(t.north, 'room', ids.room)).id;
      const other = await place();
      await t.database.migrator
        .updateTable('rooms')
        .set({ name: ids.roomName, status: 'closed' })
        .where('id', '=', other.room)
        .execute();
      refusedWith(await restore(t.north, store), 409, 'already_exists');
      expect(await rowOf('room', ids.room)).toBeUndefined();
    });

    it('is refused when an active building took the name since', async () => {
      count += 1;
      const name = `Gallery ${String(count)}`;
      const building = await t.database.migrator
        .insertInto('buildings')
        .values({ branch_id: t.north, name })
        .returning('id')
        .executeTakeFirstOrThrow();
      const store = done(await forceDelete(t.north, 'building', building.id)).id;
      await t.database.migrator
        .insertInto('buildings')
        .values({ branch_id: t.north, name })
        .execute();
      refusedWith(await restore(t.north, store), 409, 'already_exists');
      expect(await rowOf('building', building.id)).toBeUndefined();
    });

    it('is refused after its 30 days', async () => {
      const ids = await place();
      const store = done(await forceDelete(t.north, 'room', ids.room)).id;
      await t.database.migrator
        .updateTable('forced_deletes')
        .set({ restore_until: new Date(START) })
        .where('id', '=', store)
        .execute();
      refusedWith(await restore(t.north, store), 409, 'forced_delete_expired');
    });

    it('is refused to the Academic Vice Principal, the Principal and a Teacher, and answers 404 for another branch’s and an unknown id', async () => {
      const ids = await place();
      const store = done(await forceDelete(t.north, 'room', ids.room)).id;
      const branch = await t.newBranch();
      const foreign = await place(branch);
      const foreignStore = done(await forceDelete(branch, 'room', foreign.room)).id;
      const foreignBuilding = done(
        await forceDelete(branch, 'building', await unused('building', branch)),
      ).id;
      const before = await everything();
      for (const cookie of [t.vicePrincipal, t.principal, t.teacher]) {
        refusedWith(await restore(t.north, store, cookie), 403, 'permission_denied');
      }
      refusedWith(await restore(t.north, foreignStore), 404, 'not_found');
      refusedWith(await restore(t.north, foreignBuilding), 404, 'not_found');
      refusedWith(await restore(t.north, UNKNOWN), 404, 'not_found');
      expect(await everything()).toEqual(before);
    });
  });

  describe('at the same moment (database point 4)', () => {
    it("a lesson's forced delete holds its room: it waits for a room held for update, without the publish lock (4b and lessons_hold_room)", async () => {
      const s = await publishedScene(t, load);
      const ids = await place(s.branch);
      const lesson = await lessonIn(s, '2026-10-19', ids.room);
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      // The room held as its forced delete holds it, without the publish lock.
      const held = t.app
        .get(Transactions)
        .run([s.branch], async (transaction: Transaction) => {
          await sql`select id from rooms where id = ${ids.room} for update`.execute(transaction);
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await isReady;
      const deleting = keyed(
        `/api/timetable/lessons/${lesson}/forced-delete`,
        s.branch,
        { reason: 'Entered twice' },
        t.admin,
        randomUUID(),
      ).then((response) => response);
      await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(1);
      release();
      expect(await held).toBeUndefined();
      expect((await deleting).status).toBe(200);
    });

    it('a room and a lesson in it deleted for good: either order leaves the room, refused', async () => {
      for (const roomFirst of [true, false]) {
        const s = await publishedScene(t, load);
        const ids = await place(s.branch);
        const lesson = await lessonIn(s, '2026-10-19', ids.room);
        const deleteLesson = () =>
          keyed(
            `/api/timetable/lessons/${lesson}/forced-delete`,
            s.branch,
            { reason: 'Entered twice' },
            t.admin,
            randomUUID(),
          );
        const deleteRoom = () => forceDelete(s.branch, 'room', ids.room);
        const [one, two] = await inOrder(
          s.branch,
          roomFirst ? deleteRoom : deleteLesson,
          roomFirst ? deleteLesson : deleteRoom,
        );
        const [room, lessonAnswer] = roomFirst ? [one, two] : [two, one];
        expect(lessonAnswer.status, JSON.stringify(lessonAnswer.body)).toBe(200);
        refusedWith(room, 409, 'place_referenced');
        expect(await rowOf('room', ids.room)).toBeDefined();
      }
    });

    it('a room and a lesson moved out of it: either order leaves the room, refused', async () => {
      for (const roomFirst of [true, false]) {
        const s = await publishedScene(t, load);
        const ids = await place(s.branch);
        const other = await place(s.branch);
        const lesson = await lessonIn(s, '2026-10-19', ids.room);
        const move = () =>
          keyed(
            `/api/timetable/lessons/${lesson}/room`,
            s.branch,
            { roomId: other.room, reason: 'Projector broken' },
            t.admin,
            randomUUID(),
          );
        const deleteRoom = () => forceDelete(s.branch, 'room', ids.room);
        const [one, two] = await inOrder(
          s.branch,
          roomFirst ? deleteRoom : move,
          roomFirst ? move : deleteRoom,
        );
        const [room, moved] = roomFirst ? [one, two] : [two, one];
        expect(moved.status, JSON.stringify(moved.body)).toBe(200);
        refusedWith(room, 409, 'place_referenced');
        expect(await rowOf('room', ids.room)).toBeDefined();
      }
    });

    it('a room and a lesson moved into it: the room first is gone and the move refused; the move first refuses the room', async () => {
      for (const roomFirst of [true, false]) {
        const s = await publishedScene(t, load);
        const ids = await place(s.branch);
        const lesson = await lessonOf(s, '2026-10-19');
        const move = () =>
          keyed(
            `/api/timetable/lessons/${lesson.id}/room`,
            s.branch,
            { roomId: ids.room, reason: 'Bigger room' },
            t.admin,
            randomUUID(),
          );
        const deleteRoom = () => forceDelete(s.branch, 'room', ids.room);
        const [one, two] = await inOrder(
          s.branch,
          roomFirst ? deleteRoom : move,
          roomFirst ? move : deleteRoom,
        );
        const [room, moved] = roomFirst ? [one, two] : [two, one];
        if (roomFirst) {
          done(room);
          refusedWith(moved, 404, 'not_found');
          expect(await rowOf('room', ids.room)).toBeUndefined();
        } else {
          expect(moved.status, JSON.stringify(moved.body)).toBe(200);
          refusedWith(room, 409, 'place_referenced');
          expect(await rowOf('room', ids.room)).toBeDefined();
        }
      }
    });
  });

  // Task 5.12b, pull request #202 (`14`, Timetable, Database rules: "This
  // holds even if the application code has a fault or two people save at the
  // same moment"; `03`, Building, floor, room: "a referenced one stays
  // archive-only"; the From line of 5.8c). Each writer that names a room
  // against the room's forced delete, both real routes, in both orders: a
  // third transaction holds the room as the delete holds it, the first route
  // is sent and waits, then the second. The room is referenced by nothing
  // before the race, so only the order decides: the delete first, the writer
  // answers 404 `not_found` and writes nothing; the writer first, the delete
  // is refused and the room stays.
  describe('a room deleted for good while a writer that names it waits (task 5.12b)', () => {
    /** Two real requests behind the room held `for update`, the first sent first. */
    async function behindRoom(
      branch: string,
      room: string,
      first: () => Promise<Response>,
      second: () => Promise<Response>,
    ): Promise<[Response, Response]> {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const held = t.app
        .get(Transactions)
        .run([branch], async (transaction: Transaction) => {
          await sql`select id from rooms where id = ${room} for update`.execute(transaction);
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await isReady;
      const one = first().then((response) => response);
      await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(1);
      const two = second().then((response) => response);
      await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(2);
      release();
      expect(await held).toBeUndefined();
      return Promise.all([one, two]);
    }

    /** The audit entries of the branch with an action. */
    const entriesOf = async (branch: string, action: string) =>
      (
        await t.database.migrator
          .selectFrom('audit_log')
          .select('id')
          .where('branch_id', '=', branch)
          .where('action', '=', action)
          .execute()
      ).length;

    /** The lessons of the branch in a room, not cancelled. */
    const lessonsIn = async (branch: string, room: string) =>
      (
        await t.database.migrator
          .selectFrom('lessons')
          .select('id')
          .where('branch_id', '=', branch)
          .where('room_id', '=', room)
          .where('cancel_cause', 'is', null)
          .execute()
      ).length;

    /** A draft of the scene's year from the second quarter, held by the Super Admin. */
    async function draftOf(s: PublishedScene): Promise<string> {
      const created = await t.post('/api/timetable/versions', s.branch, {
        academicYearId: s.year,
        startsOn: '2026-11-09',
        copyFrom: null,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      return (created.body as { id: string }).id;
    }

    interface Writer {
      /** The writer's request, naming the room. */
      readonly send: () => Promise<Response>;
      /** The status of the writer's own success. */
      readonly status: number;
      /** What the writer writes: its rows and its entries, as a count. */
      readonly written: () => Promise<number>;
    }

    const WRITERS: Readonly<Record<string, (s: PublishedScene, room: string) => Promise<Writer>>> =
      {
        'a room closure': (s, room) =>
          Promise.resolve({
            send: () =>
              t.post('/api/timetable/room-closures', s.branch, {
                roomId: room,
                startsOn: '2026-10-19',
                endsOn: '2026-10-23',
                reason: 'Repairs',
              }),
            status: 201,
            written: async () =>
              (
                await t.database.migrator
                  .selectFrom('room_closures')
                  .select('id')
                  .where('room_id', '=', room)
                  .execute()
              ).length + (await entriesOf(s.branch, 'room_closure.create')),
          }),
        '"move all" of a closure into the room': async (s, room) => {
          // The class's home room closed for a week; its lessons there go to the room.
          const closed = await t.post('/api/timetable/room-closures', s.branch, {
            roomId: s.room,
            startsOn: '2026-10-19',
            endsOn: '2026-10-23',
            reason: 'Repairs',
          });
          expect(closed.status, JSON.stringify(closed.body)).toBe(201);
          const closure = (closed.body as { id: string }).id;
          expect(await lessonsIn(s.branch, s.room)).toBeGreaterThan(0);
          return {
            send: () =>
              t.post(`/api/timetable/room-closures/${closure}/move`, s.branch, {
                roomId: room,
                reason: 'Repairs',
              }),
            status: 200,
            written: async () =>
              (await lessonsIn(s.branch, room)) +
              (await entriesOf(s.branch, 'room_closure.move')) +
              (await entriesOf(s.branch, 'lesson.room_change')),
          };
        },
        'an exam room': (s, room) =>
          Promise.resolve({
            send: () =>
              keyed(
                '/api/timetable/exams',
                s.branch,
                {
                  date: '2026-10-19',
                  firstLesson: 2,
                  lastLesson: 2,
                  title: 'Quarter exam',
                  subjectId: null,
                  rooms: [
                    {
                      roomId: room,
                      classIds: [s.classId],
                      groupIds: [],
                      invigilatorIds: [s.teacher.staffId],
                    },
                  ],
                  blockChoices: [],
                  confirm: true,
                },
                t.admin,
                randomUUID(),
              ),
            status: 201,
            written: async () =>
              (
                await t.database.migrator
                  .selectFrom('exams')
                  .select('id')
                  .where('branch_id', '=', s.branch)
                  .execute()
              ).length + (await entriesOf(s.branch, 'exam.create')),
          }),
        'a load row': async (s, room) => {
          const draft = await draftOf(s);
          return {
            send: () =>
              t.post(`/api/timetable/versions/${draft}/load`, s.branch, {
                classId: s.classId,
                groupId: null,
                subjectId: s.subject,
                teacherId: s.teacher.staffId,
                lessonsPerWeek: 1,
                roomId: room,
                roomType: null,
                doubleLessons: false,
              }),
            status: 201,
            written: async () =>
              (
                await t.database.migrator
                  .selectFrom('teaching_load_rows')
                  .select('id')
                  .where('version_id', '=', draft)
                  .execute()
              ).length + (await entriesOf(s.branch, 'teaching_load.create')),
          };
        },
        "a class's home room": async (s, room) => {
          const before = await t.database.migrator
            .selectFrom('classes')
            .select(['grade', 'name', 'language', 'max_size', 'version', 'main_room_id'])
            .where('id', '=', s.classId)
            .executeTakeFirstOrThrow();
          // The class's home room before the race is another room.
          expect(before.main_room_id).toBe(s.room);
          return {
            send: () =>
              t.put(`/api/classes/${s.classId}`, s.branch, {
                grade: before.grade,
                name: before.name,
                language: before.language,
                mainRoomId: room,
                maxSize: before.max_size,
                version: before.version,
              }),
            status: 200,
            written: async () =>
              (
                await t.database.migrator
                  .selectFrom('classes')
                  .select('id')
                  .where('main_room_id', '=', room)
                  .execute()
              ).length + (await entriesOf(s.branch, 'class.edit')),
          };
        },
        'a pattern entry': async (s, room) => {
          const draft = await draftOf(s);
          // The row names no room: the room comes from the request only.
          const row = await load.row({
            branch_id: s.branch,
            version_id: draft,
            class_id: s.classId,
            subject_id: s.subject,
            teacher_id: s.teacher.staffId,
            lessons_per_week: 1,
          });
          return {
            send: () =>
              t.post(`/api/timetable/versions/${draft}/pattern`, s.branch, {
                loadRowId: row,
                weekday: 2,
                slotPosition: 1,
                roomId: room,
              }),
            status: 201,
            written: async () =>
              (
                await t.database.migrator
                  .selectFrom('pattern_entries')
                  .select('id')
                  .where('version_id', '=', draft)
                  .execute()
              ).length + (await entriesOf(s.branch, 'pattern_block.create')),
          };
        },
      };

    for (const [name, writerOf] of Object.entries(WRITERS)) {
      it(`${name}: the delete first answers the writer 404 with nothing written; the writer first refuses the delete`, async () => {
        for (const deleteFirst of [true, false]) {
          const s = await publishedScene(t, load);
          // A room nothing references before the race.
          const room = (await place(s.branch)).room;
          const writer = await writerOf(s, room);
          const before = await writer.written();
          const deleteRoom = () => forceDelete(s.branch, 'room', room);
          const [one, two] = await behindRoom(
            s.branch,
            room,
            deleteFirst ? deleteRoom : writer.send,
            deleteFirst ? writer.send : deleteRoom,
          );
          const [deleted, written] = deleteFirst ? [one, two] : [two, one];
          if (deleteFirst) {
            done(deleted);
            refusedWith(written, 404, 'not_found');
            expect(await writer.written()).toBe(before);
            expect(await rowOf('room', room)).toBeUndefined();
          } else {
            expect(written.status, JSON.stringify(written.body)).toBe(writer.status);
            expect(await writer.written()).toBeGreaterThan(before);
            refusedWith(deleted, 409, 'place_referenced');
            expect(await rowOf('room', room)).toBeDefined();
            const stored = await t.database.migrator
              .selectFrom('forced_deletes')
              .select('id')
              .where('record_id', '=', room)
              .execute();
            expect(stored).toEqual([]);
          }
        }
      });
    }
  });
});
