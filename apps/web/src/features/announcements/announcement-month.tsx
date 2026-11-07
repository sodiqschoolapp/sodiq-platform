import type { AnnouncementMonth as Month, AnnouncementView, Weekday } from '@sodiq/shared';

/** The school's time zone, in which a publish moment is shown (`10`: Tashkent). */
const SCHOOL_TIME_ZONE = 'Asia/Tashkent';

/** Monday to Sunday. */
const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { Segmented } from '@/components/ui/segmented';
import { momentDateText, monthsText, schoolDateText, weekdayName } from '@/lib/dates';
import { cn } from '@/lib/utils';

export type MonthView = 'list' | 'calendar';

/** The month before or after `YYYY-MM`. */
export function monthStep(month: string, step: number): string {
  const [year, number] = month.split('-').map(Number);
  const moved = new Date(Date.UTC(year ?? 2026, (number ?? 1) - 1 + step, 1));
  return `${String(moved.getUTCFullYear())}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The dates of the calendar grid: whole weeks, Monday first, around the month. */
export function gridDates(month: string): string[] {
  const [year, number] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year ?? 2026, (number ?? 1) - 1, 1));
  const last = new Date(Date.UTC(year ?? 2026, number ?? 1, 0));
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  const end = new Date(last);
  end.setUTCDate(last.getUTCDate() + ((7 - last.getUTCDay()) % 7));
  const dates: string[] = [];
  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

const dateOf = (date: string) => new Date(`${date}T00:00:00Z`);

/** "20 Oct" or "20–21 Oct", with the times. */
function useWhen() {
  const { t, i18n } = useTranslation();
  const day = (date: string) => schoolDateText(date, i18n.language, false);
  return (event: NonNullable<AnnouncementView['event']>): string => {
    const dates =
      event.firstDate === event.lastDate
        ? day(event.firstDate)
        : t('announcements.dates', {
            first: day(event.firstDate),
            last: day(event.lastDate),
          });
    if (event.startsAt === null) return dates;
    const times =
      event.endsAt === null
        ? event.startsAt
        : t('announcements.times', { from: event.startsAt, to: event.endsAt });
    return t('announcements.when', { dates, times });
  };
}

/** One announcement as a reader sees it. */
export function AnnouncementItem({ item }: { item: AnnouncementView }) {
  const { t, i18n } = useTranslation();
  const when = useWhen();
  const published = momentDateText(i18n.language, item.publishedAt, {
    month: 'long',
    timeZone: SCHOOL_TIME_ZONE,
  });
  return (
    <article className="grid gap-2" data-announcement={item.id}>
      <p className="text-sm text-muted-foreground">
        {item.kind === 'event' ? t('announcements.kind.event') : t('announcements.kind.news')}
        {' · '}
        {item.schoolWide
          ? t('announcements.schoolWide')
          : t('announcements.published', { date: published })}
      </p>
      <h3 className={SECTION_TITLE}>{item.title}</h3>
      {item.event !== null && (
        <p className="text-sm font-semibold" data-when>
          {when(item.event)}
          {item.event.place !== null && <> · {item.event.place}</>}
        </p>
      )}
      <p className="whitespace-pre-line">{item.body}</p>
    </article>
  );
}

interface MonthProps {
  month: Month;
  view: MonthView;
  onView: (view: MonthView) => void;
  onMonth: (month: string) => void;
}

/**
 * The month of announcements (task 11.7; `11`: "News and events ... with a calendar"): news
 * published in the month and the events that touch it, as a list or on a calendar of the
 * month, Monday first, today marked. Shared by the staff page and the portal; phone first.
 */
export function AnnouncementMonth({ month, view, onView, onMonth }: MonthProps) {
  const { t, i18n } = useTranslation();
  const title = `${monthsText(`${month.month}-01`, `${month.month}-01`, i18n.language)} ${month.month.slice(0, 4)}`;
  /** Monday first: the short name of a weekday, 1 to 7. */
  const weekday = (day: Weekday) => weekdayName(i18n.language, day).slice(0, 3);
  const dates = gridDates(month.month);
  const events = month.announcements.filter((item) => item.event !== null);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            onMonth(monthStep(month.month, -1));
          }}
        >
          {t('announcements.previousMonth')}
        </Button>
        <h2 className={cn(SECTION_TITLE, 'min-w-40 text-center')} data-month={month.month}>
          {title}
        </h2>
        <Button
          variant="ghost"
          onClick={() => {
            onMonth(monthStep(month.month, 1));
          }}
        >
          {t('announcements.nextMonth')}
        </Button>
        <div className="ms-auto">
          <Segmented
            label={t('announcements.view')}
            options={[
              { value: 'list', label: t('announcements.list') },
              { value: 'calendar', label: t('announcements.calendar') },
            ]}
            value={view}
            onChange={onView}
          />
        </div>
      </div>
      {view === 'list' ? (
        month.announcements.length === 0 ? (
          <section className={PANEL}>
            <EmptyState text={t('announcements.emptyMonth')} />
          </section>
        ) : (
          <ul className="grid gap-4">
            {month.announcements.map((item) => (
              <li key={item.id} className={PANEL}>
                <AnnouncementItem item={item} />
              </li>
            ))}
          </ul>
        )
      ) : (
        <section className={PANEL} aria-label={t('announcements.calendar')}>
          <div className="grid grid-cols-7 gap-1" role="grid">
            {dates.slice(0, 7).map((date) => (
              <div key={date} className="text-center text-xs font-semibold text-muted-foreground">
                {weekday(WEEKDAYS[(dateOf(date).getUTCDay() + 6) % 7] ?? 1)}
              </div>
            ))}
            {dates.map((date) => {
              const inMonth = date.startsWith(month.month);
              const today = date === month.today;
              const onDay = events.filter(
                (item) =>
                  item.event !== null &&
                  item.event.firstDate <= date &&
                  date <= item.event.lastDate,
              );
              return (
                <div
                  key={date}
                  role="gridcell"
                  data-date={date}
                  aria-current={today ? 'date' : undefined}
                  className={cn(
                    'min-h-16 rounded-lg p-1 text-xs',
                    inMonth ? '' : 'text-muted-foreground',
                    today && 'bg-today font-semibold',
                  )}
                >
                  <div>{dateOf(date).getUTCDate()}</div>
                  {inMonth &&
                    onDay.map((item) => (
                      <div key={item.id} className="truncate font-semibold" title={item.title}>
                        {item.title}
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
          {events.length === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">{t('announcements.noEvents')}</p>
          )}
        </section>
      )}
    </div>
  );
}

/** The search of a month page: `month` (`YYYY-MM`) and `view`, anything else dropped. */
export const monthSearch = (
  search: Record<string, unknown>,
): { month?: string; view?: MonthView } => ({
  ...(typeof search.month === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(search.month)
    ? { month: search.month }
    : {}),
  ...(search.view === 'list' || search.view === 'calendar' ? { view: search.view } : {}),
});
