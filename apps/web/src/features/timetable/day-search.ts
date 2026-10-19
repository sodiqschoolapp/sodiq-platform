/** The address of the day page (task 5.6a-1): the date and the class shown. */
export interface DaySearch {
  date?: string;
  class?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `validateSearch` of the day page: a school date and a class id, when given. */
export function daySearch(search: Record<string, unknown>): DaySearch {
  const result: DaySearch = {};
  if (typeof search.date === 'string' && DATE.test(search.date)) {
    result.date = search.date;
  }
  if (typeof search.class === 'string' && search.class !== '') {
    result.class = search.class;
  }
  return result;
}
