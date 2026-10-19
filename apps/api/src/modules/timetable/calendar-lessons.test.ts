import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  calendarPreviewSchema,
  timetableVersionSchema,
  type CalendarPreview,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  MONDAY,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const okay = (response: Response, status = 200) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body as { id: string };
};

/** The quarters of the year 2026-09-01 to 2027-05-31, dated. */
const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

/** Mondays of the first quarter after the version's start. */
const OCT19 = '2026-10-19';
const OCT26 = '2026-10-26';
/** Saturday 24 October, worked "by Monday's timetable" in a test. */
const OCT24 = '2026-10-24';
/** The second quarter's first day, a Monday: the start of a second version. */
const NOVEMBER = '2026-11-09';

// All names are invented. Task 5.6b-1: a calendar entry saved over published
// dates writes the lessons of the dates it changes from the version in force
// (edge/time-dates-calendar: "A day off is announced for a future date. ...
// The lessons of that date are removed"; "A day off is taken back, or a
// school day is added. Lessons are created from the timetable version in
// force on that date and checked like a publish"; edge/timetable, Versions
// and drafts: "Publish, a calendar change and a template change each test
// every affected date with the full rule set"). The clock stands at 23:55
// on Saturday 10 October 2026 in Tashkent.
describe('calendar entries after publishing', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  const post = (path: string, branch: string, body: object = {}, cookie = t.admin) =>
    t.post(path, branch, body, cookie);

  const publish = (branch: string, version: string, startsOn: string) =>
    request(t.kit.server)
      .post(`/api/timetable/versions/${version}/publish`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ startsOn });

  /** A day off of the whole branch, or of a range of grades. */
  const dayOff = (
    first: string,
    last: string = first,
    grades: { gradeFrom: number | null; gradeTo: number | null } = {
      gradeFrom: null,
      gradeTo: null,
    },
    name = 'Navruz',
  ) => ({
    kind: 'day_off',
    name,
    firstDate: first,
    lastDate: last,
    ...grades,
    dayTemplateId: null,
    followsWeekday: null,
    examWeek: null,
  });

  /** A special day on a template. */
  const specialDay = (
    first: string,
    last: string,
    dayTemplateId: string,
    extra: { followsWeekday?: number | null; examWeek?: string | null } = {},
  ) => ({
    kind: 'special_day',
    name: 'Open day',
    firstDate: first,
    lastDate: last,
    gradeFrom: null,
    gradeTo: null,
    dayTemplateId,
    followsWeekday: extra.followsWeekday ?? null,
    examWeek: extra.examWeek ?? null,
  });

  const create = (branch: string, record: object, cookie = t.admin) =>
    post('/api/setup/calendar-entries', branch, record, cookie);

  const preview = async (branch: string, change: object): Promise<CalendarPreview> => {
    const response = await post('/api/setup/calendar-entries/preview', branch, change);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return calendarPreviewSchema.parse(response.body);
  };

  /** Hours of a person in the branch from `from` (until `until`), on the weekdays given, all day. */
  async function hours(
    branch: string,
    staffId: string,
    weekdays: readonly number[] = [1, 2, 3, 4, 5],
    from = '2026-09-01',
    until?: string,
  ) {
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

  const draft = async (branch: string, year: string, copyFrom: string | null = null) => {
    const created = await post('/api/timetable/versions', branch, {
      academicYearId: year,
      startsOn: MONDAY,
      copyFrom,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return (created.body as { id: string }).id;
  };

  const placeAt = async (
    branch: string,
    version: string,
    loadRowId: string,
    weekday: number,
    slotPosition = 1,
  ) => {
    const placed = await post(`/api/timetable/versions/${version}/pattern`, branch, {
      loadRowId,
      weekday,
      slotPosition,
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  };

  const confirmTemplates = async (branch: string, version: string) => {
    const confirmed = await post(`/api/timetable/versions/${version}/templates/confirm`, branch);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  };

  /**
   * A branch of its own with a year of four dated quarters, a day of lesson,
   * break, lesson, break, lesson on every weekday from 08:00, two classes of
   * grades 7 and 10, and a version published from Monday 12 October: maths of
   * the grade-7 class in slot 1 and history of the grade-10 class in slot 3,
   * both on Mondays, each with its own teacher.
   */
  async function scene(input: { group?: boolean } = {}) {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
    for (const [index, [start, end]] of QUARTERS.entries()) {
      await t.database.migrator
        .updateTable('quarters')
        .set({ start_date: start, end_date: end })
        .where('academic_year_id', '=', year)
        .where('number', '=', index + 1)
        .execute();
    }
    const lesson = await t.createSlotType(branch, 'Lesson', 'lesson', 45);
    const pause = await t.createSlotType(branch, 'Break', 'break', 10);
    const regular = await t.createTemplate(branch, 'Regular', [
      lesson,
      pause,
      lesson,
      pause,
      lesson,
    ]);
    // One lesson slot only, for a shortened day.
    const short = await t.createTemplate(branch, 'Short', [lesson]);
    await t.assign(branch, regular);
    const maths = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const history = await load.classes.subject({ grades: [10], journalType: 'attendance_only' });
    const room = await load.classes.room(branch);
    const seniorRoom = await load.classes.room(branch);
    const classId = await load.classes.schoolClass(branch, year, { grade: 7, room });
    const seniorId = await load.classes.schoolClass(branch, year, {
      grade: 10,
      room: seniorRoom,
    });
    const teacherId = (await load.teacher(branch, { subjects: [{ subject: maths, grades: [7] }] }))
      .staffId;
    await hours(branch, teacherId);
    const seniorTeacher = (
      await load.teacher(branch, { subjects: [{ subject: history, grades: [10] }] })
    ).staffId;
    await hours(branch, seniorTeacher);
    const version = await draft(branch, year);
    const rowId = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: classId,
      subject_id: maths,
      teacher_id: teacherId,
      lessons_per_week: 1,
    });
    const seniorRow = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: seniorId,
      subject_id: history,
      teacher_id: seniorTeacher,
      lessons_per_week: 1,
    });
    await placeAt(branch, version, rowId, 1, 1);
    await placeAt(branch, version, seniorRow, 1, 3);
    // With `group`: physical education of a group of a grade-9 class and the
    // grade-10 class (`edge/timetable`, Structure, "Physical education joins a
    // grade-9 and a grade-10 class"), in slot 5 on Mondays.
    let groupId: string | null = null;
    if (input.group === true) {
      const nineId = await load.classes.schoolClass(branch, year, {
        grade: 9,
        room: await load.classes.room(branch),
      });
      const sport = await load.classes.subject({ grades: [9, 10], journalType: 'attendance_only' });
      const coach = (
        await load.teacher(branch, { subjects: [{ subject: sport, grades: [9, 10] }] })
      ).staffId;
      await hours(branch, coach);
      groupId = await load.classes.group(branch, year, sport, [nineId, seniorId]);
      const groupRow = await load.row({
        branch_id: branch,
        version_id: version,
        group_id: groupId,
        subject_id: sport,
        teacher_id: coach,
        lessons_per_week: 1,
      });
      await placeAt(branch, version, groupRow, 1, 5);
    }
    await confirmTemplates(branch, version);
    await load.freeEditLock(version);
    const published = await publish(branch, version, MONDAY);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    timetableVersionSchema.parse(published.body);
    return {
      branch,
      year,
      maths,
      history,
      room,
      classId,
      seniorId,
      teacherId,
      seniorTeacher,
      version,
      rowId,
      seniorRow,
      regular,
      short,
      groupId,
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /**
   * A copy of the scene's version with its rows placed again on Mondays,
   * maths in `mathsSlot` and history in the other lesson slot of 1 and 3,
   * published from `startsOn`.
   */
  async function nextVersion(s: Scene, startsOn: string, mathsSlot = 1): Promise<string> {
    const next = await draft(s.branch, s.year, s.version);
    await t.database.migrator.deleteFrom('pattern_blocks').where('version_id', '=', next).execute();
    const rows = await t.database.migrator
      .selectFrom('teaching_load_rows')
      .select(['id', 'subject_id'])
      .where('version_id', '=', next)
      .execute();
    for (const row of rows) {
      await placeAt(
        s.branch,
        next,
        row.id,
        1,
        row.subject_id === s.maths ? mathsSlot : 4 - mathsSlot,
      );
    }
    await confirmTemplates(s.branch, next);
    await load.freeEditLock(next);
    const published = await publish(s.branch, next, startsOn);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    return next;
  }

  /** The dated lessons of a branch, by date, start and id. */
  const lessonsOf = (branch: string) =>
    t.database.migrator
      .selectFrom('lessons')
      .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
      .select([
        'lessons.id',
        'lessons.block_id',
        sql<string>`lessons.lesson_date::text`.as('date'),
        'lessons.class_id',
        'lessons.group_id',
        'lessons.subject_id',
        'lessons.teacher_id',
        'lessons.cancel_cause',
        'lessons.starts_at',
        'lesson_blocks.version_id',
      ])
      .where('lessons.branch_id', '=', branch)
      .orderBy('lessons.lesson_date')
      .orderBy('lessons.starts_at')
      .orderBy('lessons.id')
      .execute();

  const lessonsOn = async (branch: string, date: string) =>
    (await lessonsOf(branch)).filter((one) => one.date === date);

  const claimsOf = (branch: string) =>
    t.database.migrator
      .selectFrom('time_claims')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('id')
      .execute();

  const noticesOf = (branch: string) =>
    t.database.migrator
      .selectFrom('notifications')
      .select(['kind', 'account_id', 'data'])
      .where('branch_id', '=', branch)
      .where('kind', '=', 'timetable.calendar_changed')
      .orderBy('id')
      .execute();

  const accountOf = async (staffId: string) =>
    (
      await t.database.migrator
        .selectFrom('staff')
        .select('account_id')
        .where('id', '=', staffId)
        .executeTakeFirstOrThrow()
    ).account_id;

  const marksOf = (branch: string) =>
    t.database.migrator
      .selectFrom('lesson_changes')
      .select('lesson_id')
      .where('branch_id', '=', branch)
      .orderBy('lesson_id')
      .execute();

  describe('a day off', () => {
    it('removes the lessons of its date and their claims, tells their teachers, and leaves the next date', async () => {
      const s = await scene();
      const before = await lessonsOf(s.branch);
      const on19 = before.filter((one) => one.date === OCT19);
      const on26 = before.filter((one) => one.date === OCT26);
      expect(on19).toHaveLength(2);
      const claimsBefore = await claimsOf(s.branch);

      const saved = okay(await create(s.branch, dayOff(OCT19)), 201);

      expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
      expect(await lessonsOn(s.branch, OCT26)).toEqual(on26);
      const claimsAfter = await claimsOf(s.branch);
      const removedIds = new Set(on19.map((one) => one.id));
      const removedBlocks = new Set(on19.map((one) => one.block_id));
      expect(claimsAfter).toEqual(
        claimsBefore.filter(
          (one) =>
            !removedIds.has(String(one.lesson_id)) && !removedBlocks.has(String(one.block_id)),
        ),
      );
      expect(claimsAfter.length).toBeLessThan(claimsBefore.length);

      const [entry] = await t.entries('calendar_entry.create', saved.id);
      const newValue = entry?.new_value as {
        lessonDates: string[];
        datedLessons: { removed: { id: string }[] }[];
        notices: { notified: number };
      };
      expect(newValue.lessonDates).toEqual([OCT19]);
      expect(newValue.datedLessons.flatMap((one) => one.removed.map((r) => r.id)).sort()).toEqual(
        [...removedIds].sort(),
      );
      const notices = await noticesOf(s.branch);
      expect(notices.map((one) => one.account_id).sort()).toEqual(
        [await accountOf(s.teacherId), await accountOf(s.seniorTeacher)].sort(),
      );
      expect(notices[0]?.data).toMatchObject({
        name: 'Navruz',
        firstDate: OCT19,
        lastDate: OCT19,
        weekStart: OCT19,
      });
      expect(newValue.notices.notified).toBe(2);
    });

    it('for grades 9 to 11 removes only their lessons; the other grades keep theirs, unmarked and untold', async () => {
      const s = await scene();
      const juniorBefore = (await lessonsOn(s.branch, OCT19)).filter(
        (one) => one.class_id === s.classId,
      );

      okay(await create(s.branch, dayOff(OCT19, OCT19, { gradeFrom: 9, gradeTo: 11 })), 201);

      const after = await lessonsOn(s.branch, OCT19);
      expect(after).toEqual(juniorBefore);
      const marked = new Set((await marksOf(s.branch)).map((one) => one.lesson_id));
      expect(juniorBefore.some((one) => marked.has(one.id))).toBe(false);
      expect((await noticesOf(s.branch)).map((one) => one.account_id)).toEqual([
        await accountOf(s.seniorTeacher),
      ]);
    });

    // Interim until 5.6b-3 (decision 11): the choice per block is not asked
    // yet, the block is written as the expansion writes it (`blockOn`). This
    // is not the rule of `edge/time-dates-calendar`, "A day off for grade 9
    // only, and a group joins 9 Edinburgh and 10 Brown"; 5.6b-3 replaces it.
    it('for grade 9 only writes a group of grades 9 and 10 cancelled "day off" (interim, until 5.6b-3)', async () => {
      const s = await scene({ group: true });
      const before = (await lessonsOn(s.branch, OCT19)).find((one) => one.group_id === s.groupId);
      expect(before?.cancel_cause).toBeNull();

      okay(await create(s.branch, dayOff(OCT19, OCT19, { gradeFrom: 9, gradeTo: 9 })), 201);

      const after = await lessonsOn(s.branch, OCT19);
      expect(
        after.filter((one) => one.group_id === s.groupId).map((one) => one.cancel_cause),
      ).toEqual(['day_off']);
      expect(
        after.filter((one) => one.class_id === s.seniorId).map((one) => one.cancel_cause),
      ).toEqual([null]);
    });

    it('taken back creates the lessons again from the version in force, checked like a publish', async () => {
      const s = await scene();
      const saved = okay(await create(s.branch, dayOff(OCT19)), 201);
      expect(await lessonsOn(s.branch, OCT19)).toEqual([]);

      okay(await post(`/api/setup/calendar-entries/${saved.id}/archive`, s.branch));

      const again = await lessonsOn(s.branch, OCT19);
      expect(
        again.map((one) => [one.class_id, one.subject_id, one.teacher_id, one.version_id]),
      ).toEqual([
        [s.classId, s.maths, s.teacherId, s.version],
        [s.seniorId, s.history, s.seniorTeacher, s.version],
      ]);
      expect(again.every((one) => one.cancel_cause === null)).toBe(true);
      const [entry] = await t.entries('calendar_entry.archive', saved.id);
      expect((entry?.new_value as { lessonDates: string[] }).lessonDates).toEqual([OCT19]);
    });

    it('shortened by its last date gives the dates it no longer covers their lessons back', async () => {
      const s = await scene();
      const saved = okay(await create(s.branch, dayOff(OCT19, OCT26)), 201);
      expect(await lessonsOn(s.branch, OCT26)).toEqual([]);

      okay(
        await t.patch(`/api/setup/calendar-entries/${saved.id}`, s.branch, dayOff(OCT19, OCT19)),
      );

      expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
      expect(await lessonsOn(s.branch, OCT26)).toHaveLength(2);
    });

    it('with nothing published, or on dates where the version in force has no lesson, writes no lesson and tells nobody', async () => {
      const branch = await t.newBranch();
      await load.classes.year(branch);
      const lesson = await t.createSlotType(branch, 'Lesson', 'lesson', 45);
      await t.assign(branch, await t.createTemplate(branch, 'Regular', [lesson]));
      const saved = okay(await create(branch, dayOff(OCT19)), 201);
      const [entry] = await t.entries('calendar_entry.create', saved.id);
      expect(entry?.new_value).not.toHaveProperty('lessonDates');

      const s = await scene();
      // Tuesday 13 October to Friday 16 October: the version runs there and has no lesson on those weekdays.
      const lessons = await lessonsOf(s.branch);
      const kept = okay(await create(s.branch, dayOff('2026-10-13', '2026-10-16')), 201);
      expect(await lessonsOf(s.branch)).toEqual(lessons);
      const [keptEntry] = await t.entries('calendar_entry.create', kept.id);
      expect((keptEntry?.new_value as { lessonDates: string[] }).lessonDates).toEqual([
        '2026-10-13',
        '2026-10-14',
        '2026-10-15',
        '2026-10-16',
      ]);
      expect(await noticesOf(s.branch)).toEqual([]);
    });
  });

  describe('a special day', () => {
    it('on a shortened template creates the lessons beyond its slots cancelled "not in the day\'s template", listed in the preview', async () => {
      const s = await scene();
      const change = { action: 'create', record: specialDay(OCT19, OCT19, s.short) };
      const shown = await preview(s.branch, change);
      expect(shown.lessons.cancelled.map((one) => [one.unitId, one.cause])).toEqual([
        [s.seniorId, 'not_in_template'],
      ]);
      expect(shown.lessons.removed.map((one) => one.unitId)).toEqual([s.seniorId]);
      expect(shown.lessons.blocked).toEqual([]);
      expect(shown.lessons.stored).toEqual([]);

      okay(await create(s.branch, specialDay(OCT19, OCT19, s.short)), 201);

      const after = await lessonsOn(s.branch, OCT19);
      expect(after.map((one) => [one.class_id, one.cancel_cause])).toEqual([
        [s.classId, null],
        [s.seniorId, 'not_in_template'],
      ]);
    });

    it("on a Saturday worked by Monday's timetable creates Monday's lessons; a teacher not there on Saturdays needs a teacher", async () => {
      const s = await scene();
      const record = specialDay(OCT24, OCT24, s.regular, { followsWeekday: 1 });
      const shown = await preview(s.branch, { action: 'create', record });
      expect(shown.lessons.created.map((one) => [one.date, one.unitId]).sort()).toEqual(
        [
          [OCT24, s.classId],
          [OCT24, s.seniorId],
        ].sort(),
      );
      expect(shown.lessons.needsTeacher.map((one) => [one.unitId, one.reason]).sort()).toEqual(
        [
          [s.classId, 'not_available_real_day'],
          [s.seniorId, 'not_available_real_day'],
        ].sort(),
      );

      okay(await create(s.branch, record), 201);

      const saturday = await lessonsOn(s.branch, OCT24);
      expect(saturday.map((one) => [one.class_id, one.teacher_id])).toEqual([
        [s.classId, null],
        [s.seniorId, null],
      ]);
    });

    it('in an exam week with "no regular lessons" cancels its lessons "exam week"; "regular lessons" gives them back; a later publish keeps them cancelled', async () => {
      const s = await scene();
      const record = specialDay(OCT26, '2026-10-30', s.regular, {
        examWeek: 'no_regular_lessons',
      });
      const saved = okay(await create(s.branch, record), 201);
      expect((await lessonsOn(s.branch, OCT26)).map((one) => one.cancel_cause)).toEqual([
        'exam_week',
        'exam_week',
      ]);

      okay(
        await t.patch(`/api/setup/calendar-entries/${saved.id}`, s.branch, {
          ...record,
          examWeek: 'regular_lessons',
        }),
      );
      expect((await lessonsOn(s.branch, OCT26)).map((one) => one.cancel_cause)).toEqual([
        null,
        null,
      ]);

      okay(await t.patch(`/api/setup/calendar-entries/${saved.id}`, s.branch, record));
      // A second version from 19 October, copied: the exam week stays cancelled.
      const next = await nextVersion(s, OCT19);
      expect(
        (await lessonsOn(s.branch, OCT26)).map((one) => [one.version_id, one.cancel_cause]),
      ).toEqual([
        [next, 'exam_week'],
        [next, 'exam_week'],
      ]);
    });
  });

  describe('dates of two versions', () => {
    it('are each written from the version in force on them', async () => {
      const s = await scene();
      // Version 2 from 9 November: history moves to slot 1, maths to slot 3.
      const next = await nextVersion(s, NOVEMBER, 3);
      const saved = okay(await create(s.branch, dayOff(OCT26, '2026-11-16')), 201);

      okay(await post(`/api/setup/calendar-entries/${saved.id}/archive`, s.branch));

      const october = await lessonsOn(s.branch, OCT26);
      const november = await lessonsOn(s.branch, '2026-11-16');
      expect(october.map((one) => [one.class_id, one.version_id])).toEqual([
        [s.classId, s.version],
        [s.seniorId, s.version],
      ]);
      expect(november.map((one) => [one.class_id, one.version_id])).toEqual([
        [s.seniorId, next],
        [s.classId, next],
      ]);
    });
  });

  describe('what the save refuses', () => {
    it("refuses a school day given back when a lesson meets the teacher's exam in another branch at that time, with nothing written", async () => {
      const s = await scene();
      const saved = okay(await create(s.branch, dayOff(OCT19)), 201);
      // The maths teacher invigilates an exam in another branch on 19 October
      // from 08:00 to 08:45, the time of the maths lesson given back.
      const other = await t.newBranch();
      const otherYear = await load.classes.year(other);
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: s.teacherId, branch_id: other, is_main: false })
        .execute();
      const otherClass = await load.classes.schoolClass(other, otherYear, {
        grade: 7,
        room: await load.classes.room(other),
      });
      const otherRoom = await load.classes.room(other);
      await t.database.migrator.transaction().execute(async (transaction) => {
        const written = await transaction
          .insertInto('exams')
          .values({
            branch_id: other,
            academic_year_id: otherYear,
            exam_date: OCT19,
            starts_at: new Date(`${OCT19}T08:00:00+05:00`),
            ends_at: new Date(`${OCT19}T08:45:00+05:00`),
            first_slot: 1,
            last_slot: 1,
            title: 'Quarter exam',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const room = await transaction
          .insertInto('exam_rooms')
          .values({ branch_id: other, exam_id: written.id, room_id: otherRoom })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('exam_room_classes')
          .values({
            branch_id: other,
            exam_id: written.id,
            exam_room_id: room.id,
            class_id: otherClass,
          })
          .execute();
        await transaction
          .insertInto('exam_invigilators')
          .values({
            branch_id: other,
            exam_id: written.id,
            exam_room_id: room.id,
            staff_id: s.teacherId,
          })
          .execute();
      });
      const rows = await storedRowsOf(s.branch);
      const before = await t.auditCount();

      const refused = await post(`/api/setup/calendar-entries/${saved.id}/archive`, s.branch);

      refusedWith(refused, 409, 'calendar_blocked');
      expect(
        detailsOf(refused).every((one) => one.code === 'date_blocked' && one.day === OCT19),
      ).toBe(true);
      expect(await storedRowsOf(s.branch)).toEqual(rows);
      expect(await t.auditCount()).toBe(before);
    });

    it("refuses a school day given back when a lesson falls outside its teacher's hours in force on that date, with nothing written", async () => {
      const s = await scene();
      const saved = okay(await create(s.branch, dayOff(OCT19)), 201);
      // From 19 October the maths teacher works no Mondays: the version, read as
      // if it started on the date given back, places maths outside the hours.
      await noMondaysFrom(s, s.teacherId, OCT19);
      const lessonsBefore = await lessonsOf(s.branch);
      const entriesBefore = await t.auditCount();

      const refused = await post(`/api/setup/calendar-entries/${saved.id}/archive`, s.branch);

      refusedWith(refused, 409, 'calendar_blocked');
      const details = (refused.body as { error: { details: { code: string; day: string }[] } })
        .error.details;
      expect(details.every((one) => one.code === 'date_blocked' && one.day === OCT19)).toBe(true);
      expect(details.length).toBeGreaterThan(0);
      expect(await lessonsOf(s.branch)).toEqual(lessonsBefore);
      expect(await t.auditCount()).toBe(entriesBefore);
      const stillArchived = await t.database.migrator
        .selectFrom('calendar_entries')
        .select('archived_at')
        .where('id', '=', saved.id)
        .executeTakeFirstOrThrow();
      expect(stillArchived.archived_at).toBeNull();
    });
  });

  /** A route that takes a request key (the one-day changes, the bulk cancel). */
  const keyed = (path: string, branch: string, body: object, cookie = t.admin) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send(body);

  const lessonOf = async (s: Scene, date: string, classId: string) => {
    const found = (await lessonsOn(s.branch, date)).find((one) => one.class_id === classId);
    if (found === undefined) throw new Error(`No lesson of ${classId} on ${date}.`);
    return found;
  };

  /** The refusal's details by their path. */
  const detailsOf = (response: Response) =>
    (response.body as { error: { details: { path: string; code: string; day?: string }[] } }).error
      .details;

  describe('stored records on a changed date (until 5.6b-2)', () => {
    it('refuse the save, each listed, with nothing written: a move onto the date, a room change, a bulk cancel and an exam', async () => {
      const s = await scene();
      // A move of 26 October's maths onto 19 October, slot 2.
      const moving = await lessonOf(s, OCT26, s.classId);
      okay(
        await keyed(`/api/timetable/lessons/${moving.id}/move`, s.branch, {
          date: OCT19,
          lessonNumber: 2,
          reason: 'Excursion to the museum',
        }),
      );
      const rows = await storedRowsOf(s.branch);
      const before = await t.auditCount();

      const refused = await create(s.branch, dayOff(OCT19));

      refusedWith(refused, 409, 'calendar_stored_changes');
      expect(detailsOf(refused).map((one) => [one.code, one.day])).toEqual([
        ['calendar_stored_changes', OCT19],
      ]);
      const shown = await preview(s.branch, { action: 'create', record: dayOff(OCT19) });
      expect(shown.lessons.stored.map((one) => one.kind)).toEqual(['day_change']);
      expect(shown.lessons.removed).toEqual([]);
      expect(await storedRowsOf(s.branch)).toEqual(rows);
      expect(await t.auditCount()).toBe(before);

      // A room change on a lesson of 2 November's week: Monday 2 November is a
      // vacation, so 16 November.
      const s2 = await scene();
      const roomed = await lessonOf(s2, '2026-11-16', s2.seniorId);
      okay(
        await keyed(`/api/timetable/lessons/${roomed.id}/room`, s2.branch, {
          roomId: s2.room,
          reason: 'The room is painted',
        }),
      );
      refusedWith(await create(s2.branch, dayOff('2026-11-16')), 409, 'calendar_stored_changes');

      // A bulk cancel of 23 November.
      const s3 = await scene();
      okay(
        await keyed('/api/timetable/bulk-cancels', s3.branch, {
          date: '2026-11-23',
          classIds: [s3.classId],
          lessonNumbers: [1],
          reason: 'Excursion to the museum',
          blocks: [],
          lessonIds: [(await lessonOf(s3, '2026-11-23', s3.classId)).id],
        }),
      );
      const bulk = await create(s3.branch, dayOff('2026-11-23'));
      refusedWith(bulk, 409, 'calendar_stored_changes');
      expect(detailsOf(bulk).map((one) => one.path.split('.')[1])).toEqual(['bulk_cancel']);

      // An exam on 30 November (exams have no route before 5.6c).
      const s4 = await scene();
      const examRoom = await load.classes.room(s4.branch);
      await t.database.migrator.transaction().execute(async (transaction) => {
        const written = await transaction
          .insertInto('exams')
          .values({
            branch_id: s4.branch,
            academic_year_id: s4.year,
            exam_date: '2026-11-30',
            starts_at: new Date('2026-11-30T09:50:00+05:00'),
            ends_at: new Date('2026-11-30T10:35:00+05:00'),
            first_slot: 5,
            last_slot: 5,
            title: 'Quarter exam',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const room = await transaction
          .insertInto('exam_rooms')
          .values({ branch_id: s4.branch, exam_id: written.id, room_id: examRoom })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('exam_room_classes')
          .values({
            branch_id: s4.branch,
            exam_id: written.id,
            exam_room_id: room.id,
            class_id: s4.classId,
          })
          .execute();
        await transaction
          .insertInto('exam_invigilators')
          .values({
            branch_id: s4.branch,
            exam_id: written.id,
            exam_room_id: room.id,
            staff_id: s4.seniorTeacher,
          })
          .execute();
      });
      const exam = await create(s4.branch, dayOff('2026-11-30'));
      refusedWith(exam, 409, 'calendar_stored_changes');
      expect(detailsOf(exam).map((one) => one.path.split('.')[1])).toEqual(['exam']);
    });
  });

  describe('the preview', () => {
    it('lists what the save then does and writes nothing', async () => {
      const s = await scene();
      const other = await scene();
      const rows = [await storedRowsOf(s.branch), await storedRowsOf(other.branch)];
      const before = await t.auditCount();

      const shown = await preview(s.branch, { action: 'create', record: dayOff(OCT19) });

      expect(await storedRowsOf(s.branch)).toEqual(rows[0]);
      expect(await storedRowsOf(other.branch)).toEqual(rows[1]);
      expect(await t.auditCount()).toBe(before);
      const on19 = await lessonsOn(s.branch, OCT19);
      expect(shown.lessons.removed.map((one) => [one.date, one.unitId, one.subjectId])).toEqual(
        on19.map((one) => [one.date, one.class_id, one.subject_id]),
      );
      expect(shown.lessons.created).toEqual([]);
      expect(shown.lessons.notified).toEqual([s.teacherId, s.seniorTeacher].sort());
      expect(shown.lessons.names.units.map((one) => one.id).sort()).toEqual(
        [s.classId, s.seniorId].sort(),
      );

      const saved = okay(await create(s.branch, dayOff(OCT19)), 201);
      const [entry] = await t.entries('calendar_entry.create', saved.id);
      const removed = (
        entry?.new_value as { datedLessons: { removed: { id: string }[] }[] }
      ).datedLessons.flatMap((one) => one.removed.map((r) => r.id));
      expect(removed.sort()).toEqual(on19.map((one) => one.id).sort());
      // The other branch's lessons of that date stay (`06`, Teachers who work
      // in several branches: "A day off in one branch does not cancel the
      // teacher's lessons in another").
      expect(await storedRowsOf(other.branch)).toEqual(rows[1]);
    });
  });

  describe('the past is closed', () => {
    it('a started entry renamed and lengthened writes only the dates it adds; the dates it kept are not touched', async () => {
      const s = await scene();
      // A day off of Friday 9 to Monday 12 October, started (today is 10
      // October), written as it stood before this task: its Monday's lessons
      // stand, and a save that does not change that date leaves them.
      const entry = await t.database.migrator
        .insertInto('calendar_entries')
        .values({
          branch_id: s.branch,
          kind: 'day_off',
          name: 'Navruz',
          first_date: '2026-10-09',
          last_date: MONDAY,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const on12 = await lessonsOn(s.branch, MONDAY);
      expect(on12).toHaveLength(2);
      const on26 = await lessonsOn(s.branch, OCT26);
      const marksBefore = await marksOf(s.branch);

      okay(
        await t.patch(
          `/api/setup/calendar-entries/${entry.id}`,
          s.branch,
          dayOff('2026-10-09', OCT19, { gradeFrom: null, gradeTo: null }, 'Autumn days'),
        ),
      );

      expect(await lessonsOn(s.branch, MONDAY)).toEqual(on12);
      expect(await lessonsOn(s.branch, OCT26)).toEqual(on26);
      expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
      const [edit] = await t.entries('calendar_entry.edit', entry.id);
      // The dates added: Tuesday 13 to Monday 19 October, school days.
      expect((edit?.new_value as { lessonDates: string[] }).lessonDates).toEqual([
        '2026-10-13',
        '2026-10-14',
        '2026-10-15',
        '2026-10-16',
        OCT19,
      ]);
      const marked = new Set((await marksOf(s.branch)).map((one) => one.lesson_id));
      expect(on12.some((one) => marked.has(one.id))).toBe(false);
      expect(marksBefore).toEqual([]);
      const notices = await noticesOf(s.branch);
      expect(notices.map((one) => (one.data as { weekStart: string }).weekStart)).toEqual([
        OCT19,
        OCT19,
      ]);

      // A rename alone writes no lesson and tells nobody.
      const lessons = await lessonsOf(s.branch);
      okay(
        await t.patch(
          `/api/setup/calendar-entries/${entry.id}`,
          s.branch,
          dayOff('2026-10-09', OCT19, { gradeFrom: null, gradeTo: null }, 'Autumn break'),
        ),
      );
      expect(await lessonsOf(s.branch)).toEqual(lessons);
      expect(await noticesOf(s.branch)).toHaveLength(2);
    });
  });

  // .claude/rules/api.md: an id of another branch or an unknown one is 404,
  // with every row the save now writes unchanged in both branches.
  it("answers 404 for another branch's or an unknown entry or template, with the lessons of both branches unchanged", async () => {
    const north = await scene();
    const south = await scene();
    const southEntry = okay(await create(south.branch, dayOff(OCT26)), 201);
    const northEntry = okay(await create(north.branch, specialDay(OCT19, OCT19, north.short)), 201);
    // A draft in each branch, which a save would mark out of date (permission review must-fix 2).
    await copyUnpublished(north);
    await copyUnpublished(south);
    // The Super Admin, and the Academic Vice Principal assigned in the branch (should-fix 6).
    const vice = await t.database.migrator
      .selectFrom('assignments')
      .select('account_id')
      .where('role', '=', 'academic_vice_principal')
      .where('branch_id', '=', t.north)
      .executeTakeFirstOrThrow();
    await load.classes.role(vice.account_id, north.branch, 'academic_vice_principal');
    const rows = [await storedRowsOf(north.branch), await storedRowsOf(south.branch)];
    const before = await t.auditCount();
    for (const cookie of [t.admin, t.vicePrincipal]) {
      const post = (path: string, branch: string, body: object = {}) =>
        t.post(path, branch, body, cookie);
      const create = (branch: string, record: object) =>
        post('/api/setup/calendar-entries', branch, record);
      for (const id of [southEntry.id, UNKNOWN]) {
        for (const attempt of [
          () => t.patch(`/api/setup/calendar-entries/${id}`, north.branch, dayOff(OCT26), cookie),
          () => post(`/api/setup/calendar-entries/${id}/archive`, north.branch),
          () => post(`/api/setup/calendar-entries/${id}/restore`, north.branch),
          () =>
            post('/api/setup/calendar-entries/preview', north.branch, { action: 'archive', id }),
          () =>
            post('/api/setup/calendar-entries/preview', north.branch, { action: 'restore', id }),
          () =>
            post('/api/setup/calendar-entries/preview', north.branch, {
              action: 'edit',
              id,
              record: dayOff(OCT26),
            }),
        ]) {
          expect((await attempt()).status).toBe(404);
        }
      }
      for (const template of [south.short, UNKNOWN]) {
        for (const attempt of [
          () => create(north.branch, specialDay(OCT26, OCT26, template)),
          () =>
            post('/api/setup/calendar-entries/preview', north.branch, {
              action: 'create',
              record: specialDay(OCT26, OCT26, template),
            }),
          () =>
            t.patch(
              `/api/setup/calendar-entries/${northEntry.id}`,
              north.branch,
              specialDay(OCT19, OCT19, template),
              cookie,
            ),
          () =>
            post('/api/setup/calendar-entries/preview', north.branch, {
              action: 'edit',
              id: northEntry.id,
              record: specialDay(OCT19, OCT19, template),
            }),
        ]) {
          expect((await attempt()).status).toBe(404);
        }
      }
    }
    expect(await storedRowsOf(north.branch)).toEqual(rows[0]);
    expect(await storedRowsOf(south.branch)).toEqual(rows[1]);
    expect(await t.auditCount()).toBe(before);
  });

  // Permission review must-fix 3 and should-fixes 4 and 5: every route whose
  // behaviour changed, refused for the Principal (who may view) and a
  // Teacher (no calendar right), each assigned in the branch first.
  it('refuses the Principal and a Teacher assigned in the branch on every calendar write and the preview, with nothing written', async () => {
    const s = await scene();
    const other = await scene();
    const saved = okay(await create(s.branch, dayOff(OCT19)), 201);
    const archived = okay(await create(s.branch, dayOff(OCT26)), 201);
    okay(await post(`/api/setup/calendar-entries/${archived.id}/archive`, s.branch));
    for (const role of ['principal', 'teacher'] as const) {
      const holder = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', role)
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      await load.classes.role(holder.account_id, s.branch, role);
    }
    const rows = [await storedRowsOf(s.branch), await storedRowsOf(other.branch)];
    const before = await t.auditCount();
    for (const cookie of [t.principal, t.teacher]) {
      for (const attempt of [
        () => create(s.branch, dayOff('2026-11-16'), cookie),
        () =>
          t.patch(
            `/api/setup/calendar-entries/${saved.id}`,
            s.branch,
            dayOff(OCT19, OCT26),
            cookie,
          ),
        () => post(`/api/setup/calendar-entries/${saved.id}/archive`, s.branch, {}, cookie),
        () => post(`/api/setup/calendar-entries/${archived.id}/restore`, s.branch, {}, cookie),
        () =>
          post(
            '/api/setup/calendar-entries/preview',
            s.branch,
            { action: 'create', record: dayOff('2026-11-16') },
            cookie,
          ),
      ]) {
        refusedWith(await attempt(), 403, 'permission_denied');
      }
    }
    expect(await storedRowsOf(s.branch)).toEqual(rows[0]);
    expect(await storedRowsOf(other.branch)).toEqual(rows[1]);
    expect(await t.auditCount()).toBe(before);
  });

  describe('at the same moment', () => {
    /** How many connections to the test database wait for a lock right now. */
    async function waitingForALock(): Promise<number> {
      const found = await sql<{ waiting: number }>`
        select count(distinct l.pid)::int as waiting
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and not l.granted
      `.execute(t.database.migrator);
      return found.rows[0]?.waiting ?? 0;
    }

    /** Runs `work` in a transaction of the application in `branch` that stays open until released. */
    async function holdOpen(branch: string, work: (transaction: Transaction) => Promise<void>) {
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
        .run([branch], async (transaction) => {
          await work(transaction);
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await Promise.race([isReady, done]);
      return { release, done };
    }

    /**
     * The two routes in a fixed order: a third transaction holds the scene's
     * year, at which both wait (the calendar save `for no key update`, the
     * others `for share` in `lockPublishChain`), the second starts once the
     * first waits.
     */
    async function inOrder(
      s: Scene,
      first: () => Promise<Response>,
      second: () => Promise<Response>,
      held: { table: 'academic_years' | 'classes' | 'staff'; id: string } = {
        table: 'academic_years',
        id: s.year,
      },
    ): Promise<[Response, Response]> {
      const gate = await holdOpen(s.branch, async (transaction) => {
        await transaction
          .selectFrom(held.table)
          .select('id')
          .where('id', '=', held.id)
          .forUpdate()
          .execute();
      });
      const waiting = await waitingForALock();
      const one = first().then((response) => response);
      await expect
        .poll(waitingForALock, { timeout: 20_000, interval: 50 })
        .toBeGreaterThan(waiting);
      const two = second().then((response) => response);
      await expect
        .poll(waitingForALock, { timeout: 20_000, interval: 50 })
        .toBeGreaterThan(waiting + 1);
      gate.release();
      expect(await gate.done).toBeUndefined();
      return [await one, await two];
    }

    it("a day off and a publish from its date: the publish after it sees the draft out of date; the day off after it removes the new version's lessons", async () => {
      for (const order of [0, 1]) {
        const s = await scene();
        const next = await copyUnpublished(s);
        const saveDayOff = () => create(s.branch, dayOff(OCT19));
        const publishNext = () => publish(s.branch, next, OCT19);
        if (order === 0) {
          const [saved, published] = await inOrder(s, saveDayOff, publishNext);
          expect(saved.status, JSON.stringify(saved.body)).toBe(201);
          refusedWith(published, 409, 'publish_blocked');
          expect(detailsOf(published).map((one) => one.code)).toEqual(['draft_out_of_date']);
          expect((await lessonsOn(s.branch, OCT26)).map((one) => one.version_id)).toEqual([
            s.version,
            s.version,
          ]);
        } else {
          const [published, saved] = await inOrder(s, publishNext, saveDayOff);
          expect(published.status, JSON.stringify(published.body)).toBe(200);
          expect(saved.status, JSON.stringify(saved.body)).toBe(201);
          expect((await lessonsOn(s.branch, OCT26)).map((one) => one.version_id)).toEqual([
            next,
            next,
          ]);
        }
        expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
      }
    });

    it('a day off and a move onto its date: the first stands, the second is refused', async () => {
      for (const order of [0, 1]) {
        const s = await scene();
        const moving = await lessonOf(s, OCT26, s.classId);
        const saveDayOff = () => create(s.branch, dayOff(OCT19));
        const moveOnto = () =>
          keyed(`/api/timetable/lessons/${moving.id}/move`, s.branch, {
            date: OCT19,
            lessonNumber: 2,
            reason: 'Excursion to the museum',
          });
        if (order === 0) {
          const [dayOffSaved, moved] = await inOrder(s, saveDayOff, moveOnto);
          expect(dayOffSaved.status, JSON.stringify(dayOffSaved.body)).toBe(201);
          refusedWith(moved, 409, 'day_change_blocked');
          expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
        } else {
          const [moved, dayOffSaved] = await inOrder(s, moveOnto, saveDayOff);
          expect(moved.status, JSON.stringify(moved.body)).toBe(200);
          refusedWith(dayOffSaved, 409, 'calendar_stored_changes');
          expect((await lessonsOn(s.branch, OCT19)).map((one) => one.id)).toContain(moving.id);
        }
      }
    });

    it('a day off and a withdraw of the version in force: no deadlock, the date has no lesson', async () => {
      for (const order of [0, 1]) {
        const s = await scene();
        const next = await copyUnpublished(s);
        expect((await publish(s.branch, next, OCT26)).status).toBe(200);
        const saveDayOff = () => create(s.branch, dayOff(OCT26));
        const withdraw = () => keyed(`/api/timetable/versions/${next}/withdraw`, s.branch, {});
        const [first, second] =
          order === 0
            ? await inOrder(s, saveDayOff, withdraw)
            : await inOrder(s, withdraw, saveDayOff);
        expect(first.status, JSON.stringify(first.body)).toBe(order === 0 ? 201 : 200);
        expect(second.status, JSON.stringify(second.body)).toBe(order === 0 ? 200 : 201);
        expect(await lessonsOn(s.branch, OCT26)).toEqual([]);
        expect((await lessonsOn(s.branch, '2026-11-16')).map((one) => one.version_id)).toEqual([
          s.version,
          s.version,
        ]);
      }
    });

    it('a day off and a bulk cancel of its date: the first stands, the second is refused', async () => {
      for (const order of [0, 1]) {
        const s = await scene();
        const lesson = await lessonOf(s, OCT19, s.classId);
        const saveDayOff = () => create(s.branch, dayOff(OCT19));
        const bulkCancel = () =>
          keyed('/api/timetable/bulk-cancels', s.branch, {
            date: OCT19,
            classIds: [s.classId],
            lessonNumbers: [1],
            reason: 'Excursion to the museum',
            blocks: [],
            lessonIds: [lesson.id],
          });
        if (order === 0) {
          const [saved, cancelled] = await inOrder(s, saveDayOff, bulkCancel);
          expect(saved.status, JSON.stringify(saved.body)).toBe(201);
          refusedWith(cancelled, 409, 'bulk_cancel_empty');
          expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
        } else {
          const [cancelled, saved] = await inOrder(s, bulkCancel, saveDayOff);
          expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
          refusedWith(saved, 409, 'calendar_stored_changes');
          expect(
            (await lessonsOn(s.branch, OCT19)).find((one) => one.id === lesson.id)?.cancel_cause,
          ).toBe('reason');
        }
      }
    });

    // Review correction 1: a class archive or a staff status change holds its
    // row `for update`, writes its audit entry (a key to the branch row) and
    // waits in `followTutors` for the year; the calendar save, holding the
    // branch row and then the year, waits for the class's or person's key.
    // The real routes, in both orders, with no deadlock.
    for (const holder of ['classes', 'staff'] as const) {
      it(`a day off and a ${holder === 'classes' ? 'class archive' : 'staff status change'} in either order: no deadlock`, async () => {
        for (const order of [0, 1]) {
          const s = await scene();
          const id =
            holder === 'classes'
              ? await load.classes.schoolClass(s.branch, s.year, {
                  grade: 8,
                  room: await load.classes.room(s.branch),
                })
              : (await load.teacher(s.branch, { subjects: [{ subject: s.maths, grades: [7] }] }))
                  .staffId;
          const saveDayOff = () => create(s.branch, dayOff(OCT19));
          const other = () =>
            holder === 'classes'
              ? post(`/api/classes/${id}/archive`, s.branch)
              : post(`/api/people/staff/${id}/status`, s.branch, {
                  status: 'inactive',
                  from: '2026-11-02',
                });
          const [first, second] =
            order === 0
              ? await inOrder(s, saveDayOff, other, { table: holder, id })
              : await inOrder(s, other, saveDayOff, { table: holder, id });
          const [saved, changed] = order === 0 ? [first, second] : [second, first];
          expect(saved.status, JSON.stringify(saved.body)).toBe(201);
          expect(changed.status, JSON.stringify(changed.body)).toBe(200);
          expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
        }
      });
    }
  });

  /** A copy of the scene's version with its rows placed again as in it, not published. */
  async function copyUnpublished(s: Scene): Promise<string> {
    const next = await draft(s.branch, s.year, s.version);
    await t.database.migrator.deleteFrom('pattern_blocks').where('version_id', '=', next).execute();
    const rows = await t.database.migrator
      .selectFrom('teaching_load_rows')
      .select(['id', 'subject_id'])
      .where('version_id', '=', next)
      .execute();
    for (const row of rows) {
      await placeAt(s.branch, next, row.id, 1, row.subject_id === s.maths ? 1 : 3);
    }
    await confirmTemplates(s.branch, next);
    await load.freeEditLock(next);
    return next;
  }

  /** Every row of the tables a calendar save now writes, in a branch. */
  async function storedRowsOf(branch: string) {
    const rows: Record<string, unknown[]> = {};
    for (const table of [
      'calendar_entries',
      'lessons',
      'lesson_blocks',
      'time_claims',
      'lesson_day_changes',
      'notifications',
      'timetable_versions',
      'timetable_version_out_of_date_causes',
    ] as const) {
      rows[table] = await t.database.migrator
        .selectFrom(table)
        .selectAll()
        .where('branch_id', '=', branch)
        .orderBy('id')
        .execute();
    }
    // The delivery jobs of the notices (permission review must-fix 1), every one.
    rows.jobs = (
      await sql<{ id: string }>`select id::text from pgboss.job order by id`.execute(
        t.database.migrator,
      )
    ).rows;
    rows.lesson_changes = await t.database.migrator
      .selectFrom('lesson_changes')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('lesson_id')
      .execute();
    return rows;
  }

  /**
   * The person's hours replaced: Monday to Friday until `from`, then
   * Tuesday to Friday only, a later availability entry (`edge/timetable`,
   * "A part-time teacher stops working Fridays from December").
   */
  async function noMondaysFrom(s: Scene, staffId: string, from: string) {
    await t.database.migrator
      .deleteFrom('staff_availability_ranges')
      .where('staff_id', '=', staffId)
      .execute();
    await t.database.migrator
      .deleteFrom('staff_availability')
      .where('staff_id', '=', staffId)
      .execute();
    await hours(s.branch, staffId, [1, 2, 3, 4, 5], '2026-09-01', from);
    await hours(s.branch, staffId, [2, 3, 4, 5], from);
  }
});
