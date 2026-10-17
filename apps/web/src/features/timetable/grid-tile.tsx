import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { classDisplayName, type GridAnswer, type RuleResultAnswer } from '@sodiq/shared';
import type { PatternBlock } from '@sodiq/timetable-rules';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LockIcon, WarningIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { FOCUS_RING } from '@/components/ui/control';
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
 * (review correction 3). A lesson that a draft of another branch also plans
 * names that branch (06, Two drafts at once; task 5.4b-1).
 *
 * Task 5.4b-2a: each lesson has a Room button (the room picker) and a link to
 * its row in step 2 to change the teacher (decision 9); the tile takes the
 * focus when the conflict panel shows it.
 */
export function GridTile({
  block,
  rowsById,
  roomsById,
  results,
  branchName,
  editable,
  highlighted = false,
  versionId,
  onMove,
  onRemove,
  onRoom,
  onSuggest,
  locked = false,
  ownLock = false,
  onLock,
}: {
  block: PatternBlock;
  rowsById: ReadonlyMap<string, Row>;
  roomsById: ReadonlyMap<string, string>;
  results: readonly RuleResultAnswer[];
  branchName: (branchId: string) => string;
  editable: boolean;
  highlighted?: boolean;
  /** With `onRoom`, the Room button and the teacher link of each lesson (the class board only). */
  versionId?: string;
  onMove: () => void;
  onRemove: () => void;
  onRoom?: (lessonId: string) => void;
  /** "Suggest a place" (task 5.4b-2b), on the class board. */
  onSuggest?: () => void;
  /** A lock holds the block (task 5.4c-1): of the lesson, its class, a teacher or its day. */
  locked?: boolean;
  /** The lesson itself is locked: its button unlocks it. */
  ownLock?: boolean;
  /** Lock or unlock the lesson (task 5.4c-1), on the class board. */
  onLock?: () => void;
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
  const draftBranches = [
    ...new Set(
      own.flatMap((result) => {
        const branchId = result.detail?.branchId;
        return result.rule === 'other_draft' && typeof branchId === 'string' ? [branchId] : [];
      }),
    ),
  ];

  return (
    <div
      ref={element}
      data-block={block.id}
      data-highlighted={highlighted ? '' : undefined}
      tabIndex={-1}
      className={cn(
        'grid gap-1 rounded-md bg-card p-1.5 text-left text-xs shadow-sm',
        FOCUS_RING,
        editable && 'cursor-grab',
        dragging && 'opacity-50',
        highlighted && 'outline-2 outline-offset-2 outline-ring',
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
            {editable && versionId !== undefined && onRoom !== undefined && (
              <span className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('timetable.grid.roomOf', {
                    subject: nameOf(row.subject.names, language),
                    unit: unitText(row),
                  })}
                  onClick={() => {
                    onRoom(lesson.id);
                  }}
                >
                  {t('timetable.grid.changeRoom')}
                </Button>
                <Link
                  to="/timetable/load"
                  search={{ version: versionId, open: row.id }}
                  className="text-link"
                >
                  {t('timetable.grid.changeTeacher')}
                </Link>
              </span>
            )}
          </div>
        );
      })}
      {locked && (
        <p className="inline-flex items-center gap-1 text-muted-foreground" data-tile-locked="">
          <LockIcon className="size-4 shrink-0" />
          <span>{t('timetable.grid.lockedTile')}</span>
        </p>
      )}
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
      {draftBranches.length > 0 && (
        <p className="text-warning" data-other-draft={draftBranches.join(' ')}>
          {t('timetable.grid.otherDraftIn', {
            branches: draftBranches.map(branchName).join(', '),
          })}
        </p>
      )}
      {editable && (
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onMove}>
            {t('timetable.grid.move')}
          </Button>
          {onSuggest !== undefined && (
            <Button type="button" variant="ghost" size="sm" onClick={onSuggest}>
              {t('timetable.grid.suggest')}
            </Button>
          )}
          {onLock !== undefined && (
            <Button type="button" variant="ghost" size="sm" onClick={onLock}>
              {ownLock ? t('timetable.grid.unlock') : t('timetable.grid.lock')}
            </Button>
          )}
          <Button type="button" variant="destructive" size="sm" onClick={onRemove}>
            {t('timetable.grid.remove')}
          </Button>
        </div>
      )}
    </div>
  );
}
