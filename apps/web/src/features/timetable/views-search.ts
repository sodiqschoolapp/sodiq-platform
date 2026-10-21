import { VIEW_KINDS, type ViewKind, type ViewSpan } from '@sodiq/shared';

/** The address of the timetable views (task 5.9a): which view, of what, on which date. */
export interface ViewsSearch {
  kind?: ViewKind;
  id?: string;
  date?: string;
  span?: ViewSpan;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isKind = (value: unknown): value is ViewKind =>
  typeof value === 'string' && (VIEW_KINDS as readonly string[]).includes(value);

/** `validateSearch` of the views page: each part only when it is well formed. */
export function viewsSearch(search: Record<string, unknown>): ViewsSearch {
  const result: ViewsSearch = {};
  if (isKind(search.kind)) result.kind = search.kind;
  if (typeof search.id === 'string' && search.id !== '') result.id = search.id;
  if (typeof search.date === 'string' && DATE.test(search.date)) result.date = search.date;
  if (search.span === 'day' || search.span === 'week') result.span = search.span;
  return result;
}
