import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_DEFAULT_RANGE_DAYS,
  AUDIT_MAX_RANGE_DAYS,
  RESET_ENTRY_HOURS,
  schoolDateOf,
  type Clock,
  type ResetEntries as ResetEntriesAnswer,
  type ResetEntriesQuery,
  type ResetKind,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import {
  cellChange,
  cellLesson,
  lessonsOfCells,
  lineValues,
  namedAccounts,
  workKinds,
} from '../journal/cell-lines.query.js';
import {
  commentLines,
  ratingLines,
  withoutBranchOf,
} from '../journal/rating-comment-lines.query.js';
import { workLines, withoutBranch } from '../journal/work-lines.query.js';
import { branchOf } from './staff-account-records.js';

const HOUR_MS = 3_600_000;

/** A school date `days` before another. */
function daysBefore(date: string, days: number): string {
  const moment = new Date(`${date}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() - days);
  return moment.toISOString().slice(0, 10);
}

/** A row of `password_resets_of_branch` (0112). */
interface ResetRow {
  entry_id: string;
  account_id: string;
  kind: ResetKind;
  occurred_at: Date;
  actor_id: string | null;
  email_change_by: string | null;
  email_change_at: Date | null;
  email_change_action: string | null;
}

/**
 * The report of entries made within 48 hours of a password reset (task 6.1c,
 * pull request #209; edge-cases/people-roles-accounts, Accounts and sign-in:
 * "A report lists entries made within 48 hours of a reset ... A password
 * reset by email that follows a change of the email by somebody else is
 * listed in the same report"). The resets come from `password_resets_of_branch`
 * (0112) with the branch of the request (decisions 1 and 6); the entries are
 * the cell lines of the branch, read through the row filter (decision 2).
 * Reading it is not logged (decision 9).
 */
@Injectable()
export class ResetEntries {
  constructor(
    private readonly transactions: Transactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  read(access: Access, query: ResetEntriesQuery): Promise<ResetEntriesAnswer> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const branch = await transaction
        .selectFrom('branches')
        .select('time_zone')
        .where('id', '=', branchId)
        .executeTakeFirstOrThrow();
      const timeZone = branch.time_zone;
      // Decision 7: the audit screen's range rule, checked also when one end
      // is left out.
      const to = query.to ?? schoolDateOf(this.clock.now(), timeZone);
      const from = query.from ?? daysBefore(to, AUDIT_DEFAULT_RANGE_DAYS - 1);
      if (from > to) {
        throw new ApiException('validation_failed', 400, undefined, [
          { path: 'from', code: 'custom', message: 'The range ends before it begins.' },
        ]);
      }
      if (from < daysBefore(to, AUDIT_MAX_RANGE_DAYS - 1)) {
        throw new ApiException('validation_failed', 400, undefined, [
          { path: 'from', code: 'custom', message: 'The range is longer than allowed.' },
        ]);
      }
      const found = await sql<ResetRow>`
        select * from password_resets_of_branch(
          ${branchId}::uuid,
          (${from}::date::timestamp at time zone ${timeZone}),
          ((${to}::date + 1)::timestamp at time zone ${timeZone})
        )
        order by occurred_at desc, entry_id desc
      `.execute(transaction);
      const resets = found.rows;
      // The lines of every reset at once: the account's lines of the branch
      // within the 48 hours of any of its resets (decision 2).
      const windows = resets.map((reset) => ({
        accountId: reset.account_id,
        start: reset.occurred_at,
        end: new Date(reset.occurred_at.getTime() + RESET_ENTRY_HOURS * HOUR_MS),
      }));
      const lines =
        windows.length === 0
          ? []
          : await transaction
              .selectFrom('journal_cell_history')
              .select([
                'id',
                'lesson_id',
                'student_id',
                'work_id',
                'mark_before',
                'mark_after',
                'score_before',
                'score_after',
                'changed_by',
                'changed_how',
                'changed_at',
              ])
              .where('branch_id', '=', branchId)
              .where((eb) =>
                eb.or(
                  windows.map((window) =>
                    eb.and([
                      eb('changed_by', '=', window.accountId),
                      eb('changed_at', '>=', window.start),
                      eb('changed_at', '<', window.end),
                    ]),
                  ),
                ),
              )
              .orderBy('changed_at')
              .orderBy('id')
              .execute();
      const lessons = await lessonsOfCells(
        transaction,
        lines.map((line) => line.lesson_id),
      );
      const works = await workKinds(
        transaction,
        lines.map((line) => line.work_id),
      );
      const studentIds = [...new Set(lines.map((line) => line.student_id))];
      const students = new Map(
        (studentIds.length === 0
          ? []
          : await transaction
              .selectFrom('students')
              .select(['id', 'uid', 'first_name', 'last_name'])
              .where('id', 'in', studentIds)
              .execute()
        ).map((row) => [
          row.id,
          { id: row.id, uid: row.uid, firstName: row.first_name, lastName: row.last_name },
        ]),
      );
      const accounts = await namedAccounts(
        transaction,
        resets.flatMap((reset) => [reset.account_id, reset.actor_id, reset.email_change_by]),
      );
      // Task 8.1 (From 6.1c): the total and "not held" lines in the same windows.
      const workEntries = (
        await Promise.all(
          windows.map(async (window) => ({
            window,
            lines: (
              await workLines(transaction, {
                branchId,
                writer: { accountId: window.accountId, from: window.start, to: window.end },
              })
            ).filter(
              (line) =>
                line.totalBefore !== line.totalAfter || line.notHeldBefore !== line.notHeldAfter,
            ),
          })),
        )
      ).map((one) => one.lines);
      // Task 8.2 (From 6.1c; decision 12): the rating entry and comment lines in the same windows.
      const ratingEntries = await Promise.all(
        windows.map(async (window) =>
          (
            await ratingLines(transaction, {
              branchId,
              writer: { accountId: window.accountId, from: window.start, to: window.end },
            })
          ).map(withoutBranchOf),
        ),
      );
      const commentEntries = await Promise.all(
        windows.map(async (window) =>
          (
            await commentLines(transaction, {
              branchId,
              writer: { accountId: window.accountId, from: window.start, to: window.end },
            })
          ).map(withoutBranchOf),
        ),
      );
      const named = (id: string | null) =>
        id === null ? null : (accounts.get(id) ?? { accountId: id, login: null, name: null });
      return {
        from,
        to,
        resets: resets.map((reset, index) => {
          const end = reset.occurred_at.getTime() + RESET_ENTRY_HOURS * HOUR_MS;
          // Decision 4: an edit of the email (not the email given at
          // creation) by an account other than the one reset.
          const emailChanged =
            reset.kind === 'email' &&
            reset.email_change_action === 'staff.edit' &&
            reset.email_change_by !== null &&
            reset.email_change_at !== null &&
            reset.email_change_by !== reset.account_id;
          const changedBy = emailChanged ? named(reset.email_change_by) : null;
          return {
            id: reset.entry_id,
            kind: reset.kind,
            at: reset.occurred_at.toISOString(),
            person: named(reset.account_id) ?? {
              accountId: reset.account_id,
              login: null,
              name: null,
            },
            by: named(reset.actor_id),
            emailChangedBy:
              changedBy === null || reset.email_change_at === null
                ? null
                : { ...changedBy, at: reset.email_change_at.toISOString() },
            workEntries: (workEntries[index] ?? []).map(withoutBranch),
            ratingEntries: ratingEntries[index] ?? [],
            commentEntries: commentEntries[index] ?? [],
            entries: lines
              .filter(
                (line) =>
                  line.changed_by === reset.account_id &&
                  line.changed_at.getTime() >= reset.occurred_at.getTime() &&
                  line.changed_at.getTime() < end,
              )
              .map((line) => ({
                id: line.id,
                changedAt: line.changed_at.toISOString(),
                lesson: cellLesson(lessons.get(line.lesson_id)),
                attendance: line.work_id === null,
                workKind: line.work_id === null ? null : (works.get(line.work_id)?.kind ?? null),
                ...lineValues(line),
                changedHow: cellChange(line.changed_how),
                student: students.get(line.student_id) ?? null,
              })),
          };
        }),
      };
    });
  }
}
