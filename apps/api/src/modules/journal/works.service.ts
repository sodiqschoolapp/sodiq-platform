import { Inject, Injectable } from '@nestjs/common';
import { shownPercent } from '@sodiq/calc';
import {
  LESSON_WORKS_MAX,
  type ErrorDetail,
  type ScoresSave,
  type ScoresSaved,
  type WorkAdd,
  type WorkCarry,
  type WorkColumn,
  type WorkSaved,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { ownerOn } from '../timetable/journal-owners.js';
import {
  enterableLesson,
  entryAssignment,
  journalFactsOf,
  type EntryLesson,
} from './attendance-entry.js';
import { saveCells } from './cells.js';
import { journalRows, type JournalRow } from './journal-grid.query.js';
import { journalColumns, type JournalColumns } from './journal-works.query.js';
import { columnAt, type Column } from './lesson-columns.js';
import { refuseOtherStudents } from './students-of-branch.js';

/**
 * Classwork and homework (task 8.1, pull request #217; `07`, Entering data,
 * The total; `edge/journal`, Entering): works added by hand, the total, "not
 * held", the carry of a homework and the numbers. Every route decides the
 * lesson as attendance entry does (`enterableLesson`: 404, 403
 * `journal_entry_scope`, then the lesson's state), then refuses a lesson that
 * takes attendance only, then checks the column against the lesson's columns
 * (`lesson-columns.ts`). A column with no row gets one at its first write; a
 * stored homework shown at this lesson moves here first (decision 7).
 */

const CHECK_VIOLATION = '23514';

/** The refusals of the work triggers (0119), as error codes. */
const WORK_REFUSALS = {
  journal_work_total_below: 'total_below_numbers',
  journal_work_move_numbers: 'work_holds_numbers',
  journal_work_carry_once: 'work_carried',
  journal_works_limit: 'journal_works_limit',
  journal_cell_delete: 'work_holds_data',
} as const;

function mapWorkRefusal(error: unknown): never {
  const failure = error as { code?: unknown; constraint?: unknown };
  if (
    failure.code === CHECK_VIOLATION &&
    typeof failure.constraint === 'string' &&
    Object.hasOwn(WORK_REFUSALS, failure.constraint)
  ) {
    throw new ApiException(WORK_REFUSALS[failure.constraint as keyof typeof WORK_REFUSALS], 409);
  }
  throw error;
}

/** What every works route has decided before it writes. */
interface Scene {
  readonly access: Access;
  readonly branchId: string;
  readonly lesson: EntryLesson;
  readonly journal: JournalRow;
  readonly columns: JournalColumns;
  readonly requestId: string | undefined;
}

interface WorkRow {
  id: string;
  lesson_id: string;
  kind: string;
  total: number | null;
  not_held: boolean;
  carried_from_lesson_id: string | null;
  version: number;
}

const savedOf = (row: WorkRow): WorkSaved => ({
  id: row.id,
  kind: row.kind === 'homework' ? 'homework' : 'classwork',
  total: row.total,
  notHeld: row.not_held,
  carriedFrom: row.carried_from_lesson_id,
  version: row.version,
});

const WORK_COLUMNS = [
  'id',
  'lesson_id',
  'kind',
  'total',
  'not_held',
  'carried_from_lesson_id',
  'version',
] as const;

/** The numbers typed for a work: student and number. */
async function numbersOf(
  transaction: Transaction,
  workId: string,
): Promise<{ studentId: string; score: number }[]> {
  const rows = await transaction
    .selectFrom('journal_cells')
    .select(['student_id', 'score'])
    .where('work_id', '=', workId)
    .where('score', 'is not', null)
    .orderBy('student_id')
    .execute();
  return rows.flatMap((row) =>
    row.score === null ? [] : [{ studentId: row.student_id, score: row.score }],
  );
}

const percentOf = (score: number, total: number | null): number | null =>
  total === null || score > total ? null : Number(shownPercent(score, total));

/** The branch's time zone and the transaction's moment. */
async function clockAt(
  transaction: Transaction,
  branchId: string,
): Promise<{ timeZone: string; now: Date }> {
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  return { timeZone: branch.time_zone, now: await transactionMoment(transaction) };
}

@Injectable()
export class WorksService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(Audit) private readonly audit: Audit,
  ) {}

  /**
   * The lesson decided for a works write: entry as attendance (6.3), then a
   * graded subject with a journal teacher that day (From 5.7a-3c: "Without
   * an acting teacher the lessons are attendance-only"), then its columns.
   */
  private async sceneOf(
    transaction: Transaction,
    access: Access,
    lessonId: string,
    requestId: string | undefined,
  ): Promise<Scene> {
    const branchId = branchOf(access);
    const { lesson, now, timeZone } = await enterableLesson(
      transaction,
      access,
      branchId,
      lessonId,
    );
    if (lesson.journalId === null) throw new ApiException('lesson_attendance_only', 409);
    const [journal] = await journalRows(transaction, branchId, { journalId: lesson.journalId });
    if (journal === undefined) throw new ApiException('lesson_attendance_only', 409);
    if (journal.subject.attendanceOnly) throw new ApiException('lesson_attendance_only', 409);
    const facts = await journalFactsOf(transaction, branchId, journal.id);
    const owner =
      facts === null
        ? null
        : ownerOn(
            facts.runs.get(journal.id) ?? [],
            facts.periods.get(journal.id) ?? [],
            facts.out,
            lesson.date,
          );
    if (owner?.kind === 'none') throw new ApiException('lesson_attendance_only', 409);
    const columns = await journalColumns(transaction, journal, timeZone, now);
    return { access, branchId, lesson, journal, columns, requestId };
  }

  private actorOf(scene: Scene) {
    return {
      branchId: scene.branchId,
      actorId: scene.access.accountId,
      assignmentId: entryAssignment(scene.access),
      ...(scene.requestId === undefined ? {} : { requestId: scene.requestId }),
    };
  }

  /**
   * The ids a write names in its body, checked against the branch before any
   * other refusal (`.claude/rules/api.md`): a work, a plan work or a lesson
   * the branch does not hold, or one that does not exist, is 404.
   */
  private async refuseUnknownColumns(
    transaction: Transaction,
    keys: readonly WorkColumn[],
  ): Promise<void> {
    const works = new Set<string>();
    const planWorks = new Set<string>();
    const lessons = new Set<string>();
    for (const key of keys) {
      if ('workId' in key) works.add(key.workId.toLowerCase());
      else {
        planWorks.add(key.planWorkId.toLowerCase());
        lessons.add(key.sourceLessonId.toLowerCase());
      }
    }
    const count = async (
      table: 'journal_works' | 'lesson_plan_works' | 'lessons',
      ids: Set<string>,
    ): Promise<number> =>
      ids.size === 0
        ? 0
        : (
            await transaction
              .selectFrom(table)
              .select('id')
              .where('id', 'in', [...ids])
              .execute()
          ).length;
    if (
      (await count('journal_works', works)) !== works.size ||
      (await count('lesson_plan_works', planWorks)) !== planWorks.size ||
      (await count('lessons', lessons)) !== lessons.size
    ) {
      throw notFound();
    }
  }

  /** The column a write names at the scene's lesson, or 409 `work_not_in_lesson`. */
  private columnOf(scene: Scene, key: WorkColumn): Column {
    const column = columnAt(
      scene.columns.columns,
      scene.lesson.id,
      'workId' in key
        ? { workId: key.workId.toLowerCase() }
        : {
            planWorkId: key.planWorkId.toLowerCase(),
            sourceLessonId: key.sourceLessonId.toLowerCase(),
          },
    );
    if (column === null) throw new ApiException('work_not_in_lesson', 409);
    return column;
  }

  /**
   * The row of a column, locked FOR UPDATE: inserted empty for a column with
   * no row, moved here for a stored homework shown at this lesson (decision
   * 7). `version` is the version the change was made on: a row changed
   * since, or one written meanwhile for a column that had none, is stale;
   * `undefined` (a save of numbers, whose cells carry their own versions)
   * takes the row as it is.
   */
  private async rowOf(
    transaction: Transaction,
    scene: Scene,
    column: Column,
    version: number | null | undefined,
  ): Promise<{ row: WorkRow; moved: boolean }> {
    let row: WorkRow | undefined;
    let moved = false;
    if (column.workId === null) {
      if (column.planWorkId === null || column.sourceLessonId === null) {
        throw new ApiException('work_not_in_lesson', 409);
      }
      row = await transaction
        .insertInto('journal_works')
        .values({
          branch_id: scene.branchId,
          lesson_id: scene.lesson.id,
          source_lesson_id: column.sourceLessonId,
          plan_work_id: column.planWorkId,
          kind: column.kind,
          changed_by: scene.access.accountId,
          changed_how: 'entry',
        })
        .onConflict((conflict) =>
          conflict
            .columns(['branch_id', 'source_lesson_id', 'plan_work_id'])
            .where('plan_work_id', 'is not', null)
            .doNothing(),
        )
        .returning(WORK_COLUMNS)
        .executeTakeFirst()
        .catch((error: unknown) => {
          const failure = error as { code?: unknown; constraint?: unknown };
          if (failure.code === '23503' && failure.constraint === 'journal_works_plan_work_fkey') {
            throw new ApiException('work_not_in_lesson', 409);
          }
          throw error;
        });
      if (row === undefined) {
        const stored = await transaction
          .selectFrom('journal_works')
          .select(WORK_COLUMNS)
          .where('source_lesson_id', '=', column.sourceLessonId)
          .where('plan_work_id', '=', column.planWorkId)
          .forUpdate()
          .executeTakeFirst();
        if (version !== undefined || stored === undefined) throw this.stale(stored);
        row = stored;
      }
    } else {
      row = await transaction
        .selectFrom('journal_works')
        .select(WORK_COLUMNS)
        .where('id', '=', column.workId)
        .forUpdate()
        .executeTakeFirst();
      if (row === undefined) throw new ApiException('work_not_in_lesson', 409);
      if (version !== undefined && version !== row.version) throw this.stale(row);
      if (row.lesson_id !== scene.lesson.id) {
        try {
          row = await transaction
            .updateTable('journal_works')
            .set({
              lesson_id: scene.lesson.id,
              changed_by: scene.access.accountId,
              changed_how: 'move',
            })
            .where('id', '=', row.id)
            .returning(WORK_COLUMNS)
            .executeTakeFirstOrThrow();
        } catch (error) {
          mapWorkRefusal(error);
        }
        moved = true;
      }
    }
    return { row, moved };
  }

  private stale(stored: WorkRow | undefined): ApiException {
    return new ApiException(
      'work_stale',
      409,
      undefined,
      stored === undefined
        ? []
        : [
            {
              path: 'column',
              code: 'work_stale',
              message: 'The work was changed since it was read.',
              recordId: stored.id,
              storedWork: {
                total: stored.total,
                notHeld: stored.not_held,
                version: stored.version,
              },
            },
          ],
    );
  }

  /** Add a work by hand at a lesson with no plan item (`edge/journal`, "A lesson is held with no plan item"). */
  add(access: Access, lessonId: string, input: WorkAdd, requestId?: string): Promise<WorkSaved> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.sceneOf(transaction, access, lessonId, requestId);
      // The lock of `journal_works_limit` (0119), which the takeover of a plan item takes too
      // (code review, should-fix 3): the plan item and the free place are read after it.
      await sql`select pg_advisory_xact_lock(hashtextextended(${`journal_works_limit:${scene.lesson.id}`}, 0))`.execute(
        transaction,
      );
      const { timeZone, now } = await clockAt(transaction, scene.branchId);
      const fresh = await journalColumns(transaction, scene.journal, timeZone, now);
      const own = fresh.columns.get(scene.lesson.id);
      if (own?.planItem !== false) throw new ApiException('lesson_has_plan_item', 409);
      const taken = await transaction
        .selectFrom('journal_works')
        .select('position')
        .where('source_lesson_id', '=', scene.lesson.id)
        .where('kind', '=', input.kind)
        .where('plan_work_id', 'is', null)
        .execute();
      const used = new Set(taken.map((one) => one.position));
      const position = Array.from({ length: LESSON_WORKS_MAX }, (_, at) => at + 1).find(
        (one) => !used.has(one),
      );
      if (position === undefined) throw new ApiException('journal_works_limit', 409);
      let row: WorkRow;
      try {
        row = await transaction
          .insertInto('journal_works')
          .values({
            branch_id: scene.branchId,
            // A homework given by hand is stored where it is given (decision 18).
            lesson_id: scene.lesson.id,
            source_lesson_id: scene.lesson.id,
            kind: input.kind,
            position,
            changed_by: access.accountId,
            changed_how: 'entry',
          })
          .returning(WORK_COLUMNS)
          .executeTakeFirstOrThrow();
      } catch (error) {
        mapWorkRefusal(error);
      }
      await this.audit.record(transaction, {
        ...this.actorOf(scene),
        action: 'journal.work_add',
        record: { type: 'lesson', id: scene.lesson.id },
        newValue: { workId: row.id, kind: input.kind, position },
      });
      return savedOf(row);
    });
  }

  /** Remove an empty work added by hand (From 6.1a: "the delete of an empty work"; decision 1). */
  remove(access: Access, lessonId: string, workId: string, requestId?: string): Promise<void> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.sceneOf(transaction, access, lessonId, requestId);
      const row = await transaction
        .selectFrom('journal_works')
        .select([...WORK_COLUMNS, 'plan_work_id', 'source_lesson_id'])
        .where('id', '=', workId)
        .where('branch_id', '=', scene.branchId)
        .forUpdate()
        .executeTakeFirst();
      if (row === undefined) throw notFound();
      // The lesson it is stored at, its source, or the lesson that shows it (a homework given
      // by hand is a column of its check lesson; code review round 1, finding 1).
      const shown = columnAt(scene.columns.columns, scene.lesson.id, { workId: row.id }) !== null;
      if (!shown && row.lesson_id !== scene.lesson.id && row.source_lesson_id !== scene.lesson.id) {
        throw new ApiException('work_not_in_lesson', 409);
      }
      const numbers = await numbersOf(transaction, row.id);
      if (row.plan_work_id !== null || row.total !== null || row.not_held || numbers.length > 0) {
        throw new ApiException('work_holds_data', 409);
      }
      // The line of the delete names the person who removed it.
      await transaction
        .updateTable('journal_works')
        .set({ changed_by: access.accountId, changed_how: 'deleted' })
        .where('id', '=', row.id)
        .execute();
      try {
        await transaction.deleteFrom('journal_works').where('id', '=', row.id).execute();
      } catch (error) {
        mapWorkRefusal(error);
      }
      await this.audit.record(transaction, {
        ...this.actorOf(scene),
        action: 'journal.work_delete',
        record: { type: 'lesson', id: scene.lesson.id },
        oldValue: { workId: row.id, kind: row.kind },
      });
    });
  }

  /**
   * The total (`07`, The total): below a number typed it is refused with
   * those students listed; with numbers it needs `confirm`, the refusal
   * showing each percent before and after (`edge/journal`; decision 10).
   */
  setTotal(
    access: Access,
    lessonId: string,
    input: { column: WorkColumn; total: number; version: number | null; confirm: boolean },
    requestId?: string,
  ): Promise<WorkSaved> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.sceneOf(transaction, access, lessonId, requestId);
      await this.refuseUnknownColumns(transaction, [input.column]);
      const column = this.columnOf(scene, input.column);
      const { row } = await this.rowOf(transaction, scene, column, input.version);
      if (row.total === input.total) return savedOf(row);
      const numbers = await numbersOf(transaction, row.id);
      const scored = (one: { studentId: string; score: number }, index: number): ErrorDetail => ({
        path: `students.${String(index)}`,
        code: 'total',
        message: 'A number of the work.',
        recordId: one.studentId,
        workScore: {
          score: one.score,
          percentBefore: percentOf(one.score, row.total),
          percentAfter: percentOf(one.score, input.total),
        },
      });
      const above = numbers.filter((one) => one.score > input.total);
      if (above.length > 0) {
        throw new ApiException('total_below_numbers', 409, undefined, above.map(scored));
      }
      if (numbers.length > 0 && !input.confirm) {
        throw new ApiException('total_confirm', 409, undefined, numbers.map(scored));
      }
      let saved: WorkRow;
      try {
        saved = await transaction
          .updateTable('journal_works')
          .set({ total: input.total, changed_by: access.accountId, changed_how: 'entry' })
          .where('id', '=', row.id)
          .returning(WORK_COLUMNS)
          .executeTakeFirstOrThrow();
      } catch (error) {
        mapWorkRefusal(error);
      }
      await this.audit.record(transaction, {
        ...this.actorOf(scene),
        action: 'journal.work_total',
        record: { type: 'lesson', id: scene.lesson.id },
        oldValue: { workId: row.id, total: row.total, lessonId: row.lesson_id },
        newValue: { workId: row.id, total: saved.total, version: saved.version },
        details: { numbers: numbers.length },
      });
      return savedOf(saved);
    });
  }

  /**
   * "Not held" and its undo (`09`, In the journal; `edge/journal`: "A
   * confirmation names the count. The numbers leave the averages and stay in
   * history. Undoing it ... restores the column, the total and the numbers").
   */
  setNotHeld(
    access: Access,
    lessonId: string,
    input: { column: WorkColumn; notHeld: boolean; version: number | null; confirm: boolean },
    requestId?: string,
  ): Promise<WorkSaved> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.sceneOf(transaction, access, lessonId, requestId);
      await this.refuseUnknownColumns(transaction, [input.column]);
      const column = this.columnOf(scene, input.column);
      const { row } = await this.rowOf(transaction, scene, column, input.version);
      if (row.not_held === input.notHeld) return savedOf(row);
      const numbers = await numbersOf(transaction, row.id);
      if (input.notHeld && numbers.length > 0 && !input.confirm) {
        throw new ApiException('not_held_confirm', 409, undefined, [
          {
            path: 'column',
            code: 'not_held_confirm',
            message: 'Numbers leave the averages.',
            recordId: row.id,
            count: numbers.length,
          },
        ]);
      }
      const saved = await transaction
        .updateTable('journal_works')
        .set({ not_held: input.notHeld, changed_by: access.accountId, changed_how: 'not_held' })
        .where('id', '=', row.id)
        .returning(WORK_COLUMNS)
        .executeTakeFirstOrThrow();
      await this.audit.record(transaction, {
        ...this.actorOf(scene),
        action: 'journal.work_not_held',
        record: { type: 'lesson', id: scene.lesson.id },
        oldValue: { workId: row.id, notHeld: row.not_held, lessonId: row.lesson_id },
        newValue: { workId: row.id, notHeld: saved.not_held, version: saved.version },
        details: { numbers: numbers.length },
      });
      return savedOf(saved);
    });
  }

  /**
   * "Check at the next lesson" (`edge/journal`: "At the check lesson the
   * teacher chooses, for each homework, 'not checked' or 'check at the next
   * lesson' (once)"; decision 6): the row stays here, marked, and is shown at
   * the next check lesson.
   */
  carry(
    access: Access,
    lessonId: string,
    input: WorkCarry,
    requestId?: string,
  ): Promise<WorkSaved> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.sceneOf(transaction, access, lessonId, requestId);
      await this.refuseUnknownColumns(transaction, [input.column]);
      const column = this.columnOf(scene, input.column);
      if (column.kind !== 'homework') throw new ApiException('work_not_in_lesson', 409);
      if (column.carriedFrom !== null) throw new ApiException('work_carried', 409);
      // The next lesson that can check it (code review, must-fix 1): never a cancelled one.
      const next = scene.columns.columns.get(scene.lesson.id)?.next ?? null;
      if (next === null) throw new ApiException('no_next_lesson', 409);
      const { row } = await this.rowOf(transaction, scene, column, input.version);
      if ((await numbersOf(transaction, row.id)).length > 0) {
        throw new ApiException('work_holds_numbers', 409);
      }
      let saved: WorkRow;
      try {
        saved = await transaction
          .updateTable('journal_works')
          .set({
            carried_from_lesson_id: scene.lesson.id,
            changed_by: access.accountId,
            changed_how: 'carry',
          })
          .where('id', '=', row.id)
          .returning(WORK_COLUMNS)
          .executeTakeFirstOrThrow();
      } catch (error) {
        mapWorkRefusal(error);
      }
      await this.audit.record(transaction, {
        ...this.actorOf(scene),
        action: 'journal.work_carry',
        record: { type: 'lesson', id: scene.lesson.id },
        newValue: {
          workId: row.id,
          carriedFrom: scene.lesson.id,
          to: next,
          version: saved.version,
        },
      });
      return savedOf(saved);
    });
  }

  /** The numbers of works of one lesson, through `saveCells` (6.1a). */
  saveScores(
    access: Access,
    lessonId: string,
    input: ScoresSave,
    requestId?: string,
  ): Promise<ScoresSaved> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.sceneOf(transaction, access, lessonId, requestId);
      await refuseOtherStudents(
        transaction,
        input.saves.map((save) => save.studentId),
      );
      await this.refuseUnknownColumns(
        transaction,
        input.saves.map((save) => save.column),
      );
      const columns = input.saves.map((save) => this.columnOf(scene, save.column));
      // Each column's row once, in the order of its key, so that two saves lock alike.
      const keyOf = (column: Column) =>
        column.workId ?? `~${column.planWorkId ?? ''}/${column.sourceLessonId ?? ''}`;
      const distinct = [...new Map(columns.map((one) => [keyOf(one), one])).values()].sort((a, b) =>
        keyOf(a).localeCompare(keyOf(b)),
      );
      const rows = new Map<string, WorkRow>();
      // The rows a save moved to this lesson (decision 7), named in an entry of their own;
      // a first row of a planned column writes no history line and needs none.
      const written: WorkRow[] = [];
      const firsts: WorkRow[] = [];
      for (const column of distinct) {
        const { row, moved } = await this.rowOf(transaction, scene, column, undefined);
        rows.set(keyOf(column), row);
        if (moved) written.push(row);
        else if (column.workId === null) firsts.push(row);
      }
      const saved = await saveCells(
        transaction,
        this.audit,
        {
          accountId: access.accountId,
          assignmentId: entryAssignment(access),
          ...(requestId === undefined ? {} : { requestId }),
        },
        input.saves.map((save, index) => {
          const column = columns[index];
          const row = column === undefined ? undefined : rows.get(keyOf(column));
          return {
            lessonId: scene.lesson.id,
            studentId: save.studentId.toLowerCase(),
            workId: row?.id ?? '',
            value: save.score,
            version: save.version,
          };
        }),
      );
      if (written.length > 0) {
        await this.audit.record(transaction, {
          ...this.actorOf(scene),
          action: 'journal.work_move',
          record: { type: 'lesson', id: scene.lesson.id },
          newValue: { works: written.map((one) => ({ id: one.id, version: one.version })) },
        });
      }
      const totals = new Map([...rows.values()].map((row) => [row.id, row.total]));
      return {
        cells: saved.map((cell) => ({
          studentId: cell.studentId,
          workId: cell.workId ?? '',
          score: cell.value,
          percent:
            cell.value === null
              ? null
              : percentOf(cell.value, totals.get(cell.workId ?? '') ?? null),
          version: cell.version,
        })),
        works: [...firsts, ...written].map(savedOf),
      };
    });
  }
}
