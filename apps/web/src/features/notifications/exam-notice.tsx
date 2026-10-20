import { NOTIFICATION_KINDS, type Notification } from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { schoolDateText } from '@/lib/dates';

/**
 * What an exam's notice says beyond its text, and the exams a publish's or a
 * withdraw's notice names as cancelled (task 5.6c-3a), and those a calendar
 * or template notice names as moved or cancelled (task 5.6c-3b) (task 5.6c-2; From line of
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
  // Task 5.6c-3b (decision 3): the exams a calendar or template change moved
  // or cancelled that this person invigilates ride in its own notice.
  if (item.kind === 'timetable.calendar_changed' || item.kind === 'timetable.template_changed') {
    const change = NOTIFICATION_KINDS[item.kind].safeParse(item.data);
    const exams = change.success ? (change.data.exams ?? []) : [];
    if (exams.length === 0) return null;
    return (
      <div className="grid gap-0.5 px-2 pb-1.5 text-xs" data-exams-changed={exams.length}>
        {exams.map((one) => (
          <p key={`${one.date}|${one.title}`} className="font-medium">
            {one.invigilation === null
              ? t('notifications.exam.cancelledBy', {
                  title: one.title,
                  date: schoolDateText(one.date, i18n.language),
                })
              : t('notifications.exam.movedBy', {
                  title: one.title,
                  date: schoolDateText(one.date, i18n.language),
                  start: one.invigilation.start,
                  end: one.invigilation.end,
                  room: one.invigilation.room,
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
