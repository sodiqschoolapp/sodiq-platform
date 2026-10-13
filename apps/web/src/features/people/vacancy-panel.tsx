import {
  gradeRanges,
  PERMISSIONS,
  permits,
  vacancyDetailSchema,
  type DivisionList,
  type Subject,
  type VacancyDetail,
  type VacancyRecord,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { AvailabilitySection } from './availability-section';
import { invalidateVacancies, vacancyDetailQuery } from './people-api';
import { VacancyForm } from './vacancy-form';
import { schoolDateText } from '@/lib/dates';

/**
 * A vacancy in the side panel of the vacancy list (`04`, Vacancy; task 2.2b):
 * its record, its availability, its status with the history, close and
 * reopen, and the delete of a vacancy that never held a load.
 */
export function VacancyPanel({
  id,
  name,
  divisions,
  subjects,
  onDeleted,
}: {
  id: string;
  name: string;
  divisions: DivisionList;
  subjects: readonly Subject[];
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const detail = useQuery(vacancyDetailQuery(branchId, id));
  const canEdit = role !== null && permits(PERMISSIONS, role, 'vacancies', 'edit');
  const canArchive = role !== null && permits(PERMISSIONS, role, 'vacancies', 'archive');
  const where = () => ({ header: branchHeader(), path: { id } });
  const refresh = async (answer: unknown) => {
    queryClient.setQueryData(
      vacancyDetailQuery(branchId, id).queryKey,
      vacancyDetailSchema.parse(answer),
    );
    await invalidateVacancies(queryClient);
  };
  const edit = useMutation({
    mutationFn: (record: VacancyRecord) =>
      answerOf(api.PUT('/api/people/vacancies/{id}', { params: where(), body: record })),
    onSuccess: refresh,
  });
  const status = useMutation({
    mutationFn: (to: 'close' | 'reopen') =>
      to === 'close'
        ? answerOf(api.POST('/api/people/vacancies/{id}/close', { params: where() }))
        : answerOf(api.POST('/api/people/vacancies/{id}/reopen', { params: where() })),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => answerOf(api.POST('/api/people/vacancies/{id}/delete', { params: where() })),
    onSuccess: async () => {
      onDeleted();
      await invalidateVacancies(queryClient);
    },
  });

  if (detail.isError) {
    return (
      <ErrorState
        error={detail.error}
        onRetry={() => {
          void detail.refetch();
        }}
      />
    );
  }
  if (detail.data === undefined) {
    return <LoadingOutline />;
  }
  const vacancy = detail.data;
  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <h3 className="text-base font-semibold">{t('people.vacancies.recordTitle')}</h3>
        {canEdit ? (
          <VacancyForm
            key={`${vacancy.id}-record`}
            vacancy={vacancy}
            divisions={divisions}
            subjects={subjects}
            label={name}
            onSave={async (record) => {
              await edit.mutateAsync(record);
            }}
          />
        ) : (
          <Overview vacancy={vacancy} divisions={divisions} subjects={subjects} />
        )}
      </section>
      <AvailabilitySection id={vacancy.id} label={name} />
      <section className="grid gap-3">
        <h3 className="text-base font-semibold">{t('people.vacancies.statusTitle')}</h3>
        <p className="text-sm">{t(`people.vacancies.statuses.${vacancy.status}`)}</p>
        <History vacancy={vacancy} />
        {canArchive && (
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={status.isPending}
              onClick={() => {
                status.mutate(vacancy.status === 'open' ? 'close' : 'reopen');
              }}
            >
              {vacancy.status === 'open'
                ? t('people.vacancies.close')
                : t('people.vacancies.reopen')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() => {
                void confirm({
                  title: t('people.vacancies.deleteTitle'),
                  text: t('people.vacancies.deleteText'),
                  names: [name],
                  action: t('people.vacancies.delete'),
                  destructive: true,
                }).then((go) => {
                  if (go) {
                    remove.mutate();
                  }
                });
              }}
            >
              {t('people.vacancies.delete')}
            </Button>
          </div>
        )}
        <FailureAlert error={status.error ?? remove.error} />
      </section>
    </div>
  );
}

/** The record as a role that only views it sees it. */
function Overview({
  vacancy,
  divisions,
  subjects,
}: {
  vacancy: VacancyDetail;
  divisions: DivisionList;
  subjects: readonly Subject[];
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const department = divisions.divisions
    .flatMap((division) => division.departments)
    .find((one) => one.id === vacancy.departmentId);
  const subjectName = (subjectId: string) => {
    const found = subjects.find((subject) => subject.id === subjectId);
    return found === undefined ? '' : nameOf(found.names, language);
  };
  const rows: [string, string][] = [
    [
      t('people.vacancies.department'),
      department === undefined ? '' : nameOf(department.names, language),
    ],
    [
      t('people.vacancies.subjects'),
      vacancy.subjects.length === 0
        ? t('people.staff.none')
        : vacancy.subjects
            .map(
              (own) =>
                `${subjectName(own.subjectId)} (${gradeRanges(own.grades)})`,
            )
            .join('; '),
    ],
    [
      t('people.staff.languagesTitle'),
      vacancy.languages.length === 0
        ? t('people.staff.none')
        : vacancy.languages.map((one) => t(`people.staff.languages.${one}`)).join(', '),
    ],
    [
      t('people.staff.weeklyLessons'),
      vacancy.weeklyLessons === null ? t('people.staff.notSet') : String(vacancy.weeklyLessons),
    ],
    [
      t('people.staff.dailyLessons'),
      vacancy.dailyLessons === null ? t('people.staff.notSet') : String(vacancy.dailyLessons),
    ],
  ];
  return (
    <dl className="grid gap-2 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="grid gap-0.5">
          <dt className="text-muted-foreground">{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function History({ vacancy }: { vacancy: VacancyDetail }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const rows = vacancy.statuses.filter((row) => row.until !== row.from);
  return (
    <table className="text-sm">
      <caption className="sr-only">{t('people.staff.historyTitle')}</caption>
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1 pr-3 font-normal">
            {t('people.staff.statusColumn')}
          </th>
          <th scope="col" className="py-1 pr-3 font-normal">
            {t('people.staff.from')}
          </th>
          <th scope="col" className="py-1 font-normal">
            {t('people.staff.until')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className="py-1 pr-3">{t(`people.vacancies.statuses.${row.status}`)}</td>
            <td className="py-1 pr-3">{schoolDateText(row.from, language)}</td>
            <td className="py-1">
              {row.until === null ? '' : schoolDateText(row.until, language)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
