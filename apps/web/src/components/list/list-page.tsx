import { cn } from 'cn';
import { ViewColumnIcon, DownloadIcon, SearchIcon } from '@/components/icons';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm, type Confirmation } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { useLeave } from '@/components/unsent/unsent-changes';
import { SidePanel } from '@/components/side-panel';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DataTable, DataTableOutline } from './data-table';
import {
  addressKey,
  hideable,
  listSearch,
  matchingRows,
  nextSort,
  readHiddenColumns,
  sortOf,
  storeHiddenColumns,
  type Column,
  type Filter,
  type ListSearch,
} from './list-state';

/** How many rows are drawn at first, and how many "Show more" adds. */
export const ROWS_AT_ONCE = 100;

/** How long after the last key the typed search is written into the address. */
const SEARCH_TO_ADDRESS_MS = 300;

export interface BulkAction<Row> {
  key: string;
  label: string;
  /** Given every ticked row, also those the search and filters do not show now. */
  run: (rows: Row[]) => void;
  /**
   * With it the action asks first (docs/spec/12-ux-standards.md, No lost
   * work: actions that cannot be undone ask for confirmation and name what
   * will be affected). The list adds the names of the ticked rows.
   */
  confirm?: (rows: Row[]) => Pick<Confirmation, 'title' | 'text' | 'action' | 'destructive'>;
}

/** Where an export started by the list stands: on the way, refused, or done with columns left out. */
export interface ExportState {
  pending: boolean;
  /** Why the last export failed; shown above the rows. */
  error: unknown;
  /** The keys of the columns sent that the server did not write (decision 4 of pull request #58). */
  leftOut: readonly string[];
}

interface ListPageProps<Row> {
  /** Names the list in the browser's storage (the hidden columns). */
  listId: string;
  /** The name of the list, read by a screen reader. */
  caption: string;
  /** Every row of the list; `undefined` while they are on the way. */
  rows: readonly Row[] | undefined;
  /**
   * Why the rows could not be loaded. Without rows the list shows the failure
   * in place of the table; with rows (a later load failed) it shows it above
   * the rows it has.
   */
  error?: unknown;
  onRetry?: (() => void) | undefined;
  rowId: (row: Row) => string;
  /** What a person calls the row, for example the name of the student. */
  rowName: (row: Row) => string;
  /** Keep the same array between renders (`useMemo`): the rows are matched again when it changes. */
  columns: readonly Column<Row>[];
  /** As `columns`: the same array between renders. */
  filters?: readonly Filter<Row>[];
  /** The list state of the address (`validateSearch: listSearch` on the route). */
  search: ListSearch;
  /** Writes the list state into the address: a new entry of the history, or in place. */
  onSearchChange: (next: ListSearch, how: 'push' | 'replace') => void;
  /** Shown when the list has no row at all: what the page is for and the first action. */
  empty: { text: string; action?: ReactNode };
  /** With them the rows have checkboxes. */
  bulkActions?: readonly BulkAction<Row>[];
  /**
   * With it the list has an Export button. It is given the ticked rows when
   * some are ticked (`04`: "Bulk actions on ticked rows: ... export"), else
   * the rows that match the search and filters, in the order shown; the keys
   * of the columns shown; and the search and filters, which the audit entry
   * records. The file itself is made by the server, which decides what the
   * role may see.
   */
  onExport?:
    | ((
        rows: Row[],
        columnKeys: string[],
        search: ListSearch,
        selection: 'ticked' | 'matching',
      ) => void)
    | undefined;
  /** The state of the export of `onExport` (`useExport`). */
  exportState?: ExportState | undefined;
  /** The record of a row, shown in the side panel. Needs a column with `opens`. */
  panel?: ((row: Row) => ReactNode) | undefined;
}

const NO_FILTERS: readonly never[] = [];
const NO_ACTIONS: readonly never[] = [];

/**
 * The one way every list works (docs/spec/12-ux-standards.md, Lists): search,
 * filters, column chooser, sorting, checkboxes with bulk actions, export, and
 * a side panel that opens a record without leaving the list.
 *
 * The whole list of a branch is loaded, and searching, sorting and filtering
 * happen in the browser (decided by the owner, task 0.8b: such lists are small
 * and the search must answer while typing). A list too long for that (the
 * audit log, 2.6) keeps the same `ListSearch` in its address and asks the
 * server instead.
 */
export function ListPage<Row>({
  listId,
  caption,
  rows,
  error,
  onRetry,
  rowId,
  rowName,
  columns,
  filters = NO_FILTERS,
  search,
  onSearchChange,
  empty,
  bulkActions = NO_ACTIONS,
  onExport,
  exportState,
  panel,
}: ListPageProps<Row>) {
  const { t, i18n } = useTranslation();
  const searchId = useId();
  const root = useRef<HTMLDivElement>(null);
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  // The list shows its own state at once and writes it into the address, which
  // follows a moment later. `sent` holds what was written and has not arrived
  // yet: an address that arrives and is not among them was changed by somebody
  // else (the Back button, a link), and the list follows it.
  const [state, setState] = useState(search);
  const [typed, setTyped] = useState(search.q ?? '');
  const [sent, setSent] = useState<readonly string[]>([]);
  const [seen, setSeen] = useState(() => addressKey(search));
  const arrived = addressKey(search);
  if (arrived !== seen) {
    setSeen(arrived);
    const own = sent.indexOf(arrived);
    if (own === -1) {
      setState(search);
      setTyped(search.q ?? '');
      setSent([]);
    } else {
      setSent(sent.slice(own + 1));
    }
  }

  // The newest function of the feature, without asking it for a stable one.
  const writeAddress = useRef(onSearchChange);
  useEffect(() => {
    writeAddress.current = onSearchChange;
  }, [onSearchChange]);

  const write = (next: ListSearch, how: 'push' | 'replace'): void => {
    setState(next);
    setSent((before) => [...before, addressKey(next)]);
    writeAddress.current(next, how);
  };

  /** A change of the list other than typing; what is typed goes into the address with it. */
  const change = (patch: Record<string, unknown>, how: 'push' | 'replace'): void => {
    write(listSearch({ ...state, q: typed, ...patch }), how);
  };

  // The search box answers at once; the address follows when the typing stops,
  // in place: the Back button does not walk through every letter.
  useEffect(() => {
    if (typed === (state.q ?? '')) {
      return;
    }
    const timer = window.setTimeout(() => {
      const next = listSearch({ ...state, q: typed });
      setState(next);
      setSent((before) => [...before, addressKey(next)]);
      writeAddress.current(next, 'replace');
    }, SEARCH_TO_ADDRESS_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [typed, state]);

  const current = useMemo(() => listSearch({ ...state, q: typed }), [state, typed]);

  const [hidden, setHidden] = useState(() => readHiddenColumns(listId));
  const canHide = hideable(columns);
  const shownColumns = columns.filter(
    (column) => !hidden.includes(column.key) || !canHide.includes(column),
  );

  const matching = useMemo(
    () => matchingRows(rows ?? [], columns, filters, current, i18n.language),
    [rows, columns, filters, current, i18n.language],
  );

  // Only so many rows are drawn at once: a list of thousands stays quick to
  // search. A new search, filter or order starts from the top again.
  const windowKey = JSON.stringify([current.q, current.f, current.sort]);
  const [drawn, setDrawn] = useState({ key: windowKey, count: ROWS_AT_ONCE });
  if (drawn.key !== windowKey) {
    setDrawn({ key: windowKey, count: ROWS_AT_ONCE });
  }
  const count = drawn.key === windowKey ? drawn.count : ROWS_AT_ONCE;

  // A ticked row that left the list (archived, moved) is no longer ticked.
  const [tickedIds, setTickedIds] = useState<ReadonlySet<string>>(new Set());
  const tickedRows = (rows ?? []).filter((row) => tickedIds.has(rowId(row)));
  const ticked = new Set(tickedRows.map(rowId));
  const matchingIds = matching.map(rowId);
  const tickedMatching = matchingIds.filter((id) => ticked.has(id)).length;
  const notShown = ticked.size - tickedMatching;
  // Ticked rows in the order shown, then those the search and filters hide now.
  const shownIds = new Set(matchingIds);
  const exportRows =
    ticked.size === 0
      ? matching
      : [
          ...matching.filter((row) => ticked.has(rowId(row))),
          ...tickedRows.filter((row) => !shownIds.has(rowId(row))),
        ];

  const selection =
    bulkActions.length === 0
      ? undefined
      : {
          ticked,
          all:
            tickedMatching === 0
              ? ('none' as const)
              : tickedMatching === matchingIds.length
                ? ('all' as const)
                : ('some' as const),
          onToggle: (id: string): void => {
            const next = new Set(ticked);
            if (!next.delete(id)) {
              next.add(id);
            }
            setTickedIds(next);
          },
          // "Tick all" means every row that matches the search and filters,
          // also those not drawn yet (decided by the owner, task 0.8b).
          onToggleAll: (): void => {
            const next = new Set(ticked);
            const all = tickedMatching === matchingIds.length;
            for (const id of matchingIds) {
              if (all) {
                next.delete(id);
              } else {
                next.add(id);
              }
            }
            setTickedIds(next);
          },
        };

  const confirm = useConfirm();
  const { unsent, leave } = useLeave();

  /**
   * Another record in the panel, or none. The record that is open may hold a
   * form with typed changes: the person is asked first, and the panel stays
   * as it is when they stay.
   */
  const openRecord = (id: string | undefined): void => {
    if (id === state.open) {
      return;
    }
    if (!unsent()) {
      change({ open: id }, 'push');
      return;
    }
    void leave().then((leaves) => {
      if (leaves) {
        change({ open: id }, 'push');
      }
    });
  };

  const openId = panel === undefined ? undefined : state.open;
  const openRow = openId === undefined ? undefined : rows?.find((row) => rowId(row) === openId);
  // The row last shown in the panel. When it leaves the list while it is open
  // (archived by somebody else, a reload of the rows), the panel keeps it with
  // a note, so a form in it keeps what was typed (0.8b-1, settled in 2.2a).
  const [shownRow, setShownRow] = useState<{ id: string; row: Row } | null>(null);
  if (openRow !== undefined && openId !== undefined && shownRow?.row !== openRow) {
    setShownRow({ id: openId, row: openRow });
  }
  const goneRow =
    openRow === undefined && shownRow !== null && shownRow.id === openId ? shownRow.row : undefined;
  const panelRow = openRow ?? goneRow;

  // A button that goes away with its click hands the focus on, so the keyboard
  // does not start again from the top of the page.
  const focusOn = (selector: string): void => {
    root.current?.querySelector<HTMLElement>(selector)?.focus();
  };
  const searchBox = `#${CSS.escape(searchId)}`;

  // When the panel closes, the focus goes back to the row it was opened from,
  // or to the search box when that row is not drawn.
  const lastOpen = useRef<string | undefined>(undefined);
  useEffect(() => {
    const before = lastOpen.current;
    lastOpen.current = openId;
    if (openId === undefined && before !== undefined) {
      const row = root.current?.querySelector<HTMLElement>(
        `[data-open-row="${CSS.escape(before)}"]`,
      );
      (row ?? root.current?.querySelector<HTMLElement>(searchBox))?.focus();
    }
  }, [openId, searchBox]);

  const filtered = current.q !== undefined || current.f !== undefined;
  const failed = error !== undefined && error !== null;

  return (
    <div ref={root} className="flex items-start gap-4">
      {/* On a narrow screen the open record takes the place of the list. */}
      <div className={cn('min-w-0 flex-1 gap-3', openId === undefined ? 'grid' : 'hidden lg:grid')}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative">
            <label htmlFor={searchId} className="sr-only">
              {t('list.search')}
            </label>
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={searchId}
              type="search"
              className="w-64 pl-10 max-sm:w-full"
              placeholder={t('list.search')}
              autoComplete="off"
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
              }}
            />
          </div>
          {filters.map((filter) => (
            <label key={filter.key} className="grid gap-0.5 text-xs text-muted-foreground">
              {filter.label}
              <Select
                className="w-auto min-w-40"
                value={current.f?.[filter.key] ?? ''}
                onChange={(event) => {
                  const others = Object.fromEntries(
                    Object.entries(current.f ?? {}).filter(([key]) => key !== filter.key),
                  );
                  change(
                    {
                      f:
                        event.target.value === ''
                          ? others
                          : { ...others, [filter.key]: event.target.value },
                    },
                    'push',
                  );
                }}
              >
                <option value="">{t('list.all')}</option>
                {filter.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>
          ))}
          {/* A quiet "Reset" in the toolbar (docs/design-system.md, Lists). */}
          {filtered && (
            <Button
              variant="ghost"
              onClick={() => {
                setTyped('');
                write(listSearch({ ...state, q: undefined, f: undefined }), 'push');
                focusOn(searchBox);
              }}
            >
              {t('list.clearSearch')}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {canHide.length > 0 && (
              <DropdownMenu>
                {/* The column chooser is an icon button (docs/design-system.md, Lists). */}
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon" aria-label={t('list.columns')} />}
                >
                  <ViewColumnIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {canHide.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.key}
                      checked={!hidden.includes(column.key)}
                      onCheckedChange={(shown) => {
                        const next = shown
                          ? hidden.filter((key) => key !== column.key)
                          : [...hidden, column.key];
                        setHidden(next);
                        storeHiddenColumns(listId, next);
                      }}
                    >
                      {column.header}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {onExport !== undefined && (
              <Button
                variant="secondary"
                disabled={exportRows.length === 0 || exportState?.pending === true}
                onClick={() => {
                  onExport(
                    exportRows,
                    shownColumns
                      .filter((column) => column.exported !== false)
                      .map((column) => column.key),
                    current,
                    ticked.size === 0 ? 'matching' : 'ticked',
                  );
                }}
              >
                <DownloadIcon aria-hidden />
                {exportState?.pending === true
                  ? t('list.exporting')
                  : ticked.size > 0
                    ? t('list.exportTicked', { count: ticked.size, n: number.format(ticked.size) })
                    : t('list.export')}
              </Button>
            )}
          </div>
        </div>

        {onExport !== undefined &&
          exportState !== undefined &&
          exportState.error !== null &&
          exportState.error !== undefined && <FailureAlert error={exportState.error} />}
        {onExport !== undefined && exportState !== undefined && exportState.leftOut.length > 0 && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('list.exportColumnsLeftOut', {
              columns: exportState.leftOut
                .map((key) => columns.find((column) => column.key === key)?.header ?? key)
                .join(', '),
            })}
          </p>
        )}

        {/* Always there, also with nothing ticked: the table does not move
            under the pointer at the first tick. */}
        {selection !== undefined && rows !== undefined && rows.length > 0 && (
          <div
            role="group"
            aria-label={t('list.bulkActions')}
            className="flex flex-wrap items-center gap-2 rounded-lg bg-today px-3 py-2 text-sm"
          >
            <p role="status" className={cn(ticked.size > 0 && 'font-medium')}>
              {t('list.selected', { count: ticked.size, n: number.format(ticked.size) })}
              {notShown > 0 && (
                <> {t('list.selectedNotShown', { count: notShown, n: number.format(notShown) })}</>
              )}
            </p>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {bulkActions.map((action) => (
                <Button
                  key={action.key}
                  variant="secondary"
                  size="sm"
                  disabled={ticked.size === 0}
                  onClick={() => {
                    if (action.confirm === undefined) {
                      action.run(tickedRows);
                      return;
                    }
                    void confirm({
                      ...action.confirm(tickedRows),
                      names: tickedRows.map(rowName),
                    }).then((went) => {
                      if (went) {
                        action.run(tickedRows);
                      }
                    });
                  }}
                >
                  {action.label}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                disabled={ticked.size === 0}
                onClick={() => {
                  setTickedIds(new Set());
                  focusOn('thead input[type="checkbox"]');
                }}
              >
                {t('list.clearSelection')}
              </Button>
            </div>
          </div>
        )}

        {failed && rows === undefined ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : rows === undefined ? (
          <DataTableOutline
            caption={caption}
            columns={shownColumns}
            withSelection={selection !== undefined}
          />
        ) : rows.length === 0 ? (
          <>
            {failed && <FailureAlert error={error} />}
            <EmptyState text={empty.text} action={empty.action} />
          </>
        ) : (
          <>
            {failed && <FailureAlert error={error} />}
            <DataTable
              caption={caption}
              columns={shownColumns}
              rows={matching.slice(0, count)}
              rowId={rowId}
              rowName={rowName}
              sort={sortOf(current)}
              onSort={(key) => {
                change({ sort: nextSort(sortOf(current), key) }, 'push');
              }}
              selection={selection}
              openId={openId}
              onOpen={panel === undefined ? undefined : openRecord}
            />
            {/* Read out as the search narrows the list. */}
            <div aria-live="polite" className="grid justify-items-start gap-2">
              {matching.length === 0 && <p>{t('list.noMatch')}</p>}
              <p className="text-sm text-muted-foreground">
                {t('list.count', {
                  shown: number.format(Math.min(count, matching.length)),
                  matching: number.format(matching.length),
                  total: number.format(rows.length),
                })}
              </p>
            </div>
            {matching.length > count && (
              <div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDrawn({ key: windowKey, count: count + ROWS_AT_ONCE });
                  }}
                >
                  {t('list.showMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {panel !== undefined && openId !== undefined && !(failed && rows === undefined) && (
        <SidePanel
          title={
            rows === undefined
              ? t('app.loading')
              : openRow === undefined
                ? goneRow === undefined
                  ? t('list.recordGoneTitle')
                  : rowName(goneRow)
                : rowName(openRow)
          }
          recordKey={openId}
          onClose={() => {
            openRecord(undefined);
          }}
        >
          {rows === undefined ? (
            // The panel has its place before the rows arrive: the list does not
            // change its width when they do.
            failed ? null : (
              <LoadingOutline />
            )
          ) : panelRow === undefined ? (
            <p>{t('list.recordGone')}</p>
          ) : (
            // One wrapper whether the row is in the list or has left it, so the
            // panel is not drawn anew and keeps what was typed.
            <div className="grid gap-4">
              {openRow === undefined && (
                <p role="status" className="text-sm text-muted-foreground">
                  {t('list.recordLeft')}
                </p>
              )}
              {panel(panelRow)}
            </div>
          )}
        </SidePanel>
      )}
    </div>
  );
}
