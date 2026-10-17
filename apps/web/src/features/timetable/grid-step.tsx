import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { classDisplayName, weekdaySchema, type GridAnswer, type PlaceRecord } from '@sodiq/shared';
import { patternModel, type PatternBlock } from '@sodiq/timetable-rules';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { SelectField } from '@/components/field';
import { SavedSign } from '@/components/form/saved-sign';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { rangeText } from '@/features/setup/templates-api';
import { weekdayName } from '@/lib/dates';
import { SM, useMinWidth } from '@/lib/use-min-width';
import { GridCell, isCellData } from './grid-cell';
import { GridMoveDialog } from './grid-move-dialog';
import { GridPlaceForm } from './grid-place-form';
import { GridTile, isTileData, unitText } from './grid-tile';
import { ruleText } from './rule-text';
import {
  gridQuery,
  invalidateTimetable,
  moveBlock,
  placeBlock,
  removeBlock,
  swapBlocks,
} from './timetable-api';
import {
  boardOf,
  cellKey,
  cellStatus,
  useSlotStatuses,
  type BoardCell,
  type Drop,
} from './use-slot-status';

/**
 * Step 7 of the builder, the grid (06, Editing in the grid; task 5.4a, pull
 * request #130): the board of one class (decision 3), its lessons dragged to
 * another slot or onto another lesson to swap, added by an empty slot,
 * removed; while a lesson is moved every slot shows free, warning or blocked
 * with the rule, from the rule engine on the input the server checks with
 * (decision 2). A blocked slot is refused here and never sent; the server
 * refuses the same (14, Timetable, One rule engine). Read only for a version
 * that is not a draft, without `timetable` `edit`, and at phone width (`12`,
 * Devices: "The timetable builder is view only").
 */
export function GridStep({
  versionId,
  canEdit,
}: {
  versionId: string;
  canEdit: boolean;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const wide = useMinWidth(SM);
  const grid = useQuery(gridQuery(branchId, versionId));
  const data = grid.data;
  const editable = canEdit && wide && data?.editable === true;
  const [classId, setClassId] = useState<string | null>(null);
  const [moving, setMoving] = useState<PatternBlock | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState<BoardCell | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const model = useMemo(() => (data === undefined ? null : patternModel(data.facts)), [data]);
  const chosen = data?.classes.find((one) => one.id === classId) ?? data?.classes[0];
  const board = useMemo(
    () =>
      data === undefined || model === null || chosen === undefined
        ? null
        : boardOf(data, model, chosen.id),
    [data, model, chosen],
  );
  const all = useMemo(() => data?.blocks ?? [], [data]);
  const statuses = useSlotStatuses(model, board, all, moving);
  const rowsById = useMemo(() => new Map((data?.rows ?? []).map((row) => [row.id, row])), [data]);
  const roomsById = useMemo(
    () => new Map((data?.rooms ?? []).map((room) => [room.id, room.name])),
    [data],
  );

  const answered = (answer: GridAnswer) => {
    queryClient.setQueryData(gridQuery(branchId, versionId).queryKey, answer);
    return invalidateTimetable(queryClient);
  };
  const write = useMutation({
    mutationFn: (drop: Drop) => {
      if (drop.kind === 'move') {
        return moveBlock(versionId, drop.block.id, {
          weekday: weekdaySchema.parse(drop.to.weekday),
          slotPosition: drop.to.slotPosition,
        });
      }
      if (drop.kind === 'swap') {
        return swapBlocks(versionId, { blockIds: [drop.block.id, drop.other.id] });
      }
      throw new Error('Only a move or a swap is sent.');
    },
    onSuccess: answered,
  });
  const remove = useMutation({
    mutationFn: (blockId: string) => removeBlock(versionId, blockId),
    onSuccess: answered,
  });
  const [placed, setPlaced] = useState(false);

  /** The refusal with the rules of the engine named, for `pattern_blocked`. */
  const failureText = (error: unknown): string | undefined => {
    if (!(error instanceof ApiFailure) || error.code !== 'pattern_blocked') return undefined;
    const rules = [...new Set((error.details ?? []).map((detail) => detail.code))];
    return `${t('errors.pattern_blocked')} ${t('timetable.grid.blockedBy', {
      rules: rules.map((rule) => ruleText(t, rule)).join(' '),
    })}`;
  };

  /** A block dropped on a cell: refused here when blocked, else saved. */
  const dropAt = (block: PatternBlock, cell: BoardCell) => {
    if (model === null || board === null) return;
    const status = cellStatus(model, board, all, block, cell);
    setRefusal(null);
    setPlaced(false);
    if (status.drop.kind === 'same') return;
    if (status.status === 'blocked') {
      setRefusal(
        t('timetable.grid.refused', {
          rule: status.rule === null ? t('timetable.grid.noSlotHere') : ruleText(t, status.rule),
        }),
      );
      return;
    }
    write.mutate(status.drop);
  };

  useEffect(() => {
    if (!editable) return undefined;
    return monitorForElements({
      onDragStart: ({ source }) => {
        const data = source.data;
        if (!isTileData(data)) return;
        setMoving(all.find((one) => one.id === data.blockId) ?? null);
        setRefusal(null);
      },
      onDrop: ({ source, location }) => {
        setMoving(null);
        const data = source.data;
        const target = location.current.dropTargets[0]?.data;
        if (!isTileData(data) || target === undefined || !isCellData(target)) return;
        const block = all.find((one) => one.id === data.blockId);
        const cell = board?.cellAt(target.weekday, target.position) ?? null;
        if (block !== undefined && cell !== null) dropAt(block, cell);
      },
    });
  });

  if (grid.isError) {
    return (
      <ErrorState
        error={grid.error}
        onRetry={() => {
          void grid.refetch();
        }}
      />
    );
  }
  if (data === undefined || model === null) {
    return <LoadingOutline lines={8} />;
  }
  if (chosen === undefined || board === null) {
    return (
      <EmptyState title={t('timetable.grid.noClassesTitle')} text={t('timetable.grid.noClasses')} />
    );
  }

  const lessonName = (block: PatternBlock) =>
    block.lessons
      .map((lesson) => rowsById.get(lesson.loadRowId))
      .filter((row) => row !== undefined)
      .map((row) => `${nameOf(row.subject.names, language)}, ${unitText(row)}`)
      .join('; ');
  const removeAsked = async (block: PatternBlock) => {
    setRefusal(null);
    setPlaced(false);
    if (
      await confirm({
        title: t('timetable.grid.removeTitle'),
        names: [lessonName(block)],
        action: t('timetable.grid.remove'),
        destructive: true,
      })
    ) {
      remove.mutate(block.id);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-48">
          <SelectField
            label={t('timetable.grid.class')}
            name="class"
            value={chosen.id}
            options={data.classes.map((one) => ({
              value: one.id,
              label: classDisplayName(one.grade, one.name),
            }))}
            onChange={(event) => {
              setClassId(event.target.value);
              setAdding(null);
            }}
          />
        </div>
        <SavedSign saved={write.isSuccess || remove.isSuccess || placed} />
      </div>
      {!data.editable && <p className="text-sm">{t('timetable.grid.readOnly')}</p>}
      {data.editable && canEdit && !wide && (
        <p className="text-sm">{t('timetable.grid.phoneView')}</p>
      )}
      {refusal !== null && (
        <Alert variant="destructive" data-refusal="">
          <AlertDescription>{refusal}</AlertDescription>
        </Alert>
      )}
      <FailureAlert error={write.error} text={failureText(write.error)} />
      <FailureAlert error={remove.error} />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" data-board={chosen.id}>
          <thead>
            <tr>
              <th className="p-1 text-left font-semibold">
                <span className="sr-only">{t('timetable.grid.slot')}</span>
              </th>
              {board.weekdays.map((weekday) => (
                <th key={weekday} className="p-1 text-left font-semibold">
                  {weekdayName(language, weekdaySchema.parse(weekday))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.positions.map((position) => (
              <tr key={position}>
                <th scope="row" className="p-1 text-left align-top font-semibold">
                  {t('timetable.grid.slotNumber', { position })}
                </th>
                {board.weekdays.map((weekday) => {
                  const cell = board.cellAt(weekday, position);
                  if (cell === null) {
                    return (
                      <td
                        key={weekday}
                        className="border border-border p-1 align-top text-xs text-muted-foreground"
                      >
                        {t('timetable.grid.noSlot')}
                      </td>
                    );
                  }
                  const blocks = board.blocksAt(cell);
                  return (
                    <GridCell
                      key={weekday}
                      cell={cell}
                      status={menuOpen ? undefined : statuses.get(cellKey(cell))}
                      editable={editable}
                    >
                      <span className="text-xs text-muted-foreground">
                        {rangeText(t, cell.start, cell.end)}
                      </span>
                      {blocks.map((block) => (
                        <GridTile
                          key={block.id}
                          block={block}
                          rowsById={rowsById}
                          roomsById={roomsById}
                          results={data.results}
                          editable={editable}
                          onMove={() => {
                            setRefusal(null);
                            setMoving(block);
                            setMenuOpen(true);
                          }}
                          onRemove={() => {
                            void removeAsked(block);
                          }}
                        />
                      ))}
                      {editable && blocks.length === 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={t('timetable.grid.addAt', {
                            weekday: weekdayName(language, weekdaySchema.parse(weekday)),
                            time: rangeText(t, cell.start, cell.end),
                          })}
                          onClick={() => {
                            setRefusal(null);
                            setPlaced(false);
                            setAdding(cell);
                          }}
                        >
                          {t('timetable.grid.add')}
                        </Button>
                      )}
                    </GridCell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && adding !== null && (
        <GridPlaceForm
          key={`${chosen.id}|${cellKey(adding)}`}
          grid={data}
          model={model}
          classId={chosen.id}
          cell={adding}
          failureText={failureText}
          onPlace={async (record: PlaceRecord) => {
            await answered(await placeBlock(versionId, record));
            setAdding(null);
            setPlaced(true);
          }}
          onCancel={() => {
            setAdding(null);
          }}
        />
      )}
      {editable && (
        <GridMoveDialog
          title={
            menuOpen && moving !== null
              ? t('timetable.grid.moveTitle', { lesson: lessonName(moving) })
              : null
          }
          board={board}
          statuses={statuses}
          onChoose={(cell) => {
            const block = moving;
            setMenuOpen(false);
            setMoving(null);
            if (block !== null) dropAt(block, cell);
          }}
          onClose={() => {
            setMenuOpen(false);
            setMoving(null);
          }}
        />
      )}
    </div>
  );
}
