import {
  schoolDateOf,
  type ClassTutor,
  type ClassTutorEndCause,
  type ClassTutorKind,
  type ClassTutorState,
  type ErrorCode,
} from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';

/**
 * The refusals of the database for classes and their Tutors
 * (db/migrations/0042), by the name of the constraint or trigger check. The
 * services check the same rules first where they can name the field; these
 * answer when two requests race past those checks, or at the commit of a
 * deferred check (the language rule).
 */
export const CLASS_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  class_year_closed: 'class_year_closed',
  classes_room_closed: 'room_closed',
  class_tutors_one_tutor: 'class_tutor_taken',
  class_tutors_one_acting: 'class_tutor_taken',
  class_tutors_language: 'tutor_language',
  class_tutors_not_tutor: 'tutor_not_tutor',
  class_tutors_class_archived: 'class_archived',
  class_tutors_outside_role: 'tutor_outside_role',
  class_tutors_start_past: 'tutor_date_past',
  class_tutors_end_past: 'tutor_date_past',
  class_tutors_end_final: 'tutor_ended',
  staff_languages_tutor_held: 'tutor_language_held',
};

/**
 * The refusals a change of a role's end meets on the Tutor rows it carries
 * (`assignments_class_tutors_end`, db/migrations/0042): a role end taken back
 * brings a row back over a Tutor given meanwhile, or to a class whose language
 * the person no longer teaches. For the routes that end roles.
 */
export const ROLE_END_TUTOR_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  class_tutors_one_tutor: 'class_tutor_taken',
  class_tutors_one_acting: 'class_tutor_taken',
  class_tutors_language: 'tutor_language',
};

/** A Tutor row as the database holds it, with the person of its assignment. */
export interface TutorRow {
  id: string;
  class_id: string;
  assignment_id: string;
  kind: string;
  valid_from: Date;
  valid_until: Date | null;
  end_cause: string | null;
  staff_id: string | null;
  first_name: string | null;
  last_name: string | null;
}

/** Ended: its end has come, or it was withdrawn before it began (an empty range). */
export const tutorEnded = (
  row: { valid_from: Date; valid_until: Date | null },
  now: Date,
): boolean =>
  row.valid_until !== null && (row.valid_until <= now || row.valid_until <= row.valid_from);

export function tutorState(
  row: { valid_from: Date; valid_until: Date | null },
  now: Date,
): ClassTutorState {
  if (tutorEnded(row, now)) {
    return 'ended';
  }
  return row.valid_from > now ? 'planned' : 'current';
}

/** A row as the answers name it, with its dates in the branch's time zone. */
export function toClassTutor(row: TutorRow, now: Date, zone: string): ClassTutor {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    staffId: row.staff_id,
    name:
      row.first_name === null || row.last_name === null
        ? null
        : { firstName: row.first_name, lastName: row.last_name },
    // The checks of the table keep the lists equal to the schemas'.
    kind: row.kind as ClassTutorKind,
    from: schoolDateOf(row.valid_from, zone),
    until: row.valid_until === null ? null : schoolDateOf(row.valid_until, zone),
    state: tutorState(row, now),
    endCause: row.end_cause as ClassTutorEndCause | null,
  };
}

/**
 * The Tutor rows of the classes the transaction sees, with the name of the
 * staff record of each assignment's account (the membership filter shows a
 * person linked to the branch). Newest start first.
 */
export function tutorRowsIn(transaction: Transaction) {
  return transaction
    .selectFrom('class_tutors')
    .innerJoin('assignments', 'assignments.id', 'class_tutors.assignment_id')
    .leftJoin('staff', (join) =>
      join.onRef('staff.account_id', '=', 'assignments.account_id').on('staff.kind', '=', 'person'),
    )
    .select([
      'class_tutors.id',
      'class_tutors.class_id',
      'class_tutors.assignment_id',
      'class_tutors.kind',
      'class_tutors.valid_from',
      'class_tutors.valid_until',
      'class_tutors.end_cause',
      'staff.id as staff_id',
      'staff.first_name',
      'staff.last_name',
    ])
    .orderBy('class_tutors.valid_from', 'desc')
    .orderBy('class_tutors.id');
}

/** The end of each Tutor row of an assignment, for the audit entry of a change of its end. */
export interface TutorEnd {
  id: string;
  classId: string;
  validUntil: string | null;
}

async function tutorEndsOf(transaction: Transaction, assignmentId: string): Promise<TutorEnd[]> {
  const rows = await transaction
    .selectFrom('class_tutors')
    .select(['id', 'class_id', 'valid_until'])
    .where('assignment_id', '=', assignmentId)
    .orderBy('id')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    classId: row.class_id,
    validUntil: row.valid_until?.toISOString() ?? null,
  }));
}

/**
 * Runs a change of the end of an assignment and answers the Tutor rows whose
 * end the mirror moved (`assignments_class_tutors_end`), old and new end, so
 * that the audit entry of the role end, the `left` or its taking back names
 * them (task 3.1a, decision 20). The rows are of the assignment's branch,
 * which the transactions of those routes see.
 */
export async function trackingTutorEnds(
  transaction: Transaction,
  assignmentId: string,
  change: () => Promise<void>,
): Promise<{ id: string; classId: string; from: string | null; to: string | null }[]> {
  const before = await tutorEndsOf(transaction, assignmentId);
  await change();
  const after = await tutorEndsOf(transaction, assignmentId);
  return after.flatMap((row) => {
    const old = before.find((one) => one.id === row.id);
    return old === undefined || old.validUntil === row.validUntil
      ? []
      : [{ id: row.id, classId: row.classId, from: old.validUntil, to: row.validUntil }];
  });
}
