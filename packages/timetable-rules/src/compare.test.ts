import { describe, expect, it } from 'vitest';
import {
  carryChanges,
  versionDifferences,
  type CarryRow,
  type DiffEntry,
  type DiffVersion,
} from './carry.js';

// docs/spec/06-timetable.md, Protection: "Version history ... compares two
// versions" (task 5.8a). Rows are matched by class or group and subject,
// placements by that row, weekday and slot position (decision 4).

const row = (id: string, more: Partial<CarryRow> = {}): CarryRow => ({
  id,
  classId: 'class-a',
  groupId: null,
  subjectId: `subject-${id}`,
  teacherId: 'teacher-1',
  roomId: null,
  lessonsPerWeek: 2,
  roomType: null,
  doubleLessons: false,
  mixedBlock: false,
  shortReason: null,
  tutorRow: false,
  ...more,
});

const entry = (id: string, loadRowId: string, more: Partial<DiffEntry> = {}): DiffEntry => ({
  id,
  loadRowId,
  weekday: 1,
  slotPosition: 1,
  roomId: 'room-1',
  start: 480,
  end: 525,
  double: false,
  ...more,
});

const before: DiffVersion = {
  rows: [row('a-maths', { subjectId: 'maths' }), row('a-art', { subjectId: 'art' })],
  entries: [
    entry('a-e1', 'a-maths'),
    entry('a-e2', 'a-maths', { weekday: 2, slotPosition: 2, start: 535, end: 580 }),
    entry('a-e3', 'a-art', { weekday: 3, slotPosition: 3, roomId: 'room-2' }),
  ],
};

/** The same version under other ids, with a change. */
function copyOf(
  change: { rows?: (one: CarryRow) => CarryRow; entries?: (one: DiffEntry) => DiffEntry } = {},
): DiffVersion {
  const id = (old: string) => `b${old.slice(1)}`;
  return {
    rows: before.rows.map((one) => (change.rows ?? ((x) => x))({ ...one, id: id(one.id) })),
    entries: before.entries.map((one) =>
      (change.entries ?? ((x) => x))({ ...one, id: id(one.id), loadRowId: id(one.loadRowId) }),
    ),
  };
}

const unit = { classId: 'class-a', groupId: null };

describe('versionDifferences', () => {
  it('finds nothing between a version and its copy under other ids', () => {
    expect(versionDifferences(before, copyOf())).toEqual([]);
  });

  it('lists a row added and a row removed with their placements', () => {
    const after: DiffVersion = {
      rows: [before.rows[0] as CarryRow, row('b-music', { subjectId: 'music' })],
      entries: [
        ...before.entries.filter((one) => one.loadRowId === 'a-maths'),
        entry('b-e9', 'b-music', { weekday: 4 }),
      ],
    };
    expect(versionDifferences(before, after)).toEqual([
      { kind: 'row_added', ...unit, subjectId: 'music', teacherId: 'teacher-1', lessonsPerWeek: 2 },
      { kind: 'row_removed', ...unit, subjectId: 'art', teacherId: 'teacher-1', lessonsPerWeek: 2 },
      {
        kind: 'placement_added',
        ...unit,
        subjectId: 'music',
        weekday: 4,
        slotPosition: 1,
        roomId: 'room-1',
      },
      {
        kind: 'placement_removed',
        ...unit,
        subjectId: 'art',
        weekday: 3,
        slotPosition: 3,
        roomId: 'room-2',
      },
    ]);
  });

  it('lists the teacher, lessons per week, room and "deliberately short" of a row', () => {
    const after = copyOf({
      rows: (one) =>
        one.subjectId === 'maths'
          ? {
              ...one,
              teacherId: 'teacher-2',
              lessonsPerWeek: 3,
              roomId: 'room-9',
              shortReason: 'Hall closed',
            }
          : one,
    });
    expect(versionDifferences(before, after)).toEqual([
      {
        kind: 'row_field',
        ...unit,
        subjectId: 'maths',
        field: 'lessonsPerWeek',
        before: 2,
        after: 3,
      },
      {
        kind: 'row_field',
        ...unit,
        subjectId: 'maths',
        field: 'shortReason',
        before: null,
        after: 'Hall closed',
      },
      {
        kind: 'teacher',
        ...unit,
        subjectId: 'maths',
        before: 'teacher-1',
        after: 'teacher-2',
        tutorRow: false,
      },
      { kind: 'row_room', ...unit, subjectId: 'maths', before: null, after: 'room-9' },
    ]);
  });

  it("lists a Tutor row's teacher, which carry still never takes", () => {
    const tutorBefore: DiffVersion = {
      rows: [row('a-homework', { subjectId: 'homework', tutorRow: true })],
      entries: [],
    };
    const tutorAfter: DiffVersion = {
      rows: [row('b-homework', { subjectId: 'homework', tutorRow: true, teacherId: 'tutor-2' })],
      entries: [],
    };
    expect(versionDifferences(tutorBefore, tutorAfter)).toEqual([
      {
        kind: 'teacher',
        ...unit,
        subjectId: 'homework',
        before: 'teacher-1',
        after: 'tutor-2',
        tutorRow: true,
      },
    ]);
    expect(carryChanges(tutorBefore, tutorAfter)).toEqual({
      offered: false,
      reason: 'nothing_changed',
    });
  });

  it('lists a moved placement as one removed and one added', () => {
    const after = copyOf({
      entries: (one) => (one.id === 'b-e3' ? { ...one, weekday: 5 } : one),
    });
    expect(versionDifferences(before, after)).toEqual([
      {
        kind: 'placement_added',
        ...unit,
        subjectId: 'art',
        weekday: 5,
        slotPosition: 3,
        roomId: 'room-2',
      },
      {
        kind: 'placement_removed',
        ...unit,
        subjectId: 'art',
        weekday: 3,
        slotPosition: 3,
        roomId: 'room-2',
      },
    ]);
  });

  it('lists a placement retimed in the same slot (a template changed between the two starts)', () => {
    const after = copyOf({
      entries: (one) => (one.id === 'b-e2' ? { ...one, start: 540, end: 580 } : one),
    });
    expect(versionDifferences(before, after)).toEqual([
      {
        kind: 'placement_time',
        ...unit,
        subjectId: 'maths',
        weekday: 2,
        slotPosition: 2,
        before: { start: 535, end: 580 },
        after: { start: 540, end: 580 },
      },
    ]);
  });

  it('lists a placement joined to a double lesson', () => {
    const after = copyOf({
      entries: (one) => (one.id === 'b-e1' ? { ...one, double: true } : one),
    });
    expect(versionDifferences(before, after)).toEqual([
      {
        kind: 'placement_double',
        ...unit,
        subjectId: 'maths',
        weekday: 1,
        slotPosition: 1,
        before: false,
        after: true,
      },
    ]);
  });

  it('lists the room of a placement', () => {
    const after = copyOf({
      entries: (one) => (one.id === 'b-e3' ? { ...one, roomId: 'room-3' } : one),
    });
    expect(versionDifferences(before, after)).toEqual([
      {
        kind: 'entry_room',
        ...unit,
        subjectId: 'art',
        weekday: 3,
        slotPosition: 3,
        before: 'room-2',
        after: 'room-3',
      },
    ]);
  });

  it('matches rows by class or group and subject, never by id', () => {
    const sameIds: DiffVersion = {
      rows: [row('a-maths', { subjectId: 'physics' }), row('a-art', { subjectId: 'art' })],
      entries: before.entries,
    };
    const kinds = versionDifferences(before, sameIds).map((one) => one.kind);
    expect(kinds).toContain('row_added');
    expect(kinds).toContain('row_removed');
  });

  it('compares no times or pairs when a side does not give them', () => {
    const bare = copyOf({
      entries: (one) => ({
        id: one.id,
        loadRowId: one.loadRowId,
        weekday: one.weekday,
        slotPosition: one.slotPosition,
        roomId: one.roomId,
      }),
    });
    expect(versionDifferences(before, bare)).toEqual([]);
  });
});
