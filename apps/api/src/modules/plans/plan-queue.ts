/**
 * The follow of a plan's queue (task 7.1b, pull request #213; `09`, When
 * something else changes: "One rule: plan items follow the lessons in order.
 * The items of lessons already held never move."; `edge/lesson-plans`, How
 * items stay attached). Pure: the snapshot of the rows the plan was last laid
 * on, the rows now, the items by position and the moment give the new
 * positions. Nothing here reads the database or the clock.
 *
 * Decision 3 (Look first, confirmed on #213): the fixed part is the rows whose
 * start has passed, held or unresolved; the queue starts at the first row
 * whose start has not passed.
 */

/** A row: a lesson of the quarter not cancelled, in date and time order. */
export interface QueueRow {
  readonly lessonId: string;
  readonly date: string;
  readonly startsAt: Date;
}

export interface QueueItem {
  readonly id: string;
  readonly position: number;
}

/**
 * A shift an empty row absorbed (step 3b): `removed` was taken out of the
 * queue and the empty slot of `absorbing` was dropped for it. When `removed`
 * comes back, an empty slot is put back at `absorbing`'s row.
 */
export interface Absorbed {
  readonly removedLessonId: string;
  readonly absorbingLessonId: string;
}

export interface FollowInput {
  /** The rows the plan was last laid on; `null` when it has no snapshot (decision 7). */
  readonly before: readonly QueueRow[] | null;
  readonly after: readonly QueueRow[];
  readonly items: readonly QueueItem[];
  readonly absorbed: readonly Absorbed[];
  readonly now: Date;
}

/** Where an item stands: the date of its row, or `null` for "not covered". */
export interface ItemMove {
  readonly itemId: string;
  readonly from: string | null;
  readonly to: string | null;
}

export interface FollowResult {
  /** The new position of every item. */
  readonly positions: ReadonlyMap<string, number>;
  /** The items moved back from a started lesson gone from the started rows, with its date. */
  readonly movedBack: ReadonlyMap<string, string>;
  /** The records of absorbed shifts to keep. */
  readonly absorbed: readonly Absorbed[];
  /** The items whose row changed (another lesson, or to or from "not covered"). */
  readonly moves: readonly ItemMove[];
  /** The items that stood on a row and are now "not covered". */
  readonly newlyNotCovered: readonly string[];
  /** Empty rows were added at the end of the plan (`09`: "More lessons: empty rows appear at the end"). */
  readonly rowsAddedAtEnd: boolean;
}

const started = (row: QueueRow, now: Date) => row.startsAt.getTime() <= now.getTime();

interface Slot {
  /** The item, or `null` for an empty row. */
  item: string | null;
  /** The lesson of the snapshot row the slot stood on; `null` for a moved-back or not-covered item. */
  readonly lessonId: string | null;
  /** The lesson is gone from the rows not started. */
  readonly removed: boolean;
}

/** The empty rows after the last item that stands on a row, or 0 when an item is not covered. */
function emptyTail(rowCount: number, positions: Iterable<number>): number {
  let last = 0;
  for (const position of positions) {
    if (position > rowCount) return 0;
    last = Math.max(last, position);
  }
  return rowCount - last;
}

export function followQueue(input: FollowInput): FollowResult {
  const { after, items, now } = input;
  const before = input.before ?? after;
  const byPosition = new Map(items.map((item) => [item.position, item.id]));
  const afterIndex = new Map(after.map((row, index) => [row.lessonId, index]));
  const fixedCount = after.filter((row) => started(row, now)).length;
  const positions = new Map<string, number>();
  const movedBack = new Map<string, string>();

  if (input.before === null) {
    for (const item of items) positions.set(item.id, item.position);
    return {
      positions,
      movedBack,
      absorbed: [],
      moves: [],
      newlyNotCovered: [],
      rowsAddedAtEnd: false,
    };
  }

  // Step 1, the fixed part: a started row of the snapshot that is still a
  // started row keeps its item.
  const startedAfter = (lessonId: string) => {
    const index = afterIndex.get(lessonId);
    const row = index === undefined ? undefined : after[index];
    return row !== undefined && started(row, now) ? index : undefined;
  };
  const queue: Slot[] = [];
  for (const [index, row] of before.entries()) {
    const item = byPosition.get(index + 1) ?? null;
    const fixedAt = startedAfter(row.lessonId);
    if (fixedAt !== undefined) {
      if (item !== null) positions.set(item, fixedAt + 1);
      continue;
    }
    if (started(row, now)) {
      // Step 2: a started lesson gone from the started rows (cancelled after
      // its date, or moved forward): its item goes in front of the queue.
      if (item !== null) movedBack.set(item, row.date);
      continue;
    }
    // Step 3: the queue, in the snapshot's order.
    queue.push({ item, lessonId: row.lessonId, removed: !afterIndex.has(row.lessonId) });
  }
  // The items past the last row keep their gaps, so that rows that come back
  // give each one its row again.
  const lastPosition = Math.max(before.length, ...items.map((item) => item.position));
  for (let position = before.length + 1; position <= lastPosition; position += 1) {
    queue.push({ item: byPosition.get(position) ?? null, lessonId: null, removed: false });
  }
  const front: Slot[] = [...movedBack.keys()].map((item) => ({
    item,
    lessonId: null,
    removed: false,
  }));

  // Each removed row and each moved-back item takes away the first empty
  // slot at or after its place (`edge`: "The shift stops at the first empty
  // row, which absorbs it"); without one, the queue grows.
  const absorbed: Absorbed[] = [];
  const laid: Slot[] = [];
  let owed = front.length;
  const pending: (string | null)[] = front.map(() => null);
  laid.push(...front);
  for (const slot of queue) {
    if (slot.removed) {
      if (slot.item === null) {
        // An empty row removed absorbs itself.
        if (slot.lessonId !== null) {
          absorbed.push({ removedLessonId: slot.lessonId, absorbingLessonId: slot.lessonId });
        }
        continue;
      }
      owed += 1;
      pending.push(slot.lessonId);
      laid.push({ item: slot.item, lessonId: null, removed: false });
      continue;
    }
    if (slot.item === null && owed > 0) {
      owed -= 1;
      const removed = pending.shift() ?? null;
      if (removed !== null && slot.lessonId !== null) {
        absorbed.push({ removedLessonId: removed, absorbingLessonId: slot.lessonId });
      }
      continue;
    }
    laid.push(slot);
  }

  // Step 3b: a lesson that comes back whose removal an empty row absorbed
  // gets the empty slot back at the absorbing lesson's row.
  const queueAfter = after.slice(fixedCount);
  const queueIndex = new Map(queueAfter.map((row, index) => [row.lessonId, index]));
  const inSnapshotQueue = new Set(
    queue
      .filter((slot) => !slot.removed)
      .flatMap((slot) => (slot.lessonId === null ? [] : [slot.lessonId])),
  );
  const kept: Absorbed[] = [];
  const inserts: number[] = [];
  const putBack = new Set<string>();
  for (const record of input.absorbed) {
    const back =
      queueIndex.has(record.removedLessonId) && !inSnapshotQueue.has(record.removedLessonId);
    const at = queueIndex.get(record.absorbingLessonId);
    if (back) {
      putBack.add(record.removedLessonId);
      if (at !== undefined) inserts.push(at);
      continue;
    }
    // Kept while the absorbing lesson is still in the queue: once it has
    // started (or is gone), a lesson coming back before it is a fixed row or
    // an added one, and the record is dropped (spec review of the code, should-fix 7).
    if (at !== undefined) kept.push(record);
  }
  for (const at of inserts.sort((a, b) => a - b)) {
    laid.splice(Math.min(at, laid.length), 0, { item: null, lessonId: null, removed: false });
  }

  // Step 4: the queue is laid on the rows not started, in order.
  for (const [index, slot] of laid.entries()) {
    if (slot.item !== null) positions.set(slot.item, fixedCount + index + 1);
  }

  const dateOf = (rows: readonly QueueRow[], position: number) =>
    position <= rows.length ? (rows[position - 1]?.date ?? null) : null;
  const lessonOf = (rows: readonly QueueRow[], position: number) =>
    position <= rows.length ? (rows[position - 1]?.lessonId ?? null) : null;
  const moves: ItemMove[] = [];
  const newlyNotCovered: string[] = [];
  for (const item of items) {
    const to = positions.get(item.id) ?? item.position;
    const fromLesson = lessonOf(before, item.position);
    const toLesson = lessonOf(after, to);
    if (fromLesson !== toLesson) {
      moves.push({ itemId: item.id, from: dateOf(before, item.position), to: dateOf(after, to) });
    }
    if (fromLesson !== null && toLesson === null) newlyNotCovered.push(item.id);
  }
  // A row counts as added only when it is neither a row of the snapshot nor
  // a lesson put back from an absorbed shift: the undo of a shift adds no
  // lesson (code review of #213, must-fix 1).
  const known = new Set(before.map((row) => row.lessonId));
  const added = queueAfter.some((row) => !known.has(row.lessonId) && !putBack.has(row.lessonId));
  const rowsAddedAtEnd =
    added &&
    emptyTail(after.length, positions.values()) >
      emptyTail(
        before.length,
        items.map((item) => item.position),
      );
  return {
    positions,
    movedBack,
    absorbed: [...kept, ...absorbed],
    moves,
    newlyNotCovered,
    rowsAddedAtEnd,
  };
}
