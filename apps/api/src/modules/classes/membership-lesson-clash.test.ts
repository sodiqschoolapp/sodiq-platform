import { studentDetailSchema, type StudentDetail } from '@sodiq/shared';
import { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClassesKit } from '../../testing/classes-kit.js';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import { relativesInput } from '../../testing/relatives-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

/** Tuesday 20 October 2026, a school day of quarter 1 after the kit's today. */
const LESSON_DAY = '2026-10-20';
/** Monday 12 October 2026, the first school day after the kit's today. */
const MONDAY = '2026-10-12';

const refusedWith = (response: Response, status: number, code: string) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(errorCode(response)).toBe(code);
};

const ok = (response: Response) => {
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return response;
};

// Every route that writes a class or group row of a student answers 409
// `membership_lesson_clash` when the row would put the student into two
// lessons of one published block (task 5.12a, pull request #201, decision 7;
// 06, Rules: "No student can be in two lessons at once; this covers a class
// lesson against a group lesson, and two groups that share a student"). The
// database refuses it (0060, `class_memberships_block_students` and
// `group_memberships_block_students`); the routes name it. The block holds a
// class lesson of 7 Oxford and a lesson of an art group drawn from 7 Oxford
// and 7 Cambridge, on Tuesday 20 October. The clock stands at 23:55 on
// Saturday 10 October 2026 in Tashkent. All names are invented.
//
// The routes that cannot reach the refusal, and why: a withdraw of a class or
// group row, a class archive, a return cancel and a leaving only end rows
// (`class_memberships_only_shrink`, `group_memberships_only_shrink`); a student
// edit and a class or group restore write no membership row; a branch move's
// release, cancel and decline write none (the accept does, tested below); a
// merge moves the merged record's rows onto the kept one, and both records
// cannot hold a class row on one date (`student_merge_overlap` first), while a
// group row needs a class row of the same student on its dates
// (`group_memberships_in_class`), so a merge never joins a class row of one
// record to a group row of the other on one date; its map carries the entry
// all the same (review correction 3).
describe('a membership that puts a student into two lessons of one block', () => {
  let t: DayTemplatesKit;
  let classes: ClassesKit;
  let kit: LessonsKit;
  let year: string;
  let southYear: string;
  let quarter: string;
  let count = 0;

  const get = (path: string, branch = t.north) => t.get(path, branch, t.admin);
  const post = (path: string, body: object = {}, branch = t.north, cookie = t.vicePrincipal) =>
    t.post(path, branch, body, cookie);

  const fresh = async (id: string, branch = t.north): Promise<StudentDetail> =>
    studentDetailSchema.parse((await get(`/api/people/students/${id}`, branch)).body);

  function studentBody(classId: string | null, startsOn = '2026-09-02'): Record<string, unknown> {
    count += 1;
    return {
      uid: String(2612500 + count),
      confirmUidSet: true,
      firstName: 'Nodira',
      lastName: `Saidova${'c'.repeat(count % 9)}${String.fromCharCode(97 + (count % 26))}`,
      paternalName: null,
      sex: 'female',
      birthDate: `2013-05-${String((count % 28) + 1).padStart(2, '0')}`,
      grade: 7,
      startsOn,
      documentType: null,
      documentNumber: null,
      jshshir: null,
      phone: null,
      email: null,
      address: null,
      region: null,
      previousSchool: null,
      diagnosticScore: null,
      scholarship: { type: 'none', coverage: null, amount: null },
      consentSignedOn: null,
      contract: { number: `LC-2026/${String(count)}`, signedOn: '2026-08-20' },
      relatives: relativesInput(),
      classId,
    };
  }

  /** A new student of grade 7 from 2 September, in the class named or in none. */
  async function pupil(
    classId: string | null,
    branch = t.north,
    startsOn?: string,
  ): Promise<StudentDetail> {
    const response = await post(
      '/api/people/students',
      studentBody(classId, startsOn),
      branch,
      t.admin,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return studentDetailSchema.parse(response.body);
  }

  /** Two classes and an art subject; no group yet, so their pupils are not placed. */
  async function classesOf() {
    const oxford = await classes.schoolClass(t.north, year, { grade: 7 });
    const cambridge = await classes.schoolClass(t.north, year, { grade: 7 });
    const art = await classes.subject({ grades: [7] });
    return { oxford, cambridge, art };
  }

  const group = (art: string, classIds: readonly string[]) =>
    classes.group(t.north, year, art, classIds, { size: 20 });

  /** The block on Tuesday: a class lesson of the class and a lesson of the group. */
  async function block(classId: string, groupId: string, art: string): Promise<void> {
    const subject = await classes.subject({ grades: [7] });
    const source = await kit.source(t.north, year, [
      { classId, groupId: null, subjectId: subject },
      { classId: null, groupId, subjectId: art },
    ]);
    const written = await t.database.migrator
      .insertInto('lesson_blocks')
      .values({
        branch_id: t.north,
        academic_year_id: year,
        quarter_id: quarter,
        lesson_date: LESSON_DAY,
        starts_at: at(LESSON_DAY, '09:00'),
        ends_at: at(LESSON_DAY, '09:45'),
        version_id: source.versionId,
        pattern_block_id: source.patternBlockId,
      })
      .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
      .executeTakeFirstOrThrow();
    const units = [
      { class_id: classId, group_id: null, subject_id: subject },
      { class_id: null, group_id: groupId, subject_id: art },
    ];
    for (const [index, unit] of units.entries()) {
      const from = source.lessons[index];
      if (from === undefined) throw new Error('No source for the lesson.');
      await t.database.migrator
        .insertInto('lessons')
        .values({
          branch_id: t.north,
          block_id: written.id,
          lesson_date: written.lesson_date,
          starts_at: written.starts_at,
          ends_at: written.ends_at,
          ...unit,
          load_row_id: from.loadRowId,
          pattern_entry_id: from.patternEntryId,
        })
        .execute();
    }
  }

  /** Every membership row, move and status of the school, and the audit log. */
  const rowsOf = () =>
    Promise.all([
      t.database.migrator.selectFrom('class_memberships').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('group_memberships').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_moves').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('student_statuses').selectAll().orderBy('id').execute(),
      t.database.migrator.selectFrom('audit_log').select('id').orderBy('id').execute(),
    ]);

  /** The route's answer is the clash, and nothing changed. */
  async function refusesTheClash(route: () => Promise<Response>): Promise<void> {
    const before = await rowsOf();
    refusedWith(await route(), 409, 'membership_lesson_clash');
    expect(await rowsOf()).toEqual(before);
  }

  /** The id of the student's group row of the group. */
  const groupRowOf = async (studentId: string, groupId: string) =>
    (
      await t.database.migrator
        .selectFrom('group_memberships')
        .select('id')
        .where('student_id', '=', studentId)
        .where('group_id', '=', groupId)
        .orderBy('valid_from', 'desc')
        .executeTakeFirstOrThrow()
    ).id;

  /** The move that wrote the student's newest class or group row. */
  const moveOf = async (studentId: string) =>
    (
      await t.database.migrator
        .selectFrom('student_moves')
        .select('id')
        .where('student_id', '=', studentId)
        .orderBy('id', 'desc')
        .executeTakeFirstOrThrow()
    ).id;

  const classTransfer = async (studentId: string, toClassId: string, from: string) =>
    ok(
      await post('/api/classes/transfers', {
        studentId,
        version: (await fresh(studentId)).version,
        toClassId,
        from,
      }),
    );

  const groupTransfer = async (
    studentId: string,
    fromGroupId: string,
    toGroupId: string,
    from: string,
  ) =>
    ok(
      await post('/api/groups/transfers', {
        studentId,
        memberId: await groupRowOf(studentId, fromGroupId),
        toGroupId,
        from,
      }),
    );

  const placeInGroup = (groupId: string, studentId: string, from = MONDAY) =>
    post(`/api/groups/${groupId}/members`, { students: [{ id: studentId }], from });

  beforeAll(async () => {
    t = await dayTemplatesKit();
    kit = await LessonsKit.create(t.database.migrator);
    classes = kit.load.classes;
    const dated = await kit.year(t.north);
    year = dated.year;
    quarter = dated.quarters[0] ?? '';
    southYear = await classes.year(t.south);
  });

  afterAll(async () => {
    await t.close();
  });

  it('refuses a group placement: the student is in the class lesson and joins the group', async () => {
    const { oxford, cambridge, art } = await classesOf();
    const student = await pupil(oxford);
    const team = await group(art, [oxford, cambridge]);
    await block(oxford, team, art);
    await refusesTheClash(() => placeInGroup(team, student.id));
    // A split of one subject is refused earlier, by the rule of one group per subject.
    const other = await group(art, [oxford]);
    ok(await placeInGroup(other, student.id));
    refusedWith(await placeInGroup(team, student.id), 409, 'student_has_group');
  });

  it('refuses an automatic placement into the block’s group', async () => {
    const { oxford, cambridge, art } = await classesOf();
    await pupil(oxford);
    const team = await group(art, [oxford, cambridge]);
    await block(oxford, team, art);
    await refusesTheClash(() =>
      post('/api/groups/placement/automatic', { subjectId: art, grades: [7], from: MONDAY }),
    );
  });

  it('refuses a class placement whose groups follow the student into the block’s group', async () => {
    const { oxford, cambridge, art } = await classesOf();
    const team = await group(art, [oxford, cambridge]);
    await block(oxford, team, art);
    // A student with no class starts after today (`student_needs_class`).
    const student = await pupil(null, t.north, MONDAY);
    await refusesTheClash(() =>
      post(`/api/classes/${oxford}/members`, {
        students: [{ id: student.id, version: student.version }],
        from: MONDAY,
      }),
    );
  });

  it('refuses a new student created into the class', async () => {
    const { oxford, cambridge, art } = await classesOf();
    const team = await group(art, [oxford, cambridge]);
    await block(oxford, team, art);
    await refusesTheClash(() =>
      post('/api/people/students', studentBody(oxford), t.north, t.admin),
    );
  });

  describe('class transfers', () => {
    it('refuses a transfer into the class while the student keeps the group', async () => {
      const { oxford, cambridge, art } = await classesOf();
      const student = await pupil(cambridge);
      const team = await group(art, [oxford, cambridge]);
      ok(await placeInGroup(team, student.id));
      await block(oxford, team, art);
      await refusesTheClash(async () =>
        post('/api/classes/transfers', {
          studentId: student.id,
          version: (await fresh(student.id)).version,
          toClassId: oxford,
          from: MONDAY,
        }),
      );
    });

    it('refuses the change of a scheduled transfer into the class', async () => {
      const { oxford, cambridge, art } = await classesOf();
      const princeton = await classes.schoolClass(t.north, year, { grade: 7 });
      const student = await pupil(cambridge);
      const team = await group(art, [oxford, cambridge]);
      ok(await placeInGroup(team, student.id));
      await classTransfer(student.id, princeton, '2026-10-27');
      await block(oxford, team, art);
      const move = await moveOf(student.id);
      await refusesTheClash(async () =>
        post(`/api/classes/transfers/${move}/change`, {
          version: (await fresh(student.id)).version,
          toClassId: oxford,
          from: MONDAY,
        }),
      );
    });

    it('refuses the cancel of a scheduled transfer out of the class that gave the student the group', async () => {
      const { oxford, cambridge, art } = await classesOf();
      const student = await pupil(oxford);
      const team = await group(art, [oxford, cambridge]);
      // Placed while in 7 Oxford, before the block: its group row stays when the transfer is cancelled.
      ok(await placeInGroup(team, student.id));
      await classTransfer(student.id, cambridge, '2026-10-13');
      const move = await moveOf(student.id);
      // Until the 13th the student is in 7 Oxford and the art group; the block is on the 20th.
      await block(oxford, team, art);
      await refusesTheClash(async () =>
        post(`/api/classes/transfers/${move}/cancel`, {
          version: (await fresh(student.id)).version,
        }),
      );
    });

    it('refuses the undo of a transfer out of the class', async () => {
      const { oxford, cambridge, art } = await classesOf();
      const student = await pupil(oxford);
      const team = await group(art, [oxford, cambridge]);
      ok(await placeInGroup(team, student.id, '2026-10-05'));
      await classTransfer(student.id, cambridge, '2026-10-06');
      const move = await moveOf(student.id);
      await block(oxford, team, art);
      await refusesTheClash(async () =>
        post(`/api/classes/transfers/${move}/undo`, {
          version: (await fresh(student.id)).version,
          reason: 'Moved by mistake.',
        }),
      );
    });
  });

  describe('group transfers', () => {
    it('refuses a transfer into the block’s group', async () => {
      const { oxford, cambridge, art } = await classesOf();
      const student = await pupil(oxford);
      const own = await group(art, [oxford]);
      const team = await group(art, [oxford, cambridge]);
      ok(await placeInGroup(own, student.id));
      await block(oxford, team, art);
      await refusesTheClash(async () =>
        post('/api/groups/transfers', {
          studentId: student.id,
          memberId: await groupRowOf(student.id, own),
          toGroupId: team,
          from: '2026-10-13',
        }),
      );
    });

    it('refuses the change of a scheduled transfer out of the block’s group to a date after the block', async () => {
      const { oxford, cambridge, art } = await classesOf();
      const student = await pupil(oxford);
      const own = await group(art, [oxford]);
      const team = await group(art, [oxford, cambridge]);
      ok(await placeInGroup(team, student.id));
      await groupTransfer(student.id, team, own, '2026-10-13');
      const move = await moveOf(student.id);
      await block(oxford, team, art);
      await refusesTheClash(() =>
        post(`/api/groups/transfers/${move}/change`, { toGroupId: own, from: '2026-10-27' }),
      );
    });

    it('refuses the cancel of a scheduled transfer out of the block’s group', async () => {
      const { oxford, cambridge, art } = await classesOf();
      const student = await pupil(oxford);
      const own = await group(art, [oxford]);
      const team = await group(art, [oxford, cambridge]);
      ok(await placeInGroup(team, student.id));
      await groupTransfer(student.id, team, own, '2026-10-13');
      const move = await moveOf(student.id);
      await block(oxford, team, art);
      await refusesTheClash(() => post(`/api/groups/transfers/${move}/cancel`, {}));
    });

    it('refuses the undo of a transfer out of the block’s group', async () => {
      const { oxford, cambridge, art } = await classesOf();
      const student = await pupil(oxford);
      const own = await group(art, [oxford]);
      const team = await group(art, [oxford, cambridge]);
      ok(await placeInGroup(team, student.id, '2026-10-05'));
      await groupTransfer(student.id, team, own, '2026-10-06');
      const move = await moveOf(student.id);
      await block(oxford, team, art);
      await refusesTheClash(() =>
        post(`/api/groups/transfers/${move}/undo`, { reason: 'Moved by mistake.' }),
      );
    });
  });

  describe('leavings, returns and branch moves', () => {
    /** A pupil of 7 Oxford in the block's group who leaves on `lastDay`, before the block. */
    async function leaving(lastDay: string) {
      const { oxford, cambridge, art } = await classesOf();
      const student = await pupil(oxford);
      const team = await group(art, [oxford, cambridge]);
      ok(await placeInGroup(team, student.id, '2026-10-01'));
      ok(
        await post(`/api/people/students/${student.id}/leaving`, {
          lastDay,
          reason: 'The family moved.',
          version: (await fresh(student.id)).version,
        }),
      );
      await block(oxford, team, art);
      return { student, oxford };
    }

    it('refuses the cancel of a scheduled leaving that gives the rows back', async () => {
      const { student } = await leaving('2026-10-11');
      await refusesTheClash(async () =>
        post(`/api/people/students/${student.id}/leaving/cancel`, {
          version: (await fresh(student.id)).version,
        }),
      );
    });

    it('refuses the undo of a leaving that gives the rows back', async () => {
      const { student } = await leaving('2026-10-07');
      await refusesTheClash(async () =>
        post(`/api/people/students/${student.id}/leaving/undo`, {
          version: (await fresh(student.id)).version,
          reason: 'Left by mistake.',
        }),
      );
    });

    it('refuses a return into the class whose groups follow the student', async () => {
      const { student, oxford } = await leaving('2026-10-05');
      await refusesTheClash(async () => {
        count += 1;
        return post(
          `/api/people/students/${student.id}/return`,
          {
            from: '2026-10-08',
            grade: 7,
            classId: oxford,
            contract: { number: `LC-BACK/${String(count)}`, signedOn: '2026-10-08' },
            reason: null,
            version: (await fresh(student.id)).version,
          },
          t.north,
          t.admin,
        );
      });
    });

    it('refuses the accept of a branch move into the class and the block’s group', async () => {
      const { oxford, cambridge, art } = await classesOf();
      const team = await group(art, [oxford, cambridge]);
      await block(oxford, team, art);
      const southern = await classes.schoolClass(t.south, southYear, { grade: 7 });
      const student = await pupil(southern, t.south);
      const released = await post(
        `/api/people/students/${student.id}/branch-move`,
        {
          toBranchId: t.north,
          // Accepted once its date has come (`branch_move_not_yet`): today.
          from: '2026-10-10',
          version: (await fresh(student.id, t.south)).version,
        },
        t.south,
        t.admin,
      );
      expect(released.status, JSON.stringify(released.body)).toBe(200);
      const moveId = studentDetailSchema.parse(released.body).branchMove?.id ?? '';
      await refusesTheClash(() =>
        post(`/api/people/branch-moves/${moveId}/accept`, {
          classId: oxford,
          groups: [{ subjectId: art, groupId: team }],
        }),
      );
    });
  });
});
