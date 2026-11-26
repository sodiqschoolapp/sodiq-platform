import { REQUEST_KEY_HEADER, cellHistorySchema, undoneSchema } from '@sodiq/shared';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayTemplatesKit, START, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { LoadKit } from '../../testing/load-kit.js';
import { MembersKit } from '../../testing/members-kit.js';
import { publishedScene } from '../../testing/published-scene.js';

const MOVE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../db/migrations/0186_homework_at_its_lesson.sql',
);
/** Tuesday 27 October 2026, noon in Tashkent: the Mondays 12 and 19 October are held. */
const MOMENT = '2026-10-27T12:00:00+05:00';

/** The move itself: the `do` block of 0186, as the migration runs it. */
async function moveBlock(): Promise<string> {
  const text = await readFile(MOVE, 'utf8');
  const start = text.indexOf('\ndo $$\n');
  const end = text.indexOf('\nend\n$$;\n', start);
  if (start < 0 || end < 0) throw new Error('0186 has no move block.');
  return text.slice(start + 1, end + '\nend\n$$;'.length);
}

// Task 11.24 (the plan's readers of cell history keyed by version; spec review of the plan,
// must-fix 1): the line the move writes keeps the version of the line that wrote the cell's
// value, so a reader that takes "the line of the cell's version" must take the person's own
// line, never the move's. `edge/journal`, Undo: "It covers the user's own last action on the
// page: one cell or one bulk action." The homework is written as the code before 0186 wrote it,
// at the next lesson, and the teacher's own entry is saved there through the route; then the
// move block of 0186 runs as the migration runs it, and the teacher undoes the entry at the
// lesson where the homework was given. All names are invented.
describe('undo of an own entry after the homework move', () => {
  let t: DayTemplatesKit;
  let given: string;
  let checked: string;
  let branch: string;
  let student: string;
  let work: string;
  let cookie: string;
  let teacher: string;

  const post = (lesson: string, route: string, body: object) =>
    t
      .post(`/api/journal/lessons/${lesson}/${route}`, branch, body, cookie)
      .set(REQUEST_KEY_HEADER, randomUUID());

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    const load = new LoadKit(t.database.migrator);
    const owner = await t.kit.completeSession('Dilnoza', 'Karimova');
    cookie = owner.cookie;
    teacher = owner.account.id;
    const s = await publishedScene(t, load, { graded: true, accounts: { teacher } });
    branch = s.branch;
    await t.kit.giveRole(teacher, {
      role: 'teacher',
      branchId: branch,
      validFrom: new Date('2026-09-01T00:00:00+05:00'),
    });
    const lessons = (
      await t.database.migrator
        .selectFrom('lessons')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('lesson_date', '<=', '2026-10-31')
        .orderBy('starts_at')
        .execute()
    ).map((row) => row.id);
    [given = '', checked = ''] = lessons;
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    student = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await members.member({ branch, classId: s.classId, studentId: student, from: '2026-09-01' });
    // The homework of 12 October stored at 19 October, as the check lesson stored it before
    // 0186. Since 0186 the database refuses that shape (journal_works_at_source), so the
    // fixture lifts the check and the move puts it back.
    await t.database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${new Date(MOMENT).toISOString()}, true)`.execute(
        transaction,
      );
      await sql`alter table journal_works drop constraint journal_works_at_source`.execute(
        transaction,
      );
      const row = await transaction
        .insertInto('journal_works')
        .values({
          branch_id: branch,
          lesson_id: checked,
          source_lesson_id: given,
          kind: 'homework',
          position: 1,
          title: 'Reading page 12',
          total: 10,
          changed_by: teacher,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      work = row.id;
    });
    t.clock.set(MOMENT);
  }, 240_000);

  afterAll(async () => {
    t.clock.set(START);
    await t.close();
  });

  it('undoes the teacher’s own last entry, not the move, and lists the move line after its version', async () => {
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(MOMENT), last_used_at: new Date(MOMENT) })
      .where('account_id', '=', teacher)
      .execute();
    // Before the move: 7, then the teacher's own last entry, 8, at the lesson that checked it.
    const first = await post(checked, 'scores', {
      saves: [{ studentId: student, column: { workId: work }, score: 7, version: null }],
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const second = await post(checked, 'scores', {
      saves: [{ studentId: student, column: { workId: work }, score: 8, version: 1 }],
    });
    expect(second.status, JSON.stringify(second.body)).toBe(200);

    const block = await moveBlock();
    await t.database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${new Date('2026-10-27T12:05:00+05:00').toISOString()}, true)`.execute(
        transaction,
      );
      await sql.raw(block).execute(transaction);
      await sql`
        alter table journal_works add constraint journal_works_at_source check (
          source_lesson_id is null or lesson_id = source_lesson_id
        )
      `.execute(transaction);
    });
    const moved = await t.database.migrator
      .selectFrom('journal_cells')
      .select(['lesson_id', 'score', 'version', 'changed_how'])
      .where('work_id', '=', work)
      .executeTakeFirstOrThrow();
    expect(moved).toEqual({ lesson_id: given, score: 8, version: 2, changed_how: 'entry' });

    // The history lists the move after the teacher's line of version 2.
    const history = await t.get(
      `/api/journal/lessons/${given}/students/${student}/history`,
      branch,
      cookie,
    );
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    const lines = cellHistorySchema
      .parse(history.body)
      .lines.filter((line) => line.work?.id === work);
    const own = lines.findIndex((line) => line.version === 2 && line.changedHow === 'entry');
    const move = lines.findIndex((line) => line.changedHow === 'homework_move');
    expect(own).toBeGreaterThanOrEqual(0);
    expect(move).toBeGreaterThanOrEqual(0);
    expect(lines[move]).toMatchObject({ version: 2, before: 8, after: 8, changedBy: null });
    // Newest first or oldest first, the move comes after the line of its version.
    const newestFirst = (lines[0]?.version ?? 0) >= (lines.at(-1)?.version ?? 0);
    expect(newestFirst ? move < own : move > own).toBe(true);

    // Undo at the lesson where the homework was given: the entry of version 2 is undone.
    const undo = await post(given, 'undo', {
      students: [{ studentId: student, cells: [{ workId: work, version: 2 }] }],
    });
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    expect(undoneSchema.parse(undo.body)).toEqual({
      undone: [{ studentId: student, workId: work, version: 3 }],
      skipped: [],
    });
    const cell = await t.database.migrator
      .selectFrom('journal_cells')
      .select(['lesson_id', 'score', 'version', 'changed_how', 'changed_by'])
      .where('work_id', '=', work)
      .executeTakeFirstOrThrow();
    expect(cell).toEqual({
      lesson_id: given,
      score: 7,
      version: 3,
      changed_how: 'undo',
      changed_by: teacher,
    });
    const last = await t.database.migrator
      .selectFrom('journal_cell_history')
      .select(['version', 'score_before', 'score_after', 'changed_how', 'changed_by'])
      .where('work_id', '=', work)
      .orderBy('version', 'desc')
      .executeTakeFirstOrThrow();
    expect(last).toEqual({
      version: 3,
      score_before: 8,
      score_after: 7,
      changed_how: 'undo',
      changed_by: teacher,
    });
  });
});
