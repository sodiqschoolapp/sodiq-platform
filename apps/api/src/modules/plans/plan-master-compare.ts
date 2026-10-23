import type { PlanMasterChange, PlanMasterContent } from '@sodiq/shared';

/**
 * The "master updated" comparison and the take (task 7.3, pull request #216,
 * decisions 5 and 6; `09`, Master plans: "Teachers who copied it see 'master
 * updated' with a side-by-side comparison. Taking the changes is free inside
 * the window and needs an edit request after it."; `edge/lesson-plans`: "Items
 * are matched by identity, not by position. Taking the changes touches only
 * rows of lessons not yet held."). Pure: the service reads the rows.
 */

/** A master item with the revisions that added, changed and removed it. */
export interface MasterItemFacts {
  readonly id: string;
  /** The order in the master; a removed item keeps its last one. */
  readonly position: number;
  readonly added: number;
  readonly changed: number;
  readonly removed: number | null;
  readonly content: PlanMasterContent;
}

/** An item of the plan copied from a master item, not cleared. */
export interface PlanItemFacts {
  readonly itemId: string;
  readonly masterItemId: string;
  readonly content: PlanMasterContent;
  /** Its row has started in some journal of the plan: not taken. */
  readonly held: boolean;
}

export interface CompareRow {
  readonly change: PlanMasterChange;
  readonly masterItemId: string;
  readonly master: PlanMasterContent | null;
  readonly plan: (PlanMasterContent & { readonly itemId: string }) | null;
  readonly held: boolean;
}

const sameWorks = (
  a: readonly { title: string; description: string }[],
  b: readonly { title: string; description: string }[],
) =>
  a.length === b.length &&
  a.every(
    (one, index) => one.title === b[index]?.title && one.description === b[index]?.description,
  );

/** The content a teacher sees: topic, objectives, links and the works in order. */
export function sameContent(a: PlanMasterContent, b: PlanMasterContent): boolean {
  return (
    a.topic === b.topic &&
    a.objectives === b.objectives &&
    a.links.length === b.links.length &&
    a.links.every((link, index) => link === b.links[index]) &&
    sameWorks(a.classworks, b.classworks) &&
    sameWorks(a.homeworks, b.homeworks)
  );
}

/**
 * The rows of the comparison, in the master's order: an item changed since
 * `since` whose content differs from the plan's (an edit saved back shows
 * nothing, spec review of the plan, must-fix 4), an item added since with no
 * item in the plan, and an item removed since that the plan still holds. An
 * order change alone shows nothing (decision 5).
 */
export function compareMaster(
  masterItems: readonly MasterItemFacts[],
  since: number,
  planItems: readonly PlanItemFacts[],
): CompareRow[] {
  const byMaster = new Map(planItems.map((item) => [item.masterItemId, item]));
  const rows: CompareRow[] = [];
  const ordered = [...masterItems].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  );
  for (const item of ordered) {
    const own = byMaster.get(item.id);
    const plan = own === undefined ? null : { ...own.content, itemId: own.itemId };
    if (item.removed !== null) {
      if (item.removed > since && own !== undefined) {
        rows.push({ change: 'removed', masterItemId: item.id, master: null, plan, held: own.held });
      }
      continue;
    }
    if (own === undefined) {
      if (item.added > since) {
        rows.push({
          change: 'added',
          masterItemId: item.id,
          master: item.content,
          plan: null,
          held: false,
        });
      }
      continue;
    }
    if (item.changed > since && !sameContent(item.content, own.content)) {
      rows.push({
        change: 'changed',
        masterItemId: item.id,
        master: item.content,
        plan,
        held: own.held,
      });
    }
  }
  return rows;
}

/** The plan can take something: a row whose plan item is not held. */
export const masterUpdated = (rows: readonly CompareRow[]): boolean =>
  rows.some((row) => !row.held);

/** One journal of the plan: its first `started` rows are fixed; the places of the items. */
export interface TakeJournal {
  readonly started: number;
  readonly places: ReadonlyMap<string, number>;
}

/**
 * The places of one journal after a take (decision 6; spec review of the
 * plan, should-fix 8): the removed items leave the queue and the queue closes
 * up (as the queue edit); each added item, in the master's order, goes right
 * after the place of the plan item of the nearest earlier master item when
 * that place is not started, else to the first row not started, and the
 * items from there move one row up to the first empty row (as a new item of a
 * shared plan, `placeNew`). Started rows never move.
 */
export function takePlaces(
  journal: TakeJournal,
  removed: readonly string[],
  added: readonly { readonly itemId: string; readonly after: string | null }[],
): Map<string, number> {
  const queue: (string | null)[] = [];
  for (const [itemId, position] of journal.places) {
    if (position > journal.started) queue[position - journal.started - 1] = itemId;
  }
  const kept = Array.from(queue, (one) => one ?? null).filter(
    (one) => one === null || !removed.includes(one),
  );
  for (const { itemId, after } of added) {
    const before = after === null ? -1 : kept.indexOf(after);
    const at = before + 1;
    const free = kept.indexOf(null, at);
    if (free === -1) {
      kept.splice(at, 0, itemId);
    } else {
      kept.splice(free, 1);
      kept.splice(at, 0, itemId);
    }
  }
  const places = new Map<string, number>();
  for (const [itemId, position] of journal.places) {
    if (position <= journal.started && !removed.includes(itemId)) places.set(itemId, position);
  }
  kept.forEach((itemId, index) => {
    if (itemId !== null) places.set(itemId, journal.started + index + 1);
  });
  return places;
}
