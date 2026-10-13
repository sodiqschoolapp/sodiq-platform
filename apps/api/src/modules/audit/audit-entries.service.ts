import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_ACTION_GROUPS,
  AUDIT_DEFAULT_RANGE_DAYS,
  AUDIT_MAX_RANGE_DAYS,
  AUDIT_PAGE_SIZE,
  auditCursorOf,
  hideIdentity,
  PERMISSIONS,
  roleSchema,
  schoolDateOf,
  type AuditEntryAnswer,
  type AuditPage,
  type AuditQuery,
  type Clock,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { decide } from '../access/permission-check.js';
import type { Access } from '../access/permission.guard.js';
import { notFound } from '../setup/setup-refusals.js';
import { readEntries, type EntriesSearch, type StoredEntry } from './audit-entries.query.js';
import { Audit } from './audit.service.js';

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('The audit log is read for the branch of the request.');
  }
  return access.branchId;
}

/** The current Super Admin assignment of the account, which counts in every branch. */
const superAdminOf = (access: Access): string | undefined =>
  access.assignments.find((assignment) => assignment.role === 'super_admin')?.id;

/**
 * Whether a current assignment of the account reads Identity in the branch
 * of the request (decision 6): the readers of `student_identity` (the Super
 * Admin and the Academic Vice Principal), who are also the plain readers of
 * staff and relative identity. Decided from every current assignment, never
 * from the role on display (`.claude/rules/api.md`).
 */
const readsIdentity = (access: Access): boolean =>
  decide(
    { area: 'student_identity', action: 'view', branch: 'request' },
    access.assignments,
    access.branchId,
    PERMISSIONS,
  ) !== undefined;

/** A school date `days` before another. */
function daysBefore(date: string, days: number): string {
  const moment = new Date(`${date}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() - days);
  return moment.toISOString().slice(0, 10);
}

/**
 * The Audit log page (task 2.6a, pull request #75): the entries a reader may
 * read, searched by person, record and date, with Identity hidden from a
 * reader who sees it hidden on the record, and the logged show.
 */
@Injectable()
export class AuditEntries {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Every branch, for a transaction of the Super Admin's scopes `all` and `school`. */
  private async everyBranch(): Promise<string[]> {
    return this.transactions.run([], async (transaction) =>
      (await transaction.selectFrom('branches').select('id').orderBy('id').execute()).map(
        (row) => row.id,
      ),
    );
  }

  private async timeZoneOf(transaction: Transaction, branchId: string): Promise<string> {
    const branch = await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    return branch.time_zone;
  }

  /**
   * One page of the log (decisions 3, 4, 5, 8). The Principal's and the
   * Academic Vice Principal's read is the branch of the request: `audit_log`
   * through the row filter, and the school-wide entries of the branch. Only
   * a current Super Admin assignment reads the scopes `all` and `school`.
   */
  async list(access: Access, query: AuditQuery): Promise<AuditPage> {
    const branchId = branchOf(access);
    const superAdmin = superAdminOf(access);
    if (query.scope !== 'branch' && superAdmin === undefined) {
      throw new ApiException('permission_denied', 403);
    }
    const branchIds = query.scope === 'branch' ? access.branchIds : await this.everyBranch();
    return this.transactions.run(branchIds, async (transaction) => {
      // The dates are read in the time zone of the branch of the request in
      // every scope (decision 4): all branches are Asia/Tashkent today.
      const timeZone = await this.timeZoneOf(transaction, branchId);
      const to = query.to ?? schoolDateOf(this.clock.now(), timeZone);
      const from = query.from ?? daysBefore(to, AUDIT_DEFAULT_RANGE_DAYS - 1);
      if (from > to) {
        throw new ApiException('validation_failed', 400, undefined, [
          { path: 'from', code: 'custom', message: 'The range ends before it begins.' },
        ]);
      }
      // The longest range holds when one end was left out too (permission
      // review of the build): the schema checks it only when both are sent.
      if (from < daysBefore(to, AUDIT_MAX_RANGE_DAYS - 1)) {
        throw new ApiException('validation_failed', 400, undefined, [
          { path: 'from', code: 'custom', message: 'The range is longer than allowed.' },
        ]);
      }
      let person: EntriesSearch['person'];
      if (query.person !== undefined) {
        // A staff member also matches as the actor: the account of the record,
        // when the transaction sees the record.
        const accountId =
          query.person.kind === 'staff'
            ? ((
                await transaction
                  .selectFrom('staff')
                  .select('account_id')
                  .where('id', '=', query.person.id)
                  .executeTakeFirst()
              )?.account_id ?? null)
            : null;
        person = { ...query.person, accountId };
      }
      const rows = await readEntries(transaction, {
        branchLog: query.scope === 'school' ? 'none' : 'filtered',
        schoolLog: query.scope === 'branch' ? 'branch' : 'all',
        branchId,
        timeZone,
        ...(person === undefined ? {} : { person }),
        ...(query.recordType === undefined || query.recordId === undefined
          ? {}
          : { record: { type: query.recordType, id: query.recordId } }),
        from,
        to,
        ...(query.group === undefined ? {} : { actions: AUDIT_ACTION_GROUPS[query.group] }),
        ...(query.before === undefined ? {} : { before: query.before }),
        limit: AUDIT_PAGE_SIZE + 1,
      });
      const page = rows.slice(0, AUDIT_PAGE_SIZE);
      const entries = await entryAnswers(transaction, branchIds, page, !readsIdentity(access));
      const last = entries.at(-1);
      return {
        entries,
        chooseScope: superAdmin !== undefined,
        next: rows.length > AUDIT_PAGE_SIZE && last !== undefined ? auditCursorOf(last) : null,
        from,
        to,
      };
    });
  }

  /**
   * One entry with its hidden values shown (decision 6). An entry the reader
   * may not read, or an unknown id, is 404 and nothing is logged. When
   * something was hidden from this reader, `audit.entry_shown` is written to
   * the log of the branch of the request in the same transaction, with the
   * shown entry's record and person, so that a search by them finds the show.
   */
  async show(access: Access, id: string, requestId: string): Promise<AuditEntryAnswer> {
    const branchId = branchOf(access);
    // Every reader, the Super Admin included, is held to the branch of the
    // request (`.claude/rules/api.md`; permission review of the build): the
    // Super Admin has nothing hidden, so never needs a show of another log.
    const branchIds = access.branchIds;
    return this.transactions.run(branchIds, async (transaction) => {
      const [row] = await readEntries(transaction, {
        branchLog: 'filtered',
        schoolLog: 'branch',
        branchId,
        timeZone: await this.timeZoneOf(transaction, branchId),
        id,
        limit: 1,
      });
      if (row === undefined) {
        throw notFound();
      }
      const [hiddenView] = await entryAnswers(transaction, branchIds, [row], true);
      const [entry] = await entryAnswers(transaction, branchIds, [row], false);
      if (entry === undefined || hiddenView === undefined) {
        throw notFound();
      }
      if (!readsIdentity(access) && hiddenView.hidden.length > 0) {
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'audit.entry_shown',
          ...(row.person_id === null ? {} : { personId: row.person_id }),
          ...(row.record_type === null || row.record_id === null
            ? {}
            : { record: { type: row.record_type, id: row.record_id } }),
          details: { entryId: row.id, entryAction: row.action, fields: hiddenView.hidden },
          requestId,
        });
      }
      return entry;
    });
  }

}

/**
 * The entries as the page shows them: names through `audit_names` (decision
 * 12, the actor and the person of these entries only), the role of the
 * assignment when it belongs to a branch of the transaction or to none,
 * the name of a student or relative record the transaction sees, and the
 * values hidden when `hide`.
 */
export async function entryAnswers(
  transaction: Transaction,
  branchIds: readonly string[],
  rows: readonly StoredEntry[],
  hide: boolean,
): Promise<AuditEntryAnswer[]> {
  if (rows.length === 0) {
    return [];
  }
  const nameIds = [
    ...new Set(
      rows.flatMap((row) => [
        row.actor_id,
        row.person_id,
        row.record_type === 'staff' ? row.record_id : null,
      ]),
    ),
  ].filter((value): value is string => value !== null);
  const names = new Map<string, string>();
  if (nameIds.length > 0) {
    const found = await sql<{ id: string; first_name: string | null; last_name: string | null }>`
      select id, first_name, last_name from audit_names(${nameIds}::uuid[])
    `.execute(transaction);
    for (const row of found.rows) {
      names.set(row.id, [row.last_name, row.first_name].filter(Boolean).join(' '));
    }
  }
  const recordIds = (type: string) => [
    ...new Set(
      rows
        .filter((row) => row.record_type === type)
        .map((row) => row.record_id)
        .filter((value): value is string => value !== null),
    ),
  ];
  const students = recordIds('student');
  if (students.length > 0) {
    for (const row of await transaction
      .selectFrom('students')
      .select(['id', 'first_name', 'last_name'])
      .where('id', 'in', students)
      .execute()) {
      names.set(row.id, `${row.last_name} ${row.first_name}`);
    }
  }
  const relatives = recordIds('relative');
  if (relatives.length > 0) {
    for (const row of await transaction
      .selectFrom('relatives')
      .select(['id', 'full_name'])
      .where('id', 'in', relatives)
      .execute()) {
      names.set(row.id, row.full_name);
    }
  }
  const assignmentIds = [
    ...new Set(rows.map((row) => row.assignment_id).filter((value) => value !== null)),
  ];
  const roles = new Map<string, string>();
  if (assignmentIds.length > 0) {
    // `assignments` has no row filter: kept here to the branches of the
    // transaction and to the roles with none (`.claude/rules/database.md`).
    for (const row of await transaction
      .selectFrom('assignments')
      .select(['id', 'role', 'branch_id'])
      .where('id', 'in', assignmentIds)
      .execute()) {
      if (row.branch_id === null || branchIds.includes(row.branch_id)) {
        roles.set(row.id, row.role);
      }
    }
  }
  return rows.map((row) => {
    const values = hide
      ? hideIdentity({
          action: row.action,
          recordType: row.record_type,
          personId: row.person_id,
          oldValue: row.old_value,
          newValue: row.new_value,
          details: row.details,
        })
      : { oldValue: row.old_value, newValue: row.new_value, details: row.details, hidden: [] };
    const role = row.assignment_id === null ? undefined : roles.get(row.assignment_id);
    const parsedRole = role === undefined ? undefined : roleSchema.safeParse(role);
    return {
      id: row.id,
      occurredAt: row.occurred_at.toISOString(),
      branchId: row.branch_id,
      action: row.action,
      actor:
        row.actor_id === null
          ? null
          : { id: row.actor_id, name: names.get(row.actor_id) ?? null },
      assignment:
        row.assignment_id !== null && parsedRole?.success === true
          ? { id: row.assignment_id, role: parsedRole.data }
          : null,
      person:
        row.person_id === null
          ? null
          : { id: row.person_id, name: names.get(row.person_id) ?? null },
      record:
        row.record_type === null || row.record_id === null
          ? null
          : { type: row.record_type, id: row.record_id, name: names.get(row.record_id) ?? null },
      oldValue: values.oldValue,
      newValue: values.newValue,
      details: values.details,
      reason: row.reason,
      hidden: values.hidden,
    };
  });
}
