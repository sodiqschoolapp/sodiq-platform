import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  outOfDateAnswerSchema,
  timetableVersionSchema,
  withdrawCheckSchema,
  type TimetableVersion,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  MONDAY,
  START,
  TOMORROW,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LessonsKit, at } from '../../testing/lessons-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { standingExamOver } from '../../testing/exams-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const versionOf = (response: Response): TimetableVersion => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return timetableVersionSchema.parse(response.body);
};

/** The details of a `withdraw_blocked`. */
const blockedBy = (response: Response): { code: string; path: string; day?: string }[] => {
  refusedWith(response, 409, 'withdraw_blocked');
  const body = response.body as {
    error: { details: { code: string; path: string; day?: string }[] };
  };
  return body.error.details;
};

/** The quarters of the year 2026-09-01 to 2027-05-31, dated. */
const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

/** The second quarter's first day, a Monday: the start of the version withdrawn. */
const NOVEMBER = '2026-11-09';
/** The third quarter's first day, a Monday. */
const JANUARY = '2027-01-11';

// All names are invented. Task 5.5c-2a, pull request #156: withdraw
// (docs/spec/06-timetable.md, How surprises are prevented: "Withdraw. A
// published version can be withdrawn only before its start date.";
// edge/timetable, Versions and drafts: "'Withdraw' works only before the
// version's start date. After that, the only way is a new version."). The
// clock stands at 23:55 on Saturday 10 October 2026 in Tashkent.
describe('withdraw', () => {
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

  const publish = (branch: string, version: string, startsOn: string, extra: object = {}) =>
    request(t.kit.server)
      .post(`/api/timetable/versions/${version}/publish`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ startsOn, ...extra });

  const withdraw = (
    branch: string,
    version: string,
    cookie = t.admin,
    key: string = randomUUID(),
  ) =>
    request(t.kit.server)
      .post(`/api/timetable/versions/${version}/withdraw`)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, key)
      .send();

  /** The withdraw check (task 5.6a-5b-2), refused as the withdraw is. */
  const check = (branch: string, version: string) =>
    t.get(`/api/timetable/versions/${version}/withdraw-check`, branch);

  /** Hours of a person in the branch from 1 September, Monday to Friday, all day. */
  async function hours(branch: string, staffId: string) {
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
          start_minutes: 0,
          end_minutes: 1440,
          valid_from: '2026-09-01',
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
   * break, lesson, break, lesson on every weekday from 08:00, a class of
   * grade 7, and a draft with one row of maths placed on Monday: a draft that
   * can be published.
   */
  async function scene(
    input: { teacherFor?: (branch: string, subject: string) => Promise<string> } = {},
  ) {
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
    await t.assign(branch, regular);
    const subject = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const room = await load.classes.room(branch);
    const classId = await load.classes.schoolClass(branch, year, { grade: 7, room });
    let teacherId: string;
    if (input.teacherFor === undefined) {
      teacherId = (await load.teacher(branch, { subjects: [{ subject, grades: [7] }] })).staffId;
      await hours(branch, teacherId);
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
      lessons_per_week: 1,
    });
    await placeAt(branch, version, rowId, 1);
    await confirmTemplates(branch, version);
    await load.freeEditLock(version);
    return { branch, year, subject, room, classId, teacherId, version, rowId };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /**
   * A copy of `from` whose rows are placed again: maths on `mathsDay`, and,
   * with `art`, a row of a second subject with its own teacher on Tuesday.
   */
  async function copyOf(
    s: Scene,
    from: string,
    options: { mathsDay?: number; art?: boolean } = {},
  ): Promise<{ version: string; art: string | null }> {
    const version = await draft(s.branch, s.year, from);
    await t.database.migrator
      .deleteFrom('pattern_blocks')
      .where('version_id', '=', version)
      .execute();
    // Maths on `mathsDay`, any other row copied (Art) on Tuesday.
    const copied = await t.database.migrator
      .selectFrom('teaching_load_rows')
      .select(['id', 'subject_id'])
      .where('version_id', '=', version)
      .execute();
    for (const row of copied) {
      await placeAt(
        s.branch,
        version,
        row.id,
        row.subject_id === s.subject ? (options.mathsDay ?? 1) : 2,
      );
    }
    let art: string | null = null;
    if (options.art === true) {
      art = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
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
      await placeAt(s.branch, version, rowId, 2);
    }
    await confirmTemplates(s.branch, version);
    await load.freeEditLock(version);
    return { version, art };
  }

  /** A published from Monday 12 October, B (a copy with Art on Tuesdays) from 9 November. */
  async function twoVersions(input: Parameters<typeof scene>[0] = {}) {
    const s = await scene(input);
    versionOf(await publish(s.branch, s.version, MONDAY));
    const b = await copyOf(s, s.version, { art: true });
    versionOf(await publish(s.branch, b.version, NOVEMBER));
    return { ...s, a: s.version, b: b.version, art: b.art ?? '' };
  }

  const versionRow = (id: string) =>
    t.database.migrator
      .selectFrom('timetable_versions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  /** The dated lessons of a branch with their block's version, by date, start and id. */
  const lessonsOf = (branch: string) =>
    t.database.migrator
      .selectFrom('lessons')
      .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
      .select([
        'lessons.id',
        sql<string>`lessons.lesson_date::text`.as('date'),
        'lessons.subject_id',
        'lessons.teacher_id',
        'lessons.cancel_cause',
        'lesson_blocks.version_id',
      ])
      .where('lessons.branch_id', '=', branch)
      .orderBy('lessons.lesson_date')
      .orderBy('lessons.starts_at')
      .orderBy('lessons.id')
      .execute();

  const journalsOf = (branch: string) =>
    t.database.migrator
      .selectFrom('journals')
      .select(['id', 'class_id', 'subject_id', sql<string>`runs::text`.as('runs')])
      .where('branch_id', '=', branch)
      .orderBy('id')
      .execute();

  const causesOf = (id: string) =>
    t.database.migrator
      .selectFrom('timetable_version_out_of_date_causes')
      .select(['action', 'record_id'])
      .where('version_id', '=', id)
      .orderBy('caused_at')
      .orderBy('id')
      .execute();

  /** Every row a withdraw writes, in the branches of the versions named, each column. */
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
        .selectFrom('timetable_version_out_of_date_causes')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('id')
        .execute(),
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
      t.database.migrator
        .selectFrom('journals')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('id')
        .execute(),
      t.database.migrator.selectFrom('request_keys').selectAll().orderBy('key').execute(),
      t.auditCount(),
      // Task 5.6a-5b-2 (permission review must-fix 1): the withdraw ends and
      // records one-day changes again and records bulk cancels' choices.
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
      t.database.migrator
        .selectFrom('bulk_cancel_blocks')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('bulk_cancel_id')
        .orderBy('block_id')
        .execute(),
      // Task 5.6c-3a (permission review, must-fix 1): the standing exams a
      // publish or withdraw keeps, drops or writes again.
      t.database.migrator
        .selectFrom('exams')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('id')
        .execute(),
      t.database.migrator
        .selectFrom('lesson_exam_cancels')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('lesson_id')
        .orderBy('exam_id')
        .execute(),
      t.database.migrator
        .selectFrom('lesson_block_class_outs')
        .selectAll()
        .where('branch_id', 'in', branches)
        .orderBy('block_id')
        .orderBy('class_id')
        .execute(),
      t.database.migrator.selectFrom('notifications').selectAll().orderBy('id').execute(),
    ]);
  };

  /**
   * Task 5.6a-5b-2 (permission review must-fix 1): a room change of B's maths
   * of 16 November, and a bulk cancel's choice on its block, rows a withdraw
   * of B would end or change.
   */
  async function storedChanges(s: { branch: string; classId: string; subject: string }) {
    const lesson = await t.database.migrator
      .selectFrom('lessons')
      .select(['id', 'block_id', 'starts_at', 'ends_at'])
      .where('class_id', '=', s.classId)
      .where('subject_id', '=', s.subject)
      .where('lesson_date', '=', '2026-11-16')
      .executeTakeFirstOrThrow();
    const room = await load.classes.room(s.branch);
    const changed = await request(t.kit.server)
      .post(`/api/timetable/lessons/${lesson.id}/room`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, s.branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ roomId: room, reason: 'The room is painted' });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    const account = await t.database.migrator
      .selectFrom('accounts')
      .select('id')
      .orderBy('id')
      .executeTakeFirstOrThrow();
    const bulk = await t.database.migrator
      .insertInto('bulk_cancels')
      .values({
        branch_id: s.branch,
        cancel_date: '2026-11-16',
        lesson_numbers: [1],
        reason: 'Excursion to the museum',
        changed_at: new Date(START),
        changed_by: account.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.database.migrator
      .insertInto('bulk_cancel_blocks')
      .values({
        branch_id: s.branch,
        bulk_cancel_id: bulk.id,
        block_id: lesson.block_id,
        choice: 'keep',
        lesson_date: '2026-11-16',
        starts_at: lesson.starts_at,
        ends_at: lesson.ends_at,
      })
      .execute();
  }

  describe('a version withdrawn before its start', () => {
    it('leaves it no dated lessons and runs the version before it again over its dates (Done when)', async () => {
      const s = await twoVersions();
      const before = await lessonsOf(s.branch);
      const mondaysOfB = before.filter(
        (one) => one.version_id === s.b && one.subject_id === s.subject,
      );
      expect(mondaysOfB.length).toBeGreaterThan(0);
      expect(before.some((one) => one.subject_id === s.art)).toBe(true);

      const answer = versionOf(await withdraw(s.branch, s.b));
      expect(answer.status).toBe('archived');
      expect((await versionRow(s.b)).status).toBe('archived');

      const after = await lessonsOf(s.branch);
      // No lesson of the withdrawn version is left.
      expect(after.filter((one) => one.version_id === s.b)).toEqual([]);
      // Art, only B's, is gone.
      expect(after.filter((one) => one.subject_id === s.art)).toEqual([]);
      // The maths lessons of B's dates are A's again, with the same ids
      // (edge/timetable: "An unchanged lesson keeps its identity").
      const fromNovember = after.filter((one) => one.date >= NOVEMBER);
      expect(fromNovember.map((one) => one.id)).toEqual(mondaysOfB.map((one) => one.id));
      expect(new Set(fromNovember.map((one) => one.version_id))).toEqual(new Set([s.a]));
      // A's own lessons before B's start are untouched.
      expect(after.filter((one) => one.date < NOVEMBER)).toEqual(
        before.filter((one) => one.date < NOVEMBER),
      );
    });

    it('runs the version before it only until the next published start, and leaves the later version as it is', async () => {
      const s = await twoVersions();
      const c = await copyOf(s, s.b, { mathsDay: 3 });
      versionOf(await publish(s.branch, c.version, JANUARY));
      const before = await lessonsOf(s.branch);
      const ofC = before.filter((one) => one.date >= JANUARY);
      expect(ofC.length).toBeGreaterThan(0);

      versionOf(await withdraw(s.branch, s.b));
      const after = await lessonsOf(s.branch);
      expect(after.filter((one) => one.date >= JANUARY)).toEqual(ofC);
      const between = after.filter((one) => one.date >= NOVEMBER && one.date < JANUARY);
      expect(between.length).toBeGreaterThan(0);
      expect(new Set(between.map((one) => one.version_id))).toEqual(new Set([s.a]));
      expect(between.every((one) => new Date(`${one.date}T00:00:00Z`).getUTCDay() === 1)).toBe(
        true,
      );
      const entry = (await t.entries('timetable_version.withdraw', s.b))[0];
      expect(entry?.new_value).toMatchObject({
        runsAgain: { id: s.a },
        runsAgainUntil: '2027-01-10',
      });
    });

    it('leaves the dates of the first version of the chain with no lesson, each removed one in the audit', async () => {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, NOVEMBER));
      const before = await lessonsOf(s.branch);
      expect(before.length).toBeGreaterThan(0);
      versionOf(await withdraw(s.branch, s.version));
      expect(await lessonsOf(s.branch)).toEqual([]);
      const blocks = await t.database.migrator
        .selectFrom('lesson_blocks')
        .select('id')
        .where('branch_id', '=', s.branch)
        .execute();
      expect(blocks).toEqual([]);
      const entry = (await t.entries('timetable_version.withdraw', s.version))[0];
      const value = entry?.new_value as {
        runsAgain: unknown;
        datedLessons: { removed: { id: string }[]; created: number };
      };
      expect(value.runsAgain).toBeNull();
      expect(value.datedLessons.created).toBe(0);
      expect(value.datedLessons.removed.map((one) => one.id).sort()).toEqual(
        before.map((one) => one.id).sort(),
      );
    });

    // Review correction 2 (decision 13): a carry or a replace of the
    // withdrawn version's own publish stays.
    it('keeps the teacher a carry of the withdrawn version wrote into a later version', async () => {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, MONDAY));
      const c = await copyOf(s, s.version);
      versionOf(await publish(s.branch, c.version, JANUARY));
      // A fix from 9 November, a copy of A with another teacher, carried into C.
      const fix = await copyOf(s, s.version);
      const second = (
        await load.teacher(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] })
      ).staffId;
      await hours(s.branch, second);
      const fixRow = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', fix.version)
        .executeTakeFirstOrThrow();
      const edited = await t.patch(
        `/api/timetable/versions/${fix.version}/load/${fixRow.id}`,
        s.branch,
        {
          teacherId: second,
          lessonsPerWeek: 1,
          roomId: null,
          roomType: null,
          doubleLessons: false,
        },
      );
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      await load.freeEditLock(fix.version);
      const shown = await t.get(
        `/api/timetable/versions/${fix.version}/publish-check?startsOn=${NOVEMBER}&chain=carry`,
        s.branch,
      );
      expect(shown.status, JSON.stringify(shown.body)).toBe(200);
      const laterKey = (shown.body as { chain: { key: string } }).chain.key;
      versionOf(await publish(s.branch, fix.version, NOVEMBER, { chain: 'carry', laterKey }));
      const ofC = (await lessonsOf(s.branch)).filter((one) => one.date >= JANUARY);
      expect(ofC.length).toBeGreaterThan(0);
      expect(ofC.every((one) => one.teacher_id === second)).toBe(true);

      versionOf(await withdraw(s.branch, fix.version));
      const after = await lessonsOf(s.branch);
      expect(after.filter((one) => one.date >= JANUARY)).toEqual(ofC);
      const cRow = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('teacher_id')
        .where('version_id', '=', c.version)
        .executeTakeFirstOrThrow();
      expect(cRow.teacher_id).toBe(second);
      // A runs again between with its own teacher.
      const between = after.filter((one) => one.date >= NOVEMBER && one.date < JANUARY);
      expect(between.every((one) => one.teacher_id === s.teacherId)).toBe(true);
    });
  });

  // edge/timetable, Versions and drafts: "Journals are created and closed at
  // publish"; Done when: "a journal only it opened has no run".
  describe('the journals', () => {
    it('leaves a journal only the withdrawn version opened with no run, and the other its earlier run', async () => {
      const s = await twoVersions();
      expect((await journalsOf(s.branch)).map((one) => [one.subject_id, one.runs]).sort()).toEqual(
        [
          [s.subject, '{[2026-10-12,)}'],
          [s.art, '{[2026-11-09,)}'],
        ].sort(),
      );
      versionOf(await withdraw(s.branch, s.b));
      expect((await journalsOf(s.branch)).map((one) => [one.subject_id, one.runs]).sort()).toEqual(
        [
          [s.subject, '{[2026-10-12,)}'],
          [s.art, '{}'],
        ].sort(),
      );
      const entry = (await t.entries('timetable_version.withdraw', s.b))[0];
      expect(entry?.new_value).toMatchObject({ journals: { opened: 0, changed: 1 } });
    });
  });

  describe('what refuses a withdraw', () => {
    it('refuses a draft and an archived version, and a version from its start day on, in branch time (should-fix 4)', async () => {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, TOMORROW));
      const other = await draft(s.branch, s.year);
      let before = await written([s.version]);
      refusedWith(await withdraw(s.branch, other), 409, 'version_not_published');
      refusedWith(await check(s.branch, other), 409, 'version_not_published');
      expect(await written([s.version])).toEqual(before);

      // Six minutes later it is 11 October in Tashkent, the start day, and
      // still the 10th in UTC.
      t.clock.set(new Date(new Date(START).getTime() + 6 * 60_000));
      try {
        refusedWith(await withdraw(s.branch, s.version), 409, 'withdraw_started');
        refusedWith(await check(s.branch, s.version), 409, 'withdraw_started');
        expect(await written([s.version])).toEqual(before);
      } finally {
        t.clock.set(START);
      }
      // The day before the start, it is withdrawn.
      versionOf(await withdraw(s.branch, s.version));
      before = await written([s.version]);
      refusedWith(await withdraw(s.branch, s.version), 409, 'version_not_published');
      refusedWith(await check(s.branch, s.version), 409, 'version_not_published');
      expect(await written([s.version])).toEqual(before);
    });

    it('refuses a version of a closed year, changing nothing', async () => {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, NOVEMBER));
      await t.database.migrator
        .updateTable('academic_years')
        .set({ status: 'closed' })
        .where('id', '=', s.year)
        .execute();
      const before = await written([s.version]);
      refusedWith(await withdraw(s.branch, s.version), 409, 'timetable_year_closed');
      refusedWith(await check(s.branch, s.version), 409, 'timetable_year_closed');
      expect(await written([s.version])).toEqual(before);
    });

    /** A scene whose teacher works in another branch too, with that branch's year. */
    async function sharedTeacher() {
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
      return { s, lessons, other, otherYear, otherClass };
    }

    // decision 5: the full rule set on the dates of the version that runs again.
    it('refuses with the date when the version that would run again meets another branch’s lesson there', async () => {
      const { s, lessons, other, otherYear, otherClass } = await sharedTeacher();
      versionOf(await publish(s.branch, s.version, MONDAY));
      // B has maths on Tuesdays: on Mondays from 9 November the teacher is free.
      const b = await copyOf(s, s.version, { mathsDay: 2 });
      versionOf(await publish(s.branch, b.version, NOVEMBER));
      const source = await lessons.source(other, otherYear.year, [
        { classId: otherClass, groupId: null, subjectId: s.subject },
      ]);
      // Another branch's lesson of the teacher on Monday 16 November at 08:00.
      const block = await t.database.migrator
        .insertInto('lesson_blocks')
        .values({
          branch_id: other,
          academic_year_id: otherYear.year,
          quarter_id: otherYear.quarters[1] ?? '',
          lesson_date: '2026-11-16',
          starts_at: at('2026-11-16', '08:00'),
          ends_at: at('2026-11-16', '08:45'),
          version_id: source.versionId,
          pattern_block_id: source.patternBlockId,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      await t.database.migrator
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
      const before = await written([s.version, source.versionId]);
      const details = blockedBy(await withdraw(s.branch, b.version));
      expect(details.length).toBeGreaterThan(0);
      expect(details.every((one) => one.code === 'date_blocked')).toBe(true);
      expect(details.map((one) => one.day)).toContain('2026-11-16');
      expect(await written([s.version, source.versionId])).toEqual(before);
    });

    /**
     * A published version of another branch from `startsOn`, its pattern
     * holding the scene's teacher on Mondays at 08:00, as `LessonsKit.source`
     * writes one; with `empty`, a version with no lesson.
     */
    async function weeklyElsewhere(
      other: string,
      year: string,
      otherClass: string,
      s: { subject: string; teacherId: string },
      startsOn: string,
      empty = false,
    ) {
      const versionId = await load.version(other, year, { startsOn });
      if (empty) {
        await load.setVersion(versionId, 'published');
        return { versionId, blockId: null, rowId: null };
      }
      const block = await t.database.migrator
        .insertInto('pattern_blocks')
        .values({
          branch_id: other,
          version_id: versionId,
          weekday: 1,
          slot_position: 1,
          start_minutes: 480,
          end_minutes: 525,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const rowId = await load.row({
        branch_id: other,
        version_id: versionId,
        class_id: otherClass,
        subject_id: s.subject,
        teacher_id: s.teacherId,
        lessons_per_week: 1,
      });
      await t.database.migrator
        .insertInto('pattern_entries')
        .values({
          branch_id: other,
          version_id: versionId,
          block_id: block.id,
          weekday: 1,
          start_minutes: 480,
          end_minutes: 525,
          load_row_id: rowId,
          teacher_id: s.teacherId,
        })
        .execute();
      await load.setVersion(versionId, 'published');
      return { versionId, blockId: block.id, rowId };
    }

    // Spec review must-fix 1: a blocked result of the pattern refuses too.
    it('refuses with the pattern when the version that would run again meets another branch’s weekly lesson', async () => {
      const { s, other, otherYear, otherClass } = await sharedTeacher();
      versionOf(await publish(s.branch, s.version, MONDAY));
      const b = await copyOf(s, s.version, { mathsDay: 2 });
      versionOf(await publish(s.branch, b.version, NOVEMBER));
      // The other branch's published pattern holds the teacher on Mondays at
      // 08:00 from 12 October, every week, and still on 9 November, the day
      // the version that runs again is read on (code review must-fix 1).
      const { versionId, blockId, rowId } = await weeklyElsewhere(
        other,
        otherYear.year,
        otherClass,
        s,
        MONDAY,
      );
      const source = { versionId };
      const before = await written([s.version, source.versionId]);
      const refused = await withdraw(s.branch, b.version);
      const details = blockedBy(refused);
      expect(details.map((one) => one.code)).toContain('pattern_blocked');
      // Permission review S2: no id of the other branch's pattern is named.
      const otherIds = [versionId, blockId, rowId];
      const otherEntries = await t.database.migrator
        .selectFrom('pattern_entries')
        .select('id')
        .where('branch_id', '=', other)
        .execute();
      const named = JSON.stringify((refused.body as { error: unknown }).error);
      for (const id of [...otherIds, ...otherEntries.map((one) => one.id)]) {
        expect(named).not.toContain(id);
      }
      expect(await written([s.version, source.versionId])).toEqual(before);
    });

    // Code review must-fix 1: the pattern is read on the withdrawn start, not
    // on the start of the version that runs again.
    it('goes ahead when another branch’s weekly lesson ends before the withdrawn start', async () => {
      const { s, other, otherYear, otherClass } = await sharedTeacher();
      versionOf(await publish(s.branch, s.version, MONDAY));
      const b = await copyOf(s, s.version, { mathsDay: 2 });
      versionOf(await publish(s.branch, b.version, NOVEMBER));
      // In force on 12 October, A's start; replaced from 2 November by a
      // version with no lesson of the teacher.
      await weeklyElsewhere(other, otherYear.year, otherClass, s, MONDAY);
      await weeklyElsewhere(other, otherYear.year, otherClass, s, '2026-11-02', true);
      versionOf(await withdraw(s.branch, b.version));
      const fromNovember = (await lessonsOf(s.branch)).filter((one) => one.date >= NOVEMBER);
      expect(fromNovember.length).toBeGreaterThan(0);
      expect(fromNovember.every((one) => one.version_id === s.version)).toBe(true);
    });

    // Spec review must-fix 2 (decision 5): a teacher who left is "needs a
    // teacher", never a refusal: the version that runs again cannot be edited.
    it('goes ahead when a teacher of the version that runs again has left, those lessons with no teacher', async () => {
      const s = await twoVersions();
      const left = await post(`/api/people/staff/${s.teacherId}/status`, s.branch, {
        status: 'left',
        from: '2026-11-02',
      });
      expect(left.status, JSON.stringify(left.body)).toBe(200);
      versionOf(await withdraw(s.branch, s.b));
      const fromNovember = (await lessonsOf(s.branch)).filter((one) => one.date >= NOVEMBER);
      expect(fromNovember.length).toBeGreaterThan(0);
      expect(fromNovember.every((one) => one.version_id === s.a && one.teacher_id === null)).toBe(
        true,
      );
    });
  });

  // decision 6: every draft of the branch and year is marked.
  describe('the drafts', () => {
    it('marks every draft of the branch and year, one started from the withdrawn version too', async () => {
      const s = await twoVersions();
      const fromB = await draft(s.branch, s.year, s.b);
      // Code review should-fix 5: from 16 November, when B was in force
      // before the withdraw and A is after it.
      await t.database.migrator
        .updateTable('timetable_versions')
        .set({ starts_on: '2026-11-16' })
        .where('id', '=', fromB)
        .execute();
      const fresh = await draft(s.branch, s.year);
      const elsewhere = await scene();
      // Code review must-fix 2: a draft of another year of the same branch.
      const nextYear = await load.classes.year(s.branch, 'planned', '2027-09-01', '2028-05-31');
      const created = await post('/api/timetable/versions', s.branch, {
        academicYearId: nextYear,
        startsOn: '2027-09-06',
        copyFrom: null,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const nextYearDraft = (created.body as { id: string }).id;
      versionOf(await withdraw(s.branch, s.b));
      for (const id of [fromB, fresh]) {
        expect(await causesOf(id)).toEqual([
          { action: 'timetable_version.withdraw', record_id: s.b },
        ]);
      }
      expect(await causesOf(elsewhere.version)).toEqual([]);
      expect(await causesOf(nextYearDraft)).toEqual([]);
      const entry = (await t.entries('timetable_version.withdraw', s.b))[0];
      expect((entry?.new_value as { markedOutOfDate: string[] }).markedOutOfDate.sort()).toEqual(
        [fromB, fresh].sort(),
      );
      // The out-of-date route names the cause and the version, and compares
      // with the version in force (the publish cause's path).
      const answer = await t.get(`/api/timetable/versions/${fromB}/out-of-date`, s.branch);
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      const parsed = outOfDateAnswerSchema.parse(answer.body);
      expect(parsed.causes.map((one) => [one.kind, one.action, one.record?.versionNumber])).toEqual(
        [['withdraw', 'timetable_version.withdraw', (await versionRow(s.b)).number]],
      );
      expect(parsed.other?.id).toBe(s.a);
      await load.freeEditLock(fromB);
      const brought = await post(`/api/timetable/versions/${fromB}/up-to-date`, s.branch, {
        key: parsed.key,
        picks: parsed.items.map((item) => ({ item: item.key, side: item.defaultPick ?? 'draft' })),
      });
      expect(brought.status, JSON.stringify(brought.body)).toBe(200);
      expect(await causesOf(fromB)).toEqual([]);
      expect((await versionRow(fromB)).from_version_id).toBe(s.a);
    });

    it('brings a draft of the withdrawn version up to date with no version left, naming no source (should-fix 3)', async () => {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, NOVEMBER));
      const copy = await draft(s.branch, s.year, s.version);
      versionOf(await withdraw(s.branch, s.version));
      const answer = outOfDateAnswerSchema.parse(
        (await t.get(`/api/timetable/versions/${copy}/out-of-date`, s.branch)).body,
      );
      expect(answer.other).toBeNull();
      await load.freeEditLock(copy);
      const brought = await post(`/api/timetable/versions/${copy}/up-to-date`, s.branch, {
        key: answer.key,
        picks: [],
      });
      expect(brought.status, JSON.stringify(brought.body)).toBe(200);
      expect(await causesOf(copy)).toEqual([]);
      expect((await versionRow(copy)).from_version_id).toBeNull();
    });
  });

  describe('the audit', () => {
    it('writes one entry with the version that runs again, the lessons and the journals', async () => {
      const s = await twoVersions();
      const count = await t.auditCount();
      versionOf(await withdraw(s.branch, s.b));
      const entries = await t.entries('timetable_version.withdraw', s.b);
      expect(entries).toHaveLength(1);
      // Permission review S3: the entry names the assignment that allowed it.
      expect(entries[0]?.assignment_id).toBe(t.adminAssignment);
      expect(entries[0]?.old_value).toEqual({
        status: 'published',
        number: (await versionRow(s.b)).number,
        startsOn: NOVEMBER,
      });
      const value = entries[0]?.new_value as {
        status: string;
        runsAgain: { id: string; number: number };
        runsAgainUntil: string;
        datedLessons: { firstDate: string; lastDate: string; kept: number; removed: unknown[] };
      };
      expect(value.status).toBe('archived');
      expect(value.runsAgain).toEqual({ id: s.a, number: (await versionRow(s.a)).number });
      expect(value.runsAgainUntil).toBe('2027-05-31');
      expect(value.datedLessons.firstDate).toBe(NOVEMBER);
      expect(value.datedLessons.lastDate).toBe('2027-05-31');
      expect(value.datedLessons.kept).toBeGreaterThan(0);
      expect(value.datedLessons.removed.length).toBeGreaterThan(0);
      expect(await t.auditCount()).toBeGreaterThan(count);
    });
  });

  describe('a repeat', () => {
    it('refuses a key of another account and answers a repeat of the same key once', async () => {
      const s = await twoVersions();
      const key = randomUUID();
      const first = versionOf(await withdraw(s.branch, s.b, t.admin, key));
      const after = await written([s.b]);
      const again = versionOf(await withdraw(s.branch, s.b, t.admin, key));
      expect(again).toEqual(first);
      expect(await t.entries('timetable_version.withdraw', s.b)).toHaveLength(1);
      await load.classes.role(
        (
          await t.database.migrator
            .selectFrom('assignments')
            .select('account_id')
            .where('id', '=', t.viceAssignment)
            .executeTakeFirstOrThrow()
        ).account_id,
        s.branch,
        'academic_vice_principal',
      );
      refusedWith(await withdraw(s.branch, s.b, t.vicePrincipal, key), 409, 'request_key_reused');
      // Permission review S1: the key is tied to its version too.
      refusedWith(await withdraw(s.branch, s.a, t.admin, key), 409, 'request_key_reused');
      expect(await written([s.b])).toEqual(after);
    });

    it('checks the permission and the branch again on a repeat, before the stored answer', async () => {
      const s = await twoVersions();
      const theirs = await twoVersions();
      await storedChanges(theirs);
      const key = randomUUID();
      versionOf(await withdraw(s.branch, s.b, t.admin, key));
      await storedChanges(s);
      const after = await written([s.b, theirs.b]);
      for (const id of [theirs.b, UNKNOWN]) {
        refusedWith(await withdraw(s.branch, id, t.admin, key), 404, 'not_found');
      }
      const principal = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', 'principal')
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      await load.classes.role(principal.account_id, s.branch, 'principal');
      expect((await withdraw(s.branch, s.b, t.principal, key)).status).toBe(403);
      expect(await written([s.b, theirs.b])).toEqual(after);
    });
  });

  // Task 5.6c-3a (edge/timetable, Exams: "An exam is stored on its own like a
  // one-day change and kept after a later publish"; Versions and drafts).
  describe('a standing exam', () => {
    it('keeps a standing exam over the version that runs again: its lessons there cancelled "exam" with the link, listed by the check', async () => {
      const s = await twoVersions();
      const lesson = (await lessonsOf(s.branch)).find(
        (row) => row.version_id === s.b && row.cancel_cause === null,
      );
      if (lesson === undefined) throw new Error('No lesson of the withdrawn dates.');
      const examId = await standingExamOver(t.database.migrator, {
        lessonId: lesson.id,
        roomId: await load.classes.room(s.branch),
        staffId: lesson.teacher_id ?? '',
      });
      const shown = await check(s.branch, s.b);
      expect(shown.status, JSON.stringify(shown.body)).toBe(200);
      const days = withdrawCheckSchema.parse(shown.body).dayChanges;
      expect(days.exams.map((one) => [one.key, one.category, one.noTimetable])).toEqual([
        [examId, 'kept', false],
      ]);
      // Without the key of the sorting shown, the withdraw is refused.
      refusedWith(await withdraw(s.branch, s.b), 409, 'withdraw_blocked');
      const done = await request(t.kit.server)
        .post(`/api/timetable/versions/${s.b}/withdraw`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ dayChangesKey: days.key });
      versionOf(done);
      const again = (await lessonsOf(s.branch)).filter(
        (row) => row.date === lesson.date && row.subject_id === lesson.subject_id,
      );
      expect(again.map((row) => [row.version_id, row.cancel_cause])).toEqual([[s.a, 'exam']]);
      const links = await t.database.migrator
        .selectFrom('lesson_exam_cancels')
        .select('exam_id')
        .where('lesson_id', '=', again[0]?.id ?? '')
        .execute();
      expect(links).toEqual([{ exam_id: examId }]);
      const [entry] = await t.entries('timetable_version.withdraw', s.b);
      expect(entry?.new_value).toMatchObject({ exams: { kept: [examId], decided: [] } });
    });
  });

  describe('another branch', () => {
    it("answers 404 for another branch's version and an unknown one, and changes nothing (should-fix 6)", async () => {
      const s = await twoVersions();
      const theirs = await twoVersions();
      // Rows a withdraw would change in both branches: dated lessons,
      // journals with runs, and a draft to mark.
      await draft(s.branch, s.year);
      await draft(theirs.branch, theirs.year);
      await storedChanges(s);
      await storedChanges(theirs);
      // Task 5.6c-3a (permission review, must-fix 1): a standing exam in each
      // branch over a lesson of the withdrawn dates, which a withdraw drops.
      for (const one of [s, theirs]) {
        const lesson = (await lessonsOf(one.branch)).find(
          (row) => row.version_id === one.b && row.cancel_cause === null,
        );
        if (lesson === undefined) throw new Error('No lesson of the withdrawn dates.');
        await standingExamOver(t.database.migrator, {
          lessonId: lesson.id,
          roomId: await load.classes.room(one.branch),
          staffId: lesson.teacher_id ?? '',
        });
      }
      const vice = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', t.viceAssignment)
        .executeTakeFirstOrThrow();
      await load.classes.role(vice.account_id, s.branch, 'academic_vice_principal');
      const before = await written([s.b, theirs.b]);
      expect(new Set(before[3].map((one) => one.branch_id)).size).toBe(2);
      expect(new Set(before[5].map((one) => one.branch_id)).size).toBe(2);
      expect(new Set(before[8].map((one) => one.branch_id)).size).toBe(2);
      expect(new Set(before[10].map((one) => one.branch_id)).size).toBe(2);
      // The exams and their links in both branches.
      expect(new Set(before[11].map((one) => one.branch_id)).size).toBe(2);
      expect(new Set(before[12].map((one) => one.branch_id)).size).toBe(2);
      for (const cookie of [t.admin, t.vicePrincipal]) {
        for (const id of [theirs.b, UNKNOWN]) {
          refusedWith(await withdraw(s.branch, id, cookie), 404, 'not_found');
        }
      }
      expect(await written([s.b, theirs.b])).toEqual(before);
    });
  });

  // Spec review must-fix 3 (.claude/rules/api.md and database.md): each pair
  // that meets on the publish lock or the year's versions, in both orders.
  describe('two at the same moment', () => {
    async function holdOpen(
      branches: string[],
      first: (transaction: Transaction) => Promise<unknown>,
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
        })
        .catch((error: unknown) => error);
      await Promise.race([isReady, done]);
      return { release, done };
    }

    async function waiting(locktype: string | null = null): Promise<number> {
      const found = await sql<{ n: number }>`
        select count(distinct l.pid)::int as n
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and not l.granted
          and (${locktype}::text is null or l.locktype = ${locktype}::text)
      `.execute(t.database.migrator);
      return found.rows[0]?.n ?? 0;
    }

    /** Two real requests behind a held lock, the first sent first. */
    async function inOrder(
      branch: string,
      hold: (transaction: Transaction) => Promise<unknown>,
      first: () => Promise<Response>,
      second: () => Promise<Response>,
    ): Promise<[Response, Response]> {
      const gate = await holdOpen([branch], hold);
      const one = first().then((response) => response);
      await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(1);
      const two = second().then((response) => response);
      await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(2);
      gate.release();
      expect(await gate.done).toBeUndefined();
      return Promise.all([one, two]);
    }

    const publishLock = (transaction: Transaction) =>
      sql`select pg_advisory_xact_lock(550001)`.execute(transaction);

    it('withdraws once when two withdraws meet, the second refused as not published', async () => {
      const s = await twoVersions();
      const [one, two] = await inOrder(
        s.branch,
        publishLock,
        () => withdraw(s.branch, s.b),
        () => withdraw(s.branch, s.b),
      );
      expect(versionOf(one).status).toBe('archived');
      refusedWith(two, 409, 'version_not_published');
      expect(await t.entries('timetable_version.withdraw', s.b)).toHaveLength(1);
    });

    it('runs a withdraw and a publish one after the other, in either order', async () => {
      for (const order of [0, 1]) {
        const s = await twoVersions();
        const d = await copyOf(s, s.b, { mathsDay: 3 });
        const send = () => publish(s.branch, d.version, '2026-12-07');
        const take = () => withdraw(s.branch, s.b);
        const [one, two] = await inOrder(
          s.branch,
          publishLock,
          order === 0 ? take : send,
          order === 0 ? send : take,
        );
        const [withdrawn, published] = order === 0 ? [one, two] : [two, one];
        expect(versionOf(withdrawn).status).toBe('archived');
        if (order === 0) {
          // Withdrawn first: the draft is marked and its publish refused.
          refusedWith(published, 409, 'publish_blocked');
          expect(await causesOf(d.version)).toEqual([
            { action: 'timetable_version.withdraw', record_id: s.b },
          ]);
          continue;
        }
        // Published first: A runs again only until D's start; D's lessons stay.
        expect(versionOf(published).status).toBe('published');
        const after = await lessonsOf(s.branch);
        const ofD = after.filter((one) => one.date >= '2026-12-07');
        const between = after.filter((one) => one.date >= NOVEMBER && one.date < '2026-12-07');
        expect(ofD.length).toBeGreaterThan(0);
        expect(between.length).toBeGreaterThan(0);
        expect(ofD.every((one) => one.version_id === d.version)).toBe(true);
        expect(between.every((one) => one.version_id === s.a)).toBe(true);
      }
    });

    /** Two versions with a Tutor row on Tuesdays, Tutor `first` until 16 November. */
    async function tutorVersions() {
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
      versionOf(await publish(s.branch, s.version, MONDAY));
      // B: a copy with maths moved to Wednesday, the Tutor row on Tuesday.
      const b = await draft(s.branch, s.year, s.version);
      await t.database.migrator.deleteFrom('pattern_blocks').where('version_id', '=', b).execute();
      const rows = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select(['id', 'subject_id'])
        .where('version_id', '=', b)
        .execute();
      for (const row of rows) {
        await placeAt(s.branch, b, row.id, row.subject_id === tutorSubject ? 2 : 3);
      }
      await confirmTemplates(s.branch, b);
      await load.freeEditLock(b);
      versionOf(await publish(s.branch, b, NOVEMBER));
      const secondRole = await load.classes.role(second.accountId, s.branch, 'tutor');
      return { ...s, a: s.version, b, tutorSubject, first, second, secondRole };
    }

    const tutorLessonsOf = async (s: { branch: string; tutorSubject: string }) =>
      (await lessonsOf(s.branch))
        .filter((one) => one.subject_id === s.tutorSubject)
        .map((one) => [one.date, one.teacher_id] as const);

    const versionsLock = (year: string) => (transaction: Transaction) =>
      transaction
        .selectFrom('timetable_versions')
        .select('id')
        .where('academic_year_id', '=', year)
        .orderBy('id')
        .forNoKeyUpdate()
        .execute();

    it('gives the Tutor lessons to the new Tutor when a Tutor give and a withdraw meet, in either order', async () => {
      for (const order of [0, 1]) {
        const s = await tutorVersions();
        const give = () =>
          post(`/api/classes/${s.classId}/tutors`, s.branch, {
            assignmentId: s.secondRole,
            kind: 'tutor',
            from: '2026-11-16',
            until: null,
          });
        const take = () => withdraw(s.branch, s.b);
        const [one, two] = await inOrder(
          s.branch,
          versionsLock(s.year),
          order === 0 ? take : give,
          order === 0 ? give : take,
        );
        const [withdrawn, given] = order === 0 ? [one, two] : [two, one];
        expect(versionOf(withdrawn).status).toBe('archived');
        expect(given.status, JSON.stringify(given.body)).toBe(201);
        const lessons = await tutorLessonsOf(s);
        expect(lessons.length).toBeGreaterThan(0);
        for (const [date, teacher] of lessons) {
          expect(teacher).toBe(date < '2026-11-16' ? s.first.staffId : s.second.staffId);
        }
      }
    });

    it('lets a leaving and a withdraw both commit, in either order, the Tutor lessons after the leaving with no teacher', async () => {
      for (const order of [0, 1]) {
        const s = await tutorVersions();
        const leave = () =>
          post(`/api/people/staff/${s.first.staffId}/status`, s.branch, {
            status: 'left',
            from: '2026-11-02',
          });
        const take = () => withdraw(s.branch, s.b);
        const [one, two] = await inOrder(
          s.branch,
          versionsLock(s.year),
          order === 0 ? take : leave,
          order === 0 ? leave : take,
        );
        const [withdrawn, left] = order === 0 ? [one, two] : [two, one];
        expect(versionOf(withdrawn).status).toBe('archived');
        expect(left.status, JSON.stringify(left.body)).toBe(200);
        const lessons = await tutorLessonsOf(s);
        expect(lessons.length).toBeGreaterThan(0);
        for (const [date, teacher] of lessons) {
          expect(teacher).toBe(date < '2026-11-02' ? s.first.staffId : null);
        }
      }
    });

    // Code review must-fix 3: the first version of the chain withdrawn, so
    // that the class has lessons after today only while it stands; which
    // side commits first decides whether the archive goes through.
    it('runs an archive of the class and a withdraw one after the other, in either order, the archive deciding by the lessons left', async () => {
      for (const order of [0, 1]) {
        const s = await scene();
        versionOf(await publish(s.branch, s.version, NOVEMBER));
        expect((await lessonsOf(s.branch)).length).toBeGreaterThan(0);
        const archive = () => post(`/api/classes/${s.classId}/archive`, s.branch, {});
        const take = () => withdraw(s.branch, s.version);
        const [one, two] = await inOrder(
          s.branch,
          order === 0
            ? versionsLock(s.year)
            : (transaction) =>
                transaction
                  .selectFrom('classes')
                  .select('id')
                  .where('id', '=', s.classId)
                  .forUpdate()
                  .execute(),
          order === 0 ? take : archive,
          order === 0 ? archive : take,
        );
        const [withdrawn, archived] = order === 0 ? [one, two] : [two, one];
        expect(versionOf(withdrawn).status).toBe('archived');
        expect(await lessonsOf(s.branch)).toEqual([]);
        if (order === 0) {
          // Withdrawn first: no lesson is left, so the class is archived.
          expect(archived.status, JSON.stringify(archived.body)).toBe(200);
        } else {
          // Archive first: the class still has the version's lessons.
          refusedWith(archived, 409, 'class_has_lessons');
        }
      }
    });
  });

  // Decision 2: the check of 0077 gains the withdraw's action, nothing else.
  describe('the database', () => {
    it('accepts a cause of a withdraw and still refuses an unknown action', async () => {
      const s = await twoVersions();
      const target = await draft(s.branch, s.year);
      await t.database.migrator
        .insertInto('timetable_version_out_of_date_causes')
        .values({
          branch_id: s.branch,
          version_id: target,
          action: 'timetable_version.withdraw',
          record_id: s.b,
          caused_at: new Date(START),
        })
        .execute();
      await expect(
        t.database.migrator
          .insertInto('timetable_version_out_of_date_causes')
          .values({
            branch_id: s.branch,
            version_id: target,
            action: 'timetable_version.restore',
            record_id: s.b,
            caused_at: new Date(START),
          })
          .execute(),
      ).rejects.toMatchObject({ constraint: 'timetable_version_out_of_date_causes_action_check' });
    });
  });

  // Task 5.5c-3a, pull request #158 (5.5c-2a decision 8): "When a published
  // timetable changes, the affected teachers are notified at once" (`06`,
  // Views and outputs); one notice per person, with the week before and after
  // (edge/timetable, After publishing).
  describe('notices', () => {
    const noticesOf = (branch: string) =>
      t.database.migrator
        .selectFrom('notifications')
        .select(['account_id', 'branch_id', 'data'])
        .where('branch_id', '=', branch)
        .where('kind', '=', 'timetable.withdrawn')
        .orderBy('account_id')
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
        .execute();

    it('notifies the teacher whose lessons the withdraw removes, and not one whose week is the same', async () => {
      const v = await twoVersions();
      const artRow = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('teacher_id')
        .where('version_id', '=', v.b)
        .where('subject_id', '=', v.art)
        .executeTakeFirstOrThrow();
      if (artRow.teacher_id === null) throw new Error('Art has its teacher.');
      // B's publish marked its Art lessons; they go with their lessons.
      expect((await marksOf(v.branch)).length).toBeGreaterThan(0);
      versionOf(await withdraw(v.branch, v.b));
      const notices = await noticesOf(v.branch);
      expect(notices.map((one) => one.account_id)).toEqual([await accountOf(artRow.teacher_id)]);
      const number = (await versionRow(v.b)).number;
      expect(notices[0]?.data).toMatchObject({
        number: String(number),
        weekStart: NOVEMBER,
        before: [{ date: '2026-11-10', cancelled: false }],
        after: [],
      });
      // A's maths lessons are as B had them: nothing is marked, and the removed lessons' marks are gone.
      expect(await marksOf(v.branch)).toEqual([]);
      const [entry] = await t.entries('timetable_version.withdraw', v.b);
      expect(entry?.new_value).toMatchObject({ notices: { notified: 1, marked: 0 } });
    });

    // Code review should-fixes 4 and 5: the version that runs again marks what
    // it changes, and a run that ends mid-week shows the whole week.
    it('marks the lessons of the version that runs again and shows the whole week of a run that ends mid-week', async () => {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, MONDAY));
      // B: maths on Wednesday from 9 November; C: maths on Friday from Thursday 12 November.
      const b = await copyOf(s, s.version, { mathsDay: 3 });
      versionOf(await publish(s.branch, b.version, NOVEMBER));
      const c = await copyOf(s, b.version, { mathsDay: 5 });
      const check = await t.get(
        `/api/timetable/versions/${c.version}/publish-check?startsOn=2026-11-12`,
        s.branch,
        t.admin,
      );
      expect(check.status, JSON.stringify(check.body)).toBe(200);
      const key = (check.body as { impact: { transition: { key: string | null } | null } | null })
        .impact?.transition?.key;
      versionOf(
        await publish(s.branch, c.version, '2026-11-12', key == null ? {} : { transitionKey: key }),
      );
      // B runs from Monday 9 to Wednesday 11 November; A runs again over it.
      versionOf(await withdraw(s.branch, b.version));
      const notices = await noticesOf(s.branch);
      expect(notices.map((one) => one.account_id)).toEqual([await accountOf(s.teacherId)]);
      expect(notices[0]?.data).toMatchObject({
        weekStart: NOVEMBER,
        before: [
          { date: '2026-11-11', changed: true },
          { date: '2026-11-13', changed: false },
        ],
        after: [
          { date: NOVEMBER, changed: true },
          { date: '2026-11-13', changed: false },
        ],
      });
      // Monday 9 November is marked: its week had lessons before.
      const marked = await t.database.migrator
        .selectFrom('lesson_changes')
        .innerJoin('lessons', 'lessons.id', 'lesson_changes.lesson_id')
        .select(sql<string>`lessons.lesson_date::text`.as('date'))
        .where('lesson_changes.branch_id', '=', s.branch)
        .where('lesson_changes.changed_at', '=', new Date(START))
        .where('lessons.lesson_date', '>=', NOVEMBER)
        .where('lessons.lesson_date', '<', '2026-11-12')
        .execute();
      expect(marked.map((one) => one.date)).toEqual([NOVEMBER]);
      const [entry] = await t.entries('timetable_version.withdraw', b.version);
      expect(entry?.new_value).toMatchObject({ notices: { notified: 1, marked: 1 } });
    });

    it('notifies the teacher of a version withdrawn with none before it', async () => {
      const s = await scene();
      versionOf(await publish(s.branch, s.version, NOVEMBER));
      versionOf(await withdraw(s.branch, s.version));
      const notices = await noticesOf(s.branch);
      expect(notices.map((one) => one.account_id)).toEqual([await accountOf(s.teacherId)]);
      expect(notices[0]?.branch_id).toBe(s.branch);
      expect(notices[0]?.data).toMatchObject({
        weekStart: NOVEMBER,
        before: [{ date: NOVEMBER }],
        after: [],
      });
    });
  });
});
