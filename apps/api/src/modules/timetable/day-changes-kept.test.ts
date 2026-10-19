import type { DatedLesson } from '@sodiq/timetable-rules';
import { describe, expect, it } from 'vitest';
import {
  dayChangesKeyOf,
  writePlanOf,
  type Chain,
  type DayCategory,
  type SortedDayChange,
} from './day-changes-kept.js';

// All names are invented. Task 5.6a-5a, pull request #164: what the write of
// a publish does with the sorted one-day changes and their decisions
// (decisions 2 and 7, review should-fix 5). The sorting itself reads the
// database; its rows are tested on the routes (`day-changes.test.ts`).

const KEY = '01a15000-0000-7000-8000-000000000001';
const LESSON = '01a15000-0000-7000-8000-000000000002';
const PART = '01a15000-0000-7000-8000-000000000003';

const lessonOf = (entryId: string, date: string): DatedLesson =>
  ({ entryId, date }) as unknown as DatedLesson;

const chainOf = (lessonId: string, cancelReason: string | null): Chain =>
  ({
    lessonId,
    last: { to_date: '2026-10-21' },
    lesson: { cancel_cause: cancelReason === null ? null : 'reason', cancel_reason: cancelReason },
  }) as unknown as Chain;

function itemOf(
  category: DayCategory,
  input: { kind?: 'move' | 'room'; storedIds?: string[]; withPart?: boolean } = {},
): SortedDayChange {
  const chains = [
    chainOf(LESSON, null),
    ...(input.withPart === true ? [chainOf(PART, 'Rain')] : []),
  ];
  return {
    answer: {
      key: KEY,
      kind: input.kind ?? 'move',
      unitId: LESSON,
      subjectId: LESSON,
      from: { date: '2026-10-19', start: 480, end: 525, roomId: null },
      to: { date: '2026-10-21', start: 535, end: 580, roomId: null },
      reason: 'Concert rehearsal',
      carriedVersionId: null,
      blocked: [],
    },
    category,
    changeIds: [KEY],
    matched: new Map([
      [LESSON, lessonOf('entry-1', '2026-10-19')],
      ...(input.withPart === true ? [[PART, lessonOf('entry-2', '2026-10-19')] as const] : []),
    ]),
    cancelledParts: new Map(input.withPart === true ? [[PART, 'Rain']] : []),
    storedIds: input.storedIds ?? [],
    chains,
  };
}

describe('writePlanOf', () => {
  it('cancels the lessons a "needs a decision" item was on when "cancel" is chosen, with its reason', () => {
    const plan = writePlanOf([itemOf('decide')], new Set(), new Map([[KEY, 'cancel']]));
    expect([...plan.cancels]).toEqual([['entry-1@2026-10-19', 'Concert rehearsal']]);
  });

  it('writes nothing for "drop", but a part cancelled with a reason keeps its own cancel', () => {
    expect([
      ...writePlanOf([itemOf('decide')], new Set(), new Map([[KEY, 'drop']])).cancels,
    ]).toEqual([]);
    const plan = writePlanOf(
      [itemOf('decide', { withPart: true })],
      new Set(),
      new Map([[KEY, 'drop']]),
    );
    expect([...plan.cancels]).toEqual([['entry-2@2026-10-19', 'Rain']]);
  });

  it('gives a part cancelled with a reason its own cancel under "cancel" too', () => {
    const plan = writePlanOf(
      [itemOf('decide', { withPart: true })],
      new Set(),
      new Map([[KEY, 'cancel']]),
    );
    expect([...plan.cancels].sort()).toEqual([
      ['entry-1@2026-10-19', 'Concert rehearsal'],
      ['entry-2@2026-10-19', 'Rain'],
    ]);
  });

  it('keeps a block moved from before the run, cancelled under "cancel", removed under "drop" (decision 7)', () => {
    const outside = itemOf('decide', { storedIds: [LESSON] });
    const cancelled = writePlanOf([outside], new Set(), new Map([[KEY, 'cancel']]));
    expect([...cancelled.keepStored]).toEqual([LESSON]);
    expect([...cancelled.cancelStored]).toEqual([[LESSON, 'Concert rehearsal']]);
    const dropped = writePlanOf([outside], new Set(), new Map([[KEY, 'drop']]));
    expect([...dropped.keepStored]).toEqual([]);
    expect([...dropped.cancels]).toEqual([]);
  });

  it('keeps what the sorting kept from outside the run, and names a kept move by its key at its new date', () => {
    const plan = writePlanOf([itemOf('kept')], new Set([PART]), new Map());
    expect([...plan.keepStored]).toEqual([PART]);
    expect(plan.movedKeyOf('entry-1', '2026-10-21')).toBe(KEY);
    expect(plan.movedKeyOf('entry-1', '2026-10-19')).toBeNull();
    expect([...plan.cancels]).toEqual([]);
  });

  it('writes nothing for an item dropped by the sorting', () => {
    const plan = writePlanOf([itemOf('dropped')], new Set(), new Map());
    expect([...plan.cancels, ...plan.keepStored, ...plan.cancelStored]).toEqual([]);
  });
});

describe('dayChangesKeyOf', () => {
  it("changes with an item's category and with the start, not with the order of the items", () => {
    const kept = itemOf('kept');
    const other = { ...itemOf('dropped'), answer: { ...itemOf('dropped').answer, key: LESSON } };
    const key = dayChangesKeyOf('v', '2026-10-19', [kept, other]);
    expect(dayChangesKeyOf('v', '2026-10-19', [other, kept])).toBe(key);
    expect(dayChangesKeyOf('v', '2026-10-19', [itemOf('decide'), other])).not.toBe(key);
    expect(dayChangesKeyOf('v', '2026-10-26', [kept, other])).not.toBe(key);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});
