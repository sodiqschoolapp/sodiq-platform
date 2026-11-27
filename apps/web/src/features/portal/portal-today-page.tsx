import {
  codedName,
  type PortalMark,
  type PortalScore,
  type PortalSubjectGrades,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { SubjectSwatch } from '@/features/setup/subject-colour';
import { schoolDateText } from '@/lib/dates';
import { portalAttendanceQuery, portalGradesQuery, portalWeekQuery } from './portal-api';
import { ExamRow, LessonRow, dayItems, languageOf, type Language } from './portal-lessons';
import { PortalTitle } from './portal-shell';
import { dayText } from './portal-week';

/** How many of the latest scores the page shows; the Grades page has them all. */
const LATEST_SCORES = 5;

/** A section of the page: its title and a link to the whole page at the right. */
function Section({
  id,
  title,
  link,
  children,
}: {
  id: string;
  title: string;
  link: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className={PANEL} aria-labelledby={id}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 id={id} className={SECTION_TITLE}>
          {title}
        </h2>
        {link}
      </div>
      {children}
    </section>
  );
}

const LINK = 'text-sm font-semibold text-link hover:underline';

/**
 * The first page of the portal (19 November 2026): what a parent looks for each day, on one
 * screen. Today's lessons with the child's mark on each, the homework to hand in next, and the
 * latest scores, each with a link to its full page. Everything is read from the portal's own
 * pages' answers; nothing is calculated here.
 */
export function PortalTodayPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = languageOf(i18n.language);
  const { studentId } = useParams({ from: '/portal/$studentId/today' });
  const week = useQuery(portalWeekQuery(studentId, undefined));
  return (
    <>
      <PortalTitle
        {...(week.data === undefined ? {} : { fact: dayText(week.data.today, language) })}
      >
        {t('portal.today.title')}
      </PortalTitle>
      <LessonsSection studentId={studentId} language={language} />
      <ScoresSection studentId={studentId} language={language} />
    </>
  );
}

/**
 * Today's lessons with the child's attendance mark on each one marked. On a day without lessons
 * (a weekend, a day off) the next school day of the week, named in the title.
 */
function LessonsSection({
  studentId,
  language,
}: {
  studentId: string;
  language: Language;
}): React.JSX.Element {
  const { t } = useTranslation();
  const week = useQuery(portalWeekQuery(studentId, undefined));
  const attendance = useQuery(portalAttendanceQuery(studentId, undefined));
  const link = (
    <Link to="/portal/$studentId/timetable" params={{ studentId }} className={LINK}>
      {t('portal.today.wholeWeek')}
    </Link>
  );
  const failed = week.isError ? week : attendance.isError ? attendance : null;
  if (failed !== null) {
    return (
      <Section id="today-lessons" title={t('portal.today.lessons')} link={link}>
        <ErrorState
          error={failed.error}
          onRetry={() => {
            void failed.refetch();
          }}
        />
      </Section>
    );
  }
  if (week.data === undefined || attendance.data === undefined) {
    return (
      <Section id="today-lessons" title={t('portal.today.lessons')} link={link}>
        <LoadingOutline lines={4} />
      </Section>
    );
  }
  const { today, lessons, exams, days } = week.data;
  const todayOff = days.find((one) => one.date === today)?.dayOff ?? null;
  const shownDay =
    dayItems(today, lessons, exams).length > 0
      ? today
      : ([...new Set(lessons.map((one) => one.date))].sort().find((one) => one > today) ?? null);
  const marks = new Map<string, PortalMark>(
    attendance.data.lessons.map((one) => [
      `${one.date}|${String(one.start)}|${one.subject.id}`,
      one.mark,
    ]),
  );
  const title =
    shownDay === null || shownDay === today
      ? t('portal.today.lessons')
      : t('portal.today.nextLessons', { day: dayText(shownDay, language) });
  return (
    <Section id="today-lessons" title={title} link={link}>
      {shownDay !== today && (
        <p className="mb-3 text-muted-foreground">
          {todayOff === null
            ? t('portal.today.noLessonsToday')
            : t('portal.timetable.dayOff', { name: todayOff })}
        </p>
      )}
      {shownDay === null ? (
        <p className="text-muted-foreground">{t('portal.today.noMoreThisWeek')}</p>
      ) : (
        <ul>
          {dayItems(shownDay, lessons, exams).map((item) =>
            item.lesson === null ? (
              <ExamRow key={`exam-${String(item.start)}`} exam={item.exam} language={language} />
            ) : (
              <LessonRow
                key={`lesson-${String(item.start)}-${item.lesson.subject.id}`}
                lesson={item.lesson}
                language={language}
                mark={marks.get(
                  `${item.lesson.date}|${String(item.lesson.start)}|${item.lesson.subject.id}`,
                )}
              />
            ),
          )}
        </ul>
      )}
    </Section>
  );
}

/** The latest scores of the quarter, across subjects, the newest first. */
function ScoresSection({
  studentId,
  language,
}: {
  studentId: string;
  language: Language;
}): React.JSX.Element {
  const { t } = useTranslation();
  const grades = useQuery(portalGradesQuery(studentId, undefined));
  const link = (
    <Link to="/portal/$studentId/grades" params={{ studentId }} className={LINK}>
      {t('portal.today.allGrades')}
    </Link>
  );
  let body: React.ReactNode;
  if (grades.isError) {
    body = (
      <ErrorState
        error={grades.error}
        onRetry={() => {
          void grades.refetch();
        }}
      />
    );
  } else if (grades.data === undefined) {
    body = <LoadingOutline lines={3} />;
  } else {
    const latest = latestScores(grades.data.subjects);
    body =
      latest.length === 0 ? (
        <p className="text-muted-foreground">{t('portal.grades.noScores')}</p>
      ) : (
        <ul>
          {latest.map(({ subject, score }) => (
            <li
              key={`${subject.subject.id}-${score.date}-${score.kind}-${String(score.position)}`}
              className="flex items-center justify-between gap-3 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
            >
              <span className="grid min-w-0 gap-0.5">
                <span className="flex min-w-0 items-center gap-2 font-semibold">
                  <SubjectSwatch colour={subject.subject.colour} />
                  <span className="truncate">{subject.subject.names[language]}</span>
                </span>
                <span className="truncate text-sm text-muted-foreground">
                  {workTitle(score, t)} · {schoolDateText(score.date, language, false)}
                </span>
              </span>
              <span className="text-right tabular-nums" data-score="">
                <span className="block font-bold">
                  {t('portal.grades.outOf', { score: score.score, total: score.total })}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t('portal.grades.percent', { percent: score.percent })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      );
  }
  return (
    <Section id="today-scores" title={t('portal.today.latestScores')} link={link}>
      {body}
    </Section>
  );
}

/**
 * The name of a work, always with its kind: "Classwork · 10-mashq", "Homework · 10-mashq", or
 * "Classwork 1" for a work without a title. A title alone ("10-mashq") does not say whether it
 * was done in class or at home (owner, 19 November 2026); the kind is the server's.
 */
export function workTitle(score: PortalScore, t: TFunction): string {
  if (score.title === null) {
    return t(score.kind === 'classwork' ? 'portal.grades.classworkN' : 'portal.grades.homeworkN', {
      n: score.position,
    });
  }
  return t('portal.grades.kindTitle', {
    kind: t(`portal.grades.kinds.${score.kind}`),
    // Task 11.27 (`09`, Codes: "in the parent portal"): the code first, "code · title".
    title: codedName(score.code, score.title),
  });
}

/**
 * When a score was saved, as the server answers it (the cell's last save); the start of its
 * lesson's day when the server has no moment for it.
 */
const savedOf = (score: PortalScore): number =>
  Date.parse(score.savedAt ?? `${score.date}T00:00:00Z`);

/**
 * The newest scores across the subjects: the last saved first, so a score entered late for an
 * older lesson is among them (review of pull request #356); the lesson date between equals.
 */
function latestScores(
  subjects: readonly PortalSubjectGrades[],
): { subject: PortalSubjectGrades; score: PortalScore }[] {
  return (
    subjects
      // Task 11.26 (`10`, What parents see, Today: "never past marks").
      .flatMap((subject) =>
        subject.scores.filter((score) => !score.past).map((score) => ({ subject, score })),
      )
      .sort(
        (a, b) => savedOf(b.score) - savedOf(a.score) || b.score.date.localeCompare(a.score.date),
      )
      .slice(0, LATEST_SCORES)
  );
}
