import { cn } from 'cn';
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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

const CHECKBOX = 'size-4 align-middle accent-primary';

const FOCUS =
  'rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring';

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
    <input
      ref={box}
      type="checkbox"
      className={CHECKBOX}
      aria-label={t('list.selectAll')}
      checked={selection.all === 'all'}
      onChange={selection.onToggleAll}
    />
  );
}

/**
 * The table scrolls in its own box, and its header stays in view while the
 * rows scroll under it (0.8b-1, settled with the staff list of 2.2a).
 */
const STICKY_BOX = 'max-h-[calc(100vh-14rem)] overflow-y-auto';
const STICKY_HEAD = 'sticky top-0 z-10 bg-background';

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
                ? ChevronsUpDownIcon
                : sorted.descending
                  ? ArrowDownIcon
                  : ArrowUpIcon;
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
              // The open record is marked by a bar at the start of its row, not by colour alone.
              className="aria-[current=true]:bg-muted aria-[current=true]:shadow-[inset_4px_0_0_var(--foreground)]"
            >
              {selection !== undefined && (
                <TableCell className="w-8">
                  <input
                    type="checkbox"
                    className={CHECKBOX}
                    aria-label={t('list.selectRow', { name: rowName(row) })}
                    checked={ticked}
                    onChange={() => {
                      selection.onToggle(id);
                    }}
                  />
                </TableCell>
              )}
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn(column.numeric === true && 'text-right tabular-nums')}
                >
                  {column.opens === true && onOpen !== undefined ? (
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
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
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
