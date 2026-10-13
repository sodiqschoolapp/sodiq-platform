import {
  BRANCH_HEADER,
  PHOTO_MAX_BYTES,
  studentDetailSchema,
  studentListSchema,
  type PhotoType,
  type StudentDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { relativesInput } from '../../testing/relatives-kit.js';
import { jpegOf, pngOf } from '../../testing/photos-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { MemoryPhotoStore, type PhotoStore } from './photo-store.js';

/** A store the test switches: in memory, not configured, failing, or holding every put. */
class SwitchedPhotoStore implements PhotoStore {
  readonly memory = new MemoryPhotoStore();
  mode: 'memory' | 'none' | 'fail' | 'hold' = 'memory';
  private held: (() => void)[] = [];
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

const MOMENT = new Date('2026-10-10T23:55:00+05:00');

// All names are invented. Task 2.4b-2, the plan approved on pull request #70
// with its corrections (decision 7, the shape of the staff photos of 2.2c-2):
// docs/spec/04-people.md, Student record ("Personal | Photo, ..."); the
// owner's answer 2; edge/people-roles-accounts (Basic: "name, class, photo,
// UID: all staff of the branch"); edge/system-behaviour ("Only that function
// fails").
describe('student photos', () => {
  let t: DayTemplatesKit;
  const store = new SwitchedPhotoStore();
  let viewers: string[];
  let nurse: string;
  let count = 0;

  const JPEG = jpegOf(600, 800);
  const PNG = pngOf(300, 200);

  const upload = (
    id: string,
    bytes: Buffer,
    options: { type?: string; branch?: string; cookie?: string } = {},
  ) =>
    request(t.kit.server)
      .put(`/api/people/students/${id}/photo`)
      .set('Cookie', options.cookie ?? t.admin)
      .set(BRANCH_HEADER, options.branch ?? t.north)
      .set('Content-Type', options.type ?? 'image/jpeg')
      .send(bytes);

  const remove = (id: string, options: { branch?: string; cookie?: string } = {}) =>
    request(t.kit.server)
      .delete(`/api/people/students/${id}/photo`)
      .set('Cookie', options.cookie ?? t.admin)
      .set(BRANCH_HEADER, options.branch ?? t.north);

  const photoOf = (id: string, options: { branch?: string; cookie?: string } = {}) =>
    request(t.kit.server)
      .get(`/api/people/students/${id}/photo`)
      .set('Cookie', options.cookie ?? t.admin)
      .set(BRANCH_HEADER, options.branch ?? t.north)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const bytes = Buffer.concat(chunks);
          const json = String(response.headers['content-type']).startsWith('application/json');
          done(null, json ? (JSON.parse(bytes.toString('utf8')) as unknown) : bytes);
        });
      });

  const refusedWith = (response: Response, status: number, code: string) => {
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(errorCode(response)).toBe(code);
  };

  /** A student of a branch, made through the route; without a scholarship, so it can be deleted. */
  async function student(branch = t.north): Promise<StudentDetail> {
    count += 1;
    const response = await t.post('/api/people/students', branch, {
      uid: String(2607800 + count),
      confirmUidSet: false,
      firstName: 'Zarina',
      lastName: `Qosimova${'a'.repeat(count % 9)}`,
      paternalName: '',
      sex: 'female',
      birthDate: `2014-05-${String((count % 28) + 1).padStart(2, '0')}`,
      grade: 7,
      startsOn: '2026-09-02',
      documentType: null,
      documentNumber: '',
      jshshir: '',
      phone: '',
      email: '',
      address: '',
      region: null,
      previousSchool: '',
      diagnosticScore: null,
      scholarship: { type: 'none', coverage: null, amount: null },
      consentSignedOn: null,
      contract: { number: `PH-2026/${String(count)}`, signedOn: '2026-08-22' },
      relatives: relativesInput(),
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  /** Every row the photo routes write, in both branches, the audit count and the stored keys. */
  async function snapshot(): Promise<Record<string, unknown>> {
    return {
      audit: await t.auditCount(),
      students: (await sql`select * from students order by id`.execute(t.database.migrator)).rows,
      keys: store.memory.keys(),
    };
  }

  const photoColumns = (id: string) =>
    t.database.migrator
      .selectFrom('students')
      .select(['photo_id', 'photo_type'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  async function signedIn(first: string, last: string, role: string, branchId: string | null) {
    const browser = await t.kit.fullSession(first, last);
    await t.kit.giveRole(browser.account.id, {
      role: role as never,
      ...(branchId === null ? {} : { branchId }),
    });
    return browser.cookie;
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ photoStore: store });
    for (const branch of [t.north, t.south]) {
      await t.database.migrator.transaction().execute(async (transaction) => {
        const year = await transaction
          .insertInto('academic_years')
          .values({ branch_id: branch, start_date: '2026-09-01', end_date: '2027-05-31' })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const number of [1, 2, 3, 4]) {
          await transaction
            .insertInto('quarters')
            .values({ branch_id: branch, academic_year_id: year.id, number })
            .execute();
        }
      });
    }
    viewers = [
      await signedIn('Gulnora', 'Tosheva', 'spiritual_vice_principal', t.north),
      await signedIn('Malika', 'Yusupova', 'head_tutor', t.north),
      await signedIn('Sardor', 'Rahimov', 'tutor', t.north),
      await signedIn('Feruza', 'Nazarova', 'head_teacher', t.north),
      await signedIn('Nodir', 'Usmonov', 'senior_head_teacher', null),
    ];
    nurse = await signedIn('Shahlo', 'Qodirova', 'nurse', t.north);
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
      const { id } = await student();
      expect((await upload(id, JPEG)).status).toBe(204);
      const stored = await photoColumns(id);
      expect(stored).toEqual({ photo_id: expect.any(String) as unknown, photo_type: 'image/jpeg' });
      expect(store.memory.keys()).toContain(`students/${id}/${String(stored.photo_id)}`);

      const detail = studentDetailSchema.parse(
        (await t.get(`/api/people/students/${id}`, t.north)).body,
      );
      expect(detail.photoId).toBe(stored.photo_id);
      const list = studentListSchema.parse((await t.get('/api/people/students', t.north)).body);
      expect(list.students.find((one) => one.id === id)?.photoId).toBe(stored.photo_id);

      const photo = await photoOf(id);
      expect(photo.status).toBe(200);
      expect(photo.headers['content-type']).toBe('image/jpeg');
      expect(photo.headers['cache-control']).toBe('no-store');
      expect(Buffer.compare(photo.body as Buffer, JPEG)).toBe(0);

      const [entry] = await t.entries('student.photo', id);
      expect(entry).toMatchObject({
        branch_id: t.north,
        assignment_id: t.adminAssignment,
        request_id: expect.any(String) as unknown,
        old_value: { photoId: null },
        new_value: {
          photoId: stored.photo_id,
          type: 'image/jpeg',
          width: 600,
          height: 800,
          bytes: JPEG.length,
        },
      });
    });

    it('lets the Academic Vice Principal replace it with a PNG; the old object stays', async () => {
      const { id } = await student();
      await upload(id, JPEG);
      const first = (await photoColumns(id)).photo_id;
      const response = await upload(id, PNG, { type: 'image/png', cookie: t.vicePrincipal });
      expect(response.status, JSON.stringify(response.body)).toBe(204);
      const second = (await photoColumns(id)).photo_id;
      expect(second).not.toBe(first);
      expect(store.memory.keys()).toEqual(
        expect.arrayContaining([
          `students/${id}/${String(first)}`,
          `students/${id}/${String(second)}`,
        ]),
      );
      const entries = await t.entries('student.photo', id);
      expect(entries[1]).toMatchObject({
        assignment_id: t.viceAssignment,
        old_value: { photoId: first },
        new_value: { photoId: second, type: 'image/png', width: 300, height: 200 },
      });
    });

    // The Basic group: every reader of the list sees the photo; reading it is not audited.
    it('shows the photo to every reader of the list, without an audit entry', async () => {
      const { id } = await student();
      await upload(id, JPEG);
      const before = await t.auditCount();
      for (const cookie of [t.admin, t.principal, t.vicePrincipal, ...viewers]) {
        const photo = await photoOf(id, { cookie });
        expect(photo.status, cookie).toBe(200);
        expect(Buffer.compare(photo.body as Buffer, JPEG)).toBe(0);
      }
      expect(await t.auditCount()).toBe(before);
    });

    it('sets a photo on an inactive student', async () => {
      const someone = await student();
      const left = await t.post(`/api/people/students/${someone.id}/leaving`, t.north, {
        lastDay: '2026-10-01',
        reason: 'The family moved to another city.',
        version: someone.version,
      });
      expect(left.status, JSON.stringify(left.body)).toBe(200);
      expect((await upload(someone.id, JPEG)).status).toBe(204);
    });

    it('removes a photo, audits it once, and then answers 404 for it', async () => {
      const { id } = await student();
      await upload(id, JPEG);
      const { photo_id: photoId } = await photoColumns(id);
      expect((await remove(id, { cookie: t.vicePrincipal })).status).toBe(204);
      expect(await photoColumns(id)).toEqual({ photo_id: null, photo_type: null });
      refusedWith(await photoOf(id), 404, 'not_found');
      const before = await t.auditCount();
      expect((await remove(id)).status).toBe(204);
      expect(await t.auditCount()).toBe(before);
      expect((await t.entries('student.photo', id)).at(-1)).toMatchObject({
        assignment_id: t.viceAssignment,
        old_value: { photoId },
        new_value: { photoId: null },
      });
    });

    it('takes a photo of exactly 5,000,000 bytes', async () => {
      const { id } = await student();
      const bytes = Buffer.concat([JPEG, Buffer.alloc(PHOTO_MAX_BYTES - JPEG.length)]);
      expect((await upload(id, bytes)).status).toBe(204);
    });

    // The delete of a student created twice keeps the photo's id in its entry.
    it('names the photo in the audit entry of the delete of a student created twice', async () => {
      const someone = await student();
      await upload(someone.id, JPEG);
      const { photo_id: photoId } = await photoColumns(someone.id);
      const deleted = await t.post(`/api/people/students/${someone.id}/delete`, t.north, {
        reason: 'Created twice by mistake.',
        version: someone.version,
      });
      expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);
      const [entry] = await t.entries('student.delete', someone.id);
      expect((entry?.old_value as { student: Record<string, unknown> }).student).toMatchObject({
        photo_id: photoId,
        photo_type: 'image/jpeg',
      });
      expect(store.memory.keys()).toContain(`students/${someone.id}/${String(photoId)}`);
    });
  });

  describe('refusals', () => {
    // Correction 2 of the review: every photo route has its refusals.
    it('refuses a change to the Principal and every view-only role, and the photo to a role that reads no student', async () => {
      const { id } = await student();
      await upload(id, JPEG);
      const before = await snapshot();
      for (const cookie of [t.principal, ...viewers, t.teacher, nurse]) {
        refusedWith(await upload(id, PNG, { type: 'image/png', cookie }), 403, 'permission_denied');
        refusedWith(await remove(id, { cookie }), 403, 'permission_denied');
      }
      for (const cookie of [t.teacher, nurse]) {
        refusedWith(await photoOf(id, { cookie }), 403, 'permission_denied');
      }
      expect(await snapshot()).toEqual(before);
    });

    // .claude/rules/api.md: another branch's id and an unknown one are 404 and
    // change nothing, in either branch, on each route.
    it('answers 404 for a student of another branch and an unknown id on each route, also with no store', async () => {
      const there = await student(t.south);
      await upload(there.id, JPEG, { branch: t.south });
      for (const mode of ['memory', 'none'] as const) {
        store.mode = mode;
        const before = await snapshot();
        for (const id of [there.id, UNKNOWN]) {
          for (const cookie of [t.admin, t.vicePrincipal]) {
            refusedWith(await upload(id, JPEG, { cookie }), 404, 'not_found');
            refusedWith(await remove(id, { cookie }), 404, 'not_found');
            refusedWith(await photoOf(id, { cookie }), 404, 'not_found');
          }
          refusedWith(
            await request(t.kit.server)
              .put(`/api/people/students/${id}/photo`)
              .set('Cookie', t.admin)
              .set(BRANCH_HEADER, t.north)
              .send({ photo: 'not a file' }),
            404,
            'not_found',
          );
          refusedWith(await photoOf(id, { cookie: t.principal }), 404, 'not_found');
        }
        expect(await snapshot()).toEqual(before);
      }
    });

    it('refuses a body that is not a JPEG or PNG file', async () => {
      const { id } = await student();
      const before = await snapshot();
      const send = (type: string, body: string | Buffer) =>
        request(t.kit.server)
          .put(`/api/people/students/${id}/photo`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, t.north)
          .set('Content-Type', type)
          .send(body);
      refusedWith(
        await send('application/json', JSON.stringify({ bytes: [1, 2] })),
        415,
        'unsupported_media_type',
      );
      refusedWith(await send('image/gif', Buffer.from('GIF89a')), 415, 'unsupported_media_type');
      refusedWith(await send('image/jpeg', Buffer.alloc(0)), 415, 'unsupported_media_type');
      refusedWith(
        await request(t.kit.server)
          .put(`/api/people/students/${id}`)
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
      const { id } = await student();
      const before = await snapshot();
      refusedWith(await upload(id, Buffer.from('not a photo at all')), 400, 'photo_invalid');
      refusedWith(await upload(id, JPEG, { type: 'image/png' }), 400, 'photo_invalid');
      refusedWith(await upload(id, jpegOf(801, 600)), 400, 'photo_invalid');
      expect(await snapshot()).toEqual(before);
    });

    it('refuses 5,000,001 bytes with its own code, also for a Teacher', async () => {
      const { id } = await student();
      const bytes = Buffer.concat([JPEG, Buffer.alloc(PHOTO_MAX_BYTES + 1 - JPEG.length)]);
      const before = await snapshot();
      refusedWith(await upload(id, bytes), 413, 'photo_too_large');
      refusedWith(await upload(id, bytes, { cookie: t.teacher }), 413, 'photo_too_large');
      expect(await snapshot()).toEqual(before);
    });

    it('says photos are not configured when there is no store, and the record still answers', async () => {
      const { id } = await student();
      await upload(id, JPEG);
      store.mode = 'none';
      const before = await snapshot();
      refusedWith(await upload(id, PNG, { type: 'image/png' }), 503, 'photos_not_configured');
      refusedWith(await photoOf(id), 503, 'photos_not_configured');
      expect((await t.get(`/api/people/students/${id}`, t.north)).status).toBe(200);
      expect(await snapshot()).toEqual(before);
    });

    it('answers photos_unavailable when the store fails, and changes nothing', async () => {
      const { id } = await student();
      await upload(id, JPEG);
      store.mode = 'fail';
      const before = await snapshot();
      refusedWith(await upload(id, PNG, { type: 'image/png' }), 503, 'photos_unavailable');
      refusedWith(await photoOf(id), 503, 'photos_unavailable');
      expect(await snapshot()).toEqual(before);
    });

    it('holds no lock on the student while the store does not answer', async () => {
      const { id } = await student();
      store.mode = 'hold';
      const pending = upload(id, JPEG).then((response) => response);
      await store.held$();
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`set local lock_timeout = '1s'`.execute(transaction);
        await transaction
          .selectFrom('students')
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

  // .claude/rules/api.md: the real route on the side whose order is proved, both directions.
  describe('at the same moment as the delete of the student', () => {
    async function untilSomeoneWaits(): Promise<void> {
      for (let tries = 0; tries < 200; tries += 1) {
        const found = await sql<{ waiting: number }>`
          select count(distinct l.pid)::int as waiting
          from pg_locks l join pg_stat_activity a on a.pid = l.pid
          where a.datname = current_database() and not l.granted
        `.execute(t.database.migrator);
        if ((found.rows[0]?.waiting ?? 0) > 0) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('Nobody waited for the lock.');
    }

    it('answers 404 to an upload that waited for a delete of the student', async () => {
      const { id } = await student();
      const before = await t.auditCount();
      let pending: Promise<Response> | undefined;
      await t.database.migrator.transaction().execute(async (transaction) => {
        // What the delete does: the student locked, then deleted with the moment of the transaction.
        await sql`select set_config('app.now', ${MOMENT.toISOString()}, true)`.execute(transaction);
        await transaction
          .selectFrom('students')
          .select('id')
          .where('id', '=', id)
          .forUpdate()
          .execute();
        pending = upload(id, JPEG).then((response) => response);
        await untilSomeoneWaits();
        await transaction.deleteFrom('students').where('id', '=', id).execute();
      });
      if (pending === undefined) {
        throw new Error('The upload was not sent.');
      }
      refusedWith(await pending, 404, 'not_found');
      expect(await t.auditCount()).toBe(before);
    });

    it('makes the delete wait for a photo being set, and names that photo in its entry', async () => {
      const someone = await student();
      const photoId = '0199a000-0000-7000-8000-0000000000aa';
      let pending: Promise<Response> | undefined;
      await t.database.migrator.transaction().execute(async (transaction) => {
        // What the photo route does in its transaction: the student locked, the photo written.
        await transaction
          .selectFrom('students')
          .select('id')
          .where('id', '=', someone.id)
          .forUpdate()
          .execute();
        await transaction
          .updateTable('students')
          .set({ photo_id: photoId, photo_type: 'image/jpeg' })
          .where('id', '=', someone.id)
          .execute();
        pending = t
          .post(`/api/people/students/${someone.id}/delete`, t.north, {
            reason: 'Created twice by mistake.',
            version: someone.version,
          })
          .then((response) => response);
        await untilSomeoneWaits();
      });
      if (pending === undefined) {
        throw new Error('The delete was not sent.');
      }
      expect((await pending).status).toBe(204);
      const [entry] = await t.entries('student.delete', someone.id);
      expect((entry?.old_value as { student: Record<string, unknown> }).student).toMatchObject({
        photo_id: photoId,
      });
    });
  });
});
