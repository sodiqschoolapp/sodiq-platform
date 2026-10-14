import { Inject, Injectable } from '@nestjs/common';
import {
  limited,
  schoolDateOf,
  spellingKey,
  type Clock,
  type StaffSearch as StaffSearchAnswer,
  type StaffStatus,
} from '@sodiq/shared';
import { CLOCK } from '../../clock/clock.module.js';
import { Transactions } from '../../database/transactions.js';
import type { Access } from '../access/permission.guard.js';
import {
  byText,
  identitySearcherOf,
  jshshirMatches,
  namesMatch,
  phoneMatches,
} from './search-match.js';

/**
 * A staff ID found from its letter and 3 digits, with or without the dash and
 * in either case (decision 11, as a UID from 3 digits): "s-260", "S260001".
 */
const STAFF_ID_PREFIX = /^s[0-9]{3,6}$/;

const staffIdKey = (text: string): string => text.replace(/[\s-]+/g, '').toLowerCase();

/**
 * Ctrl+K over staff (task 3.2d, pull request #94): the people (not vacancies)
 * linked to the branch of the request, as `GET people/staff/:id` opens them.
 * Found by every typed word in the folded first, last and paternal names (in
 * either order) and by the staff ID; the Super Admin and the Academic Vice
 * Principal also by the phone and the JSHSHIR (decision 2, Look first). Every
 * status is found, with the status the staff list shows (correction 1 of the
 * plan review). The order is the folded last and first name, then the id.
 */
@Injectable()
export class StaffSearch {
  constructor(
    private readonly transactions: Transactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  find(access: Access, typed: string): Promise<StaffSearchAnswer> {
    const branchId = access.branchId;
    if (branchId === null) {
      throw new Error('A search route works for the branch of the request.');
    }
    const identity = identitySearcherOf(access) !== undefined;
    const idKey = staffIdKey(typed);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const rows = await transaction
        .selectFrom('staff')
        .innerJoin('staff_branches', 'staff_branches.staff_id', 'staff.id')
        .select([
          'staff.id',
          'staff.staff_id',
          'staff.first_name',
          'staff.last_name',
          'staff.father_name',
          'staff.phone',
          'staff.jshshir',
        ])
        .where('staff.kind', '=', 'person')
        .where('staff_branches.branch_id', '=', branchId)
        .execute();
      const found = rows
        .map((row) => ({
          ...row,
          staffId: row.staff_id ?? '',
          firstName: row.first_name ?? '',
          lastName: row.last_name ?? '',
          key: `${spellingKey(row.last_name ?? '')} ${spellingKey(row.first_name ?? '')}`,
        }))
        .filter(
          (row) =>
            namesMatch(typed, [row.lastName, row.firstName, row.father_name]) ||
            (STAFF_ID_PREFIX.test(idKey) && staffIdKey(row.staffId).startsWith(idKey)) ||
            // Nobody else's query is ever compared with these fields (decision 2).
            (identity && (phoneMatches(typed, row.phone) || jshshirMatches(typed, row.jshshir))),
        )
        .sort((a, b) => byText(a.key, b.key) || byText(a.id, b.id));
      const { items, more } = limited(found);
      if (items.length === 0) {
        return { items: [], more };
      }
      const ids = items.map((row) => row.id);
      // The status as the staff list reads it: today in the time zone of the
      // main branch when the row filter lets it be seen, else of the branch of
      // the request (the only link a reader other than the Super Admin sees).
      const links = await transaction
        .selectFrom('staff_branches')
        .innerJoin('branches', 'branches.id', 'staff_branches.branch_id')
        .select(['staff_branches.staff_id', 'branches.time_zone'])
        .where('staff_branches.staff_id', 'in', ids)
        .orderBy('staff_branches.is_main', 'desc')
        .orderBy('branches.name')
        .execute();
      const statuses = await transaction
        .selectFrom('staff_statuses')
        .select(['staff_id', 'status', 'valid_from', 'valid_until'])
        .where('staff_id', 'in', ids)
        .whereRef('valid_until', 'is distinct from', 'valid_from')
        .orderBy('valid_from')
        .execute();
      const now = this.clock.now();
      return {
        items: items.map((row) => {
          const zone = links.find((link) => link.staff_id === row.id)?.time_zone ?? 'Asia/Tashkent';
          const today = schoolDateOf(now, zone);
          const current = statuses.find(
            (status) =>
              status.staff_id === row.id &&
              status.valid_from <= today &&
              (status.valid_until === null || status.valid_until > today),
          );
          return {
            id: row.id,
            staffId: row.staffId,
            firstName: row.firstName,
            lastName: row.lastName,
            status: (current?.status as StaffStatus | undefined) ?? null,
          };
        }),
        more,
      };
    });
  }
}
