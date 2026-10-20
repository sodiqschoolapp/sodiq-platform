import { NOTIFICATION_KINDS, type Notification } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';

/**
 * What an exam's notice says beyond its text (task 5.6c-2; From line of
 * 5.6c-2, decision 2 of 5.6c-1): whether the exam was created, changed or
 * cancelled, and the person's own invigilation after the save. Nothing for
 * another kind, or for data this version of the app cannot read.
 */
export function ExamNotice({ item }: { item: Notification }) {
  const { t } = useTranslation();
  if (item.kind !== 'timetable.exam_changed') return null;
  const parsed = NOTIFICATION_KINDS['timetable.exam_changed'].safeParse(item.data);
  if (!parsed.success) return null;
  const { action, invigilation } = parsed.data;
  return (
    <div className="grid gap-0.5 px-2 pb-1.5 text-xs" data-exam-notice={action}>
      <p className="font-medium">{t(`notifications.exam.${action}`)}</p>
      {invigilation !== null && (
        <p>
          {t('notifications.exam.invigilation', {
            start: invigilation.start,
            end: invigilation.end,
            room: invigilation.room,
          })}
        </p>
      )}
    </div>
  );
}
