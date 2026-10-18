import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  publishCheckSchema,
  timetableVersionSchema,
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
  TODAY,
  TOMORROW,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LessonsKit, at } from '../../testing/lessons-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const versionOf = (response: Response): TimetableVersion => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return timetableVersionSchema.parse(response.body);
};

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
    extra: { transitionKey?: string } = {},
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
      t.database.migrator.selectFrom('notifications').selectAll().orderBy('id').execute(),
      // A takeover of the edit lock enqueues the delivery of its notice (permission review, should-fix 4).
      sql<{ id: string; name: string }>`select id, name from pgboss.job order by id`
        .execute(t.database.migrator)
        .then((result) => result.rows),
      t.database.migrator.selectFrom('request_keys').selectAll().orderBy('key').execute(),
      t.auditCount(),
    ]);
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
    it('refuses a start on or before a published version of the year (decision 3)', async () => {
      const s = await scene();
      const later = await placedCopy(s.branch, s.year, s.version);
      versionOf(await publish(s.branch, later, '2026-10-26'));
      for (const date of ['2026-10-19', '2026-10-26']) {
        expect(blockedBy(await publish(s.branch, s.version, date))).toContainEqual({
          code: 'version_later_published',
          path: '',
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
      const marked = await Promise.all(
        [sibling, child, grandchild, otherYear].map(
          async (id) => (await versionRow(id)).out_of_date_at,
        ),
      );
      expect(marked.map((one) => one !== null)).toEqual([true, false, false, false]);
      expect(marked[0]).toEqual(t.clock.now());
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
      expect((await versionRow(copy)).out_of_date_at).toEqual(t.clock.now());
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
      const again = versionOf(await publish(s.branch, s.version, MONDAY, t.admin, key));
      expect(again).toEqual(first);
      expect(await t.entries('timetable_version.publish', s.version)).toHaveLength(1);
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
      const s = await scene();
      const theirs = await scene();
      await viceIn(s.branch);
      // Rows a publish would change, in both branches (permission review, must-fix 2).
      await withMoreToChange(s);
      await withMoreToChange(theirs);
      const before = await written([s.version, theirs.version]);
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
  });
});
