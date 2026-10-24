import {
  RATING_SCORE_MAX,
  type JournalGrid,
  type JournalStudent,
  type RatingEntryValue,
  type RatingExam,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { DateField, NumberField, TextAreaField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { ErrorState, EmptyState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SUBSECTION_TITLE } from '@/components/ui/control';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useView } from '@/features/access/use-view';
import { momentText, schoolDateText } from '@/lib/dates';
import {
  invalidateJournal,
  ratingHistoryQuery,
  saveRatingEntry,
  setRatingDate,
  setRatingNotHeld,
} from './journal-api';

/**
 * The rating exam of the quarter shown (task 8.2, pull request #218;
 * `edge/calculation`, "The rating exam"): scores typed in the grid's column,
 * a dialog for a student's entry ("did not sit", "exempt", the reason of a
 * late sitting or a retake, the history) and one for the exam (its date and
 * "not held"). The server decides who may do what (`canEnter`, `canExempt`,
 * `canSetDate`, `canSetNotHeld`); nothing is calculated here. Task 8.4: in
 * the correction of the exam (the Academic Vice Principal or the Super Admin,
 * code review 1, finding 2) every save carries `correction` with the reason
 * asked once, which is the reason of the entry (review correction 2), and
 * "exempt" may be replaced by a mark.
 */

/** What the grid calls to enter rating scores and open the dialogs. */
export interface RatingInput {
  readonly exam: RatingExam;
  /** Saves a typed score; over a stored entry it opens the dialog that asks the reason. */
  score: (student: JournalStudent, score: number | null) => void;
  openEntry: (student: JournalStudent) => void;
  openExam: () => void;
  busy: boolean;
}

/** The entry of a student, `null` when none. */
export const ratingEntryOf = (exam: RatingExam, studentId: string) =>
  exam.entries.find((one) => one.studentId === studentId) ?? null;

/** The text of an entry in a cell or a line: the score, or the words. */
export function useEntryText(): (entry: RatingEntryValue | null) => string {
  const { t } = useTranslation();
  return (entry) =>
    entry === null
      ? '—'
      : entry.kind === 'score'
        ? String(entry.score)
        : t(`journal.rating.kinds.${entry.kind}`);
}

export function useRatingEntry(
  grid: JournalGrid,
  correction?: { readonly reason: string },
): {
  rating: RatingInput | undefined;
  dialogs: React.JSX.Element;
} {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { t } = useTranslation();
  const [failure, setFailure] = useState<unknown>(null);
  const [entryOpen, setEntryOpen] = useState<{ studentId: string; typed: number | null } | null>(
    null,
  );
  const [examOpen, setExamOpen] = useState(false);
  const exam = grid.rating;

  const done = async () => {
    await invalidateJournal(queryClient);
  };

  const mutation = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onMutate: () => {
      setFailure(null);
    },
    onSuccess: done,
    onError: async (error) => {
      setFailure(error);
      await done();
    },
  });
  const { mutate, isPending } = mutation;

  const rating = useMemo((): RatingInput | undefined => {
    if (exam === null) return undefined;
    return {
      exam,
      score: (student, value) => {
        const stored = ratingEntryOf(exam, student.id);
        if (correction !== undefined) {
          if (stored === null && value === null) return;
          mutate(() =>
            saveRatingEntry(exam.journalId, exam.quarterId, {
              studentId: student.id,
              entry: value === null ? null : { kind: 'score', score: value },
              reason: correction.reason,
              version: stored?.version ?? null,
              correction: true,
            }),
          );
          return;
        }
        if (stored !== null) {
          // A write over an entry needs its reason (decision 9): the dialog asks it.
          setEntryOpen({ studentId: student.id, typed: value });
          return;
        }
        if (value === null) return;
        mutate(() =>
          saveRatingEntry(exam.journalId, exam.quarterId, {
            studentId: student.id,
            entry: { kind: 'score', score: value },
            reason: null,
            version: null,
          }),
        );
      },
      openEntry: (student) => {
        setEntryOpen({ studentId: student.id, typed: null });
      },
      openExam: () => {
        setExamOpen(true);
      },
      busy: isPending,
    };
  }, [exam, mutate, isPending, correction]);

  const student =
    entryOpen === null ? undefined : grid.students.find((one) => one.id === entryOpen.studentId);

  const dialogs = (
    <>
      {failure !== null && entryOpen === null && !examOpen && <FailureAlert error={failure} />}
      {exam !== null && student !== undefined && entryOpen !== null && (
        <EntryDialog
          exam={exam}
          student={student}
          typed={entryOpen.typed}
          correction={correction}
          busy={isPending}
          failure={failure}
          onSave={(entry, reason) => {
            const stored = ratingEntryOf(exam, student.id);
            mutate(
              () =>
                saveRatingEntry(exam.journalId, exam.quarterId, {
                  studentId: student.id,
                  entry,
                  reason: reason ?? correction?.reason ?? null,
                  version: stored?.version ?? null,
                  ...(correction === undefined ? {} : { correction: true }),
                }),
              {
                onSuccess: () => {
                  setEntryOpen(null);
                },
              },
            );
          }}
          onClose={() => {
            setEntryOpen(null);
            setFailure(null);
          }}
        />
      )}
      {exam !== null && examOpen && (
        <ExamDialog
          exam={exam}
          busy={isPending}
          failure={failure}
          onDate={(date) => {
            mutate(() =>
              setRatingDate(exam.journalId, exam.quarterId, { date, version: exam.version }),
            );
          }}
          onNotHeld={(notHeld) => {
            mutate(async () => {
              try {
                return await setRatingNotHeld(exam.journalId, exam.quarterId, {
                  notHeld,
                  version: exam.version,
                });
              } catch (error) {
                if (!(error instanceof ApiFailure) || error.code !== 'rating_exam_entries') {
                  throw error;
                }
                const count = error.details?.[0]?.count ?? 0;
                const confirmed = await confirm({
                  title: t('journal.rating.notHeldTitle'),
                  text: t('journal.rating.notHeldConfirm', { count }),
                  action: t('journal.rating.notHeld'),
                });
                if (!confirmed) return null;
                return setRatingNotHeld(exam.journalId, exam.quarterId, {
                  notHeld,
                  version: exam.version,
                  confirm: true,
                });
              }
            });
          }}
          onClose={() => {
            setExamOpen(false);
            setFailure(null);
          }}
        />
      )}
    </>
  );

  return { rating, dialogs };
}

/** A student's entry: a score, "did not sit", "exempt", a clear, the reason over an entry, the history. */
function EntryDialog({
  exam,
  student,
  typed,
  correction,
  busy,
  failure,
  onSave,
  onClose,
}: {
  exam: RatingExam;
  student: JournalStudent;
  typed: number | null;
  correction: { readonly reason: string } | undefined;
  busy: boolean;
  failure: unknown;
  onSave: (entry: RatingEntryValue | null, reason: string | null) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const entryText = useEntryText();
  const stored = ratingEntryOf(exam, student.id);
  const [score, setScore] = useState(
    typed === null
      ? stored?.entry?.kind === 'score'
        ? String(stored.entry.score)
        : ''
      : String(typed),
  );
  const [reason, setReason] = useState('');
  const read = wholeNumber(score);
  const valid = typeof read === 'number' && read >= 0 && read <= RATING_SCORE_MAX;
  // A correction's reason, asked once, is the reason of every entry it writes.
  const needsReason = stored !== null && correction === undefined;
  // Under a correction, "exempt" may be replaced by a mark (code review 1, finding 1).
  const entersOver = stored?.entry?.kind !== 'exempt' || correction !== undefined;
  const reasonText = reason.trim() === '' ? null : reason.trim();
  const ready = !needsReason || reasonText !== null;
  const history = useQuery(
    ratingHistoryQuery(branchId, exam.journalId, exam.quarterId, student.id),
  );
  const name = `${student.lastName} ${student.firstName}`;
  const title = t('journal.rating.entryTitle', { student: name });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-label={title}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <p>
            {t('journal.rating.stored')}:{' '}
            <span data-stored-entry="true">{entryText(stored?.entry ?? null)}</span>
          </p>
          {exam.canEnter && (
            <NumberField
              label={t('journal.rating.score')}
              value={score}
              error={
                score === '' || valid
                  ? undefined
                  : t('journal.rating.wholeNumber', { max: RATING_SCORE_MAX })
              }
              onChange={(event) => {
                setScore(event.target.value);
              }}
            />
          )}
          {needsReason && (exam.canEnter || exam.canExempt) && (
            <TextAreaField
              label={t('journal.rating.reason')}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          )}
          {failure !== null && <FailureAlert error={failure} />}
          <div className="flex flex-wrap gap-2">
            {exam.canEnter && entersOver && (
              <>
                <Button
                  disabled={busy || !valid || !ready}
                  onClick={() => {
                    if (typeof read === 'number')
                      onSave({ kind: 'score', score: read }, reasonText);
                  }}
                >
                  {t('journal.rating.saveScore')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !ready}
                  onClick={() => {
                    onSave({ kind: 'did_not_sit' }, reasonText);
                  }}
                >
                  {t('journal.rating.kinds.did_not_sit')}
                </Button>
              </>
            )}
            {exam.canExempt && stored?.entry?.kind !== 'exempt' && (
              <Button
                variant="secondary"
                disabled={busy || !ready}
                onClick={() => {
                  onSave({ kind: 'exempt' }, reasonText);
                }}
              >
                {t('journal.rating.kinds.exempt')}
              </Button>
            )}
            {stored?.entry != null &&
              ((stored.entry.kind === 'exempt' && exam.canExempt) ||
                (stored.entry.kind !== 'exempt' && exam.canEnter)) && (
                <Button
                  variant="ghost"
                  disabled={busy || !ready}
                  onClick={() => {
                    onSave(null, reasonText);
                  }}
                >
                  {t('journal.rating.clear')}
                </Button>
              )}
          </div>
          <section className="grid gap-1">
            <h4 className={SUBSECTION_TITLE}>{t('journal.rating.history')}</h4>
            {history.isError ? (
              <ErrorState error={history.error} onRetry={() => void history.refetch()} />
            ) : history.data === undefined ? (
              <LoadingOutline />
            ) : history.data.lines.length === 0 ? (
              <EmptyState text={t('journal.rating.noHistory')} />
            ) : (
              <ul className="grid gap-1" aria-label={t('journal.rating.history')}>
                {history.data.lines.map((line) => (
                  <li key={`${line.kind}:${String(line.version)}:${line.changedAt}`}>
                    {t(
                      line.reason === null
                        ? 'journal.rating.line'
                        : 'journal.rating.lineWithReason',
                      {
                        change:
                          line.kind === 'exam'
                            ? t('journal.rating.examLine', {
                                date:
                                  line.dateAfter === null
                                    ? '—'
                                    : schoolDateText(line.dateAfter, i18n.language),
                              })
                            : t('journal.rating.change', {
                                before: entryText(line.before),
                                after: entryText(line.after),
                              }),
                        reason: line.reason ?? '',
                        who: line.changedBy ?? '—',
                        when: momentText(i18n.language, line.changedAt),
                      },
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('journal.entry.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The exam of the journal and quarter: its date by hand (or the linked exam's) and "not held". */
function ExamDialog({
  exam,
  busy,
  failure,
  onDate,
  onNotHeld,
  onClose,
}: {
  exam: RatingExam;
  busy: boolean;
  failure: unknown;
  onDate: (date: string | null) => void;
  onNotHeld: (notHeld: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [date, setDate] = useState(exam.date ?? '');
  const title = t('journal.rating.examTitle');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-label={title}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <DateField
            label={t('journal.rating.date')}
            value={date}
            disabled={!exam.canSetDate}
            note={exam.fromExam ? t('journal.rating.fromExam') : undefined}
            onChange={(event) => {
              setDate(event.target.value);
            }}
          />
          {failure !== null && <FailureAlert error={failure} />}
          <div className="flex flex-wrap gap-2">
            {exam.canSetDate && (
              <Button
                disabled={busy || date === (exam.date ?? '')}
                onClick={() => {
                  onDate(date === '' ? null : date);
                }}
              >
                {t('journal.rating.saveDate')}
              </Button>
            )}
            {exam.canSetNotHeld && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  onNotHeld(!exam.notHeld);
                }}
              >
                {exam.notHeld ? t('journal.rating.undoNotHeld') : t('journal.rating.notHeld')}
              </Button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('journal.entry.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
