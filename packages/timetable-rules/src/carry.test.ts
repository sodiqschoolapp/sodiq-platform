import { describe, expect, it } from 'vitest';
import {
  carryChanges,
  carryInto,
  type CarryEntry,
  type CarryRow,
  type CarryVersion,
} from './carry.js';

// edge/timetable, Versions and drafts: "'carry the change into them' — offered
// only when the new version differs from the version it started from in
// nothing but the teachers or rooms of entries: the same changes are made in
// every later version that still has those entries".

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

const entry = (id: string, loadRowId: string, more: Partial<CarryEntry> = {}): CarryEntry => ({
  id,
  loadRowId,
  weekday: 1,
  slotPosition: 1,
  roomId: 'room-1',
  ...more,
});

/** The source: two rows of class A, maths on Monday 1 and Tuesday 2, art on Wednesday 3. */
const source: CarryVersion = {
  rows: [row('s-maths', { subjectId: 'maths' }), row('s-art', { subjectId: 'art' })],
  entries: [
    entry('s-e1', 's-maths'),
    entry('s-e2', 's-maths', { weekday: 2, slotPosition: 2 }),
    entry('s-e3', 's-art', { weekday: 3, slotPosition: 3, roomId: 'room-2' }),
  ],
};

/** The same timetable under other ids, as a copy has it. */
function copyOf(
  version: CarryVersion,
  prefix: string,
  change: { rows?: (one: CarryRow) => CarryRow; entries?: (one: CarryEntry) => CarryEntry } = {},
): CarryVersion {
  const id = (old: string) => `${prefix}${old.slice(old.indexOf('-'))}`;
  return {
    rows: version.rows.map((one) => (change.rows ?? ((x) => x))({ ...one, id: id(one.id) })),
    entries: version.entries.map((one) =>
      (change.entries ?? ((x) => x))({ ...one, id: id(one.id), loadRowId: id(one.loadRowId) }),
    ),
  };
}

describe('carryChanges', () => {
  it('is offered for a teacher change, a row room change and an entry room change', () => {
    const draft = copyOf(source, 'd', {
      rows: (one) =>
        one.subjectId === 'maths' ? { ...one, teacherId: 'teacher-2', roomId: 'room-9' } : one,
      entries: (one) => (one.id === 'd-e3' ? { ...one, roomId: 'room-3' } : one),
    });
    expect(carryChanges(source, draft)).toEqual({
      offered: true,
      changes: [
        {
          kind: 'teacher',
          classId: 'class-a',
          groupId: null,
          subjectId: 'maths',
          before: 'teacher-1',
          after: 'teacher-2',
        },
        {
          kind: 'row_room',
          classId: 'class-a',
          groupId: null,
          subjectId: 'maths',
          before: null,
          after: 'room-9',
        },
        {
          kind: 'entry_room',
          classId: 'class-a',
          groupId: null,
          subjectId: 'art',
          weekday: 3,
          slotPosition: 3,
          before: 'room-2',
          after: 'room-3',
        },
      ],
    });
  });

  it('is not offered when nothing differs', () => {
    expect(carryChanges(source, copyOf(source, 'd'))).toEqual({
      offered: false,
      reason: 'nothing_changed',
    });
  });

  it('is not offered without a source', () => {
    expect(carryChanges(null, copyOf(source, 'd'))).toEqual({
      offered: false,
      reason: 'no_source',
    });
  });

  it('is not offered when the lessons per week differ', () => {
    const draft = copyOf(source, 'd', {
      rows: (one) => (one.subjectId === 'art' ? { ...one, lessonsPerWeek: 3 } : one),
    });
    expect(carryChanges(source, draft)).toEqual({ offered: false, reason: 'other_changes' });
  });

  it('is not offered when a row or an entry is added or removed', () => {
    const added = copyOf(source, 'd');
    expect(
      carryChanges(source, {
        rows: [...added.rows, row('d-music', { subjectId: 'music' })],
        entries: added.entries,
      }),
    ).toEqual({ offered: false, reason: 'other_changes' });
    expect(carryChanges(source, { rows: added.rows, entries: added.entries.slice(1) })).toEqual({
      offered: false,
      reason: 'other_changes',
    });
  });

  it('is not offered when an entry is moved to another slot', () => {
    const draft = copyOf(source, 'd', {
      entries: (one) => (one.id === 'd-e1' ? { ...one, slotPosition: 4 } : one),
    });
    expect(carryChanges(source, draft)).toEqual({ offered: false, reason: 'other_changes' });
  });

  it('does not count a Tutor row whose teacher follows the Tutor as a change', () => {
    const tutor: CarryVersion = {
      rows: [...source.rows, row('s-tutor', { subjectId: 'tutor', tutorRow: true })],
      entries: source.entries,
    };
    const draft = copyOf(tutor, 'd', {
      rows: (one) =>
        one.tutorRow
          ? { ...one, teacherId: 'teacher-7' }
          : one.subjectId === 'maths'
            ? { ...one, teacherId: 'teacher-2' }
            : one,
    });
    const answer = carryChanges(tutor, draft);
    expect(answer.offered && answer.changes.map((one) => one.subjectId)).toEqual(['maths']);
  });
});

describe('carryInto', () => {
  const changes = (() => {
    const draft = copyOf(source, 'd', {
      rows: (one) => (one.subjectId === 'maths' ? { ...one, teacherId: 'teacher-2' } : one),
      entries: (one) => (one.id === 'd-e3' ? { ...one, roomId: 'room-3' } : one),
    });
    const answer = carryChanges(source, draft);
    if (!answer.offered) throw new Error('offered');
    return answer.changes;
  })();

  it('changes a later version that still has the entries', () => {
    const later = copyOf(source, 'l');
    expect(carryInto(later, changes)).toEqual({
      rows: [{ id: 'l-maths', teacherId: 'teacher-2', roomId: null }],
      entries: [{ id: 'l-e3', roomId: 'room-3' }],
      applied: changes,
    });
  });

  // Review correction 2: a change whose row or entry has another before
  // value, or has no match, is nothing to carry for that version; the others
  // still apply.
  it('carries only the changes whose before value the version still has', () => {
    const later = copyOf(source, 'l', {
      rows: (one) => (one.subjectId === 'maths' ? { ...one, teacherId: 'teacher-5' } : one),
    });
    expect(carryInto(later, changes)).toEqual({
      rows: [],
      entries: [{ id: 'l-e3', roomId: 'room-3' }],
      applied: [changes[1]],
    });
  });

  it('carries nothing into a version without the entries', () => {
    const later: CarryVersion = {
      rows: [row('l-music', { subjectId: 'music' })],
      entries: [entry('l-e1', 'l-music', { weekday: 3, slotPosition: 3, roomId: 'room-2' })],
    };
    expect(carryInto(later, changes)).toEqual({ rows: [], entries: [], applied: [] });
  });

  it('matches an entry by its row, weekday and slot position', () => {
    const later = copyOf(source, 'l', {
      entries: (one) => (one.id === 'l-e3' ? { ...one, slotPosition: 4 } : one),
    });
    expect(carryInto(later, changes).entries).toEqual([]);
  });
});
