import {
  NOTIFICATION_KINDS,
  WEEK_KINDS,
  weekdaySchema,
  type Notification,
  type Weekday,
  type WeekLesson,
} from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { nameOf } from '@/features/setup/setup-api';
import { schoolDateText, weekdayName } from '@/lib/dates';

type WeekKind = (typeof WEEK_KINDS)[number];

const isWeekKind = (kind: string): kind is WeekKind =>
  (WEEK_KINDS as readonly string[]).includes(kind);

/** 1 for Monday to 7 for Sunday, of a school date. */
const weekdayOf = (date: string): Weekday =>
  weekdaySchema.parse(new Date(`${date}T00:00:00Z`).getUTCDay() || 7);

/**
 * The week before and after of a notice of a timetable change (task 5.5c-3a;
 * edge/timetable, After publishing: "One notice per person per event, with
 * the week before and after"), under the notice's text. A line that the
 * server found changed (nothing on the other side equals it) says so in words; a lesson with a one-day cancel says
 * "cancelled" (review correction 3). Nothing for another kind, or for data
 * this version of the app cannot read.
 */
export function WeekChange({ item }: { item: Notification }) {
  const { t, i18n } = useTranslation();
  if (!isWeekKind(item.kind)) return null;
  // Each kind with its own schema: a Tutor change carries no version number
  // (task 5.5c-3b, spec review should-fix 5).
  const week = NOTIFICATION_KINDS[item.kind].safeParse(item.data);
  if (!week.success) return null;
  const { before, after, weekStart } = week.data;
  const language = i18n.language;
  const side = (label: string, lessons: readonly WeekLesson[], testId: string) => (
    <div className="grid gap-0.5">
      <p className="text-xs font-medium">{label}</p>
      {lessons.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('notifications.week.none')}</p>
      ) : (
        <ul className="grid gap-0.5 text-xs" data-testid={testId}>
          {lessons.map((one, index) => (
            <li key={`${one.date}|${one.start}|${one.unit}|${String(index)}`}>
              {[
                `${weekdayName(language, weekdayOf(one.date))}, ${schoolDateText(one.date, language, false)}`,
                `${one.start}–${one.end}`,
                one.unit,
                nameOf(one.subject, language),
                one.room ?? t('notifications.week.noRoom'),
                ...(one.cancelled ? [t('notifications.week.cancelled')] : []),
              ].join(' · ')}
              {one.changed && (
                <span className="font-semibold"> · {t('notifications.week.changed')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <div className="grid gap-1 px-2 pb-1.5">
      <p className="text-xs text-muted-foreground">
        {t('notifications.week.title', { date: schoolDateText(weekStart, language) })}
      </p>
      {side(t('notifications.week.before'), before, 'week-before')}
      {side(t('notifications.week.after'), after, 'week-after')}
    </div>
  );
}
