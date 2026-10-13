import {
  buildingExportSchema,
  divisionExportSchema,
  EXPORT_COLUMNS_HEADER,
  EXPORT_FILTER_VALUE_MAX_LENGTH,
  EXPORT_FILTERS_MAX,
  EXPORT_SEARCH_MAX_LENGTH,
  roomExportSchema,
  staffExportSchema,
  studentExportSchema,
  subjectExportSchema,
  vacancyExportSchema,
  type ExportSelection,
} from '@sodiq/shared';
import { useMutation } from '@tanstack/react-query';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import type { ExportState } from './list-page';
import type { ListSearch } from './list-state';

interface Sent {
  ids: string[];
  columns: string[];
  search: ListSearch;
  selection: ExportSelection;
}

/** What every export route takes before its schema checks the column keys. */
type Body = Omit<Sent, 'search'> & { search: string; filters: Record<string, string> };

const header = () => ({ header: branchHeader() });

/**
 * The export route of each list (task 2.2c-1). The body is built by the list's
 * shared schema, so a column key the list does not have fails here, typed,
 * before anything is sent.
 */
const EXPORTS = {
  staff: (body: Body) =>
    api.POST('/api/people/staff/export', {
      params: header(),
      body: staffExportSchema.parse(body),
      parseAs: 'blob',
    }),
  vacancies: (body: Body) =>
    api.POST('/api/people/vacancies/export', {
      params: header(),
      body: vacancyExportSchema.parse(body),
      parseAs: 'blob',
    }),
  buildings: (body: Body) =>
    api.POST('/api/setup/buildings/export', {
      params: header(),
      body: buildingExportSchema.parse(body),
      parseAs: 'blob',
    }),
  rooms: (body: Body) =>
    api.POST('/api/setup/rooms/export', {
      params: header(),
      body: roomExportSchema.parse(body),
      parseAs: 'blob',
    }),
  divisions: (body: Body) =>
    api.POST('/api/setup/divisions/export', {
      params: header(),
      body: divisionExportSchema.parse(body),
      parseAs: 'blob',
    }),
  students: (body: Body) =>
    api.POST('/api/people/students/export', {
      params: header(),
      body: studentExportSchema.parse(body),
      parseAs: 'blob',
    }),
  subjects: (body: Body) =>
    api.POST('/api/setup/subjects/export', {
      params: header(),
      body: subjectExportSchema.parse(body),
      parseAs: 'blob',
    }),
};

export type ExportListName = keyof typeof EXPORTS;

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
 *     const exporter = useExport('rooms', (row) => row.id);
 *     <ListPage onExport={exporter.onExport} exportState={exporter.state} />
 */
export function useExport<Row>(list: ExportListName, rowId: (row: Row) => string) {
  const mutation = useMutation({
    mutationFn: async ({ ids, columns, search, selection }: Sent) => {
      const result = await EXPORTS[list]({ ids, columns, selection, ...searchOf(search) });
      // The document calls the file a binary string; with `parseAs: 'blob'` it is a Blob.
      const file: unknown = await answerOf(Promise.resolve(result));
      if (!(file instanceof Blob)) {
        throw new ApiFailure('no_answer');
      }
      const written = (result.response.headers.get(EXPORT_COLUMNS_HEADER) ?? '')
        .split(',')
        .filter((key) => key !== '');
      save(file, fileNameOf(result.response.headers.get('Content-Disposition'), `${list}.xlsx`));
      return columns.filter((key) => !written.includes(key));
    },
  });
  const state: ExportState = {
    pending: mutation.isPending,
    error: mutation.error,
    leftOut: mutation.data ?? [],
  };
  return {
    onExport: (
      rows: Row[],
      columns: string[],
      search: ListSearch,
      selection: ExportSelection,
    ): void => {
      mutation.mutate({ ids: rows.map(rowId), columns, search, selection });
    },
    state,
  };
}
