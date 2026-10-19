import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  isMarkedChanged,
  publishCheckSchema,
  timetableVersionSchema,
  weekLessonSchema,
  type PublishCheck,
  type TimetableVersion,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dayTemplatesKit,
  MONDAY,
  START,
  TODAY,
  TOMORROW,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LessonsKit, at } from '../../testing/lessons-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { datedLessonsOf } from './dated-check.js';
import { TimetablePattern } from './pattern.service.js';
import { Timetable } from './timetable.service.js';
import { Notifications } from '../notifications/notifications.service.js';
import { sendWeekChanges, snapshotWeek } from './week-changes.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const versionOf = (response: Response): TimetableVersion => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return timetableVersionSchema.parse(response.body);
};

/** A moment before the clock, for a mark of an earlier change. */
const EARLIER = new Date('2026-10-08T10:00:00Z');

const DAY = 86_400_000;

const checkOf = (response: Response): PublishCheck => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return publishCheckSchema.parse(response.body);
};

/** The codes of a `publish_blocked`, each with its path. */
const blockedBy = (response: Response): { code: string; path: string }[] => {
  refusedWith(response, 409, 'publish_blocked');
  const body = response.body as { error: { details: { code: string; path: string }[] } };
  return body.error.details.map((detail) => ({ code: detail.code, path: detail.path }));
};

/** The quarters of the year 2026-09-01 to 2027-05-31, dated. */
const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

// All names are invented. Task 5.5a-1, pull request #139: publish
// (docs/spec/06-timetable.md, Editing in the grid: "Publish: confirm the
// start date set at step 1, or change it ... A draft with errors cannot be
// published"; How surprises are prevented, Start date: "next Monday by default
// and tomorrow at the earliest, with the first day of each coming quarter
// offered as a shortcut"; edge/timetable, Versions and drafts and Generator
// and editing). The clock stands at 23:55 on Saturday 10 October 2026 in
// Tashkent: tomorrow is Sunday the 11th, next Monday the 12th.
describe('publish', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;

  beforeAll(async () => {
    // A takeover of the edit lock notifies the earlier holder, through the job queue.
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  const get = (path: string, branch: string, cookie = t.admin) => t.get(path, branch, cookie);
  const post = (path: string, branch: string, body: object = {}, cookie = t.admin) =>
    t.post(path, branch, body, cookie);

  const check = (branch: string, version: string, startsOn: string, cookie = t.admin) =>
    get(`/api/timetable/versions/${version}/publish-check?startsOn=${startsOn}`, branch, cookie);
  const publish = (
    branch: string,
    version: string,
    startsOn: string,
    cookie = t.admin,
    key: string = randomUUID(),
    extra: { transitionKey?: string; dayChangesKey?: string; dayDecisions?: object[] } = {},
  ) =>
    request(t.kit.server)
      .post(`/api/timetable/versions/${version}/publish`)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, key)
      .send({ startsOn, ...extra });

  /** Until `count` sessions of the test database wait for an advisory lock. */
  async function waitForAdvisory(count: number) {
    for (let tries = 0; tries < 200; tries += 1) {
      const waiting = await sql<{ n: number }>`
        select count(*)::int as n from pg_locks l
        join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and l.locktype = 'advisory' and not l.granted
      `.execute(t.database.migrator);
      if ((waiting.rows[0]?.n ?? 0) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('The requests never waited for the publish lock.');
  }

  /** Hours of a person in the branch from 1 September, Monday to Friday, all day. */
  async function hours(
    branch: string,
    staffId: string,
    [start, end]: readonly [number, number] = [0, 1440],
  ) {
    const entry = await t.database.migrator
      .insertInto('staff_availability')
      .values({ branch_id: branch, staff_id: staffId, valid_from: '2026-09-01' })
      .returning(['id', 'valid_until'])
      .executeTakeFirstOrThrow();
    for (const weekday of [1, 2, 3, 4, 5]) {
      await t.database.migrator
        .insertInto('staff_availability_ranges')
        .values({
          entry_id: entry.id,
          branch_id: branch,
          staff_id: staffId,
          weekday,
          start_minutes: start,
          end_minutes: end,
          valid_from: '2026-09-01',
          valid_until: entry.valid_until,
        })
        .execute();
    }
  }

  async function datedQuarters(year: string) {
    for (const [index, [start, end]] of QUARTERS.entries()) {
      await t.database.migrator
        .updateTable('quarters')
        .set({ start_date: start, end_date: end })
        .where('academic_year_id', '=', year)
        .where('number', '=', index + 1)
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

  const placeAt = async (branch: string, version: string, loadRowId: string, weekday: number) => {
    const placed = await post(`/api/timetable/versions/${version}/pattern`, branch, {
      loadRowId,
      weekday,
      slotPosition: 1,
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  };

  const confirmTemplates = async (branch: string, version: string) => {
    const confirmed = await post(`/api/timetable/versions/${version}/templates/confirm`, branch);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  };

  /**
   * A branch of its own with a year of four dated quarters, a day of lesson,
   * break, lesson, break, lesson (positions 1 to 5) on every weekday, a class
   * of grade 7 with its main classroom, and a draft from Monday with one row
   * of `lessons` a week placed `placed` times (Monday, Tuesday ...) and its
   * templates confirmed: a draft that can be published.
   */
  async function scene(
    input: {
      journalType?: 'graded' | 'attendance_only';
      lessons?: number;
      placed?: number;
      /** The start of the day's template, 08:00 unless named. */
      startTime?: string;
      /** The teacher's hours each weekday, all day unless named. */
      hoursRange?: readonly [number, number];
      /** Another teacher than one of the branch's own. */
      teacherFor?: (branch: string, subject: string) => Promise<string>;
    } = {},
  ) {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
    await datedQuarters(year);
    const lesson = await t.createSlotType(branch, 'Lesson', 'lesson', 45);
    const pause = await t.createSlotType(branch, 'Break', 'break', 10);
    const regular = await t.createTemplate(
      branch,
      'Regular',
      [lesson, pause, lesson, pause, lesson],
      input.startTime,
    );
    await t.assign(branch, regular);
    const subject = await load.classes.subject({
      grades: [7],
      journalType: input.journalType ?? 'attendance_only',
    });
    const room = await load.classes.room(branch);
    const classId = await load.classes.schoolClass(branch, year, { grade: 7, room });
    let teacherId: string;
    if (input.teacherFor === undefined) {
      teacherId = (await load.teacher(branch, { subjects: [{ subject, grades: [7] }] })).staffId;
      await hours(branch, teacherId, input.hoursRange);
    } else {
      teacherId = await input.teacherFor(branch, subject);
    }
    const version = await draft(branch, year);
    const rowId = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: classId,
      subject_id: subject,
      teacher_id: teacherId,
      lessons_per_week: input.lessons ?? 1,
    });
    for (let index = 0; index < (input.placed ?? 1); index += 1) {
      await placeAt(branch, version, rowId, index + 1);
    }
    await confirmTemplates(branch, version);
    return { branch, year, subject, room, classId, teacherId, version, rowId };
  }

  /** A second draft of a scene, not a copy, with the same row placed on Monday and its templates confirmed. */
  const placedDraft = async (s: {
    branch: string;
    year: string;
    classId: string;
    subject: string;
    teacherId: string;
  }) => {
    const version = await draft(s.branch, s.year);
    const rowId = await load.row({
      branch_id: s.branch,
      version_id: version,
      class_id: s.classId,
      subject_id: s.subject,
      teacher_id: s.teacherId,
      lessons_per_week: 1,
    });
    await placeAt(s.branch, version, rowId, 1);
    await confirmTemplates(s.branch, version);
    return version;
  };

  /** A copy of a version with its one row placed on Monday and its templates confirmed. */
  const placedCopy = async (branch: string, year: string, from: string) => {
    const copy = await draft(branch, year, from);
    const row = await t.database.migrator
      .selectFrom('teaching_load_rows')
      .select('id')
      .where('version_id', '=', copy)
      .executeTakeFirstOrThrow();
    await placeAt(branch, copy, row.id, 1);
    await confirmTemplates(branch, copy);
    return copy;
  };

  /** The kit's Academic Vice Principal, given the role in a branch of a scene too. */
  const viceIn = async (branch: string) => {
    const vice = await t.database.migrator
      .selectFrom('assignments')
      .select('account_id')
      .where('id', '=', t.viceAssignment)
      .executeTakeFirstOrThrow();
    return load.classes.role(vice.account_id, branch, 'academic_vice_principal');
  };

  const versionRow = (id: string) =>
    t.database.migrator
      .selectFrom('timetable_versions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  /** The causes of a version's mark out of date (task 5.5a-3b-1, decision 7), oldest first. */
  const causesOf = (id: string) =>
    t.database.migrator
      .selectFrom('timetable_version_out_of_date_causes')
      .select(['action', 'record_id', 'caused_at'])
      .where('version_id', '=', id)
      .orderBy('caused_at')
      .orderBy('id')
      .execute();

  /** Every row a publish writes, in both branches named: what a refused one must leave. */
  /**
   * Every row a publish writes, in every branch of the versions named, each
   * column: what a refused one must leave as it was (`.claude/rules/api.md`).
   */
  const written = async (versions: readonly string[]) => {
    const branches = (
      await t.database.migrator
        .selectFrom('timetable_versions')
        .select('branch_id')
        .distinct()
        .where('id', 'in', versions)
        .execute()
    ).map((one) => one.branch_id);
    return Promise.all([
      t.database.migrator
        .selectFrom('timetable_versions')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('id')
        .execute(),
      t.database.migrator
        .selectFrom('teaching_load_rows')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('id')
        .execute(),
      t.database.migrator
        .selectFrom('pattern_entries')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('id')
        .execute(),
      // Task 5.5a-3b-1: the marks of the other drafts (the mark was a column of the version).
      t.database.migrator
        .selectFrom('timetable_version_out_of_date_causes')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('id')
        .execute(),
      t.database.migrator.selectFrom('notifications').selectAll().orderBy('id').execute(),
      // A takeover of the edit lock enqueues the delivery of its notice (permission review, should-fix 4).
      sql<{ id: string; name: string }>`select id, name from pgboss.job order by id`
        .execute(t.database.migrator)
        .then((result) => result.rows),
      t.database.migrator.selectFrom('request_keys').selectAll().orderBy('key').execute(),
      // Task 5.5b-1: the dated lessons, their blocks and claims.
      t.database.migrator
        .selectFrom('lesson_blocks')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('id')
        .execute(),
      t.database.migrator
        .selectFrom('lessons')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('id')
        .execute(),
      t.database.migrator
        .selectFrom('time_claims')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('id')
        .execute(),
      t.auditCount(),
      // Task 5.5c-1: the journals a publish opens and changes.
      t.database.migrator
        .selectFrom('journals')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('id')
        .execute(),
      // Task 5.5c-3a: the "changed" marks.
      t.database.migrator
        .selectFrom('lesson_changes')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('lesson_id')
        .execute(),
      // Task 5.6a-5a: the one-day changes a publish records again and ends.
      t.database.migrator
        .selectFrom('lesson_day_changes')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('id')
        .execute(),
      t.database.migrator
        .selectFrom('lesson_day_change_ends')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('change_id')
        .execute(),
    ]);
  };

  /** The dated lessons of a branch with their blocks (task 5.5b-1), by date, start and id. */
  const lessonsOf = (branch: string) =>
    t.database.migrator
      .selectFrom('lessons')
      .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
      .select([
        'lessons.id',
        'lessons.block_id',
        sql<string>`lessons.lesson_date::text`.as('date'),
        'lessons.starts_at',
        'lessons.ends_at',
        'lessons.class_id',
        'lessons.group_id',
        'lessons.subject_id',
        'lessons.load_row_id',
        'lessons.pattern_entry_id',
        'lessons.teacher_id',
        'lessons.room_id',
        'lessons.cancel_cause',
        'lesson_blocks.version_id',
        'lesson_blocks.quarter_id',
        'lesson_blocks.double_pair_id',
      ])
      .where('lessons.branch_id', '=', branch)
      .orderBy('lessons.lesson_date')
      .orderBy('lessons.starts_at')
      .orderBy('lessons.id')
      .execute();

  /** The notices of a timetable change in a branch for a version's number (task 5.5c-3a). */
  const noticesOf = (branch: string, kind: string, number: number) =>
    t.database.migrator
      .selectFrom('notifications')
      .select(['account_id', 'branch_id', 'kind', 'data'])
      .where('branch_id', '=', branch)
      .where('kind', '=', kind)
      .where(sql<boolean>`data->>'number' = ${String(number)}`)
      .orderBy('account_id')
      .execute();

  /** The accounts of staff records, in their order. */
  const accountsOf = async (staffIds: readonly string[]) => {
    const rows = await t.database.migrator
      .selectFrom('staff')
      .select(['id', 'account_id'])
      .where('id', 'in', [...staffIds])
      .execute();
    return staffIds.map((id) => rows.find((one) => one.id === id)?.account_id ?? null);
  };

  /** The "changed" marks of a branch with their lessons, by date and start (task 5.5c-3a). */
  const marksOf = (branch: string) =>
    t.database.migrator
      .selectFrom('lesson_changes')
      .innerJoin('lessons', 'lessons.id', 'lesson_changes.lesson_id')
      .select([
        'lessons.id',
        sql<string>`lessons.lesson_date::text`.as('date'),
        'lessons.class_id',
        'lessons.subject_id',
        'lesson_changes.changed_at',
      ])
      .where('lesson_changes.branch_id', '=', branch)
      .orderBy('lessons.lesson_date')
      .orderBy('lessons.starts_at')
      .orderBy('lessons.id')
      .execute();

  /** The school dates of a weekday from `from` to `to`, inside the quarters (`QUARTERS`). */
  const schoolDates = (weekday: number, from: string, to = '2027-05-31') => {
    const dates: string[] = [];
    for (const [start, end] of QUARTERS) {
      for (let day = new Date(`${start}T00:00:00Z`); ; day.setUTCDate(day.getUTCDate() + 1)) {
        const date = day.toISOString().slice(0, 10);
        if (date > end) break;
        if (date >= from && date <= to && (day.getUTCDay() || 7) === weekday) dates.push(date);
      }
    }
    return dates;
  };

  /**
   * What a publish of the scene's draft would change besides itself: another
   * draft to mark, a Tutor row whose Tutor changes on 19 October, and a stale
   * edit lock to take over.
   */
  async function withMoreToChange(s: {
    branch: string;
    year: string;
    classId: string;
    version: string;
  }) {
    await draft(s.branch, s.year);
    const tutorSubject = await load.tutorSubject({ grades: [7] });
    const first = await load.teacher(s.branch);
    const second = await load.teacher(s.branch);
    const changeover = new Date('2026-10-19T00:00:00+05:00');
    await load.tutorOf(s.branch, s.classId, first.accountId, { until: changeover });
    await load.tutorOf(s.branch, s.classId, second.accountId, { from: changeover });
    const created = await post(`/api/timetable/versions/${s.version}/load`, s.branch, {
      classId: s.classId,
      groupId: null,
      subjectId: tutorSubject,
      teacherId: null,
      lessonsPerWeek: 1,
      roomId: null,
      roomType: null,
      doubleLessons: false,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const holder = await t.database.migrator
      .selectFrom('assignments')
      .select('account_id')
      .where('role', '=', 'teacher')
      .where('branch_id', '=', t.north)
      .executeTakeFirstOrThrow();
    await t.database.migrator
      .updateTable('timetable_versions')
      .set({
        edit_holder_id: holder.account_id,
        edit_seen_at: new Date(t.clock.now().getTime() - 10 * 60_000),
      })
      .where('id', '=', s.version)
      .execute();
  }

  describe('a draft that can be published', () => {
    it('offers tomorrow at the earliest, next Monday and the coming quarters, with nothing refused', async () => {
      const s = await scene();
      const answer = checkOf(await check(s.branch, s.version, MONDAY));
      const { impact, ...rest } = answer;
      expect(rest).toEqual({
        startsOn: MONDAY,
        earliest: TOMORROW,
        defaultStart: MONDAY,
        quarterStarts: ['2026-11-09', '2027-01-11', '2027-03-30'],
        refusals: [],
        warnings: [],
        cancelledLessons: [],
        needsTeacher: [],
        shortenedDays: [],
        unusedKeeps: [],
        chain: null,
        canPublish: true,
      });
      // Task 5.5a-2b-1: a first publish from a Monday.
      expect(impact).toMatchObject({ beforeVersion: null, transition: null });
      // The check writes nothing (decision 13).
      expect((await versionRow(s.version)).status).toBe('draft');
    });

    it('publishes in one audited write, read only afterwards, and marks nothing it need not', async () => {
      const s = await scene();
      const assignment = await viceIn(s.branch);
      await load.freeEditLock(s.version);
      const response = await publish(s.branch, s.version, MONDAY, t.vicePrincipal);
      const answer = versionOf(response);
      expect(answer).toMatchObject({ status: 'published', startsOn: MONDAY, outOfDate: false });
      expect(answer.editLock).toBeNull();
      const [entry] = await t.entries('timetable_version.publish', s.version);
      expect(entry).toMatchObject({
        assignment_id: assignment,
        request_id: response.headers['x-request-id'],
        old_value: { status: 'draft', startsOn: MONDAY },
        new_value: {
          status: 'published',
          startsOn: MONDAY,
          inForceBefore: null,
          markedOutOfDate: [],
        },
      });
      // A published version is read only: its load and its grid no longer change.
      refusedWith(await publish(s.branch, s.version, MONDAY), 409, 'version_not_draft');
      const placed = await post(`/api/timetable/versions/${s.version}/pattern`, s.branch, {
        loadRowId: s.rowId,
        weekday: 3,
        slotPosition: 1,
      });
      refusedWith(placed, 409, 'version_not_draft');
      expect(checkOf(await check(s.branch, s.version, '2026-10-19')).canPublish).toBe(false);
    });

    it('lets the Principal read the check', async () => {
      const s = await scene();
      const principal = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', 'principal')
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      await load.classes.role(principal.account_id, s.branch, 'principal');
      const answer = checkOf(await check(s.branch, s.version, MONDAY, t.principal));
      expect(answer.canPublish).toBe(true);
      // Task 5.5a-2b-1 (permission review, should-fix 2): the Principal reads the
      // preview too, with the branch's teacher only.
      expect(answer.impact?.teachers).toEqual([
        { id: s.teacherId, vacancy: false, notified: true },
      ]);
      expect(answer.impact?.names.teachers.map((one) => one.id)).toEqual([s.teacherId]);
      expect((await publish(s.branch, s.version, MONDAY, t.principal)).status).toBe(403);
    });
  });

  describe('the start date', () => {
    it('refuses today and a date outside the year, and changes nothing', async () => {
      const s = await scene();
      const before = await written([s.version]);
      expect(blockedBy(await publish(s.branch, s.version, TODAY))).toEqual([
        { code: 'version_start_too_early', path: 'startsOn' },
      ]);
      expect(blockedBy(await publish(s.branch, s.version, '2027-06-01'))).toEqual([
        { code: 'version_start_outside_year', path: 'startsOn' },
      ]);
      expect(await written([s.version])).toEqual(before);
      expect(checkOf(await check(s.branch, s.version, TODAY)).refusals).toEqual([
        { code: 'version_start_too_early' },
      ]);
    });

    it('saves a changed date with the publish and checks the draft on it', async () => {
      const s = await scene();
      const answer = versionOf(await publish(s.branch, s.version, '2026-10-19'));
      expect([answer.status, answer.startsOn]).toEqual(['published', '2026-10-19']);
      expect((await versionRow(s.version)).starts_on).toBe('2026-10-19');
      const [entry] = await t.entries('timetable_version.publish', s.version);
      expect(entry).toMatchObject({
        old_value: { startsOn: MONDAY },
        new_value: { startsOn: '2026-10-19' },
      });
    });

    it('offers the first day of a planned year as the default start', async () => {
      const branch = await t.newBranch();
      const year = await load.classes.year(branch, 'planned', '2026-11-02', '2027-06-30');
      const version = await post('/api/timetable/versions', branch, {
        academicYearId: year,
        startsOn: '2026-11-02',
      });
      expect(version.status, JSON.stringify(version.body)).toBe(201);
      const answer = checkOf(
        await check(branch, (version.body as { id: string }).id, '2026-11-02'),
      );
      expect([answer.earliest, answer.defaultStart]).toEqual([TOMORROW, '2026-11-02']);
    });
  });

  describe('what refuses a publish', () => {
    // Task 5.5a-3a: until the question is answered (the chain tests below).
    it('refuses a start on or before a published version of the year without an answer', async () => {
      const s = await scene();
      const later = await placedCopy(s.branch, s.year, s.version);
      versionOf(await publish(s.branch, later, '2026-10-26'));
      for (const date of ['2026-10-19', '2026-10-26']) {
        expect(blockedBy(await publish(s.branch, s.version, date))).toContainEqual({
          code: 'version_later_published',
          path: 'chain',
        });
      }
    });

    it('refuses while another account holds the edit lock', async () => {
      const s = await scene();
      await viceIn(s.branch);
      // The admin placed the lessons a moment ago and holds the lock.
      refusedWith(
        await publish(s.branch, s.version, MONDAY, t.vicePrincipal),
        409,
        'draft_edit_locked',
      );
      expect((await versionRow(s.version)).status).toBe('draft');
    });

    it('refuses a step that is not ready', async () => {
      const s = await scene();
      // A template change after the confirmation: step 1 is no longer ready.
      const other = await t.createSlotType(s.branch, 'Long lesson', 'lesson', 50);
      const changed = await t.createTemplate(s.branch, 'Changed', [other, other, other]);
      await t.assign(s.branch, changed, {}, MONDAY);
      expect(blockedBy(await publish(s.branch, s.version, MONDAY))).toContainEqual({
        code: 'draft_not_ready',
        path: 'steps.templates',
      });
    });

    it('refuses a problem of a load row', async () => {
      const s = await scene();
      await load.status(s.teacherId, 'left', MONDAY);
      expect(blockedBy(await publish(s.branch, s.version, MONDAY))).toContainEqual({
        code: 'load_problem',
        path: `loadRows.${s.rowId}`,
      });
      const answer = checkOf(await check(s.branch, s.version, MONDAY));
      expect(answer.refusals).toContainEqual({
        code: 'load_problem',
        loadRowId: s.rowId,
        problem: 'load_teacher_status',
      });
    });

    it('refuses a blocked result of the pattern', async () => {
      const s = await scene();
      // The main classroom of the class is closed after the lesson was placed in it.
      await t.database.migrator
        .updateTable('rooms')
        .set({ status: 'closed' })
        .where('id', '=', s.room)
        .execute();
      const refusals = checkOf(await check(s.branch, s.version, MONDAY)).refusals;
      expect(
        refusals.map((one) => [one.code, one.result?.rule, one.result?.severity]),
      ).toContainEqual(['pattern_blocked', 'room_inactive', 'blocked']);
      expect(blockedBy(await publish(s.branch, s.version, MONDAY))).toContainEqual({
        code: 'pattern_blocked',
        path: 'pattern.room_inactive',
      });
    });
  });

  describe('the load and "deliberately short"', () => {
    const editRow = (branch: string, version: string, rowId: string, body: object) =>
      t.patch(`/api/timetable/versions/${version}/load/${rowId}`, branch, {
        teacherId: null,
        lessonsPerWeek: 2,
        roomId: null,
        roomType: null,
        doubleLessons: false,
        ...body,
      });

    it('refuses fewer lessons than the load unless the row is marked short with a reason', async () => {
      const s = await scene({ lessons: 2, placed: 1 });
      expect(blockedBy(await publish(s.branch, s.version, MONDAY))).toEqual([
        { code: 'load_mismatch', path: `loadRows.${s.rowId}` },
      ]);
      const edited = await editRow(s.branch, s.version, s.rowId, {
        shortReason: '  The laboratory opens in November  ',
      });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect((edited.body as { shortReason: string }).shortReason).toBe(
        'The laboratory opens in November',
      );
      const [entry] = await t.entries('teaching_load.edit', s.rowId);
      expect(entry).toMatchObject({
        old_value: { shortReason: null },
        new_value: { shortReason: 'The laboratory opens in November' },
      });
      versionOf(await publish(s.branch, s.version, MONDAY));
    });

    it('refuses more lessons than the load, also on a row marked short', async () => {
      const s = await scene({ lessons: 1, placed: 2 });
      const edited = await editRow(s.branch, s.version, s.rowId, {
        lessonsPerWeek: 1,
        shortReason: 'Marked all the same',
      });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(blockedBy(await publish(s.branch, s.version, MONDAY))).toEqual([
        { code: 'load_mismatch', path: `loadRows.${s.rowId}` },
      ]);
    });

    it('keeps the reason when an edit leaves it out, and a copy carries it', async () => {
      const s = await scene({ lessons: 2, placed: 1 });
      await editRow(s.branch, s.version, s.rowId, { shortReason: 'Half a year only' });
      const kept = await editRow(s.branch, s.version, s.rowId, { roomType: 'classroom' });
      expect((kept.body as { shortReason: string | null }).shortReason).toBe('Half a year only');
      const copy = await draft(s.branch, s.year, s.version);
      const row = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('short_reason')
        .where('version_id', '=', copy)
        .executeTakeFirstOrThrow();
      expect(row.short_reason).toBe('Half a year only');
    });
  });

  describe('the year and the subjects', () => {
    it('refuses a year without four dated quarters', async () => {
      const s = await scene();
      await t.database.migrator
        .updateTable('quarters')
        .set({ start_date: null, end_date: null })
        .where('academic_year_id', '=', s.year)
        .where('number', '=', 4)
        .execute();
      expect(blockedBy(await publish(s.branch, s.version, MONDAY))).toEqual([
        { code: 'year_quarters', path: '' },
      ]);
    });

    const quarterIds = async (year: string) =>
      (
        await t.database.migrator
          .selectFrom('quarters')
          .select(['id', 'number'])
          .where('academic_year_id', '=', year)
          .orderBy('number')
          .execute()
      ).map((one) => one.id);

    const weigh = async (branch: string, subject: string, quarters: readonly string[]) => {
      await t.database.migrator
        .insertInto('subject_daily_weights')
        .values({
          branch_id: branch,
          subject_id: subject,
          attendance: 20,
          classwork: 40,
          homework: 40,
        })
        .execute();
      for (const quarter of quarters) {
        await t.database.migrator
          .insertInto('subject_quarter_weights')
          .values({
            branch_id: branch,
            subject_id: subject,
            quarter_id: quarter,
            attendance: 20,
            classwork: 40,
            homework: 40,
          })
          .execute();
      }
    };

    it('refuses a graded subject without its daily distribution and the quarters the version touches', async () => {
      const s = await scene({ journalType: 'graded' });
      expect(blockedBy(await publish(s.branch, s.version, MONDAY))).toEqual([
        { code: 'subject_daily_weights', path: `subjects.${s.subject}` },
        ...[1, 2, 3, 4].map((quarter) => ({
          code: 'subject_quarter_weights',
          path: `subjects.${s.subject}.quarters.${String(quarter)}`,
        })),
      ]);
      const [, ...later] = await quarterIds(s.year);
      await weigh(s.branch, s.subject, later);
      // Quarter 1 ends before a start in quarter 2: it is not touched.
      const quarterTwo = '2026-11-09';
      const second = await placedCopy(s.branch, s.year, s.version);
      expect(checkOf(await check(s.branch, second, quarterTwo)).refusals).toEqual([]);
      expect(blockedBy(await publish(s.branch, s.version, MONDAY))).toEqual([
        { code: 'subject_quarter_weights', path: `subjects.${s.subject}.quarters.1` },
      ]);
    });

    it('counts only the distributions of the current round', async () => {
      const s = await scene({ journalType: 'graded' });
      await weigh(s.branch, s.subject, await quarterIds(s.year));
      expect(checkOf(await check(s.branch, s.version, MONDAY)).refusals).toEqual([]);
      await t.database.migrator
        .updateTable('subjects')
        .set({ weights_round: 2 })
        .where('id', '=', s.subject)
        .execute();
      expect(blockedBy(await publish(s.branch, s.version, MONDAY))).toEqual([
        { code: 'subject_daily_weights', path: `subjects.${s.subject}` },
        ...[1, 2, 3, 4].map((quarter) => ({
          code: 'subject_quarter_weights',
          path: `subjects.${s.subject}.quarters.${String(quarter)}`,
        })),
      ]);
    });

    it('publishes a changed date with the Tutor rows following the Tutor of that date (decision 7)', async () => {
      const s = await scene();
      const tutorSubject = await load.tutorSubject({ grades: [7] });
      await weigh(s.branch, tutorSubject, await quarterIds(s.year));
      const first = await load.teacher(s.branch);
      const second = await load.teacher(s.branch);
      await hours(s.branch, first.staffId);
      await hours(s.branch, second.staffId);
      const changeover = new Date('2026-10-19T00:00:00+05:00');
      await load.tutorOf(s.branch, s.classId, first.accountId, { until: changeover });
      await load.tutorOf(s.branch, s.classId, second.accountId, { from: changeover });
      const created = await post(`/api/timetable/versions/${s.version}/load`, s.branch, {
        classId: s.classId,
        groupId: null,
        subjectId: tutorSubject,
        teacherId: null,
        lessonsPerWeek: 1,
        roomId: null,
        roomType: null,
        doubleLessons: false,
      });
      const tutorRow = created.body as { id: string; teacher: { id: string } };
      expect(tutorRow.teacher.id).toBe(first.staffId);
      await placeAt(s.branch, s.version, tutorRow.id, 2);
      versionOf(await publish(s.branch, s.version, '2026-10-19'));
      const stored = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('teacher_id')
        .where('id', '=', tutorRow.id)
        .executeTakeFirstOrThrow();
      expect(stored.teacher_id).toBe(second.staffId);
      const [entry] = await t.entries('timetable_version.publish', s.version);
      expect((entry?.['new_value'] as Record<string, unknown>)['tutorLessons']).toBeDefined();
    });

    it('asks nothing of an attendance-only subject', async () => {
      const s = await scene({ journalType: 'attendance_only' });
      expect(checkOf(await check(s.branch, s.version, MONDAY)).refusals).toEqual([]);
    });
  });

  describe('out of date (decision 4)', () => {
    it('marks every other draft of the branch and year but those copied from the one published', async () => {
      const s = await scene();
      const sibling = await draft(s.branch, s.year);
      const child = await draft(s.branch, s.year, s.version);
      const grandchild = await draft(s.branch, s.year, child);
      const nextYear = await load.classes.year(s.branch, 'planned', '2027-09-01', '2028-05-31');
      const otherYear = await load.version(s.branch, nextYear, { startsOn: '2027-09-06' });
      await load.freeEditLock(s.version);
      versionOf(await publish(s.branch, s.version, MONDAY));
      const marked = await Promise.all([sibling, child, grandchild, otherYear].map(causesOf));
      expect(marked.map((one) => one.length)).toEqual([1, 0, 0, 0]);
      expect(marked[0]).toEqual([
        { action: 'timetable_version.publish', record_id: s.version, caused_at: t.clock.now() },
      ]);
      const [entry] = await t.entries('timetable_version.out_of_date', sibling);
      expect(entry).toMatchObject({ new_value: { outOfDate: true, publishedId: s.version } });
      const [published] = await t.entries('timetable_version.publish', s.version);
      expect(published).toMatchObject({ new_value: { markedOutOfDate: [sibling] } });
      // The list shows it; a copy of it carries the mark (decision 14).
      const list = (await get('/api/timetable/versions', s.branch)).body as {
        versions: TimetableVersion[];
      };
      expect(list.versions.find((one) => one.id === sibling)?.outOfDate).toBe(true);
      const copy = await draft(s.branch, s.year, sibling);
      expect(await causesOf(copy)).toEqual(marked[0]);
    });

    it('refuses a draft marked out of date', async () => {
      const s = await scene();
      const sibling = await placedCopy(s.branch, s.year, s.version);
      await load.freeEditLock(sibling);
      versionOf(await publish(s.branch, sibling, '2026-10-19'));
      // The first draft was not copied from the one published.
      expect(blockedBy(await publish(s.branch, s.version, '2026-10-26'))).toContainEqual({
        code: 'draft_out_of_date',
        path: '',
      });
    });
  });

  describe('a publish refused changes nothing (spec review of the plan, must-fix 2)', () => {
    it('leaves the date, the Tutor rows, the edit lock, the marks, the audit log, the notices and the key', async () => {
      const s = await scene();
      // A Tutor row whose class has one Tutor until the 19th and another from then.
      const tutorSubject = await load.tutorSubject({ grades: [7] });
      const first = await load.teacher(s.branch);
      const second = await load.teacher(s.branch);
      const changeover = new Date('2026-10-19T00:00:00+05:00');
      await load.tutorOf(s.branch, s.classId, first.accountId, { until: changeover });
      await load.tutorOf(s.branch, s.classId, second.accountId, { from: changeover });
      const created = await post(`/api/timetable/versions/${s.version}/load`, s.branch, {
        classId: s.classId,
        groupId: null,
        subjectId: tutorSubject,
        teacherId: null,
        lessonsPerWeek: 1,
        roomId: null,
        roomType: null,
        doubleLessons: false,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const sibling = await draft(s.branch, s.year);
      // The edit lock is the Teacher's, last active ten minutes ago: a publish takes it over.
      const holder = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', 'teacher')
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .updateTable('timetable_versions')
        .set({
          edit_holder_id: holder.account_id,
          edit_seen_at: new Date(t.clock.now().getTime() - 10 * 60_000),
        })
        .where('id', '=', s.version)
        .execute();
      // Refused (the Tutor row is not placed, its subject has no weights, its
      // Tutor no hours), after the changed date was saved and the Tutor row
      // followed the second Tutor.
      const before = await written([s.version, sibling]);
      const tutorRow = (await written([s.version]))[1].find(
        (one) => one.subject_id === tutorSubject,
      );
      expect(tutorRow?.teacher_id).toBe(first.staffId);
      const refusals = blockedBy(await publish(s.branch, s.version, '2026-10-19'));
      expect(refusals.map((one) => one.code)).toContain('load_mismatch');
      expect(await written([s.version, sibling])).toEqual(before);
      // The check on that date reads the second Tutor and writes nothing either.
      checkOf(await check(s.branch, s.version, '2026-10-19'));
      expect(await written([s.version, sibling])).toEqual(before);
    });
  });

  // Task 5.5a-3a, pull request #145: edge/timetable, Versions and drafts, "A
  // version is published to start on 1 December, then a fix must start on 12
  // November. Published versions form a chain ordered by start date.
  // Publishing before an already published later version asks: 'run until
  // that version starts', 'replace the versions that follow', or — offered
  // only when the new version differs from the version it started from in
  // nothing but the teachers or rooms of entries — 'carry the change into
  // them' ... a later version where a change meets a blocked conflict is
  // listed and left as it is."
  describe('the chain', () => {
    const checkChain = (branch: string, version: string, startsOn: string, chain?: string) =>
      check(branch, `${version}`, `${startsOn}${chain === undefined ? '' : `&chain=${chain}`}`);
    const publishChain = (
      branch: string,
      version: string,
      startsOn: string,
      chain: string,
      laterKey: string | undefined,
      key: string = randomUUID(),
      extra: { dayChangesKey?: string; dayDecisions?: object[] } = {},
    ) =>
      request(t.kit.server)
        .post(`/api/timetable/versions/${version}/publish`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, branch)
        .set(REQUEST_KEY_HEADER, key)
        .send({ startsOn, chain, ...(laterKey === undefined ? {} : { laterKey }), ...extra });

    const rowsOf = (version: string) =>
      t.database.migrator
        .selectFrom('teaching_load_rows')
        .select(['id', 'class_id', 'teacher_id', 'room_id'])
        .where('version_id', '=', version)
        .orderBy('id')
        .execute();
    const entriesOf = (version: string) =>
      t.database.migrator
        .selectFrom('pattern_entries')
        .select(['id', 'teacher_id', 'room_id'])
        .where('version_id', '=', version)
        .orderBy('id')
        .execute();

    /**
     * Version A published from Monday 12 October, B (a copy of A) from the
     * second quarter, 9 November, C (a copy of B) from the third, 11 January;
     * then a fix, a copy of A, with the row's teacher changed to a second
     * teacher and the lesson's room to a second room, to start on Monday 19
     * October, mid-quarter: a fix before two later versions.
     */
    async function chainScene(
      more: (
        s: Awaited<ReturnType<typeof scene>> & { c: string; second: string },
      ) => Promise<void> = () => Promise.resolve(),
    ) {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, MONDAY));
      const b = await placedCopy(s.branch, s.year, s.version);
      versionOf(await publish(s.branch, b, '2026-11-09'));
      const c = await placedCopy(s.branch, s.year, b);
      versionOf(await publish(s.branch, c, '2027-01-11'));
      const second = (
        await load.teacher(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] })
      ).staffId;
      await hours(s.branch, second);
      // Published versions after C come before the fix is drafted, so the fix is not out of date.
      await more({ ...s, c, second });
      const room2 = await load.classes.room(s.branch);
      const fix = await placedCopy(s.branch, s.year, s.version);
      const [fixRow] = await rowsOf(fix);
      if (fixRow === undefined) throw new Error('The copy has its row.');
      const edited = await t.patch(
        `/api/timetable/versions/${fix}/load/${fixRow.id}`,
        s.branch,
        {
          teacherId: second,
          lessonsPerWeek: 1,
          roomId: null,
          roomType: null,
          doubleLessons: false,
        },
        t.admin,
      );
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      const block = await t.database.migrator
        .selectFrom('pattern_blocks')
        .select('id')
        .where('version_id', '=', fix)
        .executeTakeFirstOrThrow();
      const [fixEntry] = await entriesOf(fix);
      if (fixEntry === undefined) throw new Error('The copy has its lesson.');
      const roomed = await post(
        `/api/timetable/versions/${fix}/pattern/${block.id}/room`,
        s.branch,
        { lessonId: fixEntry.id, roomId: room2 },
      );
      expect(roomed.status, JSON.stringify(roomed.body)).toBe(200);
      return { ...s, a: s.version, b, c, fix, second, room2 };
    }

    /**
     * Task 5.5b-1: the lessons from 19 October as the fix gives them, the
     * others as they were; every lesson keeps its id (one per Monday).
     */
    const expectLessons = async (
      s: { branch: string; classId: string; fix: string; second: string; room2: string },
      all: Awaited<ReturnType<typeof lessonsOf>>,
      fixed: (date: string) => boolean,
      teacherFrom?: (date: string) => boolean,
    ) => {
      // The scene's class only: another class of a later version shares its dates.
      const before = all.filter((one) => one.class_id === s.classId);
      const after = (await lessonsOf(s.branch)).filter((one) => one.class_id === s.classId);
      expect(after.map((one) => one.id)).toEqual(before.map((one) => one.id));
      expect(after.map((one) => one.date)).toEqual(schoolDates(1, MONDAY));
      for (const [index, one] of after.entries()) {
        const was = before[index];
        if (fixed(one.date)) {
          expect(one).toMatchObject({
            version_id: s.fix,
            teacher_id: s.second,
            room_id: s.room2,
            block_id: was?.block_id,
          });
        } else if (teacherFrom?.(one.date) === true) {
          expect(one).toEqual({ ...was, teacher_id: s.second, room_id: s.room2 });
        } else {
          expect(one).toEqual(was);
        }
      }
    };

    /** The key of the later versions a check shows with an answer. */
    const laterKey = async (branch: string, version: string, startsOn: string, chain: string) => {
      const answer = checkOf(await checkChain(branch, version, startsOn, chain));
      if (answer.chain === null) throw new Error('A later version is shown.');
      return answer.chain;
    };

    /** The last date of the fix's lessons in its preview. */
    const lastDateOf = (answer: PublishCheck) =>
      (answer.impact?.changes ?? [])
        .map((one) => one.lastDate)
        .sort()
        .at(-1);

    // The task's "Done when": a fix published mid-quarter before two later
    // versions, with each of the three answers.
    it('runs until the next version starts, leaving both later versions as they are', async () => {
      const s = await chainScene();
      const before = [
        await rowsOf(s.b),
        await entriesOf(s.b),
        await rowsOf(s.c),
        await entriesOf(s.c),
      ];
      const lessonsBefore = await lessonsOf(s.branch);
      // A ran until B, B until C, C to the year's end: each Monday once.
      expect(lessonsBefore.map((one) => one.date)).toEqual(schoolDates(1, MONDAY));
      expect([...new Set(lessonsBefore.map((one) => one.version_id))]).toEqual([s.a, s.b, s.c]);
      const chain = await laterKey(s.branch, s.fix, '2026-10-19', 'run_until');
      expect(chain.later.map((one) => one.id)).toEqual([s.b, s.c]);
      const answer = checkOf(await checkChain(s.branch, s.fix, '2026-10-19', 'run_until'));
      expect(answer.refusals).toEqual([]);
      // The From line of 5.5a-2a: the dates end the day before B starts (the
      // last Monday before the autumn break, which ends on 8 November).
      expect(lastDateOf(answer)).toBe('2026-10-26');
      versionOf(await publishChain(s.branch, s.fix, '2026-10-19', 'run_until', chain.key));
      for (const id of [s.a, s.b, s.c, s.fix]) {
        expect((await versionRow(id)).status).toBe('published');
      }
      expect([
        await rowsOf(s.b),
        await entriesOf(s.b),
        await rowsOf(s.c),
        await entriesOf(s.c),
      ]).toEqual(before);
      // Task 5.5b-1: the fix's two Mondays only; B's and C's lessons as they were.
      await expectLessons(s, lessonsBefore, (date) => date >= '2026-10-19' && date < '2026-11-09');
      const [entry] = await t.entries('timetable_version.publish', s.fix);
      expect(entry?.new_value).toMatchObject({
        chain: 'run_until',
        replaced: [],
        carried: [],
        carryLeft: [],
      });
    });

    it('replaces the versions that follow, running to the end of the year', async () => {
      const s = await chainScene();
      const chain = await laterKey(s.branch, s.fix, '2026-10-19', 'replace');
      const answer = checkOf(await checkChain(s.branch, s.fix, '2026-10-19', 'replace'));
      expect(answer.refusals).toEqual([]);
      expect(lastDateOf(answer)).toBe('2027-05-31');
      const lessonsBefore = await lessonsOf(s.branch);
      versionOf(await publishChain(s.branch, s.fix, '2026-10-19', 'replace', chain.key));
      // Task 5.5b-1: the archived versions' dates are the fix's, each lesson kept.
      await expectLessons(s, lessonsBefore, (date) => date >= '2026-10-19');
      expect((await versionRow(s.b)).status).toBe('archived');
      expect((await versionRow(s.c)).status).toBe('archived');
      expect((await versionRow(s.a)).status).toBe('published');
      for (const id of [s.b, s.c]) {
        const [entry] = await t.entries('timetable_version.replace', id);
        expect(entry?.new_value).toMatchObject({ status: 'archived', replacedById: s.fix });
      }
    });

    it('carries the teacher and the room into both later versions, in the same preview', async () => {
      const s = await chainScene();
      const answer = checkOf(await checkChain(s.branch, s.fix, '2026-10-19', 'carry'));
      expect(answer.refusals).toEqual([]);
      expect(answer.chain?.carryOffered).toBe(true);
      expect(answer.chain?.changes.map((one) => one.kind).sort()).toEqual([
        'entry_room',
        'teacher',
      ]);
      expect(
        answer.chain?.carried.map((one) => ({
          id: one.versionId,
          applied: one.applied,
          left: one.left,
        })),
      ).toEqual([
        { id: s.b, applied: 2, left: false },
        { id: s.c, applied: 2, left: false },
      ]);
      // Spec review must-fix 1: the carried versions' lessons, teachers and rooms are in the preview.
      expect(answer.impact?.carried.map((one) => one.versionId)).toEqual([s.b, s.c]);
      expect(answer.impact?.carried.every((one) => one.counts.changed > 0)).toBe(true);
      expect(answer.impact?.teachers.map((one) => one.id)).toEqual(
        expect.arrayContaining([s.teacherId, s.second]),
      );
      expect(answer.impact?.roomIds).toEqual(expect.arrayContaining([s.room2]));
      const key = answer.chain?.key;
      const lessonsBefore = await lessonsOf(s.branch);
      versionOf(await publishChain(s.branch, s.fix, '2026-10-19', 'carry', key));
      // Task 5.5b-1: B's and C's lessons keep their version and take the carried teacher and room.
      await expectLessons(
        s,
        lessonsBefore,
        (date) => date >= '2026-10-19' && date < '2026-11-09',
        (date) => date >= '2026-11-09',
      );
      const [carriedB] = await t.entries('timetable_version.carry', s.b);
      expect(carriedB?.new_value).toMatchObject({
        datedLessons: { firstDate: '2026-11-09', lastDate: '2027-01-10', created: 0, removed: [] },
      });
      for (const id of [s.b, s.c]) {
        expect((await rowsOf(id)).map((one) => one.teacher_id)).toEqual([s.second]);
        expect(await entriesOf(id)).toEqual([
          expect.objectContaining({ teacher_id: s.second, room_id: s.room2 }),
        ]);
        expect((await versionRow(id)).status).toBe('published');
        const [entry] = await t.entries('timetable_version.carry', id);
        expect(entry?.new_value).toMatchObject({ fromVersionId: s.fix });
      }
    });

    it('compares a carried version with its stored lessons, and gives its lessons after a leaving no teacher (task 5.5b-2)', async () => {
      const s = await chainScene();
      // C's lesson of 18 January has another room, as a one-day change will
      // give it; the second teacher leaves on 1 March, inside C's run.
      const room3 = await load.classes.room(s.branch);
      await t.app
        .get(Transactions)
        .run([s.branch], (transaction) =>
          transaction
            .updateTable('lessons')
            .set({ room_id: room3 })
            .where('branch_id', '=', s.branch)
            .where('lesson_date', '=', '2027-01-18')
            .execute(),
        );
      expect((await lessonsOf(s.branch)).find((one) => one.date === '2027-01-18')?.room_id).toBe(
        room3,
      );
      await load.status(s.second, 'left', '2027-03-01');
      const answer = checkOf(await checkChain(s.branch, s.fix, '2026-10-19', 'carry'));
      expect(answer.refusals).toEqual([]);
      const carriedC = answer.impact?.carried.find((one) => one.versionId === s.c);
      const lines = (carriedC?.changes ?? []).map((one) => ({
        kind: one.kind,
        beforeRoom: one.before?.roomId,
        afterTeachers: one.after?.teacherIds,
        firstDate: one.firstDate,
        lastDate: one.lastDate,
      }));
      // The stored room is the before side of its date; from the leaving, no teacher.
      expect(lines).toEqual(
        expect.arrayContaining([
          {
            kind: 'changed',
            beforeRoom: room3,
            afterTeachers: [s.second],
            firstDate: '2027-01-18',
            lastDate: '2027-01-18',
          },
          {
            kind: 'changed',
            beforeRoom: s.room,
            afterTeachers: [],
            firstDate: '2027-03-01',
            lastDate: '2027-05-31',
          },
        ]),
      );
      versionOf(await publishChain(s.branch, s.fix, '2026-10-19', 'carry', answer.chain?.key));
      // What the preview showed is what was written.
      const after = (await lessonsOf(s.branch)).filter((one) => one.date >= '2027-01-11');
      expect(after.find((one) => one.date === '2027-01-18')?.room_id).toBe(s.room2);
      expect(after.filter((one) => one.teacher_id === null).map((one) => one.date)[0]).toBe(
        '2027-03-01',
      );
    });

    it('reads a carried version with no stored lessons from its pattern (task 5.5b-2, decision 2)', async () => {
      const s = await chainScene();
      // C as a version published before 0079: its dates are after today.
      await t.app.get(Transactions).run([s.branch], async (transaction) => {
        const blocks = await transaction
          .selectFrom('lesson_blocks')
          .select('id')
          .where('version_id', '=', s.c)
          .execute();
        const ids = blocks.map((one) => one.id);
        await transaction.deleteFrom('lessons').where('block_id', 'in', ids).execute();
        await transaction.deleteFrom('lesson_blocks').where('id', 'in', ids).execute();
      });
      expect((await lessonsOf(s.branch)).filter((one) => one.date >= '2027-01-11')).toEqual([]);
      const answer = checkOf(await checkChain(s.branch, s.fix, '2026-10-19', 'carry'));
      expect(answer.refusals).toEqual([]);
      const carriedC = answer.impact?.carried.find((one) => one.versionId === s.c);
      expect(carriedC?.counts).toMatchObject({ created: 0, moved: 0, removed: 0 });
      expect(carriedC?.counts.changed).toBeGreaterThan(15);
    });

    // Task 5.5c-3a: a carry is part of its publish's event (decision 6):
    // one notice per person, as the preview names them (5.5a-3a decision 10).
    it('notifies each teacher of the fix and of the versions it carries into once, as the preview names them', async () => {
      const s = await chainScene();
      // One-day cancels (`reason`) in the fix's run and in B's (code review should-fix 6).
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: 'Excursion to the museum' })
        .where('branch_id', '=', s.branch)
        .where('lesson_date', 'in', ['2026-10-26', '2026-11-09'])
        .execute();
      const answer = checkOf(await checkChain(s.branch, s.fix, '2026-10-19', 'carry'));
      const shown = (answer.impact?.teachers ?? [])
        .filter((one) => one.notified)
        .map((one) => one.id);
      expect(shown.sort()).toEqual([s.teacherId, s.second].sort());
      const version = versionOf(
        await publishChain(
          s.branch,
          s.fix,
          '2026-10-19',
          'carry',
          answer.chain?.key,
          randomUUID(),
          {
            dayChangesKey: answer.impact?.dayChanges.key ?? '',
          },
        ),
      );
      const notices = await noticesOf(s.branch, 'timetable.published', version.number);
      expect(notices.map((one) => one.account_id).sort()).toEqual((await accountsOf(shown)).sort());
      for (const notice of notices) {
        expect(notice.data).toMatchObject({ weekStart: '2026-10-19' });
      }
      // Every lesson of the class from the fix's start, in the fix's run and in B's and C's, is marked.
      const marked = (await marksOf(s.branch)).filter((one) => one.class_id === s.classId);
      expect(marked.map((one) => one.date)).toEqual(schoolDates(1, '2026-10-19'));
    });

    it('leaves a later version where the change meets a blocked conflict, carrying the others', async () => {
      // D, a copy of C from the fourth quarter, where the second teacher
      // already teaches another class on Monday in the first lesson.
      let d = '';
      const s = await chainScene(async (scene) => {
        d = await placedCopy(scene.branch, scene.year, scene.c);
        const room3 = await load.classes.room(scene.branch);
        const otherClass = await load.classes.schoolClass(scene.branch, scene.year, {
          grade: 7,
          room: room3,
        });
        const otherRow = await load.row({
          branch_id: scene.branch,
          version_id: d,
          class_id: otherClass,
          subject_id: scene.subject,
          teacher_id: scene.second,
          lessons_per_week: 1,
        });
        await placeAt(scene.branch, d, otherRow, 1);
        versionOf(await publish(scene.branch, d, '2027-03-30'));
      });
      const before = [await rowsOf(d), await entriesOf(d)];
      const answer = checkOf(await checkChain(s.branch, s.fix, '2026-10-19', 'carry'));
      expect(answer.refusals).toEqual([]);
      const left = answer.chain?.carried.find((one) => one.versionId === d);
      expect(left).toMatchObject({ applied: 2, left: true });
      expect(left?.refusals.map((one) => one.code)).toContain('pattern_blocked');
      expect(answer.impact?.carried.map((one) => one.versionId)).toEqual([s.b, s.c]);
      const lessonsBefore = await lessonsOf(s.branch);
      versionOf(await publishChain(s.branch, s.fix, '2026-10-19', 'carry', answer.chain?.key));
      expect([await rowsOf(d), await entriesOf(d)]).toEqual(before);
      // Task 5.5b-1 (spec review should-fix 10): D's lessons as they were, B's and C's carried.
      await expectLessons(
        s,
        lessonsBefore,
        (date) => date >= '2026-10-19' && date < '2026-11-09',
        (date) => date >= '2026-11-09' && date < '2027-03-30',
      );
      expect((await lessonsOf(s.branch)).filter((one) => one.date >= '2027-03-30')).toEqual(
        lessonsBefore.filter((one) => one.date >= '2027-03-30'),
      );
      expect(await t.entries('timetable_version.carry', d)).toHaveLength(0);
      // Task 5.5c-3a (code review must-fix 3): a version left notifies nobody
      // for its lessons: one notice per person, the people the preview names
      // from the fix and B and C only.
      const shown = (answer.impact?.teachers ?? [])
        .filter((one) => one.notified)
        .map((one) => one.id);
      const leftNotices = await noticesOf(
        s.branch,
        'timetable.published',
        (await versionRow(s.fix)).number,
      );
      expect(leftNotices.map((one) => one.account_id).sort()).toEqual(
        (await accountsOf(shown)).sort(),
      );
      for (const notice of leftNotices) {
        const data = notice.data as { before: { date: string }[]; after: { date: string }[] };
        expect([...data.before, ...data.after].every((one) => one.date < '2027-03-30')).toBe(true);
      }
      // Task 5.5c-3a (spec review should-fix 6): a version left marks nothing
      // (the other class's lessons were marked by D's own publish, before the fix).
      expect(
        (await marksOf(s.branch)).filter(
          (one) => one.date >= '2027-03-30' && one.class_id === s.classId,
        ),
      ).toEqual([]);
      for (const id of [s.b, s.c]) {
        expect((await rowsOf(id)).map((one) => one.teacher_id)).toEqual([s.second]);
      }
      const [entry] = await t.entries('timetable_version.publish', s.fix);
      expect(entry?.new_value).toMatchObject({
        chain: 'carry',
        carried: [{ id: s.b }, { id: s.c }],
        carryLeft: [{ id: d }],
      });
    });

    // Task 5.6a-5a (review should-fix 6, correction 1): a carried version's
    // one-day changes are sorted and written with its carry; a version left
    // as it is keeps its own, and they are neither listed nor ended.
    it('keeps the one-day room change of a carried version, and leaves those of a version left alone', async () => {
      let d = '';
      const s = await chainScene(async (scene) => {
        d = await placedCopy(scene.branch, scene.year, scene.c);
        const room3 = await load.classes.room(scene.branch);
        const otherClass = await load.classes.schoolClass(scene.branch, scene.year, {
          grade: 7,
          room: room3,
        });
        const otherRow = await load.row({
          branch_id: scene.branch,
          version_id: d,
          class_id: otherClass,
          subject_id: scene.subject,
          teacher_id: scene.second,
          lessons_per_week: 1,
        });
        await placeAt(scene.branch, d, otherRow, 1);
        versionOf(await publish(scene.branch, d, '2027-03-30'));
      });
      const spare = await load.classes.room(s.branch);
      const lessonOn = async (date: string) =>
        (await lessonsOf(s.branch)).find((one) => one.date === date && one.class_id === s.classId);
      const changeRoom = (id: string) =>
        request(t.kit.server)
          .post(`/api/timetable/lessons/${id}/room`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, s.branch)
          .set(REQUEST_KEY_HEADER, randomUUID())
          .send({ roomId: spare, reason: 'The room is painted' });
      const inB = await lessonOn('2026-11-16');
      const inD = await lessonOn('2027-04-05');
      for (const one of [inB, inD]) {
        const roomed = await changeRoom(one?.id ?? '');
        expect(roomed.status, JSON.stringify(roomed.body)).toBe(200);
      }
      const changes = await t.database.migrator
        .selectFrom('lesson_day_changes')
        .select(['id', 'lesson_id'])
        .where('branch_id', '=', s.branch)
        .execute();
      const keyOf = (lesson: string | undefined) =>
        changes.find((one) => one.lesson_id === lesson)?.id;
      const answer = checkOf(await checkChain(s.branch, s.fix, '2026-10-19', 'carry'));
      const days = answer.impact?.dayChanges;
      expect(days?.kept.map((one) => [one.key, one.carriedVersionId])).toEqual([
        [keyOf(inB?.id), s.b],
      ]);
      expect([...(days?.decide ?? []), ...(days?.dropped ?? [])]).toEqual([]);
      // Review correction 1: a choice for the change of the version left is unknown.
      const unknown = await publishChain(
        s.branch,
        s.fix,
        '2026-10-19',
        'carry',
        answer.chain?.key,
        randomUUID(),
        {
          dayChangesKey: days?.key ?? '',
          dayDecisions: [{ key: keyOf(inD?.id) ?? '', choice: 'drop' }],
        },
      );
      expect(blockedBy(unknown)).toContainEqual({
        code: 'day_decision_unknown',
        path: `dayChanges.${keyOf(inD?.id) ?? ''}`,
      });
      versionOf(
        await publishChain(
          s.branch,
          s.fix,
          '2026-10-19',
          'carry',
          answer.chain?.key,
          randomUUID(),
          { dayChangesKey: days?.key ?? '' },
        ),
      );
      // B carries the second teacher and room2, but the one-day room stays.
      expect(await lessonOn('2026-11-16')).toMatchObject({ teacher_id: s.second, room_id: spare });
      expect(await lessonOn('2026-11-23')).toMatchObject({ room_id: s.room2 });
      expect((await lessonOn('2027-04-05'))?.room_id).toBe(spare);
      const [carry] = await t.entries('timetable_version.carry', s.b);
      expect(carry?.new_value).toMatchObject({
        dayChanges: { kept: [keyOf(inB?.id)], ended: [] },
      });
      expect(
        await t.database.migrator.selectFrom('lesson_day_change_ends').selectAll().execute(),
      ).toEqual([]);
    });

    // Task 5.6a-5a (spec review of the code, must-fix 4): a move in a carried
    // version's run that the carried teacher cannot take needs a decision,
    // which is written and ended with the carry.
    it('asks for a decision on a move of a carried version that its new teacher cannot take, and settles it with the carry', async () => {
      const s = await chainScene();
      const lessonOn = async (date: string) =>
        (await lessonsOf(s.branch)).find((one) => one.date === date && one.class_id === s.classId);
      const inB = await lessonOn('2026-11-16');
      const moved = await request(t.kit.server)
        .post(`/api/timetable/lessons/${inB?.id ?? ''}/move`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ date: '2026-11-18', lessonNumber: 1, reason: 'Concert rehearsal' });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      const at18 = await lessonOn('2026-11-18');
      // An exam of another class that the second teacher invigilates at that time.
      const examClass = await load.classes.schoolClass(s.branch, s.year, { grade: 7 });
      const examRoom = await load.classes.room(s.branch);
      await t.database.migrator.transaction().execute(async (transaction) => {
        const exam = await transaction
          .insertInto('exams')
          .values({
            branch_id: s.branch,
            academic_year_id: s.year,
            exam_date: '2026-11-18',
            starts_at: at18?.starts_at ?? new Date(0),
            ends_at: at18?.ends_at ?? new Date(0),
            first_slot: 1,
            last_slot: 1,
            title: 'Quarter exam in English',
            subject_id: s.subject,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const room = await transaction
          .insertInto('exam_rooms')
          .values({ branch_id: s.branch, exam_id: exam.id, room_id: examRoom })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('exam_room_classes')
          .values({
            branch_id: s.branch,
            exam_id: exam.id,
            exam_room_id: room.id,
            class_id: examClass,
          })
          .execute();
        await transaction
          .insertInto('exam_invigilators')
          .values({
            branch_id: s.branch,
            exam_id: exam.id,
            exam_room_id: room.id,
            staff_id: s.second,
          })
          .execute();
      });
      const [change] = await t.database.migrator
        .selectFrom('lesson_day_changes')
        .select('id')
        .where('lesson_id', '=', inB?.id ?? '')
        .execute();
      const answer = checkOf(await checkChain(s.branch, s.fix, '2026-10-19', 'carry'));
      const days = answer.impact?.dayChanges;
      expect(days?.decide.map((one) => [one.key, one.carriedVersionId])).toEqual([
        [change?.id, s.b],
      ]);
      expect(days?.decide[0]?.blocked.map((one) => one.rule)).toContain('teacher_double');
      // Without a choice the publish waits.
      expect(
        blockedBy(
          await publishChain(
            s.branch,
            s.fix,
            '2026-10-19',
            'carry',
            answer.chain?.key,
            randomUUID(),
            {
              dayChangesKey: days?.key ?? '',
            },
          ),
        ),
      ).toContainEqual({ code: 'day_change_undecided', path: `dayChanges.${change?.id ?? ''}` });
      versionOf(
        await publishChain(
          s.branch,
          s.fix,
          '2026-10-19',
          'carry',
          answer.chain?.key,
          randomUUID(),
          {
            dayChangesKey: days?.key ?? '',
            dayDecisions: [{ key: change?.id, choice: 'cancel' }],
          },
        ),
      );
      // The lesson is back on Monday 16 November with the carried teacher, cancelled that day.
      expect(await lessonOn('2026-11-18')).toBeUndefined();
      const back = (await lessonsOf(s.branch)).filter(
        (one) => one.date === '2026-11-16' && one.class_id === s.classId,
      );
      expect(back).toHaveLength(1);
      const row = await t.database.migrator
        .selectFrom('lessons')
        .select(['teacher_id', 'cancel_cause', 'cancel_reason'])
        .where('id', '=', back[0]?.id ?? '')
        .executeTakeFirstOrThrow();
      expect(row).toEqual({
        teacher_id: s.second,
        cancel_cause: 'reason',
        cancel_reason: 'Concert rehearsal',
      });
      const ends = await t.database.migrator
        .selectFrom('lesson_day_change_ends')
        .select('change_id')
        .execute();
      expect(ends.map((one) => one.change_id)).toEqual([change?.id]);
      const [carry] = await t.entries('timetable_version.carry', s.b);
      expect(carry?.new_value).toMatchObject({
        dayChanges: { decided: [{ key: change?.id, choice: 'cancel' }], ended: [change?.id] },
      });
    });

    it('refuses without an answer, and a refused publish changes nothing', async () => {
      const s = await chainScene();
      const before = await written([s.fix]);
      expect(blockedBy(await publish(s.branch, s.fix, '2026-10-19'))).toContainEqual({
        code: 'version_later_published',
        path: 'chain',
      });
      // A replace and a carry refused for another reason (the key) write nothing either.
      for (const chain of ['replace', 'carry']) {
        expect(
          blockedBy(await publishChain(s.branch, s.fix, '2026-10-19', chain, '0'.repeat(64))),
        ).toContainEqual({
          code: 'chain_changed',
          path: 'chain',
        });
      }
      expect(await written([s.fix])).toEqual(before);
    });

    it('refuses carry for a draft with no source and for one that differs in more than teachers and rooms', async () => {
      const s = await chainScene();
      const noSource = await placedDraft(s);
      const answer = checkOf(await checkChain(s.branch, noSource, '2026-10-19', 'carry'));
      expect(answer.chain).toMatchObject({ carryOffered: false, carryReason: 'no_source' });
      expect(answer.refusals).toContainEqual({ code: 'chain_carry_not_offered' });
      const key = answer.chain?.key;
      expect(
        blockedBy(await publishChain(s.branch, noSource, '2026-10-19', 'carry', key)),
      ).toContainEqual({
        code: 'chain_carry_not_offered',
        path: 'chain',
      });
      const [fixRow] = await rowsOf(s.fix);
      const edited = await t.patch(
        `/api/timetable/versions/${s.fix}/load/${fixRow?.id ?? ''}`,
        s.branch,
        { teacherId: null, lessonsPerWeek: 2, roomId: null, roomType: null, doubleLessons: false },
        t.admin,
      );
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      const other = checkOf(await checkChain(s.branch, s.fix, '2026-10-19', 'carry'));
      expect(other.chain).toMatchObject({ carryOffered: false, carryReason: 'other_changes' });
      expect(other.refusals).toContainEqual({ code: 'chain_carry_not_offered' });
    });

    it('refuses run until and carry on the start of a published version, and replaces it with replace', async () => {
      const s = await chainScene();
      for (const chain of ['run_until', 'carry']) {
        const key = (await laterKey(s.branch, s.fix, '2026-11-09', chain)).key;
        expect(
          blockedBy(await publishChain(s.branch, s.fix, '2026-11-09', chain, key)),
        ).toContainEqual({
          code: 'chain_start_taken',
          path: 'chain',
        });
      }
      const key = (await laterKey(s.branch, s.fix, '2026-11-09', 'replace')).key;
      versionOf(await publishChain(s.branch, s.fix, '2026-11-09', 'replace', key));
      expect((await versionRow(s.b)).status).toBe('archived');
      expect((await versionRow(s.c)).status).toBe('archived');
    });

    it("writes nothing on a check with any answer, and names only the branch's own versions", async () => {
      const s = await chainScene();
      const theirs = await chainScene();
      const before = await written([s.fix, theirs.fix]);
      for (const chain of ['run_until', 'replace', 'carry']) {
        const answer = checkOf(await checkChain(s.branch, s.fix, '2026-10-19', chain));
        expect(answer.chain?.later.map((one) => one.id)).toEqual([s.b, s.c]);
      }
      expect(await written([s.fix, theirs.fix])).toEqual(before);
    });

    it('refuses the key of a publish sent again with another answer', async () => {
      const s = await chainScene();
      const chain = await laterKey(s.branch, s.fix, '2026-10-19', 'run_until');
      const key = randomUUID();
      versionOf(await publishChain(s.branch, s.fix, '2026-10-19', 'run_until', chain.key, key));
      refusedWith(
        await publishChain(s.branch, s.fix, '2026-10-19', 'replace', chain.key, key),
        409,
        'request_key_reused',
      );
      expect((await versionRow(s.b)).status).toBe('published');
    });

    // Spec review of the plan, should-fix 1: the database lets a carry change
    // a published version's teachers and rooms; the routes of a draft still refuse.
    it('still refuses the load and room routes on a later published version', async () => {
      const s = await chainScene();
      const [row] = await rowsOf(s.b);
      const [entry] = await entriesOf(s.b);
      const block = await t.database.migrator
        .selectFrom('pattern_blocks')
        .select('id')
        .where('version_id', '=', s.b)
        .executeTakeFirstOrThrow();
      const before = [await rowsOf(s.b), await entriesOf(s.b), await t.auditCount()];
      refusedWith(
        await t.patch(
          `/api/timetable/versions/${s.b}/load/${row?.id ?? ''}`,
          s.branch,
          {
            teacherId: s.second,
            lessonsPerWeek: 1,
            roomId: null,
            roomType: null,
            doubleLessons: false,
          },
          t.admin,
        ),
        409,
        'version_not_draft',
      );
      refusedWith(
        await post(`/api/timetable/versions/${s.b}/pattern/${block.id}/room`, s.branch, {
          lessonId: entry?.id ?? '',
          roomId: s.room2,
        }),
        409,
        'version_not_draft',
      );
      expect([await rowsOf(s.b), await entriesOf(s.b), await t.auditCount()]).toEqual(before);
    });

    // Permission review, must-fix 1 and should-fixes 1 and 2: the rows a
    // replace or a carry would write exist in both branches.
    it("answers 404 for another branch's draft and an unknown one with every answer, changing nothing in either branch", async () => {
      const s = await chainScene();
      const theirs = await chainScene();
      await viceIn(s.branch);
      await load.freeEditLock(s.fix);
      const before = await written([s.fix, theirs.fix]);
      for (const cookie of [t.admin, t.vicePrincipal]) {
        for (const id of [theirs.fix, UNKNOWN]) {
          for (const chain of ['replace', 'carry']) {
            refusedWith(
              await request(t.kit.server)
                .post(`/api/timetable/versions/${id}/publish`)
                .set('Cookie', cookie)
                .set(BRANCH_HEADER, s.branch)
                .set(REQUEST_KEY_HEADER, randomUUID())
                .send({ startsOn: '2026-10-19', chain, laterKey: 'a'.repeat(64) }),
              404,
              'not_found',
            );
            refusedWith(
              await check(s.branch, id, `2026-10-19&chain=${chain}`, cookie),
              404,
              'not_found',
            );
          }
        }
      }
      expect(await written([s.fix, theirs.fix])).toEqual(before);
    });

    it('replaces and carries in its own branch only, and checks a repeat again before the stored answer', async () => {
      const s = await chainScene();
      const theirs = await chainScene();
      const theirsBefore = await written([theirs.fix]);
      const chain = await laterKey(s.branch, s.fix, '2026-10-19', 'replace');
      const key = randomUUID();
      versionOf(await publishChain(s.branch, s.fix, '2026-10-19', 'replace', chain.key, key));
      const after = await written([s.fix, theirs.fix]);
      for (const id of [theirs.fix, UNKNOWN]) {
        refusedWith(
          await publishChain(s.branch, id, '2026-10-19', 'replace', chain.key, key),
          404,
          'not_found',
        );
      }
      const principal = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', 'principal')
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      await load.classes.role(principal.account_id, s.branch, 'principal');
      expect(
        (
          await request(t.kit.server)
            .post(`/api/timetable/versions/${s.fix}/publish`)
            .set('Cookie', t.principal)
            .set(BRANCH_HEADER, s.branch)
            .set(REQUEST_KEY_HEADER, key)
            .send({ startsOn: '2026-10-19', chain: 'replace', laterKey: chain.key })
        ).status,
      ).toBe(403);
      expect(await written([s.fix, theirs.fix])).toEqual(after);
      // The other branch's chain is as it was; then a carry there leaves this branch's.
      const [theirVersions, theirRows, theirEntries] = theirsBefore;
      expect((await written([theirs.fix])).slice(0, 3)).toEqual([
        theirVersions,
        theirRows,
        theirEntries,
      ]);
      const ownBefore = (await written([s.fix])).slice(0, 3);
      const carry = await laterKey(theirs.branch, theirs.fix, '2026-10-19', 'carry');
      versionOf(await publishChain(theirs.branch, theirs.fix, '2026-10-19', 'carry', carry.key));
      expect((await rowsOf(theirs.b)).map((one) => one.teacher_id)).toEqual([theirs.second]);
      expect((await written([s.fix])).slice(0, 3)).toEqual(ownBefore);
    });

    it('ignores an answer when no later version is published', async () => {
      const s = await scene();
      const answer = checkOf(await checkChain(s.branch, s.version, MONDAY, 'replace'));
      expect(answer.chain).toBeNull();
      expect(answer.refusals).toEqual([]);
      versionOf(await publishChain(s.branch, s.version, MONDAY, 'replace', undefined));
    });
  });

  describe('a repeat', () => {
    it('refuses a key of another account, of another date and a missing key, changing nothing (permission review, must-fix 1)', async () => {
      const s = await scene();
      await viceIn(s.branch);
      await load.freeEditLock(s.version);
      const key = randomUUID();
      // The Super Admin's key, refused, rolls back with the refusal: it is
      // used for a refused publish, then sent again by another account.
      const used = randomUUID();
      blockedBy(await publish(s.branch, s.version, TODAY, t.admin, used));
      const before = await written([s.version]);
      versionOf(await publish(s.branch, s.version, MONDAY, t.admin, key));
      const after = await written([s.version]);
      refusedWith(
        await publish(s.branch, s.version, MONDAY, t.vicePrincipal, key),
        409,
        'request_key_reused',
      );
      refusedWith(
        await publish(s.branch, s.version, '2026-10-19', t.admin, key),
        409,
        'request_key_reused',
      );
      const missing = await request(t.kit.server)
        .post(`/api/timetable/versions/${s.version}/publish`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .send({ startsOn: MONDAY });
      expect(missing.status, JSON.stringify(missing.body)).toBe(400);
      expect(await written([s.version])).toEqual(after);
      expect(after).not.toEqual(before);
    });

    it('checks the permission and the branch again on a repeat, before the stored answer (permission review, must-fix 1)', async () => {
      const s = await scene();
      const theirs = await scene();
      await load.freeEditLock(s.version);
      const key = randomUUID();
      versionOf(await publish(s.branch, s.version, MONDAY, t.admin, key));
      const after = await written([s.version, theirs.version]);
      for (const id of [theirs.version, UNKNOWN]) {
        refusedWith(await publish(s.branch, id, MONDAY, t.admin, key), 404, 'not_found');
      }
      const principal = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', 'principal')
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      await load.classes.role(principal.account_id, s.branch, 'principal');
      expect((await publish(s.branch, s.version, MONDAY, t.principal, key)).status).toBe(403);
      expect(await written([s.version, theirs.version])).toEqual(after);
    });

    it('gets the same answer and publishes once', async () => {
      const s = await scene();
      const key = randomUUID();
      const first = versionOf(await publish(s.branch, s.version, MONDAY, t.admin, key));
      // Task 5.5c-1: the journals and their entries as the first publish left them.
      const journals = await written([s.version]);
      const again = versionOf(await publish(s.branch, s.version, MONDAY, t.admin, key));
      expect(again).toEqual(first);
      expect(await t.entries('timetable_version.publish', s.version)).toHaveLength(1);
      expect(await written([s.version])).toEqual(journals);
      expect(journals[11]).toHaveLength(1);
    });

    it('sent while the first waits for the publish lock, gets the same answer (review correction 2)', async () => {
      const s = await scene();
      const key = randomUUID();
      const held = await t.database.app.connection().execute(async (connection) => {
        await sql`select pg_advisory_lock(550001)`.execute(connection);
        const sent = [
          publish(s.branch, s.version, MONDAY, t.admin, key).then((response) => response),
          publish(s.branch, s.version, MONDAY, t.admin, key).then((response) => response),
        ];
        await waitForAdvisory(2);
        await sql`select pg_advisory_unlock(550001)`.execute(connection);
        return Promise.all(sent);
      });
      const [one, two] = held.map(versionOf);
      expect(two).toEqual(one);
      expect(await t.entries('timetable_version.publish', s.version)).toHaveLength(1);
    });
  });

  describe('another branch', () => {
    it("answers 404 for another branch's version and an unknown one, and changes nothing", async () => {
      const first = await scene();
      const firstTheirs = await scene();
      await viceIn(first.branch);
      // Task 5.5b-1 (.claude/rules/api.md): stored lessons a publish would
      // change, in both branches, from a published version of each.
      versionOf(await publish(first.branch, first.version, MONDAY));
      versionOf(await publish(firstTheirs.branch, firstTheirs.version, MONDAY));
      const s = { ...first, version: await placedDraft(first) };
      const theirs = { ...firstTheirs, version: await placedDraft(firstTheirs) };
      // Rows a publish would change, in both branches (permission review, must-fix 2).
      await withMoreToChange(s);
      await withMoreToChange(theirs);
      // Task 5.6a-5a (permission review, must-fix 1): a one-day room change in
      // each branch, which a publish would end or keep.
      for (const one of [s, theirs]) {
        const lesson = (await lessonsOf(one.branch)).find(
          (row) => row.date === '2026-10-26' && row.class_id === one.classId,
        );
        const roomed = await request(t.kit.server)
          .post(`/api/timetable/lessons/${lesson?.id ?? ''}/room`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, one.branch)
          .set(REQUEST_KEY_HEADER, randomUUID())
          .send({ roomId: await load.classes.room(one.branch), reason: 'The room is painted' });
        expect(roomed.status, JSON.stringify(roomed.body)).toBe(200);
      }
      const before = await written([s.version, theirs.version]);
      expect(new Set(before[13].map((one) => one.branch_id)).size).toBe(2);
      expect(before[8].length).toBeGreaterThan(0);
      expect(new Set(before[8].map((one) => one.branch_id)).size).toBe(2);
      // Task 5.5c-1: journals of both branches, which the Tutor rows added would change.
      expect(new Set(before[11].map((one) => one.branch_id)).size).toBe(2);
      for (const cookie of [t.admin, t.vicePrincipal]) {
        for (const id of [theirs.version, UNKNOWN]) {
          refusedWith(await publish(s.branch, id, '2026-10-19', cookie), 404, 'not_found');
          refusedWith(await check(s.branch, id, '2026-10-19', cookie), 404, 'not_found');
        }
      }
      expect(await written([s.version, theirs.version])).toEqual(before);
    });
  });

  // edge/timetable, Generator and editing: "Publish is clicked twice, or two
  // people publish. One publish per branch at a time. A publish either
  // succeeds completely or changes nothing." 06, Two drafts at once: "The
  // first to publish stands; the second cannot publish the clashing lessons
  // until they are moved." Both publishes are real routes; a third
  // transaction holds the publish lock, so that they meet in a known order.
  describe('two at the same moment', () => {
    /** A transaction of the application that runs `first`, waits until let go, runs `then` and commits. */
    async function holdOpen(
      branches: string[],
      first: (transaction: Transaction) => Promise<void>,
      then: (transaction: Transaction) => Promise<void> = () => Promise.resolve(),
    ) {
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
        .run(branches, async (transaction) => {
          await first(transaction);
          ready();
          await released;
          await then(transaction);
        })
        .catch((error: unknown) => error);
      await Promise.race([isReady, done]);
      return { release, done };
    }

    /** The sessions of the test database waiting for a lock, of one kind when named. */
    async function waiting(locktype: string | null = null): Promise<number> {
      const found = await sql<{ n: number }>`
        select count(distinct l.pid)::int as n
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and not l.granted
          and (${locktype}::text is null or l.locktype = ${locktype}::text)
      `.execute(t.database.migrator);
      return found.rows[0]?.n ?? 0;
    }

    /** The two publishes, the first sent first, both behind the held publish lock. */
    async function inOrder(
      branches: string[],
      first: () => Promise<Response>,
      second: () => Promise<Response>,
    ): Promise<[Response, Response]> {
      const gate = await holdOpen(branches, async (transaction) => {
        await sql`select pg_advisory_xact_lock(550001)`.execute(transaction);
      });
      const one = first().then((response) => response);
      await expect.poll(() => waiting('advisory'), { timeout: 20_000, interval: 25 }).toBe(1);
      const two = second().then((response) => response);
      await expect.poll(() => waiting('advisory'), { timeout: 20_000, interval: 25 }).toBe(2);
      gate.release();
      expect(await gate.done).toBeUndefined();
      return Promise.all([one, two]);
    }

    it('publishes one draft once when two accounts publish it together, in either order', async () => {
      for (const order of [0, 1]) {
        const s = await scene();
        await viceIn(s.branch);
        await load.freeEditLock(s.version);
        const cookies = order === 0 ? [t.admin, t.vicePrincipal] : [t.vicePrincipal, t.admin];
        const [one, two] = await inOrder(
          [s.branch],
          () => publish(s.branch, s.version, MONDAY, cookies[0]),
          () => publish(s.branch, s.version, MONDAY, cookies[1]),
        );
        expect(versionOf(one).status).toBe('published');
        refusedWith(two, 409, 'version_not_draft');
        expect(await t.entries('timetable_version.publish', s.version)).toHaveLength(1);
      }
    });

    it('marks and refuses the second draft of a branch, in either order', async () => {
      for (const order of [0, 1]) {
        const s = await scene();
        const sibling = await placedDraft(s);
        await load.freeEditLock(s.version);
        await load.freeEditLock(sibling);
        // The first sent starts first, so the second is refused for one reason only.
        const [firstId, secondId] = order === 0 ? [s.version, sibling] : [sibling, s.version];
        const [one, two] = await inOrder(
          [s.branch],
          () => publish(s.branch, firstId, MONDAY),
          () => publish(s.branch, secondId, '2026-10-19'),
        );
        expect(versionOf(one).status).toBe('published');
        expect(blockedBy(two)).toEqual([{ code: 'draft_out_of_date', path: '' }]);
        expect((await versionRow(secondId)).status).toBe('draft');
      }
    });

    /**
     * A teacher of two branches whose hours never overlap: in branch A until
     * 09:00, in branch B from 09:00, with 30 minutes of travel between them.
     * Branch A's lesson is on Monday at 08:00–08:45, branch B's (a day from
     * 09:00) at 09:00–09:45: each draft can be published alone, not both.
     */
    async function twoBranches() {
      const a = await scene({ hoursRange: [0, 540] });
      const b = await scene({
        startTime: '09:00',
        teacherFor: async (branch, subject) => {
          await t.database.migrator
            .insertInto('staff_branches')
            .values({ staff_id: a.teacherId, branch_id: branch, is_main: false })
            .execute();
          await load.profile(a.teacherId, [{ subject, grades: [7] }]);
          await hours(branch, a.teacherId, [540, 1440]);
          return a.teacherId;
        },
      });
      const [low = '', high = ''] = [a.branch, b.branch].sort();
      await t.database.migrator
        .insertInto('travel_times')
        .values({ branch_low: low, branch_high: high, minutes: 30 })
        .execute();
      for (const one of [a, b]) {
        await load.freeEditLock(one.version);
        expect(checkOf(await check(one.branch, one.version, MONDAY)).canPublish).toBe(true);
      }
      return { a, b };
    }

    it('lets the first of two branches stand and refuses the clash of the second (decision 2)', async () => {
      for (const order of [0, 1]) {
        const pair = await twoBranches();
        const [first, second] = order === 0 ? [pair.a, pair.b] : [pair.b, pair.a];
        // The two meet on the publish lock alone (spec review of the plan, should-fix 8).
        const [one, two] = await inOrder(
          [pair.a.branch, pair.b.branch],
          () => publish(first.branch, first.version, MONDAY),
          () => publish(second.branch, second.version, MONDAY),
        );
        expect(versionOf(one).status).toBe('published');
        expect(blockedBy(two)).toEqual([{ code: 'pattern_blocked', path: 'pattern.travel_time' }]);
      }
    });

    // Task 5.5a-3a (spec review of the plan, should-fix 2 and 3): the first
    // publish replaces B and stands at 19 October; the second, sent with the
    // key of the check it made while B was the later version, waits on the
    // publish lock and is refused `chain_changed`: its replace would now
    // archive the first, which it was never shown. It writes nothing.
    it('refuses a replace whose later versions changed while it waited', async () => {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, MONDAY));
      const b = await placedCopy(s.branch, s.year, s.version);
      versionOf(await publish(s.branch, b, '2026-11-09'));
      const x = await placedCopy(s.branch, s.year, s.version);
      const y = await placedCopy(s.branch, s.year, s.version);
      const keyOf = async (version: string) => {
        const answer = checkOf(await check(s.branch, version, '2026-10-19&chain=replace'));
        return answer.chain?.key ?? '';
      };
      const [xKey, yKey] = [await keyOf(x), await keyOf(y)];
      expect(yKey).not.toBe('');
      const send = (version: string, key: string) =>
        request(t.kit.server)
          .post(`/api/timetable/versions/${version}/publish`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, s.branch)
          .set(REQUEST_KEY_HEADER, randomUUID())
          .send({ startsOn: '2026-10-19', chain: 'replace', laterKey: key });
      const [one, two] = await inOrder(
        [s.branch],
        () => send(x, xKey),
        () => send(y, yKey),
      );
      expect(versionOf(one).status).toBe('published');
      expect((await versionRow(b)).status).toBe('archived');
      expect(blockedBy(two)).toEqual([
        { code: 'draft_out_of_date', path: '' },
        { code: 'chain_changed', path: 'chain' },
      ]);
      expect((await versionRow(y)).status).toBe('draft');
      expect((await versionRow(x)).status).toBe('published');
      expect(await t.entries('timetable_version.publish', y)).toHaveLength(0);
    });

    it('takes the drafts of the year in the order of their id, as a Tutor change does (must-fix 1)', async () => {
      const s = await scene();
      // A draft whose id comes before the one published (uuidv7 ids grow).
      const larger = await placedDraft(s);
      const smaller = s.version;
      await load.freeEditLock(larger);
      // As `followTutors` does: the year FOR SHARE, the drafts FOR UPDATE in
      // the order of their id, each with its Tutor rows written.
      const write = (transaction: Transaction, version: string) =>
        transaction
          .updateTable('teaching_load_rows')
          .set({ teacher_id: s.teacherId })
          .where('version_id', '=', version)
          .execute();
      const tutorChange = await holdOpen(
        [s.branch],
        async (transaction) => {
          await transaction
            .selectFrom('academic_years')
            .select('id')
            .where('id', '=', s.year)
            .forShare()
            .execute();
          await transaction
            .selectFrom('timetable_versions')
            .select('id')
            .where('id', '=', smaller)
            .forUpdate()
            .execute();
          await write(transaction, smaller);
        },
        async (transaction) => {
          await transaction
            .selectFrom('timetable_versions')
            .select('id')
            .where('id', '=', larger)
            .forUpdate()
            .execute();
          await write(transaction, larger);
        },
      );
      const published = publish(s.branch, larger, '2026-10-19').then((response) => response);
      await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(1);
      // The publish waits on the smaller draft and holds no draft yet: the
      // Tutor change takes the larger one too and commits, with no deadlock.
      tutorChange.release();
      expect(await tutorChange.done).toBeUndefined();
      expect(versionOf(await published).status).toBe('published');
    });

    it('takes the branch row before the year, as a year edit does (should-fix 9)', async () => {
      const s = await scene();
      await load.freeEditLock(s.version);
      // As a year edit does: the branch row FOR UPDATE, then the year FOR UPDATE.
      const yearEdit = await holdOpen(
        [s.branch],
        async (transaction) => {
          await transaction
            .selectFrom('branches')
            .select('id')
            .where('id', '=', s.branch)
            .forUpdate()
            .execute();
        },
        async (transaction) => {
          await transaction
            .selectFrom('academic_years')
            .select('id')
            .where('id', '=', s.year)
            .forUpdate()
            .execute();
          await transaction
            .updateTable('academic_years')
            .set({ end_date: '2027-05-31' })
            .where('id', '=', s.year)
            .execute();
        },
      );
      const published = publish(s.branch, s.version, MONDAY).then((response) => response);
      await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(1);
      yearEdit.release();
      expect(await yearEdit.done).toBeUndefined();
      expect(versionOf(await published).status).toBe('published');
    });
    /**
     * Task 5.5b-1 (decision 11): a scene with a Tutor row of the class on
     * Tuesday, the first Tutor until 16 November and a second Tutor's role
     * ready to give from then; the scene's own teacher teaches Monday.
     */
    async function tutorScene() {
      const s = await scene();
      const tutorSubject = await load.tutorSubject({ grades: [7] });
      await t.database.migrator
        .updateTable('subjects')
        .set({ journal_type: 'attendance_only' })
        .where('id', '=', tutorSubject)
        .execute();
      const first = await load.teacher(s.branch);
      await hours(s.branch, first.staffId);
      const second = await load.teacher(s.branch);
      await hours(s.branch, second.staffId);
      await load.tutorOf(s.branch, s.classId, first.accountId, {
        until: new Date('2026-11-16T00:00:00+05:00'),
      });
      const created = await post(`/api/timetable/versions/${s.version}/load`, s.branch, {
        classId: s.classId,
        groupId: null,
        subjectId: tutorSubject,
        teacherId: null,
        lessonsPerWeek: 1,
        roomId: null,
        roomType: null,
        doubleLessons: false,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      await placeAt(s.branch, s.version, (created.body as { id: string }).id, 2);
      await confirmTemplates(s.branch, s.version);
      await load.freeEditLock(s.version);
      const secondRole = await load.classes.role(second.accountId, s.branch, 'tutor');
      return { ...s, tutorSubject, first, second, secondRole };
    }

    /** The class's Tutor lessons (Tuesdays) by date with their teacher. */
    const tutorLessonsOf = async (s: { branch: string; tutorSubject: string }) =>
      (await lessonsOf(s.branch))
        .filter((one) => one.subject_id === s.tutorSubject)
        .map((one) => [one.date, one.teacher_id] as const);

    /** Two real requests that meet on the year's versions, the first sent first (decision 11). */
    async function behindVersions(
      s: { branch: string; year: string },
      first: () => Promise<Response>,
      second: () => Promise<Response>,
      hold: (transaction: Transaction) => Promise<unknown> = (transaction) =>
        transaction
          .selectFrom('timetable_versions')
          .select('id')
          .where('academic_year_id', '=', s.year)
          .orderBy('id')
          .forNoKeyUpdate()
          .execute(),
    ): Promise<[Response, Response]> {
      const gate = await holdOpen([s.branch], async (transaction) => {
        await hold(transaction);
      });
      const one = first().then((response) => response);
      await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(1);
      const two = second().then((response) => response);
      await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(2);
      gate.release();
      expect(await gate.done).toBeUndefined();
      return Promise.all([one, two]);
    }

    it('writes the Tutor lessons with no teacher after the Tutor ends (no Tutor on the date)', async () => {
      const s = await tutorScene();
      versionOf(await publish(s.branch, s.version, MONDAY));
      for (const [date, teacher] of await tutorLessonsOf(s)) {
        expect(teacher).toBe(date < '2026-11-16' ? s.first.staffId : null);
      }
    });

    // Review of #152, finding 2 (edge/timetable, Structure: "Their teacher is
    // always the class's Tutor in force on the lesson's date").
    it('gives a Tutor lesson created cancelled the Tutor of its date, not the Tutor of the row', async () => {
      const s = await tutorScene();
      const given = await post(`/api/classes/${s.classId}/tutors`, s.branch, {
        assignmentId: s.secondRole,
        kind: 'tutor',
        from: '2026-11-16',
        until: null,
      });
      expect(given.status, JSON.stringify(given.body)).toBe(201);
      const regular = await t.database.migrator
        .selectFrom('day_template_assignments')
        .select('day_template_id')
        .where('branch_id', '=', s.branch)
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('calendar_entries')
        .values({
          branch_id: s.branch,
          kind: 'special_day',
          name: 'Exam week',
          first_date: '2026-11-24',
          last_date: '2026-11-24',
          day_template_id: regular.day_template_id,
          exam_week: 'no_regular_lessons',
        })
        .execute();
      await load.freeEditLock(s.version);
      versionOf(await publish(s.branch, s.version, MONDAY));
      const lessons = (await lessonsOf(s.branch)).filter(
        (one) => one.subject_id === s.tutorSubject,
      );
      const cancelled = lessons.filter((one) => one.cancel_cause !== null);
      expect(cancelled.map((one) => [one.date, one.cancel_cause, one.teacher_id])).toEqual([
        ['2026-11-24', 'exam_week', s.second.staffId],
      ]);
      // The held Tutor lessons around it carry the same Tutor.
      const around = lessons.filter(
        (one) => one.date === '2026-11-17' || one.date === '2026-12-01',
      );
      expect(around.map((one) => one.teacher_id)).toEqual([s.second.staffId, s.second.staffId]);
    });

    it('gives the Tutor lessons to the new Tutor when a Tutor give and a publish meet, in either order (decision 11)', async () => {
      for (const order of [0, 1]) {
        const s = await tutorScene();
        const give = () =>
          post(`/api/classes/${s.classId}/tutors`, s.branch, {
            assignmentId: s.secondRole,
            kind: 'tutor',
            from: '2026-11-16',
            until: null,
          });
        const send = () => publish(s.branch, s.version, MONDAY);
        const [one, two] = await behindVersions(
          s,
          order === 0 ? send : give,
          order === 0 ? give : send,
        );
        const [published, given] = order === 0 ? [one, two] : [two, one];
        expect(versionOf(published).status).toBe('published');
        expect(given.status, JSON.stringify(given.body)).toBe(201);
        const lessons = await tutorLessonsOf(s);
        expect(lessons.map(([date]) => date)).toEqual(schoolDates(2, MONDAY));
        for (const [date, teacher] of lessons) {
          expect(teacher).toBe(date < '2026-11-16' ? s.first.staffId : s.second.staffId);
        }
      }
    });

    it('lets a leaving and a publish both commit, in either order, the Tutor lessons after the leaving with no teacher (must-fix 5)', async () => {
      for (const order of [0, 1]) {
        const s = await tutorScene();
        const leave = () =>
          post(`/api/people/staff/${s.first.staffId}/status`, s.branch, {
            status: 'left',
            from: '2026-11-02',
          });
        const send = () => publish(s.branch, s.version, MONDAY);
        const [one, two] = await behindVersions(
          s,
          order === 0 ? send : leave,
          order === 0 ? leave : send,
        );
        const [published, left] = order === 0 ? [one, two] : [two, one];
        expect(versionOf(published).status).toBe('published');
        expect(left.status, JSON.stringify(left.body)).toBe(200);
        // Review correction 1: the Tutor lessons only; the leaving does not
        // touch a teacher's regular lessons before 5.7a.
        for (const [date, teacher] of await tutorLessonsOf(s)) {
          expect(teacher).toBe(date < '2026-11-02' ? s.first.staffId : null);
        }
      }
    });

    // Review of #152, finding 1: an archive holds its class FOR UPDATE; the
    // publish takes the classes FOR KEY SHARE before the versions, so neither
    // waits for both. Round 2, finding 1: the archive behind a publish meets
    // the lessons it wrote and is refused.
    it('runs an archive of the class and a publish one after the other, in either order, with no deadlock', async () => {
      for (const order of [0, 1]) {
        const s = await tutorScene();
        const archive = () => post(`/api/classes/${s.classId}/archive`, s.branch, {});
        const send = () => publish(s.branch, s.version, MONDAY);
        // Publish first: the publish holds the class `for key share` and waits
        // at the held versions; the archive waits for the class. Archive
        // first: both wait at the class held `for update`, the archive in
        // front (round 2: the archive no longer takes the versions).
        const [one, two] = await behindVersions(
          s,
          order === 0 ? send : archive,
          order === 0 ? archive : send,
          order === 0
            ? undefined
            : (transaction) =>
                transaction
                  .selectFrom('classes')
                  .select('id')
                  .where('id', '=', s.classId)
                  .forUpdate()
                  .execute(),
        );
        const [published, archived] = order === 0 ? [one, two] : [two, one];
        if (order === 1) {
          // Archived first: the publish reads the archived class and is refused.
          expect(archived.status, JSON.stringify(archived.body)).toBe(200);
          refusedWith(published, 409, 'publish_blocked');
          expect(await tutorLessonsOf(s)).toEqual([]);
          continue;
        }
        // Published first (round 2, finding 1): the class now has lessons after
        // today, so the archive is refused (`classes_lessons_guard`, 0080),
        // and the Tutor lessons keep their Tutor.
        expect(versionOf(published).status).toBe('published');
        refusedWith(archived, 409, 'class_has_lessons');
        const lessons = await tutorLessonsOf(s);
        expect(lessons.length).toBeGreaterThan(0);
        for (const [date, teacher] of lessons) {
          expect(teacher).toBe(date < '2026-11-16' ? s.first.staffId : null);
        }
      }
    });

    // Build decision (spec review must-fix 5, review correction 2): the
    // record of a person stays FOR UPDATE under a status change (a
    // department move must still wait for a load row naming the person); the
    // publish takes the people of the branch FOR KEY SHARE before the
    // versions, so it waits for such a change before it holds them.
    it('takes the people of the branch before the versions: a publish behind a held person holds no version', async () => {
      const s = await tutorScene();
      const person = await holdOpen([s.branch], async (transaction) => {
        await transaction
          .selectFrom('staff')
          .select('id')
          .where('id', '=', s.first.staffId)
          .forUpdate()
          .execute();
      });
      const sent = publish(s.branch, s.version, MONDAY).then((response) => response);
      await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(1);
      // The versions are free while the publish waits: a status change could take them.
      await t.app
        .get(Transactions)
        .run([s.branch], (transaction) =>
          transaction
            .selectFrom('timetable_versions')
            .select('id')
            .where('academic_year_id', '=', s.year)
            .orderBy('id')
            .forNoKeyUpdate()
            .noWait()
            .execute(),
        );
      person.release();
      expect(await person.done).toBeUndefined();
      expect(versionOf(await sent).status).toBe('published');
    });

    it('answers timetable_busy, with no detail and nothing written, when a clashing lesson commits during the write (must-fix 7)', async () => {
      const lessons = await LessonsKit.create(t.database.migrator);
      const other = await t.newBranch();
      const s = await scene({
        teacherFor: async (branch, subject) => {
          const person = await load.teacher(branch, {
            subjects: [{ subject, grades: [7] }],
            further: [other],
          });
          await hours(branch, person.staffId);
          return person.staffId;
        },
      });
      const otherYear = await lessons.year(other);
      const otherClass = await lessons.load.classes.schoolClass(other, otherYear.year, {
        grade: 7,
      });
      const source = await lessons.source(other, otherYear.year, [
        { classId: otherClass, groupId: null, subjectId: s.subject },
      ]);
      await load.freeEditLock(s.version);
      const before = await written([s.version, source.versionId]);
      // Another branch's lesson of the teacher on Monday 19 October at
      // 08:00, written and not yet committed: the dated check cannot see it.
      const held = await holdOpen([other], async (transaction) => {
        const block = await transaction
          .insertInto('lesson_blocks')
          .values({
            branch_id: other,
            academic_year_id: otherYear.year,
            quarter_id: otherYear.quarters[0] ?? '',
            lesson_date: '2026-10-19',
            starts_at: at('2026-10-19', '08:00'),
            ends_at: at('2026-10-19', '08:45'),
            version_id: source.versionId,
            pattern_block_id: source.patternBlockId,
          })
          .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('lessons')
          .values({
            branch_id: other,
            block_id: block.id,
            lesson_date: block.lesson_date,
            starts_at: block.starts_at,
            ends_at: block.ends_at,
            class_id: otherClass,
            subject_id: s.subject,
            load_row_id: source.lessons[0]?.loadRowId ?? '',
            pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
            teacher_id: s.teacherId,
          })
          .execute();
      });
      const sent = publish(s.branch, s.version, MONDAY).then((response) => response);
      // The publish's write waits on the held lesson's claim.
      await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(1);
      held.release();
      expect(await held.done).toBeUndefined();
      const refused = await sent;
      refusedWith(refused, 409, 'timetable_busy');
      expect((refused.body as { error: { details?: unknown } }).error.details ?? []).toEqual([]);
      const after = await written([s.version, source.versionId]);
      // The held side's own block, lesson and claims are its; the publish wrote nothing.
      const own = (rows: Awaited<typeof before>) => [
        rows[0],
        rows[1],
        rows[2],
        rows[3],
        rows[4],
        rows[5],
        rows[6],
        rows[7].filter((one) => one.branch_id === s.branch),
        rows[8].filter((one) => one.branch_id === s.branch),
        rows[9].filter((one) => one.branch_id === s.branch),
        rows[10],
      ];
      expect(own(after)).toEqual(own(before));
      expect((await versionRow(s.version)).status).toBe('draft');
    });
  });
  // Task 5.5a-2a, pull request #140: every date of the version is checked
  // (edge/timetable, Versions and drafts, "The pattern is valid but one date
  // is not": "Publish … test[s] every affected date with the full rule set. A
  // blocked conflict on any date stops the save and is listed by date").
  // The scene's lesson is on Mondays at 08:00–08:45 from 12 October.
  describe('every date of the version', () => {
    /** The pattern entry of the scene's row. */
    const entryOf = async (version: string) =>
      (
        await t.database.migrator
          .selectFrom('pattern_entries')
          .select('id')
          .where('version_id', '=', version)
          .orderBy('weekday')
          .orderBy('start_minutes')
          .execute()
      ).map((one) => one.id);

    /** A calendar entry of the branch, written as the calendar route writes it. */
    const calendarEntry = (
      branch: string,
      values: {
        kind: 'day_off' | 'special_day';
        first: string;
        template?: string;
        follows?: number;
      },
    ) =>
      t.database.migrator
        .insertInto('calendar_entries')
        .values({
          branch_id: branch,
          kind: values.kind,
          name: values.kind === 'day_off' ? 'Holiday' : 'Short day',
          first_date: values.first,
          last_date: values.first,
          day_template_id: values.template ?? null,
          follows_weekday: values.follows ?? null,
        })
        .execute();

    it("refuses only the dates of another branch's later lessons, naming that branch only (Done when)", async () => {
      const lessons = await LessonsKit.create(t.database.migrator);
      const other = await t.newBranch();
      const s = await scene({
        teacherFor: async (branch, subject) => {
          const person = await load.teacher(branch, {
            subjects: [{ subject, grades: [7] }],
            further: [other],
          });
          await hours(branch, person.staffId);
          return person.staffId;
        },
      });
      const [low = '', high = ''] = [s.branch, other].sort();
      await t.database.migrator
        .insertInto('travel_times')
        .values({ branch_low: low, branch_high: high, minutes: 30 })
        .execute();
      // The other branch's version from 16 November, as 5.5b will write its
      // dated lessons: two Mondays at 08:00–08:45 with the same teacher, and a
      // third at 09:00, 15 minutes after the scene's lesson ends.
      const otherYear = await lessons.year(other);
      const otherClass = await lessons.load.classes.schoolClass(other, otherYear.year, {
        grade: 7,
      });
      const source = await lessons.source(
        other,
        otherYear.year,
        [{ classId: otherClass, groupId: null, subjectId: s.subject }],
        '2026-11-16',
      );
      const from = source.lessons[0];
      if (from === undefined) throw new Error('No source.');
      /** A dated lesson of the teacher in a branch, written as 5.5b will write it. */
      const datedLesson = (
        branch: string,
        year: string,
        quarter: string,
        lesson: {
          versionId: string;
          patternBlockId: string;
          loadRowId: string;
          patternEntryId: string;
        },
        classId: string,
        [date, start, end]: readonly [string, string, string],
      ) =>
        t.app.get(Transactions).run([branch], async (transaction) => {
          const block = await transaction
            .insertInto('lesson_blocks')
            .values({
              branch_id: branch,
              academic_year_id: year,
              quarter_id: quarter,
              lesson_date: date,
              starts_at: at(date, start),
              ends_at: at(date, end),
              version_id: lesson.versionId,
              pattern_block_id: lesson.patternBlockId,
            })
            .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
            .executeTakeFirstOrThrow();
          await transaction
            .insertInto('lessons')
            .values({
              branch_id: branch,
              block_id: block.id,
              lesson_date: block.lesson_date,
              starts_at: block.starts_at,
              ends_at: block.ends_at,
              class_id: classId,
              subject_id: s.subject,
              load_row_id: lesson.loadRowId,
              pattern_entry_id: lesson.patternEntryId,
              teacher_id: s.teacherId,
            })
            .execute();
        });
      for (const when of [
        ['2026-11-16', '08:00', '08:45'],
        ['2026-11-23', '08:00', '08:45'],
        ['2026-11-30', '09:00', '09:45'],
      ] as const) {
        await datedLesson(
          other,
          otherYear.year,
          otherYear.quarters[1] ?? '',
          { ...source, ...from },
          otherClass,
          when,
        );
      }
      // A lesson of the teacher in the scene's own branch, of an earlier
      // published version, on 7 December at the same time: the publish
      // replaces it, so it is no clash (the own branch's claims are left out).
      const ownClass = await load.classes.schoolClass(s.branch, s.year, {
        grade: 7,
        room: await load.classes.room(s.branch),
      });
      const ownSource = await lessons.source(
        s.branch,
        s.year,
        [{ classId: ownClass, groupId: null, subjectId: s.subject }],
        '2026-10-05',
      );
      const ownFrom = ownSource.lessons[0];
      if (ownFrom === undefined) throw new Error('No source.');
      const ownQuarter = await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .where('number', '=', 2)
        .executeTakeFirstOrThrow();
      await datedLesson(s.branch, s.year, ownQuarter.id, { ...ownSource, ...ownFrom }, ownClass, [
        '2026-12-07',
        '08:00',
        '08:45',
      ]);
      await load.freeEditLock(s.version);
      const [entry] = await entryOf(s.version);
      const answer = checkOf(await check(s.branch, s.version, MONDAY));
      expect(answer.canPublish).toBe(false);
      // The own entry, and the other branch by its id only: no lesson,
      // class, room or claim of that branch (decision 8).
      const dated = (date: string, rule: string, detail: Record<string, string | number>) => ({
        code: 'date_blocked',
        result: { rule, severity: 'blocked', weekday: 1, date, lessonIds: [entry], detail },
      });
      expect(answer.refusals).toEqual([
        dated('2026-11-16', 'teacher_double', { branchId: other }),
        dated('2026-11-23', 'teacher_double', { branchId: other }),
        dated('2026-11-30', 'travel_time', { minutes: 30, gap: 15, branchId: other }),
      ]);
      const before = await written([s.version, source.versionId]);
      const refused = await publish(s.branch, s.version, MONDAY);
      refusedWith(refused, 409, 'publish_blocked');
      // The whole detail of each refusal: the own entry and the date, nothing of the other branch.
      expect((refused.body as { error: { details: unknown[] } }).error.details).toEqual(
        [
          ['2026-11-16', 'teacher_double'],
          ['2026-11-23', 'teacher_double'],
          ['2026-11-30', 'travel_time'],
        ].map(([day = '', rule = '']) => ({
          path: `dates.${day}.${rule}`,
          code: 'date_blocked',
          message: 'A reason the publish is refused.',
          rule: { weekday: 1, lessonIds: [entry] },
          day,
        })),
      );
      expect(await written([s.version, source.versionId])).toEqual(before);
      // From 7 December the version is clear of them, and the own branch's
      // lesson that day is no clash (it fails with the own claims read).
      expect(checkOf(await check(s.branch, s.version, '2026-12-07')).refusals).toEqual([]);
    });

    it('lists the dates under a later availability entry as warnings and publishes (Done when)', async () => {
      const s = await scene({
        teacherFor: async (branch, subject) => {
          const person = await load.teacher(branch, { subjects: [{ subject, grades: [7] }] });
          await hours(branch, person.staffId);
          // From 4 January the teacher starts at 09:00 (edge/timetable, "A part-time teacher stops working Fridays from December").
          await t.database.migrator
            .updateTable('staff_availability')
            .set({ valid_until: '2027-01-04' })
            .where('staff_id', '=', person.staffId)
            .execute();
          await t.database.migrator
            .updateTable('staff_availability_ranges')
            .set({ valid_until: '2027-01-04' })
            .where('staff_id', '=', person.staffId)
            .execute();
          const later = await t.database.migrator
            .insertInto('staff_availability')
            .values({ branch_id: branch, staff_id: person.staffId, valid_from: '2027-01-04' })
            .returning(['id', 'valid_until'])
            .executeTakeFirstOrThrow();
          await t.database.migrator
            .insertInto('staff_availability_ranges')
            .values({
              entry_id: later.id,
              branch_id: branch,
              staff_id: person.staffId,
              weekday: 1,
              start_minutes: 540,
              end_minutes: 1440,
              valid_from: '2027-01-04',
              valid_until: later.valid_until,
            })
            .execute();
          return person.staffId;
        },
      });
      await load.freeEditLock(s.version);
      const [entry] = await entryOf(s.version);
      const answer = checkOf(await check(s.branch, s.version, MONDAY));
      expect(answer.refusals).toEqual([]);
      const later = answer.warnings.filter((one) => one.rule === 'teacher_unavailable_later');
      // Every Monday of the quarters from the entry's start, by date; 4 January is in the vacation.
      expect(later.slice(0, 3)).toEqual(
        ['2027-01-11', '2027-01-18', '2027-01-25'].map((date) => ({
          rule: 'teacher_unavailable_later',
          severity: 'warning',
          weekday: 1,
          lessonIds: [entry],
          detail: { date },
          date,
        })),
      );
      expect(later.every((one) => (one.date ?? '') >= '2027-01-11')).toBe(true);
      expect(later.map((one) => one.date)).not.toContain('2027-03-22');
      expect(versionOf(await publish(s.branch, s.version, MONDAY)).status).toBe('published');
    });

    it('lists the lessons a shortened day cannot hold and does not refuse them', async () => {
      const s = await scene({ lessons: 2 });
      const second = await post(`/api/timetable/versions/${s.version}/pattern`, s.branch, {
        loadRowId: s.rowId,
        weekday: 1,
        slotPosition: 3,
      });
      expect(second.status, JSON.stringify(second.body)).toBe(201);
      const lesson = await t.createSlotType(s.branch, 'Short lesson', 'lesson', 30);
      const short = await t.createTemplate(s.branch, 'Short', [lesson]);
      await calendarEntry(s.branch, { kind: 'special_day', first: '2026-11-16', template: short });
      await load.freeEditLock(s.version);
      const [, late] = await entryOf(s.version);
      const answer = checkOf(await check(s.branch, s.version, MONDAY));
      expect(answer.refusals).toEqual([]);
      expect(answer.cancelledLessons).toEqual([
        { date: '2026-11-16', reason: 'not_in_template', entryIds: [late] },
      ]);
      expect(versionOf(await publish(s.branch, s.version, MONDAY)).status).toBe('published');
      // Task 5.5b-1 (decision 6): the first lesson at the short day's times,
      // the other written cancelled at its pattern times, with no claim.
      const day = (await lessonsOf(s.branch)).filter((one) => one.date === '2026-11-16');
      expect(
        day.map((one) => [one.starts_at, one.ends_at, one.cancel_cause, one.pattern_entry_id]),
      ).toEqual([
        [at('2026-11-16', '08:00'), at('2026-11-16', '08:30'), null, expect.any(String)],
        [at('2026-11-16', '08:55'), at('2026-11-16', '09:40'), 'not_in_template', late],
      ]);
      const claims = await t.database.migrator
        .selectFrom('time_claims')
        .select('lesson_id')
        .where(
          'lesson_id',
          'in',
          day.map((one) => one.id),
        )
        .execute();
      expect(claims.map((one) => one.lesson_id)).toEqual([day[0]?.id]);
    });

    it("lists a Saturday worked by Monday's timetable as needs a teacher for a teacher with no Saturday hours", async () => {
      const s = await scene();
      const regular = await t.database.migrator
        .selectFrom('day_template_assignments')
        .select('day_template_id')
        .where('branch_id', '=', s.branch)
        .executeTakeFirstOrThrow();
      await calendarEntry(s.branch, {
        kind: 'special_day',
        first: '2026-11-21',
        template: regular.day_template_id,
        follows: 1,
      });
      await load.freeEditLock(s.version);
      const [entry] = await entryOf(s.version);
      const answer = checkOf(await check(s.branch, s.version, MONDAY));
      expect(answer.refusals).toEqual([]);
      expect(answer.needsTeacher).toEqual([
        { date: '2026-11-21', entryId: entry, reason: 'not_available_real_day' },
      ]);
      // Task 5.5b-1 (spec review should-fix 7): Monday's lesson on the
      // Saturday, written with no teacher; the Mondays keep theirs.
      versionOf(await publish(s.branch, s.version, MONDAY));
      const written = await lessonsOf(s.branch);
      const saturday = written.filter((one) => one.date === '2026-11-21');
      expect(saturday).toEqual([
        expect.objectContaining({
          starts_at: at('2026-11-21', '08:00'),
          pattern_entry_id: entry,
          teacher_id: null,
          cancel_cause: null,
        }),
      ]);
      expect(
        written
          .filter((one) => one.date !== '2026-11-21')
          .every((one) => one.teacher_id === s.teacherId),
      ).toBe(true);
    });

    it("refuses the date whose special template moves a lesson outside the teacher's hours, that date only (review of #140)", async () => {
      // The teacher works 08:00–12:00; on Monday 23 November a special day's
      // template starts at 15:00 (edge/timetable, "The pattern is valid but
      // one date is not": "a special template that day").
      const s = await scene({ hoursRange: [480, 720] });
      const lesson = await t.database.migrator
        .selectFrom('slot_types')
        .select('id')
        .where('branch_id', '=', s.branch)
        .where('kind', '=', 'lesson')
        .executeTakeFirstOrThrow();
      const late = await t.createTemplate(s.branch, 'Afternoon', [lesson.id], '15:00');
      await calendarEntry(s.branch, { kind: 'special_day', first: '2026-11-23', template: late });
      await load.freeEditLock(s.version);
      const [entry] = await entryOf(s.version);
      const answer = checkOf(await check(s.branch, s.version, MONDAY));
      expect(answer.refusals).toEqual([
        {
          code: 'date_blocked',
          result: {
            rule: 'teacher_unavailable',
            severity: 'blocked',
            weekday: 1,
            date: '2026-11-23',
            lessonIds: [entry],
          },
        },
      ]);
      expect(answer.needsTeacher).toEqual([]);
      const before = await written([s.version]);
      expect(blockedBy(await publish(s.branch, s.version, MONDAY))).toEqual([
        { code: 'date_blocked', path: 'dates.2026-11-23.teacher_unavailable' },
      ]);
      expect(await written([s.version])).toEqual(before);
      // From the next day the version is clear and publishes.
      expect(checkOf(await check(s.branch, s.version, '2026-11-24')).refusals).toEqual([]);
      expect(versionOf(await publish(s.branch, s.version, '2026-11-24')).status).toBe('published');
    });

    it("refuses the date of another branch's exam the teacher invigilates, naming that branch only (review of #140)", async () => {
      const lessons = await LessonsKit.create(t.database.migrator);
      const other = await t.newBranch();
      const s = await scene({
        teacherFor: async (branch, subject) => {
          const person = await load.teacher(branch, {
            subjects: [{ subject, grades: [7] }],
            further: [other],
          });
          await hours(branch, person.staffId);
          return person.staffId;
        },
      });
      // The other branch's exam on Monday 30 November, 08:30–10:00, read
      // through teacher_claims_elsewhere (decision 2).
      const otherYear = await lessons.year(other);
      const sitting = await lessons.load.classes.schoolClass(other, otherYear.year, { grade: 7 });
      const room = await lessons.room(other);
      await t.app.get(Transactions).run([other], async (transaction) => {
        const exam = await transaction
          .insertInto('exams')
          .values({
            branch_id: other,
            academic_year_id: otherYear.year,
            exam_date: '2026-11-30',
            starts_at: at('2026-11-30', '08:30'),
            ends_at: at('2026-11-30', '10:00'),
            first_slot: 1,
            last_slot: 2,
            title: 'Quarter exam',
            subject_id: s.subject,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const examRoom = await transaction
          .insertInto('exam_rooms')
          .values({ branch_id: other, exam_id: exam.id, room_id: room })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('exam_room_classes')
          .values({
            branch_id: other,
            exam_id: exam.id,
            exam_room_id: examRoom.id,
            class_id: sitting,
          })
          .execute();
        await transaction
          .insertInto('exam_invigilators')
          .values({
            branch_id: other,
            exam_id: exam.id,
            exam_room_id: examRoom.id,
            staff_id: s.teacherId,
          })
          .execute();
      });
      await load.freeEditLock(s.version);
      const [entry] = await entryOf(s.version);
      const answer = checkOf(await check(s.branch, s.version, MONDAY));
      expect(answer.refusals).toEqual([
        {
          code: 'date_blocked',
          result: {
            rule: 'teacher_double',
            severity: 'blocked',
            weekday: 1,
            date: '2026-11-30',
            lessonIds: [entry],
            detail: { branchId: other },
          },
        },
      ]);
      const before = await written([s.version]);
      expect(blockedBy(await publish(s.branch, s.version, MONDAY))).toEqual([
        { code: 'date_blocked', path: 'dates.2026-11-30.teacher_double' },
      ]);
      expect(await written([s.version])).toEqual(before);
      expect(checkOf(await check(s.branch, s.version, '2026-12-01')).refusals).toEqual([]);
    });

    it('lists the lessons of a teacher who leaves after the start as needs a teacher; one gone before is refused', async () => {
      const s = await scene();
      await load.status(s.teacherId, 'left', '2027-05-24');
      await load.freeEditLock(s.version);
      const [entry] = await entryOf(s.version);
      const answer = checkOf(await check(s.branch, s.version, MONDAY));
      expect(answer.refusals).toEqual([]);
      expect(answer.needsTeacher).toEqual([
        { date: '2027-05-24', entryId: entry, reason: 'teacher_out' },
        { date: '2027-05-31', entryId: entry, reason: 'teacher_out' },
      ]);
      // A start on or after the leaving: the status on the start refuses, as in 5.5a-1.
      const late = checkOf(await check(s.branch, s.version, '2027-05-24'));
      expect(late.refusals.map((one) => one.code)).toContain('pattern_blocked');
      expect(late.needsTeacher).toEqual([]);
      expect(versionOf(await publish(s.branch, s.version, MONDAY)).status).toBe('published');
      // Task 5.5b-1: the lessons from the leaving have no teacher.
      const written = await lessonsOf(s.branch);
      expect(written.filter((one) => one.teacher_id === null).map((one) => one.date)).toEqual([
        '2027-05-24',
        '2027-05-31',
      ]);
      expect(written.find((one) => one.date === '2027-05-17')?.teacher_id).toBe(s.teacherId);
    });

    it('gives a Tutor lesson the Tutor of each date, and lists a clash of a later Tutor as needs a teacher', async () => {
      let account = '';
      const s = await scene({
        lessons: 2,
        placed: 2,
        teacherFor: async (branch, subject) => {
          const person = await load.teacher(branch, { subjects: [{ subject, grades: [7] }] });
          await hours(branch, person.staffId);
          account = person.accountId;
          return person.staffId;
        },
      });
      // Another class whose Tutor is a teacher free on Tuesdays until 16
      // November; from then the scene's teacher, who teaches at that time.
      const tutored = await load.classes.schoolClass(s.branch, s.year, {
        grade: 7,
        room: await load.classes.room(s.branch),
      });
      const first = await load.teacher(s.branch);
      await hours(s.branch, first.staffId);
      const changeover = new Date('2026-11-16T00:00:00+05:00');
      await load.tutorOf(s.branch, tutored, first.accountId, { until: changeover });
      await load.tutorOf(s.branch, tutored, account, { from: changeover });
      const tutorSubject = await load.tutorSubject({ grades: [7] });
      await t.database.migrator
        .updateTable('subjects')
        .set({ journal_type: 'attendance_only' })
        .where('id', '=', tutorSubject)
        .execute();
      const created = await post(`/api/timetable/versions/${s.version}/load`, s.branch, {
        classId: tutored,
        groupId: null,
        subjectId: tutorSubject,
        teacherId: null,
        lessonsPerWeek: 1,
        roomId: null,
        roomType: null,
        doubleLessons: false,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const tutorRow = (created.body as { id: string }).id;
      await placeAt(s.branch, s.version, tutorRow, 2);
      await confirmTemplates(s.branch, s.version);
      await load.freeEditLock(s.version);
      const tutorEntry = (
        await t.database.migrator
          .selectFrom('pattern_entries')
          .select('id')
          .where('load_row_id', '=', tutorRow)
          .executeTakeFirstOrThrow()
      ).id;
      const answer = checkOf(await check(s.branch, s.version, MONDAY));
      expect(answer.refusals).toEqual([]);
      const needs = answer.needsTeacher.filter((one) => one.entryId === tutorEntry);
      // Every Tuesday from 17 November, never before (the first Tutor is free).
      expect(needs[0]).toEqual({ date: '2026-11-17', entryId: tutorEntry, reason: 'tutor_clash' });
      expect(needs.every((one) => one.date >= '2026-11-17' && one.reason === 'tutor_clash')).toBe(
        true,
      );
      expect(versionOf(await publish(s.branch, s.version, MONDAY)).status).toBe('published');
      // Task 5.5b-1 (From 3.6c-2; spec review must-fix 8): the first Tutor
      // until 16 November, no teacher from the clash on.
      const tutorLessons = (await lessonsOf(s.branch)).filter((one) => one.class_id === tutored);
      expect(tutorLessons.map((one) => one.date)).toEqual(schoolDates(2, '2026-10-12'));
      for (const one of tutorLessons) {
        expect(one.teacher_id).toBe(one.date < '2026-11-17' ? first.staffId : null);
      }
    });
  });

  // Task 5.5a-2b-1, pull request #142: the impact preview and the transition
  // week (docs/spec/06-timetable.md, How surprises are prevented, Impact
  // preview; edge/timetable, Versions and drafts, "A version starts on a
  // Wednesday"). The week of Monday 19 October 2026 lies in quarter 1.
  describe('the impact preview and the transition week', () => {
    const NEXT_MONDAY = '2026-10-19';
    const WEDNESDAY = '2026-10-21';

    /** A draft of a scene's class with rows of the subjects and teachers named, placed on the weekdays named. */
    const draftOf = async (
      s: { branch: string; year: string; classId: string },
      rows: readonly { subject: string; teacherId: string; weekdays: readonly number[] }[],
    ) => {
      const version = await draft(s.branch, s.year);
      for (const row of rows) {
        const rowId = await load.row({
          branch_id: s.branch,
          version_id: version,
          class_id: s.classId,
          subject_id: row.subject,
          teacher_id: row.teacherId,
          lessons_per_week: row.weekdays.length,
        });
        for (const weekday of row.weekdays) {
          await placeAt(s.branch, version, rowId, weekday);
        }
      }
      await confirmTemplates(s.branch, version);
      return version;
    };

    const impactOf = async (branch: string, version: string, startsOn: string) => {
      const answer = checkOf(await check(branch, version, startsOn));
      expect(answer.refusals).toEqual([]);
      if (answer.impact === null) throw new Error('No impact.');
      return answer.impact;
    };

    it('lists every lesson of a first publish as created, with no earlier version', async () => {
      const s = await scene();
      // Another branch's published version is never read as the earlier one.
      const other = await scene();
      versionOf(await publish(other.branch, other.version, MONDAY));
      const impact = await impactOf(s.branch, s.version, MONDAY);
      expect(impact.beforeVersion).toBeNull();
      expect(impact.counts).toMatchObject({ moved: 0, removed: 0, changed: 0, unchanged: 0 });
      expect(impact.counts.created).toBeGreaterThan(20);
      expect(impact.changes).toHaveLength(1);
      expect(impact.changes[0]).toMatchObject({
        kind: 'created',
        unitId: s.classId,
        subjectId: s.subject,
        before: null,
        after: { weekday: 1, teacherIds: [s.teacherId] },
        count: impact.counts.created,
        firstDate: MONDAY,
      });
      expect(impact.classIds).toEqual([s.classId]);
      expect(impact.names.units.map((one) => one.id)).toEqual([s.classId]);
      expect(impact.teachers).toEqual([{ id: s.teacherId, vacancy: false, notified: true }]);
      expect(impact.transition).toBeNull();
    });

    it('lists a teacher change with the teachers affected and notified, and the lessons per week under a vacancy (Done when)', async () => {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, MONDAY));
      const second = await load.teacher(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
      });
      await hours(s.branch, second.staffId);
      // A person with no account, and a vacancy, each with a new subject.
      const art = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const music = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const noAccount = await load.teacher(s.branch, {
        subjects: [{ subject: art, grades: [7] }],
        noAccount: true,
      });
      await hours(s.branch, noAccount.staffId);
      const vacancy = await load.vacancy(s.branch, { subjects: [{ subject: music, grades: [7] }] });
      await hours(s.branch, vacancy);
      const version = await draftOf(s, [
        { subject: s.subject, teacherId: second.staffId, weekdays: [1] },
        { subject: art, teacherId: noAccount.staffId, weekdays: [2] },
        { subject: music, teacherId: vacancy, weekdays: [3] },
      ]);
      const impact = await impactOf(s.branch, version, NEXT_MONDAY);
      expect(impact.beforeVersion?.id).toBe(s.version);
      const changed = impact.changes.filter((one) => one.kind === 'changed');
      expect(changed).toHaveLength(1);
      expect(changed[0]).toMatchObject({
        unitId: s.classId,
        subjectId: s.subject,
        before: { weekday: 1, teacherIds: [s.teacherId] },
        after: { weekday: 1, teacherIds: [second.staffId] },
        firstDate: NEXT_MONDAY,
      });
      expect(impact.counts.changed).toBe(changed[0]?.count);
      expect(
        impact.changes
          .filter((one) => one.kind === 'created')
          .map((one) => one.subjectId)
          .sort(),
      ).toEqual([art, music].sort());
      expect([...impact.teachers].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
        [
          { id: s.teacherId, vacancy: false, notified: true },
          { id: second.staffId, vacancy: false, notified: true },
          { id: noAccount.staffId, vacancy: false, notified: false },
          { id: vacancy, vacancy: true, notified: false },
        ].sort((a, b) => a.id.localeCompare(b.id)),
      );
      expect(impact.vacancies).toEqual([{ id: vacancy, lessonsPerWeek: 1 }]);
      expect(impact.names.teachers.map((one) => one.id).sort()).toEqual(
        [s.teacherId, second.staffId, noAccount.staffId, vacancy].sort(),
      );
      expect(impact.transition).toBeNull();
      // A Monday start needs no acknowledgement; the audit entry keeps the counts.
      versionOf(await publish(s.branch, version, NEXT_MONDAY));
      const [entry] = await t.entries('timetable_version.publish', version);
      expect(entry?.new_value).toMatchObject({ impact: impact.counts });
      expect(entry?.new_value).not.toHaveProperty('transition');
    });

    it('names every class a changed group lesson draws from, with no lesson of its own changed (review of #142)', async () => {
      const s = await scene();
      const classB = await load.classes.schoolClass(s.branch, s.year, {
        grade: 7,
        room: await load.classes.room(s.branch),
      });
      const english = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const group = await load.classes.group(s.branch, s.year, english, [s.classId, classB]);
      const [first, second] = [
        (await load.teacher(s.branch, { subjects: [{ subject: english, grades: [7] }] })).staffId,
        (await load.teacher(s.branch, { subjects: [{ subject: english, grades: [7] }] })).staffId,
      ];
      await hours(s.branch, first);
      await hours(s.branch, second);
      /** A draft of the class row as published and the group row with the teacher given, on Tuesday. */
      const withGroup = async (teacherId: string) => {
        const version = await draftOf(s, [
          { subject: s.subject, teacherId: s.teacherId, weekdays: [1] },
        ]);
        const rowId = await load.row({
          branch_id: s.branch,
          version_id: version,
          group_id: group,
          subject_id: english,
          teacher_id: teacherId,
          lessons_per_week: 1,
        });
        await placeAt(s.branch, version, rowId, 2);
        await confirmTemplates(s.branch, version);
        return version;
      };
      versionOf(await publish(s.branch, await withGroup(first), MONDAY));
      const impact = await impactOf(s.branch, await withGroup(second), NEXT_MONDAY);
      // Only the teacher of the group lesson changed; the class's own lesson did not.
      expect(impact.changes.map((one) => [one.kind, one.unitId])).toEqual([['changed', group]]);
      expect(impact.counts).toMatchObject({ moved: 0, removed: 0, created: 0 });
      expect([...impact.classIds].sort()).toEqual([s.classId, classB].sort());
      const named = new Set(impact.names.units.map((one) => one.id));
      for (const id of [...impact.classIds, group]) expect(named.has(id), id).toBe(true);
    });

    it('shows the transition week of a Wednesday start against the load and needs its acknowledgement (Done when)', async () => {
      // The earlier version: Monday and Tuesday; the draft: Wednesday and Thursday.
      const s = await scene({ lessons: 2, placed: 2 });
      versionOf(await publish(s.branch, s.version, MONDAY));
      const version = await draftOf(s, [
        { subject: s.subject, teacherId: s.teacherId, weekdays: [3, 4] },
      ]);
      const impact = await impactOf(s.branch, version, WEDNESDAY);
      expect(impact.transition?.key).toMatch(/^[0-9a-f]{64}$/);
      expect(impact.transition).toMatchObject({
        weekStart: NEXT_MONDAY,
        weekEnd: '2026-10-25',
        rows: [
          {
            unitId: s.classId,
            subjectId: s.subject,
            before: 2,
            after: 2,
            lessonsPerWeek: 2,
            differs: true,
          },
        ],
      });
      const shown = impact.transition?.key ?? '';
      expect(blockedBy(await publish(s.branch, version, WEDNESDAY))).toEqual([
        { code: 'transition_unacknowledged', path: 'transition' },
      ]);
      expect((await versionRow(version)).status).toBe('draft');
      // The draft changes after the check: Thursday's lesson moves to Monday.
      const grid = await get(`/api/timetable/versions/${version}/grid`, s.branch);
      expect(grid.status, JSON.stringify(grid.body)).toBe(200);
      const thursday = (grid.body as { blocks: { id: string; weekday: number }[] }).blocks.find(
        (one) => one.weekday === 4,
      );
      if (thursday === undefined) throw new Error('No Thursday block.');
      const moved = await post(
        `/api/timetable/versions/${version}/pattern/${thursday.id}/move`,
        s.branch,
        { weekday: 1, slotPosition: 1 },
      );
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      // The key of what was shown no longer fits.
      expect(
        blockedBy(
          await publish(s.branch, version, WEDNESDAY, t.admin, randomUUID(), {
            transitionKey: shown,
          }),
        ),
      ).toEqual([{ code: 'transition_unacknowledged', path: 'transition' }]);
      const again = await impactOf(s.branch, version, WEDNESDAY);
      expect(again.transition?.rows).toEqual([
        expect.objectContaining({ before: 2, after: 1, lessonsPerWeek: 2, differs: true }),
      ]);
      const key = again.transition?.key ?? '';
      expect(key).not.toBe(shown);
      versionOf(
        await publish(s.branch, version, WEDNESDAY, t.admin, randomUUID(), { transitionKey: key }),
      );
      const [entry] = await t.entries('timetable_version.publish', version);
      expect(entry?.new_value).toMatchObject({
        transition: {
          weekStart: NEXT_MONDAY,
          acknowledged: [
            {
              unitId: s.classId,
              subjectId: s.subject,
              before: 2,
              after: 1,
              lessonsPerWeek: 2,
              differs: true,
            },
          ],
        },
      });
    });

    it('publishes a Wednesday start whose week matches the load without a key, an unchanged teacher not affected', async () => {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, MONDAY));
      const version = await draftOf(s, [
        { subject: s.subject, teacherId: s.teacherId, weekdays: [1] },
      ]);
      const impact = await impactOf(s.branch, version, WEDNESDAY);
      expect(impact.transition).toEqual({
        weekStart: NEXT_MONDAY,
        weekEnd: '2026-10-25',
        rows: [
          {
            unitId: s.classId,
            subjectId: s.subject,
            before: 1,
            after: 0,
            lessonsPerWeek: 1,
            differs: false,
          },
        ],
        key: null,
      });
      expect(impact.changes).toEqual([]);
      expect(impact.teachers).toEqual([]);
      expect(impact.counts.unchanged).toBeGreaterThan(20);
      versionOf(await publish(s.branch, version, WEDNESDAY));
    });

    it('reads each date of the week before the start from the version in force on it', async () => {
      // Version 1 from 12 October on Monday, version 2 from Tuesday 20 October
      // on Tuesday, the draft from Thursday 22 October on Friday.
      const s = await scene();
      versionOf(await publish(s.branch, s.version, MONDAY));
      const second = await draftOf(s, [
        { subject: s.subject, teacherId: s.teacherId, weekdays: [2] },
      ]);
      const secondImpact = await impactOf(s.branch, second, '2026-10-20');
      versionOf(
        await publish(s.branch, second, '2026-10-20', t.admin, randomUUID(), {
          transitionKey: secondImpact.transition?.key ?? '',
        }),
      );
      const third = await draftOf(s, [
        { subject: s.subject, teacherId: s.teacherId, weekdays: [5] },
      ]);
      const impact = await impactOf(s.branch, third, '2026-10-22');
      expect(impact.beforeVersion?.id).toBe(second);
      // Monday from version 1, Tuesday from version 2; Friday from the draft.
      expect(impact.transition?.rows).toEqual([
        expect.objectContaining({ before: 2, after: 1, lessonsPerWeek: 1, differs: true }),
      ]);
    });

    it('refuses the same request key with another transition key (permission review, should-fix 1)', async () => {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, MONDAY));
      const version = await draftOf(s, [
        { subject: s.subject, teacherId: s.teacherId, weekdays: [1] },
      ]);
      const key = randomUUID();
      versionOf(await publish(s.branch, version, WEDNESDAY, t.admin, key));
      const after = await written([version]);
      refusedWith(
        await publish(s.branch, version, WEDNESDAY, t.admin, key, {
          transitionKey: 'b'.repeat(64),
        }),
        409,
        'request_key_reused',
      );
      expect(await written([version])).toEqual(after);
    });

    it("reads only the own branch's earlier version, lessons and names when both branches have one (permission review, should-fix 3)", async () => {
      const s = await scene({ lessons: 2, placed: 2 });
      const other = await scene({ lessons: 2, placed: 2 });
      versionOf(await publish(s.branch, s.version, MONDAY));
      versionOf(await publish(other.branch, other.version, MONDAY));
      const second = await load.teacher(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
      });
      await hours(s.branch, second.staffId);
      const version = await draftOf(s, [
        { subject: s.subject, teacherId: second.staffId, weekdays: [3, 4] },
      ]);
      const impact = await impactOf(s.branch, version, WEDNESDAY);
      expect(impact.beforeVersion?.id).toBe(s.version);
      const own = new Set([s.classId, s.subject, s.teacherId, second.staffId, s.room]);
      const ids = [
        ...impact.changes.flatMap((one) => [
          one.unitId,
          one.subjectId,
          ...one.classIds,
          ...[one.before, one.after].flatMap((slot) =>
            slot === null
              ? []
              : [...slot.teacherIds, ...(slot.roomId === null ? [] : [slot.roomId])],
          ),
        ]),
        ...impact.teachers.map((one) => one.id),
        ...impact.classIds,
        ...impact.roomIds,
        ...(impact.transition?.rows ?? []).flatMap((row) => [row.unitId, row.subjectId]),
        ...impact.names.units.map((one) => one.id),
        ...impact.names.subjects.map((one) => one.id),
        ...impact.names.teachers.map((one) => one.id),
        ...impact.names.rooms.map((one) => one.id),
      ];
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.filter((id) => !own.has(id))).toEqual([]);
      // The earlier lessons are the own branch's only: two a week, as the own version has.
      expect(impact.transition?.rows).toEqual([
        expect.objectContaining({ before: 2, after: 2, lessonsPerWeek: 2 }),
      ]);
    });

    it('refuses a transition key that is not 64 lower hex', async () => {
      const s = await scene();
      refusedWith(
        await publish(s.branch, s.version, MONDAY, t.admin, randomUUID(), {
          transitionKey: 'ABC',
        }),
        400,
        'validation_failed',
      );
      expect((await versionRow(s.version)).status).toBe('draft');
    });

    // Task 5.5b-2, pull request #154: the preview from the stored lessons
    // (06, How surprises are prevented, Impact preview; edge/timetable,
    // Versions and drafts: "An unchanged lesson keeps its identity"). A write
    // to the stored lessons stands for a later one-day change; it runs in a
    // transaction of the application, with the moment that 0079 reads
    // (review correction 1).
    describe('from the stored lessons (task 5.5b-2)', () => {
      const directly = (branch: string, work: (transaction: Transaction) => Promise<unknown>) =>
        t.app.get(Transactions).run([branch], work);

      it('lists a lesson stored with no teacher the same on both sides, with no change, and a vacancy kept (Done when)', async () => {
        const s = await scene();
        // A teacher who leaves after the start: the expansion keeps the
        // teacher on those dates and the check lists them `teacher_out`, so
        // the publish writes them with no teacher (5.5b-1, decision 7).
        await load.status(s.teacherId, 'left', '2027-05-24');
        const music = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
        const vacancy = await load.vacancy(s.branch, {
          subjects: [{ subject: music, grades: [7] }],
        });
        await hours(s.branch, vacancy);
        const vacancyRow = await load.row({
          branch_id: s.branch,
          version_id: s.version,
          class_id: s.classId,
          subject_id: music,
          teacher_id: vacancy,
          lessons_per_week: 1,
        });
        await placeAt(s.branch, s.version, vacancyRow, 2);
        await confirmTemplates(s.branch, s.version);
        await load.freeEditLock(s.version);
        const first = checkOf(await check(s.branch, s.version, MONDAY));
        expect(first.refusals).toEqual([]);
        expect(
          first.needsTeacher.filter((one) => one.reason === 'teacher_out').map((one) => one.date),
        ).toEqual(['2027-05-24', '2027-05-31']);
        // The first publish's preview already shows what it writes: no teacher from the leaving.
        expect(
          first.impact?.changes
            .filter((one) => one.subjectId === s.subject)
            .map((one) => [one.after?.teacherIds, one.firstDate, one.lastDate]),
        ).toEqual([
          [[s.teacherId], MONDAY, '2027-05-17'],
          [[], '2027-05-24', '2027-05-31'],
        ]);
        // Review correction 3: the expansion itself still names the teacher on those dates.
        const raw = await t.app.get(Transactions).run([s.branch], async (transaction) => {
          const state = await t.app
            .get(TimetablePattern)
            .stateOf(
              transaction,
              await t.app.get(Timetable).versionRow(transaction, s.version),
              randomUUID(),
            );
          return (await datedLessonsOf(transaction, state, '2027-05-24', '2027-05-31')).dated
            .lessons;
        });
        expect(
          raw
            .filter((one) => one.placement.subjectId === s.subject)
            .map((one) => [one.date, one.placement.teacherIds]),
        ).toEqual([
          ['2027-05-24', [s.teacherId]],
          ['2027-05-31', [s.teacherId]],
        ]);
        versionOf(await publish(s.branch, s.version, MONDAY));
        const stored = await lessonsOf(s.branch);
        expect(
          stored
            .filter((one) => one.subject_id === s.subject && one.teacher_id === null)
            .map((one) => one.date),
        ).toEqual(['2027-05-24', '2027-05-31']);
        expect(
          stored
            .filter((one) => one.subject_id === music)
            .every((one) => one.teacher_id === vacancy),
        ).toBe(true);

        const version = await draftOf(s, [
          { subject: s.subject, teacherId: s.teacherId, weekdays: [1] },
          { subject: music, teacherId: vacancy, weekdays: [2] },
        ]);
        const impact = await impactOf(s.branch, version, NEXT_MONDAY);
        expect(impact.changes).toEqual([]);
        expect(impact.counts).toMatchObject({ created: 0, moved: 0, removed: 0, changed: 0 });
        // Every lesson from 19 October, of both rows, unchanged.
        expect(impact.counts.unchanged).toBe(
          stored.filter((one) => one.date >= NEXT_MONDAY && one.cancel_cause === null).length,
        );
        expect(impact.teachers).toEqual([]);
        expect(impact.vacancies).toEqual([{ id: vacancy, lessonsPerWeek: 1 }]);
      });

      it('keeps a stored lesson with a one-day cancel on the before side and leaves out one the expansion cancelled (decision 1)', async () => {
        const s = await scene();
        versionOf(await publish(s.branch, s.version, MONDAY));
        // 26 October cancelled with a reason, as a one-day change will; 16
        // November with a cause only the expansion writes.
        await directly(s.branch, async (transaction) => {
          await transaction
            .updateTable('lessons')
            .set({ cancel_cause: 'reason', cancel_reason: 'School concert' })
            .where('branch_id', '=', s.branch)
            .where('lesson_date', '=', '2026-10-26')
            .execute();
          await transaction
            .updateTable('lessons')
            .set({ cancel_cause: 'day_off' })
            .where('branch_id', '=', s.branch)
            .where('lesson_date', '=', '2026-11-16')
            .execute();
        });
        const stored = await lessonsOf(s.branch);
        expect(
          stored
            .filter((one) => one.cancel_cause !== null)
            .map((one) => [one.date, one.cancel_cause]),
        ).toEqual([
          ['2026-10-26', 'reason'],
          ['2026-11-16', 'day_off'],
        ]);
        const version = await draftOf(s, [
          { subject: s.subject, teacherId: s.teacherId, weekdays: [1] },
        ]);
        const impact = await impactOf(s.branch, version, NEXT_MONDAY);
        // The draft holds 16 November: its lesson is created, the one cancelled
        // by a reason pairs as a lesson held.
        expect(impact.changes).toHaveLength(1);
        expect(impact.changes[0]).toMatchObject({
          kind: 'created',
          count: 1,
          firstDate: '2026-11-16',
          lastDate: '2026-11-16',
        });
        expect(impact.counts).toMatchObject({ created: 1, moved: 0, removed: 0, changed: 0 });
        expect(impact.counts.unchanged).toBe(
          stored.filter((one) => one.date >= NEXT_MONDAY && one.date !== '2026-11-16').length,
        );
      });

      it('reads the room a stored lesson has, and the publish writes the change the preview lists', async () => {
        const s = await scene();
        versionOf(await publish(s.branch, s.version, MONDAY));
        const room2 = await load.classes.room(s.branch);
        await directly(s.branch, (transaction) =>
          transaction
            .updateTable('lessons')
            .set({ room_id: room2 })
            .where('branch_id', '=', s.branch)
            .where('lesson_date', '=', '2026-10-26')
            .execute(),
        );
        const moved = (await lessonsOf(s.branch)).find((one) => one.date === '2026-10-26');
        expect(moved?.room_id).toBe(room2);
        const version = await draftOf(s, [
          { subject: s.subject, teacherId: s.teacherId, weekdays: [1] },
        ]);
        const impact = await impactOf(s.branch, version, NEXT_MONDAY);
        expect(impact.changes).toHaveLength(1);
        expect(impact.changes[0]).toMatchObject({
          kind: 'changed',
          unitId: s.classId,
          subjectId: s.subject,
          before: { roomId: room2 },
          after: { roomId: s.room },
          count: 1,
          firstDate: '2026-10-26',
          lastDate: '2026-10-26',
        });
        expect(impact.roomIds).toEqual([room2, s.room].sort());
        versionOf(await publish(s.branch, version, NEXT_MONDAY));
        const [entry] = await t.entries('timetable_version.publish', version);
        expect(entry?.new_value).toMatchObject({
          datedLessons: {
            changed: [
              {
                id: moved?.id,
                teacherId: { from: s.teacherId, to: s.teacherId },
                roomId: { from: room2, to: s.room },
              },
            ],
          },
        });
      });

      it('gives a Tutor lesson of a clash no teacher on the after side, as written, and no change on the next preview', async () => {
        let account = '';
        const s = await scene({
          lessons: 2,
          placed: 2,
          teacherFor: async (branch, subject) => {
            const person = await load.teacher(branch, { subjects: [{ subject, grades: [7] }] });
            await hours(branch, person.staffId);
            account = person.accountId;
            return person.staffId;
          },
        });
        // As in "gives a Tutor lesson the Tutor of each date": from 16
        // November the other class's Tutor is the scene's teacher, who
        // teaches at that time on Tuesdays.
        const tutored = await load.classes.schoolClass(s.branch, s.year, {
          grade: 7,
          room: await load.classes.room(s.branch),
        });
        const firstTutor = await load.teacher(s.branch);
        await hours(s.branch, firstTutor.staffId);
        const changeover = new Date('2026-11-16T00:00:00+05:00');
        await load.tutorOf(s.branch, tutored, firstTutor.accountId, { until: changeover });
        await load.tutorOf(s.branch, tutored, account, { from: changeover });
        const tutorSubject = await load.tutorSubject({ grades: [7] });
        await t.database.migrator
          .updateTable('subjects')
          .set({ journal_type: 'attendance_only' })
          .where('id', '=', tutorSubject)
          .execute();
        /** The Tutor row of a version, placed on Tuesday. */
        const tutorRowOf = async (version: string) => {
          const created = await post(`/api/timetable/versions/${version}/load`, s.branch, {
            classId: tutored,
            groupId: null,
            subjectId: tutorSubject,
            teacherId: null,
            lessonsPerWeek: 1,
            roomId: null,
            roomType: null,
            doubleLessons: false,
          });
          expect(created.status, JSON.stringify(created.body)).toBe(201);
          await placeAt(s.branch, version, (created.body as { id: string }).id, 2);
          await confirmTemplates(s.branch, version);
          await load.freeEditLock(version);
        };
        await tutorRowOf(s.version);
        const first = await impactOf(s.branch, s.version, MONDAY);
        // The first publish's after side: the first Tutor until 16 November, none from the clash.
        expect(
          first.changes
            .filter((one) => one.subjectId === tutorSubject)
            .map((one) => [one.after?.teacherIds, one.firstDate]),
        ).toEqual([
          [[firstTutor.staffId], '2026-10-13'],
          [[], '2026-11-17'],
        ]);
        versionOf(await publish(s.branch, s.version, MONDAY));
        const written = (await lessonsOf(s.branch)).filter((one) => one.class_id === tutored);
        expect(written.filter((one) => one.teacher_id === null).map((one) => one.date)[0]).toBe(
          '2026-11-17',
        );

        const version = await draftOf(s, [
          { subject: s.subject, teacherId: s.teacherId, weekdays: [1, 2] },
        ]);
        await tutorRowOf(version);
        const impact = await impactOf(s.branch, version, NEXT_MONDAY);
        expect(impact.changes).toEqual([]);
        expect(impact.counts).toMatchObject({ created: 0, moved: 0, removed: 0, changed: 0 });
      });

      it('counts the stored lessons of the week before a Thursday start, none cancelled', async () => {
        const s = await scene({ lessons: 3, placed: 3 });
        versionOf(await publish(s.branch, s.version, MONDAY));
        // Monday 19 October is after today (10 October): 0079 lets it go.
        await directly(s.branch, async (transaction) => {
          const monday = await transaction
            .selectFrom('lessons')
            .select('block_id')
            .where('branch_id', '=', s.branch)
            .where('lesson_date', '=', NEXT_MONDAY)
            .executeTakeFirstOrThrow();
          await transaction.deleteFrom('lessons').where('block_id', '=', monday.block_id).execute();
          await transaction.deleteFrom('lesson_blocks').where('id', '=', monday.block_id).execute();
          await transaction
            .updateTable('lessons')
            .set({ cancel_cause: 'reason', cancel_reason: 'School concert' })
            .where('branch_id', '=', s.branch)
            .where('lesson_date', '=', '2026-10-20')
            .execute();
        });
        const week = (await lessonsOf(s.branch)).filter(
          (one) => one.date >= NEXT_MONDAY && one.date <= '2026-10-25',
        );
        expect(week.map((one) => [one.date, one.cancel_cause])).toEqual([
          ['2026-10-20', 'reason'],
          ['2026-10-21', null],
        ]);
        const version = await draftOf(s, [
          { subject: s.subject, teacherId: s.teacherId, weekdays: [4, 5] },
        ]);
        const impact = await impactOf(s.branch, version, '2026-10-22');
        // Wednesday only; from the pattern it would be 3.
        expect(impact.transition?.rows).toEqual([
          expect.objectContaining({ before: 1, after: 2, lessonsPerWeek: 2, differs: true }),
        ]);
      });

      it('reads a version with no stored lessons from its pattern, never as an empty timetable', async () => {
        const s = await scene({ lessons: 2, placed: 2 });
        versionOf(await publish(s.branch, s.version, MONDAY));
        // As a version published before 0079: every date is after today.
        await directly(s.branch, async (transaction) => {
          await transaction.deleteFrom('lessons').where('branch_id', '=', s.branch).execute();
          await transaction.deleteFrom('lesson_blocks').where('branch_id', '=', s.branch).execute();
        });
        expect(await lessonsOf(s.branch)).toEqual([]);
        const version = await draftOf(s, [
          { subject: s.subject, teacherId: s.teacherId, weekdays: [1, 2] },
        ]);
        const impact = await impactOf(s.branch, version, WEDNESDAY);
        expect(impact.counts).toMatchObject({ created: 0, moved: 0, removed: 0, changed: 0 });
        expect(impact.counts.unchanged).toBeGreaterThan(40);
        expect(impact.changes).toEqual([]);
        expect(impact.transition?.rows).toEqual([
          expect.objectContaining({ before: 2, after: 0, lessonsPerWeek: 2, differs: false }),
        ]);
      });
    });
  });

  // Task 5.5a-2b-2, pull request #143: the lessons kept on a shortened day
  // (edge/time-dates-calendar, "A shortened day has 5 lesson slots and a class
  // has 7 lessons that weekday": "The Academic Vice Principal can choose which
  // lessons are kept"). On Monday 16 November a special day has two lessons of
  // 30 minutes from 08:00; the class has three lessons on Mondays: two of one
  // subject at positions 1 and 3, one of another at position 5.
  describe('the lessons kept on a shortened day', () => {
    const SHORT_DATE = '2026-11-16';

    const keep = (
      branch: string,
      version: string,
      body: { classId: string; date: string; slotPositions: number[] },
      cookie = t.admin,
    ) => t.put(`/api/timetable/versions/${version}/day-keeps`, branch, body, cookie);

    const keepsOf = (versions: readonly string[]) =>
      t.database.migrator
        .selectFrom('timetable_day_keeps')
        .select([
          'version_id',
          'class_id',
          sql<string>`kept_on::text`.as('kept_on'),
          'slot_position',
        ])
        .where('version_id', 'in', versions)
        .orderBy('version_id')
        .orderBy('class_id')
        .orderBy('kept_on')
        .orderBy('slot_position')
        .execute();

    /** Every row of the choices in the branches named, each column. */
    const allKeeps = (branches: readonly string[]) =>
      t.database.migrator
        .selectFrom('timetable_day_keeps')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('id')
        .execute();

    const storeKeep = (
      branch: string,
      version: string,
      classId: string,
      date: string,
      slot: number,
    ) =>
      t.database.migrator
        .insertInto('timetable_day_keeps')
        .values({
          branch_id: branch,
          version_id: version,
          class_id: classId,
          kept_on: date,
          slot_position: slot,
        })
        .execute();

    const placeSlot = async (
      branch: string,
      version: string,
      loadRowId: string,
      slotPosition: number,
    ) => {
      const placed = await post(`/api/timetable/versions/${version}/pattern`, branch, {
        loadRowId,
        weekday: 1,
        slotPosition,
      });
      expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    };

    const entriesOf = async (version: string) =>
      (
        await t.database.migrator
          .selectFrom('pattern_entries')
          .select('id')
          .where('version_id', '=', version)
          .orderBy('weekday')
          .orderBy('start_minutes')
          .execute()
      ).map((one) => one.id);

    /** The scene of the describe: rows A (two lessons) and B (one lesson) of the class, the short day. */
    async function shortScene() {
      const s = await scene({ lessons: 2 });
      await placeSlot(s.branch, s.version, s.rowId, 3);
      const other = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const second = (await load.teacher(s.branch, { subjects: [{ subject: other, grades: [7] }] }))
        .staffId;
      await hours(s.branch, second);
      const rowB = await load.row({
        branch_id: s.branch,
        version_id: s.version,
        class_id: s.classId,
        subject_id: other,
        teacher_id: second,
        lessons_per_week: 1,
      });
      await placeSlot(s.branch, s.version, rowB, 5);
      const lesson = await t.createSlotType(s.branch, 'Short lesson', 'lesson', 30);
      const short = await t.createTemplate(s.branch, 'Short', [lesson, lesson]);
      await t.database.migrator
        .insertInto('calendar_entries')
        .values({
          branch_id: s.branch,
          kind: 'special_day',
          name: 'Short day',
          first_date: SHORT_DATE,
          last_date: SHORT_DATE,
          day_template_id: short,
        })
        .execute();
      await confirmTemplates(s.branch, s.version);
      const [first, secondA, onlyB] = await entriesOf(s.version);
      return { ...s, other, second, rowB, first, secondA, onlyB };
    }

    it('keeps the lesson chosen in place of the last one, and the check, the cancelled list and the preview follow (Done when)', async () => {
      const s = await shortScene();
      const before = checkOf(await check(s.branch, s.version, MONDAY));
      expect(before.refusals).toEqual([]);
      expect(before.shortenedDays).toEqual([
        {
          date: SHORT_DATE,
          classId: s.classId,
          lessonSlots: 2,
          lessons: [
            { slotPosition: 1, entryIds: [s.first] },
            { slotPosition: 3, entryIds: [s.secondA] },
            { slotPosition: 5, entryIds: [s.onlyB] },
          ],
          kept: [1, 3],
          chosen: false,
          missingPositions: [],
        },
      ]);
      expect(before.cancelledLessons).toEqual([
        { date: SHORT_DATE, reason: 'not_in_template', entryIds: [s.onlyB] },
      ]);

      const saved = await keep(s.branch, s.version, {
        classId: s.classId,
        date: SHORT_DATE,
        slotPositions: [5, 1],
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect(saved.body).toEqual({ classId: s.classId, date: SHORT_DATE, slotPositions: [1, 5] });
      const [entry] = await t.entries('timetable_version.day_keep', s.version);
      expect(entry).toMatchObject({
        request_id: saved.headers['x-request-id'],
        old_value: { classId: s.classId, date: SHORT_DATE, slotPositions: [] },
        new_value: { classId: s.classId, date: SHORT_DATE, slotPositions: [1, 5] },
      });

      const after = checkOf(await check(s.branch, s.version, MONDAY));
      expect(after.refusals).toEqual([]);
      expect(after.shortenedDays).toEqual([
        expect.objectContaining({ kept: [1, 5], chosen: true, missingPositions: [] }),
      ]);
      expect(after.cancelledLessons).toEqual([
        { date: SHORT_DATE, reason: 'not_in_template', entryIds: [s.secondA] },
      ]);
      // The kept lesson of the other subject takes the second slot of the day (08:30).
      const created = (after.impact?.changes ?? []).filter(
        (one) =>
          one.kind === 'created' && one.firstDate === SHORT_DATE && one.lastDate === SHORT_DATE,
      );
      expect(created.map((one) => [one.subjectId, one.after?.start])).toEqual(
        expect.arrayContaining([
          [s.subject, 480],
          [s.other, 510],
        ]),
      );
      expect(created.some((one) => one.subjectId === s.subject && one.after?.start === 510)).toBe(
        false,
      );
      expect(versionOf(await publish(s.branch, s.version, MONDAY)).status).toBe('published');
    });

    it('refuses the date where the lesson kept meets a clash only it makes (the dated check follows)', async () => {
      const s = await shortScene();
      // Class 7b has one lesson with the second teacher at position 3: on the
      // short day it is the second lesson, 08:30.
      const room = await load.classes.room(s.branch);
      const otherClass = await load.classes.schoolClass(s.branch, s.year, { grade: 7, room });
      const rowC = await load.row({
        branch_id: s.branch,
        version_id: s.version,
        class_id: otherClass,
        subject_id: s.other,
        teacher_id: s.second,
        lessons_per_week: 1,
      });
      await placeSlot(s.branch, s.version, rowC, 3);
      await confirmTemplates(s.branch, s.version);
      expect(checkOf(await check(s.branch, s.version, MONDAY)).refusals).toEqual([]);
      const saved = await keep(s.branch, s.version, {
        classId: s.classId,
        date: SHORT_DATE,
        slotPositions: [1, 5],
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const refusals = checkOf(await check(s.branch, s.version, MONDAY)).refusals;
      expect(refusals.length).toBeGreaterThan(0);
      expect(
        refusals.every((one) => one.code === 'date_blocked' && one.result?.date === SHORT_DATE),
      ).toBe(true);
      expect(refusals.map((one) => one.result?.lessonIds.slice().sort())).toContainEqual(
        [
          s.onlyB,
          (await entriesOf(s.version)).find((id) => ![s.first, s.secondA, s.onlyB].includes(id)),
        ].sort(),
      );
    });

    it('refuses a choice for today, a day that is not shortened, a slot that is no lesson, and too many lessons, changing nothing', async () => {
      const s = await shortScene();
      const choose = (date: string, slotPositions: number[]) =>
        keep(s.branch, s.version, { classId: s.classId, date, slotPositions });
      const unchanged = async () => [await allKeeps([s.branch]), await t.auditCount()];
      const start = await unchanged();
      refusedWith(await choose(TODAY, [1]), 409, 'day_keep_date_passed');
      // Not shortened: every lesson fits; a vacation date; a day with no lessons of the class.
      refusedWith(await choose('2026-11-23', [1]), 409, 'day_keep_not_short');
      refusedWith(await choose('2026-11-03', [1]), 409, 'day_keep_not_short');
      refusedWith(await choose('2026-11-17', [1]), 409, 'day_keep_not_short');
      refusedWith(await choose(SHORT_DATE, [1, 7]), 409, 'day_keep_lessons');
      refusedWith(await choose(SHORT_DATE, [1, 3, 5]), 409, 'day_keep_over_slots');
      refusedWith(await choose(SHORT_DATE, [1, 1]), 400, 'validation_failed');
      expect(await unchanged()).toEqual(start);
    });

    it('removes a choice with an empty list on any date: no longer shortened, before the start, past', async () => {
      const s = await shortScene();
      for (const date of ['2026-11-23', TOMORROW, '2026-10-05']) {
        await storeKeep(s.branch, s.version, s.classId, date, 1);
      }
      for (const date of ['2026-11-23', TOMORROW, '2026-10-05']) {
        const removed = await keep(s.branch, s.version, {
          classId: s.classId,
          date,
          slotPositions: [],
        });
        expect(removed.status, JSON.stringify(removed.body)).toBe(200);
        expect(removed.body).toEqual({ classId: s.classId, date, slotPositions: [] });
      }
      expect(await keepsOf([s.version])).toEqual([]);
      expect(await t.entries('timetable_version.day_keep', s.version)).toHaveLength(3);
    });

    it('lists a stored choice that decides nothing as unused, and writes nothing for the same choice again', async () => {
      const s = await shortScene();
      await storeKeep(s.branch, s.version, s.classId, '2026-11-23', 1);
      const answer = checkOf(await check(s.branch, s.version, MONDAY));
      expect(answer.unusedKeeps).toEqual([{ date: '2026-11-23', classId: s.classId }]);
      const body = { classId: s.classId, date: SHORT_DATE, slotPositions: [1, 5] };
      expect((await keep(s.branch, s.version, body)).status).toBe(200);
      const count = await t.auditCount();
      expect((await keep(s.branch, s.version, body)).status).toBe(200);
      expect(await t.auditCount()).toBe(count);
    });

    it('refuses a draft another account edits, and a published version', async () => {
      const s = await shortScene();
      const body = { classId: s.classId, date: SHORT_DATE, slotPositions: [1, 5] };
      const holder = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', 'teacher')
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .updateTable('timetable_versions')
        .set({ edit_holder_id: holder.account_id, edit_seen_at: t.clock.now() })
        .where('id', '=', s.version)
        .execute();
      refusedWith(await keep(s.branch, s.version, body), 409, 'draft_edit_locked');
      await load.freeEditLock(s.version);
      expect(versionOf(await publish(s.branch, s.version, MONDAY)).status).toBe('published');
      refusedWith(await keep(s.branch, s.version, body), 409, 'version_not_draft');
      expect(await keepsOf([s.version])).toEqual([]);
    });

    it('refuses a choice in a closed year (permission review, should-fix 5)', async () => {
      const s = await shortScene();
      await load.classes.setYear(s.year, 'closed');
      refusedWith(
        await keep(s.branch, s.version, {
          classId: s.classId,
          date: SHORT_DATE,
          slotPositions: [1, 5],
        }),
        409,
        'timetable_year_closed',
      );
      expect(await keepsOf([s.version])).toEqual([]);
    });

    it("answers 404 for another branch's or an unknown version or class, changing nothing", async () => {
      const s = await shortScene();
      const o = await shortScene();
      for (const one of [s, o]) {
        const saved = await keep(one.branch, one.version, {
          classId: one.classId,
          date: SHORT_DATE,
          slotPositions: [1, 5],
        });
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      }
      // Permission review, must-fix 2: the edit lock is free, so a call that
      // reached the lock would write it; every version row is compared.
      await load.freeEditLock(s.version);
      await load.freeEditLock(o.version);
      const unchanged = async () => [
        await allKeeps([s.branch, o.branch]),
        await t.database.migrator
          .selectFrom('timetable_versions')
          .selectAll()
          .where('branch_id', 'in', [s.branch, o.branch])
          .orderBy('id')
          .execute(),
        await t.auditCount(),
      ];
      const start = await unchanged();
      for (const [version, classId] of [
        [o.version, s.classId],
        [UNKNOWN, s.classId],
        [s.version, o.classId],
        [s.version, UNKNOWN],
      ] as const) {
        for (const slotPositions of [[1, 3], []]) {
          refusedWith(
            await keep(s.branch, version, { classId, date: SHORT_DATE, slotPositions }),
            404,
            'not_found',
          );
        }
      }
      expect(await unchanged()).toEqual(start);
    });

    it('carries the choices of the classes a copy keeps, and names the others in its audit entry (decision 12)', async () => {
      const s = await shortScene();
      expect(
        (
          await keep(s.branch, s.version, {
            classId: s.classId,
            date: SHORT_DATE,
            slotPositions: [1, 5],
          })
        ).status,
      ).toBe(200);
      const empty = await load.classes.schoolClass(s.branch, s.year, { grade: 7 });
      await storeKeep(s.branch, s.version, empty, SHORT_DATE, 3);
      const copy = await draft(s.branch, s.year, s.version);
      expect(await keepsOf([copy])).toEqual([
        { version_id: copy, class_id: s.classId, kept_on: SHORT_DATE, slot_position: 1 },
        { version_id: copy, class_id: s.classId, kept_on: SHORT_DATE, slot_position: 5 },
      ]);
      const [entry] = await t.entries('timetable_version.create', copy);
      expect(entry).toMatchObject({
        new_value: {
          copiedDayKeeps: [
            { classId: s.classId, date: SHORT_DATE, slotPosition: 1 },
            { classId: s.classId, date: SHORT_DATE, slotPosition: 5 },
          ],
          leftDayKeeps: [{ classId: empty, date: SHORT_DATE, slotPosition: 3 }],
        },
      });
    });

    it("compares a draft with the published version's own choice (decision 9)", async () => {
      const s = await shortScene();
      const body = { classId: s.classId, date: SHORT_DATE, slotPositions: [1, 5] };
      expect((await keep(s.branch, s.version, body)).status).toBe(200);
      expect(versionOf(await publish(s.branch, s.version, MONDAY)).status).toBe('published');
      // The next draft, copied with the choice and placed the same way.
      const next = await draft(s.branch, s.year, s.version);
      const rows = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select(['id', 'subject_id'])
        .where('version_id', '=', next)
        .execute();
      const rowA = rows.find((one) => one.subject_id === s.subject)?.id ?? '';
      const rowB = rows.find((one) => one.subject_id === s.other)?.id ?? '';
      await placeSlot(s.branch, next, rowA, 1);
      await placeSlot(s.branch, next, rowA, 3);
      await placeSlot(s.branch, next, rowB, 5);
      await confirmTemplates(s.branch, next);
      const onShortDay = (answer: PublishCheck) =>
        (answer.impact?.changes ?? []).filter((one) => one.firstDate === SHORT_DATE);
      const same = checkOf(await check(s.branch, next, '2026-10-19'));
      expect(same.impact?.beforeVersion?.id).toBe(s.version);
      expect(onShortDay(same)).toEqual([]);
      expect((await keep(s.branch, next, { ...body, slotPositions: [] })).status).toBe(200);
      const cleared = checkOf(await check(s.branch, next, '2026-10-19'));
      expect(onShortDay(cleared).map((one) => [one.kind, one.subjectId])).toEqual(
        expect.arrayContaining([['removed', s.other]]),
      );
    });
  });
  // Task 5.5b-1, pull request #152: the dated lessons a publish writes
  // (docs/spec/06-timetable.md, Model, Dated lesson: "On publishing, dated
  // lessons are created up to the end of the academic year ... Days off
  // produce no lessons"; edge/timetable, Versions and drafts: "An unchanged
  // lesson keeps its identity ... Only real differences are created or
  // removed"; How surprises are prevented: "Publishing or regenerating cannot
  // change any lesson dated today or earlier"). The scene's day: 08:00–08:45,
  // 08:55–09:40, 09:50–10:35.
  describe('the dated lessons written', () => {
    const calendarEntry = (
      branch: string,
      values: {
        kind: 'day_off' | 'special_day';
        first: string;
        template?: string;
        examWeek?: boolean;
      },
    ) =>
      t.database.migrator
        .insertInto('calendar_entries')
        .values({
          branch_id: branch,
          kind: values.kind,
          name: values.kind === 'day_off' ? 'Holiday' : 'Exam week',
          first_date: values.first,
          last_date: values.first,
          day_template_id: values.template ?? null,
          exam_week: values.examWeek === true ? 'no_regular_lessons' : null,
        })
        .execute();

    const regularOf = async (branch: string) =>
      (
        await t.database.migrator
          .selectFrom('day_template_assignments')
          .select('day_template_id')
          .where('branch_id', '=', branch)
          .executeTakeFirstOrThrow()
      ).day_template_id;

    const placeSlot = async (
      branch: string,
      version: string,
      loadRowId: string,
      weekday: number,
      slotPosition: number,
      extra: object = {},
    ) => {
      const placed = await post(`/api/timetable/versions/${version}/pattern`, branch, {
        loadRowId,
        weekday,
        slotPosition,
        ...extra,
      });
      expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    };

    /** The one load row of a copy of `from`, unplaced. */
    const copyOf = async (branch: string, year: string, from: string) => {
      const copy = await draft(branch, year, from);
      const row = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', copy)
        .executeTakeFirstOrThrow();
      return { copy, rowId: row.id };
    };

    const publishEntryOf = async (version: string) =>
      (await t.entries('timetable_version.publish', version))[0]?.new_value as {
        datedLessons: {
          firstDate: string;
          lastDate: string;
          created: number;
          kept: number;
          cancelled: number;
          removed: { id: string }[];
          changed: { id: string; teacherId: { from: string | null; to: string | null } }[];
        };
      };

    it('writes one lesson per school date from the start to the end of the year, with its moments, quarter and claim', async () => {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, MONDAY));
      const written = await lessonsOf(s.branch);
      // Every Monday of the four quarters from 12 October: none in the vacations.
      expect(written.map((one) => one.date)).toEqual(schoolDates(1, MONDAY));
      const quarters = await t.database.migrator
        .selectFrom('quarters')
        .select(['id', 'number'])
        .where('academic_year_id', '=', s.year)
        .execute();
      const quarterOf = (date: string) => {
        const index = QUARTERS.findIndex(([start, end]) => start <= date && date <= end);
        return quarters.find((one) => one.number === index + 1)?.id;
      };
      const [entry] = await t.database.migrator
        .selectFrom('pattern_entries')
        .select(['id', 'room_id'])
        .where('version_id', '=', s.version)
        .execute();
      for (const one of written) {
        expect(one).toMatchObject({
          starts_at: at(one.date, '08:00'),
          ends_at: at(one.date, '08:45'),
          class_id: s.classId,
          subject_id: s.subject,
          load_row_id: s.rowId,
          pattern_entry_id: entry?.id,
          teacher_id: s.teacherId,
          room_id: entry?.room_id ?? null,
          cancel_cause: null,
          version_id: s.version,
          quarter_id: quarterOf(one.date),
          double_pair_id: null,
        });
      }
      const claims = await t.database.migrator
        .selectFrom('time_claims')
        .select(['lesson_id', 'teacher_id'])
        .where('branch_id', '=', s.branch)
        .where('kind', '=', 'lesson')
        .execute();
      expect(claims.map((one) => one.lesson_id).sort()).toEqual(
        written.map((one) => one.id).sort(),
      );
      expect((await publishEntryOf(s.version)).datedLessons).toEqual({
        firstDate: MONDAY,
        lastDate: '2027-05-31',
        created: written.length,
        kept: 0,
        cancelled: 0,
        removed: [],
        changed: [],
      });
    });

    it('starts a version on a Wednesday: no lesson on the Monday and Tuesday before it (Done when)', async () => {
      const s = await scene({ lessons: 3, placed: 3 });
      const wednesday = '2026-10-14';
      const answer = checkOf(await check(s.branch, s.version, wednesday));
      const transitionKey = answer.impact?.transition?.key;
      versionOf(
        await publish(s.branch, s.version, wednesday, t.admin, randomUUID(), {
          ...(transitionKey === undefined || transitionKey === null ? {} : { transitionKey }),
        }),
      );
      const dates = (await lessonsOf(s.branch)).map((one) => one.date);
      expect(dates.filter((one) => one < '2026-10-19')).toEqual([wednesday]);
      expect(dates.filter((one) => one >= '2026-10-19' && one < '2026-10-26')).toEqual([
        '2026-10-19',
        '2026-10-20',
        '2026-10-21',
      ]);
      expect(dates).toEqual(
        [
          ...schoolDates(1, wednesday),
          ...schoolDates(2, wednesday),
          ...schoolDates(3, wednesday),
        ].sort(),
      );
    });

    // Second opinion of round 2: a second version from a Wednesday over stored
    // lessons; the Monday and Tuesday of its week keep the earlier version's rows.
    it('publishes a second version from a Wednesday over stored lessons: Monday and Tuesday of its week stay the earlier version', async () => {
      const s = await scene({ lessons: 3, placed: 3 });
      versionOf(await publish(s.branch, s.version, MONDAY));
      const before = await lessonsOf(s.branch);
      const wednesday = '2026-10-21';
      const next = await copyOf(s.branch, s.year, s.version);
      for (const weekday of [3, 4, 5]) await placeSlot(s.branch, next.copy, next.rowId, weekday, 1);
      await confirmTemplates(s.branch, next.copy);
      await load.freeEditLock(next.copy);
      const answer = checkOf(await check(s.branch, next.copy, wednesday));
      const transitionKey = answer.impact?.transition?.key;
      versionOf(
        await publish(s.branch, next.copy, wednesday, t.admin, randomUUID(), {
          ...(transitionKey === undefined || transitionKey === null ? {} : { transitionKey }),
        }),
      );
      const after = await lessonsOf(s.branch);
      const wasOn = (date: string) => before.find((one) => one.date === date);
      const isOn = (date: string) => after.find((one) => one.date === date);
      // Before the start: the earlier version's rows, untouched.
      for (const date of ['2026-10-19', '2026-10-20']) {
        expect(isOn(date)).toEqual(wasOn(date));
        expect(isOn(date)?.version_id).toBe(s.version);
      }
      // The Wednesday in the same slot: kept, re-pointed to the new version.
      expect(isOn(wednesday)?.id).toBe(wasOn(wednesday)?.id);
      expect(isOn(wednesday)?.version_id).toBe(next.copy);
      // Thursday and Friday created; the later Mondays and Tuesdays removed.
      for (const date of ['2026-10-22', '2026-10-23']) {
        expect(wasOn(date)).toBeUndefined();
        expect(isOn(date)?.version_id).toBe(next.copy);
      }
      expect(
        after
          .filter((one) => one.date >= '2026-10-26' && one.date < '2026-11-02')
          .map((one) => one.date),
      ).toEqual(['2026-10-28', '2026-10-29', '2026-10-30']);
    });

    it('writes no lesson on a holiday inside a week, and the whole week on either side (Done when)', async () => {
      const s = await scene({ lessons: 3, placed: 3 });
      await calendarEntry(s.branch, { kind: 'day_off', first: '2026-10-20' });
      await load.freeEditLock(s.version);
      versionOf(await publish(s.branch, s.version, MONDAY));
      const dates = (await lessonsOf(s.branch)).map((one) => one.date);
      expect(dates.filter((one) => one < '2026-11-01')).toEqual([
        '2026-10-12',
        '2026-10-13',
        '2026-10-14',
        '2026-10-19',
        '2026-10-21',
        '2026-10-26',
        '2026-10-27',
        '2026-10-28',
      ]);
    });

    it('writes the lessons of a week with no regular lessons cancelled "exam week", with no claim', async () => {
      const s = await scene();
      await calendarEntry(s.branch, {
        kind: 'special_day',
        first: '2026-11-23',
        template: await regularOf(s.branch),
        examWeek: true,
      });
      await load.freeEditLock(s.version);
      versionOf(await publish(s.branch, s.version, MONDAY));
      const day = (await lessonsOf(s.branch)).filter((one) => one.date === '2026-11-23');
      expect(day).toEqual([
        expect.objectContaining({
          starts_at: at('2026-11-23', '08:00'),
          cancel_cause: 'exam_week',
          teacher_id: s.teacherId,
        }),
      ]);
      const claims = await t.database.migrator
        .selectFrom('time_claims')
        .select('id')
        .where('lesson_id', '=', day[0]?.id ?? '')
        .execute();
      expect(claims).toEqual([]);
      expect((await publishEntryOf(s.version)).datedLessons.cancelled).toBe(1);
    });

    it('keeps a vacancy on its lessons, as their teacher', async () => {
      let vacancy = '';
      const s = await scene({
        teacherFor: async (branch, subject) => {
          vacancy = await load.vacancy(branch, { subjects: [{ subject, grades: [7] }] });
          await hours(branch, vacancy);
          return vacancy;
        },
      });
      versionOf(await publish(s.branch, s.version, MONDAY));
      const written = await lessonsOf(s.branch);
      expect(written.length).toBeGreaterThan(0);
      expect(written.every((one) => one.teacher_id === vacancy)).toBe(true);
    });

    /** The claims of a branch's lessons and blocks: kind, lesson, block, class and teacher. */
    const claimsOf = async (branch: string) =>
      (
        await t.database.migrator
          .selectFrom('time_claims')
          .select(['kind', 'lesson_id', 'block_id', 'class_id', 'teacher_id'])
          .where('branch_id', '=', branch)
          .execute()
      )
        .map((one) =>
          one.kind === 'lesson'
            ? `lesson|${one.lesson_id ?? ''}|${one.teacher_id ?? ''}`
            : `${one.kind}|${one.block_id ?? ''}|${one.class_id ?? ''}`,
        )
        .sort();

    /** The claims the lessons of a branch should hold: one per lesson with its teacher, one per class of each block. */
    const claimsWanted = (
      lessons: Awaited<ReturnType<typeof lessonsOf>>,
      classesOf: (one: Awaited<ReturnType<typeof lessonsOf>>[number]) => readonly string[],
    ) => {
      const blockClasses = new Set<string>();
      const wanted: string[] = [];
      for (const one of lessons) {
        wanted.push(`lesson|${one.id}|${one.teacher_id ?? ''}`);
        for (const classId of classesOf(one))
          blockClasses.add(`block_class|${one.block_id}|${classId}`);
      }
      return [...wanted, ...blockClasses].sort();
    };

    const deleteRow = async (branch: string, version: string, rowId: string) => {
      const deleted = await request(t.kit.server)
        .delete(`/api/timetable/versions/${version}/load/${rowId}`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, branch);
      expect(deleted.status, JSON.stringify(deleted.body)).toBe(204);
    };

    // Review of #152, finding 4: the paths of blocks of several lessons
    // (`.claude/rules/api.md`, each branch of a function that chooses where
    // rows go). Parallel groups of English: G1 of class A, G2 of class B and
    // G3 across both, one block of the load (3.4b decision 2), on Wednesday
    // at 08:00. Without G3, G1 and G2 are two blocks of their own at 08:00.
    it('keeps a block of three groups on a republish, then splits it: one group keeps the block, the other moves to a block of its own, the third is removed', async () => {
      const s = await scene();
      const classB = await load.classes.schoolClass(s.branch, s.year, { grade: 7 });
      const english = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const groups = [
        await load.classes.group(s.branch, s.year, english, [s.classId]),
        await load.classes.group(s.branch, s.year, english, [classB]),
        await load.classes.group(s.branch, s.year, english, [s.classId, classB]),
      ];
      const teachers: string[] = [];
      while (teachers.length < groups.length) {
        const person = (
          await load.teacher(s.branch, { subjects: [{ subject: english, grades: [7] }] })
        ).staffId;
        await hours(s.branch, person);
        teachers.push(person);
      }
      const rowsOf = async (version: string) =>
        t.database.migrator
          .selectFrom('teaching_load_rows')
          .select(['id', 'group_id'])
          .where('version_id', '=', version)
          .where('subject_id', '=', english)
          .execute();
      for (const [index, group] of groups.entries()) {
        await load.row({
          branch_id: s.branch,
          version_id: s.version,
          group_id: group,
          subject_id: english,
          teacher_id: teachers[index] ?? '',
          lessons_per_week: 1,
        });
      }
      const [first] = await rowsOf(s.version);
      await placeSlot(s.branch, s.version, first?.id ?? '', 3, 1);
      await confirmTemplates(s.branch, s.version);
      await load.freeEditLock(s.version);
      versionOf(await publish(s.branch, s.version, MONDAY));
      const classesOf = (one: { class_id: string | null; group_id: string | null }) =>
        one.class_id !== null
          ? [one.class_id]
          : one.group_id === groups[0]
            ? [s.classId]
            : one.group_id === groups[1]
              ? [classB]
              : [s.classId, classB];
      const englishOf = async () =>
        (await lessonsOf(s.branch)).filter((one) => one.subject_id === english);
      const one = await englishOf();
      // One block of three lessons per Wednesday (a pairing of the load as one block).
      const wednesdays = schoolDates(3, MONDAY);
      expect([...new Set(one.map((lesson) => lesson.date))]).toEqual(wednesdays);
      for (const date of wednesdays) {
        const day = one.filter((lesson) => lesson.date === date);
        expect(day.map((lesson) => lesson.group_id).sort()).toEqual([...groups].sort());
        expect(new Set(day.map((lesson) => lesson.block_id)).size).toBe(1);
      }
      expect(await claimsOf(s.branch)).toEqual(claimsWanted(await lessonsOf(s.branch), classesOf));

      // The same block again from 19 October: every lesson and block stays,
      // re-pointed to the copy.
      const again = await draft(s.branch, s.year, s.version);
      for (const row of await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', again)
        .where('subject_id', '=', s.subject)
        .execute()) {
        await placeAt(s.branch, again, row.id, 1);
      }
      const [againFirst] = await rowsOf(again);
      await placeSlot(s.branch, again, againFirst?.id ?? '', 3, 1);
      await confirmTemplates(s.branch, again);
      await load.freeEditLock(again);
      versionOf(await publish(s.branch, again, '2026-10-19'));
      const two = await englishOf();
      expect(two.map((lesson) => [lesson.id, lesson.block_id])).toEqual(
        one.map((lesson) => [lesson.id, lesson.block_id]),
      );
      for (const lesson of two.filter((x) => x.date >= '2026-10-19')) {
        expect(lesson.version_id).toBe(again);
      }
      expect(await claimsOf(s.branch)).toEqual(claimsWanted(await lessonsOf(s.branch), classesOf));

      // From 26 October without G3: G1 and G2 each a block of its own at 08:00.
      const split = await draft(s.branch, s.year, again);
      for (const row of await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', split)
        .where('subject_id', '=', s.subject)
        .execute()) {
        await placeAt(s.branch, split, row.id, 1);
      }
      const splitRows = await rowsOf(split);
      const rowOfGroup = (group: string | undefined) =>
        splitRows.find((row) => row.group_id === group)?.id ?? '';
      await deleteRow(s.branch, split, rowOfGroup(groups[2]));
      await placeSlot(s.branch, split, rowOfGroup(groups[0]), 3, 1);
      await placeSlot(s.branch, split, rowOfGroup(groups[1]), 3, 1);
      await confirmTemplates(s.branch, split);
      await load.freeEditLock(split);
      // Task 5.6a-1 (build decision): a one-day cancel of both groups on the
      // first Wednesday from 26 October stays on the lesson kept and on the
      // one created again in another block.
      const cancelledOn = wednesdays.find((day) => day >= '2026-10-26') ?? '';
      const cancelled = two
        .filter((lesson) => lesson.date === cancelledOn)
        .map((lesson) => lesson.id);
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: 'Excursion to the museum' })
        .where('id', 'in', cancelled)
        .execute();
      // Task 5.6a-5a: the one-day cancels shown go back with the publish.
      const days = checkOf(await check(s.branch, split, '2026-10-26')).impact?.dayChanges;
      versionOf(
        await publish(s.branch, split, '2026-10-26', t.admin, randomUUID(), {
          dayChangesKey: days?.key ?? '',
        }),
      );
      const causes = await t.database.migrator
        .selectFrom('lessons')
        .select([
          'group_id',
          'cancel_cause',
          'cancel_reason',
          sql<string>`lesson_date::text`.as('date'),
        ])
        .where('branch_id', '=', s.branch)
        .where('subject_id', '=', english)
        .where('lesson_date', '>=', '2026-10-26')
        .execute();
      for (const row of causes) {
        expect(row, row.date).toMatchObject(
          row.date === cancelledOn
            ? { cancel_cause: 'reason', cancel_reason: 'Excursion to the museum' }
            : { cancel_cause: null, cancel_reason: null },
        );
      }
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: null, cancel_reason: null })
        .where('branch_id', '=', s.branch)
        .where('lesson_date', '=', cancelledOn)
        .where('subject_id', '=', english)
        .execute();
      const three = await englishOf();
      expect(three.filter((lesson) => lesson.date < '2026-10-26')).toEqual(
        two.filter((lesson) => lesson.date < '2026-10-26'),
      );
      const removed: string[] = [];
      for (const date of wednesdays.filter((day) => day >= '2026-10-26')) {
        const before = two.filter((lesson) => lesson.date === date);
        const after = three.filter((lesson) => lesson.date === date);
        const [block] = new Set(before.map((lesson) => lesson.block_id));
        expect(after.map((lesson) => lesson.group_id).sort()).toEqual(
          [groups[0], groups[1]].sort(),
        );
        expect(after.map((lesson) => lesson.starts_at)).toEqual([
          at(date, '08:00'),
          at(date, '08:00'),
        ]);
        // Two blocks: one is the stored block, with its lesson kept; the
        // other is new, its lesson created again (a lesson never changes
        // block, 0058).
        expect(new Set(after.map((lesson) => lesson.block_id)).size).toBe(2);
        const kept = after.filter((lesson) => lesson.block_id === block);
        const moved = after.filter((lesson) => lesson.block_id !== block);
        expect(kept).toHaveLength(1);
        expect(moved).toHaveLength(1);
        expect(before.find((lesson) => lesson.id === kept[0]?.id)?.group_id).toBe(
          kept[0]?.group_id,
        );
        expect(before.some((lesson) => lesson.id === moved[0]?.id)).toBe(false);
        expect(after.every((lesson) => lesson.version_id === split)).toBe(true);
        removed.push(
          ...before
            .filter((lesson) => !after.some((x) => x.id === lesson.id))
            .map((lesson) => lesson.id),
        );
      }
      // G3's lesson out of the kept block, and the moved group's old lesson.
      const audit = (await publishEntryOf(split)).datedLessons;
      expect(audit.removed.map((x) => x.id).sort()).toEqual(removed.sort());
      expect(await claimsOf(s.branch)).toEqual(claimsWanted(await lessonsOf(s.branch), classesOf));
    });

    // Review of #152, finding 4: class A's physical education and technology
    // each split into two mixed halves (5.4c-3b). A pairing is one block of
    // two lessons; the splits again put a new lesson into a kept block and
    // take a stored one out of it.
    it('writes a pairing as one block of two lessons, keeps it on a republish, and moves one half of each block when the splits come back', async () => {
      const s = await scene();
      const pe = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const tech = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const teacherOf = async (subject: string) => {
        const person = (await load.teacher(s.branch, { subjects: [{ subject, grades: [7] }] }))
          .staffId;
        await hours(s.branch, person);
        return person;
      };
      // A coach for each half, so that the split can sit in one slot.
      const coach = await teacherOf(pe);
      const coachB = await teacherOf(pe);
      const techA = await teacherOf(tech);
      const techB = await teacherOf(tech);
      const peBoysGroup = await load.classes.group(s.branch, s.year, pe, [s.classId]);
      const peGirlsGroup = await load.classes.group(s.branch, s.year, pe, [s.classId]);
      const techBoysGroup = await load.classes.group(s.branch, s.year, tech, [s.classId]);
      const techGirlsGroup = await load.classes.group(s.branch, s.year, tech, [s.classId]);
      const halves: [string, string, string][] = [
        [peBoysGroup, pe, coach],
        [peGirlsGroup, pe, coachB],
        [techBoysGroup, tech, techA],
        [techGirlsGroup, tech, techB],
      ];
      const rowsIn = async (version: string) => {
        const rows = await t.database.migrator
          .selectFrom('teaching_load_rows')
          .select(['id', 'group_id'])
          .where('version_id', '=', version)
          .execute();
        return (group: string) => rows.find((row) => row.group_id === group)?.id ?? '';
      };
      for (const [group, subject, teacherId] of halves) {
        await load.row({
          branch_id: s.branch,
          version_id: s.version,
          group_id: group,
          subject_id: subject,
          teacher_id: teacherId,
          lessons_per_week: 1,
          mixed_block: true,
        });
      }
      const pairings = async (version: string) => {
        const rowOf = await rowsIn(version);
        await placeSlot(s.branch, version, rowOf(peBoysGroup), 3, 1, {
          partnerRowId: rowOf(techGirlsGroup),
        });
        await placeSlot(s.branch, version, rowOf(peGirlsGroup), 3, 3, {
          partnerRowId: rowOf(techBoysGroup),
        });
      };
      await pairings(s.version);
      await confirmTemplates(s.branch, s.version);
      await load.freeEditLock(s.version);
      versionOf(await publish(s.branch, s.version, MONDAY));
      const groupsOf = (lessons: Awaited<ReturnType<typeof lessonsOf>>, block: string) =>
        lessons
          .filter((one) => one.block_id === block)
          .map((one) => one.group_id)
          .sort();
      const blocksOf = (lessons: Awaited<ReturnType<typeof lessonsOf>>, date: string) => {
        const day = lessons.filter((one) => one.date === date && one.group_id !== null);
        const at8 = day.find((one) => one.starts_at.getTime() === at(date, '08:00').getTime());
        const at9 = day.find((one) => one.starts_at.getTime() === at(date, '08:55').getTime());
        return { first: at8?.block_id ?? '', second: at9?.block_id ?? '' };
      };
      const classesOf = () => [s.classId];
      const one = await lessonsOf(s.branch);
      const wednesdays = schoolDates(3, MONDAY);
      for (const date of wednesdays) {
        const { first, second } = blocksOf(one, date);
        expect(groupsOf(one, first)).toEqual([peBoysGroup, techGirlsGroup].sort());
        expect(groupsOf(one, second)).toEqual([peGirlsGroup, techBoysGroup].sort());
      }
      expect(await claimsOf(s.branch)).toEqual(claimsWanted(one, classesOf));

      // The same pairings from 19 October: every lesson and block stays.
      const again = await draft(s.branch, s.year, s.version);
      const againRow = await rowsIn(again);
      await placeAt(
        s.branch,
        again,
        (
          await t.database.migrator
            .selectFrom('teaching_load_rows')
            .select('id')
            .where('version_id', '=', again)
            .where('subject_id', '=', s.subject)
            .executeTakeFirstOrThrow()
        ).id,
        1,
      );
      expect(againRow(peBoysGroup)).not.toBe('');
      await pairings(again);
      await confirmTemplates(s.branch, again);
      await load.freeEditLock(again);
      versionOf(await publish(s.branch, again, '2026-10-19'));
      const two = await lessonsOf(s.branch);
      expect(two.map((x) => [x.id, x.block_id])).toEqual(one.map((x) => [x.id, x.block_id]));
      expect(await claimsOf(s.branch)).toEqual(claimsWanted(two, classesOf));

      // From 26 October the two splits: physical education at 08:00,
      // technology at 08:55. Each stored block is kept by the half that stays
      // in its slot; the other half of each block is created in the other.
      const splits = await draft(s.branch, s.year, again);
      const rowOf = await rowsIn(splits);
      await placeAt(
        s.branch,
        splits,
        (
          await t.database.migrator
            .selectFrom('teaching_load_rows')
            .select('id')
            .where('version_id', '=', splits)
            .where('subject_id', '=', s.subject)
            .executeTakeFirstOrThrow()
        ).id,
        1,
      );
      await placeSlot(s.branch, splits, rowOf(peBoysGroup), 3, 1);
      await placeSlot(s.branch, splits, rowOf(techBoysGroup), 3, 3);
      await confirmTemplates(s.branch, splits);
      await load.freeEditLock(splits);
      versionOf(await publish(s.branch, splits, '2026-10-26'));
      const three = await lessonsOf(s.branch);
      expect(three.filter((x) => x.date < '2026-10-26')).toEqual(
        two.filter((x) => x.date < '2026-10-26'),
      );
      for (const date of wednesdays.filter((day) => day >= '2026-10-26')) {
        const was = blocksOf(two, date);
        const now = blocksOf(three, date);
        // The blocks stay, with the new halves.
        expect(now).toEqual(was);
        expect(groupsOf(three, now.first)).toEqual([peBoysGroup, peGirlsGroup].sort());
        expect(groupsOf(three, now.second)).toEqual([techBoysGroup, techGirlsGroup].sort());
        const idOf = (lessons: typeof three, group: string) =>
          lessons.find((x) => x.date === date && x.group_id === group)?.id;
        // The halves that stayed in their slot keep their lessons.
        expect(idOf(three, peBoysGroup)).toBe(idOf(two, peBoysGroup));
        expect(idOf(three, techBoysGroup)).toBe(idOf(two, techBoysGroup));
        // The halves that changed slot are created again.
        expect(idOf(three, peGirlsGroup)).not.toBe(idOf(two, peGirlsGroup));
        expect(idOf(three, techGirlsGroup)).not.toBe(idOf(two, techGirlsGroup));
      }
      expect(await claimsOf(s.branch)).toEqual(claimsWanted(three, classesOf));
    });

    it('writes a double as two blocks of one pair per date, keeps it on a republish, and clears it when undone', async () => {
      const s = await scene({ lessons: 2, placed: 0 });
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ double_lessons: true })
        .where('id', '=', s.rowId)
        .execute();
      await placeSlot(s.branch, s.version, s.rowId, 1, 1, { double: true });
      await confirmTemplates(s.branch, s.version);
      await load.freeEditLock(s.version);
      versionOf(await publish(s.branch, s.version, MONDAY));
      const first = await lessonsOf(s.branch);
      const byDate = new Map<string, typeof first>();
      for (const one of first) byDate.set(one.date, [...(byDate.get(one.date) ?? []), one]);
      const pairs = new Set<string | null>();
      for (const [date, day] of byDate) {
        expect(day.map((one) => one.starts_at)).toEqual([at(date, '08:00'), at(date, '08:55')]);
        expect(day[0]?.double_pair_id).not.toBeNull();
        expect(day[1]?.double_pair_id).toBe(day[0]?.double_pair_id);
        expect(day[0]?.block_id).not.toBe(day[1]?.block_id);
        pairs.add(day[0]?.double_pair_id ?? null);
      }
      // A pair of its own on each date (0058 counts a pair across all dates).
      expect(pairs.size).toBe(byDate.size);

      // The same double again from 19 October: the blocks and their pairs stay.
      const again = await copyOf(s.branch, s.year, s.version);
      await placeSlot(s.branch, again.copy, again.rowId, 1, 1, { double: true });
      await confirmTemplates(s.branch, again.copy);
      await load.freeEditLock(again.copy);
      versionOf(await publish(s.branch, again.copy, '2026-10-19'));
      const second = await lessonsOf(s.branch);
      expect(second.map((one) => [one.id, one.block_id, one.double_pair_id])).toEqual(
        first.map((one) => [one.id, one.block_id, one.double_pair_id]),
      );

      // Two single lessons in the same slots from 26 October: no pair any more.
      const undone = await copyOf(s.branch, s.year, again.copy);
      await placeSlot(s.branch, undone.copy, undone.rowId, 1, 1);
      await placeSlot(s.branch, undone.copy, undone.rowId, 1, 3);
      await confirmTemplates(s.branch, undone.copy);
      await load.freeEditLock(undone.copy);
      versionOf(await publish(s.branch, undone.copy, '2026-10-26'));
      const third = await lessonsOf(s.branch);
      expect(third.map((one) => one.id)).toEqual(first.map((one) => one.id));
      for (const one of third) {
        expect(one.double_pair_id).toBe(
          one.date < '2026-10-26' ? first.find((was) => was.id === one.id)?.double_pair_id : null,
        );
      }
    });

    it('keeps the unchanged lessons of a second version, changes a teacher and a room in place, and moves a lesson (06, What a change does)', async () => {
      const s = await scene({ lessons: 2, placed: 2 });
      versionOf(await publish(s.branch, s.version, MONDAY));
      const before = await lessonsOf(s.branch);
      const second = (
        await load.teacher(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] })
      ).staffId;
      await hours(s.branch, second);
      const room2 = await load.classes.room(s.branch);
      const next = await copyOf(s.branch, s.year, s.version);
      const edited = await t.patch(
        `/api/timetable/versions/${next.copy}/load/${next.rowId}`,
        s.branch,
        {
          teacherId: second,
          lessonsPerWeek: 2,
          roomId: null,
          roomType: null,
          doubleLessons: false,
        },
        t.admin,
      );
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      // Monday in the same slot, Tuesday moved to the second lesson slot.
      await placeSlot(s.branch, next.copy, next.rowId, 1, 1);
      await placeSlot(s.branch, next.copy, next.rowId, 2, 3);
      const monday = await t.database.migrator
        .selectFrom('pattern_entries')
        .select(['id', 'block_id'])
        .where('version_id', '=', next.copy)
        .where('weekday', '=', 1)
        .executeTakeFirstOrThrow();
      const roomed = await post(
        `/api/timetable/versions/${next.copy}/pattern/${monday.block_id}/room`,
        s.branch,
        { lessonId: monday.id, roomId: room2 },
      );
      expect(roomed.status, JSON.stringify(roomed.body)).toBe(200);
      await confirmTemplates(s.branch, next.copy);
      await load.freeEditLock(next.copy);
      versionOf(await publish(s.branch, next.copy, '2026-10-19'));

      const after = await lessonsOf(s.branch);
      // Before the start: as they were.
      expect(after.filter((one) => one.date < '2026-10-19')).toEqual(
        before.filter((one) => one.date < '2026-10-19'),
      );
      const mondaysBefore = before
        .filter((one) => one.date >= '2026-10-19' && one.date.length > 0)
        .filter((one) => new Date(`${one.date}T00:00:00Z`).getUTCDay() === 1);
      const mondaysAfter = after
        .filter((one) => one.date >= '2026-10-19')
        .filter((one) => new Date(`${one.date}T00:00:00Z`).getUTCDay() === 1);
      expect(mondaysAfter.map((one) => [one.id, one.block_id])).toEqual(
        mondaysBefore.map((one) => [one.id, one.block_id]),
      );
      for (const one of mondaysAfter) {
        expect(one).toMatchObject({
          version_id: next.copy,
          load_row_id: next.rowId,
          pattern_entry_id: monday.id,
          teacher_id: second,
          room_id: room2,
        });
      }
      const tuesdaysBefore = before.filter(
        (one) => one.date >= '2026-10-19' && new Date(`${one.date}T00:00:00Z`).getUTCDay() === 2,
      );
      const tuesdaysAfter = after.filter(
        (one) => one.date >= '2026-10-19' && new Date(`${one.date}T00:00:00Z`).getUTCDay() === 2,
      );
      expect(tuesdaysAfter.map((one) => one.date)).toEqual(tuesdaysBefore.map((one) => one.date));
      for (const one of tuesdaysAfter) {
        expect(one.starts_at).toEqual(at(one.date, '08:55'));
        expect(tuesdaysBefore.some((was) => was.id === one.id)).toBe(false);
      }
      // The audit keeps every value before (decision 12).
      const audit = (await publishEntryOf(next.copy)).datedLessons;
      expect(audit).toMatchObject({
        firstDate: '2026-10-19',
        created: tuesdaysAfter.length,
        kept: mondaysAfter.length,
      });
      expect(audit.removed).toEqual(
        tuesdaysBefore.map((one) => ({
          id: one.id,
          date: one.date,
          startsAt: one.starts_at.toISOString(),
          endsAt: one.ends_at.toISOString(),
          classId: s.classId,
          groupId: null,
          subjectId: s.subject,
          teacherId: s.teacherId,
          roomId: one.room_id,
          cancelCause: null,
        })),
      );
      expect(audit.changed).toEqual(
        mondaysBefore.map((one) => ({
          id: one.id,
          teacherId: { from: s.teacherId, to: second },
          roomId: { from: one.room_id, to: room2 },
        })),
      );
    });

    it('keeps both lessons of one subject on a shortened day with a choice when the same pattern is published again (spec review must-fix 1)', async () => {
      // Three lessons of one row on Monday (slots 1, 3 and 5); on 16 November
      // a day of two 45-minute slots at the regular times keeps the first and
      // the third: the third takes the second slot, 08:55, where the second,
      // not kept, is written cancelled at its own pattern times, 08:55 too.
      const s = await scene({ lessons: 3 });
      await placeSlot(s.branch, s.version, s.rowId, 1, 3);
      await placeSlot(s.branch, s.version, s.rowId, 1, 5);
      const lesson = await t.createSlotType(s.branch, 'Exam lesson', 'lesson', 45);
      const pause = await t.createSlotType(s.branch, 'Exam break', 'break', 10);
      const short = await t.createTemplate(s.branch, 'Two lessons', [lesson, pause, lesson]);
      await calendarEntry(s.branch, { kind: 'special_day', first: '2026-11-16', template: short });
      await confirmTemplates(s.branch, s.version);
      const kept = await t.put(
        `/api/timetable/versions/${s.version}/day-keeps`,
        s.branch,
        { classId: s.classId, date: '2026-11-16', slotPositions: [1, 5] },
        t.admin,
      );
      expect(kept.status, JSON.stringify(kept.body)).toBe(200);
      await load.freeEditLock(s.version);
      versionOf(await publish(s.branch, s.version, MONDAY));
      const day = (await lessonsOf(s.branch)).filter((one) => one.date === '2026-11-16');
      expect(
        day
          .map((one) => [one.starts_at, one.cancel_cause] as const)
          .sort(
            (x, y) => x[0].getTime() - y[0].getTime() || (x[1] ?? '').localeCompare(y[1] ?? ''),
          ),
      ).toEqual([
        [at('2026-11-16', '08:00'), null],
        [at('2026-11-16', '08:55'), null],
        [at('2026-11-16', '08:55'), 'not_in_template'],
      ]);

      const again = await copyOf(s.branch, s.year, s.version);
      for (const slot of [1, 3, 5]) await placeSlot(s.branch, again.copy, again.rowId, 1, slot);
      await confirmTemplates(s.branch, again.copy);
      await load.freeEditLock(again.copy);
      versionOf(await publish(s.branch, again.copy, '2026-10-19'));
      const after = (await lessonsOf(s.branch)).filter((one) => one.date === '2026-11-16');
      expect(after.map((one) => [one.id, one.starts_at, one.cancel_cause])).toEqual(
        day.map((one) => [one.id, one.starts_at, one.cancel_cause]),
      );
      const audit = (await publishEntryOf(again.copy)).datedLessons;
      expect(audit).toMatchObject({ created: 0, removed: [], changed: [] });
    });

    it("refuses by date another branch's later version published through the route, from its stored lessons (From 5.5a-2a)", async () => {
      // A teacher of two branches: here until 09:00, there from 09:00, 30
      // minutes of travel. The other branch publishes from 16 November with
      // its lesson at 09:00, 15 minutes after this branch's ends.
      const a = await scene({ hoursRange: [0, 540] });
      const b = await scene({
        startTime: '09:00',
        teacherFor: async (branch, subject) => {
          await t.database.migrator
            .insertInto('staff_branches')
            .values({ staff_id: a.teacherId, branch_id: branch, is_main: false })
            .execute();
          await load.profile(a.teacherId, [{ subject, grades: [7] }]);
          await hours(branch, a.teacherId, [540, 1440]);
          return a.teacherId;
        },
      });
      const [low = '', high = ''] = [a.branch, b.branch].sort();
      await t.database.migrator
        .insertInto('travel_times')
        .values({ branch_low: low, branch_high: high, minutes: 30 })
        .execute();
      await load.freeEditLock(b.version);
      versionOf(await publish(b.branch, b.version, '2026-11-16'));
      await load.freeEditLock(a.version);
      const answer = checkOf(await check(a.branch, a.version, MONDAY));
      const dated = answer.refusals.filter((one) => one.code === 'date_blocked');
      expect(dated.map((one) => one.result?.date)).toEqual(schoolDates(1, '2026-11-16'));
      expect(
        dated.every(
          (one) =>
            one.result?.rule === 'travel_time' && one.result.detail?.['branchId'] === b.branch,
        ),
      ).toBe(true);
    });
  });

  // Task 5.5c-1, pull request #155: edge/timetable, Versions and drafts:
  // "Journals are created and closed at publish. There is one journal per
  // class or group and subject in a year; adding a removed subject again
  // reopens its journal." 06, What a change does to existing data: "Subject
  // added to a class during the year ... A new journal starts on that date";
  // "Subject removed from a class ... The journal is closed and stays
  // readable". A journal's runs are the days the published load has it
  // (decision 3), the last with no end (decision 10).
  describe('the journals', () => {
    const journalsOf = (branch: string) =>
      t.database.migrator
        .selectFrom('journals')
        .select(['id', 'class_id', 'group_id', 'subject_id', sql<string>`runs::text`.as('runs')])
        .where('branch_id', '=', branch)
        .orderBy('id')
        .execute();
    const runsOf = async (
      branch: string,
      unit: { classId?: string; groupId?: string },
      subject: string,
    ) =>
      (await journalsOf(branch))
        .filter(
          (one) =>
            one.subject_id === subject &&
            one.class_id === (unit.classId ?? null) &&
            one.group_id === (unit.groupId ?? null),
        )
        .map((one) => one.runs);

    /** A copy of `from` with every row placed, row `i` (by id) on weekday `i + 1`, its templates confirmed. */
    const placedAll = async (branch: string, year: string, from: string) => {
      const copy = await draft(branch, year, from);
      const rows = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', copy)
        .orderBy('id')
        .execute();
      for (const [index, row] of rows.entries()) {
        await placeAt(branch, copy, row.id, index + 1);
      }
      await confirmTemplates(branch, copy);
      return copy;
    };

    /** A second subject of the scene's class with its own teacher, as a row of `version`. */
    const withArt = async (s: { branch: string; classId: string }, version: string) => {
      const art = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const teacher = (await load.teacher(s.branch, { subjects: [{ subject: art, grades: [7] }] }))
        .staffId;
      await hours(s.branch, teacher);
      const rowId = await load.row({
        branch_id: s.branch,
        version_id: version,
        class_id: s.classId,
        subject_id: art,
        teacher_id: teacher,
        lessons_per_week: 1,
      });
      return { art, rowId };
    };

    const publishEntry = async (version: string) =>
      (await t.entries('timetable_version.publish', version))[0]?.new_value as {
        journals: { opened: number; changed: number };
      };

    it('creates exactly one journal for a subject added, closes it when removed and reopens the same one', async () => {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, MONDAY));
      expect(await runsOf(s.branch, { classId: s.classId }, s.subject)).toEqual([
        '{[2026-10-12,)}',
      ]);
      expect(await publishEntry(s.version)).toMatchObject({ journals: { opened: 1, changed: 0 } });
      const maths = (await journalsOf(s.branch))[0];

      // From 9 November with Art added: one journal more, from that date.
      const withArtDraft = await draft(s.branch, s.year, s.version);
      const { art, rowId } = await withArt(s, withArtDraft);
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', withArtDraft)
        .execute();
      const rows = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', withArtDraft)
        .where('id', '<>', rowId)
        .execute();
      await placeAt(s.branch, withArtDraft, rows[0]?.id ?? '', 1);
      await placeAt(s.branch, withArtDraft, rowId, 2);
      await confirmTemplates(s.branch, withArtDraft);
      await load.freeEditLock(withArtDraft);
      versionOf(await publish(s.branch, withArtDraft, '2026-11-09'));
      expect(await journalsOf(s.branch)).toHaveLength(2);
      expect(await runsOf(s.branch, { classId: s.classId }, art)).toEqual(['{[2026-11-09,)}']);
      expect((await journalsOf(s.branch)).find((one) => one.id === maths?.id)).toEqual(maths);
      expect(await publishEntry(withArtDraft)).toMatchObject({
        journals: { opened: 1, changed: 0 },
      });
      const artJournal = (await journalsOf(s.branch)).find((one) => one.subject_id === art);
      const opened = await t.entries('journal.open', artJournal?.id);
      expect(opened).toHaveLength(1);
      expect(opened[0]?.new_value).toMatchObject({
        classId: s.classId,
        groupId: null,
        subjectId: art,
        versionId: withArtDraft,
        runs: '{[2026-11-09,)}',
      });

      // From 11 January without Art: the same journal, closed from that date.
      const withoutArt = await placedCopy(s.branch, s.year, s.version);
      versionOf(await publish(s.branch, withoutArt, '2027-01-11'));
      expect(await journalsOf(s.branch)).toHaveLength(2);
      expect(await runsOf(s.branch, { classId: s.classId }, art)).toEqual([
        '{[2026-11-09,2027-01-11)}',
      ]);
      const closed = await t.entries('journal.runs', artJournal?.id);
      expect(
        closed.map((one) => [one.old_value, (one.new_value as { runs: string }).runs]),
      ).toEqual([[{ runs: '{[2026-11-09,)}' }, '{[2026-11-09,2027-01-11)}']]);
      expect(await publishEntry(withoutArt)).toMatchObject({ journals: { opened: 0, changed: 1 } });

      // From 30 March with Art again: the same journal reopened, the gap kept.
      const again = await placedAll(s.branch, s.year, withArtDraft);
      versionOf(await publish(s.branch, again, '2027-03-30'));
      expect(await journalsOf(s.branch)).toHaveLength(2);
      expect(await runsOf(s.branch, { classId: s.classId }, art)).toEqual([
        '{[2026-11-09,2027-01-11),[2027-03-30,)}',
      ]);
      expect(await t.entries('journal.open', artJournal?.id)).toHaveLength(1);
      expect(await t.entries('journal.runs', artJournal?.id)).toHaveLength(2);
      // The class's maths journal ran through all four versions and never changed.
      expect((await journalsOf(s.branch)).find((one) => one.id === maths?.id)).toEqual(maths);
      expect(await t.entries('journal.runs', maths?.id)).toHaveLength(0);

      // A longer year, then a publish: the journals stay open, their last run
      // with no end, never the year's last date (decision 10).
      await t.database.migrator
        .updateTable('academic_years')
        .set({ end_date: '2027-06-15' })
        .where('id', '=', s.year)
        .execute();
      const afterLonger = await placedAll(s.branch, s.year, again);
      versionOf(await publish(s.branch, afterLonger, '2027-04-12'));
      expect(await runsOf(s.branch, { classId: s.classId }, s.subject)).toEqual([
        '{[2026-10-12,)}',
      ]);
      expect(await runsOf(s.branch, { classId: s.classId }, art)).toEqual([
        '{[2026-11-09,2027-01-11),[2027-03-30,)}',
      ]);
    });

    it('changes no journal of another branch', async () => {
      const theirs = await scene();
      versionOf(await publish(theirs.branch, theirs.version, MONDAY));
      const before = await journalsOf(theirs.branch);
      expect(before).toHaveLength(1);
      const s = await scene();
      versionOf(await publish(s.branch, s.version, MONDAY));
      const next = await draft(s.branch, s.year, s.version);
      const { rowId } = await withArt(s, next);
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', next)
        .execute();
      const [mathsRow] = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', next)
        .where('id', '<>', rowId)
        .execute();
      await placeAt(s.branch, next, mathsRow?.id ?? '', 1);
      await placeAt(s.branch, next, rowId, 2);
      await confirmTemplates(s.branch, next);
      await load.freeEditLock(next);
      versionOf(await publish(s.branch, next, '2026-11-09'));
      expect(await journalsOf(s.branch)).toHaveLength(2);
      expect(await journalsOf(theirs.branch)).toEqual(before);
    });

    it('under "run until" with the same load changes no journal', async () => {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, MONDAY));
      const later = await placedCopy(s.branch, s.year, s.version);
      versionOf(await publish(s.branch, later, '2026-11-09'));
      const before = await journalsOf(s.branch);
      const fix = await placedCopy(s.branch, s.year, s.version);
      const until = checkOf(await check(s.branch, fix, '2026-10-19&chain=run_until')).chain?.key;
      const published = await request(t.kit.server)
        .post(`/api/timetable/versions/${fix}/publish`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ startsOn: '2026-10-19', chain: 'run_until', laterKey: until });
      versionOf(published);
      expect(await journalsOf(s.branch)).toEqual(before);
      expect(await t.entries('journal.runs', before[0]?.id)).toHaveLength(0);
    });

    it('under "replace" closes a journal the fix drops from the fix\'s start', async () => {
      const s = await scene();
      // The first version has Art too, on Tuesday.
      const { art, rowId } = await withArt(s, s.version);
      await placeAt(s.branch, s.version, rowId, 2);
      await load.freeEditLock(s.version);
      versionOf(await publish(s.branch, s.version, MONDAY));
      const later = await placedAll(s.branch, s.year, s.version);
      versionOf(await publish(s.branch, later, '2026-11-09'));
      // A fix of the first version without Art, replacing the later one from 26 October.
      const fix = await draft(s.branch, s.year, s.version);
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', fix)
        .execute();
      await t.database.migrator
        .deleteFrom('teaching_load_rows')
        .where('version_id', '=', fix)
        .where('subject_id', '=', art)
        .execute();
      const [mathsRow] = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', fix)
        .execute();
      await placeAt(s.branch, fix, mathsRow?.id ?? '', 1);
      await confirmTemplates(s.branch, fix);
      await load.freeEditLock(fix);
      const replaceKey = checkOf(await check(s.branch, fix, '2026-10-26&chain=replace')).chain?.key;
      const replaced = await request(t.kit.server)
        .post(`/api/timetable/versions/${fix}/publish`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ startsOn: '2026-10-26', chain: 'replace', laterKey: replaceKey });
      versionOf(replaced);
      expect(await runsOf(s.branch, { classId: s.classId }, art)).toEqual([
        '{[2026-10-12,2026-10-26)}',
      ]);
      expect(await runsOf(s.branch, { classId: s.classId }, s.subject)).toEqual([
        '{[2026-10-12,)}',
      ]);
    });

    it('gives one journal per class and subject to the four quarters published in one afternoon', async () => {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, MONDAY));
      let from = s.version;
      for (const [, [start]] of QUARTERS.slice(1).entries()) {
        const next = await placedCopy(s.branch, s.year, from);
        versionOf(await publish(s.branch, next, start));
        from = next;
      }
      expect((await journalsOf(s.branch)).map((one) => one.runs)).toEqual(['{[2026-10-12,)}']);
      expect(await t.entries('journal.open', (await journalsOf(s.branch))[0]?.id)).toHaveLength(1);
    });

    it('gives a tie on a start to the higher number (review correction 1)', async () => {
      for (const artOnHigher of [true, false]) {
        const s = await scene();
        versionOf(await publish(s.branch, s.version, MONDAY));
        const lower = await load.version(s.branch, s.year, { startsOn: '2026-11-09' });
        const higher = await load.version(s.branch, s.year, { startsOn: '2026-11-09' });
        const { art } = await withArt(s, artOnHigher ? higher : lower);
        await load.setVersion(lower, 'published');
        await load.setVersion(higher, 'published');
        const last = await placedCopy(s.branch, s.year, s.version);
        versionOf(await publish(s.branch, last, '2027-01-11'));
        expect(await runsOf(s.branch, { classId: s.classId }, art)).toEqual(
          artOnHigher ? ['{[2026-11-09,2027-01-11)}'] : [],
        );
        // The higher number has no maths row: maths has a gap over its run.
        expect(await runsOf(s.branch, { classId: s.classId }, s.subject)).toEqual([
          '{[2026-10-12,2026-11-09),[2027-01-11,)}',
        ]);
      }
    });

    it('closes the class journal and opens two group journals when the subject is split from the third quarter', async () => {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, MONDAY));
      const groups = [
        await load.classes.group(s.branch, s.year, s.subject, [s.classId]),
        await load.classes.group(s.branch, s.year, s.subject, [s.classId]),
      ];
      const split = await draft(s.branch, s.year, s.version);
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', split)
        .execute();
      await t.database.migrator
        .deleteFrom('teaching_load_rows')
        .where('version_id', '=', split)
        .execute();
      const groupRows: string[] = [];
      for (const group of groups) {
        const teacher = (
          await load.teacher(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] })
        ).staffId;
        await hours(s.branch, teacher);
        groupRows.push(
          await load.row({
            branch_id: s.branch,
            version_id: split,
            group_id: group,
            subject_id: s.subject,
            teacher_id: teacher,
            lessons_per_week: 1,
          }),
        );
      }
      await placeAt(s.branch, split, groupRows[0] ?? '', 1);
      await confirmTemplates(s.branch, split);
      await load.freeEditLock(split);
      versionOf(await publish(s.branch, split, '2027-01-11'));
      expect(await runsOf(s.branch, { classId: s.classId }, s.subject)).toEqual([
        '{[2026-10-12,2027-01-11)}',
      ]);
      for (const group of groups) {
        expect(await runsOf(s.branch, { groupId: group }, s.subject)).toEqual(['{[2027-01-11,)}']);
      }
    });

    it('under "replace" leaves a journal only the archived version had with no run, and changes none under "carry"', async () => {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, MONDAY));
      const later = await draft(s.branch, s.year, s.version);
      const { art, rowId } = await withArt(s, later);
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', later)
        .execute();
      const [mathsRow] = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', later)
        .where('id', '<>', rowId)
        .execute();
      await placeAt(s.branch, later, mathsRow?.id ?? '', 1);
      await placeAt(s.branch, later, rowId, 2);
      await confirmTemplates(s.branch, later);
      await load.freeEditLock(later);
      versionOf(await publish(s.branch, later, '2026-11-09'));
      expect(await runsOf(s.branch, { classId: s.classId }, art)).toEqual(['{[2026-11-09,)}']);
      const before = await journalsOf(s.branch);

      // Carry: a fix of A with another room only; the journals stay as they are.
      const room2 = await load.classes.room(s.branch);
      const carryFix = await placedCopy(s.branch, s.year, s.version);
      const block = await t.database.migrator
        .selectFrom('pattern_blocks')
        .select('id')
        .where('version_id', '=', carryFix)
        .executeTakeFirstOrThrow();
      const entry = await t.database.migrator
        .selectFrom('pattern_entries')
        .select('id')
        .where('version_id', '=', carryFix)
        .executeTakeFirstOrThrow();
      const roomed = await post(
        `/api/timetable/versions/${carryFix}/pattern/${block.id}/room`,
        s.branch,
        {
          lessonId: entry.id,
          roomId: room2,
        },
      );
      expect(roomed.status, JSON.stringify(roomed.body)).toBe(200);
      const chainKey = async (version: string, chain: string) => {
        const answer = checkOf(await check(s.branch, version, `2026-10-19&chain=${chain}`));
        if (answer.chain === null) throw new Error('A later version is shown.');
        return answer.chain.key;
      };
      const publishChain = async (version: string, chain: string) => {
        const laterKey = await chainKey(version, chain);
        return request(t.kit.server)
          .post(`/api/timetable/versions/${version}/publish`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, s.branch)
          .set(REQUEST_KEY_HEADER, randomUUID())
          .send({ startsOn: '2026-10-19', chain, laterKey });
      };
      versionOf(await publishChain(carryFix, 'carry'));
      expect(await journalsOf(s.branch)).toEqual(before);

      // Replace from 26 October: the version with Art is archived before it started.
      const replaceFix = await placedCopy(s.branch, s.year, s.version);
      const replaceKey = checkOf(await check(s.branch, replaceFix, '2026-10-26&chain=replace'))
        .chain?.key;
      const replaced = await request(t.kit.server)
        .post(`/api/timetable/versions/${replaceFix}/publish`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({
          startsOn: '2026-10-26',
          chain: 'replace',
          laterKey: replaceKey,
        });
      versionOf(replaced);
      expect(await runsOf(s.branch, { classId: s.classId }, art)).toEqual(['{}']);
      expect(await runsOf(s.branch, { classId: s.classId }, s.subject)).toEqual([
        '{[2026-10-12,)}',
      ]);
      expect(await journalsOf(s.branch)).toHaveLength(2);
    });

    it('gives a Tutor subject row and a vacancy row their journals like any row (decision 4)', async () => {
      const s = await scene();
      // Attendance only, as the Homework slot is: no weights asked.
      const tutorSubject = await load.tutorSubject({ grades: [7] });
      await t.database.migrator
        .updateTable('subjects')
        .set({ journal_type: 'attendance_only', rating_exam: false })
        .where('id', '=', tutorSubject)
        .execute();
      const art = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const vacancy = await load.vacancy(s.branch, { subjects: [{ subject: art, grades: [7] }] });
      await hours(s.branch, vacancy);
      const vacancyRow = await load.row({
        branch_id: s.branch,
        version_id: s.version,
        class_id: s.classId,
        subject_id: art,
        teacher_id: vacancy,
        lessons_per_week: 1,
      });
      await placeAt(s.branch, s.version, vacancyRow, 3);
      const tutor = await load.teacher(s.branch);
      await hours(s.branch, tutor.staffId);
      await load.tutorOf(s.branch, s.classId, tutor.accountId);
      const created = await post(`/api/timetable/versions/${s.version}/load`, s.branch, {
        classId: s.classId,
        groupId: null,
        subjectId: tutorSubject,
        teacherId: null,
        lessonsPerWeek: 1,
        roomId: null,
        roomType: null,
        doubleLessons: false,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      await placeAt(s.branch, s.version, (created.body as { id: string }).id, 2);
      await load.freeEditLock(s.version);
      versionOf(await publish(s.branch, s.version, MONDAY));
      expect(await runsOf(s.branch, { classId: s.classId }, tutorSubject)).toEqual([
        '{[2026-10-12,)}',
      ]);
      expect(await runsOf(s.branch, { classId: s.classId }, art)).toEqual(['{[2026-10-12,)}']);
    });
  });

  // Task 5.5c-3a, pull request #158: notices and the changed mark
  // (docs/spec/06-timetable.md, How surprises are prevented, Everyone is
  // told: "Each affected teacher receives a notice showing before and after.
  // Changed lessons carry a 'changed' mark on every timetable view for a
  // week."; edge/timetable, After publishing: "One notice per person per
  // event, with the week before and after. A teacher whose week did not
  // change gets none."; Teachers who work in several branches: "Every notice
  // to the teacher names the branch").
  describe('notices and the changed mark', () => {
    /** A teacher of a second subject in the scene's branch, with hours, and the subject. */
    async function artOf(branch: string, input: { noAccount?: boolean } = {}) {
      const art = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const teacher = await load.teacher(branch, {
        subjects: [{ subject: art, grades: [7] }],
        ...input,
      });
      await hours(branch, teacher.staffId);
      return { art, teacherId: teacher.staffId };
    }

    /** The scene with Art on Tuesday by a second teacher, published from Monday 12 October. */
    async function published() {
      const s = await scene();
      const { art, teacherId: artTeacher } = await artOf(s.branch);
      const artRow = await load.row({
        branch_id: s.branch,
        version_id: s.version,
        class_id: s.classId,
        subject_id: art,
        teacher_id: artTeacher,
        lessons_per_week: 1,
      });
      await placeAt(s.branch, s.version, artRow, 2);
      await load.freeEditLock(s.version);
      const first = versionOf(await publish(s.branch, s.version, MONDAY));
      return { ...s, art, artTeacher, first };
    }

    /** A copy of the published version with maths on `mathsDay` and Art on Tuesday. */
    async function fixOf(s: Awaited<ReturnType<typeof published>>, mathsDay: number) {
      const fix = await draft(s.branch, s.year, s.version);
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', fix)
        .execute();
      const rows = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select(['id', 'subject_id'])
        .where('version_id', '=', fix)
        .orderBy('id')
        .execute();
      for (const row of rows) {
        await placeAt(s.branch, fix, row.id, row.subject_id === s.subject ? mathsDay : 2);
      }
      await confirmTemplates(s.branch, fix);
      await load.freeEditLock(fix);
      return { fix, rows };
    }

    it('notifies once the teacher whose lessons a publish changes, and no teacher whose week is the same', async () => {
      const s = await published();
      // The first publish: both teachers are told, nothing is marked (decision 4).
      const firstNotices = await noticesOf(s.branch, 'timetable.published', s.first.number);
      expect(firstNotices.map((one) => one.account_id).sort()).toEqual(
        (await accountsOf([s.teacherId, s.artTeacher])).sort(),
      );
      expect(await marksOf(s.branch)).toEqual([]);
      // An Art lesson marked a week earlier, by an earlier change.
      const art = (await lessonsOf(s.branch)).find(
        (one) => one.subject_id === s.art && one.date === '2026-10-20',
      );
      if (art === undefined) throw new Error('Art is on Tuesday 20 October.');
      await t.database.migrator
        .insertInto('lesson_changes')
        .values({ lesson_id: art.id, branch_id: s.branch, changed_at: EARLIER })
        .execute();

      const { fix } = await fixOf(s, 3);
      const version = versionOf(await publish(s.branch, fix, '2026-10-19'));
      const notices = await noticesOf(s.branch, 'timetable.published', version.number);
      expect(notices.map((one) => one.account_id)).toEqual(await accountsOf([s.teacherId]));
      const [notice] = notices;
      expect(notice?.branch_id).toBe(s.branch);
      const room = await t.database.migrator
        .selectFrom('rooms')
        .select('name')
        .where('id', '=', s.room)
        .executeTakeFirstOrThrow();
      const week = notice?.data as { weekStart: string; before: unknown[]; after: unknown[] };
      expect(week.weekStart).toBe('2026-10-19');
      expect(week.before.map((one) => weekLessonSchema.parse(one))).toMatchObject([
        { date: '2026-10-19', start: '08:00', end: '08:45', room: room.name, cancelled: false },
      ]);
      expect(week.after.map((one) => weekLessonSchema.parse(one))).toMatchObject([
        { date: '2026-10-21', start: '08:00', end: '08:45', room: room.name, cancelled: false },
      ]);

      // Done when: the changed lessons carry the mark, from the publish for seven days.
      const marks = await marksOf(s.branch);
      expect(marks.filter((one) => one.subject_id === s.subject).map((one) => one.date)).toEqual(
        schoolDates(3, '2026-10-19'),
      );
      const now = new Date(START);
      for (const one of marks.filter((mark) => mark.subject_id === s.subject)) {
        expect(one.changed_at).toEqual(now);
        expect(isMarkedChanged(one.changed_at, new Date(now.getTime() + 7 * DAY - 60_000))).toBe(
          true,
        );
        expect(isMarkedChanged(one.changed_at, new Date(now.getTime() + 7 * DAY))).toBe(false);
      }
      // The unchanged Art lessons are not marked; the one marked before keeps its moment.
      expect(marks.filter((one) => one.subject_id === s.art)).toEqual([
        expect.objectContaining({ id: art.id, changed_at: EARLIER }),
      ]);
      const [entry] = await t.entries('timetable_version.publish', fix);
      expect(entry?.new_value).toMatchObject({
        notices: { notified: 1, marked: schoolDates(3, '2026-10-19').length },
      });
    });

    it('keeps a mark in the branch of its lesson', async () => {
      const s = await published();
      const [one] = await lessonsOf(s.branch);
      if (one === undefined) throw new Error('The scene has lessons.');
      const other = await t.newBranch();
      await expect(
        t.database.migrator
          .insertInto('lesson_changes')
          .values({ lesson_id: one.id, branch_id: other, changed_at: EARLIER })
          .execute(),
      ).rejects.toMatchObject({ code: '23503', constraint: 'lesson_changes_lesson_fkey' });
    });

    it('shows the whole week of a start on a Wednesday', async () => {
      const s = await published();
      // Maths moves from Monday to Thursday from Wednesday 21 October.
      const { fix } = await fixOf(s, 4);
      const answer = checkOf(await check(s.branch, fix, '2026-10-21'));
      const version = versionOf(
        await publish(s.branch, fix, '2026-10-21', t.admin, randomUUID(), {
          ...(answer.impact?.transition?.key == null
            ? {}
            : { transitionKey: answer.impact.transition.key }),
        }),
      );
      const [notice, ...more] = await noticesOf(s.branch, 'timetable.published', version.number);
      expect(more).toEqual([]);
      expect(notice?.account_id).toBe((await accountsOf([s.teacherId]))[0]);
      const week = notice?.data as {
        weekStart: string;
        before: { date: string }[];
        after: { date: string }[];
      };
      expect(week.weekStart).toBe('2026-10-19');
      // Monday 19 October is before the start, the same on both sides.
      expect(week.before.map((one) => one.date)).toEqual(['2026-10-19']);
      expect(week.after.map((one) => one.date)).toEqual(['2026-10-19', '2026-10-22']);
      // Thursday 22 October is marked: its week had lessons before (decision 4).
      expect(
        (await marksOf(s.branch))
          .filter((one) => one.subject_id === s.subject)
          .map((one) => one.date)
          .slice(0, 1),
      ).toEqual(['2026-10-22']);
    });

    it('never notifies a vacancy or a person without an account', async () => {
      const s = await scene();
      const { art, teacherId: noAccount } = await artOf(s.branch, { noAccount: true });
      const artRow = await load.row({
        branch_id: s.branch,
        version_id: s.version,
        class_id: s.classId,
        subject_id: art,
        teacher_id: noAccount,
        lessons_per_week: 1,
      });
      await placeAt(s.branch, s.version, artRow, 2);
      const music = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const vacancy = await load.vacancy(s.branch, { subjects: [{ subject: music, grades: [7] }] });
      await hours(s.branch, vacancy);
      const musicRow = await load.row({
        branch_id: s.branch,
        version_id: s.version,
        class_id: s.classId,
        subject_id: music,
        teacher_id: vacancy,
        lessons_per_week: 1,
      });
      await placeAt(s.branch, s.version, musicRow, 3);
      await load.freeEditLock(s.version);
      const answer = checkOf(await check(s.branch, s.version, MONDAY));
      expect(
        (answer.impact?.teachers ?? []).filter((one) => one.notified).map((one) => one.id),
      ).toEqual([s.teacherId]);
      const version = versionOf(await publish(s.branch, s.version, MONDAY));
      const all = await t.database.migrator
        .selectFrom('notifications')
        .select('account_id')
        .where('branch_id', '=', s.branch)
        .execute();
      expect(all.map((one) => one.account_id)).toEqual(await accountsOf([s.teacherId]));
      const [entry] = await t.entries('timetable_version.publish', s.version);
      expect(entry?.new_value).toMatchObject({ notices: { notified: 1, marked: 0 } });
      expect(version.status).toBe('published');
    });

    it('notifies the teachers the preview names, with a one-day cancel changed and removed', async () => {
      const s = await published();
      // One-day cancels (`reason`) on Monday's maths and Tuesday's Art of the week of 19 October.
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: 'Excursion to the museum' })
        .where('branch_id', '=', s.branch)
        .where('lesson_date', 'in', ['2026-10-19', '2026-10-20'])
        .execute();
      // The fix moves maths to Wednesday (Monday's cancelled lesson is removed)
      // and gives Art to a third teacher (Tuesday's cancelled lesson changes teacher).
      const { fix, rows } = await fixOf(s, 3);
      const third = (await load.teacher(s.branch, { subjects: [{ subject: s.art, grades: [7] }] }))
        .staffId;
      await hours(s.branch, third);
      const artRow = rows.find((one) => one.subject_id === s.art);
      if (artRow === undefined) throw new Error('The copy has its Art row.');
      const edited = await t.patch(
        `/api/timetable/versions/${fix}/load/${artRow.id}`,
        s.branch,
        {
          teacherId: third,
          lessonsPerWeek: 1,
          roomId: null,
          roomType: null,
          doubleLessons: false,
        },
        t.admin,
      );
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      await load.freeEditLock(fix);
      const answer = checkOf(await check(s.branch, fix, '2026-10-19'));
      const shown = (answer.impact?.teachers ?? [])
        .filter((one) => one.notified)
        .map((one) => one.id);
      expect(shown.sort()).toEqual([s.teacherId, s.artTeacher, third].sort());
      const version = versionOf(
        await publish(s.branch, fix, '2026-10-19', t.admin, randomUUID(), {
          dayChangesKey: answer.impact?.dayChanges.key ?? '',
        }),
      );
      const notices = await noticesOf(s.branch, 'timetable.published', version.number);
      expect(notices.map((one) => one.account_id).sort()).toEqual((await accountsOf(shown)).sort());
      // The Art teacher's week before shows Tuesday's lesson, cancelled (review correction 3).
      const [artAccount] = await accountsOf([s.artTeacher]);
      const artWeek = notices.find((one) => one.account_id === artAccount)?.data as {
        weekStart: string;
        before: { date: string; cancelled: boolean }[];
        after: unknown[];
      };
      expect(artWeek.weekStart).toBe('2026-10-19');
      expect(artWeek.before).toMatchObject([{ date: '2026-10-20', cancelled: true }]);
      expect(artWeek.after).toEqual([]);
    });

    // Code review must-fixes 1 and 2: the notices and marks are written in the
    // event's transaction, and a lesson created again equal (another id, the
    // same date, times, class, subject, teacher and room) takes the mark of the
    // one it replaces.
    it('writes in the transaction of its event, and gives a lesson created again equal the earlier mark', async () => {
      const s = await published();
      const before = await written([s.version]);
      const notifications = t.app.get(Notifications);
      await expect(
        t.app.get(Transactions).run([s.branch], async (transaction) => {
          const week = await snapshotWeek(transaction, s.branch, '2026-10-19', '2027-05-31');
          const monday = week.before.find(
            (one) => one.lesson.subjectId === s.subject && one.lesson.date === '2026-10-19',
          );
          if (monday === undefined) throw new Error('Maths is on Monday 19 October.');
          // Monday 26 October's maths is removed, as a write would remove it.
          await transaction
            .deleteFrom('lessons')
            .where('subject_id', '=', s.subject)
            .where('lesson_date', '=', '2026-10-26')
            .execute();
          // Monday 19 October's maths stood before under another id, marked earlier.
          const snapshot = {
            ...week,
            before: week.before.map((one) =>
              one.id === monday.id ? { ...one, id: randomUUID(), changedAt: EARLIER } : one,
            ),
          };
          const done = await sendWeekChanges(transaction, notifications, snapshot, {
            kind: 'timetable.published',
            number: 99,
          });
          expect(done).toEqual({ notified: 1, marked: 0 });
          const marks = await transaction
            .selectFrom('lesson_changes')
            .select(['lesson_id', 'changed_at'])
            .execute();
          expect(marks).toEqual([{ lesson_id: monday.id, changed_at: EARLIER }]);
          const sent = await transaction
            .selectFrom('notifications')
            .select('data')
            .where('branch_id', '=', s.branch)
            .where(sql<boolean>`data->>'number' = '99'`)
            .execute();
          expect(sent.map((one) => one.data)).toMatchObject([
            {
              weekStart: '2026-10-26',
              before: [{ date: '2026-10-26', changed: true }],
              after: [],
            },
          ]);
          throw new Error('Rolled back by the test.');
        }),
      ).rejects.toThrow('Rolled back by the test.');
      // Nothing of it stays: notices, their delivery jobs, marks.
      expect(await written([s.version])).toEqual(before);
    });

    it('marks nothing and notifies nobody when a publish is refused', async () => {
      const s = await published();
      const { fix } = await fixOf(s, 3);
      const before = await written([s.version, fix]);
      // Today is no start: refused.
      blockedBy(await publish(s.branch, fix, TODAY));
      expect(await written([s.version, fix])).toEqual(before);
    });
  });
});
