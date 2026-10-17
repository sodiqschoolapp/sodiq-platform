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
    t = await dayTemplatesKit();
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
});
