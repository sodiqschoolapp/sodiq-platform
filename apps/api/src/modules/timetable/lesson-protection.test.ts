import { randomUUID } from 'node:crypto';
import { BRANCH_HEADER, REQUEST_KEY_HEADER } from '@sodiq/shared';
import { sql } from 'kysely';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { publishedScene, publishOf, type PublishedScene } from '../../testing/published-scene.js';
import { errorCode } from '../../testing/sign-in-kit.js';

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

  /** Lessons the stand-in of 6.1's cells says hold data. */
  const holdData = (ids: readonly string[]) =>
    t.database.migrator
      .insertInto('test_lessons_with_data' as never)
      .values(ids.map((id) => ({ lesson_id: id })))
      .execute();

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
    // A stand-in for the cells of 6.1: the lessons this table names hold data.
    await sql`create table test_lessons_with_data (lesson_id uuid primary key)`.execute(
      t.database.migrator,
    );
    await sql`grant select on test_lessons_with_data to sodiq_app`.execute(t.database.migrator);
    await sql`
      create or replace function lesson_holds_data(lesson_ref uuid) returns boolean
      language sql stable set search_path = pg_catalog, public
      as $$ select exists (select 1 from test_lessons_with_data t where t.lesson_id = lesson_ref) $$
    `.execute(t.database.migrator);
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

  it('refuses a withdraw that would remove a lesson holding data, and changes nothing (6.1 keeps and lists it)', async () => {
    const other = await publishedScene(t, load);
    const draft = await draftFrom(other, '2026-11-09');
    ok(await publishOf(t)(other.branch, draft, '2026-11-09'));
    const kept = await lessonOf(other, '2026-10-26');
    await holdData([kept.id]);
    const otherBefore = await unitsOf(other.branch);
    const withdrawn = await keyed(
      `/api/timetable/versions/${other.version}/withdraw`,
      other.branch,
      {},
    );
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(409);
    expect(errorCode(withdrawn)).toBe('lesson_holds_data');
    expect(await unitsOf(other.branch)).toEqual(otherBefore);
  });
});
