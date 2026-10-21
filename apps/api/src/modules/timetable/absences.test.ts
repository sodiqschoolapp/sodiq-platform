import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  absenceLessonsSchema,
  absenceListSchema,
  absenceSchema,
  attentionSchema,
  dayAnswerSchema,
  staffReportSchema,
} from '@sodiq/shared';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  MONDAY,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { followTutors } from './tutor-lessons.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const ok = (response: Response, status = 200) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response;
};

/** The quarters of the year 2026-09-01 to 2027-05-31, dated. */
const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

/** A moment of a school date at a clock time in Tashkent (+05:00). */
const at = (date: string, time: string): Date => new Date(`${date}T${time}:00+05:00`);

const TODAY = '2026-10-10';
const SUNDAY = '2026-10-11';
const TUESDAY = '2026-10-13';
const NEXT_MONDAY = '2026-10-19';
const FRIDAY_BEFORE = '2026-10-09';

// All names are invented. Task 5.7a-1, pull request #185: teacher absences
// (docs/spec/06-timetable.md, Teachers who work in several branches:
// "Absence. An absence is entered once for the person and covers every
// branch. Each branch's Academic Vice Principal gets the list of own affected
// lessons and arranges substitutes; the other is told."; edge/timetable,
// After publishing: "A teacher is ill for weeks with no return date. An
// absence record has a start and an end, or is open-ended. All lessons in the
// range go to 'needs a teacher'. ... Shortening the absence returns future
// lessons to the teacher. After 10 school days the system suggests a
// permanent change." and "The lesson time passes and nobody was assigned. The
// lesson stays 'unresolved' on the Academic Vice Principal's home page until
// it is cancelled with a reason or the person who taught it is recorded. It
// never counts as held"). The clock stands at 23:55 on Saturday 10 October
// 2026 in Tashkent, unless a test moves it with a session of its own.
describe('teacher absences', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;

  const create = (branch: string, body: object, cookie = t.admin) =>
    t.post('/api/timetable/absences', branch, body, cookie);
  const edit = (branch: string, id: string, body: object, cookie = t.admin) =>
    t.patch(`/api/timetable/absences/${id}`, branch, body, cookie);
  const withdraw = (branch: string, id: string, cookie = t.admin) =>
    t.post(`/api/timetable/absences/${id}/withdraw`, branch, {}, cookie);
  const list = (branch: string, query = '', cookie = t.admin) =>
    t.get(`/api/timetable/absences${query}`, branch, cookie);
  const lessonsOf = (branch: string, id: string, cookie = t.admin) =>
    t.get(`/api/timetable/absences/${id}/lessons`, branch, cookie);
  const attention = async (branch: string, cookie = t.admin) =>
    attentionSchema.parse(ok(await t.get('/api/timetable/attention', branch, cookie)).body);
  const day = async (branch: string, classId: string, date: string, cookie = t.admin) =>
    dayAnswerSchema.parse(
      ok(await t.get(`/api/timetable/day?date=${date}&classId=${classId}`, branch, cookie)).body,
    );

  const entered = async (branch: string, body: object, cookie = t.admin) =>
    absenceSchema.parse(ok(await create(branch, body, cookie), 201).body);

  /** Hours of a person in the branch from 1 September, all day on the weekdays given. */
  async function hours(branch: string, staffId: string, weekdays = [1, 2, 3, 4, 5]) {
    const entry = await t.database.migrator
      .insertInto('staff_availability')
      .values({ branch_id: branch, staff_id: staffId, valid_from: '2026-09-01' })
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
          valid_from: '2026-09-01',
          valid_until: entry.valid_until,
        })
        .execute();
    }
  }

  const placeAt = async (
    branch: string,
    version: string,
    loadRowId: string,
    weekday: number,
    slotPosition = 1,
  ) => {
    const placed = await t.post(`/api/timetable/versions/${version}/pattern`, branch, {
      loadRowId,
      weekday,
      slotPosition,
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  };

  /**
   * A branch (its own unless given) with a year of four dated quarters, a day
   * of three lessons from 08:00 on every weekday, a class of grade 7 and a
   * version published from Monday 12 October: maths of the class on `weekday`
   * in the first lesson (and the second with `twoLessons`) by `teacher` (a
   * new one unless given), the other class's maths by a vacancy with
   * `vacancy`, and a Tutor row of the class on Tuesday with `tutor`.
   */
  async function scene(
    input: {
      branch?: string;
      teacher?: { staffId: string; accountId: string };
      weekday?: number;
      twoLessons?: boolean;
      vacancy?: boolean;
      tutor?: boolean;
    } = {},
  ) {
    const branch = input.branch ?? (await t.newBranch());
    const weekday = input.weekday ?? 1;
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
    const otherRoom = await load.classes.room(branch);
    const classId = await load.classes.schoolClass(branch, year, { grade: 7, room });
    let teacher = input.teacher;
    if (teacher === undefined) {
      teacher = await load.teacher(branch, { subjects: [{ subject, grades: [7] }] });
      await hours(branch, teacher.staffId);
    } else {
      await load.profile(teacher.staffId, [{ subject, grades: [7] }]);
      await hours(branch, teacher.staffId, [weekday]);
    }
    const created = await t.post('/api/timetable/versions', branch, {
      academicYearId: year,
      startsOn: MONDAY,
      copyFrom: null,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const version = (created.body as { id: string }).id;
    const rowId = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: classId,
      subject_id: subject,
      teacher_id: teacher.staffId,
      lessons_per_week: input.twoLessons === true ? 2 : 1,
      double_lessons: input.twoLessons === true,
    });
    await placeAt(branch, version, rowId, weekday);
    if (input.twoLessons === true) await placeAt(branch, version, rowId, weekday, 3);
    let vacancy: string | null = null;
    let otherClass: string | null = null;
    if (input.vacancy === true) {
      otherClass = await load.classes.schoolClass(branch, year, { grade: 7, room: otherRoom });
      vacancy = await load.vacancy(branch, { subjects: [{ subject, grades: [7] }] });
      await hours(branch, vacancy);
      const otherRow = await load.row({
        branch_id: branch,
        version_id: version,
        class_id: otherClass,
        subject_id: subject,
        teacher_id: vacancy,
        lessons_per_week: 1,
      });
      await placeAt(branch, version, otherRow, weekday);
    }
    let tutor: { staffId: string; accountId: string } | null = null;
    let tutorSubject: string | null = null;
    if (input.tutor === true) {
      tutorSubject = await load.tutorSubject({ grades: [7] });
      await t.database.migrator
        .updateTable('subjects')
        .set({ journal_type: 'attendance_only' })
        .where('id', '=', tutorSubject)
        .execute();
      tutor = await load.teacher(branch);
      await hours(branch, tutor.staffId);
      await load.tutorOf(branch, classId, tutor.accountId);
      const row = await t.post(`/api/timetable/versions/${version}/load`, branch, {
        classId,
        groupId: null,
        subjectId: tutorSubject,
        teacherId: null,
        lessonsPerWeek: 1,
        roomId: null,
        roomType: null,
        doubleLessons: false,
      });
      expect(row.status, JSON.stringify(row.body)).toBe(201);
      await placeAt(branch, version, (row.body as { id: string }).id, 2);
    }
    const confirmed = await t.post(`/api/timetable/versions/${version}/templates/confirm`, branch);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    await load.freeEditLock(version);
    const published = await request(t.kit.server)
      .post(`/api/timetable/versions/${version}/publish`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ startsOn: MONDAY });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    return {
      branch,
      year,
      subject,
      classId,
      otherClass,
      teacher,
      version,
      vacancy,
      tutor,
      tutorSubject,
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /** The stored lessons of the scene's class and subject on a date, by start. */
  const lessonsOn = (s: Scene, date: string, subject = s.subject) =>
    t.database.migrator
      .selectFrom('lessons')
      .selectAll()
      .where('branch_id', '=', s.branch)
      .where('class_id', '=', s.classId)
      .where('subject_id', '=', subject)
      .where('lesson_date', '=', date)
      .orderBy('starts_at')
      .execute();

  /** The state of each of the class's lessons of the subject on a date, by start. */
  const statesOn = async (s: Scene, date: string, cookie = t.admin) =>
    (await day(s.branch, s.classId, date, cookie)).lessons
      .filter((one) => one.subject.id === s.subject)
      .sort((a, b) => a.start - b.start)
      .map((one) => ({ state: one.state, absent: one.away === 'absence' }));

  /** An absence written by the migrator, past the route's rule on the past. */
  async function stored(
    staffId: string,
    days: { startsOn: string; endsOn: string | null },
    moments: { from: Date; until: Date | null },
  ): Promise<string> {
    const account = await load.classes.account();
    const row = await t.database.migrator
      .insertInto('absences')
      .values({
        staff_id: staffId,
        starts_on: days.startsOn,
        ends_on: days.endsOn,
        applies_from: moments.from,
        applies_until: moments.until,
        reason: 'Ill',
        created_by: account,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /**
   * Runs `work` with the clock at `moment` and an Academic Vice Principal of the branch signed in then
   * (the kit's sessions would end after 15 idle minutes); the clock goes back
   * to the start afterwards.
   */
  async function asViceAt(branch: string, moment: Date, work: (cookie: string) => Promise<void>) {
    t.clock.set(moment);
    try {
      const browser = await t.kit.completeSession('Lola', 'Rahimova');
      await t.kit.giveRole(browser.account.id, {
        role: 'academic_vice_principal',
        branchId: branch,
      });
      await work(browser.cookie);
    } finally {
      t.clock.set(START);
    }
  }

  /**
   * Every row of the tables the routes write, in every branch (permission
   * review must-fix 2; `.claude/rules/api.md`).
   */
  const everything = () =>
    Promise.all([
      t.database.migrator.selectFrom('absences').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('notifications').select('id').orderBy('id').execute(),
      t.database.migrator.selectFrom('audit_log').select('id').orderBy('id').execute(),
      t.database.migrator
        .selectFrom('lesson_absence_taught')
        .selectAll()
        .orderBy('lesson_id')
        .execute(),
      // Task 5.7b-2: a shortening or a withdraw returns substituted lessons.
      t.database.migrator.selectFrom('lessons').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('substitutions').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('substitution_lessons').selectAll().orderBy('id').execute(),
    ]);

  const noticesOf = (accountId: string, branch: string) =>
    t.database.migrator
      .selectFrom('notifications')
      .select(['kind', 'data', 'branch_id'])
      .where('account_id', '=', accountId)
      .where('branch_id', '=', branch)
      .where('kind', 'like', 'timetable.absence%')
      .orderBy('created_at')
      .orderBy('id')
      .execute();

  /** The account id of a session's cookie owner, by its assignment. */
  const viceAccount = async () =>
    (
      await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', t.viceAssignment)
        .executeTakeFirstOrThrow()
    ).account_id;

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('who may', () => {
    it('lets the Academic Vice Principal enter, change and withdraw, and the Principal read', async () => {
      const person = await load.teacher(t.north);
      const absence = await entered(
        t.north,
        { staffId: person.staffId, startsOn: '2026-11-02', endsOn: null, reason: 'Course' },
        t.vicePrincipal,
      );
      expect(absence).toMatchObject({ state: 'planned', canEdit: true, canWithdraw: true });
      const [entry] = await t.entries('absence.create', absence.id);
      expect(entry).toMatchObject({
        branch_id: t.north,
        assignment_id: t.viceAssignment,
        request_id: expect.any(String) as unknown,
      });
      const changed = absenceSchema.parse(
        ok(
          await edit(
            t.north,
            absence.id,
            { startsOn: '2026-11-02', endsOn: '2026-11-06' },
            t.vicePrincipal,
          ),
        ).body,
      );
      expect(changed.endsOn).toBe('2026-11-06');
      const listed = absenceListSchema.parse(ok(await list(t.north, '', t.principal)).body);
      expect(listed.absences.map((one) => one.id)).toContain(absence.id);
      ok(await lessonsOf(t.north, absence.id, t.principal));
      await attention(t.north, t.principal);
      const gone = absenceSchema.parse(
        ok(await withdraw(t.north, absence.id, t.vicePrincipal)).body,
      );
      expect(gone.state).toBe('withdrawn');
      expect(await t.entries('absence.edit', absence.id)).toHaveLength(1);
      expect(await t.entries('absence.withdraw', absence.id)).toHaveLength(1);
    });

    it('refuses every write to the Principal and the Teacher, with nothing written', async () => {
      const person = await load.teacher(t.north);
      const absence = await entered(t.north, {
        staffId: person.staffId,
        startsOn: '2026-11-09',
        endsOn: null,
        reason: 'Course',
      });
      // A Head Teacher and a Tutor of the branch too (spec review must-fix 4b).
      const headTeacher = await t.kit.fullSession('Nodira', 'Qodirova');
      await t.kit.giveRole(headTeacher.account.id, { role: 'head_teacher', branchId: t.north });
      const tutor = await t.kit.fullSession('Sardor', 'Toshmatov');
      await t.kit.giveRole(tutor.account.id, { role: 'tutor', branchId: t.north });
      const before = await everything();
      for (const cookie of [t.principal, t.teacher, headTeacher.cookie, tutor.cookie]) {
        refusedWith(
          await create(
            t.north,
            { staffId: person.staffId, startsOn: '2026-12-01', endsOn: null, reason: 'Ill' },
            cookie,
          ),
          403,
          'permission_denied',
        );
        refusedWith(
          await edit(t.north, absence.id, { startsOn: '2026-11-10', endsOn: null }, cookie),
          403,
          'permission_denied',
        );
        refusedWith(await withdraw(t.north, absence.id, cookie), 403, 'permission_denied');
      }
      for (const cookie of [t.teacher, headTeacher.cookie, tutor.cookie]) {
        refusedWith(await lessonsOf(t.north, absence.id, cookie), 403, 'permission_denied');
        refusedWith(await list(t.north, '', cookie), 403, 'permission_denied');
        refusedWith(
          await t.get('/api/timetable/attention', t.north, cookie),
          403,
          'permission_denied',
        );
      }
      expect(await everything()).toEqual(before);
      const row = await t.database.migrator
        .selectFrom('absences')
        .select(['starts_on', 'withdrawn_at'])
        .where('id', '=', absence.id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ starts_on: '2026-11-09', withdrawn_at: null });
    });

    it('answers 404 for another branch’s absence, an unknown one and a person not of the branch, and 422 for a vacancy', async () => {
      const elsewhere = await load.teacher(t.south);
      const other = await entered(t.south, {
        staffId: elsewhere.staffId,
        startsOn: '2026-11-02',
        endsOn: null,
        reason: 'Course',
      });
      const vacancy = await load.vacancy(t.north);
      const before = await everything();
      for (const id of [other.id, UNKNOWN]) {
        refusedWith(
          await edit(t.north, id, { startsOn: '2026-11-03', endsOn: null }),
          404,
          'not_found',
        );
        refusedWith(await withdraw(t.north, id), 404, 'not_found');
        refusedWith(await lessonsOf(t.north, id), 404, 'not_found');
      }
      for (const staffId of [elsewhere.staffId, UNKNOWN]) {
        refusedWith(
          await create(t.north, { staffId, startsOn: '2026-12-01', endsOn: null, reason: 'Ill' }),
          404,
          'not_found',
        );
      }
      refusedWith(
        await create(t.north, {
          staffId: vacancy,
          startsOn: '2026-12-01',
          endsOn: null,
          reason: 'Ill',
        }),
        422,
        'absence_person',
      );
      expect(await everything()).toEqual(before);
      const row = await t.database.migrator
        .selectFrom('absences')
        .select(['starts_on', 'withdrawn_at'])
        .where('id', '=', other.id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ starts_on: '2026-11-02', withdrawn_at: null });
      expect(
        absenceListSchema
          .parse(ok(await list(t.north, '?state=all')).body)
          .absences.map((one) => one.id),
      ).not.toContain(other.id);
    });

    it('refuses an empty reason and a last day before the first', async () => {
      const person = await load.teacher(t.north);
      refusedWith(
        await create(t.north, {
          staffId: person.staffId,
          startsOn: '2026-12-01',
          endsOn: null,
          reason: ' ',
        }),
        400,
        'validation_failed',
      );
      refusedWith(
        await create(t.north, {
          staffId: person.staffId,
          startsOn: '2026-12-02',
          endsOn: '2026-12-01',
          reason: 'Ill',
        }),
        400,
        'validation_failed',
      );
    });
  });

  describe('the rules of a save (decision 5)', () => {
    it('refuses a first day before today, and an absence that meets another of the person, naming it', async () => {
      const person = await load.teacher(t.north);
      refusedWith(
        await create(t.north, {
          staffId: person.staffId,
          startsOn: FRIDAY_BEFORE,
          endsOn: null,
          reason: 'Ill',
        }),
        409,
        'absence_past',
      );
      const first = await entered(t.north, {
        staffId: person.staffId,
        startsOn: '2026-11-02',
        endsOn: '2026-11-06',
        reason: 'Course',
      });
      const overlap = await create(t.north, {
        staffId: person.staffId,
        startsOn: '2026-11-06',
        endsOn: null,
        reason: 'Ill',
      });
      refusedWith(overlap, 409, 'absence_overlap');
      const details = (
        overlap.body as { error: { details: { recordId?: string; day?: string }[] } }
      ).error.details;
      expect(details[0]).toMatchObject({ recordId: first.id, day: '2026-11-02' });
      // The day after the last is free.
      await entered(t.north, {
        staffId: person.staffId,
        startsOn: '2026-11-07',
        endsOn: null,
        reason: 'Ill',
      });
    });

    it('refuses a change of the first day of a started absence, an end before yesterday and a withdraw after the start', async () => {
      const person = await load.teacher(t.north);
      const id = await stored(
        person.staffId,
        { startsOn: '2026-10-05', endsOn: null },
        { from: at('2026-10-05', '00:00'), until: null },
      );
      refusedWith(
        await edit(t.north, id, { startsOn: '2026-10-06', endsOn: null }),
        409,
        'absence_past',
      );
      refusedWith(
        await edit(t.north, id, { startsOn: '2026-10-05', endsOn: '2026-10-08' }),
        409,
        'absence_past',
      );
      refusedWith(await withdraw(t.north, id), 409, 'absence_past');
      // Today or later is taken.
      const changed = absenceSchema.parse(
        ok(await edit(t.north, id, { startsOn: '2026-10-05', endsOn: '2026-10-16' })).body,
      );
      expect(changed).toMatchObject({ endsOn: '2026-10-16', state: 'current', canWithdraw: false });
    });

    it('refuses any change of an absence that has ended: a new one is entered instead (review correction 2)', async () => {
      const person = await load.teacher(t.north);
      const id = await stored(
        person.staffId,
        { startsOn: '2026-10-05', endsOn: '2026-10-07' },
        { from: at('2026-10-05', '00:00'), until: at('2026-10-08', '00:00') },
      );
      refusedWith(
        await edit(t.north, id, { startsOn: '2026-10-05', endsOn: '2026-10-20' }),
        409,
        'absence_past',
      );
      refusedWith(
        await edit(t.north, id, { startsOn: '2026-10-05', endsOn: null }),
        409,
        'absence_past',
      );
      const row = await t.database.migrator
        .selectFrom('absences')
        .select(['ends_on', 'applies_until'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ ends_on: '2026-10-07', applies_until: at('2026-10-08', '00:00') });
    });

    it('moves the first day of a planned absence, and keeps a withdraw final', async () => {
      const person = await load.teacher(t.north);
      const absence = await entered(t.north, {
        staffId: person.staffId,
        startsOn: '2026-11-02',
        endsOn: '2026-11-06',
        reason: 'Course',
      });
      ok(await edit(t.north, absence.id, { startsOn: '2026-11-03', endsOn: '2026-11-06' }));
      const row = await t.database.migrator
        .selectFrom('absences')
        .select(['starts_on', 'applies_from'])
        .where('id', '=', absence.id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ starts_on: '2026-11-03', applies_from: at('2026-11-03', '00:00') });
      ok(await withdraw(t.north, absence.id));
      refusedWith(await withdraw(t.north, absence.id), 409, 'absence_withdrawn');
      refusedWith(
        await edit(t.north, absence.id, { startsOn: '2026-11-03', endsOn: null }),
        409,
        'absence_withdrawn',
      );
      // The withdrawn absence holds no days: the same days take a new one.
      await entered(t.north, {
        staffId: person.staffId,
        startsOn: '2026-11-03',
        endsOn: '2026-11-06',
        reason: 'Course',
      });
    });

    it('lists the open absences by default and every one with state=all', async () => {
      const person = await load.teacher(t.north);
      const ended = await stored(
        person.staffId,
        { startsOn: '2026-10-01', endsOn: '2026-10-02' },
        { from: at('2026-10-01', '00:00'), until: at('2026-10-03', '00:00') },
      );
      const open = await entered(t.north, {
        staffId: person.staffId,
        startsOn: '2026-12-07',
        endsOn: null,
        reason: 'Course',
      });
      const ids = async (query: string) =>
        absenceListSchema.parse(ok(await list(t.north, query)).body).absences.map((one) => one.id);
      expect(await ids('')).toContain(open.id);
      expect(await ids('')).not.toContain(ended);
      expect(await ids('?state=all')).toEqual(expect.arrayContaining([open.id, ended]));
      const all = absenceListSchema.parse(ok(await list(t.north, '?state=all')).body).absences;
      expect(all.find((one) => one.id === ended)).toMatchObject({
        state: 'ended',
        canEdit: false,
        canWithdraw: false,
      });
    });
  });

  describe('the state of the lessons', () => {
    it('puts the absent person’s lessons under "needs a teacher", keeping the teacher, and gives them back when shortened', async () => {
      const s = await scene();
      const absence = await entered(s.branch, {
        staffId: s.teacher.staffId,
        startsOn: NEXT_MONDAY,
        endsOn: null,
        reason: 'Ill',
      });
      expect(await statesOn(s, NEXT_MONDAY)).toEqual([{ state: 'needs_teacher', absent: true }]);
      // Outside the absence, the same teacher's lesson is as before.
      expect(await statesOn(s, MONDAY)).toEqual([{ state: 'upcoming', absent: false }]);
      const [stored0] = await lessonsOn(s, NEXT_MONDAY);
      expect(stored0?.teacher_id).toBe(s.teacher.staffId);
      const listed = absenceLessonsSchema.parse(ok(await lessonsOf(s.branch, absence.id)).body);
      expect(listed.lessons[0]).toMatchObject({ date: NEXT_MONDAY, state: 'needs_teacher' });
      expect(listed.lessons.every((one) => one.date >= NEXT_MONDAY)).toBe(true);
      // Shortened to end before the next Monday: the lesson comes back.
      ok(await edit(s.branch, absence.id, { startsOn: NEXT_MONDAY, endsOn: NEXT_MONDAY }));
      expect(await statesOn(s, '2026-10-26')).toEqual([{ state: 'upcoming', absent: false }]);
      expect(await statesOn(s, NEXT_MONDAY)).toEqual([{ state: 'needs_teacher', absent: true }]);
    });

    it('keeps a lesson that started before an absence entered today held, and takes the later one (decision 5)', async () => {
      const s = await scene({ twoLessons: true });
      await asViceAt(s.branch, at(MONDAY, '08:30'), async (cookie) => {
        await entered(
          s.branch,
          { staffId: s.teacher.staffId, startsOn: MONDAY, endsOn: MONDAY, reason: 'Ill' },
          cookie,
        );
        expect(await statesOn(s, MONDAY, cookie)).toEqual([
          { state: 'held', absent: false },
          { state: 'needs_teacher', absent: true },
        ]);
      });
    });

    it('ends an absence that started today at the save when its end is set to yesterday, its last day kept at its first (review correction 1)', async () => {
      const s = await scene({ twoLessons: true });
      let id = '';
      await asViceAt(s.branch, at(MONDAY, '07:50'), async (cookie) => {
        id = (
          await entered(
            s.branch,
            { staffId: s.teacher.staffId, startsOn: MONDAY, endsOn: null, reason: 'Ill' },
            cookie,
          )
        ).id;
      });
      await asViceAt(s.branch, at(MONDAY, '08:50'), async (cookie) => {
        const ended = absenceSchema.parse(
          ok(await edit(s.branch, id, { startsOn: MONDAY, endsOn: SUNDAY }, cookie)).body,
        );
        expect(ended).toMatchObject({ startsOn: MONDAY, endsOn: MONDAY, state: 'ended' });
        // 08:00 started inside the absence: unresolved; 08:55 is the teacher's again.
        expect(await statesOn(s, MONDAY, cookie)).toEqual([
          { state: 'unresolved', absent: true },
          { state: 'upcoming', absent: false },
        ]);
      });
      const row = await t.database.migrator
        .selectFrom('absences')
        .select(['ends_on', 'applies_from', 'applies_until'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({
        ends_on: MONDAY,
        applies_from: at(MONDAY, '07:50'),
        applies_until: at(MONDAY, '08:50'),
      });
    });

    it('ends an absence of earlier days at the save, so a lesson of today that started stays unresolved (decision 5)', async () => {
      const s = await scene({ twoLessons: true });
      const id = await stored(
        s.teacher.staffId,
        { startsOn: SUNDAY, endsOn: null },
        { from: at(SUNDAY, '00:00'), until: null },
      );
      await asViceAt(s.branch, at(MONDAY, '08:30'), async (cookie) => {
        ok(await edit(s.branch, id, { startsOn: SUNDAY, endsOn: SUNDAY }, cookie));
        expect(await statesOn(s, MONDAY, cookie)).toEqual([
          { state: 'unresolved', absent: true },
          { state: 'upcoming', absent: false },
        ]);
      });
    });

    it('records the absent person as having taught a past lesson: held, never "teacher unchanged" (decision 12)', async () => {
      const s = await scene();
      await stored(
        s.teacher.staffId,
        { startsOn: MONDAY, endsOn: MONDAY },
        { from: at(MONDAY, '00:00'), until: at(TUESDAY, '00:00') },
      );
      await asViceAt(s.branch, at(MONDAY, '10:00'), async (cookie) => {
        const [lesson] = await lessonsOn(s, MONDAY);
        if (lesson === undefined) throw new Error('No lesson.');
        expect(await statesOn(s, MONDAY, cookie)).toEqual([{ state: 'unresolved', absent: true }]);
        const corrected = await request(t.kit.server)
          .post(`/api/timetable/lessons/${lesson.id}/correction`)
          .set('Cookie', cookie)
          .set(BRANCH_HEADER, s.branch)
          .set(REQUEST_KEY_HEADER, randomUUID())
          .send({
            kind: 'teacher',
            teacherId: s.teacher.staffId,
            reason: 'Came after all',
            confirm: true,
          });
        expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
        expect(await statesOn(s, MONDAY, cookie)).toEqual([{ state: 'held', absent: false }]);
        const taught = await t.database.migrator
          .selectFrom('lesson_absence_taught')
          .select(['lesson_id', 'branch_id'])
          .execute();
        expect(taught).toContainEqual({ lesson_id: lesson.id, branch_id: s.branch });
        const [entry] = await t.entries('lesson.correct', lesson.id);
        expect(entry?.new_value).toMatchObject({ taughtWhileAbsent: true });
        // A person not absent is still "teacher unchanged".
        const [other] = await lessonsOn(s, MONDAY);
        if (other === undefined) throw new Error('No lesson.');
        refusedWith(
          await request(t.kit.server)
            .post(`/api/timetable/lessons/${other.id}/correction`)
            .set('Cookie', cookie)
            .set(BRANCH_HEADER, s.branch)
            .set(REQUEST_KEY_HEADER, randomUUID())
            .send({ kind: 'teacher', teacherId: s.teacher.staffId, reason: 'Again' }),
          409,
          'teacher_unchanged',
        );
      });
    });

    it('keeps an absent Tutor’s lesson "needs a teacher" after the Tutor lessons follow the class’s Tutor (3.6c-2 decision 11)', async () => {
      const s = await scene({ tutor: true });
      if (s.tutor === null || s.tutorSubject === null) throw new Error('No Tutor.');
      await entered(s.branch, {
        staffId: s.tutor.staffId,
        startsOn: TUESDAY,
        endsOn: TUESDAY,
        reason: 'Ill',
      });
      await new Transactions(t.database.app, new FixedClock(START)).run([s.branch], (transaction) =>
        followTutors(transaction, [s.classId], new Date(START)),
      );
      const [lesson] = await lessonsOn(s, TUESDAY, s.tutorSubject);
      expect(lesson?.teacher_id).toBe(s.tutor.staffId);
      const shown = (await day(s.branch, s.classId, TUESDAY)).lessons.find(
        (one) => one.subject.id === s.tutorSubject,
      );
      expect(shown).toMatchObject({ state: 'needs_teacher', away: 'absence' });
      const later = (await day(s.branch, s.classId, '2026-10-20')).lessons.find(
        (one) => one.subject.id === s.tutorSubject,
      );
      expect(later).toMatchObject({ state: 'upcoming', away: null });
    });
  });

  describe('every branch of the person (the done-when of 5.7a)', () => {
    it('tells the other branch’s Academic Vice Principal, and lists that branch’s lessons on its home page until the absence is shortened', async () => {
      const home = await scene();
      const person = await load.teacher(home.branch, { further: [] });
      await hours(home.branch, person.staffId, [1]);
      const away = await t.newBranch();
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: person.staffId, branch_id: away, is_main: false })
        .execute();
      const awayScene = await scene({ branch: away, teacher: person, weekday: 2 });
      // The Academic Vice Principals: the kit's in the home branch, a new one away.
      const vice = await viceAccount();
      await load.classes.role(vice, home.branch, 'academic_vice_principal');
      const awayVice = await t.kit.completeSession('Malika', 'Tursunova');
      await t.kit.giveRole(awayVice.account.id, {
        role: 'academic_vice_principal',
        branchId: away,
      });
      const absence = await entered(
        home.branch,
        { staffId: person.staffId, startsOn: NEXT_MONDAY, endsOn: null, reason: 'Ill' },
        t.vicePrincipal,
      );
      expect(await noticesOf(awayVice.account.id, home.branch)).toEqual([
        {
          kind: 'timetable.absence_entered_open',
          data: { name: expect.any(String) as unknown, startsOn: NEXT_MONDAY },
          branch_id: home.branch,
        },
      ]);
      // The author is not told.
      expect(await noticesOf(vice, home.branch)).toEqual([]);
      const listed = await attention(away, awayVice.cookie);
      expect(listed.needsTeacher).toContainEqual(
        expect.objectContaining({
          cause: 'absence',
          absence: { id: absence.id, startsOn: NEXT_MONDAY, endsOn: null },
          firstDate: '2026-10-20',
          suggestPermanent: false,
        }),
      );
      expect(await statesOn(awayScene, '2026-10-20', awayVice.cookie)).toEqual([
        { state: 'needs_teacher', absent: true },
      ]);
      // The other branch reads its own lessons of the absence.
      const own = absenceLessonsSchema.parse(
        ok(await lessonsOf(away, absence.id, awayVice.cookie)).body,
      );
      expect(own.lessons[0]).toMatchObject({ date: '2026-10-20', state: 'needs_teacher' });
      // Shortened from the home branch: gone from the other's list.
      ok(
        await edit(
          home.branch,
          absence.id,
          { startsOn: NEXT_MONDAY, endsOn: NEXT_MONDAY },
          t.vicePrincipal,
        ),
      );
      expect(await noticesOf(awayVice.account.id, home.branch)).toHaveLength(2);
      const after = await attention(away, awayVice.cookie);
      expect(after.needsTeacher.filter((one) => one.cause === 'absence')).toEqual([]);
      expect(await statesOn(awayScene, '2026-10-20', awayVice.cookie)).toEqual([
        { state: 'upcoming', absent: false },
      ]);
      // The other branch's Academic Vice Principal changes the same absence
      // back (permission review should-fix 1): its entry is in that branch,
      // and the home branch's Academic Vice Principal is told.
      ok(await edit(away, absence.id, { startsOn: NEXT_MONDAY, endsOn: null }, awayVice.cookie));
      expect(await statesOn(awayScene, '2026-10-20', awayVice.cookie)).toEqual([
        { state: 'needs_teacher', absent: true },
      ]);
      const entries = await t.entries('absence.edit', absence.id);
      expect(entries.map((one) => one.branch_id)).toEqual([home.branch, away]);
      expect(await noticesOf(vice, away)).toEqual([
        {
          kind: 'timetable.absence_changed_open',
          data: { name: expect.any(String) as unknown, startsOn: NEXT_MONDAY },
          branch_id: away,
        },
      ]);
    });

    // Spec review must-fixes 3 and 4c: a branch whose link to the person was
    // removed while it holds the person's lessons reads the same absence, its
    // days from the moments; once the time passes its lesson is "unresolved".
    it('lists the absence in a branch unlinked from the person, and its passed lesson as "unresolved", never held', async () => {
      const person = await load.teacher(t.north);
      const away = await t.newBranch();
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: person.staffId, branch_id: away, is_main: false })
        .execute();
      const awayScene = await scene({ branch: away, teacher: person, weekday: 2 });
      const absence = await entered(t.north, {
        staffId: person.staffId,
        startsOn: MONDAY,
        endsOn: null,
        reason: 'Ill',
      });
      await t.database.migrator
        .deleteFrom('staff_branches')
        .where('staff_id', '=', person.staffId)
        .where('branch_id', '=', away)
        .execute();
      await asViceAt(away, at(TUESDAY, '10:00'), async (cookie) => {
        const listed = await attention(away, cookie);
        expect(listed.unresolved).toEqual([
          expect.objectContaining({
            cause: 'absence',
            absence: { id: absence.id, startsOn: MONDAY, endsOn: null },
            lessons: 1,
            firstDate: TUESDAY,
          }),
        ]);
        expect(listed.needsTeacher).toContainEqual(
          expect.objectContaining({
            cause: 'absence',
            absence: { id: absence.id, startsOn: MONDAY, endsOn: null },
            firstDate: '2026-10-20',
          }),
        );
        expect(await statesOn(awayScene, TUESDAY, cookie)).toEqual([
          { state: 'unresolved', absent: true },
        ]);
      });
    });

    it('lists a past lesson of an absent person as "unresolved", never held', async () => {
      const s = await scene();
      const [monday] = await lessonsOn(s, MONDAY);
      if (monday === undefined) throw new Error('No lesson.');
      // A copy of the Monday lesson on the Friday before, by the migrator.
      const block = await t.database.migrator
        .selectFrom('lesson_blocks')
        .selectAll()
        .where('id', '=', monday.block_id)
        .executeTakeFirstOrThrow();
      const days = new Date(MONDAY).getTime() - new Date(FRIDAY_BEFORE).getTime();
      const made = await t.database.migrator
        .insertInto('lesson_blocks')
        .values({
          branch_id: s.branch,
          academic_year_id: block.academic_year_id,
          quarter_id: block.quarter_id,
          lesson_date: FRIDAY_BEFORE,
          starts_at: new Date(monday.starts_at.getTime() - days),
          ends_at: new Date(monday.ends_at.getTime() - days),
          version_id: block.version_id,
          pattern_block_id: block.pattern_block_id,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('lessons')
        .values({
          branch_id: s.branch,
          block_id: made.id,
          lesson_date: made.lesson_date,
          starts_at: made.starts_at,
          ends_at: made.ends_at,
          class_id: monday.class_id,
          subject_id: monday.subject_id,
          load_row_id: monday.load_row_id,
          pattern_entry_id: monday.pattern_entry_id,
          teacher_id: monday.teacher_id,
          room_id: monday.room_id,
        })
        .execute();
      const id = await stored(
        s.teacher.staffId,
        { startsOn: '2026-10-08', endsOn: FRIDAY_BEFORE },
        { from: at('2026-10-08', '00:00'), until: at(TODAY, '00:00') },
      );
      const listed = await attention(s.branch);
      expect(listed.unresolved).toEqual([
        expect.objectContaining({
          cause: 'absence',
          absence: { id, startsOn: '2026-10-08', endsOn: FRIDAY_BEFORE },
          lessons: 1,
          firstDate: FRIDAY_BEFORE,
          lastDate: FRIDAY_BEFORE,
        }),
      ]);
      // The absence has ended: the Monday lessons are the teacher's.
      expect(listed.needsTeacher.filter((one) => one.cause === 'absence')).toEqual([]);
    });
  });

  // Task 5.7a-2a, pull request #186: a teacher inactive, left or locked
  // (docs/spec/06-timetable.md, How surprises are prevented: "When a
  // teacher's status is set to inactive or left from a date ... marks them
  // 'needs a teacher' on the Academic Vice Principal's home page. An account
  // can always be locked at once, whatever lessons remain."; edge/people-
  // roles-accounts, Staff over time: "'Lock now' ... The teacher's future
  // lessons go to 'needs a teacher'."; edge/timetable, Exams: "an
  // invigilator falls ill ... 'needs an invigilator'"). A status or a lock
  // writes no lesson (decision 2): the lesson keeps its teacher.
  describe('a teacher away by status or lock (task 5.7a-2a)', () => {
    /** A status of the person from a date, written by the migrator as the route writes it. */
    async function statusFrom(staffId: string, status: string, from: string) {
      await t.database.migrator
        .updateTable('staff_statuses')
        .set({ valid_until: from })
        .where('staff_id', '=', staffId)
        .where('valid_until', 'is', null)
        .execute();
      await t.database.migrator
        .insertInto('staff_statuses')
        .values({ staff_id: staffId, status, valid_from: from })
        .execute();
    }

    /** A lock of the account from a moment, by the migrator (its span opens by the trigger). */
    const lockedAt = async (accountId: string, moment: Date) => {
      const by = await load.classes.account();
      await t.database.migrator
        .updateTable('accounts')
        .set({ locked_at: moment, locked_by: by, lock_reason: 'Dismissed' })
        .where('id', '=', accountId)
        .execute();
    };

    /** The away cause and state of each of the class's lessons of the subject on a date. */
    const awayOn = async (s: Scene, date: string, cookie = t.admin) =>
      (await day(s.branch, s.classId, date, cookie)).lessons
        .filter((one) => one.subject.id === s.subject)
        .sort((a, b) => a.start - b.start)
        .map((one) => ({ state: one.state, away: one.away }));

    /** Runs `work` with the clock at `moment` and a Super Admin signed in then. */
    async function asAdminAt(moment: Date, work: (cookie: string) => Promise<void>) {
      t.clock.set(moment);
      try {
        const browser = await t.kit.completeSession('Dilnoza', 'Saidova');
        await t.kit.giveRole(browser.account.id, { role: 'super_admin' });
        await work(browser.cookie);
      } finally {
        t.clock.set(START);
      }
    }

    const correct = (branch: string, lessonId: string, teacherId: string, cookie: string) =>
      request(t.kit.server)
        .post(`/api/timetable/lessons/${lessonId}/correction`)
        .set('Cookie', cookie)
        .set(BRANCH_HEADER, branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ kind: 'teacher', teacherId, reason: 'Came after all', confirm: true });

    /** An exam of the class in its second lesson on `date`, saved by the route with its tick. */
    const examOn = async (
      branch: string,
      classId: string,
      date: string,
      invigilators: string[],
    ) => {
      const room = await load.classes.room(branch);
      const created = await request(t.kit.server)
        .post('/api/timetable/exams')
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({
          date,
          firstLesson: 2,
          lastLesson: 2,
          title: 'Quarter exam',
          subjectId: null,
          rooms: [
            { roomId: room, classIds: [classId], groupIds: [], invigilatorIds: invigilators },
          ],
          blockChoices: [],
          confirm: true,
        });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      return (created.body as { exam: { id: string } }).exam.id;
    };

    it('puts the lessons of a person inactive from Monday under "needs a teacher", cause inactive, and gives them back when the status is taken back', async () => {
      const s = await scene();
      ok(
        await t.post(`/api/people/staff/${s.teacher.staffId}/status`, s.branch, {
          status: 'inactive',
          from: NEXT_MONDAY,
        }),
      );
      expect(await awayOn(s, MONDAY)).toEqual([{ state: 'upcoming', away: null }]);
      expect(await awayOn(s, NEXT_MONDAY)).toEqual([{ state: 'needs_teacher', away: 'inactive' }]);
      const [lesson] = await lessonsOn(s, NEXT_MONDAY);
      expect(lesson?.teacher_id).toBe(s.teacher.staffId);
      const listed = await attention(s.branch);
      expect(listed.needsTeacher).toEqual([
        expect.objectContaining({
          cause: 'inactive',
          teacher: expect.objectContaining({ id: s.teacher.staffId, kind: 'person' }) as unknown,
          absence: null,
          firstDate: NEXT_MONDAY,
        }),
      ]);
      // Active again from the same date: the planned change is taken back.
      ok(
        await t.post(`/api/people/staff/${s.teacher.staffId}/status`, s.branch, {
          status: 'active',
          from: NEXT_MONDAY,
        }),
      );
      expect(await awayOn(s, NEXT_MONDAY)).toEqual([{ state: 'upcoming', away: null }]);
      expect((await attention(s.branch)).needsTeacher).toEqual([]);
    });

    // From 5.5b-1: a regular lesson written before the leaving, after its
    // date, keeps the teacher and is listed like any other future lesson.
    it('lists the lessons after a leaving still under the teacher, cause left', async () => {
      const s = await scene();
      ok(
        await t.post(`/api/people/staff/${s.teacher.staffId}/status`, s.branch, {
          status: 'left',
          from: NEXT_MONDAY,
        }),
      );
      const [lesson] = await lessonsOn(s, '2026-10-26');
      expect(lesson?.teacher_id).toBe(s.teacher.staffId);
      expect(await awayOn(s, '2026-10-26')).toEqual([{ state: 'needs_teacher', away: 'left' }]);
      const listed = await attention(s.branch);
      expect(listed.needsTeacher.map((one) => [one.cause, one.firstDate])).toEqual([
        ['left', NEXT_MONDAY],
      ]);
    });

    it('starts a status saved from today at the save: a lesson that started stays held (decision 4)', async () => {
      const s = await scene({ twoLessons: true });
      await asAdminAt(at(MONDAY, '08:30'), async (cookie) => {
        ok(
          await t.post(
            `/api/people/staff/${s.teacher.staffId}/status`,
            s.branch,
            { status: 'inactive', from: MONDAY },
            cookie,
          ),
        );
        expect(await awayOn(s, MONDAY, cookie)).toEqual([
          { state: 'held', away: null },
          { state: 'needs_teacher', away: 'inactive' },
        ]);
      });
    });

    it('puts the lessons after a lock under "needs a teacher", keeps a lesson started during it "unresolved" after the unlock until the correction records the person (decisions 5 and 7)', async () => {
      const s = await scene({ twoLessons: true });
      await load.classes.role(s.teacher.accountId, s.branch, 'teacher');
      await asViceAt(s.branch, at(MONDAY, '08:30'), async (cookie) => {
        ok(
          await t.post(
            `/api/people/staff/${s.teacher.staffId}/account/lock`,
            s.branch,
            { reason: 'Dismissed' },
            cookie,
          ),
        );
        expect(await awayOn(s, MONDAY, cookie)).toEqual([
          { state: 'held', away: null },
          { state: 'needs_teacher', away: 'locked' },
        ]);
      });
      await asViceAt(s.branch, at(MONDAY, '09:30'), async (cookie) => {
        ok(
          await t.post(
            `/api/people/staff/${s.teacher.staffId}/account/unlock`,
            s.branch,
            {},
            cookie,
          ),
        );
        expect(await awayOn(s, MONDAY, cookie)).toEqual([
          { state: 'held', away: null },
          { state: 'unresolved', away: 'locked' },
        ]);
        expect(await awayOn(s, NEXT_MONDAY, cookie)).toEqual([
          { state: 'upcoming', away: null },
          { state: 'upcoming', away: null },
        ]);
        const [, second] = await lessonsOn(s, MONDAY);
        if (second === undefined) throw new Error('No lesson.');
        ok(await correct(s.branch, second.id, s.teacher.staffId, cookie));
        expect(await awayOn(s, MONDAY, cookie)).toEqual([
          { state: 'held', away: null },
          { state: 'held', away: null },
        ]);
        const [entry] = await t.entries('lesson.correct', second.id);
        expect(entry?.new_value).toMatchObject({ taughtWhileAbsent: true, awayCause: 'locked' });
      });
      const spans = await t.database.migrator
        .selectFrom('account_lock_spans')
        .select(['locked_at', 'unlocked_at'])
        .where('account_id', '=', s.teacher.accountId)
        .execute();
      expect(spans).toEqual([{ locked_at: at(MONDAY, '08:30'), unlocked_at: at(MONDAY, '09:30') }]);
    });

    it.each(['inactive', 'left'] as const)(
      'keeps the correction of the same person refused on a lesson of a teacher %s (decision 7)',
      async (status) => {
        const s = await scene();
        await statusFrom(s.teacher.staffId, status, MONDAY);
        await asViceAt(s.branch, at(MONDAY, '10:00'), async (cookie) => {
          expect(await awayOn(s, MONDAY, cookie)).toEqual([{ state: 'unresolved', away: status }]);
          const [lesson] = await lessonsOn(s, MONDAY);
          if (lesson === undefined) throw new Error('No lesson.');
          refusedWith(
            await correct(s.branch, lesson.id, s.teacher.staffId, cookie),
            409,
            'teacher_unchanged',
          );
          const offered = ok(
            await t.get(
              `/api/timetable/lessons/${lesson.id}/correction-teachers`,
              s.branch,
              cookie,
            ),
          ).body as { teachers: { id: string }[] };
          expect(offered.teachers.map((one) => one.id)).not.toContain(s.teacher.staffId);
        });
      },
    );

    it('gives one cause per lesson, the most lasting first (decision 6)', async () => {
      const left = await scene();
      await stored(
        left.teacher.staffId,
        { startsOn: MONDAY, endsOn: null },
        { from: at(MONDAY, '00:00'), until: null },
      );
      await statusFrom(left.teacher.staffId, 'left', NEXT_MONDAY);
      // Every lesson of the class from the leaving date, counted once.
      const fromNextMonday = (
        await t.database.migrator
          .selectFrom('lessons')
          .select('id')
          .where('branch_id', '=', left.branch)
          .where('teacher_id', '=', left.teacher.staffId)
          .where('cancel_cause', 'is', null)
          .where('lesson_date', '>=', NEXT_MONDAY)
          .execute()
      ).length;
      expect(fromNextMonday).toBeGreaterThan(1);
      const fromLeft = await attention(left.branch);
      expect(
        fromLeft.needsTeacher.map((one) => [one.cause, one.lessons, one.firstDate]).sort(),
      ).toEqual([
        ['absence', 1, MONDAY],
        ['left', fromNextMonday, NEXT_MONDAY],
      ]);
      expect(await awayOn(left, NEXT_MONDAY)).toEqual([{ state: 'needs_teacher', away: 'left' }]);
      const locked = await scene();
      await stored(
        locked.teacher.staffId,
        { startsOn: MONDAY, endsOn: null },
        { from: at(MONDAY, '00:00'), until: null },
      );
      await lockedAt(locked.teacher.accountId, new Date(START));
      const fromLocked = await attention(locked.branch);
      expect(fromLocked.needsTeacher.map((one) => one.cause)).toEqual(['locked']);
      expect(await awayOn(locked, MONDAY)).toEqual([{ state: 'needs_teacher', away: 'locked' }]);
    });

    it('sends an inactive Tutor’s lessons from the date to "needs a teacher" after the Tutor lessons follow (3.6c-2 decision 11)', async () => {
      const s = await scene({ tutor: true });
      if (s.tutor === null || s.tutorSubject === null) throw new Error('No Tutor.');
      await statusFrom(s.tutor.staffId, 'inactive', '2026-10-20');
      await new Transactions(t.database.app, new FixedClock(START)).run([s.branch], (transaction) =>
        followTutors(transaction, [s.classId], new Date(START)),
      );
      const tutorLesson = async (date: string) =>
        (await day(s.branch, s.classId, date)).lessons.find(
          (one) => one.subject.id === s.tutorSubject,
        );
      expect(await tutorLesson(TUESDAY)).toMatchObject({ state: 'upcoming', away: null });
      expect(await tutorLesson('2026-10-20')).toMatchObject({
        state: 'needs_teacher',
        away: 'inactive',
      });
      const [lesson] = await lessonsOn(s, '2026-10-20', s.tutorSubject);
      expect(lesson?.teacher_id).toBe(s.tutor.staffId);
    });

    it('lists an exam whose invigilator is absent, inactive, left or locked, never a started, cancelled or other branch’s one (decision 9)', async () => {
      const s = await scene();
      const people = {
        absent: await load.teacher(s.branch),
        inactive: await load.teacher(s.branch),
        left: await load.teacher(s.branch),
        locked: await load.teacher(s.branch),
        present: await load.teacher(s.branch),
      };
      for (const one of Object.values(people)) await hours(s.branch, one.staffId);
      const all = Object.values(people).map((one) => one.staffId);
      const listedExam = await examOn(s.branch, s.classId, NEXT_MONDAY, all);
      const cancelled = await examOn(s.branch, s.classId, '2026-10-26', all);
      await t.database.migrator
        .updateTable('exams')
        .set({ cancel_cause: 'cancelled' })
        .where('id', '=', cancelled)
        .execute();
      const started = await examOn(s.branch, s.classId, MONDAY, all);
      // Another branch's exam of the same invigilator.
      const other = await scene();
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: people.absent.staffId, branch_id: other.branch, is_main: false })
        .execute();
      const elsewhere = await examOn(other.branch, other.classId, '2026-10-20', [
        people.absent.staffId,
      ]);
      await stored(
        people.absent.staffId,
        { startsOn: MONDAY, endsOn: null },
        { from: at(MONDAY, '00:00'), until: null },
      );
      await statusFrom(people.inactive.staffId, 'inactive', MONDAY);
      await statusFrom(people.left.staffId, 'left', MONDAY);
      await lockedAt(people.locked.accountId, new Date(START));
      await asViceAt(s.branch, at(MONDAY, '10:00'), async (cookie) => {
        const listed = await attention(s.branch, cookie);
        expect(listed.needsInvigilator.map((one) => one.examId)).toEqual([listedExam]);
        expect(listed.needsInvigilator[0]).toMatchObject({
          date: NEXT_MONDAY,
          title: 'Quarter exam',
        });
        expect(
          new Map(listed.needsInvigilator[0]?.invigilators.map((one) => [one.id, one.cause])),
        ).toEqual(
          new Map([
            [people.absent.staffId, 'absence'],
            [people.inactive.staffId, 'inactive'],
            [people.left.staffId, 'left'],
            [people.locked.staffId, 'locked'],
          ]),
        );
        expect(listed.needsInvigilator.map((one) => one.examId)).not.toContain(started);
        expect(listed.needsInvigilator.map((one) => one.examId)).not.toContain(elsewhere);
      });
    });

    // Permission review should-fix 2: a person the branch no longer sees is
    // named by nothing under every new cause, the cause still shown.
    it('names nobody the branch no longer sees, in a locked group and as an invigilator', async () => {
      const person = await load.teacher(t.north);
      const away = await t.newBranch();
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: person.staffId, branch_id: away, is_main: false })
        .execute();
      const awayScene = await scene({ branch: away, teacher: person, weekday: 2 });
      const exam = await examOn(away, awayScene.classId, NEXT_MONDAY, [person.staffId]);
      await lockedAt(person.accountId, new Date(START));
      await t.database.migrator
        .deleteFrom('staff_branches')
        .where('staff_id', '=', person.staffId)
        .where('branch_id', '=', away)
        .execute();
      const awayVice = await t.kit.completeSession('Nodira', 'Qosimova');
      await t.kit.giveRole(awayVice.account.id, {
        role: 'academic_vice_principal',
        branchId: away,
      });
      const listed = await attention(away, awayVice.cookie);
      expect(listed.needsTeacher).toEqual([
        expect.objectContaining({
          cause: 'locked',
          teacher: { id: person.staffId, kind: 'person', name: '' },
        }),
      ]);
      expect(listed.needsInvigilator).toEqual([
        expect.objectContaining({
          examId: exam,
          invigilators: [{ id: person.staffId, name: '', cause: 'locked' }],
        }),
      ]);
    });

    // Permission review should-fix 3: every reader and role of the cause.
    it('shows the Principal the cause on the home lists and the day page', async () => {
      const s = await scene();
      await statusFrom(s.teacher.staffId, 'inactive', NEXT_MONDAY);
      const principal = await t.kit.completeSession('Jasur', 'Ergashev');
      await t.kit.giveRole(principal.account.id, { role: 'principal', branchId: s.branch });
      const listed = await attention(s.branch, principal.cookie);
      expect(listed.needsTeacher.map((one) => one.cause)).toEqual(['inactive']);
      expect(await awayOn(s, NEXT_MONDAY, principal.cookie)).toEqual([
        { state: 'needs_teacher', away: 'inactive' },
      ]);
    });

    it('keeps a lesson recorded as taught during an absence "needs a teacher" in the absence’s lessons while the person is also inactive', async () => {
      const s = await scene();
      const absence = await stored(
        s.teacher.staffId,
        { startsOn: MONDAY, endsOn: null },
        { from: at(MONDAY, '00:00'), until: null },
      );
      await statusFrom(s.teacher.staffId, 'inactive', NEXT_MONDAY);
      const [lesson] = await lessonsOn(s, NEXT_MONDAY);
      if (lesson === undefined) throw new Error('No lesson.');
      await t.database.migrator
        .insertInto('lesson_absence_taught')
        .values({
          branch_id: s.branch,
          lesson_id: lesson.id,
          recorded_by: await viceAccount(),
          recorded_at: new Date(START),
        })
        .execute();
      const listed = absenceLessonsSchema.parse(ok(await lessonsOf(s.branch, absence)).body);
      expect(listed.lessons.find((one) => one.id === lesson.id)?.state).toBe('needs_teacher');
      expect(await awayOn(s, NEXT_MONDAY)).toEqual([{ state: 'needs_teacher', away: 'inactive' }]);
    });

    // Spec review must-fix 3: `06`, "Leaving or going inactive. The system
    // lists the future lessons in every branch".
    it('lists the lessons of a person inactive from a date in the person’s other branch too', async () => {
      const home = await scene();
      const person = await load.teacher(home.branch);
      await hours(home.branch, person.staffId, [1]);
      const away = await t.newBranch();
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: person.staffId, branch_id: away, is_main: false })
        .execute();
      const awayScene = await scene({ branch: away, teacher: person, weekday: 2 });
      const awayVice = await t.kit.completeSession('Gulnora', 'Karimova');
      await t.kit.giveRole(awayVice.account.id, {
        role: 'academic_vice_principal',
        branchId: away,
      });
      ok(
        await t.post(`/api/people/staff/${person.staffId}/status`, home.branch, {
          status: 'inactive',
          from: NEXT_MONDAY,
        }),
      );
      const listed = await attention(away, awayVice.cookie);
      expect(listed.needsTeacher).toEqual([
        expect.objectContaining({
          cause: 'inactive',
          teacher: expect.objectContaining({ id: person.staffId }) as unknown,
          firstDate: '2026-10-20',
        }),
      ]);
      expect(await awayOn(awayScene, TUESDAY, awayVice.cookie)).toEqual([
        { state: 'upcoming', away: null },
      ]);
    });

    it('lists a locked teacher’s future lessons in every branch of the person (the done-when of 5.7a-2a)', async () => {
      const home = await scene();
      const person = await load.teacher(home.branch);
      await hours(home.branch, person.staffId, [1]);
      await load.classes.role(person.accountId, home.branch, 'teacher');
      const away = await t.newBranch();
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: person.staffId, branch_id: away, is_main: false })
        .execute();
      const awayScene = await scene({ branch: away, teacher: person, weekday: 2 });
      const homeVice = await t.kit.completeSession('Kamola', 'Yusupova');
      await t.kit.giveRole(homeVice.account.id, {
        role: 'academic_vice_principal',
        branchId: home.branch,
      });
      const awayVice = await t.kit.completeSession('Sevara', 'Nazarova');
      await t.kit.giveRole(awayVice.account.id, {
        role: 'academic_vice_principal',
        branchId: away,
      });
      // Locked by the home branch's Academic Vice Principal.
      ok(
        await t.post(
          `/api/people/staff/${person.staffId}/account/lock`,
          home.branch,
          { reason: 'Dismissed' },
          homeVice.cookie,
        ),
      );
      const listed = await attention(away, awayVice.cookie);
      expect(listed.needsTeacher).toEqual([
        expect.objectContaining({
          cause: 'locked',
          teacher: expect.objectContaining({ id: person.staffId }) as unknown,
          firstDate: TUESDAY,
        }),
      ]);
      expect(await awayOn(awayScene, TUESDAY, awayVice.cookie)).toEqual([
        { state: 'needs_teacher', away: 'locked' },
      ]);
    });
  });

  describe('the home page lists (decisions 9 and 10)', () => {
    it('groups by an absence, a vacancy and nobody recorded', async () => {
      const s = await scene({ vacancy: true });
      const [first] = await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('branch_id', '=', s.branch)
        .where('class_id', '=', s.classId)
        .where('lesson_date', '=', '2026-10-26')
        .execute();
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: null })
        .where('id', '=', first?.id ?? '')
        .execute();
      await entered(s.branch, {
        staffId: s.teacher.staffId,
        startsOn: MONDAY,
        endsOn: NEXT_MONDAY,
        reason: 'Ill',
      });
      const listed = await attention(s.branch);
      expect(listed.unresolved).toEqual([]);
      const byCause = new Map(listed.needsTeacher.map((one) => [one.cause, one]));
      expect(byCause.get('absence')).toMatchObject({
        lessons: 2,
        firstDate: MONDAY,
        lastDate: NEXT_MONDAY,
        teacher: { id: s.teacher.staffId, kind: 'person' },
      });
      expect(byCause.get('vacancy')).toMatchObject({
        firstDate: MONDAY,
        teacher: { id: s.vacancy, kind: 'vacancy' },
        absence: null,
      });
      expect(byCause.get('nobody')).toMatchObject({
        lessons: 1,
        firstDate: '2026-10-26',
        lastDate: '2026-10-26',
        teacher: null,
      });
    });

    it('suggests a permanent change once the absence has covered 10 school days, days off left out', async () => {
      const ten = await scene();
      const nine = await scene();
      const dayOff = await scene();
      const from = (s: Scene, date: string) =>
        stored(
          s.teacher.staffId,
          { startsOn: date, endsOn: null },
          {
            from: at(date, '00:00'),
            until: null,
          },
        );
      // Monday 28 September to Friday 9 October: ten weekdays; from the
      // Tuesday, nine; a day off on 1 October takes one away.
      await from(ten, '2026-09-28');
      await from(nine, '2026-09-29');
      await from(dayOff, '2026-09-28');
      await t.database.migrator
        .insertInto('calendar_entries')
        .values({
          branch_id: dayOff.branch,
          kind: 'day_off',
          name: 'Teachers’ day',
          first_date: '2026-10-01',
          last_date: '2026-10-01',
        })
        .execute();
      const suggested = async (s: Scene) =>
        (await attention(s.branch)).needsTeacher.find((one) => one.cause === 'absence')
          ?.suggestPermanent;
      expect(await suggested(ten)).toBe(true);
      expect(await suggested(nine)).toBe(false);
      expect(await suggested(dayOff)).toBe(false);
    });
  });

  describe('a publish and a withdraw (decision 7)', () => {
    it('lists the absence kept with the new lessons it covers, and the new lessons need a teacher after the publish', async () => {
      const s = await scene();
      const absence = await entered(s.branch, {
        staffId: s.teacher.staffId,
        startsOn: NEXT_MONDAY,
        endsOn: '2026-10-30',
        reason: 'Ill',
      });
      const created = await t.post('/api/timetable/versions', s.branch, {
        academicYearId: s.year,
        startsOn: NEXT_MONDAY,
        copyFrom: s.version,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const draft = (created.body as { id: string }).id;
      // The copy moves the maths to Wednesday.
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', draft)
        .execute();
      const row = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', draft)
        .executeTakeFirstOrThrow();
      await placeAt(s.branch, draft, row.id, 3);
      ok(await t.post(`/api/timetable/versions/${draft}/templates/confirm`, s.branch));
      await load.freeEditLock(draft);
      const checked = ok(
        await t.get(
          `/api/timetable/versions/${draft}/publish-check?startsOn=${NEXT_MONDAY}`,
          s.branch,
        ),
      ).body as {
        impact: { dayChanges: { key: string; absences: { id: string; lessons: number }[] } };
      };
      expect(checked.impact.dayChanges.absences).toEqual([
        expect.objectContaining({
          id: absence.id,
          startsOn: NEXT_MONDAY,
          endsOn: '2026-10-30',
          lessons: 2,
        }),
      ]);
      const published = await request(t.kit.server)
        .post(`/api/timetable/versions/${draft}/publish`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ startsOn: NEXT_MONDAY, dayChangesKey: checked.impact.dayChanges.key });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(await statesOn(s, '2026-10-21')).toEqual([{ state: 'needs_teacher', absent: true }]);
      expect(await statesOn(s, '2026-11-11')).toEqual([{ state: 'upcoming', absent: false }]);
      // The withdraw check lists it over the lessons the earlier version writes again.
      const withdrawCheck = ok(
        await t.get(`/api/timetable/versions/${draft}/withdraw-check`, s.branch),
      ).body as { dayChanges: { absences: { id: string; lessons: number }[] } };
      expect(withdrawCheck.dayChanges.absences).toEqual([
        expect.objectContaining({ id: absence.id, lessons: 2 }),
      ]);
    });
  });

  // Code review finding 2: a kept stored lesson cancelled with a reason is
  // cancelled, never "needs a teacher", so the preview does not count it.
  describe('the count of a kept move', () => {
    it('leaves a kept moved lesson cancelled for the day out of the absence’s count', async () => {
      const s = await scene();
      const keyed = (path: string, body: object) =>
        request(t.kit.server)
          .post(path)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, s.branch)
          .set(REQUEST_KEY_HEADER, randomUUID())
          .send(body);
      const [monday] = await lessonsOn(s, MONDAY);
      if (monday === undefined) throw new Error('No lesson.');
      // Moved from Monday, before the new start, to Wednesday's second lesson.
      ok(
        await keyed(`/api/timetable/lessons/${monday.id}/move`, {
          date: '2026-10-14',
          lessonNumber: 2,
          reason: 'Excursion to the museum',
        }),
      );
      const absence = await entered(s.branch, {
        staffId: s.teacher.staffId,
        startsOn: TUESDAY,
        endsOn: null,
        reason: 'Ill',
      });
      const created = await t.post('/api/timetable/versions', s.branch, {
        academicYearId: s.year,
        startsOn: TUESDAY,
        copyFrom: s.version,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const draft = (created.body as { id: string }).id;
      // The copy places the maths on Monday, as the version it was copied from.
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', draft)
        .execute();
      const row = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', draft)
        .executeTakeFirstOrThrow();
      await placeAt(s.branch, draft, row.id, 1);
      ok(await t.post(`/api/timetable/versions/${draft}/templates/confirm`, s.branch));
      await load.freeEditLock(draft);
      const counted = async () => {
        const checked = ok(
          await t.get(
            `/api/timetable/versions/${draft}/publish-check?startsOn=${TUESDAY}`,
            s.branch,
          ),
        ).body as { impact: { dayChanges: { absences: { id: string; lessons: number }[] } } };
        return checked.impact.dayChanges.absences.find((one) => one.id === absence.id)?.lessons;
      };
      const before = await counted();
      if (before === undefined) throw new Error('The absence is not listed.');
      ok(
        await keyed(`/api/timetable/lessons/${monday.id}/cancel`, {
          reason: 'Excursion to the museum',
        }),
      );
      expect(await counted()).toBe(before - 1);
    });
  });

  describe('the personal data report', () => {
    it('lists the person’s absences, a withdrawn one marked', async () => {
      const person = await load.teacher(t.north);
      const kept = await entered(t.north, {
        staffId: person.staffId,
        startsOn: '2026-11-16',
        endsOn: '2026-11-20',
        reason: 'Course in Samarkand',
      });
      const gone = await entered(t.north, {
        staffId: person.staffId,
        startsOn: '2026-12-14',
        endsOn: null,
        reason: 'Leave',
      });
      ok(await withdraw(t.north, gone.id));
      const report = staffReportSchema.parse(
        ok(await t.post(`/api/people/staff/${person.staffId}/report`, t.north, {})).body,
      );
      expect(report.staff.absences).toEqual([
        {
          from: kept.startsOn,
          until: '2026-11-20',
          reason: 'Course in Samarkand',
          withdrawn: false,
        },
        { from: '2026-12-14', until: null, reason: 'Leave', withdrawn: true },
      ]);
    });
  });
});
