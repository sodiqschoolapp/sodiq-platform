import type {
  AttendanceFigure,
  AttendanceTodayClass,
  EarlyWarningEntry,
  EarlyWarningList,
} from '@sodiq/shared';
import { timeText } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from 'cn';
import { PreparedStamp } from '@/components/prepared-stamp';
import { ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE, SUBSECTION_TITLE } from '@/components/ui/control';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { closingQuery } from '@/features/results/closing-api';
import { tenthsText } from '@/features/results/rating-page';
import { planRequestsQuery } from '@/features/plans/plans-api';
import { unlocksQuery } from '@/features/journal/unlocks-api';
import { teachingHomeQuery, timetableViewQuery } from '@/features/timetable/timetable-api';
import { schoolDateText } from '@/lib/dates';
import {
  attendanceTodayQuery,
  branchSummaryQuery,
  conflictsSummaryQuery,
  earlyWarningHomeQuery,
  lessonsTodayQuery,
  type EarlyWarningScope,
} from './home-api';
import { useView } from './use-view';

/**
 * The cards of the home pages (task 9.4b; `08`, Home pages by role). Each card reads its own
 * route and keeps its own loading, error and empty state; every figure is the server's.
 */

type Language = 'uz' | 'ru' | 'en';

const languageOf = (language: string): Language =>
  language === 'ru' || language === 'en' ? language : 'uz';

/** The Page title style of docs/design-system.md, with tabular figures. */
const BIG_FIGURE = 'text-[1.75rem]/[2.125rem] font-bold tracking-[-0.01em] tabular-nums';

/** At most this many entries of the early-warning list on a home card. */
const EARLY_WARNING_SHOWN = 5;

function Card({
  title,
  name,
  children,
}: {
  title: string;
  name: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section aria-label={title} className={cn(PANEL, 'grid content-start gap-3')} data-card={name}>
      <h2 className={SECTION_TITLE}>{title}</h2>
      {children}
    </section>
  );
}

/** The loading outline or the failure with a retry of a card's query, else `null`. */
function waiting(query: {
  isError: boolean;
  error: Error | null;
  data: unknown;
  refetch: () => Promise<unknown>;
}): React.JSX.Element | null {
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (query.data === undefined) return <LoadingOutline lines={2} />;
  return null;
}

/** "60% · 3 of 5 marked, 1 unmarked" of a day, a week or the branch. */
function FigureLine({ figure }: { figure: AttendanceFigure }): React.JSX.Element {
  const { t } = useTranslation();
  const parts = [
    figure.percent === null
      ? t('home.attendance.noneMarked')
      : t('home.attendance.figure', {
          percent: figure.percent,
          attended: figure.attended,
          marked: figure.marked,
        }),
    ...(figure.unmarked > 0 ? [t('home.attendance.unmarked', { count: figure.unmarked })] : []),
    ...(figure.exempt > 0 ? [t('home.attendance.exempt', { count: figure.exempt })] : []),
  ];
  return <span className="tabular-nums">{parts.join(' · ')}</span>;
}

const studentName = (student: { lastName: string; firstName: string }): string =>
  [student.lastName, student.firstName].join(' ');

/** The early-warning list of the reader narrowed for a home page (`08`, every row that names it). */
export function EarlyWarningCard({
  scope,
  title,
}: {
  scope: EarlyWarningScope;
  title?: string;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = languageOf(i18n.language);
  const { branchId } = useView();
  const list = useQuery(earlyWarningHomeQuery(branchId, scope));
  const pending = waiting(list);
  return (
    <Card title={title ?? t('home.earlyWarning.title')} name="early-warning">
      {pending ?? <EarlyWarningLines list={list.data} language={language} />}
    </Card>
  );
}

function EarlyWarningLines({
  list,
  language,
}: {
  list: EarlyWarningList | undefined;
  language: Language;
}): React.JSX.Element {
  const { t } = useTranslation();
  const entries = list?.entries ?? [];
  if (entries.length === 0) {
    return <p className="text-muted-foreground">{t('home.earlyWarning.nobody')}</p>;
  }
  const reasonsOf = (entry: EarlyWarningEntry) =>
    entry.reasons.map((reason) => t(`results.earlyWarning.reason.${reason.kind}`)).join(', ');
  return (
    <>
      <ul className="grid gap-1" data-early-warning-lines="">
        {entries.slice(0, EARLY_WARNING_SHOWN).map((entry) => (
          <li key={`${entry.student.id}|${entry.subject.id}`} data-student={entry.student.id}>
            <span className="font-semibold">{studentName(entry.student)}</span>
            {' · '}
            {entry.subject.names[language]}
            {' · '}
            <span className="text-muted-foreground">{reasonsOf(entry)}</span>
          </li>
        ))}
      </ul>
      <Link to="/results/early-warning" className="text-link justify-self-start">
        {entries.length > EARLY_WARNING_SHOWN
          ? t('home.earlyWarning.openMore', { count: entries.length })
          : t('home.earlyWarning.open')}
      </Link>
    </>
  );
}

/**
 * The requests waiting for the reader (`08`, Head Teacher row; `edge/lesson-plans`, "the list is
 * on the Head Teacher's and Academic Vice Principal's home pages"): the plan requests the reader
 * may decide, the late ones counted apart, and with `unlocks` the journal unlock requests.
 */
export function RequestsCard({ unlocks }: { unlocks: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const { branchId } = useView();
  const plans = useQuery(planRequestsQuery(branchId, 'deciding'));
  const opened = useQuery({
    ...unlocksQuery(branchId, 'deciding'),
    enabled: unlocks && branchId !== null,
  });
  const pending = waiting(plans) ?? (unlocks ? waiting(opened) : null);
  const waitingPlans = (plans.data?.requests ?? []).filter((one) => one.canDecide);
  const late = waitingPlans.filter((one) => one.late).length;
  const waitingUnlocks = (opened.data?.requests ?? []).filter((one) => one.canDecide).length;
  return (
    <Card title={t('home.requests.title')} name="requests">
      {pending ?? (
        <ul className="grid gap-1">
          <li data-requests="plans">
            <Link to="/plans/requests" className="text-link">
              {t('home.requests.plans', { count: waitingPlans.length })}
            </Link>
            {late > 0 && (
              <span className="font-semibold text-destructive" data-late="">
                {' · '}
                {t('home.requests.late', { count: late })}
              </span>
            )}
          </li>
          {unlocks && (
            <li data-requests="unlocks">
              <Link to="/journal/unlocks" className="text-link">
                {t('home.requests.unlocks', { count: waitingUnlocks })}
              </Link>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

/** One own class of a Tutor (`08`, Tutor row): today's timetable, absent now, the day and week. */
export function TutorClassCard({
  one,
  date,
}: {
  one: AttendanceTodayClass;
  date: string;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = languageOf(i18n.language);
  const { branchId } = useView();
  const view = useQuery(
    timetableViewQuery(branchId, { kind: 'class', id: one.class.id, date, span: 'day' }),
  );
  const lessons = (view.data?.lessons ?? []).filter((lesson) => lesson.date === date);
  const absent = one.absentNow ?? [];
  return (
    <Card title={t('home.tutorClass.classTitle', { name: one.class.name })} name="tutor-class">
      <dl className="grid gap-1">
        <div>
          <dt className="inline font-semibold">{t('home.attendance.today')}: </dt>
          <dd className="inline" data-figure="day">
            <FigureLine figure={one.day} />
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">{t('home.attendance.week')}: </dt>
          <dd className="inline" data-figure="week">
            <FigureLine figure={one.week} />
          </dd>
        </div>
      </dl>
      <div className="grid gap-1" data-absent-now="">
        <h4 className={SUBSECTION_TITLE}>{t('home.tutorClass.absentNow')}</h4>
        {absent.length === 0 ? (
          <p className="text-muted-foreground">{t('home.tutorClass.nobodyAbsent')}</p>
        ) : (
          <ul className="grid gap-1">
            {absent.map((entry) => (
              <li key={entry.student.id} data-student={entry.student.id}>
                {studentName(entry.student)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid gap-1" data-class-today="">
        <h4 className={SUBSECTION_TITLE}>{t('home.tutorClass.timetable')}</h4>
        {waiting(view) ??
          (lessons.length === 0 ? (
            <p className="text-muted-foreground">{t('home.lessons.noToday')}</p>
          ) : (
            <ul className="grid gap-1">
              {lessons.map((lesson) => (
                <li key={lesson.id} className="tabular-nums">
                  {[
                    t('home.attention.range', {
                      from: timeText(lesson.start),
                      to: timeText(lesson.end),
                    }),
                    lesson.subject.names[language],
                    ...(lesson.cancelCause === null ? [] : [t('home.tutorClass.cancelled')]),
                  ].join(' · ')}
                </li>
              ))}
            </ul>
          ))}
      </div>
    </Card>
  );
}

/** The Tutor's home (`08`, Tutor row): one card per own class, then its early-warning list. */
export function TutorClasses(): React.JSX.Element {
  const { t } = useTranslation();
  const { branchId } = useView();
  const attendance = useQuery(attendanceTodayQuery(branchId));
  const pending = waiting(attendance);
  if (pending !== null) return <section className={PANEL}>{pending}</section>;
  const classes = attendance.data?.classes ?? [];
  if (classes.length === 0) {
    return (
      <section className={PANEL}>
        <p className="text-muted-foreground">{t('home.tutorClass.noClass')}</p>
      </section>
    );
  }
  return (
    <div className="grid gap-6">
      {classes.map((one) => (
        <div key={one.class.id} className="grid gap-6 lg:grid-cols-2">
          <TutorClassCard one={one} date={attendance.data?.date ?? ''} />
          <EarlyWarningCard
            scope={{ kind: 'class', classId: one.class.id }}
            title={t('home.earlyWarning.forClass', { name: one.class.name })}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * The Head Tutor's and the Spiritual Vice Principal's home (`08`: "Attendance of all classes
 * today, classes below a set percent"): the classes below the threshold first, each marked.
 */
export function AttendanceOverview(): React.JSX.Element {
  const { t } = useTranslation();
  const { branchId } = useView();
  const attendance = useQuery(attendanceTodayQuery(branchId));
  const pending = waiting(attendance);
  const data = attendance.data;
  const rows = useMemo(
    () => [...(data?.classes ?? [])].sort((a, b) => Number(b.below) - Number(a.below)),
    [data],
  );
  return (
    <Card title={t('home.attendance.allClasses')} name="attendance-overview">
      {pending ??
        (data === undefined || rows.length === 0 ? (
          <p className="text-muted-foreground">{t('home.attendance.noClasses')}</p>
        ) : (
          <>
            <PreparedStamp
              stamp={data.prepared}
              refreshing={attendance.isFetching}
              onRefresh={() => {
                void attendance.refetch();
              }}
            />
            <p data-total="">
              <span className="font-semibold">{t('home.attendance.branch')}: </span>
              <FigureLine figure={data.total} />
            </p>
            <p className="text-muted-foreground">
              {t('home.attendance.below', {
                count: rows.filter((one) => one.below).length,
                threshold: data.threshold,
              })}
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('home.attendance.class')}</TableHead>
                  <TableHead>{t('home.attendance.today')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((one) => (
                  <TableRow key={one.class.id} data-class={one.class.id} data-below={one.below}>
                    <TableCell className={cn(one.below && 'font-semibold text-destructive')}>
                      {[
                        one.class.name,
                        ...(one.below ? [t('home.attendance.belowMark')] : []),
                      ].join(' · ')}
                    </TableCell>
                    <TableCell>
                      <FigureLine figure={one.day} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ))}
    </Card>
  );
}

/** `08`, Academic Vice Principal: "Lessons today and their status". */
export function LessonsTodayCard(): React.JSX.Element {
  const { t } = useTranslation();
  const { branchId } = useView();
  const today = useQuery(lessonsTodayQuery(branchId));
  const data = today.data;
  return (
    <Card title={t('home.vice.lessonsToday')} name="lessons-today">
      {waiting(today) ??
        (data === undefined ? null : (
          <>
            <p className="font-semibold" data-summary="">
              {t('journal.lessonStatus.summary', { count: data.held, done: data.complete })}
            </p>
            <PreparedStamp
              stamp={data.prepared}
              refreshing={today.isFetching}
              onRefresh={() => {
                void today.refetch();
              }}
            />
            <p className="text-muted-foreground tabular-nums">
              {t('home.vice.statusCounts', {
                notStarted: data.notStarted,
                inProgress: data.inProgress,
                ahead: data.ahead,
              })}
            </p>
            {data.incomplete.length > 0 && (
              <ul className="grid gap-1" data-incomplete="">
                {data.incomplete.slice(0, 8).map((one) => (
                  <li key={one.lesson.id} className="tabular-nums">
                    {timeText(one.lesson.start)} · {one.lesson.unit?.name ?? '—'} ·{' '}
                    {one.teacher?.name ?? t('home.attention.nobody')} ·{' '}
                    {t(`journal.lessonStatus.${one.lesson.status}`)}
                  </li>
                ))}
              </ul>
            )}
          </>
        ))}
    </Card>
  );
}

/** `08`, Academic Vice Principal: "timetable conflicts" (plan decision 6). */
export function ConflictsCard(): React.JSX.Element {
  const { t } = useTranslation();
  const { branchId } = useView();
  const conflicts = useQuery(conflictsSummaryQuery(branchId));
  const data = conflicts.data;
  return (
    <Card title={t('home.vice.conflicts')} name="conflicts">
      {waiting(conflicts) ??
        (data === undefined ? null : (
          <ul className="grid gap-1">
            {data.published !== null && (
              <li data-version={data.published.id}>
                {t('home.vice.published', { number: data.published.number })}
                {': '}
                {t('home.vice.warnings', { count: data.published.warnings })}
              </li>
            )}
            {data.drafts.map((one) => (
              <li key={one.id} data-version={one.id}>
                <Link
                  to="/timetable/builder"
                  search={{ version: one.id, step: 'grid' }}
                  className="text-link"
                >
                  {t('home.vice.draft', { number: one.number })}
                </Link>
                {': '}
                <span className={cn(one.blocked > 0 && 'font-semibold text-destructive')}>
                  {t('home.vice.blocked', { count: one.blocked })}
                </span>
                {', '}
                {t('home.vice.warnings', { count: one.warnings })}
              </li>
            ))}
            {data.published === null && data.drafts.length === 0 && (
              <li className="text-muted-foreground">{t('home.vice.noVersions')}</li>
            )}
          </ul>
        ))}
    </Card>
  );
}

/** `08`, Academic Vice Principal: "quarter progress and the closing checklist" (plan decision 7). */
export function QuarterProgressCard(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = languageOf(i18n.language);
  const { branchId } = useView();
  const closing = useQuery(closingQuery(branchId, null));
  const data = closing.data;
  const quarter = data?.quarters.find((one) => one.id === data.quarterId);
  return (
    <Card title={t('home.vice.quarter')} name="quarter">
      {waiting(closing) ??
        (data === undefined || quarter === undefined ? (
          <p className="text-muted-foreground">{t('home.vice.noQuarter')}</p>
        ) : (
          <>
            <p>
              {t('home.vice.quarterDates', {
                number: quarter.number,
                from: schoolDateText(quarter.startDate, language, false),
                to: schoolDateText(quarter.endDate, language, false),
              })}
            </p>
            {data.schoolDays !== null && (
              <p className="tabular-nums" data-school-days="">
                {t('home.vice.schoolDays', {
                  count: data.schoolDays.passed,
                  total: data.schoolDays.total,
                })}
              </p>
            )}
            <p className="tabular-nums">
              {data.state === 'closed'
                ? t('home.vice.quarterClosed')
                : data.state === 'not_open'
                  ? t('home.vice.checklistOpens', {
                      date:
                        data.opensOn === null ? '—' : schoolDateText(data.opensOn, language, false),
                    })
                  : t('home.vice.checklist', { blocking: data.blocking, warnings: data.warnings })}
            </p>
            <Link to="/results/closing" className="text-link justify-self-start">
              {t('home.vice.openChecklist')}
            </Link>
          </>
        ))}
    </Card>
  );
}

/** `08`, Principal and Super Admin: "Branch summary: students, staff, attendance today, results by grade". */
export function BranchSummary(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const { branchId } = useView();
  const summary = useQuery(branchSummaryQuery(branchId));
  const pending = waiting(summary);
  if (pending !== null) return <section className={PANEL}>{pending}</section>;
  const data = summary.data;
  if (data === undefined) return <></>;
  const tiles: [string, string, string][] = [
    ['students', t('home.summary.students'), number.format(data.students)],
    ['staff', t('home.summary.staff'), number.format(data.staff)],
    [
      'attendance',
      t('home.summary.attendance'),
      data.attendanceToday.percent === null
        ? '—'
        : `${number.format(data.attendanceToday.percent)}%`,
    ],
  ];
  return (
    <div className="grid gap-6">
      <div className="grid gap-6 sm:grid-cols-3">
        {tiles.map(([key, title, value]) => (
          <section key={key} aria-label={title} className={cn(PANEL, 'grid gap-1')} data-tile={key}>
            <h2 className={SECTION_TITLE}>{title}</h2>
            <p className={BIG_FIGURE} data-count="">
              {value}
            </p>
          </section>
        ))}
      </div>
      <Card
        title={
          data.quarter === null
            ? t('home.summary.results')
            : t('home.summary.resultsOf', { number: data.quarter.number })
        }
        name="grades"
      >
        {data.quarter !== null && (
          <p className="text-muted-foreground">
            {data.quarter.closed ? t('home.summary.final') : t('home.summary.provisional')}
          </p>
        )}
        <PreparedStamp
          stamp={data.prepared}
          refreshing={summary.isFetching}
          onRefresh={() => {
            void summary.refetch();
          }}
        />
        {data.grades.length === 0 ? (
          <p className="text-muted-foreground">{t('home.summary.noResults')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('home.summary.grade')}</TableHead>
                <TableHead>{t('home.summary.mean')}</TableHead>
                <TableHead>{t('home.summary.rated')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.grades.map((one) => (
                <TableRow key={one.grade} data-grade={one.grade}>
                  <TableCell>{t('home.summary.gradeName', { grade: one.grade })}</TableCell>
                  <TableCell className="tabular-nums">
                    {tenthsText(one.value, i18n.language)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {t('home.summary.ratedOf', { rated: one.rated, students: one.students })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

/**
 * `08`, Teacher row: "quick entry to each journal": the journals of the reader's own lessons of
 * this week in the branch in use, from the teaching home (build decision: a Head Teacher's
 * Journals page lists the subject's journals, not the own ones).
 */
export function MyJournalsCard(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = languageOf(i18n.language);
  const { branchId } = useView();
  const home = useQuery(teachingHomeQuery(branchId));
  const journals = new Map<string, { unit: string; subject: string }>();
  for (const lesson of home.data?.lessons ?? []) {
    if (lesson.journalId === null || lesson.branch.id !== branchId) continue;
    if (!journals.has(lesson.journalId)) {
      journals.set(lesson.journalId, {
        unit: lesson.unit.name,
        subject: lesson.subject.names[language],
      });
    }
  }
  const rows = [...journals].sort(
    (a, b) => a[1].unit.localeCompare(b[1].unit) || a[1].subject.localeCompare(b[1].subject),
  );
  return (
    <Card title={t('home.journals.title')} name="journals">
      {waiting(home) ??
        (rows.length === 0 ? (
          <p className="text-muted-foreground">{t('home.journals.none')}</p>
        ) : (
          <ul className="grid gap-1">
            {rows.map(([journalId, one]) => (
              <li key={journalId}>
                <Link
                  to="/journal/$journalId"
                  params={{ journalId }}
                  search={{}}
                  className="text-link"
                  data-journal={journalId}
                >
                  {one.unit} · {one.subject}
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </Card>
  );
}
