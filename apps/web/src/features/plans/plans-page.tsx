import type { PlanList, Role } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField } from '@/components/field';
import { ListPage } from '@/components/list/list-page';
import type { Column, Filter, ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Segmented } from '@/components/ui/segmented';
import { useMayView, useView } from '@/features/access/use-view';
import { yearText } from '@/features/journal/journals-page';
import { nameOf } from '@/features/setup/setup-api';
import { SubjectChip } from '@/features/setup/subject-colour';
import { MasterLinks } from './plan-masters-page';
import { plansQuery } from './plans-api';
import type { PlansSearch } from './plans-search';

type Row = PlanList['plans'][number];

/** Task 7.3, decision 13: who reads the parallel classes (the server decides). */
const PARALLEL_ROLES: readonly Role[] = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'senior_head_teacher',
  'head_teacher',
];

/**
 * The Lesson plans page (task 7.1a, pull request #212; `09`): the plans of
 * the year the role may read, tabs Classes and Groups, with the state of
 * each quarter's plan (`09`: "A plan is complete when every lesson of the
 * quarter has a topic"); a row opens its plan.
 */
export function PlansPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: PlansSearch = useSearch({ from: '/app/plans' });
  const { branchId } = useView();
  const list = useQuery(plansQuery(branchId, search.year ?? null));
  const mayWindows = useMayView('plan_windows');
  const mayDecide = useMayView('plan_requests', 'edit');
  // Task 8.8: the plan reports (decision 1).
  const mayReports = useMayView('plan_reports');
  // Task 7.3: the masters for every reader of them; the parallel classes for the roles that oversee a subject.
  const mayMasters = useMayView('plan_masters');
  const { role } = useView();
  const parallel = role !== null && PARALLEL_ROLES.includes(role);
  const language = i18n.language;
  const tab = search.tab ?? 'class';
  const quarters = useMemo(() => list.data?.quarters ?? [], [list.data]);

  const subjectName = useMemo(() => (row: Row) => nameOf(row.subject.names, language), [language]);

  const columns = useMemo(
    (): Column<Row>[] => [
      {
        key: 'unit',
        header: tab === 'class' ? t('plans.page.class') : t('plans.page.group'),
        cell: (row) => row.unit.name,
        sortValue: (row) => row.unit.name,
        searchText: (row) => `${row.unit.name} ${subjectName(row)}`,
        opens: true,
        fixed: true,
      },
      {
        key: 'subject',
        header: t('plans.page.subject'),
        cell: (row) => <SubjectChip colour={row.subject.colour} name={subjectName(row)} />,
        sortValue: subjectName,
      },
      ...quarters.map((quarter, index): Column<Row> => ({
        key: `quarter${String(quarter.number)}`,
        header: t('plans.page.quarter', { number: quarter.number }),
        cell: (row) => {
          const state = row.quarters[index];
          if (state === undefined) return null;
          const text =
            state.state === 'incomplete'
              ? t('plans.state.incomplete', { count: state.empty })
              : t(`plans.state.${state.state}`);
          // Task 7.2: overdue, window not opened, vacancy.
          const flagged = state.flag === null ? text : `${text} · ${t(`plans.flag.${state.flag}`)}`;
          // Task 7.3: "master updated" (decision 12).
          const updated = state.masterUpdated ? `${flagged} · ${t('plans.updated.mark')}` : flagged;
          // Task 8.8 (decision 11): below the subject's minimum works once the window has ended.
          return state.belowMinimum === null ? updated : `${updated} · ${t('plans.minimum.below')}`;
        },
      })),
    ],
    [t, tab, subjectName, quarters],
  );

  const rows = list.data?.plans.filter((row) => row.unit.kind === tab);

  const filters = useMemo(
    (): Filter<Row>[] => [
      {
        key: 'subject',
        label: t('plans.page.subject'),
        options: [
          ...new Map(
            (list.data?.plans ?? []).map((row) => [row.subject.id, subjectName(row)]),
          ).entries(),
        ]
          .map(([value, label]) => ({ value, label }))
          .sort((a, b) => a.label.localeCompare(b.label, language)),
        matches: (row, value) => row.subject.id === value,
      },
    ],
    [t, list.data, subjectName, language],
  );

  const go = (next: PlansSearch, how: 'push' | 'replace' = 'push'): void => {
    void navigate({ to: '/plans', search: next, replace: how === 'replace' });
  };
  const keep = {
    ...(search.tab === undefined ? {} : { tab: search.tab }),
    ...(search.year === undefined ? {} : { year: search.year }),
  };

  return (
    <>
      <PageHeader
        title={t('plans.page.title')}
        breadcrumbs={[{ label: t('home.title'), to: '/' }]}
        actions={
          <>
            {/* Task 7.2: the windows, and the requests for those who decide them. */}
            {mayWindows && (
              <Link to="/plans/windows" className="text-link">
                {t('plans.windows.title')}
              </Link>
            )}
            {mayReports && (
              <Link to="/plans/reports" className="text-link">
                {t('plans.reports.title')}
              </Link>
            )}
            {mayDecide && (
              <Link to="/plans/requests" className="text-link">
                {t('plans.requests.pageTitle')}
              </Link>
            )}
            {mayMasters && <MasterLinks parallel={parallel} />}
          </>
        }
      />
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <Segmented
            label={t('plans.page.tabs')}
            options={[
              { value: 'class', label: t('plans.page.classes') },
              { value: 'group', label: t('plans.page.groups') },
            ]}
            value={tab}
            onChange={(value) => {
              go({ ...keep, tab: value });
            }}
          />
          {list.data !== undefined && list.data.years.length > 1 && (
            <div className="w-48">
              <SelectField
                label={t('plans.page.year')}
                value={list.data.yearId ?? ''}
                options={list.data.years.map((year) => ({ value: year.id, label: yearText(year) }))}
                onChange={(event) => {
                  go({ tab, year: event.target.value });
                }}
              />
            </div>
          )}
        </div>
        <ListPage
          listId="plans"
          caption={t('plans.page.caption')}
          rows={rows}
          error={list.error ?? undefined}
          onRetry={() => {
            void list.refetch();
          }}
          rowId={(row) => row.journalId}
          rowName={(row) => `${row.unit.name} · ${subjectName(row)}`}
          columns={columns}
          filters={filters}
          search={search}
          onSearchChange={(next: ListSearch, how) => {
            go({ ...keep, ...next }, how);
          }}
          onOpenRow={(row) => {
            void navigate({ to: '/plans/$journalId', params: { journalId: row.journalId } });
          }}
          empty={{ title: t('plans.page.emptyTitle'), text: t('plans.page.empty') }}
        />
      </div>
    </>
  );
}
