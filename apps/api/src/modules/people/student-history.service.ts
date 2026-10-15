import { Injectable } from '@nestjs/common';
import type {
  MoveState,
  SchoolDate,
  StudentHistory,
  StudentHistoryLine,
  StudentMove,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { studentClasses, studentReaderOf } from '../access/class-scope.js';
import type { Access } from '../access/permission.guard.js';
import { membershipsOf } from '../classes/class-membership-rows.js';
import { groupMembershipsOf } from '../classes/group-membership-rows.js';
import { moveSummaries } from '../classes/student-moves.js';
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
 * 3.3a, pull request #95): every move, every class or group joined outside a
 * move, and every stretch of status, newest first. `student_history` `view`;
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
      const classes = (await studentClasses(transaction, today, id)).get(id) ?? [];
      if (studentReaderOf(access, 'student_history', classes) === undefined) {
        throw new ApiException('permission_denied', 403);
      }
      const lines: Ordered[] = [];
      // The rows of this branch here; those of the branches the student was
      // in before a move to another branch below, read past the filter
      // (task 3.3c, decision 3), so that every reader gets the same lines.
      for (const move of await moveSummaries(transaction, id, today, branchId)) {
        lines.push({ date: move.from, id: move.id, line: { kind: 'move', move } });
      }
      const elsewhere = await rowsElsewhere(transaction, id, branchId);
      for (const move of elsewhere.moves) {
        lines.push({ date: move.from, id: move.id, line: { kind: 'move', move } });
      }
      lines.push(...(await this.branchMoveLines(transaction, id, branchId, elsewhere.classRows)));
      for (const row of elsewhere.classRows.filter((one) => joinedOutsideMove(one))) {
        lines.push({
          date: row.validFrom,
          id: row.id,
          line: { kind: 'class', class: row.class, from: row.validFrom, until: row.validUntil },
        });
      }
      for (const row of elsewhere.groupRows.filter((one) => groupOutsideMove(one))) {
        lines.push({
          date: row.validFrom,
          id: row.id,
          line: {
            kind: 'group',
            group: row.group,
            subjectId: row.subjectId,
            from: row.validFrom,
            until: row.validUntil,
          },
        });
      }
      // A class or a group joined outside a move: a placement, the create,
      // "Place automatically", a return and a graduate restore (task 3.3b).
      // The rows a move, a cancel or an undo wrote are the move's line; a row
      // that holds no day is no line.
      const classRows = (await membershipsOf(transaction, id, branchId)).filter((row) =>
        joinedOutsideMove(row),
      );
      const groupRows = (await groupMembershipsOf(transaction, id, branchId)).filter((row) =>
        groupOutsideMove(row),
      );
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
            line: { kind: 'class', class: named, from: row.validFrom, until: row.validUntil },
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
              until: row.validUntil,
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

/** A class row joined outside a move: a placement, the create, a return, a restore; one with days. */
function joinedOutsideMove(row: { cause: string; validFrom: SchoolDate; validUntil: SchoolDate }) {
  return (
    row.validFrom < row.validUntil &&
    (row.cause === 'placement' ||
      row.cause === 'create' ||
      row.cause === 'return' ||
      row.cause === 'restore')
  );
}

/**
 * A group row joined outside a move: a placement, "Place automatically", the
 * group chosen by the accept of a move to another branch (task 3.3c); one
 * with days.
 */
function groupOutsideMove(row: {
  cause: string;
  writtenByMoveId: string | null;
  validFrom: SchoolDate;
  validUntil: SchoolDate;
}) {
  return (
    row.validFrom < row.validUntil &&
    row.writtenByMoveId === null &&
    (row.cause === 'placement' || row.cause === 'automatic' || row.cause === 'branch_move')
  );
}

interface ElsewhereClassRow {
  id: string;
  branchId: string;
  class: { id: string; grade: number; name: string };
  validFrom: SchoolDate;
  validUntil: SchoolDate;
  cause: string;
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
    writtenByMoveId: string | null;
  }[];
  moves: StudentMove[];
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
  for (const { kind, data } of found.rows) {
    if (kind === 'class') {
      classRows.push({
        id: text(data.id),
        branchId: text(data.branchId),
        class: { id: text(data.classId), grade: Number(data.grade), name: text(data.name) },
        validFrom: text(data.validFrom),
        validUntil: text(data.validUntil),
        cause: text(data.cause),
      });
    } else if (kind === 'group') {
      groupRows.push({
        id: text(data.id),
        group: { id: text(data.groupId), name: text(data.name) },
        subjectId: text(data.subjectId),
        validFrom: text(data.validFrom),
        validUntil: text(data.validUntil),
        cause: text(data.cause),
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
    }
  }
  return { classRows, groupRows, moves };
}
