import { describe, expect, it } from 'vitest';
import { pairDated, type PairStored, type PairWanted } from './dated-lessons.js';

const DATE = '2026-11-16';

const stored = (id: string, blockId: string, values: Partial<PairStored> = {}): PairStored => ({
  id,
  blockId,
  date: DATE,
  start: 480,
  end: 525,
  unitId: 'class-oxford',
  subjectId: 'maths',
  teacherId: 'teacher-karimova',
  roomId: 'room-12',
  cancelCause: null,
  ...values,
});

const wanted = (entryId: string, values: Partial<PairWanted> = {}): PairWanted => ({
  entryId,
  date: DATE,
  start: 480,
  end: 525,
  unitId: 'class-oxford',
  subjectId: 'maths',
  teacherId: 'teacher-karimova',
  roomId: 'room-12',
  cause: null,
  ...values,
});

const idsOf = (pairs: Map<PairWanted, PairStored>, lessons: readonly PairWanted[]) =>
  lessons.map((one) => pairs.get(one)?.id ?? null);

// Task 5.5b-1, pull request #152 (decisions 4 to 6, spec review must-fixes 1
// and 2): the stored lessons a publish keeps. edge/timetable, Versions and
// drafts: "An unchanged lesson keeps its identity ... Only real differences
// are created or removed." Structure: "The unit that occupies a class is the
// lesson block." All names are invented.
describe('the pairing of stored and new dated lessons', () => {
  it('keeps the lesson with the same class, subject, date and times, and pairs none at another time', () => {
    const same = wanted('entry-1');
    const later = wanted('entry-2', { start: 535, end: 580 });
    const { pairs, reused } = pairDated(
      [stored('lesson-a', 'block-a'), stored('lesson-b', 'block-b', { start: 590, end: 635 })],
      [{ lessons: [same] }, { lessons: [later] }],
    );
    expect(idsOf(pairs, [same, later])).toEqual(['lesson-a', null]);
    expect(reused).toEqual(['block-a', null]);
  });

  it('pairs one to one under one key, equal teacher and room first, then by id', () => {
    // Two lessons of one key: a split's halves never share a unit, so the
    // key repeats only for lessons of two blocks at one time.
    const first = wanted('entry-1', { teacherId: 'teacher-yusupov' });
    const second = wanted('entry-2');
    const { pairs } = pairDated(
      [
        stored('lesson-a', 'block-a'),
        stored('lesson-b', 'block-b', { teacherId: 'teacher-yusupov' }),
      ],
      [{ lessons: [first] }, { lessons: [second] }],
    );
    expect(idsOf(pairs, [first, second])).toEqual(['lesson-b', 'lesson-a']);
  });

  it('keeps both lessons of one subject on a shortened day: the one kept in a free slot, the one cancelled at its pattern times', () => {
    // Lesson 6 is kept in the slot of lesson 4, which is not kept and is
    // cancelled at its pattern times, the same clock time (must-fix 1).
    const kept = wanted('entry-6', { start: 650, end: 695 });
    const cancelled = wanted('entry-4', { start: 650, end: 695, cause: 'not_in_template' });
    const { pairs } = pairDated(
      [
        stored('lesson-6', 'block-6', { start: 650, end: 695 }),
        stored('lesson-4', 'block-4', { start: 650, end: 695, cancelCause: 'not_in_template' }),
      ],
      [{ lessons: [kept] }, { lessons: [cancelled] }],
    );
    expect(idsOf(pairs, [kept, cancelled])).toEqual(['lesson-6', 'lesson-4']);
  });

  it('pairs a lesson cancelled by the expansion only with one of the same cause, never with one held', () => {
    const held = wanted('entry-1');
    const weekOff = wanted('entry-2', { unitId: 'class-princeton', cause: 'exam_week' });
    const { pairs } = pairDated(
      [
        stored('lesson-a', 'block-a', { cancelCause: 'not_in_template' }),
        stored('lesson-b', 'block-b', {
          unitId: 'class-princeton',
          cancelCause: 'not_in_template',
        }),
        // Held, of the same class, subject, date and times as the week off.
        stored('lesson-c', 'block-c', { unitId: 'class-princeton' }),
      ],
      [{ lessons: [held] }, { lessons: [weekOff] }],
    );
    expect(idsOf(pairs, [held, weekOff])).toEqual([null, null]);
  });

  it('keeps a lesson with a one-day cancel as a lesson held (decision 8)', () => {
    const held = wanted('entry-1');
    const { pairs } = pairDated(
      [stored('lesson-a', 'block-a', { cancelCause: 'reason' })],
      [{ lessons: [held] }],
    );
    expect(idsOf(pairs, [held])).toEqual(['lesson-a']);
  });

  it('gives a stored block to one new block only: two groups of one block placed as two blocks at one time', () => {
    // Stored block X holds groups G1 (of Oxford) and G2 (of Princeton); the new
    // version places G1 and G2 as two blocks at the same time (must-fix 2).
    const g1 = wanted('entry-g1', { unitId: 'group-1' });
    const g2 = wanted('entry-g2', { unitId: 'group-2', teacherId: 'teacher-yusupov' });
    const { pairs, reused } = pairDated(
      [
        stored('lesson-g1', 'block-x', { unitId: 'group-1' }),
        stored('lesson-g2', 'block-x', { unitId: 'group-2', teacherId: 'teacher-yusupov' }),
      ],
      [{ lessons: [g1] }, { lessons: [g2] }],
    );
    expect(reused).toEqual(['block-x', null]);
    expect(idsOf(pairs, [g1, g2])).toEqual(['lesson-g1', null]);
  });

  it('reuses the block holding most of a new block’s lessons, the smaller id on a tie', () => {
    const a = wanted('entry-a', { unitId: 'group-1' });
    const b = wanted('entry-b', { unitId: 'group-2' });
    const c = wanted('entry-c', { unitId: 'group-3' });
    const most = pairDated(
      [
        stored('lesson-a', 'block-y', { unitId: 'group-1' }),
        stored('lesson-b', 'block-z', { unitId: 'group-2' }),
        stored('lesson-c', 'block-z', { unitId: 'group-3' }),
      ],
      [{ lessons: [a, b, c] }],
    );
    expect(most.reused).toEqual(['block-z']);
    expect(idsOf(most.pairs, [a, b, c])).toEqual([null, 'lesson-b', 'lesson-c']);
    const tie = pairDated(
      [
        stored('lesson-a', 'block-z', { unitId: 'group-1' }),
        stored('lesson-b', 'block-y', { unitId: 'group-2' }),
      ],
      [{ lessons: [a, b] }],
    );
    expect(tie.reused).toEqual(['block-y']);
    expect(idsOf(tie.pairs, [a, b])).toEqual([null, 'lesson-b']);
  });
});
