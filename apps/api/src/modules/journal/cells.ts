import type { ErrorCode, ErrorDetail } from '@sodiq/shared';
import { ApiException } from '../../http/api-exception.js';
import type { Transaction } from '../../database/transactions.js';
import type { Audit } from '../audit/audit.service.js';

const CHECK_VIOLATION = '23514';

/** The refusals of `journal_cells_write` (0108), as error codes. */
const CELL_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  journal_cell_not_member: 'cell_closed',
  journal_cell_cancelled: 'lesson_cancelled_cell',
  // Task 8.1 (0119): the rules of a number.
  journal_cell_no_total: 'work_total_missing',
  journal_cell_above_total: 'score_above_total',
  journal_cell_not_held: 'work_not_held',
};

/** One cell to save: the attendance cell (`workId` null) or a work's cell. */
export interface CellSave {
  lessonId: string;
  studentId: string;
  workId: string | null;
  /** The mark (attendance) or the number (a work); `null` clears the cell. */
  value: number | null;
  /** The version the value was typed on; `null` for a cell that was empty and never saved. */
  version: number | null;
}

/** Who saves, for the cells and the audit entry of the call. */
export interface CellActor {
  accountId: string;
  assignmentId?: string;
  requestId?: string;
}

export interface SavedCell {
  id: string;
  lessonId: string;
  studentId: string;
  workId: string | null;
  value: number | null;
  version: number;
  changedAt: Date;
}

/** The order of the writes: by lesson, student and work, the attendance cell first. */
function compareSaves(one: CellSave, other: CellSave): number {
  return (
    one.lessonId.localeCompare(other.lessonId) ||
    one.studentId.localeCompare(other.studentId) ||
    (one.workId ?? '').localeCompare(other.workId ?? '')
  );
}

const keyOf = (save: CellSave) => `${save.lessonId}/${save.studentId}/${save.workId ?? ''}`;

/** The value of a stored row: the mark of the attendance cell, the number of a work's cell. */
const valueOf = (row: { work_id: string | null; mark: number | null; score: number | null }) =>
  row.work_id === null ? row.mark : row.score;

/**
 * Saves journal cells (task 6.1a; edge/journal, Saving and working together:
 * "Each cell has a version. A save based on an old version is refused, the
 * stored value is kept, and both values are shown for the user to choose.
 * Nothing is overwritten silently"). The database raises the version and
 * writes the history line of every change (0108); this writes one audit entry
 * per branch of the call. A refused call throws, so its transaction saves
 * nothing of it.
 *
 * The routes that call it (6.3, 8.1, 8.3a) decide who may write which cell,
 * the lesson's start and the edit period, and check every id against the
 * branch of the request first. Their input schemas stay within the database's
 * checks (a mark 0 to 3, a whole number 0 or more); a value outside them is a
 * fault of the caller and throws here.
 */
export async function saveCells(
  transaction: Transaction,
  audit: Audit,
  actor: CellActor,
  saves: readonly CellSave[],
): Promise<SavedCell[]> {
  if (saves.length === 0) return [];
  const keys = new Set(saves.map(keyOf));
  if (keys.size !== saves.length) {
    throw new Error('A call saves each cell once.');
  }
  for (const save of saves) {
    const { value } = save;
    if (
      value !== null &&
      (!Number.isInteger(value) || value < 0 || (save.workId === null && value > 3))
    ) {
      throw new Error('A mark is 0 to 3 and a number a whole number from 0.');
    }
  }
  // The lessons first, FOR SHARE in the order of the id (review must-fix 2 of
  // the plan): the cell trigger reads them, so a cancel, a date move or a
  // delete waits for the save or the save for it.
  const lessonIds = [...new Set(saves.map((save) => save.lessonId))].sort();
  const lessons = await transaction
    .selectFrom('lessons')
    .select(['id', 'branch_id'])
    .where('id', 'in', lessonIds)
    .orderBy('id')
    .forShare()
    .execute();
  const branchOf = new Map(lessons.map((lesson) => [lesson.id, lesson.branch_id]));
  if (branchOf.size !== lessonIds.length) {
    // A lesson removed meanwhile, or one this branch does not hold.
    throw new ApiException('cell_closed', 409);
  }
  const ordered = [...saves].sort(compareSaves);
  const saved: SavedCell[] = [];
  const stale: CellSave[] = [];
  try {
    for (const save of ordered) {
      const branchId = branchOf.get(save.lessonId) ?? '';
      const values = {
        mark: save.workId === null ? save.value : null,
        score: save.workId === null ? null : save.value,
        changed_by: actor.accountId,
        changed_how: 'entry',
      };
      const returning = [
        'id',
        'lesson_id',
        'student_id',
        'work_id',
        'mark',
        'score',
        'version',
        'changed_at',
      ] as const;
      let row;
      if (save.version === null) {
        // A first save with no value writes nothing.
        if (save.value === null) continue;
        row = await transaction
          .insertInto('journal_cells')
          .values({
            ...values,
            branch_id: branchId,
            lesson_id: save.lessonId,
            student_id: save.studentId,
            work_id: save.workId,
            // Overwritten by journal_cells_write.
            version: 1,
            changed_at: new Date(0),
          })
          .onConflict((conflict) =>
            conflict.columns(['branch_id', 'lesson_id', 'student_id', 'work_id']).doNothing(),
          )
          .returning(returning)
          .executeTakeFirst();
      } else {
        row = await transaction
          .updateTable('journal_cells')
          .set(values)
          .where('branch_id', '=', branchId)
          .where('lesson_id', '=', save.lessonId)
          .where('student_id', '=', save.studentId)
          .where('work_id', save.workId === null ? 'is' : '=', save.workId)
          .where('version', '=', save.version)
          .returning(returning)
          .executeTakeFirst();
      }
      if (row === undefined) {
        stale.push(save);
        continue;
      }
      saved.push({
        id: row.id,
        lessonId: row.lesson_id,
        studentId: row.student_id,
        workId: row.work_id,
        value: valueOf(row),
        version: row.version,
        changedAt: new Date(row.changed_at),
      });
    }
  } catch (error) {
    const failure = error as { code?: unknown; constraint?: unknown };
    if (
      failure.code === CHECK_VIOLATION &&
      typeof failure.constraint === 'string' &&
      Object.hasOwn(CELL_REFUSALS, failure.constraint)
    ) {
      throw new ApiException(CELL_REFUSALS[failure.constraint] ?? 'cell_closed', 409);
    }
    throw error;
  }
  if (stale.length > 0) {
    throw new ApiException(
      'cell_stale',
      409,
      undefined,
      await staleDetails(transaction, saves, stale),
    );
  }
  const byBranch = new Map<string, SavedCell[]>();
  for (const cell of saved) {
    const branchId = branchOf.get(cell.lessonId) ?? '';
    byBranch.set(branchId, [...(byBranch.get(branchId) ?? []), cell]);
  }
  for (const [branchId, cells] of byBranch) {
    await audit.record(transaction, {
      branchId,
      actorId: actor.accountId,
      ...(actor.assignmentId === undefined ? {} : { assignmentId: actor.assignmentId }),
      action: 'journal.cells_save',
      newValue: { cells: cells.map((cell) => ({ id: cell.id, version: cell.version })) },
      details: { count: cells.length },
      ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
    });
  }
  return saved;
}

/** One detail per stale save, at its place in the call, with the stored cell when there is one. */
async function staleDetails(
  transaction: Transaction,
  saves: readonly CellSave[],
  stale: readonly CellSave[],
): Promise<ErrorDetail[]> {
  const stored = await transaction
    .selectFrom('journal_cells')
    .select([
      'id',
      'lesson_id',
      'student_id',
      'work_id',
      'mark',
      'score',
      'version',
      'changed_by',
      'changed_at',
    ])
    .where(
      'lesson_id',
      'in',
      stale.map((save) => save.lessonId),
    )
    .where(
      'student_id',
      'in',
      stale.map((save) => save.studentId),
    )
    .execute();
  const byKey = new Map(
    stored.map((row) => [`${row.lesson_id}/${row.student_id}/${row.work_id ?? ''}`, row]),
  );
  const staleKeys = new Set(stale.map(keyOf));
  const details: ErrorDetail[] = [];
  saves.forEach((save, index) => {
    if (!staleKeys.has(keyOf(save))) return;
    const row = byKey.get(keyOf(save));
    details.push({
      path: `saves.${index}`,
      code: 'cell_stale',
      message: 'The cell was changed since it was read.',
      ...(row === undefined
        ? {}
        : {
            recordId: row.id,
            storedCell: {
              value: valueOf(row),
              version: row.version,
              changedBy: row.changed_by,
              changedAt: new Date(row.changed_at).toISOString(),
            },
          }),
    });
  });
  return details;
}

/**
 * How many journal cells with a value the student has that the branch sees
 * (task 6.1a, decision 13): one is enough to refuse the delete; empty cells go
 * with the student (0109), and a cell only another branch sees is refused by
 * the key all the same. Task 6.3: a reason of absence counts too, also a
 * cleared one, whose key refuses the delete as well (0113).
 */
export async function studentCellCount(
  transaction: Transaction,
  studentId: string,
): Promise<number> {
  const found = await transaction
    .selectFrom('journal_cells')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('student_id', '=', studentId)
    .where((eb) => eb.or([eb('mark', 'is not', null), eb('score', 'is not', null)]))
    .executeTakeFirstOrThrow();
  const reasons = await transaction
    .selectFrom('student_absence_reasons')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('student_id', '=', studentId)
    .executeTakeFirstOrThrow();
  return Number(found.count) + Number(reasons.count);
}
