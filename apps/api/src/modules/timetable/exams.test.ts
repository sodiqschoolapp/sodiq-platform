import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  NOTIFICATION_KINDS,
  dayAnswerSchema,
  REQUEST_KEY_HEADER,
  examCheckSchema,
  examSaveAnswerSchema,
  examSchema,
  examsAnswerSchema,
  publishCheckSchema,
  subjectListSchema,
  withdrawCheckSchema,
  type Subject,
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
import { MembersKit } from '../../testing/members-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { HELD_ENTRY_ACTION, heldEntry } from '../../testing/held-entry.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const saved = (response: Response, status = 201) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return examSaveAnswerSchema.parse(response.body);
};

/** The details of a refusal: their codes and record ids. */
const detailsOf = (response: Response) =>
  (
    response.body as {
      error: {
        details?: {
          code: string;
          path: string;
          recordId?: string;
          classId?: string;
          room?: { id: string };
          rule?: { lessonIds: string[] };
        }[];
      };
    }
  ).error.details ?? [];

/** The quarters of the year 2026-09-01 to 2027-05-31, dated. */
const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

/** Mondays and a Thursday after the version's start. */
const NEXT_MONDAY = '2026-10-19';
const LATER_MONDAY = '2026-10-26';
const THURSDAY = '2026-10-22';

// All names are invented. Task 5.6c-1, pull request #181: exams in the
// timetable (docs/spec/06-timetable.md, Changes after publishing, Exam: "It
// replaces the regular lessons of its classes in its slots: those not already
// cancelled are cancelled with the reason 'exam' in the same save, both halves
// of a double lesson together, and cancelling the exam restores only the
// lessons it cancelled, by the rule for a restored lesson. ... The Academic
// Vice Principal creates, changes and cancels exams, from today on and only in
// slots that have not started"; edge-cases/timetable.md, Exams). The clock
// stands at 23:55 on Saturday 10 October 2026 in Tashkent.
describe('exams in the timetable', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let members: MembersKit;

  const keyed = (
    method: 'post' | 'put',
    path: string,
    branch: string,
    body: object,
    cookie: string,
    key: string,
  ) =>
    request(t.kit.server)
      [method](path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, key)
      .send(body);

  const create = (branch: string, body: object, cookie = t.admin, key: string = randomUUID()) =>
    keyed('post', '/api/timetable/exams', branch, body, cookie, key);

  const change = (
    branch: string,
    id: string,
    body: object,
    cookie = t.admin,
    key: string = randomUUID(),
  ) => keyed('put', `/api/timetable/exams/${id}`, branch, body, cookie, key);

  const cancel = (
    branch: string,
    id: string,
    body: object = {},
    cookie = t.admin,
    key: string = randomUUID(),
  ) => keyed('post', `/api/timetable/exams/${id}/cancel`, branch, body, cookie, key);

  const publish = (branch: string, version: string, startsOn: string) =>
    request(t.kit.server)
      .post(`/api/timetable/versions/${version}/publish`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ startsOn });

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

  /** A person of the branch with an account and hours, teaching the subjects given. */
  async function person(
    branch: string,
    subjects: readonly string[] = [],
    grades: readonly number[] = [7],
  ) {
    const one = await load.teacher(branch, {
      subjects: subjects.map((subject) => ({ subject, grades: [...grades] })),
    });
    await hours(branch, one.staffId);
    return one;
  }

  /**
   * A branch with a year of four dated quarters, a day of three lessons from
   * 08:00 (08:00, 08:55, 09:50, 45 minutes each) on every weekday, two classes
   * of grade 7 with a home room each, and a version published from Monday 12
   * October: maths of each class on Monday in lesson 1 with a teacher of its
   * own; with `double`, the first class's maths a double in lessons 1 and 2;
   * with `art`, a group of the first class and a class of grade 8 for art on
   * Thursday in lesson 1.
   */
  async function scene(
    input: {
      double?: boolean;
      art?: boolean;
      artTwice?: boolean;
      artPair?: boolean;
      eighthTemplate?: boolean;
      /** Task 5.6c-3a: grade 8's lesson 1 lasts an hour (08:00–09:00), over grade 7's lesson 2 by clock time. */
      eighthLong?: boolean;
      branch?: string;
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
    // With `eighthTemplate`, grade 8 has its own day: lesson 1 at the same
    // time, then a shorter break, so its later slots differ.
    if (input.eighthTemplate === true) {
      const short = await t.createSlotType(branch, 'Short break', 'break', 5);
      const senior = await t.createTemplate(branch, 'Grade 8', [
        lesson,
        short,
        lesson,
        short,
        lesson,
      ]);
      await t.assign(branch, senior, { level: 'grades', gradeFrom: 8, gradeTo: 8 });
    }
    if (input.eighthLong === true) {
      const long = await t.createSlotType(branch, 'Long lesson', 'lesson', 60);
      const senior = await t.createTemplate(branch, 'Grade 8 long', [
        long,
        pause,
        lesson,
        pause,
        lesson,
      ]);
      await t.assign(branch, senior, { level: 'grades', gradeFrom: 8, gradeTo: 8 });
    }
    const maths = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const room = await load.classes.room(branch);
    const otherRoom = await load.classes.room(branch);
    const spareRoom = await load.classes.room(branch);
    const hall = await load.classes.room(branch);
    const classId = await load.classes.schoolClass(branch, year, { grade: 7, room });
    const otherClass = await load.classes.schoolClass(branch, year, { grade: 7, room: otherRoom });
    const teacher = await person(branch, [maths]);
    const otherTeacher = await person(branch, [maths]);
    const invigilator = await person(branch, [maths]);
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
      subject_id: maths,
      teacher_id: teacher.staffId,
      lessons_per_week: input.double === true ? 2 : 1,
      double_lessons: input.double === true,
    });
    await placeAt(branch, version, rowId, 1);
    if (input.double === true) await placeAt(branch, version, rowId, 1, 3);
    const otherRow = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: otherClass,
      subject_id: maths,
      teacher_id: otherTeacher.staffId,
      lessons_per_week: 1,
    });
    await placeAt(branch, version, otherRow, 1);
    let art: {
      subject: string;
      group: string;
      eighth: string;
      teacher: string;
      pair: string | null;
    } | null = null;
    if (input.art === true || input.artTwice === true || input.artPair === true) {
      const subject = await load.classes.subject({
        grades: [7, 8],
        journalType: 'attendance_only',
      });
      const eighth = await load.classes.schoolClass(branch, year, { grade: 8 });
      const group = await load.classes.group(branch, year, subject, [classId, eighth]);
      const artTeacher = await person(branch, [subject], [7, 8]);
      const artRow = await load.row({
        branch_id: branch,
        version_id: version,
        group_id: group,
        subject_id: subject,
        teacher_id: artTeacher.staffId,
        lessons_per_week: input.artTwice === true ? 2 : 1,
      });
      // With `artPair`, a parallel group of the same classes in the same block.
      let pair: string | null = null;
      if (input.artPair === true) {
        pair = await load.classes.group(branch, year, subject, [classId, eighth]);
        const pairTeacher = await person(branch, [subject], [7, 8]);
        await load.row({
          branch_id: branch,
          version_id: version,
          group_id: pair,
          subject_id: subject,
          teacher_id: pairTeacher.staffId,
          lessons_per_week: 1,
        });
      }
      await placeAt(branch, version, artRow, 4);
      // With `artTwice`, a second art lesson on Thursday in lesson 2.
      if (input.artTwice === true) await placeAt(branch, version, artRow, 4, 3);
      art = { subject, group, eighth, teacher: artTeacher.staffId, pair };
    }
    const confirmed = await t.post(`/api/timetable/versions/${version}/templates/confirm`, branch);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    await load.freeEditLock(version);
    const published = await publish(branch, version, MONDAY);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    return {
      branch,
      year,
      maths,
      room,
      otherRoom,
      spareRoom,
      hall,
      classId,
      otherClass,
      teacher,
      otherTeacher,
      invigilator,
      version,
      art,
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /** The scene of the kit's branch, where the Principal and the Academic Vice Principal have their roles; made once. */
  let northMade: Scene | null = null;
  const northScene = async () => {
    northMade ??= await scene({ branch: t.north });
    return northMade;
  };

  /** An exam body: the classes in one room with one invigilator, in lesson 1 unless given. */
  const examOf = (
    s: Scene,
    input: {
      date?: string;
      first?: number;
      last?: number;
      classIds?: string[];
      groupIds?: string[];
      roomId?: string;
      invigilatorIds?: string[];
      subjectId?: string | null;
      blockChoices?: { classId: string; blockId: string; choice: 'cancel' | 'keep' }[];
      confirm?: boolean;
    } = {},
  ) => ({
    date: input.date ?? NEXT_MONDAY,
    firstLesson: input.first ?? 1,
    lastLesson: input.last ?? input.first ?? 1,
    title: 'Quarter exam in maths',
    subjectId: input.subjectId === undefined ? s.maths : input.subjectId,
    rooms: [
      {
        roomId: input.roomId ?? s.hall,
        classIds: input.classIds ?? [s.classId, s.otherClass],
        groupIds: input.groupIds ?? [],
        invigilatorIds: input.invigilatorIds ?? [s.invigilator.staffId],
      },
    ],
    blockChoices: input.blockChoices ?? [],
    confirm: input.confirm ?? false,
  });

  /**
   * Task 5.6c-3b: a scene with art (a group of the first class and a grade-8 class) whose
   * maths and art are rating subjects from after the publish, and a student
   * in each class: `seventh` in the first class and the art group,
   * `eighth` in the grade-8 class and the art group (from `eighthFrom`),
   * `other` in the other grade-7 class.
   */
  async function ratingScene(input: { eighthFrom?: string } = {}) {
    const s = await scene({ art: true });
    const art = s.art;
    if (art === null) throw new Error('The scene has art.');
    await t.database.migrator
      .updateTable('subjects')
      .set({ journal_type: 'graded', rating_exam: true })
      .where('id', 'in', [s.maths, art.subject])
      .execute();
    // A student of a class with a group subject is in one of its groups
    // (`class_memberships_need_groups`): both rows in one transaction.
    const eighthFrom = input.eighthFrom ?? '2026-09-01';
    const student = async (classId: string, grade: number, group: string | null, from: string) => {
      const id = await members.student(s.branch, { grade, startsOn: '2026-09-01' });
      await t.database.migrator.transaction().execute(async (transaction) => {
        await sql`set constraints all deferred`.execute(transaction);
        await members.member({ branch: s.branch, classId, studentId: id, from }, transaction);
        if (group !== null) {
          await members.groupMember(
            { branch: s.branch, groupId: group, subjectId: art.subject, studentId: id, from },
            transaction,
          );
        }
      });
      return id;
    };
    const seventh = await student(s.classId, 7, art.group, '2026-09-01');
    // With `eighthFrom` after the exam's date, the grade-8 student joins the
    // class and the group only then.
    const eighth = await student(art.eighth, 8, art.group, eighthFrom);
    const other = await student(s.otherClass, 7, null, '2026-09-01');
    const journalOf = async (unit: { classId?: string; groupId?: string }, subject: string) =>
      (
        await t.database.migrator
          .selectFrom('journals')
          .select('id')
          .where('branch_id', '=', s.branch)
          .where('subject_id', '=', subject)
          .where(
            unit.classId === undefined ? 'group_id' : 'class_id',
            '=',
            unit.classId ?? unit.groupId ?? '',
          )
          .executeTakeFirstOrThrow()
      ).id;
    return {
      ...s,
      art,
      journals: {
        maths: await journalOf({ classId: s.classId }, s.maths),
        otherMaths: await journalOf({ classId: s.otherClass }, s.maths),
        art: await journalOf({ groupId: art.group }, art.subject),
      },
      students: { seventh, eighth, other },
    };
  }

  type RatingScene = Awaited<ReturnType<typeof ratingScene>>;

  /** The stored lessons of a class (or a group) on a date, by start. */
  const lessonsOf = (date: string, unit: { classId?: string; groupId?: string }) =>
    t.database.migrator
      .selectFrom('lessons')
      .selectAll()
      .where('lesson_date', '=', date)
      .where(
        unit.classId === undefined ? 'group_id' : 'class_id',
        '=',
        unit.classId ?? unit.groupId ?? '',
      )
      .orderBy('starts_at')
      .execute();

  const lessonOf = async (date: string, classId: string) => {
    const [found] = await lessonsOf(date, { classId });
    if (found === undefined) throw new Error('No such lesson.');
    return found;
  };

  /** The two Monday lessons of the first class of a scene with `double` made one double pair, as the day-change tests do. */
  async function pairUp(s: Scene, date: string) {
    const both = await lessonsOf(date, { classId: s.classId });
    expect(both).toHaveLength(2);
    await t.database.migrator
      .updateTable('lesson_blocks')
      .set({ double_pair_id: randomUUID() })
      .where(
        'id',
        'in',
        both.map((one) => one.block_id),
      )
      .execute();
  }

  const linksOf = (lessonId: string) =>
    t.database.migrator
      .selectFrom('lesson_exam_cancels')
      .select('exam_id')
      .where('lesson_id', '=', lessonId)
      .orderBy('exam_id')
      .execute()
      .then((rows) => rows.map((one) => one.exam_id));

  const noticesOf = (accountId: string) =>
    t.database.migrator
      .selectFrom('notifications')
      .select(['kind', 'data'])
      .where('account_id', '=', accountId)
      .where('kind', '=', 'timetable.exam_changed')
      .orderBy('id')
      .execute();

  /** Every row of the tables an exam save writes, in every branch, and the log. */
  const everything = () =>
    Promise.all([
      t.database.migrator.selectFrom('exams').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('exam_rooms').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('exam_room_classes').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('exam_invigilators').selectAll().orderBy('id').execute(),
      t.database.migrator
        .selectFrom('lesson_block_class_outs')
        .selectAll()
        .orderBy('block_id')
        .orderBy('class_id')
        .execute(),
      t.database.migrator
        .selectFrom('lesson_exam_cancels')
        .selectAll()
        .orderBy('lesson_id')
        .orderBy('exam_id')
        .execute(),
      t.database.migrator.selectFrom('lessons').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('time_claims').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('lesson_changes').selectAll().orderBy('lesson_id').execute(),
      t.database.migrator.selectFrom('notifications').select('id').orderBy('id').execute(),
      sql<{ id: string }>`select id from pgboss.job order by id`
        .execute(t.database.migrator)
        .then((result) => result.rows),
      t.database.migrator
        .selectFrom('audit_log')
        .select('id')
        .where('action', '<>', HELD_ENTRY_ACTION)
        .orderBy('id')
        .execute(),
      // Task 5.6c-3b: the rating link the save writes (last, so the indexes
      // the tests read stay).
      t.database.migrator
        .selectFrom('exam_rating_journals')
        .selectAll()
        .orderBy('exam_id')
        .orderBy('journal_id')
        .execute(),
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

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    members = new MembersKit(t.database.migrator, await load.classes.account());
  });

  afterAll(async () => {
    await t.close();
  });

  describe('a create', () => {
    it('cancels the classes’ lessons in its slots "exam" with the link, both halves of a double, and tells the teachers and the invigilator once each (06, Exam)', async () => {
      const s = await scene({ double: true });
      await pairUp(s, NEXT_MONDAY);
      const own = await lessonsOf(NEXT_MONDAY, { classId: s.classId });
      expect(own).toHaveLength(2);
      const other = await lessonOf(NEXT_MONDAY, s.otherClass);
      const answer = saved(await create(s.branch, examOf(s)));
      expect(answer.exam).toMatchObject({
        date: NEXT_MONDAY,
        firstLesson: 1,
        lastLesson: 1,
        start: 480,
        end: 525,
        cancelled: false,
      });
      // The half of the double outside the exam goes with the half under it.
      for (const one of [...own, other]) {
        const row = await lessonOf(NEXT_MONDAY, one.class_id ?? '').then(() =>
          t.database.migrator
            .selectFrom('lessons')
            .select('cancel_cause')
            .where('id', '=', one.id)
            .executeTakeFirstOrThrow(),
        );
        expect(row.cancel_cause).toBe('exam');
        expect(await linksOf(one.id)).toEqual([answer.exam.id]);
      }
      expect([...answer.exam.lessonIds].sort()).toEqual(
        [...own, other].map((one) => one.id).sort(),
      );
      const claims = await t.database.migrator
        .selectFrom('time_claims')
        .select('kind')
        .where('exam_id', '=', answer.exam.id)
        .orderBy('kind')
        .execute();
      expect(claims.map((one) => one.kind)).toEqual([
        'exam_class',
        'exam_class',
        'exam_invigilator',
        'exam_room',
      ]);
      const [entry] = await t.entries('exam.create', answer.exam.id);
      expect(entry?.new_value).toMatchObject({
        date: NEXT_MONDAY,
        title: 'Quarter exam in maths',
        lessonsCancelled: [...own, other].map((one) => one.id).sort(),
      });
      const teacherNotices = await noticesOf(s.teacher.accountId);
      expect(teacherNotices).toHaveLength(1);
      const teacherData = NOTIFICATION_KINDS['timetable.exam_changed'].parse(
        teacherNotices[0]?.data,
      );
      expect(teacherData).toMatchObject({
        action: 'created',
        invigilation: null,
        date: NEXT_MONDAY,
      });
      expect(teacherData.after?.every((one) => one.cancelled)).toBe(true);
      const invigilatorNotices = await noticesOf(s.invigilator.accountId);
      expect(invigilatorNotices).toHaveLength(1);
      expect(
        NOTIFICATION_KINDS['timetable.exam_changed'].parse(invigilatorNotices[0]?.data),
      ).toMatchObject({ action: 'created', invigilation: { start: '08:00', end: '08:45' } });
    });

    it('is refused while the invigilator teaches another class then, with the lesson listed; nothing is written (done when)', async () => {
      const s = await scene();
      const other = await lessonOf(NEXT_MONDAY, s.otherClass);
      const before = await everything();
      const response = await create(
        s.branch,
        examOf(s, { classIds: [s.classId], invigilatorIds: [s.otherTeacher.staffId] }),
      );
      refusedWith(response, 409, 'exam_blocked');
      expect(detailsOf(response).some((one) => one.rule?.lessonIds.includes(other.id))).toBe(true);
      expect(await everything()).toEqual(before);
    });

    it('is refused while the invigilator teaches in another branch at an overlapping clock time; nothing is written (done when)', async () => {
      const s = await scene();
      const south = await scene();
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: s.invigilator.staffId, branch_id: south.branch, is_main: false })
        .execute();
      // The other branch's lesson, on a slot of its own from 08:30 to 09:15.
      const theirs = await lessonOf(NEXT_MONDAY, south.classId);
      await t.database.migrator
        .updateTable('lesson_blocks')
        .set({
          starts_at: new Date('2026-10-19T08:30:00+05:00'),
          ends_at: new Date('2026-10-19T09:15:00+05:00'),
        })
        .where('id', '=', theirs.block_id)
        .execute();
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: s.invigilator.staffId })
        .where('id', '=', theirs.id)
        .execute();
      const before = await everything();
      const response = await create(s.branch, examOf(s));
      refusedWith(response, 409, 'exam_blocked');
      expect(detailsOf(response).map((one) => one.code)).toContain('teacher_double');
      expect(await everything()).toEqual(before);
    });

    it('is refused while its room holds another class’s lesson, or another exam; a free room passes (done when)', async () => {
      const s = await scene();
      refusedWith(
        await create(s.branch, examOf(s, { classIds: [s.classId], roomId: s.otherRoom })),
        409,
        'exam_blocked',
      );
      saved(await create(s.branch, examOf(s, { classIds: [s.classId] })));
      // A second exam in the same room at the same time, with its own class and invigilator.
      const second = await person(s.branch, [s.maths]);
      refusedWith(
        await create(
          s.branch,
          examOf(s, { classIds: [s.otherClass], invigilatorIds: [second.staffId] }),
        ),
        409,
        'exam_blocked',
      );
      // An invigilator of the first exam in a second one at the same time.
      refusedWith(
        await create(s.branch, examOf(s, { classIds: [s.otherClass], roomId: s.spareRoom })),
        409,
        'exam_blocked',
      );
      saved(
        await create(
          s.branch,
          examOf(s, {
            classIds: [s.otherClass],
            roomId: s.spareRoom,
            invigilatorIds: [second.staffId],
          }),
        ),
      );
    });

    it('passes a shared room within its count while another class’s lesson is in it', async () => {
      const s = await scene();
      await t.database.migrator
        .updateTable('rooms')
        .set({ shared: true, max_simultaneous_lessons: 2 })
        .where('id', '=', s.otherRoom)
        .execute();
      saved(await create(s.branch, examOf(s, { classIds: [s.classId], roomId: s.otherRoom })));
    });

    it('refuses a date with no published version in force (decision 16)', async () => {
      const s = await scene();
      refusedWith(
        await create(s.branch, examOf(s, { date: '2026-10-11' })),
        409,
        'exam_no_timetable',
      );
    });

    it('refuses classes on two day templates (edge/timetable, Exams, fourth row)', async () => {
      const s = await scene({ art: true, eighthTemplate: true });
      refusedWith(
        await create(
          s.branch,
          examOf(s, { date: THURSDAY, classIds: [s.classId, s.art?.eighth ?? ''] }),
        ),
        409,
        'exam_templates',
      );
    });

    it('tells a teacher who also invigilates once, with the invigilation and the week (spec review of the plan, should-fix 2)', async () => {
      const s = await scene();
      saved(
        await create(
          s.branch,
          examOf(s, { classIds: [s.classId], invigilatorIds: [s.teacher.staffId] }),
        ),
      );
      const notices = await noticesOf(s.teacher.accountId);
      expect(notices).toHaveLength(1);
      const data = NOTIFICATION_KINDS['timetable.exam_changed'].parse(notices[0]?.data);
      expect(data.invigilation).toMatchObject({ start: '08:00', end: '08:45' });
      expect(data.weekStart).toBe(NEXT_MONDAY);
    });

    it('is refused with a vacancy or an inactive person as invigilator', async () => {
      const s = await scene();
      const vacancy = await load.vacancy(s.branch, {
        subjects: [{ subject: s.maths, grades: [7] }],
      });
      await hours(s.branch, vacancy);
      const response = await create(s.branch, examOf(s, { invigilatorIds: [vacancy] }));
      refusedWith(response, 409, 'exam_blocked');
      expect(detailsOf(response).map((one) => one.code)).toContain('invigilator_vacancy');
      const gone = await person(s.branch, [s.maths]);
      await t.database.migrator
        .updateTable('staff_statuses')
        .set({ valid_until: '2026-10-01' })
        .where('staff_id', '=', gone.staffId)
        .execute();
      await t.database.migrator
        .insertInto('staff_statuses')
        .values({ staff_id: gone.staffId, status: 'inactive', valid_from: '2026-10-01' })
        .execute();
      const inactive = await create(s.branch, examOf(s, { invigilatorIds: [gone.staffId] }));
      refusedWith(inactive, 409, 'exam_blocked');
      expect(detailsOf(inactive).map((one) => one.code)).toContain('invigilator_inactive');
    });

    it('asks a tick for an invigilator without hours or the subject and for a small room, and saves with it (06, Exam)', async () => {
      const s = await scene();
      const stranger = await load.teacher(s.branch, {});
      await t.database.migrator
        .updateTable('rooms')
        .set({ capacity: 1 })
        .where('id', '=', s.hall)
        .execute();
      for (let index = 0; index < 2; index += 1) {
        const student = await members.student(s.branch, { grade: 7, startsOn: '2026-09-01' });
        await members.member({
          branch: s.branch,
          classId: s.classId,
          studentId: student,
          from: '2026-09-01',
        });
      }
      const body = examOf(s, { invigilatorIds: [stranger.staffId] });
      const response = await create(s.branch, body);
      refusedWith(response, 409, 'exam_warnings');
      expect(new Set(detailsOf(response).map((one) => one.code))).toEqual(
        new Set(['invigilator_unavailable', 'invigilator_subject', 'room_capacity']),
      );
      const answer = saved(await create(s.branch, { ...body, confirm: true }));
      expect([...answer.warnings].sort()).toEqual([
        'invigilator_subject',
        'invigilator_unavailable',
        'room_capacity',
      ]);
      const [entry] = await t.entries('exam.create', answer.exam.id);
      expect(entry?.new_value).toMatchObject({
        warnings: expect.arrayContaining(['invigilator_unavailable']) as unknown,
      });
    });

    it('refuses a date before today, a date outside every year, a vacation and a slot the day does not have', async () => {
      const s = await scene();
      refusedWith(await create(s.branch, examOf(s, { date: '2026-10-09' })), 409, 'exam_started');
      refusedWith(await create(s.branch, examOf(s, { first: 1, last: 4 })), 409, 'exam_slots');
      // A date outside every year of the branch.
      refusedWith(await create(s.branch, examOf(s, { date: '2027-07-05' })), 409, 'exam_year');
      // A vacation between quarters has no lessons.
      const vacation = await create(s.branch, examOf(s, { date: '2026-11-02' }));
      refusedWith(vacation, 409, 'exam_blocked');
      expect(detailsOf(vacation).map((one) => one.code)).toEqual(['vacation']);
    });

    it('refuses a group of another subject, a class of another year and the inputs the schema refuses', async () => {
      const s = await scene({ art: true });
      refusedWith(
        await create(
          s.branch,
          examOf(s, { date: THURSDAY, classIds: [], groupIds: [s.art?.group ?? ''] }),
        ),
        409,
        'exam_group_subject',
      );
      const nextYear = {
        id: await load.classes.year(s.branch, 'planned', '2027-09-01', '2028-05-31'),
      };
      const later = await load.classes.schoolClass(s.branch, nextYear.id, { grade: 7 });
      refusedWith(
        await create(s.branch, examOf(s, { classIds: [s.classId, later] })),
        409,
        'exam_unit_year',
      );
      const base = examOf(s);
      const room = base.rooms[0];
      if (room === undefined) throw new Error('No room.');
      for (const body of [
        { ...base, rooms: [room, { ...room, classIds: [s.classId], roomId: s.spareRoom }] },
        {
          ...base,
          rooms: [{ ...room, invigilatorIds: [s.invigilator.staffId, s.invigilator.staffId] }],
        },
        { ...base, rooms: [room, room] },
        { ...base, rooms: [{ ...room, classIds: [], groupIds: [] }] },
        { ...base, keepCancelled: [UNKNOWN] },
        { ...base, subjectId: null, rooms: [{ ...room, groupIds: [UNKNOWN] }] },
      ]) {
        refusedWith(await create(s.branch, body), 400, 'validation_failed');
      }
    });
  });

  describe('a shared block (edge/timetable, Exams, second row)', () => {
    it('asks a choice for a block shared with a class that does not sit; cancel takes the whole block, keep the sitting class out of it', async () => {
      const s = await scene({ art: true });
      const art = s.art;
      if (art === null) throw new Error('No art.');
      const [block] = await lessonsOf(THURSDAY, { groupId: art.group });
      if (block === undefined) throw new Error('No art lesson.');
      const asked = await create(s.branch, examOf(s, { date: THURSDAY, classIds: [s.classId] }));
      refusedWith(asked, 409, 'exam_block_choice');
      expect(detailsOf(asked)).toEqual([
        expect.objectContaining({ classId: s.classId, recordId: block.block_id }),
      ]);
      const kept = saved(
        await create(
          s.branch,
          examOf(s, {
            date: THURSDAY,
            classIds: [s.classId],
            blockChoices: [{ classId: s.classId, blockId: block.block_id, choice: 'keep' }],
          }),
        ),
      );
      const outs = await t.database.migrator
        .selectFrom('lesson_block_class_outs')
        .select(['block_id', 'class_id'])
        .where('exam_id', '=', kept.exam.id)
        .execute();
      expect(outs).toEqual([{ block_id: block.block_id, class_id: s.classId }]);
      expect((await lessonsOf(THURSDAY, { groupId: art.group }))[0]?.cancel_cause).toBeNull();
      // A cancel removes its out row (must-fix 5); a new exam keeping the same
      // class out of the same block saves.
      saved(await cancel(s.branch, kept.exam.id), 200);
      expect(
        await t.database.migrator
          .selectFrom('lesson_block_class_outs')
          .select('block_id')
          .where('exam_id', '=', kept.exam.id)
          .execute(),
      ).toEqual([]);
      const [cancelEntry] = await t.entries('exam.cancel', kept.exam.id);
      expect(cancelEntry?.new_value).toMatchObject({
        outsRemoved: [{ blockId: block.block_id, classId: s.classId }],
      });
      const again = saved(
        await create(
          s.branch,
          examOf(s, {
            date: THURSDAY,
            classIds: [s.classId],
            blockChoices: [{ classId: s.classId, blockId: block.block_id, choice: 'keep' }],
          }),
        ),
      );
      saved(await cancel(s.branch, again.exam.id), 200);
      const whole = saved(
        await create(
          s.branch,
          examOf(s, {
            date: THURSDAY,
            classIds: [s.classId],
            blockChoices: [{ classId: s.classId, blockId: block.block_id, choice: 'cancel' }],
          }),
        ),
      );
      expect((await lessonsOf(THURSDAY, { groupId: art.group }))[0]?.cancel_cause).toBe('exam');
      expect(await linksOf(block.id)).toEqual([whole.exam.id]);
    });

    it('keeps a choice per block: one class with two shared blocks, one kept and one cancelled (.claude/rules/timetable.md)', async () => {
      const s = await scene({ artTwice: true });
      const art = s.art;
      if (art === null) throw new Error('No art.');
      const [first, second] = await lessonsOf(THURSDAY, { groupId: art.group });
      if (first === undefined || second === undefined) throw new Error('No art lessons.');
      const exam = saved(
        await create(
          s.branch,
          examOf(s, {
            date: THURSDAY,
            classIds: [s.classId],
            first: 1,
            last: 2,
            blockChoices: [
              { classId: s.classId, blockId: first.block_id, choice: 'keep' },
              { classId: s.classId, blockId: second.block_id, choice: 'cancel' },
            ],
          }),
        ),
      );
      const outs = await t.database.migrator
        .selectFrom('lesson_block_class_outs')
        .select('block_id')
        .where('exam_id', '=', exam.exam.id)
        .execute();
      expect(outs.map((one) => one.block_id)).toEqual([first.block_id]);
      const after = await lessonsOf(THURSDAY, { groupId: art.group });
      expect(after.map((one) => one.cancel_cause)).toEqual([null, 'exam']);
    });

    it('asks again for a block a change makes shared, and gives the dropped class its lesson back with keep (code review round 1, change 1)', async () => {
      const s = await scene({ art: true });
      const art = s.art;
      if (art === null) throw new Error('No art.');
      const [block] = await lessonsOf(THURSDAY, { groupId: art.group });
      if (block === undefined) throw new Error('No art lesson.');
      // Both classes of the group sit: the block is not shared, and goes whole.
      const exam = saved(
        await create(s.branch, examOf(s, { date: THURSDAY, classIds: [s.classId, art.eighth] })),
      );
      expect(await linksOf(block.id)).toEqual([exam.exam.id]);
      // The grade-8 class no longer sits: the block is shared now, and nobody chose for it.
      const asked = await change(
        s.branch,
        exam.exam.id,
        examOf(s, { date: THURSDAY, classIds: [s.classId] }),
      );
      refusedWith(asked, 409, 'exam_block_choice');
      expect(detailsOf(asked)).toEqual([
        expect.objectContaining({ classId: s.classId, recordId: block.block_id }),
      ]);
      saved(
        await change(
          s.branch,
          exam.exam.id,
          examOf(s, {
            date: THURSDAY,
            classIds: [s.classId],
            blockChoices: [{ classId: s.classId, blockId: block.block_id, choice: 'keep' }],
          }),
        ),
        200,
      );
      expect((await lessonsOf(THURSDAY, { groupId: art.group }))[0]?.cancel_cause).toBeNull();
      expect(await linksOf(block.id)).toEqual([]);
    });

    it('keeps a block kept for the other class in the check: its teacher invigilating elsewhere refuses the exam', async () => {
      const s = await scene({ art: true });
      const art = s.art;
      if (art === null) throw new Error('No art.');
      const [block] = await lessonsOf(THURSDAY, { groupId: art.group });
      if (block === undefined) throw new Error('No art lesson.');
      refusedWith(
        await create(
          s.branch,
          examOf(s, {
            date: THURSDAY,
            classIds: [s.classId],
            invigilatorIds: [art.teacher],
            blockChoices: [{ classId: s.classId, blockId: block.block_id, choice: 'keep' }],
          }),
        ),
        409,
        'exam_blocked',
      );
    });

    it('leaves a lesson under two exams cancelled until the second is cancelled too (must-fix 3)', async () => {
      const s = await scene({ art: true });
      const art = s.art;
      if (art === null) throw new Error('No art.');
      const [block] = await lessonsOf(THURSDAY, { groupId: art.group });
      if (block === undefined) throw new Error('No art lesson.');
      const first = saved(
        await create(
          s.branch,
          examOf(s, {
            date: THURSDAY,
            classIds: [s.classId],
            blockChoices: [{ classId: s.classId, blockId: block.block_id, choice: 'cancel' }],
          }),
        ),
      );
      const other = await person(s.branch, [s.maths]);
      const second = saved(
        await create(
          s.branch,
          examOf(s, {
            date: THURSDAY,
            classIds: [art.eighth],
            roomId: s.spareRoom,
            invigilatorIds: [other.staffId],
            subjectId: null,
            blockChoices: [{ classId: art.eighth, blockId: block.block_id, choice: 'cancel' }],
          }),
        ),
      );
      expect(await linksOf(block.id)).toEqual([first.exam.id, second.exam.id].sort());
      const cancelled = saved(await cancel(s.branch, first.exam.id), 200);
      expect(cancelled.exam.cancelled).toBe(true);
      expect((await lessonsOf(THURSDAY, { groupId: art.group }))[0]?.cancel_cause).toBe('exam');
      const [entry] = await t.entries('exam.cancel', first.exam.id);
      expect(entry?.new_value).toMatchObject({ lessonsUnderOtherExams: [block.id] });
      saved(await cancel(s.branch, second.exam.id), 200);
      expect((await lessonsOf(THURSDAY, { groupId: art.group }))[0]?.cancel_cause).toBeNull();
    });
  });

  describe('a group that sits (edge/timetable, Exams, third row)', () => {
    it('cancels the group’s own lesson at the exam’s time, keeps the other group of its block, and refuses an exam longer than it', async () => {
      const s = await scene({ artPair: true });
      const art = s.art;
      if (art === null) throw new Error('No art.');
      const body = examOf(s, {
        date: THURSDAY,
        classIds: [],
        groupIds: [art.group],
        subjectId: art.subject,
        confirm: true,
      });
      refusedWith(await create(s.branch, { ...body, lastLesson: 2 }), 409, 'exam_group_slots');
      saved(await create(s.branch, body));
      expect((await lessonsOf(THURSDAY, { groupId: art.group }))[0]?.cancel_cause).toBe('exam');
      // The other group of the block keeps its lesson (code review round 1, change 6).
      const [kept] = await lessonsOf(THURSDAY, { groupId: art.pair ?? '' });
      expect(kept).toBeDefined();
      expect(kept?.cancel_cause).toBeNull();
      expect(kept?.block_id).toBe((await lessonsOf(THURSDAY, { groupId: art.group }))[0]?.block_id);
    });
  });

  describe('a cancel', () => {
    it('restores only the lessons it cancelled; one cancelled with a reason, and one of an exam week, stay cancelled; a second cancel is refused (done when)', async () => {
      const s = await scene({ double: true });
      const [own, week] = await lessonsOf(LATER_MONDAY, { classId: s.classId });
      if (own === undefined || week === undefined) throw new Error('No lessons.');
      // The first class's lesson 2 is cancelled "exam week" (edge/timetable, Exams, fifth row).
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'exam_week' })
        .where('id', '=', week.id)
        .execute();
      const other = await lessonOf(LATER_MONDAY, s.otherClass);
      const before = await request(t.kit.server)
        .post(`/api/timetable/lessons/${own.id}/cancel`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ reason: 'Excursion to the museum' });
      expect(before.status, JSON.stringify(before.body)).toBe(200);
      const exam = saved(
        await create(s.branch, examOf(s, { date: LATER_MONDAY, first: 1, last: 2 })),
      );
      expect(exam.exam.lessonIds).toEqual([other.id]);
      expect(await linksOf(week.id)).toEqual([]);
      expect(await linksOf(own.id)).toEqual([]);
      const cancelled = saved(await cancel(s.branch, exam.exam.id), 200);
      expect(cancelled.exam).toMatchObject({ cancelled: true, lessonIds: [] });
      expect(
        (await lessonsOf(LATER_MONDAY, { classId: s.classId })).map((one) => one.cancel_cause),
      ).toEqual(['reason', 'exam_week']);
      expect(await lessonOf(LATER_MONDAY, s.otherClass)).toMatchObject({
        cancel_cause: null,
        teacher_id: s.otherTeacher.staffId,
      });
      const [entry] = await t.entries('exam.cancel', exam.exam.id);
      expect(entry?.new_value).toMatchObject({ lessonsRestored: [other.id] });
      expect(
        NOTIFICATION_KINDS['timetable.exam_changed'].parse(
          (await noticesOf(s.invigilator.accountId)).at(-1)?.data,
        ),
      ).toMatchObject({ action: 'cancelled', invigilation: null });
      refusedWith(await cancel(s.branch, exam.exam.id), 409, 'exam_cancelled');
      refusedWith(
        await change(s.branch, exam.exam.id, examOf(s, { date: LATER_MONDAY })),
        409,
        'exam_cancelled',
      );
    });

    it('is refused when a lesson it cancelled cannot come back, with the free rooms; kept cancelled with a reason, the others come back', async () => {
      const s = await scene();
      const exam = saved(
        await create(s.branch, examOf(s, { date: LATER_MONDAY, classIds: [s.otherClass] })),
      );
      // The first class's lesson takes the other class's room for that day.
      const own = await lessonOf(LATER_MONDAY, s.classId);
      const moved = await request(t.kit.server)
        .post(`/api/timetable/lessons/${own.id}/room`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ roomId: s.otherRoom, reason: 'The room is painted' });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      const other = await lessonOf(LATER_MONDAY, s.otherClass);
      const before = await everything();
      const refused = await cancel(s.branch, exam.exam.id);
      refusedWith(refused, 409, 'exam_restore_blocked');
      expect(detailsOf(refused).some((one) => one.rule?.lessonIds.includes(other.id))).toBe(true);
      expect(detailsOf(refused).some((one) => one.room !== undefined)).toBe(true);
      expect(await everything()).toEqual(before);
      saved(
        await cancel(s.branch, exam.exam.id, {
          keepCancelled: [other.id],
          keepReason: 'The room is taken',
        }),
        200,
      );
      expect(await lessonOf(LATER_MONDAY, s.otherClass)).toMatchObject({
        cancel_cause: 'reason',
        cancel_reason: 'The room is taken',
      });
      expect(await linksOf(other.id)).toEqual([]);
    });
  });

  describe('a change', () => {
    it('moves the exam one lesson later: the lessons it leaves come back, the invigilator is told, a kept one only when the time changed', async () => {
      const s = await scene({ double: true });
      await pairUp(s, LATER_MONDAY);
      const exam = saved(
        await create(s.branch, examOf(s, { date: LATER_MONDAY, classIds: [s.otherClass] })),
      );
      const other = await lessonOf(LATER_MONDAY, s.otherClass);
      expect(other.cancel_cause).toBe('exam');
      const told = (await noticesOf(s.invigilator.accountId)).length;
      // The same exam with only its title changed tells nobody of an invigilation.
      saved(
        await change(s.branch, exam.exam.id, {
          ...examOf(s, { date: LATER_MONDAY, classIds: [s.otherClass] }),
          title: 'Quarter exam in algebra',
        }),
        200,
      );
      expect(await noticesOf(s.invigilator.accountId)).toHaveLength(told);
      // One lesson later with the same invigilator: the kept invigilator is
      // told, with the new time (code review round 1, change 6).
      const changed = saved(
        await change(
          s.branch,
          exam.exam.id,
          examOf(s, { date: LATER_MONDAY, classIds: [s.otherClass], first: 2 }),
        ),
        200,
      );
      expect(changed.exam).toMatchObject({ firstLesson: 2, start: 535, end: 580, lessonIds: [] });
      expect(await lessonOf(LATER_MONDAY, s.otherClass)).toMatchObject({ cancel_cause: null });
      expect(await linksOf(other.id)).toEqual([]);
      const kept = await noticesOf(s.invigilator.accountId);
      expect(kept).toHaveLength(told + 1);
      expect(NOTIFICATION_KINDS['timetable.exam_changed'].parse(kept.at(-1)?.data)).toMatchObject({
        action: 'changed',
        invigilation: { start: '08:55', end: '09:40' },
      });
      // Another invigilator at the same time: both are told.
      const replaced = await person(s.branch, [s.maths]);
      saved(
        await change(
          s.branch,
          exam.exam.id,
          examOf(s, {
            date: LATER_MONDAY,
            classIds: [s.otherClass],
            first: 2,
            invigilatorIds: [replaced.staffId],
          }),
        ),
        200,
      );
      expect(
        NOTIFICATION_KINDS['timetable.exam_changed'].parse(
          (await noticesOf(s.invigilator.accountId)).at(-1)?.data,
        ),
      ).toMatchObject({ action: 'changed', invigilation: null });
      expect(
        NOTIFICATION_KINDS['timetable.exam_changed'].parse(
          (await noticesOf(replaced.accountId)).at(-1)?.data,
        ),
      ).toMatchObject({ action: 'changed', invigilation: { start: '08:55', end: '09:40' } });
      // Over the first class's double at lesson 2: both halves go.
      const both = saved(
        await change(
          s.branch,
          exam.exam.id,
          examOf(s, {
            date: LATER_MONDAY,
            classIds: [s.classId],
            first: 2,
            invigilatorIds: [replaced.staffId],
          }),
        ),
        200,
      );
      expect(both.exam.lessonIds).toHaveLength(2);
    });

    it('moves the exam to another date of the year, giving the old date’s lessons back; another year is refused', async () => {
      const s = await scene();
      const exam = saved(
        await create(s.branch, examOf(s, { date: LATER_MONDAY, classIds: [s.otherClass] })),
      );
      const told = await noticesOf(s.otherTeacher.accountId);
      saved(
        await change(
          s.branch,
          exam.exam.id,
          examOf(s, { date: NEXT_MONDAY, classIds: [s.otherClass] }),
        ),
        200,
      );
      // One notice to the teacher, with the two weeks of the two dates.
      const notices = await noticesOf(s.otherTeacher.accountId);
      expect(notices).toHaveLength(told.length + 1);
      const data = NOTIFICATION_KINDS['timetable.exam_changed'].parse(notices.at(-1)?.data);
      expect([data.weekStart, data.also?.weekStart].sort()).toEqual([NEXT_MONDAY, LATER_MONDAY]);
      expect((await lessonOf(LATER_MONDAY, s.otherClass)).cancel_cause).toBeNull();
      expect((await lessonOf(NEXT_MONDAY, s.otherClass)).cancel_cause).toBe('exam');
      refusedWith(
        await change(
          s.branch,
          exam.exam.id,
          examOf(s, { date: '2027-07-05', classIds: [s.otherClass] }),
        ),
        409,
        'exam_year',
      );
    });

    it('refuses a change whose lesson given back has lost its room', async () => {
      const s = await scene();
      const exam = saved(
        await create(s.branch, examOf(s, { date: LATER_MONDAY, classIds: [s.otherClass] })),
      );
      const own = await lessonOf(LATER_MONDAY, s.classId);
      const moved = await request(t.kit.server)
        .post(`/api/timetable/lessons/${own.id}/room`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ roomId: s.otherRoom, reason: 'The room is painted' });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      refusedWith(
        await change(
          s.branch,
          exam.exam.id,
          examOf(s, { date: LATER_MONDAY, classIds: [s.otherClass], first: 2 }),
        ),
        409,
        'exam_restore_blocked',
      );
    });
  });

  describe('at the same moment', () => {
    it('two exams in one room: the first sent stands, the second is refused, in both orders', async () => {
      for (const firstWins of [true, false]) {
        const s = await scene();
        const other = await person(s.branch, [s.maths]);
        const a = () => create(s.branch, examOf(s, { classIds: [s.classId] }));
        const b = () =>
          create(
            s.branch,
            examOf(s, { classIds: [s.otherClass], invigilatorIds: [other.staffId] }),
          );
        const [one, two] = await inOrder(s.branch, firstWins ? a : b, firstWins ? b : a);
        saved(one);
        refusedWith(two, 409, 'exam_blocked');
      }
    });

    it('an exam and a one-day move of a lesson into its room on its date, in both orders', async () => {
      for (const examFirst of [true, false]) {
        const s = await scene();
        const own = await lessonOf(NEXT_MONDAY, s.classId);
        const exam = () => create(s.branch, examOf(s, { classIds: [s.otherClass] }));
        const move = () =>
          request(t.kit.server)
            .post(`/api/timetable/lessons/${own.id}/room`)
            .set('Cookie', t.admin)
            .set(BRANCH_HEADER, s.branch)
            .set(REQUEST_KEY_HEADER, randomUUID())
            .send({ roomId: s.hall, reason: 'The room is painted' });
        const [one, two] = await inOrder(
          s.branch,
          examFirst ? exam : move,
          examFirst ? move : exam,
        );
        expect(one.status, JSON.stringify(one.body)).toBe(examFirst ? 201 : 200);
        refusedWith(two, 409, examFirst ? 'day_change_blocked' : 'exam_blocked');
      }
    });

    it('a lesson of the invigilator written in another branch while the exam saves: the exam is refused and leaves nothing', async () => {
      const s = await scene();
      const south = await scene();
      // The invigilator also teaches in the other branch.
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: s.invigilator.staffId, branch_id: south.branch, is_main: false })
        .execute();
      const theirs = await lessonOf(NEXT_MONDAY, south.classId);
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
        .run([south.branch], async (transaction: Transaction) => {
          await transaction
            .updateTable('lessons')
            .set({ teacher_id: s.invigilator.staffId })
            .where('id', '=', theirs.id)
            .execute();
          await heldEntry(transaction, south.branch);
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await isReady;
      const before = await everything();
      const pending = create(s.branch, examOf(s));
      let early: Response | null = null;
      void pending.then((response) => {
        early = response;
      });
      try {
        await expect
          .poll(async () => (early === null ? await waiting() : -1), {
            timeout: 20_000,
            interval: 25,
          })
          .toBe(1);
      } finally {
        release();
      }
      expect(early === null ? null : (early as Response).body).toBeNull();
      expect(await held).toBeUndefined();
      const response = await pending;
      refusedWith(response, 409, 'exam_blocked');
      const after = await everything();
      // Only the held side's lesson and claim changed.
      // Every table but the held side's lesson and its claim (spec review of the code, should-fix 2).
      for (const index of [0, 1, 2, 3, 4, 5, 8, 9, 10, 11]) {
        expect(after[index]).toEqual(before[index]);
      }
      // In the other order the lesson's write is refused by the exam's claim.
      const exam = saved(await create(s.branch, examOf(s, { date: LATER_MONDAY })));
      expect(exam.exam.cancelled).toBe(false);
      const theirsLater = await lessonOf(LATER_MONDAY, south.classId);
      await expect(
        t.app
          .get(Transactions)
          .run([south.branch], (transaction: Transaction) =>
            transaction
              .updateTable('lessons')
              .set({ teacher_id: s.invigilator.staffId })
              .where('id', '=', theirsLater.id)
              .execute(),
          ),
      ).rejects.toMatchObject({ constraint: 'time_claims_teacher_excl' });
    });
  });

  describe('a publish and a withdraw over a standing exam (task 5.6c-3a; edge/timetable, Exams: "An exam is stored on its own like a one-day change and kept after a later publish")', () => {
    /** The rows of a version. */
    const rowsOfVersion = (version: string) =>
      t.database.migrator
        .selectFrom('teaching_load_rows')
        .select(['id', 'class_id', 'group_id', 'subject_id', 'teacher_id'])
        .where('version_id', '=', version)
        .orderBy('id')
        .execute();

    /**
     * A draft copied from the scene's version from Monday 19 October, its
     * lessons placed again by `place` (the copy's own pattern removed first),
     * as the bulk cancel tests do; `adjust` changes the copy's rows first.
     */
    async function draftOf(
      s: Scene,
      place: (version: string, rows: Awaited<ReturnType<typeof rowsOfVersion>>) => Promise<void> = (
        version,
        rows,
      ) => placeAsScene(s, version, rows),
    ) {
      const draft = await t.post('/api/timetable/versions', s.branch, {
        academicYearId: s.year,
        startsOn: NEXT_MONDAY,
        copyFrom: s.version,
      });
      expect(draft.status, JSON.stringify(draft.body)).toBe(201);
      const version = (draft.body as { id: string }).id;
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', version)
        .execute();
      await place(version, await rowsOfVersion(version));
      const confirmed = await t.post(
        `/api/timetable/versions/${version}/templates/confirm`,
        s.branch,
      );
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      await load.freeEditLock(version);
      return version;
    }

    /** The rows placed as the scene places them: maths on Monday in lesson 1, art on Thursday in lesson 1. */
    async function placeAsScene(
      s: Scene,
      version: string,
      rows: Awaited<ReturnType<typeof rowsOfVersion>>,
      artSlot = 1,
    ) {
      for (const row of rows) {
        if (row.group_id !== null) await placeAt(s.branch, version, row.id, 4, artSlot);
        else await placeAt(s.branch, version, row.id, 1);
      }
    }

    const check = async (branch: string, version: string) => {
      const response = await t.get(
        `/api/timetable/versions/${version}/publish-check?startsOn=${NEXT_MONDAY}`,
        branch,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const days = publishCheckSchema.parse(response.body).impact?.dayChanges;
      if (days === undefined) throw new Error('No preview.');
      return days;
    };

    const publishWith = (branch: string, version: string, body: object) =>
      request(t.kit.server)
        .post(`/api/timetable/versions/${version}/publish`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ startsOn: NEXT_MONDAY, ...body });

    const withdrawCheck = async (branch: string, version: string) => {
      const response = await t.get(`/api/timetable/versions/${version}/withdraw-check`, branch);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return withdrawCheckSchema.parse(response.body).dayChanges;
    };

    const withdrawWith = (branch: string, version: string, body: object) =>
      request(t.kit.server)
        .post(`/api/timetable/versions/${version}/withdraw`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send(body);

    const examRow = (id: string) =>
      t.database.migrator
        .selectFrom('exams')
        .select(['cancel_cause'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

    const publishedNotices = (accountId: string) =>
      t.database.migrator
        .selectFrom('notifications')
        .select(['kind', 'data'])
        .where('account_id', '=', accountId)
        .where('kind', '=', 'timetable.published')
        .orderBy('id')
        .execute();

    /**
     * The exam over lessons 1 and 2 of the first class on Monday 19 October,
     * and a new version from that day that adds the class's music in lesson
     * 2 and gives the other class's maths in lesson 1 to the invigilator: the
     * class's two lessons are covered, the invigilator's lesson clashes.
     */
    async function clashScene() {
      const s = await scene();
      const exam = saved(
        await create(s.branch, examOf(s, { classIds: [s.classId], first: 1, last: 2 })),
      );
      const music = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const singer = await person(s.branch, [music]);
      const version = await draftOf(s, async (draft, rows) => {
        for (const row of rows) {
          if (row.class_id === s.otherClass) {
            await t.database.migrator
              .updateTable('teaching_load_rows')
              .set({ teacher_id: s.invigilator.staffId })
              .where('id', '=', row.id)
              .execute();
          }
          await placeAt(s.branch, draft, row.id, 1);
        }
        const extra = await load.row({
          branch_id: s.branch,
          version_id: draft,
          class_id: s.classId,
          subject_id: music,
          teacher_id: singer.staffId,
          lessons_per_week: 1,
        });
        await placeAt(s.branch, draft, extra, 1, 3);
      });
      return { s, exam: exam.exam, music, singer, version };
    }

    it('keeps the exam over a publish: its classes’ new lessons cancelled "exam" with the link, the invigilator’s lesson "needs a decision" until settled (Done when)', async () => {
      const { s, exam, music, version } = await clashScene();
      const days = await check(s.branch, version);
      expect(days.exams).toHaveLength(1);
      const [item] = days.exams;
      expect(item).toMatchObject({
        key: exam.id,
        category: 'decide',
        date: NEXT_MONDAY,
        start: 480,
        end: 580,
        carriedVersionId: null,
        groupMisses: false,
        noTimetable: false,
        dropBlocked: [],
        blocks: [],
      });
      expect(item?.cancelled).toEqual([
        { unitId: s.classId, subjectId: s.maths, start: 480, end: 525 },
        { unitId: s.classId, subjectId: music, start: 535, end: 580 },
      ]);
      expect(item?.clashes).toEqual([
        { unitId: s.otherClass, subjectId: s.maths, start: 480, end: 525 },
      ]);
      expect(item?.blocked.length).toBeGreaterThan(0);
      const before = await everything();
      // Publish waits until the item is settled.
      const undecided = await publishWith(s.branch, version, { dayChangesKey: days.key });
      refusedWith(undecided, 409, 'publish_blocked');
      expect(detailsOf(undecided)).toContainEqual(
        expect.objectContaining({ code: 'day_change_undecided', path: `dayChanges.${exam.id}` }),
      );
      for (const decision of [
        { key: exam.id, choice: 'keep' },
        { key: exam.id, choice: 'cancel' },
        { key: exam.id, choice: 'drop', reason: 'Nothing stays cancelled' },
      ]) {
        await load.freeEditLock(version);
        const refused = await publishWith(s.branch, version, {
          dayChangesKey: days.key,
          dayDecisions: [decision],
        });
        refusedWith(refused, 409, 'publish_blocked');
        expect(detailsOf(refused)).toContainEqual(
          expect.objectContaining({
            code: 'day_choice_not_offered',
            path: `dayChanges.${exam.id}`,
          }),
        );
      }
      // Nothing was written by the refusals (refused before any write).
      expect(await everything()).toEqual(before);
      await load.freeEditLock(version);
      const published = await publishWith(s.branch, version, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: exam.id, choice: 'cancel', reason: 'The class sits elsewhere' }],
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(await examRow(exam.id)).toEqual({ cancel_cause: null });
      const own = await lessonsOf(NEXT_MONDAY, { classId: s.classId });
      expect(own.map((one) => [one.subject_id, one.cancel_cause])).toEqual([
        [s.maths, 'exam'],
        [music, 'exam'],
      ]);
      for (const one of own) expect(await linksOf(one.id)).toEqual([exam.id]);
      const theirs = await lessonOf(NEXT_MONDAY, s.otherClass);
      expect(theirs).toMatchObject({
        teacher_id: s.invigilator.staffId,
        cancel_cause: 'reason',
        cancel_reason: 'The class sits elsewhere',
      });
      expect(await linksOf(theirs.id)).toEqual([]);
      const [entry] = await t.entries('timetable_version.publish', version);
      expect(entry?.new_value).toMatchObject({
        exams: {
          kept: [],
          decided: [{ key: exam.id, choice: 'cancel', reason: 'The class sits elsewhere' }],
          written: [
            expect.objectContaining({
              id: exam.id,
              outcome: 'kept',
              cancelledWithReason: [theirs.id],
            }),
          ],
        },
      });
    });

    it('leaves the exam, its links, notices and audit as they were when the publish is refused at the commit after the exam’s write ran (.claude/rules/api.md, a refusal after the write)', async () => {
      const { s, exam, version } = await clashScene();
      // Another branch where the first class's teacher works too, with a lesson at the exam's time.
      const other = await scene();
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: s.teacher.staffId, branch_id: other.branch, is_main: false })
        .execute();
      const theirs = await lessonOf(NEXT_MONDAY, other.classId);
      const days = await check(s.branch, version);
      const before = await everything();
      // A transaction holds the exam's links: the publish's drop waits inside
      // the exam's write, after it has cancelled the exam.
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const held = t.database.migrator
        .transaction()
        .execute(async (transaction) => {
          await transaction
            .selectFrom('lesson_exam_cancels')
            .select('lesson_id')
            .where('exam_id', '=', exam.id)
            .forUpdate()
            .execute();
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await isReady;
      const pending = publishWith(s.branch, version, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: exam.id, choice: 'drop' }],
      }).then((response) => response);
      try {
        await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(1);
        // Meanwhile the teacher, free while the exam stands, takes the other
        // branch's lesson at its time: the drop's give-back now clashes.
        await t.database.migrator
          .updateTable('lessons')
          .set({ teacher_id: s.teacher.staffId })
          .where('id', '=', theirs.id)
          .execute();
      } finally {
        release();
      }
      expect(await held).toBeUndefined();
      const refused = await pending;
      refusedWith(refused, 409, 'timetable_busy');
      expect(await examRow(exam.id)).toEqual({ cancel_cause: null });
      const after = await everything();
      // Every table but the other branch's lesson and its claim, which the test changed.
      for (const index of [0, 1, 2, 3, 4, 5, 8, 9, 10, 11]) {
        expect(after[index]).toEqual(before[index]);
      }
      const own = await lessonsOf(NEXT_MONDAY, { classId: s.classId });
      // The stored lesson of the old version, still under the exam.
      expect(own.map((one) => one.cancel_cause)).toEqual(['exam']);
      for (const one of own) expect(await linksOf(one.id)).toEqual([exam.id]);
    });

    it('drops the exam with "drop": its classes’ lessons held, its links gone, its invigilator told once in the publish’s own notice (decisions 5 and 7)', async () => {
      const { s, exam, version } = await clashScene();
      const days = await check(s.branch, version);
      const toldBefore = (await publishedNotices(s.invigilator.accountId)).length;
      const teacherBefore = (await publishedNotices(s.teacher.accountId)).length;
      const published = await publishWith(s.branch, version, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: exam.id, choice: 'drop' }],
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(await examRow(exam.id)).toEqual({ cancel_cause: 'cancelled' });
      const own = await lessonsOf(NEXT_MONDAY, { classId: s.classId });
      expect(own.map((one) => one.cancel_cause)).toEqual([null, null]);
      for (const one of own) expect(await linksOf(one.id)).toEqual([]);
      expect(await lessonOf(NEXT_MONDAY, s.otherClass)).toMatchObject({
        teacher_id: s.invigilator.staffId,
        cancel_cause: null,
      });
      // The invigilator's week changed too: one notice, with the week and the exam.
      const told = (await publishedNotices(s.invigilator.accountId)).slice(toldBefore);
      expect(told).toHaveLength(1);
      const data = NOTIFICATION_KINDS['timetable.published'].parse(told[0]?.data);
      expect(data).toMatchObject({
        examsCancelled: [{ title: 'Quarter exam in maths', date: NEXT_MONDAY }],
      });
      expect('weekStart' in data).toBe(true);
      // The teacher whose lesson the drop gives back is told of the exam too.
      const teacher = (await publishedNotices(s.teacher.accountId)).slice(teacherBefore);
      expect(teacher).toHaveLength(1);
      expect(NOTIFICATION_KINDS['timetable.published'].parse(teacher[0]?.data)).toMatchObject({
        examsCancelled: [{ title: 'Quarter exam in maths', date: NEXT_MONDAY }],
      });
      expect(await noticesOf(s.invigilator.accountId)).toHaveLength(1); // the create's only
    });

    it('keeps an exam a publish leaves as it is: no decision, its lessons kept cancelled "exam" with their links', async () => {
      const s = await scene();
      const exam = saved(await create(s.branch, examOf(s))).exam;
      const version = await draftOf(s);
      const days = await check(s.branch, version);
      expect(days.exams).toEqual([
        expect.objectContaining({ key: exam.id, category: 'kept', blocked: [], clashes: [] }),
      ]);
      expect(days.exams[0]?.cancelled).toHaveLength(2);
      // A decision for a kept exam names no item.
      const unknown = await publishWith(s.branch, version, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: exam.id, choice: 'drop' }],
      });
      refusedWith(unknown, 409, 'publish_blocked');
      expect(detailsOf(unknown)).toContainEqual(
        expect.objectContaining({ code: 'day_decision_unknown' }),
      );
      await load.freeEditLock(version);
      const published = await publishWith(s.branch, version, { dayChangesKey: days.key });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      const lessons = [
        ...(await lessonsOf(NEXT_MONDAY, { classId: s.classId })),
        ...(await lessonsOf(NEXT_MONDAY, { classId: s.otherClass })),
      ];
      expect(lessons).toHaveLength(2);
      for (const one of lessons) {
        expect(one.cancel_cause).toBe('exam');
        expect(await linksOf(one.id)).toEqual([exam.id]);
      }
    });

    it('carries a stored "keep" to the new version’s block of the same lessons, and asks again for a block whose lesson changed, deciding against the stored choice (decision 3)', async () => {
      const s = await scene({ art: true });
      const art = s.art;
      if (art === null) throw new Error('No art.');
      const [block] = await lessonsOf(THURSDAY, { groupId: art.group });
      if (block === undefined) throw new Error('No art lesson.');
      const exam = saved(
        await create(
          s.branch,
          examOf(s, {
            date: THURSDAY,
            classIds: [s.classId],
            blockChoices: [{ classId: s.classId, blockId: block.block_id, choice: 'keep' }],
          }),
        ),
      ).exam;
      const same = await draftOf(s);
      const days = await check(s.branch, same);
      expect(days.exams).toEqual([
        expect.objectContaining({
          key: exam.id,
          category: 'kept',
          blocks: [
            expect.objectContaining({
              blockDate: THURSDAY,
              sittingClassIds: [s.classId],
              otherClassIds: [art.eighth],
              choice: 'keep',
            }),
          ],
        }),
      ]);
      expect(days.exams[0]?.cancelled).toEqual([]);
      // The same version with another art teacher: the block is asked again.
      const otherArt = await person(s.branch, [art.subject], [7, 8]);
      const changed = await draftOf(s, async (draft, rows) => {
        for (const row of rows) {
          if (row.group_id === art.group) {
            await t.database.migrator
              .updateTable('teaching_load_rows')
              .set({ teacher_id: otherArt.staffId })
              .where('id', '=', row.id)
              .execute();
          }
        }
        await placeAsScene(s, draft, rows);
      });
      const asked = await check(s.branch, changed);
      const [item] = asked.exams;
      expect(item).toMatchObject({ category: 'decide', blocked: [] });
      const [open] = item?.blocks ?? [];
      expect(open).toMatchObject({ choice: null, otherClassIds: [art.eighth] });
      if (open === undefined) throw new Error('No block.');
      const undecided = await publishWith(s.branch, changed, { dayChangesKey: asked.key });
      refusedWith(undecided, 409, 'publish_blocked');
      expect(detailsOf(undecided)).toContainEqual(
        expect.objectContaining({
          code: 'day_change_undecided',
          path: `dayChanges.${exam.id}.blocks.${open.blockId}.${THURSDAY}`,
        }),
      );
      // A drop on a block is not offered.
      await load.freeEditLock(changed);
      const wrong = await publishWith(s.branch, changed, {
        dayChangesKey: asked.key,
        dayDecisions: [
          { key: exam.id, blockId: open.blockId, blockDate: THURSDAY, choice: 'drop' },
        ],
      });
      refusedWith(wrong, 409, 'publish_blocked');
      expect(detailsOf(wrong)).toContainEqual(
        expect.objectContaining({ code: 'day_choice_not_offered' }),
      );
      await load.freeEditLock(changed);
      const published = await publishWith(s.branch, changed, {
        dayChangesKey: asked.key,
        dayDecisions: [
          { key: exam.id, blockId: open.blockId, blockDate: THURSDAY, choice: 'cancel' },
        ],
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      // Against the stored "keep": the whole block cancelled "exam", the out row gone.
      const artLessons = await lessonsOf(THURSDAY, { groupId: art.group });
      expect(artLessons.map((one) => [one.teacher_id, one.cancel_cause])).toEqual([
        [otherArt.staffId, 'exam'],
      ]);
      expect(await linksOf(artLessons[0]?.id ?? '')).toEqual([exam.id]);
      const outs = await t.database.migrator
        .selectFrom('lesson_block_class_outs')
        .select('block_id')
        .where('exam_id', '=', exam.id)
        .execute();
      expect(outs).toEqual([]);
    });

    it('removes with its block the out row of a block the new version takes away, with no 500, and keeps the exam (the former publish_over_exam)', async () => {
      const s = await scene({ art: true });
      const art = s.art;
      if (art === null) throw new Error('No art.');
      const [block] = await lessonsOf(THURSDAY, { groupId: art.group });
      if (block === undefined) throw new Error('No art lesson.');
      const exam = saved(
        await create(
          s.branch,
          examOf(s, {
            date: THURSDAY,
            classIds: [s.classId],
            blockChoices: [{ classId: s.classId, blockId: block.block_id, choice: 'keep' }],
          }),
        ),
      ).exam;
      const version = await draftOf(s, async (draft, rows) => {
        await t.database.migrator
          .deleteFrom('teaching_load_rows')
          .where('version_id', '=', draft)
          .where('group_id', '=', art.group)
          .execute();
        for (const row of rows) {
          if (row.group_id === null) await placeAt(s.branch, draft, row.id, 1);
        }
      });
      const days = await check(s.branch, version);
      expect(days.exams).toEqual([
        expect.objectContaining({ key: exam.id, category: 'kept', blocks: [], cancelled: [] }),
      ]);
      const published = await publishWith(s.branch, version, { dayChangesKey: days.key });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(await examRow(exam.id)).toEqual({ cancel_cause: null });
      expect(await lessonsOf(THURSDAY, { groupId: art.group })).toEqual([]);
      const outs = await t.database.migrator
        .selectFrom('lesson_block_class_outs')
        .select('block_id')
        .where('exam_id', '=', exam.id)
        .execute();
      expect(outs).toEqual([]);
      const [entry] = await t.entries('timetable_version.publish', version);
      expect(entry?.new_value).toMatchObject({
        exams: {
          kept: [exam.id],
          written: [
            expect.objectContaining({
              outsRemoved: [{ blockId: block.block_id, classId: s.classId }],
            }),
          ],
        },
      });
    });

    it('drops only an exam whose sitting group’s own lesson the new version moves (decision 4)', async () => {
      const s = await scene({ art: true });
      const art = s.art;
      if (art === null) throw new Error('No art.');
      const exam = saved(
        await create(
          s.branch,
          examOf(s, {
            date: THURSDAY,
            classIds: [],
            groupIds: [art.group],
            subjectId: art.subject,
            confirm: true,
          }),
        ),
      ).exam;
      const version = await draftOf(s, (draft, rows) => placeAsScene(s, draft, rows, 3));
      const days = await check(s.branch, version);
      expect(days.exams).toEqual([
        expect.objectContaining({ key: exam.id, category: 'decide', groupMisses: true }),
      ]);
      const cancelled = await publishWith(s.branch, version, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: exam.id, choice: 'cancel', reason: 'Moved' }],
      });
      refusedWith(cancelled, 409, 'publish_blocked');
      expect(detailsOf(cancelled)).toContainEqual(
        expect.objectContaining({ code: 'day_choice_not_offered' }),
      );
      await load.freeEditLock(version);
      const published = await publishWith(s.branch, version, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: exam.id, choice: 'drop' }],
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(await examRow(exam.id)).toEqual({ cancel_cause: 'cancelled' });
      const moved = await lessonsOf(THURSDAY, { groupId: art.group });
      expect(moved.map((one) => one.cancel_cause)).toEqual([null]);
    });

    it('keeps cancelled with the drop’s reason a lesson the drop cannot give back: a kept room change took its room (plan review correction 1)', async () => {
      const s = await scene();
      const exam = saved(
        await create(s.branch, examOf(s, { classIds: [s.classId], first: 1, last: 2 })),
      ).exam;
      // The other class's Monday lesson moves into the first class's room,
      // free while the exam cancels the first class's lesson.
      const theirs = await lessonOf(NEXT_MONDAY, s.otherClass);
      const moved = await request(t.kit.server)
        .post(`/api/timetable/lessons/${theirs.id}/room`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ roomId: s.room, reason: 'Projector' });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      // The new version gives the invigilator a lesson of a third class at the exam's time.
      const third = await load.classes.schoolClass(s.branch, s.year, { grade: 7 });
      const version = await draftOf(s, async (draft, rows) => {
        await placeAsScene(s, draft, rows);
        const extra = await load.row({
          branch_id: s.branch,
          version_id: draft,
          class_id: third,
          subject_id: s.maths,
          teacher_id: s.invigilator.staffId,
          lessons_per_week: 1,
        });
        await placeAt(s.branch, draft, extra, 1);
      });
      const days = await check(s.branch, version);
      expect(days, JSON.stringify(days)).toMatchObject({ kept: [expect.anything()] });
      const [item] = days.exams;
      expect(item?.dropBlocked).toEqual([
        { unitId: s.classId, subjectId: s.maths, start: 480, end: 525 },
      ]);
      const bare = await publishWith(s.branch, version, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: exam.id, choice: 'drop' }],
      });
      refusedWith(bare, 409, 'publish_blocked');
      expect(detailsOf(bare)).toContainEqual(
        expect.objectContaining({ code: 'day_choice_not_offered' }),
      );
      await load.freeEditLock(version);
      const published = await publishWith(s.branch, version, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: exam.id, choice: 'drop', reason: 'Room taken' }],
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(await examRow(exam.id)).toEqual({ cancel_cause: 'cancelled' });
      expect(await lessonOf(NEXT_MONDAY, s.classId)).toMatchObject({
        cancel_cause: 'reason',
        cancel_reason: 'Room taken',
      });
      expect(await lessonOf(NEXT_MONDAY, s.otherClass)).toMatchObject({
        room_id: s.room,
        cancel_cause: null,
      });
      expect(await lessonOf(NEXT_MONDAY, third)).toMatchObject({
        teacher_id: s.invigilator.staffId,
        cancel_cause: null,
      });
    });

    it('lists the exams of a withdraw that leaves their dates with no timetable, settled only by "drop" (decision 6)', async () => {
      const s = await scene();
      const exam = saved(await create(s.branch, examOf(s))).exam;
      const days = await withdrawCheck(s.branch, s.version);
      expect(days.exams).toEqual([
        expect.objectContaining({ key: exam.id, category: 'decide', noTimetable: true }),
      ]);
      const before = await everything();
      const undecided = await withdrawWith(s.branch, s.version, { dayChangesKey: days.key });
      refusedWith(undecided, 409, 'withdraw_blocked');
      expect(detailsOf(undecided)).toContainEqual(
        expect.objectContaining({ code: 'day_change_undecided' }),
      );
      const wrong = await withdrawWith(s.branch, s.version, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: exam.id, choice: 'cancel', reason: 'No timetable' }],
      });
      refusedWith(wrong, 409, 'withdraw_blocked');
      expect(await everything()).toEqual(before);
      const done = await withdrawWith(s.branch, s.version, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: exam.id, choice: 'drop' }],
      });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(await examRow(exam.id)).toEqual({ cancel_cause: 'cancelled' });
      expect(await lessonsOf(NEXT_MONDAY, { classId: s.classId })).toEqual([]);
      const told = await t.database.migrator
        .selectFrom('notifications')
        .select('data')
        .where('account_id', '=', s.invigilator.accountId)
        .where('kind', '=', 'timetable.withdrawn')
        .execute();
      expect(told).toHaveLength(1);
      const data = NOTIFICATION_KINDS['timetable.withdrawn'].parse(told[0]?.data);
      // The invigilator's week did not change: the exam alone, no week.
      expect('weekStart' in data).toBe(false);
      expect(data).toMatchObject({
        examsCancelled: [{ title: 'Quarter exam in maths', date: NEXT_MONDAY }],
      });
    });

    it('answers 404 for a decision naming another branch’s exam or block or an unknown one, on the publish and the withdraw, as each role that may send them, with every row of both branches unchanged (.claude/rules/api.md)', async () => {
      /**
       * A branch with an exam that keeps its class out of the art block (an
       * out row) and an exam over the Monday lessons (links), and a draft.
       */
      const branchScene = async () => {
        const s = await scene({ art: true });
        const art = s.art;
        if (art === null) throw new Error('No art.');
        const [block] = await lessonsOf(THURSDAY, { groupId: art.group });
        if (block === undefined) throw new Error('No art lesson.');
        const kept = saved(
          await create(
            s.branch,
            examOf(s, {
              date: THURSDAY,
              classIds: [s.classId],
              blockChoices: [{ classId: s.classId, blockId: block.block_id, choice: 'keep' }],
            }),
          ),
        ).exam;
        const monday = saved(await create(s.branch, examOf(s))).exam;
        return { s, kept, monday, version: await draftOf(s) };
      };
      const own = await branchScene();
      const theirs = await branchScene();
      const { s } = own;
      const vice = await t.kit.completeSession('Dilnoza', 'Yusupova');
      await t.kit.giveRole(vice.account.id, {
        role: 'academic_vice_principal',
        branchId: s.branch,
      });
      const days = await check(s.branch, own.version);
      const ownBlock = days.exams.find((one) => one.key === own.kept.id)?.blocks[0]?.blockId;
      const theirDays = await check(theirs.s.branch, theirs.version);
      const theirBlock = theirDays.exams.find((one) => one.key === theirs.kept.id)?.blocks[0]
        ?.blockId;
      if (ownBlock === undefined || theirBlock === undefined) throw new Error('No blocks.');
      const before = await everything();
      // Rows of both branches in every table the routes write.
      // (`everything` reads every branch of the file: both of these are among them.)
      const branchesOf = (rows: readonly { branch_id: string }[]) => [
        ...new Set(rows.map((one) => one.branch_id)),
      ];
      for (const index of [0, 4, 5, 6, 7]) {
        expect(branchesOf(before[index] as { branch_id: string }[])).toEqual(
          expect.arrayContaining([s.branch, theirs.s.branch]),
        );
      }
      const wrong = [
        { key: theirs.kept.id, choice: 'drop' },
        { key: UNKNOWN, choice: 'drop' },
        { key: own.kept.id, blockId: theirBlock, blockDate: THURSDAY, choice: 'cancel' },
        { key: own.kept.id, blockId: UNKNOWN, blockDate: THURSDAY, choice: 'cancel' },
      ];
      for (const cookie of [t.admin, vice.cookie]) {
        for (const decision of wrong) {
          await load.freeEditLock(own.version);
          refusedWith(
            await request(t.kit.server)
              .post(`/api/timetable/versions/${own.version}/publish`)
              .set('Cookie', cookie)
              .set(BRANCH_HEADER, s.branch)
              .set(REQUEST_KEY_HEADER, randomUUID())
              .send({ startsOn: NEXT_MONDAY, dayChangesKey: days.key, dayDecisions: [decision] }),
            404,
            'not_found',
          );
          refusedWith(
            await request(t.kit.server)
              .post(`/api/timetable/versions/${s.version}/withdraw`)
              .set('Cookie', cookie)
              .set(BRANCH_HEADER, s.branch)
              .set(REQUEST_KEY_HEADER, randomUUID())
              .send({ dayDecisions: [decision] }),
            404,
            'not_found',
          );
        }
      }
      expect(await everything()).toEqual(before);
      // A reason on a decision that is not an exam's is not offered.
      const lesson = await lessonOf(NEXT_MONDAY, s.otherClass);
      await load.freeEditLock(own.version);
      const reasoned = await publishWith(s.branch, own.version, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: lesson.id, choice: 'drop', reason: 'Not an exam' }],
      });
      refusedWith(reasoned, 409, 'publish_blocked');
      expect(detailsOf(reasoned)).toContainEqual(
        expect.objectContaining({
          code: 'day_choice_not_offered',
          path: `dayChanges.${lesson.id}`,
        }),
      );
      // A used key with another reason is another request; with another
      // branch's exam it is 404, never the stored answer.
      const key = randomUUID();
      const send = (dayDecisions: object[]) =>
        request(t.kit.server)
          .post(`/api/timetable/versions/${own.version}/publish`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, s.branch)
          .set(REQUEST_KEY_HEADER, key)
          .send({ startsOn: NEXT_MONDAY, dayChangesKey: days.key, dayDecisions });
      await load.freeEditLock(own.version);
      const done = await send([]);
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      refusedWith(
        await send([{ key: own.kept.id, choice: 'drop', reason: 'Another reason' }]),
        409,
        'request_key_reused',
      );
      refusedWith(await send([{ key: theirs.kept.id, choice: 'drop' }]), 404, 'not_found');
    });

    it('covers both halves of a double "exam" and cancels both halves of a clashing double with "cancel" (06, Exam; edge/timetable, Structure)', async () => {
      const s = await scene({ double: true });
      await pairUp(s, NEXT_MONDAY);
      const exam = saved(await create(s.branch, examOf(s, { classIds: [s.classId] }))).exam;
      const third = await load.classes.schoolClass(s.branch, s.year, { grade: 7 });
      const version = await draftOf(s, async (draft, rows) => {
        for (const row of rows) {
          await placeAt(s.branch, draft, row.id, 1);
          if (row.class_id === s.classId) await placeAt(s.branch, draft, row.id, 1, 3);
        }
        // A double of a third class taught by the invigilator in lessons 1 and 2.
        const extra = await load.row({
          branch_id: s.branch,
          version_id: draft,
          class_id: third,
          subject_id: s.maths,
          teacher_id: s.invigilator.staffId,
          lessons_per_week: 2,
          double_lessons: true,
        });
        await placeAt(s.branch, draft, extra, 1);
        await placeAt(s.branch, draft, extra, 1, 3);
        // Each row's two blocks one double pair, as the stored ones are (`pairUp`).
        const doubled = rows.filter((row) => row.class_id === s.classId).map((row) => row.id);
        for (const rowId of [...doubled, extra]) {
          const entries = await t.database.migrator
            .selectFrom('pattern_entries')
            .select('block_id')
            .where('load_row_id', '=', rowId)
            .execute();
          expect(entries).toHaveLength(2);
          await t.database.migrator
            .updateTable('pattern_blocks')
            .set({ double_pair_id: randomUUID() })
            .where(
              'id',
              'in',
              entries.map((one) => one.block_id),
            )
            .execute();
        }
      });
      const days = await check(s.branch, version);
      const [item] = days.exams;
      expect(item?.cancelled).toEqual([
        { unitId: s.classId, subjectId: s.maths, start: 480, end: 525 },
        { unitId: s.classId, subjectId: s.maths, start: 535, end: 580 },
      ]);
      expect(item?.clashes).toEqual([
        { unitId: third, subjectId: s.maths, start: 480, end: 525 },
        { unitId: third, subjectId: s.maths, start: 535, end: 580 },
      ]);
      const published = await publishWith(s.branch, version, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: exam.id, choice: 'cancel', reason: 'Double in the hall' }],
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      const own = await lessonsOf(NEXT_MONDAY, { classId: s.classId });
      expect(own.map((one) => one.cancel_cause)).toEqual(['exam', 'exam']);
      for (const one of own) expect(await linksOf(one.id)).toEqual([exam.id]);
      const theirs = await lessonsOf(NEXT_MONDAY, { classId: third });
      expect(theirs.map((one) => [one.cancel_cause, one.cancel_reason])).toEqual([
        ['reason', 'Double in the hall'],
        ['reason', 'Double in the hall'],
      ]);
    });

    it('keeps the two choices of one class’s two shared blocks, each by its own block (.claude/rules/timetable.md, choices per block)', async () => {
      const s = await scene({ artTwice: true });
      const art = s.art;
      if (art === null) throw new Error('No art.');
      const blocksOf = async () => lessonsOf(THURSDAY, { groupId: art.group });
      const [first, second] = await blocksOf();
      if (first === undefined || second === undefined) throw new Error('No art lessons.');
      const exam = saved(
        await create(
          s.branch,
          examOf(s, {
            date: THURSDAY,
            classIds: [s.classId],
            first: 1,
            last: 2,
            blockChoices: [
              { classId: s.classId, blockId: first.block_id, choice: 'keep' },
              { classId: s.classId, blockId: second.block_id, choice: 'cancel' },
            ],
          }),
        ),
      ).exam;
      const version = await draftOf(s, async (draft, rows) => {
        for (const row of rows) {
          if (row.group_id !== null) {
            await placeAt(s.branch, draft, row.id, 4);
            await placeAt(s.branch, draft, row.id, 4, 3);
          } else {
            await placeAt(s.branch, draft, row.id, 1);
          }
        }
      });
      const days = await check(s.branch, version);
      const [item] = days.exams;
      expect(item?.category).toBe('kept');
      expect(item?.blocks.map((one) => [one.start, one.choice])).toEqual([
        [480, 'keep'],
        [535, 'cancel'],
      ]);
      const published = await publishWith(s.branch, version, { dayChangesKey: days.key });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      const [one, two] = await blocksOf();
      expect([one?.cancel_cause, two?.cancel_cause]).toEqual([null, 'exam']);
      const outs = await t.database.migrator
        .selectFrom('lesson_block_class_outs')
        .select(['block_id', 'class_id'])
        .where('exam_id', '=', exam.id)
        .execute();
      expect(outs).toEqual([{ block_id: one?.block_id, class_id: s.classId }]);
    });

    it('lists a new lesson in an exam room at the exam’s time, and not one in that room outside it', async () => {
      const s = await scene();
      // The exam in lesson 2 in the other class's home room, free then.
      const exam = saved(
        await create(s.branch, examOf(s, { classIds: [s.classId], first: 2, roomId: s.otherRoom })),
      ).exam;
      const music = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const singer = await person(s.branch, [music]);
      const version = await draftOf(s, async (draft, rows) => {
        await placeAsScene(s, draft, rows);
        const extra = await load.row({
          branch_id: s.branch,
          version_id: draft,
          class_id: s.otherClass,
          subject_id: music,
          teacher_id: singer.staffId,
          lessons_per_week: 2,
        });
        // The other class's music in its room in lessons 2 and 3.
        await placeAt(s.branch, draft, extra, 1, 3);
        await placeAt(s.branch, draft, extra, 1, 5);
      });
      const days = await check(s.branch, version);
      const [item] = days.exams;
      expect(item).toMatchObject({ key: exam.id, category: 'decide' });
      expect(item?.clashes).toEqual([
        { unitId: s.otherClass, subjectId: music, start: 535, end: 580 },
      ]);
    });

    it('drops an exam with an out row over a withdraw that leaves no timetable: the out row goes with its block, no 500', async () => {
      const s = await scene({ art: true });
      const art = s.art;
      if (art === null) throw new Error('No art.');
      const [block] = await lessonsOf(THURSDAY, { groupId: art.group });
      if (block === undefined) throw new Error('No art lesson.');
      const exam = saved(
        await create(
          s.branch,
          examOf(s, {
            date: THURSDAY,
            classIds: [s.classId],
            blockChoices: [{ classId: s.classId, blockId: block.block_id, choice: 'keep' }],
          }),
        ),
      ).exam;
      const days = await withdrawCheck(s.branch, s.version);
      expect(days.exams).toEqual([
        expect.objectContaining({ key: exam.id, category: 'decide', noTimetable: true }),
      ]);
      const done = await withdrawWith(s.branch, s.version, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: exam.id, choice: 'drop' }],
      });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(await examRow(exam.id)).toEqual({ cancel_cause: 'cancelled' });
      const outs = await t.database.migrator
        .selectFrom('lesson_block_class_outs')
        .select('block_id')
        .where('exam_id', '=', exam.id)
        .execute();
      expect(outs).toEqual([]);
    });

    it('meets an invigilator’s lesson by clock time: grade 8’s lesson 1 over grade 7’s lesson 2 (.claude/rules/timetable.md, real clock time, never slot numbers)', async () => {
      const s = await scene({ eighthLong: true });
      const eighth = await load.classes.schoolClass(s.branch, s.year, { grade: 8 });
      const physics = await load.classes.subject({ grades: [8], journalType: 'attendance_only' });
      const watcher = await person(s.branch, [physics], [8]);
      // The exam in grade 7's lesson 2 (08:55–09:40), invigilated by a teacher of grade 8.
      const exam = saved(
        await create(
          s.branch,
          examOf(s, {
            classIds: [s.classId],
            first: 2,
            invigilatorIds: [watcher.staffId],
            confirm: true,
          }),
        ),
      ).exam;
      expect(exam).toMatchObject({ start: 535, end: 580 });
      const version = await draftOf(s, async (draft, rows) => {
        await placeAsScene(s, draft, rows);
        const extra = await load.row({
          branch_id: s.branch,
          version_id: draft,
          class_id: eighth,
          subject_id: physics,
          teacher_id: watcher.staffId,
          lessons_per_week: 1,
        });
        // Grade 8's lesson 1: 08:00–09:00.
        await placeAt(s.branch, draft, extra, 1);
      });
      const days = await check(s.branch, version);
      const [item] = days.exams;
      expect(item).toMatchObject({ key: exam.id, category: 'decide' });
      expect(item?.blocked.map((one) => one.rule)).toContain('teacher_double');
      expect(item?.clashes).toEqual([{ unitId: eighth, subjectId: physics, start: 480, end: 540 }]);
    });

    it('serialises a publish and an exam save on the publish lock: the exam saved first refuses the publish shown before it, the publish first lets the exam save over the new lessons', async () => {
      const s = await scene();
      const version = await draftOf(s);
      const days = await check(s.branch, version);
      expect(days.exams).toEqual([]);
      const [published, created] = await inOrder(
        s.branch,
        () => publishWith(s.branch, version, { dayChangesKey: days.key }),
        () => create(s.branch, examOf(s, { date: LATER_MONDAY })),
      );
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      const exam = saved(created).exam;
      for (const one of await lessonsOf(LATER_MONDAY, { classId: s.classId })) {
        expect(one.cancel_cause).toBe('exam');
        expect(await linksOf(one.id)).toEqual([exam.id]);
      }
      // The other order: the exam first, then a publish with the key shown before it.
      const t2 = await scene();
      const later = await draftOf(t2);
      const shown = await check(t2.branch, later);
      const [made, refused] = await inOrder(
        t2.branch,
        () => create(t2.branch, examOf(t2)),
        () => publishWith(t2.branch, later, { dayChangesKey: shown.key }),
      );
      saved(made);
      refusedWith(refused, 409, 'publish_blocked');
      expect(detailsOf(refused)).toContainEqual(
        expect.objectContaining({ code: 'day_changes_changed' }),
      );
    });

    it('serialises a withdraw and an exam save: the exam saved first refuses the withdraw shown before it, the withdraw first refuses the exam with no timetable', async () => {
      const s = await scene();
      const shown = await withdrawCheck(s.branch, s.version);
      const [made, refused] = await inOrder(
        s.branch,
        () => create(s.branch, examOf(s)),
        () => withdrawWith(s.branch, s.version, { dayChangesKey: shown.key }),
      );
      saved(made);
      refusedWith(refused, 409, 'withdraw_blocked');
      expect(detailsOf(refused)).toContainEqual(
        expect.objectContaining({ code: 'day_changes_changed' }),
      );
      const s2 = await scene();
      const shown2 = await withdrawCheck(s2.branch, s2.version);
      const [withdrawn, late] = await inOrder(
        s2.branch,
        () => withdrawWith(s2.branch, s2.version, { dayChangesKey: shown2.key }),
        () => create(s2.branch, examOf(s2)),
      );
      expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
      refusedWith(late, 409, 'exam_no_timetable');
    });

    it('offers no "keep" for a block whose lesson, kept for the other classes, the invigilator teaches, and settles it with "cancel" (spec review of the code, must-fix 4)', async () => {
      const s = await scene({ art: true });
      const art = s.art;
      if (art === null) throw new Error('No art.');
      const [block] = await lessonsOf(THURSDAY, { groupId: art.group });
      if (block === undefined) throw new Error('No art lesson.');
      // Another art teacher invigilates; the art block is cancelled whole for the exam.
      const otherArt = await person(s.branch, [art.subject], [7, 8]);
      const exam = saved(
        await create(
          s.branch,
          examOf(s, {
            date: THURSDAY,
            classIds: [s.classId],
            invigilatorIds: [otherArt.staffId],
            confirm: true,
            blockChoices: [{ classId: s.classId, blockId: block.block_id, choice: 'cancel' }],
          }),
        ),
      ).exam;
      // The new version gives the art group to the invigilator: the block is asked again.
      const version = await draftOf(s, async (draft, rows) => {
        for (const row of rows) {
          if (row.group_id === art.group) {
            await t.database.migrator
              .updateTable('teaching_load_rows')
              .set({ teacher_id: otherArt.staffId })
              .where('id', '=', row.id)
              .execute();
          }
        }
        await placeAsScene(s, draft, rows);
      });
      const days = await check(s.branch, version);
      const open = days.exams[0]?.blocks[0];
      if (open === undefined) throw new Error('No block.');
      expect(open).toMatchObject({ choice: null, keepOffered: false });
      const before = await everything();
      const refused = await publishWith(s.branch, version, {
        dayChangesKey: days.key,
        dayDecisions: [
          { key: exam.id, blockId: open.blockId, blockDate: THURSDAY, choice: 'keep' },
        ],
      });
      refusedWith(refused, 409, 'publish_blocked');
      expect(detailsOf(refused)).toContainEqual(
        expect.objectContaining({
          code: 'day_choice_not_offered',
          path: `dayChanges.${exam.id}.blocks.${open.blockId}.${THURSDAY}`,
        }),
      );
      expect(await everything()).toEqual(before);
      await load.freeEditLock(version);
      const published = await publishWith(s.branch, version, {
        dayChangesKey: days.key,
        dayDecisions: [
          { key: exam.id, blockId: open.blockId, blockDate: THURSDAY, choice: 'cancel' },
        ],
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      const artLessons = await lessonsOf(THURSDAY, { groupId: art.group });
      expect(artLessons.map((one) => one.cancel_cause)).toEqual(['exam']);
    });
  });

  describe('a started exam or lesson (06, Exam: "only in slots that have not started")', () => {
    /** An Academic Vice Principal of the branch, signed in now. */
    const viceAt = async (branch: string) => {
      const browser = await t.kit.completeSession('Gulnora', 'Tursunova');
      await t.kit.giveRole(browser.account.id, {
        role: 'academic_vice_principal',
        branchId: branch,
      });
      return browser.cookie;
    };

    it('refuses an exam whose slot or whose lesson’s earlier half has started, and a change and a cancel of a started exam', async () => {
      const s = await scene({ double: true });
      await pairUp(s, NEXT_MONDAY);
      const second = await person(s.branch, [s.maths]);
      // Made before the clock moves: an exam of the other class in lesson 1,
      // and one of the first class over lesson 2, which takes both halves.
      const early = saved(await create(s.branch, examOf(s, { classIds: [s.otherClass] })));
      const later = saved(
        await create(
          s.branch,
          examOf(s, {
            classIds: [s.classId],
            first: 2,
            roomId: s.spareRoom,
            invigilatorIds: [second.staffId],
          }),
        ),
      );
      expect(later.exam.lessonIds).toHaveLength(2);
      // 08:30 on Monday 19 October: lesson 1 has started, lesson 2 has not.
      t.clock.set('2026-10-19T08:30:00+05:00');
      // A session of its own, signed in at the moved moment: the kit's sessions
      // would end as idle and stay ended for the tests that follow.
      const vice = await viceAt(s.branch);
      try {
        // The list says which exams have started, by the server's moment
        // (task 5.6c-2, plan test 10a); before the clock moved, none had.
        expect([early.exam.started, later.exam.started]).toEqual([false, false]);
        const listed = await t.get(
          `/api/timetable/exams?from=${NEXT_MONDAY}&to=${NEXT_MONDAY}`,
          s.branch,
          vice,
        );
        expect(listed.status, JSON.stringify(listed.body)).toBe(200);
        expect(
          examsAnswerSchema.parse(listed.body).exams.map((one) => [one.id, one.started]),
        ).toEqual([
          [early.exam.id, true],
          [later.exam.id, false],
        ]);
        // The single exam says the same (permission review should-fix 2).
        const single = await t.get(`/api/timetable/exams/${early.exam.id}`, s.branch, vice);
        expect(single.status, JSON.stringify(single.body)).toBe(200);
        expect(examSchema.parse(single.body).started).toBe(true);
        const third = await person(s.branch, [s.maths]);
        refusedWith(
          await create(
            s.branch,
            examOf(s, {
              classIds: [s.otherClass],
              roomId: s.room,
              invigilatorIds: [third.staffId],
            }),
            vice,
          ),
          409,
          'exam_started',
        );
        refusedWith(
          await change(s.branch, early.exam.id, examOf(s, { classIds: [s.otherClass] }), vice),
          409,
          'exam_started',
        );
        refusedWith(await cancel(s.branch, early.exam.id, {}, vice), 409, 'exam_started');
        // Lesson 2 has not started, but the earlier half of its double has.
        refusedWith(await cancel(s.branch, later.exam.id, {}, vice), 409, 'exam_started');
      } finally {
        t.clock.set(START);
      }
      const other = await scene({ double: true });
      await pairUp(other, NEXT_MONDAY);
      t.clock.set('2026-10-19T08:30:00+05:00');
      // A session of its own, signed in at the moved moment: the kit's sessions
      // would end as idle and stay ended for the tests that follow.
      const otherVice = await viceAt(other.branch);
      try {
        refusedWith(
          await create(
            other.branch,
            examOf(other, { classIds: [other.classId], first: 2 }),
            otherVice,
          ),
          409,
          'exam_started',
        );
      } finally {
        t.clock.set(START);
      }
    });
  });

  describe('reading exams', () => {
    it('lists the branch’s exams of a range, a cancelled one marked, for the Principal; another branch’s exam is 404', async () => {
      const s = await northScene();
      const standing = saved(await create(s.branch, examOf(s, { classIds: [s.classId] })));
      const gone = saved(
        await create(s.branch, examOf(s, { date: LATER_MONDAY, classIds: [s.classId] })),
      );
      saved(await cancel(s.branch, gone.exam.id), 200);
      // An exam of another branch in the same range stays out of the list.
      const elsewhere = await scene();
      const theirs = saved(await create(elsewhere.branch, examOf(elsewhere)));
      const list = await t.get(
        `/api/timetable/exams?from=${NEXT_MONDAY}&to=${LATER_MONDAY}`,
        s.branch,
        t.principal,
      );
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      const answer = examsAnswerSchema.parse(list.body);
      expect(answer.exams.map((one) => one.id)).not.toContain(theirs.exam.id);
      expect(answer.exams.map((one) => [one.id, one.cancelled])).toEqual([
        [standing.exam.id, false],
        [gone.exam.id, true],
      ]);
      expect(answer.exams[0]?.rooms[0]).toMatchObject({
        room: { id: s.hall },
        classes: [{ id: s.classId }],
        invigilators: [{ id: s.invigilator.staffId }],
      });
      const one = await t.get(`/api/timetable/exams/${standing.exam.id}`, s.branch, t.principal);
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      const other = await scene();
      refusedWith(
        await t.get(`/api/timetable/exams/${standing.exam.id}`, other.branch),
        404,
        'not_found',
      );
      refusedWith(await t.get(`/api/timetable/exams/${UNKNOWN}`, s.branch), 404, 'not_found');
      refusedWith(
        await t.get(`/api/timetable/exams?from=${NEXT_MONDAY}&to=2027-01-01`, s.branch),
        400,
        'validation_failed',
      );
    });
  });

  describe('ids of another branch and unknown ones (.claude/rules/api.md)', () => {
    it('answers 404 for every id of the path and the body, as the Super Admin, and changes nothing', async () => {
      // Task 5.6c-3b: rating exams in both branches, each with its journal's
      // row, and every body a rating exam, so that a write of the link is seen
      // (.claude/rules/api.md) and a 404 comes before the rating's 409s.
      const s = await ratingScene();
      const o = await ratingScene();
      const rated = (scene: RatingScene) => ({
        ...examOf(scene, { date: LATER_MONDAY, classIds: [scene.otherClass], confirm: true }),
        ratingExam: true,
      });
      const exam = saved(await create(s.branch, rated(s)));
      const theirs = saved(await create(o.branch, rated(o)));
      expect(
        await t.database.migrator
          .selectFrom('exam_rating_journals')
          .select('journal_id')
          .where('exam_id', 'in', [exam.exam.id, theirs.exam.id])
          .orderBy('journal_id')
          .execute(),
      ).toHaveLength(2);
      const ownBlock =
        (await lessonsOf(THURSDAY, { groupId: s.art?.group ?? '' }))[0]?.block_id ?? '';
      const theirBlock =
        (await lessonsOf(THURSDAY, { groupId: o.art?.group ?? '' }))[0]?.block_id ?? '';
      const theirLesson = (await lessonOf(LATER_MONDAY, o.classId)).id;
      const base = { ...examOf(s), ratingExam: true };
      const room = base.rooms[0];
      if (room === undefined) throw new Error('No room.');
      const bodies = (foreign: {
        room: string;
        class: string;
        group: string;
        staff: string;
        block: string;
        lesson: string;
        subject: string;
      }) => [
        { ...base, rooms: [{ ...room, roomId: foreign.room }] },
        { ...base, rooms: [{ ...room, classIds: [foreign.class] }] },
        {
          ...base,
          subjectId: o.art?.subject ?? '',
          rooms: [{ ...room, classIds: [], groupIds: [foreign.group] }],
        },
        { ...base, rooms: [{ ...room, invigilatorIds: [foreign.staff] }] },
        {
          ...base,
          blockChoices: [{ classId: s.classId, blockId: foreign.block, choice: 'cancel' }],
        },
        {
          ...base,
          blockChoices: [{ classId: foreign.class, blockId: ownBlock, choice: 'cancel' }],
        },
        { ...base, subjectId: foreign.subject },
      ];
      const foreign = {
        room: o.hall,
        class: o.classId,
        group: o.art?.group ?? '',
        staff: o.invigilator.staffId,
        block: theirBlock,
        lesson: theirLesson,
        subject: UNKNOWN,
      };
      const unknown = {
        room: UNKNOWN,
        class: UNKNOWN,
        group: UNKNOWN,
        staff: UNKNOWN,
        block: UNKNOWN,
        lesson: UNKNOWN,
        subject: UNKNOWN,
      };
      const before = await everything();
      for (const body of [...bodies(foreign), ...bodies(unknown)]) {
        refusedWith(await create(s.branch, body), 404, 'not_found');
        refusedWith(await change(s.branch, exam.exam.id, body), 404, 'not_found');
      }
      // A lesson kept cancelled, on a change and a cancel: another branch's, an
      // unknown one, and one of the branch the exam does not give back.
      const ownLesson = (await lessonOf(LATER_MONDAY, s.classId)).id;
      for (const lesson of [theirLesson, UNKNOWN, ownLesson]) {
        refusedWith(
          await change(s.branch, exam.exam.id, {
            ...rated(s),
            keepCancelled: [lesson],
            keepReason: 'Kept',
          }),
          404,
          'not_found',
        );
        refusedWith(
          await cancel(s.branch, exam.exam.id, { keepCancelled: [lesson], keepReason: 'Kept' }),
          404,
          'not_found',
        );
      }
      for (const id of [theirs.exam.id, UNKNOWN]) {
        refusedWith(await change(s.branch, id, base), 404, 'not_found');
        refusedWith(await cancel(s.branch, id), 404, 'not_found');
      }
      refusedWith(
        await cancel(s.branch, exam.exam.id, { keepCancelled: [theirLesson], keepReason: 'Kept' }),
        404,
        'not_found',
      );
      expect(await everything()).toEqual(before);
    });
  });

  // Task 5.6c-2, pull request #182: the check of a save (`POST
  // timetable/exams/check`): what a save would do, nothing written; its lists
  // are the items of the save's refusals (the From line of 5.6c-2).
  describe('the check of a save (task 5.6c-2)', () => {
    const check = (branch: string, body: object, cookie = t.admin) =>
      request(t.kit.server)
        .post('/api/timetable/exams/check')
        .set('Cookie', cookie)
        .set(BRANCH_HEADER, branch)
        .send(body);

    const checked = (response: Response) => {
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return examCheckSchema.parse(response.body);
    };

    /** The body of a save without its tick, as the check takes it. */
    const asCheck = (body: object, examId?: string) => ({
      ...Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'confirm')),
      ...(examId === undefined ? {} : { examId }),
    });

    /** Rule lines by code and lessons, to compare a check with a save's refusal. */
    const linesOf = (details: readonly { code: string; rule?: { lessonIds: string[] } }[]) =>
      details
        .map((one) => `${one.code}|${[...(one.rule?.lessonIds ?? [])].sort().join(',')}`)
        .sort();

    /** Every row a save writes, the request keys too. */
    const all = async () => [
      ...(await everything()),
      await t.database.migrator.selectFrom('request_keys').selectAll().orderBy('key').execute(),
    ];

    it('lists the lessons a new exam cancels, both halves of a double, and writes nothing (06, Exam; plan tests 1 and 7)', async () => {
      const s = await scene({ double: true });
      await pairUp(s, NEXT_MONDAY);
      const own = await lessonsOf(NEXT_MONDAY, { classId: s.classId });
      const other = await lessonOf(NEXT_MONDAY, s.otherClass);
      const before = await all();
      const answer = checked(await check(s.branch, asCheck(examOf(s))));
      expect(answer.cancels.map((one) => one.id).sort()).toEqual(
        [...own.map((one) => one.id), other.id].sort(),
      );
      // The lessons as they stand, not cancelled by the check's own run.
      expect(answer.cancels.every((one) => one.cancelCause === null)).toBe(true);
      expect(answer).toMatchObject({
        choices: [],
        blocked: [],
        warnings: [],
        givenBack: [],
        canSave: true,
      });
      expect(await all()).toEqual(before);
    });

    it('lists a shared block without a choice and works out nothing else; with a choice it does (edge/timetable, Exams, second row; plan test 2)', async () => {
      const s = await scene({ art: true });
      const art = s.art;
      if (art === null) throw new Error('No art.');
      const [block] = await lessonsOf(THURSDAY, { groupId: art.group });
      if (block === undefined) throw new Error('No art lesson.');
      const body = examOf(s, { date: THURSDAY, classIds: [s.classId] });
      const asked = checked(await check(s.branch, asCheck(body)));
      expect(asked.choices).toEqual([
        expect.objectContaining({
          classId: s.classId,
          blockId: block.block_id,
          choice: null,
          stored: null,
        }),
      ]);
      expect(asked.choices[0]?.lessons.map((one) => one.id)).toEqual([block.id]);
      expect(asked.choices[0]?.otherClasses).toHaveLength(1);
      expect(asked).toMatchObject({
        blocked: null,
        warnings: null,
        givenBack: null,
        canSave: false,
      });
      // The save names the same block.
      const refused = await create(s.branch, body);
      refusedWith(refused, 409, 'exam_block_choice');
      expect(detailsOf(refused).map((one) => [one.classId, one.recordId])).toEqual(
        asked.choices.map((one) => [one.classId, one.blockId]),
      );
      const chosen = checked(
        await check(
          s.branch,
          asCheck({
            ...body,
            blockChoices: [{ classId: s.classId, blockId: block.block_id, choice: 'keep' }],
          }),
        ),
      );
      expect(chosen.choices[0]?.choice).toBe('keep');
      expect(chosen).toMatchObject({ blocked: [], givenBack: [], canSave: true });
    });

    it('lists a blocked line that a "keep" brings in: the kept block’s teacher invigilating (plan review must-fix 1)', async () => {
      const s = await scene({ art: true });
      const art = s.art;
      if (art === null) throw new Error('No art.');
      const [block] = await lessonsOf(THURSDAY, { groupId: art.group });
      if (block === undefined) throw new Error('No art lesson.');
      const body = (choice: 'keep' | 'cancel') =>
        asCheck(
          examOf(s, {
            date: THURSDAY,
            classIds: [s.classId],
            invigilatorIds: [art.teacher],
            subjectId: art.subject,
            blockChoices: [{ classId: s.classId, blockId: block.block_id, choice }],
          }),
        );
      const kept = checked(await check(s.branch, body('keep')));
      expect(kept.canSave).toBe(false);
      expect(kept.blocked?.some((one) => one.rule?.lessonIds.includes(block.id))).toBe(true);
      expect(kept.givenBack).toBeNull();
      const cancelled = checked(await check(s.branch, body('cancel')));
      expect(cancelled.blocked).toEqual([]);
      expect(cancelled.canSave).toBe(true);
    });

    it('shows the stored choice of a change, and none for a block the change makes shared (.claude/rules/timetable.md; plan test 3)', async () => {
      const s = await scene({ art: true });
      const art = s.art;
      if (art === null) throw new Error('No art.');
      const [block] = await lessonsOf(THURSDAY, { groupId: art.group });
      if (block === undefined) throw new Error('No art lesson.');
      const keptBody = examOf(s, {
        date: THURSDAY,
        classIds: [s.classId],
        blockChoices: [{ classId: s.classId, blockId: block.block_id, choice: 'keep' }],
      });
      const kept = saved(await create(s.branch, keptBody));
      const again = checked(
        await check(s.branch, asCheck({ ...keptBody, blockChoices: [] }, kept.exam.id)),
      );
      expect(again.choices).toEqual([
        expect.objectContaining({ blockId: block.block_id, choice: 'keep', stored: 'keep' }),
      ]);
      expect(again.canSave).toBe(true);
      // A block both classes sat under is not shared and stored no choice; a
      // change that drops one class makes it shared and asks again.
      const t2 = await scene({ art: true });
      const art2 = t2.art;
      if (art2 === null) throw new Error('No art.');
      const [block2] = await lessonsOf(THURSDAY, { groupId: art2.group });
      if (block2 === undefined) throw new Error('No art lesson.');
      const whole = saved(
        await create(
          t2.branch,
          examOf(t2, { date: THURSDAY, classIds: [t2.classId, art2.eighth], confirm: true }),
        ),
      );
      const dropped = checked(
        await check(
          t2.branch,
          asCheck(examOf(t2, { date: THURSDAY, classIds: [t2.classId] }), whole.exam.id),
        ),
      );
      expect(dropped.choices).toEqual([
        expect.objectContaining({ blockId: block2.block_id, choice: null, stored: null }),
      ]);
      expect(dropped.canSave).toBe(false);
    });

    it('lists the blocked lines and the warnings the save refuses with, the same items (From line of 5.6c-2; plan tests 4 and 5)', async () => {
      const s = await scene();
      const other = await lessonOf(NEXT_MONDAY, s.otherClass);
      const blockedBody = examOf(s, {
        classIds: [s.classId],
        invigilatorIds: [s.otherTeacher.staffId],
      });
      const blocked = checked(await check(s.branch, asCheck(blockedBody)));
      expect(blocked.canSave).toBe(false);
      expect(blocked.blocked?.some((one) => one.rule?.lessonIds.includes(other.id))).toBe(true);
      expect(blocked.givenBack).toBeNull();
      const refused = await create(s.branch, blockedBody);
      refusedWith(refused, 409, 'exam_blocked');
      expect(linesOf(blocked.blocked ?? [])).toEqual(linesOf(detailsOf(refused)));

      const stranger = await load.teacher(s.branch, {});
      const warnedBody = examOf(s, { invigilatorIds: [stranger.staffId] });
      const warned = checked(await check(s.branch, asCheck(warnedBody)));
      expect(warned.blocked).toEqual([]);
      expect(warned.canSave).toBe(true);
      const asked = await create(s.branch, warnedBody);
      refusedWith(asked, 409, 'exam_warnings');
      expect(linesOf(warned.warnings ?? [])).toEqual(linesOf(detailsOf(asked)));
      expect(new Set(warned.warnings?.map((one) => one.code))).toEqual(
        new Set(['invigilator_unavailable', 'invigilator_subject']),
      );
    });

    it('lists what a change gives back: blocked with the free rooms, then kept with a reason (decision 3 of 5.6c-1; plan test 6)', async () => {
      const s = await scene();
      const exam = saved(
        await create(s.branch, examOf(s, { date: LATER_MONDAY, classIds: [s.otherClass] })),
      );
      // The first class's lesson takes the other class's room for that day.
      const own = await lessonOf(LATER_MONDAY, s.classId);
      const moved = await request(t.kit.server)
        .post(`/api/timetable/lessons/${own.id}/room`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ roomId: s.otherRoom, reason: 'The room is painted' });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      const other = await lessonOf(LATER_MONDAY, s.otherClass);
      const body = examOf(s, { date: LATER_MONDAY, classIds: [s.otherClass], first: 2 });
      const before = await all();
      const blocked = checked(await check(s.branch, asCheck(body, exam.exam.id)));
      expect(blocked.blocked).toEqual([]);
      expect(blocked.givenBack?.map((one) => [one.lesson.id, one.state])).toEqual([
        [other.id, 'blocked'],
      ]);
      expect(blocked.givenBack?.[0]?.lesson.cancelCause).toBe('exam');
      expect(blocked.givenBack?.[0]?.rules.length).toBeGreaterThan(0);
      expect(blocked.freeRooms.length).toBeGreaterThan(0);
      expect(blocked.canSave).toBe(false);
      expect(await all()).toEqual(before);
      // The save refuses the same lesson.
      const refused = await change(s.branch, exam.exam.id, body);
      refusedWith(refused, 409, 'exam_restore_blocked');
      expect(detailsOf(refused).some((one) => one.rule?.lessonIds.includes(other.id))).toBe(true);
      const kept = checked(
        await check(
          s.branch,
          asCheck(
            // No reason yet: the dialog asks the check before it is typed
            // (spec review of the code, must-fix 1).
            { ...body, keepCancelled: [other.id] },
            exam.exam.id,
          ),
        ),
      );
      expect(kept.givenBack?.map((one) => [one.lesson.id, one.state])).toEqual([
        [other.id, 'kept'],
      ]);
      expect(kept.canSave).toBe(true);
    });

    it('lists a lesson given back as restored, as restorable when named to stay cancelled, and nothing while a rule blocks (plan review must-fix 2, should-fix 4)', async () => {
      // Two separate maths lessons of the first class on Monday, lessons 1 and 2.
      const s = await scene({ double: true });
      const exam = saved(
        await create(s.branch, examOf(s, { date: LATER_MONDAY, classIds: [s.otherClass] })),
      );
      const other = await lessonOf(LATER_MONDAY, s.otherClass);
      const later = examOf(s, { date: LATER_MONDAY, classIds: [s.otherClass], first: 2 });
      // The one path that restores and writes up to the commit's checks
      // writes nothing either (spec review of the code, must-fix 4).
      const before = await all();
      const restored = checked(await check(s.branch, asCheck(later, exam.exam.id)));
      expect(await all()).toEqual(before);
      expect(restored.givenBack?.map((one) => [one.lesson.id, one.state])).toEqual([
        [other.id, 'restored'],
      ]);
      expect(restored.canSave).toBe(true);
      const restorable = checked(
        await check(
          s.branch,
          asCheck({ ...later, keepCancelled: [other.id], keepReason: 'Kept' }, exam.exam.id),
        ),
      );
      expect(restorable.givenBack?.map((one) => [one.lesson.id, one.state])).toEqual([
        [other.id, 'restorable'],
      ]);
      expect(restorable.canSave).toBe(false);
      // The save refuses a restorable lesson named to stay cancelled (as in 5.6c-1).
      refusedWith(
        await change(s.branch, exam.exam.id, {
          ...later,
          keepCancelled: [other.id],
          keepReason: 'Kept',
        }),
        404,
        'not_found',
      );
      // The first class's teacher invigilating in lesson 2, where they teach:
      // a blocked line, and the lessons given back are not worked out.
      const blockedBody = examOf(s, {
        date: LATER_MONDAY,
        classIds: [s.otherClass],
        first: 2,
        invigilatorIds: [s.teacher.staffId],
      });
      const blocked = checked(await check(s.branch, asCheck(blockedBody, exam.exam.id)));
      expect(blocked.blocked?.length).toBeGreaterThan(0);
      expect(blocked).toMatchObject({ givenBack: null, canSave: false });
    });

    it('answers a date without lessons with its line and no choice (plan review correction 2), and the refusals of the exam’s shape as the save (plan test 8)', async () => {
      const s = await scene({ art: true });
      // A vacation between quarters has no lessons.
      const vacation = checked(await check(s.branch, asCheck(examOf(s, { date: '2026-11-02' }))));
      expect(vacation.blocked?.map((one) => one.code)).toEqual(['vacation']);
      expect(vacation).toMatchObject({ choices: [], cancels: [], canSave: false });
      refusedWith(
        await check(s.branch, asCheck(examOf(s, { date: '2026-10-11' }))),
        409,
        'exam_no_timetable',
      );
      refusedWith(
        await check(s.branch, asCheck(examOf(s, { date: '2026-10-09' }))),
        409,
        'exam_started',
      );
      refusedWith(
        await check(s.branch, asCheck(examOf(s, { first: 1, last: 4 }))),
        409,
        'exam_slots',
      );
    });

    it('answers a day off of one grade of the exam with its line, as the save refuses it (plan review correction 2)', async () => {
      const s = await scene({ art: true });
      const art = s.art;
      if (art === null) throw new Error('No art.');
      await t.database.migrator
        .insertInto('calendar_entries')
        .values({
          branch_id: s.branch,
          kind: 'day_off',
          name: 'Grade 8 trip',
          first_date: THURSDAY,
          last_date: THURSDAY,
          grade_from: 8,
          grade_to: 8,
        })
        .execute();
      const body = examOf(s, { date: THURSDAY, classIds: [s.classId, art.eighth] });
      const answer = checked(await check(s.branch, asCheck(body)));
      expect(answer.blocked?.map((one) => one.code)).toEqual(['day_off']);
      expect(answer).toMatchObject({ choices: [], cancels: [], canSave: false });
      const refused = await create(s.branch, body);
      refusedWith(refused, 409, 'exam_blocked');
      expect(detailsOf(refused).map((one) => one.code)).toEqual(['day_off']);
    });

    it('refuses a tick, and lessons kept cancelled without an exam to change (plan test 10)', async () => {
      const s = await northScene();
      refusedWith(
        await check(s.branch, { ...asCheck(examOf(s)), confirm: true }),
        400,
        'validation_failed',
      );
      const own = await lessonOf(NEXT_MONDAY, s.classId);
      refusedWith(
        await check(s.branch, { ...asCheck(examOf(s)), keepCancelled: [own.id] }),
        400,
        'validation_failed',
      );
      refusedWith(
        await check(s.branch, { ...asCheck(examOf(s)), keepReason: 'Kept' }),
        400,
        'validation_failed',
      );
    });

    it('is open to the Super Admin and the Academic Vice Principal, refused to the Principal, and writes nothing (plan review correction 1; plan test 9)', async () => {
      const s = await northScene();
      const before = await all();
      checked(await check(s.branch, asCheck(examOf(s, { date: '2026-11-23' })), t.admin));
      checked(await check(s.branch, asCheck(examOf(s, { date: '2026-11-23' })), t.vicePrincipal));
      refusedWith(
        await check(s.branch, asCheck(examOf(s, { date: '2026-11-23' })), t.principal),
        403,
        'permission_denied',
      );
      expect(await all()).toEqual(before);
    });

    it('answers 404 for every id of the body of another branch or unknown, and writes nothing (.claude/rules/api.md; plan test 9)', async () => {
      // Task 5.6c-3b: rating exams in both branches with their rows, every
      // body a rating exam (permission review must-fix 1).
      const s = await ratingScene();
      const o = await ratingScene();
      const rated = (scene: RatingScene) => ({
        ...examOf(scene, { date: LATER_MONDAY, classIds: [scene.otherClass], confirm: true }),
        ratingExam: true,
      });
      const exam = saved(await create(s.branch, rated(s)));
      const theirs = saved(await create(o.branch, rated(o)));
      const ownBlock =
        (await lessonsOf(THURSDAY, { groupId: s.art?.group ?? '' }))[0]?.block_id ?? '';
      const theirBlock =
        (await lessonsOf(THURSDAY, { groupId: o.art?.group ?? '' }))[0]?.block_id ?? '';
      const theirLesson = (await lessonOf(LATER_MONDAY, o.otherClass)).id;
      const base = { ...asCheck(examOf(s)), ratingExam: true };
      const room = examOf(s).rooms[0];
      if (room === undefined) throw new Error('No room.');
      const bodies = (foreign: {
        room: string;
        class: string;
        group: string;
        staff: string;
        block: string;
        subject: string;
        exam: string;
        lesson: string;
      }) => [
        { ...base, rooms: [{ ...room, roomId: foreign.room }] },
        { ...base, rooms: [{ ...room, classIds: [foreign.class] }] },
        {
          ...base,
          subjectId: o.art?.subject ?? '',
          rooms: [{ ...room, classIds: [], groupIds: [foreign.group] }],
        },
        { ...base, rooms: [{ ...room, invigilatorIds: [foreign.staff] }] },
        {
          ...base,
          blockChoices: [{ classId: s.classId, blockId: foreign.block, choice: 'cancel' }],
        },
        {
          ...base,
          blockChoices: [{ classId: foreign.class, blockId: ownBlock, choice: 'cancel' }],
        },
        { ...base, subjectId: foreign.subject },
        { ...base, examId: foreign.exam },
        {
          ...asCheck(
            examOf(s, { date: LATER_MONDAY, classIds: [s.otherClass], first: 2 }),
            exam.exam.id,
          ),
          ratingExam: true,
          keepCancelled: [foreign.lesson],
          keepReason: 'Kept',
        },
      ];
      const before = await all();
      for (const body of [
        ...bodies({
          room: o.hall,
          class: o.classId,
          group: o.art?.group ?? '',
          staff: o.invigilator.staffId,
          block: theirBlock,
          subject: UNKNOWN,
          exam: theirs.exam.id,
          lesson: theirLesson,
        }),
        ...bodies({
          room: UNKNOWN,
          class: UNKNOWN,
          group: UNKNOWN,
          staff: UNKNOWN,
          block: UNKNOWN,
          subject: UNKNOWN,
          exam: UNKNOWN,
          lesson: UNKNOWN,
        }),
      ]) {
        refusedWith(await check(s.branch, body), 404, 'not_found');
      }
      expect(await all()).toEqual(before);
    });
  });

  // Task 5.6c-2 (decision 7 of its plan): the class day page shows the
  // standing exams the class sits (06, Exam: "It is shown on every timetable
  // view ..., marked 'exam'").
  describe('the exams of the class day page (task 5.6c-2)', () => {
    const dayOf = async (branch: string, date: string, classId: string, cookie = t.admin) => {
      const response = await t.get(
        `/api/timetable/day?date=${date}&classId=${classId}`,
        branch,
        cookie,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return dayAnswerSchema.parse(response.body);
    };

    it('lists an exam that names the class and one of a group fed by it; not another class’s, nor a cancelled one (plan test 11)', async () => {
      const s = await scene({ art: true });
      const art = s.art;
      if (art === null) throw new Error('No art.');
      const named = saved(await create(s.branch, examOf(s, { classIds: [s.classId] })));
      const others = saved(
        await create(
          s.branch,
          examOf(s, {
            classIds: [s.otherClass],
            roomId: s.spareRoom,
            invigilatorIds: [s.teacher.staffId],
          }),
        ),
      );
      const gone = saved(
        await create(s.branch, examOf(s, { date: LATER_MONDAY, classIds: [s.classId] })),
      );
      saved(await cancel(s.branch, gone.exam.id), 200);
      const group = saved(
        await create(
          s.branch,
          examOf(s, {
            date: THURSDAY,
            classIds: [],
            groupIds: [art.group],
            subjectId: art.subject,
            confirm: true,
          }),
        ),
      );
      const monday = await dayOf(s.branch, NEXT_MONDAY, s.classId);
      expect(monday.exams.map((one) => one.id)).toEqual([named.exam.id]);
      expect(monday.exams[0]).toMatchObject({
        title: 'Quarter exam in maths',
        start: 480,
        end: 525,
        room: { id: s.hall },
        invigilators: [expect.any(String)],
      });
      expect(monday.exams.map((one) => one.id)).not.toContain(others.exam.id);
      expect((await dayOf(s.branch, LATER_MONDAY, s.classId)).exams).toEqual([]);
      expect((await dayOf(s.branch, THURSDAY, s.classId)).exams.map((one) => one.id)).toEqual([
        group.exam.id,
      ]);
      // Another branch's standing exam of the same date stays out (permission
      // review should-fix 1), as the Super Admin who holds every branch.
      const elsewhere = await scene();
      const theirs = saved(await create(elsewhere.branch, examOf(elsewhere)));
      expect(theirs.exam.cancelled).toBe(false);
      expect((await dayOf(s.branch, NEXT_MONDAY, s.classId)).exams.map((one) => one.id)).toEqual([
        named.exam.id,
      ]);
      expect((await dayOf(s.branch, NEXT_MONDAY, s.otherClass)).exams.map((one) => one.id)).toEqual(
        [others.exam.id],
      );
    });
  });

  describe('the exams of the class day page, read by the Principal (task 5.6c-2)', () => {
    it('shows the Principal the exam of the class with its room and invigilator (permission review should-fix 3)', async () => {
      const s = await northScene();
      const date = '2026-12-07';
      const exam = saved(await create(s.branch, examOf(s, { date, classIds: [s.classId] })));
      const response = await t.get(
        `/api/timetable/day?date=${date}&classId=${s.classId}`,
        s.branch,
        t.principal,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(dayAnswerSchema.parse(response.body).exams).toEqual([
        expect.objectContaining({
          id: exam.exam.id,
          room: expect.objectContaining({ id: s.hall }) as unknown,
        }),
      ]);
    });
  });

  describe('the request key (.claude/rules/api.md)', () => {
    it('repeats a save with its key, refuses the key of another account, and checks a repeat before its answer', async () => {
      const s = await northScene();
      const key = randomUUID();
      const body = examOf(s, { date: '2026-11-16' });
      const first = saved(await create(s.branch, body, t.admin, key));
      const again = saved(await create(s.branch, body, t.admin, key));
      expect(again.exam.id).toBe(first.exam.id);
      refusedWith(await create(s.branch, body, t.vicePrincipal, key), 409, 'request_key_reused');
      const other = await scene();
      refusedWith(
        await create(other.branch, examOf(other), t.admin, key),
        409,
        'request_key_reused',
      );
      refusedWith(
        await create(
          s.branch,
          { ...body, rooms: [{ ...body.rooms[0], roomId: UNKNOWN }] },
          t.admin,
          key,
        ),
        404,
        'not_found',
      );
      // The Teacher, given a role in the branch first, is refused.
      const teacherAccount = await t.kit.fullSession('Sardor', 'Karimov');
      await t.kit.giveRole(teacherAccount.account.id, { role: 'teacher', branchId: s.branch });
      refusedWith(
        await create(s.branch, body, teacherAccount.cookie, key),
        403,
        'permission_denied',
      );
      // POST: a repeat with another branch's room is 404, never the stored answer.
      refusedWith(
        await create(
          s.branch,
          { ...body, rooms: [{ ...body.rooms[0], roomId: other.hall }] },
          t.admin,
          key,
        ),
        404,
        'not_found',
      );
      // PUT and cancel: a used key repeated with another branch's exam, an
      // unknown one, and from a refused role is 404 or 403, never the stored answer.
      const theirs = saved(await create(other.branch, examOf(other, { date: '2026-11-16' })));
      const changeKey = randomUUID();
      const changeBody = { ...body, title: 'Quarter exam in algebra' };
      saved(await change(s.branch, first.exam.id, changeBody, t.admin, changeKey), 200);
      refusedWith(
        await change(s.branch, first.exam.id, changeBody, t.vicePrincipal, changeKey),
        409,
        'request_key_reused',
      );
      for (const id of [theirs.exam.id, UNKNOWN]) {
        refusedWith(await change(s.branch, id, changeBody, t.admin, changeKey), 404, 'not_found');
      }
      refusedWith(
        await change(s.branch, first.exam.id, changeBody, teacherAccount.cookie, changeKey),
        403,
        'permission_denied',
      );
      const cancelKey = randomUUID();
      saved(await cancel(s.branch, first.exam.id, {}, t.admin, cancelKey), 200);
      refusedWith(
        await cancel(s.branch, first.exam.id, {}, t.vicePrincipal, cancelKey),
        409,
        'request_key_reused',
      );
      for (const id of [theirs.exam.id, UNKNOWN]) {
        refusedWith(await cancel(s.branch, id, {}, t.admin, cancelKey), 404, 'not_found');
      }
      refusedWith(
        await cancel(s.branch, first.exam.id, {}, teacherAccount.cookie, cancelKey),
        403,
        'permission_denied',
      );
      // Lessons kept cancelled need a reason, on a change and a cancel (code review round 1, change 3).
      refusedWith(
        await change(s.branch, first.exam.id, { ...body, keepCancelled: [UNKNOWN] }),
        400,
        'validation_failed',
      );
      refusedWith(
        await cancel(s.branch, first.exam.id, { keepCancelled: [UNKNOWN] }),
        400,
        'validation_failed',
      );
      // A create takes no lessons to keep cancelled.
      refusedWith(
        await create(s.branch, { ...body, keepCancelled: [UNKNOWN], keepReason: 'Kept' }),
        400,
        'validation_failed',
      );
    });
  });

  // Task 5.6c-3b, pull request #184 (edge/timetable, Exams, "The exam is the
  // quarter's rating exam": "An exam can be linked to the rating exam of the
  // journals of its subject whose students all belong to its classes: class
  // journals, and group journals whose students all come from sitting
  // classes. A group journal with students outside the exam is listed and not
  // linked; its teacher sets the date by hand"; edge/calculation, "The rating
  // exam": one column per rating journal and quarter).
  describe('the rating-exam link', () => {
    /** A rating exam of the first class alone, in lesson 3 (free) of a Monday. */
    const ratingOf = (
      s: RatingScene,
      input: { subjectId?: string | null; date?: string; classIds?: string[] } = {},
    ) => ({
      ...examOf(s, {
        first: 3,
        classIds: input.classIds ?? [s.classId],
        subjectId: input.subjectId === undefined ? s.maths : input.subjectId,
        confirm: true,
        ...(input.date === undefined ? {} : { date: input.date }),
      }),
      ratingExam: true,
    });

    const ids = (rating: { linked: { id: string }[]; notLinked: { id: string }[] } | null) =>
      rating === null
        ? null
        : {
            linked: rating.linked.map((one) => one.id),
            notLinked: rating.notLinked.map((one) => one.id),
          };

    const rowsOf = (examId: string) =>
      t.database.migrator
        .selectFrom('exam_rating_journals')
        .select(['journal_id', 'linked'])
        .where('exam_id', '=', examId)
        .orderBy('journal_id')
        .execute();

    it("links a sitting class's journal, lists not linked a group journal with a student outside the exam, and leaves out a journal of another subject or a class that does not sit (decision 4)", async () => {
      const s = await ratingScene();
      const maths = examSaveAnswerSchema.parse(saved(await create(s.branch, ratingOf(s))));
      // The other class's maths journal: its class does not sit.
      expect(ids(maths.exam.rating)).toEqual({ linked: [s.journals.maths], notLinked: [] });
      expect(maths.exam.rating?.linked[0]?.unit).toEqual({
        kind: 'class',
        id: s.classId,
        name: expect.any(String) as string,
      });
      expect(await rowsOf(maths.exam.id)).toEqual([{ journal_id: s.journals.maths, linked: true }]);
      // Art, the same class on another date: the group holds a grade-8
      // student who does not sit.
      const art = examSaveAnswerSchema.parse(
        saved(
          await create(s.branch, ratingOf(s, { subjectId: s.art.subject, date: LATER_MONDAY })),
        ),
      );
      expect(ids(art.exam.rating)).toEqual({ linked: [], notLinked: [s.journals.art] });
      // The grade-8 class sitting too links it.
      const both = examSaveAnswerSchema.parse(
        saved(
          await change(s.branch, art.exam.id, {
            ...ratingOf(s, {
              subjectId: s.art.subject,
              date: LATER_MONDAY,
              classIds: [s.classId, s.art.eighth],
            }),
          }),
          200,
        ),
      );
      expect(ids(both.exam.rating)).toEqual({ linked: [s.journals.art], notLinked: [] });
    });

    it("reads the group on the exam's date: a student of a class that does not sit who joins after it leaves the journal linked (decision 1)", async () => {
      const s = await ratingScene({ eighthFrom: '2026-10-20' });
      const answer = examSaveAnswerSchema.parse(
        saved(await create(s.branch, ratingOf(s, { subjectId: s.art.subject }))),
      );
      expect(answer.exam.date).toBe(NEXT_MONDAY);
      expect(ids(answer.exam.rating)).toEqual({ linked: [s.journals.art], notLinked: [] });
    });

    it('links the journal of a group that sits in its own lesson, its grade-8 student included (decision 9)', async () => {
      const s = await ratingScene();
      const answer = examSaveAnswerSchema.parse(
        saved(
          await create(s.branch, {
            ...examOf(s, {
              date: THURSDAY,
              classIds: [],
              groupIds: [s.art.group],
              subjectId: s.art.subject,
              confirm: true,
            }),
            ratingExam: true,
          }),
        ),
      );
      expect(ids(answer.exam.rating)).toEqual({ linked: [s.journals.art], notLinked: [] });
    });

    it('refuses a subject without the rating exam, and a rating exam with no subject (decision 5)', async () => {
      const s = await ratingScene();
      const before = await everything();
      await t.database.migrator
        .updateTable('subjects')
        .set({ rating_exam: false })
        .where('id', '=', s.maths)
        .execute();
      refusedWith(await create(s.branch, ratingOf(s)), 409, 'exam_rating_subject');
      refusedWith(
        await create(s.branch, ratingOf(s, { subjectId: null })),
        400,
        'validation_failed',
      );
      expect(await everything()).toEqual(before);
    });

    it('refuses a journal another standing rating exam of the quarter links; another quarter, or the first one cancelled, saves (decision 2)', async () => {
      const s = await ratingScene();
      const first = examSaveAnswerSchema.parse(saved(await create(s.branch, ratingOf(s))));
      const before = await everything();
      const taken = await create(s.branch, ratingOf(s, { date: LATER_MONDAY }));
      refusedWith(taken, 409, 'exam_rating_taken');
      expect(detailsOf(taken).map((one) => one.recordId)).toEqual([s.journals.maths]);
      expect(await everything()).toEqual(before);
      // 9 November is in the second quarter.
      saved(await create(s.branch, ratingOf(s, { date: '2026-11-09' })));
      // Not a rating exam: no link, no refusal.
      saved(await create(s.branch, { ...ratingOf(s, { date: LATER_MONDAY }), ratingExam: false }));
      saved(await cancel(s.branch, first.exam.id), 200);
      const again = examSaveAnswerSchema.parse(
        saved(
          await create(s.branch, {
            ...ratingOf(s, { date: LATER_MONDAY }),
            firstLesson: 2,
            lastLesson: 2,
          }),
        ),
      );
      expect(ids(again.exam.rating)).toEqual({ linked: [s.journals.maths], notLinked: [] });
      // The cancelled exam keeps its rows as history (decision 6), and is no
      // longer answered as the rating exam.
      expect(await rowsOf(first.exam.id)).toEqual([{ journal_id: s.journals.maths, linked: true }]);
      const listed = examsAnswerSchema.parse(
        (await t.get(`/api/timetable/exams?from=${NEXT_MONDAY}&to=${NEXT_MONDAY}`, s.branch)).body,
      );
      expect(listed.exams.find((one) => one.id === first.exam.id)?.rating).toBeNull();
    });

    // Task 8.2 (From 5.6c-3b): the switch of the quarter of the exam's date.
    it("reads the rating exam switch of the quarter of the exam's date (task 8.2)", async () => {
      const s = await ratingScene();
      const listed = subjectListSchema.parse((await t.get('/api/setup/subjects', s.branch)).body);
      const subject = listed.subjects.find((one) => one.id === s.maths) as Subject;
      const edited = await t.put(`/api/setup/subjects/${s.maths}`, s.branch, {
        names: subject.names,
        departmentId: subject.departmentId,
        grades: subject.grades,
        colour: subject.colour,
        journalType: subject.journalType,
        ratingExam: false,
        groupSubject: subject.groupSubject,
        languageRule: subject.languageRule,
        demanding: subject.demanding,
        // The branch has no daily distribution yet: an edit of a graded subject sends it.
        daily: subject.daily === null ? { attendance: 20, classwork: 40, homework: 40 } : null,
        switchesFrom: 2,
      });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      // Quarter 1 keeps the exam; 9 November is in quarter 2, where it is off.
      saved(await create(s.branch, ratingOf(s)));
      refusedWith(
        await create(s.branch, ratingOf(s, { date: '2026-11-09' })),
        409,
        'exam_rating_subject',
      );
    });

    // Task 8.2 (From 5.6c-1, decision 5): a linked exam gives the journal's date.
    it("gives a linked journal the exam's date, refuses a hand date while it stands, and lets one after its cancel (task 8.2)", async () => {
      const s = await ratingScene();
      const answer = examSaveAnswerSchema.parse(saved(await create(s.branch, ratingOf(s))));
      const quarter = await t.database.migrator
        .selectFrom('quarters')
        .select('id')
        .where('academic_year_id', '=', s.year)
        .where('number', '=', 1)
        .executeTakeFirstOrThrow();
      const inForce = async () =>
        (
          await sql<{ date: string | null }>`
            select journal_rating_date(${s.journals.maths}::uuid, ${quarter.id}::uuid)::text as date
          `.execute(t.database.migrator)
        ).rows[0]?.date;
      expect(await inForce()).toBe(answer.exam.date);
      const path = `/api/journal/journals/${s.journals.maths}/rating/${quarter.id}/date`;
      refusedWith(
        await t.put(path, s.branch, { date: '2026-10-20', version: null }),
        409,
        'rating_exam_linked',
      );
      saved(await cancel(s.branch, answer.exam.id), 200);
      expect(await inForce()).toBeNull();
      const hand = await t.put(path, s.branch, { date: '2026-10-20', version: null });
      expect(hand.status, JSON.stringify(hand.body)).toBe(200);
      expect(await inForce()).toBe('2026-10-20');
    });

    it("leaves out a journal whose runs do not hold the exam's date (decision 4)", async () => {
      const s = await ratingScene();
      // A rating subject of the first class whose journal ran only in September.
      const chemistry = await load.classes.subject({ grades: [7] });
      await t.database.migrator
        .updateTable('subjects')
        .set({ rating_exam: true })
        .where('id', '=', chemistry)
        .execute();
      const journal = await t.database.migrator
        .insertInto('journals')
        .values({
          branch_id: s.branch,
          academic_year_id: s.year,
          class_id: s.classId,
          subject_id: chemistry,
          runs: sql<string>`'{[2026-09-01,2026-10-01)}'::datemultirange`,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const ended = examSaveAnswerSchema.parse(
        saved(await create(s.branch, ratingOf(s, { subjectId: chemistry }))),
      );
      expect(ids(ended.exam.rating)).toEqual({ linked: [], notLinked: [] });
      // Running on the date, the same journal is linked.
      await t.database.migrator
        .updateTable('journals')
        .set({ runs: sql<string>`'{[2026-09-01,)}'::datemultirange` })
        .where('id', '=', journal.id)
        .execute();
      const running = examSaveAnswerSchema.parse(
        saved(await change(s.branch, ended.exam.id, ratingOf(s, { subjectId: chemistry })), 200),
      );
      expect(ids(running.exam.rating)).toEqual({ linked: [journal.id], notLinked: [] });
    });

    it("keeps in the database a row to a journal of the exam's subject and year, also over a change of the subject, and a rating exam to a subject (0095)", async () => {
      const s = await ratingScene();
      const created = examSaveAnswerSchema.parse(saved(await create(s.branch, ratingOf(s))));
      const failure = async (work: Promise<unknown>) => {
        try {
          await work;
        } catch (error) {
          return (error as { constraint?: string }).constraint;
        }
        return null;
      };
      // A journal of another subject.
      expect(
        await failure(
          t.database.migrator
            .insertInto('exam_rating_journals')
            .values({
              branch_id: s.branch,
              exam_id: created.exam.id,
              journal_id: s.journals.art,
              linked: true,
            })
            .execute(),
        ),
      ).toBe('exam_rating_journal');
      // The exam's subject changed under its rows, at the commit.
      expect(
        await failure(
          t.database.migrator
            .updateTable('exams')
            .set({ subject_id: s.art.subject })
            .where('id', '=', created.exam.id)
            .execute(),
        ),
      ).toBe('exam_rating_journal');
      // A rating exam with no subject.
      expect(
        await failure(
          t.database.migrator
            .updateTable('exams')
            .set({ subject_id: null })
            .where('id', '=', created.exam.id)
            .execute(),
        ),
      ).toBe('exams_rating_subject_check');
      expect(await rowsOf(created.exam.id)).toEqual([
        { journal_id: s.journals.maths, linked: true },
      ]);
    });

    it('writes the rows again on a change: the tick taken off removes them, a class added adds its journal; the check lists them and writes nothing; the audit entries carry them', async () => {
      const s = await ratingScene();
      const created = examSaveAnswerSchema.parse(saved(await create(s.branch, ratingOf(s))));
      const [made] = await t.entries('exam.create', created.exam.id);
      expect((made?.new_value as { rating: unknown }).rating).toEqual({
        linked: [s.journals.maths],
        notLinked: [],
      });

      const before = await everything();
      const checked = examCheckSchema.parse(
        (
          await t.post('/api/timetable/exams/check', s.branch, {
            ...ratingOf(s, { classIds: [s.classId, s.otherClass] }),
            confirm: undefined,
            examId: created.exam.id,
          })
        ).body,
      );
      expect(ids(checked.rating)).toEqual({
        linked: [s.journals.maths, s.journals.otherMaths].sort(),
        notLinked: [],
      });
      expect(await everything()).toEqual(before);

      const wider = examSaveAnswerSchema.parse(
        saved(
          await change(
            s.branch,
            created.exam.id,
            ratingOf(s, { classIds: [s.classId, s.otherClass] }),
          ),
          200,
        ),
      );
      expect(new Set(ids(wider.exam.rating)?.linked)).toEqual(
        new Set([s.journals.maths, s.journals.otherMaths]),
      );
      const [changed] = await t.entries('exam.change', created.exam.id);
      expect(
        new Set((changed?.new_value as { rating: { linked: string[] } }).rating.linked),
      ).toEqual(new Set([s.journals.maths, s.journals.otherMaths]));

      // The other class taken out again: its journal drops out of the rows.
      const narrower = examSaveAnswerSchema.parse(
        saved(await change(s.branch, created.exam.id, ratingOf(s)), 200),
      );
      expect(ids(narrower.exam.rating)).toEqual({ linked: [s.journals.maths], notLinked: [] });
      expect(await rowsOf(created.exam.id)).toEqual([
        { journal_id: s.journals.maths, linked: true },
      ]);

      const off = examSaveAnswerSchema.parse(
        saved(await change(s.branch, created.exam.id, { ...ratingOf(s), ratingExam: false }), 200),
      );
      expect(off.exam.rating).toBeNull();
      expect(await rowsOf(created.exam.id)).toEqual([]);
    });
  });
});
