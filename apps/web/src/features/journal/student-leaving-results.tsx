import { studentLeavingResultsSchema } from '@sodiq/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { ErrorState, LoadingOutline } from '@/components/states';
import { SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { schoolDateText } from '@/lib/dates';

/** The results at leaving of a student (task 8.6), worked out by the server on each read. */
export const studentLeavingResultsQuery = (
  branchId: string | null,
  studentId: string,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: ['journal', branchId, 'leaving-results', studentId],
    queryFn: async () =>
      studentLeavingResultsSchema.parse(
        await answerOf(
          api.GET('/api/people/students/{id}/leaving-results', {
            params: { header: branchHeader(), path: { id: studentId } },
          }),
        ),
      ),
    enabled: branchId !== null && enabled,
  });

/**
 * "Results at leaving" on the student's record (task 8.6; `edge/calculation`: "A
 * 'result at leaving' is stored on the profile: partial, labelled, with the number of
 * lessons"): each subject of the quarter of the last day, with the result, the grade,
 * "based on n of N lessons" and the date. Only for a student who left (`left`); the
 * server leaves out the subjects whose journal the reader does not read whole.
 */
export function StudentLeavingResults({
  studentId,
  left,
}: {
  studentId: string;
  left: boolean;
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const results = useQuery(studentLeavingResultsQuery(branchId, studentId, left));
  const language = i18n.language;
  if (!left) return null;
  const title = <h3 className={SECTION_TITLE}>{t('journal.leavingResults.title')}</h3>;
  if (results.isError) {
    return (
      <section className="grid gap-2">
        {title}
        <ErrorState error={results.error} onRetry={() => void results.refetch()} />
      </section>
    );
  }
  if (results.data === undefined) {
    return (
      <section className="grid gap-2">
        {title}
        <LoadingOutline />
      </section>
    );
  }
  if (results.data.lastDay === null) return null;
  return (
    <section className="grid gap-2" data-leaving-results="true">
      {title}
      {results.data.results.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('journal.leavingResults.empty')}</p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {results.data.results.map((one) => (
            <li key={one.subject.id} data-subject={one.subject.id}>
              <span className="font-semibold">{nameOf(one.subject.names, language)}</span>
              {' · '}
              {t('journal.leavingResults.quarter', { number: one.quarter.number })}
              {' · '}
              {one.outcome.kind === 'number' ? (
                <span data-result={one.outcome.shown}>
                  {t('journal.leavingResults.result', {
                    shown: one.outcome.shown,
                    grade: one.outcome.grade,
                  })}
                  {' · '}
                  {t('journal.grid.basedOn', {
                    expected: one.outcome.basedOn.expected,
                    held: one.outcome.basedOn.held,
                  })}
                </span>
              ) : one.outcome.kind === 'exempt' ? (
                t('journal.grid.exemptResult')
              ) : (
                t('journal.grid.noResult')
              )}
              {' · '}
              {t('journal.leavingResults.lastDay', {
                date: schoolDateText(one.lastDay, language),
              })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
