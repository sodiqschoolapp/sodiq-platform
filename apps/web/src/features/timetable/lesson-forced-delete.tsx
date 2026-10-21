import {
  FORCED_DELETE_RESTORE_DAYS,
  forcedDeleteBodySchema,
  timeText,
  type DayLesson,
  type ForcedDeleteBody,
  type LessonHistoryLine,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useRef, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { TextAreaField } from '@/components/field';
import { useRecordForm } from '@/components/form/use-record-form';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatMoment, schoolDateText } from '@/lib/dates';
import { forceDeleteLesson, lessonHistoryQuery } from './timetable-api';

/**
 * The Super Admin's forced delete of one lesson with a typed reason (task
 * 5.8b; `06`, Protection: "Forced delete is for Super Admin only, with a typed
 * reason. The attendance and marks are kept for 30 days and can be
 * restored."): a dialog that sends once (`.claude/rules/web.md`), its field
 * checked with the shared schema, its key made when it opens.
 */
export function ForcedDeleteDialog({
  lesson,
  subject,
  onClose,
  onDeleted,
}: {
  lesson: DayLesson;
  subject: string;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const done = useRef(false);
  const key = useRef(crypto.randomUUID());
  const form = useRecordForm<'reason', ForcedDeleteBody>({
    schema: forcedDeleteBodySchema,
    initial: { reason: '' },
    save: async (body) => {
      await forceDeleteLesson(lesson.id, body, key.current);
      done.current = true;
    },
    message: (field) => (field === 'reason' ? t('timetable.day.reasonNeeded') : undefined),
  });
  const element = useRef<HTMLFormElement>(null);
  const title = t('timetable.forcedDelete.title', {
    subject,
    unit: lesson.unit.name,
    time: timeText(lesson.start),
  });

  const send = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const checked = await form.submit();
    if (!checked) {
      element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (done.current) {
      await onDeleted();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
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
            void send(event);
          }}
        >
          <p className="text-sm">
            {t('timetable.forcedDelete.kept', { count: FORCED_DELETE_RESTORE_DAYS })}
          </p>
          <TextAreaField label={t('timetable.day.reason')} rows={3} {...form.bind('reason')} />
          <FailureAlert error={form.failure} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>{t('timetable.day.keep')}</DialogClose>
            <Button type="submit" variant="destructive" disabled={form.status === 'saving'}>
              {t('timetable.forcedDelete.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The history of one lesson (task 5.8b; `06`, Protection: "Every change
 * records who, when, the value before and the value after").
 */
export function LessonHistoryDialog({
  lesson,
  branchId,
  subject,
  onClose,
}: {
  lesson: DayLesson;
  branchId: string | null;
  subject: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const history = useQuery(lessonHistoryQuery(branchId, lesson.id));
  const title = t('timetable.lessonHistory.title', {
    subject,
    unit: lesson.unit.name,
    time: timeText(lesson.start),
  });
  const moment = (iso: string | null) => (iso === null ? '' : formatMoment(i18n.language, iso));
  const changes = (line: LessonHistoryLine): string[] => {
    const parts: string[] = [];
    const none = t('timetable.lessonHistory.none');
    if (line.teacher.before?.id !== line.teacher.after?.id) {
      parts.push(
        t('timetable.lessonHistory.teacher', {
          before: line.teacher.before?.name ?? none,
          after: line.teacher.after?.name ?? none,
        }),
      );
    }
    if (line.room.before?.id !== line.room.after?.id) {
      parts.push(
        t('timetable.lessonHistory.room', {
          before: line.room.before?.name ?? none,
          after: line.room.after?.name ?? none,
        }),
      );
    }
    if (line.startsAt.before !== line.startsAt.after || line.date.before !== line.date.after) {
      parts.push(
        t('timetable.lessonHistory.time', {
          before:
            line.date.before === null
              ? none
              : `${schoolDateText(line.date.before, i18n.language)}, ${moment(line.startsAt.before)}`,
          after:
            line.date.after === null
              ? none
              : `${schoolDateText(line.date.after, i18n.language)}, ${moment(line.startsAt.after)}`,
        }),
      );
    }
    if (line.cancelCause.before !== line.cancelCause.after) {
      parts.push(
        line.cancelCause.after === null
          ? t('timetable.lessonHistory.uncancelled')
          : line.cancelCause.after === 'reason'
            ? t('timetable.lessonHistory.cancelled', { reason: line.cancelReason.after ?? '' })
            : t(`timetable.day.cause_${line.cancelCause.after}`),
      );
    }
    return parts;
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
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
        ) : history.data.lines.length === 0 ? (
          <EmptyState text={t('timetable.lessonHistory.empty')} />
        ) : (
          <ol aria-label={title} className="grid gap-3 text-sm">
            {history.data.lines.map((line) => (
              <li key={line.id} data-line={line.kind}>
                <p className="font-semibold">
                  {t(`timetable.lessonHistory.kind_${line.kind}`)} ·{' '}
                  {t('timetable.lessonHistory.by', {
                    name: line.who?.name ?? t('timetable.lessonHistory.system'),
                    moment: moment(line.changedAt),
                  })}
                </p>
                {line.kind === 'changed' && (
                  <ul className="grid gap-1">
                    {changes(line).map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>{t('timetable.day.back')}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
