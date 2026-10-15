/**
 * The blocks of a teaching load (docs/spec/edge-cases/timetable.md, Structure;
 * 06-timetable.md, Model, Parallel group lessons; task 3.4b, pull request #100).
 *
 * "The unit that occupies a class is the lesson block. A whole-class lesson is
 * a block of one; a split or a set of parallel groups is one block of several
 * lessons." "All parts have equal lessons per week and different teachers. A
 * mixed block is allowed: boys have physical education while girls have
 * technology, and the reverse in another slot." Parallel groups are "All
 * groups of one subject and one grade or pair of grades … placed in the same
 * period, each with its own teacher and room".
 *
 * Decision 2: in one version, the group rows of one subject are one block when
 * they are linked by a shared class, or by being groups across classes of the
 * same grade or pair of grades, taken as a connected set. Decision 12: the
 * rows of a split (a group of one class) marked `mixedBlock` meet in different
 * slots, so one teacher may take both halves; equal lessons still bind. The
 * database keeps the same rules (db/migrations/0056).
 */

/** A group as the blocks read it: its subject, its classes and their grades. */
export interface BlockGroup {
  readonly id: string;
  readonly subjectId: string;
  readonly classIds: readonly string[];
  readonly grades: readonly number[];
}

/** A row of a version as the blocks read it: a class row or a group row. */
export interface BlockRow {
  readonly id: string;
  readonly classId: string | null;
  readonly groupId: string | null;
  readonly subjectId: string;
  readonly teacherId: string;
  readonly lessonsPerWeek: number;
  readonly mixedBlock: boolean;
}

/** The problems of a row that its block decides, in the order they are reported. */
export const BLOCK_PROBLEM_ORDER = [
  'load_mixed_not_split',
  'load_block_mixed',
  'load_block_lessons',
  'load_block_teacher',
] as const;

export type BlockProblem = (typeof BLOCK_PROBLEM_ORDER)[number];

const gradeKey = (grades: readonly number[]) =>
  [...new Set(grades)].sort((x, y) => x - y).join(',');

const sameSet = (a: readonly number[], b: readonly number[]) => gradeKey(a) === gradeKey(b);

/** Whether two groups of one subject are linked (decision 2). */
export function groupsLinked(a: BlockGroup, b: BlockGroup): boolean {
  if (a.subjectId !== b.subjectId) {
    return false;
  }
  if (a.classIds.some((id) => b.classIds.includes(id))) {
    return true;
  }
  return a.classIds.length > 1 && b.classIds.length > 1 && sameSet(a.grades, b.grades);
}

/** The only class of a split, or `null` for a group across classes. */
export const splitClassOf = (group: BlockGroup): string | null =>
  group.classIds.length === 1 ? (group.classIds[0] ?? null) : null;

/**
 * The blocks of the version's group rows: each the ids of its rows, sorted;
 * the blocks in the order of their first id. A row whose group is not given
 * is a block of its own.
 */
export function loadBlocks(
  rows: readonly BlockRow[],
  groups: ReadonlyMap<string, BlockGroup>,
): string[][] {
  const parts = rows.filter((row) => row.groupId !== null);
  const seen = new Set<string>();
  const blocks: string[][] = [];
  for (const start of [...parts].sort((a, b) => a.id.localeCompare(b.id))) {
    if (seen.has(start.id)) continue;
    const block: string[] = [];
    const queue = [start];
    seen.add(start.id);
    while (queue.length > 0) {
      const row = queue.shift();
      if (row === undefined) break;
      block.push(row.id);
      const group = row.groupId === null ? undefined : groups.get(row.groupId);
      if (group === undefined) continue;
      for (const other of parts) {
        if (seen.has(other.id) || other.subjectId !== row.subjectId) continue;
        const otherGroup = other.groupId === null ? undefined : groups.get(other.groupId);
        if (otherGroup !== undefined && groupsLinked(group, otherGroup)) {
          seen.add(other.id);
          queue.push(other);
        }
      }
    }
    blocks.push(block.sort());
  }
  return blocks;
}

/** The rows of the block that holds `rowId`, the row itself included; empty for a class row. */
export function blockOf(
  rowId: string,
  rows: readonly BlockRow[],
  groups: ReadonlyMap<string, BlockGroup>,
): BlockRow[] {
  const block = loadBlocks(rows, groups).find((ids) => ids.includes(rowId)) ?? [];
  return rows.filter((row) => block.includes(row.id));
}

/** Whether both rows are halves of one split marked as a mixed block (decision 12). */
function mixedHalves(a: BlockRow, b: BlockRow, groups: ReadonlyMap<string, BlockGroup>): boolean {
  const groupA = a.groupId === null ? undefined : groups.get(a.groupId);
  const groupB = b.groupId === null ? undefined : groups.get(b.groupId);
  if (groupA === undefined || groupB === undefined) return false;
  const classA = splitClassOf(groupA);
  return a.mixedBlock && b.mixedBlock && classA !== null && classA === splitClassOf(groupB);
}

/**
 * The problems the block gives `row` (a group row), in their order: a mixed
 * mark on a group across classes; halves of one split that disagree on the
 * mark; another part with other lessons per week; another part with the same
 * teacher or vacancy, except the halves of a mixed split. `block` is the
 * row's block (`blockOf`), the row included.
 */
export function blockProblems(
  row: BlockRow,
  block: readonly BlockRow[],
  groups: ReadonlyMap<string, BlockGroup>,
): BlockProblem[] {
  const group = row.groupId === null ? undefined : groups.get(row.groupId);
  if (group === undefined) {
    return [];
  }
  const others = block.filter((other) => other.id !== row.id);
  const problems: BlockProblem[] = [];
  const splitClass = splitClassOf(group);
  if (row.mixedBlock && splitClass === null) {
    problems.push('load_mixed_not_split');
  }
  if (
    splitClass !== null &&
    others.some((other) => {
      const otherGroup = other.groupId === null ? undefined : groups.get(other.groupId);
      return (
        otherGroup !== undefined &&
        splitClassOf(otherGroup) === splitClass &&
        other.mixedBlock !== row.mixedBlock
      );
    })
  ) {
    problems.push('load_block_mixed');
  }
  if (others.some((other) => other.lessonsPerWeek !== row.lessonsPerWeek)) {
    problems.push('load_block_lessons');
  }
  if (
    others.some((other) => other.teacherId === row.teacherId && !mixedHalves(row, other, groups))
  ) {
    problems.push('load_block_teacher');
  }
  return problems;
}

/**
 * `05`, Group: "Whether a class is split for a subject is set in the teaching
 * load." Whether the version holds both a whole-class row and a group row for
 * one class and the subject of `row`: for a class row, a group row of its
 * subject whose group draws from the class; for a group row, a class row of
 * its subject for one of its classes.
 */
export function splitAndWhole(
  row: BlockRow,
  rows: readonly BlockRow[],
  groups: ReadonlyMap<string, BlockGroup>,
): boolean {
  const others = rows.filter((other) => other.id !== row.id && other.subjectId === row.subjectId);
  if (row.classId !== null) {
    const classId = row.classId;
    return others.some((other) => {
      const group = other.groupId === null ? undefined : groups.get(other.groupId);
      return group !== undefined && group.classIds.includes(classId);
    });
  }
  const group = row.groupId === null ? undefined : groups.get(row.groupId);
  if (group === undefined) {
    return false;
  }
  return others.some((other) => other.classId !== null && group.classIds.includes(other.classId));
}
