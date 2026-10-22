import { listSearch, type ListSearch } from '@/components/list/list-state';

/** The address of the Journals page (task 6.2): the list state, the tab and the year. */
export interface JournalsSearch extends ListSearch {
  tab?: 'class' | 'group';
  year?: string;
}

/** `validateSearch` of the Journals page: each part only when it is well formed. */
export function journalsSearch(search: Record<string, unknown>): JournalsSearch {
  const result: JournalsSearch = listSearch(search);
  if (search.tab === 'class' || search.tab === 'group') result.tab = search.tab;
  if (typeof search.year === 'string' && search.year !== '') result.year = search.year;
  return result;
}

export const JOURNAL_FILTERS = ['all', 'members', 'left', 'empty'] as const;

export type JournalFilter = (typeof JOURNAL_FILTERS)[number];

/**
 * The address of a journal (task 6.2): the quarter, the month of the figures,
 * the date to scroll to (from the teacher's timetable or home page), the
 * student search, the Filter and lesson mode.
 */
export interface JournalSearch {
  quarter?: string;
  month?: string;
  date?: string;
  q?: string;
  filter?: JournalFilter;
  mode?: 'lesson';
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/** `validateSearch` of a journal: each part only when it is well formed. */
export function journalSearch(search: Record<string, unknown>): JournalSearch {
  const result: JournalSearch = {};
  if (typeof search.quarter === 'string' && search.quarter !== '') result.quarter = search.quarter;
  if (typeof search.month === 'string' && MONTH.test(search.month)) result.month = search.month;
  if (typeof search.date === 'string' && DATE.test(search.date)) result.date = search.date;
  if (typeof search.q === 'string' && search.q !== '') result.q = search.q;
  if (
    typeof search.filter === 'string' &&
    (JOURNAL_FILTERS as readonly string[]).includes(search.filter)
  ) {
    result.filter = search.filter as JournalFilter;
  }
  if (search.mode === 'lesson') result.mode = 'lesson';
  return result;
}
