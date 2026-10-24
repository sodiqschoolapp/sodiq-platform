import type { AttendanceMark, JournalGrid, JournalStudent } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { ErrorState, EmptyState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useView } from '@/features/access/use-view';
import { accountText, cellKindText, cellValueText } from '@/features/people/cell-lines';
import { momentText } from '@/lib/dates';
import {
  StaleDialog,
  storedOf,
  useSaveStates,
  type LastAction,
  type SaveState,
  type StaleCell,
} from './cell-saves';
import {
  cellHistoryQuery,
  copyAttendance,
  invalidateJournal,
  markAllPresent,
  saveAttendance,
  showTyped,
} from './journal-api';

/**
 * Attendance entry in the journal (task 6.3, pull request #211; `07`,
 * Entering data: "Every cell saves by itself and shows a saved sign";
 * "'All present' marks 1 for every student who is not yet marked"): the
 * typed mark of a cell, "all present" of a lesson, the notices of their
 * answers and the history that opens from a cell (decision 16). The server
 * decides who may enter (`canEnter` of each lesson); the grid follows it.
 */

/** The key of a cell: lesson and student. */
export const cellKey = (lessonId: string, studentId: string) => `${lessonId}/${studentId}`;

/** What the grid and lesson mode call to enter. */
export interface AttendanceEntry {
  /** Saves a mark (or clears the cell with `null`) on the version the grid read. */
  mark: (lessonId: string, student: JournalStudent, mark: AttendanceMark | null) => void;
  allPresent: (lessonId: string) => void;
  /** "Copy attendance" into the second lesson of a double (task 8.3a). */
  copy: (lessonId: string) => void;
  openHistory: (lessonId: string, student: JournalStudent) => void;
  /** Where each cell typed in this visit stands, for its sign (task 8.3a). */
  stateOf: (lessonId: string, studentId: string) => SaveState | undefined;
  /** A save or "all present" is on its way. */
  busy: boolean;
}

interface Notice {
  readonly kind: 'allPresent' | 'copy' | 'presentEarlier';
  readonly filled?: number;
  readonly skipped?: number;
  readonly names?: string;
}

/** A typed mark on its way: the key is made once and sent again on a retry. */
interface TypedMark {
  lessonId: string;
  studentId: string;
  mark: AttendanceMark | null;
  version: number | null;
  key: string;
  /** The keep-or-clear answer once given: a retry sends the body last sent (spec review should-fix 6). */
  numbers?: 'keep' | 'clear';
}

export function useAttendanceEntry(
  grid: JournalGrid,
  record: (action: LastAction) => void = () => undefined,
): {
  entry: AttendanceEntry;
  notices: React.JSX.Element;
} {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const saves = useSaveStates();
  const [stale, setStale] = useState<{ input: TypedMark; cell: StaleCell } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [history, setHistory] = useState<{ lessonId: string; student: JournalStudent } | null>(
    null,
  );
  const nameOf = (id: string) => {
    const found = grid.students.find((one) => one.id === id);
    return found === undefined ? '' : `${found.lastName} ${found.firstName}`;
  };

  const save = useMutation({
    mutationFn: async (input: TypedMark) => {
      const send = (numbers?: 'keep' | 'clear') =>
        saveAttendance(
          input.lessonId,
          {
            saves: [
              {
                studentId: input.studentId,
                mark: input.mark,
                version: input.version,
                ...(numbers === undefined ? {} : { numbers }),
              },
            ],
          },
          input.key,
        );
      if (input.numbers !== undefined) return send(input.numbers);
      try {
        return await send();
      } catch (error) {
        // edge/journal: "Changing present to absent with numbers asks 'keep or clear', keeping by
        // default": the button that goes on clears, the one that does not keeps.
        if (!(error instanceof ApiFailure) || error.code !== 'numbers_keep_or_clear') throw error;
        const clear = await confirm({
          title: t('journal.works.keepTitle'),
          text: t('journal.works.keepText', { names: nameOf(input.studentId) }),
          action: t('journal.works.clear'),
          cancel: t('journal.works.keep'),
          destructive: true,
        });
        input.numbers = clear ? 'clear' : 'keep';
        return send(input.numbers);
      }
    },
    onMutate: (input) => {
      setFailure(null);
      // Shown at once (`12`: "Save a journal cell: shown at once").
      showTyped(queryClient, {
        lessonId: input.lessonId,
        studentId: input.studentId,
        workIndex: null,
        value: input.mark,
      });
      saves.set(cellKey(input.lessonId, input.studentId), 'saving');
    },
    onSuccess: async (answer, input) => {
      const key = cellKey(input.lessonId, input.studentId);
      saves.set(key, 'saved');
      saves.keepUnsent(key, null);
      record({
        lessonId: input.lessonId,
        cells: [...answer.cells.map((one) => ({ ...one, workId: null })), ...answer.cleared],
      });
      setNotice(
        answer.presentEarlier.length === 0
          ? null
          : { kind: 'presentEarlier', names: answer.presentEarlier.map(nameOf).join(', ') },
      );
      await invalidateJournal(queryClient);
    },
    onError: async (error, input) => {
      const key = cellKey(input.lessonId, input.studentId);
      // No answer, or a page too old for the server (edge/system-behaviour: "the page asks
      // to reload and keeps the unsent entries"): the typed value stays, "not saved".
      if (
        error instanceof ApiFailure &&
        (error.code === 'no_answer' || error.code === 'app_outdated')
      ) {
        // No answer: the typed value stays, "not saved", until the retry with the same key.
        saves.set(key, 'failed');
        saves.keepUnsent(key, { retry: () => save.mutate(input) });
        return;
      }
      saves.set(key, null);
      saves.keepUnsent(key, null);
      if (error instanceof ApiFailure && error.code === 'cell_stale') {
        // Both values, for the person to choose (edge/journal); the stored one is kept meanwhile.
        setStale({
          input,
          cell: {
            student: nameOf(input.studentId),
            attendance: true,
            workKind: null,
            mine: input.mark,
            stored: storedOf(error),
          },
        });
      } else {
        setFailure(error);
      }
      await invalidateJournal(queryClient);
    },
  });

  const all = useMutation({
    mutationFn: (lessonId: string) => markAllPresent(lessonId),
    onMutate: () => {
      setFailure(null);
    },
    onSuccess: async (answer, lessonId) => {
      for (const one of answer.filled) saves.set(cellKey(lessonId, one.studentId), 'saved');
      record({ lessonId, cells: answer.filled.map((one) => ({ ...one, workId: null })) });
      setNotice({
        kind: 'allPresent',
        filled: answer.filled.length,
        skipped: answer.skipped.length,
      });
      await invalidateJournal(queryClient);
    },
    onError: (error) => {
      setFailure(error);
    },
  });

  // Task 8.3a: "copy attendance" (From 6.3, review correction 4), reported as "all present" is.
  const copy = useMutation({
    mutationFn: (lessonId: string) => copyAttendance(lessonId),
    onMutate: () => {
      setFailure(null);
    },
    onSuccess: async (answer, lessonId) => {
      for (const one of answer.filled) saves.set(cellKey(lessonId, one.studentId), 'saved');
      record({ lessonId, cells: answer.filled.map((one) => ({ ...one, workId: null })) });
      setNotice({ kind: 'copy', filled: answer.filled.length, skipped: answer.skipped.length });
      await invalidateJournal(queryClient);
    },
    onError: (error) => {
      setFailure(error);
    },
  });

  const { mutate: saveMark, isPending: saving } = save;
  const { mutate: fillAll, isPending: filling } = all;
  const { mutate: copyMarks, isPending: copying } = copy;
  const { states } = saves;
  const entry = useMemo(
    (): AttendanceEntry => ({
      mark: (lessonId, student, mark) => {
        const index = grid.lessons.findIndex((one) => one.id === lessonId);
        saveMark({
          lessonId,
          studentId: student.id,
          mark,
          version: student.cells[index]?.version ?? null,
          key: crypto.randomUUID(),
        });
      },
      allPresent: (lessonId) => {
        fillAll(lessonId);
      },
      copy: (lessonId) => {
        copyMarks(lessonId);
      },
      openHistory: (lessonId, student) => {
        setHistory({ lessonId, student });
      },
      stateOf: (lessonId, studentId) => states.get(cellKey(lessonId, studentId)),
      busy: saving || filling || copying,
    }),
    [grid.lessons, saveMark, fillAll, copyMarks, states, saving, filling, copying],
  );

  const notices = (
    <>
      <div role="status" aria-live="polite" className="text-sm" data-entry-notice="true">
        {notice?.kind === 'allPresent' && (
          <p className="flex flex-wrap gap-x-1" data-all-present="true">
            <span>{t('journal.entry.allPresentFilled', { count: notice.filled ?? 0 })}</span>
            {(notice.skipped ?? 0) > 0 && (
              <span>{t('journal.entry.allPresentSkipped', { count: notice.skipped ?? 0 })}</span>
            )}
          </p>
        )}
        {notice?.kind === 'copy' && (
          <p className="flex flex-wrap gap-x-1" data-copy-attendance="true">
            <span>{t('journal.saving.copied', { count: notice.filled ?? 0 })}</span>
            {(notice.skipped ?? 0) > 0 && (
              <span>{t('journal.saving.copySkipped', { count: notice.skipped ?? 0 })}</span>
            )}
          </p>
        )}
        {notice?.kind === 'presentEarlier' && (
          <p data-present-earlier="true">
            {t('journal.entry.presentEarlier', { names: notice.names ?? '' })}
          </p>
        )}
      </div>
      {saves.notice}
      <FailureAlert error={failure} />
      {stale !== null && (
        <StaleDialog
          cells={[stale.cell]}
          onKeep={() => {
            setStale(null);
          }}
          onMine={() => {
            const { input, cell } = stale;
            setStale(null);
            saveMark({
              ...input,
              version: cell.stored?.version ?? null,
              key: crypto.randomUUID(),
            });
          }}
        />
      )}
      {history !== null && (
        <CellHistoryDialog
          lessonId={history.lessonId}
          student={history.student}
          language={i18n.language}
          onClose={() => {
            setHistory(null);
          }}
        />
      )}
    </>
  );

  return { entry, notices };
}

/** The history of a student's cells in a lesson (`07`: "It opens from the cell"). */
function CellHistoryDialog({
  lessonId,
  student,
  language,
  onClose,
}: {
  lessonId: string;
  student: JournalStudent;
  language: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const history = useQuery(cellHistoryQuery(branchId, lessonId, student.id));
  const title = t('journal.entry.historyTitle', {
    student: `${student.lastName} ${student.firstName}`,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {history.isError ? (
          <ErrorState error={history.error} onRetry={() => void history.refetch()} />
        ) : history.data === undefined ? (
          <LoadingOutline />
        ) : history.data.lines.length === 0 && history.data.workLines.length === 0 ? (
          <EmptyState text={t('journal.entry.historyEmpty')} />
        ) : (
          <Table aria-label={title}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('journal.entry.historyCell')}</TableHead>
                <TableHead>{t('journal.entry.historyBefore')}</TableHead>
                <TableHead>{t('journal.entry.historyAfter')}</TableHead>
                <TableHead>{t('journal.entry.historyWho')}</TableHead>
                <TableHead>{t('journal.entry.historyWhen')}</TableHead>
                <TableHead>{t('journal.entry.historyHow')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.data.lines.map((line) => {
                const cell = {
                  attendance: line.work === null,
                  workKind: line.work?.kind ?? null,
                };
                return (
                  <TableRow key={`${line.work?.id ?? 'a'}:${String(line.version)}`}>
                    <TableCell>{cellKindText(t, cell)}</TableCell>
                    <TableCell>{cellValueText(t, cell, line.before)}</TableCell>
                    <TableCell>{cellValueText(t, cell, line.after)}</TableCell>
                    <TableCell>{accountText(line.changedBy, '—')}</TableCell>
                    <TableCell>{momentText(language, line.changedAt)}</TableCell>
                    <TableCell>{t(`journal.changes.${line.changedHow}`)}</TableCell>
                  </TableRow>
                );
              })}
              {/* Task 8.1: the total and "not held" of the lesson's works (07: "The number and the total stay visible ... in the cell history"). */}
              {history.data.workLines.map((line) => {
                const work = t(
                  line.workKind === 'classwork'
                    ? 'journal.grid.parts.classwork'
                    : 'journal.grid.parts.homework',
                );
                const total = line.totalBefore !== line.totalAfter;
                const yesNo = (value: boolean | null) =>
                  value === null ? '—' : value ? t('journal.works.yes') : t('journal.works.no');
                return (
                  <TableRow key={line.id} data-work-line="true">
                    <TableCell>
                      {total
                        ? t('journal.works.historyTotal', { work })
                        : t('journal.works.historyNotHeld', { work })}
                    </TableCell>
                    <TableCell>
                      {total ? (line.totalBefore ?? '—') : yesNo(line.notHeldBefore)}
                    </TableCell>
                    <TableCell>
                      {total ? (line.totalAfter ?? '—') : yesNo(line.notHeldAfter)}
                    </TableCell>
                    <TableCell>
                      {line.changedBy === null ? '—' : accountText(line.changedBy, '—')}
                    </TableCell>
                    <TableCell>{momentText(language, line.changedAt)}</TableCell>
                    <TableCell>{t(`journal.works.changes.${line.changedHow}`)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('journal.entry.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
