import {
  REQUEST_KEY_HEADER,
  cellHistorySchema,
  commentHistorySchema,
  journalSupportSchema,
  resetEntriesSchema,
  studentReportSchema,
} from '@sodiq/shared';
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
/** Tuesday 27 October 2026 in Tashkent: the Mondays 12 and 19 October are held. */
const BEFORE_MOVE = '2026-10-27T11:00:00+05:00';
const RESET = '2026-10-27T11:30:00+05:00';
const MOVED_AT = '2026-10-27T12:05:00+05:00';
const READ_AT = '2026-10-27T13:00:00+05:00';

/** The move itself: the `do` block of 0186, as the migration runs it. */
async function moveBlock(): Promise<string> {
  const text = await readFile(MOVE, 'utf8');
  const start = text.indexOf('\ndo $$\n');
  const end = text.indexOf('\nend\n$$;\n', start);
  if (start < 0 || end < 0) throw new Error('0186 has no move block.');
  return text.slice(start + 1, end + '\nend\n$$;'.length);
}

// Task 11.24 (permission review of the branch, must-fix 1; `.claude/rules/api.md`: "a value
// that the task reads in a new way has a test at every reader of it"): the lines the move
// writes have no author and the kind `homework_move`. Each route that reads history lines is
// called on one fixture with a moved homework: the support view (as the Super Admin and the
// Academic Vice Principal), the personal data report, the comment history, the report of
// entries after a reset, and the cell history at the lesson the homework left. A homework of 12
// October is stored at 19 October as the code before 0186 stored it, with a number of a student
// expected on the 12th (it moves) and of one who joined on the 15th (it is left out, with its
// comment). All names are invented.
describe('the readers of the lines of the homework move', () => {
  let t: DayTemplatesKit;
  let given: string;
  let checked: string;
  let branch: string;
  let journal: string;
  let stays: string;
  let late: string;
  let work: string;
  let teacher: { cookie: string; accountId: string; staffId: string };
  let admin: string;
  let adminAccount: string;
  let vice: string;

  const asTeacher = (lesson: string, route: string, body: object, method: 'post' | 'put') =>
    (method === 'post'
      ? t.post(`/api/journal/lessons/${lesson}/${route}`, branch, body, teacher.cookie)
      : t.put(`/api/journal/lessons/${lesson}/${route}`, branch, body, teacher.cookie)
    ).set(REQUEST_KEY_HEADER, randomUUID());

  const freshSession = async (accountId: string, moment: string) => {
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(moment), last_used_at: new Date(moment) })
      .where('account_id', '=', accountId)
      .execute();
  };

  beforeAll(async () => {
    t = await dayTemplatesKit({ jobs: true });
    const load = new LoadKit(t.database.migrator);
    const owner = await t.kit.completeSession('Dilnoza', 'Karimova');
    const s = await publishedScene(t, load, {
      graded: true,
      accounts: { teacher: owner.account.id },
    });
    branch = s.branch;
    teacher = {
      cookie: owner.cookie,
      accountId: owner.account.id,
      staffId: s.teacher.staffId,
    };
    const validFrom = new Date('2026-09-01T00:00:00+05:00');
    await t.kit.giveRole(teacher.accountId, { role: 'teacher', branchId: branch, validFrom });
    const adminSession = await t.kit.completeSession('Bahrom', 'Toshmatov');
    admin = adminSession.cookie;
    adminAccount = adminSession.account.id;
    await t.kit.giveRole(adminSession.account.id, { role: 'super_admin', validFrom });
    const viceSession = await t.kit.completeSession('Gulnora', 'Saidova');
    vice = viceSession.cookie;
    await t.kit.giveRole(viceSession.account.id, {
      role: 'academic_vice_principal',
      branchId: branch,
      validFrom,
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
    journal = (
      await t.database.migrator
        .selectFrom('journals')
        .select('id')
        .where('class_id', '=', s.classId)
        .where('subject_id', '=', s.subject)
        .executeTakeFirstOrThrow()
    ).id;
    const members = new MembersKit(t.database.migrator, await load.classes.account());
    stays = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await members.member({ branch, classId: s.classId, studentId: stays, from: '2026-09-01' });
    late = await members.student(branch, { startsOn: '2026-09-01', grade: 7 });
    await members.member({ branch, classId: s.classId, studentId: late, from: '2026-10-15' });
    // The shape the code before 0186 wrote, which 0186 refuses: the fixture lifts the check,
    // and the move below puts it back.
    await t.database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${new Date(BEFORE_MOVE).toISOString()}, true)`.execute(
        transaction,
      );
      await sql`alter table journal_works drop constraint journal_works_at_source`.execute(
        transaction,
      );
      work = (
        await transaction
          .insertInto('journal_works')
          .values({
            branch_id: branch,
            lesson_id: checked,
            source_lesson_id: given,
            kind: 'homework',
            position: 1,
            title: 'Reading page 12',
            total: 10,
            changed_by: teacher.accountId,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    });
    // The teacher's numbers and a comment at the lesson that checked it, before the move.
    t.clock.set(BEFORE_MOVE);
    await freshSession(teacher.accountId, BEFORE_MOVE);
    const scores = await asTeacher(
      checked,
      'scores',
      {
        saves: [
          { studentId: stays, column: { workId: work }, score: 7, version: null },
          { studentId: late, column: { workId: work }, score: 9, version: null },
        ],
      },
      'post',
    );
    expect(scores.status, JSON.stringify(scores.body)).toBe(200);
    const comment = await t.put(
      '/api/journal/comments',
      branch,
      {
        on: { target: 'work', lessonId: checked, workId: work, studentId: late },
        body: 'Handed in a day late',
        visibility: 'parents',
        version: null,
      },
      teacher.cookie,
    );
    expect(comment.status, JSON.stringify(comment.body)).toBe(200);
    // A reset of the teacher's password just before the move: the 48 hours after it hold the
    // move's lines, which are no entry of the teacher.
    t.clock.set(RESET);
    await freshSession(adminAccount, RESET);
    const reset = await t.post(
      `/api/people/staff/${teacher.staffId}/account/password-reset`,
      branch,
      {},
      admin,
    );
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    // The move, as the migration runs it.
    const block = await moveBlock();
    await t.database.migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${new Date(MOVED_AT).toISOString()}, true)`.execute(
        transaction,
      );
      await sql.raw(block).execute(transaction);
      await sql`
        alter table journal_works add constraint journal_works_at_source check (
          source_lesson_id is null or lesson_id = source_lesson_id
        )
      `.execute(transaction);
    });
    t.clock.set(READ_AT);
  }, 240_000);

  afterAll(async () => {
    t.clock.set(START);
    await t.close();
  });

  const freshAll = async () => {
    await t.database.migrator
      .updateTable('sessions')
      .set({ created_at: new Date(READ_AT), last_used_at: new Date(READ_AT) })
      .execute();
  };

  it('moved the homework, its kept number and its cleared one', async () => {
    const cells = await t.database.migrator
      .selectFrom('journal_cells')
      .select(['student_id', 'lesson_id', 'score'])
      .where('work_id', '=', work)
      .orderBy('score')
      .execute();
    expect(cells).toEqual(
      expect.arrayContaining([
        { student_id: stays, lesson_id: given, score: 7 },
        { student_id: late, lesson_id: given, score: null },
      ]),
    );
  });

  it.each([
    ['the Super Admin', () => admin],
    ['the Academic Vice Principal', () => vice],
  ])('shows the move lines with no author in the support view, as %s', async (_who, cookieOf) => {
    await freshAll();
    // The kept number moves with its line at the 12th; the left-out one is cleared at the 19th
    // (its number in the line before) and its empty cell then moves to the 12th.
    for (const [student, date, before, after, lessonId] of [
      [stays, '2026-10-12', 7, 7, () => given],
      [late, '2026-10-19', 9, null, () => checked],
      [late, '2026-10-12', null, null, () => given],
    ] as const) {
      const answer = await t.get(
        `/api/journal/support?studentId=${student}&journalId=${journal}&date=${date}`,
        branch,
        cookieOf(),
      );
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      const view = journalSupportSchema.parse(answer.body);
      const moves = view.lines.filter(
        (line) => line.kind === 'cell' && line.how === 'homework_move' && line.work?.id === work,
      );
      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({ by: null, before, after, lessonId: lessonId() });
      if (date === '2026-10-12') {
        const workLines = view.lines.filter(
          (line) => line.kind === 'work' && line.how === 'homework_move' && line.work.id === work,
        );
        expect(workLines).toEqual([expect.objectContaining({ by: null, lessonId: given })]);
      }
    }
  });

  it('lists the move lines with no author in the personal data report', async () => {
    await freshAll();
    const answer = await t.post(`/api/people/students/${late}/report`, branch, {}, admin);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const report = studentReportSchema.parse(answer.body);
    const moves = report.journal.history.filter((line) => line.changedHow === 'homework_move');
    expect(moves.map((line) => [line.lesson?.date, line.before, line.after, line.changedBy])).toEqual(
      expect.arrayContaining([
        ['2026-10-19', 9, null, null],
        ['2026-10-12', null, null, null],
      ]),
    );
    expect(moves).toHaveLength(2);
    const comments = report.journal.commentHistory.filter(
      (line) => line.changedHow === 'homework_move',
    );
    expect(comments).toEqual([
      expect.objectContaining({
        changedBy: null,
        bodyBefore: 'Handed in a day late',
        bodyAfter: null,
      }),
    ]);
    // The work's lines of the report are its total and "not held" (decision 13 of 6.1c): the move
    // changes neither (and the fixture wrote the total with no line), so none is listed.
    expect(report.journal.workHistory.filter((line) => line.workId === work)).toEqual([]);
  });

  it('shows the cleared comment with its move line in the comment history', async () => {
    await freshAll();
    const answer = await t.get(
      `/api/journal/comments/history?target=work&studentId=${late}&lessonId=${given}&workId=${work}`,
      branch,
      admin,
    );
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const history = commentHistorySchema.parse(answer.body);
    const move = history.lines.filter((line) => line.changedHow === 'homework_move');
    expect(move).toEqual([
      expect.objectContaining({
        changedBy: null,
        bodyBefore: 'Handed in a day late',
        bodyAfter: null,
      }),
    ]);
  });

  it('lists no move line as an entry of the teacher after the reset', async () => {
    await freshAll();
    const answer = await t.get(
      '/api/people/accounts/reset-entries?from=2026-10-27&to=2026-10-27',
      branch,
      admin,
    );
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const report = resetEntriesSchema.parse(answer.body);
    const ofTeacher = report.resets.filter((one) => one.person.accountId === teacher.accountId);
    expect(ofTeacher).toHaveLength(1);
    expect(JSON.stringify(ofTeacher)).not.toContain('homework_move');
  });

  it('shows the moved cell at the lesson where it was given, and nothing of it at the lesson it left', async () => {
    await freshAll();
    const at = async (lesson: string) => {
      const answer = await t.get(
        `/api/journal/lessons/${lesson}/students/${stays}/history`,
        branch,
        vice,
      );
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      return cellHistorySchema.parse(answer.body).lines.filter((line) => line.work?.id === work);
    };
    const there = await at(given);
    expect(there.map((line) => [line.changedHow, line.before, line.after])).toEqual(
      expect.arrayContaining([
        ['entry', null, 7],
        ['homework_move', 7, 7],
      ]),
    );
    expect(there.find((line) => line.changedHow === 'homework_move')?.changedBy).toBeNull();
    expect(await at(checked)).toEqual([]);
  });
});
