import {
  BRANCH_HEADER,
  PHOTO_MAX_BYTES,
  staffDetailSchema,
  staffListSchema,
  type PhotoType,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { jpegOf, pngOf } from '../../testing/photos-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { MemoryPhotoStore, type PhotoStore } from './photo-store.js';

/**
 * A store the test switches: in memory, not configured, failing, or holding
 * every put until the test lets it go.
 */
class SwitchedPhotoStore implements PhotoStore {
  readonly memory = new MemoryPhotoStore();
  mode: 'memory' | 'none' | 'fail' | 'hold' = 'memory';
  private held: (() => void)[] = [];
  /** Resolves when a put has started and is held. */
  private onHeld: (() => void) | undefined;

  get configured(): boolean {
    return this.mode !== 'none';
  }

  async put(key: string, bytes: Buffer, type: PhotoType): Promise<void> {
    if (this.mode === 'fail') {
      throw new Error('The store is down.');
    }
    if (this.mode === 'hold') {
      await new Promise<void>((resolve) => {
        this.held.push(resolve);
        this.onHeld?.();
      });
      throw new Error('The store did not answer in time.');
    }
    await this.memory.put(key, bytes, type);
  }

  get(key: string): Promise<Buffer> {
    return this.mode === 'fail'
      ? Promise.reject(new Error('The store is down.'))
      : this.memory.get(key);
  }

  deletePrefix(prefix: string): Promise<void> {
    return this.memory.deletePrefix(prefix);
  }

  /** Waits until a put is held. */
  held$(): Promise<void> {
    return this.held.length > 0
      ? Promise.resolve()
      : new Promise((resolve) => {
          this.onHeld = resolve;
        });
  }

  release(): void {
    for (const resolve of this.held.splice(0)) {
      resolve();
    }
  }
}

// All names are invented. docs/spec/04-people.md, Teacher and staff record
// ("photo") and Vacancy ("nothing personal"); the owner's answer 2; the plan
// approved on pull request #59 with its corrections; edge/system-behaviour
// ("file storage is down ... Only that function fails ... photos fall back to
// initials").
describe('staff photos', () => {
  let t: DayTemplatesKit;
  const store = new SwitchedPhotoStore();
  let academic: string;
  let steam: string;
  let count = 0;

  const JPEG = jpegOf(600, 800);
  const PNG = pngOf(300, 200);

  const upload = (
    id: string,
    bytes: Buffer,
    options: { type?: string; branch?: string; cookie?: string } = {},
  ) =>
    request(t.kit.server)
      .put(`/api/people/staff/${id}/photo`)
      .set('Cookie', options.cookie ?? t.admin)
      .set(BRANCH_HEADER, options.branch ?? t.north)
      .set('Content-Type', options.type ?? 'image/jpeg')
      .send(bytes);

  const remove = (id: string, options: { branch?: string; cookie?: string } = {}) =>
    request(t.kit.server)
      .delete(`/api/people/staff/${id}/photo`)
      .set('Cookie', options.cookie ?? t.admin)
      .set(BRANCH_HEADER, options.branch ?? t.north);

  const photoOf = (id: string, options: { branch?: string; cookie?: string } = {}) =>
    request(t.kit.server)
      .get(`/api/people/staff/${id}/photo`)
      .set('Cookie', options.cookie ?? t.admin)
      .set(BRANCH_HEADER, options.branch ?? t.north)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const bytes = Buffer.concat(chunks);
          // A refusal is the one JSON error shape; a photo stays bytes.
          const json = String(response.headers['content-type']).startsWith('application/json');
          done(null, json ? (JSON.parse(bytes.toString('utf8')) as unknown) : bytes);
        });
      });

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  /** A person of a branch, made through the route. */
  async function person(branch = t.north): Promise<string> {
    count += 1;
    const response = await t.post('/api/people/staff', branch, {
      firstName: 'Nodira',
      lastName: `Yusupova${String.fromCharCode(97 + (count % 26))}${String.fromCharCode(97 + Math.floor(count / 26))}`,
      fatherName: '',
      sex: 'female',
      birthDate: '1992-04-05',
      educationLevel: 'bachelor',
      phone: `+99893${String(2000000 + count)}`,
      email: '',
      jshshir: '',
      admissionDate: '2026-09-01',
      contractType: 'full_time',
      contractDate: '2026-09-01',
      weeklyLessons: 18,
      dailyLessons: 5,
      divisions: [{ divisionId: academic, departmentId: steam, main: true }],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return staffDetailSchema.parse(response.body).id;
  }

  /** A vacancy of the branch north, written by the migrator in one transaction as its route does. */
  async function vacancy(): Promise<string> {
    count += 1;
    return t.database.migrator.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto('staff')
        .values({ kind: 'vacancy', vacancy_name: `Chemistry vacancy ${String(count)}` })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: row.id, branch_id: t.north, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({ staff_id: row.id, division_id: academic, department_id: steam, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_languages')
        .values({ staff_id: row.id, language: 'uz' })
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: row.id, status: 'open', valid_from: '2026-10-10' })
        .execute();
      return row.id;
    });
  }

  /** Every row the photo routes write, in both branches, the audit count and the stored keys. */
  async function snapshot(): Promise<Record<string, unknown>> {
    return {
      audit: await t.auditCount(),
      staff: (await sql`select * from staff order by id`.execute(t.database.migrator)).rows,
      staff_branches: (
        await sql`select * from staff_branches order by staff_id, branch_id`.execute(
          t.database.migrator,
        )
      ).rows,
      keys: store.memory.keys(),
    };
  }

  const photoColumns = (id: string) =>
    t.database.migrator
      .selectFrom('staff')
      .select(['photo_id', 'photo_type'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  beforeAll(async () => {
    t = await dayTemplatesKit({ photoStore: store });
    const id = async (table: 'divisions' | 'departments', en: string) =>
      (
        await t.database.migrator
          .selectFrom(table)
          .select('id')
          .where('name_en', '=', en)
          .executeTakeFirstOrThrow()
      ).id;
    academic = await id('divisions', 'Academic');
    steam = await id('departments', 'STEAM');
  });

  afterEach(() => {
    store.release();
    store.mode = 'memory';
  });

  afterAll(async () => {
    await t.close();
  });

  describe('set, read and remove', () => {
    it('lets the Super Admin set a photo, shows it in the record and the list, and audits it', async () => {
      const id = await person();
      const response = await upload(id, JPEG);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const detail = staffDetailSchema.parse(response.body);
      expect(detail.photoId).toEqual(expect.any(String));
      const stored = await photoColumns(id);
      expect(stored).toEqual({ photo_id: detail.photoId, photo_type: 'image/jpeg' });
      expect(store.memory.keys()).toContain(`staff/${id}/${String(detail.photoId)}`);

      const list = staffListSchema.parse((await t.get('/api/people/staff', t.north)).body);
      expect(list.staff.find((one) => one.id === id)?.photoId).toBe(detail.photoId);

      const photo = await photoOf(id);
      expect(photo.status).toBe(200);
      expect(photo.headers['content-type']).toBe('image/jpeg');
      expect(photo.headers['cache-control']).toBe('no-store');
      expect(photo.headers['x-content-type-options']).toBe('nosniff');
      expect(photo.headers['content-disposition']).toBe('inline');
      expect(Buffer.compare(photo.body as Buffer, JPEG)).toBe(0);

      const [entry] = await t.entries('staff.photo', id);
      expect(entry).toMatchObject({
        branch_id: t.north,
        assignment_id: t.adminAssignment,
        person_id: id,
        request_id: expect.any(String) as unknown,
        old_value: { photoId: null },
        new_value: {
          photoId: detail.photoId,
          type: 'image/jpeg',
          width: 600,
          height: 800,
          bytes: JPEG.length,
        },
      });
    });

    // Decision 2 (Look first): the Academic Vice Principal of the branch too.
    it('lets the Academic Vice Principal replace it with a PNG; the old object stays', async () => {
      const id = await person();
      const first = staffDetailSchema.parse((await upload(id, JPEG)).body).photoId;
      const response = await upload(id, PNG, { type: 'image/png', cookie: t.vicePrincipal });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const second = staffDetailSchema.parse(response.body).photoId;
      expect(second).not.toBe(first);
      expect(store.memory.keys()).toEqual(
        expect.arrayContaining([`staff/${id}/${String(first)}`, `staff/${id}/${String(second)}`]),
      );
      const photo = await photoOf(id, { cookie: t.principal });
      expect(photo.status).toBe(200);
      expect(photo.headers['content-type']).toBe('image/png');
      expect(Buffer.compare(photo.body as Buffer, PNG)).toBe(0);
      const entries = await t.entries('staff.photo', id);
      expect(entries[1]).toMatchObject({
        assignment_id: t.viceAssignment,
        old_value: { photoId: first },
        new_value: { photoId: second, type: 'image/png', width: 300, height: 200 },
      });
    });

    it('removes a photo, audits it once, and then answers 404 for it', async () => {
      const id = await person();
      const photoId = staffDetailSchema.parse((await upload(id, JPEG)).body).photoId;
      expect((await remove(id, { cookie: t.vicePrincipal })).status).toBe(204);
      expect(await photoColumns(id)).toEqual({ photo_id: null, photo_type: null });
      refusedWith(await photoOf(id), 404, 'not_found');
      const before = await t.auditCount();
      expect((await remove(id)).status).toBe(204);
      expect(await t.auditCount()).toBe(before);
      const entries = await t.entries('staff.photo', id);
      expect(entries.at(-1)).toMatchObject({
        assignment_id: t.viceAssignment,
        old_value: { photoId },
        new_value: { photoId: null },
      });
    });

    it('takes a photo of exactly 5,000,000 bytes', async () => {
      const id = await person();
      const bytes = Buffer.concat([JPEG, Buffer.alloc(PHOTO_MAX_BYTES - JPEG.length)]);
      expect(bytes.length).toBe(5_000_000);
      const response = await upload(id, bytes);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
    });
  });

  describe('refusals', () => {
    it('refuses the Principal and a Teacher a change, and a Teacher the photo', async () => {
      const id = await person();
      await upload(id, JPEG);
      const before = await snapshot();
      for (const cookie of [t.principal, t.teacher]) {
        refusedWith(await upload(id, PNG, { type: 'image/png', cookie }), 403, 'permission_denied');
        refusedWith(await remove(id, { cookie }), 403, 'permission_denied');
      }
      refusedWith(await photoOf(id, { cookie: t.teacher }), 403, 'permission_denied');
      expect(await snapshot()).toEqual(before);
    });

    // 04 Vacancy, "nothing personal"; .claude/rules/api.md: another branch's
    // id and an unknown one are 404 and change nothing, in either branch.
    it('answers 404 for a vacancy, an unknown id and a person of another branch, also with no store', async () => {
      const ids = [await vacancy(), UNKNOWN, await person(t.south)];
      for (const mode of ['memory', 'none'] as const) {
        store.mode = mode;
        const before = await snapshot();
        for (const id of ids) {
          refusedWith(await upload(id, JPEG), 404, 'not_found');
          refusedWith(await upload(id, JPEG, { cookie: t.vicePrincipal }), 404, 'not_found');
          // Correction 3: the record comes before the body, also a body that is no file.
          refusedWith(
            await request(t.kit.server)
              .put(`/api/people/staff/${id}/photo`)
              .set('Cookie', t.admin)
              .set(BRANCH_HEADER, t.north)
              .send({ photo: 'not a file' }),
            404,
            'not_found',
          );
          refusedWith(await remove(id), 404, 'not_found');
          refusedWith(await remove(id, { cookie: t.vicePrincipal }), 404, 'not_found');
          refusedWith(await photoOf(id), 404, 'not_found');
          refusedWith(await photoOf(id, { cookie: t.vicePrincipal }), 404, 'not_found');
          refusedWith(await photoOf(id, { cookie: t.principal }), 404, 'not_found');
        }
        expect(await snapshot()).toEqual(before);
      }
    });

    it('refuses a body that is not a JPEG or PNG file, on this route and on others', async () => {
      const id = await person();
      const before = await snapshot();
      const send = (type: string, body: string | Buffer) =>
        request(t.kit.server)
          .put(`/api/people/staff/${id}/photo`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, t.north)
          .set('Content-Type', type)
          .send(body);
      refusedWith(
        await send('application/json', JSON.stringify({ bytes: [1, 2] })),
        415,
        'unsupported_media_type',
      );
      refusedWith(
        await send('multipart/form-data; boundary=x', '--x--'),
        415,
        'unsupported_media_type',
      );
      refusedWith(await send('text/plain', 'photo'), 415, 'unsupported_media_type');
      refusedWith(await send('image/gif', Buffer.from('GIF89a')), 415, 'unsupported_media_type');
      refusedWith(await send('image/jpeg', Buffer.alloc(0)), 415, 'unsupported_media_type');
      refusedWith(
        await request(t.kit.server)
          .put(`/api/people/staff/${id}/photo`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, t.north),
        415,
        'unsupported_media_type',
      );
      // Another route does not take an image.
      refusedWith(
        await request(t.kit.server)
          .put(`/api/people/staff/${id}`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, t.north)
          .set('Content-Type', 'image/jpeg')
          .send(JPEG),
        415,
        'unsupported_media_type',
      );
      expect(await snapshot()).toEqual(before);
    });

    it('refuses bytes that are not the declared photo, or more than 800 pixels a side', async () => {
      const id = await person();
      const before = await snapshot();
      refusedWith(await upload(id, Buffer.from('not a photo at all')), 400, 'photo_invalid');
      refusedWith(await upload(id, PNG), 400, 'photo_invalid');
      refusedWith(await upload(id, JPEG, { type: 'image/png' }), 400, 'photo_invalid');
      refusedWith(await upload(id, jpegOf(801, 600)), 400, 'photo_invalid');
      refusedWith(await upload(id, pngOf(200, 801), { type: 'image/png' }), 400, 'photo_invalid');
      expect(await snapshot()).toEqual(before);
    });

    // Correction 3: the limit is checked before the guards, whoever sends it.
    it('refuses 5,000,001 bytes with its own code, also for a Teacher', async () => {
      const id = await person();
      const bytes = Buffer.concat([JPEG, Buffer.alloc(PHOTO_MAX_BYTES + 1 - JPEG.length)]);
      const before = await snapshot();
      refusedWith(await upload(id, bytes), 413, 'photo_too_large');
      refusedWith(await upload(id, bytes, { cookie: t.teacher }), 413, 'photo_too_large');
      expect(await snapshot()).toEqual(before);
    });

    it('says photos are not configured when there is no store, and the record still answers', async () => {
      const id = await person();
      await upload(id, JPEG);
      store.mode = 'none';
      const before = await snapshot();
      refusedWith(await upload(id, PNG, { type: 'image/png' }), 503, 'photos_not_configured');
      refusedWith(await photoOf(id), 503, 'photos_not_configured');
      expect((await t.get(`/api/people/staff/${id}`, t.north)).status).toBe(200);
      expect((await t.get('/api/people/staff', t.north)).status).toBe(200);
      expect(await snapshot()).toEqual(before);
    });

    it('answers photos_unavailable when the store fails, and changes nothing', async () => {
      const id = await person();
      await upload(id, JPEG);
      store.mode = 'fail';
      const before = await snapshot();
      refusedWith(await upload(id, PNG, { type: 'image/png' }), 503, 'photos_unavailable');
      refusedWith(await photoOf(id), 503, 'photos_unavailable');
      expect(await snapshot()).toEqual(before);
    });

    // The spec review of the plan: no transaction is open while the store is called.
    it('holds no lock on the record while the store does not answer', async () => {
      const id = await person();
      store.mode = 'hold';
      const pending = upload(id, JPEG).then((response) => response);
      await store.held$();
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`set local lock_timeout = '1s'`.execute(transaction);
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', id)
          .forUpdate()
          .execute();
      });
      store.release();
      refusedWith(await pending, 503, 'photos_unavailable');
      expect(await photoColumns(id)).toEqual({ photo_id: null, photo_type: null });
    });
  });

  // .claude/rules/database.md: a branch link removed while the upload waits
  // for the record's lock is read again after the lock. .claude/rules/api.md:
  // the real route on the side whose order is proved, both directions.
  describe('at the same moment as a change of branches', () => {
    async function twoBranchPerson(): Promise<string> {
      const id = await person();
      const response = await request(t.kit.server)
        .put(`/api/people/staff/${id}/branches`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, t.north)
        .send({ mainBranchId: t.south, furtherBranchIds: [t.north] });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return id;
    }

    async function waitingForALock(): Promise<number> {
      const found = await sql<{ waiting: number }>`
        select count(distinct l.pid)::int as waiting
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and not l.granted
      `.execute(t.database.migrator);
      return found.rows[0]?.waiting ?? 0;
    }

    async function untilSomeoneWaits(): Promise<void> {
      for (let tries = 0; tries < 200; tries += 1) {
        if ((await waitingForALock()) > 0) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('Nobody waited for the lock.');
    }

    it('answers 404 when the branch link is removed while the upload waits for the record', async () => {
      const id = await twoBranchPerson();
      const before = await t.auditCount();
      let pending: Promise<Response> | undefined;
      await t.database.migrator.transaction().execute(async (transaction) => {
        // What the branches route does: the record locked, the link removed.
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', id)
          .forUpdate()
          .execute();
        await transaction
          .deleteFrom('staff_branches')
          .where('staff_id', '=', id)
          .where('branch_id', '=', t.north)
          .execute();
        pending = upload(id, JPEG, { cookie: t.vicePrincipal }).then((response) => response);
        await untilSomeoneWaits();
      });
      if (pending === undefined) {
        throw new Error('The upload was not sent.');
      }
      refusedWith(await pending, 404, 'not_found');
      expect(await photoColumns(id)).toEqual({ photo_id: null, photo_type: null });
      expect(await t.auditCount()).toBe(before);
      // The object was put before the lock: an orphan under a key never reused (decision 8).
      expect(store.memory.keys().filter((key) => key.startsWith(`staff/${id}/`))).toHaveLength(1);
    });

    it('answers 404 when the branch link is removed while a removal waits for the record', async () => {
      const id = await twoBranchPerson();
      await upload(id, JPEG);
      const before = await t.auditCount();
      const stored = await photoColumns(id);
      let pending: Promise<Response> | undefined;
      await t.database.migrator.transaction().execute(async (transaction) => {
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', id)
          .forUpdate()
          .execute();
        await transaction
          .deleteFrom('staff_branches')
          .where('staff_id', '=', id)
          .where('branch_id', '=', t.north)
          .execute();
        pending = remove(id, { cookie: t.vicePrincipal }).then((response) => response);
        await untilSomeoneWaits();
      });
      if (pending === undefined) {
        throw new Error('The removal was not sent.');
      }
      refusedWith(await pending, 404, 'not_found');
      expect(await photoColumns(id)).toEqual(stored);
      expect(await t.auditCount()).toBe(before);
    });

    it('makes the branches route wait for a photo being removed', async () => {
      const id = await twoBranchPerson();
      await upload(id, JPEG);
      let pending: Promise<Response> | undefined;
      await t.database.migrator.transaction().execute(async (transaction) => {
        // What the removal does in its transaction: the record locked, the link read for share, the photo cleared.
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', id)
          .forUpdate()
          .execute();
        await transaction
          .selectFrom('staff_branches')
          .select('staff_id')
          .where('staff_id', '=', id)
          .where('branch_id', '=', t.north)
          .forShare()
          .execute();
        await transaction
          .updateTable('staff')
          .set({ photo_id: null, photo_type: null })
          .where('id', '=', id)
          .execute();
        pending = request(t.kit.server)
          .put(`/api/people/staff/${id}/branches`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, t.north)
          .send({ mainBranchId: t.south, furtherBranchIds: [] })
          .then((response) => response);
        await untilSomeoneWaits();
      });
      if (pending === undefined) {
        throw new Error('The change of branches was not sent.');
      }
      expect((await pending).status).toBe(200);
      expect(await photoColumns(id)).toEqual({ photo_id: null, photo_type: null });
    });

    it('makes the branches route wait for a photo being set', async () => {
      const id = await twoBranchPerson();
      let pending: Promise<Response> | undefined;
      await t.database.migrator.transaction().execute(async (transaction) => {
        // What the photo route does in its transaction: the record locked, the link read for share.
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', id)
          .forUpdate()
          .execute();
        await transaction
          .selectFrom('staff_branches')
          .select('staff_id')
          .where('staff_id', '=', id)
          .where('branch_id', '=', t.north)
          .forShare()
          .execute();
        pending = request(t.kit.server)
          .put(`/api/people/staff/${id}/branches`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, t.north)
          .send({ mainBranchId: t.south, furtherBranchIds: [] })
          .then((response) => response);
        await untilSomeoneWaits();
      });
      if (pending === undefined) {
        throw new Error('The change of branches was not sent.');
      }
      expect((await pending).status).toBe(200);
      refusedWith(await upload(id, JPEG), 404, 'not_found');
    });
  });
});
