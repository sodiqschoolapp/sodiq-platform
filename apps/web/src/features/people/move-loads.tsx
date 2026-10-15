import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { ErrorState, LoadingOutline } from '@/components/states';
import { SUBSECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { subjectsQuery } from '@/features/setup/subjects-api';
import { schoolDateText } from '@/lib/dates';

/**
 * The teaching load rows that keep a teacher or a subject from moving to
 * another department (`edge/people-roles-accounts`, row 15: "those loads are
 * listed for reassignment first"; task 3.4c, correction 2 of pull request
 * #101): the rows of this branch, each a link to its version's load, and those
 * of other branches as a number only. The subject is named from the subject
 * list, and left out of a line when the list does not hold it.
 */
export function MoveLoads({ error }: { error: unknown }) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const refused = error instanceof ApiFailure && error.code === 'department_move_loads';
  const details = refused ? (error.details ?? []) : [];
  const lines = details.flatMap((detail) => (detail.load === undefined ? [] : [detail.load]));
  const subjects = useQuery({
    ...subjectsQuery(branchId),
    enabled: lines.length > 0 && branchId !== null,
  });
  // A subject the list does not hold reads the list again, once per refusal
  // (`.claude/rules/web.md`: a refusal that names a record by id).
  const missing =
    subjects.data !== undefined &&
    lines.some((line) => !subjects.data.subjects.some((one) => one.id === line.subjectId));
  const reread = useRef<unknown>(null);
  useEffect(() => {
    if (missing && reread.current !== error) {
      reread.current = error;
      void subjects.refetch();
    }
  }, [missing, error, subjects]);
  if (!refused) {
    return null;
  }
  if (subjects.isError) {
    return (
      <ErrorState
        error={subjects.error}
        onRetry={() => {
          void subjects.refetch();
        }}
      />
    );
  }
  if (lines.length > 0 && subjects.data === undefined) {
    return <LoadingOutline lines={1} />;
  }
  const elsewhere = Number(details.find((detail) => detail.path === 'elsewhere')?.code ?? '0');
  const number = new Intl.NumberFormat(i18n.language);
  return (
    <section className="grid gap-1 text-sm" role="status" aria-label={t('people.moveLoads.title')}>
      <h4 className={SUBSECTION_TITLE}>{t('people.moveLoads.title')}</h4>
      {lines.length > 0 && (
        <ul className="grid gap-1">
          {lines.map((line) => {
            const subject = subjects.data?.subjects.find((one) => one.id === line.subjectId);
            const parts = [
              line.unit.name,
              ...(subject === undefined ? [] : [nameOf(subject.names, i18n.language)]),
              ...(line.teacher.name === null
                ? []
                : [
                    line.teacher.vacancy
                      ? t('people.moveLoads.vacancy', { name: line.teacher.name })
                      : line.teacher.name,
                  ]),
            ];
            return (
              <li key={`${line.versionId}-${line.unit.id}-${line.subjectId}`}>
                <Link
                  to="/timetable/load"
                  search={{ version: line.versionId }}
                  className="font-semibold text-link underline-offset-4 hover:underline"
                >
                  {t('people.moveLoads.version', {
                    number: line.versionNumber,
                    date: schoolDateText(line.versionStartsOn, i18n.language),
                  })}
                </Link>
                {t('people.moveLoads.rest', { parts: parts.join(t('people.moveLoads.separator')) })}
              </li>
            );
          })}
        </ul>
      )}
      {elsewhere > 0 && (
        <p>{t('people.moveLoads.elsewhere', { count: elsewhere, n: number.format(elsewhere) })}</p>
      )}
    </section>
  );
}
