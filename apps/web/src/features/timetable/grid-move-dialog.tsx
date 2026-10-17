import { weekdaySchema } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { rangeText } from '@/features/setup/templates-api';
import { weekdayName } from '@/lib/dates';
import { StatusLine } from './grid-cell';
import { cellKey, type Board, type BoardCell, type CellStatus } from './use-slot-status';

/**
 * "Move" of a tile without a pointer drag (`12`: full keyboard use; review
 * correction 3: a tablet by touch): every lesson slot of the board with the
 * same free, warning or blocked mark and reason as a drag shows; a blocked
 * slot cannot be chosen.
 */
export function GridMoveDialog({
  title,
  board,
  statuses,
  onChoose,
  onClose,
}: {
  title: string | null;
  board: Board;
  statuses: ReadonlyMap<string, CellStatus>;
  onChoose: (cell: BoardCell) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const cells = board.weekdays.flatMap((weekday) =>
    board.positions
      .map((position) => board.cellAt(weekday, position))
      .filter((cell): cell is BoardCell => cell !== null),
  );
  return (
    <Dialog
      open={title !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <ul className="grid max-h-[60vh] gap-1 overflow-y-auto" data-move-list="">
          {cells.map((cell) => {
            const status = statuses.get(cellKey(cell));
            if (status === undefined || status.drop.kind === 'same') return null;
            return (
              <li key={cellKey(cell)} data-move-cell={cellKey(cell)}>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start py-2 text-left whitespace-normal"
                  disabled={status.status === 'blocked'}
                  onClick={() => {
                    onChoose(cell);
                  }}
                >
                  <span className="grid gap-0.5">
                    <span>
                      {t('timetable.grid.slotAt', {
                        weekday: weekdayName(language, weekdaySchema.parse(cell.weekday)),
                        time: rangeText(t, cell.start, cell.end),
                      })}
                    </span>
                    <StatusLine status={status} />
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('timetable.grid.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
