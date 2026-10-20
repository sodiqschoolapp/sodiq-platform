import { NOTIFICATION_KINDS, type Notification } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { schoolDateText } from '@/lib/dates';

/**
 * What an exam's notice says beyond its text, and the exams a publish's or a
 * withdraw's notice names as cancelled (task 5.6c-3a) (task 5.6c-2; From line of
 * 5.6c-2, decision 2 of 5.6c-1): whether the exam was created, changed or
 * cancelled, and the person's own invigilation after the save. Nothing for
 * another kind, or for data this version of the app cannot read.
 */
export function ExamNotice({ item }: { item: Notification }) {
  const { t, i18n } = useTranslation();
  // Task 5.6c-3a (decision 7): the exams a publish or a withdraw cancelled
  // ride in its own notice.
  if (item.kind === 'timetable.published' || item.kind === 'timetable.withdrawn') {
    const version = NOTIFICATION_KINDS[item.kind].safeParse(item.data);
    const exams = version.success ? (version.data.examsCancelled ?? []) : [];
    if (exams.length === 0) return null;
    return (
      <div className="grid gap-0.5 px-2 pb-1.5 text-xs" data-exams-cancelled={exams.length}>
        {exams.map((one) => (
          <p key={`${one.date}|${one.title}`} className="font-medium">
            {t('notifications.exam.cancelledBy', {
              title: one.title,
              date: schoolDateText(one.date, i18n.language),
            })}
          </p>
        ))}
      </div>
    );
  }
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
