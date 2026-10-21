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
  START,
  UNKNOWN,
  type DayTemplatesKit,
} from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { DAY_REFUSALS, MOVE_REFUSALS } from './day-changes.service.js';
import { followTutors } from './tutor-lessons.js';

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
    input: {
      branch?: string;
      tutor?: boolean;
      twoLessons?: boolean;
      split?: boolean;
      twoGrades?: boolean;
      vacancy?: boolean;
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
    // With `vacancy`, the other class's maths is a vacancy's.
    let vacancy: string | null = null;
    if (input.vacancy === true) {
      vacancy = await load.vacancy(branch, { subjects: [{ subject, grades: [7] }] });
      await hours(branch, vacancy);
    }
    const otherTeacherId = vacancy ?? otherTeacher.staffId;
    const otherRow = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: otherClass,
      subject_id: subject,
      teacher_id: otherTeacherId,
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
    // With `twoGrades`, a group of the first class and a class of grade 8
    // for Art on Thursday in the first slot (task 5.6a-2).
    let art: string | null = null;
    if (input.twoGrades === true) {
      art = await load.classes.subject({ grades: [7, 8], journalType: 'attendance_only' });
      const eighth = await load.classes.schoolClass(branch, year, { grade: 8 });
      const group = await load.classes.group(branch, year, art, [classId, eighth]);
      const person = await load.teacher(branch, { subjects: [{ subject: art, grades: [7, 8] }] });
      await hours(branch, person.staffId);
      const artRow = await load.row({
        branch_id: branch,
        version_id: version,
        group_id: group,
        subject_id: art,
        teacher_id: person.staffId,
        lessons_per_week: 1,
      });
      await placeAt(branch, version, artRow, 4);
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
      art,
      vacancy,
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
  /**
   * A lesson cancelled 'exam' with the link every such lesson has
   * (lessons_exam_link, 0094, task 5.6c-1): to an exam of its time,
   * cancelled since, so the exam holds no claim.
   */
  async function cancelForExam(s: Scene, lessonId: string) {
    await t.database.migrator.transaction().execute(async (transaction) => {
      const lesson = await transaction
        .selectFrom('lessons')
        .select([sql<string>`lesson_date::text`.as('date'), 'starts_at', 'ends_at'])
        .where('id', '=', lessonId)
        .executeTakeFirstOrThrow();
      const exam = await transaction
        .insertInto('exams')
        .values({
          branch_id: s.branch,
          academic_year_id: s.year,
          exam_date: lesson.date,
          starts_at: lesson.starts_at,
          ends_at: lesson.ends_at,
          first_slot: 1,
          last_slot: 1,
          title: 'Earlier exam',
          cancel_cause: 'cancelled',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('lessons')
        .set({ cancel_cause: 'exam' })
        .where('id', '=', lessonId)
        .execute();
      await transaction
        .insertInto('lesson_exam_cancels')
        .values({ branch_id: s.branch, lesson_id: lessonId, exam_id: exam.id })
        .execute();
    });
  }

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
      // Task 5.7a-1 (permission review must-fix 1): the correction writes it.
      t.database.migrator
        .selectFrom('lesson_absence_taught')
        .selectAll()
        .orderBy('lesson_id')
        .execute(),
      t.database.migrator
        .selectFrom('lesson_day_change_ends')
        .selectAll()
        .orderBy('change_id')
        .execute(),
      // Task 5.7b-1 (spec review of the plan, must-fix 5): the correction and the writers of dated lessons write them.
      t.database.migrator.selectFrom('substitutions').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('substitution_lessons').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('notifications').select('id').orderBy('id').execute(),
      sql<{ id: string }>`select id from pgboss.job order by id`
        .execute(t.database.migrator)
        .then((result) => result.rows),
      t.database.migrator.selectFrom('audit_log').select('id').orderBy('id').execute(),
      // Task 5.6a-5a (permission review, must-fix 2): every other table a publish writes.
      t.database.migrator.selectFrom('timetable_versions').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('teaching_load_rows').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('pattern_entries').selectAll().orderBy('id').execute(),
      t.database.migrator
        .selectFrom('timetable_version_out_of_date_causes')
        .selectAll()
        .orderBy('id')
        .execute(),
      t.database.migrator
        .selectFrom('timetable_day_keeps')
        .selectAll()
        .orderBy('version_id')
        .orderBy('class_id')
        .orderBy('kept_on')
        .orderBy('slot_position')
        .execute(),
      t.database.migrator.selectFrom('journals').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('request_keys').selectAll().orderBy('key').execute(),
      // Task 5.6a-5b-2 (permission review must-fix 2): a withdraw records bulk cancels' choices.
      t.database.migrator
        .selectFrom('bulk_cancel_blocks')
        .selectAll()
        .orderBy('bulk_cancel_id')
        .orderBy('block_id')
        .execute(),
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
        if (cause === 'exam') {
          await cancelForExam(s, lesson.id);
        } else {
          await t.database.migrator
            .updateTable('lessons')
            .set({ cancel_cause: cause })
            .where('id', '=', lesson.id)
            .execute();
        }
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
      // From 19 October Mondays start at 09:00. Task 5.6b-4a: the setting is
      // written straight into the table, as the route wrote it before: the
      // route now writes the lessons of those dates again on the new times
      // (and refuses a change over the stored cancel), so the state this check guards comes
      // only from a template row that the lessons were not written after.
      const slot = await t.createSlotType(s.branch, 'Late lesson', 'lesson', 45);
      const late = await t.createTemplate(s.branch, 'Late', [slot, slot, slot], '09:00');
      await t.database.migrator
        .insertInto('day_template_assignments')
        .values({
          branch_id: s.branch,
          level: 'weekday',
          weekday: 1,
          grade_from: null,
          grade_to: null,
          day_template_id: late,
          valid_from: NEXT_MONDAY,
        })
        .execute();
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
      await cancelForExam(s, pair.second);
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
      refusedWith(await roomChange(s.branch, lesson.id, elsewhere), 404, 'not_found');
      refusedWith(await roomChange(s.branch, lesson.id, UNKNOWN), 404, 'not_found');
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

    it('keeps a used key to its account, its branch and its role, for every id it names (request keys)', async () => {
      const s = northScene;
      const other = await scene();
      const otherLesson = (await lessonOf(other, NEXT_MONDAY)).id;
      const otherRoom = await load.classes.room(other.branch);
      const lesson = await lessonOf(s, '2027-02-15');
      const target = { date: '2027-02-15', lessonNumber: 2 };

      // A room change as the Academic Vice Principal, named in the log.
      const key = randomUUID();
      changed(await roomChange(s.branch, lesson.id, s.spareRoom, 'Painted', t.vicePrincipal, key));
      expect(await t.entries('lesson.room_change', lesson.id)).toMatchObject([
        { assignment_id: t.viceAssignment },
      ]);
      let before = await everything();
      // The repeat answers the stored change and writes nothing more.
      changed(await roomChange(s.branch, lesson.id, s.spareRoom, 'Painted', t.vicePrincipal, key));
      refusedWith(
        await roomChange(s.branch, lesson.id, s.spareRoom, 'Painted', t.admin, key),
        409,
        'request_key_reused',
      );
      for (const [id, roomId] of [
        [otherLesson, s.spareRoom],
        [UNKNOWN, s.spareRoom],
        [lesson.id, otherRoom],
        [lesson.id, UNKNOWN],
      ] as const) {
        refusedWith(
          await roomChange(s.branch, id, roomId, 'Painted', t.vicePrincipal, key),
          404,
          'not_found',
        );
      }
      refusedWith(
        await roomChange(s.branch, lesson.id, s.spareRoom, 'Painted', t.principal, key),
        403,
        'permission_denied',
      );
      expect(await everything()).toEqual(before);

      // A move as the Academic Vice Principal.
      const moveKey = randomUUID();
      changed(await move(s.branch, lesson.id, target, t.vicePrincipal, moveKey));
      expect(await t.entries('lesson.move', lesson.id)).toMatchObject([
        { assignment_id: t.viceAssignment },
      ]);
      before = await everything();
      changed(await move(s.branch, lesson.id, target, t.vicePrincipal, moveKey));
      refusedWith(
        await move(s.branch, lesson.id, target, t.admin, moveKey),
        409,
        'request_key_reused',
      );
      for (const id of [otherLesson, UNKNOWN]) {
        refusedWith(await move(s.branch, id, target, t.vicePrincipal, moveKey), 404, 'not_found');
      }
      for (const roomId of [otherRoom, UNKNOWN]) {
        refusedWith(
          await move(s.branch, lesson.id, { ...target, roomId }, t.vicePrincipal, moveKey),
          404,
          'not_found',
        );
      }
      refusedWith(
        await move(s.branch, lesson.id, target, t.principal, moveKey),
        403,
        'permission_denied',
      );
      expect(await everything()).toEqual(before);

      // A restore into a room as the Academic Vice Principal.
      const restored = await lessonOf(s, '2027-03-01');
      changed(await cancel(s.branch, restored.id));
      const restoreKey = randomUUID();
      const body = { roomId: s.spareRoom, reason: 'Back' };
      changed(await restoreInto(s.branch, restored.id, body, t.vicePrincipal, restoreKey));
      expect(await t.entries('lesson.restore', restored.id)).toMatchObject([
        { assignment_id: t.viceAssignment, new_value: { roomId: s.spareRoom } },
      ]);
      before = await everything();
      changed(await restoreInto(s.branch, restored.id, body, t.vicePrincipal, restoreKey));
      refusedWith(
        await restoreInto(s.branch, restored.id, body, t.admin, restoreKey),
        409,
        'request_key_reused',
      );
      for (const roomId of [otherRoom, UNKNOWN]) {
        refusedWith(
          await restoreInto(
            s.branch,
            restored.id,
            { roomId, reason: 'Back' },
            t.vicePrincipal,
            restoreKey,
          ),
          404,
          'not_found',
        );
      }
      refusedWith(
        await restoreInto(s.branch, otherLesson, body, t.vicePrincipal, restoreKey),
        404,
        'not_found',
      );
      refusedWith(
        await restoreInto(s.branch, restored.id, body, t.principal, restoreKey),
        403,
        'permission_denied',
      );
      expect(await everything()).toEqual(before);
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

    it('moves a group of two grades only to a lesson slot with the same times in both grades’ templates', async () => {
      const s = await scene({ twoGrades: true });
      const lesson = await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('branch_id', '=', s.branch)
        .where('subject_id', '=', s.art ?? '')
        .where('lesson_date', '=', '2026-10-22')
        .executeTakeFirstOrThrow();
      // From Wednesday 21 October grade 8 has a shorter first break: its
      // lesson 2 starts at 08:50, grade 7's at 08:55.
      const slot = await t.createSlotType(s.branch, 'Lesson 8', 'lesson', 45);
      const pause = await t.createSlotType(s.branch, 'Short break', 'break', 5);
      const eighth = await t.createTemplate(s.branch, 'Grade 8', [slot, pause, slot, pause, slot]);
      await t.assign(s.branch, eighth, { level: 'grades', gradeFrom: 8, gradeTo: 8 }, '2026-10-21');
      expect(
        blockedBy(
          await move(s.branch, lesson.id, { date: '2026-10-21', lessonNumber: 2 }),
          'day_change_blocked',
        ).rules,
      ).toContain('two_grade_slot');
      changed(await move(s.branch, lesson.id, { date: '2026-10-21', lessonNumber: 1 }));
    });

    it('binds a vacancy as a teacher and notifies no vacancy (edge/timetable, the vacancy rows)', async () => {
      const s = await scene({ vacancy: true });
      const lesson = await lessonOf(s, NEXT_MONDAY, s.otherClass);
      expect(lesson.teacher_id).toBe(s.vacancy);
      expect(
        blockedBy(
          await move(s.branch, lesson.id, { date: '2026-10-26', lessonNumber: 1 }),
          'day_change_blocked',
        ).rules,
      ).toContain('teacher_double');
      const before = await t.database.migrator.selectFrom('notifications').select('id').execute();
      changed(await move(s.branch, lesson.id, { date: NEXT_MONDAY, lessonNumber: 2 }));
      expect(await t.database.migrator.selectFrom('notifications').select('id').execute()).toEqual(
        before,
      );
      expect(await t.entries('lesson.move', lesson.id)).toMatchObject([
        { new_value: { notices: { notified: 0, marked: 1 } } },
      ]);
    });

    it('refuses a lesson that starts at the clock or a minute before, for a room change and a move (decision 5)', async () => {
      for (const [start, end] of [
        ['23:54', '23:58'],
        ['23:55', '23:59'],
      ] as const) {
        const s = await scene();
        const started = await todayLesson(s, start, end);
        refusedWith(await roomChange(s.branch, started, s.spareRoom), 409, 'lesson_started');
        refusedWith(
          await move(s.branch, started, { date: NEXT_MONDAY, lessonNumber: 2 }),
          409,
          'lesson_started',
        );
      }
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
      // The teacher's Tutor role in the other branch, and the acting Tutor row
      // the held side writes, as a give of an acting Tutor writes it.
      const role = await load.classes.role(s.teacher.accountId, away.branch, 'tutor');
      const givenBy = await load.classes.account();
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
            .insertInto('class_tutors')
            .values({
              branch_id: away.branch,
              class_id: away.classId,
              assignment_id: role,
              kind: 'acting',
              valid_from: at('2026-10-11', '00:00'),
              own_until: null,
              given_by: givenBy,
            })
            .execute();
          // The real follow of the change: the class's Tutor lessons go to the acting Tutor.
          await followTutors(transaction, [away.classId], at('2026-10-11', '00:00'));
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
      // The follow gave the other branch's Tutor lesson to the teacher.
      expect((await rowOf(tutorLesson.id))?.teacher_id).toBe(s.teacher.staffId);
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
      await cancelForExam(s, second.part);
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
      // A room not in use is refused as the restore is.
      const closed = await load.classes.room(s.branch, 'closed');
      refusedWith(
        await restoreInto(s.branch, lesson.id, { roomId: closed, reason: 'Back in the hall' }),
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

    it('refuses a restore into the lesson’s own room as no room change, and keeps a used key to its room', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      changed(await cancel(s.branch, lesson.id));
      refusedWith(
        await restoreInto(s.branch, lesson.id, { roomId: s.room, reason: 'Back' }),
        409,
        'room_unchanged',
      );
      const key = randomUUID();
      changed(
        await restoreInto(
          s.branch,
          lesson.id,
          { roomId: s.spareRoom, reason: 'Back' },
          t.admin,
          key,
        ),
      );
      refusedWith(
        await restoreInto(
          s.branch,
          lesson.id,
          { roomId: s.otherRoom, reason: 'Back' },
          t.admin,
          key,
        ),
        409,
        'request_key_reused',
      );
      expect(await dayChangesOf(lesson.id)).toHaveLength(1);
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
      await cancelForExam(s, second);
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
        const [sent, cancelled] = order === 0 ? [one, two] : [two, one];
        // Task 5.6a-5a (review should-fix 7): a cancel recorded after the
        // preview was read refuses the publish sent without its key; the
        // publish sent again with the key of the preview that lists it goes
        // through.
        let published = sent;
        if (order === 1) {
          expect(
            (sent.body as { error: { details: { code: string }[] } }).error.details.map(
              (one) => one.code,
            ),
          ).toEqual(['day_changes_changed']);
          const checked = await t.get(
            `/api/timetable/versions/${draft}/publish-check?startsOn=${NEXT_MONDAY}`,
            s.branch,
          );
          const days = (
            checked.body as { impact: { dayChanges: { key: string; dropped: { key: string }[] } } }
          ).impact.dayChanges;
          expect(days.dropped.map((item) => item.key)).toEqual([lesson.id]);
          published = await request(t.kit.server)
            .post(`/api/timetable/versions/${draft}/publish`)
            .set('Cookie', t.admin)
            .set(BRANCH_HEADER, s.branch)
            .set(REQUEST_KEY_HEADER, randomUUID())
            .send({ startsOn: NEXT_MONDAY, dayChangesKey: days.key });
        }
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

  // Task 5.6a-4, pull request #163: the correction of a past lesson (`06`,
  // How surprises are prevented: "A past lesson can only be corrected one at
  // a time by the Academic Vice Principal, with a reason"; edge/timetable,
  // After publishing, "The lesson time passes and nobody was assigned": "The
  // lesson stays 'unresolved' … until it is cancelled with a reason or the
  // person who taught it is recorded. It never counts as held"). The clock
  // never moves (the sessions would end); a scene's Monday lessons are copied
  // to Friday 9 October, the day before the clock's Saturday.
  describe('the correction of a past lesson', () => {
    const FRIDAY = '2026-10-09';

    /**
     * The scene's templates from the start of the year, so that Friday has
     * its day; the fixture moves the dated rows back, past the guard that
     * they only shrink (as the past-date test of the bulk cancel does).
     */
    async function fromSeptember(s: Scene) {
      await t.database.migrator.transaction().execute(async (transaction) => {
        for (const table of [
          'slot_type_lengths',
          'day_template_versions',
          'day_template_assignments',
        ] as const) {
          await sql`alter table ${sql.table(table)} disable trigger user`.execute(transaction);
          await transaction
            .updateTable(table)
            .set({ valid_from: '2026-09-01' })
            .where('branch_id', '=', s.branch)
            .execute();
          await sql`alter table ${sql.table(table)} enable trigger user`.execute(transaction);
        }
      });
    }

    /**
     * Copies of the Monday lessons of a class and subject (both halves of a
     * double, as a pair) in blocks of their own on `date` at the same clock
     * times, written by the migrator: a publish never writes the past.
     */
    async function past(
      s: Scene,
      input: {
        classId?: string;
        subject?: string;
        date?: string;
        teacherId?: string | null;
        times?: readonly (readonly [string, string])[];
      } = {},
    ): Promise<string[]> {
      const date = input.date ?? FRIDAY;
      const from = await t.database.migrator
        .selectFrom('lessons')
        .selectAll()
        .where('branch_id', '=', s.branch)
        .where('class_id', '=', input.classId ?? s.classId)
        .where('subject_id', '=', input.subject ?? s.subject)
        .where('lesson_date', '=', MONDAY)
        .orderBy('starts_at')
        .execute();
      const pair = from.length > 1 ? randomUUID() : null;
      const copied: string[] = [];
      for (const [index, one] of from.entries()) {
        const block = await t.database.migrator
          .selectFrom('lesson_blocks')
          .selectAll()
          .where('id', '=', one.block_id)
          .executeTakeFirstOrThrow();
        const days = new Date(MONDAY).getTime() - new Date(date).getTime();
        const timed = input.times?.[index];
        const startsAt =
          timed === undefined ? new Date(one.starts_at.getTime() - days) : at(date, timed[0]);
        const endsAt =
          timed === undefined ? new Date(one.ends_at.getTime() - days) : at(date, timed[1]);
        const made = await t.database.migrator
          .insertInto('lesson_blocks')
          .values({
            branch_id: s.branch,
            academic_year_id: block.academic_year_id,
            quarter_id: block.quarter_id,
            lesson_date: date,
            starts_at: startsAt,
            ends_at: endsAt,
            version_id: block.version_id,
            pattern_block_id: block.pattern_block_id,
            double_pair_id: pair,
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
            class_id: one.class_id,
            subject_id: one.subject_id,
            load_row_id: one.load_row_id,
            pattern_entry_id: one.pattern_entry_id,
            teacher_id: input.teacherId === undefined ? one.teacher_id : input.teacherId,
            room_id: one.room_id,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        copied.push(lesson.id);
      }
      return copied;
    }

    /** The one copy of a class's Monday lesson on Friday, the templates moved back first. */
    /**
     * Task 5.7b-1 (spec review of the plan, must-fix 5): a substitution in
     * force on a lesson, written by the migrator, which a correction of kind
     * `teacher` would end.
     */
    async function substitutedBy(s: Scene, lessonId: string, replacedId: string) {
      const lesson = await rowOf(lessonId);
      if (lesson?.teacher_id == null) throw new Error('The lesson has no teacher.');
      const record = await t.database.migrator
        .insertInto('substitutions')
        .values({
          branch_id: s.branch,
          source: 'lesson',
          replaced_id: replacedId,
          substitute_id: lesson.teacher_id,
          relaxed: false,
          reason: 'The teacher was ill',
          made_at: at('2026-10-08', '12:00'),
          made_by: await load.classes.account(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('substitution_lessons')
        .values({
          substitution_id: record.id,
          branch_id: s.branch,
          lesson_id: lessonId,
          lesson_date: lesson.lesson_date,
        })
        .execute();
    }

    async function pastOne(s: Scene, input: Parameters<typeof past>[1] = {}) {
      await fromSeptember(s);
      const [id] = await past(s, input);
      if (id === undefined) throw new Error('No lesson was copied.');
      return id;
    }

    const correct = (
      branch: string,
      id: string,
      body: object,
      cookie = t.admin,
      key: string = randomUUID(),
    ) =>
      keyed(
        `/api/timetable/lessons/${id}/correction`,
        branch,
        { reason: 'The register says otherwise', ...body },
        cookie,
        key,
      );

    const teachersFor = (branch: string, id: string, cookie = t.admin) =>
      t.get(`/api/timetable/lessons/${id}/correction-teachers`, branch, cookie);

    /** The day answer's lesson of an id. */
    const shownOf = async (s: Scene, classId: string, date: string, id: string) => {
      const response = await day(s.branch, classId, date);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const lesson = dayAnswerSchema.parse(response.body).lessons.find((one) => one.id === id);
      if (lesson === undefined) throw new Error('The lesson is not on the day.');
      return lesson;
    };

    /** The details of a `correction_needs_confirm`. */
    const ticksOf = (response: Response) => {
      refusedWith(response, 409, 'correction_needs_confirm');
      return (response.body as { error: { details: { code: string }[] } }).error.details.map(
        (one) => one.code,
      );
    };

    /** A person of the branch with hours, of the given profile. */
    async function personOf(
      branch: string,
      input: { subjects?: { subject: string; grades: number[] }[]; languages?: ('uz' | 'ru')[] },
    ) {
      const person = await load.teacher(branch, input);
      await hours(branch, person.staffId);
      return person;
    }

    /** `status` from `from` for a person, the open status before it ended there. */
    async function statusFrom(staffId: string, status: 'left' | 'inactive', from: string) {
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

    it('refuses a lesson that has not started, and nothing changes; a started one takes no one-day change (decision 5)', async () => {
      const s = await scene();
      const future = await lessonOf(s, MONDAY);
      const before = await everything();
      refusedWith(
        await correct(s.branch, future.id, { kind: 'cancel' }),
        409,
        'lesson_not_started',
      );
      expect(await everything()).toEqual(before);
      expect((await shownOf(s, s.classId, MONDAY, future.id)).canCorrect).toBe(false);
      const lesson = await pastOne(s);
      refusedWith(await cancel(s.branch, lesson), 409, 'lesson_started');
      expect(await shownOf(s, s.classId, FRIDAY, lesson)).toMatchObject({
        state: 'held',
        canCorrect: true,
        canCancel: false,
      });
    });

    it('cancels a past lesson with its reason, marks it and notifies its teacher once; a cancelled lesson takes no second cancel, teacher or room', async () => {
      const s = await scene();
      const lesson = await pastOne(s);
      const answer = changed(
        await correct(s.branch, lesson, { kind: 'cancel', reason: 'Nobody came' }),
      );
      expect(answer.lesson).toMatchObject({
        state: 'cancelled',
        cancelCause: 'reason',
        cancelReason: 'Nobody came',
      });
      expect(await rowOf(lesson)).toMatchObject({
        cancel_cause: 'reason',
        cancel_reason: 'Nobody came',
      });
      expect(await claimsOf(lesson)).toEqual([]);
      expect(await markOf(lesson)).toEqual(t.clock.now());
      expect(await noticesOf(s.teacher.accountId)).toHaveLength(1);
      const [entry] = await t.entries('lesson.correct', lesson);
      expect(entry).toMatchObject({
        old_value: { cancelCause: null, teacherId: s.teacher.staffId },
        new_value: { kind: 'cancel', cancelCause: 'reason', reason: 'Nobody came' },
      });
      const before = await everything();
      refusedWith(await correct(s.branch, lesson, { kind: 'cancel' }), 409, 'lesson_cancelled');
      refusedWith(
        await correct(s.branch, lesson, { kind: 'teacher', teacherId: s.otherTeacher.staffId }),
        409,
        'lesson_cancelled',
      );
      refusedWith(
        await correct(s.branch, lesson, { kind: 'room', roomId: s.spareRoom }),
        409,
        'lesson_cancelled',
      );
      expect(await everything()).toEqual(before);
    });

    it('takes one lesson at a time: a half of a double alone (decision 1)', async () => {
      const s = await scene({ twoLessons: true });
      await fromSeptember(s);
      const [first, second] = await past(s);
      if (first === undefined || second === undefined) throw new Error('No double was copied.');
      changed(await correct(s.branch, first, { kind: 'cancel' }));
      expect(await rowOf(first)).toMatchObject({ cancel_cause: 'reason' });
      expect(await rowOf(second)).toMatchObject({ cancel_cause: null });
    });

    it('records a teacher and a room on one half of a held double, the other half keeping its own (spec review of the code, must-fix 1)', async () => {
      const s = await scene({ twoLessons: true });
      await fromSeptember(s);
      const [first, second] = await past(s);
      if (first === undefined || second === undefined) throw new Error('No double was copied.');
      const person = await personOf(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      changed(await correct(s.branch, second, { kind: 'teacher', teacherId: person.staffId }));
      changed(await correct(s.branch, first, { kind: 'room', roomId: s.spareRoom }));
      expect(await rowOf(first)).toMatchObject({
        teacher_id: s.teacher.staffId,
        room_id: s.spareRoom,
      });
      expect(await rowOf(second)).toMatchObject({ teacher_id: person.staffId, room_id: s.room });
    });

    it('takes the later half of a double once the earlier one has started, which no one-day change takes (review correction 2)', async () => {
      const s = await scene({ twoLessons: true });
      // Today, the earlier half at 23:40 has started, the later at 23:57 not.
      const [first, second] = await past(s, {
        date: '2026-10-10',
        times: [
          ['23:40', '23:50'],
          ['23:57', '23:59'],
        ],
      });
      if (first === undefined || second === undefined) throw new Error('No double was copied.');
      refusedWith(await cancel(s.branch, second), 409, 'lesson_started');
      changed(await correct(s.branch, second, { kind: 'cancel' }));
      expect(await rowOf(second)).toMatchObject({ cancel_cause: 'reason' });
      expect(await rowOf(first)).toMatchObject({ cancel_cause: null });
    });

    it('restores a past lesson with every rule checked again: its room taken refuses with a free room, which it then takes', async () => {
      const s = await scene();
      const lesson = await pastOne(s);
      changed(await correct(s.branch, lesson, { kind: 'cancel' }));
      // The other class's lesson of that time was in the room.
      await past(s, { classId: s.otherClass });
      const other = await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', s.otherClass)
        .where('lesson_date', '=', FRIDAY)
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .updateTable('lessons')
        .set({ room_id: s.room })
        .where('id', '=', other.id)
        .execute();
      refusedWith(await restore(s.branch, lesson), 409, 'lesson_started');
      const before = await everything();
      const blocked = blockedBy(
        await correct(s.branch, lesson, { kind: 'restore' }),
        'correction_blocked',
      );
      expect(blocked.rules).toContain('room_double');
      expect(blocked.rooms).toContain(s.spareRoom);
      expect(await everything()).toEqual(before);
      const answer = changed(
        await correct(s.branch, lesson, { kind: 'restore', roomId: s.spareRoom }),
      );
      expect(answer.lesson).toMatchObject({ state: 'held', room: { id: s.spareRoom } });
      expect(await rowOf(lesson)).toMatchObject({
        cancel_cause: null,
        cancel_reason: null,
        room_id: s.spareRoom,
        teacher_id: s.teacher.staffId,
      });
    });

    it('asks for the tick when a restored lesson’s teacher was outside their hours, and restores with it (decision 2, review correction 1)', async () => {
      const s = await scene();
      // The lesson's teacher comes at 10:00; it began at 08:00.
      const late = await load.teacher(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
      });
      await hours(s.branch, late.staffId, '2026-09-01', 600);
      const lesson = await pastOne(s, { teacherId: late.staffId });
      changed(await correct(s.branch, lesson, { kind: 'cancel' }));
      const before = await everything();
      expect(ticksOf(await correct(s.branch, lesson, { kind: 'restore' }))).toEqual([
        'teacher_unavailable',
      ]);
      expect(await everything()).toEqual(before);
      const answer = changed(await correct(s.branch, lesson, { kind: 'restore', confirm: true }));
      expect(answer.warnings.map((one) => one.rule)).toContain('teacher_unavailable');
      expect(answer.lesson.state).toBe('held');
      const entries = await t.entries('lesson.correct', lesson);
      expect(entries.at(-1)).toMatchObject({ new_value: { kind: 'restore', confirmed: true } });
    });

    it('restores a vacancy’s past lesson as it stands: not refused as a substitute, and unresolved (review correction 1)', async () => {
      const s = await scene({ vacancy: true });
      const lesson = await pastOne(s, { classId: s.otherClass });
      changed(await correct(s.branch, lesson, { kind: 'cancel' }));
      const answer = changed(await correct(s.branch, lesson, { kind: 'restore' }));
      expect(answer.lesson).toMatchObject({ state: 'unresolved', teacher: { kind: 'vacancy' } });
    });

    it('records who taught an unresolved lesson: it becomes held and the person is told (edge/timetable, "The lesson time passes and nobody was assigned")', async () => {
      const s = await scene({ vacancy: true });
      const lesson = await pastOne(s, { classId: s.otherClass });
      expect((await shownOf(s, s.otherClass, FRIDAY, lesson)).state).toBe('unresolved');
      const listed = await teachersFor(s.branch, lesson);
      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      const ids = (listed.body as { teachers: { id: string }[] }).teachers.map((one) => one.id);
      expect(ids).toContain(s.otherTeacher.staffId);
      expect(ids).not.toContain(s.vacancy);
      const answer = changed(
        await correct(s.branch, lesson, {
          kind: 'teacher',
          teacherId: s.otherTeacher.staffId,
          reason: 'Taught by the department head',
        }),
      );
      expect(answer.lesson).toMatchObject({
        state: 'held',
        teacher: { id: s.otherTeacher.staffId, kind: 'person' },
      });
      expect(await rowOf(lesson)).toMatchObject({ teacher_id: s.otherTeacher.staffId });
      expect(await noticesOf(s.otherTeacher.accountId)).toHaveLength(1);
      const [entry] = await t.entries('lesson.correct', lesson);
      expect(entry).toMatchObject({
        old_value: { teacherId: s.vacancy },
        new_value: { kind: 'teacher', teacherId: s.otherTeacher.staffId },
      });
      refusedWith(
        await correct(s.branch, lesson, { kind: 'teacher', teacherId: s.otherTeacher.staffId }),
        409,
        'teacher_unchanged',
      );
    });

    it('records a teacher on a past lesson with nobody recorded', async () => {
      const s = await scene();
      const lesson = await pastOne(s, { teacherId: null });
      expect((await shownOf(s, s.classId, FRIDAY, lesson)).state).toBe('unresolved');
      const answer = changed(
        await correct(s.branch, lesson, { kind: 'teacher', teacherId: s.otherTeacher.staffId }),
      );
      expect(answer.lesson.state).toBe('held');
    });

    it('keeps double booking blocked: the person in another lesson of the branch, of another branch, or within the travel time (decision 2)', async () => {
      const s = await scene({ twoLessons: true });
      await fromSeptember(s);
      const [first, second] = await past(s);
      const [other] = await past(s, { classId: s.otherClass });
      if (first === undefined || second === undefined || other === undefined) {
        throw new Error('No lesson was copied.');
      }
      const before = await everything();
      // The other class's teacher taught at 08:00 too.
      expect(
        blockedBy(
          await correct(s.branch, first, { kind: 'teacher', teacherId: s.otherTeacher.staffId }),
          'correction_blocked',
        ).rules,
      ).toContain('teacher_double');
      expect(await everything()).toEqual(before);
      // A person of both branches teaching at 08:00 in the other branch.
      const away = await scene();
      const person = await personOf(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: person.staffId, branch_id: away.branch, is_main: false })
        .execute();
      await fromSeptember(away);
      await past(away, { teacherId: person.staffId });
      expect(
        blockedBy(
          await correct(s.branch, first, { kind: 'teacher', teacherId: person.staffId }),
          'correction_blocked',
        ).rules,
      ).toContain('teacher_double');
      // The later half starts ten minutes after the away lesson ends; the travel time is 30.
      const [a, b] = [s.branch, away.branch].sort();
      await t.database.migrator
        .insertInto('travel_times')
        .values({ branch_low: a ?? '', branch_high: b ?? '', minutes: 30 })
        .execute();
      expect(
        blockedBy(
          await correct(s.branch, second, { kind: 'teacher', teacherId: person.staffId }),
          'correction_blocked',
        ).rules,
      ).toContain('travel_time');
      expect(await rowOf(second)).toMatchObject({ teacher_id: s.teacher.staffId });
    });

    it('refuses a vacancy and a person not active on the date, and takes one who left after it (decisions 2 and 4)', async () => {
      const s = await scene({ vacancy: true });
      const lesson = await pastOne(s, { classId: s.otherClass });
      const other = await load.vacancy(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
      });
      await hours(s.branch, other);
      const gone = await personOf(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      await statusFrom(gone.staffId, 'left', '2026-10-01');
      const later = await personOf(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      await statusFrom(later.staffId, 'left', '2026-10-10');
      const listed = await teachersFor(s.branch, lesson);
      const ids = (listed.body as { teachers: { id: string }[] }).teachers.map((one) => one.id);
      expect(ids).toContain(later.staffId);
      expect(ids).not.toContain(gone.staffId);
      expect(ids).not.toContain(other);
      const before = await everything();
      expect(
        blockedBy(
          await correct(s.branch, lesson, { kind: 'teacher', teacherId: other }),
          'correction_blocked',
        ).rules,
      ).toContain('substitute_vacancy');
      expect(
        blockedBy(
          await correct(s.branch, lesson, { kind: 'teacher', teacherId: gone.staffId }),
          'correction_blocked',
        ).rules,
      ).toContain('teacher_inactive');
      expect(await everything()).toEqual(before);
      const answer = changed(
        await correct(s.branch, lesson, { kind: 'teacher', teacherId: later.staffId }),
      );
      expect(answer.lesson).toMatchObject({ state: 'held', teacher: { id: later.staffId } });
    });

    it('asks for the tick for a person without the subject or the class’s language, and records them with it (decision 2)', async () => {
      const s = await scene({ vacancy: true });
      const lesson = await pastOne(s, { classId: s.otherClass });
      const outsider = await personOf(s.branch, {});
      const russian = await personOf(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
        languages: ['ru'],
      });
      const before = await everything();
      expect(
        ticksOf(await correct(s.branch, lesson, { kind: 'teacher', teacherId: outsider.staffId })),
      ).toContain('teacher_subject');
      expect(
        ticksOf(await correct(s.branch, lesson, { kind: 'teacher', teacherId: russian.staffId })),
      ).toEqual(['substitute_language']);
      expect(await everything()).toEqual(before);
      const answer = changed(
        await correct(s.branch, lesson, {
          kind: 'teacher',
          teacherId: outsider.staffId,
          confirm: true,
        }),
      );
      expect(answer.lesson).toMatchObject({ state: 'held', teacher: { id: outsider.staffId } });
    });

    it('keeps the person who held a past Tutor lesson through a room correction, a cancel and a restore (decision 12)', async () => {
      const s = await scene({ tutor: true });
      if (s.tutorSubject === null || s.tutor === null) throw new Error('No Tutor row.');
      await fromSeptember(s);
      // The Tutor lesson of Tuesday 13 October copied to Friday, held by the maths teacher.
      const tuesday = await lessonOf(s, '2026-10-13', s.classId, s.tutorSubject);
      const block = await t.database.migrator
        .selectFrom('lesson_blocks')
        .selectAll()
        .where('id', '=', tuesday.block_id)
        .executeTakeFirstOrThrow();
      const days = 4 * 24 * 60 * 60_000;
      const made = await t.database.migrator
        .insertInto('lesson_blocks')
        .values({
          branch_id: s.branch,
          academic_year_id: block.academic_year_id,
          quarter_id: block.quarter_id,
          lesson_date: FRIDAY,
          starts_at: new Date(block.starts_at.getTime() - days),
          ends_at: new Date(block.ends_at.getTime() - days),
          version_id: block.version_id,
          pattern_block_id: block.pattern_block_id,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      const { id: lesson } = await t.database.migrator
        .insertInto('lessons')
        .values({
          branch_id: s.branch,
          block_id: made.id,
          lesson_date: made.lesson_date,
          starts_at: made.starts_at,
          ends_at: made.ends_at,
          class_id: tuesday.class_id,
          subject_id: tuesday.subject_id,
          load_row_id: tuesday.load_row_id,
          pattern_entry_id: tuesday.pattern_entry_id,
          teacher_id: s.teacher.staffId,
          room_id: tuesday.room_id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      changed(
        await correct(s.branch, lesson, { kind: 'room', roomId: s.spareRoom, confirm: true }),
      );
      expect(await rowOf(lesson)).toMatchObject({
        teacher_id: s.teacher.staffId,
        room_id: s.spareRoom,
      });
      changed(await correct(s.branch, lesson, { kind: 'cancel' }));
      changed(await correct(s.branch, lesson, { kind: 'restore', confirm: true }));
      expect(await rowOf(lesson)).toMatchObject({
        teacher_id: s.teacher.staffId,
        cancel_cause: null,
      });
    });

    it('corrects a past lesson’s room, refuses its own room, and a room taken with a free one offered', async () => {
      const s = await scene();
      const lesson = await pastOne(s);
      await past(s, { classId: s.otherClass });
      const before = await everything();
      refusedWith(
        await correct(s.branch, lesson, { kind: 'room', roomId: s.room }),
        409,
        'room_unchanged',
      );
      const blocked = blockedBy(
        await correct(s.branch, lesson, { kind: 'room', roomId: s.otherRoom }),
        'correction_blocked',
      );
      expect(blocked.rules).toContain('room_double');
      expect(blocked.rooms).toEqual([s.spareRoom]);
      expect(await everything()).toEqual(before);
      const answer = changed(
        await correct(s.branch, lesson, { kind: 'room', roomId: s.spareRoom }),
      );
      expect(answer.lesson).toMatchObject({ state: 'held', room: { id: s.spareRoom } });
      expect(await rowOf(lesson)).toMatchObject({
        room_id: s.spareRoom,
        teacher_id: s.teacher.staffId,
      });
    });

    it('refuses a missing or blank reason as input, and a lesson of a closed year', async () => {
      const s = await scene();
      const lesson = await pastOne(s);
      const before = await everything();
      refusedWith(
        await keyed(
          `/api/timetable/lessons/${lesson}/correction`,
          s.branch,
          { kind: 'cancel' },
          t.admin,
          randomUUID(),
        ),
        400,
        'validation_failed',
      );
      refusedWith(
        await correct(s.branch, lesson, { kind: 'cancel', reason: '   ' }),
        400,
        'validation_failed',
      );
      expect(await everything()).toEqual(before);
      await t.database.migrator
        .updateTable('academic_years')
        .set({ status: 'closed' })
        .where('id', '=', s.year)
        .execute();
      const closed = await everything();
      refusedWith(
        await correct(s.branch, lesson, { kind: 'cancel' }),
        409,
        'timetable_year_closed',
      );
      expect((await shownOf(s, s.classId, FRIDAY, lesson)).canCorrect).toBe(false);
      expect(await everything()).toEqual(closed);
    });

    it('is refused to the Principal, and answers 404 for another branch’s or an unknown lesson, teacher and room, as the Academic Vice Principal and the Super Admin; nothing changes', async () => {
      const s = northScene;
      const lesson = await pastOne(s);
      const other = await scene();
      const foreign = await pastOne(other);
      // Substitutions in force on both lessons, in both branches.
      await substitutedBy(s, lesson, s.otherTeacher.staffId);
      await substitutedBy(other, foreign, other.otherTeacher.staffId);
      const before = await everything();
      refusedWith(
        await correct(s.branch, lesson, { kind: 'cancel' }, t.principal),
        403,
        'permission_denied',
      );
      refusedWith(await teachersFor(s.branch, lesson, t.principal), 403, 'permission_denied');
      for (const cookie of [t.vicePrincipal, t.admin]) {
        refusedWith(await correct(t.north, foreign, { kind: 'cancel' }, cookie), 404, 'not_found');
        refusedWith(await correct(t.north, UNKNOWN, { kind: 'cancel' }, cookie), 404, 'not_found');
        for (const teacherId of [other.teacher.staffId, UNKNOWN]) {
          refusedWith(
            await correct(t.north, lesson, { kind: 'teacher', teacherId }, cookie),
            404,
            'not_found',
          );
        }
        for (const roomId of [other.spareRoom, UNKNOWN]) {
          refusedWith(
            await correct(t.north, lesson, { kind: 'room', roomId }, cookie),
            404,
            'not_found',
          );
          refusedWith(
            await correct(t.north, lesson, { kind: 'restore', roomId }, cookie),
            404,
            'not_found',
          );
        }
        refusedWith(await teachersFor(t.north, foreign, cookie), 404, 'not_found');
        refusedWith(await teachersFor(t.north, UNKNOWN, cookie), 404, 'not_found');
      }
      expect(await everything()).toEqual(before);
    });

    // Task 5.7a-1 (permission review must-fix 1): the path that records an
    // absent teacher as having taught the lesson writes `lesson_absence_taught`;
    // another branch's or an unknown lesson, and a used key with one, change nothing.
    it('answers 404 on the "taught while absent" path for another branch’s or an unknown lesson, also with a used key; nothing changes', async () => {
      const s = northScene;
      const lesson = await pastOne(s, { date: '2026-10-05' });
      const other = await scene();
      const foreign = await pastOne(other, { date: '2026-10-05' });
      const account = await load.classes.account();
      const absences = await t.database.migrator
        .insertInto('absences')
        .values(
          [s.teacher.staffId, other.teacher.staffId].map((staffId) => ({
            staff_id: staffId,
            starts_on: '2026-10-05',
            ends_on: '2026-10-05',
            applies_from: at('2026-10-05', '00:00'),
            applies_until: at('2026-10-06', '00:00'),
            reason: 'Ill',
            created_by: account,
          })),
        )
        .returning('id')
        .execute();
      try {
        const key = randomUUID();
        const taught = (id: string, teacherId: string, cookie: string, used = randomUUID()) =>
          correct(
            t.north,
            id,
            { kind: 'teacher', teacherId, reason: 'Came after all' },
            cookie,
            used,
          );
        const before = await everything();
        for (const cookie of [t.vicePrincipal, t.admin]) {
          refusedWith(await taught(foreign, other.teacher.staffId, cookie), 404, 'not_found');
          refusedWith(await taught(UNKNOWN, s.teacher.staffId, cookie), 404, 'not_found');
        }
        expect(await everything()).toEqual(before);
        changed(await taught(lesson, s.teacher.staffId, t.vicePrincipal, key));
        const after = await everything();
        refusedWith(
          await taught(foreign, other.teacher.staffId, t.vicePrincipal, key),
          404,
          'not_found',
        );
        refusedWith(
          await taught(UNKNOWN, s.teacher.staffId, t.vicePrincipal, key),
          404,
          'not_found',
        );
        expect(await everything()).toEqual(after);
        const rows = await t.database.migrator
          .selectFrom('lesson_absence_taught')
          .select('lesson_id')
          .where('lesson_id', 'in', [lesson, foreign])
          .execute();
        expect(rows).toEqual([{ lesson_id: lesson }]);
      } finally {
        await t.database.migrator
          .deleteFrom('absences')
          .where(
            'id',
            'in',
            absences.map((one) => one.id),
          )
          .execute();
      }
    });

    it('keeps a used key to its account, its branch and its role (request keys)', async () => {
      const s = northScene;
      const lesson = await pastOne(s, { classId: s.otherClass });
      const other = await scene();
      const foreign = await pastOne(other);
      const key = randomUUID();
      const send = (id: string, cookie: string) =>
        correct(s.branch, id, { kind: 'cancel' }, cookie, key);
      changed(await send(lesson, t.vicePrincipal));
      const after = await everything();
      changed(await send(lesson, t.vicePrincipal));
      expect(await everything()).toEqual(after);
      refusedWith(await send(lesson, t.admin), 409, 'request_key_reused');
      refusedWith(await send(foreign, t.vicePrincipal), 404, 'not_found');
      refusedWith(await send(UNKNOWN, t.vicePrincipal), 404, 'not_found');
      refusedWith(await send(lesson, t.principal), 403, 'permission_denied');
      expect(await everything()).toEqual(after);
      const entries = await t.entries('lesson.correct', lesson);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ assignment_id: t.viceAssignment });
    });

    it('keeps a used key of a teacher, a room and a restore into a room to its ids and its role (permission review must-fix 1)', async () => {
      const s = northScene;
      const other = await scene();
      const [byTeacher] = await past(s, { date: '2026-10-08' });
      const [byRoom] = await past(s, { date: '2026-10-07' });
      const [byRestore] = await past(s, { date: '2026-10-06' });
      if (byTeacher === undefined || byRoom === undefined || byRestore === undefined) {
        throw new Error('No lesson was copied.');
      }
      changed(await correct(s.branch, byRestore, { kind: 'cancel' }, t.vicePrincipal));
      const cases = [
        {
          id: byTeacher,
          body: (teacherId: string) => ({ kind: 'teacher', teacherId }),
          own: s.otherTeacher.staffId,
          foreign: other.teacher.staffId,
        },
        {
          id: byRoom,
          body: (roomId: string) => ({ kind: 'room', roomId }),
          own: s.spareRoom,
          foreign: other.spareRoom,
        },
        {
          id: byRestore,
          body: (roomId: string) => ({ kind: 'restore', roomId }),
          own: s.spareRoom,
          foreign: other.spareRoom,
        },
      ];
      for (const one of cases) {
        const key = randomUUID();
        const send = (value: string, cookie: string) =>
          correct(s.branch, one.id, one.body(value), cookie, key);
        changed(await send(one.own, t.vicePrincipal));
        const after = await everything();
        refusedWith(await send(one.foreign, t.vicePrincipal), 404, 'not_found');
        refusedWith(await send(UNKNOWN, t.vicePrincipal), 404, 'not_found');
        refusedWith(await send(one.own, t.principal), 403, 'permission_denied');
        expect(await everything()).toEqual(after);
      }
    });

    it('refuses a restore or a room of a past lesson whose teacher no longer works in the branch by name, and takes the person who taught it (permission review must-fix 2)', async () => {
      const s = await scene();
      const away = await scene();
      const lesson = await pastOne(s);
      changed(await correct(s.branch, lesson, { kind: 'cancel' }));
      // The teacher works in the other branch only from now on.
      // The other branch becomes the main one first, as the staff record allows.
      await t.database.migrator.transaction().execute(async (transaction) => {
        await transaction
          .updateTable('staff_branches')
          .set({ is_main: false })
          .where('staff_id', '=', s.teacher.staffId)
          .execute();
        await transaction
          .insertInto('staff_branches')
          .values({ staff_id: s.teacher.staffId, branch_id: away.branch, is_main: true })
          .execute();
        await transaction
          .deleteFrom('staff_branches')
          .where('staff_id', '=', s.teacher.staffId)
          .where('branch_id', '=', s.branch)
          .execute();
      });
      const before = await everything();
      refusedWith(await correct(s.branch, lesson, { kind: 'restore' }), 409, 'teacher_left_branch');
      expect(await everything()).toEqual(before);
      const [held] = await past(s, { date: '2026-10-08' });
      if (held === undefined) throw new Error('No lesson was copied.');
      refusedWith(
        await correct(s.branch, held, { kind: 'room', roomId: s.spareRoom }),
        409,
        'teacher_left_branch',
      );
      changed(
        await correct(s.branch, held, { kind: 'teacher', teacherId: s.otherTeacher.staffId }),
      );
    });

    it('answers a past lesson held when its teacher no longer works in the branch, without the name (review of #163)', async () => {
      const s = await scene();
      const away = await scene();
      const lesson = await pastOne(s);
      await t.database.migrator.transaction().execute(async (transaction) => {
        await transaction
          .updateTable('staff_branches')
          .set({ is_main: false })
          .where('staff_id', '=', s.teacher.staffId)
          .execute();
        await transaction
          .insertInto('staff_branches')
          .values({ staff_id: s.teacher.staffId, branch_id: away.branch, is_main: true })
          .execute();
        await transaction
          .deleteFrom('staff_branches')
          .where('staff_id', '=', s.teacher.staffId)
          .where('branch_id', '=', s.branch)
          .execute();
      });
      expect(await shownOf(s, s.classId, FRIDAY, lesson)).toMatchObject({
        state: 'held',
        teacher: { id: s.teacher.staffId, kind: 'person', name: '' },
      });
    });

    it('lists only the branch’s people active on the lesson’s date, by every status and its bounds (permission review should-fix 2)', async () => {
      const s = await scene();
      const away = await scene();
      const lesson = await pastOne(s);
      const profile = { subjects: [{ subject: s.subject, grades: [7] }] };
      const outOn = await personOf(s.branch, profile);
      await statusFrom(outOn.staffId, 'inactive', FRIDAY);
      const backBefore = await personOf(s.branch, profile);
      await statusFrom(backBefore.staffId, 'inactive', '2026-10-01');
      await t.database.migrator
        .updateTable('staff_statuses')
        .set({ valid_until: FRIDAY })
        .where('staff_id', '=', backBefore.staffId)
        .where('status', '=', 'inactive')
        .execute();
      await t.database.migrator
        .insertInto('staff_statuses')
        .values({ staff_id: backBefore.staffId, status: 'active', valid_from: FRIDAY })
        .execute();
      for (const cookie of [t.admin]) {
        const listed = await teachersFor(s.branch, lesson, cookie);
        expect(listed.status, JSON.stringify(listed.body)).toBe(200);
        const ids = (listed.body as { teachers: { id: string }[] }).teachers.map((one) => one.id);
        expect(ids).toContain(s.teacher.staffId);
        expect(ids).toContain(backBefore.staffId);
        expect(ids).not.toContain(outOn.staffId);
        expect(ids).not.toContain(away.teacher.staffId);
      }
    });

    it('refuses a reason longer than 500 characters', async () => {
      const s = await scene();
      const lesson = await pastOne(s);
      const before = await everything();
      refusedWith(
        await correct(s.branch, lesson, { kind: 'cancel', reason: 'x'.repeat(501) }),
        400,
        'validation_failed',
      );
      expect(await everything()).toEqual(before);
    });

    it('runs two corrections of one lesson one after the other: the second sees the first', async () => {
      const s = await scene();
      const lesson = await pastOne(s);
      const [first, second] = await inOrder(
        s.branch,
        () => correct(s.branch, lesson, { kind: 'cancel', reason: 'First' }),
        () => correct(s.branch, lesson, { kind: 'cancel', reason: 'Second' }),
      );
      changed(first);
      refusedWith(second, 409, 'lesson_cancelled');
      expect(await rowOf(lesson)).toMatchObject({ cancel_reason: 'First' });
      const [other] = await past(s, { classId: s.otherClass });
      if (other === undefined) throw new Error('No lesson was copied.');
      const [cancelled, recorded] = await inOrder(
        s.branch,
        () => correct(s.branch, other, { kind: 'cancel' }),
        () => correct(s.branch, other, { kind: 'teacher', teacherId: s.teacher.staffId }),
      );
      changed(cancelled);
      refusedWith(recorded, 409, 'lesson_cancelled');
      expect(await rowOf(other)).toMatchObject({ teacher_id: s.otherTeacher.staffId });
    });

    it('runs a correction and a bulk cancel of the same past date one after the other, in either order', async () => {
      for (const order of [0, 1]) {
        const s = await scene();
        const lesson = await pastOne(s);
        const body = { date: FRIDAY, classIds: [s.classId], lessonNumbers: [1] };
        const looked = await t.post('/api/timetable/bulk-cancels/check', s.branch, body);
        expect(looked.status, JSON.stringify(looked.body)).toBe(200);
        const bulk = () =>
          keyed(
            '/api/timetable/bulk-cancels',
            s.branch,
            { ...body, reason: 'Excursion to the museum', blocks: [], lessonIds: [lesson] },
            t.admin,
            randomUUID(),
          );
        const fix = () => correct(s.branch, lesson, { kind: 'cancel', reason: 'Nobody came' });
        const [one, two] = await inOrder(
          s.branch,
          order === 0 ? bulk : fix,
          order === 0 ? fix : bulk,
        );
        const [bulkAnswer, fixAnswer] = order === 0 ? [one, two] : [two, one];
        if (order === 0) {
          expect(bulkAnswer.status, JSON.stringify(bulkAnswer.body)).toBe(200);
          refusedWith(fixAnswer, 409, 'lesson_cancelled');
          expect(await rowOf(lesson)).toMatchObject({
            cancel_reason: 'Excursion to the museum',
          });
        } else {
          changed(fixAnswer);
          refusedWith(bulkAnswer, 409, 'bulk_cancel_empty');
          expect(await rowOf(lesson)).toMatchObject({ cancel_reason: 'Nobody came' });
        }
      }
    });
  });
  // Task 5.6a-5a, pull request #164: the stored one-day changes applied again
  // after a publish (edge/timetable, Versions and drafts: "A substitution and a
  // one-day move are already recorded for a date after the new version
  // starts. One-day changes, absences, room closures and exams are stored on
  // their own and applied again after a publish. The preview sorts them into
  // kept, needs a decision and dropped. Publish waits until every 'needs a
  // decision' item is settled."). The substitution half of the row is 5.7b's.
  describe('one-day changes kept after a publish (task 5.6a-5a)', () => {
    interface DayItem {
      key: string;
      kind: string;
      from: { date: string; start: number };
      to: { date: string; start: number; roomId: string | null };
      blocked: { rule: string }[];
    }
    interface Days {
      key: string;
      kept: DayItem[];
      decide: DayItem[];
      dropped: DayItem[];
    }

    /**
     * A draft copied from the scene's version, its rows placed by `place`
     * (weekday and slot position, `null`: not placed; Monday's first lesson
     * when not given: a copy takes no pattern), a row's teacher changed by
     * `teacherOf`.
     */
    async function draftOf(
      s: Scene,
      place?: (row: { class_id: string | null }) => [number, number] | null,
      teacherOf?: (row: { class_id: string | null }) => string | null,
      roomOf?: (row: { class_id: string | null }) => string | null,
    ) {
      const created = await t.post('/api/timetable/versions', s.branch, {
        academicYearId: s.year,
        startsOn: MONDAY,
        copyFrom: s.version,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const version = (created.body as { id: string }).id;
      {
        await t.database.migrator
          .deleteFrom('pattern_blocks')
          .where('version_id', '=', version)
          .execute();
        const rows = await t.database.migrator
          .selectFrom('teaching_load_rows')
          .select(['id', 'class_id'])
          .where('version_id', '=', version)
          .orderBy('id')
          .execute();
        for (const row of rows) {
          const roomId = roomOf?.(row) ?? null;
          if (roomId !== null) {
            await t.database.migrator
              .updateTable('teaching_load_rows')
              .set({ room_id: roomId })
              .where('id', '=', row.id)
              .execute();
          }
          const teacher = teacherOf?.(row) ?? null;
          if (teacher !== null) {
            await t.database.migrator
              .updateTable('teaching_load_rows')
              .set({ teacher_id: teacher })
              .where('id', '=', row.id)
              .execute();
          }
        }
        for (const row of rows) {
          const at = place === undefined ? [1, 1] : place(row);
          if (at !== null) await placeAt(s.branch, version, row.id, at[0] ?? 1, at[1] ?? 1);
        }
      }
      const confirmed = await t.post(
        `/api/timetable/versions/${version}/templates/confirm`,
        s.branch,
      );
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      await load.freeEditLock(version);
      return version;
    }

    /** The kit's Academic Vice Principal, given the role in a scene's branch too. */
    const viceIn = async (branch: string) => {
      const vice = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', t.viceAssignment)
        .executeTakeFirstOrThrow();
      return load.classes.role(vice.account_id, branch, 'academic_vice_principal');
    };

    const checkOn = async (s: Scene, version: string, startsOn: string, chain?: string) => {
      const checked = await t.get(
        `/api/timetable/versions/${version}/publish-check?startsOn=${startsOn}${
          chain === undefined ? '' : `&chain=${chain}`
        }`,
        s.branch,
      );
      expect(checked.status, JSON.stringify(checked.body)).toBe(200);
      return checked.body as {
        refusals: { code: string }[];
        impact: {
          dayChanges: Days;
          changes: unknown[];
          transition: { key: string | null } | null;
          names: { rooms: { id: string }[] };
        };
      };
    };

    const publishWith = (
      s: Scene,
      version: string,
      startsOn: string,
      extra: object,
      key: string = randomUUID(),
      cookie = t.admin,
    ) =>
      request(t.kit.server)
        .post(`/api/timetable/versions/${version}/publish`)
        .set('Cookie', cookie)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, key)
        .send({ startsOn, ...extra });

    const refusals = (response: Response) => {
      refusedWith(response, 409, 'publish_blocked');
      return (response.body as { error: { details: { code: string; path: string }[] } }).error
        .details;
    };

    const endsOf = (ids: readonly string[]) =>
      ids.length === 0
        ? Promise.resolve([])
        : t.database.migrator
            .selectFrom('lesson_day_change_ends')
            .selectAll()
            .where('change_id', 'in', ids)
            .execute();

    /** The lessons of a class and subject on a date, by start. */
    const lessonsOn = (s: Scene, date: string, classId = s.classId) =>
      t.database.migrator
        .selectFrom('lessons')
        .selectAll()
        .where('class_id', '=', classId)
        .where('subject_id', '=', s.subject)
        .where('lesson_date', '=', date)
        .orderBy('starts_at')
        .execute();

    it('keeps a move and a room change recorded for a date after the start, the preview showing no change', async () => {
      const s = await scene();
      const moved = await lessonOf(s, NEXT_MONDAY);
      changed(await move(s.branch, moved.id, { date: '2026-10-21', lessonNumber: 2 }));
      const roomed = await lessonOf(s, NEXT_MONDAY, s.otherClass);
      changed(await roomChange(s.branch, roomed.id, s.spareRoom));
      const [moveRow] = await dayChangesOf(moved.id);
      const [roomRow] = await dayChangesOf(roomed.id);
      const draft = await draftOf(s);
      const answer = await checkOn(s, draft, NEXT_MONDAY);
      const days = answer.impact.dayChanges;
      expect(days.kept.map((one) => [one.key, one.kind]).sort()).toEqual(
        [
          [moveRow?.id, 'move'],
          [roomRow?.id, 'room'],
        ].sort(),
      );
      expect(days.kept.find((one) => one.kind === 'move')).toMatchObject({
        from: { date: NEXT_MONDAY, start: 480 },
        to: { date: '2026-10-21', start: 535 },
      });
      expect(days.decide).toEqual([]);
      expect(days.dropped).toEqual([]);
      // Both lessons read the same before and after: no change is shown.
      expect(answer.impact.changes).toEqual([]);
      const published = await publishWith(s, draft, NEXT_MONDAY, { dayChangesKey: days.key });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(await rowOf(moved.id)).toMatchObject({
        lesson_date: '2026-10-21',
        starts_at: at('2026-10-21', '08:55'),
      });
      expect((await rowOf(roomed.id))?.room_id).toBe(s.spareRoom);
      expect(await lessonsOn(s, NEXT_MONDAY)).toEqual([]);
      expect(await endsOf([moveRow?.id ?? '', roomRow?.id ?? ''])).toEqual([]);
      const [entry] = await t.entries('timetable_version.publish', draft);
      expect(entry?.new_value).toMatchObject({
        dayChanges: {
          kept: [moveRow?.id, roomRow?.id].sort(),
          decided: [],
          dropped: [],
          ended: [],
          recordedAgain: [],
        },
      });
      // A later publish over the same dates still finds both.
      const again = await draftOf(s);
      const later = (await checkOn(s, again, NEXT_MONDAY, 'replace')).impact.dayChanges;
      expect(later.kept.map((one) => one.key).sort()).toEqual([moveRow?.id, roomRow?.id].sort());
    });

    it('asks for a decision on a move whose new place the new version gives the teacher, and refuses until it is settled', async () => {
      const s = await scene();
      const north = await scene();
      await viceIn(s.branch);
      const moved = await lessonOf(s, NEXT_MONDAY);
      changed(await move(s.branch, moved.id, { date: '2026-10-21', lessonNumber: 2 }));
      const [moveRow] = await dayChangesOf(moved.id);
      const other = await lessonOf(s, NEXT_MONDAY, s.otherClass);
      // A one-day change of the other branch too, which the publish must leave.
      const northLesson = await lessonOf(north, NEXT_MONDAY);
      changed(await roomChange(north.branch, northLesson.id, north.spareRoom));
      const [northRow] = await dayChangesOf(northLesson.id);
      // The other class's maths goes to the first class's teacher, on
      // Wednesday in the second lesson: where the move put the first class.
      const draft = await draftOf(
        s,
        (row) => (row.class_id === s.otherClass ? [3, 3] : [1, 1]),
        (row) => (row.class_id === s.otherClass ? s.teacher.staffId : null),
      );
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      expect(days.kept).toEqual([]);
      expect(days.decide.map((one) => one.key)).toEqual([moveRow?.id]);
      expect(days.decide[0]?.blocked.map((one) => one.rule)).toContain('teacher_double');
      const before = await everything();
      // No choice.
      expect(
        refusals(await publishWith(s, draft, NEXT_MONDAY, { dayChangesKey: days.key })),
      ).toContainEqual(
        expect.objectContaining({
          code: 'day_change_undecided',
          path: `dayChanges.${moveRow?.id ?? ''}`,
        }),
      );
      // A choice for a lesson of the branch that is no such item.
      const unknown = refusals(
        await publishWith(s, draft, NEXT_MONDAY, {
          dayChangesKey: days.key,
          dayDecisions: [
            { key: moveRow?.id, choice: 'drop' },
            { key: other.id, choice: 'drop' },
          ],
        }),
      );
      expect(unknown.map((one) => one.code)).toEqual(['day_decision_unknown']);
      // A sorting other than the one shown.
      expect(
        refusals(
          await publishWith(s, draft, NEXT_MONDAY, {
            dayChangesKey: 'c'.repeat(64),
            dayDecisions: [{ key: moveRow?.id, choice: 'drop' }],
          }),
        ).map((one) => one.code),
      ).toEqual(['day_changes_changed']);
      // Another branch's lesson and change, and an unknown key: 404, before
      // any lock, as the Academic Vice Principal and the Super Admin.
      for (const cookie of [t.vicePrincipal, t.admin]) {
        for (const key of [northLesson.id, northRow?.id ?? '', UNKNOWN]) {
          refusedWith(
            await publishWith(
              s,
              draft,
              NEXT_MONDAY,
              {
                dayChangesKey: days.key,
                dayDecisions: [
                  { key: moveRow?.id, choice: 'drop' },
                  { key, choice: 'cancel' },
                ],
              },
              randomUUID(),
              cookie,
            ),
            404,
            'not_found',
          );
        }
      }
      expect(await everything()).toEqual(before);
      const published = await publishWith(
        s,
        draft,
        NEXT_MONDAY,
        { dayChangesKey: days.key, dayDecisions: [{ key: moveRow?.id, choice: 'drop' }] },
        randomUUID(),
        t.vicePrincipal,
      );
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      // Dropped: the first class's maths is back on Monday at 08:00, held, and
      // nothing is left on Wednesday at 08:55; the change is ended.
      const back = await lessonsOn(s, NEXT_MONDAY);
      expect(back.map((one) => [one.starts_at, one.cancel_cause])).toEqual([
        [at(NEXT_MONDAY, '08:00'), null],
      ]);
      expect(await lessonsOn(s, '2026-10-21')).toEqual([]);
      expect((await endsOf([moveRow?.id ?? ''])).map((one) => one.version_id)).toEqual([draft]);
      const [entry] = await t.entries('timetable_version.publish', draft);
      expect(entry?.new_value).toMatchObject({
        dayChanges: {
          kept: [],
          decided: [{ key: moveRow?.id, choice: 'drop' }],
          ended: [moveRow?.id],
        },
      });
      // The teacher whose Wednesday lesson went back to Monday is told.
      const draftNumber = (
        await t.database.migrator
          .selectFrom('timetable_versions')
          .select('number')
          .where('id', '=', draft)
          .executeTakeFirstOrThrow()
      ).number;
      const notices = await t.database.migrator
        .selectFrom('notifications')
        .select('data')
        .where('kind', '=', 'timetable.published')
        .where('account_id', '=', s.teacher.accountId)
        .execute();
      expect(
        notices.filter((one) => (one.data as { number?: string }).number === String(draftNumber)),
      ).toHaveLength(1);
    });

    it('cancels the lesson that day when chosen, and a later publish asks nothing of the change', async () => {
      const s = await scene();
      const moved = await lessonOf(s, NEXT_MONDAY);
      changed(
        await move(
          s.branch,
          moved.id,
          { date: '2026-10-21', lessonNumber: 2 },
          t.admin,
          randomUUID(),
          'Concert rehearsal',
        ),
      );
      const [moveRow] = await dayChangesOf(moved.id);
      const draft = await draftOf(
        s,
        (row) => (row.class_id === s.otherClass ? [3, 3] : [1, 1]),
        (row) => (row.class_id === s.otherClass ? s.teacher.staffId : null),
      );
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      const published = await publishWith(s, draft, NEXT_MONDAY, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: moveRow?.id, choice: 'cancel' }],
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      const back = await lessonsOn(s, NEXT_MONDAY);
      expect(back.map((one) => [one.starts_at, one.cancel_cause, one.cancel_reason])).toEqual([
        [at(NEXT_MONDAY, '08:00'), 'reason', 'Concert rehearsal'],
      ]);
      expect(await lessonsOn(s, '2026-10-21')).toEqual([]);
      expect(await endsOf([moveRow?.id ?? ''])).toHaveLength(1);
      // The next publish lists the cancel, kept, and nothing of the move.
      const again = await draftOf(s);
      const later = (await checkOn(s, again, NEXT_MONDAY, 'replace')).impact.dayChanges;
      expect(later.decide).toEqual([]);
      expect(later.kept.map((one) => [one.kind, one.key])).toEqual([['cancel', back[0]?.id]]);
    });

    it('drops a change whose lesson the new version no longer has, and never applies it again', async () => {
      const s = await scene();
      const moved = await lessonOf(s, NEXT_MONDAY);
      changed(await move(s.branch, moved.id, { date: '2026-10-21', lessonNumber: 2 }));
      const [moveRow] = await dayChangesOf(moved.id);
      // The first class's maths goes to Tuesday.
      const draft = await draftOf(s, (row) => (row.class_id === s.classId ? [2, 1] : [1, 1]));
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      expect(days.dropped.map((one) => one.key)).toEqual([moveRow?.id]);
      expect(days.kept).toEqual([]);
      const published = await publishWith(s, draft, NEXT_MONDAY, { dayChangesKey: days.key });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(await rowOf(moved.id)).toBeUndefined();
      expect(await lessonsOn(s, '2026-10-21')).toEqual([]);
      expect(await endsOf([moveRow?.id ?? ''])).toHaveLength(1);
      // A version that has the Monday lesson again does not move it.
      const again = await draftOf(s, () => [1, 1]);
      const later = (await checkOn(s, again, NEXT_MONDAY, 'replace')).impact.dayChanges;
      expect([...later.kept, ...later.decide, ...later.dropped]).toEqual([]);
    });

    it('keeps a move to a date before the start where it is, and does not write the lesson twice', async () => {
      const s = await scene();
      const moved = await lessonOf(s, NEXT_MONDAY);
      changed(await move(s.branch, moved.id, { date: '2026-10-16', lessonNumber: 2 }));
      const [moveRow] = await dayChangesOf(moved.id);
      const draft = await draftOf(s);
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      expect(days.kept.map((one) => one.key)).toEqual([moveRow?.id]);
      const published = await publishWith(s, draft, NEXT_MONDAY, { dayChangesKey: days.key });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(await lessonsOn(s, NEXT_MONDAY)).toEqual([]);
      expect(await rowOf(moved.id)).toMatchObject({ lesson_date: '2026-10-16' });
      // The Monday after is written as the new version has it.
      expect(await lessonsOn(s, '2026-10-26')).toHaveLength(1);
    });

    it('keeps a move from a date before the start under its version, or settles it when the new version takes its place', async () => {
      for (const choice of ['kept', 'drop', 'cancel'] as const) {
        const s = await scene();
        const moved = await lessonOf(s, MONDAY);
        changed(await move(s.branch, moved.id, { date: '2026-10-14', lessonNumber: 2 }));
        const [moveRow] = await dayChangesOf(moved.id);
        const draft =
          choice === 'kept'
            ? await draftOf(s)
            : await draftOf(
                s,
                (row) => (row.class_id === s.otherClass ? [3, 3] : [1, 1]),
                (row) => (row.class_id === s.otherClass ? s.teacher.staffId : null),
              );
        const checked = await checkOn(s, draft, '2026-10-13');
        const days = checked.impact.dayChanges;
        // The start is a Tuesday: the week differs, and a "cancel" goes with
        // the key the check showed (review of the plan, must-fix 3).
        if (choice === 'cancel') expect(checked.impact.transition?.key).toMatch(/^[0-9a-f]{64}$/);
        const decisions = choice === 'kept' ? [] : [{ key: moveRow?.id ?? '', choice }];
        expect((choice === 'kept' ? days.kept : days.decide).map((one) => one.key)).toEqual([
          moveRow?.id,
        ]);
        const published = await publishWith(s, draft, '2026-10-13', {
          dayChangesKey: days.key,
          dayDecisions: decisions,
          ...(checked.impact.transition?.key == null
            ? {}
            : { transitionKey: checked.impact.transition.key }),
        });
        expect(published.status, JSON.stringify(published.body)).toBe(200);
        const row = await rowOf(moved.id);
        if (choice === 'drop') {
          expect(row).toBeUndefined();
          continue;
        }
        expect(row).toMatchObject({
          lesson_date: '2026-10-14',
          starts_at: at('2026-10-14', '08:55'),
          cancel_cause: choice === 'cancel' ? 'reason' : null,
        });
        // Kept under the version it was moved in.
        const block = await t.database.migrator
          .selectFrom('lesson_blocks')
          .select('version_id')
          .where('id', '=', row?.block_id ?? '')
          .executeTakeFirstOrThrow();
        expect(block.version_id).toBe(s.version);
      }
    });

    it('moves a block with a part cancelled along, the part still cancelled', async () => {
      const s = await scene({ split: true });
      const parts = await t.database.migrator
        .selectFrom('lessons')
        .selectAll()
        .where('subject_id', '=', s.english ?? '')
        .where('lesson_date', '=', '2026-10-21')
        .orderBy('id')
        .execute();
      const [first, second] = parts;
      changed(await cancel(s.branch, first?.id ?? ''));
      changed(await move(s.branch, second?.id ?? '', { date: '2026-10-22', lessonNumber: 2 }));
      // The split's first row places the block of both groups, as the scene does.
      let split = false;
      const draft = await draftOf(s, (row) => {
        if (row.class_id !== null) return [1, 1];
        if (split) return null;
        split = true;
        return [3, 1];
      });
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      expect(days.kept.map((one) => one.kind)).toEqual(['move']);
      const published = await publishWith(s, draft, NEXT_MONDAY, { dayChangesKey: days.key });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(await rowOf(first?.id ?? '')).toMatchObject({
        lesson_date: '2026-10-22',
        cancel_cause: 'reason',
      });
      expect(await rowOf(second?.id ?? '')).toMatchObject({
        lesson_date: '2026-10-22',
        cancel_cause: null,
      });
    });

    it('asks for a decision on a room change whose room the new version gives another lesson, and drops one into the room it already gives', async () => {
      for (const roomFor of ['first', 'same'] as const) {
        const s = await scene();
        const roomed = await lessonOf(s, NEXT_MONDAY, s.otherClass);
        changed(await roomChange(s.branch, roomed.id, s.spareRoom));
        const [roomRow] = await dayChangesOf(roomed.id);
        // `first`: the first class's maths in the spare room at the same time;
        // `same`: the other class's maths in the spare room itself.
        const draft = await draftOf(s, undefined, undefined, (row) =>
          (roomFor === 'first' ? row.class_id === s.classId : row.class_id === s.otherClass)
            ? s.spareRoom
            : null,
        );
        const answer = await checkOn(s, draft, NEXT_MONDAY);
        const days = answer.impact.dayChanges;
        // The room the change names is named by the preview (permission review, should-fix 6).
        expect(answer.impact.names.rooms.map((one) => one.id)).toContain(s.spareRoom);
        if (roomFor === 'same') {
          expect(days.dropped.map((one) => one.key)).toEqual([roomRow?.id]);
          continue;
        }
        expect(days.decide.map((one) => one.key)).toEqual([roomRow?.id]);
        expect(days.decide[0]?.blocked.map((one) => one.rule)).toContain('room_double');
        const published = await publishWith(s, draft, NEXT_MONDAY, {
          dayChangesKey: days.key,
          dayDecisions: [{ key: roomRow?.id, choice: 'drop' }],
        });
        expect(published.status, JSON.stringify(published.body)).toBe(200);
        expect((await rowOf(roomed.id))?.room_id).toBe(s.otherRoom);
        expect(await endsOf([roomRow?.id ?? ''])).toHaveLength(1);
      }
    });

    it('keeps a move onto a date a later availability entry leaves out, availability being a warning there', async () => {
      const s = await scene();
      const moved = await lessonOf(s, NEXT_MONDAY);
      changed(await move(s.branch, moved.id, { date: '2026-10-21', lessonNumber: 2 }));
      const [moveRow] = await dayChangesOf(moved.id);
      // From 20 October the teacher comes at 10:00 only: the entry before ends.
      // Its ranges follow (`staff_availability_ranges_entry_fkey`, on update cascade).
      await t.database.migrator
        .updateTable('staff_availability')
        .set({ valid_until: '2026-10-20' })
        .where('staff_id', '=', s.teacher.staffId)
        .execute();
      await hours(s.branch, s.teacher.staffId, '2026-10-20', 600);
      const draft = await draftOf(s);
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      expect(days.kept.map((one) => one.key)).toEqual([moveRow?.id]);
      expect(days.decide).toEqual([]);
    });

    it('cancels only the lesson a decision names, never a lesson moved onto the same weekday a week later (spec review of the code, must-fix 1)', async () => {
      const s = await scene();
      // The first class's maths of 19 October moved to 26 October, third lesson.
      const moved = await lessonOf(s, NEXT_MONDAY);
      changed(await move(s.branch, moved.id, { date: '2026-10-26', lessonNumber: 3 }));
      // Its own maths of 26 October, first lesson, to the spare room.
      const own = (await lessonsOn(s, '2026-10-26'))[0];
      expect(own?.starts_at).toEqual(at('2026-10-26', '08:00'));
      changed(await roomChange(s.branch, own?.id ?? '', s.spareRoom));
      const [roomRow] = await dayChangesOf(own?.id ?? '');
      // The new version puts the other class in the spare room at that time.
      const draft = await draftOf(s, undefined, undefined, (row) =>
        row.class_id === s.otherClass ? s.spareRoom : null,
      );
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      expect(days.decide.map((one) => one.key)).toEqual([roomRow?.id]);
      expect(days.kept.map((one) => one.kind)).toEqual(['move']);
      const published = await publishWith(s, draft, NEXT_MONDAY, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: roomRow?.id, choice: 'cancel' }],
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      const after = await lessonsOn(s, '2026-10-26');
      expect(after.map((one) => [one.id, one.starts_at, one.cancel_cause])).toEqual([
        [own?.id, at('2026-10-26', '08:00'), 'reason'],
        [moved.id, at('2026-10-26', '09:50'), null],
      ]);
    });

    it('reads a room change and then a move of one lesson as one move, from its first place to its last', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, NEXT_MONDAY);
      changed(await roomChange(s.branch, lesson.id, s.spareRoom));
      changed(await move(s.branch, lesson.id, { date: '2026-10-21', lessonNumber: 2 }));
      const rows = await dayChangesOf(lesson.id);
      expect(rows).toHaveLength(2);
      const draft = await draftOf(s);
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      expect(days.kept).toHaveLength(1);
      expect(days.kept[0]).toMatchObject({
        key: rows[0]?.id,
        kind: 'move',
        from: { date: NEXT_MONDAY, start: 480 },
        to: { date: '2026-10-21', start: 535, roomId: s.spareRoom },
      });
      const published = await publishWith(s, draft, NEXT_MONDAY, { dayChangesKey: days.key });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(await rowOf(lesson.id)).toMatchObject({
        lesson_date: '2026-10-21',
        room_id: s.spareRoom,
      });
    });

    it('moves both halves of a double together and keeps them so', async () => {
      const s = await scene({ twoLessons: true });
      const first = await lessonOf2(s, NEXT_MONDAY, 0);
      const second = await lessonOf2(s, NEXT_MONDAY, 1);
      // The two lessons made a double, as the other double tests make them.
      const blocks = await t.database.migrator
        .selectFrom('lessons')
        .select('block_id')
        .where('id', 'in', [first, second])
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
      changed(await move(s.branch, first, { date: '2026-10-21', lessonNumber: 1 }));
      expect((await rowOf(second))?.lesson_date).toBe('2026-10-21');
      // The copy places the first class's maths in the first and second lessons of Monday.
      let placed = 0;
      const draft = await draftOf(s, (row) => {
        if (row.class_id !== s.classId) return [1, 1];
        placed += 1;
        return [1, 1];
      });
      // A second lesson of the row in the third slot of Monday, as the scene places it.
      const rows = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', draft)
        .where('class_id', '=', s.classId)
        .execute();
      expect(placed).toBe(1);
      await placeAt(s.branch, draft, rows[0]?.id ?? '', 1, 3);
      await load.freeEditLock(draft);
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      expect(days.kept.map((one) => one.kind)).toEqual(['move']);
      const published = await publishWith(s, draft, NEXT_MONDAY, { dayChangesKey: days.key });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(await rowOf(first)).toMatchObject({
        lesson_date: '2026-10-21',
        starts_at: at('2026-10-21', '08:00'),
      });
      expect(await rowOf(second)).toMatchObject({
        lesson_date: '2026-10-21',
        starts_at: at('2026-10-21', '08:55'),
      });
      expect(await lessonsOn(s, NEXT_MONDAY)).toEqual([]);
    });

    /** The draft's load row of the first class, placed no more as a double. */
    const singleRowOf = async (draft: string, s: Scene) => {
      const row = await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ double_lessons: false })
        .where('version_id', '=', draft)
        .where('class_id', '=', s.classId)
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    };

    it('keeps the older of two moves that clash only with each other, and asks for a decision on the newer (decision 6, review of the code)', async () => {
      const s = await scene({ twoLessons: true });
      // The first class's second maths of Monday (08:55, its teacher) and the
      // other class's maths (08:00, the other teacher) both to Wednesday's
      // second lesson, rooms and teachers apart: both pass under the old version.
      const older = await lessonOf2(s, NEXT_MONDAY, 1);
      changed(await move(s.branch, older, { date: '2026-10-21', lessonNumber: 2 }));
      // The items are the changes of one request: one person’s rows of one
      // moment. The second move is a second later, a request of its own.
      const newer = await lessonOf(s, NEXT_MONDAY, s.otherClass);
      t.clock.advance(1000);
      try {
        changed(await move(s.branch, newer.id, { date: '2026-10-21', lessonNumber: 2 }));
      } finally {
        t.clock.set(START);
      }
      const [olderRow] = await dayChangesOf(older);
      const [newerRow] = await dayChangesOf(newer.id);
      // The draft gives the other class's maths the first class's teacher at
      // Monday 08:00, and the first class's maths Monday 08:55 and 09:50: the
      // pattern has no clash, the Wednesday only one between the two moves.
      const draft = await draftOf(
        s,
        (row) => (row.class_id === s.otherClass ? [1, 1] : [1, 3]),
        (row) => (row.class_id === s.otherClass ? s.teacher.staffId : null),
      );
      await placeAt(s.branch, draft, await singleRowOf(draft, s), 1, 5);
      await load.freeEditLock(draft);
      const answer = await checkOn(s, draft, NEXT_MONDAY);
      expect(answer.refusals).toEqual([]);
      const days = answer.impact.dayChanges;
      expect(days.kept.map((one) => one.key)).toEqual([olderRow?.id]);
      expect(days.decide.map((one) => one.key)).toEqual([newerRow?.id]);
      expect(days.decide[0]?.blocked.map((one) => one.rule)).toContain('teacher_double');
      expect(days.dropped).toEqual([]);
      const published = await publishWith(s, draft, NEXT_MONDAY, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: newerRow?.id, choice: 'drop' }],
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(await rowOf(older)).toMatchObject({
        lesson_date: '2026-10-21',
        starts_at: at('2026-10-21', '08:55'),
        teacher_id: s.teacher.staffId,
      });
      expect(
        (await lessonsOn(s, NEXT_MONDAY, s.otherClass)).map((one) => [
          one.starts_at,
          one.teacher_id,
          one.cancel_cause,
        ]),
      ).toEqual([[at(NEXT_MONDAY, '08:00'), s.teacher.staffId, null]]);
      expect(await lessonsOn(s, '2026-10-21', s.otherClass)).toEqual([]);
      expect(await endsOf([newerRow?.id ?? ''])).toHaveLength(1);
      expect(await endsOf([olderRow?.id ?? ''])).toEqual([]);
      // The teacher holds one lesson at a time on both dates.
      const taught = await t.database.migrator
        .selectFrom('lessons')
        .select('starts_at')
        .where('teacher_id', '=', s.teacher.staffId)
        .where('lesson_date', 'in', [NEXT_MONDAY, '2026-10-21'])
        .where('cancel_cause', 'is', null)
        .execute();
      const starts = taught.map((one) => one.starts_at.toISOString());
      expect(new Set(starts).size).toBe(starts.length);
    });

    it('asks for a decision on a double moved whose old place the new version keeps only one half of (review of the code)', async () => {
      for (const choice of ['drop', 'cancel'] as const) {
        const s = await scene({ twoLessons: true });
        const first = await lessonOf2(s, NEXT_MONDAY, 0);
        const second = await lessonOf2(s, NEXT_MONDAY, 1);
        const blocks = await t.database.migrator
          .selectFrom('lessons')
          .select('block_id')
          .where('id', 'in', [first, second])
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
        changed(
          await move(
            s.branch,
            first,
            { date: '2026-10-21', lessonNumber: 1 },
            t.admin,
            randomUUID(),
            'Concert rehearsal',
          ),
        );
        const rows = [...(await dayChangesOf(first)), ...(await dayChangesOf(second))];
        expect(rows).toHaveLength(2);
        // The draft keeps the first half on Monday 08:00 and puts the second
        // on Tuesday: the old place holds one of the two lessons moved.
        const draft = await draftOf(s);
        await placeAt(s.branch, draft, await singleRowOf(draft, s), 2, 1);
        await load.freeEditLock(draft);
        const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
        expect(days.kept).toEqual([]);
        expect(days.dropped).toEqual([]);
        expect(days.decide.map((one) => one.kind)).toEqual(['move']);
        const key = days.decide[0]?.key ?? '';
        expect(rows.map((one) => one.id)).toContain(key);
        expect(
          refusals(await publishWith(s, draft, NEXT_MONDAY, { dayChangesKey: days.key })),
        ).toContainEqual(
          expect.objectContaining({ code: 'day_change_undecided', path: `dayChanges.${key}` }),
        );
        const published = await publishWith(s, draft, NEXT_MONDAY, {
          dayChangesKey: days.key,
          dayDecisions: [{ key, choice }],
        });
        expect(published.status, JSON.stringify(published.body)).toBe(200);
        // Nothing is left on Wednesday; Monday holds the new version's lesson,
        // cancelled with the change's reason when chosen; both rows are ended.
        expect(await lessonsOn(s, '2026-10-21')).toEqual([]);
        expect(
          (await lessonsOn(s, NEXT_MONDAY)).map((one) => [
            one.starts_at,
            one.cancel_cause,
            one.cancel_reason,
          ]),
        ).toEqual([
          choice === 'drop'
            ? [at(NEXT_MONDAY, '08:00'), null, null]
            : [at(NEXT_MONDAY, '08:00'), 'reason', 'Concert rehearsal'],
        ]);
        expect(await lessonsOn(s, '2026-10-20')).toHaveLength(1);
        expect(await endsOf(rows.map((one) => one.id))).toHaveLength(2);
      }
    });

    it('leaves a lesson of a bulk cancel out of the sorting, listed once under its bulk cancel (task 5.6a-5b-1)', async () => {
      const s = await scene();
      const body = { date: NEXT_MONDAY, classIds: [s.classId], lessonNumbers: [1] };
      const listed = await t.post('/api/timetable/bulk-cancels/check', s.branch, body);
      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      const saved = await keyed(
        '/api/timetable/bulk-cancels',
        s.branch,
        {
          ...body,
          reason: 'Excursion to the museum',
          blocks: [],
          lessonIds: (listed.body as { cancel: { lesson: { id: string } }[] }).cancel.map(
            (one) => one.lesson.id,
          ),
        },
        t.admin,
        randomUUID(),
      );
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      // A one-day cancel of the other class, no bulk cancel's, is listed.
      const other = await lessonOf(s, NEXT_MONDAY, s.otherClass);
      changed(await cancel(s.branch, other.id));
      const draft = await draftOf(s);
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      expect([...days.kept, ...days.decide, ...days.dropped].map((one) => one.key)).toEqual([
        other.id,
      ]);
      expect(
        (days as Days & { bulk: { key: string; category: string }[] }).bulk.map((one) => [
          one.key,
          one.category,
        ]),
      ).toEqual([[(saved.body as { id: string }).id, 'kept']]);
    });

    it('needs no key and no decision when no one-day change is stored', async () => {
      const s = await scene();
      const draft = await draftOf(s);
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      expect([...days.kept, ...days.decide, ...days.dropped]).toEqual([]);
      const published = await publishWith(s, draft, NEXT_MONDAY, {});
      expect(published.status, JSON.stringify(published.body)).toBe(200);
    });

    it("answers a repeat of a used request key with another branch's key 404 and from a role the route refuses 403", async () => {
      const s = await scene();
      const north = await scene();
      const draft = await draftOf(s);
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      const key = randomUUID();
      const published = await publishWith(s, draft, NEXT_MONDAY, { dayChangesKey: days.key }, key);
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      const northLesson = await lessonOf(north, NEXT_MONDAY);
      for (const unknownKey of [northLesson.id, UNKNOWN]) {
        refusedWith(
          await publishWith(
            s,
            draft,
            NEXT_MONDAY,
            { dayChangesKey: days.key, dayDecisions: [{ key: unknownKey, choice: 'drop' }] },
            key,
          ),
          404,
          'not_found',
        );
      }
      refusedWith(
        await publishWith(s, draft, NEXT_MONDAY, { dayChangesKey: days.key }, key, t.principal),
        403,
        'permission_denied',
      );
    });
  });

  // Task 5.6a-5b-2: a withdraw sorts and applies the stored one-day changes of
  // the withdrawn dates as a publish does (decision 1; edge/timetable,
  // Versions and drafts: "One-day changes, absences, room closures and exams
  // are stored on their own and applied again after a publish. The preview
  // sorts them into kept, needs a decision and dropped."; 06, How surprises
  // are prevented: "Withdraw. A published version can be withdrawn only
  // before its start date.").
  describe('one-day changes kept after a withdraw (task 5.6a-5b-2)', () => {
    interface DayItem {
      key: string;
      kind: string;
      from: { date: string; start: number };
      to: { date: string; start: number; roomId: string | null };
      blocked: { rule: string }[];
    }
    interface WithdrawChecked {
      runsAgain: { id: string; number: number } | null;
      runsAgainUntil: string | null;
      dayChanges: { key: string; kept: DayItem[]; decide: DayItem[]; dropped: DayItem[] };
      names: { units: { id: string }[]; rooms: { id: string }[] };
    }

    /** The Monday two weeks after `MONDAY`, the start of the version withdrawn. */
    const WEEK3 = '2026-10-26';
    /** Its Wednesday. */
    const WEDNESDAY3 = '2026-10-28';
    /** The first Monday of the second quarter, after the autumn vacation. */
    const WEEK4 = '2026-11-09';
    /** The Monday after it. */
    const WEEK5 = '2026-11-16';

    /**
     * A copy of the scene's version, its rows placed by `place` (weekday and
     * slot position; Monday's first lesson when not given), a row's teacher
     * changed by `teacherOf`.
     */
    async function copyOf(
      s: Scene,
      place?: (row: { class_id: string | null }) => [number, number],
      teacherOf?: (row: { class_id: string | null }) => string | null,
    ) {
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
        .select(['id', 'class_id'])
        .where('version_id', '=', version)
        .orderBy('id')
        .execute();
      for (const row of rows) {
        const teacher = teacherOf?.(row) ?? null;
        if (teacher !== null) {
          await t.database.migrator
            .updateTable('teaching_load_rows')
            .set({ teacher_id: teacher })
            .where('id', '=', row.id)
            .execute();
        }
        const [weekday, slot] = place?.(row) ?? [1, 1];
        await placeAt(s.branch, version, row.id, weekday, slot);
      }
      const confirmed = await t.post(
        `/api/timetable/versions/${version}/templates/confirm`,
        s.branch,
      );
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      await load.freeEditLock(version);
      return version;
    }

    /** A publish from `startsOn` with the key of the one-day changes its check shows. */
    async function published(s: Scene, version: string, startsOn: string) {
      const checked = await t.get(
        `/api/timetable/versions/${version}/publish-check?startsOn=${startsOn}`,
        s.branch,
      );
      expect(checked.status, JSON.stringify(checked.body)).toBe(200);
      const key = (checked.body as { impact: { dayChanges: { key: string } } }).impact.dayChanges
        .key;
      const answer = await request(t.kit.server)
        .post(`/api/timetable/versions/${version}/publish`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ startsOn, dayChangesKey: key });
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      return version;
    }

    /**
     * The scene's version from 12 October, A (a copy placed by `a`) from 19
     * October and B (a copy placed by `b`) from 26 October, the version withdrawn.
     */
    async function chain(
      input: {
        a?: (s: Scene) => Parameters<typeof copyOf>[1];
        aTeacher?: (s: Scene) => Parameters<typeof copyOf>[2];
        b?: (s: Scene) => Parameters<typeof copyOf>[1];
        /** Run while A is in force and before B is published: a move recorded then. */
        beforeB?: (s: Scene) => Promise<void>;
      } = {},
    ) {
      const s = await scene();
      const a = await published(s, await copyOf(s, input.a?.(s), input.aTeacher?.(s)), NEXT_MONDAY);
      await input.beforeB?.(s);
      const b = await published(s, await copyOf(s, input.b?.(s)), WEEK3);
      return { s, a, b };
    }

    const checkOf = async (s: Scene, version: string, cookie = t.admin) => {
      const answer = await t.get(
        `/api/timetable/versions/${version}/withdraw-check`,
        s.branch,
        cookie,
      );
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      return answer.body as WithdrawChecked;
    };

    const withdrawWith = (
      s: Scene,
      version: string,
      body: object | undefined,
      key: string = randomUUID(),
      cookie = t.admin,
    ) =>
      request(t.kit.server)
        .post(`/api/timetable/versions/${version}/withdraw`)
        .set('Cookie', cookie)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, key)
        .send(body);

    const refusals = (response: Response) => {
      refusedWith(response, 409, 'withdraw_blocked');
      return (response.body as { error: { details: { code: string; path: string }[] } }).error
        .details;
    };

    const endsOf = (ids: readonly string[]) =>
      t.database.migrator
        .selectFrom('lesson_day_change_ends')
        .selectAll()
        .where('change_id', 'in', [...ids, UNKNOWN])
        .orderBy('change_id')
        .execute();

    /** The lessons of a class and the scene's subject on a date, by start, with their block's version. */
    const lessonsOn = (s: Scene, date: string, classId = s.classId) =>
      t.database.migrator
        .selectFrom('lessons')
        .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
        .selectAll('lessons')
        .select('lesson_blocks.version_id')
        .where('lessons.class_id', '=', classId)
        .where('lessons.subject_id', '=', s.subject)
        .where('lessons.lesson_date', '=', date)
        .orderBy('lessons.starts_at')
        .execute();

    /**
     * Permission review must-fix 2 and should-fix 5: a room change of the
     * north scene's maths of 19 October and a bulk cancel's choice on its
     * block, rows of another branch a withdraw must leave; their ids.
     */
    async function northStored() {
      const lesson = await lessonOf(northScene, NEXT_MONDAY);
      changed(
        await roomChange(northScene.branch, lesson.id, await load.classes.room(northScene.branch)),
      );
      const rows = await dayChangesOf(lesson.id);
      const bulk = await t.database.migrator
        .insertInto('bulk_cancels')
        .values({
          branch_id: northScene.branch,
          cancel_date: NEXT_MONDAY,
          lesson_numbers: [1],
          reason: 'Excursion to the museum',
          changed_at: new Date(START),
          changed_by: (
            await t.database.migrator
              .selectFrom('accounts')
              .select('id')
              .orderBy('id')
              .executeTakeFirstOrThrow()
          ).id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('bulk_cancel_blocks')
        .values({
          branch_id: northScene.branch,
          bulk_cancel_id: bulk.id,
          block_id: lesson.block_id,
          choice: 'keep',
          lesson_date: NEXT_MONDAY,
          starts_at: lesson.starts_at,
          ends_at: lesson.ends_at,
        })
        .execute();
      const block = await t.database.migrator
        .selectFrom('pattern_blocks')
        .select('id')
        .where('version_id', '=', northScene.version)
        .orderBy('id')
        .executeTakeFirstOrThrow();
      return {
        lesson: lesson.id,
        change: rows.at(-1)?.id ?? '',
        bulk: bulk.id,
        block: block.id,
      };
    }

    const statusOf = async (version: string) =>
      (
        await t.database.migrator
          .selectFrom('timetable_versions')
          .select('status')
          .where('id', '=', version)
          .executeTakeFirstOrThrow()
      ).status;

    /**
     * From `from` the scene's first teacher works every weekday but
     * Wednesday, or with `start` every weekday from that minute.
     */
    async function noWednesdays(s: Scene, from: string, start: number | null = null) {
      for (const table of ['staff_availability', 'staff_availability_ranges'] as const) {
        await t.database.migrator
          .updateTable(table)
          .set({ valid_until: from })
          .where('staff_id', '=', s.teacher.staffId)
          .where('branch_id', '=', s.branch)
          .execute();
      }
      const entry = await t.database.migrator
        .insertInto('staff_availability')
        .values({ branch_id: s.branch, staff_id: s.teacher.staffId, valid_from: from })
        .returning(['id', 'valid_until'])
        .executeTakeFirstOrThrow();
      for (const weekday of start === null ? [1, 2, 4, 5] : [1, 2, 3, 4, 5]) {
        await t.database.migrator
          .insertInto('staff_availability_ranges')
          .values({
            entry_id: entry.id,
            branch_id: s.branch,
            staff_id: s.teacher.staffId,
            weekday,
            start_minutes: start ?? 0,
            end_minutes: 1440,
            valid_from: from,
            valid_until: entry.valid_until,
          })
          .execute();
      }
    }

    it('keeps a move from before the withdrawn start under its version (Done when)', async () => {
      // A's lesson of Monday 19 October moved to Wednesday 28 October while
      // A ran there; B's publish from 26 October kept the move (5.6a-5a decision 7).
      let movedId = '';
      const { s, a, b } = await chain({
        beforeB: async (scene) => {
          movedId = (await lessonOf(scene, NEXT_MONDAY)).id;
          changed(await move(scene.branch, movedId, { date: WEDNESDAY3, lessonNumber: 2 }));
        },
      });
      const moved = { id: movedId };
      expect((await lessonsOn(s, WEDNESDAY3)).map((one) => [one.id, one.version_id])).toEqual([
        [moved.id, a],
      ]);
      const [row] = await dayChangesOf(moved.id);
      const checked = await checkOf(s, b);
      expect(checked.runsAgain).toMatchObject({ id: a });
      expect(checked.dayChanges.kept.map((one) => [one.key, one.kind])).toEqual([
        [row?.id, 'move'],
      ]);
      expect(checked.dayChanges.decide).toEqual([]);
      expect(checked.dayChanges.dropped).toEqual([]);
      expect(checked.names.units.map((one) => one.id)).toContain(s.classId);
      // Without the key of the sorting, refused.
      expect(refusals(await withdrawWith(s, b, {})).map((one) => one.code)).toEqual([
        'day_changes_changed',
      ]);
      const answer = await withdrawWith(s, b, { dayChangesKey: checked.dayChanges.key });
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      // The moved lesson stays where the move put it, under A, its change in force.
      expect(await rowOf(moved.id)).toMatchObject({
        lesson_date: WEDNESDAY3,
        starts_at: at(WEDNESDAY3, '08:55'),
        cancel_cause: null,
      });
      expect((await lessonsOn(s, WEDNESDAY3)).map((one) => [one.id, one.version_id])).toEqual([
        [moved.id, a],
      ]);
      expect(await endsOf([row?.id ?? ''])).toEqual([]);
      const [entry] = await t.entries('timetable_version.withdraw', b);
      expect(entry?.new_value).toMatchObject({
        dayChanges: { kept: [row?.id], decided: [], dropped: [], ended: [] },
      });
    });

    it('keeps a move inside the withdrawn dates on the version that runs again, the check and the withdraw agreeing', async () => {
      const { s, b } = await chain();
      const moved = await lessonOf(s, WEEK3);
      changed(await move(s.branch, moved.id, { date: WEDNESDAY3, lessonNumber: 2 }));
      const [row] = await dayChangesOf(moved.id);
      const before = await everything();
      const checked = await checkOf(s, b);
      // The check writes nothing.
      expect(await everything()).toEqual(before);
      expect(checked.dayChanges.kept.map((one) => one.key)).toEqual([row?.id]);
      const answer = await withdrawWith(s, b, { dayChangesKey: checked.dayChanges.key });
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      // The first class's maths of 26 October is on Wednesday 28 October in lesson 2.
      expect(await lessonsOn(s, WEEK3)).toEqual([]);
      // The version that runs again has the lesson at the moved place, so the
      // pairing keeps the stored lesson (an unchanged lesson keeps its
      // identity) and its change stays in force, not ended, not recorded again.
      expect(await lessonsOn(s, WEDNESDAY3)).toEqual([
        expect.objectContaining({
          id: moved.id,
          starts_at: at(WEDNESDAY3, '08:55'),
          cancel_cause: null,
        }),
      ]);
      expect(await endsOf([row?.id ?? ''])).toEqual([]);
      const [entry] = await t.entries('timetable_version.withdraw', b);
      expect(entry?.new_value).toMatchObject({
        dayChanges: { kept: [row?.id], dropped: [], ended: [], recordedAgain: [] },
      });
    });

    it('drops and ends a room change on a lesson the version that runs again lacks, keeps a cancel on one it has and drops one on a lesson it removes', async () => {
      // B has the other class's maths on Tuesday; A, as the scene, on Monday.
      const { s, b } = await chain({
        b: (scene) => (row) => (row.class_id === scene.otherClass ? [2, 1] : [1, 1]),
      });
      const tuesday = '2026-10-27';
      const roomed = await lessonOf(s, tuesday, s.otherClass);
      changed(await roomChange(s.branch, roomed.id, s.spareRoom));
      const [roomRow] = await dayChangesOf(roomed.id);
      const kept = await lessonOf(s, WEEK3);
      changed(await cancel(s.branch, kept.id, 'Excursion to the zoo'));
      const lost = await lessonOf(s, '2026-11-10', s.otherClass);
      changed(await cancel(s.branch, lost.id, 'Excursion to the park'));
      const checked = await checkOf(s, b);
      expect(checked.dayChanges.kept.map((one) => [one.key, one.kind])).toEqual([
        [kept.id, 'cancel'],
      ]);
      expect(checked.dayChanges.dropped.map((one) => [one.key, one.kind]).sort()).toEqual(
        [
          [roomRow?.id, 'room'],
          [lost.id, 'cancel'],
        ].sort(),
      );
      const answer = await withdrawWith(s, b, { dayChangesKey: checked.dayChanges.key });
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      // The room change is ended in the withdrawn version's name (decision 5).
      expect(await endsOf([roomRow?.id ?? ''])).toEqual([
        expect.objectContaining({ change_id: roomRow?.id, version_id: b }),
      ]);
      // A's maths of 26 October is cancelled with the reason.
      expect(await lessonsOn(s, WEEK3)).toEqual([
        expect.objectContaining({ cancel_cause: 'reason', cancel_reason: 'Excursion to the zoo' }),
      ]);
      // The other class's Tuesday lessons are gone; its Monday ones are A's, held.
      expect(await lessonsOn(s, tuesday, s.otherClass)).toEqual([]);
      expect(await lessonsOn(s, WEEK4, s.otherClass)).toEqual([
        expect.objectContaining({ cancel_cause: null }),
      ]);
      const [entry] = await t.entries('timetable_version.withdraw', b);
      expect(entry?.new_value).toMatchObject({
        dayChanges: {
          kept: [kept.id],
          dropped: [roomRow?.id, lost.id].sort(),
          ended: [roomRow?.id],
        },
      });
    });

    describe('a move that needs a decision', () => {
      /**
       * A gives the other class's maths to the first class's teacher on
       * Wednesday in lesson 2; B has it on Monday with its own teacher. B's
       * maths of the first class on 26 October moved to Wednesday 28 October
       * in lesson 2 then meets the teacher's lesson of A.
       */
      const clashScene = () =>
        chain({
          a: (scene) => (row) => (row.class_id === scene.otherClass ? [3, 3] : [1, 1]),
          aTeacher: (scene) => (row) =>
            row.class_id === scene.otherClass ? scene.teacher.staffId : null,
        });

      it('refuses until it is settled, refuses “keep”, and drops the move with “drop”', async () => {
        const { s, b } = await clashScene();
        const moved = await lessonOf(s, WEEK3);
        changed(await move(s.branch, moved.id, { date: WEDNESDAY3, lessonNumber: 2 }));
        const [row] = await dayChangesOf(moved.id);
        const checked = await checkOf(s, b);
        expect(checked.dayChanges.decide.map((one) => one.key)).toEqual([row?.id]);
        expect(checked.dayChanges.decide[0]?.blocked.map((one) => one.rule)).toContain(
          'teacher_double',
        );
        const key = checked.dayChanges.key;
        const north = await northStored();
        const before = await everything();
        expect(refusals(await withdrawWith(s, b, { dayChangesKey: key }))).toEqual([
          expect.objectContaining({ code: 'day_change_undecided', path: `dayChanges.${row?.id}` }),
        ]);
        // Review correction 2: a refused withdraw writes nothing, the version
        // still published, no end and no lesson changed.
        expect(await statusOf(b)).toBe('published');
        expect(await everything()).toEqual(before);
        expect(
          refusals(
            await withdrawWith(s, b, {
              dayChangesKey: key,
              dayDecisions: [{ key: row?.id, choice: 'keep' }],
            }),
          ).map((one) => one.code),
        ).toEqual(['day_choice_not_offered']);
        // A key of the branch that is no item.
        expect(
          refusals(
            await withdrawWith(s, b, {
              dayChangesKey: key,
              dayDecisions: [
                { key: row?.id, choice: 'drop' },
                { key: moved.id, choice: 'drop' },
              ],
            }),
          ).map((one) => one.code),
        ).toEqual(['day_decision_unknown']);
        // Another branch's lesson, one-day change and bulk cancel as keys,
        // and an unknown one: 404 before any lock.
        for (const wrong of [north.lesson, north.change, north.bulk, UNKNOWN]) {
          refusedWith(
            await withdrawWith(s, b, {
              dayChangesKey: key,
              dayDecisions: [{ key: wrong, choice: 'drop' }],
            }),
            404,
            'not_found',
          );
        }
        expect(await everything()).toEqual(before);
        const answer = await withdrawWith(s, b, {
          dayChangesKey: key,
          dayDecisions: [{ key: row?.id, choice: 'drop' }],
        });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        // A's maths is on Monday, as A has it; the move is ended.
        expect(await lessonsOn(s, WEEK3)).toEqual([
          expect.objectContaining({ starts_at: at(WEEK3, '08:00'), cancel_cause: null }),
        ]);
        expect(await endsOf([row?.id ?? ''])).toEqual([expect.objectContaining({ version_id: b })]);
        const [entry] = await t.entries('timetable_version.withdraw', b);
        expect(entry?.new_value).toMatchObject({
          dayChanges: { decided: [{ key: row?.id, choice: 'drop' }], ended: [row?.id] },
        });
      });

      it('cancels the lesson that day with “cancel”', async () => {
        const { s, b } = await clashScene();
        const moved = await lessonOf(s, WEEK3);
        changed(await move(s.branch, moved.id, { date: WEDNESDAY3, lessonNumber: 2 }));
        const [row] = await dayChangesOf(moved.id);
        const checked = await checkOf(s, b);
        const answer = await withdrawWith(s, b, {
          dayChangesKey: checked.dayChanges.key,
          dayDecisions: [{ key: row?.id, choice: 'cancel' }],
        });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(await lessonsOn(s, WEEK3)).toEqual([
          expect.objectContaining({
            starts_at: at(WEEK3, '08:00'),
            cancel_cause: 'reason',
            cancel_reason: 'Excursion to the museum',
          }),
        ]);
      });

      it('sorts a move from before the withdrawn start into a blocked rule: “drop” removes its block, “cancel” keeps it cancelled', async () => {
        for (const choice of ['drop', 'cancel'] as const) {
          // A's maths of 19 October moved to Wednesday 28 October while A ran
          // there, kept by B's publish; from 26 October the teacher works no
          // Wednesdays, so A running again cannot keep it there.
          let movedId = '';
          const { s, a, b } = await chain({
            beforeB: async (scene) => {
              movedId = (await lessonOf(scene, NEXT_MONDAY)).id;
              changed(await move(scene.branch, movedId, { date: WEDNESDAY3, lessonNumber: 2 }));
            },
          });
          await noWednesdays(s, WEEK3);
          const moved = { id: movedId };
          const [row] = await dayChangesOf(moved.id);
          const checked = await checkOf(s, b);
          expect(checked.dayChanges.decide.map((one) => one.key)).toEqual([row?.id]);
          const answer = await withdrawWith(s, b, {
            dayChangesKey: checked.dayChanges.key,
            dayDecisions: [{ key: row?.id, choice }],
          });
          expect(answer.status, JSON.stringify(answer.body)).toBe(200);
          if (choice === 'drop') {
            expect(await rowOf(moved.id)).toBeUndefined();
          } else {
            expect(await rowOf(moved.id)).toMatchObject({
              lesson_date: WEDNESDAY3,
              cancel_cause: 'reason',
              cancel_reason: 'Excursion to the museum',
            });
          }
          // A's own maths of 26 October is there either way.
          expect(await lessonsOn(s, WEEK3)).toEqual([
            expect.objectContaining({ version_id: a, cancel_cause: null }),
          ]);
        }
      });

      it('answers a blocked result of the version that runs again and an undecided item in one refusal', async () => {
        // A's maths of 19 October moved to Wednesday 28 October in lesson 2,
        // kept by B's publish; from 26 October the teacher works from 09:00
        // only: A's Monday maths at 08:00 is blocked, and so is the move.
        let movedId = '';
        const { s, b } = await chain({
          beforeB: async (scene) => {
            movedId = (await lessonOf(scene, NEXT_MONDAY)).id;
            changed(await move(scene.branch, movedId, { date: WEDNESDAY3, lessonNumber: 2 }));
          },
        });
        await noWednesdays(s, WEEK3, 540);
        const [row] = await dayChangesOf(movedId);
        const checked = await checkOf(s, b);
        const codes = refusals(
          await withdrawWith(s, b, { dayChangesKey: checked.dayChanges.key }),
        ).map((one) => one.code);
        expect([...new Set(codes)].sort()).toEqual(['day_change_undecided', 'pattern_blocked']);
        expect(checked.dayChanges.decide.map((one) => one.key)).toEqual([row?.id]);
      });

      // `.claude/rules/timetable.md`: the version that runs again is read as
      // if it started on the withdrawn start, the sorting's check too.
      it('reads the teacher’s availability in force on the withdrawn start, not on the start of the version that runs again', async () => {
        const s0 = await scene();
        const a = await published(s0, await copyOf(s0), NEXT_MONDAY);
        const b = await published(s0, await copyOf(s0), WEEK3);
        const moved = await lessonOf(s0, WEEK3);
        changed(await move(s0.branch, moved.id, { date: WEDNESDAY3, lessonNumber: 2 }));
        const [row] = await dayChangesOf(moved.id);
        // From the withdrawn start the teacher works no Wednesdays.
        await noWednesdays(s0, WEEK3);
        const checked = await checkOf(s0, b);
        expect(checked.runsAgain).toMatchObject({ id: a });
        // Read from A's own start, the entry of 26 October would be a later
        // one, a warning: the move would be kept.
        expect(checked.dayChanges.kept).toEqual([]);
        expect(checked.dayChanges.decide.map((one) => one.key)).toEqual([row?.id]);
      });
    });

    // `.claude/rules/timetable.md`: a lesson is named by its entry and the
    // date of its pattern block.
    it('tells a lesson moved onto the same weekday a week later from the lesson of its entry there', async () => {
      const { s, b } = await chain();
      const moved = await lessonOf(s, WEEK4);
      changed(await move(s.branch, moved.id, { date: WEEK5, lessonNumber: 2 }));
      // The entry's own lesson of that date, not the one moved there (two
      // lessons of the class and subject now share the date).
      const own = await t.database.migrator
        .selectFrom('lessons')
        .selectAll()
        .where('branch_id', '=', s.branch)
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .where('lesson_date', '=', WEEK5)
        .where('id', '!=', moved.id)
        .executeTakeFirstOrThrow();
      changed(await cancel(s.branch, own.id, 'Excursion to the zoo'));
      const checked = await checkOf(s, b);
      expect(checked.dayChanges.kept.map((one) => one.kind).sort()).toEqual(['cancel', 'move']);
      const answer = await withdrawWith(s, b, { dayChangesKey: checked.dayChanges.key });
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(await lessonsOn(s, WEEK4)).toEqual([]);
      expect((await lessonsOn(s, WEEK5)).map((one) => [one.starts_at, one.cancel_cause])).toEqual([
        [at(WEEK5, '08:00'), 'reason'],
        [at(WEEK5, '08:55'), null],
      ]);
    });

    describe('no version running again', () => {
      it('drops the changes of the lessons it removes and keeps a lesson of the next version moved onto its dates (decision 13)', async () => {
        const s = await scene();
        const roomed = await lessonOf(s, MONDAY, s.otherClass);
        changed(await roomChange(s.branch, roomed.id, s.spareRoom));
        const [roomRow] = await dayChangesOf(roomed.id);
        // The maths of 19 October moved onto Wednesday 14 October, then A
        // published from 19 October: the move stays (5.6a-5a decision 7). The
        // scene's version, from 12 October, is withdrawn.
        const moved = await lessonOf(s, NEXT_MONDAY);
        changed(await move(s.branch, moved.id, { date: '2026-10-14', lessonNumber: 2 }));
        const [moveRow] = await dayChangesOf(moved.id);
        await published(s, await copyOf(s), NEXT_MONDAY);
        const checked = await checkOf(s, s.version);
        expect(checked.runsAgain).toBeNull();
        expect(checked.dayChanges.kept.map((one) => one.key)).toEqual([moveRow?.id]);
        expect(checked.dayChanges.dropped.map((one) => one.key)).toEqual([roomRow?.id]);
        const answer = await withdrawWith(s, s.version, {
          dayChangesKey: checked.dayChanges.key,
        });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(await lessonsOn(s, MONDAY, s.otherClass)).toEqual([]);
        expect(await rowOf(moved.id)).toMatchObject({ lesson_date: '2026-10-14' });
        expect((await dayChangesOf(moved.id)).map((one) => one.id)).toEqual([moveRow?.id]);
        expect(await endsOf([moveRow?.id ?? '', roomRow?.id ?? ''])).toEqual([
          expect.objectContaining({ change_id: roomRow?.id, version_id: s.version }),
        ]);
      });

      it('writes a kept lesson of the next version cancelled with “cancel” when its move needs a decision (decision 13)', async () => {
        const s = await scene();
        // The maths of 19 October moved onto Wednesday 14 October, A published
        // from 19 October keeping the move; then the teacher works no
        // Wednesdays from 12 October, the withdrawn start.
        const moved = await lessonOf(s, NEXT_MONDAY);
        changed(await move(s.branch, moved.id, { date: '2026-10-14', lessonNumber: 2 }));
        const [row] = await dayChangesOf(moved.id);
        await published(s, await copyOf(s), NEXT_MONDAY);
        await noWednesdays(s, MONDAY);
        const checked = await checkOf(s, s.version);
        expect(checked.runsAgain).toBeNull();
        expect(checked.dayChanges.decide.map((one) => one.key)).toEqual([row?.id]);
        expect(checked.dayChanges.decide[0]?.blocked.map((one) => one.rule)).toContain(
          'teacher_unavailable',
        );
        const answer = await withdrawWith(s, s.version, {
          dayChangesKey: checked.dayChanges.key,
          dayDecisions: [{ key: row?.id, choice: 'cancel' }],
        });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(await rowOf(moved.id)).toMatchObject({
          lesson_date: '2026-10-14',
          cancel_cause: 'reason',
          cancel_reason: 'Excursion to the museum',
        });
        expect(await lessonsOn(s, MONDAY)).toEqual([]);
        const [entry] = await t.entries('timetable_version.withdraw', s.version);
        expect(entry?.new_value).toMatchObject({
          datedLessons: {
            changed: [
              expect.objectContaining({ id: moved.id, cancel: { from: null, to: 'reason' } }),
            ],
          },
          dayChanges: { decided: [{ key: row?.id, choice: 'cancel' }], ended: [row?.id] },
        });
      });

      it('keeps a lesson of a later version moved onto the dates of a version withdrawn with one running again', async () => {
        // The maths of 26 October moved onto Wednesday 21 October while A ran
        // on both; B, published from 26 October, leaves it there.
        let movedId = '';
        const { s, a } = await chain({
          beforeB: async (scene) => {
            movedId = (await lessonOf(scene, WEEK3)).id;
            changed(await move(scene.branch, movedId, { date: '2026-10-21', lessonNumber: 2 }));
          },
        });
        const moved = { id: movedId };
        const [row] = await dayChangesOf(moved.id);
        const checked = await checkOf(s, a);
        expect(checked.runsAgainUntil).toBe('2026-10-25');
        expect(checked.dayChanges.kept.map((one) => one.key)).toEqual([row?.id]);
        const answer = await withdrawWith(s, a, { dayChangesKey: checked.dayChanges.key });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(await rowOf(moved.id)).toMatchObject({ lesson_date: '2026-10-21' });
        expect(await endsOf([row?.id ?? ''])).toEqual([]);
      });
    });

    it('leaves ended a change the withdrawn version’s publish ended (decision 3 of the review)', async () => {
      const s = await scene();
      // A room change on the other class's maths of 19 October, which A,
      // with that maths on Tuesday, drops at its publish.
      const roomed = await lessonOf(s, NEXT_MONDAY, s.otherClass);
      changed(await roomChange(s.branch, roomed.id, s.spareRoom));
      const [roomRow] = await dayChangesOf(roomed.id);
      const a = await published(
        s,
        await copyOf(s, (row) => (row.class_id === s.otherClass ? [2, 1] : [1, 1])),
        NEXT_MONDAY,
      );
      const ended = await endsOf([roomRow?.id ?? '']);
      expect(ended).toEqual([expect.objectContaining({ version_id: a })]);
      const checked = await checkOf(s, a);
      expect([
        ...checked.dayChanges.kept,
        ...checked.dayChanges.decide,
        ...checked.dayChanges.dropped,
      ]).toEqual([]);
      const answer = await withdrawWith(s, a, {});
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(await endsOf([roomRow?.id ?? ''])).toEqual(ended);
    });

    it('refuses a key of an older sorting', async () => {
      const { s, b } = await chain();
      const first = await lessonOf(s, WEEK3);
      changed(await cancel(s.branch, first.id, 'Excursion to the zoo'));
      const old = (await checkOf(s, b)).dayChanges.key;
      const second = await lessonOf(s, WEEK3, s.otherClass);
      changed(await cancel(s.branch, second.id, 'Excursion to the zoo'));
      expect(
        refusals(await withdrawWith(s, b, { dayChangesKey: old })).map((one) => one.code),
      ).toEqual(['day_changes_changed']);
      expect(await statusOf(b)).toBe('published');
      const fresh = (await checkOf(s, b)).dayChanges.key;
      expect(fresh).not.toBe(old);
      const answer = await withdrawWith(s, b, { dayChangesKey: fresh });
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    });

    it('answers a repeat with the stored answer, refuses the key from another account and with other decisions, and a used key with another branch’s key 404', async () => {
      const { s, b } = await chain();
      const first = await lessonOf(s, WEEK3);
      changed(await cancel(s.branch, first.id, 'Excursion to the zoo'));
      const body = { dayChangesKey: (await checkOf(s, b)).dayChanges.key };
      const key = randomUUID();
      const answer = await withdrawWith(s, b, body, key);
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      const again = await withdrawWith(s, b, body, key);
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.body).toEqual(answer.body);
      refusedWith(
        await withdrawWith(
          s,
          b,
          { ...body, dayDecisions: [{ key: first.id, choice: 'drop' }] },
          key,
        ),
        409,
        'request_key_reused',
      );
      // The kit's Academic Vice Principal, given the role in the scene's branch.
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
      refusedWith(await withdrawWith(s, b, body, key, t.vicePrincipal), 409, 'request_key_reused');
      // Permission review should-fix 4: a repeat of a used key with another
      // branch's or an unknown key or block is 404, from a refused role 403,
      // each before the stored answer and writing nothing.
      const north = await northStored();
      const after = await everything();
      for (const decision of [
        { key: north.lesson, choice: 'drop' },
        { key: UNKNOWN, choice: 'drop' },
        { key: first.id, blockId: north.block, blockDate: WEEK3, choice: 'keep' },
        { key: first.id, blockId: UNKNOWN, blockDate: WEEK3, choice: 'keep' },
      ]) {
        refusedWith(
          await withdrawWith(s, b, { ...body, dayDecisions: [decision] }, key),
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
      refusedWith(await withdrawWith(s, b, body, key, t.principal), 403, 'permission_denied');
      expect(await everything()).toEqual(after);
    });

    it('refuses the check as the withdraw: a draft, another branch’s and an unknown id; the Principal reads it', async () => {
      const { s, a, b } = await chain();
      const draft = await copyOf(s);
      refusedWith(
        await t.get(`/api/timetable/versions/${draft}/withdraw-check`, s.branch),
        409,
        'version_not_published',
      );
      for (const id of [northScene.version, UNKNOWN]) {
        refusedWith(
          await t.get(`/api/timetable/versions/${id}/withdraw-check`, s.branch),
          404,
          'not_found',
        );
      }
      // The kit's Principal holds the role in the north branch.
      expect((await checkOf(northScene, northScene.version, t.principal)).runsAgain).toBeNull();
      expect((await checkOf(s, b)).runsAgain).toMatchObject({ id: a });
    });
  });
});
