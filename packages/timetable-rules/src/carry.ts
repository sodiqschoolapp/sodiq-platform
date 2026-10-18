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

/** Whether carry is offered for a draft, and its changes. */
export function carryChanges(source: CarryVersion | null, draft: CarryVersion): CarryOffer {
  if (source === null) return { offered: false, reason: 'no_source' };
  const before = new Map(source.rows.map((one) => [rowKey(one), one]));
  if (before.size !== source.rows.length || draft.rows.length !== source.rows.length) {
    return { offered: false, reason: 'other_changes' };
  }
  const changes: CarryChange[] = [];
  for (const after of draft.rows) {
    const was = before.get(rowKey(after));
    if (
      was === undefined ||
      was.lessonsPerWeek !== after.lessonsPerWeek ||
      was.roomType !== after.roomType ||
      was.doubleLessons !== after.doubleLessons ||
      was.mixedBlock !== after.mixedBlock ||
      was.shortReason !== after.shortReason ||
      was.tutorRow !== after.tutorRow
    ) {
      return { offered: false, reason: 'other_changes' };
    }
    if (!after.tutorRow && was.teacherId !== after.teacherId) {
      changes.push({
        kind: 'teacher',
        ...unitOf(after),
        before: was.teacherId,
        after: after.teacherId,
      });
    }
    if (was.roomId !== after.roomId) {
      changes.push({ kind: 'row_room', ...unitOf(after), before: was.roomId, after: after.roomId });
    }
  }
  const sourceEntries = entriesByKey(source);
  const draftEntries = entriesByKey(draft);
  if (sourceEntries === null || draftEntries === null || sourceEntries.size !== draftEntries.size) {
    return { offered: false, reason: 'other_changes' };
  }
  const draftRows = new Map(draft.rows.map((one) => [one.id, one]));
  for (const [key, after] of draftEntries) {
    const was = sourceEntries.get(key);
    if (was === undefined) return { offered: false, reason: 'other_changes' };
    if (was.roomId !== after.roomId) {
      const owner = draftRows.get(after.loadRowId);
      if (owner === undefined) return { offered: false, reason: 'other_changes' };
      changes.push({
        kind: 'entry_room',
        ...unitOf(owner),
        weekday: after.weekday,
        slotPosition: after.slotPosition,
        before: was.roomId,
        after: after.roomId,
      });
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
