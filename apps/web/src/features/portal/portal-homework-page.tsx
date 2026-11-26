import type { PortalHomework } from '@sodiq/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { AttachFileIcon } from '@/components/icons';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { SubjectSwatch } from '@/features/setup/subject-colour';
import { cn } from '@/lib/utils';
import { downloadPortalFile, portalHomeworkQuery, weekOf } from './portal-api';
import { languageOf, type Language } from './portal-lessons';
import { PortalTitle } from './portal-shell';
import { WeekNav, dayText } from './portal-week';

/**
 * The homework page of the portal (task 11.2; `10`: "Tasks by date and subject, with their
 * titles and files"): the homework given at the held lessons of the week, by the date it was
 * given, each with the subject and the lesson's topic, its title (or "HW n" for a work added by
 * hand before 10.6), its text, the day it is checked and the files of the plan item.
 */
export function PortalHomeworkPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = languageOf(i18n.language);
  const { studentId } = useParams({ from: '/portal/$studentId/homework' });
  const { date } = useSearch({ from: '/portal/$studentId/homework' });
  const navigate = useNavigate({ from: '/portal/$studentId/homework' });
  const week = useQuery(portalHomeworkQuery(studentId, weekOf(date)));
  const download = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      downloadPortalFile(studentId, id, name),
  });
  const title = <PortalTitle>{t('portal.homework.title')}</PortalTitle>;
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
  const today = week.data.today;
  // The newest day first: a parent looks for what was given last.
  const dates = [...new Set(week.data.homework.map((one) => one.givenOn))].sort().reverse();
  return (
    <>
      {title}
      <WeekNav
        monday={week.data.monday}
        today={today}
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
            <h2 id={`given-${given}`} className={cn(SECTION_TITLE, 'mb-2')}>
              {t('portal.homework.givenOn', { date: dayText(given, language) })}
            </h2>
            <ul>
              {week.data.homework
                .filter((one) => one.givenOn === given)
                // `10`: "Tasks by the date of the lesson where they were given and by subject".
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
                    pending={download.isPending}
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
  pending,
  onFile,
}: {
  homework: PortalHomework;
  language: Language;
  pending: boolean;
  onFile: (id: string, name: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <li className="grid gap-1.5 border-b border-border py-4 first:pt-1 last:border-b-0 last:pb-0">
      <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <SubjectSwatch colour={homework.subject.colour} />
        <span className="truncate">
          {homework.subject.names[language]}
          {homework.topic !== null && <> · {homework.topic}</>}
        </span>
      </span>
      <span className="font-semibold">
        {homework.title ?? t('portal.homework.numbered', { n: homework.number })}
      </span>
      {homework.description !== null && (
        <p className="whitespace-pre-line">{homework.description}</p>
      )}
      {homework.files.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-2">
          {homework.files.map((file) => (
            <li key={file.id} className="min-w-0 max-w-full">
              <Button
                variant="secondary"
                size="sm"
                className="max-w-full"
                disabled={pending}
                onClick={() => {
                  onFile(file.id, file.name);
                }}
              >
                <AttachFileIcon />
                <span className="truncate">{file.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
