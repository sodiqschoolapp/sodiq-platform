import { BRANCH_HEADER, PHOTO_MAX_BYTES, staffDetailSchema, type PhotoType } from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { jpegOf, pngOf } from '../../testing/photos-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { MemoryPhotoStore, type PhotoStore } from './photo-store.js';

/** A store in memory that the test can switch off. */
class SwitchedPhotoStore implements PhotoStore {
  readonly memory = new MemoryPhotoStore();
  on = true;

  get configured(): boolean {
    return this.on;
  }

  put(key: string, bytes: Buffer, type: PhotoType): Promise<void> {
    return this.memory.put(key, bytes, type);
  }

  get(key: string): Promise<Buffer> {
    return this.memory.get(key);
  }
}

// All names are invented. Task 2.3c-2, pull request #66, decision 18:
// `edge/people-roles-accounts`, Accounts and sign-in ("Staff can change their
// own ... photo") and Who can act (the Principal's own account includes the
// photo). The same store, checks and entry as the staff photo of 2.2c-2.
describe('the own photo', () => {
  let t: DayTemplatesKit;
  const store = new SwitchedPhotoStore();
  let academic: string;
  let steam: string;
  let count = 0;
  const JPEG = jpegOf(600, 800);

  const upload = (cookie: string, bytes: Buffer, type = 'image/jpeg') =>
    request(t.kit.server)
      .put('/api/auth/photo')
      .set('Cookie', cookie)
      .set('Content-Type', type)
      .send(bytes);
  const remove = (cookie: string) =>
    request(t.kit.server).delete('/api/auth/photo').set('Cookie', cookie);
  const photoOf = (cookie: string) =>
    request(t.kit.server)
      .get('/api/auth/photo')
      .set('Cookie', cookie)
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

  /** A record of the branch linked to the account. */
  async function recordFor(accountId: string, branch = t.north): Promise<string> {
    count += 1;
    const created = await t.post('/api/people/staff', branch, {
      firstName: 'Nodira',
      lastName: `Saidova${String.fromCharCode(97 + (count % 26))}${String(count)}`.replace(
        /[0-9]/g,
        '',
      ),
      fatherName: '',
      sex: 'female',
      birthDate: '1988-06-07',
      educationLevel: 'bachelor',
      phone: `+99895${String(4000000 + count)}`,
      email: '',
      jshshir: '',
      admissionDate: '2026-09-01',
      contractType: 'full_time',
      contractDate: '2026-09-01',
      weeklyLessons: 18,
      dailyLessons: 5,
      divisions: [{ divisionId: academic, departmentId: steam, main: true }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = staffDetailSchema.parse(created.body).id;
    await t.database.migrator
      .updateTable('staff')
      .set({ account_id: accountId })
      .where('id', '=', id)
      .execute();
    return id;
  }

  const accountOf = async (assignment: string) =>
    (
      await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', assignment)
        .executeTakeFirstOrThrow()
    ).account_id;

  const photoEntries = (personId: string) =>
    t.database.migrator
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'staff.photo')
      .where('person_id', '=', personId)
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();

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

  afterAll(async () => {
    await t.close();
  });

  afterEach(() => {
    store.on = true;
  });

  it('is set, read and removed by a teacher, each change in the main branch log with no assignment', async () => {
    const teacher = await t.kit.fullSession('Sardor', 'Nazarov');
    await t.kit.giveRole(teacher.account.id, { role: 'teacher', branchId: t.north });
    const id = await recordFor(teacher.account.id);

    expect((await upload(teacher.cookie, JPEG)).status).toBe(204);
    const read = await photoOf(teacher.cookie);
    expect(read.status).toBe(200);
    expect(read.headers['content-type']).toBe('image/jpeg');
    expect(read.headers['cache-control']).toBe('no-store');
    expect(Buffer.compare(read.body as Buffer, JPEG)).toBe(0);
    const record = await t.database.migrator
      .selectFrom('staff')
      .select(['photo_id', 'photo_type'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(record.photo_type).toBe('image/jpeg');

    expect((await remove(teacher.cookie)).status).toBe(204);
    refusedWith(await photoOf(teacher.cookie), 404, 'not_found');
    expect((await remove(teacher.cookie)).status).toBe(204);

    const entries = await photoEntries(id);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        branch_id: t.north,
        actor_id: teacher.account.id,
        assignment_id: null,
        person_id: id,
        record_type: 'staff',
        record_id: id,
      });
    }
    expect(entries[0]?.new_value).toMatchObject({ photoId: record.photo_id, width: 600 });
    expect(entries[1]?.new_value).toEqual({ photoId: null });
  });

  it('is set by the Principal, who changes nothing else, and by a Super Admin with a record', async () => {
    const principalAccount = await t.database.migrator
      .selectFrom('assignments')
      .select('account_id')
      .where('role', '=', 'principal')
      .where('branch_id', '=', t.north)
      .executeTakeFirstOrThrow();
    const principalRecord = await recordFor(principalAccount.account_id);
    expect((await upload(t.principal, pngOf(300, 200), 'image/png')).status).toBe(204);
    expect(await photoEntries(principalRecord)).toHaveLength(1);

    const adminAccount = await accountOf(t.adminAssignment);
    const adminRecord = await recordFor(adminAccount);
    expect((await upload(t.admin, JPEG)).status).toBe(204);
    expect(await photoEntries(adminRecord)).toHaveLength(1);
  });

  it('is 404 for an account with no staff record, such as the first Super Admin', async () => {
    const nobody = await t.kit.fullSession('Ulugbek', 'Tursunov');
    refusedWith(await upload(nobody.cookie, JPEG), 404, 'not_found');
    refusedWith(await photoOf(nobody.cookie), 404, 'not_found');
    refusedWith(await remove(nobody.cookie), 404, 'not_found');
  });

  it('is refused while the first password is not changed, and without sign-in', async () => {
    const first = await t.kit.firstSession('Kamola', 'Rasulova');
    await recordFor(first.account.id);
    refusedWith(await upload(first.cookie, JPEG), 403, 'password_change_required');
    expect((await request(t.kit.server).delete('/api/auth/photo')).status).toBe(401);
  });

  it('refuses what the staff photo refuses, in the same order', async () => {
    const teacher = await t.kit.fullSession('Jasur', 'Olimov');
    const id = await recordFor(teacher.account.id);

    refusedWith(
      await upload(teacher.cookie, Buffer.alloc(PHOTO_MAX_BYTES + 1)),
      413,
      'photo_too_large',
    );
    const json = await request(t.kit.server)
      .put('/api/auth/photo')
      .set('Cookie', teacher.cookie)
      .send({ photo: 'no' });
    refusedWith(json, 415, 'unsupported_media_type');
    refusedWith(await upload(teacher.cookie, Buffer.from('not a picture')), 400, 'photo_invalid');
    refusedWith(await upload(teacher.cookie, jpegOf(900, 400)), 400, 'photo_invalid');
    store.on = false;
    refusedWith(await upload(teacher.cookie, JPEG), 503, 'photos_not_configured');
    expect(await photoEntries(id)).toHaveLength(0);
  });

  it('goes to the log of the main branch of a person of two branches', async () => {
    const teacher = await t.kit.fullSession('Aziz', 'Rahmonov');
    const id = await recordFor(teacher.account.id, t.south);
    await t.database.migrator
      .insertInto('staff_branches')
      .values({ staff_id: id, branch_id: t.north, is_main: false })
      .execute();
    expect((await upload(teacher.cookie, JPEG)).status).toBe(204);
    expect((await photoEntries(id))[0]?.branch_id).toBe(t.south);
  });

  // Should-fix 12 of the plan review: the main branch moves between the read
  // and the lock; the entry goes to the branch that is main under the lock.
  it('follows a main branch that moved while the request waited for the record', async () => {
    const teacher = await t.kit.fullSession('Bahrom', 'Qosimov');
    const id = await recordFor(teacher.account.id, t.north);
    await t.database.migrator
      .insertInto('staff_branches')
      .values({ staff_id: id, branch_id: t.south, is_main: false })
      .execute();
    const [answer] = await t.database.migrator.transaction().execute(async (held) => {
      await held.selectFrom('staff').select('id').where('id', '=', id).forUpdate().execute();
      const waiting = upload(teacher.cookie, JPEG).then((response) => response);
      let waited = false;
      for (let tries = 0; tries < 150 && !waited; tries += 1) {
        const found = await sql<{ waiting: number }>`
          select count(*)::int as waiting from pg_locks
          where locktype in ('transactionid', 'tuple') and not granted
        `.execute(t.database.migrator);
        waited = (found.rows[0]?.waiting ?? 0) > 0;
        if (!waited) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      if (!waited) {
        throw new Error('The request never waited.');
      }
      await held
        .updateTable('staff_branches')
        .set({ is_main: false })
        .where('staff_id', '=', id)
        .where('branch_id', '=', t.north)
        .execute();
      await held
        .updateTable('staff_branches')
        .set({ is_main: true })
        .where('staff_id', '=', id)
        .where('branch_id', '=', t.south)
        .execute();
      return [waiting] as const;
    });
    expect((await answer).status).toBe(204);
    const entries = await photoEntries(id);
    expect(entries.map((entry) => entry.branch_id)).toEqual([t.south]);
  });

  // The permission review of the build, should-fix 4: the routes take no id;
  // a colleague's photo and entries stay as they were, and a branch named in
  // the request changes nothing.
  it('touches only the record of the session, whatever branch the request names', async () => {
    const colleague = await t.kit.fullSession('Shirin', 'Ahmedova');
    const colleagueRecord = await recordFor(colleague.account.id);
    expect((await upload(colleague.cookie, pngOf(300, 200), 'image/png')).status).toBe(204);
    const colleagueBefore = await t.database.migrator
      .selectFrom('staff')
      .select(['photo_id', 'photo_type'])
      .where('id', '=', colleagueRecord)
      .executeTakeFirstOrThrow();

    const teacher = await t.kit.fullSession('Ilhom', 'Yoqubov');
    const id = await recordFor(teacher.account.id);
    const named = await request(t.kit.server)
      .put('/api/auth/photo')
      .set('Cookie', teacher.cookie)
      .set(BRANCH_HEADER, t.south)
      .set('Content-Type', 'image/jpeg')
      .send(JPEG);
    expect(named.status).toBe(204);
    const own = await photoOf(teacher.cookie);
    expect(Buffer.compare(own.body as Buffer, JPEG)).toBe(0);
    expect((await remove(teacher.cookie)).status).toBe(204);

    expect(
      await t.database.migrator
        .selectFrom('staff')
        .select(['photo_id', 'photo_type'])
        .where('id', '=', colleagueRecord)
        .executeTakeFirstOrThrow(),
    ).toEqual(colleagueBefore);
    expect(await photoEntries(colleagueRecord)).toHaveLength(1);
    expect((await photoEntries(id)).map((entry) => entry.branch_id)).toEqual([t.north, t.north]);
  });
});
