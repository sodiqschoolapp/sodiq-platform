import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  templatePreviewSchema,
  timetableVersionSchema,
  type TemplatePreview,
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

/** Mondays after the version's start (12 October). */
const OCT19 = '2026-10-19';
const OCT26 = '2026-10-26';
const NOV02 = '2026-11-02';
const NOV09 = '2026-11-09';
const NOV16 = '2026-11-16';
const NOV23 = '2026-11-23';
const DEC07 = '2026-12-07';
const DEC14 = '2026-12-14';

/** A moment of a school date at a clock time in Tashkent (UTC+5, the kit's branches). */
const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:00`);

/** The clock time of a moment in Tashkent. */
const clock = (moment: Date) =>
  new Date(moment.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(11, 16);

// All names are invented. Task 5.6b-4a: a change of the day templates from a
// date writes the published timetable's lessons of the dates whose times it
// changes again (edge/time-dates-calendar, "A slot type's length or a day
// template is changed mid-year": "The change takes effect from a chosen
// date, tomorrow at the earliest. Held lessons keep their times. Every future
// date is rechecked with the new times, and the change is refused if any
// teacher, room or student would overlap. A lesson slot used by the published
// timetable cannot be removed or reordered without a new version"; 06, What a
// change does to existing data, "Day template changed (lengths, breaks,
// order)"). The clock stands at 23:55 on Saturday 10 October 2026 in Tashkent.
describe('template changes after publishing', () => {
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

  const keyed = (path: string, branch: string, body: object, cookie = t.admin) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send(body);

  const publish = (branch: string, version: string, startsOn: string) =>
    keyed(`/api/timetable/versions/${version}/publish`, branch, { startsOn });

  /** Hours of a person in the branch, all day on weekdays. */
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

  const placeAt = async (
    branch: string,
    version: string,
    loadRowId: string,
    weekday: number,
    slotPosition: number,
  ) => {
    const placed = await post(`/api/timetable/versions/${version}/pattern`, branch, {
      loadRowId,
      weekday,
      slotPosition,
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  };

  const confirmTemplates = async (branch: string, version: string) => {
    const confirmed = await post(`/api/timetable/versions/${version}/templates/confirm`, branch);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  };

  /**
   * A branch of its own with a year of four dated quarters, a day of lesson,
   * break, lesson, break, lesson (45 and 10 minutes) from 08:00 on every
   * weekday, two classes of grades 7 and 10, and a version published from
   * Monday 12 October: maths of the grade-7 class in lesson 1 (08:00) and
   * history of the grade-10 class in lesson 2 (08:55), both on Mondays.
   * `shared`: history is taught by the maths teacher, or the two classes
   * share a room. `group`: physical education of a group of a grade-9 class
   * and the grade-10 class in lesson 3 (09:50). `three`: art and music of the
   * grade-7 class in lessons 2 and 3.
   */
  async function scene(
    input: { shared?: 'teacher' | 'room'; group?: boolean; three?: boolean } = {},
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
    const maths = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const history = await load.classes.subject({ grades: [7, 10], journalType: 'attendance_only' });
    const room = await load.classes.room(branch);
    const seniorRoom = input.shared === 'room' ? room : await load.classes.room(branch);
    const classId = await load.classes.schoolClass(branch, year, { grade: 7, room });
    const seniorId = await load.classes.schoolClass(branch, year, {
      grade: 10,
      room: seniorRoom,
    });
    const teacherId = (
      await load.teacher(branch, {
        subjects: [
          { subject: maths, grades: [7] },
          { subject: history, grades: [10] },
        ],
      })
    ).staffId;
    await hours(branch, teacherId);
    const seniorTeacher =
      input.shared === 'teacher'
        ? teacherId
        : (await load.teacher(branch, { subjects: [{ subject: history, grades: [10] }] })).staffId;
    if (seniorTeacher !== teacherId) await hours(branch, seniorTeacher);
    const version = await draft(branch, year);
    const rowId = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: classId,
      subject_id: maths,
      teacher_id: teacherId,
      lessons_per_week: 1,
    });
    const seniorRow = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: seniorId,
      subject_id: history,
      teacher_id: seniorTeacher,
      lessons_per_week: 1,
    });
    await placeAt(branch, version, rowId, 1, 1);
    await placeAt(branch, version, seniorRow, 1, 3);
    let groupId: string | null = null;
    if (input.group === true) {
      const nineId = await load.classes.schoolClass(branch, year, {
        grade: 9,
        room: await load.classes.room(branch),
      });
      const sport = await load.classes.subject({ grades: [9, 10], journalType: 'attendance_only' });
      const coach = (
        await load.teacher(branch, { subjects: [{ subject: sport, grades: [9, 10] }] })
      ).staffId;
      await hours(branch, coach);
      groupId = await load.classes.group(branch, year, sport, [nineId, seniorId]);
      const groupRow = await load.row({
        branch_id: branch,
        version_id: version,
        group_id: groupId,
        subject_id: sport,
        teacher_id: coach,
        lessons_per_week: 1,
      });
      await placeAt(branch, version, groupRow, 1, 5);
    }
    const extra: string[] = [];
    if (input.three === true) {
      for (const slotPosition of [3, 5]) {
        const subject = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
        const teacher = (await load.teacher(branch, { subjects: [{ subject, grades: [7] }] }))
          .staffId;
        await hours(branch, teacher);
        const row = await load.row({
          branch_id: branch,
          version_id: version,
          class_id: classId,
          subject_id: subject,
          teacher_id: teacher,
          lessons_per_week: 1,
        });
        await placeAt(branch, version, row, 1, slotPosition);
        extra.push(subject);
      }
    }
    await confirmTemplates(branch, version);
    await load.freeEditLock(version);
    const published = await publish(branch, version, MONDAY);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    timetableVersionSchema.parse(published.body);
    return {
      branch,
      year,
      maths,
      history,
      classId,
      seniorId,
      teacherId,
      seniorTeacher,
      version,
      regular,
      lessonType: lesson,
      pause,
      groupId,
      music: extra[1] ?? null,
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  /** The dated lessons of a branch, by date, start and id. */
  const lessonsOf = (branch: string) =>
    t.database.migrator
      .selectFrom('lessons')
      .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
      .select([
        'lessons.id',
        'lessons.block_id',
        sql<string>`lessons.lesson_date::text`.as('date'),
        'lessons.class_id',
        'lessons.group_id',
        'lessons.subject_id',
        'lessons.teacher_id',
        'lessons.cancel_cause',
        'lessons.starts_at',
        'lessons.ends_at',
        'lesson_blocks.version_id',
      ])
      .where('lessons.branch_id', '=', branch)
      .orderBy('lessons.lesson_date')
      .orderBy('lessons.starts_at')
      .orderBy('lessons.id')
      .execute();

  const lessonsOn = async (branch: string, date: string) =>
    (await lessonsOf(branch)).filter((one) => one.date === date);

  /** The class's or group's lesson of a date: its clock times and its cancel. */
  const timesOf = async (s: Scene, date: string, unitId: string | null) => {
    const found = (await lessonsOn(s.branch, date)).filter(
      (one) => one.class_id === unitId || one.group_id === unitId,
    );
    return found.map((one) => [clock(one.starts_at), clock(one.ends_at), one.cancel_cause]);
  };

  const lessonOf = async (s: Scene, date: string, classId: string) => {
    const found = (await lessonsOn(s.branch, date)).find((one) => one.class_id === classId);
    if (found === undefined) throw new Error(`No lesson of ${classId} on ${date}.`);
    return found;
  };

  const detailsOf = (response: Response) =>
    (response.body as { error: { details: { path: string; code: string; day?: string }[] } }).error
      .details;

  const accountOf = async (staffId: string) =>
    (
      await t.database.migrator
        .selectFrom('staff')
        .select('account_id')
        .where('id', '=', staffId)
        .executeTakeFirstOrThrow()
    ).account_id;

  const noticesOf = (branch: string) =>
    t.database.migrator
      .selectFrom('notifications')
      .select(['kind', 'account_id', 'data'])
      .where('branch_id', '=', branch)
      .where('kind', '=', 'timetable.template_changed')
      .orderBy('id')
      .execute();

  // The four changes and the preview.
  const changeLength = (s: Scene, lengthMinutes: number, from: string, days?: object) =>
    post(`/api/setup/slot-types/${s.lessonType}/lengths`, s.branch, {
      lengthMinutes,
      from,
      ...(days === undefined ? {} : { days }),
    });

  const addVersion = (
    s: Scene,
    template: string,
    slotTypeIds: string[],
    from: string,
    days?: object,
    startTime = '08:00',
  ) =>
    post(`/api/setup/day-templates/${template}/versions`, s.branch, {
      from,
      startTime,
      slotTypeIds,
      ...(days === undefined ? {} : { days }),
    });

  const setting = (
    template: string,
    from: string,
    key: {
      level: string;
      weekday?: number | null;
      gradeFrom?: number | null;
      gradeTo?: number | null;
    },
  ) => ({
    level: key.level,
    weekday: key.weekday ?? null,
    gradeFrom: key.gradeFrom ?? null,
    gradeTo: key.gradeTo ?? null,
    dayTemplateId: template,
    from,
  });

  const assign = (s: Scene, record: object, days?: object) =>
    post('/api/setup/day-template-assignments', s.branch, {
      ...record,
      ...(days === undefined ? {} : { days }),
    });

  const preview = async (branch: string, change: object): Promise<TemplatePreview> => {
    const response = await post('/api/setup/day-template-table/preview', branch, change);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return templatePreviewSchema.parse(response.body);
  };

  /** A template of the scene's branch: lesson, break, lesson, break, lesson from `startTime`. */
  const templateAt = (s: Scene, name: string, startTime: string) =>
    t.createTemplate(
      s.branch,
      name,
      [s.lessonType, s.pause, s.lessonType, s.pause, s.lessonType],
      startTime,
    );

  /** The bulk cancel's check, then its save with what it listed and `choice` for every shared block. */
  const bulkCancel = async (
    s: Scene,
    body: { date: string; classIds: string[]; lessonNumbers: number[] },
    choice: 'keep' | 'cancel',
  ) => {
    const checked = await post('/api/timetable/bulk-cancels/check', s.branch, body);
    expect(checked.status, JSON.stringify(checked.body)).toBe(200);
    const answer = checked.body as {
      cancel: { lesson: { id: string } }[];
      shared: { blockId: string; lessons: { id: string }[]; chosenOnly: string[] }[];
    };
    return okay(
      await keyed('/api/timetable/bulk-cancels', s.branch, {
        ...body,
        reason: 'Excursion to the museum',
        blocks: answer.shared.map((one) => ({ blockId: one.blockId, choice })),
        lessonIds: [
          ...answer.cancel.map((one) => one.lesson.id),
          ...answer.shared.flatMap((one) =>
            choice === 'cancel' ? one.lessons.map((lesson) => lesson.id) : one.chosenOnly,
          ),
        ],
      }),
    );
  };

  /** Every row a change now writes in a branch: what a refused one leaves as it was. */
  async function storedRowsOf(branch: string) {
    const rows: Record<string, unknown[]> = await t.rowsOf(branch);
    for (const table of [
      'lessons',
      'lesson_blocks',
      'time_claims',
      'lesson_day_changes',
      'notifications',
      'timetable_versions',
      'timetable_version_out_of_date_causes',
      'timetable_day_keeps',
      'exams',
      'bulk_cancels',
    ] as const) {
      rows[table] = await t.database.migrator
        .selectFrom(table)
        .selectAll()
        .where('branch_id', '=', branch)
        .orderBy('id')
        .execute();
    }
    rows.lesson_day_change_ends = await t.database.migrator
      .selectFrom('lesson_day_change_ends')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('change_id')
      .execute();
    rows.lesson_block_class_outs = await t.database.migrator
      .selectFrom('lesson_block_class_outs')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('block_id')
      .orderBy('class_id')
      .execute();
    rows.bulk_cancel_spans = await t.database.migrator
      .selectFrom('bulk_cancel_spans')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('bulk_cancel_id')
      .orderBy('class_id')
      .orderBy('lesson_number')
      .execute();
    rows.bulk_cancel_blocks = await t.database.migrator
      .selectFrom('bulk_cancel_blocks')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('bulk_cancel_id')
      .orderBy('lesson_date')
      .orderBy('starts_at')
      .execute();
    rows.lesson_changes = await t.database.migrator
      .selectFrom('lesson_changes')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('lesson_id')
      .execute();
    rows.timetable_version_days = await t.database.migrator
      .selectFrom('timetable_version_days')
      .selectAll()
      .where('branch_id', '=', branch)
      .orderBy('version_id')
      .orderBy('grade')
      .orderBy('weekday')
      .orderBy('position')
      .execute();
    rows.jobs = (
      await sql<{ id: string }>`
        select id::text from pgboss.job
        where data->'branchIds' ? ${branch}
        order by id
      `.execute(t.database.migrator)
    ).rows;
    return rows;
  }

  /** An exam of the grade-10 class in `slots` of `date`, its lesson in lesson 2 then cancelled "exam". */
  async function insertExam(
    s: Scene,
    date: string,
    slots: [number, number],
    from: string,
    until: string,
    invigilator: string,
    outs: { blockId: string; classId: string }[] = [],
  ) {
    const history = await lessonOf(s, date, s.seniorId);
    return t.database.migrator.transaction().execute(async (transaction) => {
      await sql`set constraints all deferred`.execute(transaction);
      if (slots[0] === 3) {
        await transaction
          .updateTable('lessons')
          .set({ cancel_cause: 'exam' })
          .where('id', '=', history.id)
          .execute();
      }
      const written = await transaction
        .insertInto('exams')
        .values({
          branch_id: s.branch,
          academic_year_id: s.year,
          exam_date: date,
          starts_at: at(date, from),
          ends_at: at(date, until),
          first_slot: slots[0],
          last_slot: slots[1],
          title: 'Quarter exam',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const room = await transaction
        .insertInto('exam_rooms')
        .values({
          branch_id: s.branch,
          exam_id: written.id,
          room_id: await load.classes.room(s.branch),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('exam_room_classes')
        .values({
          branch_id: s.branch,
          exam_id: written.id,
          exam_room_id: room.id,
          class_id: s.seniorId,
        })
        .execute();
      await transaction
        .insertInto('exam_invigilators')
        .values({
          branch_id: s.branch,
          exam_id: written.id,
          exam_room_id: room.id,
          staff_id: invigilator,
        })
        .execute();
      for (const out of outs) {
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
      return written.id;
    });
  }

  describe('a slot length change', () => {
    it('gives the lessons from its date the new times; the lessons before it keep theirs; the teachers are told', async () => {
      const s = await scene();
      expect(await timesOf(s, OCT19, s.seniorId)).toEqual([['08:55', '09:40', null]]);
      const marksBefore = await t.database.migrator
        .selectFrom('lesson_changes')
        .select('lesson_id')
        .where('branch_id', '=', s.branch)
        .execute();
      expect(marksBefore).toEqual([]);

      okay(await changeLength(s, 40, OCT19));

      // Held and earlier lessons keep their times; from 19 October the new ones.
      expect(await timesOf(s, MONDAY, s.classId)).toEqual([['08:00', '08:45', null]]);
      expect(await timesOf(s, MONDAY, s.seniorId)).toEqual([['08:55', '09:40', null]]);
      expect(await timesOf(s, OCT19, s.classId)).toEqual([['08:00', '08:40', null]]);
      expect(await timesOf(s, OCT19, s.seniorId)).toEqual([['08:50', '09:30', null]]);
      expect(await timesOf(s, NOV16, s.seniorId)).toEqual([['08:50', '09:30', null]]);

      // One audit entry, written with the change, holds the lesson dates.
      const [entry] = await t.entries('slot_type.length_change', s.lessonType);
      const value = entry?.new_value as { lessonDates: string[]; lengthMinutes: number };
      expect(value.lengthMinutes).toBe(40);
      expect(value.lessonDates[0]).toBe(OCT19);
      expect(value.lessonDates).not.toContain(MONDAY);
      expect(value.lessonDates).toContain(NOV16);

      // Each teacher is told once, with the change's date (decision 6).
      const notices = await noticesOf(s.branch);
      expect(notices.map((one) => one.account_id).sort()).toEqual(
        [await accountOf(s.teacherId), await accountOf(s.seniorTeacher)].sort(),
      );
      expect(notices.every((one) => (one.data as { from: string }).from === OCT19)).toBe(true);
      // The changed lessons carry the "changed" mark.
      const marks = await t.database.migrator
        .selectFrom('lesson_changes')
        .select('lesson_id')
        .where('branch_id', '=', s.branch)
        .execute();
      expect(marks.map((one) => one.lesson_id)).toContain(
        (await lessonOf(s, OCT19, s.seniorId)).id,
      );
      expect(marks.map((one) => one.lesson_id)).not.toContain(
        (await lessonOf(s, MONDAY, s.seniorId)).id,
      );
    });
  });

  describe('a template change from a date', () => {
    it('a new version that moves a break moves the lessons after it; the ones before it stay', async () => {
      const s = await scene();
      okay(
        await addVersion(
          s,
          s.regular,
          [s.lessonType, s.lessonType, s.pause, s.lessonType, s.pause],
          OCT19,
        ),
      );
      expect(await timesOf(s, OCT19, s.classId)).toEqual([['08:00', '08:45', null]]);
      expect(await timesOf(s, OCT19, s.seniorId)).toEqual([['08:45', '09:30', null]]);
      expect(await timesOf(s, MONDAY, s.seniorId)).toEqual([['08:55', '09:40', null]]);
      const [entry] = await t.entries('day_template.version_create', s.regular);
      expect((entry?.new_value as { lessonDates: string[] }).lessonDates[0]).toBe(OCT19);
    });

    it('a template set for Mondays and grades 9 to 11 gives only those grades its times; ended, the default comes back', async () => {
      const s = await scene();
      const late = await templateAt(s, 'Late', '09:00');
      const set = okay(
        await assign(
          s,
          setting(late, OCT19, { level: 'weekday_grades', weekday: 1, gradeFrom: 9, gradeTo: 11 }),
        ),
        201,
      );
      expect(await timesOf(s, OCT19, s.seniorId)).toEqual([['09:55', '10:40', null]]);
      expect(await timesOf(s, OCT19, s.classId)).toEqual([['08:00', '08:45', null]]);
      expect(await timesOf(s, OCT26, s.seniorId)).toEqual([['09:55', '10:40', null]]);

      okay(
        await post(`/api/setup/day-template-assignments/${set.id}/end`, s.branch, { from: OCT26 }),
      );

      expect(await timesOf(s, OCT19, s.seniorId)).toEqual([['09:55', '10:40', null]]);
      expect(await timesOf(s, OCT26, s.seniorId)).toEqual([['08:55', '09:40', null]]);
      const [entry] = await t.entries('day_template_assignment.end', set.id);
      expect((entry?.new_value as { lessonDates: string[] }).lessonDates[0]).toBe(OCT26);
    });
  });

  describe('what the change refuses', () => {
    for (const shared of ['teacher', 'room'] as const) {
      it(`a change that puts a ${shared}'s two lessons over each other, by date, with nothing written`, async () => {
        const s = await scene({ shared });
        const early = await templateAt(s, 'Early', '07:20');
        // A draft, which a saved change would mark out of date.
        await t.draftIn(s.branch);
        const rows = await storedRowsOf(s.branch);
        const audit = await t.auditCount();

        // Grade 10 from 07:20: history in lesson 2 at 08:15 to 09:00, over
        // maths of grade 7 at 08:00 to 08:45.
        const refused = await assign(
          s,
          setting(early, OCT19, { level: 'grades', gradeFrom: 10, gradeTo: 10 }),
        );

        refusedWith(refused, 409, 'calendar_blocked');
        expect(detailsOf(refused).every((one) => one.code === 'date_blocked')).toBe(true);
        expect(detailsOf(refused).map((one) => one.day)).toContain(OCT19);
        expect(detailsOf(refused).map((one) => one.day)).not.toContain(MONDAY);
        expect(await storedRowsOf(s.branch)).toEqual(rows);
        expect(await t.auditCount()).toBe(audit);
      });
    }

    // Spec review of the code, must-fix 1: the other branch's claim (an
    // exam: the claims of every other branch are its lessons and exams, the
    // same check) meets the new time only through the travel time.
    it("a change that brings a lesson within the travel time of its teacher's claim in another branch, by date", async () => {
      const s = await scene();
      const late = await templateAt(s, 'Late', '09:00');
      // The history teacher invigilates an exam in another branch on 19
      // October from 10:50 to 11:20; history's new time ends at 10:40, and the
      // branches are 20 minutes apart.
      const other = await t.newBranch();
      const otherYear = await load.classes.year(other);
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: s.seniorTeacher, branch_id: other, is_main: false })
        .execute();
      const otherClass = await load.classes.schoolClass(other, otherYear, {
        grade: 7,
        room: await load.classes.room(other),
      });
      const otherRoom = await load.classes.room(other);
      await t.database.migrator.transaction().execute(async (transaction) => {
        const written = await transaction
          .insertInto('exams')
          .values({
            branch_id: other,
            academic_year_id: otherYear,
            exam_date: OCT19,
            starts_at: at(OCT19, '10:50'),
            ends_at: at(OCT19, '11:20'),
            first_slot: 1,
            last_slot: 1,
            title: 'Quarter exam',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const room = await transaction
          .insertInto('exam_rooms')
          .values({ branch_id: other, exam_id: written.id, room_id: otherRoom })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('exam_room_classes')
          .values({
            branch_id: other,
            exam_id: written.id,
            exam_room_id: room.id,
            class_id: otherClass,
          })
          .execute();
        await transaction
          .insertInto('exam_invigilators')
          .values({
            branch_id: other,
            exam_id: written.id,
            exam_room_id: room.id,
            staff_id: s.seniorTeacher,
          })
          .execute();
      });
      const [low, high] = [s.branch, other].sort();
      await t.database.migrator
        .insertInto('travel_times')
        .values({ branch_low: low ?? '', branch_high: high ?? '', minutes: 20 })
        .execute();
      const rows = await storedRowsOf(s.branch);

      const refused = await assign(
        s,
        setting(late, OCT19, { level: 'grades', gradeFrom: 10, gradeTo: 10 }),
      );

      refusedWith(refused, 409, 'calendar_blocked');
      expect(detailsOf(refused).map((one) => one.day)).toEqual([OCT19]);
      expect(await storedRowsOf(s.branch)).toEqual(rows);

      // With 5 minutes between the branches the same change goes through.
      await t.database.migrator
        .updateTable('travel_times')
        .set({ minutes: 5 })
        .where('branch_low', '=', low ?? '')
        .execute();
      okay(
        await assign(s, setting(late, OCT19, { level: 'grades', gradeFrom: 10, gradeTo: 10 })),
        201,
      );
    });
  });

  describe('a lesson slot the published timetable uses', () => {
    it('removed is refused after the version is written, listed by grade and dates, with nothing left; the preview lists it', async () => {
      const s = await scene({ group: true });
      await t.draftIn(s.branch);
      const shorter = [s.lessonType, s.pause, s.lessonType];
      const shown = await preview(s.branch, {
        kind: 'template_version',
        dayTemplateId: s.regular,
        change: { from: OCT19, startTime: '08:00', slotTypeIds: shorter },
      });
      expect(
        shown.slotsInUse.map((one) => [one.grade, one.weekday, one.lessonNumber, one.problem]),
      ).toEqual([
        [9, 1, 3, 'removed'],
        [10, 1, 3, 'removed'],
      ]);
      expect(shown.slotsInUse[0]?.firstDate).toBe(OCT19);
      expect(shown.slotsInUse[0]?.lastDate).toBe('2027-05-31');
      const rows = await storedRowsOf(s.branch);
      const audit = await t.auditCount();

      const refused = await addVersion(s, s.regular, shorter, OCT19);

      refusedWith(refused, 409, 'template_slot_in_use');
      expect(detailsOf(refused).map((one) => [one.path, one.day])).toEqual([
        ['slots.9.1.3', OCT19],
        ['slots.10.1.3', OCT19],
      ]);
      expect(await storedRowsOf(s.branch)).toEqual(rows);
      expect(await t.auditCount()).toBe(audit);
    });

    // Spec review must-fix 2b: a date whose day already lacks the number
    // before the change is no refusal; the run of dates ends before it.
    it('is not refused on the dates whose day lacked it before the change', async () => {
      const s = await scene({ group: true });
      const two = await t.createTemplate(s.branch, 'Two', [s.lessonType, s.pause, s.lessonType]);
      // Written straight into the table: grades 9 and 10 have two lessons
      // from 16 November (the route would refuse it for the group's lesson 3).
      await t.database.migrator
        .insertInto('day_template_assignments')
        .values({
          branch_id: s.branch,
          level: 'grades',
          weekday: null,
          grade_from: 9,
          grade_to: 10,
          day_template_id: two,
          valid_from: NOV16,
        })
        .execute();
      const shown = await preview(s.branch, {
        kind: 'template_version',
        dayTemplateId: s.regular,
        change: {
          from: OCT19,
          startTime: '08:00',
          slotTypeIds: [s.lessonType, s.pause, s.lessonType],
        },
      });
      expect(
        shown.slotsInUse.map((one) => [one.grade, one.lessonNumber, one.firstDate, one.lastDate]),
      ).toEqual([
        [9, 3, OCT19, NOV09],
        [10, 3, OCT19, NOV09],
      ]);
    });

    it('not used saves: the same version over a pattern without lesson 3 keeps every lesson', async () => {
      const s = await scene();
      okay(await addVersion(s, s.regular, [s.lessonType, s.pause, s.lessonType], OCT19));
      expect(await timesOf(s, OCT19, s.classId)).toEqual([['08:00', '08:45', null]]);
      expect(await timesOf(s, OCT19, s.seniorId)).toEqual([['08:55', '09:40', null]]);
    });

    // Review correction 2: lesson slots are matched by their number in the day.
    it('a lesson slot taken from the middle while the last used number stays: the later lessons take the next slots; refused when that number is used', async () => {
      const middle = (s: Scene) => [s.lessonType, s.pause, s.pause, s.lessonType];
      const s = await scene();
      okay(await addVersion(s, s.regular, middle(s), OCT19));
      expect(await timesOf(s, OCT19, s.classId)).toEqual([['08:00', '08:45', null]]);
      expect(await timesOf(s, OCT19, s.seniorId)).toEqual([['09:05', '09:50', null]]);

      const g = await scene({ group: true });
      refusedWith(await addVersion(g, g.regular, middle(g), OCT19), 409, 'template_slot_in_use');
    });

    it('reordered (another slot type at a used number) is refused', async () => {
      const s = await scene();
      const shorter = await t.createSlotType(s.branch, 'Lesson 40', 'lesson', 40);
      const refused = await addVersion(
        s,
        s.regular,
        [shorter, s.pause, s.lessonType, s.pause, s.lessonType],
        OCT19,
      );
      refusedWith(refused, 409, 'template_slot_in_use');
      expect(detailsOf(refused).map((one) => one.path)).toEqual(['slots.7.1.1']);
    });

    it('on a special date follows the shortened day: the lesson beyond its slots is cancelled "not in the day\'s template" and listed, not refused', async () => {
      const s = await scene({ three: true });
      const open = await templateAt(s, 'Open', '08:00');
      okay(
        await post('/api/setup/calendar-entries', s.branch, {
          kind: 'special_day',
          name: 'Open day',
          firstDate: OCT26,
          lastDate: OCT26,
          gradeFrom: null,
          gradeTo: null,
          dayTemplateId: open,
          followsWeekday: null,
          examWeek: null,
        }),
        201,
      );
      const shorter = [s.lessonType, s.pause, s.lessonType];
      const shown = await preview(s.branch, {
        kind: 'template_version',
        dayTemplateId: open,
        change: { from: OCT19, startTime: '08:00', slotTypeIds: shorter },
      });
      expect(shown.slotsInUse).toEqual([]);
      expect(shown.lessons.shortenedDays.map((one) => [one.date, one.classId])).toEqual([
        [OCT26, s.classId],
      ]);

      okay(await addVersion(s, open, shorter, OCT19));

      const music = (await lessonsOn(s.branch, OCT26)).find((one) => one.subject_id === s.music);
      expect(music?.cancel_cause).toBe('not_in_template');
      // Spec review must-fix 2a: the kept lessons chosen with the save:
      // maths and music, music in the free lesson 2; art cancelled.
      const kept = await scene({ three: true });
      const keptOpen = await templateAt(kept, 'Open', '08:00');
      okay(
        await post('/api/setup/calendar-entries', kept.branch, {
          kind: 'special_day',
          name: 'Open day',
          firstDate: OCT26,
          lastDate: OCT26,
          gradeFrom: null,
          gradeTo: null,
          dayTemplateId: keptOpen,
          followsWeekday: null,
          examWeek: null,
        }),
        201,
      );
      okay(
        await addVersion(kept, keptOpen, [kept.lessonType, kept.pause, kept.lessonType], OCT19, {
          dayKeeps: [{ date: OCT26, classId: kept.classId, slotPositions: [1, 5] }],
        }),
      );
      const keptOn = (await lessonsOn(kept.branch, OCT26)).filter(
        (lesson) => lesson.class_id === kept.classId,
      );
      expect(
        keptOn.find((lesson) => lesson.subject_id === kept.music)?.cancel_cause ?? null,
      ).toBeNull();
      expect(
        keptOn
          .filter((lesson) => lesson.cancel_cause === null)
          .map((lesson) => clock(lesson.starts_at)),
      ).toEqual(['08:00', '08:55']);
      expect(keptOn.filter((lesson) => lesson.cancel_cause === 'not_in_template')).toHaveLength(1);

      // The regular Mondays keep all three lessons.
      expect(
        (await lessonsOn(s.branch, NOV16)).filter((one) => one.class_id === s.classId),
      ).toHaveLength(3);
    });
  });

  it('a two-grade group whose grades the change puts on different times is cancelled "not in the day\'s template" and listed; the save goes on', async () => {
    const s = await scene({ group: true });
    const late = await templateAt(s, 'Late', '09:00');
    const record = setting(late, OCT19, { level: 'grades', gradeFrom: 10, gradeTo: 10 });
    const shown = await preview(s.branch, { kind: 'assignment_set', change: record });
    expect(
      shown.lessons.cancelled
        .filter((one) => one.unitId === s.groupId)
        .map((one) => [one.date, one.cause]),
    ).toContainEqual([OCT19, 'not_in_template']);
    expect(shown.slotsInUse).toEqual([]);

    okay(await assign(s, record), 201);

    expect(await timesOf(s, OCT19, s.groupId)).toEqual([['09:50', '10:35', 'not_in_template']]);
    expect(await timesOf(s, OCT19, s.seniorId)).toEqual([['09:55', '10:40', null]]);
  });

  describe('an exam', () => {
    const exam = (
      s: Scene,
      slots: [number, number],
      from: string,
      until: string,
      invigilator: string,
    ) => insertExam(s, OCT26, slots, from, until, invigilator);

    const examTimes = async (id: string) => {
      const row = await t.database.migrator
        .selectFrom('exams')
        .select(['starts_at', 'ends_at', 'cancel_cause'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      return [clock(row.starts_at), clock(row.ends_at), row.cancel_cause];
    };

    it('follows its slots to the new times', async () => {
      const s = await scene();
      const id = await exam(s, [3, 3], '08:55', '09:40', s.teacherId);
      okay(await changeLength(s, 40, OCT19));
      expect(await examTimes(id)).toEqual(['08:50', '09:30', null]);
      expect(await timesOf(s, OCT26, s.seniorId)).toEqual([['08:50', '09:30', 'exam']]);
    });

    it("is checked again at its new times: onto its invigilator's lesson, refused by date", async () => {
      const s = await scene();
      const early = await templateAt(s, 'Early', '07:10');
      // The maths teacher invigilates; grade 10 from 07:10 puts the exam at
      // 08:05 to 08:50, over maths of grade 7 at 08:00.
      const id = await exam(s, [3, 3], '08:55', '09:40', s.teacherId);
      const rows = await storedRowsOf(s.branch);

      const refused = await assign(
        s,
        setting(early, OCT26, { level: 'grades', gradeFrom: 10, gradeTo: 10 }),
      );

      refusedWith(refused, 409, 'calendar_blocked');
      expect(detailsOf(refused).some((one) => one.day === OCT26)).toBe(true);
      expect(await storedRowsOf(s.branch)).toEqual(rows);
      expect(await examTimes(id)).toEqual(['08:55', '09:40', null]);
    });

    it('in a slot the change drops is refused with the exam listed', async () => {
      const s = await scene();
      // Lesson 3 is in no lesson of the pattern, only under the exam.
      const id = await exam(s, [5, 5], '09:50', '10:35', s.teacherId);
      const refused = await addVersion(s, s.regular, [s.lessonType, s.pause, s.lessonType], OCT19);
      refusedWith(refused, 409, 'calendar_blocked');
      expect(
        detailsOf(refused)
          .filter((one) => one.code === 'calendar_exam_slots')
          .map((one) => [one.path, one.day]),
      ).toEqual([[`exams.${id}`, OCT26]]);
    });
  });

  // Task 5.6b-4b (the From line of 5.6b-4a): a stored one-day change or bulk
  // cancel on a date the change writes follows its lesson to the new times by
  // its lesson number in the day (decision 4 of 5.6b-4a): a cancel stays a
  // cancel, a room change stays, a move goes to the new times of its lesson
  // number (06, What a change does to existing data, "Day template changed":
  // lessons from the start date take the new times). The change's preview
  // lists them sorted, as a calendar save's does, and the save sends the key
  // shown and the choices.
  describe('a stored one-day change or bulk cancel on a date the change writes', () => {
    /** The stored room changes and moves of a branch in force, oldest first. */
    const changesOf = (branch: string) =>
      t.database.migrator
        .selectFrom('lesson_day_changes')
        .select([
          'id',
          'kind',
          'lesson_id',
          sql<string>`from_date::text`.as('from_date'),
          'from_starts_at',
          'from_ends_at',
          sql<string>`to_date::text`.as('to_date'),
          'to_starts_at',
          'to_ends_at',
          'to_room_id',
        ])
        .where('branch_id', '=', branch)
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('lesson_day_change_ends')
                .select('change_id')
                .whereRef('lesson_day_change_ends.change_id', '=', 'lesson_day_changes.id'),
            ),
          ),
        )
        .orderBy('changed_at')
        .orderBy('id')
        .execute();

    /** The preview of a 40-minute lesson from `from`, then its save with the key shown and `dayDecisions`. */
    const lengthFollowed = async (s: Scene, from: string, dayDecisions?: object[]) => {
      const shown = await preview(s.branch, {
        kind: 'slot_length',
        slotTypeId: s.lessonType,
        change: { lengthMinutes: 40, from },
      });
      const saved = await changeLength(s, 40, from, {
        dayChangesKey: shown.lessons.dayChanges.key,
        ...(dayDecisions === undefined ? {} : { dayDecisions }),
      });
      return { shown, saved };
    };

    it('a one-lesson cancel stays a cancel on the lesson at its new times', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, OCT26, s.classId);
      okay(
        await keyed(`/api/timetable/lessons/${lesson.id}/cancel`, s.branch, {
          reason: 'Excursion to the museum',
        }),
      );

      const { shown, saved } = await lengthFollowed(s, OCT19);

      expect(shown.lessons.dayChanges.kept.map((one) => [one.kind, one.from.start])).toEqual([
        ['cancel', 480],
      ]);
      expect(shown.lessons.dayChanges.dropped).toEqual([]);
      okay(saved);
      expect(await timesOf(s, OCT26, s.classId)).toEqual([['08:00', '08:40', 'reason']]);
      const after = await lessonOf(s, OCT26, s.classId);
      const reason = await t.database.migrator
        .selectFrom('lessons')
        .select('cancel_reason')
        .where('id', '=', after.id)
        .executeTakeFirstOrThrow();
      expect(reason.cancel_reason).toBe('Excursion to the museum');
    });

    it('a room change stays on the lesson at its new times, its stored times follow, and a later rewrite keeps it; the preview moves nothing', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, OCT26, s.seniorId);
      const room = await load.classes.room(s.branch);
      okay(
        await keyed(`/api/timetable/lessons/${lesson.id}/room`, s.branch, {
          roomId: room,
          reason: 'The room is painted',
        }),
      );
      const stored = await changesOf(s.branch);

      const shown = await preview(s.branch, {
        kind: 'slot_length',
        slotTypeId: s.lessonType,
        change: { lengthMinutes: 40, from: OCT19 },
      });
      expect(shown.lessons.dayChanges.kept.map((one) => [one.kind, one.from.start])).toEqual([
        ['room', 530],
      ]);
      // The preview's transaction is rolled back: the stored times stay.
      expect(await changesOf(s.branch)).toEqual(stored);

      okay(await changeLength(s, 40, OCT19, { dayChangesKey: shown.lessons.dayChanges.key }));
      const moved = await lessonOf(s, OCT26, s.seniorId);
      expect([clock(moved.starts_at), clock(moved.ends_at)]).toEqual(['08:50', '09:30']);
      const roomOf = async (id: string) =>
        (
          await t.database.migrator
            .selectFrom('lessons')
            .select('room_id')
            .where('id', '=', id)
            .executeTakeFirstOrThrow()
        ).room_id;
      expect(await roomOf(moved.id)).toBe(room);
      const [change] = await changesOf(s.branch);
      expect(change?.lesson_id).toBe(moved.id);
      expect([
        clock(change?.from_starts_at ?? new Date(0)),
        clock(change?.to_starts_at ?? new Date(0)),
      ]).toEqual(['08:50', '08:50']);
      // The audit entry keeps the times before and after (decision 1).
      const [entry] = await t.entries('slot_type.length_change', s.lessonType);
      const times = (entry?.new_value as { storedTimes?: { table: string; part: string }[] })
        .storedTimes;
      expect(times?.map((one) => [one.table, one.part]).sort()).toEqual([
        ['lesson_day_changes', 'from'],
        ['lesson_day_changes', 'to'],
      ]);

      // A later change over that date matches the stored change to its lesson again.
      const again = await preview(s.branch, {
        kind: 'slot_length',
        slotTypeId: s.lessonType,
        change: { lengthMinutes: 35, from: OCT19 },
      });
      expect(again.lessons.dayChanges.kept.map((one) => [one.kind, one.from.start])).toEqual([
        ['room', 525],
      ]);
      okay(await changeLength(s, 35, OCT19, { dayChangesKey: again.lessons.dayChanges.key }));
      const last = await lessonOf(s, OCT26, s.seniorId);
      expect([clock(last.starts_at), await roomOf(last.id)]).toEqual(['08:45', room]);
    });

    it('a move inside a written date goes to the new times of its lesson number', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, OCT26, s.classId);
      okay(
        await keyed(`/api/timetable/lessons/${lesson.id}/move`, s.branch, {
          date: OCT26,
          lessonNumber: 3,
          reason: 'Excursion to the museum',
        }),
      );
      expect(await timesOf(s, OCT26, s.classId)).toEqual([['09:50', '10:35', null]]);

      const { shown, saved } = await lengthFollowed(s, OCT19);

      expect(shown.lessons.dayChanges.kept.map((one) => [one.kind, one.to.start])).toEqual([
        ['move', 580],
      ]);
      okay(saved);
      expect(await timesOf(s, OCT26, s.classId)).toEqual([['09:40', '10:20', null]]);
      const [change] = await changesOf(s.branch);
      expect(clock(change?.from_starts_at ?? new Date(0))).toBe('08:00');
      expect(clock(change?.to_starts_at ?? new Date(0))).toBe('09:40');
    });

    it('a move from a written date to one it does not write leaves its old place out; one into a written date takes the new times there', async () => {
      const s = await scene();
      // From 26 October (written) to 19 October (not written), lesson 3.
      const away = await lessonOf(s, OCT26, s.classId);
      okay(
        await keyed(`/api/timetable/lessons/${away.id}/move`, s.branch, {
          date: OCT19,
          lessonNumber: 3,
          reason: 'Excursion to the museum',
        }),
      );
      // From 19 October (not written) into 26 October (written), lesson 3,
      // a second later: changes of one moment and person are one request.
      const into = await lessonOf(s, OCT19, s.seniorId);
      t.clock.advance(1000);
      try {
        okay(
          await keyed(`/api/timetable/lessons/${into.id}/move`, s.branch, {
            date: OCT26,
            lessonNumber: 3,
            reason: 'The teacher is at a seminar',
          }),
        );
      } finally {
        t.clock.set(START);
      }

      const { saved } = await lengthFollowed(s, OCT26);
      okay(saved);

      // Not held twice: no maths on 26 October, the moved one on 19 October as it was.
      expect(await timesOf(s, OCT26, s.classId)).toEqual([]);
      expect(await timesOf(s, OCT19, s.classId)).toEqual([
        ['08:00', '08:45', null],
        ['09:50', '10:35', null],
      ]);
      // The history lesson moved from 19 October stands at the new times of lesson 3 on 26 October.
      expect(await timesOf(s, OCT26, s.seniorId)).toEqual([
        ['08:50', '09:30', null],
        ['09:40', '10:20', null],
      ]);
      expect(await timesOf(s, OCT19, s.seniorId)).toEqual([]);
    });

    it('a move into a lesson number the change removes needs a decision: refused without one, cancelled with "cancel the lesson that day"', async () => {
      const s = await scene();
      const lesson = await lessonOf(s, OCT26, s.classId);
      okay(
        await keyed(`/api/timetable/lessons/${lesson.id}/move`, s.branch, {
          date: OCT26,
          lessonNumber: 3,
          reason: 'Excursion to the museum',
        }),
      );
      // Lesson 3 is used by no published block: the version may drop it.
      const slots = [s.lessonType, s.pause, s.lessonType];
      const shown = await preview(s.branch, {
        kind: 'template_version',
        dayTemplateId: s.regular,
        change: { from: OCT19, startTime: '08:00', slotTypeIds: slots },
      });
      expect(shown.slotsInUse).toEqual([]);
      const [item] = shown.lessons.dayChanges.decide;
      expect(item?.kind).toBe('move');
      const key = shown.lessons.dayChanges.key;

      const refused = await addVersion(s, s.regular, slots, OCT19, { dayChangesKey: key });
      refusedWith(refused, 409, 'calendar_blocked');
      expect(detailsOf(refused).map((one) => one.code)).toContain('day_change_undecided');

      okay(
        await addVersion(s, s.regular, slots, OCT19, {
          dayChangesKey: key,
          dayDecisions: [{ key: item?.key ?? '', choice: 'cancel' }],
        }),
      );
      expect(await timesOf(s, OCT26, s.classId)).toEqual([['08:00', '08:45', 'reason']]);
      expect(await changesOf(s.branch)).toEqual([]);
    });

    it('a bulk cancel cancels its lesson numbers at the new times; its span follows by its lesson number, and its "keep" of a shared block still holds', async () => {
      const s = await scene({ group: true });
      // History of the grade-10 class in lesson 2, and the group's block in lesson 3 kept for the grade-9 class.
      await bulkCancel(s, { date: OCT26, classIds: [s.seniorId], lessonNumbers: [2, 3] }, 'keep');
      const groupOn = async (date: string) =>
        (await lessonsOn(s.branch, date)).filter((one) => one.group_id === s.groupId);

      const { shown, saved } = await lengthFollowed(s, OCT19);

      // Listed as a bulk cancel, never again as a one-lesson cancel.
      expect(shown.lessons.dayChanges.bulk.length).toBe(1);
      expect(
        [...shown.lessons.dayChanges.kept, ...shown.lessons.dayChanges.dropped].filter(
          (one) => one.kind === 'cancel',
        ),
      ).toEqual([]);
      okay(saved);
      expect(await timesOf(s, OCT26, s.seniorId)).toEqual([['08:50', '09:30', 'reason']]);
      const group = await groupOn(OCT26);
      expect(group.map((one) => [clock(one.starts_at), one.cancel_cause])).toEqual([
        ['09:40', null],
      ]);
      const spans = await t.database.migrator
        .selectFrom('bulk_cancel_spans')
        .select(['lesson_number', 'starts_at', 'ends_at'])
        .where('branch_id', '=', s.branch)
        .orderBy('lesson_number')
        .execute();
      expect(
        spans.map((one) => [one.lesson_number, clock(one.starts_at), clock(one.ends_at)]),
      ).toEqual([
        [2, '08:50', '09:30'],
        [3, '09:40', '10:20'],
      ]);
      const choices = await t.database.migrator
        .selectFrom('bulk_cancel_blocks')
        .select(['block_id', 'choice', 'starts_at'])
        .where('branch_id', '=', s.branch)
        .execute();
      // The row of the block the write replaced keeps no block; the one recorded again names the new block.
      expect(choices.map((one) => [one.choice, clock(one.starts_at)])).toEqual([
        ['keep', '09:40'],
        ['keep', '09:40'],
      ]);
      expect(choices.flatMap((one) => (one.block_id === null ? [] : [one.block_id]))).toEqual([
        group[0]?.block_id,
      ]);
    });

    it('a kept room change that meets another lesson at the new times needs a decision; a template set for grades 9 to 11 saves with "drop the change", and ended, the times come back', async () => {
      const s = await scene();
      const classRoom = (
        await t.database.migrator
          .selectFrom('lessons')
          .select('room_id')
          .where('id', '=', (await lessonOf(s, OCT26, s.classId)).id)
          .executeTakeFirstOrThrow()
      ).room_id;
      if (classRoom === null) throw new Error('The maths lesson has no room.');
      const lesson = await lessonOf(s, OCT26, s.seniorId);
      okay(
        await keyed(`/api/timetable/lessons/${lesson.id}/room`, s.branch, {
          roomId: classRoom,
          reason: 'The room is painted',
        }),
      );
      // Grades 9 to 11 from 07:05: their lesson 2 at 08:00, with the maths lesson in that room.
      const senior = await templateAt(s, 'Senior', '07:05');
      const record = setting(senior, OCT19, { level: 'grades', gradeFrom: 9, gradeTo: 11 });
      const shown = await preview(s.branch, { kind: 'assignment_set', change: record });
      const [item] = shown.lessons.dayChanges.decide;
      expect(item?.kind).toBe('room');
      expect(item?.blocked.length).toBeGreaterThan(0);

      // A key of another sorting is refused.
      refusedWith(
        await assign(s, record, { dayChangesKey: 'a'.repeat(64) }),
        409,
        'calendar_blocked',
      );
      refusedWith(
        await assign(s, record, { dayChangesKey: shown.lessons.dayChanges.key }),
        409,
        'calendar_blocked',
      );
      okay(
        await assign(s, record, {
          dayChangesKey: shown.lessons.dayChanges.key,
          dayDecisions: [{ key: item?.key ?? '', choice: 'drop' }],
        }),
        201,
      );
      const held = await lessonOf(s, OCT26, s.seniorId);
      expect(clock(held.starts_at)).toBe('08:00');
      expect(await changesOf(s.branch)).toEqual([]);

      // A room change of 9 November under the setting, then the setting ended from 2 November.
      const later = await lessonOf(s, NOV09, s.seniorId);
      const room = await load.classes.room(s.branch);
      okay(
        await keyed(`/api/timetable/lessons/${later.id}/room`, s.branch, {
          roomId: room,
          reason: 'The room is painted',
        }),
      );
      const assignment = await t.database.migrator
        .selectFrom('day_template_assignments')
        .select('id')
        .where('branch_id', '=', s.branch)
        .where('day_template_id', '=', senior)
        .executeTakeFirstOrThrow();
      const ended = await preview(s.branch, {
        kind: 'assignment_end',
        assignmentId: assignment.id,
        change: { from: NOV02 },
      });
      expect(ended.lessons.dayChanges.kept.map((one) => [one.kind, one.from.start])).toEqual([
        ['room', 535],
      ]);
      okay(
        await post(`/api/setup/day-template-assignments/${assignment.id}/end`, s.branch, {
          from: NOV02,
          days: { dayChangesKey: ended.lessons.dayChanges.key },
        }),
      );
      const back = await lessonOf(s, NOV09, s.seniorId);
      expect(clock(back.starts_at)).toBe('08:55');
      const [change] = await changesOf(s.branch);
      expect([change?.to_room_id, clock(change?.to_starts_at ?? new Date(0))]).toEqual([
        room,
        '08:55',
      ]);
    });

    it('a two-grade group whose grades the change puts on different times: its room change is dropped and listed', async () => {
      const s = await scene({ group: true });
      const group = (await lessonsOn(s.branch, OCT26)).find((one) => one.group_id === s.groupId);
      if (group === undefined) throw new Error('No group lesson on 26 October.');
      okay(
        await keyed(`/api/timetable/lessons/${group.id}/room`, s.branch, {
          roomId: await load.classes.room(s.branch),
          reason: 'The room is painted',
        }),
      );
      const senior = await templateAt(s, 'Senior', '08:05');
      const record = setting(senior, OCT19, { level: 'grades', gradeFrom: 10, gradeTo: 11 });
      const shown = await preview(s.branch, { kind: 'assignment_set', change: record });
      expect(shown.lessons.dayChanges.dropped.map((one) => one.kind)).toEqual(['room']);
      okay(await assign(s, record, { dayChangesKey: shown.lessons.dayChanges.key }), 201);
      expect(await timesOf(s, OCT26, s.groupId)).toEqual([['09:50', '10:35', 'not_in_template']]);
      expect(await changesOf(s.branch)).toEqual([]);
    });
  });

  // Decision 3: the weekly days a version was published against.
  describe('the weekly days of a published version', () => {
    it('are stored by the publish, and the application cannot change them', async () => {
      const s = await scene();
      const rows = await t.database.migrator
        .selectFrom('timetable_version_days')
        .select(['grade', 'weekday', 'position', 'kind', 'start_minutes', 'end_minutes'])
        .where('version_id', '=', s.version)
        .where('weekday', '=', 1)
        .orderBy('grade')
        .orderBy('position')
        .execute();
      expect(rows.filter((one) => one.grade === 10)).toEqual([
        {
          grade: 10,
          weekday: 1,
          position: 1,
          kind: 'lesson',
          start_minutes: 480,
          end_minutes: 525,
        },
        { grade: 10, weekday: 1, position: 2, kind: 'break', start_minutes: 525, end_minutes: 535 },
        {
          grade: 10,
          weekday: 1,
          position: 3,
          kind: 'lesson',
          start_minutes: 535,
          end_minutes: 580,
        },
        { grade: 10, weekday: 1, position: 4, kind: 'break', start_minutes: 580, end_minutes: 590 },
        {
          grade: 10,
          weekday: 1,
          position: 5,
          kind: 'lesson',
          start_minutes: 590,
          end_minutes: 635,
        },
      ]);
      for (const write of [
        (transaction: Transaction) =>
          transaction
            .updateTable('timetable_version_days')
            .set({ start_minutes: 500 })
            .where('version_id', '=', s.version)
            .execute(),
        (transaction: Transaction) =>
          transaction
            .deleteFrom('timetable_version_days')
            .where('version_id', '=', s.version)
            .execute(),
        (transaction: Transaction) =>
          transaction
            .insertInto('timetable_version_days')
            .values({
              branch_id: s.branch,
              version_id: s.version,
              grade: 3,
              weekday: 2,
              position: 1,
              kind: 'lesson',
              start_minutes: 480,
              end_minutes: 525,
            })
            .execute(),
      ]) {
        await expect(
          t.app.get(Transactions).run([s.branch], async (transaction) => {
            await write(transaction);
            await sql`set constraints all immediate`.execute(transaction);
          }),
        ).rejects.toThrow();
      }
    });

    it('keep every lesson of a version published to start after the change, over a later calendar change and a withdraw', async () => {
      const s = await scene();
      // A copy of the version, published from 2 November.
      const next = await draft(s.branch, s.year, s.version);
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', next)
        .execute();
      for (const row of await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select(['id', 'subject_id'])
        .where('version_id', '=', next)
        .execute()) {
        await placeAt(s.branch, next, row.id, 1, row.subject_id === s.maths ? 1 : 3);
      }
      await confirmTemplates(s.branch, next);
      await load.freeEditLock(next);
      okay(await publish(s.branch, next, NOV02));

      // The length changes from 26 October, before the copy's start.
      okay(await changeLength(s, 40, OCT26));
      expect(await timesOf(s, NOV09, s.seniorId)).toEqual([['08:50', '09:30', null]]);
      expect((await lessonOf(s, NOV09, s.seniorId)).version_id).toBe(next);

      // A day off on 9 November, taken back: the lessons come back on the new times.
      const off = okay(
        await post('/api/setup/calendar-entries', s.branch, {
          kind: 'day_off',
          name: 'Navruz',
          firstDate: NOV09,
          lastDate: NOV09,
          gradeFrom: null,
          gradeTo: null,
          dayTemplateId: null,
          followsWeekday: null,
          examWeek: null,
        }),
        201,
      );
      expect(await lessonsOn(s.branch, NOV09)).toEqual([]);
      okay(await post(`/api/setup/calendar-entries/${off.id}/archive`, s.branch));
      expect(await timesOf(s, NOV09, s.classId)).toEqual([['08:00', '08:40', null]]);
      expect(await timesOf(s, NOV09, s.seniorId)).toEqual([['08:50', '09:30', null]]);

      // The copy withdrawn: the first version runs again on the new times.
      okay(await keyed(`/api/timetable/versions/${next}/withdraw`, s.branch, {}));
      expect(await timesOf(s, NOV09, s.classId)).toEqual([['08:00', '08:40', null]]);
      expect(await timesOf(s, NOV09, s.seniorId)).toEqual([['08:50', '09:30', null]]);
      expect((await lessonOf(s, NOV09, s.seniorId)).version_id).toBe(s.version);
    });
  });

  it('the preview lists what the save then does and writes nothing', async () => {
    const s = await scene();
    await t.draftIn(s.branch);
    const rows = await storedRowsOf(s.branch);
    const audit = await t.auditCount();

    const shown = await preview(s.branch, {
      kind: 'slot_length',
      slotTypeId: s.lessonType,
      change: { lengthMinutes: 40, from: OCT19 },
    });

    expect(shown.changed.length).toBeGreaterThan(0);
    expect(shown.slotsInUse).toEqual([]);
    expect(shown.lessons.created.some((one) => one.date === OCT19 && one.start === 530)).toBe(true);
    expect(shown.lessons.removed.some((one) => one.date === OCT19 && one.start === 535)).toBe(true);
    expect(shown.lessons.notified.sort()).toEqual([s.seniorTeacher, s.teacherId].sort());
    expect(await storedRowsOf(s.branch)).toEqual(rows);
    expect(await t.auditCount()).toBe(audit);
  });

  // .claude/rules/api.md: an id of another branch or an unknown one in the
  // body is 404 on every route that takes it, with the rows of both branches
  // unchanged; a field with no use on the path is refused.
  it("answers 404 for another branch's or an unknown id among the choices, with both branches unchanged", async () => {
    const north = await scene({ group: true });
    const south = await scene({ group: true });
    // In each branch, rows of every table the rewrite writes (permission
    // review must-fix 3): a bulk cancel of 16 November keeping the group's
    // block, and an exam of the grade-10 class in lesson 3 of 23 November
    // with the class kept out of the group's block.
    const examOf: Record<string, string> = {};
    for (const one of [north, south]) {
      await bulkCancel(one, { date: NOV16, classIds: [one.seniorId], lessonNumbers: [3] }, 'keep');
      const group = (await lessonsOn(one.branch, NOV23)).find(
        (lesson) => lesson.group_id === one.groupId,
      );
      if (group === undefined) throw new Error('No group lesson on 23 November.');
      examOf[one.branch] = await insertExam(one, NOV23, [5, 5], '09:50', '10:35', one.teacherId, [
        { blockId: group.block_id, classId: one.seniorId },
      ]);
    }
    const southLesson = await lessonOf(south, OCT26, south.classId);
    const southChange = (
      await keyed(`/api/timetable/lessons/${southLesson.id}/move`, south.branch, {
        date: OCT19,
        lessonNumber: 3,
        reason: 'Excursion to the museum',
      })
    ).status;
    expect(southChange).toBe(200);
    const southChangeId = (
      await t.database.migrator
        .selectFrom('lesson_day_changes')
        .select('id')
        .where('lesson_id', '=', southLesson.id)
        .executeTakeFirstOrThrow()
    ).id;
    const southBlock = await t.database.migrator
      .selectFrom('pattern_blocks')
      .select('id')
      .where('version_id', '=', south.version)
      .executeTakeFirstOrThrow();
    const southExam = { id: examOf[south.branch] ?? '' };
    const northExam = examOf[north.branch] ?? '';
    const northLesson = await lessonOf(north, OCT26, north.classId);
    const set = okay(
      await assign(
        north,
        setting(await templateAt(north, 'Late', '09:00'), DEC07, {
          level: 'grades',
          gradeFrom: 10,
          gradeTo: 10,
        }),
      ),
      201,
    );
    const late = await templateAt(north, 'Later', '09:30');
    const rows = [await storedRowsOf(north.branch), await storedRowsOf(south.branch)];
    for (const one of rows) {
      expect(one.bulk_cancel_blocks?.length).toBeGreaterThan(0);
      expect(one.lesson_block_class_outs?.length).toBeGreaterThan(0);
    }
    const audit = await t.auditCount();

    const choices: object[] = [
      { dayDecisions: [{ key: southChangeId, choice: 'drop' }] },
      { dayDecisions: [{ key: southLesson.id, choice: 'drop' }] },
      { dayDecisions: [{ key: UNKNOWN, choice: 'drop' }] },
      {
        dayDecisions: [
          { key: southChangeId, blockId: southBlock.id, blockDate: OCT19, choice: 'cancel' },
        ],
      },
      // A block of a decision with a key of the branch (permission review must-fix 1).
      ...[southBlock.id, UNKNOWN].map((blockId) => ({
        dayDecisions: [{ key: northLesson.id, blockId, blockDate: OCT19, choice: 'cancel' }],
      })),
      { dayKeeps: [{ classId: south.classId, date: OCT19, slotPositions: [1] }] },
      { dayKeeps: [{ classId: UNKNOWN, date: OCT19, slotPositions: [1] }] },
      {
        examBlocks: [{ examId: southExam.id, classId: north.seniorId, start: 480, choice: 'keep' }],
      },
      { examBlocks: [{ examId: UNKNOWN, classId: north.seniorId, start: 480, choice: 'keep' }] },
      // The class of a block's choice (permission review must-fix 2).
      ...[south.seniorId, UNKNOWN].map((classId) => ({
        examBlocks: [{ examId: northExam, classId, start: 480, choice: 'keep' }],
      })),
    ];
    for (const days of choices) {
      const attempts = [
        () => changeLength(north, 40, OCT19, days),
        () => addVersion(north, north.regular, [north.lessonType], OCT19, days),
        () =>
          assign(north, setting(late, OCT19, { level: 'grades', gradeFrom: 7, gradeTo: 7 }), days),
        () =>
          post(`/api/setup/day-template-assignments/${set.id}/end`, north.branch, {
            from: DEC14,
            days,
          }),
        () =>
          post('/api/setup/day-template-table/preview', north.branch, {
            kind: 'slot_length',
            slotTypeId: north.lessonType,
            change: { lengthMinutes: 40, from: OCT19, days },
          }),
        // Permission review should-fix 4: every kind of the preview.
        () =>
          post('/api/setup/day-template-table/preview', north.branch, {
            kind: 'template_version',
            dayTemplateId: north.regular,
            change: { from: OCT19, startTime: '08:00', slotTypeIds: [north.lessonType], days },
          }),
        () =>
          post('/api/setup/day-template-table/preview', north.branch, {
            kind: 'assignment_set',
            change: {
              ...setting(late, OCT19, { level: 'grades', gradeFrom: 7, gradeTo: 7 }),
              days,
            },
          }),
        () =>
          post('/api/setup/day-template-table/preview', north.branch, {
            kind: 'assignment_end',
            assignmentId: set.id,
            change: { from: DEC14, days },
          }),
      ];
      for (const attempt of attempts) {
        refusedWith(await attempt(), 404, 'not_found');
      }
    }
    // A split group's choice has no use on a template change: refused by the schema.
    refusedWith(
      await changeLength(north, 40, OCT19, { groupBlocks: [] }),
      400,
      'validation_failed',
    );
    expect(await storedRowsOf(north.branch)).toEqual(rows[0]);
    expect(await storedRowsOf(south.branch)).toEqual(rows[1]);
    expect(await t.auditCount()).toBe(audit);
  });

  // Permission review should-fix 5: the Principal and a Teacher assigned in
  // the branch are refused each change with choices, with nothing written.
  it('refuses the Principal and a Teacher assigned in the branch on each change and the preview, with nothing written', async () => {
    const s = await scene();
    const late = await templateAt(s, 'Late', '09:00');
    const set = okay(
      await assign(s, setting(late, NOV16, { level: 'grades', gradeFrom: 10, gradeTo: 10 })),
      201,
    );
    for (const role of ['principal', 'teacher'] as const) {
      const holder = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', role)
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      await load.classes.role(holder.account_id, s.branch, role);
    }
    const rows = await storedRowsOf(s.branch);
    const audit = await t.auditCount();
    const days = { dayChangesKey: 'a'.repeat(64) };
    for (const cookie of [t.principal, t.teacher]) {
      for (const attempt of [
        () =>
          post(
            `/api/setup/slot-types/${s.lessonType}/lengths`,
            s.branch,
            { lengthMinutes: 40, from: OCT19, days },
            cookie,
          ),
        () =>
          post(
            `/api/setup/day-templates/${s.regular}/versions`,
            s.branch,
            { from: OCT19, startTime: '08:00', slotTypeIds: [s.lessonType], days },
            cookie,
          ),
        () =>
          post(
            '/api/setup/day-template-assignments',
            s.branch,
            { ...setting(late, OCT19, { level: 'grades', gradeFrom: 7, gradeTo: 7 }), days },
            cookie,
          ),
        () =>
          post(
            `/api/setup/day-template-assignments/${set.id}/end`,
            s.branch,
            { from: OCT26, days },
            cookie,
          ),
        () =>
          post(
            '/api/setup/day-template-table/preview',
            s.branch,
            {
              kind: 'slot_length',
              slotTypeId: s.lessonType,
              change: { lengthMinutes: 40, from: OCT19, days },
            },
            cookie,
          ),
      ]) {
        refusedWith(await attempt(), 403, 'permission_denied');
      }
    }
    expect(await storedRowsOf(s.branch)).toEqual(rows);
    expect(await t.auditCount()).toBe(audit);
  });

  // .claude/rules/timetable.md (the lock rule of 5.6b-1): a class archive or a
  // staff status change holds its row `for update`, writes its audit entry
  // and waits for the year; the template change holds its branch row `for no
  // key update`, then the people, the classes and the year. The real routes,
  // in both orders, with no deadlock.
  describe('at the same moment', () => {
    async function waitingForALock(): Promise<number> {
      const found = await sql<{ waiting: number }>`
        select count(distinct l.pid)::int as waiting
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and not l.granted
      `.execute(t.database.migrator);
      return found.rows[0]?.waiting ?? 0;
    }

    async function holdOpen(branch: string, work: (transaction: Transaction) => Promise<void>) {
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
        .run([branch], async (transaction) => {
          await work(transaction);
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await Promise.race([isReady, done]);
      return { release, done };
    }

    /** The two routes in a fixed order: a third transaction holds a row both wait at. */
    async function inOrder(
      s: Scene,
      first: () => Promise<Response>,
      second: () => Promise<Response>,
      held: { table: 'classes' | 'staff'; id: string },
    ): Promise<[Response, Response]> {
      const gate = await holdOpen(s.branch, async (transaction) => {
        await transaction
          .selectFrom(held.table)
          .select('id')
          .where('id', '=', held.id)
          .forUpdate()
          .execute();
      });
      const waiting = await waitingForALock();
      const one = first().then((response) => response);
      await expect
        .poll(waitingForALock, { timeout: 20_000, interval: 50 })
        .toBeGreaterThan(waiting);
      const two = second().then((response) => response);
      await expect
        .poll(waitingForALock, { timeout: 20_000, interval: 50 })
        .toBeGreaterThan(waiting + 1);
      gate.release();
      expect(await gate.done).toBeUndefined();
      return [await one, await two];
    }

    for (const holder of ['classes', 'staff'] as const) {
      it(`a length change and a ${holder === 'classes' ? 'class archive' : 'staff status change'} in either order: no deadlock`, async () => {
        for (const order of [0, 1]) {
          const s = await scene();
          const id =
            holder === 'classes'
              ? await load.classes.schoolClass(s.branch, s.year, {
                  grade: 8,
                  room: await load.classes.room(s.branch),
                })
              : (await load.teacher(s.branch, { subjects: [{ subject: s.maths, grades: [7] }] }))
                  .staffId;
          const change = () => changeLength(s, 40, OCT19);
          const other = () =>
            holder === 'classes'
              ? post(`/api/classes/${id}/archive`, s.branch)
              : post(`/api/people/staff/${id}/status`, s.branch, {
                  status: 'inactive',
                  from: '2026-11-02',
                });
          const [first, second] =
            order === 0
              ? await inOrder(s, change, other, { table: holder, id })
              : await inOrder(s, other, change, { table: holder, id });
          const [saved, changed] = order === 0 ? [first, second] : [second, first];
          expect(saved.status, JSON.stringify(saved.body)).toBe(200);
          expect(changed.status, JSON.stringify(changed.body)).toBe(200);
          expect(await timesOf(s, OCT19, s.seniorId)).toEqual([['08:50', '09:30', null]]);
        }
      });
    }
  });
});
