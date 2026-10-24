import {
  UNLOCK_DAYS_MAX,
  UNLOCK_REASON_MAX_LENGTH,
  type EditLock,
  type JournalGrid,
  type JournalLesson,
} from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { SelectField, TextAreaField } from '@/components/field';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { momentText, schoolDateText } from '@/lib/dates';
import {
  decideUnlock,
  invalidateUnlocks,
  requestLessonUnlock,
  requestRatingUnlock,
  withdrawUnlock,
} from './unlocks-api';

/**
 * The edit period on the journal page (task 8.4, pull request #222; `07`,
 * Editing rules and locks; `edge/journal`, Locks, unlocks and corrections):
 * the lessons and the rating exam that are locked or unlocked for the reader,
 * with "Request unlock", the waiting request and its withdrawal, and for the
 * Academic Vice Principal and the Super Admin "Correct". The lock and every
 * right are the server's answer (`lock` of each lesson).
 */

/** The last open moment of a lock, as the spec words it: 23:59 of the last day. */
const lastMinuteOf = (locksAt: string): string =>
  new Date(Date.parse(locksAt) - 60_000).toISOString();

/** A correction under way: the lesson and its reason, asked once per visit. */
export interface Correcting {
  readonly lessonId: string;
  readonly reason: string;
}

/** A dialog that asks a reason and sends it. */
export function ReasonDialog({
  title,
  label,
  action,
  note,
  send,
  onClose,
}: {
  title: string;
  label: string;
  action: string;
  note?: string;
  send: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const run = useMutation({ mutationFn: send, onSuccess: onClose });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reason.trim() === '') {
      setMissing(true);
      return;
    }
    run.mutate(reason.trim());
  };
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
        <form aria-label={title} className="grid gap-4" onSubmit={submit}>
          {note !== undefined && <p className="text-sm">{note}</p>}
          <TextAreaField
            label={label}
            name="reason"
            value={reason}
            maxLength={UNLOCK_REASON_MAX_LENGTH}
            error={missing ? t('journal.locks.reasonNeeded') : undefined}
            onChange={(event) => {
              setReason(event.target.value);
              setMissing(false);
            }}
          />
          <FailureAlert error={run.error} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('journal.locks.back')}</DialogClose>
            <Button type="submit" disabled={run.isPending}>
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Approve with 1 to 7 days, or refuse with an optional reason (`edge/journal`). */
export function DecideUnlockDialog({
  unlockId,
  version,
  onClose,
}: {
  unlockId: string;
  version: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<'approve' | 'refuse'>('approve');
  const [days, setDays] = useState('1');
  const [reason, setReason] = useState('');
  const run = useMutation({
    mutationFn: () =>
      decideUnlock(
        unlockId,
        decision === 'approve'
          ? { decision: 'approve', days: Number(days), version }
          : { decision: 'refuse', reason: reason.trim() === '' ? null : reason.trim(), version },
      ),
    onSuccess: async () => {
      await invalidateUnlocks(queryClient);
      onClose();
    },
  });
  const title = t('journal.locks.decideTitle');
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
        <form
          aria-label={title}
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            run.mutate();
          }}
        >
          <SelectField
            label={t('journal.locks.decision')}
            name="decision"
            value={decision}
            options={[
              { value: 'approve', label: t('journal.locks.approve') },
              { value: 'refuse', label: t('journal.locks.refuse') },
            ]}
            onChange={(event) => {
              setDecision(event.target.value === 'refuse' ? 'refuse' : 'approve');
            }}
          />
          {decision === 'approve' ? (
            <SelectField
              label={t('journal.locks.days')}
              name="days"
              value={days}
              options={Array.from({ length: UNLOCK_DAYS_MAX }, (_, index) => ({
                value: String(index + 1),
                label: String(index + 1),
              }))}
              onChange={(event) => {
                setDays(event.target.value);
              }}
            />
          ) : (
            <TextAreaField
              label={t('journal.locks.refuseReason')}
              name="reason"
              value={reason}
              maxLength={UNLOCK_REASON_MAX_LENGTH}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          )}
          <FailureAlert error={run.error} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('journal.locks.back')}</DialogClose>
            <Button type="submit" disabled={run.isPending}>
              {decision === 'approve' ? t('journal.locks.approve') : t('journal.locks.refuse')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** What one row of the panel is about: a lesson, or the rating exam of the quarter. */
interface LockRow {
  readonly key: string;
  readonly label: string;
  readonly lock: EditLock;
  readonly request: (reason: string) => Promise<unknown>;
  readonly lessonId: string | null;
}

/** The words of a lock for the reader: locked since, unlocked until, or the waiting request. */
export function LockState({ lock }: { lock: EditLock }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  if (lock.window === 'unlocked' && lock.unlockedUntil !== null) {
    return (
      <span>
        {t('journal.locks.unlockedUntil', {
          until: momentText(language, lastMinuteOf(lock.unlockedUntil)),
          name: lock.unlockedBy ?? '—',
        })}
      </span>
    );
  }
  if (lock.window === 'locked' && lock.locksAt !== null) {
    return (
      <span>
        {lock.request === null
          ? t('journal.locks.locked', { at: momentText(language, lastMinuteOf(lock.locksAt)) })
          : t('journal.locks.waiting', { at: momentText(language, lastMinuteOf(lock.locksAt)) })}
      </span>
    );
  }
  return null;
}

/**
 * The panel of the journal page. Shown when any lesson of the quarter, or its
 * rating exam, is locked or unlocked for a reader who enters or corrects it.
 */
export function EditPeriodPanel({
  grid,
  correcting,
  onCorrect,
  onStopCorrecting,
}: {
  grid: JournalGrid;
  correcting: Correcting | null;
  onCorrect: (correcting: Correcting) => void;
  onStopCorrecting: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const language = i18n.language;
  const [asking, setAsking] = useState<LockRow | null>(null);
  const [correctingOf, setCorrectingOf] = useState<LockRow | null>(null);
  const withdraw = useMutation({
    mutationFn: (request: { id: string; version: number }) =>
      withdrawUnlock(request.id, request.version),
    onSuccess: () => invalidateUnlocks(queryClient),
  });
  const shown = (lock: EditLock) =>
    lock.window !== 'open' &&
    (lock.canRequest || lock.request !== null || lock.canCorrect || lock.window === 'unlocked');
  const lessonLabel = (lesson: JournalLesson) =>
    t('journal.locks.lesson', { date: schoolDateText(lesson.date, language, false) });
  const rows: LockRow[] = [
    ...grid.lessons
      .filter((lesson) => lesson.held && shown(lesson.lock))
      .map((lesson) => ({
        key: lesson.id,
        label: lessonLabel(lesson),
        lock: lesson.lock,
        request: (reason: string) => requestLessonUnlock(lesson.id, reason),
        lessonId: lesson.id,
      })),
    ...(grid.rating !== null && shown(grid.rating.lock)
      ? [
          {
            key: 'rating',
            label: t('journal.locks.rating'),
            lock: grid.rating.lock,
            request: (reason: string) =>
              requestRatingUnlock(grid.journal.id, grid.quarter.id, reason),
            lessonId: null,
          },
        ]
      : []),
  ];
  if (rows.length === 0 && correcting === null) return null;
  const correctedLesson = grid.lessons.find((one) => one.id === correcting?.lessonId);
  return (
    <section className={`${PANEL} grid gap-3`} aria-labelledby="edit-period">
      <h2 id="edit-period" className={SECTION_TITLE}>
        {t('journal.locks.title')}
      </h2>
      {correcting !== null && correctedLesson !== undefined && (
        <p className="flex flex-wrap items-center gap-3 text-sm" role="status">
          <span className="font-semibold">
            {t('journal.locks.correcting', {
              lesson: lessonLabel(correctedLesson),
              reason: correcting.reason,
            })}
          </span>
          <Button variant="ghost" onClick={onStopCorrecting}>
            {t('journal.locks.stopCorrecting')}
          </Button>
        </p>
      )}
      <ul className="grid gap-2 text-sm">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-center gap-3" data-lock-row={row.key}>
            <span className="font-semibold">{row.label}</span>
            <LockState lock={row.lock} />
            {row.lock.canRequest && (
              <Button
                variant="secondary"
                onClick={() => {
                  setAsking(row);
                }}
              >
                {t('journal.locks.request')}
              </Button>
            )}
            {row.lock.request !== null && (
              <Button
                variant="ghost"
                disabled={withdraw.isPending}
                onClick={() => {
                  if (row.lock.request !== null) withdraw.mutate(row.lock.request);
                }}
              >
                {t('journal.locks.withdraw')}
              </Button>
            )}
            {row.lock.canCorrect &&
              row.lessonId !== null &&
              correcting?.lessonId !== row.lessonId && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCorrectingOf(row);
                  }}
                >
                  {t('journal.locks.correct')}
                </Button>
              )}
          </li>
        ))}
      </ul>
      <FailureAlert error={withdraw.error} />
      {asking !== null && (
        <ReasonDialog
          title={t('journal.locks.requestTitle', { what: asking.label })}
          label={t('journal.locks.reason')}
          action={t('journal.locks.send')}
          send={async (reason) => {
            await asking.request(reason);
            await invalidateUnlocks(queryClient);
          }}
          onClose={() => {
            setAsking(null);
          }}
        />
      )}
      {correctingOf !== null && correctingOf.lessonId !== null && (
        <ReasonDialog
          title={t('journal.locks.correctTitle', { what: correctingOf.label })}
          label={t('journal.locks.correctReason')}
          action={t('journal.locks.startCorrecting')}
          note={t('journal.locks.correctNote')}
          send={(reason) => {
            onCorrect({ lessonId: correctingOf.lessonId ?? '', reason });
            return Promise.resolve();
          }}
          onClose={() => {
            setCorrectingOf(null);
          }}
        />
      )}
    </section>
  );
}

/** The grid with the corrected lesson open for entry (its saves carry the correction). */
export function withCorrection(grid: JournalGrid, correcting: Correcting | null): JournalGrid {
  if (correcting === null) return grid;
  return {
    ...grid,
    lessons: grid.lessons.map((lesson) =>
      lesson.id === correcting.lessonId && lesson.lock.canCorrect
        ? { ...lesson, canEnter: true, canEnterWorks: !grid.journal.attendanceOnly }
        : lesson,
    ),
  };
}

/** The correction a save of a lesson carries, if it is the one corrected. */
export const correctionOf =
  (correcting: Correcting | null) =>
  (lessonId: string): { reason: string } | undefined =>
    correcting !== null && correcting.lessonId === lessonId
      ? { reason: correcting.reason }
      : undefined;
