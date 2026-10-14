import { Injectable } from '@nestjs/common';
import {
  limited,
  type StudentSearch as StudentSearchAnswer,
  type StudentStatus,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions } from '../../database/transactions.js';
import { studentClasses, studentReaderOf } from '../access/class-scope.js';
import type { Access } from '../access/permission.guard.js';
import { studentClassesOn } from '../classes/class-membership-rows.js';
import {
  byText,
  documentMatches,
  identitySearcherOf,
  jshshirMatches,
  namesMatch,
  phoneMatches,
} from './search-match.js';
import { statusOfStudentOn, Students } from './students.service.js';

/** A UID is found from its first 3 digits (decision 11): typed from its start. */
const UID_PREFIX = /^[0-9]{3,7}$/;

/**
 * Ctrl+K over students (task 3.2d, pull request #94). The students of the
 * branch of the request that the reader may open (`edge/people-roles-
 * accounts`: "Search returns only records the person may open"; decision 1,
 * Look first): the rule of `GET people/students/:id`, `studentReaderOf` over
 * `studentClasses`, so a Tutor finds the students of own classes in force or
 * planned and every other reader the branch. Found by every typed word in the
 * folded name or paternal name, or by the UID from 3 digits; the Super Admin
 * and the Academic Vice Principal also by the document number, the JSHSHIR
 * and the student's own phone (decision 2, Look first). Every status is
 * found, with the status today (decision 5). The scope is applied before the
 * limit; the order is `name_key`, then the id.
 */
@Injectable()
export class StudentSearch {
  constructor(
    private readonly transactions: Transactions,
    private readonly students: Students,
  ) {}

  find(access: Access, typed: string): Promise<StudentSearchAnswer> {
    const branchId = access.branchId;
    if (branchId === null) {
      throw new Error('A search route works for the branch of the request.');
    }
    const identity = identitySearcherOf(access) !== undefined;
    return this.transactions.run(access.branchIds, async (transaction) => {
      const today = await this.students.todayIn(transaction, branchId);
      const rows = await transaction
        .selectFrom('students')
        .select([
          'id',
          'uid',
          'first_name',
          'last_name',
          'paternal_name',
          'name_key',
          'document_number',
          'jshshir',
          'phone',
        ])
        .where('branch_id', '=', branchId)
        .execute();
      const scope = await studentClasses(transaction, today, null);
      const found = rows
        .filter((row) => studentReaderOf(access, 'students', scope.get(row.id) ?? []) !== undefined)
        .filter(
          (row) =>
            namesMatch(typed, [row.last_name, row.first_name, row.paternal_name]) ||
            (UID_PREFIX.test(typed) && row.uid.startsWith(typed)) ||
            // Nobody else's query is ever compared with these fields (decision 2).
            (identity &&
              (documentMatches(typed, row.document_number) ||
                jshshirMatches(typed, row.jshshir) ||
                phoneMatches(typed, row.phone))),
        )
        .sort((a, b) => byText(a.name_key, b.name_key) || byText(a.id, b.id));
      const { items, more } = limited(found);
      if (items.length === 0) {
        return { items: [], more };
      }
      const statuses = new Map(
        (
          await transaction
            .selectFrom('students')
            .select(['students.id', statusOfStudentOn(sql.ref('students.id'), today).as('status')])
            .where(
              'students.id',
              'in',
              items.map((row) => row.id),
            )
            .execute()
        ).map((row) => [row.id, row.status as StudentStatus | null]),
      );
      const classes = await studentClassesOn(transaction, today, null);
      return {
        items: items.map((row) => {
          const current = classes.get(row.id)?.current ?? null;
          return {
            id: row.id,
            uid: row.uid,
            firstName: row.first_name,
            lastName: row.last_name,
            paternalName: row.paternal_name,
            class: current === null ? null : { grade: current.grade, name: current.name },
            status: statuses.get(row.id) ?? null,
          };
        }),
        more,
      };
    });
  }
}
