import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { followQueue, type Absorbed, type QueueItem, type QueueRow } from './plan-queue.js';

// Task 7.1b, pull request #213: the follow of a plan's queue (`09`, When
// something else changes; `edge/lesson-plans`, How items stay attached).

/** Lesson `L<day>` on 2026-11-<day> at 09:00 UTC. */
const row = (day: number): QueueRow => ({
  lessonId: `L${day}`,
  date: `2026-11-${String(day).padStart(2, '0')}`,
  startsAt: new Date(`2026-11-${String(day).padStart(2, '0')}T09:00:00Z`),
});
const rows = (...days: number[]) => days.map(row);
/** Noon of a day: the lessons of that day and before have started. */
const noonOf = (day: number) => new Date(`2026-11-${String(day).padStart(2, '0')}T12:00:00Z`);
/** Items `I1..` at the positions given; 0 leaves the item out. */
const itemsAt = (...positions: number[]): QueueItem[] =>
  positions.map((position, index) => ({ id: `I${index + 1}`, position }));

/** The lesson each item stands on after the follow, or "-" for not covered. */
function laid(
  before: readonly QueueRow[] | null,
  after: readonly QueueRow[],
  items: readonly QueueItem[],
  now: Date,
  absorbed: readonly Absorbed[] = [],
) {
  const result = followQueue({ before, after, items, absorbed, now });
  const where = Object.fromEntries(
    items.map((item) => {
      const position = result.positions.get(item.id) ?? 0;
      return [item.id, position <= after.length ? (after[position - 1]?.lessonId ?? '-') : '-'];
    }),
  );
  return { where, result };
}

describe('followQueue', () => {
  it('moves nothing when nothing changed, also after time passed', () => {
    const lessons = rows(2, 3, 4, 5);
    const { where, result } = laid(lessons, lessons, itemsAt(1, 2, 4), noonOf(3));
    expect(where).toEqual({ I1: 'L2', I2: 'L3', I3: 'L5' });
    expect(result.moves).toEqual([]);
    expect(result.rowsAddedAtEnd).toBe(false);
  });

  it('takes the positions as they are without a snapshot (decision 7)', () => {
    const { result } = laid(null, rows(2, 3), itemsAt(1, 5), noonOf(1));
    expect(result.positions.get('I1')).toBe(1);
    expect(result.positions.get('I2')).toBe(5);
    expect(result.moves).toEqual([]);
  });

  it('a future lesson cancelled: its item moves to the next lesson, the following items one step, the last not covered', () => {
    const { where, result } = laid(rows(2, 3, 4, 5), rows(2, 4, 5), itemsAt(1, 2, 3, 4), noonOf(2));
    expect(where).toEqual({ I1: 'L2', I2: 'L4', I3: 'L5', I4: '-' });
    expect(result.newlyNotCovered).toEqual(['I4']);
    expect(result.moves.map((move) => move.itemId)).toEqual(['I2', 'I3', 'I4']);
  });

  it('the shift stops at the first empty row, which absorbs it (edge, last five rows empty)', () => {
    const { where, result } = laid(
      rows(2, 3, 4, 5, 6),
      rows(3, 4, 5, 6),
      itemsAt(1, 2, 4),
      noonOf(1),
    );
    // I1 on L2 (cancelled) goes to L3, I2 to L4, the empty L4 row absorbs, I3 stays on L5.
    expect(where).toEqual({ I1: 'L3', I2: 'L4', I3: 'L5' });
    expect(result.newlyNotCovered).toEqual([]);
    expect(result.absorbed).toEqual([{ removedLessonId: 'L2', absorbingLessonId: 'L4' }]);
  });

  it('an empty row cancelled absorbs itself', () => {
    const { where, result } = laid(rows(2, 3, 4), rows(2, 4), itemsAt(1, 3), noonOf(1));
    expect(where).toEqual({ I1: 'L2', I2: 'L4' });
    expect(result.absorbed).toEqual([{ removedLessonId: 'L3', absorbingLessonId: 'L3' }]);
  });

  it('a day off added by mistake and removed: the items move back, also past an absorbed shift (edge)', () => {
    const start = rows(2, 3, 4, 5, 6);
    const items = itemsAt(1, 2, 4, 5);
    const cancelled = laid(start, rows(3, 4, 5, 6), items, noonOf(1));
    expect(cancelled.where).toEqual({ I1: 'L3', I2: 'L4', I3: 'L5', I4: 'L6' });
    const moved = items.map((item) => ({
      id: item.id,
      position: cancelled.result.positions.get(item.id) ?? 0,
    }));
    const restored = laid(rows(3, 4, 5, 6), start, moved, noonOf(1), cancelled.result.absorbed);
    expect(restored.where).toEqual({ I1: 'L2', I2: 'L3', I3: 'L5', I4: 'L6' });
    expect(restored.result.absorbed).toEqual([]);
  });

  it('a day off removed: items sent to "not covered" return by themselves (edge)', () => {
    const items = itemsAt(1, 2, 3);
    const cancelled = laid(rows(2, 3, 4), rows(3, 4), items, noonOf(1));
    expect(cancelled.where).toEqual({ I1: 'L3', I2: 'L4', I3: '-' });
    const moved = items.map((item) => ({
      id: item.id,
      position: cancelled.result.positions.get(item.id) ?? 0,
    }));
    const restored = laid(rows(3, 4), rows(2, 3, 4), moved, noonOf(1), cancelled.result.absorbed);
    expect(restored.where).toEqual({ I1: 'L2', I2: 'L3', I3: 'L4' });
    expect(restored.result.newlyNotCovered).toEqual([]);
  });

  it('a lesson cancelled after its date: its item goes in front of the first lesson not yet held; held lessons keep theirs (edge, Thursday)', () => {
    // Monday 2, Tuesday 3, Wednesday 4 held; now Thursday 5 at noon; Thursday's lesson is at 09:00 (held too).
    const { where, result } = laid(
      rows(2, 3, 4, 6, 9, 10),
      rows(3, 4, 6, 9, 10),
      itemsAt(1, 2, 3, 4, 5),
      noonOf(5),
    );
    expect(where).toEqual({ I1: 'L6', I2: 'L3', I3: 'L4', I4: 'L9', I5: 'L10' });
    expect(result.movedBack.get('I1')).toBe('2026-11-02');
  });

  it('a lesson moved past another: items go by position (edge, Tuesday to Friday)', () => {
    const tuesday = row(3);
    const friday = { ...tuesday, date: '2026-11-06', startsAt: new Date('2026-11-06T09:00:00Z') };
    const { where } = laid([tuesday, row(5)], [row(5), friday], itemsAt(1, 2), noonOf(1));
    expect(where).toEqual({ I1: 'L5', I2: 'L3' });
  });

  it('more lessons: empty rows appear at the end', () => {
    const { where, result } = laid(rows(2, 3), rows(2, 3, 4, 5), itemsAt(1, 2), noonOf(1));
    expect(where).toEqual({ I1: 'L2', I2: 'L3' });
    expect(result.rowsAddedAtEnd).toBe(true);
    expect(result.moves).toEqual([]);
  });

  it('a lesson added in the middle moves the queue back by one, empty row at the end', () => {
    const { where, result } = laid(rows(2, 4), rows(2, 3, 4), itemsAt(1, 2), noonOf(1));
    expect(where).toEqual({ I1: 'L2', I2: 'L3' });
    expect(result.rowsAddedAtEnd).toBe(true);
  });

  it('the timetable replaced before the quarter starts: items on the new lessons in the same order', () => {
    const { where } = laid(rows(2, 3, 4), rows(10, 11, 12, 13), itemsAt(1, 2, 3), noonOf(1));
    expect(where).toEqual({ I1: 'L10', I2: 'L11', I3: 'L12' });
  });

  it('every remaining lesson removed: every item of the queue is not covered, held ones stay', () => {
    const { where } = laid(rows(2, 3, 4), rows(2), itemsAt(1, 2, 3), noonOf(2));
    expect(where).toEqual({ I1: 'L2', I2: '-', I3: '-' });
  });

  it('a past lesson restored is an empty fixed row; held items keep their lessons', () => {
    const { where } = laid(rows(3, 5), rows(2, 3, 5), itemsAt(1, 2), noonOf(4));
    expect(where).toEqual({ I1: 'L3', I2: 'L5' });
  });

  describe('properties', () => {
    const scenario = fc
      .record({
        days: fc.uniqueArray(fc.integer({ min: 1, max: 28 }), { minLength: 0, maxLength: 12 }),
        keep: fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
        added: fc.uniqueArray(fc.integer({ min: 1, max: 28 }), { maxLength: 4 }),
        filled: fc.array(fc.boolean(), { minLength: 16, maxLength: 16 }),
        today: fc.integer({ min: 0, max: 29 }),
      })
      .map(({ days, keep, added, filled, today }) => {
        const sorted = [...days].sort((a, b) => a - b);
        const before = rows(...sorted);
        const afterDays = [
          ...sorted.filter((_, index) => keep[index] === true),
          ...added.filter((day) => !sorted.includes(day)),
        ].sort((a, b) => a - b);
        const items = filled.flatMap((on, index) => (on ? [index + 1] : []));
        return {
          before,
          after: rows(...afterDays),
          items: items.map((position, index) => ({ id: `I${index + 1}`, position })),
          now: noonOf(today === 0 ? 1 : today).getTime() - (today === 0 ? 86_400_000 : 0),
        };
      });

    it('never loses an item and gives each one position', () => {
      fc.assert(
        fc.property(scenario, ({ before, after, items, now }) => {
          const result = followQueue({ before, after, items, absorbed: [], now: new Date(now) });
          expect([...result.positions.keys()].sort()).toEqual(items.map((item) => item.id).sort());
          const used = [...result.positions.values()];
          expect(new Set(used).size).toBe(used.length);
          expect(used.every((position) => position >= 1)).toBe(true);
        }),
      );
    });

    it('never moves an item of a lesson that has started and stays', () => {
      fc.assert(
        fc.property(scenario, ({ before, after, items, now }) => {
          const moment = new Date(now);
          const result = followQueue({ before, after, items, absorbed: [], now: moment });
          for (const item of items) {
            const lesson = before[item.position - 1];
            if (lesson === undefined || lesson.startsAt.getTime() > now) continue;
            const index = after.findIndex((one) => one.lessonId === lesson.lessonId);
            if (index === -1) continue;
            expect(result.positions.get(item.id)).toBe(index + 1);
          }
        }),
      );
    });

    it('keeps the order of the queue, moved-back items first', () => {
      fc.assert(
        fc.property(scenario, ({ before, after, items, now }) => {
          const result = followQueue({ before, after, items, absorbed: [], now: new Date(now) });
          const fixedCount = after.filter((one) => one.startsAt.getTime() <= now).length;
          const queued = items.filter((item) => (result.positions.get(item.id) ?? 0) > fixedCount);
          const order = [...queued].sort(
            (a, b) => (result.positions.get(a.id) ?? 0) - (result.positions.get(b.id) ?? 0),
          );
          const back = order.filter((item) => result.movedBack.has(item.id));
          const rest = order.filter((item) => !result.movedBack.has(item.id));
          expect(order.slice(0, back.length)).toEqual(back);
          expect(rest.map((item) => item.position)).toEqual(
            [...rest.map((item) => item.position)].sort((a, b) => a - b),
          );
        }),
      );
    });

    it('moves nothing when the rows did not change', () => {
      fc.assert(
        fc.property(scenario, ({ before, items, now }) => {
          const result = followQueue({
            before,
            after: before,
            items,
            absorbed: [],
            now: new Date(now),
          });
          for (const item of items) expect(result.positions.get(item.id)).toBe(item.position);
        }),
      );
    });
  });
});
