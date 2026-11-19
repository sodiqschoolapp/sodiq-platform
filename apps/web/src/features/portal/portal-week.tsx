import { useTranslation } from 'react-i18next';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { FOCUS_RING, QUICK, SECTION_TITLE } from '@/components/ui/control';
import { schoolDateText, weekRangeText, weekdayName } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { datePlus, weekdayOfDate } from './portal-api';

/** The keys of the short weekday names, Monday first. */
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** "Thursday, 19 November": a day's full name. */
export function dayText(date: string, language: string): string {
  return `${weekdayName(language, weekdayOfDate(date))}, ${schoolDateText(date, language, false)}`;
}

/**
 * The week shown and its neighbours (`12`: the week starts on Monday): the days of the week, the
 * previous and the next week as icon buttons, and "This week" when another week is open.
 */
export function WeekNav({
  monday,
  today,
  onDate,
}: {
  monday: string;
  today: string;
  /** A date of the week to open; `undefined` for this week. */
  onDate: (date: string | undefined) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const thisWeek = monday <= today && today <= datePlus(monday, 6);
  return (
    <div className="flex items-center gap-2">
      <h2 className={cn(SECTION_TITLE, 'min-w-0 flex-1')} data-week={monday}>
        {weekRangeText(monday, datePlus(monday, 6), i18n.language)}
      </h2>
      {!thisWeek && (
        <Button
          variant="ghost"
          onClick={() => {
            onDate(undefined);
          }}
        >
          {t('portal.thisWeek')}
        </Button>
      )}
      <Button
        variant="secondary"
        size="icon"
        aria-label={t('portal.previousWeek')}
        title={t('portal.previousWeek')}
        onClick={() => {
          onDate(datePlus(monday, -7));
        }}
      >
        <ChevronLeftIcon />
      </Button>
      <Button
        variant="secondary"
        size="icon"
        aria-label={t('portal.nextWeek')}
        title={t('portal.nextWeek')}
        onClick={() => {
          onDate(datePlus(monday, 7));
        }}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}

/**
 * The school days of the week as one row of buttons: the short weekday over the day's number.
 * The day open is the orange fill (the active item); today, when another day is open, has the
 * pale "today" fill and its name says "today" to a screen reader (no information by colour alone).
 */
export function DayStrip({
  days,
  selected,
  today,
  quiet,
  onSelect,
}: {
  days: readonly string[];
  selected: string;
  today: string;
  /** Days with nothing on them (a day off): their number is muted. */
  quiet: ReadonlySet<string>;
  onSelect: (date: string) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  return (
    <div
      className="grid auto-cols-fr grid-flow-col gap-1.5"
      role="group"
      aria-label={t('portal.days')}
    >
      {days.map((date) => {
        const chosen = date === selected;
        const isToday = date === today;
        return (
          <button
            key={date}
            type="button"
            aria-pressed={chosen}
            aria-label={
              isToday
                ? t('portal.dayIsToday', { day: dayText(date, i18n.language) })
                : dayText(date, i18n.language)
            }
            data-day={date}
            className={cn(
              'grid min-h-14 place-items-center content-center gap-0.5 rounded-lg px-1 py-1.5',
              QUICK,
              FOCUS_RING,
              chosen
                ? 'bg-primary text-primary-foreground'
                : isToday
                  ? 'bg-today text-foreground hover:bg-secondary'
                  : 'bg-card text-foreground hover:bg-secondary',
            )}
            onClick={() => {
              onSelect(date);
            }}
          >
            <span
              className={cn(
                'text-xs font-medium',
                chosen
                  ? 'text-primary-foreground'
                  : isToday
                    ? 'text-today-muted-foreground'
                    : 'text-muted-foreground',
              )}
            >
              {t(`portal.weekdaysShort.${WEEKDAY_KEYS[weekdayOfDate(date) - 1] ?? 'mon'}`)}
            </span>
            <span
              className={cn(
                'text-[1.0625rem]/6 font-bold tabular-nums',
                !chosen && quiet.has(date) && 'text-muted-foreground',
              )}
            >
              {Number(date.slice(8))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The days a strip shows: Monday to Saturday, and Sunday only when something is on it. */
export function stripDays(monday: string, busy: ReadonlySet<string>): string[] {
  const days = Array.from({ length: 6 }, (_, index) => datePlus(monday, index));
  const sunday = datePlus(monday, 6);
  return busy.has(sunday) ? [...days, sunday] : days;
}

/** The day a page opens on: the day of the address, else today in this week, else the first. */
export function openDay(days: readonly string[], asked: string | undefined, today: string): string {
  if (asked !== undefined && days.includes(asked)) return asked;
  if (days.includes(today)) return today;
  return days[0] ?? today;
}
