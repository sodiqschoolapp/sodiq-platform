import { describe, expect, it } from 'vitest';
import {
  needKeyOf,
  pairDated,
  pinnedPairing,
  writtenTeacherOf,
  type PairStored,
  type PairWanted,
} from './dated-lessons.js';

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

  // Task 5.6a-1 (build decision): a lesson created again in another block
  // keeps its one-day cancel, so the writer is told which stored lesson it was.
  it('names the stored lesson of a pair dropped for its block, and only that one', () => {
    const a = wanted('entry-a', { unitId: 'group-1' });
    const b = wanted('entry-b', { unitId: 'group-2' });
    const c = wanted('entry-c', { unitId: 'group-3' });
    const { pairs, recreated } = pairDated(
      [
        stored('lesson-a', 'block-y', { unitId: 'group-1', cancelCause: 'reason' }),
        stored('lesson-b', 'block-z', { unitId: 'group-2' }),
        stored('lesson-c', 'block-z', { unitId: 'group-3' }),
      ],
      [{ lessons: [a, b, c] }],
    );
    expect(idsOf(pairs, [a, b, c])).toEqual([null, 'lesson-b', 'lesson-c']);
    expect(idsOf(recreated, [a, b, c])).toEqual(['lesson-a', null, null]);
  });
});

// Task 6.1b-1, pull request #206 (decisions 2, 3 and 6): lessons with data
// and lessons moved in time by a rewrite of their own version. 06, What a
// change does to existing data: "Removed, if they hold no data"; Protection:
// "Its teacher, room and time can change, with a log entry"; .claude/rules/
// timetable.md: a lesson is named by its pattern entry and pattern date. All
// names are invented.
describe('the pairing of lessons with data and of lessons moved in time', () => {
  const at = (entryId: string, patternDate = DATE) => ({ entryId, patternDate });

  it('pairs by pattern entry, pattern date and date across other times and cancels (pass 2), and pass 1 first', () => {
    const moved = wanted('entry-1', { start: 510, end: 555, ...at('entry-1') });
    const cancelled = wanted('entry-2', {
      unitId: 'class-cambridge',
      cause: 'not_in_template',
      ...at('entry-2'),
    });
    const exact = wanted('entry-3', { unitId: 'class-princeton', ...at('entry-3') });
    const { pairs, second } = pairDated(
      [
        stored('lesson-a', 'block-a', at('entry-1')),
        stored('lesson-b', 'block-b', { unitId: 'class-cambridge', ...at('entry-2') }),
        // An exact pair of another entry is taken in pass 1 before its own entry's.
        stored('lesson-c', 'block-c', { unitId: 'class-princeton', ...at('entry-9') }),
        stored('lesson-d', 'block-d', {
          unitId: 'class-princeton',
          start: 600,
          end: 645,
          ...at('entry-3'),
        }),
      ],
      [{ lessons: [moved] }, { lessons: [cancelled] }, { lessons: [exact] }],
    );
    expect(idsOf(pairs, [moved, cancelled, exact])).toEqual(['lesson-a', 'lesson-b', 'lesson-c']);
    expect([...second]).toEqual([moved, cancelled]);
  });

  it('never pairs by pass 2 across another entry, pattern date, date, class or subject', () => {
    const lesson = wanted('entry-1', { start: 510, end: 555, ...at('entry-1') });
    const { pairs } = pairDated(
      [
        stored('other-entry', 'block-a', at('entry-2')),
        stored('other-date', 'block-b', { date: '2026-11-23', ...at('entry-1', '2026-11-23') }),
        stored('other-unit', 'block-c', { unitId: 'class-cambridge', ...at('entry-1') }),
        stored('other-subject', 'block-d', { subjectId: 'art', ...at('entry-1') }),
        // A stored lesson with no pattern entry is paired by pass 1 only.
        stored('no-entry', 'block-e'),
      ],
      [{ lessons: [lesson] }],
    );
    expect(idsOf(pairs, [lesson])).toEqual([null]);
  });

  it("does not take a lesson moved onto the same weekday a week later for the entry's own lesson there", () => {
    // The lesson of 16 November moved to 23 November by a one-day move: its
    // pattern date stays 16 November.
    const own = wanted('entry-1', {
      date: '2026-11-23',
      start: 510,
      end: 555,
      ...at('entry-1', '2026-11-23'),
    });
    const { pairs } = pairDated(
      [
        stored('moved-here', 'block-a', {
          date: '2026-11-23',
          ...at('entry-1', DATE),
        }),
      ],
      [{ lessons: [own] }],
    );
    expect(idsOf(pairs, [own])).toEqual([null]);
  });

  it('reuses first the block of the most paired lessons with data, then the most paired', () => {
    const a = wanted('entry-a', { unitId: 'group-1' });
    const b = wanted('entry-b', { unitId: 'group-2' });
    const c = wanted('entry-c', { unitId: 'group-3' });
    const rows = [
      stored('lesson-a', 'block-z', { unitId: 'group-1' }),
      stored('lesson-b', 'block-z', { unitId: 'group-2' }),
      stored('lesson-c', 'block-y', { unitId: 'group-3' }),
    ];
    const plain = pairDated(rows, [{ lessons: [a, b, c] }]);
    expect(plain.reused).toEqual(['block-z']);
    const withData = pairDated(rows, [{ lessons: [a, b, c] }], {
      holding: new Set(['lesson-c']),
    });
    expect(withData.reused).toEqual(['block-y']);
    expect(idsOf(withData.recreated, [a, b, c])).toEqual(['lesson-a', 'lesson-b', null]);
  });

  it('never reuses a pinned block: its lessons that pair are created again', () => {
    const a = wanted('entry-a', { unitId: 'group-1' });
    const { pairs, reused, recreated } = pairDated(
      [stored('lesson-a', 'block-z', { unitId: 'group-1' })],
      [{ lessons: [a] }],
      { pinned: new Set(['block-z']) },
    );
    expect(reused).toEqual([null]);
    expect(idsOf(pairs, [a])).toEqual([null]);
    expect(idsOf(recreated, [a])).toEqual(['lesson-a']);
  });

  it('pins the block of a lesson with data that no wanted lesson pairs, reuses another block for the rest, and pins none whose lessons with data all pair', () => {
    // Block z holds group 1 (with data, dropped by the version) and group 2;
    // block y holds group 3 (with data). The version wants groups 2 and 3 in
    // one block, which would reuse block z for group 2 alone ...
    const g2 = wanted('entry-2', { unitId: 'group-2' });
    const g3 = wanted('entry-3', { unitId: 'group-3' });
    const rows = [
      stored('lesson-1', 'block-z', { unitId: 'group-1' }),
      stored('lesson-2', 'block-z', { unitId: 'group-2' }),
      stored('lesson-3', 'block-y', { unitId: 'group-3' }),
    ];
    const { paired, pinned } = pinnedPairing(
      rows,
      [{ lessons: [g2, g3] }],
      new Set(['lesson-1', 'lesson-3']),
    );
    // ... but block z is pinned, so block y is reused and group 2 created again.
    expect([...pinned]).toEqual(['block-z']);
    expect(paired.reused).toEqual(['block-y']);
    expect(idsOf(paired.pairs, [g2, g3])).toEqual([null, 'lesson-3']);
    expect(idsOf(paired.recreated, [g2, g3])).toEqual(['lesson-2', null]);

    // A block whose lessons with data all pair exactly is never pinned.
    const kept = pinnedPairing(rows.slice(1), [{ lessons: [g2, g3] }], new Set(['lesson-2']));
    expect([...kept.pinned]).toEqual([]);
    expect(kept.paired.reused).toEqual(['block-z']);
  });
});

// Task 5.5b-2, pull request #154 (decision 5): the teacher a lesson is
// written with, which the impact preview gives its "after" side too.
// 06, How surprises are prevented: "A dated lesson of a vacancy keeps the
// vacancy as its teacher and is \"needs a teacher\" from the day it is created".
describe('the teacher a dated lesson is written with', () => {
  const needs = new Set([needKeyOf('entry-1', DATE), needKeyOf('entry-2', DATE)]);
  const vacancies = new Set(['vacancy-english']);

  it('gives no teacher to a lesson in the needs-a-teacher list', () => {
    expect(
      writtenTeacherOf(needs, vacancies, {
        entryId: 'entry-1',
        date: DATE,
        teacherId: 'teacher-karimova',
      }),
    ).toBeNull();
  });

  it('keeps a vacancy in the list as the teacher', () => {
    expect(
      writtenTeacherOf(needs, vacancies, {
        entryId: 'entry-2',
        date: DATE,
        teacherId: 'vacancy-english',
      }),
    ).toBe('vacancy-english');
  });

  it('keeps the teacher of a lesson not in the list, also of the same entry on another date', () => {
    expect(
      writtenTeacherOf(needs, vacancies, {
        entryId: 'entry-3',
        date: DATE,
        teacherId: 'teacher-karimova',
      }),
    ).toBe('teacher-karimova');
    expect(
      writtenTeacherOf(needs, vacancies, {
        entryId: 'entry-1',
        date: '2026-11-23',
        teacherId: 'teacher-karimova',
      }),
    ).toBe('teacher-karimova');
  });
});
