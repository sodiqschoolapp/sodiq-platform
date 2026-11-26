import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../database/database.js';
import { migrate } from '../../database/migrate.js';
import type { Transaction } from '../../database/transactions.js';
import { insertBranch, setEditDays } from '../../testing/branch-filter-sql.js';
import { CellsKit } from '../../testing/cells-kit.js';
import { closeQuarter, reopenQuarter } from '../../testing/closing-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../db/migrations',
);
const MOVE = '0186_homework_at_its_lesson.sql';
/** The moment of the writes before the move. */
const BEFORE = '2026-12-04T12:00:00+05:00';
/** The moment the move runs at, given to the migration as `app.now`. */
const NOW = '2026-12-10T10:00:00+05:00';

/** The connection string of the migrator with `app.now` set for the session. */
const atMoment = (url: string, moment: string): string => {
  const address = new URL(url);
  address.searchParams.set('options', `-c app.now=${new Date(moment).toISOString()}`);
  return address.toString();
};

/** A fresh database migrated to the last migration before the move. */
async function databaseBeforeMove(): Promise<{
  database: TestDatabase;
  directory: string;
}> {
  const database = await createTestDatabase({ empty: true });
  const directory = await mkdtemp(path.join(tmpdir(), 'sodiq-homework-move-'));
  for (const name of (await readdir(MIGRATIONS)).filter((one) => one.endsWith('.sql'))) {
    if (name < MOVE) await copyFile(path.join(MIGRATIONS, name), path.join(directory, name));
  }
  await migrate({ connectionString: database.migrationUrl, directory });
  return { database, directory };
}

/** Writes as the migrator at a moment, the way the code before 0186 wrote its rows. */
const asMigrator = <T>(
  migrator: Database,
  moment: string,
  work: (transaction: Transaction) => Promise<T>,
): Promise<T> =>
  migrator.transaction().execute(async (transaction) => {
    await sql`select set_config('app.now', ${new Date(moment).toISOString()}, true)`.execute(
      transaction,
    );
    return work(transaction);
  });

/** The records a scene of homework stands on: a class with students and its lessons. */
interface Ground {
  readonly cells: CellsKit;
  readonly branch: string;
  readonly year: string;
  readonly quarters: readonly string[];
  readonly classId: string;
  readonly teacher: string;
  readonly students: readonly string[];
}

async function ground(migrator: Database, studentCount: number): Promise<Ground> {
  const cells = await CellsKit.create(migrator);
  const branch = await insertBranch(migrator, 'North');
  const { year, quarters } = await cells.lessons.year(branch);
  const classId = await cells.lessons.load.classes.schoolClass(branch, year, { grade: 7 });
  const students = await cells.lessons.pupils(branch, classId, studentCount);
  const teacher = await cells.lessons.load.classes.account();
  return { cells, branch, year, quarters, classId, teacher, students };
}

/** A homework given at `given`, stored at `stored` with a total, as the check lesson wrote it. */
async function storedHomework(
  migrator: Database,
  g: Ground,
  input: {
    readonly given: string | null;
    readonly stored: string;
    readonly position: number;
    readonly total?: number | null;
    readonly notHeld?: boolean;
    readonly carriedFrom?: string | null;
  },
): Promise<string> {
  return asMigrator(migrator, BEFORE, async (transaction) => {
    const row = await transaction
      .insertInto('journal_works')
      .values({
        branch_id: g.branch,
        lesson_id: input.stored,
        source_lesson_id: input.given,
        kind: 'homework',
        position: input.position,
        title: `Exercise ${String(input.position)}`,
        total: input.total === undefined ? 10 : input.total,
        not_held: input.notHeld ?? false,
        carried_from_lesson_id: input.carriedFrom ?? null,
        changed_by: g.teacher,
        changed_how:
          input.carriedFrom === undefined || input.carriedFrom === null ? 'entry' : 'carry',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  });
}

/** A number of a student on a work, saved at its stored lesson. */
async function score(
  migrator: Database,
  g: Ground,
  input: {
    readonly lesson: string;
    readonly work: string;
    readonly student: string;
    readonly score: number | null;
    readonly notGraded?: boolean;
    readonly how?: string;
  },
): Promise<string> {
  return asMigrator(migrator, BEFORE, async (transaction) => {
    const row = await transaction
      .insertInto('journal_cells')
      .values({
        branch_id: g.branch,
        lesson_id: input.lesson,
        student_id: input.student,
        work_id: input.work,
        score: input.score,
        not_graded: input.notGraded ?? false,
        version: 1,
        changed_by: g.teacher,
        changed_how: input.how ?? 'entry',
        changed_at: new Date(BEFORE),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  });
}

const cancel = (migrator: Database, lesson: string) =>
  migrator
    .updateTable('lessons')
    .set({ cancel_cause: 'reason', cancel_reason: 'School event' })
    .where('id', '=', lesson)
    .execute();

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<Error> {
  try {
    await work;
  } catch (error) {
    return error as Error;
  }
  throw new Error('The migration was not refused.');
}

// Task 11.24 (pull request #394; the plan's database steps 1 to 7, corrections 1 and 2):
// edge/journal, Entering: "Homework numbers were saved before 25 November 2026 at a later
// lesson than the one where the homework was given (the next lesson, the next held lesson
// after a cancelled one, or the lesson it was carried to). Once, on the change, each such
// homework column moves with its total, "not held", numbers and comments to the lesson where
// the homework was given ... Each move writes an audit entry and a line in each cell's
// history. A number of a student who was exempt, or not yet in the group, at the lesson where
// the homework was given does not move: it leaves the averages and stays in the cell's
// history." The rows are written as the code before 0186 wrote them; names are invented.
describe('migration 0186 moves homework to the lesson where it was given', () => {
  let database: TestDatabase;
  let directory: string;
  let g: Ground;
  let lessons: Record<string, string>;
  let works: Record<'next' | 'afterCancel' | 'carried' | 'notHeld' | 'orphan', string>;
  let cellsOf: Record<string, string>;
  let exempt: string;
  let joined: string;
  let checkExempt: string;
  let exemptionId: string;
  let comments: { moved: string; leftOut: string };
  let before: {
    cells: { id: string; version: number; changed_by: string; changed_how: string }[];
    orphan: { lesson_id: string; carried_from_lesson_id: string | null; version: number };
  };

  beforeAll(async () => {
    ({ database, directory } = await databaseBeforeMove());
    const migrator = database.migrator;
    g = await ground(migrator, 4);
    const [present, second, third, fourth] = g.students as [string, string, string, string];
    exempt = third;
    checkExempt = fourth;
    const lesson = (date: string) => g.cells.lesson(g.branch, g.year, g.classId, date);
    lessons = {
      givenA: await lesson('2026-11-16'),
      checkA: await lesson('2026-11-18'),
      givenB: await lesson('2026-11-23'),
      cancelledB: await lesson('2026-11-25'),
      storedB: await lesson('2026-11-27'),
      givenC: await lesson('2026-11-30'),
      checkC: await lesson('2026-12-02'),
      storedC: await lesson('2026-12-04'),
      orphanAt: await lesson('2026-12-07'),
    };
    await cancel(migrator, lessons.cancelledB ?? '');
    // A student who joins the class between the lesson where the homework was given and the
    // lesson that checked it.
    joined = await g.cells.lessons.members.student(g.branch, { startsOn: '2026-11-17' });
    await g.cells.lessons.members.member({
      branch: g.branch,
      classId: g.classId,
      studentId: joined,
      from: '2026-11-17',
    });
    // One exemption on the day the homework of A was given and the day it was checked: its
    // student is not expected at either; a second on the check day only.
    const exemption = (student: string, from: string, until: string) =>
      asMigrator(migrator, BEFORE, async (transaction) => {
        const row = await transaction
          .insertInto('exemptions')
          .values({
            branch_id: g.branch,
            student_id: student,
            year_id: g.year,
            batch_id: '019a0000-0000-7000-8000-000000001124',
            kind: 'temporary',
            all_subjects: true,
            start_date: from,
            end_date: until,
            category: 'illness',
            detail: 'A certificate from the clinic',
            granted_by: g.teacher,
            granted_at: new Date(0),
            version: 0,
            changed_at: new Date(0),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return row.id;
      });

    // A: the homework of 16 November stored at the next lesson, 18 November, with numbers.
    // The exempt student's number was typed before the exemption came, and cleared by "exempt
    // and clear" (exemption_clears keeps it); so was the number of the student exempt on the
    // check day only.
    works = {
      next: await storedHomework(migrator, g, {
        given: lessons.givenA ?? '',
        stored: lessons.checkA ?? '',
        position: 1,
      }),
      afterCancel: await storedHomework(migrator, g, {
        given: lessons.givenB ?? '',
        stored: lessons.storedB ?? '',
        position: 1,
      }),
      carried: await storedHomework(migrator, g, {
        given: lessons.givenC ?? '',
        stored: lessons.storedC ?? '',
        position: 1,
        carriedFrom: lessons.checkC ?? '',
      }),
      notHeld: await storedHomework(migrator, g, {
        given: lessons.givenA ?? '',
        stored: lessons.checkA ?? '',
        position: 2,
        total: null,
        notHeld: true,
      }),
      // A carry whose source was force-deleted: `on delete set null` left no source.
      orphan: await storedHomework(migrator, g, {
        given: null,
        stored: lessons.orphanAt ?? '',
        position: 1,
        carriedFrom: lessons.checkC ?? '',
      }),
    };
    const checkA = lessons.checkA ?? '';
    cellsOf = {
      present: await score(migrator, g, {
        lesson: checkA,
        work: works.next,
        student: present,
        score: 7,
      }),
      late: await score(migrator, g, {
        lesson: checkA,
        work: works.next,
        student: second,
        score: 9,
        how: 'late_entry',
      }),
      exempt: await score(migrator, g, {
        lesson: checkA,
        work: works.next,
        student: exempt,
        score: 4,
      }),
      checkExempt: await score(migrator, g, {
        lesson: checkA,
        work: works.next,
        student: checkExempt,
        score: 6,
      }),
      joined: await score(migrator, g, {
        lesson: checkA,
        work: works.next,
        student: joined,
        score: 8,
      }),
      afterCancel: await score(migrator, g, {
        lesson: lessons.storedB ?? '',
        work: works.afterCancel,
        student: present,
        score: 10,
      }),
      notGraded: await score(migrator, g, {
        lesson: lessons.storedB ?? '',
        work: works.afterCancel,
        student: second,
        score: null,
        notGraded: true,
      }),
      carried: await score(migrator, g, {
        lesson: lessons.storedC ?? '',
        work: works.carried,
        student: present,
        score: 5,
      }),
    };
    // A correction of the Academic Vice Principal on B, written as its route leaves the row
    // and its line (the corrector's role and reason are what 0122 checks, not what is moved).
    await migrator.transaction().execute(async (transaction) => {
      await sql`select set_config('app.now', ${new Date(BEFORE).toISOString()}, true)`.execute(
        transaction,
      );
      await sql`alter table journal_cells disable trigger journal_cells_edit_guard_update`.execute(
        transaction,
      );
      await transaction
        .updateTable('journal_cells')
        .set({ score: 3, changed_how: 'correction' })
        .where('id', '=', cellsOf.afterCancel ?? '')
        .execute();
      await sql`alter table journal_cells enable trigger journal_cells_edit_guard_update`.execute(
        transaction,
      );
    });
    exemptionId = await exemption(exempt, '2026-11-16', '2026-11-18');
    const checkOnly = await exemption(checkExempt, '2026-11-18', '2026-11-18');
    for (const [cell, student, value, by] of [
      [cellsOf.exempt ?? '', exempt, 4, exemptionId],
      [cellsOf.checkExempt ?? '', checkExempt, 6, checkOnly],
    ] as const) {
      await asMigrator(migrator, BEFORE, async (transaction) => {
        await transaction
          .updateTable('journal_cells')
          .set({ score: null, changed_how: 'exemption' })
          .where('id', '=', cell)
          .execute();
        await transaction
          .insertInto('exemption_clears')
          .values({
            branch_id: g.branch,
            exemption_id: by,
            cell_id: cell,
            lesson_id: checkA,
            student_id: student,
            score: value,
            cleared_version: 2,
          })
          .execute();
      });
    }
    // Comments on the numbers of A: one moves, one (of the student who joined later) is
    // cleared; that one was edited once before, so it has two lines.
    const comment = (student: string, body: string) =>
      asMigrator(migrator, BEFORE, async (transaction) => {
        const row = await transaction
          .insertInto('journal_comments')
          .values({
            branch_id: g.branch,
            student_id: student,
            target: 'work',
            lesson_id: checkA,
            work_id: works.next,
            body,
            visibility: 'parents',
            version: 1,
            changed_by: g.teacher,
            changed_how: 'entry',
            changed_at: new Date(BEFORE),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return row.id;
      });
    comments = {
      moved: await comment(present, 'Neat work'),
      leftOut: await comment(joined, 'Handed in late'),
    };
    await asMigrator(migrator, BEFORE, (transaction) =>
      transaction
        .updateTable('journal_comments')
        .set({ body: 'Handed in two days late' })
        .where('id', '=', comments.leftOut)
        .execute(),
    );
    before = {
      cells: await migrator
        .selectFrom('journal_cells')
        .select(['id', 'version', 'changed_by', 'changed_how'])
        .where('work_id', 'is not', null)
        .orderBy('id')
        .execute(),
      orphan: await migrator
        .selectFrom('journal_works')
        .select(['lesson_id', 'carried_from_lesson_id', 'version'])
        .where('id', '=', works.orphan)
        .executeTakeFirstOrThrow(),
    };
    await migrate({
      connectionString: atMoment(database.migrationUrl, NOW),
      directory: MIGRATIONS,
    });
  }, 240_000);

  afterAll(async () => {
    await database.destroy();
    await rm(directory, { recursive: true, force: true });
  });

  it('stores every homework, its cells and its comments at the lesson where it was given', async () => {
    const rows = await database.migrator
      .selectFrom('journal_works')
      .select([
        'id',
        'lesson_id',
        'source_lesson_id',
        'carried_from_lesson_id',
        'total',
        'not_held',
      ])
      .where('id', 'in', [works.next, works.afterCancel, works.carried, works.notHeld])
      .execute();
    for (const row of rows) {
      expect(row.lesson_id).toBe(row.source_lesson_id);
      expect(row.carried_from_lesson_id).toBeNull();
    }
    const of = (id: string) => rows.find((row) => row.id === id);
    expect(of(works.next)?.lesson_id).toBe(lessons.givenA);
    expect(of(works.afterCancel)?.lesson_id).toBe(lessons.givenB);
    expect(of(works.carried)?.lesson_id).toBe(lessons.givenC);
    expect(of(works.notHeld)).toMatchObject({ lesson_id: lessons.givenA, not_held: true });
    expect(of(works.next)?.total).toBe(10);
    const cellRows = await database.migrator
      .selectFrom('journal_cells')
      .innerJoin('journal_works', 'journal_works.id', 'journal_cells.work_id')
      .select(['journal_cells.lesson_id as cell', 'journal_works.lesson_id as work'])
      .execute();
    expect(cellRows.length).toBe(8);
    for (const row of cellRows) expect(row.cell).toBe(row.work);
    const moved = await database.migrator
      .selectFrom('journal_comments')
      .select(['lesson_id', 'body'])
      .where('id', '=', comments.moved)
      .executeTakeFirstOrThrow();
    expect(moved).toEqual({ lesson_id: lessons.givenA, body: 'Neat work' });
  });

  it('keeps each moved cell as it was: its version, author and kind', async () => {
    const after = await database.migrator
      .selectFrom('journal_cells')
      .select(['id', 'version', 'changed_by', 'changed_how', 'score'])
      .where('work_id', 'is not', null)
      .orderBy('id')
      .execute();
    const leftOut = new Set([cellsOf.exempt, cellsOf.joined]);
    for (const cell of before.cells.filter((one) => !leftOut.has(one.id))) {
      expect(after.find((one) => one.id === cell.id)).toMatchObject({
        version: cell.version,
        changed_by: cell.changed_by,
        changed_how: cell.changed_how,
      });
    }
    expect(after.find((one) => one.id === cellsOf.late)).toMatchObject({
      changed_how: 'late_entry',
      score: 9,
    });
    expect(after.find((one) => one.id === cellsOf.afterCancel)).toMatchObject({
      changed_how: 'correction',
      score: 3,
    });
  });

  it('writes one line with no author for each moved cell and each moved work', async () => {
    const cellLines = await database.migrator
      .selectFrom('journal_cell_history')
      .select(['cell_id', 'lesson_id', 'version', 'changed_by', 'score_before', 'score_after'])
      .where('changed_how', '=', 'homework_move')
      .execute();
    for (const cell of before.cells) {
      const lines = cellLines.filter((line) => line.cell_id === cell.id);
      // A cell left out with a number has the line of its clear and the line of its move; the
      // exempt student's cell was already empty (its exemption cleared it).
      const count = cell.id === cellsOf.joined ? 2 : 1;
      expect(lines.length, cell.id).toBe(count);
      for (const line of lines) expect(line.changed_by).toBeNull();
    }
    const present = cellLines.find((line) => line.cell_id === cellsOf.present);
    expect(present).toMatchObject({ lesson_id: lessons.givenA, score_before: 7, score_after: 7 });
    expect(present?.version).toBe(before.cells.find((one) => one.id === cellsOf.present)?.version);
    const workLines = await database.migrator
      .selectFrom('journal_work_history')
      .select(['work_id', 'lesson_id', 'lesson_before', 'changed_by'])
      .where('changed_how', '=', 'homework_move')
      .execute();
    expect(workLines.map((line) => line.work_id).sort()).toEqual(
      [works.next, works.afterCancel, works.carried, works.notHeld].sort(),
    );
    expect(workLines.find((line) => line.work_id === works.carried)).toMatchObject({
      lesson_id: lessons.givenC,
      lesson_before: lessons.storedC,
      changed_by: null,
    });
  });

  it('leaves out the numbers of students not expected at that lesson and keeps them in history', async () => {
    const cells = await database.migrator
      .selectFrom('journal_cells')
      .select(['id', 'lesson_id', 'score', 'not_graded'])
      .where('id', 'in', [cellsOf.exempt ?? '', cellsOf.joined ?? ''])
      .execute();
    for (const cell of cells) {
      expect(cell).toMatchObject({ lesson_id: lessons.givenA, score: null, not_graded: false });
    }
    const line = await database.migrator
      .selectFrom('journal_cell_history')
      .select(['score_before', 'score_after', 'lesson_id'])
      .where('cell_id', '=', cellsOf.joined ?? '')
      .where('changed_how', '=', 'homework_move')
      .where('score_before', 'is not', null)
      .executeTakeFirstOrThrow();
    expect(line).toEqual({ score_before: 8, score_after: null, lesson_id: lessons.checkA });
    // The number of the student exempt on the check day only moves (it was cleared by the
    // exemption and its clear follows it), and so do the others.
    const kept = await database.migrator
      .selectFrom('journal_cells')
      .select('lesson_id')
      .where('id', '=', cellsOf.checkExempt ?? '')
      .executeTakeFirstOrThrow();
    expect(kept.lesson_id).toBe(lessons.givenA);
  });

  it('clears the comment of a number left out, with a line, and keeps its earlier lines', async () => {
    const row = await database.migrator
      .selectFrom('journal_comments')
      .select(['lesson_id', 'body', 'version'])
      .where('id', '=', comments.leftOut)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ lesson_id: lessons.givenA, body: null, version: 3 });
    const lines = await database.migrator
      .selectFrom('journal_comment_history')
      .select(['version', 'body_before', 'body_after', 'changed_by', 'changed_how'])
      .where('comment_id', '=', comments.leftOut)
      .orderBy('version')
      .execute();
    expect(lines).toEqual([
      expect.objectContaining({ version: 1, body_after: 'Handed in late', changed_how: 'entry' }),
      expect.objectContaining({ version: 2, body_after: 'Handed in two days late' }),
      {
        version: 3,
        body_before: 'Handed in two days late',
        body_after: null,
        changed_by: null,
        changed_how: 'homework_move',
      },
    ]);
  });

  it('gives nothing back for a cleared number left out, and moves the clear of a number that moved', async () => {
    const clears = await database.migrator
      .selectFrom('exemption_clears')
      .select(['cell_id', 'lesson_id', 'given_back_at'])
      .execute();
    expect(clears.find((one) => one.cell_id === cellsOf.exempt)).toMatchObject({
      given_back_at: new Date(NOW),
    });
    expect(clears.find((one) => one.cell_id === cellsOf.checkExempt)).toMatchObject({
      lesson_id: lessons.givenA,
      given_back_at: null,
    });
    // The exemption's end gives back only clears still open: none writes into the closed cell.
    const open = clears.filter((one) => one.given_back_at === null);
    expect(open.map((one) => one.cell_id)).toEqual([cellsOf.checkExempt]);
  });

  it('writes one audit entry for each moved work, naming the cells left out', async () => {
    const entries = await database.migrator
      .selectFrom('audit_log')
      .select(['record_id', 'old_value', 'new_value', 'actor_id', 'occurred_at'])
      .where('action', '=', 'journal.homework_move')
      .execute();
    expect(entries.length).toBe(4);
    const next = entries.find(
      (one) => (one.new_value as { workId?: string } | null)?.workId === works.next,
    );
    expect(next).toMatchObject({
      record_id: lessons.givenA,
      actor_id: null,
      occurred_at: new Date(NOW),
      old_value: { lessonId: lessons.checkA, carriedFrom: null },
    });
    const leftOut = (next?.new_value as { leftOut: { cellId: string; score: number }[] }).leftOut;
    expect(leftOut.map((one) => one.cellId).sort()).toEqual(
      [cellsOf.exempt, cellsOf.joined].sort(),
    );
    expect(leftOut.find((one) => one.cellId === cellsOf.joined)?.score).toBe(8);
    const carried = entries.find(
      (one) => (one.new_value as { workId?: string } | null)?.workId === works.carried,
    );
    expect(carried?.old_value).toEqual({ lessonId: lessons.storedC, carriedFrom: lessons.checkC });
  });

  it('leaves a carry with no source as it is, a column of its own lesson', async () => {
    const orphan = await database.migrator
      .selectFrom('journal_works')
      .select(['lesson_id', 'carried_from_lesson_id', 'version'])
      .where('id', '=', works.orphan)
      .executeTakeFirstOrThrow();
    expect(orphan).toEqual(before.orphan);
  });
});

// The refusals (the plan's database step 2; the owner's answers to questions 1 and 3 of the
// proposal: "the code move refuses to run, and reports, if it finds one"). One database each:
// the refusal names the case and writes nothing.
describe('migration 0186 refuses to move homework it may not move', () => {
  const opened: { database: TestDatabase; directory: string }[] = [];

  afterAll(async () => {
    for (const one of opened) {
      await one.database.destroy();
      await rm(one.directory, { recursive: true, force: true });
    }
  });

  /** A homework of 16 November stored at 18 November with a number, on a fresh database. */
  async function scene(
    dates: { given: string; stored: string } = {
      given: '2026-11-16',
      stored: '2026-11-18',
    },
  ) {
    const fresh = await databaseBeforeMove();
    opened.push(fresh);
    const migrator = fresh.database.migrator;
    const g = await ground(migrator, 1);
    const given = await g.cells.lesson(g.branch, g.year, g.classId, dates.given);
    const stored = await g.cells.lesson(g.branch, g.year, g.classId, dates.stored);
    const work = await storedHomework(migrator, g, { given, stored, position: 1 });
    await score(migrator, g, { lesson: stored, work, student: g.students[0] ?? '', score: 6 });
    return { ...fresh, g, given, stored, work };
  }

  /** Runs the rest of the migrations at `NOW`; answers the refusal and checks nothing moved. */
  async function refused(s: Awaited<ReturnType<typeof scene>>): Promise<string> {
    const error = await refusal(
      migrate({ connectionString: atMoment(s.database.migrationUrl, NOW), directory: MIGRATIONS }),
    );
    expect(error.message).toContain('homework_move_refused');
    const row = await s.database.migrator
      .selectFrom('journal_works')
      .select('lesson_id')
      .where('id', '=', s.work)
      .executeTakeFirstOrThrow();
    expect(row.lesson_id).toBe(s.stored);
    const applied = await sql<{
      name: string;
    }>`select name from schema_migrations where name = ${MOVE}`.execute(s.database.migrator);
    expect(applied.rows).toEqual([]);
    return error.message;
  }

  it('refuses a homework whose lesson where it was given is locked', async () => {
    const s = await scene();
    await setEditDays(s.database.migrator, s.g.branch, 3);
    // 16 November locks at 00:00 of 20 November; 18 November at 00:00 of 22 November.
    const message = await refused(s);
    expect(message).toContain(`work ${s.work} at 2026-11-16 (given): edit period ended`);
    expect(message).toContain(`work ${s.work} at 2026-11-18 (stored): edit period ended`);
  }, 240_000);

  it('refuses a homework stored at a locked lesson whose own lesson is still open', async () => {
    // Given on 8 December, stored (as a fixture of the old shape) at a lesson of 16 November,
    // which is locked at the move's moment while 8 December is not.
    const s = await scene({ given: '2026-12-08', stored: '2026-11-16' });
    await setEditDays(s.database.migrator, s.g.branch, 7);
    const message = await refused(s);
    expect(message).toContain(`work ${s.work} at 2026-11-16 (stored): edit period ended`);
    expect(message).not.toContain('(given)');
  }, 240_000);

  it('refuses a homework whose lesson where it was given is cancelled', async () => {
    const s = await scene();
    await cancel(s.database.migrator, s.given);
    const message = await refused(s);
    expect(message).toContain(`work ${s.work} at 2026-11-16 (given): cancelled`);
  }, 240_000);

  it('refuses a homework in a quarter closed and reopened', async () => {
    // Quarter 1 (to 31 October): given on 26 October, stored on 28 October, closed on its last
    // day and reopened since, so its final results are stored.
    const s = await scene({ given: '2026-10-26', stored: '2026-10-28' });
    const quarter = s.g.quarters[0] ?? '';
    await closeQuarter(s.database, {
      branchId: s.g.branch,
      quarterId: quarter,
      accountId: s.g.teacher,
    });
    await reopenQuarter(s.database, {
      branchId: s.g.branch,
      quarterId: quarter,
      journalId: null,
      accountId: s.g.teacher,
      at: '2026-12-08T10:00:00+05:00',
      days: 3,
    });
    const message = await refused(s);
    expect(message).toContain(`work ${s.work} at 2026-10-26 (given): quarter closed or closing`);
  }, 240_000);

  it('waits for a close in progress and refuses once it is closed', async () => {
    const s = await scene({ given: '2026-10-26', stored: '2026-10-28' });
    const quarter = s.g.quarters[0] ?? '';
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let heldPid = 0;
    let holding: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    // The close holds its quarter while it writes its closing row (0133).
    const close = s.database.migrator.transaction().execute(async (transaction) => {
      heldPid =
        (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(transaction)).rows[0]
          ?.pid ?? 0;
      await sql`select set_config('app.now', ${new Date('2026-10-31T18:00:00+05:00').toISOString()}, true)`.execute(
        transaction,
      );
      await sql`select 1 from quarters where id = ${quarter}::uuid for update`.execute(transaction);
      await transaction
        .insertInto('quarter_closings')
        .values({
          branch_id: s.g.branch,
          quarter_id: quarter,
          version: 1,
          closed_at: new Date('2026-10-31T18:00:00+05:00'),
          closed_by: s.g.teacher,
          lock_now: false,
          start_quarter: null,
          warnings: JSON.stringify([]),
        })
        .execute();
      holding();
      await gate;
    });
    await held;
    const run = refusal(
      migrate({ connectionString: atMoment(s.database.migrationUrl, NOW), directory: MIGRATIONS }),
    );
    for (let tries = 0; ; tries += 1) {
      const waiting = await sql<{ count: number }>`
        select count(*)::int as count from pg_stat_activity a
        where a.datname = current_database() and ${heldPid}::int = any(pg_blocking_pids(a.pid))
      `.execute(s.database.migrator);
      if ((waiting.rows[0]?.count ?? 0) > 0) break;
      if (tries > 600) throw new Error('The migration never waited for the close.');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    release();
    await close;
    const error = await run;
    expect(error.message).toContain(
      `work ${s.work} at 2026-10-26 (given): quarter closed or closing`,
    );
  }, 240_000);

  it('refuses a planned homework with no row at a locked held lesson', async () => {
    const fresh = await databaseBeforeMove();
    opened.push(fresh);
    const migrator = fresh.database.migrator;
    const g = await ground(migrator, 1);
    // The journal of the class and the kit's subject; its plan of quarter 2 is made with it (0117).
    const journal = await migrator
      .insertInto('journals')
      .values({
        branch_id: g.branch,
        academic_year_id: g.year,
        class_id: g.classId,
        group_id: null,
        subject_id: g.cells.subject,
        runs: '{[2026-09-07,)}',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await g.cells.lesson(g.branch, g.year, g.classId, '2026-11-16');
    const planWork = await asMigrator(migrator, BEFORE, async (transaction) => {
      const plan = await transaction
        .selectFrom('lesson_plan_journals')
        .select('plan_id')
        .where('journal_id', '=', journal.id)
        .where('quarter_id', '=', g.quarters[1] ?? '')
        .executeTakeFirstOrThrow();
      const item = await transaction
        .insertInto('lesson_plan_items')
        .values({ branch_id: g.branch, plan_id: plan.plan_id, topic: 'Fractions' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('lesson_plan_places')
        .values({
          branch_id: g.branch,
          plan_id: plan.plan_id,
          journal_id: journal.id,
          item_id: item.id,
          position: 1,
        })
        .execute();
      const work = await transaction
        .insertInto('lesson_plan_works')
        .values({
          branch_id: g.branch,
          item_id: item.id,
          kind: 'homework',
          position: 1,
          title: 'Page 12',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return work.id;
    });
    await setEditDays(migrator, g.branch, 7);
    const error = await refusal(
      migrate({
        connectionString: atMoment(fresh.database.migrationUrl, NOW),
        directory: MIGRATIONS,
      }),
    );
    expect(error.message).toContain(
      `planned homework ${planWork} at 2026-11-16: edit period ended`,
    );
  }, 240_000);
});
