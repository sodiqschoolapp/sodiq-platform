import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircleIcon, CloseIcon, WarningIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { ruleText } from './rule-text';
import type { BoardCell, CellStatus } from './use-slot-status';

/** The data of a cell a tile is dropped on. */
export interface CellData {
  readonly weekday: number;
  readonly position: number;
}

export const isCellData = (
  data: Record<string | symbol, unknown>,
): data is Record<string | symbol, unknown> & CellData =>
  typeof data.weekday === 'number' && typeof data.position === 'number';

const SHOWN: Record<CellStatus['status'], string> = {
  free: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  blocked: 'bg-destructive-bg text-destructive',
};

/** Free, warning or blocked, with its icon, its word and the rule: never by colour alone (`12`). */
export function StatusLine({ status }: { status: CellStatus }): React.JSX.Element {
  const { t } = useTranslation();
  const Icon =
    status.status === 'free'
      ? CheckCircleIcon
      : status.status === 'warning'
        ? WarningIcon
        : CloseIcon;
  const reason =
    status.rule !== null
      ? ruleText(t, status.rule)
      : status.drop.kind === 'no_slot'
        ? t('timetable.grid.noSlotHere')
        : null;
  return (
    <span className="inline-flex items-start gap-1 text-xs" data-status={status.status}>
      <Icon aria-hidden className="size-4 shrink-0" />
      <span>
        <span className="font-semibold">{t(`timetable.grid.status.${status.status}`)}</span>
        {reason !== null && <span data-reason={status.rule ?? 'no_slot'}> · {reason}</span>}
      </span>
    </span>
  );
}

/**
 * A lesson slot of the board (06, Editing in the grid: "While dragging, each
 * slot shows free, warning or blocked, with the reason"; task 5.4a): a drop
 * target while the draft is edited, with the status of the block being moved.
 */
export function GridCell({
  cell,
  status,
  editable,
  children,
}: {
  cell: BoardCell;
  status: CellStatus | undefined;
  editable: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const element = useRef<HTMLTableCellElement>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const own = element.current;
    if (!editable || own === null) return undefined;
    return dropTargetForElements({
      element: own,
      getData: () => ({ weekday: cell.weekday, position: cell.position }),
      onDragEnter: () => {
        setOver(true);
      },
      onDragLeave: () => {
        setOver(false);
      },
      onDrop: () => {
        setOver(false);
      },
    });
  }, [editable, cell.weekday, cell.position]);

  return (
    <td
      ref={element}
      data-cell={`${String(cell.weekday)}:${String(cell.position)}`}
      data-status={status?.status}
      className={cn(
        'h-24 min-w-36 border border-border p-1 align-top',
        status !== undefined && SHOWN[status.status],
        over && 'ring-2 ring-ring',
      )}
    >
      <div className="grid gap-1">
        {status !== undefined && <StatusLine status={status} />}
        {children}
      </div>
    </td>
  );
}
