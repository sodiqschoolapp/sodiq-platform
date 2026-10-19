import { describe, expect, it } from 'vitest';
import type { StoredLesson } from './stored-lessons.js';
import { weekChanges } from './week-changes.js';

// Task 5.5c-3a, pull request #158: the comparison of the lessons stored
// before and after a publish or withdraw (edge/timetable, After publishing:
// "One notice per person per event, with the week before and after. A teacher
// whose week did not change gets none."; `06`, How surprises are prevented:
// "Changed lessons carry a 'changed' mark on every timetable view for a
// week."). Ids are invented.

const EARLIER = new Date('2026-10-08T10:00:00Z');

/** A stored lesson of class `c1`, maths, 08:00 to 08:45, teacher `t1`, room `r1` unless named. */
function lesson(
  id: string,
  date: string,
  more: {
    start?: number;
    unitId?: string;
    teacherId?: string | null;
    roomId?: string | null;
    changedAt?: Date | null;
    cancelCause?: string | null;
  } = {},
): StoredLesson {
  const start = more.start ?? 480;
  const teacherId = more.teacherId === undefined ? 't1' : more.teacherId;
  return {
    id,
    cancelCause: more.cancelCause ?? null,
    changedAt: more.changedAt ?? null,
    lesson: {
      date,
      weekday: 1,
      start,
      end: start + 45,
      unitId: more.unitId ?? 'c1',
      subjectId: 'maths',
      classIds: ['c1'],
      teacherIds: teacherId === null ? [] : [teacherId],
      roomId: more.roomId === undefined ? 'r1' : more.roomId,
    },
  };
}

describe('weekChanges', () => {
  it('finds nothing when every lesson stays as it was', () => {
    const before = [lesson('a', '2026-10-19'), lesson('b', '2026-10-26')];
    const changes = weekChanges(before, before);
    expect(changes.marked).toEqual([]);
    expect(changes.kept).toEqual([]);
    expect([...changes.teachers]).toEqual([]);
  });

  it('marks a lesson moved to another day and names its teacher with the week of the earliest change', () => {
    // Monday 19 October moves to Wednesday 21 October; the same for the next week.
    const changes = weekChanges(
      [lesson('a', '2026-10-19'), lesson('b', '2026-10-26')],
      [lesson('c', '2026-10-21'), lesson('d', '2026-10-28')],
    );
    expect(changes.marked).toEqual(['c', 'd']);
    expect([...changes.teachers]).toEqual([['t1', '2026-10-19']]);
  });

  it('marks a room change and names the teacher', () => {
    const changes = weekChanges(
      [lesson('a', '2026-10-19')],
      [lesson('a', '2026-10-19', { roomId: 'r2' })],
    );
    expect(changes.marked).toEqual(['a']);
    expect([...changes.teachers]).toEqual([['t1', '2026-10-19']]);
  });

  // Task 5.6a-1 (decision 11; From 5.5c-3a, code review 1): a one-day cancel
  // or a restore changes the teacher's week.
  it('marks a lesson cancelled on one side only, either way, and names its teacher', () => {
    const cancel = weekChanges(
      [lesson('a', '2026-10-19')],
      [lesson('a', '2026-10-19', { cancelCause: 'reason' })],
    );
    expect(cancel.marked).toEqual(['a']);
    expect([...cancel.teachers]).toEqual([['t1', '2026-10-19']]);
    const restore = weekChanges(
      [lesson('a', '2026-10-19', { cancelCause: 'reason' })],
      [lesson('a', '2026-10-19')],
    );
    expect(restore.marked).toEqual(['a']);
    expect([...restore.beforeDiffers]).toEqual(['a']);
    const same = weekChanges(
      [lesson('a', '2026-10-19', { cancelCause: 'reason' })],
      [lesson('a', '2026-10-19', { cancelCause: 'reason' })],
    );
    expect(same.marked).toEqual([]);
    expect([...same.teachers]).toEqual([]);
  });

  it('names the old and the new teacher of a lesson given to another', () => {
    const changes = weekChanges(
      [lesson('a', '2026-10-20')],
      [lesson('a', '2026-10-20', { teacherId: 't2' })],
    );
    expect(changes.marked).toEqual(['a']);
    expect([...changes.teachers]).toEqual([
      ['t1', '2026-10-19'],
      ['t2', '2026-10-19'],
    ]);
  });

  it('names the teacher of a lesson removed, and marks nothing', () => {
    const changes = weekChanges(
      [lesson('a', '2026-10-22'), lesson('b', '2026-10-22', { start: 535, teacherId: 't2' })],
      [lesson('b', '2026-10-22', { start: 535, teacherId: 't2' })],
    );
    expect(changes.marked).toEqual([]);
    expect([...changes.teachers]).toEqual([['t1', '2026-10-19']]);
  });

  it('finds nothing for a lesson removed and created again equal, and the new one keeps the mark', () => {
    // Another block: a new id, the same date, times, class, subject, teacher and room.
    const changes = weekChanges(
      [lesson('a', '2026-10-19', { changedAt: EARLIER })],
      [lesson('z', '2026-10-19')],
    );
    expect(changes.marked).toEqual([]);
    expect(changes.kept).toEqual([{ id: 'z', changedAt: EARLIER }]);
    expect([...changes.teachers]).toEqual([]);
  });

  it('pairs a kept lesson with itself before an equal one', () => {
    // Two equal lessons of two groups would differ by unit; two equal of one
    // unit cannot be stored, so the pair is checked with a mark: `a` keeps its
    // own and is not listed as kept from `b`.
    const changes = weekChanges(
      [lesson('a', '2026-10-19', { changedAt: EARLIER }), lesson('b', '2026-10-19')],
      [lesson('b', '2026-10-19'), lesson('a', '2026-10-19', { changedAt: EARLIER })],
    );
    expect(changes.kept).toEqual([]);
    expect(changes.marked).toEqual([]);
  });

  it('leaves the teacher of another unchanged class out', () => {
    const other = lesson('o', '2026-10-19', { unitId: 'c2', teacherId: 't2', start: 535 });
    const changes = weekChanges(
      [lesson('a', '2026-10-19'), other],
      [lesson('a', '2026-10-19', { start: 590 }), other],
    );
    expect([...changes.teachers]).toEqual([['t1', '2026-10-19']]);
    expect(changes.marked).toEqual(['a']);
  });

  it('takes the week of the earliest change of each teacher, on either side', () => {
    // t1 loses a lesson on 3 November and gains one on 28 October: the week of 26 October.
    const changes = weekChanges([lesson('a', '2026-11-03')], [lesson('b', '2026-10-28')]);
    expect([...changes.teachers]).toEqual([['t1', '2026-10-26']]);
  });

  it('marks nothing in a week with no lesson before (decision 4), but names the teacher', () => {
    // The week of 26 October had no lesson; the week of 19 October had one.
    const changes = weekChanges(
      [lesson('a', '2026-10-19')],
      [
        lesson('a', '2026-10-19'),
        lesson('b', '2026-10-20', { teacherId: 't2' }),
        lesson('c', '2026-10-27', { teacherId: 't2' }),
      ],
    );
    expect(changes.marked).toEqual(['b']);
    expect([...changes.teachers]).toEqual([['t2', '2026-10-19']]);
  });

  it('reads the days of the week before the start as lessons before', () => {
    // A publish from Wednesday 21 October: Monday's lesson is not written.
    const changes = weekChanges([], [lesson('b', '2026-10-22')], [lesson('a', '2026-10-19')]);
    expect(changes.marked).toEqual(['b']);
  });

  it('names no teacher for a lesson with none ("needs a teacher")', () => {
    const changes = weekChanges(
      [lesson('a', '2026-10-19')],
      [lesson('a', '2026-10-19', { teacherId: null })],
    );
    expect(changes.marked).toEqual(['a']);
    expect([...changes.teachers]).toEqual([['t1', '2026-10-19']]);
  });
});
