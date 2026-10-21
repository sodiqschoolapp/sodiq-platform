import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { classDisplayName, type GridAnswer } from '@sodiq/shared';
import { mixedPartners, type PatternModel } from '@sodiq/timetable-rules';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CHECKBOX,
  CHECKBOX_TARGET,
  SECTION_TITLE,
  SUBSECTION_TITLE,
} from '@/components/ui/control';
import { SelectField } from '@/components/field';
import { Button } from '@/components/ui/button';
import { nameOf } from '@/features/setup/setup-api';
import { SubjectSwatch } from '@/features/setup/subject-colour';
import { cn } from '@/lib/utils';
import { GridLeft, leftLines } from './grid-left';
import { unitText } from './grid-tile';

type Row = GridAnswer['rows'][number];

/** The data a "To place" entry carries while it is dragged. */
export interface PlaceData {
  readonly placeRowId: string;
  /** Task 5.4c-3a: placed as a double lesson. */
  readonly placeDouble?: boolean;
  /** Task 5.4c-3b: the partner of a mixed half, placed with it in one block. */
  readonly placePartnerRowId?: string;
}

export const isPlaceData = (
  data: Record<string | symbol, unknown>,
): data is Record<string | symbol, unknown> & PlaceData => typeof data.placeRowId === 'string';

/**
 * An entry of the panel: one block of the load (a row, or the groups of a
 * split placed together); task 5.4c-3b (decision 9): a half of a mixed split
 * has an entry of its own, placed with a partner or as its whole split.
 */
export interface ToPlaceEntry {
  /** The first row of the block, the one the place route is sent. */
  readonly rowId: string;
  readonly rows: readonly { row: Row; placed: number }[];
  /** The classes the block occupies; it is listed under the first. */
  readonly classIds: readonly string[];
  /**
   * A half of a mixed split: the halves it may be paired with (`mixedPartners`),
   * those with lessons left first; empty for any other entry.
   */
  readonly partners: readonly { row: Row; placed: number }[];
  /** Every row of the block allows double lessons (task 5.4c-3a, decision 4). */
  readonly doubles: boolean;
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
    const key = row.mixedBlock ? row.id : block.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const rows = (row.mixedBlock ? [row.id] : block).flatMap((id) => {
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
    const partners = mixedPartners(model, row.id).flatMap((id) => {
      const one = rowsById.get(id);
      return one === undefined ? [] : [{ row: one, placed: placedOf(grid, id) }];
    });
    const left = (one: { row: Row; placed: number }) => one.placed < one.row.lessonsPerWeek;
    entries.push({
      rowId: row.id,
      rows,
      classIds,
      partners: [...partners.filter(left), ...partners.filter((one) => !left(one))],
      doubles: block.every((id) => model.rowOf(id).doubleLessons),
    });
  }
  const order = new Map(grid.classes.map((one, index) => [one.id, index]));
  const rank = (entry: ToPlaceEntry) => order.get(entry.classIds[0] ?? '') ?? grid.classes.length;
  return { entries: entries.sort((a, b) => rank(a) - rank(b)), complete };
}

/** One entry: draggable onto the board it can go on, with a Place button that works by keyboard and touch. */
function Entry({
  entry,
  model,
  onBoard,
  editable,
  highlighted,
  left,
  onPlace,
  onSuggest,
}: {
  entry: ToPlaceEntry;
  model: PatternModel;
  onBoard: boolean;
  editable: boolean;
  highlighted: boolean;
  /** Task 5.8a: the lessons of the entry's rows a copy did not keep, with their reasons. */
  left: readonly string[];
  onPlace: (double: boolean, partnerRowId: string | undefined) => void;
  onSuggest: (partnerRowId: string | undefined) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const element = useRef<HTMLLIElement>(null);
  const [dragging, setDragging] = useState(false);
  const [double, setDouble] = useState(false);
  const [partner, setPartner] = useState('');
  // A partner no longer offered falls back to the whole split.
  const partnerRowId = entry.partners.some((one) => one.row.id === partner) ? partner : undefined;
  const doubles =
    partnerRowId === undefined
      ? entry.doubles
      : [entry.rowId, partnerRowId].every((id) => model.rowOf(id).doubleLessons);
  const canDrag = editable && onBoard;
  const asDouble = doubles && double;

  useEffect(() => {
    const own = element.current;
    if (!canDrag || own === null) return undefined;
    return draggable({
      element: own,
      getInitialData: () => ({
        placeRowId: entry.rowId,
        placeDouble: asDouble,
        ...(partnerRowId === undefined ? {} : { placePartnerRowId: partnerRowId }),
      }),
      onDragStart: () => {
        setDragging(true);
      },
      onDrop: () => {
        setDragging(false);
      },
    });
  }, [canDrag, entry.rowId, asDouble, partnerRowId]);

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
      {left.map((line, index) => (
        <span key={`left-${String(index)}`} className="text-muted-foreground" data-left-reason="">
          {line}
        </span>
      ))}
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
      {editable && entry.partners.length > 0 && (
        <SelectField
          label={t('timetable.grid.pairedWith')}
          name={`partner-${entry.rowId}`}
          value={partnerRowId ?? ''}
          options={[
            { value: '', label: t('timetable.grid.wholeSplit') },
            ...entry.partners.map(({ row, placed }) => ({
              value: row.id,
              label: t('timetable.grid.rowOption', {
                subject: nameOf(row.subject.names, language),
                unit: unitText(row),
                placed,
                count: row.lessonsPerWeek,
              }),
            })),
          ]}
          onChange={(event) => {
            setPartner(event.target.value);
          }}
        />
      )}
      {editable && (
        <div className="flex flex-wrap items-center gap-x-2">
          {doubles && (
            <label className={CHECKBOX_TARGET}>
              <input
                type="checkbox"
                className={CHECKBOX}
                checked={double}
                onChange={(event) => {
                  setDouble(event.target.checked);
                }}
              />
              {t('timetable.grid.placeDouble')}
            </label>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onPlace(asDouble, partnerRowId);
            }}
          >
            {t('timetable.grid.place')}
          </Button>
          {!asDouble && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onSuggest(partnerRowId);
              }}
            >
              {t('timetable.grid.suggest')}
            </Button>
          )}
        </div>
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
  onPlace: (entry: ToPlaceEntry, double: boolean, partnerRowId: string | undefined) => void;
  /** "Suggest a place" for the entry's block (task 5.4b-2b), a pairing with its partner (5.4c-3b). */
  onSuggest: (entry: ToPlaceEntry, partnerRowId: string | undefined) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { entries, complete } = toPlace(grid, model);
  // Task 5.8a: a left block of a copied row is told under that row's entry too.
  const leftOf = (entry: ToPlaceEntry): string[] =>
    leftLines(
      t,
      i18n.language,
      grid.left,
      grid.left.blocks
        .map((block) => ({
          ...block,
          lessons: block.lessons.filter(
            (lesson) =>
              lesson.copied &&
              entry.rows.some(
                ({ row }) =>
                  row.subject.id === lesson.subjectId &&
                  row.unit.id === (lesson.groupId ?? lesson.classId),
              ),
          ),
        }))
        .filter((block) => block.lessons.length > 0),
    );
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
                  model={model}
                  onBoard={entry.classIds.includes(classId)}
                  editable={editable}
                  highlighted={entry.rows.some(({ row }) => row.id === highlightRowId)}
                  left={leftOf(entry)}
                  onPlace={(double, partnerRowId) => {
                    onPlace(entry, double, partnerRowId);
                  }}
                  onSuggest={(partnerRowId) => {
                    onSuggest(entry, partnerRowId);
                  }}
                />
              ))}
            </ul>
          </div>
        );
      })}
      <GridLeft grid={grid} />
      {complete > 0 && (
        <p className="text-sm text-muted-foreground">
          {t('timetable.grid.placedInFull', { count: complete })}
        </p>
      )}
    </section>
  );
}
