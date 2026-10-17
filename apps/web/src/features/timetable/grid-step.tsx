import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import {
  classDisplayName,
  weekdaySchema,
  type GridAnswer,
  type PlaceRecord,
  type TimetableLockRecord,
} from '@sodiq/shared';
import { lockedBy, patternModel, type PatternBlock, type Suggestion } from '@sodiq/timetable-rules';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
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
import { GridLocks } from './grid-locks';
import { GridConflicts } from './grid-conflicts';
import {
  dropped,
  EMPTY_HISTORY,
  nextStep,
  placedAgain,
  recorded,
  renamed,
  rowsOfStep,
  stepOf,
  stillApplies,
  taken,
  writeOf,
  type Direction,
  type GridHistory,
  type Step,
  type StepKind,
  type StepWrite,
} from './grid-history';
import { GridMoveDialog } from './grid-move-dialog';
import { GridPlaceForm } from './grid-place-form';
import { GridRoomPicker } from './grid-room-picker';
import { GridSuggestDialog, rearrangeOf } from './grid-suggest-dialog';
import { GridToPlace, isPlaceData } from './grid-to-place';
import { GridTile, isTileData, unitText } from './grid-tile';
import { ruleText } from './rule-text';
import {
  gridQuery,
  invalidateTimetable,
  changeLessonRoom,
  createLock,
  deleteLock,
  moveBlock,
  placeBlock,
  rearrangeBlocks,
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
 *
 * Task 5.4b-2b: "Suggest a place" on a tile and on a "To place" entry, applied
 * through the rearrange route, which checks it again.
 *
 * Task 5.4c-2: Undo and Redo (and Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y) over the
 * page's own grid changes (`grid-history.ts`), each taken through the routes.
 */
const GRID_VIEWS = ['class', 'teacher', 'room'] as const;

type GridView = (typeof GRID_VIEWS)[number];

const gridViewOf = (value: string): GridView => GRID_VIEWS.find((one) => one === value) ?? 'class';

/** A step whose blocks changed since the board was read again (decision 3). */
class ChangedSince extends Error {}

const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** The direction a key asks for: Ctrl+Z undo, Ctrl+Shift+Z and Ctrl+Y redo (Cmd on a Mac). */
function directionOf(event: KeyboardEvent): Direction | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  return key === 'y' && !event.shiftKey ? 'redo' : null;
}

export function GridStep({
  versionId,
  canEdit,
  history,
  onHistory,
}: {
  versionId: string;
  canEdit: boolean;
  /** Task 5.4c-2: kept by the builder page for this version (decision 6). */
  history: GridHistory;
  onHistory: Dispatch<SetStateAction<GridHistory>>;
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
  /** The block whose "Suggest a place" is open. */
  const [suggesting, setSuggesting] = useState<PatternBlock | null>(null);
  /** The last undo or redo was dropped: its lessons changed since (decision 3). */
  const [changedSince, setChangedSince] = useState(false);
  const [placed, setPlaced] = useState(false);

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
  /** Task 5.4c-2: a write of the page becomes a step of the history, then the answer is shown. */
  const recordedAnswer = (kind: StepKind, before: readonly PatternBlock[], answer: GridAnswer) => {
    const step = stepOf(kind, before, answer.blocks);
    if (step !== null) {
      onHistory((current) => recorded(current, step));
    }
    return answered(answer);
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
    // The board before the write, for the step it makes (task 5.4c-2).
    onMutate: () => all,
    onSuccess: (answer, drop, before) =>
      drop.kind === 'move' || drop.kind === 'place' || drop.kind === 'swap'
        ? recordedAnswer(drop.kind, before ?? [], answer)
        : answered(answer),
  });
  const remove = useMutation({
    mutationFn: (blockId: string) => removeBlock(versionId, blockId),
    onMutate: () => all,
    onSuccess: (answer, _blockId, before) => recordedAnswer('remove', before ?? [], answer),
  });
  const room = useMutation({
    mutationFn: (input: { blockId: string; lessonId: string; roomId: string }) =>
      changeLessonRoom(versionId, input.blockId, {
        lessonId: input.lessonId,
        roomId: input.roomId,
      }),
    onMutate: () => all,
    onSuccess: (answer, _input, before) => recordedAnswer('room', before ?? [], answer),
  });
  const rearrange = useMutation({
    mutationFn: (suggestion: Suggestion) => {
      if (model === null) throw new Error('The grid is not read yet.');
      return rearrangeBlocks(versionId, rearrangeOf(model, suggestion));
    },
    onMutate: () => all,
    onSuccess: (answer, _suggestion, before) => recordedAnswer('suggestion', before ?? [], answer),
  });
  /** The write of a step by the route of its kind (decision 5). */
  const sent = (write: StepWrite): Promise<GridAnswer> => {
    switch (write.route) {
      case 'move':
        return moveBlock(versionId, write.blockId, write.body);
      case 'swap':
        return swapBlocks(versionId, write.body);
      case 'room':
        return changeLessonRoom(versionId, write.blockId, write.body);
      case 'place':
        return placeBlock(versionId, write.body);
      case 'remove':
        return removeBlock(versionId, write.blockId);
      case 'rearrange':
        return rearrangeBlocks(versionId, write.body);
    }
  };
  // Task 5.4c-2: an undo or a redo reads the board again, drops a step whose
  // lessons changed since (decision 3), and sends the rest through the routes,
  // which check it with the rule engine; a refusal keeps the step.
  const stepping = useMutation({
    mutationFn: async (
      direction: Direction,
    ): Promise<{ answer: GridAnswer; before: readonly PatternBlock[]; step: Step }> => {
      const step = nextStep(history, direction);
      if (step === undefined) throw new Error('Nothing to take.');
      const fresh = await queryClient.fetchQuery({
        ...gridQuery(branchId, versionId),
        staleTime: 0,
      });
      if (!stillApplies(patternModel(fresh.facts), fresh.blocks, step, direction)) {
        throw new ChangedSince();
      }
      const answer = await sent(writeOf(step, direction, fresh.blocks));
      return { answer, before: fresh.blocks, step };
    },
    onSuccess: ({ answer, before, step }, direction) => {
      onHistory((current) =>
        placedAgain(step, direction, before, answer.blocks).reduce(
          (next, ids) => renamed(next, ids.from, ids.to),
          taken(current, direction),
        ),
      );
      return answered(answer);
    },
    onError: (error, direction) => {
      if (error instanceof ChangedSince) {
        onHistory((current) => dropped(current, direction));
        setChangedSince(true);
      } else if (error instanceof ApiFailure && error.code === 'draft_edit_locked') {
        // Decision 6: the draft is another account's now.
        onHistory(EMPTY_HISTORY);
      }
    },
  });
  const go = (direction: Direction) => {
    if (stepping.isPending || nextStep(history, direction) === undefined) return;
    setRefusal(null);
    setPlaced(false);
    setChangedSince(false);
    stepping.mutate(direction);
  };
  const editLock = data?.version.editLock ?? null;
  useEffect(() => {
    // Decision 6: an answer naming another holder clears the history.
    if (editLock !== null && !editLock.mine) onHistory(EMPTY_HISTORY);
  }, [editLock, onHistory]);
  useEffect(() => {
    if (!editable) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const direction = directionOf(event);
      if (direction === null) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || FIELD_TAGS.has(target.tagName))
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"]') !== null) return;
      event.preventDefault();
      go(direction);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  });
  // Task 5.4c-1: the locks of the draft.
  const lock = useMutation({
    mutationFn: (record: TimetableLockRecord) => createLock(versionId, record),
    onSuccess: answered,
  });
  const unlock = useMutation({
    mutationFn: (lockId: string) => deleteLock(versionId, lockId),
    onSuccess: answered,
  });

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
  /** A step named by its kind and its first lesson. */
  const stepName = (step: Step) =>
    t(`timetable.grid.history.kinds.${step.kind}`, {
      lesson: lessonName({
        lessons: rowsOfStep(step).map((loadRowId) => ({ id: loadRowId, loadRowId, roomId: null })),
      }),
    });
  const undoStep = nextStep(history, 'undo');
  const redoStep = nextStep(history, 'redo');
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
        <SavedSign
          saved={
            write.isSuccess ||
            remove.isSuccess ||
            room.isSuccess ||
            rearrange.isSuccess ||
            lock.isSuccess ||
            unlock.isSuccess ||
            stepping.isSuccess ||
            placed
          }
        />
        {editable && (
          <div className="flex gap-2" data-history="">
            <Button
              type="button"
              variant="secondary"
              disabled={undoStep === undefined || stepping.isPending}
              aria-label={
                undoStep === undefined
                  ? t('timetable.grid.history.undo')
                  : t('timetable.grid.history.undoStep', { step: stepName(undoStep) })
              }
              onClick={() => {
                go('undo');
              }}
            >
              {t('timetable.grid.history.undo')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={redoStep === undefined || stepping.isPending}
              aria-label={
                redoStep === undefined
                  ? t('timetable.grid.history.redo')
                  : t('timetable.grid.history.redoStep', { step: stepName(redoStep) })
              }
              onClick={() => {
                go('redo');
              }}
            >
              {t('timetable.grid.history.redo')}
            </Button>
          </div>
        )}
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
      <FailureAlert error={rearrange.error} text={failureText(rearrange.error)} />
      <FailureAlert error={lock.error} />
      <FailureAlert error={unlock.error} />
      {changedSince && (
        <Alert variant="destructive" data-refusal="">
          <AlertDescription>{t('timetable.grid.history.changedSince')}</AlertDescription>
        </Alert>
      )}
      <FailureAlert
        error={stepping.error instanceof ChangedSince ? null : stepping.error}
        text={failureText(stepping.error)}
      />
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
                                onSuggest={() => {
                                  setRefusal(null);
                                  setPlaced(false);
                                  setSuggesting(block);
                                }}
                                locked={lockedBy(model, data.locks, block).length > 0}
                                ownLock={data.locks.some(
                                  (one) => one.kind === 'block' && one.blockId === block.id,
                                )}
                                onLock={() => {
                                  setRefusal(null);
                                  setPlaced(false);
                                  const own = data.locks.find(
                                    (one) => one.kind === 'block' && one.blockId === block.id,
                                  );
                                  if (own === undefined) {
                                    lock.mutate({ kind: 'block', blockId: block.id });
                                  } else {
                                    unlock.mutate(own.id);
                                  }
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
                const before = all;
                await recordedAnswer('place', before, await placeBlock(versionId, record));
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
              onSuggest={(entry) => {
                setRefusal(null);
                setPlaced(false);
                setAdding(null);
                setSuggesting(newBlockOf(model, entry.rowId));
              }}
            />
          )}
          {view === 'class' && (
            <GridLocks
              grid={data}
              classId={chosen.id}
              weekdays={board.weekdays}
              teachers={teachers}
              lessonName={lessonName}
              editable={editable}
              pending={lock.isPending || unlock.isPending}
              onLock={(record) => {
                setRefusal(null);
                setPlaced(false);
                lock.mutate(record);
              }}
              onUnlock={(lockId) => {
                setRefusal(null);
                setPlaced(false);
                unlock.mutate(lockId);
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
        <GridSuggestDialog
          title={
            suggesting === null
              ? null
              : t('timetable.grid.suggestTitle', { lesson: lessonName(suggesting) })
          }
          grid={data}
          model={model}
          all={all}
          block={suggesting}
          lessonName={lessonName}
          onApply={(suggestion) => {
            setSuggesting(null);
            rearrange.mutate(suggestion);
          }}
          onClose={() => {
            setSuggesting(null);
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
