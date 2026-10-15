import { listSearch, type ListSearch } from '@/components/list/list-state';

/** The address of the load page: the list's state and the version shown. */
export interface LoadSearch extends ListSearch {
  version?: string;
}

/** `validateSearch` of the load page: `listSearch` with the version. */
export function loadSearch(search: Record<string, unknown>): LoadSearch {
  const result: LoadSearch = listSearch(search);
  if (typeof search.version === 'string' && search.version !== '') {
    result.version = search.version;
  }
  return result;
}
