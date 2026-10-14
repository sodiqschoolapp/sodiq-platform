import { cn } from 'cn';
import { ArrowDownwardIcon, ArrowUpwardIcon, UnfoldMoreIcon } from '@/components/icons';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CHECKBOX as CHECKBOX_BASE, CHECKBOX_TARGET, FOCUS_RING } from '@/components/ui/control';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Column, Sort } from './list-state';

const CHECKBOX = `${CHECKBOX_BASE} align-middle`;

const FOCUS = `rounded-sm ${FOCUS_RING}`;

export interface Selection {
  ticked: ReadonlySet<string>;
  /** Of the rows that match the search and filters: all ticked, some, or none. */
  all: 'all' | 'some' | 'none';
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}

interface DataTableProps<Row> {
  /** The name of the table, read by a screen reader. */
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowId: (row: Row) => string;
  /** What a person calls the row, for example the name of the student. */
  rowName: (row: Row) => string;
  sort: Sort | null;
  onSort: (key: string) => void;
  /** With it the table has a checkbox column. */
  selection?: Selection | undefined;
  /** The row whose record is open in the side panel. */
  openId?: string | undefined;
  /** With it the cells of the `opens` column open the record. */
  onOpen?: ((id: string) => void) | undefined;
  /**
   * Whether a row opens, as the server answered it (a Tutor opens the
   * students of own classes only, task 3.1c); every row when absent.
   */
  rowOpens?: ((row: Row) => boolean) | undefined;
}

function TickAll({ selection }: { selection: Selection }) {
  const { t } = useTranslation();
  const box = useRef<HTMLInputElement>(null);
  const some = selection.all === 'some';
  // "Some" exists only as a property of the element, not as an attribute.
  useEffect(() => {
    if (box.current !== null) {
      box.current.indeterminate = some;
    }
  }, [some]);
  return (
    <label className={CHECKBOX_TARGET}>
      <input
        ref={box}
        type="checkbox"
        className={CHECKBOX}
        aria-label={t('list.selectAll')}
        checked={selection.all === 'all'}
        onChange={selection.onToggleAll}
      />
    </label>
  );
}

/**
 * The table scrolls in its own box, and its header stays in view while the
 * rows scroll under it (0.8b-1, settled with the staff list of 2.2a).
 */
// The table sits in a white panel (docs/design-system.md, Lists); the header
// row stays on top with the fill of a table header.
const PANEL = 'rounded-xl bg-card';
const STICKY_BOX = `${PANEL} max-h-[calc(100vh-14rem)] overflow-y-auto`;
const STICKY_HEAD = 'sticky top-0 z-10 bg-muted';

/**
 * The one table of the platform (docs/spec/12-ux-standards.md, Look and feel:
 * one set of tables; no information shown by colour alone). It shows the rows
 * it is given: searching, filtering and sorting them is the work of the list.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowId,
  rowName,
  sort,
  onSort,
  selection,
  openId,
  onOpen,
  rowOpens,
}: DataTableProps<Row>) {
  const { t } = useTranslation();
  return (
    <Table containerClassName={STICKY_BOX}>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader className={STICKY_HEAD}>
        <TableRow>
          {selection !== undefined && (
            <TableHead scope="col" className="w-8">
              <TickAll selection={selection} />
            </TableHead>
          )}
          {columns.map((column) => {
            const sorted = sort?.key === column.key ? sort : null;
            const Arrow =
              sorted === null
                ? UnfoldMoreIcon
                : sorted.descending
                  ? ArrowDownwardIcon
                  : ArrowUpwardIcon;
            return (
              <TableHead
                key={column.key}
                scope="col"
                className={cn(column.numeric === true && 'text-right')}
                aria-sort={
                  column.sortValue === undefined
                    ? undefined
                    : sorted === null
                      ? 'none'
                      : sorted.descending
                        ? 'descending'
                        : 'ascending'
                }
              >
                {column.sortValue === undefined ? (
                  column.header
                ) : (
                  <button
                    type="button"
                    className={cn('inline-flex items-center gap-1 font-medium', FOCUS)}
                    onClick={() => {
                      onSort(column.key);
                    }}
                  >
                    {column.header}
                    <Arrow
                      aria-hidden
                      className={cn('size-3.5', sorted === null && 'text-muted-foreground')}
                    />
                  </button>
                )}
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const id = rowId(row);
          const ticked = selection?.ticked.has(id) === true;
          return (
            <TableRow
              key={id}
              data-state={ticked ? 'selected' : undefined}
              aria-current={id === openId ? 'true' : undefined}
              // The open record: the fill of what is chosen, and its text in
              // bold, so it is not marked by colour alone; never a stripe.
              className="aria-[current=true]:bg-today aria-[current=true]:font-semibold"
            >
              {selection !== undefined && (
                <TableCell className="w-8">
                  <label className={CHECKBOX_TARGET}>
                    <input
                      type="checkbox"
                      className={CHECKBOX}
                      aria-label={t('list.selectRow', { name: rowName(row) })}
                      checked={ticked}
                      onChange={() => {
                        selection.onToggle(id);
                      }}
                    />
                  </label>
                </TableCell>
              )}
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn(column.numeric === true && 'text-right tabular-nums')}
                >
                  {column.opens === true && onOpen !== undefined && (rowOpens?.(row) ?? true) ? (
                    <button
                      type="button"
                      data-open-row={id}
                      className={cn(
                        'text-left font-medium underline-offset-4 hover:underline',
                        FOCUS,
                      )}
                      onClick={() => {
                        onOpen(id);
                      }}
                    >
                      {column.cell(row)}
                    </button>
                  ) : (
                    column.cell(row)
                  )}
                </TableCell>
              ))}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

interface DataTableOutlineProps<Row> {
  caption: string;
  columns: readonly Column<Row>[];
  withSelection: boolean;
  rows?: number;
}

/**
 * The table while its rows are on the way: the headers at once, and rows of
 * the height the real ones have, so the page does not jump when they arrive
 * (docs/spec/12-ux-standards.md, Look and feel).
 */
export function DataTableOutline<Row>({
  caption,
  columns,
  withSelection,
  rows = 8,
}: DataTableOutlineProps<Row>) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{t('app.loading')}</span>
      <Table containerClassName={PANEL}>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader className="bg-muted">
          <TableRow>
            {withSelection && <TableHead scope="col" className="w-8" />}
            {columns.map((column) => (
              <TableHead
                key={column.key}
                scope="col"
                className={cn(column.numeric === true && 'text-right')}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }, (_, row) => (
            <TableRow key={row}>
              {withSelection && <TableCell className="w-8" />}
              {columns.map((column) => (
                <TableCell key={column.key}>
                  <Skeleton className="h-5 w-full max-w-40" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
