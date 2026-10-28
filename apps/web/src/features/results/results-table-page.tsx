import type { ResultsTable } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { SelectField } from '@/components/field';
import { ListPage } from '@/components/list/list-page';
import { listSearch, type Column, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { PreparedStamp } from '@/components/prepared-stamp';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { ExcelButton, textOf, useDownload } from './report-parts';
import { exportResultsReport, resultsReportChoicesQuery, resultsTableQuery } from './reports-api';

export interface ResultsTableSearch extends ListSearch {
  quarter?: string;
  class?: string;
}

export function resultsTableSearch(search: Record<string, unknown>): ResultsTableSearch {
  const result: ResultsTableSearch = listSearch(search);
  for (const key of ['quarter', 'class'] as const) {
    const value = textOf(search[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

type Row = ResultsTable['rows'][number];

const studentName = (student: Row['student']): string =>
  [student.lastName, student.firstName, student.paternalName ?? ''].join(' ').trim();

/**
 * The results table (task 9.3b-2; `08`, Analytics, "Each student against each subject for a
 * quarter, with result and grade"): the subjects the reader may read as columns, the result shown
 * and its grade, or the state of a result that is not a number (`edge/00-definitions`).
 */
export function ResultsTablePage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: ResultsTableSearch = useSearch({ from: '/app/results/table' });
  const { branchId } = useView();
  const choices = useQuery(resultsReportChoicesQuery(branchId));
  const quarters = choices.data?.quarters ?? [];
  const classes = choices.data?.classes ?? [];
  // A choice of the address that is no longer offered falls back to the latest quarter, the first class.
  const quarter = quarters.find((one) => one.id === search.quarter) ?? quarters.at(-1);
  const chosen = classes.find((one) => one.id === search.class) ?? classes[0];
  const table = useQuery(resultsTableQuery(branchId, quarter?.id, chosen?.id));
  const download = useDownload(() =>
    quarter === undefined || chosen === undefined
      ? Promise.resolve()
      : exportResultsReport({ kind: 'table', quarterId: quarter.id, classId: chosen.id }),
  );
  const keep: ResultsTableSearch = {
    ...(search.quarter === undefined ? {} : { quarter: search.quarter }),
    ...(search.class === undefined ? {} : { class: search.class }),
  };
  const go = (next: ResultsTableSearch, how: 'push' | 'replace' = 'push') => {
    void navigate({ to: '/results/table', search: next, replace: how === 'replace' });
  };
  const subjects = table.data?.subjects;
  const columns = useMemo((): Column<Row>[] => {
    return [
      {
        key: 'student',
        header: t('results.reports.table.student'),
        cell: (row) => studentName(row.student),
        sortValue: (row) => studentName(row.student),
        searchText: (row) => studentName(row.student),
        fixed: true,
      },
      ...(subjects ?? []).map((subject, index): Column<Row> => ({
        key: subject.id,
        header: nameOf(subject.names, i18n.language),
        cell: (row) => {
          const one = row.results[index];
          if (one === undefined) return '—';
          return one.state === 'number' ? (
            <span data-result={one.value ?? ''}>
              {t('results.reports.table.result', {
                value: String(one.value ?? ''),
                grade: String(one.grade ?? ''),
              })}
            </span>
          ) : (
            <span data-state={one.state}>{t(`results.reports.table.states.${one.state}`)}</span>
          );
        },
        sortValue: (row) => row.results[index]?.value ?? null,
        numeric: true,
      })),
    ];
  }, [t, i18n.language, subjects]);
  let content: React.ReactNode;
  if (choices.isError) {
    content = <ErrorState error={choices.error} onRetry={() => void choices.refetch()} />;
  } else if (choices.data === undefined) {
    content = <LoadingOutline />;
  } else if (quarter === undefined || chosen === undefined) {
    content = (
      <EmptyState
        title={t('results.reports.links.table')}
        text={t('results.reports.table.nothing')}
      />
    );
  } else {
    content = (
      <ListPage
        listId="results-table"
        caption={t('results.reports.links.table')}
        rows={table.data?.rows}
        error={table.isError ? table.error : undefined}
        onRetry={() => void table.refetch()}
        rowId={(row) => row.student.id}
        rowName={(row) => studentName(row.student)}
        columns={columns}
        search={search}
        onSearchChange={(next: ListSearch, how) => {
          go({ ...next, ...keep }, how);
        }}
        empty={{
          title: t('results.reports.links.table'),
          text: t('results.reports.table.empty'),
        }}
      />
    );
  }
  return (
    <>
      <PageHeader
        title={t('results.reports.links.table')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('results.reports.title'), to: '/results/reports' },
        ]}
        actions={
          <ExcelButton
            area="results_reports"
            download={download}
            disabled={table.data === undefined}
          />
        }
      />
      <div className="grid gap-4">
        {download.isError && <FailureAlert error={download.error} />}
        {table.data !== undefined && (
          <PreparedStamp
            stamp={table.data.prepared}
            refreshing={table.isFetching}
            onRefresh={() => {
              void table.refetch();
            }}
          />
        )}
        {table.data?.provisional === true && (
          <p className="text-muted-foreground">{t('results.reports.provisional')}</p>
        )}
        {quarter !== undefined && chosen !== undefined && (
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-40">
              <SelectField
                label={t('results.reports.quarter')}
                value={quarter.id}
                options={quarters.map((one) => ({
                  value: one.id,
                  label: t('results.reports.quarterNumber', { number: one.number }),
                }))}
                onChange={(event) => {
                  go({ ...keep, quarter: event.target.value });
                }}
              />
            </div>
            <div className="w-44">
              <SelectField
                label={t('results.reports.table.class')}
                value={chosen.id}
                options={classes.map((one) => ({ value: one.id, label: one.name }))}
                onChange={(event) => {
                  go({ ...keep, class: event.target.value });
                }}
              />
            </div>
          </div>
        )}
        {content}
      </div>
    </>
  );
}
