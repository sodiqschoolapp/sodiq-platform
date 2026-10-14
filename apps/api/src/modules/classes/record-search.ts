import { Injectable } from '@nestjs/common';
import {
  academicYearName,
  classDisplayName,
  classNameKey,
  limited,
  searchWords,
  spellingKey,
  type ClassSearch as ClassSearchAnswer,
  type GroupSearch as GroupSearchAnswer,
} from '@sodiq/shared';
import { Transactions } from '../../database/transactions.js';
import { classesInScope } from '../access/class-scope.js';
import { inGroupScope } from '../access/group-scope.js';
import type { Access } from '../access/permission.guard.js';

/**
 * Whether a class or group name matches the typed text as the lists match it
 * (`matchingRows` with `searchFold`; `.claude/rules/web.md`, the
 * `classNameKey` line): every typed word folded by `spellingKey` is found in
 * the folded texts, or the whole typed text folded by `classNameKey` is found
 * in the name folded so, so "7 Оxford" with a Cyrillic О finds "7 Oxford".
 */
function nameMatches(typed: string, name: string, others: readonly string[] = []): boolean {
  const words = searchWords(typed);
  const haystack = spellingKey([name, ...others].join('\n'));
  return (
    (words !== null && words.every((word) => haystack.includes(word))) ||
    classNameKey(name).includes(classNameKey(typed))
  );
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('A search route works for the branch of the request.');
  }
  return access.branchId;
}

/**
 * Ctrl+K over classes and groups (task 3.2d, pull request #94): the records
 * of the branch of the request in the scope of the list routes (a Tutor's own
 * classes and the groups that draw from them; a Head Teacher's groups of own
 * subjects), not archived, of a year that is not closed (decision 5). The
 * scope is applied before the limit.
 */
@Injectable()
export class RecordSearch {
  constructor(private readonly transactions: Transactions) {}

  /**
   * Classes by their display name ("7 Oxford"), ordered by grade, then the
   * name folded as `classes.name_key` stores it (`class_name_key`), then the id.
   */
  classes(access: Access, typed: string): Promise<ClassSearchAnswer> {
    const branchId = branchOf(access);
    const scope = classesInScope(access.permitting);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const rows = await transaction
        .selectFrom('classes')
        .innerJoin('academic_years', 'academic_years.id', 'classes.academic_year_id')
        .select([
          'classes.id',
          'classes.grade',
          'classes.name',
          'academic_years.start_date',
          'academic_years.end_date',
        ])
        .where('classes.branch_id', '=', branchId)
        .where('classes.archived_at', 'is', null)
        .where('academic_years.status', '!=', 'closed')
        .execute();
      const found = rows
        .filter((row) => scope === 'all' || scope.has(row.id.toLowerCase()))
        .filter((row) => nameMatches(typed, classDisplayName(row.grade, row.name)))
        .sort(
          (a, b) =>
            a.grade - b.grade ||
            byText(classNameKey(a.name), classNameKey(b.name)) ||
            byText(a.id, b.id),
        );
      const { items, more } = limited(found);
      return {
        items: items.map((row) => ({
          id: row.id,
          grade: row.grade,
          name: row.name,
          yearName: academicYearName(row.start_date, row.end_date),
        })),
        more,
      };
    });
  }

  /**
   * Groups by their name, or by their subject's name in any of its three
   * languages, so the answer does not depend on the reader's language.
   */
  groups(access: Access, typed: string): Promise<GroupSearchAnswer> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const rows = await transaction
        .selectFrom('groups')
        .innerJoin('academic_years', 'academic_years.id', 'groups.academic_year_id')
        .innerJoin('subjects', 'subjects.id', 'groups.subject_id')
        .select([
          'groups.id',
          'groups.name',
          'groups.subject_id',
          'subjects.name_uz',
          'subjects.name_ru',
          'subjects.name_en',
          'academic_years.start_date',
          'academic_years.end_date',
        ])
        .where('groups.branch_id', '=', branchId)
        .where('groups.archived_at', 'is', null)
        .where('academic_years.status', '!=', 'closed')
        .execute();
      const classIds = new Map<string, string[]>();
      if (rows.length > 0) {
        const links = await transaction
          .selectFrom('group_classes')
          .select(['group_id', 'class_id'])
          .where(
            'group_id',
            'in',
            rows.map((row) => row.id),
          )
          .execute();
        for (const link of links) {
          classIds.set(link.group_id, [...(classIds.get(link.group_id) ?? []), link.class_id]);
        }
      }
      const found = rows
        .filter(
          (row) =>
            inGroupScope(access.permitting, {
              subjectId: row.subject_id,
              classIds: classIds.get(row.id) ?? [],
            }) !== undefined,
        )
        .filter((row) => nameMatches(typed, row.name, [row.name_uz, row.name_ru, row.name_en]))
        .sort((a, b) => byText(classNameKey(a.name), classNameKey(b.name)) || byText(a.id, b.id));
      const { items, more } = limited(found);
      return {
        items: items.map((row) => ({
          id: row.id,
          name: row.name,
          subject: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
          yearName: academicYearName(row.start_date, row.end_date),
        })),
        more,
      };
    });
  }
}
