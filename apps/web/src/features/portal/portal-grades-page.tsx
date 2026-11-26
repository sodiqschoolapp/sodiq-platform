import type { PortalScore, PortalSubjectGrades } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GRADE_TINT } from '@/components/grade-tint';
import { ExpandMoreIcon, InfoIcon } from '@/components/icons';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { FOCUS_RING, PANEL, QUICK, SECTION_TITLE, SUBSECTION_TITLE } from '@/components/ui/control';
import { Segmented } from '@/components/ui/segmented';
import { labelsOf, outcomeText } from '@/features/results/student-results-tab';
import { SubjectSwatch } from '@/features/setup/subject-colour';
import { schoolDateText } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { portalGradesQuery } from './portal-api';
import { PORTAL_GRADES_VIEWS } from './portal-search';
import { dayText } from './portal-week';
import { languageOf, type Language } from './portal-lessons';
import { PortalTitle } from './portal-shell';
import { workTitle } from './portal-today-page';

/**
 * The Grades page of the portal (task 11.3, pull request #296; `10`, What parents see), in two
 * views (owner, 19 November 2026). "Daily", the first: every score of the quarter chosen, by its
 * lesson date, the newest day first, each with its subject, the work's name, the score and the
 * comment visible to parents. "Quarter": for the quarter chosen, one row per subject with its result and grade, "provisional" until the
 * quarter is closed; a row opens the subject's figures as the staff results page shows them (the
 * same labels, review decision 4), the year result when shown, the rating exam and each score
 * with the work's name, the lesson date and the comment visible to parents. Every figure comes
 * from the server; nothing is calculated here.
 */
export function PortalGradesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = languageOf(i18n.language);
  const { studentId } = useParams({ from: '/portal/$studentId/grades' });
  const { quarter, view = 'daily' } = useSearch({ from: '/portal/$studentId/grades' });
  const navigate = useNavigate({ from: '/portal/$studentId/grades' });
  const grades = useQuery(portalGradesQuery(studentId, quarter));
  const title = <PortalTitle>{t('portal.grades.title')}</PortalTitle>;
  if (grades.isError) {
    return (
      <>
        {title}
        <ErrorState
          error={grades.error}
          onRetry={() => {
            void grades.refetch();
          }}
        />
      </>
    );
  }
  if (grades.data === undefined) {
    return (
      <>
        {title}
        <LoadingOutline lines={6} />
      </>
    );
  }
  const answer = grades.data;
  const shown = answer.quarters.find((one) => one.id === answer.quarterId);
  return (
    <>
      {title}
      {shown === undefined ? (
        <section className={PANEL}>
          <EmptyState text={t('portal.grades.noYear')} />
        </section>
      ) : (
        <>
          <Segmented
            label={t('portal.grades.view')}
            className="w-full [&>label]:flex-1"
            options={PORTAL_GRADES_VIEWS.map((one) => ({
              value: one,
              label: t(`portal.grades.views.${one}`),
            }))}
            value={view}
            onChange={(next) => {
              void navigate({
                // The daily view is the page without `view` in its address.
                search: (old) =>
                  next === 'quarter'
                    ? { ...old, view: next }
                    : old.quarter === undefined
                      ? {}
                      : { quarter: old.quarter },
                replace: true,
              });
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label={t('portal.grades.quarter')}
              options={answer.quarters.map((one) => ({
                value: one.id,
                label: t('results.quarterNumber', { number: one.number }),
              }))}
              value={shown.id}
              onChange={(next) => {
                void navigate({ search: (old) => ({ ...old, quarter: next }) });
              }}
            />
            <p
              className="flex items-center gap-1.5 text-sm text-muted-foreground"
              data-quarter-state={shown.closed ? 'final' : 'provisional'}
            >
              <InfoIcon aria-hidden className="size-4 shrink-0" />
              {shown.closed ? t('portal.grades.final') : t('portal.grades.provisional')}
            </p>
          </div>
          {view === 'daily' ? (
            <DailyScores subjects={answer.subjects} language={language} />
          ) : answer.subjects.length === 0 ? (
            <section className={PANEL}>
              <EmptyState text={t('portal.grades.empty')} />
            </section>
          ) : (
            <section className={cn(PANEL, 'px-0 py-2')} aria-label={t('portal.grades.subjects')}>
              <ul>
                {answer.subjects.map((subject) => (
                  <SubjectRow
                    key={`${shown.id}-${subject.subject.id}`}
                    subject={subject}
                    language={language}
                    reopened={shown.closed && !subject.final}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

/**
 * Every score of the quarter by its lesson date, the newest day first: the parent's "what marks
 * this week" without opening each subject. Within a day, by subject, then by work. The scores are
 * the server's; this only orders them.
 */
function DailyScores({
  subjects,
  language,
}: {
  subjects: readonly PortalSubjectGrades[];
  language: Language;
}): React.JSX.Element {
  const { t } = useTranslation();
  const scores = subjects.flatMap((subject) => subject.scores.map((score) => ({ subject, score })));
  if (scores.length === 0) {
    return (
      <section className={PANEL}>
        <EmptyState text={t('portal.grades.noScores')} />
      </section>
    );
  }
  const days = [...new Set(scores.map(({ score }) => score.date))].sort().reverse();
  return (
    <>
      {days.map((day) => (
        <section
          key={day}
          className={PANEL}
          aria-labelledby={`scores-${day}`}
          data-scores-day={day}
        >
          <h2 id={`scores-${day}`} className={cn(SECTION_TITLE, 'mb-2')}>
            {dayText(day, language)}
          </h2>
          <ul>
            {scores
              .filter(({ score }) => score.date === day)
              .sort(
                (a, b) =>
                  a.subject.subject.names[language].localeCompare(
                    b.subject.subject.names[language],
                    language,
                  ) ||
                  a.score.kind.localeCompare(b.score.kind) ||
                  a.score.position - b.score.position,
              )
              .map(({ subject, score }) => (
                <li
                  key={`${subject.subject.id}-${score.kind}-${String(score.position)}`}
                  className="grid gap-1 border-b border-border py-3 last:border-b-0 last:pb-0"
                  data-score-row=""
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="grid min-w-0 gap-0.5">
                      <span className="flex min-w-0 items-baseline gap-2 font-semibold">
                        <SubjectSwatch colour={subject.subject.colour} />
                        <span className="min-w-0 break-words">
                          {subject.subject.names[language]}
                        </span>
                      </span>
                      <span className="text-sm text-muted-foreground">{workTitle(score, t)}</span>
                    </span>
                    <span className="shrink-0 text-right tabular-nums" data-score="">
                      <span className="block font-bold">
                        {t('portal.grades.outOf', { score: score.score, total: score.total })}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {t('portal.grades.percent', { percent: score.percent })}
                      </span>
                    </span>
                  </span>
                  {score.comment !== null && (
                    <span className="text-sm text-muted-foreground italic">{score.comment}</span>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/**
 * The grade beside a result: "Baho 4", a status label in its tint (This app, Status labels:
 * "always the digit; colour only helps"), named in words so that "71 4" never reads as two
 * numbers (owner, 19 November 2026).
 */
function GradeLabel({ grade }: { grade: number }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-sm font-semibold whitespace-nowrap tabular-nums',
        GRADE_TINT[grade],
      )}
      data-grade={grade}
    >
      {t('portal.grades.gradeLabel', { grade })}
    </span>
  );
}

/** What a subject's row shows at its right: the result and grade, or the outcome in words. */
function RowResult({ subject }: { subject: PortalSubjectGrades }): React.JSX.Element {
  const { t } = useTranslation();
  const figures = subject.figures;
  if (figures === null) {
    // Task 11.26: a subject with past scores only (a quarter "not in the system") has no result.
    return subject.attendanceOnly ? (
      <span className="text-right text-sm text-muted-foreground">
        {t('portal.grades.attendanceOnlyShort')}
      </span>
    ) : (
      <span />
    );
  }
  if (figures.outcome.kind !== 'number') {
    return (
      <span className="text-right text-sm font-semibold" data-result="true">
        {outcomeText(figures.outcome, t)}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2" data-result="true">
      <span className="text-[1.0625rem]/6 font-bold whitespace-nowrap tabular-nums">
        {t('portal.grades.outOf100', { shown: figures.outcome.shown })}
      </span>
      <GradeLabel grade={figures.outcome.grade} />
    </span>
  );
}

/**
 * The row's second line when the result is not the whole story, in the staff page's own terms
 * (`labelsOf`): "from attendance only" while attendance is the one part counted (the flag
 * `attendance_only`), so a low result from attendance alone is read as such. "Provisional" is not
 * repeated here: the line above the list says it for the open quarter, and the opened row gives
 * the staff page's labels.
 */
function RowNote({ subject }: { subject: PortalSubjectGrades }): React.JSX.Element | null {
  const { t } = useTranslation();
  const outcome = subject.figures?.outcome;
  if (outcome?.kind !== 'number') return null;
  if (!outcome.flags.includes('attendance_only')) return null;
  return (
    <span className="text-sm font-normal text-muted-foreground" data-row-note="">
      {t('portal.grades.rowAttendanceOnly')}
    </span>
  );
}

function SubjectRow({
  subject,
  language,
  reopened,
}: {
  subject: PortalSubjectGrades;
  language: Language;
  /** The quarter is closed, but this subject is being corrected under a reopening (9.2c). */
  reopened: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = `subject-${subject.subject.id}`;
  return (
    <li className="border-b border-border last:border-b-0" data-subject-row={subject.subject.id}>
      <h2 className={SECTION_TITLE}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-details`}
          id={id}
          className={cn(
            'flex min-h-14 w-full items-center gap-3 px-6 py-3 text-left hover:bg-accent',
            QUICK,
            FOCUS_RING,
          )}
          onClick={() => {
            setOpen(!open);
          }}
        >
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="flex min-w-0 items-baseline gap-2 font-semibold">
              <SubjectSwatch colour={subject.subject.colour} />
              <span className="min-w-0 break-words">{subject.subject.names[language]}</span>
            </span>
            {reopened ? (
              <span className="text-sm font-normal text-warning" data-subject-state="provisional">
                {t('portal.grades.reopenedShort')}
              </span>
            ) : (
              <RowNote subject={subject} />
            )}
          </span>
          <RowResult subject={subject} />
          <ExpandMoreIcon
            aria-hidden
            className={cn(
              'shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
      </h2>
      {open && (
        <div id={`${id}-details`} className="grid gap-4 px-6 pt-1 pb-5">
          <SubjectDetails subject={subject} language={language} reopened={reopened} />
        </div>
      )}
    </li>
  );
}

function SubjectDetails({
  subject,
  language,
  reopened,
}: {
  subject: PortalSubjectGrades;
  language: Language;
  reopened: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const figures = subject.figures;
  const figure = (label: string, value: number | null, name: string) => (
    <div className="grid rounded-lg bg-muted px-3 py-2" data-figure={name}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-[1.0625rem]/6 font-bold tabular-nums">
        {value === null ? t('results.none') : String(value)}
      </dd>
    </div>
  );
  const labels = figures === null ? [] : labelsOf(figures, t, language);
  return (
    <>
      {reopened && <p className="text-sm">{t('portal.grades.reopened')}</p>}
      {figures === null ? (
        subject.attendanceOnly && (
          <dl className="grid grid-cols-2 gap-2">
            {figure(t('results.columns.attendance'), subject.attendance, 'attendance')}
          </dl>
        )
      ) : (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {figure(t('results.columns.attendance'), figures.attendance, 'attendance')}
          {figure(t('results.columns.classwork'), figures.classwork, 'classwork')}
          {figure(t('results.columns.homework'), figures.homework, 'homework')}
          {figures.ratingShown &&
            figure(t('results.columns.ratingExam'), figures.ratingExam, 'ratingExam')}
        </dl>
      )}
      {labels.length > 0 && <p className="text-sm text-muted-foreground">{labels.join(' · ')}</p>}
      {subject.year !== null && (
        <p className="flex items-center gap-2 font-semibold">
          {subject.year.kind === 'number' ? (
            <>
              {t('portal.grades.yearShown', { shown: subject.year.shown })}
              <GradeLabel grade={subject.year.grade} />
            </>
          ) : (
            t('portal.grades.yearNone')
          )}
        </p>
      )}
      {subject.rating !== null && (
        <p className="text-sm">
          {t('portal.grades.rating', {
            value:
              subject.rating.kind === 'score'
                ? String(subject.rating.score)
                : t(`portal.grades.ratingKinds.${subject.rating.kind}`),
          })}
        </p>
      )}
      {subject.ratingComments.map((text) => (
        <p key={text} className="text-sm italic">
          {text}
        </p>
      ))}
      {!subject.attendanceOnly && (
        <div>
          <h4 className={cn(SUBSECTION_TITLE, 'mb-1')}>{t('portal.grades.scores')}</h4>
          {subject.scores.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('portal.grades.noScores')}</p>
          ) : (
            <ul>
              {subject.scores.map((score) => (
                <ScoreRow
                  key={`${score.date}-${score.kind}-${String(score.position)}`}
                  score={score}
                  language={language}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

function ScoreRow({ score, language }: { score: PortalScore; language: Language }) {
  const { t } = useTranslation();
  return (
    <li className="grid gap-0.5 border-b border-border py-2.5 last:border-b-0">
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className="font-semibold">{workTitle(score, t)}</span>{' '}
          <span className="text-sm text-muted-foreground">
            {schoolDateText(score.date, language, false)}
          </span>
        </span>
        <span className="shrink-0 text-right tabular-nums" data-score="">
          <span className="font-bold">
            {t('portal.grades.outOf', { score: score.score, total: score.total })}
          </span>{' '}
          <span className="text-sm text-muted-foreground">
            {t('portal.grades.percent', { percent: score.percent })}
          </span>
        </span>
      </span>
      {score.comment !== null && (
        <span className="text-sm text-muted-foreground italic">{score.comment}</span>
      )}
    </li>
  );
}
