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
  START,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { substitutedIn } from '../../testing/substitutions-kit.js';
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
  async function scene(input: { group?: boolean; three?: boolean; nineGroup?: boolean } = {}) {
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
    let nineGroupId: string | null = null;
    if (input.group === true || input.nineGroup === true) {
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
      // Task 5.6b-3 (code review round 1), with `nineGroup`: a group of the
      // grade-9 class alone, linked to the first by that class: one block with it.
      if (input.nineGroup === true) {
        nineGroupId = await load.classes.group(branch, year, sport, [nineId]);
        const nineCoach = (
          await load.teacher(branch, { subjects: [{ subject: sport, grades: [9] }] })
        ).staffId;
        await hours(branch, nineCoach);
        await load.row({
          branch_id: branch,
          version_id: version,
          group_id: nineGroupId,
          subject_id: sport,
          teacher_id: nineCoach,
          lessons_per_week: 1,
        });
      }
      await placeAt(branch, version, groupRow, 1, 5);
    }
    // Task 5.6b-2b, with `three`: art and music of the grade-7 class in
    // slots 3 and 5 on Mondays, so the class has three lessons that weekday.
    let art: string | null = null;
    let music: string | null = null;
    if (input.three === true) {
      for (const slotPosition of [3, 5]) {
        const subject = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
        const teacher = (await load.teacher(branch, { subjects: [{ subject, grades: [7] }] }))
          .staffId;
        await hours(branch, teacher);
        const row = await load.row({
          branch_id: branch,
          version_id: version,
          class_id: classId,
          subject_id: subject,
          teacher_id: teacher,
          lessons_per_week: 1,
        });
        await placeAt(branch, version, row, 1, slotPosition);
        if (slotPosition === 3) art = subject;
        else music = subject;
      }
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
      lessonType: lesson,
      groupId,
      nineGroupId,
      art,
      music,
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /**
   * A copy of the scene's version with its rows placed again on Mondays,
   * maths in `mathsSlot` and history in the other lesson slot of 1 and 3,
   * published from `startsOn` (task 5.6b-2c-2: with `withKey`, with the key of
   * its stored one-day changes from the publish check).
   */
  async function nextVersion(
    s: Scene,
    startsOn: string,
    mathsSlot = 1,
    withKey = false,
  ): Promise<string> {
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
    let published: Response;
    if (withKey) {
      const checked = await t.get(
        `/api/timetable/versions/${next}/publish-check?startsOn=${startsOn}`,
        s.branch,
      );
      expect(checked.status, JSON.stringify(checked.body)).toBe(200);
      const days = (checked.body as { impact: { dayChanges: { key: string } } }).impact.dayChanges;
      published = await request(t.kit.server)
        .post(`/api/timetable/versions/${next}/publish`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ startsOn, dayChangesKey: days.key });
    } else {
      published = await publish(s.branch, next, startsOn);
    }
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

    // Task 5.6b-3 (replaces the interim test of 5.6b-1 decision 11): a group
    // joins the grade-9 class and the grade-10 class in slot 5 (09:50 to
    // 10:35) on Mondays; a day off for grade 9 only leaves grade 10 at school.
    describe('for grade 9 only, over a group of grades 9 and 10 (task 5.6b-3)', () => {
      const nineOff = (first = OCT19, last = first) =>
        dayOff(first, last, { gradeFrom: 9, gradeTo: 9 });
      const groupBlocks = (s: Scene, choice: 'keep' | 'cancel') => [
        { weekday: 1, start: 590, groupIds: [s.groupId ?? ''], choice },
      ];
      const groupOn = async (s: Scene, date: string) =>
        (await lessonsOn(s.branch, date)).filter((one) => one.group_id === s.groupId);
      const choicesOf = (branch: string) =>
        t.database.migrator
          .selectFrom('calendar_group_blocks as b')
          .innerJoin('calendar_group_block_groups as g', 'g.block_id', 'b.id')
          .select([
            sql<string>`b.lesson_date::text`.as('date'),
            'b.start_minutes',
            'b.choice',
            'g.group_id',
          ])
          .where('b.branch_id', '=', branch)
          .orderBy('b.lesson_date')
          .execute();

      it("lists the group's block in the preview and refuses a save with no choice, writing nothing", async () => {
        const s = await scene({ group: true });
        const shown = await preview(s.branch, { action: 'create', record: nineOff(OCT19, OCT26) });
        expect(shown.lessons.groupBlocks).toEqual([
          {
            weekday: 1,
            start: 590,
            end: 635,
            groupIds: [s.groupId],
            gradesAtSchool: [10],
            dates: [OCT19, OCT26],
            choice: null,
          },
        ]);
        expect(shown.lessons.names.units.map((one) => one.id)).toContain(s.groupId);
        const lessons = await lessonsOf(s.branch);
        const before = await t.auditCount();

        const refused = await create(s.branch, nineOff(OCT19, OCT26));

        refusedWith(refused, 409, 'calendar_blocked');
        expect(detailsOf(refused).map((one) => [one.code, one.day])).toEqual([
          ['calendar_group_block_choice', OCT19],
          ['calendar_group_block_choice', OCT26],
        ]);
        expect(await lessonsOf(s.branch)).toEqual(lessons);
        expect(await choicesOf(s.branch)).toEqual([]);
        expect(await t.auditCount()).toBe(before);
      });

      it('with "cancel" creates the group\'s lessons cancelled "day off"', async () => {
        const s = await scene({ group: true });
        okay(await create(s.branch, { ...nineOff(), groupBlocks: groupBlocks(s, 'cancel') }), 201);
        expect((await groupOn(s, OCT19)).map((one) => one.cancel_cause)).toEqual(['day_off']);
        expect(await choicesOf(s.branch)).toEqual([
          { date: OCT19, start_minutes: 590, choice: 'cancel', group_id: s.groupId },
        ]);
      });

      it('with "keep" keeps the group\'s lesson for grade 10 at its time, stores and audits the choice', async () => {
        const s = await scene({ group: true });
        const before = await groupOn(s, OCT19);
        const senior = (await lessonsOn(s.branch, OCT19)).filter(
          (one) => one.class_id === s.seniorId,
        );
        const shown = await preview(s.branch, {
          action: 'create',
          record: nineOff(),
          groupBlocks: groupBlocks(s, 'keep'),
        });
        // The preview shows the choice sent (spec review 10).
        expect(shown.lessons.groupBlocks.map((one) => one.choice)).toEqual(['keep']);
        expect(shown.lessons.groupBlocksUnused).toEqual([]);

        const saved = okay(
          await create(s.branch, { ...nineOff(), groupBlocks: groupBlocks(s, 'keep') }),
          201,
        );

        const after = await groupOn(s, OCT19);
        expect(after.map((one) => [one.cancel_cause, one.starts_at])).toEqual(
          before.map((one) => [null, one.starts_at]),
        );
        expect(
          (await lessonsOn(s.branch, OCT19)).filter((one) => one.class_id === s.seniorId),
        ).toEqual(senior);
        expect(await choicesOf(s.branch)).toEqual([
          { date: OCT19, start_minutes: 590, choice: 'keep', group_id: s.groupId },
        ]);
        const [entry] = await t.entries('calendar_entry.create', saved.id);
        expect((entry?.new_value as { groupBlocks: unknown }).groupBlocks).toEqual([
          {
            date: OCT19,
            weekday: 1,
            start: 590,
            groupIds: [s.groupId],
            before: null,
            after: 'keep',
          },
        ]);
      });

      it('an edit of the unchanged entry with a new choice writes its dates again and marks the drafts (spec review 1)', async () => {
        const s = await scene({ group: true });
        const saved = okay(
          await create(s.branch, { ...nineOff(), groupBlocks: groupBlocks(s, 'keep') }),
          201,
        );
        const draftId = await copyUnpublished(s);
        const causes = async () =>
          (
            await t.database.migrator
              .selectFrom('timetable_version_out_of_date_causes')
              .select('id')
              .where('version_id', '=', draftId)
              .execute()
          ).length;
        const causesBefore = await causes();
        // The stored choice is shown in the edit's preview.
        const shown = await preview(s.branch, { action: 'edit', id: saved.id, record: nineOff() });
        expect(shown.lessons.groupBlocks.map((one) => one.choice)).toEqual(['keep']);

        okay(
          await t.patch(`/api/setup/calendar-entries/${saved.id}`, s.branch, {
            ...nineOff(),
            groupBlocks: groupBlocks(s, 'cancel'),
          }),
        );

        expect((await groupOn(s, OCT19)).map((one) => one.cancel_cause)).toEqual(['day_off']);
        expect((await choicesOf(s.branch)).map((one) => one.choice)).toEqual(['cancel']);
        expect(await causes()).toBeGreaterThan(causesBefore);
        const [entry] = await t.entries('calendar_entry.edit', saved.id);
        expect((entry?.new_value as { groupBlocks: unknown }).groupBlocks).toEqual([
          {
            date: OCT19,
            weekday: 1,
            start: 590,
            groupIds: [s.groupId],
            before: 'keep',
            after: 'cancel',
          },
        ]);
      });

      it('is applied again by a later publish and by a withdraw of that version', async () => {
        const s = await scene({ group: true });
        okay(
          await create(s.branch, { ...nineOff(OCT26), groupBlocks: groupBlocks(s, 'keep') }),
          201,
        );
        expect((await groupOn(s, OCT26)).map((one) => one.cancel_cause)).toEqual([null]);

        // A version from 19 October places the group in slot 5 again.
        const next = await copyUnpublished(s);
        okay(await publish(s.branch, next, OCT19));
        const onNext = await groupOn(s, OCT26);
        expect(onNext.map((one) => [one.cancel_cause, one.version_id])).toEqual([[null, next]]);

        okay(await keyed(`/api/timetable/versions/${next}/withdraw`, s.branch, {}));
        expect((await groupOn(s, OCT26)).map((one) => [one.cancel_cause, one.version_id])).toEqual([
          [null, s.version],
        ]);
      });

      it('leaves a kept block "not in the day\'s template" where grade 10\'s day lacks its slot (correction 2)', async () => {
        const s = await scene({ group: true });
        // Grade 10 on the one-slot template that day: no third lesson.
        okay(
          await create(s.branch, {
            ...specialDay(OCT19, OCT19, s.short),
            gradeFrom: 10,
            gradeTo: 10,
            dayKeeps: [{ classId: s.seniorId, date: OCT19, slotPositions: [3] }],
          }),
          201,
        );
        okay(await create(s.branch, { ...nineOff(), groupBlocks: groupBlocks(s, 'keep') }), 201);
        expect((await groupOn(s, OCT19)).map((one) => one.cancel_cause)).toEqual([
          'not_in_template',
        ]);
      });

      it('archived and restored, takes its stored choice again with no body', async () => {
        const s = await scene({ group: true });
        const saved = okay(
          await create(s.branch, { ...nineOff(), groupBlocks: groupBlocks(s, 'keep') }),
          201,
        );
        okay(await post(`/api/setup/calendar-entries/${saved.id}/archive`, s.branch));
        expect((await groupOn(s, OCT19)).map((one) => one.cancel_cause)).toEqual([null]);
        // The rows stay for the restore (decision 6).
        expect(await choicesOf(s.branch)).toHaveLength(1);

        okay(await post(`/api/setup/calendar-entries/${saved.id}/restore`, s.branch));

        expect((await groupOn(s, OCT19)).map((one) => one.cancel_cause)).toEqual([null]);
        const [entry] = await t.entries('calendar_entry.restore', saved.id);
        expect(entry?.new_value).not.toHaveProperty('groupBlocks');
      });

      // Code review must-fix 3: a line shows a choice only when every date has it.
      it('an edit that adds a date shows the block unchosen and is refused without a choice for it', async () => {
        const s = await scene({ group: true });
        const saved = okay(
          await create(s.branch, { ...nineOff(), groupBlocks: groupBlocks(s, 'keep') }),
          201,
        );
        const shown = await preview(s.branch, {
          action: 'edit',
          id: saved.id,
          record: nineOff(OCT19, OCT26),
        });
        expect(shown.lessons.groupBlocks.map((one) => [one.dates, one.choice])).toEqual([
          [[OCT19, OCT26], null],
        ]);
        const refused = await t.patch(
          `/api/setup/calendar-entries/${saved.id}`,
          s.branch,
          nineOff(OCT19, OCT26),
        );
        refusedWith(refused, 409, 'calendar_blocked');
        expect(detailsOf(refused).map((one) => [one.code, one.day])).toEqual([
          ['calendar_group_block_choice', OCT26],
        ]);
      });

      // Code review must-fix 2 (plan test 8): the rows of today and the past stay.
      it('an edit of a started entry changes the choice of the dates after today only', async () => {
        const s = await scene({ group: true });
        // An entry from Monday 5 October, with a choice stored on 1 October for that date.
        const PAST_MONDAY = '2026-10-05';
        const saved = await t.database.migrator
          .insertInto('calendar_entries')
          .values({
            branch_id: s.branch,
            kind: 'day_off',
            name: 'Grade 9 trip',
            first_date: PAST_MONDAY,
            last_date: OCT26,
            grade_from: 9,
            grade_to: 9,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await t.database.migrator.transaction().execute(async (transaction) => {
          await sql`select set_config('app.now', '2026-10-01T10:00:00+05:00', true)`.execute(
            transaction,
          );
          const row = await transaction
            .insertInto('calendar_group_blocks')
            .values({
              branch_id: s.branch,
              calendar_entry_id: saved.id,
              lesson_date: PAST_MONDAY,
              weekday: 1,
              start_minutes: 590,
              end_minutes: 635,
              choice: 'keep',
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await transaction
            .insertInto('calendar_group_block_groups')
            .values({
              branch_id: s.branch,
              block_id: row.id,
              group_id: s.groupId ?? '',
              calendar_entry_id: saved.id,
              lesson_date: PAST_MONDAY,
              start_minutes: 590,
            })
            .execute();
        });

        okay(
          await t.patch(`/api/setup/calendar-entries/${saved.id}`, s.branch, {
            ...nineOff(PAST_MONDAY, OCT26),
            groupBlocks: groupBlocks(s, 'cancel'),
          }),
        );

        expect((await choicesOf(s.branch)).map((one) => [one.date, one.choice])).toEqual([
          [PAST_MONDAY, 'keep'],
          // Monday 12 October, the first date after today (10 October).
          ['2026-10-12', 'cancel'],
          [OCT19, 'cancel'],
          [OCT26, 'cancel'],
        ]);
        expect((await groupOn(s, OCT19)).map((one) => one.cancel_cause)).toEqual(['day_off']);
        expect((await groupOn(s, OCT26)).map((one) => one.cancel_cause)).toEqual(['day_off']);
      });

      // Code review must-fix 1 (plan test 9b, decision 2).
      it('a later version\'s block of the group at another time is cancelled "day off" and offered unchosen', async () => {
        const s = await scene({ group: true });
        const saved = okay(
          await create(s.branch, { ...nineOff(OCT26), groupBlocks: groupBlocks(s, 'keep') }),
          201,
        );
        // A version from 19 October with the group in slot 1.
        const next = await draft(s.branch, s.year, s.version);
        await t.database.migrator
          .deleteFrom('pattern_blocks')
          .where('version_id', '=', next)
          .execute();
        const rows = await t.database.migrator
          .selectFrom('teaching_load_rows')
          .select(['id', 'subject_id', 'group_id'])
          .where('version_id', '=', next)
          .execute();
        for (const row of rows) {
          await placeAt(
            s.branch,
            next,
            row.id,
            1,
            row.subject_id === s.history ? 3 : row.group_id === null ? 5 : 1,
          );
        }
        await confirmTemplates(s.branch, next);
        await load.freeEditLock(next);
        okay(await publish(s.branch, next, OCT19));

        const group = await groupOn(s, OCT26);
        expect(group.map((one) => [one.cancel_cause, one.version_id])).toEqual([['day_off', next]]);
        const shown = await preview(s.branch, {
          action: 'edit',
          id: saved.id,
          record: nineOff(OCT26),
        });
        expect(shown.lessons.groupBlocks.map((one) => [one.start, one.choice])).toEqual([
          [480, null],
        ]);
      });

      // Code review should-fix 1: a one-day change of a kept lesson is not refused for the grade off.
      it('lets a one-day room change of a kept lesson through', async () => {
        const s = await scene({ group: true });
        okay(await create(s.branch, { ...nineOff(), groupBlocks: groupBlocks(s, 'keep') }), 201);
        const [kept] = await groupOn(s, OCT19);
        const room = await load.classes.room(s.branch);
        okay(
          await keyed(`/api/timetable/lessons/${kept?.id ?? ''}/room`, s.branch, {
            roomId: room,
            reason: 'The hall is painted',
          }),
        );
        const [after] = await groupOn(s, OCT19);
        expect(after?.cancel_cause).toBeNull();
      });

      // Code review round 1: a group of grade 9 alone in a kept block.
      it('with "keep" over a block with a group of grade 9 alone holds the two-grade group and cancels that one "day off"', async () => {
        const s = await scene({ nineGroup: true });
        const before = await lessonsOn(s.branch, OCT19);
        const nine = before.find((one) => one.group_id === s.nineGroupId);
        expect(nine?.block_id).toBe(before.find((one) => one.group_id === s.groupId)?.block_id);
        const groupIds = [s.groupId ?? '', s.nineGroupId ?? ''];
        const shown = await preview(s.branch, { action: 'create', record: nineOff() });
        expect(shown.lessons.groupBlocks.map((one) => one.groupIds.toSorted())).toEqual([
          groupIds.toSorted(),
        ]);

        okay(
          await create(s.branch, {
            ...nineOff(),
            groupBlocks: [{ weekday: 1, start: 590, groupIds, choice: 'keep' }],
          }),
          201,
        );

        const after = await lessonsOn(s.branch, OCT19);
        expect(after.find((one) => one.group_id === s.groupId)?.cancel_cause).toBeNull();
        expect(after.find((one) => one.group_id === s.nineGroupId)?.cancel_cause).toBe('day_off');
        // A one-day room change of the kept lesson: the part cancelled "day off" goes alongside.
        const kept = after.find((one) => one.group_id === s.groupId);
        okay(
          await keyed(`/api/timetable/lessons/${kept?.id ?? ''}/room`, s.branch, {
            roomId: await load.classes.room(s.branch),
            reason: 'The hall is painted',
          }),
        );
      });

      // Permission review must-fix 1: an archive leaves no grade off and takes no choice.
      it('refuses a choice sent with an archive, writing nothing', async () => {
        const s = await scene({ group: true });
        const saved = okay(
          await create(s.branch, { ...nineOff(), groupBlocks: groupBlocks(s, 'keep') }),
          201,
        );
        const lessons = await lessonsOf(s.branch);
        const before = await t.auditCount();
        refusedWith(
          await post(`/api/setup/calendar-entries/${saved.id}/archive`, s.branch, {
            groupBlocks: groupBlocks(s, 'cancel'),
          }),
          400,
          'validation_failed',
        );
        expect(await lessonsOf(s.branch)).toEqual(lessons);
        expect(await t.auditCount()).toBe(before);
      });
    });

    it('lists a group\'s lesson in a slot whose times differ between its grades as "not in the day\'s template", under the group', async () => {
      const s = await scene({ group: true });
      const pause = await t.createSlotType(s.branch, 'Long break', 'break', 30);
      // Grade 9 only: the third lesson starts at 10:10, not 09:50.
      const late = await t.createTemplate(s.branch, 'Late', [
        s.lessonType,
        pause,
        s.lessonType,
        pause,
        s.lessonType,
      ]);
      const record = { ...specialDay(OCT19, OCT19, late), gradeFrom: 9, gradeTo: 9 };
      const shown = await preview(s.branch, { action: 'create', record });
      expect(shown.lessons.cancelled.map((one) => [one.unitId, one.cause])).toEqual([
        [s.groupId, 'not_in_template'],
      ]);
      expect(shown.lessons.groupBlocks).toEqual([]);

      okay(await create(s.branch, record), 201);

      expect(
        (await lessonsOn(s.branch, OCT19))
          .filter((one) => one.group_id === s.groupId)
          .map((one) => one.cancel_cause),
      ).toEqual(['not_in_template']);
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

  /** A one-day move of a lesson's block to lesson slot `lessonNumber` of `date`. */
  const moveTo = (
    s: Scene,
    lessonId: string,
    date: string,
    lessonNumber: number,
    roomId?: string,
  ) =>
    keyed(`/api/timetable/lessons/${lessonId}/move`, s.branch, {
      date,
      lessonNumber,
      reason: 'Excursion to the museum',
      ...(roomId === undefined ? {} : { roomId }),
    });

  /** The ends of stored one-day changes of a branch (0087). */
  const endsOf = (branch: string) =>
    t.database.migrator
      .selectFrom('lesson_day_change_ends')
      .select(['change_id', 'version_id'])
      .where('branch_id', '=', branch)
      .orderBy('change_id')
      .execute();

  /** The stored one-day changes of a lesson, oldest first. */
  const changesOf = (lessonId: string) =>
    t.database.migrator
      .selectFrom('lesson_day_changes')
      .select('id')
      .where('lesson_id', '=', lessonId)
      .orderBy('changed_at')
      .orderBy('id')
      .execute();

  /** A lesson by its id, with its date and start. */
  const lessonById = (id: string) =>
    t.database.migrator
      .selectFrom('lessons')
      .select([
        'id',
        sql<string>`lesson_date::text`.as('date'),
        'starts_at',
        'room_id',
        'teacher_id',
        'cancel_cause',
        'cancel_reason',
      ])
      .where('id', '=', id)
      .executeTakeFirst();

  /** A save of `record` with the key of the preview shown and `decisions`. */
  const withDays = (
    record: object,
    shown: CalendarPreview,
    decisions: { key: string; blockId?: string; blockDate?: string; choice: string }[] = [],
  ) => ({
    ...record,
    dayChangesKey: shown.lessons.dayChanges.key,
    ...(decisions.length === 0 ? {} : { dayDecisions: decisions }),
  });

  /** The bulk cancel's check, then its save with what it listed and `choice` for every shared block. */
  const bulkCancel = async (
    s: Scene,
    body: { date: string; classIds: string[]; lessonNumbers: number[] },
    choice: 'keep' | 'cancel' = 'cancel',
  ) => {
    const checked = await post('/api/timetable/bulk-cancels/check', s.branch, body);
    expect(checked.status, JSON.stringify(checked.body)).toBe(200);
    const answer = checked.body as {
      cancel: { lesson: { id: string } }[];
      shared: { blockId: string; lessons: { id: string }[]; chosenOnly: string[] }[];
    };
    return okay(
      await keyed('/api/timetable/bulk-cancels', s.branch, {
        ...body,
        reason: 'Excursion to the museum',
        blocks: answer.shared.map((one) => ({ blockId: one.blockId, choice })),
        lessonIds: [
          ...answer.cancel.map((one) => one.lesson.id),
          ...answer.shared.flatMap((one) =>
            choice === 'cancel' ? one.lessons.map((lesson) => lesson.id) : one.chosenOnly,
          ),
        ],
      }),
    );
  };

  /** A day template of the scene's branch starting with a break: its lessons ten minutes later. */
  const lateTemplate = async (s: Scene) => {
    const lesson = await t.createSlotType(s.branch, 'Late lesson', 'lesson', 45);
    const pause = await t.createSlotType(s.branch, 'Late break', 'break', 10);
    return t.createTemplate(s.branch, 'Late', [pause, lesson, pause, lesson, pause, lesson]);
  };

  // Task 5.6b-2a: the stored one-day changes and bulk cancels of the changed
  // dates, sorted as a publish sorts them (decision 2; edge/timetable,
  // Versions and drafts: "One-day changes ... are stored on their own and
  // applied again after a publish. The preview sorts them into kept, needs a
  // decision and dropped").
  describe('stored one-day changes on a changed date', () => {
    it('a day off over a move onto it from a date it does not change: needs a decision; "drop the change" puts the lesson back at its old place, "cancel the lesson that day" puts it back cancelled', async () => {
      for (const choice of ['drop', 'cancel'] as const) {
        const s = await scene();
        const other = await scene();
        // 26 October's maths moved onto 19 October, lesson 2.
        const moving = await lessonOf(s, OCT26, s.classId);
        okay(await moveTo(s, moving.id, OCT19, 2));
        const [change] = await changesOf(moving.id);
        if (change === undefined) throw new Error('The move was not recorded.');
        const rows = [await storedRowsOf(s.branch), await storedRowsOf(other.branch)];
        const before = await t.auditCount();

        // Test 9: the preview lists the sorting and its key and writes nothing.
        const shown = await preview(s.branch, { action: 'create', record: dayOff(OCT19) });
        expect(shown.lessons.dayChanges.kept).toEqual([]);
        expect(shown.lessons.dayChanges.dropped).toEqual([]);
        expect(
          shown.lessons.dayChanges.decide.map((one) => [
            one.key,
            one.kind,
            one.from.date,
            one.to.date,
            one.blocked.map((result) => result.rule),
          ]),
        ).toEqual([[change.id, 'move', OCT26, OCT19, ['day_off']]]);
        expect(shown.lessons.names.units.map((one) => one.id)).toContain(s.classId);

        // Test 7: without the key or a choice, an older key, a choice for no
        // item shown, "keep" on a one-day change: refused, nothing written.
        const refusals: [object, string[]][] = [
          [dayOff(OCT19), ['day_changes_changed', 'day_change_undecided']],
          [
            {
              ...withDays(dayOff(OCT19), shown, [{ key: change.id, choice }]),
              dayChangesKey: 'a'.repeat(64),
            },
            ['day_changes_changed'],
          ],
          [withDays(dayOff(OCT19), shown), ['day_change_undecided']],
          [
            withDays(dayOff(OCT19), shown, [
              { key: change.id, choice },
              { key: (await lessonOf(s, OCT26, s.seniorId)).id, choice: 'drop' },
            ]),
            ['day_decision_unknown'],
          ],
          [
            withDays(dayOff(OCT19), shown, [{ key: change.id, choice: 'keep' }]),
            ['day_choice_not_offered'],
          ],
        ];
        for (const [body, codes] of refusals) {
          const refused = await create(s.branch, body);
          refusedWith(refused, 409, 'calendar_blocked');
          expect(detailsOf(refused).map((one) => one.code)).toEqual(codes);
        }
        expect(await storedRowsOf(s.branch)).toEqual(rows[0]);
        expect(await storedRowsOf(other.branch)).toEqual(rows[1]);
        expect(await t.auditCount()).toBe(before);

        const saved = okay(
          await create(s.branch, withDays(dayOff(OCT19), shown, [{ key: change.id, choice }])),
          201,
        );

        // Review correction 1: the lesson is back at its old place on 26
        // October, held or cancelled with the change's reason; none on the day off.
        expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
        const back = await lessonById(moving.id);
        expect([back?.date, back?.starts_at.toISOString(), back?.room_id]).toEqual([
          OCT26,
          moving.starts_at.toISOString(),
          s.room,
        ]);
        expect([back?.cancel_cause ?? null, back?.cancel_reason ?? null]).toEqual(
          choice === 'drop' ? [null, null] : ['reason', 'Excursion to the museum'],
        );
        expect(back?.teacher_id).toBe(choice === 'drop' ? s.teacherId : moving.teacher_id);
        // Decision 5: the change is ended in the name of the version in force.
        expect(await endsOf(s.branch)).toEqual([{ change_id: change.id, version_id: s.version }]);
        // Test 13: the audit entry names the outcome by key.
        const [entry] = await t.entries('calendar_entry.create', saved.id);
        const days = entry?.new_value as {
          dayChanges: {
            versionId: string;
            firstDate: string;
            decided: unknown[];
            ended: string[];
          }[];
          movedBack: string[];
        };
        expect(days.dayChanges).toEqual([
          expect.objectContaining({
            versionId: s.version,
            firstDate: OCT19,
            decided: [{ key: change.id, choice }],
            ended: [change.id],
          }),
        ]);
        expect(days.movedBack).toEqual([change.id]);
        expect(await storedRowsOf(other.branch)).toEqual(rows[1]);
      }
    });

    it('refuses "drop the change" when the old place is taken on its date, listed by that date, with nothing written', async () => {
      const s = await scene();
      const moving = await lessonOf(s, OCT26, s.classId);
      okay(await moveTo(s, moving.id, OCT19, 2));
      const [change] = await changesOf(moving.id);
      if (change === undefined) throw new Error('The move was not recorded.');
      // 26 October's history moved into the maths room at 08:00, the old place.
      const history = await lessonOf(s, OCT26, s.seniorId);
      okay(await moveTo(s, history.id, OCT26, 1, s.room));
      const shown = await preview(s.branch, { action: 'create', record: dayOff(OCT19) });
      const rows = await storedRowsOf(s.branch);
      const before = await t.auditCount();

      const refused = await create(
        s.branch,
        withDays(dayOff(OCT19), shown, [{ key: change.id, choice: 'drop' }]),
      );

      refusedWith(refused, 409, 'calendar_blocked');
      expect(detailsOf(refused).map((one) => [one.code, one.day, one.path])).toEqual([
        ['date_blocked', OCT26, `dates.${OCT26}.room_double`],
      ]);
      expect(await storedRowsOf(s.branch)).toEqual(rows);
      expect(await t.auditCount()).toBe(before);
      // "Cancel the lesson that day" takes no check: it is saved.
      okay(
        await create(
          s.branch,
          withDays(dayOff(OCT19), shown, [{ key: change.id, choice: 'cancel' }]),
        ),
        201,
      );
      expect((await lessonById(moving.id))?.cancel_cause).toBe('reason');
    });

    // Spec review of the code, must-fix 2: an old place that is itself a day
    // off holds no lesson, not even a cancelled one.
    it('removes the moved lesson with either choice when its old place is a day off of an earlier save', async () => {
      for (const choice of ['drop', 'cancel'] as const) {
        const s = await scene();
        const moving = await lessonOf(s, OCT26, s.classId);
        okay(await moveTo(s, moving.id, OCT19, 2));
        const [change] = await changesOf(moving.id);
        const first = dayOff(OCT26, OCT26, { gradeFrom: null, gradeTo: null }, 'Teachers day');
        okay(
          await create(
            s.branch,
            withDays(first, await preview(s.branch, { action: 'create', record: first })),
          ),
          201,
        );
        expect((await lessonById(moving.id))?.date).toBe(OCT19);
        const shown = await preview(s.branch, { action: 'create', record: dayOff(OCT19) });

        okay(
          await create(
            s.branch,
            withDays(dayOff(OCT19), shown, [{ key: change?.id ?? '', choice }]),
          ),
          201,
        );

        expect(await lessonById(moving.id)).toBeUndefined();
        expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
        expect(await lessonsOn(s.branch, OCT26)).toEqual([]);
        expect(await endsOf(s.branch)).toEqual([{ change_id: change?.id, version_id: s.version }]);
      }
    });

    // Code review round 1, must-fix 1 (`.claude/rules/api.md`, each branch of
    // a function that chooses where rows go): a move from today or earlier
    // cannot be put back by a calendar save, and a day off holds no lesson,
    // so the block is removed whatever the choice (5.6a-5a decision 7; the
    // build's decision 7). The past is written through the migrator, as "the
    // past is closed" does: the record of the real move dated from Monday 5
    // October, before today (10 October).
    it('removes a move from today or earlier onto a new day off with either choice: nothing on the day off or on its old date, the change ended', async () => {
      const PAST = '2026-10-05';
      for (const choice of ['drop', 'cancel'] as const) {
        const s = await scene();
        const moving = await lessonOf(s, OCT26, s.classId);
        okay(await moveTo(s, moving.id, OCT19, 2));
        const [change] = await changesOf(moving.id);
        if (change === undefined) throw new Error('The move was not recorded.');
        // Task 5.6b-4b: 0092 keeps the times of a stored change to its own
        // date; the forged past record goes past that guard in a transaction
        // of its own.
        await t.database.migrator.transaction().execute(async (forged) => {
          await sql`alter table lesson_day_changes disable trigger lesson_day_changes_times`.execute(
            forged,
          );
          await forged
            .updateTable('lesson_day_changes')
            .set({
              from_date: PAST,
              from_starts_at: sql<Date>`from_starts_at - interval '21 days'`,
              from_ends_at: sql<Date>`from_ends_at - interval '21 days'`,
            })
            .where('id', '=', change.id)
            .execute();
          await sql`alter table lesson_day_changes enable trigger lesson_day_changes_times`.execute(
            forged,
          );
        });
        // The day's template in force on 5 October too, with the same slots,
        // so that its old place has room for the lesson and only the date
        // decides the removal.
        await t.database.migrator.transaction().execute(async (past) => {
          const current = await past
            .selectFrom('day_template_versions')
            .select(['id', 'start_minutes'])
            .where('day_template_id', '=', s.regular)
            .executeTakeFirstOrThrow();
          const earlier = await past
            .insertInto('day_template_versions')
            .values({
              branch_id: s.branch,
              day_template_id: s.regular,
              start_minutes: current.start_minutes,
              valid_from: '2026-09-01',
              valid_until: '2026-10-07',
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          const slots = await past
            .selectFrom('day_template_slots')
            .select(['position', 'slot_type_id'])
            .where('version_id', '=', current.id)
            .execute();
          await past
            .insertInto('day_template_slots')
            .values(slots.map((one) => ({ ...one, version_id: earlier.id, branch_id: s.branch })))
            .execute();
          const lengths = await past
            .selectFrom('slot_type_lengths')
            .select(['slot_type_id', 'length_minutes'])
            .where('slot_type_id', 'in', [...new Set(slots.map((one) => one.slot_type_id))])
            .execute();
          await past
            .insertInto('slot_type_lengths')
            .values(
              lengths.map((one) => ({
                ...one,
                branch_id: s.branch,
                valid_from: '2026-09-01',
                valid_until: '2026-10-07',
              })),
            )
            .execute();
          await past
            .insertInto('day_template_assignments')
            .values({
              branch_id: s.branch,
              level: 'default',
              day_template_id: s.regular,
              valid_from: '2026-09-01',
              valid_until: '2026-10-07',
            })
            .execute();
        });
        const on26 = await lessonsOn(s.branch, OCT26);
        const shown = await preview(s.branch, { action: 'create', record: dayOff(OCT19) });
        expect(
          shown.lessons.dayChanges.decide.map((one) => [one.key, one.from.date, one.to.date]),
        ).toEqual([[change.id, PAST, OCT19]]);

        const saved = okay(
          await create(s.branch, withDays(dayOff(OCT19), shown, [{ key: change.id, choice }])),
          201,
        );

        expect(await lessonById(moving.id)).toBeUndefined();
        expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
        expect(await lessonsOn(s.branch, PAST)).toEqual([]);
        expect(await lessonsOn(s.branch, OCT26)).toEqual(on26);
        expect(await endsOf(s.branch)).toEqual([{ change_id: change.id, version_id: s.version }]);
        const [entry] = await t.entries('calendar_entry.create', saved.id);
        expect((entry?.new_value as { movedBack: string[] }).movedBack).toEqual([change.id]);
      }
    });

    // Spec review of the code, should-fix 3: the old place found by its pattern
    // entry when the day shifts the times.
    it('a special template that shifts the times over a move out of the date writes no second lesson at the old place', async () => {
      const s = await scene();
      const late = await lateTemplate(s);
      const moving = await lessonOf(s, OCT19, s.seniorId);
      okay(await moveTo(s, moving.id, OCT26, 3));
      const record = specialDay(OCT19, OCT19, late);
      const shown = await preview(s.branch, { action: 'create', record });
      expect(shown.lessons.dayChanges.kept).toHaveLength(1);

      okay(await create(s.branch, withDays(record, shown)), 201);

      expect((await lessonById(moving.id))?.date).toBe(OCT26);
      expect((await lessonsOn(s.branch, OCT19)).map((one) => one.class_id)).toEqual([s.classId]);
    });

    it('a day off over a move from it to a date it does not change keeps the move: the lesson stays where it went, none at the old place', async () => {
      const s = await scene();
      const moving = await lessonOf(s, OCT19, s.classId);
      okay(await moveTo(s, moving.id, OCT26, 2));
      const [change] = await changesOf(moving.id);
      const shown = await preview(s.branch, { action: 'create', record: dayOff(OCT19) });
      expect(shown.lessons.dayChanges.kept.map((one) => one.key)).toEqual([change?.id]);

      // Saved by the Academic Vice Principal assigned in the branch
      // (permission review should-fix 3).
      const vice = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', 'academic_vice_principal')
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      await load.classes.role(vice.account_id, s.branch, 'academic_vice_principal');
      okay(await create(s.branch, withDays(dayOff(OCT19), shown), t.vicePrincipal), 201);

      expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
      expect((await lessonById(moving.id))?.date).toBe(OCT26);
      expect(await endsOf(s.branch)).toEqual([]);
    });

    it('an exam week with "no regular lessons" or a shortened day over a move out of the date leaves no cancelled copy at the old place', async () => {
      for (const kind of ['exam_week', 'shortened'] as const) {
        const s = await scene();
        // Maths of 19 October moved to 26 October; the shortened day keeps
        // one lesson slot, so the moved history is beyond it.
        const unit = kind === 'exam_week' ? s.classId : s.seniorId;
        const moving = await lessonOf(s, OCT19, unit);
        okay(await moveTo(s, moving.id, OCT26, 3));
        const record =
          kind === 'exam_week'
            ? specialDay(OCT19, OCT19, s.regular, { examWeek: 'no_regular_lessons' })
            : specialDay(OCT19, OCT19, s.short);
        const shown = await preview(s.branch, { action: 'create', record });
        expect(shown.lessons.dayChanges.kept).toHaveLength(1);

        okay(await create(s.branch, withDays(record, shown)), 201);

        // The moved lesson is on 26 October only; 19 October has no lesson of it.
        expect((await lessonById(moving.id))?.date).toBe(OCT26);
        expect((await lessonsOn(s.branch, OCT19)).filter((one) => one.class_id === unit)).toEqual(
          [],
        );
        expect(
          (await lessonsOf(s.branch)).filter(
            (one) =>
              one.class_id === unit &&
              one.subject_id === moving.subject_id &&
              (one.date === OCT19 || one.date === OCT26),
          ),
        ).toHaveLength(2);
      }
    });

    // Code review round 1, must-fix 2: the same left-out copy on a publish,
    // whose new version's pattern entries are not the moved lesson's, so the
    // old place is found by class, subject and minutes. Another lesson of the
    // class and subject at another time of that date keeps its cancelled copy.
    it('a publish over an exam week with "no regular lessons" writes no cancelled copy at the old place of a move out of it to a date before its start', async () => {
      const s = await scene();
      const moving = await lessonOf(s, OCT26, s.classId);
      okay(await moveTo(s, moving.id, OCT19, 2));
      const [change] = await changesOf(moving.id);
      if (change === undefined) throw new Error('The move was not recorded.');
      const record = specialDay(OCT26, OCT26, s.regular, { examWeek: 'no_regular_lessons' });
      okay(
        await create(
          s.branch,
          withDays(record, await preview(s.branch, { action: 'create', record })),
        ),
        201,
      );
      // A second version: maths twice on Mondays, in slots 1 and 5; history in slot 3.
      const next = await draft(s.branch, s.year, s.version);
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', next)
        .execute();
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ lessons_per_week: 2 })
        .where('version_id', '=', next)
        .where('subject_id', '=', s.maths)
        .execute();
      const rows = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select(['id', 'subject_id'])
        .where('version_id', '=', next)
        .execute();
      for (const row of rows) {
        if (row.subject_id === s.maths) {
          await placeAt(s.branch, next, row.id, 1, 1);
          await placeAt(s.branch, next, row.id, 1, 5);
        } else {
          await placeAt(s.branch, next, row.id, 1, 3);
        }
      }
      await confirmTemplates(s.branch, next);
      await load.freeEditLock(next);
      const checked = await t.get(
        `/api/timetable/versions/${next}/publish-check?startsOn=${OCT26}`,
        s.branch,
      );
      expect(checked.status, JSON.stringify(checked.body)).toBe(200);
      const days = (
        checked.body as { impact: { dayChanges: { key: string; kept: { key: string }[] } } }
      ).impact.dayChanges;
      expect(days.kept.map((one) => one.key)).toEqual([change.id]);

      const published = await request(t.kit.server)
        .post(`/api/timetable/versions/${next}/publish`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ startsOn: OCT26, dayChangesKey: days.key });
      expect(published.status, JSON.stringify(published.body)).toBe(200);

      // The moved lesson stays where it went; 26 October holds the slot-5
      // maths and the history, cancelled "exam week", and no copy at 08:00.
      expect((await lessonById(moving.id))?.date).toBe(OCT19);
      const on26 = await lessonsOn(s.branch, OCT26);
      expect(
        on26.map((one) => [one.class_id, one.subject_id, one.version_id, one.cancel_cause]),
      ).toEqual([
        [s.seniorId, s.history, next, 'exam_week'],
        [s.classId, s.maths, next, 'exam_week'],
      ]);
      expect(on26.map((one) => one.starts_at.getTime())).not.toContain(moving.starts_at.getTime());
    });

    it('a day off over a room change and a one-lesson cancel of its date drops and ends them; taken back, the lessons come back from the version and the changes stay ended', async () => {
      const s = await scene();
      const roomed = await lessonOf(s, OCT19, s.seniorId);
      const spare = await load.classes.room(s.branch);
      okay(
        await keyed(`/api/timetable/lessons/${roomed.id}/room`, s.branch, {
          roomId: spare,
          reason: 'The room is painted',
        }),
      );
      const cancelled = await lessonOf(s, OCT19, s.classId);
      okay(
        await keyed(`/api/timetable/lessons/${cancelled.id}/cancel`, s.branch, {
          reason: 'The teacher is at a seminar',
        }),
      );
      const [change] = await changesOf(roomed.id);
      const shown = await preview(s.branch, { action: 'create', record: dayOff(OCT19) });
      expect(shown.lessons.dayChanges.dropped.map((one) => [one.kind, one.key]).sort()).toEqual(
        [
          ['room', change?.id],
          ['cancel', cancelled.id],
        ].sort(),
      );

      const saved = okay(await create(s.branch, withDays(dayOff(OCT19), shown)), 201);

      expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
      expect(await endsOf(s.branch)).toEqual([{ change_id: change?.id, version_id: s.version }]);
      // Test 13: the audit entry names the changes dropped and ended.
      const [entry] = await t.entries('calendar_entry.create', saved.id);
      expect((entry?.new_value as { dayChanges: unknown[] }).dayChanges).toEqual([
        expect.objectContaining({
          kept: [],
          dropped: [cancelled.id, change?.id ?? ''].sort(),
          ended: [change?.id],
        }),
      ]);

      // Decision 13 (Look first): archived, the day off gives the lessons back
      // from the version, not cancelled and in the version's room.
      const archive = { action: 'archive', id: saved.id };
      const back = await preview(s.branch, archive);
      expect(back.lessons.dayChanges.kept).toEqual([]);
      okay(await post(`/api/setup/calendar-entries/${saved.id}/archive`, s.branch, {}));
      const after = await lessonsOn(s.branch, OCT19);
      expect(after.map((one) => [one.class_id, one.cancel_cause])).toEqual([
        [s.classId, null],
        [s.seniorId, null],
      ]);
      expect(await endsOf(s.branch)).toEqual([{ change_id: change?.id, version_id: s.version }]);
    });

    it('a special day edited to a shortened template keeps a room change on the lesson it keeps and drops the one beyond its slots', async () => {
      const s = await scene();
      // Both teachers work on Saturdays too, so the lessons have their teachers.
      for (const staffId of [s.teacherId, s.seniorTeacher]) {
        const entry = await t.database.migrator
          .selectFrom('staff_availability')
          .select(['id', 'valid_from', 'valid_until'])
          .where('staff_id', '=', staffId)
          .where('branch_id', '=', s.branch)
          .executeTakeFirstOrThrow();
        await t.database.migrator
          .insertInto('staff_availability_ranges')
          .values({
            entry_id: entry.id,
            branch_id: s.branch,
            staff_id: staffId,
            weekday: 6,
            start_minutes: 0,
            end_minutes: 1440,
            valid_from: entry.valid_from,
            valid_until: entry.valid_until,
          })
          .execute();
      }
      const record = specialDay(OCT24, OCT24, s.regular, { followsWeekday: 1 });
      const saved = okay(await create(s.branch, record), 201);
      const spare = await load.classes.room(s.branch);
      const another = await load.classes.room(s.branch);
      const maths = await lessonOf(s, OCT24, s.classId);
      const history = await lessonOf(s, OCT24, s.seniorId);
      // Two requests, a second apart: the changes of one request are one item.
      try {
        for (const [lesson, roomId] of [
          [maths, spare],
          [history, another],
        ] as const) {
          okay(
            await keyed(`/api/timetable/lessons/${lesson.id}/room`, s.branch, {
              roomId,
              reason: 'The room is painted',
            }),
          );
          t.clock.advance(1000);
        }
      } finally {
        t.clock.set(START);
      }
      const [mathsChange] = await changesOf(maths.id);
      const [historyChange] = await changesOf(history.id);
      const edited = { ...record, dayTemplateId: s.short };
      const shown = await preview(s.branch, { action: 'edit', id: saved.id, record: edited });
      expect(shown.lessons.dayChanges.kept.map((one) => one.key)).toEqual([mathsChange?.id]);
      expect(shown.lessons.dayChanges.dropped.map((one) => one.key)).toEqual([historyChange?.id]);

      okay(
        await t.patch(`/api/setup/calendar-entries/${saved.id}`, s.branch, withDays(edited, shown)),
      );

      // The lesson kept keeps its identity and its room change, which stays in force.
      const kept = await lessonById(maths.id);
      expect([kept?.date, kept?.room_id]).toEqual([OCT24, spare]);
      expect(await endsOf(s.branch)).toEqual([
        { change_id: historyChange?.id, version_id: s.version },
      ]);
      expect(
        (await lessonsOn(s.branch, OCT24)).map((one) => [one.class_id, one.cancel_cause]),
      ).toEqual([
        [s.classId, null],
        [s.seniorId, 'not_in_template'],
      ]);
    });

    it('a special template that shifts the times drops a one-lesson cancel and a room change of the date; the lessons at the new times are held', async () => {
      const s = await scene();
      const late = await lateTemplate(s);
      const cancelled = await lessonOf(s, OCT19, s.classId);
      okay(
        await keyed(`/api/timetable/lessons/${cancelled.id}/cancel`, s.branch, {
          reason: 'The teacher is at a seminar',
        }),
      );
      const roomed = await lessonOf(s, OCT19, s.seniorId);
      okay(
        await keyed(`/api/timetable/lessons/${roomed.id}/room`, s.branch, {
          roomId: await load.classes.room(s.branch),
          reason: 'The room is painted',
        }),
      );
      const [change] = await changesOf(roomed.id);
      const record = specialDay(OCT19, OCT19, late);
      const shown = await preview(s.branch, { action: 'create', record });
      expect(shown.lessons.dayChanges.dropped.map((one) => one.key).sort()).toEqual(
        [cancelled.id, change?.id].sort(),
      );

      okay(await create(s.branch, withDays(record, shown)), 201);

      const after = await lessonsOn(s.branch, OCT19);
      expect(
        after.map((one) => [one.class_id, one.cancel_cause, one.starts_at.toISOString()]),
      ).toEqual([
        [s.classId, null, '2026-10-19T03:10:00.000Z'],
        [s.seniorId, null, '2026-10-19T04:05:00.000Z'],
      ]);
      expect(await endsOf(s.branch)).toEqual([{ change_id: change?.id, version_id: s.version }]);
    });
  });

  describe('stored bulk cancels on a changed date', () => {
    it('a day off over a bulk cancel keeps it with no lesson under it; taken back, the lessons under it come back cancelled with its reason', async () => {
      const s = await scene();
      const cancel = await bulkCancel(s, {
        date: OCT19,
        classIds: [s.classId],
        lessonNumbers: [1],
      });
      const shown = await preview(s.branch, { action: 'create', record: dayOff(OCT19) });
      expect(
        shown.lessons.dayChanges.bulk.map((one) => [one.key, one.category, one.cancelled]),
      ).toEqual([[cancel.id, 'kept', 0]]);
      const saved = okay(await create(s.branch, withDays(dayOff(OCT19), shown)), 201);
      expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
      // Test 13: the audit entry names the bulk cancel kept.
      const [entry] = await t.entries('calendar_entry.create', saved.id);
      expect((entry?.new_value as { dayChanges: unknown[] }).dayChanges).toEqual([
        expect.objectContaining({ bulk: { kept: [cancel.id], decided: [], carried: [] } }),
      ]);

      const archive = { action: 'archive', id: saved.id };
      const back = await preview(s.branch, archive);
      okay(
        await post(`/api/setup/calendar-entries/${saved.id}/archive`, s.branch, withDays({}, back)),
      );
      const after = await lessonsOn(s.branch, OCT19);
      expect(after.map((one) => [one.class_id, one.cancel_cause])).toEqual([
        [s.classId, 'reason'],
        [s.seniorId, null],
      ]);
      const restore = await preview(s.branch, { action: 'restore', id: saved.id });
      // Archive and restore without the key, over a bulk cancel: refused.
      refusedWith(
        await post(`/api/setup/calendar-entries/${saved.id}/restore`, s.branch),
        409,
        'calendar_blocked',
      );
      okay(
        await post(
          `/api/setup/calendar-entries/${saved.id}/restore`,
          s.branch,
          withDays({}, restore),
        ),
      );
      expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
    });

    it("a block shared with a class not chosen that a day off taken back creates again needs a decision with the bulk cancel's two choices, each written as chosen", async () => {
      for (const choice of ['cancel', 'keep'] as const) {
        const s = await scene({ group: true });
        // The group of grades 9 and 10 in lesson 3: the bulk cancel of the
        // grade-10 class keeps it for the grade-9 class.
        const cancel = await bulkCancel(
          s,
          { date: OCT19, classIds: [s.seniorId], lessonNumbers: [3] },
          'keep',
        );
        const off = await create(
          s.branch,
          withDays(
            dayOff(OCT19),
            await preview(s.branch, { action: 'create', record: dayOff(OCT19) }),
          ),
        );
        const saved = okay(off, 201);
        const archive = { action: 'archive', id: saved.id };
        const back = await preview(s.branch, archive);
        const [item] = back.lessons.dayChanges.bulk;
        const [block] = item?.blocks ?? [];
        expect([item?.key, item?.category, block?.choice ?? null]).toEqual([
          cancel.id,
          'decide',
          null,
        ]);
        if (block === undefined) throw new Error('No shared block listed.');
        refusedWith(
          await post(
            `/api/setup/calendar-entries/${saved.id}/archive`,
            s.branch,
            withDays({}, back),
          ),
          409,
          'calendar_blocked',
        );

        okay(
          await post(
            `/api/setup/calendar-entries/${saved.id}/archive`,
            s.branch,
            withDays({}, back, [
              { key: cancel.id, blockId: block.blockId, blockDate: block.blockDate, choice },
            ]),
          ),
        );

        const group = (await lessonsOn(s.branch, OCT19)).find((one) => one.group_id === s.groupId);
        expect(group?.cancel_cause ?? null).toBe(choice === 'cancel' ? 'reason' : null);
        const recorded = await t.database.migrator
          .selectFrom('bulk_cancel_blocks')
          .select(['block_id', 'choice'])
          .where('bulk_cancel_id', '=', cancel.id)
          .where('block_id', 'is not', null)
          .execute();
        expect(recorded).toEqual([{ block_id: group?.block_id, choice }]);
      }
    });
  });

  describe('a save over the dates of two versions', () => {
    it("sorts each stretch with its own version under one key, writes each choice in its own stretch and ends each change in its version's name; an older key is refused", async () => {
      const s = await scene();
      // Version 2 from 9 November: maths in slot 3, history in slot 1.
      const next = await nextVersion(s, NOVEMBER, 3);
      // 12 October's maths onto 19 October; 23 November's onto 16 November.
      const first = await lessonOf(s, '2026-10-12', s.classId);
      okay(await moveTo(s, first.id, OCT19, 2));
      const second = await lessonOf(s, '2026-11-23', s.classId);
      okay(await moveTo(s, second.id, '2026-11-16', 1));
      const [firstChange] = await changesOf(first.id);
      const [secondChange] = await changesOf(second.id);
      if (firstChange === undefined || secondChange === undefined) throw new Error('No move.');
      const record = dayOff(OCT19, '2026-11-16');
      const shown = await preview(s.branch, { action: 'create', record });
      expect(shown.lessons.dayChanges.decide.map((one) => one.key).sort()).toEqual(
        [firstChange.id, secondChange.id].sort(),
      );
      const decisions = [
        { key: firstChange.id, choice: 'drop' },
        { key: secondChange.id, choice: 'cancel' },
      ];

      // An older key: a cancel of 26 October recorded after the preview.
      const later = await lessonOf(s, OCT26, s.seniorId);
      okay(
        await keyed(`/api/timetable/lessons/${later.id}/cancel`, s.branch, {
          reason: 'The teacher is at a seminar',
        }),
      );
      const refused = await create(s.branch, withDays(record, shown, decisions));
      refusedWith(refused, 409, 'calendar_blocked');
      expect(detailsOf(refused).map((one) => one.code)).toEqual(['day_changes_changed']);

      const again = await preview(s.branch, { action: 'create', record });
      const saved = okay(await create(s.branch, withDays(record, again, decisions)), 201);

      const firstBack = await lessonById(first.id);
      const secondBack = await lessonById(second.id);
      expect([firstBack?.date, firstBack?.cancel_cause ?? null]).toEqual(['2026-10-12', null]);
      expect([secondBack?.date, secondBack?.cancel_cause ?? null]).toEqual([
        '2026-11-23',
        'reason',
      ]);
      expect(await endsOf(s.branch)).toEqual(
        [
          { change_id: firstChange.id, version_id: s.version },
          { change_id: secondChange.id, version_id: next },
        ].sort((a, b) => a.change_id.localeCompare(b.change_id)),
      );
      const [entry] = await t.entries('calendar_entry.create', saved.id);
      expect(
        (entry?.new_value as { dayChanges: { versionId: string }[] }).dayChanges.map(
          (one) => one.versionId,
        ),
        // A stretch is a run of consecutive dates written: 19 to 23 October
        // (the first move), 26 to 30 October (the cancel, dropped) and 16
        // November, each with an outcome; the weekends are not written.
      ).toEqual([s.version, s.version, next]);
    });
  });

  // Task 5.6b-2c-2: a stored move whose two places lie in two stretches of
  // one save (consecutive dates written; a weekend or an unchanged date
  // between them parts two), sorted once over both (decision 1): kept when
  // its new place takes it among the lessons the save writes there, else
  // needs a decision in both halves; settled and audited once, in the
  // stretch of its old place (decision 4). `edge/timetable`, Versions and
  // drafts: "One-day changes ... are stored on their own and applied again
  // ... The preview sorts them into kept, needs a decision and dropped."
  describe('a move between two stretches of one save', () => {
    const FRIDAY = '2026-10-23';

    /** A template of two lesson slots at the times of the scene's first two (lesson, break, lesson). */
    const twoTemplate = async (s: Scene) => {
      const lesson = await t.createSlotType(s.branch, 'Lesson 2', 'lesson', 45);
      const pause = await t.createSlotType(s.branch, 'Break 2', 'break', 10);
      return t.createTemplate(s.branch, 'Two', [lesson, pause, lesson]);
    };

    /** The grade-7 class's lessons of a date: start, cancel cause and reason. */
    const classDayOf = async (s: Scene, date: string) =>
      (
        await Promise.all(
          (await lessonsOn(s.branch, date))
            .filter((one) => one.class_id === s.classId)
            .map((one) => lessonById(one.id)),
        )
      ).map((one) => [
        one?.starts_at.toISOString(),
        one?.cancel_cause ?? null,
        one?.cancel_reason ?? null,
      ]);

    /** The moves of the sorting shown, by category: their keys. */
    const sortedOf = (shown: CalendarPreview) => ({
      kept: shown.lessons.dayChanges.kept.map((one) => one.key),
      decide: shown.lessons.dayChanges.decide.map((one) => one.key),
      dropped: shown.lessons.dayChanges.dropped.map((one) => one.key),
    });

    /** The days of the audit entry of an edit: version, first date, decided and ended keys. */
    const daysOf = async (entryId: string) => {
      const [entry] = await t.entries('calendar_entry.edit', entryId);
      return (
        entry?.new_value as {
          dayChanges: {
            versionId: string;
            firstDate: string;
            decided: unknown[];
            ended: string[];
          }[];
        }
      ).dayChanges.map((one) => [one.versionId, one.firstDate, one.decided, one.ended]);
    };

    it('a day off edited over both places needs a decision once, either way forward or back; with either choice neither date keeps the lesson and the change is ended once', async () => {
      for (const [from, to] of [
        [OCT19, OCT26],
        [OCT26, OCT19],
      ] as const) {
        for (const choice of ['drop', 'cancel'] as const) {
          const s = await scene();
          // A day off of Tuesday 20 to Sunday 25 October, edited to 19 to 26
          // October: the dates written are 19 and 26 October, two stretches.
          const saved = okay(await create(s.branch, dayOff('2026-10-20', '2026-10-25')), 201);
          const moving = await lessonOf(s, from, s.classId);
          okay(await moveTo(s, moving.id, to, 2));
          const [change] = await changesOf(moving.id);
          if (change === undefined) throw new Error('The move was not recorded.');
          const record = dayOff(OCT19, OCT26);
          const shown = await preview(s.branch, { action: 'edit', id: saved.id, record });
          expect(sortedOf(shown)).toEqual({ kept: [], decide: [change.id], dropped: [] });
          const rows = await storedRowsOf(s.branch);
          const before = await t.auditCount();

          const refused = await t.patch(
            `/api/setup/calendar-entries/${saved.id}`,
            s.branch,
            withDays(record, shown),
          );
          refusedWith(refused, 409, 'calendar_blocked');
          expect(detailsOf(refused).map((one) => one.code)).toEqual(['day_change_undecided']);
          expect(await storedRowsOf(s.branch)).toEqual(rows);
          expect(await t.auditCount()).toBe(before);

          // Review correction 2: one choice for the key, taken once.
          okay(
            await t.patch(
              `/api/setup/calendar-entries/${saved.id}`,
              s.branch,
              withDays(record, shown, [{ key: change.id, choice }]),
            ),
          );
          expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
          expect(await lessonsOn(s.branch, OCT26)).toEqual([]);
          expect(await lessonById(moving.id)).toBeUndefined();
          expect(await endsOf(s.branch)).toEqual([{ change_id: change.id, version_id: s.version }]);
          // Decision 4: one line, in the stretch of the old place.
          expect(await daysOf(saved.id)).toEqual([
            [s.version, from, [{ key: change.id, choice }], [change.id]],
          ]);
        }
      }
    });

    it('kept when its new place takes it: the lesson stays where it went with its id, none at the old place, the change in force', async () => {
      const s = await scene();
      const two = await twoTemplate(s);
      // A special day on "Two" of Tuesday 20 to Thursday 22 October, edited
      // to Monday 19 to Friday 23 October: 19 and 23 October written.
      const saved = okay(await create(s.branch, specialDay('2026-10-20', '2026-10-22', two)), 201);
      const moving = await lessonOf(s, OCT19, s.classId);
      okay(await moveTo(s, moving.id, FRIDAY, 2));
      const [change] = await changesOf(moving.id);
      if (change === undefined) throw new Error('The move was not recorded.');
      const record = specialDay(OCT19, FRIDAY, two);
      const shown = await preview(s.branch, { action: 'edit', id: saved.id, record });
      expect(sortedOf(shown)).toEqual({ kept: [change.id], decide: [], dropped: [] });

      okay(
        await t.patch(`/api/setup/calendar-entries/${saved.id}`, s.branch, withDays(record, shown)),
      );

      const kept = await lessonById(moving.id);
      expect([kept?.date, kept?.starts_at.toISOString(), kept?.cancel_cause ?? null]).toEqual([
        FRIDAY,
        new Date(`${FRIDAY}T08:55:00+05:00`).toISOString(),
        null,
      ]);
      // 19 October: no maths of the class; history held in slot 3 of "Two" at 08:55.
      expect(
        (await lessonsOn(s.branch, OCT19)).map((one) => [
          one.class_id,
          new Date(one.starts_at).toISOString(),
          one.cancel_cause ?? null,
        ]),
      ).toEqual([[s.seniorId, new Date(`${OCT19}T08:55:00+05:00`).toISOString(), null]]);
      expect(await endsOf(s.branch)).toEqual([]);
      expect(await daysOf(saved.id)).toEqual([[s.version, OCT19, [], []]]);
    });

    it('needs a decision when its new place is gone, listed once with that place\'s rule; "drop" holds the lesson at its old place, "cancel" cancels it there; the preview writes nothing', async () => {
      for (const choice of ['drop', 'cancel'] as const) {
        const s = await scene();
        const other = await scene();
        // "Short" has one lesson slot: 23 October no longer has lesson 2.
        const saved = okay(
          await create(s.branch, specialDay('2026-10-20', '2026-10-22', s.short)),
          201,
        );
        const moving = await lessonOf(s, OCT19, s.classId);
        okay(await moveTo(s, moving.id, FRIDAY, 2));
        const [change] = await changesOf(moving.id);
        if (change === undefined) throw new Error('The move was not recorded.');
        const record = specialDay(OCT19, FRIDAY, s.short);
        const rows = [await storedRowsOf(s.branch), await storedRowsOf(other.branch)];
        const before = await t.auditCount();

        const shown = await preview(s.branch, { action: 'edit', id: saved.id, record });

        expect(sortedOf(shown)).toEqual({ kept: [], decide: [change.id], dropped: [] });
        const [item] = shown.lessons.dayChanges.decide;
        expect(item?.blocked.map((one) => [one.date, one.rule])).toEqual([[FRIDAY, 'not_a_slot']]);
        expect(await storedRowsOf(s.branch)).toEqual(rows[0]);
        expect(await storedRowsOf(other.branch)).toEqual(rows[1]);
        expect(await t.auditCount()).toBe(before);

        okay(
          await t.patch(
            `/api/setup/calendar-entries/${saved.id}`,
            s.branch,
            withDays(record, shown, [{ key: change.id, choice }]),
          ),
        );

        expect(await lessonsOn(s.branch, FRIDAY)).toEqual([]);
        expect(await classDayOf(s, OCT19)).toEqual([
          [
            new Date(`${OCT19}T08:00:00+05:00`).toISOString(),
            ...(choice === 'drop' ? [null, null] : ['reason', 'Excursion to the museum']),
          ],
        ]);
        expect(await endsOf(s.branch)).toEqual([{ change_id: change.id, version_id: s.version }]);
        expect(await daysOf(saved.id)).toEqual([
          [s.version, OCT19, [{ key: change.id, choice }], [change.id]],
        ]);
        expect(await storedRowsOf(other.branch)).toEqual(rows[1]);
      }
    });

    // Decision 5 (spec review of the plan, must-fix 1): a move put back at
    // its old place takes the new place of another move, which a second pass
    // of the sorting then finds; also a move onto the same weekday a week
    // later, where the entry has a lesson of its own (`.claude/rules/timetable.md`).
    it("sorts again when a move put back takes the new place of another: both need a decision, and the entry's own lesson of the later date stays held", async () => {
      const s = await scene();
      const two = await twoTemplate(s);
      // "Two" from Tuesday 20 to Sunday 25 October, its weekend following
      // Monday, edited to 19 to 26 October: the Mondays 19 and 26 written.
      const saved = okay(
        await create(s.branch, specialDay('2026-10-20', '2026-10-25', two, { followsWeekday: 1 })),
        201,
      );
      // X: 19 October's maths to 26 October lesson 3, not a slot of "Two".
      const x = await lessonOf(s, OCT19, s.classId);
      okay(await moveTo(s, x.id, OCT26, 3));
      // Y: 26 October's maths to 19 October lesson 1, the place X left.
      const y = (await lessonsOn(s.branch, OCT26)).find(
        (one) => one.class_id === s.classId && one.id !== x.id,
      );
      if (y === undefined) throw new Error('No maths on 26 October.');
      // A second apart: the changes of one moment and person are one item.
      try {
        t.clock.advance(1000);
        okay(await moveTo(s, y.id, OCT19, 1));
      } finally {
        t.clock.set(START);
      }
      const [xChange] = await changesOf(x.id);
      const [yChange] = await changesOf(y.id);
      if (xChange === undefined || yChange === undefined) throw new Error('No move.');
      const record = specialDay(OCT19, OCT26, two, { followsWeekday: 1 });

      const shown = await preview(s.branch, { action: 'edit', id: saved.id, record });

      expect(sortedOf(shown)).toEqual({
        kept: [],
        decide: [xChange.id, yChange.id].sort(),
        dropped: [],
      });
      expect(
        shown.lessons.dayChanges.decide
          .find((one) => one.key === yChange.id)
          ?.blocked.map((one) => [one.date, one.rule]),
      ).toContainEqual([OCT19, 'class_double']);

      okay(
        await t.patch(
          `/api/setup/calendar-entries/${saved.id}`,
          s.branch,
          withDays(record, shown, [
            { key: xChange.id, choice: 'cancel' },
            { key: yChange.id, choice: 'drop' },
          ]),
        ),
      );

      expect(await classDayOf(s, OCT19)).toEqual([
        [new Date(`${OCT19}T08:00:00+05:00`).toISOString(), 'reason', 'Excursion to the museum'],
      ]);
      expect(await classDayOf(s, OCT26)).toEqual([
        [new Date(`${OCT26}T08:00:00+05:00`).toISOString(), null, null],
      ]);
      expect((await endsOf(s.branch)).map((one) => one.change_id)).toEqual(
        [xChange.id, yChange.id].sort(),
      );
      // Decision 4 (code review, should-fix 2): each move audited once, in
      // the stretch of its own old place.
      expect(await daysOf(saved.id)).toEqual([
        [s.version, OCT19, [{ key: xChange.id, choice: 'cancel' }], [xChange.id]],
        [s.version, OCT26, [{ key: yChange.id, choice: 'drop' }], [yChange.id]],
      ]);
    });

    // Decision 4 (code review, must-fix 1): a move recorded while one version
    // was in force, kept by a publish of a second version from a date
    // between its two places, lies in two stretches of two versions.
    it('between the stretches of two versions is ended in the name of the version of its old place, with one audit line there', async () => {
      const s = await scene();
      const saved = okay(await create(s.branch, dayOff('2026-10-20', '2026-10-25')), 201);
      const moving = await lessonOf(s, OCT19, s.classId);
      okay(await moveTo(s, moving.id, OCT26, 2));
      const [change] = await changesOf(moving.id);
      if (change === undefined) throw new Error('The move was not recorded.');
      // Version 2 from Monday 26 October keeps the move at its new place.
      const next = await nextVersion(s, OCT26, 1, true);
      expect((await lessonById(moving.id))?.date).toBe(OCT26);
      const record = dayOff(OCT19, OCT26);
      const shown = await preview(s.branch, { action: 'edit', id: saved.id, record });
      expect(sortedOf(shown)).toEqual({ kept: [], decide: [change.id], dropped: [] });

      okay(
        await t.patch(
          `/api/setup/calendar-entries/${saved.id}`,
          s.branch,
          withDays(record, shown, [{ key: change.id, choice: 'drop' }]),
        ),
      );

      expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
      expect(await lessonsOn(s.branch, OCT26)).toEqual([]);
      expect(next).not.toBe(s.version);
      expect(await endsOf(s.branch)).toEqual([{ change_id: change.id, version_id: s.version }]);
      expect(await daysOf(saved.id)).toEqual([
        [s.version, OCT19, [{ key: change.id, choice: 'drop' }], [change.id]],
      ]);
    });
  });

  // Task 5.6b-2b (pull request #171): the choice of the lessons kept on a
  // shortened day over published dates (`edge/time-dates-calendar`, "A
  // shortened day has 5 lesson slots and a class has 7 lessons that weekday.
  // Lessons are matched by their order in the day. ... The Academic Vice
  // Principal can choose which lessons are kept"), taken in the calendar save
  // and its preview for the version in force and stored in
  // `timetable_day_keeps`. The grade-7 class has maths, art and music in
  // slots 1, 3 and 5 on Mondays; the special day's template has two lesson
  // slots (positions 1 and 3).
  describe("the shortened day's choice", () => {
    async function keepScene() {
      const s = await scene({ three: true });
      const lesson = await t.createSlotType(s.branch, 'Lesson 2', 'lesson', 45);
      const pause = await t.createSlotType(s.branch, 'Break 2', 'break', 10);
      const two = await t.createTemplate(s.branch, 'Two', [lesson, pause, lesson]);
      return { ...s, two, art: s.art ?? '', music: s.music ?? '' };
    }

    type KeepScene = Awaited<ReturnType<typeof keepScene>>;

    /** A copy of the version with its rows placed again where they were, edit lock freed. */
    async function copyPlaced(k: KeepScene): Promise<string> {
      const next = await draft(k.branch, k.year, k.version);
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', next)
        .execute();
      const rows = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select(['id', 'subject_id'])
        .where('version_id', '=', next)
        .execute();
      const slotOf = new Map([
        [k.maths, 1],
        [k.history, 3],
        [k.art, 3],
        [k.music, 5],
      ]);
      for (const row of rows) await placeAt(k.branch, next, row.id, 1, slotOf.get(row.subject_id));
      await confirmTemplates(k.branch, next);
      await load.freeEditLock(next);
      return next;
    }

    const keepsOf = (branch: string) =>
      t.database.migrator
        .selectFrom('timetable_day_keeps')
        .select([
          'version_id',
          'class_id',
          sql<string>`kept_on::text`.as('kept_on'),
          'slot_position',
        ])
        .where('branch_id', '=', branch)
        .orderBy('version_id')
        .orderBy('kept_on')
        .orderBy('class_id')
        .orderBy('slot_position')
        .execute();

    /** The grade-7 class's lessons of a date by subject: cancel cause and start. */
    const dayOf = async (k: KeepScene, date: string) =>
      Object.fromEntries(
        (await lessonsOn(k.branch, date))
          .filter((one) => one.class_id === k.classId)
          .map((one) => [
            one.subject_id === k.maths ? 'maths' : one.subject_id === k.art ? 'art' : 'music',
            [one.cancel_cause, new Date(one.starts_at).toISOString()],
          ]),
      );

    /** The start of history (the senior class's lesson 2) on a date: the second lesson slot. */
    const secondSlot = async (k: KeepScene, date: string) =>
      new Date((await lessonOf(k, date, k.seniorId)).starts_at).toISOString();
    const firstSlot = (date: string) => new Date(`${date}T08:00:00+05:00`).toISOString();

    const keep = (k: KeepScene, slotPositions: number[], date = OCT19, classId = k.classId) => ({
      classId,
      date,
      slotPositions,
    });

    it('a special shortened day keeps the two lessons chosen: one in its own slot, the other in the free slot; the others cancelled "not in the day\'s template"', async () => {
      const k = await keepScene();
      const record = specialDay(OCT19, OCT19, k.two);
      const saved = okay(await create(k.branch, { ...record, dayKeeps: [keep(k, [1, 5])] }), 201);

      const second = await secondSlot(k, OCT19);
      expect(await dayOf(k, OCT19)).toEqual({
        maths: [null, firstSlot(OCT19)],
        art: ['not_in_template', expect.any(String)],
        music: [null, second],
      });
      expect(await keepsOf(k.branch)).toEqual([
        { version_id: k.version, class_id: k.classId, kept_on: OCT19, slot_position: 1 },
        { version_id: k.version, class_id: k.classId, kept_on: OCT19, slot_position: 5 },
      ]);
      const [entry] = await t.entries('calendar_entry.create', saved.id);
      expect((entry?.new_value as { dayKeeps: unknown }).dayKeeps).toEqual([
        { versionId: k.version, date: OCT19, classId: k.classId, before: [], after: [1, 5] },
      ]);
      // Another Monday of the version is not touched.
      expect(await dayOf(k, OCT26)).toEqual({
        maths: [null, expect.any(String)],
        art: [null, expect.any(String)],
        music: [null, expect.any(String)],
      });
    });

    it('the preview follows the ticks sent and writes nothing; without ticks the lessons are kept by their order in the day', async () => {
      const k = await keepScene();
      const record = specialDay(OCT19, OCT19, k.two);
      const rows = await storedRowsOf(k.branch);
      const before = await t.auditCount();

      const plain = await preview(k.branch, { action: 'create', record });
      expect(plain.lessons.shortenedDays.map((one) => [one.classId, one.kept, one.chosen])).toEqual(
        [[k.classId, [1, 3], false]],
      );
      expect(plain.lessons.cancelled.map((one) => one.subjectId)).toEqual([k.music]);

      const ticked = await preview(k.branch, {
        action: 'create',
        record,
        dayKeeps: [keep(k, [1, 5])],
      });
      const [day] = ticked.lessons.shortenedDays;
      expect(day).toMatchObject({
        date: OCT19,
        classId: k.classId,
        lessonSlots: 2,
        kept: [1, 5],
        chosen: true,
        missingPositions: [],
      });
      expect(day?.lessons.map((one) => [one.slotPosition, one.subjects])).toEqual([
        [1, [{ unitId: k.classId, subjectId: k.maths }]],
        [3, [{ unitId: k.classId, subjectId: k.art }]],
        [5, [{ unitId: k.classId, subjectId: k.music }]],
      ]);
      expect(ticked.lessons.names.subjects.map((one) => one.id)).toEqual(
        expect.arrayContaining([k.maths, k.art, k.music]),
      );
      expect(ticked.lessons.cancelled.map((one) => one.subjectId)).toEqual([k.art]);
      expect(ticked.lessons.keepRefusals).toEqual([]);
      expect(await storedRowsOf(k.branch)).toEqual(rows);
      expect(await t.auditCount()).toBe(before);
    });

    it('an edit of the unchanged entry with a new choice writes that date again and marks the drafts; an empty list goes back to the order of the day', async () => {
      const k = await keepScene();
      const record = specialDay(OCT19, OCT19, k.two);
      const saved = okay(await create(k.branch, record), 201);
      expect(await dayOf(k, OCT19)).toMatchObject({
        music: ['not_in_template', expect.any(String)],
      });
      const draftId = await copyPlaced(k);
      const causes = async () =>
        (
          await t.database.migrator
            .selectFrom('timetable_version_out_of_date_causes')
            .select('id')
            .where('version_id', '=', draftId)
            .execute()
        ).length;
      const causesBefore = await causes();

      okay(
        await t.patch(`/api/setup/calendar-entries/${saved.id}`, k.branch, {
          ...record,
          dayKeeps: [keep(k, [3, 5])],
        }),
      );
      // Art keeps its own number's slot (the second); music takes the first.
      const second = await secondSlot(k, OCT19);
      expect(await dayOf(k, OCT19)).toEqual({
        maths: ['not_in_template', expect.any(String)],
        art: [null, second],
        music: [null, firstSlot(OCT19)],
      });
      expect(await causes()).toBeGreaterThan(causesBefore);
      const [edit] = await t.entries('calendar_entry.edit', saved.id);
      expect((edit?.new_value as { dayKeeps: unknown }).dayKeeps).toEqual([
        { versionId: k.version, date: OCT19, classId: k.classId, before: [], after: [3, 5] },
      ]);

      okay(
        await t.patch(`/api/setup/calendar-entries/${saved.id}`, k.branch, {
          ...record,
          dayKeeps: [keep(k, [])],
        }),
      );
      expect(await dayOf(k, OCT19)).toEqual({
        maths: [null, firstSlot(OCT19)],
        art: [null, second],
        music: ['not_in_template', expect.any(String)],
      });
      expect(await keepsOf(k.branch)).toEqual([]);
      // An edit with nothing changed and no choice is still answered as it is.
      const audit = await t.auditCount();
      okay(await t.patch(`/api/setup/calendar-entries/${saved.id}`, k.branch, record));
      expect(await t.auditCount()).toBe(audit);
    });

    it('a stored choice whose day is no longer shortened stays, decides nothing, and is shown again when the day is shortened again', async () => {
      const k = await keepScene();
      const record = specialDay(OCT19, OCT19, k.two);
      const saved = okay(await create(k.branch, { ...record, dayKeeps: [keep(k, [1, 5])] }), 201);
      const stored = await keepsOf(k.branch);

      okay(
        await t.patch(
          `/api/setup/calendar-entries/${saved.id}`,
          k.branch,
          specialDay(OCT19, OCT19, k.regular),
        ),
      );
      expect(await keepsOf(k.branch)).toEqual(stored);
      expect(Object.values(await dayOf(k, OCT19)).map(([cause]) => cause)).toEqual([
        null,
        null,
        null,
      ]);

      const shown = await preview(k.branch, { action: 'edit', id: saved.id, record });
      expect(shown.lessons.shortenedDays.map((one) => [one.kept, one.chosen])).toEqual([
        [[1, 5], true],
      ]);
      okay(await t.patch(`/api/setup/calendar-entries/${saved.id}`, k.branch, record));
      expect(await dayOf(k, OCT19)).toMatchObject({
        art: ['not_in_template', expect.any(String)],
        music: [null, await secondSlot(k, OCT19)],
      });
    });

    // Spec review of the code, must-fix 4 (review correction 1): an empty
    // list removes a choice whose day is no longer shortened.
    it('an empty list removes a stored choice whose day the entry no longer shortens', async () => {
      const k = await keepScene();
      const record = specialDay(OCT19, OCT19, k.two);
      const saved = okay(await create(k.branch, { ...record, dayKeeps: [keep(k, [1, 5])] }), 201);
      const regular = specialDay(OCT19, OCT19, k.regular);
      okay(await t.patch(`/api/setup/calendar-entries/${saved.id}`, k.branch, regular));
      expect(await keepsOf(k.branch)).toHaveLength(2);

      okay(
        await t.patch(`/api/setup/calendar-entries/${saved.id}`, k.branch, {
          ...regular,
          dayKeeps: [keep(k, [])],
        }),
      );
      expect(await keepsOf(k.branch)).toEqual([]);
      expect(Object.values(await dayOf(k, OCT19)).map(([cause]) => cause)).toEqual([
        null,
        null,
        null,
      ]);
    });

    // Spec review of the code, should-fix 3: on an edit of a started entry,
    // whose own dates give the rewrite nothing, a choice for today is refused
    // for its date, not as a date not written.
    it('refuses a choice for today on an edit of a started entry, with nothing written', async () => {
      const k = await keepScene();
      const entry = await t.database.migrator
        .insertInto('calendar_entries')
        .values({
          branch_id: k.branch,
          kind: 'day_off',
          name: 'Navruz',
          first_date: '2026-10-09',
          last_date: MONDAY,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const rows = await storedRowsOf(k.branch);
      const before = await t.auditCount();
      refusedWith(
        await t.patch(`/api/setup/calendar-entries/${entry.id}`, k.branch, {
          ...dayOff('2026-10-09', MONDAY),
          dayKeeps: [keep(k, [1], '2026-10-10')],
        }),
        409,
        'day_keep_date_passed',
      );
      expect(await storedRowsOf(k.branch)).toEqual(rows);
      expect(await t.auditCount()).toBe(before);
    });

    it('refuses a choice the day cannot take, each by its own check, with nothing written; the preview lists it and leaves it out', async () => {
      const k = await keepScene();
      const record = specialDay(OCT19, OCT19, k.two);
      const plain = await preview(k.branch, { action: 'create', record });
      const rows = await storedRowsOf(k.branch);
      const before = await t.auditCount();
      const cases: [string, ReturnType<typeof keep>][] = [
        // Today, also as an empty list (review correction 1).
        ['day_keep_date_passed', keep(k, [1, 5], '2026-10-10')],
        ['day_keep_date_passed', keep(k, [], '2026-10-10')],
        // A date the save does not write, also as an empty list.
        ['day_keep_not_short', keep(k, [1, 5], OCT26)],
        ['day_keep_not_short', keep(k, [], OCT26)],
        // Written, but the senior class's one lesson fits the day.
        ['day_keep_not_short', keep(k, [3], OCT19, k.seniorId)],
        // Position 2 is a break.
        ['day_keep_lessons', keep(k, [1, 2])],
        ['day_keep_over_slots', keep(k, [1, 3, 5])],
      ];
      for (const [code, one] of cases) {
        refusedWith(await create(k.branch, { ...record, dayKeeps: [one] }), 409, code);
        const shown = await preview(k.branch, { action: 'create', record, dayKeeps: [one] });
        expect(shown.lessons.keepRefusals, code).toEqual([
          { date: one.date, classId: one.classId, code },
        ]);
        expect(shown.lessons.cancelled, code).toEqual(plain.lessons.cancelled);
        expect(shown.lessons.shortenedDays, code).toEqual(plain.lessons.shortenedDays);
      }
      expect(await storedRowsOf(k.branch)).toEqual(rows);
      expect(await t.auditCount()).toBe(before);
    });

    it('the key of the stored changes follows the ticks: a room change of a lesson the choice drops is dropped, one it keeps is kept', async () => {
      const k = await keepScene();
      const art = (await lessonsOn(k.branch, OCT19)).find((one) => one.subject_id === k.art);
      if (art === undefined) throw new Error('No art lesson.');
      okay(
        await keyed(`/api/timetable/lessons/${art.id}/room`, k.branch, {
          roomId: await load.classes.room(k.branch),
          reason: 'The room is painted',
        }),
      );
      const record = specialDay(OCT19, OCT19, k.two);
      const keepsArt = [keep(k, [1, 3])];
      const dropsArt = [keep(k, [1, 5])];
      const shownKeeping = await preview(k.branch, {
        action: 'create',
        record,
        dayKeeps: keepsArt,
      });
      const shownDropping = await preview(k.branch, {
        action: 'create',
        record,
        dayKeeps: dropsArt,
      });
      expect(shownKeeping.lessons.dayChanges.kept).toHaveLength(1);
      expect(shownDropping.lessons.dayChanges.dropped).toHaveLength(1);
      expect(shownDropping.lessons.dayChanges.key).not.toBe(shownKeeping.lessons.dayChanges.key);

      // The ticks changed after the preview: refused, nothing written.
      const rows = await storedRowsOf(k.branch);
      const wrong = await create(k.branch, {
        ...withDays(record, shownKeeping),
        dayKeeps: dropsArt,
      });
      refusedWith(wrong, 409, 'calendar_blocked');
      expect(detailsOf(wrong).map((one) => one.code)).toEqual(['day_changes_changed']);
      expect(await storedRowsOf(k.branch)).toEqual(rows);

      okay(await create(k.branch, { ...withDays(record, shownDropping), dayKeeps: dropsArt }), 201);
      expect(await dayOf(k, OCT19)).toMatchObject({ art: ['not_in_template', expect.any(String)] });
      expect(await endsOf(k.branch)).toHaveLength(1);
    });

    it('a save over the dates of two versions stores each choice under the version in force on its date', async () => {
      const k = await keepScene();
      const next = await copyPlaced(k);
      // The second version from 9 November; the special day runs from Monday
      // 26 October over the vacation to Monday 9 November, its weekend days
      // following Monday's timetable.
      const published = await publish(k.branch, next, NOVEMBER);
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      const record = specialDay(OCT26, NOVEMBER, k.two, { followsWeekday: 1 });
      const shown = await preview(k.branch, {
        action: 'create',
        record,
        dayKeeps: [keep(k, [1, 5], OCT26), keep(k, [3, 5], NOVEMBER)],
      });
      okay(
        await create(k.branch, {
          ...withDays(record, shown),
          dayKeeps: [keep(k, [1, 5], OCT26), keep(k, [3, 5], NOVEMBER)],
        }),
        201,
      );
      expect(
        (await keepsOf(k.branch)).map((one) => [one.version_id, one.kept_on, one.slot_position]),
      ).toEqual(
        [
          [k.version, OCT26, 1],
          [k.version, OCT26, 5],
          [next, NOVEMBER, 3],
          [next, NOVEMBER, 5],
        ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      );
      expect(await dayOf(k, OCT26)).toMatchObject({ art: ['not_in_template', expect.any(String)] });
      expect(await dayOf(k, NOVEMBER)).toMatchObject({
        maths: ['not_in_template', expect.any(String)],
      });
    });

    // Spec review of the code, must-fix 1 (decision 5): a later version
    // published over the date follows its own choice, not the stored one of
    // the version it replaces there.
    it("a later publish over the date follows its own version's choice", async () => {
      const k = await keepScene();
      okay(
        await create(k.branch, {
          ...specialDay(OCT19, OCT19, k.two),
          dayKeeps: [keep(k, [1, 5])],
        }),
        201,
      );
      const next = await copyPlaced(k);
      // The draft's own choice: none (the copy carried it; the draft drops it).
      await t.database.migrator
        .deleteFrom('timetable_day_keeps')
        .where('version_id', '=', next)
        .execute();
      const published = await publish(k.branch, next, OCT19);
      expect(published.status, JSON.stringify(published.body)).toBe(200);

      expect(await dayOf(k, OCT19)).toEqual({
        maths: [null, firstSlot(OCT19)],
        art: [null, await secondSlot(k, OCT19)],
        music: ['not_in_template', expect.any(String)],
      });
      // The earlier version's choice stays its own.
      expect((await keepsOf(k.branch)).map((one) => [one.version_id, one.slot_position])).toEqual([
        [k.version, 1],
        [k.version, 5],
      ]);
    });

    it('a draft copied from the published version after the save carries the choice', async () => {
      const k = await keepScene();
      okay(
        await create(k.branch, {
          ...specialDay(OCT19, OCT19, k.two),
          dayKeeps: [keep(k, [1, 5])],
        }),
        201,
      );
      const copy = await draft(k.branch, k.year, k.version);
      expect(
        (await keepsOf(k.branch))
          .filter((one) => one.version_id === copy)
          .map((one) => [one.class_id, one.kept_on, one.slot_position]),
      ).toEqual([
        [k.classId, OCT19, 1],
        [k.classId, OCT19, 5],
      ]);
    });
  });

  describe('the preview', () => {
    it('lists what the save then does and writes nothing', async () => {
      const s = await scene();
      const other = await scene();
      // Task 5.6b-2a (permission review should-fix 1): the other branch holds a
      // room change and a bulk cancel on the same date, which the Super
      // Admin's preview and save of this branch neither list nor touch.
      const roomed = await lessonOf(other, OCT19, other.seniorId);
      okay(
        await keyed(`/api/timetable/lessons/${roomed.id}/room`, other.branch, {
          roomId: await load.classes.room(other.branch),
          reason: 'The room is painted',
        }),
      );
      await bulkCancel(other, { date: OCT19, classIds: [other.classId], lessonNumbers: [1] });
      const rows = [await storedRowsOf(s.branch), await storedRowsOf(other.branch)];
      const before = await t.auditCount();

      const shown = await preview(s.branch, { action: 'create', record: dayOff(OCT19) });

      expect(shown.lessons.dayChanges).toEqual({
        key: shown.lessons.dayChanges.key,
        kept: [],
        decide: [],
        dropped: [],
        bulk: [],
        exams: [],
        // Task 5.7a-1 (decision 7): a calendar save lists no absences.
        absences: [],
        // Task 5.7a-2b (decision 9): nor room closures.
        closures: [],
      });
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
    const north = await scene({ group: true });
    const south = await scene({ group: true });
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
    // Task 5.6b-2a (permission review must-fix 1): in each branch, rows of
    // every table the save writes: a room change on 16 November, which a save
    // of that date would end; a bulk cancel of that date keeping the group's
    // block (`bulk_cancel_blocks`); and a room change of 23 November ended
    // by a day off (`lesson_day_change_ends`). And a pattern block of the south.
    const changeOf: Record<string, string> = {};
    const bulkOf: Record<string, string> = {};
    for (const one of [north, south]) {
      const lesson = await lessonOf(one, '2026-11-16', one.seniorId);
      okay(
        await keyed(`/api/timetable/lessons/${lesson.id}/room`, one.branch, {
          roomId: await load.classes.room(one.branch),
          reason: 'The room is painted',
        }),
      );
      changeOf[one.branch] = (await changesOf(lesson.id))[0]?.id ?? '';
      bulkOf[one.branch] = (
        await bulkCancel(
          one,
          { date: '2026-11-16', classIds: [one.seniorId], lessonNumbers: [3] },
          'keep',
        )
      ).id;
      const ended = await lessonOf(one, '2026-11-23', one.seniorId);
      t.clock.advance(1000);
      try {
        okay(
          await keyed(`/api/timetable/lessons/${ended.id}/room`, one.branch, {
            roomId: await load.classes.room(one.branch),
            reason: 'The room is painted',
          }),
        );
      } finally {
        t.clock.set(START);
      }
      const record = dayOff('2026-11-23');
      okay(
        await create(
          one.branch,
          withDays(record, await preview(one.branch, { action: 'create', record })),
        ),
        201,
      );
    }
    // Task 5.6b-2b: a shortened day's choice stored in each branch (the
    // senior class's history, lesson 2, beyond the one slot of `short`).
    for (const one of [north, south]) {
      okay(
        await create(one.branch, {
          ...specialDay('2026-11-30', '2026-11-30', one.short),
          dayKeeps: [{ classId: one.seniorId, date: '2026-11-30', slotPositions: [3] }],
        }),
        201,
      );
      expect(
        await t.database.migrator
          .selectFrom('timetable_day_keeps')
          .select('id')
          .where('branch_id', '=', one.branch)
          .execute(),
      ).toHaveLength(1);
    }
    // Task 5.6b-3: a split group's choice stored in each branch, on 30
    // November (a day off for grade 9 only, the group kept for grade 10).
    const nineEntryOf: Record<string, string> = {};
    for (const one of [north, south]) {
      nineEntryOf[one.branch] = okay(
        await create(one.branch, {
          ...dayOff('2026-12-07', '2026-12-07', { gradeFrom: 9, gradeTo: 9 }),
          groupBlocks: [{ weekday: 1, start: 590, groupIds: [one.groupId ?? ''], choice: 'keep' }],
        }),
        201,
      ).id;
      expect(
        await t.database.migrator
          .selectFrom('calendar_group_blocks')
          .select('id')
          .where('branch_id', '=', one.branch)
          .execute(),
      ).toHaveLength(1);
    }
    for (const one of [north, south]) {
      expect(await endsOf(one.branch)).toHaveLength(1);
      expect(
        await t.database.migrator
          .selectFrom('bulk_cancel_blocks')
          .select('block_id')
          .where('branch_id', '=', one.branch)
          .execute(),
      ).toHaveLength(1);
    }
    // Task 5.6b-2c-1: in each branch an exam of the grade-10 class on 16
    // November in slot 5, the class kept out of the group's block
    // (`lesson_block_class_outs`), which a save of that date would cancel
    // and remove (`.claude/rules/api.md`: a route that writes more tables
    // widens the rows of its 404 tests, with rows the save would change;
    // permission review must-fix 1).
    const examOf: Record<string, string> = {};
    for (const one of [north, south]) {
      const sport = await t.database.migrator
        .selectFrom('lessons')
        .select('block_id')
        .where('group_id', '=', one.groupId ?? '')
        .where('lesson_date', '=', '2026-11-16')
        .executeTakeFirstOrThrow();
      const examRoom = await load.classes.room(one.branch);
      examOf[one.branch] = await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`set constraints all deferred`.execute(transaction);
        const written = await transaction
          .insertInto('exams')
          .values({
            branch_id: one.branch,
            academic_year_id: one.year,
            exam_date: '2026-11-16',
            starts_at: new Date('2026-11-16T09:50:00+05:00'),
            ends_at: new Date('2026-11-16T10:35:00+05:00'),
            first_slot: 5,
            last_slot: 5,
            title: 'Quarter exam',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const room = await transaction
          .insertInto('exam_rooms')
          .values({ branch_id: one.branch, exam_id: written.id, room_id: examRoom })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('exam_room_classes')
          .values({
            branch_id: one.branch,
            exam_id: written.id,
            exam_room_id: room.id,
            class_id: one.seniorId,
          })
          .execute();
        await transaction
          .insertInto('exam_invigilators')
          .values({
            branch_id: one.branch,
            exam_id: written.id,
            exam_room_id: room.id,
            staff_id: one.teacherId,
          })
          .execute();
        await transaction
          .insertInto('lesson_block_class_outs')
          .values({
            branch_id: one.branch,
            block_id: sport.block_id,
            class_id: one.seniorId,
            exam_id: written.id,
          })
          .execute();
        await sql`set constraints all immediate`.execute(transaction);
        return written.id;
      });
      const outs = await t.database.migrator
        .selectFrom('lesson_block_class_outs')
        .select('exam_id')
        .where('branch_id', '=', one.branch)
        .execute();
      expect(outs).toEqual([{ exam_id: examOf[one.branch] }]);
    }
    // Task 5.7b-1 (permission review, must-fix 1): substitutions in force on
    // the lessons from 19 October in each branch, which a save of those dates
    // would end with the lessons it rewrites or removes.
    for (const one of [north, south]) {
      expect(await substitutedIn(t.database.migrator, one.branch, OCT19)).toBeGreaterThan(0);
    }
    const southLesson = await lessonOf(south, '2026-11-16', south.classId);
    const southBlock = await t.database.migrator
      .selectFrom('pattern_blocks')
      .select('id')
      .where('branch_id', '=', south.branch)
      .executeTakeFirstOrThrow();
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
          refusedWith(await attempt(), 404, 'not_found');
        }
      }
      // Task 5.6b-2a (decision 11): a key or a block of a decision of
      // another branch, or unknown, on every save that takes them.
      const decisionsOf = [
        // A key names a one-day change, a lesson (a one-lesson cancel) or a
        // bulk cancel (permission review should-fix 2).
        [{ key: changeOf[south.branch] ?? '', choice: 'drop' }],
        [{ key: southLesson.id, choice: 'drop' }],
        [{ key: bulkOf[south.branch] ?? '', choice: 'drop' }],
        [{ key: UNKNOWN, choice: 'drop' }],
        ...[southBlock.id, UNKNOWN].map((blockId) => [
          {
            key: changeOf[north.branch] ?? '',
            blockId,
            blockDate: '2026-11-16',
            choice: 'cancel',
          },
        ]),
      ];
      for (const dayDecisions of decisionsOf) {
        for (const attempt of [
          () => create(north.branch, { ...dayOff('2026-11-16'), dayDecisions }),
          () =>
            t.patch(
              `/api/setup/calendar-entries/${northEntry.id}`,
              north.branch,
              { ...specialDay(OCT19, '2026-11-16', north.short), dayDecisions },
              cookie,
            ),
          () =>
            post(`/api/setup/calendar-entries/${northEntry.id}/archive`, north.branch, {
              dayDecisions,
            }),
          () =>
            post(`/api/setup/calendar-entries/${northEntry.id}/restore`, north.branch, {
              dayDecisions,
            }),
        ]) {
          refusedWith(await attempt(), 404, 'not_found');
        }
      }
      // Task 5.6b-2b: a choice naming another branch's class, or an unknown
      // one, on every save and preview that takes it.
      for (const classId of [south.seniorId, UNKNOWN]) {
        const dayKeeps = [{ classId, date: OCT19, slotPositions: [3] }];
        for (const attempt of [
          () => create(north.branch, { ...specialDay(OCT26, OCT26, north.short), dayKeeps }),
          () =>
            t.patch(
              `/api/setup/calendar-entries/${northEntry.id}`,
              north.branch,
              { ...specialDay(OCT19, OCT19, north.short), dayKeeps },
              cookie,
            ),
          () =>
            post(`/api/setup/calendar-entries/${northEntry.id}/archive`, north.branch, {
              dayKeeps,
            }),
          () =>
            post(`/api/setup/calendar-entries/${northEntry.id}/restore`, north.branch, {
              dayKeeps,
            }),
          () =>
            post('/api/setup/calendar-entries/preview', north.branch, {
              action: 'create',
              record: specialDay(OCT26, OCT26, north.short),
              dayKeeps,
            }),
          () =>
            post('/api/setup/calendar-entries/preview', north.branch, {
              action: 'edit',
              id: northEntry.id,
              record: specialDay(OCT19, OCT19, north.short),
              dayKeeps,
            }),
          () =>
            post('/api/setup/calendar-entries/preview', north.branch, {
              action: 'archive',
              id: northEntry.id,
              dayKeeps,
            }),
          () =>
            post('/api/setup/calendar-entries/preview', north.branch, {
              action: 'restore',
              id: northEntry.id,
              dayKeeps,
            }),
        ]) {
          refusedWith(await attempt(), 404, 'not_found');
        }
      }
      // Task 5.6b-2c-1: a block's choice naming another branch's exam or
      // class, or an unknown one, on every save and preview that takes it.
      for (const examBlocks of [
        [
          {
            examId: examOf[south.branch] ?? '',
            classId: north.seniorId,
            start: 480,
            choice: 'keep',
          },
        ],
        [{ examId: UNKNOWN, classId: north.seniorId, start: 480, choice: 'keep' }],
        [
          {
            examId: examOf[north.branch] ?? '',
            classId: south.seniorId,
            start: 480,
            choice: 'cancel',
          },
        ],
        [{ examId: examOf[north.branch] ?? '', classId: UNKNOWN, start: 480, choice: 'cancel' }],
      ]) {
        for (const attempt of [
          () => create(north.branch, { ...dayOff('2026-11-16'), examBlocks }),
          () =>
            t.patch(
              `/api/setup/calendar-entries/${northEntry.id}`,
              north.branch,
              { ...specialDay(OCT19, '2026-11-16', north.short), examBlocks },
              cookie,
            ),
          () =>
            post(`/api/setup/calendar-entries/${northEntry.id}/archive`, north.branch, {
              examBlocks,
            }),
          () =>
            post(`/api/setup/calendar-entries/${northEntry.id}/restore`, north.branch, {
              examBlocks,
            }),
          () =>
            post('/api/setup/calendar-entries/preview', north.branch, {
              action: 'create',
              record: dayOff('2026-11-16'),
              examBlocks,
            }),
          () =>
            post('/api/setup/calendar-entries/preview', north.branch, {
              action: 'archive',
              id: northEntry.id,
              examBlocks,
            }),
          // Permission review should-fix 1: the edit and the restore previews.
          () =>
            post('/api/setup/calendar-entries/preview', north.branch, {
              action: 'edit',
              id: northEntry.id,
              record: specialDay(OCT19, '2026-11-16', north.short),
              examBlocks,
            }),
          () =>
            post('/api/setup/calendar-entries/preview', north.branch, {
              action: 'restore',
              id: northEntry.id,
              examBlocks,
            }),
        ]) {
          refusedWith(await attempt(), 404, 'not_found');
        }
      }
      // Task 5.6b-3: a block's choice naming another branch's group, or an
      // unknown one, on every save and preview that takes it.
      const northNine = nineEntryOf[north.branch] ?? '';
      const nineOff = dayOff('2026-12-07', '2026-12-07', { gradeFrom: 9, gradeTo: 9 });
      // Permission review should-fix 3: a block of one own group and one of another branch too.
      for (const groupIds of [
        [south.groupId ?? ''],
        [UNKNOWN],
        [north.groupId ?? '', south.groupId ?? ''],
      ]) {
        const groupBlocks = [{ weekday: 1, start: 590, groupIds, choice: 'cancel' }];
        for (const attempt of [
          () =>
            create(north.branch, {
              ...dayOff('2026-12-14', '2026-12-14', { gradeFrom: 9, gradeTo: 9 }),
              groupBlocks,
            }),
          () =>
            t.patch(
              `/api/setup/calendar-entries/${northNine}`,
              north.branch,
              { ...nineOff, groupBlocks },
              cookie,
            ),
          () =>
            post(`/api/setup/calendar-entries/${northNine}/restore`, north.branch, {
              groupBlocks,
            }),
          () =>
            post('/api/setup/calendar-entries/preview', north.branch, {
              action: 'create',
              record: dayOff('2026-12-14', '2026-12-14', { gradeFrom: 9, gradeTo: 9 }),
              groupBlocks,
            }),
          () =>
            post('/api/setup/calendar-entries/preview', north.branch, {
              action: 'edit',
              id: northNine,
              record: nineOff,
              groupBlocks,
            }),
          () =>
            post('/api/setup/calendar-entries/preview', north.branch, {
              action: 'restore',
              id: northNine,
              groupBlocks,
            }),
        ]) {
          refusedWith(await attempt(), 404, 'not_found');
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
          refusedWith(await attempt(), 404, 'not_found');
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
        // Task 5.6b-2b (permission review should-fix 2): a body with a choice.
        () =>
          post(
            '/api/setup/calendar-entries/preview',
            s.branch,
            {
              action: 'create',
              record: specialDay(OCT19, OCT19, s.short),
              dayKeeps: [{ classId: s.seniorId, date: OCT19, slotPositions: [3] }],
            },
            cookie,
          ),
        () =>
          create(
            s.branch,
            {
              ...specialDay('2026-11-16', '2026-11-16', s.short),
              dayKeeps: [{ classId: s.seniorId, date: '2026-11-16', slotPositions: [3] }],
            },
            cookie,
          ),
        // Task 5.6b-2c-1 (permission review should-fix 2): a body with a block's choice.
        () =>
          create(
            s.branch,
            {
              ...dayOff('2026-11-16'),
              examBlocks: [{ examId: UNKNOWN, classId: s.seniorId, start: 480, choice: 'keep' }],
            },
            cookie,
          ),
        () =>
          post(
            '/api/setup/calendar-entries/preview',
            s.branch,
            {
              action: 'create',
              record: dayOff('2026-11-16'),
              examBlocks: [{ examId: UNKNOWN, classId: s.seniorId, start: 480, choice: 'cancel' }],
            },
            cookie,
          ),
        // Task 5.6b-3: a body with a split group's choice, on every write
        // and preview that takes it (permission review should-fix 2).
        () =>
          post(
            `/api/setup/calendar-entries/${archived.id}/restore`,
            s.branch,
            { groupBlocks: [{ weekday: 1, start: 590, groupIds: [UNKNOWN], choice: 'keep' }] },
            cookie,
          ),
        ...(['edit', 'restore'] as const).map(
          (action) => () =>
            post(
              '/api/setup/calendar-entries/preview',
              s.branch,
              {
                action,
                id: action === 'edit' ? saved.id : archived.id,
                ...(action === 'edit' ? { record: dayOff(OCT19) } : {}),
                groupBlocks: [{ weekday: 1, start: 590, groupIds: [UNKNOWN], choice: 'keep' }],
              },
              cookie,
            ),
        ),
        () =>
          create(
            s.branch,
            {
              ...dayOff('2026-11-16', '2026-11-16', { gradeFrom: 9, gradeTo: 9 }),
              groupBlocks: [{ weekday: 1, start: 590, groupIds: [UNKNOWN], choice: 'keep' }],
            },
            cookie,
          ),
        () =>
          t.patch(
            `/api/setup/calendar-entries/${saved.id}`,
            s.branch,
            {
              ...dayOff(OCT19),
              groupBlocks: [{ weekday: 1, start: 590, groupIds: [UNKNOWN], choice: 'keep' }],
            },
            cookie,
          ),
        () =>
          post(
            '/api/setup/calendar-entries/preview',
            s.branch,
            {
              action: 'create',
              record: dayOff('2026-11-16', '2026-11-16', { gradeFrom: 9, gradeTo: 9 }),
              groupBlocks: [{ weekday: 1, start: 590, groupIds: [UNKNOWN], choice: 'cancel' }],
            },
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

    // Task 5.6b-2a (decision 4, Look first): with the move first, the day off
    // sent without the sorting's key is refused, then saved with it.
    it('a day off and a move onto its date: the first stands; the second is refused, the day off then saved with the sorting it was not shown', async () => {
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
          refusedWith(dayOffSaved, 409, 'calendar_blocked');
          expect(detailsOf(dayOffSaved).map((one) => one.code)).toEqual([
            'day_changes_changed',
            'day_change_undecided',
          ]);
          expect((await lessonsOn(s.branch, OCT19)).map((one) => one.id)).toContain(moving.id);
          const shown = await preview(s.branch, { action: 'create', record: dayOff(OCT19) });
          const [item] = shown.lessons.dayChanges.decide;
          okay(
            await create(
              s.branch,
              withDays(dayOff(OCT19), shown, [{ key: item?.key ?? '', choice: 'drop' }]),
            ),
            201,
          );
          expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
          expect((await lessonById(moving.id))?.date).toBe(OCT26);
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

    // Task 5.6b-2a (decision 4, Look first): with the bulk cancel first, the
    // day off sent without the sorting's key is refused, then saved with it.
    it('a day off and a bulk cancel of its date: the first stands; the second is refused, the day off then saved with the sorting it was not shown', async () => {
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
          refusedWith(saved, 409, 'calendar_blocked');
          expect(detailsOf(saved).map((one) => one.code)).toEqual(['day_changes_changed']);
          expect(
            (await lessonsOn(s.branch, OCT19)).find((one) => one.id === lesson.id)?.cancel_cause,
          ).toBe('reason');
          const shown = await preview(s.branch, { action: 'create', record: dayOff(OCT19) });
          okay(await create(s.branch, withDays(dayOff(OCT19), shown)), 201);
          expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
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
      // The group of a group scene keeps its own slot 5.
      await placeAt(
        s.branch,
        next,
        row.id,
        1,
        row.subject_id === s.maths ? 1 : row.subject_id === s.history ? 3 : 5,
      );
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
      // Task 5.6b-2b: the shortened days' choices the save now writes.
      'timetable_day_keeps',
      // Task 5.6b-3: the split groups' choices the save now writes.
      'calendar_group_blocks',
      // Task 5.7b-1 (permission review, must-fix 1): the substitutions the
      // save ends with the lessons it rewrites or removes.
      'substitutions',
      'substitution_lessons',
    ] as const) {
      rows[table] = await t.database.migrator
        .selectFrom(table)
        .selectAll()
        .where('branch_id', '=', branch)
        .orderBy('id')
        .execute();
    }
    // Task 5.6b-2a: the ends of stored changes and the bulk cancels' choices
    // the save now writes (`.claude/rules/api.md`: a route that writes more
    // tables widens the rows of its 404 tests).
    rows.lesson_day_change_ends = await t.database.migrator
      .selectFrom('lesson_day_change_ends')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('change_id')
      .execute();
    rows.calendar_group_block_groups = await t.database.migrator
      .selectFrom('calendar_group_block_groups')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('block_id')
      .orderBy('group_id')
      .execute();
    rows.bulk_cancel_blocks = await t.database.migrator
      .selectFrom('bulk_cancel_blocks')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('bulk_cancel_id')
      .orderBy('lesson_date')
      .orderBy('starts_at')
      .execute();
    // The delivery jobs of the notices of the branch (permission review must-fix 1).
    rows.jobs = (
      await sql<{ id: string }>`
        select id::text from pgboss.job
        where data->'branchIds' ? ${branch}
        order by id
      `.execute(t.database.migrator)
    ).rows;
    rows.lesson_changes = await t.database.migrator
      .selectFrom('lesson_changes')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('lesson_id')
      .execute();
    // Task 5.6b-2c-1: the exams, their rows and the classes kept out of
    // blocks, which the save now writes.
    for (const table of [
      'exams',
      'exam_rooms',
      'exam_room_classes',
      'exam_invigilators',
    ] as const) {
      rows[table] = await t.database.migrator
        .selectFrom(table)
        .selectAll()
        .where('branch_id', '=', branch)
        .orderBy('id')
        .execute();
    }
    rows.lesson_block_class_outs = await t.database.migrator
      .selectFrom('lesson_block_class_outs')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('block_id')
      .orderBy('class_id')
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
