import type { JournalExportFormat, JournalExportItem, JournalExportList } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { failureText } from '@/api/failure-text';
import { FailureAlert } from '@/components/failure-alert';
import { SelectField } from '@/components/field';
import { ListPage } from '@/components/list/list-page';
import { listSearch, type Column, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL } from '@/components/ui/control';
import { Segmented } from '@/components/ui/segmented';
import { useView } from '@/features/access/use-view';
import { momentText, monthsText } from '@/lib/dates';
import {
  downloadBranchExport,
  journalExportsQuery,
  journalKey,
  requestBranchExport,
} from './journal-api';

type Row = JournalExportItem;
type Quarter = JournalExportList['quarters'][number];

export const branchExportsSearch = (search: Record<string, unknown>): ListSearch =>
  listSearch(search);

/** The months `YYYY-MM` a quarter has a day in, in order. */
function monthsOf(quarter: Quarter): string[] {
  const months: string[] = [];
  let [year, month] = quarter.startDate.split('-').map(Number) as [number, number];
  const last = quarter.endDate.slice(0, 7);
  for (;;) {
    const value = `${String(year)}-${String(month).padStart(2, '0')}`;
    months.push(value);
    if (value >= last) return months;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}

const monthName = (month: string, language: string) =>
  monthsText(`${month}-01`, `${month}-01`, language);

/**
 * The export of the branch's journals (task 8.9, pull request #227;
 * `edge/system-behaviour`: "A large export is a background job, one per user,
 * taken from one consistent moment and stamped with date and 'provisional' or
 * 'final'. The link works for 24 hours and access is checked again at
 * download"). For the readers of every journal of the branch (decision 3);
 * the server decides who may ask and download.
 */
export function BranchExportsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const navigate = useNavigate();
  const search: ListSearch = useSearch({ from: '/app/journal/exports' });
  const { branchId } = useView();
  const list = useQuery(journalExportsQuery(branchId));
  const breadcrumbs = [
    { label: t('home.title'), to: '/' as const },
    { label: t('journal.page.title'), to: '/journal' as const },
  ];
  const periodOf = useCallback(
    (row: Row) =>
      [
        t('journal.page.quarterNumber', { number: row.quarter.number }),
        ...(row.month === null ? [] : [monthName(row.month, language)]),
      ].join(' · '),
    [t, language],
  );
  const statusOf = useCallback(
    (row: Row) =>
      row.status === 'ready' && row.expiresAt !== null
        ? t('journal.exports.readyUntil', { moment: momentText(language, row.expiresAt) })
        : row.status === 'failed' && row.failure !== null
          ? `${t('journal.exports.statuses.failed')}: ${t(failureKey(row.failure))}`
          : t(`journal.exports.statuses.${row.status}`),
    [t, language],
  );
  const columns = useMemo(
    (): Column<Row>[] => [
      {
        key: 'requested',
        header: t('journal.exports.requested'),
        cell: (row) => momentText(language, row.requestedAt),
        sortValue: (row) => row.requestedAt,
        fixed: true,
      },
      {
        key: 'period',
        header: t('journal.exports.period'),
        cell: periodOf,
        sortValue: periodOf,
        searchText: periodOf,
      },
      {
        key: 'format',
        header: t('journal.exports.format'),
        cell: (row) => t(`journal.exports.formats.${row.format}`),
      },
      {
        key: 'asOf',
        header: t('journal.exports.asOf'),
        cell: (row) => (row.asOf === null ? '—' : momentText(language, row.asOf)),
      },
      {
        key: 'status',
        header: t('journal.exports.status'),
        cell: statusOf,
        sortValue: (row) => row.status,
      },
      {
        key: 'file',
        header: t('journal.exports.file'),
        cell: (row) => (row.status === 'ready' ? <DownloadButton row={row} /> : '—'),
      },
    ],
    [t, language, periodOf, statusOf],
  );
  return (
    <>
      <PageHeader
        title={t('journal.exports.title')}
        breadcrumbs={breadcrumbs}
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              void list.refetch();
            }}
          >
            {t('journal.exports.refresh')}
          </Button>
        }
      />
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data === undefined ? (
        <LoadingOutline />
      ) : !list.data.canExportBranch ? (
        <EmptyState text={t('problems.noAccessPart')} />
      ) : (
        <div className="grid gap-4">
          <RequestForm quarters={list.data.quarters} />
          <ListPage
            listId="journal-exports"
            caption={t('journal.exports.title')}
            rows={list.data.exports}
            rowId={(row) => row.id}
            rowName={periodOf}
            columns={columns}
            search={search}
            onSearchChange={(next, how) => {
              void navigate({ to: '/journal/exports', search: next, replace: how === 'replace' });
            }}
            empty={{ title: t('journal.exports.title'), text: t('journal.exports.empty') }}
          />
        </div>
      )}
    </>
  );
}

/** The text of a failure's code: its error text. */
const failureKey = (code: string) =>
  (
    ({
      journal_export_stale: 'errors.journal_export_stale',
      journal_export_scope: 'errors.journal_export_scope',
    }) as const
  )[code] ?? 'errors.journal_export_failed';

/** The form that asks for an export of the branch: the format, the quarter and a month or none. */
function RequestForm({ quarters }: { quarters: JournalExportList['quarters'] }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { branchId } = useView();
  const [format, setFormat] = useState<JournalExportFormat>('xlsx');
  const [quarterId, setQuarterId] = useState<string>(quarters[0]?.id ?? '');
  const [month, setMonth] = useState<string>('');
  // One key per request asked for, sent again on a retry of the same one.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const quarter = quarters.find((one) => one.id === quarterId) ?? quarters[0];
  const months = quarter === undefined ? [] : monthsOf(quarter);
  const chosenMonth = months.includes(month) ? month : '';
  const ask = useMutation({
    mutationFn: () => {
      if (quarter === undefined) throw new Error('No quarter is dated.');
      return requestBranchExport(
        {
          format,
          quarterId: quarter.id,
          ...(chosenMonth === '' ? {} : { month: chosenMonth }),
        },
        key,
      );
    },
    onSuccess: async () => {
      setKey(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: [...journalKey(branchId), 'exports'] });
    },
  });
  if (quarter === undefined) {
    return <EmptyState text={t('journal.exports.noQuarter')} />;
  }
  return (
    <div className={`${PANEL} grid gap-4`}>
      <div className="flex flex-wrap items-end gap-4">
        <Segmented
          label={t('journal.exports.format')}
          options={[
            { value: 'xlsx', label: t('journal.exports.formats.xlsx') },
            { value: 'pdf', label: t('journal.exports.formats.pdf') },
          ]}
          value={format}
          onChange={(value) => {
            setFormat(value);
          }}
        />
        <div className="w-48">
          <SelectField
            label={t('journal.exports.quarter')}
            value={quarter.id}
            options={quarters.map((one) => ({
              value: one.id,
              label: t('journal.page.quarterNumber', { number: one.number }),
            }))}
            onChange={(event) => {
              setQuarterId(event.target.value);
            }}
          />
        </div>
        <div className="w-56">
          <SelectField
            label={t('journal.exports.month')}
            value={chosenMonth}
            options={[
              { value: '', label: t('journal.exports.wholeQuarter') },
              ...months.map((one) => ({ value: one, label: monthName(one, i18n.language) })),
            ]}
            onChange={(event) => {
              setMonth(event.target.value);
            }}
          />
        </div>
        <Button
          disabled={ask.isPending}
          onClick={() => {
            ask.mutate();
          }}
        >
          {t('journal.exports.ask')}
        </Button>
      </div>
      {ask.isSuccess && <p role="status">{t('journal.exports.asked')}</p>}
      <FailureAlert error={ask.error} />
    </div>
  );
}

/** The download of a ready export; a refusal (expired, access) is shown beside it. */
function DownloadButton({ row }: { row: Row }) {
  const { t } = useTranslation();
  const download = useMutation({ mutationFn: () => downloadBranchExport(row.id) });
  return (
    <span className="grid gap-1">
      <Button
        variant="secondary"
        disabled={download.isPending}
        onClick={() => {
          download.mutate();
        }}
      >
        {t('journal.exports.download')}
      </Button>
      {download.isError && (
        <span className="text-sm text-destructive" role="alert">
          {failureText(t, download.error)}
        </span>
      )}
    </span>
  );
}
