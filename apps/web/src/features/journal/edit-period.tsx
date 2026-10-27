import {
  UNLOCK_DAYS_MAX,
  UNLOCK_REASON_MAX_LENGTH,
  correctionSchema,
  unlockCreateSchema,
  unlockDecisionSchema,
  type EditLock,
  type JournalGrid,
  type JournalLesson,
  type UnlockDecision,
} from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { SelectField, TextAreaField } from '@/components/field';
import { wholeNumber, type FormSchema } from '@/components/form/form-messages';
import { useRecordForm } from '@/components/form/use-record-form';
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

/** A correction under way: the lesson, or the rating exam, and its reason, asked once per visit. */
export interface Correcting {
  /** The lesson corrected, or `null` for the rating exam of the quarter (code review 1, finding 2). */
  readonly lessonId: string | null;
  readonly reason: string;
}

/**
 * A typed reason kept while its dialog is closed and opened again in this tab
 * (`.claude/rules/web.md`: a dialog that sends once keeps its typed text);
 * dropped once sent. Keyed by what the dialog is for.
 */
export function useDrafts(): {
  draftOf: (key: string) => string;
  keep: (key: string, text: string) => void;
  drop: (key: string) => void;
} {
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  return {
    draftOf: (key) => drafts[key] ?? '',
    keep: (key, text) => {
      setDrafts((all) => ({ ...all, [key]: text }));
    },
    drop: (key) => {
      setDrafts((all) => Object.fromEntries(Object.entries(all).filter(([one]) => one !== key)));
    },
  };
}

type ReasonField = 'reason';

/**
 * A dialog that asks a reason and sends it once: not a record form, so it has a
 * Send button of its own and no entry in the unsent store; the field is checked
 * with the schema the server checks (`unlockCreateSchema` for a request,
 * `correctionSchema` for a correction; code review 1, finding 3).
 */
export function ReasonDialog({
  title,
  label,
  action,
  note,
  schema,
  draft,
  onTyped,
  send,
  onSent,
  onClose,
}: {
  title: string;
  label: string;
  action: string;
  note?: string;
  schema: FormSchema<{ reason: string }>;
  draft: string;
  onTyped: (text: string) => void;
  send: (reason: string) => Promise<unknown>;
  onSent: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const sent = useRef(false);
  const form = useRecordForm<ReasonField, { reason: string }>({
    schema,
    initial: { reason: draft },
    message: (_field, issue) =>
      issue.code === 'too_small' ? t('journal.locks.reasonNeeded') : undefined,
    save: async (values) => {
      await send(values.reason);
      sent.current = true;
    },
  });
  const element = useRef<HTMLFormElement>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const checked = await form.submit();
    if (!checked) {
      element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (sent.current) {
      onSent();
      onClose();
    }
  };
  const binding = form.bind('reason');
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
          ref={element}
          aria-label={title}
          className="grid gap-4"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          {note !== undefined && <p className="text-sm">{note}</p>}
          <TextAreaField
            label={label}
            maxLength={UNLOCK_REASON_MAX_LENGTH}
            {...binding}
            onChange={(event) => {
              binding.onChange(event);
              onTyped(event.target.value);
            }}
          />
          <FailureAlert error={form.failure} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('journal.locks.back')}</DialogClose>
            <Button type="submit" disabled={form.status === 'saving'}>
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DecisionField = 'decision' | 'days' | 'reason';

/**
 * Approve with 1 to 7 days, or refuse with an optional reason (`edge/journal`),
 * checked with `unlockDecisionSchema` (code review 1, finding 3). The reason of
 * a refusal is kept by the caller while the dialog is closed.
 */
export function DecideUnlockDialog({
  unlockId,
  version,
  draft,
  onTyped,
  onSent,
  onClose,
}: {
  unlockId: string;
  version: number;
  draft: string;
  onTyped: (text: string) => void;
  onSent: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sent = useRef(false);
  const read = useCallback(
    (typed: Record<DecisionField, string>): unknown =>
      typed.decision === 'refuse'
        ? {
            decision: 'refuse',
            reason: typed.reason.trim() === '' ? null : typed.reason,
            version,
          }
        : { decision: 'approve', days: wholeNumber(typed.days), version },
    [version],
  );
  const form = useRecordForm<DecisionField, UnlockDecision>({
    schema: unlockDecisionSchema,
    initial: { decision: 'approve', days: '1', reason: draft },
    read,
    save: async (decision) => {
      await decideUnlock(unlockId, decision);
      await invalidateUnlocks(queryClient);
      sent.current = true;
    },
  });
  const element = useRef<HTMLFormElement>(null);
  const decision = form.bind('decision');
  const days = form.bind('days');
  const reason = form.bind('reason');
  const approving = decision.value !== 'refuse';
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
          ref={element}
          aria-label={title}
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit().then((checked) => {
              if (!checked) {
                element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
                return;
              }
              if (sent.current) {
                onSent();
                onClose();
              }
            });
          }}
        >
          <SelectField
            label={t('journal.locks.decision')}
            options={[
              { value: 'approve', label: t('journal.locks.approve') },
              { value: 'refuse', label: t('journal.locks.refuse') },
            ]}
            {...decision}
          />
          {approving ? (
            <SelectField
              label={t('journal.locks.days')}
              options={Array.from({ length: UNLOCK_DAYS_MAX }, (_, index) => ({
                value: String(index + 1),
                label: String(index + 1),
              }))}
              {...days}
            />
          ) : (
            <TextAreaField
              label={t('journal.locks.refuseReason')}
              maxLength={UNLOCK_REASON_MAX_LENGTH}
              {...reason}
              onChange={(event) => {
                reason.onChange(event);
                onTyped(event.target.value);
              }}
            />
          )}
          <FailureAlert error={form.failure} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('journal.locks.back')}</DialogClose>
            <Button type="submit" disabled={form.status === 'saving'}>
              {approving ? t('journal.locks.approve') : t('journal.locks.refuse')}
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
  /** Needs the reader now: a request waiting, an unlock running, a lesson locked incomplete, the rating. */
  readonly urgent: boolean;
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
  const [showAll, setShowAll] = useState(false);
  const drafts = useDrafts();
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
        urgent:
          lesson.lock.request !== null ||
          lesson.lock.window === 'unlocked' ||
          lesson.status === 'locked_incomplete',
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
            urgent: true,
          },
        ]
      : []),
  ];
  // A long quarter locks dozens of lessons: only the ones that need the reader stay in view;
  // the plain locked ones, newest first, wait behind one button so the grid is not pushed
  // down (owner, 27 October 2026: "why do we need this big panel always open").
  const urgent = rows.filter((row) => row.urgent);
  const plain = rows.filter((row) => !row.urgent).reverse();
  const listed = showAll ? [...urgent, ...plain] : urgent;
  if (rows.length === 0 && correcting === null) return null;
  const correctedLabel =
    correcting === null
      ? undefined
      : correcting.lessonId === null
        ? t('journal.locks.rating')
        : (() => {
            const lesson = grid.lessons.find((one) => one.id === correcting.lessonId);
            return lesson === undefined ? undefined : lessonLabel(lesson);
          })();
  return (
    <section className={`${PANEL} grid gap-3`} aria-labelledby="edit-period">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="edit-period" className={SECTION_TITLE}>
          {t('journal.locks.title')}
        </h2>
        {plain.length > 0 && (
          <Button
            variant="ghost"
            aria-expanded={showAll}
            onClick={() => {
              setShowAll((open) => !open);
            }}
          >
            {showAll
              ? t('journal.locks.hideLocked')
              : t('journal.locks.showLocked', { count: plain.length })}
          </Button>
        )}
      </div>
      {correcting !== null && correctedLabel !== undefined && (
        <p className="flex flex-wrap items-center gap-3 text-sm" role="status">
          <span className="font-semibold">
            {t('journal.locks.correcting', {
              lesson: correctedLabel,
              reason: correcting.reason,
            })}
          </span>
          <Button variant="ghost" onClick={onStopCorrecting}>
            {t('journal.locks.stopCorrecting')}
          </Button>
        </p>
      )}
      {listed.length > 0 && (
        <ul className="grid gap-2 text-sm">
          {listed.map((row) => (
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
                (correcting === null || correcting.lessonId !== row.lessonId) && (
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
      )}
      <FailureAlert error={withdraw.error} />
      {asking !== null && (
        <ReasonDialog
          title={t('journal.locks.requestTitle', { what: asking.label })}
          label={t('journal.locks.reason')}
          action={t('journal.locks.send')}
          schema={unlockCreateSchema}
          draft={drafts.draftOf(`request:${asking.key}`)}
          onTyped={(text) => {
            drafts.keep(`request:${asking.key}`, text);
          }}
          send={async (reason) => {
            await asking.request(reason);
            await invalidateUnlocks(queryClient);
          }}
          onSent={() => {
            drafts.drop(`request:${asking.key}`);
          }}
          onClose={() => {
            setAsking(null);
          }}
        />
      )}
      {correctingOf !== null && (
        <ReasonDialog
          title={t('journal.locks.correctTitle', { what: correctingOf.label })}
          label={t('journal.locks.correctReason')}
          action={t('journal.locks.startCorrecting')}
          note={t('journal.locks.correctNote')}
          schema={correctionSchema}
          draft={drafts.draftOf(`correct:${correctingOf.key}`)}
          onTyped={(text) => {
            drafts.keep(`correct:${correctingOf.key}`, text);
          }}
          send={(reason) => {
            onCorrect({ lessonId: correctingOf.lessonId, reason });
            return Promise.resolve();
          }}
          onSent={() => {
            drafts.drop(`correct:${correctingOf.key}`);
          }}
          onClose={() => {
            setCorrectingOf(null);
          }}
        />
      )}
    </section>
  );
}

/** The grid with the corrected lesson, or rating exam, open for entry (its saves carry the correction). */
export function withCorrection(grid: JournalGrid, correcting: Correcting | null): JournalGrid {
  if (correcting === null) return grid;
  if (correcting.lessonId === null) {
    return grid.rating !== null && grid.rating.lock.canCorrect
      ? { ...grid, rating: { ...grid.rating, canEnter: true } }
      : grid;
  }
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

/** The correction a save of the rating exam carries, if it is the one corrected. */
export const ratingCorrectionOf = (
  correcting: Correcting | null,
): { reason: string } | undefined =>
  correcting !== null && correcting.lessonId === null ? { reason: correcting.reason } : undefined;
