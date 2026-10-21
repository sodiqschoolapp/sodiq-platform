import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  attentionSchema,
  classTutorPreviewSchema,
  dayAnswerSchema,
  dayChangeAnswerSchema,
  substitutesAnswerSchema,
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
import { substitutionRowsOf } from '../../testing/substitutions-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const changed = (response: Response) => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return dayChangeAnswerSchema.parse(response.body);
};

/** The rule codes of a refusal's details. */
const rulesOf = (response: Response, code: string) => {
  refusedWith(response, 409, code);
  return (response.body as { error: { details: { code: string }[] } }).error.details.map(
    (one) => one.code,
  );
};

const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

/** A moment of a school date at a clock time in Tashkent (+05:00). */
const at = (date: string, time: string): Date => new Date(`${date}T${time}:00+05:00`);

const TUESDAY = '2026-10-13';

// All names are invented. Task 5.7b-1, pull request #191: the substitution
// of a lesson (docs/spec/06-timetable.md, Changes after publishing:
// "Substitution. The one way to put another teacher on a lesson. It can be
// started from a single lesson (pick a substitute for it) ... suggests
// teachers who are free in that slot: same subject first, then same
// department. Teachers who cannot teach in the class's language are listed
// last and marked. Either way one substitution record is kept: who was
// replaced, by whom, for which lessons and why."; edge/timetable, After
// publishing, "No teacher of the subject is free": "For a one-day change
// only, 'subject in the teacher's profile' and 'outside availability' become
// warnings that need a tick. Double booking stays blocked."). The clock
// stands at 23:55 on Saturday 10 October 2026 in Tashkent; the version runs
// from Monday 12 October.
describe('the substitution of a lesson', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let author: string;

  const keyed = (path: string, branch: string, body: object, cookie: string, key: string) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, key)
      .send(body);

  const substitute = (
    branch: string,
    id: string,
    body: { teacherId: string; reason?: string; confirm?: boolean },
    cookie = t.admin,
    key: string = randomUUID(),
  ) =>
    keyed(
      `/api/timetable/lessons/${id}/substitute`,
      branch,
      { reason: 'The teacher is ill', ...body },
      cookie,
      key,
    );

  const withdraw = (branch: string, id: string, cookie = t.admin, key: string = randomUUID()) =>
    keyed(
      `/api/timetable/lessons/${id}/substitution/withdraw`,
      branch,
      { reason: 'The teacher is back' },
      cookie,
      key,
    );

  const suggestions = async (branch: string, id: string) => {
    const response = await t.get(`/api/timetable/lessons/${id}/substitutes`, branch);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return substitutesAnswerSchema.parse(response.body);
  };

  const day = async (branch: string, classId: string, date: string, cookie = t.admin) => {
    const response = await t.get(
      `/api/timetable/day?date=${date}&classId=${classId}`,
      branch,
      cookie,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return dayAnswerSchema.parse(response.body);
  };

  const publish = (branch: string, version: string, startsOn: string, body: object = {}) =>
    request(t.kit.server)
      .post(`/api/timetable/versions/${version}/publish`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ startsOn, ...body });

  /** Hours of a person in the branch from 1 September, Monday to Friday, from `start` minutes. */
  async function hours(branch: string, staffId: string, start = 0) {
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

  /** A person of the branch with hours, and the subjects and languages named. */
  async function person(
    branch: string,
    input: {
      subjects?: readonly { subject: string; grades: readonly number[] }[];
      languages?: readonly ('uz' | 'ru')[];
      start?: number;
    } = {},
  ) {
    const one = await load.teacher(branch, {
      subjects: input.subjects ?? [],
      ...(input.languages === undefined ? {} : { languages: input.languages }),
    });
    await hours(branch, one.staffId, input.start ?? 0);
    return one;
  }

  /**
   * A new branch with a year of four dated quarters, a day of three lessons
   * from 08:00, two classes of grade 7, and a version published from Monday
   * 12 October: maths of each class on Monday in the first slot, each with a
   * teacher of its own (the second class's a vacancy with `vacancy`); with
   * `twoLessons` the first class's maths a double in the first two lessons;
   * with `split` the first class split in two groups for English on
   * Wednesday; with `tutor` a Tutor row of the first class on Tuesday.
   */
  async function scene(
    input: {
      branch?: string;
      twoLessons?: boolean;
      vacancy?: boolean;
      split?: boolean;
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
    const subject = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    // A subject of nobody's lessons, so a teacher of it is a teacher without the lessons' subject.
    const otherSubject = await load.classes.subject({
      grades: [7],
      journalType: 'attendance_only',
    });
    const room = await load.classes.room(branch);
    const otherRoom = await load.classes.room(branch);
    const classId = await load.classes.schoolClass(branch, year, { grade: 7, room });
    const otherClass = await load.classes.schoolClass(branch, year, { grade: 7, room: otherRoom });
    const teacher = await person(branch, { subjects: [{ subject, grades: [7] }] });
    const otherTeacher = await person(branch, { subjects: [{ subject, grades: [7] }] });
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
    if (input.twoLessons === true) await placeAt(branch, version, rowId, 1, 3);
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
    await placeAt(branch, version, otherRow, 1);
    let english: string | null = null;
    const splitTeachers: { staffId: string; accountId: string }[] = [];
    if (input.split === true) {
      english = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
      const rows: string[] = [];
      for (let index = 0; index < 2; index += 1) {
        const group = await load.classes.group(branch, year, english, [classId]);
        const one = await person(branch, { subjects: [{ subject: english, grades: [7] }] });
        splitTeachers.push(one);
        rows.push(
          await load.row({
            branch_id: branch,
            version_id: version,
            group_id: group,
            subject_id: english,
            teacher_id: one.staffId,
            lessons_per_week: 1,
          }),
        );
      }
      await placeAt(branch, version, rows[0] ?? '', 3);
    }
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
    return {
      branch,
      year,
      subject,
      otherSubject,
      room,
      otherRoom,
      classId,
      otherClass,
      teacher,
      otherTeacher,
      version,
      rowId,
      vacancy,
      english,
      splitTeachers,
      tutorSubject,
      tutor,
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /** The stored lesson of a class and subject on a date (the first by start). */
  const lessonOf = async (s: Scene, date: string, classId = s.classId, subject = s.subject) =>
    await t.database.migrator
      .selectFrom('lessons')
      .selectAll()
      .where('branch_id', '=', s.branch)
      .where('class_id', '=', classId)
      .where('subject_id', '=', subject)
      .where('lesson_date', '=', date)
      .orderBy('starts_at')
      .executeTakeFirstOrThrow();

  const rowOf = (id: string) =>
    t.database.migrator
      .selectFrom('lessons')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  /** The records of a lesson with their rows, oldest first. */
  const recordsOf = (lessonId: string) =>
    t.database.migrator
      .selectFrom('substitution_lessons')
      .innerJoin('substitutions', 'substitutions.id', 'substitution_lessons.substitution_id')
      .select([
        'substitutions.id',
        'substitutions.source',
        'substitutions.replaced_id',
        'substitutions.substitute_id',
        'substitutions.relaxed',
        'substitutions.reason',
        'substitution_lessons.ended_at',
        'substitution_lessons.end_cause',
      ])
      .where('substitution_lessons.lesson_id', '=', lessonId)
      .orderBy('substitutions.made_at')
      .orderBy('substitutions.id')
      .execute();

  const auditOf = (lessonId: string, action: string) =>
    t.database.migrator
      .selectFrom('audit_log')
      .select(['old_value', 'new_value'])
      .where('record_id', '=', lessonId)
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

  /** An absence of the person for Monday 12 October. */
  async function absent(staffId: string, from = MONDAY, until = TUESDAY) {
    await t.database.migrator
      .insertInto('absences')
      .values({
        staff_id: staffId,
        starts_on: from,
        ends_on: from,
        applies_from: at(from, '00:00'),
        applies_until: at(until, '00:00'),
        reason: 'Ill',
        created_by: author,
      })
      .execute();
  }

  /**
   * Runs `work` with the clock at `moment` and an Academic Vice Principal of the branch signed in then
   * (the kit's sessions would end after 15 idle minutes); the clock goes back
   * to the start afterwards.
   */
  async function asViceAt(branch: string, moment: Date, work: (cookie: string) => Promise<void>) {
    t.clock.set(moment);
    try {
      const browser = await t.kit.completeSession('Dilnoza', 'Saidova');
      await t.kit.giveRole(browser.account.id, {
        role: 'academic_vice_principal',
        branchId: branch,
      });
      await work(browser.cookie);
    } finally {
      t.clock.set(START);
    }
  }

  /** A person of the Tutors department with the scene's Tutor subject and hours. */
  async function tutorHolder(s: Scene) {
    const one = await load.tutorSubjectHolder(s.branch, s.tutorSubject ?? '', [7]);
    await hours(s.branch, one.staffId);
    return one;
  }

  /** A new Academic Vice Principal of the branch, signed in now. */
  async function viceOf(branch: string): Promise<string> {
    const browser = await t.kit.completeSession('Zuhra', 'Nazarova');
    await t.kit.giveRole(browser.account.id, { role: 'academic_vice_principal', branchId: branch });
    return browser.cookie;
  }

  /** Every row of the tables a substitution writes, and the log. */
  const everything = () =>
    Promise.all([
      t.database.migrator.selectFrom('lessons').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('time_claims').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('lesson_changes').selectAll().orderBy('lesson_id').execute(),
      t.database.migrator.selectFrom('substitutions').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('substitution_lessons').selectAll().orderBy('id').execute(),
      t.database.migrator
        .selectFrom('lesson_absence_taught')
        .selectAll()
        .orderBy('lesson_id')
        .execute(),
      t.database.migrator.selectFrom('notifications').select('id').orderBy('id').execute(),
      t.database.migrator.selectFrom('audit_log').select('id').orderBy('id').execute(),
      t.database.migrator.selectFrom('request_keys').selectAll().orderBy('key').execute(),
      // Permission review, should-fix 5: the notices enqueue their delivery job.
      sql<{ id: string }>`select id from pgboss.job order by id`
        .execute(t.database.migrator)
        .then((result) => result.rows),
    ]);

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    author = await load.classes.account();
  });

  afterEach(() => {
    t.clock.set(START);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('a substitution', () => {
    it('puts a free teacher of the subject on the lesson, keeps the record and tells the substitute', async () => {
      const s = await scene();
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      await absent(s.teacher.staffId);
      const lesson = await lessonOf(s, MONDAY);
      expect((await day(s.branch, s.classId, MONDAY)).lessons[0]?.state).toBe('needs_teacher');

      const answer = changed(await substitute(s.branch, lesson.id, { teacherId: free.staffId }));
      expect(answer.lesson.teacher?.id).toBe(free.staffId);
      expect(answer.lesson.substitution?.replaced?.id).toBe(s.teacher.staffId);
      // From 5.7a-1: a substitute makes the lesson of an absent teacher upcoming again.
      expect(answer.lesson.state).toBe('upcoming');
      expect((await rowOf(lesson.id)).teacher_id).toBe(free.staffId);
      const claims = await t.database.migrator
        .selectFrom('time_claims')
        .select('teacher_id')
        .where('lesson_id', '=', lesson.id)
        .where('teacher_id', 'is not', null)
        .execute();
      expect(claims.map((one) => one.teacher_id)).toEqual([free.staffId]);
      expect(await recordsOf(lesson.id)).toEqual([
        expect.objectContaining({
          source: 'lesson',
          replaced_id: s.teacher.staffId,
          substitute_id: free.staffId,
          relaxed: false,
          reason: 'The teacher is ill',
          ended_at: null,
        }),
      ]);
      // Decision 7: the substitute is told by its own kind, the teacher replaced as for any one-day change.
      const assigned = await noticesOf(free.accountId, 'timetable.substitution_assigned');
      expect(assigned.map((one) => one.branch_id)).toEqual([s.branch]);
      expect(assigned[0]?.data).toMatchObject({ date: MONDAY });
      expect(await noticesOf(free.accountId, 'timetable.day_changed')).toEqual([]);
      expect(await noticesOf(s.teacher.accountId, 'timetable.day_changed')).toHaveLength(1);
      const [entry] = await auditOf(lesson.id, 'lesson.substitute');
      expect(entry?.new_value).toMatchObject({
        substituteId: free.staffId,
        replacedIds: { [lesson.id]: s.teacher.staffId },
        relaxed: false,
        reason: 'The teacher is ill',
      });
      expect(entry?.old_value).toMatchObject({ teacherId: s.teacher.staffId });

      // After its start the lesson is held, never unresolved (edge/00-definitions, Held lesson).
      await asViceAt(s.branch, at(MONDAY, '09:00'), async (cookie) => {
        expect((await day(s.branch, s.classId, MONDAY, cookie)).lessons[0]?.state).toBe('held');
      });
    });

    it('substitutes both halves of a double together', async () => {
      const s = await scene({ twoLessons: true });
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      const lesson = await lessonOf(s, MONDAY);
      // The two Monday lessons made one double pair, as the one-day change tests do.
      const blocks = await t.database.migrator
        .selectFrom('lessons')
        .select('block_id')
        .where('class_id', '=', s.classId)
        .where('lesson_date', '=', MONDAY)
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
      changed(await substitute(s.branch, lesson.id, { teacherId: free.staffId }));
      const both = await t.database.migrator
        .selectFrom('lessons')
        .select(['id', 'teacher_id'])
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .where('lesson_date', '=', MONDAY)
        .execute();
      expect(both).toHaveLength(2);
      expect(both.every((one) => one.teacher_id === free.staffId)).toBe(true);
      for (const one of both) {
        expect(await recordsOf(one.id)).toEqual([
          expect.objectContaining({ replaced_id: s.teacher.staffId, ended_at: null }),
        ]);
      }
      // One record for the two halves.
      expect(
        new Set(
          (await Promise.all(both.map((one) => recordsOf(one.id)))).flat().map((one) => one.id),
        ).size,
      ).toBe(1);
    });

    it('substitutes one part of a block alone', async () => {
      const s = await scene({ split: true });
      const english = s.english ?? '';
      const [first, second] = await t.database.migrator
        .selectFrom('lessons')
        .select(['id', 'teacher_id'])
        .where('branch_id', '=', s.branch)
        .where('subject_id', '=', english)
        .where('lesson_date', '=', '2026-10-14')
        .orderBy('teacher_id')
        .execute();
      if (first === undefined || second === undefined) throw new Error('No split.');
      const free = await person(s.branch, { subjects: [{ subject: english, grades: [7] }] });
      changed(await substitute(s.branch, first.id, { teacherId: free.staffId }));
      expect((await rowOf(first.id)).teacher_id).toBe(free.staffId);
      expect((await rowOf(second.id)).teacher_id).toBe(second.teacher_id);
    });

    it('refuses a lesson of a closed year, and offers no substitution there (decision 8; code review must-fix 3)', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      changed(await substitute(s.branch, lesson.id, { teacherId: free.staffId }));
      const other = await lessonOf(s, '2026-10-19');
      await t.database.migrator
        .updateTable('academic_years')
        .set({ status: 'closed' })
        .where('id', '=', s.year)
        .execute();
      refusedWith(
        await substitute(s.branch, other.id, { teacherId: free.staffId }),
        409,
        'timetable_year_closed',
      );
      refusedWith(await withdraw(s.branch, lesson.id), 409, 'timetable_year_closed');
      const shown = (await day(s.branch, s.classId, '2026-10-19')).lessons.find(
        (one) => one.id === other.id,
      );
      expect(shown?.canSubstitute).toBe(false);
    });

    it('refuses a lesson that started and a cancelled one (decision 8)', async () => {
      const s = await scene();
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      const lesson = await lessonOf(s, MONDAY);
      await asViceAt(s.branch, at(MONDAY, '08:00'), async (cookie) => {
        refusedWith(
          await substitute(s.branch, lesson.id, { teacherId: free.staffId }, cookie),
          409,
          'lesson_started',
        );
      });
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: 'Excursion' })
        .where('id', '=', lesson.id)
        .execute();
      refusedWith(
        await substitute(s.branch, lesson.id, { teacherId: free.staffId }),
        409,
        'lesson_cancelled',
      );
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: null, cancel_reason: null })
        .where('id', '=', lesson.id)
        .execute();
      expect(await recordsOf(lesson.id)).toEqual([]);
    });

    it("refuses the lesson's own teacher, a vacancy, and a substitute away at its start (decision 4)", async () => {
      const s = await scene({ vacancy: true });
      const lesson = await lessonOf(s, MONDAY);
      refusedWith(
        await substitute(s.branch, lesson.id, { teacherId: s.teacher.staffId }),
        409,
        'teacher_unchanged',
      );
      // A vacancy is never offered as a substitute, with or without the exception.
      const vacancy = s.vacancy ?? '';
      expect(
        rulesOf(
          await substitute(s.branch, lesson.id, { teacherId: vacancy }),
          'substitution_blocked',
        ),
      ).toContain('substitute_vacancy');
      const ill = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      await absent(ill.staffId);
      refusedWith(
        await substitute(s.branch, lesson.id, { teacherId: ill.staffId }),
        409,
        'substitute_away',
      );
      const locked = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      await t.database.migrator
        .updateTable('accounts')
        .set({ locked_at: at('2026-10-10', '10:00'), locked_by: author, lock_reason: 'Dismissed' })
        .where('id', '=', locked.accountId)
        .execute();
      refusedWith(
        await substitute(s.branch, lesson.id, { teacherId: locked.staffId }),
        409,
        'substitute_away',
      );
      const inactive = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      await load.status(inactive.staffId, 'inactive', MONDAY);
      refusedWith(
        await substitute(s.branch, lesson.id, { teacherId: inactive.staffId }),
        409,
        'substitute_away',
      );
      expect(await recordsOf(lesson.id)).toEqual([]);
    });

    it('refuses a vacancy as the substitute also when no teacher of the subject is free (code review must-fix 4)', async () => {
      const s = await scene({ vacancy: true });
      const lesson = await lessonOf(s, MONDAY);
      // The only free teacher of the subject is away: the exception is in force.
      await absent(s.otherTeacher.staffId);
      expect((await suggestions(s.branch, lesson.id)).noSubjectTeacherFree).toBe(true);
      expect(
        rulesOf(
          await substitute(s.branch, lesson.id, { teacherId: s.vacancy ?? '', confirm: true }),
          'substitution_blocked',
        ),
      ).toContain('substitute_vacancy');
      expect(await recordsOf(lesson.id)).toEqual([]);
    });

    it('refuses a teacher without the subject while one of the subject is free, and takes them with a tick when none is (decision 2)', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const outsider = await person(s.branch, {
        subjects: [{ subject: s.otherSubject, grades: [7] }],
      });
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      expect(
        rulesOf(
          await substitute(s.branch, lesson.id, { teacherId: outsider.staffId, confirm: true }),
          'substitution_blocked',
        ),
      ).toEqual(['teacher_subject']);
      // The teacher of the subject away: none is free, so the subject is a warning with a tick.
      await absent(free.staffId);
      expect(
        rulesOf(
          await substitute(s.branch, lesson.id, { teacherId: outsider.staffId }),
          'substitution_needs_confirm',
        ),
      ).toEqual(['teacher_subject']);
      expect(await recordsOf(lesson.id)).toEqual([]);
      const answer = changed(
        await substitute(s.branch, lesson.id, { teacherId: outsider.staffId, confirm: true }),
      );
      expect(answer.warnings.map((one) => one.rule)).toContain('teacher_subject');
      expect(await recordsOf(lesson.id)).toEqual([
        expect.objectContaining({ substitute_id: outsider.staffId, relaxed: true }),
      ]);
    });

    it("counts neither the lesson's own teacher, present, nor a busy teacher as free (spec review must-fix 7)", async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      // The lesson's teacher is present and the other teacher of the subject
      // teaches the other class at that time: no teacher of the subject is free.
      const outsider = await person(s.branch, {
        subjects: [{ subject: s.otherSubject, grades: [7] }],
      });
      const found = await suggestions(s.branch, lesson.id);
      expect(found.noSubjectTeacherFree).toBe(true);
      expect(found.teachers.map((one) => one.id)).not.toContain(s.teacher.staffId);
      expect(found.teachers.map((one) => one.id)).not.toContain(s.otherTeacher.staffId);
      expect(found.teachers.map((one) => one.id)).toContain(outsider.staffId);
      // Double booking stays blocked, whatever is relaxed.
      expect(
        rulesOf(
          await substitute(s.branch, lesson.id, {
            teacherId: s.otherTeacher.staffId,
            confirm: true,
          }),
          'substitution_blocked',
        ),
      ).toContain('teacher_double');
    });

    it("asks a confirmation for a teacher of the subject who cannot teach in the class's language, never blocks it (spec review must-fix 1)", async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const russian = await person(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
        languages: ['ru'],
      });
      expect(
        rulesOf(
          await substitute(s.branch, lesson.id, { teacherId: russian.staffId }),
          'substitution_needs_confirm',
        ),
      ).toEqual(['substitute_language']);
      changed(await substitute(s.branch, lesson.id, { teacherId: russian.staffId, confirm: true }));
      expect(await recordsOf(lesson.id)).toEqual([
        expect.objectContaining({ substitute_id: russian.staffId, relaxed: false }),
      ]);
    });

    it('takes the relaxed rules and the language together with one tick, both in the audit entry (spec review should-fix 4)', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const russian = await person(s.branch, {
        subjects: [{ subject: s.otherSubject, grades: [7] }],
        languages: ['ru'],
      });
      expect(
        rulesOf(
          await substitute(s.branch, lesson.id, { teacherId: russian.staffId }),
          'substitution_needs_confirm',
        ).sort(),
      ).toEqual(['substitute_language', 'teacher_subject']);
      changed(await substitute(s.branch, lesson.id, { teacherId: russian.staffId, confirm: true }));
      const [entry] = await auditOf(lesson.id, 'lesson.substitute');
      expect(entry?.new_value).toMatchObject({ confirmed: true, relaxed: true });
      expect((entry?.new_value as { warnings: string[] }).warnings).toEqual(
        expect.arrayContaining(['substitute_language', 'teacher_subject']),
      );
    });

    it('keeps the teacher first replaced when a substitution is replaced, and refuses that teacher as the substitute (decision 5)', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const first = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      const second = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      changed(await substitute(s.branch, lesson.id, { teacherId: first.staffId }));
      refusedWith(
        await substitute(s.branch, lesson.id, { teacherId: s.teacher.staffId }),
        409,
        'substitute_is_replaced',
      );
      changed(await substitute(s.branch, lesson.id, { teacherId: second.staffId }));
      const records = await recordsOf(lesson.id);
      expect(records).toEqual([
        expect.objectContaining({ substitute_id: first.staffId, end_cause: 'replaced' }),
        expect.objectContaining({
          substitute_id: second.staffId,
          replaced_id: s.teacher.staffId,
          ended_at: null,
        }),
      ]);
    });

    it('needs the Tutor subject of a substitute of a Tutor lesson like any substitute (From 3.6c-2)', async () => {
      const s = await scene({ tutor: true });
      const tutorLesson = await lessonOf(s, TUESDAY, s.classId, s.tutorSubject ?? '');
      await tutorHolder(s);
      expect(
        rulesOf(
          await substitute(s.branch, tutorLesson.id, {
            teacherId: s.teacher.staffId,
            confirm: true,
          }),
          'substitution_blocked',
        ),
      ).toEqual(['teacher_subject']);
    });

    it('records a substitute on a vacancy\'s lesson, which leaves "needs a teacher", and the withdrawal gives it back', async () => {
      const s = await scene({ vacancy: true });
      const lesson = await lessonOf(s, MONDAY, s.otherClass);
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      const attention = async () => {
        const response = await t.get('/api/timetable/attention', s.branch);
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        return attentionSchema
          .parse(response.body)
          .needsTeacher.filter((one) => one.cause === 'vacancy')
          .reduce((sum, one) => sum + one.lessons, 0);
      };
      const before = await attention();
      expect(before).toBeGreaterThan(0);
      changed(await substitute(s.branch, lesson.id, { teacherId: free.staffId }));
      expect(await recordsOf(lesson.id)).toEqual([
        expect.objectContaining({ replaced_id: s.vacancy, substitute_id: free.staffId }),
      ]);
      expect(await attention()).toBe(before - 1);
      changed(await withdraw(s.branch, lesson.id));
      expect((await rowOf(lesson.id)).teacher_id).toBe(s.vacancy);
      expect(await attention()).toBe(before);
    });

    /**
     * A transaction of another branch that writes `teacherId` into
     * `lessonId` and holds the claim open, as a change that takes neither
     * the publish lock nor a row of the route's branch would: the route's
     * check passes, and its write meets the claim at the commit check
     * (permission review, should-fix 6).
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
          await sql`set constraints all immediate`.execute(transaction);
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await isReady;
      return { release, held };
    }

    /** Waits until one session of the test database waits on a lock. */
    const oneWaiting = () =>
      expect
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

    it('answers substitution_blocked when the claim of the substitute is taken at the same moment, and leaves nothing behind', async () => {
      const s = await scene();
      const elsewhere = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      // The same clock time in another branch: the teacher claim spans branches.
      const other = await lessonOf(elsewhere, MONDAY);
      const holding = await heldClaim(elsewhere.branch, other.id, free.staffId);
      const before = await everything();
      const pending = substitute(s.branch, lesson.id, { teacherId: free.staffId }).then(
        (one) => one,
      );
      await oneWaiting();
      holding.release();
      expect(await holding.held).toBeUndefined();
      refusedWith(await pending, 409, 'substitution_blocked');
      const after = await everything();
      // Only the held side's write changed the lessons and claims.
      expect(after.slice(3)).toEqual(before.slice(3));
      expect((await rowOf(lesson.id)).teacher_id).toBe(s.teacher.staffId);
    });

    it('answers substitution_return_blocked when the claim of the teacher returned is taken at the same moment', async () => {
      const s = await scene();
      const elsewhere = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      changed(await substitute(s.branch, lesson.id, { teacherId: free.staffId }));
      const other = await lessonOf(elsewhere, MONDAY);
      const holding = await heldClaim(elsewhere.branch, other.id, s.teacher.staffId);
      const before = await everything();
      const pending = withdraw(s.branch, lesson.id).then((one) => one);
      await oneWaiting();
      holding.release();
      expect(await holding.held).toBeUndefined();
      refusedWith(await pending, 409, 'substitution_return_blocked');
      const after = await everything();
      expect(after.slice(3)).toEqual(before.slice(3));
      expect((await rowOf(lesson.id)).teacher_id).toBe(free.staffId);
    });

    it('hides the name of a teacher replaced who no longer works in the branch, and a withdrawal gives the lesson to nobody (permission review, findings 7 and 9)', async () => {
      const s = await scene();
      const elsewhere = await scene();
      const lesson = await lessonOf(s, '2026-10-19');
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      changed(await substitute(s.branch, lesson.id, { teacherId: free.staffId }));
      // The teacher replaced works only in another branch now.
      await t.database.migrator.transaction().execute(async (transaction) => {
        await transaction
          .updateTable('staff_branches')
          .set({ is_main: false })
          .where('staff_id', '=', s.teacher.staffId)
          .execute();
        await transaction
          .insertInto('staff_branches')
          .values({ staff_id: s.teacher.staffId, branch_id: elsewhere.branch, is_main: true })
          .execute();
        await transaction
          .deleteFrom('staff_branches')
          .where('staff_id', '=', s.teacher.staffId)
          .where('branch_id', '=', s.branch)
          .execute();
      });
      for (const cookie of [t.admin, await viceOf(s.branch)]) {
        const found = (await day(s.branch, s.classId, '2026-10-19', cookie)).lessons.find(
          (one) => one.id === lesson.id,
        );
        expect(found?.substitution?.replaced).toEqual({
          id: s.teacher.staffId,
          kind: 'person',
          name: '',
        });
      }
      const answer = changed(await withdraw(s.branch, lesson.id));
      expect(answer.lesson.teacher).toBeNull();
      expect(answer.lesson.state).toBe('needs_teacher');
    });
  });

  describe('the suggestions (decision 3)', () => {
    it('leaves out a teacher busy in another branch, one who invigilates an exam then and one whose account is locked (code review must-fix 5)', async () => {
      const s = await scene();
      const elsewhere = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      // A teacher of the branch who also works in the other branch and
      // teaches there at the same clock time (busy elsewhere).
      const busyOne = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      const busy = busyOne.staffId;
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: busy, branch_id: elsewhere.branch, is_main: false })
        .execute();
      await t.database.migrator
        .updateTable('lessons')
        .set({ teacher_id: busy })
        .where('id', '=', (await lessonOf(elsewhere, MONDAY, elsewhere.otherClass)).id)
        .execute();
      // An invigilator of an exam of another class at that time.
      const invigilator = await person(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
      });
      const sitting = await load.classes.schoolClass(s.branch, s.year, { grade: 7 });
      const hall = await load.classes.room(s.branch);
      await t.database.migrator.transaction().execute(async (transaction) => {
        const exam = await transaction
          .insertInto('exams')
          .values({
            branch_id: s.branch,
            academic_year_id: s.year,
            exam_date: MONDAY,
            starts_at: at(MONDAY, '08:00'),
            ends_at: at(MONDAY, '08:45'),
            first_slot: 1,
            last_slot: 1,
            title: 'Quarter exam in maths',
            subject_id: s.subject,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const room = await transaction
          .insertInto('exam_rooms')
          .values({ branch_id: s.branch, exam_id: exam.id, room_id: hall })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('exam_room_classes')
          .values({
            branch_id: s.branch,
            exam_id: exam.id,
            exam_room_id: room.id,
            class_id: sitting,
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
      const locked = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      await t.database.migrator
        .updateTable('accounts')
        .set({ locked_at: at('2026-10-10', '10:00'), locked_by: author, lock_reason: 'Dismissed' })
        .where('id', '=', locked.accountId)
        .execute();
      const ids = (await suggestions(s.branch, lesson.id)).teachers.map((one) => one.id);
      expect(ids).toContain(free.staffId);
      expect(ids).not.toContain(busy);
      expect(ids).not.toContain(invigilator.staffId);
      expect(ids).not.toContain(locked.staffId);
    });

    it('lists the free teachers of the subject only while one is free, the ones who cannot teach in the language last and marked', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const uzbek = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      const russian = await person(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
        languages: ['ru'],
      });
      const department = await person(s.branch, {
        subjects: [{ subject: s.otherSubject, grades: [7] }],
      });
      // No subject in the profile: not a teacher, never suggested.
      const clerk = await load.teacher(s.branch);
      const ill = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      await absent(ill.staffId);
      const found = await suggestions(s.branch, lesson.id);
      expect(found.noSubjectTeacherFree).toBe(false);
      expect(found.teachers.map((one) => [one.id, one.group, one.language])).toEqual([
        [uzbek.staffId, 'subject', false],
        [russian.staffId, 'subject', true],
      ]);
      expect(found.teachers.map((one) => one.id)).not.toContain(department.staffId);
      expect(found.teachers.map((one) => one.id)).not.toContain(clerk.staffId);
    });

    it('lists subject, then department, then the others when none is free, every one without the language after all the others', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      // A teacher of the subject outside their hours (from 09:00) and without the language.
      const late = await person(s.branch, {
        subjects: [{ subject: s.subject, grades: [7] }],
        languages: ['ru'],
        start: 540,
      });
      const otherSubjects = { subjects: [{ subject: s.otherSubject, grades: [7] }] };
      const department = await person(s.branch, otherSubjects);
      const departmentRussian = await person(s.branch, { ...otherSubjects, languages: ['ru'] });
      // A teacher of another department, with a subject of that department.
      const elsewhere = await t.database.migrator
        .selectFrom('departments')
        .select('id')
        .where('name_en', '<>', 'STEAM')
        .where('tutors', '=', false)
        .orderBy('id')
        .executeTakeFirstOrThrow();
      const theirs = await load.classes.subject({ grades: [7] });
      await t.database.migrator
        .updateTable('subjects')
        .set({ department_id: elsewhere.id })
        .where('id', '=', theirs)
        .execute();
      const other = await person(s.branch);
      await t.database.migrator
        .updateTable('staff_divisions')
        .set({ department_id: elsewhere.id })
        .where('staff_id', '=', other.staffId)
        .execute();
      await load.profile(other.staffId, [{ subject: theirs, grades: [7] }]);
      const found = await suggestions(s.branch, lesson.id);
      expect(found.noSubjectTeacherFree).toBe(true);
      expect(found.teachers.map((one) => [one.id, one.group, one.language])).toEqual([
        [department.staffId, 'department', false],
        [other.staffId, 'other', false],
        [late.staffId, 'subject', true],
        [departmentRussian.staffId, 'department', true],
      ]);
      expect(found.teachers.find((one) => one.id === late.staffId)?.warnings).toEqual(
        expect.arrayContaining(['teacher_unavailable', 'substitute_language']),
      );
    });
  });

  describe('the withdrawal (decision 12)', () => {
    it('gives the lesson back to the teacher replaced, who is absent: it needs a teacher again', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      await absent(s.teacher.staffId);
      changed(await substitute(s.branch, lesson.id, { teacherId: free.staffId }));
      const answer = changed(await withdraw(s.branch, lesson.id));
      expect(answer.lesson.teacher?.id).toBe(s.teacher.staffId);
      expect(answer.lesson.state).toBe('needs_teacher');
      expect(answer.lesson.substitution).toBeNull();
      expect(await recordsOf(lesson.id)).toEqual([
        expect.objectContaining({ end_cause: 'withdrawn' }),
      ]);
      expect(await auditOf(lesson.id, 'lesson.substitute_withdraw')).toHaveLength(1);
      refusedWith(await withdraw(s.branch, lesson.id), 409, 'substitution_not_in_force');
    });

    it('gives the lesson back to an inactive teacher, who leaves it needing a teacher', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      changed(await substitute(s.branch, lesson.id, { teacherId: free.staffId }));
      await load.status(s.teacher.staffId, 'inactive', MONDAY);
      const answer = changed(await withdraw(s.branch, lesson.id));
      expect(answer.lesson.teacher?.id).toBe(s.teacher.staffId);
      expect(answer.lesson.state).toBe('needs_teacher');
    });

    it("refuses a return that clashes in time with the teacher's other lesson", async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      changed(await substitute(s.branch, lesson.id, { teacherId: free.staffId }));
      // The teacher replaced substitutes the other class's lesson at that time.
      const other = await lessonOf(s, MONDAY, s.otherClass);
      changed(await substitute(s.branch, other.id, { teacherId: s.teacher.staffId }));
      expect(rulesOf(await withdraw(s.branch, lesson.id), 'substitution_return_blocked')).toContain(
        'teacher_double',
      );
      expect((await rowOf(lesson.id)).teacher_id).toBe(free.staffId);
    });

    it("ends the substitution of a vacancy's lesson that its fill gives the person (until 5.7b-3)", async () => {
      const s = await scene({ vacancy: true });
      const lesson = await lessonOf(s, MONDAY, s.otherClass);
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      changed(await substitute(s.branch, lesson.id, { teacherId: free.staffId }));
      // The vacancy filled from Monday by the real route: its carry gives the
      // kept lesson the person and ends the substitution (`dropped`), so a
      // withdrawal never returns a closed vacancy (decision 6).
      const body = { vacancyId: s.vacancy, personId: s.otherTeacher.staffId, startsOn: MONDAY };
      const check = await t.post('/api/timetable/vacancy-fills/check', s.branch, body);
      expect(check.status, JSON.stringify(check.body)).toBe(200);
      const found = check.body as {
        rowsKey: string;
        publish: {
          chain: { key: string } | null;
          impact: { transition: { key: string | null } | null; dayChanges: { key: string } } | null;
        } | null;
      };
      const filled = await keyed(
        '/api/timetable/vacancy-fills',
        s.branch,
        {
          ...body,
          rowsKey: found.rowsKey,
          ...(found.publish?.chain == null ? {} : { laterKey: found.publish.chain.key }),
          ...(found.publish?.impact?.transition?.key == null
            ? {}
            : { transitionKey: found.publish.impact.transition.key }),
          ...(found.publish?.impact == null
            ? {}
            : { dayChangesKey: found.publish.impact.dayChanges.key }),
        },
        t.admin,
        randomUUID(),
      );
      expect(filled.status, JSON.stringify(filled.body)).toBe(201);
      expect((await rowOf(lesson.id)).teacher_id).toBe(s.otherTeacher.staffId);
      expect(await recordsOf(lesson.id)).toEqual([
        expect.objectContaining({ end_cause: 'dropped' }),
      ]);
      refusedWith(await withdraw(s.branch, lesson.id), 409, 'substitution_not_in_force');
    });

    it("gives a Tutor lesson back to the class's Tutor in force at its start", async () => {
      const s = await scene({ tutor: true });
      const tutorLesson = await lessonOf(s, TUESDAY, s.classId, s.tutorSubject ?? '');
      const free = await tutorHolder(s);
      changed(await substitute(s.branch, tutorLesson.id, { teacherId: free.staffId }));
      changed(await withdraw(s.branch, tutorLesson.id));
      expect((await rowOf(tutorLesson.id)).teacher_id).toBe(s.tutor?.staffId);
    });

    it('refuses a lesson that started', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      changed(await substitute(s.branch, lesson.id, { teacherId: free.staffId }));
      await asViceAt(s.branch, at(MONDAY, '08:10'), async (cookie) => {
        refusedWith(await withdraw(s.branch, lesson.id, cookie), 409, 'lesson_started');
      });
    });
  });

  describe('the other changes of a substituted lesson (spec review must-fix 2)', () => {
    it('keeps the substitute of a Tutor lesson through a room change and a Tutor follow', async () => {
      const s = await scene({ tutor: true });
      const tutorLesson = await lessonOf(s, TUESDAY, s.classId, s.tutorSubject ?? '');
      const free = await tutorHolder(s);
      changed(await substitute(s.branch, tutorLesson.id, { teacherId: free.staffId }));
      const roomed = await keyed(
        `/api/timetable/lessons/${tutorLesson.id}/room`,
        s.branch,
        { roomId: s.otherRoom, reason: 'The room is painted' },
        t.admin,
        randomUUID(),
      );
      expect(roomed.status, JSON.stringify(roomed.body)).toBe(200);
      expect((await rowOf(tutorLesson.id)).teacher_id).toBe(free.staffId);
      // An acting Tutor appointed through the class route from Sunday: the
      // follow keeps the substituted lesson and moves the next one, and the
      // preview lists only the one it moves (code review must-fix 6).
      const later = await lessonOf(s, '2026-10-20', s.classId, s.tutorSubject ?? '');
      const acting = await person(s.branch);
      const assignmentId = await load.classes.role(acting.accountId, s.branch, 'tutor');
      const give = { kind: 'acting', assignmentId, from: '2026-10-11', until: null };
      const preview = await t.post(`/api/classes/${s.classId}/tutors/preview`, s.branch, give);
      expect(preview.status, JSON.stringify(preview.body)).toBe(200);
      const shown = classTutorPreviewSchema.parse(preview.body);
      const named = [...shown.moved, ...shown.needsTeacher].map((one) => one.lessonId);
      expect(named).not.toContain(tutorLesson.id);
      expect(shown.moved.map((one) => one.lessonId)).toContain(later.id);
      const given = await t.post(`/api/classes/${s.classId}/tutors`, s.branch, give);
      expect(given.status, JSON.stringify(given.body)).toBe(201);
      expect((await rowOf(tutorLesson.id)).teacher_id).toBe(free.staffId);
      expect((await rowOf(later.id)).teacher_id).toBe(acting.staffId);
      expect(await recordsOf(tutorLesson.id)).toEqual([
        expect.objectContaining({ ended_at: null }),
      ]);
    });

    it('moves a substitute saved under the exception without refusing it for the subject', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const outsider = await person(s.branch, {
        subjects: [{ subject: s.otherSubject, grades: [7] }],
      });
      changed(
        await substitute(s.branch, lesson.id, { teacherId: outsider.staffId, confirm: true }),
      );
      const moved = await keyed(
        `/api/timetable/lessons/${lesson.id}/move`,
        s.branch,
        { date: MONDAY, lessonNumber: 3, reason: 'Excursion in the morning' },
        t.admin,
        randomUUID(),
      );
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect((await rowOf(lesson.id)).teacher_id).toBe(outsider.staffId);
    });

    it('keeps the substitute through a cancel and its restore', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      changed(await substitute(s.branch, lesson.id, { teacherId: free.staffId }));
      const cancelled = await keyed(
        `/api/timetable/lessons/${lesson.id}/cancel`,
        s.branch,
        { reason: 'Excursion' },
        t.admin,
        randomUUID(),
      );
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      const restored = await keyed(
        `/api/timetable/lessons/${lesson.id}/restore`,
        s.branch,
        {},
        t.admin,
        randomUUID(),
      );
      expect(restored.status, JSON.stringify(restored.body)).toBe(200);
      expect((await rowOf(lesson.id)).teacher_id).toBe(free.staffId);
      expect(dayChangeAnswerSchema.parse(restored.body).lesson.substitution).not.toBeNull();
    });
  });

  describe('an exam over a substituted lesson (code review must-fix 7)', () => {
    it('keeps the substitute when the exam that cancelled the lesson is cancelled', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      changed(await substitute(s.branch, lesson.id, { teacherId: free.staffId }));
      const hall = await load.classes.room(s.branch);
      const invigilator = await person(s.branch);
      const created = await keyed(
        '/api/timetable/exams',
        s.branch,
        {
          date: MONDAY,
          firstLesson: 1,
          lastLesson: 1,
          title: 'Quarter exam in maths',
          subjectId: s.subject,
          rooms: [
            {
              roomId: hall,
              classIds: [s.classId],
              groupIds: [],
              invigilatorIds: [invigilator.staffId],
            },
          ],
          blockChoices: [],
          confirm: true,
        },
        t.admin,
        randomUUID(),
      );
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect((await rowOf(lesson.id)).cancel_cause).toBe('exam');
      const examId = (created.body as { exam: { id: string } }).exam.id;
      const cancelled = await keyed(
        `/api/timetable/exams/${examId}/cancel`,
        s.branch,
        {},
        t.admin,
        randomUUID(),
      );
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      const row = await rowOf(lesson.id);
      expect(row.cancel_cause).toBeNull();
      expect(row.teacher_id).toBe(free.staffId);
      expect(await recordsOf(lesson.id)).toEqual([expect.objectContaining({ ended_at: null })]);
    });
  });

  describe('the correction of a past lesson (decision 8)', () => {
    const correct = (branch: string, id: string, body: object, cookie: string) =>
      keyed(`/api/timetable/lessons/${id}/correction`, branch, body, cookie, randomUUID());

    it('records another person as substituting and ends the substitution in force', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const first = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      const taught = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      changed(await substitute(s.branch, lesson.id, { teacherId: first.staffId }));
      await asViceAt(s.branch, at(MONDAY, '10:00'), async (cookie) => {
        const response = await correct(
          s.branch,
          lesson.id,
          {
            kind: 'teacher',
            teacherId: taught.staffId,
            reason: 'Another teacher took the lesson',
            confirm: true,
          },
          cookie,
        );
        expect(response.status, JSON.stringify(response.body)).toBe(200);
      });
      expect(await recordsOf(lesson.id)).toEqual([
        expect.objectContaining({ substitute_id: first.staffId, end_cause: 'corrected' }),
        expect.objectContaining({
          source: 'correction',
          substitute_id: taught.staffId,
          replaced_id: s.teacher.staffId,
          ended_at: null,
        }),
      ]);
    });

    it('records the teacher replaced, absent, as having taught it: no record, held (spec review must-fix 3)', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const first = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      await absent(s.teacher.staffId);
      changed(await substitute(s.branch, lesson.id, { teacherId: first.staffId }));
      await asViceAt(s.branch, at(MONDAY, '10:00'), async (cookie) => {
        const response = await correct(
          s.branch,
          lesson.id,
          {
            kind: 'teacher',
            teacherId: s.teacher.staffId,
            reason: 'The teacher came after all',
            confirm: true,
          },
          cookie,
        );
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(dayChangeAnswerSchema.parse(response.body).lesson.state).toBe('held');
      });
      expect(await recordsOf(lesson.id)).toEqual([
        expect.objectContaining({ substitute_id: first.staffId, end_cause: 'corrected' }),
      ]);
      expect((await rowOf(lesson.id)).teacher_id).toBe(s.teacher.staffId);
    });

    it('leaves no record when it is refused after its writes (code review must-fix 9)', async () => {
      const s = await scene();
      const elsewhere = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const first = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      const taught = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      changed(await substitute(s.branch, lesson.id, { teacherId: first.staffId }));
      // The person recorded takes a lesson of the other branch at that time,
      // held open until the correction waits on its claim.
      const other = await lessonOf(elsewhere, MONDAY);
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
        .run([elsewhere.branch], async (transaction: Transaction) => {
          await transaction
            .updateTable('lessons')
            .set({ teacher_id: taught.staffId })
            .where('id', '=', other.id)
            .execute();
          await sql`set constraints all immediate`.execute(transaction);
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await isReady;
      const before = await substitutionRowsOf(t.database.migrator);
      await asViceAt(s.branch, at(MONDAY, '10:00'), async (cookie) => {
        const pending = correct(
          s.branch,
          lesson.id,
          {
            kind: 'teacher',
            teacherId: taught.staffId,
            reason: 'Another teacher took the lesson',
            confirm: true,
          },
          cookie,
        ).then((one) => one);
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
        refusedWith(await pending, 409, 'correction_blocked');
      });
      expect(await substitutionRowsOf(t.database.migrator)).toEqual(before);
      expect((await rowOf(lesson.id)).teacher_id).toBe(first.staffId);
    });
  });

  describe('a publish over a substituted lesson (decision 6, review correction 1)', () => {
    it("ends the substitution of a kept lesson it gives the row's teacher, and lists it", async () => {
      const s = await scene();
      const lesson = await lessonOf(s, '2026-10-19');
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      changed(await substitute(s.branch, lesson.id, { teacherId: free.staffId }));
      // A fix from Monday 19 October that keeps the lesson where it is.
      const copied = await t.post('/api/timetable/versions', s.branch, {
        academicYearId: s.year,
        startsOn: '2026-10-19',
        copyFrom: s.version,
      });
      expect(copied.status, JSON.stringify(copied.body)).toBe(201);
      const fix = (copied.body as { id: string }).id;
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', fix)
        .execute();
      const fixRows = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select('id')
        .where('version_id', '=', fix)
        .execute();
      for (const row of fixRows) await placeAt(s.branch, fix, row.id, 1);
      const confirmed = await t.post(`/api/timetable/versions/${fix}/templates/confirm`, s.branch);
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      await load.freeEditLock(fix);
      const published = await publish(s.branch, fix, '2026-10-19');
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      // The fix names the teacher of the row on the kept lesson: the
      // substitute is taken off, and the record is ended, never in force
      // against another teacher (5.7b-3 sorts it instead).
      expect((await rowOf(lesson.id)).teacher_id).toBe(s.teacher.staffId);
      expect(await recordsOf(lesson.id)).toEqual([
        expect.objectContaining({ end_cause: 'dropped' }),
      ]);
      const entry = await t.database.migrator
        .selectFrom('audit_log')
        .select('new_value')
        .where('action', '=', 'timetable_version.publish')
        .where('record_id', '=', fix)
        .executeTakeFirstOrThrow();
      expect(
        (entry.new_value as { datedLessons: { substitutionsDropped: unknown } }).datedLessons
          .substitutionsDropped,
      ).toEqual([{ lessonId: lesson.id, substitutionId: expect.any(String) as unknown }]);
    });

    /** The rows of the records whose substitute is `staffId`, with their lesson ids. */
    const rowsBy = (staffId: string) =>
      t.database.migrator
        .selectFrom('substitution_lessons')
        .innerJoin('substitutions', 'substitutions.id', 'substitution_lessons.substitution_id')
        .select([
          'substitution_lessons.lesson_id',
          'substitution_lessons.end_cause',
          'substitution_lessons.ended_by',
        ])
        .where('substitutions.substitute_id', '=', staffId)
        .execute();

    it('ends the substitution of a lesson a publish removes before the lesson goes (review correction 1)', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, '2026-10-19');
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      changed(await substitute(s.branch, lesson.id, { teacherId: free.staffId }));
      // A fix from Monday 19 October that places the first class's maths on Tuesday.
      const copied = await t.post('/api/timetable/versions', s.branch, {
        academicYearId: s.year,
        startsOn: '2026-10-19',
        copyFrom: s.version,
      });
      expect(copied.status, JSON.stringify(copied.body)).toBe(201);
      const fix = (copied.body as { id: string }).id;
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', fix)
        .execute();
      const fixRows = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select(['id', 'class_id'])
        .where('version_id', '=', fix)
        .execute();
      for (const row of fixRows) {
        await placeAt(s.branch, fix, row.id, row.class_id === s.classId ? 2 : 1);
      }
      const confirmed = await t.post(`/api/timetable/versions/${fix}/templates/confirm`, s.branch);
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      await load.freeEditLock(fix);
      const published = await publish(s.branch, fix, '2026-10-19');
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(
        await t.database.migrator
          .selectFrom('lessons')
          .select('id')
          .where('id', '=', lesson.id)
          .executeTakeFirst(),
      ).toBeUndefined();
      // Ended before the delete set its lesson to null: never a row with no end.
      expect(await rowsBy(free.staffId)).toEqual([
        { lesson_id: null, end_cause: 'dropped', ended_by: expect.any(String) as unknown },
      ]);
      const entry = await t.database.migrator
        .selectFrom('audit_log')
        .select('new_value')
        .where('action', '=', 'timetable_version.publish')
        .where('record_id', '=', fix)
        .executeTakeFirstOrThrow();
      expect(
        (entry.new_value as { datedLessons: { substitutionsDropped: unknown } }).datedLessons
          .substitutionsDropped,
      ).toEqual([{ lessonId: lesson.id, substitutionId: expect.any(String) as unknown }]);
    });

    it('ends the substitution of a lesson a withdraw removes before the lesson goes (review correction 1)', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, MONDAY);
      const free = await person(s.branch, { subjects: [{ subject: s.subject, grades: [7] }] });
      changed(await substitute(s.branch, lesson.id, { teacherId: free.staffId }));
      // The only version, not started yet: its withdraw removes its lessons.
      const withdrawn = await request(t.kit.server)
        .post(`/api/timetable/versions/${s.version}/withdraw`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send();
      expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200);
      expect(await rowsBy(free.staffId)).toEqual([
        { lesson_id: null, end_cause: 'dropped', ended_by: expect.any(String) as unknown },
      ]);
      const entry = await t.database.migrator
        .selectFrom('audit_log')
        .select('new_value')
        .where('action', '=', 'timetable_version.withdraw')
        .where('record_id', '=', s.version)
        .executeTakeFirstOrThrow();
      expect(
        (entry.new_value as { datedLessons: { substitutionsDropped: unknown } }).datedLessons
          .substitutionsDropped,
      ).toEqual([{ lessonId: lesson.id, substitutionId: expect.any(String) as unknown }]);
    });
  });

  describe('permissions and ids', () => {
    let north: Scene;

    beforeAll(async () => {
      north = await scene({ branch: t.north });
    });

    it("answers 404 for another branch's or an unknown lesson and teacher, as the Academic Vice Principal and the Super Admin, and changes nothing", async () => {
      const other = await scene();
      const lesson = await lessonOf(north, '2026-10-19');
      const free = await person(north.branch, {
        subjects: [{ subject: north.subject, grades: [7] }],
      });
      const foreign = await person(other.branch, {
        subjects: [{ subject: other.subject, grades: [7] }],
      });
      const foreignLesson = await lessonOf(other, MONDAY);
      // Permission review, should-fix 2: substitutions in force on both
      // lessons, in both branches, which a withdraw would end.
      const otherFree = await person(other.branch, {
        subjects: [{ subject: other.subject, grades: [7] }],
      });
      changed(await substitute(other.branch, foreignLesson.id, { teacherId: otherFree.staffId }));
      changed(await substitute(t.north, lesson.id, { teacherId: free.staffId }));
      for (const cookie of [t.vicePrincipal, t.admin]) {
        const before = await everything();
        for (const id of [foreignLesson.id, UNKNOWN]) {
          refusedWith(
            await substitute(t.north, id, { teacherId: free.staffId }, cookie),
            404,
            'not_found',
          );
          refusedWith(await withdraw(t.north, id, cookie), 404, 'not_found');
          refusedWith(
            await t.get(`/api/timetable/lessons/${id}/substitutes`, t.north, cookie),
            404,
            'not_found',
          );
        }
        for (const id of [foreign.staffId, UNKNOWN]) {
          refusedWith(
            await substitute(t.north, lesson.id, { teacherId: id }, cookie),
            404,
            'not_found',
          );
        }
        expect(await everything()).toEqual(before);
      }
    });

    it('is refused to the Principal on the three routes, and nothing changes', async () => {
      const lesson = await lessonOf(north, '2026-10-26');
      const free = await person(north.branch, {
        subjects: [{ subject: north.subject, grades: [7] }],
      });
      const before = await everything();
      refusedWith(
        await substitute(t.north, lesson.id, { teacherId: free.staffId }, t.principal),
        403,
        'permission_denied',
      );
      refusedWith(await withdraw(t.north, lesson.id, t.principal), 403, 'permission_denied');
      refusedWith(
        await t.get(`/api/timetable/lessons/${lesson.id}/substitutes`, t.north, t.principal),
        403,
        'permission_denied',
      );
      expect(await everything()).toEqual(before);
    });

    it('keeps a used key to its account, its branch and its role (request keys)', async () => {
      const other = await scene();
      const foreignLesson = await lessonOf(other, MONDAY);
      const foreign = await person(other.branch, {
        subjects: [{ subject: other.subject, grades: [7] }],
      });
      const free = await person(north.branch, {
        subjects: [{ subject: north.subject, grades: [7] }],
      });
      for (const action of ['substitute', 'withdraw'] as const) {
        const lesson = await lessonOf(north, action === 'substitute' ? '2026-11-30' : '2026-12-07');
        if (action === 'withdraw')
          changed(await substitute(t.north, lesson.id, { teacherId: free.staffId }));
        const send = (id: string, cookie: string, key: string) =>
          action === 'substitute'
            ? substitute(t.north, id, { teacherId: free.staffId }, cookie, key)
            : withdraw(t.north, id, cookie, key);
        const key = randomUUID();
        changed(await send(lesson.id, t.vicePrincipal, key));
        // A repeat answers the stored answer and changes nothing more.
        const after = await everything();
        changed(await send(lesson.id, t.vicePrincipal, key));
        expect(await everything()).toEqual(after);
        refusedWith(await send(lesson.id, t.admin, key), 409, 'request_key_reused');
        refusedWith(await send(foreignLesson.id, t.vicePrincipal, key), 404, 'not_found');
        refusedWith(await send(UNKNOWN, t.vicePrincipal, key), 404, 'not_found');
        // Permission review, should-fix 4: the teacher of the body too.
        if (action === 'substitute') {
          for (const teacherId of [foreign.staffId, UNKNOWN]) {
            refusedWith(
              await substitute(t.north, lesson.id, { teacherId }, t.vicePrincipal, key),
              404,
              'not_found',
            );
          }
        }
        refusedWith(await send(lesson.id, t.principal, key), 403, 'permission_denied');
        expect(await everything()).toEqual(after);
      }
    });
  });
});
