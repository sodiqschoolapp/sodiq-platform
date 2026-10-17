import {
  BRANCH_HEADER,
  LOAD_PROBLEMS,
  loadRowSchema,
  loadSchema,
  loadTeachersSchema,
  timetableVersionListSchema,
  timetableVersionSchema,
  type LoadRow,
  type TimetableVersion,
} from '@sodiq/shared';
import { LOAD_PROBLEM_ORDER } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

/** Monday 12 October 2026: the next Monday from the kit's Saturday 10 October. */
const MONDAY = '2026-10-12';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const versionOf = (response: Response): TimetableVersion => {
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return timetableVersionSchema.parse(response.body);
};

const rowOf = (response: Response): LoadRow => {
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return loadRowSchema.parse(response.body);
};

// All names are invented. docs/spec/05-classes-groups-subjects.md, Teaching
// load and Language of instruction; 06-timetable.md, Model, Building a
// timetable, Rules; edge-cases/timetable.md, Structure and Versions and
// drafts; 04-people.md, Vacancy. Task 3.4a, pull request #99, with corrections
// 1 to 6 of its review. The clock stands at 23:55 on Saturday 10 October 2026
// in Tashkent.
describe('draft versions and the teaching load', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let year: string;
  let southYear: string;
  let subject: string;

  const get = (path: string, cookie = t.vicePrincipal, branch = t.north) =>
    t.get(path, branch, cookie);
  const post = (path: string, body: object = {}, cookie = t.vicePrincipal, branch = t.north) =>
    t.post(path, branch, body, cookie);
  const patch = (path: string, body: object, cookie = t.vicePrincipal, branch = t.north) =>
    t.patch(path, branch, body, cookie);
  const remove = (path: string, cookie = t.vicePrincipal, branch = t.north) =>
    request(t.kit.server).delete(path).set('Cookie', cookie).set(BRANCH_HEADER, branch);

  /** A new draft of the North's year through the route. */
  async function draft(fields: object = {}, cookie = t.vicePrincipal): Promise<TimetableVersion> {
    const response = await post(
      '/api/timetable/versions',
      { academicYearId: year, startsOn: MONDAY, ...fields },
      cookie,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return timetableVersionSchema.parse(response.body);
  }

  /** A class of the North and a teacher who may take it for `subject`. */
  async function fitting(input: { grade?: number; language?: 'uz' | 'ru' } = {}) {
    const classId = await load.classes.schoolClass(t.north, year, {
      grade: input.grade ?? 7,
      language: input.language ?? 'uz',
    });
    const teacher = await load.teacher(t.north, {
      languages: [input.language ?? 'uz'],
      subjects: [{ subject, grades: [input.grade ?? 7] }],
    });
    return { classId, teacher: teacher.staffId };
  }

  const rowBody = (fields: object) => ({
    classId: null,
    groupId: null,
    subjectId: subject,
    lessonsPerWeek: 3,
    roomId: null,
    roomType: null,
    doubleLessons: false,
    ...fields,
  });

  const createRow = (versionId: string, fields: object, cookie = t.vicePrincipal) =>
    post(`/api/timetable/versions/${versionId}/load`, rowBody(fields), cookie);

  /** Every row of the tables the routes write, in both branches, and the audit count. */
  const rowsOf = () =>
    Promise.all([
      t.database.migrator.selectFrom('timetable_versions').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('teaching_load_rows').selectAll().orderBy('id').execute(),
      // Task 5.3b-2: the copy writes pins and the row delete removes them.
      t.database.migrator.selectFrom('timetable_pins').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('staff_statuses').selectAll().orderBy('id').execute(),
      // The vacancy delete removes the record and its rows (permission review, S3).
      t.database.migrator.selectFrom('staff').select('id').orderBy('id').execute(),
      t.database.migrator.selectFrom('staff_branches').selectAll().orderBy('staff_id').execute(),
      t.database.migrator
        .selectFrom('staff_subjects')
        .selectAll()
        .orderBy('staff_id')
        .orderBy('subject_id')
        .execute(),
      t.database.migrator
        .selectFrom('staff_languages')
        .selectAll()
        .orderBy('staff_id')
        .orderBy('language')
        .execute(),
      t.auditCount(),
    ]);

  /** A pin of a row written by the migrator (task 5.3b-2), so a wrong copy or delete would touch it. */
  const pinRow = (branch: string, version: string, row: string) =>
    t.database.migrator
      .insertInto('timetable_pins')
      .values({
        branch_id: branch,
        version_id: version,
        load_row_id: row,
        weekday: 1,
        slot_position: 1,
      })
      .execute();

  /** How many connections to the test database wait for a lock right now. */
  async function waitingForALock(): Promise<number> {
    const found = await sql<{ waiting: number }>`
      select count(distinct l.pid)::int as waiting
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(t.database.migrator);
    return found.rows[0]?.waiting ?? 0;
  }

  /** Runs `work` in a transaction of the application that stays open until released. */
  async function holdOpen(work: (transaction: Transaction) => Promise<void>) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const done = t.app
      .get(Transactions)
      .run([t.north], async (transaction) => {
        await work(transaction);
        ready();
        await released;
      })
      .catch((error: unknown) => error);
    await Promise.race([isReady, done]);
    return { release, done };
  }

  beforeAll(async () => {
    t = await dayTemplatesKit();
    load = new LoadKit(t.database.migrator);
    year = await load.classes.year(t.north);
    southYear = await load.classes.year(t.south);
    subject = await load.classes.subject({ grades: [4, 5, 7, 8, 9] });
    // Lessons of 45 minutes for every grade, of 40 for grades 1 to 4.
    const long = await t.createSlotType(t.north, 'Lesson', 'lesson', 45);
    const short = await t.createSlotType(t.north, 'Short lesson', 'lesson', 40);
    const pause = await t.createSlotType(t.north, 'Break', 'break', 10);
    const regular = await t.createTemplate(t.north, 'Regular', [long, pause, long, pause, long]);
    const junior = await t.createTemplate(t.north, 'Junior', [short, pause, short, pause, short]);
    await t.assign(t.north, regular);
    await t.assign(t.north, junior, { level: 'grades', gradeFrom: 1, gradeTo: 4 });
  });

  afterAll(async () => {
    await t.close();
  });

  it('reports the problems in the order of the rule engine', () => {
    expect([...LOAD_PROBLEMS]).toEqual([...LOAD_PROBLEM_ORDER]);
  });

  describe('a draft version', () => {
    it('is created empty, numbered and audited, and listed', async () => {
      const response = await post('/api/timetable/versions', {
        academicYearId: year,
        startsOn: MONDAY,
      });
      const version = versionOf(response);
      expect(version).toMatchObject({
        academicYearId: year,
        status: 'draft',
        startsOn: MONDAY,
        fromVersion: null,
        rows: 0,
        leftRows: 0,
      });
      const [entry] = await t.entries('timetable_version.create', version.id);
      expect(entry).toMatchObject({
        assignment_id: t.viceAssignment,
        request_id: response.headers['x-request-id'],
        new_value: { academicYearId: year, number: version.number, startsOn: MONDAY },
      });
      const list = timetableVersionListSchema.parse(
        (await get('/api/timetable/versions', t.principal).expect(200)).body,
      );
      expect(list.today).toBe('2026-10-10');
      expect(list.versions.find((one) => one.id === version.id)).toEqual(version);
    });

    it('numbers two drafts created at one moment one after the other', async () => {
      const own = await t.newBranch();
      const ownYear = await load.classes.year(own);
      const [one, two] = await Promise.all([
        post(
          '/api/timetable/versions',
          { academicYearId: ownYear, startsOn: MONDAY },
          t.admin,
          own,
        ),
        post(
          '/api/timetable/versions',
          { academicYearId: ownYear, startsOn: MONDAY },
          t.admin,
          own,
        ),
      ]);
      expect([versionOf(one).number, versionOf(two).number].sort()).toEqual([1, 2]);
    });

    it('refuses a start date before today or outside the year (decision 5)', async () => {
      for (const [startsOn, code] of [
        ['2026-10-09', 'version_start_past'],
        ['2027-06-01', 'version_start_outside_year'],
      ] as const) {
        const before = await rowsOf();
        refusedWith(
          await post('/api/timetable/versions', { academicYearId: year, startsOn }),
          422,
          code,
        );
        expect(await rowsOf()).toEqual(before);
      }
      // Today is allowed: "tomorrow at the earliest" is a rule of the publish.
      await draft({ startsOn: '2026-10-10' });
    });

    it('is refused in a closed year', async () => {
      const own = await t.newBranch();
      const closed = await load.classes.year(own);
      await load.classes.setYear(closed, 'closed');
      refusedWith(
        await post(
          '/api/timetable/versions',
          { academicYearId: closed, startsOn: MONDAY },
          t.admin,
          own,
        ),
        409,
        'timetable_year_closed',
      );
    });

    it("answers another branch's and an unknown year or source 404, changing nothing", async () => {
      const southern = await load.version(t.south, southYear);
      // Task 5.3b-2 (permission review, M1): a pinned row on the source, so a copy across branches would write pins.
      const southClass = await load.classes.schoolClass(t.south, southYear);
      const southTeacher = await load.teacher(t.south, { subjects: [{ subject, grades: [7] }] });
      await pinRow(
        t.south,
        southern,
        await load.row({
          branch_id: t.south,
          version_id: southern,
          class_id: southClass,
          subject_id: subject,
          teacher_id: southTeacher.staffId,
        }),
      );
      for (const fields of [
        { academicYearId: southYear },
        { academicYearId: UNKNOWN },
        { copyFrom: southern },
        { copyFrom: UNKNOWN },
      ]) {
        const before = await rowsOf();
        refusedWith(
          await post('/api/timetable/versions', {
            academicYearId: year,
            startsOn: MONDAY,
            ...fields,
          }),
          404,
          'not_found',
        );
        expect(await rowsOf()).toEqual(before);
      }
      // The Super Admin, whose roles reach every branch, too.
      refusedWith(
        await post(
          '/api/timetable/versions',
          { academicYearId: year, startsOn: MONDAY, copyFrom: southern },
          t.admin,
        ),
        404,
        'not_found',
      );
    });

    it('copies a version of the same year only (decision 10)', async () => {
      const later = await load.classes.year(t.north, 'planned', '2027-09-01', '2028-05-31');
      const source = await load.version(t.north, later, { startsOn: '2027-09-06' });
      refusedWith(
        await post('/api/timetable/versions', {
          academicYearId: year,
          startsOn: MONDAY,
          copyFrom: source,
        }),
        409,
        'version_copy_year',
      );
    });

    it('copies the rows that pass and keeps the others with their problems until dismissed (decision 10)', async () => {
      const source = await draft();
      const kept = await fitting();
      const out = await fitting();
      const keptRow = rowOf(
        await createRow(source.id, { classId: kept.classId, teacherId: kept.teacher }),
      );
      const outRow = rowOf(
        await createRow(source.id, { classId: out.classId, teacherId: out.teacher }),
      );
      // The second teacher is inactive from a week after the start.
      await load.status(out.teacher, 'inactive', '2026-10-19');
      const copy = versionOf(
        await post('/api/timetable/versions', {
          academicYearId: year,
          startsOn: '2026-10-19',
          copyFrom: source.id,
        }),
      );
      expect(copy).toMatchObject({
        fromVersion: { id: source.id, number: source.number },
        rows: 1,
        leftRows: 1,
      });
      const answer = loadSchema.parse(
        (await get(`/api/timetable/versions/${copy.id}/load`).expect(200)).body,
      );
      expect(answer.rows.map((row) => [row.unit.id, row.teacher.id, row.problems])).toEqual([
        [kept.classId, kept.teacher, []],
      ]);
      expect(answer.leftRows).toMatchObject([
        { id: outRow.id, unit: { id: out.classId }, problems: ['load_teacher_status'] },
      ]);
      const [entry] = await t.entries('timetable_version.create', copy.id);
      expect(entry?.new_value).toMatchObject({
        fromVersionId: source.id,
        copiedRows: [keptRow.id],
        leftRows: [{ sourceRowId: outRow.id, problems: ['load_teacher_status'] }],
      });
      const dismissing = await patch(`/api/timetable/versions/${copy.id}`, {
        dismissLeftRows: true,
      });
      expect(versionOf(dismissing).leftRows).toBe(0);
      const [edit] = await t.entries('timetable_version.edit', copy.id);
      expect(edit).toMatchObject({
        assignment_id: t.viceAssignment,
        request_id: dismissing.headers['x-request-id'],
        old_value: { leftRows: [{ sourceRowId: outRow.id }] },
        new_value: { leftRows: 0 },
      });
    });

    it('changes the start date of a draft, and nothing of a published version', async () => {
      const version = await draft();
      const moved = versionOf(
        await patch(`/api/timetable/versions/${version.id}`, { startsOn: '2026-10-19' }),
      );
      expect(moved.startsOn).toBe('2026-10-19');
      refusedWith(
        await patch(`/api/timetable/versions/${version.id}`, { startsOn: '2026-10-01' }),
        422,
        'version_start_past',
      );
      await load.setVersion(version.id, 'published');
      refusedWith(
        await patch(`/api/timetable/versions/${version.id}`, { startsOn: '2026-10-26' }),
        409,
        'version_not_draft',
      );
    });
  });

  describe('a load row', () => {
    it('is added for a fitting teacher and audited, by the Academic Vice Principal and the Super Admin', async () => {
      const version = await draft();
      for (const [cookie, assignment] of [
        [t.vicePrincipal, t.viceAssignment],
        [t.admin, t.adminAssignment],
      ] as const) {
        // Task 5.4c-1: the edit lock of the first account is let go for the second.
        await load.freeEditLock(version.id);
        const own = await fitting();
        const response = await createRow(
          version.id,
          { classId: own.classId, teacherId: own.teacher, roomType: 'laboratory' },
          cookie,
        );
        const row = rowOf(response);
        expect(row).toMatchObject({
          unit: { kind: 'class', id: own.classId, grades: [7], language: 'uz' },
          subject: { id: subject },
          teacher: { id: own.teacher, kind: 'person' },
          lessonsPerWeek: 3,
          room: null,
          roomType: 'laboratory',
          doubleLessons: false,
          problems: [],
        });
        const [entry] = await t.entries('teaching_load.create', row.id);
        expect(entry).toMatchObject({
          assignment_id: assignment,
          request_id: response.headers['x-request-id'],
          new_value: { versionId: version.id, classId: own.classId, teacherId: own.teacher },
        });
      }
    });

    it('is read by the Principal and written by nobody else of the branch', async () => {
      const version = await draft();
      const own = await fitting();
      const row = rowOf(
        await createRow(version.id, { classId: own.classId, teacherId: own.teacher }),
      );
      await get(`/api/timetable/versions/${version.id}/load`, t.principal).expect(200);
      await get(
        `/api/timetable/versions/${version.id}/load/teachers?classId=${own.classId}&subjectId=${subject}`,
        t.principal,
      ).expect(200);
      for (const cookie of [t.principal, t.teacher]) {
        const before = await rowsOf();
        for (const response of [
          await post('/api/timetable/versions', { academicYearId: year, startsOn: MONDAY }, cookie),
          await patch(`/api/timetable/versions/${version.id}`, { startsOn: '2026-10-19' }, cookie),
          await createRow(version.id, { classId: own.classId, teacherId: own.teacher }, cookie),
          await patch(
            `/api/timetable/versions/${version.id}/load/${row.id}`,
            { ...rowBody({ teacherId: own.teacher }), lessonsPerWeek: 4 },
            cookie,
          ),
          await remove(`/api/timetable/versions/${version.id}/load/${row.id}`, cookie),
        ]) {
          refusedWith(response, 403, 'permission_denied');
        }
        expect(await rowsOf()).toEqual(before);
      }
      refusedWith(
        await get(`/api/timetable/versions/${version.id}/load`, t.teacher),
        403,
        'permission_denied',
      );
    });

    // The plan's tests: the roles without the area, refused on every route
    // with the rows and the audit log unchanged.
    it('refuses every route to the roles of the branch without the area', async () => {
      const version = await draft();
      const own = await fitting();
      const row = rowOf(
        await createRow(version.id, { classId: own.classId, teacherId: own.teacher }),
      );
      const roles = [
        'tutor',
        'head_teacher',
        'senior_head_teacher',
        'spiritual_vice_principal',
        'head_tutor',
      ] as const;
      for (const role of roles) {
        const browser = await t.kit.completeSession('Malika', `Qodirova${'a'.repeat(role.length)}`);
        await t.kit.giveRole(browser.account.id, {
          role,
          ...(role === 'senior_head_teacher' ? {} : { branchId: t.north }),
        });
        const cookie = browser.cookie;
        const before = await rowsOf();
        for (const response of [
          await get('/api/timetable/versions', cookie),
          await get(`/api/timetable/versions/${version.id}/load`, cookie),
          await get(
            `/api/timetable/versions/${version.id}/load/teachers?classId=${own.classId}&subjectId=${subject}`,
            cookie,
          ),
          await post('/api/timetable/versions', { academicYearId: year, startsOn: MONDAY }, cookie),
          await patch(`/api/timetable/versions/${version.id}`, { startsOn: '2026-10-19' }, cookie),
          await createRow(version.id, { classId: own.classId, teacherId: own.teacher }, cookie),
          await patch(
            `/api/timetable/versions/${version.id}/load/${row.id}`,
            rowBody({ teacherId: own.teacher }),
            cookie,
          ),
          await remove(`/api/timetable/versions/${version.id}/load/${row.id}`, cookie),
        ]) {
          refusedWith(response, 403, 'permission_denied');
        }
        expect(await rowsOf()).toEqual(before);
      }
    });

    it("answers another branch's and an unknown version, row, class, group, subject, teacher and room 404, changing nothing", async () => {
      const version = await draft();
      const own = await fitting();
      const row = rowOf(
        await createRow(version.id, { classId: own.classId, teacherId: own.teacher }),
      );
      const southClass = await load.classes.schoolClass(t.south, southYear);
      const southGroup = await load.classes.group(t.south, southYear, subject, [southClass]);
      const southTeacher = await load.teacher(t.south, { subjects: [{ subject, grades: [7] }] });
      const southRoom = await load.classes.room(t.south);
      const southVersion = await load.version(t.south, southYear);
      const southRow = await load.row({
        branch_id: t.south,
        version_id: southVersion,
        class_id: southClass,
        subject_id: subject,
        teacher_id: southTeacher.staffId,
      });
      // Task 5.3b-2 (permission review, M1): pinned rows in both branches, so a wrong cascade would remove pins.
      await pinRow(t.north, version.id, row.id);
      await pinRow(t.south, southVersion, southRow);
      const other = await fitting();
      const base = { classId: other.classId, teacherId: other.teacher };
      const attempts: (() => Promise<Response>)[] = [];
      for (const id of [southVersion, UNKNOWN]) {
        attempts.push(
          () => get(`/api/timetable/versions/${id}/load`),
          () => patch(`/api/timetable/versions/${id}`, { startsOn: '2026-10-19' }),
          () => createRow(id, base),
          () =>
            get(
              `/api/timetable/versions/${id}/load/teachers?classId=${other.classId}&subjectId=${subject}`,
            ),
        );
      }
      for (const id of [southRow, UNKNOWN]) {
        attempts.push(
          () =>
            patch(`/api/timetable/versions/${version.id}/load/${id}`, {
              ...rowBody({ teacherId: own.teacher }),
              lessonsPerWeek: 4,
            }),
          () => remove(`/api/timetable/versions/${version.id}/load/${id}`),
        );
      }
      // The row of the version through another version's path.
      const second = await draft();
      attempts.push(() => remove(`/api/timetable/versions/${second.id}/load/${row.id}`));
      for (const fields of [
        { classId: southClass },
        { classId: UNKNOWN },
        { classId: null, groupId: southGroup },
        { classId: null, groupId: UNKNOWN },
        { subjectId: UNKNOWN },
        { teacherId: southTeacher.staffId },
        { teacherId: UNKNOWN },
        { roomId: southRoom },
        { roomId: UNKNOWN },
      ]) {
        attempts.push(() => createRow(version.id, { ...base, ...fields }));
      }
      for (const fields of [{ teacherId: southTeacher.staffId }, { roomId: southRoom }]) {
        attempts.push(() =>
          patch(`/api/timetable/versions/${version.id}/load/${row.id}`, {
            ...rowBody({ teacherId: own.teacher }),
            ...fields,
          }),
        );
      }
      for (const attempt of attempts) {
        const before = await rowsOf();
        refusedWith(await attempt(), 404, 'not_found');
        expect(await rowsOf()).toEqual(before);
      }
      // The Super Admin too.
      refusedWith(
        await get(`/api/timetable/versions/${southVersion}/load`, t.admin),
        404,
        'not_found',
      );
    });

    // Permission review of the build, M1, M2 and S2: every id of the
    // teachers' query and of the row edit, and the Super Admin on each route.
    it("answers another branch's and an unknown id of the teachers' query and of a row edit 404, also as the Super Admin", async () => {
      const version = await draft();
      const own = await fitting();
      const row = rowOf(
        await createRow(version.id, { classId: own.classId, teacherId: own.teacher }),
      );
      const southClass = await load.classes.schoolClass(t.south, southYear);
      const southGroup = await load.classes.group(t.south, southYear, subject, [southClass]);
      await pinRow(t.north, version.id, row.id);
      const second = await draft();
      const teachers = (query: string, cookie = t.vicePrincipal) =>
        get(`/api/timetable/versions/${version.id}/load/teachers?${query}`, cookie);
      const edit = (fields: object, path = version.id, cookie = t.vicePrincipal) =>
        patch(
          `/api/timetable/versions/${path}/load/${row.id}`,
          { ...rowBody({ teacherId: own.teacher }), ...fields },
          cookie,
        );
      for (const cookie of [t.vicePrincipal, t.admin]) {
        const attempts: (() => Promise<Response>)[] = [
          () => teachers(`classId=${southClass}&subjectId=${subject}`, cookie),
          () => teachers(`classId=${UNKNOWN}&subjectId=${subject}`, cookie),
          () => teachers(`groupId=${southGroup}&subjectId=${subject}`, cookie),
          () => teachers(`groupId=${UNKNOWN}&subjectId=${subject}`, cookie),
          () => teachers(`classId=${own.classId}&subjectId=${UNKNOWN}`, cookie),
          () => edit({ teacherId: UNKNOWN }, version.id, cookie),
          () => edit({ roomId: UNKNOWN }, version.id, cookie),
          () => edit({ lessonsPerWeek: 5 }, second.id, cookie),
          () => patch(`/api/timetable/versions/${UNKNOWN}`, { startsOn: '2026-10-19' }, cookie),
          () => createRow(UNKNOWN, { classId: own.classId, teacherId: own.teacher }, cookie),
          () => remove(`/api/timetable/versions/${version.id}/load/${UNKNOWN}`, cookie),
        ];
        // Task 5.4c-1: the edit lock the writes above took is let go for this account.
        await load.freeEditLock(version.id);
        for (const attempt of attempts) {
          const before = await rowsOf();
          refusedWith(await attempt(), 404, 'not_found');
          expect(await rowsOf()).toEqual(before);
        }
      }
    });

    it('lists no version of another branch, also for the Super Admin', async () => {
      const southern = await load.version(t.south, southYear);
      for (const cookie of [t.vicePrincipal, t.admin]) {
        const list = timetableVersionListSchema.parse(
          (await get('/api/timetable/versions', cookie).expect(200)).body,
        );
        expect(list.versions.some((one) => one.id === southern)).toBe(false);
        expect(list.versions.length).toBeGreaterThan(0);
      }
    });

    it('refuses each blocked case with its rule (06, Rules; 05, Teaching load)', async () => {
      const version = await draft();
      const own = await fitting();
      const russian = await load.classes.schoolClass(t.north, year, { grade: 7, language: 'ru' });
      const otherSubject = await load.classes.subject({ grades: [7] });
      const noSubject = await load.teacher(t.north, {
        subjects: [{ subject: otherSubject, grades: [7] }],
      });
      const noGrade = await load.teacher(t.north, { subjects: [{ subject, grades: [8] }] });
      const inactive = await load.teacher(t.north, { subjects: [{ subject, grades: [7] }] });
      await load.status(inactive.staffId, 'inactive', '2026-10-11');
      const archivedSubject = await load.classes.subject({ grades: [7] });
      await load.profile(own.teacher, [{ subject: archivedSubject, grades: [7] }]);
      await t.database.migrator
        .updateTable('subjects')
        .set({ archived_at: new Date('2026-10-01T09:00:00+05:00') })
        .where('id', '=', archivedSubject)
        .execute();
      const closedRoom = await load.classes.room(t.north, 'closed');
      const closedVacancy = await load.vacancy(t.north, { subjects: [{ subject, grades: [7] }] });
      await load.status(closedVacancy, 'closed', '2026-10-10');
      const noGradeVacancy = await load.vacancy(t.north, { subjects: [{ subject, grades: [8] }] });
      const cases: [object, string][] = [
        [{ classId: own.classId, teacherId: noSubject.staffId }, 'load_teacher_subject'],
        [{ classId: own.classId, teacherId: noGrade.staffId }, 'load_teacher_grade'],
        [{ classId: russian, teacherId: own.teacher }, 'load_teacher_language'],
        [{ classId: own.classId, teacherId: inactive.staffId }, 'load_teacher_status'],
        [
          { classId: own.classId, teacherId: own.teacher, subjectId: archivedSubject },
          'load_subject_archived',
        ],
        [{ classId: own.classId, teacherId: own.teacher, roomId: closedRoom }, 'load_room_closed'],
        [{ classId: own.classId, teacherId: closedVacancy }, 'load_teacher_status'],
        [{ classId: own.classId, teacherId: noGradeVacancy }, 'load_teacher_grade'],
      ];
      for (const [fields, code] of cases) {
        const before = await rowsOf();
        refusedWith(await createRow(version.id, fields), 409, code);
        expect(await rowsOf()).toEqual(before);
      }
    });

    // Spec review of the build, must-fix 1: the unit and subject cases at the route.
    it('refuses a unit of another year, an archived unit, another subject of a group and a subject outside the grade', async () => {
      const version = await draft();
      const own = await fitting();
      const later = await load.classes.year(t.north, 'planned', '2029-09-01', '2030-05-31');
      const elsewhere = await load.classes.schoolClass(t.north, later);
      const archived = await load.classes.schoolClass(t.north, year);
      await t.database.migrator
        .updateTable('classes')
        .set({ archived_at: new Date('2026-10-01T09:00:00+05:00') })
        .where('id', '=', archived)
        .execute();
      const other = await load.classes.subject({ grades: [7] });
      await load.profile(own.teacher, [{ subject: other, grades: [7] }]);
      const group = await load.classes.group(t.north, year, subject, [own.classId]);
      const ninth = await load.classes.schoolClass(t.north, year, { grade: 9 });
      const seventhOnly = await load.classes.subject({ grades: [7] });
      await load.profile(own.teacher, [{ subject: seventhOnly, grades: [7] }]);
      const cases: [object, string][] = [
        [{ classId: elsewhere, teacherId: own.teacher }, 'load_unit_year'],
        [{ classId: archived, teacherId: own.teacher }, 'load_unit_archived'],
        [
          { classId: null, groupId: group, teacherId: own.teacher, subjectId: other },
          'load_group_subject',
        ],
        [{ classId: ninth, teacherId: own.teacher, subjectId: seventhOnly }, 'load_subject_grade'],
      ];
      for (const [fields, code] of cases) {
        const before = await rowsOf();
        refusedWith(await createRow(version.id, fields), 409, code);
        expect(await rowsOf()).toEqual(before);
      }
    });

    it('refuses a row in a version that is not a draft and in a closed year', async () => {
      const own = await fitting();
      const published = await draft();
      await load.setVersion(published.id, 'published');
      refusedWith(
        await createRow(published.id, { classId: own.classId, teacherId: own.teacher }),
        409,
        'version_not_draft',
      );
      const branch = await t.newBranch();
      const closedYear = await load.classes.year(branch);
      const classId = await load.classes.schoolClass(branch, closedYear);
      const teacher = await load.teacher(branch, { subjects: [{ subject, grades: [7] }] });
      const version = versionOf(
        await post(
          '/api/timetable/versions',
          { academicYearId: closedYear, startsOn: MONDAY },
          t.admin,
          branch,
        ),
      );
      await load.classes.setYear(closedYear, 'closed');
      const before = await rowsOf();
      refusedWith(
        await post(
          `/api/timetable/versions/${version.id}/load`,
          rowBody({ classId, teacherId: teacher.staffId }),
          t.admin,
          branch,
        ),
        409,
        'timetable_year_closed',
      );
      expect(await rowsOf()).toEqual(before);
    });

    // Spec review of the build, should-fix 3: a draft whose start date has
    // passed reads a status on today, so a vacancy closed since cannot be named.
    it('refuses a vacancy closed today on a draft whose start date has passed', async () => {
      const version = await draft();
      await t.database.migrator
        .updateTable('timetable_versions')
        .set({ starts_on: '2026-10-05' })
        .where('id', '=', version.id)
        .execute();
      const own = await fitting();
      const vacancy = await load.vacancy(t.north, { subjects: [{ subject, grades: [7] }] });
      await load.status(vacancy, 'closed', '2026-10-10');
      const before = await rowsOf();
      refusedWith(
        await createRow(version.id, { classId: own.classId, teacherId: vacancy }),
        409,
        'load_teacher_status',
      );
      expect(await rowsOf()).toEqual(before);
    });

    it('lets any teacher of the subject take any class when the language rule is off (05)', async () => {
      const version = await draft();
      const free = await load.classes.subject({ grades: [7], languageRule: false });
      const russian = await load.classes.schoolClass(t.north, year, { language: 'ru' });
      const uzbek = await load.teacher(t.north, {
        languages: ['uz'],
        subjects: [{ subject: free, grades: [7] }],
      });
      rowOf(
        await createRow(version.id, {
          classId: russian,
          teacherId: uzbek.staffId,
          subjectId: free,
        }),
      );
    });

    it('binds a vacancy by the same rules, and takes one that fits (06, Rules)', async () => {
      const version = await draft();
      const own = await fitting();
      const vacancy = await load.vacancy(t.north, { subjects: [{ subject, grades: [7] }] });
      const row = rowOf(await createRow(version.id, { classId: own.classId, teacherId: vacancy }));
      expect(row.teacher).toMatchObject({ id: vacancy, kind: 'vacancy' });
    });

    it('refuses a group of two grades with no shared slot, and needs the subject in both grades (edge/timetable, Structure)', async () => {
      const version = await draft();
      const four = await load.classes.schoolClass(t.north, year, { grade: 4 });
      const five = await load.classes.schoolClass(t.north, year, { grade: 5 });
      const apart = await load.classes.group(t.north, year, subject, [four, five]);
      const both45 = await load.teacher(t.north, { subjects: [{ subject, grades: [4, 5] }] });
      refusedWith(
        await createRow(version.id, { classId: null, groupId: apart, teacherId: both45.staffId }),
        409,
        'load_group_no_shared_slot',
      );
      const seven = await load.classes.schoolClass(t.north, year, { grade: 7 });
      const eight = await load.classes.schoolClass(t.north, year, { grade: 8 });
      const together = await load.classes.group(t.north, year, subject, [seven, eight]);
      const only7 = await load.teacher(t.north, { subjects: [{ subject, grades: [7] }] });
      refusedWith(
        await createRow(version.id, { classId: null, groupId: together, teacherId: only7.staffId }),
        409,
        'load_teacher_grade',
      );
      const both = await load.teacher(t.north, { subjects: [{ subject, grades: [7, 8] }] });
      const row = rowOf(
        await createRow(version.id, { classId: null, groupId: together, teacherId: both.staffId }),
      );
      expect(row.unit).toMatchObject({ kind: 'group', id: together, grades: [7, 8] });
    });

    it('refuses a second row for the same class and subject, naming the row that holds it', async () => {
      const version = await draft();
      const own = await fitting();
      const row = rowOf(
        await createRow(version.id, { classId: own.classId, teacherId: own.teacher }),
      );
      const response = await createRow(version.id, {
        classId: own.classId,
        teacherId: own.teacher,
      });
      refusedWith(response, 409, 'load_row_exists');
      expect((response.body as { error: { details: unknown[] } }).error.details).toEqual([
        expect.objectContaining({ path: 'subjectId', recordId: row.id }),
      ]);
    });

    it('takes one of two creates of the same row at one moment', async () => {
      const version = await draft();
      const own = await fitting();
      const [one, two] = await Promise.all([
        createRow(version.id, { classId: own.classId, teacherId: own.teacher }),
        createRow(version.id, { classId: own.classId, teacherId: own.teacher }),
      ]);
      expect([one.status, two.status].sort()).toEqual([201, 409]);
      expect(errorCode(one.status === 409 ? one : two)).toBe('load_row_exists');
    });

    it('is refused in a closed year and in a version that is not a draft', async () => {
      const own = await t.newBranch();
      const ownYear = await load.classes.year(own);
      const classId = await load.classes.schoolClass(own, ownYear);
      const teacher = await load.teacher(own, { subjects: [{ subject, grades: [7] }] });
      const version = versionOf(
        await post(
          '/api/timetable/versions',
          { academicYearId: ownYear, startsOn: MONDAY },
          t.admin,
          own,
        ),
      );
      const row = rowOf(
        await post(
          `/api/timetable/versions/${version.id}/load`,
          rowBody({ classId, teacherId: teacher.staffId }),
          t.admin,
          own,
        ),
      );
      await load.setVersion(version.id, 'published');
      refusedWith(
        await remove(`/api/timetable/versions/${version.id}/load/${row.id}`, t.admin, own),
        409,
        'version_not_draft',
      );
      await load.setVersion(version.id, 'draft');
      await load.classes.setYear(ownYear, 'closed');
      refusedWith(
        await patch(
          `/api/timetable/versions/${version.id}/load/${row.id}`,
          { ...rowBody({ teacherId: teacher.staffId }), lessonsPerWeek: 4 },
          t.admin,
          own,
        ),
        409,
        'timetable_year_closed',
      );
    });
  });

  describe('an edit and a delete (decisions 3, 6 and 7)', () => {
    it('changes the lessons of a row with a problem it does not touch, and lists the problem', async () => {
      const version = await draft();
      const own = await fitting();
      const row = rowOf(
        await createRow(version.id, { classId: own.classId, teacherId: own.teacher }),
      );
      // A later change elsewhere is not refused because the draft needs it.
      await load.status(own.teacher, 'inactive', '2026-10-11');
      const editing = await patch(`/api/timetable/versions/${version.id}/load/${row.id}`, {
        ...rowBody({ teacherId: own.teacher }),
        lessonsPerWeek: 5,
        doubleLessons: true,
      });
      const edited = rowOf(editing);
      expect(edited).toMatchObject({
        lessonsPerWeek: 5,
        doubleLessons: true,
        problems: ['load_teacher_status'],
      });
      const [entry] = await t.entries('teaching_load.edit', row.id);
      expect(entry).toMatchObject({
        assignment_id: t.viceAssignment,
        request_id: editing.headers['x-request-id'],
        old_value: { lessonsPerWeek: 3, doubleLessons: false },
        new_value: { lessonsPerWeek: 5, doubleLessons: true },
      });
      const listed = loadSchema.parse(
        (await get(`/api/timetable/versions/${version.id}/load`).expect(200)).body,
      );
      expect(listed.rows.find((one) => one.id === row.id)?.problems).toEqual([
        'load_teacher_status',
      ]);
    });

    // Spec review of the build, must-fix 1: every teacher rule on a teacher change.
    it('refuses a teacher change to one without the subject, out, or without the language', async () => {
      const version = await draft();
      const own = await fitting();
      const row = rowOf(
        await createRow(version.id, { classId: own.classId, teacherId: own.teacher }),
      );
      const other = await load.classes.subject({ grades: [7] });
      const noSubject = await load.teacher(t.north, {
        subjects: [{ subject: other, grades: [7] }],
      });
      const out = await load.teacher(t.north, { subjects: [{ subject, grades: [7] }] });
      await load.status(out.staffId, 'left', '2026-10-11');
      const noLanguage = await load.teacher(t.north, {
        languages: ['ru'],
        subjects: [{ subject, grades: [7] }],
      });
      for (const [teacherId, code] of [
        [noSubject.staffId, 'load_teacher_subject'],
        [out.staffId, 'load_teacher_status'],
        [noLanguage.staffId, 'load_teacher_language'],
      ] as const) {
        const before = await rowsOf();
        refusedWith(
          await patch(
            `/api/timetable/versions/${version.id}/load/${row.id}`,
            rowBody({ teacherId }),
          ),
          409,
          code,
        );
        expect(await rowsOf()).toEqual(before);
      }
    });

    it('checks the teacher rules when the teacher changes, and the room when the room changes', async () => {
      const version = await draft();
      const own = await fitting();
      const row = rowOf(
        await createRow(version.id, { classId: own.classId, teacherId: own.teacher }),
      );
      const noGrade = await load.teacher(t.north, { subjects: [{ subject, grades: [8] }] });
      refusedWith(
        await patch(
          `/api/timetable/versions/${version.id}/load/${row.id}`,
          rowBody({ teacherId: noGrade.staffId }),
        ),
        409,
        'load_teacher_grade',
      );
      const closed = await load.classes.room(t.north, 'closed');
      refusedWith(
        await patch(
          `/api/timetable/versions/${version.id}/load/${row.id}`,
          rowBody({ teacherId: own.teacher, roomId: closed }),
        ),
        409,
        'load_room_closed',
      );
      const better = await load.teacher(t.north, { subjects: [{ subject, grades: [7] }] });
      expect(
        rowOf(
          await patch(
            `/api/timetable/versions/${version.id}/load/${row.id}`,
            rowBody({ teacherId: better.staffId }),
          ),
        ).teacher.id,
      ).toBe(better.staffId);
    });

    it('deletes a row of a draft and keeps the whole row in the audit entry', async () => {
      const version = await draft();
      const own = await fitting();
      const row = rowOf(
        await createRow(version.id, { classId: own.classId, teacherId: own.teacher }),
      );
      const response = await remove(`/api/timetable/versions/${version.id}/load/${row.id}`);
      expect(response.status, JSON.stringify(response.body)).toBe(204);
      const [entry] = await t.entries('teaching_load.delete', row.id);
      expect(entry).toMatchObject({
        assignment_id: t.viceAssignment,
        request_id: response.headers['x-request-id'],
        old_value: {
          versionId: version.id,
          classId: own.classId,
          subjectId: subject,
          teacherId: own.teacher,
          lessonsPerWeek: 3,
        },
      });
      expect(
        await t.database.migrator
          .selectFrom('teaching_load_rows')
          .select('id')
          .where('id', '=', row.id)
          .execute(),
      ).toEqual([]);
    });
  });

  describe('the teachers a row may take (decision 2, correction 1)', () => {
    it('offers exactly the teachers a teacher change accepts (one rule engine)', async () => {
      const version = await draft();
      const own = await fitting();
      await load.teacher(t.north, { subjects: [{ subject, grades: [8] }] });
      await load.teacher(t.north, { languages: ['ru'], subjects: [{ subject, grades: [7] }] });
      const out = await load.teacher(t.north, { subjects: [{ subject, grades: [7] }] });
      await load.status(out.staffId, 'left', '2026-10-11');
      await load.vacancy(t.north, { subjects: [{ subject, grades: [7] }] });
      const offered = loadTeachersSchema.parse(
        (
          await get(
            `/api/timetable/versions/${version.id}/load/teachers?classId=${own.classId}&subjectId=${subject}`,
          ).expect(200)
        ).body,
      );
      expect(offered.defaultTeacherId).toBeNull();
      const row = rowOf(
        await createRow(version.id, { classId: own.classId, teacherId: own.teacher }),
      );
      const everyone = await t.database.migrator
        .selectFrom('staff_branches')
        .select('staff_id')
        .where('branch_id', '=', t.north)
        .execute();
      const accepted: string[] = [];
      for (const { staff_id: teacherId } of everyone) {
        const response = await patch(
          `/api/timetable/versions/${version.id}/load/${row.id}`,
          rowBody({ teacherId }),
        );
        if (response.status === 200) {
          accepted.push(teacherId);
        } else {
          expect(response.status, JSON.stringify(response.body)).toBe(409);
        }
      }
      expect(offered.teachers.map((one) => one.id).sort()).toEqual(accepted.sort());
    });

    // Task 3.5b, H30 of issue #105: why each one with the subject cannot take the row.
    it('names the reason of each teacher with the subject who cannot take the row', async () => {
      const version = await draft();
      const own = await fitting();
      const noGrade = await load.teacher(t.north, { subjects: [{ subject, grades: [8] }] });
      const noLanguage = await load.teacher(t.north, {
        languages: ['ru'],
        subjects: [{ subject, grades: [7] }],
      });
      const out = await load.teacher(t.north, { subjects: [{ subject, grades: [7] }] });
      await load.status(out.staffId, 'left', '2026-10-11');
      // A teacher of another branch with the subject is never named here.
      const southern = await load.teacher(t.south, { subjects: [{ subject, grades: [8] }] });
      const otherSubject = await load.classes.subject({ grades: [7] });
      const noSubject = await load.teacher(t.north, {
        subjects: [{ subject: otherSubject, grades: [7] }],
      });
      const offered = loadTeachersSchema.parse(
        (
          await get(
            `/api/timetable/versions/${version.id}/load/teachers?classId=${own.classId}&subjectId=${subject}`,
          ).expect(200)
        ).body,
      );
      const reasons = new Map(offered.excluded.map((one) => [one.id, one.reason]));
      expect(reasons.get(noGrade.staffId)).toBe('grade');
      expect(reasons.get(noLanguage.staffId)).toBe('language');
      expect(reasons.get(out.staffId)).toBe('status');
      expect(reasons.has(noSubject.staffId)).toBe(false);
      expect(reasons.has(southern.staffId)).toBe(false);
      expect(reasons.has(own.teacher)).toBe(false);
      expect(offered.noTutor).toBe(false);
      // A Tutor subject on a class with no Tutor says so.
      const tutorSubject = await load.tutorSubject({ grades: [7] });
      const lonely = await load.classes.schoolClass(t.north, year, { grade: 7 });
      const none = loadTeachersSchema.parse(
        (
          await get(
            `/api/timetable/versions/${version.id}/load/teachers?classId=${lonely}&subjectId=${tutorSubject}`,
          ).expect(200)
        ).body,
      );
      expect(none).toMatchObject({ teachers: [], noTutor: true });
    });

    // 3.4a correction 1 as narrowed by task 3.6c-2 (decision 1, review
    // correction 1): an ordinary subject offers the class's Tutor first and
    // preselects nobody; a Tutor row answers the Tutor alone, and no load
    // route accepts a teacher for it (done-when 3).
    it('puts the Tutor of the class first for an ordinary subject, and answers the Tutor alone for a Tutor row', async () => {
      const version = await draft();
      const tutorSubject = await load.tutorSubject({ grades: [7] });
      const classId = await load.classes.schoolClass(t.north, year, { grade: 7 });
      const person = await load.teacher(t.north, { subjects: [{ subject, grades: [7] }] });
      await load.tutorOf(t.north, classId, person.accountId);
      const other = await load.teacher(t.north, { subjects: [{ subject, grades: [7] }] });
      const ordinary = loadTeachersSchema.parse(
        (
          await get(
            `/api/timetable/versions/${version.id}/load/teachers?classId=${classId}&subjectId=${subject}`,
          ).expect(200)
        ).body,
      );
      expect(ordinary.tutorRow).toBe(false);
      expect(ordinary.teachers[0]).toMatchObject({ id: person.staffId, tutor: true });
      expect(ordinary.teachers.find((one) => one.id === other.staffId)?.tutor).toBe(false);
      expect(ordinary.defaultTeacherId).toBeNull();
      const tutors = loadTeachersSchema.parse(
        (
          await get(
            `/api/timetable/versions/${version.id}/load/teachers?classId=${classId}&subjectId=${tutorSubject}`,
          ).expect(200)
        ).body,
      );
      expect(tutors.tutorRow).toBe(true);
      expect(tutors.teachers.map((one) => [one.id, one.kind, one.tutor])).toEqual([
        [person.staffId, 'person', true],
      ]);
      expect(tutors.defaultTeacherId).toBe(person.staffId);
    });

    it('writes the class Tutor on a Tutor row and accepts no teacher for it (done-when 3)', async () => {
      const version = await draft();
      const tutorSubject = await load.tutorSubject({ grades: [7] });
      const classId = await load.classes.schoolClass(t.north, year, { grade: 7 });
      const person = await load.teacher(t.north);
      await load.tutorOf(t.north, classId, person.accountId);
      const other = await load.teacher(t.north);
      const audits = await t.auditCount();
      // Neither another teacher nor the Tutor named by hand.
      for (const teacherId of [other.staffId, person.staffId]) {
        refusedWith(
          await createRow(version.id, { classId, teacherId, subjectId: tutorSubject }),
          422,
          'load_tutor_row_teacher',
        );
      }
      expect(await t.auditCount()).toBe(audits);
      // The Homework slot and Ma'naviyat soati: the server writes the class
      // Tutor, without the subject in the profile (edge/timetable, Structure).
      const row = rowOf(
        await createRow(version.id, { classId, teacherId: null, subjectId: tutorSubject }),
      );
      expect(row.teacher.id).toBe(person.staffId);
      expect(row.problems).toEqual([]);
      // An edit names no teacher either; `null` keeps the Tutor.
      refusedWith(
        await patch(`/api/timetable/versions/${version.id}/load/${row.id}`, {
          teacherId: person.staffId,
          lessonsPerWeek: 2,
          roomId: null,
          roomType: null,
          doubleLessons: false,
        }),
        422,
        'load_tutor_row_teacher',
      );
      const edited = rowOf(
        await patch(`/api/timetable/versions/${version.id}/load/${row.id}`, {
          teacherId: null,
          lessonsPerWeek: 2,
          roomId: null,
          roomType: null,
          doubleLessons: false,
        }),
      );
      expect([edited.teacher.id, edited.lessonsPerWeek]).toEqual([person.staffId, 2]);
      // A class with no Tutor has nobody to write.
      const otherClass = await load.classes.schoolClass(t.north, year, { grade: 7 });
      refusedWith(
        await createRow(version.id, {
          classId: otherClass,
          teacherId: null,
          subjectId: tutorSubject,
        }),
        409,
        'load_no_tutor',
      );
      // Every other row needs its teacher.
      refusedWith(
        await createRow(version.id, { classId, teacherId: null }),
        422,
        'load_teacher_needed',
      );
    });
  });

  describe('a vacancy named by a row (04, Vacancy; decision 6)', () => {
    async function namedVacancy() {
      const version = await draft();
      const own = await fitting();
      const vacancy = await load.vacancy(t.north, { subjects: [{ subject, grades: [7] }] });
      const row = rowOf(await createRow(version.id, { classId: own.classId, teacherId: vacancy }));
      return { version, row, vacancy, own };
    }

    it('is neither closed nor deleted while the row names it, and is once the row is gone', async () => {
      const { version, row, vacancy } = await namedVacancy();
      for (const path of [
        `/api/people/vacancies/${vacancy}/close`,
        `/api/people/vacancies/${vacancy}/delete`,
      ]) {
        const before = await rowsOf();
        const response = await post(path);
        refusedWith(response, 409, 'vacancy_has_load');
        expect((response.body as { error: { details: unknown[] } }).error.details).toEqual([
          expect.objectContaining({ recordId: version.id }),
        ]);
        expect(await rowsOf()).toEqual(before);
      }
      await remove(`/api/timetable/versions/${version.id}/load/${row.id}`).expect(204);
      await post(`/api/people/vacancies/${vacancy}/close`).expect(200);
    });

    // Permission review of the build, S1: a vacancy named only by a row a
    // copy left may be deleted; the draft still reads, the row naming no one.
    it('is deleted when only a row a copy left names it, and the draft still reads', async () => {
      const source = await draft();
      const own = await fitting();
      const vacancy = await load.vacancy(t.north, { subjects: [{ subject, grades: [7] }] });
      const row = rowOf(await createRow(source.id, { classId: own.classId, teacherId: vacancy }));
      await t.database.migrator
        .deleteFrom('staff_subjects')
        .where('staff_id', '=', vacancy)
        .execute();
      const copy = versionOf(
        await post('/api/timetable/versions', {
          academicYearId: year,
          startsOn: MONDAY,
          copyFrom: source.id,
        }),
      );
      expect(copy.leftRows).toBe(1);
      await remove(`/api/timetable/versions/${source.id}/load/${row.id}`).expect(204);
      await post(`/api/people/vacancies/${vacancy}/delete`).expect(204);
      const answer = loadSchema.parse(
        (await get(`/api/timetable/versions/${copy.id}/load`).expect(200)).body,
      );
      expect(answer.leftRows).toMatchObject([
        { id: row.id, teacher: { id: vacancy, kind: 'vacancy', name: null } },
      ]);
    });

    it('refuses the close of a vacancy whose row was being written first', async () => {
      const version = await draft();
      const own = await fitting();
      const vacancy = await load.vacancy(t.north, { subjects: [{ subject, grades: [7] }] });
      const held = await holdOpen(async (transaction) => {
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', vacancy)
          .forKeyShare()
          .execute();
        await transaction
          .insertInto('teaching_load_rows')
          .values({
            branch_id: t.north,
            version_id: version.id,
            class_id: own.classId,
            subject_id: subject,
            teacher_id: vacancy,
            lessons_per_week: 2,
          })
          .execute();
      });
      const closing = post(`/api/people/vacancies/${vacancy}/close`).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await closing, 409, 'vacancy_has_load');
    });

    it('refuses a row for a vacancy whose close was being written first', async () => {
      const version = await draft();
      const own = await fitting();
      const vacancy = await load.vacancy(t.north, { subjects: [{ subject, grades: [7] }] });
      const held = await holdOpen(async (transaction) => {
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', vacancy)
          .forUpdate()
          .execute();
        await transaction
          .updateTable('staff_statuses')
          .set({ valid_until: '2026-10-10' })
          .where('staff_id', '=', vacancy)
          .execute();
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: vacancy, status: 'closed', valid_from: '2026-10-10' })
          .execute();
      });
      const creating = createRow(version.id, { classId: own.classId, teacherId: vacancy }).then(
        (response) => response,
      );
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await creating, 409, 'load_teacher_status');
    });
  });
});
