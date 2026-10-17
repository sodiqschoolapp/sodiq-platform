import { BRANCH_HEADER, gridSchema, type GridAnswer } from '@sodiq/shared';
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

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const gridOf = (response: Response, status = 200): GridAnswer => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return gridSchema.parse(response.body);
};

/** The rules named by a `pattern_blocked` refusal. */
const blockedRules = (response: Response): string[] => {
  refusedWith(response, 409, 'pattern_blocked');
  const body = response.body as { error: { details: { code: string }[] } };
  return body.error.details.map((detail) => detail.code);
};

// All names are invented. Task 5.4a: the grid of step 7 (docs/spec/06-timetable.md,
// Editing in the grid: "Lessons are dragged onto the grid, or added by
// clicking an empty lesson slot ... While dragging, each slot shows free,
// warning or blocked, with the reason"; 14, Timetable, One rule engine: "The
// same checking code runs in the browser while dragging and on the server when
// saving"). The clock stands at 23:55 on Saturday 10 October 2026 in Tashkent;
// a draft starts on Monday 12 October.
describe('the grid of a draft', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;

  beforeAll(async () => {
    // Task 5.4c-1: a takeover notifies the earlier holder, through the job queue.
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
  });

  afterAll(async () => {
    await t.close();
  });

  const get = (path: string, branch: string, cookie = t.admin) => t.get(path, branch, cookie);
  const post = (path: string, branch: string, body: object = {}, cookie = t.admin) =>
    t.post(path, branch, body, cookie);
  const remove = (path: string, branch: string, cookie = t.admin) =>
    request(t.kit.server).delete(path).set('Cookie', cookie).set(BRANCH_HEADER, branch);

  const grid = (branch: string, version: string, cookie = t.admin) =>
    get(`/api/timetable/versions/${version}/grid`, branch, cookie);
  const place = (
    branch: string,
    version: string,
    loadRowId: string,
    weekday: number,
    slotPosition: number,
    cookie = t.admin,
  ) =>
    post(
      `/api/timetable/versions/${version}/pattern`,
      branch,
      { loadRowId, weekday, slotPosition },
      cookie,
    );
  const move = (
    branch: string,
    version: string,
    blockId: string,
    weekday: number,
    slotPosition: number,
    cookie = t.admin,
  ) =>
    post(
      `/api/timetable/versions/${version}/pattern/${blockId}/move`,
      branch,
      { weekday, slotPosition },
      cookie,
    );
  const swap = (branch: string, version: string, a: string, b: string, cookie = t.admin) =>
    post(`/api/timetable/versions/${version}/pattern/swap`, branch, { blockIds: [a, b] }, cookie);
  const drop = (branch: string, version: string, blockId: string, cookie = t.admin) =>
    remove(`/api/timetable/versions/${version}/pattern/${blockId}`, branch, cookie);

  /** Places a row and answers the id of the new block (the one holding the row at that slot). */
  const placed = async (
    branch: string,
    version: string,
    loadRowId: string,
    weekday: number,
    slotPosition: number,
  ): Promise<{ answer: GridAnswer; id: string }> => {
    const answer = gridOf(await place(branch, version, loadRowId, weekday, slotPosition), 201);
    const block = answer.blocks.find(
      (one) =>
        one.weekday === weekday &&
        one.slotPosition === slotPosition &&
        one.lessons.some((lesson) => lesson.loadRowId === loadRowId),
    );
    if (block === undefined) throw new Error('The block was not answered.');
    return { answer, id: block.id };
  };

  const patternRows = (versions: readonly string[]) =>
    Promise.all([
      t.database.migrator
        .selectFrom('pattern_blocks')
        .selectAll()
        .where('version_id', 'in', versions)
        .orderBy('id')
        .execute(),
      t.database.migrator
        .selectFrom('pattern_entries')
        .selectAll()
        .where('version_id', 'in', versions)
        .orderBy('id')
        .execute(),
      // Task 5.4c-1: every draft write takes the edit lock on the version row, and locks.
      t.database.migrator
        .selectFrom('timetable_versions')
        .selectAll()
        .where('id', 'in', versions)
        .orderBy('id')
        .execute(),
      t.database.migrator
        .selectFrom('timetable_locks')
        .selectAll()
        .where('version_id', 'in', versions)
        .orderBy('id')
        .execute(),
      // A takeover of the edit lock notifies the earlier holder (permission review, S2).
      t.database.migrator.selectFrom('notifications').selectAll().orderBy('id').execute(),
      // Written by the trigger of the entries and the cascading key (0058).
      t.database.migrator
        .selectFrom('pattern_block_classes')
        .selectAll()
        .where('version_id', 'in', versions)
        .orderBy('block_id')
        .orderBy('class_id')
        .execute(),
      t.auditCount(),
    ]);

  /** Hours of a person in the branch from 1 September, on the weekdays named, all day. */
  async function hours(branch: string, staffId: string, weekdays: readonly number[]) {
    const entry = await t.database.migrator
      .insertInto('staff_availability')
      .values({ branch_id: branch, staff_id: staffId, valid_from: '2026-09-01' })
      .returning(['id', 'valid_until'])
      .executeTakeFirstOrThrow();
    for (const weekday of weekdays) {
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

  /** A teacher of the subject in the grades named, with hours every working day. */
  async function teacher(branch: string, subject: string, grades: readonly number[] = [7]) {
    const staffId = (await load.teacher(branch, { subjects: [{ subject, grades }] })).staffId;
    await hours(branch, staffId, [1, 2, 3, 4, 5]);
    return staffId;
  }

  /**
   * A branch of its own whose day is lesson, break, lesson, break, lesson
   * (positions 1 to 5: 08:00–08:45, a break, 08:55–09:40, a break,
   * 09:50–10:35), a draft from Monday, and two classes of grade 7, each with
   * its main classroom and a row of three lessons a week by a teacher of its own.
   */
  async function scene() {
    const branch = await t.newBranch();
    const year = await load.classes.year(branch);
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
    const subject = await load.classes.subject({ grades: [2, 7] });
    const roomA = await load.classes.room(branch);
    const roomB = await load.classes.room(branch);
    const classA = await load.classes.schoolClass(branch, year, { grade: 7, room: roomA });
    const classB = await load.classes.schoolClass(branch, year, { grade: 7, room: roomB });
    const teacherA = await teacher(branch, subject, [2, 7]);
    const teacherB = await teacher(branch, subject);
    const created = await post('/api/timetable/versions', branch, {
      academicYearId: year,
      startsOn: MONDAY,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const version = (created.body as { id: string }).id;
    const row = (classId: string, teacherId: string, extra: object = {}) =>
      load.row({
        branch_id: branch,
        version_id: version,
        class_id: classId,
        subject_id: subject,
        teacher_id: teacherId,
        lessons_per_week: 3,
        ...extra,
      });
    const rowA = await row(classA, teacherA);
    const rowB = await row(classB, teacherB);
    return {
      branch,
      year,
      version,
      subject,
      roomA,
      roomB,
      classA,
      classB,
      teacherA,
      teacherB,
      rowA,
      rowB,
      row,
    };
  }

  /** Task 5.4c-1: the edit lock held by the kit's Teacher account, last active 10 minutes ago. */
  const staleEditLock = async (version: string) => {
    const holder = await t.database.migrator
      .selectFrom('assignments')
      .select('account_id')
      .where('role', '=', 'teacher')
      .where('branch_id', '=', t.north)
      .executeTakeFirstOrThrow();
    await t.database.migrator
      .updateTable('timetable_versions')
      .set({
        edit_holder_id: holder.account_id,
        edit_seen_at: new Date(t.clock.now().getTime() - 10 * 60_000),
      })
      .where('id', '=', version)
      .execute();
  };

  /** The kit's Academic Vice Principal, given the role in a branch of a scene too. */
  const viceIn = async (branch: string) => {
    const vice = await t.database.migrator
      .selectFrom('assignments')
      .select('account_id')
      .where('id', '=', t.viceAssignment)
      .executeTakeFirstOrThrow();
    return load.classes.role(vice.account_id, branch, 'academic_vice_principal');
  };

  describe('placing, moving, swapping and removing', () => {
    it('places a row at a slot in one audited write, in its class main classroom, with the minutes of the slot', async () => {
      const s = await scene();
      const assignment = await viceIn(s.branch);
      const response = await place(s.branch, s.version, s.rowA, 1, 3, t.vicePrincipal);
      const answer = gridOf(response, 201);
      expect(answer.editable).toBe(true);
      expect(answer.blocks).toEqual([
        expect.objectContaining({
          weekday: 1,
          slotPosition: 3,
          start: 535,
          end: 580,
          lessons: [expect.objectContaining({ loadRowId: s.rowA, roomId: s.roomA })],
        }),
      ]);
      const block = answer.blocks[0];
      if (block === undefined) throw new Error('One block.');
      const [entry] = await t.entries('pattern_block.create', block.id);
      expect(entry).toMatchObject({
        assignment_id: assignment,
        request_id: response.headers['x-request-id'],
        new_value: {
          versionId: s.version,
          weekday: 1,
          slotPosition: 3,
          start: 535,
          end: 580,
          lessons: [
            {
              id: block.lessons[0]?.id,
              loadRowId: s.rowA,
              teacherId: s.teacherA,
              roomId: s.roomA,
            },
          ],
        },
      });
      // The one load row is still short of its three lessons: a warning, with no weekday.
      expect(answer.results).toContainEqual(
        expect.objectContaining({ rule: 'load_mismatch', severity: 'warning', weekday: null }),
      );
    });

    it('gives a lesson the room of its row before the main classroom', async () => {
      const s = await scene();
      const lab = await load.classes.room(s.branch);
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ room_id: lab })
        .where('id', '=', s.rowA)
        .execute();
      const { answer } = await placed(s.branch, s.version, s.rowA, 1, 1);
      expect(answer.blocks[0]?.lessons[0]?.roomId).toBe(lab);
      expect(answer.rooms.map((room) => room.id)).toContain(lab);
    });

    it('moves a block in one audited write, and refuses a move onto the busy teacher, naming the rule and changing nothing (Done when)', async () => {
      const s = await scene();
      // Teacher A takes class B's row too.
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ teacher_id: s.teacherA })
        .where('id', '=', s.rowB)
        .execute();
      await placed(s.branch, s.version, s.rowA, 1, 1);
      const b = await placed(s.branch, s.version, s.rowB, 1, 3);
      const before = await patternRows([s.version]);
      expect(blockedRules(await move(s.branch, s.version, b.id, 1, 1))).toEqual(['teacher_double']);
      expect(await patternRows([s.version])).toEqual(before);
      const moved = gridOf(await move(s.branch, s.version, b.id, 2, 5));
      expect(moved.blocks.find((one) => one.id === b.id)).toMatchObject({
        weekday: 2,
        slotPosition: 5,
        start: 590,
        end: 635,
      });
      const [entry] = await t.entries('pattern_block.move', b.id);
      expect(entry).toMatchObject({
        old_value: { versionId: s.version, weekday: 1, slotPosition: 3, start: 535, end: 580 },
        new_value: { versionId: s.version, weekday: 2, slotPosition: 5, start: 590, end: 635 },
      });
      // The lesson rows moved with the block (0058, the cascading key).
      const entries = await t.database.migrator
        .selectFrom('pattern_entries')
        .select(['weekday', 'start_minutes', 'end_minutes'])
        .where('block_id', '=', b.id)
        .execute();
      expect(entries).toEqual([{ weekday: 2, start_minutes: 590, end_minutes: 635 }]);
    });

    it('refuses a move into a break by its rule, and a slot past the day or a day off as no slot', async () => {
      const s = await scene();
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const count = await t.auditCount();
      expect(blockedRules(await move(s.branch, s.version, a.id, 1, 2))).toEqual(['break_slot']);
      refusedWith(await move(s.branch, s.version, a.id, 1, 9), 409, 'pattern_no_slot');
      refusedWith(await move(s.branch, s.version, a.id, 6, 1), 409, 'pattern_no_slot');
      refusedWith(await place(s.branch, s.version, s.rowB, 7, 1), 409, 'pattern_no_slot');
      expect(await t.auditCount()).toBe(count);
    });

    it('checks by clock time: a 40-minute slot 5 of grade 2 meets a 45-minute slot 3 of grade 7 (edge/timetable, Structure)', async () => {
      const s = await scene();
      const lesson = await t.createSlotType(s.branch, 'Junior lesson', 'lesson', 40);
      const pause = await t.createSlotType(s.branch, 'Junior break', 'break', 5);
      const junior = await t.createTemplate(s.branch, 'Junior', [
        lesson,
        pause,
        lesson,
        pause,
        lesson,
      ]);
      await t.assign(s.branch, junior, { level: 'grades', gradeFrom: 1, gradeTo: 4 });
      const small = await load.classes.schoolClass(s.branch, s.year, { grade: 2 });
      const row = await s.row(small, s.teacherA);
      // Grade 7, slot 3: 08:55–09:40; grade 2, slot 5: 09:30–10:10.
      await placed(s.branch, s.version, s.rowA, 3, 3);
      expect(blockedRules(await place(s.branch, s.version, row, 3, 5))).toEqual(['teacher_double']);
      // Slot 3 of grade 2 is 08:45–09:25: it meets slot 3 of grade 7 as well; slot 1 does not.
      expect(blockedRules(await place(s.branch, s.version, row, 3, 3))).toEqual(['teacher_double']);
      const free = await placed(s.branch, s.version, row, 3, 1);
      expect(free.answer.blocks.find((one) => one.id === free.id)).toMatchObject({
        start: 480,
        end: 520,
      });
    });

    it('places and moves the groups of a split as one block, with no room of their own', async () => {
      const s = await scene();
      const english = await load.classes.subject({ grades: [7] });
      const groups = [
        await load.classes.group(s.branch, s.year, english, [s.classA]),
        await load.classes.group(s.branch, s.year, english, [s.classA]),
      ];
      const rows: string[] = [];
      for (const group of groups) {
        rows.push(
          await load.row({
            branch_id: s.branch,
            version_id: s.version,
            group_id: group,
            subject_id: english,
            teacher_id: await teacher(s.branch, english),
            lessons_per_week: 1,
          }),
        );
      }
      const [first = '', second = ''] = rows;
      const block = await placed(s.branch, s.version, second, 4, 1);
      const answer = block.answer.blocks.find((one) => one.id === block.id);
      expect(answer?.lessons.map((one) => one.loadRowId).sort()).toEqual([first, second].sort());
      expect(answer?.lessons.map((one) => one.roomId)).toEqual([null, null]);
      // The class lesson cannot take the slot of its own split.
      expect(new Set(blockedRules(await place(s.branch, s.version, s.rowA, 4, 1)))).toEqual(
        new Set(['class_double']),
      );
      const moved = gridOf(await move(s.branch, s.version, block.id, 4, 3));
      expect(moved.blocks.find((one) => one.id === block.id)?.lessons).toHaveLength(2);
      const entries = await t.database.migrator
        .selectFrom('pattern_entries')
        .select(['weekday', 'start_minutes'])
        .where('block_id', '=', block.id)
        .execute();
      expect(entries).toEqual([
        { weekday: 4, start_minutes: 535 },
        { weekday: 4, start_minutes: 535 },
      ]);
    });

    it('refuses a half of a mixed split, changing nothing', async () => {
      const s = await scene();
      const pe = await load.classes.subject({ grades: [7] });
      const halves = [
        await load.classes.group(s.branch, s.year, pe, [s.classA]),
        await load.classes.group(s.branch, s.year, pe, [s.classA]),
      ];
      const coach = await teacher(s.branch, pe);
      const rows: string[] = [];
      for (const group of halves) {
        rows.push(
          await load.row({
            branch_id: s.branch,
            version_id: s.version,
            group_id: group,
            subject_id: pe,
            teacher_id: coach,
            lessons_per_week: 2,
            mixed_block: true,
          }),
        );
      }
      const before = await patternRows([s.version]);
      refusedWith(
        await place(s.branch, s.version, rows[0] ?? '', 1, 1),
        409,
        'pattern_mixed_block',
      );
      expect(await patternRows([s.version])).toEqual(before);
    });

    it('swaps two blocks whose teacher would clash halfway, checked at the commit', async () => {
      const s = await scene();
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ teacher_id: s.teacherA })
        .where('id', '=', s.rowB)
        .execute();
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const b = await placed(s.branch, s.version, s.rowB, 1, 3);
      const answer = gridOf(await swap(s.branch, s.version, a.id, b.id));
      expect(answer.blocks.find((one) => one.id === a.id)).toMatchObject({
        weekday: 1,
        slotPosition: 3,
      });
      expect(answer.blocks.find((one) => one.id === b.id)).toMatchObject({
        weekday: 1,
        slotPosition: 1,
      });
      // One entry per block, found from either (permission review, should-fix 1).
      const [first] = await t.entries('pattern_block.swap', a.id);
      expect(first).toMatchObject({
        old_value: { versionId: s.version, swappedWith: b.id, weekday: 1, slotPosition: 1 },
        new_value: { versionId: s.version, swappedWith: b.id, weekday: 1, slotPosition: 3 },
      });
      const [second] = await t.entries('pattern_block.swap', b.id);
      expect(second).toMatchObject({
        old_value: { versionId: s.version, swappedWith: a.id, weekday: 1, slotPosition: 3 },
        new_value: { versionId: s.version, swappedWith: a.id, weekday: 1, slotPosition: 1 },
      });
    });

    it('refuses a swap that leaves a clash, changing nothing', async () => {
      const s = await scene();
      const classC = await load.classes.schoolClass(s.branch, s.year, { grade: 7 });
      const rowC = await s.row(classC, s.teacherA);
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const b = await placed(s.branch, s.version, s.rowB, 1, 3);
      await placed(s.branch, s.version, rowC, 1, 3);
      const before = await patternRows([s.version]);
      expect(blockedRules(await swap(s.branch, s.version, a.id, b.id))).toEqual(['teacher_double']);
      expect(await patternRows([s.version])).toEqual(before);
    });

    it('saves lessons past the load and a subject twice in a day as warnings (decision 6)', async () => {
      const s = await scene();
      await placed(s.branch, s.version, s.rowA, 1, 1);
      await placed(s.branch, s.version, s.rowA, 1, 3);
      await placed(s.branch, s.version, s.rowA, 2, 1);
      const fourth = await placed(s.branch, s.version, s.rowA, 3, 1);
      const results = fourth.answer.results;
      expect(results.filter((one) => one.severity === 'blocked')).toEqual([]);
      expect(results).toContainEqual(
        expect.objectContaining({
          rule: 'load_mismatch',
          weekday: null,
          detail: expect.objectContaining({ placed: 4, lessonsPerWeek: 3 }) as unknown,
        }),
      );
      expect(results).toContainEqual(
        expect.objectContaining({ rule: 'subject_twice', severity: 'warning', weekday: 1 }),
      );
    });

    it('removes a block in one audited write that keeps every lesson it removed', async () => {
      const s = await scene();
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const lesson = a.answer.blocks[0]?.lessons[0];
      const answer = gridOf(await drop(s.branch, s.version, a.id));
      expect(answer.blocks).toEqual([]);
      expect(await patternRows([s.version]).then(([blocks, entries]) => [blocks, entries])).toEqual(
        [[], []],
      );
      const [entry] = await t.entries('pattern_block.delete', a.id);
      expect(entry).toMatchObject({
        old_value: {
          versionId: s.version,
          weekday: 1,
          slotPosition: 1,
          lessons: [{ id: lesson?.id, loadRowId: s.rowA, teacherId: s.teacherA, roomId: s.roomA }],
        },
      });
    });

    it('writes nothing for a move to the slot the block already has', async () => {
      const s = await scene();
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const count = await t.auditCount();
      gridOf(await move(s.branch, s.version, a.id, 1, 1));
      expect(await t.auditCount()).toBe(count);
    });
  });

  // Task 5.4c-3a: double lessons (edge/timetable, Structure: "Two linked lessons
  // in consecutive lesson slots with the same teacher and room. They are moved,
  // cancelled and substituted together"). The scene's day is lesson, break,
  // lesson, break, lesson: positions 1, 3 and 5 are the lesson slots.
  describe('double lessons', () => {
    const placeDouble = (
      branch: string,
      version: string,
      loadRowId: string,
      weekday: number,
      slotPosition: number,
      extra: object = {},
      cookie = t.admin,
    ) =>
      post(
        `/api/timetable/versions/${version}/pattern`,
        branch,
        { loadRowId, weekday, slotPosition, double: true, ...extra },
        cookie,
      );
    const roomOf = (
      branch: string,
      version: string,
      blockId: string,
      lessonId: string,
      roomId: string,
      cookie = t.admin,
    ) =>
      post(
        `/api/timetable/versions/${version}/pattern/${blockId}/room`,
        branch,
        { lessonId, roomId },
        cookie,
      );
    const rearrange = (branch: string, version: string, body: object, cookie = t.admin) =>
      post(`/api/timetable/versions/${version}/pattern/rearrange`, branch, body, cookie);
    /** The blocks of a pair, the earlier first. */
    const halves = (answer: GridAnswer) => {
      const paired = answer.blocks
        .filter((one) => one.doublePairId !== null)
        .sort((a, b) => a.weekday - b.weekday || a.start - b.start);
      const [first, second] = paired;
      if (first === undefined || second === undefined || paired.length !== 2) {
        throw new Error('One pair.');
      }
      return [first, second] as const;
    };
    const slots = (answer: GridAnswer) =>
      halves(answer).map((one) => [one.weekday, one.slotPosition, one.start, one.end]);

    /** The scene with row A allowing double lessons. */
    async function doubles() {
      const s = await scene();
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ double_lessons: true })
        .where('id', '=', s.rowA)
        .execute();
      return s;
    }

    it('places a double in two audited blocks of one pair, the second half in the next lesson slot over the break', async () => {
      const s = await doubles();
      const response = await placeDouble(s.branch, s.version, s.rowA, 1, 1);
      const answer = gridOf(response, 201);
      expect(slots(answer)).toEqual([
        [1, 1, 480, 525],
        [1, 3, 535, 580],
      ]);
      const [first, second] = halves(answer);
      expect(first.doublePairId).toBe(second.doublePairId);
      expect([first.lessons[0]?.roomId, second.lessons[0]?.roomId]).toEqual([s.roomA, s.roomA]);
      const stored = await t.database.migrator
        .selectFrom('pattern_blocks')
        .select('double_pair_id')
        .where('version_id', '=', s.version)
        .execute();
      expect(stored.map((one) => one.double_pair_id)).toEqual([
        first.doublePairId,
        first.doublePairId,
      ]);
      for (const half of [first, second]) {
        const [entry] = await t.entries('pattern_block.create', half.id);
        expect(entry).toMatchObject({
          request_id: response.headers['x-request-id'],
          new_value: { slotPosition: half.slotPosition, doublePairId: first.doublePairId },
        });
      }
      // No double lesson result of its own: the two lessons are one pair.
      expect(answer.results.map((one) => one.rule)).not.toContain('double_apart');
      expect(answer.results.map((one) => one.rule)).not.toContain('subject_twice');
    });

    it('refuses a double at the last lesson slot as no slot, changing nothing', async () => {
      const s = await doubles();
      const before = await patternRows([s.version]);
      refusedWith(await placeDouble(s.branch, s.version, s.rowA, 1, 5), 409, 'pattern_no_slot');
      expect(await patternRows([s.version])).toEqual(before);
    });

    it('refuses a double of a row that does not allow double lessons, naming the rule and changing nothing', async () => {
      const s = await doubles();
      const before = await patternRows([s.version]);
      expect(blockedRules(await placeDouble(s.branch, s.version, s.rowB, 1, 1))).toContain(
        'double_not_allowed',
      );
      expect(await patternRows([s.version])).toEqual(before);
    });

    it('refuses a double of a split where one group row allows doubles and the other does not', async () => {
      const s = await doubles();
      const english = await load.classes.subject({ grades: [7] });
      const rows: string[] = [];
      for (const allowed of [true, false]) {
        rows.push(
          await load.row({
            branch_id: s.branch,
            version_id: s.version,
            group_id: await load.classes.group(s.branch, s.year, english, [s.classA]),
            subject_id: english,
            teacher_id: await teacher(s.branch, english),
            lessons_per_week: 2,
            double_lessons: allowed,
          }),
        );
      }
      const before = await patternRows([s.version]);
      const refused = await placeDouble(s.branch, s.version, rows[0] ?? '', 2, 1);
      expect(new Set(blockedRules(refused))).toEqual(new Set(['double_not_allowed']));
      expect(await patternRows([s.version])).toEqual(before);
    });

    it('refuses a double that is not a true or false, in the common error shape', async () => {
      const s = await doubles();
      refusedWith(
        await placeDouble(s.branch, s.version, s.rowA, 1, 1, { double: 'yes' }),
        400,
        'validation_failed',
      );
    });

    it('moves a double by either half, the other half beside it, audited for both', async () => {
      const s = await doubles();
      const placedPair = halves(gridOf(await placeDouble(s.branch, s.version, s.rowA, 1, 1), 201));
      const [first, second] = placedPair;
      // By the first half, to Tuesday.
      let answer = gridOf(await move(s.branch, s.version, first.id, 2, 1));
      expect(slots(answer)).toEqual([
        [2, 1, 480, 525],
        [2, 3, 535, 580],
      ]);
      // By the second half, to Wednesday's last slot: the first half goes before it.
      answer = gridOf(await move(s.branch, s.version, second.id, 3, 5));
      expect(slots(answer)).toEqual([
        [3, 3, 535, 580],
        [3, 5, 590, 635],
      ]);
      // One lesson slot earlier by the second half: it lands on the first half's slot
      // (review correction 2), checked at the commit.
      answer = gridOf(await move(s.branch, s.version, second.id, 3, 3));
      expect(slots(answer)).toEqual([
        [3, 1, 480, 525],
        [3, 3, 535, 580],
      ]);
      expect(halves(answer).map((one) => one.id)).toEqual([first.id, second.id]);
      const entries = await t.entries('pattern_block.move', first.id);
      expect(entries.at(-1)).toMatchObject({
        old_value: { weekday: 3, slotPosition: 3, doublePairId: first.doublePairId },
        new_value: { weekday: 3, slotPosition: 1, doublePairId: first.doublePairId },
      });
      expect(await t.entries('pattern_block.move', second.id)).toHaveLength(3);
    });

    it('moves a double one lesson slot later, the first half onto the second half’s old slot (review correction 2)', async () => {
      const s = await doubles();
      const [first] = halves(gridOf(await placeDouble(s.branch, s.version, s.rowA, 4, 1), 201));
      const answer = gridOf(await move(s.branch, s.version, first.id, 4, 3));
      expect(slots(answer)).toEqual([
        [4, 3, 535, 580],
        [4, 5, 590, 635],
      ]);
    });

    it('refuses a move when only the second half clashes, naming the rule and changing nothing', async () => {
      const s = await doubles();
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ teacher_id: s.teacherA })
        .where('id', '=', s.rowB)
        .execute();
      await placed(s.branch, s.version, s.rowB, 5, 3);
      const [first] = halves(gridOf(await placeDouble(s.branch, s.version, s.rowA, 1, 1), 201));
      const before = await patternRows([s.version]);
      expect(blockedRules(await move(s.branch, s.version, first.id, 5, 1))).toContain(
        'teacher_double',
      );
      expect(await patternRows([s.version])).toEqual(before);
    });

    it('removes both halves by either one, audited for both', async () => {
      const s = await doubles();
      const [first, second] = halves(
        gridOf(await placeDouble(s.branch, s.version, s.rowA, 1, 1), 201),
      );
      const answer = gridOf(await drop(s.branch, s.version, second.id));
      expect(answer.blocks).toEqual([]);
      for (const half of [first, second]) {
        const [entry] = await t.entries('pattern_block.delete', half.id);
        expect(entry).toMatchObject({
          old_value: { slotPosition: half.slotPosition, doublePairId: first.doublePairId },
        });
      }
    });

    it('changes the room of the row in both halves, audited for both', async () => {
      const s = await doubles();
      const [first, second] = halves(
        gridOf(await placeDouble(s.branch, s.version, s.rowA, 1, 1), 201),
      );
      const lesson = first.lessons[0];
      if (lesson === undefined) throw new Error('A lesson.');
      const answer = gridOf(await roomOf(s.branch, s.version, first.id, lesson.id, s.roomB));
      expect(halves(answer).map((one) => one.lessons[0]?.roomId)).toEqual([s.roomB, s.roomB]);
      for (const half of [first, second]) {
        const [entry] = await t.entries('pattern_entry.room', half.lessons[0]?.id);
        expect(entry).toMatchObject({
          old_value: { blockId: half.id, roomId: s.roomA, doublePairId: first.doublePairId },
          new_value: { blockId: half.id, roomId: s.roomB },
        });
      }
    });

    it('refuses a room taken in the slot of the second half only', async () => {
      const s = await doubles();
      const [first] = halves(gridOf(await placeDouble(s.branch, s.version, s.rowA, 1, 1), 201));
      // Class B's lesson in its own room B at the second half's slot.
      await placed(s.branch, s.version, s.rowB, 1, 3);
      const lesson = first.lessons[0];
      if (lesson === undefined) throw new Error('A lesson.');
      const before = await patternRows([s.version]);
      expect(blockedRules(await roomOf(s.branch, s.version, first.id, lesson.id, s.roomB))).toEqual(
        ['room_double'],
      );
      expect(await patternRows([s.version])).toEqual(before);
    });

    it('refuses a swap and a suggestion that move one half alone, naming the rule (decision 6)', async () => {
      const s = await doubles();
      const [first] = halves(gridOf(await placeDouble(s.branch, s.version, s.rowA, 1, 1), 201));
      const single = await placed(s.branch, s.version, s.rowB, 2, 5);
      const before = await patternRows([s.version]);
      expect(blockedRules(await swap(s.branch, s.version, first.id, single.id))).toContain(
        'double_apart',
      );
      expect(
        blockedRules(
          await rearrange(s.branch, s.version, {
            changes: [{ blockId: first.id, weekday: 2, slotPosition: 1 }],
          }),
        ),
      ).toContain('double_apart');
      expect(await patternRows([s.version])).toEqual(before);
    });

    it('removes both halves when the undo of a suggestion names one', async () => {
      const s = await doubles();
      const [first, second] = halves(
        gridOf(await placeDouble(s.branch, s.version, s.rowA, 1, 1), 201),
      );
      const answer = gridOf(
        await rearrange(s.branch, s.version, { changes: [], remove: [first.id] }),
      );
      expect(answer.blocks).toEqual([]);
      expect(await t.entries('pattern_block.delete', second.id)).toHaveLength(1);
    });

    // Permission review, should-fixes 1 to 4.
    it("answers 404 to a double of another branch's, another version's and an unknown row, and to a half of their pairs; the Principal is refused; nothing changes", async () => {
      const s = await doubles();
      const other = await doubles();
      const sameBranch = await load.version(s.branch, s.year, { startsOn: MONDAY });
      const sameRow = await load.row({
        branch_id: s.branch,
        version_id: sameBranch,
        class_id: s.classA,
        subject_id: s.subject,
        teacher_id: s.teacherA,
        double_lessons: true,
      });
      const own = halves(gridOf(await placeDouble(s.branch, s.version, s.rowA, 1, 1), 201));
      const otherPair = halves(
        gridOf(await placeDouble(other.branch, other.version, other.rowA, 1, 1), 201),
      );
      const samePair = halves(gridOf(await placeDouble(s.branch, sameBranch, sameRow, 1, 1), 201));
      await viceIn(s.branch);
      await staleEditLock(s.version);
      const before = await patternRows([s.version, other.version, sameBranch]);
      for (const cookie of [t.vicePrincipal, t.admin]) {
        for (const row of [other.rowA, UNKNOWN, sameRow]) {
          refusedWith(
            await placeDouble(s.branch, s.version, row, 2, 1, {}, cookie),
            404,
            'not_found',
          );
        }
        for (const half of [...otherPair, ...samePair]) {
          const lesson = half.lessons[0]?.id ?? UNKNOWN;
          refusedWith(await move(s.branch, s.version, half.id, 2, 1, cookie), 404, 'not_found');
          refusedWith(await drop(s.branch, s.version, half.id, cookie), 404, 'not_found');
          refusedWith(
            await roomOf(s.branch, s.version, half.id, lesson, s.roomB, cookie),
            404,
            'not_found',
          );
          refusedWith(
            await rearrange(s.branch, s.version, { changes: [], remove: [half.id] }, cookie),
            404,
            'not_found',
          );
        }
      }
      for (const cookie of [t.principal, t.teacher]) {
        refusedWith(
          await placeDouble(t.north, s.version, s.rowA, 2, 1, {}, cookie),
          403,
          'permission_denied',
        );
        refusedWith(
          await move(t.north, s.version, own[1].id, 2, 1, cookie),
          403,
          'permission_denied',
        );
        refusedWith(await drop(t.north, s.version, own[0].id, cookie), 403, 'permission_denied');
      }
      expect(await patternRows([s.version, other.version, sameBranch])).toEqual(before);
    });

    it('refuses the undo of a suggestion that would remove a double whose other half is locked, changing nothing', async () => {
      const s = await doubles();
      const [first, second] = halves(
        gridOf(await placeDouble(s.branch, s.version, s.rowA, 1, 1), 201),
      );
      const locked = await post(`/api/timetable/versions/${s.version}/locks`, s.branch, {
        kind: 'block',
        blockId: second.id,
      });
      expect(locked.status, JSON.stringify(locked.body)).toBe(201);
      const before = await patternRows([s.version]);
      refusedWith(
        await rearrange(s.branch, s.version, { changes: [], remove: [first.id] }),
        409,
        'pattern_locked',
      );
      expect(await patternRows([s.version])).toEqual(before);
    });

    it('lets the Academic Vice Principal of the branch place and move a double, the audit naming the assignment', async () => {
      const s = await doubles();
      const assignment = await viceIn(s.branch);
      const [first, second] = halves(
        gridOf(await placeDouble(s.branch, s.version, s.rowA, 1, 1, {}, t.vicePrincipal), 201),
      );
      const answer = gridOf(await move(s.branch, s.version, second.id, 2, 3, t.vicePrincipal));
      expect(slots(answer)).toEqual([
        [2, 1, 480, 525],
        [2, 3, 535, 580],
      ]);
      for (const half of [first, second]) {
        for (const action of ['pattern_block.create', 'pattern_block.move']) {
          const [entry] = await t.entries(action, half.id);
          expect(entry, action).toMatchObject({ assignment_id: assignment });
        }
      }
    });
  });

  describe('who may read and write the grid', () => {
    it('lets the Principal read the grid and refuses every write; a Teacher reads nothing', async () => {
      const s = await scene();
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const b = await placed(s.branch, s.version, s.rowB, 2, 1);
      for (const cookie of [t.principal, t.teacher]) {
        // The kit's accounts hold their roles in the north branch.
        for (const version of [UNKNOWN, s.version]) {
          // An unknown version, and one of another branch than the request's.
          const shown = await grid(t.north, version, cookie);
          expect(shown.status).toBe(cookie === t.principal ? 404 : 403);
        }
      }
      const before = await patternRows([s.version]);
      for (const cookie of [t.principal, t.teacher]) {
        const branch = t.north;
        refusedWith(await place(branch, s.version, s.rowA, 3, 1, cookie), 403, 'permission_denied');
        refusedWith(await move(branch, s.version, a.id, 3, 1, cookie), 403, 'permission_denied');
        refusedWith(await swap(branch, s.version, a.id, b.id, cookie), 403, 'permission_denied');
        refusedWith(await drop(branch, s.version, a.id, cookie), 403, 'permission_denied');
      }
      expect(await patternRows([s.version])).toEqual(before);
    });

    it('lets the Academic Vice Principal of the branch move, swap and remove, the audit naming the assignment', async () => {
      const s = await scene();
      const assignment = await viceIn(s.branch);
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const b = await placed(s.branch, s.version, s.rowB, 2, 1);
      // Task 5.4c-1: the edit lock the writes above took is let go for the next account.
      await load.freeEditLock(s.version);
      gridOf(await move(s.branch, s.version, a.id, 3, 1, t.vicePrincipal));
      gridOf(await swap(s.branch, s.version, a.id, b.id, t.vicePrincipal));
      gridOf(await drop(s.branch, s.version, a.id, t.vicePrincipal));
      for (const action of ['pattern_block.move', 'pattern_block.swap', 'pattern_block.delete']) {
        const [entry] = await t.entries(action, a.id);
        expect(entry, action).toMatchObject({ assignment_id: assignment });
      }
    });

    it('refuses a swap of a block with itself, changing nothing', async () => {
      const s = await scene();
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const before = await patternRows([s.version]);
      refusedWith(await swap(s.branch, s.version, a.id, a.id), 400, 'validation_failed');
      expect(await patternRows([s.version])).toEqual(before);
    });

    it('answers the facts of its own branch only (permission review, should-fix 3)', async () => {
      const s = await scene();
      const other = await scene();
      // Teacher A also works in the other branch, with Saturday hours and a row there
      // (hours in two branches never overlap).
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: s.teacherA, branch_id: other.branch, is_main: false })
        .execute();
      await hours(other.branch, s.teacherA, [6]);
      await load.profile(s.teacherA, [{ subject: other.subject, grades: [7] }]);
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ teacher_id: s.teacherA })
        .where('id', '=', other.rowB)
        .execute();
      await placed(s.branch, s.version, s.rowA, 1, 1);
      const answer = gridOf(await grid(s.branch, s.version));
      const branches = answer.facts.teachers.flatMap((one) =>
        one.availability.map((entry) => entry.branchId),
      );
      expect(new Set(branches)).toEqual(new Set([s.branch]));
      expect(answer.facts.teachers.map((one) => one.id).sort()).toEqual(
        [s.teacherA, s.teacherB].sort(),
      );
      const ownRooms = [s.roomA, s.roomB];
      expect(answer.facts.rooms.every((room) => ownRooms.includes(room.id))).toBe(true);
      expect(answer.rooms.every((room) => ownRooms.includes(room.id))).toBe(true);
      expect(answer.classes.map((one) => one.id).sort()).toEqual([s.classA, s.classB].sort());
      expect(answer.facts.classStudents.map((one) => one.classId).sort()).toEqual(
        [s.classA, s.classB].sort(),
      );
      expect(answer.blocks.flatMap((one) => one.lessons.map((lesson) => lesson.loadRowId))).toEqual(
        [s.rowA],
      );
      expect(answer.facts.otherDrafts).toEqual([]);
    });

    it('lets the Principal of the branch read the board of a draft', async () => {
      const s = await scene();
      await placed(s.branch, s.version, s.rowA, 1, 1);
      const principal = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', 'principal')
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('assignments')
        .values({
          account_id: principal.account_id,
          role: 'principal',
          branch_id: s.branch,
          valid_from: new Date('2026-09-01T00:00:00+05:00'),
          created_at: new Date('2026-09-01T00:00:00+05:00'),
        })
        .execute();
      const answer = gridOf(await grid(s.branch, s.version, t.principal));
      expect(answer.blocks).toHaveLength(1);
      expect(answer.classes.map((one) => one.id).sort()).toEqual([s.classA, s.classB].sort());
    });

    it('reads a published version without letting it change, and refuses writes in a closed year', async () => {
      const published = await scene();
      const kept = await placed(published.branch, published.version, published.rowA, 1, 1);
      await load.setVersion(published.version, 'published');
      const shown = gridOf(await grid(published.branch, published.version));
      expect(shown.editable).toBe(false);
      expect(shown.blocks).toHaveLength(1);
      const closed = await scene();
      const keptClosed = await placed(closed.branch, closed.version, closed.rowA, 1, 1);
      await load.classes.setYear(closed.year, 'closed');
      for (const [s, block, code] of [
        [published, kept.id, 'version_not_draft'],
        [closed, keptClosed.id, 'timetable_year_closed'],
      ] as const) {
        const before = await patternRows([s.version]);
        refusedWith(await place(s.branch, s.version, s.rowB, 2, 1), 409, code);
        refusedWith(await move(s.branch, s.version, block, 2, 1), 409, code);
        refusedWith(await swap(s.branch, s.version, block, UNKNOWN), 409, code);
        refusedWith(await drop(s.branch, s.version, block), 409, code);
        expect(await patternRows([s.version])).toEqual(before);
      }
    });

    it("answers 404 for another branch's, another version's and an unknown version, row and block, changing nothing", async () => {
      const s = await scene();
      const other = await scene();
      const sameBranch = await load.version(s.branch, s.year, { startsOn: MONDAY });
      const sameBranchRow = await load.row({
        branch_id: s.branch,
        version_id: sameBranch,
        class_id: s.classA,
        subject_id: s.subject,
        teacher_id: s.teacherA,
      });
      const own = await placed(s.branch, s.version, s.rowA, 1, 1);
      const otherBlock = await placed(other.branch, other.version, other.rowA, 1, 1);
      const sameBranchBlock = await placed(s.branch, sameBranch, sameBranchRow, 1, 3);
      await viceIn(s.branch);
      // Task 5.4c-1 (permission review, S2): another account left the lock 10 minutes ago, so
      // a refused write would take it over and notify; the refusal must undo both.
      await staleEditLock(s.version);
      const before = await patternRows([s.version, other.version, sameBranch]);
      for (const cookie of [t.vicePrincipal, t.admin]) {
        for (const version of [other.version, UNKNOWN]) {
          refusedWith(await grid(s.branch, version, cookie), 404, 'not_found');
          refusedWith(await place(s.branch, version, s.rowA, 2, 1, cookie), 404, 'not_found');
          refusedWith(await move(s.branch, version, own.id, 2, 1, cookie), 404, 'not_found');
          refusedWith(await swap(s.branch, version, own.id, UNKNOWN, cookie), 404, 'not_found');
          refusedWith(await drop(s.branch, version, own.id, cookie), 404, 'not_found');
        }
        // A row of another branch, an unknown one, one of another version of the branch.
        for (const row of [other.rowA, UNKNOWN, sameBranchRow]) {
          refusedWith(await place(s.branch, s.version, row, 2, 1, cookie), 404, 'not_found');
        }
        // A block of another branch, an unknown one, one of another version of the branch.
        for (const block of [otherBlock.id, UNKNOWN, sameBranchBlock.id]) {
          refusedWith(await move(s.branch, s.version, block, 2, 1, cookie), 404, 'not_found');
          refusedWith(await drop(s.branch, s.version, block, cookie), 404, 'not_found');
          refusedWith(await swap(s.branch, s.version, own.id, block, cookie), 404, 'not_found');
          refusedWith(await swap(s.branch, s.version, block, own.id, cookie), 404, 'not_found');
        }
      }
      expect(await patternRows([s.version, other.version, sameBranch])).toEqual(before);
    });
  });

  // Task 5.4b-2a: the room picker (06, Editing in the grid: "The room picker
  // lists only rooms that are free in that slot, best fit first"), step 7's
  // mark ("The conflict panel shows no errors") and a teacher change of a row
  // with placed lessons (review correction 1).
  describe('the room of a lesson, step 7 and a new teacher', () => {
    const roomOf = (
      branch: string,
      version: string,
      blockId: string,
      lessonId: string,
      roomId: string,
      cookie = t.admin,
    ) =>
      post(
        `/api/timetable/versions/${version}/pattern/${blockId}/room`,
        branch,
        { lessonId, roomId },
        cookie,
      );
    const lessonOf = (answer: GridAnswer, blockId: string) => {
      const lesson = answer.blocks.find((one) => one.id === blockId)?.lessons[0];
      if (lesson === undefined) throw new Error('The block has no lesson.');
      return lesson;
    };
    const readiness = async (branch: string, version: string, cookie = t.admin) => {
      const response = await get(`/api/timetable/versions/${version}/readiness`, branch, cookie);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return (response.body as { grid?: unknown; ready: boolean }).grid;
    };
    const editRow = (
      branch: string,
      version: string,
      rowId: string,
      teacherId: string,
      cookie = t.admin,
    ) =>
      t.patch(
        `/api/timetable/versions/${version}/load/${rowId}`,
        branch,
        { teacherId, lessonsPerWeek: 3, roomId: null, roomType: null, doubleLessons: false },
        cookie,
      );
    /** Takes teacher A's Monday hours away, so a Monday lesson of A is blocked (`teacher_unavailable`). */
    const noMondays = (staffId: string) =>
      t.database.migrator
        .deleteFrom('staff_availability_ranges')
        .where('staff_id', '=', staffId)
        .where('weekday', '=', 1)
        .execute();

    it('changes the room of a lesson in one audited write, and refuses a room taken at that time, naming the rule and changing nothing', async () => {
      const s = await scene();
      const assignment = await viceIn(s.branch);
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const b = await placed(s.branch, s.version, s.rowB, 1, 1);
      const lesson = lessonOf(b.answer, a.id);
      const before = await patternRows([s.version]);
      expect(blockedRules(await roomOf(s.branch, s.version, a.id, lesson.id, s.roomB))).toEqual([
        'room_double',
      ]);
      expect(await patternRows([s.version])).toEqual(before);
      // A room that is neither a row's room nor a main classroom.
      const spare = await load.classes.room(s.branch);
      // Task 5.4c-1: the edit lock the writes above took is let go for the next account.
      await load.freeEditLock(s.version);
      const response = await roomOf(s.branch, s.version, a.id, lesson.id, spare, t.vicePrincipal);
      const answer = gridOf(response);
      expect(lessonOf(answer, a.id).roomId).toBe(spare);
      expect(answer.rooms.map((room) => room.id)).toContain(spare);
      expect(answer.facts.rooms.find((room) => room.id === spare)).toMatchObject({
        type: 'classroom',
      });
      const [entry] = await t.entries('pattern_entry.room', lesson.id);
      expect(entry).toMatchObject({
        assignment_id: assignment,
        request_id: response.headers['x-request-id'],
        old_value: { versionId: s.version, blockId: a.id, loadRowId: s.rowA, roomId: s.roomA },
        new_value: { versionId: s.version, blockId: a.id, loadRowId: s.rowA, roomId: spare },
      });
      // The grid and a move still answer with the lesson in that room.
      gridOf(await grid(s.branch, s.version));
      await load.freeEditLock(s.version);
      expect(lessonOf(gridOf(await move(s.branch, s.version, a.id, 2, 3)), a.id).roomId).toBe(
        spare,
      );
    });

    it('writes nothing for the room the lesson already has', async () => {
      const s = await scene();
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const before = await patternRows([s.version]);
      gridOf(await roomOf(s.branch, s.version, a.id, lessonOf(a.answer, a.id).id, s.roomA));
      expect(await patternRows([s.version])).toEqual(before);
    });

    it('lets a lesson with a blocked result of its own change room (decision 5)', async () => {
      const s = await scene();
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      await noMondays(s.teacherA);
      expect(gridOf(await grid(s.branch, s.version)).results).toContainEqual(
        expect.objectContaining({ rule: 'teacher_unavailable', severity: 'blocked' }),
      );
      const spare = await load.classes.room(s.branch);
      const answer = gridOf(
        await roomOf(s.branch, s.version, a.id, lessonOf(a.answer, a.id).id, spare),
      );
      expect(lessonOf(answer, a.id).roomId).toBe(spare);
    });

    it('places a lesson in the room chosen in the picker, and answers 404 for a room of another branch or an unknown one', async () => {
      const s = await scene();
      const other = await scene();
      const spare = await load.classes.room(s.branch);
      const response = await post(`/api/timetable/versions/${s.version}/pattern`, s.branch, {
        loadRowId: s.rowA,
        weekday: 1,
        slotPosition: 1,
        roomId: spare,
      });
      const answer = gridOf(response, 201);
      const block = answer.blocks[0];
      if (block === undefined) throw new Error('One block.');
      expect(block.lessons[0]?.roomId).toBe(spare);
      const [entry] = await t.entries('pattern_block.create', block.id);
      expect(entry).toMatchObject({ new_value: { lessons: [{ roomId: spare }] } });
      const before = await patternRows([s.version, other.version]);
      for (const roomId of [other.roomA, UNKNOWN]) {
        refusedWith(
          await post(`/api/timetable/versions/${s.version}/pattern`, s.branch, {
            loadRowId: s.rowB,
            weekday: 2,
            slotPosition: 1,
            roomId,
          }),
          404,
          'not_found',
        );
      }
      expect(await patternRows([s.version, other.version])).toEqual(before);
    });

    it("answers 404 for another branch's, another version's and an unknown version, block, lesson and room, changing nothing", async () => {
      const s = await scene();
      const other = await scene();
      const sameBranch = await load.version(s.branch, s.year, { startsOn: MONDAY });
      const sameBranchRow = await load.row({
        branch_id: s.branch,
        version_id: sameBranch,
        class_id: s.classA,
        subject_id: s.subject,
        teacher_id: s.teacherA,
      });
      const own = await placed(s.branch, s.version, s.rowA, 1, 1);
      const second = await placed(s.branch, s.version, s.rowB, 2, 1);
      const otherBlock = await placed(other.branch, other.version, other.rowA, 1, 1);
      const sameBranchBlock = await placed(s.branch, sameBranch, sameBranchRow, 1, 3);
      const lesson = lessonOf(own.answer, own.id).id;
      const spare = await load.classes.room(s.branch);
      await viceIn(s.branch);
      // Task 5.4c-1 (permission review, S2): another account left the lock 10 minutes ago, so
      // a refused write would take it over and notify; the refusal must undo both.
      await staleEditLock(s.version);
      const before = await patternRows([s.version, other.version, sameBranch]);
      for (const cookie of [t.vicePrincipal, t.admin]) {
        for (const version of [other.version, UNKNOWN]) {
          refusedWith(
            await roomOf(s.branch, version, own.id, lesson, spare, cookie),
            404,
            'not_found',
          );
        }
        for (const block of [otherBlock.id, UNKNOWN, sameBranchBlock.id]) {
          refusedWith(
            await roomOf(s.branch, s.version, block, lesson, spare, cookie),
            404,
            'not_found',
          );
        }
        // A lesson of another block of the draft, of another branch, an unknown one.
        for (const id of [
          lessonOf(second.answer, second.id).id,
          lessonOf(otherBlock.answer, otherBlock.id).id,
          UNKNOWN,
        ]) {
          refusedWith(
            await roomOf(s.branch, s.version, own.id, id, spare, cookie),
            404,
            'not_found',
          );
        }
        for (const roomId of [other.roomB, UNKNOWN]) {
          refusedWith(
            await roomOf(s.branch, s.version, own.id, lesson, roomId, cookie),
            404,
            'not_found',
          );
        }
      }
      expect(await patternRows([s.version, other.version, sameBranch])).toEqual(before);
    });

    it('lets the Academic Vice Principal change a room; the Principal and a Teacher are refused; a published version is read only', async () => {
      const s = await scene();
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const lesson = lessonOf(a.answer, a.id).id;
      const spare = await load.classes.room(s.branch);
      const before = await patternRows([s.version]);
      for (const cookie of [t.principal, t.teacher]) {
        refusedWith(
          await roomOf(t.north, s.version, a.id, lesson, spare, cookie),
          403,
          'permission_denied',
        );
      }
      expect(await patternRows([s.version])).toEqual(before);
      await load.setVersion(s.version, 'published');
      // The version row is compared too (task 5.4c-1), with its new status.
      const published = await patternRows([s.version]);
      refusedWith(await roomOf(s.branch, s.version, a.id, lesson, spare), 409, 'version_not_draft');
      expect(await patternRows([s.version])).toEqual(published);
    });

    it('marks step 7 ready with warnings only, and not ready with a blocked result', async () => {
      const s = await scene();
      await placed(s.branch, s.version, s.rowA, 1, 1);
      // Both rows short of their load: two warnings.
      expect(await readiness(s.branch, s.version)).toEqual({
        ready: true,
        blocked: 0,
        warnings: 2,
      });
      await noMondays(s.teacherA);
      expect(await readiness(s.branch, s.version)).toEqual({
        ready: false,
        blocked: 1,
        warnings: 2,
      });
      // Every role that reads the readiness reads the same mark (permission review, should-fix 3).
      await viceIn(s.branch);
      const principal = await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('role', '=', 'principal')
        .where('branch_id', '=', t.north)
        .executeTakeFirstOrThrow();
      await load.classes.role(principal.account_id, s.branch, 'principal');
      for (const cookie of [t.vicePrincipal, t.principal]) {
        expect(await readiness(s.branch, s.version, cookie)).toEqual({
          ready: false,
          blocked: 1,
          warnings: 2,
        });
      }
    });

    it('answers 404 for a new teacher of another branch or an unknown one on a row with placed lessons, changing nothing (permission review, should-fix 1)', async () => {
      const s = await scene();
      const other = await scene();
      await placed(s.branch, s.version, s.rowB, 1, 1);
      await viceIn(s.branch);
      const loadRows = () =>
        t.database.migrator
          .selectFrom('teaching_load_rows')
          .selectAll()
          .where('version_id', 'in', [s.version, other.version])
          .orderBy('id')
          .execute();
      // Task 5.4c-1: the edit lock the writes above took is let go for the next account.
      await load.freeEditLock(s.version);
      const before = [await patternRows([s.version, other.version]), await loadRows()];
      for (const cookie of [t.vicePrincipal, t.admin]) {
        for (const teacherId of [other.teacherB, UNKNOWN]) {
          refusedWith(
            await editRow(s.branch, s.version, s.rowB, teacherId, cookie),
            404,
            'not_found',
          );
        }
      }
      expect([await patternRows([s.version, other.version]), await loadRows()]).toEqual(before);
    });

    it('refuses a new teacher who is busy at a placed lesson of the row, naming the rule, and gives the lessons to a free one', async () => {
      const s = await scene();
      await placed(s.branch, s.version, s.rowA, 1, 1);
      const b = await placed(s.branch, s.version, s.rowB, 1, 1);
      const rows = () =>
        t.database.migrator
          .selectFrom('teaching_load_rows')
          .selectAll()
          .where('version_id', '=', s.version)
          .orderBy('id')
          .execute();
      const before = [await patternRows([s.version]), await rows()];
      expect(blockedRules(await editRow(s.branch, s.version, s.rowB, s.teacherA))).toEqual([
        'teacher_double',
      ]);
      expect([await patternRows([s.version]), await rows()]).toEqual(before);
      // Another teacher with hours every day takes the row and its placed lesson.
      const free = await teacher(s.branch, s.subject);
      expect((await editRow(s.branch, s.version, s.rowB, free)).status).toBe(200);
      const entries = await t.database.migrator
        .selectFrom('pattern_entries')
        .select('teacher_id')
        .where('block_id', '=', b.id)
        .execute();
      expect(entries).toEqual([{ teacher_id: free }]);
      const shown = gridOf(await grid(s.branch, s.version));
      expect(shown.rows.find((row) => row.id === s.rowB)?.teacher.id).toBe(free);
    });
  });

  // Task 5.4b-1: 06, Teachers who work in several branches: "One clash check.
  // A teacher cannot be in two lessons at once, counted across all branches
  // by clock time"; "Busy elsewhere ... They cannot be moved from here, and
  // the generator treats them, and the travel time around them, as fixed";
  // "Travel time ... This is blocked in the grid, in the generator and on the
  // server"; "Two drafts at once ... each grid warns".
  describe('the lessons of other branches', () => {
    /**
     * Two scenes; teacher A of the first also works in the second, which has a
     * lesson of teacher A on Monday at the position named, written straight
     * into its pattern (the teacher has no hours there on Monday, and the
     * hours of two branches never overlap), then published unless said.
     */
    async function twoBranches(position: number, status: 'published' | 'draft' = 'published') {
      const s = await scene();
      const other = await scene();
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: s.teacherA, branch_id: other.branch, is_main: false })
        .execute();
      await load.profile(s.teacherA, [{ subject: other.subject, grades: [7] }]);
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ teacher_id: s.teacherA })
        .where('id', '=', other.rowB)
        .execute();
      const times = [
        [480, 525],
        [525, 535],
        [535, 580],
      ][position - 1] ?? [535, 580];
      const [start = 0, end = 0] = times;
      const block = await t.database.migrator
        .insertInto('pattern_blocks')
        .values({
          branch_id: other.branch,
          version_id: other.version,
          weekday: 1,
          slot_position: position,
          start_minutes: start,
          end_minutes: end,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const entry = await t.database.migrator
        .insertInto('pattern_entries')
        .values({
          branch_id: other.branch,
          version_id: other.version,
          block_id: block.id,
          weekday: 1,
          start_minutes: start,
          end_minutes: end,
          load_row_id: other.rowB,
          teacher_id: s.teacherA,
          room_id: other.roomB,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (status === 'published') {
        await load.setVersion(other.version, 'published');
      }
      return { s, other, block: block.id, entry: entry.id };
    }

    const travel = async (a: string, b: string, minutes: number) => {
      const [low = '', high = ''] = [a, b].sort();
      await t.database.migrator
        .insertInto('travel_times')
        .values({ branch_low: low, branch_high: high, minutes })
        .onConflict((conflict) =>
          conflict.columns(['branch_low', 'branch_high']).doUpdateSet({ minutes }),
        )
        .execute();
    };

    it('refuses a move onto the teacher’s lesson in another branch, naming the rule and changing nothing (Done when)', async () => {
      const { s, other } = await twoBranches(3);
      const own = await placed(s.branch, s.version, s.rowA, 2, 1);
      const before = await patternRows([s.version, other.version]);
      expect(blockedRules(await move(s.branch, s.version, own.id, 1, 3))).toEqual([
        'teacher_double',
      ]);
      expect(blockedRules(await place(s.branch, s.version, s.rowA, 1, 3))).toEqual([
        'teacher_double',
      ]);
      expect(await patternRows([s.version, other.version])).toEqual(before);
      // Another weekday is free.
      gridOf(await move(s.branch, s.version, own.id, 2, 3));
    });

    it('refuses a move within the travel time of the lesson elsewhere, and with no travel time set (Done when)', async () => {
      const { s, other } = await twoBranches(1);
      const own = await placed(s.branch, s.version, s.rowA, 2, 1);
      // 08:00–08:45 in the other branch, then 08:55–09:40 here: 10 minutes.
      expect(blockedRules(await move(s.branch, s.version, own.id, 1, 3))).toEqual([
        'travel_time_not_set',
      ]);
      await travel(s.branch, other.branch, 30);
      expect(blockedRules(await move(s.branch, s.version, own.id, 1, 3))).toEqual(['travel_time']);
      await travel(s.branch, other.branch, 10);
      gridOf(await move(s.branch, s.version, own.id, 1, 3));
    });

    it('answers the lesson elsewhere with its weekday, times and branch only, to the Academic Vice Principal of the branch and the Super Admin', async () => {
      const { s, other, entry } = await twoBranches(3);
      await viceIn(s.branch);
      await placed(s.branch, s.version, s.rowA, 2, 1);
      // The Super Admin works in every branch; the answer is still the version's branch's.
      for (const cookie of [t.vicePrincipal, t.admin]) {
        const response = await grid(s.branch, s.version, cookie);
        const answer = gridOf(response);
        expect(answer.facts.busyElsewhere).toEqual([
          {
            id: entry,
            teacherId: s.teacherA,
            branchId: other.branch,
            weekday: 1,
            start: 535,
            end: 580,
            tutorLesson: false,
          },
        ]);
        const branch = await t.database.migrator
          .selectFrom('branches')
          .select('name')
          .where('id', '=', other.branch)
          .executeTakeFirstOrThrow();
        expect(answer.facts.branches).toEqual([{ id: other.branch, name: branch.name }]);
        // Nothing else of the other branch: its classes, rows, rooms and subject.
        const text = JSON.stringify(response.body);
        for (const id of [
          other.classA,
          other.classB,
          other.rowA,
          other.rowB,
          other.roomA,
          other.roomB,
          other.version,
        ]) {
          expect(text).not.toContain(id);
        }
        expect(answer.facts.otherDrafts).toEqual([]);
      }
    });

    it('keeps the lesson elsewhere out of reach: a move, a swap and a remove naming it answer 404 and change nothing', async () => {
      // Review correction 1: "They cannot be moved from here".
      const { s, other, block, entry } = await twoBranches(3);
      const own = await placed(s.branch, s.version, s.rowA, 2, 1);
      const before = await patternRows([s.version, other.version]);
      for (const id of [block, entry]) {
        refusedWith(await move(s.branch, s.version, id, 2, 3), 404, 'not_found');
        refusedWith(await drop(s.branch, s.version, id), 404, 'not_found');
        refusedWith(await swap(s.branch, s.version, own.id, id), 404, 'not_found');
        refusedWith(await swap(s.branch, s.version, id, own.id), 404, 'not_found');
        // Task 5.4b-2a: nor is its room changed from here.
        refusedWith(
          await post(`/api/timetable/versions/${s.version}/pattern/${id}/room`, s.branch, {
            lessonId: entry,
            roomId: s.roomA,
          }),
          404,
          'not_found',
        );
      }
      expect(await patternRows([s.version, other.version])).toEqual(before);
    });

    it('refuses a new teacher of a row whose placed lesson meets their lesson in another branch (review correction 1)', async () => {
      const { s, other } = await twoBranches(3);
      await placed(s.branch, s.version, s.rowB, 1, 3);
      const loadRows = () =>
        t.database.migrator
          .selectFrom('teaching_load_rows')
          .selectAll()
          .where('version_id', 'in', [s.version, other.version])
          .orderBy('id')
          .execute();
      const before = [await patternRows([s.version, other.version]), await loadRows()];
      const response = await t.patch(
        `/api/timetable/versions/${s.version}/load/${s.rowB}`,
        s.branch,
        {
          teacherId: s.teacherA,
          lessonsPerWeek: 3,
          roomId: null,
          roomType: null,
          doubleLessons: false,
        },
      );
      expect(blockedRules(response)).toEqual(['teacher_double']);
      expect([await patternRows([s.version, other.version]), await loadRows()]).toEqual(before);
    });

    it('saves a lesson at the time another branch’s draft plans the teacher, with the other-draft warning', async () => {
      const { s, other } = await twoBranches(3, 'draft');
      const { answer, id } = await placed(s.branch, s.version, s.rowA, 1, 3);
      const lesson = answer.blocks.find((one) => one.id === id)?.lessons[0]?.id;
      expect(answer.results).toContainEqual(
        expect.objectContaining({
          rule: 'other_draft',
          severity: 'warning',
          weekday: 1,
          detail: { branchId: other.branch },
        }),
      );
      expect(answer.results.find((one) => one.rule === 'other_draft')?.lessonIds).toContain(lesson);
      expect(answer.facts.busyElsewhere).toEqual([]);
      expect(answer.facts.branches.map((one) => one.id)).toEqual([other.branch]);
    });
  });

  // Task 5.4b-2b: a suggestion of "Suggest a place" applied (06, Editing in the
  // grid: "a swap of two or three lessons that makes room for it"), checked by
  // the rule engine and refused like a move (Done when).
  describe('a suggestion applied', () => {
    type Change = {
      blockId?: string;
      loadRowId?: string;
      weekday: number;
      slotPosition: number;
      rooms?: { loadRowId: string; roomId: string }[];
    };
    const rearrange = (branch: string, version: string, changes: Change[], cookie = t.admin) =>
      post(`/api/timetable/versions/${version}/pattern/rearrange`, branch, { changes }, cookie);
    const slotOf = (answer: GridAnswer, blockId: string) => {
      const block = answer.blocks.find((one) => one.id === blockId);
      return block === undefined ? null : [block.weekday, block.slotPosition];
    };

    it('moves two blocks that clash halfway, checked together and audited from either', async () => {
      const s = await scene();
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ teacher_id: s.teacherA })
        .where('id', '=', s.rowB)
        .execute();
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const b = await placed(s.branch, s.version, s.rowB, 1, 3);
      const answer = gridOf(
        await rearrange(s.branch, s.version, [
          { blockId: a.id, weekday: 1, slotPosition: 3 },
          { blockId: b.id, weekday: 1, slotPosition: 1 },
        ]),
      );
      expect(slotOf(answer, a.id)).toEqual([1, 3]);
      expect(slotOf(answer, b.id)).toEqual([1, 1]);
      const [first] = await t.entries('pattern_block.rearrange', a.id);
      expect(first).toMatchObject({
        old_value: { versionId: s.version, rearrangedWith: [b.id], weekday: 1, slotPosition: 1 },
        new_value: { versionId: s.version, rearrangedWith: [b.id], weekday: 1, slotPosition: 3 },
      });
      const [second] = await t.entries('pattern_block.rearrange', b.id);
      expect(second).toMatchObject({
        new_value: { rearrangedWith: [a.id], weekday: 1, slotPosition: 1 },
      });
    });

    it('places a new block and moves two others in one write, the new block audited with them', async () => {
      const s = await scene();
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ teacher_id: s.teacherA })
        .where('id', '=', s.rowB)
        .execute();
      const science = await load.classes.subject({ grades: [7] });
      const rowC = await s.row(s.classA, await teacher(s.branch, science), { subject_id: science });
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const c = await placed(s.branch, s.version, rowC, 1, 3);
      // B's teacher is A's: A goes to C's slot, C to the last slot, B into A's.
      const answer = gridOf(
        await rearrange(s.branch, s.version, [
          { loadRowId: s.rowB, weekday: 1, slotPosition: 1 },
          { blockId: a.id, weekday: 1, slotPosition: 3 },
          { blockId: c.id, weekday: 1, slotPosition: 5 },
        ]),
      );
      expect(slotOf(answer, a.id)).toEqual([1, 3]);
      expect(slotOf(answer, c.id)).toEqual([1, 5]);
      const fresh = answer.blocks.find((one) =>
        one.lessons.some((lesson) => lesson.loadRowId === s.rowB),
      );
      expect(fresh).toMatchObject({ weekday: 1, slotPosition: 1 });
      const [created] = await t.entries('pattern_block.create', fresh?.id);
      expect(created).toMatchObject({ new_value: { rearrangedWith: [a.id, c.id] } });
      const [moved] = await t.entries('pattern_block.rearrange', c.id);
      expect(moved).toMatchObject({ new_value: { rearrangedWith: [fresh?.id, a.id] } });
    });

    it('answers the pins of step 5 with the grid, for the search to leave in place (decision 9)', async () => {
      const s = await scene();
      const other = await scene();
      const sameBranch = await load.version(s.branch, s.year, { startsOn: MONDAY });
      const sameBranchRow = await load.row({
        branch_id: s.branch,
        version_id: sameBranch,
        class_id: s.classA,
        subject_id: s.subject,
        teacher_id: s.teacherA,
      });
      // The pins of another version of the branch and of another branch stay out (permission review, should-fix 1).
      for (const [branch, version, row] of [
        [s.branch, s.version, s.rowA],
        [s.branch, sameBranch, sameBranchRow],
        [other.branch, other.version, other.rowA],
      ] as const) {
        await t.database.migrator
          .insertInto('timetable_pins')
          .values({
            branch_id: branch,
            version_id: version,
            load_row_id: row,
            weekday: 2,
            slot_position: 3,
          })
          .execute();
      }
      expect(gridOf(await grid(s.branch, s.version)).pins).toEqual([
        { loadRowId: s.rowA, weekday: 2, slotPosition: 3 },
      ]);
    });

    it('refuses a set that is still blocked, naming the rule and changing nothing', async () => {
      const s = await scene();
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ teacher_id: s.teacherA })
        .where('id', '=', s.rowB)
        .execute();
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      await placed(s.branch, s.version, s.rowB, 1, 3);
      const before = await patternRows([s.version]);
      expect(
        blockedRules(
          await rearrange(s.branch, s.version, [{ blockId: a.id, weekday: 1, slotPosition: 3 }]),
        ),
      ).toEqual(['teacher_double']);
      expect(await patternRows([s.version])).toEqual(before);
    });

    it('writes nothing for a block left at its slot and rooms, and writes a room it changes', async () => {
      const s = await scene();
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const spare = await load.classes.room(s.branch);
      const before = await patternRows([s.version]);
      gridOf(
        await rearrange(s.branch, s.version, [{ blockId: a.id, weekday: 1, slotPosition: 1 }]),
      );
      expect(await patternRows([s.version])).toEqual(before);
      const answer = gridOf(
        await rearrange(s.branch, s.version, [
          {
            blockId: a.id,
            weekday: 1,
            slotPosition: 1,
            rooms: [{ loadRowId: s.rowA, roomId: spare }],
          },
        ]),
      );
      expect(answer.blocks.find((one) => one.id === a.id)?.lessons[0]?.roomId).toBe(spare);
      const [entry] = await t.entries('pattern_block.rearrange', a.id);
      expect(entry).toMatchObject({
        old_value: { lessons: [{ loadRowId: s.rowA, roomId: s.roomA }] },
        new_value: { lessons: [{ loadRowId: s.rowA, roomId: spare }] },
      });
    });

    it('refuses a half of a mixed split, two changes of one block and two new blocks', async () => {
      const s = await scene();
      const pe = await load.classes.subject({ grades: [7] });
      const group = await load.classes.group(s.branch, s.year, pe, [s.classA]);
      await load.classes.group(s.branch, s.year, pe, [s.classA]);
      const half = await load.row({
        branch_id: s.branch,
        version_id: s.version,
        group_id: group,
        subject_id: pe,
        teacher_id: await teacher(s.branch, pe),
        lessons_per_week: 2,
        mixed_block: true,
      });
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const before = await patternRows([s.version]);
      refusedWith(
        await rearrange(s.branch, s.version, [{ loadRowId: half, weekday: 2, slotPosition: 1 }]),
        409,
        'pattern_mixed_block',
      );
      refusedWith(
        await rearrange(s.branch, s.version, [
          { blockId: a.id, weekday: 2, slotPosition: 1 },
          { blockId: a.id, weekday: 2, slotPosition: 3 },
        ]),
        400,
        'validation_failed',
      );
      refusedWith(
        await rearrange(s.branch, s.version, [
          { loadRowId: s.rowA, weekday: 2, slotPosition: 1 },
          { loadRowId: s.rowB, weekday: 2, slotPosition: 3 },
        ]),
        400,
        'validation_failed',
      );
      expect(await patternRows([s.version])).toEqual(before);
    });

    it('lets the Academic Vice Principal apply one; the Principal and a Teacher are refused; a published version is read only', async () => {
      const s = await scene();
      const assignment = await viceIn(s.branch);
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const before = await patternRows([s.version]);
      for (const cookie of [t.principal, t.teacher]) {
        refusedWith(
          await rearrange(
            t.north,
            s.version,
            [{ blockId: a.id, weekday: 2, slotPosition: 1 }],
            cookie,
          ),
          403,
          'permission_denied',
        );
      }
      expect(await patternRows([s.version])).toEqual(before);
      // Task 5.4c-1: the edit lock the writes above took is let go for the next account.
      await load.freeEditLock(s.version);
      gridOf(
        await rearrange(
          s.branch,
          s.version,
          [{ blockId: a.id, weekday: 2, slotPosition: 1 }],
          t.vicePrincipal,
        ),
      );
      const [entry] = await t.entries('pattern_block.rearrange', a.id);
      expect(entry).toMatchObject({ assignment_id: assignment });
      await load.setVersion(s.version, 'published');
      const kept = await patternRows([s.version]);
      refusedWith(
        await rearrange(s.branch, s.version, [{ blockId: a.id, weekday: 2, slotPosition: 3 }]),
        409,
        'version_not_draft',
      );
      expect(await patternRows([s.version])).toEqual(kept);
    });

    it("answers 404 for another branch's, another version's and an unknown version, block, row and room, changing nothing", async () => {
      const s = await scene();
      const other = await scene();
      const sameBranch = await load.version(s.branch, s.year, { startsOn: MONDAY });
      const sameBranchRow = await load.row({
        branch_id: s.branch,
        version_id: sameBranch,
        class_id: s.classA,
        subject_id: s.subject,
        teacher_id: s.teacherA,
      });
      const own = await placed(s.branch, s.version, s.rowA, 1, 1);
      const otherBlock = await placed(other.branch, other.version, other.rowA, 1, 1);
      const sameBranchBlock = await placed(s.branch, sameBranch, sameBranchRow, 1, 3);
      const spare = await load.classes.room(s.branch);
      await viceIn(s.branch);
      // Task 5.4c-1 (permission review, S2): another account left the lock 10 minutes ago, so
      // a refused write would take it over and notify; the refusal must undo both.
      await staleEditLock(s.version);
      const before = await patternRows([s.version, other.version, sameBranch]);
      const moved = (extra: Partial<Change> = {}): Change[] => [
        { blockId: own.id, weekday: 2, slotPosition: 1, ...extra },
      ];
      for (const cookie of [t.vicePrincipal, t.admin]) {
        for (const version of [other.version, UNKNOWN]) {
          refusedWith(await rearrange(s.branch, version, moved(), cookie), 404, 'not_found');
        }
        for (const block of [otherBlock.id, UNKNOWN, sameBranchBlock.id]) {
          refusedWith(
            await rearrange(
              s.branch,
              s.version,
              [{ blockId: block, weekday: 2, slotPosition: 1 }],
              cookie,
            ),
            404,
            'not_found',
          );
        }
        for (const row of [other.rowA, UNKNOWN, sameBranchRow]) {
          refusedWith(
            await rearrange(
              s.branch,
              s.version,
              [{ loadRowId: row, weekday: 2, slotPosition: 1 }],
              cookie,
            ),
            404,
            'not_found',
          );
          // A room for a row of another branch, an unknown one, one of another version.
          refusedWith(
            await rearrange(
              s.branch,
              s.version,
              moved({ rooms: [{ loadRowId: row, roomId: spare }] }),
              cookie,
            ),
            404,
            'not_found',
          );
        }
        // A room of another branch or an unknown one for a new block (permission review, should-fix 3).
        for (const roomId of [other.roomB, UNKNOWN]) {
          refusedWith(
            await rearrange(
              s.branch,
              s.version,
              [
                {
                  loadRowId: s.rowB,
                  weekday: 2,
                  slotPosition: 1,
                  rooms: [{ loadRowId: s.rowB, roomId }],
                },
              ],
              cookie,
            ),
            404,
            'not_found',
          );
        }
        // A room for a row of the draft that is not in the block.
        refusedWith(
          await rearrange(
            s.branch,
            s.version,
            moved({ rooms: [{ loadRowId: s.rowB, roomId: spare }] }),
            cookie,
          ),
          404,
          'not_found',
        );
        for (const roomId of [other.roomB, UNKNOWN]) {
          refusedWith(
            await rearrange(
              s.branch,
              s.version,
              moved({ rooms: [{ loadRowId: s.rowA, roomId }] }),
              cookie,
            ),
            404,
            'not_found',
          );
        }
      }
      expect(await patternRows([s.version, other.version, sameBranch])).toEqual(before);
    });
  });

  // Task 5.4c-2: the writes an undo or a redo sends (06, Editing in the grid:
  // "Undo and redo"; decisions 4, 5 and 7; From 5.4b-2b line: "a suggestion
  // that created a block is taken back by removing it in the same transaction").
  describe('the writes of an undo', () => {
    type Rooms = { loadRowId: string; roomId: string | null }[];
    type Change = {
      blockId?: string;
      loadRowId?: string;
      weekday: number;
      slotPosition: number;
      rooms?: Rooms;
    };
    const placeWith = (
      branch: string,
      version: string,
      loadRowId: string,
      rooms: Rooms,
      cookie = t.admin,
    ) =>
      post(
        `/api/timetable/versions/${version}/pattern`,
        branch,
        { loadRowId, weekday: 2, slotPosition: 1, rooms },
        cookie,
      );
    const roomOf = (
      branch: string,
      version: string,
      blockId: string,
      lessonId: string,
      roomId: string | null,
      cookie = t.admin,
    ) =>
      post(
        `/api/timetable/versions/${version}/pattern/${blockId}/room`,
        branch,
        { lessonId, roomId },
        cookie,
      );
    const rearrange = (
      branch: string,
      version: string,
      changes: Change[],
      removed: string[],
      cookie = t.admin,
    ) =>
      post(
        `/api/timetable/versions/${version}/pattern/rearrange`,
        branch,
        { changes, remove: removed },
        cookie,
      );
    const addLock = (branch: string, version: string, blockId: string) =>
      post(`/api/timetable/versions/${version}/locks`, branch, { kind: 'block', blockId });
    const blockOf = (answer: GridAnswer, blockId: string) =>
      answer.blocks.find((one) => one.id === blockId);
    const lessonOf = (answer: GridAnswer, blockId: string) => {
      const lesson = blockOf(answer, blockId)?.lessons[0];
      if (lesson === undefined) throw new Error('The block has no lesson.');
      return lesson;
    };
    /** A scene whose two rows share teacher A, so their blocks clash in one slot. */
    async function sharedTeacher() {
      const s = await scene();
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ teacher_id: s.teacherA })
        .where('id', '=', s.rowB)
        .execute();
      return s;
    }

    it('places a block again with the room of each lesson, a room or none, audited', async () => {
      const s = await scene();
      const spare = await load.classes.room(s.branch);
      const withSpare = gridOf(
        await placeWith(s.branch, s.version, s.rowA, [{ loadRowId: s.rowA, roomId: spare }]),
        201,
      );
      const a = withSpare.blocks.find((one) => one.lessons[0]?.loadRowId === s.rowA);
      expect(a?.lessons[0]?.roomId).toBe(spare);
      const [created] = await t.entries('pattern_block.create', a?.id);
      expect(created).toMatchObject({ new_value: { lessons: [{ roomId: spare }] } });
      const none = gridOf(
        await placeWith(s.branch, s.version, s.rowB, [{ loadRowId: s.rowB, roomId: null }]),
        201,
      );
      // Without `rooms` the row of B would take its class main classroom (5.4a).
      expect(
        none.blocks.find((one) => one.lessons[0]?.loadRowId === s.rowB)?.lessons[0],
      ).toMatchObject({ roomId: null });
    });

    it('refuses a room and the rooms of a block together, and answers 404 for a room of another branch, an unknown one and a row not in the block, changing nothing', async () => {
      const s = await scene();
      const other = await scene();
      const sameBranch = await load.version(s.branch, s.year, { startsOn: MONDAY });
      const sameBranchRow = await load.row({
        branch_id: s.branch,
        version_id: sameBranch,
        class_id: s.classA,
        subject_id: s.subject,
        teacher_id: s.teacherA,
      });
      await viceIn(s.branch);
      await staleEditLock(s.version);
      const before = await patternRows([s.version, other.version, sameBranch]);
      for (const cookie of [t.vicePrincipal, t.admin]) {
        for (const roomId of [other.roomB, UNKNOWN]) {
          refusedWith(
            await placeWith(s.branch, s.version, s.rowA, [{ loadRowId: s.rowA, roomId }], cookie),
            404,
            'not_found',
          );
        }
        for (const loadRowId of [s.rowB, other.rowA, UNKNOWN, sameBranchRow]) {
          refusedWith(
            await placeWith(s.branch, s.version, s.rowA, [{ loadRowId, roomId: null }], cookie),
            404,
            'not_found',
          );
        }
      }
      refusedWith(
        await post(`/api/timetable/versions/${s.version}/pattern`, s.branch, {
          loadRowId: s.rowA,
          weekday: 2,
          slotPosition: 1,
          roomId: s.roomA,
          rooms: [{ loadRowId: s.rowA, roomId: s.roomA }],
        }),
        400,
        'validation_failed',
      );
      expect(await patternRows([s.version, other.version, sameBranch])).toEqual(before);
    });

    it('gives a lesson no room in one audited write, as the Academic Vice Principal (decision 7)', async () => {
      const s = await scene();
      await viceIn(s.branch);
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const lesson = lessonOf(a.answer, a.id);
      expect(lesson.roomId).toBe(s.roomA);
      await load.freeEditLock(s.version);
      const answer = gridOf(
        await roomOf(s.branch, s.version, a.id, lesson.id, null, t.vicePrincipal),
      );
      expect(lessonOf(answer, a.id).roomId).toBeNull();
      const [entry] = await t.entries('pattern_entry.room', lesson.id);
      expect(entry).toMatchObject({
        old_value: { roomId: s.roomA },
        new_value: { blockId: a.id, loadRowId: s.rowA, roomId: null },
      });
    });

    it("answers 404 to no room for another branch's, another version's and an unknown block and lesson, changing nothing", async () => {
      const s = await scene();
      const other = await scene();
      const sameBranch = await load.version(s.branch, s.year, { startsOn: MONDAY });
      const sameBranchRow = await load.row({
        branch_id: s.branch,
        version_id: sameBranch,
        class_id: s.classA,
        subject_id: s.subject,
        teacher_id: s.teacherA,
      });
      const own = await placed(s.branch, s.version, s.rowA, 1, 1);
      const second = await placed(s.branch, s.version, s.rowB, 2, 1);
      const otherBlock = await placed(other.branch, other.version, other.rowA, 1, 1);
      const sameBranchBlock = await placed(s.branch, sameBranch, sameBranchRow, 1, 3);
      const lesson = lessonOf(own.answer, own.id).id;
      await viceIn(s.branch);
      await staleEditLock(s.version);
      const before = await patternRows([s.version, other.version, sameBranch]);
      for (const cookie of [t.vicePrincipal, t.admin]) {
        for (const block of [otherBlock.id, UNKNOWN, sameBranchBlock.id]) {
          refusedWith(
            await roomOf(s.branch, s.version, block, lesson, null, cookie),
            404,
            'not_found',
          );
        }
        for (const id of [
          lessonOf(second.answer, second.id).id,
          lessonOf(otherBlock.answer, otherBlock.id).id,
          UNKNOWN,
        ]) {
          refusedWith(
            await roomOf(s.branch, s.version, own.id, id, null, cookie),
            404,
            'not_found',
          );
        }
      }
      expect(await patternRows([s.version, other.version, sameBranch])).toEqual(before);
    });

    it('moves a block back into the slot of the block it removes, in one audited write', async () => {
      const s = await sharedTeacher();
      // The suggestion moved A from slot 1 to 3 and placed B (teacher A too) in slot 1.
      const a = await placed(s.branch, s.version, s.rowA, 1, 3);
      const b = await placed(s.branch, s.version, s.rowB, 1, 1);
      const answer = gridOf(
        await rearrange(
          s.branch,
          s.version,
          [{ blockId: a.id, weekday: 1, slotPosition: 1 }],
          [b.id],
        ),
      );
      expect(blockOf(answer, a.id)).toMatchObject({ weekday: 1, slotPosition: 1 });
      expect(blockOf(answer, b.id)).toBeUndefined();
      const [removed] = await t.entries('pattern_block.delete', b.id);
      expect(removed).toMatchObject({
        old_value: {
          versionId: s.version,
          rearrangedWith: [a.id],
          weekday: 1,
          slotPosition: 1,
          lessons: [{ loadRowId: s.rowB, teacherId: s.teacherA, roomId: s.roomB }],
        },
      });
      const [moved] = await t.entries('pattern_block.rearrange', a.id);
      expect(moved).toMatchObject({ new_value: { rearrangedWith: [b.id], slotPosition: 1 } });
    });

    it('removes a block alone as the Academic Vice Principal, and gives a lesson no room through its rooms', async () => {
      const s = await scene();
      await viceIn(s.branch);
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const b = await placed(s.branch, s.version, s.rowB, 1, 3);
      await load.freeEditLock(s.version);
      const answer = gridOf(await rearrange(s.branch, s.version, [], [b.id], t.vicePrincipal));
      await load.freeEditLock(s.version);
      expect(blockOf(answer, b.id)).toBeUndefined();
      expect(await t.entries('pattern_block.delete', b.id)).toHaveLength(1);
      const cleared = gridOf(
        await rearrange(
          s.branch,
          s.version,
          [
            {
              blockId: a.id,
              weekday: 1,
              slotPosition: 1,
              rooms: [{ loadRowId: s.rowA, roomId: null }],
            },
          ],
          [],
        ),
      );
      expect(lessonOf(cleared, a.id).roomId).toBeNull();
    });

    it('refuses a moved block that is still blocked, leaving the block it would remove in place', async () => {
      const s = await sharedTeacher();
      const science = await load.classes.subject({ grades: [7] });
      const rowC = await s.row(s.classA, await teacher(s.branch, science), { subject_id: science });
      const a = await placed(s.branch, s.version, s.rowA, 1, 3);
      const b = await placed(s.branch, s.version, s.rowB, 1, 5);
      // C, of class A too, holds slot 1; removing B does not free it.
      await placed(s.branch, s.version, rowC, 1, 1);
      const before = await patternRows([s.version]);
      expect(
        blockedRules(
          await rearrange(
            s.branch,
            s.version,
            [{ blockId: a.id, weekday: 1, slotPosition: 1 }],
            [b.id],
          ),
        ),
      ).toContain('class_double');
      expect(await patternRows([s.version])).toEqual(before);
    });

    it('refuses a moved block and a removed block locked since, changing nothing (decision 5)', async () => {
      const s = await sharedTeacher();
      const a = await placed(s.branch, s.version, s.rowA, 1, 3);
      const b = await placed(s.branch, s.version, s.rowB, 1, 1);
      expect((await addLock(s.branch, s.version, a.id)).status).toBe(201);
      let before = await patternRows([s.version]);
      refusedWith(
        await rearrange(
          s.branch,
          s.version,
          [{ blockId: a.id, weekday: 1, slotPosition: 1 }],
          [b.id],
        ),
        409,
        'pattern_locked',
      );
      expect(await patternRows([s.version])).toEqual(before);
      expect((await addLock(s.branch, s.version, b.id)).status).toBe(201);
      before = await patternRows([s.version]);
      refusedWith(await rearrange(s.branch, s.version, [], [b.id]), 409, 'pattern_locked');
      expect(await patternRows([s.version])).toEqual(before);
    });

    it('refuses to remove a block held by a day lock alone, the moved block free (decision 5)', async () => {
      const s = await sharedTeacher();
      // A on Monday, the block to remove on Tuesday, which is locked.
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const b = await placed(s.branch, s.version, s.rowB, 2, 1);
      const day = await post(`/api/timetable/versions/${s.version}/locks`, s.branch, {
        kind: 'day',
        weekday: 2,
      });
      expect(day.status).toBe(201);
      const before = await patternRows([s.version]);
      refusedWith(
        await rearrange(
          s.branch,
          s.version,
          [{ blockId: a.id, weekday: 1, slotPosition: 3 }],
          [b.id],
        ),
        409,
        'pattern_locked',
      );
      expect(await patternRows([s.version])).toEqual(before);
      // Without the removal the move alone goes through.
      gridOf(
        await rearrange(s.branch, s.version, [{ blockId: a.id, weekday: 1, slotPosition: 3 }], []),
      );
    });

    it("answers 404 for a removed block of another branch's and another version's draft and an unknown one, changing nothing", async () => {
      const s = await scene();
      const other = await scene();
      const sameBranch = await load.version(s.branch, s.year, { startsOn: MONDAY });
      const sameBranchRow = await load.row({
        branch_id: s.branch,
        version_id: sameBranch,
        class_id: s.classA,
        subject_id: s.subject,
        teacher_id: s.teacherA,
      });
      const own = await placed(s.branch, s.version, s.rowA, 1, 1);
      const otherBlock = await placed(other.branch, other.version, other.rowA, 1, 1);
      const sameBranchBlock = await placed(s.branch, sameBranch, sameBranchRow, 1, 3);
      // A lock of each block, so a removal that went through would take it with it.
      for (const [branch, version, blockId] of [
        [s.branch, s.version, own.id],
        [other.branch, other.version, otherBlock.id],
        [s.branch, sameBranch, sameBranchBlock.id],
      ] as const) {
        await t.database.migrator
          .insertInto('timetable_locks')
          .values({ branch_id: branch, version_id: version, kind: 'block', block_id: blockId })
          .execute();
      }
      await viceIn(s.branch);
      await staleEditLock(s.version);
      const before = await patternRows([s.version, other.version, sameBranch]);
      for (const cookie of [t.vicePrincipal, t.admin]) {
        for (const block of [otherBlock.id, UNKNOWN, sameBranchBlock.id]) {
          refusedWith(
            await rearrange(
              s.branch,
              s.version,
              [{ blockId: own.id, weekday: 2, slotPosition: 1 }],
              [block],
              cookie,
            ),
            404,
            'not_found',
          );
          refusedWith(await rearrange(s.branch, s.version, [], [block], cookie), 404, 'not_found');
        }
      }
      expect(await patternRows([s.version, other.version, sameBranch])).toEqual(before);
    });

    it('refuses every write of an undo to a second account while the first holds the edit lock', async () => {
      const s = await scene();
      await viceIn(s.branch);
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      await load.freeEditLock(s.version);
      gridOf(await move(s.branch, s.version, a.id, 1, 3, t.vicePrincipal));
      const before = await patternRows([s.version]);
      const lesson = lessonOf(gridOf(await grid(s.branch, s.version)), a.id).id;
      refusedWith(
        await placeWith(s.branch, s.version, s.rowB, [{ loadRowId: s.rowB, roomId: null }]),
        409,
        'draft_edit_locked',
      );
      refusedWith(await roomOf(s.branch, s.version, a.id, lesson, null), 409, 'draft_edit_locked');
      refusedWith(await rearrange(s.branch, s.version, [], [a.id]), 409, 'draft_edit_locked');
      expect(await patternRows([s.version])).toEqual(before);
    });
  });

  describe('a write and another write at the same moment', () => {
    /** How many connections to the test database wait for a lock right now. */
    async function waitingForALock(): Promise<number> {
      const found = await sql<{ waiting: number }>`
        select count(distinct l.pid)::int as waiting
        from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where a.datname = current_database() and not l.granted
      `.execute(t.database.migrator);
      return found.rows[0]?.waiting ?? 0;
    }

    /** Runs `work` in a transaction of the application that stays open until released. */
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

    it('makes a move wait for another move of the draft, then refuses the slot it took', async () => {
      const s = await scene();
      await t.database.migrator
        .updateTable('teaching_load_rows')
        .set({ teacher_id: s.teacherA })
        .where('id', '=', s.rowB)
        .execute();
      const a = await placed(s.branch, s.version, s.rowA, 1, 1);
      const b = await placed(s.branch, s.version, s.rowB, 1, 3);
      // The held side does what the move route does: the year FOR SHARE, the
      // version FOR UPDATE, then block A into Tuesday's first slot.
      const held = await holdOpen(s.branch, async (transaction) => {
        await transaction
          .selectFrom('academic_years')
          .select('id')
          .where('id', '=', s.year)
          .forShare()
          .execute();
        await transaction
          .selectFrom('timetable_versions')
          .select('id')
          .where('id', '=', s.version)
          .forUpdate()
          .execute();
        await transaction
          .updateTable('pattern_blocks')
          .set({ weekday: 2, slot_position: 1, start_minutes: 480, end_minutes: 525 })
          .where('id', '=', a.id)
          .execute();
      });
      const moving = move(s.branch, s.version, b.id, 2, 1).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      expect(await held.done).toBeUndefined();
      expect(blockedRules(await moving)).toEqual(['teacher_double']);
    });
  });

  // Task 5.4c-1: the edit lock of a draft (06, Editing in the grid: "Several
  // people can view a draft; one edits at a time"; edge/timetable, Generator
  // and editing: "The edit lock is released after 5 minutes without activity.
  // Another Academic Vice Principal can take over; the earlier holder is
  // told.") and the locks of the grid (06, Auto-generation, Locks).
  describe('the edit lock and the locks of a draft', () => {
    const MINUTE = 60_000;
    let vice = '';
    let admin = '';
    let viceName = '';
    let adminName = '';

    const accountOf = async (assignmentId: string) =>
      (
        await t.database.migrator
          .selectFrom('assignments')
          .select('account_id')
          .where('id', '=', assignmentId)
          .executeTakeFirstOrThrow()
      ).account_id;
    /** The account linked to a person of the North branch, named "last first" as the audit log names it. */
    const personOf = async (accountId: string) => {
      const { staffId } = await load.teacher(t.north, { accountId });
      const person = await t.database.migrator
        .selectFrom('staff')
        .select(['first_name', 'last_name'])
        .where('id', '=', staffId)
        .executeTakeFirstOrThrow();
      return `${person.last_name ?? ''} ${person.first_name ?? ''}`;
    };

    beforeAll(async () => {
      vice = await accountOf(t.viceAssignment);
      admin = await accountOf(t.adminAssignment);
      viceName = await personOf(vice);
      adminName = await personOf(admin);
    });

    const takeLock = (branch: string, version: string, cookie = t.admin) =>
      post(`/api/timetable/versions/${version}/edit-lock`, branch, {}, cookie);
    const addLock = (branch: string, version: string, body: object, cookie = t.admin) =>
      post(`/api/timetable/versions/${version}/locks`, branch, body, cookie);
    const dropLock = (branch: string, version: string, lockId: string, cookie = t.admin) =>
      remove(`/api/timetable/versions/${version}/locks/${lockId}`, branch, cookie);
    const rearrange = (
      branch: string,
      version: string,
      changes: { blockId: string; weekday: number; slotPosition: number }[],
      cookie = t.admin,
    ) => post(`/api/timetable/versions/${version}/pattern/rearrange`, branch, { changes }, cookie);
    const lockRow = (version: string) =>
      t.database.migrator
        .selectFrom('timetable_versions')
        .select(['edit_holder_id', 'edit_seen_at'])
        .where('id', '=', version)
        .executeTakeFirstOrThrow();
    /** The holder was last active `ago` milliseconds before the clock's moment. */
    const seenAgo = (version: string, ago: number) =>
      t.database.migrator
        .updateTable('timetable_versions')
        .set({ edit_seen_at: new Date(t.clock.now().getTime() - ago) })
        .where('id', '=', version)
        .execute();
    /** The takeover notices of an account in a branch (each scene has a branch of its own). */
    const noticesOf = (accountId: string, branch: string) =>
      t.database.migrator
        .selectFrom('notifications')
        .select(['kind', 'data', 'branch_id'])
        .where('account_id', '=', accountId)
        .where('branch_id', '=', branch)
        .where('kind', '=', 'timetable.draft_taken_over')
        .execute();
    const takeovers = async (version: string) =>
      (await t.entries('timetable_version.edit_lock', version)).map((entry) => [
        (entry.old_value as { holderId: string | null }).holderId,
        (entry.new_value as { holderId: string }).holderId,
      ]);

    describe('the edit lock', () => {
      it('is taken by the first write, audited, kept by the holder with no entry, and shown to every reader', async () => {
        const s = await scene();
        await viceIn(s.branch);
        expect(await lockRow(s.version)).toEqual({ edit_holder_id: null, edit_seen_at: null });
        const response = await place(s.branch, s.version, s.rowA, 1, 1, t.vicePrincipal);
        expect(gridOf(response, 201).version.editLock).toEqual({
          holder: { id: vice, name: viceName },
          seenAt: t.clock.now().toISOString(),
          mine: true,
        });
        const [entry] = await t.entries('timetable_version.edit_lock', s.version);
        expect(entry).toMatchObject({
          request_id: response.headers['x-request-id'],
          old_value: { holderId: null, seenAt: null },
          new_value: { holderId: vice },
        });
        // Two minutes later the holder's write keeps the lock: seen now, no entry.
        await seenAgo(s.version, 2 * MINUTE);
        gridOf(await place(s.branch, s.version, s.rowB, 2, 1, t.vicePrincipal), 201);
        expect(await lockRow(s.version)).toEqual({
          edit_holder_id: vice,
          edit_seen_at: t.clock.now(),
        });
        expect(await takeovers(s.version)).toEqual([[null, vice]]);
        // Another reader sees who edits, in the grid and in the list.
        expect(gridOf(await grid(s.branch, s.version)).version.editLock).toMatchObject({
          holder: { id: vice, name: viceName },
          mine: false,
        });
        const list = (await get('/api/timetable/versions', s.branch)).body as {
          versions: { id: string; editLock: unknown }[];
        };
        expect(list.versions.find((one) => one.id === s.version)?.editLock).toMatchObject({
          holder: { id: vice },
          mine: false,
        });
        // Free again after 5 minutes without activity.
        await seenAgo(s.version, 5 * MINUTE);
        expect(gridOf(await grid(s.branch, s.version)).version.editLock).toBeNull();
      });

      it('refuses another account until 5 minutes without activity, then lets it take over and tells the earlier holder', async () => {
        const s = await scene();
        await viceIn(s.branch);
        const a = await placed(s.branch, s.version, s.rowA, 1, 1);
        await load.freeEditLock(s.version);
        gridOf(await move(s.branch, s.version, a.id, 2, 1, t.vicePrincipal));
        await seenAgo(s.version, 5 * MINUTE - 1000);
        const before = [await patternRows([s.version]), await t.auditCount()];
        refusedWith(await move(s.branch, s.version, a.id, 3, 1), 409, 'draft_edit_locked');
        refusedWith(await takeLock(s.branch, s.version), 409, 'draft_edit_locked');
        refusedWith(await place(s.branch, s.version, s.rowB, 1, 1), 409, 'draft_edit_locked');
        refusedWith(
          await post(`/api/timetable/versions/${s.version}/templates/confirm`, s.branch),
          409,
          'draft_edit_locked',
        );
        expect([await patternRows([s.version]), await t.auditCount()]).toEqual(before);
        expect(await noticesOf(vice, s.branch)).toEqual([]);
        // At 5 minutes the lock is free: "Take over".
        await seenAgo(s.version, 5 * MINUTE);
        const taken = await takeLock(s.branch, s.version);
        expect(taken.status, JSON.stringify(taken.body)).toBe(200);
        expect((taken.body as { editLock: unknown }).editLock).toEqual({
          holder: { id: admin, name: adminName },
          seenAt: t.clock.now().toISOString(),
          mine: true,
        });
        const entries = await t.entries('timetable_version.edit_lock', s.version);
        expect(entries.at(-1)).toMatchObject({
          request_id: taken.headers['x-request-id'],
          old_value: { holderId: vice },
          new_value: { holderId: admin },
        });
        expect(await noticesOf(vice, s.branch)).toEqual([
          {
            kind: 'timetable.draft_taken_over',
            data: { number: '1', name: adminName },
            branch_id: s.branch,
          },
        ]);
        // The earlier holder's next write is refused; what they saved stays.
        refusedWith(
          await move(s.branch, s.version, a.id, 3, 1, t.vicePrincipal),
          409,
          'draft_edit_locked',
        );
        expect(gridOf(await grid(s.branch, s.version)).blocks).toEqual([
          expect.objectContaining({ id: a.id, weekday: 2, slotPosition: 1 }),
        ]);
      });

      it('lets the holder back after it expired with no entry and no notice; a free lock is taken with an entry and no notice', async () => {
        const s = await scene();
        await viceIn(s.branch);
        const taken = await takeLock(s.branch, s.version, t.vicePrincipal);
        expect(taken.status, JSON.stringify(taken.body)).toBe(200);
        expect(await takeovers(s.version)).toEqual([[null, vice]]);
        await seenAgo(s.version, 30 * MINUTE);
        gridOf(await place(s.branch, s.version, s.rowA, 1, 1, t.vicePrincipal), 201);
        expect(await takeovers(s.version)).toEqual([[null, vice]]);
        expect(await lockRow(s.version)).toEqual({
          edit_holder_id: vice,
          edit_seen_at: t.clock.now(),
        });
        expect(await noticesOf(vice, s.branch)).toEqual([]);
      });

      it('names a holder with no staff record by the login of the account', async () => {
        const s = await scene();
        const { id: teacher, login } = await t.database.migrator
          .selectFrom('assignments')
          .innerJoin('accounts', 'accounts.id', 'assignments.account_id')
          .select(['accounts.id', 'accounts.login'])
          .where('assignments.role', '=', 'teacher')
          .where('assignments.branch_id', '=', t.north)
          .executeTakeFirstOrThrow();
        await t.database.migrator
          .updateTable('timetable_versions')
          .set({ edit_holder_id: teacher, edit_seen_at: t.clock.now() })
          .where('id', '=', s.version)
          .execute();
        expect(gridOf(await grid(s.branch, s.version)).version.editLock).toMatchObject({
          holder: { id: teacher, name: login },
          mine: false,
        });
      });

      it('answers 404 for another branch’s and an unknown version, 403 to the Principal and a Teacher, and refuses a published one', async () => {
        const s = await scene();
        const other = await scene();
        await viceIn(s.branch);
        const versions = [s.version, other.version];
        const before = [await patternRows(versions), await t.auditCount()];
        for (const cookie of [t.vicePrincipal, t.admin]) {
          for (const version of [other.version, UNKNOWN]) {
            refusedWith(await takeLock(s.branch, version, cookie), 404, 'not_found');
          }
        }
        for (const cookie of [t.principal, t.teacher]) {
          refusedWith(await takeLock(t.north, s.version, cookie), 403, 'permission_denied');
        }
        expect([await patternRows(versions), await t.auditCount()]).toEqual(before);
        await load.setVersion(s.version, 'published');
        refusedWith(await takeLock(s.branch, s.version), 409, 'version_not_draft');
        expect(await lockRow(s.version)).toEqual({ edit_holder_id: null, edit_seen_at: null });
      });

      it('keeps the pair of holder and moment together in the database', async () => {
        const s = await scene();
        await expect(
          t.database.migrator
            .updateTable('timetable_versions')
            .set({ edit_holder_id: vice })
            .where('id', '=', s.version)
            .execute(),
        ).rejects.toMatchObject({ constraint: 'timetable_versions_edit_lock_check' });
      });
    });

    describe('the locks', () => {
      it('sets and removes a lock of each kind, audited, answered in the grid; a lock set twice is refused', async () => {
        const s = await scene();
        await viceIn(s.branch);
        const a = await placed(s.branch, s.version, s.rowA, 1, 1);
        await load.freeEditLock(s.version);
        const bodies = [
          { kind: 'block', blockId: a.id },
          { kind: 'class', classId: s.classA },
          { kind: 'teacher', teacherId: s.teacherB },
          { kind: 'day', weekday: 3 },
        ];
        for (const body of bodies) {
          const response = await addLock(s.branch, s.version, body, t.vicePrincipal);
          const answer = gridOf(response, 201);
          const lock = answer.locks.at(-1);
          expect(lock).toMatchObject(body);
          const [entry] = await t.entries('timetable_lock.create', lock?.id);
          expect(entry).toMatchObject({
            request_id: response.headers['x-request-id'],
            new_value: { versionId: s.version, ...body },
          });
          const count = await t.auditCount();
          refusedWith(await addLock(s.branch, s.version, body, t.vicePrincipal), 409, 'lock_taken');
          expect(await t.auditCount()).toBe(count);
        }
        const locks = gridOf(await grid(s.branch, s.version)).locks;
        expect(locks).toHaveLength(4);
        for (const lock of locks) {
          const response = await dropLock(s.branch, s.version, lock.id, t.vicePrincipal);
          expect(gridOf(response).locks.map((one) => one.id)).not.toContain(lock.id);
          const [entry] = await t.entries('timetable_lock.delete', lock.id);
          expect(entry).toMatchObject({ old_value: { versionId: s.version, kind: lock.kind } });
        }
      });

      it('keeps a locked lesson out of an applied suggestion for each kind, and lets it be moved by hand', async () => {
        const s = await scene();
        const a = await placed(s.branch, s.version, s.rowA, 1, 1);
        const b = await placed(s.branch, s.version, s.rowB, 2, 1);
        const kinds = [
          { kind: 'block', blockId: a.id },
          { kind: 'class', classId: s.classA },
          { kind: 'teacher', teacherId: s.teacherA },
          // The day it is on, and the day it would move to.
          { kind: 'day', weekday: 1 },
          { kind: 'day', weekday: 3 },
        ];
        for (const body of kinds) {
          const lock = gridOf(await addLock(s.branch, s.version, body), 201).locks.at(-1);
          if (lock === undefined) throw new Error('The lock was not answered.');
          const before = [await patternRows([s.version]), await t.auditCount()];
          refusedWith(
            await rearrange(s.branch, s.version, [
              { blockId: a.id, weekday: 3, slotPosition: 1 },
              { blockId: b.id, weekday: 3, slotPosition: 3 },
            ]),
            409,
            'pattern_locked',
          );
          expect([await patternRows([s.version]), await t.auditCount()]).toEqual(before);
          gridOf(await dropLock(s.branch, s.version, lock.id));
        }
        // With no lock left on these lessons (another day's lock stays) the same suggestion is
        // applied (permission review, S3).
        gridOf(await addLock(s.branch, s.version, { kind: 'day', weekday: 5 }), 201);
        gridOf(
          await rearrange(s.branch, s.version, [
            { blockId: a.id, weekday: 3, slotPosition: 1 },
            { blockId: b.id, weekday: 3, slotPosition: 3 },
          ]),
        );
        // Decision 8: a hand move of a locked lesson is saved.
        gridOf(await addLock(s.branch, s.version, { kind: 'block', blockId: a.id }), 201);
        expect(gridOf(await move(s.branch, s.version, a.id, 4, 1)).blocks).toContainEqual(
          expect.objectContaining({ id: a.id, weekday: 4 }),
        );
      });

      it('goes with its block, the removal naming it in its audit entry', async () => {
        const s = await scene();
        const a = await placed(s.branch, s.version, s.rowA, 1, 1);
        const lock = gridOf(
          await addLock(s.branch, s.version, { kind: 'block', blockId: a.id }),
          201,
        ).locks[0];
        expect(gridOf(await drop(s.branch, s.version, a.id)).locks).toEqual([]);
        const [entry] = await t.entries('pattern_block.delete', a.id);
        expect(entry).toMatchObject({ old_value: { locks: [lock?.id] } });
      });

      it('answers 404 for another branch’s, another version’s and an unknown id of the path and the body, changing nothing', async () => {
        const s = await scene();
        const other = await scene();
        const sameBranch = await load.version(s.branch, s.year, { startsOn: MONDAY });
        const sameBranchRow = await load.row({
          branch_id: s.branch,
          version_id: sameBranch,
          class_id: s.classA,
          subject_id: s.subject,
          teacher_id: s.teacherA,
        });
        const own = await placed(s.branch, s.version, s.rowA, 1, 1);
        const otherBlock = await placed(other.branch, other.version, other.rowA, 1, 1);
        const sameBranchBlock = await placed(s.branch, sameBranch, sameBranchRow, 1, 3);
        const otherLock = gridOf(
          await addLock(other.branch, other.version, { kind: 'day', weekday: 2 }),
          201,
        ).locks[0];
        const sameBranchLock = gridOf(
          await addLock(s.branch, sameBranch, { kind: 'day', weekday: 2 }),
          201,
        ).locks[0];
        if (otherLock === undefined || sameBranchLock === undefined) throw new Error('No lock.');
        await viceIn(s.branch);
        await staleEditLock(s.version);
        const versions = [s.version, other.version, sameBranch];
        const before = [await patternRows(versions), await t.auditCount()];
        for (const cookie of [t.vicePrincipal, t.admin]) {
          for (const version of [other.version, UNKNOWN]) {
            refusedWith(
              await addLock(s.branch, version, { kind: 'day', weekday: 4 }, cookie),
              404,
              'not_found',
            );
            refusedWith(await dropLock(s.branch, version, otherLock.id, cookie), 404, 'not_found');
          }
          for (const body of [
            ...[otherBlock.id, UNKNOWN, sameBranchBlock.id].map((blockId) => ({
              kind: 'block',
              blockId,
            })),
            ...[other.classA, UNKNOWN].map((classId) => ({ kind: 'class', classId })),
            ...[other.teacherA, UNKNOWN].map((teacherId) => ({ kind: 'teacher', teacherId })),
          ]) {
            refusedWith(await addLock(s.branch, s.version, body, cookie), 404, 'not_found');
          }
          for (const lockId of [otherLock.id, UNKNOWN, sameBranchLock.id]) {
            refusedWith(await dropLock(s.branch, s.version, lockId, cookie), 404, 'not_found');
          }
        }
        expect([await patternRows(versions), await t.auditCount()]).toEqual(before);
        expect(own.id).toBeDefined();
      });

      it('is refused to the Principal and a Teacher, and on a published version', async () => {
        const s = await scene();
        const lock = gridOf(await addLock(s.branch, s.version, { kind: 'day', weekday: 2 }), 201)
          .locks[0];
        if (lock === undefined) throw new Error('No lock.');
        const before = [await patternRows([s.version]), await t.auditCount()];
        for (const cookie of [t.principal, t.teacher]) {
          refusedWith(
            await addLock(t.north, s.version, { kind: 'day', weekday: 3 }, cookie),
            403,
            'permission_denied',
          );
          refusedWith(
            await dropLock(t.north, s.version, lock.id, cookie),
            403,
            'permission_denied',
          );
        }
        expect([await patternRows([s.version]), await t.auditCount()]).toEqual(before);
        await load.setVersion(s.version, 'published');
        const published = await patternRows([s.version]);
        refusedWith(
          await addLock(s.branch, s.version, { kind: 'day', weekday: 3 }),
          409,
          'version_not_draft',
        );
        refusedWith(await dropLock(s.branch, s.version, lock.id), 409, 'version_not_draft');
        expect(await patternRows([s.version])).toEqual(published);
      });

      it('holds exactly the target of its kind, once per version, in a draft only (0072)', async () => {
        const s = await scene();
        const insert = (values: Record<string, unknown>) =>
          t.database.migrator
            .insertInto('timetable_locks')
            .values({ branch_id: s.branch, version_id: s.version, ...values } as never)
            .execute();
        await expect(insert({ kind: 'day' })).rejects.toMatchObject({
          constraint: 'timetable_locks_target_check',
        });
        await expect(insert({ kind: 'day', weekday: 2, class_id: s.classA })).rejects.toMatchObject(
          { constraint: 'timetable_locks_target_check' },
        );
        await insert({ kind: 'day', weekday: 2 });
        await expect(insert({ kind: 'day', weekday: 2 })).rejects.toMatchObject({
          constraint: 'timetable_locks_day_key',
        });
        await load.setVersion(s.version, 'published');
        await expect(insert({ kind: 'day', weekday: 3 })).rejects.toMatchObject({
          constraint: 'pattern_version_draft',
        });
      });
    });

    describe('two accounts taking an expired lock at the same moment', () => {
      /** How many connections to the test database wait for a lock right now. */
      async function waitingForALock(): Promise<number> {
        const found = await sql<{ waiting: number }>`
          select count(distinct l.pid)::int as waiting
          from pg_locks l join pg_stat_activity a on a.pid = l.pid
          where a.datname = current_database() and not l.granted
        `.execute(t.database.migrator);
        return found.rows[0]?.waiting ?? 0;
      }

      // In each order the account whose take commits first holds the lock, and
      // the other's write waits for the version row, then is refused.
      for (const order of ['vice first', 'admin first'] as const) {
        it(`gives the lock to the first and refuses the second with draft_edit_locked (${order})`, async () => {
          const s = await scene();
          await viceIn(s.branch);
          const a = await placed(s.branch, s.version, s.rowA, 1, 1);
          // A third account held the lock and left 10 minutes ago.
          const teacher = await accountOf(
            (
              await t.database.migrator
                .selectFrom('assignments')
                .select('id')
                .where('role', '=', 'teacher')
                .where('branch_id', '=', t.north)
                .executeTakeFirstOrThrow()
            ).id,
          );
          await t.database.migrator
            .updateTable('timetable_versions')
            .set({ edit_holder_id: teacher })
            .where('id', '=', s.version)
            .execute();
          await seenAgo(s.version, 10 * MINUTE);
          const [first, second, secondCookie] =
            order === 'vice first' ? [vice, admin, t.admin] : [admin, vice, t.vicePrincipal];
          // The held side does what lockDraft does for the first account: the
          // year FOR SHARE, the version FOR UPDATE, then the holder and the moment.
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
            .run([s.branch], async (transaction) => {
              await transaction
                .selectFrom('academic_years')
                .select('id')
                .where('id', '=', s.year)
                .forShare()
                .execute();
              await transaction
                .selectFrom('timetable_versions')
                .select('id')
                .where('id', '=', s.version)
                .forUpdate()
                .execute();
              await transaction
                .updateTable('timetable_versions')
                .set({ edit_holder_id: first, edit_seen_at: t.clock.now() })
                .where('id', '=', s.version)
                .execute();
              ready();
              await released;
            })
            .catch((error: unknown) => error);
          await Promise.race([isReady, done]);
          const moving = move(s.branch, s.version, a.id, 2, 1, secondCookie).then(
            (response) => response,
          );
          await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
          release();
          expect(await done).toBeUndefined();
          refusedWith(await moving, 409, 'draft_edit_locked');
          expect((await lockRow(s.version)).edit_holder_id).toBe(first);
          expect(second).not.toBe(first);
          expect(gridOf(await grid(s.branch, s.version)).blocks).toEqual([
            expect.objectContaining({ id: a.id, weekday: 1, slotPosition: 1 }),
          ]);
        });
      }
    });
  });
});
