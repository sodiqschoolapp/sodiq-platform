import {
  ACADEMIC_YEAR_STATUSES,
  PERMISSIONS,
  permits,
  type AcademicYear,
  type AcademicYearRecord,
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
import { Button } from '@/components/ui/button';
import { useLeave } from '@/components/unsent/unsent-changes';
import { useView } from '@/features/access/use-view';
import { invalidateYears, schoolDateText, yearsQuery } from './setup-api';
import { YearForm, YearPanel } from './year-panel';

const datedCount = (year: AcademicYear): number =>
  year.quarters.filter((quarter) => quarter.startDate !== null).length;

/**
 * The academic years of the branch in use (`03`, Academic year and Quarters;
 * task 1.3), newest first, each opened in the side panel with its quarters.
 * The Super Admin adds years, changes their dates and starts them; the
 * Academic Vice Principal dates the quarters; the Principal reads (owner's
 * answer 3).
 */
export function YearsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/setup/years' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const leave = useLeave();
  const [adding, setAdding] = useState(false);
  const canCreate = role !== null && permits(PERMISSIONS, role, 'academic_years', 'create');
  const canEditYear = role !== null && permits(PERMISSIONS, role, 'academic_years', 'edit');
  const canEditQuarters = role !== null && permits(PERMISSIONS, role, 'quarters', 'edit');
  const years = useQuery(yearsQuery(branchId));
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const language = i18n.language;

  const create = useMutation({
    mutationFn: (record: AcademicYearRecord) =>
      answerOf(
        api.POST('/api/setup/academic-years', {
          params: { header: branchHeader() },
          body: record,
        }),
      ),
    onSuccess: async () => {
      setAdding(false);
      await invalidateYears(queryClient);
    },
  });

  const columns = useMemo(
    (): Column<AcademicYear>[] => [
      {
        key: 'name',
        header: t('setup.years.name'),
        cell: (row) => row.name,
        sortValue: (row) => row.startDate,
        searchText: (row) => row.name,
        opens: true,
      },
      {
        key: 'start',
        header: t('setup.years.startDate'),
        cell: (row) => schoolDateText(row.startDate, language),
        sortValue: (row) => row.startDate,
      },
      {
        key: 'end',
        header: t('setup.years.endDate'),
        cell: (row) => schoolDateText(row.endDate, language),
        sortValue: (row) => row.endDate,
      },
      {
        key: 'status',
        header: t('setup.years.status'),
        cell: (row) => t(`setup.years.${row.status}`),
        sortValue: (row) => ACADEMIC_YEAR_STATUSES.indexOf(row.status),
      },
      {
        key: 'quarters',
        header: t('setup.years.quarters'),
        cell: (row) =>
          t('setup.years.datedQuarters', {
            count: datedCount(row),
            n: number.format(datedCount(row)),
          }),
        sortValue: (row) => datedCount(row),
      },
    ],
    [t, language, number],
  );

  const filters = useMemo(
    (): Filter<AcademicYear>[] => [
      {
        key: 'status',
        label: t('setup.years.status'),
        options: ACADEMIC_YEAR_STATUSES.map((status) => ({
          value: status,
          label: t(`setup.years.${status}`),
        })),
        matches: (row, value) => row.status === value,
      },
    ],
    [t],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/setup/years', search: next, replace: how === 'replace' });
  };

  const addButton = canCreate && !adding && (
    <Button
      onClick={() => {
        setAdding(true);
      }}
    >
      {t('setup.years.add')}
    </Button>
  );

  const all = years.data?.years;

  return (
    <>
      <PageHeader
        title={t('setup.years.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
        actions={addButton === false ? undefined : addButton}
      />
      {adding && (
        <section
          aria-label={t('setup.years.newTitle')}
          className="mb-6 grid max-w-xl gap-3 rounded-lg border p-4"
        >
          <h2 className="text-lg font-semibold">{t('setup.years.newTitle')}</h2>
          <YearForm
            year={null}
            label={t('setup.years.newTitle')}
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
              {t('setup.years.cancel')}
            </Button>
          </div>
        </section>
      )}
      <ListPage
        listId="years"
        caption={t('setup.years.caption')}
        rows={all}
        error={years.error ?? undefined}
        onRetry={() => {
          void years.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => row.name}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{
          text: t('setup.years.empty'),
          action: addButton === false ? undefined : addButton,
        }}
        panel={(row) => (
          <YearPanel
            key={row.id}
            year={row}
            years={all ?? []}
            canEditYear={canEditYear}
            canEditQuarters={canEditQuarters}
          />
        )}
      />
    </>
  );
}
