import { randomUUID } from 'node:crypto';
import { BRANCH_HEADER, publishCheckSchema, REQUEST_KEY_HEADER } from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { markedLesson, workWithTotal } from '../../testing/cells-kit.js';
import { substitutedIn } from '../../testing/substitutions-kit.js';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { publishedScene, publishOf, type PublishedScene } from '../../testing/published-scene.js';

const ok = (response: Response) => {
  expect(response.status, JSON.stringify(response.body)).toBe(200);
};

// All names are invented. Task 5.8b, pull request #195: the protection of
// dated lessons through the writers of dated lessons (06, Protection: "A dated
// lesson that already has attendance or marks cannot be deleted and cannot
// change its class, group or subject. Its teacher, room and time can change,
// with a log entry." "Every change records who, when, the value before and the
// value after."). Every writer runs through `Transactions.run`, which refuses
// a change of a lesson with no audit entry of its transaction in the lesson's
// branch, so every route test of a writer (publish, withdraw, carry, vacancy
// fill, calendar, template and quarter changes, one-day changes,
// substitutions, absences, room closures, exams, bulk cancels, Tutor follows)
// also proves the line is tied to its entry; the tests below read the lines
// themselves.
describe('the protection of dated lessons through their writers', () => {
  let t: DayTemplatesKit;
  let load: LoadKit;
  let adminAccount: string;

  const keyed = (path: string, branch: string, body: object) =>
    request(t.kit.server)
      .post(path)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send(body);

  /** Class, group and subject of every lesson of the branch, by id. */
  const unitsOf = async (branch: string) =>
    new Map(
      (
        await t.database.migrator
          .selectFrom('lessons')
          .select(['id', 'class_id', 'group_id', 'subject_id'])
          .where('branch_id', '=', branch)
          .execute()
      ).map((one) => [one.id, `${one.class_id ?? ''}|${one.group_id ?? ''}|${one.subject_id}`]),
    );

  /** Every lesson that stays keeps its class, group and subject. */
  const keptUnits = (before: Map<string, string>, after: Map<string, string>) => {
    let kept = 0;
    for (const [id, unit] of after) {
      if (!before.has(id)) continue;
      expect(unit, id).toBe(before.get(id));
      kept += 1;
    }
    return kept;
  };

  /** The history lines of the lessons named, each with the actor of its transaction's entry. */
  const linesOf = async (lessonIds: readonly string[]) =>
    (
      await sql<{
        lesson_id: string;
        kind: string;
        teacher_before: string | null;
        teacher_after: string | null;
        room_before: string | null;
        room_after: string | null;
        starts_before: Date | null;
        starts_after: Date | null;
        cancel_before: string | null;
        cancel_after: string | null;
        actors: string[];
      }>`
        select h.lesson_id, h.kind, h.teacher_before, h.teacher_after, h.room_before,
          h.room_after, h.starts_before, h.starts_after, h.cancel_before, h.cancel_after,
          array(
            select distinct a.actor_id::text from audit_log a
            where a.branch_id = h.branch_id and a.written_xact = h.written_xact
          ) as actors
        from lesson_history h
        where h.lesson_id = any(${lessonIds}::uuid[])
        order by h.changed_at, h.id
      `.execute(t.database.migrator)
    ).rows;

  const lessonOf = async (s: PublishedScene, date: string, classId = s.classId) =>
    t.database.migrator
      .selectFrom('lessons')
      .selectAll()
      .where('branch_id', '=', s.branch)
      .where('class_id', '=', classId)
      .where('lesson_date', '=', date)
      .executeTakeFirstOrThrow();

  /** A draft copied from the scene's version, the first class's teacher changed, ready to publish from `startsOn`. */
  async function draftFrom(s: PublishedScene, startsOn: string) {
    const created = await t.post('/api/timetable/versions', s.branch, {
      academicYearId: s.year,
      startsOn,
      copyFrom: s.version,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const draft = (created.body as { id: string }).id;
    await t.database.migrator
      .updateTable('teaching_load_rows')
      .set({ teacher_id: s.spareTeacher.staffId })
      .where('version_id', '=', draft)
      .where('class_id', '=', s.classId)
      .execute();
    const confirmed = await t.post(`/api/timetable/versions/${draft}/templates/confirm`, s.branch);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    await load.freeEditLock(draft);
    return draft;
  }

  /** A draft copied from `copyFrom` without the first class's load row: its lessons from `startsOn` go. */
  async function draftWithout(s: PublishedScene, startsOn: string, copyFrom = s.version) {
    const created = await t.post('/api/timetable/versions', s.branch, {
      academicYearId: s.year,
      startsOn,
      copyFrom,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const draft = (created.body as { id: string }).id;
    const row = await t.database.migrator
      .selectFrom('teaching_load_rows')
      .select('id')
      .where('version_id', '=', draft)
      .where('class_id', '=', s.classId)
      .executeTakeFirstOrThrow();
    const archived = await request(t.kit.server)
      .delete(`/api/timetable/versions/${draft}/load/${row.id}`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, s.branch)
      .set(REQUEST_KEY_HEADER, randomUUID());
    expect(archived.status, JSON.stringify(archived.body)).toBeLessThan(300);
    const confirmed = await t.post(`/api/timetable/versions/${draft}/templates/confirm`, s.branch);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    await load.freeEditLock(draft);
    return draft;
  }

  /** The publish preview of a draft on a start. */
  const checkOf = async (s: PublishedScene, draft: string, startsOn: string) => {
    const answer = await t.get(
      `/api/timetable/versions/${draft}/publish-check?startsOn=${startsOn}`,
      s.branch,
    );
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const impact = publishCheckSchema.parse(answer.body).impact;
    if (impact === null) throw new Error('The check has no impact preview.');
    return impact;
  };

  /** A publish with the key of the stored one-day changes its preview gave. */
  const publishKeyed = (
    s: PublishedScene,
    draft: string,
    startsOn: string,
    dayChangesKey: string,
  ) =>
    request(t.kit.server)
      .post(`/api/timetable/versions/${draft}/publish`)
      .set('Cookie', t.admin)
      .set(BRANCH_HEADER, s.branch)
      .set(REQUEST_KEY_HEADER, randomUUID())
      .send({ startsOn, dayChangesKey });

  /** The newest audit entry of the action in the branch, its new value. */
  const entryOf = async (branch: string, action: string) =>
    (
      await t.database.migrator
        .selectFrom('audit_log')
        .select('new_value')
        .where('branch_id', '=', branch)
        .where('action', '=', action)
        .orderBy('occurred_at', 'desc')
        .orderBy('id', 'desc')
        .executeTakeFirstOrThrow()
    ).new_value as {
      datedLessons?: {
        keptWithData?: {
          id: string;
          cancelCause: string | null;
          reason: string | null;
          cause: string;
        }[];
        givenBack?: { id: string }[];
      };
    };

  /** The stored lesson by id, `undefined` when it is gone. */
  const lessonById = (id: string) =>
    t.database.migrator
      .selectFrom('lessons')
      .select(['id', 'block_id', 'cancel_cause', 'cancel_reason', 'teacher_id'])
      .where('id', '=', id)
      .executeTakeFirst();

  /** The cells of a lesson. */
  const cellsOf = (lessonId: string) =>
    t.database.migrator
      .selectFrom('journal_cells')
      .select(['student_id', 'mark'])
      .where('lesson_id', '=', lessonId)
      .execute();

  /** A mark on the lesson, saved through `saveCells` (task 6.1b-1). */
  const mark = (s: PublishedScene, lessonId: string, classId = s.classId) =>
    markedLesson(t.app, t.database.migrator, {
      branchId: s.branch,
      classId,
      lessonId,
      accountId: adminAccount,
    });

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    load = new LoadKit(t.database.migrator);
    adminAccount = (
      await t.database.migrator
        .selectFrom('assignments')
        .select('account_id')
        .where('id', '=', t.adminAssignment)
        .executeTakeFirstOrThrow()
    ).account_id;
  });

  afterAll(async () => {
    await t.close();
  });

  it('a publish that gives a class a new teacher keeps every lesson’s unit and subject and writes a line per lesson changed, by the Super Admin', async () => {
    const s = await publishedScene(t, load);
    const before = await unitsOf(s.branch);
    const draft = await draftFrom(s, '2026-11-09');
    ok(await publishOf(t)(s.branch, draft, '2026-11-09'));
    const after = await unitsOf(s.branch);
    expect(keptUnits(before, after)).toBeGreaterThan(0);
    const changed = await lessonOf(s, '2026-11-16');
    const unchanged = await lessonOf(s, '2026-10-26');
    expect(await linesOf([unchanged.id])).toEqual([]);
    const lines = await linesOf([changed.id]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: 'changed',
      teacher_before: s.teacher.staffId,
      teacher_after: s.spareTeacher.staffId,
      actors: [adminAccount],
    });
  });

  it('the one-day changes and the substitution each write their line, by the Super Admin', async () => {
    const s = await publishedScene(t, load);
    const before = await unitsOf(s.branch);
    const cancelled = await lessonOf(s, '2026-10-26');
    ok(await keyed(`/api/timetable/lessons/${cancelled.id}/cancel`, s.branch, { reason: 'Rain' }));
    ok(await keyed(`/api/timetable/lessons/${cancelled.id}/restore`, s.branch, {}));
    const moved = await lessonOf(s, '2026-11-09');
    ok(
      await keyed(`/api/timetable/lessons/${moved.id}/move`, s.branch, {
        date: '2026-11-09',
        lessonNumber: 3,
        reason: 'The hall is busy',
      }),
    );
    const roomed = await lessonOf(s, '2026-11-16');
    const spare = await load.classes.room(s.branch);
    ok(
      await keyed(`/api/timetable/lessons/${roomed.id}/room`, s.branch, {
        roomId: spare,
        reason: 'The room is painted',
      }),
    );
    const substituted = await lessonOf(s, '2026-11-23');
    ok(
      await keyed(`/api/timetable/lessons/${substituted.id}/substitute`, s.branch, {
        teacherId: s.spareTeacher.staffId,
        reason: 'Away at a seminar',
      }),
    );
    ok(
      await keyed(`/api/timetable/lessons/${substituted.id}/substitution/withdraw`, s.branch, {
        reason: 'Back early',
      }),
    );
    expect(keptUnits(before, await unitsOf(s.branch))).toBe(before.size);
    const cancelLines = await linesOf([cancelled.id]);
    expect(cancelLines.map((one) => [one.cancel_before, one.cancel_after])).toEqual([
      [null, 'reason'],
      ['reason', null],
    ]);
    const moveLines = await linesOf([moved.id]);
    expect(moveLines).toHaveLength(1);
    expect(moveLines[0]?.starts_before?.toISOString()).toBe(moved.starts_at.toISOString());
    expect(moveLines[0]?.starts_after?.toISOString()).not.toBe(moved.starts_at.toISOString());
    expect(await linesOf([roomed.id])).toMatchObject([{ room_before: s.room, room_after: spare }]);
    expect(
      (await linesOf([substituted.id])).map((one) => [one.teacher_before, one.teacher_after]),
    ).toEqual([
      [s.teacher.staffId, s.spareTeacher.staffId],
      [s.spareTeacher.staffId, s.teacher.staffId],
    ]);
    for (const line of await linesOf([cancelled.id, moved.id, roomed.id, substituted.id])) {
      expect(line.actors).toEqual([adminAccount]);
    }
  });

  it('a withdraw writes a line per lesson it gives back or removes, by the Super Admin', async () => {
    const s = await publishedScene(t, load);
    const draft = await draftFrom(s, '2026-11-09');
    ok(await publishOf(t)(s.branch, draft, '2026-11-09'));
    const later = await lessonOf(s, '2026-11-16');
    // The later version withdrawn: the earlier one runs again, the teacher comes back.
    ok(await keyed(`/api/timetable/versions/${draft}/withdraw`, s.branch, {}));
    const back = await linesOf([later.id]);
    expect(back.map((one) => [one.kind, one.teacher_after])).toEqual([
      ['changed', s.spareTeacher.staffId],
      ['changed', s.teacher.staffId],
    ]);
    // The first version withdrawn: its dates have no version, its lessons go.
    ok(await keyed(`/api/timetable/versions/${s.version}/withdraw`, s.branch, {}));
    const gone = await linesOf([later.id]);
    expect(gone.map((one) => one.kind)).toEqual(['changed', 'changed', 'removed']);
    expect(gone.map((one) => one.actors)).toEqual([[adminAccount], [adminAccount], [adminAccount]]);
  });

  // Task 6.1b-1 (decision 2; 06, What a change does to existing data:
  // "Removed, if they hold no data"; Impact preview: "any lesson holding data
  // that blocks a removal"): replaces the refusal of 5.8b (decision 8).
  it('a publish whose version drops a lesson with a mark keeps it with its id and cells, cancelled kept_data, listed in the preview and the entry; one without data goes', async () => {
    const s = await publishedScene(t, load);
    const draft = await draftWithout(s, '2026-11-09');
    const held = await lessonOf(s, '2026-11-16');
    const gone = await lessonOf(s, '2026-11-23');
    const { studentId } = await mark(s, held.id);

    const impact = await checkOf(s, draft, '2026-11-09');
    expect(impact.keptWithData.map((one) => [one.lessonId, one.date, one.cancelCause])).toEqual([
      [held.id, '2026-11-16', null],
    ]);
    expect(impact.heldData).toEqual([]);
    ok(await publishOf(t)(s.branch, draft, '2026-11-09'));

    expect(await lessonById(held.id)).toMatchObject({
      block_id: held.block_id,
      cancel_cause: 'kept_data',
      cancel_reason: null,
    });
    expect(await cellsOf(held.id)).toEqual([{ student_id: studentId, mark: 1 }]);
    expect(await lessonById(gone.id)).toBeUndefined();
    const entry = await entryOf(s.branch, 'timetable_version.publish');
    expect(entry.datedLessons?.keptWithData).toEqual([
      expect.objectContaining({ id: held.id, cancelCause: null, reason: null, cause: 'kept_data' }),
    ]);
    const lines = await linesOf([held.id]);
    expect(lines.map((one) => [one.kind, one.cancel_before, one.cancel_after])).toEqual([
      ['changed', null, 'kept_data'],
    ]);
    expect(lines[0]?.actors).toEqual([adminAccount]);
  });

  it('a copy of an earlier version published over a lesson with a work total keeps and lists it', async () => {
    const s = await publishedScene(t, load);
    // A later version gives the class another teacher; the earlier one copied
    // again without the class's row from the next week.
    const later = await draftFrom(s, '2026-11-09');
    ok(await publishOf(t)(s.branch, later, '2026-11-09'));
    const held = await lessonOf(s, '2026-11-16');
    await workWithTotal(t.database.migrator, { branchId: s.branch, lessonId: held.id });
    const restored = await draftWithout(s, '2026-11-16', s.version);
    const impact = await checkOf(s, restored, '2026-11-16');
    expect(impact.keptWithData.map((one) => one.lessonId)).toEqual([held.id]);
    ok(await publishOf(t)(s.branch, restored, '2026-11-16'));
    expect(await lessonById(held.id)).toMatchObject({ cancel_cause: 'kept_data' });
    expect(
      (await entryOf(s.branch, 'timetable_version.publish')).datedLessons?.keptWithData?.map(
        (one) => one.id,
      ),
    ).toEqual([held.id]);
  });

  it('a lesson with data cancelled with a reason and dropped by a publish is kept, kept_data, its earlier cause and reason listed (review correction 1)', async () => {
    const s = await publishedScene(t, load);
    const held = await lessonOf(s, '2026-11-16');
    await mark(s, held.id);
    ok(
      await keyed(`/api/timetable/lessons/${held.id}/cancel`, s.branch, {
        reason: 'Excursion to the museum',
      }),
    );
    const draft = await draftWithout(s, '2026-11-09');
    const impact = await checkOf(s, draft, '2026-11-09');
    expect(impact.keptWithData.map((one) => [one.lessonId, one.cancelCause])).toEqual([
      [held.id, 'reason'],
    ]);
    ok(await publishKeyed(s, draft, '2026-11-09', impact.dayChanges.key));
    expect(await lessonById(held.id)).toMatchObject({
      cancel_cause: 'kept_data',
      cancel_reason: null,
    });
    expect(
      (await entryOf(s.branch, 'timetable_version.publish')).datedLessons?.keptWithData,
    ).toEqual([
      expect.objectContaining({
        id: held.id,
        cancelCause: 'reason',
        reason: 'Excursion to the museum',
        cause: 'kept_data',
      }),
    ]);
  });

  it('a kept lesson stays kept, not listed again, on later writes, and comes back held with its id and cells when its own version runs again', async () => {
    const s = await publishedScene(t, load);
    const held = await lessonOf(s, '2026-11-23');
    const { studentId } = await mark(s, held.id);
    const without = await draftWithout(s, '2026-11-09');
    ok(await publishOf(t)(s.branch, without, '2026-11-09'));
    expect(await lessonById(held.id)).toMatchObject({ cancel_cause: 'kept_data' });

    // A later version over it: kept again, listed by nobody.
    const created = await t.post('/api/timetable/versions', s.branch, {
      academicYearId: s.year,
      startsOn: '2026-11-16',
      copyFrom: without,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const third = (created.body as { id: string }).id;
    const confirmed = await t.post(`/api/timetable/versions/${third}/templates/confirm`, s.branch);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    await load.freeEditLock(third);
    expect((await checkOf(s, third, '2026-11-16')).keptWithData).toEqual([]);
    ok(await publishOf(t)(s.branch, third, '2026-11-16'));
    expect(await lessonById(held.id)).toMatchObject({ cancel_cause: 'kept_data' });
    expect(
      (await entryOf(s.branch, 'timetable_version.publish')).datedLessons?.keptWithData,
    ).toBeUndefined();

    // Both withdrawn, the first version runs again: the lesson is held again.
    ok(await keyed(`/api/timetable/versions/${third}/withdraw`, s.branch, {}));
    expect(await lessonById(held.id)).toMatchObject({ cancel_cause: 'kept_data' });
    ok(await keyed(`/api/timetable/versions/${without}/withdraw`, s.branch, {}));
    expect(await lessonById(held.id)).toMatchObject({
      block_id: held.block_id,
      cancel_cause: null,
      teacher_id: held.teacher_id,
    });
    expect(await cellsOf(held.id)).toEqual([{ student_id: studentId, mark: 1 }]);
    expect(
      (await entryOf(s.branch, 'timetable_version.withdraw')).datedLessons?.givenBack?.map(
        (one) => one.id,
      ),
    ).toEqual([held.id]);
  });

  it('a withdraw of the first version keeps a lesson with data with its block, kept_data and listed, and removes the rest', async () => {
    const s = await publishedScene(t, load);
    const held = await lessonOf(s, '2026-10-26');
    const gone = await lessonOf(s, '2026-11-09');
    await mark(s, held.id);
    ok(await keyed(`/api/timetable/versions/${s.version}/withdraw`, s.branch, {}));
    expect(await lessonById(held.id)).toMatchObject({
      block_id: held.block_id,
      cancel_cause: 'kept_data',
    });
    expect(await lessonById(gone.id)).toBeUndefined();
    expect(
      (await entryOf(s.branch, 'timetable_version.withdraw')).datedLessons?.keptWithData?.map(
        (one) => [one.id, one.cause],
      ),
    ).toEqual([[held.id, 'kept_data']]);
  });

  it('a withdraw that runs the earlier version again keeps and lists a lesson with data the earlier version does not have', async () => {
    const s = await publishedScene(t, load);
    // The later version teaches the class on a lesson the earlier one lacks:
    // the earlier one without the class's row, the later one with it.
    const without = await draftWithout(s, '2026-11-09');
    ok(await publishOf(t)(s.branch, without, '2026-11-09'));
    const back = await draftFrom(s, '2026-11-16');
    ok(await publishOf(t)(s.branch, back, '2026-11-16'));
    const held = await lessonOf(s, '2026-11-23');
    expect(held.cancel_cause).toBeNull();
    await mark(s, held.id);
    ok(await keyed(`/api/timetable/versions/${back}/withdraw`, s.branch, {}));
    expect(await lessonById(held.id)).toMatchObject({ cancel_cause: 'kept_data' });
    expect(
      (await entryOf(s.branch, 'timetable_version.withdraw')).datedLessons?.keptWithData?.map(
        (one) => one.id,
      ),
    ).toEqual([held.id]);
  });
  // Task 6.1b-1 (decision 6): pass 2 of `pairDated` pairs by pattern entry,
  // which never crosses versions: a draft gets pattern entries of its own.
  it('gives a draft copied from a version pattern entries of its own', async () => {
    const s = await publishedScene(t, load);
    const draft = await draftFrom(s, '2026-11-09');
    const entriesOf = async (version: string) =>
      (
        await t.database.migrator
          .selectFrom('pattern_entries')
          .innerJoin('pattern_blocks', 'pattern_blocks.id', 'pattern_entries.block_id')
          .select('pattern_entries.id')
          .where('pattern_blocks.version_id', '=', version)
          .execute()
      ).map((one) => one.id);
    const own = await entriesOf(s.version);
    const copied = await entriesOf(draft);
    expect(own.length).toBeGreaterThan(0);
    expect(copied).toHaveLength(own.length);
    expect(copied.filter((id) => own.includes(id))).toEqual([]);
  });
  // Review correction 3 (5.7b-1, decision 6): a substitution in force on a
  // lesson kept with data ends `dropped`, as on a removed lesson.
  it('ends a substitution in force on a lesson kept with data, dropped', async () => {
    const s = await publishedScene(t, load);
    const held = await lessonOf(s, '2026-11-16');
    await mark(s, held.id);
    expect(await substitutedIn(t.database.migrator, s.branch, '2026-11-16', 100)).toBeGreaterThan(
      0,
    );
    const draft = await draftWithout(s, '2026-11-09');
    const impact = await checkOf(s, draft, '2026-11-09');
    ok(await publishKeyed(s, draft, '2026-11-09', impact.dayChanges.key));
    expect(await lessonById(held.id)).toMatchObject({ cancel_cause: 'kept_data' });
    const rows = await t.database.migrator
      .selectFrom('substitution_lessons')
      .select(['end_cause'])
      .where('lesson_id', '=', held.id)
      .execute();
    expect(rows).toEqual([{ end_cause: 'dropped' }]);
  });

  // Plan test 3 (06, What a change does to existing data, "Lesson moved to
  // another day or slot": "Created at the new time"): another version's move.
  it('a publish that moves a lesson with data to another slot creates the lesson at the new time and keeps the old one, listed in the preview and the entry', async () => {
    const s = await publishedScene(t, load);
    const held = await lessonOf(s, '2026-11-16');
    await mark(s, held.id);
    const created = await t.post('/api/timetable/versions', s.branch, {
      academicYearId: s.year,
      startsOn: '2026-11-09',
      copyFrom: s.version,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const draft = (created.body as { id: string }).id;
    const block = await t.database.migrator
      .selectFrom('pattern_entries')
      .innerJoin('teaching_load_rows', 'teaching_load_rows.id', 'pattern_entries.load_row_id')
      .select('pattern_entries.block_id')
      .where('teaching_load_rows.version_id', '=', draft)
      .where('teaching_load_rows.class_id', '=', s.classId)
      .executeTakeFirstOrThrow();
    const moved = await t.post(
      `/api/timetable/versions/${draft}/pattern/${block.block_id}/move`,
      s.branch,
      { weekday: 1, slotPosition: 5 },
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const confirmed = await t.post(`/api/timetable/versions/${draft}/templates/confirm`, s.branch);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    await load.freeEditLock(draft);

    const impact = await checkOf(s, draft, '2026-11-09');
    expect(impact.keptWithData.map((one) => one.lessonId)).toEqual([held.id]);
    ok(await publishOf(t)(s.branch, draft, '2026-11-09'));
    expect(await lessonById(held.id)).toMatchObject({
      block_id: held.block_id,
      cancel_cause: 'kept_data',
    });
    const day = await t.database.migrator
      .selectFrom('lessons')
      .select(['id', 'starts_at', 'cancel_cause'])
      .where('branch_id', '=', s.branch)
      .where('class_id', '=', s.classId)
      .where('lesson_date', '=', '2026-11-16')
      .orderBy('starts_at')
      .execute();
    expect(day).toHaveLength(2);
    expect(day.find((one) => one.id !== held.id)).toMatchObject({ cancel_cause: null });
    expect(day.find((one) => one.id !== held.id)?.starts_at.getTime() ?? 0).toBeGreaterThan(
      held.starts_at.getTime(),
    );
    expect(
      (await entryOf(s.branch, 'timetable_version.publish')).datedLessons?.keptWithData?.map(
        (one) => one.id,
      ),
    ).toEqual([held.id]);
  });
});
