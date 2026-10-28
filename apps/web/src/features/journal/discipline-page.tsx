import type { DisciplineColumn, DisciplineRow } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { DateField, SelectField } from '@/components/field';
import { ListPage } from '@/components/list/list-page';
import { listSearch, type Column, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { PreparedStamp } from '@/components/prepared-stamp';
import { useView } from '@/features/access/use-view';
import { ExcelButton, useDownload } from '@/features/results/report-parts';
import { exportDiscipline } from '@/features/results/reports-api';
import { nameOf } from '@/features/setup/setup-api';
import { DisciplineItemsDialog } from './discipline-items-dialog';
import { disciplineQuery } from './journal-api';

export type DisciplineSearch = ListSearch & { from?: string; to?: string; department?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function disciplineSearch(search: Record<string, unknown>): DisciplineSearch {
  const result: DisciplineSearch = listSearch(search);
  if (typeof search.from === 'string' && DATE.test(search.from)) result.from = search.from;
  if (typeof search.to === 'string' && DATE.test(search.to)) result.to = search.to;
  if (typeof search.department === 'string' && search.department !== '') {
    result.department = search.department;
  }
  return result;
}

/** A date of the browser's calendar `days` from today (or from the Monday of this week). */
const localDate = (days: number, fromMonday = false): string => {
  const at = new Date();
  if (fromMonday) at.setDate(at.getDate() - ((at.getDay() + 6) % 7));
  at.setDate(at.getDate() + days);
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
};

type Count = DisciplineColumn;

const COUNTS: readonly Count[] = [
  'held',
  'notStarted',
  'inProgress',
  'complete',
  'lockedIncomplete',
  'noAttendance',
  'noTopic',
  'worksMissing',
  'unplanned',
  'lateEntries',
];

/**
 * The counts per teacher (task 8.7, pull request #225; `07`, Lesson status:
 * "Head Teachers and the Academic Vice Principal see the same counts per
 * teacher; they feed the journal discipline report"; `08`, Journal
 * discipline: department and date range). The server decides the scope and
 * every count; the range defaults to this week.
 */
export function DisciplinePage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: DisciplineSearch = useSearch({ from: '/app/journal/discipline' });
  const { branchId } = useView();
  // This week by default (plan: "default this week"), Monday to today.
  const from = search.from ?? localDate(0, true);
  const to = search.to ?? localDate(0);
  const range = { from, to, departmentId: search.department ?? null };
  const counts = useQuery(disciplineQuery(branchId, range));
  // Task 9.3b-2: the file of the counts, and the items behind one count.
  const download = useDownload(() => exportDiscipline(range));
  const [opened, setOpened] = useState<{
    teacher: DisciplineRow['teacher'];
    column: Count;
  } | null>(null);
  const go = (next: DisciplineSearch, how: 'push' | 'replace' = 'push') => {
    void navigate({ to: '/journal/discipline', search: next, replace: how === 'replace' });
  };
  const keep = {
    ...(search.from === undefined ? {} : { from: search.from }),
    ...(search.to === undefined ? {} : { to: search.to }),
    ...(search.department === undefined ? {} : { department: search.department }),
  };
  const columns = useMemo(
    (): Column<DisciplineRow>[] => [
      {
        key: 'teacher',
        header: t('journal.discipline.teacher'),
        cell: (row) => row.teacher.name,
        sortValue: (row) => row.teacher.name,
        searchText: (row) => row.teacher.name,
        fixed: true,
      },
      ...COUNTS.map((key): Column<DisciplineRow> => ({
        key,
        header: t(`journal.discipline.${key}`),
        cell: (row) =>
          row[key] === 0 ? (
            0
          ) : (
            <button
              type="button"
              className="text-link tabular-nums"
              aria-label={t('journal.discipline.showItems', {
                column: t(`journal.discipline.${key}`),
              })}
              onClick={() => {
                setOpened({ teacher: row.teacher, column: key });
              }}
            >
              {row[key]}
            </button>
          ),
        sortValue: (row) => row[key],
        numeric: true,
      })),
    ],
    [t],
  );
  return (
    <>
      <PageHeader
        title={t('journal.discipline.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('journal.page.title'), to: '/journal' },
        ]}
        actions={
          <ExcelButton
            area="journal_discipline"
            download={download}
            disabled={counts.data === undefined}
          />
        }
      />
      {opened !== null && (
        <DisciplineItemsDialog
          range={range}
          teacher={opened.teacher}
          column={opened.column}
          onClose={() => {
            setOpened(null);
          }}
        />
      )}
      <div className="grid gap-4">
        {download.isError && <FailureAlert error={download.error} />}
        {counts.data !== undefined && (
          <PreparedStamp
            stamp={counts.data.prepared}
            refreshing={counts.isFetching}
            onRefresh={() => {
              void counts.refetch();
            }}
          />
        )}
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-44">
            <DateField
              label={t('journal.discipline.from')}
              value={from}
              onChange={(event) => {
                go({ ...keep, from: event.target.value });
              }}
            />
          </div>
          <div className="w-44">
            <DateField
              label={t('journal.discipline.to')}
              value={to}
              onChange={(event) => {
                go({ ...keep, to: event.target.value });
              }}
            />
          </div>
          {counts.data !== undefined && counts.data.departments.length > 0 && (
            <div className="w-56">
              <SelectField
                label={t('journal.discipline.department')}
                value={search.department ?? ''}
                options={[
                  { value: '', label: t('journal.discipline.allDepartments') },
                  ...counts.data.departments.map((one) => ({
                    value: one.id,
                    label: nameOf(one.names, i18n.language),
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
        <ListPage
          listId="journal-discipline"
          caption={t('journal.discipline.title')}
          rows={counts.data?.teachers}
          error={counts.isError ? counts.error : undefined}
          onRetry={() => void counts.refetch()}
          rowId={(row) => row.teacher.id}
          rowName={(row) => row.teacher.name}
          columns={columns}
          search={search}
          onSearchChange={(next: ListSearch, how) => {
            go({ ...next, ...keep }, how);
          }}
          empty={{ title: t('journal.discipline.title'), text: t('journal.discipline.empty') }}
        />
      </div>
    </>
  );
}
