import { listName, type NeverUsedAccount } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { WarningIcon } from '@/components/icons';
import { ListPage } from '@/components/list/list-page';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { useView } from '@/features/access/use-view';
import { neverUsedQuery } from './people-api';
import { PeopleTabs } from './people-tabs';
import { formatMoment } from '@/lib/dates';

/** Surname first, as every list (owner's answer to finding 27). */
const nameOfRow = (row: NeverUsedAccount): string => listName(row);

/**
 * The accounts never used (edge cases, Accounts and sign-in: "A report lists
 * accounts never used"; task 2.3c-1, decision 10): the accounts of the
 * branch's records with no session since the start of the person's current
 * employment period. A first or one-time password that has run out is said
 * in words and with an icon. A name opens the record in the staff list, where
 * the sign-in access is changed. No export yet (2.6).
 */
export function NeverUsedPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/people/never-used' });
  const { branchId } = useView();
  const accounts = useQuery(neverUsedQuery(branchId));

  const columns = useMemo(
    (): Column<NeverUsedAccount>[] => [
      {
        key: 'name',
        header: t('people.neverUsed.name'),
        cell: (row) => (
          <Link
            to="/people/staff"
            search={{ open: row.staffId }}
            className="font-semibold text-link underline-offset-4 hover:underline"
          >
            {nameOfRow(row)}
          </Link>
        ),
        sortValue: (row) => `${row.lastName} ${row.firstName}`,
        searchText: (row) => `${nameOfRow(row)} ${row.staffNumber} ${row.login}`,
        fixed: true,
      },
      {
        key: 'staffNumber',
        header: t('people.neverUsed.staffNumber'),
        cell: (row) => row.staffNumber,
        sortValue: (row) => row.staffNumber,
      },
      {
        key: 'login',
        header: t('people.neverUsed.login'),
        cell: (row) => row.login,
        sortValue: (row) => row.login,
      },
      {
        key: 'created',
        header: t('people.neverUsed.created'),
        cell: (row) => formatMoment(language, row.createdAt),
        sortValue: (row) => row.createdAt,
      },
      {
        key: 'password',
        header: t('people.neverUsed.password'),
        cell: (row) =>
          row.passwordValidUntil === null ? (
            ''
          ) : row.expired ? (
            <span className="inline-flex items-center gap-1" data-expired="">
              <WarningIcon aria-hidden className="size-4" />
              {t('people.neverUsed.expired', {
                date: formatMoment(language, row.passwordValidUntil),
              })}
            </span>
          ) : (
            t('people.neverUsed.validUntil', {
              date: formatMoment(language, row.passwordValidUntil),
            })
          ),
        sortValue: (row) => row.passwordValidUntil,
      },
      {
        key: 'locked',
        header: t('people.neverUsed.lockedColumn'),
        cell: (row) => (row.locked ? t('people.neverUsed.locked') : ''),
        sortValue: (row) => (row.locked ? 1 : 0),
      },
    ],
    [t, language],
  );

  const filters = useMemo(
    (): Filter<NeverUsedAccount>[] => [
      {
        key: 'password',
        label: t('people.neverUsed.password'),
        options: [
          { value: 'expired', label: t('people.neverUsed.expiredOption') },
          { value: 'valid', label: t('people.neverUsed.validOption') },
        ],
        matches: (row, value) => (value === 'expired' ? row.expired : !row.expired),
      },
    ],
    [t],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/people/never-used', search: next, replace: how === 'replace' });
  };

  return (
    <>
      <PageHeader
        title={t('people.neverUsed.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('people.title'), to: '/people' },
        ]}
      />
      <PeopleTabs current="never-used" />
      <ListPage
        listId="never-used"
        caption={t('people.neverUsed.caption')}
        rows={accounts.data?.accounts}
        error={accounts.error ?? undefined}
        onRetry={() => {
          void accounts.refetch();
        }}
        rowId={(row) => row.staffId}
        rowName={nameOfRow}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{ title: t('people.neverUsed.emptyTitle'), text: t('people.neverUsed.empty') }}
      />
    </>
  );
}
