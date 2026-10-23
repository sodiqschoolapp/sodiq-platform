import { PERSONAL_DATA_ENTRY_LIMIT, studentReportSchema, type StudentReport } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { CellsKit, workWithTotal } from '../../testing/cells-kit.js';
import { dayTemplatesKit, type DayTemplatesKit } from '../../testing/day-templates-kit.js';
import { Audit } from '../audit/audit.service.js';
import { saveCells, type CellSave } from '../journal/cells.js';

/** The clock of every request (the sessions are signed in at it). */
const NOW = '2026-11-02T12:00:00+05:00';

// The student's marks and attendance in the personal data report (task 6.1c,
// pull request #209, decision 10; edge-cases/people-roles-accounts, Personal
// data and the audit log: "A parent asks for a copy of everything held about
// their child ... The Super Admin can produce a personal data report per
// person"). The Super Admin is the one reader of the route (2.6b, decision 3);
// every case reads as the Super Admin (correction 3). A file of its own: its
// lessons date the quarters of the year (`.claude/rules/database.md`). All
// names are invented.
describe('the marks and attendance of the student report', () => {
  let t: DayTemplatesKit;
  let cells: CellsKit;
  let year: string;
  let classId: string;
  let teacher: string;

  const save = (branch: string, saves: readonly CellSave[], at: string, accountId = teacher) => {
    t.clock.set(at);
    return t.app
      .get(Transactions)
      .run([branch], (transaction) =>
        saveCells(transaction, t.app.get(Audit), { accountId }, saves),
      )
      .finally(() => {
        t.clock.set(NOW);
      });
  };

  const version = async (lessonId: string, studentId: string, workId: string | null) =>
    (
      await t.database.migrator
        .selectFrom('journal_cells')
        .select('version')
        .where('lesson_id', '=', lessonId)
        .where('student_id', '=', studentId)
        .where((eb) => (workId === null ? eb('work_id', 'is', null) : eb('work_id', '=', workId)))
        .executeTakeFirst()
    )?.version ?? null;

  /** The report as the Super Admin produces it in the branch. */
  async function report(studentId: string, branch = t.north): Promise<StudentReport> {
    const response: Response = await t.post(`/api/people/students/${studentId}/report`, branch);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return studentReportSchema.parse(response.body);
  }

  beforeAll(async () => {
    t = await dayTemplatesKit({ start: NOW });
    cells = await CellsKit.create(t.database.migrator);
    year = await cells.lessons.load.classes.year(t.north);
    classId = await cells.lessons.load.classes.schoolClass(t.north, year, { grade: 7 });
    teacher = (
      await cells.lessons.load.classes.person(t.north, ['uz'], {
        first: 'Malika',
        last: 'Usmonova',
      })
    ).accountId;
  });

  afterAll(async () => {
    await t.close();
  });

  it('holds the cells with a value and every line of the student, also of a cell now empty', async () => {
    const [pupil, other] = await cells.lessons.pupils(t.north, classId, 2);
    const studentId = pupil ?? '';
    const lesson = await cells.lesson(t.north, year, classId, '2026-10-12');
    const later = await cells.lesson(t.north, year, classId, '2026-10-13');
    // Made last, dated first: the cells come by lesson start, not by id.
    const earlier = await cells.lesson(t.north, year, classId, '2026-10-11');
    const work = await workWithTotal(t.database.migrator, {
      branchId: t.north,
      lessonId: lesson,
      total: 40,
    });
    await save(
      t.north,
      [
        { lessonId: lesson, studentId, workId: null, value: 1, version: null },
        { lessonId: lesson, studentId, workId: work, value: 35, version: null },
        { lessonId: later, studentId, workId: null, value: 2, version: null },
        { lessonId: earlier, studentId, workId: null, value: 3, version: null },
        { lessonId: lesson, studentId: other ?? '', workId: null, value: 3, version: null },
      ],
      '2026-10-12T10:00:00+05:00',
    );
    // The mark of the later lesson is cleared: no cell with a value, two lines.
    await save(
      t.north,
      [
        {
          lessonId: later,
          studentId,
          workId: null,
          value: null,
          version: await version(later, studentId, null),
        },
      ],
      '2026-10-13T10:00:00+05:00',
    );
    const { journal } = await report(studentId);
    expect(
      journal.cells.map((cell) => ({
        attendance: cell.attendance,
        workKind: cell.workKind,
        total: cell.total,
        value: cell.value,
        version: cell.version,
        how: cell.changedHow,
        by: cell.changedBy.name,
        date: cell.lesson?.date,
        branch: cell.branch,
      })),
    ).toEqual([
      {
        attendance: true,
        workKind: null,
        total: null,
        value: 3,
        version: 1,
        how: 'entry',
        by: 'Usmonova Malika',
        date: '2026-10-11',
        branch: 'North',
      },
      {
        attendance: true,
        workKind: null,
        total: null,
        value: 1,
        version: 1,
        how: 'entry',
        by: 'Usmonova Malika',
        date: '2026-10-12',
        branch: 'North',
      },
      {
        attendance: false,
        workKind: 'classwork',
        total: 40,
        value: 35,
        version: 1,
        how: 'entry',
        by: 'Usmonova Malika',
        date: '2026-10-12',
        branch: 'North',
      },
    ]);
    const ofLater = journal.history.filter((line) => line.lesson?.date === '2026-10-13');
    expect(ofLater.map((line) => [line.before, line.after])).toEqual([
      [2, null],
      [null, 2],
    ]);
    expect(journal.history).toHaveLength(5);
    expect(journal.historyLeftOut).toBeNull();
    // Newest first, by moment then id.
    expect(journal.history.map((line) => line.changedAt)).toEqual(
      [...journal.history.map((line) => line.changedAt)].sort().reverse(),
    );
    // Another student's cells are not in it.
    const theirs = await report(other ?? '');
    expect(theirs.journal.cells.map((cell) => cell.value)).toEqual([3]);
    // The export entry counts the cells and lines, not their values.
    const [entry] = await t.entries('student.personal_data_report', studentId);
    expect(entry?.details).toMatchObject({ cells: 3, cellLines: 5, cellLinesLeftOut: 0 });
    expect(JSON.stringify(entry?.details)).not.toContain('35');
  });

  // Decision 10: a cancelled lesson's cells are shown with the cancel.
  // Task 8.1 (From 6.1c, decision 13): the total and "not held" lines of the works in
  // which the student has a cell, and of no other work.
  it('holds the total and "not held" lines of the works the student has a cell in', async () => {
    const [pupil] = await cells.lessons.pupils(t.north, classId, 1);
    const studentId = pupil ?? '';
    const lesson = await cells.lesson(t.north, year, classId, '2026-10-19');
    const own = await workWithTotal(t.database.migrator, {
      branchId: t.north,
      lessonId: lesson,
      total: 10,
    });
    const other = await workWithTotal(t.database.migrator, {
      branchId: t.north,
      lessonId: lesson,
      total: 10,
    });
    await save(
      t.north,
      [{ lessonId: lesson, studentId, workId: own, value: 7, version: null }],
      '2026-10-19T10:00:00+05:00',
    );
    t.clock.set('2026-10-19T11:00:00+05:00');
    await t.app.get(Transactions).run([t.north], async (transaction) => {
      await t.app.get(Audit).record(transaction, {
        branchId: t.north,
        actorId: teacher,
        action: 'journal.work_total',
      });
      for (const id of [own, other]) {
        await transaction
          .updateTable('journal_works')
          .set({ total: 20, changed_by: teacher })
          .where('id', '=', id)
          .execute();
      }
    });
    t.clock.set(NOW);
    const found = await report(studentId);
    expect(
      found.journal.workHistory.map((line) => [line.workId, line.totalBefore, line.totalAfter]),
    ).toEqual([[own, 10, 20]]);
    expect(found.journal.workHistory[0]?.changedBy?.accountId).toBe(teacher);
  });

  it('shows the cells of a cancelled lesson as cancelled', async () => {
    const [pupil] = await cells.lessons.pupils(t.north, classId, 1);
    const studentId = pupil ?? '';
    const lesson = await cells.lesson(t.north, year, classId, '2026-10-16');
    await save(
      t.north,
      [{ lessonId: lesson, studentId, workId: null, value: 1, version: null }],
      '2026-10-16T10:00:00+05:00',
    );
    await t.database.migrator
      .updateTable('lessons')
      .set({ cancel_cause: 'reason', cancel_reason: 'School trip' })
      .where('id', '=', lesson)
      .execute();
    const { journal } = await report(studentId);
    expect(journal.cells.map((cell) => [cell.value, cell.lesson?.cancelled])).toEqual([[1, true]]);
  });

  it('holds the cells of a branch the student has left', async () => {
    const [pupil] = await cells.lessons.pupils(t.north, classId, 1);
    const studentId = pupil ?? '';
    const lesson = await cells.lesson(t.north, year, classId, '2026-10-14');
    await save(
      t.north,
      [{ lessonId: lesson, studentId, workId: null, value: 2, version: null }],
      '2026-10-14T10:00:00+05:00',
    );
    // The record changes branch, as a branch move writes it (3.3c).
    // In a transaction of the application for both branches, at the clock's
    // moment, as the release and the accept write it.
    await t.app.get(Transactions).run([t.north, t.south], async (transaction) => {
      const move = await transaction
        .insertInto('student_branch_moves')
        .values({
          branch_id: t.north,
          student_id: studentId,
          from_branch_id: t.north,
          to_branch_id: t.south,
          effective_on: '2026-10-20',
          released_at: new Date(NOW),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('student_branch_moves')
        .set({ accepted_at: new Date(NOW) })
        .where('id', '=', move.id)
        .execute();
      await transaction
        .updateTable('class_memberships')
        .set({
          valid_until: '2026-10-20',
          ended_by: 'branch_move',
          ended_by_branch_move_id: move.id,
        })
        .where('student_id', '=', studentId)
        .execute();
      await transaction
        .updateTable('students')
        .set({ branch_id: t.south })
        .where('id', '=', studentId)
        .execute();
    });
    const { journal } = await report(studentId, t.south);
    expect(journal.cells.map((cell) => [cell.branch, cell.value])).toEqual([['North', 2]]);
    expect(journal.history.map((line) => line.branch)).toEqual(['North']);
  });

  it('holds at most the limit of lines, newest first, with the count and the oldest moment of the rest', async () => {
    const [pupil] = await cells.lessons.pupils(t.north, classId, 1);
    const studentId = pupil ?? '';
    const lesson = await cells.lesson(t.north, year, classId, '2026-10-15');
    await save(
      t.north,
      [{ lessonId: lesson, studentId, workId: null, value: 1, version: null }],
      '2026-10-15T10:00:00+05:00',
    );
    // ${PERSONAL_DATA_ENTRY_LIMIT} more changes of the cell, one a minute after the
    // save, each writing its history line through the trigger (0108).
    const cell = (
      await t.database.migrator
        .selectFrom('journal_cells')
        .select('id')
        .where('lesson_id', '=', lesson)
        .where('student_id', '=', studentId)
        .executeTakeFirstOrThrow()
    ).id;
    await sql`
      do $$
      begin
        for n in 1..${sql.raw(String(PERSONAL_DATA_ENTRY_LIMIT))} loop
          perform set_config(
            'app.now',
            (timestamptz '2026-10-15T10:00:00+05:00' + make_interval(mins => n))::text,
            true
          );
          update journal_cells set mark = 2 - (n % 2) where id = ${sql.lit(cell)};
        end loop;
      end
      $$
    `.execute(t.database.migrator);
    const { journal } = await report(studentId);
    expect(journal.history).toHaveLength(PERSONAL_DATA_ENTRY_LIMIT);
    const start = new Date('2026-10-15T10:00:00+05:00').getTime();
    expect(journal.history[0]?.changedAt).toBe(
      new Date(start + PERSONAL_DATA_ENTRY_LIMIT * 60_000).toISOString(),
    );
    expect(journal.historyLeftOut).toEqual({ count: 1, oldestAt: new Date(start).toISOString() });
  });
});
