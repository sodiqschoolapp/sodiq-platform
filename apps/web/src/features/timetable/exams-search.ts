import { listSearch, type ListSearch } from '@/components/list/list-state';

/** The address of the exams page (task 5.6c-2): the date shown and the list's state. */
export interface ExamsSearch extends ListSearch {
  date?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `validateSearch` of the exams page: a school date when given, and the list's state. */
export function examsSearch(search: Record<string, unknown>): ExamsSearch {
  const result: ExamsSearch = listSearch(search);
  if (typeof search.date === 'string' && DATE.test(search.date)) {
    result.date = search.date;
  }
  return result;
}
