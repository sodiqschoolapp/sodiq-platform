import type { PortalAttendanceLesson, PortalMark } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { SubjectSwatch } from '@/features/setup/subject-colour';
import { schoolDateText, weekdayName } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { portalAttendanceQuery, weekdayOfDate } from './portal-api';
import { PortalWeekBar } from './portal-week-bar';

type Language = 'uz' | 'ru' | 'en';
const languageOf = (language: string): Language =>
  language === 'ru' || language === 'en' ? language : 'uz';

/** Clock minutes as "08:30". */
const clockOf = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The look of each mark; exempt has its own neutral look, never the absence's (decision 7). */
const MARK_STYLE: Record<PortalMark, string> = {
  present: 'bg-success-bg text-success',
  late: 'bg-warning-bg text-warning',
  absent: 'bg-destructive-bg text-destructive',
  skipped: 'bg-destructive-bg text-destructive',
  exempt: 'bg-muted text-muted-foreground',
  unmarked: 'border border-border text-muted-foreground',
};

/**
 * The Attendance page of the portal (task 11.3, pull request #296; `10`: "The child's marks by
 * day and lesson. An exempt lesson shows as exempt, never as an absence"): the held lessons of
 * the week, by day, each with its mark and the comment and note visible to parents.
 */
export function PortalAttendancePage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = languageOf(i18n.language);
  const { studentId } = useParams({ from: '/portal/$studentId/attendance' });
  const { date } = useSearch({ from: '/portal/$studentId/attendance' });
  const navigate = useNavigate({ from: '/portal/$studentId/attendance' });
  const week = useQuery(portalAttendanceQuery(studentId, date));
  if (week.isError) {
    return (
      <ErrorState
        error={week.error}
        onRetry={() => {
          void week.refetch();
        }}
      />
    );
  }
  if (week.data === undefined) return <LoadingOutline lines={6} />;
  const dates = [...new Set(week.data.lessons.map((one) => one.date))];
  return (
    <>
      <h1 className="text-[1.75rem]/[2.125rem] font-bold tracking-[-0.01em]">
        {t('portal.attendance.title')}
      </h1>
      <PortalWeekBar
        monday={week.data.monday}
        today={week.data.today}
        onDate={(next) => {
          void navigate({ search: next === undefined ? {} : { date: next } });
        }}
      />
      {dates.length === 0 ? (
        <section className={PANEL}>
          <EmptyState text={t('portal.attendance.empty')} />
        </section>
      ) : (
        dates.map((day) => (
          <section key={day} className={PANEL} aria-labelledby={`day-${day}`}>
            <h2 id={`day-${day}`} className={cn(SECTION_TITLE, 'mb-3')}>
              {t('portal.attendance.day', {
                weekday: weekdayName(language, weekdayOfDate(day)),
                date: schoolDateText(day, language, false),
              })}
            </h2>
            <ul className="grid gap-3">
              {week.data.lessons
                .filter((one) => one.date === day)
                .map((one) => (
                  <LessonRow
                    key={`${one.date}-${String(one.start)}-${one.subject.id}`}
                    lesson={one}
                    language={language}
                  />
                ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

function LessonRow({ lesson, language }: { lesson: PortalAttendanceLesson; language: Language }) {
  const { t } = useTranslation();
  return (
    <li className="grid gap-1">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <SubjectSwatch colour={lesson.subject.colour} />
          <span className="font-semibold">{lesson.subject.names[language]}</span>
          <span className="text-sm text-muted-foreground tabular-nums">
            {t('portal.attendance.time', { from: clockOf(lesson.start), to: clockOf(lesson.end) })}
          </span>
        </span>
        <span
          className={cn('rounded-md px-2 py-0.5 text-sm font-semibold', MARK_STYLE[lesson.mark])}
          data-mark={lesson.mark}
        >
          {t(`portal.attendance.marks.${lesson.mark}`)}
        </span>
      </span>
      {lesson.comment !== null && <span className="text-sm italic">{lesson.comment}</span>}
      {lesson.note !== null && (
        <span className="text-sm">{t('portal.attendance.note', { text: lesson.note })}</span>
      )}
    </li>
  );
}
