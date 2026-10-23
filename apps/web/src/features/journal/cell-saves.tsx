import type { ErrorDetail, Undo, Undone } from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { CheckIcon, RadioButtonUncheckedIcon, WarningIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUnsentEntry } from '@/components/unsent/unsent-changes';
import { cellValueText } from '@/features/people/cell-lines';
import { momentText } from '@/lib/dates';
import { invalidateJournal, undoCells } from './journal-api';

/**
 * Saving and stale saves (task 8.3a; `07`, Entering data, "Saving": "Every
 * cell saves by itself and shows a saved sign"; `edge/journal`, Saving and
 * working together; `12`, No lost work). The parts the attendance and the
 * numbers share: the sign of each cell (saving, saved, not saved), the cells
 * whose save got no answer with their retry, the choice between both values
 * of a stale save, and the undo of the person's own last action.
 */

/** Where a typed cell stands in this visit. */
export type SaveState = 'saving' | 'saved' | 'failed';

/** A save that got no answer: the same entry is sent again with the same key. */
interface Unsent {
  readonly retry: () => void;
}

export interface SaveStates {
  /** The state of each cell typed in this visit, by its key. */
  readonly states: ReadonlyMap<string, SaveState>;
  readonly set: (key: string, state: SaveState | null) => void;
  /** Keeps a save that got no answer for its retry, or takes it away (`null`). */
  readonly keepUnsent: (key: string, unsent: Unsent | null) => void;
  /** The notice of the cells not saved, with Retry. */
  readonly notice: React.JSX.Element | null;
}

/**
 * The states of the cells typed in this visit. A save with no answer stays
 * "not saved" with its typed value and is in the tab's unsent store, so the
 * page warns before it is closed (`07`: "the page warns before closing with
 * unsent entries"); the list that survives a reload is 8.3c's.
 */
export function useSaveStates(): SaveStates {
  const { t } = useTranslation();
  const [states, setStates] = useState<ReadonlyMap<string, SaveState>>(new Map());
  const [unsent, setUnsent] = useState<ReadonlyMap<string, Unsent>>(new Map());
  const set = useCallback((key: string, state: SaveState | null) => {
    setStates((before) => {
      const next = new Map(before);
      if (state === null) next.delete(key);
      else next.set(key, state);
      return next;
    });
  }, []);
  const keepUnsent = useCallback((key: string, entry: Unsent | null) => {
    setUnsent((before) => {
      const next = new Map(before);
      if (entry === null) next.delete(key);
      else next.set(key, entry);
      return next;
    });
  }, []);
  const latest = useRef(unsent);
  useEffect(() => {
    latest.current = unsent;
  });
  const count = unsent.size;
  useUnsentEntry(
    count === 0
      ? null
      : {
          label: t('journal.saving.unsentLabel', { count }),
          state: 'failed',
          // Leaving drops the typed values; the grid is read again on the next visit.
          discard: () => undefined,
          focus: () => {
            document.querySelector<HTMLElement>('[data-unsent-cells] button')?.focus();
          },
          settled: () => Promise.resolve(),
        },
  );
  const notice =
    count === 0 ? null : (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 text-sm text-destructive"
        data-unsent-cells="true"
      >
        <span>{t('journal.saving.notSavedCount', { count })}</span>
        <Button
          variant="secondary"
          onClick={() => {
            for (const entry of latest.current.values()) entry.retry();
          }}
        >
          {t('journal.saving.retry')}
        </Button>
      </div>
    );
  return { states, set, keepUnsent, notice };
}

/** A cell's sign: saving, saved or not saved, in words for a screen reader too. */
export function SaveSign({ state }: { state: SaveState | undefined }) {
  const { t } = useTranslation();
  if (state === undefined) return null;
  const label =
    state === 'saving'
      ? t('journal.saving.saving')
      : state === 'saved'
        ? t('journal.entry.saved')
        : t('journal.saving.notSaved');
  return (
    <span
      className={
        state === 'failed'
          ? 'ml-0.5 text-xs font-semibold text-destructive'
          : state === 'saved'
            ? 'ml-0.5 text-xs text-success'
            : 'ml-0.5 text-xs text-muted-foreground'
      }
      role="img"
      aria-label={label}
      title={label}
      data-save-state={state}
      data-saved={state === 'saved' ? 'true' : undefined}
    >
      {state === 'saving' ? (
        <RadioButtonUncheckedIcon className="inline size-3" aria-hidden="true" />
      ) : state === 'saved' ? (
        <CheckIcon className="inline size-3" aria-hidden="true" />
      ) : (
        <WarningIcon className="inline size-3" aria-hidden="true" />
      )}
    </span>
  );
}

/** One cell of a stale save: what is stored now, and what the person typed. */
export interface StaleCell {
  readonly student: string;
  /** `true`: the attendance cell; otherwise a work's number. */
  readonly attendance: boolean;
  readonly workKind: 'classwork' | 'homework' | null;
  readonly mine: number | null;
  readonly stored: NonNullable<ErrorDetail['storedCell']> | null;
}

/** The stored cell a stale refusal names, by the place of the save in the call. */
export function storedOf(error: unknown, index = 0): StaleCell['stored'] {
  if (!(error instanceof ApiFailure) || error.code !== 'cell_stale') return null;
  return error.details?.find((one) => one.path === `saves.${String(index)}`)?.storedCell ?? null;
}

/**
 * "A save based on an old version is refused, the stored value is kept, and
 * both values are shown for the user to choose. Nothing is overwritten
 * silently" (`edge/journal`). "Keep stored" sends nothing; "Use mine" sends
 * the typed value again on the stored version.
 */
export function StaleDialog({
  cells,
  onKeep,
  onMine,
}: {
  cells: readonly StaleCell[];
  onKeep: () => void;
  onMine: () => void;
}) {
  const { t, i18n } = useTranslation();
  const kind = (cell: StaleCell) => ({ attendance: cell.attendance, workKind: cell.workKind });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onKeep();
      }}
    >
      <DialogContent data-stale-dialog="true">
        <DialogHeader>
          <DialogTitle>{t('journal.saving.staleTitle')}</DialogTitle>
        </DialogHeader>
        <ul className="grid gap-3">
          {cells.map((cell, index) => (
            <li key={`${cell.student}:${String(index)}`} className="grid gap-1">
              <span className="font-semibold">{cell.student}</span>
              <span data-stale-stored="true">
                {t('journal.saving.stored', {
                  value: cellValueText(t, kind(cell), cell.stored?.value ?? null),
                  who:
                    cell.stored?.changedByName ??
                    cell.stored?.changedByLogin ??
                    t('journal.saving.someone'),
                  when:
                    cell.stored === null ? '' : momentText(i18n.language, cell.stored.changedAt),
                })}
              </span>
              <span data-stale-mine="true">
                {t('journal.saving.mine', { value: cellValueText(t, kind(cell), cell.mine) })}
              </span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="secondary" onClick={onKeep}>
            {t('journal.saving.keepStored')}
          </Button>
          <Button onClick={onMine}>{t('journal.saving.useMine')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The cells of the person's last action on the page, with the versions it gave them. */
export interface LastAction {
  readonly lessonId: string;
  readonly cells: readonly { studentId: string; workId: string | null; version: number }[];
}

export interface UndoControl {
  /** Remembers an action as the last one; an empty one changes nothing. */
  readonly record: (action: LastAction) => void;
  readonly undo: () => void;
  readonly available: boolean;
  readonly busy: boolean;
  readonly notice: React.JSX.Element;
}

/** The undo body: the cells grouped by student. */
function undoBody(action: LastAction): Undo {
  const students = new Map<string, { workId: string | null; version: number }[]>();
  for (const cell of action.cells) {
    students.set(cell.studentId, [
      ...(students.get(cell.studentId) ?? []),
      { workId: cell.workId, version: cell.version },
    ]);
  }
  return { students: [...students].map(([studentId, cells]) => ({ studentId, cells })) };
}

/**
 * Undo (`edge/journal`, Saving and working together: "It covers the user's
 * own last action on the page: one cell or one bulk action. It applies only
 * to cells nobody changed since and only while the lesson is editable"; `12`:
 * "The last action can be undone"). The server decides each cell; the notice
 * says how many were undone and how many were left because they changed.
 */
export function useUndo(): UndoControl {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [last, setLast] = useState<LastAction | null>(null);
  const [answer, setAnswer] = useState<Undone | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const mutation = useMutation({
    mutationFn: (action: LastAction) => undoCells(action.lessonId, undoBody(action)),
    onMutate: () => {
      setFailure(null);
      setAnswer(null);
    },
    onSuccess: async (done) => {
      setAnswer(done);
      await invalidateJournal(queryClient);
    },
    onError: (error) => {
      setFailure(error);
    },
  });
  const { mutate, isPending } = mutation;
  const record = useCallback((action: LastAction) => {
    if (action.cells.length === 0) return;
    setLast(action);
    setAnswer(null);
  }, []);
  const undo = useCallback(() => {
    if (last === null) return;
    // After the undo the page has no last action (decision 3).
    setLast(null);
    mutate(last);
  }, [last, mutate]);
  // Changed since, or a restore the cell no longer takes (a lower total, "not held").
  const changed = answer?.skipped.filter((one) => one.code === 'changed').length ?? 0;
  const refused = (answer?.skipped.length ?? 0) - changed;
  const notice = (
    <>
      <div role="status" aria-live="polite" className="text-sm" data-undo-notice="true">
        {answer !== null && (
          <p className="flex flex-wrap gap-x-1">
            <span>{t('journal.saving.undone', { count: answer.undone.length })}</span>
            {changed > 0 && <span>{t('journal.saving.undoSkipped', { count: changed })}</span>}
            {refused > 0 && <span>{t('journal.saving.undoRefused', { count: refused })}</span>}
          </p>
        )}
      </div>
      <FailureAlert error={failure} />
    </>
  );
  return { record, undo, available: last !== null, busy: isPending, notice };
}
