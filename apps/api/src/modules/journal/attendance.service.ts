import { Inject, Injectable } from '@nestjs/common';
import {
  attendanceMarkSchema,
  compareStudentNames,
  type AllPresent,
  type AttendanceSave,
  type AttendanceSaved,
  type CellHistory,
  type ErrorDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { RequestKeys } from '../../database/request-keys.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { enterableLesson, entryAssignment, type EntryLesson } from './attendance-entry.js';
import { cellChange, lineValues, namedAccounts } from './cell-lines.query.js';
import { saveCells, type CellSave } from './cells.js';
import { cellsAsSaved, storedCells } from './saved-cells.js';
import { refuseOtherStudents } from './students-of-branch.js';
import { workLines, withoutBranch } from './work-lines.query.js';
import { JournalGridReader } from './journal-grid.service.js';

/**
 * "Keep or clear" (task 8.1, decision 15; `edge/journal`: "A mark change
 * never deletes numbers. Changing present to absent with numbers asks 'keep
 * or clear', keeping by default; cleared values stay in history"): a save
 * that changes a 1 or 2 to a 0 or 3 for a student with numbers in the lesson
 * names `numbers`; without it the save is refused with those students listed.
 * A `numbers` on any other save is refused, never dropped. Gives the cells
 * that `clear` empties, saved with the marks.
 */
async function keepOrClear(
  transaction: Transaction,
  lessonId: string,
  input: AttendanceSave,
): Promise<CellSave[]> {
  const ids = input.saves.map((save) => save.studentId.toLowerCase());
  const marks = await transaction
    .selectFrom('journal_cells')
    .select(['student_id', 'mark', 'version'])
    .where('lesson_id', '=', lessonId)
    .where('work_id', 'is', null)
    .where('student_id', 'in', ids)
    .execute();
  const numbers = await transaction
    .selectFrom('journal_cells')
    .select(['student_id', 'work_id', 'version'])
    .where('lesson_id', '=', lessonId)
    .where('work_id', 'is not', null)
    .where('score', 'is not', null)
    .where('student_id', 'in', ids)
    .orderBy('work_id')
    .execute();
  const markOf = new Map(marks.map((row) => [row.student_id, row]));
  const missing: ErrorDetail[] = [];
  const clears: CellSave[] = [];
  input.saves.forEach((save, index) => {
    const studentId = save.studentId.toLowerCase();
    const stored = markOf.get(studentId);
    const before = stored?.mark ?? null;
    const own = numbers.filter((row) => row.student_id === studentId);
    // Task 8.3a: a save on an old version is stale whatever it changes; `saveCells`
    // refuses it with both values, and the question comes after the choice.
    const current = (stored?.version ?? null) === save.version;
    const asks =
      current &&
      (before === 1 || before === 2) &&
      (save.mark === 0 || save.mark === 3) &&
      own.length > 0;
    if (!asks) {
      // A stale save is left to `saveCells`, which refuses it with both values.
      if (save.numbers !== undefined && current) {
        throw new ApiException('validation_failed', 400, undefined, [
          {
            path: `saves.${String(index)}.numbers`,
            code: 'unexpected',
            message:
              'Only a change from present or late to absent or skipped with numbers keeps or clears them.',
          },
        ]);
      }
      return;
    }
    if (save.numbers === undefined) {
      missing.push({
        path: `saves.${String(index)}`,
        code: 'numbers_keep_or_clear',
        message: 'Keep or clear the numbers.',
        recordId: studentId,
      });
    } else if (save.numbers === 'clear') {
      for (const row of own) {
        clears.push({
          lessonId,
          studentId,
          workId: row.work_id,
          value: null,
          version: row.version,
        });
      }
    }
  });
  if (missing.length > 0) {
    throw new ApiException('numbers_keep_or_clear', 409, undefined, missing);
  }
  return clears;
}

/** The students in the order of the grid (`compareStudentNames`, 6.2 decision 15). */
async function inGridOrder<T extends { studentId: string }>(
  transaction: Transaction,
  rows: readonly T[],
): Promise<T[]> {
  if (rows.length === 0) return [];
  const students = await transaction
    .selectFrom('students')
    .select(['id', 'first_name', 'last_name', 'paternal_name', 'uid'])
    .where(
      'id',
      'in',
      rows.map((row) => row.studentId),
    )
    .execute();
  const byId = new Map(
    students.map((one) => [
      one.id,
      {
        firstName: one.first_name,
        lastName: one.last_name,
        paternalName: one.paternal_name,
        uid: one.uid,
      },
    ]),
  );
  return [...rows].sort((one, other) => {
    const a = byId.get(one.studentId);
    const b = byId.get(other.studentId);
    if (a === undefined || b === undefined) return one.studentId.localeCompare(other.studentId);
    return compareStudentNames(a, b);
  });
}

/**
 * The students among `ids` with a 1, 2 or 3 in a lesson of the branch that
 * started earlier the same school date and is not cancelled (decision 9:
 * each of those marks means at school).
 */
async function presentEarlierOf(
  transaction: Transaction,
  lesson: EntryLesson,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await transaction
    .selectFrom('journal_cells')
    .innerJoin('lessons', 'lessons.id', 'journal_cells.lesson_id')
    .select('journal_cells.student_id')
    .distinct()
    .where('journal_cells.student_id', 'in', [...ids])
    .where('journal_cells.work_id', 'is', null)
    .where('journal_cells.mark', 'in', [1, 2, 3])
    .where('lessons.lesson_date', '=', lesson.date)
    .where('lessons.starts_at', '<', lesson.startsAt)
    .where('lessons.cancel_cause', 'is', null)
    .execute();
  const found = new Set(rows.map((row) => row.student_id));
  return ids.filter((id) => found.has(id));
}

/**
 * Attendance entry (task 6.3, pull request #211; `07`, Entering data;
 * `edge/journal`, Entering, Saving and working together): the typed marks of
 * a lesson through `saveCells` (6.1a, decision 2), "all present" in one
 * request (decision 4), and the history of a student's cells in a lesson
 * (decision 16). Who enters is decided in `attendance-entry.ts`.
 */
@Injectable()
export class AttendanceService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(JournalGridReader) private readonly grids: JournalGridReader,
    @Inject(RequestKeys) private readonly requestKeys: RequestKeys,
  ) {}

  /**
   * Task 8.3a: the save is repeat-safe (`edge/journal`: "The same entry sent
   * twice is counted once"). Who enters and the students are checked on every
   * request, before the key (`.claude/rules/api.md`); a repeat answers the
   * cells as the first request saved them, from their history lines.
   */
  save(
    access: Access,
    lessonId: string,
    input: AttendanceSave,
    key: string,
    requestId: string | undefined,
  ): Promise<AttendanceSaved> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { lesson } = await enterableLesson(transaction, access, branchId, lessonId);
      await refuseOtherStudents(
        transaction,
        input.saves.map((save) => save.studentId),
      );
      const once = await this.requestKeys.runOnce(
        transaction,
        {
          key,
          scope: 'journal.attendance',
          accountId: access.accountId,
          input: { lessonId: lesson.id, ...input },
        },
        async () => {
          const saved = await this.write(transaction, access, lesson.id, input, requestId);
          const marks = saved.filter((cell) => cell.workId === null);
          const zeros = marks.filter((cell) => cell.value === 0).map((cell) => cell.studentId);
          return {
            cells: storedCells(saved),
            presentEarlier: await presentEarlierOf(transaction, lesson, zeros),
          };
        },
      );
      const saved = await cellsAsSaved(transaction, once.result.cells);
      const cells = await inGridOrder(
        transaction,
        saved
          .filter((cell) => cell.workId === null)
          .map((cell) => ({
            studentId: cell.studentId,
            mark: cell.value === null ? null : attendanceMarkSchema.parse(cell.value),
            version: cell.version,
          })),
      );
      const cleared = saved.flatMap((cell) =>
        cell.workId === null
          ? []
          : [{ studentId: cell.studentId, workId: cell.workId, version: cell.version }],
      );
      return { cells, cleared, presentEarlier: once.result.presentEarlier };
    });
  }

  /** The typed marks and the numbers keep-or-clear clears, in one `saveCells` call. */
  private async write(
    transaction: Transaction,
    access: Access,
    lessonId: string,
    input: AttendanceSave,
    requestId: string | undefined,
  ) {
    const clears = await keepOrClear(transaction, lessonId, input);
    return saveCells(
      transaction,
      this.audit,
      {
        accountId: access.accountId,
        assignmentId: entryAssignment(access),
        ...(requestId === undefined ? {} : { requestId }),
      },
      [
        ...input.saves.map((save) => ({
          lessonId,
          studentId: save.studentId.toLowerCase(),
          workId: null,
          value: save.mark,
          version: save.version,
        })),
        ...clears,
      ],
    );
  }

  /**
   * "All present" (decision 4; `07`: "marks 1 for every student who is not
   * yet marked and not exempt"; `edge/journal`: "fill only the cells that are
   * empty at that moment and report the ones they skipped. They are one
   * action"): one audit entry, one history line per cell by the trigger of
   * 0108. A cell written meanwhile is skipped, never overwritten.
   */
  allPresent(access: Access, lessonId: string, requestId: string | undefined): Promise<AllPresent> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { lesson } = await enterableLesson(transaction, access, branchId, lessonId);
      const expected = await sql<{ student_id: string }>`
        select s as student_id from lesson_expected_students(${lesson.id}::uuid) s order by s
      `.execute(transaction);
      const students = expected.rows.map((row) => row.student_id);
      const filled: { studentId: string; version: number; cellId: string }[] = [];
      if (students.length > 0) {
        // A cell never saved: inserted; a row that exists is left to the update.
        const inserted = await transaction
          .insertInto('journal_cells')
          .values(
            students.map((studentId) => ({
              branch_id: branchId,
              lesson_id: lesson.id,
              student_id: studentId,
              work_id: null,
              mark: 1,
              changed_by: access.accountId,
              changed_how: 'entry',
              // Overwritten by journal_cells_write.
              version: 1,
              changed_at: new Date(0),
            })),
          )
          .onConflict((conflict) =>
            conflict.columns(['branch_id', 'lesson_id', 'student_id', 'work_id']).doNothing(),
          )
          .returning(['id', 'student_id', 'version'])
          .execute();
        // A cleared cell (a row whose mark is null).
        const updated = await transaction
          .updateTable('journal_cells')
          .set({ mark: 1, changed_by: access.accountId, changed_how: 'entry' })
          .where('lesson_id', '=', lesson.id)
          .where('work_id', 'is', null)
          .where('mark', 'is', null)
          .where('student_id', 'in', students)
          .returning(['id', 'student_id', 'version'])
          .execute();
        for (const row of [...inserted, ...updated]) {
          filled.push({ studentId: row.student_id, version: row.version, cellId: row.id });
        }
      }
      const filledIds = new Set(filled.map((one) => one.studentId));
      const stored = await transaction
        .selectFrom('journal_cells')
        .select(['student_id', 'mark'])
        .where('lesson_id', '=', lesson.id)
        .where('work_id', 'is', null)
        .where('mark', 'is not', null)
        .execute();
      const skipped = stored.flatMap((row) =>
        filledIds.has(row.student_id) || row.mark === null || !students.includes(row.student_id)
          ? []
          : [{ studentId: row.student_id, mark: attendanceMarkSchema.parse(row.mark) }],
      );
      // Never in the order of `returning` (`.claude/rules/database.md`).
      const filledSorted = await inGridOrder(transaction, filled);
      const skippedSorted = await inGridOrder(transaction, skipped);
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: entryAssignment(access),
        action: 'journal.all_present',
        record: { type: 'lesson', id: lesson.id },
        newValue: {
          filled: filledSorted.map((one) => ({ id: one.cellId, version: one.version })),
          skipped: skippedSorted.map((one) => one.studentId),
        },
        details: { filled: filledSorted.length, skipped: skippedSorted.length },
        ...(requestId === undefined ? {} : { requestId }),
      });
      return {
        filled: filledSorted.map((one) => ({ studentId: one.studentId, version: one.version })),
        skipped: skippedSorted,
      };
    });
  }

  /**
   * The history of a student's cells in a lesson (decision 16; `07`: "Every
   * cell keeps its history: old value, new value, who and when. It opens from
   * the cell"), for a reader whose grid shows that lesson and that student,
   * and only the cells that grid shows (review correction 3).
   */
  history(access: Access, lessonId: string, studentId: string): Promise<CellHistory> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const lesson = await transaction
        .selectFrom('lessons')
        .select(['id'])
        .where('id', '=', lessonId)
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      if (lesson === undefined) throw notFound();
      const student = await transaction
        .selectFrom('students')
        .select('id')
        .where('id', '=', studentId)
        .executeTakeFirst();
      if (student === undefined) throw notFound();
      const shape = await this.grids.cellShapeIn(
        transaction,
        access,
        branchId,
        lesson.id,
        student.id,
      );
      if (shape === null) throw new ApiException('journal_scope', 403);
      let query = transaction
        .selectFrom('journal_cell_history')
        .leftJoin('journal_works', 'journal_works.id', 'journal_cell_history.work_id')
        .select([
          'journal_cell_history.work_id',
          'journal_works.kind',
          'journal_cell_history.version',
          'journal_cell_history.mark_before',
          'journal_cell_history.mark_after',
          'journal_cell_history.score_before',
          'journal_cell_history.score_after',
          'journal_cell_history.changed_by',
          'journal_cell_history.changed_how',
          'journal_cell_history.changed_at',
        ])
        .where('journal_cell_history.lesson_id', '=', lesson.id)
        .where('journal_cell_history.student_id', '=', student.id);
      if (shape === 'attendance') query = query.where('journal_cell_history.work_id', 'is', null);
      const rows = await query
        .orderBy('journal_cell_history.changed_at')
        .orderBy('journal_cell_history.work_id', (order) => order.nullsFirst())
        .orderBy('journal_cell_history.version')
        .execute();
      const names = await namedAccounts(
        transaction,
        rows.map((row) => row.changed_by),
      );
      // Task 8.1 (From 6.3 decision 16): the total and "not held" lines of the lesson's works.
      const workIds =
        shape === 'attendance'
          ? []
          : (
              await transaction
                .selectFrom('journal_work_history')
                .select('work_id')
                .distinct()
                .where('lesson_id', '=', lesson.id)
                .execute()
            ).map((row) => row.work_id);
      const works = (await workLines(transaction, { workIds })).filter(
        (line) => line.totalBefore !== line.totalAfter || line.notHeldBefore !== line.notHeldAfter,
      );
      return {
        workLines: works.map(withoutBranch),
        lines: rows.map((row) => ({
          work:
            row.work_id === null
              ? null
              : { id: row.work_id, kind: row.kind === 'homework' ? 'homework' : 'classwork' },
          version: row.version,
          ...lineValues(row),
          changedBy: names.get(row.changed_by) ?? {
            accountId: row.changed_by,
            login: null,
            name: null,
          },
          changedHow: cellChange(row.changed_how),
          changedAt: new Date(row.changed_at).toISOString(),
        })),
      };
    });
  }
}
