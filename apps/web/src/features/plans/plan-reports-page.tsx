import type { PlanCompleteness, PlanProgress, PlanRequestsReport } from '@sodiq/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { SelectField } from '@/components/field';
import { DownloadIcon } from '@/components/icons';
import { ListPage } from '@/components/list/list-page';
import { listSearch, type Column, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { PANEL } from '@/components/ui/control';
import { Segmented } from '@/components/ui/segmented';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { schoolDateText } from '@/lib/dates';
import {
  exportPlanReport,
  planCompletenessQuery,
  planProgressQuery,
  planRequestsReportQuery,
  type PlanReportFilters,
} from './plans-api';

type Report = 'completeness' | 'progress' | 'requests';
type Part = 'teachers' | 'plans';

export interface PlanReportsSearch extends ListSearch {
  report?: Report;
  part?: Part;
  quarter?: string;
  department?: string;
}

export function planReportsSearch(search: Record<string, unknown>): PlanReportsSearch {
  const result: PlanReportsSearch = listSearch(search);
  if (
    search.report === 'completeness' ||
    search.report === 'progress' ||
    search.report === 'requests'
  ) {
    result.report = search.report;
  }
  if (search.part === 'teachers' || search.part === 'plans') result.part = search.part;
  if (typeof search.quarter === 'string' && search.quarter !== '') result.quarter = search.quarter;
  if (typeof search.department === 'string' && search.department !== '') {
    result.department = search.department;
  }
  return result;
}

type CompletenessTeacher = PlanCompleteness['teachers'][number];
type CompletenessPlan = PlanCompleteness['plans'][number];
type ProgressPlan = PlanProgress['plans'][number];
type ProgressTeacher = PlanProgress['teachers'][number];
type RequestRow = PlanRequestsReport['teachers'][number]['requests'][number] & {
  teacher: string;
};

/**
 * The plan reports (task 8.8, pull request #226; `09`, Reports): completeness
 * per teacher and per plan, progress per plan with each teacher's share of
 * "not held", and the edit requests per teacher. The server decides the scope
 * (own subjects for a Head Teacher) and every count and percent.
 */
export function PlanReportsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const navigate = useNavigate();
  const search: PlanReportsSearch = useSearch({ from: '/app/plans/reports' });
  const { branchId } = useView();
  const report: Report = search.report ?? 'completeness';
  const part: Part = search.part ?? 'teachers';
  const filters: PlanReportFilters = {
    quarterId: search.quarter,
    departmentId: search.department,
  };
  const completeness = useQuery({
    ...planCompletenessQuery(branchId, filters),
    enabled: branchId !== null && report === 'completeness',
  });
  const progress = useQuery({
    ...planProgressQuery(branchId, filters),
    enabled: branchId !== null && report === 'progress',
  });
  const requests = useQuery({
    ...planRequestsReportQuery(branchId, filters),
    enabled: branchId !== null && report === 'requests',
  });
  const shown =
    report === 'completeness' ? completeness : report === 'progress' ? progress : requests;
  const download = useMutation({ mutationFn: () => exportPlanReport(report, filters) });
  const keep = {
    ...(search.report === undefined ? {} : { report: search.report }),
    ...(search.part === undefined ? {} : { part: search.part }),
    ...(search.quarter === undefined ? {} : { quarter: search.quarter }),
    ...(search.department === undefined ? {} : { department: search.department }),
  };
  const go = (next: PlanReportsSearch, how: 'push' | 'replace' = 'push') => {
    void navigate({ to: '/plans/reports', search: next, replace: how === 'replace' });
  };
  const data = shown.data;
  const teacherName = (teacher: { name: string } | null) =>
    teacher === null ? t('plans.reports.noTeacher') : teacher.name;
  const percent = (value: number | null) => (value === null ? '—' : `${String(value)}%`);

  const completenessTeachers = useMemo(
    (): Column<CompletenessTeacher>[] => [
      {
        key: 'teacher',
        header: t('plans.reports.teacher'),
        cell: (row) => teacherName(row.teacher),
        sortValue: (row) => row.teacher?.name ?? '',
        searchText: (row) => row.teacher?.name ?? '',
        fixed: true,
      },
      ...(
        [
          'plans',
          'complete',
          'incomplete',
          'noTopic',
          'notStarted',
          'overdue',
          'windowNotOpened',
          'belowMinimum',
        ] as const
      ).map((key): Column<CompletenessTeacher> => ({
        key,
        header: t(`plans.reports.counts.${key}`),
        cell: (row) => row.counts[key],
        sortValue: (row) => row.counts[key],
        numeric: true,
      })),
      {
        key: 'percentComplete',
        header: t('plans.reports.counts.percentComplete'),
        cell: (row) => percent(row.counts.percentComplete),
        sortValue: (row) => row.counts.percentComplete ?? -1,
        numeric: true,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers read `t` only
    [t],
  );
  const completenessPlans = useMemo(
    (): Column<CompletenessPlan>[] => [
      {
        key: 'unit',
        header: t('plans.reports.unit'),
        cell: (row) => row.unit.name,
        sortValue: (row) => row.unit.name,
        searchText: (row) => `${row.unit.name} ${row.teacher?.name ?? ''}`,
        fixed: true,
      },
      {
        key: 'subject',
        header: t('plans.page.subject'),
        cell: (row) => nameOf(row.subject.names, language),
        sortValue: (row) => nameOf(row.subject.names, language),
      },
      {
        key: 'teacher',
        header: t('plans.reports.teacher'),
        cell: (row) => teacherName(row.teacher),
        sortValue: (row) => row.teacher?.name ?? '',
      },
      {
        key: 'state',
        header: t('plans.reports.state'),
        cell: (row) =>
          row.state === 'incomplete'
            ? t('plans.state.incomplete', { count: row.empty })
            : t(`plans.state.${row.state}`),
        sortValue: (row) => row.state,
      },
      {
        key: 'flag',
        header: t('plans.reports.flag'),
        cell: (row) =>
          [
            row.flag === null ? '' : t(`plans.flag.${row.flag}`),
            row.belowMinimum === null ? '' : t('plans.minimum.below'),
          ]
            .filter((one) => one !== '')
            .join(' · '),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers read `t` only
    [t, language],
  );
  const progressPlans = useMemo(
    (): Column<ProgressPlan>[] => [
      {
        key: 'unit',
        header: t('plans.reports.unit'),
        cell: (row) => row.unit.name,
        sortValue: (row) => row.unit.name,
        searchText: (row) => `${row.unit.name} ${row.teacher?.name ?? ''}`,
        fixed: true,
      },
      {
        key: 'subject',
        header: t('plans.page.subject'),
        cell: (row) => nameOf(row.subject.names, language),
        sortValue: (row) => nameOf(row.subject.names, language),
      },
      {
        key: 'teacher',
        header: t('plans.reports.teacher'),
        cell: (row) => teacherName(row.teacher),
        sortValue: (row) => row.teacher?.name ?? '',
      },
      ...(['planned', 'held', 'delivered', 'notCovered'] as const).map(
        (key): Column<ProgressPlan> => ({
          key,
          header: t(`plans.reports.progress.${key}`),
          cell: (row) => row[key],
          sortValue: (row) => row[key],
          numeric: true,
        }),
      ),
      {
        key: 'behind',
        header: t('plans.reports.progress.behind'),
        cell: (row) => (row.behind ? t('plans.reports.progress.behindYes') : ''),
        sortValue: (row) => Number(row.behind),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers read `t` only
    [t, language],
  );
  const progressTeachers = useMemo(
    (): Column<ProgressTeacher>[] => [
      {
        key: 'teacher',
        header: t('plans.reports.teacher'),
        cell: (row) => teacherName(row.teacher),
        sortValue: (row) => row.teacher?.name ?? '',
        searchText: (row) => row.teacher?.name ?? '',
        fixed: true,
      },
      {
        key: 'plannedWorks',
        header: t('plans.reports.progress.plannedWorks'),
        cell: (row) => row.plannedWorks,
        sortValue: (row) => row.plannedWorks,
        numeric: true,
      },
      {
        key: 'notHeld',
        header: t('plans.reports.progress.notHeld'),
        cell: (row) => row.notHeld,
        sortValue: (row) => row.notHeld,
        numeric: true,
      },
      {
        key: 'percentNotHeld',
        header: t('plans.reports.progress.percentNotHeld'),
        cell: (row) => percent(row.percentNotHeld),
        sortValue: (row) => row.percentNotHeld ?? -1,
        numeric: true,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers read `t` only
    [t],
  );
  const requestColumns = useMemo(
    (): Column<RequestRow>[] => [
      {
        key: 'teacher',
        header: t('plans.reports.teacher'),
        cell: (row) => row.teacher,
        sortValue: (row) => row.teacher,
        searchText: (row) => `${row.teacher} ${row.unit.name}`,
        fixed: true,
      },
      {
        key: 'unit',
        header: t('plans.reports.unit'),
        cell: (row) => `${row.unit.name} · ${nameOf(row.subject.names, language)}`,
        sortValue: (row) => row.unit.name,
      },
      {
        key: 'kind',
        header: t('plans.reports.requests.kind'),
        cell: (row) => t(`plans.reports.requests.kinds.${row.kind}`),
        sortValue: (row) => row.kind,
      },
      {
        key: 'status',
        header: t('plans.reports.requests.status'),
        cell: (row) => t(`plans.reports.requests.statuses.${row.status}`),
        sortValue: (row) => row.status,
      },
      {
        key: 'decidedBy',
        header: t('plans.reports.requests.decidedBy'),
        cell: (row) =>
          row.decidedBy === null
            ? ''
            : row.decidedOn === null
              ? row.decidedBy
              : t('plans.reports.requests.decidedOn', {
                  name: row.decidedBy,
                  date: schoolDateText(row.decidedOn, language),
                }),
      },
      {
        key: 'changes',
        header: t('plans.reports.requests.changes'),
        cell: (row) =>
          row.changes.length === 0
            ? '—'
            : row.changes
                .map((change) =>
                  change.topicAfter === null
                    ? t('plans.reports.requests.changeOn', {
                        date: schoolDateText(change.on, language),
                      })
                    : t('plans.reports.requests.topicChange', {
                        date: schoolDateText(change.on, language),
                        before: change.topicBefore ?? '—',
                        after: change.topicAfter,
                      }),
                )
                .join('; '),
      },
    ],
    [t, language],
  );

  const quarters = data?.quarters ?? [];
  const departments = data?.departments ?? [];
  const list = (() => {
    const common = {
      search,
      onSearchChange: (next: ListSearch, how?: 'push' | 'replace') => {
        go({ ...next, ...keep }, how);
      },
      error: shown.isError ? shown.error : undefined,
      onRetry: () => void shown.refetch(),
      empty: { title: t('plans.reports.title'), text: t('plans.reports.empty') },
    };
    if (report === 'completeness') {
      return part === 'teachers' ? (
        <ListPage
          {...common}
          listId="plan-completeness-teachers"
          caption={t('plans.reports.completeness')}
          rows={completeness.data?.teachers}
          rowId={(row) => row.teacher?.id ?? 'none'}
          rowName={(row) => teacherName(row.teacher)}
          columns={completenessTeachers}
        />
      ) : (
        <ListPage
          {...common}
          listId="plan-completeness-plans"
          caption={t('plans.reports.completeness')}
          rows={completeness.data?.plans}
          rowId={(row) => row.journalId}
          rowName={(row) => row.unit.name}
          columns={completenessPlans}
        />
      );
    }
    if (report === 'progress') {
      return part === 'teachers' ? (
        <ListPage
          {...common}
          listId="plan-progress-teachers"
          caption={t('plans.reports.progressTitle')}
          rows={progress.data?.teachers}
          rowId={(row) => row.teacher?.id ?? 'none'}
          rowName={(row) => teacherName(row.teacher)}
          columns={progressTeachers}
        />
      ) : (
        <ListPage
          {...common}
          listId="plan-progress-plans"
          caption={t('plans.reports.progressTitle')}
          rows={progress.data?.plans}
          rowId={(row) => row.journalId}
          rowName={(row) => row.unit.name}
          columns={progressPlans}
        />
      );
    }
    return (
      <ListPage
        {...common}
        listId="plan-requests-report"
        caption={t('plans.reports.requestsTitle')}
        rows={requests.data?.teachers.flatMap((teacher) =>
          teacher.requests.map((one) => ({ ...one, teacher: teacherName(teacher.teacher) })),
        )}
        rowId={(row) => row.id}
        rowName={(row) => row.unit.name}
        columns={requestColumns}
      />
    );
  })();

  return (
    <>
      <PageHeader
        title={t('plans.reports.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('plans.page.title'), to: '/plans' },
        ]}
        actions={
          <Button
            variant="secondary"
            disabled={download.isPending || data === undefined}
            onClick={() => {
              download.mutate();
            }}
          >
            <DownloadIcon />
            {t('plans.reports.excel')}
          </Button>
        }
      />
      <div className="grid gap-4">
        {download.isError && <FailureAlert error={download.error} />}
        <div className="flex flex-wrap items-end gap-4">
          <Segmented
            label={t('plans.reports.report')}
            options={[
              { value: 'completeness', label: t('plans.reports.completeness') },
              { value: 'progress', label: t('plans.reports.progressTitle') },
              { value: 'requests', label: t('plans.reports.requestsTitle') },
            ]}
            value={report}
            onChange={(value) => {
              go({ ...keep, report: value });
            }}
          />
          {report !== 'requests' && (
            <Segmented
              label={t('plans.reports.part')}
              options={[
                { value: 'teachers', label: t('plans.reports.byTeacher') },
                { value: 'plans', label: t('plans.reports.byPlan') },
              ]}
              value={part}
              onChange={(value) => {
                go({ ...keep, part: value });
              }}
            />
          )}
          {quarters.length > 0 && (
            <div className="w-44">
              <SelectField
                label={t('plans.reports.quarter')}
                value={search.quarter ?? data?.quarterId ?? ''}
                options={quarters.map((one) => ({
                  value: one.id,
                  label: t('plans.page.quarter', { number: one.number }),
                }))}
                onChange={(event) => {
                  go({ ...keep, quarter: event.target.value });
                }}
              />
            </div>
          )}
          {departments.length > 0 && (
            <div className="w-56">
              <SelectField
                label={t('plans.reports.department')}
                value={search.department ?? ''}
                options={[
                  { value: '', label: t('plans.reports.allDepartments') },
                  ...departments.map((one) => ({
                    value: one.id,
                    label: nameOf(one.names, language),
                  })),
                ]}
                onChange={(event) => {
                  const { department: _dropped, ...rest } = keep;
                  void _dropped;
                  go(
                    event.target.value === '' ? rest : { ...rest, department: event.target.value },
                  );
                }}
              />
            </div>
          )}
        </div>
        {report === 'completeness' && completeness.data !== undefined && (
          <p className={`${PANEL} text-sm`} data-branch-counts="true">
            {t('plans.reports.branchCounts', {
              plans: completeness.data.branch.plans,
              complete: completeness.data.branch.complete,
              percent: percent(completeness.data.branch.percentComplete),
            })}
          </p>
        )}
        {list}
      </div>
    </>
  );
}
