import { BRANCH_HEADER, buildingSchema, floorSchema, roomSchema } from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { binary, fileOf } from '../../testing/xlsx-kit.js';

// All names are invented. Task 2.2c-1, the plan approved on pull request #58
// with its corrections: the export of the lists of buildings, rooms, divisions
// and subjects that waited for it (`12`, Lists: "Every list ... export";
// edge cases, system behaviour: "Excel exports contain real numbers and
// dates"; edge cases, Personal data and the audit log: "Every export is logged
// with its filters and row count"). The clock stands at 23:55 on 10 October
// 2026 in Tashkent.
describe('the export of the setup lists', () => {
  let t: DayTemplatesKit;
  let steam: string;
  let academic: string;
  let physics: string;
  let music: string;
  let tutor: string;
  let headTeacher: string;

  const exportOf = (
    path: string,
    body: object,
    cookie = t.admin,
    branch = t.north,
  ): Promise<Response> =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .send(body)
      .buffer(true)
      .parse(binary);

  const send = (ids: string[], columns: string[]) => ({
    ids,
    columns,
    selection: 'matching',
    search: '',
    filters: {},
  });

  const refusedWith = (response: Response, status: number, code: string) => {
    const text = (response.body as Buffer).toString('utf8');
    expect(response.status, text).toBe(status);
    expect((JSON.parse(text) as { error: { code: string } }).error.code).toBe(code);
  };

  const speak = async (language: 'uz' | 'ru' | 'en') => {
    await t.database.migrator.updateTable('accounts').set({ language }).execute();
  };

  /** Every row of the tables of these lists, in both branches, and the audit log. */
  async function snapshot(): Promise<Record<string, unknown>> {
    const rows: Record<string, unknown> = {};
    for (const table of [
      'buildings',
      'floors',
      'rooms',
      'divisions',
      'departments',
      'subjects',
      'subject_daily_weights',
      'audit_log',
    ] as const) {
      rows[table] = await sql`select * from ${sql.table(table)} order by 1, 2`.execute(
        t.database.migrator,
      );
    }
    return rows;
  }

  async function building(branch: string, name: string) {
    const created = await t.post('/api/setup/buildings', branch, { name });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return buildingSchema.parse(created.body);
  }

  async function floor(branch: string, buildingId: string, name: string) {
    const created = await t.post(`/api/setup/buildings/${buildingId}/floors`, branch, { name });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return floorSchema.parse(created.body);
  }

  async function room(branch: string, floorId: string, name: string, extra: object = {}) {
    const created = await t.post('/api/setup/rooms', branch, {
      name,
      floorId,
      type: 'laboratory',
      capacity: 24,
      status: 'in_use',
      shared: false,
      maxSimultaneousLessons: null,
      ...extra,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return roomSchema.parse(created.body);
  }

  const auditAt = async (action: string) => (await t.entries(action)).at(-1);

  beforeAll(async () => {
    t = await dayTemplatesKit();
    academic = (
      await t.database.migrator
        .selectFrom('divisions')
        .select('id')
        .where('name_en', '=', 'Academic')
        .executeTakeFirstOrThrow()
    ).id;
    steam = (
      await t.database.migrator
        .selectFrom('departments')
        .select('id')
        .where('name_en', '=', 'STEAM')
        .executeTakeFirstOrThrow()
    ).id;
    const subject = async (en: string, ru: string, uz: string, journalType: string) =>
      (
        await t.database.migrator
          .insertInto('subjects')
          .values({
            name_uz: uz,
            name_ru: ru,
            name_en: en,
            department_id: steam,
            grades: [7, 8, 9],
            colour: 'green',
            journal_type: journalType,
            group_subject: journalType === 'graded',
            demanding: journalType === 'graded',
            language_rule: false,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    const tutorBrowser = await t.kit.fullSession('Sardor', 'Tursunov');
    await t.kit.giveRole(tutorBrowser.account.id, { role: 'tutor', branchId: t.north });
    tutor = tutorBrowser.cookie;
    const headBrowser = await t.kit.fullSession('Nodira', 'Qodirova');
    await t.kit.giveRole(headBrowser.account.id, { role: 'head_teacher', branchId: t.north });
    headTeacher = headBrowser.cookie;
    physics = await subject('Physics', 'Физика', 'Fizika', 'graded');
    music = await subject('Music', 'Музыка', 'Musiqa', 'attendance_only');
    // Each branch has its own daily distribution of the same subject.
    await t.database.migrator
      .insertInto('subject_daily_weights')
      .values([
        { subject_id: physics, branch_id: t.north, attendance: 10, classwork: 60, homework: 30 },
        { subject_id: physics, branch_id: t.south, attendance: 20, classwork: 50, homework: 30 },
      ])
      .execute();
  });

  afterAll(async () => {
    await t.close();
  });

  describe('of the buildings', () => {
    it('counts active floors and rooms as numbers, for each of the three roles, and logs the export', async () => {
      await speak('en');
      const main = await building(t.north, 'Main');
      const ground = await floor(t.north, main.id, 'Ground');
      await room(t.north, ground.id, 'Lab 1');
      await room(t.north, ground.id, 'Lab 2');
      const second = await floor(t.north, main.id, 'Second');
      expect((await t.post(`/api/setup/floors/${second.id}/archive`, t.north)).status).toBe(200);
      for (const cookie of [t.admin, t.vicePrincipal, t.principal]) {
        const response = await exportOf(
          '/api/setup/buildings/export',
          send([main.id], ['name', 'floors', 'rooms', 'status']),
          cookie,
        );
        expect(response.status).toBe(200);
        const file = await fileOf(response);
        expect(file.disposition).toContain('filename="buildings-2026-10-10.xlsx"');
        expect(file.sheet.name).toBe('Buildings');
        expect(file.sheet.headings).toEqual(['Name', 'Floors', 'Rooms', 'Status']);
        expect(file.sheet.rows).toEqual([['Main', 1, 2, 'Active']]);
        expect(await auditAt('building.export')).toMatchObject({
          branch_id: t.north,
          details: { list: 'buildings', columns: ['name', 'floors', 'rooms', 'status'], rows: 1 },
        });
      }
      expect(await t.entries('building.export')).toHaveLength(3);
    });

    it('answers 404 for a building of another branch and an unknown id, with nothing changed', async () => {
      const here = await building(t.north, 'Annex');
      const elsewhere = await building(t.south, 'Annex South');
      const before = await snapshot();
      for (const cookie of [t.admin, t.vicePrincipal, t.principal]) {
        for (const id of [elsewhere.id, UNKNOWN]) {
          refusedWith(
            await exportOf('/api/setup/buildings/export', send([here.id, id], ['name']), cookie),
            404,
            'not_found',
          );
        }
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('of the rooms', () => {
    it('writes capacity and the lessons at once as numbers, in the order sent', async () => {
      await speak('en');
      const block = await building(t.north, 'Science block');
      const level = await floor(t.north, block.id, '1');
      const lab = await room(t.north, level.id, 'Lab A');
      const hall = await room(t.north, level.id, 'Hall A', {
        type: 'sports_hall',
        capacity: 60,
        shared: true,
        maxSimultaneousLessons: 2,
      });
      const response = await exportOf(
        '/api/setup/rooms/export',
        send(
          [hall.id, lab.id],
          ['name', 'building', 'floor', 'type', 'capacity', 'status', 'shared'],
        ),
        t.principal,
      );
      expect(response.status).toBe(200);
      const file = await fileOf(response);
      // Shared is Yes or No, and the lessons at once a number of its own
      // column, empty for a room that is not shared (task 2.7b-1, decision 10).
      expect(file.sheet.headings).toEqual([
        'Name or number',
        'Building',
        'Floor',
        'Type',
        'Capacity',
        'Status',
        'Shared',
        'Lessons at once',
      ]);
      expect(file.sheet.rows).toEqual([
        ['Hall A', 'Science block', '1', 'Sports hall', 60, 'In use', 'Yes', 2],
        ['Lab A', 'Science block', '1', 'Laboratory', 24, 'In use', 'No', null],
      ]);
      expect(await auditAt('room.export')).toMatchObject({ details: { list: 'rooms', rows: 2 } });

      await speak('ru');
      const russian = await fileOf(
        await exportOf('/api/setup/rooms/export', send([hall.id], ['shared']), t.principal),
      );
      expect(russian.sheet.headings).toEqual(['Общий', 'Уроков одновременно']);
      expect(russian.sheet.rows).toEqual([['Да', 2]]);

      await speak('uz');
      const uzbek = await fileOf(
        await exportOf('/api/setup/rooms/export', send([hall.id, lab.id], ['shared']), t.principal),
      );
      expect(uzbek.sheet.headings).toEqual(['Umumiy', 'Bir vaqtdagi darslar']);
      expect(uzbek.sheet.rows).toEqual([
        ['Ha', 2],
        ['Yoʻq', null],
      ]);
    });

    it('answers 404 for a room of another branch and an unknown id, with nothing changed', async () => {
      const here = await building(t.north, 'East');
      const there = await building(t.south, 'East');
      const mine = await room(t.north, (await floor(t.north, here.id, '1')).id, 'E1');
      const theirs = await room(t.south, (await floor(t.south, there.id, '1')).id, 'E1');
      const before = await snapshot();
      for (const cookie of [t.admin, t.vicePrincipal, t.principal]) {
        for (const id of [theirs.id, UNKNOWN]) {
          refusedWith(
            await exportOf('/api/setup/rooms/export', send([mine.id, id], ['name']), cookie),
            404,
            'not_found',
          );
        }
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('of the divisions', () => {
    it('writes the names in the language of the account and the counts as numbers', async () => {
      await speak('ru');
      const response = await exportOf(
        '/api/setup/divisions/export',
        send([academic], ['name', 'departments', 'staff', 'status']),
        t.vicePrincipal,
      );
      expect(response.status).toBe(200);
      const file = await fileOf(response);
      expect(file.sheet.name).toBe('Отделы');
      expect(file.sheet.headings).toEqual(['Название', 'Кафедры', 'Сотрудники', 'Состояние']);
      const [row] = file.sheet.rows;
      const russian = await t.database.migrator
        .selectFrom('divisions')
        .select('name_ru')
        .where('id', '=', academic)
        .executeTakeFirstOrThrow();
      expect(row?.[0]).toBe(russian.name_ru);
      expect(typeof row?.[1]).toBe('number');
      expect(row?.[2]).toBe(0);
      expect(row?.[3]).toBe('Действует');
      expect(await auditAt('division.export')).toMatchObject({
        branch_id: t.north,
        assignment_id: t.viceAssignment,
        details: { list: 'divisions', rows: 1 },
      });
    });

    it('answers 404 for an unknown id, with nothing changed', async () => {
      const before = await snapshot();
      for (const cookie of [t.admin, t.vicePrincipal, t.principal]) {
        refusedWith(
          await exportOf(
            '/api/setup/divisions/export',
            send([academic, UNKNOWN], ['name']),
            cookie,
          ),
          404,
          'not_found',
        );
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('of the subjects', () => {
    it("writes the branch's own daily distribution as three numbers, never another branch's", async () => {
      await speak('en');
      const columns = [
        'name',
        'department',
        'grades',
        'journalType',
        'ratingExam',
        'daily',
        'quarterly',
        'switches',
        'status',
      ];
      const north = await fileOf(
        await exportOf('/api/setup/subjects/export', send([physics, music], columns)),
      );
      expect(north.sheet.headings).toEqual([
        'Name',
        'Department',
        'Grades',
        'Journal type',
        'Rating exam',
        'Daily distribution: Attendance',
        'Daily distribution: Classwork',
        'Daily distribution: Homework',
        'Quarters not set',
        'Switches',
        'Status',
      ]);
      expect(north.sheet.rows).toEqual([
        [
          'Physics',
          'STEAM',
          '7–9',
          'Graded',
          'No',
          10,
          60,
          30,
          null,
          'Group subject, Demanding',
          'Active',
        ],
        ['Music', 'STEAM', '7–9', 'Attendance only', 'No', null, null, null, null, '', 'Active'],
      ]);
      const south = await fileOf(
        await exportOf('/api/setup/subjects/export', send([physics], ['daily']), t.admin, t.south),
      );
      expect(south.sheet.rows).toEqual([[20, 50, 30]]);
      expect(await auditAt('subject.export')).toMatchObject({
        branch_id: t.south,
        details: { list: 'subjects', columns: ['daily'], rows: 1 },
      });
    });

    it('writes Uzbek names and headings with U+02BB', async () => {
      await speak('uz');
      const file = await fileOf(
        await exportOf('/api/setup/subjects/export', send([physics], ['name', 'switches'])),
      );
      expect(file.sheet.rows).toEqual([['Fizika', 'Guruhli fan, Murakkab fan']]);
      const rooms = await fileOf(
        await exportOf(
          '/api/setup/rooms/export',
          send(
            [
              (
                await t.database.migrator
                  .selectFrom('rooms')
                  .select('id')
                  .where('branch_id', '=', t.north)
                  .executeTakeFirstOrThrow()
              ).id,
            ],
            ['capacity'],
          ),
        ),
      );
      expect(rooms.sheet.headings).toEqual(['Sigʻimi']);
    });

    it('answers 404 for an unknown id, with nothing changed', async () => {
      const before = await snapshot();
      for (const cookie of [t.admin, t.vicePrincipal, t.principal]) {
        refusedWith(
          await exportOf('/api/setup/subjects/export', send([physics, UNKNOWN], ['name']), cookie),
          404,
          'not_found',
        );
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  it('makes the file of rooms, divisions and subjects for each of the three roles', async () => {
    const anyRoom = (
      await t.database.migrator
        .selectFrom('rooms')
        .select('id')
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow()
    ).id;
    for (const cookie of [t.admin, t.vicePrincipal, t.principal]) {
      for (const [path, id] of [
        ['/api/setup/rooms/export', anyRoom],
        ['/api/setup/divisions/export', academic],
        ['/api/setup/subjects/export', physics],
      ] as const) {
        const response = await exportOf(path, send([id], ['name']), cookie);
        expect(response.status, path).toBe(200);
        expect((await fileOf(response)).sheet.rows).toHaveLength(1);
      }
    }
  });

  it('refuses a Teacher, a Tutor and a Head Teacher on every route, with nothing logged', async () => {
    const before = await snapshot();
    for (const [path, id] of [
      ['/api/setup/buildings/export', UNKNOWN],
      ['/api/setup/rooms/export', UNKNOWN],
      ['/api/setup/divisions/export', academic],
      ['/api/setup/subjects/export', physics],
    ] as const) {
      for (const cookie of [t.teacher, tutor, headTeacher]) {
        refusedWith(await exportOf(path, send([id], ['name']), cookie), 403, 'permission_denied');
      }
    }
    expect(await snapshot()).toEqual(before);
  });
});
