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
import { GridClockBoard } from './grid-clock-board';
import { GridConflicts } from './grid-conflicts';
import { GridMoveDialog } from './grid-move-dialog';
import { GridPlaceForm } from './grid-place-form';
import { GridRoomPicker } from './grid-room-picker';
import { GridToPlace, isPlaceData } from './grid-to-place';
import { GridTile, isTileData, unitText } from './grid-tile';
import { ruleText } from './rule-text';
import {
  gridQuery,
  invalidateTimetable,
  changeLessonRoom,
  moveBlock,
  placeBlock,
  removeBlock,
  swapBlocks,
} from './timetable-api';
import {
  boardOf,
  cellKey,
  cellStatus,
  clockBoardOf,
  newBlockOf,
  NEW_BLOCK_ID,
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
 *
 * Task 5.4b-1: the views by teacher and by room on a clock axis, read only,
 * each lesson with a button to its class board (decisions 6 and 9); a
 * teacher's lessons in other branches as grey blocks there (decision 7).
 *
 * Task 5.4b-2a: beside the board, the "To place" panel (dragged or placed
 * from, decision 2) and the conflict panel (each result with a button to its
 * lesson, decision 8); the room picker of a lesson (decisions 4 and 5).
 */
const GRID_VIEWS = ['class', 'teacher', 'room'] as const;

type GridView = (typeof GRID_VIEWS)[number];

const gridViewOf = (value: string): GridView => GRID_VIEWS.find((one) => one === value) ?? 'class';

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
  const [view, setView] = useState<GridView>('class');
  const [classId, setClassId] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [moving, setMoving] = useState<PatternBlock | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState<BoardCell | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  /** The tile or the "To place" entry the conflict panel showed last. */
  const [shownBlock, setShownBlock] = useState<string | null>(null);
  const [shownRow, setShownRow] = useState<string | null>(null);
  /** The lesson whose room picker is open. */
  const [rooming, setRooming] = useState<{ blockId: string; lessonId: string } | null>(null);

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
  const teachers = useMemo(
    () => [
      ...new Map(
        (data?.rows ?? []).map((row) => [
          row.teacher.id,
          {
            id: row.teacher.id,
            name:
              row.teacher.kind === 'vacancy'
                ? t('timetable.load.vacancyOption', { name: row.teacher.name ?? '' })
                : (row.teacher.name ?? ''),
          },
        ]),
      ).values(),
    ],
    [data, t],
  );
  const chosenTeacher = teachers.find((one) => one.id === teacherId) ?? teachers[0];
  const chosenRoom = data?.rooms.find((one) => one.id === roomId) ?? data?.rooms[0];
  const clockBoard = useMemo(() => {
    if (data === undefined || model === null) return null;
    if (view === 'teacher' && chosenTeacher !== undefined) {
      const rows = data.facts.rows.filter((row) => row.teacherId === chosenTeacher.id);
      return clockBoardOf(
        data,
        model,
        { lesson: (lesson) => model.rowOf(lesson.loadRowId).teacherId === chosenTeacher.id },
        data.facts.busyElsewhere.filter((one) => one.teacherId === chosenTeacher.id),
        rows.flatMap((row) => model.unitOf(row.classId ?? row.groupId ?? '').grades),
      );
    }
    if (view === 'room' && chosenRoom !== undefined) {
      const rows = data.facts.rows.filter((row) => model.roomOfNew(row) === chosenRoom.id);
      return clockBoardOf(
        data,
        model,
        { lesson: (lesson) => lesson.roomId === chosenRoom.id },
        [],
        rows.flatMap((row) => model.unitOf(row.classId ?? row.groupId ?? '').grades),
      );
    }
    return null;
  }, [data, model, view, chosenTeacher, chosenRoom]);
  const branchName = (branchId: string) =>
    data?.facts.branches.find((one) => one.id === branchId)?.name ??
    t('timetable.grid.unknownBranch');
  /** The class board a block opens: its first lesson's class, or the first class its group draws from. */
  const classOf = (block: PatternBlock): string | null => {
    const first = block.lessons[0];
    if (first === undefined || model === null) return null;
    const row = model.rowOf(first.loadRowId);
    return model.unitOf(row.classId ?? row.groupId ?? '').classIds[0] ?? null;
  };

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
      if (drop.kind === 'place') {
        return placeBlock(versionId, {
          loadRowId: drop.block.lessons[0]?.loadRowId ?? '',
          weekday: weekdaySchema.parse(drop.to.weekday),
          slotPosition: drop.to.slotPosition,
        });
      }
      throw new Error('Only a move or a swap is sent.');
    },
    onSuccess: answered,
  });
  const remove = useMutation({
    mutationFn: (blockId: string) => removeBlock(versionId, blockId),
    onSuccess: answered,
  });
  const room = useMutation({
    mutationFn: (input: { blockId: string; lessonId: string; roomId: string }) =>
      changeLessonRoom(versionId, input.blockId, {
        lessonId: input.lessonId,
        roomId: input.roomId,
      }),
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
        if (isPlaceData(data) && model !== null) {
          setMoving(newBlockOf(model, data.placeRowId));
          setRefusal(null);
          return;
        }
        if (!isTileData(data)) return;
        setMoving(all.find((one) => one.id === data.blockId) ?? null);
        setRefusal(null);
      },
      onDrop: ({ source, location }) => {
        setMoving(null);
        const data = source.data;
        const target = location.current.dropTargets[0]?.data;
        if (target === undefined || !isCellData(target)) return;
        const block =
          isPlaceData(data) && model !== null
            ? newBlockOf(model, data.placeRowId)
            : isTileData(data)
              ? all.find((one) => one.id === data.blockId)
              : undefined;
        const cell = board?.cellAt(target.weekday, target.position) ?? null;
        if (block !== undefined && cell !== null) dropAt(block, cell);
      },
    });
  });

  useEffect(() => {
    if (shownBlock === null) return;
    document.querySelector<HTMLElement>(`[data-block="${shownBlock}"]`)?.focus();
  }, [shownBlock, view, classId]);

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

  const lessonName = (block: Pick<PatternBlock, 'lessons'>) =>
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
        <div className="min-w-40">
          <SelectField
            label={t('timetable.grid.view')}
            name="view"
            value={view}
            options={GRID_VIEWS.map((one) => ({
              value: one,
              label: t(`timetable.grid.views.${one}`),
            }))}
            onChange={(event) => {
              setView(gridViewOf(event.target.value));
              setAdding(null);
            }}
          />
        </div>
        {view === 'class' && (
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
        )}
        {view === 'teacher' && chosenTeacher !== undefined && (
          <div className="min-w-48">
            <SelectField
              label={t('timetable.grid.teacher')}
              name="teacher"
              value={chosenTeacher.id}
              options={teachers.map((one) => ({ value: one.id, label: one.name }))}
              onChange={(event) => {
                setTeacherId(event.target.value);
              }}
            />
          </div>
        )}
        {view === 'room' && chosenRoom !== undefined && (
          <div className="min-w-48">
            <SelectField
              label={t('timetable.grid.room')}
              name="room"
              value={chosenRoom.id}
              options={data.rooms.map((one) => ({ value: one.id, label: one.name }))}
              onChange={(event) => {
                setRoomId(event.target.value);
              }}
            />
          </div>
        )}
        <SavedSign saved={write.isSuccess || remove.isSuccess || room.isSuccess || placed} />
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
      <FailureAlert error={room.error} text={failureText(room.error)} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 content-start gap-4">
          {view === 'room' && chosenRoom === undefined && (
            <EmptyState
              title={t('timetable.grid.noRoomsTitle')}
              text={t('timetable.grid.noRooms')}
            />
          )}
          {view !== 'class' && clockBoard !== null && (
            <GridClockBoard
              board={clockBoard}
              name={(view === 'teacher' ? chosenTeacher?.id : chosenRoom?.id) ?? ''}
              rowsById={rowsById}
              roomsById={roomsById}
              results={data.results}
              branchName={branchName}
              classOf={classOf}
              onOpenClass={(id) => {
                setClassId(id);
                setView('class');
              }}
            />
          )}
          {view === 'class' && (
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
                                branchName={branchName}
                                editable={editable}
                                highlighted={block.id === shownBlock}
                                versionId={versionId}
                                onRoom={(lessonId) => {
                                  setRefusal(null);
                                  setRooming({ blockId: block.id, lessonId });
                                }}
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
          )}
          {view === 'class' && editable && adding !== null && (
            <GridPlaceForm
              key={`${chosen.id}|${cellKey(adding)}`}
              grid={data}
              model={model}
              all={all}
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
        </div>
        <aside className="grid content-start gap-6" aria-label={t('timetable.grid.panels')}>
          {view === 'class' && (
            <GridToPlace
              grid={data}
              model={model}
              classId={chosen.id}
              editable={editable}
              highlightRowId={shownRow}
              onPlace={(entry) => {
                setRefusal(null);
                setPlaced(false);
                setAdding(null);
                if (!entry.classIds.includes(chosen.id)) {
                  setClassId(entry.classIds[0] ?? chosen.id);
                }
                setMoving(newBlockOf(model, entry.rowId));
                setMenuOpen(true);
              }}
            />
          )}
          <GridConflicts
            grid={data}
            branchName={branchName}
            onShowBlock={(blockId) => {
              const block = all.find((one) => one.id === blockId);
              const target = block === undefined ? null : classOf(block);
              setView('class');
              if (target !== null) setClassId(target);
              setShownRow(null);
              setShownBlock(blockId);
            }}
            onShowRow={(rowId) => {
              const row = model.rowOf(rowId);
              const target = model.unitOf(row.classId ?? row.groupId ?? '').classIds[0];
              setView('class');
              if (target !== undefined) setClassId(target);
              setShownBlock(null);
              setShownRow(rowId);
            }}
          />
        </aside>
      </div>
      {editable && (
        <GridRoomPicker
          title={
            rooming === null
              ? null
              : t('timetable.grid.roomTitle', {
                  lesson: lessonName({
                    lessons:
                      all
                        .find((one) => one.id === rooming.blockId)
                        ?.lessons.filter((one) => one.id === rooming.lessonId) ?? [],
                  }),
                })
          }
          grid={data}
          model={model}
          all={all}
          block={rooming === null ? null : (all.find((one) => one.id === rooming.blockId) ?? null)}
          lessonId={rooming?.lessonId ?? null}
          onChoose={(roomId) => {
            const chosenLesson = rooming;
            setRooming(null);
            if (chosenLesson === null) return;
            const current = all
              .find((one) => one.id === chosenLesson.blockId)
              ?.lessons.find((one) => one.id === chosenLesson.lessonId)?.roomId;
            if (current !== roomId) room.mutate({ ...chosenLesson, roomId });
          }}
          onClose={() => {
            setRooming(null);
          }}
        />
      )}
      {editable && (
        <GridMoveDialog
          title={
            menuOpen && moving !== null
              ? t(
                  moving.id === NEW_BLOCK_ID
                    ? 'timetable.grid.placeLesson'
                    : 'timetable.grid.moveTitle',
                  { lesson: lessonName(moving) },
                )
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
