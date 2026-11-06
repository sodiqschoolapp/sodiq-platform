import type { PortalHomework } from '@sodiq/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { cn } from '@/lib/utils';
import { SubjectSwatch } from '@/features/setup/subject-colour';
import { schoolDateText, weekdayName } from '@/lib/dates';
import { downloadPortalFile, portalHomeworkQuery, weekdayOfDate } from './portal-api';
import { PortalWeekBar } from './portal-week-bar';

type Language = 'uz' | 'ru' | 'en';
const languageOf = (language: string): Language =>
  language === 'ru' || language === 'en' ? language : 'uz';

/**
 * The homework page of the portal (task 11.2; `10`: "Tasks by date and subject, with their
 * titles and files"): the homework given at the held lessons of the week, by the date it was
 * given, each with the lesson's topic, its title (or "HW n" for a work added by hand before
 * 10.6), its text, the day it is checked and the files of the plan item.
 */
export function PortalHomeworkPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = languageOf(i18n.language);
  const { studentId } = useParams({ from: '/portal/$studentId/homework' });
  const { date } = useSearch({ from: '/portal/$studentId/homework' });
  const navigate = useNavigate({ from: '/portal/$studentId/homework' });
  const week = useQuery(portalHomeworkQuery(studentId, date));
  const download = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      downloadPortalFile(studentId, id, name),
  });
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
  const dates = [...new Set(week.data.homework.map((one) => one.givenOn))];
  return (
    <>
      <h1 className="text-[1.75rem]/[2.125rem] font-bold tracking-[-0.01em]">
        {t('portal.homework.title')}
      </h1>
      <PortalWeekBar
        monday={week.data.monday}
        today={week.data.today}
        onDate={(next) => {
          void navigate({ search: next === undefined ? {} : { date: next } });
        }}
      />
      <FailureAlert error={download.error} />
      {dates.length === 0 ? (
        <section className={PANEL}>
          <EmptyState text={t('portal.homework.empty')} />
        </section>
      ) : (
        dates.map((given) => (
          <section key={given} className={PANEL} aria-labelledby={`given-${given}`}>
            <h3 id={`given-${given}`} className={cn(SECTION_TITLE, 'mb-3')}>
              {t('portal.homework.givenOn', {
                date: `${weekdayName(language, weekdayOfDate(given))}, ${schoolDateText(given, language, false)}`,
              })}
            </h3>
            <ul className="grid gap-4">
              {week.data.homework
                .filter((one) => one.givenOn === given)
                // `10`: "Tasks by date and subject".
                .sort(
                  (a, b) =>
                    a.subject.names[language].localeCompare(b.subject.names[language], language) ||
                    a.number - b.number,
                )
                .map((one) => (
                  <HomeworkRow
                    key={`${one.subject.id}-${String(one.number)}-${one.title ?? ''}`}
                    homework={one}
                    language={language}
                    onFile={(id, name) => {
                      download.mutate({ id, name });
                    }}
                  />
                ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

function HomeworkRow({
  homework,
  language,
  onFile,
}: {
  homework: PortalHomework;
  language: Language;
  onFile: (id: string, name: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <li className="grid gap-1">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <SubjectSwatch colour={homework.subject.colour} />
        {homework.subject.names[language]}
        {homework.topic !== null && <> · {homework.topic}</>}
      </span>
      <span className="font-semibold">
        {homework.title ?? t('portal.homework.numbered', { n: homework.number })}
      </span>
      {homework.description !== null && (
        <p className="whitespace-pre-line">{homework.description}</p>
      )}
      {homework.dueOn !== null && (
        <span className="text-sm">
          {t('portal.homework.dueOn', { date: schoolDateText(homework.dueOn, language, false) })}
        </span>
      )}
      {homework.files.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {homework.files.map((file) => (
            <li key={file.id}>
              <button
                type="button"
                className="text-link font-semibold hover:underline"
                onClick={() => {
                  onFile(file.id, file.name);
                }}
              >
                {file.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
