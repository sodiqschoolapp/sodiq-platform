import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { classDisplayName, type GridAnswer } from '@sodiq/shared';
import type { PatternModel } from '@sodiq/timetable-rules';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SECTION_TITLE, SUBSECTION_TITLE } from '@/components/ui/control';
import { Button } from '@/components/ui/button';
import { nameOf } from '@/features/setup/setup-api';
import { SubjectSwatch } from '@/features/setup/subject-colour';
import { cn } from '@/lib/utils';
import { unitText } from './grid-tile';

type Row = GridAnswer['rows'][number];

/** The data a "To place" entry carries while it is dragged. */
export interface PlaceData {
  readonly placeRowId: string;
}

export const isPlaceData = (
  data: Record<string | symbol, unknown>,
): data is Record<string | symbol, unknown> & PlaceData => typeof data.placeRowId === 'string';

/** An entry of the panel: one block of the load (a row, or the groups of a split placed together). */
export interface ToPlaceEntry {
  /** The first row of the block, the one the place route is sent. */
  readonly rowId: string;
  readonly rows: readonly { row: Row; placed: number }[];
  /** The classes the block occupies; it is listed under the first. */
  readonly classIds: readonly string[];
  /** A half of a mixed split: placed with its pair (5.4c). */
  readonly mixed: boolean;
}

const placedOf = (grid: GridAnswer, rowId: string): number =>
  grid.blocks.filter((block) => block.lessons.some((lesson) => lesson.loadRowId === rowId)).length;

/**
 * What still has to be placed, from the teaching load (06, Editing in the
 * grid: "A side panel lists what still has to be placed, from the teaching
 * load: for example '7 Oxford, Mathematics, 4 of 6 placed'"; task 5.4b-2a,
 * decision 2): one entry per block with a row short of its load, in the order
 * of the class list, with the number of blocks placed in full.
 */
export function toPlace(
  grid: GridAnswer,
  model: PatternModel,
): { entries: ToPlaceEntry[]; complete: number } {
  const seen = new Set<string>();
  const entries: ToPlaceEntry[] = [];
  let complete = 0;
  const rowsById = new Map(grid.rows.map((row) => [row.id, row]));
  for (const row of grid.rows) {
    const block = model.rowOf(row.id).block;
    const key = block.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const rows = block.flatMap((id) => {
      const one = rowsById.get(id);
      return one === undefined ? [] : [{ row: one, placed: placedOf(grid, id) }];
    });
    if (rows.every((one) => one.placed >= one.row.lessonsPerWeek)) {
      complete += 1;
      continue;
    }
    const classIds = [
      ...new Set(
        block.flatMap((id) => {
          const engineRow = model.rowOf(id);
          return model.unitOf(engineRow.classId ?? engineRow.groupId ?? '').classIds;
        }),
      ),
    ];
    entries.push({ rowId: row.id, rows, classIds, mixed: row.mixedBlock });
  }
  const order = new Map(grid.classes.map((one, index) => [one.id, index]));
  const rank = (entry: ToPlaceEntry) => order.get(entry.classIds[0] ?? '') ?? grid.classes.length;
  return { entries: entries.sort((a, b) => rank(a) - rank(b)), complete };
}

/** One entry: draggable onto the board it can go on, with a Place button that works by keyboard and touch. */
function Entry({
  entry,
  onBoard,
  editable,
  highlighted,
  onPlace,
  onSuggest,
}: {
  entry: ToPlaceEntry;
  onBoard: boolean;
  editable: boolean;
  highlighted: boolean;
  onPlace: () => void;
  onSuggest: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const element = useRef<HTMLLIElement>(null);
  const [dragging, setDragging] = useState(false);
  const canDrag = editable && onBoard && !entry.mixed;

  useEffect(() => {
    const own = element.current;
    if (!canDrag || own === null) return undefined;
    return draggable({
      element: own,
      getInitialData: () => ({ placeRowId: entry.rowId }),
      onDragStart: () => {
        setDragging(true);
      },
      onDrop: () => {
        setDragging(false);
      },
    });
  }, [canDrag, entry.rowId]);

  useEffect(() => {
    if (highlighted) element.current?.scrollIntoView?.({ block: 'nearest' });
  }, [highlighted]);

  return (
    <li
      ref={element}
      data-to-place={entry.rowId}
      data-highlighted={highlighted ? '' : undefined}
      className={cn(
        'grid gap-1 rounded-md bg-card p-1.5 text-xs shadow-sm',
        canDrag && 'cursor-grab',
        dragging && 'opacity-50',
        highlighted && 'outline-2 outline-offset-2 outline-ring',
      )}
    >
      {entry.rows.map(({ row, placed }) => (
        <span key={row.id} className="inline-flex items-center gap-1">
          <SubjectSwatch colour={row.subject.colour} />
          {t('timetable.grid.rowOption', {
            subject: nameOf(row.subject.names, language),
            unit: unitText(row),
            placed,
            count: row.lessonsPerWeek,
          })}
        </span>
      ))}
      {entry.mixed ? (
        <span className="text-muted-foreground">{t('timetable.grid.mixedLater')}</span>
      ) : (
        editable && (
          <div>
            <Button type="button" variant="ghost" size="sm" onClick={onPlace}>
              {t('timetable.grid.place')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onSuggest}>
              {t('timetable.grid.suggest')}
            </Button>
          </div>
        )
      )}
    </li>
  );
}

/** The "To place" panel beside the board. */
export function GridToPlace({
  grid,
  model,
  classId,
  editable,
  highlightRowId,
  onPlace,
  onSuggest,
}: {
  grid: GridAnswer;
  model: PatternModel;
  /** The class whose board is shown: its entries come first and can be dragged. */
  classId: string;
  editable: boolean;
  highlightRowId: string | null;
  onPlace: (entry: ToPlaceEntry) => void;
  /** "Suggest a place" for the entry's block (task 5.4b-2b). */
  onSuggest: (entry: ToPlaceEntry) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { entries, complete } = toPlace(grid, model);
  const classes = [
    ...grid.classes.filter((one) => one.id === classId),
    ...grid.classes.filter((one) => one.id !== classId),
  ];
  return (
    <section aria-labelledby="grid-to-place" className="grid content-start gap-2">
      <h3 id="grid-to-place" className={SECTION_TITLE}>
        {t('timetable.grid.toPlace')}
      </h3>
      {entries.length === 0 && <p className="text-sm">{t('timetable.grid.allPlaced')}</p>}
      {classes.map((one) => {
        const own = entries.filter((entry) => entry.classIds[0] === one.id);
        if (own.length === 0) return null;
        return (
          <div key={one.id} className="grid gap-1" data-to-place-class={one.id}>
            <h4 className={SUBSECTION_TITLE}>{classDisplayName(one.grade, one.name)}</h4>
            <ul className="grid gap-1">
              {own.map((entry) => (
                <Entry
                  key={entry.rowId}
                  entry={entry}
                  onBoard={entry.classIds.includes(classId)}
                  editable={editable}
                  highlighted={entry.rows.some(({ row }) => row.id === highlightRowId)}
                  onPlace={() => {
                    onPlace(entry);
                  }}
                  onSuggest={() => {
                    onSuggest(entry);
                  }}
                />
              ))}
            </ul>
          </div>
        );
      })}
      {complete > 0 && (
        <p className="text-sm text-muted-foreground">
          {t('timetable.grid.placedInFull', { count: complete })}
        </p>
      )}
    </section>
  );
}
