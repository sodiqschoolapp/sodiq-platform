import type { INestApplication } from '@nestjs/common';
import {
  apiErrorSchema,
  BRANCH_HEADER,
  classDetailSchema,
  classListSchema,
  type ClassDetail,
} from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { ClassesKit } from '../../testing/classes-kit.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { errorCode, signInKit, type SignInKit } from '../../testing/sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { binary, fileOf } from '../../testing/xlsx-kit.js';

/** Wednesday 14 October 2026, 10:00 in Tashkent. */
const START = '2026-10-14T10:00:00+05:00';
const UNKNOWN = '0199a000-0000-7000-8000-000000000099';

const detailOf = (response: Response): ClassDetail => classDetailSchema.parse(response.body);

// All names are invented.
// docs/spec/05-classes-groups-subjects.md, Class: "Grade (1–11), name
// (Oxford, Princeton), language of instruction (Uzbek or Russian), tutor,
// main classroom, maximum size, academic year. A class is shown as grade and
// name: 7 Oxford." "There are no class codes such as 7-A. The name is unique
// within a branch, grade and year." Task 3.1a, pull request #88: the area
// `classes` (decision 5), the year (decision 6), the room (decision 7), the
// archive (decision 10), a closed year (decision 18).
describe('classes', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let kit: SignInKit;
  let classes: ClassesKit;
  let north: string;
  let south: string;
  let northYear: string;
  let southYear: string;
  let northRoom: string;
  let southRoom: string;
  let admin: string;
  let vice: string;
  let viceAssignment: string;
  let principal: string;
  let readers: { role: string; cookie: string }[];
  let count = 0;
  const clock = new FixedClock(START);

  const get = (path: string, cookie = vice, branch = north) =>
    kit.get(path, cookie).set(BRANCH_HEADER, branch);
  const post = (path: string, body: object = {}, cookie = vice, branch = north) =>
    kit.post(path, cookie).set(BRANCH_HEADER, branch).send(body);
  const put = (path: string, body: object, cookie = vice, branch = north) =>
    request(kit.server).put(path).set('Cookie', cookie).set(BRANCH_HEADER, branch).send(body);

  const auditCount = async () =>
    Number(
      (
        await database.migrator
          .selectFrom('audit_log')
          .select((builder) => builder.fn.countAll().as('count'))
          .executeTakeFirstOrThrow()
      ).count,
    );
  const entries = (action: string, recordId: string) =>
    database.migrator
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', action)
      .where('record_id', '=', recordId)
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();
  /** Every row of the tables the class routes write, in both branches. */
  const rowsOf = () =>
    Promise.all([
      database.migrator.selectFrom('classes').selectAll().orderBy('id').execute(),
      database.migrator.selectFrom('class_tutors').selectAll().orderBy('id').execute(),
      auditCount(),
    ]);

  const body = (fields: object = {}) => {
    count += 1;
    return {
      academicYearId: northYear,
      grade: 7,
      name: `Oxford ${'abcdefghijklmnopqrstuvwxyz'[count % 26] ?? 'a'}${'z'.repeat(Math.floor(count / 26))}`,
      language: 'uz',
      mainRoomId: northRoom,
      maxSize: 25,
      ...fields,
    };
  };
  const recordOf = (one: ClassDetail) => ({
    grade: one.grade,
    name: one.name,
    language: one.language,
    mainRoomId: one.mainRoom?.id ?? null,
    maxSize: one.maxSize,
    version: one.version,
  });

  async function create(fields: object = {}, cookie = vice): Promise<ClassDetail> {
    const response = await post('/api/classes', body(fields), cookie);
    expect(response.status).toBe(201);
    return detailOf(response);
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    classes = new ClassesKit(database.migrator);
    northYear = await classes.year(north);
    southYear = await classes.year(south);
    northRoom = await classes.room(north);
    southRoom = await classes.room(south);
    app = await createTestApp({ database: database.app, clock });
    kit = signInKit(app);
    const adminBrowser = await kit.completeSession('Aziza', 'Karimova');
    await kit.giveRole(adminBrowser.account.id, { role: 'super_admin' });
    admin = adminBrowser.cookie;
    const viceBrowser = await kit.completeSession('Dilnoza', 'Saidova');
    viceAssignment = (
      await kit.giveRole(viceBrowser.account.id, {
        role: 'academic_vice_principal',
        branchId: north,
      })
    ).id;
    vice = viceBrowser.cookie;
    const signedIn = async (first: string, last: string, role: string) => {
      const browser = await kit.completeSession(first, last);
      await kit.giveRole(browser.account.id, { role: role as never, branchId: north });
      return browser.cookie;
    };
    principal = await signedIn('Bobur', 'Aliyev', 'principal');
    readers = [
      { role: 'principal', cookie: principal },
      {
        role: 'spiritual_vice_principal',
        cookie: await signedIn('Kamola', 'Rahimova', 'spiritual_vice_principal'),
      },
      { role: 'head_tutor', cookie: await signedIn('Lola', 'Nazarova', 'head_tutor') },
      { role: 'head_teacher', cookie: await signedIn('Otabek', 'Yusupov', 'head_teacher') },
    ];
  });

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  describe('the list and the record', () => {
    it('answers the classes of the branch with year, room and no Tutor', async () => {
      const created = await create({ name: 'Cambridge', grade: 5 });
      await classes.schoolClass(south, southYear, { name: 'Southern' });
      const list = classListSchema.parse((await get('/api/classes').expect(200)).body);
      const found = list.classes.find((one) => one.id === created.id);
      expect(found).toMatchObject({
        grade: 5,
        name: 'Cambridge',
        language: 'uz',
        yearName: '2026–2027',
        yearStatus: 'current',
        mainRoom: { id: northRoom, status: 'in_use' },
        maxSize: 25,
        tutor: null,
        acting: null,
        archived: false,
      });
      expect(list.classes.some((one) => one.name === 'Southern')).toBe(false);
      expect(detailOf(await get(`/api/classes/${created.id}`).expect(200)).tutors).toEqual([]);
    });

    it('is read by every reader of 02 and refused to the others', async () => {
      const created = await create();
      for (const reader of readers) {
        expect((await get('/api/classes', reader.cookie)).status, reader.role).toBe(200);
        expect((await get(`/api/classes/${created.id}`, reader.cookie)).status).toBe(200);
      }
      const teacher = await kit.completeSession('Sardor', 'Ergashev');
      await kit.giveRole(teacher.account.id, { role: 'teacher', branchId: north });
      const tutor = await kit.completeSession('Malika', 'Qodirova');
      await kit.giveRole(tutor.account.id, { role: 'tutor', branchId: north });
      for (const cookie of [teacher.cookie, tutor.cookie]) {
        expect(errorCode(await get('/api/classes', cookie).expect(403))).toBe('permission_denied');
        expect(errorCode(await get(`/api/classes/${created.id}`, cookie).expect(403))).toBe(
          'permission_denied',
        );
      }
    });

    it("answers 404 for another branch's class and an unknown one, with nothing changed", async () => {
      const southern = await classes.schoolClass(south, southYear, { name: 'Unseen' });
      const before = await rowsOf();
      for (const cookie of [vice, admin]) {
        for (const id of [southern, UNKNOWN]) {
          expect(errorCode(await get(`/api/classes/${id}`, cookie).expect(404))).toBe('not_found');
          expect(
            errorCode(
              await put(`/api/classes/${id}`, { ...body(), version: 0 }, cookie).expect(404),
            ),
          ).toBe('not_found');
          for (const action of ['archive', 'restore']) {
            expect(
              errorCode(await post(`/api/classes/${id}/${action}`, {}, cookie).expect(404)),
            ).toBe('not_found');
          }
        }
      }
      expect(await rowsOf()).toEqual(before);
    });

    // Correction 7: the candidates are not answered as an unknown class.
    it('answers the Tutor candidates on their own path, not as a class', async () => {
      const response = await get('/api/classes/tutor-candidates').expect(200);
      expect(response.body).toHaveProperty('candidates');
    });
  });

  describe('the create', () => {
    it('creates a class with its audit entry, for the Academic Vice Principal and the Super Admin', async () => {
      for (const [cookie, label] of [
        [vice, 'vice'],
        [admin, 'admin'],
      ] as const) {
        const response = await post(
          '/api/classes',
          body({ name: `Harvard ${label}` }),
          cookie,
        ).expect(201);
        const created = detailOf(response);
        const [entry] = await entries('class.create', created.id);
        expect(entry).toMatchObject({
          branch_id: north,
          action: 'class.create',
          record_type: 'class',
          request_id: response.headers['x-request-id'],
          new_value: {
            academicYearId: northYear,
            grade: 7,
            name: `Harvard ${label}`,
            language: 'uz',
            mainRoomId: northRoom,
            maxSize: 25,
          },
        });
        if (label === 'vice') {
          expect(entry?.assignment_id).toBe(viceAssignment);
        }
      }
    });

    it('is refused to the readers, with no row and no entry', async () => {
      const before = await rowsOf();
      for (const reader of readers) {
        expect(
          errorCode(await post('/api/classes', body(), reader.cookie).expect(403)),
          reader.role,
        ).toBe('permission_denied');
      }
      expect(await rowsOf()).toEqual(before);
    });

    it('refuses a code such as 7-A, a one-letter name, a digit outside 0 to 9 and a size outside 1 to 60', async () => {
      for (const fields of [
        { name: '7-A' },
        { name: 'A' },
        { name: 'Oxford²' },
        { maxSize: 0 },
        { maxSize: 61 },
      ]) {
        const response = await post('/api/classes', body(fields)).expect(400);
        expect(errorCode(response)).toBe('validation_failed');
      }
    });

    it('answers 404 for a year or a room of another branch or unknown, with nothing written', async () => {
      const before = await rowsOf();
      for (const fields of [
        { academicYearId: southYear },
        { academicYearId: UNKNOWN },
        { mainRoomId: southRoom },
        { mainRoomId: UNKNOWN },
      ]) {
        expect(errorCode(await post('/api/classes', body(fields), admin).expect(404))).toBe(
          'not_found',
        );
      }
      expect(await rowsOf()).toEqual(before);
    });

    // 05: "The name is unique within a branch, grade and year"; decisions 3 and 4.
    it('refuses a taken name, also typed with Cyrillic letters or in another case, naming the holder', async () => {
      const holder = await create({ name: 'Yale', grade: 9 });
      for (const name of ['yale', 'Уаle', ' YALE ']) {
        const response = await post('/api/classes', body({ name, grade: 9 })).expect(409);
        expect(errorCode(response)).toBe('already_exists');
        expect(apiErrorSchema.parse(response.body).error.details).toEqual([
          expect.objectContaining({ path: 'name', recordId: holder.id }),
        ]);
      }
      // Archived, it still holds the name, and the answer names it for its restore.
      await post(`/api/classes/${holder.id}/archive`).expect(200);
      const response = await post('/api/classes', body({ name: 'Yale', grade: 9 })).expect(409);
      expect(apiErrorSchema.parse(response.body).error.details?.[0]?.recordId).toBe(holder.id);
      // Another grade is free.
      await create({ name: 'Yale', grade: 10 });
    });

    it('refuses a closed room and a closed year', async () => {
      const closedRoom = await classes.room(north, 'closed');
      expect(
        errorCode(await post('/api/classes', body({ mainRoomId: closedRoom })).expect(409)),
      ).toBe('room_closed');
      // A branch whose current year comes after a closed one.
      const branch = await insertBranch(database.migrator, 'Later');
      const past = await classes.year(branch, 'closed', '2025-09-01', '2026-05-31');
      await classes.year(branch, 'current');
      const response = await post(
        '/api/classes',
        body({ academicYearId: past, mainRoomId: null }),
        admin,
        branch,
      );
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('class_year_closed');
    });

    it('is refused while the branch has no planned or current year', async () => {
      const empty = await insertBranch(database.migrator, 'Empty');
      const past = await classes.year(empty, 'closed', '2025-09-01', '2026-05-31');
      const response = await post('/api/classes', body({ academicYearId: past }), admin, empty);
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('class_needs_year');
    });
  });

  describe('the edit', () => {
    it('changes the fields with an entry of what changed, and nothing when nothing changed', async () => {
      const created = await create();
      const unchanged = await put(`/api/classes/${created.id}`, recordOf(created)).expect(200);
      expect(detailOf(unchanged).version).toBe(created.version);
      const response = await put(`/api/classes/${created.id}`, {
        ...recordOf(created),
        name: 'Stanford',
        maxSize: 30,
      }).expect(200);
      expect(detailOf(response)).toMatchObject({ name: 'Stanford', maxSize: 30, version: 1 });
      const [entry] = await entries('class.edit', created.id);
      expect(entry).toMatchObject({
        assignment_id: viceAssignment,
        request_id: response.headers['x-request-id'],
        old_value: { name: created.name, maxSize: 25 },
        new_value: { name: 'Stanford', maxSize: 30 },
      });
    });

    it('refuses a change made on an old state', async () => {
      const created = await create();
      await put(`/api/classes/${created.id}`, { ...recordOf(created), maxSize: 26 }).expect(200);
      const stale = await put(`/api/classes/${created.id}`, {
        ...recordOf(created),
        maxSize: 27,
      }).expect(409);
      expect(errorCode(stale)).toBe('class_changed');
    });

    it('refuses an archived class and a class of a closed year', async () => {
      const created = await create();
      await post(`/api/classes/${created.id}/archive`).expect(200);
      expect(
        errorCode(
          await put(`/api/classes/${created.id}`, { ...recordOf(created), version: 1 }).expect(409),
        ),
      ).toBe('class_archived');
      const branch = await insertBranch(database.migrator, 'Old');
      const year = await classes.year(branch, 'current', '2025-09-01', '2026-05-31');
      const old = await classes.schoolClass(branch, year, { name: 'Bygone' });
      await classes.setYear(year, 'closed');
      const read = detailOf(await get(`/api/classes/${old}`, admin, branch).expect(200));
      for (const response of [
        await put(`/api/classes/${old}`, { ...recordOf(read), maxSize: 30 }, admin, branch),
        await post(`/api/classes/${old}/archive`, {}, admin, branch),
      ]) {
        expect(response.status).toBe(409);
        expect(errorCode(response)).toBe('class_year_closed');
      }
    });

    it("answers 404 for another branch's room in the body, with nothing changed", async () => {
      const created = await create();
      const before = await rowsOf();
      for (const mainRoomId of [southRoom, UNKNOWN]) {
        expect(
          errorCode(
            await put(`/api/classes/${created.id}`, { ...recordOf(created), mainRoomId }).expect(
              404,
            ),
          ),
        ).toBe('not_found');
      }
      expect(await rowsOf()).toEqual(before);
    });

    it('is refused to the readers', async () => {
      const created = await create();
      const before = await rowsOf();
      for (const reader of readers) {
        expect(
          (await put(`/api/classes/${created.id}`, recordOf(created), reader.cookie)).status,
        ).toBe(403);
        expect((await post(`/api/classes/${created.id}/archive`, {}, reader.cookie)).status).toBe(
          403,
        );
        expect((await post(`/api/classes/${created.id}/restore`, {}, reader.cookie)).status).toBe(
          403,
        );
        if (reader.role !== 'principal') {
          const exported = await post(
            '/api/classes/export',
            { ids: [created.id], columns: ['name'], selection: 'ticked', search: '', filters: {} },
            reader.cookie,
          );
          expect(exported.status, reader.role).toBe(403);
        }
      }
      expect(await rowsOf()).toEqual(before);
    });
  });

  describe('archive and restore', () => {
    it('archives and restores with an entry each', async () => {
      const created = await create();
      const archiving = await post(`/api/classes/${created.id}/archive`).expect(200);
      expect(detailOf(archiving).archived).toBe(true);
      const restoring = await post(`/api/classes/${created.id}/restore`).expect(200);
      expect(detailOf(restoring).archived).toBe(false);
      expect(await entries('class.archive', created.id)).toEqual([
        expect.objectContaining({
          request_id: archiving.headers['x-request-id'],
          assignment_id: viceAssignment,
        }),
      ]);
      expect(await entries('class.restore', created.id)).toEqual([
        expect.objectContaining({ request_id: restoring.headers['x-request-id'] }),
      ]);
    });

    it('restores nothing in a closed year', async () => {
      const branch = await insertBranch(database.migrator, 'Older');
      const year = await classes.year(branch, 'current', '2025-09-01', '2026-05-31');
      const old = await classes.schoolClass(branch, year, { name: 'Shelved' });
      await database.migrator
        .updateTable('classes')
        .set({ archived_at: clock.now() })
        .where('id', '=', old)
        .execute();
      await classes.setYear(year, 'closed');
      const response = await post(`/api/classes/${old}/restore`, {}, admin, branch);
      expect(response.status).toBe(409);
      expect(errorCode(response)).toBe('class_year_closed');
    });
  });

  describe('the export', () => {
    it('answers 404 for a class of another branch or an unknown one, with nothing written', async () => {
      const created = await create({ name: 'Kept', grade: 3 });
      const southern = await classes.schoolClass(south, southYear, { name: 'Elsewhere' });
      const before = await rowsOf();
      for (const id of [southern, UNKNOWN]) {
        const response = await post(
          '/api/classes/export',
          {
            ids: [created.id, id],
            columns: ['name'],
            selection: 'ticked',
            search: '',
            filters: {},
          },
          principal,
        );
        expect(response.status).toBe(404);
        expect(errorCode(response)).toBe('not_found');
      }
      expect(await rowsOf()).toEqual(before);
    });

    it('writes the classes as the list shows them, with an entry, for the Principal too', async () => {
      const created = await create({ name: 'Exported', grade: 4 });
      const response = await post(
        '/api/classes/export',
        {
          ids: [created.id],
          columns: ['name', 'year', 'language', 'tutor', 'mainRoom', 'maxSize', 'status'],
          selection: 'ticked',
          search: '',
          filters: {},
        },
        principal,
      )
        .buffer(true)
        .parse(binary)
        .expect(200);
      const file = await fileOf(response);
      // The account's language: Uzbek, the default of a new account.
      expect(file.sheet.headings).toEqual([
        'Sinf',
        'Oʻquv yili',
        'Taʼlim tili',
        'Tyutor',
        'Asosiy xona',
        'Eng koʻp oʻquvchi',
        'Holati',
      ]);
      expect(file.sheet.rows[0]?.slice(0, 3)).toEqual(['4 Exported', '2026–2027', 'Oʻzbek']);
      const exported = await database.migrator
        .selectFrom('audit_log')
        .selectAll()
        .where('action', '=', 'class.export')
        .execute();
      expect(exported).toHaveLength(1);
    });
  });
});
