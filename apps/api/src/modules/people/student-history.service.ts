import { Injectable } from '@nestjs/common';
import { schoolDateOf } from '@sodiq/shared';
import type {
  MoveChangeLine,
  MoveState,
  SchoolDate,
  StudentHistory,
  StudentHistoryLine,
  StudentMove,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { NO_PLACES, studentPlaces, studentReaderOf } from '../access/class-scope.js';
import type { Access } from '../access/permission.guard.js';
import { membershipsOf } from '../classes/class-membership-rows.js';
import { groupMembershipsOf } from '../classes/group-membership-rows.js';
import { moveSummaries, movesOf } from '../classes/student-moves.js';
import { notFound } from '../setup/setup-refusals.js';
import { historyLines } from './student-status.js';
import { branchMovesOf, branchNames, summaryOf } from './branch-moves.js';
import { Students } from './students.service.js';

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('A student route works for the branch of the request.');
  }
  return access.branchId;
}

/** A line with what orders it: its date, then the id of the row or move that wrote it (uuidv7, in order of writing). */
interface Ordered {
  date: SchoolDate;
  id: string;
  line: StudentHistoryLine;
}

/**
 * The History tab of a student (docs/spec/04-people.md, Profile tabs;
 * Movements: "The profile History tab shows each move with dates"; task
 * 3.3a, pull request #95): every move, a scheduled move that was changed as
 * one move with its changes (task 3.5c, H34), every stay in a class or a
 * group from its first day to its last or "until now" (task 3.5c, H35), and
 * every stretch of status, newest first. `student_history` `view`;
 * a Tutor reads the students of own classes (decision 9 as changed by
 * correction 3). 404 for an unknown or another branch's student first, then
 * 403 outside the scope.
 */
@Injectable()
export class StudentHistories {
  constructor(
    private readonly transactions: Transactions,
    private readonly students: Students,
  ) {}

  history(access: Access, id: string): Promise<StudentHistory> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const student = await transaction
        .selectFrom('students')
        .select('id')
        .where('id', '=', id)
        // The Super Admin's transaction sees every branch (task 3.3c).
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      if (student === undefined) {
        throw notFound();
      }
      const today = await this.students.todayIn(transaction, branchId);
      const places = (await studentPlaces(transaction, today, id)).get(id) ?? NO_PLACES;
      if (studentReaderOf(access, 'student_history', places) === undefined) {
        throw new ApiException('permission_denied', 403);
      }
      const lines: Ordered[] = [];
      // The rows of this branch here; those of the branches the student was
      // in before a move to another branch below, read past the filter
      // (task 3.3c, decision 3), so that every reader gets the same lines.
      const here = await moveSummaries(transaction, id, today, branchId);
      const replacing = new Map(
        (await movesOf(transaction, id, branchId)).map((move) => [move.id, move.replacesMoveId]),
      );
      const elsewhere = await rowsElsewhere(transaction, id, branchId);
      for (const move of elsewhere.moves) {
        replacing.set(move.id, elsewhere.replaces.get(move.id) ?? null);
      }
      for (const { move, changes } of movesWithChanges([...here, ...elsewhere.moves], replacing)) {
        lines.push({ date: move.from, id: move.id, line: { kind: 'move', move, changes } });
      }
      lines.push(...(await this.branchMoveLines(transaction, id, branchId, elsewhere.classRows)));
      for (const row of elsewhere.classRows.filter(holdsDays)) {
        lines.push({
          date: row.validFrom,
          id: row.id,
          line: {
            kind: 'class',
            class: row.class,
            from: row.validFrom,
            until: stayUntil(row, today),
          },
        });
      }
      for (const row of elsewhere.groupRows.filter(holdsDays)) {
        lines.push({
          date: row.validFrom,
          id: row.id,
          line: {
            kind: 'group',
            group: row.group,
            subjectId: row.subjectId,
            from: row.validFrom,
            until: stayUntil(row, today),
          },
        });
      }
      // One line per stay in a class or a group (task 3.5c, H35), whatever
      // wrote the row: one stay is one row (`*_one_stay`, 0062). A row that
      // holds no day is no line.
      const classRows = (await membershipsOf(transaction, id, branchId)).filter(holdsDays);
      const groupRows = (await groupMembershipsOf(transaction, id, branchId)).filter(holdsDays);
      const classNames = await this.classNames(
        transaction,
        classRows.map((row) => row.classId),
      );
      const groupNames = await this.groupNames(
        transaction,
        groupRows.map((row) => row.groupId),
      );
      for (const row of classRows) {
        const named = classNames.get(row.classId);
        if (named !== undefined) {
          lines.push({
            date: row.validFrom,
            id: row.id,
            line: {
              kind: 'class',
              class: named,
              from: row.validFrom,
              until: stayUntil(row, today),
            },
          });
        }
      }
      for (const row of groupRows) {
        const named = groupNames.get(row.groupId);
        if (named !== undefined) {
          lines.push({
            date: row.validFrom,
            id: row.id,
            line: {
              kind: 'group',
              group: named,
              subjectId: row.subjectId,
              from: row.validFrom,
              until: stayUntil(row, today),
            },
          });
        }
      }
      // Two adjacent active rows, the fill of a cancel or an undo, are one
      // stretch (the 2.4b-1 line on 3.3; must-fix 6 of the plan review).
      const statuses = ((await this.students.statusRowsOf(transaction, id)).get(id) ?? []).filter(
        (row) => row.validFrom !== row.validUntil,
      );
      for (const row of historyLines(statuses)) {
        lines.push({
          date: row.validFrom,
          id: row.id,
          line: {
            kind: 'status',
            status: row.status,
            cause: row.cause,
            from: row.validFrom,
            until: row.validUntil,
          },
        });
      }
      // The records merged into this one (task 3.3d): the day of the merge
      // in the time zone of the branch of the request.
      const zone = await transaction
        .selectFrom('branches')
        .select('time_zone')
        .where('id', '=', branchId)
        .executeTakeFirstOrThrow();
      for (const merge of await transaction
        .selectFrom('student_merges')
        .select(['id', 'merged_uid', 'reason', 'merged_at'])
        .where('kept_id', '=', id)
        .execute()) {
        const on = schoolDateOf(merge.merged_at, zone.time_zone);
        lines.push({
          date: on,
          id: merge.id,
          line: { kind: 'merged', on, uid: merge.merged_uid, reason: merge.reason },
        });
      }
      lines.sort((a, b) =>
        a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.id < b.id ? 1 : a.id > b.id ? -1 : 0,
      );
      return { lines: lines.map((one) => one.line), today };
    });
  }

  /**
   * The lines of the releases of the student (task 3.3c): the rows went with
   * the student, so this branch holds every one; an accepted move names the
   * class it joined, a row of this branch or of another one.
   */
  private async branchMoveLines(
    transaction: Transaction,
    id: string,
    branchId: string,
    classesElsewhere: readonly ElsewhereClassRow[],
  ): Promise<Ordered[]> {
    const moves = await branchMovesOf(transaction, id, branchId);
    if (moves.length === 0) {
      return [];
    }
    const names = await branchNames(
      transaction,
      moves.flatMap((move) => [move.fromBranchId, move.toBranchId]),
    );
    const here = (await membershipsOf(transaction, id, branchId)).filter(
      (row) => row.cause === 'branch_move',
    );
    const named = await this.classNames(
      transaction,
      here.map((row) => row.classId),
    );
    const joined = [
      ...here.flatMap((row) => {
        const one = named.get(row.classId);
        return one === undefined ? [] : [{ branchId, validFrom: row.validFrom, class: one }];
      }),
      ...classesElsewhere
        .filter((row) => row.cause === 'branch_move')
        .map((row) => ({ branchId: row.branchId, validFrom: row.validFrom, class: row.class })),
    ];
    return moves.map((move) => ({
      date: move.effectiveOn,
      id: move.id,
      line: {
        kind: 'branch_move' as const,
        move: summaryOf(move, names),
        toClass:
          move.acceptedAt === null
            ? null
            : (joined.find(
                (row) =>
                  row.branchId.toLowerCase() === move.toBranchId.toLowerCase() &&
                  row.validFrom === move.effectiveOn,
              )?.class ?? null),
      },
    }));
  }

  private async classNames(transaction: Transaction, ids: readonly string[]) {
    const unique = [...new Set(ids)];
    const rows =
      unique.length === 0
        ? []
        : await transaction
            .selectFrom('classes')
            .select(['id', 'grade', 'name'])
            .where('id', 'in', unique)
            .execute();
    return new Map(rows.map((row) => [row.id, { id: row.id, grade: row.grade, name: row.name }]));
  }

  private async groupNames(transaction: Transaction, ids: readonly string[]) {
    const unique = [...new Set(ids)];
    const rows =
      unique.length === 0
        ? []
        : await transaction
            .selectFrom('groups')
            .select(['id', 'name'])
            .where('id', 'in', unique)
            .execute();
    return new Map(rows.map((row) => [row.id, { id: row.id, name: row.name }]));
  }
}

/** A row that holds days. */
function holdsDays(row: { validFrom: SchoolDate; validUntil: SchoolDate }): boolean {
  return row.validFrom < row.validUntil;
}

/**
 * The end of a stay as History shows it (task 3.5c, decision 8 as changed by
 * the review): the first day after; `null` ("until now", or "from <date>"
 * for a stay that begins after today) while the row has no end and reaches
 * past today. A cut (a leaving, a move, a merge, a move to another branch)
 * gives its date, a stay of a past year the year's end.
 */
export function stayUntil(
  row: { validUntil: SchoolDate; endedBy: string | null },
  today: SchoolDate,
): SchoolDate | null {
  return row.endedBy === null && row.validUntil > today ? null : row.validUntil;
}

/**
 * The moves as History lines (task 3.5c, H34: "one move with its changes"): a
 * move a change replaced is no line of its own; it is a change of the move
 * that replaced it, with its date and target, oldest first.
 */
export function movesWithChanges(
  moves: readonly StudentMove[],
  replacing: ReadonlyMap<string, string | null>,
): { move: StudentMove; changes: MoveChangeLine[] }[] {
  const byId = new Map(moves.map((move) => [move.id, move]));
  const replaced = new Set(
    [...replacing.values()].filter((one): one is string => one !== null && byId.has(one)),
  );
  return moves
    .filter((move) => !replaced.has(move.id))
    .map((move) => {
      const changes: MoveChangeLine[] = [];
      const seen = new Set<string>([move.id]);
      let earlier = replacing.get(move.id) ?? null;
      while (earlier !== null && !seen.has(earlier)) {
        const one = byId.get(earlier);
        if (one === undefined) {
          break;
        }
        seen.add(earlier);
        changes.unshift({ from: one.from, toClass: one.toClass, toGroup: one.toGroup });
        earlier = replacing.get(earlier) ?? null;
      }
      return { move, changes };
    });
}

interface ElsewhereClassRow {
  id: string;
  branchId: string;
  class: { id: string; grade: number; name: string };
  validFrom: SchoolDate;
  validUntil: SchoolDate;
  cause: string;
  endedBy: string | null;
}

/**
 * The class rows, group rows and moves of the student in other branches than
 * the request's, read past the filter (`student_rows_elsewhere`, 0053; task
 * 3.3c, decision 3): names, dates, causes and links only. A move there is
 * never undone from here.
 */
async function rowsElsewhere(
  transaction: Transaction,
  studentId: string,
  branchId: string,
): Promise<{
  classRows: ElsewhereClassRow[];
  groupRows: {
    id: string;
    group: { id: string; name: string };
    subjectId: string;
    validFrom: SchoolDate;
    validUntil: SchoolDate;
    cause: string;
    endedBy: string | null;
    writtenByMoveId: string | null;
  }[];
  moves: StudentMove[];
  /** The move each move replaced by a change (task 3.5c), by id. */
  replaces: Map<string, string | null>;
}> {
  const found = await sql<{ kind: string; data: Record<string, unknown> }>`
    select kind, data from student_rows_elsewhere(${studentId}::uuid, ${branchId}::uuid)
  `.execute(transaction);
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  const orNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
  const classOf = (value: unknown) => {
    const one = value as { id?: unknown; grade?: unknown; name?: unknown } | null;
    return one === null || one === undefined
      ? null
      : { id: text(one.id), grade: Number(one.grade), name: text(one.name) };
  };
  const groupOf = (value: unknown) => {
    const one = value as { id?: unknown; name?: unknown } | null;
    return one === null || one === undefined ? null : { id: text(one.id), name: text(one.name) };
  };
  const classRows: ElsewhereClassRow[] = [];
  const groupRows = [];
  const moves: StudentMove[] = [];
  const replaces = new Map<string, string | null>();
  for (const { kind, data } of found.rows) {
    if (kind === 'class') {
      classRows.push({
        id: text(data.id),
        branchId: text(data.branchId),
        class: { id: text(data.classId), grade: Number(data.grade), name: text(data.name) },
        validFrom: text(data.validFrom),
        validUntil: text(data.validUntil),
        cause: text(data.cause),
        endedBy: orNull(data.endedBy),
      });
    } else if (kind === 'group') {
      groupRows.push({
        id: text(data.id),
        group: { id: text(data.groupId), name: text(data.name) },
        subjectId: text(data.subjectId),
        validFrom: text(data.validFrom),
        validUntil: text(data.validUntil),
        cause: text(data.cause),
        endedBy: orNull(data.endedBy),
        writtenByMoveId: orNull(data.writtenByMoveId),
      });
    } else {
      const state: MoveState =
        data.cancelled === true ? 'cancelled' : data.undone === true ? 'undone' : 'done';
      moves.push({
        id: text(data.id),
        kind: data.kind === 'group' ? 'group' : 'class',
        from: text(data.effectiveOn),
        subjectId: orNull(data.subjectId),
        fromClass: classOf(data.fromClass),
        toClass: classOf(data.toClass),
        fromGroup: groupOf(data.fromGroup),
        toGroup: groupOf(data.toGroup),
        state,
        cancelledByLeaving: data.cancelledByLeaving === true,
        undoable: false,
      });
      replaces.set(text(data.id), orNull(data.replacesMoveId));
    }
  }
  return { classRows, groupRows, moves, replaces };
}
