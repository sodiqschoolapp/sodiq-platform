import { Injectable } from '@nestjs/common';
import type { SchoolDate, StudentHistory, StudentHistoryLine } from '@sodiq/shared';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { studentClasses, studentReaderOf } from '../access/class-scope.js';
import type { Access } from '../access/permission.guard.js';
import { membershipsOf } from '../classes/class-membership-rows.js';
import { groupMembershipsOf } from '../classes/group-membership-rows.js';
import { holdsDays } from '../classes/membership-plan.js';
import { moveSummaries } from '../classes/student-moves.js';
import { notFound } from '../setup/setup-refusals.js';
import { historyLines } from './student-status.js';
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
      for (const move of await moveSummaries(transaction, id, today)) {
        lines.push({ date: move.from, id: move.id, line: { kind: 'move', move } });
      }
      // A class or a group joined outside a move: a placement, the create,
      // "Place automatically". The rows a move, a cancel or an undo wrote are
      // the move's line; a row that holds no day is no line.
      const classRows = (await membershipsOf(transaction, id)).filter(
        (row) => holdsDays(row) && (row.cause === 'placement' || row.cause === 'create'),
      );
      const groupRows = (await groupMembershipsOf(transaction, id)).filter(
        (row) =>
          holdsDays(row) &&
          row.writtenByMoveId === null &&
          (row.cause === 'placement' || row.cause === 'automatic'),
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

  private async classNames(
    transaction: Transaction,
    ids: readonly string[],
  ) {
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

  private async groupNames(
    transaction: Transaction,
    ids: readonly string[],
  ) {
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
