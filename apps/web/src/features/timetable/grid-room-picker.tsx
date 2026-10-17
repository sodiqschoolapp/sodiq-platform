import type { GridAnswer } from '@sodiq/shared';
import { roomChoices, type PatternBlock, type PatternModel } from '@sodiq/timetable-rules';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ruleText } from './rule-text';

/** The rooms of the answer by id: the name and the capacity. */
export const roomsOf = (grid: GridAnswer): Map<string, { name: string; capacity: number | null }> =>
  new Map(
    grid.rooms.map((room) => [
      room.id,
      {
        name: room.name,
        capacity: grid.facts.rooms.find((one) => one.id === room.id)?.capacity ?? null,
      },
    ]),
  );

/**
 * The rooms a lesson may be put in, free in its slot, best fit first (06,
 * Editing in the grid; task 5.4b-2a, decision 4), from `roomChoices` of the
 * rule engine, the check the server makes when the room is saved. Each with
 * its capacity and the warnings it adds; the current room is marked.
 */
export function RoomChoiceList({
  grid,
  model,
  all,
  block,
  lessonId,
  current,
  onChoose,
}: {
  grid: GridAnswer;
  model: PatternModel;
  all: readonly PatternBlock[];
  block: PatternBlock;
  lessonId: string;
  current: string | null;
  onChoose: (roomId: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const rooms = roomsOf(grid);
  const choices = roomChoices(
    model,
    all,
    block,
    lessonId,
    (roomId) => rooms.get(roomId)?.name ?? roomId,
  );
  if (choices.length === 0) {
    return <p className="text-sm">{t('timetable.grid.noFreeRoom')}</p>;
  }
  return (
    <ul className="grid max-h-[60vh] gap-1 overflow-y-auto" data-room-list="">
      {choices.map((choice) => {
        const room = rooms.get(choice.roomId);
        return (
          <li key={choice.roomId} data-room-choice={choice.roomId}>
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start py-2 text-left whitespace-normal"
              aria-current={choice.roomId === current ? 'true' : undefined}
              onClick={() => {
                onChoose(choice.roomId);
              }}
            >
              <span className="grid gap-0.5">
                <span className="font-semibold">
                  {room?.name ?? t('timetable.grid.unknownRoom')}
                </span>
                {choice.roomId === current && (
                  <span className="text-xs">{t('timetable.grid.currentRoom')}</span>
                )}
                {room?.capacity !== null && room?.capacity !== undefined && (
                  <span className="text-xs">
                    {t('timetable.grid.capacity', { count: room.capacity })}
                  </span>
                )}
                {choice.warnings.length > 0 && (
                  <span className="text-xs text-warning">
                    {[...new Set(choice.warnings.map((one) => one.rule))]
                      .map((rule) => ruleText(t, rule))
                      .join(' ')}
                  </span>
                )}
              </span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/** The room picker of a lesson on a tile: the list in a dialog. */
export function GridRoomPicker({
  title,
  grid,
  model,
  all,
  block,
  lessonId,
  onChoose,
  onClose,
}: {
  /** `null` while closed. */
  title: string | null;
  grid: GridAnswer;
  model: PatternModel;
  all: readonly PatternBlock[];
  block: PatternBlock | null;
  lessonId: string | null;
  onChoose: (roomId: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const lesson = block?.lessons.find((one) => one.id === lessonId);
  return (
    <Dialog
      open={title !== null && block !== null && lesson !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {block !== null && lesson !== undefined && (
          <RoomChoiceList
            grid={grid}
            model={model}
            all={all}
            block={block}
            lessonId={lesson.id}
            current={lesson.roomId}
            onChoose={onChoose}
          />
        )}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('timetable.grid.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
