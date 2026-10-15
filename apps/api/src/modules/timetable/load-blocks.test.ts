import {
  groupDetailSchema,
  groupListSchema,
  loadRowSchema,
  loadSchema,
  loadTeachersSchema,
  loadTotalsSchema,
  timetableVersionSchema,
  type LoadRow,
  type TimetableVersion,
} from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { dayTemplatesKit, UNKNOWN, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

/** Monday 12 October 2026: the next Monday from the kit's Saturday 10 October. */
const MONDAY = '2026-10-12';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const rowOf = (response: Response): LoadRow => {
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return loadRowSchema.parse(response.body);
};

// All names are invented. docs/spec/edge-cases/timetable.md, Structure: "a
// split or a set of parallel groups is one block", "all parts have equal
// lessons per week and different teachers. A mixed block is allowed";
// 05-classes-groups-subjects.md, Group: "Whether a class is split for a
// subject is set in the teaching load; the subject's group switch is only the
// default"; 06-timetable.md, Building a timetable, steps 2 and 3, and Teachers
// who work in several branches, Weekly load. Task 3.4b, pull request #100,
// with corrections 1 and 2 of its review. The clock stands at 23:55 on
// Saturday 10 October 2026 in Tashkent.
describe('splits, groups and weekly totals of the teaching load', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let members: MembersKit;
  let year: string;
  let southYear: string;
  let subject: string;

  const get = (path: string, cookie = t.vicePrincipal, branch = t.north) =>
    t.get(path, branch, cookie);
  const post = (path: string, body: object = {}, cookie = t.vicePrincipal, branch = t.north) =>
    t.post(path, branch, body, cookie);
  const patch = (path: string, body: object, cookie = t.vicePrincipal, branch = t.north) =>
    t.patch(path, branch, body, cookie);

  async function draft(fields: object = {}): Promise<TimetableVersion> {
    const response = await post('/api/timetable/versions', {
      academicYearId: year,
      startsOn: MONDAY,
      ...fields,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return timetableVersionSchema.parse(response.body);
  }

  /** A class of grade 7 in Uzbek of the North. */
  const schoolClass = (grade = 7) =>
    load.classes.schoolClass(t.north, year, { grade, language: 'uz' });

  /** A teacher of the North who may take the subject in grades 4 and 7. */
  const teacher = async () =>
    (await load.teacher(t.north, { subjects: [{ subject, grades: [4, 7] }] })).staffId;

  const group = (classIds: string[], subjectId = subject) =>
    load.classes.group(t.north, year, subjectId, classIds);

  const rowBody = (fields: object) => ({
    classId: null,
    groupId: null,
    subjectId: subject,
    lessonsPerWeek: 3,
    roomId: null,
    roomType: null,
    doubleLessons: false,
    ...fields,
  });

  const createRow = (versionId: string, fields: object) =>
    post(`/api/timetable/versions/${versionId}/load`, rowBody(fields));

  const editRow = (versionId: string, row: LoadRow, fields: object) =>
    patch(`/api/timetable/versions/${versionId}/load/${row.id}`, {
      teacherId: row.teacher.id,
      lessonsPerWeek: row.lessonsPerWeek,
      roomId: row.room?.id ?? null,
      roomType: row.roomType,
      doubleLessons: row.doubleLessons,
      ...fields,
    });

  const loadOf = async (versionId: string) =>
    loadSchema.parse((await get(`/api/timetable/versions/${versionId}/load`).expect(200)).body);

  const rowsOf = () =>
    Promise.all([
      t.database.migrator.selectFrom('timetable_versions').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('teaching_load_rows').selectAll().orderBy('id').execute(),
      t.auditCount(),
    ]);

  beforeAll(async () => {
    t = await dayTemplatesKit();
    load = new LoadKit(t.database.migrator);
    members = new MembersKit(t.database.migrator, await load.classes.account());
    year = await load.classes.year(t.north);
    southYear = await load.classes.year(t.south);
    subject = await load.classes.subject({ grades: [4, 5, 7, 8, 9] });
    // Lessons of 45 minutes from 08:00 for grades 5 to 11, of 40 for grades 1 to 4,
    // with 10-minute breaks: 08:00-08:45, 08:55-09:40, 09:50-10:35 and
    // 08:00-08:40, 08:50-09:30, 09:40-10:20.
    const long = await t.createSlotType(t.north, 'Lesson', 'lesson', 45);
    const short = await t.createSlotType(t.north, 'Short lesson', 'lesson', 40);
    const pause = await t.createSlotType(t.north, 'Break', 'break', 10);
    const regular = await t.createTemplate(t.north, 'Regular', [long, pause, long, pause, long]);
    const junior = await t.createTemplate(t.north, 'Junior', [short, pause, short, pause, short]);
    await t.assign(t.north, regular);
    await t.assign(t.north, junior, { level: 'grades', gradeFrom: 1, gradeTo: 4 });
  });

  afterAll(async () => {
    await t.close();
  });

  describe('the block rules at the route', () => {
    it('refuses a part with other lessons, and one teacher on two parts', async () => {
      const version = await draft();
      const oxford = await schoolClass();
      const [a, b] = [await group([oxford]), await group([oxford])];
      const first = await teacher();
      const second = await teacher();
      rowOf(await createRow(version.id, { groupId: a, teacherId: first }));
      const before = await rowsOf();
      refusedWith(
        await createRow(version.id, { groupId: b, teacherId: second, lessonsPerWeek: 2 }),
        409,
        'load_block_lessons',
      );
      refusedWith(
        await createRow(version.id, { groupId: b, teacherId: first }),
        409,
        'load_block_teacher',
      );
      expect(await rowsOf()).toEqual(before);
      const row = rowOf(await createRow(version.id, { groupId: b, teacherId: second }));
      expect(row.block.map((part) => part.id).sort()).toHaveLength(2);
      expect(row.problems).toEqual([]);
    });

    it('refuses a group row beside a class row of its class and subject, and the reverse', async () => {
      const version = await draft();
      const oxford = await schoolClass();
      const princeton = await schoolClass();
      const split = await group([oxford]);
      const across = await group([princeton, await schoolClass()]);
      rowOf(await createRow(version.id, { classId: oxford, teacherId: await teacher() }));
      refusedWith(
        await createRow(version.id, { groupId: split, teacherId: await teacher() }),
        409,
        'load_split_and_whole',
      );
      rowOf(await createRow(version.id, { groupId: across, teacherId: await teacher() }));
      refusedWith(
        await createRow(version.id, { classId: princeton, teacherId: await teacher() }),
        409,
        'load_split_and_whole',
      );
    });

    it('refuses the mixed mark on a group across classes, and lets one teacher take both mixed halves', async () => {
      const version = await draft();
      const across = await group([await schoolClass(), await schoolClass()]);
      refusedWith(
        await createRow(version.id, {
          groupId: across,
          teacherId: await teacher(),
          mixedBlock: true,
        }),
        409,
        'load_mixed_not_split',
      );
      const oxford = await schoolClass();
      const [a, b] = [await group([oxford]), await group([oxford])];
      const one = await teacher();
      rowOf(await createRow(version.id, { groupId: a, teacherId: one, mixedBlock: true }));
      const row = rowOf(
        await createRow(version.id, { groupId: b, teacherId: one, mixedBlock: true }),
      );
      expect(row).toMatchObject({ mixedBlock: true, problems: [] });
    });

    it('writes lessons per week to every part of the block in one entry, and the mark to every half', async () => {
      const version = await draft();
      const oxford = await schoolClass();
      const [a, b] = [await group([oxford]), await group([oxford])];
      const first = rowOf(await createRow(version.id, { groupId: a, teacherId: await teacher() }));
      const second = rowOf(await createRow(version.id, { groupId: b, teacherId: await teacher() }));
      const response = await editRow(version.id, first, { lessonsPerWeek: 5 });
      expect(rowOf(response).lessonsPerWeek).toBe(5);
      const rows = (await loadOf(version.id)).rows;
      expect(rows.map((row) => row.lessonsPerWeek)).toEqual([5, 5]);
      const [entry] = await t.entries('teaching_load.edit', first.id);
      expect(entry).toMatchObject({
        assignment_id: t.viceAssignment,
        request_id: response.headers['x-request-id'],
        old_value: { lessonsPerWeek: 3, parts: [{ rowId: second.id, lessonsPerWeek: 3 }] },
        new_value: { lessonsPerWeek: 5, parts: [{ rowId: second.id, lessonsPerWeek: 5 }] },
      });
      const marked = await editRow(
        version.id,
        { ...first, lessonsPerWeek: 5 },
        { mixedBlock: true },
      );
      expect(marked.status, JSON.stringify(marked.body)).toBe(200);
      const markEntry = (await t.entries('teaching_load.edit', first.id)).find(
        (one) => one.request_id === marked.headers['x-request-id'],
      );
      expect(markEntry).toMatchObject({
        old_value: { mixedBlock: false, parts: [{ rowId: second.id, mixedBlock: false }] },
        new_value: { mixedBlock: true, parts: [{ rowId: second.id, mixedBlock: true }] },
      });
      expect((await loadOf(version.id)).rows.map((row) => row.mixedBlock)).toEqual([true, true]);
      // One teacher on both mixed halves: a teacher change passes.
      rowOf(
        await editRow(
          version.id,
          { ...second, lessonsPerWeek: 5 },
          { teacherId: first.teacher.id },
        ),
      );
    });

    it('refuses halves that disagree on the mark, a cleared mark with one teacher, and the mark outside a split, changing nothing', async () => {
      const version = await draft();
      const oxford = await schoolClass();
      const [a, b] = [await group([oxford]), await group([oxford])];
      const one = await teacher();
      rowOf(await createRow(version.id, { groupId: a, teacherId: one, mixedBlock: true }));
      let before = await rowsOf();
      refusedWith(
        await createRow(version.id, { groupId: b, teacherId: await teacher() }),
        409,
        'load_block_mixed',
      );
      expect(await rowsOf()).toEqual(before);
      const second = rowOf(
        await createRow(version.id, { groupId: b, teacherId: one, mixedBlock: true }),
      );
      before = await rowsOf();
      // The cleared mark is written to both halves, which then share one teacher.
      refusedWith(
        await editRow(version.id, second, { mixedBlock: false }),
        409,
        'load_block_teacher',
      );
      expect(await rowsOf()).toEqual(before);
      const across = await group([await schoolClass(), await schoolClass()]);
      const acrossRow = rowOf(
        await createRow(version.id, { groupId: across, teacherId: await teacher() }),
      );
      const classRow = rowOf(
        await createRow(version.id, { classId: await schoolClass(), teacherId: await teacher() }),
      );
      const otherClass = await schoolClass();
      const otherTeacher = await teacher();
      before = await rowsOf();
      refusedWith(
        await editRow(version.id, acrossRow, { mixedBlock: true }),
        409,
        'load_mixed_not_split',
      );
      refusedWith(
        await createRow(version.id, {
          classId: otherClass,
          teacherId: otherTeacher,
          mixedBlock: true,
        }),
        409,
        'load_mixed_not_split',
      );
      refusedWith(
        await editRow(version.id, classRow, { mixedBlock: true }),
        409,
        'load_mixed_not_split',
      );
      expect(await rowsOf()).toEqual(before);
    });

    /** Two splits of two classes joined into one block by a class added to a group later. */
    async function brokenBlock(lessons: [number, number], teachers: [string, string]) {
      const version = await draft();
      const oxford = await schoolClass();
      const princeton = await schoolClass();
      const a = await group([oxford]);
      const c = await group([princeton]);
      rowOf(
        await createRow(version.id, {
          groupId: a,
          teacherId: teachers[0],
          lessonsPerWeek: lessons[0],
        }),
      );
      const rowC = rowOf(
        await createRow(version.id, {
          groupId: c,
          teacherId: teachers[1],
          lessonsPerWeek: lessons[1],
        }),
      );
      // Not refused: a later change elsewhere is listed (3.4a decision 3).
      await t.database.migrator
        .insertInto('group_classes')
        .values({ group_id: a, class_id: princeton, branch_id: t.north })
        .execute();
      return { version, rowC, princeton };
    }

    it('lists the problems of a block broken by a later change, and refuses no edit of another field', async () => {
      const shared = await teacher();
      const { version, rowC } = await brokenBlock([3, 2], [shared, shared]);
      const broken = (await loadOf(version.id)).rows.find((row) => row.id === rowC.id);
      expect(broken?.problems).toEqual(['load_block_lessons', 'load_block_teacher']);
      // A room edit is refused for neither.
      rowOf(await editRow(version.id, rowC, { roomType: 'laboratory' }));
      // A lessons edit is not refused for one teacher twice: every part gets the lessons.
      const edited = rowOf(
        await editRow(version.id, { ...rowC, roomType: 'laboratory' }, { lessonsPerWeek: 4 }),
      );
      expect(edited.problems).toEqual(['load_block_teacher']);
      // A teacher change to the other part's teacher is refused for the teacher.
      const moved = rowOf(await editRow(version.id, edited, { teacherId: await teacher() }));
      expect(moved.problems).toEqual([]);
      refusedWith(
        await editRow(version.id, moved, { teacherId: shared }),
        409,
        'load_block_teacher',
      );
    });

    it('refuses no teacher change of a broken block for unequal lessons', async () => {
      const { version, rowC, princeton } = await brokenBlock(
        [3, 2],
        [await teacher(), await teacher()],
      );
      const edited = rowOf(await editRow(version.id, rowC, { teacherId: await teacher() }));
      expect(edited.problems).toEqual(['load_block_lessons']);
      // A create into the broken block is refused whatever is typed: the block is repaired first.
      const another = await group([princeton]);
      for (const lessonsPerWeek of [2, 3]) {
        refusedWith(
          await createRow(version.id, {
            groupId: another,
            teacherId: await teacher(),
            lessonsPerWeek,
          }),
          409,
          'load_block_lessons',
        );
      }
    });
  });

  describe('the teachers offered for a part (decision 11)', () => {
    it('leave out the teachers of the other parts, and equal what the create accepts', async () => {
      const version = await draft();
      const oxford = await schoolClass();
      const [a, b] = [await group([oxford]), await group([oxford])];
      const taken = await teacher();
      const free = await teacher();
      rowOf(await createRow(version.id, { groupId: a, teacherId: taken }));
      const offered = loadTeachersSchema
        .parse(
          (
            await get(
              `/api/timetable/versions/${version.id}/load/teachers?groupId=${b}&subjectId=${subject}`,
            ).expect(200)
          ).body,
        )
        .teachers.map((one) => one.id);
      expect(offered).toContain(free);
      expect(offered).not.toContain(taken);
      // Task 3.5b, H30: the reason names the group the teacher already teaches in the block.
      const answer = loadTeachersSchema.parse(
        (
          await get(
            `/api/timetable/versions/${version.id}/load/teachers?groupId=${b}&subjectId=${subject}`,
          ).expect(200)
        ).body,
      );
      const groupName = await t.database.migrator
        .selectFrom('groups')
        .select('name')
        .where('id', '=', a)
        .executeTakeFirstOrThrow();
      expect(answer.excluded.find((one) => one.id === taken)).toMatchObject({
        reason: 'block',
        blockGroup: groupName.name,
      });
      // The row of the group itself does not leave its own teacher out.
      const own = loadTeachersSchema
        .parse(
          (
            await get(
              `/api/timetable/versions/${version.id}/load/teachers?groupId=${a}&subjectId=${subject}`,
            ).expect(200)
          ).body,
        )
        .teachers.map((one) => one.id);
      expect(own).toContain(taken);
    });
  });

  describe('students not placed (decision 4)', () => {
    it('counts the students with a gap and those of a group without a row, and never refuses', async () => {
      const version = await draft();
      const oxford = await schoolClass();
      // Placed in the class before the groups exist: a gap from the start date.
      const gap = await members.student(t.north);
      await members.member({
        branch: t.north,
        classId: oxford,
        studentId: gap,
        from: '2026-09-01',
      });
      const [a, b, c] = [await group([oxford]), await group([oxford]), await group([oxford])];
      const place = async (groupId: string) => {
        const studentId = await members.student(t.north);
        await t.database.migrator.transaction().execute(async (transaction) => {
          await members.member(
            { branch: t.north, classId: oxford, studentId, from: '2026-09-01' },
            transaction,
          );
          for (const one of [a, b, c]) {
            if (one === groupId) {
              await members.groupMember(
                {
                  branch: t.north,
                  groupId: one,
                  subjectId: subject,
                  studentId,
                  from: '2026-09-01',
                },
                transaction,
              );
            }
          }
        });
      };
      await place(a);
      await place(b);
      // In group c, which has no row in the version.
      await place(c);
      rowOf(await createRow(version.id, { groupId: a, teacherId: await teacher() }));
      const row = rowOf(await createRow(version.id, { groupId: b, teacherId: await teacher() }));
      expect(row).toMatchObject({ unplaced: 2, problems: ['load_group_gaps'] });
      expect((await loadOf(version.id)).rows.map((one) => one.unplaced)).toEqual([2, 2]);
    });
  });

  describe('the copy of a version (decision 10)', () => {
    it('leaves every part of a broken block and the group rows beside a class row, by a rule of no order', async () => {
      const source = await draft();
      const oxford = await schoolClass();
      const princeton = await schoolClass();
      const a = await group([oxford]);
      const c = await group([princeton]);
      const rowA = rowOf(await createRow(source.id, { groupId: a, teacherId: await teacher() }));
      const rowC = rowOf(
        await createRow(source.id, { groupId: c, teacherId: await teacher(), lessonsPerWeek: 2 }),
      );
      const cambridge = await schoolClass();
      const yale = await schoolClass();
      const classRow = rowOf(
        await createRow(source.id, { classId: cambridge, teacherId: await teacher() }),
      );
      const g = await group([yale]);
      const groupRow = rowOf(
        await createRow(source.id, { groupId: g, teacherId: await teacher() }),
      );
      for (const [groupId, classId] of [
        [a, princeton],
        [g, cambridge],
      ] as const) {
        await t.database.migrator
          .insertInto('group_classes')
          .values({ group_id: groupId, class_id: classId, branch_id: t.north })
          .execute();
      }
      const copy = await draft({ copyFrom: source.id });
      const copied = await loadOf(copy.id);
      expect(Object.fromEntries(copied.leftRows.map((row) => [row.id, row.problems]))).toEqual({
        [rowA.id]: ['load_block_lessons'],
        [rowC.id]: ['load_block_lessons'],
        [groupRow.id]: ['load_split_and_whole'],
      });
      expect(copied.rows.map((row) => row.unit.id)).toContain(classRow.unit.id);
    });
  });

  describe('the weekly totals (decisions 5 to 8)', () => {
    const totalsOf = async (versionId: string, cookie = t.vicePrincipal) =>
      loadTotalsSchema.parse(
        (await get(`/api/timetable/versions/${versionId}/totals`, cookie).expect(200)).body,
      );

    it('compares classes with the lesson slots of their week and teachers with their free slots and contract', async () => {
      const version = await draft();
      const oxford = await schoolClass(7);
      const junior = await schoolClass(4);
      const busy = await teacher();
      const unset = await teacher();
      await t.database.migrator
        .updateTable('staff')
        .set({ weekly_lessons: 20 })
        .where('id', '=', busy)
        .execute();
      // Hours on Monday 08:50-09:45 only: lesson 2 of either template (08:55-09:40,
      // 08:50-09:30) fits, and they overlap in clock time, so one free slot.
      const entry = await t.database.migrator
        .insertInto('staff_availability')
        .values({ branch_id: t.north, staff_id: busy, valid_from: '2026-09-01' })
        .returning(['id', 'valid_until'])
        .executeTakeFirstOrThrow();
      await t.database.migrator
        .insertInto('staff_availability_ranges')
        .values({
          entry_id: entry.id,
          branch_id: t.north,
          staff_id: busy,
          weekday: 1,
          start_minutes: 8 * 60 + 50,
          end_minutes: 9 * 60 + 45,
          valid_from: '2026-09-01',
          valid_until: entry.valid_until,
        })
        .execute();
      rowOf(await createRow(version.id, { classId: oxford, teacherId: busy, lessonsPerWeek: 5 }));
      rowOf(await createRow(version.id, { classId: junior, teacherId: busy, lessonsPerWeek: 2 }));
      const other = await load.classes.subject({ grades: [7] });
      await load.profile(unset, [{ subject: other, grades: [7] }]);
      rowOf(
        await createRow(version.id, {
          classId: oxford,
          subjectId: other,
          teacherId: unset,
          lessonsPerWeek: 4,
        }),
      );
      const weekdays = (
        await t.database.migrator
          .selectFrom('branches')
          .select('working_weekdays')
          .where('id', '=', t.north)
          .executeTakeFirstOrThrow()
      ).working_weekdays.length;
      const totals = await totalsOf(version.id);
      expect(
        totals.classes.map(({ id, lessons, lessonSlots }) => ({ id, lessons, lessonSlots })),
      ).toEqual([
        { id: junior, lessons: 2, lessonSlots: 3 * weekdays },
        { id: oxford, lessons: 9, lessonSlots: 3 * weekdays },
      ]);
      const byId = new Map(totals.teachers.map((one) => [one.id, one]));
      expect(byId.get(busy)).toMatchObject({
        lessons: 7,
        freeSlots: 1,
        contract: 20,
        elsewhere: [],
      });
      expect(byId.get(unset)).toMatchObject({ lessons: 4, freeSlots: null, contract: null });
    });

    it("adds the lessons of another branch's running version, marked draft (correction 1)", async () => {
      const version = await draft();
      const shared = await teacher();
      await t.database.migrator
        .insertInto('staff_branches')
        .values({ staff_id: shared, branch_id: t.south, is_main: false })
        .execute();
      rowOf(await createRow(version.id, { classId: await schoolClass(), teacherId: shared }));
      // The South's only draft starts after the day and still counts.
      const southVersion = await load.version(t.south, southYear, { startsOn: '2026-11-02' });
      await load.row({
        branch_id: t.south,
        version_id: southVersion,
        class_id: await load.classes.schoolClass(t.south, southYear, { grade: 7, language: 'uz' }),
        subject_id: subject,
        teacher_id: shared,
        lessons_per_week: 4,
      });
      const found = (await totalsOf(version.id)).teachers.find((one) => one.id === shared);
      const southName = (
        await t.database.migrator
          .selectFrom('branches')
          .select('name')
          .where('id', '=', t.south)
          .executeTakeFirstOrThrow()
      ).name;
      // The name is read although the transaction holds the North only (permission review, S2).
      expect(southName).not.toBe('');
      expect(found?.elsewhere).toEqual([
        { branchId: t.south, branchName: southName, lessons: 4, draft: true },
      ]);
      expect((await totalsOf(version.id, t.principal)).teachers).toHaveLength(1);
    });

    // Spec review of the build, should-fix 5: a draft whose start date has
    // passed is read on today, as the students not placed are.
    it('reads the hours and templates on today once the start date has passed', async () => {
      const version = await load.version(t.north, year, { startsOn: '2026-10-05' });
      const late = await teacher();
      // Hours from Thursday 8 October: none on Monday 5 to Wednesday 7 October.
      const entry = await t.database.migrator
        .insertInto('staff_availability')
        .values({ branch_id: t.north, staff_id: late, valid_from: '2026-10-08' })
        .returning(['id', 'valid_until'])
        .executeTakeFirstOrThrow();
      const weekdays = (
        await t.database.migrator
          .selectFrom('branches')
          .select('working_weekdays')
          .where('id', '=', t.north)
          .executeTakeFirstOrThrow()
      ).working_weekdays;
      for (const weekday of weekdays) {
        await t.database.migrator
          .insertInto('staff_availability_ranges')
          .values({
            entry_id: entry.id,
            branch_id: t.north,
            staff_id: late,
            weekday,
            start_minutes: 0,
            end_minutes: 1440,
            valid_from: '2026-10-08',
            valid_until: entry.valid_until,
          })
          .execute();
      }
      await load.row({
        branch_id: t.north,
        version_id: version,
        class_id: await schoolClass(),
        subject_id: subject,
        teacher_id: late,
        lessons_per_week: 2,
      });
      const found = (await totalsOf(version)).teachers.find((one) => one.id === late);
      // Every working weekday from Saturday 10 October on: three lesson slots each.
      expect(found?.freeSlots).toBe(3 * weekdays.length);
    });

    it("answers 404 for another branch's version and an unknown one, also to the Super Admin, and nothing to a Teacher", async () => {
      const southern = await load.version(t.south, southYear);
      for (const cookie of [t.vicePrincipal, t.admin]) {
        for (const id of [southern, UNKNOWN]) {
          refusedWith(await get(`/api/timetable/versions/${id}/totals`, cookie), 404, 'not_found');
        }
      }
      const version = await draft();
      refusedWith(
        await get(`/api/timetable/versions/${version.id}/totals`, t.teacher),
        403,
        'permission_denied',
      );
    });
  });

  describe('the teacher of a group (decision 9)', () => {
    it("is the published row for every reader, a draft's row for a reader of the timetable only", async () => {
      const browser = await t.kit.completeSession('Lola', 'Nazarova');
      await t.kit.giveRole(browser.account.id, { role: 'head_tutor', branchId: t.north });
      const headTutor = browser.cookie;
      const oxford = await schoolClass();
      const g = await group([oxford]);
      const detail = async (cookie: string) =>
        groupDetailSchema.parse((await get(`/api/groups/${g}`, cookie).expect(200)).body).teacher;
      expect(await detail(t.vicePrincipal)).toBeNull();
      // Two drafts: the one with the latest start on or before today is read.
      const early = await load.version(t.north, year, { startsOn: '2026-10-05' });
      const later = await load.version(t.north, year, { startsOn: '2026-10-19' });
      const earlyTeacher = await teacher();
      const laterTeacher = await teacher();
      await load.row({
        branch_id: t.north,
        version_id: early,
        group_id: g,
        subject_id: subject,
        teacher_id: earlyTeacher,
      });
      await load.row({
        branch_id: t.north,
        version_id: later,
        group_id: g,
        subject_id: subject,
        teacher_id: laterTeacher,
      });
      expect(await detail(t.vicePrincipal)).toMatchObject({
        id: earlyTeacher,
        kind: 'person',
        draft: true,
      });
      expect(await detail(t.principal)).toMatchObject({ id: earlyTeacher, draft: true });
      expect(await detail(headTutor)).toBeNull();
      // Published: every reader sees it, not as a draft.
      await load.setVersion(early, 'published');
      for (const cookie of [t.vicePrincipal, headTutor]) {
        expect(await detail(cookie)).toMatchObject({ id: earlyTeacher, draft: false });
      }
    });

    // Permission review, S3: the list carries the same teacher; the Super Admin
    // reads the draft; a reader of the timetable in another branch only does not.
    it('is the same on the list, read by the Super Admin, and decided in the branch of the request', async () => {
      const browser = await t.kit.completeSession('Kamola', 'Yusupova');
      await t.kit.giveRole(browser.account.id, { role: 'head_tutor', branchId: t.north });
      await t.kit.giveRole(browser.account.id, {
        role: 'academic_vice_principal',
        branchId: t.south,
      });
      const twoBranches = browser.cookie;
      // A planned year of its own: the test before published a version of the current year.
      const planned = await load.classes.year(t.north, 'planned', '2027-09-01', '2028-05-31');
      const plannedClass = await load.classes.schoolClass(t.north, planned, {
        grade: 7,
        language: 'uz',
      });
      const g = await load.classes.group(t.north, planned, subject, [plannedClass]);
      const own = await teacher();
      const draftVersion = await load.version(t.north, planned, { startsOn: '2027-09-01' });
      await load.row({
        branch_id: t.north,
        version_id: draftVersion,
        group_id: g,
        subject_id: subject,
        teacher_id: own,
      });
      const listed = async (cookie: string) =>
        groupListSchema
          .parse((await get('/api/groups', cookie).expect(200)).body)
          .groups.find((one) => one.id === g)?.teacher;
      expect(await listed(t.vicePrincipal)).toMatchObject({ id: own, draft: true });
      expect(await listed(t.admin)).toMatchObject({ id: own, draft: true });
      expect(await listed(twoBranches)).toBeNull();
      expect(
        groupDetailSchema.parse((await get(`/api/groups/${g}`, twoBranches).expect(200)).body)
          .teacher,
      ).toBeNull();
      await load.setVersion(draftVersion, 'published');
      expect(await listed(twoBranches)).toMatchObject({ id: own, draft: false });
    });
  });

  describe('the teacher of a group: which draft, and the Tutor (spec review of the build, should-fix 7)', () => {
    it('reads the earliest later draft, then the highest number of one start', async () => {
      const classId = await load.classes.schoolClass(t.south, southYear, {
        grade: 7,
        language: 'uz',
      });
      const g = await load.classes.group(t.south, southYear, subject, [classId]);
      const teacherOf = async () =>
        (await load.teacher(t.south, { subjects: [{ subject, grades: [7] }] })).staffId;
      const rowIn = async (startsOn: string) => {
        const version = await load.version(t.south, southYear, { startsOn });
        const teacherId = await teacherOf();
        await load.row({
          branch_id: t.south,
          version_id: version,
          group_id: g,
          subject_id: subject,
          teacher_id: teacherId,
        });
        return teacherId;
      };
      const detail = async () =>
        groupDetailSchema.parse((await get(`/api/groups/${g}`, t.admin, t.south).expect(200)).body)
          .teacher;
      const sooner = await rowIn('2026-10-19');
      await rowIn('2026-10-26');
      expect(await detail()).toMatchObject({ id: sooner, draft: true });
      await rowIn('2026-10-12');
      const higher = await rowIn('2026-10-12');
      expect(await detail()).toMatchObject({ id: higher, draft: true });
    });

    it("gives a Tutor the published teacher of a group of own class, never a draft's", async () => {
      const browser = await t.kit.completeSession('Malika', 'Qodirova');
      const tutorClass = await schoolClass();
      await load.classes.person(t.north, ['uz'], { accountId: browser.account.id });
      await load.tutorOf(t.north, tutorClass, browser.account.id, {
        from: new Date('2026-09-01T00:00:00+05:00'),
      });
      const g = await group([tutorClass]);
      const detail = async (cookie: string) =>
        groupDetailSchema.parse((await get(`/api/groups/${g}`, cookie).expect(200)).body).teacher;
      // A published version of the current year is in force from an earlier test.
      const draftOnly = await load.version(t.north, year, { startsOn: '2026-10-19' });
      await load.row({
        branch_id: t.north,
        version_id: draftOnly,
        group_id: g,
        subject_id: subject,
        teacher_id: await teacher(),
      });
      expect(await detail(browser.cookie)).toBeNull();
      const published = await load.version(t.north, year, { startsOn: '2026-10-07' });
      const shown = await teacher();
      await load.row({
        branch_id: t.north,
        version_id: published,
        group_id: g,
        subject_id: subject,
        teacher_id: shown,
      });
      await load.setVersion(published, 'published');
      expect(await detail(browser.cookie)).toMatchObject({ id: shown, draft: false });
      expect(await detail(t.vicePrincipal)).toMatchObject({ id: shown, draft: false });
    });
  });

  describe('a route and another write at the same moment', () => {
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
    async function holdOpen(work: (transaction: Transaction) => Promise<void>) {
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
        .run([t.north], async (transaction) => {
          await work(transaction);
          ready();
          await released;
        })
        .catch((error: unknown) => error);
      await Promise.race([isReady, done]);
      return { release, done };
    }

    /** What a route write does first: the year FOR SHARE, the version FOR UPDATE. */
    const lockVersion = async (transaction: Transaction, versionId: string) => {
      await transaction
        .selectFrom('academic_years')
        .select('id')
        .where('id', '=', year)
        .forShare()
        .execute();
      await transaction
        .selectFrom('timetable_versions')
        .select('id')
        .where('id', '=', versionId)
        .forUpdate()
        .execute();
    };

    it('makes a create wait for a part being written, then refuses unequal lessons', async () => {
      const version = await draft();
      const oxford = await schoolClass();
      const [a, b] = [await group([oxford]), await group([oxford])];
      const first = await teacher();
      const held = await holdOpen(async (transaction) => {
        await lockVersion(transaction, version.id);
        await transaction
          .insertInto('teaching_load_rows')
          .values({
            branch_id: t.north,
            version_id: version.id,
            group_id: a,
            subject_id: subject,
            teacher_id: first,
            lessons_per_week: 3,
          })
          .execute();
      });
      const creating = createRow(version.id, {
        groupId: b,
        teacherId: await teacher(),
        lessonsPerWeek: 2,
      }).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await creating, 409, 'load_block_lessons');
    });

    it('makes a create of a class row wait for a group row of its class, then refuses it', async () => {
      const version = await draft();
      const oxford = await schoolClass();
      const g = await group([oxford]);
      const first = await teacher();
      const held = await holdOpen(async (transaction) => {
        await lockVersion(transaction, version.id);
        await transaction
          .insertInto('teaching_load_rows')
          .values({
            branch_id: t.north,
            version_id: version.id,
            group_id: g,
            subject_id: subject,
            teacher_id: first,
            lessons_per_week: 3,
          })
          .execute();
      });
      const creating = createRow(version.id, { classId: oxford, teacherId: await teacher() }).then(
        (response) => response,
      );
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await creating, 409, 'load_split_and_whole');
    });

    it('makes a create of a group row wait for a class row of its class, then refuses it', async () => {
      const version = await draft();
      const oxford = await schoolClass();
      const g = await group([oxford]);
      const first = await teacher();
      const held = await holdOpen(async (transaction) => {
        await lockVersion(transaction, version.id);
        await transaction
          .insertInto('teaching_load_rows')
          .values({
            branch_id: t.north,
            version_id: version.id,
            class_id: oxford,
            subject_id: subject,
            teacher_id: first,
            lessons_per_week: 3,
          })
          .execute();
      });
      const creating = createRow(version.id, { groupId: g, teacherId: await teacher() }).then(
        (response) => response,
      );
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await creating, 409, 'load_split_and_whole');
    });

    it('makes a lessons edit wait for a part being written, then writes the lessons to it too', async () => {
      const version = await draft();
      const oxford = await schoolClass();
      const [a, b, c] = [await group([oxford]), await group([oxford]), await group([oxford])];
      const first = rowOf(await createRow(version.id, { groupId: a, teacherId: await teacher() }));
      rowOf(await createRow(version.id, { groupId: b, teacherId: await teacher() }));
      const third = await teacher();
      const held = await holdOpen(async (transaction) => {
        await lockVersion(transaction, version.id);
        await transaction
          .insertInto('teaching_load_rows')
          .values({
            branch_id: t.north,
            version_id: version.id,
            group_id: c,
            subject_id: subject,
            teacher_id: third,
            lessons_per_week: 3,
          })
          .execute();
      });
      const editing = editRow(version.id, first, { lessonsPerWeek: 5 }).then(
        (response) => response,
      );
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      expect(await held.done).toBeUndefined();
      rowOf(await editing);
      expect((await loadOf(version.id)).rows.map((row) => row.lessonsPerWeek)).toEqual([5, 5, 5]);
    });

    it('makes a create of a part wait for a lessons edit of its block, then refuses unequal lessons', async () => {
      const version = await draft();
      const oxford = await schoolClass();
      const [a, b, c] = [await group([oxford]), await group([oxford]), await group([oxford])];
      const rows = [
        rowOf(await createRow(version.id, { groupId: a, teacherId: await teacher() })),
        rowOf(await createRow(version.id, { groupId: b, teacherId: await teacher() })),
      ];
      const held = await holdOpen(async (transaction) => {
        await lockVersion(transaction, version.id);
        for (const one of rows) {
          await transaction
            .updateTable('teaching_load_rows')
            .set({ lessons_per_week: 4 })
            .where('id', '=', one.id)
            .execute();
        }
      });
      const creating = createRow(version.id, {
        groupId: c,
        teacherId: await teacher(),
        lessonsPerWeek: 3,
      }).then((response) => response);
      await expect.poll(waitingForALock, { timeout: 20_000, interval: 50 }).toBe(1);
      held.release();
      expect(await held.done).toBeUndefined();
      refusedWith(await creating, 409, 'load_block_lessons');
    });
  });
});
