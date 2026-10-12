import { Injectable } from '@nestjs/common';
import {
  DEFAULT_TIME_ZONE,
  schoolDateOf,
  type Appointment,
  type AppointmentList,
} from '@sodiq/shared';
import { transactionMoment, Transactions } from '../../database/transactions.js';
import { appointedSubjects } from '../access/appointment-subjects.js';
import type { Access } from '../access/permission.guard.js';
import { subjectsInScope } from '../access/subject-scope.js';
import { actorsOf } from './actors.js';

/**
 * The Head Teacher and Senior Head Teacher appointments of a branch (task
 * 2.3b-1, area `head_teachers`), the first route with subject scope. `02`:
 * the Principal "views everything in the branch"; a request goes to the Head
 * Teacher of the subject (Who approves); a Senior Head Teacher "Sees the Head
 * Teachers of those subjects". A Head Teacher or Senior Head Teacher sees the
 * subjects of their own appointments only (Scope), and an appointment with
 * none of them is left out.
 */
@Injectable()
export class HeadTeachers {
  constructor(private readonly transactions: Transactions) {}

  list(access: Access): Promise<AppointmentList> {
    const branchId = access.branchId;
    if (branchId === null) {
      throw new Error('The list of appointments works for the branch of the request.');
    }
    const scope = subjectsInScope(access);
    // The branch of the request only: a holder is named when their staff
    // record is linked to it, by login otherwise (decision 14 of #63).
    return this.transactions.run(access.branchIds, async (transaction) => {
      const now = await transactionMoment(transaction);
      // `assignments` has no row policy: the rows of this branch and the
      // Senior Head Teachers, who have none, are chosen here.
      const rows = await transaction
        .selectFrom('assignments')
        .leftJoin('branches', 'branches.id', 'assignments.branch_id')
        .select([
          'assignments.id',
          'assignments.role',
          'assignments.account_id',
          'assignments.valid_from',
          'assignments.valid_until',
          'branches.time_zone',
        ])
        .where((builder) =>
          builder.or([
            builder.and([
              builder('assignments.role', '=', 'head_teacher'),
              builder('assignments.branch_id', '=', branchId),
            ]),
            builder('assignments.role', '=', 'senior_head_teacher'),
          ]),
        )
        // Current and planned; one taken back before it began was never in force.
        .where((builder) =>
          builder.or([
            builder('assignments.valid_until', 'is', null),
            builder.and([
              builder('assignments.valid_until', '>', now),
              builder('assignments.valid_until', '>', builder.ref('assignments.valid_from')),
            ]),
          ]),
        )
        .orderBy('assignments.role')
        .orderBy('assignments.valid_from')
        .orderBy('assignments.id')
        .execute();
      const subjects = await appointedSubjects(
        transaction,
        rows.map((row) => row.id),
      );
      const people = await actorsOf(
        transaction,
        rows.map((row) => row.account_id),
      );
      const appointments: Appointment[] = [];
      for (const row of rows) {
        const seen = (subjects.get(row.id) ?? []).filter(
          (subject) => scope === 'all' || scope.has(subject.id.toLowerCase()),
        );
        const person = people.get(row.account_id);
        if (seen.length === 0 || person === undefined) {
          continue;
        }
        const zone = row.time_zone ?? DEFAULT_TIME_ZONE;
        appointments.push({
          id: row.id,
          role: row.role === 'senior_head_teacher' ? 'senior_head_teacher' : 'head_teacher',
          person,
          subjects: seen,
          from: schoolDateOf(row.valid_from, zone),
          until: row.valid_until === null ? null : schoolDateOf(row.valid_until, zone),
          state: row.valid_from > now ? 'planned' : 'current',
        });
      }
      return { appointments };
    });
  }
}
