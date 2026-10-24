import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  bulkCancelAnswerSchema,
  bulkCancelCheckAnswerSchema,
  dayAnswerSchema,
  type BulkCancelCheckAnswer,
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
import { inOrderOnLesson, workWithTotal } from '../../testing/cells-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells } from '../journal/cells.js';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

/** The ids a refusal lists under its details. */
const listed = (response: Response) =>
  (response.body as { error: { details?: { path: string }[] } }).error.details?.map(
    (one) => one.path.split('.')[1] ?? '',
  ) ?? [];

/** The quarters of the year 2026-09-01 to 2027-05-31, dated. */
const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

/** A moment of a school date at a clock time in Tashkent (+05:00). */
const at = (date: string, time: string): Date => new Date(`${date}T${time}:00+05:00`);

/** The Monday and the Tuesday a week after `MONDAY`. */
const NEXT_MONDAY = '2026-10-19';
const NEXT_TUESDAY = '2026-10-20';
/** The Friday before the clock's Saturday: a past date. */
const YESTERDAY = '2026-10-09';

// All names are invented. Task 5.6a-3, pull request #162: the bulk cancel
// (docs/spec/06-timetable.md, Changes after publishing: "Bulk cancel. For an
// event: chosen classes, date and slots, with a reason."; edge/timetable,
// After publishing: "7 Oxford goes on an excursion, and group 7-M-1 has
// students from 7 Oxford and 7 Princeton. The bulk cancel lists such blocks.
// For each, the Academic Vice Principal chooses: cancel the whole block, or
// keep it and exempt the students of the chosen classes for those slots in
// the same action."). The clock stands at 23:55 on Saturday 10 October 2026
// in Tashkent.
describe('the bulk cancel', () => {
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

  const check = (
    branch: string,
    body: { date: string; classIds: string[]; lessonNumbers: number[] },
    cookie = t.admin,
  ) => t.post('/api/timetable/bulk-cancels/check', branch, body, cookie);

  const checked = async (
    branch: string,
    body: { date: string; classIds: string[]; lessonNumbers: number[] },
  ): Promise<BulkCancelCheckAnswer> => {
    const response = await check(branch, body);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return bulkCancelCheckAnswerSchema.parse(response.body);
  };

  const save = (
    branch: string,
    body: {
      date: string;
      classIds: string[];
      lessonNumbers: number[];
      reason?: string;
      blocks?: { blockId: string; choice: 'keep' | 'cancel' }[];
      lessonIds?: string[];
      dataChoices?: { lessonId: string; choice: 'keep' | 'cancel' }[];
    },
    cookie = t.admin,
    key: string = randomUUID(),
  ) =>
    keyed(
      '/api/timetable/bulk-cancels',
      branch,
      { reason: 'Excursion to the museum', blocks: [], lessonIds: [], ...body },
      cookie,
      key,
    );

  /** The check, then the save with what it listed and `choice` for every shared block. */
  const checkAndSave = async (
    branch: string,
    body: { date: string; classIds: string[]; lessonNumbers: number[] },
    choice: 'keep' | 'cancel' = 'cancel',
  ) => {
    const answer = await checked(branch, body);
    const response = await save(branch, {
      ...body,
      blocks: answer.shared.map((one) => ({ blockId: one.blockId, choice })),
      lessonIds: [
        ...answer.cancel.map((one) => one.lesson.id),
        ...answer.shared.flatMap((one) =>
          choice === 'cancel' ? one.lessons.map((lesson) => lesson.id) : one.chosenOnly,
        ),
      ],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return { check: answer, saved: bulkCancelAnswerSchema.parse(response.body) };
  };

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
    slotPosition: number,
  ) => {
    const placed = await t.post(`/api/timetable/versions/${version}/pattern`, branch, {
      loadRowId,
      weekday,
      slotPosition,
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  };

  async function teacherOf(branch: string, subject: string, grades: number[] = [7]) {
    const teacher = await load.teacher(branch, { subjects: [{ subject, grades }] });
    await hours(branch, teacher.staffId);
    return teacher;
  }

  /**
   * A branch (its own unless given) with a year of four dated quarters, a day
   * of three lessons of 45 minutes from 08:00 (08:00, 08:55, 09:50) on every
   * weekday, the classes 7 Oxford and 7 Princeton, and a version published
   * from Monday 12 October:
   * - on Monday in lesson 1, maths of each class with a teacher of its own;
   * - on Monday in lesson 2, English in three parallel groups, one block:
   *   7-E-1 of both classes, 7-E-2 of 7 Princeton, 7-E-3 of 7 Oxford;
   * - on Tuesday in lessons 2 and 3, physics of 7 Oxford, a double lesson once `pairUp` pairs it;
   * - with `young`, a day of four lessons of 30 minutes (08:00, 08:35,
   *   09:10, 09:45) for grades 1 to 4, and the class 3 Cambridge with
   *   reading on Monday in lessons 2 and 3 and drawing in lesson 4;
   * - with `twoGrades`, the class 8 Yale and art on Thursday in lesson 1 in a
   *   group of 7 Oxford and 8 Yale.
   */
  async function scene(input: { branch?: string; young?: boolean; twoGrades?: boolean } = {}) {
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
    if (input.young === true) {
      const short = await t.createSlotType(branch, 'Short lesson', 'lesson', 30);
      const shortPause = await t.createSlotType(branch, 'Short break', 'break', 5);
      const primary = await t.createTemplate(branch, 'Primary', [
        short,
        shortPause,
        short,
        shortPause,
        short,
        shortPause,
        short,
      ]);
      await t.assign(branch, primary, { level: 'grades', gradeFrom: 1, gradeTo: 4 });
    }
    const maths = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const english = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const physics = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const oxfordRoom = await load.classes.room(branch);
    const princetonRoom = await load.classes.room(branch);
    const oxford = await load.classes.schoolClass(branch, year, {
      grade: 7,
      name: 'Oxford',
      room: oxfordRoom,
    });
    const princeton = await load.classes.schoolClass(branch, year, {
      grade: 7,
      name: 'Princeton',
      room: princetonRoom,
    });
    const oxfordMaths = await teacherOf(branch, maths);
    const princetonMaths = await teacherOf(branch, maths);
    const created = await t.post('/api/timetable/versions', branch, {
      academicYearId: year,
      startsOn: MONDAY,
      copyFrom: null,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const version = (created.body as { id: string }).id;
    for (const [classId, person] of [
      [oxford, oxfordMaths],
      [princeton, princetonMaths],
    ] as const) {
      const row = await load.row({
        branch_id: branch,
        version_id: version,
        class_id: classId,
        subject_id: maths,
        teacher_id: person.staffId,
        lessons_per_week: 1,
      });
      await placeAt(branch, version, row, 1, 1);
    }
    const englishTeachers: { staffId: string; accountId: string }[] = [];
    const groups: string[] = [];
    const englishRows: string[] = [];
    for (const [index, classIds] of [[oxford, princeton], [princeton], [oxford]].entries()) {
      const group = await load.classes.group(branch, year, english, classIds, {
        name: `7-E-${String(index + 1)}`,
      });
      groups.push(group);
      const person = await teacherOf(branch, english);
      englishTeachers.push(person);
      englishRows.push(
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
    await placeAt(branch, version, englishRows[0] ?? '', 1, 3);
    const physicsTeacher = await teacherOf(branch, physics);
    const physicsRow = await load.row({
      branch_id: branch,
      version_id: version,
      class_id: oxford,
      subject_id: physics,
      teacher_id: physicsTeacher.staffId,
      lessons_per_week: 2,
      double_lessons: true,
    });
    await placeAt(branch, version, physicsRow, 2, 3);
    await placeAt(branch, version, physicsRow, 2, 5);
    let young: { classId: string; reading: string; drawing: string } | null = null;
    if (input.young === true) {
      const reading = await load.classes.subject({ grades: [3], journalType: 'attendance_only' });
      const drawing = await load.classes.subject({ grades: [3], journalType: 'attendance_only' });
      const classId = await load.classes.schoolClass(branch, year, {
        grade: 3,
        name: 'Cambridge',
        room: await load.classes.room(branch),
      });
      const readingRow = await load.row({
        branch_id: branch,
        version_id: version,
        class_id: classId,
        subject_id: reading,
        teacher_id: (await teacherOf(branch, reading, [3])).staffId,
        lessons_per_week: 2,
      });
      await placeAt(branch, version, readingRow, 1, 3);
      await placeAt(branch, version, readingRow, 1, 5);
      const drawingRow = await load.row({
        branch_id: branch,
        version_id: version,
        class_id: classId,
        subject_id: drawing,
        teacher_id: (await teacherOf(branch, drawing, [3])).staffId,
        lessons_per_week: 1,
      });
      await placeAt(branch, version, drawingRow, 1, 7);
      young = { classId, reading, drawing };
    }
    let twoGrades: { yale: string; art: string } | null = null;
    if (input.twoGrades === true) {
      const art = await load.classes.subject({ grades: [7, 8], journalType: 'attendance_only' });
      const yale = await load.classes.schoolClass(branch, year, { grade: 8, name: 'Yale' });
      const group = await load.classes.group(branch, year, art, [oxford, yale], { name: '78-A' });
      const artRow = await load.row({
        branch_id: branch,
        version_id: version,
        group_id: group,
        subject_id: art,
        teacher_id: (await teacherOf(branch, art, [7, 8])).staffId,
        lessons_per_week: 1,
      });
      await placeAt(branch, version, artRow, 4, 1);
      twoGrades = { yale, art };
    }
    const confirmed = await t.post(`/api/timetable/versions/${version}/templates/confirm`, branch);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    await load.freeEditLock(version);
    const published = await publish(branch, version, MONDAY);
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    return {
      branch,
      year,
      version,
      maths,
      english,
      physics,
      oxford,
      princeton,
      oxfordMaths,
      princetonMaths,
      englishTeachers,
      groups,
      physicsTeacher,
      young,
      twoGrades,
    };
  }

  type Scene = Awaited<ReturnType<typeof scene>>;

  const lessonsOf = (branch: string, date: string) =>
    t.database.migrator
      .selectFrom('lessons')
      .selectAll()
      .where('branch_id', '=', branch)
      .where('lesson_date', '=', date)
      .orderBy('starts_at')
      .orderBy('id')
      .execute();

  /** The stored lessons of a class (or group) and subject on a date, by start. */
  const lessonOf = async (
    s: Scene,
    date: string,
    unit: { classId?: string; groupId?: string },
    subject: string,
  ) =>
    (await lessonsOf(s.branch, date)).filter(
      (one) =>
        one.subject_id === subject &&
        (unit.classId === undefined || one.class_id === unit.classId) &&
        (unit.groupId === undefined || one.group_id === unit.groupId),
    );

  const oneLesson = async (
    s: Scene,
    date: string,
    unit: { classId?: string; groupId?: string },
    subject: string,
  ) => {
    const [found] = await lessonOf(s, date, unit, subject);
    if (found === undefined) throw new Error('No such lesson.');
    return found;
  };

  /** The two physics lessons of 7 Oxford on a Tuesday, made one double pair by the migrator. */
  const pairUp = async (s: Scene, date: string) => {
    const halves = await lessonOf(s, date, { classId: s.oxford }, s.physics);
    expect(halves).toHaveLength(2);
    await t.database.migrator
      .updateTable('lesson_blocks')
      .set({ double_pair_id: randomUUID() })
      .where(
        'id',
        'in',
        halves.map((one) => one.block_id),
      )
      .execute();
    return halves;
  };

  const rowOf = (id: string) =>
    t.database.migrator.selectFrom('lessons').selectAll().where('id', '=', id).executeTakeFirst();

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

  /** Every row of the tables a bulk cancel writes, and the log. */
  const everything = () =>
    Promise.all([
      t.database.migrator.selectFrom('lessons').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('time_claims').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('lesson_changes').selectAll().orderBy('lesson_id').execute(),
      t.database.migrator.selectFrom('bulk_cancels').selectAll().orderBy('id').execute(),
      t.database.migrator
        .selectFrom('bulk_cancel_classes')
        .selectAll()
        .orderBy('bulk_cancel_id')
        .orderBy('class_id')
        .execute(),
      t.database.migrator
        .selectFrom('bulk_cancel_spans')
        .selectAll()
        .orderBy('bulk_cancel_id')
        .orderBy('class_id')
        .orderBy('lesson_number')
        .execute(),
      t.database.migrator
        .selectFrom('bulk_cancel_blocks')
        .selectAll()
        .orderBy('bulk_cancel_id')
        .orderBy('block_id')
        .execute(),
      t.database.migrator.selectFrom('notifications').select('id').orderBy('id').execute(),
      sql<{ id: string }>`select id from pgboss.job order by id`
        .execute(t.database.migrator)
        .then((result) => result.rows),
      t.database.migrator.selectFrom('audit_log').select('id').orderBy('id').execute(),
      // Task 5.6a-5b-2 (permission review must-fix 3): every other table a
      // withdraw writes.
      t.database.migrator.selectFrom('lesson_blocks').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('lesson_day_changes').selectAll().orderBy('id').execute(),
      t.database.migrator
        .selectFrom('lesson_day_change_ends')
        .selectAll()
        .orderBy('change_id')
        .execute(),
      t.database.migrator.selectFrom('timetable_versions').selectAll().orderBy('id').execute(),
      t.database.migrator
        .selectFrom('timetable_version_out_of_date_causes')
        .selectAll()
        .orderBy('id')
        .execute(),
      t.database.migrator.selectFrom('journals').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('request_keys').selectAll().orderBy('key').execute(),
    ]);

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    northScene = await scene({ branch: t.north });
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the 7 Oxford row', () => {
    it('cancels 7 Oxford’s lessons and the shared block whole when “cancel” is chosen, notifies each teacher once and writes the log', async () => {
      const s = await scene();
      const body = { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [1, 2] };
      const maths = await oneLesson(s, NEXT_MONDAY, { classId: s.oxford }, s.maths);
      const english = (await lessonsOf(s.branch, NEXT_MONDAY)).filter(
        (one) => one.subject_id === s.english,
      );
      expect(english).toHaveLength(3);
      expect(new Set(english.map((one) => one.block_id)).size).toBe(1);
      const princetonMaths = await oneLesson(s, NEXT_MONDAY, { classId: s.princeton }, s.maths);

      // The check writes nothing (decision 12).
      const untouched = await everything();
      const answer = await checked(s.branch, body);
      expect(await everything()).toEqual(untouched);
      expect(answer.cancel.map((one) => one.lesson.id)).toEqual([maths.id]);
      expect(answer.shared).toHaveLength(1);
      const [shared] = answer.shared;
      expect(shared?.blockId).toBe(english[0]?.block_id);
      expect(shared?.pairBlockId).toBeNull();
      expect(shared?.otherClasses.map((one) => one.id)).toEqual([s.princeton]);
      expect(shared?.chosenClasses.map((one) => one.name)).toEqual(['7 Oxford']);
      const third = english.find((one) => one.group_id === s.groups[2]);
      expect(shared?.chosenOnly).toEqual([third?.id]);

      const response = await save(s.branch, {
        ...body,
        reason: '  Excursion to the museum  ',
        blocks: [{ blockId: shared?.blockId ?? '', choice: 'cancel' }],
        lessonIds: [maths.id, ...english.map((one) => one.id)],
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const saved = bulkCancelAnswerSchema.parse(response.body);
      expect([...saved.cancelled].sort()).toEqual(
        [maths.id, ...english.map((one) => one.id)].sort(),
      );
      expect(saved.kept).toEqual([]);
      for (const id of [maths.id, ...english.map((one) => one.id)]) {
        expect(await rowOf(id)).toMatchObject({
          cancel_cause: 'reason',
          cancel_reason: 'Excursion to the museum',
        });
        expect(await markOf(id)).toEqual(t.clock.now());
      }
      expect((await rowOf(princetonMaths.id))?.cancel_cause).toBeNull();
      const blocks = await t.database.migrator
        .selectFrom('bulk_cancel_blocks')
        .selectAll()
        .where('bulk_cancel_id', '=', saved.id)
        .execute();
      expect(blocks).toMatchObject([{ block_id: shared?.blockId, choice: 'cancel' }]);
      // One notice for each teacher whose week changed, none for 7 Princeton's maths teacher.
      for (const person of [s.oxfordMaths, ...s.englishTeachers]) {
        const notices = await noticesOf(person.accountId);
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({
          data: { weekStart: NEXT_MONDAY, after: [{ date: NEXT_MONDAY, cancelled: true }] },
        });
      }
      expect(await noticesOf(s.princetonMaths.accountId)).toEqual([]);
      const [entry] = await t.entries('lesson.bulk_cancel', saved.id);
      expect(entry).toMatchObject({
        branch_id: s.branch,
        new_value: {
          date: NEXT_MONDAY,
          classIds: [s.oxford],
          lessonNumbers: [1, 2],
          reason: 'Excursion to the museum',
          blocks: [{ blockIds: [shared?.blockId], choice: 'cancel' }],
          notices: { notified: 4, marked: 4 },
        },
      });
    });

    it('keeps the shared block when “keep” is chosen: only the part of 7 Oxford alone is cancelled, the spans of 7 Oxford are stored, the claims stay', async () => {
      const s = await scene();
      const body = { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [1, 2] };
      const english = (await lessonsOf(s.branch, NEXT_MONDAY)).filter(
        (one) => one.subject_id === s.english,
      );
      const blockId = english[0]?.block_id ?? '';
      const claimsBefore = await t.database.migrator
        .selectFrom('time_claims')
        .select('class_id')
        .where('kind', '=', 'block_class')
        .where('block_id', '=', blockId)
        .orderBy('class_id')
        .execute();
      expect(claimsBefore.map((one) => one.class_id).sort()).toEqual(
        [s.oxford, s.princeton].sort(),
      );
      const { saved } = await checkAndSave(s.branch, body, 'keep');
      const third = english.find((one) => one.group_id === s.groups[2]);
      expect(saved.kept).toEqual([blockId]);
      for (const one of english) {
        expect((await rowOf(one.id))?.cancel_cause).toBe(one.id === third?.id ? 'reason' : null);
      }
      // 7-E-1 and 7-E-2 are held, so both classes stay claimed (decision 6).
      const claimsAfter = await t.database.migrator
        .selectFrom('time_claims')
        .select('class_id')
        .where('kind', '=', 'block_class')
        .where('block_id', '=', blockId)
        .execute();
      expect(claimsAfter.map((one) => one.class_id).sort()).toEqual([s.oxford, s.princeton].sort());
      expect(
        await t.database.migrator
          .selectFrom('bulk_cancel_blocks')
          .select(['block_id', 'choice'])
          .where('bulk_cancel_id', '=', saved.id)
          .execute(),
      ).toEqual([{ block_id: blockId, choice: 'keep' }]);
      const spans = await t.database.migrator
        .selectFrom('bulk_cancel_spans')
        .select(['class_id', 'lesson_number', 'starts_at', 'ends_at'])
        .where('bulk_cancel_id', '=', saved.id)
        .orderBy('lesson_number')
        .execute();
      expect(spans).toEqual([
        {
          class_id: s.oxford,
          lesson_number: 1,
          starts_at: at(NEXT_MONDAY, '08:00'),
          ends_at: at(NEXT_MONDAY, '08:45'),
        },
        {
          class_id: s.oxford,
          lesson_number: 2,
          starts_at: at(NEXT_MONDAY, '08:55'),
          ends_at: at(NEXT_MONDAY, '09:40'),
        },
      ]);
      // The teachers of the held parts get no notice; the teacher of 7-E-3 one.
      expect(await noticesOf(s.englishTeachers[0]?.accountId ?? '')).toEqual([]);
      expect(await noticesOf(s.englishTeachers[1]?.accountId ?? '')).toEqual([]);
      expect(await noticesOf(s.englishTeachers[2]?.accountId ?? '')).toHaveLength(1);
    });

    it('exempts the students of the chosen class in the kept lessons and tells their teacher (task 8.5, From 5.6a-3)', async () => {
      const s = await scene();
      const members = new MembersKit(t.database.migrator, await load.classes.account());
      const placed: Record<string, string> = {};
      for (const [name, classId] of [
        ['oxford', s.oxford],
        ['princeton', s.princeton],
      ] as const) {
        const studentId = await members.student(s.branch, { startsOn: '2026-09-01' });
        await t.database.migrator.transaction().execute(async (transaction) => {
          await members.member(
            { branch: s.branch, classId, studentId, from: '2026-09-01' },
            transaction,
          );
          await members.groupMember(
            {
              branch: s.branch,
              groupId: s.groups[0] ?? '',
              subjectId: s.english,
              studentId,
              from: '2026-09-01',
            },
            transaction,
          );
        });
        placed[name] = studentId;
      }
      const body = { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [1, 2] };
      await checkAndSave(s.branch, body, 'keep');
      const kept = (await lessonsOf(s.branch, NEXT_MONDAY)).find(
        (one) => one.subject_id === s.english && one.group_id === s.groups[0],
      );
      const expected = await sql<{ oxford: boolean; princeton: boolean }>`
        select lesson_student_expected(${kept?.id ?? ''}::uuid, ${placed.oxford ?? ''}::uuid) as oxford,
          lesson_student_expected(${kept?.id ?? ''}::uuid, ${placed.princeton ?? ''}::uuid) as princeton
      `.execute(t.database.migrator);
      expect(expected.rows[0]).toEqual({ oxford: false, princeton: true });
      const told = await t.database.migrator
        .selectFrom('notifications')
        .select('data')
        .where('account_id', '=', s.englishTeachers[0]?.accountId ?? '')
        .where('kind', '=', 'journal.exemption_kept_block')
        .execute();
      expect(told).toHaveLength(1);
      expect(told[0]?.data).toMatchObject({ date: NEXT_MONDAY });
    });

    it('refuses a shared block without a choice, and a choice for a block that is not shared', async () => {
      const s = northScene;
      const body = { date: '2026-10-26', classIds: [s.oxford], lessonNumbers: [2] };
      const answer = await checked(s.branch, body);
      const blockId = answer.shared[0]?.blockId ?? '';
      // A block of the branch outside the slots: not shared in this bulk cancel.
      const maths = await oneLesson(s, '2026-10-26', { classId: s.oxford }, s.maths);
      const before = await everything();
      const missing = await save(s.branch, { ...body, lessonIds: [] });
      refusedWith(missing, 409, 'bulk_choice_missing');
      expect(listed(missing)).toEqual([blockId]);
      const unknown = await save(s.branch, {
        ...body,
        blocks: [
          { blockId, choice: 'cancel' },
          { blockId: maths.block_id, choice: 'keep' },
        ],
      });
      refusedWith(unknown, 409, 'bulk_choice_unknown');
      expect(listed(unknown)).toEqual([maths.block_id]);
      expect(await everything()).toEqual(before);
    });

    it('cancels a block whose classes are all chosen whole, with no choice asked, and refuses a choice for it', async () => {
      const s = await scene();
      const body = { date: NEXT_MONDAY, classIds: [s.oxford, s.princeton], lessonNumbers: [2] };
      const answer = await checked(s.branch, body);
      expect(answer.shared).toEqual([]);
      const english = (await lessonsOf(s.branch, NEXT_MONDAY)).filter(
        (one) => one.subject_id === s.english,
      );
      expect(answer.cancel.map((one) => one.lesson.id).sort()).toEqual(
        english.map((one) => one.id).sort(),
      );
      refusedWith(
        await save(s.branch, {
          ...body,
          blocks: [{ blockId: english[0]?.block_id ?? '', choice: 'keep' }],
          lessonIds: english.map((one) => one.id),
        }),
        409,
        'bulk_choice_unknown',
      );
      const { saved } = await checkAndSave(s.branch, body);
      expect([...saved.cancelled].sort()).toEqual(english.map((one) => one.id).sort());
      expect(
        await t.database.migrator
          .selectFrom('bulk_cancel_blocks')
          .select('block_id')
          .where('bulk_cancel_id', '=', saved.id)
          .execute(),
      ).toEqual([]);
    });
  });

  describe('a group of two grades', () => {
    it('lists a group of a chosen grade-7 class and a grade-8 class not chosen as shared, and not when both are chosen', async () => {
      const s = await scene({ twoGrades: true });
      const two = s.twoGrades;
      if (two === null) throw new Error('No group of two grades.');
      const art = await oneLesson(s, '2026-10-22', {}, two.art);
      const answer = await checked(s.branch, {
        date: '2026-10-22',
        classIds: [s.oxford],
        lessonNumbers: [1],
      });
      expect(answer.cancel).toEqual([]);
      expect(answer.shared).toHaveLength(1);
      expect(answer.shared[0]).toMatchObject({
        blockId: art.block_id,
        chosenClasses: [{ id: s.oxford, name: '7 Oxford' }],
        otherClasses: [{ id: two.yale, name: '8 Yale' }],
        chosenOnly: [],
      });
      const both = await checked(s.branch, {
        date: '2026-10-22',
        classIds: [s.oxford, two.yale],
        lessonNumbers: [1],
      });
      expect(both.shared).toEqual([]);
      expect(both.cancel.map((one) => one.lesson.id)).toEqual([art.id]);
    });
  });

  describe('the slots', () => {
    it('reads each class’s slots from its own day by clock time, and skips a number its day lacks (decision 2)', async () => {
      const s = await scene({ young: true });
      const young = s.young;
      if (young === null) throw new Error('No young class.');
      const reading = await lessonOf(s, NEXT_MONDAY, { classId: young.classId }, young.reading);
      expect(reading).toHaveLength(2);
      // Lesson 2 of the primary day is 08:35–09:05; the 45-minute lesson 2
      // (08:55–09:40) would also meet reading in lesson 3 (09:10–09:40).
      const { saved } = await checkAndSave(s.branch, {
        date: NEXT_MONDAY,
        classIds: [young.classId],
        lessonNumbers: [2],
      });
      expect(saved.cancelled).toEqual([reading[0]?.id]);
      expect((await rowOf(reading[1]?.id ?? ''))?.cancel_cause).toBeNull();
      // Lesson 4 is only in the primary day: 3 Cambridge’s drawing goes, 7 Oxford has no span.
      const drawing = await oneLesson(s, NEXT_MONDAY, { classId: young.classId }, young.drawing);
      const second = await checkAndSave(s.branch, {
        date: NEXT_MONDAY,
        classIds: [young.classId, s.oxford],
        lessonNumbers: [4],
      });
      expect(second.saved.cancelled).toEqual([drawing.id]);
      const spans = await t.database.migrator
        .selectFrom('bulk_cancel_spans')
        .select(['class_id', 'starts_at'])
        .where('bulk_cancel_id', '=', second.saved.id)
        .execute();
      expect(spans).toEqual([{ class_id: young.classId, starts_at: at(NEXT_MONDAY, '09:45') }]);
      const classes = await t.database.migrator
        .selectFrom('bulk_cancel_classes')
        .select('class_id')
        .where('bulk_cancel_id', '=', second.saved.id)
        .execute();
      expect(classes.map((one) => one.class_id).sort()).toEqual([young.classId, s.oxford].sort());
    });

    it('answers on the day of every class the longest day of the branch’s classes, the lesson numbers the bulk cancel offers (review must-fix 1)', async () => {
      const s = await scene({ young: true });
      const young = s.young;
      if (young === null) throw new Error('No young class.');
      const dayOf = async (classId: string) => {
        const response = await t.get(
          `/api/timetable/day?date=${NEXT_MONDAY}&classId=${classId}`,
          s.branch,
          t.admin,
        );
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        return dayAnswerSchema.parse(response.body);
      };
      const oxford = await dayOf(s.oxford);
      const cambridge = await dayOf(young.classId);
      const numbers = (day: typeof oxford) => day.slots.map((one) => one.lessonNumber);
      const longest = Math.max(...numbers(oxford), ...numbers(cambridge));
      // The two days differ, and each class's page offers the longer one.
      expect(numbers(oxford)).not.toEqual(numbers(cambridge));
      expect(oxford.longestDay).toBe(longest);
      expect(cambridge.longestDay).toBe(longest);
      // The last number of the longer day cancels that day's lesson for every class chosen.
      const { saved } = await checkAndSave(s.branch, {
        date: NEXT_MONDAY,
        classIds: [s.oxford, young.classId],
        lessonNumbers: [longest],
      });
      expect(saved.cancelled.length).toBeGreaterThan(0);
    });

    it('answers a longest day of 0 on a day without lessons', async () => {
      const s = await scene();
      const response = await t.get(
        `/api/timetable/day?date=2026-10-11&classId=${s.oxford}`,
        s.branch,
        t.admin,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(dayAnswerSchema.parse(response.body)).toMatchObject({ slots: [], longestDay: 0 });
    });

    it('cancels the lessons of every class chosen, as for the whole branch from a chosen slot', async () => {
      const s = await scene();
      const all = (await lessonsOf(s.branch, NEXT_MONDAY)).filter(
        (one) => one.cancel_cause === null,
      );
      const { check: answer, saved } = await checkAndSave(s.branch, {
        date: NEXT_MONDAY,
        classIds: [s.oxford, s.princeton],
        lessonNumbers: [1, 2, 3],
      });
      expect(answer.shared).toEqual([]);
      expect([...saved.cancelled].sort()).toEqual(all.map((one) => one.id).sort());
    });
  });

  describe('double lessons', () => {
    it('brings in the other half of a double lesson outside the slots (decision 4)', async () => {
      const s = await scene();
      const halves = await pairUp(s, NEXT_TUESDAY);
      const { check: answer, saved } = await checkAndSave(s.branch, {
        date: NEXT_TUESDAY,
        classIds: [s.oxford],
        lessonNumbers: [3],
      });
      expect(answer.cancel.map((one) => [one.lesson.id, one.broughtIn])).toEqual([
        [halves[0]?.id, true],
        [halves[1]?.id, false],
      ]);
      expect([...saved.cancelled].sort()).toEqual(halves.map((one) => one.id).sort());
      expect(await noticesOf(s.physicsTeacher.accountId)).toHaveLength(1);
    });

    /**
     * The English block of a scene copied by the migrator to lesson 3 of the
     * same Monday, the two made one double pair; with `cause`, the copy's
     * lessons cancelled by it.
     */
    async function englishDouble(s: Scene, cause: 'day_off' | null = null) {
      const english = (await lessonsOf(s.branch, NEXT_MONDAY)).filter(
        (one) => one.subject_id === s.english,
      );
      const blockId = english[0]?.block_id ?? '';
      const block = await t.database.migrator
        .selectFrom('lesson_blocks')
        .selectAll()
        .where('id', '=', blockId)
        .executeTakeFirstOrThrow();
      const pair = randomUUID();
      await t.database.migrator
        .updateTable('lesson_blocks')
        .set({ double_pair_id: pair })
        .where('id', '=', blockId)
        .execute();
      const made = await t.database.migrator
        .insertInto('lesson_blocks')
        .values({
          branch_id: s.branch,
          academic_year_id: block.academic_year_id,
          quarter_id: block.quarter_id,
          lesson_date: NEXT_MONDAY,
          starts_at: at(NEXT_MONDAY, '09:50'),
          ends_at: at(NEXT_MONDAY, '10:35'),
          version_id: block.version_id,
          pattern_block_id: block.pattern_block_id,
          double_pair_id: pair,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      const later: { id: string; group_id: string | null }[] = [];
      for (const one of english) {
        later.push(
          await t.database.migrator
            .insertInto('lessons')
            .values({
              branch_id: s.branch,
              block_id: made.id,
              lesson_date: made.lesson_date,
              starts_at: made.starts_at,
              ends_at: made.ends_at,
              group_id: one.group_id,
              subject_id: one.subject_id,
              load_row_id: one.load_row_id,
              pattern_entry_id: one.pattern_entry_id,
              teacher_id: one.teacher_id,
              room_id: one.room_id,
              cancel_cause: cause,
            })
            .returning(['id', 'group_id'])
            .executeTakeFirstOrThrow(),
        );
      }
      return { blockId, made, english, later };
    }

    it('keeps both blocks of a shared double lesson with one choice, cancelling 7 Oxford’s part in each (decisions 4 and 5)', async () => {
      const s = await scene();
      // The English block copied to lesson 3 of the same Monday, the two made one double pair.
      const { blockId, made, english, later } = await englishDouble(s);
      const { check: answer, saved } = await checkAndSave(
        s.branch,
        { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [2] },
        'keep',
      );
      expect(answer.shared).toHaveLength(1);
      expect(answer.shared[0]).toMatchObject({ blockId, pairBlockId: made.id });
      expect(saved.kept).toEqual([blockId, made.id]);
      const third = [...english, ...later].filter((one) => one.group_id === s.groups[2]);
      expect([...saved.cancelled].sort()).toEqual(third.map((one) => one.id).sort());
      for (const one of [...english, ...later]) {
        expect((await rowOf(one.id))?.cancel_cause).toBe(
          one.group_id === s.groups[2] ? 'reason' : null,
        );
      }
      const rows = await t.database.migrator
        .selectFrom('bulk_cancel_blocks')
        .select(['block_id', 'choice'])
        .where('bulk_cancel_id', '=', saved.id)
        .orderBy('starts_at')
        .execute();
      expect(rows).toEqual([
        { block_id: blockId, choice: 'keep' },
        { block_id: made.id, choice: 'keep' },
      ]);
    });

    it('brings in no half of a double whose lessons are all cancelled already, and keeps the shared block alone (spec review must-fix 1)', async () => {
      const s = await scene();
      const { blockId, later } = await englishDouble(s, 'day_off');
      const { check: answer, saved } = await checkAndSave(
        s.branch,
        { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [2] },
        'keep',
      );
      expect(answer.shared).toHaveLength(1);
      expect(answer.shared[0]).toMatchObject({ blockId, pairBlockId: null });
      expect(saved.kept).toEqual([blockId]);
      for (const one of later) {
        expect(await rowOf(one.id)).toMatchObject({ cancel_cause: 'day_off', cancel_reason: null });
      }
    });

    it('cancels the lessons of a past date in the slots, and holds a half outside them that has started (review correction 1)', async () => {
      const s = await scene();
      // The template from the start of the year, and the Tuesday double copied to yesterday.
      // The fixture moves the dated rows back, past the guard that they only shrink.
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
      const halves = await pairUp(s, NEXT_TUESDAY);
      const pair = randomUUID();
      const copied: string[] = [];
      for (const half of halves) {
        const block = await t.database.migrator
          .selectFrom('lesson_blocks')
          .selectAll()
          .where('id', '=', half.block_id)
          .executeTakeFirstOrThrow();
        const shift = (moment: Date) => new Date(moment.getTime() - 11 * 24 * 60 * 60_000);
        const made = await t.database.migrator
          .insertInto('lesson_blocks')
          .values({
            branch_id: s.branch,
            academic_year_id: block.academic_year_id,
            quarter_id: block.quarter_id,
            lesson_date: YESTERDAY,
            starts_at: shift(block.starts_at),
            ends_at: shift(block.ends_at),
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
            class_id: half.class_id,
            subject_id: half.subject_id,
            load_row_id: half.load_row_id,
            pattern_entry_id: half.pattern_entry_id,
            teacher_id: half.teacher_id,
            room_id: half.room_id,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        copied.push(lesson.id);
      }
      // Task 6.1b-2 (plan test 21): the half held outside the slots holds data
      // and is not listed with the lessons with data.
      await workWithTotal(t.database.migrator, { branchId: s.branch, lessonId: copied[0] ?? '' });
      const { check: answer, saved } = await checkAndSave(s.branch, {
        date: YESTERDAY,
        classIds: [s.oxford],
        lessonNumbers: [3],
      });
      expect(answer.withData).toEqual([]);
      expect(answer.cancel.map((one) => one.lesson.id)).toEqual([copied[1]]);
      // Listed as started: no single cancel is offered for it.
      expect(answer.cancel[0]?.lesson.canCancel).toBe(false);
      expect(answer.held.map((one) => one.id)).toEqual([copied[0]]);
      expect(saved.cancelled).toEqual([copied[1]]);
      expect((await rowOf(copied[0] ?? ''))?.cancel_cause).toBeNull();
      expect((await rowOf(copied[1] ?? ''))?.cancel_cause).toBe('reason');
    });
  });

  describe('lessons already cancelled and the restore', () => {
    it('leaves a lesson already cancelled with its own cause and reason, and a cancelled lesson restores alone', async () => {
      const s = await scene();
      const maths = await oneLesson(s, NEXT_MONDAY, { classId: s.oxford }, s.maths);
      const cancelled = await keyed(
        `/api/timetable/lessons/${maths.id}/cancel`,
        s.branch,
        { reason: 'The teacher is at a seminar' },
        t.admin,
        randomUUID(),
      );
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      const physics = await pairUp(s, NEXT_TUESDAY);
      // 7 Princeton's maths cancelled by a day off, as a calendar change writes it.
      const princeton = await oneLesson(s, NEXT_MONDAY, { classId: s.princeton }, s.maths);
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'day_off' })
        .where('id', '=', princeton.id)
        .execute();
      // Nothing left to cancel in lesson 1: the check refuses too.
      refusedWith(
        await check(s.branch, {
          date: NEXT_MONDAY,
          classIds: [s.oxford, s.princeton],
          lessonNumbers: [1],
        }),
        409,
        'bulk_cancel_empty',
      );
      const answer = await checked(s.branch, {
        date: NEXT_MONDAY,
        classIds: [s.oxford, s.princeton],
        lessonNumbers: [1, 2],
      });
      expect(answer.alreadyCancelled.map((one) => one.id).sort()).toEqual(
        [maths.id, princeton.id].sort(),
      );
      expect(answer.cancel.map((one) => one.lesson.id)).not.toContain(maths.id);
      const both = await checkAndSave(s.branch, {
        date: NEXT_MONDAY,
        classIds: [s.oxford, s.princeton],
        lessonNumbers: [1, 2],
      });
      expect(both.saved.cancelled).not.toContain(princeton.id);
      expect(await rowOf(princeton.id)).toMatchObject({
        cancel_cause: 'day_off',
        cancel_reason: null,
      });
      refusedWith(
        await save(s.branch, { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [1] }),
        409,
        'bulk_cancel_empty',
      );
      expect(await rowOf(maths.id)).toMatchObject({
        cancel_cause: 'reason',
        cancel_reason: 'The teacher is at a seminar',
      });
      const { saved } = await checkAndSave(s.branch, {
        date: NEXT_TUESDAY,
        classIds: [s.oxford],
        lessonNumbers: [2, 3],
      });
      expect([...saved.cancelled].sort()).toEqual(physics.map((one) => one.id).sort());
      const restored = await keyed(
        `/api/timetable/lessons/${physics[0]?.id ?? ''}/restore`,
        s.branch,
        {},
        t.admin,
        randomUUID(),
      );
      expect(restored.status, JSON.stringify(restored.body)).toBe(200);
      for (const one of physics) expect((await rowOf(one.id))?.cancel_cause).toBeNull();
    });
  });

  // Task 6.1b-2 (decision 4; the From line of 5.6a-3): edge/time-dates-calendar,
  // "The school closes at 11:00 today …": "For a lesson that already has data,
  // the Academic Vice Principal chooses 'keep as held' or 'cancel'." The
  // database takes data on a lesson to come, so the fixtures mark next week's
  // lessons; a group lesson holds data through a work with a total.
  describe('lessons that hold data (task 6.1b-2)', () => {
    type Choices = Readonly<Record<string, 'keep' | 'cancel'>>;

    /** The requests of this test database waiting on a lock. */
    async function waiting(): Promise<number> {
      const found = await sql<{ n: number }>`
        select count(distinct l.pid)::int as n
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and not l.granted
      `.execute(t.database.migrator);
      return found.rows[0]?.n ?? 0;
    }

    /** A member of 7 Oxford from 1 September, in 7-E-3 for English as a member of 7 Oxford must be. */
    const oxfordStudent = async (s: Scene) => {
      const members = new MembersKit(t.database.migrator, await load.classes.account());
      const studentId = await members.student(s.branch, { startsOn: '2026-09-01' });
      await t.database.migrator.transaction().execute(async (transaction) => {
        await members.member(
          { branch: s.branch, classId: s.oxford, studentId, from: '2026-09-01' },
          transaction,
        );
        await members.groupMember(
          {
            branch: s.branch,
            groupId: s.groups[2] ?? '',
            subjectId: s.english,
            studentId,
            from: '2026-09-01',
          },
          transaction,
        );
      });
      return studentId;
    };

    /** A mark of a new member of 7 Oxford on a lesson of 7 Oxford, saved through `saveCells`. */
    const markOn = async (s: Scene, lessonId: string) => {
      const studentId = await oxfordStudent(s);
      const account = await load.classes.account();
      await t.app
        .get(Transactions)
        .run([s.branch], (transaction) =>
          saveCells(transaction, t.app.get(Audit), { accountId: account }, [
            { lessonId, studentId, workId: null, value: 1, version: null },
          ]),
        );
      return studentId;
    };

    const totalOn = (s: Scene, lessonId: string) =>
      workWithTotal(t.database.migrator, { branchId: s.branch, lessonId });

    const cellsOf = (lessonIds: readonly string[]) =>
      t.database.migrator
        .selectFrom('journal_cells')
        .selectAll()
        .where('lesson_id', 'in', [...lessonIds])
        .orderBy('id')
        .execute();

    /** The save of a check with a block choice and the data choices, `lessonIds` as the dialog sends them. */
    const saveWith = (
      s: Scene,
      body: { date: string; classIds: string[]; lessonNumbers: number[] },
      answer: BulkCancelCheckAnswer,
      blockChoice: 'keep' | 'cancel',
      choices: Choices,
      key: string = randomUUID(),
    ) => {
      const kept = new Set<string>();
      for (const one of answer.withData) {
        if (choices[one.lessonId] !== 'keep') continue;
        kept.add(one.lessonId);
        for (const id of one.pairLessonIds) kept.add(id);
      }
      const lessonIds = [
        ...answer.cancel.map((one) => one.lesson.id),
        ...answer.shared.flatMap((one) =>
          blockChoice === 'cancel' ? one.lessons.map((lesson) => lesson.id) : one.chosenOnly,
        ),
      ].filter((id) => !kept.has(id));
      return save(
        s.branch,
        {
          ...body,
          blocks: answer.shared.map((one) => ({ blockId: one.blockId, choice: blockChoice })),
          lessonIds,
          dataChoices: Object.entries(choices).map(([lessonId, choice]) => ({ lessonId, choice })),
        },
        t.admin,
        key,
      );
    };

    /** Everything a bulk cancel writes, the cells and works included. */
    const all = async () => [
      await everything(),
      await t.database.migrator.selectFrom('journal_cells').selectAll().orderBy('id').execute(),
      await t.database.migrator.selectFrom('journal_works').selectAll().orderBy('id').execute(),
    ];

    it('lists each lesson with data the save could cancel, with what it holds, its shared block and the other half of its double', async () => {
      const s = await scene();
      const maths = await oneLesson(s, NEXT_MONDAY, { classId: s.oxford }, s.maths);
      const [shared, , alone] = await Promise.all(
        s.groups.map((group) => oneLesson(s, NEXT_MONDAY, { groupId: group }, s.english)),
      );
      if (shared === undefined || alone === undefined) throw new Error('No English lesson.');
      await markOn(s, maths.id);
      await markOn(s, maths.id);
      await totalOn(s, shared.id);
      await totalOn(s, alone.id);
      const answer = await checked(s.branch, {
        date: NEXT_MONDAY,
        classIds: [s.oxford],
        lessonNumbers: [1, 2, 3],
      });
      const blockId = answer.shared[0]?.blockId ?? null;
      expect([...answer.withData].sort((a, b) => a.lessonId.localeCompare(b.lessonId))).toEqual(
        [
          {
            lessonId: maths.id,
            heldData: { attendance: 2, scores: 0, totals: 0, notHeld: 0 },
            pairLessonIds: [],
            sharedBlockId: null,
          },
          {
            lessonId: shared.id,
            heldData: { attendance: 0, scores: 0, totals: 1, notHeld: 0 },
            pairLessonIds: [],
            sharedBlockId: blockId,
          },
          {
            lessonId: alone.id,
            heldData: { attendance: 0, scores: 0, totals: 1, notHeld: 0 },
            pairLessonIds: [],
            sharedBlockId: blockId,
          },
        ].sort((a, b) => a.lessonId.localeCompare(b.lessonId)),
      );
      // The other half of a double takes its choice.
      const halves = await pairUp(s, NEXT_TUESDAY);
      await markOn(s, halves[0]?.id ?? '');
      const tuesday = await checked(s.branch, {
        date: NEXT_TUESDAY,
        classIds: [s.oxford],
        lessonNumbers: [1, 2, 3],
      });
      expect(tuesday.withData).toEqual([
        expect.objectContaining({
          lessonId: halves[0]?.id,
          pairLessonIds: [halves[1]?.id],
          sharedBlockId: null,
        }),
      ]);
      // A lesson with data already cancelled keeps its cause and is not listed.
      const later = await oneLesson(s, '2026-10-26', { classId: s.oxford }, s.maths);
      await totalOn(s, later.id);
      await t.database.migrator
        .updateTable('lessons')
        .set({ cancel_cause: 'reason', cancel_reason: 'Rain' })
        .where('id', '=', later.id)
        .execute();
      const already = await checked(s.branch, {
        date: '2026-10-26',
        classIds: [s.oxford],
        // Slot 2 brings a lesson to cancel; a scope with none is refused.
        lessonNumbers: [1, 2],
      });
      expect(already.alreadyCancelled.map((one) => one.id)).toEqual([later.id]);
      expect(already.withData).toEqual([]);
    });

    it('refuses a missing, an unknown, a conflicting and a split choice, each with its ids, and nothing changes', async () => {
      const s = await scene();
      const body = { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [1, 2, 3] };
      const maths = await oneLesson(s, NEXT_MONDAY, { classId: s.oxford }, s.maths);
      const princeton = await oneLesson(s, NEXT_MONDAY, { classId: s.princeton }, s.maths);
      const alone = await oneLesson(s, NEXT_MONDAY, { groupId: s.groups[2] ?? '' }, s.english);
      await markOn(s, maths.id);
      await totalOn(s, alone.id);
      const answer = await checked(s.branch, body);
      const before = await all();
      const missing = await saveWith(s, body, answer, 'keep', { [alone.id]: 'cancel' });
      refusedWith(missing, 409, 'bulk_data_choice_missing');
      expect(listed(missing)).toEqual([maths.id]);
      const unknown = await saveWith(s, body, answer, 'keep', {
        [maths.id]: 'cancel',
        [alone.id]: 'cancel',
        [princeton.id]: 'keep',
      });
      refusedWith(unknown, 409, 'bulk_data_choice_unknown');
      expect(listed(unknown)).toEqual([princeton.id]);
      // A shared block chosen "cancel" is cancelled whole.
      const conflict = await saveWith(s, body, answer, 'cancel', {
        [maths.id]: 'cancel',
        [alone.id]: 'keep',
      });
      refusedWith(conflict, 409, 'bulk_data_choice_conflict');
      expect(listed(conflict)).toEqual([alone.id]);
      expect(await all()).toEqual(before);
      // Both halves of a double with data, chosen differently.
      const halves = await pairUp(s, NEXT_TUESDAY);
      for (const half of halves) await markOn(s, half.id);
      const tuesday = { date: NEXT_TUESDAY, classIds: [s.oxford], lessonNumbers: [1, 2, 3] };
      const twice = await checked(s.branch, tuesday);
      const beforeSplit = await all();
      const split = await saveWith(s, tuesday, twice, 'keep', {
        [halves[0]?.id ?? '']: 'keep',
        [halves[1]?.id ?? '']: 'cancel',
      });
      refusedWith(split, 409, 'bulk_data_choice_split');
      expect(listed(split).sort()).toEqual(halves.map((one) => one.id).sort());
      expect(await all()).toEqual(beforeSplit);
    });

    it('keeps as held a lesson with "keep", with the other half of its double, and cancels one with "cancel"; both keep their cells', async () => {
      const s = await scene();
      const body = { date: NEXT_TUESDAY, classIds: [s.oxford], lessonNumbers: [1, 2, 3] };
      const halves = await pairUp(s, NEXT_TUESDAY);
      const [first, second] = halves;
      if (first === undefined || second === undefined) throw new Error('No double.');
      await markOn(s, first.id);
      const cells = await cellsOf([first.id]);
      const answer = await checked(s.branch, body);
      const response = await saveWith(s, body, answer, 'keep', { [first.id]: 'keep' });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const saved = bulkCancelAnswerSchema.parse(response.body);
      expect(saved.keptWithData.sort()).toEqual([first.id, second.id].sort());
      expect((await rowOf(first.id))?.cancel_cause).toBeNull();
      expect((await rowOf(second.id))?.cancel_cause).toBeNull();
      expect(await cellsOf([first.id])).toEqual(cells);
      const [entry] = await t.entries('lesson.bulk_cancel', saved.id);
      expect(entry?.new_value).toMatchObject({
        dataChoices: [{ lessonId: first.id, choice: 'keep' }],
      });
      // "cancel" on another date: cancelled with the reason, the cells kept.
      const s2 = await scene();
      const maths = await oneLesson(s2, NEXT_MONDAY, { classId: s2.oxford }, s2.maths);
      await markOn(s2, maths.id);
      const kept = await cellsOf([maths.id]);
      const monday = { date: NEXT_MONDAY, classIds: [s2.oxford], lessonNumbers: [1] };
      const cancelled = await saveWith(s2, monday, await checked(s2.branch, monday), 'keep', {
        [maths.id]: 'cancel',
      });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      const cancelledAnswer = bulkCancelAnswerSchema.parse(cancelled.body);
      expect(cancelledAnswer).toMatchObject({ cancelled: [maths.id], keptWithData: [] });
      const [cancelEntry] = await t.entries('lesson.bulk_cancel', cancelledAnswer.id);
      expect(cancelEntry?.new_value).toMatchObject({
        dataChoices: [{ lessonId: maths.id, choice: 'cancel' }],
        lessonIds: [maths.id],
      });
      expect(await rowOf(maths.id)).toMatchObject({
        cancel_cause: 'reason',
        cancel_reason: 'Excursion to the museum',
      });
      expect(await cellsOf([maths.id])).toEqual(kept);
    });

    it('asks about a part of the chosen classes alone in a shared block chosen "keep", which follows its choice', async () => {
      const s = await scene();
      const body = { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [2] };
      const alone = await oneLesson(s, NEXT_MONDAY, { groupId: s.groups[2] ?? '' }, s.english);
      await totalOn(s, alone.id);
      const answer = await checked(s.branch, body);
      const response = await saveWith(s, body, answer, 'keep', { [alone.id]: 'keep' });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect((await rowOf(alone.id))?.cancel_cause).toBeNull();
      expect(bulkCancelAnswerSchema.parse(response.body).cancelled).toEqual([]);
    });

    it('keeps one part with data of a block not shared and cancels the others; a room change of the kept part then passes its check', async () => {
      const s = await scene();
      const body = { date: NEXT_MONDAY, classIds: [s.oxford, s.princeton], lessonNumbers: [2] };
      const parts = await Promise.all(
        s.groups.map((group) => oneLesson(s, NEXT_MONDAY, { groupId: group }, s.english)),
      );
      const [, , alone] = parts;
      if (alone === undefined) throw new Error('No English lesson.');
      await totalOn(s, alone.id);
      const answer = await checked(s.branch, body);
      expect(answer.shared).toEqual([]);
      const response = await saveWith(s, body, answer, 'keep', { [alone.id]: 'keep' });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      for (const part of parts) {
        expect((await rowOf(part.id))?.cancel_cause).toBe(part.id === alone.id ? null : 'reason');
      }
      const room = await load.classes.room(s.branch);
      const moved = await keyed(
        `/api/timetable/lessons/${alone.id}/room`,
        s.branch,
        { roomId: room, reason: 'The room is painted' },
        t.admin,
        randomUUID(),
      );
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect((await rowOf(alone.id))?.room_id).toBe(room);
    });

    it('takes the data choices into the request key: a repeat with other choices is not the stored answer', async () => {
      const s = await scene();
      const body = { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [1] };
      const maths = await oneLesson(s, NEXT_MONDAY, { classId: s.oxford }, s.maths);
      await markOn(s, maths.id);
      const answer = await checked(s.branch, body);
      const key = randomUUID();
      const first = await saveWith(s, body, answer, 'keep', { [maths.id]: 'keep' }, key);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      refusedWith(
        await saveWith(s, body, answer, 'keep', { [maths.id]: 'cancel' }, key),
        409,
        'request_key_reused',
      );
    });

    it('a save of the first mark held open and the bulk save: the mark first refuses the bulk save for a choice; the bulk save first refuses the mark', async () => {
      const s = await scene();
      const body = { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [1] };
      const maths = await oneLesson(s, NEXT_MONDAY, { classId: s.oxford }, s.maths);
      // A member with a mark on another lesson, so the held save is the first on this one.
      const tuesday = await oneLesson(s, NEXT_TUESDAY, { classId: s.oxford }, s.physics);
      const student = await markOn(s, tuesday.id);
      const answer = await checked(s.branch, body);
      expect(answer.withData).toEqual([]);
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready: () => void = () => undefined;
      const isReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const account = await load.classes.account();
      const held = t.app
        .get(Transactions)
        .run([s.branch], async (transaction) => {
          await saveCells(transaction, t.app.get(Audit), { accountId: account }, [
            { lessonId: maths.id, studentId: student, workId: null, value: 1, version: null },
          ]);
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await isReady;
      const saving = saveWith(s, body, answer, 'keep', {}).then((one) => one);
      await expect.poll(() => waiting(), { timeout: 20_000, interval: 25 }).toBe(1);
      release();
      expect(await held).toBeUndefined();
      const refused = await saving;
      refusedWith(refused, 409, 'bulk_data_choice_missing');
      expect(listed(refused)).toEqual([maths.id]);
      // The bulk save first: the mark, which waits behind it on the lesson, is
      // then refused.
      const s2 = await scene();
      const body2 = { date: NEXT_MONDAY, classIds: [s2.oxford], lessonNumbers: [1] };
      const maths2 = await oneLesson(s2, NEXT_MONDAY, { classId: s2.oxford }, s2.maths);
      const tuesday2 = await oneLesson(s2, NEXT_TUESDAY, { classId: s2.oxford }, s2.physics);
      const student2 = await markOn(s2, tuesday2.id);
      const answer2 = await checked(s2.branch, body2);
      const [done, late] = await inOrderOnLesson({
        app: t.app,
        migrator: t.database.migrator,
        branchId: s2.branch,
        lessonId: maths2.id,
        first: () => saveWith(s2, body2, answer2, 'keep', {}),
        second: () =>
          t.app
            .get(Transactions)
            .run([s2.branch], (transaction) =>
              saveCells(transaction, t.app.get(Audit), { accountId: account }, [
                { lessonId: maths2.id, studentId: student2, workId: null, value: 1, version: null },
              ]),
            ),
      });
      expect((done as Response).status, JSON.stringify((done as Response).body)).toBe(200);
      expect(late).toMatchObject({ code: 'lesson_cancelled_cell' });
    });

    it('answers 404 for a data choice of another branch’s lesson and an unknown one, with nothing written in either branch', async () => {
      const s = await scene();
      const other = await scene();
      const body = { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [1] };
      const maths = await oneLesson(s, NEXT_MONDAY, { classId: s.oxford }, s.maths);
      const foreign = await oneLesson(other, NEXT_MONDAY, { classId: other.oxford }, other.maths);
      await markOn(s, maths.id);
      await markOn(other, foreign.id);
      const answer = await checked(s.branch, body);
      const before = await all();
      for (const id of [foreign.id, UNKNOWN]) {
        refusedWith(
          await saveWith(s, body, answer, 'keep', { [maths.id]: 'cancel', [id]: 'keep' }),
          404,
          'not_found',
        );
      }
      expect(await all()).toEqual(before);
    });
  });

  describe('refusals', () => {
    it('refuses nothing to cancel, a date in no year, and an archived class', async () => {
      const s = northScene;
      const before = await everything();
      refusedWith(
        await check(s.branch, { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [3] }),
        409,
        'bulk_cancel_empty',
      );
      refusedWith(
        await save(s.branch, { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [3] }),
        409,
        'bulk_cancel_empty',
      );
      refusedWith(
        await check(s.branch, { date: '2027-07-05', classIds: [s.oxford], lessonNumbers: [1] }),
        409,
        'bulk_cancel_out_of_year',
      );
      const archived = await load.classes.schoolClass(s.branch, s.year, { grade: 7 });
      await t.database.migrator
        .updateTable('classes')
        .set({ archived_at: t.clock.now() })
        .where('id', '=', archived)
        .execute();
      const refused = await check(s.branch, {
        date: NEXT_MONDAY,
        classIds: [s.oxford, archived],
        lessonNumbers: [1],
      });
      refusedWith(refused, 409, 'class_not_active');
      expect(listed(refused)).toEqual([archived]);
      refusedWith(
        await save(s.branch, {
          date: NEXT_MONDAY,
          classIds: [s.oxford, archived],
          lessonNumbers: [1],
        }),
        409,
        'class_not_active',
      );
      expect(await everything()).toEqual(before);
    });

    it('refuses the save when a lesson moved into the slots after the check (decision 12)', async () => {
      const s = await scene();
      const body = { date: NEXT_MONDAY, classIds: [s.princeton], lessonNumbers: [3] };
      const maths = await oneLesson(s, NEXT_MONDAY, { classId: s.princeton }, s.maths);
      refusedWith(await check(s.branch, body), 409, 'bulk_cancel_empty');
      const moved = await keyed(
        `/api/timetable/lessons/${maths.id}/move`,
        s.branch,
        { date: NEXT_MONDAY, lessonNumber: 3, reason: 'The hall is free then' },
        t.admin,
        randomUUID(),
      );
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      const refused = await save(s.branch, body);
      refusedWith(refused, 409, 'bulk_scope_changed');
      expect(listed(refused)).toEqual([maths.id]);
      expect((await rowOf(maths.id))?.cancel_cause).toBeNull();
    });

    it('refuses a reason missing, lesson numbers unsorted or repeated, and a class twice as input errors', async () => {
      const s = northScene;
      const before = await everything();
      for (const body of [
        { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [1], reason: '   ' },
        { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [2, 1] },
        { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [1, 1] },
        { date: NEXT_MONDAY, classIds: [s.oxford, s.oxford], lessonNumbers: [1] },
        { date: NEXT_MONDAY, classIds: [], lessonNumbers: [1] },
        { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [21] },
      ]) {
        refusedWith(await save(s.branch, body), 400, 'validation_failed');
      }
      expect(await everything()).toEqual(before);
    });
  });

  describe('branch, roles and keys', () => {
    it('answers 404 for a class of another branch and an unknown one, as the Academic Vice Principal and the Super Admin, with nothing written in either branch', async () => {
      const s = northScene;
      const other = await scene();
      const before = await everything();
      for (const cookie of [t.vicePrincipal, t.admin]) {
        for (const classId of [other.oxford, UNKNOWN]) {
          const body = { date: NEXT_MONDAY, classIds: [s.oxford, classId], lessonNumbers: [1] };
          refusedWith(await check(s.branch, body, cookie), 404, 'not_found');
          refusedWith(await save(s.branch, body, cookie), 404, 'not_found');
        }
      }
      expect(await everything()).toEqual(before);
    });

    it('answers 404 for a block or a lesson of another branch and an unknown one in the save, with nothing written in either branch', async () => {
      const s = northScene;
      const other = await scene();
      const body = { date: '2026-11-16', classIds: [s.oxford], lessonNumbers: [1, 2] };
      const answer = await checked(s.branch, body);
      const shared = answer.shared[0]?.blockId ?? '';
      const lessonIds = answer.cancel.map((one) => one.lesson.id);
      // A real block and lesson of the other branch that the save would cancel if it took them.
      const foreign = await oneLesson(other, '2026-11-16', { classId: other.oxford }, other.maths);
      const before = await everything();
      for (const cookie of [t.vicePrincipal, t.admin]) {
        for (const blockId of [foreign.block_id, UNKNOWN]) {
          refusedWith(
            await save(
              s.branch,
              {
                ...body,
                blocks: [
                  { blockId: shared, choice: 'cancel' },
                  { blockId, choice: 'cancel' },
                ],
                lessonIds,
              },
              cookie,
            ),
            404,
            'not_found',
          );
        }
        for (const lessonId of [foreign.id, UNKNOWN]) {
          refusedWith(
            await save(
              s.branch,
              {
                ...body,
                blocks: [{ blockId: shared, choice: 'cancel' }],
                lessonIds: [...lessonIds, lessonId],
              },
              cookie,
            ),
            404,
            'not_found',
          );
        }
      }
      expect(await everything()).toEqual(before);
    });

    it('answers a repeated key with the stored answer once, refuses it from another account, and checks the branch and the role again on a repeat', async () => {
      const s = northScene;
      const body = { date: '2026-11-09', classIds: [s.princeton], lessonNumbers: [1] };
      const answer = await checked(s.branch, body);
      const full = { ...body, lessonIds: answer.cancel.map((one) => one.lesson.id) };
      const key = randomUUID();
      const first = await save(s.branch, full, t.vicePrincipal, key);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const again = await save(s.branch, full, t.vicePrincipal, key);
      expect(again.body).toEqual(first.body);
      refusedWith(await save(s.branch, full, t.admin, key), 409, 'request_key_reused');
      const foreign = await scene();
      refusedWith(
        await save(s.branch, { ...full, classIds: [foreign.oxford] }, t.vicePrincipal, key),
        404,
        'not_found',
      );
      refusedWith(
        await save(s.branch, { ...full, classIds: [UNKNOWN] }, t.vicePrincipal, key),
        404,
        'not_found',
      );
      const foreignLesson = await oneLesson(
        foreign,
        '2026-11-09',
        { classId: foreign.oxford },
        foreign.maths,
      );
      for (const [blocks, lessonIds] of [
        [[{ blockId: foreignLesson.block_id, choice: 'cancel' as const }], full.lessonIds],
        [[], [...full.lessonIds, foreignLesson.id]],
        [[{ blockId: UNKNOWN, choice: 'cancel' as const }], full.lessonIds],
        [[], [...full.lessonIds, UNKNOWN]],
      ] as const) {
        refusedWith(
          await save(
            s.branch,
            { ...full, blocks: [...blocks], lessonIds: [...lessonIds] },
            t.vicePrincipal,
            key,
          ),
          404,
          'not_found',
        );
      }
      // Task 6.1b-2 (permission review should-fix 1): a lesson of the data
      // choices of another branch and an unknown one, on a repeat too.
      for (const lessonId of [foreignLesson.id, UNKNOWN]) {
        refusedWith(
          await save(
            s.branch,
            { ...full, dataChoices: [{ lessonId, choice: 'keep' }] },
            t.vicePrincipal,
            key,
          ),
          404,
          'not_found',
        );
      }
      refusedWith(await save(s.branch, full, t.principal, key), 403, 'permission_denied');
      const entries = (await t.entries('lesson.bulk_cancel')).filter(
        (one) => (one.new_value as { date?: string }).date === '2026-11-09',
      );
      expect(entries).toHaveLength(1);
    });
  });

  // Task 5.6a-5b-1, pull request #165: the bulk cancels applied again after a
  // publish (edge/timetable, Versions and drafts: "One-day changes, absences,
  // room closures and exams are stored on their own and applied again after a
  // publish. The preview sorts them into kept, needs a decision and dropped.
  // Publish waits until every 'needs a decision' item is settled."; After
  // publishing, the 7 Oxford row).
  describe('applied again after a publish (task 5.6a-5b-1)', () => {
    interface BulkBlock {
      blockId: string;
      blockDate: string;
      chosenClassIds: string[];
      otherClassIds: string[];
      choice: 'keep' | 'cancel' | null;
    }
    interface BulkItem {
      key: string;
      category: string;
      cancelled: number;
      blocks: BulkBlock[];
    }
    interface Checked {
      chain: { key: string } | null;
      impact: { dayChanges: { key: string; bulk: BulkItem[] } };
    }

    /**
     * A draft copied from the scene's version, the pattern placed again: maths
     * of both classes and the English block at `maths` and `english` on
     * Monday (slot positions), physics on Tuesday as in the scene.
     */
    async function draftOf(
      s: Scene,
      positions: { maths?: number; english?: number; from?: string; withoutGroup?: string } = {},
    ) {
      const created = await t.post('/api/timetable/versions', s.branch, {
        academicYearId: s.year,
        startsOn: MONDAY,
        copyFrom: positions.from ?? s.version,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const version = (created.body as { id: string }).id;
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', version)
        .execute();
      const rows = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select(['id', 'class_id', 'group_id', 'subject_id'])
        .where('version_id', '=', version)
        .orderBy('id')
        .execute();
      const rowOfUnit = (
        subject: string,
        classId: string | null,
        groupId: string | null = null,
      ) => {
        const found = rows.find(
          (one) =>
            one.subject_id === subject && one.class_id === classId && one.group_id === groupId,
        );
        if (found === undefined) throw new Error('No such load row.');
        return found.id;
      };
      // A part of the English block left out of the new version.
      if (positions.withoutGroup !== undefined) {
        await t.database.migrator
          .deleteFrom('teaching_load_rows')
          .where('id', '=', rowOfUnit(s.english, null, positions.withoutGroup))
          .execute();
      }
      for (const classId of [s.oxford, s.princeton]) {
        await placeAt(s.branch, version, rowOfUnit(s.maths, classId), 1, positions.maths ?? 1);
      }
      await placeAt(
        s.branch,
        version,
        rowOfUnit(s.english, null, s.groups[0] ?? ''),
        1,
        positions.english ?? 3,
      );
      await placeAt(s.branch, version, rowOfUnit(s.physics, s.oxford), 2, 3);
      await placeAt(s.branch, version, rowOfUnit(s.physics, s.oxford), 2, 5);
      const confirmed = await t.post(
        `/api/timetable/versions/${version}/templates/confirm`,
        s.branch,
      );
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      await load.freeEditLock(version);
      return version;
    }

    const checkOn = async (s: Scene, version: string, startsOn: string, chain?: string) => {
      const answer = await t.get(
        `/api/timetable/versions/${version}/publish-check?startsOn=${startsOn}${
          chain === undefined ? '' : `&chain=${chain}`
        }`,
        s.branch,
      );
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      return answer.body as Checked;
    };

    const publishWith = (
      s: Scene,
      version: string,
      extra: object,
      key: string = randomUUID(),
      cookie = t.admin,
    ) =>
      request(t.kit.server)
        .post(`/api/timetable/versions/${version}/publish`)
        .set('Cookie', cookie)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, key)
        .send({ startsOn: NEXT_MONDAY, ...extra });

    const refusals = (response: Response) => {
      refusedWith(response, 409, 'publish_blocked');
      return (response.body as { error: { details: { code: string; path: string }[] } }).error
        .details;
    };

    const blocksOf = (bulkCancelId: string) =>
      t.database.migrator
        .selectFrom('bulk_cancel_blocks')
        .selectAll()
        .where('bulk_cancel_id', '=', bulkCancelId)
        .orderBy('block_id')
        .execute();

    /** The lesson of a class or group and subject on the Monday after next. */
    const mondayOf = (s: Scene, unit: { classId?: string; groupId?: string }, subject: string) =>
      oneLesson(s, NEXT_MONDAY, unit, subject);

    /** A bulk cancel of 7 Oxford on the Monday after next, in lessons 1 and 2, with `choice` for the English block. */
    const oxfordAway = async (s: Scene, choice: 'keep' | 'cancel', lessonNumbers = [1, 2]) =>
      (
        await checkAndSave(
          s.branch,
          { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers },
          choice,
        )
      ).saved.id;

    const reason = 'Excursion to the museum';

    it('asks for a decision on a shared block of the new version, refuses until it is settled, and keeps it with “keep” (the 7 Oxford row)', async () => {
      const s = await scene();
      const bulk = await oxfordAway(s, 'keep');
      // A bulk cancel of the other branch, whose id the publish must refuse.
      const north = await checkAndSave(northScene.branch, {
        date: NEXT_MONDAY,
        classIds: [northScene.oxford],
        lessonNumbers: [1],
      });
      // The new version: the English block in lesson 1, maths in lesson 2.
      const draft = await draftOf(s, { maths: 3, english: 1 });
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      expect(days.bulk).toHaveLength(1);
      const [item] = days.bulk;
      expect(item).toMatchObject({ key: bulk, category: 'decide', cancelled: 1 });
      expect(item?.blocks).toHaveLength(1);
      const block = item?.blocks[0];
      expect(block).toMatchObject({
        blockDate: NEXT_MONDAY,
        chosenClassIds: [s.oxford],
        otherClassIds: [s.princeton],
        choice: null,
      });
      const blockId = block?.blockId ?? '';
      expect(
        await t.database.migrator
          .selectFrom('pattern_blocks')
          .select('version_id')
          .where('id', '=', blockId)
          .executeTakeFirst(),
      ).toEqual({ version_id: draft });
      const named = { key: bulk, blockId, blockDate: NEXT_MONDAY };
      const before = await everything();
      // No choice.
      expect(refusals(await publishWith(s, draft, { dayChangesKey: days.key }))).toContainEqual(
        expect.objectContaining({
          code: 'day_change_undecided',
          path: `dayChanges.${bulk}.blocks.${blockId}.${NEXT_MONDAY}`,
        }),
      );
      // "Drop" is not a bulk cancel's choice (decision 2).
      expect(
        refusals(
          await publishWith(s, draft, {
            dayChangesKey: days.key,
            dayDecisions: [{ ...named, choice: 'drop' }],
          }),
        ).map((one) => one.code),
      ).toEqual(['day_choice_not_offered']);
      // The bulk cancel sent without its block, and a block that is no such item.
      const mathsBlock = await t.database.migrator
        .selectFrom('pattern_blocks')
        .select('id')
        .where('version_id', '=', draft)
        .where('id', '!=', blockId)
        .orderBy('id')
        .executeTakeFirstOrThrow();
      for (const extra of [
        { key: bulk, choice: 'keep' },
        { key: bulk, blockId: mathsBlock.id, blockDate: NEXT_MONDAY, choice: 'keep' },
      ]) {
        expect(
          refusals(
            await publishWith(s, draft, {
              dayChangesKey: days.key,
              dayDecisions: [{ ...named, choice: 'keep' }, extra],
            }),
          ).map((one) => one.code),
        ).toEqual(['day_decision_unknown']);
      }
      // A block named twice with one key and date is an input error.
      refusedWith(
        await publishWith(s, draft, {
          dayChangesKey: days.key,
          dayDecisions: [
            { ...named, choice: 'keep' },
            { ...named, choice: 'cancel' },
          ],
        }),
        400,
        'validation_failed',
      );
      const northBlock = await t.database.migrator
        .selectFrom('pattern_blocks')
        .select('id')
        .where('version_id', '=', northScene.version)
        .orderBy('id')
        .executeTakeFirstOrThrow();
      // Another branch's bulk cancel or pattern block, and unknown ones: 404 before any lock.
      for (const wrong of [
        { ...named, key: north.saved.id },
        { ...named, key: UNKNOWN },
        { ...named, blockId: northBlock.id },
        { ...named, blockId: UNKNOWN },
      ]) {
        refusedWith(
          await publishWith(s, draft, {
            dayChangesKey: days.key,
            dayDecisions: [{ ...wrong, choice: 'keep' }],
          }),
          404,
          'not_found',
        );
      }
      expect(await everything()).toEqual(before);

      const published = await publishWith(s, draft, {
        dayChangesKey: days.key,
        dayDecisions: [{ ...named, choice: 'keep' }],
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      // 7 Oxford's own English group and its maths are cancelled; the shared group is held.
      const shared = await mondayOf(s, { groupId: s.groups[0] ?? '' }, s.english);
      const own = await mondayOf(s, { groupId: s.groups[2] ?? '' }, s.english);
      const princetonOnly = await mondayOf(s, { groupId: s.groups[1] ?? '' }, s.english);
      expect(shared.starts_at).toEqual(at(NEXT_MONDAY, '08:00'));
      expect([shared.cancel_cause, princetonOnly.cancel_cause]).toEqual([null, null]);
      expect(own).toMatchObject({ cancel_cause: 'reason', cancel_reason: reason });
      const oxfordMaths = await mondayOf(s, { classId: s.oxford }, s.maths);
      expect(oxfordMaths).toMatchObject({
        starts_at: at(NEXT_MONDAY, '08:55'),
        cancel_cause: 'reason',
        cancel_reason: reason,
      });
      expect((await mondayOf(s, { classId: s.princeton }, s.maths)).cancel_cause).toBeNull();
      // The choice is recorded on the block the students now have (8.5 reads it).
      expect((await blocksOf(bulk)).filter((one) => one.block_id === shared.block_id)).toEqual([
        expect.objectContaining({ choice: 'keep', lesson_date: NEXT_MONDAY }),
      ]);
      const [entry] = await t.entries('timetable_version.publish', draft);
      expect(entry?.new_value).toMatchObject({
        dayChanges: {
          bulk: {
            kept: [bulk],
            decided: [{ key: bulk, blockId, blockDate: NEXT_MONDAY, choice: 'keep' }],
            carried: [],
          },
        },
      });
      // A later publish over the same dates carries the choice and asks nothing.
      const again = await draftOf(s, { maths: 3, english: 1, from: draft });
      const later = (await checkOn(s, again, NEXT_MONDAY, 'replace')).impact.dayChanges.bulk;
      expect(later).toEqual([
        expect.objectContaining({ key: bulk, category: 'kept', cancelled: 2 }),
      ]);
      expect(later[0]?.blocks.map((one) => one.choice)).toEqual(['keep']);
    });

    it('cancels the whole shared block of the new version with “cancel”', async () => {
      const s = await scene();
      const bulk = await oxfordAway(s, 'keep');
      const draft = await draftOf(s, { maths: 3, english: 1 });
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      const blockId = days.bulk[0]?.blocks[0]?.blockId ?? '';
      const published = await publishWith(s, draft, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: bulk, blockId, blockDate: NEXT_MONDAY, choice: 'cancel' }],
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      for (const group of s.groups) {
        expect(await mondayOf(s, { groupId: group }, s.english)).toMatchObject({
          cancel_cause: 'reason',
          cancel_reason: reason,
        });
      }
      const shared = await mondayOf(s, { groupId: s.groups[0] ?? '' }, s.english);
      expect((await blocksOf(bulk)).filter((one) => one.block_id === shared.block_id)).toEqual([
        expect.objectContaining({ choice: 'cancel' }),
      ]);
    });

    it('carries a stored choice to a block the new version keeps, asks nothing, adds no row, and leaves a lesson restored since as it is (decisions 4 and 5)', async () => {
      const s = await scene();
      const bulk = await oxfordAway(s, 'keep');
      const maths = await mondayOf(s, { classId: s.oxford }, s.maths);
      const restored = await keyed(
        `/api/timetable/lessons/${maths.id}/restore`,
        s.branch,
        {},
        t.admin,
        randomUUID(),
      );
      expect(restored.status, JSON.stringify(restored.body)).toBe(200);
      const own = await mondayOf(s, { groupId: s.groups[2] ?? '' }, s.english);
      const rows = await blocksOf(bulk);
      const draft = await draftOf(s);
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      expect(days.bulk).toEqual([expect.objectContaining({ key: bulk, category: 'kept' })]);
      expect(days.bulk[0]?.blocks.map((one) => one.choice)).toEqual(['keep']);
      const published = await publishWith(s, draft, { dayChangesKey: days.key });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      // The restored maths keeps its identity and stays held; 7-E-3 stays cancelled.
      expect(await rowOf(maths.id)).toMatchObject({ cancel_cause: null });
      expect(await rowOf(own.id)).toMatchObject({ cancel_cause: 'reason', cancel_reason: reason });
      expect(await blocksOf(bulk)).toEqual(rows);
      const [entry] = await t.entries('timetable_version.publish', draft);
      expect(entry?.new_value).toMatchObject({
        dayChanges: { bulk: { kept: [bulk], decided: [] } },
      });
    });

    it('lists a bulk cancel with nothing left in its slots as kept, and cancels what a later publish brings back (decision 3)', async () => {
      const s = await scene();
      const bulk = await oxfordAway(s, 'keep', [1]);
      // The new version moves maths to lesson 3: nothing of 7 Oxford is in lesson 1.
      const draft = await draftOf(s, { maths: 5 });
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      expect(days.bulk).toEqual([
        expect.objectContaining({ key: bulk, category: 'kept', cancelled: 0, blocks: [] }),
      ]);
      const published = await publishWith(s, draft, { dayChangesKey: days.key });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect((await mondayOf(s, { classId: s.oxford }, s.maths)).cancel_cause).toBeNull();
      // A later version puts maths back in lesson 1: it is cancelled again.
      const back = await draftOf(s, { from: draft });
      const answer = await checkOn(s, back, NEXT_MONDAY, 'replace');
      expect(answer.impact.dayChanges.bulk).toEqual([
        expect.objectContaining({ key: bulk, category: 'kept', cancelled: 1 }),
      ]);
      const replaced = await publishWith(s, back, {
        dayChangesKey: answer.impact.dayChanges.key,
        chain: 'replace',
        laterKey: answer.chain?.key,
      });
      expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
      expect(await mondayOf(s, { classId: s.oxford }, s.maths)).toMatchObject({
        starts_at: at(NEXT_MONDAY, '08:00'),
        cancel_cause: 'reason',
        cancel_reason: reason,
      });
      expect((await mondayOf(s, { classId: s.princeton }, s.maths)).cancel_cause).toBeNull();
    });

    it('settles a move and a shared block raised on one lesson together, a cancel from either winning (decision 13)', async () => {
      const s = await scene();
      const maths = await mondayOf(s, { classId: s.oxford }, s.maths);
      // 7 Oxford's maths moved to lesson 3, then 7 Oxford away in lessons 1 to 3.
      const moved = await keyed(
        `/api/timetable/lessons/${maths.id}/move`,
        s.branch,
        { date: NEXT_MONDAY, lessonNumber: 3, reason: 'Concert rehearsal' },
        t.admin,
        randomUUID(),
      );
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      const [change] = await t.database.migrator
        .selectFrom('lesson_day_changes')
        .select('id')
        .where('lesson_id', '=', maths.id)
        .execute();
      const bulk = await oxfordAway(s, 'keep', [1, 2, 3]);
      // The new version puts the English block in lesson 3, where the move put 7 Oxford's maths.
      const draft = await draftOf(s, { maths: 1, english: 5 });
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact
        .dayChanges as Checked['impact']['dayChanges'] & {
        decide: { key: string }[];
      };
      expect(days.decide.map((one) => one.key)).toEqual([change?.id]);
      expect(days.bulk.map((one) => one.category)).toEqual(['decide']);
      const blockId = days.bulk[0]?.blocks[0]?.blockId ?? '';
      const published = await publishWith(s, draft, {
        dayChangesKey: days.key,
        dayDecisions: [
          { key: change?.id, choice: 'drop' },
          { key: bulk, blockId, blockDate: NEXT_MONDAY, choice: 'keep' },
        ],
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      // "Drop" puts the maths back in lesson 1, where the bulk cancel cancels it.
      expect(await mondayOf(s, { classId: s.oxford }, s.maths)).toMatchObject({
        starts_at: at(NEXT_MONDAY, '08:00'),
        cancel_cause: 'reason',
        cancel_reason: reason,
      });
      // "Keep" holds the shared groups and cancels 7 Oxford's own.
      expect(
        (await mondayOf(s, { groupId: s.groups[0] ?? '' }, s.english)).cancel_cause,
      ).toBeNull();
      expect(await mondayOf(s, { groupId: s.groups[2] ?? '' }, s.english)).toMatchObject({
        starts_at: at(NEXT_MONDAY, '09:50'),
        cancel_cause: 'reason',
        cancel_reason: reason,
      });
      expect(
        await t.database.migrator
          .selectFrom('lesson_day_change_ends')
          .select('change_id')
          .where('change_id', '=', change?.id ?? '')
          .execute(),
      ).toHaveLength(1);
    });

    // Permission review, should-fix 4: the preview's bulk cancels read by the
    // Principal of the branch (timetable view), refused to another branch's.
    it('shows the bulk cancels of the preview to the Principal of the branch and refuses them to the Principal of another branch', async () => {
      const s = await scene();
      const bulk = await oxfordAway(s, 'keep');
      const draft = await draftOf(s, { maths: 3, english: 1 });
      const path = `/api/timetable/versions/${draft}/publish-check?startsOn=${NEXT_MONDAY}`;
      refusedWith(await t.get(path, s.branch, t.principal), 403, 'permission_denied');
      const principal = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', 'principal')
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      await load.classes.role(principal.account_id, s.branch, 'principal');
      const read = await t.get(path, s.branch, t.principal);
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      expect((read.body as Checked).impact.dayChanges.bulk).toEqual([
        expect.objectContaining({ key: bulk, category: 'decide', reason }),
      ]);
    });

    // Spec review of the code, must-fix 1 (0088): a block the new version
    // changes (a part less) that the pairing still reuses keeps its id and its
    // row; the choice made now replaces the stored one.
    it('records the choice made now on a shared block the new version changes but keeps by its id', async () => {
      const s = await scene();
      const bulk = await oxfordAway(s, 'keep');
      const stored = await blocksOf(bulk);
      expect(stored.map((one) => one.choice)).toEqual(['keep']);
      const draft = await draftOf(s, { withoutGroup: s.groups[1] ?? '' });
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      expect(days.bulk.map((one) => one.category)).toEqual(['decide']);
      const blockId = days.bulk[0]?.blocks[0]?.blockId ?? '';
      const published = await publishWith(s, draft, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: bulk, blockId, blockDate: NEXT_MONDAY, choice: 'cancel' }],
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      const shared = await mondayOf(s, { groupId: s.groups[0] ?? '' }, s.english);
      // The pairing reused the stored block: same id, its row now "cancel".
      expect(shared.block_id).toBe(stored[0]?.block_id);
      expect(shared).toMatchObject({ cancel_cause: 'reason', cancel_reason: reason });
      expect((await blocksOf(bulk)).map((one) => [one.block_id, one.choice])).toEqual([
        [stored[0]?.block_id, 'cancel'],
      ]);
      const [entry] = await t.entries('timetable_version.publish', draft);
      expect(entry?.new_value).toMatchObject({
        dayChanges: {
          bulk: {
            decided: [
              { key: bulk, blockId, blockDate: NEXT_MONDAY, choice: 'cancel', before: 'keep' },
            ],
          },
        },
      });
      // A later publish reads the choice made now.
      const again = await draftOf(s, { from: draft });
      const later = (await checkOn(s, again, NEXT_MONDAY, 'replace')).impact.dayChanges.bulk;
      expect(later[0]?.blocks.map((one) => one.choice)).toEqual(['cancel']);
    });

    // Review of the code, round 1: the mirror of the test above. A decided
    // `keep` holds the part of the other classes the stored `cancel` had
    // cancelled, on the lesson the pairing kept.
    it('holds under “keep” the shared part a stored “cancel” cancelled on a block the new version keeps by its id', async () => {
      const s = await scene();
      const bulk = await oxfordAway(s, 'cancel');
      const stored = await blocksOf(bulk);
      expect(stored.map((one) => one.choice)).toEqual(['cancel']);
      const before = await mondayOf(s, { groupId: s.groups[0] ?? '' }, s.english);
      expect(before).toMatchObject({ cancel_cause: 'reason', cancel_reason: reason });
      const draft = await draftOf(s, { withoutGroup: s.groups[1] ?? '' });
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      expect(days.bulk.map((one) => one.category)).toEqual(['decide']);
      const blockId = days.bulk[0]?.blocks[0]?.blockId ?? '';
      const published = await publishWith(s, draft, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: bulk, blockId, blockDate: NEXT_MONDAY, choice: 'keep' }],
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      // The same lesson, kept by the pairing, held; the chosen class's part cancelled.
      const shared = await rowOf(before.id);
      expect(shared?.block_id).toBe(stored[0]?.block_id);
      expect(shared).toMatchObject({ cancel_cause: null, cancel_reason: null });
      expect(await mondayOf(s, { groupId: s.groups[2] ?? '' }, s.english)).toMatchObject({
        cancel_cause: 'reason',
        cancel_reason: reason,
      });
      expect((await blocksOf(bulk)).map((one) => [one.block_id, one.choice])).toEqual([
        [stored[0]?.block_id, 'keep'],
      ]);
      const [entry] = await t.entries('timetable_version.publish', draft);
      expect(entry?.new_value).toMatchObject({
        dayChanges: {
          bulk: {
            decided: [
              { key: bulk, blockId, blockDate: NEXT_MONDAY, choice: 'keep', before: 'cancel' },
            ],
          },
        },
      });
      // Recorded among the lessons changed.
      const written = entry?.new_value as { datedLessons: { changed: { id: string }[] } };
      expect(written.datedLessons.changed.find((one) => one.id === before.id)).toEqual({
        id: before.id,
        teacherId: { from: before.teacher_id, to: before.teacher_id },
        roomId: { from: before.room_id, to: before.room_id },
        cancel: { from: 'reason', to: null },
      });
    });

    // Review of the code, round 1 (decided without the owner): a cancel of
    // the shared part recorded after the bulk cancel is its own, and `keep`
    // leaves it.
    it('leaves under “keep” a shared part cancelled on its own after the bulk cancel', async () => {
      const s = await scene();
      const bulk = await oxfordAway(s, 'keep');
      const shared = await mondayOf(s, { groupId: s.groups[0] ?? '' }, s.english);
      expect(shared.cancel_cause).toBeNull();
      t.clock.advance(1000);
      try {
        // Its own cancel, with the bulk cancel's reason, after the bulk cancel.
        const cancelled = await keyed(
          `/api/timetable/lessons/${shared.id}/cancel`,
          s.branch,
          { reason },
          t.admin,
          randomUUID(),
        );
        expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      } finally {
        t.clock.set(START);
      }
      const draft = await draftOf(s, { withoutGroup: s.groups[1] ?? '' });
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      const blockId = days.bulk[0]?.blocks[0]?.blockId ?? '';
      const published = await publishWith(s, draft, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: bulk, blockId, blockDate: NEXT_MONDAY, choice: 'keep' }],
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(await rowOf(shared.id)).toMatchObject({
        cancel_cause: 'reason',
        cancel_reason: reason,
      });
    });

    // Decision 4's exception (spec review of the code, must-fix 3): a decided
    // block is written as chosen on every lesson, kept ones included.
    it('cancels again under “keep” a part of the chosen classes alone restored after the bulk cancel', async () => {
      const s = await scene();
      const bulk = await oxfordAway(s, 'keep');
      const own = await mondayOf(s, { groupId: s.groups[2] ?? '' }, s.english);
      const restored = await keyed(
        `/api/timetable/lessons/${own.id}/restore`,
        s.branch,
        {},
        t.admin,
        randomUUID(),
      );
      expect(restored.status, JSON.stringify(restored.body)).toBe(200);
      expect((await rowOf(own.id))?.cancel_cause).toBeNull();
      const draft = await draftOf(s, { withoutGroup: s.groups[1] ?? '' });
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      const blockId = days.bulk[0]?.blocks[0]?.blockId ?? '';
      const published = await publishWith(s, draft, {
        dayChangesKey: days.key,
        dayDecisions: [{ key: bulk, blockId, blockDate: NEXT_MONDAY, choice: 'keep' }],
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      // The same lesson, kept by the pairing, cancelled again; the shared group held.
      expect(await rowOf(own.id)).toMatchObject({ cancel_cause: 'reason', cancel_reason: reason });
      expect(
        (await mondayOf(s, { groupId: s.groups[0] ?? '' }, s.english)).cancel_cause,
      ).toBeNull();
    });

    // Decision 9 at the publish (spec review of the code, must-fix 3): a move
    // into a bulk cancel's spans recorded before it is under it, one recorded
    // after it is left as the move has it.
    it('counts a lesson a move put in the spans before the bulk cancel, and leaves one a later move put there', async () => {
      const physicsOf = async (s: Scene) =>
        (await lessonOf(s, NEXT_TUESDAY, { classId: s.oxford }, s.physics))[0];
      const moveIn = async (s: Scene) => {
        const physics = await physicsOf(s);
        const moved = await keyed(
          `/api/timetable/lessons/${physics?.id ?? ''}/move`,
          s.branch,
          { date: NEXT_MONDAY, lessonNumber: 3, reason: 'Concert rehearsal' },
          t.admin,
          randomUUID(),
        );
        expect(moved.status, JSON.stringify(moved.body)).toBe(200);
        return physics?.id ?? '';
      };
      const later = async (work: () => Promise<unknown>) => {
        t.clock.advance(1000);
        try {
          await work();
        } finally {
          t.clock.set(START);
        }
      };
      // Before: the move, then the bulk cancel a second later.
      const before = await scene();
      const movedBefore = await moveIn(before);
      let bulkBefore = '';
      await later(async () => {
        bulkBefore = await oxfordAway(before, 'keep', [1, 3]);
      });
      expect((await rowOf(movedBefore))?.cancel_cause).toBe('reason');
      const draftBefore = await draftOf(before);
      const daysBefore = (await checkOn(before, draftBefore, NEXT_MONDAY)).impact.dayChanges;
      expect(daysBefore.bulk).toEqual([
        expect.objectContaining({ key: bulkBefore, category: 'kept', cancelled: 2 }),
      ]);
      // After: the bulk cancel, then the move a second later.
      const after = await scene();
      const bulkAfter = await oxfordAway(after, 'keep', [1, 3]);
      let movedAfter = '';
      await later(async () => {
        movedAfter = await moveIn(after);
      });
      const draftAfter = await draftOf(after);
      const daysAfter = (await checkOn(after, draftAfter, NEXT_MONDAY)).impact.dayChanges;
      expect(daysAfter.bulk).toEqual([
        expect.objectContaining({ key: bulkAfter, category: 'kept', cancelled: 1 }),
      ]);
      const published = await publishWith(after, draftAfter, { dayChangesKey: daysAfter.key });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(await rowOf(movedAfter)).toMatchObject({
        lesson_date: NEXT_MONDAY,
        starts_at: at(NEXT_MONDAY, '09:50'),
        cancel_cause: null,
      });
    });

    // Decision 2, the one-day side (spec review of the code, must-fix 4).
    it('refuses “keep” for a one-day change, and a one-day change named with a block', async () => {
      const s = await scene();
      const maths = await mondayOf(s, { classId: s.oxford }, s.maths);
      const moved = await keyed(
        `/api/timetable/lessons/${maths.id}/move`,
        s.branch,
        { date: NEXT_MONDAY, lessonNumber: 3, reason: 'Concert rehearsal' },
        t.admin,
        randomUUID(),
      );
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      const [change] = await t.database.migrator
        .selectFrom('lesson_day_changes')
        .select('id')
        .where('lesson_id', '=', maths.id)
        .execute();
      // The English block in lesson 3, where the move put the maths: the move needs a decision.
      const draft = await draftOf(s, { english: 5 });
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact
        .dayChanges as Checked['impact']['dayChanges'] & {
        decide: { key: string }[];
      };
      expect(days.decide.map((one) => one.key)).toEqual([change?.id]);
      const blockId = (
        await t.database.migrator
          .selectFrom('pattern_blocks')
          .select('id')
          .where('version_id', '=', draft)
          .orderBy('id')
          .executeTakeFirstOrThrow()
      ).id;
      expect(
        refusals(
          await publishWith(s, draft, {
            dayChangesKey: days.key,
            dayDecisions: [{ key: change?.id, choice: 'keep' }],
          }),
        ).map((one) => one.code),
      ).toEqual(['day_choice_not_offered']);
      expect(
        refusals(
          await publishWith(s, draft, {
            dayChangesKey: days.key,
            dayDecisions: [
              { key: change?.id, choice: 'drop' },
              { key: change?.id, blockId, blockDate: NEXT_MONDAY, choice: 'cancel' },
            ],
          }),
        ).map((one) => one.code),
      ).toEqual(['day_decision_unknown']);
    });

    // Decision 11 (spec review of the code, must-fix 2): a carried version's
    // shared block that its run keeps carries the stored choice inside the
    // carry, recorded in the carry's audit entry, with no row added.
    it('carries the stored choice of a shared block into a carried version, with no row added', async () => {
      const s = await scene();
      const later = await draftOf(s);
      const laterPublished = await publishWith(s, later, { startsOn: '2026-11-09' });
      expect(laterPublished.status, JSON.stringify(laterPublished.body)).toBe(200);
      const date = '2026-11-16';
      const bulk = (
        await checkAndSave(s.branch, { date, classIds: [s.oxford], lessonNumbers: [1, 2] }, 'keep')
      ).saved.id;
      const rows = await blocksOf(bulk);
      expect(rows.map((one) => one.choice)).toEqual(['keep']);
      // The fix differs from the scene's version in 7 Princeton's maths teacher only.
      const fix = await draftOf(s);
      const other = await teacherOf(s.branch, s.maths);
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ teacher_id: other.staffId })
        .where('version_id', '=', fix)
        .where('class_id', '=', s.princeton)
        .where('subject_id', '=', s.maths)
        .execute();
      const answer = await checkOn(s, fix, NEXT_MONDAY, 'carry');
      const days = answer.impact.dayChanges;
      expect(days.bulk).toEqual([
        expect.objectContaining({ key: bulk, category: 'kept', carriedVersionId: later }),
      ]);
      expect(days.bulk[0]?.blocks.map((one) => one.choice)).toEqual(['keep']);
      const published = await publishWith(s, fix, {
        chain: 'carry',
        laterKey: answer.chain?.key,
        dayChangesKey: days.key,
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      const [carry] = await t.entries('timetable_version.carry', later);
      expect(carry?.new_value).toMatchObject({
        dayChanges: {
          bulk: {
            kept: [bulk],
            decided: [],
            carried: [
              {
                key: bulk,
                blockId: days.bulk[0]?.blocks[0]?.blockId,
                blockDate: date,
                choice: 'keep',
              },
            ],
          },
        },
      });
      expect(await blocksOf(bulk)).toEqual(rows);
      expect(
        (await oneLesson(s, date, { groupId: s.groups[2] ?? '' }, s.english)).cancel_cause,
      ).toBe('reason');
    });

    it('refuses a publish when a bulk cancel was saved after the check', async () => {
      const s = await scene();
      const draft = await draftOf(s);
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      expect(days.bulk).toEqual([]);
      await checkAndSave(s.branch, {
        date: NEXT_MONDAY,
        classIds: [s.princeton],
        lessonNumbers: [1],
      });
      expect(
        refusals(await publishWith(s, draft, { dayChangesKey: days.key })).map((one) => one.code),
      ).toEqual(['day_changes_changed']);
      // Without a key too: a bulk cancel is now there.
      expect(refusals(await publishWith(s, draft, {})).map((one) => one.code)).toEqual([
        'day_changes_changed',
      ]);
    });

    it("answers a repeat of a used request key with another branch's block 404 and from a role the route refuses 403", async () => {
      const s = await scene();
      const bulk = await oxfordAway(s, 'keep');
      const draft = await draftOf(s, { maths: 3, english: 1 });
      const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
      const named = {
        key: bulk,
        blockId: days.bulk[0]?.blocks[0]?.blockId,
        blockDate: NEXT_MONDAY,
      };
      const key = randomUUID();
      const body = { dayChangesKey: days.key, dayDecisions: [{ ...named, choice: 'keep' }] };
      const published = await publishWith(s, draft, body, key);
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      const northBlock = await t.database.migrator
        .selectFrom('pattern_blocks')
        .select('id')
        .where('version_id', '=', northScene.version)
        .orderBy('id')
        .executeTakeFirstOrThrow();
      const north = await checkAndSave(northScene.branch, {
        date: NEXT_TUESDAY,
        classIds: [northScene.oxford],
        lessonNumbers: [2, 3],
      });
      const after = await everything();
      // Every id of the body, another branch's and an unknown one (permission review, must-fix 3).
      for (const wrong of [
        { ...named, blockId: northBlock.id },
        { ...named, blockId: UNKNOWN },
        { ...named, key: north.saved.id },
        { ...named, key: UNKNOWN },
      ]) {
        refusedWith(
          await publishWith(
            s,
            draft,
            { ...body, dayDecisions: [{ ...wrong, choice: 'keep' }] },
            key,
          ),
          404,
          'not_found',
        );
      }
      // The Principal of the branch: refused for the role, not the branch (permission review, must-fix 1).
      const principal = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', 'principal')
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      await load.classes.role(principal.account_id, s.branch, 'principal');
      refusedWith(await publishWith(s, draft, body, key, t.principal), 403, 'permission_denied');
      expect(await everything()).toEqual(after);
    });

    // Task 5.6a-5b-2: a withdraw sorts and applies the stored bulk cancels of
    // the withdrawn dates as a publish does (decision 1); 5.6a-5b-1 decision 5:
    // a choice whose block the withdraw removes carries nothing, and the block
    // in its place is asked in the withdraw's own sorting.
    describe('and after a withdraw (task 5.6a-5b-2)', () => {
      interface WithdrawChecked {
        runsAgain: { id: string } | null;
        dayChanges: { key: string; bulk: BulkItem[] };
      }

      /** `draft` published from the Monday after next, with the key its check shows. */
      const published = async (s: Scene, draft: string) => {
        const days = (await checkOn(s, draft, NEXT_MONDAY)).impact.dayChanges;
        const answer = await publishWith(s, draft, { dayChangesKey: days.key });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        return draft;
      };

      const withdrawCheck = async (s: Scene, version: string) => {
        const answer = await t.get(`/api/timetable/versions/${version}/withdraw-check`, s.branch);
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        return answer.body as WithdrawChecked;
      };

      const withdrawWith = (s: Scene, version: string, body: object) =>
        request(t.kit.server)
          .post(`/api/timetable/versions/${version}/withdraw`)
          .set('Cookie', t.admin)
          .set(BRANCH_HEADER, s.branch)
          .set(REQUEST_KEY_HEADER, randomUUID())
          .send(body);

      const withdrawRefusals = (response: Response) => {
        refusedWith(response, 409, 'withdraw_blocked');
        return (response.body as { error: { details: { code: string; path: string }[] } }).error
          .details;
      };

      it('asks for a decision on a shared block of the version that runs again with no stored choice, and keeps it with “keep”', async () => {
        const s = await scene();
        // B: the English block in lesson 1, maths in lesson 2; 7 Oxford away
        // in lessons 1 and 2 with "keep" on B's block.
        const b = await published(s, await draftOf(s, { maths: 3, english: 1 }));
        const bulk = await oxfordAway(s, 'keep');
        const stored = await blocksOf(bulk);
        expect(stored).toHaveLength(1);
        const checked = await withdrawCheck(s, b);
        expect(checked.runsAgain).toMatchObject({ id: s.version });
        // The scene's English block, in lesson 2, has no counterpart among B's blocks.
        expect(checked.dayChanges.bulk).toHaveLength(1);
        const [item] = checked.dayChanges.bulk;
        expect(item).toMatchObject({ key: bulk, category: 'decide', cancelled: 1 });
        const block = item?.blocks[0];
        expect(block).toMatchObject({
          blockDate: NEXT_MONDAY,
          chosenClassIds: [s.oxford],
          otherClassIds: [s.princeton],
          choice: null,
        });
        const blockId = block?.blockId ?? '';
        const named = { key: bulk, blockId, blockDate: NEXT_MONDAY };
        const key = checked.dayChanges.key;
        // Permission review must-fix 3: rows of the other branch a withdraw
        // writes, a bulk cancel's choice on a shared block and a one-day change.
        await checkAndSave(
          northScene.branch,
          { date: '2026-10-26', classIds: [northScene.oxford], lessonNumbers: [1, 2] },
          'keep',
        );
        const northMaths = await oneLesson(
          northScene,
          '2026-10-26',
          { classId: northScene.princeton },
          northScene.maths,
        );
        const roomed = await keyed(
          `/api/timetable/lessons/${northMaths.id}/room`,
          northScene.branch,
          { roomId: await load.classes.room(northScene.branch), reason: 'The room is painted' },
          t.admin,
          randomUUID(),
        );
        expect(roomed.status, JSON.stringify(roomed.body)).toBe(200);
        const before = await everything();
        expect(withdrawRefusals(await withdrawWith(s, b, { dayChangesKey: key }))).toContainEqual(
          expect.objectContaining({
            code: 'day_change_undecided',
            path: `dayChanges.${bulk}.blocks.${blockId}.${NEXT_MONDAY}`,
          }),
        );
        expect(
          withdrawRefusals(
            await withdrawWith(s, b, {
              dayChangesKey: key,
              dayDecisions: [{ ...named, choice: 'drop' }],
            }),
          ).map((one) => one.code),
        ).toEqual(['day_choice_not_offered']);
        // Another branch's pattern block and an unknown one: 404 before any lock.
        const northBlock = await t.database.migrator
          .selectFrom('pattern_blocks')
          .select('id')
          .where('version_id', '=', northScene.version)
          .orderBy('id')
          .executeTakeFirstOrThrow();
        for (const wrong of [northBlock.id, UNKNOWN]) {
          refusedWith(
            await withdrawWith(s, b, {
              dayChangesKey: key,
              dayDecisions: [{ ...named, blockId: wrong, choice: 'keep' }],
            }),
            404,
            'not_found',
          );
        }
        // Review correction 2: nothing written by a refused withdraw, the
        // bulk cancel's rows included.
        expect(await everything()).toEqual(before);

        const answer = await withdrawWith(s, b, {
          dayChangesKey: key,
          dayDecisions: [{ ...named, choice: 'keep' }],
        });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        // 7 Oxford's own English group and its maths are cancelled; the shared group is held.
        const shared = await mondayOf(s, { groupId: s.groups[0] ?? '' }, s.english);
        const own = await mondayOf(s, { groupId: s.groups[2] ?? '' }, s.english);
        expect(shared).toMatchObject({ starts_at: at(NEXT_MONDAY, '08:55'), cancel_cause: null });
        expect(own).toMatchObject({ cancel_cause: 'reason', cancel_reason: reason });
        expect(await mondayOf(s, { classId: s.oxford }, s.maths)).toMatchObject({
          starts_at: at(NEXT_MONDAY, '08:00'),
          cancel_cause: 'reason',
        });
        expect((await mondayOf(s, { classId: s.princeton }, s.maths)).cancel_cause).toBeNull();
        // The choice recorded on the block of the version that runs again.
        expect((await blocksOf(bulk)).filter((one) => one.block_id === shared.block_id)).toEqual([
          expect.objectContaining({ choice: 'keep', lesson_date: NEXT_MONDAY }),
        ]);
        const [entry] = await t.entries('timetable_version.withdraw', b);
        expect(entry?.new_value).toMatchObject({
          dayChanges: {
            bulk: {
              kept: [bulk],
              decided: [{ key: bulk, blockId, blockDate: NEXT_MONDAY, choice: 'keep' }],
            },
          },
        });
      });

      it('cancels the whole shared block with “cancel”', async () => {
        const s = await scene();
        const b = await published(s, await draftOf(s, { maths: 3, english: 1 }));
        const bulk = await oxfordAway(s, 'keep');
        const checked = await withdrawCheck(s, b);
        const blockId = checked.dayChanges.bulk[0]?.blocks[0]?.blockId ?? '';
        const answer = await withdrawWith(s, b, {
          dayChangesKey: checked.dayChanges.key,
          dayDecisions: [{ key: bulk, blockId, blockDate: NEXT_MONDAY, choice: 'cancel' }],
        });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        for (const group of s.groups) {
          expect(await mondayOf(s, { groupId: group }, s.english)).toMatchObject({
            cancel_cause: 'reason',
            cancel_reason: reason,
          });
        }
      });

      it('carries a stored choice to a block with the same lessons, asking nothing and adding no row', async () => {
        const s = await scene();
        const b = await published(s, await draftOf(s));
        const bulk = await oxfordAway(s, 'keep');
        const rows = await blocksOf(bulk);
        const checked = await withdrawCheck(s, b);
        expect(checked.dayChanges.bulk).toEqual([
          expect.objectContaining({ key: bulk, category: 'kept' }),
        ]);
        expect(checked.dayChanges.bulk[0]?.blocks.map((one) => one.choice)).toEqual(['keep']);
        const answer = await withdrawWith(s, b, { dayChangesKey: checked.dayChanges.key });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(await blocksOf(bulk)).toEqual(rows);
        expect(
          (await mondayOf(s, { groupId: s.groups[0] ?? '' }, s.english)).cancel_cause,
        ).toBeNull();
      });

      // `.claude/rules/timetable.md`: a choice named by a block the pairing reuses.
      it('updates the stored choice of a block the version that runs again changes but keeps by its id', async () => {
        const s = await scene();
        // B's English block lacks 7-E-2; the scene's has it.
        const b = await published(s, await draftOf(s, { withoutGroup: s.groups[1] ?? '' }));
        const bulk = await oxfordAway(s, 'keep');
        const [row] = await blocksOf(bulk);
        expect(row?.choice).toBe('keep');
        const checked = await withdrawCheck(s, b);
        const block = checked.dayChanges.bulk[0]?.blocks[0];
        expect(block?.choice).toBeNull();
        const answer = await withdrawWith(s, b, {
          dayChangesKey: checked.dayChanges.key,
          dayDecisions: [
            { key: bulk, blockId: block?.blockId, blockDate: NEXT_MONDAY, choice: 'cancel' },
          ],
        });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        const shared = await mondayOf(s, { groupId: s.groups[0] ?? '' }, s.english);
        expect(shared.cancel_cause).toBe('reason');
        expect((await blocksOf(bulk)).filter((one) => one.block_id === shared.block_id)).toEqual([
          expect.objectContaining({ choice: 'cancel' }),
        ]);
      });

      it('lists a bulk cancel with nothing of the version that runs again in its slots as kept', async () => {
        const s = await scene();
        // B has the maths of both classes in lesson 3, where the scene's
        // version has nothing of 7 Oxford on Mondays.
        const b = await published(s, await draftOf(s, { maths: 5 }));
        const bulk = (
          await checkAndSave(
            s.branch,
            { date: NEXT_MONDAY, classIds: [s.oxford], lessonNumbers: [3] },
            'keep',
          )
        ).saved.id;
        const checked = await withdrawCheck(s, b);
        expect(checked.dayChanges.bulk).toEqual([
          expect.objectContaining({ key: bulk, category: 'kept', cancelled: 0, blocks: [] }),
        ]);
        const answer = await withdrawWith(s, b, { dayChangesKey: checked.dayChanges.key });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect((await mondayOf(s, { classId: s.oxford }, s.maths)).cancel_cause).toBeNull();
      });

      it('keeps a bulk cancel with nothing under it when no version runs again (decision 4)', async () => {
        const s = await scene();
        const bulk = await oxfordAway(s, 'keep');
        const checked = await withdrawCheck(s, s.version);
        expect(checked.runsAgain).toBeNull();
        expect(checked.dayChanges.bulk).toEqual([
          expect.objectContaining({ key: bulk, category: 'kept', cancelled: 0, blocks: [] }),
        ]);
        const answer = await withdrawWith(s, s.version, { dayChangesKey: checked.dayChanges.key });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(
          await t.database.migrator
            .selectFrom('bulk_cancels')
            .select('id')
            .where('id', '=', bulk)
            .execute(),
        ).toEqual([{ id: bulk }]);
        const [entry] = await t.entries('timetable_version.withdraw', s.version);
        expect(entry?.new_value).toMatchObject({
          dayChanges: { bulk: { kept: [bulk], decided: [], carried: [] } },
        });
      });
    });
  });

  describe('at the same moment', () => {
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

    /** A draft of the scene without 7 Princeton's maths, ready to publish. */
    async function withoutPrincetonMaths(s: Scene) {
      const created = await t.post('/api/timetable/versions', s.branch, {
        academicYearId: s.year,
        startsOn: MONDAY,
        copyFrom: s.version,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const version = (created.body as { id: string }).id;
      // The pattern placed again, without 7 Princeton's maths and its row.
      await t.database.migrator
        .deleteFrom('pattern_blocks')
        .where('version_id', '=', version)
        .execute();
      const rows = await t.database.migrator
        .selectFrom('teaching_load_rows')
        .select(['id', 'class_id', 'group_id', 'subject_id'])
        .where('version_id', '=', version)
        .orderBy('id')
        .execute();
      const rowOfUnit = (
        subject: string,
        classId: string | null,
        groupId: string | null = null,
      ) => {
        const found = rows.find(
          (one) =>
            one.subject_id === subject && one.class_id === classId && one.group_id === groupId,
        );
        if (found === undefined) throw new Error('No such load row.');
        return found.id;
      };
      await t.database.migrator
        .deleteFrom('teaching_load_rows')
        .where('id', '=', rowOfUnit(s.maths, s.princeton))
        .execute();
      await placeAt(s.branch, version, rowOfUnit(s.maths, s.oxford), 1, 1);
      await placeAt(s.branch, version, rowOfUnit(s.english, null, s.groups[0] ?? ''), 1, 3);
      await placeAt(s.branch, version, rowOfUnit(s.physics, s.oxford), 2, 3);
      await placeAt(s.branch, version, rowOfUnit(s.physics, s.oxford), 2, 5);
      const confirmed = await t.post(
        `/api/timetable/versions/${version}/templates/confirm`,
        s.branch,
      );
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      await load.freeEditLock(version);
      return version;
    }

    it('runs a bulk cancel and a publish that removes its lesson one after the other, in either order', async () => {
      for (const order of [0, 1]) {
        const s = await scene();
        const draft = await withoutPrincetonMaths(s);
        const maths = await oneLesson(s, '2026-10-26', { classId: s.princeton }, s.maths);
        const bulk = () =>
          save(s.branch, {
            date: '2026-10-26',
            classIds: [s.princeton],
            lessonNumbers: [1],
            lessonIds: [maths.id],
          });
        const send = () => publish(s.branch, draft, NEXT_MONDAY);
        const [a, b] = await inOrder(
          s.branch,
          order === 0 ? send : bulk,
          order === 0 ? bulk : send,
        );
        const [published, bulkAnswer] = order === 0 ? [a, b] : [b, a];
        if (order === 1) {
          // Task 5.6a-5b-1 (Look first, a requirement added): the bulk cancel
          // committed first is one the publish was not shown, so the publish
          // is refused until it is sent with the key of the sorting that has it.
          refusedWith(published, 409, 'publish_blocked');
          expect(
            (published.body as { error: { details: { code: string }[] } }).error.details.map(
              (one) => one.code,
            ),
          ).toEqual(['day_changes_changed']);
          const shown = await t.get(
            `/api/timetable/versions/${draft}/publish-check?startsOn=${NEXT_MONDAY}`,
            s.branch,
          );
          expect(shown.status, JSON.stringify(shown.body)).toBe(200);
          const again = await request(t.kit.server)
            .post(`/api/timetable/versions/${draft}/publish`)
            .set('Cookie', t.admin)
            .set(BRANCH_HEADER, s.branch)
            .set(REQUEST_KEY_HEADER, randomUUID())
            .send({
              startsOn: NEXT_MONDAY,
              dayChangesKey: (shown.body as { impact: { dayChanges: { key: string } } }).impact
                .dayChanges.key,
            });
          expect(again.status, JSON.stringify(again.body)).toBe(200);
        } else {
          expect(published.status, JSON.stringify(published.body)).toBe(200);
        }
        expect(await rowOf(maths.id)).toBeUndefined();
        if (order === 0) {
          // Published first: the bulk cancel, checked before the lock, finds the lesson gone under it.
          refusedWith(bulkAnswer, 409, 'bulk_cancel_empty');
          expect(
            (await t.entries('lesson.bulk_cancel')).filter((one) => one.branch_id === s.branch),
          ).toEqual([]);
        } else {
          expect(bulkAnswer.status, JSON.stringify(bulkAnswer.body)).toBe(200);
          expect(bulkCancelAnswerSchema.parse(bulkAnswer.body).cancelled).toEqual([maths.id]);
        }
      }
    });

    it('runs a bulk cancel and a cancel of one of its lessons one after the other, in either order', async () => {
      for (const order of [0, 1]) {
        const s = await scene();
        const body = { date: NEXT_MONDAY, classIds: [s.princeton], lessonNumbers: [1] };
        const maths = await oneLesson(s, NEXT_MONDAY, { classId: s.princeton }, s.maths);
        const bulk = () => save(s.branch, { ...body, lessonIds: [maths.id] });
        const one = () =>
          keyed(
            `/api/timetable/lessons/${maths.id}/cancel`,
            s.branch,
            { reason: 'The teacher is at a seminar' },
            t.admin,
            randomUUID(),
          );
        const [a, b] = await inOrder(s.branch, order === 0 ? bulk : one, order === 0 ? one : bulk);
        const [bulkAnswer, oneAnswer] = order === 0 ? [a, b] : [b, a];
        if (order === 0) {
          expect(bulkAnswer.status, JSON.stringify(bulkAnswer.body)).toBe(200);
          refusedWith(oneAnswer, 409, 'lesson_cancelled');
          expect((await rowOf(maths.id))?.cancel_reason).toBe('Excursion to the museum');
        } else {
          expect(oneAnswer.status, JSON.stringify(oneAnswer.body)).toBe(200);
          // The lesson was cancelled first: nothing is left to cancel.
          refusedWith(bulkAnswer, 409, 'bulk_cancel_empty');
          expect((await rowOf(maths.id))?.cancel_reason).toBe('The teacher is at a seminar');
        }
      }
    });
  });
});
