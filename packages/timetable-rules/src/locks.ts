/**
 * The locks of a draft (docs/spec/06-timetable.md, Auto-generation: "A lesson,
 * a class, a teacher or a day can be locked. 'Regenerate' changes only what is
 * not locked."; task 5.4c-1, pull request #135).
 *
 * A lock binds "Regenerate", "Suggest a place" and the rearrange route that
 * applies a suggestion (decision 8; the From 5.4b-2b line of the task); a
 * person still moves a locked lesson by hand. One function tells which locks
 * hold a block, for the API, the grid and the search alike.
 */
import type { PatternModel } from './facts-data.js';
import type { PatternBlock } from './pattern-place.js';

/** A lock of a lesson (its block), a class, a teacher or vacancy, or a weekday. */
export type PatternLock =
  | { readonly id: string; readonly kind: 'block'; readonly blockId: string }
  | { readonly id: string; readonly kind: 'class'; readonly classId: string }
  | { readonly id: string; readonly kind: 'teacher'; readonly teacherId: string }
  | { readonly id: string; readonly kind: 'day'; readonly weekday: number };

/**
 * The locks that hold a block where it is: a lock of the block itself, a
 * class lock on a class any of its lessons draws from (a group block counts
 * for every class it draws from, as the board shows it), a teacher lock on a
 * teacher of its rows, and a day lock on its weekday. With `to`, a day lock on
 * the weekday it would move to holds it too (decision 8: a suggestion never
 * moves a block into a locked day). A new block (`NEW_BLOCK_ID`) has no lock
 * of its own.
 */
export function lockedBy(
  model: PatternModel,
  locks: readonly PatternLock[],
  block: Pick<PatternBlock, 'id' | 'lessons' | 'weekday'>,
  to?: Pick<PatternBlock, 'weekday'>,
): PatternLock[] {
  if (locks.length === 0) return [];
  const rows = block.lessons.map((lesson) => model.rowOf(lesson.loadRowId));
  const classIds = new Set(
    rows.flatMap((row) => model.unitOf(row.classId ?? row.groupId ?? '').classIds),
  );
  const teacherIds = new Set(rows.map((row) => row.teacherId));
  return locks.filter((lock) => {
    switch (lock.kind) {
      case 'block':
        return lock.blockId === block.id;
      case 'class':
        return classIds.has(lock.classId);
      case 'teacher':
        return teacherIds.has(lock.teacherId);
      case 'day':
        return lock.weekday === block.weekday || lock.weekday === to?.weekday;
    }
  });
}
