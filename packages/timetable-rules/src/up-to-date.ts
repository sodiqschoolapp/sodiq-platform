/**
 * Bringing a draft up to date after a publish (task 5.5a-3b-2): what changed
 * on both sides, item by item, and the picks taken.
 *
 * docs/spec/edge-cases/timetable.md, Versions and drafts, "Two drafts are
 * open": "Each draft remembers the version it started from. Any publish ...
 * marks the other drafts out of date. Bringing one up to date lists what
 * changed on both sides, and the Academic Vice Principal picks."
 * docs/spec/06-timetable.md, How surprises are prevented: "the differences
 * are shown".
 *
 * Rows are matched by class or group and subject, as `carry.ts` (the key is
 * unique in a version). Decision 5: the rows of one subject whose classes
 * meet (a split's halves, a load block) and the rows whose lessons share a
 * pattern block on either side (a mixed pairing) are one item, taken whole
 * from the side picked. Decision 6: a Tutor row's teacher is never a
 * difference. Decision 4: the base (the version the draft started from) only
 * labels an item and sets its default pick.
 */
import type { CarryEntry, CarryRow } from './carry.js';

/** A load row as the comparison reads it, with the classes it draws from. */
export interface MergeRow extends CarryRow {
  /** The class of a class row; the classes of a group row. */
  readonly classIds: readonly string[];
}

/** A pattern entry with its block and the block's double pair. */
export interface MergeEntry extends CarryEntry {
  readonly blockId: string;
  readonly doublePairId: string | null;
}

/** A pin of a row at a weekday and slot position. */
export interface MergePin {
  readonly loadRowId: string;
  readonly weekday: number;
  readonly slotPosition: number;
}

/** A version as the comparison reads it. */
export interface MergeVersion {
  readonly rows: readonly MergeRow[];
  readonly entries: readonly MergeEntry[];
  readonly pins: readonly MergePin[];
}

/** One lesson of a row in the weekly pattern, compared by its place and what it sits with. */
export interface MergePlacement {
  readonly weekday: number;
  readonly slotPosition: number;
  readonly roomId: string | null;
  /** The keys of the other rows of its block, sorted. */
  readonly with: readonly string[];
  /** The slot of the other half of its double; `null` for a single lesson. */
  readonly pairedWith: { readonly weekday: number; readonly slotPosition: number } | null;
}

/** What one side holds of a row. */
export interface MergeValues {
  /** `null` for a Tutor row: its teacher follows the Tutor and is never a difference. */
  readonly teacherId: string | null;
  readonly roomId: string | null;
  readonly lessonsPerWeek: number;
  readonly roomType: string | null;
  readonly doubleLessons: boolean;
  readonly mixedBlock: boolean;
  readonly shortReason: string | null;
  readonly placements: readonly MergePlacement[];
  readonly pins: readonly { readonly weekday: number; readonly slotPosition: number }[];
}

export type MergeSide = 'draft' | 'published';

/** A row of an item: its class or group and subject, and each side's values (`null`: the side has no such row). */
export interface MergeItemRow {
  readonly key: string;
  readonly classId: string | null;
  readonly groupId: string | null;
  readonly subjectId: string;
  readonly tutorRow: boolean;
  readonly base: MergeValues | null;
  readonly draft: MergeValues | null;
  readonly published: MergeValues | null;
}

/** One difference to pick: its rows, who changed it against the base, and the default pick (decision 7). */
export interface MergeItem {
  readonly key: string;
  readonly rows: readonly MergeItemRow[];
  readonly changedBy: 'draft' | 'published' | 'both';
  readonly defaultPick: MergeSide | null;
}

/** The key of a row: its class or group and subject. */
export const mergeRowKey = (one: {
  classId: string | null;
  groupId: string | null;
  subjectId: string;
}): string => `${one.classId ?? ''}|${one.groupId ?? ''}|${one.subjectId}`;

const bySlot = (
  a: { weekday: number; slotPosition: number },
  b: { weekday: number; slotPosition: number },
): number => a.weekday - b.weekday || a.slotPosition - b.slotPosition;

/** The values of every row of a version, by row key. */
function valuesOf(version: MergeVersion): Map<string, { row: MergeRow; values: MergeValues }> {
  const keyOfRow = new Map(version.rows.map((one) => [one.id, mergeRowKey(one)]));
  const byBlock = new Map<string, MergeEntry[]>();
  for (const entry of version.entries) {
    byBlock.set(entry.blockId, [...(byBlock.get(entry.blockId) ?? []), entry]);
  }
  const values = new Map<string, { row: MergeRow; values: MergeValues }>();
  for (const row of version.rows) {
    const placements = version.entries
      .filter((entry) => entry.loadRowId === row.id)
      .map((entry): MergePlacement => {
        const half =
          entry.doublePairId === null
            ? undefined
            : version.entries.find(
                (other) =>
                  other.loadRowId === row.id &&
                  other.doublePairId === entry.doublePairId &&
                  other.blockId !== entry.blockId,
              );
        return {
          weekday: entry.weekday,
          slotPosition: entry.slotPosition,
          roomId: entry.roomId,
          with: (byBlock.get(entry.blockId) ?? [])
            .filter((other) => other.loadRowId !== row.id)
            .map((other) => keyOfRow.get(other.loadRowId) ?? other.loadRowId)
            .sort(),
          pairedWith:
            half === undefined ? null : { weekday: half.weekday, slotPosition: half.slotPosition },
        };
      })
      .sort((a, b) => bySlot(a, b) || (a.roomId ?? '').localeCompare(b.roomId ?? ''));
    const pins = version.pins
      .filter((pin) => pin.loadRowId === row.id)
      .map((pin) => ({ weekday: pin.weekday, slotPosition: pin.slotPosition }))
      .sort(bySlot);
    values.set(mergeRowKey(row), {
      row,
      values: {
        teacherId: row.tutorRow ? null : row.teacherId,
        roomId: row.roomId,
        lessonsPerWeek: row.lessonsPerWeek,
        roomType: row.roomType,
        doubleLessons: row.doubleLessons,
        mixedBlock: row.mixedBlock,
        shortReason: row.shortReason,
        placements,
        pins,
      },
    });
  }
  return values;
}

const same = (a: MergeValues | null, b: MergeValues | null): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** The row keys of a version joined by a shared subject and class, or a shared block. */
function links(version: MergeVersion): [string, string][] {
  const pairs: [string, string][] = [];
  const keyOfRow = new Map(version.rows.map((one) => [one.id, mergeRowKey(one)]));
  for (const [index, one] of version.rows.entries()) {
    for (const other of version.rows.slice(index + 1)) {
      if (
        one.subjectId === other.subjectId &&
        one.classIds.some((classId) => other.classIds.includes(classId))
      ) {
        pairs.push([mergeRowKey(one), mergeRowKey(other)]);
      }
    }
  }
  const firstOfBlock = new Map<string, string>();
  for (const entry of version.entries) {
    const key = keyOfRow.get(entry.loadRowId);
    if (key === undefined) continue;
    const first = firstOfBlock.get(entry.blockId);
    if (first === undefined) {
      firstOfBlock.set(entry.blockId, key);
    } else if (first !== key) {
      pairs.push([first, key]);
    }
  }
  return pairs;
}

/**
 * Every difference between the draft and the published side, as items to
 * pick (decisions 4, 5 and 7). An item whose draft and published values are
 * equal is not listed. Items and their rows are in key order.
 */
export function draftDifferences(
  base: MergeVersion | null,
  draft: MergeVersion,
  published: MergeVersion,
): MergeItem[] {
  const sides = {
    base:
      base === null ? new Map<string, { row: MergeRow; values: MergeValues }>() : valuesOf(base),
    draft: valuesOf(draft),
    published: valuesOf(published),
  };
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let at = key;
    for (;;) {
      const up = parent.get(at) ?? at;
      if (up === at) return at;
      at = up;
    }
  };
  const join = (a: string, b: string) => {
    const [x, y] = [find(a), find(b)].sort();
    if (x !== undefined && y !== undefined && x !== y) parent.set(y, x);
  };
  const keys = [...new Set([...sides.draft.keys(), ...sides.published.keys()])].sort();
  for (const key of keys) parent.set(key, key);
  for (const [a, b] of [...links(draft), ...links(published)]) join(a, b);

  const groups = new Map<string, string[]>();
  for (const key of keys) {
    const root = find(key);
    groups.set(root, [...(groups.get(root) ?? []), key]);
  }
  const items: MergeItem[] = [];
  for (const members of groups.values()) {
    const rows = members.map((key): MergeItemRow => {
      const any = sides.draft.get(key)?.row ?? sides.published.get(key)?.row;
      return {
        key,
        classId: any?.classId ?? null,
        groupId: any?.groupId ?? null,
        subjectId: any?.subjectId ?? '',
        tutorRow: any?.tutorRow ?? false,
        base: sides.base.get(key)?.values ?? null,
        draft: sides.draft.get(key)?.values ?? null,
        published: sides.published.get(key)?.values ?? null,
      };
    });
    if (rows.every((one) => same(one.draft, one.published))) continue;
    const draftChanged = base === null || rows.some((one) => !same(one.draft, one.base));
    const publishedChanged = base === null || rows.some((one) => !same(one.published, one.base));
    const changedBy =
      draftChanged && publishedChanged ? 'both' : draftChanged ? 'draft' : 'published';
    items.push({
      key: members.join(','),
      rows,
      changedBy,
      defaultPick: changedBy === 'both' ? null : changedBy,
    });
  }
  return items.sort((a, b) => a.key.localeCompare(b.key));
}

/** A pick of one item. */
export interface MergePick {
  readonly item: string;
  readonly side: MergeSide;
}

/** The picks checked against the items listed: every item needs one, and no pick names another (decision 7). */
export type PickedItems =
  | { readonly ok: true; readonly published: readonly MergeItem[] }
  | { readonly ok: false; readonly code: 'pick_missing' | 'pick_unknown' };

export function pickedItems(items: readonly MergeItem[], picks: readonly MergePick[]): PickedItems {
  const sideOf = new Map<string, MergeSide>();
  for (const pick of picks) {
    if (!items.some((one) => one.key === pick.item) || sideOf.has(pick.item)) {
      return { ok: false, code: 'pick_unknown' };
    }
    sideOf.set(pick.item, pick.side);
  }
  if (items.some((one) => !sideOf.has(one.key))) return { ok: false, code: 'pick_missing' };
  return { ok: true, published: items.filter((one) => sideOf.get(one.key) === 'published') };
}

/**
 * What taking items from the published side writes in the draft: rows changed
 * in place (the draft's id kept), added and removed; the draft's blocks of
 * those rows removed and the published side's added; their pins replaced.
 */
export interface TakenPlan {
  readonly updateRows: readonly { readonly draftId: string; readonly publishedId: string }[];
  readonly insertRows: readonly string[];
  readonly removeRows: readonly string[];
  readonly removeBlocks: readonly string[];
  readonly insertBlocks: readonly string[];
  /** The rows (draft ids, or published ids of rows added) whose pins are replaced, and the pins added. */
  readonly pinRows: readonly string[];
  readonly pins: readonly MergePin[];
}

export function takenPlan(
  draft: MergeVersion,
  published: MergeVersion,
  taken: readonly MergeItem[],
): TakenPlan {
  const keys = new Set(taken.flatMap((item) => item.rows.map((one) => one.key)));
  const draftRows = new Map(draft.rows.map((one) => [mergeRowKey(one), one]));
  const publishedRows = new Map(published.rows.map((one) => [mergeRowKey(one), one]));
  const updateRows: { draftId: string; publishedId: string }[] = [];
  const insertRows: string[] = [];
  const removeRows: string[] = [];
  const idOf = new Map<string, string>();
  for (const key of [...keys].sort()) {
    const inDraft = draftRows.get(key);
    const inPublished = publishedRows.get(key);
    if (inDraft !== undefined && inPublished !== undefined) {
      updateRows.push({ draftId: inDraft.id, publishedId: inPublished.id });
      idOf.set(inPublished.id, inDraft.id);
    } else if (inPublished !== undefined) {
      insertRows.push(inPublished.id);
      idOf.set(inPublished.id, inPublished.id);
    } else if (inDraft !== undefined) {
      removeRows.push(inDraft.id);
    }
  }
  const draftTaken = new Set(
    draft.rows.filter((one) => keys.has(mergeRowKey(one))).map((one) => one.id),
  );
  const publishedTaken = new Set(
    published.rows.filter((one) => keys.has(mergeRowKey(one))).map((one) => one.id),
  );
  const blocksOf = (entries: readonly MergeEntry[], rows: ReadonlySet<string>) => [
    ...new Set(entries.filter((one) => rows.has(one.loadRowId)).map((one) => one.blockId)),
  ];
  return {
    updateRows,
    insertRows,
    removeRows,
    removeBlocks: blocksOf(draft.entries, draftTaken),
    insertBlocks: blocksOf(published.entries, publishedTaken),
    pinRows: [...updateRows.map((one) => one.draftId), ...insertRows],
    pins: published.pins.flatMap((pin) => {
      const id = idOf.get(pin.loadRowId);
      return id === undefined ? [] : [{ ...pin, loadRowId: id }];
    }),
  };
}
