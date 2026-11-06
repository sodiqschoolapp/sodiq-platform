import { timeText, type PortalExam, type PortalLesson } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { EditIcon } from '@/components/icons';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { cn } from '@/lib/utils';
import { SubjectSwatch } from '@/features/setup/subject-colour';
import { schoolDateText, weekdayName } from '@/lib/dates';
import { portalWeekQuery, weekdayOfDate } from './portal-api';
import { PortalWeekBar } from './portal-week-bar';

type Language = 'uz' | 'ru' | 'en';
const languageOf = (language: string): Language =>
  language === 'ru' || language === 'en' ? language : 'uz';

/**
 * The timetable page of the portal (task 11.2; `10`: "The child's week, with rooms and teachers,
 * and changes marked"). Day by day for a phone: lessons and exams in time order, each with its
 * subject in its colour, teacher and room; "Changed", "Cancelled" and "Exam" in words with the
 * mark, never by colour alone (`12`).
 */
export function PortalTimetablePage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = languageOf(i18n.language);
  const { studentId } = useParams({ from: '/portal/$studentId/timetable' });
  const { date } = useSearch({ from: '/portal/$studentId/timetable' });
  const navigate = useNavigate({ from: '/portal/$studentId/timetable' });
  const week = useQuery(portalWeekQuery(studentId, date));
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
  const { days, lessons, exams } = week.data;
  const shown = days.filter((day) => !day.outsideYear);
  return (
    <>
      <h1 className="text-[1.75rem]/[2.125rem] font-bold tracking-[-0.01em]">
        {t('portal.timetable.title')}
      </h1>
      <PortalWeekBar
        monday={week.data.monday}
        today={week.data.today}
        onDate={(next) => {
          void navigate({ search: next === undefined ? {} : { date: next } });
        }}
      />
      {shown.length === 0 ? (
        <section className={PANEL}>
          <EmptyState text={t('portal.timetable.outsideYear')} />
        </section>
      ) : (
        shown.map((day) => {
          const items = [
            ...lessons
              .filter((one) => one.date === day.date)
              .map((lesson) => ({ start: lesson.start, lesson, exam: null })),
            ...exams
              .filter((one) => one.date === day.date)
              .map((exam) => ({ start: exam.start, lesson: null, exam })),
          ].sort((a, b) => a.start - b.start);
          return (
            <section key={day.date} className={PANEL} aria-labelledby={`day-${day.date}`}>
              <h3 id={`day-${day.date}`} className={cn(SECTION_TITLE, 'mb-3')}>
                {weekdayName(language, weekdayOfDate(day.date))},{' '}
                {schoolDateText(day.date, language, false)}
                {day.date === week.data.today && <> · {t('portal.today')}</>}
              </h3>
              {day.dayOff !== null ? (
                <p>{t('portal.timetable.dayOff', { name: day.dayOff })}</p>
              ) : items.length === 0 ? (
                <p className="text-muted-foreground">{t('portal.timetable.noLessons')}</p>
              ) : (
                <ul className="grid gap-3">
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
          );
        })
      )}
    </>
  );
}

function LessonRow({
  lesson,
  language,
}: {
  lesson: PortalLesson;
  language: Language;
}): React.JSX.Element {
  const { t } = useTranslation();
  const cancelled = lesson.state === 'cancelled';
  return (
    <li className="grid grid-cols-[4.5rem_1fr] gap-x-3">
      <span className="text-sm text-muted-foreground tabular-nums">
        {lesson.lessonNumber === null ? null : (
          <>
            {t('portal.timetable.lesson', { n: lesson.lessonNumber })}
            <br />
          </>
        )}
        {timeText(lesson.start)}–{timeText(lesson.end)}
      </span>
      <span className="min-w-0">
        <span
          className={
            cancelled
              ? 'flex items-center gap-2 line-through'
              : 'flex items-center gap-2 font-semibold'
          }
        >
          <SubjectSwatch colour={lesson.subject.colour} />
          {lesson.subject.names[language]}
        </span>
        <span className="block text-sm text-muted-foreground">
          {lesson.teacher ?? t('portal.timetable.teacherToCome')} ·{' '}
          {lesson.room ?? t('portal.timetable.roomToCome')}
        </span>
        {cancelled && (
          <span className="block text-sm font-semibold">
            {lesson.exam ? t('portal.timetable.replacedByExam') : t('portal.timetable.cancelled')}
          </span>
        )}
        {lesson.changed && (
          <span className="flex items-center gap-1 text-sm font-semibold">
            <EditIcon aria-hidden className="size-4" />
            {t('portal.timetable.changed')}
          </span>
        )}
      </span>
    </li>
  );
}

function ExamRow({ exam, language }: { exam: PortalExam; language: Language }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <li className="grid grid-cols-[4.5rem_1fr] gap-x-3">
      <span className="text-sm text-muted-foreground tabular-nums">
        {timeText(exam.start)}–{timeText(exam.end)}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 font-semibold">
          {exam.subject !== null && <SubjectSwatch colour={exam.subject.colour} />}
          {t('portal.timetable.exam', { title: exam.title })}
        </span>
        <span className="block text-sm text-muted-foreground">
          {exam.subject === null ? null : <>{exam.subject.names[language]} · </>}
          {exam.room ?? t('portal.timetable.roomToCome')}
        </span>
      </span>
    </li>
  );
}
