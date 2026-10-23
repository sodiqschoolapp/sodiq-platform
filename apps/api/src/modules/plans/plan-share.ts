/**
 * Shared plans (task 7.1c, pull request #214; `09`, What a plan contains: "It
 * is written once, and each class has its own dates. A shared plan can be
 * separated later."; `edge/lesson-plans`, How items stay attached: "A shared
 * plan is one list as long as the larger class. Attachment, 'not covered'
 * and completeness are per class. An edit applies to every class sharing
 * it."). Pure: nothing here reads the database or the clock.
 */

/** The items of one journal of a plan, by place, with its fixed part. */
export interface JournalPlaces {
  /** The rows whose start has passed (task 7.1b, decision 3). */
  readonly started: number;
  /** Item id to its place (row number; past the last row is "not covered"). */
  readonly places: ReadonlyMap<string, number>;
}

/** Where a new item goes in another journal, and the items that move for it. */
export interface NewPlace {
  readonly position: number;
  /** The items that move one row up, with their new place. */
  readonly shifts: ReadonlyMap<string, number>;
}

/**
 * Decision 8: the page's journal gets the row asked (`row`); another journal
 * gets the new item at the same distance after the item before it in the
 * page's journal when that row is free and before the next item there;
 * otherwise right after the item before it, never on a started row, and the
 * items from there move one row up to the first empty row (the absorption of
 * task 7.1b).
 */
export function placeNew(
  page: ReadonlyMap<string, number>,
  row: number,
  other: JournalPlaces,
): NewPlace {
  let before: string | null = null;
  let beforeAt = 0;
  for (const [item, place] of page) {
    if (place < row && place > beforeAt) {
      before = item;
      beforeAt = place;
    }
  }
  const beforeThere = before === null ? null : (other.places.get(before) ?? null);
  const lower = Math.max(beforeThere === null ? 1 : beforeThere + 1, other.started + 1);
  const taken = new Map<number, string>();
  for (const [item, place] of other.places) taken.set(place, item);
  // The next item after `lower` in the other journal.
  let next = Infinity;
  for (const place of other.places.values()) if (place >= lower && place < next) next = place;
  const wanted = Math.max(beforeThere === null ? row : beforeThere + (row - beforeAt), lower);
  if (wanted < next && !taken.has(wanted)) return { position: wanted, shifts: new Map() };
  const shifts = new Map<string, number>();
  for (let place = lower; taken.has(place); place += 1) {
    const item = taken.get(place);
    if (item !== undefined) shifts.set(item, place + 1);
  }
  return { position: lower, shifts };
}

/** A journal of a shared plan as the follow sees it before it lays the plan. */
export interface SharingJournal {
  readonly journalId: string;
  /** The order of the units (classes first, grade, name): the tie-break. */
  readonly order: number;
  /** Kind, grades and language of instruction, as one text. */
  readonly unit: string;
  /** The owners of its rows not started (`null` for nobody); empty when none is left. */
  readonly owners: readonly (string | null)[];
}

export interface Separation {
  readonly journalId: string;
  readonly cause: 'owner_changed' | 'unit_changed';
}

const signature = (owners: readonly (string | null)[]) =>
  [...new Set(owners.map((owner) => owner ?? '-'))].sort().join(',');

/**
 * Decisions 6 and 17: the journals of a shared plan that leave it. The unit
 * kept is the one the plan was shared under (`sharedUnit`) while a journal
 * still has it. A plan
 * stays together while every row not started of each journal has one same
 * owner and every journal one unit (kind, grades, language). The plan stays
 * with the journals of the earlier owner (`earlierOwner`, the snapshot's);
 * when none kept that owner, with the larger group, ties to the first
 * journal by unit order. A journal with no row left not started leaves only
 * for its unit.
 */
export function separations(
  journals: readonly SharingJournal[],
  earlierOwner: string | null | undefined,
  sharedUnit: string | null = null,
): Separation[] {
  if (journals.length < 2) return [];
  const sorted = [...journals].sort((a, b) => a.order - b.order);
  // The unit kept: the one the plan was shared under while a journal still
  // has it (code review, must-fix 1: the class that changed leaves); else the
  // majority, ties to the first journal (every journal changed).
  const units = new Map<string, number>();
  for (const one of sorted) units.set(one.unit, (units.get(one.unit) ?? 0) + 1);
  const keepUnit =
    sharedUnit !== null && units.has(sharedUnit)
      ? sharedUnit
      : ([...units].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '');
  const live = sorted.filter((one) => one.unit === keepUnit && one.owners.length > 0);
  const groups = new Map<string, SharingJournal[]>();
  for (const one of live) {
    const key = signature(one.owners);
    groups.set(key, [...(groups.get(key) ?? []), one]);
  }
  const ranked = [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length || (a[1][0]?.order ?? 0) - (b[1][0]?.order ?? 0),
  );
  const earlier = earlierOwner === undefined ? undefined : signature([earlierOwner]);
  const keepOwners =
    (earlier === undefined ? undefined : ranked.find(([key]) => key === earlier)?.[0]) ??
    ranked[0]?.[0] ??
    null;
  const found: Separation[] = [];
  for (const one of sorted) {
    if (one.unit !== keepUnit) {
      found.push({ journalId: one.journalId, cause: 'unit_changed' });
    } else if (
      keepOwners !== null &&
      one.owners.length > 0 &&
      signature(one.owners) !== keepOwners
    ) {
      found.push({ journalId: one.journalId, cause: 'owner_changed' });
    }
  }
  return found;
}
