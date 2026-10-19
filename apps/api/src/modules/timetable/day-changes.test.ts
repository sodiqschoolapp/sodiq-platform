import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  dayAnswerSchema,
  dayChangeAnswerSchema,
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
import { DAY_REFUSALS } from './day-changes.service.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const changed = (response: Response) => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return dayChangeAnswerSchema.parse(response.body);
};

/** The details of a `restore_blocked`. */
const blockedBy = (response: Response) => {
  refusedWith(response, 409, 'restore_blocked');
  const body = response.body as {
    error: { details: { code: string; path: string; room?: { id: string; name: string } }[] };
  };
  return {
    rules: body.error.details.filter((one) => one.path !== 'rooms').map((one) => one.code),
    rooms: body.error.details.flatMap((one) => (one.room === undefined ? [] : [one.room.id])),
  };
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

/** The Monday a week after `MONDAY`. */
const NEXT_MONDAY = '2026-10-19';

// All names are invented. Task 5.6a-1, pull request #160: one-day changes,
// the cancel of one lesson and its restore (docs/spec/06-timetable.md,
// Changes after publishing: "One-day change. … Every one-day change needs a
// reason, applies to that date only and passes the same rules."; How
// surprises are prevented: "Today's lessons change only through a one-day
// change with a reason. A past lesson can only be corrected one at a time by
// the Academic Vice Principal, with a reason."; edge/timetable, After
// publishing: "A cancelled lesson is restored after its room went to another
// lesson. Every rule is checked again. The restore can be refused, with
// another room offered."). The clock stands at 23:55 on Saturday 10 October
// 2026 in Tashkent.
describe('one-day changes: cancel and restore', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let northScene: Scene;

  const keyed = (path: string, branch: string, body: object, cookie: string, key: string) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, key)
      .send(body);

  const cancel = (
    branch: string,
    id: string,
    reason: unknown = 'Excursion to the museum',
    cookie = t.admin,
    key: string = randomUUID(),
  ) => keyed(`/api/timetable/lessons/${id}/cancel`, branch, { reason }, cookie, key);

  const restore = (branch: string, id: string, cookie = t.admin, key: string = randomUUID()) =>
    keyed(`/api/timetable/lessons/${id}/restore`, branch, {}, cookie, key);

  const day = (branch: string, classId: string, date: string, cookie = t.admin) =>
    t.get(`/api/timetable/day?date=${date}&classId=${classId}`, branch, cookie);

  const publish = (branch: string, version: string, startsOn: string) =>
    request(t.kit.server)
      .post(`/api/timetable/versions/${version}/publish`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ startsOn });

  /** Hours of a person in the branch from 1 September, Monday to Friday, all day. */
  async function hours(branch: string, staffId: string, from = '2026-09-01', start = 0) {
    const entry = await t.database.migrator
      .insertInto('staff_availability')
      .values({ branch_id: branch, staff_id: staffId, valid_from: from })
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
          end_minutes: 1440,
          valid_from: from,
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

  /** A teacher of the subject with an account and hours. */
  async function teacherOf(branch: string, subject: string) {
    const teacher = await load.teacher(branch, { subjects: [{ subject, grades: [7] }] });
    await hours(branch, teacher.staffId);
    return teacher;
  }

  /**
   * A branch (its own unless given) with a year of four dated quarters, a day
   * of three lessons from 08:00 on every weekday, two classes of grade 7 each
   * with a home room, and a version published from Monday 12 October: maths
   * of each class on Monday in the first slot with a teacher of its own, and
   * `tutor` a Tutor row of the first class on Tuesday.
   */
  async function scene(input: { branch?: string; tutor?: boolean } = {}) {
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
    const subject = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const room = await load.classes.room(branch);
    const otherRoom = await load.classes.room(branch);
    const spareRoom = await load.classes.room(branch);
    const classId = await load.classes.schoolClass(branch, year, { grade: 7, room });
    const otherClass = await load.classes.schoolClass(branch, year, { grade: 7, room: otherRoom });
    const teacher = await teacherOf(branch, subject);
    const otherTeacher = await teacherOf(branch, subject);
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
    await placeAt(branch, version, rowId, 1);
    const otherRow = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: otherClass,
      subject_id: subject,
      teacher_id: otherTeacher.staffId,
      lessons_per_week: 1,
    });
    await placeAt(branch, version, otherRow, 1);
    let tutorSubject: string | null = null;
    let tutor: { staffId: string; accountId: string } | null = null;
    let tutorRowId: string | null = null;
    if (input.tutor === true) {
      tutorSubject = await load.tutorSubject({ grades: [7] });
      await t.database.migrator
        .updateTable('subjects')
        .set({ journal_type: 'attendance_only' })
        .where('id', '=', tutorSubject)
        .execute();
      tutor = await load.teacher(branch);
      await hours(branch, tutor.staffId);
      tutorRowId = await load.tutorOf(branch, classId, tutor.accountId);
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
    return {
      branch,
      year,
      subject,
      room,
      otherRoom,
      spareRoom,
      classId,
      otherClass,
      teacher,
      otherTeacher,
      version,
      rowId,
      tutorSubject,
      tutor,
      tutorRowId,
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /** The stored lesson of a class and subject on a date. */
  const lessonOf = async (s: Scene, date: string, classId = s.classId, subject = s.subject) =>
    await t.database.migrator
      .selectFrom('lessons')
      .selectAll()
      .where('branch_id', '=', s.branch)
      .where('class_id', '=', classId)
      .where('subject_id', '=', subject)
      .where('lesson_date', '=', date)
      .executeTakeFirstOrThrow();

  const rowOf = (id: string) =>
    t.database.migrator.selectFrom('lessons').selectAll().where('id', '=', id).executeTakeFirst();

  const claimsOf = (id: string) =>
    t.database.migrator
      .selectFrom('time_claims')
      .select('kind')
      .where('lesson_id', '=', id)
      .execute();

  const noticesOf = (accountId: string) =>
    t.database.migrator
      .selectFrom('notifications')
      .select(['branch_id', 'data'])
      .where('account_id', '=', accountId)
      .where('kind', '=', 'timetable.day_changed')
      .orderBy('id')
      .execute();

  const markOf = async (id: string) =>
    (
      await t.database.migrator
        .selectFrom('lesson_changes')
        .select('changed_at')
        .where('lesson_id', '=', id)
        .executeTakeFirst()
    )?.changed_at ?? null;

  /** Every row of the tables a cancel or a restore writes, and the log. */
  const everything = () =>
    Promise.all([
      t.database.migrator.selectFrom('lessons').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('lesson_blocks').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('time_claims').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('lesson_changes').selectAll().orderBy('lesson_id').execute(),
      t.database.migrator.selectFrom('notifications').select('id').orderBy('id').execute(),
      sql<{ id: string }>`select id from pgboss.job order by id`
        .execute(t.database.migrator)
        .then((result) => result.rows),
      t.database.migrator.selectFrom('audit_log').select('id').orderBy('id').execute(),
    ]);

  /**
   * A copy of a stored lesson in a block of its own dated today at `time`
   * (the publish never writes a date of today), so that a test can meet the
   * clock; written by the migrator.
   */
  async function todayLesson(s: Scene, time: string, end: string) {
    const from = await lessonOf(s, MONDAY);
    const block = await t.database.migrator
      .selectFrom('lesson_blocks')
      .selectAll()
      .where('id', '=', from.block_id)
      .executeTakeFirstOrThrow();
    const made = await t.database.migrator
      .insertInto('lesson_blocks')
      .values({
        branch_id: s.branch,
        academic_year_id: block.academic_year_id,
        quarter_id: block.quarter_id,
        lesson_date: '2026-10-10',
        starts_at: at('2026-10-10', time),
        ends_at: at('2026-10-10', end),
        version_id: block.version_id,
        pattern_block_id: block.pattern_block_id,
      })
      .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
      .executeTakeFirstOrThrow();
    const lesson = await t.database.migrator
      .insertInto('lessons')
      .values({
        branch_id: s.branch,
        block_id: made.id,
        lesson_date: made.lesson_date,
        starts_at: made.starts_at,
        ends_at: made.ends_at,
        class_id: from.class_id,
        subject_id: from.subject_id,
        load_row_id: from.load_row_id,
        pattern_entry_id: from.pattern_entry_id,
        teacher_id: from.teacher_id,
        room_id: from.room_id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return lesson.id;
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    northScene = await scene({ branch: t.north });
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the day of a class', () => {
    it('lists the class’s stored lessons of the date with what can be done, for the Principal too', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const response = await day(s.branch, s.classId, NEXT_MONDAY, t.principal);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const answer = dayAnswerSchema.parse(response.body);
      expect(answer.today).toBe('2026-10-10');
      expect(answer.lessons.map((one) => one.id)).toEqual([lesson.id]);
      expect(answer.lessons[0]).toMatchObject({
        start: 480,
        end: 525,
        unit: { kind: 'class', id: s.classId },
        teacher: { id: s.teacher.staffId, kind: 'person' },
        room: { id: s.room },
        cancelCause: null,
        canCancel: true,
        canRestore: false,
      });
    });

    it('answers 404 for a class of another branch and an unknown one, as the Academic Vice Principal and the Super Admin', async () => {
      const other = await scene();
      for (const cookie of [t.vicePrincipal, t.admin]) {
        refusedWith(await day(t.north, other.classId, NEXT_MONDAY, cookie), 404, 'not_found');
        refusedWith(await day(t.north, UNKNOWN, NEXT_MONDAY, cookie), 404, 'not_found');
      }
    });
  });

  describe('a cancel', () => {
    it('cancels one lesson with its reason, drops its claims, marks it, notifies its teacher once and writes the log (Academic Vice Principal)', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, '2026-10-26');
      expect(await claimsOf(lesson.id)).not.toEqual([]);
      const answer = changed(
        await cancel(s.branch, lesson.id, '  Excursion to the museum  ', t.vicePrincipal),
      );
      expect(answer.lesson).toMatchObject({
        id: lesson.id,
        cancelCause: 'reason',
        cancelReason: 'Excursion to the museum',
        canCancel: false,
        canRestore: true,
        changed: true,
      });
      const row = await rowOf(lesson.id);
      expect(row).toMatchObject({
        cancel_cause: 'reason',
        cancel_reason: 'Excursion to the museum',
      });
      expect(await claimsOf(lesson.id)).toEqual([]);
      expect(await markOf(lesson.id)).toEqual(t.clock.now());
      const notices = await noticesOf(s.teacher.accountId);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        branch_id: s.branch,
        data: {
          weekStart: '2026-10-26',
          before: [{ date: '2026-10-26', start: '08:00', cancelled: false, changed: true }],
          after: [{ date: '2026-10-26', start: '08:00', cancelled: true, changed: true }],
        },
      });
      // The other class's teacher, whose week did not change, gets none.
      expect(await noticesOf(s.otherTeacher.accountId)).toEqual([]);
      const [entry] = await t.entries('lesson.cancel', lesson.id);
      expect(entry).toMatchObject({
        branch_id: s.branch,
        assignment_id: t.viceAssignment,
        old_value: { date: '2026-10-26', teacherId: s.teacher.staffId, cancelCause: null },
        new_value: {
          cancelCause: 'reason',
          reason: 'Excursion to the museum',
          notices: { notified: 1, marked: 1 },
        },
      });
    });

    it('refuses a reason missing, of spaces only or of 501 characters as an input error', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, '2026-11-09');
      const before = await everything();
      refusedWith(
        await keyed(
          `/api/timetable/lessons/${lesson.id}/cancel`,
          s.branch,
          {},
          t.admin,
          randomUUID(),
        ),
        400,
        'validation_failed',
      );
      for (const reason of ['', '    ', 'a'.repeat(501)]) {
        refusedWith(await cancel(s.branch, lesson.id, reason), 400, 'validation_failed');
      }
      expect(await everything()).toEqual(before);
      changed(await cancel(s.branch, lesson.id, 'a'.repeat(500)));
    });

    it('refuses a lesson already cancelled', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, '2026-11-16');
      changed(await cancel(s.branch, lesson.id));
      refusedWith(await cancel(s.branch, lesson.id), 409, 'lesson_cancelled');
      expect(await t.entries('lesson.cancel', lesson.id)).toHaveLength(1);
    });

    it('takes only the lesson named: the other class’s lesson at the same time stays', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, '2026-11-23');
      const other = await lessonOf(s, '2026-11-23', s.otherClass);
      changed(await cancel(s.branch, lesson.id));
      expect(await rowOf(other.id)).toMatchObject({ cancel_cause: null });
    });

    it('cancels a lesson of today that starts after the clock, and refuses one that started or starts now (decision 3)', async () => {
      const s = await scene();
      const earlier = await todayLesson(s, '23:50', '23:53');
      const now = await todayLesson(s, '23:55', '23:56');
      const later = await todayLesson(s, '23:57', '23:59');
      changed(await cancel(s.branch, later));
      for (const id of [now, earlier]) {
        const before = await everything();
        refusedWith(await cancel(s.branch, id), 409, 'lesson_started');
        expect(await everything()).toEqual(before);
      }
      // A restore of a started lesson is refused the same way.
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: 'Rain' })
        .where('id', '=', earlier)
        .execute();
      refusedWith(await restore(s.branch, earlier), 409, 'lesson_started');
    });

    it('is refused to the Principal on both changes, and nothing changes', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, '2026-11-30');
      const before = await everything();
      refusedWith(await cancel(s.branch, lesson.id, 'Rain', t.principal), 403, 'permission_denied');
      refusedWith(await restore(s.branch, lesson.id, t.principal), 403, 'permission_denied');
      expect(await everything()).toEqual(before);
    });

    it('answers 404 for a lesson of another branch and an unknown one, as the Academic Vice Principal and the Super Admin, and nothing changes', async () => {
      const other = await scene();
      const foreign = await lessonOf(other, NEXT_MONDAY);
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: 'Rain' })
        .where('id', '=', (await lessonOf(other, '2026-10-26')).id)
        .execute();
      const foreignCancelled = (await lessonOf(other, '2026-10-26')).id;
      for (const cookie of [t.vicePrincipal, t.admin]) {
        const before = await everything();
        refusedWith(await cancel(t.north, foreign.id, 'Rain', cookie), 404, 'not_found');
        refusedWith(await cancel(t.north, UNKNOWN, 'Rain', cookie), 404, 'not_found');
        refusedWith(await restore(t.north, foreignCancelled, cookie), 404, 'not_found');
        refusedWith(await restore(t.north, UNKNOWN, cookie), 404, 'not_found');
        expect(await everything()).toEqual(before);
      }
    });

    it('keeps a used key to its account, its branch and its role (request keys)', async () => {
      const s = northScene;
      const other = await scene();
      const foreign = await lessonOf(other, NEXT_MONDAY);
      const foreignCancelled = await lessonOf(other, '2026-10-26');
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: 'Rain' })
        .where('id', '=', foreignCancelled.id)
        .execute();
      for (const action of ['cancel', 'restore'] as const) {
        const lesson = await lessonOf(s, action === 'cancel' ? '2026-12-07' : '2027-01-25');
        if (action === 'restore') changed(await cancel(s.branch, lesson.id));
        const send = (id: string, cookie: string, key: string) =>
          action === 'cancel'
            ? cancel(s.branch, id, 'Rain', cookie, key)
            : restore(s.branch, id, cookie, key);
        const key = randomUUID();
        changed(await send(lesson.id, t.vicePrincipal, key));
        // A repeat answers the stored answer and changes nothing more.
        const after = await everything();
        changed(await send(lesson.id, t.vicePrincipal, key));
        expect(await everything()).toEqual(after);
        refusedWith(await send(lesson.id, t.admin, key), 409, 'request_key_reused');
        const target = action === 'cancel' ? foreign.id : foreignCancelled.id;
        refusedWith(await send(target, t.vicePrincipal, key), 404, 'not_found');
        refusedWith(await send(UNKNOWN, t.vicePrincipal, key), 404, 'not_found');
        refusedWith(await send(lesson.id, t.principal, key), 403, 'permission_denied');
        expect(await everything()).toEqual(after);
        expect(await t.entries(`lesson.${action}`, lesson.id)).toHaveLength(1);
      }
    });
  });

  describe('a restore', () => {
    it('restores a one-day cancel: the claims come back, the lesson is marked and its teacher notified', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, '2026-12-14');
      changed(await cancel(s.branch, lesson.id));
      const answer = changed(await restore(s.branch, lesson.id, t.vicePrincipal));
      expect(answer.lesson).toMatchObject({
        cancelCause: null,
        cancelReason: null,
        canCancel: true,
      });
      expect(await rowOf(lesson.id)).toMatchObject({
        cancel_cause: null,
        cancel_reason: null,
        teacher_id: s.teacher.staffId,
      });
      expect((await claimsOf(lesson.id)).length).toBeGreaterThan(0);
      const notices = (await noticesOf(s.teacher.accountId)).filter(
        (one) => (one.data as { weekStart: string }).weekStart === '2026-12-14',
      );
      expect(notices).toHaveLength(2);
      expect(notices[1]).toMatchObject({
        data: {
          before: [{ cancelled: true, changed: true }],
          after: [{ cancelled: false, changed: true }],
        },
      });
      const [entry] = await t.entries('lesson.restore', lesson.id);
      expect(entry).toMatchObject({
        assignment_id: t.viceAssignment,
        old_value: { cancelCause: 'reason', reason: 'Excursion to the museum' },
        new_value: { cancelCause: null, teacherId: s.teacher.staffId, notices: { notified: 1 } },
      });
    });

    it('refuses a lesson cancelled by an exam, by a day off or not at all (decision 5)', async () => {
      const s = northScene;
      const held = await lessonOf(s, '2026-12-21');
      refusedWith(await restore(s.branch, held.id), 409, 'lesson_not_restorable');
      for (const cause of ['exam', 'day_off'] as const) {
        const lesson = await lessonOf(s, cause === 'exam' ? '2027-01-11' : '2027-01-18');
        await t.database.migrator
          .updateTable('lessons')
          .set({ cancel_cause: cause })
          .where('id', '=', lesson.id)
          .execute();
        const before = await everything();
        refusedWith(await restore(s.branch, lesson.id), 409, 'lesson_not_restorable');
        expect(await everything()).toEqual(before);
      }
    });

    it('is refused when the room went to another lesson, with the free rooms offered (edge/timetable)', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const other = await lessonOf(s, NEXT_MONDAY, s.otherClass);
      changed(await cancel(s.branch, lesson.id));
      // The other class's lesson takes the room meanwhile.
      await t.database.migrator
        .updateTable('lessons')
        .set({ room_id: s.room })
        .where('id', '=', other.id)
        .execute();
      // A closed room is never offered.
      const closed = await load.classes.room(s.branch, 'closed');
      // Nor a room of another branch.
      const elsewhere = await load.classes.room(t.south);
      const before = await everything();
      const blocked = blockedBy(await restore(s.branch, lesson.id));
      expect(blocked.rules).toContain('room_double');
      expect(blocked.rooms).toContain(s.otherRoom);
      expect(blocked.rooms).toContain(s.spareRoom);
      expect(blocked.rooms).not.toContain(s.room);
      expect(blocked.rooms).not.toContain(closed);
      expect(blocked.rooms).not.toContain(elsewhere);
      expect(await everything()).toEqual(before);
      // Once the room is free again, the restore goes ahead.
      await t.database.migrator
        .updateTable('lessons')
        .set({ room_id: s.otherRoom })
        .where('id', '=', other.id)
        .execute();
      changed(await restore(s.branch, lesson.id));
    });

    it('is refused outside the teacher’s hours on its date, and when the teacher left after the cancel (every rule again)', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      changed(await cancel(s.branch, lesson.id));
      // From 19 October the teacher works from 09:00 only.
      await t.database.migrator
        .updateTable('staff_availability')
        .set({ valid_until: NEXT_MONDAY })
        .where('staff_id', '=', s.teacher.staffId)
        .where('branch_id', '=', s.branch)
        .execute();
      await t.database.migrator
        .updateTable('staff_availability_ranges')
        .set({ valid_until: NEXT_MONDAY })
        .where('staff_id', '=', s.teacher.staffId)
        .where('branch_id', '=', s.branch)
        .execute();
      await hours(s.branch, s.teacher.staffId, NEXT_MONDAY, 540);
      expect(blockedBy(await restore(s.branch, lesson.id)).rules).toContain('teacher_unavailable');

      const second = await scene();
      const gone = await lessonOf(second, NEXT_MONDAY);
      changed(await cancel(second.branch, gone.id));
      await t.database.migrator
        .updateTable('staff_statuses')
        .set({ valid_until: '2026-10-15' })
        .where('staff_id', '=', second.teacher.staffId)
        .where('valid_until', 'is', null)
        .execute();
      await t.database.migrator
        .insertInto('staff_statuses')
        .values({ staff_id: second.teacher.staffId, status: 'left', valid_from: '2026-10-15' })
        .execute();
      expect(blockedBy(await restore(second.branch, gone.id)).rules).toContain('teacher_inactive');
    });

    it('gives two restores of one room at one time the room once, in either order', async () => {
      for (const order of [0, 1]) {
        const s = await scene();
        const a = await lessonOf(s, NEXT_MONDAY);
        const b = await lessonOf(s, NEXT_MONDAY, s.otherClass);
        changed(await cancel(s.branch, a.id));
        // B takes A's room, then is cancelled too.
        await t.database.migrator
          .updateTable('lessons')
          .set({ room_id: s.room })
          .where('id', '=', b.id)
          .execute();
        changed(await cancel(s.branch, b.id));
        const [first, second] = order === 0 ? [a, b] : [b, a];
        changed(await restore(s.branch, first.id));
        expect(blockedBy(await restore(s.branch, second.id)).rules).toContain('room_double');
      }
    });

    it('maps the claims and the commit checks of 0058 to restore_blocked (spec review must-fix 4)', () => {
      for (const name of [
        'time_claims_teacher_excl',
        'time_claims_room_excl',
        'time_claims_class_excl',
        'room_shared_full',
        'room_shared_capacity',
        'lesson_block_student_twice',
      ]) {
        expect(DAY_REFUSALS[name], name).toBe('restore_blocked');
      }
    });

    it('is refused when another branch’s lesson of the teacher is committed between the check and the write (23P01)', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      changed(await cancel(s.branch, lesson.id));
      // The teacher also works in another branch, where a lesson at the same
      // time is written and held open while the restore runs.
      const away = await scene();
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: s.teacher.staffId, branch_id: away.branch, is_main: false })
        .execute();
      const awayLesson = await lessonOf(away, NEXT_MONDAY);
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
        .run([away.branch], async (transaction: Transaction) => {
          await transaction
            .updateTable('lessons')
            .set({ teacher_id: s.teacher.staffId })
            .where('id', '=', awayLesson.id)
            .execute();
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await isReady;
      const restored = restore(s.branch, lesson.id).then((response) => response);
      await expect
        .poll(
          async () =>
            (
              await sql<{ n: number }>`
                select count(distinct l.pid)::int as n
                from pg_locks l join pg_stat_activity a on a.pid = l.pid
                where a.datname = current_database() and not l.granted
              `.execute(t.database.migrator)
            ).rows[0]?.n ?? 0,
          { timeout: 20_000, interval: 25 },
        )
        .toBe(1);
      release();
      expect(await held).toBeUndefined();
      refusedWith(await restored, 409, 'restore_blocked');
      expect(await rowOf(lesson.id)).toMatchObject({ cancel_cause: 'reason' });
    });

    it('is refused when the teacher has a lesson in another branch at that time (busy elsewhere, real clock time)', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      changed(await cancel(s.branch, lesson.id));
      const away = await scene();
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: s.teacher.staffId, branch_id: away.branch, is_main: false })
        .execute();
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: s.teacher.staffId })
        .where('id', '=', (await lessonOf(away, NEXT_MONDAY)).id)
        .execute();
      expect(blockedBy(await restore(s.branch, lesson.id)).rules).toContain('teacher_double');
    });

    it('is refused when the day’s template no longer holds the lesson’s time', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      changed(await cancel(s.branch, lesson.id));
      // From 19 October Mondays start at 09:00.
      const slot = await t.createSlotType(s.branch, 'Late lesson', 'lesson', 45);
      const late = await t.createTemplate(s.branch, 'Late', [slot, slot, slot], '09:00');
      await t.assign(s.branch, late, { level: 'weekday', weekday: 1 }, NEXT_MONDAY);
      const blocked = blockedBy(await restore(s.branch, lesson.id));
      expect(blocked.rules.length).toBeGreaterThan(0);
      expect(await rowOf(lesson.id)).toMatchObject({ cancel_cause: 'reason' });
    });

    it('gives a restored Tutor lesson the Tutor in force at its start and notifies both Tutors once (review correction 1)', async () => {
      const s = await scene({ tutor: true });
      const first = s.tutor;
      if (first === null || s.tutorSubject === null || s.tutorRowId === null) {
        throw new Error('The scene has no Tutor row.');
      }
      const lesson = await lessonOf(s, '2026-10-20', s.classId, s.tutorSubject);
      expect(lesson.teacher_id).toBe(first.staffId);
      changed(await cancel(s.branch, lesson.id));
      // The class's Tutor changes from 19 October; the cancelled lesson keeps its teacher.
      const ended = await t.post(`/api/classes/${s.classId}/tutors/${s.tutorRowId}/end`, s.branch, {
        from: NEXT_MONDAY,
      });
      expect(ended.status, JSON.stringify(ended.body)).toBe(200);
      const second = await load.teacher(s.branch);
      await hours(s.branch, second.staffId);
      const role = await load.classes.role(second.accountId, s.branch, 'tutor');
      const given = await t.post(`/api/classes/${s.classId}/tutors`, s.branch, {
        assignmentId: role,
        kind: 'tutor',
        from: NEXT_MONDAY,
        until: null,
      });
      expect(given.status, JSON.stringify(given.body)).toBe(201);
      expect((await rowOf(lesson.id))?.teacher_id).toBe(first.staffId);
      const firstBefore = (await noticesOf(first.accountId)).length;
      const restored = changed(await restore(s.branch, lesson.id));
      expect(restored.lesson.teacher).toMatchObject({ id: second.staffId });
      expect((await rowOf(lesson.id))?.teacher_id).toBe(second.staffId);
      expect(await noticesOf(first.accountId)).toHaveLength(firstBefore + 1);
      expect(await noticesOf(second.accountId)).toHaveLength(1);
      expect((await noticesOf(second.accountId))[0]).toMatchObject({
        data: {
          weekStart: NEXT_MONDAY,
          before: [],
          after: [{ date: '2026-10-20', changed: true }],
        },
      });
      const [entry] = await t.entries('lesson.restore', lesson.id);
      expect(entry).toMatchObject({
        old_value: { teacherId: first.staffId },
        new_value: { teacherId: second.staffId, notices: { notified: 2 } },
      });
    });
  });

  describe('a one-day change and a publish of the branch at the same moment', () => {
    /** A draft copied from the scene's version with every row moved to Wednesday. */
    async function wednesdayDraft(s: Scene) {
      const created = await t.post('/api/timetable/versions', s.branch, {
        academicYearId: s.year,
        startsOn: MONDAY,
        copyFrom: s.version,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const version = (created.body as { id: string }).id;
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', version)
        .execute();
      const rows = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', version)
        .execute();
      for (const row of rows) await placeAt(s.branch, version, row.id, 3);
      const confirmed = await t.post(
        `/api/timetable/versions/${version}/templates/confirm`,
        s.branch,
      );
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      await load.freeEditLock(version);
      return version;
    }

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

    it('runs a cancel and a publish that removes the lesson one after the other, in either order (decision 6)', async () => {
      for (const order of [0, 1]) {
        const s = await scene();
        const draft = await wednesdayDraft(s);
        const lesson = await lessonOf(s, '2026-10-26');
        const send = () => publish(s.branch, draft, NEXT_MONDAY);
        const take = () => cancel(s.branch, lesson.id);
        const [one, two] = await inOrder(
          s.branch,
          order === 0 ? send : take,
          order === 0 ? take : send,
        );
        const [published, cancelled] = order === 0 ? [one, two] : [two, one];
        expect(published.status, JSON.stringify(published.body)).toBe(200);
        expect(await rowOf(lesson.id)).toBeUndefined();
        if (order === 0) {
          // Published first: the lesson is gone, the cancel finds nothing.
          refusedWith(cancelled, 404, 'not_found');
          expect(await t.entries('lesson.cancel', lesson.id)).toEqual([]);
          continue;
        }
        // Cancelled first: the publish removes the cancelled lesson and lists it.
        changed(cancelled);
        const [entry] = await t.entries('timetable_version.publish', draft);
        const removed = (
          entry?.new_value as {
            datedLessons: { removed: { id: string; cancelCause: string | null }[] };
          }
        ).datedLessons.removed;
        expect(removed.find((one) => one.id === lesson.id)).toMatchObject({
          cancelCause: 'reason',
        });
      }
    });
  });
});
