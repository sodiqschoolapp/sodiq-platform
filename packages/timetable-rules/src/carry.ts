/**
 * "Carry the change into them" (task 5.5a-3a): the changes of a draft against
 * the version it started from, and the same changes made in a later version.
 *
 * docs/spec/edge-cases/timetable.md, Versions and drafts: "Publishing before
 * an already published later version asks: 'run until that version starts',
 * 'replace the versions that follow', or — offered only when the new version
 * differs from the version it started from in nothing but the teachers or
 * rooms of entries — 'carry the change into them': the same changes are made
 * in every later version that still has those entries, in the same step and
 * the same preview, as for filling a vacancy".
 *
 * Decision 4: load rows are matched by class or group and subject, pattern
 * entries by that row, weekday and slot position. An entry's teacher is its
 * load row's (0058, `pattern_entries_load_row_fkey`), so a teacher change is
 * a change of the row. A Tutor row is never a change: its teacher follows the
 * class's Tutor. Pins, weights, rules and the shortened-day choices are not
 * entries and are not compared.
 */

/** A load row as the comparison reads it. */
export interface CarryRow {
  readonly id: string;
  readonly classId: string | null;
  readonly groupId: string | null;
  readonly subjectId: string;
  readonly teacherId: string;
  readonly roomId: string | null;
  readonly lessonsPerWeek: number;
  readonly roomType: string | null;
  readonly doubleLessons: boolean;
  readonly mixedBlock: boolean;
  readonly shortReason: string | null;
  /** A Tutor subject on a class row: its teacher follows the Tutor. */
  readonly tutorRow: boolean;
}

/** A pattern entry: its row, the weekday and slot position of its block, its room. */
export interface CarryEntry {
  readonly id: string;
  readonly loadRowId: string;
  readonly weekday: number;
  readonly slotPosition: number;
  readonly roomId: string | null;
}

export interface CarryVersion {
  readonly rows: readonly CarryRow[];
  readonly entries: readonly CarryEntry[];
}

/** The class or group and subject a change names (the row's key). */
interface ChangeUnit {
  readonly classId: string | null;
  readonly groupId: string | null;
  readonly subjectId: string;
}

export type CarryChange =
  | (ChangeUnit & { readonly kind: 'teacher'; readonly before: string; readonly after: string })
  | (ChangeUnit & {
      readonly kind: 'row_room';
      readonly before: string | null;
      readonly after: string | null;
    })
  | (ChangeUnit & {
      readonly kind: 'entry_room';
      readonly weekday: number;
      readonly slotPosition: number;
      readonly before: string | null;
      readonly after: string | null;
    });

export type CarryOffer =
  | { readonly offered: true; readonly changes: readonly CarryChange[] }
  | { readonly offered: false; readonly reason: 'no_source' | 'nothing_changed' | 'other_changes' };

const rowKey = (one: ChangeUnit): string =>
  `${one.classId ?? ''}|${one.groupId ?? ''}|${one.subjectId}`;

const entryKey = (unit: string, one: { weekday: number; slotPosition: number }): string =>
  `${unit}|${String(one.weekday)}|${String(one.slotPosition)}`;

const unitOf = (one: CarryRow): ChangeUnit => ({
  classId: one.classId,
  groupId: one.groupId,
  subjectId: one.subjectId,
});

/** The entries of a version by their key; `null` when two entries share one. */
function entriesByKey(version: CarryVersion): Map<string, CarryEntry> | null {
  const rowOf = new Map(version.rows.map((one) => [one.id, one]));
  const byKey = new Map<string, CarryEntry>();
  for (const one of version.entries) {
    const owner = rowOf.get(one.loadRowId);
    if (owner === undefined) return null;
    const key = entryKey(rowKey(owner), one);
    if (byKey.has(key)) return null;
    byKey.set(key, one);
  }
  return byKey;
}

/**
 * A pattern entry as the comparison of two versions reads it (task 5.8a):
 * with the clock time of its block and whether the block is half of a double
 * lesson. The times and the pair are compared only when both sides give them.
 */
export interface DiffEntry extends CarryEntry {
  readonly start?: number;
  readonly end?: number;
  readonly double?: boolean;
}

export interface DiffVersion {
  readonly rows: readonly CarryRow[];
  readonly entries: readonly DiffEntry[];
}

/** A field of a load row other than its teacher and room. */
export type RowField =
  'lessonsPerWeek' | 'roomType' | 'doubleLessons' | 'mixedBlock' | 'shortReason' | 'tutorRow';

const ROW_FIELDS: readonly RowField[] = [
  'lessonsPerWeek',
  'roomType',
  'doubleLessons',
  'mixedBlock',
  'shortReason',
  'tutorRow',
];

interface PlacementUnit extends ChangeUnit {
  readonly weekday: number;
  readonly slotPosition: number;
}

/** One difference of a version against another. */
export type VersionDifference =
  | (ChangeUnit & {
      readonly kind: 'row_added' | 'row_removed';
      readonly teacherId: string;
      readonly lessonsPerWeek: number;
    })
  | (ChangeUnit & {
      readonly kind: 'teacher';
      readonly before: string;
      readonly after: string;
      /** A Tutor row: its teacher follows the class's Tutor, so carry never takes it. */
      readonly tutorRow: boolean;
    })
  | (ChangeUnit & {
      readonly kind: 'row_room';
      readonly before: string | null;
      readonly after: string | null;
    })
  | (ChangeUnit & {
      readonly kind: 'row_field';
      readonly field: RowField;
      readonly before: string | number | boolean | null;
      readonly after: string | number | boolean | null;
    })
  | (PlacementUnit & {
      readonly kind: 'placement_added' | 'placement_removed';
      readonly roomId: string | null;
    })
  | (PlacementUnit & {
      readonly kind: 'entry_room';
      readonly before: string | null;
      readonly after: string | null;
    })
  | (PlacementUnit & {
      readonly kind: 'placement_time';
      readonly before: { readonly start: number; readonly end: number };
      readonly after: { readonly start: number; readonly end: number };
    })
  | (PlacementUnit & {
      readonly kind: 'placement_double';
      readonly before: boolean;
      readonly after: boolean;
    });

/** The entries of a version with their row, by key; a second entry of one key is dropped. */
function placementsOf(version: DiffVersion): Map<string, { entry: DiffEntry; row: CarryRow }> {
  const rowOf = new Map(version.rows.map((one) => [one.id, one]));
  const byKey = new Map<string, { entry: DiffEntry; row: CarryRow }>();
  for (const one of version.entries) {
    const owner = rowOf.get(one.loadRowId);
    if (owner === undefined) continue;
    const key = entryKey(rowKey(owner), one);
    if (!byKey.has(key)) byKey.set(key, { entry: one, row: owner });
  }
  return byKey;
}

/**
 * The differences of `after` against `before` (task 5.8a; `06`, Protection:
 * "compares two versions"): rows matched by class or group and subject,
 * placements by that row, weekday and slot position, as carry matches them.
 * The rows in the order of `after`, then the rows removed; the same for
 * placements.
 */
export function versionDifferences(before: DiffVersion, after: DiffVersion): VersionDifference[] {
  const differences: VersionDifference[] = [];
  const beforeRows = new Map(before.rows.map((one) => [rowKey(one), one]));
  const afterKeys = new Set(after.rows.map(rowKey));
  for (const now of after.rows) {
    const was = beforeRows.get(rowKey(now));
    if (was === undefined) {
      differences.push({
        kind: 'row_added',
        ...unitOf(now),
        teacherId: now.teacherId,
        lessonsPerWeek: now.lessonsPerWeek,
      });
      continue;
    }
    for (const field of ROW_FIELDS) {
      if (was[field] !== now[field]) {
        differences.push({
          kind: 'row_field',
          ...unitOf(now),
          field,
          before: was[field],
          after: now[field],
        });
      }
    }
    if (was.teacherId !== now.teacherId) {
      differences.push({
        kind: 'teacher',
        ...unitOf(now),
        before: was.teacherId,
        after: now.teacherId,
        tutorRow: was.tutorRow && now.tutorRow,
      });
    }
    if (was.roomId !== now.roomId) {
      differences.push({ kind: 'row_room', ...unitOf(now), before: was.roomId, after: now.roomId });
    }
  }
  for (const was of before.rows) {
    if (!afterKeys.has(rowKey(was))) {
      differences.push({
        kind: 'row_removed',
        ...unitOf(was),
        teacherId: was.teacherId,
        lessonsPerWeek: was.lessonsPerWeek,
      });
    }
  }
  const beforePlaces = placementsOf(before);
  const afterPlaces = placementsOf(after);
  const placeOf = (row: CarryRow, entry: DiffEntry): PlacementUnit => ({
    ...unitOf(row),
    weekday: entry.weekday,
    slotPosition: entry.slotPosition,
  });
  for (const [key, now] of afterPlaces) {
    const was = beforePlaces.get(key);
    const unit = placeOf(now.row, now.entry);
    if (was === undefined) {
      differences.push({ kind: 'placement_added', ...unit, roomId: now.entry.roomId });
      continue;
    }
    if (was.entry.roomId !== now.entry.roomId) {
      differences.push({
        kind: 'entry_room',
        ...unit,
        before: was.entry.roomId,
        after: now.entry.roomId,
      });
    }
    const [a, b] = [was.entry, now.entry];
    if (
      a.start !== undefined &&
      a.end !== undefined &&
      b.start !== undefined &&
      b.end !== undefined &&
      (a.start !== b.start || a.end !== b.end)
    ) {
      differences.push({
        kind: 'placement_time',
        ...unit,
        before: { start: a.start, end: a.end },
        after: { start: b.start, end: b.end },
      });
    }
    if (a.double !== undefined && b.double !== undefined && a.double !== b.double) {
      differences.push({ kind: 'placement_double', ...unit, before: a.double, after: b.double });
    }
  }
  for (const [key, was] of beforePlaces) {
    if (!afterPlaces.has(key)) {
      differences.push({
        kind: 'placement_removed',
        ...placeOf(was.row, was.entry),
        roomId: was.entry.roomId,
      });
    }
  }
  return differences;
}

/**
 * Whether carry is offered for a draft, and its changes: read from
 * `versionDifferences` (task 5.8a), offered when every difference is a
 * teacher (a Tutor row's never counts) or a room.
 */
export function carryChanges(source: CarryVersion | null, draft: CarryVersion): CarryOffer {
  if (source === null) return { offered: false, reason: 'no_source' };
  const before = new Map(source.rows.map((one) => [rowKey(one), one]));
  if (before.size !== source.rows.length || draft.rows.length !== source.rows.length) {
    return { offered: false, reason: 'other_changes' };
  }
  const sourceEntries = entriesByKey(source);
  const draftEntries = entriesByKey(draft);
  if (sourceEntries === null || draftEntries === null || sourceEntries.size !== draftEntries.size) {
    return { offered: false, reason: 'other_changes' };
  }
  const changes: CarryChange[] = [];
  for (const difference of versionDifferences(source, draft)) {
    switch (difference.kind) {
      case 'teacher': {
        const { tutorRow, ...change } = difference;
        if (!tutorRow) changes.push(change);
        break;
      }
      case 'row_room':
        changes.push(difference);
        break;
      case 'entry_room':
        changes.push(difference);
        break;
      default:
        return { offered: false, reason: 'other_changes' };
    }
  }
  return changes.length === 0
    ? { offered: false, reason: 'nothing_changed' }
    : { offered: true, changes };
}

/** What a later version takes of the changes: its rows and entries written, and the changes applied. */
export interface CarriedInto {
  readonly rows: readonly { id: string; teacherId: string; roomId: string | null }[];
  readonly entries: readonly { id: string; roomId: string | null }[];
  readonly applied: readonly CarryChange[];
}

/**
 * The changes made in a later version where it still has the same before
 * value (review correction 2): a change with no matching row or entry, or
 * with another value there, is nothing to carry for that version.
 */
export function carryInto(version: CarryVersion, changes: readonly CarryChange[]): CarriedInto {
  const rows = new Map(version.rows.map((one) => [rowKey(one), one]));
  const entries = entriesByKey(version) ?? new Map<string, CarryEntry>();
  const written = new Map<string, { id: string; teacherId: string; roomId: string | null }>();
  const rooms: { id: string; roomId: string | null }[] = [];
  const applied: CarryChange[] = [];
  for (const change of changes) {
    const key = rowKey(change);
    const target = rows.get(key);
    if (target === undefined) continue;
    if (change.kind === 'entry_room') {
      const found = entries.get(entryKey(key, change));
      if (found === undefined || found.roomId !== change.before) continue;
      rooms.push({ id: found.id, roomId: change.after });
      applied.push(change);
      continue;
    }
    const now = written.get(target.id) ?? {
      id: target.id,
      teacherId: target.teacherId,
      roomId: target.roomId,
    };
    if (change.kind === 'teacher') {
      if (target.tutorRow || target.teacherId !== change.before) continue;
      written.set(target.id, { ...now, teacherId: change.after });
    } else {
      if (target.roomId !== change.before) continue;
      written.set(target.id, { ...now, roomId: change.after });
    }
    applied.push(change);
  }
  return { rows: [...written.values()], entries: rooms, applied };
}
