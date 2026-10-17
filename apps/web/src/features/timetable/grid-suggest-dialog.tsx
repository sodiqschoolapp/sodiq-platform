import { weekdaySchema, type GridAnswer, type RearrangeRecord } from '@sodiq/shared';
import {
  otherHalf,
  suggestPlaces,
  type PatternBlock,
  type PatternModel,
  type Suggestion,
} from '@sodiq/timetable-rules';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SECTION_TITLE } from '@/components/ui/control';
import { rangeText } from '@/features/setup/templates-api';
import { weekdayName } from '@/lib/dates';
import { roomsOf } from './grid-room-picker';
import { ruleText } from './rule-text';

/**
 * The record of the rearrange route for a suggestion (task 5.4b-2b): each
 * block at its new weekday and slot, a new one by its first row, with the
 * rooms of its lessons that differ from where they are now (a new block: from
 * the rooms `newBlockOf` gave it).
 */
export function rearrangeOf(model: PatternModel, suggestion: Suggestion): RearrangeRecord {
  return {
    changes: suggestion.changes.map(({ from, to }) => {
      const rooms = to.lessons
        .filter((lesson, index) =>
          from === null
            ? lesson.roomId !== model.roomOfNew(model.rowOf(lesson.loadRowId))
            : lesson.roomId !== from.lessons[index]?.roomId,
        )
        .flatMap((lesson) =>
          lesson.roomId === null ? [] : [{ loadRowId: lesson.loadRowId, roomId: lesson.roomId }],
        );
      const at = { weekday: weekdaySchema.parse(to.weekday), slotPosition: to.slotPosition };
      const which =
        from === null ? { loadRowId: to.lessons[0]?.loadRowId ?? '' } : { blockId: to.id };
      return rooms.length === 0 ? { ...which, ...at } : { ...which, ...at, rooms };
    }),
  };
}

/**
 * "Suggest a place" (06, Editing in the grid: "shows the best free slots, or a
 * swap of two or three lessons that makes room for it"; task 5.4b-2b): the
 * suggestions of `suggestPlaces` of the rule engine, the check the server makes
 * when one is applied. A free slot names its time, its room when it changes it
 * and the warnings it adds; a rearrangement names each lesson it moves.
 */
export function GridSuggestDialog({
  title,
  grid,
  model,
  all,
  block,
  lessonName,
  onApply,
  onClose,
}: {
  /** `null` while closed. */
  title: string | null;
  grid: GridAnswer;
  model: PatternModel;
  all: readonly PatternBlock[];
  block: PatternBlock | null;
  lessonName: (block: Pick<PatternBlock, 'lessons'>) => string;
  onApply: (suggestion: Suggestion) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const open = title !== null && block !== null;
  const found = useMemo(
    () =>
      open && block !== null
        ? // Task 5.4c-1: a locked lesson stays where it is (decision 8).
          suggestPlaces(model, all, block, { pins: grid.pins, locks: grid.locks })
        : null,
    [open, model, all, block, grid.pins, grid.locks],
  );
  const rooms = roomsOf(grid);
  const at = (one: PatternBlock) =>
    t('timetable.grid.slotAt', {
      weekday: weekdayName(language, weekdaySchema.parse(one.weekday)),
      time: rangeText(t, one.start, one.end),
    });
  const warningsOf = (suggestion: Suggestion) =>
    suggestion.warnings.length === 0
      ? t('timetable.grid.noWarnings')
      : [...new Set(suggestion.warnings.map((one) => one.rule))]
          .map((rule) => ruleText(t, rule))
          .join(' ');
  const roomName = (roomId: string | null) =>
    roomId === null
      ? t('timetable.grid.noRoom')
      : (rooms.get(roomId)?.name ?? t('timetable.grid.unknownRoom'));

  const item = (suggestion: Suggestion, index: number, kind: 'free' | 'rearrange') => {
    const [first] = suggestion.changes;
    if (first === undefined) return null;
    const lines =
      kind === 'free'
        ? [at(first.to)]
        : suggestion.changes.map(({ from, to }) =>
            from === null
              ? t('timetable.grid.placedAt', { lesson: lessonName(to), to: at(to) })
              : t('timetable.grid.movesTo', {
                  lesson: lessonName(to),
                  from: at(from),
                  to: at(to),
                }),
          );
    return (
      <li key={`${kind}${String(index)}`} data-suggestion={kind} className="grid gap-1">
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start py-2 text-left whitespace-normal"
          aria-label={t('timetable.grid.applyAt', { where: lines.join('; ') })}
          onClick={() => {
            onApply(suggestion);
          }}
        >
          <span className="grid gap-0.5">
            {lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
            {suggestion.roomChanged &&
              first.to.lessons.map((lesson) => (
                <span key={lesson.id} className="text-xs">
                  {t('timetable.grid.inRoom', { room: roomName(lesson.roomId) })}
                </span>
              ))}
            <span className={suggestion.warnings.length === 0 ? 'text-xs' : 'text-xs text-warning'}>
              {warningsOf(suggestion)}
            </span>
          </span>
        </Button>
      </li>
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {block !== null && otherHalf(all, block) !== undefined && (
          <p className="text-sm text-muted-foreground">{t('timetable.grid.freeSlotsOnly')}</p>
        )}
        {found !== null && (
          <div className="grid max-h-[60vh] gap-4 overflow-y-auto" data-suggestions="">
            {found.free.length > 0 && (
              <section className="grid gap-1">
                <h3 className={SECTION_TITLE}>{t('timetable.grid.freeSlots')}</h3>
                <ul className="grid gap-1">
                  {found.free.map((one, index) => item(one, index, 'free'))}
                </ul>
              </section>
            )}
            {found.rearrangements.length > 0 && (
              <section className="grid gap-1">
                <h3 className={SECTION_TITLE}>{t('timetable.grid.rearrangements')}</h3>
                <ul className="grid gap-1">
                  {found.rearrangements.map((one, index) => item(one, index, 'rearrange'))}
                </ul>
              </section>
            )}
            {found.locked ? (
              <p className="text-sm" data-suggest-locked="">
                {t('timetable.grid.lockedSuggest')}
              </p>
            ) : (
              found.free.length === 0 &&
              found.rearrangements.length === 0 && (
                <p className="text-sm">{t('timetable.grid.nothingFound')}</p>
              )
            )}
            {found.cutShort && <p className="text-xs">{t('timetable.grid.searchCut')}</p>}
          </div>
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
