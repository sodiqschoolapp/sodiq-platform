import { listSearch, type ListSearch } from '@/components/list/list-state';

/** The address of the Lesson plans page (task 7.1a): the list state, the tab and the year. */
export interface PlansSearch extends ListSearch {
  tab?: 'class' | 'group';
  year?: string;
}

export function plansSearch(search: Record<string, unknown>): PlansSearch {
  const result: PlansSearch = listSearch(search);
  if (search.tab === 'class' || search.tab === 'group') result.tab = search.tab;
  if (typeof search.year === 'string' && search.year !== '') result.year = search.year;
  return result;
}

/** The address of a plan (task 7.1a): the list state of its rows and the quarter. */
export interface PlanSearch extends ListSearch {
  quarter?: string;
}

export function planSearch(search: Record<string, unknown>): PlanSearch {
  const result: PlanSearch = listSearch(search);
  if (typeof search.quarter === 'string' && search.quarter !== '') result.quarter = search.quarter;
  return result;
}
