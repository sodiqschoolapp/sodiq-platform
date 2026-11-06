import { PERMISSIONS, permits, type ParentsNeverUsed } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { WarningIcon } from '@/components/icons';
import { ListPage } from '@/components/list/list-page';
import type { Column, Filter, ListSearch } from '@/components/list/list-state';
import { useExport } from '@/components/list/use-export';
import { PageHeader } from '@/components/page-header';
import { useView } from '@/features/access/use-view';
import { momentText } from '@/lib/dates';
import { parentsNeverUsedQuery } from './parent-accounts-api';
import { PeopleTabs } from './people-tabs';

type Row = ParentsNeverUsed['accounts'][number];

const childrenOf = (row: Row): string =>
  row.children.map((child) => `${child.lastName} ${child.firstName}`).join(', ');

/**
 * The Parent accounts never used (task 11.1; `edge/close-relatives`: "a report lists Parent
 * accounts never used"): the accounts of the branch's parents whose holder never chose a
 * password, with the last slip and whether its password ran out. A name opens the parent in
 * the Parents list, where the password is reset. Reading the report is logged as an export.
 */
export function ParentsNeverUsedPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/people/parent-accounts' });
  const { role, branchId } = useView();
  const accounts = useQuery(parentsNeverUsedQuery(branchId));
  const canExport = role !== null && permits(PERMISSIONS, role, 'parent_accounts', 'export');
  const exporter = useExport<Row>('parents_never_used', (row) => row.relativeId);

  const columns = useMemo(
    (): Column<Row>[] => [
      {
        key: 'name',
        header: t('people.parentsNeverUsed.name'),
        cell: (row) => (
          <Link
            to="/people/parents"
            search={{ open: row.relativeId }}
            className="font-semibold text-link underline-offset-4 hover:underline"
          >
            {row.fullName}
          </Link>
        ),
        sortValue: (row) => row.fullName,
        searchText: (row) => `${row.fullName} ${row.login} ${childrenOf(row)}`,
        fixed: true,
      },
      {
        key: 'login',
        header: t('people.parentsNeverUsed.login'),
        cell: (row) => row.login,
        sortValue: (row) => row.login,
      },
      {
        key: 'children',
        header: t('people.parentsNeverUsed.children'),
        cell: childrenOf,
        sortValue: childrenOf,
      },
      {
        key: 'printedAt',
        header: t('people.parentsNeverUsed.printedAt'),
        cell: (row) =>
          row.slip === null ? '' : momentText(language, row.slip.printedAt, { month: 'long' }),
        sortValue: (row) => row.slip?.printedAt ?? '',
      },
      {
        key: 'validUntil',
        header: t('people.parentsNeverUsed.validUntil'),
        cell: (row) =>
          row.slip === null ? '' : momentText(language, row.slip.validUntil, { month: 'long' }),
        sortValue: (row) => row.slip?.validUntil ?? '',
      },
      {
        key: 'expired',
        header: t('people.parentsNeverUsed.expired'),
        cell: (row) =>
          row.expired ? (
            <span className="inline-flex items-center gap-1" data-expired="">
              <WarningIcon aria-hidden className="size-4" />
              {t('people.parentsNeverUsed.yes')}
            </span>
          ) : (
            ''
          ),
        sortValue: (row) => (row.expired ? 1 : 0),
      },
    ],
    [t, language],
  );

  const filters = useMemo(
    (): Filter<Row>[] => [
      {
        key: 'expired',
        label: t('people.parentsNeverUsed.expired'),
        options: [{ value: 'yes', label: t('people.parentsNeverUsed.yes') }],
        matches: (row) => row.expired,
      },
    ],
    [t],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/people/parent-accounts', search: next, replace: how === 'replace' });
  };

  return (
    <>
      <PageHeader
        title={t('people.parentsNeverUsed.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('people.title'), to: '/people' },
        ]}
      />
      <PeopleTabs current="parent-accounts" />
      <ListPage
        listId="parents-never-used"
        caption={t('people.parentsNeverUsed.caption')}
        rows={accounts.data?.accounts}
        error={accounts.error ?? undefined}
        onRetry={() => {
          void accounts.refetch();
        }}
        rowId={(row) => row.relativeId}
        rowName={(row) => row.fullName}
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        onExport={canExport ? exporter.onExport : undefined}
        exportState={exporter.state}
        empty={{
          title: t('people.parentsNeverUsed.emptyTitle'),
          text: t('people.parentsNeverUsed.empty'),
        }}
      />
    </>
  );
}
