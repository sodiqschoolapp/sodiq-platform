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
import { cellHistoryQuery, invalidateJournal, markAllPresent, saveAttendance } from './journal-api';

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
  openHistory: (lessonId: string, student: JournalStudent) => void;
  /** The cells saved in this visit, for the saved sign. */
  saved: ReadonlySet<string>;
  /** A save or "all present" is on its way. */
  busy: boolean;
}

interface Notice {
  readonly kind: 'allPresent' | 'presentEarlier';
  readonly filled?: number;
  readonly skipped?: number;
  readonly names?: string;
}

export function useAttendanceEntry(grid: JournalGrid): {
  entry: AttendanceEntry;
  notices: React.JSX.Element;
} {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
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
    mutationFn: async (input: {
      lessonId: string;
      studentId: string;
      mark: AttendanceMark | null;
      version: number | null;
    }) => {
      const send = (numbers?: 'keep' | 'clear') =>
        saveAttendance(input.lessonId, {
          saves: [
            {
              studentId: input.studentId,
              mark: input.mark,
              version: input.version,
              ...(numbers === undefined ? {} : { numbers }),
            },
          ],
        });
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
        return send(clear ? 'clear' : 'keep');
      }
    },
    onMutate: () => {
      setFailure(null);
    },
    onSuccess: async (answer, input) => {
      setSaved((before) => new Set([...before, cellKey(input.lessonId, input.studentId)]));
      setNotice(
        answer.presentEarlier.length === 0
          ? null
          : { kind: 'presentEarlier', names: answer.presentEarlier.map(nameOf).join(', ') },
      );
      await invalidateJournal(queryClient);
    },
    onError: async (error) => {
      setFailure(error);
      // A stale cell: the stored value is read again (the choice of both is 8.3a's).
      await invalidateJournal(queryClient);
    },
  });

  const all = useMutation({
    mutationFn: (lessonId: string) => markAllPresent(lessonId),
    onMutate: () => {
      setFailure(null);
    },
    onSuccess: async (answer, lessonId) => {
      setSaved(
        (before) =>
          new Set([...before, ...answer.filled.map((one) => cellKey(lessonId, one.studentId))]),
      );
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

  const { mutate: saveMark, isPending: saving } = save;
  const { mutate: fillAll, isPending: filling } = all;
  const entry = useMemo(
    (): AttendanceEntry => ({
      mark: (lessonId, student, mark) => {
        const index = grid.lessons.findIndex((one) => one.id === lessonId);
        saveMark({
          lessonId,
          studentId: student.id,
          mark,
          version: student.cells[index]?.version ?? null,
        });
      },
      allPresent: (lessonId) => {
        fillAll(lessonId);
      },
      openHistory: (lessonId, student) => {
        setHistory({ lessonId, student });
      },
      saved,
      busy: saving || filling,
    }),
    [grid.lessons, saveMark, fillAll, saved, saving, filling],
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
        {notice?.kind === 'presentEarlier' && (
          <p data-present-earlier="true">
            {t('journal.entry.presentEarlier', { names: notice.names ?? '' })}
          </p>
        )}
      </div>
      <FailureAlert error={failure} />
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
