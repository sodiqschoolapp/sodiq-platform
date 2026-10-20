import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  calendarPreviewSchema,
  type CalendarPreview,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, MONDAY, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const okay = (response: Response, status = 200) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body as { id: string };
};

/** The quarters of the year 2026-09-01 to 2027-05-31, dated. */
const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

/** A Monday after the version's start. */
const OCT19 = '2026-10-19';
/** Saturday 24 October, worked "by Monday's timetable" in a test. */
const OCT24 = '2026-10-24';

const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:00`);

// All names are invented. Task 5.6b-2c-1: the exams standing on the dates a
// calendar save writes over published dates (edge/timetable, Exams: "a day
// off removes the exam and tells the Academic Vice Principal. ... A special
// template for its date moves the exam with its slots and rechecks it; one
// that drops a slot of the exam is refused and lists the exam ... In an exam
// week with 'no regular lessons' the lessons are already cancelled and stay
// so whatever happens to the exam"; 06, Exam: "cancelling the exam restores
// only the lessons it cancelled"). Exams have no route before 5.6c: the
// tests write them with the migrator, the lessons of their classes in their
// slots cancelled "exam" as their save will. The clock stands at 23:55 on
// Saturday 10 October 2026 in Tashkent.
describe('exams under a calendar change', () => {
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

  const publish = (branch: string, version: string, startsOn: string) =>
    request(t.kit.server)
      .post(`/api/timetable/versions/${version}/publish`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ startsOn });

  type Grades = { gradeFrom: number | null; gradeTo: number | null };
  const ALL: Grades = { gradeFrom: null, gradeTo: null };

  const dayOff = (first: string, grades: Grades = ALL) => ({
    kind: 'day_off',
    name: 'Navruz',
    firstDate: first,
    lastDate: first,
    ...grades,
    dayTemplateId: null,
    followsWeekday: null,
    examWeek: null,
  });

  const specialDay = (
    date: string,
    dayTemplateId: string,
    extra: { followsWeekday?: number | null; examWeek?: string | null; grades?: Grades } = {},
  ) => ({
    kind: 'special_day',
    name: 'Open day',
    firstDate: date,
    lastDate: date,
    ...(extra.grades ?? ALL),
    dayTemplateId,
    followsWeekday: extra.followsWeekday ?? null,
    examWeek: extra.examWeek ?? null,
  });

  const create = (branch: string, record: object) =>
    post('/api/setup/calendar-entries', branch, record);
  const edit = (branch: string, id: string, record: object) =>
    t.patch(`/api/setup/calendar-entries/${id}`, branch, record);

  const preview = async (branch: string, change: object): Promise<CalendarPreview> => {
    const response = await post('/api/setup/calendar-entries/preview', branch, change);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return calendarPreviewSchema.parse(response.body);
  };

  async function hours(branch: string, staffId: string) {
    const entry = await t.database.migrator
      .insertInto('staff_availability')
      .values({ branch_id: branch, staff_id: staffId, valid_from: '2026-09-01' })
      .returning(['id', 'valid_until'])
      .executeTakeFirstOrThrow();
    for (const weekday of [1, 2, 3, 4, 5, 6]) {
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

  const placeAt = async (branch: string, version: string, loadRowId: string, slot: number) => {
    const placed = await post(`/api/timetable/versions/${version}/pattern`, branch, {
      loadRowId,
      weekday: 1,
      slotPosition: slot,
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  };

  /**
   * A branch of its own with a year of four dated quarters, a day of lesson,
   * break, lesson, break, lesson from 08:00 (08:00, 08:55, 09:50), classes of
   * grades 7, 9 and 10, and a version published from Monday 12 October: on
   * Mondays maths of the grade-7 class in slot 1, history of the grade-10
   * class in slot 3, and physical education in slot 5 of a group of the
   * grade-9 and grade-10 classes, or with `twoGroups` two parallel groups of
   * both, each with its own teacher.
   */
  async function scene(input: { twoGroups?: boolean } = {}) {
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
    const slots = [lesson, pause, lesson, pause, lesson];
    const regular = await t.createTemplate(branch, 'Regular', slots);
    // The same slots an hour later: every slot moves.
    const later = await t.createTemplate(branch, 'Later', slots, '09:00');
    // One lesson slot only.
    const short = await t.createTemplate(branch, 'Short', [lesson]);
    await t.assign(branch, regular);
    const maths = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const history = await load.classes.subject({ grades: [10], journalType: 'attendance_only' });
    const sport = await load.classes.subject({ grades: [9, 10], journalType: 'attendance_only' });
    const classId = await load.classes.schoolClass(branch, year, {
      grade: 7,
      room: await load.classes.room(branch),
    });
    const nineId = await load.classes.schoolClass(branch, year, {
      grade: 9,
      room: await load.classes.room(branch),
    });
    const seniorId = await load.classes.schoolClass(branch, year, {
      grade: 10,
      room: await load.classes.room(branch),
    });
    const teacher = async (subject: string, grades: number[]) => {
      const id = (await load.teacher(branch, { subjects: [{ subject, grades }] })).staffId;
      await hours(branch, id);
      return id;
    };
    const teacherId = await teacher(maths, [7]);
    const seniorTeacher = await teacher(history, [10]);
    const created = await post('/api/timetable/versions', branch, {
      academicYearId: year,
      startsOn: MONDAY,
      copyFrom: null,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const version = (created.body as { id: string }).id;
    const row = (values: {
      class_id?: string;
      group_id?: string;
      subject_id: string;
      teacher_id: string;
    }) => load.row({ branch_id: branch, version_id: version, lessons_per_week: 1, ...values });
    await placeAt(
      branch,
      version,
      await row({ class_id: classId, subject_id: maths, teacher_id: teacherId }),
      1,
    );
    await placeAt(
      branch,
      version,
      await row({ class_id: seniorId, subject_id: history, teacher_id: seniorTeacher }),
      3,
    );
    const groups: string[] = [];
    for (let index = 0; index < (input.twoGroups === true ? 2 : 1); index += 1) {
      groups.push(await load.classes.group(branch, year, sport, [nineId, seniorId]));
    }
    const groupRows: string[] = [];
    for (const groupId of groups) {
      groupRows.push(
        await row({
          group_id: groupId,
          subject_id: sport,
          teacher_id: await teacher(sport, [9, 10]),
        }),
      );
    }
    // The parallel groups are one block: placing one places both.
    const [firstGroupRow] = groupRows;
    if (firstGroupRow !== undefined) await placeAt(branch, version, firstGroupRow, 5);
    const confirmed = await post(`/api/timetable/versions/${version}/templates/confirm`, branch);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    await load.freeEditLock(version);
    const published = await publish(branch, version, MONDAY);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    return {
      branch,
      year,
      sport,
      classId,
      nineId,
      seniorId,
      teacherId,
      seniorTeacher,
      groups,
      regular,
      later,
      short,
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /** The dated lessons of a date, by start and id. */
  const lessonsOn = (branch: string, date: string) =>
    t.database.migrator
      .selectFrom('lessons')
      .select(['id', 'block_id', 'class_id', 'group_id', 'cancel_cause', 'starts_at', 'ends_at'])
      .where('branch_id', '=', branch)
      .where('lesson_date', '=', date)
      .orderBy('starts_at')
      .orderBy('id')
      .execute();

  const lessonOf = async (branch: string, date: string, unit: string) => {
    const found = (await lessonsOn(branch, date)).filter(
      (one) => one.class_id === unit || one.group_id === unit,
    );
    if (found.length === 0) throw new Error(`No lesson of ${unit} on ${date}.`);
    return found;
  };

  /**
   * An exam as its save (5.6c) will write it: the lessons of `cancel`
   * cancelled "exam", the exam, one room with the classes or groups that sit
   * and one invigilator, and the classes kept out of shared blocks.
   */
  async function exam(
    s: Scene,
    input: {
      date: string;
      from: string;
      until: string;
      slots: [number, number];
      classIds?: string[];
      groupIds?: string[];
      invigilator: string;
      cancel?: string[];
      outs?: { blockId: string; classId: string }[];
      subjectId?: string;
    },
  ) {
    const room = await load.classes.room(s.branch);
    return t.database.migrator.transaction().execute(async (transaction) => {
      await sql`set constraints all deferred`.execute(transaction);
      if ((input.cancel ?? []).length > 0) {
        await transaction
          .updateTable('lessons')
          .set({ cancel_cause: 'exam' })
          .where('id', 'in', input.cancel ?? [])
          .execute();
      }
      const written = await transaction
        .insertInto('exams')
        .values({
          branch_id: s.branch,
          academic_year_id: s.year,
          exam_date: input.date,
          starts_at: at(input.date, input.from),
          ends_at: at(input.date, input.until),
          first_slot: input.slots[0],
          last_slot: input.slots[1],
          title: 'Quarter exam',
          subject_id: input.subjectId ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const examRoom = await transaction
        .insertInto('exam_rooms')
        .values({ branch_id: s.branch, exam_id: written.id, room_id: room })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const classId of input.classIds ?? []) {
        await transaction
          .insertInto('exam_room_classes')
          .values({
            branch_id: s.branch,
            exam_id: written.id,
            exam_room_id: examRoom.id,
            class_id: classId,
          })
          .execute();
      }
      for (const groupId of input.groupIds ?? []) {
        await transaction
          .insertInto('exam_room_classes')
          .values({
            branch_id: s.branch,
            exam_id: written.id,
            exam_room_id: examRoom.id,
            group_id: groupId,
          })
          .execute();
      }
      await transaction
        .insertInto('exam_invigilators')
        .values({
          branch_id: s.branch,
          exam_id: written.id,
          exam_room_id: examRoom.id,
          staff_id: input.invigilator,
        })
        .execute();
      for (const out of input.outs ?? []) {
        await transaction
          .insertInto('lesson_block_class_outs')
          .values({
            branch_id: s.branch,
            block_id: out.blockId,
            class_id: out.classId,
            exam_id: written.id,
          })
          .execute();
      }
      await sql`set constraints all immediate`.execute(transaction);
      return { id: written.id, room };
    });
  }

  const examRow = (id: string) =>
    t.database.migrator
      .selectFrom('exams')
      .select(['cancel_cause', 'starts_at', 'ends_at'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  const examClaims = (id: string) =>
    t.database.migrator
      .selectFrom('time_claims')
      .select(['kind', sql<string>`lower(during)::text`.as('starts')])
      .where('exam_id', '=', id)
      .orderBy('kind')
      .execute();

  const outsOf = (id: string) =>
    t.database.migrator
      .selectFrom('lesson_block_class_outs')
      .select(['block_id', 'class_id'])
      .where('exam_id', '=', id)
      .execute();

  const examNotices = (branch: string) =>
    t.database.migrator
      .selectFrom('notifications')
      .select(['account_id', 'data'])
      .where('branch_id', '=', branch)
      .where('kind', '=', 'timetable.exam_day_off')
      .orderBy('account_id')
      .execute();

  const detailsOf = (response: Response) =>
    (response.body as { error: { details: { path: string; code: string; day?: string }[] } }).error
      .details;

  /** An Academic Vice Principal of the scene's branch only, with an account of its own. */
  const vice = async (s: Scene) => {
    const account = await load.classes.account();
    await load.classes.role(account, s.branch, 'academic_vice_principal');
    return account;
  };

  describe('a day off', () => {
    it('cancels the exam of its date, removes its lessons, tells the Academic Vice Principals of the branch; the preview shows it and writes nothing', async () => {
      const s = await scene();
      const viceId = await vice(s);
      // An Academic Vice Principal of another branch only.
      const elsewhere = await load.classes.account();
      await load.classes.role(elsewhere, t.north, 'academic_vice_principal');
      const [maths] = await lessonOf(s.branch, OCT19, s.classId);
      const sat = await exam(s, {
        date: OCT19,
        from: '08:00',
        until: '08:45',
        slots: [1, 1],
        classIds: [s.classId],
        invigilator: s.seniorTeacher,
        cancel: [maths?.id ?? ''],
      });
      const claims = await examClaims(sat.id);
      expect(claims.length).toBeGreaterThan(0);

      const shown = await preview(s.branch, { action: 'create', record: dayOff(OCT19) });
      expect(shown.lessons.exams).toEqual([
        {
          id: sat.id,
          title: 'Quarter exam',
          date: OCT19,
          outcome: 'cancelled_day_off',
          before: { start: 480, end: 525 },
          after: null,
          code: null,
          blockedRules: [],
          blocks: [],
        },
      ]);
      expect((await examRow(sat.id)).cancel_cause).toBeNull();
      expect(await examClaims(sat.id)).toEqual(claims);
      expect(await examNotices(s.branch)).toEqual([]);

      const saved = okay(await create(s.branch, dayOff(OCT19)), 201);

      expect((await examRow(sat.id)).cancel_cause).toBe('day_off');
      expect(await examClaims(sat.id)).toEqual([]);
      expect(await lessonsOn(s.branch, OCT19)).toEqual([]);
      const notices = await examNotices(s.branch);
      expect(notices.map((one) => one.account_id)).toEqual([viceId]);
      expect(notices[0]?.data).toEqual({ name: 'Navruz', title: 'Quarter exam', date: OCT19 });
      const [entry] = await t.entries('calendar_entry.create', saved.id);
      const newValue = entry?.new_value as { exams: { id: string; outcome: string }[] };
      expect(newValue.exams.map((one) => [one.id, one.outcome])).toEqual([
        [sat.id, 'cancelled_day_off'],
      ]);
    });

    it('for grade 9 only cancels a whole exam of a grade-9 and a grade-10 class, and holds again the grade-10 lesson it had cancelled', async () => {
      const s = await scene();
      const [history] = await lessonOf(s.branch, OCT19, s.seniorId);
      const sat = await exam(s, {
        date: OCT19,
        from: '08:55',
        until: '09:40',
        slots: [3, 3],
        classIds: [s.nineId, s.seniorId],
        invigilator: s.teacherId,
        cancel: [history?.id ?? ''],
      });

      okay(await create(s.branch, dayOff(OCT19, { gradeFrom: 9, gradeTo: 9 })), 201);

      expect((await examRow(sat.id)).cancel_cause).toBe('day_off');
      const [after] = await lessonOf(s.branch, OCT19, s.seniorId);
      expect(after?.id).toBe(history?.id);
      expect(after?.cancel_cause).toBeNull();
    });

    it('a working Saturday taken back cancels the exam on it', async () => {
      const s = await scene();
      const saturday = okay(
        await create(s.branch, specialDay(OCT24, s.regular, { followsWeekday: 1 })),
        201,
      );
      const [maths] = await lessonOf(s.branch, OCT24, s.classId);
      const sat = await exam(s, {
        date: OCT24,
        from: '08:00',
        until: '08:45',
        slots: [1, 1],
        classIds: [s.classId],
        invigilator: s.seniorTeacher,
        cancel: [maths?.id ?? ''],
      });

      okay(await post(`/api/setup/calendar-entries/${saturday.id}/archive`, s.branch));

      expect((await examRow(sat.id)).cancel_cause).toBe('day_off');
      expect(await lessonsOn(s.branch, OCT24)).toEqual([]);
    });
  });

  describe('a special template', () => {
    it('that moves the slots moves the exam with them; its claims follow and the lesson at the new time is cancelled "exam"', async () => {
      const s = await scene();
      const [maths] = await lessonOf(s.branch, OCT19, s.classId);
      const sat = await exam(s, {
        date: OCT19,
        from: '08:00',
        until: '08:45',
        slots: [1, 1],
        classIds: [s.classId],
        invigilator: s.seniorTeacher,
        cancel: [maths?.id ?? ''],
      });
      const record = specialDay(OCT19, s.later);

      const shown = await preview(s.branch, { action: 'create', record });
      expect(shown.lessons.exams.map((one) => [one.outcome, one.after])).toEqual([
        ['moved', { start: 540, end: 585 }],
      ]);

      const saved = okay(await create(s.branch, record), 201);

      const row = await examRow(sat.id);
      expect(row.cancel_cause).toBeNull();
      expect(row.starts_at).toEqual(at(OCT19, '09:00'));
      expect(row.ends_at).toEqual(at(OCT19, '09:45'));
      const claims = await examClaims(sat.id);
      expect(claims.length).toBeGreaterThan(0);
      expect(new Set(claims.map((one) => new Date(one.starts).getTime()))).toEqual(
        new Set([at(OCT19, '09:00').getTime()]),
      );
      const [moved] = await lessonOf(s.branch, OCT19, s.classId);
      expect(moved?.starts_at).toEqual(at(OCT19, '09:00'));
      expect(moved?.cancel_cause).toBe('exam');
      const [entry] = await t.entries('calendar_entry.create', saved.id);
      expect((entry?.new_value as { exams: { outcome: string }[] }).exams[0]?.outcome).toBe(
        'moved',
      );
    });

    it("that moves an exam onto its invigilator's lesson refuses the save by date, with nothing written; the preview lists the rule", async () => {
      const s = await scene();
      const [maths] = await lessonOf(s.branch, OCT19, s.classId);
      // The history teacher invigilates the grade-7 exam; the special day
      // moves grade 7 to 09:00, onto history at 08:55 to 09:40.
      const sat = await exam(s, {
        date: OCT19,
        from: '08:00',
        until: '08:45',
        slots: [1, 1],
        classIds: [s.classId],
        invigilator: s.seniorTeacher,
        cancel: [maths?.id ?? ''],
      });
      const record = specialDay(OCT19, s.later, { grades: { gradeFrom: 7, gradeTo: 7 } });
      const lessons = await lessonsOn(s.branch, OCT19);

      const shown = await preview(s.branch, { action: 'create', record });
      expect(shown.lessons.exams[0]?.outcome).toBe('moved');
      expect(shown.lessons.exams[0]?.blockedRules).toContain('teacher_double');
      const before = await t.auditCount();

      const refused = await create(s.branch, record);

      refusedWith(refused, 409, 'calendar_blocked');
      expect(detailsOf(refused).some((one) => one.day === OCT19)).toBe(true);
      expect(await lessonsOn(s.branch, OCT19)).toEqual(lessons);
      expect((await examRow(sat.id)).starts_at).toEqual(at(OCT19, '08:00'));
      expect(await t.auditCount()).toBe(before);
    });

    it('that drops a slot of the exam refuses the save and lists the exam; the preview lists it and writes nothing', async () => {
      const s = await scene();
      const [history] = await lessonOf(s.branch, OCT19, s.seniorId);
      const sat = await exam(s, {
        date: OCT19,
        from: '08:55',
        until: '09:40',
        slots: [3, 3],
        classIds: [s.seniorId],
        invigilator: s.teacherId,
        cancel: [history?.id ?? ''],
      });
      const record = specialDay(OCT19, s.short);
      const lessons = await lessonsOn(s.branch, OCT19);

      const shown = await preview(s.branch, { action: 'create', record });
      expect(shown.lessons.exams.map((one) => [one.outcome, one.code])).toEqual([
        ['refused', 'calendar_exam_slots'],
      ]);
      expect(shown.lessons.created).toEqual([]);
      expect(await lessonsOn(s.branch, OCT19)).toEqual(lessons);

      const refused = await create(s.branch, record);

      refusedWith(refused, 409, 'calendar_blocked');
      expect(
        detailsOf(refused)
          .filter((one) => one.code === 'calendar_exam_slots')
          .map((one) => [one.path, one.day]),
      ).toEqual([[`exams.${sat.id}`, OCT19]]);
      expect(await lessonsOn(s.branch, OCT19)).toEqual(lessons);
      expect((await examRow(sat.id)).starts_at).toEqual(at(OCT19, '08:55'));
    });

    it('for one grade of an exam of two grades refuses the save: two templates', async () => {
      const s = await scene();
      const [history] = await lessonOf(s.branch, OCT19, s.seniorId);
      const sat = await exam(s, {
        date: OCT19,
        from: '08:55',
        until: '09:40',
        slots: [3, 3],
        classIds: [s.nineId, s.seniorId],
        invigilator: s.teacherId,
        cancel: [history?.id ?? ''],
      });

      const refused = await create(
        s.branch,
        specialDay(OCT19, s.later, { grades: { gradeFrom: 10, gradeTo: 10 } }),
      );

      refusedWith(refused, 409, 'calendar_blocked');
      expect(
        detailsOf(refused)
          .filter((one) => one.code === 'calendar_exam_templates')
          .map((one) => one.path),
      ).toEqual([`exams.${sat.id}`]);
    });

    it('for another grade keeps the exam and its cancelled lesson as they are', async () => {
      const s = await scene();
      const [maths] = await lessonOf(s.branch, OCT19, s.classId);
      const sat = await exam(s, {
        date: OCT19,
        from: '08:00',
        until: '08:45',
        slots: [1, 1],
        classIds: [s.classId],
        invigilator: s.seniorTeacher,
        cancel: [maths?.id ?? ''],
      });

      okay(
        await create(
          s.branch,
          specialDay(OCT19, s.short, { grades: { gradeFrom: 10, gradeTo: 10 } }),
        ),
        201,
      );

      expect((await examRow(sat.id)).starts_at).toEqual(at(OCT19, '08:00'));
      const [kept] = await lessonOf(s.branch, OCT19, s.classId);
      expect(kept?.id).toBe(maths?.id);
      expect(kept?.cancel_cause).toBe('exam');
    });
  });

  describe('an exam week', () => {
    it('with "no regular lessons" leaves the exam at its time with the lessons cancelled "exam week"; with "regular lessons" the lesson under the exam comes back cancelled "exam"', async () => {
      const s = await scene();
      const record = specialDay(OCT19, s.regular, { examWeek: 'no_regular_lessons' });
      const saved = okay(await create(s.branch, record), 201);
      const sat = await exam(s, {
        date: OCT19,
        from: '08:00',
        until: '08:45',
        slots: [1, 1],
        classIds: [s.classId],
        invigilator: s.seniorTeacher,
      });
      // The exam week set again over the standing exam: it stays.
      okay(await edit(s.branch, saved.id, { ...record, name: 'Exams' }));
      expect((await examRow(sat.id)).starts_at).toEqual(at(OCT19, '08:00'));
      expect((await lessonOf(s.branch, OCT19, s.classId)).map((one) => one.cancel_cause)).toEqual([
        'exam_week',
      ]);

      okay(await edit(s.branch, saved.id, { ...record, examWeek: 'regular_lessons' }));

      expect((await examRow(sat.id)).cancel_cause).toBeNull();
      expect((await lessonOf(s.branch, OCT19, s.classId)).map((one) => one.cancel_cause)).toEqual([
        'exam',
      ]);
      expect((await lessonOf(s.branch, OCT19, s.seniorId)).map((one) => one.cancel_cause)).toEqual([
        null,
      ]);
    });
  });

  // A grade-10 class sitting whole while the physical education block of
  // grades 9 and 10 runs in its slot (edge/timetable, Exams: "10 Brown sits
  // the exam, but its lesson in slot 3 is a block shared with classes that do
  // not sit ... For each, the Academic Vice Principal chooses in the same
  // save: cancel the whole block with the reason 'exam', or keep it for the
  // other classes").
  describe('a shared block under an exam', () => {
    const senior = (
      s: Scene,
      extra: { cancel?: string[]; outs?: { blockId: string; classId: string }[] },
      date = OCT19,
    ) =>
      exam(s, {
        date,
        from: '09:50',
        until: '10:35',
        slots: [5, 5],
        classIds: [s.seniorId],
        invigilator: s.teacherId,
        ...extra,
      });

    it('kept for the other classes: the class stays out of the block the special day writes again; on a date written for another grade the block and its out row stay', async () => {
      const s = await scene();
      const [sport] = await lessonOf(s.branch, OCT19, s.groups[0] ?? '');
      const sat = await senior(s, {
        outs: [{ blockId: sport?.block_id ?? '', classId: s.seniorId }],
      });

      // Another grade: nothing of the exam's day changes.
      const other = okay(
        await create(
          s.branch,
          specialDay(OCT19, s.short, { grades: { gradeFrom: 7, gradeTo: 7 } }),
        ),
        201,
      );
      expect(await outsOf(sat.id)).toEqual([{ block_id: sport?.block_id, class_id: s.seniorId }]);
      okay(await post(`/api/setup/calendar-entries/${other.id}/archive`, s.branch));

      okay(
        await create(
          s.branch,
          specialDay(OCT19, s.later, { grades: { gradeFrom: 9, gradeTo: 10 } }),
        ),
        201,
      );

      expect((await examRow(sat.id)).starts_at).toEqual(at(OCT19, '10:50'));
      const [moved] = await lessonOf(s.branch, OCT19, s.groups[0] ?? '');
      expect(moved?.block_id).not.toBe(sport?.block_id);
      expect(moved?.cancel_cause).toBeNull();
      expect(await outsOf(sat.id)).toEqual([{ block_id: moved?.block_id, class_id: s.seniorId }]);
    });

    it('cancelled whole: the block the special day writes again is cancelled "exam"', async () => {
      const s = await scene();
      const [sport] = await lessonOf(s.branch, OCT19, s.groups[0] ?? '');
      const sat = await senior(s, { cancel: [sport?.id ?? ''] });

      okay(
        await create(
          s.branch,
          specialDay(OCT19, s.later, { grades: { gradeFrom: 9, gradeTo: 10 } }),
        ),
        201,
      );

      const [moved] = await lessonOf(s.branch, OCT19, s.groups[0] ?? '');
      expect(moved?.starts_at).toEqual(at(OCT19, '10:50'));
      expect(moved?.cancel_cause).toBe('exam');
      expect(await outsOf(sat.id)).toEqual([]);
    });

    it('newly under the exam: listed with its two choices; the save without one is refused; each choice is written', async () => {
      for (const choice of ['keep', 'cancel'] as const) {
        const s = await scene();
        // A working Saturday by Tuesday's timetable, which has no lessons,
        // and an exam on it; then the Saturday follows Monday.
        const record = specialDay(OCT24, s.regular, { followsWeekday: 2 });
        const saved = okay(await create(s.branch, record), 201);
        const sat = await senior(s, {}, OCT24);
        const byMonday = { ...record, followsWeekday: 1 };

        const shown = await preview(s.branch, { action: 'edit', id: saved.id, record: byMonday });
        expect(shown.lessons.exams[0]?.blocks.map((one) => [one.classId, one.choice])).toEqual([
          [s.seniorId, null],
        ]);
        expect(shown.lessons.exams[0]?.blocks[0]?.lessons.map((one) => one.unitId)).toContain(
          s.groups[0],
        );
        const refused = await edit(s.branch, saved.id, byMonday);
        refusedWith(refused, 409, 'calendar_blocked');
        expect(
          detailsOf(refused)
            .filter((one) => one.code === 'calendar_exam_block_choice')
            .map((one) => one.path),
        ).toEqual([`exams.${sat.id}.${s.seniorId}`]);

        okay(
          await edit(s.branch, saved.id, {
            ...byMonday,
            examBlocks: [{ examId: sat.id, classId: s.seniorId, choice }],
          }),
        );

        const [sport] = await lessonOf(s.branch, OCT24, s.groups[0] ?? '');
        if (choice === 'keep') {
          expect(sport?.cancel_cause).toBeNull();
          expect(await outsOf(sat.id)).toEqual([
            { block_id: sport?.block_id, class_id: s.seniorId },
          ]);
        } else {
          expect(sport?.cancel_cause).toBe('exam');
          expect(await outsOf(sat.id)).toEqual([]);
        }
      }
    });
  });

  // edge/timetable, Exams: "A group sits an exam only in the slots of its own
  // lesson, which the exam replaces; the other groups of the block keep their
  // lessons" (review corrections 1 and 2).
  describe('a group that sits', () => {
    it('moves with its lesson, the other group of the block held; refused when the day leaves the group no lesson at the exam', async () => {
      const s = await scene({ twoGroups: true });
      const [first, second] = s.groups;
      const record = specialDay(OCT24, s.regular, { followsWeekday: 1 });
      const saved = okay(await create(s.branch, record), 201);
      const [own] = await lessonOf(s.branch, OCT24, first ?? '');
      const sat = await exam(s, {
        date: OCT24,
        from: '09:50',
        until: '10:35',
        slots: [5, 5],
        groupIds: [first ?? ''],
        invigilator: s.teacherId,
        cancel: [own?.id ?? ''],
        subjectId: s.sport,
      });

      okay(await edit(s.branch, saved.id, { ...record, dayTemplateId: s.later }));

      expect((await examRow(sat.id)).starts_at).toEqual(at(OCT24, '10:50'));
      expect((await lessonOf(s.branch, OCT24, first ?? '')).map((one) => one.cancel_cause)).toEqual(
        ['exam'],
      );
      expect(
        (await lessonOf(s.branch, OCT24, second ?? '')).map((one) => one.cancel_cause),
      ).toEqual([null]);

      const byTuesday = { ...record, dayTemplateId: s.later, followsWeekday: 2 };
      const shown = await preview(s.branch, { action: 'edit', id: saved.id, record: byTuesday });
      expect(shown.lessons.exams.map((one) => [one.outcome, one.code])).toEqual([
        ['refused', 'calendar_exam_slots'],
      ]);
      const refused = await edit(s.branch, saved.id, byTuesday);
      refusedWith(refused, 409, 'calendar_blocked');
      expect(
        detailsOf(refused)
          .filter((one) => one.code === 'calendar_exam_slots')
          .map((one) => one.path),
      ).toEqual([`exams.${sat.id}`]);
    });
  });
});
