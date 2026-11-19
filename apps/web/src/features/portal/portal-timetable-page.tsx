import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { cn } from '@/lib/utils';
import { portalWeekQuery, weekOf } from './portal-api';
import { ExamRow, LessonRow, dayItems, languageOf } from './portal-lessons';
import { PortalTitle } from './portal-shell';
import { DayStrip, WeekNav, dayText, openDay, stripDays } from './portal-week';

/**
 * The timetable page of the portal (task 11.2; `10`: "The child's week, with rooms and teachers,
 * and changes marked"). Phone first: the week's school days in one row and one day open at a
 * time, today when it is in the week; each lesson and exam in time order with its subject in its
 * colour, teacher and room, "Changed" and "Cancelled" in words. The day open is in the address.
 */
export function PortalTimetablePage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = languageOf(i18n.language);
  const { studentId } = useParams({ from: '/portal/$studentId/timetable' });
  const { date } = useSearch({ from: '/portal/$studentId/timetable' });
  const navigate = useNavigate({ from: '/portal/$studentId/timetable' });
  const week = useQuery(portalWeekQuery(studentId, weekOf(date)));
  const title = <PortalTitle>{t('portal.timetable.title')}</PortalTitle>;
  if (week.isError) {
    return (
      <>
        {title}
        <ErrorState
          error={week.error}
          onRetry={() => {
            void week.refetch();
          }}
        />
      </>
    );
  }
  if (week.data === undefined) {
    return (
      <>
        {title}
        <LoadingOutline lines={6} />
      </>
    );
  }
  const { days, lessons, exams, monday, today } = week.data;
  const busy = new Set([...lessons.map((one) => one.date), ...exams.map((one) => one.date)]);
  const strip = stripDays(monday, busy);
  const selected = openDay(strip, date, today);
  const day = days.find((one) => one.date === selected);
  const items = dayItems(selected, lessons, exams);
  const quiet = new Set(
    days.filter((one) => one.dayOff !== null || one.outsideYear).map((one) => one.date),
  );
  return (
    <>
      {title}
      <WeekNav
        monday={monday}
        today={today}
        onDate={(next) => {
          void navigate({ search: next === undefined ? {} : { date: next } });
        }}
      />
      {days.every((one) => one.outsideYear) ? (
        <section className={PANEL}>
          <EmptyState text={t('portal.timetable.outsideYear')} />
        </section>
      ) : (
        <>
          <DayStrip
            days={strip}
            selected={selected}
            today={today}
            quiet={quiet}
            onSelect={(next) => {
              void navigate({ search: { date: next }, replace: true });
            }}
          />
          <section className={PANEL} aria-labelledby="portal-day" data-open-day={selected}>
            <h2 id="portal-day" className={cn(SECTION_TITLE, 'mb-4')}>
              {dayText(selected, language)}
              {selected === today && (
                <span className="font-normal text-muted-foreground">
                  {' '}
                  · {t('portal.todayWord')}
                </span>
              )}
            </h2>
            {day?.dayOff !== null && day?.dayOff !== undefined ? (
              <p>{t('portal.timetable.dayOff', { name: day.dayOff })}</p>
            ) : items.length === 0 ? (
              <p className="text-muted-foreground">{t('portal.timetable.noLessons')}</p>
            ) : (
              <ul>
                {items.map((item) =>
                  item.lesson === null ? (
                    <ExamRow
                      key={`exam-${String(item.start)}`}
                      exam={item.exam}
                      language={language}
                    />
                  ) : (
                    <LessonRow
                      key={`lesson-${String(item.start)}-${item.lesson.subject.id}`}
                      lesson={item.lesson}
                      language={language}
                    />
                  ),
                )}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
