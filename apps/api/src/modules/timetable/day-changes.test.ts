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
import { MembersKit } from '../../testing/members-kit.js';
import { DAY_REFUSALS, MOVE_REFUSALS } from './day-changes.service.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const changed = (response: Response) => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return dayChangeAnswerSchema.parse(response.body);
};

/** The details of a `restore_blocked` (or of the code given). */
const blockedBy = (response: Response, code = 'restore_blocked') => {
  refusedWith(response, 409, code);
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
  let members: MembersKit;

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

  const restoreInto = (
    branch: string,
    id: string,
    body: { roomId?: string; reason?: string },
    cookie = t.admin,
    key: string = randomUUID(),
  ) => keyed(`/api/timetable/lessons/${id}/restore`, branch, body, cookie, key);

  const roomChange = (
    branch: string,
    id: string,
    roomId: string,
    reason: unknown = 'The room is painted',
    cookie = t.admin,
    key: string = randomUUID(),
  ) => keyed(`/api/timetable/lessons/${id}/room`, branch, { roomId, reason }, cookie, key);

  const move = (
    branch: string,
    id: string,
    target: { date: string; lessonNumber: number; roomId?: string },
    cookie = t.admin,
    key: string = randomUUID(),
    reason = 'Excursion to the museum',
  ) => keyed(`/api/timetable/lessons/${id}/move`, branch, { ...target, reason }, cookie, key);

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
  async function scene(
    input: { branch?: string; tutor?: boolean; twoLessons?: boolean; split?: boolean } = {},
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
      lessons_per_week: input.twoLessons === true ? 2 : 1,
      double_lessons: input.twoLessons === true,
    });
    await placeAt(branch, version, rowId, 1);
    // With `twoLessons`, the first class's maths also in the second lesson of Monday.
    if (input.twoLessons === true) await placeAt(branch, version, rowId, 1, 3);
    const otherRow = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: otherClass,
      subject_id: subject,
      teacher_id: otherTeacher.staffId,
      lessons_per_week: 1,
    });
    await placeAt(branch, version, otherRow, 1);
    // With `split`, the first class split in two groups for English on
    // Wednesday in the first slot, one block of the load (task 5.6a-2).
    let english: string | null = null;
    const splitTeachers: { staffId: string; accountId: string }[] = [];
    if (input.split === true) {
      english = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const rows: string[] = [];
      for (let index = 0; index < 2; index += 1) {
        const group = await load.classes.group(branch, year, english, [classId]);
        const person = await teacherOf(branch, english);
        splitTeachers.push(person);
        rows.push(
          await load.row({
            branch_id: branch,
            version_id: version,
            group_id: group,
            subject_id: english,
            teacher_id: person.staffId,
            lessons_per_week: 1,
          }),
        );
      }
      await placeAt(branch, version, rows[0] ?? '', 3);
    }
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
      english,
      splitTeachers,
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

  /** The two Monday lessons of the first class of a scene with `twoLessons`, by start. */
  const lessonOf2 = async (s: Scene, date: string, index: number) => {
    const both = await t.database.migrator
      .selectFrom('lessons')
      .select('id')
      .where('class_id', '=', s.classId)
      .where('subject_id', '=', s.subject)
      .where('lesson_date', '=', date)
      .orderBy('starts_at')
      .execute();
    const found = both[index];
    if (found === undefined) throw new Error('No such lesson.');
    return found.id;
  };

  /** The records of one-day room changes and moves of a lesson (task 5.6a-2). */
  const dayChangesOf = (id: string) =>
    t.database.migrator
      .selectFrom('lesson_day_changes')
      .selectAll()
      .where('lesson_id', '=', id)
      .orderBy('changed_at')
      .orderBy('id')
      .execute();

  /** An exam of the scene's branch on `date` in the first slot, one room, class and invigilator. */
  async function examOf(
    s: Scene,
    date: string,
    input: { roomId: string; classId: string; staffId: string },
  ) {
    await t.database.migrator.transaction().execute(async (transaction) => {
      const exam = await transaction
        .insertInto('exams')
        .values({
          branch_id: s.branch,
          academic_year_id: s.year,
          exam_date: date,
          starts_at: at(date, '08:00'),
          ends_at: at(date, '08:45'),
          first_slot: 1,
          last_slot: 1,
          title: 'Quarter exam in English',
          subject_id: s.subject,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const room = await transaction
        .insertInto('exam_rooms')
        .values({ branch_id: s.branch, exam_id: exam.id, room_id: input.roomId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('exam_room_classes')
        .values({
          branch_id: s.branch,
          exam_id: exam.id,
          exam_room_id: room.id,
          class_id: input.classId,
        })
        .execute();
      await transaction
        .insertInto('exam_invigilators')
        .values({
          branch_id: s.branch,
          exam_id: exam.id,
          exam_room_id: room.id,
          staff_id: input.staffId,
        })
        .execute();
    });
  }

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
      t.database.migrator.selectFrom('lesson_day_changes').selectAll().orderBy('id').execute(),
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
    members = new MembersKit(t.database.migrator, await load.classes.account());
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
      // Nor a room an exam of the branch holds at that time (spec review must-fix 2).
      const examRoom = await load.classes.room(s.branch);
      const examClass = await load.classes.schoolClass(s.branch, s.year, { grade: 7 });
      const invigilator = await load.teacher(s.branch);
      await t.database.migrator.transaction().execute(async (transaction) => {
        const exam = await transaction
          .insertInto('exams')
          .values({
            branch_id: s.branch,
            academic_year_id: s.year,
            exam_date: NEXT_MONDAY,
            starts_at: at(NEXT_MONDAY, '08:00'),
            ends_at: at(NEXT_MONDAY, '08:45'),
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
            staff_id: invigilator.staffId,
          })
          .execute();
      });
      const before = await everything();
      const blocked = blockedBy(await restore(s.branch, lesson.id));
      expect(blocked.rules).toContain('room_double');
      expect(blocked.rooms).toContain(s.otherRoom);
      expect(blocked.rooms).toContain(s.spareRoom);
      expect(blocked.rooms).not.toContain(s.room);
      expect(blocked.rooms).not.toContain(closed);
      expect(blocked.rooms).not.toContain(elsewhere);
      expect(blocked.rooms).not.toContain(examRoom);
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
      const before = await everything();
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
      // Refused after its write: no notice, mark, job or entry is left (only the held lesson changed).
      const [lessonsBefore, ...restBefore] = before;
      const [lessonsAfter, ...restAfter] = await everything();
      expect(restAfter.filter((_, index) => index !== 1)).toEqual(
        restBefore.filter((_, index) => index !== 1),
      );
      expect(lessonsAfter.filter((one) => one.id !== awayLesson.id)).toEqual(
        lessonsBefore.filter((one) => one.id !== awayLesson.id),
      );
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
      expect(blocked.rules).toEqual(['not_a_slot']);
      // No room helps when the time is the problem.
      expect(blocked.rooms).toEqual([]);
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

  describe('the other lessons of the date', () => {
    it('restores a lesson while another lesson of the date breaks a rule of its own', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      changed(await cancel(s.branch, lesson.id));
      // The other class's teacher left: that lesson breaks a rule, this one does not.
      await t.database.migrator
        .updateTable('staff_statuses')
        .set({ valid_until: '2026-10-15' })
        .where('staff_id', '=', s.otherTeacher.staffId)
        .where('valid_until', 'is', null)
        .execute();
      await t.database.migrator
        .insertInto('staff_statuses')
        .values({ staff_id: s.otherTeacher.staffId, status: 'left', valid_from: '2026-10-15' })
        .execute();
      changed(await restore(s.branch, lesson.id));
    });

    it('notifies no vacancy: a cancel of a vacancy’s lesson marks it and sends nothing', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const vacancy = await load.vacancy(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
      });
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: vacancy })
        .where('id', '=', lesson.id)
        .execute();
      const notices = () =>
        t.database.migrator
          .selectFrom('notifications')
          .select('id')
          .where('kind', '=', 'timetable.day_changed')
          .execute();
      const before = await notices();
      changed(await cancel(s.branch, lesson.id));
      expect(await notices()).toEqual(before);
      expect(await markOf(lesson.id)).not.toBeNull();
      const [entry] = await t.entries('lesson.cancel', lesson.id);
      expect(entry).toMatchObject({ new_value: { notices: { notified: 0, marked: 1 } } });
    });
  });

  // edge/timetable, Structure, "Double lessons": "Two linked lessons in
  // consecutive lesson slots with the same teacher and room. They are moved,
  // cancelled and substituted together." (review of the code, change 1).
  describe('a double lesson', () => {
    /** The two Monday lessons of the first class on `date`, made one double pair by the migrator. */
    async function doubleOf(s: Scene, date: string) {
      const both = await t.database.migrator
        .selectFrom('lessons')
        .select(['id', 'block_id'])
        .where('class_id', '=', s.classId)
        .where('lesson_date', '=', date)
        .orderBy('starts_at')
        .execute();
      expect(both).toHaveLength(2);
      const [first, second] = both;
      if (first === undefined || second === undefined) throw new Error('No double lesson.');
      await t.database.migrator
        .updateTable('lesson_blocks')
        .set({ double_pair_id: randomUUID() })
        .where('id', 'in', [first.block_id, second.block_id])
        .execute();
      return { first: first.id, second: second.id };
    }

    const causeOf = async (id: string) => (await rowOf(id))?.cancel_cause ?? null;

    it('cancels both halves when either is cancelled, with one log entry and one notice to the teacher', async () => {
      const s = await scene({ twoLessons: true });
      for (const [date, named] of [
        [NEXT_MONDAY, 'first'],
        ['2026-10-26', 'second'],
      ] as const) {
        const pair = await doubleOf(s, date);
        const notices = (await noticesOf(s.teacher.accountId)).length;
        const answer = changed(await cancel(s.branch, pair[named], 'Excursion to the museum'));
        expect(answer.lesson).toMatchObject({ id: pair[named], cancelCause: 'reason' });
        for (const id of [pair.first, pair.second]) {
          expect(await rowOf(id)).toMatchObject({
            cancel_cause: 'reason',
            cancel_reason: 'Excursion to the museum',
          });
          expect(await claimsOf(id)).toEqual([]);
          expect(await markOf(id)).not.toBeNull();
        }
        expect(await noticesOf(s.teacher.accountId)).toHaveLength(notices + 1);
        const entries = await t.entries('lesson.cancel', pair[named]);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          new_value: { lessonIds: [pair.first, pair.second], notices: { notified: 1 } },
        });
        // The other half was cancelled by the same change: no entry of its own.
        const other = named === 'first' ? pair.second : pair.first;
        expect(await t.entries('lesson.cancel', other)).toEqual([]);
        refusedWith(await cancel(s.branch, other), 409, 'lesson_cancelled');
      }
    });

    it('restores both halves when either is restored, checked together', async () => {
      const s = await scene({ twoLessons: true });
      for (const [date, named] of [
        [NEXT_MONDAY, 'first'],
        ['2026-10-26', 'second'],
      ] as const) {
        const pair = await doubleOf(s, date);
        changed(await cancel(s.branch, pair.first));
        const notices = (await noticesOf(s.teacher.accountId)).length;
        const answer = changed(await restore(s.branch, pair[named]));
        expect(answer.lesson).toMatchObject({ id: pair[named], cancelCause: null });
        for (const id of [pair.first, pair.second]) {
          expect(await rowOf(id)).toMatchObject({
            cancel_cause: null,
            cancel_reason: null,
            teacher_id: s.teacher.staffId,
          });
          expect((await claimsOf(id)).length).toBeGreaterThan(0);
        }
        expect(await noticesOf(s.teacher.accountId)).toHaveLength(notices + 1);
        const [entry] = await t.entries('lesson.restore', pair[named]);
        expect(entry).toMatchObject({ new_value: { lessonIds: [pair.first, pair.second] } });
      }
    });

    it('refuses the restore as a whole when the other half’s room is taken, and nothing is written', async () => {
      const s = await scene({ twoLessons: true });
      const pair = await doubleOf(s, NEXT_MONDAY);
      changed(await cancel(s.branch, pair.second));
      // The other class's lesson takes the room of the first half meanwhile.
      const other = await lessonOf(s, NEXT_MONDAY, s.otherClass);
      await t.database.migrator
        .updateTable('lessons')
        .set({ room_id: s.room })
        .where('id', '=', other.id)
        .execute();
      const before = await everything();
      const blocked = blockedBy(await restore(s.branch, pair.second));
      expect(blocked.rules).toContain('room_double');
      expect(await everything()).toEqual(before);
      expect(await causeOf(pair.first)).toBe('reason');
      expect(await causeOf(pair.second)).toBe('reason');
    });

    it('refuses a change of either half once the earlier half has started (decision 3)', async () => {
      const s = await scene();
      const earlier = await todayLesson(s, '23:50', '23:54');
      const later = await todayLesson(s, '23:56', '23:59');
      const blocks = await t.database.migrator
        .selectFrom('lessons')
        .select('block_id')
        .where('id', 'in', [earlier, later])
        .execute();
      await t.database.migrator
        .updateTable('lesson_blocks')
        .set({ double_pair_id: randomUUID() })
        .where(
          'id',
          'in',
          blocks.map((one) => one.block_id),
        )
        .execute();
      const before = await everything();
      refusedWith(await cancel(s.branch, later), 409, 'lesson_started');
      expect(await everything()).toEqual(before);
      const shown = dayAnswerSchema
        .parse((await day(s.branch, s.classId, '2026-10-10')).body)
        .lessons.find((one) => one.id === later);
      expect(shown).toMatchObject({ canCancel: false, canRestore: false });
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: 'Rain' })
        .where('id', 'in', [earlier, later])
        .execute();
      refusedWith(await restore(s.branch, later), 409, 'lesson_started');
    });

    it('leaves a half cancelled by an exam as it is: the other half is cancelled and restored alone (decision 4)', async () => {
      const s = await scene({ twoLessons: true });
      const pair = await doubleOf(s, NEXT_MONDAY);
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'exam' })
        .where('id', '=', pair.second)
        .execute();
      refusedWith(await cancel(s.branch, pair.second), 409, 'lesson_cancelled');
      changed(await cancel(s.branch, pair.first));
      expect(await causeOf(pair.first)).toBe('reason');
      expect(await causeOf(pair.second)).toBe('exam');
      refusedWith(await restore(s.branch, pair.second), 409, 'lesson_not_restorable');
      changed(await restore(s.branch, pair.first));
      expect(await causeOf(pair.first)).toBeNull();
      expect(await causeOf(pair.second)).toBe('exam');
    });
  });

  describe('a room change (task 5.6a-2)', () => {
    it('changes the room of one lesson for its date: the claims follow, the record is stored, the lesson is marked, its teacher notified once and the log written', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const answer = changed(
        await roomChange(s.branch, lesson.id, s.spareRoom, '  The room is painted  '),
      );
      expect(answer.lesson).toMatchObject({
        id: lesson.id,
        room: { id: s.spareRoom },
        changed: true,
      });
      expect(await rowOf(lesson.id)).toMatchObject({ room_id: s.spareRoom, cancel_cause: null });
      const claim = await t.database.migrator
        .selectFrom('time_claims')
        .select('room_id')
        .where('lesson_id', '=', lesson.id)
        .where('kind', '=', 'lesson')
        .executeTakeFirstOrThrow();
      expect(claim.room_id).toBe(s.spareRoom);
      expect(await dayChangesOf(lesson.id)).toMatchObject([
        {
          kind: 'room',
          class_id: s.classId,
          subject_id: s.subject,
          load_row_id: s.rowId,
          from_date: NEXT_MONDAY,
          to_date: NEXT_MONDAY,
          from_room_id: s.room,
          to_room_id: s.spareRoom,
          reason: 'The room is painted',
        },
      ]);
      const [record] = await dayChangesOf(lesson.id);
      expect(record?.from_starts_at).toEqual(lesson.starts_at);
      expect(record?.to_starts_at).toEqual(lesson.starts_at);
      expect(record?.changed_at).toEqual(at('2026-10-10', '23:55'));
      expect(await markOf(lesson.id)).not.toBeNull();
      const notices = await noticesOf(s.teacher.accountId);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        branch_id: s.branch,
        data: { weekStart: NEXT_MONDAY, before: [{ changed: true }], after: [{ changed: true }] },
      });
      expect(notices[0]?.data).not.toHaveProperty('also');
      expect(await noticesOf(s.otherTeacher.accountId)).toEqual([]);
      const [entry] = await t.entries('lesson.room_change', lesson.id);
      expect(entry).toMatchObject({
        old_value: { roomId: s.room, lessonIds: [lesson.id] },
        new_value: {
          roomId: s.spareRoom,
          reason: 'The room is painted',
          notices: { notified: 1, marked: 1 },
        },
      });
    });

    it('is refused when the room is taken at that time, with the free rooms offered, and nothing is written', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const before = await everything();
      const response = await roomChange(s.branch, lesson.id, s.otherRoom);
      const blocked = blockedBy(response, 'day_change_blocked');
      expect(blocked.rules).toContain('room_double');
      expect(blocked.rooms).toContain(s.spareRoom);
      expect(blocked.rooms).not.toContain(s.otherRoom);
      expect(blocked.rooms).not.toContain(s.room);
      expect(await everything()).toEqual(before);
      expect(await dayChangesOf(lesson.id)).toEqual([]);
    });

    it('refuses a room that is not in use, takes a shared room with space left and refuses a full one', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const closed = await load.classes.room(s.branch, 'closed');
      expect(
        blockedBy(await roomChange(s.branch, lesson.id, closed), 'day_change_blocked').rules,
      ).toContain('room_inactive');
      // The other class's room becomes a hall for two lessons at once.
      await t.database.migrator
        .updateTable('rooms')
        .set({ shared: true, max_simultaneous_lessons: 2, capacity: 60 })
        .where('id', '=', s.otherRoom)
        .execute();
      changed(await roomChange(s.branch, lesson.id, s.otherRoom));
      // On 26 October an exam also uses the hall beside the other class's lesson: it is full.
      const examClass = await load.classes.schoolClass(s.branch, s.year, { grade: 7 });
      const invigilator = await load.teacher(s.branch);
      await examOf(s, '2026-10-26', {
        roomId: s.otherRoom,
        classId: examClass,
        staffId: invigilator.staffId,
      });
      const next = await lessonOf(s, '2026-10-26');
      expect(
        blockedBy(await roomChange(s.branch, next.id, s.otherRoom), 'day_change_blocked').rules,
      ).toContain('room_shared_full');
    });

    it('takes a room smaller than the class and returns the capacity warning', async () => {
      const s = await scene();
      for (let index = 0; index < 2; index += 1) {
        const student = await members.student(s.branch, { startsOn: '2026-09-01' });
        await members.member({
          branch: s.branch,
          classId: s.classId,
          studentId: student,
          from: '2026-09-01',
        });
      }
      await t.database.migrator
        .updateTable('rooms')
        .set({ capacity: 1 })
        .where('id', '=', s.spareRoom)
        .execute();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const answer = changed(await roomChange(s.branch, lesson.id, s.spareRoom));
      expect(answer.warnings.map((one) => one.rule)).toContain('room_capacity');
    });

    it('is refused when an exam holds the room at that time', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const examClass = await load.classes.schoolClass(s.branch, s.year, { grade: 7 });
      const invigilator = await load.teacher(s.branch);
      await examOf(s, NEXT_MONDAY, {
        roomId: s.spareRoom,
        classId: examClass,
        staffId: invigilator.staffId,
      });
      expect(
        blockedBy(await roomChange(s.branch, lesson.id, s.spareRoom), 'day_change_blocked').rules,
      ).toContain('room_double');
    });

    it('refuses the same room, a cancelled lesson and one that started; a room of another branch or unknown is 404 and nothing changes', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      refusedWith(await roomChange(s.branch, lesson.id, s.room), 409, 'room_unchanged');
      const elsewhere = await load.classes.room(t.south);
      const before = await everything();
      for (const cookie of [t.admin]) {
        refusedWith(
          await roomChange(s.branch, lesson.id, elsewhere, 'Painted', cookie),
          404,
          'not_found',
        );
        refusedWith(
          await roomChange(s.branch, lesson.id, UNKNOWN, 'Painted', cookie),
          404,
          'not_found',
        );
      }
      expect(await everything()).toEqual(before);
      const started = await todayLesson(s, '23:50', '23:55');
      refusedWith(await roomChange(s.branch, started, s.spareRoom), 409, 'lesson_started');
      changed(await cancel(s.branch, lesson.id));
      refusedWith(await roomChange(s.branch, lesson.id, s.spareRoom), 409, 'lesson_cancelled');
    });

    it('refuses a reason missing, of spaces only or of 501 characters as an input error', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, '2027-02-01');
      for (const reason of [null, '   ', 'x'.repeat(501)]) {
        refusedWith(
          await roomChange(s.branch, lesson.id, s.spareRoom, reason),
          400,
          'validation_failed',
        );
      }
    });

    it('answers 404 for a lesson or a room of another branch and an unknown one, as the Academic Vice Principal and the Super Admin, and refuses the Principal', async () => {
      const s = northScene;
      const other = await scene();
      const otherLesson = await lessonOf(other, NEXT_MONDAY);
      const lesson = await lessonOf(s, '2027-02-08');
      const elsewhere = await load.classes.room(other.branch);
      const before = await everything();
      for (const cookie of [t.vicePrincipal, t.admin]) {
        refusedWith(
          await roomChange(s.branch, otherLesson.id, s.spareRoom, 'Painted', cookie),
          404,
          'not_found',
        );
        refusedWith(
          await roomChange(s.branch, UNKNOWN, s.spareRoom, 'Painted', cookie),
          404,
          'not_found',
        );
        refusedWith(
          await move(s.branch, otherLesson.id, { date: NEXT_MONDAY, lessonNumber: 2 }, cookie),
          404,
          'not_found',
        );
        refusedWith(
          await move(s.branch, UNKNOWN, { date: NEXT_MONDAY, lessonNumber: 2 }, cookie),
          404,
          'not_found',
        );
        for (const roomId of [elsewhere, UNKNOWN]) {
          refusedWith(
            await roomChange(s.branch, lesson.id, roomId, 'Painted', cookie),
            404,
            'not_found',
          );
          refusedWith(
            await move(
              s.branch,
              lesson.id,
              { date: '2027-02-08', lessonNumber: 2, roomId },
              cookie,
            ),
            404,
            'not_found',
          );
        }
      }
      refusedWith(
        await roomChange(s.branch, lesson.id, s.spareRoom, 'Painted', t.principal),
        403,
        'permission_denied',
      );
      refusedWith(
        await move(s.branch, lesson.id, { date: NEXT_MONDAY, lessonNumber: 2 }, t.principal),
        403,
        'permission_denied',
      );
      expect(await everything()).toEqual(before);
      expect(
        await t.database.migrator
          .selectFrom('lesson_day_changes')
          .select('id')
          .where('branch_id', 'in', [s.branch, other.branch])
          .execute(),
      ).toEqual([]);
    });

    it('keeps a used key to its account, its branch and its role (request keys)', async () => {
      const s = northScene;
      const other = await scene();
      const lesson = await lessonOf(s, '2027-02-15');
      const key = randomUUID();
      changed(await roomChange(s.branch, lesson.id, s.spareRoom, 'Painted', t.admin, key));
      // The repeat answers the stored change and writes nothing more.
      changed(await roomChange(s.branch, lesson.id, s.spareRoom, 'Painted', t.admin, key));
      expect(await dayChangesOf(lesson.id)).toHaveLength(1);
      refusedWith(
        await roomChange(s.branch, lesson.id, s.spareRoom, 'Painted', t.vicePrincipal, key),
        409,
        'request_key_reused',
      );
      refusedWith(
        await roomChange(
          s.branch,
          (await lessonOf(other, NEXT_MONDAY)).id,
          s.spareRoom,
          'Painted',
          t.admin,
          key,
        ),
        404,
        'not_found',
      );
      refusedWith(
        await roomChange(s.branch, UNKNOWN, s.spareRoom, 'Painted', t.admin, key),
        404,
        'not_found',
      );
      refusedWith(
        await roomChange(s.branch, lesson.id, s.spareRoom, 'Painted', t.principal, key),
        403,
        'permission_denied',
      );
      const moveKey = randomUUID();
      changed(
        await move(s.branch, lesson.id, { date: '2027-02-15', lessonNumber: 2 }, t.admin, moveKey),
      );
      refusedWith(
        await move(
          s.branch,
          lesson.id,
          { date: '2027-02-15', lessonNumber: 2 },
          t.vicePrincipal,
          moveKey,
        ),
        409,
        'request_key_reused',
      );
      refusedWith(
        await move(s.branch, UNKNOWN, { date: '2027-02-15', lessonNumber: 2 }, t.admin, moveKey),
        404,
        'not_found',
      );
      refusedWith(
        await move(
          s.branch,
          lesson.id,
          { date: '2027-02-15', lessonNumber: 2 },
          t.principal,
          moveKey,
        ),
        403,
        'permission_denied',
      );
    });

    it('maps the claims and the commit checks of 0058 to day_change_blocked, and a quarter to move_other_quarter', () => {
      for (const name of [
        'time_claims_teacher_excl',
        'time_claims_room_excl',
        'time_claims_class_excl',
        'room_shared_full',
        'room_shared_capacity',
        'lesson_block_student_twice',
      ]) {
        expect(MOVE_REFUSALS[name]).toBe('day_change_blocked');
      }
      expect(MOVE_REFUSALS.lesson_block_quarter).toBe('move_other_quarter');
      expect(MOVE_REFUSALS.lesson_block_quarter_fixed).toBe('move_other_quarter');
    });
  });

  describe('a move (task 5.6a-2)', () => {
    it('moves a lesson to another slot of its day: the block and the claims follow, the record is stored and its teacher notified once', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const answer = changed(
        await move(s.branch, lesson.id, { date: NEXT_MONDAY, lessonNumber: 3 }),
      );
      expect(answer.lesson).toMatchObject({ id: lesson.id, start: 590, end: 635, changed: true });
      const row = await rowOf(lesson.id);
      expect(row?.starts_at).toEqual(at(NEXT_MONDAY, '09:50'));
      expect(row?.ends_at).toEqual(at(NEXT_MONDAY, '10:35'));
      const block = await t.database.migrator
        .selectFrom('lesson_blocks')
        .select(['starts_at'])
        .where('id', '=', lesson.block_id)
        .executeTakeFirstOrThrow();
      expect(block.starts_at).toEqual(at(NEXT_MONDAY, '09:50'));
      const claim = await t.database.migrator
        .selectFrom('time_claims')
        .select('during')
        .where('lesson_id', '=', lesson.id)
        .where('kind', '=', 'lesson')
        .executeTakeFirstOrThrow();
      // 10:35 in Tashkent.
      expect(String(claim.during)).toContain('2026-10-19 05:35:00+00');
      expect(await dayChangesOf(lesson.id)).toMatchObject([
        {
          kind: 'move',
          from_date: NEXT_MONDAY,
          to_date: NEXT_MONDAY,
          from_room_id: s.room,
          to_room_id: s.room,
          reason: 'Excursion to the museum',
        },
      ]);
      const [record] = await dayChangesOf(lesson.id);
      expect(record?.from_starts_at).toEqual(at(NEXT_MONDAY, '08:00'));
      expect(record?.to_starts_at).toEqual(at(NEXT_MONDAY, '09:50'));
      expect(await noticesOf(s.teacher.accountId)).toHaveLength(1);
      const [entry] = await t.entries('lesson.move', lesson.id);
      expect(entry).toMatchObject({
        old_value: { startsAt: at(NEXT_MONDAY, '08:00').toISOString() },
        new_value: {
          startsAt: at(NEXT_MONDAY, '09:50').toISOString(),
          lessonNumber: 3,
          notices: { notified: 1 },
        },
      });
    });

    it('moves a lesson to another day of the week, with a room of its own', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const answer = changed(
        await move(s.branch, lesson.id, {
          date: '2026-10-21',
          lessonNumber: 2,
          roomId: s.spareRoom,
        }),
      );
      expect(answer.lesson).toMatchObject({
        date: '2026-10-21',
        start: 535,
        room: { id: s.spareRoom },
      });
      expect(await rowOf(lesson.id)).toMatchObject({
        lesson_date: '2026-10-21',
        room_id: s.spareRoom,
      });
      const day19 = dayAnswerSchema.parse((await day(s.branch, s.classId, NEXT_MONDAY)).body);
      expect(day19.lessons.map((one) => one.id)).not.toContain(lesson.id);
      const day21 = dayAnswerSchema.parse((await day(s.branch, s.classId, '2026-10-21')).body);
      expect(day21.lessons.map((one) => one.id)).toEqual([lesson.id]);
      expect(day21.slots).toEqual([
        { lessonNumber: 1, start: 480, end: 525 },
        { lessonNumber: 2, start: 535, end: 580 },
        { lessonNumber: 3, start: 590, end: 635 },
      ]);
      const notices = await noticesOf(s.teacher.accountId);
      expect(notices).toHaveLength(1);
      expect(notices[0]?.data).not.toHaveProperty('also');
    });

    it('moves a lesson into another week with one notice to its teacher holding both weeks (decision 11)', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      changed(await move(s.branch, lesson.id, { date: '2026-10-27', lessonNumber: 2 }));
      const notices = await noticesOf(s.teacher.accountId);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        data: {
          weekStart: NEXT_MONDAY,
          before: [{ date: NEXT_MONDAY, changed: true }],
          after: [],
          also: {
            weekStart: '2026-10-26',
            before: [{ date: '2026-10-26', changed: false }],
            after: [
              { date: '2026-10-26', changed: false },
              { date: '2026-10-27', changed: true },
            ],
          },
        },
      });
    });

    it('is refused when the teacher, the class or the room is taken at the new time, with the free rooms offered for the room', async () => {
      const s = await scene({ twoLessons: true });
      // The first class has maths in lesson 2 of Monday too (its own second lesson).
      const lesson = await lessonOf2(s, NEXT_MONDAY, 0);
      // Lesson 2 belongs to the class and the teacher already.
      const taken = blockedBy(
        await move(s.branch, lesson, { date: NEXT_MONDAY, lessonNumber: 2 }),
        'day_change_blocked',
      );
      expect(taken.rules).toEqual(expect.arrayContaining(['teacher_double', 'class_double']));
      expect(taken.rooms).toEqual([]);
      // The other class's teacher on Wednesday lesson 1 in a room of its own: only the room clashes.
      const other = await lessonOf(s, NEXT_MONDAY, s.otherClass);
      changed(
        await move(s.branch, other.id, { date: '2026-10-21', lessonNumber: 1, roomId: s.room }),
      );
      const roomTaken = blockedBy(
        await move(s.branch, lesson, { date: '2026-10-21', lessonNumber: 1 }),
        'day_change_blocked',
      );
      expect(roomTaken.rules).toEqual(['room_double']);
      expect(roomTaken.rooms).toEqual(expect.arrayContaining([s.otherRoom, s.spareRoom]));
      expect(roomTaken.rooms).not.toContain(s.room);
    });

    it('is refused when the class sits an exam, or the teacher invigilates one, at the new time', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const examRoom = await load.classes.room(s.branch);
      const invigilator = await load.teacher(s.branch);
      await examOf(s, '2026-10-21', {
        roomId: examRoom,
        classId: s.classId,
        staffId: invigilator.staffId,
      });
      expect(
        blockedBy(
          await move(s.branch, lesson.id, { date: '2026-10-21', lessonNumber: 1 }),
          'day_change_blocked',
        ).rules,
      ).toContain('class_double');
      const otherRoom = await load.classes.room(s.branch);
      const otherClass = await load.classes.schoolClass(s.branch, s.year, { grade: 7 });
      await examOf(s, '2026-10-22', {
        roomId: otherRoom,
        classId: otherClass,
        staffId: s.teacher.staffId,
      });
      expect(
        blockedBy(
          await move(s.branch, lesson.id, { date: '2026-10-22', lessonNumber: 1 }),
          'day_change_blocked',
        ).rules,
      ).toContain('teacher_double');
    });

    it('is refused when the teacher has a lesson in another branch at that real clock time, or within the travel time', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const away = await scene({ tutor: true });
      if (away.tutorSubject === null) throw new Error('The scene has no Tutor row.');
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: s.teacher.staffId, branch_id: away.branch, is_main: false })
        .execute();
      // The away branch's Tutor lesson of Tuesday 20 October at 08:00 goes to the teacher.
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: s.teacher.staffId })
        .where('id', '=', (await lessonOf(away, '2026-10-20', away.classId, away.tutorSubject)).id)
        .execute();
      expect(
        blockedBy(
          await move(s.branch, lesson.id, { date: '2026-10-20', lessonNumber: 1 }),
          'day_change_blocked',
        ).rules,
      ).toContain('teacher_double');
      // Lesson 2 starts ten minutes after it ends; the travel time is 30.
      const [a, b] = [s.branch, away.branch].sort();
      await t.database.migrator
        .insertInto('travel_times')
        .values({ branch_low: a ?? '', branch_high: b ?? '', minutes: 30 })
        .execute();
      expect(
        blockedBy(
          await move(s.branch, lesson.id, { date: '2026-10-20', lessonNumber: 2 }),
          'day_change_blocked',
        ).rules,
      ).toContain('travel_time');
    });

    it('is refused outside the teacher’s hours on the new date (blocked, not a tick: decision 7)', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      // From 26 October the teacher comes at 09:00.
      await t.database.migrator
        .updateTable('staff_availability')
        .set({ valid_until: '2026-10-26' })
        .where('staff_id', '=', s.teacher.staffId)
        .execute();
      await t.database.migrator
        .updateTable('staff_availability_ranges')
        .set({ valid_until: '2026-10-26' })
        .where('staff_id', '=', s.teacher.staffId)
        .execute();
      await hours(s.branch, s.teacher.staffId, '2026-10-26', 540);
      const blocked = blockedBy(
        await move(s.branch, lesson.id, { date: '2026-10-27', lessonNumber: 1 }),
        'day_change_blocked',
      );
      expect(blocked.rules).toContain('teacher_unavailable');
      changed(await move(s.branch, lesson.id, { date: '2026-10-27', lessonNumber: 3 }));
    });

    it('refuses a day off, a vacation date and a date after the year by the rule check, a school day of the next quarter as move_other_quarter', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      await t.database.migrator
        .insertInto('calendar_entries')
        .values({
          branch_id: s.branch,
          kind: 'day_off',
          name: 'Holiday',
          first_date: '2026-10-21',
          last_date: '2026-10-21',
        })
        .execute();
      const before = await everything();
      expect(
        blockedBy(
          await move(s.branch, lesson.id, { date: '2026-10-21', lessonNumber: 1 }),
          'day_change_blocked',
        ).rules,
      ).toContain('day_off');
      expect(
        blockedBy(
          await move(s.branch, lesson.id, { date: '2026-11-02', lessonNumber: 1 }),
          'day_change_blocked',
        ).rules,
      ).toContain('vacation');
      expect(
        blockedBy(
          await move(s.branch, lesson.id, { date: '2027-06-07', lessonNumber: 1 }),
          'day_change_blocked',
        ).rules,
      ).toContain('outside_year');
      refusedWith(
        await move(s.branch, lesson.id, { date: '2026-11-09', lessonNumber: 1 }),
        409,
        'move_other_quarter',
      );
      expect(await everything()).toEqual(before);
    });

    it('refuses a date under another published version (decision 1), a lesson number the date lacks, a target that started and the same place', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      refusedWith(
        await move(s.branch, lesson.id, { date: NEXT_MONDAY, lessonNumber: 4 }),
        409,
        'move_no_slot',
      );
      refusedWith(
        await move(s.branch, lesson.id, { date: NEXT_MONDAY, lessonNumber: 1 }),
        409,
        'move_unchanged',
      );
      refusedWith(
        await move(s.branch, lesson.id, { date: '2026-10-09', lessonNumber: 1 }),
        409,
        'move_target_started',
      );
      const started = await todayLesson(s, '23:50', '23:55');
      refusedWith(
        await move(s.branch, started, { date: NEXT_MONDAY, lessonNumber: 2 }),
        409,
        'lesson_started',
      );
      // A version from 26 October.
      const created = await t.post('/api/timetable/versions', s.branch, {
        academicYearId: s.year,
        startsOn: '2026-10-26',
        copyFrom: s.version,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const later = (created.body as { id: string }).id;
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', later)
        .execute();
      const laterRows = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', later)
        .execute();
      for (const row of laterRows) await placeAt(s.branch, later, row.id, 1);
      expect(
        (await t.post(`/api/timetable/versions/${later}/templates/confirm`, s.branch)).status,
      ).toBe(200);
      await load.freeEditLock(later);
      const published = await publish(s.branch, later, '2026-10-26');
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      refusedWith(
        await move(s.branch, lesson.id, { date: '2026-10-27', lessonNumber: 2 }),
        409,
        'move_other_version',
      );
      changed(await move(s.branch, lesson.id, { date: '2026-10-23', lessonNumber: 2 }));
    });

    it('gives a moved Tutor lesson the Tutor in force at its new start', async () => {
      const s = await scene({ tutor: true });
      const first = s.tutor;
      if (first === null || s.tutorSubject === null || s.tutorRowId === null) {
        throw new Error('The scene has no Tutor row.');
      }
      const lesson = await lessonOf(s, '2026-10-20', s.classId, s.tutorSubject);
      // A new Tutor from 22 October.
      const ended = await t.post(`/api/classes/${s.classId}/tutors/${s.tutorRowId}/end`, s.branch, {
        from: '2026-10-22',
      });
      expect(ended.status, JSON.stringify(ended.body)).toBe(200);
      const second = await load.teacher(s.branch);
      await hours(s.branch, second.staffId);
      const role = await load.classes.role(second.accountId, s.branch, 'tutor');
      const given = await t.post(`/api/classes/${s.classId}/tutors`, s.branch, {
        assignmentId: role,
        kind: 'tutor',
        from: '2026-10-22',
        until: null,
      });
      expect(given.status, JSON.stringify(given.body)).toBe(201);
      expect((await rowOf(lesson.id))?.teacher_id).toBe(first.staffId);
      const answer = changed(
        await move(s.branch, lesson.id, { date: '2026-10-22', lessonNumber: 2 }),
      );
      expect(answer.lesson.teacher).toMatchObject({ id: second.staffId });
      expect((await rowOf(lesson.id))?.teacher_id).toBe(second.staffId);
    });

    it('keeps a one-day change’s room and time when the Tutor changes later, and gives the lesson the new Tutor (decision 2)', async () => {
      const s = await scene({ tutor: true });
      const first = s.tutor;
      if (first === null || s.tutorSubject === null || s.tutorRowId === null) {
        throw new Error('The scene has no Tutor row.');
      }
      const moved = await lessonOf(s, '2026-10-27', s.classId, s.tutorSubject);
      changed(
        await move(s.branch, moved.id, {
          date: '2026-10-28',
          lessonNumber: 3,
          roomId: s.spareRoom,
        }),
      );
      const other = await lessonOf(s, '2026-10-20', s.classId, s.tutorSubject);
      changed(await roomChange(s.branch, other.id, s.spareRoom));
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
      expect(await rowOf(moved.id)).toMatchObject({
        teacher_id: second.staffId,
        lesson_date: '2026-10-28',
        room_id: s.spareRoom,
      });
      expect((await rowOf(moved.id))?.starts_at).toEqual(at('2026-10-28', '09:50'));
      expect(await rowOf(other.id)).toMatchObject({
        teacher_id: second.staffId,
        room_id: s.spareRoom,
      });
    });

    it('is refused when the follow of a Tutor change gives the teacher a lesson at the new time between the check and the write (the claims constraint)', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      // The teacher is also a Tutor in another branch, whose Tutor lesson of
      // 20 October at 08:00 the follow of an appointment gives to the teacher
      // (`followTutors` writes the lesson's teacher, under no publish lock).
      const away = await scene({ tutor: true });
      if (away.tutorSubject === null) throw new Error('The scene has no Tutor row.');
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: s.teacher.staffId, branch_id: away.branch, is_main: false })
        .execute();
      const tutorLesson = await lessonOf(away, '2026-10-20', away.classId, away.tutorSubject);
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
            .where('id', '=', tutorLesson.id)
            .execute();
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await isReady;
      const moved = move(s.branch, lesson.id, { date: '2026-10-20', lessonNumber: 1 }).then(
        (response) => response,
      );
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
      refusedWith(await moved, 409, 'day_change_blocked');
      expect(await rowOf(lesson.id)).toMatchObject({ lesson_date: NEXT_MONDAY });
      expect(await dayChangesOf(lesson.id)).toEqual([]);
      expect(await t.entries('lesson.move', lesson.id)).toEqual([]);
    });
  });

  describe('a block of two parts (task 5.6a-2, decision 4)', () => {
    /** The two group lessons of the scene's split on `date`, by id. */
    async function partsOf(s: Scene, date: string) {
      const parts = await t.database.migrator
        .selectFrom('lessons')
        .select(['id', 'block_id'])
        .where('branch_id', '=', s.branch)
        .where('subject_id', '=', s.english ?? '')
        .where('lesson_date', '=', date)
        .orderBy('id')
        .execute();
      const [lesson, part] = parts;
      if (lesson === undefined || part === undefined) throw new Error('No split.');
      expect(lesson.block_id).toBe(part.block_id);
      return { lesson: lesson.id, part: part.id };
    }

    it('moves the block whole, each part in its own room; a room for both is refused', async () => {
      const s = await scene({ split: true });
      const { lesson, part } = await partsOf(s, '2026-10-21');
      refusedWith(
        await move(s.branch, lesson, { date: '2026-10-21', lessonNumber: 2, roomId: s.spareRoom }),
        409,
        'move_room_parts',
      );
      changed(await move(s.branch, lesson, { date: '2026-10-21', lessonNumber: 2 }));
      for (const id of [lesson, part]) {
        const row = await rowOf(id);
        expect(row?.starts_at).toEqual(at('2026-10-21', '08:55'));
        expect(row?.room_id).toBeNull();
      }
      expect(await dayChangesOf(part)).toMatchObject([{ kind: 'move', to_date: '2026-10-21' }]);
      for (const teacher of s.splitTeachers) {
        expect(await noticesOf(teacher.accountId)).toHaveLength(1);
      }
    });

    it('moves a part cancelled with a reason with its block, still cancelled, and keeps a block whose part an exam cancelled where it is (review correction 1)', async () => {
      const s = await scene({ split: true });
      const first = await partsOf(s, '2026-10-21');
      changed(await cancel(s.branch, first.part));
      changed(await move(s.branch, first.lesson, { date: '2026-10-21', lessonNumber: 3 }));
      const part = await rowOf(first.part);
      expect(part?.starts_at).toEqual(at('2026-10-21', '09:50'));
      expect(part?.cancel_cause).toBe('reason');
      const second = await partsOf(s, '2026-10-28');
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'exam' })
        .where('id', '=', second.part)
        .execute();
      const before = await everything();
      refusedWith(
        await move(s.branch, second.lesson, { date: '2026-10-28', lessonNumber: 2 }),
        409,
        'lesson_cancelled',
      );
      expect(await everything()).toEqual(before);
    });
  });

  describe('a restore into an offered room (task 5.6a-2, decision 10)', () => {
    it('restores a refused lesson into a room it offered, with a reason: one record of the room and one notice', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      const other = await lessonOf(s, NEXT_MONDAY, s.otherClass);
      changed(await cancel(s.branch, lesson.id));
      await t.database.migrator
        .updateTable('lessons')
        .set({ room_id: s.room })
        .where('id', '=', other.id)
        .execute();
      const offered = blockedBy(await restore(s.branch, lesson.id)).rooms;
      expect(offered).toContain(s.spareRoom);
      const before = (await noticesOf(s.teacher.accountId)).length;
      refusedWith(
        await restoreInto(s.branch, lesson.id, { roomId: s.room, reason: 'Back in the hall' }),
        409,
        'restore_blocked',
      );
      const answer = changed(
        await restoreInto(s.branch, lesson.id, { roomId: s.spareRoom, reason: 'Back in the hall' }),
      );
      expect(answer.lesson).toMatchObject({ cancelCause: null, room: { id: s.spareRoom } });
      expect(await rowOf(lesson.id)).toMatchObject({ cancel_cause: null, room_id: s.spareRoom });
      expect(await dayChangesOf(lesson.id)).toMatchObject([
        { kind: 'room', from_room_id: s.room, to_room_id: s.spareRoom, reason: 'Back in the hall' },
      ]);
      expect(await noticesOf(s.teacher.accountId)).toHaveLength(before + 1);
      const [entry] = await t.entries('lesson.restore', lesson.id);
      expect(entry).toMatchObject({
        new_value: { roomId: s.spareRoom, roomReason: 'Back in the hall' },
      });
    });

    it('takes a room and a reason together, and answers 404 for a room of another branch or unknown', async () => {
      const s = northScene;
      const lesson = await lessonOf(s, '2027-02-22');
      changed(await cancel(s.branch, lesson.id));
      refusedWith(
        await restoreInto(s.branch, lesson.id, { roomId: s.spareRoom }),
        400,
        'validation_failed',
      );
      refusedWith(
        await restoreInto(s.branch, lesson.id, { reason: 'Back' }),
        400,
        'validation_failed',
      );
      const elsewhere = await load.classes.room(t.south);
      const before = await everything();
      for (const cookie of [t.vicePrincipal, t.admin]) {
        refusedWith(
          await restoreInto(s.branch, lesson.id, { roomId: elsewhere, reason: 'Back' }, cookie),
          404,
          'not_found',
        );
        refusedWith(
          await restoreInto(s.branch, lesson.id, { roomId: UNKNOWN, reason: 'Back' }, cookie),
          404,
          'not_found',
        );
      }
      expect(await everything()).toEqual(before);
    });
  });

  describe('a double lesson moved and its room changed (task 5.6a-2)', () => {
    async function doubleOf(s: Scene, date: string) {
      const both = await t.database.migrator
        .selectFrom('lessons')
        .select(['id', 'block_id'])
        .where('class_id', '=', s.classId)
        .where('lesson_date', '=', date)
        .orderBy('starts_at')
        .execute();
      const [first, second] = both;
      if (first === undefined || second === undefined) throw new Error('No double lesson.');
      await t.database.migrator
        .updateTable('lesson_blocks')
        .set({ double_pair_id: randomUUID() })
        .where('id', 'in', [first.block_id, second.block_id])
        .execute();
      return { first: first.id, second: second.id };
    }

    const startOf = async (id: string) => (await rowOf(id))?.starts_at;

    it('moves both halves one slot later and back one slot earlier, over their own old place (review must-fix 1)', async () => {
      const s = await scene({ twoLessons: true });
      const { first, second } = await doubleOf(s, NEXT_MONDAY);
      // Named by its later half: the earlier half goes to lesson 2, the later to 3.
      changed(await move(s.branch, second, { date: NEXT_MONDAY, lessonNumber: 2 }));
      expect(await startOf(first)).toEqual(at(NEXT_MONDAY, '08:55'));
      expect(await startOf(second)).toEqual(at(NEXT_MONDAY, '09:50'));
      changed(await move(s.branch, first, { date: NEXT_MONDAY, lessonNumber: 1 }));
      expect(await startOf(first)).toEqual(at(NEXT_MONDAY, '08:00'));
      expect(await startOf(second)).toEqual(at(NEXT_MONDAY, '08:55'));
      expect(await dayChangesOf(first)).toHaveLength(2);
      expect(await noticesOf(s.teacher.accountId)).toHaveLength(2);
    });

    it('moves both halves to another day, and refuses a lesson number with no lesson slot after it (review correction 2)', async () => {
      const s = await scene({ twoLessons: true });
      const { first, second } = await doubleOf(s, NEXT_MONDAY);
      refusedWith(
        await move(s.branch, first, { date: '2026-10-21', lessonNumber: 3 }),
        409,
        'move_no_slot',
      );
      changed(await move(s.branch, first, { date: '2026-10-21', lessonNumber: 2 }));
      expect(await rowOf(first)).toMatchObject({ lesson_date: '2026-10-21' });
      expect(await startOf(second)).toEqual(at('2026-10-21', '09:50'));
    });

    it('refuses a move of a double whose other half is cancelled', async () => {
      const s = await scene({ twoLessons: true });
      const { first, second } = await doubleOf(s, NEXT_MONDAY);
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'exam' })
        .where('id', '=', second)
        .execute();
      refusedWith(
        await move(s.branch, first, { date: '2026-10-21', lessonNumber: 1 }),
        409,
        'lesson_cancelled',
      );
    });

    it('changes the room of both halves when either is named', async () => {
      const s = await scene({ twoLessons: true });
      const { first, second } = await doubleOf(s, NEXT_MONDAY);
      changed(await roomChange(s.branch, second, s.spareRoom));
      expect((await rowOf(first))?.room_id).toBe(s.spareRoom);
      expect((await rowOf(second))?.room_id).toBe(s.spareRoom);
      expect(await t.entries('lesson.room_change', second)).toMatchObject([
        { new_value: { lessonIds: [first, second] } },
      ]);
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

    it('runs a move after a publish that removed the lesson: the move answers 404 (task 5.6a-2)', async () => {
      const s = await scene();
      const draft = await wednesdayDraft(s);
      const lesson = await lessonOf(s, '2026-10-26');
      const [published, moved] = await inOrder(
        s.branch,
        () => publish(s.branch, draft, NEXT_MONDAY),
        () => move(s.branch, lesson.id, { date: '2026-10-26', lessonNumber: 2 }),
      );
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      refusedWith(moved, 404, 'not_found');
      expect(await t.entries('lesson.move', lesson.id)).toEqual([]);
    });

    it('gives two room changes into one room at one time the room once, in either order', async () => {
      for (const order of [0, 1]) {
        const s = await scene();
        const one = await lessonOf(s, NEXT_MONDAY);
        const other = await lessonOf(s, NEXT_MONDAY, s.otherClass);
        const [a, b] = order === 0 ? [one, other] : [other, one];
        const [firstAnswer, secondAnswer] = await inOrder(
          s.branch,
          () => roomChange(s.branch, a.id, s.spareRoom),
          () => roomChange(s.branch, b.id, s.spareRoom),
        );
        changed(firstAnswer);
        expect(blockedBy(secondAnswer, 'day_change_blocked').rules).toContain('room_double');
        expect((await rowOf(a.id))?.room_id).toBe(s.spareRoom);
        expect((await rowOf(b.id))?.room_id).not.toBe(s.spareRoom);
      }
    });

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
