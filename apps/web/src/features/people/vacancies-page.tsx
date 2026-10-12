import {
  INSTRUCTION_LANGUAGES,
  PERMISSIONS,
  permits,
  SUBJECT_GRADES,
  VACANCY_STATUSES,
  type VacancyListItem,
  type VacancyRecord,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { ListPage } from '@/components/list/list-page';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useLeave } from '@/components/unsent/unsent-changes';
import { useView } from '@/features/access/use-view';
import { divisionsQuery, nameOf } from '@/features/setup/setup-api';
import { subjectsQuery } from '@/features/setup/subjects-api';
import { invalidateVacancies, vacanciesQuery } from './people-api';
import { PeopleTabs } from './people-tabs';
import { VacancyForm } from './vacancy-form';
import { VacancyPanel } from './vacancy-panel';

/**
 * The vacancies of the branch (`04`, Vacancy: "The teacher list shows
 * vacancies in a section of their own"; task 2.2b), the second section of the
 * teacher list, each opened in the side panel. The Academic Vice Principal and
 * the Super Admin add, edit, close, reopen and delete them; the Principal
 * reads them.
 */
export function VacanciesPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/people/vacancies' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const leave = useLeave();
  const [adding, setAdding] = useState(false);
  const canCreate = role !== null && permits(PERMISSIONS, role, 'vacancies', 'create');
  const vacancies = useQuery(vacanciesQuery(branchId));
  const divisions = useQuery(divisionsQuery(branchId));
  const subjects = useQuery(subjectsQuery(branchId));
  const language = i18n.language;

  const departmentNames = useMemo(
    () =>
      new Map(
        (divisions.data?.divisions ?? [])
          .flatMap((division) => division.departments)
          .map((department) => [department.id, nameOf(department.names, language)] as const),
      ),
    [divisions.data, language],
  );
  const subjectNames = useMemo(
    () =>
      new Map(
        (subjects.data?.subjects ?? []).map(
          (subject) => [subject.id, nameOf(subject.names, language)] as const,
        ),
      ),
    [subjects.data, language],
  );

  const create = useMutation({
    mutationFn: (record: VacancyRecord) =>
      answerOf(
        api.POST('/api/people/vacancies', { params: { header: branchHeader() }, body: record }),
      ),
    onSuccess: async () => {
      setAdding(false);
      await invalidateVacancies(queryClient);
    },
  });

  const columns = useMemo((): Column<VacancyListItem>[] => {
    const grades = (row: VacancyListItem) =>
      [...new Set(row.subjects.flatMap((subject) => subject.grades))].sort((a, b) => a - b);
    const department = (row: VacancyListItem) => departmentNames.get(row.departmentId) ?? '';
    return [
      {
        key: 'name',
        header: t('people.vacancies.name'),
        cell: (row) => row.name,
        sortValue: (row) => row.name,
        searchText: (row) => row.name,
        opens: true,
      },
      {
        key: 'department',
        header: t('people.vacancies.department'),
        cell: department,
        sortValue: department,
      },
      {
        key: 'subjects',
        header: t('people.vacancies.subjects'),
        cell: (row) =>
          row.subjects.map((subject) => subjectNames.get(subject.subjectId) ?? '').join(', '),
      },
      {
        key: 'grades',
        header: t('people.staff.grades'),
        cell: (row) =>
          grades(row)
            .map((grade) => t('setup.subjects.grade', { grade }))
            .join(', '),
      },
      {
        key: 'languages',
        header: t('people.staff.languagesTitle'),
        cell: (row) => row.languages.map((one) => t(`people.staff.languages.${one}`)).join(', '),
      },
      {
        key: 'weeklyLessons',
        header: t('people.staff.weeklyLessons'),
        cell: (row) => (row.weeklyLessons === null ? '' : String(row.weeklyLessons)),
        sortValue: (row) => String(row.weeklyLessons ?? 0).padStart(3, '0'),
      },
      {
        key: 'status',
        header: t('people.vacancies.statusTitle'),
        cell: (row) => t(`people.vacancies.statuses.${row.status}`),
        sortValue: (row) => row.status,
      },
    ];
  }, [t, departmentNames, subjectNames]);

  const filters = useMemo(
    (): Filter<VacancyListItem>[] => [
      {
        key: 'status',
        label: t('people.vacancies.statusTitle'),
        options: VACANCY_STATUSES.map((one) => ({
          value: one,
          label: t(`people.vacancies.statuses.${one}`),
        })),
        matches: (row, value) => row.status === value,
      },
      {
        key: 'department',
        label: t('people.vacancies.department'),
        options: [...departmentNames].map(([id, name]) => ({ value: id, label: name })),
        matches: (row, value) => row.departmentId === value,
      },
      {
        key: 'subject',
        label: t('people.vacancies.subjects'),
        options: [...subjectNames].map(([id, name]) => ({ value: id, label: name })),
        matches: (row, value) => row.subjects.some((subject) => subject.subjectId === value),
      },
      {
        key: 'grade',
        label: t('people.staff.grades'),
        options: SUBJECT_GRADES.map((grade) => ({
          value: String(grade),
          label: t('setup.subjects.grade', { grade }),
        })),
        matches: (row, value) =>
          row.subjects.some((subject) => subject.grades.includes(Number(value))),
      },
      {
        key: 'language',
        label: t('people.staff.languagesTitle'),
        options: INSTRUCTION_LANGUAGES.map((one) => ({
          value: one,
          label: t(`people.staff.languages.${one}`),
        })),
        matches: (row, value) => row.languages.some((one) => one === value),
      },
    ],
    [t, departmentNames, subjectNames],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/people/vacancies', search: next, replace: how === 'replace' });
  };

  const addButton = canCreate && !adding && (
    <Button
      disabled={divisions.data === undefined || subjects.data === undefined}
      onClick={() => {
        setAdding(true);
      }}
    >
      {t('people.vacancies.add')}
    </Button>
  );
  const pending = divisions.data === undefined || subjects.data === undefined;
  const failed = divisions.isError ? divisions : subjects.isError ? subjects : null;

  return (
    <>
      <PageHeader
        title={t('people.vacancies.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('people.title'), to: '/people' },
        ]}
        actions={addButton === false ? undefined : addButton}
      />
      <PeopleTabs current="vacancies" />
      {failed !== null && (
        <ErrorState
          error={failed.error}
          onRetry={() => {
            void failed.refetch();
          }}
        />
      )}
      {adding && divisions.data !== undefined && subjects.data !== undefined && (
        <section
          aria-label={t('people.vacancies.newTitle')}
          className="mb-6 grid max-w-2xl gap-3 rounded-lg border p-4"
        >
          <h2 className="text-lg font-semibold">{t('people.vacancies.newTitle')}</h2>
          <VacancyForm
            vacancy={null}
            divisions={divisions.data}
            subjects={subjects.data.subjects}
            label={t('people.vacancies.newTitle')}
            onSave={async (record) => {
              await create.mutateAsync(record);
            }}
          />
          <div>
            <Button
              variant="ghost"
              onClick={() => {
                void leave.leave().then((leaves) => {
                  if (leaves) {
                    setAdding(false);
                  }
                });
              }}
            >
              {t('people.staff.cancel')}
            </Button>
          </div>
        </section>
      )}
      <ListPage
        listId="vacancies"
        caption={t('people.vacancies.caption')}
        rows={pending ? undefined : vacancies.data?.vacancies}
        error={vacancies.error ?? undefined}
        onRetry={() => {
          void vacancies.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => row.name}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{
          text: t('people.vacancies.empty'),
          action: addButton === false ? undefined : addButton,
        }}
        panel={(row) =>
          // The page shows a failed query of divisions or subjects with a
          // retry; the panel waits for both, so that no name is drawn blank.
          divisions.data === undefined || subjects.data === undefined ? null : (
            <VacancyPanel
              key={row.id}
              id={row.id}
              name={row.name}
              divisions={divisions.data}
              subjects={subjects.data.subjects}
              onDeleted={() => {
                open({ ...search, open: undefined }, 'replace');
              }}
            />
          )
        }
      />
    </>
  );
}
