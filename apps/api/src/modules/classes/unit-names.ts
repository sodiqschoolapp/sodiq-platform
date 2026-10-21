import type { VacancyFillUnit } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';

/**
 * The classes and groups named by id, as a person reads them (task 5.7a-3b,
 * decision 6): archived ones included, of the branch named only (the row
 * filter aside: a transaction may hold several branches). A group's grades
 * are those of its classes. Ordered by id.
 */
export async function unitNamesOf(
  transaction: Transaction,
  branchId: string,
  classIds: readonly string[],
  groupIds: readonly string[],
): Promise<VacancyFillUnit[]> {
  const classList = [...new Set(classIds)];
  const groupList = [...new Set(groupIds)];
  const classes =
    classList.length === 0
      ? []
      : await transaction
          .selectFrom('classes')
          .select(['id', 'name', 'grade'])
          .where('id', 'in', classList)
          .where('branch_id', '=', branchId)
          .execute();
  const groups =
    groupList.length === 0
      ? []
      : await transaction
          .selectFrom('groups')
          .select(['id', 'name'])
          .where('id', 'in', groupList)
          .where('branch_id', '=', branchId)
          .execute();
  const groupGrades =
    groupList.length === 0
      ? []
      : await transaction
          .selectFrom('group_classes')
          .innerJoin('classes', 'classes.id', 'group_classes.class_id')
          .select(['group_classes.group_id', 'classes.grade'])
          .where('group_classes.group_id', 'in', groupList)
          .where('group_classes.branch_id', '=', branchId)
          .where('classes.branch_id', '=', branchId)
          .execute();
  return [
    ...classes.map((one) => ({
      id: one.id,
      kind: 'class' as const,
      name: one.name,
      grades: [one.grade],
    })),
    ...groups.map((one) => ({
      id: one.id,
      kind: 'group' as const,
      name: one.name,
      grades: [
        ...new Set(groupGrades.filter((row) => row.group_id === one.id).map((row) => row.grade)),
      ].sort((a, b) => a - b),
    })),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
