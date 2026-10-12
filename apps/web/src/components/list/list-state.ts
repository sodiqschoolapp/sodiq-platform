import type { ReactNode } from 'react';

/** One column of a list. The texts are given translated. */
export interface Column<Row> {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  /** What the column sorts by; a column without it cannot be sorted. `null` sorts last. */
  sortValue?: (row: Row) => string | number | null;
  /** What the search box looks at in this column; a column without it is not searched. */
  searchText?: (row: Row) => string;
  /** The cell opens the record in the side panel. Such a column cannot be hidden. */
  opens?: boolean;
  /** The column cannot be hidden in the column chooser. */
  fixed?: boolean;
  /** Numbers: set to the end of the cell. */
  numeric?: boolean;
  /** `false`: not a cell of the Excel file (a photo, task 2.2c-2); the export never asks for it. */
  exported?: boolean;
}

/** A filter above a list: one value of a short set, or all. */
export interface Filter<Row> {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  matches: (row: Row, value: string) => boolean;
}

/**
 * The part of a list that lives in the address of its page
 * (docs/spec/12-ux-standards.md, Navigation: every page has its own address,
 * so links and the browser Back button work).
 */
export interface ListSearch {
  /** The typed search. */
  q?: string;
  /** The key of the sorted column; with `-` in front, from the end. */
  sort?: string;
  /** Filter key to the chosen value. */
  f?: Record<string, string>;
  /** The id of the record open in the side panel. */
  open?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== ''
    ? value
    : typeof value === 'number'
      ? String(value)
      : undefined;

/**
 * `validateSearch` of a route that shows a list: what the address says, with
 * everything that is not a list state dropped. An address typed by hand can
 * hold anything.
 */
export function listSearch(search: Record<string, unknown>): ListSearch {
  const result: ListSearch = {};
  const q = text(search.q);
  const sort = text(search.sort);
  const open = text(search.open);
  if (q !== undefined) {
    result.q = q;
  }
  if (sort !== undefined) {
    result.sort = sort;
  }
  if (open !== undefined) {
    result.open = open;
  }
  if (typeof search.f === 'object' && search.f !== null && !Array.isArray(search.f)) {
    const filters: Record<string, string> = {};
    for (const [key, value] of Object.entries(search.f)) {
      const chosen = text(value);
      if (chosen !== undefined) {
        filters[key] = chosen;
      }
    }
    if (Object.keys(filters).length > 0) {
      result.f = filters;
    }
  }
  return result;
}

/** One text per list state: two states with the same content have the same key. */
export function addressKey(search: ListSearch): string {
  return JSON.stringify([
    search.q ?? null,
    search.sort ?? null,
    search.open ?? null,
    Object.entries(search.f ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]);
}

export interface Sort {
  key: string;
  descending: boolean;
}

export function sortOf(search: ListSearch): Sort | null {
  if (search.sort === undefined) {
    return null;
  }
  return search.sort.startsWith('-')
    ? { key: search.sort.slice(1), descending: true }
    : { key: search.sort, descending: false };
}

/** A click on a column header: from the start, then from the end, then as the list came. */
export function nextSort(current: Sort | null, key: string): string | undefined {
  if (current?.key !== key) {
    return key;
  }
  return current.descending ? undefined : `-${key}`;
}

// The apostrophe of the keyboard and its look-alikes: a person types o' where
// the record has oʻ (U+02BB), or the other way round.
const APOSTROPHES = /['`´ʻʼ‘’]/g;

/** A text as the search compares it: no difference of case, of apostrophes or of composed letters. */
export function searchKey(value: string, language: string): string {
  return value.normalize('NFKC').toLocaleLowerCase(language).replace(APOSTROPHES, "'");
}

/** Null when nothing is typed; otherwise the words a row must all contain. */
export function searchWords(q: string | undefined, language: string): string[] | null {
  const words = searchKey(q ?? '', language)
    .split(/\s+/)
    .filter((word) => word !== '');
  return words.length === 0 ? null : words;
}

/**
 * The rows of a list that match its search and filters, in its order
 * (docs/spec/12-ux-standards.md, Lists). A filter or a sort column the list
 * does not have, or a filter value it does not offer, is passed over.
 *
 * Every typed word must be found in the searched columns of the row. Rows
 * that sort alike keep the order they came in.
 */
export function matchingRows<Row>(
  rows: readonly Row[],
  columns: readonly Column<Row>[],
  filters: readonly Filter<Row>[],
  search: ListSearch,
  language: string,
): Row[] {
  const chosen = filters.flatMap((filter) => {
    const value = search.f?.[filter.key];
    return value !== undefined && filter.options.some((option) => option.value === value)
      ? [{ filter, value }]
      : [];
  });
  const words = searchWords(search.q, language);
  const searched = columns.flatMap((column) =>
    column.searchText === undefined ? [] : [column.searchText],
  );

  const matching = rows.filter((row) => {
    if (!chosen.every(({ filter, value }) => filter.matches(row, value))) {
      return false;
    }
    if (words === null) {
      return true;
    }
    const haystack = searchKey(searched.map((textOf) => textOf(row)).join('\n'), language);
    return words.every((word) => haystack.includes(word));
  });

  const sort = sortOf(search);
  const sortValue = columns.find((column) => column.key === sort?.key)?.sortValue;
  if (sort === null || sortValue === undefined) {
    return matching;
  }
  const collator = new Intl.Collator(language, { numeric: true, sensitivity: 'base' });
  const direction = sort.descending ? -1 : 1;
  return matching
    .map((row, index) => ({ row, index, value: sortValue(row) }))
    .sort((a, b) => {
      // A row without a value is last in both directions.
      if (a.value === null || b.value === null) {
        return a.value === b.value ? a.index - b.index : a.value === null ? 1 : -1;
      }
      const order =
        typeof a.value === 'number' && typeof b.value === 'number'
          ? a.value - b.value
          : collator.compare(String(a.value), String(b.value));
      return order === 0 ? a.index - b.index : order * direction;
    })
    .map(({ row }) => row);
}

/** The columns a person may hide. */
export function hideable<Row>(columns: readonly Column<Row>[]): Column<Row>[] {
  return columns.filter((column) => column.fixed !== true && column.opens !== true);
}

const hiddenKey = (listId: string): string => `sodiq.list.${listId}.hidden`;

/**
 * The hidden columns of a list are kept in the browser (decided by the owner,
 * task 0.8b). A browser may refuse storage: the choice then lasts for the visit.
 */
export function readHiddenColumns(listId: string): string[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(hiddenKey(listId)) ?? '[]');
    return Array.isArray(stored)
      ? stored.filter((key): key is string => typeof key === 'string')
      : [];
  } catch {
    return [];
  }
}

export function storeHiddenColumns(listId: string, keys: readonly string[]): void {
  try {
    window.localStorage.setItem(hiddenKey(listId), JSON.stringify(keys));
  } catch {
    // Nothing to do: see above.
  }
}
