import type { AuditAction, PersonalDataKind } from '@sodiq/shared';
import { sql, type Expression, type ExpressionBuilder, type SqlBool } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import type { DB } from '../../database/types.generated.js';
import type { StoredEntry } from '../audit/audit-entries.query.js';

/** The person whose entries a report reads (task 2.6b, decision 7 as changed by correction 1). */
export interface ReportPerson {
  kind: PersonalDataKind;
  id: string;
  /** The staff member's account, `null` for none and for a student or relative. */
  accountId: string | null;
  /** Every assignment of that account, ended ones too. */
  assignmentIds: readonly string[];
}

/** How an entry is about a person: the reason it is in that person's report. */
type About =
  /** The record is the person's own record (`student`, `staff`, `relative`). */
  | 'record'
  /** `person_id` names the person. */
  | 'person'
  /** The record is the staff member's account. */
  | 'account'
  /** The record is an assignment of the staff member's account. */
  | 'assignment'
  /** The staff member's own sign-in event, by their account as actor. */
  | 'ownAuth'
  /** The person's id is inside the values, by `VALUE_MATCHES`. */
  | 'values'
  /** About no person: a vacancy is a staff row with no person; an export names none. */
  | 'none';

type PeopleAction =
  | Extract<
      AuditAction,
      `${'auth' | 'account' | 'assignment' | 'staff' | 'student' | 'relative' | 'vacancy'}.${string}`
    >
  | 'audit.entry_shown';

/**
 * Every action whose record is a student, a staff row, a relative, an
 * account, an assignment or a session, with the matches that put it into a
 * report (correction 1 of the plan review: a later action must not fall out
 * silently). The type refuses a people action that is not listed; the
 * `values` actions are those of `VALUE_MATCHES`, which a test compares.
 * Where each entry is written: the hand-back of the plan's code survey,
 * summarised in the comments.
 */
export const ENTRY_ABOUT: Readonly<Record<PeopleAction, readonly About[]>> = {
  // School-wide log, record a session (actor the account) or the account.
  'auth.sign_in': ['ownAuth'],
  'auth.sign_in_failed': ['account'],
  'auth.sign_in_locked': ['account'],
  'auth.sign_in_inactive': ['account'],
  'auth.second_step_passed': ['ownAuth'],
  'auth.second_step_failed': ['ownAuth'],
  'auth.recovery_code_used': ['account'],
  'auth.sign_out': ['ownAuth'],
  'auth.sign_out_everywhere': ['account'],
  'auth.session_idle': ['ownAuth'],
  'auth.session_expired': ['ownAuth'],
  'auth.device_trusted': ['ownAuth'],
  'auth.trust_ended': ['ownAuth'],
  'auth.trusted_device_removed': ['ownAuth'],
  'auth.password_change': ['account'],
  'auth.password_change_failed': ['account'],
  'auth.password_reset_requested': ['account'],
  'auth.password_reset_mail_sent': ['account'],
  'auth.password_reset_by_email': ['account'],
  // Record the account; an administrator's change also names the person.
  'account.create': ['account', 'person'],
  'account.linked': ['account', 'person'],
  'account.language_changed': ['account'],
  'account.locked': ['account', 'person'],
  'account.unlocked': ['account', 'person'],
  'account.password_reset': ['account', 'person'],
  'account.rehire_password': ['account', 'person'],
  'account.second_step_started': ['account'],
  'account.second_step_on': ['account'],
  'account.second_step_off': ['account'],
  'account.second_step_reset': ['account', 'person'],
  'account.second_step_unreadable': ['account'],
  // Record the assignment; given from a record, also the person.
  'assignment.given': ['assignment', 'person'],
  'assignment.end': ['assignment', 'person'],
  'assignment.end_withdrawn': ['assignment', 'person'],
  'assignment.ended': ['assignment', 'person'],
  'assignment.subjects_changed': ['assignment', 'person'],
  'staff.create': ['record', 'person'],
  'staff.edit': ['record', 'person'],
  'staff.teaching': ['record', 'person'],
  'staff.branches': ['record', 'person'],
  'staff.status': ['record', 'person'],
  'staff.photo': ['record', 'person'],
  'staff.availability_set': ['record', 'person'],
  'staff.availability_end': ['record', 'person'],
  'staff.identity_shown': ['record', 'person'],
  'staff.export': ['none'],
  'staff.personal_data_report': ['record', 'person'],
  'vacancy.create': ['none'],
  'vacancy.edit': ['none'],
  'vacancy.close': ['none'],
  'vacancy.reopen': ['none'],
  'vacancy.delete': ['none'],
  'vacancy.export': ['none'],
  'student.create': ['record'],
  'student.edit': ['record'],
  'student.uid_corrected': ['record'],
  'student.photo': ['record'],
  'student.leave': ['record'],
  'student.leave_cancelled': ['record'],
  'student.leave_undone': ['record'],
  'student.return': ['record'],
  'student.graduate_restored': ['record'],
  'student.delete': ['record'],
  // Task 3.1b: on the student record, so the report and the history read them.
  'student.class_joined': ['record'],
  'student.class_withdrawn': ['record'],
  'student.group_joined': ['record'],
  'student.group_withdrawn': ['record'],
  'student.group_reviewed': ['record'],
  'student.identity_shown': ['record'],
  'student.export': ['none'],
  'student.personal_data_report': ['record', 'person'],
  'relative.create': ['record'],
  'relative.edit': ['record'],
  'relative.archive': ['record'],
  'relative.restore': ['record'],
  // The student of the link is in the values (correction 1).
  'relative.link': ['record', 'values'],
  'relative.link_edit': ['record', 'values'],
  'relative.link_moved': ['record', 'values'],
  'relative.unlink': ['record', 'values'],
  // The other relative of a merge or a phone, and the staff record of a mark.
  'relative.merge': ['record', 'values'],
  'relative.merged': ['record', 'values'],
  'relative.phone_released': ['record', 'values'],
  'relative.same_person': ['record', 'values'],
  'relative.same_person_removed': ['record', 'values'],
  'relative.show': ['record'],
  'relative.personal_data_report': ['record', 'person'],
  // Copies the record and person of the entry shown.
  'audit.entry_shown': ['record', 'person'],
};

type ValueColumn = 'old_value' | 'new_value' | 'details';

interface ValueMatch {
  actions: readonly AuditAction[];
  paths: readonly (readonly [ValueColumn, string])[];
}

/**
 * The person's id inside the values of an entry whose record is someone
 * else (correction 1): the student of a link, the staff record of a "same
 * person" mark or a merge, the other relative of a merge or a phone.
 */
export const VALUE_MATCHES: Readonly<Record<PersonalDataKind, readonly ValueMatch[]>> = {
  student: [
    {
      actions: ['relative.link', 'relative.unlink', 'relative.link_edit', 'relative.link_moved'],
      paths: [
        ['old_value', 'studentId'],
        ['new_value', 'studentId'],
      ],
    },
  ],
  staff: [
    {
      actions: [
        'relative.same_person',
        'relative.same_person_removed',
        'relative.merge',
        'relative.merged',
      ],
      paths: [
        ['old_value', 'staffId'],
        ['new_value', 'staffId'],
        ['details', 'staffId'],
      ],
    },
  ],
  relative: [
    { actions: ['relative.phone_released'], paths: [['details', 'newOwnerId']] },
    { actions: ['relative.merge', 'relative.link_edit'], paths: [['details', 'mergedId']] },
    { actions: ['relative.merged'], paths: [['details', 'keptId']] },
    {
      actions: ['relative.unlink'],
      paths: [
        ['details', 'mergedInto'],
        ['new_value', 'newMainContactId'],
      ],
    },
    {
      actions: ['relative.link_moved'],
      paths: [
        ['old_value', 'relativeId'],
        ['new_value', 'relativeId'],
      ],
    },
  ],
};

type LogTable = 'audit_log' | 'audit_log_school';

/** The entries about one person, on the columns of either log. */
function aboutPerson(person: ReportPerson) {
  return (builder: ExpressionBuilder<DB, LogTable>): Expression<SqlBool> => {
    const eb = builder;
    const either: Expression<SqlBool>[] = [
      eb('person_id', '=', person.id),
      eb.and([eb('record_type', '=', person.kind), eb('record_id', '=', person.id)]),
    ];
    if (person.accountId !== null) {
      either.push(
        eb.and([eb('record_type', '=', 'account'), eb('record_id', '=', person.accountId)]),
        eb.and([eb('actor_id', '=', person.accountId), eb('action', 'like', 'auth.%')]),
      );
    }
    if (person.assignmentIds.length > 0) {
      either.push(
        eb.and([
          eb('record_type', '=', 'assignment'),
          eb('record_id', 'in', [...person.assignmentIds]),
        ]),
      );
    }
    for (const match of VALUE_MATCHES[person.kind]) {
      either.push(
        eb.and([
          eb('action', 'in', [...match.actions]),
          eb.or(
            match.paths.map(
              ([column, key]) => sql<SqlBool>`${sql.ref(column)} ->> ${key} = ${person.id}`,
            ),
          ),
        ]),
      );
    }
    return eb.or(either);
  };
}

const COLUMNS = [
  'id',
  'occurred_at',
  'actor_id',
  'person_id',
  'assignment_id',
  'action',
  'record_type',
  'record_id',
  'old_value',
  'new_value',
  'details',
  'reason',
] as const;

function sourceOf(transaction: Transaction, person: ReportPerson) {
  const branchPart = transaction
    .selectFrom('audit_log')
    .select([...COLUMNS, sql<string | null>`branch_id`.as('branch_id')])
    .where((eb) => aboutPerson(person)(eb as unknown as ExpressionBuilder<DB, LogTable>));
  const schoolPart = transaction
    .selectFrom('audit_log_school')
    .select([...COLUMNS, sql<string | null>`null::uuid`.as('branch_id')])
    .where((eb) => aboutPerson(person)(eb as unknown as ExpressionBuilder<DB, LogTable>));
  return branchPart.unionAll(schoolPart);
}

export interface PersonEntries {
  rows: StoredEntry[];
  /** Every entry about the person, the rows included. */
  total: number;
  /** The moment of the oldest entry about the person; `null` when there is none. */
  oldestAt: Date | null;
}

/**
 * Every entry about the person from both logs, newest first, at most `limit`
 * (decision 11), and in a second statement the count and the oldest moment of
 * them all. Runs in the caller's transaction, whose row filter limits
 * `audit_log`: every branch for the report.
 */
export async function readPersonEntries(
  transaction: Transaction,
  person: ReportPerson,
  limit: number,
): Promise<PersonEntries> {
  const rows = await transaction
    .selectFrom(sourceOf(transaction, person).as('e'))
    .selectAll()
    .orderBy('e.occurred_at', 'desc')
    .orderBy('e.id', 'desc')
    .limit(limit)
    .execute();
  const counted = await transaction
    .selectFrom(sourceOf(transaction, person).as('e'))
    .select((eb) => [eb.fn.countAll<string>().as('total'), eb.fn.min('e.occurred_at').as('oldest')])
    .executeTakeFirstOrThrow();
  return {
    rows,
    total: Number(counted.total),
    oldestAt: counted.oldest === null ? null : new Date(counted.oldest),
  };
}
