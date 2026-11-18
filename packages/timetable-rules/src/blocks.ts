/**
 * The blocks of a teaching load (docs/spec/edge-cases/timetable.md, Structure;
 * 06-timetable.md, Model, Parallel group lessons; task 3.4b, pull request #100).
 *
 * "The unit that occupies a class is the lesson block. A whole-class lesson is
 * a block of one; a split or a set of parallel groups is one block of several
 * lessons." "All parts have equal lessons per week and different teachers. A
 * mixed block is allowed: boys have physical education while girls have
 * technology, and the reverse in another slot." Parallel groups are "All
 * groups of one subject that share a class, directly or through other groups
 * of that subject … placed in the same period, each with its own teacher and
 * room. … Groups that share no class are separate blocks, even in one grade"
 * (spec change of 17 November 2026).
 *
 * Task 5.15 (replacing decision 2 of 3.4b, which also linked groups across
 * classes of the same grade or pair of grades): in one version, the group rows
 * of one subject are one block when they are linked by a shared class, taken
 * as a connected set. Decision 12: the rows of a split marked `mixedBlock`
 * meet in different slots, so one teacher may take both halves; equal lessons
 * still bind. The database keeps the same rules (db/migrations/0056, 0171,
 * and 0172, which links by a shared class only).
 *
 * Spec change of 17 November 2026: a split divides one class, or a pair of
 * classes that do the subject together; the halves of one split are the
 * groups that draw from the same set of classes (`splitKeyOf`). A group may
 * be for one sex, and a subject whose groups are all for one sex is always
 * marked mixed (`load_one_sex_not_mixed`).
 */

/** The sex a group is for (`groups.sex`); `null` for everyone. */
export type GroupSex = 'male' | 'female';

/** A group as the blocks read it: its subject, its classes and their grades. */
export interface BlockGroup {
  readonly id: string;
  readonly subjectId: string;
  readonly classIds: readonly string[];
  readonly grades: readonly number[];
  /** "For girls only or boys only" (05, Group); `null` for everyone. */
  readonly sex: GroupSex | null;
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
  'load_one_sex_not_mixed',
] as const;

export type BlockProblem = (typeof BLOCK_PROBLEM_ORDER)[number];

/** Whether two groups are linked: one subject and a shared class (task 5.15). */
export function groupsLinked(a: BlockGroup, b: BlockGroup): boolean {
  return a.subjectId === b.subjectId && a.classIds.some((id) => b.classIds.includes(id));
}

/**
 * The split a group is a part of: its set of classes, as one key (one class,
 * or a pair of classes that do the subject together). Two groups with the
 * same key are halves of one split.
 */
export const splitKeyOf = (group: Pick<BlockGroup, 'classIds'>): string =>
  [...new Set(group.classIds.map((id) => id.toLowerCase()))].sort().join('|');

/** Whether a group is a part of a split: it draws from one class or from a pair of classes. */
export const isSplit = (group: Pick<BlockGroup, 'classIds'>): boolean => {
  const count = new Set(group.classIds.map((id) => id.toLowerCase())).size;
  return count === 1 || count === 2;
};

/** Whether two groups are parts of one split: each a split, drawing from the same classes. */
export const sameSplit = (
  a: Pick<BlockGroup, 'classIds'>,
  b: Pick<BlockGroup, 'classIds'>,
): boolean => isSplit(a) && splitKeyOf(a) === splitKeyOf(b);

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

/**
 * The block of every row, by row id, as `blockOf` gives it for each (task 10.1b): the rows are
 * grouped once, so a reader of every row's block does not group them again for each row. A class
 * row has none.
 */
export function blocksOfRows(
  rows: readonly BlockRow[],
  groups: ReadonlyMap<string, BlockGroup>,
): Map<string, BlockRow[]> {
  const found = new Map<string, BlockRow[]>();
  for (const ids of loadBlocks(rows, groups)) {
    const members = new Set(ids);
    const block = rows.filter((row) => members.has(row.id));
    for (const id of ids) found.set(id, block);
  }
  return found;
}

/** Whether both rows are halves of one split marked as a mixed block (decision 12). */
function mixedHalves(a: BlockRow, b: BlockRow, groups: ReadonlyMap<string, BlockGroup>): boolean {
  const groupA = a.groupId === null ? undefined : groups.get(a.groupId);
  const groupB = b.groupId === null ? undefined : groups.get(b.groupId);
  if (groupA === undefined || groupB === undefined) return false;
  return a.mixedBlock && b.mixedBlock && sameSplit(groupA, groupB);
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
    // A class row is never a half of a split (spec review of the build, must-fix 1).
    return row.mixedBlock && row.groupId === null ? ['load_mixed_not_split'] : [];
  }
  const others = block.filter((other) => other.id !== row.id);
  const problems: BlockProblem[] = [];
  if (row.mixedBlock && !isSplit(group)) {
    problems.push('load_mixed_not_split');
  }
  if (
    others.some((other) => {
      const otherGroup = other.groupId === null ? undefined : groups.get(other.groupId);
      return (
        otherGroup !== undefined &&
        sameSplit(group, otherGroup) &&
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
  if (!row.mixedBlock && oneSex([row, ...others], groups)) {
    problems.push('load_one_sex_not_mixed');
  }
  return problems;
}

/**
 * Whether every group of the rows is for one and the same sex (05, Teaching
 * load: "A subject whose groups are all for one sex is always marked as part
 * of a mixed block"); `false` when a group is not given.
 */
function oneSex(rows: readonly BlockRow[], groups: ReadonlyMap<string, BlockGroup>): boolean {
  const sexes = new Set<GroupSex | null>();
  for (const one of rows) {
    const group = one.groupId === null ? undefined : groups.get(one.groupId);
    if (group === undefined) return false;
    sexes.add(group.sex);
  }
  return sexes.size === 1 && !sexes.has(null);
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

/**
 * Task 5.13, decision 2 (`06`, Importing the load and the timetable: "a split or group subject is
 * given to every part of its block"): for every group row, the groups of `inService` connected to
 * its group through any chain of links (`groupsLinked`, the connected set `loadBlocks` builds)
 * that no row names, sorted by id. `inService` holds the groups of the branch and the year in
 * service on the day the caller reads (`statusOn`); a row's own group missing from it is read
 * from `rowGroups`. A class row has no entry.
 */
export function missingBlockGroups(
  rows: readonly BlockRow[],
  inService: readonly BlockGroup[],
  rowGroups: ReadonlyMap<string, BlockGroup> = new Map(),
): Map<string, string[]> {
  const named = new Set(rows.map((row) => row.groupId).filter((id): id is string => id !== null));
  const byId = new Map(inService.map((one) => [one.id, one]));
  const found = new Map<string, string[]>();
  for (const row of rows) {
    if (row.groupId === null) continue;
    const start = byId.get(row.groupId) ?? rowGroups.get(row.groupId);
    if (start === undefined) {
      found.set(row.id, []);
      continue;
    }
    const seen = new Set<string>([start.id]);
    const queue: BlockGroup[] = [start];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const other of inService) {
        if (!seen.has(other.id) && groupsLinked(current, other)) {
          seen.add(other.id);
          queue.push(other);
        }
      }
    }
    found.set(
      row.id,
      [...seen].filter((id) => byId.has(id) && !named.has(id)).sort((a, b) => a.localeCompare(b)),
    );
  }
  return found;
}
