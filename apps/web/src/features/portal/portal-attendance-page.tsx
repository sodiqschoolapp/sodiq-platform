import { PORTAL_MARKS, type PortalAttendanceLesson, type PortalMark } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { SubjectSwatch } from '@/features/setup/subject-colour';
import { cn } from '@/lib/utils';
import { portalAttendanceQuery, weekOf } from './portal-api';
import { MarkLabel, languageOf, type Language } from './portal-lessons';
import { PortalTitle } from './portal-shell';
import { WeekNav, dayText } from './portal-week';

/** Clock minutes as "08:30". */
const clockOf = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The marks the week's count always names; the others only when the week has them. */
const ALWAYS: readonly PortalMark[] = ['present', 'late', 'absent'];

/**
 * The Attendance page of the portal (task 11.3, pull request #296; `10`: "The child's marks by
 * day and lesson. An exempt lesson shows as exempt, never as an absence"): the week's count of
 * each mark (a count of the lessons listed below, nothing calculated), then the held lessons of
 * the week by day, each with its mark and the comment and note visible to parents.
 */
export function PortalAttendancePage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = languageOf(i18n.language);
  const { studentId } = useParams({ from: '/portal/$studentId/attendance' });
  const { date } = useSearch({ from: '/portal/$studentId/attendance' });
  const navigate = useNavigate({ from: '/portal/$studentId/attendance' });
  const week = useQuery(portalAttendanceQuery(studentId, weekOf(date)));
  const title = <PortalTitle>{t('portal.attendance.title')}</PortalTitle>;
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
  const lessons = week.data.lessons;
  const dates = [...new Set(lessons.map((one) => one.date))].sort();
  const counts = new Map<PortalMark, number>(
    PORTAL_MARKS.map((mark) => [mark, lessons.filter((one) => one.mark === mark).length]),
  );
  const shownMarks = PORTAL_MARKS.filter(
    (mark) => ALWAYS.includes(mark) || (counts.get(mark) ?? 0) > 0,
  );
  return (
    <>
      {title}
      <WeekNav
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
        <>
          <section className={PANEL} aria-labelledby="attendance-week">
            <h2 id="attendance-week" className={cn(SECTION_TITLE, 'mb-3')}>
              {t('portal.attendance.weekCount', { count: lessons.length })}
            </h2>
            <dl className="grid grid-cols-3 gap-2">
              {shownMarks.map((mark) => (
                <div
                  key={mark}
                  className="grid gap-1 rounded-lg bg-muted px-3 py-2"
                  data-count={mark}
                >
                  <dt className="text-sm text-muted-foreground">
                    {t(`portal.attendance.marks.${mark}`)}
                  </dt>
                  <dd className="text-[1.75rem]/[2.125rem] font-bold tabular-nums">
                    {counts.get(mark) ?? 0}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          {dates.map((day) => (
            <section key={day} className={PANEL} aria-labelledby={`day-${day}`}>
              <h2 id={`day-${day}`} className={cn(SECTION_TITLE, 'mb-3')}>
                {dayText(day, language)}
                {day === week.data.today && (
                  <span className="font-normal text-muted-foreground">
                    {' '}
                    · {t('portal.todayWord')}
                  </span>
                )}
              </h2>
              <ul>
                {lessons
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
          ))}
        </>
      )}
    </>
  );
}

function LessonRow({ lesson, language }: { lesson: PortalAttendanceLesson; language: Language }) {
  const { t } = useTranslation();
  return (
    <li className="grid gap-1 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0">
      <span className="flex items-center justify-between gap-3">
        <span className="grid min-w-0 gap-0.5">
          <span className="flex min-w-0 items-center gap-2 font-semibold">
            <SubjectSwatch colour={lesson.subject.colour} />
            <span className="truncate">{lesson.subject.names[language]}</span>
          </span>
          <span className="text-sm text-muted-foreground tabular-nums">
            {t('portal.attendance.time', { from: clockOf(lesson.start), to: clockOf(lesson.end) })}
          </span>
        </span>
        <MarkLabel mark={lesson.mark} />
      </span>
      {lesson.comment !== null && (
        <span className="text-sm text-muted-foreground italic">{lesson.comment}</span>
      )}
      {lesson.note !== null && (
        <span className="text-sm">{t('portal.attendance.note', { text: lesson.note })}</span>
      )}
    </li>
  );
}
