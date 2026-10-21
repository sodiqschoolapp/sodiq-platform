import {
  FORCED_DELETE_RESTORE_DAYS,
  timeText,
  type DayLesson,
  type LessonHistoryLine,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ForcedDeleteDialog as ReasonDialog } from '@/components/forced-delete-dialog';
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
 * restored."), in the dialog every forced delete shares (task 5.8c).
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
  return (
    <ReasonDialog
      title={t('timetable.forcedDelete.title', {
        subject,
        unit: lesson.unit.name,
        time: timeText(lesson.start),
      })}
      text={t('timetable.forcedDelete.kept', { count: FORCED_DELETE_RESTORE_DAYS })}
      send={(body, key) => forceDeleteLesson(lesson.id, body, key)}
      onClose={onClose}
      onDeleted={onDeleted}
    />
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
                    // An account with no staff record has no name: never a blank.
                    name:
                      line.who === null
                        ? t('timetable.lessonHistory.system')
                        : line.who.name === ''
                          ? t('audit.unnamed')
                          : line.who.name,
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
