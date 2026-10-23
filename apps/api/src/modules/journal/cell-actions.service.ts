import { Inject, Injectable } from '@nestjs/common';
import {
  attendanceMarkSchema,
  type AttendanceCopy,
  type ErrorCode,
  type Undo,
  type Undone,
  undoCellsOf,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { enterableLesson, entryAssignment } from './attendance-entry.js';
import { CELL_REFUSALS, saveCells } from './cells.js';
import { firstsOfDoubles } from './doubles.query.js';
import { refuseOtherStudents } from './students-of-branch.js';
import { WorksService } from './works.service.js';

const CHECK_VIOLATION = '23514';

/** The refusals of a restore that skip its cell (decision 3 with review correction 3). */
const UNDO_SKIPPED = new Set<ErrorCode>([
  'cell_closed',
  'score_above_total',
  'work_total_missing',
  'work_not_held',
]);

type UndoSkip = Undone['skipped'][number]['code'];

const isUndoSkip = (code: ErrorCode): code is Exclude<UndoSkip, 'changed'> =>
  UNDO_SKIPPED.has(code);

/**
 * Undo and "copy attendance" (task 8.3a; `edge/journal`, Saving and working
 * together, "Undo": "It covers the user's own last action on the page: one
 * cell or one bulk action. It applies only to cells nobody changed since and
 * only while the lesson is editable. It is recorded in history"; From 6.3,
 * review correction 4: "The copy fills only the empty attendance cells of the
 * second lesson of the pair from the first and reports the ones it skipped").
 */
@Injectable()
export class CellActionsService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(WorksService) private readonly works: WorksService,
  ) {}

  /**
   * Undoes the person's own last action on the cells named: each cell whose
   * stored version is the one sent and whose line of that version is the
   * person's own entry gets the line's value before, with `changed_how`
   * `undo`. A cell changed since is skipped (`changed`); a restore the
   * database refuses now is skipped with its code, under a savepoint (review
   * correction 3). One audit entry for the call.
   */
  undo(
    access: Access,
    lessonId: string,
    input: Undo,
    requestId: string | undefined,
  ): Promise<Undone> {
    const branchId = branchOf(access);
    const cells = undoCellsOf(input);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { lesson } = await enterableLesson(transaction, access, branchId, lessonId);
      await refuseOtherStudents(
        transaction,
        cells.map((cell) => cell.studentId),
      );
      const workIds = [
        ...new Set(
          cells.flatMap((cell) => (cell.workId === null ? [] : [cell.workId.toLowerCase()])),
        ),
      ];
      if (workIds.length > 0) {
        const found = await transaction
          .selectFrom('journal_works')
          .select('id')
          .where('id', 'in', workIds)
          .execute();
        if (found.length !== workIds.length) throw notFound();
        await this.works.refuseWorksEntry(transaction, access, lesson.id);
      }
      const keyOf = (studentId: string, workId: string | null) =>
        `${studentId.toLowerCase()}/${workId?.toLowerCase() ?? ''}`;
      // The cells FOR UPDATE in the order of their id, then checked: a save
      // made meanwhile waits for the undo or the undo for it (review must-fix 3).
      const rows = await transaction
        .selectFrom('journal_cells')
        .select(['id', 'student_id', 'work_id', 'version', 'mark', 'score'])
        .where('lesson_id', '=', lesson.id)
        .where(
          'student_id',
          'in',
          cells.map((cell) => cell.studentId.toLowerCase()),
        )
        .orderBy('id')
        .forUpdate()
        .execute();
      const rowOf = new Map(rows.map((row) => [keyOf(row.student_id, row.work_id), row]));
      const candidates = cells.flatMap((cell) => {
        const row = rowOf.get(keyOf(cell.studentId, cell.workId));
        return row !== undefined && row.version === cell.version ? [{ cell, row }] : [];
      });
      const lines =
        candidates.length === 0
          ? []
          : await transaction
              .selectFrom('journal_cell_history')
              .select([
                'cell_id',
                'version',
                'changed_by',
                'changed_how',
                'mark_before',
                'score_before',
              ])
              .where(
                'cell_id',
                'in',
                candidates.map((one) => one.row.id),
              )
              .execute();
      const lineOf = new Map(
        lines.map((line) => [`${line.cell_id}/${String(line.version)}`, line]),
      );
      const undone: (Undone['undone'][number] & { cellId: string })[] = [];
      const skipped: Undone['skipped'] = [];
      const undoable = new Set<string>();
      for (const { cell, row } of candidates) {
        const line = lineOf.get(`${row.id}/${String(row.version)}`);
        if (line?.changed_by === access.accountId && line.changed_how === 'entry') {
          undoable.add(keyOf(cell.studentId, cell.workId));
          const before = row.work_id === null ? line.mark_before : line.score_before;
          await sql`savepoint cell_undo`.execute(transaction);
          try {
            const written = await transaction
              .updateTable('journal_cells')
              .set({
                ...(row.work_id === null ? { mark: before } : { score: before }),
                changed_by: access.accountId,
                changed_how: 'undo',
              })
              .where('id', '=', row.id)
              .returning(['id', 'version'])
              .executeTakeFirstOrThrow();
            await sql`release savepoint cell_undo`.execute(transaction);
            undone.push({
              studentId: row.student_id,
              workId: row.work_id,
              version: written.version,
              cellId: written.id,
            });
          } catch (error) {
            await sql`rollback to savepoint cell_undo`.execute(transaction);
            const failure = error as { code?: unknown; constraint?: unknown };
            const code =
              failure.code === CHECK_VIOLATION && typeof failure.constraint === 'string'
                ? CELL_REFUSALS[failure.constraint]
                : undefined;
            if (code === undefined || !isUndoSkip(code)) throw error;
            skipped.push({ studentId: row.student_id, workId: row.work_id, code });
          }
        }
      }
      for (const cell of cells) {
        if (!undoable.has(keyOf(cell.studentId, cell.workId))) {
          skipped.push({
            studentId: cell.studentId.toLowerCase(),
            workId: cell.workId?.toLowerCase() ?? null,
            code: 'changed',
          });
        }
      }
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: entryAssignment(access),
        action: 'journal.cells_undo',
        record: { type: 'lesson', id: lesson.id },
        newValue: {
          cells: undone.map((one) => ({ id: one.cellId, version: one.version })),
        },
        details: { undone: undone.length, skipped: skipped.length },
        ...(requestId === undefined ? {} : { requestId }),
      });
      return {
        undone: undone.map((one) => ({
          studentId: one.studentId,
          workId: one.workId,
          version: one.version,
        })),
        skipped,
      };
    });
  }

  /**
   * "Copy attendance" into the second lesson of a double (`edge/timetable`,
   * Double lessons): the empty attendance cells of its expected students take
   * the marks of the first lesson; a cell with a mark, and a student with no
   * mark in the first lesson, are skipped and reported. One audit entry
   * `journal.attendance_copy` in place of `journal.cells_save`.
   */
  copyAttendance(
    access: Access,
    lessonId: string,
    requestId: string | undefined,
  ): Promise<AttendanceCopy> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { lesson } = await enterableLesson(transaction, access, branchId, lessonId);
      const first = (await firstsOfDoubles(transaction, [lesson.id])).get(lesson.id) ?? null;
      if (first === null) throw new ApiException('lesson_not_double', 409);
      // The first lesson FOR SHARE too (decision 2): a cancel of it waits for the copy.
      const held = await transaction
        .selectFrom('lessons')
        .select(['id', 'cancel_cause'])
        .where('id', '=', first)
        .forShare()
        .executeTakeFirstOrThrow();
      if (held.cancel_cause !== null) throw new ApiException('lesson_copy_cancelled', 409);
      const expected = await sql<{ student_id: string }>`
        select s as student_id from lesson_expected_students(${lesson.id}::uuid) s order by s
      `.execute(transaction);
      const students = expected.rows.map((row) => row.student_id);
      if (students.length === 0) return { filled: [], skipped: [] };
      const cells = await transaction
        .selectFrom('journal_cells')
        .select(['lesson_id', 'student_id', 'mark', 'version'])
        .where('lesson_id', 'in', [first, lesson.id])
        .where('work_id', 'is', null)
        .where('student_id', 'in', students)
        .execute();
      const fromFirst = new Map(
        cells
          .filter((cell) => cell.lesson_id === first && cell.mark !== null)
          .map((cell) => [cell.student_id, cell.mark]),
      );
      const own = new Map(
        cells.filter((cell) => cell.lesson_id === lesson.id).map((cell) => [cell.student_id, cell]),
      );
      const skipped: AttendanceCopy['skipped'] = [];
      const saves = students.flatMap((studentId) => {
        const mine = own.get(studentId);
        const mark = fromFirst.get(studentId) ?? null;
        if ((mine?.mark ?? null) !== null) {
          skipped.push({
            studentId,
            mark: mine?.mark === undefined ? null : attendanceMarkSchema.parse(mine.mark),
          });
          return [];
        }
        if (mark === null) {
          skipped.push({ studentId, mark: null });
          return [];
        }
        return [
          {
            lessonId: lesson.id,
            studentId,
            workId: null,
            value: mark,
            version: mine?.version ?? null,
          },
        ];
      });
      const saved = await saveCells(
        transaction,
        this.audit,
        {
          accountId: access.accountId,
          assignmentId: entryAssignment(access),
          ...(requestId === undefined ? {} : { requestId }),
        },
        saves,
        { how: 'entry', action: 'journal.attendance_copy', lessonId: lesson.id },
      );
      return {
        filled: saved.map((cell) => ({ studentId: cell.studentId, version: cell.version })),
        skipped,
      };
    });
  }
}
