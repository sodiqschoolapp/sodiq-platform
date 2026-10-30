import type { BlockGroup, BlockRow } from '@sodiq/timetable-rules';
import { blocksOfRows } from '@sodiq/timetable-rules';
import type { Transaction } from '../../database/transactions.js';
import { groupPlacementGaps } from '../classes/class-groups.js';
import type { StoredLoadRow } from './load-facts.js';

/** A stored row as the blocks read it. */
export const blockRowOf = (row: StoredLoadRow): BlockRow => ({
  id: row.id,
  classId: row.class_id,
  groupId: row.group_id,
  subjectId: row.subject_id,
  teacherId: row.teacher_id,
  lessonsPerWeek: row.lessons_per_week,
  mixedBlock: row.mixed_block,
});

/**
 * The groups named, with their subject, classes and the grades of those
 * classes, as `loadBlocks` reads them (task 3.4b, decision 2). Only the groups
 * the transaction sees: the rows of a version name the groups of its branch.
 */
export async function readBlockGroups(
  transaction: Transaction,
  ids: readonly (string | null)[],
): Promise<Map<string, BlockGroup>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))].sort();
  if (wanted.length === 0) {
    return new Map();
  }
  const [groups, classes] = await Promise.all([
    transaction
      .selectFrom('groups')
      .select(['id', 'subject_id'])
      .where('id', 'in', wanted)
      .execute(),
    transaction
      .selectFrom('group_classes')
      .innerJoin('classes', 'classes.id', 'group_classes.class_id')
      .select(['group_classes.group_id', 'group_classes.class_id', 'classes.grade'])
      .where('group_classes.group_id', 'in', wanted)
      .orderBy('group_classes.class_id')
      .execute(),
  ]);
  return new Map(
    groups.map((group) => {
      const own = classes.filter((one) => one.group_id === group.id);
      return [
        group.id,
        {
          id: group.id,
          subjectId: group.subject_id,
          classIds: own.map((one) => one.class_id),
          grades: [...new Set(own.map((one) => one.grade))].sort((a, b) => a - b),
        },
      ];
    }),
  );
}

/**
 * Decision 4 (`load_group_gaps`): for each group row of the version, the
 * students of its block's classes who from `from` on hold a day with no group
 * row of the subject (`group_placement_gaps`, 0049), or whose group of the
 * subject has no row in the version ("A block is valid when every student of
 * its classes is in exactly one of its lessons", edge/timetable, Structure).
 * The same count for every row of a block; nothing for a class row.
 */
export async function readUnplaced(
  transaction: Transaction,
  branchId: string,
  rows: readonly StoredLoadRow[],
  groups: ReadonlyMap<string, BlockGroup>,
  from: string,
): Promise<Map<string, number>> {
  const blockRows = rows.map(blockRowOf);
  // Task 10.1b: every row's block worked out at once.
  const blocks = blocksOfRows(blockRows, groups);
  const counts = new Map<string, number>();
  for (const row of blockRows) {
    if (row.groupId === null || counts.has(row.id)) continue;
    const block = blocks.get(row.id) ?? [];
    const classIds = [
      ...new Set(
        block.flatMap((part) =>
          part.groupId === null ? [] : (groups.get(part.groupId)?.classIds ?? []),
        ),
      ),
    ].sort();
    const blockGroups = block.map((part) => part.groupId).filter((id): id is string => id !== null);
    const students = new Set<string>();
    if (classIds.length > 0) {
      for (const gap of await groupPlacementGaps(
        transaction,
        branchId,
        classIds,
        row.subjectId,
        from,
      )) {
        students.add(gap.studentId);
      }
      const elsewhere = await transaction
        .selectFrom('group_memberships')
        .innerJoin('group_classes', 'group_classes.group_id', 'group_memberships.group_id')
        .innerJoin('class_memberships', (join) =>
          join
            .onRef('class_memberships.student_id', '=', 'group_memberships.student_id')
            .onRef('class_memberships.class_id', '=', 'group_classes.class_id'),
        )
        .select('group_memberships.student_id')
        .distinct()
        .where('group_memberships.subject_id', '=', row.subjectId)
        .where('group_classes.class_id', 'in', classIds)
        .where('group_memberships.group_id', 'not in', blockGroups)
        .whereRef('group_memberships.valid_from', '<', 'group_memberships.valid_until')
        .where('group_memberships.valid_until', '>', from)
        .whereRef('class_memberships.valid_from', '<', 'class_memberships.valid_until')
        .where('class_memberships.valid_until', '>', from)
        .whereRef('class_memberships.valid_from', '<', 'group_memberships.valid_until')
        .whereRef('group_memberships.valid_from', '<', 'class_memberships.valid_until')
        .execute();
      for (const one of elsewhere) {
        students.add(one.student_id);
      }
    }
    for (const part of block) {
      counts.set(part.id, students.size);
    }
  }
  return counts;
}
