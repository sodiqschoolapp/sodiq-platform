import {
  NOTIFICATION_KINDS,
  WEEK_CHANGE_KINDS,
  weekdaySchema,
  type Notification,
  type Weekday,
  type WeekLesson,
} from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { nameOf } from '@/features/setup/setup-api';
import { schoolDateText, weekdayName } from '@/lib/dates';

/** The data of every kind of `WEEK_CHANGE_KINDS`: one schema for both. */
const weekSchema = NOTIFICATION_KINDS['timetable.published'];

const KINDS: readonly string[] = WEEK_CHANGE_KINDS;

const sameLesson = (a: WeekLesson, b: WeekLesson): boolean =>
  a.date === b.date &&
  a.start === b.start &&
  a.end === b.end &&
  a.unit === b.unit &&
  a.subject.en === b.subject.en &&
  a.room === b.room &&
  a.cancelled === b.cancelled;

/** The lessons of `side` with no equal on `other`, one to one. */
function differing(side: readonly WeekLesson[], other: readonly WeekLesson[]): boolean[] {
  const left = [...other];
  return side.map((one) => {
    const at = left.findIndex((candidate) => sameLesson(candidate, one));
    if (at < 0) return true;
    left.splice(at, 1);
    return false;
  });
}

/** 1 for Monday to 7 for Sunday, of a school date. */
const weekdayOf = (date: string): Weekday =>
  weekdaySchema.parse(new Date(`${date}T00:00:00Z`).getUTCDay() || 7);

/**
 * The week before and after of a notice of a timetable change (task 5.5c-3a;
 * edge/timetable, After publishing: "One notice per person per event, with
 * the week before and after"), under the notice's text. A line that differs
 * from the other side says so in words; a lesson with a one-day cancel says
 * "cancelled" (review correction 3). Nothing for another kind, or for data
 * this version of the app cannot read.
 */
export function WeekChange({ item }: { item: Notification }) {
  const { t, i18n } = useTranslation();
  if (!KINDS.includes(item.kind)) return null;
  const week = weekSchema.safeParse(item.data);
  if (!week.success) return null;
  const { before, after, weekStart } = week.data;
  const language = i18n.language;
  const side = (
    label: string,
    lessons: readonly WeekLesson[],
    changed: readonly boolean[],
    testId: string,
  ) => (
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
              {changed[index] === true && (
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
      {side(t('notifications.week.before'), before, differing(before, after), 'week-before')}
      {side(t('notifications.week.after'), after, differing(after, before), 'week-after')}
    </div>
  );
}
