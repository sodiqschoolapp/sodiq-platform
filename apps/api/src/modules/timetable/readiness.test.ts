import { draftReadinessSchema, loadTotalsSchema, type DraftReadiness } from '@sodiq/shared';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  dayTemplatesKit,
  MONDAY,
  TOMORROW,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const readinessOf = (response: Response): DraftReadiness => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return draftReadinessSchema.parse(response.body);
};

/** The refusal a promise was given, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<{ constraint?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { constraint?: string };
  }
  throw new Error('The database did not refuse it.');
}

const WEDNESDAY = '2026-10-14';

// All names are invented. docs/spec/06-timetable.md, Building a timetable,
// steps 1 to 4 and their "ready when"; Rules, the availability row: "A draft
// is checked against the availability entry in force on its intended start
// date". Task 5.3a, pull request #127, with corrections 1 and 2 of its
// review. The clock stands at 23:55 on Saturday 10 October 2026 in Tashkent;
// a draft starts on Monday 12 October, and its week runs to Friday 16.
describe('the readiness of a draft, steps 1 to 4', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;

  beforeAll(async () => {
    t = await dayTemplatesKit();
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  const get = (path: string, branch: string, cookie = t.admin) => t.get(path, branch, cookie);
  const post = (path: string, branch: string, body: object = {}, cookie = t.admin) =>
    t.post(path, branch, body, cookie);

  const readiness = async (branch: string, version: string) =>
    readinessOf(await get(`/api/timetable/versions/${version}/readiness`, branch));
  const confirm = async (branch: string, version: string) =>
    readinessOf(await post(`/api/timetable/versions/${version}/templates/confirm`, branch));

  /** Hours of a person in the branch from a date, on the weekdays named, `until` its end. */
  async function hours(
    branch: string,
    staffId: string,
    from: string,
    weekdays: readonly number[],
    until?: string,
  ): Promise<void> {
    const entry = await t.database.migrator
      .insertInto('staff_availability')
      .values({
        branch_id: branch,
        staff_id: staffId,
        valid_from: from,
        ...(until === undefined ? {} : { valid_until: until }),
      })
      .returning(['id', 'valid_until'])
      .executeTakeFirstOrThrow();
    for (const weekday of weekdays) {
      await t.database.migrator
        .insertInto('staff_availability_ranges')
        .values({
          entry_id: entry.id,
          branch_id: branch,
          staff_id: staffId,
          weekday,
          start_minutes: 0,
          end_minutes: 1440,
          valid_from: from,
          valid_until: entry.valid_until,
        })
        .execute();
    }
  }

  /**
   * A branch of its own with three 45-minute lessons a day from tomorrow, a
   * class of grade 7 with its main classroom, a teacher with hours every
   * working day, and a draft from Monday with one row of `lessons`.
   */
  async function scene(input: { lessons?: number; withHours?: boolean } = {}) {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
    const lesson = await t.createSlotType(branch, 'Lesson', 'lesson', 45);
    const pause = await t.createSlotType(branch, 'Break', 'break', 10);
    const regular = await t.createTemplate(branch, 'Regular', [
      lesson,
      pause,
      lesson,
      pause,
      lesson,
    ]);
    const short = await t.createTemplate(branch, 'Short', [lesson, pause, lesson]);
    await t.assign(branch, regular);
    const subject = await load.classes.subject({ grades: [7] });
    const room = await load.classes.room(branch);
    const classId = await load.classes.schoolClass(branch, year, { grade: 7, room });
    const teacher = (await load.teacher(branch, { subjects: [{ subject, grades: [7] }] })).staffId;
    if (input.withHours !== false) {
      await hours(branch, teacher, '2026-09-01', [1, 2, 3, 4, 5]);
    }
    const created = await post('/api/timetable/versions', branch, {
      academicYearId: year,
      startsOn: MONDAY,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const version = (created.body as { id: string }).id;
    const row = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: classId,
      subject_id: subject,
      teacher_id: teacher,
      lessons_per_week: input.lessons ?? 3,
    });
    return { branch, year, version, row, classId, teacher, subject, room, regular, short };
  }

  it('reads a complete draft ready once its templates are confirmed', async () => {
    const s = await scene();
    await t.database.migrator
      .updateTable('staff')
      .set({ daily_lessons: 5, weekly_lessons: 18 })
      .where('id', '=', s.teacher)
      .execute();
    const before = await readiness(s.branch, s.version);
    expect(before.ready).toBe(false);
    expect(before.templates).toMatchObject({ ready: false, confirmed: false, startPast: false });
    expect(before.templates.cells).toHaveLength(5);
    expect(before.templates.cells[0]).toMatchObject({
      weekday: 1,
      grade: 7,
      date: MONDAY,
      template: { id: s.regular, name: 'Regular', lessonSlots: 3 },
    });
    expect(before.load).toMatchObject({ ready: true, rows: 1, problemRows: [], leftRows: 0 });
    expect(before.teachers.ready).toBe(true);
    expect(before.teachers.teachers).toEqual([
      expect.objectContaining({
        id: s.teacher,
        lessons: 3,
        freeSlots: 15,
        noHours: false,
        dailyLessons: 5,
        contract: 18,
      }),
    ]);
    expect(before.rooms).toEqual({ ready: true, rows: [], classesWithoutRoom: [] });
    const after = await confirm(s.branch, s.version);
    expect(after.templates).toMatchObject({ ready: true, confirmed: true, changed: [] });
    expect(after.ready).toBe(true);
    expect(await readiness(s.branch, s.version)).toEqual(after);
  });

  it('confirms in one audited write, and a second confirm of the same table writes nothing', async () => {
    const s = await scene();
    const entries = () =>
      t.database.migrator
        .selectFrom('audit_log')
        .select(['action', 'old_value', 'new_value'])
        .where('record_id', '=', s.version)
        .where('action', '=', 'timetable_version.templates_confirm')
        .execute();
    await confirm(s.branch, s.version);
    const stored = await t.database.migrator
      .selectFrom('timetable_versions')
      .select('templates_confirmed')
      .where('id', '=', s.version)
      .executeTakeFirstOrThrow();
    const confirmed = z
      .object({
        from: z.string(),
        cells: z.array(z.object({ weekday: z.int(), grade: z.int(), date: z.string() })),
      })
      .parse(stored.templates_confirmed);
    expect(confirmed.from).toBe(MONDAY);
    expect(confirmed.cells).toContainEqual({ weekday: 3, grade: 7, date: WEDNESDAY });
    const written = await entries();
    expect(written).toHaveLength(1);
    expect(written[0]?.old_value).toBeNull();
    const entry = z
      .object({
        from: z.string(),
        cells: z.array(z.object({ weekday: z.int(), grade: z.int(), templateId: z.string() })),
      })
      .parse(written[0]?.new_value);
    expect(entry.from).toBe(MONDAY);
    expect(entry.cells).toContainEqual({ weekday: 1, grade: 7, templateId: s.regular });
    const count = await t.auditCount();
    await confirm(s.branch, s.version);
    expect(await t.auditCount()).toBe(count);
    expect(await entries()).toHaveLength(1);
  });

  // Decision 2, review correction 2: the one entry in force on the start
  // date, for every weekday. Read weekday by weekday, Wednesday to Friday
  // would take the entry from Wednesday, which has no hours.
  it('reads the hours of the entry in force on the start date for the whole week, in readiness and the totals', async () => {
    const s = await scene({ withHours: false });
    await hours(s.branch, s.teacher, '2026-09-01', [1, 2, 3, 4, 5], WEDNESDAY);
    await hours(s.branch, s.teacher, WEDNESDAY, []);
    const found = (await readiness(s.branch, s.version)).teachers.teachers[0];
    expect(found).toMatchObject({ freeSlots: 15, noHours: false, over: false });
    const totals = loadTotalsSchema.parse(
      (await get(`/api/timetable/versions/${s.version}/totals`, s.branch).expect(200)).body,
    );
    expect(totals.teachers[0]?.freeSlots).toBe(15);
  });

  it('holds step 3 for a teacher with no hours entry in force, and one over the free slots', async () => {
    const none = await scene({ withHours: false });
    expect((await readiness(none.branch, none.version)).teachers).toMatchObject({
      ready: false,
      teachers: [{ id: none.teacher, freeSlots: null, noHours: true }],
    });
    const busy = await scene({ withHours: false });
    await hours(busy.branch, busy.teacher, '2026-09-01', [1]);
    expect((await readiness(busy.branch, busy.version)).teachers).toMatchObject({
      ready: true,
      teachers: [{ id: busy.teacher, lessons: 3, freeSlots: 3, over: false }],
    });
    await t.database.migrator
      .updateTable('teaching_load_rows')
      .set({ lessons_per_week: 4 })
      .where('id', '=', busy.row)
      .execute();
    expect((await readiness(busy.branch, busy.version)).teachers).toMatchObject({
      ready: false,
      teachers: [{ id: busy.teacher, lessons: 4, freeSlots: 3, over: true }],
    });
  });

  // Decision 2: each weekday on its first date on or after the start date.
  it('unconfirms the cells of a template that starts inside the first week, which step 2 counts too', async () => {
    const s = await scene({ lessons: 15 });
    expect((await confirm(s.branch, s.version)).load.ready).toBe(true);
    await t.assign(s.branch, s.short, { level: 'weekday', weekday: 3 }, WEDNESDAY);
    // A template from the Thursday of the next week is not in the first week.
    await t.assign(s.branch, s.short, { level: 'weekday', weekday: 4 }, '2026-10-22');
    const after = await readiness(s.branch, s.version);
    expect(after.templates).toMatchObject({
      ready: false,
      confirmed: false,
      changed: [{ weekday: 3, grade: 7 }],
    });
    expect(after.load).toMatchObject({
      ready: false,
      classesOver: [{ id: s.classId, lessons: 15, lessonSlots: 14 }],
    });
  });

  // Review correction 1: the table is compared, not its dates.
  it('stays confirmed when the start date moves and the table does not, and not when it does', async () => {
    const s = await scene();
    await confirm(s.branch, s.version);
    // A Friday template from Friday 30 October: after the Friday of each of
    // the first two weeks.
    await t.assign(s.branch, s.short, { level: 'weekday', weekday: 5 }, '2026-10-30');
    const move = async (startsOn: string) => {
      const response = await t.patch(
        `/api/timetable/versions/${s.version}`,
        s.branch,
        { startsOn },
        t.admin,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return readiness(s.branch, s.version);
    };
    expect((await move('2026-10-19')).templates).toMatchObject({ ready: true, confirmed: true });
    expect((await move('2026-10-26')).templates).toMatchObject({
      ready: false,
      changed: [{ weekday: 5, grade: 7 }],
    });
  });

  it('holds step 1 for a start date that has passed', async () => {
    const s = await scene();
    await confirm(s.branch, s.version);
    await t.database.migrator
      .updateTable('timetable_versions')
      .set({ starts_on: '2026-10-05' })
      .where('id', '=', s.version)
      .execute();
    const found = await readiness(s.branch, s.version);
    expect(found.templates).toMatchObject({ ready: false, startPast: true, confirmed: true });
    expect(found.ready).toBe(false);
  });

  it('holds step 2 for a row with a problem and for rows a copy left', async () => {
    const s = await scene();
    await load.status(s.teacher, 'inactive', TOMORROW);
    const found = await readiness(s.branch, s.version);
    expect(found.load).toMatchObject({ ready: false });
    expect(found.load.problemRows.map((row) => [row.id, row.problems])).toEqual([
      [s.row, ['load_teacher_status']],
    ]);
    // A copy leaves the row of a teacher who is no longer active and takes the other.
    const other = await scene();
    const second = await load.classes.subject({ grades: [7] });
    const kept = (
      await load.teacher(other.branch, { subjects: [{ subject: second, grades: [7] }] })
    ).staffId;
    await hours(other.branch, kept, '2026-09-01', [1, 2, 3, 4, 5]);
    await load.row({
      branch_id: other.branch,
      version_id: other.version,
      class_id: other.classId,
      subject_id: second,
      teacher_id: kept,
    });
    await load.status(other.teacher, 'inactive', TOMORROW);
    const copied = await post('/api/timetable/versions', other.branch, {
      academicYearId: other.year,
      startsOn: MONDAY,
      copyFrom: other.version,
    });
    expect(copied.status, JSON.stringify(copied.body)).toBe(201);
    const copy = (copied.body as { id: string }).id;
    expect((await readiness(other.branch, copy)).load).toEqual({
      ready: false,
      rows: 1,
      problemRows: [],
      leftRows: 1,
      classesOver: [],
    });
  });

  it('holds step 4 for a room type with no room that is not closed, and a closed room named', async () => {
    const s = await scene();
    await t.database.migrator
      .updateTable('teaching_load_rows')
      .set({ room_type: 'laboratory' })
      .where('id', '=', s.row)
      .execute();
    // Permission review, should-fix 1: another branch's laboratory never counts.
    const elsewhere = await load.classes.room(t.north);
    await t.database.migrator
      .updateTable('rooms')
      .set({ type: 'laboratory' })
      .where('id', '=', elsewhere)
      .execute();
    const none = await readiness(s.branch, s.version);
    expect(none.rooms.ready).toBe(false);
    expect(none.rooms.rows.map((row) => [row.id, row.reason])).toEqual([[s.row, 'room_type_none']]);
    expect(none.load.ready).toBe(true);
    // The only laboratory of the branch is under repair: it still counts.
    const laboratory = await load.classes.room(s.branch);
    await t.database.migrator
      .updateTable('rooms')
      .set({ type: 'laboratory', status: 'under_repair' })
      .where('id', '=', laboratory)
      .execute();
    expect((await readiness(s.branch, s.version)).rooms.ready).toBe(true);
    await t.database.migrator
      .updateTable('rooms')
      .set({ status: 'closed' })
      .where('id', '=', laboratory)
      .execute();
    expect((await readiness(s.branch, s.version)).rooms.rows.map((row) => row.reason)).toEqual([
      'room_type_none',
    ]);
    const named = await scene();
    await t.database.migrator
      .updateTable('teaching_load_rows')
      .set({ room_id: named.room })
      .where('id', '=', named.row)
      .execute();
    await t.database.migrator
      .updateTable('rooms')
      .set({ status: 'closed' })
      .where('id', '=', named.room)
      .execute();
    const closed = await readiness(named.branch, named.version);
    expect(closed.rooms.rows.map((row) => [row.id, row.reason])).toEqual([
      [named.row, 'load_room_closed'],
    ]);
    // Decision 7: the room problem is step 4's, not step 2's.
    expect(closed.load).toMatchObject({ ready: true, problemRows: [] });
  });

  it('lists a class with no main classroom and stays ready', async () => {
    const s = await scene();
    const bare = await load.classes.schoolClass(s.branch, s.year, { grade: 7 });
    // Permission review, should-fix 1: another branch's class without a room is not listed.
    const northYear = await load.classes.year(t.north, 'planned', '2027-09-01', '2028-05-31');
    await load.classes.schoolClass(t.north, northYear, { grade: 7 });
    await confirm(s.branch, s.version);
    const found = await readiness(s.branch, s.version);
    expect(found.rooms.ready).toBe(true);
    expect(found.rooms.classesWithoutRoom.map((one) => one.id)).toEqual([bare]);
    expect(found.ready).toBe(true);
  });

  it('holds step 1 for a grade with no template, and step 2 for a draft with no row', async () => {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
    await load.classes.schoolClass(branch, year, { grade: 7 });
    const created = await post('/api/timetable/versions', branch, {
      academicYearId: year,
      startsOn: MONDAY,
    });
    const version = (created.body as { id: string }).id;
    const found = await confirm(branch, version);
    expect(found.templates).toMatchObject({ ready: false, confirmed: true });
    expect(found.templates.missing).toHaveLength(5);
    expect(found.load).toMatchObject({ ready: false, rows: 0 });
  });

  it('refuses a confirm in a closed year, writing nothing', async () => {
    const s = await scene();
    await load.classes.setYear(s.year, 'closed');
    const count = await t.auditCount();
    refusedWith(
      await post(`/api/timetable/versions/${s.version}/templates/confirm`, s.branch),
      409,
      'timetable_year_closed',
    );
    expect(await t.auditCount()).toBe(count);
    const stored = await t.database.migrator
      .selectFrom('timetable_versions')
      .select('templates_confirmed')
      .where('id', '=', s.version)
      .executeTakeFirstOrThrow();
    expect(stored.templates_confirmed).toBeNull();
  });

  // 0068: the database keeps the confirmation to a draft of an open year, as
  // it keeps starts_on and left_rows (0055).
  it('is refused by the database outside a draft of an open year', async () => {
    const s = await scene();
    const write = () =>
      t.database.migrator
        .updateTable('timetable_versions')
        .set({ templates_confirmed: JSON.stringify({ from: MONDAY, cells: [] }) })
        .where('id', '=', s.version)
        .execute();
    await load.setVersion(s.version, 'published');
    expect((await refusal(write())).constraint).toBe('timetable_versions_draft');
    await load.setVersion(s.version, 'draft');
    await load.classes.setYear(s.year, 'closed');
    expect((await refusal(write())).constraint).toBe('version_year_closed');
  });

  it("answers 404 for another branch's version and an unknown one, changing nothing, and 403 to a Teacher", async () => {
    const southYear = await load.classes.year(t.south);
    const southern = await load.version(t.south, southYear, { startsOn: TOMORROW });
    const northYear = await load.classes.year(t.north);
    const northern = await load.version(t.north, northYear, { startsOn: MONDAY });
    const rows = () =>
      Promise.all([
        t.database.migrator.selectFrom('timetable_versions').selectAll().orderBy('id').execute(),
        t.database.migrator.selectFrom('teaching_load_rows').selectAll().orderBy('id').execute(),
        t.auditCount(),
      ]);
    // Permission review, should-fix 3: the other branch's version holds a confirmed table to keep.
    readinessOf(
      await post(`/api/timetable/versions/${southern}/templates/confirm`, t.south, {}, t.admin),
    );
    const before = await rows();
    expect(before[0].find((one) => one.id === southern)?.templates_confirmed).not.toBeNull();
    for (const cookie of [t.vicePrincipal, t.admin]) {
      for (const id of [southern, UNKNOWN]) {
        refusedWith(
          await get(`/api/timetable/versions/${id}/readiness`, t.north, cookie),
          404,
          'not_found',
        );
        refusedWith(
          await post(`/api/timetable/versions/${id}/templates/confirm`, t.north, {}, cookie),
          404,
          'not_found',
        );
      }
    }
    expect(await rows()).toEqual(before);
    refusedWith(
      await get(`/api/timetable/versions/${northern}/readiness`, t.north, t.teacher),
      403,
      'permission_denied',
    );
    readinessOf(await get(`/api/timetable/versions/${northern}/readiness`, t.north, t.principal));
    refusedWith(
      await post(`/api/timetable/versions/${northern}/templates/confirm`, t.north, {}, t.principal),
      403,
      'permission_denied',
    );
  });
});
