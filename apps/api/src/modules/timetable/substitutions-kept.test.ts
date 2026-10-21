import type { DatedLesson } from '@sodiq/timetable-rules';
import type { SubstitutionItemAnswer } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { placeKeyOf } from './dated-lessons.js';
import {
  substitutionKeyPartOf,
  substitutionRefusalsOf,
  substitutionWritePlanOf,
  type SortedSubstitution,
  type StoredSubstitution,
} from './substitutions-kept.js';

// Task 5.7b-3, pull request #193: the pure parts of the substitutions'
// sorting: what refuses a write, what the write does, the key. Ids are made up.
const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const stored = (n: number): StoredSubstitution => ({
  rowId: id(n),
  substitutionId: id(100 + n),
  lessonId: id(200 + n),
  relaxed: false,
  replacedId: id(300),
  substituteId: id(301),
  reason: 'The teacher is ill',
  absenceId: null,
  madeAt: new Date('2026-10-10T12:00:00+05:00'),
  lesson_date: '2026-10-19',
  class_id: id(400),
  group_id: null,
  subject_id: id(401),
  starts_at: new Date('2026-10-19T08:00:00+05:00'),
  ends_at: new Date('2026-10-19T08:45:00+05:00'),
  cancelled: false,
  doublePairId: null,
});

const lesson = (n: number): DatedLesson =>
  ({
    entryId: id(500 + n),
    date: '2026-10-19',
    tutorFollowed: false,
    followsWeekday: 1,
    placement: { id: `p${String(n)}`, blockId: null, start: 480, end: 525, teacherIds: [id(300)] },
  }) as unknown as DatedLesson;

const item = (
  n: number,
  category: SortedSubstitution['category'],
  extra: Partial<SubstitutionItemAnswer> = {},
): SortedSubstitution => ({
  category,
  lessons: [{ stored: stored(n), matched: category === 'dropped' ? null : lesson(n) }],
  answer: {
    key: id(n),
    category,
    unitId: id(400),
    subjectId: id(401),
    lessons: [{ date: '2026-10-19', start: 480, end: 525 }],
    replacedId: id(300),
    substituteId: id(301),
    reason: 'The teacher is ill',
    absenceId: null,
    carriedVersionId: null,
    blocked: [],
    away: false,
    dropOffered: false,
    dropCause: category === 'dropped' ? 'gone' : null,
    dependsOn: [],
    ...extra,
  },
});

describe('the sorting of stored substitutions', () => {
  it('refuses an undecided item, a choice for a kept one, keep, a drop not offered and a cancel without a reason', () => {
    const open = item(1, 'decide', { dropOffered: false });
    const kept = item(2, 'kept');
    expect(substitutionRefusalsOf([open, kept], [])).toEqual([
      { code: 'day_change_undecided', key: id(1) },
    ]);
    expect(substitutionRefusalsOf([open, kept], [{ key: id(2), choice: 'drop' }])).toEqual([
      { code: 'day_change_undecided', key: id(1) },
      { code: 'day_decision_unknown', key: id(2) },
    ]);
    for (const decision of [
      { key: id(1), choice: 'keep' as const },
      { key: id(1), choice: 'drop' as const },
      { key: id(1), choice: 'cancel' as const },
    ]) {
      expect(substitutionRefusalsOf([open], [decision])).toEqual([
        { code: 'day_choice_not_offered', key: id(1) },
      ]);
    }
    expect(
      substitutionRefusalsOf([open], [{ key: id(1), choice: 'cancel', reason: 'Nobody' }]),
    ).toEqual([]);
    const offered = item(3, 'decide', { dropOffered: true });
    expect(substitutionRefusalsOf([offered], [{ key: id(3), choice: 'drop' }])).toEqual([]);
    expect(
      substitutionRefusalsOf([offered], [{ key: id(3), choice: 'drop', reason: 'x' }]),
    ).toEqual([{ code: 'day_choice_not_offered', key: id(3) }]);
  });

  it('keeps the substitute on a kept lesson, gives it back when another item cancels it, and cancels a decided one', () => {
    const kept = item(1, 'kept');
    const depends = item(2, 'kept', { dependsOn: [id(9)] });
    const open = item(3, 'decide', { dropOffered: true });
    const placeOf = (n: number) => placeKeyOf(id(500 + n), '2026-10-19', '2026-10-19');
    const plan = substitutionWritePlanOf(
      [kept, depends, open],
      [
        { key: id(9), choice: 'cancel' },
        { key: id(3), choice: 'cancel', reason: 'Nobody can take it' },
      ],
    );
    expect(plan.substitutes.get(placeOf(1))).toEqual({
      rowId: id(1),
      substituteId: id(301),
      apply: true,
      versionTeacherId: id(300),
    });
    expect(plan.substitutes.get(placeOf(2))?.apply).toBe(false);
    expect(plan.substitutes.has(placeOf(3))).toBe(false);
    expect([...plan.cancels]).toEqual([[placeOf(3), 'Nobody can take it']]);
  });

  it('gives a key part that changes with what an item shows, and none with no item', () => {
    expect(substitutionKeyPartOf([])).toBeNull();
    const one = substitutionKeyPartOf([item(1, 'kept')]);
    expect(one).toBe(substitutionKeyPartOf([item(1, 'kept')]));
    expect(one).not.toBe(substitutionKeyPartOf([item(1, 'decide')]));
    expect(one).not.toBe(substitutionKeyPartOf([item(1, 'kept', { substituteId: id(302) })]));
  });
});
