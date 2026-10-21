import { randomUUID } from 'node:crypto';
import {
  BRANCH_HEADER,
  REQUEST_KEY_HEADER,
  gridSchema,
  publishCheckSchema,
  timetableVersionSchema,
  type GridAnswer,
  type TimetableVersion,
} from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, MONDAY, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';

/** The quarters of the year 2026-09-01 to 2027-05-31, dated. */
const QUARTERS = [
  ['2026-09-01', '2026-10-31'],
  ['2026-11-09', '2026-12-28'],
  ['2027-01-11', '2027-03-20'],
  ['2027-03-30', '2027-05-31'],
] as const;

/** The second quarter's first day, a Monday: the start of a restored draft. */
const NOVEMBER = '2026-11-09';
/** The day a template given after the source took effect (before NOVEMBER). */
const NEW_TEMPLATE_FROM = '2026-11-01';

const versionOf = (response: Response, status = 200): TimetableVersion => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return timetableVersionSchema.parse(response.body);
};

// All names are invented. Task 5.8a, pull request #194: every copy of a
// version takes its weekly pattern (5.5a-3a decision 4), and "'Restore an
// earlier version' always means copy it to a new draft; entries whose
// teacher, room, subject or class is no longer active go to the 'to place'
// list" (edge/timetable, Versions and drafts; edge/academic-year: "with the
// reason"). Plan rules 2 to 6, decisions 6 to 8. The clock stands at 23:55
// on Saturday 10 October 2026 in Tashkent.
describe('the pattern of a copied version', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  const post = (path: string, branch: string, body: object = {}) =>
    t.post(path, branch, body, t.admin);

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

  const draft = async (
    branch: string,
    year: string,
    copyFrom: string | null = null,
    startsOn = MONDAY,
  ) => {
    const created = await post('/api/timetable/versions', branch, {
      academicYearId: year,
      startsOn,
      copyFrom,
    });
    return versionOf(created, 201);
  };

  const place = async (
    branch: string,
    version: string,
    loadRowId: string,
    weekday: number,
    slotPosition: number,
    more: object = {},
  ) => {
    const placed = await post(`/api/timetable/versions/${version}/pattern`, branch, {
      loadRowId,
      weekday,
      slotPosition,
      ...more,
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  };

  const gridOf = async (branch: string, version: string): Promise<GridAnswer> => {
    const answer = await t.get(`/api/timetable/versions/${version}/grid`, branch);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return gridSchema.parse(answer.body);
  };

  /** The blocks of a version with their lessons' rows (by subject) and rooms, in weekday and start order. */
  const blocksOf = async (version: string) => {
    const blocks = await t.database.migrator
      .selectFrom('pattern_blocks')
      .select(['id', 'weekday', 'slot_position', 'start_minutes', 'end_minutes', 'double_pair_id'])
      .where('version_id', '=', version)
      .orderBy('weekday')
      .orderBy('start_minutes')
      .orderBy('id')
      .execute();
    const entries = await t.database.migrator
      .selectFrom('pattern_entries')
      .innerJoin('teaching_load_rows', 'teaching_load_rows.id', 'pattern_entries.load_row_id')
      .select([
        'pattern_entries.id',
        'pattern_entries.block_id',
        'pattern_entries.room_id',
        'teaching_load_rows.subject_id',
        'teaching_load_rows.class_id',
        'teaching_load_rows.group_id',
        'teaching_load_rows.version_id',
      ])
      .where('pattern_entries.version_id', '=', version)
      .orderBy('pattern_entries.id')
      .execute();
    return blocks.map((block) => ({
      ...block,
      entries: entries.filter((entry) => entry.block_id === block.id),
    }));
  };

  const leftBlocksOf = async (version: string) =>
    (
      await t.database.migrator
        .selectFrom('timetable_versions')
        .select('left_blocks')
        .where('id', '=', version)
        .executeTakeFirstOrThrow()
    ).left_blocks as {
      sourceBlockId: string;
      weekday: number;
      slotPosition: number;
      reason: string;
      lessons: { sourceRowId: string; copied: boolean; reason: string }[];
    }[];

  /**
   * A branch of its own with a year of four dated quarters, a day of four
   * lessons with breaks (lessons at positions 1, 3, 5, 7) on every weekday
   * from 08:00, a class of grade 7 and a subject with a teacher of grade 7
   * with hours all week, and an empty draft from Monday 12 October.
   */
  async function scene() {
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
      pause,
      lesson,
    ]);
    await t.assign(branch, regular);
    const classId = await load.classes.schoolClass(branch, year, { grade: 7 });
    const subject = await load.classes.subject({ grades: [5, 7], journalType: 'attendance_only' });
    const teacher = (await load.teacher(branch, { subjects: [{ subject, grades: [5, 7] }] }))
      .staffId;
    await hours(branch, teacher);
    const version = (await draft(branch, year)).id;
    const row = (values: {
      classId?: string;
      groupId?: string;
      subjectId?: string;
      teacherId?: string;
      lessons?: number;
      double?: boolean;
    }) =>
      load.row({
        branch_id: branch,
        version_id: version,
        class_id: values.groupId === undefined ? (values.classId ?? classId) : null,
        group_id: values.groupId ?? null,
        subject_id: values.subjectId ?? subject,
        teacher_id: values.teacherId ?? teacher,
        lessons_per_week: values.lessons ?? 1,
        double_lessons: values.double ?? false,
      });
    const teacherOf = async (grades: readonly number[], subjectId = subject) => {
      const staffId = (await load.teacher(branch, { subjects: [{ subject: subjectId, grades }] }))
        .staffId;
      await hours(branch, staffId);
      return staffId;
    };
    return {
      branch,
      year,
      classId,
      subject,
      teacher,
      version,
      lesson,
      pause,
      row,
      teacherOf,
      placeIn: (loadRowId: string, weekday: number, slot: number, more: object = {}) =>
        place(branch, version, loadRowId, weekday, slot, more),
    };
  }

  it('copies every block with new ids at its weekday and slot, and records it', async () => {
    const s = await scene();
    const maths = await s.row({ lessons: 2 });
    await s.placeIn(maths, 1, 1);
    await s.placeIn(maths, 2, 3);
    // A pin of the row (task 5.3b-2): still copied beside the pattern.
    await t.database.migrator
      .insertInto('timetable_pins')
      .values({
        branch_id: s.branch,
        version_id: s.version,
        load_row_id: maths,
        weekday: 1,
        slot_position: 1,
      })
      .execute();
    const source = await blocksOf(s.version);
    const copy = await draft(s.branch, s.year, s.version);
    expect(copy.leftBlocks).toBe(0);
    const copied = await blocksOf(copy.id);
    expect(copied.map((one) => [one.weekday, one.slot_position, one.start_minutes])).toEqual(
      source.map((one) => [one.weekday, one.slot_position, one.start_minutes]),
    );
    for (const block of copied) {
      expect(source.some((one) => one.id === block.id)).toBe(false);
      expect(block.entries.map((one) => one.version_id)).toEqual([copy.id]);
    }
    // The source is as it was.
    expect(await blocksOf(s.version)).toEqual(source);
    const [entry] = await t.entries('timetable_version.create', copy.id);
    expect(entry?.new_value).toMatchObject({ copiedBlocks: 2, leftBlocks: [] });
    const pins = await t.database.migrator
      .selectFrom('timetable_pins')
      .innerJoin('teaching_load_rows', 'teaching_load_rows.id', 'timetable_pins.load_row_id')
      .select([
        'timetable_pins.weekday',
        'timetable_pins.slot_position',
        'teaching_load_rows.subject_id',
      ])
      .where('timetable_pins.version_id', '=', copy.id)
      .execute();
    expect(pins).toEqual([{ weekday: 1, slot_position: 1, subject_id: s.subject }]);
  });

  it('gives a double lesson a new pair id in each of two copies of one source', async () => {
    const s = await scene();
    const maths = await s.row({ lessons: 2, double: true });
    await s.placeIn(maths, 3, 1, { double: true });
    const [sourcePair] = (await blocksOf(s.version)).map((one) => one.double_pair_id);
    const first = await draft(s.branch, s.year, s.version);
    const second = await draft(s.branch, s.year, s.version);
    const pairs = [
      ...(await blocksOf(first.id)).map((one) => one.double_pair_id),
      ...(await blocksOf(second.id)).map((one) => one.double_pair_id),
    ];
    expect(pairs).toHaveLength(4);
    expect(pairs[0]).not.toBeNull();
    expect(pairs[0]).toBe(pairs[1]);
    expect(pairs[2]).toBe(pairs[3]);
    expect(pairs[0]).not.toBe(pairs[2]);
    expect(pairs).not.toContain(sourcePair);
  });

  it('lists an archived teacher and a closed room in "To place" with their reasons (edge/academic-year)', async () => {
    const s = await scene();
    const artSubject = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const physicsSubject = await load.classes.subject({
      grades: [7],
      journalType: 'attendance_only',
    });
    const leaving = await s.teacherOf([7], artSubject);
    const maths = await s.row({});
    const art = await s.row({ subjectId: artSubject, teacherId: leaving });
    const physics = await s.row({
      subjectId: physicsSubject,
      teacherId: await s.teacherOf([7], physicsSubject),
    });
    const lab = await load.classes.room(s.branch);
    await s.placeIn(maths, 1, 1);
    await s.placeIn(art, 1, 3);
    await s.placeIn(physics, 1, 5, { roomId: lab });
    // The teacher of Art has left and the laboratory is closed by the restore.
    await load.status(leaving, 'left', NEW_TEMPLATE_FROM);
    await t.database.migrator
      .updateTable('rooms')
      .set({ status: 'closed' })
      .where('id', '=', lab)
      .execute();
    const copy = await draft(s.branch, s.year, s.version, NOVEMBER);
    expect(copy.leftRows).toBe(1);
    expect(copy.leftBlocks).toBe(2);
    expect((await blocksOf(copy.id)).map((one) => one.slot_position)).toEqual([1]);
    const left = await leftBlocksOf(copy.id);
    expect(left.map((one) => [one.slotPosition, one.reason])).toEqual([
      [3, 'load_teacher_status'],
      [5, 'copy_room_inactive'],
    ]);
    const [created] = await t.entries('timetable_version.create', copy.id);
    expect(created?.new_value).toMatchObject({ leftBlocks: await leftBlocksOf(copy.id) });
    expect(
      left.map((one) => one.lessons.map((lesson) => [lesson.sourceRowId, lesson.copied])),
    ).toEqual([[[art, false]], [[physics, true]]]);
    const grid = await gridOf(s.branch, copy.id);
    expect(grid.left.blocks).toEqual(left);
    // The rows named for the panel, the row the copy did not keep included.
    expect(grid.left.rows.map((one) => one.id).sort()).toEqual([art, physics].sort());
  });

  it('takes the times of the template in force on the draft start, and leaves a slot it no longer has', async () => {
    const s = await scene();
    const maths = await s.row({ lessons: 2 });
    await s.placeIn(maths, 1, 1);
    await s.placeIn(maths, 1, 7);
    // From 1 November: two lessons from 09:00.
    const short = await t.createTemplate(s.branch, 'Short', [s.lesson, s.pause, s.lesson], '09:00');
    await t.assign(s.branch, short, {}, NEW_TEMPLATE_FROM);
    const copy = await draft(s.branch, s.year, s.version, NOVEMBER);
    const copied = await blocksOf(copy.id);
    expect(copied.map((one) => [one.slot_position, one.start_minutes, one.end_minutes])).toEqual([
      [1, 540, 585],
    ]);
    const left = await leftBlocksOf(copy.id);
    expect(left.map((one) => [one.weekday, one.slotPosition, one.reason])).toEqual([
      [1, 7, 'copy_slot_missing'],
    ]);
    const [entry] = await t.entries('timetable_version.create', copy.id);
    expect(entry?.new_value).toMatchObject({ copiedBlocks: 1, leftBlocks: left });
  });

  /**
   * Grade 7 on the Regular day from 08:00, grade 5 on a Late day from 09:45
   * until 1 November, then on the Regular day too: a lesson of grade 5 in
   * slot 3 moves onto the time of grade 7's slot 3 in a copy for November.
   */
  async function retimedScene() {
    const s = await scene();
    const late = await t.createTemplate(
      s.branch,
      'Late',
      [s.lesson, s.pause, s.lesson, s.pause, s.lesson, s.pause, s.lesson],
      '09:45',
    );
    await t.assign(s.branch, late, { level: 'grades', gradeFrom: 5, gradeTo: 5 });
    const early = await t.createTemplate(
      s.branch,
      'Early',
      [s.lesson, s.pause, s.lesson, s.pause, s.lesson, s.pause, s.lesson],
      '08:00',
    );
    await t.assign(
      s.branch,
      early,
      { level: 'grades', gradeFrom: 5, gradeTo: 5 },
      NEW_TEMPLATE_FROM,
    );
    const junior = await load.classes.schoolClass(s.branch, s.year, { grade: 5 });
    return { ...s, junior };
  }

  it("leaves a two-grade group's lesson in a slot whose times its grades no longer share (copy_slot_missing)", async () => {
    const s = await scene();
    // From 1 November grade 5 has a longer second break: its slot 5 starts
    // 10 minutes later than grade 7's, slots 1 and 3 stay shared.
    const longPause = await t.createSlotType(s.branch, 'Long break', 'break', 20);
    const later = await t.createTemplate(s.branch, 'Later', [
      s.lesson,
      s.pause,
      s.lesson,
      longPause,
      s.lesson,
      s.pause,
      s.lesson,
    ]);
    await t.assign(
      s.branch,
      later,
      { level: 'grades', gradeFrom: 5, gradeTo: 5 },
      NEW_TEMPLATE_FROM,
    );
    const junior = await load.classes.schoolClass(s.branch, s.year, { grade: 5 });
    const sport = await load.classes.subject({ grades: [5, 7], journalType: 'attendance_only' });
    const group = await load.classes.group(s.branch, s.year, sport, [s.classId, junior]);
    const coach = await s.teacherOf([5, 7], sport);
    const together = await s.row({ groupId: group, subjectId: sport, teacherId: coach });
    const maths = await s.row({});
    await s.placeIn(together, 1, 5);
    await s.placeIn(maths, 1, 1);
    const copy = await draft(s.branch, s.year, s.version, NOVEMBER);
    // The row is copied (slots 1 and 3 are shared); its lesson in slot 5 is not.
    expect(copy.leftRows).toBe(0);
    expect((await blocksOf(copy.id)).map((one) => one.slot_position)).toEqual([1]);
    expect((await leftBlocksOf(copy.id)).map((one) => [one.slotPosition, one.reason])).toEqual([
      [5, 'copy_slot_missing'],
    ]);
    const [created] = await t.entries('timetable_version.create', copy.id);
    expect(created?.new_value).toMatchObject({ leftBlocks: await leftBlocksOf(copy.id) });
  });

  it('leaves both halves of a double when its later half would clash, the earlier one with copy_pair_left', async () => {
    const s = await retimedScene();
    const senior = await s.row({});
    const junior = await s.row({ classId: s.junior, lessons: 2, double: true });
    await s.placeIn(senior, 1, 3);
    // Grade 5 on Monday at 09:45 and 10:40; the same teacher is at 08:55 with grade 7.
    await s.placeIn(junior, 1, 1, { double: true });
    const copy = await draft(s.branch, s.year, s.version, NOVEMBER);
    expect(
      (await blocksOf(copy.id)).map((one) => one.entries.map((entry) => entry.class_id)),
    ).toEqual([[s.classId]]);
    const left = await leftBlocksOf(copy.id);
    expect(left.map((one) => [one.slotPosition, one.reason])).toEqual([
      [1, 'copy_pair_left'],
      [3, 'copy_clash'],
    ]);
    const [created] = await t.entries('timetable_version.create', copy.id);
    expect(created?.new_value).toMatchObject({ leftBlocks: await leftBlocksOf(copy.id) });
    // Nothing of the pair was written: no lone half.
    const pairs = await t.database.migrator
      .selectFrom('pattern_blocks')
      .select('id')
      .where('version_id', '=', copy.id)
      .where('double_pair_id', 'is not', null)
      .execute();
    expect(pairs).toEqual([]);
  });

  it("leaves a block over a shared room's number at once, and the copy commits", async () => {
    const s = await retimedScene();
    const hall = await load.classes.room(s.branch);
    await t.database.migrator
      .updateTable('rooms')
      .set({ shared: true, max_simultaneous_lessons: 2 })
      .where('id', '=', hall)
      .execute();
    // Two classes of grade 7 in the hall at 08:55; grade 5 there at 10:40 until November.
    const parallel = await load.classes.schoolClass(s.branch, s.year, { grade: 7 });
    const senior = await s.row({});
    const second = await s.row({ classId: parallel, teacherId: await s.teacherOf([7]) });
    const junior = await s.row({ classId: s.junior, teacherId: await s.teacherOf([5]) });
    await s.placeIn(senior, 2, 3, { roomId: hall });
    await s.placeIn(second, 2, 3, { roomId: hall });
    await s.placeIn(junior, 2, 3, { roomId: hall });
    const copy = await draft(s.branch, s.year, s.version, NOVEMBER);
    expect(
      (await blocksOf(copy.id)).flatMap((one) => one.entries.map((entry) => entry.class_id)).sort(),
    ).toEqual([s.classId, parallel].sort());
    expect((await leftBlocksOf(copy.id)).map((one) => one.reason)).toEqual(['copy_clash']);
    const [created] = await t.entries('timetable_version.create', copy.id);
    expect(created?.new_value).toMatchObject({ leftBlocks: await leftBlocksOf(copy.id) });
  });

  it('leaves a split block whole when one group row is left', async () => {
    const s = await scene();
    const english = await load.classes.subject({ grades: [7], journalType: 'attendance_only' });
    const first = await load.classes.group(s.branch, s.year, english, [s.classId]);
    const second = await load.classes.group(s.branch, s.year, english, [s.classId]);
    const staying = await s.teacherOf([7], english);
    const leaving = await s.teacherOf([7], english);
    const a = await s.row({ groupId: first, subjectId: english, teacherId: staying });
    const b = await s.row({ groupId: second, subjectId: english, teacherId: leaving });
    await s.placeIn(a, 4, 1);
    await load.status(leaving, 'left', NEW_TEMPLATE_FROM);
    const copy = await draft(s.branch, s.year, s.version, NOVEMBER);
    expect(await blocksOf(copy.id)).toEqual([]);
    const [left] = await leftBlocksOf(copy.id);
    expect(left?.reason).toBe('load_teacher_status');
    const [created] = await t.entries('timetable_version.create', copy.id);
    expect(created?.new_value).toMatchObject({ leftBlocks: await leftBlocksOf(copy.id) });
    const reasons = new Map(left?.lessons.map((one) => [one.sourceRowId, one.reason]));
    expect(reasons.get(b)).toBe('load_teacher_status');
    expect(reasons.get(a)).toBe('copy_part_left');
  });

  it('copies the pattern of an archived version and leaves the published ones and their lessons as they were', async () => {
    const s = await scene();
    const maths = await s.row({});
    await s.placeIn(maths, 1, 1);
    await post(`/api/timetable/versions/${s.version}/templates/confirm`, s.branch);
    await load.freeEditLock(s.version);
    const published = await request(t.kit.server)
      .post(`/api/timetable/versions/${s.version}/publish`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, s.branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ startsOn: MONDAY });
    versionOf(published);
    const lessonsBefore = await t.database.migrator
      .selectFrom('lessons')
      .select(['id', sql<string>`lesson_date::text`.as('date'), 'teacher_id'])
      .where('branch_id', '=', s.branch)
      .orderBy('id')
      .execute();
    expect(lessonsBefore.length).toBeGreaterThan(0);
    // An archived version of the year: a draft of it archived by hand.
    const old = await draft(s.branch, s.year, s.version);
    await load.setVersion(old.id, 'archived');
    const restored = await draft(s.branch, s.year, old.id, '2027-01-11');
    expect(restored.fromVersion).toEqual({ id: old.id, number: old.number });
    expect((await blocksOf(restored.id)).map((one) => [one.weekday, one.slot_position])).toEqual([
      [1, 1],
    ]);
    expect(
      await t.database.migrator
        .selectFrom('lessons')
        .select(['id', sql<string>`lesson_date::text`.as('date'), 'teacher_id'])
        .where('branch_id', '=', s.branch)
        .orderBy('id')
        .execute(),
    ).toEqual(lessonsBefore);
    const status = await t.database.migrator
      .selectFrom('timetable_versions')
      .select('status')
      .where('id', '=', s.version)
      .executeTakeFirstOrThrow();
    expect(status.status).toBe('published');
  });

  it('offers "carry the change into them" for a copy whose only change is a teacher (5.5a-3a decision 4)', async () => {
    const s = await scene();
    const maths = await s.row({});
    await s.placeIn(maths, 1, 1);
    const confirm = async (version: string) => {
      const confirmed = await post(
        `/api/timetable/versions/${version}/templates/confirm`,
        s.branch,
      );
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      await load.freeEditLock(version);
    };
    const publish = (version: string, startsOn: string) =>
      request(t.kit.server)
        .post(`/api/timetable/versions/${version}/publish`)
        .set('Cookie', t.admin)
        .set(BRANCH_HEADER, s.branch)
        .set(REQUEST_KEY_HEADER, randomUUID())
        .send({ startsOn });
    await confirm(s.version);
    versionOf(await publish(s.version, MONDAY));
    const later = await draft(s.branch, s.year, s.version, NOVEMBER);
    await confirm(later.id);
    versionOf(await publish(later.id, NOVEMBER));
    const fix = await draft(s.branch, s.year, s.version, '2026-10-19');
    const [fixRow] = await t.database.migrator
      .selectFrom('teaching_load_rows')
      .select('id')
      .where('version_id', '=', fix.id)
      .execute();
    if (fixRow === undefined) throw new Error('The copy has its row.');
    const edited = await t.patch(`/api/timetable/versions/${fix.id}/load/${fixRow.id}`, s.branch, {
      teacherId: await s.teacherOf([7]),
      lessonsPerWeek: 1,
      roomId: null,
      roomType: null,
      doubleLessons: false,
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    await confirm(fix.id);
    const checked = await t.get(
      `/api/timetable/versions/${fix.id}/publish-check?startsOn=2026-10-19&chain=carry`,
      s.branch,
    );
    expect(checked.status, JSON.stringify(checked.body)).toBe(200);
    const answer = publishCheckSchema.parse(checked.body);
    expect(answer.chain?.carryOffered).toBe(true);
    expect(answer.chain?.changes.map((one) => one.kind)).toEqual(['teacher']);
  });

  it('dismisses left blocks with no left rows, and records it', async () => {
    const s = await scene();
    const maths = await s.row({ lessons: 2 });
    await s.placeIn(maths, 1, 1);
    await s.placeIn(maths, 1, 7);
    const short = await t.createTemplate(s.branch, 'Short', [s.lesson, s.pause, s.lesson], '09:00');
    await t.assign(s.branch, short, {}, NEW_TEMPLATE_FROM);
    const copy = await draft(s.branch, s.year, s.version, NOVEMBER);
    expect([copy.leftRows, copy.leftBlocks]).toEqual([0, 1]);
    const left = await leftBlocksOf(copy.id);
    const dismissed = versionOf(
      await t.patch(`/api/timetable/versions/${copy.id}`, s.branch, { dismissLeftRows: true }),
    );
    expect(dismissed.leftBlocks).toBe(0);
    expect(await leftBlocksOf(copy.id)).toEqual([]);
    const [entry] = await t.entries('timetable_version.edit', copy.id);
    expect(entry?.old_value).toMatchObject({ leftBlocks: left });
  });

  /** The room edit's route: the lab closed (`PUT /api/setup/rooms/:id`). */
  const closeRoom = async (branch: string, roomId: string) => {
    const room = await t.database.migrator
      .selectFrom('rooms')
      .select(['name', 'floor_id', 'type', 'capacity'])
      .where('id', '=', roomId)
      .executeTakeFirstOrThrow();
    return t.put(`/api/setup/rooms/${roomId}`, branch, {
      name: room.name,
      floorId: room.floor_id,
      type: room.type,
      capacity: room.capacity,
      status: 'closed',
      shared: false,
      maxSimultaneousLessons: null,
    });
  };

  /** Waits until `count` statements of the database wait for a lock. */
  const lockWaits = async (count: number) => {
    for (let tries = 0; tries < 200; tries += 1) {
      const waiting = await sql<{ n: number }>`
        select count(*)::int as n from pg_locks l
        join pg_stat_activity a on a.pid = l.pid
        where not l.granted and a.datname = current_database()
      `.execute(t.database.migrator);
      if ((waiting.rows[0]?.n ?? 0) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Nothing waits for a lock.');
  };

  /**
   * A transaction that holds a row FOR UPDATE until `release` is called, so
   * the first route waits on it with its own locks taken.
   */
  const holdRow = async (table: 'classes' | 'timetable_versions', id: string) => {
    let release = () => undefined as void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = () => undefined as void;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const done = t.database.migrator.transaction().execute(async (transaction) => {
      await transaction.selectFrom(table).select('id').where('id', '=', id).forUpdate().execute();
      locked();
      await released;
    });
    await isLocked;
    return { release, done };
  };

  // .claude/rules/api.md: each pair that meets on a row is tested in both
  // directions, both routes real (`inOrder`). Plan rule 2: the copy takes the
  // rooms of its source's entries FOR KEY SHARE before it reads their status.
  it('a room edit that holds the room first: the copy waits and sees the room closed', async () => {
    const s = await scene();
    const maths = await s.row({});
    const lab = await load.classes.room(s.branch);
    await s.placeIn(maths, 1, 1, { roomId: lab });
    // Another draft of the branch, held, so the edit waits on its mark with the room locked.
    const other = await draft(s.branch, s.year);
    const hold = await holdRow('timetable_versions', other.id);
    const editing = closeRoom(s.branch, lab).then((answer) => answer);
    await lockWaits(1);
    const copying = draft(s.branch, s.year, s.version, NOVEMBER);
    await lockWaits(2);
    hold.release();
    await hold.done;
    expect((await editing).status).toBe(200);
    const created = await copying;
    expect((await leftBlocksOf(created.id)).map((one) => one.reason)).toEqual([
      'copy_room_inactive',
    ]);
  });

  it('a copy that holds the room first: the room edit waits, then marks the new draft out of date', async () => {
    const s = await scene();
    const maths = await s.row({});
    const lab = await load.classes.room(s.branch);
    await s.placeIn(maths, 1, 1, { roomId: lab });
    // The class, held, so the copy waits on its row's key with the room locked.
    const hold = await holdRow('classes', s.classId);
    const copying = draft(s.branch, s.year, s.version, NOVEMBER);
    await lockWaits(1);
    const editing = closeRoom(s.branch, lab).then((answer) => answer);
    await lockWaits(2);
    hold.release();
    await hold.done;
    const created = await copying;
    expect(created.leftBlocks).toBe(0);
    expect((await editing).status).toBe(200);
    const causes = await t.database.migrator
      .selectFrom('timetable_version_out_of_date_causes')
      .select(['action', 'record_id'])
      .where('version_id', '=', created.id)
      .execute();
    expect(causes).toEqual([{ action: 'room.edit', record_id: lab }]);
  });
});
