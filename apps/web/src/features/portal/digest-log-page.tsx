import {
  DIGEST_STATUSES,
  digestStatusSchema,
  type DigestLogRow,
  type DigestStatus,
} from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from 'cn';
import { DateField, SelectField } from '@/components/field';
import { ListPage } from '@/components/list/list-page';
import type { Column, ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { PANEL } from '@/components/ui/control';
import { momentText, schoolDateText } from '@/lib/dates';
import { digestLogQuery } from './digest-api';

const childrenOf = (row: DigestLogRow): string =>
  row.children
    .map((child) =>
      child.className === null ? child.firstName : `${child.firstName}, ${child.className}`,
    )
    .join('; ');

/**
 * The send log of the parents' digest (task 11.5; `10`, Sending: "Every digest is kept in a send
 * log (to whom, for which children, when, delivered or not) that the Super Admin can read"): the
 * newest digests, or those of one date.
 */
export function DigestLogPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/people/digest-log' });
  const [date, setDate] = useState('');
  const [status, setStatus] = useState<DigestStatus | null>(null);
  const [page, setPage] = useState(1);
  const log = useQuery(digestLogQuery({ date: date === '' ? null : date, status, page }));
  const total = log.data?.total ?? 0;
  const pageSize = log.data?.pageSize ?? 1;
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const columns = useMemo(
    (): Column<DigestLogRow>[] => [
      {
        key: 'date',
        header: t('digest.log.date'),
        cell: (row) => schoolDateText(row.digestDate, language),
        sortValue: (row) => row.digestDate,
        fixed: true,
      },
      {
        key: 'parent',
        header: t('digest.log.parent'),
        cell: (row) => row.parentName,
        sortValue: (row) => row.parentName,
        searchText: (row) => `${row.parentName} ${row.login} ${childrenOf(row)}`,
      },
      {
        key: 'login',
        header: t('digest.log.login'),
        cell: (row) => row.login,
        sortValue: (row) => row.login,
      },
      {
        key: 'children',
        header: t('digest.log.children'),
        cell: childrenOf,
        sortValue: childrenOf,
      },
      {
        key: 'status',
        header: t('digest.log.status'),
        cell: (row) => t(`digest.log.statuses.${row.status}`),
        sortValue: (row) => row.status,
      },
      {
        key: 'sentAt',
        header: t('digest.log.sentAt'),
        cell: (row) =>
          row.sentAt === null
            ? ''
            : momentText(language, row.sentAt, { month: 'long', timeZone: 'Asia/Tashkent' }),
        sortValue: (row) => row.sentAt ?? '',
      },
      {
        key: 'attempts',
        header: t('digest.log.attempts'),
        cell: (row) => String(row.attempts),
        sortValue: (row) => row.attempts,
      },
    ],
    [t, language],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/people/digest-log', search: next, replace: how === 'replace' });
  };

  return (
    <>
      <PageHeader
        title={t('digest.log.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('people.title'), to: '/people' },
          { label: t('people.relatives.title'), to: '/people/parents' },
        ]}
      />
      <div className={cn(PANEL, 'flex flex-wrap items-end gap-4')}>
        <div className="w-48">
          <DateField
            label={t('digest.log.chooseDate')}
            name="digest-date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-56">
          <SelectField
            label={t('digest.log.status')}
            name="digest-status"
            value={status ?? ''}
            options={[
              { value: '', label: t('digest.log.allStatuses') },
              ...DIGEST_STATUSES.map((one) => ({
                value: one,
                label: t(`digest.log.statuses.${one}`),
              })),
            ]}
            onChange={(event) => {
              const chosen = digestStatusSchema.safeParse(event.target.value);
              setStatus(chosen.success ? chosen.data : null);
              setPage(1);
            }}
          />
        </div>
        <p className="text-sm" data-testid="digest-log-range">
          {t('digest.log.range', { first, last, total })}
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={page <= 1}
            onClick={() => {
              setPage((current) => current - 1);
            }}
          >
            {t('digest.log.earlier')}
          </Button>
          <Button
            variant="secondary"
            disabled={last >= total}
            onClick={() => {
              setPage((current) => current + 1);
            }}
          >
            {t('digest.log.later')}
          </Button>
        </div>
      </div>
      <ListPage
        listId="digest-log"
        caption={t('digest.log.caption')}
        rows={log.data?.rows}
        error={log.error ?? undefined}
        onRetry={() => {
          void log.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => row.parentName}
        columns={columns}
        search={search}
        onSearchChange={open}
        empty={{ title: t('digest.log.emptyTitle'), text: t('digest.log.empty') }}
      />
    </>
  );
}
