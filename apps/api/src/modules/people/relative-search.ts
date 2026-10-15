import { Injectable } from '@nestjs/common';
import { limited, type RelativeSearch as RelativeSearchAnswer } from '@sodiq/shared';
import { Transactions } from '../../database/transactions.js';
import type { Access } from '../access/permission.guard.js';
import { byText, namesMatch, phoneMatches } from './search-match.js';

/**
 * Ctrl+K over relatives (task 3.5b, H33 of issue #105; `04`, Finding
 * relatives; `edge/people-roles-accounts`, the Ctrl+K row; the owner's answer
 * L157 on issue #42): for the readers of the area `relatives` (the Super
 * Admin, the Principal and the Academic Vice Principal), the relatives linked
 * to a student of the branch of the request, by every typed word of the
 * folded name or by the main phone from 4 digits. Each with the number of the
 * branch's students linked. The order is `name_key`, then the id.
 */
@Injectable()
export class RelativeSearch {
  constructor(private readonly transactions: Transactions) {}

  find(access: Access, typed: string): Promise<RelativeSearchAnswer> {
    const branchId = access.branchId;
    if (branchId === null) {
      throw new Error('A search route works for the branch of the request.');
    }
    return this.transactions.run(access.branchIds, async (transaction) => {
      const rows = await transaction
        .selectFrom('relatives')
        .innerJoin('student_relatives', 'student_relatives.relative_id', 'relatives.id')
        .select((eb) => [
          'relatives.id',
          'relatives.full_name',
          'relatives.name_key',
          'relatives.phone',
          eb.fn.count<string>('student_relatives.student_id').distinct().as('students'),
        ])
        .where('student_relatives.branch_id', '=', branchId)
        .where('student_relatives.unlinked_at', 'is', null)
        .groupBy(['relatives.id', 'relatives.full_name', 'relatives.name_key', 'relatives.phone'])
        .execute();
      const found = rows
        .filter((row) => namesMatch(typed, [row.full_name]) || phoneMatches(typed, row.phone))
        .sort((a, b) => byText(a.name_key, b.name_key) || byText(a.id, b.id));
      const { items, more } = limited(found);
      return {
        items: items.map((row) => ({
          id: row.id,
          fullName: row.full_name,
          phone: row.phone,
          students: Number(row.students),
        })),
        more,
      };
    });
  }
}
