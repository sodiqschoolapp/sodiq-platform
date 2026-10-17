import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { classDisplayName, type GridAnswer, type RuleResultAnswer } from '@sodiq/shared';
import type { PatternBlock } from '@sodiq/timetable-rules';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WarningIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { nameOf } from '@/features/setup/setup-api';
import { SubjectSwatch } from '@/features/setup/subject-colour';
import { cn } from '@/lib/utils';
import { ruleText } from './rule-text';

type Row = GridAnswer['rows'][number];

/** The class or group of a row as a person reads it. */
export const unitText = (row: Row): string =>
  row.unit.kind === 'class'
    ? classDisplayName(row.unit.grades[0] ?? 0, row.unit.name)
    : row.unit.name;

/** The data a dragged tile carries. */
export interface TileData {
  readonly blockId: string;
}

export const isTileData = (
  data: Record<string | symbol, unknown>,
): data is Record<string | symbol, unknown> & TileData => typeof data.blockId === 'string';

/**
 * A placed block on the board (06, Editing in the grid; task 5.4a): each of
 * its lessons with its subject (the colour's 10 px square and the name,
 * `docs/design-system.md`, Subject colours), class or group, teacher and room,
 * the rules its lessons break now, and, when the draft is edited, a pointer
 * drag and the Move and Remove buttons that work by keyboard and touch
 * (review correction 3).
 */
export function GridTile({
  block,
  rowsById,
  roomsById,
  results,
  editable,
  onMove,
  onRemove,
}: {
  block: PatternBlock;
  rowsById: ReadonlyMap<string, Row>;
  roomsById: ReadonlyMap<string, string>;
  results: readonly RuleResultAnswer[];
  editable: boolean;
  onMove: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const element = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const own = element.current;
    if (!editable || own === null) return undefined;
    return draggable({
      element: own,
      getInitialData: () => ({ blockId: block.id }),
      onDragStart: () => {
        setDragging(true);
      },
      onDrop: () => {
        setDragging(false);
      },
    });
  }, [editable, block.id]);

  const ids = new Set(block.lessons.map((lesson) => lesson.id));
  const own = results.filter((result) => result.lessonIds.some((id) => ids.has(id)));
  const rules = [...new Set(own.map((result) => result.rule))];
  const blocked = own.some((result) => result.severity === 'blocked');

  return (
    <div
      ref={element}
      data-block={block.id}
      className={cn(
        'grid gap-1 rounded-md bg-card p-1.5 text-left text-xs shadow-sm',
        editable && 'cursor-grab',
        dragging && 'opacity-50',
      )}
    >
      {block.lessons.map((lesson) => {
        const row = rowsById.get(lesson.loadRowId);
        if (row === undefined) return null;
        const teacher =
          row.teacher.kind === 'vacancy'
            ? t('timetable.load.vacancyOption', { name: row.teacher.name ?? '' })
            : (row.teacher.name ?? '');
        const room =
          lesson.roomId === null
            ? t('timetable.grid.noRoom')
            : (roomsById.get(lesson.roomId) ?? t('timetable.grid.noRoom'));
        return (
          <div key={lesson.id} className="grid gap-0.5" data-lesson={lesson.id}>
            <span className="inline-flex items-center gap-1 font-semibold">
              <SubjectSwatch colour={row.subject.colour} />
              {nameOf(row.subject.names, language)}
            </span>
            <span>
              {unitText(row)} · {teacher}
            </span>
            <span className="text-muted-foreground">{room}</span>
          </div>
        );
      })}
      {rules.length > 0 && (
        <p
          className={cn(
            'inline-flex items-start gap-1',
            blocked ? 'text-destructive' : 'text-warning',
          )}
          data-tile-rules={rules.join(' ')}
        >
          <WarningIcon aria-hidden className="size-4 shrink-0" />
          <span>{rules.map((rule) => ruleText(t, rule)).join(' ')}</span>
        </p>
      )}
      {editable && (
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onMove}>
            {t('timetable.grid.move')}
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={onRemove}>
            {t('timetable.grid.remove')}
          </Button>
        </div>
      )}
    </div>
  );
}
