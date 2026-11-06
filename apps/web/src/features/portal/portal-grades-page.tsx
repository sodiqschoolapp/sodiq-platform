import type { PortalScore, PortalSubjectGrades } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE, SUBSECTION_TITLE } from '@/components/ui/control';
import { Segmented } from '@/components/ui/segmented';
import { labelsOf, outcomeText } from '@/features/results/student-results-tab';
import { SubjectSwatch } from '@/features/setup/subject-colour';
import { schoolDateText } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { portalGradesQuery } from './portal-api';

type Language = 'uz' | 'ru' | 'en';
const languageOf = (language: string): Language =>
  language === 'ru' || language === 'en' ? language : 'uz';

/**
 * The Grades page of the portal (task 11.3, pull request #296; `10`, What parents see): for the
 * quarter chosen, each subject's figures as the staff results page shows them (the same labels,
 * review decision 4), "provisional" until the quarter is closed, the year result when shown, and
 * each score with the work's name, the lesson date and the comment visible to parents. Every
 * figure comes from the server; nothing is calculated here.
 */
export function PortalGradesPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = languageOf(i18n.language);
  const { studentId } = useParams({ from: '/portal/$studentId/grades' });
  const { quarter } = useSearch({ from: '/portal/$studentId/grades' });
  const navigate = useNavigate({ from: '/portal/$studentId/grades' });
  const grades = useQuery(portalGradesQuery(studentId, quarter));
  if (grades.isError) {
    return (
      <ErrorState
        error={grades.error}
        onRetry={() => {
          void grades.refetch();
        }}
      />
    );
  }
  if (grades.data === undefined) return <LoadingOutline lines={6} />;
  const answer = grades.data;
  const shown = answer.quarters.find((one) => one.id === answer.quarterId);
  return (
    <>
      <h1 className="text-[1.75rem]/[2.125rem] font-bold tracking-[-0.01em]">
        {t('portal.grades.title')}
      </h1>
      {shown === undefined ? (
        <section className={PANEL}>
          <EmptyState text={t('portal.grades.noYear')} />
        </section>
      ) : (
        <>
          <Segmented
            label={t('portal.grades.quarter')}
            options={answer.quarters.map((one) => ({
              value: one.id,
              label: t('results.quarterNumber', { number: one.number }),
            }))}
            value={shown.id}
            onChange={(next) => {
              void navigate({ search: { quarter: next } });
            }}
          />
          <p
            className="text-sm font-semibold"
            data-quarter-state={shown.closed ? 'final' : 'provisional'}
          >
            {shown.closed ? t('portal.grades.final') : t('portal.grades.provisional')}
          </p>
          {answer.subjects.length === 0 ? (
            <section className={PANEL}>
              <EmptyState text={t('portal.grades.empty')} />
            </section>
          ) : (
            answer.subjects.map((subject) => (
              <SubjectCard
                key={subject.subject.id}
                subject={subject}
                language={language}
                reopened={shown.closed && !subject.final}
              />
            ))
          )}
        </>
      )}
    </>
  );
}

function SubjectCard({
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
  const titleId = `subject-${subject.subject.id}`;
  const figures = subject.figures;
  const figure = (label: string, value: number | null) => (
    <div className="grid">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value === null ? t('results.none') : String(value)}</dd>
    </div>
  );
  return (
    <section className={PANEL} aria-labelledby={titleId}>
      <h2 id={titleId} className={cn(SECTION_TITLE, 'mb-3 flex items-center gap-2')}>
        <SubjectSwatch colour={subject.subject.colour} />
        {subject.subject.names[language]}
      </h2>
      {reopened && (
        <p className="mb-2 text-sm font-semibold" data-subject-state="provisional">
          {t('portal.grades.reopened')}
        </p>
      )}
      {figures === null ? (
        <dl className="grid grid-cols-2 gap-3">
          {figure(t('results.columns.attendance'), subject.attendance)}
          <div className="grid">
            <dt className="text-sm text-muted-foreground">{t('portal.grades.result')}</dt>
            <dd>{t('portal.grades.attendanceOnly')}</dd>
          </div>
        </dl>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="grid">
              <dt className="text-sm text-muted-foreground">{t('portal.grades.result')}</dt>
              <dd className="text-xl font-bold" data-result="true">
                {figures.outcome.kind === 'number'
                  ? t('portal.grades.resultWithGrade', {
                      result: outcomeText(figures.outcome, t),
                      grade: figures.outcome.grade,
                    })
                  : outcomeText(figures.outcome, t)}
              </dd>
            </div>
            {figure(t('results.columns.attendance'), figures.attendance)}
            {figure(t('results.columns.classwork'), figures.classwork)}
            {figure(t('results.columns.homework'), figures.homework)}
            {figures.ratingShown && figure(t('results.columns.ratingExam'), figures.ratingExam)}
          </dl>
          {labelsOf(figures, t, language).length > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              {labelsOf(figures, t, language).join(' · ')}
            </p>
          )}
        </>
      )}
      {subject.year !== null && (
        <p className="mt-2 font-semibold">
          {subject.year.kind === 'number'
            ? t('portal.grades.year', { shown: subject.year.shown, grade: subject.year.grade })
            : t('portal.grades.yearNone')}
        </p>
      )}
      {subject.rating !== null && (
        <p className="mt-2 text-sm">
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
        <>
          <h4 className={cn(SUBSECTION_TITLE, 'mt-4 mb-2')}>{t('portal.grades.scores')}</h4>
          {subject.scores.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('portal.grades.noScores')}</p>
          ) : (
            <ul className="grid gap-2">
              {subject.scores.map((score) => (
                <ScoreRow
                  key={`${score.date}-${score.kind}-${String(score.position)}`}
                  score={score}
                  language={language}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function ScoreRow({ score, language }: { score: PortalScore; language: Language }) {
  const { t } = useTranslation();
  const title =
    score.title ??
    t(score.kind === 'classwork' ? 'portal.grades.classworkN' : 'portal.grades.homeworkN', {
      n: score.position,
    });
  return (
    <li className="grid gap-0.5 border-b border-border pb-2 last:border-b-0">
      <span className="flex flex-wrap justify-between gap-x-3">
        <span>
          <span className="font-semibold">{title}</span>{' '}
          <span className="text-sm text-muted-foreground">
            {schoolDateText(score.date, language, false)}
          </span>
        </span>
        <span className="font-semibold tabular-nums">
          {t('portal.grades.score', {
            score: score.score,
            total: score.total,
            percent: score.percent,
          })}
        </span>
      </span>
      {score.comment !== null && <span className="text-sm italic">{score.comment}</span>}
    </li>
  );
}
