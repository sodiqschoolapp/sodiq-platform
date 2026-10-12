import {
  EXPORT_COLUMNS_HEADER,
  EXPORT_FILTER_VALUE_MAX_LENGTH,
  EXPORT_FILTERS_MAX,
  EXPORT_SEARCH_MAX_LENGTH,
} from '@sodiq/shared';
import { useMutation } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import type { ExportState } from './list-page';
import type { ListSearch } from './list-state';

/** The export routes of the lists (task 2.2c-1). */
export type ExportPath =
  | '/api/people/staff/export'
  | '/api/people/vacancies/export'
  | '/api/setup/buildings/export'
  | '/api/setup/rooms/export'
  | '/api/setup/divisions/export'
  | '/api/setup/subjects/export';

interface Sent {
  ids: string[];
  columns: string[];
  search: ListSearch;
}

/**
 * The file name the server gave: the real one of `filename*` (RFC 5987), else
 * the ASCII one, else a name of the list.
 */
export function fileNameOf(disposition: string | null, fallback: string): string {
  const real = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? '')?.[1];
  if (real !== undefined) {
    try {
      return decodeURIComponent(real);
    } catch {
      // A name that does not decode falls back to the ASCII one.
    }
  }
  return /filename="([^"]+)"/i.exec(disposition ?? '')?.[1] ?? fallback;
}

/** Hands the file to the browser as a download. */
function save(file: Blob, name: string): void {
  const address = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = address;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(address);
}

/** The search and filters as the request schema takes them, cut to its bounds. */
function searchOf(search: ListSearch) {
  return {
    search: (search.q ?? '').slice(0, EXPORT_SEARCH_MAX_LENGTH),
    filters: Object.fromEntries(
      Object.entries(search.f ?? {})
        .slice(0, EXPORT_FILTERS_MAX)
        .map(([key, value]) => [key, value.slice(0, EXPORT_FILTER_VALUE_MAX_LENGTH)]),
    ),
  };
}

/**
 * The Export button of a list (task 2.2c-1): sends the ids of the rows, the
 * keys of the columns shown and the search and filters to the export route of
 * the list, and saves the Excel file the server makes. The server decides what
 * the role may see; when it leaves a column out, `state.leftOut` names it and
 * the list says so.
 *
 *     const exporter = useExport('/api/setup/rooms/export', (row) => row.id);
 *     <ListPage onExport={exporter.onExport} exportState={exporter.state} />
 */
export function useExport<Row>(path: ExportPath, rowId: (row: Row) => string) {
  const mutation = useMutation({
    mutationFn: async ({ ids, columns, search }: Sent) => {
      const result = await api.POST(path, {
        params: { header: branchHeader() },
        body: { ids, columns, ...searchOf(search) },
        parseAs: 'blob',
      });
      const file = await answerOf(Promise.resolve(result));
      const written = (result.response.headers.get(EXPORT_COLUMNS_HEADER) ?? '')
        .split(',')
        .filter((key) => key !== '');
      save(
        file,
        fileNameOf(
          result.response.headers.get('Content-Disposition'),
          `${path.split('/').at(-2) ?? 'list'}.xlsx`,
        ),
      );
      return columns.filter((key) => !written.includes(key));
    },
  });
  const state: ExportState = {
    pending: mutation.isPending,
    error: mutation.error,
    leftOut: mutation.data ?? [],
  };
  return {
    onExport: (rows: Row[], columns: string[], search: ListSearch): void => {
      mutation.mutate({ ids: rows.map(rowId), columns, search });
    },
    state,
  };
}
