import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  NOTIFICATION_KINDS,
  REQUEST_KEY_HEADER,
  examSaveAnswerSchema,
  examsAnswerSchema,
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
      t.database.migrator.selectFrom('audit_log').select('id').orderBy('id').execute(),
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

  describe('a publish and a withdraw over an exam (decision 5, until 5.6c-3)', () => {
    it('refuses a withdraw whose dates hold a standing exam, and withdraws once it is cancelled', async () => {
      const s = await scene();
      const exam = saved(await create(s.branch, examOf(s)));
      const withdraw = () =>
        request(t.kit.server)
          .post(`/api/timetable/versions/${s.version}/withdraw`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, s.branch)
          .set(REQUEST_KEY_HEADER, randomUUID())
          .send({});
      const refused = await withdraw();
      refusedWith(refused, 409, 'publish_over_exam');
      expect(detailsOf(refused)).toEqual([expect.objectContaining({ recordId: exam.exam.id })]);
      saved(await cancel(s.branch, exam.exam.id), 200);
      const done = await withdraw();
      expect(done.status, JSON.stringify(done.body)).toBe(200);
    });

    it('refuses a publish that adds a lesson of its class under a standing exam', async () => {
      const s = await scene();
      // The exam over lessons 1 and 2 of the first class; the new version adds its lesson 2.
      const exam = saved(
        await create(s.branch, examOf(s, { classIds: [s.classId], first: 1, last: 2 })),
      );
      const draft = await t.post('/api/timetable/versions', s.branch, {
        academicYearId: s.year,
        startsOn: NEXT_MONDAY,
        copyFrom: s.version,
      });
      expect(draft.status, JSON.stringify(draft.body)).toBe(201);
      const version = (draft.body as { id: string }).id;
      // The copy's lessons placed again as in the version, as the bulk cancel tests do.
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', version)
        .execute();
      for (const row of await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', version)
        .execute()) {
        await placeAt(s.branch, version, row.id, 1);
      }
      const music = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const singer = await person(s.branch, [music]);
      const extra = await load.row({
        branch_id: s.branch,
        version_id: version,
        class_id: s.classId,
        subject_id: music,
        teacher_id: singer.staffId,
        lessons_per_week: 1,
      });
      await placeAt(s.branch, version, extra, 1, 3);
      const confirmed = await t.post(
        `/api/timetable/versions/${version}/templates/confirm`,
        s.branch,
      );
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      await load.freeEditLock(version);
      const refused = await publish(s.branch, version, NEXT_MONDAY);
      refusedWith(refused, 409, 'publish_over_exam');
      expect(detailsOf(refused)).toEqual([expect.objectContaining({ recordId: exam.exam.id })]);
      // With the exam cancelled, the same version publishes.
      saved(await cancel(s.branch, exam.exam.id), 200);
      await load.freeEditLock(version);
      const done = await publish(s.branch, version, NEXT_MONDAY);
      expect(done.status, JSON.stringify(done.body)).toBe(200);
    });

    it('refuses a withdraw and a publish that would remove a block a standing exam keeps a class out of, with no 500 (spec review of the code, must-fix 2)', async () => {
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
      );
      // A new version without the art lessons, from Monday 19 October.
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
      await t.database.migrator
        .deleteFrom('teaching_load_rows')
        .where('version_id', '=', version)
        .where('group_id', '=', art.group)
        .execute();
      for (const row of await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', version)
        .execute()) {
        await placeAt(s.branch, version, row.id, 1);
      }
      const confirmed = await t.post(
        `/api/timetable/versions/${version}/templates/confirm`,
        s.branch,
      );
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      await load.freeEditLock(version);
      const published = await publish(s.branch, version, NEXT_MONDAY);
      refusedWith(published, 409, 'publish_over_exam');
      expect(detailsOf(published)).toEqual([expect.objectContaining({ recordId: exam.exam.id })]);
      const withdrawn = await request(t.kit.server)
        .post(`/api/timetable/versions/${s.version}/withdraw`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({});
      refusedWith(withdrawn, 409, 'publish_over_exam');
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
      const s = await scene({ art: true });
      const o = await scene({ art: true });
      const exam = saved(
        await create(s.branch, examOf(s, { date: LATER_MONDAY, classIds: [s.otherClass] })),
      );
      const theirs = saved(
        await create(o.branch, examOf(o, { date: LATER_MONDAY, classIds: [o.otherClass] })),
      );
      const ownBlock =
        (await lessonsOf(THURSDAY, { groupId: s.art?.group ?? '' }))[0]?.block_id ?? '';
      const theirBlock =
        (await lessonsOf(THURSDAY, { groupId: o.art?.group ?? '' }))[0]?.block_id ?? '';
      const theirLesson = (await lessonOf(LATER_MONDAY, o.classId)).id;
      const base = examOf(s);
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
            ...examOf(s, { date: LATER_MONDAY, classIds: [s.otherClass] }),
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
        refusedWith(await change(s.branch, id, examOf(s)), 404, 'not_found');
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
});
