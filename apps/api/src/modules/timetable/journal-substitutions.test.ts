import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  absenceLessonsSchema,
  absenceSchema,
  attentionSchema,
  journalSubstituteAnswerSchema,
  journalSubstitutesAnswerSchema,
  staffReportSchema,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import {
  dayTemplatesKit,
  MONDAY,
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { HELD_ENTRY_ACTION, heldEntry } from '../../testing/held-entry.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const savedOf = (response: Response) => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return journalSubstituteAnswerSchema.parse(response.body);
};

/** The codes and days of a refusal's details. */
const detailsOf = (response: Response) =>
  (response.body as { error: { details: { code: string; day?: string }[] } }).error.details.map(
    (one) => `${one.code}@${one.day ?? ''}`,
  );

const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

/** A moment of a school date at a clock time in Tashkent (+05:00). */
const at = (date: string, time: string): Date => new Date(`${date}T${time}:00+05:00`);

const SECOND = '2026-10-19';
const THIRD = '2026-10-26';
const WEDNESDAY = '2026-10-14';

// All names are invented. Task 5.7b-2, pull request #192: the substitution
// started from an absence or a vacancy (docs/spec/06-timetable.md, Changes
// after publishing, Substitution; edge/timetable, After publishing, "A
// teacher is ill for weeks with no return date": "One substitute can be
// assigned per journal for the whole absence in one action, each date still
// being checked. Shortening the absence returns future lessons to the
// teacher."). The clock stands at 23:55 on Saturday 10 October 2026 in
// Tashkent; the version runs from Monday 12 October, so the first class's
// maths is held on Mondays 12, 19 and 26 October in the first quarter.
describe('the substitution from an absence or a vacancy', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;

  const keyed = (path: string, branch: string, body: object, cookie: string, key: string) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, key)
      .send(body);

  const journalSubstitute = (
    branch: string,
    absenceId: string,
    body: { journalId: string; teacherId: string; reason?: string; confirm?: boolean },
    cookie = t.admin,
    key: string = randomUUID(),
  ) =>
    keyed(
      `/api/timetable/absences/${absenceId}/journal-substitute`,
      branch,
      { reason: 'The teacher is ill', ...body },
      cookie,
      key,
    );

  const vacancySubstitute = (
    branch: string,
    vacancyId: string,
    body: {
      journalId: string;
      teacherId: string;
      from: string;
      until?: string | null;
      reason?: string;
      confirm?: boolean;
    },
    cookie = t.admin,
    key: string = randomUUID(),
  ) =>
    keyed(
      `/api/timetable/vacancies/${vacancyId}/journal-substitute`,
      branch,
      { reason: 'Nobody is hired yet', ...body },
      cookie,
      key,
    );

  const lessonSubstitute = (branch: string, id: string, teacherId: string, cookie = t.admin) =>
    keyed(
      `/api/timetable/lessons/${id}/substitute`,
      branch,
      { teacherId, reason: 'A meeting' },
      cookie,
      randomUUID(),
    );

  const suggestions = async (branch: string, absenceId: string, journalId: string) => {
    const response = await t.get(
      `/api/timetable/absences/${absenceId}/journals/${journalId}/substitutes`,
      branch,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return journalSubstitutesAnswerSchema.parse(response.body);
  };

  const absenceLessons = async (branch: string, absenceId: string) => {
    const response = await t.get(`/api/timetable/absences/${absenceId}/lessons`, branch);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return absenceLessonsSchema.parse(response.body).lessons;
  };

  /** An absence of the person entered through the route, from `from` to `to`. */
  async function absent(branch: string, staffId: string, from: string, to: string | null) {
    const response = await t.post('/api/timetable/absences', branch, {
      staffId,
      startsOn: from,
      endsOn: to,
      reason: 'Ill',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return absenceSchema.parse(response.body).id;
  }

  const editAbsence = (
    branch: string,
    id: string,
    body: { startsOn: string; endsOn: string | null },
    cookie = t.admin,
  ) => t.patch(`/api/timetable/absences/${id}`, branch, body, cookie);

  const publish = (branch: string, version: string, startsOn: string) =>
    request(t.kit.server)
      .post(`/api/timetable/versions/${version}/publish`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ startsOn });

  /** Hours of a person in the branch on the weekdays named, from `from` to `until`. */
  async function hours(
    branch: string,
    staffId: string,
    input: { weekdays?: readonly number[]; from?: string; until?: string } = {},
  ) {
    const from = input.from ?? '2026-09-01';
    const entry = await t.database.migrator
      .insertInto('staff_availability')
      .values({
        branch_id: branch,
        staff_id: staffId,
        valid_from: from,
        ...(input.until === undefined ? {} : { valid_until: input.until }),
      })
      .returning(['id', 'valid_until'])
      .executeTakeFirstOrThrow();
    for (const weekday of input.weekdays ?? [1, 2, 3, 4, 5]) {
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

  const placeAt = async (branch: string, version: string, loadRowId: string, weekday: number) => {
    const placed = await t.post(`/api/timetable/versions/${version}/pattern`, branch, {
      loadRowId,
      weekday,
      slotPosition: 1,
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  };

  /** A person of the branch with hours, and the subjects named. */
  async function person(
    branch: string,
    subjects: readonly { subject: string; grades: readonly number[] }[] = [],
    input: { weekdays?: readonly number[]; until?: string; further?: readonly string[] } = {},
  ) {
    const one = await load.teacher(branch, {
      subjects,
      ...(input.further === undefined ? {} : { further: input.further }),
    });
    await hours(branch, one.staffId, {
      ...(input.weekdays === undefined ? {} : { weekdays: input.weekdays }),
      ...(input.until === undefined ? {} : { until: input.until }),
    });
    return one;
  }

  /**
   * A new branch with a year of four dated quarters, a day of three lessons
   * from 08:00, two classes of grade 7, and a version published from Monday
   * 12 October: maths of each class on `weekday` (Monday) in the first slot,
   * the first class's taught by `teacher` (a new person by default), the
   * second's by another person, or a vacancy with `vacancy`.
   */
  async function scene(
    input: {
      branch?: string;
      teacher?: { staffId: string; accountId: string };
      weekday?: number;
      vacancy?: boolean;
      subject?: string;
      tutor?: boolean;
    } = {},
  ) {
    const branch = input.branch ?? (await t.newBranch());
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
    const subject =
      input.subject ??
      (await load.classes.subject({ grades: [7], journalType: 'attendance_only' }));
    const otherSubject = await load.classes.subject({
      grades: [7],
      journalType: 'attendance_only',
    });
    const room = await load.classes.room(branch);
    const otherRoom = await load.classes.room(branch);
    const classId = await load.classes.schoolClass(branch, year, { grade: 7, room });
    const otherClass = await load.classes.schoolClass(branch, year, { grade: 7, room: otherRoom });
    const weekday = input.weekday ?? 1;
    const teacher = input.teacher ?? (await person(branch, [{ subject, grades: [7] }]));
    const otherTeacher = await person(branch, [{ subject, grades: [7] }]);
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
      lessons_per_week: 1,
    });
    await placeAt(branch, version, rowId, weekday);
    let vacancy: string | null = null;
    if (input.vacancy === true) {
      vacancy = await load.vacancy(branch, { subjects: [{ subject, grades: [7] }] });
      await hours(branch, vacancy);
    }
    const otherRow = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: otherClass,
      subject_id: subject,
      teacher_id: vacancy ?? otherTeacher.staffId,
      lessons_per_week: 1,
    });
    await placeAt(branch, version, otherRow, weekday);
    // A Tutor row of the first class on Tuesday, its teacher the class's Tutor.
    let tutorSubject: string | null = null;
    let tutor: { staffId: string; accountId: string } | null = null;
    if (input.tutor === true) {
      tutorSubject = await load.tutorSubject({ grades: [7] });
      await t.database.migrator
        .updateTable('subjects')
        .set({ journal_type: 'attendance_only' })
        .where('id', '=', tutorSubject)
        .execute();
      tutor = await person(branch);
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
    const published = await publish(branch, version, MONDAY);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    const journalOf = async (unit: string) =>
      (
        await t.database.migrator
          .selectFrom('journals')
          .select('id')
          .where('class_id', '=', unit)
          .where('subject_id', '=', subject)
          .executeTakeFirstOrThrow()
      ).id;
    return {
      branch,
      year,
      subject,
      otherSubject,
      classId,
      otherClass,
      teacher,
      otherTeacher,
      version,
      vacancy,
      journal: await journalOf(classId),
      otherJournal: await journalOf(otherClass),
      tutorSubject,
      tutor,
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /** The stored lesson of a class and subject on a date. */
  const lessonOf = (s: Scene, date: string, classId = s.classId) =>
    t.database.migrator
      .selectFrom('lessons')
      .selectAll()
      .where('branch_id', '=', s.branch)
      .where('class_id', '=', classId)
      .where('subject_id', '=', s.subject)
      .where('lesson_date', '=', date)
      .executeTakeFirstOrThrow();

  /** The rows of a lesson with their records, oldest first. */
  const rowsOf = (lessonId: string) =>
    t.database.migrator
      .selectFrom('substitution_lessons')
      .innerJoin('substitutions', 'substitutions.id', 'substitution_lessons.substitution_id')
      .select([
        'substitutions.id',
        'substitutions.source',
        'substitutions.absence_id',
        'substitutions.journal_id',
        'substitutions.replaced_id',
        'substitutions.substitute_id',
        'substitution_lessons.relaxed',
        'substitution_lessons.end_cause',
      ])
      .where('substitution_lessons.lesson_id', '=', lessonId)
      .orderBy('substitutions.made_at')
      .orderBy('substitutions.id')
      .execute();

  const entriesOf = (recordId: string, action: string) =>
    t.database.migrator
      .selectFrom('audit_log')
      .select(['branch_id', 'new_value'])
      .where('record_id', '=', recordId)
      .where('action', '=', action)
      .orderBy('id')
      .execute();

  const noticesOf = (accountId: string, kind: string) =>
    t.database.migrator
      .selectFrom('notifications')
      .select(['branch_id', 'data'])
      .where('account_id', '=', accountId)
      .where('kind', '=', kind)
      .execute();

  /** Every row of the tables these routes write, and the log. */
  const everything = () =>
    Promise.all([
      t.database.migrator.selectFrom('lessons').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('time_claims').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('lesson_changes').selectAll().orderBy('lesson_id').execute(),
      t.database.migrator.selectFrom('substitutions').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('substitution_lessons').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('absences').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('notifications').select('id').orderBy('id').execute(),
      t.database.migrator
        .selectFrom('audit_log')
        .select('id')
        .where('action', '<>', HELD_ENTRY_ACTION)
        .orderBy('id')
        .execute(),
      sql<{ id: string }>`select id from pgboss.job order by id`
        .execute(t.database.migrator)
        .then((result) => result.rows),
    ]);

  async function waiting(): Promise<number> {
    const found = await sql<{ n: number }>`
      select count(distinct l.pid)::int as n
      from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where a.datname = current_database() and not l.granted
    `.execute(t.database.migrator);
    return found.rows[0]?.n ?? 0;
  }

  /** Two real requests behind the publish lock held open, the first sent first. */
  async function inOrder(
    branch: string,
    first: () => Promise<Response>,
    second: () => Promise<Response>,
  ): Promise<[Response, Response]> {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const isReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const held = t.app
      .get(Transactions)
      .run([branch], async (transaction: Transaction) => {
        await sql`select pg_advisory_xact_lock(550001)`.execute(transaction);
        ready();
        await released;
      })
      .catch((error: unknown) => error);
    await isReady;
    const one = first().then((response) => response);
    await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(1);
    const two = second().then((response) => response);
    await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(2);
    release();
    expect(await held).toBeUndefined();
    return Promise.all([one, two]);
  }

  /** The number of lessons under a vacancy on the home page's "needs a teacher". */
  const vacancyLessons = async (branch: string) => {
    const attention = attentionSchema.parse((await t.get('/api/timetable/attention', branch)).body);
    return attention.needsTeacher
      .filter((one) => one.cause === 'vacancy')
      .reduce((sum, one) => sum + one.lessons, 0);
  };

  /** A new Academic Vice Principal of the branch, signed in now. */
  async function viceOf(branch: string): Promise<string> {
    const browser = await t.kit.completeSession('Zuhra', 'Nazarova');
    await t.kit.giveRole(browser.account.id, { role: 'academic_vice_principal', branchId: branch });
    return browser.cookie;
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterEach(() => {
    t.clock.set(START);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('one substitute per journal for the whole absence (edge/timetable, sentence 1)', () => {
    it('puts the substitute on every lesson of the journal in the absence in one action, one record, and tells the substitute once', async () => {
      const s = await scene();
      const substitute = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      const listed = await suggestions(s.branch, absenceId, s.journal);
      expect(listed.dates).toEqual([MONDAY, SECOND, THIRD]);
      expect(listed.teachers.find((one) => one.id === substitute.staffId)).toMatchObject({
        group: 'subject',
        dates: [MONDAY, SECOND, THIRD],
        blockedDates: [],
      });
      const answer = savedOf(
        await journalSubstitute(s.branch, absenceId, {
          journalId: s.journal,
          teacherId: substitute.staffId,
        }),
      );
      expect(answer.saved.map((one) => one.date)).toEqual([MONDAY, SECOND, THIRD]);
      expect(answer.blocked).toEqual([]);
      for (const date of [MONDAY, SECOND, THIRD]) {
        const lesson = await lessonOf(s, date);
        expect(lesson.teacher_id).toBe(substitute.staffId);
        expect(await rowsOf(lesson.id)).toEqual([
          {
            id: answer.substitutionId,
            source: 'absence',
            absence_id: absenceId,
            journal_id: s.journal,
            replaced_id: s.teacher.staffId,
            substitute_id: substitute.staffId,
            relaxed: false,
            end_cause: null,
          },
        ]);
      }
      // The lesson after the absence keeps its teacher.
      expect((await lessonOf(s, '2026-11-09')).teacher_id).toBe(s.teacher.staffId);
      const notices = await noticesOf(substitute.accountId, 'timetable.substitutions_assigned');
      expect(notices).toHaveLength(1);
      expect(notices[0]?.data).toMatchObject({
        firstDate: MONDAY,
        lastDate: THIRD,
      });
      const [entry] = await entriesOf(absenceId, 'absence.journal_substitute');
      expect(entry?.new_value).toMatchObject({
        substitutionId: answer.substitutionId,
        substituteId: substitute.staffId,
        journalId: s.journal,
      });
      // The absence's list shows the lessons with their substitute, held again.
      const lessons = await absenceLessons(s.branch, absenceId);
      expect(
        lessons.map((one) => [one.date, one.substitute?.id, one.state, one.journalId]),
      ).toEqual(
        [MONDAY, SECOND, THIRD].map((date) => [date, substitute.staffId, 'upcoming', s.journal]),
      );
    });

    it('checks each date: blocked dates are listed and the rest saved (each date still being checked)', async () => {
      const s = await scene();
      const substitute = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      // Busy on the 19th: the substitute of the other class's lesson at that time.
      const otherSecond = await lessonOf(s, SECOND, s.otherClass);
      expect((await lessonSubstitute(s.branch, otherSecond.id, substitute.staffId)).status).toBe(
        200,
      );
      // Away on the 26th.
      await absent(s.branch, substitute.staffId, THIRD, THIRD);
      const listed = await suggestions(s.branch, absenceId, s.journal);
      expect(listed.teachers.find((one) => one.id === substitute.staffId)).toMatchObject({
        dates: [MONDAY],
        blockedDates: [SECOND, THIRD],
      });
      const answer = savedOf(
        await journalSubstitute(s.branch, absenceId, {
          journalId: s.journal,
          teacherId: substitute.staffId,
        }),
      );
      expect(answer.saved.map((one) => one.date)).toEqual([MONDAY]);
      expect(answer.blocked.map((one) => [one.date, one.rules])).toEqual([
        [SECOND, ['teacher_double']],
        [THIRD, ['substitute_away']],
      ]);
      expect((await lessonOf(s, SECOND)).teacher_id).toBe(s.teacher.staffId);
      expect((await lessonOf(s, THIRD)).teacher_id).toBe(s.teacher.staffId);
    });

    it('decides the exception per date and keeps it per lesson; a later change reads the lesson’s own (decision 3)', async () => {
      const s = await scene();
      // A teacher of the subject free on the 12th only, so the exception
      // holds on the 19th and the 26th alone.
      const freeFirst = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      await absent(s.branch, freeFirst.staffId, SECOND, '2026-10-30');
      // The substitute has the subject and hours until the 19th.
      const substitute = await person(s.branch, [{ subject: s.subject, grades: [7] }], {
        until: SECOND,
      });
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      const asked = await journalSubstitute(s.branch, absenceId, {
        journalId: s.journal,
        teacherId: substitute.staffId,
      });
      refusedWith(asked, 409, 'substitution_needs_confirm');
      expect(detailsOf(asked).sort()).toEqual([
        `teacher_unavailable@${SECOND}`,
        `teacher_unavailable@${THIRD}`,
      ]);
      const answer = savedOf(
        await journalSubstitute(s.branch, absenceId, {
          journalId: s.journal,
          teacherId: substitute.staffId,
          confirm: true,
        }),
      );
      expect(answer.saved.map((one) => [one.date, one.relaxed])).toEqual([
        [MONDAY, false],
        [SECOND, true],
        [THIRD, true],
      ]);
      const second = await lessonOf(s, SECOND);
      expect((await rowsOf(second.id))[0]?.relaxed).toBe(true);
      expect((await rowsOf((await lessonOf(s, MONDAY)).id))[0]?.relaxed).toBe(false);
      // A room change of the 19th keeps the substitute under the exception
      // stored for that lesson.
      const room = await load.classes.room(s.branch);
      const changed = await keyed(
        `/api/timetable/lessons/${second.id}/room`,
        s.branch,
        { roomId: room, reason: 'A leak' },
        t.admin,
        randomUUID(),
      );
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      expect((await lessonOf(s, SECOND)).teacher_id).toBe(substitute.staffId);
      // The 12th was saved with the rules kept: once the substitute's hours
      // no longer cover it, its room change is refused, as the lesson's own
      // value says, though the record holds a relaxed lesson.
      await t.database.migrator
        .updateTable('staff_availability')
        .set({ valid_until: MONDAY })
        .where('staff_id', '=', substitute.staffId)
        .execute();
      await t.database.migrator
        .updateTable('staff_availability_ranges')
        .set({ valid_until: MONDAY })
        .where('staff_id', '=', substitute.staffId)
        .execute();
      const monday = await lessonOf(s, MONDAY);
      const refused = await keyed(
        `/api/timetable/lessons/${monday.id}/room`,
        s.branch,
        { roomId: room, reason: 'A leak' },
        t.admin,
        randomUUID(),
      );
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(detailsOf(refused)).toContain(`teacher_unavailable@${MONDAY}`);
    });

    it('keeps the subject blocked on a date where a teacher of the subject is free, and saves the dates where none is', async () => {
      const s = await scene();
      const freeFirst = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      await absent(s.branch, freeFirst.staffId, SECOND, '2026-10-30');
      const outsider = await person(s.branch, [{ subject: s.otherSubject, grades: [7] }]);
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      const answer = savedOf(
        await journalSubstitute(s.branch, absenceId, {
          journalId: s.journal,
          teacherId: outsider.staffId,
          confirm: true,
        }),
      );
      expect(answer.blocked.map((one) => one.date)).toEqual([MONDAY]);
      expect(answer.blocked[0]?.rules).toContain('teacher_subject');
      expect(answer.saved.map((one) => [one.date, one.relaxed])).toEqual([
        [SECOND, true],
        [THIRD, true],
      ]);
    });

    it('leaves a lesson already substituted as it is, and refuses when no date passes (decisions 5 and 6)', async () => {
      const s = await scene();
      const first = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const substitute = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      const third = await lessonOf(s, THIRD);
      expect((await lessonSubstitute(s.branch, third.id, first.staffId)).status).toBe(200);
      const answer = savedOf(
        await journalSubstitute(s.branch, absenceId, {
          journalId: s.journal,
          teacherId: substitute.staffId,
        }),
      );
      expect(answer.taken).toEqual([{ lessonId: third.id, date: THIRD }]);
      expect((await lessonOf(s, THIRD)).teacher_id).toBe(first.staffId);
      // Away on every other date: nothing passes, nothing changes.
      const late = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      await absent(s.branch, late.staffId, MONDAY, '2026-10-30');
      const before = await everything();
      const refused = await journalSubstitute(s.branch, absenceId, {
        journalId: s.journal,
        teacherId: late.staffId,
      });
      refusedWith(refused, 409, 'journal_substitute_none');
      expect(await everything()).toEqual(before);
    });

    it('refuses the teacher replaced as the substitute, and a withdrawn absence', async () => {
      const s = await scene();
      const absenceId = await absent(s.branch, s.teacher.staffId, SECOND, '2026-10-30');
      refusedWith(
        await journalSubstitute(s.branch, absenceId, {
          journalId: s.journal,
          teacherId: s.teacher.staffId,
        }),
        409,
        'substitute_is_replaced',
      );
      expect((await t.post(`/api/timetable/absences/${absenceId}/withdraw`, s.branch)).status).toBe(
        200,
      );
      refusedWith(
        await journalSubstitute(s.branch, absenceId, {
          journalId: s.journal,
          teacherId: s.otherTeacher.staffId,
        }),
        409,
        'absence_withdrawn',
      );
    });

    it('links a lesson substituted alone while its teacher is absent to the absence, source lesson (decision 4)', async () => {
      const s = await scene();
      const substitute = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      const second = await lessonOf(s, SECOND);
      expect((await lessonSubstitute(s.branch, second.id, substitute.staffId)).status).toBe(200);
      expect(await rowsOf(second.id)).toMatchObject([
        { source: 'lesson', absence_id: absenceId, journal_id: null },
      ]);
    });
  });

  describe('shortening and withdrawing the absence (edge/timetable, sentence 2)', () => {
    /** A scene whose three lessons of the absence (12 to 30 October) have one substitute. */
    async function substituted() {
      const s = await scene();
      const substitute = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      savedOf(
        await journalSubstitute(s.branch, absenceId, {
          journalId: s.journal,
          teacherId: substitute.staffId,
        }),
      );
      return { s, substitute, absenceId };
    }

    it('returns the future lessons the absence no longer covers to the teacher, and keeps the rest', async () => {
      const { s, substitute, absenceId } = await substituted();
      const edited = await editAbsence(s.branch, absenceId, {
        startsOn: MONDAY,
        endsOn: '2026-10-16',
      });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      const second = await lessonOf(s, SECOND);
      const third = await lessonOf(s, THIRD);
      expect(absenceSchema.parse(edited.body).returns).toEqual({
        returned: [second.id, third.id].sort(),
        kept: [],
      });
      expect((await lessonOf(s, MONDAY)).teacher_id).toBe(substitute.staffId);
      expect(second.teacher_id).toBe(s.teacher.staffId);
      expect(third.teacher_id).toBe(s.teacher.staffId);
      expect((await rowsOf(second.id))[0]?.end_cause).toBe('returned');
      expect((await rowsOf((await lessonOf(s, MONDAY)).id))[0]?.end_cause).toBeNull();
      const [entry] = await entriesOf(absenceId, 'absence.edit');
      expect(entry?.new_value).toMatchObject({ returned: [second.id, third.id].sort(), kept: [] });
      // The substitute who loses the lessons is told.
      expect(await noticesOf(substitute.accountId, 'timetable.day_changed')).toHaveLength(1);
    });

    it('keeps a lesson that started before the save with its substitute (back today)', async () => {
      const { s, substitute, absenceId } = await substituted();
      t.clock.set(at(MONDAY, '08:10'));
      const cookie = await viceOf(s.branch);
      const edited = await editAbsence(
        s.branch,
        absenceId,
        { startsOn: MONDAY, endsOn: '2026-10-11' },
        cookie,
      );
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect((await lessonOf(s, MONDAY)).teacher_id).toBe(substitute.staffId);
      expect((await lessonOf(s, SECOND)).teacher_id).toBe(s.teacher.staffId);
      expect((await lessonOf(s, THIRD)).teacher_id).toBe(s.teacher.staffId);
    });

    it('keeps a lesson whose return clashes with the substitute, and lists it (decision 2)', async () => {
      const { s, substitute, absenceId } = await substituted();
      // The teacher now holds the other class's lesson of the 26th, at the same time.
      const otherThird = await lessonOf(s, THIRD, s.otherClass);
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: s.teacher.staffId })
        .where('id', '=', otherThird.id)
        .execute();
      const edited = await editAbsence(s.branch, absenceId, {
        startsOn: MONDAY,
        endsOn: '2026-10-16',
      });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      const third = await lessonOf(s, THIRD);
      expect(absenceSchema.parse(edited.body).returns?.kept).toEqual([
        { lessonId: third.id, date: THIRD, rules: ['teacher_double'] },
      ]);
      expect(third.teacher_id).toBe(substitute.staffId);
      expect((await lessonOf(s, SECOND)).teacher_id).toBe(s.teacher.staffId);
    });

    it('returns the lessons before a later first day of a planned absence (the start moved)', async () => {
      const s = await scene();
      const substitute = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      savedOf(
        await journalSubstitute(s.branch, absenceId, {
          journalId: s.journal,
          teacherId: substitute.staffId,
        }),
      );
      const edited = await editAbsence(s.branch, absenceId, {
        startsOn: '2026-10-17',
        endsOn: '2026-10-30',
      });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      const first = await lessonOf(s, MONDAY);
      expect(absenceSchema.parse(edited.body).returns?.returned).toEqual([first.id]);
      expect(first.teacher_id).toBe(s.teacher.staffId);
      expect((await lessonOf(s, SECOND)).teacher_id).toBe(substitute.staffId);
    });

    it('shows the Principal the substitutes on the absence’s lessons', async () => {
      const { s, substitute, absenceId } = await substituted();
      const browser = await t.kit.completeSession('Malika', 'Yusupova');
      await t.kit.giveRole(browser.account.id, { role: 'principal', branchId: s.branch });
      const response = await t.get(
        `/api/timetable/absences/${absenceId}/lessons`,
        s.branch,
        browser.cookie,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const lessons = absenceLessonsSchema.parse(response.body).lessons;
      expect(lessons.map((one) => [one.substitute?.id, one.journalId])).toEqual(
        [MONDAY, SECOND, THIRD].map(() => [substitute.staffId, s.journal]),
      );
    });

    it("gives a Tutor lesson back to the class's Tutor in force (5.7b-1 decision 12)", async () => {
      const s = await scene({ tutor: true });
      const tutor = s.tutor ?? s.teacher;
      const holder = await load.tutorSubjectHolder(s.branch, s.tutorSubject ?? '', [7]);
      await hours(s.branch, holder.staffId);
      const journal = (
        await t.database.migrator
          .selectFrom('journals')
          .select('id')
          .where('class_id', '=', s.classId)
          .where('subject_id', '=', s.tutorSubject ?? '')
          .executeTakeFirstOrThrow()
      ).id;
      const absenceId = await absent(s.branch, tutor.staffId, MONDAY, '2026-10-30');
      const saved = savedOf(
        await journalSubstitute(s.branch, absenceId, {
          journalId: journal,
          teacherId: holder.staffId,
        }),
      );
      expect(saved.saved.map((one) => one.date)).toEqual([
        '2026-10-13',
        '2026-10-20',
        '2026-10-27',
      ]);
      const edited = await editAbsence(s.branch, absenceId, {
        startsOn: MONDAY,
        endsOn: '2026-10-16',
      });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      const tutorLesson = (date: string) =>
        t.database.migrator
          .selectFrom('lessons')
          .select('teacher_id')
          .where('class_id', '=', s.classId)
          .where('subject_id', '=', s.tutorSubject ?? '')
          .where('lesson_date', '=', date)
          .executeTakeFirstOrThrow();
      expect((await tutorLesson('2026-10-13')).teacher_id).toBe(holder.staffId);
      expect((await tutorLesson('2026-10-20')).teacher_id).toBe(tutor.staffId);
      expect((await tutorLesson('2026-10-27')).teacher_id).toBe(tutor.staffId);
    });

    it('leaves the new audit actions out of the personal-data reports of the people concerned (decision 10)', async () => {
      const { s, substitute, absenceId } = await substituted();
      expect(
        (await editAbsence(s.branch, absenceId, { startsOn: MONDAY, endsOn: '2026-10-16' })).status,
      ).toBe(200);
      for (const staffId of [s.teacher.staffId, substitute.staffId]) {
        const report = await t.post(`/api/people/staff/${staffId}/report`, s.branch, {});
        expect(report.status, JSON.stringify(report.body)).toBe(200);
        const actions = staffReportSchema.parse(report.body).entries.map((one) => one.action);
        expect(actions).not.toContain('absence.journal_substitute');
        expect(actions).not.toContain('absence.return');
        expect(actions).not.toContain('vacancy.journal_substitute');
      }
    });

    it('shows no substitute on a lesson the absent person holds as a substitute, and offers it to the action (review should-fix 3)', async () => {
      const s = await scene();
      // The person's own lesson of the 19th is cancelled, and the person
      // substitutes the other class's lesson at that time; then is absent.
      const own = await lessonOf(s, SECOND);
      const cancelled = await keyed(
        `/api/timetable/lessons/${own.id}/cancel`,
        s.branch,
        { reason: 'A trip' },
        t.admin,
        randomUUID(),
      );
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      const otherSecond = await lessonOf(s, SECOND, s.otherClass);
      expect((await lessonSubstitute(s.branch, otherSecond.id, s.teacher.staffId)).status).toBe(
        200,
      );
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      const listed = await absenceLessons(s.branch, absenceId);
      const held = listed.find((one) => one.id === otherSecond.id);
      expect(held?.substitute).toBeNull();
      expect(held?.state).toBe('needs_teacher');
    });

    it('returns every substituted lesson of a withdrawn absence', async () => {
      const s = await scene();
      const substitute = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const absenceId = await absent(s.branch, s.teacher.staffId, SECOND, '2026-10-30');
      savedOf(
        await journalSubstitute(s.branch, absenceId, {
          journalId: s.journal,
          teacherId: substitute.staffId,
        }),
      );
      const withdrawn = await t.post(`/api/timetable/absences/${absenceId}/withdraw`, s.branch);
      expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
      expect(absenceSchema.parse(withdrawn.body).returns?.returned).toHaveLength(2);
      expect((await lessonOf(s, SECOND)).teacher_id).toBe(s.teacher.staffId);
      expect((await lessonOf(s, THIRD)).teacher_id).toBe(s.teacher.staffId);
    });

    it('lists a lesson substituted before the absence existed, and never returns it (decision 4; spec review should-fix 4)', async () => {
      const s = await scene();
      const earlier = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const third = await lessonOf(s, THIRD);
      expect((await lessonSubstitute(s.branch, third.id, earlier.staffId)).status).toBe(200);
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      const listed = await absenceLessons(s.branch, absenceId);
      expect(listed.find((one) => one.id === third.id)?.substitute?.id).toBe(earlier.staffId);
      const edited = await editAbsence(s.branch, absenceId, {
        startsOn: MONDAY,
        endsOn: '2026-10-16',
      });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect((await lessonOf(s, THIRD)).teacher_id).toBe(earlier.staffId);
    });

    it("returns another branch's lessons in the same transaction, with that branch's audit entry, and answers nothing of it (decision 1)", async () => {
      // The person teaches on Monday in one branch and on Wednesday in another.
      const homeBranch = await t.newBranch();
      const otherBranch = await t.newBranch();
      const subject = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const shared = await load.teacher(homeBranch, {
        subjects: [{ subject, grades: [7] }],
        further: [otherBranch],
      });
      await hours(homeBranch, shared.staffId, { weekdays: [1] });
      await hours(otherBranch, shared.staffId, { weekdays: [3] });
      const home = await scene({ branch: homeBranch, teacher: shared, subject });
      const other = await scene({ branch: otherBranch, teacher: shared, weekday: 3, subject });
      const substitute = await person(otherBranch, [{ subject, grades: [7] }]);
      const absenceId = await absent(homeBranch, shared.staffId, MONDAY, '2026-10-30');
      const saved = savedOf(
        await journalSubstitute(otherBranch, absenceId, {
          journalId: other.journal,
          teacherId: substitute.staffId,
        }),
      );
      expect(saved.saved.map((one) => one.date)).toEqual([WEDNESDAY, '2026-10-21', '2026-10-28']);
      // The branch no longer linked to the person still holds the lessons (5.7a-1 decision 3).
      await t.database.migrator
        .deleteFrom('staff_branches')
        .where('staff_id', '=', shared.staffId)
        .where('branch_id', '=', otherBranch)
        .execute();
      const edited = await editAbsence(homeBranch, absenceId, {
        startsOn: MONDAY,
        endsOn: '2026-10-16',
      });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(absenceSchema.parse(edited.body).returns).toEqual({ returned: [], kept: [] });
      expect((await lessonOf(other, WEDNESDAY)).teacher_id).toBe(substitute.staffId);
      const returned = [
        (await lessonOf(other, '2026-10-21')).id,
        (await lessonOf(other, '2026-10-28')).id,
      ];
      for (const id of returned) {
        expect((await rowsOf(id))[0]?.end_cause).toBe('returned');
      }
      // Not linked to that branch any more: the lessons go to nobody there.
      expect((await lessonOf(other, '2026-10-21')).teacher_id).toBeNull();
      const entries = await entriesOf(absenceId, 'absence.return');
      expect(entries.map((one) => one.branch_id)).toEqual([otherBranch]);
      expect(entries[0]?.new_value).toMatchObject({ returned: [...returned].sort(), kept: [] });
      const [edit] = await entriesOf(absenceId, 'absence.edit');
      expect(edit?.branch_id).toBe(homeBranch);
      expect(JSON.stringify(edit?.new_value)).not.toContain(returned[0] ?? '-');
      expect((await lessonOf(home, MONDAY)).teacher_id).toBe(shared.staffId);
    });

    it("returns another branch's lesson to the person still linked there", async () => {
      const homeBranch = await t.newBranch();
      const otherBranch = await t.newBranch();
      const subject = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const shared = await load.teacher(homeBranch, {
        subjects: [{ subject, grades: [7] }],
        further: [otherBranch],
      });
      await hours(homeBranch, shared.staffId, { weekdays: [1] });
      await hours(otherBranch, shared.staffId, { weekdays: [3] });
      await scene({ branch: homeBranch, teacher: shared, subject });
      const other = await scene({ branch: otherBranch, teacher: shared, weekday: 3, subject });
      const substitute = await person(otherBranch, [{ subject, grades: [7] }]);
      const absenceId = await absent(homeBranch, shared.staffId, MONDAY, '2026-10-30');
      savedOf(
        await journalSubstitute(otherBranch, absenceId, {
          journalId: other.journal,
          teacherId: substitute.staffId,
        }),
      );
      // On the 28th the person now holds the other class's lesson at that time.
      const otherLast = await lessonOf(other, '2026-10-28', other.otherClass);
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: shared.staffId })
        .where('id', '=', otherLast.id)
        .execute();
      const edited = await editAbsence(homeBranch, absenceId, {
        startsOn: MONDAY,
        endsOn: '2026-10-16',
      });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect((await lessonOf(other, '2026-10-21')).teacher_id).toBe(shared.staffId);
      const kept = await lessonOf(other, '2026-10-28');
      expect(kept.teacher_id).toBe(substitute.staffId);
      const [entry] = await entriesOf(absenceId, 'absence.return');
      expect(entry?.branch_id).toBe(otherBranch);
      expect(entry?.new_value).toMatchObject({
        kept: [{ lessonId: kept.id, date: '2026-10-28', rules: ['teacher_double'] }],
      });
      expect((await lessonOf(other, WEDNESDAY)).teacher_id).toBe(substitute.staffId);
      expect(await noticesOf(substitute.accountId, 'timetable.day_changed')).toHaveLength(1);
    });
  });

  describe('a withdraw by an Academic Vice Principal of one branch (decision 1)', () => {
    it("returns the other branch's lessons, its entry naming the assignment of the request", async () => {
      const homeBranch = await t.newBranch();
      const otherBranch = await t.newBranch();
      const subject = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const shared = await load.teacher(homeBranch, {
        subjects: [{ subject, grades: [7] }],
        further: [otherBranch],
      });
      await hours(homeBranch, shared.staffId, { weekdays: [1] });
      await hours(otherBranch, shared.staffId, { weekdays: [3] });
      await scene({ branch: homeBranch, teacher: shared, subject });
      const other = await scene({ branch: otherBranch, teacher: shared, weekday: 3, subject });
      const substitute = await person(otherBranch, [{ subject, grades: [7] }]);
      const absenceId = await absent(homeBranch, shared.staffId, SECOND, '2026-10-30');
      savedOf(
        await journalSubstitute(otherBranch, absenceId, {
          journalId: other.journal,
          teacherId: substitute.staffId,
        }),
      );
      const browser = await t.kit.completeSession('Zuhra', 'Nazarova');
      const assignment = await t.kit.giveRole(browser.account.id, {
        role: 'academic_vice_principal',
        branchId: homeBranch,
      });
      const withdrawn = await t.post(
        `/api/timetable/absences/${absenceId}/withdraw`,
        homeBranch,
        {},
        browser.cookie,
      );
      expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
      for (const date of ['2026-10-21', '2026-10-28']) {
        expect((await lessonOf(other, date)).teacher_id).toBe(shared.staffId);
      }
      const entries = await t.database.migrator
        .selectFrom('audit_log')
        .select(['branch_id', 'assignment_id'])
        .where('record_id', '=', absenceId)
        .where('action', '=', 'absence.return')
        .execute();
      expect(entries).toEqual([{ branch_id: otherBranch, assignment_id: assignment.id }]);
    });
  });

  describe('a vacancy’s journal (decision 7)', () => {
    it('offers the acting teacher first and substitutes the period only, which leaves "needs a teacher"', async () => {
      const s = await scene({ vacancy: true });
      const vacancy = s.vacancy ?? '';
      const acting = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const named = await keyed(
        '/api/timetable/acting-teachers',
        s.branch,
        { vacancyId: vacancy, journalId: s.otherJournal, personId: acting.staffId, from: SECOND },
        t.admin,
        randomUUID(),
      );
      expect(named.status, JSON.stringify(named.body)).toBe(201);
      const listed = await t.get(
        `/api/timetable/vacancies/${vacancy}/journals/${s.otherJournal}/substitutes?from=${SECOND}&until=${THIRD}`,
        s.branch,
      );
      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      const answer = journalSubstitutesAnswerSchema.parse(listed.body);
      expect(answer.dates).toEqual([SECOND]);
      expect(answer.teachers[0]).toMatchObject({ id: acting.staffId, acting: true });
      // The 26th already has a substitute: it is left as it is.
      const otherThird = await lessonOf(s, THIRD, s.otherClass);
      const chosen = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      expect((await lessonSubstitute(s.branch, otherThird.id, chosen.staffId)).status).toBe(200);
      const waiting = await vacancyLessons(s.branch);
      const saved = savedOf(
        await vacancySubstitute(s.branch, vacancy, {
          journalId: s.otherJournal,
          teacherId: acting.staffId,
          from: SECOND,
          until: '2026-10-27',
        }),
      );
      const second = await lessonOf(s, SECOND, s.otherClass);
      expect(saved.saved).toEqual([{ lessonId: second.id, date: SECOND, relaxed: false }]);
      expect(saved.taken).toEqual([{ lessonId: otherThird.id, date: THIRD }]);
      expect(second.teacher_id).toBe(acting.staffId);
      expect((await lessonOf(s, MONDAY, s.otherClass)).teacher_id).toBe(vacancy);
      expect((await lessonOf(s, THIRD, s.otherClass)).teacher_id).toBe(chosen.staffId);
      expect(await rowsOf(second.id)).toMatchObject([
        { source: 'journal', journal_id: s.otherJournal, replaced_id: vacancy, absence_id: null },
      ]);
      expect(await entriesOf(vacancy, 'vacancy.journal_substitute')).toHaveLength(1);
      expect(await vacancyLessons(s.branch)).toBe(waiting - 1);
    });

    it('refuses a period that starts before today', async () => {
      const s = await scene({ vacancy: true });
      refusedWith(
        await vacancySubstitute(s.branch, s.vacancy ?? '', {
          journalId: s.otherJournal,
          teacherId: s.otherTeacher.staffId,
          from: '2026-10-09',
        }),
        400,
        'validation_failed',
      );
    });
  });

  describe('two changes at the same moment (decision 13)', () => {
    it('a save before a shortening: the shortening returns what the save put outside it', async () => {
      const s = await scene();
      const substitute = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      const [saved, edited] = await inOrder(
        s.branch,
        () =>
          journalSubstitute(s.branch, absenceId, {
            journalId: s.journal,
            teacherId: substitute.staffId,
          }),
        () => editAbsence(s.branch, absenceId, { startsOn: MONDAY, endsOn: '2026-10-16' }),
      );
      expect(savedOf(saved).saved).toHaveLength(3);
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(absenceSchema.parse(edited.body).returns?.returned).toHaveLength(2);
      expect((await lessonOf(s, MONDAY)).teacher_id).toBe(substitute.staffId);
      expect((await lessonOf(s, SECOND)).teacher_id).toBe(s.teacher.staffId);
    });

    it('a shortening before a save: the save covers only the days left', async () => {
      const s = await scene();
      const substitute = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      const [edited, saved] = await inOrder(
        s.branch,
        () => editAbsence(s.branch, absenceId, { startsOn: MONDAY, endsOn: '2026-10-16' }),
        () =>
          journalSubstitute(s.branch, absenceId, {
            journalId: s.journal,
            teacherId: substitute.staffId,
          }),
      );
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(absenceSchema.parse(edited.body).returns?.returned).toEqual([]);
      expect(savedOf(saved).saved.map((one) => one.date)).toEqual([MONDAY]);
      expect((await lessonOf(s, SECOND)).teacher_id).toBe(s.teacher.staffId);
    });

    it('a lesson substitution before a shortening: linked, then returned', async () => {
      const s = await scene();
      const substitute = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      const second = await lessonOf(s, SECOND);
      const [substituted, edited] = await inOrder(
        s.branch,
        () => lessonSubstitute(s.branch, second.id, substitute.staffId),
        () => editAbsence(s.branch, absenceId, { startsOn: MONDAY, endsOn: '2026-10-16' }),
      );
      expect(substituted.status, JSON.stringify(substituted.body)).toBe(200);
      expect(absenceSchema.parse(edited.body).returns?.returned).toEqual([second.id]);
      expect((await lessonOf(s, SECOND)).teacher_id).toBe(s.teacher.staffId);
    });

    it('a shortening before a lesson substitution: the lesson is the teacher’s, not linked', async () => {
      const s = await scene();
      const substitute = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      const second = await lessonOf(s, SECOND);
      const [edited, substituted] = await inOrder(
        s.branch,
        () => editAbsence(s.branch, absenceId, { startsOn: MONDAY, endsOn: '2026-10-16' }),
        () => lessonSubstitute(s.branch, second.id, substitute.staffId),
      );
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(substituted.status, JSON.stringify(substituted.body)).toBe(200);
      expect(await rowsOf(second.id)).toMatchObject([{ source: 'lesson', absence_id: null }]);
    });
  });

  describe('a claim taken at the same moment (the refusals mapped)', () => {
    /**
     * A transaction of another branch that puts `teacherId` on its lesson
     * and holds the claim, which the route meets at its commit check.
     */
    async function heldClaim(branch: string, lessonId: string, teacherId: string) {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const held = t.app
        .get(Transactions)
        .run([branch], async (transaction: Transaction) => {
          await transaction
            .updateTable('lessons')
            .set({ teacher_id: teacherId })
            .where('id', '=', lessonId)
            .execute();
          await heldEntry(transaction, branch);
          await sql`set constraints all immediate`.execute(transaction);
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await isReady;
      return { release, held };
    }

    it('answers substitution_blocked to a per-journal save whose substitute is claimed meanwhile, and leaves nothing behind', async () => {
      const s = await scene();
      const elsewhere = await scene();
      const substitute = await person(s.branch, [{ subject: s.subject, grades: [7] }], {
        further: [elsewhere.branch],
      });
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      const other = await lessonOf(elsewhere, SECOND);
      const holding = await heldClaim(elsewhere.branch, other.id, substitute.staffId);
      const before = await everything();
      const pending = journalSubstitute(s.branch, absenceId, {
        journalId: s.journal,
        teacherId: substitute.staffId,
      }).then((one) => one);
      await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(1);
      holding.release();
      expect(await holding.held).toBeUndefined();
      refusedWith(await pending, 409, 'substitution_blocked');
      const after = await everything();
      expect(after.slice(3)).toEqual(before.slice(3));
      expect((await lessonOf(s, MONDAY)).teacher_id).toBe(s.teacher.staffId);
    });

    it('answers substitution_return_blocked to a shortening whose teacher is claimed meanwhile', async () => {
      const s = await scene();
      const elsewhere = await scene();
      const substitute = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      savedOf(
        await journalSubstitute(s.branch, absenceId, {
          journalId: s.journal,
          teacherId: substitute.staffId,
        }),
      );
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: s.teacher.staffId, branch_id: elsewhere.branch, is_main: false })
        .execute();
      const other = await lessonOf(elsewhere, SECOND);
      const holding = await heldClaim(elsewhere.branch, other.id, s.teacher.staffId);
      const before = await everything();
      const pending = editAbsence(s.branch, absenceId, {
        startsOn: MONDAY,
        endsOn: '2026-10-16',
      }).then((one) => one);
      await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(1);
      holding.release();
      expect(await holding.held).toBeUndefined();
      refusedWith(await pending, 409, 'substitution_return_blocked');
      const after = await everything();
      expect(after.slice(3)).toEqual(before.slice(3));
      expect((await lessonOf(s, SECOND)).teacher_id).toBe(substitute.staffId);
    });
  });

  describe('two changes at the same moment in two branches (review correction 1)', () => {
    async function twoBranches() {
      const homeBranch = await t.newBranch();
      const otherBranch = await t.newBranch();
      const subject = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const shared = await load.teacher(homeBranch, {
        subjects: [{ subject, grades: [7] }],
        further: [otherBranch],
      });
      await hours(homeBranch, shared.staffId, { weekdays: [1] });
      await hours(otherBranch, shared.staffId, { weekdays: [3] });
      await scene({ branch: homeBranch, teacher: shared, subject });
      const other = await scene({ branch: otherBranch, teacher: shared, weekday: 3, subject });
      const substitute = await person(otherBranch, [{ subject, grades: [7] }]);
      const absenceId = await absent(homeBranch, shared.staffId, MONDAY, '2026-10-30');
      return { homeBranch, otherBranch, shared, other, substitute, absenceId };
    }

    it("a save in the other branch before a shortening: the shortening returns that branch's lessons", async () => {
      const b = await twoBranches();
      const [saved, edited] = await inOrder(
        b.otherBranch,
        () =>
          journalSubstitute(b.otherBranch, b.absenceId, {
            journalId: b.other.journal,
            teacherId: b.substitute.staffId,
          }),
        () => editAbsence(b.homeBranch, b.absenceId, { startsOn: MONDAY, endsOn: '2026-10-16' }),
      );
      expect(savedOf(saved).saved).toHaveLength(3);
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect((await lessonOf(b.other, '2026-10-21')).teacher_id).toBe(b.shared.staffId);
      expect((await lessonOf(b.other, WEDNESDAY)).teacher_id).toBe(b.substitute.staffId);
    });

    it('a shortening before a save in the other branch: the save covers only the days left', async () => {
      const b = await twoBranches();
      const [edited, saved] = await inOrder(
        b.otherBranch,
        () => editAbsence(b.homeBranch, b.absenceId, { startsOn: MONDAY, endsOn: '2026-10-16' }),
        () =>
          journalSubstitute(b.otherBranch, b.absenceId, {
            journalId: b.other.journal,
            teacherId: b.substitute.staffId,
          }),
      );
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(savedOf(saved).saved.map((one) => one.date)).toEqual([WEDNESDAY]);
      expect((await lessonOf(b.other, '2026-10-21')).teacher_id).toBe(b.shared.staffId);
    });
  });

  describe('permissions and ids', () => {
    it("answers 404 for another branch's or an unknown absence, journal, teacher and vacancy, and changes nothing", async () => {
      const s = await scene({ vacancy: true });
      const elsewhere = await scene({ vacancy: true });
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      const theirAbsence = await absent(
        elsewhere.branch,
        elsewhere.teacher.staffId,
        MONDAY,
        '2026-10-30',
      );
      const vice = await viceOf(s.branch);
      const before = await everything();
      const body = { journalId: s.journal, teacherId: s.otherTeacher.staffId };
      for (const cookie of [t.admin, vice]) {
        for (const id of [theirAbsence, UNKNOWN]) {
          refusedWith(await journalSubstitute(s.branch, id, body, cookie), 404, 'not_found');
          refusedWith(
            await t.get(
              `/api/timetable/absences/${id}/journals/${s.journal}/substitutes`,
              s.branch,
              cookie,
            ),
            404,
            'not_found',
          );
        }
        for (const journalId of [elsewhere.journal, UNKNOWN]) {
          refusedWith(
            await journalSubstitute(s.branch, absenceId, { ...body, journalId }, cookie),
            404,
            'not_found',
          );
          refusedWith(
            await t.get(
              `/api/timetable/absences/${absenceId}/journals/${journalId}/substitutes`,
              s.branch,
              cookie,
            ),
            404,
            'not_found',
          );
          refusedWith(
            await vacancySubstitute(
              s.branch,
              s.vacancy ?? '',
              { ...body, journalId, from: SECOND },
              cookie,
            ),
            404,
            'not_found',
          );
          refusedWith(
            await t.get(
              `/api/timetable/vacancies/${s.vacancy ?? ''}/journals/${journalId}/substitutes?from=${SECOND}`,
              s.branch,
              cookie,
            ),
            404,
            'not_found',
          );
        }
        for (const teacherId of [elsewhere.otherTeacher.staffId, UNKNOWN]) {
          refusedWith(
            await journalSubstitute(s.branch, absenceId, { ...body, teacherId }, cookie),
            404,
            'not_found',
          );
          refusedWith(
            await vacancySubstitute(
              s.branch,
              s.vacancy ?? '',
              { journalId: s.otherJournal, teacherId, from: SECOND },
              cookie,
            ),
            404,
            'not_found',
          );
        }
        for (const vacancyId of [elsewhere.vacancy ?? '', UNKNOWN, s.otherTeacher.staffId]) {
          refusedWith(
            await vacancySubstitute(
              s.branch,
              vacancyId,
              { journalId: s.otherJournal, teacherId: s.otherTeacher.staffId, from: SECOND },
              cookie,
            ),
            404,
            'not_found',
          );
          refusedWith(
            await t.get(
              `/api/timetable/vacancies/${vacancyId}/journals/${s.otherJournal}/substitutes?from=${SECOND}`,
              s.branch,
              cookie,
            ),
            404,
            'not_found',
          );
        }
      }
      expect(await everything()).toEqual(before);
    });

    it("answers 404 to a shortening and a withdraw of another branch's or an unknown absence that holds substitutions, and changes nothing (.claude/rules/api.md: a route that starts writing more tables)", async () => {
      const s = await scene();
      const elsewhere = await scene();
      const substitute = await person(elsewhere.branch, [
        { subject: elsewhere.subject, grades: [7] },
      ]);
      const theirAbsence = await absent(
        elsewhere.branch,
        elsewhere.teacher.staffId,
        MONDAY,
        '2026-10-30',
      );
      savedOf(
        await journalSubstitute(elsewhere.branch, theirAbsence, {
          journalId: elsewhere.journal,
          teacherId: substitute.staffId,
        }),
      );
      // And one of the branch of the request, which a wrong id must not reach.
      const ownSubstitute = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const own = await absent(s.branch, s.teacher.staffId, SECOND, '2026-10-30');
      savedOf(
        await journalSubstitute(s.branch, own, {
          journalId: s.journal,
          teacherId: ownSubstitute.staffId,
        }),
      );
      const vice = await viceOf(s.branch);
      const before = await everything();
      for (const cookie of [t.admin, vice]) {
        for (const id of [theirAbsence, UNKNOWN]) {
          refusedWith(
            await editAbsence(s.branch, id, { startsOn: MONDAY, endsOn: '2026-10-16' }, cookie),
            404,
            'not_found',
          );
          refusedWith(
            await t.post(`/api/timetable/absences/${id}/withdraw`, s.branch, {}, cookie),
            404,
            'not_found',
          );
        }
      }
      expect(await everything()).toEqual(before);
    });

    it('is refused to the Principal of the branch on the four routes, and nothing changes', async () => {
      const s = await scene({ vacancy: true });
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      const browser = await t.kit.completeSession('Malika', 'Yusupova');
      await t.kit.giveRole(browser.account.id, { role: 'principal', branchId: s.branch });
      const before = await everything();
      const body = { journalId: s.journal, teacherId: s.otherTeacher.staffId };
      refusedWith(
        await journalSubstitute(s.branch, absenceId, body, browser.cookie),
        403,
        'permission_denied',
      );
      refusedWith(
        await vacancySubstitute(
          s.branch,
          s.vacancy ?? '',
          { journalId: s.otherJournal, teacherId: s.otherTeacher.staffId, from: SECOND },
          browser.cookie,
        ),
        403,
        'permission_denied',
      );
      refusedWith(
        await t.get(
          `/api/timetable/absences/${absenceId}/journals/${s.journal}/substitutes`,
          s.branch,
          browser.cookie,
        ),
        403,
        'permission_denied',
      );
      refusedWith(
        await t.get(
          `/api/timetable/vacancies/${s.vacancy ?? ''}/journals/${s.otherJournal}/substitutes?from=${SECOND}`,
          s.branch,
          browser.cookie,
        ),
        403,
        'permission_denied',
      );
      expect(await everything()).toEqual(before);
    });

    it('keeps a used key to its account, its branch and its role (request keys)', async () => {
      const s = await scene();
      const elsewhere = await scene();
      const substitute = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const absenceId = await absent(s.branch, s.teacher.staffId, MONDAY, '2026-10-30');
      const theirAbsence = await absent(
        elsewhere.branch,
        elsewhere.teacher.staffId,
        MONDAY,
        '2026-10-30',
      );
      const key = randomUUID();
      const body = { journalId: s.journal, teacherId: substitute.staffId };
      const first = savedOf(await journalSubstitute(s.branch, absenceId, body, t.admin, key));
      const vice = await viceOf(s.branch);
      const browser = await t.kit.completeSession('Malika', 'Yusupova');
      await t.kit.giveRole(browser.account.id, { role: 'principal', branchId: s.branch });
      // A repeat answers the stored answer and writes nothing.
      const before = await everything();
      expect(savedOf(await journalSubstitute(s.branch, absenceId, body, t.admin, key))).toEqual(
        first,
      );
      expect(await everything()).toEqual(before);
      refusedWith(
        await journalSubstitute(s.branch, absenceId, body, vice, key),
        409,
        'request_key_reused',
      );
      refusedWith(
        await journalSubstitute(s.branch, theirAbsence, body, t.admin, key),
        404,
        'not_found',
      );
      refusedWith(await journalSubstitute(s.branch, UNKNOWN, body, t.admin, key), 404, 'not_found');
      for (const journalId of [elsewhere.journal, UNKNOWN]) {
        refusedWith(
          await journalSubstitute(s.branch, absenceId, { ...body, journalId }, t.admin, key),
          404,
          'not_found',
        );
      }
      for (const teacherId of [elsewhere.otherTeacher.staffId, UNKNOWN]) {
        refusedWith(
          await journalSubstitute(s.branch, absenceId, { ...body, teacherId }, t.admin, key),
          404,
          'not_found',
        );
      }
      refusedWith(
        await journalSubstitute(s.branch, absenceId, body, browser.cookie, key),
        403,
        'permission_denied',
      );
      expect(await everything()).toEqual(before);
    });

    it("keeps a used key of a vacancy's save to its account, its branch and its role (request keys)", async () => {
      const s = await scene({ vacancy: true });
      const elsewhere = await scene({ vacancy: true });
      const substitute = await person(s.branch, [{ subject: s.subject, grades: [7] }]);
      const vacancy = s.vacancy ?? '';
      const key = randomUUID();
      const body = { journalId: s.otherJournal, teacherId: substitute.staffId, from: SECOND };
      const first = savedOf(await vacancySubstitute(s.branch, vacancy, body, t.admin, key));
      const vice = await viceOf(s.branch);
      const browser = await t.kit.completeSession('Malika', 'Yusupova');
      await t.kit.giveRole(browser.account.id, { role: 'principal', branchId: s.branch });
      const before = await everything();
      expect(savedOf(await vacancySubstitute(s.branch, vacancy, body, t.admin, key))).toEqual(
        first,
      );
      expect(await everything()).toEqual(before);
      refusedWith(
        await vacancySubstitute(s.branch, vacancy, body, vice, key),
        409,
        'request_key_reused',
      );
      for (const id of [elsewhere.vacancy ?? '', UNKNOWN]) {
        refusedWith(await vacancySubstitute(s.branch, id, body, t.admin, key), 404, 'not_found');
      }
      for (const journalId of [elsewhere.otherJournal, UNKNOWN]) {
        refusedWith(
          await vacancySubstitute(s.branch, vacancy, { ...body, journalId }, t.admin, key),
          404,
          'not_found',
        );
      }
      refusedWith(
        await vacancySubstitute(s.branch, vacancy, body, browser.cookie, key),
        403,
        'permission_denied',
      );
      expect(await everything()).toEqual(before);
    });
  });
});
